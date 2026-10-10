#!/usr/bin/env node
"use strict";

// BP133 resolves the authority of every remaining joint-movement branch. It
// does not choose a local-simulator rule or change production FastKernel.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { readMatches } = require("./semantic-attack-certificate-root-corpus");
const { extractComparisons } = require(
  "./semantic-attack-comparison-root-corpus");
const { readRoots } = require("./semantic-attack-chance-interval-corpus");
const { CAUSE, classifyBranch, allZero } = require(
  "./semantic-attack-depth3-transition-support-report");
const { JOINT_GEOMETRY, classifyJointGeometry, createRuleMatrix } = require(
  "./joint-movement-rule-oracle");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function compactMovementRecord(root, label) {
  const lane = root.comparison.depthWidthLadder?.[3];
  if (!lane || lane.complete) return null;
  const side = lane.baselineReasonMask ? "baseline" :
    lane.candidateReasonMask ? "candidate" : "";
  const detail = root.comparison.transitionSupport?.[side]?.detail;
  if (!detail || classifyBranch(detail) !==
      CAUSE.JOINT_RELOCATION_OCCUPIED_AFTER_EARLIER_MOVE) return null;
  return { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_JOINT_MOVEMENT_ROOT_V1",
    key: root.key, scenarioFingerprint: root.scenarioFingerprint,
    candidateSeat: root.candidateSeat, frame: root.comparison.frame,
    failedSide: side, geometry: classifyJointGeometry(detail),
    startCell: [detail.FIRST_FAST_START_CELL0,
      detail.FIRST_FAST_START_CELL1],
    preparedTarget: [detail.FIRST_FAST_PREPARED_TARGET0,
      detail.FIRST_FAST_PREPARED_TARGET1],
    confirmedVacatingMask: detail.FIRST_FAST_CONFIRMED_VACATING_MASK,
    effectMask: [detail.FIRST_FAST_EFFECT_MASK0,
      detail.FIRST_FAST_EFFECT_MASK1],
    chance: [detail.FIRST_FAST_CHANCE0, detail.FIRST_FAST_CHANCE1],
    ply: detail.FIRST_FAST_PLY,
    outcomeRelation: label?.outcomeRelation || "UNKNOWN",
    paretoRelation: label?.paretoRelation || "UNKNOWN" };
}

