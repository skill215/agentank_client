"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { VALUE_MIN, VALUE_MAX, COMMON_POLICY_STATUS,
  CommonPolicyIntervalOracle } = require(
  "../../tools/agentank/diagnostics/common-policy-interval-oracle");

function fillTwoBranch(oracle, observation0, observation1, values) {
  assert.equal(oracle.configure(1, 2, 2, 2, 1, 1),
    COMMON_POLICY_STATUS.INCOMPLETE);
  oracle.setBranch(0, 0, observation0, 3);
  oracle.setBranch(0, 1, observation1, 3);
  oracle.setUtility(0, 0, 0, 0, values[0]);
  oracle.setUtility(0, 0, 1, 0, values[1]);
  oracle.setUtility(0, 1, 0, 0, values[2]);
  oracle.setUtility(0, 1, 1, 0, values[3]);
}

test("same observation forces one common continuation action", () => {
  const oracle = new CommonPolicyIntervalOracle();
  fillTwoBranch(oracle, 0, 0, [100, -100, -100, 100]);
  assert.equal(oracle.solve(), COMMON_POLICY_STATUS.COMPLETE);
  assert.equal(oracle.lower[0], -100);
  assert.equal(oracle.fusedBestValue, 100);
  assert.equal(oracle.strategyFusionGap, 200);
});

test("ObservationSplit permits a different action after observations diverge", () => {
  const oracle = new CommonPolicyIntervalOracle();
  fillTwoBranch(oracle, 0, 1, [100, -100, -100, 100]);
  assert.equal(oracle.solve(), COMMON_POLICY_STATUS.COMPLETE);
  assert.equal(oracle.lower[0], 100);
  assert.equal(oracle.strategyFusionGap, 0);
  assert.equal(oracle.bestContinuation[0], 0);
  assert.equal(oracle.bestContinuation[1], 1);
});

test("common-policy maximin matches independent exhaustive policy enumeration", () => {
  const values = [-1, 0, 1]; let cases = 0;
  for (const a of values) for (const b of values)
    for (const c of values) for (const d of values) {
      const oracle = new CommonPolicyIntervalOracle();
      fillTwoBranch(oracle, 0, 0, [a, b, c, d]); oracle.solve();
      const independent = Math.max(Math.min(a, c), Math.min(b, d));
      assert.equal(oracle.lower[0], independent);
      assert.ok(oracle.fusedBestValue >= independent); cases += 1;
    }
  assert.equal(cases, 81);
});

test("enemy continuation remains a universal min inside every branch", () => {
  const oracle = new CommonPolicyIntervalOracle();
  oracle.configure(1, 1, 1, 2, 2, 1);
  oracle.setBranch(0, 0, 0, 3);
  oracle.setUtility(0, 0, 0, 0, 100); oracle.setUtility(0, 0, 0, 1, -50);
  oracle.setUtility(0, 0, 1, 0, 20); oracle.setUtility(0, 0, 1, 1, 10);
  oracle.solve();
  assert.equal(oracle.lower[0], 10);
  assert.equal(oracle.bestContinuation[0], 1);
});

test("missing support preserves ordering but publishes only a full interval", () => {
  const oracle = new CommonPolicyIntervalOracle();
  oracle.configure(1, 1, 1, 1, 1, 0);
  oracle.setBranch(0, 0, 0, 1); oracle.setUtility(0, 0, 0, 0, 1234);
  assert.equal(oracle.solve(), COMMON_POLICY_STATUS.INCOMPLETE);
  assert.equal(oracle.ordering[0], 1234);
  assert.equal(oracle.lower[0], VALUE_MIN);
  assert.equal(oracle.upper[0], VALUE_MAX);
});

test("capacity overflow is explicit and the oracle declares zero hot allocation", () => {
  const oracle = new CommonPolicyIntervalOracle(1, 1, 1, 1, 1);
  assert.equal(oracle.configure(2, 1, 1, 1, 1), COMMON_POLICY_STATUS.CAPACITY);
  assert.equal(oracle.hotAllocationCount, 0);
});
