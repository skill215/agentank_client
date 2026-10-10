#!/usr/bin/env node
"use strict";

// BP129 joins the fixed incumbent/candidate pair evaluated by the depth
// ladder with BP128's exact historical terminal labels.  The report separates
// node-budget stability, horizon stability and incomplete support; it never
// changes an action or replays a battle.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { readMatches } = require("./semantic-attack-certificate-root-corpus");
const { extractComparisons } = require(
  "./semantic-attack-comparison-root-corpus");
const { readRoots } = require("./semantic-attack-chance-interval-corpus");

const RELATION_NAME = Object.freeze({
  0: "INCOMPLETE", 1: "CANDIDATE_HIGHER", 2: "EQUAL",
  3: "CANDIDATE_LOWER"
});
const EXPECTED_LANES = Object.freeze([
  ["D1_B2048", 1, 2048], ["D2_B256", 2, 256],
  ["D2_B2048", 2, 2048], ["D3_B2048", 3, 2048]
]);

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function laneBucket(name, depth, nodeBudget) {
  return { name, depth, nodeBudget, rootCount: 0, completeCount: 0,
    incompleteCount: 0, relationCount: { CANDIDATE_HIGHER: 0, EQUAL: 0,
      CANDIDATE_LOWER: 0, INCOMPLETE: 0 },
    outcomeByRelation: {}, paretoByRelation: {}, baselineNodeTotal: 0,
    candidateNodeTotal: 0, maximumCombinedNodes: 0, budgetHitCount: 0,
    zeroWorkCount: 0, completeNodeTotal: 0, incompleteNodeTotal: 0,
    completeBudgetHitCount: 0, incompleteBudgetHitCount: 0,
    completeMaximumCombinedNodes: 0, incompleteMaximumCombinedNodes: 0 };
}

function incrementNested(target, first, second) {
  const bucket = target[first] || (target[first] = {});
  bucket[second] = (bucket[second] || 0) + 1;
}

function addLane(bucket, lane, record) {
  const relation = RELATION_NAME[lane.relation] || "UNKNOWN";
  const combinedNodes = lane.baselineNodes + lane.candidateNodes;
  bucket.rootCount += 1;
  bucket.completeCount += lane.complete ? 1 : 0;
  bucket.incompleteCount += lane.complete ? 0 : 1;
  bucket.relationCount[relation] = (bucket.relationCount[relation] || 0) + 1;
  bucket.baselineNodeTotal += lane.baselineNodes;
  bucket.candidateNodeTotal += lane.candidateNodes;
  if (combinedNodes > bucket.maximumCombinedNodes)
    bucket.maximumCombinedNodes = combinedNodes;
  bucket.budgetHitCount += lane.baselineNodes >= bucket.nodeBudget ||
    lane.candidateNodes >= bucket.nodeBudget ? 1 : 0;
  bucket.zeroWorkCount += combinedNodes === 0 ? 1 : 0;
  const budgetHit = lane.baselineNodes >= bucket.nodeBudget ||
    lane.candidateNodes >= bucket.nodeBudget;
  if (lane.complete) {
    bucket.completeNodeTotal += combinedNodes;
    bucket.completeBudgetHitCount += budgetHit ? 1 : 0;
    if (combinedNodes > bucket.completeMaximumCombinedNodes)
      bucket.completeMaximumCombinedNodes = combinedNodes;
  } else {
    bucket.incompleteNodeTotal += combinedNodes;
    bucket.incompleteBudgetHitCount += budgetHit ? 1 : 0;
    if (combinedNodes > bucket.incompleteMaximumCombinedNodes)
      bucket.incompleteMaximumCombinedNodes = combinedNodes;
  }
  if (lane.complete) {
    incrementNested(bucket.outcomeByRelation, relation, record.outcomeRelation);
    incrementNested(bucket.paretoByRelation, relation, record.paretoRelation);
  }
}

function transitionBucket(leftName, rightName) {
  return { leftName, rightName, comparableCount: 0, sameCount: 0,
    changedCount: 0, leftIncompleteCount: 0, rightIncompleteCount: 0,
    matrix: {} };
}

