"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SEARCH_CAPACITY } = require(
  "../../engine-v2/src/generated/search-config");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { ACTION, SKILL, NONE_CELL, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { NativeBoundedPolicySearchPoc } = require(
  "../../tools/agentank/diagnostics/native-bounded-policy-search-poc");
const { NativeSyntheticResourceRootPoc } = require(
  "../../tools/agentank/diagnostics/native-synthetic-resource-root-poc");
const { NativePoisonResourceOptionPoc, POLICY_BASELINE_FEEDBACK,
  POLICY_POISON_FEEDBACK, PURPOSE_SUPPRESS_ENEMY_CADENCE } = require(
  "../../tools/agentank/diagnostics/native-poison-resource-option-poc");

function fixture(mode = "shadow") {
  const state = new FastState(8, 8); const a = state.arrays;
  a[ARRAY.SCALAR][SCALAR.FRAME] = 4;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  a[ARRAY.TANK_CELL][1] = state.cell(5, 2);
  a[ARRAY.TANK_SKILL][0] = SKILL.POISON;
  a[ARRAY.TANK_SKILL_READY][0] = 0;
  a[ARRAY.TANK_POISON_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_FROZEN_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_STUN_UNTIL][1] = NONE_FRAME;
  const engine = {
    ourCount: 2, enemyCount: 2,
    ourActions: new Uint8Array([ACTION.GO, ACTION.NONE]),
    ourArguments: new Uint16Array([NONE_CELL, NONE_CELL]),
    enemyActions: new Uint8Array([ACTION.GO, ACTION.FIRE]),
    enemyArguments: new Uint16Array([NONE_CELL, NONE_CELL]),
    adapter: { state, ownCanAct: true, ownSkillReady: true,
      enemyVisible: true, enemyCanAct: true, enemyCanFire: true },
    escapeObligation: { committedEntityCount: 0 },
    lastProofStatus: 0, lastSelectionWasStrictRescue: 0,
    lastSelectionWasVerifiedDirectKill: 0
  };
  const search = {
    representativeSupportComplete: 1,
    rootDomainMask: new Uint8Array([1, 1]),
    rootEnemyDomainMask: new Uint8Array([1, 1]),
    rootScore: new Int32Array([100, 0]),
    rootCellScore: new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES),
    syntheticRootCellScore: new Int32Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES),
    syntheticRootValue: 120, syntheticRootWorst: 110,
    evaluateSyntheticRoot() {
      this.syntheticRootCellScore[0] = 110;
      this.syntheticRootCellScore[1] = 120;
      return 1;
    }
  };
  search.rootCellScore[0] = 100; search.rootCellScore[1] = 100;
  return { state, engine, search,
    proposal: new NativeSyntheticResourceRootPoc(mode) };
}

test("synthetic poison shadow is behavior neutral and does not enter root arrays", () => {
  const value = fixture("shadow");
  const before = Array.from(value.engine.ourActions);
  assert.equal(value.proposal.selectOverride(value.engine, ACTION.GO,
    NONE_CELL, value.search, true), null);
  assert.deepEqual(Array.from(value.engine.ourActions), before);
  assert.equal(value.engine.ourCount, 2);
  assert.equal(value.proposal.summary().evidenceCount, 1);
  assert.equal(value.proposal.summary().wouldOverrideCount, 1);
  assert.equal(value.proposal.summary().overrideCount, 0);
});

test("synthetic poison active owns only a complete cellwise improvement", () => {
  const value = fixture("active");
  assert.deepEqual(value.proposal.selectOverride(value.engine, ACTION.GO,
    NONE_CELL, value.search, true),
  { action: ACTION.CAST_POISON, argument: NONE_CELL });
  assert.equal(value.proposal.summary().overrideCount, 1);

  const regression = fixture("active");
  regression.search.evaluateSyntheticRoot = function evaluate() {
    this.syntheticRootCellScore[0] = 110;
    this.syntheticRootCellScore[1] = 99;
    return 1;
  };
  assert.equal(regression.proposal.selectOverride(regression.engine, ACTION.GO,
    NONE_CELL, regression.search, true), null);
  assert.equal(regression.proposal.summary().cellwiseRegressionCount, 1);
});

