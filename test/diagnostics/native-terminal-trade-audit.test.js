"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { SEARCH_CAPACITY } = require(
  "../../engine-v2/src/generated/search-config");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { NativeTerminalTradeAudit } = require(
  "../../tools/agentank/diagnostics/native-terminal-trade-audit");

test("paired terminal horizon and budget are explicit bounded diagnostics", () => {
  const audit = new NativeTerminalTradeAudit(4, "paired-shadow", {
    pairedTerminalDepth: 6, pairedTerminalNodeBudget: 2048
  });
  const summary = audit.summary();
  assert.equal(summary.pairedTerminalDepth, 6);
  assert.equal(summary.pairedTerminalNodeBudget, 2048);
});

function fixture(enemyActions = [ACTION.FIRE, ACTION.GO]) {
  const state = new FastState(5, 5); const arrays = state.arrays;
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 9;
  arrays[ARRAY.TANK_CELL][0] = state.cell(1, 2);
  arrays[ARRAY.TANK_CELL][1] = state.cell(3, 2);
  arrays[ARRAY.TANK_DIR][0] = 1; arrays[ARRAY.TANK_DIR][1] = 3;
  arrays[ARRAY.TANK_FIRE_LOCK].fill(NONE_FRAME);
  arrays[ARRAY.TANK_SHIELD_UNTIL].fill(NONE_FRAME);
  arrays[ARRAY.TANK_BOOST_UNTIL].fill(NONE_FRAME);
  arrays[ARRAY.TANK_STARS][0] = 1; arrays[ARRAY.TANK_STARS][1] = 2;
  const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
  const cells = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS * stride);
  cells[0] = -30100; cells[1] = 500;
  cells[stride] = -1000; cells[stride + 1] = -500;
  return {
    engine: {
      ourActions: new Uint8Array([ACTION.FIRE, ACTION.TURN_LEFT]),
      enemyActions: new Uint8Array(enemyActions), enemyCount: enemyActions.length,
      adapter: { state, enemyCanAct: true },
      combat: { vector: { count: 2, directKill: new Uint8Array([1, 0]),
        ownCounterExposure: new Uint16Array([5600, 0]) } },
      riskController: { outcome: { count: 2,
        horizonFatalMass: new Uint16Array([9000, 0]),
        escapeSlack: new Int8Array([0, 2]) } }
    },
    source: { rootScore: new Int32Array([-30100, -1000]),
      rootCellScore: cells },
    allowed: new Uint8Array([1, 1]),
    backed: new Int32Array([-30100, -1000])
  };
}

test("audit captures a star-losing direct counter-trade without changing selection", () => {
  const value = fixture(); const audit = new NativeTerminalTradeAudit();
  assert.equal(audit.observe(value.engine, value.source, value.allowed,
    value.backed, 0, 2), 1);
  const summary = audit.summary(); const sample = summary.samples[0];
  assert.equal(summary.nonWinningTradeCount, 1);
  assert.equal(summary.enemyFireTerminalLossCount, 1);
  assert.equal(summary.robustBlendAboveWorstCount, 0);
  assert.equal(summary.strictlySaferWorstAlternativeCount, 1);
  assert.equal(summary.worstDominatedSelectionCount, 1);
  assert.equal(summary.terminalBandDominatedSelectionCount, 1);
  assert.equal(summary.frontierSamples[0].selectedAction, ACTION.FIRE);
  assert.equal(summary.frontierSamples[0].bestAction, ACTION.TURN_LEFT);
  assert.equal(sample.enemyFireWorst, -30100);
  assert.equal(sample.nonFireAction, ACTION.TURN_LEFT);
  assert.equal(sample.nonFireEnemyFireWorst, -1000);
  assert.equal(sample.selectedMatrixWorst, -30100);
  assert.equal(sample.bestMatrixWorstAction, ACTION.TURN_LEFT);
  assert.equal(sample.bestMatrixWorst, -1000);
  assert.equal(summary.hotAllocationCount, 0);
});

test("audit exposes a missing enemy FIRE response instead of guessing a terminal", () => {
  const value = fixture([ACTION.GO]); const audit = new NativeTerminalTradeAudit();
  audit.observe(value.engine, value.source, value.allowed, value.backed, 0, 2);
  const summary = audit.summary();
  assert.equal(summary.enemyFireMissingCount, 1);
  assert.equal(summary.enemyFireTerminalLossCount, 0);
  assert.equal(summary.samples[0].enemyFireColumns, 0);
});

test("non-FIRE and star-winning trades stay outside the focused sample", () => {
  const value = fixture(); const audit = new NativeTerminalTradeAudit();
  assert.equal(audit.observe(value.engine, value.source, value.allowed,
    value.backed, 1, 2), 0);
  value.engine.adapter.state.arrays[ARRAY.TANK_STARS][0] = 3;
  assert.equal(audit.observe(value.engine, value.source, value.allowed,
    value.backed, 0, 2), 0);
  assert.equal(audit.summary().sampleCount, 0);
});