function addTransition(bucket, left, right) {
  if (!left.complete) bucket.leftIncompleteCount += 1;
  if (!right.complete) bucket.rightIncompleteCount += 1;
  if (!left.complete || !right.complete) return;
  const leftName = RELATION_NAME[left.relation] || "UNKNOWN";
  const rightName = RELATION_NAME[right.relation] || "UNKNOWN";
  const key = leftName + "_TO_" + rightName;
  bucket.comparableCount += 1;
  bucket.sameCount += left.relation === right.relation ? 1 : 0;
  bucket.changedCount += left.relation === right.relation ? 0 : 1;
  bucket.matrix[key] = (bucket.matrix[key] || 0) + 1;
}

function normalizeLane(lane) {
  return { name: lane.name, complete: Boolean(lane.complete),
    relation: lane.relation | 0, relationName:
      RELATION_NAME[lane.relation] || "UNKNOWN",
    baselineValue: lane.baselineValue | 0,
    candidateValue: lane.candidateValue | 0,
    baselineNodes: lane.baselineNodes | 0,
    candidateNodes: lane.candidateNodes | 0 };
}

function compactRecord(source, label) {
  const ladder = source.comparison.depthLadder || [];
  return { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH_STABILITY_ROOT_V1", key: source.key,
    scenarioFingerprint: source.scenarioFingerprint,
    candidateSeat: source.candidateSeat, frame: source.comparison.frame,
    currentAction: source.comparison.currentAction,
    candidateAction: source.comparison.candidateAction,
    sourcePolicyRelation: RELATION_NAME[source.comparison.policyRelation] ||
      "UNKNOWN", outcomeRelation: label.outcomeRelation,
    paretoRelation: label.paretoRelation,
    transition: label.transition, lanes: ladder.map(normalizeLane) };
}

function summarize(records) {
  const lanes = EXPECTED_LANES.map(spec => laneBucket(...spec));
  const d1d2 = transitionBucket("D1_B2048", "D2_B256");
  const d2Budget = transitionBucket("D2_B256", "D2_B2048");
  const d2d3 = transitionBucket("D2_B2048", "D3_B2048");
  let sourceRelationMismatchCount = 0;
  let laneShapeMismatchCount = 0;
  for (const record of records) {
    if (record.lanes.length !== EXPECTED_LANES.length) {
      laneShapeMismatchCount += 1; continue;
    }
    let valid = true;
    for (let index = 0; index < EXPECTED_LANES.length; index += 1)
      if (record.lanes[index].name !== EXPECTED_LANES[index][0]) valid = false;
    if (!valid) { laneShapeMismatchCount += 1; continue; }
    for (let index = 0; index < lanes.length; index += 1)
      addLane(lanes[index], record.lanes[index], record);
    if (record.lanes[1].relationName !== record.sourcePolicyRelation)
      sourceRelationMismatchCount += 1;
    addTransition(d1d2, record.lanes[0], record.lanes[1]);
    addTransition(d2Budget, record.lanes[1], record.lanes[2]);
    addTransition(d2d3, record.lanes[2], record.lanes[3]);
  }
  const d3 = lanes[3];
  return { rootCount: records.length, laneShapeMismatchCount,
    sourceRelationMismatchCount, lanes,
    transitions: { depthOneToTwo: d1d2, depthTwoBudget: d2Budget,
      depthTwoToThree: d2d3 },
    depthThreeIncomplete: { count: d3.incompleteCount,
      attemptedNodeTotal: d3.incompleteNodeTotal,
      budgetHitCount: d3.incompleteBudgetHitCount,
      zeroWorkCount: d3.zeroWorkCount,
      maximumCombinedNodes: d3.incompleteMaximumCombinedNodes },
    depthThreeComplete: { count: d3.completeCount,
      attemptedNodeTotal: d3.completeNodeTotal,
      budgetHitCount: d3.completeBudgetHitCount,
      maximumCombinedNodes: d3.completeMaximumCombinedNodes } };
}

