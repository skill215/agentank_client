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
const { POINTWISE_RELATION, SUPPORT_CLASS, NORMALIZATION_MODE } = require(
  "./semantic-attack-depth3-response-matrix-shadow");
const { allZero } = require(
  "./semantic-attack-depth3-transition-support-report");

const POINTWISE_NAME = Object.freeze(Object.fromEntries(Object.entries(
  POINTWISE_RELATION).map(([name, value]) => [value, name])));
const SUPPORT_NAME = Object.freeze(Object.fromEntries(Object.entries(
  SUPPORT_CLASS).map(([name, value]) => [value, name])));
const NORMALIZATION_NAME = Object.freeze(Object.fromEntries(Object.entries(
  NORMALIZATION_MODE).map(([name, value]) => [value, name])));

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function readGzipRecords(file) {
  const bytes = fs.readFileSync(file);
  const text = zlib.gunzipSync(bytes).toString("utf8").trim();
  return { bytes, records: text ? text.split("\n").map(JSON.parse) : [] };
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function compactRecord(root, label) {
  const envelope = root.comparison.responseMatrixEnvelope;
  if (!envelope) return null;
  return { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_RESPONSE_MATRIX_ROOT_V1",
    key: root.key, scenarioFingerprint: root.scenarioFingerprint,
    candidateSeat: root.candidateSeat, frame: root.comparison.frame,
    currentAction: root.comparison.currentAction,
    candidateAction: root.comparison.candidateAction,
    outcomeRelation: label?.outcomeRelation || "UNKNOWN",
    paretoRelation: label?.paretoRelation || "UNKNOWN",
    risk: envelope.risk, stateClass: envelope.stateClass,
    contextClass: envelope.contextClass,
    variants: envelope.variants.map(variant => ({ name: variant.name,
      complete: variant.complete, enemyCount: variant.enemyCount,
      pointwiseRelation: POINTWISE_NAME[variant.pointwiseRelation] || "INCOMPLETE",
      normalizationMode: NORMALIZATION_NAME[variant.normalizationMode] ||
        "IDENTITY",
      normalizationCollisionCount: variant.normalizationCollisionCount,
      lanes: variant.lanes.map(lane => ({ name: lane.name,
        status: lane.status, boundKind: lane.boundKind,
        candidateProbability: lane.candidateProbability,
        supportClass: SUPPORT_NAME[lane.supportClass] || "INCOMPLETE",
        stageLower: lane.stageLower, stageUpper: lane.stageUpper,
        gap: lane.gap })) })) };
}

function sameVariant(left, right) {
  return left.complete === right.complete &&
    left.enemyCount === right.enemyCount &&
    left.pointwiseRelation === right.pointwiseRelation &&
    left.normalizationMode === right.normalizationMode &&
    left.normalizationCollisionCount === right.normalizationCollisionCount &&
    JSON.stringify(left.lanes) === JSON.stringify(right.lanes);
}

function summarize(records) {
  const output = { rootCount: records.length, incompleteRootCount: 0,
    crossWorldMismatchCount: 0, normalizationCollisionCount: 0,
    normalization: {}, pointwise: {}, byOutcome: {}, solver: {} };
  for (const record of records) {
    const first = record.variants[0];
    if (!record.variants.every(variant => variant.complete))
      output.incompleteRootCount += 1;
    for (let variant = 1; variant < record.variants.length; variant += 1)
      if (!sameVariant(first, record.variants[variant]))
        output.crossWorldMismatchCount += 1;
    increment(output.pointwise, first.pointwiseRelation);
    const outcome = output.byOutcome[record.outcomeRelation] ||
      (output.byOutcome[record.outcomeRelation] = { pointwise: {}, lanes: {} });
    increment(outcome.pointwise, first.pointwiseRelation);
    for (const variant of record.variants) {
      increment(output.normalization, variant.normalizationMode);
      output.normalizationCollisionCount +=
        variant.normalizationCollisionCount || 0;
      for (const lane of variant.lanes) {
        const solver = output.solver[lane.name] ||
          (output.solver[lane.name] = { status: {}, boundKind: {},
            maximumGap: 0 });
        increment(solver.status, String(lane.status));
        increment(solver.boundKind, String(lane.boundKind));
        solver.maximumGap = Math.max(solver.maximumGap, lane.gap);
      }
    }
    for (const lane of first.lanes) {
      const target = outcome.lanes[lane.name] ||
        (outcome.lanes[lane.name] = { support: {}, probabilities: [] });
      increment(target.support, lane.supportClass);
      target.probabilities.push(lane.candidateProbability);
    }
  }
  return output;
}

function aggregateRuntime(matches) {
  const output = { attempts: 0, complete: 0, incomplete: 0,
    variantDisagreements: 0, hotAllocations: 0 };
  for (const match of matches) {
    const value = match.candidateEngine?.semanticAttackPolicyIntervalShadow
      ?.depthResponseMatrix || match.candidate?.semanticAttackPolicyIntervalShadow
        ?.depthResponseMatrix;
    if (!value) continue;
    output.attempts += value.attemptCount;
    output.complete += value.completeCount;
    output.incomplete += value.incompleteCount;
    output.variantDisagreements += value.variantDisagreementCount;
    output.hotAllocations += value.hotAllocationCount;
  }
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp136-depth3-response-matrix-shadow")));
  const labelDirectory = path.resolve(option("--labels", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp133-semantic-attack-joint-movement-oracle")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp136-semantic-attack-depth3-response-matrix")));
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
  const outcome = summary.byOutcome;
  const accepted = extracted.roots.length === 211 && records.length === 35 &&
    labels.records.length === 35 && missingLabelCount === 0 &&
    summary.incompleteRootCount === 0 &&
    summary.crossWorldMismatchCount === 0 &&
    summary.normalizationCollisionCount === 0 &&
    summary.normalization.IDENTITY === 99 &&
    summary.normalization.SCALE === 6 &&
    outcome.INCUMBENT_BETTER?.lanes.RAW?.support.FULL === 2 &&
    outcome.INCUMBENT_BETTER?.lanes.ROBUST?.support.FULL === 1 &&
    outcome.INCUMBENT_BETTER?.lanes.ROBUST?.support.MIXED === 1 &&
    outcome.CANDIDATE_BETTER?.lanes.RAW?.support.MIXED === 2 &&
    outcome.CANDIDATE_BETTER?.lanes.ROBUST?.support.MIXED === 2 &&
    runtime.attempts === 35 && runtime.complete === 35 &&
    runtime.incomplete === 0 && runtime.variantDisagreements === 0 &&
    runtime.hotAllocations === 0 && allZero(sourceOverview.comparison) &&
    productionRootSha256 === sourceManifest.source?.productionRootSha256;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_RESPONSE_MATRIX_OVERVIEW_V1",
    status: accepted ? "ACCEPT_RESPONSE_QUANTIFIER_MISALIGNMENT_CLASSIFIED" :
      "REJECTED",
    sourceMatchCount: source.matches.length,
    sourceComparisonRootCount: extracted.roots.length,
    labelRootCount: labels.records.length, missingLabelCount,
    behaviorNeutral: allZero(sourceOverview.comparison), productionChanged: false,
    ...summary, runtime,
    diagnosis:
      "A shared 2xN simultaneous matrix does not repair the historical direction. Both historical improvements receive only mixed support, while both historical regressions give the candidate full raw-equilibrium support.",
    riskFinding:
      "Epsilon-contamination moves only one regression from full support to a 9988/10000 mixed policy; it does not reject either false positive. Both true improvements remain mixed.",
    decision:
      "Reject common StageMatrix support as an action certificate. The next experiment must condition enemy response evidence on observable controller state and separate verified attack progress from the leaf ATTACK scalar; no production owner is enabled." };
  const lines = records.map(JSON.stringify).join("\n");
  const rootsBytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_RESPONSE_MATRIX_MANIFEST_V1",
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
  if (!accepted) throw new Error("BP136_RESPONSE_MATRIX_REPORT_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { POINTWISE_NAME, SUPPORT_NAME, NORMALIZATION_NAME,
  compactRecord, sameVariant, summarize, aggregateRuntime, build };
