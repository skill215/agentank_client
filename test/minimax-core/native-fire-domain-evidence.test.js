"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fixtures = require("./fixtures/fire-domain-bp282.json");
const { FastState, ARRAY } = require("../../engine-v2/src/state/fast-state");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { NativeBasePolicyRoot } = require("../../engine-v2/src/base-policy-specialized/native-root");
const { tracedDomain } = require("../../tools/agentank/diagnostics/native-fire-domain-audit");

for (const entry of fixtures) test(`${entry.id}: legal FIRE is excluded by opportunity heuristic, not cooldown`, () => {
  const fixture = entry.fixture;
  const state = new FastState(fixture.width, fixture.height);
  for (const [name, values] of Object.entries(fixture.arrays)) state.arrays[ARRAY[name]].set(values);
  const root = new NativeBasePolicyRoot();
  const domain = root.domain;
  assert.equal(domain.canFire(state, 0), 1);
  assert.equal(domain.qualifiedFireForSeat(state, 0), 0);
  assert.equal(root.policySearch.rootV1ShapedAllowed({ adapter: { state } }, ACTION.FIRE), 0);
  const traced = tracedDomain();
  assert.equal(traced.domain.qualifiedFireForSeat(state, 0), domain.qualifiedFireForSeat(state, 0));
  assert.equal(traced.sandbox.trace.best, -2147483648);
  assert.equal(traced.sandbox.trace.thresholdTimes100, 2500);
});

test("qualification trace preserves direct-shot positive branch", () => {
  const state = new FastState(7, 7);
  state.arrays[ARRAY.TANK_CELL].set([state.cell(1, 3), state.cell(4, 3)]);
  state.arrays[ARRAY.TANK_DIR].set([1, 3]);
  const root = new NativeBasePolicyRoot(), traced = tracedDomain();
  assert.equal(root.domain.qualifiedFireForSeat(state, 0), 1);
  assert.equal(traced.domain.qualifiedFireForSeat(state, 0), 1);
  assert.equal(traced.sandbox.trace, null);
});
