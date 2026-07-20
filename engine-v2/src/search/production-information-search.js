"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { FAST_STATUS, HARD_STATUS, TERMINAL, CHANCE, ACTION, TERRAIN, NONE_FRAME, NONE_CELL } =
  require("../abi/fast-codes");
const { RISK_DIMENSION } = require("../abi/search-codes");
const { RiskProfile } = require("./risk");

const INFORMATION_VALUE_MIN = -32000;
const INFORMATION_VALUE_MAX = 32000;
const DIRECT_FIRE_TRAP_NODE_CAP = SEARCH_CAPACITY.MAX_OUR_ACTIONS * 2;

class ProductionInformationSearch {
  constructor() {
    this.rootScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rootCellScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.enemyProbability = new Uint16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.selectedWorld = new Uint16Array(SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE);
    this.selectedMass = new Uint16Array(SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE);
    this.direction = new Uint8Array(2); this.risk = new RiskProfile();
    this.completedDepth = 0; this.nodes = 0; this.worldsEvaluated = 0;
    this.supportComplete = 0; this.approximate = 1; this.interruptedCount = 0;
    this.rootRestoreFailures = 0; this.hotAllocationCount = 0;
    this.projectilePresenceBackupCount = 0; this.immediateFireBackupCount = 0;
    this.trapProbeBudget = 0;
  }

  resetRoot() {
    this.rootScore.fill(0); this.rootCellScore.fill(INFORMATION_VALUE_MIN);
    this.completedDepth = 0; this.nodes = 0; this.worldsEvaluated = 0;
    this.supportComplete = 0; this.approximate = 1;
    this.trapProbeBudget = 0;
  }
  adoptPhysicalBounds(evaluator) {
    this.resetRoot();
    this.rootScore.set(evaluator.rootScore); this.rootCellScore.set(evaluator.rootCellScore);
    this.completedDepth = evaluator.completedDepth; this.nodes = evaluator.nodes;
    this.worldsEvaluated = 1; this.supportComplete = 0; this.approximate = 1;
    return this.completedDepth;
  }

