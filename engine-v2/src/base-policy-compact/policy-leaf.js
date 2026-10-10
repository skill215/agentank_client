"use strict";

// Generated compact BP68 candidate. Do not edit by hand.

// Generated BP68 production integer FastState port of the coherent V1 non-terminal
// evaluation geometry.  It deliberately does not claim byte-for-byte V1
// equivalence: V1's path-local actionScore and repetition history are not
// fields of FastState.  The remaining objective, committed hazard, attack
// race, position and status dimensions preserve V1's relative scale.

const { CAPACITY, RULE } = require("../generated/fast-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { TERRAIN, SKILL, EVENT, NONE_FRAME, NONE_CELL, DX, DY } = require(
  "../abi/fast-codes");

const INF = 99;
const POSE_COUNT = CAPACITY.MAX_CELLS * 4;
const LEAF_COMPONENT = Object.freeze({
  STAR_SCORE: 1,
  STAR_ROUTE: 2,
  PROJECTILE: 4,
  ATTACK: 8,
  POSITION: 16,
  STATUS: 32,
  ALL: 63
});
const COMPONENT_NAME = Object.freeze([
  "star-score", "star-route", "projectile", "attack", "position", "status"
]);

function componentMask(options) {
  let mask = LEAF_COMPONENT.ALL;
  const omitted = typeof options.omitComponents === "string" ?
    options.omitComponents.split(",") : [];
  for (let index = 0; index < omitted.length; index += 1) {
    const at = COMPONENT_NAME.indexOf(omitted[index].trim());
    if (at >= 0) mask &= ~(1 << at);
  }
  return mask;
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

class NativeBasePolicyLeafEvaluator {
constructor(options = {}) {
this.discountSimulatedProjectiles = options.discountSimulatedProjectiles === true;
this.clampLimit = Number.isInteger(options.clampLimit) &&
      options.clampLimit >= 0 ? options.clampLimit : 25000;
this.clampMode = options.clampMode === "component" ? "component" :
      this.clampLimit ? "total" : "none";
this.componentMask = componentMask(options);
;
;
this.lastComponents = new Int32Array(COMPONENT_NAME.length);
this.starDistance = new Uint8Array(CAPACITY.MAX_CELLS);
this.starFieldCacheEntries = Math.max(0, Math.min(8,
      Number.isSafeInteger(options.starFieldCacheEntries) ?
        options.starFieldCacheEntries : 0));
this.starCacheTerrain = this.starFieldCacheEntries ? new Uint8Array(
      this.starFieldCacheEntries * CAPACITY.MAX_CELLS) : null;
this.starCacheDistance = this.starFieldCacheEntries ? new Uint8Array(
      this.starFieldCacheEntries * CAPACITY.MAX_CELLS) : null;
this.starCacheStar = this.starFieldCacheEntries ?
      new Uint16Array(this.starFieldCacheEntries) : null;
this.starCacheVersion = this.starFieldCacheEntries ?
      new Uint32Array(this.starFieldCacheEntries) : null;
this.starCacheWidth = this.starFieldCacheEntries ?
      new Uint8Array(this.starFieldCacheEntries) : null;
this.starCacheHeight = this.starFieldCacheEntries ?
      new Uint8Array(this.starFieldCacheEntries) : null;
this.starCacheRootGeneration = this.starFieldCacheEntries ?
      new Uint32Array(this.starFieldCacheEntries) : null;
if (this.starCacheStar) this.starCacheStar.fill(NONE_CELL);
this.rootTerrain = this.starFieldCacheEntries ?
      new Uint8Array(CAPACITY.MAX_CELLS) : null;
this.rootTerrainReady = 0;
this.rootTerrainWidth = 0;
this.rootTerrainHeight = 0;
this.rootTerrainGeneration = 0;
this.rootTerrainVersion = 0;
this.rootTerrainDeltaBase = 0;
this.starCacheCursor = 0;
this.activeStarDistance = this.starDistance;
this.activeStarDistanceBase = 0;
this.cellQueue = new Uint16Array(CAPACITY.MAX_CELLS);
this.neighbor = new Uint16Array(CAPACITY.MAX_CELLS * 4);
this.cellX = new Uint8Array(CAPACITY.MAX_CELLS);
this.cellY = new Uint8Array(CAPACITY.MAX_CELLS);
this.precomputeGeometry = options.precomputeGeometry !== false;
this.geometryWidth = 0;
this.geometryHeight = 0;
this.poseStamp = new Uint16Array(POSE_COUNT);
this.poseCell = new Uint16Array(POSE_COUNT);
this.poseDirection = new Uint8Array(POSE_COUNT);
this.poseDepth = new Uint8Array(POSE_COUNT);
this.stamp = 0;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
  }

active(a, array, seat, frame) {
    const until = a[array][seat];
    return until !== NONE_FRAME && until > frame ? 1 : 0;
  }

beginRoot(state) {
    ;
    if (this.precomputeGeometry && (this.geometryWidth !== state.width ||
        this.geometryHeight !== state.height)) {
      this.geometryWidth = state.width; this.geometryHeight = state.height;
      for (let cell = 0; cell < state.cells; cell += 1) {
        const x = cell % state.width; const y = (cell / state.width) | 0;
        this.cellX[cell] = x; this.cellY[cell] = y;
        const base = cell * 4;
        this.neighbor[base] = y > 0 ? cell - state.width : NONE_CELL;
        this.neighbor[base + 1] = x + 1 < state.width ? cell + 1 : NONE_CELL;
        this.neighbor[base + 2] = y + 1 < state.height ?
          cell + state.width : NONE_CELL;
        this.neighbor[base + 3] = x > 0 ? cell - 1 : NONE_CELL;
      }
    }
    if (!this.starFieldCacheEntries) return;
    const terrain = state.arrays[ARRAY.TERRAIN]; let changed =
      !this.rootTerrainReady || this.rootTerrainWidth !== state.width ||
      this.rootTerrainHeight !== state.height;
    const rootVersion = state.arrays[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION];
    if (!changed) {
      ;
      for (let cell = 0; cell < state.cells; cell += 1) {
        if (this.rootTerrain[cell] === terrain[cell]) continue;
        changed = 1; break;
      }
    }
    if (changed) {
      this.rootTerrainGeneration = (this.rootTerrainGeneration + 1) >>> 0;
      if (!this.rootTerrainGeneration) this.rootTerrainGeneration = 1;
      for (let cell = 0; cell < state.cells; cell += 1)
        this.rootTerrain[cell] = terrain[cell];
      this.rootTerrainReady = 1; this.rootTerrainWidth = state.width;
      this.rootTerrainHeight = state.height;
      for (let entry = 0; entry < this.starFieldCacheEntries; entry += 1) {
        if (this.starCacheStar[entry] === NONE_CELL ||
            this.starCacheWidth[entry] !== state.width ||
            this.starCacheHeight[entry] !== state.height) continue;
        const base = entry * CAPACITY.MAX_CELLS; let equal = 1;
        for (let cell = 0; cell < state.cells; cell += 1) {
          if (this.starCacheTerrain[base + cell] === terrain[cell]) continue;
          equal = 0; break;
        }
        if (!equal) continue;
        this.starCacheRootGeneration[entry] = this.rootTerrainGeneration;
        this.starCacheVersion[entry] = rootVersion;
        ;
      }
    }
    this.rootTerrainVersion = rootVersion;
    this.rootTerrainDeltaBase = state.deltaUsed;
  }

remaining(a, array, seat, frame) {
    const until = a[array][seat];
    return until !== NONE_FRAME && until > frame ? until - frame : 0;
  }

walkable(state, cell, blocked) {
    if (cell === NONE_CELL || cell === blocked) return 0;
    const tile = state.arrays[ARRAY.TERRAIN][cell];
    return tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT ? 1 : 0;
  }

target(state, cell, direction) {
    if (cell !== NONE_CELL && this.geometryWidth === state.width &&
        this.geometryHeight === state.height)
      return this.neighbor[cell * 4 + direction];
    const x = state.x(cell) + DX[direction];
    const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ?
      NONE_CELL : state.cell(x, y);
  }

advance(state, cell, direction, speed, blocked) {
    let result = cell;
    for (let step = 0; step < speed; step += 1) {
      const next = this.target(state, result, direction);
      if (!this.walkable(state, next, blocked)) break;
      result = next;
    }
    return result;
  }

mobility(state, seat) {
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][seat];
    const blocked = a[ARRAY.TANK_CELL][seat ^ 1]; let count = 0;
    for (let direction = 0; direction < 4; direction += 1)
      if (this.walkable(state, this.target(state, cell, direction), blocked)) count += 1;
    return count;
  }

edgeDistance(state, cell) {
    const exact = this.geometryWidth === state.width &&
      this.geometryHeight === state.height;
    const x = exact ? this.cellX[cell] : state.x(cell);
    const y = exact ? this.cellY[cell] : state.y(cell);
    return Math.max(0, Math.min(x - 1, state.width - 2 - x,
      y - 1, state.height - 2 - y));
  }

edgePenalty(state, seat, protectingLead, star) {
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][seat];
    const direction = a[ARRAY.TANK_DIR][seat]; const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
    const ring = this.edgeDistance(state, cell); const exits = this.mobility(state, seat);
    let penalty = ring <= 1 ? 105 : ring === 2 ? 48 : ring === 3 ? 16 : 0;
    if (exits <= 1) penalty += 145;
    else if (exits === 2) penalty += ring <= 2 ? 58 : 26;
    if (ring <= 2 && !this.walkable(state, this.target(state, cell, direction), enemy))
      penalty += 34;
    const distance = this.distance(state, cell, enemy);
    if (distance <= 3) penalty = Math.trunc(penalty * 165 / 100);
    else if (distance <= 5) penalty = Math.trunc(penalty * 130 / 100);
    if (protectingLead) penalty = Math.trunc(penalty * 135 / 100);
    if (star !== NONE_CELL && this.distance(state, cell, star) <= 2)
      penalty = Math.trunc(penalty / 2);
    return penalty;
  }

