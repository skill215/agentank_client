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
const { expectedLower } = require(
  "./semantic-attack-response-conditioned-shadow");
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

function increment(target, key) { target[key] = (target[key] || 0) + 1; }

function candidateMatches(matches) {
  const output = new Map();
  for (const match of matches)
    if (match.candidateEngine?.semanticAttackPolicyIntervalShadow?.eventDeadline)
      output.set(`${match.scenarioFingerprint}|${match.candidateSeat}`, match);
  return output;
}

function valueSignature(variant) {
  return JSON.stringify({ complete: variant.complete, relation: variant.relation,
    baselineValue: variant.baselineValue,
    candidateValue: variant.candidateValue,
    baselineCells: variant.baselineCells,
    candidateCells: variant.candidateCells });
}

function compactRecord(root, label, match) {
  const event = root.comparison.eventDeadlineEnvelope;
  const response = root.comparison.responseConditionedEnvelope;
  if (!event || !response || !match) return null;
  const actions = Buffer.from(match.control?.compactActionStream || "", "base64");
  const historicalAction = actions[root.comparison.frame]; const columns = [];
  for (let column = 0; column < response.enemyActions.length; column += 1)
    if (response.enemyActions[column] === historicalAction) columns.push(column);
  const historicalColumn = columns.length === 1 ? columns[0] : -1;
  const lanes = event.lanes.map(lane => ({ name: lane.name,
    commonStatus: lane.commonStatus, commonRelation: lane.commonRelation,
    valueWorldAgreement: lane.variants.every(variant =>
      valueSignature(variant) === valueSignature(lane.variants[0])),
    variants: lane.variants.map(variant => {
      const historicalDelta = historicalColumn < 0 ? 0 :
        variant.candidateCells[historicalColumn] -
          variant.baselineCells[historicalColumn];
      const baselineExpected = expectedLower(variant.baselineCells,
        response.nominalProbability, response.nominalProbability.length);
      const candidateExpected = expectedLower(variant.candidateCells,
        response.nominalProbability, response.nominalProbability.length);
      return { ...variant, historicalDelta,
        nominalDelta: candidateExpected - baselineExpected };
    }) }));
  return { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_EVENT_DEADLINE_ROOT_V1", key: root.key,
    scenarioFingerprint: root.scenarioFingerprint,
    candidateSeat: root.candidateSeat, frame: root.comparison.frame,
    outcomeRelation: label?.outcomeRelation || "UNKNOWN",
    currentAction: root.comparison.currentAction,
    candidateAction: root.comparison.candidateAction,
    historicalAction, historicalColumns: columns, historicalColumn,
    nominalProbability: response.nominalProbability, lanes };
}

function emptyLane() {
  return { common: {}, historical: {}, nominal: {} };
}

function summarize(records) {
  const output = { rootCount: records.length, uniqueHistoricalColumnCount: 0,
    ambiguousHistoricalColumnCount: 0, missingHistoricalColumnCount: 0,
    completeRootCount: 0, commonWorldAgreementLaneCount: 0,
    valueWorldAgreementLaneCount: 0, byOutcome: {} };
  for (const record of records) {
    if (record.historicalColumns.length === 1)
      output.uniqueHistoricalColumnCount += 1;
    else if (record.historicalColumns.length > 1)
      output.ambiguousHistoricalColumnCount += 1;
    else output.missingHistoricalColumnCount += 1;
    if (record.lanes.every(lane => lane.variants.every(v => v.complete)))
      output.completeRootCount += 1;
    const target = output.byOutcome[record.outcomeRelation] ||
      (output.byOutcome[record.outcomeRelation] = { count: 0, lanes: {} });
    target.count += 1;
    for (const lane of record.lanes) {
      if (lane.commonStatus === 2) output.commonWorldAgreementLaneCount += 1;
      if (lane.valueWorldAgreement) output.valueWorldAgreementLaneCount += 1;
      const laneTarget = target.lanes[lane.name] ||
        (target.lanes[lane.name] = emptyLane());
      increment(laneTarget.common, String(lane.commonRelation));
      increment(laneTarget.historical,
        relation(lane.variants[0].historicalDelta));
      increment(laneTarget.nominal, relation(lane.variants[0].nominalDelta));
    }
  }
  return output;
}

