"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeReplay } = require(
  "../../tools/agentank/diagnostics/joint-movement-corpus");

function replay(records) {
  return { meta: { players: [
    { tank: { id: "a", position: [2, 2] } },
    { tank: { id: "b", position: [3, 2] } }
  ] }, records };
}

test("joint movement corpus recognizes both seat orders following a vacated start", () => {
  const report = analyzeReplay(replay([
    [{ type: "tank", action: "go", objectId: "a", position: [3, 2] },
      { type: "tank", action: "go", objectId: "b", position: [3, 3] }],
    [{ type: "tank", action: "go", objectId: "a", position: [2, 2] },
      { type: "tank", action: "go", objectId: "b", position: [3, 2] }]
  ]), "fixture");
  assert.equal(report.followsVacatedStart, 2);
  assert.equal(report.seat0Follows, 1);
  assert.equal(report.seat1Follows, 1);
  assert.equal(report.successfulSwap, 0);
  assert.equal(report.successfulSameTarget, 0);
});

test("joint movement corpus excludes teleport jumps and boost intermediate crossings", () => {
  const report = analyzeReplay(replay([[{ type: "tank", action: "go", objectId: "a",
    position: [9, 9] }, { type: "tank", action: "go", objectId: "b", position: [2, 2] }]]));
  assert.equal(report.allUnitDualMoveFrames, 0);
  assert.equal(report.followsVacatedStart, 0);
});

