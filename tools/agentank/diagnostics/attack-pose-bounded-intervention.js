#!/usr/bin/env node
"use strict";

// Runs the route owner for an exact bounded number of decisions beginning at
// the first divergence, then returns to the stable owner.  The experiment
// measures how much option continuity is needed before its result materializes.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { CANDIDATE, loadCohort, play } = require("./v2-native-initiative-arena");
const { readMatches, targets } = require("./attack-pose-first-divergence-corpus");
const { outcomeValue } = require("./tactical-oracle-disagreement-audit");
const { actionAt, compactResult } = require("./attack-pose-single-root-intervention");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function parseHorizons(value) {
  const horizons = [...new Set(String(value).split(",").map(Number)
    .filter(item => Number.isSafeInteger(item) && item > 0))].sort((a, b) => a - b);
  if (!horizons.length) throw new Error("ATTACK_POSE_HORIZONS_EMPTY");
  return horizons;
}

function activeFrames(start, horizon) {
  return Array.from({ length: horizon }, (_, offset) => start + offset);
}

function bucket(records) {
  const output = { records: records.length, actionMatched: 0,
    localImprovement: 0, localRegression: 0, localNeutral: 0,
    netOutcomeDelta: 0, fullOutcomeMatched: 0, hardInvariantFailures: 0,
    improvementRootsRecovered: 0, regressionRootsReproduced: 0 };
  for (const record of records) {
    if (record.actionMatched) output.actionMatched += 1;
    if (record.localDelta > 0) output.localImprovement += 1;
    else if (record.localDelta < 0) output.localRegression += 1;
    else output.localNeutral += 1;
    output.netOutcomeDelta += record.localDelta;
    if (record.intervention.outcome === record.rightOutcome)
      output.fullOutcomeMatched += 1;
    if (record.transition === "IMPROVEMENT" && record.localDelta > 0)
      output.improvementRootsRecovered += 1;
    if (record.transition === "REGRESSION" && record.localDelta < 0)
      output.regressionRootsReproduced += 1;
    if (Object.values(record.intervention.invariants).some(Boolean))
      output.hardInvariantFailures += 1;
  }
  return output;
}

function summarize(records, horizons) {
  const byHorizon = {};
  for (const horizon of horizons)
    byHorizon[horizon] = bucket(records.filter(record => record.horizon === horizon));
  const byRoot = new Map();
  for (const record of records) {
    const key = [record.scenarioFingerprint, record.candidateSeat,
      record.decisionIndex].join(":");
    const values = byRoot.get(key) || []; values.push(record); byRoot.set(key, values);
  }
  const minimumFullOutcomeHorizon = { NEVER: 0 };
  for (const values of byRoot.values()) {
    values.sort((a, b) => a.horizon - b.horizon);
    const found = values.find(record =>
      record.intervention.outcome === record.rightOutcome);
    const key = found ? String(found.horizon) : "NEVER";
    minimumFullOutcomeHorizon[key] = (minimumFullOutcomeHorizon[key] || 0) + 1;
  }
  return { byHorizon, minimumFullOutcomeHorizon };
}

async function build(root = defaultWorkspaceRoot()) {
  const leftSpec = option("--left"); const rightSpec = option("--right");
  if (!leftSpec || !rightSpec) throw new Error("--left and --right are required");
  const horizons = parseHorizons(option("--horizons", "1,2,4,8"));
  const cohortFile = path.resolve(option("--cohort",
    path.join(root, "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative", "attack-pose-bounded-intervention")));
  const selected = targets(readMatches(leftSpec), readMatches(rightSpec));
  const loaded = loadCohort(root, cohortFile, role); const scenarioByFingerprint = new Map();
  for (const scenario of loaded.scenarios) {
    scenarioByFingerprint.set(scenario.scenarioFingerprint || scenario.fingerprint, scenario);
    scenarioByFingerprint.set(scenario.matchUrlId, scenario);
  }
  const simulator = await loadSimulator(root); const records = []; const missing = [];
  let completed = 0; const total = selected.length * horizons.length;
  for (const target of selected) {
    const scenario = scenarioByFingerprint.get(target.scenarioFingerprint) ||
      scenarioByFingerprint.get(target.matchUrlId);
    if (!scenario) { missing.push({ ...target, reason: "SCENARIO_MISSING" }); continue; }
    for (const horizon of horizons) {
      const replay = await play(simulator.module, scenario, target.candidateSeat,
        CANDIDATE.NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE,
        { nativePoseActiveFrames: activeFrames(target.decisionIndex, horizon) });
      const emitted = actionAt(replay.candidate?.compactActionStream,
        target.decisionIndex);
      records.push({ ...target, horizon, emittedAction: emitted,
        actionMatched: emitted === target.rightAction,
        localDelta: outcomeValue(replay.analysisOutcome) -
          outcomeValue(target.leftOutcome), intervention: compactResult(replay) });
      completed += 1;
      if (completed % 16 === 0 || completed === total)
        process.stderr.write(`[attack-pose-bounded] ${completed}/${total}\n`);
    }
  }
  const analysis = summarize(records, horizons);
  const overview = { objectKind: "ATTACK_POSE_BOUNDED_INTERVENTION_V1",
    role, cohortFingerprint: loaded.manifest.fingerprint, horizons,
    selectedRootCount: selected.length, recordCount: records.length,
    missingRootCount: missing.length, ...analysis, missing };
  const manifest = { schemaVersion: 1,
    objectKind: "ATTACK_POSE_BOUNDED_INTERVENTION_MANIFEST_V1", role, horizons,
    cohortFile, cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    leftDirectories: leftSpec.split(",").map(value => path.resolve(value)),
    rightDirectories: rightSpec.split(",").map(value => path.resolve(value)),
    recordCount: records.length, fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    `${JSON.stringify(overview, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "interventions.ndjson.gz"),
    zlib.gzipSync(Buffer.from(records.length ?
      `${records.map(record => JSON.stringify(record)).join("\n")}\n` : ""), { level: 9 }));
  process.stdout.write(`${JSON.stringify({ output: outputDirectory, overview }, null, 2)}\n`);
  return { output: outputDirectory, overview, records };
}

if (require.main === module) build().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1;
});

module.exports = { parseHorizons, activeFrames, bucket, summarize, build };
