"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { DEEP_WIDTH } = require("../../engine-v2/src/search/production-depth-search");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ACTION, CHANCE } = require("../../engine-v2/src/abi/fast-codes");
const { benchmarkFixture } =
  require("../../tools/agentank/benchmark/search-frontier-benchmark");

function rootFixture(index = 1, enabled = true, rootOrdering = false) {
  const fixture = benchmarkFixture(index);
  const engine = new ProductionRootEngine({ diagnosticCrossFramePV: enabled,
    diagnosticCrossFrameRootPV: rootOrdering,
    diagnosticRootTransitionSlab: true });
  const adapted = engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
  assert.ok(adapted.bundle); engine.generateActions();
  let ourCount = engine.ourCount;
  if (ourCount > 1 && engine.ourActions[ourCount - 1] === ACTION.NONE) ourCount -= 1;
  return { engine, bundle: adapted.bundle, ourCount };
}

function advanceToRecordedSuccessor(index = 1, enabled = true, rootOrdering = false) {
  const item = rootFixture(index, enabled, rootOrdering); const { engine, bundle } = item;
  const search = engine.depthSearch;
  search.search(bundle, engine.ourActions, engine.ourArguments, item.ourCount,
    engine.enemyActions, engine.enemyArguments, engine.enemyCount, 3, 100000, 50);
  assert.ok(engine.rootTransitions.principalStoreCount > 0);
  const row = search.bestRow;
  assert.equal(engine.rootTransitions.commitPrincipalAction(
    engine.ourActions[row], engine.ourArguments[row]), 1);
  let column = -1;
  for (let candidate = 0; candidate < engine.enemyCount; candidate += 1) {
    const entry = engine.rootTransitions.entryIndex(row, candidate, CHANCE.NORMAL, CHANCE.NORMAL);
    if (engine.rootTransitions.hasPrincipalEntry(entry)) { column = candidate; break; }
  }
  assert.ok(column >= 0);
  const status = engine.rootTransitions.apply(bundle, row, column,
    CHANCE.NORMAL, CHANCE.NORMAL, 1);
  assert.ok(status > 0);
  return { ...item, row, column, childSignature: bundle.state.rootSignature() };
}

function reroot(item) {
  const { engine, bundle } = item; engine.generateActions();
  let ourCount = engine.ourCount;
  if (ourCount > 1 && engine.ourActions[ourCount - 1] === ACTION.NONE) ourCount -= 1;
  const depth = engine.depthSearch.search(bundle, engine.ourActions, engine.ourArguments,
    ourCount, engine.enemyActions, engine.enemyArguments, engine.enemyCount, 3, 100000, 50);
  return { depth, action: engine.ourActions[engine.depthSearch.bestRow],
    value: engine.depthSearch.bestValue,
    rootScore: Array.from(engine.depthSearch.rootScore.slice(0, ourCount)),
    cells: Array.from(engine.depthSearch.rootCellScore.slice(0,
      ourCount * 6)), nodes: engine.depthSearch.nodes };
}

test("HP8 diagnostic root ordering can replay an exact prior principal program", () => {
  const item = advanceToRecordedSuccessor(1, true, true); const search = item.engine.depthSearch;
  assert.equal(search.prepareCrossFramePV(item.bundle.state, 50, DEEP_WIDTH), 1);
  assert.ok(search.crossFramePVDepth >= 1);
  const action = search.crossFramePVAction; const argument = search.crossFramePVArgument;
  const before = search.crossFramePVRootPromoteCount;
  reroot(item);
  assert.ok(search.crossFramePVRootPromoteCount > before);
  assert.equal(search.rootActions[search.rootRowOrder[0]], action);
  assert.equal(search.rootArguments[search.rootRowOrder[0]], argument);
  assert.equal(item.bundle.state.rootSignature(), item.childSignature);
  assert.equal(search.rootRestoreFailures, 0);
});

test("HP8 production observes cross-frame PV but leaves root ownership unchanged", () => {
  const item = advanceToRecordedSuccessor(1, true, false);
  const search = item.engine.depthSearch;
  assert.equal(search.prepareCrossFramePV(item.bundle.state, 50, DEEP_WIDTH), 1);
  reroot(item);
  assert.equal(search.crossFramePVPrepared, 1);
  assert.equal(search.crossFramePVActive, 0);
  assert.equal(search.crossFramePVRootPromoteCount, 0);
  assert.ok(search.crossFramePVHitCount > 0);
});

