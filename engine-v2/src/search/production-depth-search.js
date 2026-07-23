"use strict";

const { CAPACITY, RULE } = require("../generated/fast-config");
const { SEARCH_CAPACITY } = require("../generated/search-config");
const { RUNTIME_CONFIG } = require("../generated/runtime-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, SKILL, TERRAIN, TERMINAL, FAST_STATUS, HARD_STATUS, CHANCE,
  BOOST_COMPOUND_BASE, BOOST_COMPOUND_STRIDE, BOOST_COMPOUND_END,
  NONE_FRAME, NONE_CELL, DX, DY } = require("../abi/fast-codes");
const { CACHE_ID, CACHE_FLAG, CACHE_MISS, CACHE_DEPENDENCY } =
  require("../abi/cache-runtime-codes");

const DEPTH_VALUE_MIN = -32000;
const DEPTH_VALUE_MAX = 32000;
const DEPTH_CACHE_VERSION = 2;
const DEEP_WIDTH = 4;
const DIRECT_FIRE_TRAP_NODE_CAP = SEARCH_CAPACITY.MAX_OUR_ACTIONS * 2;
const DIRECT_DEPTH_TWO_MIN_BUDGET = 250;
const SEARCH_SCHEDULE = Object.freeze({ LEGACY_ITERATIVE: 0, DIRECT_DEPTH_TWO: 1 });

function mix(hash, value) {
  let result = (hash ^ (value >>> 0)) >>> 0;
  result = (result + ((result << 1) >>> 0) + ((result << 4) >>> 0) +
    ((result << 7) >>> 0) + ((result << 8) >>> 0) + ((result << 24) >>> 0)) >>> 0;
  return result;
}

class ProductionDepthSearch {
  constructor(cacheBank, runtimeConfig = RUNTIME_CONFIG) {
    const frames = SEARCH_CAPACITY.MAX_DECISION_DEPTH + 1;
    this.cacheBank = cacheBank; this.cache = cacheBank.get(CACHE_ID.PHYSICAL_VALUE_TT);
    this.runtimeConfig = runtimeConfig;
    this.directDepthTwoMinBudget = Number.isInteger(runtimeConfig.DIRECT_DEPTH_TWO_MIN_NODE_BUDGET) ?
      runtimeConfig.DIRECT_DEPTH_TWO_MIN_NODE_BUDGET : DIRECT_DEPTH_TWO_MIN_BUDGET;
    this.frameInitialized = new Uint8Array(frames); this.frameRoot = new Uint8Array(frames);
    this.frameAwaiting = new Uint8Array(frames); this.frameDepth = new Uint8Array(frames);
    this.frameRow = new Uint8Array(frames); this.frameColumn = new Uint8Array(frames);
    this.frameOurCount = new Uint8Array(frames); this.frameEnemyCount = new Uint8Array(frames);
    this.frameOurGeneratedCount = new Uint8Array(frames);
    this.frameEnemyGeneratedCount = new Uint8Array(frames);
    this.frameBestRow = new Uint8Array(frames); this.frameCacheable = new Uint8Array(frames);
    this.frameChanceIndex = new Uint8Array(frames); this.frameChanceCount = new Uint8Array(frames);
    this.frameOwnChanceCount = new Uint8Array(frames);
    this.frameEnemyChanceCount = new Uint8Array(frames);
    this.frameBest = new Int32Array(frames); this.frameWorst = new Int32Array(frames);
    this.frameChanceSum = new Int32Array(frames); this.frameChanceWorst = new Int32Array(frames);
    this.frameMark = new Uint32Array(frames); this.deepOurActions = new Uint8Array(frames * DEEP_WIDTH);
    this.deepOurArguments = new Uint16Array(frames * DEEP_WIDTH);
    this.deepEnemyActions = new Uint8Array(frames * DEEP_WIDTH);
    this.deepEnemyArguments = new Uint16Array(frames * DEEP_WIDTH);
    this.iterationScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rootScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.iterationCellScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.rootCellScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.trapActions = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.trapArguments = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.continuationOurActions = new Uint8Array(DEEP_WIDTH);
    this.continuationOurArguments = new Uint16Array(DEEP_WIDTH);
    this.continuationEnemyActions = new Uint8Array(DEEP_WIDTH);
    this.continuationEnemyArguments = new Uint16Array(DEEP_WIDTH);
    this.lastContinuationNodes = 0;
    this.completedDepth = 0; this.attemptedDepth = 0; this.bestRow = 0;
    this.bestValue = DEPTH_VALUE_MIN; this.nodes = 0; this.cacheProbes = 0; this.baseRisk = 0;
    this.cacheHits = 0; this.cacheWrites = 0; this.interruptedCount = 0;
    this.rootRestoreFailures = 0; this.incompleteTransitions = 0; this.hotAllocationCount = 0;
    this.rootActions = null; this.rootArguments = null; this.rootOurCount = 0;
    this.rootEnemyActions = null; this.rootEnemyArguments = null; this.rootEnemyCount = 0;
    this.lastTrapProbeNodes = 0; this.directFireTrapProbeCount = 0;
    this.directFireTrapProofCount = 0; this.directFireTrapBudgetSkipCount = 0;
    this.trapProbeBudget = 0;
    this.iterationExpansionLimit = 2; this.attemptedExpansionLimit = 0;
    this.completedExpansionLimit = 0; this.iterationGeneratedMax = 0;
    this.iterationTruncatedCount = 0; this.completedGeneratedMax = 0;
    this.completedTruncatedCount = 0; this.representativeSupportComplete = 0;
    this.lastSchedule = SEARCH_SCHEDULE.LEGACY_ITERATIVE;
  }