function summarize(records) {
  const output = { rootCount: records.length, geometry: {}, failedSide: {},
    effectMask: {}, outcomeByGeometry: {}, paretoByGeometry: {}, ply: {} };
  for (const record of records) {
    increment(output.geometry, record.geometry);
    increment(output.failedSide, record.failedSide);
    increment(output.effectMask, record.effectMask.join("/"));
    increment(output.ply, record.ply);
    const outcomes = output.outcomeByGeometry[record.geometry] ||
      (output.outcomeByGeometry[record.geometry] = {});
    const pareto = output.paretoByGeometry[record.geometry] ||
      (output.paretoByGeometry[record.geometry] = {});
    increment(outcomes, record.outcomeRelation);
    increment(pareto, record.paretoRelation);
  }
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp133-joint-movement-geometry-shadow-v2")));
  const labelDirectory = path.resolve(option("--labels", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp128-semantic-attack-comparison-roots-v2")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp133-semantic-attack-joint-movement-oracle")));
  const officialFile = path.join(root, "config", "engine-v2",
    "joint-vacated-follow-evidence.json");
  const staticProbeFile = path.join(root, "config", "engine-v2",
    "hp23-static-occupied-block-evidence.json");
  const simulatorFile = path.join(root, "artifacts", "vendor",
    "agentank-simulator-1ef804eb2c187138c4c8e5229fb37cd0126beddf",
    "src", "engine.js");
  const source = readMatches(sourceDirectory);
  const extracted = extractComparisons(source.matches);
  const labels = readRoots(labelDirectory);
  const labelByKey = new Map(labels.roots.map(item => [item.key, item]));
  const records = []; let missingLabelCount = 0;
  for (const item of extracted.roots) {
    const record = compactMovementRecord(item, labelByKey.get(item.key));
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
  const officialBytes = fs.readFileSync(officialFile);
  const staticProbeBytes = fs.readFileSync(staticProbeFile);
  const simulatorBytes = fs.readFileSync(simulatorFile);
  const sourceManifest = JSON.parse(sourceManifestBytes);
  const sourceOverview = JSON.parse(sourceOverviewBytes);
  const official = JSON.parse(officialBytes);
  const staticProbe = JSON.parse(staticProbeBytes);
  const ruleMatrix = createRuleMatrix(official, staticProbe);
  const width = sourceOverview.candidate?.semanticAttackPolicyIntervalShadow
    ?.depthWidthStability || {};
  const lane = width.lanes?.[3] || {};
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const productionRootSha256 = sha256Bytes(fs.readFileSync(productionFile));
  const simulatorSequentialShape = simulatorBytes.includes(
    Buffer.from("for (const index of [0, 1])")) && simulatorBytes.includes(
    Buffer.from("isSamePoint(player.position, position)")) &&
    simulatorBytes.includes(Buffer.from("isSamePoint(otherIntent, actorStart)"));
  const behaviorNeutral = allZero(sourceOverview.comparison);
  const accepted = extracted.roots.length === 211 && records.length === 35 &&
    missingLabelCount === 0 && lane.completeCount === 175 &&
    lane.incompleteCount === 36 &&
    summary.geometry[JOINT_GEOMETRY.SAME_TARGET] === 26 &&
    summary.geometry[JOINT_GEOMETRY.STUN_AFFECTED_PARTIAL_PREPARATION] === 9 &&
    Object.keys(summary.geometry).length === 2 && summary.effectMask["2/0"] === 7 &&
    summary.effectMask["0/2"] === 2 && summary.ply[2] === 35 &&
    official.officialHistoricalEvidence.followsVacatedStart === 31 &&
    official.officialHistoricalEvidence.seat0Follows === 17 &&
    official.officialHistoricalEvidence.seat1Follows === 14 &&
    official.officialHistoricalEvidence.successfulSwap === 0 &&
    official.officialHistoricalEvidence.successfulSameTarget === 0 &&
    staticProbe.officialEvidence.observedCount === 22 &&
    simulatorSequentialShape && behaviorNeutral &&
    (width.rootRestoreFailureCount || 0) === 0 &&
    (width.hotAllocationCount || 0) === 0 &&
    productionRootSha256 === sourceManifest.source?.productionRootSha256;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_JOINT_MOVEMENT_ORACLE_OVERVIEW_V1",
    status: accepted ? "ACCEPT_RULE_AUTHORITY_CLASSIFIED" : "REJECTED",
    sourceRootCount: extracted.roots.length,
    sourceIncompleteRootCount: lane.incompleteCount,
    missingLabelCount, behaviorNeutral,
    rootRestoreFailureCount: width.rootRestoreFailureCount || 0,
    hotAllocationCount: width.hotAllocationCount || 0,
    productionChanged: false, ...summary, ruleMatrix,
    officialReplayEvidence: official.officialHistoricalEvidence,
    staticProbeEvidence: staticProbe.officialEvidence,
    pinnedSimulator: { commit:
      "1ef804eb2c187138c4c8e5229fb37cd0126beddf",
    engineSha256: sha256Bytes(simulatorBytes), sequentialShapeVerified:
      simulatorSequentialShape,
    authority: "PINNED_SIMULATOR_ASSUMPTION_NOT_PLATFORM_TRUTH",
    conflictWithOfficialEvidence:
      "The simulator always resolves seat0 before seat1 against current occupancy, while official histories prove both seat orders can follow a same-record vacated start." },
    diagnosis:
      "The 35 depth-3 movement gaps split into 26 plain same-target contests and 9 stun-affected partially prepared contests. No root is a direct swap or an already-confirmed vacated follow.",
    decision:
      "Keep production fail-closed for same-target, swap, and stun-affected contests. The pinned simulator is one finite rule world, not official truth; next consume only conclusions invariant across explicit rule variants." };
  const lines = records.map(JSON.stringify).join("\n");
  const rootsBytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_JOINT_MOVEMENT_ORACLE_MANIFEST_V1",
    status: overview.status, sourceDirectory, labelDirectory,
    sourceManifestSha256: sha256Bytes(sourceManifestBytes),
    sourceOverviewSha256: sha256Bytes(sourceOverviewBytes),
    sourceMatchesSha256: sha256Bytes(source.bytes),
    labelManifestSha256: sha256Bytes(labelManifestBytes),
    officialEvidenceSha256: sha256Bytes(officialBytes),
    staticProbeEvidenceSha256: sha256Bytes(staticProbeBytes),
    simulatorEngineSha256: sha256Bytes(simulatorBytes), productionRootSha256,
    rootsSha256: sha256Bytes(rootsBytes), rootCount: records.length,
    arguments: process.argv.slice(2), fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"), rootsBytes);
  process.stdout.write(JSON.stringify({ output: outputDirectory, overview,
    fingerprint: manifest.fingerprint }, null, 2) + "\n");
  if (!accepted) throw new Error("BP133_JOINT_MOVEMENT_ORACLE_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { compactMovementRecord, summarize, build };
