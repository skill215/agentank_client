#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { CANDIDATE, loadCohort, play } = require("./v2-native-initiative-arena");
const { firstDifference, outcomeValue } = require(
  "./tactical-oracle-disagreement-audit");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function readMatches(specification) {
  return String(specification).split(",").filter(Boolean).flatMap(directory => {
    const file = path.join(path.resolve(directory), "matches.ndjson.gz");
    return zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").trim()
      .split("\n").filter(Boolean).map(JSON.parse)
      .filter(match => !String(match.implementation).includes("CENSUS_SHADOW"));
  });
}

function keyOf(match) {
  return [match.scenarioFingerprint, match.candidateSeat,
    ...(match.seatSkills || [])].join(":");
}

function targets(leftMatches, rightMatches) {
  const rightByKey = new Map(rightMatches.map(match => [keyOf(match), match]));
  const output = [];
  for (const left of leftMatches) {
    const right = rightByKey.get(keyOf(left));
    if (!right) continue;
    const delta = outcomeValue(right.analysisOutcome) - outcomeValue(left.analysisOutcome);
    if (!delta) continue;
    const difference = firstDifference(left.candidate?.compactActionStream,
      right.candidate?.compactActionStream);
    if (!difference) continue;
    output.push({ matchUrlId: left.matchUrlId,
      scenarioFingerprint: left.scenarioFingerprint,
      candidateSeat: left.candidateSeat, seatSkills: left.seatSkills,
      decisionIndex: difference.frame, leftAction: difference.left,
      rightAction: difference.right, leftOutcome: left.analysisOutcome,
      rightOutcome: right.analysisOutcome,
      leftTerminal: left.terminalCategory, rightTerminal: right.terminalCategory,
      delta, transition: delta > 0 ? "IMPROVEMENT" : "REGRESSION" });
  }
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const leftSpec = option("--left"); const rightSpec = option("--right");
  if (!leftSpec || !rightSpec) throw new Error("--left and --right are required");
  const cohortFile = path.resolve(option("--cohort",
    path.join(root, "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative", "attack-pose-first-divergence-corpus")));
  const left = readMatches(leftSpec); const right = readMatches(rightSpec);
  const selected = targets(left, right);
  const loaded = loadCohort(root, cohortFile, role);
  const scenarioByFingerprint = new Map(loaded.scenarios.map(scenario =>
    [scenario.scenarioFingerprint || scenario.fingerprint, scenario]));
  for (const scenario of loaded.scenarios)
    scenarioByFingerprint.set(scenario.matchUrlId, scenario);
  const simulator = await loadSimulator(root); const roots = []; const missing = [];
  for (let index = 0; index < selected.length; index += 1) {
    const target = selected[index];
    const scenario = scenarioByFingerprint.get(target.scenarioFingerprint) ||
      scenarioByFingerprint.get(target.matchUrlId);
    if (!scenario) { missing.push({ ...target, reason: "SCENARIO_MISSING" }); continue; }
    const replay = await play(simulator.module, scenario, target.candidateSeat,
      CANDIDATE.NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE,
      { nativePoseFrames: [target.decisionIndex] });
    const samples = replay.candidate?.nativeTacticalActionOwner?.rootSamples || [];
    const sample = samples.find(item => item.decisionIndex === target.decisionIndex);
    if (!sample) { missing.push({ ...target, reason: "ROOT_SAMPLE_MISSING" }); continue; }
    roots.push({ ...target, replayOutcome: replay.analysisOutcome,
      replayTerminal: replay.terminalCategory, root: sample });
    if ((index + 1) % 8 === 0 || index + 1 === selected.length)
      process.stderr.write(`[attack-pose-root-corpus] ${index + 1}/${selected.length}\n`);
  }
  const transitionCounts = {}; const actionPairs = {};
  for (const root of roots) {
    transitionCounts[root.transition] = (transitionCounts[root.transition] || 0) + 1;
    const pair = `${root.leftAction}->${root.rightAction}`;
    actionPairs[pair] = (actionPairs[pair] || 0) + 1;
  }
  const overview = { objectKind: "ATTACK_POSE_FIRST_DIVERGENCE_CORPUS_V1",
    role, cohortFingerprint: loaded.manifest.fingerprint,
    comparedLeftMatches: left.length, comparedRightMatches: right.length,
    targetCount: selected.length, capturedRootCount: roots.length,
    missingRootCount: missing.length, transitionCounts, actionPairs,
    exactReplayOutcomeCount: roots.filter(root =>
      root.replayOutcome === root.rightOutcome).length };
  const manifest = { schemaVersion: 1,
    objectKind: "ATTACK_POSE_FIRST_DIVERGENCE_CORPUS_MANIFEST_V1", role,
    cohortFile, cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    leftDirectories: leftSpec.split(",").map(value => path.resolve(value)),
    rightDirectories: rightSpec.split(",").map(value => path.resolve(value)),
    rootCount: roots.length, overview, fingerprint: "" };
  manifest.fingerprint = fingerprintObject(manifest);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    `${JSON.stringify({ ...overview, missing }, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"),
    zlib.gzipSync(Buffer.from(roots.length ?
      `${roots.map(root => JSON.stringify(root)).join("\n")}\n` : ""), { level: 9 }));
  process.stdout.write(`${JSON.stringify({ output: outputDirectory, overview }, null, 2)}\n`);
  return { output: outputDirectory, overview, roots, missing };
}

if (require.main === module) build().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1;
});

module.exports = { readMatches, keyOf, targets, build };
