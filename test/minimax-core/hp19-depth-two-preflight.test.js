"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionRootEngine } = require(
  "../../engine-v2/src/runtime/production-root");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { benchmarkFixture } = require(
  "../../tools/agentank/benchmark/search-frontier-benchmark");

function run(index, enabled) {
  const fixture = benchmarkFixture(index);
  const engine = new ProductionRootEngine({ diagnosticDepthTwoPreflight: enabled });
  const adapted = engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
  assert.ok(adapted.bundle); engine.generateActions();
  let count = engine.ourCount;
  if (count > 1 && engine.ourActions[count - 1] === ACTION.NONE) count -= 1;
  const depth = engine.depthSearch.search(adapted.bundle, engine.ourActions,
    engine.ourArguments, count, engine.enemyActions, engine.enemyArguments,
    engine.enemyCount, 3, 512, 50);
  return { engine, count, depth, action: engine.ourActions[engine.depthSearch.bestRow],
    value: engine.depthSearch.bestValue,
    score: Array.from(engine.depthSearch.rootScore.slice(0, count)),
    cells: Array.from(engine.depthSearch.rootCellScore.slice(0, count * 6)),
    nodes: engine.depthSearch.nodes,
    supportDepth: engine.depthSearch.representativeSupportDepth,
    generated: engine.depthSearch.completedGeneratedMax,
    truncated: engine.depthSearch.completedTruncatedCount };
}

test("HP19 P2 preflight is a semantics-neutral shadow on the fixed frontier", () => {
  let roots = 0; let states = 0; let projected = 0;
  for (let index = 0; index < 16; index += 1) {
    const current = run(index, false); const shadow = run(index, true);
    assert.equal(shadow.depth, current.depth);
    assert.equal(shadow.action, current.action);
    assert.equal(shadow.value, current.value);
    assert.deepEqual(shadow.score, current.score);
    assert.deepEqual(shadow.cells, current.cells);
    assert.equal(shadow.nodes, current.nodes);
    assert.equal(shadow.supportDepth, current.supportDepth);
    assert.equal(shadow.generated, current.generated);
    assert.equal(shadow.truncated, current.truncated);
    assert.equal(shadow.engine.depthSearch.rootRestoreFailures, 0);
    roots += shadow.engine.depthSearch.depthTwoPreflightRootCount;
    states += shadow.engine.depthSearch.depthTwoPreflightStateCountTotal;
    projected += shadow.engine.depthSearch.depthTwoPreflightProjectedNodesTotal;
  }
  assert.ok(roots > 0); assert.ok(states > 0); assert.ok(projected > 0);
});

test("HP19 P2 preflight reuses fixed search slabs and allocates no hot arrays", () => {
  const item = run(0, true); const search = item.engine.depthSearch;
  assert.equal(search.depthTwoPreflightEnabled, 1);
  assert.equal(search.hotAllocationCount, 0);
  assert.equal(search.depthTwoPreflightRootCount, 1);
  assert.ok(search.depthTwoPreflightProjectedNodesTotal > 0);
  assert.ok(search.depthTwoPreflightAvailableNodesTotal >= 0);
  assert.equal(search.depthTwoPreflightP2Attempts, 1);
  assert.equal(search.depthTwoPreflightP2ExactCompleted +
    search.depthTwoPreflightP2CompletedNonExact +
    search.depthTwoPreflightP2BudgetInterrupted +
    search.depthTwoPreflightP2SupportAborted +
    search.depthTwoPreflightP2TransitionIncomplete +
    search.depthTwoPreflightP2OtherFailure, 1);
  assert.equal(search.depthTwoPreflightP2Completed,
    search.depthTwoPreflightP2ExactCompleted +
    search.depthTwoPreflightP2CompletedNonExact);
  assert.equal(search.depthTwoPreflightP2SupportAborted,
    search.depthTwoPreflightP2WidthAborted +
    search.depthTwoPreflightP2FastAborted +
    search.depthTwoPreflightP2HardAborted +
    search.depthTwoPreflightP2UnclassifiedAborted);
  assert.equal(search.depthTwoPreflightP2Attempts,
    search.depthTwoPreflightP2WithExactP1 +
    search.depthTwoPreflightP2WithoutExactP1);
  assert.ok(search.depthTwoPreflightP2NonExactWithoutExactP1 <=
    search.depthTwoPreflightP2CompletedNonExact);
  assert.ok(search.depthTwoPreflightP2FastStatusCounts instanceof Uint32Array);
  assert.ok(search.depthTwoPreflightP2FastActionPairCounts instanceof Uint32Array);
});

test("HP22 Fast failure census allocates diagnostic slabs only when enabled", () => {
  const current = run(0, false).engine.depthSearch;
  const shadow = run(0, true).engine.depthSearch;
  assert.equal(current.depthTwoPreflightP2FastStatusCounts, null);
  assert.equal(current.depthTwoPreflightP2FastActionPairCounts, null);
  assert.ok(shadow.depthTwoPreflightP2FastStatusCounts instanceof Uint32Array);
  assert.ok(shadow.depthTwoPreflightP2FastActionPairCounts instanceof Uint32Array);
  assert.equal(current.hotAllocationCount, 0);
  assert.equal(shadow.hotAllocationCount, 0);
});
