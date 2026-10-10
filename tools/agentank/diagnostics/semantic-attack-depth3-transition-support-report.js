#!/usr/bin/env node
"use strict";

// BP132 classifies every depth-3 root left incomplete after BP131 saturated
// representative width and node budget.  It is an offline report only.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { ACTION, FAST_STATUS, HARD_STATUS } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { FAST_UNSUPPORTED_REASON, JOINT_RELOCATION_DETAIL } = require(
  "../../../engine-v2/src/fast/kernel");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { readMatches } = require("./semantic-attack-certificate-root-corpus");
const { extractComparisons } = require(
  "./semantic-attack-comparison-root-corpus");
const { readRoots } = require("./semantic-attack-chance-interval-corpus");

const CAUSE = Object.freeze({ JOINT_RELOCATION_OCCUPIED_AFTER_EARLIER_MOVE:
  "JOINT_RELOCATION_OCCUPIED_AFTER_EARLIER_MOVE",
HARD_NARROW_PROOF_INCOMPLETE: "HARD_NARROW_PROOF_INCOMPLETE",
UNCLASSIFIED: "UNCLASSIFIED" });
const ACTION_NAME = Object.freeze(Object.fromEntries(
  Object.entries(ACTION).map(([name, code]) => [code, name])));

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function classifyBranch(detail) {
  if (detail.OUTER_FAST_COUNT > 0 &&
      detail.FIRST_FAST_STATUS === FAST_STATUS.UNSUPPORTED_RULE &&
      detail.FIRST_FAST_REASON === FAST_UNSUPPORTED_REASON.JOINT_TANK_RELOCATION &&
      detail.FIRST_FAST_DETAIL ===
        JOINT_RELOCATION_DETAIL.OCCUPIED_AFTER_EARLIER_MOVE)
    return CAUSE.JOINT_RELOCATION_OCCUPIED_AFTER_EARLIER_MOVE;
  if (detail.HARD_INCOMPLETE_COUNT > 0 &&
      detail.FIRST_HARD_VIABLE_CODE === 0 &&
      detail.FIRST_HARD_HAZARD_COMPLETE === 1 &&
      detail.FIRST_HARD_NARROW_PROOF_COMPLETE === 0 &&
      !detail.FIRST_HARD_SHIELD_ESCAPE && !detail.FIRST_HARD_BOOST_ESCAPE &&
      !detail.FIRST_HARD_TELEPORT_ESCAPE)
    return CAUSE.HARD_NARROW_PROOF_INCOMPLETE;
  return CAUSE.UNCLASSIFIED;
}

function compactRecord(root, label) {
  const lane = root.comparison.depthWidthLadder?.[3];
  if (!lane || lane.complete) return null;
  let side = "";
  if (lane.baselineReasonMask) side = "baseline";
  else if (lane.candidateReasonMask) side = "candidate";
  if (!side) return null;
  const transition = root.comparison.transitionSupport?.[side];
  if (!transition) return null;
  const detail = transition.detail;
  const cause = classifyBranch(detail);
  const firstFast = detail.FIRST_FAST_STATUS ? {
    status: detail.FIRST_FAST_STATUS, reason: detail.FIRST_FAST_REASON,
    detail: detail.FIRST_FAST_DETAIL,
    insideHard: Boolean(detail.FIRST_FAST_INSIDE_HARD),
    action0: detail.FIRST_FAST_ACTION0,
    action0Name: ACTION_NAME[detail.FIRST_FAST_ACTION0] || "UNKNOWN",
    action1: detail.FIRST_FAST_ACTION1,
    action1Name: ACTION_NAME[detail.FIRST_FAST_ACTION1] || "UNKNOWN",
    argument0: detail.FIRST_FAST_ARGUMENT0,
    argument1: detail.FIRST_FAST_ARGUMENT1,
    chance0: detail.FIRST_FAST_CHANCE0,
    chance1: detail.FIRST_FAST_CHANCE1,
    ply: detail.FIRST_FAST_PLY } : null;
  const firstHard = detail.HARD_INCOMPLETE_COUNT ? {
    status: HARD_STATUS.INCOMPLETE,
    action0: detail.FIRST_HARD_ACTION0,
    action0Name: ACTION_NAME[detail.FIRST_HARD_ACTION0] || "UNKNOWN",
    action1: detail.FIRST_HARD_ACTION1,
    action1Name: ACTION_NAME[detail.FIRST_HARD_ACTION1] || "UNKNOWN",
    argument0: detail.FIRST_HARD_ARGUMENT0,
    argument1: detail.FIRST_HARD_ARGUMENT1,
    chance0: detail.FIRST_HARD_CHANCE0,
    chance1: detail.FIRST_HARD_CHANCE1,
    ply: detail.FIRST_HARD_PLY,
    viableCode: detail.FIRST_HARD_VIABLE_CODE,
    hazardComplete: Boolean(detail.FIRST_HARD_HAZARD_COMPLETE),
    narrowProofComplete: Boolean(detail.FIRST_HARD_NARROW_PROOF_COMPLETE),
    horizonTick: detail.FIRST_HARD_HORIZON_TICK,
    shieldEscape: Boolean(detail.FIRST_HARD_SHIELD_ESCAPE),
    boostEscape: Boolean(detail.FIRST_HARD_BOOST_ESCAPE),
    teleportEscape: Boolean(detail.FIRST_HARD_TELEPORT_ESCAPE) } : null;
  return { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_TRANSITION_SUPPORT_ROOT_V1",
    key: root.key, scenarioFingerprint: root.scenarioFingerprint,
    candidateSeat: root.candidateSeat, frame: root.comparison.frame,
    currentAction: root.comparison.currentAction,
    candidateAction: root.comparison.candidateAction,
    failedSide: side,
    reasonMask: lane[side + "ReasonMask"] | 0,
    cause, outcomeRelation: label?.outcomeRelation || "UNKNOWN",
    paretoRelation: label?.paretoRelation || "UNKNOWN",
    outerFastCount: detail.OUTER_FAST_COUNT,
    hardInternalFastCount: detail.HARD_INTERNAL_FAST_COUNT,
    hardIncompleteCount: detail.HARD_INCOMPLETE_COUNT,
    firstFast, firstHard };
}

