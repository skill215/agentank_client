"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { ProductionDepthSearch, DEPTH_VALUE_MIN, DEPTH_VALUE_MAX,
  ROOT_INTERVAL_STATUS } = require("../../engine-v2/src/search/production-depth-search");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { ACTION, FAST_STATUS, HARD_STATUS, TERMINAL } =
  require("../../engine-v2/src/abi/fast-codes");
const { productionRootFixture } = require("../../tools/agentank/build/imp6-builder");
const { preparedScenario } = require(
  "../../tools/agentank/diagnostics/minimax-depth-calibration");
const { search } = require("./helpers");

function preparedRoot() {
  const fixture = productionRootFixture(); fixture.enemy.status.fireLocked = true;
  const engine = new ProductionRootEngine();
  const adapted = engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
  engine.generateActions();
  const ourCount = engine.ourCount > 1 && engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
    engine.ourCount - 1 : engine.ourCount;
  return { engine, bundle: adapted.bundle, ourCount,
    rootSignature: adapted.bundle.state.rootSignature() };
}

function fullySupportedPreparedRoot() {
  const prepared = preparedRoot();
  prepared.engine.ourActions[0] = ACTION.TURN_LEFT;
  prepared.engine.ourActions[1] = ACTION.TURN_RIGHT;
  prepared.engine.enemyActions[0] = ACTION.NONE;
  prepared.engine.enemyActions[1] = ACTION.TURN_LEFT;
  prepared.ourCount = 2;
  prepared.engine.enemyCount = 2;
  return prepared;
}

function configureIteration(prepared, depth, budget, expansionLimit = 2,
    ourCount = prepared.ourCount, enemyCount = prepared.engine.enemyCount) {
  const value = new ProductionDepthSearch(new ProductionCacheBank());
  value.rootTransitions.setEnabled(false);
  value.rootActions = prepared.engine.ourActions;
  value.rootArguments = prepared.engine.ourArguments;
  value.rootOurCount = ourCount;
  value.rootEnemyActions = prepared.engine.enemyActions;
  value.rootEnemyArguments = prepared.engine.enemyArguments;
  value.rootEnemyCount = enemyCount;
  value.resetRoot(); value.baseRisk = 50; value.beginWorkMeter(prepared.bundle, 0);
  const completed = value.runIteration(prepared.bundle, depth, budget, expansionLimit);
  return { value, completed };
}

function independentOnePly(prepared, value) {
  const cells = new Int32Array(prepared.ourCount * prepared.engine.enemyCount);
  for (let row = 0; row < prepared.ourCount; row += 1) {
    for (let column = 0; column < prepared.engine.enemyCount; column += 1) {
      const action0 = prepared.engine.ourActions[row];
      const argument0 = prepared.engine.ourArguments[row];
      const action1 = prepared.engine.enemyActions[column];
      const argument1 = prepared.engine.enemyArguments[column];
      const ownChance = prepared.bundle.hard.chanceAlternativeCount(0, action0);
      const enemyChance = prepared.bundle.hard.chanceAlternativeCount(1, action1);
      let sum = 0; let worst = DEPTH_VALUE_MAX;
      for (let chance = 0; chance < ownChance * enemyChance; chance += 1) {
        const status = prepared.bundle.kernel.applyFrame(action0, argument0, action1, argument1,
          chance % ownChance, Math.floor(chance / ownChance));
        let score = -22000;
        if (status === FAST_STATUS.APPLIED || status === FAST_STATUS.APPLIED_TERMINAL) {
          const mark = prepared.bundle.kernel.lastMark;
          const hard = prepared.bundle.hard.classifyApplied();
          const terminal = prepared.bundle.hard.lastTerminal;
          if (hard === HARD_STATUS.REJECT_POLICY) score = -27500;
          else if (terminal && terminal !== TERMINAL.INCOMPLETE)
            score = value.terminalValue(terminal, 1);
          else if (hard === HARD_STATUS.REJECT_PROVEN) score = -28050;
          else if (hard === HARD_STATUS.INCOMPLETE) score = value.heuristic(
            prepared.bundle.state) - 6000;
          else score = value.heuristic(prepared.bundle.state);
          prepared.bundle.state.undoTo(mark);
        }
        sum += score; if (score < worst) worst = score;
      }
      cells[row * prepared.engine.enemyCount + column] = value.robustChance(sum, worst,
        ownChance * enemyChance);
    }
  }
  return cells;
}

