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
const { ObjectiveEpochContinuityShadow } = require(
  "../../tools/agentank/diagnostics/objective-epoch-continuity-shadow");
const { ObjectiveEpochExecutionShadow } = require(
  "../../tools/agentank/diagnostics/objective-epoch-execution-shadow");
const { ObjectiveEpochActivePoc } = require(
  "../../tools/agentank/diagnostics/objective-epoch-active-poc");
const { ObjectiveEpochOptionArbiterShadow } = require(
  "../../tools/agentank/diagnostics/objective-epoch-option-arbiter-shadow");
const { SemanticObjectiveEpochShadow } = require(
  "../../tools/agentank/diagnostics/semantic-objective-epoch-shadow");
const { SemanticObjectiveEpochOptionActivePoc } = require(
  "../../tools/agentank/diagnostics/semantic-objective-epoch-option-active-poc");

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
  const state = { arrays, x(cell) { return cell % 20; },
    y(cell) { return Math.floor(cell / 20); } };
  return {
    adapter: { state, bundle: {}, enemyVisible: true, ownBombReady: false,
      ownSkillReady: false },
    ourCount: 3,
    ourActions: Uint8Array.from([ACTION.FIRE, ACTION.GO, ACTION.CAST_POISON]),
    ourArguments: Uint16Array.from([NONE_CELL, NONE_CELL, NONE_CELL]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW,
      HARD_STATUS.ALLOW]),
    projectedCell: Uint16Array.from([1, 2, 1]),
    projectedDirection: Uint8Array.from([1, 1, 1]),
    finalGate: { lastSelected: 0, finalAllows() { return 1; } },
    diagnosticInternalSelectedIndex: 0, lastArgument: NONE_CELL,
    lastProofStatus: PROOF_STATUS.UNKNOWN, lastSelectionWasStrictRescue: 0,
    lastControlMode: ROOT_CONTROL_MODE.TACTICAL_CONTACT,
    globalMode: GLOBAL_MODE.NORMAL,
    rootGlobalMode() { return this.globalMode; },
    manhattan(left, right) {
      return Math.abs(state.x(left) - state.x(right)) +
        Math.abs(state.y(left) - state.y(right));
    },
    clearLine(left, right) { return state.y(left) === state.y(right); },
    directionTo(left, right) { return state.x(right) > state.x(left) ? 1 : 3; },
    forcedWinRow() { return -1; },
    escapeObligation: { supportStatus: 0, committedEntityCount: 0,
      firstActionCount: 0, member: new Uint8Array(3), entityCount: 0,
      entityKind: new Uint8Array(2), entityId: new Uint32Array(2),
      entityGeneration: new Uint16Array(2) },
    riskController: { outcome: { count: 3,
      acceptable: Uint8Array.from([1, 1, 1]), dominated: new Uint8Array(3) },
      lexicographicRiskLess(left, right) { return left < right; } },
    combat: { vector: { purposeCompleteness:
      Uint16Array.from([5000, 0, 5000]) } },
    optionPortfolio: {
      count: 3,
      primitiveRow: Uint8Array.from([0, 1, 2]),
      kind: Uint8Array.from([OPTION_KIND.ATTACK_SETUP,
        OPTION_KIND.STAR_CONTROL, OPTION_KIND.RESOURCE]),
      targetCell: Uint16Array.from([18, 12, 18]),
      deadline: Uint16Array.from([20, 30, 20]),
      supportComplete: Uint8Array.from([1, 1, 1]),
      typedResourceVerified() { return 1; }
    },
    planSketchHandle: Uint32Array.from([0, 1, NONE_HANDLE]),
    policy: { sketches: { used: 2,
      targetSignature: Uint32Array.from([101, 202]) } },
    informationSearch: { completedDepth: 0 },
    depthSearch: { completedDepth: 1, representativeSupportComplete: 1,
      rootOurCount: 3, rootDomainRestricted: 0,
      rootScore: Int32Array.from([10, 20, 0]) }
  };
}

