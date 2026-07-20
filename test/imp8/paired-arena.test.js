"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { VARIANTS, aggregate } = require("../../tools/agentank/simulation/paired-arena");

test("paired arena is a four-cell implementation, seat and skill cross", () => {
  assert.equal(VARIANTS.length, 4);
  const cells = new Set(VARIANTS.map(item => `${item.bots.join("/")}:${item.skills.join("/")}`));
  assert.equal(cells.size, 4);
  for (const implementation of ["v1", "v2"])
    for (const skill of ["stun", "poison"])
      assert.equal(VARIANTS.filter(item => item.skills[item.bots.indexOf(implementation)] === skill).length, 2);
});

test("paired arena aggregation keeps strict layer failures separate from game outcomes", () => {
  const layerTotals = { selectedHardRejects: 0, avoidableHardRejects: 0,
    unavoidableAllRejected: 0, depthRootRestoreFailures: 0, hotAllocations: 0,
    rootCounts: { OK: 1 } };
  const base = { historicalMatchUrlId: "m", family: "NATIVE", v2Seat: 0,
    counts: { crashes: [0, 0] }, v2: { layerTotals, totalRuntimeMicros: 10,
      decisionCount: 4, runtimeModeCounts: { 0: 1, 1: 1, 2: 1, 3: 1 } },
    v1: { totalRuntimeMicros: 20, timeoutCount: 0, errorCount: 0 } };
  const summary = aggregate([{ ...base, result: { winnerImplementation: "v2" } },
    { ...base, family: "SKILL_CROSS", result: { winnerImplementation: "v1" } }], 1, 1);
  assert.equal(summary.v2Wins, 1);
  assert.equal(summary.v2Losses, 1);
  assert.equal(summary.selectedHardRejects, 0);
  assert.equal(summary.v2ReducedModeDecisions, 4);
  assert.equal(summary.v2ReducedModeRatePer10000, 5000);
  assert.equal(summary.v2EmergencyActions, 0);
  assert.equal(summary.v2EmergencyActionRatePer10000, 0);
});
