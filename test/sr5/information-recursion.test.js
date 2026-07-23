"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { ProductionDepthSearch } =
  require("../../engine-v2/src/search/production-depth-search");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { ACTION, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { ARRAY } = require("../../engine-v2/src/state/fast-state");
const { productionRootFixture } = require("../../tools/agentank/build/imp6-builder");

function preparedRoot() {
  const fixture = productionRootFixture(); fixture.enemy.status.fireLocked = true;
  const engine = new ProductionRootEngine(); const adapted = engine.adapter.adapt(
    fixture.me, fixture.enemy, fixture.game); engine.generateActions();
  const ourCount = engine.ourCount > 1 && engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
    engine.ourCount - 1 : engine.ourCount;
  return { fixture, engine, bundle: adapted.bundle, ourCount };
}

test("SR5 Information depth-1 scores are unchanged when decisionDepth is 1", () => {
  const prepared = preparedRoot();
  const state = prepared.bundle.state;
  const enemyCell = state.arrays[ARRAY.TANK_CELL][1];
  const worlds = new Uint16Array([enemyCell]);
  const mass = new Uint16Array([10000]);
  const enemyProbability = new Uint16Array(8); enemyProbability[0] = 10000;
  const info = prepared.engine.informationSearch;
  const depth = prepared.engine.depthSearch;
  assert.equal(info.search(prepared.bundle, depth, prepared.engine.ourActions,
    prepared.engine.ourArguments, prepared.ourCount, prepared.engine.enemyActions,
    prepared.engine.enemyArguments, prepared.engine.enemyCount, worlds, mass, 1, 1,
    256, 50, 0, 1, enemyProbability, 1), 1);
  assert.equal(info.completedDepth, 1);
  assert.equal(info.attemptedDepth, 1);
  assert.equal(info.continuationLeafBudget, 0);
  assert.equal(info.rootRestoreFailures, 0);
  const depth1Scores = Int32Array.from(info.rootScore.slice(0, prepared.ourCount));
  assert.equal(info.search(prepared.bundle, depth, prepared.engine.ourActions,
    prepared.engine.ourArguments, prepared.ourCount, prepared.engine.enemyActions,
    prepared.engine.enemyArguments, prepared.engine.enemyCount, worlds, mass, 1, 1,
    256, 50, 0, 1, enemyProbability), 1);
  assert.deepEqual(Array.from(info.rootScore.slice(0, prepared.ourCount)),
    Array.from(depth1Scores));
});

test("SR5 Information depth-2 uses Physical continuation leaves when budget allows", () => {
  const prepared = preparedRoot();
  const state = prepared.bundle.state;
  const enemyCell = state.arrays[ARRAY.TANK_CELL][1];
  const worlds = new Uint16Array([enemyCell]);
  const mass = new Uint16Array([10000]);
  const enemyProbability = new Uint16Array(8); enemyProbability[0] = 10000;
  // Tiny action set keeps matrixCost small so leftover funds depth-2 leaves.
  const ourActions = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT]);
  const ourArguments = new Uint16Array([NONE_CELL, NONE_CELL]);
  const enemyActions = new Uint8Array([ACTION.NONE]);
  const enemyArguments = new Uint16Array([NONE_CELL]);
  const info = prepared.engine.informationSearch;
  const depth = new ProductionDepthSearch(new ProductionCacheBank());
  assert.equal(info.search(prepared.bundle, depth, ourActions, ourArguments, 2,
    enemyActions, enemyArguments, 1, worlds, mass, 1, 1, 512, 50, 0, 1,
    enemyProbability, 2), 1);
  assert.equal(info.completedDepth, 2);
  assert.ok(info.continuationLeafBudget >= 6);
  assert.equal(info.supportComplete, 0);
  assert.equal(info.approximate, 1);
  assert.equal(info.rootRestoreFailures, 0);
  assert.ok(info.nodes > 2);
});

test("SR5 Physical continuationValue restores completedDepth and state", () => {
  const prepared = preparedRoot();
  const depth = new ProductionDepthSearch(new ProductionCacheBank());
  const state = prepared.bundle.state;
  const rootLo = state.hashLo; const rootHi = state.hashHi;
  const mark = state.deltaUsed * 1024 + state.eventUsed;
  depth.completedDepth = 0;
  const value = depth.continuationValue(prepared.bundle, 2, 64, 50);
  assert.ok(Number.isSafeInteger(value));
  assert.equal(depth.completedDepth, 0);
  assert.ok(depth.lastContinuationNodes > 0);
  assert.equal(state.hashLo, rootLo); assert.equal(state.hashHi, rootHi);
  assert.equal(state.deltaUsed * 1024 + state.eventUsed, mark);
});
