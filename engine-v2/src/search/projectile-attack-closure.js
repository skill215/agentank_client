"use strict";

const { CAPACITY, RULE } = require("../generated/fast-config");
const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, SKILL, TERRAIN, NONE_CELL, NONE_FRAME, DX, DY,
  BOOST_COMPOUND_BASE, BOOST_COMPOUND_STRIDE, BOOST_COMPOUND_END } =
  require("../abi/fast-codes");
const { COMBAT_PURPOSE, PLAN_PURPOSE } = require("../abi/policy-codes");

const PAC_STATUS = Object.freeze({
  NONE: 0,
  COMPLETE: 1,
  INCOMPLETE: 2
});

const PAC_CELL = Object.freeze({
  NONE: 0,
  SURVIVES: 1,
  PROVEN_DOOMED: 2,
  UNKNOWN: 3
});

const MAX_NEW_PROJECTILES = 2;
const MAX_TRAJECTORY_TICKS = Math.max(CAPACITY.MAX_MAP_WIDTH, CAPACITY.MAX_MAP_HEIGHT);
const PAC_PRESSURE_MAX = 2500;
const FRONTIER_PRESSURE_MAX = 1600;
const COUNTERFIRE_UNREACHABLE = 0xff;

function clamp(value, minimum, maximum) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

function mix32(hash, value) {
  let result = (hash ^ (value >>> 0)) >>> 0;
  result = (result + ((result << 1) >>> 0) + ((result << 4) >>> 0) +
    ((result << 7) >>> 0) + ((result << 8) >>> 0) +
    ((result << 24) >>> 0)) >>> 0;
  return result;
}

// A tiny HazardKernel-compatible view containing only the projectile(s) that
// candidate FIRE would commit. Enemy-hit branches terminate; survivor branches
// keep following the same deterministic trajectory until normative invalidation.
class ProjectileAttackTimeline {
  constructor() {
    this.state = null;
    this.stepsPerFrame = RULE.PROJECTILE_STEPS;
    this.maxTicks = MAX_TRAJECTORY_TICKS;
    this.memberCount = 0;
    this.horizonTick = 0;
    this.complete = 1;
    this.narrowProofComplete = 1;
    this.cells = new Uint16Array((MAX_TRAJECTORY_TICKS + 1) * MAX_NEW_PROJECTILES);
    this.active = new Uint8Array(MAX_NEW_PROJECTILES);
    this.current = new Uint16Array(MAX_NEW_PROJECTILES);
    this.direction = 0;
    this.buildCount = 0;
    this.hotAllocationCount = 0;
    this.cells.fill(NONE_CELL);
  }

  target(cell, direction) {
    const state = this.state;
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ?
      NONE_CELL : state.cell(x, y);
  }

  rebuild() {
    return this.complete;
  }

  isLethal(tick, cell) {
    if (tick < 1 || tick > this.horizonTick || cell === NONE_CELL) return 0;
    const offset = tick * MAX_NEW_PROJECTILES;
    for (let member = 0; member < this.memberCount; member += 1)
      if (this.cells[offset + member] === cell) return 1;
    return 0;
  }

  isExposed(tick, cell) {
    return this.isLethal(tick, cell);
  }

  addMember(cell) {
    if (this.memberCount >= MAX_NEW_PROJECTILES || cell === NONE_CELL) {
      this.complete = 0; return 0;
    }
    const member = this.memberCount++;
    this.active[member] = 1; this.current[member] = cell;
    this.cells[member] = cell;
    return 1;
  }

  build(state, source, direction, overloaded) {
    this.state = state; this.direction = direction;
    this.memberCount = 0; this.horizonTick = 0; this.complete = 1;
    this.narrowProofComplete = 1;
    this.active.fill(0); this.cells.fill(NONE_CELL);
    if (source === NONE_CELL || direction < 0 || direction > 3 ||
        !this.addMember(source)) return 0;
    if (overloaded) {
      const x = state.x(source) + ((direction === 0 || direction === 2) ? 1 : 0);
      const y = state.y(source) + ((direction === 1 || direction === 3) ? 1 : 0);
      if (x >= 0 && x < state.width && y >= 0 && y < state.height) {
        const second = state.cell(x, y);
        if (state.arrays[ARRAY.TERRAIN][second] !== TERRAIN.WALL &&
            !this.addMember(second)) return 0;
      }
    }
    for (let tick = 1; tick <= this.maxTicks; tick += 1) {
      let live = 0;
      const offset = tick * MAX_NEW_PROJECTILES;
      for (let member = 0; member < this.memberCount; member += 1) {
        if (!this.active[member]) continue;
        const next = this.target(this.current[member], direction);
        if (next === NONE_CELL) { this.active[member] = 0; continue; }
        const terrain = state.arrays[ARRAY.TERRAIN][next];
        if (terrain === TERRAIN.WALL || terrain === TERRAIN.DIRT) {
          this.active[member] = 0; continue;
        }
        this.current[member] = next; this.cells[offset + member] = next;
        live += 1;
      }
      if (!live) break;
      this.horizonTick = tick;
    }
    for (let member = 0; member < this.memberCount; member += 1)
      if (this.active[member]) this.complete = 0;
    this.buildCount += 1;
    return this.complete && this.horizonTick > 0 ? 1 : 0;
  }
}

// PAC needs only the tick-1 relation, so it keeps two rotating layers instead
// of the general DeadlineKernel's four published layers.
class AttackReverseViability {
  constructor() {
    const poses = CAPACITY.MAX_CELLS * 4;
    this.viableA = new Uint8Array(poses);
    this.viableB = new Uint8Array(poses);
    this.viableTick1 = this.viableA;
    this.hotAllocationCount = 0;
  }

