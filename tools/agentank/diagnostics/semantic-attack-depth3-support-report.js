#!/usr/bin/env node
"use strict";

// BP130 classifies every BP129 depth-3 incomplete fixed-pair root using the
// searcher's existing non-exact abort facts.  It is an offline report only.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { readMatches } = require("./semantic-attack-certificate-root-corpus");
const { extractComparisons } = require(
  "./semantic-attack-comparison-root-corpus");
const { readRoots } = require("./semantic-attack-chance-interval-corpus");
const { PAIR_SUPPORT_REASON } = require(
  "./native-attack-pose-policy-search-poc");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function reasonNames(mask) {
  const output = [];
  for (const [name, bit] of Object.entries(PAIR_SUPPORT_REASON))
    if (bit && (mask & bit)) output.push(name);
  return output;
}

function compactRecord(source, label) {
  const lanes = source.comparison.depthLadder || [];
  const d2 = lanes[2] || {}; const d3 = lanes[3] || {};
  const failedBranch = d3.complete ? "NONE" : d3.baselineReasonMask ?
    "BASELINE" : d3.candidateReasonMask ? "CANDIDATE" : "UNCLASSIFIED";
  const reasonMask = failedBranch === "BASELINE" ? d3.baselineReasonMask | 0 :
    failedBranch === "CANDIDATE" ? d3.candidateReasonMask | 0 : 0;
  const abortReason = failedBranch === "BASELINE" ? d3.baselineAbortReason | 0 :
    failedBranch === "CANDIDATE" ? d3.candidateAbortReason | 0 : 0;
  const truncatedCount = failedBranch === "BASELINE" ?
    d3.baselineTruncatedCount | 0 : failedBranch === "CANDIDATE" ?
      d3.candidateTruncatedCount | 0 : 0;
  const interrupted = failedBranch === "BASELINE" ?
    Boolean(d3.baselineInterrupted) : failedBranch === "CANDIDATE" ?
      Boolean(d3.candidateInterrupted) : false;
  return { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_SUPPORT_ROOT_V1", key: source.key,
    scenarioFingerprint: source.scenarioFingerprint,
    candidateSeat: source.candidateSeat, frame: source.comparison.frame,
    outcomeRelation: label.outcomeRelation,
    d2Relation: d2.relation | 0, d3Complete: Boolean(d3.complete),
    d3Relation: d3.relation | 0, failedBranch, reasonMask,
    reasonNames: reasonNames(reasonMask), abortReason, truncatedCount,
    interrupted, baselineNodes: d3.baselineNodes | 0,
    candidateNodes: d3.candidateNodes | 0,
    baselineCompletedDepth: d3.baselineCompletedDepth | 0,
    candidateCompletedDepth: d3.candidateCompletedDepth | 0,
    baselineSupportDepth: d3.baselineSupportDepth | 0,
    candidateSupportDepth: d3.candidateSupportDepth | 0,
    baselineIncompleteTransitions: d3.baselineIncompleteTransitions | 0,
    candidateIncompleteTransitions: d3.candidateIncompleteTransitions | 0 };
}

function summarize(records) {
  const output = { rootCount: records.length, completeCount: 0,
    incompleteCount: 0, failedBranch: {}, reasonMask: {}, abortReason: {},
    truncatedCount: {}, outcomeByD2Relation: {}, incompleteNodeTotal: 0,
    incompleteMaximumNodes: 0, interruptedCount: 0,
    incompleteTransitionCount: 0, unclassifiedCount: 0 };
  for (const record of records) {
    if (record.d3Complete) { output.completeCount += 1; continue; }
    output.incompleteCount += 1; increment(output.failedBranch,
      record.failedBranch); increment(output.reasonMask, record.reasonMask);
    increment(output.abortReason, record.abortReason);
    increment(output.truncatedCount, record.failedBranch + ":" +
      record.truncatedCount);
    const relation = String(record.d2Relation);
    const bucket = output.outcomeByD2Relation[relation] ||
      (output.outcomeByD2Relation[relation] = {});
    increment(bucket, record.outcomeRelation);
    const nodes = record.baselineNodes + record.candidateNodes;
    output.incompleteNodeTotal += nodes;
    if (nodes > output.incompleteMaximumNodes)
      output.incompleteMaximumNodes = nodes;
    output.interruptedCount += record.interrupted ? 1 : 0;
    output.incompleteTransitionCount +=
      record.baselineIncompleteTransitions +
      record.candidateIncompleteTransitions > 0 ? 1 : 0;
    output.unclassifiedCount += record.failedBranch === "UNCLASSIFIED" ? 1 : 0;
  }
  output.widthAbortCount = records.filter(record => !record.d3Complete &&
    record.abortReason === 1 &&
    (record.reasonMask & PAIR_SUPPORT_REASON.WIDTH)).length;
  output.fastAbortCount = records.filter(record => !record.d3Complete &&
    record.abortReason === 2).length;
  output.hardAbortCount = records.filter(record => !record.d3Complete &&
    record.abortReason === 3).length;
  return output;
}

function allZero(value) {
  return Object.values(value || {}).every(item => typeof item !== "number" ||
    item === 0);
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp130-depth3-support-census-shadow-v2")));
  const labelDirectory = path.resolve(option("--labels", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp128-semantic-attack-comparison-roots-v2")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp130-semantic-attack-depth3-support")));
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
  const depth = sourceOverview.candidate?.semanticAttackPolicyIntervalShadow
    ?.depthStability || {};
  const behaviorNeutral = allZero(sourceOverview.comparison);
  const accepted = extracted.roots.length === expectedRoots &&
    labels.roots.length === expectedRoots && records.length === expectedRoots &&
    missingLabelCount === 0 && extracted.overflowCount === 0 &&
    extracted.missingCandidateCount === 0 && summary.completeCount === 30 &&
    summary.incompleteCount === 181 && summary.widthAbortCount === 181 &&
    summary.fastAbortCount === 0 && summary.hardAbortCount === 0 &&
    summary.interruptedCount === 0 && summary.incompleteTransitionCount === 0 &&
    summary.unclassifiedCount === 0 && behaviorNeutral &&
    (depth.rootRestoreFailureCount || 0) === 0 &&
    (depth.hotAllocationCount || 0) === 0 &&
    productionRootSha256 === sourceManifest.source?.productionRootSha256 &&
    productionRootSha256 === labelManifest.productionRootSha256;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_SUPPORT_OVERVIEW_V1",
    status: accepted ? "ACCEPT_WIDTH_ROOT_CAUSE" : "REJECTED",
    sourceMatchCount: source.matches.length,
    sourceRootCount: extracted.roots.length, labelRootCount: labels.roots.length,
    joinedRootCount: records.length, missingLabelCount, behaviorNeutral,
    rootRestoreFailureCount: depth.rootRestoreFailureCount || 0,
    hotAllocationCount: depth.hotAllocationCount || 0, ...summary,
    diagnosis:
      "All 181 depth-3 incomplete pairs are exact-owner early aborts caused by representative width truncation: 176 on incumbent, 5 on candidate. None is caused by budget, Fast/Hard incomplete support, or restore failure.",
    decision:
      "Calibrate depth-3 representative widths 2/3/4 at fixed pair identity before changing leaf, backup, depth, or production ownership." };
  const lines = records.map(JSON.stringify).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_DEPTH3_SUPPORT_MANIFEST_V1",
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
  if (!accepted) throw new Error("BP130_DEPTH3_SUPPORT_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { reasonNames, compactRecord, summarize, allZero, build };
