#!/usr/bin/env node
"use strict";

// BP139 evidence compiler.  It intentionally treats only PROVEN as a
// certificate: a fixed-policy refutation or a frame-cap stop remains UNKNOWN.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { readMatches } = require("./semantic-attack-certificate-root-corpus");
const { extractComparisons } = require(
  "./semantic-attack-comparison-root-corpus");
const { allZero } = require(
  "./semantic-attack-depth3-transition-support-report");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function readGzipRecords(file) {
  const bytes = fs.readFileSync(file);
  const text = zlib.gunzipSync(bytes).toString("utf8").trim();
  return { bytes, records: text ? text.split("\n").map(JSON.parse) : [] };
}

function candidateMatches(matches) {
  const output = new Map();
  for (const match of matches)
    if (match.candidateEngine?.semanticAttackPolicyIntervalShadow?.eventHorizon)
      output.set(`${match.scenarioFingerprint}|${match.candidateSeat}`, match);
  return output;
}

function sideCertified(goals, side) {
  const status = side === "baseline" ? "baselineStatus" : "candidateStatus";
  const support = side === "baseline" ? "baselineSupport" : "candidateSupport";
  return goals.some(goal => goal.variants.every(variant =>
    variant[support] && variant[status] === PROOF_STATUS.PROVEN));
}

function compactRecord(root, label, match) {
  const event = root.comparison.eventHorizonEnvelope;
  if (!event || !match) return null;
  const goals = event.goals.map(goal => ({ name: goal.name,
    commonStatus: goal.commonStatus, commonRelation: goal.commonRelation,
    variants: goal.variants.map(variant => ({ name: variant.name,
      relation: variant.relation,
      baselineStatus: variant.baselineStatus,
      candidateStatus: variant.candidateStatus,
      baselineSupport: variant.baselineSupport,
      candidateSupport: variant.candidateSupport,
      baselineNodes: variant.baselineNodes,
      candidateNodes: variant.candidateNodes })) }));
  const complete = goals.every(goal => goal.variants.every(variant =>
    variant.baselineSupport && variant.candidateSupport));
  return { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_EVENT_HORIZON_ROOT_V1", key: root.key,
    scenarioFingerprint: root.scenarioFingerprint,
    candidateSeat: root.candidateSeat, frame: root.comparison.frame,
    outcomeRelation: label?.outcomeRelation || "UNKNOWN",
    currentAction: root.comparison.currentAction,
    candidateAction: root.comparison.candidateAction,
    complete, baselineCertified: sideCertified(goals, "baseline"),
    candidateCertified: sideCertified(goals, "candidate"), goals };
}

function increment(target, key) { target[key] = (target[key] || 0) + 1; }

function emptyOutcome() {
  return { count: 0, complete: 0, incomplete: 0,
    baselineCertified: 0, candidateCertified: 0, bothCertified: 0,
    neitherCertified: 0 };
}

function summarize(records) {
  const output = { rootCount: records.length, completeRootCount: 0,
    incompleteRootCount: 0, baselineCertifiedRootCount: 0,
    candidateCertifiedRootCount: 0, candidateOnlyCertifiedRootCount: 0,
    baselineOnlyCertifiedRootCount: 0, bothCertifiedRootCount: 0,
    neitherCertifiedRootCount: 0, supportCompleteSearchCount: 0,
    supportIncompleteSearchCount: 0, totalNodes: 0, maximumNodes: 0,
    proofStatus: { baseline: {}, candidate: {} }, relation: {}, byOutcome: {} };
  for (const record of records) {
    if (record.complete) output.completeRootCount += 1;
    else output.incompleteRootCount += 1;
    if (record.baselineCertified) output.baselineCertifiedRootCount += 1;
    if (record.candidateCertified) output.candidateCertifiedRootCount += 1;
    if (record.baselineCertified && record.candidateCertified)
      output.bothCertifiedRootCount += 1;
    else if (record.baselineCertified)
      output.baselineOnlyCertifiedRootCount += 1;
    else if (record.candidateCertified)
      output.candidateOnlyCertifiedRootCount += 1;
    else output.neitherCertifiedRootCount += 1;
    const outcome = output.byOutcome[record.outcomeRelation] ||
      (output.byOutcome[record.outcomeRelation] = emptyOutcome());
    outcome.count += 1;
    outcome[record.complete ? "complete" : "incomplete"] += 1;
    if (record.baselineCertified) outcome.baselineCertified += 1;
    if (record.candidateCertified) outcome.candidateCertified += 1;
    if (record.baselineCertified && record.candidateCertified)
      outcome.bothCertified += 1;
    else if (!record.baselineCertified && !record.candidateCertified)
      outcome.neitherCertified += 1;
    for (const goal of record.goals)
      for (const variant of goal.variants) {
        increment(output.proofStatus.baseline, String(variant.baselineStatus));
        increment(output.proofStatus.candidate, String(variant.candidateStatus));
        increment(output.relation, String(variant.relation));
        output.supportCompleteSearchCount +=
          Number(variant.baselineSupport) + Number(variant.candidateSupport);
        output.supportIncompleteSearchCount +=
          Number(!variant.baselineSupport) + Number(!variant.candidateSupport);
        output.totalNodes += variant.baselineNodes + variant.candidateNodes;
        output.maximumNodes = Math.max(output.maximumNodes,
          variant.baselineNodes, variant.candidateNodes);
      }
  }
  return output;
}