test("HP5 fully-supported full-width one-ply cells equal an independent Fast/Hard oracle", () => {
  const prepared = fullySupportedPreparedRoot();
  // Four deterministic cells exactly fill this matrix.  Keeping no surplus
  // budget also isolates the one-ply Fast/Hard contract from the optional
  // direct-fire tactical extension.
  const { value, completed } = configureIteration(prepared, 1, 4);
  assert.equal(completed, 1);
  assert.equal(value.attemptIntervalStatus, ROOT_INTERVAL_STATUS.COMPLETE);
  assert.equal(value.attemptIntervalDepth, 1);
  const oracle = independentOnePly(prepared, value);
  let oracleRoot = DEPTH_VALUE_MIN;
  for (let row = 0; row < prepared.ourCount; row += 1) {
    let rowMinimum = DEPTH_VALUE_MAX;
    for (let column = 0; column < prepared.engine.enemyCount; column += 1) {
      const compact = row * prepared.engine.enemyCount + column;
      const cell = row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column;
      assert.equal(value.iterationCellScore[cell], oracle[compact]);
      assert.equal(value.attemptCellLower[cell], oracle[compact]);
      assert.equal(value.attemptCellUpper[cell], oracle[compact]);
      if (oracle[compact] < rowMinimum) rowMinimum = oracle[compact];
    }
    assert.equal(value.attemptRowLower[row], rowMinimum);
    assert.equal(value.attemptRowUpper[row], rowMinimum);
    if (rowMinimum > oracleRoot) oracleRoot = rowMinimum;
  }
  assert.equal(value.attemptRootLower, oracleRoot);
  assert.equal(value.attemptRootUpper, oracleRoot);
  value.commitIteration(prepared.ourCount, 1);
  assert.equal(value.representativeSupportComplete, 1,
    "a full matrix with no representative truncation owns an exact support certificate");
  assert.equal(prepared.bundle.state.rootSignature(), prepared.rootSignature);
});

test("HP5 every strict Physical budget prefix contains the eventual depth-two value", () => {
  const exactPrepared = fullySupportedPreparedRoot();
  const exact = configureIteration(exactPrepared, 2, 512, 2, 2, 2);
  assert.equal(exact.completed, 1);
  assert.equal(exact.value.attemptIntervalStatus, ROOT_INTERVAL_STATUS.COMPLETE);
  const exactCells = Int32Array.from(exact.value.iterationCellScore);
  const exactRoot = exact.value.attemptRootLower;
  const fullNodes = exact.value.nodes;
  assert.ok(fullNodes > 4 && fullNodes < 128);

  for (let budget = 0; budget < fullNodes; budget += 1) {
    const prepared = fullySupportedPreparedRoot();
    const hardOwnership = Uint8Array.from(prepared.engine.hardStatus);
    const proofOwnership = prepared.engine.lastProofStatus;
    const result = configureIteration(prepared, 2, budget, 2, 2, 2);
    assert.equal(result.completed, 0, `budget=${budget}`);
    assert.equal(result.value.attemptIntervalStatus, ROOT_INTERVAL_STATUS.INCOMPLETE,
      `budget=${budget}`);
    for (let row = 0; row < 2; row += 1) for (let column = 0; column < 2; column += 1) {
      const cell = row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column;
      assert.ok(result.value.attemptCellLower[cell] <= exactCells[cell],
        `lower budget=${budget} cell=${cell}`);
      assert.ok(exactCells[cell] <= result.value.attemptCellUpper[cell],
        `upper budget=${budget} cell=${cell}`);
    }
    assert.ok(result.value.attemptRootLower <= exactRoot, `root lower budget=${budget}`);
    assert.ok(exactRoot <= result.value.attemptRootUpper, `root upper budget=${budget}`);
    assert.deepEqual(prepared.engine.hardStatus, hardOwnership);
    assert.equal(prepared.engine.lastProofStatus, proofOwnership);
    assert.equal(prepared.bundle.state.rootSignature(), prepared.rootSignature);
  }
});