function observe(engine, ledger, epoch, action) {
  ledger.observe(engine, action); epoch.observe(engine);
}

function tick(engine) {
  engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] += 1;
}

test("objective epoch holds a valid target across an unsignaled primitive switch", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const epoch = new ObjectiveEpochContinuityShadow(ledger);
  observe(engine, ledger, epoch, ACTION.FIRE);
  const generation = epoch.activeGeneration;
  tick(engine); engine.finalGate.lastSelected = 1;
  observe(engine, ledger, epoch, ACTION.GO);
  const summary = epoch.summary();
  assert.equal(epoch.activeGeneration, generation);
  assert.equal(summary.unsignaledHoldCount, 1);
  assert.equal(summary.executionSupportedCount, 2);
  assert.equal(summary.selectedOutsideEpochCount, 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("semantic star replacement permits an event-bounded replan", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const epoch = new ObjectiveEpochContinuityShadow(ledger);
  observe(engine, ledger, epoch, ACTION.FIRE);
  tick(engine); engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 13;
  engine.optionPortfolio.targetCell[1] = 13; engine.finalGate.lastSelected = 1;
  observe(engine, ledger, epoch, ACTION.GO);
  const summary = epoch.summary();
  assert.equal(summary.eventReplanCount, 1);
  assert.equal(summary.replannedToKind.STAR_CONTROL, 1);
  assert.equal(summary.lastActiveKind, "STAR_CONTROL");
});

test("resource action interrupts execution without destroying the objective", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const epoch = new ObjectiveEpochContinuityShadow(ledger);
  observe(engine, ledger, epoch, ACTION.FIRE);
  const generation = epoch.activeGeneration;
  tick(engine); engine.adapter.ownSkillReady = true;
  engine.finalGate.lastSelected = 2;
  observe(engine, ledger, epoch, ACTION.CAST_POISON);
  const execution = new ObjectiveEpochExecutionShadow(epoch);
  execution.observe(engine);
  const summary = epoch.summary();
  assert.equal(summary.interruptYieldCount, 1);
  assert.equal(epoch.activeGeneration, generation);
  assert.equal(summary.lastActiveKind, "ATTACK");
  assert.equal(execution.summary().suspendedFrameCount, 1);
  assert.equal(execution.summary().activeFrameCount, 0);
});

test("existing search value is audited inside the epoch without mutation", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const epoch = new ObjectiveEpochContinuityShadow(ledger);
  const scores = Array.from(engine.depthSearch.rootScore);
  observe(engine, ledger, epoch, ACTION.FIRE);
  tick(engine); engine.depthSearch.rootScore[0] = 30;
  observe(engine, ledger, epoch, ACTION.FIRE);
  const summary = epoch.summary();
  assert.equal(summary.searchComparableCount, 2);
  assert.equal(summary.searchArgmaxOutsideCount, 1);
  assert.equal(summary.searchArgmaxInsideCount, 1);
  assert.deepEqual(scores, [10, 20, 0]);
  assert.equal(engine.depthSearch.rootScore[0], 30);
});

test("objective execution recovers a temporary attack portfolio gap", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const epoch = new ObjectiveEpochContinuityShadow(ledger);
  const execution = new ObjectiveEpochExecutionShadow(epoch);
  observe(engine, ledger, epoch, ACTION.FIRE); execution.observe(engine);
  tick(engine); engine.optionPortfolio.supportComplete[0] = 0;
  observe(engine, ledger, epoch, ACTION.FIRE); execution.observe(engine);
  const summary = execution.summary();
  assert.equal(summary.recoveredGapCount, 1);
  assert.equal(summary.expandedSupportedByKind.ATTACK, 2);
  assert.ok(summary.directFireRowCount >= 2);
  assert.ok(summary.approachRowCount >= 2);
  assert.equal(summary.hotAllocationCount, 0);
});

