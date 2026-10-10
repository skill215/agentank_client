"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { STRATEGY, STRATEGY_BAND, STRATEGY_PURPOSE, COMBAT_PURPOSE, GLOBAL_MODE } =
  require("../../engine-v2/src/abi/policy-codes");
const { REVERSAL_KILL, REVERSAL_STAR, StrategyBandSlab } =
  require("../../engine-v2/src/policy/strategy-layer");
const { RiskAcceptanceController } =
  require("../../engine-v2/src/search/risk-acceptance-controller");
const { StageMatrix } = require("../../engine-v2/src/search/matrix");

function combat(count) {
  return { count, purposeFlags: new Uint8Array(count),
    purposeCompleteness: new Uint16Array(count), postFireEscape: new Uint8Array(count),
    ownCounterExposure: new Uint16Array(count) };
}

function controller(values, acceptable = null, safeFloor = null) {
  const count = values.length; const c = new RiskAcceptanceController(); const o = c.outcome;
  o.reset(count); c.acceptableCount = 0;
  for (let row = 0; row < count; row += 1) {
    o.acceptable[row] = acceptable ? acceptable[row] : 1;
    if (o.acceptable[row]) c.acceptableCount += 1;
    o.dominated[row] = 0; o.robustLower[row] = values[row];
    o.expectedValue[row] = values[row]; o.tacticalValue[row] = values[row];
  }
  c.safeFloor = safeFloor === null ? Math.max(...values) : safeFloor; return c;
}

test("KILL_PRESSURE exposes verified fire and does not use star as a global additive override", () => {
  const actions = new Uint8Array([ACTION.FIRE, ACTION.GO, ACTION.TURN_LEFT]);
  const evidence = combat(3); evidence.purposeFlags[0] = COMBAT_PURPOSE.DIRECT_KILL;
  evidence.purposeCompleteness[0] = 10000; evidence.postFireEscape[0] = 1;
  const bands = new StrategyBandSlab(); bands.reset(3);
  bands.starPurpose[1] = STRATEGY_PURPOSE.STAR_COLLECT;
  bands.classify(STRATEGY.KILL_PRESSURE, actions, 3, evidence);
  const c = controller([5000, 5000, 5000], null, 5000);
  assert.equal(bands.restrict(c, STRATEGY.KILL_PRESSURE, 3), 1);
  assert.equal(bands.selectedBand, STRATEGY_BAND.PRIMARY);
  assert.deepEqual(Array.from(bands.selected.slice(0, 3)), [1, 0, 0]);
});

test("strategy can cross the heuristic floor but cannot change Risk membership", () => {
  const actions = new Uint8Array([ACTION.FIRE, ACTION.GO]);
  const evidence = combat(2); evidence.purposeFlags[0] = COMBAT_PURPOSE.DIRECT_KILL;
  evidence.purposeCompleteness[0] = 10000; evidence.postFireEscape[0] = 1;
  const bands = new StrategyBandSlab(); bands.reset(2);
  bands.starPurpose[1] = STRATEGY_PURPOSE.STAR_COLLECT;
  bands.classify(STRATEGY.KILL_PRESSURE, actions, 2, evidence);
  const c = controller([4999, 5000], null, 5000);
  bands.restrict(c, STRATEGY.KILL_PRESSURE, 2);
  assert.equal(bands.selected[0], 1);
  assert.equal(bands.selected[1], 0);
  assert.equal(c.outcome.acceptable[0], 1);
  assert.equal(c.safeFloor, 5000);
});

test("unsafe or risk-rejected fire cannot be restored by a strategy band", () => {
  const actions = new Uint8Array([ACTION.FIRE, ACTION.GO]);
  const evidence = combat(2); evidence.purposeFlags[0] = COMBAT_PURPOSE.DIRECT_KILL;
  evidence.purposeCompleteness[0] = 10000; evidence.postFireEscape[0] = 1;
  const bands = new StrategyBandSlab(); bands.reset(2);
  bands.classify(STRATEGY.KILL_PRESSURE, actions, 2, evidence);
  const c = controller([5000, 5000], new Uint8Array([0, 1]), 5000);
  bands.restrict(c, STRATEGY.KILL_PRESSURE, 2);
  assert.deepEqual(Array.from(bands.selected.slice(0, 2)), [0, 1]);
});

test("hidden belief sweep cannot be promoted to KILL advantageous fire", () => {
  const actions = new Uint8Array([ACTION.FIRE, ACTION.GO]);
  const evidence = combat(2); evidence.purposeFlags[0] = COMBAT_PURPOSE.BELIEF_SWEEP;
  evidence.purposeCompleteness[0] = 9000; evidence.postFireEscape[0] = 3;
  const bands = new StrategyBandSlab(); bands.reset(2);
  bands.classify(STRATEGY.KILL_PRESSURE, actions, 2, evidence);
  assert.equal(bands.purpose[0] & STRATEGY_PURPOSE.ADVANTAGEOUS_FIRE, 0);
  assert.equal(bands.band[0], STRATEGY_BAND.FALLBACK);
});

