"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { outcomeValue, parseHorizons, targets, summarize } = require(
  "../../tools/agentank/diagnostics/native-bp-tactical-intervention");

test("native BP intervention selects only a physically effective first override", () => {
  const matches = [{ matchId: "m:0", historicalMatchUrlId: "m",
    scenarioFingerprint: "s", candidateSeat: 0,
    analysisOutcome: "CHALLENGER_WIN", terminalCategory: "SINGLE_CRASH",
    candidateController: { tacticalCore: { firstEffectiveOverrideFrame: 7,
      firstEffectiveLegacyAction: 1, firstEffectiveProposalAction: 4,
      firstEffectiveActualAction: 4 } } },
  { matchId: "m:1", candidateController: { tacticalCore: {
    firstEffectiveOverrideFrame: -1 } } }];
  assert.equal(targets(matches).length, 1);
  assert.equal(targets(matches)[0].frame, 7);
  assert.equal(outcomeValue("CHALLENGER_WIN"), 2);
  assert.equal(outcomeValue("DRAW"), 1);
  assert.equal(outcomeValue("CONTROL_WIN"), 0);
});

test("native BP intervention summary keeps exactness and causal deltas separate", () => {
  const value = summarize([{ actionMatched: true, localDelta: 2, fullDelta: 2,
    baselineOutcome: "CONTROL_WIN", interventionOutcome: "CHALLENGER_WIN",
    legacyAction: 1, proposalAction: 4, proposalExactBlock: 0,
    legacyExactBlock: 0 }, { actionMatched: true, localDelta: -1, fullDelta: 1,
    baselineOutcome: "DRAW", interventionOutcome: "CONTROL_WIN",
    legacyAction: 2, proposalAction: 1, proposalExactBlock: 1,
    legacyExactBlock: 0 }]);
  assert.equal(value.localImprovement, 1);
  assert.equal(value.localRegression, 1);
  assert.equal(value.netOutcomeDelta, 1);
  assert.equal(value.fullDirectionReproduced, 1);
  assert.deepEqual(value.exactness.bothExact, { records: 1, net: 2 });
  assert.deepEqual(value.exactness.incomplete, { records: 1, net: -1 });
});

test("native BP intervention horizons are unique positive and sorted", () => {
  assert.deepEqual(parseHorizons("8,1,4,2,4"), [1, 2, 4, 8]);
  assert.throws(() => parseHorizons("0,-1,x"), /HORIZONS_EMPTY/);
});
