"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { FastKernel } = require("../../engine-v2/src/fast/kernel");
const { ACTION, HARD_STATUS, TERRAIN, NONE_CELL, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { NativeBoundedPolicySearchPoc } = require(
  "../../tools/agentank/diagnostics/native-bounded-policy-search-poc");
const { LONG_EVENT_OUTCOME } = require(
  "../../tools/agentank/diagnostics/native-long-option-event-envelope-poc");
const { NativeLongOptionResponseMassPoc, MASS_INDEX,
  RESPONSE_RELATION, bitMass } = require(
  "../../tools/agentank/diagnostics/native-long-option-response-mass-poc");
const { emittedActionRow } = require(
  "../../tools/agentank/simulation/production-diagnostic-bot");

function pairedFixture() {
  const state = new FastState(7, 7); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  a[ARRAY.TANK_CELL][1] = state.cell(5, 2);
  a[ARRAY.TANK_DIR][0] = 0; a[ARRAY.TANK_DIR][1] = 3;
  a[ARRAY.TANK_FIRE_LOCK][0] = NONE_FRAME;
  a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  a[ARRAY.SCALAR][SCALAR.TIMEOUT_SEAT] = 2;
  a[ARRAY.SCALAR][SCALAR.SCRIPT_ERROR_SEAT] = 2;
  state.initializeHash();
  const kernel = new FastKernel(state);
  const search = new NativeBoundedPolicySearchPoc({
    ownChanceMode: "v1-deterministic", opponentMode: "uniform"
  });
  search.representativeSupportComplete = 1;
  search.rootEnemyDomainMask[0] = 1;
  search.bindIsolatedHard({ state, kernel });
  search.generate = function generate(_engine, top, seat) {
    assert.equal(seat, 1);
    this.deepEnemyCount[top] = 1;
    this.deepEnemyActions[top * 6] = ACTION.NONE;
    this.deepEnemyArguments[top * 6] = NONE_CELL;
    return 1;
  };
  const engine = { ourCount: 2, enemyCount: 1,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.TURN_RIGHT]),
    ourArguments: Uint16Array.from([NONE_CELL, NONE_CELL]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    enemyActions: Uint8Array.from([ACTION.NONE]),
    enemyArguments: Uint16Array.from([NONE_CELL]),
    riskController: { outcome: { acceptable: Uint8Array.from([1, 1]) } },
    escapeObligation: { committedEntityCount: 0 },
    adapter: { state, bundle: { state, kernel } },
    depthSearch: { chanceAlternatives() { return 1; } } };
  const pose = { selected: 0, cell: Uint16Array.from([state.cell(2, 2)]),
    direction: Uint8Array.from([1]), fireDeadline: Uint8Array.from([2]),
    responseMask: Uint32Array.from([1]), prepare() { return 1; },
    supports(row) { return row === 1; },
    betterRow(_engine, left, right) { return right < 0 || left < right; },
    summary() { return {}; } };
  const feedback = { routeAction(current) {
    return current.arrays[ARRAY.TANK_DIR][0] === 1 ? ACTION.FIRE :
      ACTION.TURN_RIGHT;
  }, summary() { return {}; } };
  return { state, engine, search, pose, feedback };
}

test("integer mass dimensions preserve overlap and derived unions", () => {
  const mask = LONG_EVENT_OUTCOME.FIRE | LONG_EVENT_OUTCOME.WIN;
  assert.equal(bitMass(mask, MASS_INDEX.FIRE), 10000);
  assert.equal(bitMass(mask, MASS_INDEX.WIN), 10000);
  assert.equal(bitMass(mask, MASS_INDEX.SUCCESS), 10000);
  assert.equal(bitMass(mask, MASS_INDEX.FAILURE), 0);
  assert.equal(bitMass(mask, MASS_INDEX.UNRESOLVED), 0);
});

test("paired identical root actions have identical masks and integer masses", () => {
  const { state, engine, search, pose, feedback } = pairedFixture();
  const beforeLo = state.hashLo; const beforeHi = state.hashHi;
  const response = new NativeLongOptionResponseMassPoc("shadow", {
    pose, feedback, maximumFrames: 4, nodeBudget: 128
  });
  assert.equal(response.observe(engine, search, ACTION.TURN_RIGHT, NONE_CELL), null);
  const summary = response.summary();
  assert.equal(summary.sameRootActionCount, 1);
  assert.equal(summary.sameActionMismatchCount, 0);
  assert.equal(summary.lastRelation, RESPONSE_RELATION.EQUAL);
  assert.deepEqual(summary.baseMass, summary.candidateMass);
  assert.ok(summary.sharedMergeHitCount > 0);
  assert.equal(summary.rootRestoreFailureCount, 0);
  assert.equal(state.hashLo, beforeLo); assert.equal(state.hashHi, beforeHi);
});

