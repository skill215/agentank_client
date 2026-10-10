"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { exactScenarioRandomization, firstDifference, family, outcomeValue } = require(
  "../../tools/agentank/diagnostics/tactical-oracle-disagreement-audit");

test("firstDifference reports the first shared-root action change", () => {
  const left = Buffer.from([ACTION.GO, ACTION.TURN_LEFT, ACTION.FIRE]).toString("base64");
  const right = Buffer.from([ACTION.GO, ACTION.TURN_RIGHT, ACTION.FIRE]).toString("base64");
  assert.deepEqual(firstDifference(left, right), {
    frame: 1, left: ACTION.TURN_LEFT, right: ACTION.TURN_RIGHT
  });
});

test("action families and runtime-independent outcomes stay discrete", () => {
  assert.equal(family(ACTION.CAST_STUN), "RESOURCE");
  assert.equal(family(ACTION.TURN_LEFT), "TURN");
  assert.equal(outcomeValue("V2_WIN"), 2);
  assert.equal(outcomeValue("DRAW"), 1);
  assert.equal(outcomeValue("V1_WIN"), 0);
});

test("scenario randomization treats two seat results as one paired unit", () => {
  const exact = exactScenarioRandomization([4, 2, 0]);
  assert.equal(exact.scenarioCount, 3);
  assert.equal(exact.nonZeroScenarioCount, 2);
  assert.equal(exact.observedDelta, 6);
  assert.equal(exact.oneSidedP, 0.25);
  assert.equal(exact.twoSidedP, 0.5);
});
