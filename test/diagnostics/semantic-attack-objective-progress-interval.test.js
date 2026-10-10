"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ARRAY } = require("../../engine-v2/src/state/fast-state");
const { OBJECTIVE_RELATION,
  SemanticAttackObjectiveProgressInterval } = require(
  "../../tools/agentank/diagnostics/semantic-attack-objective-progress-interval");

function fixture() {
  const arrays = new Array(ARRAY.TERRAIN + 1).fill(null);
  arrays[ARRAY.TERRAIN] = new Uint8Array(25);
  const state = { width: 5, height: 5, cells: 25, arrays,
    cell(x, y) { return y * 5 + x; },
    x(cell) { return cell % 5; }, y(cell) { return Math.trunc(cell / 5); } };
  const engine = { enemyCount: 2, adapter: { state },
    projectedCell: Uint16Array.from([state.cell(1, 1), state.cell(2, 1)]),
    projectedDirection: Uint8Array.from([1, 1]) };
  const pose = { selected: 0, count: 2,
    enemyCell: Uint16Array.from([state.cell(4, 1), state.cell(4, 2)]),
    enemyDirection: Uint8Array.from([3, 3]),
    rowProgress: Uint8Array.from([0, 1]),
    rowDeadline: Uint8Array.from([4, 3]),
    successorResponseCoverage(_engine, row) { return row + 1; },
    escapeCount(_state, cell) { return cell === state.cell(2, 1) ? 3 : 2; } };
  return { engine, pose };
}

test("candidate objective progress dominates without scalar encoding", () => {
  const { engine, pose } = fixture();
  const interval = new SemanticAttackObjectiveProgressInterval();
  assert.equal(interval.compare(engine, pose, 0, 1),
    OBJECTIVE_RELATION.CANDIDATE_DOMINATES);
  assert.deepEqual(Array.from(interval.current), [0, 4, 1, 1, 2, 1]);
  assert.deepEqual(Array.from(interval.candidate), [1, 3, 1, 2, 3, 1]);
  assert.equal(interval.summary().hotAllocationCount, 0);
});

test("one regressing objective dimension makes rows incomparable", () => {
  const { engine, pose } = fixture();
  pose.escapeCount = function(_state, cell) {
    return cell === engine.projectedCell[1] ? 1 : 2;
  };
  const interval = new SemanticAttackObjectiveProgressInterval();
  assert.equal(interval.compare(engine, pose, 0, 1),
    OBJECTIVE_RELATION.INCOMPARABLE);
});

test("missing projected support is explicitly incomplete", () => {
  const { engine, pose } = fixture();
  engine.projectedCell[1] = 0xffff;
  const interval = new SemanticAttackObjectiveProgressInterval();
  assert.equal(interval.compare(engine, pose, 0, 1),
    OBJECTIVE_RELATION.INCOMPLETE);
  assert.equal(interval.summary().incompleteCount, 1);
});