  walkable(state, cell) {
    if (cell === NONE_CELL) return 0;
    const terrain = state.arrays[ARRAY.TERRAIN][cell];
    return terrain !== TERRAIN.WALL && terrain !== TERRAIN.DIRT ? 1 : 0;
  }

  buildReverse(hazard) {
    const state = hazard.state; const cells = state.cells;
    let next = this.viableA; let current = this.viableB;
    next.fill(0, 0, cells * 4); current.fill(0, 0, cells * 4);
    for (let cell = 0; cell < cells; cell += 1)
      if (this.walkable(state, cell) &&
          !hazard.isLethal(hazard.horizonTick, cell))
        for (let direction = 0; direction < 4; direction += 1)
          next[cell * 4 + direction] = 1;
    let tick1 = hazard.horizonTick <= 1 ? next : null;
    for (let tick = hazard.horizonTick - 1; tick >= 0; tick -= 1) {
      current.fill(0, 0, cells * 4);
      for (let cell = 0; cell < cells; cell += 1)
        if (this.walkable(state, cell) && !hazard.isLethal(tick, cell))
          for (let direction = 0; direction < 4; direction += 1) {
            let viable = next[cell * 4 + direction];
            if ((tick & 1) === 0) {
              viable = viable || next[cell * 4 + ((direction + 1) & 3)] ||
                next[cell * 4 + ((direction + 3) & 3)];
              const forward = hazard.target(cell, direction);
              if (!viable && forward !== NONE_CELL &&
                  this.walkable(state, forward) &&
                  !hazard.isLethal(tick + 1, forward) &&
                  next[forward * 4 + direction]) viable = 1;
            }
            if (viable) current[cell * 4 + direction] = 1;
          }
      if (tick === 1) tick1 = current;
      const swap = next; next = current; current = swap;
    }
    this.viableTick1 = tick1 || next;
    return next;
  }

  poseViable(layer, cell, direction) {
    return cell !== NONE_CELL && layer[cell * 4 + direction] ? 1 : 0;
  }
}

class ProjectileAttackClosure {
  constructor(maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS,
      maxEnemy = SEARCH_CAPACITY.MAX_ENEMY_POLICIES) {
    this.maxActions = maxActions; this.maxEnemy = maxEnemy;
    this.timeline = new ProjectileAttackTimeline();
    this.deadline = new AttackReverseViability();
    this.status = new Uint8Array(maxActions);
    this.completeEnemyColumns = new Uint8Array(maxActions);
    this.doomedEnemyColumns = new Uint8Array(maxActions);
    this.survivingEnemyColumns = new Uint8Array(maxActions);
    this.unknownEnemyColumns = new Uint8Array(maxActions);
    this.doomedByFrame = new Uint8Array(maxActions);
    this.cellStatus = new Uint8Array(maxActions * maxEnemy);
    this.cellPressure = new Int16Array(maxActions * maxEnemy);
    this.cellSetupDelay = new Uint8Array(maxActions * maxEnemy);
    this.cellMobilityLoss = new Uint8Array(maxActions * maxEnemy);
    this.cellEndpointReduction = new Uint16Array(maxActions * maxEnemy);
    this.frontierColumns = new Uint8Array(maxActions);
    this.counterfireDelay = new Uint8Array(maxActions);
    this.mobilityLoss = new Uint8Array(maxActions);
    this.endpointReduction = new Uint16Array(maxActions);
    this.variantCell = new Uint16Array(4);
    this.variantDirection = new Uint8Array(4);
    const poses = CAPACITY.MAX_CELLS * 4;
    const frontierWords = Math.ceil(poses / 32);
    this.frontierA = new Uint32Array(frontierWords);
    this.frontierB = new Uint32Array(frontierWords);
    this.frontierWordA = new Uint8Array(frontierWords);
    this.frontierWordB = new Uint8Array(frontierWords);
    this.frontierWordCountA = 0; this.frontierWordCountB = 0;
    this.metricFrontierBuffer = 0;
    this.counterfireDistance = new Uint8Array(poses);
    this.mobilityField = new Uint8Array(CAPACITY.MAX_CELLS);
    this.frontierCacheVariantCount = new Uint8Array(maxEnemy);
    this.frontierCacheCell = new Uint16Array(maxEnemy * 4);
    this.frontierCacheDirection = new Uint8Array(maxEnemy * 4);
    this.frontierCachePressure = new Int16Array(maxEnemy);
    this.frontierCacheSetupDelay = new Uint8Array(maxEnemy);
    this.frontierCacheMobilityLoss = new Uint8Array(maxEnemy);
    this.frontierCacheEndpointReduction = new Uint16Array(maxEnemy);
    this.frontierCacheCount = 0;
    this.metricEndpointCount = 0;
    this.metricCounterfire = COUNTERFIRE_UNREACHABLE;
    this.metricMobility = 0;
    this.variantCount = 0; this.projectionComplete = 1;
    this.count = 0; this.enemyCount = 0; this.enabled = 1; this.frontierEnabled = 1;
    this.evaluationCount = 0; this.cacheHitCount = 0; this.reverseBuildCount = 0;
    this.completeCount = 0; this.incompleteCount = 0; this.doomedCellCount = 0;
    this.frontierDistanceBuildCount = 0; this.frontierBuildCount = 0;
    this.frontierPressureCellCount = 0; this.frontierSetupDelayTotal = 0;
    this.frontierMobilityLossTotal = 0; this.frontierEndpointReductionTotal = 0;
    this.frontierIncompleteCount = 0;
    this.rootRestoreFailures = 0; this.hotAllocationCount = 0;
    this.cacheValid = 0; this.cacheHashLo = 0; this.cacheHashHi = 0;
    this.cacheActionSignature = 0; this.cacheOurCount = 0; this.cacheEnemyCount = 0;
    this.cacheStatus = new Uint8Array(maxActions);
    this.cacheCompleteEnemyColumns = new Uint8Array(maxActions);
    this.cacheDoomedEnemyColumns = new Uint8Array(maxActions);
    this.cacheSurvivingEnemyColumns = new Uint8Array(maxActions);
    this.cacheUnknownEnemyColumns = new Uint8Array(maxActions);
    this.cacheDoomedByFrame = new Uint8Array(maxActions);
    this.cacheCellStatus = new Uint8Array(maxActions * maxEnemy);
    this.cacheCellPressure = new Int16Array(maxActions * maxEnemy);
    this.cacheCellSetupDelay = new Uint8Array(maxActions * maxEnemy);
    this.cacheCellMobilityLoss = new Uint8Array(maxActions * maxEnemy);
    this.cacheCellEndpointReduction = new Uint16Array(maxActions * maxEnemy);
    this.cacheFrontierColumns = new Uint8Array(maxActions);
    this.cacheCounterfireDelay = new Uint8Array(maxActions);
    this.cacheMobilityLoss = new Uint8Array(maxActions);
    this.cacheEndpointReduction = new Uint16Array(maxActions);
  }

