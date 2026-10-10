"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionRootEngine, productionValueSupportComplete } =
  require("../../engine-v2/src/runtime/production-root");
const { ProductionDepthSearch, SEARCH_SCHEDULE } =
  require("../../engine-v2/src/search/production-depth-search");
const { ProductionForcedWinSearch } =
  require("../../engine-v2/src/search/production-forced-win-search");
const { RootTransitionSlab } =
  require("../../engine-v2/src/search/root-transition-slab");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { RUNTIME_CONFIG } = require("../../engine-v2/src/generated/runtime-config");
const { WORK_KIND } = require("../../engine-v2/src/abi/cache-runtime-codes");
const { NONE_CELL, ACTION, CHANCE } = require("../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { RiskAcceptanceController } =
  require("../../engine-v2/src/search/risk-acceptance-controller");
const { SAFETY_STATUS } = require("../../engine-v2/src/search/information-safety-closure");
const { productionRootFixture } = require("../../tools/agentank/build/imp6-builder");
const { benchmarkSearchFrontier } =
  require("../../tools/agentank/benchmark/search-frontier-benchmark");
const { PAC_CELL } =
  require("../../engine-v2/src/search/projectile-attack-closure");
const { fast, physical, tank, boxedMap, fastSnapshot } = require("../imp3/helpers");

function preparedRoot() {
  const fixture = productionRootFixture(); fixture.enemy.status.fireLocked = true;
  const engine = new ProductionRootEngine(); const adapted = engine.adapter.adapt(
    fixture.me, fixture.enemy, fixture.game); engine.generateActions();
  const ourCount = engine.ourCount > 1 && engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
    engine.ourCount - 1 : engine.ourCount;
  return { fixture, engine, bundle: adapted.bundle, ourCount };
}

function calibratedSearchWork(search) {
  const charges = RUNTIME_CONFIG.WORK_CHARGES;
  return search.nodes * charges[WORK_KIND.VALUE_NODE] +
    (search.nodes - search.rootTransitionHits) * charges[WORK_KIND.FAST_TRANSITION] +
    search.rootTransitionHits * charges[WORK_KIND.CACHE] +
    search.classifiedNodes * charges[WORK_KIND.CACHE] +
    search.reverseBuilds * (charges[WORK_KIND.HARD] - charges[WORK_KIND.CACHE]);
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

test("cache-aware work interruption preserves the last complete Physical iteration", () => {
  const prepared = preparedRoot(); let interrupted = null;
  for (let workBudget = 1000; workBudget <= 30000; workBudget += 250) {
    const search = new ProductionDepthSearch(new ProductionCacheBank());
    search.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
      prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
      prepared.engine.enemyCount, 6, 512, 50, workBudget);
    if (search.completedDepth >= 1 && search.attemptedDepth > search.completedDepth &&
        search.workInterruptedCount > 0) { interrupted = { search, workBudget }; break; }
  }
  assert.ok(interrupted, "expected a dynamic work boundary after a complete iteration");
  const exact = new ProductionDepthSearch(new ProductionCacheBank());
  exact.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, interrupted.search.completedDepth, interrupted.search.nodes, 50);
  assert.deepEqual(Array.from(interrupted.search.rootScore.slice(0, prepared.ourCount)),
    Array.from(exact.rootScore.slice(0, prepared.ourCount)));
  assert.equal(interrupted.search.workUnits, calibratedSearchWork(interrupted.search));
  const charges = RUNTIME_CONFIG.WORK_CHARGES;
  assert.ok(interrupted.search.workUnits <= interrupted.workBudget +
    charges[WORK_KIND.VALUE_NODE] + charges[WORK_KIND.FAST_TRANSITION] +
    charges[WORK_KIND.HARD]);
  assert.equal(interrupted.search.rootRestoreFailures, 0);
});

test("warm Physical cache work is metered from actual transitions and Hard classifications", () => {
  const prepared = preparedRoot(); const search = new ProductionDepthSearch(new ProductionCacheBank());
  search.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 2, 512, 50, 50000);
  const cold = { work: search.workUnits, nodes: search.nodes };
  search.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 2, 512, 50, 50000);
  assert.equal(search.workUnits, calibratedSearchWork(search));
  assert.ok(search.nodes <= cold.nodes);
  assert.ok(search.workUnits <= cold.work);
  assert.equal(search.rootRestoreFailures, 0);
});

