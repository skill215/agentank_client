"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { ProductionDepthSearch } =
  require("../../engine-v2/src/search/production-depth-search");
const { ProductionInformationSearch } =
  require("../../engine-v2/src/search/production-information-search");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { ACTION, NONE_CELL, FAST_STATUS, HARD_STATUS, TERMINAL, TERRAIN } =
  require("../../engine-v2/src/abi/fast-codes");
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

test("HP2 Information keeps one Information root and accepts deeper Physical continuation", () => {
  const prepared = preparedRoot(); const state = prepared.bundle.state;
  const worlds = new Uint16Array([state.arrays[ARRAY.TANK_CELL][1]]);
  const mass = new Uint16Array([10000]);
  const enemyProbability = new Uint16Array(24); enemyProbability[0] = 10000;
  const depth = new ProductionDepthSearch(new ProductionCacheBank());
  const info = prepared.engine.informationSearch;
  assert.equal(info.search(prepared.bundle, depth, prepared.engine.ourActions,
    prepared.engine.ourArguments, prepared.ourCount, prepared.engine.enemyActions,
    prepared.engine.enemyArguments, prepared.engine.enemyCount, worlds, mass, 1, 1,
    512, 50, 0, 1, enemyProbability, 5), 1);
  assert.equal(info.attemptedDepth, 5);
  assert.equal(info.informationRootDepth, 1);
  assert.ok(info.physicalContinuationAttemptedDepth >= 2);
  assert.ok(info.physicalContinuationDepth >= 1);
  assert.equal(info.completedDepth, 1 + info.physicalContinuationDepth);
  assert.ok(info.continuationRequiredCount > 0);
  assert.equal(info.rootRestoreFailures, 0);
});

test("HP3 Information optional-work exhaustion downgrades support without corrupting root", () => {
  const prepared = preparedRoot(); const state = prepared.bundle.state;
  const worlds = new Uint16Array([state.arrays[ARRAY.TANK_CELL][1]]);
  const mass = new Uint16Array([10000]);
  const enemyProbability = new Uint16Array(24);
  const base = Math.floor(10000 / prepared.engine.enemyCount); let assigned = 0;
  for (let index = 0; index < prepared.engine.enemyCount; index += 1) {
    enemyProbability[index] = base; assigned += base;
  }
  for (let index = 0; assigned < 10000; index = (index + 1) % prepared.engine.enemyCount) {
    enemyProbability[index] += 1; assigned += 1;
  }
  const info = new ProductionInformationSearch();
  const depth = new ProductionDepthSearch(new ProductionCacheBank());
  const root = state.rootSignature();
  assert.equal(info.search(prepared.bundle, depth, prepared.engine.ourActions,
    prepared.engine.ourArguments, prepared.ourCount, prepared.engine.enemyActions,
    prepared.engine.enemyArguments, prepared.engine.enemyCount, worlds, mass, 1, 1,
    512, 50, state.arrays[ARRAY.TANK_DIR][1], 1, enemyProbability, 1, 500), 1);
  assert.ok(info.workInterruptedCount > 0);
  assert.equal(info.supportComplete, 0);
  assert.equal(info.approximate, 1);
  assert.equal(info.workUnits,
    (info.nodes - info.rootTransitionHits) * 80 + info.rootTransitionHits * 8 +
      info.classifiedNodes * 8 + info.reverseBuilds * 112);
  assert.ok(info.workUnits <= 500 + 112);
  assert.equal(info.rootRestoreFailures, 0);
  assert.equal(state.rootSignature(), root);
});

