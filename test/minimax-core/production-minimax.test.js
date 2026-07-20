"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionRootEngine, productionValueSupportComplete } =
  require("../../engine-v2/src/runtime/production-root");
const { ProductionDepthSearch, SEARCH_SCHEDULE } =
  require("../../engine-v2/src/search/production-depth-search");
const { ProductionForcedWinSearch } =
  require("../../engine-v2/src/search/production-forced-win-search");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { NONE_CELL, ACTION, CHANCE } = require("../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { RiskAcceptanceController } =
  require("../../engine-v2/src/search/risk-acceptance-controller");
const { SAFETY_STATUS } = require("../../engine-v2/src/search/information-safety-closure");
const { productionRootFixture } = require("../../tools/agentank/build/imp6-builder");
const { benchmarkSearchFrontier } =
  require("../../tools/agentank/benchmark/search-frontier-benchmark");

function preparedRoot() {
  const fixture = productionRootFixture(); fixture.enemy.status.fireLocked = true;
  const engine = new ProductionRootEngine(); const adapted = engine.adapter.adapt(
    fixture.me, fixture.enemy, fixture.game); engine.generateActions();
  const ourCount = engine.ourCount > 1 && engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
    engine.ourCount - 1 : engine.ourCount;
  return { fixture, engine, bundle: adapted.bundle, ourCount };
}

test("completed production root scores are exactly max over row minima for the searched matrix", () => {
  const prepared = preparedRoot(); const depth = new ProductionDepthSearch(new ProductionCacheBank());
  depth.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 2, 256, 50);
  const rows = prepared.ourCount;
  assert.ok(depth.completedDepth > 0); let oracleBest = -32000; let oracleRow = 0;
  for (let row = 0; row < rows; row += 1) {
    let rowMinimum = 32000;
    for (let column = 0; column < prepared.engine.enemyCount; column += 1) {
      const value = depth.rootCellScore[row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column];
      assert.notEqual(value, -32000); if (value < rowMinimum) rowMinimum = value;
    }
    assert.equal(depth.rootScore[row], rowMinimum);
    if (rowMinimum > oracleBest) { oracleBest = rowMinimum; oracleRow = row; }
  }
  assert.equal(depth.bestValue, oracleBest); assert.equal(depth.bestRow, oracleRow);
  assert.equal(depth.rootRestoreFailures, 0);
});

test("joint chance support is computed once and enumerated from the fixed frame slab", () => {
  const prepared = preparedRoot(); const state = prepared.bundle.state;
  const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
  state.arrays[ARRAY.TANK_STUN_UNTIL][0] = frame + 2;
  state.arrays[ARRAY.TANK_STUN_UNTIL][1] = frame + 2;
  const search = new ProductionDepthSearch(new ProductionCacheBank());
  search.prepareChance(0, state, ACTION.GO, ACTION.TURN_LEFT);
  assert.equal(search.frameOwnChanceCount[0], 2);
  assert.equal(search.frameEnemyChanceCount[0], 2);
  assert.equal(search.frameChanceCount[0], 4);
  // After prepareChance the hot outcome loop must not inspect state or derive
  // the same support again. This is both a semantic and performance contract.
  search.chanceAlternatives = () => { throw new Error("chance support recomputed"); };
  const observed = [];
  for (let index = 0; index < 4; index += 1) {
    search.frameChanceIndex[0] = index;
    observed.push([search.chanceCode(0, state, 0, ACTION.GO),
      search.chanceCode(0, state, 1, ACTION.TURN_LEFT)]);
  }
  assert.deepEqual(observed, [[CHANCE.NORMAL, CHANCE.NORMAL],
    [CHANCE.REVERSED, CHANCE.NORMAL], [CHANCE.NORMAL, CHANCE.REVERSED],
    [CHANCE.REVERSED, CHANCE.REVERSED]]);
});

