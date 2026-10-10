"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND, OptionPortfolioSlab } =
  require("../../engine-v2/src/policy/option-portfolio");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { OptionInformationIntervalSearch } =
  require("../../engine-v2/src/search/option-information-interval-search");

function service() {
  return new OptionInformationIntervalSearch(new ProductionCacheBank(), undefined, undefined);
}

test("Information Option portfolio contains the incumbent and only complete tactical challengers", () => {
  const search = service(); const portfolio = new OptionPortfolioSlab(8);
  portfolio.add(0, OPTION_KIND.STAR_CONTROL, 3, 1, 9, 0, 1);
  portfolio.add(1, OPTION_KIND.ATTACK_SETUP, 6, 2, 5, 0, 1);
  portfolio.add(0, OPTION_KIND.DIRECT_KILL, 6, 5, 4, 0, 1);
  portfolio.add(2, OPTION_KIND.DIRECT_KILL, 6, 3, 4, 0, 0);
  portfolio.add(3, OPTION_KIND.POSITION, 4, 4, 8, 0, 1);
  const actions = new Uint8Array([ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT, ACTION.TURN_RIGHT]);
  const arguments_ = new Uint16Array(4).fill(NONE_CELL);
  assert.equal(search.evaluator.prepareInformationPortfolio(portfolio,
    actions, arguments_, 4, 0), 2);
  assert.deepEqual(Array.from(search.evaluator.optionPrimitiveRow.subarray(0, 2)), [0, 1]);
  assert.deepEqual(Array.from(search.evaluator.optionKind.subarray(0, 2)),
    [OPTION_KIND.DIRECT_KILL, OPTION_KIND.ATTACK_SETUP]);
});

test("incomplete Information Option values remain ordering-only and cannot own", () => {
  const search = service(); const portfolio = new OptionPortfolioSlab(4);
  portfolio.add(0, OPTION_KIND.POSITION, 2, 1, 8, 0, 1);
  portfolio.add(1, OPTION_KIND.ATTACK_SETUP, 4, 2, 4, 0, 1);
  search.lower.fill(123); search.upper.fill(456); search.exact.fill(1);
  search.resetRoot();
  search.optionCount = 2; search.evaluator.optionCount = 2;
  search.evaluator.optionPrimitiveRow.set([0, 1]);
  search.evaluator.optionKind.set([OPTION_KIND.POSITION, OPTION_KIND.ATTACK_SETUP]);
  search.evaluator.optionSourceIndex.set([0, 1]);
  search.information.rootScore.set([100, 9000]);
  search.information.completedDepth = 1; search.information.supportComplete = 0;
  search.information.approximate = 1;
  search.publishIntervals(portfolio, 0);
  assert.deepEqual(Array.from(search.lower.subarray(0, 2)), [-32000, -32000]);
  assert.deepEqual(Array.from(search.upper.subarray(0, 2)), [32000, 32000]);
  assert.deepEqual(Array.from(search.exact.subarray(0, 2)), [0, 0],
    "a prior exact root cannot leak ownership into an incomplete root");
  const hard = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
  const outcome = { acceptable: new Uint8Array([1, 1]), dominated: new Uint8Array(2) };
  assert.equal(search.bestStrictCandidate(0, hard, outcome), -1);
});

test("complete separated intervals allow only strict terminal attack dominance", () => {
  const search = service(); search.optionCount = 3; search.evaluator.optionCount = 3;
  search.evaluator.optionPrimitiveRow.set([0, 1, 2]);
  search.evaluator.optionKind.set([
    OPTION_KIND.POSITION, OPTION_KIND.DIRECT_KILL, OPTION_KIND.STAR_CONTROL]);
  search.exact.set([1, 1, 1]); search.lower.set([100, 101, 9000]);
  search.upper.set([100, 800, 9000]);
  const hard = new Uint8Array(3).fill(HARD_STATUS.ALLOW);
  const outcome = { acceptable: new Uint8Array([1, 1, 1]), dominated: new Uint8Array(3) };
  assert.equal(search.bestStrictCandidate(0, hard, outcome), 1,
    "strategic Option cannot own even with the larger scalar interval");
  search.lower[1] = 100;
  assert.equal(search.bestStrictCandidate(0, hard, outcome), -1,
    "stable equality is not strict dominance");
});

test("ACTIVE remains bounded by Hard and Risk after strict interval dominance", () => {
  const search = service(); search.active = 1;
  search.optionCount = 2; search.evaluator.optionCount = 2;
  search.evaluator.optionPrimitiveRow.set([0, 1]);
  search.evaluator.optionKind.set([OPTION_KIND.POSITION, OPTION_KIND.ATTACK_SETUP]);
  search.exact.set([1, 1]); search.lower.set([100, 500]); search.upper.set([100, 900]);
  const hard = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.REJECT_PROVEN]);
  const outcome = { acceptable: new Uint8Array([1, 1]), dominated: new Uint8Array(2) };
  assert.equal(search.bestStrictCandidate(0, hard, outcome), -1);
  hard[1] = HARD_STATUS.ALLOW; outcome.acceptable[1] = 0;
  assert.equal(search.bestStrictCandidate(0, hard, outcome), -1);
  outcome.acceptable[1] = 1; outcome.dominated[1] = 1;
  assert.equal(search.bestStrictCandidate(0, hard, outcome), -1);
  outcome.dominated[1] = 0;
  assert.equal(search.bestStrictCandidate(0, hard, outcome), -1,
    "ATTACK_SETUP cannot own without the separate multi-frame closure");
  search.attackSetupClosure = {
    evaluateRow(row, kind) {
      assert.equal(row, 1); assert.equal(kind, OPTION_KIND.ATTACK_SETUP); return 1;
    }
  };
  assert.equal(search.bestStrictCandidate(0, hard, outcome), 1,
    "a separately certified setup can own the strictly dominant interval");
  search.attackSetupClosure = null;
  search.evaluator.optionKind[1] = OPTION_KIND.DIRECT_KILL;
  assert.equal(search.bestStrictCandidate(0, hard, outcome), 1);
});
