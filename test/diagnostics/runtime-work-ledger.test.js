"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionDiagnosticBot } =
  require("../../tools/agentank/simulation/production-diagnostic-bot");
const { WORK_KIND } = require("../../engine-v2/src/abi/cache-runtime-codes");
const { RUNTIME_CONFIG } = require("../../engine-v2/src/generated/runtime-config");

test("diagnostic work ledger accounts each runtime kind without changing charges", () => {
  const bot = new ProductionDiagnosticBot({ captureWorkLedger: true });
  const runtime = bot.engine.runtime;
  runtime.beginCallback(0, 1, 2, true);
  runtime.charge(WORK_KIND.ROOT, 1);
  runtime.charge(WORK_KIND.HARD, 3);
  runtime.chargeUnits(17, WORK_KIND.CACHE);
  runtime.finishCallback();

  const summary = bot.summary();
  assert.equal(summary.workLedger.units.ROOT, RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.ROOT]);
  assert.equal(summary.workLedger.units.HARD,
    RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.HARD] * 3);
  assert.equal(summary.workLedger.units.CACHE, 17);
  assert.equal(summary.workLedger.calls.ROOT, 1);
  assert.equal(summary.workLedger.calls.HARD, 1);
  assert.equal(summary.workLedger.calls.CACHE, 1);
  const mandatory = RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.ROOT] +
    RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.HARD] * 3;
  assert.equal(summary.workLedger.totalUnits, mandatory + 17);
  assert.deepEqual(summary.workLedger.accountUnits, { MANDATORY: mandatory, OPTIONAL: 17 });
  assert.equal(summary.accumulatedWorkUnits, mandatory + 17);
  assert.equal(summary.accumulatedMandatoryWorkUnits, mandatory);
  assert.equal(summary.accumulatedOptionalWorkUnits, 17);
});

test("optional Hard cache-build premium stays outside the mandatory reserve ledger", () => {
  const bot = new ProductionDiagnosticBot({ captureWorkLedger: true });
  const runtime = bot.engine.runtime;
  runtime.beginCallback(0, 1, 2, true);
  runtime.chargeMandatory(WORK_KIND.ROOT, 1);
  runtime.chargeOptional(WORK_KIND.FAST_TRANSITION, 2);
  runtime.chargeOptional(WORK_KIND.CACHE, 2);
  const hardPremium = RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.HARD] -
    RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.CACHE];
  runtime.chargeOptionalUnits(hardPremium, WORK_KIND.HARD);
  runtime.finishCallback();

  const summary = bot.summary();
  const mandatory = RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.ROOT];
  const optional = RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.FAST_TRANSITION] * 2 +
    RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.CACHE] * 2 + hardPremium;
  assert.deepEqual(summary.workLedger.accountUnits, { MANDATORY: mandatory, OPTIONAL: optional });
  assert.equal(summary.accumulatedMandatoryWorkUnits, mandatory);
  assert.equal(summary.accumulatedOptionalWorkUnits, optional);
  assert.equal(summary.accumulatedWorkUnits, mandatory + optional);
});

test("diagnostic work ledger is absent by default", () => {
  const bot = new ProductionDiagnosticBot();
  const summary = bot.summary();
  assert.equal(summary.workLedger, undefined);
  assert.deepEqual(summary.runtimeSchedule.firstModeFrame, [-1, -1, -1, -1]);
  assert.equal(summary.runtimeSchedule.searchFrames, 0);
});

test("diagnostic phase timer is opt-in and wraps only coarse engine stages", () => {
  const plain = new ProductionDiagnosticBot();
  assert.equal(plain.summary().phaseTiming, undefined);

  const timed = new ProductionDiagnosticBot({ capturePhaseTiming: true });
  timed.engine.prepareNavigation();
  const summary = timed.summary();
  assert.equal(summary.phaseTiming.calls.NAVIGATION, 1);
  assert.ok(summary.phaseTiming.micros.NAVIGATION >= 0);
  assert.ok(summary.phaseTiming.exclusiveMicros.NAVIGATION >= 0);
  assert.equal(summary.phaseTiming.calls.INFORMATION_SEARCH, 0);
  assert.equal(summary.phaseTiming.matrixIterations, 0);
});

test("diagnostic phase timer separates nested inclusive and exclusive work", () => {
  const timed = new ProductionDiagnosticBot({ capturePhaseTiming: true });
  const solver = timed.engine.search.matrixSolver;
  timed.engine.search.matrix.initialize(2, 2);
  timed.engine.search.matrix.setCell(0, 0, 1, 1, 1);
  timed.engine.search.matrix.setCell(0, 1, -1, -1, 1);
  timed.engine.search.matrix.setCell(1, 0, -1, -1, 1);
  timed.engine.search.matrix.setCell(1, 1, 1, 1, 1);
  solver.solve(8, 4);
  const summary = timed.summary();
  assert.equal(summary.phaseTiming.calls.MATRIX_SOLVER, 1);
  assert.equal(summary.phaseTiming.matrixIterations, solver.iterations);
  assert.ok(summary.phaseTiming.micros.MATRIX_SOLVER >=
    summary.phaseTiming.exclusiveMicros.MATRIX_SOLVER);
});
