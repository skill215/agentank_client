"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  frameActions,
  firstDivergence,
  transitions
} = require("../../tools/agentank/diagnostics/strategy-divergence-evidence");

function stream(pairs) {
  return Buffer.from(pairs.flat()).toString("base64");
}

test("strategy divergence decoding preserves simulator frame and action", () => {
  const match = { frameActionStream: stream([[4, 1], [7, 5]]) };
  assert.deepEqual(frameActions(match), [
    { frame: 4, action: 1 },
    { frame: 7, action: 5 }
  ]);
});

test("strategy divergence finds the first unequal frame/action pair", () => {
  const left = { frameActionStream: stream([[4, 1], [7, 2], [8, 3]]) };
  const right = { frameActionStream: stream([[4, 1], [7, 5], [8, 3]]) };
  assert.deepEqual(firstDivergence(left, right), {
    decision: 1,
    frame: 7,
    baselineAction: 2,
    candidateAction: 5
  });
});

test("strategy divergence pairs by scenario and candidate seat", () => {
  const same = stream([[1, 1]]);
  const changed = stream([[1, 5]]);
  const value = transitions({ matches: [
    { profile: "CURRENT", matchUrlId: "m", candidateSeat: 1,
      outcome: "V1_WIN", frameActionStream: same },
    { profile: "CANDIDATE", matchUrlId: "m", candidateSeat: 1,
      outcome: "V2_WIN", frameActionStream: changed }
  ] }, "CURRENT", "CANDIDATE");
  assert.equal(value.length, 1);
  assert.equal(value[0].divergence.candidateAction, 5);
});