  reset(ourCount, enemyCount) {
    this.count = ourCount; this.enemyCount = enemyCount;
    this.status.fill(PAC_STATUS.NONE, 0, ourCount);
    this.completeEnemyColumns.fill(0, 0, ourCount);
    this.doomedEnemyColumns.fill(0, 0, ourCount);
    this.survivingEnemyColumns.fill(0, 0, ourCount);
    this.unknownEnemyColumns.fill(0, 0, ourCount);
    this.doomedByFrame.fill(0xff, 0, ourCount);
    this.frontierColumns.fill(0, 0, ourCount);
    this.counterfireDelay.fill(0, 0, ourCount);
    this.mobilityLoss.fill(0, 0, ourCount);
    this.endpointReduction.fill(0, 0, ourCount);
    const cells = ourCount * this.maxEnemy;
    this.cellStatus.fill(PAC_CELL.NONE, 0, cells);
    this.cellPressure.fill(0, 0, cells);
    this.cellSetupDelay.fill(0, 0, cells);
    this.cellMobilityLoss.fill(0, 0, cells);
    this.cellEndpointReduction.fill(0, 0, cells);
  }

  actionSignature(ourActions, ourArguments, ourCount, enemyActions, enemyArguments,
      enemyCount, combat) {
    let hash = (ourCount * 257 + enemyCount * 65537 + 0x9e3779b9 +
      (this.enabled ? 0x10000000 : 0) +
      (this.frontierEnabled ? 0x20000000 : 0)) >>> 0;
    for (let row = 0; row < ourCount; row += 1) {
      const qualified = combat && (combat.possibleHit[row] ||
        combat.intercept[row] || combat.directKill[row]) ? 1 : 0;
      hash = mix32(hash, (ourActions[row] + 1) * 257 +
        ourArguments[row] + 1 + qualified * 0x100000);
    }
    for (let column = 0; column < enemyCount; column += 1)
      hash = mix32(hash, (enemyActions[column] + 1) * 257 +
        enemyArguments[column] + 1);
    return hash >>> 0;
  }

  restoreCache(combat) {
    this.status.set(this.cacheStatus.subarray(0, this.count));
    this.completeEnemyColumns.set(this.cacheCompleteEnemyColumns.subarray(0, this.count));
    this.doomedEnemyColumns.set(this.cacheDoomedEnemyColumns.subarray(0, this.count));
    this.survivingEnemyColumns.set(this.cacheSurvivingEnemyColumns.subarray(0, this.count));
    this.unknownEnemyColumns.set(this.cacheUnknownEnemyColumns.subarray(0, this.count));
    this.doomedByFrame.set(this.cacheDoomedByFrame.subarray(0, this.count));
    const cells = this.count * this.maxEnemy;
    this.cellStatus.set(this.cacheCellStatus.subarray(0, cells));
    this.cellPressure.set(this.cacheCellPressure.subarray(0, cells));
    this.cellSetupDelay.set(this.cacheCellSetupDelay.subarray(0, cells));
    this.cellMobilityLoss.set(this.cacheCellMobilityLoss.subarray(0, cells));
    this.cellEndpointReduction.set(this.cacheCellEndpointReduction.subarray(0, cells));
    this.frontierColumns.set(this.cacheFrontierColumns.subarray(0, this.count));
    this.counterfireDelay.set(this.cacheCounterfireDelay.subarray(0, this.count));
    this.mobilityLoss.set(this.cacheMobilityLoss.subarray(0, this.count));
    this.endpointReduction.set(this.cacheEndpointReduction.subarray(0, this.count));
    this.applyCombat(combat);
  }