  resetRoot() {
    this.completedDepth = 0; this.attemptedDepth = 0; this.nodes = 0;
    this.bestValue = DEPTH_VALUE_MIN; this.rootScore.fill(0);
    this.rootCellScore.fill(DEPTH_VALUE_MIN);
    this.iterationExpansionLimit = 2; this.attemptedExpansionLimit = 0;
    this.completedExpansionLimit = 0; this.iterationGeneratedMax = 0;
    this.iterationTruncatedCount = 0; this.completedGeneratedMax = 0;
    this.completedTruncatedCount = 0; this.representativeSupportComplete = 0;
    this.lastSchedule = SEARCH_SCHEDULE.LEGACY_ITERATIVE;
  }

  configureIteration(depth, expansionLimit = 2) {
    const boundedWidth = Number.isInteger(expansionLimit) ? expansionLimit : 2;
    this.iterationExpansionLimit = Math.max(2, Math.min(DEEP_WIDTH, boundedWidth));
    this.attemptedExpansionLimit = this.iterationExpansionLimit;
    this.iterationGeneratedMax = 0; this.iterationTruncatedCount = 0;
    return this.iterationExpansionLimit;
  }

  target(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ? NONE_CELL : state.cell(x, y);
  }
  walkable(state, cell) {
    return cell !== NONE_CELL && state.arrays[ARRAY.TERRAIN][cell] !== TERRAIN.WALL &&
      state.arrays[ARRAY.TERRAIN][cell] !== TERRAIN.DIRT;
  }
  distance(state, left, right) {
    return Math.abs(state.x(left) - state.x(right)) + Math.abs(state.y(left) - state.y(right));
  }
  desiredDirection(state, from, to) {
    const dx = state.x(to) - state.x(from); const dy = state.y(to) - state.y(from);
    if (Math.abs(dx) >= Math.abs(dy) && dx) return dx > 0 ? 1 : 3;
    if (dy) return dy > 0 ? 2 : 0; return -1;
  }
  activeProjectile(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] && a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 1;
    return 0;
  }
  pushTrap(count, action, argument = NONE_CELL) {
    for (let index = 0; index < count; index += 1)
      if (this.trapActions[index] === action && this.trapArguments[index] === argument) return count;
    if (count >= this.trapActions.length) return count;
    this.trapActions[count] = action; this.trapArguments[count] = argument; return count + 1;
  }
  directFireThreat(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_CRASH][0] || a[ARRAY.TANK_CRASH][1] || this.activeProjectile(state, 1) ||
        (a[ARRAY.TANK_FIRE_LOCK][1] !== NONE_FRAME && a[ARRAY.TANK_FIRE_LOCK][1] > frame)) return 0;
    const enemy = a[ARRAY.TANK_CELL][1]; const own = a[ARRAY.TANK_CELL][0];
    return this.desiredDirection(state, enemy, own) === a[ARRAY.TANK_DIR][1] &&
      this.clearLine(state, enemy, own) ? 1 : 0;
  }
  prepareTrapActions(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME]; let count = 0;
    count = this.pushTrap(count, ACTION.NONE); count = this.pushTrap(count, ACTION.GO);
    count = this.pushTrap(count, ACTION.TURN_LEFT); count = this.pushTrap(count, ACTION.TURN_RIGHT);
    if (!this.activeProjectile(state, 0) &&
        (a[ARRAY.TANK_FIRE_LOCK][0] === NONE_FRAME || a[ARRAY.TANK_FIRE_LOCK][0] <= frame))
      count = this.pushTrap(count, ACTION.FIRE);
    const skill = a[ARRAY.TANK_SKILL][0];
    if (skill !== SKILL.NONE && a[ARRAY.TANK_SKILL_READY][0] <= frame) {
      const argument = skill === SKILL.TELEPORT ? this.teleportArgument(state, 0) : NONE_CELL;
      if (skill !== SKILL.TELEPORT || argument !== NONE_CELL)
        count = this.pushTrap(count, ACTION.CAST_SHIELD + skill - SKILL.SHIELD, argument);
    }
    return count;
  }
  probeDirectFireTrap(bundle, nodeBudget) {
    this.lastTrapProbeNodes = 0;
    const state = bundle && bundle.state;
    if (!state || nodeBudget < 1 || !this.directFireThreat(state)) return 0;
    this.directFireTrapProbeCount += 1;
    const count = this.prepareTrapActions(state);
    for (let index = 0; index < count; index += 1) {
      const action = this.trapActions[index];
      const cost = bundle.hard.chanceAlternativeCount(0, action);
      if (this.lastTrapProbeNodes + cost > nodeBudget) {
        this.directFireTrapBudgetSkipCount += 1; return -1;
      }
      const hard = bundle.hard.evaluateAllOwnChance(action, this.trapArguments[index], ACTION.FIRE);
      this.lastTrapProbeNodes += cost;
      if (hard !== HARD_STATUS.REJECT_PROVEN) return 0;
    }
    this.directFireTrapProofCount += 1; return 1;
  }
  hostileProjectileSlot(state, seat) {
    const a = state.arrays; const tank = a[ARRAY.TANK_CELL][seat];
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot] || a[ARRAY.PROJECTILE_OWNER][slot] === seat) continue;
      const projectile = a[ARRAY.PROJECTILE_CELL][slot]; const direction = a[ARRAY.PROJECTILE_DIR][slot];
      const px = state.x(projectile); const py = state.y(projectile);
      const tx = state.x(tank); const ty = state.y(tank);
      const approaching = direction === 0 ? px === tx && py > ty :
        direction === 1 ? py === ty && px < tx : direction === 2 ? px === tx && py < ty :
          py === ty && px > tx;
      if (approaching && this.clearLine(state, projectile, tank)) return slot;
    }
    return -1;
  }
  pushProjectileEvasion(top, state, seat, slot) {
    const a = state.arrays; const current = a[ARRAY.TANK_DIR][seat];
    const projectileDirection = a[ARRAY.PROJECTILE_DIR][slot]; const cell = a[ARRAY.TANK_CELL][seat];
    if ((current & 1) !== (projectileDirection & 1) &&
        this.walkable(state, this.target(state, cell, current))) this.pushDeep(top, seat, ACTION.GO);
    let count = seat ? this.frameEnemyCount[top] : this.frameOurCount[top];
    if (count >= 2) return;
    const leftDirection = (current + 3) & 3; const rightDirection = (current + 1) & 3;
    if ((leftDirection & 1) !== (projectileDirection & 1) &&
        this.walkable(state, this.target(state, cell, leftDirection)))
      this.pushDeep(top, seat, ACTION.TURN_LEFT);
    count = seat ? this.frameEnemyCount[top] : this.frameOurCount[top];
    if (count >= 2) return;
    if ((rightDirection & 1) !== (projectileDirection & 1) &&
        this.walkable(state, this.target(state, cell, rightDirection)))
      this.pushDeep(top, seat, ACTION.TURN_RIGHT);
  }
  pushDeep(top, seat, action, argument = NONE_CELL) {
    const count = seat ? this.frameEnemyCount[top] : this.frameOurCount[top];
    const offset = top * DEEP_WIDTH; const actions = seat ? this.deepEnemyActions : this.deepOurActions;
    const arguments_ = seat ? this.deepEnemyArguments : this.deepOurArguments;
    for (let index = 0; index < count; index += 1) if (actions[offset + index] === action &&
        arguments_[offset + index] === argument) return count;
    if (count >= DEEP_WIDTH) return count; actions[offset + count] = action;
    arguments_[offset + count] = argument;
    if (seat) this.frameEnemyCount[top] = count + 1; else this.frameOurCount[top] = count + 1;
    return count + 1;
  }
  teleportArgument(state, seat) {
    const a = state.arrays; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star === NONE_CELL) return NONE_CELL;
    for (let direction = 0; direction < 4; direction += 1) {
      const cell = this.target(state, star, direction);
      if (this.walkable(state, cell) && cell !== a[ARRAY.TANK_CELL][seat ^ 1]) return cell;
    }
    return NONE_CELL;
  }
  pushDeepSkill(top, state, seat, skill) {
    const action = ACTION.CAST_SHIELD + skill - SKILL.SHIELD;
    const argument = skill === SKILL.TELEPORT ? this.teleportArgument(state, seat) : NONE_CELL;
    if (skill !== SKILL.TELEPORT || argument !== NONE_CELL) this.pushDeep(top, seat, action, argument);
  }
  finishDeepRepresentatives(top, seat, expansionLimit = DEEP_WIDTH) {
    const count = seat ? this.frameEnemyCount[top] : this.frameOurCount[top];
    if (count > this.iterationGeneratedMax) this.iterationGeneratedMax = count;
    if (count > expansionLimit) this.iterationTruncatedCount += count - expansionLimit;
    if (seat) { this.frameEnemyGeneratedCount[top] = count;
      if (count > expansionLimit) this.frameEnemyCount[top] = expansionLimit; }
    else { this.frameOurGeneratedCount[top] = count;
      if (count > expansionLimit) this.frameOurCount[top] = expansionLimit; }
  }
  generateDeep(top, state, seat) {
    if (seat) this.frameEnemyCount[top] = 0; else this.frameOurCount[top] = 0;
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const cell = a[ARRAY.TANK_CELL][seat]; const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
    const current = a[ARRAY.TANK_DIR][seat]; const attackDirection = this.desiredDirection(state, cell, enemy);
    const skill = a[ARRAY.TANK_SKILL][seat]; const skillReady = skill !== SKILL.NONE &&
      a[ARRAY.TANK_SKILL_READY][seat] <= frame;
    const hostileSlot = this.hostileProjectileSlot(state, seat);
    if (hostileSlot >= 0) {
      this.pushProjectileEvasion(top, state, seat, hostileSlot);
      if (skillReady && (skill === SKILL.SHIELD || skill === SKILL.TELEPORT || skill === SKILL.BOOST))
        this.pushDeepSkill(top, state, seat, skill);
      if ((seat ? this.frameEnemyCount[top] : this.frameOurCount[top]) === 0)
        this.pushDeep(top, seat, ACTION.NONE);
      this.finishDeepRepresentatives(top, seat);
      return;
    }
    const canFire = !this.activeProjectile(state, seat) &&
      (a[ARRAY.TANK_FIRE_LOCK][seat] === NONE_FRAME || a[ARRAY.TANK_FIRE_LOCK][seat] <= frame);
    const directFire = canFire && attackDirection === current && this.clearLine(state, cell, enemy);
    const tacticalSkill = skillReady && (skill === SKILL.SHIELD || skill === SKILL.BOOST ||
      skill === SKILL.OVERLOAD || skill === SKILL.TELEPORT ||
      this.distance(state, cell, enemy) <= 6 || this.clearLine(state, cell, enemy));
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const target = star !== NONE_CELL ? star : enemy;
    const wanted = this.desiredDirection(state, cell, target);
    const left = (current + 3) & 3;
    const targetAction = wanted === current ? ACTION.GO :
      wanted === left ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
    const contact = this.distance(state, cell, enemy) <= 6 || this.clearLine(state, cell, enemy);
    if (contact) {
      if (directFire) this.pushDeep(top, seat, ACTION.FIRE);
      this.pushDeep(top, seat, targetAction);
      if (attackDirection !== current) this.pushDeep(top, seat,
        attackDirection === left ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT);
      if (tacticalSkill) this.pushDeepSkill(top, state, seat, skill);
      if ((seat ? this.frameEnemyCount[top] : this.frameOurCount[top]) < DEEP_WIDTH)
        this.pushDeep(top, seat, ACTION.GO);
      this.finishDeepRepresentatives(top, seat, this.iterationExpansionLimit);
    } else {
      this.pushDeep(top, seat, targetAction);
      if (targetAction !== ACTION.GO && this.walkable(state, this.target(state, cell, current)))
        this.pushDeep(top, seat, ACTION.GO);
      else this.pushDeep(top, seat, targetAction === ACTION.TURN_LEFT ?
        ACTION.TURN_RIGHT : ACTION.TURN_LEFT);
      this.finishDeepRepresentatives(top, seat);
    }
  }
  actionAt(top, seat, index) {
    if (this.frameRoot[top]) return seat ? this.rootEnemyActions[index] : this.rootActions[index];
    return (seat ? this.deepEnemyActions : this.deepOurActions)[top * DEEP_WIDTH + index];
  }
  argumentAt(top, seat, index) {
    if (this.frameRoot[top]) return seat ? this.rootEnemyArguments[index] : this.rootArguments[index];
    return (seat ? this.deepEnemyArguments : this.deepOurArguments)[top * DEEP_WIDTH + index];
  }
  mobility(state, seat) {
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][seat]; let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const next = this.target(state, cell, direction);
      if (this.walkable(state, next) && next !== a[ARRAY.TANK_CELL][seat ^ 1]) count += 1;
    }
    return count;
  }
  clearLine(state, from, to) {
    const fromX = state.x(from); const fromY = state.y(from);
    const toX = state.x(to); const toY = state.y(to); if (fromX !== toX && fromY !== toY) return 0;
    const dx = toX === fromX ? 0 : toX > fromX ? 1 : -1;
    const dy = toY === fromY ? 0 : toY > fromY ? 1 : -1; const terrain = state.arrays[ARRAY.TERRAIN];
    let x = fromX + dx; let y = fromY + dy;
    while (x !== toX || y !== toY) { const tile = terrain[state.cell(x, y)];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0; x += dx; y += dy; }
    return 1;
  }
  chanceAlternatives(state, seat, action) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_STUN_UNTIL][seat] === NONE_FRAME ||
        a[ARRAY.TANK_STUN_UNTIL][seat] <= frame) return 1;
    if (action >= BOOST_COMPOUND_BASE && action <= BOOST_COMPOUND_END)
      return (action - BOOST_COMPOUND_BASE) % BOOST_COMPOUND_STRIDE <= 2 ? 4 : 2;
    return action === ACTION.GO || action === ACTION.TURN_LEFT ||
      action === ACTION.TURN_RIGHT ? 2 : 1;
  }
  prepareChance(top, state, action0, action1) {
    if (this.frameChanceCount[top]) return;
    const own = this.chanceAlternatives(state, 0, action0);
    const enemy = this.chanceAlternatives(state, 1, action1);
    this.frameOwnChanceCount[top] = own; this.frameEnemyChanceCount[top] = enemy;
    this.frameChanceCount[top] = own * enemy; this.frameChanceIndex[top] = 0;
    this.frameChanceSum[top] = 0; this.frameChanceWorst[top] = DEPTH_VALUE_MAX;
  }
  chanceCode(top, state, seat, action) {
    const alternatives = seat ? this.frameEnemyChanceCount[top] : this.frameOwnChanceCount[top];
    if (alternatives === 1) return CHANCE.NORMAL;
    const ownAlternatives = this.frameOwnChanceCount[top];
    const variant = seat === 0 ? this.frameChanceIndex[top] % ownAlternatives :
      Math.floor(this.frameChanceIndex[top] / ownAlternatives);
    return variant;
  }
  rootMatrixNodeCount(state) {
    let count = 0;
    for (let row = 0; row < this.rootOurCount; row += 1)
      for (let column = 0; column < this.rootEnemyCount; column += 1)
        count += this.chanceAlternatives(state, 0, this.rootActions[row]) *
          this.chanceAlternatives(state, 1, this.rootEnemyActions[column]);
    return count;
  }
  robustChance(sum, worst, count) {
    const expected = Math.floor(sum / count); const lambda = 99 * this.baseRisk;
    return Math.floor((lambda * expected + (10000 - lambda) * worst) / 10000);
  }
  heuristic(state) {
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    let value = (a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1]) * 3500;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star !== NONE_CELL) value += (this.distance(state, enemy, star) -
      this.distance(state, own, star)) * 350;
    value += (this.mobility(state, 0) - this.mobility(state, 1)) * 300;
    const ownWanted = this.desiredDirection(state, own, enemy);
    const enemyWanted = this.desiredDirection(state, enemy, own);
    if (this.clearLine(state, own, enemy)) {
      if (ownWanted === a[ARRAY.TANK_DIR][0]) value += 1200;
      if (enemyWanted === a[ARRAY.TANK_DIR][1]) value -= 1200;
    }
    if (a[ARRAY.TANK_SKILL_READY][0] <= a[ARRAY.SCALAR][SCALAR.FRAME]) value += 250;
    if (a[ARRAY.TANK_SKILL_READY][1] <= a[ARRAY.SCALAR][SCALAR.FRAME]) value -= 250;
    const remaining = Math.max(0, RULE.FRAME_RECORD_LIMIT - 1 - a[ARRAY.SCALAR][SCALAR.FRAME]);
    if (remaining <= 16) {
      const starDelta = a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1];
      if (starDelta <= 0) value -= (16 - remaining) * (starDelta < 0 ? 650 : 350);
      else value += (16 - remaining) * 350;
    }
    return Math.max(-25000, Math.min(25000, value));
  }
  terminalValue(terminal, remainingDepth) {
    if (terminal === TERMINAL.DRAW) return 0;
    if (terminal === TERMINAL.WIN0) return 30000 + remainingDepth * 100;
    return -30000 - remainingDepth * 100;
  }
  cacheKey(state, depth) {
    return mix(state.hashLo, depth * 257 + this.baseRisk * 65537 +
      this.iterationExpansionLimit * 4099 + 0x51f15e);
  }
  cacheKeyHi(state, depth) {
    return mix(state.hashHi, depth * 65537 + this.baseRisk * 257 +
      this.iterationExpansionLimit * 8191 + 0x9e37);
  }
  cacheSignature(state, depth) {
    const scalar = state.arrays[ARRAY.SCALAR];
    return mix(state.hashLo ^ state.hashHi,
      depth + scalar[SCALAR.FRAME] * 17 + this.baseRisk * 4099 +
      this.iterationExpansionLimit * 131071);
  }
  dependencySignature(state) {
    const scalar = state.arrays[ARRAY.SCALAR];
    return mix(scalar[SCALAR.TOPOLOGY_VERSION], scalar[SCALAR.NEXT_ENTITY]);
  }
  initializeFrame(top, depth, root, state) {
    this.frameInitialized[top] = 1; this.frameRoot[top] = root ? 1 : 0;
    this.frameAwaiting[top] = 0; this.frameDepth[top] = depth; this.frameRow[top] = 0;
    this.frameColumn[top] = 0; this.frameBestRow[top] = 0; this.frameBest[top] = DEPTH_VALUE_MIN;
    this.frameWorst[top] = DEPTH_VALUE_MAX; this.frameCacheable[top] = 1;
    this.frameChanceIndex[top] = 0; this.frameChanceCount[top] = 0;
    this.frameOwnChanceCount[top] = 0; this.frameEnemyChanceCount[top] = 0;
    this.frameChanceSum[top] = 0; this.frameChanceWorst[top] = DEPTH_VALUE_MAX;
    if (root) { this.frameOurCount[top] = this.rootOurCount;
      this.frameEnemyCount[top] = this.rootEnemyCount; }
    else { this.generateDeep(top, state, 0); this.generateDeep(top, state, 1); }
  }
  probeFrame(top, state) {
    if (this.frameRoot[top]) return CACHE_MISS; const depth = this.frameDepth[top];
    const keyLo = this.cacheKey(state, depth); const keyHi = this.cacheKeyHi(state, depth);
    const signatureLo = this.cacheSignature(state, depth); const signatureHi =
      mix(state.hashHi ^ state.hashLo, depth + this.baseRisk * 8191 +
        this.iterationExpansionLimit * 65537 + 0x7f4a);
    this.cacheProbes += 1;
    const slot = this.cache.probe(keyLo, keyHi, signatureLo, signatureHi, DEPTH_CACHE_VERSION);
    if (slot !== CACHE_MISS) this.cacheHits += 1; return slot;
  }
  writeFrame(top, state, value) {
    if (this.frameRoot[top] || !this.frameCacheable[top]) return;
    const depth = this.frameDepth[top]; const slot = this.cache.write(this.cacheKey(state, depth),
      this.cacheKeyHi(state, depth), this.cacheSignature(state, depth),
      mix(state.hashHi ^ state.hashLo, depth + this.baseRisk * 8191 +
        this.iterationExpansionLimit * 65537 + 0x7f4a), DEPTH_CACHE_VERSION,
      this.cache.currentGeneration, CACHE_DEPENDENCY.PHYSICAL | CACHE_DEPENDENCY.TERRAIN |
      CACHE_DEPENDENCY.ENTITY | CACHE_DEPENDENCY.PROFILE | CACHE_DEPENDENCY.ACTION_SET,
      this.dependencySignature(state), CACHE_FLAG.COMPLETE, depth, value,
      this.frameBestRow[top], depth, 0);
    if (slot !== CACHE_MISS) this.cacheWrites += 1;
  }
  consume(top, value, cacheable) {
    if (!cacheable) this.frameCacheable[top] = 0;
    if (this.frameRoot[top]) this.iterationCellScore[this.frameRow[top] *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES + this.frameColumn[top]] = value;
    if (value < this.frameWorst[top]) this.frameWorst[top] = value;
    this.frameColumn[top] += 1;
    if (!this.frameRoot[top] && this.frameWorst[top] <= this.frameBest[top])
      this.frameColumn[top] = this.frameEnemyCount[top];
  }
  consumeOutcome(top, value, cacheable) {
    if (!cacheable) this.frameCacheable[top] = 0;
    this.frameChanceSum[top] += value;
    if (value < this.frameChanceWorst[top]) this.frameChanceWorst[top] = value;
    this.frameChanceIndex[top] += 1;
    if (this.frameChanceIndex[top] < this.frameChanceCount[top]) return 0;
    const robust = this.robustChance(this.frameChanceSum[top], this.frameChanceWorst[top],
      this.frameChanceCount[top]);
    this.frameChanceIndex[top] = 0; this.frameChanceCount[top] = 0;
    this.frameOwnChanceCount[top] = 0; this.frameEnemyChanceCount[top] = 0;
    this.frameChanceSum[top] = 0; this.frameChanceWorst[top] = DEPTH_VALUE_MAX;
    this.consume(top, robust, 1); return 1;
  }
  runIteration(bundle, depth, nodeBudget, expansionLimit = 2) {
    const state = bundle.state; const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed; let top = 0;
    let hasReturn = 0; let returnValue = 0; let returnCacheable = 1;
    this.configureIteration(depth, expansionLimit);
    this.frameInitialized.fill(0); this.iterationScore.fill(DEPTH_VALUE_MIN);
    this.iterationCellScore.fill(DEPTH_VALUE_MIN);
    this.trapProbeBudget = depth === 1 ? Math.min(DIRECT_FIRE_TRAP_NODE_CAP,
      Math.max(0, nodeBudget - this.nodes - this.rootMatrixNodeCount(state))) : 0;
    this.initializeFrame(0, depth, 1, state);
    while (top >= 0) {
      if (hasReturn) {
        if (top < 0) break;
        if (this.frameAwaiting[top]) { state.undoTo(this.frameMark[top]);
          this.frameAwaiting[top] = 0; this.consumeOutcome(top, returnValue, returnCacheable);
          hasReturn = 0; continue; }
      }
      if (!this.frameInitialized[top]) {
        this.initializeFrame(top, this.frameDepth[top], 0, state); const hit = this.probeFrame(top, state);
        if (hit !== CACHE_MISS) { returnValue = this.cache.value0[hit]; returnCacheable = 1;
          this.frameInitialized[top] = 0; top -= 1; hasReturn = 1; continue; }
      }
      if (this.frameRow[top] >= this.frameOurCount[top]) {
        const value = this.frameBest[top]; const cacheable = this.frameCacheable[top];
        this.writeFrame(top, state, value);
        if (this.frameRoot[top]) { this.bestRow = this.frameBestRow[top]; this.bestValue = value; }
        this.frameInitialized[top] = 0; top -= 1; returnValue = value;
        returnCacheable = cacheable; hasReturn = 1; continue;
      }
      if (this.frameColumn[top] >= this.frameEnemyCount[top]) {
        const row = this.frameRow[top]; const value = this.frameWorst[top];
        if (this.frameRoot[top]) this.iterationScore[row] = value;
        if (value > this.frameBest[top]) { this.frameBest[top] = value; this.frameBestRow[top] = row; }
        this.frameRow[top] = row + 1; this.frameColumn[top] = 0;
        this.frameWorst[top] = DEPTH_VALUE_MAX; continue;
      }
      if (this.nodes >= nodeBudget) { this.interruptedCount += 1; state.undoTo(rootMark);
        if (state.hashLo !== rootLo || state.hashHi !== rootHi) this.rootRestoreFailures += 1;
        return 0; }
      const row = this.frameRow[top]; const column = this.frameColumn[top];
      const action0 = this.actionAt(top, 0, row); const argument0 = this.argumentAt(top, 0, row);
      const action1 = this.actionAt(top, 1, column); const argument1 = this.argumentAt(top, 1, column);
      this.prepareChance(top, state, action0, action1);
      const chance0 = this.chanceCode(top, state, 0, action0);
      const chance1 = this.chanceCode(top, state, 1, action1);
      const status = bundle.kernel.applyFrame(action0, argument0, action1, argument1,
        chance0, chance1); this.nodes += 1;
      if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
        this.incompleteTransitions += 1; this.consumeOutcome(top, -22000, 0); continue;
      }
      const mark = bundle.kernel.lastMark; const hard = bundle.hard.classifyApplied();
      const terminal = bundle.hard.lastTerminal; let value = 0; let cacheable = 1;
      if (hard === HARD_STATUS.REJECT_POLICY) { value = -27500; cacheable = 0; }
      else if (terminal && terminal !== TERMINAL.INCOMPLETE)
        value = this.terminalValue(terminal, this.frameDepth[top]);
      else if (hard === HARD_STATUS.REJECT_PROVEN) value = -28000 - this.frameDepth[top] * 50;
      else if (hard === HARD_STATUS.INCOMPLETE) { value = this.heuristic(state) - 6000; cacheable = 0; }
      else if (this.frameDepth[top] <= 1) {
        const trap = this.probeDirectFireTrap(bundle, this.trapProbeBudget);
        this.trapProbeBudget -= this.lastTrapProbeNodes;
        this.nodes += this.lastTrapProbeNodes;
        value = trap === 1 ? -29900 : this.heuristic(state);
      }
      else {
        this.frameMark[top] = mark; this.frameAwaiting[top] = 1; const child = top + 1;
        this.frameDepth[child] = this.frameDepth[top] - 1; this.frameInitialized[child] = 0;
        top = child; continue;
      }
      state.undoTo(mark); this.consumeOutcome(top, value, cacheable);
    }
    state.undoTo(rootMark);
    if (state.hashLo !== rootLo || state.hashHi !== rootHi || state.deltaUsed * 1024 +
        state.eventUsed !== rootMark) { this.rootRestoreFailures += 1; return 0; }
    return 1;
  }
  commitIteration(ourCount, depth) {
    this.completedDepth = depth;
    this.completedExpansionLimit = this.iterationExpansionLimit;
    this.completedGeneratedMax = this.iterationGeneratedMax;
    this.completedTruncatedCount = this.iterationTruncatedCount;
    this.representativeSupportComplete = this.iterationTruncatedCount === 0 ? 1 : 0;
    for (let row = 0; row < ourCount; row += 1) this.rootScore[row] = this.iterationScore[row];
    this.rootCellScore.set(this.iterationCellScore);
  }
  rootStunActive(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    return (a[ARRAY.TANK_STUN_UNTIL][0] !== NONE_FRAME &&
      a[ARRAY.TANK_STUN_UNTIL][0] > frame) ||
      (a[ARRAY.TANK_STUN_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_STUN_UNTIL][1] > frame) ? 1 : 0;
  }
  rootImmediateFireContact(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    for (let seat = 0; seat < 2; seat += 1) {
      if (a[ARRAY.TANK_CRASH][seat] || this.activeProjectile(state, seat) ||
          a[ARRAY.TANK_FIRE_LOCK][seat] !== NONE_FRAME &&
          a[ARRAY.TANK_FIRE_LOCK][seat] > frame) continue;
      const own = a[ARRAY.TANK_CELL][seat]; const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
      if (this.desiredDirection(state, own, enemy) === a[ARRAY.TANK_DIR][seat] &&
          this.clearLine(state, own, enemy)) return 1;
    }
    return 0;
  }
  // Budgeted Physical continuation used as an Information depth-2 leaf. Does not
  // commit completedDepth — InformationSearch owns the published depth.
  continuationValue(bundle, depth, nodeBudget, baseRisk = 0) {
    this.lastContinuationNodes = 0;
    const state = bundle && bundle.state;
    if (!state || !Number.isInteger(depth) || depth < 1 ||
        !Number.isInteger(nodeBudget) || nodeBudget < 4) {
      return this.heuristic(state);
    }
    const before = this.nodes;
    // Cheap trap proof before spending a full Physical iteration.
    const trap = this.probeDirectFireTrap(bundle, Math.min(8, nodeBudget));
    this.nodes += this.lastTrapProbeNodes;
    if (trap === 1) {
      this.lastContinuationNodes = Math.max(0, this.nodes - before);
      return -29900;
    }
    if (nodeBudget - (this.nodes - before) < 8) {
      this.lastContinuationNodes = Math.max(0, this.nodes - before);
      return this.heuristic(state);
    }
    const savedCompleted = this.completedDepth;
    const savedAttempted = this.attemptedDepth;
    this.baseRisk = Math.max(0, Math.min(100, baseRisk | 0));
    // One Physical ply at width 2 after the Information apply — cheaper than
    // Physical depth 2 while still separating escape vs commitment leaves.
    this.configureIteration(1, 2);
    this.generateDeep(0, state, 0); this.generateDeep(0, state, 1);
    let ourCount = this.frameOurCount[0]; let enemyCount = this.frameEnemyCount[0];
    if (ourCount < 1) { this.pushDeep(0, 0, ACTION.NONE); ourCount = 1; }
    if (enemyCount < 1) { this.pushDeep(0, 1, ACTION.NONE); enemyCount = 1; }
    for (let index = 0; index < ourCount; index += 1) {
      this.continuationOurActions[index] = this.deepOurActions[index];
      this.continuationOurArguments[index] = this.deepOurArguments[index];
    }
    for (let index = 0; index < enemyCount; index += 1) {
      this.continuationEnemyActions[index] = this.deepEnemyActions[index];
      this.continuationEnemyArguments[index] = this.deepEnemyArguments[index];
    }
    this.rootActions = this.continuationOurActions;
    this.rootArguments = this.continuationOurArguments;
    this.rootOurCount = ourCount;
    this.rootEnemyActions = this.continuationEnemyActions;
    this.rootEnemyArguments = this.continuationEnemyArguments;
    this.rootEnemyCount = enemyCount;
    this.bestValue = DEPTH_VALUE_MIN;
    const ok = this.runIteration(bundle, 1, before + nodeBudget, 2);
    this.lastContinuationNodes = Math.max(0, this.nodes - before);
    this.completedDepth = savedCompleted;
    this.attemptedDepth = savedAttempted;
    return ok ? this.bestValue : this.heuristic(state);
  }
  search(bundle, ourActions, ourArguments, ourCount, enemyActions, enemyArguments,
      enemyCount, targetDepth, nodeBudget, baseRisk = 0) {
    this.rootActions = ourActions; this.rootArguments = ourArguments; this.rootOurCount = ourCount;
    this.rootEnemyActions = enemyActions; this.rootEnemyArguments = enemyArguments;
    this.rootEnemyCount = enemyCount; this.resetRoot();
    if (!bundle || !Number.isInteger(ourCount) || !Number.isInteger(enemyCount) ||
        ourCount < 1 || enemyCount < 1 || !Number.isInteger(targetDepth) || targetDepth < 1 ||
        !Number.isInteger(nodeBudget) || nodeBudget < 1) return 0;
    this.baseRisk = Math.max(0, Math.min(100, baseRisk | 0));
    const runtime = this.runtimeConfig;
    const reserveCap = Math.max(1, Math.floor((runtime.PER_CALLBACK_WORK_UNIT_LIMIT -
      runtime.MINIMUM_EMERGENCY_BATCH_RESERVE) /
      (runtime.WORK_CHARGES[1] + runtime.WORK_CHARGES[2])));
    const budget = Math.min(nodeBudget, reserveCap, SEARCH_CAPACITY.MAX_NODES);
    const limit = Math.min(targetDepth, SEARCH_CAPACITY.MAX_DECISION_DEPTH);
    if (limit >= 2 && budget >= this.directDepthTwoMinBudget &&
        !this.rootStunActive(bundle.state) && !this.rootImmediateFireContact(bundle.state)) {
      this.lastSchedule = SEARCH_SCHEDULE.DIRECT_DEPTH_TWO; this.attemptedDepth = 2;
      if (this.runIteration(bundle, 2, budget, 2)) this.commitIteration(ourCount, 2);
      return this.completedDepth;
    }
    for (let depth = 1; depth <= limit && this.nodes < budget; depth += 1) {
      this.attemptedDepth = depth;
      if (!this.runIteration(bundle, depth, budget, 2)) break;
      this.commitIteration(ourCount, depth);
    }
    if (this.completedDepth === limit) {
      for (let width = 3; width <= DEEP_WIDTH && this.nodes < budget; width += 1) {
        this.attemptedDepth = limit;
        if (!this.runIteration(bundle, limit, budget, width)) break;
        this.commitIteration(ourCount, limit);
      }
    }
    return this.completedDepth;
  }
}

module.exports = { DEPTH_VALUE_MIN, DEPTH_VALUE_MAX, DIRECT_DEPTH_TWO_MIN_BUDGET,
  SEARCH_SCHEDULE, ProductionDepthSearch };
