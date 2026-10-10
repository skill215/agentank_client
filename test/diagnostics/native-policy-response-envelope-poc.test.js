"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY } = require("../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS, NONE_CELL } = require(
  "../../engine-v2/src/abi/fast-codes");
const { SEARCH_CAPACITY } = require(
  "../../engine-v2/src/generated/search-config");
const { NativeBoundedPolicySearchPoc, CONTINUATION_POLICY } = require(
  "../../tools/agentank/diagnostics/native-bounded-policy-search-poc");
const { NativePolicyResponseEnvelopePoc, POLICY_ENVELOPE_RELATION } = require(
  "../../tools/agentank/diagnostics/native-policy-response-envelope-poc");

function pairedFixture() {
  const state = new FastState(7, 7); const a = state.arrays;
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  a[ARRAY.TANK_CELL][1] = state.cell(5, 2);
  const engine = { ourCount: 1, enemyCount: 2,
    ourActions: Uint8Array.from([ACTION.GO]),
    ourArguments: Uint16Array.from([NONE_CELL]),
    enemyActions: Uint8Array.from([ACTION.GO, ACTION.FIRE]),
    enemyArguments: Uint16Array.from([NONE_CELL, NONE_CELL]),
    adapter: { state, bundle: { state } } };
  const search = new NativeBoundedPolicySearchPoc();
  search.representativeSupportComplete = 1;
  search.rootEnemyDomainMask[0] = 1; search.rootEnemyDomainMask[1] = 1;
  search.diagnosticKernel = { failure: 0, lastMark: 0,
    appliedActionCount: 0, hardCheckedActionCount: 0 };
  search.diagnosticHard = {};
  return { state, engine, search };
}

test("paired response envelope uses identical columns and distinguishes policy identity", () => {
  const { state, engine, search } = pairedFixture();
  const columns = [[], []];
  search.transitionValue = function transition(_engine, _own, _argument,
      enemy) {
    const policy = this.currentContinuationPolicy ===
      CONTINUATION_POLICY.ATTACK_TARGET ? 1 : 0;
    columns[policy].push(enemy); this.nodes += 1;
    return 100 + policy * 20 + (enemy === ACTION.FIRE ? -5 : 0);
  };
  const generator = { routeAction() { return ACTION.GO; } };
  const mark = state.deltaUsed * 1024 + state.eventUsed;
  assert.equal(search.evaluatePolicyResponseEnvelope(engine,
    ACTION.GO, NONE_CELL, ACTION.GO, NONE_CELL,
    generator, CONTINUATION_POLICY.ATTACK_TARGET, 0x12345678, 3, 128), 1);
  assert.deepEqual(columns[0], [ACTION.GO, ACTION.FIRE]);
  assert.deepEqual(columns[1], columns[0]);
  assert.equal(search.policyEnvelopeBaseWorst, 95);
  assert.equal(search.policyEnvelopeCandidateWorst, 115);
  assert.equal(search.policyEnvelopeTargetSignature, 0x12345678);
  assert.equal(state.deltaUsed * 1024 + state.eventUsed, mark);
  assert.equal(search.summary().policyEnvelopeRestoreFailureCount, 0);
});

test("prepared horizon-exact baseline cells are reused without a second search", () => {
  const { engine, search } = pairedFixture();
  search.currentDepth = 3; search.rootDomainMask[0] = 1;
  search.rowExactBlockMask[0] = 8; // DEPTH_LEAF is the requested horizon.
  search.rootCellScore[0] = 80; search.rootCellScore[1] = 70;
  let calls = 0;
  search.transitionValue = function transition(_engine, _own, _argument,
      enemy) {
    calls += 1; this.nodes += 1;
    assert.equal(this.currentContinuationPolicy,
      CONTINUATION_POLICY.ATTACK_TARGET);
    return enemy === ACTION.FIRE ? 95 : 105;
  };
  assert.equal(search.evaluatePolicyResponseEnvelope(engine,
    ACTION.GO, NONE_CELL, ACTION.GO, NONE_CELL,
    { routeAction() { return ACTION.GO; } },
    CONTINUATION_POLICY.ATTACK_TARGET, 99, 3, 128, 0, true), 1);
  assert.equal(calls, 2);
  assert.equal(search.policyEnvelopeBaseCellLower[0], 80);
  assert.equal(search.policyEnvelopeBaseCellLower[1], 70);
  assert.equal(search.summary().policyEnvelopePreparedBaseReuseCount, 1);
  search.rowExactBlockMask[0] = 9; // requested horizon plus budget leaf.
  assert.equal(search.evaluatePolicyResponseEnvelope(engine,
    ACTION.GO, NONE_CELL, ACTION.GO, NONE_CELL,
    { routeAction() { return ACTION.GO; } },
    CONTINUATION_POLICY.ATTACK_TARGET, 100, 3, 128, 0, true), 0);
  assert.equal(calls, 2);
  assert.equal(search.summary().policyEnvelopePreparedBaseBlockedCount, 1);
});