function aggregateRuntime(matches) {
  const output = { attempts: 0, supportComplete: 0, supportIncomplete: 0,
    totalNodes: 0, maximumOwnDomain: 0, ownDomainRestricted: 0,
    restrictedDisproofToUnknown: 0, rootRestoreFailures: 0,
    hotAllocations: 0 };
  for (const match of matches) {
    const value = match.candidateEngine?.semanticAttackPolicyIntervalShadow
      ?.eventHorizon;
    if (!value) continue;
    output.attempts += value.attemptCount;
    output.supportComplete += value.supportCompleteCount;
    output.supportIncomplete += value.supportIncompleteCount;
    output.totalNodes += value.totalNodes;
    output.maximumOwnDomain = Math.max(output.maximumOwnDomain,
      value.maximumOwnDomain || 0);
    output.ownDomainRestricted += value.ownDomainRestrictedCount;
    output.restrictedDisproofToUnknown +=
      value.restrictedDisproofToUnknownCount;
    output.rootRestoreFailures += value.rootRestoreFailureCount;
    output.hotAllocations += value.hotAllocationCount;
  }
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative", "bp139-event-horizon-shadow")));
  const labelDirectory = path.resolve(option("--labels", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp133-semantic-attack-joint-movement-oracle")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp139-semantic-attack-event-horizon")));
  const source = readMatches(sourceDirectory);
  const extracted = extractComparisons(source.matches);
  const matches = candidateMatches(source.matches);
  const labels = readGzipRecords(path.join(labelDirectory, "roots.ndjson.gz"));
  const labelByKey = new Map(labels.records.map(item => [item.key, item]));
  const records = []; let missingLabelCount = 0; let missingMatchCount = 0;
  for (const item of extracted.roots) {
    if (!item.comparison.eventHorizonEnvelope) continue;
    const match = matches.get(`${item.scenarioFingerprint}|${item.candidateSeat}`);
    if (!labelByKey.has(item.key)) missingLabelCount += 1;
    if (!match) { missingMatchCount += 1; continue; }
    records.push(compactRecord(item, labelByKey.get(item.key), match));
  }
  const summary = summarize(records);
  const runtime = aggregateRuntime(source.matches);
  const sourceManifestBytes = fs.readFileSync(path.join(sourceDirectory,
    "manifest.json"));
  const sourceOverviewBytes = fs.readFileSync(path.join(sourceDirectory,
    "overview.json"));
  const sourceManifest = JSON.parse(sourceManifestBytes);
  const sourceOverview = JSON.parse(sourceOverviewBytes);
  const labelManifestBytes = fs.readFileSync(path.join(labelDirectory,
    "manifest.json"));
  const productionRootSha256 = sha256Bytes(fs.readFileSync(path.join(root,
    "engine-v2", "src", "runtime", "production-root.js")));
  const accepted = extracted.roots.length === 211 && records.length === 35 &&
    labels.records.length === 35 && missingLabelCount === 0 &&
    missingMatchCount === 0 && summary.completeRootCount === 30 &&
    summary.incompleteRootCount === 5 &&
    summary.baselineCertifiedRootCount === 0 &&
    summary.candidateCertifiedRootCount === 0 &&
    summary.neitherCertifiedRootCount === 35 &&
    summary.proofStatus.baseline["0"] === 210 &&
    summary.proofStatus.candidate["0"] === 210 &&
    summary.supportCompleteSearchCount === 390 &&
    summary.supportIncompleteSearchCount === 30 &&
    summary.totalNodes === 266310 && summary.maximumNodes === 4096 &&
    runtime.attempts === 35 && runtime.supportComplete === 390 &&
    runtime.supportIncomplete === 30 && runtime.totalNodes === 266310 &&
    runtime.maximumOwnDomain === 1 &&
    runtime.restrictedDisproofToUnknown === 372 &&
    runtime.rootRestoreFailures === 0 && runtime.hotAllocations === 0 &&
    allZero(sourceOverview.comparison) &&
    productionRootSha256 === sourceManifest.source?.productionRootSha256;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_EVENT_HORIZON_OVERVIEW_V1",
    status: accepted ? "ACCEPT_STRICT_EVENT_NOT_DISCRIMINATIVE" : "REJECTED",
    sourceMatchCount: source.matches.length,
    sourceComparisonRootCount: extracted.roots.length,
    labelRootCount: labels.records.length, missingLabelCount, missingMatchCount,
    behaviorNeutral: allZero(sourceOverview.comparison), productionChanged: false,
    ...summary, runtime,
    diagnosis:
      "A depth-4 fixed replanning attack policy has no positive safe-FIRE or doomed-target certificate on any of the 35 directional roots. The strict all-enemy requirement treats a rational refusal to expose as absence of a certificate, so it cannot distinguish the two historical improvements from the two regressions.",
    boundary:
      "PROVEN remains sound because enemy actions and chance outcomes are complete. A fixed-policy refutation is deliberately converted to UNKNOWN because the existential own policy domain is restricted. Increasing depth would spend more work without changing the ownership mismatch.",
    decision:
      "Retain BP139 as a negative strict-certificate diagnostic and do not grant it action ownership. The next comparison must value adversarial refusal itself through a finite-horizon lexicographic payoff or regret interval instead of requiring every enemy response to culminate in FIRE." };
  const lines = records.map(JSON.stringify).join("\n");
  const rootsBytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_EVENT_HORIZON_MANIFEST_V1",
    status: overview.status, sourceDirectory, labelDirectory,
    sourceManifestSha256: sha256Bytes(sourceManifestBytes),
    sourceOverviewSha256: sha256Bytes(sourceOverviewBytes),
    sourceMatchesSha256: sha256Bytes(source.bytes),
    labelManifestSha256: sha256Bytes(labelManifestBytes),
    labelRootsSha256: sha256Bytes(fs.readFileSync(path.join(labelDirectory,
      "roots.ndjson.gz"))), productionRootSha256,
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
  if (!accepted) throw new Error("BP139_EVENT_HORIZON_REPORT_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { sideCertified, compactRecord, summarize,
  aggregateRuntime, build };
