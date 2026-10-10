#!/usr/bin/env node
"use strict";

// Causal labeler for the isolated BP68 tactical port.  It reads a completed
// ACTIVE arena, finds each first physically effective override, then compares
// V3_BASE with a controller that enables BP68 at that one frame only.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const repairCohort = require("./v3-repair-cohort");
const { loadCohort: loadVc0Cohort } = require("./v3-component-cohort");
const { play } = require("./v3-component-arena");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function readMatches(file) {
  const bytes = fs.readFileSync(file);
  const text = zlib.gunzipSync(bytes).toString("utf8").trim();
  return { bytes, matches: text ? text.split("\n").map(JSON.parse) : [] };
}

function outcomeValue(outcome) {
  return outcome === "CHALLENGER_WIN" ? 2 : outcome === "DRAW" ? 1 : 0;
}

function parseHorizons(value) {
  const values = [...new Set(String(value).split(",").map(Number)
    .filter(item => Number.isSafeInteger(item) && item > 0))].sort((a, b) => a - b);
  if (!values.length) throw new Error("BP_TACTICAL_INTERVENTION_HORIZONS_EMPTY");
  return values;
}

function targets(matches) {
  return matches.map(match => {
    const tactical = match.candidateController?.tacticalCore || {};
    return { sourceMatchId: match.matchId,
      historicalMatchUrlId: match.historicalMatchUrlId,
      scenarioFingerprint: match.scenarioFingerprint,
      candidateSeat: match.candidateSeat,
      frame: tactical.firstEffectiveOverrideFrame ?? -1,
      legacyAction: tactical.firstEffectiveLegacyAction ?? 0,
      proposalAction: tactical.firstEffectiveProposalAction ?? 0,
      actualAction: tactical.firstEffectiveActualAction ?? 0,
      proposalValue: tactical.firstEffectiveProposalValue ?? 0,
      legacyValue: tactical.firstEffectiveLegacyValue ?? 0,
      proposalExactBlock: tactical.firstEffectiveProposalExactBlock ?? 0,
      legacyExactBlock: tactical.firstEffectiveLegacyExactBlock ?? 0,
      fullOutcome: match.analysisOutcome,
      fullTerminal: match.terminalCategory };
  }).filter(target => target.frame >= 0);
}

function actionAt(match, frame) {
  const stream = Buffer.from(match.candidate?.compactActionStream || "", "base64");
  return frame >= 0 && frame < stream.length ? stream[frame] : -1;
}

