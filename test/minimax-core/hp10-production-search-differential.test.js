"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionDepthSearch, DEPTH_VALUE_MIN, DEPTH_VALUE_MAX,
  ROOT_INTERVAL_STATUS } = require("../../engine-v2/src/search/production-depth-search");
const { ProductionInformationSearch, INFORMATION_VALUE_MAX } =
  require("../../engine-v2/src/search/production-information-search");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { RiskAcceptanceController } =
  require("../../engine-v2/src/search/risk-acceptance-controller");
const { SafetyOutcomeSlab, SAFETY_STATUS } =
  require("../../engine-v2/src/search/information-safety-closure");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { ACTION, FAST_STATUS, HARD_STATUS, TERMINAL, NONE_CELL } =
  require("../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { VALUE_MIN } = require("../../engine-v2/src/abi/search-codes");
const { STRATEGY, STRATEGY_PURPOSE } =
  require("../../engine-v2/src/abi/policy-codes");
const { StrategyBandSlab } = require("../../engine-v2/src/policy/strategy-layer");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");

const ROOT_ACTIONS = Uint8Array.from([
  ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT, ACTION.FIRE
]);
const ROOT_ARGUMENTS = new Uint16Array(ROOT_ACTIONS.length).fill(NONE_CELL);
const DIRECTIONS = Object.freeze(["up", "right", "down", "left"]);

function fixture(index) {
  const map = boxedMap(7, 7);
  const own = [1 + index % 2, 1 + Math.floor(index / 2) % 3];
  const enemy = [5 - Math.floor(index / 6) % 2, 5 - Math.floor(index / 12) % 3];
  const blocked = [3, 1 + index % 5];
  if ((blocked[0] !== own[0] || blocked[1] !== own[1]) &&
      (blocked[0] !== enemy[0] || blocked[1] !== enemy[1])) map[blocked[0]][blocked[1]] = "m";
  const frame = index % 5;
  const stunOwn = index % 11 === 0 ? frame + 2 : null;
  const stunEnemy = index % 13 === 0 ? frame + 2 : null;
  return fast.createFastPhysical(physical({ platformFrame: frame,
    map: { width: 7, height: 7, terrainColumnMajor: map },
    tanks: [tank(0, own, DIRECTIONS[index & 3], {
      stars: index % 3, stunUntilFrame: stunOwn, skillReadyFrame: 255 }),
    tank(1, enemy, DIRECTIONS[(index * 3 + 1) & 3], {
      stars: (index >> 1) % 3, stunUntilFrame: stunEnemy, skillReadyFrame: 255 })],
    star: index % 4 === 0 ? null : [1 + index % 5, 1 + (index * 3) % 5]
  }));
}

class IndependentPhysicalOracle {
  constructor(baseRisk, width) {
    this.baseRisk = baseRisk;
    this.width = width;
    this.helper = new ProductionDepthSearch(new ProductionCacheBank());
    this.helper.baseRisk = baseRisk;
    this.helper.iterationExpansionLimit = width;
    this.incomplete = 0;
  }

  leaf(bundle, depth, action0, argument0, action1, argument1) {
    const ownChance = this.helper.chanceAlternatives(bundle.state, 0, action0);
    const enemyChance = this.helper.chanceAlternatives(bundle.state, 1, action1);
    const count = ownChance * enemyChance;
    let sum = 0;
    let worst = DEPTH_VALUE_MAX;
    for (let chance = 0; chance < count; chance += 1) {
      const status = bundle.kernel.applyFrame(action0, argument0, action1, argument1,
        chance % ownChance, Math.floor(chance / ownChance));
      let value = -22000;
      if (status === FAST_STATUS.APPLIED || status === FAST_STATUS.APPLIED_TERMINAL) {
        const mark = bundle.kernel.lastMark;
        const hard = bundle.hard.classifyApplied();
        const terminal = bundle.hard.lastTerminal;
        if (hard === HARD_STATUS.REJECT_POLICY) value = -27500;
        else if (terminal && terminal !== TERMINAL.INCOMPLETE)
          value = this.helper.terminalValue(terminal, depth);
        else if (hard === HARD_STATUS.REJECT_PROVEN) value = -28000 - depth * 50;
        else if (hard === HARD_STATUS.INCOMPLETE) {
          value = this.helper.heuristic(bundle.state) - 6000;
          this.incomplete += 1;
        } else if (depth <= 1) value = this.helper.heuristic(bundle.state);
        else value = this.matrix(bundle, depth - 1).value;
        bundle.state.undoTo(mark);
      }
      sum += value;
      if (value < worst) worst = value;
    }
    return this.helper.robustChance(sum, worst, count);
  }

  matrix(bundle, depth) {
    const top = depth;
    this.helper.generateDeep(top, bundle.state, 0);
    this.helper.generateDeep(top, bundle.state, 1);
    const ownCount = this.helper.frameOurCount[top];
    const enemyCount = this.helper.frameEnemyCount[top];
    const offset = top * 4;
    let best = DEPTH_VALUE_MIN;
    let bestRow = 0;
    for (let row = 0; row < ownCount; row += 1) {
      let worst = DEPTH_VALUE_MAX;
      for (let column = 0; column < enemyCount; column += 1) {
        const value = this.leaf(bundle, depth,
          this.helper.deepOurActions[offset + row],
          this.helper.deepOurArguments[offset + row],
          this.helper.deepEnemyActions[offset + column],
          this.helper.deepEnemyArguments[offset + column]);
        if (value < worst) worst = value;
      }
      if (worst > best) { best = worst; bestRow = row; }
    }
    return { value: best, bestRow };
  }

  root(bundle, depth) {
    const cells = new Int32Array(ROOT_ACTIONS.length * ROOT_ACTIONS.length);
    const rows = new Int32Array(ROOT_ACTIONS.length);
    let best = DEPTH_VALUE_MIN;
    let bestRow = 0;
    for (let row = 0; row < ROOT_ACTIONS.length; row += 1) {
      let worst = DEPTH_VALUE_MAX;
      for (let column = 0; column < ROOT_ACTIONS.length; column += 1) {
        const value = this.leaf(bundle, depth, ROOT_ACTIONS[row], NONE_CELL,
          ROOT_ACTIONS[column], NONE_CELL);
        cells[row * ROOT_ACTIONS.length + column] = value;
        if (value < worst) worst = value;
      }
      rows[row] = worst;
      if (worst > best) { best = worst; bestRow = row; }
    }
    return { cells, rows, best, bestRow };
  }
}

function production(bundle, depth, baseRisk, width) {
  const search = new ProductionDepthSearch(new ProductionCacheBank());
  search.cache.setEnabled(false);
  search.rootTransitions.setEnabled(false);
  search.rootActions = ROOT_ACTIONS;
  search.rootArguments = ROOT_ARGUMENTS;
  search.rootOurCount = ROOT_ACTIONS.length;
  search.rootEnemyActions = ROOT_ACTIONS;
  search.rootEnemyArguments = ROOT_ARGUMENTS;
  search.rootEnemyCount = ROOT_ACTIONS.length;
  search.resetRoot();
  search.baseRisk = baseRisk;
  search.beginWorkMeter(bundle, 0);
  const complete = search.runIteration(bundle, depth, 8192, width);
  return { search, complete };
}

test("HP10 production Physical depth two matches an independent recursive oracle", () => {
  let cases = 0;
  for (const risk of [0, 50, 100]) {
    for (let index = 0; index < 48; index += 1) {
      const built = fixture(index);
      assert.equal(built.status, FAST_STATUS.APPLIED);
      const root = built.state.rootSignature();
      const expected = new IndependentPhysicalOracle(risk, 2).root(built, 2);
      assert.equal(built.state.rootSignature(), root);
      const actual = production(built, 2, risk, 2);
      assert.equal(actual.complete, 1, `risk=${risk} fixture=${index}`);
      assert.equal(actual.search.attemptIntervalStatus, ROOT_INTERVAL_STATUS.COMPLETE,
        `risk=${risk} fixture=${index}`);
      for (let row = 0; row < ROOT_ACTIONS.length; row += 1) {
        assert.equal(actual.search.iterationScore[row], expected.rows[row],
          `row risk=${risk} fixture=${index} row=${row}`);
        for (let column = 0; column < ROOT_ACTIONS.length; column += 1)
          assert.equal(actual.search.iterationCellScore[
            row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column],
          expected.cells[row * ROOT_ACTIONS.length + column],
          `cell risk=${risk} fixture=${index} row=${row} column=${column}`);
      }
      assert.equal(actual.search.bestValue, expected.best, `best risk=${risk} fixture=${index}`);
      assert.equal(actual.search.bestRow, expected.bestRow, `row risk=${risk} fixture=${index}`);
      assert.equal(actual.search.rootRestoreFailures, 0);
      assert.equal(built.state.rootSignature(), root);
      cases += 1;
    }
  }
  assert.equal(cases, 144);
});

function safeRows(count) {
  const safety = new SafetyOutcomeSlab(); safety.reset(count);
  for (let row = 0; row < count; row += 1) {
    safety.status[row] = SAFETY_STATUS.PROVEN_SAFE;
    safety.coverage[row] = 10000;
  }
  return safety;
}

function incompleteInformation(first, second) {
  const rootCellScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
    SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  rootCellScore[0] = first; rootCellScore[SEARCH_CAPACITY.MAX_ENEMY_POLICIES] = second;
  return { completedDepth: 1, supportComplete: 0, approximate: 1,
    rootScore: new Int32Array([first, second]), rootCellScore };
}

test("HP10 incomplete Information value cannot replace qualified tactical ownership", () => {
  const controller = new RiskAcceptanceController();
  const hard = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
  const tactical = new Int16Array([200, 100]);
  controller.populate(2, hard, safeRows(2), tactical, null,
    incompleteInformation(-2000, 2000), 1, null, 2);
  controller.gate(0, 0);
  assert.deepEqual(Array.from(controller.outcome.expectedValue.subarray(0, 2)), [200, 100]);
  assert.deepEqual(Array.from(controller.outcome.searchEstimate.subarray(0, 2)), [-800, 1100]);
  assert.equal(controller.outcome.searchEstimateEnabled, 0);
  assert.equal(controller.select(1), 0);
});

test("HP10 approximate search can rank only inside an already-qualified proposal class", () => {
  const controller = new RiskAcceptanceController({ softSearchProposalEvidence: true });
  const hard = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
  const tactical = new Int16Array([200, 100]);
  controller.populate(2, hard, safeRows(2), tactical, null,
    incompleteInformation(-2000, 2000), 1, null, 2);
  controller.gate(0, 0);
  assert.deepEqual(Array.from(controller.outcome.expectedValue.subarray(0, 2)), [200, 100]);
  assert.equal(controller.select(1), 0,
    "Risk fallback and global scalar selection cannot consume soft search evidence");
  const bands = new StrategyBandSlab(); bands.reset(2);
  bands.purpose[0] = STRATEGY_PURPOSE.DIRECT_KILL;
  bands.purpose[1] = STRATEGY_PURPOSE.DIRECT_KILL;
  controller.outcome.purposeCompleteness[0] = 8000;
  controller.outcome.purposeCompleteness[1] = 8000;
  assert.equal(Boolean(bands.proposalBetter(controller.outcome, 1, 0,
    STRATEGY.KILL_PRESSURE)), true);
  assert.equal(Boolean(bands.proposalBetter(controller.outcome, 0, 1,
    STRATEGY.KILL_PRESSURE)), false);
  bands.purpose[1] = STRATEGY_PURPOSE.NEUTRAL_POSITION;
  assert.equal(Boolean(bands.proposalBetter(controller.outcome, 1, 0,
    STRATEGY.KILL_PRESSURE)), false,
  "soft search evidence cannot cross a stronger Strategy ownership band");
  bands.purpose[1] = STRATEGY_PURPOSE.DIRECT_KILL;
  controller.outcome.expectedValue[0] = 500;
  controller.outcome.expectedValue[1] = 500;
  controller.outcome.tacticalValue[0] = 500;
  controller.outcome.tacticalValue[1] = 500;
  assert.equal(Boolean(bands.baseBetter(controller.outcome, 1, 0)), true,
    "soft search may break a tie only after the qualified scalar dimensions tie");
  controller.outcome.tacticalValue[0] = 501;
  assert.equal(Boolean(bands.baseBetter(controller.outcome, 1, 0)), false,
    "one exact tactical unit outranks every soft estimate");
});

test("HP10 diagnostic legacy switch reproduces incomplete Information ownership", () => {
  const controller = new RiskAcceptanceController({ incompleteSearchOwnership: true });
  const hard = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
  const tactical = new Int16Array([200, 100]);
  controller.populate(2, hard, safeRows(2), tactical, null,
    incompleteInformation(-2000, 2000), 1, null, 2);
  controller.gate(0, 0);
  assert.deepEqual(Array.from(controller.outcome.expectedValue.subarray(0, 2)), [-800, 1100]);
  assert.equal(controller.select(1), 1);
});

test("HP10 complete Information value may own selection", () => {
  const controller = new RiskAcceptanceController();
  const hard = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
  const tactical = new Int16Array([200, 100]);
  const information = incompleteInformation(-2000, 2000);
  information.supportComplete = 1; information.approximate = 0;
  controller.populate(2, hard, safeRows(2), tactical, null, information, 1, null, 2);
  controller.gate(0, 0);
  assert.deepEqual(Array.from(controller.outcome.expectedValue.subarray(0, 2)), [-800, 1100]);
  assert.equal(controller.select(1), 1);
});

function observedSide(id, position, direction, skill) {
  return { tank: { id, position, direction, crashed: false }, stars: 0, bullet: null,
    skill: { type: skill, remainingCooldownFrames: 1 },
    effects: { self: null, debuff: null },
    status: { shielded: false, frozen: false, stunned: false, overloaded: false,
      cloaked: false, poisoned: false, boosted: false, fireLocked: false,
      bombActive: false, bombCooldownFrames: 1, canActThisFrame: true, actionSpeed: 1 },
    go() {}, turn() {}, fire() {}, throwBomb() {}, poison() {} };
}

test("HP10 incomplete deeper matrix retains exact lower-depth StageMatrix ownership", () => {
  const engine = new ProductionRootEngine();
  const action = engine.decide(observedSide("own", [1, 1], "right", "poison"),
    observedSide("enemy", [6, 1], "left", "stun"),
    { frames: 1, map: boxedMap(9, 5), star: [1, 2], bombs: [] });
  assert.equal(engine.depthSearch.completedDepth, 1);
  assert.equal(engine.depthSearch.attemptedDepth, 2);
  assert.ok(engine.depthSearch.exactOwnerEarlyAbortCount > 0);
  assert.equal(engine.depthSearch.representativeSupportComplete, 1);
  assert.equal(engine.depthSearch.representativeSupportDepth, 1);
  assert.ok(engine.stageMatrixSolveCount > 0);
  assert.ok(engine.riskController.stageMatrixUseCount > 0);
  assert.equal(action, ACTION.FIRE);
  assert.equal(engine.depthSearch.rootRestoreFailures, 0);
});

function independentFatalBackup(value, mass, lambda_) {
  if (mass <= 0) return value;
  const bounded = Math.min(10000, mass);
  const expected = Math.floor(((10000 - bounded) * value + bounded * VALUE_MIN) / 10000);
  return Math.floor((lambda_ * expected + (10000 - lambda_) * VALUE_MIN) / 10000);
}

test("HP10 Safety robust backup matches independent Chance-HiddenWorld-EnemyAction order", () => {
  let cases = 0;
  for (const risk of [0, 20, 50, 100]) {
    for (const committed of [0, 1, 2500, 10000]) {
      for (const possible of [0, 1250, 10000]) {
        for (const future of [0, 5000, 10000]) {
          const controller = new RiskAcceptanceController(); const o = controller.outcome;
          o.reset(1); o.nominalRobustLower[0] = 7351; o.robustLower[0] = 7351;
          o.committedFatalMass[0] = committed;
          o.possibleProjectileFatalMass[0] = possible;
          o.futureFireFatalMass[0] = future;
          const lambda_ = 99 * risk;
          let expected = independentFatalBackup(7351, committed, lambda_);
          expected = independentFatalBackup(expected, possible, lambda_);
          expected = independentFatalBackup(expected, future, lambda_);
          controller.applySafetyRobustBackup(risk, 0);
          assert.equal(o.robustLower[0], expected,
            `risk=${risk} committed=${committed} possible=${possible} future=${future}`);
          cases += 1;
        }
      }
    }
  }
  assert.equal(cases, 144);
});

function stateClass(state) {
  const arrays = state.arrays;
  const starDelta = arrays[ARRAY.TANK_STARS][0] - arrays[ARRAY.TANK_STARS][1];
  const remaining = Math.max(0, 127 - arrays[ARRAY.SCALAR][SCALAR.FRAME]);
  if (starDelta > 0 && remaining <= 8) return 1;
  if (starDelta < 0 && remaining <= 12) return 2;
  return 3;
}

function lambda(risk, classification) {
  const factor = classification === 1 ? 5000 : classification === 3 ? 7500 : 10000;
  return Math.floor(99 * risk * factor / 10000);
}

function contaminated(expected, worst, weight) {
  return Math.floor((weight * expected + (10000 - weight) * worst) / 10000);
}

function adjustInformationLeaf(evaluator, state, raw) {
  const arrays = state.arrays;
  const own = arrays[ARRAY.TANK_CELL][0];
  const enemy = arrays[ARRAY.TANK_CELL][1];
  if (evaluator.distance(state, own, enemy) > 2) return raw;
  const wanted = evaluator.desiredDirection(state, own, enemy);
  if (wanted < 0) return raw;
  const direction = arrays[ARRAY.TANK_DIR][0];
  let value = raw;
  if (evaluator.clearLine(state, own, enemy) && direction === wanted) value -= 1200;
  else if (direction === ((wanted + 2) & 3)) value += 400;
  return Math.max(-25000, Math.min(25000, value));
}

function informationChance(bundle, evaluator, action0, action1, risk, classification) {
  const own = bundle.hard.chanceAlternativeCount(0, action0);
  const enemy = bundle.hard.chanceAlternativeCount(1, action1);
  const count = own * enemy;
  let sum = 0;
  let worst = INFORMATION_VALUE_MAX;
  for (let index = 0; index < count; index += 1) {
    const status = bundle.kernel.applyFrame(action0, NONE_CELL, action1, NONE_CELL,
      index % own, Math.floor(index / own));
    let value = -22000;
    if (status === FAST_STATUS.APPLIED || status === FAST_STATUS.APPLIED_TERMINAL) {
      const mark = bundle.kernel.lastMark;
      const hard = bundle.hard.classifyApplied();
      const terminal = bundle.hard.lastTerminal;
      if (hard === HARD_STATUS.REJECT_POLICY) value = -27500;
      else if (terminal && terminal !== TERMINAL.INCOMPLETE)
        value = terminal === TERMINAL.DRAW ? 0 : terminal === TERMINAL.WIN0 ? 30000 : -30000;
      else if (hard === HARD_STATUS.REJECT_PROVEN) value = -28000;
      else if (hard === HARD_STATUS.INCOMPLETE) value = evaluator.heuristic(bundle.state) - 6000;
      else value = adjustInformationLeaf(evaluator, bundle.state, evaluator.heuristic(bundle.state));
      bundle.state.undoTo(mark);
    }
    sum += value;
    if (value < worst) worst = value;
  }
  return contaminated(Math.floor(sum / count), worst, lambda(risk, classification));
}

function independentInformation(bundle, evaluator, worlds, masses, enemyProbability, risk,
    lastDirection) {
  const state = bundle.state;
  const arrays = state.arrays;
  const originalCell = arrays[ARRAY.TANK_CELL][1];
  const originalDirection = arrays[ARRAY.TANK_DIR][1];
  const classification = stateClass(state);
  const hiddenWeight = lambda(risk, classification);
  const enemyWeight = lambda(risk, classification);
  const cells = new Int32Array(ROOT_ACTIONS.length * ROOT_ACTIONS.length);
  const rows = new Int32Array(ROOT_ACTIONS.length);
  for (let row = 0; row < ROOT_ACTIONS.length; row += 1) {
    let enemyExpected = 0;
    let enemyWorst = INFORMATION_VALUE_MAX;
    for (let column = 0; column < ROOT_ACTIONS.length; column += 1) {
      let hiddenExpected = 0;
      let hiddenWorst = INFORMATION_VALUE_MAX;
      for (let world = 0; world < worlds.length; world += 1) {
        arrays[ARRAY.TANK_CELL][1] = worlds[world];
        arrays[ARRAY.TANK_DIR][1] = lastDirection;
        state.initializeHash();
        const value = informationChance(bundle, evaluator, ROOT_ACTIONS[row],
          ROOT_ACTIONS[column], risk, classification);
        hiddenExpected += masses[world] * value;
        if (value < hiddenWorst) hiddenWorst = value;
      }
      const cell = contaminated(Math.floor(hiddenExpected / 10000), hiddenWorst, hiddenWeight);
      cells[row * ROOT_ACTIONS.length + column] = cell;
      enemyExpected += enemyProbability[column] * cell;
      if (cell < enemyWorst) enemyWorst = cell;
    }
    rows[row] = contaminated(Math.floor(enemyExpected / 10000), enemyWorst, enemyWeight);
  }
  arrays[ARRAY.TANK_CELL][1] = originalCell;
  arrays[ARRAY.TANK_DIR][1] = originalDirection;
  state.initializeHash();
  return { cells, rows };
}

test("HP10 Information depth one matches independent Chance-HiddenWorld-EnemyAction backup", () => {
  const enemyProbability = Uint16Array.from([4000, 3000, 2000, 1000]);
  let cases = 0;
  for (const risk of [0, 50, 100]) {
    for (const worldCount of [1, 2, 4]) {
      for (let index = 0; index < 16; index += 1) {
        const built = fixture(index + 3);
        assert.equal(built.status, FAST_STATUS.APPLIED);
        const state = built.state;
        const candidates = [[5, 5], [5, 1], [1, 5], [3, 5]]
          .map(([x, y]) => state.cell(x, y));
        const worlds = Uint16Array.from(candidates.slice(0, worldCount));
        const masses = new Uint16Array(worldCount);
        masses.fill(Math.floor(10000 / worldCount));
        for (let assigned = masses[0] * worldCount; assigned < 10000; assigned += 1)
          masses[(assigned - masses[0] * worldCount) % worldCount] += 1;
        const evaluator = new ProductionDepthSearch(new ProductionCacheBank());
        const root = state.rootSignature();
        const expected = independentInformation(built, evaluator, worlds, masses,
          enemyProbability, risk, 3);
        assert.equal(state.rootSignature(), root);
        const search = new ProductionInformationSearch();
        const matrixNodes = search.matrixNodeCount(built, ROOT_ACTIONS, ROOT_ACTIONS.length,
          ROOT_ACTIONS, Uint8Array.from([0, 1, 2, 3]), ROOT_ACTIONS.length);
        const nodeBudget = matrixNodes * worldCount * 2;
        const complete = search.search(built, evaluator, ROOT_ACTIONS, ROOT_ARGUMENTS,
          ROOT_ACTIONS.length, ROOT_ACTIONS, ROOT_ARGUMENTS, ROOT_ACTIONS.length,
          worlds, masses, worldCount, 1, nodeBudget, risk, 3, 1, enemyProbability, 1);
        assert.equal(complete, 1, `risk=${risk} worlds=${worldCount} fixture=${index}`);
        assert.equal(search.supportComplete, 1,
          `support risk=${risk} worlds=${worldCount} fixture=${index}`);
        assert.equal(search.completedDepth, 1);
        for (let row = 0; row < ROOT_ACTIONS.length; row += 1) {
          assert.equal(search.rootScore[row], expected.rows[row],
            `row risk=${risk} worlds=${worldCount} fixture=${index} row=${row}`);
          for (let column = 0; column < ROOT_ACTIONS.length; column += 1)
            assert.equal(search.rootCellScore[
              row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column],
            expected.cells[row * ROOT_ACTIONS.length + column],
            `cell risk=${risk} worlds=${worldCount} fixture=${index} row=${row} column=${column}`);
        }
        assert.equal(search.rootRestoreFailures, 0);
        assert.equal(state.rootSignature(), root);
        cases += 1;
      }
    }
  }
  assert.equal(cases, 144);
});
