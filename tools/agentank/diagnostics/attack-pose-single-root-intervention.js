#!/usr/bin/env node
"use strict";

// Replays only the first divergent AttackPose root as a one-shot intervention.
// Every later decision returns to the stable native tactical owner.  This
// separates the local action effect from the full route policy trajectory.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { CANDIDATE, loadCohort, play } = require("./v2-native-initiative-arena");
const { readMatches, targets } = require("./attack-pose-first-divergence-corpus");
const { outcomeValue } = require("./tactical-oracle-disagreement-audit");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function actionAt(stream, frame) {
  const bytes = Buffer.from(stream || "", "base64");
  return frame >= 0 && frame < bytes.length ? bytes[frame] : -1;
}

function compactResult(match) {
  const seat = match.candidateSeat; const other = 1 - seat;
  const layer = match.candidateEngine?.layerTotals || {};
  return { outcome: match.analysisOutcome, terminal: match.terminalCategory,
    frames: match.frames, candidateStars: match.counts?.stars?.[seat] || 0,
    controlStars: match.counts?.stars?.[other] || 0,
    candidateCrashes: match.counts?.crashes?.[seat] || 0,
    candidateFire: match.counts?.bullets?.[seat] || 0,
    candidateProjectileKills: match.projectileFunnel?.tankKills?.[seat] || 0,
    invariants: {
      timeoutError: (match.candidate?.timeoutCount || 0) +
        (match.candidate?.errorCount || 0),
      avoidableHardReject: layer.avoidableHardRejects || 0,
      riskDominatedSelection: layer.riskDominatedSelections || 0,
      rootRestoreFailure: layer.depthRootRestoreFailures || 0
    } };
}

function summarizeInterventions(records) {
  const summary = { records: records.length, actionMatched: 0,
    localImprovement: 0, localRegression: 0, localNeutral: 0,
    reproducedFullDirection: 0, fullEffectRecovered: 0,
    hardInvariantFailures: 0, byOriginalTransition: {} };
  for (const record of records) {
    if (record.actionMatched) summary.actionMatched += 1;
    if (record.localDelta > 0) summary.localImprovement += 1;
    else if (record.localDelta < 0) summary.localRegression += 1;
    else summary.localNeutral += 1;
    if (Math.sign(record.localDelta) === Math.sign(record.fullDelta))
      summary.reproducedFullDirection += 1;
    if (record.localDelta === record.fullDelta) summary.fullEffectRecovered += 1;
    const invariants = record.intervention.invariants;
    if (Object.values(invariants).some(Boolean)) summary.hardInvariantFailures += 1;
    const bucket = summary.byOriginalTransition[record.transition] ||
      (summary.byOriginalTransition[record.transition] = {
        records: 0, localImprovement: 0, localRegression: 0, localNeutral: 0 });
    bucket.records += 1;
    if (record.localDelta > 0) bucket.localImprovement += 1;
    else if (record.localDelta < 0) bucket.localRegression += 1;
    else bucket.localNeutral += 1;
  }
  return summary;
}

async function build(root = defaultWorkspaceRoot()) {
  const leftSpec = option("--left"); const rightSpec = option("--right");
  if (!leftSpec || !rightSpec) throw new Error("--left and --right are required");
  const cohortFile = path.resolve(option("--cohort",
    path.join(root, "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative", "attack-pose-single-root-intervention")));
  const selected = targets(readMatches(leftSpec), readMatches(rightSpec));
  const loaded = loadCohort(root, cohortFile, role);
  const scenarioByFingerprint = new Map();
  for (const scenario of loaded.scenarios) {
    scenarioByFingerprint.set(scenario.scenarioFingerprint || scenario.fingerprint, scenario);
    scenarioByFingerprint.set(scenario.matchUrlId, scenario);
  }
  const simulator = await loadSimulator(root); const records = []; const missing = [];
  for (let index = 0; index < selected.length; index += 1) {
    const target = selected[index];
    const scenario = scenarioByFingerprint.get(target.scenarioFingerprint) ||
      scenarioByFingerprint.get(target.matchUrlId);
    if (!scenario) { missing.push({ ...target, reason: "SCENARIO_MISSING" }); continue; }
    const replay = await play(simulator.module, scenario, target.candidateSeat,
      CANDIDATE.NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE,
      { nativePoseActiveFrames: [target.decisionIndex] });
    const emitted = actionAt(replay.candidate?.compactActionStream,
      target.decisionIndex);
    const localDelta = outcomeValue(replay.analysisOutcome) -
      outcomeValue(target.leftOutcome);
    records.push({ ...target, emittedAction: emitted,
      actionMatched: emitted === target.rightAction, fullDelta: target.delta,
      localDelta, intervention: compactResult(replay) });
    if ((index + 1) % 8 === 0 || index + 1 === selected.length)
      process.stderr.write(`[attack-pose-single-root] ${index + 1}/${selected.length}\n`);
  }
  const summary = summarizeInterventions(records);
  const overview = { objectKind: "ATTACK_POSE_SINGLE_ROOT_INTERVENTION_V1",
    role, cohortFingerprint: loaded.manifest.fingerprint,
    selectedRootCount: selected.length, missingRootCount: missing.length,
    ...summary, missing };
  const manifest = { schemaVersion: 1,
    objectKind: "ATTACK_POSE_SINGLE_ROOT_INTERVENTION_MANIFEST_V1", role,
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

module.exports = { actionAt, compactResult, summarizeInterventions, build };