test("RootTransitionSlab replays the exact undoable successor and cached Hard facts", () => {
  const built = fast.createFastPhysical(physical({ map:
    { width: 7, height: 5, terrainColumnMajor: boxedMap(7, 5) },
  tanks: [tank(0, [1, 2], "right"), tank(1, [5, 2], "left")] }));
  const slab = new RootTransitionSlab();
  const ownActions = new Uint8Array([ACTION.GO, ACTION.FIRE]);
  const ownArguments = new Uint16Array(2).fill(NONE_CELL);
  const enemyActions = new Uint8Array([ACTION.NONE, ACTION.GO]);
  const enemyArguments = new Uint16Array(2).fill(NONE_CELL);
  const root = built.state.rootSignature();
  assert.equal(slab.prepare(built, ownActions, ownArguments, 2,
    enemyActions, enemyArguments, 2), 1);

  const firstStatus = slab.apply(built, 0, 0, CHANCE.NORMAL, CHANCE.NORMAL, 1);
  const first = fastSnapshot(built.state);
  const firstHard = [built.hard.lastStatus, built.hard.lastTerminal, built.hard.lastViable,
    built.hard.lastAppliedOwnCell, built.hard.lastAppliedOwnDirection];
  assert.equal(slab.lastReplay, 0);
  built.state.undoTo(built.kernel.lastMark);
  assert.equal(built.state.rootSignature(), root);

  const secondStatus = slab.apply(built, 0, 0, CHANCE.NORMAL, CHANCE.NORMAL, 1);
  assert.equal(secondStatus, firstStatus);
  assert.deepEqual(fastSnapshot(built.state), first);
  assert.deepEqual([built.hard.lastStatus, built.hard.lastTerminal, built.hard.lastViable,
    built.hard.lastAppliedOwnCell, built.hard.lastAppliedOwnDirection], firstHard);
  assert.equal(slab.lastReplay, 1); assert.equal(slab.lastHardReplay, 1);
  built.state.undoTo(built.kernel.lastMark);
  assert.equal(built.state.rootSignature(), root);
  assert.equal(slab.replayFailureCount, 0); assert.equal(slab.hotAllocationCount, 0);
});

test("RootTransitionSlab fills Hard after a proof-only hit and never fakes capacity support", () => {
  const built = fast.createFastPhysical(physical()); const slab = new RootTransitionSlab();
  const ownActions = new Uint8Array([ACTION.GO]);
  const arguments_ = new Uint16Array([NONE_CELL]);
  const enemyActions = new Uint8Array([ACTION.NONE]);
  slab.prepare(built, ownActions, arguments_, 1, enemyActions, arguments_, 1);
  assert.ok(slab.apply(built, 0, 0, 0, 0, 0)); built.state.undoTo(built.kernel.lastMark);
  const fillBefore = slab.hardFillCount;
  assert.ok(slab.apply(built, 0, 0, 0, 0, 1));
  assert.equal(slab.lastReplay, 1); assert.equal(slab.lastHardReplay, 0);
  assert.equal(slab.hardFillCount, fillBefore + 1); built.state.undoTo(built.kernel.lastMark);
  assert.ok(slab.apply(built, 0, 0, 0, 0, 1));
  assert.equal(slab.lastHardReplay, 1); built.state.undoTo(built.kernel.lastMark);

  const changedEnemy = new Uint8Array([ACTION.TURN_LEFT]);
  const generation = slab.generation;
  slab.prepare(built, ownActions, arguments_, 1, changedEnemy, arguments_, 1);
  assert.notEqual(slab.generation, generation);
  slab.deltaUsed = slab.deltaKey.length;
  const builds = slab.buildCount;
  assert.ok(slab.apply(built, 0, 0, 0, 0, 1)); built.state.undoTo(built.kernel.lastMark);
  assert.equal(slab.deltaOverflowCount, 1);
  assert.ok(slab.apply(built, 0, 0, 0, 0, 1)); built.state.undoTo(built.kernel.lastMark);
  assert.equal(slab.buildCount, builds + 2);
  slab.setEnabled(false); assert.equal(slab.apply(built, 0, 0, 0, 0, 1), 0);
  assert.ok(slab.bytes() > 0); assert.equal(slab.hotAllocationCount, 0);
});

