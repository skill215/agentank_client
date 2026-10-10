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
const { LONG_OPTION } = require(
  "../../tools/agentank/diagnostics/event-driven-option-shadow");
const { StableOptionLedgerShadow } = require(
  "../../tools/agentank/diagnostics/stable-option-ledger-shadow");

function fixture() {
  const arrays = [];
  arrays[ARRAY.SCALAR] = new Uint32Array(16);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 10;
  arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 12;
  arrays[ARRAY.TANK_CELL] = Uint16Array.from([1, 18]);
  arrays[ARRAY.TANK_CRASH] = new Uint8Array(2);
  arrays[ARRAY.TANK_STARS] = new Uint16Array(2);
  arrays[ARRAY.TANK_POISON_UNTIL] = new Uint16Array(2);
  arrays[ARRAY.TANK_SHIELD_HITS] = new Uint16Array(2);
  const portfolio = {
    count: 2,
    primitiveRow: Uint8Array.from([0, 1]),
    kind: Uint8Array.from([OPTION_KIND.ATTACK_SETUP, OPTION_KIND.STAR_CONTROL]),
    targetCell: Uint16Array.from([18, 12]),
    deadline: Uint16Array.from([20, 30]),
    supportComplete: Uint8Array.from([1, 1]),
    typedResourceVerified() { return 1; }
  };
  return {
    adapter: { state: { arrays }, enemyVisible: true, ownBombReady: false,
      ownSkillReady: false },
    ourCount: 3,
    ourActions: Uint8Array.from([ACTION.FIRE, ACTION.GO, ACTION.CAST_POISON]),
    ourArguments: Uint16Array.from([NONE_CELL, NONE_CELL, NONE_CELL]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW,
      HARD_STATUS.ALLOW]),
    finalGate: { lastSelected: 0 }, lastArgument: NONE_CELL,
    lastProofStatus: PROOF_STATUS.UNKNOWN, lastSelectionWasStrictRescue: 0,
    lastControlMode: ROOT_CONTROL_MODE.TACTICAL_CONTACT,
    globalMode: GLOBAL_MODE.NORMAL,
    rootGlobalMode() { return this.globalMode; },
    forcedWinRow() { return this.proofRow ?? -1; },
    escapeObligation: { supportStatus: 0, committedEntityCount: 0,
      firstActionCount: 0, member: new Uint8Array(3), entityCount: 0,
      entityKind: new Uint8Array(2), entityId: new Uint32Array(2),
      entityGeneration: new Uint16Array(2) },
    riskController: { outcome: { count: 3,
      acceptable: Uint8Array.from([1, 1, 1]), dominated: new Uint8Array(3) } },
    combat: { vector: { purposeCompleteness: Uint16Array.from([5000, 0, 5000]) } },
    optionPortfolio: portfolio,
    planSketchHandle: Uint32Array.from([0, 1, NONE_HANDLE]),
    policy: { sketches: { used: 2,
      targetSignature: Uint32Array.from([101, 202]) } }
  };
}

function tick(engine) {
  engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] += 1;
}

