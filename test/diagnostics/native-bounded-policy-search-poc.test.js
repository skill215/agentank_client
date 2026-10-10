"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { NativeBoundedPolicySearchPoc,
  NativeIterativeCompletePolicySearchPoc, EXACT_BLOCK, EVENT_QUIESCENCE } = require(
  "../../tools/agentank/diagnostics/native-bounded-policy-search-poc");
const { FastState, ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ACTION, SKILL, TERRAIN, NONE_FRAME, NONE_CELL } = require(
  "../../engine-v2/src/abi/fast-codes");
const { FastKernel } = require("../../engine-v2/src/fast/kernel");
const { HazardKernel } = require("../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../engine-v2/src/fast/hard-gate");

test("bounded policy search owns its leaf without mutating shared search", () => {
  const state = {};
  const shared = { heuristic(value) { assert.equal(value, state); return 7; } };
  const evaluator = { evaluate(value) { assert.equal(value, state); return 19; } };
  const bounded = new NativeBoundedPolicySearchPoc({ leafEvaluator: evaluator });
  assert.equal(bounded.leaf({ adapter: { state }, depthSearch: shared }), 19);
  assert.equal(shared.heuristic(state), 7);
});

test("bounded policy search falls back to the shared production leaf", () => {
  const state = {};
  const bounded = new NativeBoundedPolicySearchPoc();
  assert.equal(bounded.leaf({ adapter: { state },
    depthSearch: { heuristic(value) { return value === state ? 11 : 0; } } }), 11);
});