test("root transition reuse is semantics-neutral and increases completed root work", () => {
  function run(enabled) {
    const fixture = productionRootFixture(); fixture.enemy.status.fireLocked = true;
    const engine = new ProductionRootEngine({ diagnosticRootTransitionSlab: enabled });
    const adapted = engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
    engine.generateActions();
    const count = engine.ourCount > 1 && engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
      engine.ourCount - 1 : engine.ourCount;
    const search = new ProductionDepthSearch(new ProductionCacheBank(), undefined,
      engine.rootTransitions);
    search.search(adapted.bundle, engine.ourActions, engine.ourArguments, count,
      engine.enemyActions, engine.enemyArguments, engine.enemyCount, 3, 512, 50);
    return { search, count, scores: Array.from(search.rootScore.slice(0, count)),
      cells: Array.from(search.rootCellScore.slice(0,
        count * SEARCH_CAPACITY.MAX_ENEMY_POLICIES)) };
  }
  const enabled = run(true); const disabled = run(false);
  assert.deepEqual(enabled.scores, disabled.scores); assert.deepEqual(enabled.cells, disabled.cells);
  assert.equal(enabled.search.completedDepth, disabled.search.completedDepth);
  assert.ok(enabled.search.rootTransitionHits > 0);
  assert.equal(disabled.search.rootTransitionHits, 0);
  assert.equal(enabled.search.rootRestoreFailures, 0);
  assert.equal(disabled.search.rootRestoreFailures, 0);
});

test("progressive widening is part of Minimax cache semantics and reports truncated support", () => {
  const prepared = preparedRoot(); const search = new ProductionDepthSearch(new ProductionCacheBank());
  search.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 3, 256, 50);
  assert.ok(search.completedDepth >= 1);
  assert.ok(search.completedExpansionLimit >= 2 && search.completedExpansionLimit <= 4);
  assert.ok(search.representativeSupportDepth <= search.completedDepth);
  assert.equal(search.representativeSupportComplete,
    search.representativeSupportDepth > 0 ? 1 : 0);
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

test("direct-depth schedule preserves exact values and closes confirmed stationary occupancy", () => {
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
  const directTwo = new ProductionDepthSearch(new ProductionCacheBank());
  directTwo.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 2, 512, 50);
  const legacyFixture = productionRootFixture(); legacyFixture.enemy.status.fireLocked = true;
  legacyFixture.me.tank.direction = "down";
  const legacyPhysicsEngine = new ProductionRootEngine({
    diagnosticStationaryOccupiedBlock: false
  });
  const legacyAdapted = legacyPhysicsEngine.adapter.adapt(
    legacyFixture.me, legacyFixture.enemy, legacyFixture.game);
  legacyPhysicsEngine.generateActions();
  const legacyOurCount = legacyPhysicsEngine.ourCount > 1 &&
    legacyPhysicsEngine.ourActions[legacyPhysicsEngine.ourCount - 1] === ACTION.NONE ?
    legacyPhysicsEngine.ourCount - 1 : legacyPhysicsEngine.ourCount;
  const legacyPhysics = new ProductionDepthSearch(new ProductionCacheBank());
  legacyPhysics.search(legacyAdapted.bundle, legacyPhysicsEngine.ourActions,
    legacyPhysicsEngine.ourArguments, legacyOurCount, legacyPhysicsEngine.enemyActions,
    legacyPhysicsEngine.enemyArguments, legacyPhysicsEngine.enemyCount, 2, 512, 50);
  // One node below the calibrated threshold forces the old conservative
  // schedule and still has enough support to finish depth two in this fixture.
  const legacy = new ProductionDepthSearch(new ProductionCacheBank());
  legacy.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 6, 249, 50);
  assert.equal(direct.lastSchedule, SEARCH_SCHEDULE.DIRECT_DEPTH_TWO);
  assert.equal(directTwo.lastSchedule, SEARCH_SCHEDULE.DIRECT_DEPTH_TWO);
  assert.equal(legacy.lastSchedule, SEARCH_SCHEDULE.LEGACY_ITERATIVE);
  assert.equal(direct.completedDepth, 2); assert.ok(direct.attemptedDepth >= 2);
  assert.equal(direct.representativeSupportComplete, 1);
  assert.equal(directTwo.completedDepth, 2); assert.equal(directTwo.attemptedDepth, 2);
  assert.deepEqual(Array.from(directTwo.rootScore.slice(0, prepared.ourCount)),
    Array.from(direct.rootScore.slice(0, prepared.ourCount)));
  // Before HP23, stationary GO/NONE and GO/TURN pairs were incorrectly left
  // unsupported. Keep that behavior available only as a diagnostic negative
  // control and prove that it cannot claim a complete depth-two result.
  assert.equal(legacyPhysics.completedDepth, 1);
  assert.equal(legacyPhysics.attemptedDepth, 2);
  assert.equal(legacyPhysics.rootRestoreFailures, 0);
  assert.equal(legacy.completedDepth, 1); assert.ok(legacy.attemptedDepth >= 2);
  assert.deepEqual(Array.from(legacyPhysics.rootScore.slice(0, legacyOurCount)),
    Array.from(legacy.rootScore.slice(0, prepared.ourCount)));
  assert.ok(directTwo.nodes <= 512);
  assert.equal(directTwo.representativeSupportComplete, 1);
  assert.ok(directTwo.representativeSupportDepth >= 1 &&
    directTwo.representativeSupportDepth <= directTwo.completedDepth);
  assert.equal(direct.rootRestoreFailures, 0); assert.equal(directTwo.rootRestoreFailures, 0);
  assert.equal(legacy.rootRestoreFailures, 0);
});