distance(state, a, b) {
    if (this.geometryWidth === state.width &&
        this.geometryHeight === state.height)
      return Math.abs(this.cellX[a] - this.cellX[b]) +
        Math.abs(this.cellY[a] - this.cellY[b]);
    return Math.abs(state.x(a) - state.x(b)) + Math.abs(state.y(a) - state.y(b));
  }

alignedDirection(state, from, target) {
    const exact = this.geometryWidth === state.width &&
      this.geometryHeight === state.height;
    const fx = exact ? this.cellX[from] : state.x(from);
    const fy = exact ? this.cellY[from] : state.y(from);
    const tx = exact ? this.cellX[target] : state.x(target);
    const ty = exact ? this.cellY[target] : state.y(target);
    if (fx === tx) return ty < fy ? 0 : ty > fy ? 2 : -1;
    if (fy === ty) return tx > fx ? 1 : tx < fx ? 3 : -1;
    return -1;
  }

rayClear(state, from, target) {
    const direction = this.alignedDirection(state, from, target);
    if (direction < 0) return 0;
    let cell = this.target(state, from, direction);
    while (cell !== NONE_CELL && cell !== target) {
      const tile = state.arrays[ARRAY.TERRAIN][cell];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
      cell = this.target(state, cell, direction);
    }
    return cell === target ? 1 : 0;
  }

