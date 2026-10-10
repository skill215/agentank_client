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
const { VARIANT_COMMON_STATUS } = require(
  "./semantic-attack-depth3-move-variant-shadow");
const { allZero } = require(
  "./semantic-attack-depth3-transition-support-report");

const RELATION_NAME = Object.freeze({
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
  const envelope = root.comparison.moveVariantEnvelope;
  if (!envelope) return null;
  return { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_MOVE_VARIANT_ROOT_V1",
    key: root.key, scenarioFingerprint: root.scenarioFingerprint,
    candidateSeat: root.candidateSeat, frame: root.comparison.frame,
    geometry: label?.geometry || "UNKNOWN",
    outcomeRelation: label?.outcomeRelation || "UNKNOWN",
    paretoRelation: label?.paretoRelation || "UNKNOWN",
    commonStatus: envelope.commonStatus,
    commonRelation: RELATION_NAME[envelope.commonRelation] || "INCOMPLETE",
    variants: envelope.variants };
}

function summarize(records) {
  const output = { rootCount: records.length, commonStatus: {},
    commonRelation: {}, outcomeByRelation: {}, paretoByRelation: {},
    geometryByRelation: {}, incompleteVariantCells: 0,
    variantValueDisagreementRoots: 0 };
  for (const record of records) {
    increment(output.commonStatus, record.commonStatus);
    increment(output.commonRelation, record.commonRelation);
    for (const [target, key] of [[output.outcomeByRelation,
      record.outcomeRelation], [output.paretoByRelation, record.paretoRelation],
    [output.geometryByRelation, record.geometry]]) {
      const bucket = target[record.commonRelation] ||
        (target[record.commonRelation] = {});
      increment(bucket, key);
    }
    let baseline = null; let candidate = null;
    for (const variant of record.variants) {
      if (!variant.complete) output.incompleteVariantCells += 1;
      if (baseline === null) { baseline = variant.baselineValue;
        candidate = variant.candidateValue; }
      else if (baseline !== variant.baselineValue ||
          candidate !== variant.candidateValue)
        output.variantValueDisagreementRoots += 1;
    }
  }
  return output;
}

function aggregateRuntime(matches) {
  const output = { attempts: 0, complete: 0, agreement: 0,
    disagreement: 0, restoreFailures: 0, hotAllocations: 0, variants: {} };
  for (const match of matches) {
    const value = match.candidateEngine?.semanticAttackPolicyIntervalShadow
      ?.depthMoveVariant || match.candidate?.semanticAttackPolicyIntervalShadow
        ?.depthMoveVariant;
    if (!value) continue;
    output.attempts += value.attemptCount;
    output.complete += value.completeAcrossVariantsCount;
    output.agreement += value.agreementCount;
    output.disagreement += value.disagreementCount;
    output.restoreFailures += value.rootRestoreFailureCount;
    output.hotAllocations += value.hotAllocationCount;
    for (const variant of value.variants) {
      const target = output.variants[variant.name] ||
        (output.variants[variant.name] = { nodes: 0, transitions: 0,
          contestKindCount: [0, 0, 0, 0, 0, 0], relationCount: {
            incomplete: 0, candidateHigher: 0, equal: 0,
            candidateLower: 0 } });
      target.nodes += variant.totalNodes;
      target.transitions += variant.variantTransitionCount;
      for (let at = 0; at < variant.contestKindCount.length; at += 1)
        target.contestKindCount[at] += variant.contestKindCount[at];
      for (const key of Object.keys(target.relationCount))
        target.relationCount[key] += variant.relationCount[key];
    }
  }
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp134-depth3-move-variant-shadow-v2")));
  const labelDirectory = path.resolve(option("--labels", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp133-semantic-attack-joint-movement-oracle")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp134-semantic-attack-depth3-move-variant")));
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
  const summary = summarize(records);
  const runtime = aggregateRuntime(source.matches);
  const sourceManifestBytes = fs.readFileSync(path.join(sourceDirectory,
    "manifest.json"));
  const sourceOverviewBytes = fs.readFileSync(path.join(sourceDirectory,
    "overview.json"));
  const labelManifestBytes = fs.readFileSync(path.join(labelDirectory,
    "manifest.json"));
  const sourceManifest = JSON.parse(sourceManifestBytes);
  const sourceOverview = JSON.parse(sourceOverviewBytes);
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const productionRootSha256 = sha256Bytes(fs.readFileSync(productionFile));
  const behaviorNeutral = allZero(sourceOverview.comparison);
  const variantNames = ["SEQUENTIAL_BLOCK", "INTENT_BLOCK", "COLLISION_CRASH"];
  const variantRuntimeAccepted = variantNames.every(name => {
    const value = runtime.variants[name];
    return value && value.transitions === 182 &&
      value.contestKindCount[2] === 149 && value.contestKindCount[3] === 1 &&
      value.contestKindCount[4] === 32 && value.relationCount.incomplete === 0;
  });
  const accepted = extracted.roots.length === 211 && records.length === 35 &&
    labels.records.length === 35 && missingLabelCount === 0 &&
    summary.commonStatus[VARIANT_COMMON_STATUS.AGREEMENT] === 35 &&
    summary.commonRelation.CANDIDATE_HIGHER === 17 &&
    summary.commonRelation.EQUAL === 9 &&
    summary.commonRelation.CANDIDATE_LOWER === 9 &&
    summary.incompleteVariantCells === 0 &&
    summary.variantValueDisagreementRoots === 0 && runtime.attempts === 35 &&
    runtime.complete === 35 && runtime.agreement === 35 &&
    runtime.disagreement === 0 && runtime.restoreFailures === 0 &&
    runtime.hotAllocations === 0 && variantRuntimeAccepted && behaviorNeutral &&
    productionRootSha256 === sourceManifest.source?.productionRootSha256;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_MOVE_VARIANT_OVERVIEW_V1",
    status: accepted ? "ACCEPT_VARIANT_INVARIANT_RELATIONS" : "REJECTED",
    sourceMatchCount: source.matches.length,
    sourceComparisonRootCount: extracted.roots.length,
    labelRootCount: labels.records.length, missingLabelCount,
    behaviorNeutral, productionChanged: false, ...summary, runtime,
    diagnosis:
      "All 35 former fail-closed roots complete in all three explicit movement worlds. Each world executes 182 contested transitions, yet root values and relations remain identical: 17 candidate-higher, 9 equal, 9 candidate-lower.",
    directionFinding:
      "Rule-invariant scalar direction is still historically inverted: the 17 candidate-higher roots contain zero candidate-better outcomes and two incumbent-better outcomes, while the 9 candidate-lower roots contain both candidate-better outcomes.",
    decision:
      "Accept the three-world envelope as a completeness tool, but reject its scalar relation as action ownership. The remaining defect is leaf/backup value semantics, not movement-rule uncertainty or search scale." };
  const lines = records.map(JSON.stringify).join("\n");
  const rootsBytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_MOVE_VARIANT_MANIFEST_V1",
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
  if (!accepted) throw new Error("BP134_MOVE_VARIANT_REPORT_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { RELATION_NAME, compactRecord, summarize,
  aggregateRuntime, build };