test("HP25 node-capacity override is diagnostic-only and leaves the production clamp intact", () => {
  const normal = new ProductionDepthSearch(new ProductionCacheBank());
  const diagnostic = new ProductionDepthSearch(new ProductionCacheBank(), undefined, null,
    { diagnosticNodeCapacity: SEARCH_CAPACITY.MAX_NODES * 4 });
  assert.equal(normal.diagnosticNodeCapacity, SEARCH_CAPACITY.MAX_NODES);
  assert.equal(diagnostic.diagnosticNodeCapacity, SEARCH_CAPACITY.MAX_NODES * 4);
});

test("root diagnostics can resize Physical TT and node capacity without changing defaults", () => {
  const normal = new ProductionRootEngine();
  const diagnostic = new ProductionRootEngine({
    diagnosticPhysicalTTEntries: 128,
    diagnosticNodeCapacity: SEARCH_CAPACITY.MAX_NODES * 2
  });
  assert.equal(normal.depthSearch.cache.entryCount, 32);
  assert.equal(normal.depthSearch.diagnosticNodeCapacity, SEARCH_CAPACITY.MAX_NODES);
  assert.equal(diagnostic.depthSearch.cache.entryCount, 128);
  assert.equal(diagnostic.depthSearch.diagnosticNodeCapacity, SEARCH_CAPACITY.MAX_NODES * 2);
  assert.ok(diagnostic.cacheBank.totalBytes() > normal.cacheBank.totalBytes());
  assert.equal(Math.min(620, normal.depthSearch.diagnosticNodeCapacity),
    SEARCH_CAPACITY.MAX_NODES);
  assert.equal(Math.min(620, diagnostic.depthSearch.diagnosticNodeCapacity), 620);
});

