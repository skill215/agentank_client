#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { readMatches } = require("./semantic-attack-certificate-root-corpus");
const { extractComparisons } = require(
  "./semantic-attack-comparison-root-corpus");
const { PAIR_RELATION } = require("./native-attack-pose-policy-search-poc");
const { LEAF_LANE_NAME } = require(
  "./semantic-attack-depth3-leaf-backup-shadow");
const { VARIANT_COMMON_STATUS } = require(
  "./semantic-attack-depth3-move-variant-shadow");
const { allZero } = require(
  "./semantic-attack-depth3-transition-support-report");

const RELATION_NAME = Object.freeze({
  [PAIR_RELATION.INCOMPLETE]: "INCOMPLETE",
  [PAIR_RELATION.CANDIDATE_HIGHER]: "CANDIDATE_HIGHER",
  [PAIR_RELATION.EQUAL]: "EQUAL",
  [PAIR_RELATION.CANDIDATE_LOWER]: "CANDIDATE_LOWER"
});

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function readGzipRecords(file) {
  const bytes = fs.readFileSync(file);
  const text = zlib.gunzipSync(bytes).toString("utf8").trim();
  return { bytes, records: text ? text.split("\n").map(JSON.parse) : [] };
}

function compactRecord(root, label) {
  const envelope = root.comparison.leafBackupEnvelope;
  const movement = root.comparison.moveVariantEnvelope;
  if (!envelope) return null;
  let fullParity = Boolean(movement);
  if (movement) {
    const full = envelope.lanes[0];
    for (let variant = 0; variant < full.variants.length; variant += 1) {
      const left = full.variants[variant]; const right = movement.variants[variant];
      if (left.relation !== right.relation ||
          left.baselineValue !== right.baselineValue ||
          left.candidateValue !== right.candidateValue) fullParity = false;
    }
  }
  return { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_LEAF_BACKUP_ROOT_V1",
    key: root.key, scenarioFingerprint: root.scenarioFingerprint,
    candidateSeat: root.candidateSeat, frame: root.comparison.frame,
    geometry: label?.geometry || "UNKNOWN",
    outcomeRelation: label?.outcomeRelation || "UNKNOWN",
    paretoRelation: label?.paretoRelation || "UNKNOWN",
    fullParity, lanes: envelope.lanes.map(lane => ({ name: lane.name,
      commonStatus: lane.commonStatus,
      commonRelation: RELATION_NAME[lane.commonRelation],
      variants: lane.variants })), backup: envelope.backup };
}

function relationBucket() {
  return { relation: {}, byOutcome: {}, transitionsFromFull: {},
    incompleteRoots: 0, disagreementRoots: 0 };
}

function summarize(records) {
  const output = { rootCount: records.length, fullParityMismatchCount: 0,
    lanes: {}, backup: { meanRelation: {}, maximinToMean: {}, byOutcome: {},
      columnPattern: {}, relationVariantDisagreementRoots: 0,
      valueVariantDisagreementRoots: 0,
      columnVariantDisagreementRoots: 0 } };
  for (const name of LEAF_LANE_NAME) output.lanes[name] = relationBucket();
  for (const record of records) {
    if (!record.fullParity) output.fullParityMismatchCount += 1;
    const fullRelation = record.lanes[0].commonRelation;
    for (const lane of record.lanes) {
      const target = output.lanes[lane.name] ||
        (output.lanes[lane.name] = relationBucket());
      increment(target.relation, lane.commonRelation);
      if (lane.commonStatus === VARIANT_COMMON_STATUS.INCOMPLETE)
        target.incompleteRoots += 1;
      else if (lane.commonStatus === VARIANT_COMMON_STATUS.DISAGREEMENT)
        target.disagreementRoots += 1;
      const outcome = target.byOutcome[record.outcomeRelation] ||
        (target.byOutcome[record.outcomeRelation] = {});
      increment(outcome, lane.commonRelation);
      increment(target.transitionsFromFull,
        `${fullRelation}->${lane.commonRelation}`);
    }
    const first = record.backup[0]; const mean = RELATION_NAME[first.meanRelation];
    increment(output.backup.meanRelation, mean);
    increment(output.backup.maximinToMean, `${fullRelation}->${mean}`);
    const pattern = `${first.columnHigher}/${first.columnEqual}/${first.columnLower}`;
    increment(output.backup.columnPattern, pattern);
    const outcome = output.backup.byOutcome[record.outcomeRelation] ||
      (output.backup.byOutcome[record.outcomeRelation] = {
        maximin: {}, mean: {}, columnPattern: {} });
    increment(outcome.maximin, fullRelation); increment(outcome.mean, mean);
    increment(outcome.columnPattern, pattern);
    for (let variant = 1; variant < record.backup.length; variant += 1) {
      const current = record.backup[variant];
      if (current.meanRelation !== first.meanRelation)
        output.backup.relationVariantDisagreementRoots += 1;
      if (current.baselineMean !== first.baselineMean ||
          current.candidateMean !== first.candidateMean)
        output.backup.valueVariantDisagreementRoots += 1;
      if (current.columnHigher !== first.columnHigher ||
          current.columnEqual !== first.columnEqual ||
          current.columnLower !== first.columnLower)
        output.backup.columnVariantDisagreementRoots += 1;
    }
  }
  return output;
}

