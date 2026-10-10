"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ContenderFrontier, FRONTIER_STATUS } =
  require("../../engine-v2/src/search/contender-frontier");
const { ProductionDepthSearch, DEPTH_VALUE_MIN, DEPTH_VALUE_MAX } =
  require("../../engine-v2/src/search/production-depth-search");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { CACHE_ID } = require("../../engine-v2/src/abi/cache-runtime-codes");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { benchmarkFixture } = require("../../tools/agentank/benchmark/search-frontier-benchmark");

function exactBest(matrix, rows, columns) {
  let value = DEPTH_VALUE_MIN; let best = 0;
  for (let row = 0; row < rows; row += 1) {
    let worst = DEPTH_VALUE_MAX;
    for (let column = 0; column < columns; column += 1)
      if (matrix[row * columns + column] < worst) worst = matrix[row * columns + column];
    if (worst > value) { value = worst; best = row; }
  }
  return { row: best, value };
}

function selectiveMatrix(matrix, shallowRows, shallowCells, rows, columns) {
  const frontier = new ContenderFrontier(); const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
  const lower = new Int32Array(rows * stride); const upper = new Int32Array(rows * stride);
  lower.fill(DEPTH_VALUE_MIN); upper.fill(DEPTH_VALUE_MAX);
  frontier.prepareOrder(shallowRows, shallowCells, rows, columns);
  let incumbent = DEPTH_VALUE_MIN; let incumbentRow = 255;
  for (let order = 0; order < rows; order += 1) {
    const row = frontier.actualRow(order); let worst = DEPTH_VALUE_MAX;
    for (let columnOrder = 0; columnOrder < columns; columnOrder += 1) {
      const column = frontier.actualColumn(row, columnOrder);
      const value = matrix[row * columns + column]; const at = row * stride + column;
      lower[at] = value; upper[at] = value; if (value < worst) worst = value;
      if (order > 0 && frontier.canPrune(row, worst, incumbent, incumbentRow)) break;
    }
    if (worst > incumbent || worst === incumbent && row < incumbentRow) {
      incumbent = worst; incumbentRow = row;
    }
  }
  frontier.update(lower, upper, rows, columns); return frontier;
}

