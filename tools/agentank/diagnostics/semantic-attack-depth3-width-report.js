#!/usr/bin/env node
"use strict";

// BP131 joins the depth-3 representative-width ladder with BP128 exact
// historical outcomes.  It measures completeness and stability; no lane owns
// an action.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { readMatches } = require("./semantic-attack-certificate-root-corpus");
const { extractComparisons } = require(
  "./semantic-attack-comparison-root-corpus");
const { readRoots } = require("./semantic-attack-chance-interval-corpus");

const LANE_NAMES = Object.freeze([
  "D3_W2_B2048", "D3_W3_B2048", "D3_W4_B2048", "D3_W4_B4096"
]);
const RELATION_NAME = Object.freeze({ 0: "INCOMPLETE",
  1: "CANDIDATE_HIGHER", 2: "EQUAL", 3: "CANDIDATE_LOWER" });

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function increment(target, key) { target[key] = (target[key] || 0) + 1; }

function compactRecord(source, label) {
  const ladder = source.comparison.depthWidthLadder || [];
  return { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_WIDTH_ROOT_V1", key: source.key,
    scenarioFingerprint: source.scenarioFingerprint,
    candidateSeat: source.candidateSeat, frame: source.comparison.frame,
    outcomeRelation: label.outcomeRelation,
    paretoRelation: label.paretoRelation,
    lanes: ladder.map(item => ({ name: item.name,
      complete: Boolean(item.complete), relation: item.relation | 0,
      relationName: RELATION_NAME[item.relation] || "UNKNOWN",
      baselineValue: item.baselineValue | 0,
      candidateValue: item.candidateValue | 0,
      baselineNodes: item.baselineNodes | 0,
      candidateNodes: item.candidateNodes | 0,
      baselineReasonMask: item.baselineReasonMask | 0,
      candidateReasonMask: item.candidateReasonMask | 0 })) };
}

function laneBucket(name) {
  return { name, rootCount: 0, completeCount: 0, incompleteCount: 0,
    relationCount: {}, outcomeByRelation: {}, paretoByRelation: {},
    baselineNodeTotal: 0, candidateNodeTotal: 0, maximumCombinedNodes: 0,
    baselineReasonMask: {}, candidateReasonMask: {} };
}

function addLane(bucket, lane, record) {
  bucket.rootCount += 1;
  bucket.completeCount += lane.complete ? 1 : 0;
  bucket.incompleteCount += lane.complete ? 0 : 1;
  increment(bucket.relationCount, lane.relationName);
  bucket.baselineNodeTotal += lane.baselineNodes;
  bucket.candidateNodeTotal += lane.candidateNodes;
  const nodes = lane.baselineNodes + lane.candidateNodes;
  if (nodes > bucket.maximumCombinedNodes) bucket.maximumCombinedNodes = nodes;
  if (lane.baselineReasonMask)
    increment(bucket.baselineReasonMask, lane.baselineReasonMask);
  if (lane.candidateReasonMask)
    increment(bucket.candidateReasonMask, lane.candidateReasonMask);
  if (lane.complete) {
    const outcome = bucket.outcomeByRelation[lane.relationName] ||
      (bucket.outcomeByRelation[lane.relationName] = {});
    const pareto = bucket.paretoByRelation[lane.relationName] ||
      (bucket.paretoByRelation[lane.relationName] = {});
    increment(outcome, record.outcomeRelation);
    increment(pareto, record.paretoRelation);
  }
}

function transition(leftName, rightName) {
  return { leftName, rightName, sameStateCount: 0, changedStateCount: 0,
    bothCompleteCount: 0, newlyCompleteCount: 0, lostCompleteCount: 0,
    relationChangedCount: 0, matrix: {} };
}

function addTransition(bucket, left, right) {
  const same = left.complete === right.complete &&
    (!left.complete || left.relation === right.relation);
  bucket.sameStateCount += same ? 1 : 0;
  bucket.changedStateCount += same ? 0 : 1;
  bucket.bothCompleteCount += left.complete && right.complete ? 1 : 0;
  bucket.newlyCompleteCount += !left.complete && right.complete ? 1 : 0;
  bucket.lostCompleteCount += left.complete && !right.complete ? 1 : 0;
  bucket.relationChangedCount += left.complete && right.complete &&
    left.relation !== right.relation ? 1 : 0;
  const key = (left.complete ? left.relationName : "INCOMPLETE") + "_TO_" +
    (right.complete ? right.relationName : "INCOMPLETE");
  increment(bucket.matrix, key);
}