turns(from, to) {
    const delta = Math.abs(from - to); return Math.min(delta, 4 - delta);
  }

boosted(state, seat) {
    const a = state.arrays; return this.active(a, ARRAY.TANK_BOOST_UNTIL, seat,
      a[ARRAY.SCALAR][SCALAR.FRAME]);
  }

canFire(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const lock = a[ARRAY.TANK_FIRE_LOCK][seat];
    if (lock !== NONE_FRAME && lock > frame) return 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 0;
    return 1;
  }

attackArrival(state, seat, wanted, lineOpen, distance) {
    const a = state.arrays;
    if (wanted < 0 || !lineOpen || !this.canFire(state, seat) ||
        a[ARRAY.TANK_SHIELD_HITS][seat ^ 1] > 0) return INF;
    let turnFrames = this.turns(a[ARRAY.TANK_DIR][seat], wanted);
    if (this.boosted(state, seat) && turnFrames > 0) turnFrames -= 1;
    return turnFrames + ((distance + 1) >> 1);
  }

leavesAxis(state, seat, bulletDirection, direction) {
    const a = state.arrays; const start = a[ARRAY.TANK_CELL][seat];
    const next = this.advance(state, start, direction,
      this.boosted(state, seat) ? 2 : 1, a[ARRAY.TANK_CELL][seat ^ 1]);
    if (next === start) return 0;
    return bulletDirection === 0 || bulletDirection === 2 ?
      (this.geometryWidth === state.width ? this.cellX[next] !== this.cellX[start] :
        state.x(next) !== state.x(start)) :
      (this.geometryHeight === state.height ? this.cellY[next] !== this.cellY[start] :
        state.y(next) !== state.y(start));
  }