test("exact blocker census separates budget completeness from value exactness", () => {
  const bounded = new NativeBoundedPolicySearchPoc();
  bounded.lastOwnershipSupportComplete = 1;
  bounded.lastDepthLeafCount = 7;
  assert.equal(bounded.classifyExactBlock(), EXACT_BLOCK.DEPTH_LEAF);
  bounded.lastDepthLeafCount = 0;
  bounded.lastBudgetLeafCount = 2;
  bounded.lastHardIncompleteCount = 1;
  bounded.lastOwnershipSupportComplete = 0;
  assert.equal(bounded.classifyExactBlock(),
    EXACT_BLOCK.BUDGET | EXACT_BLOCK.HARD_INCOMPLETE);
  const summary = bounded.summary();
  assert.equal(summary.exactBlockedRootCount, 2);
  assert.equal(summary.budgetCompleteHeuristicRootCount, 1);
  assert.equal(summary.depthOnlyHeuristicRootCount, 1);
  assert.equal(summary.exactBlockMaskCount[EXACT_BLOCK.DEPTH_LEAF], 1);
  assert.equal(summary.exactBlockMaskCount[
    EXACT_BLOCK.BUDGET | EXACT_BLOCK.HARD_INCOMPLETE], 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("row exact mask uses the whole-root blocker vocabulary", () => {
  const bounded = new NativeBoundedPolicySearchPoc();
  assert.equal(bounded.exactMask(0, 0, 0, 0, 0, 0, 0), 0);
  assert.equal(bounded.exactMask(1, 0, 1, 1, 0, 0, 0),
    EXACT_BLOCK.BUDGET | EXACT_BLOCK.HARD_INCOMPLETE |
      EXACT_BLOCK.DEPTH_LEAF);
  assert.equal(bounded.rowExactBlockMask.length > 0, true);
});

test("split path evidence preserves robust value and carries a nominal channel", () => {
  const state = {};
  const bounded = new NativeBoundedPolicySearchPoc({
    pathEvidenceMode: "split-nominal",
    leafEvaluator: { evaluate() { return 100; } }
  });
  assert.equal(bounded.pairedLeaf({ adapter: { state } }, 5, 17), 105);
  assert.equal(bounded.lastNominalValue, 117);
  assert.equal(bounded.summary().pathEvidenceMode, "split-nominal");
  assert.equal(new NativeBoundedPolicySearchPoc({ pathEvidenceMode: "invalid" })
    .summary().pathEvidenceMode, "single");
});

test("root response ordering is an explicit diagnostic axis", () => {
  const forward = new NativeBoundedPolicySearchPoc();
  const reverse = new NativeBoundedPolicySearchPoc({ rootColumnOrder: "reverse" });
  const v1 = new NativeBoundedPolicySearchPoc({ rootColumnOrder: "v1" });
  assert.deepEqual([0, 1, 2, 3].map(step => forward.rootColumnIndex(step, 4)),
    [0, 1, 2, 3]);
  assert.deepEqual([0, 1, 2, 3].map(step => reverse.rootColumnIndex(step, 4)),
    [3, 2, 1, 0]);
  assert.equal(reverse.summary().rootColumnOrder, "reverse");
  v1.rootEnemyDomainMask.fill(1, 0, 5);
  const engine = { enemyCount: 5, enemyActions: new Uint8Array([
    ACTION.NONE, ACTION.TURN_LEFT, ACTION.CAST_STUN, ACTION.GO, ACTION.FIRE
  ]) };
  assert.equal(v1.buildRootColumnSequence(engine), 5);
  assert.deepEqual([0, 1, 2, 3, 4].map(step =>
    v1.rootColumnIndex(step, 5)), [3, 4, 1, 2, 0]);
  assert.equal(v1.summary().rootColumnOrder, "v1");
});

test("V1 deterministic own stun chance keeps one risk-selected outcome", () => {
  const state = new FastState(8, 8); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  a[ARRAY.TANK_CELL][1] = state.cell(6, 2);
  a[ARRAY.TANK_DIR][0] = 1; a[ARRAY.TANK_DIR][1] = 3;
  a[ARRAY.TANK_FIRE_LOCK][0] = NONE_FRAME;
  a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.TANK_BOOST_UNTIL][0] = NONE_FRAME;
  a[ARRAY.TANK_BOOST_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_OVERLOAD_UNTIL][1] = NONE_FRAME;
  a[ARRAY.SCALAR][SCALAR.FRAME] = 0;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  const bounded = new NativeBoundedPolicySearchPoc({
    ownChanceMode: "v1-deterministic"
  });
  // Advancing toward the aimed enemy muzzle is riskier than the reversed GO,
  // so V1 keeps the normal chance code: platform reversal executes backward.
  assert.equal(bounded.v1OwnChance(state, ACTION.GO), 0);
  // With equal immediate risks V1 deliberately chooses the reversed chance.
  a[ARRAY.TANK_FIRE_LOCK][1] = 99;
  a[ARRAY.TANK_CELL][0] = state.cell(4, 4);
  a[ARRAY.TANK_CELL][1] = state.cell(6, 6);
  assert.equal(bounded.v1OwnChance(state, ACTION.TURN_LEFT), 1);
  assert.equal(bounded.summary().ownChanceMode, "v1-deterministic");
  assert.equal(bounded.summary().v1OwnChanceCheckCount, 2);
  assert.equal(bounded.summary().v1OwnReversedCount, 1);
  assert.equal(bounded.summary().hotAllocationCount, 0);
});

test("policy invocation audit accounts every native and oracle quadrant", () => {
  const bounded = new NativeBoundedPolicySearchPoc();
  bounded.compareInvocation(true, true, 0);
  bounded.compareInvocation(true, false, 4);
  bounded.compareInvocation(false, true, 1);
  bounded.compareInvocation(false, false, 5);
  const summary = bounded.summary();
  assert.equal(summary.invocationCompareCount, 4);
  assert.equal(summary.invocationBothCount, 1);
  assert.equal(summary.invocationNativeOnlyCount, 1);
  assert.equal(summary.invocationOracleOnlyCount, 1);
  assert.equal(summary.invocationNeitherCount, 1);
  assert.deepEqual(summary.invocationNativeOnlyByResult, [0, 0, 0, 0, 1, 0]);
  assert.deepEqual(summary.invocationOracleOnlyByResult, [0, 1, 0, 0, 0, 0]);
});

test("external root eligibility is a zero-allocation domain intersection", () => {
  const bounded = new NativeBoundedPolicySearchPoc();
  const eligibility = new Uint8Array([1, 0, 1]);
  // Exercise the intersection contract directly: the runtime prepare path uses
  // the same fixed mask and never materializes a filtered action list.
  bounded.rootDomainMask.fill(1, 0, 3);
  for (let row = 0; row < 3; row += 1)
    if (!eligibility[row]) {
      bounded.rootDomainMask[row] = 0;
      bounded.externalRootRestrictedRowCount += 1;
    }
  bounded.externalRootRestrictionCount += 1;
  bounded.rootDomainRestricted = 1;
  const summary = bounded.summary();
  assert.deepEqual(Array.from(bounded.rootDomainMask.slice(0, 3)), [1, 0, 1]);
  assert.equal(summary.externalRootRestrictionCount, 1);
  assert.equal(summary.externalRootRestrictedRowCount, 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("ordered domain audit separates set equality from tie-break ordering", () => {
  const bounded = new NativeBoundedPolicySearchPoc();
  const native = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT,
    ACTION.TURN_RIGHT]);
  bounded.compareOrderedDomain(native, 0, 3,
    ["GO", "RIGHT", "LEFT"], 0);
  let summary = bounded.summary();
  assert.equal(summary.domainCompareCount[0], 1);
  assert.equal(summary.domainSetAgreementCount[0], 1);
  assert.equal(summary.domainOrderAgreementCount[0], 0);
  bounded.compareOrderedDomain(native, 0, 3,
    ["GO", "LEFT", "FIRE"], 1);
  summary = bounded.summary();
  assert.equal(summary.domainSetAgreementCount[1], 0);
  const width = ACTION.BOOST_RIGHT_BOMB + 1;
  assert.equal(summary.domainNativeOnlyActionCount[width + ACTION.TURN_RIGHT], 1);
  assert.equal(summary.domainOracleOnlyActionCount[width + ACTION.FIRE], 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("root value audit attributes rank only after matching search domains", () => {
  const bounded = new NativeBoundedPolicySearchPoc();
  const engine = { ourCount: 3,
    ourActions: new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.FIRE]) };
  bounded.rootScore[0] = 90;
  bounded.rootScore[1] = 20;
  bounded.rootScore[2] = -10;
  bounded.rootDomainMask.fill(1, 0, 3);
  bounded.rootDomainRestricted = 1;
  bounded.preparedRootCount = 3;
  bounded.lastOneStepRootComparable = 1;
  bounded.lastOneStepComparedCount = 9;
  bounded.lastDeepTransitionComparedCount = 4;
  bounded.lastSearchOwnDomainResult = 3;
  bounded.lastSearchEnemyDomainResult = 3;
  bounded.lastOwnershipSupportComplete = 1;
  bounded.compareRootValueOrdering(engine, { roots: [
    { action: "GO", value: 12 },
    { action: "LEFT", value: 4 },
    { action: "FIRE", value: -3 }
  ] });
  const summary = bounded.summary();
  assert.deepEqual(summary.rootValuePairComparedCount, [3, 3, 3]);
  assert.deepEqual(summary.rootValuePairOrderAgreementCount, [3, 3, 3]);
  assert.deepEqual(summary.rootValueBestComparedCount, [1, 1, 1]);
  assert.deepEqual(summary.rootValueBestAgreementCount, [1, 1, 1]);
  assert.equal(summary.rootValueStrictCount, 1);
});

test("root domain audit stops at the prepared search count", () => {
  const bounded = new NativeBoundedPolicySearchPoc();
  bounded.preparedRootCount = 2;
  bounded.rootDomainRestricted = 1;
  bounded.rootDomainMask[0] = 1;
  bounded.rootDomainMask[1] = 1;
  bounded.rootDomainMask[2] = 1;
  bounded.compareRootActionDomains({
    ourActions: new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.NONE]),
    ourCount: 3,
    enemyActions: new Uint8Array([ACTION.GO]),
    enemyCount: 1
  }, [{ action: "GO" }, { action: "LEFT" }], null);
  const summary = bounded.summary();
  assert.equal(summary.domainSetAgreementCount[0], 1);
  assert.equal(summary.domainOrderAgreementCount[0], 1);
});

test("isolated V1 root domain observes can-act and skill order without root mutation", () => {
  const state = new FastState(8, 8); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  a[ARRAY.TANK_CELL][1] = state.cell(5, 2);
  a[ARRAY.TANK_DIR][0] = 1; a[ARRAY.TANK_DIR][1] = 3;
  a[ARRAY.TANK_SKILL][0] = SKILL.STUN; a[ARRAY.TANK_SKILL][1] = SKILL.STUN;
  a[ARRAY.TANK_SKILL_READY][0] = 0; a[ARRAY.TANK_SKILL_READY][1] = 0;
  a[ARRAY.TANK_STUN_UNTIL][0] = NONE_FRAME;
  a[ARRAY.TANK_STUN_UNTIL][1] = NONE_FRAME;
  a[ARRAY.SCALAR][SCALAR.FRAME] = 0;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  const domain = { qualifiedFireForSeat() { return 0; }, qualifiedBomb() { return 0; } };
  const bounded = new NativeBoundedPolicySearchPoc({
    deepDomainMode: "v1-shaped", deepFireDomain: domain
  });
  const engine = { adapter: { state, ownCanAct: 1, enemyCanAct: 1,
    ownBombReady: 1, enemySkillReady: 1 }, depthSearch: {
    target(value, cell, direction) { return bounded.targetCell(value, cell, direction); },
    walkable(value, cell) { return cell !== NONE_CELL &&
      value.arrays[ARRAY.TERRAIN][cell] !== TERRAIN.WALL &&
      value.arrays[ARRAY.TERRAIN][cell] !== TERRAIN.DIRT; }
  } };
  bounded.generateAuditRootDomain(engine, 0);
  assert.deepEqual(Array.from(bounded.auditRootOwnActions.slice(0,
    bounded.auditRootOwnCount)), [ACTION.GO, ACTION.CAST_STUN,
    ACTION.TURN_LEFT, ACTION.TURN_RIGHT]);
  bounded.generateAuditRootDomain(engine, 1);
  assert.deepEqual(Array.from(bounded.auditRootEnemyActions.slice(0,
    bounded.auditRootEnemyCount)), [ACTION.GO, ACTION.TURN_LEFT,
    ACTION.TURN_RIGHT, ACTION.CAST_STUN]);
  engine.adapter.ownCanAct = 0;
  bounded.generateAuditRootDomain(engine, 0);
  assert.deepEqual(Array.from(bounded.auditRootOwnActions.slice(0,
    bounded.auditRootOwnCount)), [ACTION.NONE]);
  assert.equal(engine.adapter.ownCanAct, 0);
});

test("root matrix budget ownership can be made cell-equal", () => {
  const shared = new NativeBoundedPolicySearchPoc();
  const equal = new NativeBoundedPolicySearchPoc({ rootBudgetMode: "cell-equal" });
  assert.equal(shared.summary().rootBudgetMode, "row-shared");
  assert.equal(equal.summary().rootBudgetMode, "cell-equal");
});

test("event quiescence is default-off and only reads physical projectile/bomb facts", () => {
  const state = new FastState(4, 4);
  const off = new NativeBoundedPolicySearchPoc();
  const search = new NativeBoundedPolicySearchPoc({
    eventQuiescenceMode: "projectile-bomb", eventQuiescenceMaximumPly: 2
  });
  assert.equal(off.eventInstabilityMask(state), 0);
  assert.equal(off.summary().eventQuiescenceMode, EVENT_QUIESCENCE.OFF);
  state.arrays[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  assert.equal(search.eventInstabilityMask(state), 1);
  state.arrays[ARRAY.BOMB_ACTIVE][0] = 1;
  assert.equal(search.eventInstabilityMask(state), 3);
  state.arrays[ARRAY.PROJECTILE_ACTIVE][0] = 0;
  assert.equal(search.eventInstabilityMask(state), 2);
  assert.equal(search.summary().eventQuiescenceMaximumPly, 2);
});

test("event quiescence extends an unstable depth leaf and stops when quiet", () => {
  const state = new FastState(4, 4);
  state.arrays[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  const search = new NativeBoundedPolicySearchPoc({
    eventQuiescenceMode: "projectile-bomb", eventQuiescenceMaximumPly: 2,
    leafEvaluator: { evaluate() { return 37; } }
  });
  search.currentDepth = 1; search.perRootBudget = 64;
  search.generate = function(_engine, top, seat) {
    assert.equal(seat, 0); this.deepOurActions[top * 6] = ACTION.GO;
    this.deepOurArguments[top * 6] = NONE_CELL; return 1;
  };
  search.worstReply = function(engine, _action, _argument, depth, top,
      pathScore, nominalPathScore) {
    state.arrays[ARRAY.PROJECTILE_ACTIVE][0] = 0;
    const value = this.policyValue(engine, depth - 1, top + 1, pathScore,
      nominalPathScore);
    state.arrays[ARRAY.PROJECTILE_ACTIVE][0] = 1;
    return value;
  };
  const engine = { adapter: { state }, depthSearch: { heuristic() { return 0; } } };
  assert.equal(search.policyValue(engine, 0, 1, 0, 0), 37);
  const summary = search.summary();
  assert.equal(summary.eventQuiescenceExpansionCount, 1);
  assert.equal(summary.eventQuiescenceQuietLeafCount, 1);
  assert.equal(summary.eventQuiescenceCappedLeafCount, 0);
  assert.deepEqual(summary.eventQuiescenceExpansionByPly, [0, 1, 0, 0]);
});

test("event quiescence keeps unresolved events heuristic at its explicit cap", () => {
  const state = new FastState(4, 4);
  state.arrays[ARRAY.BOMB_ACTIVE][0] = 1;
  const search = new NativeBoundedPolicySearchPoc({
    eventQuiescenceMode: "projectile-bomb", eventQuiescenceMaximumPly: 1,
    leafEvaluator: { evaluate() { return 11; } }
  });
  search.currentDepth = 1; search.perRootBudget = 64;
  search.generate = function(_engine, top) {
    this.deepOurActions[top * 6] = ACTION.TURN_LEFT;
    this.deepOurArguments[top * 6] = NONE_CELL; return 1;
  };
  search.worstReply = function(engine, _action, _argument, depth, top,
      pathScore, nominalPathScore) {
    return this.policyValue(engine, depth - 1, top + 1, pathScore,
      nominalPathScore);
  };
  const engine = { adapter: { state }, depthSearch: { heuristic() { return 0; } } };
  assert.equal(search.policyValue(engine, 0, 1, 0, 0), 11);
  const summary = search.summary();
  assert.equal(summary.eventQuiescenceExpansionCount, 1);
  assert.equal(summary.eventQuiescenceCappedLeafCount, 1);
  assert.equal(summary.eventQuiescenceBombLeafCount, 2);
});

test("event quiescence can compress only our continuation to one BasePolicy action", () => {
  const state = new FastState(4, 4);
  const continuation = { engine: null, routeAction(current) {
    assert.equal(current, state); return ACTION.TURN_RIGHT;
  } };
  const search = new NativeBoundedPolicySearchPoc({
    eventQuiescenceMode: "projectile-bomb",
    eventQuiescenceContinuationMode: "base-policy",
    eventQuiescenceContinuation: continuation
  });
  search.eventQuiescenceRoutingTop = 1;
  search.eventQuiescenceRoutedAction = ACTION.TURN_RIGHT;
  search.generatePrimitive = function(_engine, top, seat) {
    assert.equal(seat, 0); const offset = top * 6;
    this.deepOurActions[offset] = ACTION.GO;
    this.deepOurActions[offset + 1] = ACTION.TURN_LEFT;
    this.deepOurActions[offset + 2] = ACTION.TURN_RIGHT;
    this.deepOurCount[top] = 3; return 3;
  };
  search.fullPrimitiveDomain = true;
  const engine = { adapter: { state } };
  assert.equal(search.generate(engine, 1, 0), 1);
  assert.equal(search.deepOurActions[6], ACTION.TURN_RIGHT);
  search.prepare = function(bound) {
    this.eventQuiescenceContinuation.engine = bound; return 1;
  };
  assert.equal(search.prepare(engine), 1);
  assert.equal(continuation.engine, engine);
  assert.equal(search.summary().eventQuiescenceContinuationMode, "base-policy");
});

test("fixed own continuation keeps the root domain full but every deep own domain singular", () => {
  const state = new FastState(4, 4);
  const search = new NativeBoundedPolicySearchPoc({
    ownContinuationMode: "base-policy",
    ownContinuation: { routeAction() { return ACTION.TURN_LEFT; } }
  });
  search.fullPrimitiveDomain = true;
  search.generatePrimitive = function(_engine, top, seat) {
    assert.equal(seat, 0); const offset = top * 6;
    this.deepOurActions[offset] = ACTION.GO;
    this.deepOurActions[offset + 1] = ACTION.TURN_LEFT;
    this.deepOurActions[offset + 2] = ACTION.FIRE;
    this.deepOurCount[top] = 3; return 3;
  };
  const engine = { adapter: { state } };
  assert.equal(search.generate(engine, 2, 0), 1);
  assert.equal(search.deepOurActions[12], ACTION.TURN_LEFT);
  assert.equal(search.summary().ownContinuationRouteCount, 1);
  assert.equal(search.summary().ownContinuationDomainFallbackCount, 0);
});

test("fixed own continuation has a stable one-action legal fallback", () => {
  const state = new FastState(4, 4);
  const search = new NativeBoundedPolicySearchPoc({
    ownContinuationMode: "base-policy",
    ownContinuation: { routeAction() { return ACTION.CAST_TELEPORT; } }
  });
  search.fullPrimitiveDomain = true;
  search.generatePrimitive = function(_engine, top) {
    const offset = top * 6;
    this.deepOurActions[offset] = ACTION.GO;
    this.deepOurActions[offset + 1] = ACTION.TURN_RIGHT;
    this.deepOurCount[top] = 2; return 2;
  };
  assert.equal(search.generate({ adapter: { state } }, 1, 0), 1);
  assert.equal(search.deepOurActions[6], ACTION.GO);
  assert.equal(search.summary().ownContinuationDomainFallbackCount, 1);
});

test("policy portfolio keeps at most two distinct continuation actions", () => {
  const state = new FastState(4, 4);
  let attack = ACTION.FIRE;
  const search = new NativeBoundedPolicySearchPoc({
    ownContinuationMode: "portfolio",
    ownContinuation: { routeAction() { return ACTION.GO; } },
    ownContinuationSecondary: { routeAction() { return attack; } }
  });
  search.fullPrimitiveDomain = true;
  search.generatePrimitive = function(_engine, top) {
    const offset = top * 6;
    this.deepOurActions[offset] = ACTION.GO;
    this.deepOurActions[offset + 1] = ACTION.TURN_LEFT;
    this.deepOurActions[offset + 2] = ACTION.FIRE;
    this.deepOurCount[top] = 3; return 3;
  };
  const engine = { adapter: { state } };
  assert.equal(search.generate(engine, 1, 0), 2);
  assert.deepEqual(Array.from(search.deepOurActions.slice(6, 8)),
    [ACTION.GO, ACTION.FIRE]);
  attack = ACTION.GO;
  assert.equal(search.generate(engine, 2, 0), 1);
  const summary = search.summary();
  assert.deepEqual(summary.ownContinuationPortfolioWidthCount, [0, 1, 1]);
  assert.equal(summary.ownContinuationPortfolioDedupCount, 1);
});

test("root policy binds one continuation identity to each root row", () => {
  const state = new FastState(4, 4);
  const primary = { routeAction() { return ACTION.GO; } };
  const secondary = { routeAction() { return ACTION.FIRE; } };
  const search = new NativeBoundedPolicySearchPoc({
    ownContinuationMode: "root-policy",
    ownContinuation: primary,
    ownContinuationSecondary: secondary
  });
  search.fullPrimitiveDomain = true;
  search.generatePrimitive = function(_engine, top) {
    const offset = top * 6;
    this.deepOurActions[offset] = ACTION.GO;
    this.deepOurActions[offset + 1] = ACTION.FIRE;
    this.deepOurCount[top] = 2; return 2;
  };
  const engine = { adapter: { state } };
  search.currentOwnContinuation = secondary;
  assert.equal(search.generate(engine, 1, 0), 1);
  assert.equal(search.deepOurActions[6], ACTION.FIRE);
  search.currentOwnContinuation = primary;
  assert.equal(search.generate(engine, 2, 0), 1);
  assert.equal(search.deepOurActions[12], ACTION.GO);
});

test("direct root policy filters attack setup before root ownership", () => {
  const state = new FastState(4, 4);
  const search = new NativeBoundedPolicySearchPoc({
    ownContinuationMode: "root-policy-direct",
    ownContinuation: { routeAction() { return ACTION.GO; } },
    ownContinuationSecondary: { routeAction() { return ACTION.TURN_LEFT; } }
  });
  assert.equal(search.qualifyRootPolicySecondary(ACTION.TURN_LEFT), ACTION.NONE);
  assert.equal(search.qualifyRootPolicySecondary(ACTION.FIRE), ACTION.FIRE);
  assert.equal(search.summary().rootPolicySecondaryFilteredCount, 1);
  search.fullPrimitiveDomain = true;
  search.generatePrimitive = function(_engine, top) {
    const offset = top * 6;
    this.deepOurActions[offset] = ACTION.GO;
    this.deepOurActions[offset + 1] = ACTION.TURN_LEFT;
    this.deepOurCount[top] = 2; return 2;
  };
  search.currentOwnContinuation = search.ownContinuation;
  assert.equal(search.generate({ adapter: { state } }, 1, 0), 1);
  assert.equal(search.deepOurActions[6], ACTION.GO);
});

test("iterative complete search restores the last common completed horizon", () => {
  const search = new NativeIterativeCompletePolicySearchPoc({
    targetDepth: 3, nodeBudget: 100
  });
  const budgets = [];
  search.prepareLayer = function() {
    const depth = this.iterationDepth;
    budgets.push(this.nodeBudget);
    this.prepareCount += 1;
    const spent = depth === 1 ? 20 : 80;
    this.totalNodes += spent;
    this.rootScore[0] = depth * 100;
    this.rootNominalScore[0] = depth * 100 + 1;
    this.rootCellScore[0] = depth * 100 + 2;
    this.rootNominalCellScore[0] = depth * 100 + 3;
    this.rowExactBlockMask[0] = depth;
    this.lastOwnershipSupportComplete = depth === 1 ? 1 : 0;
    this.lastValueExact = 0;
    this.lastDepthLeafCount = depth;
    this.lastTopLeafCount = 0;
    this.lastPolicyRejectCount = 0;
    this.lastNoActionLeafCount = 0;
    this.lastExactBlockMask = EXACT_BLOCK.DEPTH_LEAF;
    this.lastExactRowCount = 0;
    return 1;
  };
  assert.equal(search.prepare({}, 1), 1);
  assert.deepEqual(budgets, [100, 80]);
  assert.equal(search.rootScore[0], 100);
  assert.equal(search.rootNominalScore[0], 101);
  assert.equal(search.rootCellScore[0], 102);
  assert.equal(search.rootNominalCellScore[0], 103);
  assert.equal(search.rowExactBlockMask[0], 1);
  assert.equal(search.completedDepth, 1);
  assert.equal(search.representativeSupportDepth, 1);
  assert.equal(search.lastOwnershipSupportComplete, 1);
  assert.equal(search.prepareCount, 1);
  const summary = search.summary();
  assert.equal(summary.depthSchedule, "iterative-complete");
  assert.equal(summary.rootBudgetMode, "cell-equal");
  assert.deepEqual(summary.iterativePublishedDepthCount, [0, 1, 0, 0, 0]);
  assert.equal(summary.iterativeDeeperIncompleteCount, 1);
  assert.equal(summary.lastIterativeSpentNodes, 100);
  assert.equal(summary.lastIterativeRemainingNodes, 0);
});

test("iterative complete search publishes the deepest fully completed layer", () => {
  const search = new NativeIterativeCompletePolicySearchPoc({
    targetDepth: 3, nodeBudget: 120
  });
  search.prepareLayer = function() {
    this.prepareCount += 1;
    this.totalNodes += 20;
    this.rootScore[0] = this.iterationDepth * 10;
    this.rootCellScore[0] = this.iterationDepth * 10 + 1;
    this.lastOwnershipSupportComplete = 1;
    this.lastDepthLeafCount = 1;
    this.lastExactBlockMask = EXACT_BLOCK.DEPTH_LEAF;
    return 1;
  };
  assert.equal(search.prepare({}, 1), 1);
  assert.equal(search.rootScore[0], 30);
  assert.equal(search.rootCellScore[0], 31);
  assert.equal(search.completedDepth, 3);
  assert.equal(search.lastIterativePublishedDepth, 3);
  assert.equal(search.prepareCount, 1);
  assert.deepEqual(search.summary().iterativePublishedDepthCount,
    [0, 0, 0, 1, 0]);
});

test("iterative complete search refuses ownership without a complete P1", () => {
  const search = new NativeIterativeCompletePolicySearchPoc({
    targetDepth: 3, nodeBudget: 64
  });
  search.prepareLayer = function() {
    this.prepareCount += 1;
    this.totalNodes += 64;
    this.rootScore[0] = 999;
    this.lastOwnershipSupportComplete = 0;
    this.lastBudgetLeafCount = 1;
    return 1;
  };
  assert.equal(search.prepare({}, 1), 0);
  assert.equal(search.representativeSupportComplete, 0);
  assert.equal(search.lastOwnershipSupportComplete, 0);
  assert.equal(search.summary().iterativeNoCompleteLayerCount, 1);
  assert.equal(search.prepareCount, 1);
});

test("transition audit does not claim component exactness for scalar-only leaves", () => {
  const state = new FastState(4, 4);
  state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  const bounded = new NativeBoundedPolicySearchPoc({
    leafEvaluator: { evaluate() { return 7; } }
  });
  const expected = { frame: 0, myX: 0, myY: 0, enemyX: 0, enemyY: 0,
    myDir: "up", enemyDir: "up", myStars: 0, enemyStars: 0,
    starX: -1, starY: -1, myDead: false, enemyDead: false,
    projectiles: [], bombs: [], dirtCount: 0, myStunned: 0, enemyStunned: 0,
    myFrozen: 0, enemyFrozen: 0, myPoisoned: 0, enemyPoisoned: 0,
    myShieldHits: 0, enemyShieldHits: 0, myOverloadFrames: 0,
    enemyOverloadFrames: 0, myBoostFrames: 0, enemyBoostFrames: 0,
    myCloaked: 0, enemyCloaked: 0, value: 7,
    components: { objective: 1, projectile: 2, attack: 3, position: 4,
      status: 5, action: 6, repetition: 7, survival: 8 } };
  assert.equal(bounded.compareAppliedTransition({ adapter: { state } }, expected), 0);
  assert.equal(bounded.summary().transitionExactLeafCount, 0);
  assert.equal(bounded.leafComponentsAvailable(), 0);
  bounded.leafEvaluator.lastComponents = new Int32Array(6);
  assert.equal(bounded.leafComponentsAvailable(), 1);
  assert.equal(bounded.compareAppliedTransition({ adapter: { state } },
    expected, ACTION.FIRE, 17, 3), 0);
  assert.equal(bounded.lastTransitionOwnExactLeafCount[ACTION.FIRE], 1);
  assert.equal(bounded.lastTransitionOwnComponentSignedDifference[
    ACTION.FIRE * 8], -1);
  assert.equal(bounded.lastTransitionOwnComponentSignedDifference[
    ACTION.FIRE * 8 + 5], 11);
  assert.equal(bounded.lastTransitionOwnComponentSignedDifference[
    ACTION.FIRE * 8 + 6], -4);
});

test("extra poison root is diagnostic and explicit", () => {
  const normal = new NativeBoundedPolicySearchPoc({ rootDomainMode: "v1-shaped" });
  const poison = new NativeBoundedPolicySearchPoc({ rootDomainMode: "v1-shaped",
    rootExtraPoison: true });
  assert.equal(normal.summary().rootExtraPoison, false);
  assert.equal(poison.summary().rootExtraPoison, true);
});

test("bounded policy search applies path history only inside its own leaf", () => {
  const state = {};
  const bounded = new NativeBoundedPolicySearchPoc({
    leafEvaluator: { evaluate() { return 30; } },
    historyEvaluator: { adjustOwn(value, base) {
      assert.equal(value, state); return base - 9;
    } }
  });
  assert.equal(bounded.leaf({ adapter: { state }, depthSearch: {} }), 21);
  assert.equal(bounded.summary().historyAdjusted, true);
});

test("weighted backup consumes opponent propensity without changing the state", () => {
  const state = new FastState(8, 8); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(6, 2);
  a[ARRAY.TANK_CELL][1] = state.cell(2, 2);
  a[ARRAY.TANK_DIR][1] = 1; a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  const engine = { policy: { opponent: { riskPreference: 50,
    propensity() { return 5000; } } } };
  const bounded = new NativeBoundedPolicySearchPoc({ opponentWeighted: true });
  const hashLo = state.hashLo; const hashHi = state.hashHi;
  assert.ok(bounded.opponentWeight(engine, state, ACTION.FIRE) >
    bounded.opponentWeight(engine, state, ACTION.TURN_LEFT));
  assert.equal(state.hashLo, hashLo); assert.equal(state.hashHi, hashHi);
  assert.equal(bounded.summary().opponentWeighted, true);
});

test("state depth schedule reserves depth three for tactical pressure", () => {
  const state = new FastState(12, 12); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(5, 5);
  a[ARRAY.TANK_CELL][1] = state.cell(9, 9);
  const bounded = new NativeBoundedPolicySearchPoc({
    targetDepth: 3, depthSchedule: "v1-state"
  });
  const engine = { adapter: { state } };
  assert.equal(bounded.scheduledDepth(engine), 2);
  a[ARRAY.TANK_CELL][1] = state.cell(5, 8);
  assert.equal(bounded.scheduledDepth(engine), 3);
  a[ARRAY.TANK_CELL][1] = state.cell(9, 9);
  a[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  assert.equal(bounded.scheduledDepth(engine), 3);
});

test("bounded policy deep stun domain requires a usable supported cast", () => {
  const bounded = new NativeBoundedPolicySearchPoc({ deepSkillMode: "both" });
  const state = new FastState(12, 12); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(2, 4);
  a[ARRAY.TANK_CELL][1] = state.cell(7, 4);
  a[ARRAY.TANK_SKILL][0] = SKILL.STUN;
  a[ARRAY.TANK_SKILL_READY][0] = 0;
  a[ARRAY.TANK_STUN_UNTIL][1] = NONE_FRAME;
  a[ARRAY.SCALAR][SCALAR.FRAME] = 0;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  assert.equal(bounded.usefulStun(state, 0), 1);
  a[ARRAY.TANK_SKILL_READY][0] = 2;
  assert.equal(bounded.usefulStun(state, 0), 0);
  a[ARRAY.TANK_SKILL_READY][0] = 0;
  a[ARRAY.TERRAIN][state.cell(4, 4)] = TERRAIN.WALL;
  assert.equal(bounded.usefulStun(state, 0), 0);
});

test("bounded policy uses an isolated Hard hazard cache", () => {
  const state = new FastState(8, 8); const kernel = new FastKernel(state);
  const productionHazard = new HazardKernel(state, {
    reverseViabilityCacheEntries: 16
  });
  const productionHard = new HardGate(kernel, productionHazard, 0);
  const bounded = new NativeBoundedPolicySearchPoc();
  bounded.bindIsolatedHard({ state, kernel, hard: productionHard,
    hazard: productionHazard });
  assert.notEqual(bounded.diagnosticHard, productionHard);
  assert.notEqual(bounded.diagnosticHazard, productionHazard);
  assert.notEqual(bounded.diagnosticHard.kernel, kernel);
  assert.equal(bounded.diagnosticHard.kernel, bounded.diagnosticKernel);
  assert.equal(bounded.diagnosticKernel.state, state);
  assert.equal(bounded.summary().isolationAllocationCount, 1);
  bounded.bindIsolatedHard({ state, kernel, hard: productionHard,
    hazard: productionHazard });
  assert.equal(bounded.summary().isolationAllocationCount, 1);
});

test("bounded policy can delegate only our deep FIRE domain", () => {
  const calls = []; const domain = { qualifiedFire(state) {
    calls.push(state); return 0;
  } };
  const bounded = new NativeBoundedPolicySearchPoc({
    deepFireMode: "v1-own", deepFireDomain: domain
  });
  const state = new FastState(8, 8); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  a[ARRAY.TANK_CELL][1] = state.cell(5, 2);
  a[ARRAY.TANK_DIR][0] = 1; a[ARRAY.TANK_DIR][1] = 3;
  a[ARRAY.TANK_FIRE_LOCK][0] = NONE_FRAME;
  a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  const engine = { adapter: { state }, depthSearch: {
    target(value, cell, direction) { return bounded.targetCell(value, cell, direction); },
    walkable() { return 1; }
  } };
  bounded.generatePrimitive(engine, 0, 0);
  assert.equal(calls.length, 1);
  bounded.generatePrimitive(engine, 0, 1);
  assert.equal(calls.length, 1);
  assert.equal(bounded.summary().deepV1FireCheckCount, 1);
});

test("transition differential maps V1 compound and skill actions exactly", () => {
  const bounded = new NativeBoundedPolicySearchPoc();
  assert.equal(bounded.legacyAction("WAIT"), ACTION.NONE);
  assert.equal(bounded.legacyAction("ENEMY_STUN"), ACTION.CAST_STUN);
  assert.equal(bounded.legacyAction("LEFT_GO"), ACTION.BOOST_LEFT_GO);
  assert.equal(bounded.legacyAction("RIGHT_FIRE"), ACTION.BOOST_RIGHT_FIRE);
  assert.equal(bounded.legacyAction("UNKNOWN"), -1);
});

test("V1 countdown POC extends only a successful simulated stun window", () => {
  const state = new FastState(8, 8); const a = state.arrays;
  a[ARRAY.SCALAR][SCALAR.FRAME] = 11;
  a[ARRAY.TANK_SKILL][0] = SKILL.STUN;
  a[ARRAY.TANK_SKILL_READY][0] = 30;
  a[ARRAY.TANK_STUN_UNTIL][1] = 16;
  const bounded = new NativeBoundedPolicySearchPoc({ v1StunCountdown: true });
  bounded.extendV1StunCountdown(state, ACTION.CAST_STUN, ACTION.GO, 10);
  assert.equal(a[ARRAY.TANK_STUN_UNTIL][1], 17);
  bounded.extendV1StunCountdown(state, ACTION.GO, ACTION.GO, 10);
  assert.equal(a[ARRAY.TANK_STUN_UNTIL][1], 17);
});

test("V1 superko reproduces root-history distance and context weakening", () => {
  const state = new FastState(8, 8); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2); a[ARRAY.TANK_DIR][0] = 1;
  a[ARRAY.SCALAR][SCALAR.FRAME] = 0;
  const bounded = new NativeBoundedPolicySearchPoc({
    superkoMode: "v1", leafEvaluator: { evaluate() { return 0; } }
  });
  const engine = { adapter: { state } };
  bounded.observeRoot(engine, 0);
  a[ARRAY.TANK_CELL][0] = state.cell(3, 2);
  a[ARRAY.SCALAR][SCALAR.FRAME] = 1;
  bounded.observeRoot(engine, 1);
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  assert.equal(bounded.superkoPenalty(state, 1), 120);
  assert.equal(bounded.summary().superkoRootMatchCount, 1);
});

test("V1 superko prioritizes a two-ply simulated-path repetition", () => {
  const state = new FastState(8, 8); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(4, 4); a[ARRAY.TANK_DIR][0] = 2;
  const bounded = new NativeBoundedPolicySearchPoc({ superkoMode: "v1" });
  bounded.pathPoseKey[1] = bounded.poseKey(state);
  assert.equal(bounded.superkoPenalty(state, 3), 240);
  assert.equal(bounded.summary().superkoPathMatchCount, 1);
});

test("diagnostic entry-collision kernel resolves movement onto a committed projectile", () => {
  const state = new FastState(8, 8); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  a[ARRAY.TANK_CELL][1] = state.cell(6, 6);
  a[ARRAY.TANK_DIR][0] = 1;
  a[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  a[ARRAY.PROJECTILE_OWNER][0] = 1;
  a[ARRAY.PROJECTILE_CELL][0] = state.cell(3, 2);
  a[ARRAY.PROJECTILE_DIR][0] = 1;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  a[ARRAY.SCALAR][SCALAR.TIMEOUT_SEAT] = 2;
  a[ARRAY.SCALAR][SCALAR.SCRIPT_ERROR_SEAT] = 2;
  state.initializeHash();
  const production = new FastKernel(state);
  const bounded = new NativeBoundedPolicySearchPoc({
    v1EntryProjectileCollision: true
  });
  bounded.bindIsolatedHard({ state, kernel: production });
  bounded.diagnosticKernel.applyFrame(ACTION.GO, NONE_CELL,
    ACTION.NONE, NONE_CELL);
  assert.equal(a[ARRAY.TANK_CRASH][0], 1);
  assert.equal(a[ARRAY.PROJECTILE_ACTIVE][0], 0);
});

test("bounded policy exposes explicit deep Hard ownership modes", () => {
  assert.equal(new NativeBoundedPolicySearchPoc().summary().deepHardMode, "full");
  assert.equal(new NativeBoundedPolicySearchPoc({ deepHardMode: "proof-only" })
    .summary().deepHardMode, "proof-only");
  assert.equal(new NativeBoundedPolicySearchPoc({ deepHardMode: "terminal-only" })
    .summary().deepHardMode, "terminal-only");
});

test("V1 root-domain POC records only oracle-generated action kinds", () => {
  const bounded = new NativeBoundedPolicySearchPoc({
    rootDomainMode: "v1-actions"
  });
  bounded.setOracleRootActions([{ action: "GO" }, { action: "STUN" }]);
  assert.equal(bounded.oracleRootActionMask[ACTION.GO], 1);
  assert.equal(bounded.oracleRootActionMask[ACTION.CAST_STUN], 1);
  assert.equal(bounded.oracleRootActionMask[ACTION.FIRE], 0);
  assert.equal(bounded.summary().rootDomainMode, "v1-actions");
  assert.equal(new NativeBoundedPolicySearchPoc({ rootDomainMode: "primitive" })
    .summary().rootDomainMode, "primitive");
});

test("bounded policy makes terminal utility ownership explicit", () => {
  assert.equal(new NativeBoundedPolicySearchPoc().summary().terminalMode,
    "platform");
  assert.equal(new NativeBoundedPolicySearchPoc({ terminalMode: "v1" })
    .summary().terminalMode, "v1");
});

test("bounded policy makes own chance backup quantifier explicit", () => {
  assert.equal(new NativeBoundedPolicySearchPoc().summary().ownChanceMode,
    "expected");
  assert.equal(new NativeBoundedPolicySearchPoc({ ownChanceMode: "worst" })
    .summary().ownChanceMode, "worst");
});

test("paired terminal comparison rejects a budget-truncated leaf", () => {
  const state = new FastState(5, 5);
  const bounded = new NativeBoundedPolicySearchPoc();
  bounded.diagnosticKernel = { failure: 0, lastMark: 0,
    appliedActionCount: 0, hardCheckedActionCount: 0 };
  bounded.rootEnemyDomainMask[0] = 1;
  bounded.transitionValue = function() {
    this.leafBudgetCount += 1; return -30000;
  };
  const engine = { adapter: { bundle: { state } }, ourCount: 2, enemyCount: 1,
    ourActions: new Uint8Array([ACTION.FIRE, ACTION.GO]),
    ourArguments: new Uint16Array(2),
    enemyActions: new Uint8Array([ACTION.FIRE]),
    enemyArguments: new Uint16Array(1) };
  assert.equal(bounded.compareTerminalRows(engine, 0, 1, 4, 32), 0);
  assert.equal(bounded.summary().pairedTerminalIncompleteCount, 1);
  assert.equal(bounded.summary().pairedTerminalRestoreFailures, 0);
});

test("star-state blend schedule is conservative ahead and assertive behind", () => {
  const state = new FastState(5, 5); const stars = state.arrays[ARRAY.TANK_STARS];
  const bounded = new NativeBoundedPolicySearchPoc({ blendBasisPoints: 2000,
    blendSchedule: "star-state", leadingBlendBasisPoints: 0,
    trailingBlendBasisPoints: 4000 });
  stars[0] = 0; stars[1] = 1;
  assert.equal(bounded.scheduleBlend(state), 4000);
  stars[0] = 1; stars[1] = 1;
  assert.equal(bounded.scheduleBlend(state), 2000);
  stars[0] = 2; stars[1] = 1;
  assert.equal(bounded.scheduleBlend(state), 0);
  assert.deepEqual(bounded.summary().blendScheduleCount, [1, 1, 1]);
});

test("bounded policy accepts an exact V1 opponent-policy context", () => {
  const bounded = new NativeBoundedPolicySearchPoc({ opponentMode: "v1-exact" });
  bounded.setOracleOpponentContext({ opponentCounts: {
    GO: 4, LEFT: 3, RIGHT: 2, FIRE: 1
  }, opponentObservations: 6, opponentGoStreak: 2,
  enemyStationaryStreak: 1, expectationBlend: 0.27 });
  assert.equal(bounded.opponentMode, "v1-exact");
  assert.deepEqual(Array.from(bounded.oracleOpponentCounts), [4, 3, 2, 1]);
  assert.equal(bounded.currentBlendBasisPoints, 2700);
});

test("bounded policy exposes a tactical root enemy domain", () => {
  assert.equal(new NativeBoundedPolicySearchPoc().summary().rootEnemyDomainMode,
    "all");
  for (const mode of ["tactical", "v1-shaped", "drop-passive", "qualify-fire",
    "qualify-motion-skill", "drop-passive-fire",
    "drop-passive-motion-skill", "qualify-fire-motion-skill"])
    assert.equal(new NativeBoundedPolicySearchPoc({
      rootEnemyDomainMode: mode
    }).summary().rootEnemyDomainMode, mode);
});

test("bounded policy exposes a V1-shaped recursive action domain", () => {
  assert.equal(new NativeBoundedPolicySearchPoc().summary().deepDomainMode,
    "primitive");
  assert.equal(new NativeBoundedPolicySearchPoc({
    deepDomainMode: "v1-shaped"
  }).summary().deepDomainMode, "v1-shaped");
  assert.equal(new NativeBoundedPolicySearchPoc({
    deepBombMode: "qualified"
  }).summary().deepBombMode, "qualified");
});

test("V1-shaped recursive Poison cadence follows applied-frame ACT-HOLD parity", () => {
  const state = new FastState(8, 8); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  a[ARRAY.TANK_CELL][1] = state.cell(5, 2);
  a[ARRAY.TANK_DIR][0] = 1; a[ARRAY.TANK_DIR][1] = 3;
  a[ARRAY.TANK_FIRE_LOCK][0] = NONE_FRAME;
  a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.TANK_SKILL][0] = SKILL.NONE; a[ARRAY.TANK_SKILL][1] = SKILL.NONE;
  a[ARRAY.TANK_POISON_APPLIED][0] = 10;
  a[ARRAY.TANK_POISON_APPLIED][1] = 10;
  a[ARRAY.TANK_POISON_UNTIL][0] = 14;
  a[ARRAY.TANK_POISON_UNTIL][1] = 14;
  const bounded = new NativeBoundedPolicySearchPoc({
    deepDomainMode: "v1-shaped", fullPrimitiveDomain: true,
    rootDomainMode: "v1-shaped"
  });
  const engine = { adapter: { state }, depthSearch: {
    target(value, cell, direction) { return bounded.targetCell(value, cell, direction); },
    walkable(value, cell) { return cell !== NONE_CELL &&
      value.arrays[ARRAY.TERRAIN][cell] === TERRAIN.OPEN; }
  } };

  // First relative effect frame is HOLD: the queue remains represented by a
  // single NONE successor and root movement is not a legal representative.
  a[ARRAY.SCALAR][SCALAR.FRAME] = 11;
  assert.equal(bounded.generatePrimitive(engine, 0, 1), 1);
  assert.equal(bounded.deepEnemyActions[0], ACTION.NONE);
  assert.equal(bounded.rootV1ShapedAllowed(engine, ACTION.GO), 0);

  // Second relative effect frame is ACT: movement/turn representatives return.
  a[ARRAY.SCALAR][SCALAR.FRAME] = 12;
  assert.ok(bounded.generatePrimitive(engine, 0, 1) > 1);
  assert.ok(Array.from(bounded.deepEnemyActions.slice(0,
    bounded.deepEnemyCount[0])).includes(ACTION.GO));
  assert.equal(bounded.rootV1ShapedAllowed(engine, ACTION.GO), 1);
});