test("HP11 successor principal keeps distinct exact-width identities", () => {
  const item = advanceToRecordedSuccessor(1, true, false);
  const search = item.engine.depthSearch;
  assert.equal(search.prepareCrossFramePV(item.bundle.state, 50, 2), 1);
  assert.equal(search.prepareCrossFramePV(item.bundle.state, 50, DEEP_WIDTH), 1);
  assert.equal(search.prepareCrossFramePV(item.bundle.state, 50, 3), 0,
    "an unavailable width cannot borrow another width's principal record");
});

test("HP8 match generation terrain entity risk and non-successor states fail closed", () => {
  let item = advanceToRecordedSuccessor(3);
  assert.equal(item.engine.depthSearch.prepareCrossFramePV(item.bundle.state, 51, DEEP_WIDTH), 0);

  item = advanceToRecordedSuccessor(3); const state = item.bundle.state;
  const mark = state.beginTransition();
  state.write(ARRAY.SCALAR, SCALAR.TOPOLOGY_VERSION,
    state.arrays[ARRAY.SCALAR][SCALAR.TOPOLOGY_VERSION] + 1);
  assert.equal(item.engine.depthSearch.prepareCrossFramePV(state, 50, DEEP_WIDTH), 0);
  state.undoTo(mark);

  item = advanceToRecordedSuccessor(3); const entityState = item.bundle.state;
  const entityMark = entityState.beginTransition();
  entityState.write(ARRAY.SCALAR, SCALAR.NEXT_ENTITY,
    entityState.arrays[ARRAY.SCALAR][SCALAR.NEXT_ENTITY] + 1);
  assert.equal(item.engine.depthSearch.prepareCrossFramePV(entityState, 50, DEEP_WIDTH), 0);
  entityState.undoTo(entityMark);

  item = advanceToRecordedSuccessor(3);
  item.engine.depthSearch.resetPrincipalMatch();
  assert.equal(item.engine.depthSearch.prepareCrossFramePV(
    item.bundle.state, 50, DEEP_WIDTH), 0);
});

test("HP8 PV on and off preserve complete values actions intervals and root restore", () => {
  const enabled = advanceToRecordedSuccessor(5, true, true);
  const disabled = advanceToRecordedSuccessor(5, false);
  const withPV = reroot(enabled); const withoutPV = reroot(disabled);
  assert.equal(withPV.depth, withoutPV.depth);
  assert.equal(withPV.action, withoutPV.action);
  assert.equal(withPV.value, withoutPV.value);
  assert.deepEqual(withPV.rootScore, withoutPV.rootScore);
  assert.deepEqual(withPV.cells, withoutPV.cells);
  assert.equal(enabled.engine.depthSearch.rootRestoreFailures, 0);
  assert.equal(disabled.engine.depthSearch.rootRestoreFailures, 0);
});

test("diagnostic policy prior changes root order but not complete minimax values", () => {
  const baseline = rootFixture(5, false); const ordered = rootFixture(5, false);
  const baselineSearch = baseline.engine.depthSearch;
  const orderedSearch = ordered.engine.depthSearch;
  const preferredRow = Math.min(1, ordered.ourCount - 1);
  const preferredAction = ordered.engine.ourActions[preferredRow];
  const preferredArgument = ordered.engine.ourArguments[preferredRow];
  orderedSearch.setDiagnosticRootPrior(preferredAction, preferredArgument, 1);
  const baselineDepth = baselineSearch.search(baseline.bundle,
    baseline.engine.ourActions, baseline.engine.ourArguments, baseline.ourCount,
    baseline.engine.enemyActions, baseline.engine.enemyArguments,
    baseline.engine.enemyCount, 2, 100000, 50);
  const orderedDepth = orderedSearch.search(ordered.bundle,
    ordered.engine.ourActions, ordered.engine.ourArguments, ordered.ourCount,
    ordered.engine.enemyActions, ordered.engine.enemyArguments,
    ordered.engine.enemyCount, 2, 100000, 50);
  assert.equal(orderedSearch.diagnosticRootPriorActive, 1);
  assert.equal(ordered.engine.ourActions[orderedSearch.rootRowOrder[0]], preferredAction);
  assert.equal(ordered.engine.ourArguments[orderedSearch.rootRowOrder[0]], preferredArgument);
  assert.equal(orderedDepth, baselineDepth);
  assert.equal(orderedSearch.bestValue, baselineSearch.bestValue);
  assert.deepEqual(Array.from(orderedSearch.rootScore.slice(0, ordered.ourCount)),
    Array.from(baselineSearch.rootScore.slice(0, baseline.ourCount)));
  assert.deepEqual(Array.from(orderedSearch.rootCellScore.slice(0,
    ordered.ourCount * ordered.engine.enemyCount)),
  Array.from(baselineSearch.rootCellScore.slice(0,
    baseline.ourCount * baseline.engine.enemyCount)));
  assert.equal(orderedSearch.rootRestoreFailures, 0);
  orderedSearch.clearDiagnosticRootPrior();
  assert.equal(orderedSearch.diagnosticRootPriorPrepared, 0);
});