test("response dominance is Pareto over worst failure and nominal event mass", () => {
  const response = new NativeLongOptionResponseMassPoc("shadow");
  response.baseMask = LONG_EVENT_OUTCOME.DEATH | LONG_EVENT_OUTCOME.OPEN;
  response.candidateMask = LONG_EVENT_OUTCOME.OPEN;
  response.baseMass[MASS_INDEX.FAILURE] = 2500;
  response.baseMass[MASS_INDEX.SUCCESS] = 1500;
  response.baseMass[MASS_INDEX.UNRESOLVED] = 7500;
  response.candidateMass[MASS_INDEX.FAILURE] = 0;
  response.candidateMass[MASS_INDEX.SUCCESS] = 4000;
  response.candidateMass[MASS_INDEX.UNRESOLVED] = 6000;
  assert.equal(response.relation(), RESPONSE_RELATION.CANDIDATE_DOMINATES);
  response.candidateMask |= LONG_EVENT_OUTCOME.INCOMPLETE;
  assert.notEqual(response.relation(), RESPONSE_RELATION.CANDIDATE_DOMINATES);
});

test("equal incomplete vectors remain equal while completeness is audited separately", () => {
  const response = new NativeLongOptionResponseMassPoc("shadow");
  response.baseMask = LONG_EVENT_OUTCOME.INCOMPLETE;
  response.candidateMask = LONG_EVENT_OUTCOME.INCOMPLETE;
  response.setMass(response.baseMass, 0, LONG_EVENT_OUTCOME.INCOMPLETE);
  response.setMass(response.candidateMass, 0, LONG_EVENT_OUTCOME.INCOMPLETE);
  assert.equal(response.relation(), RESPONSE_RELATION.EQUAL);
});

test("different first actions share the same continuation without changing root", () => {
  const { state, engine, search, pose, feedback } = pairedFixture();
  const response = new NativeLongOptionResponseMassPoc("shadow", {
    pose, feedback, maximumFrames: 4, nodeBudget: 128
  });
  assert.equal(response.observe(engine, search, ACTION.NONE, NONE_CELL), null);
  const summary = response.summary();
  assert.equal(summary.differentRootActionCount, 1);
  assert.equal(summary.pairCount, 1);
  assert.equal(summary.hotAllocationCount, 0);
  assert.equal(summary.rootRestoreFailureCount, 0);
  assert.equal(state.deltaUsed, 0); assert.equal(state.eventUsed, 0);
});

test("ACTIVE returns only a complete different-action Pareto dominance", () => {
  const { engine, search, pose, feedback } = pairedFixture();
  const response = new NativeLongOptionResponseMassPoc("active", {
    pose, feedback, maximumFrames: 4, nodeBudget: 128
  });
  engine.finalGate = { finalAllows() { return 1; } };
  response.evaluateMassRoot = function evaluateMassRoot(
      _engine, _search, action, _argument, target) {
    target.fill(0);
    if (action === ACTION.NONE) {
      target[MASS_INDEX.FAILURE] = 3000;
      target[MASS_INDEX.UNRESOLVED] = 7000;
      return LONG_EVENT_OUTCOME.DEATH | LONG_EVENT_OUTCOME.OPEN;
    }
    target[MASS_INDEX.SUCCESS] = 4000;
    target[MASS_INDEX.UNRESOLVED] = 6000;
    return LONG_EVENT_OUTCOME.OPEN;
  };
  assert.deepEqual(response.observe(engine, search, ACTION.NONE, NONE_CELL),
    { action: ACTION.TURN_RIGHT, argument: NONE_CELL, row: 1 });
  assert.equal(response.overrideCount, 1);
  assert.equal(response.finalGateCheckCount, 1);
  assert.equal(response.finalGateRejectCount, 0);
  assert.equal(response.wouldOverrideCount, 1);
  assert.equal(response.overrideByAction[ACTION.TURN_RIGHT], 1);
});

