"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { exactTwoSidedSignTest, compare } = require(
  "../../tools/agentank/diagnostics/base-policy-response-mass-compare");

function match(id, seat, outcome) {
  return { implementation: "NATIVE", scenarioFingerprint: id,
    candidateSeat: seat, analysisOutcome: outcome };
}

test("paired comparison accounts transitions at match and scenario levels", () => {
  const shadow = [match("a", 0, "V1_WIN"), match("a", 1, "DRAW"),
    match("b", 0, "V2_WIN"), match("b", 1, "V1_WIN")];
  const active = [match("a", 0, "V2_WIN"), match("a", 1, "DRAW"),
    match("b", 0, "V1_WIN"), match("b", 1, "V1_WIN")];
  const result = compare(shadow, active);
  assert.deepEqual(result.matchPairs,
    { positive: 1, negative: 1, equal: 2, exactTwoSidedSignP: 1 });
  assert.equal(result.scenarioPairs.positive, 1);
  assert.equal(result.scenarioPairs.negative, 1);
  assert.equal(result.transitions["V1_WIN->V2_WIN"], 1);
  assert.equal(result.transitions["V2_WIN->V1_WIN"], 1);
});

test("exact sign test is symmetric and ignores tied pairs", () => {
  assert.equal(exactTwoSidedSignTest(0, 0), 1);
  assert.equal(exactTwoSidedSignTest(4, 0), 0.125);
  assert.equal(exactTwoSidedSignTest(0, 4), 0.125);
  assert.equal(exactTwoSidedSignTest(2, 2), 1);
});