test("diagnostic terminal scoping removes preserve purpose only in normal play", () => {
  const actions = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT]);
  const bands = new StrategyBandSlab(); bands.terminalPurposeScoped = 1; bands.reset(2);
  bands.configureRoot(0, 4, 0, GLOBAL_MODE.NORMAL);
  bands.importCombat(actions, 2, combat(2));
  assert.ok(bands.purpose[0] & STRATEGY_PURPOSE.NEUTRAL_POSITION);
  assert.equal(bands.purpose[0] & STRATEGY_PURPOSE.PRESERVE_NONLOSS, 0);
  bands.configureRoot(0, 4, 0, GLOBAL_MODE.HARD_SURVIVAL);
  bands.importCombat(actions, 2, combat(2));
  assert.ok(bands.purpose[0] & STRATEGY_PURPOSE.PRESERVE_NONLOSS);
});

test("STAR_CONTROL owns star rows while using the same already-computed matrix cells", () => {
  const actions = new Uint8Array([ACTION.FIRE, ACTION.GO]);
  const evidence = combat(2); evidence.purposeFlags[0] = COMBAT_PURPOSE.DIRECT_KILL;
  evidence.purposeCompleteness[0] = 10000; evidence.postFireEscape[0] = 1;
  const bands = new StrategyBandSlab(); bands.reset(2);
  bands.starPurpose[1] = STRATEGY_PURPOSE.STAR_COLLECT;
  bands.classify(STRATEGY.STAR_CONTROL, actions, 2, evidence);
  const c = controller([5000, 5000], null, 5000);
  bands.restrict(c, STRATEGY.STAR_CONTROL, 2);
  assert.deepEqual(Array.from(bands.selected.slice(0, 2)), [0, 1]);
  const matrix = new StageMatrix({ maxRows: 2, maxColumns: 2 });
  matrix.initialize(1, 2); matrix.setCell(0, 0, 3000, 3000);
  matrix.setCell(0, 1, -1000, -1000); matrix.computePureBounds();
  assert.equal(matrix.pureLower, -1000);
  assert.equal(matrix.cellLower(0, 0), 3000);
  assert.equal(matrix.cellLower(0, 1), -1000);
});

test("COMEBACK uses the earlier complete reversal deadline without changing row values", () => {
  const actions = new Uint8Array([ACTION.FIRE, ACTION.GO]);
  const evidence = combat(2); evidence.purposeFlags[0] = COMBAT_PURPOSE.DIRECT_KILL;
  evidence.purposeCompleteness[0] = 10000; evidence.postFireEscape[0] = 1;
  const bands = new StrategyBandSlab(); bands.reset(2);
  bands.starPurpose[1] = STRATEGY_PURPOSE.STAR_COLLECT;
  assert.equal(bands.configureRoot(2, 5, 10000), REVERSAL_KILL);
  bands.classify(STRATEGY.COMEBACK, actions, 2, evidence);
  assert.deepEqual(Array.from(bands.band.slice(0, 2)),
    [STRATEGY_BAND.PRIMARY, STRATEGY_BAND.SUPPORT]);
  assert.equal(bands.configureRoot(7, 3, 10000), REVERSAL_STAR);
  bands.classify(STRATEGY.COMEBACK, actions, 2, evidence);
  assert.deepEqual(Array.from(bands.band.slice(0, 2)),
    [STRATEGY_BAND.SUPPORT, STRATEGY_BAND.PRIMARY]);
});

test("RiskAcceptanceController selection obeys the strategy mask after safe-floor formation", () => {
  const c = controller([6000, 6000], null, 6000);
  c.outcome.expectedValue[0] = 9000; c.outcome.expectedValue[1] = 1000;
  const mask = new Uint8Array([0, 1]);
  assert.equal(c.select(1, null, mask), 1);
});

test("STRAT2 hot structures use fixed integer TypedArrays and report zero allocation", () => {
  const bands = new StrategyBandSlab(); const seen = new Set(); let floats = 0; let allocations = 0;
  function visit(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return; seen.add(value);
    if (ArrayBuffer.isView(value)) {
      if (value instanceof Float32Array || value instanceof Float64Array) floats += 1; return;
    }
    if (Number.isSafeInteger(value.hotAllocationCount)) allocations += value.hotAllocationCount;
    for (const child of Object.values(value)) visit(child);
  }
  visit(bands); assert.equal(floats, 0); assert.equal(allocations, 0);
});