test("HP5 Hard-incomplete Physical cells stay full intervals instead of exact heuristics", () => {
  const prepared = preparedRoot();
  const classify = prepared.bundle.hard.classifyApplied;
  prepared.bundle.hard.classifyApplied = function incompleteHard() {
    this.lastStatus = HARD_STATUS.INCOMPLETE; this.lastTerminal = TERMINAL.INCOMPLETE;
    return HARD_STATUS.INCOMPLETE;
  };
  const result = configureIteration(prepared, 1, 32, 2, 1, 1);
  prepared.bundle.hard.classifyApplied = classify;
  assert.equal(result.completed, 1);
  assert.equal(result.value.attemptIntervalStatus, ROOT_INTERVAL_STATUS.INCOMPLETE);
  assert.equal(result.value.attemptCellLower[0], DEPTH_VALUE_MIN);
  assert.equal(result.value.attemptCellUpper[0], DEPTH_VALUE_MAX);
  assert.equal(result.value.attemptRootLower, DEPTH_VALUE_MIN);
  assert.equal(result.value.attemptRootUpper, DEPTH_VALUE_MAX);
  result.value.commitIteration(1, 1);
  assert.equal(result.value.representativeSupportComplete, 0,
    "zero width truncation cannot hide an INCOMPLETE Physical cell");
  assert.equal(prepared.bundle.state.rootSignature(), prepared.rootSignature);
});

function scheduledScenario(index, cacheEnabled = true, options = null) {
  const prepared = preparedScenario(index, false);
  const value = new ProductionDepthSearch(new ProductionCacheBank(), undefined,
    prepared.engine.rootTransitions, options);
  value.cache.setEnabled(cacheEnabled); value.rootTransitions.setEnabled(false);
  value.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 2, 512, 50, 60000);
  return { prepared, value,
    scores: Array.from(value.rootScore.slice(0, prepared.ourCount)),
    cells: Array.from(value.rootCellScore.slice(0,
      prepared.ourCount * SEARCH_CAPACITY.MAX_ENEMY_POLICIES)) };
}

test("HP10 direct schedule retains the deepest exact owner under incomplete deeper work", () => {
  const retained = scheduledScenario(0);
  assert.equal(retained.value.completedDepth, 1);
  assert.equal(retained.value.attemptedDepth, 2);
  assert.equal(retained.value.representativeSupportComplete, 1);
  assert.equal(retained.value.representativeSupportDepth, 1);
  assert.equal(retained.value.representativeSupportExpansionLimit, 4);
  assert.equal(retained.value.rootScore[retained.value.bestRow], retained.value.bestValue);

  const replaced = scheduledScenario(1);
  assert.equal(replaced.value.completedDepth, 2);
  assert.equal(replaced.value.representativeSupportComplete, 1);
  assert.equal(replaced.value.representativeSupportDepth, 2);
  assert.equal(replaced.value.representativeSupportExpansionLimit, 4);
  assert.equal(replaced.value.rootScore[replaced.value.bestRow], replaced.value.bestValue);

  for (const index of [0, 1]) {
    const enabled = index === 0 ? retained : replaced;
    const disabled = scheduledScenario(index, false);
    assert.deepEqual(disabled.scores, enabled.scores, `cache scores scenario=${index}`);
    assert.deepEqual(disabled.cells, enabled.cells, `cache cells scenario=${index}`);
    assert.equal(disabled.value.representativeSupportDepth,
      enabled.value.representativeSupportDepth, `cache depth scenario=${index}`);
    assert.equal(disabled.value.bestRow, enabled.value.bestRow, `cache row scenario=${index}`);
    assert.equal(disabled.value.bestValue, enabled.value.bestValue,
      `cache value scenario=${index}`);
    assert.equal(disabled.value.rootRestoreFailures, 0);
  }
});