test("ACTIVE never owns an incomplete comparison", () => {
  const { engine, search, pose, feedback } = pairedFixture();
  const response = new NativeLongOptionResponseMassPoc("active", {
    pose, feedback, maximumFrames: 4, nodeBudget: 128
  });
  response.evaluateMassRoot = function evaluateMassRoot(
      _engine, _search, action, _argument, target) {
    target.fill(0);
    target[MASS_INDEX.UNRESOLVED] = action === ACTION.NONE ? 10000 : 5000;
    return action === ACTION.NONE ? LONG_EVENT_OUTCOME.OPEN :
      LONG_EVENT_OUTCOME.OPEN | LONG_EVENT_OUTCOME.INCOMPLETE;
  };
  assert.equal(response.observe(engine, search, ACTION.NONE, NONE_CELL), null);
  assert.equal(response.overrideCount, 0);
  assert.equal(response.pairIncompleteCount, 1);
});

test("ACTIVE fail-closes when the final Hard recheck rejects the row", () => {
  const { engine, search, pose, feedback } = pairedFixture();
  engine.finalGate = { finalAllows() { return 0; } };
  const response = new NativeLongOptionResponseMassPoc("active", {
    pose, feedback, maximumFrames: 4, nodeBudget: 128
  });
  response.evaluateMassRoot = function evaluateMassRoot(
      _engine, _search, action, _argument, target) {
    target.fill(0);
    if (action === ACTION.NONE) {
      target[MASS_INDEX.FAILURE] = 3000;
      target[MASS_INDEX.UNRESOLVED] = 7000;
      return LONG_EVENT_OUTCOME.DEATH | LONG_EVENT_OUTCOME.OPEN;
    }
    target[MASS_INDEX.SUCCESS] = 4000;
    target[MASS_INDEX.UNRESOLVED] = 6000;
    return LONG_EVENT_OUTCOME.OPEN;
  };
  assert.equal(response.observe(engine, search, ACTION.NONE, NONE_CELL), null);
  assert.equal(response.wouldOverrideCount, 1);
  assert.equal(response.overrideCount, 0);
  assert.equal(response.finalGateCheckCount, 1);
  assert.equal(response.finalGateRejectCount, 1);
});

test("Hard audit binds the emitted row instead of the last duplicate action", () => {
  const engine = {
    ourCount: 3,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.GO, ACTION.TURN_LEFT]),
    ourArguments: Uint16Array.from([NONE_CELL, NONE_CELL, NONE_CELL]),
    hardStatus: Uint8Array.from([
      HARD_STATUS.ALLOW, HARD_STATUS.REJECT_PROVEN, HARD_STATUS.ALLOW
    ]),
    diagnosticFinalOverrideIndex: 0,
    diagnosticInternalSelectedIndex: 1,
    diagnosticFinalOverrideArgument: NONE_CELL
  };
  assert.equal(emittedActionRow(engine, ACTION.GO), 0);
  engine.diagnosticFinalOverrideIndex = -1;
  engine.diagnosticInternalSelectedIndex = -1;
  assert.equal(emittedActionRow(engine, ACTION.GO), 0);
});

test("ACTIVE closes every host override through the final Hard gate", () => {
  const { engine } = pairedFixture();
  engine.ourActions = Uint8Array.from([ACTION.FIRE, ACTION.TURN_LEFT]);
  engine.ourArguments = Uint16Array.from([NONE_CELL, NONE_CELL]);
  engine.hardStatus = Uint8Array.from([
    HARD_STATUS.ALLOW, HARD_STATUS.REJECT_PROVEN
  ]);
  engine.diagnosticInternalSelectedIndex = 0;
  engine.adapter.bundle = { hard: {} };
  engine.finalGate = { finalAllows(_bundle, _actions, _arguments, row) {
    return engine.hardStatus[row] === HARD_STATUS.ALLOW;
  } };
  const response = new NativeLongOptionResponseMassPoc("active");
  assert.equal(response.closeHostOverride(engine, ACTION.FIRE, NONE_CELL,
    { action: ACTION.TURN_LEFT, argument: NONE_CELL }), null);
  assert.equal(response.hostFinalCheckCount, 1);
  assert.equal(response.hostFinalRejectCount, 1);
  assert.equal(response.hostFinalFallbackCount, 1);
  assert.equal(response.hostFinalFallbackFailureCount, 0);
  const allowed = { action: ACTION.FIRE, argument: NONE_CELL };
  assert.equal(response.closeHostOverride(engine, ACTION.TURN_LEFT, NONE_CELL,
    allowed), allowed);
  assert.equal(allowed.row, 0);
  assert.equal(response.hostFinalApprovedCount, 1);
});

