"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FullRunAccumulator } = require("../../tools/agentank/fast-regression/analyze-run");

function manifest() {
  return { summary: { arena: { repetitions: 1, variantsPerScenario: 4,
    avoidableHardRejects: 0, riskDominatedSelections: 0, rootRestoreFailures: 0,
    v2Timeouts: 0, v2Errors: 0, v2Runtime: { total: 2, p95PerMatch: 2 },
    v1Runtime: { total: 1, p95PerMatch: 1 },
    v2ActionCounts: { FIRE: 2 }, v1ActionCounts: { fire: 1 } } } };
}

function match(id, variantId, implementations, stars, crashes, reason, rawWinner) {
  return { matchId: `${id}:${variantId}`, historicalMatchUrlId: id,
    family: variantId.startsWith("NATIVE") ? "NATIVE" : "SKILL_CROSS", repetition: 0,
    variantId, seatImplementations: implementations, counts: { stars, crashes },
    result: { reason, winnerImplementation: rawWinner,
      winnerSeat: rawWinner === "v2" ? implementations.indexOf("v2") : implementations.indexOf("v1") } };
}

test("full run analysis excludes runtime winners and keeps swapped pair categories", () => {
  const a = new FullRunAccumulator(manifest());
  a.add(match("s", "NATIVE_V1_SEAT0", ["v1", "v2"], [1, 1], [0, 0], "frameLimit", "v1"));
  a.add(match("s", "NATIVE_V2_SEAT0", ["v2", "v1"], [1, 0], [0, 1], "crashed", "v2"));
  const result = a.finish();
  assert.deepEqual(result.analysis, { V1_WIN: 0, V2_WIN: 1, DRAW: 1,
    strictWinRatePer10000: 5000, scoreRatePer10000: 7500 });
  assert.equal(result.pairs.V2_WIN_DRAW, 1);
  assert.equal(result.transitions.v1_TO_DRAW, 1);
});