test("HP10/HP30 full-width P1 then P2 publishes exact support for 15 of 16 fixed roots", () => {
  let exact = 0; let depthOne = 0; let depthTwo = 0; let unresolved = 0;
  for (let index = 0; index < 16; index += 1) {
    const result = scheduledScenario(index);
    assert.equal(result.value.rootRestoreFailures, 0, `restore scenario=${index}`);
    if (!result.value.representativeSupportComplete) { unresolved += 1; continue; }
    exact += 1;
    if (result.value.representativeSupportDepth === 1) depthOne += 1;
    if (result.value.representativeSupportDepth === 2) depthTwo += 1;
  }
  assert.deepEqual({ exact, depthOne, depthTwo, unresolved },
    { exact: 15, depthOne: 7, depthTwo: 8, unresolved: 1 });
  const movementContest = scheduledScenario(9);
  assert.equal(movementContest.value.representativeSupportComplete, 0,
    "unsupported simultaneous movement remains an interval, never a false certificate");
  assert.equal(movementContest.value.representativeSupportDepth, 0);
});

test("HP11 non-exact deeper attempts stop early without changing published values", () => {
  let earlyNodes = 0; let exhaustiveNodes = 0; let aborts = 0;
  let classifiedAborts = 0;
  for (let index = 0; index < 16; index += 1) {
    const early = scheduledScenario(index, true, { exactOwnerEarlyAbort: true });
    const exhaustive = scheduledScenario(index, true, { exactOwnerEarlyAbort: false });
    assert.deepEqual(early.scores, exhaustive.scores, `scores scenario=${index}`);
    assert.deepEqual(early.cells, exhaustive.cells, `cells scenario=${index}`);
    assert.equal(early.value.bestRow, exhaustive.value.bestRow, `row scenario=${index}`);
    assert.equal(early.value.bestValue, exhaustive.value.bestValue, `value scenario=${index}`);
    assert.equal(early.value.representativeSupportComplete,
      exhaustive.value.representativeSupportComplete, `support scenario=${index}`);
    assert.equal(early.value.representativeSupportDepth,
      exhaustive.value.representativeSupportDepth, `depth scenario=${index}`);
    assert.equal(early.value.rootRestoreFailures, 0);
    earlyNodes += early.value.nodes; exhaustiveNodes += exhaustive.value.nodes;
    aborts += early.value.exactOwnerEarlyAbortCount;
    classifiedAborts += early.value.lastNonExactAbortReason === 0 ? 0 : 1;
  }
  assert.equal(aborts, 7);
  assert.equal(classifiedAborts, aborts);
  assert.ok(earlyNodes * 100 <= exhaustiveNodes * 70,
    `expected at least 30% node reduction, got ${earlyNodes}/${exhaustiveNodes}`);
});

function contaminated(values, probabilities, risk) {
  let sumLower = 0; let sumUpper = 0; let worstLower = search.VALUE_MAX;
  let worstUpper = search.VALUE_MAX;
  for (let index = 0; index < values.length; index += 1) {
    sumLower += probabilities[index] * values[index][0];
    sumUpper += probabilities[index] * values[index][1];
    if (values[index][0] < worstLower) worstLower = values[index][0];
    if (values[index][1] < worstUpper) worstUpper = values[index][1];
  }
  const expectedLower = Math.floor(sumLower / 10000);
  const expectedUpper = Math.ceil(sumUpper / 10000); const lambda = 99 * risk;
  return [Math.floor((lambda * expectedLower + (10000 - lambda) * worstLower) / 10000),
    Math.ceil((lambda * expectedUpper + (10000 - lambda) * worstUpper) / 10000)];
}