test("interrupted iterative deepening retains only the last fully completed depth", () => {
  const prepared = preparedRoot(); let interrupted = null;
  for (let budget = 1; budget <= 256; budget += 1) {
    const search = new ProductionDepthSearch(new ProductionCacheBank());
    search.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
      prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
      prepared.engine.enemyCount, 3, budget, 50);
    if (search.completedDepth === 1 && search.attemptedDepth === 2) {
      interrupted = { search, budget }; break;
    }
  }
  assert.ok(interrupted, "expected a budget boundary between depth one and two");
  const exactOne = new ProductionDepthSearch(new ProductionCacheBank());
  exactOne.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 1, interrupted.budget, 50);
  assert.equal(exactOne.completedDepth, 1);
  assert.deepEqual(Array.from(interrupted.search.rootScore.slice(0, prepared.ourCount)),
    Array.from(exactOne.rootScore.slice(0, prepared.ourCount)));
  assert.deepEqual(Array.from(interrupted.search.rootCellScore.slice(0,
    prepared.ourCount * SEARCH_CAPACITY.MAX_ENEMY_POLICIES)), Array.from(
    exactOne.rootCellScore.slice(0, prepared.ourCount * SEARCH_CAPACITY.MAX_ENEMY_POLICIES)));
  assert.equal(interrupted.search.rootRestoreFailures, 0);
});

test("progressive widening is part of Minimax cache semantics and reports truncated support", () => {
  const prepared = preparedRoot(); const search = new ProductionDepthSearch(new ProductionCacheBank());
  search.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 3, 256, 50);
  assert.ok(search.completedDepth >= 1);
  assert.ok(search.completedExpansionLimit >= 2 && search.completedExpansionLimit <= 4);
  assert.equal(search.representativeSupportComplete,
    search.completedTruncatedCount === 0 ? 1 : 0);
  const keyAtCompletedWidth = search.cacheKey(prepared.bundle.state, 1);
  const signatureAtCompletedWidth = search.cacheSignature(prepared.bundle.state, 1);
  search.iterationExpansionLimit = search.completedExpansionLimit === 4 ? 3 : 4;
  assert.notEqual(search.cacheKey(prepared.bundle.state, 1), keyAtCompletedWidth);
  assert.notEqual(search.cacheSignature(prepared.bundle.state, 1), signatureAtCompletedWidth);
});

test("production iterative deepening completes depth before widening the action abstraction", () => {
  const prepared = preparedRoot(); const search = new ProductionDepthSearch(new ProductionCacheBank());
  const completed = search.search(prepared.bundle, prepared.engine.ourActions,
    prepared.engine.ourArguments, prepared.ourCount, prepared.engine.enemyActions,
    prepared.engine.enemyArguments, prepared.engine.enemyCount, 3, 128, 50);
  assert.ok(completed >= 1);
  if (completed < 3) assert.equal(search.completedExpansionLimit, 2);
  assert.equal(search.rootRestoreFailures, 0);
});

test("calibrated direct-depth schedule removes doomed iterations without changing depth-two values", () => {
  const fixture = productionRootFixture(); fixture.enemy.status.fireLocked = true;
  fixture.me.tank.direction = "down";
  const engine = new ProductionRootEngine(); const adapted = engine.adapter.adapt(
    fixture.me, fixture.enemy, fixture.game); engine.generateActions();
  const ourCount = engine.ourCount > 1 && engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
    engine.ourCount - 1 : engine.ourCount;
  const prepared = { engine, bundle: adapted.bundle, ourCount };
  const direct = new ProductionDepthSearch(new ProductionCacheBank());
  direct.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 6, 512, 50);
  // One node below the calibrated threshold forces the old conservative
  // schedule and still has enough support to finish depth two in this fixture.
  const legacy = new ProductionDepthSearch(new ProductionCacheBank());
  legacy.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 6, 249, 50);
  assert.equal(direct.lastSchedule, SEARCH_SCHEDULE.DIRECT_DEPTH_TWO);
  assert.equal(legacy.lastSchedule, SEARCH_SCHEDULE.LEGACY_ITERATIVE);
  assert.equal(direct.completedDepth, 2); assert.equal(legacy.completedDepth, 2);
  assert.deepEqual(Array.from(direct.rootScore.slice(0, prepared.ourCount)),
    Array.from(legacy.rootScore.slice(0, prepared.ourCount)));
  assert.ok(direct.nodes < legacy.nodes);
  assert.equal(direct.rootRestoreFailures, 0); assert.equal(legacy.rootRestoreFailures, 0);
});

test("production value and proof searches honor zero budget without mutating the root", () => {
  const prepared = preparedRoot(); const state = prepared.bundle.state;
  const signature = state.rootSignature(); const depth = new ProductionDepthSearch(new ProductionCacheBank());
  assert.equal(depth.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 3, 0, 50), 0);
  assert.equal(depth.nodes, 0); assert.equal(state.rootSignature(), signature);
  const proof = new ProductionForcedWinSearch();
  assert.equal(proof.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 3, 0), PROOF_STATUS.UNKNOWN);
  assert.equal(proof.nodes, 0); assert.equal(state.rootSignature(), signature);
});