minimumProjectileEscape(state, seat, bulletDirection) {
    const direction = state.arrays[ARRAY.TANK_DIR][seat];
    if (this.leavesAxis(state, seat, bulletDirection, direction)) return 1;
    if (this.leavesAxis(state, seat, bulletDirection, (direction + 3) & 3) ||
        this.leavesAxis(state, seat, bulletDirection, (direction + 1) & 3)) return 2;
    return INF;
  }

projectileThreat(state, owner) {
    const a = state.arrays; const targetSeat = owner ^ 1;
    const target = a[ARRAY.TANK_CELL][targetSeat]; let value = 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot] ||
          a[ARRAY.PROJECTILE_OWNER][slot] !== owner) continue;
      const cell = a[ARRAY.PROJECTILE_CELL][slot];
      const direction = a[ARRAY.PROJECTILE_DIR][slot];
      if (this.alignedDirection(state, cell, target) !== direction ||
          !this.rayClear(state, cell, target)) continue;
      const frames = (this.distance(state, cell, target) + 1) >> 1;
      const needed = this.minimumProjectileEscape(state, targetSeat, direction);
      let threat; const simulated = this.discountSimulatedProjectiles &&
        this.simulatedProjectile(state, slot);
      if (simulated) {
        ;
        if (frames === 1) threat = needed <= frames ? 1200 : 50000;
        else {
          threat = Math.max(80, 420 - (frames - 1) * 75);
          if (needed < INF) threat = Math.trunc(threat * 35 / 100);
        }
      } else if (needed > frames) threat = 50000;
      else {
        const slack = frames - needed;
        if (slack === 0) threat = 35000;
        else if (slack === 1) threat = 10000;
        else {
          threat = Math.max(80, 420 - (frames - 1) * 75);
          if (needed < INF) threat = Math.trunc(threat * 35 / 100);
        }
      }
      value += threat; ;
    }
    return value;
  }