function aggregateRuntime(matches) {
  const output = { attempts: 0, restoreFailures: 0, hotAllocations: 0,
    lanes: {} };
  for (const match of matches) {
    const value = match.candidateEngine?.semanticAttackPolicyIntervalShadow
      ?.depthLeafBackup || match.candidate?.semanticAttackPolicyIntervalShadow
        ?.depthLeafBackup;
    if (!value) continue;
    output.attempts += value.attemptCount;
    output.restoreFailures += value.rootRestoreFailureCount;
    output.hotAllocations += value.hotAllocationCount;
    for (const lane of value.lanes) {
      const target = output.lanes[lane.name] ||
        (output.lanes[lane.name] = { complete: 0, agreement: 0,
          disagreement: 0, relationCount: { incomplete: 0,
            candidateHigher: 0, equal: 0, candidateLower: 0 },
          nodes: [0, 0, 0] });
      target.complete += lane.completeCount;
      target.agreement += lane.agreementCount;
      target.disagreement += lane.disagreementCount;
      for (const key of Object.keys(target.relationCount))
        target.relationCount[key] += lane.relationCount[key];
      for (let variant = 0; variant < lane.variants.length; variant += 1)
        target.nodes[variant] += lane.variants[variant].totalNodes;
    }
  }
  return output;
}