test("stable attack identity survives primitive, pose, visibility and Plan churn", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  ledger.observe(engine, ACTION.FIRE);
  const generation = ledger.lastSelectedGeneration;
  tick(engine); engine.ourActions[0] = ACTION.TURN_LEFT;
  engine.policy.sketches.targetSignature[0] = 999;
  engine.adapter.state.arrays[ARRAY.TANK_CELL][0] = 2;
  ledger.observe(engine, ACTION.TURN_LEFT);
  tick(engine); engine.adapter.enemyVisible = false;
  ledger.observe(engine, ACTION.TURN_LEFT);
  const summary = ledger.summary();
  assert.equal(ledger.lastSelectedGeneration, generation);
  assert.equal(summary.creationCount, 2);
  assert.equal(summary.createdByKind.ATTACK, 1);
  assert.equal(summary.reusedByKind.ATTACK, 2);
  assert.equal(summary.primitiveChangesWithinGeneration, 1);
  assert.equal(summary.planSignatureChangesWithinGeneration, 1);
  assert.ok(summary.revalidatedByKind.ATTACK >= 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("star replacement creates a new semantic target generation", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  engine.finalGate.lastSelected = 1;
  ledger.observe(engine, ACTION.GO);
  const first = ledger.lastSelectedGeneration;
  tick(engine); engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 13;
  engine.optionPortfolio.targetCell[1] = 13;
  ledger.observe(engine, ACTION.GO);
  const summary = ledger.summary();
  assert.notEqual(ledger.lastSelectedGeneration, first);
  assert.equal(summary.createdByKind.STAR_CONTROL, 2);
  assert.equal(summary.expiredByKind.STAR_CONTROL, 1);
  assert.ok(summary.expiryReasons.TARGET_GONE >= 1);
  assert.equal(summary.eventGenerationSwitchCount, 1);
});

test("availability gaps preserve identity but consumed resources expire", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  ledger.observe(engine, ACTION.FIRE);
  const generation = ledger.lastSelectedGeneration;
  tick(engine); engine.optionPortfolio.supportComplete[0] = 0;
  ledger.observe(engine, ACTION.FIRE);
  tick(engine); engine.optionPortfolio.supportComplete[0] = 1;
  ledger.observe(engine, ACTION.FIRE);
  assert.equal(ledger.lastSelectedGeneration, generation);
  assert.equal(ledger.summary().availabilityGapCount, 1);
  assert.equal(ledger.summary().availabilityRecoveryCount, 1);

  tick(engine); engine.optionPortfolio.count = 1;
  engine.optionPortfolio.primitiveRow[0] = 2;
  engine.optionPortfolio.kind[0] = OPTION_KIND.RESOURCE;
  engine.optionPortfolio.targetCell[0] = 18;
  engine.optionPortfolio.supportComplete[0] = 1;
  engine.adapter.ownSkillReady = true; engine.finalGate.lastSelected = 2;
  ledger.observe(engine, ACTION.CAST_POISON);
  assert.equal(ledger.lastSelectedKind, LONG_OPTION.RESOURCE);
  tick(engine); engine.adapter.ownSkillReady = false;
  engine.optionPortfolio.supportComplete[0] = 0;
  ledger.observe(engine, ACTION.CAST_POISON);
  assert.equal(ledger.summary().expiredByKind.RESOURCE, 1);
});

test("observer is behavior neutral and incomplete support never becomes tracked", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const actions = Array.from(engine.ourActions);
  engine.optionPortfolio.supportComplete.fill(0);
  ledger.observe(engine, ACTION.FIRE);
  assert.deepEqual(Array.from(engine.ourActions), actions);
  assert.equal(ledger.lastSelectedSlot, -1);
  assert.equal(ledger.summary().selectedUntrackedCount, 1);
  assert.equal(ledger.summary().selectedTrackedCount, 0);
});

test("multiple POSITION target aliases stay explicitly ambiguous", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  engine.optionPortfolio = {
    count: 2,
    primitiveRow: Uint8Array.from([1, 1]),
    kind: Uint8Array.from([OPTION_KIND.POSITION, OPTION_KIND.POSITION]),
    targetCell: Uint16Array.from([12, 18]),
    deadline: Uint16Array.from([30, 30]),
    supportComplete: Uint8Array.from([1, 1]),
    typedResourceVerified() { return 1; }
  };
  engine.finalGate.lastSelected = 1;
  ledger.observe(engine, ACTION.GO);
  assert.equal(ledger.lastSelectedKind, LONG_OPTION.POSITION);
  assert.equal(ledger.lastSelectedSlot, -1);
  assert.equal(ledger.summary().selectedTargetAmbiguityCount, 1);
  assert.equal(ledger.summary().selectedUntrackedCount, 1);
});