bombHits(state, center, candidate) {
    const exact = this.geometryWidth === state.width &&
      this.geometryHeight === state.height;
    const cx = exact ? this.cellX[center] : state.x(center);
    const cy = exact ? this.cellY[center] : state.y(center);
    const tx = exact ? this.cellX[candidate] : state.x(candidate);
    const ty = exact ? this.cellY[candidate] : state.y(candidate);
    if (cx === tx && cy === ty) return 1;
    if (cx !== tx && cy !== ty) return 0;
    const distance = Math.abs(cx - tx) + Math.abs(cy - ty);
    if (distance > RULE.BOMB_RANGE) return 0;
    const dx = tx === cx ? 0 : tx > cx ? 1 : -1;
    const dy = ty === cy ? 0 : ty > cy ? 1 : -1;
    const terrain = state.arrays[ARRAY.TERRAIN];
    for (let step = 1; step <= distance; step += 1) {
      const tile = terrain[state.cell(cx + dx * step, cy + dy * step)];
      if (tile === TERRAIN.WALL) return 0;
      if (tile === TERRAIN.DIRT) return step === distance ? 1 : 0;
    }
    return 1;
  }

nextStamp() {
    this.stamp = (this.stamp + 1) & 0xffff;
    if (!this.stamp) { this.poseStamp.fill(0); this.stamp = 1; }
    return this.stamp;
  }

minimumBombEscape(state, seat, center, limit) {
    const a = state.arrays; const start = a[ARRAY.TANK_CELL][seat];
    if (!this.bombHits(state, center, start)) return 0;
    const speed = this.boosted(state, seat) ? 2 : 1;
    const blocked = a[ARRAY.TANK_CELL][seat ^ 1]; const stamp = this.nextStamp();
    let head = 0; let tail = 1;
    this.poseCell[0] = start; this.poseDirection[0] = a[ARRAY.TANK_DIR][seat];
    this.poseDepth[0] = 0; this.poseStamp[start * 4 + this.poseDirection[0]] = stamp;
    while (head < tail) {
      const cell = this.poseCell[head]; const direction = this.poseDirection[head];
      const depth = this.poseDepth[head++]; if (depth >= limit) continue;
      for (let branch = 0; branch < 3; branch += 1) {
        const nextDirection = branch === 0 ? direction :
          branch === 1 ? (direction + 3) & 3 : (direction + 1) & 3;
        const nextCell = branch === 0 ?
          this.advance(state, cell, direction, speed, blocked) : cell;
        const nextDepth = depth + 1;
        if (!this.bombHits(state, center, nextCell)) return nextDepth;
        const key = nextCell * 4 + nextDirection;
        if (this.poseStamp[key] === stamp || tail >= POSE_COUNT) continue;
        this.poseStamp[key] = stamp; this.poseCell[tail] = nextCell;
        this.poseDirection[tail] = nextDirection; this.poseDepth[tail] = nextDepth; tail += 1;
      }
    }
    return INF;
  }

bombPressure(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const cell = a[ARRAY.TANK_CELL][seat]; let maximum = 0;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1) {
      if (!a[ARRAY.BOMB_ACTIVE][slot]) continue;
      const center = a[ARRAY.BOMB_CELL][slot];
      if (!this.bombHits(state, center, cell)) continue;
      const remaining = Math.max(0, a[ARRAY.BOMB_EXPLODE][slot] - frame);
      if (a[ARRAY.TANK_SHIELD_HITS][seat] > 0 &&
          this.remaining(a, ARRAY.TANK_SHIELD_UNTIL, seat, frame) >= remaining + 1) {
        if (maximum < 900) maximum = 900;
        continue;
      }
      const needed = this.minimumBombEscape(state, seat, center, Math.min(10, remaining + 1));
      let available = remaining + 1;
      const frozen = this.remaining(a, ARRAY.TANK_FROZEN_UNTIL, seat, frame);
      if (frozen) available -= Math.min(available, frozen);
      if (this.active(a, ARRAY.TANK_POISON_UNTIL, seat, frame))
        available = (Math.max(0, available) + 1) >> 1;
      const slack = available - needed;
      const risk = slack < 0 ? 50000 : slack === 0 ? 35000 :
        slack === 1 ? 10000 : slack === 2 ? 3500 : Math.max(180, 1400 - slack * 180);
      if (risk > maximum) maximum = risk;
      ;
    }
    return maximum;
  }