test("shadow arrival gate reports but does not veto an unfavorable direct trade", () => {
  const value = fixture(); const audit = new NativeTerminalTradeAudit(64, "shadow");
  const row = audit.select(value.engine, value.source, value.allowed,
    value.backed, 0, 2, 1);
  assert.equal(row, 0);
  const summary = audit.summary();
  assert.equal(summary.directInitiativeCount, 1);
  assert.equal(summary.unfavorableInitiativeCount, 1);
  assert.equal(summary.ownershipWouldYieldCount, 1);
  assert.equal(summary.ownershipYieldCount, 0);
});

test("active arrival gate restores a strictly safer allowed base row", () => {
  const value = fixture(); const audit = new NativeTerminalTradeAudit(64, "active");
  assert.equal(audit.select(value.engine, value.source, value.allowed,
    value.backed, 0, 2, 1), 1);
  assert.equal(audit.summary().ownershipYieldCount, 1);
  assert.equal(audit.summary().hotAllocationCount, 0);
});

test("arrival gate preserves favorable star-leading trades and unsafe fallbacks", () => {
  const value = fixture(); value.engine.adapter.state.arrays[ARRAY.TANK_STARS][0] = 3;
  const audit = new NativeTerminalTradeAudit(64, "active");
  assert.equal(audit.select(value.engine, value.source, value.allowed,
    value.backed, 0, 2, 1), 0);
  assert.equal(audit.summary().favorableInitiativeCount, 1);

  value.engine.adapter.state.arrays[ARRAY.TANK_STARS][0] = 1;
  value.allowed[1] = 0;
  assert.equal(audit.select(value.engine, value.source, value.allowed,
    value.backed, 0, 2, 1), 0);
  assert.equal(audit.summary().baseRowUnsafeCount, 1);
});

test("successor trade response-set dominance is shadowed and can yield ownership", () => {
  const value = fixture(); const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
  value.source.rootTradeClass = new Uint8Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * stride);
  value.source.rootTradeClass[0] = 2;
  value.source.rootTradeClass[1] = 3;
  value.source.rootTradeClass[stride] = 1;
  value.source.rootTradeClass[stride + 1] = 0;
  const shadow = new NativeTerminalTradeAudit(64, "shadow");
  assert.equal(shadow.select(value.engine, value.source, value.allowed,
    value.backed, 0, 2, 1), 0);
  assert.equal(shadow.summary().successorTradeWouldYieldCount, 1);
  const active = new NativeTerminalTradeAudit(64, "active");
  assert.equal(active.select(value.engine, value.source, value.allowed,
    value.backed, 0, 2, 1), 1);
  assert.equal(active.summary().successorTradeYieldCount, 1);
});

test("crossing successor trade response sets remain a tradeoff", () => {
  const value = fixture(); const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
  value.engine.ourActions[0] = ACTION.GO;
  value.source.rootTradeClass = new Uint8Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * stride);
  value.source.rootTradeClass[0] = 2;
  value.source.rootTradeClass[stride + 1] = 3;
  const active = new NativeTerminalTradeAudit(64, "active");
  assert.equal(active.select(value.engine, value.source, value.allowed,
    value.backed, 0, 2, 1), 0);
  assert.equal(active.summary().successorTradeRegressionBlockedCount, 1);
  assert.equal(active.summary().successorTradeYieldCount, 0);
});

test("paired terminal ownership requires a depth-four terminal-band crossing", () => {
  const value = fixture(); const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
  value.engine.ourActions[0] = ACTION.GO;
  value.source.rootTradeClass = new Uint8Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * stride);
  value.source.rootTradeClass[0] = 3;
  value.source.compareTerminalRows = function () {
    this.pairedTerminalSelectedWorst = -30300;
    this.pairedTerminalBaseWorst = -1200;
    return 1;
  };
  const shadow = new NativeTerminalTradeAudit(64, "paired-shadow");
  assert.equal(shadow.select(value.engine, value.source, value.allowed,
    value.backed, 0, 2, 1), 0);
  assert.equal(shadow.summary().pairedTerminalWouldYieldCount, 1);
  const active = new NativeTerminalTradeAudit(64, "paired-active");
  assert.equal(active.select(value.engine, value.source, value.allowed,
    value.backed, 0, 2, 1), 1);
  assert.equal(active.summary().pairedTerminalYieldCount, 1);

  value.source.compareTerminalRows = function () {
    this.pairedTerminalSelectedWorst = -2100;
    this.pairedTerminalBaseWorst = -1200;
    return 1;
  };
  const nonterminal = new NativeTerminalTradeAudit(64, "paired-active");
  assert.equal(nonterminal.select(value.engine, value.source, value.allowed,
    value.backed, 0, 2, 1), 0);
  assert.equal(nonterminal.summary().pairedTerminalRawImprovementCount, 1);
  assert.equal(nonterminal.summary().pairedTerminalYieldCount, 0);
});