test("hidden enemy keeps an unsupported attack objective incomplete", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const epoch = new ObjectiveEpochContinuityShadow(ledger);
  const execution = new ObjectiveEpochExecutionShadow(epoch);
  observe(engine, ledger, epoch, ACTION.FIRE); execution.observe(engine);
  tick(engine); engine.adapter.enemyVisible = false;
  engine.optionPortfolio.supportComplete[0] = 0;
  observe(engine, ledger, epoch, ACTION.FIRE); execution.observe(engine);
  const summary = execution.summary();
  assert.equal(summary.remainingGapByKind.ATTACK, 1);
});

test("star objective can emit target-progress movement without a fresh Plan", () => {
  const engine = fixture(); engine.finalGate.lastSelected = 1;
  const ledger = new StableOptionLedgerShadow();
  const epoch = new ObjectiveEpochContinuityShadow(ledger);
  const execution = new ObjectiveEpochExecutionShadow(epoch);
  observe(engine, ledger, epoch, ACTION.GO); execution.observe(engine);
  tick(engine); engine.optionPortfolio.supportComplete[1] = 0;
  observe(engine, ledger, epoch, ACTION.GO); execution.observe(engine);
  const summary = execution.summary();
  assert.equal(summary.recoveredGapByKind.STAR_CONTROL, 1);
  assert.ok(execution.lastExpandedMask & (1 << 1));
});

test("bounded active owner only repairs a later action outside its objective", () => {
  const engine = fixture(); const active = new ObjectiveEpochActivePoc(4);
  assert.equal(active.selectOverride(engine, ACTION.FIRE, NONE_CELL), null);
  tick(engine); engine.finalGate.lastSelected = 1;
  engine.diagnosticInternalSelectedIndex = 1;
  engine.projectedCell[1] = 1; engine.projectedDirection[1] = 0;
  engine.depthSearch.rootScore[0] = 30; engine.depthSearch.rootScore[1] = 20;
  const replacement = active.selectOverride(engine, ACTION.GO, NONE_CELL);
  assert.equal(replacement.action, ACTION.FIRE);
  assert.equal(replacement.row, 0);
  assert.equal(active.summary().overrideCount, 1);
  assert.equal(active.summary().finalRejectCount, 0);
});

test("verified attack outranks strategic objective continuity", () => {
  const engine = fixture(); engine.finalGate.lastSelected = 1;
  engine.diagnosticInternalSelectedIndex = 1;
  const active = new ObjectiveEpochActivePoc(8);
  assert.equal(active.selectOverride(engine, ACTION.GO, NONE_CELL), null);
  tick(engine); engine.finalGate.lastSelected = 0;
  engine.diagnosticInternalSelectedIndex = 0;
  const replacement = active.selectOverride(engine, ACTION.FIRE, NONE_CELL);
  assert.equal(replacement, null);
  assert.equal(active.summary().verifiedAttackYieldCount, 1);
  assert.equal(active.summary().overrideCount, 0);
});