test("SR5 Information depth-2 gives wide roots an executable continuation budget", () => {
  const prepared = preparedRoot();
  const state = prepared.bundle.state;
  const enemyCell = state.arrays[ARRAY.TANK_CELL][1];
  const worlds = new Uint16Array([enemyCell]);
  const mass = new Uint16Array([10000]);
  const enemyProbability = new Uint16Array(24); enemyProbability[0] = 10000;
  const depth = new ProductionDepthSearch(new ProductionCacheBank());
  const info = prepared.engine.informationSearch;
  assert.ok(prepared.ourCount >= 5,
    "fixture must retain the wide-root case that previously received six unusable nodes");
  assert.equal(info.search(prepared.bundle, depth, prepared.engine.ourActions,
    prepared.engine.ourArguments, prepared.ourCount, prepared.engine.enemyActions,
    prepared.engine.enemyArguments, prepared.engine.enemyCount, worlds, mass, 1, 1,
    96, 50, 0, 1, enemyProbability, 2), 1);
  assert.equal(info.completedDepth, 2);
  assert.ok(info.continuationLeafBudget >= 8,
    "continuationValue returns before Physical search below eight nodes");
  assert.ok(depth.continuationCallCount > 0);
  assert.ok(depth.continuationSearchCount > 0,
    "published depth two must execute at least one Physical continuation");
  assert.equal(info.rootRestoreFailures, 0);
});

test("SR5 Information hot ordering reuses constructor-owned slabs", () => {
  const prepared = preparedRoot();
  const state = prepared.bundle.state;
  const worlds = new Uint16Array([state.arrays[ARRAY.TANK_CELL][1]]);
  const mass = new Uint16Array([10000]);
  const enemyProbability = new Uint16Array(24); enemyProbability[0] = 10000;
  const info = prepared.engine.informationSearch;
  const order = info.enemyOrder; const evaluationOrder = info.evaluationOrder;
  const evaluationPriority = info.evaluationPriority; const retained = info.retainedMask;
  for (let call = 0; call < 2; call += 1) {
    const depth = new ProductionDepthSearch(new ProductionCacheBank());
    assert.equal(info.search(prepared.bundle, depth, prepared.engine.ourActions,
      prepared.engine.ourArguments, prepared.ourCount, prepared.engine.enemyActions,
      prepared.engine.enemyArguments, prepared.engine.enemyCount, worlds, mass, 1, 1,
      96, 50, 0, 1, enemyProbability, 2), 1);
    assert.equal(info.enemyOrder, order);
    assert.equal(info.evaluationOrder, evaluationOrder);
    assert.equal(info.evaluationPriority, evaluationPriority);
    assert.equal(info.retainedMask, retained);
    assert.equal(info.hotAllocationCount, 0);
  }
});

test("SR5 Information evaluates next-frame firing lanes before benign continuations", () => {
  const prepared = preparedRoot();
  const state = prepared.bundle.state; const a = state.arrays;
  a[ARRAY.TANK_CELL][0] = state.cell(3, 3);
  a[ARRAY.TANK_CELL][1] = state.cell(2, 1);
  a[ARRAY.TANK_DIR][0] = 3;
  a[ARRAY.TANK_DIR][1] = 1;
  a[ARRAY.TERRAIN][state.cell(2, 2)] = TERRAIN.OPEN;
  a[ARRAY.TERRAIN][state.cell(2, 3)] = TERRAIN.OPEN;
  state.initializeHash();
  const enemyActions = new Uint8Array([
    ACTION.FIRE, ACTION.GO, ACTION.NONE, ACTION.TURN_RIGHT
  ]);
  const inputOrder = new Uint8Array([0, 1, 2, 3]);
  const info = prepared.engine.informationSearch;
  const order = info.orderForSafety(state, ACTION.GO, enemyActions, inputOrder, 4);
  assert.equal(order[0], 3,
    "enemy TURN_RIGHT aligns with our projected GO cell and must receive proof budget first");
  assert.equal(enemyActions[order[0]], ACTION.TURN_RIGHT);
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
  assert.equal(depth.lastContinuationAttemptedDepth, 2);
  assert.ok(depth.lastContinuationCompletedDepth >= 1);
  assert.equal(state.hashLo, rootLo); assert.equal(state.hashHi, rootHi);
  assert.equal(state.deltaUsed * 1024 + state.eventUsed, mark);
});

