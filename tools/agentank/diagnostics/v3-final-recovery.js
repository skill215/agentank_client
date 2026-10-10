#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { buildImp6Production } = require("../build/imp6-builder");
const { loadSimulator, DecisionAudit, collectCounts } = require("../simulation/paired-arena");
const { createHistoricalStarProvider } = require("../simulation/historical-scenarios");
const { ProductionDiagnosticBot } = require("../simulation/production-diagnostic-bot");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");
const { V3DiagnosticBot } = require("../../../engine-v3/src");
const cohortTool = require("./v3-repair-cohort");
const { seedFor } = require("./v1-v3-arena");
const { buildNativeV1Module } = require("./v3-native-build");
const { DualEquivalenceBot } = require("./v3-native-equivalence");

function rawResult(replay, candidateSeat) {
  const winner = replay.result?.winner;
  return { winnerSeat: winner === 0 || winner === 1 ? winner : null,
    winnerImplementation: winner === candidateSeat ? "v2" :
      winner === (candidateSeat ^ 1) ? "v1" : "draw",
    reason: replay.result?.reason || "UNKNOWN" };
}

function classify(match) {
  const result = classifyAnalysisOutcome(match);
  return { outcome: result.analysisOutcome, terminalCategory: result.terminalCategory };
}

function field(module, scenario) {
  const star = createHistoricalStarProvider(scenario.stars);
  return new module.AgenTankSimulator({ map: scenario.map,
    tanks: scenario.starts.map((tank, seat) => ({ ...tank, id: `v3r8-final-${seat}` })),
    skills: ["stun", "stun"], star: star.initialStar,
    starProvider: value => star.provider(value), seed: seedFor(scenario),
    maxFrames: 128, starLimit: false });
}

async function play(module, root, nativeManifest, scenario, candidateSeat, kind) {
  const simulator = field(module, scenario);
  const candidateBot = kind === "CURRENT_V2" ? new ProductionDiagnosticBot({
    captureCompactFrames: true }) : new DualEquivalenceBot(root, nativeManifest);
  const opponentBot = new V3DiagnosticBot();
  const candidate = new DecisionAudit(candidateBot, { captureCompactFrames: true });
  const opponent = new DecisionAudit(opponentBot, { captureCompactFrames: true });
  const bots = candidateSeat === 0 ? [candidate, opponent] : [opponent, candidate];
  const replay = simulator.run(bots[0], bots[1]); const result = rawResult(replay, candidateSeat);
  const counts = collectCounts(replay, candidateSeat);
  const match = { implementation: kind, matchUrlId: scenario.matchUrlId,
    scenarioFingerprint: scenario.fingerprint, candidateSeat,
    seatImplementations: candidateSeat === 0 ? ["v2", "v1"] : ["v1", "v2"],
    seatSkills: ["stun", "stun"], frames: replay.replayData.replay.records.length,
    result, counts, candidate: candidate.summary(), opponent: opponent.summary(),
    nativeActionMismatches: kind === "NATIVE_REPAIRED" ? candidateBot.mismatches : 0 };
  const analysis = classify(match); match.analysisOutcome = analysis.outcome;
  match.terminalCategory = analysis.terminalCategory; return match;
}

