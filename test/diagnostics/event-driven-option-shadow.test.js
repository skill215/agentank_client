"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS, NONE_CELL } = require(
  "../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { GLOBAL_MODE, NONE_HANDLE } = require("../../engine-v2/src/abi/policy-codes");
const { OPTION_KIND } = require("../../engine-v2/src/policy/option-portfolio");
const { ROOT_CONTROL_MODE } = require(
  "../../engine-v2/src/runtime/root-control-mode");
const { LONG_OPTION, OPTION_EVENT, EventDrivenOptionShadow } = require(
  "../../tools/agentank/diagnostics/event-driven-option-shadow");

function fixture() {
  const arrays = [];
  arrays[ARRAY.SCALAR] = new Uint32Array(16);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 10;
  arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 12;
  arrays[ARRAY.TANK_STARS] = Uint16Array.from([0, 0]);
  arrays[ARRAY.TANK_POISON_UNTIL] = Uint16Array.from([0, 0]);
  arrays[ARRAY.TANK_SHIELD_HITS] = Uint16Array.from([0, 0]);
  const portfolio = {
    count: 2,
    primitiveRow: Uint8Array.from([0, 1]),
    kind: Uint8Array.from([OPTION_KIND.ATTACK_SETUP, OPTION_KIND.STAR_CONTROL]),
    supportComplete: Uint8Array.from([1, 1]),
    typedResourceVerified() { return 1; }
  };
  const engine = {
    adapter: { state: { arrays }, enemyVisible: true, ownBombReady: false,
      ownSkillReady: false },
    ourCount: 3,
    ourActions: Uint8Array.from([ACTION.FIRE, ACTION.GO, ACTION.CAST_POISON]),
    ourArguments: Uint32Array.from([0, 0, 0]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW,
      HARD_STATUS.ALLOW]),
    finalGate: { lastSelected: 0 },
    lastArgument: 0,
    lastProofStatus: PROOF_STATUS.UNKNOWN,
    lastSelectionWasStrictRescue: 0,
    lastControlMode: ROOT_CONTROL_MODE.TACTICAL_CONTACT,
    globalMode: GLOBAL_MODE.NORMAL,
    rootGlobalMode() { return this.globalMode; },
    forcedWinRow() { return this.proofRow ?? -1; },
    escapeObligation: {
      supportStatus: 0, committedEntityCount: 0, firstActionCount: 0,
      member: new Uint8Array(3), entityCount: 0,
      entityKind: new Uint8Array(2), entityId: new Uint32Array(2),
      entityGeneration: new Uint16Array(2)
    },
    riskController: { outcome: {
      count: 3, acceptable: Uint8Array.from([1, 1, 1]),
      dominated: Uint8Array.from([0, 0, 0])
    } },
    combat: { vector: { purposeCompleteness: Uint16Array.from([5000, 0, 5000]) } },
    optionPortfolio: portfolio,
    planSketchHandle: Uint32Array.from([0, 1, NONE_HANDLE]),
    policy: { sketches: { used: 2, targetSignature: Uint32Array.from([101, 202]) } }
  };
  return engine;
}

function tick(engine) {
  engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] += 1;
}

test("event-driven option shadow separates local churn from external events", () => {
  const engine = fixture(); const shadow = new EventDrivenOptionShadow();
  shadow.observe(engine, ACTION.FIRE);
  tick(engine); shadow.observe(engine, ACTION.FIRE);

  tick(engine); engine.finalGate.lastSelected = 1;
  shadow.observe(engine, ACTION.GO);

  tick(engine); engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 13;
  shadow.observe(engine, ACTION.GO);

  tick(engine); engine.adapter.ownSkillReady = true;
  engine.finalGate.lastSelected = 2;
  shadow.observe(engine, ACTION.CAST_POISON);

  const summary = shadow.summary();
  assert.equal(summary.decisionCount, 5);
  assert.equal(summary.optionSwitchCount, 2);
  assert.equal(summary.unsignaledOptionSwitchCount, 1);
  assert.equal(summary.eventOptionSwitchCount, 1);
  assert.equal(summary.continuationCount, 2);
  assert.equal(summary.eventFramesByBit.MATCH_START, 1);
  assert.equal(summary.eventFramesByBit.STAR_TARGET, 1);
  assert.equal(summary.eventFramesByBit.RESOURCE_READY, 1);
  assert.equal(summary.selectedKind.ATTACK, 2);
  assert.equal(summary.selectedKind.STAR_CONTROL, 2);
  assert.equal(summary.selectedKind.RESOURCE, 1);
  assert.equal(summary.attackForegoneRootCount, 3);
  assert.equal(summary.selectedPurposeIncompleteCount, 0);
  assert.equal(summary.hotAllocationCount, 0);
});

test("committed rescue and strict proof receive distinct long-option identities", () => {
  const engine = fixture(); const shadow = new EventDrivenOptionShadow();
  engine.lastProofStatus = PROOF_STATUS.PROVEN; engine.proofRow = 0;
  shadow.observe(engine, ACTION.FIRE);
  assert.equal(shadow.lastSelectedKind, LONG_OPTION.STRICT_PROOF);

  tick(engine); engine.lastProofStatus = PROOF_STATUS.UNKNOWN;
  engine.lastControlMode = ROOT_CONTROL_MODE.COMMITTED_ESCAPE;
  engine.lastSelectionWasStrictRescue = 1;
  engine.escapeObligation.supportStatus = 1;
  engine.escapeObligation.committedEntityCount = 1;
  engine.escapeObligation.firstActionCount = 1;
  engine.escapeObligation.member[1] = 1;
  engine.escapeObligation.entityCount = 1;
  engine.escapeObligation.entityKind[0] = 2;
  engine.escapeObligation.entityId[0] = 17;
  engine.escapeObligation.entityGeneration[0] = 3;
  engine.finalGate.lastSelected = 1;
  shadow.observe(engine, ACTION.GO);
  assert.equal(shadow.lastSelectedKind, LONG_OPTION.COMMITTED_RESCUE);
  assert.ok(shadow.lastEventMask & OPTION_EVENT.COMMITTED_DANGER);
  assert.equal(shadow.summary().eventOptionSwitchCount, 1);
});

test("observer is behavior-neutral and resets lifecycle at a new frame sequence", () => {
  const engine = fixture(); const shadow = new EventDrivenOptionShadow();
  const actionsBefore = Array.from(engine.ourActions);
  shadow.observe(engine, ACTION.FIRE);
  tick(engine); shadow.observe(engine, ACTION.FIRE);
  engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 0;
  shadow.observe(engine, ACTION.FIRE);
  assert.deepEqual(Array.from(engine.ourActions), actionsBefore);
  const summary = shadow.summary();
  assert.equal(summary.matchCount, 2);
  assert.equal(summary.optionSwitchCount, 0);
  assert.equal(summary.eventFramesByBit.MATCH_START, 2);
  assert.equal(summary.hotAllocationCount, 0);
  assert.notEqual(NONE_CELL, engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL]);
});
