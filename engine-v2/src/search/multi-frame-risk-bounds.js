"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { CAPACITY, RULE } = require("../generated/fast-config");
const { ACTION, HARD_STATUS, TERRAIN, NONE_FRAME, NONE_CELL, DX, DY } =
  require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { SAFETY_STATUS, SAFETY_HORIZON, NONE_FATAL_FRAME,
  FRONTIER_ACTION_MASS_UPPER } = require("./information-safety-closure");

const RISK_BOUNDS_STATUS = Object.freeze({ NOT_APPLICABLE: 0, APPLIED: 1, INCOMPLETE: 2,
  BUDGET: 3, CAPACITY: 4 });
const POSITION_STATES = CAPACITY.MAX_CELLS * 4;
const REACHABLE_PER_LEVEL = 128;
const ROOT_SUPPORT_CAPACITY = SEARCH_CAPACITY.MAX_OUR_ACTIONS *
  SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES;

class MultiFrameRiskBounds {
  constructor() {
    this.deathMass = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS * SAFETY_HORIZON);
    this.stagedDeathMass = new Uint16Array(this.deathMass.length);
    this.possibleDeathMass = new Uint16Array(this.deathMass.length);
    this.stagedPossibleDeathMass = new Uint16Array(this.deathMass.length);
    this.earliestFatalFrame = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.actionComplete = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.layerStates = new Uint16Array((SAFETY_HORIZON + 1) * REACHABLE_PER_LEVEL);
    this.layerCount = new Uint8Array(SAFETY_HORIZON + 1);
    this.seen = new Uint16Array(POSITION_STATES); this.seenGeneration = 0;
    this.riskNext = new Uint16Array(POSITION_STATES);
    this.riskCurrent = new Uint16Array(POSITION_STATES);
    this.choice = new Uint8Array((SAFETY_HORIZON + 1) * POSITION_STATES);
    this.choiceNextState = new Uint16Array((SAFETY_HORIZON + 1) * POSITION_STATES);
    this.threatMassCache = new Uint16Array((SAFETY_HORIZON + 1) * CAPACITY.MAX_CELLS);
    this.fireThreatMassCache = new Uint16Array(this.threatMassCache.length);
    this.possibleThreatMassCache = new Uint16Array(this.threatMassCache.length);
    this.possibleHazardBuildCount = 0; this.possibleHazardCacheHitCount = 0;
    this.possibleHazardCacheHit = 0;
    this.threatMassStamp = new Uint16Array(this.threatMassCache.length);
    this.threatGeneration = 0;
    this.traceMass = new Uint16Array(SAFETY_HORIZON);
    this.traceFireMass = new Uint16Array(SAFETY_HORIZON);
    this.tracePossibleMass = new Uint16Array(SAFETY_HORIZON);
    this.rootSupportState = new Uint16Array(ROOT_SUPPORT_CAPACITY);
    this.rootSupportRow = new Uint8Array(ROOT_SUPPORT_CAPACITY);
    this.rootSupportCount = 0;
    this.status = RISK_BOUNDS_STATUS.NOT_APPLICABLE; this.nodes = 0;
    this.completedActions = 0; this.appliedActions = 0; this.interrupted = 0;
    this.capacityStops = 0; this.hotAllocationCount = 0;
    this.futureFireActive = 0; this.possibleProjectileActive = 0;
    this.possibleProjectiles = null; this.worldDirectionMask = null;
    this.hiddenProjectiles = null;
    this.possibleHazardCacheHit = 0;
    this.choiceStamp = new Uint16Array(POSITION_STATES); this.choiceGeneration = 0;
    this.evaluatedFrame = NONE_FRAME;
  }
  reset(count) {
    this.deathMass.fill(0, 0, count * SAFETY_HORIZON);
    this.stagedDeathMass.fill(0, 0, count * SAFETY_HORIZON);
    this.possibleDeathMass.fill(0, 0, count * SAFETY_HORIZON);
    this.stagedPossibleDeathMass.fill(0, 0, count * SAFETY_HORIZON);
    this.earliestFatalFrame.fill(NONE_FATAL_FRAME, 0, count);
    this.actionComplete.fill(0, 0, count); this.status = RISK_BOUNDS_STATUS.NOT_APPLICABLE;
    this.nodes = 0; this.completedActions = 0; this.appliedActions = 0;
    this.interrupted = 0; this.capacityStops = 0; this.rootSupportCount = 0;
    this.futureFireActive = 0; this.possibleProjectileActive = 0;
    this.possibleProjectiles = null; this.worldDirectionMask = null;
    this.hiddenProjectiles = null; this.evaluatedFrame = NONE_FRAME;
    this.possibleHazardCacheHit = 0;
  }
  target(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ? NONE_CELL :
      state.cell(x, y);
  }
  walk(state, cell, direction, speed) {
    const terrain = state.arrays[ARRAY.TERRAIN]; let current = cell;
    for (let step = 0; step < speed; step += 1) {
      const next = this.target(state, current, direction);
      if (next === NONE_CELL || terrain[next] === TERRAIN.WALL || terrain[next] === TERRAIN.DIRT)
        break;
      current = next;
    }
    return current;
  }
  clearLine(state, from, to) {
    const fx = state.x(from); const fy = state.y(from); const tx = state.x(to); const ty = state.y(to);
    if (fx !== tx && fy !== ty) return 0;
    const dx = tx === fx ? 0 : tx > fx ? 1 : -1; const dy = ty === fy ? 0 : ty > fy ? 1 : -1;
    const terrain = state.arrays[ARRAY.TERRAIN]; let x = fx + dx; let y = fy + dy;
    while (x !== tx || y !== ty) {
      const tile = terrain[state.cell(x, y)];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
      x += dx; y += dy;
    }
    return 1;
  }
  escapeCount(state, cell, shotDirection) {
    const terrain = state.arrays[ARRAY.TERRAIN]; let count = 0;
    let next = this.target(state, cell, (shotDirection + 3) & 3);
    if (next !== NONE_CELL && terrain[next] !== TERRAIN.WALL && terrain[next] !== TERRAIN.DIRT)
      count += 1;
    next = this.target(state, cell, (shotDirection + 1) & 3);
    if (next !== NONE_CELL && terrain[next] !== TERRAIN.WALL && terrain[next] !== TERRAIN.DIRT)
      count += 1;
    return count;
  }
  threatDepth(state, worldCell, worldDirection, targetCell) {
    const dx = Math.abs(state.x(worldCell) - state.x(targetCell));
    const dy = Math.abs(state.y(worldCell) - state.y(targetCell));
    if ((dx === 0 || dy === 0) && this.clearLine(state, worldCell, targetCell)) {
      const wanted = dx === 0 ? state.y(targetCell) < state.y(worldCell) ? 0 : 2 :
        state.x(targetCell) > state.x(worldCell) ? 1 : 3;
      return 1 + (wanted === worldDirection ? 0 : 1);
    }
    return Math.min(dx, dy) + 2;
  }
  threatDepthForWorld(state, worldCell, worldIndex, fallbackDirection, targetCell) {
    const mask = this.worldDirectionMask ? this.worldDirectionMask[worldIndex] :
      1 << fallbackDirection;
    let best = SAFETY_HORIZON + 1;
    for (let direction = 0; direction < 4; direction += 1)
      if ((mask & (1 << direction)) !== 0) {
        const depth = this.threatDepth(state, worldCell, direction, targetCell);
        if (depth < best) best = depth;
      }
    return best;
  }
  jointThreatMass(worldMass, fireMass, depth) {
    let mass = Math.max(1, Math.min(10000, Math.floor(worldMass * fireMass / 10000)));
    for (let step = 1; step < depth; step += 1)
      mass = Math.max(1, Math.floor(mass * FRONTIER_ACTION_MASS_UPPER / 10000));
    return mass;
  }
  threatMass(state, cell, depth, worldCells, worldMass, worldCount,
      timeline, lastEnemyDirection, enemyFireProbability, nodeBudget) {
    if (this.nodes >= nodeBudget) { this.interrupted = 1; return 0; }
    this.nodes += 1;
    let total = 0;
    for (let world = 0; world < worldCount; world += 1) {
      const required = this.threatDepthForWorld(state, worldCells[world], world,
        lastEnemyDirection, cell);
      const earliestRelease = timeline.earliestCompletion(required);
      if (earliestRelease > depth) continue;
      const aligned = this.clearLine(state, worldCells[world], cell);
      let supported = !aligned;
      let massDepth = earliestRelease;
      if (aligned) {
        const distance = Math.abs(state.x(worldCells[world]) - state.x(cell)) +
          Math.abs(state.y(worldCells[world]) - state.y(cell));
        const travelFrames = Math.max(1, Math.floor((distance + RULE.PROJECTILE_STEPS - 1) /
          RULE.PROJECTILE_STEPS));
        const latestRelease = depth - travelFrames + 1;
        supported = latestRelease >= earliestRelease;
        massDepth = latestRelease;
      }
      if (supported) total = Math.min(10000, total +
        this.jointThreatMass(worldMass[world], enemyFireProbability, massDepth));
    }
    return total;
  }
  active(a, id, frame) { return a[id][0] !== NONE_FRAME && a[id][0] > frame; }
  ownCadenceComplete(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.active(a, ARRAY.TANK_POISON_UNTIL, frame) &&
        a[ARRAY.TANK_POISON_APPLIED][0] === NONE_FRAME) return 0;
    return 1;
  }
  canActAt(state, actionFrame) {
    const a = state.arrays;
    if (this.active(a, ARRAY.TANK_FROZEN_UNTIL, actionFrame)) return 0;
    if (this.active(a, ARRAY.TANK_POISON_UNTIL, actionFrame))
      return ((actionFrame - a[ARRAY.TANK_POISON_APPLIED][0]) & 1) === 0 ? 1 : 0;
    return 1;
  }
  speedAt(state, actionFrame) {
    return this.active(state.arrays, ARRAY.TANK_BOOST_UNTIL, actionFrame) ? 2 : 1;
  }
  stunnedAt(state, actionFrame) {
    return this.active(state.arrays, ARRAY.TANK_STUN_UNTIL, actionFrame);
  }
  nextGeneration() {
    this.seenGeneration = (this.seenGeneration + 1) & 0xffff;
    if (this.seenGeneration === 0) { this.seen.fill(0); this.seenGeneration = 1; }
    return this.seenGeneration;
  }
  nextThreatGeneration() {
    this.threatGeneration = (this.threatGeneration + 1) & 0xffff;
    if (this.threatGeneration === 0) {
      this.threatMassStamp.fill(0); this.threatGeneration = 1;
    }
    return this.threatGeneration;
  }
  preparePossibleHazards(state, nodeBudget) {
    if (!this.possibleProjectileActive) return 1;
    const tracker = this.possibleProjectiles;
    const hidden = this.hiddenProjectiles;
    const trackerCount = tracker ? tracker.pool.activeCount : 0;
    if (hidden) hidden.prepareHorizon(state, SAFETY_HORIZON);
    const work = trackerCount * SAFETY_HORIZON * RULE.PROJECTILE_STEPS +
      (hidden ? hidden.horizonNodes : 0);
    if (this.nodes + work > nodeBudget) { this.interrupted = 1; return 0; }
    let built = 0;
    if (tracker) {
      const builds = tracker.horizonBuildCount; tracker.prepareHorizon(state, SAFETY_HORIZON);
      this.possibleHazardCacheHit = tracker.horizonCacheHit;
      if (tracker.horizonBuildCount !== builds) built = 1;
      else this.possibleHazardCacheHitCount += 1;
    }
    if (hidden) built = 1;
    if (built) { this.nodes += work; this.possibleHazardBuildCount += 1; }
    return 1;
  }
  cachedThreatMass(state, cell, depth, worldCells, worldMass, worldCount,
      timeline, lastEnemyDirection, enemyFireProbability, nodeBudget) {
    const at = depth * CAPACITY.MAX_CELLS + cell;
    if (this.threatMassStamp[at] === this.threatGeneration) return this.threatMassCache[at];
    const fire = this.futureFireActive ? this.threatMass(state, cell, depth, worldCells,
      worldMass, worldCount, timeline, lastEnemyDirection, enemyFireProbability, nodeBudget) : 0;
    if (this.interrupted) return 0;
    let possible = 0;
    if (this.possibleProjectileActive) {
      if (this.possibleProjectiles)
        possible = this.possibleProjectiles.preparedLethalMassAt(cell, depth);
      if (this.hiddenProjectiles)
        possible = this.unionMass(possible,
          this.hiddenProjectiles.preparedLethalMassAt(cell, depth));
    }
    const mass = this.unionMass(fire, possible);
    if (!this.interrupted) {
      this.fireThreatMassCache[at] = fire; this.possibleThreatMassCache[at] = possible;
      this.threatMassCache[at] = mass; this.threatMassStamp[at] = this.threatGeneration;
    }
    return mass;
  }
  addReachable(level, stateId, generation) {
    if (this.seen[stateId] === generation) return 1;
    const count = this.layerCount[level];
    if (count >= REACHABLE_PER_LEVEL) { this.capacityStops += 1; return 0; }
    this.seen[stateId] = generation;
    this.layerStates[level * REACHABLE_PER_LEVEL + count] = stateId;
    this.layerCount[level] = count + 1; return 1;
  }
  collidesWithWorld(cell, worldCells, worldCount) {
    for (let world = 0; world < worldCount; world += 1)
      if (worldCells[world] === cell) return 1;
    return 0;
  }
  buildReachable(state, startStates, startCount, worldCells, worldCount) {
    this.layerCount.fill(0); let generation = this.nextGeneration();
    for (let root = 0; root < startCount; root += 1)
      if (!this.addReachable(1, startStates[root], generation)) return 0;
    const rootFrame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    for (let level = 1; level < SAFETY_HORIZON; level += 1) {
      generation = this.nextGeneration(); const nextLevel = level + 1;
      const canAct = this.canActAt(state, rootFrame + level);
      const speed = this.speedAt(state, rootFrame + level);
      const stunned = this.stunnedAt(state, rootFrame + level);
      const count = this.layerCount[level];
      for (let index = 0; index < count; index += 1) {
        const id = this.layerStates[level * REACHABLE_PER_LEVEL + index];
        const cell = id >>> 2; const direction = id & 3;
        if (!this.addReachable(nextLevel, id, generation)) return 0;
        if (!canAct) continue;
        if (!this.addReachable(nextLevel, cell * 4 + ((direction + 3) & 3), generation) ||
            !this.addReachable(nextLevel, cell * 4 + ((direction + 1) & 3), generation)) return 0;
        const moved = this.walk(state, cell, direction, speed) * 4 + direction;
        if (!this.addReachable(nextLevel, moved, generation)) return 0;
        if (stunned) {
          const reversed = this.walk(state, cell, (direction + 2) & 3, speed) * 4 + direction;
          if (!this.addReachable(nextLevel, reversed, generation)) return 0;
        }
        // A hidden/visible tank occupying the destination makes GO resolve as
        // stay in at least one world. Keep both outcomes and take their worst
        // continuation instead of assuming the movement succeeded.
        if (moved !== id && this.collidesWithWorld(moved >>> 2, worldCells, worldCount) &&
            !this.addReachable(nextLevel, id, generation)) return 0;
      }
    }
    return 1;
  }
  unionMass(now, later) {
    return Math.min(10000, now + Math.floor(((10000 - now) * later + 9999) / 10000));
  }
  solveTable(state, worldCells, worldMass, worldCount, timeline, lastEnemyDirection,
      enemyFireProbability, nodeBudget) {
    const rootFrame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    for (let depth = SAFETY_HORIZON; depth >= 1; depth -= 1) {
      const count = this.layerCount[depth];
      for (let index = 0; index < count; index += 1) {
        const id = this.layerStates[depth * REACHABLE_PER_LEVEL + index];
        const cell = id >>> 2; const direction = id & 3;
        const immediate = this.cachedThreatMass(state, cell, depth, worldCells, worldMass,
          worldCount, timeline, lastEnemyDirection, enemyFireProbability, nodeBudget);
        if (this.interrupted) return 0;
        let bestFuture = 0; let bestAction = ACTION.NONE; let bestState = id;
        if (depth < SAFETY_HORIZON) {
          bestFuture = this.riskNext[id];
          if (this.canActAt(state, rootFrame + depth)) {
            const left = cell * 4 + ((direction + 3) & 3);
            const right = cell * 4 + ((direction + 1) & 3);
            const stunned = this.stunnedAt(state, rootFrame + depth);
            let value = this.riskNext[left]; let successor = left;
            if (stunned && this.riskNext[right] > value) {
              value = this.riskNext[right]; successor = right;
            }
            if (value < bestFuture) { bestFuture = value; bestAction = ACTION.TURN_LEFT;
              bestState = successor; }
            value = this.riskNext[right]; successor = right;
            if (stunned && this.riskNext[left] > value) {
              value = this.riskNext[left]; successor = left;
            }
            if (value < bestFuture) { bestFuture = value; bestAction = ACTION.TURN_RIGHT;
              bestState = successor; }
            const moved = this.walk(state, cell, direction,
              this.speedAt(state, rootFrame + depth)) * 4 + direction;
            value = this.riskNext[moved];
            let goState = moved;
            if (moved !== id && this.collidesWithWorld(moved >>> 2, worldCells, worldCount) &&
              this.riskNext[id] > value) { value = this.riskNext[id]; goState = id; }
            if (stunned) {
              const reversed = this.walk(state, cell, (direction + 2) & 3,
                this.speedAt(state, rootFrame + depth)) * 4 + direction;
              let reversedValue = this.riskNext[reversed]; let reversedState = reversed;
              if (reversed !== id &&
                  this.collidesWithWorld(reversed >>> 2, worldCells, worldCount) &&
                  this.riskNext[id] > reversedValue) {
                reversedValue = this.riskNext[id]; reversedState = id;
              }
              if (reversedValue > value) { value = reversedValue; goState = reversedState; }
            }
            if (value < bestFuture) { bestFuture = value; bestAction = ACTION.GO;
              bestState = goState; }
          }
        }
        this.riskCurrent[id] = this.unionMass(immediate, bestFuture);
        this.choice[depth * POSITION_STATES + id] = bestAction;
        this.choiceNextState[depth * POSITION_STATES + id] = bestState;
        if (depth === 1) this.choiceStamp[id] = this.choiceGeneration;
      }
      const swap = this.riskNext; this.riskNext = this.riskCurrent; this.riskCurrent = swap;
    }
    return this.interrupted ? 0 : 1;
  }
  traceSupport(state, startState, worldCells, worldMass, worldCount, timeline,
      lastEnemyDirection, enemyFireProbability, nodeBudget) {
    this.traceMass.fill(0); this.traceFireMass.fill(0); this.tracePossibleMass.fill(0);
    let id = startState;
    for (let depth = 1; depth <= SAFETY_HORIZON; depth += 1) {
      this.traceMass[depth - 1] = this.cachedThreatMass(state, id >>> 2, depth, worldCells,
        worldMass, worldCount, timeline, lastEnemyDirection, enemyFireProbability, nodeBudget);
      const at = depth * CAPACITY.MAX_CELLS + (id >>> 2);
      this.traceFireMass[depth - 1] = this.fireThreatMassCache[at];
      this.tracePossibleMass[depth - 1] = this.possibleThreatMassCache[at];
      if (this.interrupted || depth === SAFETY_HORIZON) break;
      id = this.choiceNextState[depth * POSITION_STATES + id];
    }
    return this.interrupted ? 0 : 1;
  }
  evaluate(bundle, actionCount, hardStatus, chanceSupportCount, chanceIncompleteSupportCount,
      chanceCell, chanceDirection, worldCells, worldMass, worldCount, supportComplete,
      timeline, lastEnemyDirection, enemyFireProbability, nodeBudget, safety,
      possibleProjectiles = null, worldDirectionMask = null,
      riskSupportComplete = supportComplete, hiddenProjectiles = null) {
    this.reset(actionCount);
    if (!bundle || !bundle.state || !safety)
      return this.status;
    let activeFutureFire = 0;
    if (timeline && timeline.hasFireSupport) for (let row = 0; row < actionCount && !activeFutureFire;
      row += 1) {
      const base = row * SAFETY_HORIZON;
      for (let depth = 0; depth < SAFETY_HORIZON; depth += 1)
        if (safety.futureFireDeathMass[base + depth] > 0) { activeFutureFire = 1; break; }
    }
    const activePossible = possibleProjectiles && possibleProjectiles.count() > 0 ||
      hiddenProjectiles && hiddenProjectiles.count() > 0 ? 1 : 0;
    if (activePossible && !supportComplete && riskSupportComplete && timeline && timeline.hasFireSupport)
      activeFutureFire = 1;
    if (!activeFutureFire && !activePossible) return this.status;
    if (!riskSupportComplete || (activeFutureFire && (!timeline || !timeline.complete || worldCount < 1)) ||
        (activePossible && (possibleProjectiles && !possibleProjectiles.pool.complete ||
          hiddenProjectiles && hiddenProjectiles.count() > 0 && !hiddenProjectiles.complete)) ||
        !this.ownCadenceComplete(bundle.state)) {
      this.status = RISK_BOUNDS_STATUS.INCOMPLETE; return this.status;
    }
    this.futureFireActive = activeFutureFire; this.possibleProjectileActive = activePossible;
    this.possibleProjectiles = possibleProjectiles; this.worldDirectionMask = worldDirectionMask;
    this.hiddenProjectiles = hiddenProjectiles;
    this.choiceGeneration = (this.choiceGeneration + 1) & 0xffff;
    if (!this.choiceGeneration) { this.choiceStamp.fill(0); this.choiceGeneration = 1; }
    this.evaluatedFrame = bundle.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    this.nextThreatGeneration();
    if (!this.preparePossibleHazards(bundle.state, nodeBudget)) {
      this.status = RISK_BOUNDS_STATUS.BUDGET; return this.status;
    }
    for (let row = 0; row < actionCount; row += 1) {
      if (hardStatus[row] !== HARD_STATUS.ALLOW) { this.actionComplete[row] = 1; continue; }
      const supports = chanceSupportCount ? chanceSupportCount[row] : 1;
      if (supports < 1 || (chanceIncompleteSupportCount && chanceIncompleteSupportCount[row])) {
        this.status = RISK_BOUNDS_STATUS.INCOMPLETE; return this.status;
      }
      for (let chance = 0; chance < supports; chance += 1) {
        const at = row * SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES + chance;
        const cell = chanceCell[at]; const direction = chanceDirection[at];
        if (cell === NONE_CELL || cell >= bundle.state.cells || direction > 3 ||
            this.rootSupportCount >= ROOT_SUPPORT_CAPACITY) {
          this.status = RISK_BOUNDS_STATUS.INCOMPLETE; return this.status;
        }
        this.rootSupportState[this.rootSupportCount] = cell * 4 + direction;
        this.rootSupportRow[this.rootSupportCount++] = row;
      }
      this.actionComplete[row] = 1; this.completedActions += 1;
    }
    if (!this.buildReachable(bundle.state, this.rootSupportState, this.rootSupportCount,
      worldCells, worldCount) || !this.solveTable(bundle.state, worldCells, worldMass,
      worldCount, timeline, lastEnemyDirection, enemyFireProbability, nodeBudget)) {
      this.status = this.interrupted ? RISK_BOUNDS_STATUS.BUDGET :
        RISK_BOUNDS_STATUS.CAPACITY; return this.status;
    }
    for (let support = 0; support < this.rootSupportCount; support += 1) {
      if (!this.traceSupport(bundle.state, this.rootSupportState[support], worldCells,
        worldMass, worldCount, timeline, lastEnemyDirection, enemyFireProbability, nodeBudget)) {
        this.status = RISK_BOUNDS_STATUS.BUDGET; return this.status;
      }
      const rowBase = this.rootSupportRow[support] * SAFETY_HORIZON;
      for (let depth = 0; depth < SAFETY_HORIZON; depth += 1)
        if (this.traceFireMass[depth] > this.stagedDeathMass[rowBase + depth])
          this.stagedDeathMass[rowBase + depth] = this.traceFireMass[depth];
      for (let depth = 0; depth < SAFETY_HORIZON; depth += 1)
        if (this.tracePossibleMass[depth] > this.stagedPossibleDeathMass[rowBase + depth])
          this.stagedPossibleDeathMass[rowBase + depth] = this.tracePossibleMass[depth];
    }
    for (let index = 0; index < actionCount * SAFETY_HORIZON; index += 1)
      this.deathMass[index] = Math.max(this.stagedDeathMass[index],
        safety.futureFireDeathMass[index]);
    for (let index = 0; index < actionCount * SAFETY_HORIZON; index += 1)
      this.possibleDeathMass[index] = Math.max(this.stagedPossibleDeathMass[index],
        safety.possibleProjectileDeathMass[index]);
    for (let row = 0; row < actionCount; row += 1) {
      if (hardStatus[row] !== HARD_STATUS.ALLOW) continue; const base = row * SAFETY_HORIZON;
      if (this.futureFireActive) safety.replaceFutureFire(row, this.deathMass, base);
      if (this.possibleProjectileActive)
        safety.replacePossibleProjectile(row, this.possibleDeathMass, base);
      let earliest = NONE_FATAL_FRAME;
      for (let depth = 0; depth < SAFETY_HORIZON; depth += 1)
        if (this.deathMass[base + depth] > 0) { earliest = depth + 1; break; }
      this.earliestFatalFrame[row] = earliest; safety.futureFireDepth[row] = earliest;
      if (safety.status[row] !== SAFETY_STATUS.PROVEN_DEAD) {
        if (safety.horizonFatalMass[row] > 0) safety.status[row] = SAFETY_STATUS.POSSIBLE_DEATH;
        else if (safety.status[row] === SAFETY_STATUS.POSSIBLE_DEATH)
          safety.status[row] = SAFETY_STATUS.UNKNOWN;
      }
      this.appliedActions += 1;
    }
    this.status = RISK_BOUNDS_STATUS.APPLIED; return this.status;
  }
  recommendedContinuation(state) {
    if (!state || this.status !== RISK_BOUNDS_STATUS.APPLIED || this.evaluatedFrame === NONE_FRAME ||
        state.arrays[ARRAY.SCALAR][SCALAR.FRAME] !== this.evaluatedFrame + 1) return ACTION.NONE;
    const id = state.arrays[ARRAY.TANK_CELL][0] * 4 + state.arrays[ARRAY.TANK_DIR][0];
    if (id < 0 || id >= POSITION_STATES || this.choiceStamp[id] !== this.choiceGeneration)
      return ACTION.NONE;
    return this.choice[POSITION_STATES + id];
  }
}

module.exports = { RISK_BOUNDS_STATUS, POSITION_STATES, REACHABLE_PER_LEVEL,
  MultiFrameRiskBounds };