test("attack continuation forces a target-specific legal action without a cache alias", () => {
  const { engine, search } = pairedFixture();
  search.fullPrimitiveDomain = true;
  engine.depthSearch = { target(state, cell, direction) {
    const x = state.x(cell) + [0, 1, 0, -1][direction];
    const y = state.y(cell) + [-1, 0, 1, 0][direction];
    return x < 0 || y < 0 || x >= state.width || y >= state.height ?
      NONE_CELL : state.cell(x, y);
  }, walkable(_state, cell) { return cell !== NONE_CELL; } };
  search.currentContinuationPolicy = CONTINUATION_POLICY.ATTACK_TARGET;
  search.currentContinuationGenerator = { routeAction() {
    return ACTION.TURN_LEFT;
  } };
  assert.equal(search.generate(engine, 1, 0), 1);
  assert.equal(search.deepOurActions[6], ACTION.TURN_LEFT);
  search.currentContinuationGenerator = { routeAction() {
    return ACTION.TURN_RIGHT;
  } };
  assert.equal(search.generate(engine, 1, 0), 1);
  assert.equal(search.deepOurActions[6], ACTION.TURN_RIGHT);
  assert.equal(search.currentContinuationIncomplete, 0);
});

test("policy abort returns to baseline domain while an explicit action may enter it", () => {
  const { engine, search } = pairedFixture();
  search.fullPrimitiveDomain = true;
  engine.depthSearch = { target(state, cell, direction) {
    const x = state.x(cell) + [0, 1, 0, -1][direction];
    const y = state.y(cell) + [-1, 0, 1, 0][direction];
    return x < 0 || y < 0 || x >= state.width || y >= state.height ?
      NONE_CELL : state.cell(x, y);
  }, walkable(_state, cell) { return cell !== NONE_CELL; } };
  search.currentContinuationPolicy = CONTINUATION_POLICY.ATTACK_TARGET;
  search.currentContinuationGenerator = { routeAction() { return ACTION.NONE; } };
  assert.ok(search.generate(engine, 1, 0) > 1);
  assert.equal(search.policyEnvelopeAbortFallbackCount, 1);
  assert.equal(search.currentContinuationIncomplete, 0);
  search.currentContinuationGenerator = { routeAction() {
    return ACTION.CAST_STUN;
  } };
  assert.equal(search.generate(engine, 1, 0), 1);
  assert.equal(search.deepOurActions[6], ACTION.CAST_STUN);
  assert.equal(search.policyEnvelopeInjectedActionCount, 1);
});

test("a completed FIRE event hands the continuation back without an abort", () => {
  const { engine, search } = pairedFixture();
  search.fullPrimitiveDomain = true;
  engine.depthSearch = { target(state, cell, direction) {
    const x = state.x(cell) + [0, 1, 0, -1][direction];
    const y = state.y(cell) + [-1, 0, 1, 0][direction];
    return x < 0 || y < 0 || x >= state.width || y >= state.height ?
      NONE_CELL : state.cell(x, y);
  }, walkable(_state, cell) { return cell !== NONE_CELL; } };
  search.currentContinuationPolicy = CONTINUATION_POLICY.ATTACK_TARGET;
  search.currentContinuationGenerator = {
    routeAction() { throw new Error("completed policy must not route again"); }
  };
  search.pathPolicyEvent[1] = 1;
  assert.ok(search.generate(engine, 1, 0) > 1);
  assert.equal(search.policyEnvelopeCompletionFallbackCount, 1);
  assert.equal(search.policyEnvelopeAbortFallbackCount, 0);
  assert.equal(search.policyEnvelopeAbortNode[1], 0);
});