lineValue(state, targetSeat, direction, distance) {
    const frames = (distance + 1) >> 1;
    const dodge = this.minimumProjectileEscape(state, targetSeat, direction) <= frames;
    if (frames === 1) return dodge ? 900 : 30000;
    let value = Math.max(70, 360 - (frames - 1) * 65);
    if (dodge) value = Math.trunc(value * 2 / 5);
    return value;
  }

muzzleRisk(state, shooter, wanted, lineOpen, distance) {
    if (!this.canFire(state, shooter)) return 0;
    const a = state.arrays; const target = shooter ^ 1;
    const turns = wanted < 0 ? INF : this.turns(a[ARRAY.TANK_DIR][shooter], wanted);
    if (wanted >= 0 && lineOpen && turns === 0 && distance <= 2)
      return this.minimumProjectileEscape(state, target, wanted) <= 1 ? 1200 : 50000;
    if (wanted >= 0 && lineOpen && turns === 0 && distance <= 4) {
      const frames = (distance + 1) >> 1;
      const escape = this.minimumProjectileEscape(state, target, wanted) <= frames;
      return distance === 3 ? escape ? 4000 : 22000 : escape ? 1800 : 10000;
    }
    if (this.boosted(state, shooter) && turns === 1 && distance <= 2) return 35000;
    if (distance === 1) return 1200;
    if (distance === 2) return 650;
    if (distance === 3) return 400;
    return 0;
  }

buildStarField(state, star, distance = this.starDistance, base = 0) {
    distance.fill(0, base, base + state.cells); ;
    let head = 0; let tail = 1; this.cellQueue[0] = star;
    distance[base + star] = 1;
    while (head < tail) {
      const cell = this.cellQueue[head++];
      const nextDistance = distance[base + cell] + 1;
      for (let direction = 0; direction < 4; direction += 1) {
        const next = this.target(state, cell, direction);
        if (next === NONE_CELL || distance[base + next] ||
            !this.walkable(state, next, NONE_CELL)) continue;
        distance[base + next] = nextDistance; this.cellQueue[tail++] = next;
      }
    }
  }

cachedTerrainEquals(state, entry) {
    const base = entry * CAPACITY.MAX_CELLS;
    const terrain = state.arrays[ARRAY.TERRAIN];
    ;
    if (this.rootTerrainReady) {
      if (this.starCacheRootGeneration[entry] !== this.rootTerrainGeneration)
        return 0;
      const version = state.arrays[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION];
      const expected = version - this.rootTerrainVersion;
      if (expected < 0) return 0;
      let changed = 0;
      for (let cursor = this.rootTerrainDeltaBase;
          cursor < state.deltaUsed; cursor += 1) {
        if (state.deltaArray[cursor] !== ARRAY.TERRAIN) continue;
        const cell = state.deltaIndex[cursor]; changed += 1;
        ;
        if (this.starCacheTerrain[base + cell] !== terrain[cell]) return 0;
      }
      return changed === expected ? 1 : 0;
    }
    for (let cell = 0; cell < state.cells; cell += 1) {
      ;
      if (this.starCacheTerrain[base + cell] !== terrain[cell]) return 0;
    }
    return 1;
  }