  storeCache(hashLo, hashHi, signature) {
    this.cacheHashLo = hashLo; this.cacheHashHi = hashHi;
    this.cacheActionSignature = signature; this.cacheOurCount = this.count;
    this.cacheEnemyCount = this.enemyCount; this.cacheValid = 1;
    this.cacheStatus.set(this.status.subarray(0, this.count));
    this.cacheCompleteEnemyColumns.set(this.completeEnemyColumns.subarray(0, this.count));
    this.cacheDoomedEnemyColumns.set(this.doomedEnemyColumns.subarray(0, this.count));
    this.cacheSurvivingEnemyColumns.set(this.survivingEnemyColumns.subarray(0, this.count));
    this.cacheUnknownEnemyColumns.set(this.unknownEnemyColumns.subarray(0, this.count));
    this.cacheDoomedByFrame.set(this.doomedByFrame.subarray(0, this.count));
    const cells = this.count * this.maxEnemy;
    this.cacheCellStatus.set(this.cellStatus.subarray(0, cells));
    this.cacheCellPressure.set(this.cellPressure.subarray(0, cells));
    this.cacheCellSetupDelay.set(this.cellSetupDelay.subarray(0, cells));
    this.cacheCellMobilityLoss.set(this.cellMobilityLoss.subarray(0, cells));
    this.cacheCellEndpointReduction.set(this.cellEndpointReduction.subarray(0, cells));
    this.cacheFrontierColumns.set(this.frontierColumns.subarray(0, this.count));
    this.cacheCounterfireDelay.set(this.counterfireDelay.subarray(0, this.count));
    this.cacheMobilityLoss.set(this.mobilityLoss.subarray(0, this.count));
    this.cacheEndpointReduction.set(this.endpointReduction.subarray(0, this.count));
  }

  target(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ?
      NONE_CELL : state.cell(x, y);
  }

  walkable(state, cell) {
    if (cell === NONE_CELL) return 0;
    const terrain = state.arrays[ARRAY.TERRAIN][cell];
    return terrain !== TERRAIN.WALL && terrain !== TERRAIN.DIRT ? 1 : 0;
  }

  buildCounterfireDistance(state) {
    const poses = state.cells * 4; const own = state.arrays[ARRAY.TANK_CELL][0];
    this.counterfireDistance.fill(COUNTERFIRE_UNREACHABLE, 0, poses);
    for (let cell = 0; cell < state.cells; cell += 1) {
      let mobility = 0;
      if (cell !== own && this.walkable(state, cell))
        for (let direction = 0; direction < 4; direction += 1) {
          const next = this.target(state, cell, direction);
          if (next !== own && this.walkable(state, next)) mobility += 1;
        }
      this.mobilityField[cell] = mobility;
    }
    this.clearFrontier(this.frontierA, this.frontierWordA,
      this.frontierWordCountA);
    let current = this.frontierA; let currentWords = this.frontierWordA;
    let currentWordCount = 0;
    // Only the four rays from the target can be zero-distance counterfire
    // goals. This is equivalent to scanning every cell and testing LOS, but
    // avoids a cell × ray-length pass.
    for (let ray = 0; ray < 4; ray += 1) {
      let cell = this.target(state, own, ray);
      while (this.walkable(state, cell)) {
        const pose = cell * 4 + ((ray + 2) & 3);
        this.counterfireDistance[pose] = 0;
        currentWordCount = this.addFrontierPose(current, currentWords,
          currentWordCount, pose);
        cell = this.target(state, cell, ray);
      }
    }
    let next = this.frontierB; let nextWords = this.frontierWordB;
    let nextWordCount = this.frontierWordCountB; let distance = 0;
    while (currentWordCount) {
      this.clearFrontier(next, nextWords, nextWordCount);
      nextWordCount = 0; const nextDistance = Math.min(254, distance + 1);
      for (let index = 0; index < currentWordCount; index += 1) {
        const word = currentWords[index]; let bits = current[word];
        let offset = 0;
        while (bits) {
          if (bits & 1) {
            const pose = (word << 5) + offset;
            const cell = (pose / 4) | 0; const direction = pose & 3;
            const left = cell * 4 + ((direction + 1) & 3);
            const right = cell * 4 + ((direction + 3) & 3);
            if (this.counterfireDistance[left] === COUNTERFIRE_UNREACHABLE) {
              this.counterfireDistance[left] = nextDistance;
              nextWordCount = this.addFrontierPose(next, nextWords,
                nextWordCount, left);
            }
            if (this.counterfireDistance[right] === COUNTERFIRE_UNREACHABLE) {
              this.counterfireDistance[right] = nextDistance;
              nextWordCount = this.addFrontierPose(next, nextWords,
                nextWordCount, right);
            }
            const behind = this.target(state, cell, (direction + 2) & 3);
            const prior = behind * 4 + direction;
            if (behind !== own && this.walkable(state, behind) &&
                this.counterfireDistance[prior] === COUNTERFIRE_UNREACHABLE) {
              this.counterfireDistance[prior] = nextDistance;
              nextWordCount = this.addFrontierPose(next, nextWords,
                nextWordCount, prior);
            }
          }
          bits >>>= 1; offset += 1;
        }
      }
      let swap = current; current = next; next = swap;
      swap = currentWords; currentWords = nextWords; nextWords = swap;
      const countSwap = currentWordCount;
      currentWordCount = nextWordCount; nextWordCount = countSwap;
      distance = nextDistance;
    }
    if (current === this.frontierA) {
      this.frontierWordCountA = currentWordCount;
      this.frontierWordCountB = nextWordCount;
    } else {
      this.frontierWordCountB = currentWordCount;
      this.frontierWordCountA = nextWordCount;
    }
    this.frontierDistanceBuildCount += 1;
    return 1;
  }

  clearFrontier(frontier, words, wordCount) {
    for (let index = 0; index < wordCount; index += 1)
      frontier[words[index]] = 0;
  }

  addFrontierPose(destination, words, wordCount, pose) {
    if (pose < 0 || pose >= this.counterfireDistance.length) return wordCount;
    const word = pose >>> 5; const bit = 1 << (pose & 31);
    const prior = destination[word];
    if (prior & bit) return wordCount;
    if (!prior) words[wordCount++] = word;
    destination[word] = (prior | bit) >>> 0;
    return wordCount;
  }