test("strict option arbiter records a search refutation without proposing", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const epoch = new ObjectiveEpochContinuityShadow(ledger);
  const arbiter = new ObjectiveEpochOptionArbiterShadow(epoch);
  observe(engine, ledger, epoch, ACTION.FIRE); arbiter.observe(engine, ACTION.FIRE);
  tick(engine); engine.finalGate.lastSelected = 1;
  engine.diagnosticInternalSelectedIndex = 1;
  observe(engine, ledger, epoch, ACTION.GO); arbiter.observe(engine, ACTION.GO);
  const summary = arbiter.summary();
  assert.equal(summary.currentOutsideCount, 1);
  assert.equal(summary.searchComparableCount, 1);
  assert.equal(summary.searchRefutesCount, 1);
  assert.equal(summary.proposalCount, 0);
  assert.equal(engine.diagnosticInternalSelectedIndex, 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("strict option arbiter proposes only an existing option when search supports it", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const epoch = new ObjectiveEpochContinuityShadow(ledger);
  const arbiter = new ObjectiveEpochOptionArbiterShadow(epoch);
  observe(engine, ledger, epoch, ACTION.FIRE); arbiter.observe(engine, ACTION.FIRE);
  tick(engine); engine.finalGate.lastSelected = 1;
  engine.diagnosticInternalSelectedIndex = 1;
  engine.depthSearch.rootScore[0] = 30;
  observe(engine, ledger, epoch, ACTION.GO); arbiter.observe(engine, ACTION.GO);
  const summary = arbiter.summary();
  assert.equal(summary.searchSupportsCount, 1);
  assert.equal(summary.searchStrictlyImprovesCount, 1);
  assert.equal(summary.proposalCount, 1);
  assert.equal(summary.lastProposal, 0);
  assert.equal(summary.lastMask, 1);
  assert.equal(summary.proposalByAction.FIRE, 1);
  assert.equal(engine.diagnosticInternalSelectedIndex, 1);
});

test("semantic epoch treats enemy POSITION as an ATTACK execution alias", () => {
  const engine = fixture(); const ledger = new StableOptionLedgerShadow();
  const epoch = new SemanticObjectiveEpochShadow(ledger);
  observe(engine, ledger, epoch, ACTION.FIRE);
  const generation = epoch.activeGeneration;
  tick(engine); engine.optionPortfolio.kind[1] = OPTION_KIND.POSITION;
  engine.optionPortfolio.targetCell[1] = 18;
  engine.finalGate.lastSelected = 1; engine.diagnosticInternalSelectedIndex = 1;
  observe(engine, ledger, epoch, ACTION.GO);
  const summary = epoch.summary();
  assert.equal(epoch.activeGeneration, generation);
  assert.equal(summary.lastActiveKind, "ATTACK");
  assert.equal(summary.crossKindContinuationCount, 1);
  assert.equal(summary.unsignaledHoldCount, 0);
  assert.ok(epoch.lastExecutionRowMask & (1 << 1));
  assert.equal(summary.selectedInsideEpochCount, 2);
});

test("semantic epoch canonicalizes star POSITION and never adopts POSITION as a goal", () => {
  const engine = fixture(); engine.optionPortfolio.kind[1] = OPTION_KIND.POSITION;
  engine.optionPortfolio.targetCell[1] = 12;
  engine.finalGate.lastSelected = 1; engine.diagnosticInternalSelectedIndex = 1;
  const ledger = new StableOptionLedgerShadow();
  const epoch = new SemanticObjectiveEpochShadow(ledger);
  observe(engine, ledger, epoch, ACTION.GO);
  const summary = epoch.summary();
  assert.equal(summary.lastActiveKind, "STAR_CONTROL");
  assert.equal(summary.adoptedByKind.POSITION, 0);
  assert.equal(summary.adoptedByKind.STAR_CONTROL, 1);
  assert.ok(epoch.lastExecutionRowMask & (1 << 1));
});

test("semantic active owner emits only a newly completed dominance proposal", () => {
  const engine = fixture(); const active = new SemanticObjectiveEpochOptionActivePoc();
  active.initialize(engine);
  active.ledger.observe = () => {};
  active.epoch.observe = () => {};
  active.arbiter.observe = () => {
    active.arbiter.intervalDominanceCount += 1;
    active.arbiter.lastProposal = 1;
  };
  const replacement = active.selectOverride(engine, ACTION.FIRE, NONE_CELL);
  assert.equal(replacement.row, 1);
  assert.equal(replacement.action, ACTION.GO);
  assert.equal(active.summary().certificateCount, 1);
  assert.equal(active.summary().overrideCount, 1);
  assert.equal(active.summary().finalRejectCount, 0);
});
