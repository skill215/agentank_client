"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DISCOVERY_CHANCE,
  HOLDOUT_CHANCE,
  outcomeRank,
  cell,
  vector,
  pairedRelation,
  intervalRelation,
  qualify,
  selectCells,
  summarize
} = require(
  "../../tools/agentank/diagnostics/semantic-attack-chance-interval-corpus");

function terminal(outcome, stars, crashed = [false, false]) {
  return { outcome, frame: 128, reason: "frameLimit",
    candidateStars: stars[0], controlStars: stars[1],
    candidateCrashed: crashed[0], controlCrashed: crashed[1] };
}

function cells(specifications) {
  return specifications.map(function(specification, index) {
    return cell(DISCOVERY_CHANCE[index], index,
      terminal(specification[0], specification[1],
        specification[2] || [false, false]),
      { targetFrameSeen: true, physicalRootMatched: true, forced: true,
        sequenceSatisfied: true });
  });
}

test("chance split is immutable and does not overlap", () => {
  assert.deepEqual(DISCOVERY_CHANCE,
    ["HISTORICAL", "RANDOM0", "RANDOM1", "RANDOM2"]);
  assert.deepEqual(HOLDOUT_CHANCE,
    ["RANDOM3", "RANDOM4", "RANDOM5", "RANDOM6"]);
  assert.equal(DISCOVERY_CHANCE.filter(function(value) {
    return HOLDOUT_CHANCE.includes(value);
  }).length, 0);
});

test("chance vectors preserve outcome, nonloss, death, kill and stars", () => {
  const input = cells([
    ["V1_WIN", [0, 2]],
    ["DRAW", [1, 1]],
    ["V2_WIN", [0, 0], [false, true]],
    ["V1_WIN", [1, 1], [true, false]]
  ]);
  assert.deepEqual(vector(input), { count: 4, worstOutcome: 0,
    bestOutcome: 2, nonloss: 2, kill: 1, death: 1,
    minimumStarDiff: -2, totalStarDiff: -2 });
  assert.equal(outcomeRank("V2_WIN"), 2);
  assert.equal(outcomeRank("DRAW"), 1);
  assert.equal(outcomeRank("V1_WIN"), 0);
});

test("paired comparison rejects a win paid for by a different chance loss", () => {
  const incumbent = cells([
    ["DRAW", [1, 1]], ["V1_WIN", [0, 1]],
    ["V1_WIN", [0, 1]], ["V1_WIN", [0, 1]]
  ]);
  const candidate = cells([
    ["V1_WIN", [0, 1]], ["V2_WIN", [1, 0]],
    ["V1_WIN", [0, 1]], ["V1_WIN", [0, 1]]
  ]);
  const relation = pairedRelation(incumbent, candidate);
  assert.equal(relation.outcomeRegression, 1);
  assert.equal(relation.strictOutcome, 1);
  assert.equal(relation.noRegression, false);
  assert.equal(qualify(incumbent, candidate).qualified, false);
});

test("full vector qualification requires strict paired improvement and no regression", () => {
  const incumbent = cells([
    ["V1_WIN", [0, 1]], ["DRAW", [1, 1]],
    ["V1_WIN", [0, 1]], ["DRAW", [1, 1]]
  ]);
  const candidate = cells([
    ["DRAW", [1, 1]], ["DRAW", [2, 2]],
    ["V1_WIN", [0, 1]], ["DRAW", [1, 1]]
  ]);
  const relation = qualify(incumbent, candidate);
  assert.equal(relation.paired.strictNoRegression, true);
  assert.equal(relation.interval.terminalDominance, true);
  assert.equal(relation.interval.fullVectorDominance, true);
  assert.equal(relation.qualified, true);
});

test("star regression on an equal nonkill terminal remains a separate blocker", () => {
  const incumbent = cells([
    ["V1_WIN", [1, 2]], ["V1_WIN", [0, 1]],
    ["V1_WIN", [0, 1]], ["V1_WIN", [0, 1]]
  ]);
  const candidate = cells([
    ["V1_WIN", [0, 2]], ["V1_WIN", [0, 1]],
    ["V1_WIN", [0, 1]], ["V1_WIN", [0, 1]]
  ]);
  const relation = pairedRelation(incumbent, candidate);
  assert.equal(relation.comparableStarRegression, 1);
  assert.equal(relation.noRegression, false);
});

test("summary evaluates Chance holdout only for Discovery-qualified roots", () => {
  const positive = { cells: { incumbent: [], candidate: [] },
    discovery: { paired: { noRegression: true },
      interval: { terminalDominance: true, fullVectorDominance: true },
      qualified: true },
    holdout: { paired: { noRegression: true },
      interval: { terminalDominance: true, fullVectorDominance: true },
      qualified: true }, historicalTransition: "DRAW_TO_V2_WIN" };
  const neutral = { cells: { incumbent: [], candidate: [] },
    discovery: { paired: { noRegression: true },
      interval: { terminalDominance: false, fullVectorDominance: false },
      qualified: false },
    holdout: { paired: { noRegression: false },
      interval: { terminalDominance: false, fullVectorDominance: false },
      qualified: false }, historicalTransition: "V1_WIN_TO_V1_WIN" };
  const output = summarize([positive, neutral]);
  assert.equal(output.rootCount, 2);
  assert.equal(output.discovery.qualified, 1);
  assert.equal(output.holdout.evaluated, 1);
  assert.equal(output.holdout.passed, 1);
  assert.deepEqual(selectCells([
    { chanceOutcome: "RANDOM0" }, { chanceOutcome: "RANDOM5" }
  ], HOLDOUT_CHANCE), [{ chanceOutcome: "RANDOM5" }]);
});