  expandFrontier(state, source, sourceWords, sourceWordCount,
      destination, destinationWords, destinationWordCount) {
    const own = state.arrays[ARRAY.TANK_CELL][0];
    this.clearFrontier(destination, destinationWords, destinationWordCount);
    let count = 0;
    for (let index = 0; index < sourceWordCount; index += 1) {
      const word = sourceWords[index]; let bits = source[word]; let offset = 0;
      while (bits) {
        if (bits & 1) {
          const pose = (word << 5) + offset;
          const cell = (pose / 4) | 0; const direction = pose & 3;
          count = this.addFrontierPose(destination, destinationWords, count, pose);
          count = this.addFrontierPose(destination, destinationWords, count,
            cell * 4 + ((direction + 1) & 3));
          count = this.addFrontierPose(destination, destinationWords, count,
            cell * 4 + ((direction + 3) & 3));
          const forward = this.target(state, cell, direction);
          if (forward !== own && this.walkable(state, forward))
            count = this.addFrontierPose(destination, destinationWords, count,
              forward * 4 + direction);
        }
        bits >>>= 1; offset += 1;
      }
    }
    return count;
  }

  filterFrontier(frontier, words, wordCount, tick) {
    let kept = 0;
    for (let index = 0; index < wordCount; index += 1) {
      const word = words[index]; let bits = frontier[word];
      let filtered = 0; let offset = 0;
      while (bits) {
        if (bits & 1) {
          const pose = (word << 5) + offset;
          if (!this.timeline.isLethal(tick, (pose / 4) | 0))
            filtered |= 1 << offset;
        }
        bits >>>= 1; offset += 1;
      }
      frontier[word] = filtered >>> 0;
      if (filtered) words[kept++] = word;
    }
    return kept;
  }

  measureFrontier(frontier, words, wordCount) {
    let endpoints = 0; let counterfire = COUNTERFIRE_UNREACHABLE;
    let mobility = 0;
    for (let index = 0; index < wordCount; index += 1) {
      const word = words[index]; let bits = frontier[word]; let offset = 0;
      while (bits) {
        if (bits & 1) {
          const pose = (word << 5) + offset;
          endpoints += 1;
          const distance = this.counterfireDistance[pose];
          if (distance < counterfire) counterfire = distance;
          const value = this.mobilityField[(pose / 4) | 0];
          if (value > mobility) mobility = value;
        }
        bits >>>= 1; offset += 1;
      }
    }
    this.metricEndpointCount = endpoints;
    this.metricCounterfire = counterfire;
    this.metricMobility = mobility;
  }

  buildFrontier(state, constrained) {
    this.clearFrontier(this.frontierA, this.frontierWordA,
      this.frontierWordCountA);
    let count = 0;
    for (let variant = 0; variant < this.variantCount; variant += 1) {
      const pose = this.variantCell[variant] * 4 + this.variantDirection[variant];
      count = this.addFrontierPose(this.frontierA,
        this.frontierWordA, count, pose);
    }
    let current = this.frontierA; let next = this.frontierB;
    let currentWords = this.frontierWordA; let nextWords = this.frontierWordB;
    let nextCount = this.frontierWordCountB;
    for (let tick = 1; tick <= this.timeline.horizonTick; tick += 1) {
      if (tick > 1 && (tick & 1) !== 0) {
        nextCount = this.expandFrontier(state, current, currentWords, count,
          next, nextWords, nextCount);
        let swap = current; current = next; next = swap;
        swap = currentWords; currentWords = nextWords; nextWords = swap;
        const countSwap = count; count = nextCount; nextCount = countSwap;
      }
      if (constrained)
        count = this.filterFrontier(current, currentWords, count, tick);
      if (!count) break;
    }
    this.metricFrontierBuffer = current === this.frontierB ? 1 : 0;
    if (current === this.frontierA) {
      this.frontierWordCountA = count; this.frontierWordCountB = nextCount;
    } else {
      this.frontierWordCountB = count; this.frontierWordCountA = nextCount;
    }
    return count;
  }

  evaluateFrontier(state) {
    this.metricEndpointCount = 0;
    this.metricCounterfire = 0;
    this.metricMobility = 0;
    const baselineCount = this.buildFrontier(state, 0);
    if (!baselineCount) {
      this.frontierIncompleteCount += 1;
      return 0;
    }
    this.measureFrontier(this.metricFrontierBuffer ?
      this.frontierB : this.frontierA, this.metricFrontierBuffer ?
        this.frontierWordB : this.frontierWordA, baselineCount);
    const baselineEndpoints = this.metricEndpointCount;
    const baselineCounterfire = this.metricCounterfire;
    const baselineMobility = this.metricMobility;
    const constrainedCount = this.buildFrontier(state, 1);
    if (!constrainedCount) {
      this.frontierIncompleteCount += 1;
      return 0;
    }
    this.measureFrontier(this.metricFrontierBuffer ?
      this.frontierB : this.frontierA, this.metricFrontierBuffer ?
        this.frontierWordB : this.frontierWordA, constrainedCount);
    const constrainedEndpoints = this.metricEndpointCount;
    const constrainedCounterfire = this.metricCounterfire;
    const constrainedMobility = this.metricMobility;
    let setupDelay = 0;
    if (baselineCounterfire !== COUNTERFIRE_UNREACHABLE) {
      if (constrainedCounterfire === COUNTERFIRE_UNREACHABLE) setupDelay = 4;
      else if (constrainedCounterfire > baselineCounterfire)
        setupDelay = Math.min(4, constrainedCounterfire - baselineCounterfire);
    }
    const mobilityLoss = Math.max(0, baselineMobility - constrainedMobility);
    const endpointReduction = Math.max(0, baselineEndpoints - constrainedEndpoints);
    this.metricEndpointCount = endpointReduction;
    this.metricCounterfire = setupDelay;
    this.metricMobility = mobilityLoss;
    this.frontierBuildCount += 1;
    return Math.min(FRONTIER_PRESSURE_MAX,
      setupDelay * 250 + mobilityLoss * 150);
  }

