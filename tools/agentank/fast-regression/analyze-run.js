"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const zlib = require("node:zlib");
const { invariant } = require("../core/errors");
const { classifyAnalysisOutcome, pairCategory } = require("../analysis/analysis-outcome");
const { FastRegressionStore } = require("./artifact-store");

const OUTCOMES = Object.freeze(["V1_WIN", "V2_WIN", "DRAW"]);
function emptyWld() { return { V1_WIN: 0, V2_WIN: 0, DRAW: 0 }; }
function increment(target, key) { target[key] = (target[key] || 0) + 1; }
function rate(numerator, denominator) {
  return denominator > 0 ? Math.floor(numerator * 10000 / denominator) : 0;
}

class FullRunAccumulator {
  constructor(manifest) {
    this.manifest = manifest; this.matchCount = 0; this.scenarios = new Set();
    this.analysis = emptyWld(); this.raw = { v1: 0, v2: 0, draw: 0 };
    this.transitions = {}; this.terminal = {}; this.variants = {}; this.families = {};
    this.singleCrash = { v1Wins: 0, v2Wins: 0 }; this.pairs = new Map();
  }

  add(match) {
    const result = classifyAnalysisOutcome(match); this.matchCount += 1;
    this.scenarios.add(match.historicalMatchUrlId); increment(this.analysis, result.analysisOutcome);
    const raw = match.result?.winnerImplementation;
    increment(this.raw, raw === "v1" ? "v1" : raw === "v2" ? "v2" : "draw");
    increment(this.transitions, `${raw || "draw"}_TO_${result.analysisOutcome}`);
    this.terminal[result.terminalCategory] ||= emptyWld();
    increment(this.terminal[result.terminalCategory], result.analysisOutcome);
    this.variants[match.variantId] ||= emptyWld();
    this.families[match.family] ||= emptyWld();
    increment(this.variants[match.variantId], result.analysisOutcome);
    increment(this.families[match.family], result.analysisOutcome);
    if (result.terminalCategory === "SINGLE_CRASH") {
      if (result.analysisOutcome === "V2_WIN") this.singleCrash.v2Wins += 1;
      if (result.analysisOutcome === "V1_WIN") this.singleCrash.v1Wins += 1;
    }
    const pairKey = `${match.historicalMatchUrlId}:${match.family}:r${match.repetition}`;
    const pair = this.pairs.get(pairKey) || []; pair.push(result); this.pairs.set(pairKey, pair);
  }

