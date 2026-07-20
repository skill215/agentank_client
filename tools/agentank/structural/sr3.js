"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { RiskAcceptanceController } =
  require("../../../engine-v2/src/search/risk-acceptance-controller");
const { HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { SAFETY_STATUS } = require("../../../engine-v2/src/search/information-safety-closure");
const { summarizeTestOutput } = require("../harness/test-runner");
const { timedBatches } = require("./sr1");
const { runFixedArena } = require("./fixed-arena");
const { sourceIdentity } = require("../diagnostics/v1-v2-working-arena");

function benchmarkRiskController() {
  const controller = new RiskAcceptanceController(); const o = controller.outcome; o.reset(8);
  for (let row = 0; row < 8; row += 1) { o.hard[row] = HARD_STATUS.ALLOW;
    o.safety[row] = SAFETY_STATUS.PROVEN_SAFE; o.coverage[row] = 10000;
    o.escapeSlack[row] = row - 4; o.immediateFatalMass[row] = row * 100;
    o.horizonFatalMass[row] = row * 200; o.unknownMass[row] = row * 50;
    o.robustLower[row] = row * 100; o.expectedValue[row] = row * 120;
    o.tacticalValue[row] = row * 90; }
  const result = timedBatches(() => { for (let iteration = 0; iteration < 1000; iteration += 1) {
    controller.gate(iteration % 101, iteration & 3); controller.select(iteration * 2654435761); } });
  return { ...result, fixedNode: process.version, warmupBatches: 1, measuredBatches: 5,
    hotAllocationCount: controller.hotAllocationCount + controller.outcome.hotAllocationCount };
}
function loadArenaEvidence(root) {
  const file = path.join(root, "artifacts", "reports", "structural-repair", "SR3",
    "sr3-fixed-arena.json");
  if (!fs.existsSync(file)) return { status: "NOT_RUN", file, analysisV2Wins: 0,
    v2SingleCrashLosses: 0, avoidableHardRejects: -1, rootRestoreFailures: -1,
    v2Timeouts: -1, v2Errors: -1 };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
async function ensureArenaEvidence(root) {
  let arena = loadArenaEvidence(root); const source = sourceIdentity(root);
  if (arena.status !== "NOT_RUN" && arena.source?.sha256 === source.sha256) return arena;
  const result = await runFixedArena(root, "SR3", { onProgress(done, total, matchId, variant) {
    process.stderr.write(`[SR3 arena] ${done}/${total} ${matchId} ${variant}\n`);
  } }); return result.report;
}
async function verify(root, options) {
  const tests = summarizeTestOutput(root, options.testOutputFile, options.testExitCode,
    `${root}/artifacts/reports/structural-repair/SR3`, { testDirectories: ["sr3"] });
  const benchmark = benchmarkRiskController(); const predecessorP95 = 544;
  const limit = Math.floor(predecessorP95 * 12000 / 10000); const arena = await ensureArenaEvidence(root);
  const arenaReady = arena.status === "PASS";
  const checks = [
    { checkId: "SR3_TESTS", status: tests.report.status,
      evidence: { tests: tests.report.tests, pass: tests.report.pass, fail: tests.report.fail } },
    { checkId: "RISK_CONTROLLER_P95_GUARD", status: benchmark.p95Micros <= limit ? "PASS" : "FAIL",
      evidence: { p95Micros: benchmark.p95Micros, predecessorP95Micros: predecessorP95,
        limitMicros: limit } },
    { checkId: "RISK_CONTROLLER_HOT_ALLOCATIONS_ZERO", status:
      benchmark.hotAllocationCount === 0 ? "PASS" : "FAIL" },
    { checkId: "FIXED_SR0_ARENA_COMPLETE", status: arenaReady ? "PASS" : "BLOCKED",
      evidence: { status: arena.status, file: path.relative(root, arena.file || "") } },
    { checkId: "SR3_ANALYSIS_WINS", status: !arenaReady ? "BLOCKED" :
      arena.analysisV2Wins >= 987 ? "PASS" : "FAIL",
      evidence: { actual: arena.analysisV2Wins, minimum: 987 } },
    { checkId: "SR3_SINGLE_CRASH_LOSSES", status: !arenaReady ? "BLOCKED" :
      arena.v2SingleCrashLosses <= 644 ? "PASS" : "FAIL",
      evidence: { actual: arena.v2SingleCrashLosses, maximum: 644 } },
    { checkId: "SR3_HARD_INVARIANTS", status: !arenaReady ? "BLOCKED" :
      arena.avoidableHardRejects === 0 && arena.rootRestoreFailures === 0 &&
      arena.v2Timeouts === 0 && arena.v2Errors === 0 ? "PASS" : "FAIL",
      evidence: { avoidableHardRejects: arena.avoidableHardRejects,
        rootRestoreFailures: arena.rootRestoreFailures, v2Timeouts: arena.v2Timeouts,
        v2Errors: arena.v2Errors } }
  ];
  return { checks, benchmark: { stage: "SR3", status: checks.some(item => item.status === "FAIL") ?
      "FAIL" : "PASS", predecessorP95Micros: predecessorP95, p95LimitMicros: limit, ...benchmark },
    regression: { status: tests.report.status, denominator: tests.report.tests,
      pass: tests.report.pass, fail: tests.report.fail }, arena };
}
module.exports = { benchmarkRiskController, loadArenaEvidence, ensureArenaEvidence, verify };
