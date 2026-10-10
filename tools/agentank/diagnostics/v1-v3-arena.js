#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { sha256Text, fingerprintObject } = require("../core/hash");
const { loadFrozenCandidate } = require("../candidate/imp8-g10a");
const { loadRollingV1Scenarios, createHistoricalStarProvider } =
  require("../simulation/historical-scenarios");
const { DecisionAudit, loadSimulator, collectCounts } = require("../simulation/paired-arena");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");
const { V3DiagnosticBot, V3_COMPONENT_MODE } = require("../../../engine-v3/src");
const { loadCohort } = require("./v3-component-cohort");

const SELECTION_SALT = "v1-v3-structured-arena-v1";

function integerOption(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at < 0) return fallback;
  const value = Number(process.argv[at + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`INVALID_${name.slice(2)}`);
  return value;
}

function stringOption(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function v3OptionsFor(mode) {
  if (mode === "BASE_V3") return {};
  if (mode === "BEST_VC1_VC2") return { enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE };
  throw new Error(`V3_ARENA_MODE_UNKNOWN:${mode}`);
}

function hashRank(scenario) {
  return sha256Text(`${SELECTION_SALT}\0${scenario.fingerprint}\0${scenario.matchUrlId}`);
}

function selectScenarios(rolling, pairCount) {
  const frozenIds = new Set(rolling.frozenSnapshot?.matchUrlIds || []);
  const unique = [];
  const seen = new Set();
  for (const scenario of rolling.scenarios) {
    if (seen.has(scenario.fingerprint)) continue;
    seen.add(scenario.fingerprint);
    unique.push(scenario);
  }
  if (unique.length < pairCount) throw new Error(`V3_ARENA_SCENARIOS_INSUFFICIENT:${unique.length}`);
  const ranked = values => values.slice().sort((a, b) => hashRank(a).localeCompare(hashRank(b)));
  const discovered = ranked(unique.filter(item => !frozenIds.has(item.matchUrlId)));
  const newQuota = Math.min(discovered.length, pairCount, Math.max(1, Math.floor(pairCount / 4)));
  const selected = discovered.slice(0, newQuota);
  const selectedIds = new Set(selected.map(item => item.matchUrlId));
  for (const scenario of ranked(unique)) {
    if (selected.length >= pairCount) break;
    if (!selectedIds.has(scenario.matchUrlId)) {
      selected.push(scenario);
      selectedIds.add(scenario.matchUrlId);
    }
  }
  return { selected, available: rolling.scenarios.length, unique: unique.length,
    discoveredAvailable: discovered.length, discoveredSelected: newQuota };
}

function seedFor(scenario) {
  return Number.parseInt(sha256Text(`v1-v3\0${scenario.fingerprint}`).slice(0, 8), 16) >>> 0;
}

function rawResult(replay, labels) {
  const seat = replay.result?.winner;
  return { winnerSeat: seat === 0 || seat === 1 ? seat : null,
    winnerImplementation: seat === 0 || seat === 1 ? labels[seat] : "draw",
    reason: replay.result?.reason || "UNKNOWN" };
}

function translateAnalysis(match) {
  const classified = classifyAnalysisOutcome({ ...match,
    seatImplementations: match.seatImplementations.map(value => value === "v3" ? "v2" : "v1"),
    result: { ...match.result, winnerImplementation:
      match.result.winnerImplementation === "v3" ? "v2" : match.result.winnerImplementation } });
  return { outcome: classified.analysisOutcome === "V2_WIN" ? "V3_WIN" :
    classified.analysisOutcome, terminalCategory: classified.terminalCategory };
}

async function play(simulatorModule, scenario, v1Code, v3Seat, v3Options = {}) {
  const star = createHistoricalStarProvider(scenario.stars);
  const simulator = new simulatorModule.AgenTankSimulator({ map: scenario.map,
    tanks: scenario.starts.map((tank, seat) => ({ ...tank, id: `v1-v3-${seat}` })),
    skills: ["stun", "stun"], star: star.initialStar,
    starProvider: value => star.provider(value), seed: seedFor(scenario),
    maxFrames: 128, starLimit: false });
  const v1 = new DecisionAudit(simulatorModule.loadBotFromCode(v1Code,
    { timeoutMs: 200, loadTimeoutMs: 2000 }));
  const v3Bot = new V3DiagnosticBot({ ...v3Options,
    contextName: v3Options.contextName || `v1-v3-${scenario.matchUrlId}-${v3Seat}` });
  const v3 = new DecisionAudit(v3Bot);
  const bots = v3Seat === 0 ? [v3, v1] : [v1, v3];
  const labels = v3Seat === 0 ? ["v3", "v1"] : ["v1", "v3"];
  const replay = simulator.run(bots[0], bots[1]);
  const counts = collectCounts(replay, v3Seat);
  const match = { matchId: `${scenario.matchUrlId}:V3_SEAT_${v3Seat}`,
    historicalMatchUrlId: scenario.matchUrlId,
    scenarioFingerprint: scenario.fingerprint, mapHash: scenario.mapHash,
    v3Seat, seatImplementations: labels, seatSkills: ["stun", "stun"],
    frames: replay.replayData.replay.records.length,
    result: rawResult(replay, labels), counts,
    v1: v1.summary(), v3: v3.summary(), v3Components: v3Bot.summary().controller };
  const analysis = translateAnalysis(match);
  return { ...match, analysisOutcome: analysis.outcome,
    terminalCategory: analysis.terminalCategory };
}

function addCounts(target, source) {
  for (const [name, count] of Object.entries(source || {}))
    target[name] = (target[name] || 0) + count;
}

function summarize(matches, selection, elapsedMs) {
  const output = { matchCount: matches.length, scenarioCount: matches.length / 2,
    analysis: { v3Wins: 0, v1Wins: 0, draws: 0, scoreBasisPoints: 0,
      scorePercent: "0.00" },
    raw: { v3Wins: 0, v1Wins: 0, draws: 0 }, terminalCategories: {},
    pairs: { v3Sweep: 0, v1Sweep: 0, split: 0, v3WinDraw: 0, v1WinDraw: 0,
      doubleDraw: 0 }, crashes: { v3: 0, v1: 0 }, stars: { v3: 0, v1: 0 },
    projectiles: { v3: 0, v1: 0 }, actions: { v3: {}, v1: {} },
    runtime: { elapsedMs, v3TotalMicros: 0, v1TotalMicros: 0,
      v3WeightedP95Micros: 0, v1WeightedP95Micros: 0 }, selection };
  let scoreUnits = 0; let v3P95Weighted = 0; let v1P95Weighted = 0;
  for (const match of matches) {
    if (match.analysisOutcome === "V3_WIN") { output.analysis.v3Wins += 1; scoreUnits += 2; }
    else if (match.analysisOutcome === "V1_WIN") output.analysis.v1Wins += 1;
    else { output.analysis.draws += 1; scoreUnits += 1; }
    if (match.result.winnerImplementation === "v3") output.raw.v3Wins += 1;
    else if (match.result.winnerImplementation === "v1") output.raw.v1Wins += 1;
    else output.raw.draws += 1;
    output.terminalCategories[match.terminalCategory] =
      (output.terminalCategories[match.terminalCategory] || 0) + 1;
    const v1Seat = match.v3Seat ^ 1;
    output.crashes.v3 += match.counts.crashes[match.v3Seat];
    output.crashes.v1 += match.counts.crashes[v1Seat];
    output.stars.v3 += match.counts.stars[match.v3Seat];
    output.stars.v1 += match.counts.stars[v1Seat];
    output.projectiles.v3 += match.counts.bullets[match.v3Seat];
    output.projectiles.v1 += match.counts.bullets[v1Seat];
    addCounts(output.actions.v3, match.v3.actionCounts);
    addCounts(output.actions.v1, match.v1.actionCounts);
    output.runtime.v3TotalMicros += match.v3.totalRuntimeMicros;
    output.runtime.v1TotalMicros += match.v1.totalRuntimeMicros;
    v3P95Weighted += match.v3.p95RuntimeMicros * match.v3.decisionCount;
    v1P95Weighted += match.v1.p95RuntimeMicros * match.v1.decisionCount;
  }
  output.analysis.scoreBasisPoints = Math.round(scoreUnits * 5000 / matches.length);
  output.analysis.scorePercent = (output.analysis.scoreBasisPoints / 100).toFixed(2);
  const v3Decisions = matches.reduce((sum, item) => sum + item.v3.decisionCount, 0);
  const v1Decisions = matches.reduce((sum, item) => sum + item.v1.decisionCount, 0);
  output.runtime.v3WeightedP95Micros = Math.round(v3P95Weighted / Math.max(1, v3Decisions));
  output.runtime.v1WeightedP95Micros = Math.round(v1P95Weighted / Math.max(1, v1Decisions));
  for (let at = 0; at < matches.length; at += 2) {
    const outcomes = [matches[at].analysisOutcome, matches[at + 1].analysisOutcome];
    if (outcomes.every(value => value === "V3_WIN")) output.pairs.v3Sweep += 1;
    else if (outcomes.every(value => value === "V1_WIN")) output.pairs.v1Sweep += 1;
    else if (outcomes.includes("V3_WIN") && outcomes.includes("V1_WIN")) output.pairs.split += 1;
    else if (outcomes.includes("V3_WIN")) output.pairs.v3WinDraw += 1;
    else if (outcomes.includes("V1_WIN")) output.pairs.v1WinDraw += 1;
    else output.pairs.doubleDraw += 1;
  }
  return output;
}

async function main() {
  const matchCount = integerOption("--matches", 128);
  if (matchCount % 2 !== 0) throw new Error("V3_ARENA_MATCH_COUNT_MUST_BE_EVEN");
  const progressEvery = integerOption("--progress-every", 8);
  const outputFile = path.resolve(stringOption("--output", "/tmp/v1-v3-arena-128.json"));
  const v3Mode = stringOption("--v3-mode", "BASE_V3").toUpperCase();
  const v3Options = v3OptionsFor(v3Mode);
  const root = defaultWorkspaceRoot(); const frozen = loadFrozenCandidate(root);
  const cohortFile = stringOption("--cohort", "");
  let rolling; let selection;
  if (cohortFile) {
    const cohort = loadCohort(root, cohortFile, "ALL");
    if (matchCount !== cohort.scenarios.length * 2)
      throw new Error(`V3_ARENA_COHORT_DENOMINATOR:${matchCount}:${cohort.scenarios.length * 2}`);
    rolling = { snapshot: { snapshotId: "VC0_FROZEN",
      fingerprint: cohort.manifest.fingerprint } };
    selection = { selected: cohort.scenarios, available: cohort.scenarios.length,
      unique: cohort.scenarios.length, discoveredAvailable:
        cohort.manifest.dynamicSource.newAvailable, discoveredSelected: 16 };
  } else {
    rolling = loadRollingV1Scenarios(root);
    selection = selectScenarios(rolling, matchCount / 2);
  }
  const simulator = await loadSimulator(root); const v1Code = fs.readFileSync(frozen.v1File, "utf8");
  const matches = []; const started = Date.now();
  for (let scenarioIndex = 0; scenarioIndex < selection.selected.length; scenarioIndex += 1) {
    const scenario = selection.selected[scenarioIndex];
    matches.push(await play(simulator.module, scenario, v1Code, 0, v3Options));
    matches.push(await play(simulator.module, scenario, v1Code, 1, v3Options));
    if (matches.length % progressEvery === 0 || matches.length === matchCount)
      process.stderr.write(`[v1-v3] ${matches.length}/${matchCount} matches, ${Date.now() - started}ms\n`);
  }
  const report = { schemaVersion: 1, objectKind: "V1_V3_STRUCTURED_ARENA_V1",
    generatedAt: new Date().toISOString(), maxFrames: 128, skills: ["stun", "stun"],
    v1Sha256: frozen.manifest.selection.v1Sha256,
    v3Mode, selection: {
      salt: SELECTION_SALT, rollingSnapshotId: rolling.snapshot.snapshotId,
      rollingSnapshotFingerprint: rolling.snapshot.fingerprint,
      availableScenarios: selection.available, uniqueScenarios: selection.unique,
      discoveredAvailable: selection.discoveredAvailable,
      discoveredSelected: selection.discoveredSelected,
      selectedIds: selection.selected.map(item => item.matchUrlId) },
    overview: null, matches };
  report.overview = summarize(matches, { availableScenarios: selection.available,
    uniqueScenarios: selection.unique, discoveredAvailable: selection.discoveredAvailable,
    discoveredSelected: selection.discoveredSelected }, Date.now() - started);
  const fingerprintPayload = { ...report };
  delete fingerprintPayload.generatedAt;
  delete fingerprintPayload.fingerprint;
  report.fingerprint = fingerprintObject(fingerprintPayload);
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputFile, fingerprint: report.fingerprint,
    overview: report.overview }, null, 2)}\n`);
}

if (require.main === module)
  main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { SELECTION_SALT, hashRank, selectScenarios, seedFor, play, summarize,
  translateAnalysis, v3OptionsFor };