function outcomeHarness() {
  let enemyAction = ACTION.NONE;
  const state = { undoTo() {} };
  return {
    state,
    currentEnemyAction() { return enemyAction; },
    bundle: {
      state,
      kernel: {
        lastMark: 0,
        applyFrame(action0, argument0, action1) {
          enemyAction = action1;
          return FAST_STATUS.APPLIED;
        }
      },
      hard: {
        lastTerminal: TERMINAL.NONE,
        classifyApplied() { return HARD_STATUS.ALLOW; }
      }
    }
  };
}

test("SR5 Information reserves direct-fire proof before value continuation", () => {
  const harness = outcomeHarness();
  const information = new ProductionInformationSearch();
  information.diagnosticDisableShallowAdjustment = 1;
  information.continuationLeafBudget = 8;
  information.continuationPoolRemaining = 8;
  information.trapProbeBudget = 5;
  const evaluator = {
    lastTrapProbeNodes: 0,
    lastContinuationNodes: 0,
    lastContinuationUsable: 1,
    probeDirectFireTrap(bundle, budget) {
      if (harness.currentEnemyAction() !== ACTION.TURN_RIGHT) {
        this.lastTrapProbeNodes = 0;
        return 0;
      }
      this.lastTrapProbeNodes = Math.min(5, budget);
      return budget >= 5 ? 1 : -1;
    },
    continuationValue() {
      this.lastContinuationNodes = 8;
      this.lastContinuationUsable = 1;
      return 1750;
    },
    heuristic() { return 100; }
  };
  assert.equal(information.evaluateOutcome(harness.bundle, evaluator,
    ACTION.GO, NONE_CELL, ACTION.FIRE, NONE_CELL, 0, 0, 32, 2, 50), 1750);
  assert.equal(information.continuationPoolRemaining, 0);
  assert.equal(information.trapProbeBudget, 5,
    "benign continuation must not consume the safety reserve");
  assert.equal(information.evaluateOutcome(harness.bundle, evaluator,
    ACTION.GO, NONE_CELL, ACTION.TURN_RIGHT, NONE_CELL, 0, 0, 32, 2, 50), -29900);
  assert.equal(information.trapProbeBudget, 0);
});

test("SR5 Information ignores unusable continuation values", () => {
  const harness = outcomeHarness();
  const information = new ProductionInformationSearch();
  information.diagnosticDisableShallowAdjustment = 1;
  information.continuationLeafBudget = 8;
  information.continuationPoolRemaining = 8;
  const evaluator = {
    lastTrapProbeNodes: 0,
    lastContinuationNodes: 2,
    lastContinuationUsable: 0,
    probeDirectFireTrap() { this.lastTrapProbeNodes = 0; return 0; },
    continuationValue() {
      this.lastContinuationNodes = 2;
      this.lastContinuationUsable = 0;
      return -22000;
    },
    heuristic() { return 700; }
  };
  assert.equal(information.evaluateOutcome(harness.bundle, evaluator,
    ACTION.FIRE, NONE_CELL, ACTION.FIRE, NONE_CELL, 0, 0, 32, 2, 50), 700);
  assert.equal(information.continuationPoolRemaining, 6);
});

test("SR5 Information does not call Physical continuation below its executable budget", () => {
  const harness = outcomeHarness();
  const information = new ProductionInformationSearch();
  information.diagnosticDisableShallowAdjustment = 1;
  information.continuationLeafBudget = 8;
  information.continuationPoolRemaining = 7;
  let calls = 0;
  const evaluator = {
    lastTrapProbeNodes: 0,
    lastContinuationNodes: 0,
    lastContinuationUsable: 0,
    probeDirectFireTrap() { this.lastTrapProbeNodes = 0; return 0; },
    continuationValue() { calls += 1; return -22000; },
    heuristic() { return 725; }
  };
  assert.equal(information.evaluateOutcome(harness.bundle, evaluator,
    ACTION.FIRE, NONE_CELL, ACTION.FIRE, NONE_CELL, 0, 0, 32, 2, 50), 725);
  assert.equal(calls, 0);
  assert.equal(information.continuationPoolRemaining, 7);
});