function summarize(records) {
  const output = { incompleteRootCount: records.length,
    failedBranchCount: records.length, failedSide: {}, cause: {}, reasonMask: {},
    ply: {}, actionPair: {}, outcomeByCause: {}, paretoByCause: {},
    outerFastFailureTotal: 0, hardInternalFastFailureTotal: 0,
    hardIncompleteTotal: 0, unclassifiedCount: 0 };
  for (const record of records) {
    increment(output.failedSide, record.failedSide);
    increment(output.cause, record.cause);
    increment(output.reasonMask, record.reasonMask);
    output.outerFastFailureTotal += record.outerFastCount;
    output.hardInternalFastFailureTotal += record.hardInternalFastCount;
    output.hardIncompleteTotal += record.hardIncompleteCount;
    if (record.cause === CAUSE.UNCLASSIFIED) output.unclassifiedCount += 1;
    const event = record.firstFast || record.firstHard;
    if (event) {
      increment(output.ply, event.ply);
      increment(output.actionPair, event.action0Name + "/" + event.action1Name);
    }
    const outcomes = output.outcomeByCause[record.cause] ||
      (output.outcomeByCause[record.cause] = {});
    const pareto = output.paretoByCause[record.cause] ||
      (output.paretoByCause[record.cause] = {});
    increment(outcomes, record.outcomeRelation);
    increment(pareto, record.paretoRelation);
  }
  return output;
}

function allZero(value) {
  return Object.values(value || {}).every(item => typeof item !== "number" ||
    item === 0);
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp132-depth3-transition-detail-shadow-v2")));
  const labelDirectory = path.resolve(option("--labels", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp128-semantic-attack-comparison-roots-v2")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp132-semantic-attack-depth3-transition-support")));
  const expectedRoots = Number(option("--expected-roots", 211));
  const expectedIncomplete = Number(option("--expected-incomplete", 36));
  const source = readMatches(sourceDirectory);
  const extracted = extractComparisons(source.matches);
  const labels = readRoots(labelDirectory);
  const labelByKey = new Map(labels.roots.map(item => [item.key, item]));
  const records = []; let missingLabelCount = 0;
  for (const item of extracted.roots) {
    const record = compactRecord(item, labelByKey.get(item.key));
    if (!record) continue;
    if (!labelByKey.has(item.key)) missingLabelCount += 1;
    records.push(record);
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
  const lane = width.lanes?.[3] || {};
  const behaviorNeutral = allZero(sourceOverview.comparison);
  const accepted = extracted.roots.length === expectedRoots &&
    labels.roots.length === expectedRoots && records.length === expectedIncomplete &&
    missingLabelCount === 0 && lane.completeCount === 175 &&
    lane.incompleteCount === expectedIncomplete &&
    summary.cause[CAUSE.JOINT_RELOCATION_OCCUPIED_AFTER_EARLIER_MOVE] === 35 &&
    summary.cause[CAUSE.HARD_NARROW_PROOF_INCOMPLETE] === 1 &&
    summary.unclassifiedCount === 0 && summary.hardInternalFastFailureTotal === 0 &&
    summary.ply[2] === expectedIncomplete &&
    behaviorNeutral && (width.rootRestoreFailureCount || 0) === 0 &&
    (width.hotAllocationCount || 0) === 0 &&
    productionRootSha256 === sourceManifest.source?.productionRootSha256 &&
    productionRootSha256 === labelManifest.productionRootSha256;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_TRANSITION_SUPPORT_OVERVIEW_V1",
    status: accepted ? "ACCEPT_CAUSES_CLASSIFIED" : "REJECTED",
    sourceMatchCount: source.matches.length,
    sourceRootCount: extracted.roots.length, labelRootCount: labels.roots.length,
    joinedIncompleteRootCount: records.length, missingLabelCount,
    saturatedLane: { name: lane.name, completeCount: lane.completeCount,
      incompleteCount: lane.incompleteCount,
      baselineNodeTotal: lane.baselineNodeTotal,
      candidateNodeTotal: lane.candidateNodeTotal,
      maximumNodes: lane.maximumNodes },
    behaviorNeutral, rootRestoreFailureCount: width.rootRestoreFailureCount || 0,
    hotAllocationCount: width.hotAllocationCount || 0, ...summary,
    diagnosis:
      "After width and budget saturation, 35 of 36 incomplete roots are the same ply-2 GO/GO FastKernel gap: JOINT_TANK_RELOCATION with OCCUPIED_AFTER_EARLIER_MOVE. The final root is a conservative Hard UNKNOWN because a hostile projectile reaches dirt, so narrow proof support is incomplete.",
    decision:
      "Do not increase Minimax depth, width, or budget. Resolve official joint tank relocation semantics with a physical oracle before changing FastKernel; keep the dirt-impact Hard result conservative until stronger committed-hazard support exists." };
  const lines = records.map(JSON.stringify).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_TRANSITION_SUPPORT_MANIFEST_V1",
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
  if (!accepted) throw new Error("BP132_TRANSITION_SUPPORT_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { CAUSE, classifyBranch, compactRecord, summarize, allZero,
  build };
