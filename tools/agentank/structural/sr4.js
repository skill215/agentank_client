"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ProductionRootEngine } = require("../../../engine-v2/src/runtime/production-root");
const { NONE_HANDLE } = require("../../../engine-v2/src/abi/policy-codes");
const { productionRootFixture } = require("../build/imp6-builder");
const { summarizeTestOutput } = require("../harness/test-runner");
const { timedBatches } = require("./sr1");
const { runFixedArena, runRollingDiscoveryArena } = require("./fixed-arena");
const { buildRollingDiscoveryCohort } = require("./rolling-discovery");
const { sourceIdentity } = require("../diagnostics/v1-v2-working-arena");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");
const { fingerprintObject } = require("../core/hash");
const { writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");

function benchmarkCombatPressure() {
  const fixture = productionRootFixture(); fixture.enemy.status.fireLocked = true;
  const engine = new ProductionRootEngine(); engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
  engine.generateActions(); const count = engine.ourCount - 1;
  for (let row = 0; row < count; row += 1) { const packed = engine.projected(engine.ourActions[row]);
    engine.projectedCell[row] = (packed / 4) | 0; engine.projectedDirection[row] = packed & 3; }
  const result = timedBatches(() => {
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const vector = engine.combat.evaluate(engine.adapter.bundle, engine.ourActions, count,
        engine.projectedCell, engine.projectedDirection, engine.adapter.enemyVisible,
        engine.beliefCoverage);
      for (let row = 0; row < count; row += 1) { const handle = engine.planSketchHandle[row];
        if (handle !== NONE_HANDLE) engine.policy.sketches.annotateCombat(handle, vector, row); }
    }
  });
  return { ...result, fixedNode: process.version, warmupBatches: 1, measuredBatches: 5,
    operationCountPerBatch: 24 * count, hotAllocationCount: engine.combat.hotAllocationCount +
      engine.combat.vector.hotAllocationCount + engine.policy.sketches.hotAllocationCount };
}

