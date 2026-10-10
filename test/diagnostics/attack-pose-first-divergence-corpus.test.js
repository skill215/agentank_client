"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { targets } = require(
  "../../tools/agentank/diagnostics/attack-pose-first-divergence-corpus");

function match(outcome, actions) {
  return { scenarioFingerprint: "scene", matchUrlId: "match", candidateSeat: 0,
    seatSkills: ["poison", "stun"], analysisOutcome: outcome,
    terminalCategory: "SINGLE_CRASH",
    candidate: { compactActionStream: Buffer.from(actions).toString("base64") } };
}

test("corpus selects only outcome-changing roots at the first action divergence", () => {
  const changed = targets([match("V1_WIN", [1, 2, 3])],
    [match("V2_WIN", [1, 4, 3])]);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].decisionIndex, 1);
  assert.equal(changed[0].transition, "IMPROVEMENT");
  assert.equal(targets([match("DRAW", [1])], [match("DRAW", [2])]).length, 0);
});
