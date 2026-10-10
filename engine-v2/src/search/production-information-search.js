"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { RUNTIME_CONFIG } = require("../generated/runtime-config");
const { WORK_KIND } = require("../abi/cache-runtime-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { FAST_STATUS, HARD_STATUS, TERMINAL, CHANCE, ACTION, TERRAIN, NONE_FRAME, NONE_CELL } =
  require("../abi/fast-codes");
const { RISK_DIMENSION } = require("../abi/search-codes");
const { RiskProfile } = require("./risk");

const INFORMATION_VALUE_MIN = -32000;
const INFORMATION_VALUE_MAX = 32000;
const DIRECT_FIRE_TRAP_NODE_CAP = SEARCH_CAPACITY.MAX_OUR_ACTIONS * 2;

class ProductionInformationSearch {
  constructor(options = {}) {
    this.runtimeConfig = options.runtimeConfig || RUNTIME_CONFIG;
    this.rootScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rootCellScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.enemyProbability = new Uint16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.selectedWorld = new Uint16Array(SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE);
    this.selectedMass = new Uint16Array(SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE);
    this.enemyOrder = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.evaluationOrder = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.evaluationPriority = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.retainedMask = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.direction = new Uint8Array(2); this.risk = options.riskProfile || new RiskProfile();
    this.maximumEnemyColumns = Number.isSafeInteger(options.maximumEnemyColumns) ?
      Math.max(1, Math.min(SEARCH_CAPACITY.MAX_ENEMY_POLICIES,
        options.maximumEnemyColumns)) : SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
    this.completedDepth = 0; this.attemptedDepth = 0; this.nodes = 0; this.worldsEvaluated = 0;
    this.informationRootDepth = 0; this.physicalContinuationDepth = 0;
    this.physicalContinuationAttemptedDepth = 0;
    this.continuationRequiredCount = 0; this.continuationCompletedCount = 0;
    this.continuationCoveragePer10000 = 0;
    this.supportComplete = 0; this.approximate = 1; this.interruptedCount = 0;
    this.rootRestoreFailures = 0; this.hotAllocationCount = 0;
    this.projectilePresenceBackupCount = 0; this.immediateFireBackupCount = 0;
    this.trapProbeBudget = 0; this.continuationLeafBudget = 0;
    this.continuationPoolRemaining = 0;
    this.lastMatrixCost = 0; this.lastContinuationPool = 0;
    this.lastEffectiveEnemyCount = 0; this.lastSelectedWorldCount = 0;
    this.lastDirectionCount = 0;
    this.diagnosticDisableShallowAdjustment = 0;
    this.diagnosticDisableShallowClearLineReversal = 0;
    this.diagnosticDisableShallowEscapeBonus = 0;
    this.diagnosticEnableLegacyShallowFacingPenalty = 0;
    this.workUnitLimit = 0; this.workUnits = 0; this.classifiedNodes = 0;
    this.reverseBuilds = 0; this.workClassifyStart = 0; this.workBuildStart = 0;
    this.workInterruptedCount = 0;
    this.workRootHitStart = 0; this.rootTransitionHits = 0;
  }

  resetRoot() {
    this.rootScore.fill(0); this.rootCellScore.fill(INFORMATION_VALUE_MIN);
    this.completedDepth = 0; this.attemptedDepth = 0; this.nodes = 0; this.worldsEvaluated = 0;
    this.informationRootDepth = 0; this.physicalContinuationDepth = 0;
    this.physicalContinuationAttemptedDepth = 0;
    this.continuationRequiredCount = 0; this.continuationCompletedCount = 0;
    this.continuationCoveragePer10000 = 0;
    this.supportComplete = 0; this.approximate = 1;
    this.trapProbeBudget = 0; this.continuationLeafBudget = 0;
    this.continuationPoolRemaining = 0;
    this.lastMatrixCost = 0; this.lastContinuationPool = 0;
    this.lastEffectiveEnemyCount = 0; this.lastSelectedWorldCount = 0;
    this.lastDirectionCount = 0;
    this.workUnitLimit = 0; this.workUnits = 0; this.classifiedNodes = 0;
    this.reverseBuilds = 0; this.workClassifyStart = 0; this.workBuildStart = 0;
    this.workInterruptedCount = 0;
    this.workRootHitStart = 0; this.rootTransitionHits = 0;
  }
  beginWorkMeter(bundle, workUnitBudget) {
    this.workUnitLimit = Number.isSafeInteger(workUnitBudget) && workUnitBudget > 0 ?
      workUnitBudget : 0;
    this.workClassifyStart = bundle && bundle.hard ? bundle.hard.classifyCount : 0;
    this.workBuildStart = bundle && bundle.hard ? bundle.hard.reverseBuildCount : 0;
    this.workRootHitStart = 0;
    this.workUnits = 0; this.classifiedNodes = 0; this.reverseBuilds = 0;
  }
  updateWorkMeter(bundle) {
    const hard = bundle && bundle.hard; const charges = this.runtimeConfig.WORK_CHARGES;
    this.classifiedNodes = hard ? Math.max(0, hard.classifyCount - this.workClassifyStart) : 0;
    this.reverseBuilds = hard ? Math.max(0, hard.reverseBuildCount - this.workBuildStart) : 0;
    this.rootTransitionHits = 0;
    const hardPremium = Math.max(0, charges[WORK_KIND.HARD] - charges[WORK_KIND.CACHE]);
    const replayed = Math.min(this.nodes, this.rootTransitionHits);
    this.workUnits = this.nodes * charges[WORK_KIND.VALUE_NODE] +
      (this.nodes - replayed) * charges[WORK_KIND.FAST_TRANSITION] +
      replayed * charges[WORK_KIND.CACHE] +
      this.classifiedNodes * charges[WORK_KIND.CACHE] + this.reverseBuilds * hardPremium;
    return this.workUnits;
  }
  canConsumeWork(bundle) {
    if (!this.workUnitLimit) return 1;
    const charges = this.runtimeConfig.WORK_CHARGES;
    const nextWorstCase = charges[WORK_KIND.VALUE_NODE] +
      charges[WORK_KIND.FAST_TRANSITION] + charges[WORK_KIND.HARD];
    return this.updateWorkMeter(bundle) + nextWorstCase <= this.workUnitLimit ? 1 : 0;
  }
  adoptPhysicalBounds(evaluator) {
    this.resetRoot();
    this.rootScore.set(evaluator.rootScore); this.rootCellScore.set(evaluator.rootCellScore);
    this.completedDepth = evaluator.completedDepth; this.nodes = evaluator.nodes;
    this.informationRootDepth = 0;
    this.physicalContinuationDepth = evaluator.completedDepth;
    this.physicalContinuationAttemptedDepth = evaluator.attemptedDepth;
    this.workUnits = evaluator.workUnits || 0;
    this.classifiedNodes = evaluator.classifiedNodes || 0;
    this.reverseBuilds = evaluator.reverseBuilds || 0;
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
  matrixNodeCount(bundle, ourActions, ourCount, enemyActions, enemyOrder, enemyCount) {
    let nodes = 0;
    for (let row = 0; row < ourCount; row += 1)
      for (let index = 0; index < enemyCount; index += 1)
        nodes += this.chanceCount(bundle, ourActions[row], enemyActions[enemyOrder[index]]);
    return nodes;
  }
  projectedPose(state, seat, action) {
    const a = state.arrays; let cell = a[ARRAY.TANK_CELL][seat];
    let direction = a[ARRAY.TANK_DIR][seat];
    if (action === ACTION.TURN_LEFT) direction = (direction + 3) & 3;
    else if (action === ACTION.TURN_RIGHT) direction = (direction + 1) & 3;
    else if (action === ACTION.GO) {
      const x = state.x(cell); const y = state.y(cell);
      const nx = direction === 1 ? x + 1 : direction === 3 ? x - 1 : x;
      const ny = direction === 2 ? y + 1 : direction === 0 ? y - 1 : y;
      if (nx >= 0 && nx < state.width && ny >= 0 && ny < state.height) {
        const target = state.cell(nx, ny); const terrain = a[ARRAY.TERRAIN][target];
        if (terrain !== TERRAIN.WALL && terrain !== TERRAIN.DIRT &&
            target !== a[ARRAY.TANK_CELL][seat ^ 1]) cell = target;
      }
    }
    return cell * 4 + direction;
  }
  enemySafetyPriority(state, ownAction, enemyAction) {
    const ownPose = this.projectedPose(state, 0, ownAction);
    const enemyPose = this.projectedPose(state, 1, enemyAction);
    const ownCell = Math.floor(ownPose / 4); const enemyCell = Math.floor(enemyPose / 4);
    const enemyDirection = enemyPose & 3;
    if (this.directionTo(state, enemyCell, ownCell) === enemyDirection &&
        this.clearLine(state, enemyCell, ownCell)) return 0;
    const distance = Math.abs(state.x(enemyCell) - state.x(ownCell)) +
      Math.abs(state.y(enemyCell) - state.y(ownCell));
    return distance <= 2 ? 1 : 2;
  }
  orderForSafety(state, ownAction, enemyActions, enemyOrder, enemyCount) {
    const order = this.evaluationOrder; const priority = this.evaluationPriority;
    for (let index = 0; index < enemyCount; index += 1) {
      order[index] = enemyOrder[index];
      priority[index] = this.enemySafetyPriority(state, ownAction, enemyActions[order[index]]);
    }
    for (let index = 1; index < enemyCount; index += 1) {
      const column = order[index];
      const value = priority[index];
      let at = index;
      while (at > 0 && priority[at - 1] > value) {
        order[at] = order[at - 1]; priority[at] = priority[at - 1]; at -= 1;
      }
      order[at] = column; priority[at] = value;
    }
    return order;
  }
  evaluateOutcome(bundle, evaluator, action0, argument0, action1, argument1,
      chance0, chance1, nodeBudget, remainingDepth = 1, baseRisk = 0) {
    if (!this.canConsumeWork(bundle)) {
      this.workInterruptedCount += 1; this.interruptedCount += 1;
      this.supportComplete = 0; this.approximate = 1;
      return this.adjustShallowLeaf(evaluator, bundle.state, evaluator.heuristic(bundle.state));
    }
    const status = bundle.kernel.applyFrame(action0, argument0,
      action1, argument1, chance0, chance1);
    this.nodes += 1;
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) return -22000;
    const mark = bundle.kernel.lastMark; const hard = bundle.hard.classifyApplied();
    const terminal = bundle.hard.lastTerminal; let value;
    if (hard === HARD_STATUS.REJECT_POLICY) value = -27500;
    else if (terminal && terminal !== TERMINAL.INCOMPLETE) value = this.terminalValue(terminal);
    else if (hard === HARD_STATUS.REJECT_PROVEN) value = -28000;
    else if (hard === HARD_STATUS.INCOMPLETE) value = evaluator.heuristic(bundle.state) - 6000;
    else {
      // Safety evidence owns a small budget that value continuation cannot
      // consume. Without this reservation an early benign matrix cell could
      // spend the whole row pool and make a later TURN->FIRE trap look safe.
      let trap = 0; let trapComplete = 0;
      if (this.trapProbeBudget > 0) {
        let trapBudget = this.trapProbeBudget;
        if (this.workUnitLimit) {
          const perNode = this.runtimeConfig.WORK_CHARGES[WORK_KIND.FAST_TRANSITION] +
            this.runtimeConfig.WORK_CHARGES[WORK_KIND.HARD];
          trapBudget = Math.min(trapBudget, Math.max(0,
            Math.floor((this.workUnitLimit - this.updateWorkMeter(bundle)) / perNode)));
        }
        trap = evaluator.probeDirectFireTrap(bundle, trapBudget);
        this.trapProbeBudget -= evaluator.lastTrapProbeNodes;
        this.nodes += evaluator.lastTrapProbeNodes;
        trapComplete = trap >= 0 ? 1 : 0;
      }
      if (trap === 1) value = -29900;
      else if (remainingDepth > 1 && this.continuationPoolRemaining >= 8 &&
          typeof evaluator.continuationValue === "function" &&
          nodeBudget >= this.nodes + 8) {
        this.continuationRequiredCount += 1;
        let leafBudget = Math.min(this.continuationLeafBudget, this.continuationPoolRemaining,
          Math.max(0, nodeBudget - this.nodes));
        if (this.workUnitLimit) {
          const perNode = this.runtimeConfig.WORK_CHARGES[WORK_KIND.FAST_TRANSITION] +
            this.runtimeConfig.WORK_CHARGES[WORK_KIND.HARD];
          leafBudget = Math.min(leafBudget, Math.max(0,
            Math.floor((this.workUnitLimit - this.updateWorkMeter(bundle)) / perNode)));
        }
        if (leafBudget < 8) {
          this.continuationRequiredCount += 1;
          value = evaluator.heuristic(bundle.state);
          value = this.adjustShallowLeaf(evaluator, bundle.state, value);
          bundle.state.undoTo(mark); return value;
        }
        value = evaluator.continuationValue(bundle, remainingDepth - 1,
          leafBudget, baseRisk, trapComplete);
        const spent = evaluator.lastContinuationNodes || 0;
        this.nodes += spent;
        this.continuationPoolRemaining = Math.max(0, this.continuationPoolRemaining - spent);
        if (evaluator.lastContinuationAttemptedDepth > this.physicalContinuationAttemptedDepth)
          this.physicalContinuationAttemptedDepth = evaluator.lastContinuationAttemptedDepth;
        if (evaluator.lastContinuationCompletedDepth > this.physicalContinuationDepth)
          this.physicalContinuationDepth = evaluator.lastContinuationCompletedDepth;
        if (evaluator.lastContinuationComplete) this.continuationCompletedCount += 1;
        if (evaluator.lastContinuationUsable === 0) value = evaluator.heuristic(bundle.state);
        // Physical continuation ignores Info adjacency posture; apply the same
        // shallow liability so escape vs commitment still separates when the
        // Physical 1-ply returns near-ties.
        value = this.adjustShallowLeaf(evaluator, bundle.state, value);
      } else {
        if (remainingDepth > 1) this.continuationRequiredCount += 1;
        value = evaluator.heuristic(bundle.state);
        value = this.adjustShallowLeaf(evaluator, bundle.state, value);
      }
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
      decisionDepth = 1, workUnitBudget = 0) {
    this.resetRoot();
    this.supportComplete = supportComplete ? 1 : 0; this.approximate = supportComplete ? 0 : 1;
    if (!bundle || !worldCount || !ourCount || !enemyCount || nodeBudget < 1) return 0;
    this.beginWorkMeter(bundle, workUnitBudget);
    const requestedDepth = Math.max(1, Math.min(SEARCH_CAPACITY.MAX_DECISION_DEPTH,
      Number.isInteger(decisionDepth) ? decisionDepth : 1));
    this.attemptedDepth = requestedDepth;
    const state = bundle.state; const a = state.arrays; const originalCell = a[ARRAY.TANK_CELL][1];
    const originalDirection = a[ARRAY.TANK_DIR][1]; const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    // Soft-top enemy columns by nominal probability when the full matrix cannot
    // leave room for depth-2 continuation. Never drop below two columns.
    let effectiveEnemyCount = Math.min(enemyCount, this.maximumEnemyColumns);
    const enemyOrder = this.enemyOrder;
    for (let column = 0; column < enemyCount; column += 1) enemyOrder[column] = column;
    for (let i = 0; i < enemyCount; i += 1)
      for (let j = i + 1; j < enemyCount; j += 1)
        if (enemyProbability[enemyOrder[j]] > enemyProbability[enemyOrder[i]]) {
          const swap = enemyOrder[i]; enemyOrder[i] = enemyOrder[j]; enemyOrder[j] = swap;
        }
    // Reserve continuation first when recursion is requested — depth-2 value
    // discrimination beats an oversized depth-1 matrix that leaves no leftover.
    let continuationReserve = 0;
    if (requestedDepth > 1 && typeof evaluator.continuationValue === "function" &&
        nodeBudget >= 48) {
      const continuationDepth = requestedDepth - 1;
      continuationReserve = Math.min(nodeBudget - 1, Math.max(40,
        Math.floor(nodeBudget * Math.min(3, continuationDepth) /
          (Math.min(3, continuationDepth) + 3))));
      // Cap enemy breadth so every our-row can still receive a fair leaf share.
      if (effectiveEnemyCount > 4) effectiveEnemyCount = 4;
    }
    let matrixBudget = Math.max(1, nodeBudget - continuationReserve);
    let matrixNodes = this.matrixNodeCount(bundle, ourActions, ourCount,
      enemyActions, enemyOrder, effectiveEnemyCount);
    while (effectiveEnemyCount > 2 && matrixNodes > matrixBudget) {
      effectiveEnemyCount -= 1;
      matrixNodes = this.matrixNodeCount(bundle, ourActions, ourCount,
        enemyActions, enemyOrder, effectiveEnemyCount);
    }
    if (!matrixNodes || matrixNodes > matrixBudget) {
      // Still too large even at two enemy columns: drop the reserve and try a
      // pure depth-1 matrix inside the full budget.
      continuationReserve = 0; matrixBudget = nodeBudget;
      effectiveEnemyCount = enemyCount;
      matrixNodes = this.matrixNodeCount(bundle, ourActions, ourCount,
        enemyActions, enemyOrder, effectiveEnemyCount);
      while (effectiveEnemyCount > 2 && matrixNodes > matrixBudget) {
        effectiveEnemyCount -= 1;
        matrixNodes = this.matrixNodeCount(bundle, ourActions, ourCount,
          enemyActions, enemyOrder, effectiveEnemyCount);
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
    let evaluationDepth = 1;
    let continuationPool = 0;
    this.continuationLeafBudget = 0;
    this.continuationPoolRemaining = 0;
    if (continuationReserve > 0 && matrixCost <= matrixBudget) {
      evaluationDepth = requestedDepth;
      continuationPool = Math.min(continuationReserve, Math.max(0, nodeBudget - matrixCost));
      // Fair per-row leaf budget: a shared depleting pool biased early rows.
      this.continuationLeafBudget = Math.max(8,
        Math.floor(continuationPool / Math.max(1, ourCount * 2)));
    }
    this.lastMatrixCost = matrixCost;
    this.lastContinuationPool = continuationPool;
    this.lastEffectiveEnemyCount = effectiveEnemyCount;
    this.lastSelectedWorldCount = selected;
    this.lastDirectionCount = maximumDirections;
    this.attemptedDepth = Math.max(this.attemptedDepth, evaluationDepth);
    this.supportComplete = this.supportComplete && selected === worldCount && inputMass === 10000 &&
      directionComplete && evaluationDepth === 1 && effectiveEnemyCount === enemyCount ? 1 : 0;
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
    const poolPerRow = evaluationDepth > 1 ?
      Math.max(this.continuationLeafBudget, Math.floor(continuationPool / Math.max(1, ourCount))) : 0;
    const retainedMask = effectiveEnemyCount < enemyCount ? this.retainedMask : null;
    if (retainedMask) {
      retainedMask.fill(0, 0, enemyCount);
      for (let index = 0; index < effectiveEnemyCount; index += 1)
        retainedMask[enemyOrder[index]] = 1;
    }
    for (let row = 0; row < ourCount; row += 1) {
      if (typeof evaluator.bindInformationOption === "function")
        evaluator.bindInformationOption(row);
      this.continuationPoolRemaining = poolPerRow;
      const evaluationOrder = this.orderForSafety(state, ourActions[row],
        enemyActions, enemyOrder, effectiveEnemyCount);
      let enemyExpected = 0; let enemyWorst = INFORMATION_VALUE_MAX;
      for (let index = 0; index < effectiveEnemyCount; index += 1) {
        const column = evaluationOrder[index];
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
              evaluationDepth);
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
    if (typeof evaluator.bindInformationOption === "function")
      evaluator.bindInformationOption(-1);
    this.worldsEvaluated = selected; this.informationRootDepth = 1;
    this.completedDepth = this.informationRootDepth + this.physicalContinuationDepth;
    this.continuationCoveragePer10000 = this.continuationRequiredCount > 0 ?
      Math.floor(this.continuationCompletedCount * 10000 / this.continuationRequiredCount) : 10000;
    a[ARRAY.TANK_CELL][1] = originalCell; a[ARRAY.TANK_DIR][1] = originalDirection;
    state.initializeHash(); state.undoTo(rootMark);
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== rootMark) {
      this.rootRestoreFailures += 1; this.completedDepth = 0;
      this.updateWorkMeter(bundle); return 0;
    }
    this.updateWorkMeter(bundle); return 1;
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