function summarize(matches, kind) {
  const selected = matches.filter(item => item.implementation === kind);
  const output = { implementation: kind, matches: selected.length, v2Wins: 0, v1Wins: 0,
    draws: 0, scoreBasisPoints: 0, scorePercent: "0.00", stars: { v2: 0, v1: 0 },
    crashes: { v2: 0, v1: 0 }, fire: { v2: 0, v1: 0 }, timeoutError: 0,
    nativeActionMismatches: 0, runtimeMicros: { v2: 0, v1: 0 } };
  let units = 0;
  for (const match of selected) {
    if (match.analysisOutcome === "V2_WIN") { output.v2Wins += 1; units += 2; }
    else if (match.analysisOutcome === "V1_WIN") output.v1Wins += 1;
    else { output.draws += 1; units += 1; }
    const other = match.candidateSeat ^ 1;
    output.stars.v2 += match.counts.stars[match.candidateSeat];
    output.stars.v1 += match.counts.stars[other];
    output.crashes.v2 += match.counts.crashes[match.candidateSeat];
    output.crashes.v1 += match.counts.crashes[other];
    output.fire.v2 += match.counts.bullets[match.candidateSeat];
    output.fire.v1 += match.counts.bullets[other];
    output.timeoutError += match.candidate.timeoutCount + match.candidate.errorCount;
    output.nativeActionMismatches += match.nativeActionMismatches;
    output.runtimeMicros.v2 += match.candidate.totalRuntimeMicros;
    output.runtimeMicros.v1 += match.opponent.totalRuntimeMicros;
  }
  output.scoreBasisPoints = Math.round(units * 5000 / Math.max(1, selected.length));
  output.scorePercent = (output.scoreBasisPoints / 100).toFixed(2); return output;
}

async function main() {
  const root = defaultWorkspaceRoot(); const cohortFile = path.join(root, "config", "engine-v3",
    "v3-repair-cohort.json"); const cohort = cohortTool.load(root, cohortFile, "FINAL_RECOVERY");
  const baseline = JSON.parse(fs.readFileSync(path.join(root, "artifacts", "v3-repair", "baseline",
    "manifest.json"), "utf8"));
  const built = await buildImp6Production({ workspaceRoot: root });
  if (sha256Bytes(fs.readFileSync(built.sourceFile)) !== baseline.sourceSha256)
    throw new Error("V3R8_FROZEN_CURRENT_V2_DRIFT");
  const nativeManifest = buildNativeV1Module(root); const simulator = await loadSimulator(root);
  const matches = []; const started = Date.now();
  for (let index = 0; index < cohort.scenarios.length; index += 1) {
    const scenario = cohort.scenarios[index];
    for (let seat = 0; seat < 2; seat += 1) {
      matches.push(await play(simulator.module, root, nativeManifest, scenario, seat, "CURRENT_V2"));
      matches.push(await play(simulator.module, root, nativeManifest, scenario, seat, "NATIVE_REPAIRED"));
    }
    if ((index + 1) % 8 === 0 || index + 1 === cohort.scenarios.length)
      process.stderr.write(`[v3-final-recovery] ${index + 1}/${cohort.scenarios.length}\n`);
  }
  const overview = { scenarios: cohort.scenarios.length, physicalMatches: matches.length,
    current: summarize(matches, "CURRENT_V2"), repaired: summarize(matches, "NATIVE_REPAIRED"),
    elapsedMs: Date.now() - started };
  const output = path.join(root, "artifacts", "v3-repair", `v3r8-final-recovery-${
    cohort.manifest.fingerprint.slice(0, 12)}`); fs.mkdirSync(output, { recursive: true });
  const manifest = { schemaVersion: 1, objectKind: "V3R8_FINAL_RECOVERY_V1",
    cohortFingerprint: cohort.manifest.fingerprint, frozenCurrentV2Sha256: baseline.sourceSha256,
    nativeModuleSha256: nativeManifest.sourceSha256, scenarioCount: cohort.scenarios.length,
    matchCountPerCandidate: cohort.scenarios.length * 2, fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "overview.json"), `${JSON.stringify(overview, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "matches.ndjson.gz"), zlib.gzipSync(Buffer.from(
    `${matches.map(item => JSON.stringify(item)).join("\n")}\n`), { level: 9 }));
  fs.writeFileSync(path.join(output, "diagnostic-samples.ndjson.gz"),
    zlib.gzipSync(Buffer.from(""), { level: 9 }));
  process.stdout.write(`${JSON.stringify({ output, overview }, null, 2)}\n`);
}

if (require.main === module)
  main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { play, summarize };