function summarize(records) {
  const output = { records: records.length, actionMatched: 0,
    localImprovement: 0, localRegression: 0, localNeutral: 0,
    netOutcomeDelta: 0, fullDirectionReproduced: 0,
    baselineOutcomes: {}, interventionOutcomes: {}, actionPairs: {},
    exactness: { bothExact: { records: 0, net: 0 },
      proposalExact: { records: 0, net: 0 },
      incomplete: { records: 0, net: 0 } } };
  for (const record of records) {
    if (record.actionMatched) output.actionMatched += 1;
    if (record.localDelta > 0) output.localImprovement += 1;
    else if (record.localDelta < 0) output.localRegression += 1;
    else output.localNeutral += 1;
    output.netOutcomeDelta += record.localDelta;
    if (Math.sign(record.localDelta) === Math.sign(record.fullDelta))
      output.fullDirectionReproduced += 1;
    output.baselineOutcomes[record.baselineOutcome] =
      (output.baselineOutcomes[record.baselineOutcome] || 0) + 1;
    output.interventionOutcomes[record.interventionOutcome] =
      (output.interventionOutcomes[record.interventionOutcome] || 0) + 1;
    const pair = `${record.legacyAction}->${record.proposalAction}`;
    output.actionPairs[pair] = (output.actionPairs[pair] || 0) + 1;
    const bucket = record.proposalExactBlock === 0 && record.legacyExactBlock === 0 ?
      output.exactness.bothExact : record.proposalExactBlock === 0 ?
        output.exactness.proposalExact : output.exactness.incomplete;
    bucket.records += 1; bucket.net += record.localDelta;
  }
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceFile = path.resolve(option("--source"));
  if (!option("--source")) throw new Error("BP_TACTICAL_INTERVENTION_SOURCE_REQUIRED");
  const cohortFile = path.resolve(option("--cohort",
    path.join(root, "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const horizons = parseHorizons(option("--horizons", "1"));
  const output = path.resolve(option("--output",
    "/tmp/agentank-native-bp-tactical-intervention"));
  const source = readMatches(sourceFile); const selected = targets(source.matches);
  const cohortManifest = JSON.parse(fs.readFileSync(cohortFile, "utf8"));
  const loaded = cohortManifest.objectKind === repairCohort.KIND ?
    repairCohort.load(root, cohortFile, role) : loadVc0Cohort(root, cohortFile, role);
  const scenarios = new Map();
  for (const scenario of loaded.scenarios) {
    scenarios.set(scenario.scenarioFingerprint || scenario.fingerprint, scenario);
    scenarios.set(scenario.matchUrlId, scenario);
  }
  const simulator = await loadSimulator(root); const records = []; const missing = [];
  for (let index = 0; index < selected.length; index += 1) {
    const target = selected[index];
    const scenario = scenarios.get(target.scenarioFingerprint) ||
      scenarios.get(target.historicalMatchUrlId);
    if (!scenario) { missing.push({ ...target, reason: "SCENARIO_MISSING" }); continue; }
    const baseline = await play(simulator.module, scenario, target.candidateSeat,
      "BASE_V3", "BASE_V3");
    for (const horizon of horizons) {
      const intervention = await play(simulator.module, scenario, target.candidateSeat,
        "NATIVE_BP_TACTICAL_INITIATIVE_ACTIVE", "BASE_V3", {
          nativeBasePolicyTacticalOptions: {
            preserveV1Initiative: true,
            activeFrames: Array.from({ length: horizon }, (_, offset) => target.frame + offset)
          }
        });
      const localDelta = outcomeValue(intervention.analysisOutcome) -
        outcomeValue(baseline.analysisOutcome);
      records.push({ ...target, horizon,
        baselineOutcome: baseline.analysisOutcome,
        baselineTerminal: baseline.terminalCategory,
        interventionOutcome: intervention.analysisOutcome,
        interventionTerminal: intervention.terminalCategory,
        interventionAction: actionAt(intervention, target.frame),
        actionMatched: actionAt(intervention, target.frame) === target.actualAction,
        localDelta,
        fullDelta: outcomeValue(target.fullOutcome) - outcomeValue(baseline.analysisOutcome),
        baselineCounts: baseline.counts,
        interventionCounts: intervention.counts });
    }
    if ((index + 1) % 8 === 0 || index + 1 === selected.length)
      process.stderr.write(`[native-bp-intervention] ${index + 1}/${selected.length}\n`);
  }
  const byHorizon = Object.fromEntries(horizons.map(horizon =>
    [horizon, summarize(records.filter(record => record.horizon === horizon))]));
  const overview = { objectKind: "NATIVE_BP_TACTICAL_INTERVENTION_V1", role, horizons,
    sourceMatches: source.matches.length, selectedRoots: selected.length,
    missingRoots: missing.length, records: records.length, byHorizon, missing };
  const manifest = { schemaVersion: 1,
    objectKind: "NATIVE_BP_TACTICAL_INTERVENTION_MANIFEST_V1", role,
    sourceFile, sourceSha256: sha256Bytes(source.bytes), cohortFile,
    cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    horizons, recordCount: records.length, fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "overview.json"),
    `${JSON.stringify(overview, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "interventions.ndjson.gz"),
    zlib.gzipSync(Buffer.from(records.length ?
      `${records.map(record => JSON.stringify(record)).join("\n")}\n` : ""), { level: 9 }));
  process.stdout.write(`${JSON.stringify({ output, overview }, null, 2)}\n`);
  return { output, overview, records };
}

if (require.main === module) build().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1;
});

module.exports = { readMatches, outcomeValue, parseHorizons, targets, actionAt,
  summarize, build };