function allZero(value) {
  return Object.values(value || {}).every(item => typeof item !== "number" ||
    item === 0);
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp129-depth-stability-shadow-v3")));
  const labelDirectory = path.resolve(option("--labels", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp128-semantic-attack-comparison-roots-v2")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp129-semantic-attack-depth-stability")));
  const expectedRoots = Number(option("--expected-roots", 211));
  const source = readMatches(sourceDirectory);
  const extracted = extractComparisons(source.matches);
  const labels = readRoots(labelDirectory);
  const labelsByKey = new Map(labels.roots.map(item => [item.key, item]));
  const records = []; let missingLabelCount = 0;
  for (const item of extracted.roots) {
    const label = labelsByKey.get(item.key);
    if (!label) { missingLabelCount += 1; continue; }
    records.push(compactRecord(item, label));
  }
  const summary = summarize(records);
  const sourceManifestBytes = fs.readFileSync(path.join(sourceDirectory,
    "manifest.json"));
  const sourceOverviewBytes = fs.readFileSync(path.join(sourceDirectory,
    "overview.json"));
  const labelManifestBytes = fs.readFileSync(path.join(labelDirectory,
    "manifest.json"));
  const sourceManifest = JSON.parse(sourceManifestBytes);
  const sourceOverview = JSON.parse(sourceOverviewBytes);
  const labelManifest = JSON.parse(labelManifestBytes);
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const productionRootSha256 = sha256Bytes(fs.readFileSync(productionFile));
  const sourceProductionSha256 = sourceManifest.source?.productionRootSha256;
  const labelProductionSha256 = labelManifest.productionRootSha256;
  const depth = sourceOverview.candidate?.semanticAttackPolicyIntervalShadow
    ?.depthStability || {};
  const comparison = sourceOverview.comparison || {};
  const behaviorNeutral = allZero(comparison);
  const accepted = extracted.overflowCount === 0 &&
    extracted.missingCandidateCount === 0 && missingLabelCount === 0 &&
    extracted.roots.length === expectedRoots &&
    labels.roots.length === expectedRoots && records.length === expectedRoots &&
    summary.laneShapeMismatchCount === 0 &&
    summary.sourceRelationMismatchCount === 0 &&
    summary.transitions.depthTwoBudget.changedCount === 0 &&
    summary.transitions.depthTwoBudget.comparableCount === expectedRoots &&
    (depth.rootRestoreFailureCount || 0) === 0 &&
    (depth.hotAllocationCount || 0) === 0 && behaviorNeutral &&
    productionRootSha256 === sourceProductionSha256 &&
    productionRootSha256 === labelProductionSha256;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH_STABILITY_OVERVIEW_V1",
    status: accepted ? "ACCEPT_EVIDENCE_REJECT_BUDGET_DEPTH_OWNER" : "REJECTED",
    sourceMatchCount: source.matches.length,
    sourceRootCount: extracted.roots.length, labelRootCount: labels.roots.length,
    joinedRootCount: records.length, missingLabelCount,
    comparisonOverflowCount: extracted.overflowCount,
    comparisonMissingCandidateCount: extracted.missingCandidateCount,
    behaviorNeutral, rootRestoreFailureCount:
      depth.rootRestoreFailureCount || 0,
    hotAllocationCount: depth.hotAllocationCount || 0, ...summary,
    conclusions: {
      sameDepthBudget:
        "Increasing depth-2 budget from 256 to 2048 changed zero fixed-pair relations.",
      deeperHorizon:
        "Depth 3 is mostly incomplete without exhausting its node budget; completed roots still change sign.",
      architecture:
        "The limiting factor is closure/leaf/backup semantics, not an early node-budget fallback."
    },
    decision:
      "Do not raise production depth or budget from this evidence. Classify depth-3 incomplete support and introduce event/deadline quiescence before another calibration." };
  const lines = records.map(JSON.stringify).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH_STABILITY_MANIFEST_V1",
    status: overview.status, sourceDirectory, labelDirectory,
    sourceManifestSha256: sha256Bytes(sourceManifestBytes),
    sourceOverviewSha256: sha256Bytes(sourceOverviewBytes),
    sourceMatchesSha256: sha256Bytes(source.bytes),
    labelManifestSha256: sha256Bytes(labelManifestBytes),
    labelRootsSha256: sha256Bytes(labels.bytes), productionRootSha256,
    rootsSha256: sha256Bytes(bytes), rootCount: records.length,
    arguments: process.argv.slice(2), fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"), bytes);
  process.stdout.write(JSON.stringify({ output: outputDirectory, overview,
    fingerprint: manifest.fingerprint }, null, 2) + "\n");
  if (!accepted) throw new Error("BP129_DEPTH_STABILITY_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { RELATION_NAME, EXPECTED_LANES, laneBucket, addLane,
  transitionBucket, addTransition, compactRecord, summarize, allZero, build };