test("HP28 fixed-stack bound slabs exist only behind the diagnostic option", () => {
  const normal = new ProductionRootEngine();
  const disabled = new ProductionRootEngine({ diagnosticWindowedBounds: false });
  assert.equal(normal.depthSearch.windowedBoundsEnabled, 1);
  assert.ok(normal.depthSearch.frameAlpha instanceof Int32Array);
  assert.ok(normal.depthSearch.iterationCellBound instanceof Uint8Array);
  assert.equal(disabled.depthSearch.windowedBoundsEnabled, 0);
  assert.equal(disabled.depthSearch.frameAlpha, null);
  assert.equal(disabled.depthSearch.iterationCellBound, null);
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

test("residual ForcedWin is AND over every PAC survivor and never promotes UNKNOWN", () => {
  const built = fast.createFastPhysical(physical({ map:
    { width: 7, height: 7, terrainColumnMajor: boxedMap(7, 7) },
  tanks: [tank(0, [1, 3], "right"), tank(1, [2, 3], "up")] }));
  const enemyActions = new Uint8Array([ACTION.NONE, ACTION.GO]);
  const enemyArguments = new Uint16Array(2).fill(NONE_CELL);
  const signature = built.state.rootSignature();

  // The synthetic survivor relation is deliberately narrower than PAC: NONE
  // is an immediate terminal hit. The residual theorem must prove that branch
  // while trusting the already-proven PAC column for GO.
  const proof = new ProductionForcedWinSearch();
  assert.equal(proof.searchResidual(built, ACTION.FIRE, NONE_CELL,
    enemyActions, enemyArguments, 2,
    new Uint8Array([PAC_CELL.SURVIVES, PAC_CELL.PROVEN_DOOMED]),
    0, 2, PAC_CELL.PROVEN_DOOMED, PAC_CELL.SURVIVES, 3, 512),
  PROOF_STATUS.PROVEN);
  assert.equal(proof.completedDepth, 1);
  assert.equal(built.state.rootSignature(), signature);

  // Moving is a genuine surviving branch. Quantifying over it must refute the
  // same root FIRE instead of inheriting the proof from the doomed column.
  assert.equal(proof.searchResidual(built, ACTION.FIRE, NONE_CELL,
    enemyActions, enemyArguments, 2,
    new Uint8Array([PAC_CELL.PROVEN_DOOMED, PAC_CELL.SURVIVES]),
    0, 2, PAC_CELL.PROVEN_DOOMED, PAC_CELL.SURVIVES, 3, 512),
  PROOF_STATUS.DISPROVEN);
  assert.equal(built.state.rootSignature(), signature);

  // Even when every evaluated survivor is terminal, one unsupported column
  // blocks strict ownership for every horizon.
  assert.equal(proof.searchResidual(built, ACTION.FIRE, NONE_CELL,
    enemyActions, enemyArguments, 2,
    new Uint8Array([PAC_CELL.SURVIVES, PAC_CELL.UNKNOWN]),
    0, 2, PAC_CELL.PROVEN_DOOMED, PAC_CELL.SURVIVES, 3, 512),
  PROOF_STATUS.UNKNOWN);

  // A concrete refuting survivor dominates an unrelated UNKNOWN column. The
  // conjunction result must not depend on which column is visited first.
  assert.equal(proof.searchResidual(built, ACTION.FIRE, NONE_CELL,
    enemyActions, enemyArguments, 2,
    new Uint8Array([PAC_CELL.UNKNOWN, PAC_CELL.SURVIVES]),
    0, 2, PAC_CELL.PROVEN_DOOMED, PAC_CELL.SURVIVES, 3, 512),
  PROOF_STATUS.DISPROVEN);
  assert.equal(proof.rootRestoreFailures, 0);
  assert.equal(proof.hotAllocationCount, 0);
  assert.equal(built.state.rootSignature(), signature);
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
  const search = { completedDepth: 1, representativeSupportComplete: 1,
    rootScore: new Int32Array([800]),
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
  assert.ok(Number.isSafeInteger(direct.changedFromLegacy));
  assert.ok(direct.improvedFromLegacy + direct.degradedFromLegacy + direct.equalToLegacy <=
    direct.calls);
  assert.ok(adaptive.meanNodes <= adaptive.profile.budget);
  assert.ok(direct.meanNodes <= direct.profile.budget);
  assert.ok(adaptive.supportComplete >= legacy.supportComplete);
  assert.ok(Number.isSafeInteger(direct.meanOracleRegret));
});
