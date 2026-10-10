"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseHorizons, activeFrames, summarize } = require(
  "../../tools/agentank/diagnostics/attack-pose-bounded-intervention");

const clean = { timeoutError: 0, avoidableHardReject: 0,
  riskDominatedSelection: 0, rootRestoreFailure: 0 };

test("bounded intervention horizons are unique, sorted and contiguous", () => {
  assert.deepEqual(parseHorizons("4,1,2,4"), [1, 2, 4]);
  assert.deepEqual(activeFrames(7, 4), [7, 8, 9, 10]);
});

test("bounded intervention reports the first horizon reproducing full outcome", () => {
  const base = { scenarioFingerprint: "s", candidateSeat: 0, decisionIndex: 3,
    transition: "IMPROVEMENT", leftOutcome: "V1_WIN", rightOutcome: "V2_WIN",
    actionMatched: true, intervention: { invariants: clean } };
  const records = [
    { ...base, horizon: 1, localDelta: 0,
      intervention: { outcome: "V1_WIN", invariants: clean } },
    { ...base, horizon: 2, localDelta: 2,
      intervention: { outcome: "V2_WIN", invariants: clean } }
  ];
  const result = summarize(records, [1, 2]);
  assert.equal(result.byHorizon[1].localNeutral, 1);
  assert.equal(result.byHorizon[2].improvementRootsRecovered, 1);
  assert.deepEqual(result.minimumFullOutcomeHorizon, { "2": 1, NEVER: 0 });
});
