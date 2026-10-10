"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, SKILL, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { FastState, ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { NativeOwnSkillActionBridgePoc } = require(
  "../../tools/agentank/diagnostics/native-own-skill-action-bridge-poc");
const { ProductionDiagnosticBot } = require(
  "../../tools/agentank/simulation/production-diagnostic-bot");

function root(skill = SKILL.STUN) {
  const state = new FastState(7, 7); state.arrays[ARRAY.TANK_SKILL][0] = skill;
  const emissions = []; let sketches = 0;
  const engine = {
    adapter: { state, ownCanAct: true, ownSkillReady: true,
      recordEmission(action, argument) { emissions.push([action, argument]); } },
    diagnosticDisableResourceActions: 0,
    ourActions: new Uint8Array(8), ourArguments: new Uint16Array(8), ourCount: 0,
    generateActions() {
      this.ourActions[0] = ACTION.GO; this.ourArguments[0] = NONE_CELL;
      this.ourActions[1] = ACTION.NONE; this.ourArguments[1] = NONE_CELL;
      this.ourCount = 2;
    },
    createPlanSketches() { sketches += 1; },
    emit() { return ACTION.TURN_RIGHT; }
  };
  return { engine, emissions, sketches: () => sketches };
}

test("shadow skill bridge identifies the missing root action without changing it", () => {
  const value = root(); const bridge = new NativeOwnSkillActionBridgePoc("shadow");
  assert.equal(bridge.install(value.engine), 1); value.engine.generateActions();
  assert.deepEqual(Array.from(value.engine.ourActions.slice(0, value.engine.ourCount)),
    [ACTION.GO, ACTION.NONE]);
  assert.equal(bridge.summary().missingCount, 1);
  assert.equal(bridge.summary().insertedCount, 0);
});

test("active skill bridge inserts and emits the observed scalar skill", () => {
  const value = root(); const bridge = new NativeOwnSkillActionBridgePoc("active");
  bridge.install(value.engine); value.engine.generateActions();
  assert.deepEqual(Array.from(value.engine.ourActions.slice(0, value.engine.ourCount)),
    [ACTION.GO, ACTION.CAST_STUN, ACTION.NONE]);
  assert.equal(value.sketches(), 1);
  let casts = 0; const me = { stun() { casts += 1; } };
  assert.equal(value.engine.emit(me, ACTION.CAST_STUN), ACTION.CAST_STUN);
  assert.equal(casts, 1);
  assert.deepEqual(value.emissions, [[ACTION.CAST_STUN, NONE_CELL]]);
  assert.equal(bridge.summary().emitCount, 1);
  assert.equal(bridge.summary().hotAllocationCount, 0);
});

test("final diagnostic override re-enters the observed skill emitter", () => {
  const bot = new ProductionDiagnosticBot({
    diagnosticFinalActionOverride() {
      return { action: ACTION.CAST_STUN, argument: NONE_CELL };
    }
  });
  bot.engine.adapter.state = new FastState(7, 7);
  bot.engine.adapter.recordEmission = function recordEmission() {};
  bot.engine.adapter.state.arrays[ARRAY.TANK_SKILL][0] = SKILL.STUN;
  const bridge = new NativeOwnSkillActionBridgePoc("active");
  bridge.install(bot.engine);
  let casts = 0; let turns = 0;
  const me = { stun() { casts += 1; }, turn() { turns += 1; } };
  assert.equal(bot.engine.emit(me, ACTION.GO, NONE_CELL), ACTION.CAST_STUN);
  assert.equal(casts, 1); assert.equal(turns, 0);
  assert.equal(bridge.summary().emitCount, 1);
  assert.equal(bridge.summary().emitFallbackCount, 0);
});

test("bridge does not duplicate a natively generated poison action", () => {
  const value = root(SKILL.POISON);
  value.engine.generateActions = function generatePoison() {
    this.ourActions[0] = ACTION.GO;
    this.ourActions[1] = ACTION.CAST_POISON;
    this.ourActions[2] = ACTION.NONE;
    this.ourCount = 3;
  };
  const bridge = new NativeOwnSkillActionBridgePoc("active");
  bridge.install(value.engine); value.engine.generateActions();
  assert.equal(value.engine.ourCount, 3);
  assert.equal(bridge.summary().alreadyGeneratedCount, 1);
  assert.equal(bridge.summary().insertedCount, 0);
});

test("poison suppression keeps every other generated action in stable order", () => {
  const value = root(SKILL.POISON);
  value.engine.generateActions = function generatePoison() {
    this.ourActions[0] = ACTION.GO;
    this.ourActions[1] = ACTION.THROW_BOMB;
    this.ourActions[2] = ACTION.CAST_POISON;
    this.ourActions[3] = ACTION.NONE;
    this.ourCount = 4;
  };
  const bridge = new NativeOwnSkillActionBridgePoc("suppress-poison");
  bridge.install(value.engine); value.engine.generateActions();
  assert.deepEqual(Array.from(value.engine.ourActions.slice(0, value.engine.ourCount)),
    [ACTION.GO, ACTION.THROW_BOMB, ACTION.NONE]);
  assert.equal(value.sketches(), 1);
  assert.equal(bridge.summary().suppressedPoisonCount, 1);
  assert.equal(bridge.summary().hotAllocationCount, 0);
});

test("opening poison suppression applies only on frame zero", () => {
  const bridge = new NativeOwnSkillActionBridgePoc("suppress-poison-opening");
  const frame = new Uint16Array(8); const cells = new Uint16Array([0, 20]);
  const state = { arrays: [] };
  state.arrays[ARRAY.SCALAR] = frame;
  state.arrays[ARRAY.TANK_CELL] = cells;
  state.x = cell => cell % 10; state.y = cell => (cell / 10) | 0;
  assert.equal(bridge.suppressesPoison(state), true);
  frame[SCALAR.FRAME] = 1;
  assert.equal(bridge.suppressesPoison(state), false);
});

test("distant poison suppression uses the tactical contact boundary", () => {
  const bridge = new NativeOwnSkillActionBridgePoc("suppress-poison-distant");
  const state = { arrays: [] };
  state.arrays[ARRAY.SCALAR] = new Uint16Array(8);
  state.arrays[ARRAY.TANK_CELL] = new Uint16Array([0, 19]);
  state.x = cell => cell % 20; state.y = cell => (cell / 20) | 0;
  assert.equal(bridge.suppressesPoison(state), true);
  state.arrays[ARRAY.TANK_CELL][1] = 9;
  assert.equal(bridge.suppressesPoison(state), false);
});
