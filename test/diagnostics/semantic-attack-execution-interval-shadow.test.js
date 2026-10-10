"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { LONG_OPTION } = require(
  "../../tools/agentank/diagnostics/event-driven-option-shadow");
const { CONTINUATION_SEARCH_STATUS } = require(
  "../../tools/agentank/diagnostics/option-scoped-target-continuation-search");
const { SemanticAttackExecutionIntervalShadow } = require(
  "../../tools/agentank/diagnostics/semantic-attack-execution-interval-shadow");

function subject(mask = 0) {
  const epoch = { activeGeneration: 7, activeKind: LONG_OPTION.ATTACK,
    activeTargetSignature: 0x10000001, lastStatus: 2,
    lastExecutionRowMask: mask };
  const field = { hotAllocationCount: 0, calls: 0,
    evaluateOwnedTarget() { this.calls += 1; return 1; }, summary() { return {}; } };
  const interval = { hotAllocationCount: 0, calls: 0,
    lastStatus: CONTINUATION_SEARCH_STATUS.NONE,
    lastSelectedScore: 0, lastCandidateScore: 0, lastNodes: 0,
    evaluate() { this.calls += 1; this.lastStatus =
      CONTINUATION_SEARCH_STATUS.DOMINATES; this.lastSelectedScore = -5;
      this.lastCandidateScore = 9; this.lastNodes = 12; }, summary() { return {}; } };
  const coverage = { lastStrictMask: mask };
  const shadow = new SemanticAttackExecutionIntervalShadow(epoch, coverage, {},
    { field, interval });
  const arrays = new Array(ARRAY.SCALAR + 1).fill(null);
  arrays[ARRAY.TANK_CELL] = Uint16Array.from([10, 20]);
  arrays[ARRAY.SCALAR] = new Uint32Array(16);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 3;
  const engine = { ourCount: 2, ourActions: Uint8Array.from([ACTION.GO,
    ACTION.TURN_LEFT]), ourArguments: new Uint16Array(2),
    diagnosticInternalSelectedIndex: 0,
    adapter: { enemyVisible: 1, bundle: {}, state: { arrays } } };
  return { shadow, field, interval, engine };
}

test("geometry proposes but strict interval remains the only evidence owner", () => {
  const { shadow, field, interval, engine } = subject();
  shadow.observe(engine, ACTION.GO);
  const summary = shadow.summary();
  assert.equal(field.calls, 1); assert.equal(interval.calls, 1);
  assert.equal(summary.candidateByAction.TURN_LEFT, 1);
  assert.equal(summary.dominanceCount, 1);
  assert.equal(engine.diagnosticInternalSelectedIndex, 0);
});

test("existing strict execution prevents synthetic attack generation", () => {
  const { shadow, field, interval, engine } = subject(1 << 1);
  shadow.observe(engine, ACTION.GO);
  const summary = shadow.summary();
  assert.equal(summary.strictExecutionAvailableCount, 1);
  assert.equal(field.calls, 0); assert.equal(interval.calls, 0);
});

test("hidden enemy uses NONE target without reading a visible target", () => {
  const { shadow, interval, engine } = subject();
  engine.adapter.enemyVisible = 0;
  engine.adapter.state.arrays[ARRAY.TANK_CELL] = null;
  shadow.observe(engine, ACTION.GO);
  assert.equal(interval.calls, 1);
  assert.equal(shadow.summary().dominanceCount, 1);
});