function exactLane(runtime, name, higher, equal, lower) {
  const lane = runtime.lanes[name];
  return lane && lane.complete === 35 && lane.agreement === 35 &&
    lane.disagreement === 0 && lane.relationCount.incomplete === 0 &&
    lane.relationCount.candidateHigher === higher &&
    lane.relationCount.equal === equal &&
    lane.relationCount.candidateLower === lower;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp135-depth3-leaf-backup-shadow")));
  const labelDirectory = path.resolve(option("--labels", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp133-semantic-attack-joint-movement-oracle")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp135-semantic-attack-depth3-leaf-backup")));
  const source = readMatches(sourceDirectory);
  const extracted = extractComparisons(source.matches);
  const labels = readGzipRecords(path.join(labelDirectory, "roots.ndjson.gz"));
  const labelByKey = new Map(labels.records.map(item => [item.key, item]));
  const records = []; let missingLabelCount = 0;
  for (const item of extracted.roots) {
    const record = compactRecord(item, labelByKey.get(item.key));
    if (!record) continue;
    if (!labelByKey.has(item.key)) missingLabelCount += 1;
    records.push(record);
  }
  const summary = summarize(records); const runtime = aggregateRuntime(source.matches);
  const sourceManifestBytes = fs.readFileSync(path.join(sourceDirectory,
    "manifest.json"));
  const sourceOverviewBytes = fs.readFileSync(path.join(sourceDirectory,
    "overview.json"));
  const labelManifestBytes = fs.readFileSync(path.join(labelDirectory,
    "manifest.json"));
  const sourceManifest = JSON.parse(sourceManifestBytes);
  const sourceOverview = JSON.parse(sourceOverviewBytes);
  const productionRootSha256 = sha256Bytes(fs.readFileSync(path.join(root,
    "engine-v2", "src", "runtime", "production-root.js")));
  const allLanesComplete = LEAF_LANE_NAME.every(name => {
    const lane = runtime.lanes[name];
    return lane && lane.complete === 35 && lane.agreement === 35 &&
      lane.disagreement === 0 && lane.relationCount.incomplete === 0;
  });
  const behaviorNeutral = allZero(sourceOverview.comparison);
  const accepted = extracted.roots.length === 211 && records.length === 35 &&
    labels.records.length === 35 && missingLabelCount === 0 &&
    summary.fullParityMismatchCount === 0 && allLanesComplete &&
    exactLane(runtime, "FULL", 17, 9, 9) &&
    exactLane(runtime, "NO_STAR", 17, 9, 9) &&
    exactLane(runtime, "NO_ATTACK", 8, 19, 8) &&
    exactLane(runtime, "ZERO_LEAF", 0, 34, 1) &&
    summary.backup.relationVariantDisagreementRoots === 0 &&
    summary.backup.valueVariantDisagreementRoots === 0 &&
    summary.backup.columnVariantDisagreementRoots === 0 &&
    summary.backup.byOutcome.INCUMBENT_BETTER?.maximin
      ?.CANDIDATE_HIGHER === 2 &&
    summary.backup.byOutcome.INCUMBENT_BETTER?.mean
      ?.CANDIDATE_HIGHER === 2 &&
    summary.backup.byOutcome.CANDIDATE_BETTER?.maximin
      ?.CANDIDATE_LOWER === 2 &&
    summary.backup.byOutcome.CANDIDATE_BETTER?.mean
      ?.CANDIDATE_HIGHER === 2 && runtime.attempts === 35 &&
    runtime.restoreFailures === 0 && runtime.hotAllocations === 0 &&
    behaviorNeutral && productionRootSha256 ===
      sourceManifest.source?.productionRootSha256;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_LEAF_BACKUP_OVERVIEW_V1",
    status: accepted ? "ACCEPT_LEAF_BACKUP_CAUSES_CLASSIFIED" : "REJECTED",
    sourceMatchCount: source.matches.length,
    sourceComparisonRootCount: extracted.roots.length,
    labelRootCount: labels.records.length, missingLabelCount,
    behaviorNeutral, productionChanged: false, ...summary, runtime,
    diagnosis:
      "FULL exactly reproduces BP134. NO_STAR is identical. Removing ATTACK collapses both historical regressions from candidate-higher to equal, while no single leaf family recovers both historical improvements.",
    backupFinding:
      "Both historical improvements are maximin candidate-lower but uniform-response-mean candidate-higher; both have mixed per-response relations. Both regressions remain candidate-higher under maximin and mean.",
    decision:
      "Reject scalar weight tuning and root-mean ownership. BP136 must preserve per-response vectors and separate verified attack progress from opponent-policy quantification before any action proposal." };
  const lines = records.map(JSON.stringify).join("\n");
  const rootsBytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_LEAF_BACKUP_MANIFEST_V1",
    status: overview.status, sourceDirectory, labelDirectory,
    sourceManifestSha256: sha256Bytes(sourceManifestBytes),
    sourceOverviewSha256: sha256Bytes(sourceOverviewBytes),
    sourceMatchesSha256: sha256Bytes(source.bytes),
    labelManifestSha256: sha256Bytes(labelManifestBytes),
    labelRootsSha256: sha256Bytes(labels.bytes), productionRootSha256,
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
  if (!accepted) throw new Error("BP135_LEAF_BACKUP_REPORT_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { RELATION_NAME, compactRecord, summarize,
  aggregateRuntime, exactLane, build };