prepareStarField(state, star) {
    if (!this.starFieldCacheEntries) {
      this.activeStarDistance = this.starDistance;
      this.activeStarDistanceBase = 0;
      this.buildStarField(state, star);
      return;
    }
    const version = state.arrays[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION];
    for (let entry = 0; entry < this.starFieldCacheEntries; entry += 1) {
      if (this.starCacheStar[entry] !== star ||
          this.starCacheVersion[entry] !== version ||
          this.starCacheWidth[entry] !== state.width ||
          this.starCacheHeight[entry] !== state.height ||
          !this.cachedTerrainEquals(state, entry)) continue;
      ;
      this.activeStarDistance = this.starCacheDistance;
      this.activeStarDistanceBase = entry * CAPACITY.MAX_CELLS;
      return;
    }
    ;
    const entry = this.starCacheCursor;
    this.starCacheCursor = (entry + 1) % this.starFieldCacheEntries;
    const base = entry * CAPACITY.MAX_CELLS;
    this.starCacheStar[entry] = star;
    this.starCacheVersion[entry] = version;
    this.starCacheWidth[entry] = state.width;
    this.starCacheHeight[entry] = state.height;
    this.starCacheRootGeneration[entry] = this.rootTerrainGeneration;
    const terrain = state.arrays[ARRAY.TERRAIN];
    for (let cell = 0; cell < state.cells; cell += 1)
      this.starCacheTerrain[base + cell] = terrain[cell];
    this.activeStarDistance = this.starCacheDistance;
    this.activeStarDistanceBase = base;
    this.buildStarField(state, star, this.starCacheDistance, base);
  }

finiteStarDistance(cell) {
    const value = this.activeStarDistance[this.activeStarDistanceBase + cell];
    return value ? value - 1 : 30;
  }

skillOptionPenalty(state, distance, ownBombPressure) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_SKILL_READY][1] > frame) return 0;
    const skill = a[ARRAY.TANK_SKILL][1];
    let base = skill === SKILL.FREEZE ? 900 : skill === SKILL.STUN ? 700 :
      skill === SKILL.OVERLOAD ? 650 : skill === SKILL.TELEPORT ? 800 :
      skill === SKILL.BOOST ? 700 : skill === SKILL.POISON ? 600 :
      skill === SKILL.CLOAK ? 450 : skill === SKILL.SHIELD ? 400 : 0;
    if (ownBombPressure >= 1200 &&
        (skill === SKILL.FREEZE || skill === SKILL.STUN || skill === SKILL.POISON))
      base += 600;
    const opportunityTenths = Math.max(0, 10 - distance);
    return Math.trunc(base * (350 + opportunityTenths * 65) / 1000);
  }