function outcome(match) { return classifyAnalysisOutcome(match).analysisOutcome; }
function pairSummary(matches) {
  const pairs = new Map();
  for (const match of matches) {
    const key = `${match.historicalMatchUrlId}:${match.family}:r${match.repetition}`;
    let pair = pairs.get(key); if (!pair) { pair = []; pairs.set(key, pair); }
    pair.push(outcome(match));
  }
  const summary = { pairCount: pairs.size, v2Sweep: 0, v1Sweep: 0, split: 0,
    v2WinDraw: 0, v1WinDraw: 0, doubleDraw: 0 };
  for (const values of pairs.values()) {
    const v2 = values.filter(value => value === "V2_WIN").length;
    const v1 = values.filter(value => value === "V1_WIN").length;
    const draw = values.length - v2 - v1;
    if (v2 === 2) summary.v2Sweep += 1; else if (v1 === 2) summary.v1Sweep += 1;
    else if (v2 === 1 && v1 === 1) summary.split += 1;
    else if (v2 === 1 && draw === 1) summary.v2WinDraw += 1;
    else if (v1 === 1 && draw === 1) summary.v1WinDraw += 1;
    else if (draw === 2) summary.doubleDraw += 1;
  }
  return summary;
}
function comparison(root, arena) {
  const baselineFile = path.join(root, "artifacts", "reports", "structural-repair", "SR3",
    "sr3-fixed-arena.json"); const baseline = JSON.parse(fs.readFileSync(baselineFile));
  const before = new Map(baseline.matches.map(match => [match.matchId, outcome(match)]));
  const transitions = {}; let crashWins = 0; let starWins = 0;
  for (const match of arena.matches) {
    const left = before.get(match.matchId) || "MISSING"; const right = outcome(match);
    const key = `${left}_TO_${right}`; transitions[key] = (transitions[key] || 0) + 1;
    if (right === "V2_WIN" && match.result.reason === "crashed") crashWins += 1;
    if (right === "V2_WIN" && match.result.reason === "frameLimit") starWins += 1;
  }
  const report = { schemaVersion: 1, reportKind: "SR4_COMBAT_REGRESSION",
    baseline: { stage: "SR3", fingerprint: baseline.fingerprint },
    current: { stage: "SR4", fingerprint: arena.fingerprint }, transitions,
    pairSummary: pairSummary(arena.matches), terminalWins: { crash: crashWins, star: starWins },
    runtimeWinnerExcludedFromAnalysis: true, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); const directory = path.join(root, "artifacts",
    "reports", "structural-repair", "SR4"); const file = path.join(directory,
    "sr4-regression-report.json"); writeJsonAtomic(file, report, { mode: 0o644 });
  writeJsonImmutable(path.join(directory, "history", `sr4-regression-${report.fingerprint}.json`),
    report, { mode: 0o644 }); return report;
}
function loadArenaEvidence(root) {
  const file = path.join(root, "artifacts", "reports", "structural-repair", "SR4",
    "sr4-fixed-arena.json");
  if (!fs.existsSync(file)) return { status: "NOT_RUN", file, analysisV2Wins: 0,
    v2SingleCrashWins: 0, avoidableHardRejects: -1, riskDominatedSelections: -1,
    rootRestoreFailures: -1, v2Timeouts: -1, v2Errors: -1 };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
async function ensureArenaEvidence(root) {
  let arena = loadArenaEvidence(root); const source = sourceIdentity(root);
  if (arena.status !== "NOT_RUN" && arena.source?.sha256 === source.sha256) return arena;
  const result = await runFixedArena(root, "SR4", { onProgress(done, total, matchId, variant) {
    process.stderr.write(`[SR4 arena] ${done}/${total} ${matchId} ${variant}\n`);
  } }); return result.report;
}
function loadRollingArenaEvidence(root) {
  const file = path.join(root, "artifacts", "reports", "structural-repair", "SR4",
    "sr4-rolling-discovery-arena.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}
async function ensureRollingArenaEvidence(root, cohort) {
  const source = sourceIdentity(root); const current = loadRollingArenaEvidence(root);
  if (current?.source?.sha256 === source.sha256 && current.cohort?.snapshotFingerprint ===
      cohort.manifest.sourceSnapshot.fingerprint && current.cohort?.scenarioCount ===
      cohort.scenarios.length) return current;
  const result = await runRollingDiscoveryArena(root, "SR4", cohort.scenarios,
    { snapshotId: cohort.manifest.sourceSnapshot.snapshotId,
      headId: cohort.manifest.sourceSnapshot.headId,
      fingerprint: cohort.manifest.sourceSnapshot.fingerprint },
    { onProgress(done, total, matchId, variant) {
      process.stderr.write(`[SR4 rolling] ${done}/${total} ${matchId} ${variant}\n`);
    } });
  return result.report;
}
async function verify(root, options) {
  const tests = summarizeTestOutput(root, options.testOutputFile, options.testExitCode,
    `${root}/artifacts/reports/structural-repair/SR4`, { testDirectories: ["sr4", "minimax-core"] });
  const benchmark = benchmarkCombatPressure(); const predecessorP95 = 477;
  const limit = Math.floor(predecessorP95 * 12000 / 10000);
  const rollingCohort = buildRollingDiscoveryCohort(root, "SR4");
  const arena = await ensureArenaEvidence(root);
  const rollingArena = await ensureRollingArenaEvidence(root, rollingCohort);
  const arenaReady = arena.status === "PASS"; const regression = arenaReady ? comparison(root, arena) : null;
  const hardPass = arenaReady && arena.avoidableHardRejects === 0 &&
    arena.riskDominatedSelections === 0 && arena.rootRestoreFailures === 0 &&
    arena.v2Timeouts === 0 && arena.v2Errors === 0;
  const crashBaseline = 325; const crashIncreasePer10000 = 1000;
  const crashMinimum = Math.ceil(crashBaseline * (10000 + crashIncreasePer10000) / 10000);
  const matchCount = arena.cohort?.matchCount || 0; const winRateThresholdPer10000 = 6000;
  const scoreUnits = Number.isSafeInteger(arena.analysisScoreUnits) ? arena.analysisScoreUnits :
    arena.analysisV2Wins * 2 + arena.analysisDraws;
  const scoreUnitMinimum = Math.floor(matchCount * 2 * winRateThresholdPer10000 / 10000) + 1;
  const winRatePass = arenaReady && matchCount > 0 &&
    scoreUnits * 10000 > matchCount * 2 * winRateThresholdPer10000;
  const rollingReady = rollingArena?.status === "PASS" &&
    rollingArena.cohort?.scenarioCount === rollingCohort.scenarios.length;
  const checks = [
    { checkId: "SR4_TESTS", status: tests.report.status,
      evidence: { tests: tests.report.tests, pass: tests.report.pass, fail: tests.report.fail } },
    { checkId: "MINIMAX_CORE_ORACLE_CONSTRAINT_SUITE", status: tests.report.status === "PASS" &&
      tests.report.testFileCount >= 7 && tests.report.tests >= 43 ? "PASS" : "FAIL",
      evidence: { scopedTestFiles: tests.report.testFileCount, minimumScopedFiles: 7,
        combinedTests: tests.report.tests, minimumCombinedTests: 43,
        testDirectories: ["sr4", "minimax-core"] } },
    { checkId: "COMBAT_SHOTPLAN_P95_GUARD", status: benchmark.p95Micros <= limit ? "PASS" : "FAIL",
      evidence: { p95Micros: benchmark.p95Micros, predecessorP95Micros: predecessorP95,
        limitMicros: limit, operationCountPerBatch: benchmark.operationCountPerBatch } },
    { checkId: "COMBAT_SHOTPLAN_HOT_ALLOCATIONS_ZERO", status:
      benchmark.hotAllocationCount === 0 ? "PASS" : "FAIL" },
    { checkId: "FIXED_SR0_ARENA_COMPLETE", status: arenaReady ? "PASS" : "BLOCKED",
      evidence: { status: arena.status, file: path.relative(root, arena.file || "") } },
    { checkId: "DYNAMIC_V1_ROLLING_COHORT_CURRENT", status:
      rollingCohort.manifest.denominator.scenarios >= 266 &&
      rollingCohort.manifest.denominator.discoveredBeyondFrozen === rollingCohort.scenarios.length ?
        "PASS" : "FAIL", evidence: { sourceSnapshot: rollingCohort.manifest.sourceSnapshot,
        denominator: rollingCohort.manifest.denominator,
        cohortFile: path.relative(root, rollingCohort.file) } },
    { checkId: "ROLLING_DISCOVERY_ARENA_INVARIANTS", status: rollingReady ? "PASS" : "FAIL",
      evidence: { status: rollingArena?.status || "MISSING", cohort: rollingArena?.cohort || null,
        avoidableHardRejects: rollingArena?.avoidableHardRejects ?? -1,
        riskDominatedSelections: rollingArena?.riskDominatedSelections ?? -1,
        rootRestoreFailures: rollingArena?.rootRestoreFailures ?? -1,
        v2Timeouts: rollingArena?.v2Timeouts ?? -1, v2Errors: rollingArena?.v2Errors ?? -1 } },
    { checkId: "SR4_SINGLE_CRASH_WINS", status: !arenaReady ? "BLOCKED" :
      arena.v2SingleCrashWins >= crashMinimum ? "PASS" : "FAIL",
      evidence: { actual: arena.v2SingleCrashWins, baseline: crashBaseline,
        requiredIncreasePer10000: crashIncreasePer10000, minimum: crashMinimum } },
    { checkId: "SR4_ANALYSIS_WIN_RATE_STRICTLY_OVER_60_PERCENT", status: !arenaReady ? "BLOCKED" :
      winRatePass ? "PASS" : "FAIL",
      evidence: { definition: "WIN_PLUS_HALF_DRAW", actualWins: arena.analysisV2Wins,
        actualDraws: arena.analysisDraws, scoreUnits, matchCount,
        actualRatePer10000: matchCount ? Math.floor(scoreUnits * 10000 / (matchCount * 2)) : 0,
        thresholdPer10000: winRateThresholdPer10000, comparison: "STRICTLY_GREATER_THAN",
        minimumScoreUnitsForCohort: scoreUnitMinimum } },
    { checkId: "SR4_HARD_AND_DOMINANCE_INVARIANTS", status: !arenaReady ? "BLOCKED" :
      hardPass ? "PASS" : "FAIL", evidence: { avoidableHardRejects: arena.avoidableHardRejects,
        riskDominatedSelections: arena.riskDominatedSelections,
        rootRestoreFailures: arena.rootRestoreFailures, v2Timeouts: arena.v2Timeouts,
        v2Errors: arena.v2Errors } },
    { checkId: "SR4_TRANSITION_REPORT_COMPLETE", status: regression &&
      regression.pairSummary.pairCount === 1064 ? "PASS" : arenaReady ? "FAIL" : "BLOCKED",
      evidence: regression || {} }
  ];
  return { checks, benchmark: { stage: "SR4", status: checks.some(item => item.status === "FAIL") ?
      "FAIL" : "PASS", predecessorP95Micros: predecessorP95, p95LimitMicros: limit, ...benchmark },
    regression: { status: tests.report.status, denominator: tests.report.tests,
      pass: tests.report.pass, fail: tests.report.fail }, arena,
    combatRegression: regression, rollingCohort: rollingCohort.manifest,
    rollingArena };
}

module.exports = { benchmarkCombatPressure, pairSummary, comparison, loadArenaEvidence,
  ensureArenaEvidence, loadRollingArenaEvidence, ensureRollingArenaEvidence, verify };