function aggregateRuntime(matches) {
  const output = { attempts: 0, complete: 0, incomplete: 0,
    rootRestoreFailures: 0, hotAllocations: 0 };
  for (const match of matches) {
    const value = match.candidateEngine?.semanticAttackPolicyIntervalShadow
      ?.eventDeadline;
    if (!value) continue;
    output.attempts += value.attemptCount;
    output.complete += value.completeRootCount;
    output.incomplete += value.incompleteRootCount;
    output.rootRestoreFailures += value.rootRestoreFailureCount;
    output.hotAllocations += value.hotAllocationCount;
  }
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative", "bp138-event-deadline-shadow")));
  const labelDirectory = path.resolve(option("--labels", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp133-semantic-attack-joint-movement-oracle")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp138-semantic-attack-event-deadline")));
  const source = readMatches(sourceDirectory);
  const extracted = extractComparisons(source.matches);
  const matches = candidateMatches(source.matches);
  const labels = readGzipRecords(path.join(labelDirectory, "roots.ndjson.gz"));
  const labelByKey = new Map(labels.records.map(item => [item.key, item]));
  const records = []; let missingLabelCount = 0; let missingMatchCount = 0;
  for (const item of extracted.roots) {
    if (!item.comparison.eventDeadlineEnvelope) continue;
    const match = matches.get(`${item.scenarioFingerprint}|${item.candidateSeat}`);
    if (!labelByKey.has(item.key)) missingLabelCount += 1;
    if (!match) { missingMatchCount += 1; continue; }
    records.push(compactRecord(item, labelByKey.get(item.key), match));
  }
  const summary = summarize(records); const runtime = aggregateRuntime(source.matches);
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
  const better = summary.byOutcome.CANDIDATE_BETTER?.lanes;
  const worse = summary.byOutcome.INCUMBENT_BETTER?.lanes;
  const accepted = extracted.roots.length === 211 && records.length === 35 &&
    labels.records.length === 35 && missingLabelCount === 0 &&
    missingMatchCount === 0 && summary.uniqueHistoricalColumnCount === 35 &&
    summary.ambiguousHistoricalColumnCount === 0 &&
    summary.missingHistoricalColumnCount === 0 &&
    summary.completeRootCount === 35 &&
    summary.commonWorldAgreementLaneCount === 70 &&
    summary.valueWorldAgreementLaneCount === 70 &&
    worse?.OUTCOME_FRONTIER.common["2"] === 2 &&
    worse?.PROJECTILE_SETTLEMENT.common["2"] === 2 &&
    better?.OUTCOME_FRONTIER.common["2"] === 1 &&
    better?.OUTCOME_FRONTIER.common["3"] === 1 &&
    better?.PROJECTILE_SETTLEMENT.common["2"] === 1 &&
    better?.PROJECTILE_SETTLEMENT.common["3"] === 1 &&
    worse?.OUTCOME_FRONTIER.historical.CANDIDATE_HIGHER === undefined &&
    worse?.PROJECTILE_SETTLEMENT.historical.CANDIDATE_HIGHER === undefined &&
    better?.OUTCOME_FRONTIER.historical.CANDIDATE_HIGHER === undefined &&
    better?.PROJECTILE_SETTLEMENT.historical.CANDIDATE_HIGHER === undefined &&
    runtime.attempts === 35 && runtime.complete === 35 &&
    runtime.incomplete === 0 && runtime.rootRestoreFailures === 0 &&
    runtime.hotAllocations === 0 && allZero(sourceOverview.comparison) &&
    productionRootSha256 === sourceManifest.source?.productionRootSha256;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_EVENT_DEADLINE_OVERVIEW_V1",
    status: accepted ? "ACCEPT_EVENT_LEAF_LIMIT_CLASSIFIED" : "REJECTED",
    sourceMatchCount: source.matches.length,
    sourceComparisonRootCount: extracted.roots.length,
    labelRootCount: labels.records.length, missingLabelCount, missingMatchCount,
    behaviorNeutral: allZero(sourceOverview.comparison), productionChanged: false,
    ...summary, runtime,
    diagnosis:
      "Removing the generic ATTACK scalar eliminates candidate-higher evidence on both historical regressions, but neither structural event lane is candidate-higher on either historical improvement. One improvement is conservatively candidate-lower.",
    boundary:
      "The outcome lane observes an event frontier only at a fixed depth-3 leaf. The settlement lane follows a projectile to its normative deadline only when that projectile already exists at the leaf. Neither lane continues an attack policy until its first future FIRE event.",
    decision:
      "Retain both event views as diagnostic dimensions, not owners or vetoes. BP139 must use an event-driven horizon that continues each common policy until FIRE, terminal, committed hazard deadline, support loss or a strict work cap; fixed-depth non-events return UNKNOWN." };
  const lines = records.map(JSON.stringify).join("\n");
  const rootsBytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_EVENT_DEADLINE_MANIFEST_V1",
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
  if (!accepted) throw new Error("BP138_EVENT_DEADLINE_REPORT_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { relation, valueSignature, compactRecord, summarize,
  aggregateRuntime, build };
