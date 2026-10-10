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
const { StableOptionLedgerShadow } = require(
  "../../tools/agentank/diagnostics/stable-option-ledger-shadow");
const { StrategicStateLedgerShadow } = require(
  "../../tools/agentank/diagnostics/strategic-state-ledger-shadow");

function fixture() {
  const arrays = [];
  arrays[ARRAY.SCALAR] = new Uint32Array(16);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 10;
  arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 12;
  arrays[ARRAY.TANK_CELL] = Uint16Array.from([8, 18]);
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
    projectedCell: Uint16Array.from([10, 11, 8]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW,
      HARD_STATUS.ALLOW]),
    finalGate: { lastSelected: 0 }, lastArgument: NONE_CELL,
    lastProofStatus: PROOF_STATUS.UNKNOWN, lastSelectionWasStrictRescue: 0,
    lastControlMode: ROOT_CONTROL_MODE.TACTICAL_CONTACT,
    globalMode: GLOBAL_MODE.NORMAL,
    rootGlobalMode() { return this.globalMode; },
    forcedWinRow() { return -1; },
    starDistance(cell) { return Math.abs(cell - 12); },
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
      targetSignature: Uint32Array.from([101, 202]) } },
    planCommitCount: 1, planActivateCount: 0, planCompleteCount: 0,
    planInvalidateCount: 0
  };
}

function observe(engine, ledger, strategic, action) {
  ledger.observe(engine, action); strategic.observe(engine, action);
}

function tick(engine) {
  engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] += 1;
}

test("strategic ledger segments stable targets by score state and plan churn", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const strategic = new StrategicStateLedgerShadow(ledger);
  observe(engine, ledger, strategic, ACTION.FIRE);
  const generation = ledger.lastSelectedGeneration;
  tick(engine); engine.planCommitCount += 1; engine.planCompleteCount += 1;
  observe(engine, ledger, strategic, ACTION.FIRE);
  tick(engine); engine.adapter.state.arrays[ARRAY.TANK_STARS][0] = 1;
  engine.planCommitCount += 1;
  observe(engine, ledger, strategic, ACTION.FIRE);
  const summary = strategic.summary();
  assert.equal(ledger.lastSelectedGeneration, generation);
  assert.equal(summary.selectedByScoreKind.TIED.ATTACK, 2);
  assert.equal(summary.selectedByScoreKind.LEADING.ATTACK, 1);
  assert.equal(summary.sameTargetPlanCommitCount, 2);
  assert.equal(summary.sameTargetPlanCompletionCount, 1);
  assert.equal(summary.sameCallbackCommitCompletionCount, 1);
  assert.equal(summary.targetRunFrameCount, 3);
  assert.equal(summary.targetRunsByScoreKind.TIED.ATTACK, 1);
  assert.equal(summary.targetRunsByScoreKind.LEADING.ATTACK, 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("target lifecycle separates unsignaled switches from star replacement events", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const strategic = new StrategicStateLedgerShadow(ledger);
  observe(engine, ledger, strategic, ACTION.FIRE);
  tick(engine); engine.finalGate.lastSelected = 1;
  observe(engine, ledger, strategic, ACTION.GO);
  tick(engine); engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 13;
  engine.optionPortfolio.targetCell[1] = 13;
  observe(engine, ledger, strategic, ACTION.GO);
  const summary = strategic.summary();
  assert.equal(summary.generationSwitchCount, 2);
  assert.equal(summary.unsignaledGenerationSwitchCount, 1);
  assert.equal(summary.eventGenerationSwitchCount, 1);
  assert.equal(summary.deadlineSlackBuckets.NINE_PLUS, 3);
  assert.equal(summary.lifecycleCreationsByScore.TIED, 3);
});

test("score-conditioned opportunity audit detects star regression and foregone attack", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const strategic = new StrategicStateLedgerShadow(ledger);
  engine.adapter.state.arrays[ARRAY.TANK_STARS].set([2, 1]);
  observe(engine, ledger, strategic, ACTION.FIRE);
  tick(engine); engine.adapter.state.arrays[ARRAY.TANK_STARS].set([1, 2]);
  engine.finalGate.lastSelected = 1;
  observe(engine, ledger, strategic, ACTION.GO);
  const summary = strategic.summary();
  assert.equal(summary.leadingAttackWithStarRegression, 1);
  assert.equal(summary.attackStarPathRegressionByScore.LEADING, 1);
  assert.equal(summary.trailingStarWithAttackAlternative, 1);
  assert.equal(summary.selectedStarWithAttackAlternativeByScore.TRAILING, 1);
  assert.equal(summary.qualifiedAttackRootByScore.LEADING, 1);
  assert.equal(summary.qualifiedStarRootByScore.TRAILING, 1);
});

test("strategic observer never changes actions or eligibility", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const strategic = new StrategicStateLedgerShadow(ledger);
  const actions = Array.from(engine.ourActions);
  const acceptable = Array.from(engine.riskController.outcome.acceptable);
  observe(engine, ledger, strategic, ACTION.FIRE);
  assert.deepEqual(Array.from(engine.ourActions), actions);
  assert.deepEqual(Array.from(engine.riskController.outcome.acceptable), acceptable);
});