  finish() {
    const withRates = value => ({ ...value,
      strictWinRatePer10000: rate(value.V2_WIN, value.V1_WIN + value.V2_WIN + value.DRAW),
      scoreRatePer10000: rate(value.V2_WIN * 2 + value.DRAW,
        (value.V1_WIN + value.V2_WIN + value.DRAW) * 2) });
    const analysis = withRates(this.analysis); const scoreUnits = analysis.V2_WIN * 2 + analysis.DRAW;
    const pair = { pairCount: this.pairs.size, V2_SWEEP: 0, V1_SWEEP: 0, SPLIT: 0,
      V2_WIN_DRAW: 0, V1_WIN_DRAW: 0, DOUBLE_DRAW: 0 };
    const pairByFamily = {};
    for (const [key, values] of this.pairs) {
      invariant(values.length === 2, "FAST_REGRESSION_PAIR_INCOMPLETE", `${key}:${values.length}`);
      const category = pairCategory(values[0], values[1]); increment(pair, category);
      const family = key.includes(":SKILL_CROSS:") ? "SKILL_CROSS" : "NATIVE";
      pairByFamily[family] ||= { pairCount: 0, V2_SWEEP: 0, V1_SWEEP: 0, SPLIT: 0,
        V2_WIN_DRAW: 0, V1_WIN_DRAW: 0, DOUBLE_DRAW: 0 };
      pairByFamily[family].pairCount += 1; increment(pairByFamily[family], category);
    }
    const crashBaseline = 325; const crashMinimum = Math.ceil(crashBaseline * 11000 / 10000);
    const totalThreshold = 6000;
    const arena = this.manifest.summary.arena;
    const gates = {
      singleCrashIncrease10Percent: { status: this.singleCrash.v2Wins >= crashMinimum ? "PASS" : "FAIL",
        actual: this.singleCrash.v2Wins, baseline: crashBaseline, minimum: crashMinimum,
        increasePer10000: rate(this.singleCrash.v2Wins - crashBaseline, crashBaseline) },
      totalAnalysisRateStrictlyOver60Percent: {
        status: analysis.scoreRatePer10000 > totalThreshold ? "PASS" : "FAIL",
        definition: "WIN_PLUS_HALF_DRAW", actualRatePer10000: analysis.scoreRatePer10000,
        thresholdPer10000: totalThreshold, comparison: "STRICTLY_GREATER_THAN",
        scoreUnits, minimumScoreUnits: Math.floor(this.matchCount * 2 * totalThreshold / 10000) + 1,
        deficitScoreUnits: Math.max(0,
          Math.floor(this.matchCount * 2 * totalThreshold / 10000) + 1 - scoreUnits) },
      reliability: { status: arena.avoidableHardRejects === 0 &&
        arena.riskDominatedSelections === 0 && arena.rootRestoreFailures === 0 &&
        arena.v2Timeouts === 0 && arena.v2Errors === 0 ? "PASS" : "FAIL",
        avoidableHardRejects: arena.avoidableHardRejects,
        riskDominatedSelections: arena.riskDominatedSelections,
        rootRestoreFailures: arena.rootRestoreFailures, v2Timeouts: arena.v2Timeouts,
        v2Errors: arena.v2Errors }
    };
    return { denominator: { matches: this.matchCount, scenarios: this.scenarios.size,
      repetitions: arena.repetitions, variantsPerScenario: arena.variantsPerScenario },
    raw: this.raw, analysis, transitions: this.transitions,
    terminal: Object.fromEntries(Object.entries(this.terminal).map(([key, value]) =>
      [key, withRates(value)])),
    variants: Object.fromEntries(Object.entries(this.variants).map(([key, value]) =>
      [key, withRates(value)])),
    families: Object.fromEntries(Object.entries(this.families).map(([key, value]) =>
      [key, withRates(value)])),
    singleCrash: this.singleCrash, pairs: pair, pairByFamily, gates,
    localRuntime: { authority: "RELATIVE_LOCAL_ONLY_NOT_PLATFORM_TIMEOUT_EVIDENCE",
      v2: arena.v2Runtime, v1: arena.v1Runtime,
      totalRatioPer10000: rate(arena.v2Runtime.total, arena.v1Runtime.total),
      p95RatioPer10000: rate(arena.v2Runtime.p95PerMatch, arena.v1Runtime.p95PerMatch) },
    actionPressure: { v2Fire: arena.v2ActionCounts.FIRE || 0,
      v1Fire: arena.v1ActionCounts.fire || 0,
      v2ToV1FireRatioPer10000: rate(arena.v2ActionCounts.FIRE || 0,
        arena.v1ActionCounts.fire || 0) } };
  }
}

async function analyzeFullRun(workspaceRoot, runId) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const manifestFile = path.join(store.paths.runs, runId, "manifest.json");
  invariant(fs.existsSync(manifestFile), "FAST_REGRESSION_RUN_NOT_FOUND", runId);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  invariant(manifest.completion === "COMPLETE", "FAST_REGRESSION_RUN_NOT_COMPLETE", runId);
  const matchArtifact = manifest.artifacts.matches;
  const accumulator = new FullRunAccumulator(manifest);
  const input = fs.createReadStream(path.join(store.paths.runs, runId, matchArtifact.file))
    .pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) if (line) accumulator.add(JSON.parse(line));
  invariant(accumulator.matchCount === matchArtifact.records,
    "FAST_REGRESSION_MATCH_DENOMINATOR_MISMATCH",
    `${accumulator.matchCount}/${matchArtifact.records}`);
  const analysis = accumulator.finish();
  const allPass = Object.values(analysis.gates).every(gate => gate.status === "PASS");
  return store.writeReport({ artifactKind: "FAST_REGRESSION_FULL_ARENA_ANALYSIS",
    status: allPass ? "ACCEPTED" : "REJECTED",
    properties: ["RUNTIME_INDEPENDENT_OUTCOME", "FULL_DYNAMIC_HISTORY",
      "SOURCE_BOUND", "RULE_BOUND"],
    run: { runId, manifestFingerprint: manifest.fingerprint,
      historySnapshotFingerprint: manifest.descriptor.historySnapshotFingerprint,
      v1: manifest.descriptor.v1, v2: manifest.descriptor.v2,
      simulator: manifest.descriptor.simulator, captureHarness: manifest.descriptor.captureHarness },
    ...analysis }, "arena-full");
}

module.exports = { OUTCOMES, emptyWld, rate, FullRunAccumulator, analyzeFullRun };
