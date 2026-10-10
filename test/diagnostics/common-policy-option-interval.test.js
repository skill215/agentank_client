"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { COMMON_OPTION_STATUS, VALUE_MIN, VALUE_MAX,
  CommonPolicyOptionInterval } = require(
  "../../engine-v2/src/search/common-policy-option-interval");

test("common-policy interval allocates fixed slabs and starts full-range", () => {
  const value = new CommonPolicyOptionInterval({}, { maximumRoots: 3, nodeBudget: 256 });
  assert.equal(value.maximumRoots, 3);
  assert.equal(value.nodeBudget, 256);
  assert.equal(value.hotAllocationCount, 0);
  assert.deepEqual(Array.from(value.rootLower), [0, 0, 0]);
  value.rootLower.fill(VALUE_MIN); value.rootUpper.fill(VALUE_MAX);
  assert.deepEqual(Array.from(value.rootLower), [VALUE_MIN, VALUE_MIN, VALUE_MIN]);
  assert.deepEqual(Array.from(value.rootUpper), [VALUE_MAX, VALUE_MAX, VALUE_MAX]);
  assert.equal(value.lastStatus, COMMON_OPTION_STATUS.NONE);
});

test("unsupported Information composition fails closed without a proposal", () => {
  const value = new CommonPolicyOptionInterval({}, { active: true });
  const engine = { adapter: { enemyVisible: 1 }, hiddenWorldCount: 1,
    hiddenWorldMass: new Uint16Array([10000]),
    possibleProjectiles: { count: () => 0, pool: { complete: 1 } } };
  assert.equal(value.evaluate(engine, null, 0, 1), -1);
  assert.equal(value.lastStatus, COMMON_OPTION_STATUS.NONE);
  assert.equal(value.proposalCount, 0);
  assert.equal(value.supportSkips, 1);
});

test("finite-horizon separation is not terminal value ownership", () => {
  const value = new CommonPolicyOptionInterval({}, { active: true });
  value.rootLower.set([100, 101, 100]); value.rootUpper.set([100, 900, 1000]);
  value.rootExact.set([0, 0, 0]);
  let best = -1;
  for (let root = 1; root < 3; root += 1)
    if (value.rootLower[root] > value.rootUpper[0] &&
        (best < 0 || value.rootLower[root] > value.rootLower[best])) best = root;
  assert.equal(best, 1);
  assert.equal(Boolean(value.rootExact[0] && value.rootExact[best]), false);
  value.rootLower[1] = 100;
  best = -1;
  for (let root = 1; root < 3; root += 1)
    if (value.rootLower[root] > value.rootUpper[0]) best = root;
  assert.equal(best, -1);
});

test("terminal-complete roots may upgrade strict interval separation", () => {
  const value = new CommonPolicyOptionInterval({}, { active: true });
  value.rootLower.set([-30000, 30000, 0]);
  value.rootUpper.set([-30000, 30000, 0]);
  value.rootExact.set([1, 1, 0]);
  assert.equal(value.rootLower[1] > value.rootUpper[0], true);
  assert.equal(Boolean(value.rootExact[0] && value.rootExact[1]), true);
});
