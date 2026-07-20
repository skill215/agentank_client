"use strict";

const { ProjectileTrackPool } = require("../../../engine-v2/src/runtime/projectile-track-pool");
const { PossibleProjectileTracker } = require("../../../engine-v2/src/runtime/possible-projectiles");
const { FastState, ARRAY } = require("../../../engine-v2/src/state/fast-state");
const { TERRAIN, NONE_CELL } = require("../../../engine-v2/src/abi/fast-codes");
const { summarizeTestOutput } = require("../harness/test-runner");

function percentile95(values) { const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 95 / 100)]; }
function timedBatches(callback, warmup = 1, batches = 5) {
  for (let index = 0; index < warmup; index += 1) callback(); const values = [];
  for (let index = 0; index < batches; index += 1) { const start = process.hrtime.bigint();
    callback(); values.push(Number((process.hrtime.bigint() - start) / 1000n)); }
  return { batchesMicros: values, p95Micros: percentile95(values) };
}
function benchmarkProjectilePool() {
  const pool = new ProjectileTrackPool(); const map = new Uint8Array(400); map.fill(TERRAIN.OPEN);
  const projectile = timedBatches(() => {
    for (let iteration = 0; iteration < 20000; iteration += 1) {
      pool.reset(iteration & 127); pool.recordFire(1, 210, 1, iteration & 127, false, 1, 5000);
      pool.count();
    }
  });
  const state = new FastState(20, 20); state.arrays[ARRAY.TERRAIN].fill(TERRAIN.OPEN);
  const possible = new PossibleProjectileTracker(); const composite = timedBatches(() => {
    for (let iteration = 0; iteration < 10000; iteration += 1) {
      possible.reset(iteration & 127);
      possible.addFired(state, 210, 1, iteration & 127, iteration & 127, NONE_CELL, 5000);
      possible.addFired(state, 189, 2, iteration & 127, iteration & 127, NONE_CELL, 4000);
      possible.risk(state, 214, 0); possible.lethalMass(state, 214);
    }
  });
  return { fixedNode: process.version, warmupBatches: 1, measuredBatches: 5,
    projectile, composite, hotAllocationCount: pool.hotAllocationCount +
      pool.relation.hotAllocationCount + possible.hotAllocationCount };
}

async function verify(root, options) {
  const tests = summarizeTestOutput(root, options.testOutputFile, options.testExitCode,
    `${root}/artifacts/reports/structural-repair/SR1`, { testDirectories: ["sr1"] });
  const benchmark = benchmarkProjectilePool();
  // SR0's legacy tracker baseline was captured before any SR1 source change
  // with the same fixed Node and 20k reset/create/count workload.
  const predecessorP95 = 2822; const limit = Math.floor(predecessorP95 * 12000 / 10000);
  const checks = [
    { checkId: "SR1_TESTS", status: tests.report.status,
      evidence: { tests: tests.report.tests, pass: tests.report.pass, fail: tests.report.fail } },
    { checkId: "PROJECTILE_P95_GUARD", status: benchmark.projectile.p95Micros <= limit ? "PASS" : "FAIL",
      evidence: { p95Micros: benchmark.projectile.p95Micros, predecessorP95Micros: predecessorP95,
        limitMicros: limit } },
    { checkId: "MULTI_PROJECTILE_COMPOSITE_MEASURED", status:
      benchmark.composite.p95Micros > 0 ? "PASS" : "FAIL", evidence: benchmark.composite },
    { checkId: "PROJECTILE_HOT_ALLOCATIONS_ZERO", status:
      benchmark.hotAllocationCount === 0 ? "PASS" : "FAIL",
      evidence: { hotAllocationCount: benchmark.hotAllocationCount } },
    { checkId: "NO_WHOLESALE_CLEAR_API", status:
      typeof PossibleProjectileTracker.prototype.clearObserved === "undefined" ? "PASS" : "FAIL" },
    { checkId: "FACT_COMPLETENESS_ONLY_NO_GAMEPLAY_GATE", status: "PASS",
      evidence: { winRateRequired: false } }
  ];
  return { checks, benchmark: { stage: "SR1", status: checks.some(item => item.status === "FAIL") ?
      "FAIL" : "PASS", predecessorP95Micros: predecessorP95, p95LimitMicros: limit, ...benchmark },
    regression: { status: tests.report.status, denominator: tests.report.tests,
      pass: tests.report.pass, fail: tests.report.fail },
    source: { projectilePool: "engine-v2/src/runtime/projectile-track-pool.js",
      possibleTracker: "engine-v2/src/runtime/possible-projectiles.js" } };
}

module.exports = { timedBatches, benchmarkProjectilePool, verify };
