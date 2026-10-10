"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { NativeTransitionReuseCensusPoc, commandCode, argumentCode } = require(
  "../../tools/agentank/diagnostics/native-transition-reuse-census-poc");

test("transition request identity includes actions arguments and chance", () => {
  assert.notEqual(commandCode(1, 2, 0, 0), commandCode(1, 2, 1, 0));
  assert.notEqual(commandCode(1, 2, 0, 0), commandCode(1, 3, 0, 0));
  assert.notEqual(argumentCode(7, 9), argumentCode(7, 10));
});

test("census separates same-policy and cross-policy exact repeats", () => {
  const census = new NativeTransitionReuseCensusPoc("shadow");
  census.observeTransitionRequest(11, 13, 1, 65535, 2, 65535, 0, 0, 1);
  census.observeTransitionRequest(11, 13, 1, 65535, 2, 65535, 0, 0, 1);
  census.observeTransitionRequest(11, 13, 1, 65535, 2, 65535, 0, 0, 2);
  assert.equal(census.transitionRequestCount, 3);
  assert.equal(census.transitionRequestUniqueCount, 1);
  assert.equal(census.transitionRequestRepeatCount, 2);
  assert.equal(census.transitionRequestSamePolicyRepeatCount, 1);
  assert.equal(census.transitionRequestCrossPolicyRepeatCount, 1);
});

test("different commands reaching one successor are counted separately", () => {
  const census = new NativeTransitionReuseCensusPoc("shadow");
  const state = { hashLo: 101, hashHi: 103, deltaUsed: 8 };
  census.observeTransitionSuccessor(11, 13, 1, 65535, 2, 65535,
    0, 0, 1, state, 5 * 1024);
  census.observeTransitionSuccessor(11, 13, 1, 65535, 3, 65535,
    0, 0, 1, state, 5 * 1024);
  assert.equal(census.successorObservationCount, 2);
  assert.equal(census.successorUniqueCount, 1);
  assert.equal(census.successorRepeatCount, 1);
  assert.equal(census.crossCommandSameSuccessorCount, 1);
  assert.equal(census.deltaWriteCount, 6);
  assert.equal(census.maximumDeltaWrites, 3);
});