function nestedCell(graph, template, risk) {
  const worlds = [];
  for (let world = 0; world < 2; world += 1) {
    const left = graph.addLeaf(template[world * 2], template[world * 2],
      { kind: search.LEAF_KIND.HORIZON_EXACT });
    const right = graph.addLeaf(template[world * 2 + 1], template[world * 2 + 1],
      { kind: search.LEAF_KIND.HORIZON_EXACT });
    worlds.push(graph.addNode(search.NODE_KIND.CHANCE_OUTCOME, [left, right], [2500, 7500]));
  }
  return graph.addNode(search.NODE_KIND.HIDDEN_WORLD, worlds, [5000, 5000],
    { riskClass: 0, risk });
}

test("HP5 nested Chance/HiddenWorld/Simultaneous intervals match an independent oracle", () => {
  const templates = [[-9000, -3000, 1000, 7000], [-7000, 5000, -1000, 9000],
    [-5000, -5000, 5000, 5000], [-10000, 10000, -8000, 8000]];
  const probabilitiesChance = [2500, 7500]; const probabilitiesWorld = [5000, 5000];
  let cases = 0;
  for (const risk of [0, 50, 100]) {
    for (let code = 0; code < 256; code += 1) {
      const graph = new search.InformationGraph(); const children = [];
      const oracleCells = []; let value = code;
      for (let cell = 0; cell < 4; cell += 1) {
        const template = templates[value & 3]; value >>= 2;
        children.push(nestedCell(graph, template, risk));
        const worldIntervals = [];
        for (let world = 0; world < 2; world += 1)
          worldIntervals.push(contaminated([[template[world * 2], template[world * 2]],
            [template[world * 2 + 1], template[world * 2 + 1]]],
          probabilitiesChance, risk));
        oracleCells.push(contaminated(worldIntervals, probabilitiesWorld, risk));
      }
      const root = graph.addSimultaneous(2, 2, children);
      const solved = new search.ValueSearch(graph);
      assert.equal(solved.solve(root, 64, risk), search.SEARCH_STATUS.COMPLETE);
      const lower = Math.max(Math.min(oracleCells[0][0], oracleCells[1][0]),
        Math.min(oracleCells[2][0], oracleCells[3][0]));
      const upper = Math.min(Math.max(oracleCells[0][1], oracleCells[2][1]),
        Math.max(oracleCells[1][1], oracleCells[3][1]));
      assert.deepEqual([solved.lower[root], solved.upper[root]], [lower, upper]);
      assert.equal(solved.complete[root], 1); cases += 1;
    }
  }
  assert.equal(cases, 768);
});

test("HP5 strict graph budget prefixes remain intervals and cannot create strict Proof", () => {
  const graph = new search.InformationGraph(); const children = [];
  for (let index = 0; index < 4; index += 1)
    children.push(nestedCell(graph, [-9000, 3000, -1000, 8000], 50));
  const root = graph.addSimultaneous(2, 2, children);
  const exact = new search.ValueSearch(graph); exact.solve(root, 128, 50);
  const reachable = exact.visitedNodes;
  for (let budget = 0; budget < reachable; budget += 1) {
    const value = new search.ValueSearch(graph);
    assert.equal(value.solve(root, budget, 50), search.SEARCH_STATUS.INCOMPLETE);
    assert.ok(value.lower[root] <= exact.lower[root]);
    assert.ok(exact.upper[root] <= value.upper[root]);
    const proof = new search.ProofSearch(graph);
    assert.equal(proof.solve(root, search.PROOF_GOAL.FORCED_WIN, budget),
      search.PROOF_STATUS.UNKNOWN);
  }
});