test("incomplete continuation or budget leaves the policy intervals open", () => {
  const { engine, search } = pairedFixture();
  search.transitionValue = function transition() {
    this.nodes += 1;
    if (this.currentContinuationPolicy === CONTINUATION_POLICY.ATTACK_TARGET)
      this.leafBudgetCount += 1;
    return 200;
  };
  assert.equal(search.evaluatePolicyResponseEnvelope(engine,
    ACTION.GO, NONE_CELL, ACTION.GO, NONE_CELL,
    { routeAction() { return ACTION.GO; } },
    CONTINUATION_POLICY.ATTACK_TARGET, 7, 3, 64), 0);
  assert.equal(search.policyEnvelopeBaseCellLower[0], -32000);
  assert.equal(search.policyEnvelopeBaseCellUpper[0], 32000);
  assert.equal(search.policyEnvelopeCandidateCellLower[0], -32000);
  assert.equal(search.policyEnvelopeCandidateCellUpper[0], 32000);
  assert.equal(search.summary().policyEnvelopeBudgetIncompleteCount, 1);
});

test("shadow wrapper reports response dominance but cannot publish an action", () => {
  const feedback = { bind() { return 1; }, routeAction() { return ACTION.FIRE; },
    summary() { return { hotAllocationCount: 0 }; } };
  const pose = { selected: 0, cell: Uint16Array.from([13]),
    direction: Uint8Array.from([1]), fireDeadline: Uint8Array.from([4]),
    responseMask: Uint32Array.from([3]), supports(row) { return row === 1; },
    betterRow(_engine, left, right) { return right < 0 || left < right; },
    prepare() { return 1; }, summary() { return {}; } };
  const envelope = new NativePolicyResponseEnvelopePoc("shadow", {
    feedback, pose });
  const engine = { ourCount: 2, enemyCount: 2,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.FIRE]),
    ourArguments: Uint16Array.from([NONE_CELL, NONE_CELL]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    enemyActions: Uint8Array.from([ACTION.GO, ACTION.FIRE]),
    adapter: { state: {} },
    escapeObligation: { committedEntityCount: 0 } };
  const owner = { attackPoseOption: pose, allowedRow: Uint8Array.from([1, 1]),
    backedValue: Int32Array.from([100, 90]) };
  const search = { rootEnemyDomainMask: Uint8Array.from([1, 1]),
    policyEnvelopeCandidateEventComplete: Uint8Array.from([1, 1]),
    policyEnvelopeBaseCellUpper: new Int32Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES),
    policyEnvelopeCandidateCellLower: new Int32Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES),
    policyEnvelopeBaseWorst: 90, policyEnvelopeCandidateWorst: 110,
    policyEnvelopeBaseValue: 95, policyEnvelopeCandidateValue: 115,
    evaluatePolicyResponseEnvelope(_engine, baseAction, baseArgument,
        candidateAction, candidateArgument, _feedback, policy, signature) {
      assert.equal(baseAction, ACTION.GO); assert.equal(baseArgument, NONE_CELL);
      assert.equal(candidateAction, ACTION.FIRE);
      assert.equal(candidateArgument, NONE_CELL);
      assert.equal(policy, CONTINUATION_POLICY.ATTACK_TARGET);
      assert.notEqual(signature, 0);
      this.policyEnvelopeBaseCellUpper[0] = 100;
      this.policyEnvelopeBaseCellUpper[1] = 90;
      this.policyEnvelopeCandidateCellLower[0] = 120;
      this.policyEnvelopeCandidateCellLower[1] = 110;
      return 1;
    } };
  assert.equal(envelope.observe(engine, search, owner, ACTION.GO), null);
  const summary = envelope.summary();
  assert.equal(summary.lastRelation,
    POLICY_ENVELOPE_RELATION.CANDIDATE_DOMINATES);
  assert.equal(summary.candidateDominanceCount, 1);
  assert.equal(summary.wouldOverrideCount, 1);
  assert.equal(summary.overrideCount, 0);
  assert.equal(summary.semantics, "HORIZON_POLICY_ENVELOPE");
  const active = new NativePolicyResponseEnvelopePoc("active", {
    feedback, pose });
  assert.deepEqual(active.observe(engine, search, owner, ACTION.GO),
    { action: ACTION.FIRE, argument: NONE_CELL });
  assert.equal(active.summary().overrideCount, 1);
});