  findFrontierCache() {
    for (let entry = 0; entry < this.frontierCacheCount; entry += 1) {
      if (this.frontierCacheVariantCount[entry] !== this.variantCount) continue;
      let equal = 1; const at = entry * 4;
      for (let variant = 0; variant < this.variantCount; variant += 1)
        if (this.frontierCacheCell[at + variant] !== this.variantCell[variant] ||
            this.frontierCacheDirection[at + variant] !==
              this.variantDirection[variant]) {
          equal = 0; break;
        }
      if (equal) return entry;
    }
    return -1;
  }

  storeFrontierCache(pressure) {
    if (this.frontierCacheCount >= this.maxEnemy) return;
    const entry = this.frontierCacheCount++; const at = entry * 4;
    this.frontierCacheVariantCount[entry] = this.variantCount;
    for (let variant = 0; variant < this.variantCount; variant += 1) {
      this.frontierCacheCell[at + variant] = this.variantCell[variant];
      this.frontierCacheDirection[at + variant] = this.variantDirection[variant];
    }
    this.frontierCachePressure[entry] = pressure;
    this.frontierCacheSetupDelay[entry] = this.metricCounterfire;
    this.frontierCacheMobilityLoss[entry] = this.metricMobility;
    this.frontierCacheEndpointReduction[entry] = this.metricEndpointCount;
  }

  addVariant(cell, direction) {
    for (let index = 0; index < this.variantCount; index += 1)
      if (this.variantCell[index] === cell &&
          this.variantDirection[index] === direction) return 1;
    if (this.variantCount >= this.variantCell.length) {
      this.projectionComplete = 0; return 0;
    }
    this.variantCell[this.variantCount] = cell;
    this.variantDirection[this.variantCount] = direction;
    this.variantCount += 1; return 1;
  }

  move(state, cell, direction, steps) {
    const other = state.arrays[ARRAY.TANK_CELL][0];
    let at = cell;
    for (let step = 0; step < steps; step += 1) {
      const next = this.target(state, at, direction);
      if (!this.walkable(state, next)) break;
      if (next === other) { this.projectionComplete = 0; return at; }
      at = next;
    }
    return at;
  }

  active(frame, value) {
    return value !== NONE_FRAME && value > frame;
  }

  executeProjectedPrimitive(state, cell, direction, action, reversed, boosted) {
    let actual = action; let moveDirection = direction;
    if (reversed) {
      if (action === ACTION.GO) moveDirection = (direction + 2) & 3;
      else if (action === ACTION.TURN_LEFT) actual = ACTION.TURN_RIGHT;
      else if (action === ACTION.TURN_RIGHT) actual = ACTION.TURN_LEFT;
    }
    if (actual === ACTION.GO)
      cell = this.move(state, cell, moveDirection, boosted ? 2 : 1);
    else if (actual === ACTION.TURN_LEFT) direction = (direction + 3) & 3;
    else if (actual === ACTION.TURN_RIGHT) direction = (direction + 1) & 3;
    return cell * 4 + direction;
  }