test("synthetic resource root rejects stale, committed and strict ownership", () => {
  const stale = fixture();
  assert.equal(stale.proposal.selectOverride(stale.engine, ACTION.GO,
    NONE_CELL, stale.search, false), null);
  assert.equal(stale.proposal.summary().searchIncompleteCount, 1);

  const committed = fixture();
  committed.engine.escapeObligation.committedEntityCount = 1;
  assert.equal(committed.proposal.selectOverride(committed.engine, ACTION.GO,
    NONE_CELL, committed.search, true), null);
  assert.equal(committed.proposal.summary().committedBlockedCount, 1);

  const strict = fixture(); strict.engine.lastSelectionWasStrictRescue = 1;
  assert.equal(strict.proposal.selectOverride(strict.engine, ACTION.GO,
    NONE_CELL, strict.search, true), null);
  assert.equal(strict.proposal.summary().strictOwnerBlockedCount, 1);
});

test("bounded search evaluates an out-of-domain synthetic root in a fixed slot", () => {
  const state = new FastState(6, 6);
  const search = new NativeBoundedPolicySearchPoc();
  search.representativeSupportComplete = 1;
  search.currentDepth = 2; search.perRootBudget = 64;
  search.diagnosticKernel = { failure: 0, lastMark: 0,
    appliedActionCount: 0, hardCheckedActionCount: 0 };
  search.diagnosticHard = {};
  search.rootEnemyDomainMask[0] = 1; search.rootEnemyDomainMask[1] = 1;
  search.transitionValue = function transition(engine, own, argument, enemy) {
    assert.equal(own, ACTION.CAST_POISON);
    assert.equal(argument, NONE_CELL);
    this.nodes += 3;
    return enemy === ACTION.FIRE ? 70 : 90;
  };
  const engine = { ourCount: 1, enemyCount: 2,
    ourActions: new Uint8Array([ACTION.GO]),
    enemyActions: new Uint8Array([ACTION.GO, ACTION.FIRE]),
    enemyArguments: new Uint16Array([NONE_CELL, NONE_CELL]),
    adapter: { state, bundle: { state } } };
  const before = Array.from(engine.ourActions);
  assert.equal(search.evaluateSyntheticRoot(engine, ACTION.CAST_POISON,
    NONE_CELL, 0), 1);
  assert.deepEqual(Array.from(engine.ourActions), before);
  assert.equal(search.syntheticRootCellScore[0], 90);
  assert.equal(search.syntheticRootCellScore[1], 70);
  assert.equal(search.syntheticRootWorst, 70);
  assert.equal(search.syntheticRootValue, 72);
  assert.equal(search.summary().syntheticRootNodeCount, 6);
  assert.equal(search.summary().syntheticRootRestoreFailureCount, 0);
});