test("event closure blocks scalar dominance until every response reaches the attack event", () => {
  const feedback = { routeAction() { return ACTION.FIRE; },
    summary() { return {}; } };
  const pose = { selected: 0, cell: Uint16Array.from([3]),
    direction: Uint8Array.from([1]), fireDeadline: Uint8Array.from([2]),
    responseMask: Uint32Array.from([3]), supports(row) { return row === 1; },
    betterRow(_engine, left, right) { return right < 0 || left < right; },
    prepare() { return 1; }, summary() { return {}; } };
  const engine = { ourCount: 2, enemyCount: 2,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.FIRE]),
    ourArguments: Uint16Array.from([NONE_CELL, NONE_CELL]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    adapter: { state: {} },
    escapeObligation: { committedEntityCount: 0 } };
  const search = { rootEnemyDomainMask: Uint8Array.from([1, 1]),
    policyEnvelopeCandidateEventComplete: Uint8Array.from([1, 0]),
    policyEnvelopeBaseCellUpper: Int32Array.from([10, 10]),
    policyEnvelopeCandidateCellLower: Int32Array.from([20, 20]),
    policyEnvelopeBaseWorst: 10, policyEnvelopeCandidateWorst: 20,
    policyEnvelopeBaseValue: 10, policyEnvelopeCandidateValue: 20,
    evaluatePolicyResponseEnvelope() { return 1; } };
  const envelope = new NativePolicyResponseEnvelopePoc("active", {
    feedback, pose, requireEventClosure: true });
  assert.equal(envelope.observe(engine, search, {}, ACTION.GO), null);
  assert.equal(envelope.summary().eventRejectedDominanceCount, 1);
  search.policyEnvelopeCandidateEventComplete[1] = 1;
  assert.deepEqual(envelope.observe(engine, search, {}, ACTION.GO),
    { action: ACTION.FIRE, argument: NONE_CELL });
  assert.equal(envelope.summary().eventQualifiedDominanceCount, 1);
});

test("root-event schedule defers route actions before invoking minimax", () => {
  let searchCalls = 0;
  const pose = { selected: 0, cell: Uint16Array.from([3]),
    direction: Uint8Array.from([1]), fireDeadline: Uint8Array.from([3]),
    responseMask: Uint32Array.from([1]), supports() { return true; },
    betterRow(_engine, left, right) { return right < 0 || left < right; },
    prepare() { return 1; }, summary() { return {}; } };
  const envelope = new NativePolicyResponseEnvelopePoc("shadow", {
    pose, rootEventOnly: true, feedback: {
      routeAction() { return ACTION.GO; }, summary() { return {}; }
    } });
  const engine = { ourCount: 1, enemyCount: 1,
    ourActions: Uint8Array.from([ACTION.GO]),
    ourArguments: Uint16Array.from([NONE_CELL]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW]),
    adapter: { state: {} }, escapeObligation: { committedEntityCount: 0 } };
  assert.equal(envelope.observe(engine, {
    evaluatePolicyResponseEnvelope() { searchCalls += 1; return 1; }
  }, {}, ACTION.TURN_LEFT), null);
  assert.equal(searchCalls, 0);
  assert.equal(envelope.summary().rootEventDeferredCount, 1);
});

test("committed danger blocks policy ownership before paired search", () => {
  const envelope = new NativePolicyResponseEnvelopePoc("shadow", { feedback: {
    bind() { throw new Error("must not bind"); }, summary() { return {}; }
  }, pose: { selected: 0, prepare() { return 1; }, summary() { return {}; } } });
  const engine = { escapeObligation: { committedEntityCount: 1 } };
  const owner = {};
  assert.equal(envelope.observe(engine, {}, owner, ACTION.GO), null);
  assert.equal(envelope.summary().committedBlockedCount, 1);
  assert.equal(envelope.summary().overrideCount, 0);
});