test("HP6 exhaustive root branch-and-bound never misidentifies a max-min action", () => {
  const values = [-2, 0, 2]; let cases = 0;
  for (let encoded = 0; encoded < 6561; encoded += 1) {
    let code = encoded; const matrix = new Int32Array(8);
    for (let at = 0; at < matrix.length; at += 1) {
      matrix[at] = values[code % values.length]; code = Math.floor(code / values.length);
    }
    const shallowRows = new Int32Array([matrix[1], matrix[7], matrix[2], matrix[4]]);
    const shallowCells = new Int32Array(4 * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    for (let row = 0; row < 4; row += 1)
      for (let column = 0; column < 2; column += 1)
        shallowCells[row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column] =
          matrix[((row + 1) & 3) * 2 + (column ^ 1)];
    const expected = exactBest(matrix, 4, 2);
    const actual = selectiveMatrix(matrix, shallowRows, shallowCells, 4, 2);
    assert.equal(actual.status, FRONTIER_STATUS.ACTION_RESOLVED, `case=${encoded}`);
    assert.equal(actual.provenRow, expected.row, `row case=${encoded}`);
    assert.equal(actual.provenValue, expected.value, `value case=${encoded}`); cases += 1;
  }
  assert.equal(cases, 6561);
});

function prepared(index) {
  const fixture = benchmarkFixture(index);
  const engine = new ProductionRootEngine({ diagnosticRootTransitionSlab: false });
  const adapted = engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
  engine.generateActions(); let ourCount = engine.ourCount;
  if (ourCount > 1 && engine.ourActions[ourCount - 1] === ACTION.NONE) ourCount -= 1;
  return { engine, bundle: adapted.bundle, ourCount,
    signature: adapted.bundle.state.rootSignature() };
}

function seeded(prepared) {
  const search = new ProductionDepthSearch(new ProductionCacheBank());
  search.rootTransitions.setEnabled(false);
  search.rootActions = prepared.engine.ourActions;
  search.rootArguments = prepared.engine.ourArguments;
  search.rootOurCount = prepared.ourCount;
  search.rootEnemyActions = prepared.engine.enemyActions;
  search.rootEnemyArguments = prepared.engine.enemyArguments;
  search.rootEnemyCount = prepared.engine.enemyCount;
  search.resetRoot(); search.baseRisk = 50; search.beginWorkMeter(prepared.bundle, 0);
  assert.equal(search.runIteration(prepared.bundle, 1, 100000, 2), 1);
  search.commitIteration(prepared.ourCount, 1); return search;
}

test("HP6 selective depth two matches every resolved full search and cuts over thirty percent", () => {
  let fullNodes = 0; let selectiveNodes = 0; let resolved = 0; let unsupported = 0;
  for (let index = 0; index < 16; index += 1) {
    let state = prepared(index); const full = seeded(state); let before = full.nodes;
    assert.equal(full.runIteration(state.bundle, 2, 100000, 2), 1);
    const expectedRow = full.bestRow; const expectedValue = full.bestValue;
    fullNodes += full.nodes - before;
    assert.equal(state.bundle.state.rootSignature(), state.signature);

    state = prepared(index); const selective = seeded(state); before = selective.nodes;
    const complete = selective.runSelectiveIteration(state.bundle, 2, 100000, 2);
    selectiveNodes += selective.nodes - before;
    if (complete) {
      resolved += 1; assert.equal(selective.selectiveBestRow, expectedRow);
      assert.equal(selective.selectiveBestValue, expectedValue);
    } else {
      unsupported += 1;
      assert.notEqual(selective.contender.status, FRONTIER_STATUS.ACTION_RESOLVED);
    }
    assert.equal(state.bundle.state.rootSignature(), state.signature);
    assert.equal(selective.rootRestoreFailures, 0);
  }
  assert.equal(resolved, 15); assert.equal(unsupported, 1);
  assert.ok(selectiveNodes * 100 <= fullNodes * 70,
    `full=${fullNodes} selective=${selectiveNodes}`);
});

test("HP6 every selective budget prefix fails closed until the stable action is proved", () => {
  let state = prepared(0); const exact = seeded(state);
  assert.equal(exact.runSelectiveIteration(state.bundle, 2, 100000, 2), 1);
  const nodes = exact.lastSelectiveNodes; const expectedRow = exact.selectiveBestRow;
  const expectedValue = exact.selectiveBestValue;
  for (let budget = 0; budget < nodes; budget += 1) {
    state = prepared(0); const partial = seeded(state); const limit = partial.nodes + budget;
    const complete = partial.runSelectiveIteration(state.bundle, 2, limit, 2);
    if (complete) {
      assert.equal(partial.selectiveBestRow, expectedRow);
      assert.equal(partial.selectiveBestValue, expectedValue);
    } else assert.notEqual(partial.contender.status, FRONTIER_STATUS.ACTION_RESOLVED);
    assert.equal(state.bundle.state.rootSignature(), state.signature);
  }
});

test("HP6 production search stays full-matrix until selective evidence owns a contract", () => {
  const state = prepared(3); const search = new ProductionDepthSearch(new ProductionCacheBank());
  search.runSelectiveIteration = () => { throw new Error("selective path unexpectedly owned production"); };
  assert.ok(search.search(state.bundle, state.engine.ourActions, state.engine.ourArguments,
    state.ourCount, state.engine.enemyActions, state.engine.enemyArguments,
    state.engine.enemyCount, 3, 256, 50) > 0);
  assert.equal(state.bundle.state.rootSignature(), state.signature);
});

test("HP6 ProductionRoot enables selective continuation and retains an explicit diagnostic off switch", () => {
  const enabled = new ProductionRootEngine();
  const disabled = new ProductionRootEngine({ diagnosticSelectiveContinuation: false });
  assert.equal(enabled.depthSearch.selectiveContinuationEnabled, 1);
  assert.equal(disabled.depthSearch.selectiveContinuationEnabled, 0);
});

test("HP6 frontier uses only fixed integer slabs and reports zero hot allocation", () => {
  const frontier = new ContenderFrontier();
  for (const value of [frontier.rowOrder, frontier.columnOrder, frontier.rowLower,
    frontier.rowUpper, frontier.worstCompletedResponse, frontier.unresolvedResponseCount,
    frontier.member]) assert.ok(ArrayBuffer.isView(value));
  assert.equal(frontier.hotAllocationCount, 0);
});

function liveSlots(cache) {
  let count = 0;
  for (let slot = 0; slot < cache.entryCount; slot += 1)
    if (cache.valid[slot] && cache.generation[slot] === cache.currentGeneration) count += 1;
  return count;
}

test("HP6 Information continuation owns a separate TT and restores Physical cache", () => {
  const state = prepared(5); const bank = new ProductionCacheBank();
  const search = new ProductionDepthSearch(bank);
  const physical = bank.get(CACHE_ID.PHYSICAL_VALUE_TT);
  const information = bank.get(CACHE_ID.INFORMATION_VALUE_TT);
  assert.equal(search.cache, physical);
  const physicalBefore = liveSlots(physical); const informationBefore = liveSlots(information);
  const value = search.continuationValue(state.bundle, 2, 512, 50, 1);
  assert.ok(Number.isSafeInteger(value));
  assert.equal(search.cache, physical);
  assert.equal(liveSlots(physical), physicalBefore,
    "Information continuation must not publish into Physical root TT");
  assert.ok(liveSlots(information) > informationBefore,
    "a completed Information continuation must publish only into its own TT");
  assert.equal(state.bundle.state.rootSignature(), state.signature);
});

test("HP6 partial Physical root cache cannot perturb Information continuation", () => {
  let state = prepared(7); const pollutedBank = new ProductionCacheBank();
  const polluted = seeded(state); polluted.cacheBank = pollutedBank;
  polluted.cache = pollutedBank.get(CACHE_ID.PHYSICAL_VALUE_TT);
  // Interrupt a full root after it has had enough work to publish child nodes.
  polluted.runIteration(state.bundle, 3, polluted.nodes + 96, 2);
  assert.ok(liveSlots(pollutedBank.get(CACHE_ID.PHYSICAL_VALUE_TT)) > 0);
  const pollutedValue = polluted.continuationValue(state.bundle, 2, 512, 50, 1);
  const pollutedDepth = polluted.lastContinuationCompletedDepth;
  const pollutedComplete = polluted.lastContinuationComplete;
  assert.equal(state.bundle.state.rootSignature(), state.signature);

  state = prepared(7); const cleanBank = new ProductionCacheBank();
  const clean = new ProductionDepthSearch(cleanBank);
  const cleanValue = clean.continuationValue(state.bundle, 2, 512, 50, 1);
  assert.equal(cleanValue, pollutedValue);
  assert.equal(clean.lastContinuationCompletedDepth, pollutedDepth);
  assert.equal(clean.lastContinuationComplete, pollutedComplete);
  assert.equal(state.bundle.state.rootSignature(), state.signature);
});