function summarize(records) {
  const lanes = LANE_NAMES.map(laneBucket);
  const w2w3 = transition(LANE_NAMES[0], LANE_NAMES[1]);
  const w3w4 = transition(LANE_NAMES[1], LANE_NAMES[2]);
  const w4Budget = transition(LANE_NAMES[2], LANE_NAMES[3]);
  let laneShapeMismatchCount = 0;
  for (const record of records) {
    if (record.lanes.length !== LANE_NAMES.length || record.lanes.some(
      (lane, index) => lane.name !== LANE_NAMES[index])) {
      laneShapeMismatchCount += 1; continue;
    }
    for (let lane = 0; lane < lanes.length; lane += 1)
      addLane(lanes[lane], record.lanes[lane], record);
    addTransition(w2w3, record.lanes[0], record.lanes[1]);
    addTransition(w3w4, record.lanes[1], record.lanes[2]);
    addTransition(w4Budget, record.lanes[2], record.lanes[3]);
  }
  const w2Nodes = lanes[0].baselineNodeTotal + lanes[0].candidateNodeTotal;
  const w3Nodes = lanes[1].baselineNodeTotal + lanes[1].candidateNodeTotal;
  return { rootCount: records.length, laneShapeMismatchCount, lanes,
    transitions: { widthTwoToThree: w2w3, widthThreeToFour: w3w4,
      widthFourBudget: w4Budget },
    widthThreeCost: { widthTwoNodes: w2Nodes, widthThreeNodes: w3Nodes,
      additionalNodes: w3Nodes - w2Nodes,
      nodeRatioBasisPoints: w2Nodes ? Math.floor(w3Nodes * 10000 / w2Nodes) : 0,
      additionalCompleteRoots: lanes[1].completeCount - lanes[0].completeCount } };
}

function allZero(value) {
  return Object.values(value || {}).every(item => typeof item !== "number" ||
    item === 0);
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp131-depth3-width-stability-shadow")));
  const labelDirectory = path.resolve(option("--labels", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp128-semantic-attack-comparison-roots-v2")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp131-semantic-attack-depth3-width")));
  const expectedRoots = Number(option("--expected-roots", 211));
  const source = readMatches(sourceDirectory);
  const extracted = extractComparisons(source.matches);
  const labels = readRoots(labelDirectory);
  const labelByKey = new Map(labels.roots.map(item => [item.key, item]));
  const records = []; let missingLabelCount = 0;
  for (const item of extracted.roots) {
    const label = labelByKey.get(item.key);
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
  const width = sourceOverview.candidate?.semanticAttackPolicyIntervalShadow
    ?.depthWidthStability || {};
  const behaviorNeutral = allZero(sourceOverview.comparison);
  const accepted = extracted.roots.length === expectedRoots &&
    labels.roots.length === expectedRoots && records.length === expectedRoots &&
    missingLabelCount === 0 && summary.laneShapeMismatchCount === 0 &&
    summary.lanes[0].completeCount === 30 &&
    summary.lanes[1].completeCount === 175 &&
    summary.transitions.widthThreeToFour.sameStateCount === expectedRoots &&
    summary.transitions.widthFourBudget.sameStateCount === expectedRoots &&
    behaviorNeutral && (width.rootRestoreFailureCount || 0) === 0 &&
    (width.hotAllocationCount || 0) === 0 &&
    productionRootSha256 === sourceManifest.source?.productionRootSha256 &&
    productionRootSha256 === labelManifest.productionRootSha256;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_WIDTH_OVERVIEW_V1",
    status: accepted ? "ACCEPT_WIDTH3_SATURATION_REJECT_OWNER" : "REJECTED",
    sourceMatchCount: source.matches.length,
    sourceRootCount: extracted.roots.length, labelRootCount: labels.roots.length,
    joinedRootCount: records.length, missingLabelCount, behaviorNeutral,
    rootRestoreFailureCount: width.rootRestoreFailureCount || 0,
    hotAllocationCount: width.hotAllocationCount || 0, ...summary,
    diagnosis:
      "Width 3 recovers 145 exact depth-3 pairs. Width 4 and double budget recover none further and change no verdict, so width 3 is the representative saturation point for this generator.",
    decision:
      "Keep width-3 scheduling diagnostic-only. Classify the remaining 36 transition-support roots and evaluate whether the newly complete values improve historical direction before any production owner." };
  const lines = records.map(JSON.stringify).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_WIDTH_MANIFEST_V1",
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
  if (!accepted) throw new Error("BP131_DEPTH3_WIDTH_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { LANE_NAMES, RELATION_NAME, compactRecord, laneBucket,
  addLane, transition, addTransition, summarize, allZero, build };
