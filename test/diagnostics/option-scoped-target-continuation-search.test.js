"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ARRAY } = require("../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { RUNTIME_MODE } = require(
  "../../engine-v2/src/abi/cache-runtime-codes");
const { OPTION_KIND, OPTION_EVIDENCE } = require(
  "../../engine-v2/src/policy/option-portfolio");
const { OPTION_SEARCH_STATUS } = require(
  "../../engine-v2/src/search/option-aware-depth-search");
const { CONTINUATION_SEARCH_STATUS, OptionScopedTargetContinuationSearch } = require(
  "../../tools/agentank/diagnostics/option-scoped-target-continuation-search");

class FakeSearch {
  constructor(selected = 100, candidate = 200, complete = 1) {
    this.selected = selected; this.candidate = candidate; this.complete = complete;
    this.rootTransitions = { setEnabled() {} }; this.hotAllocationCount = 0;
    this.rootRestoreFailures = 0; this.nodes = 31; this.completedDepth = 2;
    this.optionCount = 2; this.optionPrimitiveRow = Uint8Array.from([0, 1]);
    this.rootScore = Int32Array.from([selected, candidate]);
    this.lastStatus = OPTION_SEARCH_STATUS.NONE;
    this.representativeSupportComplete = 0; this.rootEnemyCount = 0;
  }
  searchPortfolio(bundle, portfolio, actions, arguments_, count,
      enemyActions, enemyArguments, enemyCount) {
    assert.ok(bundle); assert.equal(portfolio.count, 2); assert.equal(count, 2);
    assert.equal(actions[0], ACTION.GO); assert.equal(actions[1], ACTION.TURN_RIGHT);
    assert.equal(enemyActions.length >= enemyCount, true);
    this.rootEnemyCount = enemyCount;
    this.lastStatus = this.complete ? OPTION_SEARCH_STATUS.COMPLETE :
      OPTION_SEARCH_STATUS.INCOMPLETE;
    this.representativeSupportComplete = this.complete;
    return this.complete;
  }
}

function fixture(search, active = false) {
  const arrays = [];
  arrays[ARRAY.TANK_CELL] = Uint16Array.from([10, 40]);
  const state = { arrays, hashLo: 11, hashHi: 22, deltaUsed: 0, eventUsed: 0 };
  const risk = { count: 2, acceptable: Uint8Array.from([1, 1]) };
  const portfolio = { count: 1, primitiveRow: Uint8Array.from([0]),
    kind: Uint8Array.from([OPTION_KIND.STAR_CONTROL]),
    targetCell: Uint16Array.from([20]), targetSignature: Uint32Array.from([7]),
    deadline: Uint16Array.from([8]), evidence: Uint8Array.from([
      OPTION_EVIDENCE.TARGET | OPTION_EVIDENCE.COMPLETE]),
    supportComplete: Uint8Array.from([1]) };
  const engine = { adapter: { enemyVisible: true, state },
    runtime: { runtimeMode: RUNTIME_MODE.NORMAL }, enemyCount: 3,
    enemyActions: Uint8Array.from([ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT]),
    enemyArguments: new Uint16Array(3), ourCount: 2,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.TURN_RIGHT]),
    ourArguments: new Uint16Array(2),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    riskController: { outcome: risk }, optionPortfolio: portfolio,
    policy: { baseRisk: 20 }, hiddenWorldCount: 1,
    hiddenWorldMass: Uint16Array.from([10000]),
    observationSafetySupportComplete() { return 1; } };
  return { engine, bundle: { state }, evaluator:
    new OptionScopedTargetContinuationSearch({}, { active, search }) };
}

test("complete strict maximin dominance is visible in Shadow without ownership", () => {
  const value = fixture(new FakeSearch(100, 200), false);
  assert.equal(value.evaluator.evaluate(value.engine, value.bundle, 0, 1, 40, 12, 3), 0);
  assert.equal(value.evaluator.lastStatus, CONTINUATION_SEARCH_STATUS.DOMINATES);
  assert.equal(value.evaluator.strictDominanceCount, 1);
  assert.equal(value.evaluator.shadowDominanceCount, 1);
  assert.equal(value.evaluator.proposalCount, 0);
  assert.equal(value.evaluator.totalNodes, 31);
});

test("ACTIVE owns only a complete strict dominance result", () => {
  const value = fixture(new FakeSearch(100, 200), true);
  assert.equal(value.evaluator.evaluate(value.engine, value.bundle, 0, 1, 40), 1);
  assert.equal(value.evaluator.proposalCount, 1);

  const tied = fixture(new FakeSearch(200, 200), true);
  assert.equal(tied.evaluator.evaluate(tied.engine, tied.bundle, 0, 1, 40), 0);
  assert.equal(tied.evaluator.strictDominanceCount, 0);
});

test("incomplete search and non-exact HiddenWorld support fail closed", () => {
  const incomplete = fixture(new FakeSearch(100, 200, 0), true);
  assert.equal(incomplete.evaluator.evaluate(incomplete.engine, incomplete.bundle,
    0, 1, 40), 0);
  assert.equal(incomplete.evaluator.lastStatus, CONTINUATION_SEARCH_STATUS.INCOMPLETE);

  const hidden = fixture(new FakeSearch(100, 200), true);
  hidden.engine.hiddenWorldCount = 2;
  assert.equal(hidden.evaluator.evaluate(hidden.engine, hidden.bundle, 0, 1, 40), 0);
  assert.equal(hidden.evaluator.supportSkipCount, 1);
});

test("root mutation is detected and no result can bypass final accounting", () => {
  const search = new FakeSearch(100, 200);
  const original = search.searchPortfolio.bind(search);
  const value = fixture(search, true);
  search.searchPortfolio = (...arguments_) => {
    const result = original(...arguments_);
    value.engine.adapter.state.hashLo = 99;
    return result;
  };
  assert.equal(value.evaluator.evaluate(value.engine, value.bundle, 0, 1, 40), 0);
  assert.equal(value.evaluator.rootRestoreFailureCount, 1);
  assert.equal(value.evaluator.lastStatus, CONTINUATION_SEARCH_STATUS.INCOMPLETE);
});