test("Poison ResourceOption owns only a complete four-frame feedback interval", () => {
  const value = fixture("shadow");
  value.proposal.lastBaseRow = 0;
  const option = new NativePoisonResourceOptionPoc("active");
  value.search.resourceBaseCellUpper = new Int32Array(
    SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  value.search.resourceCandidateCellLower = new Int32Array(
    SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  value.search.evaluateSyntheticResourceOption = function evaluate(engine,
      action, argument, row, depth) {
    assert.equal(action, ACTION.CAST_POISON); assert.equal(argument, NONE_CELL);
    assert.equal(row, 0); assert.equal(depth, 4);
    this.resourceBaseCellUpper[0] = 100; this.resourceBaseCellUpper[1] = 90;
    this.resourceCandidateCellLower[0] = 110;
    this.resourceCandidateCellLower[1] = 105;
    this.resourceOptionBaseWorst = 90; this.resourceOptionCandidateWorst = 105;
    this.resourceOptionBaseValue = 98; this.resourceOptionCandidateValue = 109;
    return 1;
  };
  assert.deepEqual(option.selectOverride(value.engine, ACTION.GO, NONE_CELL,
    value.search, value.proposal, true),
  { action: ACTION.CAST_POISON, argument: NONE_CELL });
  const summary = option.summary();
  assert.equal(summary.certificateCount, 1); assert.equal(summary.overrideCount, 1);
  assert.equal(summary.lastDeadline, 8);
  assert.equal(summary.lastPurpose, PURPOSE_SUPPRESS_ENEMY_CADENCE);
  assert.equal(summary.lastBaselinePolicy, POLICY_BASELINE_FEEDBACK);
  assert.equal(summary.lastCandidatePolicy, POLICY_POISON_FEEDBACK);
});

test("Poison ResourceOption rejects budget-open or regressing intervals", () => {
  const incomplete = fixture("shadow");
  incomplete.proposal.lastBaseRow = 0;
  incomplete.search.evaluateSyntheticResourceOption = () => 0;
  const incompleteOption = new NativePoisonResourceOptionPoc("active");
  assert.equal(incompleteOption.selectOverride(incomplete.engine, ACTION.GO,
    NONE_CELL, incomplete.search, incomplete.proposal, true), null);
  assert.equal(incompleteOption.summary().searchIncompleteCount, 1);

  const regression = fixture("shadow");
  regression.proposal.lastBaseRow = 0;
  regression.search.resourceBaseCellUpper = new Int32Array(
    SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  regression.search.resourceCandidateCellLower = new Int32Array(
    SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  regression.search.evaluateSyntheticResourceOption = function evaluate() {
    this.resourceBaseCellUpper[0] = 100; this.resourceBaseCellUpper[1] = 100;
    this.resourceCandidateCellLower[0] = 110;
    this.resourceCandidateCellLower[1] = 99;
    this.resourceOptionBaseWorst = 100; this.resourceOptionCandidateWorst = 99;
    this.resourceOptionBaseValue = 100; this.resourceOptionCandidateValue = 105;
    return 1;
  };
  const regressionOption = new NativePoisonResourceOptionPoc("active");
  assert.equal(regressionOption.selectOverride(regression.engine, ACTION.GO,
    NONE_CELL, regression.search, regression.proposal, true), null);
  assert.equal(regressionOption.summary().cellIntervalRegressionCount, 1);
});

test("paired ResourceOption search opens bounds when its deadline budget expires", () => {
  const state = new FastState(6, 6); const search = new NativeBoundedPolicySearchPoc();
  search.representativeSupportComplete = 1;
  search.diagnosticKernel = { failure: 0, lastMark: 0,
    appliedActionCount: 0, hardCheckedActionCount: 0 };
  search.diagnosticHard = {};
  search.rootEnemyDomainMask[0] = 1;
  search.transitionValue = function transition(engine, own) {
    this.nodes += 3;
    if (own === ACTION.CAST_POISON) this.leafBudgetCount += 1;
    return own === ACTION.CAST_POISON ? 120 : 100;
  };
  const engine = { ourCount: 1, enemyCount: 1,
    ourActions: new Uint8Array([ACTION.GO]),
    ourArguments: new Uint16Array([NONE_CELL]),
    enemyActions: new Uint8Array([ACTION.GO]),
    enemyArguments: new Uint16Array([NONE_CELL]),
    adapter: { state, bundle: { state } } };
  assert.equal(search.evaluateSyntheticResourceOption(engine,
    ACTION.CAST_POISON, NONE_CELL, 0, 4, 64), 0);
  assert.equal(search.resourceCandidateCellLower[0], -32000);
  assert.equal(search.resourceCandidateCellUpper[0], 32000);
  assert.equal(search.summary().resourceOptionBudgetIncompleteCount, 1);
});
