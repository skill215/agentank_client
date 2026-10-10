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

function relation(value) {
  return value > 0 ? "CANDIDATE_HIGHER" :
    value < 0 ? "CANDIDATE_LOWER" : "EQUAL";
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function candidateMatches(matches) {
  const output = new Map();
  for (const match of matches)
    if (match.candidateEngine?.semanticAttackPolicyIntervalShadow
        ?.responseConditioned)
      output.set(`${match.scenarioFingerprint}|${match.candidateSeat}`, match);
  return output;
}

function variantsEqual(left, right) {
  const normalize = value => ({ ...value, name: "" });
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function compactRecord(root, label, match) {
  const envelope = root.comparison.responseConditionedEnvelope;
  if (!envelope || !match) return null;
  const actions = Buffer.from(match.control?.compactActionStream || "", "base64");
  const historicalAction = actions[root.comparison.frame];
  const columns = [];
  for (let column = 0; column < envelope.enemyActions.length; column += 1)
    if (envelope.enemyActions[column] === historicalAction) columns.push(column);
  const historicalColumn = columns.length === 1 ? columns[0] : -1;
  const first = envelope.variants[0];
  let historicalFullDelta = 0; let historicalNoAttackDelta = 0;
  let historicalAttackContribution = 0; let historicalNominalMass = 0;
  if (historicalColumn >= 0) {
    historicalFullDelta = first.fullCandidate[historicalColumn] -
      first.fullBaseline[historicalColumn];
    historicalNoAttackDelta = first.noAttackCandidate[historicalColumn] -
      first.noAttackBaseline[historicalColumn];
    historicalAttackContribution = historicalFullDelta -
      historicalNoAttackDelta;
    historicalNominalMass = envelope.nominalProbability[historicalColumn];
  }
  const maximumNominal = Math.max(...envelope.nominalProbability);
  const minimumNominal = Math.min(...envelope.nominalProbability);
  return { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_RESPONSE_CONDITIONED_ROOT_V1",
    key: root.key, scenarioFingerprint: root.scenarioFingerprint,
    candidateSeat: root.candidateSeat, frame: root.comparison.frame,
    outcomeRelation: label?.outcomeRelation || "UNKNOWN",
    paretoRelation: label?.paretoRelation || "UNKNOWN",
    currentAction: root.comparison.currentAction,
    candidateAction: root.comparison.candidateAction,
    verifiedStructuralProgress: envelope.verifiedStructuralProgress,
    enemyActions: envelope.enemyActions,
    enemyArguments: envelope.enemyArguments,
    nominalProbability: envelope.nominalProbability,
    nominalSpread: maximumNominal - minimumNominal,
    historicalAction, historicalColumns: columns, historicalColumn,
    historicalNominalMass, historicalFullDelta, historicalNoAttackDelta,
    historicalAttackContribution,
    variants: envelope.variants };
}

function emptyOutcome() {
  return { count: 0, verifiedStructuralProgress: 0,
    historicalFull: {}, historicalNoAttack: {}, historicalAttack: {},
    nominalFull: {}, nominalNoAttack: {}, nominalAttack: {},
    historicalNominalMass: 0 };
}

function summarize(records) {
  const output = { rootCount: records.length, uniqueHistoricalColumnCount: 0,
    ambiguousHistoricalColumnCount: 0, missingHistoricalColumnCount: 0,
    completeRootCount: 0, crossWorldMismatchCount: 0,
    nearUniformNominalCount: 0, byOutcome: {} };
  for (const record of records) {
    if (record.historicalColumns.length === 1)
      output.uniqueHistoricalColumnCount += 1;
    else if (record.historicalColumns.length > 1)
      output.ambiguousHistoricalColumnCount += 1;
    else output.missingHistoricalColumnCount += 1;
    if (record.variants.every(variant => variant.complete))
      output.completeRootCount += 1;
    const first = record.variants[0];
    for (let variant = 1; variant < record.variants.length; variant += 1)
      if (!variantsEqual(first, record.variants[variant]))
        output.crossWorldMismatchCount += 1;
    if (record.nominalSpread <= 1) output.nearUniformNominalCount += 1;
    const target = output.byOutcome[record.outcomeRelation] ||
      (output.byOutcome[record.outcomeRelation] = emptyOutcome());
    target.count += 1;
    if (record.verifiedStructuralProgress)
      target.verifiedStructuralProgress += 1;
    increment(target.historicalFull, relation(record.historicalFullDelta));
    increment(target.historicalNoAttack,
      relation(record.historicalNoAttackDelta));
    increment(target.historicalAttack,
      relation(record.historicalAttackContribution));
    increment(target.nominalFull, relation(first.fullExpectedDelta));
    increment(target.nominalNoAttack, relation(first.noAttackExpectedDelta));
    increment(target.nominalAttack,
      relation(first.attackExpectedContribution));
    target.historicalNominalMass += record.historicalNominalMass;
  }
  return output;
}

function aggregateRuntime(matches) {
  const output = { attempts: 0, complete: 0, incomplete: 0,
    verifiedStructuralProgress: 0, hotAllocations: 0 };
  for (const match of matches) {
    const value = match.candidateEngine?.semanticAttackPolicyIntervalShadow
      ?.responseConditioned;
    if (!value) continue;
    output.attempts += value.attemptCount;
    output.complete += value.completeCount;
    output.incomplete += value.incompleteCount;
    output.verifiedStructuralProgress += value.verifiedStructuralProgressCount;
    output.hotAllocations += value.hotAllocationCount;
  }
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp137-response-conditioned-shadow")));
  const labelDirectory = path.resolve(option("--labels", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp133-semantic-attack-joint-movement-oracle")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp137-semantic-attack-response-conditioned")));
  const source = readMatches(sourceDirectory);
  const extracted = extractComparisons(source.matches);
  const matches = candidateMatches(source.matches);
  const labels = readGzipRecords(path.join(labelDirectory, "roots.ndjson.gz"));
  const labelByKey = new Map(labels.records.map(item => [item.key, item]));
  const records = []; let missingLabelCount = 0; let missingMatchCount = 0;
  for (const item of extracted.roots) {
    const match = matches.get(`${item.scenarioFingerprint}|${item.candidateSeat}`);
    const record = compactRecord(item, labelByKey.get(item.key), match);
    if (!item.comparison.responseConditionedEnvelope) continue;
    if (!labelByKey.has(item.key)) missingLabelCount += 1;
    if (!match) { missingMatchCount += 1; continue; }
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
  const better = summary.byOutcome.CANDIDATE_BETTER;
  const worse = summary.byOutcome.INCUMBENT_BETTER;
  const accepted = extracted.roots.length === 211 && records.length === 35 &&
    labels.records.length === 35 && missingLabelCount === 0 &&
    missingMatchCount === 0 && summary.uniqueHistoricalColumnCount === 35 &&
    summary.ambiguousHistoricalColumnCount === 0 &&
    summary.missingHistoricalColumnCount === 0 &&
    summary.completeRootCount === 35 && summary.crossWorldMismatchCount === 0 &&
    summary.nearUniformNominalCount === 35 &&
    better?.verifiedStructuralProgress === 1 &&
    worse?.verifiedStructuralProgress === 0 &&
    better?.historicalFull.CANDIDATE_HIGHER === 2 &&
    worse?.historicalFull.CANDIDATE_HIGHER === 2 &&
    better?.historicalNoAttack.EQUAL === 2 &&
    worse?.historicalNoAttack.EQUAL === 2 &&
    better?.historicalAttack.CANDIDATE_HIGHER === 2 &&
    worse?.historicalAttack.CANDIDATE_HIGHER === 2 &&
    runtime.attempts === 35 && runtime.complete === 35 &&
    runtime.incomplete === 0 && runtime.hotAllocations === 0 &&
    allZero(sourceOverview.comparison) && productionRootSha256 ===
      sourceManifest.source?.productionRootSha256;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_RESPONSE_CONDITIONED_OVERVIEW_V1",
    status: accepted ? "ACCEPT_ONE_STEP_RESPONSE_LIMIT_CLASSIFIED" : "REJECTED",
    sourceMatchCount: source.matches.length,
    sourceComparisonRootCount: extracted.roots.length,
    labelRootCount: labels.records.length, missingLabelCount, missingMatchCount,
    behaviorNeutral: allZero(sourceOverview.comparison), productionChanged: false,
    ...summary, runtime,
    diagnosis:
      "Every historical opponent action maps to one searched column, but both improvements and both regressions are candidate-higher on that realized next action. Their advantage disappears in NO_ATTACK, so all four directions are manufactured by the ATTACK leaf family at one-step response scope.",
    modelFinding:
      "All 35 observable opponent nominal policies are uniform within one probability unit. The current match model therefore contributes almost no root-conditioned discrimination on this corpus.",
    certificateFinding:
      "Removing generic route progress from the verified objective leaves one historical improvement and zero regressions with structural muzzle/escape/exposure progress. This is precise but covers only one of two improvements.",
    decision:
      "Keep structural attack progress as a strict Shadow certificate. Reject one-step realized-response value and the current nominal policy as owners. BP138 must extend the common continuation to a response-conditioned event/deadline horizon; historical actions remain labels only." };
  const lines = records.map(JSON.stringify).join("\n");
  const rootsBytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_RESPONSE_CONDITIONED_MANIFEST_V1",
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
  if (!accepted) throw new Error("BP137_RESPONSE_CONDITIONED_REPORT_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { relation, candidateMatches, variantsEqual, compactRecord,
  summarize, aggregateRuntime, build };