test("seed-only policy prior yields to the first complete search principal", () => {
  const item = rootFixture(5, false); const search = item.engine.depthSearch;
  const preferredRow = Math.min(1, item.ourCount - 1);
  search.setDiagnosticRootPrior(item.engine.ourActions[preferredRow],
    item.engine.ourArguments[preferredRow], 1, 1);
  search.search(item.bundle, item.engine.ourActions, item.engine.ourArguments,
    item.ourCount, item.engine.enemyActions, item.engine.enemyArguments,
    item.engine.enemyCount, 2, 100000, 50);
  assert.equal(search.diagnosticRootPriorPromoteCount, 1);
  assert.equal(search.diagnosticRootPriorActive, 0);
  assert.equal(search.publishedRootOrderActive, 1);
  assert.equal(search.rootRowOrder[0], search.representativeBestRow);
  assert.equal(search.rootRestoreFailures, 0);
});

test("diagnostic policy prior fails closed on an ambiguous action", () => {
  const item = rootFixture(5, false); const search = item.engine.depthSearch;
  assert.ok(item.ourCount > 1);
  const action = item.engine.ourActions[0];
  let duplicate = -1;
  for (let row = 1; row < item.ourCount; row += 1)
    if (item.engine.ourActions[row] === action) { duplicate = row; break; }
  if (duplicate < 0) {
    item.engine.ourActions[1] = action;
    item.engine.ourArguments[1] = item.engine.ourArguments[0] + 1;
  }
  search.setDiagnosticRootPrior(action);
  search.search(item.bundle, item.engine.ourActions, item.engine.ourArguments,
    item.ourCount, item.engine.enemyActions, item.engine.enemyArguments,
    item.engine.enemyCount, 1, 100000, 50);
  assert.equal(search.diagnosticRootPriorActive, 0);
  assert.ok(search.diagnosticRootPriorAmbiguousCount > 0);
});

test("HP8 PV structures are fixed integer slabs with zero declared hot allocation", () => {
  const engine = new ProductionRootEngine(); const search = engine.depthSearch;
  for (const array of [search.frameWorstColumn, search.frameBestEnemyColumn,
    search.framePrincipalEntry, search.rootRowOrder, search.rootEnemyOrder,
    engine.rootTransitions.principalEntry,
    engine.rootTransitions.principalRecordGeneration,
    engine.rootTransitions.principalDepth, engine.rootTransitions.principalAction,
    engine.rootTransitions.principalArgument, engine.rootTransitions.principalEnemyAction,
    engine.rootTransitions.principalEnemyArgument, engine.rootTransitions.principalRisk,
    engine.rootTransitions.principalWidth, engine.rootTransitions.principalTopology,
    engine.rootTransitions.principalNextEntity])
    assert.ok(ArrayBuffer.isView(array));
  assert.equal(search.hotAllocationCount, 0);
  assert.equal(engine.rootTransitions.hotAllocationCount, 0);
});

test("HP8 compact principal slab reports capacity overflow instead of overwriting evidence", () => {
  const item = rootFixture(0); const slab = item.engine.rootTransitions;
  const capacity = slab.principalEntry.length;
  for (let entry = 0; entry <= capacity; entry += 1) {
    slab.entryGeneration[entry] = slab.generation;
    slab.storePrincipal(entry, item.bundle.state, 1, ACTION.GO, 0xffff,
      ACTION.NONE, 0xffff, 50, 2);
  }
  assert.equal(slab.principalRecordCount, capacity);
  assert.equal(slab.principalOverflowCount, 1);
  assert.equal(slab.hasPrincipalEntry(capacity), 0);
});
