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
    this.completedDepth = 0; this.attemptedDepth = 0; this.nodes = 0; this.worldsEvaluated = 0;
    this.supportComplete = 0; this.approximate = 1; this.interruptedCount = 0;
    this.rootRestoreFailures = 0; this.hotAllocationCount = 0;
    this.projectilePresenceBackupCount = 0; this.immediateFireBackupCount = 0;
    this.trapProbeBudget = 0; this.continuationLeafBudget = 0;
    this.continuationPoolRemaining = 0;
    this.diagnosticDisableShallowAdjustment = 0;
    this.diagnosticDisableShallowClearLineReversal = 0;
    this.diagnosticDisableShallowEscapeBonus = 0;
    this.diagnosticEnableLegacyShallowFacingPenalty = 0;
  }

  resetRoot() {
    this.rootScore.fill(0); this.rootCellScore.fill(INFORMATION_VALUE_MIN);
    this.completedDepth = 0; this.attemptedDepth = 0; this.nodes = 0; this.worldsEvaluated = 0;
    this.supportComplete = 0; this.approximate = 1;
    this.trapProbeBudget = 0; this.continuationLeafBudget = 0;
    this.continuationPoolRemaining = 0;
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
      chance0, chance1, nodeBudget, remainingDepth = 1, baseRisk = 0) {
    const status = bundle.kernel.applyFrame(action0, argument0, action1, argument1,
      chance0, chance1); this.nodes += 1;
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) return -22000;
    const mark = bundle.kernel.lastMark; const hard = bundle.hard.classifyApplied();
    const terminal = bundle.hard.lastTerminal; let value;
    if (hard === HARD_STATUS.REJECT_POLICY) value = -27500;
    else if (terminal && terminal !== TERMINAL.INCOMPLETE) value = this.terminalValue(terminal);
    else if (hard === HARD_STATUS.REJECT_PROVEN) value = -28000;
    else if (hard === HARD_STATUS.INCOMPLETE) value = evaluator.heuristic(bundle.state) - 6000;
    else if (remainingDepth > 1 && this.continuationPoolRemaining >= 4 &&
        typeof evaluator.continuationValue === "function" &&
        nodeBudget > this.nodes + 4) {
      const leafBudget = Math.min(this.continuationLeafBudget, this.continuationPoolRemaining,
        Math.max(0, nodeBudget - this.nodes));
      value = evaluator.continuationValue(bundle, Math.min(2, remainingDepth - 1),
        leafBudget, baseRisk);
      const spent = evaluator.lastContinuationNodes || 0;
      this.nodes += spent;
      this.continuationPoolRemaining = Math.max(0, this.continuationPoolRemaining - spent);
      // Physical continuation ignores Info adjacency posture; apply the same
      // shallow liability so escape vs commitment still separates when the
      // Physical 1-ply returns near-ties.
      value = this.adjustShallowLeaf(evaluator, bundle.state, value);
    } else {
      const trap = evaluator.probeDirectFireTrap(bundle, this.trapProbeBudget);
      this.trapProbeBudget -= evaluator.lastTrapProbeNodes;
      this.nodes += evaluator.lastTrapProbeNodes;
      value = trap === 1 ? -29900 : evaluator.heuristic(bundle.state);
      if (trap !== 1) value = this.adjustShallowLeaf(evaluator, bundle.state, value);
    }
    bundle.state.undoTo(mark); return value;
  }
  adjustShallowLeaf(evaluator, state, value) {
    if (this.diagnosticDisableShallowAdjustment) return value;
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const proximity = evaluator.distance(state, own, enemy);
    if (proximity > 2) return value;
    const ownWanted = evaluator.desiredDirection(state, own, enemy);
    if (ownWanted < 0) return value;
    const dir = a[ARRAY.TANK_DIR][0];
    // Reverse the clear-line +1200 when it fired inside adjacency, then apply
    // only the independently retained escape bonus.
    if (!this.diagnosticDisableShallowClearLineReversal &&
        evaluator.clearLine(state, own, enemy) && dir === ownWanted) value -= 1200;
    // The former unconditional -800 facing penalty was negative in both the
    // failure-focused cohort and an independent holdout. Clear-line reversal
    // already removes the adjacency attack bonus; do not penalize it twice.
    if (dir === ownWanted && this.diagnosticEnableLegacyShallowFacingPenalty) value -= 800;
    else if (dir === ((ownWanted + 2) & 3) &&
        !this.diagnosticDisableShallowEscapeBonus) value += 400;
    return Math.max(-25000, Math.min(25000, value));
  }
  evaluateChance(bundle, evaluator, action0, argument0, action1, argument1,
      baseRisk, stateClass, nodeBudget, remainingDepth = 1) {
    const own = bundle.hard.chanceAlternativeCount(0, action0);
    const enemy = bundle.hard.chanceAlternativeCount(1, action1);
    const count = own * enemy; let sum = 0; let worst = INFORMATION_VALUE_MAX;
    for (let index = 0; index < count; index += 1) {
      const value = this.evaluateOutcome(bundle, evaluator, action0, argument0,
        action1, argument1, index % own, Math.floor(index / own), nodeBudget,
        remainingDepth, baseRisk);
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
      supportComplete, nodeBudget, baseRisk, lastDirection, directionComplete, enemyProbability,
      decisionDepth = 1) {
    this.resetRoot();
    this.supportComplete = supportComplete ? 1 : 0; this.approximate = supportComplete ? 0 : 1;
    if (!bundle || !worldCount || !ourCount || !enemyCount || nodeBudget < 1) return 0;
    const requestedDepth = Math.max(1, Math.min(2,
      Number.isInteger(decisionDepth) ? decisionDepth : 1));
    this.attemptedDepth = requestedDepth;
    const state = bundle.state; const a = state.arrays; const originalCell = a[ARRAY.TANK_CELL][1];
    const originalDirection = a[ARRAY.TANK_DIR][1]; const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    // Soft-top enemy columns by nominal probability when the full matrix cannot
    // leave room for depth-2 continuation. Never drop below two columns.
    let effectiveEnemyCount = enemyCount;
    const enemyOrder = new Uint8Array(enemyCount);
    for (let column = 0; column < enemyCount; column += 1) enemyOrder[column] = column;
    for (let i = 0; i < enemyCount; i += 1)
      for (let j = i + 1; j < enemyCount; j += 1)
        if (enemyProbability[enemyOrder[j]] > enemyProbability[enemyOrder[i]]) {
          const swap = enemyOrder[i]; enemyOrder[i] = enemyOrder[j]; enemyOrder[j] = swap;
        }
    const matrixNodesFor = (enemies) => {
      let nodes = 0;
      for (let row = 0; row < ourCount; row += 1)
        for (let index = 0; index < enemies; index += 1)
          nodes += this.chanceCount(bundle, ourActions[row], enemyActions[enemyOrder[index]]);
      return nodes;
    };
    // Reserve continuation first when recursion is requested — depth-2 value
    // discrimination beats an oversized depth-1 matrix that leaves no leftover.
    let continuationReserve = 0;
    if (requestedDepth > 1 && typeof evaluator.continuationValue === "function" &&
        nodeBudget >= 48) {
      continuationReserve = Math.min(64, Math.max(40, Math.floor(nodeBudget / 2)));
      // Cap enemy breadth so every our-row can still receive a fair leaf share.
      if (effectiveEnemyCount > 4) effectiveEnemyCount = 4;
    }
    let matrixBudget = Math.max(1, nodeBudget - continuationReserve);
    let matrixNodes = matrixNodesFor(effectiveEnemyCount);
    while (effectiveEnemyCount > 2 && matrixNodes > matrixBudget) {
      effectiveEnemyCount -= 1;
      matrixNodes = matrixNodesFor(effectiveEnemyCount);
    }
    if (!matrixNodes || matrixNodes > matrixBudget) {
      // Still too large even at two enemy columns: drop the reserve and try a
      // pure depth-1 matrix inside the full budget.
      continuationReserve = 0; matrixBudget = nodeBudget;
      effectiveEnemyCount = enemyCount;
      matrixNodes = matrixNodesFor(effectiveEnemyCount);
      while (effectiveEnemyCount > 2 && matrixNodes > matrixBudget) {
        effectiveEnemyCount -= 1;
        matrixNodes = matrixNodesFor(effectiveEnemyCount);
      }
      if (!matrixNodes || matrixNodes > matrixBudget) return 0;
    }
    // Prefer one world / one muzzle direction so leftover funds continuations.
    let maximumDirections = 1;
    let maximumWorlds = Math.floor(matrixBudget / matrixNodes);
    if (maximumWorlds < 1) return 0;
    if (continuationReserve === 0 && matrixBudget >= matrixNodes * 2) {
      maximumDirections = 2;
      maximumWorlds = Math.floor(matrixBudget / (matrixNodes * maximumDirections));
      if (maximumWorlds < 1) {
        maximumDirections = 1;
        maximumWorlds = Math.floor(matrixBudget / matrixNodes);
      }
    }
    if (continuationReserve > 0 && maximumWorlds > 2) maximumWorlds = 2;
    let inputMass = 0;
    for (let world = 0; world < worldCount; world += 1) inputMass += worldMass[world];
    const selected = this.selectWorlds(worldCells, worldMass, worldCount, maximumWorlds);
    if (!selected) return 0;
    const matrixCost = matrixNodes * maximumDirections * selected;
    let infoDepth = 1;
    let continuationPool = 0;
    this.continuationLeafBudget = 0;
    this.continuationPoolRemaining = 0;
    if (continuationReserve > 0 && matrixCost <= matrixBudget) {
      infoDepth = 2;
      continuationPool = Math.min(continuationReserve, Math.max(0, nodeBudget - matrixCost));
      // Fair per-row leaf budget: a shared depleting pool biased early rows.
      this.continuationLeafBudget = Math.min(16, Math.max(6,
        Math.floor(continuationPool / Math.max(1, ourCount * 2))));
    }
    this.attemptedDepth = Math.max(this.attemptedDepth, infoDepth);
    this.supportComplete = this.supportComplete && selected === worldCount && inputMass === 10000 &&
      directionComplete && infoDepth === 1 && effectiveEnemyCount === enemyCount ? 1 : 0;
    this.approximate = this.supportComplete ? 0 : 1;
    this.trapProbeBudget = Math.min(DIRECT_FIRE_TRAP_NODE_CAP, Math.max(0,
      nodeBudget - matrixCost - continuationPool));
    // Renormalize enemy probabilities over the retained columns.
    let retainedMass = 0;
    for (let index = 0; index < effectiveEnemyCount; index += 1)
      retainedMass += enemyProbability[enemyOrder[index]];
    const starDelta = a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1];
    const remaining = Math.max(0, 127 - a[ARRAY.SCALAR][SCALAR.FRAME]);
    const stateClass = this.risk.classify(starDelta, remaining, 0, 1, 2, 0);
    const hiddenLambda = this.risk.lambda(baseRisk, stateClass, RISK_DIMENSION.HIDDEN_WORLD);
    const enemyLambda = this.risk.lambda(baseRisk, stateClass, RISK_DIMENSION.ENEMY_ACTION);
    const poolPerRow = infoDepth > 1 ?
      Math.max(this.continuationLeafBudget, Math.floor(continuationPool / Math.max(1, ourCount))) : 0;
    const retainedMask = effectiveEnemyCount < enemyCount ? new Uint8Array(enemyCount) : null;
    if (retainedMask)
      for (let index = 0; index < effectiveEnemyCount; index += 1)
        retainedMask[enemyOrder[index]] = 1;
    for (let row = 0; row < ourCount; row += 1) {
      this.continuationPoolRemaining = poolPerRow;
      let enemyExpected = 0; let enemyWorst = INFORMATION_VALUE_MAX;
      for (let index = 0; index < effectiveEnemyCount; index += 1) {
        const column = enemyOrder[index];
        let hiddenExpected = 0; let hiddenWorst = INFORMATION_VALUE_MAX;
        for (let world = 0; world < selected; world += 1) {
          a[ARRAY.TANK_CELL][1] = this.selectedWorld[world];
          const directions = this.directionCount(state, this.selectedWorld[world], lastDirection,
            directionComplete, maximumDirections);
          let directionSum = 0; let directionWorst = INFORMATION_VALUE_MAX;
          for (let directionIndex = 0; directionIndex < directions; directionIndex += 1) {
            a[ARRAY.TANK_DIR][1] = this.direction[directionIndex]; state.initializeHash();
            const value = this.evaluateChance(bundle, evaluator, ourActions[row], ourArguments[row],
              enemyActions[column], enemyArguments[column], baseRisk, stateClass, nodeBudget,
              infoDepth);
            directionSum += value; if (value < directionWorst) directionWorst = value;
          }
          const directionExpected = Math.floor(directionSum / directions);
          hiddenExpected += this.selectedMass[world] * directionExpected;
          if (directionWorst < hiddenWorst) hiddenWorst = directionWorst;
        }
        hiddenExpected = Math.floor(hiddenExpected / 10000);
        const cellValue = this.contaminated(hiddenExpected, hiddenWorst, hiddenLambda);
        this.rootCellScore[row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column] = cellValue;
        const probability = retainedMass > 0 ?
          Math.floor(enemyProbability[column] * 10000 / retainedMass) : 0;
        enemyExpected += probability * cellValue;
        if (cellValue < enemyWorst) enemyWorst = cellValue;
      }
      enemyExpected = Math.floor(enemyExpected / 10000);
      this.rootScore[row] = this.contaminated(enemyExpected, enemyWorst, enemyLambda);
      // Soft-topped columns stay at INFORMATION_VALUE_MIN otherwise; fill them
      // with this row's retained worst so envelopes / matrix consumers never see
      // an unscored sentinel.
      if (retainedMask) {
        for (let column = 0; column < enemyCount; column += 1) {
          if (retainedMask[column]) continue;
          this.rootCellScore[row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column] = enemyWorst;
        }
      }
    }
    this.worldsEvaluated = selected; this.completedDepth = infoDepth;
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