evaluate(state) {
    ; const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const ownStars = a[ARRAY.TANK_STARS][0]; const enemyStars = a[ARRAY.TANK_STARS][1];
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME]; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const starScore = (ownStars - enemyStars) * 900;
    let starRoute = 0;
    const ownProjectile = this.projectileThreat(state, 0);
    const enemyProjectile = this.projectileThreat(state, 1);
    const ownBombPressure = this.bombPressure(state, 0);
    const enemyBombPressure = this.bombPressure(state, 1);
    const projectile = ownProjectile - enemyProjectile +
      enemyBombPressure - ownBombPressure;
    const distance = this.distance(state, own, enemy);
    const ownAim = this.alignedDirection(state, own, enemy);
    const enemyAim = this.alignedDirection(state, enemy, own);
    const lineOpen = ownAim >= 0 && this.rayClear(state, own, enemy);
    const ownArrival = this.attackArrival(state, 0, ownAim, lineOpen, distance);
    const enemyArrival = this.attackArrival(state, 1, enemyAim, lineOpen, distance);
    let attack = Math.trunc(this.muzzleRisk(state, 0, ownAim, lineOpen, distance) * 3 / 4) -
      this.muzzleRisk(state, 1, enemyAim, lineOpen, distance);
    if (ownArrival < enemyArrival && ownArrival <= 4) {
      attack += Math.trunc(16000 / Math.max(1, ownArrival)); ;
    } else if (enemyArrival < ownArrival && enemyArrival <= 4) {
      attack -= Math.trunc(22000 / Math.max(1, enemyArrival)); ;
    } else if (ownArrival === enemyArrival && ownArrival <= 2) {
      attack -= 2500; ;
    }
    if (lineOpen) {
      if (ownAim === a[ARRAY.TANK_DIR][0]) {
        attack += this.canFire(state, 0) ? this.lineValue(state, 1, ownAim, distance) : 35;
        ;
      }
      if (enemyAim === a[ARRAY.TANK_DIR][1] && this.canFire(state, 1)) {
        attack -= this.lineValue(state, 0, enemyAim, distance); ;
      }
      if (a[ARRAY.TANK_SHIELD_HITS][1] > 0 && ownAim === a[ARRAY.TANK_DIR][0])
        attack -= 100;
    }
    if (star !== NONE_CELL) {
      this.prepareStarField(state, star);
      const ownDistance = this.finiteStarDistance(own);
      const enemyDistance = this.finiteStarDistance(enemy);
      let ownWeight = 20; let enemyWeight = 16;
      if (ownStars < enemyStars) { ownWeight = 38; enemyWeight = 24; }
      else if (ownStars === enemyStars && ownDistance <= enemyDistance + 3) {
        ownWeight = 28; enemyWeight = 20;
      }
      starRoute = enemyDistance * enemyWeight - ownDistance * ownWeight;
    }
    const ownMobility = this.mobility(state, 0); const enemyMobility = this.mobility(state, 1);
    let position = (ownMobility - enemyMobility) * 7;
    position -= this.edgePenalty(state, 0, ownStars > enemyStars, star);
    position += Math.trunc(this.edgePenalty(state, 1, 0, star) * 55 / 100);
    if (!lineOpen) position += 18;
    if (a[ARRAY.TERRAIN][own] === TERRAIN.GRASS) position += 18;
    if (a[ARRAY.TERRAIN][enemy] === TERRAIN.GRASS) position -= 8;
    if (distance === 1) position -= 25;
    let status = a[ARRAY.TANK_SKILL_READY][0] <= frame ? 10 : 0;
    status += this.remaining(a, ARRAY.TANK_STUN_UNTIL, 1, frame) * 18;
    status -= this.remaining(a, ARRAY.TANK_FROZEN_UNTIL, 0, frame) * 260;
    status -= this.remaining(a, ARRAY.TANK_POISON_UNTIL, 0, frame) * 90;
    status -= this.remaining(a, ARRAY.TANK_STUN_UNTIL, 0, frame) * 75;
    status += this.remaining(a, ARRAY.TANK_FROZEN_UNTIL, 1, frame) * 220;
    status += this.remaining(a, ARRAY.TANK_POISON_UNTIL, 1, frame) * 70;
    status += a[ARRAY.TANK_SHIELD_HITS][0] * 180 - a[ARRAY.TANK_SHIELD_HITS][1] * 180;
    if (this.active(a, ARRAY.TANK_OVERLOAD_UNTIL, 1, frame)) status -= 420;
    if (this.active(a, ARRAY.TANK_BOOST_UNTIL, 1, frame)) status -= 260;
    if (this.active(a, ARRAY.TANK_CLOAK_UNTIL, 1, frame)) status -= 220;
    status -= this.skillOptionPenalty(state, distance, ownBombPressure);
    if (status) ;
    this.lastComponents[0] = starScore;
    this.lastComponents[1] = starRoute;
    this.lastComponents[2] = projectile;
    this.lastComponents[3] = attack;
    this.lastComponents[4] = position;
    this.lastComponents[5] = status;
    let value = 0;
    for (let index = 0; index < COMPONENT_NAME.length; index += 1) {
      const component = this.lastComponents[index];
      ;
      ;
      if (this.componentMask & (1 << index)) {
        const bounded = this.clampMode === "component" ?
          clamp(component, -this.clampLimit, this.clampLimit) : component;
        if (bounded !== component) ;
        value += bounded;
      }
    }
    const result = this.clampMode === "total" ?
      clamp(value, -this.clampLimit, this.clampLimit) : value;
    if (result !== value) ;
    return result;
  }
}

module.exports = { COMPONENT_NAME, LEAF_COMPONENT, NativeBasePolicyLeafEvaluator };