test("budget or direction truncation can only downgrade InformationState completeness", () => {
  const prepared = preparedRoot(); const state = prepared.bundle.state;
  const enemyCell = state.arrays[ARRAY.TANK_CELL][1];
  const worlds = new Uint16Array([enemyCell, enemyCell, enemyCell]);
  const mass = new Uint16Array([3334, 3333, 3333]);
  const actions = new Uint8Array([ACTION.NONE]); const arguments_ = new Uint16Array([NONE_CELL]);
  const enemyProbability = new Uint16Array([10000]); const information = prepared.engine.informationSearch;
  assert.equal(information.search(prepared.bundle, prepared.engine.depthSearch,
    actions, arguments_, 1, actions, arguments_, 1, worlds, mass, 3, 1, 1, 50, 0, 1,
    enemyProbability), 1);
  assert.equal(information.completedDepth, 1); assert.equal(information.worldsEvaluated, 1);
  assert.equal(information.supportComplete, 0); assert.equal(information.approximate, 1);
  assert.equal(information.rootRestoreFailures, 0);

  assert.equal(information.search(prepared.bundle, prepared.engine.depthSearch,
    actions, arguments_, 1, actions, arguments_, 1, worlds, mass, 3, 1, 16, 50, 0, 0,
    enemyProbability), 1);
  assert.equal(information.supportComplete, 0); assert.equal(information.approximate, 1);
  assert.equal(information.rootRestoreFailures, 0);
});

test("production Minimax value scaling has one explicit divisor shared by root and cells", () => {
  const controller = new RiskAcceptanceController();
  const safety = { status: new Uint8Array([SAFETY_STATUS.PROVEN_SAFE]),
    immediateFatalMass: new Uint16Array(1), horizonFatalMass: new Uint16Array(1),
    unknownMass: new Uint16Array(1), earliestFatalFrame: new Uint8Array(1),
    escapeSlack: new Int8Array(1), coverage: new Uint16Array([10000]) };
  const search = { completedDepth: 1, rootScore: new Int32Array([800]),
    rootCellScore: new Int32Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES) };
  search.rootCellScore[0] = 400; search.rootCellScore[1] = -400;
  controller.populate(1, new Uint8Array([0]), safety, new Int16Array([100]),
    search, null, 2, null, 4);
  assert.equal(controller.searchDivisor, 4);
  assert.equal(controller.outcome.robustLower[0], 300);
  assert.equal(controller.outcome.worstValue[0], 0);
});

test("truncated representative or information support cannot mark StageMatrix cells complete", () => {
  assert.equal(productionValueSupportComplete({ representativeSupportComplete: 0 }, false), 0);
  assert.equal(productionValueSupportComplete({ representativeSupportComplete: 1 }, false), 1);
  assert.equal(productionValueSupportComplete({ supportComplete: 1, approximate: 0 }, true), 1);
  assert.equal(productionValueSupportComplete({ supportComplete: 1, approximate: 1 }, true), 0);
  assert.equal(productionValueSupportComplete({ supportComplete: 0, approximate: 0 }, true), 0);
});

test("search frontier benchmark reports completion, cost, and selection regret", () => {
  const benchmark = benchmarkSearchFrontier({ scenarioCount: 8, measuredBatches: 1 });
  assert.equal(benchmark.status, "PASS");
  assert.equal(benchmark.totalScenarioEvaluations, 8);
  const legacy = benchmark.summaries["legacy-250"];
  const adaptive = benchmark.summaries["adaptive-d2-w2-250"];
  const direct = benchmark.summaries["direct-d2-w2-250"];
  assert.equal(legacy.calls, 8); assert.equal(adaptive.calls, 8); assert.equal(direct.calls, 8);
  assert.equal(legacy.rootRestoreFailures, 0); assert.equal(direct.rootRestoreFailures, 0);
  assert.equal(adaptive.completed, legacy.completed);
  assert.equal(direct.changedFromLegacy, 0);
  assert.ok(adaptive.meanNodes <= legacy.meanNodes);
  assert.ok(direct.meanNodes <= legacy.meanNodes);
  assert.ok(Number.isSafeInteger(direct.meanOracleRegret));
});