  contaminated(expected, worst, lambda) {
    return Math.floor((lambda * expected + (10000 - lambda) * worst) / 10000);
  }
  terminalValue(terminal) {
    if (terminal === TERMINAL.DRAW) return 0;
    return terminal === TERMINAL.WIN0 ? 30000 : -30000;
  }
  directionTo(state, from, to) {
    const fx = state.x(from); const fy = state.y(from); const tx = state.x(to); const ty = state.y(to);
    if (fx === tx) return ty < fy ? 0 : ty > fy ? 2 : -1;
    if (fy === ty) return tx > fx ? 1 : tx < fx ? 3 : -1; return -1;
  }
  clearLine(state, from, to) {
    const fromX = state.x(from); const fromY = state.y(from);
    const toX = state.x(to); const toY = state.y(to);
    if (fromX !== toX && fromY !== toY) return 0;
    const dx = toX === fromX ? 0 : toX > fromX ? 1 : -1;
    const dy = toY === fromY ? 0 : toY > fromY ? 1 : -1;
    let x = fromX + dx; let y = fromY + dy; const terrain = state.arrays[ARRAY.TERRAIN];
    while (x !== toX || y !== toY) {
      const tile = terrain[state.cell(x, y)];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
      x += dx; y += dy;
    }
    return 1;
  }
  directionCount(state, worldCell, lastDirection, directionComplete, maximumDirections = 2) {
    this.direction[0] = lastDirection; let count = 1;
    if (directionComplete || maximumDirections < 2) return count;
    const threat = this.directionTo(state, worldCell, state.arrays[ARRAY.TANK_CELL][0]);
    if (threat >= 0 && threat !== lastDirection) { this.direction[1] = threat; count = 2; }
    return count;
  }
  chanceCount(bundle, action0, action1) {
    return bundle.hard.chanceAlternativeCount(0, action0) *
      bundle.hard.chanceAlternativeCount(1, action1);
  }
  evaluateOutcome(bundle, evaluator, action0, argument0, action1, argument1,
      chance0, chance1, nodeBudget) {
    const status = bundle.kernel.applyFrame(action0, argument0, action1, argument1,
      chance0, chance1); this.nodes += 1;
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) return -22000;
    const mark = bundle.kernel.lastMark; const hard = bundle.hard.classifyApplied();
    const terminal = bundle.hard.lastTerminal; let value;
    if (hard === HARD_STATUS.REJECT_POLICY) value = -27500;
    else if (terminal && terminal !== TERMINAL.INCOMPLETE) value = this.terminalValue(terminal);
    else if (hard === HARD_STATUS.REJECT_PROVEN) value = -28000;
    else if (hard === HARD_STATUS.INCOMPLETE) value = evaluator.heuristic(bundle.state) - 6000;
    else {
      const trap = evaluator.probeDirectFireTrap(bundle, this.trapProbeBudget);
      this.trapProbeBudget -= evaluator.lastTrapProbeNodes;
      this.nodes += evaluator.lastTrapProbeNodes;
      value = trap === 1 ? -29900 : evaluator.heuristic(bundle.state);
    }
    bundle.state.undoTo(mark); return value;
  }
  evaluateChance(bundle, evaluator, action0, argument0, action1, argument1,
      baseRisk, stateClass, nodeBudget) {
    const own = bundle.hard.chanceAlternativeCount(0, action0);
    const enemy = bundle.hard.chanceAlternativeCount(1, action1);
    const count = own * enemy; let sum = 0; let worst = INFORMATION_VALUE_MAX;
    for (let index = 0; index < count; index += 1) {
      const value = this.evaluateOutcome(bundle, evaluator, action0, argument0,
        action1, argument1, index % own, Math.floor(index / own), nodeBudget);
      sum += value; if (value < worst) worst = value;
    }
    const expected = Math.floor(sum / count);
    const lambda = this.risk.lambda(baseRisk, stateClass, RISK_DIMENSION.CHANCE_OUTCOME);
    return this.contaminated(expected, worst, lambda);
  }
  selectWorlds(worldCells, worldMass, worldCount, maximum) {
    const count = Math.max(0, Math.min(worldCount, maximum, this.selectedWorld.length));
    let mass = 0;
    for (let index = 0; index < count; index += 1) { this.selectedWorld[index] = worldCells[index];
      this.selectedMass[index] = worldMass[index]; mass += worldMass[index]; }
    if (!count || !mass) return 0;
    let assigned = 0;
    for (let index = 0; index < count; index += 1) {
      this.selectedMass[index] = Math.floor(this.selectedMass[index] * 10000 / mass);
      assigned += this.selectedMass[index];
    }
    for (let index = 0; assigned < 10000; index = (index + 1) % count) {
      this.selectedMass[index] += 1; assigned += 1;
    }
    return count;
  }
  search(bundle, evaluator, ourActions, ourArguments, ourCount,
      enemyActions, enemyArguments, enemyCount, worldCells, worldMass, worldCount,
      supportComplete, nodeBudget, baseRisk, lastDirection, directionComplete, enemyProbability) {
    this.resetRoot();
    this.supportComplete = supportComplete ? 1 : 0; this.approximate = supportComplete ? 0 : 1;
    if (!bundle || !worldCount || !ourCount || !enemyCount || nodeBudget < 1) return 0;
    const state = bundle.state; const a = state.arrays; const originalCell = a[ARRAY.TANK_CELL][1];
    const originalDirection = a[ARRAY.TANK_DIR][1]; const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    let matrixNodes = 0;
    for (let row = 0; row < ourCount; row += 1)
      for (let column = 0; column < enemyCount; column += 1)
        matrixNodes += this.chanceCount(bundle, ourActions[row], enemyActions[column]);
    if (!matrixNodes || matrixNodes > nodeBudget) return 0;
    // A reduced runtime mode keeps the nominal last-seen direction. The
    // all-support muzzle envelope below still covers critical alternative
    // directions, so this reduction is bounded and the node budget is real.
    const maximumDirections = nodeBudget >= matrixNodes * 2 ? 2 : 1;
    const maximumWorlds = Math.floor(nodeBudget / (matrixNodes * maximumDirections));
    if (maximumWorlds < 1) return 0;
    let inputMass = 0;
    for (let world = 0; world < worldCount; world += 1) inputMass += worldMass[world];
    const selected = this.selectWorlds(worldCells, worldMass, worldCount, maximumWorlds);
    if (!selected) return 0;
    // Completeness is monotone: budget truncation, missing probability mass,
    // or an unresolved direction support can only downgrade the value search.
    this.supportComplete = this.supportComplete && selected === worldCount && inputMass === 10000 &&
      directionComplete ? 1 : 0;
    this.approximate = this.supportComplete ? 0 : 1;
    this.trapProbeBudget = Math.min(DIRECT_FIRE_TRAP_NODE_CAP, Math.max(0,
      nodeBudget - matrixNodes * maximumDirections * selected));
    const starDelta = a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1];
    const remaining = Math.max(0, 127 - a[ARRAY.SCALAR][SCALAR.FRAME]);
    const stateClass = this.risk.classify(starDelta, remaining, 0, 1, 2, 0);
    const hiddenLambda = this.risk.lambda(baseRisk, stateClass, RISK_DIMENSION.HIDDEN_WORLD);
    const enemyLambda = this.risk.lambda(baseRisk, stateClass, RISK_DIMENSION.ENEMY_ACTION);
    for (let row = 0; row < ourCount; row += 1) {
      let enemyExpected = 0; let enemyWorst = INFORMATION_VALUE_MAX;
      for (let column = 0; column < enemyCount; column += 1) {
        let hiddenExpected = 0; let hiddenWorst = INFORMATION_VALUE_MAX;
        for (let world = 0; world < selected; world += 1) {
          a[ARRAY.TANK_CELL][1] = this.selectedWorld[world];
          const directions = this.directionCount(state, this.selectedWorld[world], lastDirection,
            directionComplete, maximumDirections);
          let directionSum = 0; let directionWorst = INFORMATION_VALUE_MAX;
          for (let directionIndex = 0; directionIndex < directions; directionIndex += 1) {
            a[ARRAY.TANK_DIR][1] = this.direction[directionIndex]; state.initializeHash();
            const value = this.evaluateChance(bundle, evaluator, ourActions[row], ourArguments[row],
              enemyActions[column], enemyArguments[column], baseRisk, stateClass, nodeBudget);
            directionSum += value; if (value < directionWorst) directionWorst = value;
          }
          const directionExpected = Math.floor(directionSum / directions);
          hiddenExpected += this.selectedMass[world] * directionExpected;
          if (directionWorst < hiddenWorst) hiddenWorst = directionWorst;
        }
        hiddenExpected = Math.floor(hiddenExpected / 10000);
        const cellValue = this.contaminated(hiddenExpected, hiddenWorst, hiddenLambda);
        this.rootCellScore[row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column] = cellValue;
        const probability = enemyProbability[column]; enemyExpected += probability * cellValue;
        if (cellValue < enemyWorst) enemyWorst = cellValue;
      }
      enemyExpected = Math.floor(enemyExpected / 10000);
      this.rootScore[row] = this.contaminated(enemyExpected, enemyWorst, enemyLambda);
    }
    this.worldsEvaluated = selected; this.completedDepth = 1;
    a[ARRAY.TANK_CELL][1] = originalCell; a[ARRAY.TANK_DIR][1] = originalDirection;
    state.initializeHash(); state.undoTo(rootMark);
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== rootMark) {
      this.rootRestoreFailures += 1; this.completedDepth = 0; return 0;
    }
    return 1;
  }

  binaryHiddenBackup(safeValue, lethalProbability, hiddenLambda) {
    if (lethalProbability <= 0) return safeValue;
    const probability = Math.min(10000, lethalProbability);
    const expected = Math.floor(((10000 - probability) * safeValue +
      probability * -30000) / 10000);
    return this.contaminated(expected, -30000, hiddenLambda);
  }
  recomputeEnemyBackup(ourCount, enemyCount, enemyProbability, enemyLambda) {
    for (let row = 0; row < ourCount; row += 1) {
      let expected = 0; let worst = INFORMATION_VALUE_MAX;
      for (let column = 0; column < enemyCount; column += 1) {
        const value = this.rootCellScore[row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column];
        expected += enemyProbability[column] * value; if (value < worst) worst = value;
      }
      this.rootScore[row] = this.contaminated(Math.floor(expected / 10000), worst, enemyLambda);
    }
  }
  applyRiskEnvelopes(bundle, ourActions, ourCount, enemyActions, enemyCount,
      worldCells, worldMass, worldCount, possibleProjectiles, projectedCell,
      baseRisk, lastDirection, directionComplete, enemyProbability) {
    if (!bundle || this.completedDepth < 1 || !ourCount || !enemyCount) return 0;
    const state = bundle.state; const a = state.arrays;
    const starDelta = a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1];
    const remaining = Math.max(0, 127 - a[ARRAY.SCALAR][SCALAR.FRAME]);
    const stateClass = this.risk.classify(starDelta, remaining, 0, 1, 2, 0);
    const hiddenLambda = this.risk.lambda(baseRisk, stateClass, RISK_DIMENSION.HIDDEN_WORLD);
    const enemyLambda = this.risk.lambda(baseRisk, stateClass, RISK_DIMENSION.ENEMY_ACTION);
    let fireColumn = -1;
    for (let column = 0; column < enemyCount; column += 1)
      if (enemyActions[column] === ACTION.FIRE) { fireColumn = column; break; }
    let changed = 0;
    for (let row = 0; row < ourCount; row += 1) {
      const target = projectedCell[row];
      if (target === NONE_CELL) continue;
      let projectileMass = possibleProjectiles ? possibleProjectiles.lethalMass(state, target) : 0;
      if (ourActions[row] === ACTION.CAST_SHIELD ||
          (a[ARRAY.TANK_SHIELD_UNTIL][0] !== NONE_FRAME &&
           a[ARRAY.TANK_SHIELD_UNTIL][0] > a[ARRAY.SCALAR][SCALAR.FRAME] &&
           a[ARRAY.TANK_SHIELD_HITS][0] > 0)) projectileMass = 0;
      if (projectileMass > 0) {
        for (let column = 0; column < enemyCount; column += 1) {
          const at = row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column;
          this.rootCellScore[at] = this.binaryHiddenBackup(this.rootCellScore[at],
            projectileMass, hiddenLambda);
        }
        this.projectilePresenceBackupCount += 1; changed = 1;
      }
      if (fireColumn >= 0 && worldCount > 0 && directionComplete === 0) {
        let lethalMass = 0;
        for (let world = 0; world < worldCount; world += 1) {
          const source = worldCells[world]; const direction = this.directionTo(state, source, target);
          if (direction < 0 || !this.clearLine(state, source, target)) continue;
          const distance = Math.abs(state.x(source) - state.x(target)) +
            Math.abs(state.y(source) - state.y(target));
          if (distance < 1 || distance > 2) continue;
          const directionMass = direction === lastDirection ? 10000 : 5000;
          lethalMass += Math.floor(worldMass[world] * directionMass / 10000);
        }
        if (lethalMass > 0) {
          const at = row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + fireColumn;
          this.rootCellScore[at] = this.binaryHiddenBackup(this.rootCellScore[at],
            Math.min(10000, lethalMass), hiddenLambda);
          this.immediateFireBackupCount += 1; changed = 1;
        }
      }
    }
    if (changed) { this.recomputeEnemyBackup(ourCount, enemyCount, enemyProbability, enemyLambda);
      this.approximate = 1; this.supportComplete = 0; }
    return changed;
  }
}

module.exports = { INFORMATION_VALUE_MIN, INFORMATION_VALUE_MAX, ProductionInformationSearch };
