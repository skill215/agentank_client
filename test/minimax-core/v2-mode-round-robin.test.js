"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CYCLE, scheduleForCycle, classifyModeOutcome, summarize } =
  require("../../tools/agentank/diagnostics/v2-mode-round-robin");

test("round-robin schedule contains every directed edge and its reverse", () => {
  const schedule = scheduleForCycle();
  assert.equal(schedule.length, 6);
  for (const edge of CYCLE) {
    const legs = schedule.filter(item => item.pairId === edge.pairId);
    assert.deepEqual(legs.map(item => item.seatModes),
      [[edge.left, edge.right], [edge.right, edge.left]]);
  }
});

test("runtime-independent mode outcome uses stars and crashes", () => {
  const modes = ["A", "B"];
  assert.equal(classifyModeOutcome({ winner: 1, reason: "frameLimit" },
    { stars: [2, 2], crashes: [0, 0] }, modes).winnerMode, "DRAW");
  assert.equal(classifyModeOutcome({ winner: 0, reason: "frameLimit" },
    { stars: [1, 3], crashes: [0, 0] }, modes).winnerMode, "B");
  assert.equal(classifyModeOutcome({ winner: 0, reason: "crashed" },
    { stars: [4, 0], crashes: [1, 0] }, modes).winnerMode, "B");
});

test("standings account wins, draws, stars and fire by mode rather than seat", () => {
  const seat = (mode, fire) => ({ mode, runtimeMicros: 10,
    actionCounts: { FIRE: fire }, invariants: { avoidableHardRejects: 0 } });
  const matches = [{ pairId: "A_VS_B", seatModes: ["A", "B"],
    outcome: { winnerMode: "A" }, counts: { stars: [2, 1], crashes: [0, 1] },
    seats: [seat("A", 3), seat("B", 4)] },
  { pairId: "A_VS_B", seatModes: ["B", "A"], outcome: { winnerMode: "DRAW" },
    counts: { stars: [1, 1], crashes: [0, 0] }, seats: [seat("B", 5), seat("A", 6)] }];
  const value = summarize(matches);
  assert.deepEqual({ wins: value.standings.A.wins, draws: value.standings.A.draws,
    points2: value.standings.A.points2, fire: value.standings.A.fire },
  { wins: 1, draws: 1, points2: 3, fire: 9 });
  assert.equal(value.standings.B.losses, 1);
  assert.equal(value.pairs.A_VS_B.pairedCycles.count, 1);
  assert.equal(value.pairs.A_VS_B.pairedCycles.independentScenarioCount, 1);
  assert.equal(value.pairs.A_VS_B.pairedCycles.categories.LEFT_WIN_DRAW, 1);
  assert.equal(value.pairs.A_VS_B.pairedCycles.scoreDeltaPer10000, 5000);
});