  projectEnemyAction(state, action) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    let cell = a[ARRAY.TANK_CELL][1]; let direction = a[ARRAY.TANK_DIR][1];
    this.variantCount = 0; this.projectionComplete = 1;
    if (a[ARRAY.TANK_CRASH][1]) return this.addVariant(cell, direction), this.variantCount;
    if (this.active(frame, a[ARRAY.TANK_FROZEN_UNTIL][1])) {
      this.addVariant(cell, direction); return this.variantCount;
    }
    if (this.active(frame, a[ARRAY.TANK_POISON_UNTIL][1])) {
      const applied = a[ARRAY.TANK_POISON_APPLIED][1];
      if (applied === NONE_FRAME) {
        this.projectionComplete = 0; return 0;
      }
      if (((frame - applied) & 1) !== 0) {
        this.addVariant(cell, direction); return this.variantCount;
      }
    }
    if (action === ACTION.CAST_TELEPORT || action === ACTION.CAST_SHIELD ||
        action === ACTION.CAST_BOOST) {
      this.projectionComplete = 0; return 0;
    }
    const stunned = this.active(frame, a[ARRAY.TANK_STUN_UNTIL][1]);
    const boosted = this.active(frame, a[ARRAY.TANK_BOOST_UNTIL][1]);
    if (action >= BOOST_COMPOUND_BASE && action <= BOOST_COMPOUND_END) {
      if (!boosted) { this.projectionComplete = 0; return 0; }
      const offset = action - BOOST_COMPOUND_BASE;
      const preTurn = offset < BOOST_COMPOUND_STRIDE ?
        ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
      const mainIndex = offset % BOOST_COMPOUND_STRIDE;
      const main = mainIndex === 0 ? ACTION.GO : mainIndex === 1 ? ACTION.TURN_LEFT :
        mainIndex === 2 ? ACTION.TURN_RIGHT : mainIndex === 3 ?
          ACTION.FIRE : ACTION.THROW_BOMB;
      const variants = stunned && mainIndex <= 2 ? 4 : stunned ? 2 : 1;
      for (let chance = 0; chance < variants; chance += 1) {
        let packed = this.executeProjectedPrimitive(state, cell, direction,
          preTurn, stunned && (chance & 1), boosted);
        packed = this.executeProjectedPrimitive(state, (packed / 4) | 0,
          packed & 3, main, stunned && (chance & 2), boosted);
        this.addVariant((packed / 4) | 0, packed & 3);
      }
      return this.variantCount;
    }
    if (action === ACTION.GO || action === ACTION.TURN_LEFT ||
        action === ACTION.TURN_RIGHT) {
      const variants = stunned ? 2 : 1;
      for (let chance = 0; chance < variants; chance += 1) {
        const packed = this.executeProjectedPrimitive(state, cell, direction,
          action, stunned && chance === 1, boosted);
        this.addVariant((packed / 4) | 0, packed & 3);
      }
      return this.variantCount;
    }
    this.addVariant(cell, direction);
    return this.variantCount;
  }

  survivalSkillBeforeDeadline(state, frames) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.active(frame, a[ARRAY.TANK_SHIELD_UNTIL][1]) &&
        a[ARRAY.TANK_SHIELD_HITS][1] > 0) return 1;
    if (this.active(frame, a[ARRAY.TANK_BOOST_UNTIL][1])) return 1;
    const skill = a[ARRAY.TANK_SKILL][1];
    return (skill === SKILL.SHIELD || skill === SKILL.TELEPORT || skill === SKILL.BOOST) &&
      a[ARRAY.TANK_SKILL_READY][1] <= frame + frames ? 1 : 0;
  }

  classifyColumn(state, action, futureSpecial) {
    const variants = this.projectEnemyAction(state, action);
    if (!this.projectionComplete || variants < 1) return PAC_CELL.UNKNOWN;
    let viable = 0;
    for (let variant = 0; variant < variants; variant += 1) {
      const cell = this.variantCell[variant]; const direction = this.variantDirection[variant];
      if (this.deadline.poseViable(this.deadline.viableTick1, cell, direction)) {
        viable = 1; break;
      }
    }
    if (viable) return PAC_CELL.SURVIVES;
    if (futureSpecial) return PAC_CELL.UNKNOWN;
    return PAC_CELL.PROVEN_DOOMED;
  }

  applyCombat(combat) {
    if (!combat || combat.count !== this.count) return 0;
    let applied = 0;
    for (let row = 0; row < this.count; row += 1) {
      const prior = combat.attackPressureContribution ?
        combat.attackPressureContribution[row] : 0;
      if (prior) {
        combat.pressureValue[row] = clamp(combat.pressureValue[row] - prior,
          -10000, 10000);
        combat.attackPressureContribution[row] = 0;
      }
      if (this.status[row] === PAC_STATUS.NONE) continue;
      combat.attackClosureStatus[row] = this.status[row];
      combat.enemyDoomedFirstActions[row] = this.doomedEnemyColumns[row];
      combat.enemySurvivingFirstActions[row] = this.survivingEnemyColumns[row];
      combat.enemyUnknownFirstActions[row] = this.unknownEnemyColumns[row];
      combat.attackDoomedByFrame[row] = this.doomedByFrame[row];
      combat.enemyFrontierColumns[row] = this.frontierColumns[row];
      combat.enemyCounterfireDelay[row] = this.counterfireDelay[row];
      combat.enemyMobilityLoss[row] = this.mobilityLoss[row];
      combat.enemyEndpointReduction[row] = this.endpointReduction[row];
      if (!this.doomedEnemyColumns[row] && !this.frontierColumns[row]) continue;
      const total = Math.max(1, this.enemyCount);
      const blockade = Math.floor(this.doomedEnemyColumns[row] * 10000 / total);
      combat.mark(row, COMBAT_PURPOSE.ESCAPE_DENIAL,
        PLAN_PURPOSE.ESCAPE_FORCING, 5);
      combat.enemySafeSuccessors[row] = clamp(
        this.survivingEnemyColumns[row] + this.unknownEnemyColumns[row], 0, 255);
      if (blockade > combat.blockadeValue[row]) combat.blockadeValue[row] = blockade;
      const completeness = Math.floor(this.completeEnemyColumns[row] * 10000 / total);
      if (completeness > combat.purposeCompleteness[row])
        combat.purposeCompleteness[row] = completeness;
      let frontierPressure = 0;
      for (let column = 0; column < this.enemyCount; column += 1) {
        const at = row * this.maxEnemy + column;
        if (this.cellStatus[at] === PAC_CELL.SURVIVES)
          frontierPressure += this.cellPressure[at];
      }
      // Preserve PAC1's exact root contribution. PAC2 adds only the finite
      // average opportunity cost of survivor columns.
      const pac1Added = Math.min(1800, Math.floor(blockade / 5));
      const added = Math.min(2500,
        pac1Added + Math.floor(frontierPressure / total));
      combat.pressureValue[row] = clamp(combat.pressureValue[row] + added,
        -10000, 10000);
      if (combat.attackPressureContribution)
        combat.attackPressureContribution[row] = added;
      // A survivor/unknown enemy column may avoid the shot. PAC never raises
      // the worst-case committed value or creates Proof.
      applied += 1;
    }
    return applied;
  }

  evaluate(bundle, ourActions, ourArguments, ourCount, enemyActions, enemyArguments,
      enemyCount, combat) {
    this.reset(ourCount, enemyCount); this.evaluationCount += 1;
    if (!this.enabled || !bundle || !bundle.state || ourCount < 1 || enemyCount < 1)
      return 0;
    const state = bundle.state; const a = state.arrays;
    const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootDelta = state.deltaUsed; const rootEvents = state.eventUsed;
    const signature = this.actionSignature(ourActions, ourArguments, ourCount,
      enemyActions, enemyArguments, enemyCount, combat);
    if (this.cacheValid && this.cacheHashLo === state.hashLo &&
        this.cacheHashHi === state.hashHi && this.cacheActionSignature === signature &&
        this.cacheOurCount === ourCount && this.cacheEnemyCount === enemyCount) {
      this.cacheHitCount += 1; this.restoreCache(combat); return 1;
    }
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const canFire = (a[ARRAY.TANK_FIRE_LOCK][0] === NONE_FRAME ||
      a[ARRAY.TANK_FIRE_LOCK][0] <= frame);
    let ownProjectile = 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === 0) ownProjectile = 1;
    let evaluated = 0;
    for (let row = 0; row < ourCount; row += 1) {
      if (ourActions[row] !== ACTION.FIRE || !canFire || ownProjectile ||
          !combat || (!combat.possibleHit[row] && !combat.intercept[row] &&
           !combat.directKill[row])) continue;
      const source = a[ARRAY.TANK_CELL][0]; const direction = a[ARRAY.TANK_DIR][0];
      const overloaded = this.active(frame, a[ARRAY.TANK_OVERLOAD_UNTIL][0]);
      if (!this.timeline.build(state, source, direction, overloaded)) {
        this.status[row] = PAC_STATUS.INCOMPLETE;
        this.unknownEnemyColumns[row] = enemyCount;
        this.incompleteCount += 1; continue;
      }
      this.deadline.buildReverse(this.timeline); this.reverseBuildCount += 1;
      const frames = Math.max(1, Math.ceil(this.timeline.horizonTick /
        Math.max(1, RULE.PROJECTILE_STEPS)));
      const futureSpecial = this.survivalSkillBeforeDeadline(state, frames);
      // A projectile that disappears within the root frame has no future
      // action frontier; PAC1 already owns that committed relation.
      const frontierReady = this.frontierEnabled && !futureSpecial &&
        this.timeline.horizonTick > RULE.PROJECTILE_STEPS ?
        this.buildCounterfireDistance(state) : 0;
      this.frontierCacheCount = 0;
      let complete = 0; let doomed = 0; let survives = 0; let unknown = 0;
      for (let column = 0; column < enemyCount; column += 1) {
        const result = this.classifyColumn(state, enemyActions[column], futureSpecial);
        const at = row * this.maxEnemy + column; this.cellStatus[at] = result;
        if (result === PAC_CELL.PROVEN_DOOMED) {
          doomed += 1; complete += 1; this.doomedCellCount += 1;
          this.cellPressure[at] = Math.min(PAC_PRESSURE_MAX,
            1200 + Math.max(0, 8 - frames) * 120);
        } else if (result === PAC_CELL.SURVIVES) {
          survives += 1; complete += 1;
          if (frontierReady) {
            const cached = this.findFrontierCache();
            let pressure;
            if (cached >= 0) {
              pressure = this.frontierCachePressure[cached];
              this.metricCounterfire = this.frontierCacheSetupDelay[cached];
              this.metricMobility = this.frontierCacheMobilityLoss[cached];
              this.metricEndpointCount =
                this.frontierCacheEndpointReduction[cached];
            } else {
              pressure = this.evaluateFrontier(state);
              this.storeFrontierCache(pressure);
            }
            const setupDelay = this.metricCounterfire;
            const mobilityLoss = this.metricMobility;
            const endpointReduction = this.metricEndpointCount;
            this.cellSetupDelay[at] = setupDelay;
            this.cellMobilityLoss[at] = mobilityLoss;
            this.cellEndpointReduction[at] = endpointReduction;
            if (pressure > 0) {
              this.cellPressure[at] = pressure;
              this.frontierColumns[row] += 1;
              if (setupDelay > this.counterfireDelay[row])
                this.counterfireDelay[row] = setupDelay;
              if (mobilityLoss > this.mobilityLoss[row])
                this.mobilityLoss[row] = mobilityLoss;
              this.frontierPressureCellCount += 1;
              this.frontierSetupDelayTotal += setupDelay;
              this.frontierMobilityLossTotal += mobilityLoss;
            }
            this.endpointReduction[row] = Math.min(0xffff,
              this.endpointReduction[row] + endpointReduction);
            this.frontierEndpointReductionTotal += endpointReduction;
          }
        } else unknown += 1;
      }
      this.completeEnemyColumns[row] = complete;
      this.doomedEnemyColumns[row] = doomed;
      this.survivingEnemyColumns[row] = survives;
      this.unknownEnemyColumns[row] = unknown;
      this.doomedByFrame[row] = doomed ? Math.min(0xfe, frames) : 0xff;
      this.status[row] = unknown ? PAC_STATUS.INCOMPLETE : PAC_STATUS.COMPLETE;
      if (unknown) this.incompleteCount += 1; else this.completeCount += 1;
      evaluated += 1;
    }
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed !== rootDelta || state.eventUsed !== rootEvents) {
      this.rootRestoreFailures += 1;
      return 0;
    }
    this.storeCache(state.hashLo, state.hashHi, signature);
    this.applyCombat(combat);
    return evaluated;
  }
}

module.exports = {
  PAC_STATUS,
  PAC_CELL,
  MAX_NEW_PROJECTILES,
  MAX_TRAJECTORY_TICKS,
  FRONTIER_PRESSURE_MAX,
  COUNTERFIRE_UNREACHABLE,
  ProjectileAttackTimeline,
  AttackReverseViability,
  ProjectileAttackClosure
};