test("host closure distinguishes an unavoidable all-rejected root", () => {
  const { engine } = pairedFixture();
  engine.hardStatus.fill(HARD_STATUS.REJECT_PROVEN);
  engine.diagnosticInternalSelectedIndex = 0;
  engine.adapter.bundle = { hard: {} };
  engine.finalGate = { finalAllows() { return 0; } };
  const response = new NativeLongOptionResponseMassPoc("active");
  assert.equal(response.closeHostOverride(engine, ACTION.GO, NONE_CELL,
    { action: ACTION.TURN_RIGHT, argument: NONE_CELL }), null);
  assert.equal(response.hostFinalRejectCount, 1);
  assert.equal(response.hostFinalNoSafeActionCount, 1);
  assert.equal(response.hostFinalFallbackFailureCount, 0);
});

test("GUARDED_SHADOW closes host Hard without owning response-mass actions", () => {
  const { engine, search, pose, feedback } = pairedFixture();
  engine.finalGate = { finalAllows() { return 1; } };
  const response = new NativeLongOptionResponseMassPoc("guarded-shadow", {
    pose, feedback, maximumFrames: 4, nodeBudget: 128
  });
  response.evaluateMassRoot = function evaluateMassRoot(
      _engine, _search, action, _argument, target) {
    target.fill(0);
    if (action === ACTION.NONE) {
      target[MASS_INDEX.FAILURE] = 3000;
      return LONG_EVENT_OUTCOME.DEATH;
    }
    target[MASS_INDEX.SUCCESS] = 4000;
    return LONG_EVENT_OUTCOME.FIRE;
  };
  assert.equal(response.observe(engine, search, ACTION.NONE, NONE_CELL), null);
  assert.equal(response.wouldOverrideCount, 1);
  assert.equal(response.overrideCount, 0);
  assert.equal(response.finalGateCheckCount, 0);
  assert.equal(response.hostClosureActive, 1);
  assert.equal(response.responseOwnershipActive, 0);
});

test("root-value proposal selects the prepared minimax argmax", () => {
  const response = new NativeLongOptionResponseMassPoc("shadow", {
    candidateProposalMode: "root-value"
  });
  const engine = { ourCount: 4,
    ourActions: Uint8Array.from([ACTION.NONE, ACTION.GO,
      ACTION.TURN_LEFT, ACTION.FIRE]),
    ourArguments: new Uint16Array(4),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW,
      HARD_STATUS.REJECT_PROVEN, HARD_STATUS.ALLOW]),
    riskController: { outcome: { acceptable: Uint8Array.from([1, 1, 1, 1]) } } };
  const search = { representativeSupportComplete: 1,
    rootDomainMask: Uint8Array.from([1, 1, 1, 1]),
    rootScore: Int32Array.from([999, 20, 80, 60]) };
  assert.equal(response.rootValueCandidateRow(engine, search), 3);
  search.rootScore[1] = 70;
  assert.equal(response.rootValueCandidateRow(engine, search), 1);
  search.representativeSupportComplete = 0;
  assert.equal(response.rootValueCandidateRow(engine, search), -1);
});

test("root-value mobility proposal excludes attack actions", () => {
  const poc = new NativeLongOptionResponseMassPoc("shadow", {
    candidateProposalMode: "root-value-mobility"
  });
  const engine = {
    ourCount: 4,
    ourActions: Uint8Array.from([
      ACTION.GO, ACTION.FIRE, ACTION.CAST_STUN, ACTION.TURN_RIGHT
    ]),
    ourArguments: Uint16Array.from([
      NONE_CELL, NONE_CELL, NONE_CELL, NONE_CELL
    ]),
    hardStatus: Uint8Array.from([
      HARD_STATUS.ALLOW, HARD_STATUS.ALLOW,
      HARD_STATUS.ALLOW, HARD_STATUS.ALLOW
    ]),
    riskController: { outcome: { acceptable: Uint8Array.from([1, 1, 1, 1]) } }
  };
  const search = {
    representativeSupportComplete: 1,
    rootDomainMask: Uint8Array.from([1, 1, 1, 1]),
    rootScore: Int32Array.from([40, 90, 80, 60])
  };
  assert.equal(poc.rootValueCandidateRow(engine, search), 3);
});
