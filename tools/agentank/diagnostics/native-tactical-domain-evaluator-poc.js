"use strict";

// Diagnostic-only native V2 tactical domain and leaf evaluator.  The POC
// separates two hypotheses that were previously mixed together:
//   1. FIRE is a legal physical action, but not always a useful tactical row.
//   2. A non-terminal leaf must preserve projectile/attack initiative instead
//      of reducing the state to stars, distance and mobility.
// It installs on one ProductionDepthSearch instance and never mutates the
// production prototype or source files.

const { CAPACITY, RULE } = require("../../../engine-v2/src/generated/fast-config");
const { SEARCH_CAPACITY } = require("../../../engine-v2/src/generated/search-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, EVENT, SKILL, TERRAIN, NONE_FRAME, NONE_CELL, DX, DY } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { ProjectileAttackTimeline, AttackReverseViability } = require(
  "../../../engine-v2/src/search/projectile-attack-closure");

const DOMAIN_MODE = Object.freeze({ ALL: 0, QUALIFIED_FIRE: 1,
  QUALIFIED_RESOURCE: 2, QUALIFIED_FIRE_RESOURCE: 3 });
const TACTICAL_INTENT = Object.freeze({ NONE: 0, ATTACK: 1, CHASE_STAR: 2,
  EXIT_EDGE: 3, FACE_ENEMY: 4, EVADE: 5 });
const MAX_ATTACK_POSE_OPTIONS = 64;
const UNREACHABLE = 0xff;
const PATH_UNREACHABLE = 0xffff;
const BOMB_POSE_COUNT = CAPACITY.MAX_CELLS * 4;
const SETTLEMENT = Object.freeze({ NONE: 0, SURVIVES: 1, DOOMED: 2,
  UNKNOWN: 3 });
const LEAF_COMPONENT = Object.freeze({ STAR: 1 << 0, ORDNANCE: 1 << 1,
  ATTACK: 1 << 2, MOBILITY: 1 << 3, STATUS: 1 << 4 });
const LEAF_COMPONENT_ALL = LEAF_COMPONENT.STAR | LEAF_COMPONENT.ORDNANCE |
  LEAF_COMPONENT.ATTACK | LEAF_COMPONENT.MOBILITY | LEAF_COMPONENT.STATUS;

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function mix32(hash, value) {
  let result = (hash ^ (value >>> 0)) >>> 0;
  result = (result + ((result << 1) >>> 0) + ((result << 4) >>> 0) +
    ((result << 7) >>> 0) + ((result << 8) >>> 0) +
    ((result << 24) >>> 0)) >>> 0;
  return result;
}

function isAhead(state, from, direction, target) {
  const fx = state.x(from); const fy = state.y(from);
  const tx = state.x(target); const ty = state.y(target);
  if (direction === 0) return fx === tx && ty < fy;
  if (direction === 1) return fy === ty && tx > fx;
  if (direction === 2) return fx === tx && ty > fy;
  return fy === ty && tx < fx;
}

function rayClear(state, from, target) {
  const fx = state.x(from); const fy = state.y(from);
  const tx = state.x(target); const ty = state.y(target);
  if (fx !== tx && fy !== ty) return 0;
  const dx = tx === fx ? 0 : tx > fx ? 1 : -1;
  const dy = ty === fy ? 0 : ty > fy ? 1 : -1;
  const terrain = state.arrays[ARRAY.TERRAIN];
  let x = fx + dx; let y = fy + dy;
  while (x !== tx || y !== ty) {
    const tile = terrain[state.cell(x, y)];
    if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
    x += dx; y += dy;
  }
  return 1;
}

class NativeTacticalDomainPoc {
  constructor(mode = DOMAIN_MODE.QUALIFIED_FIRE) {
    this.mode = mode; this.checkCount = 0; this.fireCheckCount = 0;
    this.directFireCount = 0; this.interceptFireCount = 0;
    this.blockedFireCount = 0; this.hotAllocationCount = 0;
    this.resourceCheckCount = 0; this.bombAllowedCount = 0;
    this.bombBlockedCount = 0; this.skillAllowedCount = 0;
    this.skillBlockedCount = 0;
    this.bombDistance = new Uint8Array(CAPACITY.MAX_CELLS);
    this.bombQueue = new Uint16Array(CAPACITY.MAX_CELLS);
    this.bombPoseStamp = new Uint16Array(BOMB_POSE_COUNT);
    this.bombPoseCell = new Uint16Array(BOMB_POSE_COUNT);
    this.bombPoseDirection = new Uint8Array(BOMB_POSE_COUNT);
    this.bombPoseDepth = new Uint8Array(BOMB_POSE_COUNT);
    this.bombStamp = 0;
  }

  qualifiedFire(state) {
    return this.qualifiedFireForSeat(state, 0);
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

  qualifiedFireForSeat(state, seat, targetMotionBasisPoints = 10000) {
    const a = state.arrays; const otherSeat = seat ^ 1;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (!this.canFire(state, seat)) {
      this.blockedFireCount += 1; return 0;
    }
    const targetCloak = a[ARRAY.TANK_CLOAK_UNTIL][otherSeat];
    if (targetCloak !== NONE_FRAME && targetCloak > frame) {
      this.blockedFireCount += 1; return 0;
    }
    const own = a[ARRAY.TANK_CELL][seat];
    const enemy = a[ARRAY.TANK_CELL][otherSeat];
    const direction = a[ARRAY.TANK_DIR][seat];
    if (isAhead(state, own, direction, enemy) && rayClear(state, own, enemy)) {
      const shield = a[ARRAY.TANK_SHIELD_UNTIL][otherSeat];
      if (seat === 0 && a[ARRAY.TANK_SHIELD_HITS][otherSeat] > 0 &&
          shield !== NONE_FRAME && shield > frame) {
        this.blockedFireCount += 1; return 0;
      }
      this.directFireCount += 1; return 1;
    }
    // Response-conditioned intercept domain.  A FIRE row is useful when at
    // least one open ray cell has compatible projectile and enemy arrival
    // deadlines.  Route support raises confidence but never becomes Proof.
    const ox = state.x(own); const oy = state.y(own);
    const ex = state.x(enemy); const ey = state.y(enemy);
    const dx = direction === 1 ? 1 : direction === 3 ? -1 : 0;
    const dy = direction === 2 ? 1 : direction === 0 ? -1 : 0;
    const enemySpeed = a[ARRAY.TANK_BOOST_UNTIL][otherSeat] !== NONE_FRAME &&
      a[ARRAY.TANK_BOOST_UNTIL][otherSeat] > frame ? 2 : 1;
    const enemyDirection = a[ARRAY.TANK_DIR][otherSeat];
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const objective = star === NONE_CELL ? own : star;
    const targetObjective = Math.abs(ex - state.x(objective)) +
      Math.abs(ey - state.y(objective));
    let x = ox; let y = oy; let best = -2147483648;
    for (let distance = 1; distance <= 18; distance += 1) {
      x += dx; y += dy;
      if (x < 0 || x >= state.width || y < 0 || y >= state.height) break;
      const cell = state.cell(x, y); const tile = a[ARRAY.TERRAIN][cell];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) break;
      if (x === ex && y === ey) break;
      const pathDistance = Math.abs(ex - x) + Math.abs(ey - y);
      const projectileArrival = (distance + 1) >> 1;
      const firstDirection = x > ex ? 1 : x < ex ? 3 : y > ey ? 2 : 0;
      const turnDelta = Math.abs(enemyDirection - firstDirection);
      const turnFrames = Math.min(turnDelta, 4 - turnDelta);
      const enemyArrival = turnFrames + Math.ceil(pathDistance / enemySpeed);
      const timing = Math.abs(enemyArrival - projectileArrival);
      if (enemyArrival > projectileArrival + 1 || timing > 2) continue;
      const positionObjective = Math.abs(x - state.x(objective)) +
        Math.abs(y - state.y(objective));
      const onLikelyRoute = pathDistance + positionObjective <= targetObjective + 1;
      if (!onLikelyRoute && timing > 0) continue;
      let chanceBasisPoints = 1200;
      if (timing === 0) chanceBasisPoints += 3400;
      else if (timing === 1) chanceBasisPoints += 1700;
      if (onLikelyRoute) chanceBasisPoints += 2400;
      if (firstDirection === enemyDirection) chanceBasisPoints += 1600;
      chanceBasisPoints = Math.min(8800, chanceBasisPoints);
      const valueTimes100 = Math.trunc(chanceBasisPoints * 32 / 10) -
        projectileArrival * 700;
      if (valueTimes100 > best) best = valueTimes100;
    }
    if (seat === 0 && best > -2147483648)
      best = Math.trunc(best * Math.max(0, Math.min(10000,
        targetMotionBasisPoints)) / 10000);
    let thresholdTimes100 = 2500;
    if (seat === 0 && star !== NONE_CELL &&
        a[ARRAY.TANK_STARS][0] <= a[ARRAY.TANK_STARS][1]) {
      const ownStar = Math.abs(ox - state.x(star)) + Math.abs(oy - state.y(star));
      const enemyStar = Math.abs(ex - state.x(star)) + Math.abs(ey - state.y(star));
      thresholdTimes100 = ownStar <= enemyStar + 3 ? 11000 : 7000;
    }
    if (best > thresholdTimes100) {
      this.interceptFireCount += 1; return 1;
    }
    this.blockedFireCount += 1; return 0;
  }

  allows(engine, row) {
    this.checkCount += 1;
    const action = engine.ourActions[row]; const state = engine.adapter.state;
    if ((this.mode & DOMAIN_MODE.QUALIFIED_FIRE) && action === ACTION.FIRE) {
      this.fireCheckCount += 1; return this.qualifiedFire(state);
    }
    if (!(this.mode & DOMAIN_MODE.QUALIFIED_RESOURCE)) return 1;
    if (action === ACTION.THROW_BOMB) {
      this.resourceCheckCount += 1; const allowed = this.qualifiedBomb(state);
      if (allowed) this.bombAllowedCount += 1; else this.bombBlockedCount += 1;
      return allowed;
    }
    if (action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST) {
      this.resourceCheckCount += 1; const allowed = this.qualifiedSkill(state, action);
      if (allowed) this.skillAllowedCount += 1; else this.skillBlockedCount += 1;
      return allowed;
    }
    return 1;
  }

  mobility(state, seat) {
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][seat];
    const other = a[ARRAY.TANK_CELL][seat ^ 1]; const x = state.x(cell);
    const y = state.y(cell); let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const nx = x + (direction === 1 ? 1 : direction === 3 ? -1 : 0);
      const ny = y + (direction === 2 ? 1 : direction === 0 ? -1 : 0);
      if (nx < 0 || nx >= state.width || ny < 0 || ny >= state.height) continue;
      const target = state.cell(nx, ny); const tile = a[ARRAY.TERRAIN][target];
      if (target !== other && tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT) count += 1;
    }
    return count;
  }

  target(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ?
      NONE_CELL : state.cell(x, y);
  }

  walkable(state, cell, blocked = NONE_CELL) {
    if (cell === NONE_CELL || cell === blocked) return 0;
    const tile = state.arrays[ARRAY.TERRAIN][cell];
    return tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT ? 1 : 0;
  }

  bombHits(state, center, candidate) {
    const cx = state.x(center); const cy = state.y(center);
    const tx = state.x(candidate); const ty = state.y(candidate);
    if (cx === tx && cy === ty) return 1;
    if (cx !== tx && cy !== ty) return 0;
    const distance = Math.abs(cx - tx) + Math.abs(cy - ty);
    if (distance > RULE.BOMB_RANGE) return 0;
    const dx = tx === cx ? 0 : tx > cx ? 1 : -1;
    const dy = ty === cy ? 0 : ty > cy ? 1 : -1;
    for (let step = 1; step <= distance; step += 1) {
      const tile = state.arrays[ARRAY.TERRAIN][state.cell(cx + dx * step,
        cy + dy * step)];
      if (tile === TERRAIN.WALL) return 0;
      if (tile === TERRAIN.DIRT) return step === distance ? 1 : 0;
    }
    return 1;
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

  nextBombStamp() {
    this.bombStamp = (this.bombStamp + 1) & 0xffff;
    if (!this.bombStamp) { this.bombPoseStamp.fill(0); this.bombStamp = 1; }
    return this.bombStamp;
  }

  minimumBombEscape(state, seat, center, limit) {
    const a = state.arrays; const start = a[ARRAY.TANK_CELL][seat];
    if (!this.bombHits(state, center, start)) return 0;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const boosted = a[ARRAY.TANK_BOOST_UNTIL][seat] !== NONE_FRAME &&
      a[ARRAY.TANK_BOOST_UNTIL][seat] > frame;
    const blocked = a[ARRAY.TANK_CELL][seat ^ 1]; const stamp = this.nextBombStamp();
    let head = 0; let tail = 1;
    this.bombPoseCell[0] = start; this.bombPoseDirection[0] = a[ARRAY.TANK_DIR][seat];
    this.bombPoseDepth[0] = 0;
    this.bombPoseStamp[start * 4 + this.bombPoseDirection[0]] = stamp;
    while (head < tail) {
      const cell = this.bombPoseCell[head]; const direction = this.bombPoseDirection[head];
      const depth = this.bombPoseDepth[head++]; if (depth >= limit) continue;
      for (let branch = 0; branch < 3; branch += 1) {
        const nextDirection = branch === 0 ? direction :
          branch === 1 ? (direction + 3) & 3 : (direction + 1) & 3;
        const nextCell = branch === 0 ?
          this.advance(state, cell, direction, boosted ? 2 : 1, blocked) : cell;
        const nextDepth = depth + 1;
        if (!this.bombHits(state, center, nextCell)) return nextDepth;
        const key = nextCell * 4 + nextDirection;
        if (this.bombPoseStamp[key] === stamp || tail >= BOMB_POSE_COUNT) continue;
        this.bombPoseStamp[key] = stamp; this.bombPoseCell[tail] = nextCell;
        this.bombPoseDirection[tail] = nextDirection;
        this.bombPoseDepth[tail] = nextDepth; tail += 1;
      }
    }
    return 99;
  }

  starDistances(state, star) {
    const distance = this.bombDistance; distance.fill(UNREACHABLE, 0, state.cells);
    let head = 0; let tail = 1; this.bombQueue[0] = star; distance[star] = 0;
    while (head < tail) {
      const cell = this.bombQueue[head++]; const nextDistance = distance[cell] + 1;
      for (let direction = 0; direction < 4; direction += 1) {
        const next = this.target(state, cell, direction);
        if (!this.walkable(state, next) || distance[next] !== UNREACHABLE) continue;
        distance[next] = nextDistance; this.bombQueue[tail++] = next;
      }
    }
    return distance;
  }

  qualifiedBomb(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    if (a[ARRAY.TANK_BOMB_READY][0] > frame ||
        a[ARRAY.TERRAIN][own] === TERRAIN.GRASS) return 0;
    const frozen = a[ARRAY.TANK_FROZEN_UNTIL][0];
    const poisoned = a[ARRAY.TANK_POISON_UNTIL][0];
    if (frozen !== NONE_FRAME && frozen > frame ||
        poisoned !== NONE_FRAME && poisoned > frame) return 0;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot] &&
          this.bombHits(state, a[ARRAY.BOMB_CELL][slot], own)) return 0;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star !== NONE_CELL && a[ARRAY.TANK_STARS][0] <= a[ARRAY.TANK_STARS][1]) {
      const route = this.starDistances(state, star);
      if (route[enemy] <= 2 && route[enemy] < route[own]) return 0;
    }
    if (this.minimumBombEscape(state, 0, own, 8) > 6) return 0;
    const ox = state.x(own); const oy = state.y(own);
    const enemyDistance = Math.abs(ox - state.x(enemy)) +
      Math.abs(oy - state.y(enemy));
    let utility = this.bombHits(state, own, enemy) ? 190 : 0;
    const enemyMobility = this.mobility(state, 1);
    if (enemyMobility <= 2 && enemyDistance <= 4)
      utility += (3 - enemyMobility) * 90;
    for (let direction = 0; direction < 4; direction += 1) {
      let cell = own;
      for (let step = 1; step <= RULE.BOMB_RANGE; step += 1) {
        cell = this.target(state, cell, direction); if (cell === NONE_CELL) break;
        const tile = a[ARRAY.TERRAIN][cell];
        if (tile === TERRAIN.WALL) break;
        if (tile === TERRAIN.DIRT) { utility += 45; break; }
      }
    }
    const enemyStun = a[ARRAY.TANK_STUN_UNTIL][1];
    if (enemyStun !== NONE_FRAME && enemyStun > frame)
      utility += Math.min(180, (enemyStun - frame) * 24);
    if (star !== NONE_CELL && this.bombHits(state, own, star)) {
      const ownStar = Math.abs(state.x(star) - ox) + Math.abs(state.y(star) - oy);
      const enemyStar = Math.abs(state.x(star) - state.x(enemy)) +
        Math.abs(state.y(star) - state.y(enemy));
      utility += enemyStar <= ownStar ? 90 : -80;
    }
    const enemySkill = a[ARRAY.TANK_SKILL][1];
    if (a[ARRAY.TANK_SKILL_READY][1] <= frame &&
        (enemySkill === SKILL.TELEPORT || enemySkill === SKILL.BOOST ||
         enemySkill === SKILL.SHIELD)) utility = Math.trunc(utility * 45 / 100);
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === 1) { utility -= 500; break; }
    const enemyDirection = a[ARRAY.TANK_DIR][1];
    if (isAhead(state, enemy, enemyDirection, own) && rayClear(state, enemy, own) &&
        this.canFire(state, 1)) utility -= 600;
    if (ox <= 1 || oy <= 1 || ox >= state.width - 2 || oy >= state.height - 2)
      utility -= 160;
    return utility >= 140 ? 1 : 0;
  }

  qualifiedSkill(state, action) {
    // Shield/teleport/boost remain safety-capable.  Offensive timed effects
    // enter the tactical domain only with contact or a contested objective.
    if (action === ACTION.CAST_SHIELD || action === ACTION.CAST_TELEPORT ||
        action === ACTION.CAST_BOOST) return 1;
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1];
    const distance = Math.abs(state.x(own) - state.x(enemy)) +
      Math.abs(state.y(own) - state.y(enemy));
    if (distance <= 4 || distance <= 9 && rayClear(state, own, enemy)) return 1;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star === NONE_CELL || distance > 9) return 0;
    const ownStar = Math.abs(state.x(own) - state.x(star)) +
      Math.abs(state.y(own) - state.y(star));
    const enemyStar = Math.abs(state.x(enemy) - state.x(star)) +
      Math.abs(state.y(enemy) - state.y(star));
    return enemyStar <= ownStar + 3 ? 1 : 0;
  }

  summary() {
    return { mode: this.mode, checkCount: this.checkCount,
      fireCheckCount: this.fireCheckCount, directFireCount: this.directFireCount,
      interceptFireCount: this.interceptFireCount,
      blockedFireCount: this.blockedFireCount,
      resourceCheckCount: this.resourceCheckCount,
      bombAllowedCount: this.bombAllowedCount, bombBlockedCount: this.bombBlockedCount,
      skillAllowedCount: this.skillAllowedCount, skillBlockedCount: this.skillBlockedCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

class NativeTacticalLeafEvaluatorPoc {
  constructor(options = {}) {
    this.stunStatusMode = options.stunStatusMode === "duration" ?
      "duration" : "flat";
    this.callCount = 0; this.projectileThreatCount = 0;
    this.projectileWasteCount = 0; this.directAimCount = 0;
    this.attackSetupCount = 0; this.bombPressureCount = 0;
    this.clampCount = 0; this.hotAllocationCount = 0;
  }

  canFire(state, seat) {
    const a = state.arrays; const lock = a[ARRAY.TANK_FIRE_LOCK][seat];
    if (lock !== NONE_FRAME && lock > a[ARRAY.SCALAR][SCALAR.FRAME]) return 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 0;
    return 1;
  }

  mobility(state, seat) {
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][seat];
    const other = a[ARRAY.TANK_CELL][seat ^ 1]; const x = state.x(cell);
    const y = state.y(cell); let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const nx = x + (direction === 1 ? 1 : direction === 3 ? -1 : 0);
      const ny = y + (direction === 2 ? 1 : direction === 0 ? -1 : 0);
      if (nx < 0 || nx >= state.width || ny < 0 || ny >= state.height) continue;
      const target = state.cell(nx, ny); const tile = a[ARRAY.TERRAIN][target];
      if (target !== other && tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT) count += 1;
    }
    return count;
  }

  projectileValue(state, owner) {
    const a = state.arrays; const target = a[ARRAY.TANK_CELL][owner ^ 1];
    let value = 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot] ||
          a[ARRAY.PROJECTILE_OWNER][slot] !== owner) continue;
      const cell = a[ARRAY.PROJECTILE_CELL][slot];
      const direction = a[ARRAY.PROJECTILE_DIR][slot];
      if (isAhead(state, cell, direction, target) && rayClear(state, cell, target)) {
        const distance = Math.abs(state.x(cell) - state.x(target)) +
          Math.abs(state.y(cell) - state.y(target));
        value += Math.max(1200, 7200 - distance * 650);
        this.projectileThreatCount += 1;
      } else {
        value -= 700; this.projectileWasteCount += 1;
      }
    }
    return value;
  }

  bombValue(state, owner) {
    const a = state.arrays; const target = a[ARRAY.TANK_CELL][owner ^ 1];
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME]; let value = 0;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1) {
      if (!a[ARRAY.BOMB_ACTIVE][slot] || a[ARRAY.BOMB_OWNER][slot] !== owner) continue;
      const cell = a[ARRAY.BOMB_CELL][slot];
      const distance = Math.abs(state.x(cell) - state.x(target)) +
        Math.abs(state.y(cell) - state.y(target));
      if (distance <= RULE.BOMB_RANGE) {
        const remaining = Math.max(0, a[ARRAY.BOMB_EXPLODE][slot] - frame);
        value += Math.max(900, 4600 - remaining * 320 - distance * 400);
        this.bombPressureCount += 1;
      } else value -= 300;
    }
    return value;
  }

  attackGeometry(state, seat) {
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][seat];
    const enemy = a[ARRAY.TANK_CELL][seat ^ 1]; const direction = a[ARRAY.TANK_DIR][seat];
    if (isAhead(state, own, direction, enemy) && rayClear(state, own, enemy)) {
      this.directAimCount += 1;
      const distance = Math.abs(state.x(own) - state.x(enemy)) +
        Math.abs(state.y(own) - state.y(enemy));
      const shield = a[ARRAY.TANK_SHIELD_HITS][seat ^ 1] > 0 ? 1800 : 0;
      return (this.canFire(state, seat) ? 5600 : 2600) - distance * 180 - shield;
    }
    const dx = state.x(enemy) - state.x(own); const dy = state.y(enemy) - state.y(own);
    const desired = Math.abs(dx) >= Math.abs(dy) && dx ? (dx > 0 ? 1 : 3) :
      dy ? (dy > 0 ? 2 : 0) : -1;
    if (desired === direction) { this.attackSetupCount += 1; return 1100; }
    return 0;
  }

  evaluate(state) {
    this.callCount += 1; const a = state.arrays;
    let value = (a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1]) * 1000;
    const ownProjectile = this.projectileValue(state, 0);
    const enemyProjectile = this.projectileValue(state, 1);
    const ownBomb = this.bombValue(state, 0); const enemyBomb = this.bombValue(state, 1);
    value += ownProjectile - enemyProjectile + ownBomb - enemyBomb;
    value += this.attackValue(state);
    value += (this.mobility(state, 0) - this.mobility(state, 1)) * 220;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star !== NONE_CELL) {
      const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
      const ownDistance = Math.abs(state.x(own) - state.x(star)) +
        Math.abs(state.y(own) - state.y(star));
      const enemyDistance = Math.abs(state.x(enemy) - state.x(star)) +
        Math.abs(state.y(enemy) - state.y(star));
      value += (enemyDistance - ownDistance) * 90;
    }
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const ownStunRemaining = a[ARRAY.TANK_STUN_UNTIL][0] === NONE_FRAME ? 0 :
      Math.max(0, a[ARRAY.TANK_STUN_UNTIL][0] - frame);
    const enemyStunRemaining = a[ARRAY.TANK_STUN_UNTIL][1] === NONE_FRAME ? 0 :
      Math.max(0, a[ARRAY.TANK_STUN_UNTIL][1] - frame);
    if (this.stunStatusMode === "duration")
      value += enemyStunRemaining * 700 - ownStunRemaining * 900;
    else {
      if (ownStunRemaining) value -= 900;
      if (enemyStunRemaining) value += 700;
    }
    if (a[ARRAY.TANK_SHIELD_HITS][0]) value += a[ARRAY.TANK_SHIELD_HITS][0] * 350;
    if (a[ARRAY.TANK_SHIELD_HITS][1]) value -= a[ARRAY.TANK_SHIELD_HITS][1] * 350;
    if (frame + 16 >= RULE.FRAME_RECORD_LIMIT)
      value += (a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1]) * 350;
    const result = clamp(value, -25000, 25000);
    if (result !== value) this.clampCount += 1;
    return result;
  }

  attackValue(state) {
    return this.attackGeometry(state, 0) - this.attackGeometry(state, 1);
  }

  install(search) {
    const evaluator = this;
    search.heuristic = function(state) { return evaluator.evaluate(state); };
    return this;
  }

  summary() {
    return { callCount: this.callCount, stunStatusMode: this.stunStatusMode,
      projectileThreatCount: this.projectileThreatCount,
      projectileWasteCount: this.projectileWasteCount,
      directAimCount: this.directAimCount, attackSetupCount: this.attackSetupCount,
      bombPressureCount: this.bombPressureCount, clampCount: this.clampCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

// BP135 diagnostic-only causal leaf mask. FULL must remain bit-identical to
// NativeTacticalLeafEvaluatorPoc; other masks remove a semantic family without
// changing action generation, terminal values, Hard, chance, or maximin.
class NativeTacticalLeafAblationPoc extends NativeTacticalLeafEvaluatorPoc {
  constructor(enabledMask = LEAF_COMPONENT_ALL, options = {}) {
    super(options); this.enabledMask = enabledMask & LEAF_COMPONENT_ALL;
  }

  evaluate(state) {
    this.callCount += 1; const a = state.arrays; let value = 0;
    if (this.enabledMask & LEAF_COMPONENT.STAR) {
      value += (a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1]) * 1000;
      const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
      if (star !== NONE_CELL) {
        const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
        const ownDistance = Math.abs(state.x(own) - state.x(star)) +
          Math.abs(state.y(own) - state.y(star));
        const enemyDistance = Math.abs(state.x(enemy) - state.x(star)) +
          Math.abs(state.y(enemy) - state.y(star));
        value += (enemyDistance - ownDistance) * 90;
      }
      const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
      if (frame + 16 >= RULE.FRAME_RECORD_LIMIT)
        value += (a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1]) * 350;
    }
    if (this.enabledMask & LEAF_COMPONENT.ORDNANCE)
      value += this.projectileValue(state, 0) - this.projectileValue(state, 1) +
        this.bombValue(state, 0) - this.bombValue(state, 1);
    if (this.enabledMask & LEAF_COMPONENT.ATTACK) value += this.attackValue(state);
    if (this.enabledMask & LEAF_COMPONENT.MOBILITY)
      value += (this.mobility(state, 0) - this.mobility(state, 1)) * 220;
    if (this.enabledMask & LEAF_COMPONENT.STATUS) {
      const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
      const ownStunRemaining = a[ARRAY.TANK_STUN_UNTIL][0] === NONE_FRAME ? 0 :
        Math.max(0, a[ARRAY.TANK_STUN_UNTIL][0] - frame);
      const enemyStunRemaining = a[ARRAY.TANK_STUN_UNTIL][1] === NONE_FRAME ? 0 :
        Math.max(0, a[ARRAY.TANK_STUN_UNTIL][1] - frame);
      if (this.stunStatusMode === "duration")
        value += enemyStunRemaining * 700 - ownStunRemaining * 900;
      else {
        if (ownStunRemaining) value -= 900;
        if (enemyStunRemaining) value += 700;
      }
      if (a[ARRAY.TANK_SHIELD_HITS][0])
        value += a[ARRAY.TANK_SHIELD_HITS][0] * 350;
      if (a[ARRAY.TANK_SHIELD_HITS][1])
        value -= a[ARRAY.TANK_SHIELD_HITS][1] * 350;
    }
    const result = clamp(value, -25000, 25000);
    if (result !== value) this.clampCount += 1;
    return result;
  }

  summary() {
    return { ...super.summary(), semantics: "CAUSAL_LEAF_MASK",
      enabledMask: this.enabledMask };
  }
}

// Diagnostic-only lexicographic outcome view for policy-vs-policy search.
// ProductionDepthSearch accepts one integer utility, so the dimensions are
// encoded with fixed radices whose lower-order ranges cannot cross a
// higher-order boundary.  This is not a weighted score: for non-terminal
// leaves the order is committed projectile safety, attack execution, counter
// exposure, stars, then the existing tactical heuristic as a final tie-break.
class NativePolicyOutcomeLexicographicPoc {
  constructor() {
    this.callCount = 0; this.committedThreatCount = 0;
    this.projectileAttackCount = 0; this.aimSetupCount = 0;
    this.counterExposureCount = 0; this.hotAllocationCount = 0;
  }

  projectileThreat(state, owner) {
    const a = state.arrays; const target = a[ARRAY.TANK_CELL][owner ^ 1];
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot] ||
          a[ARRAY.PROJECTILE_OWNER][slot] !== owner) continue;
      const cell = a[ARRAY.PROJECTILE_CELL][slot];
      const direction = a[ARRAY.PROJECTILE_DIR][slot];
      if (isAhead(state, cell, direction, target) && rayClear(state, cell, target)) return 1;
    }
    return 0;
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

  aimedReady(state, seat) {
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][seat];
    const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
    return this.canFire(state, seat) &&
      isAhead(state, own, a[ARRAY.TANK_DIR][seat], enemy) &&
      rayClear(state, own, enemy) ? 1 : 0;
  }

  evaluate(state, baseValue) {
    this.callCount += 1; const a = state.arrays;
    const enemyCommitted = this.projectileThreat(state, 1);
    const ownProjectile = this.projectileThreat(state, 0);
    const ownAim = ownProjectile ? 0 : this.aimedReady(state, 0);
    const counterExposed = this.aimedReady(state, 1);
    if (enemyCommitted) this.committedThreatCount += 1;
    if (ownProjectile) this.projectileAttackCount += 1;
    else if (ownAim) this.aimSetupCount += 1;
    if (counterExposed) this.counterExposureCount += 1;

    const committedSafe = enemyCommitted ? 0 : 1;
    const attackStage = ownProjectile ? 2 : ownAim ? 1 : 0;
    const counterSafe = counterExposed ? 0 : 1;
    const starDelta = clamp(a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1], -4, 4);
    const residual = clamp(Math.trunc(baseValue / 512), -49, 49) + 49;
    return committedSafe * 5400 + attackStage * 1800 + counterSafe * 900 +
      (starDelta + 4) * 100 + residual - 5400;
  }

  install(search) {
    const evaluator = this; const heuristic = search.heuristic;
    search.heuristic = function(state) {
      return evaluator.evaluate(state, Reflect.apply(heuristic, this, [state]));
    };
    return this;
  }

  summary() {
    return { semantics: "LEXICOGRAPHIC_POLICY_OUTCOME",
      callCount: this.callCount, committedThreatCount: this.committedThreatCount,
      projectileAttackCount: this.projectileAttackCount,
      aimSetupCount: this.aimSetupCount,
      counterExposureCount: this.counterExposureCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

// Event-settled alternative to the fixed-depth outcome view.  It gives an
// emitted projectile kill credit only when the existing projectile timeline
// and reverse-viability kernel prove that the target has no legal escape
// before normative invalidation.  Multi-projectile and survival-skill cases
// fail closed to UNKNOWN.  It reads the search leaf but never mutates it.
class NativeProjectileSettlementLexicographicPoc {
  constructor() {
    this.timeline = new ProjectileAttackTimeline();
    this.reverse = new AttackReverseViability();
    this.callCount = 0; this.timelineCount = 0; this.noThreatCount = 0;
    this.surviveCount = 0; this.doomedCount = 0; this.unknownCount = 0;
    this.multiProjectileCount = 0; this.hotAllocationCount = 0;
  }

  active(state, array, seat) {
    const value = state.arrays[array][seat];
    return value !== NONE_FRAME && value > state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
  }

  survivalSpecial(state, seat, ticks) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.active(state, ARRAY.TANK_SHIELD_UNTIL, seat) ||
        this.active(state, ARRAY.TANK_BOOST_UNTIL, seat)) return 1;
    const frames = Math.max(1, Math.ceil(ticks / RULE.PROJECTILE_STEPS));
    const skill = a[ARRAY.TANK_SKILL][seat];
    return (skill === SKILL.SHIELD || skill === SKILL.TELEPORT ||
      skill === SKILL.BOOST) && a[ARRAY.TANK_SKILL_READY][seat] <= frame + frames ? 1 : 0;
  }

  classifyThreat(state, owner) {
    const a = state.arrays; const targetSeat = owner ^ 1;
    const target = a[ARRAY.TANK_CELL][targetSeat]; let slot = -1; let count = 0;
    for (let at = 0; at < CAPACITY.MAX_PROJECTILES; at += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][at] ||
          a[ARRAY.PROJECTILE_OWNER][at] !== owner) continue;
      const cell = a[ARRAY.PROJECTILE_CELL][at];
      const direction = a[ARRAY.PROJECTILE_DIR][at];
      if (!isAhead(state, cell, direction, target) || !rayClear(state, cell, target)) continue;
      slot = at; count += 1;
    }
    if (!count) { this.noThreatCount += 1; return SETTLEMENT.NONE; }
    if (count !== 1) {
      this.multiProjectileCount += 1; this.unknownCount += 1;
      return SETTLEMENT.UNKNOWN;
    }
    if (!this.timeline.build(state, a[ARRAY.PROJECTILE_CELL][slot],
      a[ARRAY.PROJECTILE_DIR][slot], 0)) {
      this.unknownCount += 1; return SETTLEMENT.UNKNOWN;
    }
    this.timelineCount += 1;
    const root = this.reverse.buildReverse(this.timeline);
    if (this.reverse.poseViable(root, target, a[ARRAY.TANK_DIR][targetSeat])) {
      this.surviveCount += 1; return SETTLEMENT.SURVIVES;
    }
    if (this.survivalSpecial(state, targetSeat, this.timeline.horizonTick)) {
      this.unknownCount += 1; return SETTLEMENT.UNKNOWN;
    }
    this.doomedCount += 1; return SETTLEMENT.DOOMED;
  }

  evaluate(state, baseValue) {
    this.callCount += 1; const a = state.arrays;
    const incoming = this.classifyThreat(state, 1);
    const outgoing = this.classifyThreat(state, 0);
    const safety = incoming === SETTLEMENT.NONE ? 2 :
      incoming === SETTLEMENT.DOOMED ? 0 : 1;
    const attack = outgoing === SETTLEMENT.DOOMED ? 2 :
      outgoing === SETTLEMENT.NONE ? 0 : 1;
    const counterSafe = incoming === SETTLEMENT.NONE ? 1 : 0;
    const starDelta = clamp(a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1], -4, 4);
    const residual = clamp(Math.trunc(baseValue / 512), -49, 49) + 49;
    return safety * 5400 + attack * 1800 + counterSafe * 900 +
      (starDelta + 4) * 100 + residual - 8100;
  }

  install(search) {
    const evaluator = this; const heuristic = search.heuristic;
    search.heuristic = function(state) {
      return evaluator.evaluate(state, Reflect.apply(heuristic, this, [state]));
    };
    return this;
  }

  summary() {
    return { semantics: "PROJECTILE_EVENT_SETTLEMENT",
      callCount: this.callCount, timelineCount: this.timelineCount,
      noThreatCount: this.noThreatCount, surviveCount: this.surviveCount,
      doomedCount: this.doomedCount, unknownCount: this.unknownCount,
      multiProjectileCount: this.multiProjectileCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

// Integer attack-arrival semantics for the non-terminal leaf. A posture only
// earns setup value after it creates a real open line; merely facing the
// dominant coordinate axis is not an attack plan.
class NativeTacticalRaceLeafEvaluatorPoc extends NativeTacticalLeafEvaluatorPoc {
  constructor() {
    super(); this.attackRaceWinCount = 0; this.attackRaceLossCount = 0;
    this.attackRaceTieCount = 0; this.openLineCount = 0;
    this.dodgeableLineCount = 0;
  }

  alignedDirection(state, from, target) {
    const fx = state.x(from); const fy = state.y(from);
    const tx = state.x(target); const ty = state.y(target);
    if (!rayClear(state, from, target)) return -1;
    if (fx === tx) return ty < fy ? 0 : 2;
    if (fy === ty) return tx > fx ? 1 : 3;
    return -1;
  }

  turns(from, to) {
    const delta = Math.abs(from - to); return Math.min(delta, 4 - delta);
  }

  arrival(state, seat, wanted, distance) {
    if (wanted < 0 || !this.canFire(state, seat) ||
        state.arrays[ARRAY.TANK_SHIELD_HITS][seat ^ 1] > 0) return 99;
    const direction = state.arrays[ARRAY.TANK_DIR][seat];
    const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const boosted = state.arrays[ARRAY.TANK_BOOST_UNTIL][seat] !== NONE_FRAME &&
      state.arrays[ARRAY.TANK_BOOST_UNTIL][seat] > frame;
    const turnFrames = boosted ? Math.max(0, this.turns(direction, wanted) - 1) :
      this.turns(direction, wanted);
    return turnFrames + ((distance + 1) >> 1);
  }

  canLeaveBulletAxis(state, seat, bulletDirection, direction) {
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][seat];
    const other = a[ARRAY.TANK_CELL][seat ^ 1]; const x = state.x(cell);
    const y = state.y(cell); const nx = x + (direction === 1 ? 1 :
      direction === 3 ? -1 : 0); const ny = y + (direction === 2 ? 1 :
      direction === 0 ? -1 : 0);
    if (nx < 0 || nx >= state.width || ny < 0 || ny >= state.height) return 0;
    const next = state.cell(nx, ny); const tile = a[ARRAY.TERRAIN][next];
    if (next === other || tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
    return bulletDirection === 0 || bulletDirection === 2 ? nx !== x : ny !== y;
  }

  minimumEscape(state, seat, bulletDirection) {
    const direction = state.arrays[ARRAY.TANK_DIR][seat];
    if (this.canLeaveBulletAxis(state, seat, bulletDirection, direction)) return 1;
    if (this.canLeaveBulletAxis(state, seat, bulletDirection,
      (direction + 3) & 3) || this.canLeaveBulletAxis(state, seat,
      bulletDirection, (direction + 1) & 3)) return 2;
    return 99;
  }

  lineValue(state, target, wanted, distance) {
    const frames = (distance + 1) >> 1;
    const dodge = this.minimumEscape(state, target, wanted) <= frames;
    if (dodge) this.dodgeableLineCount += 1;
    if (frames === 1) return dodge ? 900 : 30000;
    let value = Math.max(70, 360 - (frames - 1) * 65);
    if (dodge) value = Math.trunc(value * 2 / 5);
    return value;
  }

  muzzleRisk(state, shooter, target, wanted, distance) {
    if (wanted < 0 || !this.canFire(state, shooter)) return 0;
    const direction = state.arrays[ARRAY.TANK_DIR][shooter];
    const turnCount = this.turns(direction, wanted);
    if (turnCount === 0 && distance <= 2)
      return this.minimumEscape(state, target, wanted) <= 1 ? 1200 : 50000;
    if (turnCount === 0 && distance <= 4) {
      const frames = (distance + 1) >> 1;
      const escape = this.minimumEscape(state, target, wanted) <= frames;
      return distance === 3 ? escape ? 4000 : 22000 : escape ? 1800 : 10000;
    }
    if (distance === 1) return 1200;
    if (distance <= 3) return distance === 2 ? 650 : 400;
    return 0;
  }

  attackValue(state) {
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1];
    const distance = Math.abs(state.x(own) - state.x(enemy)) +
      Math.abs(state.y(own) - state.y(enemy));
    const ownWanted = this.alignedDirection(state, own, enemy);
    const enemyWanted = this.alignedDirection(state, enemy, own);
    if (ownWanted >= 0) this.openLineCount += 1;
    let value = Math.trunc(this.muzzleRisk(state, 0, 1, ownWanted, distance) * 3 / 4) -
      this.muzzleRisk(state, 1, 0, enemyWanted, distance);
    if (ownWanted >= 0 && a[ARRAY.TANK_DIR][0] === ownWanted)
      value += this.lineValue(state, 1, ownWanted, distance);
    if (enemyWanted >= 0 && a[ARRAY.TANK_DIR][1] === enemyWanted)
      value -= this.lineValue(state, 0, enemyWanted, distance);
    const mine = this.arrival(state, 0, ownWanted, distance);
    const theirs = this.arrival(state, 1, enemyWanted, distance);
    if (mine < theirs && mine <= 4) {
      value += Math.trunc(16000 / mine); this.attackRaceWinCount += 1;
    } else if (theirs < mine && theirs <= 4) {
      value -= Math.trunc(22000 / theirs); this.attackRaceLossCount += 1;
    } else if (mine === theirs && mine <= 2) {
      value -= 2500; this.attackRaceTieCount += 1;
    }
    return value;
  }

  summary() {
    return { ...super.summary(), semantics: "INTEGER_ATTACK_RACE",
      attackRaceWinCount: this.attackRaceWinCount,
      attackRaceLossCount: this.attackRaceLossCount,
      attackRaceTieCount: this.attackRaceTieCount,
      openLineCount: this.openLineCount, dodgeableLineCount: this.dodgeableLineCount };
  }
}

class NativeTacticalRepresentativePoc {
  constructor(options = {}) {
    this.generateCount = 0; this.contactCount = 0;
    this.attackTargetOverrideCount = 0; this.hotAllocationCount = 0;
    this.ownOnly = options.ownOnly === true;
    this.enemyStrategicPreserveCount = 0;
  }

  install(search) {
    const diagnostic = this; const generate = search.generateDeep;
    search.generateDeep = function(top, state, seat) {
      diagnostic.generateCount += 1;
      if (diagnostic.ownOnly && seat !== 0) {
        diagnostic.enemyStrategicPreserveCount += 1;
        return Reflect.apply(generate, this, [top, state, seat]);
      }
      const a = state.arrays; const own = a[ARRAY.TANK_CELL][seat];
      const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
      const distance = Math.abs(state.x(own) - state.x(enemy)) +
        Math.abs(state.y(own) - state.y(enemy));
      const contact = distance <= 6 || rayClear(state, own, enemy);
      const scalar = a[ARRAY.SCALAR]; const star = scalar[SCALAR.STAR_CELL];
      if (!contact || star === NONE_CELL) return Reflect.apply(generate, this,
        [top, state, seat]);
      // generateDeep is read-only. Hide the strategic target for exactly this
      // call so its existing ordering emits enemy-contact representatives.
      // Restore the scalar before any transition/cache operation observes it.
      diagnostic.contactCount += 1; diagnostic.attackTargetOverrideCount += 1;
      scalar[SCALAR.STAR_CELL] = NONE_CELL;
      try { return Reflect.apply(generate, this, [top, state, seat]); }
      finally { scalar[SCALAR.STAR_CELL] = star; }
    };
    return this;
  }

  summary() {
    return { generateCount: this.generateCount, contactCount: this.contactCount,
      attackTargetOverrideCount: this.attackTargetOverrideCount,
      ownOnly: this.ownOnly,
      enemyStrategicPreserveCount: this.enemyStrategicPreserveCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

class NativeTacticalIntentPoc {
  constructor(margin = 150, options = {}) {
    this.margin = margin | 0;
    this.rowBonus = new Int16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowMember = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.committed = TACTICAL_INTENT.NONE; this.target = NONE_CELL;
    this.lastContextSignature = -1; this.contextChangeCount = 0;
    this.prepareCount = 0; this.attackCount = 0; this.starCount = 0;
    this.edgeCount = 0; this.faceCount = 0; this.evadeCount = 0;
    this.continuityCount = 0; this.switchCount = 0; this.bonusRowCount = 0;
    this.hotAllocationCount = 0;
    this.oracleMode = options.oracleMode === "intent" ? "intent" :
      options.oracleMode === true || options.oracleMode === "action" ?
        "action" : "off";
    this.oracleAction = ACTION.NONE; this.oracleReady = 0;
    this.oracleIntent = TACTICAL_INTENT.NONE;
    this.oracleSelectedIntent = TACTICAL_INTENT.NONE;
    this.oracleContextEpoch = 0;
    this.oracleContextSignature = null;
    this.contextMismatchSamples = [];
    this.oracleContextCompareCount = 0;
    this.oracleContextAgreementCount = 0;
    this.oraclePrepareCount = 0; this.oracleMissingRowCount = 0;
    this.mappingMode = options.mappingMode === "v1-action" ? "v1-action" :
      options.mappingMode === "single-quality" ? "single-quality" : "frontier";
    this.continuityMode = options.continuityMode === "v1-epoch" ? "v1-epoch" :
      options.continuityMode === "off" ? "off" : "context";
    this.classificationMode = options.classificationMode === "v1-exact" ?
      "v1-exact" : "simple";
    // Fixed scratch for the deployable V1-shaped intent -> action mapping.
    // V1 allocates these arrays inside its attack-lane BFS; the native form
    // owns one copy for the whole controller and performs no hot allocation.
    this.pathDistance = new Uint16Array(CAPACITY.MAX_CELLS);
    this.pathQueue = new Uint16Array(CAPACITY.MAX_CELLS);
    this.pathFirst = new Uint16Array(CAPACITY.MAX_CELLS);
    this.mappingActionCount = 0; this.mappingMissingRowCount = 0;
    this.mappingOracleCompareCount = 0; this.mappingOracleAgreementCount = 0;
    this.proposedOracleCompareCount = 0; this.proposedOracleAgreementCount = 0;
    this.committedOracleCompareCount = 0; this.committedOracleAgreementCount = 0;
    this.oracleProposedIntent = TACTICAL_INTENT.NONE;
    this.proposedOraclePairs = new Uint32Array(36);
    this.committedOraclePairs = new Uint32Array(36);
    this.mappingOraclePairs = new Uint32Array(
      (ACTION.BOOST_RIGHT_BOMB + 1) * (ACTION.BOOST_RIGHT_BOMB + 1));
    this.mappingIntentOraclePairs = new Uint32Array(6 *
      (ACTION.BOOST_RIGHT_BOMB + 1) * (ACTION.BOOST_RIGHT_BOMB + 1));
    this.contextEpoch = 0; this.lastIntent = TACTICAL_INTENT.NONE;
    this.lastIntentEpoch = -1; this.currentProposed = TACTICAL_INTENT.NONE;
    this.currentCommitted = TACTICAL_INTENT.NONE;
    this.currentCommittedAction = ACTION.NONE;
  }

  intentCode(intent) {
    return intent === "ATTACK" ? TACTICAL_INTENT.ATTACK :
      intent === "CHASE_STAR" ? TACTICAL_INTENT.CHASE_STAR :
      intent === "EXIT_EDGE" ? TACTICAL_INTENT.EXIT_EDGE :
      intent === "FACE_ENEMY" ? TACTICAL_INTENT.FACE_ENEMY :
      intent === "EVADE" ? TACTICAL_INTENT.EVADE : TACTICAL_INTENT.NONE;
  }

  setOracle(intent, action, proposedIntent, selectedIntent, contextEpoch,
      contextSignature = null) {
    this.oracleAction = action | 0;
    this.oracleIntent = this.intentCode(intent);
    this.oracleProposedIntent = this.intentCode(proposedIntent);
    this.oracleSelectedIntent = this.intentCode(selectedIntent);
    this.oracleContextEpoch = contextEpoch | 0;
    this.oracleContextSignature = typeof contextSignature === "string" ?
      contextSignature : null;
    this.oracleReady = 1;
  }

  clearOracle() { this.oracleReady = 0; }

  contextSignature(engine) {
    const a = engine.adapter.state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    let ownProjectile = 0; let enemyProjectile = 0; let bombs = 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot]) continue;
      if (a[ARRAY.PROJECTILE_OWNER][slot] === 0) ownProjectile = 1;
      else enemyProjectile = 1;
    }
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot]) bombs += 1;
    let signature = mix32(0x51ed270b, a[ARRAY.SCALAR][SCALAR.STAR_CELL]);
    signature = mix32(signature, engine.adapter.enemyVisible ? 1 : 0);
    signature = mix32(signature, ownProjectile | enemyProjectile << 1);
    const stunUntil = a[ARRAY.TANK_STUN_UNTIL][1];
    signature = mix32(signature,
      stunUntil !== NONE_FRAME && stunUntil > frame ? 1 : 0);
    signature = mix32(signature, bombs);
    return mix32(signature, a[ARRAY.TANK_SKILL][1]);
  }

  diagnosticContextSignature(engine) {
    const state = engine.adapter.state; const a = state.arrays;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const starKey = star === NONE_CELL ? -1 : state.x(star) * 64 + state.y(star);
    let ownProjectile = 0; let enemyProjectile = 0; let bombs = 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot]) continue;
      if (a[ARRAY.PROJECTILE_OWNER][slot] === 0) ownProjectile = 1;
      else enemyProjectile = 1;
    }
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot]) bombs += 1;
    const skillName = ["none", "shield", "freeze", "stun", "overload",
      "cloak", "poison", "teleport", "boost"][a[ARRAY.TANK_SKILL][1]] || "none";
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const stunUntil = a[ARRAY.TANK_STUN_UNTIL][1];
    return `${starKey}|${engine.adapter.enemyVisible ? 1 : 0}|${ownProjectile}|${
      enemyProjectile}|${stunUntil !== NONE_FRAME && stunUntil > frame ? 1 : 0}|${
      bombs}|${skillName}|0`;
  }

  observeContext(engine) {
    const signature = this.contextSignature(engine);
    if (this.lastContextSignature >= 0 && signature !== this.lastContextSignature) {
      this.contextEpoch += 1; this.contextChangeCount += 1;
      if (this.continuityMode === "context") {
        this.committed = TACTICAL_INTENT.NONE; this.target = NONE_CELL;
      }
    }
    this.lastContextSignature = signature;
  }

  commitSelection(action) {
    if (this.continuityMode !== "v1-epoch") return;
    this.lastIntent = action === this.currentCommittedAction ?
      this.currentCommitted : this.currentProposed;
    this.lastIntentEpoch = this.contextEpoch;
  }

  // Shadow mode must advance the persistent state of the controller that
  // actually owns the action. Otherwise the following root is no longer a
  // same-state comparison: it contains the native counterfactual intent.
  commitOracleSelection() {
    if (this.continuityMode !== "v1-epoch" ||
        this.oracleSelectedIntent === TACTICAL_INTENT.NONE) return;
    this.lastIntent = this.oracleSelectedIntent;
    this.lastIntentEpoch = this.contextEpoch;
  }

  // Rebase the next Shadow root onto the oracle's post-action persistent
  // state.  The current root is compared before this synchronization, so a
  // context transition mismatch remains visible instead of cascading through
  // every later frame in the match.
  syncOracleRuntime(engine, intent, lastIntentEpoch, contextEpoch) {
    if (this.continuityMode !== "v1-epoch") return;
    this.lastIntent = this.intentCode(intent);
    this.lastIntentEpoch = lastIntentEpoch | 0;
    this.contextEpoch = contextEpoch | 0;
    // V1 observes context on every callback, including callbacks that return
    // before tactical search. The differential prepares only tactical roots.
    // Rebase the signature too, otherwise the next tactical root counts a
    // transition that V1 already consumed on an intervening callback.
    if (engine?.adapter?.state)
      this.lastContextSignature = this.contextSignature(engine);
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

  activeEffect(a, id, seat, frame) {
    return a[id][seat] !== NONE_FRAME && a[id][seat] > frame ? 1 : 0;
  }

  advance(state, cell, direction, speed) {
    let current = cell;
    for (let step = 0; step < speed; step += 1) {
      const next = this.adjacent(state, current, direction);
      if (!this.walkable(state, next)) break;
      current = next;
    }
    return current;
  }

  minimumProjectileEscapeActions(state, cell, direction, speed, bulletDirection) {
    const sameAxis = candidate => bulletDirection === 0 || bulletDirection === 2 ?
      state.x(cell) === state.x(candidate) : state.y(cell) === state.y(candidate);
    const forward = this.advance(state, cell, direction, speed);
    if (forward !== cell && !sameAxis(forward)) return 1;
    const left = this.advance(state, cell, (direction + 3) & 3, speed);
    const right = this.advance(state, cell, (direction + 1) & 3, speed);
    if ((left !== cell && !sameAxis(left)) || (right !== cell && !sameAxis(right)))
      return 2;
    return 99;
  }

  quarterTurns(from, to) {
    const difference = Math.abs(from - to); return Math.min(difference, 4 - difference);
  }

  attackArrivalFrames(engine, state, seat, target, wanted, lineOpen, distance) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const targetSeat = seat ^ 1;
    const shielded = this.activeEffect(a, ARRAY.TANK_SHIELD_UNTIL,
      targetSeat, frame) && a[ARRAY.TANK_SHIELD_HITS][targetSeat] > 0;
    if (!this.canFire(state, seat) || shielded || wanted < 0 || !lineOpen) return 99;
    const turns = this.quarterTurns(a[ARRAY.TANK_DIR][seat], wanted);
    const boosted = this.activeEffect(a, ARRAY.TANK_BOOST_UNTIL, seat, frame);
    return Math.max(0, turns - boosted) + ((distance + 1) >> 1);
  }

  directAttackAction(engine) {
    if (!engine?.adapter?.enemyVisible) return ACTION.NONE;
    const state = engine.adapter.state; const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    if (!this.canFire(state, 0) ||
        this.activeEffect(a, ARRAY.TANK_SHIELD_UNTIL, 1, frame) &&
          a[ARRAY.TANK_SHIELD_HITS][1] > 0) return ACTION.NONE;
    const distance = engine.manhattan(own, enemy);
    if (distance > 6) return ACTION.NONE;
    const wanted = engine.directionTo(own, enemy);
    const lineOpen = wanted >= 0 && engine.clearLine(own, enemy);
    if (!lineOpen) return ACTION.NONE;
    let enemyProjectile = 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === 1) {
        enemyProjectile = 1; break;
      }
    const enemyCanFire = !enemyProjectile && this.canFire(state, 1);
    const theirs = engine.directionTo(enemy, own);
    const myFrames = this.attackArrivalFrames(engine, state, 0, enemy,
      wanted, lineOpen, distance);
    const enemyFrames = this.attackArrivalFrames(engine, state, 1, own,
      theirs, lineOpen, distance);
    const favorableTrade = myFrames === enemyFrames &&
      a[ARRAY.TANK_STARS][0] > a[ARRAY.TANK_STARS][1];
    if (myFrames >= 99 || myFrames > enemyFrames ||
        myFrames === enemyFrames && !favorableTrade) return ACTION.NONE;
    const current = a[ARRAY.TANK_DIR][0];
    if (wanted === current) return ACTION.FIRE;
    return wanted === ((current + 3) & 3) ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
  }

  firesAt(engine, shooter, direction, target) {
    return engine.directionTo(shooter, target) === direction &&
      engine.clearLine(shooter, target) ? 1 : 0;
  }

  preemptiveSafetyAction(engine) {
    this.preemptiveEscapeDirection = -1;
    if (!engine?.adapter?.enemyVisible) return ACTION.NONE;
    const state = engine.adapter.state; const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (!this.canFire(state, 1)) return ACTION.NONE;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const enemyDirection = a[ARRAY.TANK_DIR][1];
    if (!this.firesAt(engine, enemy, enemyDirection, own)) return ACTION.NONE;
    const distance = engine.manhattan(enemy, own);
    if (distance > 10) return ACTION.NONE;
    if (distance > 4 && a[ARRAY.TANK_STARS][0] <= a[ARRAY.TANK_STARS][1] &&
        this.outerEdgeDistance(state, own) > 2) return ACTION.NONE;
    const ownDirection = a[ARRAY.TANK_DIR][0];
    const speed = this.activeEffect(a, ARRAY.TANK_BOOST_UNTIL, 0, frame) ? 2 : 1;
    const forward = this.advance(state, own, ownDirection, speed);
    if (forward !== own && forward !== enemy &&
        !this.firesAt(engine, enemy, enemyDirection, forward)) return ACTION.GO;
    if (distance < 3) return ACTION.NONE;
    const left = (ownDirection + 3) & 3;
    const leftEscape = this.advance(state, own, left, speed);
    if (leftEscape !== own && leftEscape !== enemy &&
        !this.firesAt(engine, enemy, enemyDirection, leftEscape)) {
      this.preemptiveEscapeDirection = left; return ACTION.TURN_LEFT;
    }
    const right = (ownDirection + 1) & 3;
    const rightEscape = this.advance(state, own, right, speed);
    if (rightEscape !== own && rightEscape !== enemy &&
        !this.firesAt(engine, enemy, enemyDirection, rightEscape)) {
      this.preemptiveEscapeDirection = right; return ACTION.TURN_RIGHT;
    }
    return ACTION.NONE;
  }

  commitDirectAttack(action) {
    this.currentProposed = TACTICAL_INTENT.ATTACK;
    this.currentCommitted = TACTICAL_INTENT.ATTACK;
    this.currentCommittedAction = action;
    this.committed = TACTICAL_INTENT.ATTACK;
    this.target = NONE_CELL;
    this.attackCount += 1;
    this.commitSelection(action);
  }

  singleMuzzleRisk(engine, state, shooter, shooterDirection, target,
      canFire, boosted, targetDirection, targetSpeed) {
    if (!canFire || shooter === NONE_CELL) return 0;
    const distance = engine.manhattan(shooter, target);
    const wanted = engine.directionTo(shooter, target);
    const lineOpen = wanted >= 0 && engine.clearLine(shooter, target);
    if (wanted >= 0 && lineOpen) {
      const turns = this.quarterTurns(shooterDirection, wanted);
      if (turns === 0 && distance <= 2) {
        return this.minimumProjectileEscapeActions(state, target,
          targetDirection, targetSpeed, shooterDirection) <= 1 ? 1200 : 50000;
      }
      if (turns === 0 && distance <= 4) {
        const impactFrames = (distance + 1) >> 1;
        const escape = this.minimumProjectileEscapeActions(state, target,
          targetDirection, targetSpeed, shooterDirection) <= impactFrames;
        if (distance === 3) return escape ? 4000 : 22000;
        return escape ? 1800 : 10000;
      }
      if (boosted && turns === 1 && distance <= 2) return 35000;
      if (distance === 1) return 1200;
    }
    if (distance <= 2) return 650;
    if (distance === 3) return 400;
    return 0;
  }

  muzzleRisk(engine, state, shooter, shooterDirection, target, canFire,
      boosted, targetDirection, targetSpeed, overloaded) {
    let risk = this.singleMuzzleRisk(engine, state, shooter, shooterDirection,
      target, canFire, boosted, targetDirection, targetSpeed);
    if (!overloaded || !canFire) return risk;
    const horizontal = shooterDirection === 1 || shooterDirection === 3;
    const x = state.x(shooter) + (horizontal ? 0 : 1);
    const y = state.y(shooter) + (horizontal ? 1 : 0);
    const secondary = x < 0 || x >= state.width || y < 0 || y >= state.height ?
      NONE_CELL : state.cell(x, y);
    return Math.max(risk, this.singleMuzzleRisk(engine, state, secondary,
      shooterDirection, target, canFire, boosted, targetDirection, targetSpeed));
  }

  projectileThreat(engine, state, slot, target, targetDirection, targetSpeed) {
    const a = state.arrays; const projectile = a[ARRAY.PROJECTILE_CELL][slot];
    const direction = a[ARRAY.PROJECTILE_DIR][slot];
    if (engine.directionTo(projectile, target) !== direction ||
        !engine.clearLine(projectile, target)) return 0;
    const frames = (engine.manhattan(projectile, target) + 1) >> 1;
    const needed = this.minimumProjectileEscapeActions(state, target,
      targetDirection, targetSpeed, direction);
    if (needed > frames) return 50000;
    const slack = frames - needed;
    if (slack === 0) return 35000;
    if (slack === 1) return 10000;
    const value = Math.max(80, 420 - (frames - 1) * 75);
    return needed < 99 ? Math.trunc(value * 35 / 100) : value;
  }

  turns(from, to) {
    const delta = Math.abs(from - to); return Math.min(delta, 4 - delta);
  }

  actionPriority(action) {
    if (action === ACTION.GO) return 5;
    if (action === ACTION.FIRE) return 4;
    if (action === ACTION.CAST_STUN || action === ACTION.THROW_BOMB) return 3;
    if (action === ACTION.TURN_LEFT) return 2;
    if (action === ACTION.TURN_RIGHT) return 1;
    return 0;
  }

  walkable(state, cell) {
    if (cell === NONE_CELL || cell >= state.cells) return 0;
    const tile = state.arrays[ARRAY.TERRAIN][cell];
    return tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT ? 1 : 0;
  }

  adjacent(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ?
      NONE_CELL : state.cell(x, y);
  }

  outerEdgeDistance(state, cell) {
    const x = state.x(cell); const y = state.y(cell);
    return Math.max(0, Math.min(x - 1, state.width - 2 - x,
      y - 1, state.height - 2 - y));
  }

  openNeighborCount(state, cell) {
    let count = 0;
    for (let direction = 0; direction < 4; direction += 1)
      if (this.walkable(state, this.adjacent(state, cell, direction))) count += 1;
    return count;
  }

  fillDistanceField(state, goal) {
    this.pathDistance.fill(PATH_UNREACHABLE, 0, state.cells);
    if (!this.walkable(state, goal)) return 0;
    let head = 0; let tail = 1; this.pathQueue[0] = goal;
    this.pathDistance[goal] = 0;
    while (head < tail) {
      const cell = this.pathQueue[head++];
      const nextDistance = this.pathDistance[cell] + 1;
      for (let direction = 0; direction < 4; direction += 1) {
        const next = this.adjacent(state, cell, direction);
        if (!this.walkable(state, next) ||
            this.pathDistance[next] !== PATH_UNREACHABLE) continue;
        this.pathDistance[next] = nextDistance; this.pathQueue[tail++] = next;
      }
    }
    return tail;
  }

  nextStarStep(state, start, star, blocked) {
    if (!this.fillDistanceField(state, star)) return NONE_CELL;
    let best = NONE_CELL; let bestDistance = this.pathDistance[start];
    if (bestDistance === PATH_UNREACHABLE) bestDistance = 99;
    for (let direction = 0; direction < 4; direction += 1) {
      const next = this.adjacent(state, start, direction);
      if (next === blocked || !this.walkable(state, next)) continue;
      const distance = this.pathDistance[next] === PATH_UNREACHABLE ?
        99 : this.pathDistance[next];
      if (distance < bestDistance) { bestDistance = distance; best = next; }
    }
    return best;
  }

  nextAttackLaneStep(engine, state, start, enemy) {
    this.pathDistance.fill(PATH_UNREACHABLE, 0, state.cells);
    if (!this.walkable(state, start)) return NONE_CELL;
    let head = 0; let tail = 1; this.pathQueue[0] = start;
    this.pathFirst[0] = start; this.pathDistance[start] = 0;
    while (head < tail) {
      const cell = this.pathQueue[head]; const first = this.pathFirst[head++];
      if (cell !== start && engine.clearLine(cell, enemy)) return first;
      for (let direction = 0; direction < 4; direction += 1) {
        const next = this.adjacent(state, cell, direction);
        if (next === enemy || !this.walkable(state, next) ||
            this.pathDistance[next] !== PATH_UNREACHABLE) continue;
        this.pathDistance[next] = this.pathDistance[cell] + 1;
        this.pathQueue[tail] = next;
        this.pathFirst[tail] = first === start ? next : first; tail += 1;
      }
    }
    return NONE_CELL;
  }

  actionForStep(state, start, direction, step) {
    const sx = state.x(start); const sy = state.y(start);
    const tx = state.x(step); const ty = state.y(step);
    const wanted = tx > sx ? 1 : tx < sx ? 3 : ty > sy ? 2 : 0;
    if (wanted === direction) return ACTION.GO;
    return wanted === ((direction + 3) & 3) ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
  }

  v1ActionForIntent(engine, intent) {
    if (intent === TACTICAL_INTENT.NONE || intent === TACTICAL_INTENT.EVADE)
      return ACTION.NONE;
    const state = engine.adapter.state; const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const direction = a[ARRAY.TANK_DIR][0]; let step = NONE_CELL; let wanted = -1;
    if (intent === TACTICAL_INTENT.CHASE_STAR) {
      const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
      if (star !== NONE_CELL) step = this.nextStarStep(state, own, star, enemy);
    } else if (intent === TACTICAL_INTENT.EXIT_EDGE) {
      let bestEdge = this.outerEdgeDistance(state, own); let bestOpen = -1;
      for (let candidateDirection = 0; candidateDirection < 4;
          candidateDirection += 1) {
        const candidate = this.adjacent(state, own, candidateDirection);
        if (candidate === enemy || !this.walkable(state, candidate)) continue;
        const edge = this.outerEdgeDistance(state, candidate);
        const open = this.openNeighborCount(state, candidate);
        if (edge > bestEdge || (edge === bestEdge && open > bestOpen)) {
          bestEdge = edge; bestOpen = open; step = candidate;
        }
      }
    } else if (intent === TACTICAL_INTENT.ATTACK ||
        intent === TACTICAL_INTENT.FACE_ENEMY) {
      wanted = engine.directionTo(own, enemy);
      if (wanted < 0) step = this.nextAttackLaneStep(engine, state, own, enemy);
    }
    if (step !== NONE_CELL) return this.actionForStep(state, own, direction, step);
    if (wanted < 0) return ACTION.NONE;
    if (wanted === direction)
      return intent === TACTICAL_INTENT.ATTACK && this.canFire(state, 0) ?
        ACTION.FIRE : ACTION.GO;
    return wanted === ((direction + 3) & 3) ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
  }

  proposedSimple(engine) {
    const state = engine.adapter.state; const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const distance = engine.manhattan(own, enemy);
    const mine = engine.directionTo(own, enemy); const theirs = engine.directionTo(enemy, own);
    const line = mine >= 0 && engine.clearLine(own, enemy);
    const ownArrival = line && this.canFire(state, 0) ?
      this.turns(a[ARRAY.TANK_DIR][0], mine) + ((distance + 1) >> 1) : 99;
    const enemyArrival = line && this.canFire(state, 1) ?
      this.turns(a[ARRAY.TANK_DIR][1], theirs) + ((distance + 1) >> 1) : 99;
    if (enemyArrival <= 2 && enemyArrival < ownArrival) return TACTICAL_INTENT.EVADE;
    if (ownArrival < enemyArrival && ownArrival <= 3) return TACTICAL_INTENT.ATTACK;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star !== NONE_CELL) return TACTICAL_INTENT.CHASE_STAR;
    const x = state.x(own); const y = state.y(own);
    const edge = Math.min(x, y, state.width - 1 - x, state.height - 1 - y);
    return edge <= 2 ? TACTICAL_INTENT.EXIT_EDGE : TACTICAL_INTENT.FACE_ENEMY;
  }

  proposedV1Exact(engine) {
    const state = engine.adapter.state; const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const ownDirection = a[ARRAY.TANK_DIR][0];
    const enemyDirection = a[ARRAY.TANK_DIR][1];
    const ownSpeed = this.activeEffect(a, ARRAY.TANK_BOOST_UNTIL, 0, frame) ? 2 : 1;
    const enemyBoosted = this.activeEffect(a, ARRAY.TANK_BOOST_UNTIL, 1, frame);
    let incoming = 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === 1)
        incoming += this.projectileThreat(engine, state, slot, own,
          ownDirection, ownSpeed);
    const enemyCanFire = this.canFire(state, 1);
    const enemyOverloaded = this.activeEffect(a, ARRAY.TANK_OVERLOAD_UNTIL, 1, frame);
    const muzzle = this.muzzleRisk(engine, state, enemy, enemyDirection, own,
      enemyCanFire, enemyBoosted, ownDirection, ownSpeed, enemyOverloaded);
    if (incoming >= 1200 || muzzle >= 10000) return TACTICAL_INTENT.EVADE;
    const distance = engine.manhattan(own, enemy);
    const mine = engine.directionTo(own, enemy); const theirs = engine.directionTo(enemy, own);
    const line = mine >= 0 && engine.clearLine(own, enemy);
    const myFrames = this.attackArrivalFrames(engine, state, 0, enemy,
      mine, line, distance);
    const enemyFrames = this.attackArrivalFrames(engine, state, 1, own,
      theirs, line, distance);
    if (myFrames < enemyFrames && myFrames <= 3) return TACTICAL_INTENT.ATTACK;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const edge = this.outerEdgeDistance(state, own);
    if (edge <= 1 && star === NONE_CELL) return TACTICAL_INTENT.EXIT_EDGE;
    if (star !== NONE_CELL) return TACTICAL_INTENT.CHASE_STAR;
    return edge <= 2 ? TACTICAL_INTENT.EXIT_EDGE : TACTICAL_INTENT.FACE_ENEMY;
  }

  proposed(engine) {
    return this.classificationMode === "v1-exact" ?
      this.proposedV1Exact(engine) : this.proposedSimple(engine);
  }

  quality(engine, row, intent) {
    const state = engine.adapter.state; const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const cell = engine.projectedCell[row]; const direction = engine.projectedDirection[row];
    const action = engine.ourActions[row];
    if (intent === TACTICAL_INTENT.ATTACK) {
      const hit = engine.directHitWindow(action, cell, direction);
      if (hit > 0) return 30000 + hit;
      const wanted = engine.directionTo(cell, enemy);
      if (wanted >= 0 && engine.clearLine(cell, enemy))
        return wanted === direction ? 20000 : 10000 - this.turns(direction, wanted) * 1000;
      return 0;
    }
    if (intent === TACTICAL_INTENT.CHASE_STAR) {
      const progress = engine.starDistance(own) - engine.starDistance(cell);
      if (progress > 0) return 20000 + progress * 1000;
      return engine.starDirectionHelpful(cell, direction) ? 9000 : 0;
    }
    if (intent === TACTICAL_INTENT.EXIT_EDGE) {
      const x = state.x(cell); const y = state.y(cell);
      return Math.min(x, y, state.width - 1 - x, state.height - 1 - y) * 1000;
    }
    if (intent === TACTICAL_INTENT.FACE_ENEMY) {
      const wanted = engine.directionTo(cell, enemy);
      if (wanted >= 0 && engine.clearLine(cell, enemy))
        return wanted === direction ? 12000 : 8000 - this.turns(direction, wanted) * 1000;
      const dx = state.x(enemy) - state.x(cell); const dy = state.y(enemy) - state.y(cell);
      const axis = Math.abs(dx) >= Math.abs(dy) && dx ? (dx > 0 ? 1 : 3) :
        dy ? (dy > 0 ? 2 : 0) : direction;
      return direction === axis ? 3000 : 0;
    }
    return 0;
  }

  prepare(engine, count) {
    this.prepareCount += 1; this.rowBonus.fill(0, 0, count);
    this.rowMember.fill(0, 0, count);
    if (this.oracleMode === "action" && this.oracleReady) {
      this.oracleReady = 0; this.oraclePrepareCount += 1; let found = 0;
      for (let row = 0; row < count; row += 1)
        if (engine.ourActions[row] === this.oracleAction) {
          this.rowBonus[row] = this.margin; this.rowMember[row] = 1;
          this.bonusRowCount += 1; found = 1;
        }
      if (!found && this.oracleAction !== ACTION.NONE)
        this.oracleMissingRowCount += 1;
      return;
    }
    const star = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL];
    let intent; let proposed = TACTICAL_INTENT.NONE;
    if (this.oracleMode === "intent" && this.oracleReady) {
      this.oracleReady = 0; this.oraclePrepareCount += 1;
      intent = this.oracleIntent;
    } else {
      this.observeContext(engine);
      proposed = this.proposed(engine);
      intent = proposed;
      if (this.continuityMode === "v1-epoch" &&
          proposed !== TACTICAL_INTENT.ATTACK && proposed !== TACTICAL_INTENT.EVADE &&
          this.lastIntent !== TACTICAL_INTENT.NONE &&
          this.lastIntentEpoch === this.contextEpoch) {
        intent = this.lastIntent; this.continuityCount += 1;
      } else if (this.continuityMode === "context" &&
          proposed !== TACTICAL_INTENT.ATTACK &&
          proposed !== TACTICAL_INTENT.EVADE &&
          this.committed !== TACTICAL_INTENT.NONE &&
          !(this.committed === TACTICAL_INTENT.CHASE_STAR && this.target !== star)) {
        intent = this.committed; this.continuityCount += 1;
      }
    }
    this.currentProposed = proposed; this.currentCommitted = intent;
    if (this.oracleReady) {
      this.oracleContextCompareCount += 1;
      if (this.contextEpoch === this.oracleContextEpoch)
        this.oracleContextAgreementCount += 1;
      else if (this.contextMismatchSamples.length < 16) {
        this.contextMismatchSamples.push({
          frame: engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME],
          nativeEpoch: this.contextEpoch,
          oracleEpoch: this.oracleContextEpoch,
          nativeSignature: this.diagnosticContextSignature(engine),
          oracleSignature: this.oracleContextSignature
        });
      }
      this.proposedOracleCompareCount += 1;
      if (proposed === this.oracleProposedIntent) this.proposedOracleAgreementCount += 1;
      this.proposedOraclePairs[this.oracleProposedIntent * 6 + proposed] += 1;
      this.committedOracleCompareCount += 1;
      if (intent === this.oracleIntent) this.committedOracleAgreementCount += 1;
      this.committedOraclePairs[this.oracleIntent * 6 + intent] += 1;
    }
    if (intent !== this.committed) this.switchCount += 1;
    this.committed = intent; this.target = intent === TACTICAL_INTENT.CHASE_STAR ? star : NONE_CELL;
    if (intent === TACTICAL_INTENT.ATTACK) this.attackCount += 1;
    else if (intent === TACTICAL_INTENT.CHASE_STAR) this.starCount += 1;
    else if (intent === TACTICAL_INTENT.EXIT_EDGE) this.edgeCount += 1;
    else if (intent === TACTICAL_INTENT.FACE_ENEMY) this.faceCount += 1;
    else if (intent === TACTICAL_INTENT.EVADE) {
      this.evadeCount += 1;
      if (this.mappingMode !== "v1-action") { this.oracleReady = 0; return; }
    }
    if (this.mappingMode === "v1-action") {
      const mapped = this.v1ActionForIntent(engine, intent); let found = 0;
      this.currentCommittedAction = mapped;
      this.mappingActionCount += mapped !== ACTION.NONE ? 1 : 0;
      if (this.oracleReady) {
        this.mappingOracleCompareCount += 1;
        if (mapped === this.oracleAction) this.mappingOracleAgreementCount += 1;
        const width = ACTION.BOOST_RIGHT_BOMB + 1;
        this.mappingOraclePairs[mapped * width + this.oracleAction] += 1;
        this.mappingIntentOraclePairs[(this.oracleIntent * width + mapped) *
          width + this.oracleAction] += 1;
        this.oracleReady = 0;
      }
      for (let row = 0; row < count; row += 1)
        if (engine.ourActions[row] === mapped && mapped !== ACTION.NONE) {
          this.rowBonus[row] = this.margin; this.rowMember[row] = 1;
          this.bonusRowCount += 1; found = 1;
        }
      if (!found && mapped !== ACTION.NONE) this.mappingMissingRowCount += 1;
      return;
    }
    let best = 0;
    for (let row = 0; row < count; row += 1) {
      const value = this.quality(engine, row, intent);
      if (value > best) best = value;
      this.rowBonus[row] = Math.max(-32768, Math.min(32767, value));
      if (value > 0) this.rowMember[row] = 1;
    }
    if (best <= 0) { this.rowBonus.fill(0, 0, count); return; }
    let selected = -1; let selectedPriority = -1;
    if (this.mappingMode === "single-quality")
      for (let row = 0; row < count; row += 1) {
        if (this.rowBonus[row] !== best) continue;
        const priority = this.actionPriority(engine.ourActions[row]);
        if (selected < 0 || priority > selectedPriority) {
          selected = row; selectedPriority = priority;
        }
      }
    for (let row = 0; row < count; row += 1) {
      const qualifies = this.mappingMode === "single-quality" ?
        row === selected : this.rowBonus[row] === best;
      this.rowBonus[row] = qualifies ? this.margin : 0;
      if (qualifies) this.bonusRowCount += 1;
    }
    this.oracleReady = 0;
  }

  bonus(row) { return this.rowBonus[row] | 0; }
  member(row) { return this.rowMember[row] | 0; }

  summary() {
    return { margin: this.margin, committed: this.committed,
      mappingMode: this.mappingMode,
      continuityMode: this.continuityMode,
      classificationMode: this.classificationMode,
      contextEpoch: this.contextEpoch,
      oracleMode: this.oracleMode, oraclePrepareCount: this.oraclePrepareCount,
      oracleMissingRowCount: this.oracleMissingRowCount,
      mappingActionCount: this.mappingActionCount,
      mappingMissingRowCount: this.mappingMissingRowCount,
      mappingOracleCompareCount: this.mappingOracleCompareCount,
      mappingOracleAgreementCount: this.mappingOracleAgreementCount,
      oracleContextCompareCount: this.oracleContextCompareCount,
      oracleContextAgreementCount: this.oracleContextAgreementCount,
      contextMismatchSamples: this.contextMismatchSamples.slice(),
      proposedOracleCompareCount: this.proposedOracleCompareCount,
      proposedOracleAgreementCount: this.proposedOracleAgreementCount,
      committedOracleCompareCount: this.committedOracleCompareCount,
      committedOracleAgreementCount: this.committedOracleAgreementCount,
      proposedOraclePairs: Array.from(this.proposedOraclePairs),
      committedOraclePairs: Array.from(this.committedOraclePairs),
      mappingOraclePairs: Array.from(this.mappingOraclePairs),
      mappingIntentOraclePairs: Array.from(this.mappingIntentOraclePairs),
      prepareCount: this.prepareCount, attackCount: this.attackCount,
      starCount: this.starCount, edgeCount: this.edgeCount, faceCount: this.faceCount,
      evadeCount: this.evadeCount, continuityCount: this.continuityCount,
      switchCount: this.switchCount, contextChangeCount: this.contextChangeCount,
      bonusRowCount: this.bonusRowCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

// An attack is represented as a short-lived option, not as a bonus attached
// to FIRE.  The option binds an own firing pose and direction to a bounded set
// of enemy first responses, a fire deadline, and a post-fire escape count.
// Root actions are then compared by progress toward the same option.  This is
// diagnostic-only and deliberately remains soft evidence: it cannot write
// Hard/Proof or cross a clearly superior minimax value.
class NativeAttackPoseOptionPoc {
  constructor(options = {}) {
    const maxOptions = typeof options === "number" ? options :
      options.maxOptions || MAX_ATTACK_POSE_OPTIONS;
    this.routeProof = typeof options === "object" && options.routeProof === true;
    this.persistent = typeof options === "object" && options.persistent === true;
    this.requireFullCoverage = typeof options === "object" &&
      options.requireFullCoverage === true;
    this.requireUncoveredNonRegression = typeof options === "object" &&
      options.requireUncoveredNonRegression === true;
    this.responseDerivedPoses = typeof options === "object" &&
      options.responseDerivedPoses === true;
    this.requireSuccessorResponseViability = typeof options === "object" &&
      options.requireSuccessorResponseViability === true;
    this.capacity = Math.min(MAX_ATTACK_POSE_OPTIONS, Math.max(1, maxOptions | 0));
    this.cell = new Uint16Array(this.capacity);
    this.direction = new Uint8Array(this.capacity);
    this.fireDeadline = new Uint8Array(this.capacity);
    this.responseCoverage = new Uint8Array(this.capacity);
    this.responseMask = new Uint32Array(this.capacity);
    this.postFireEscape = new Uint8Array(this.capacity);
    this.counterExposure = new Uint8Array(this.capacity);
    this.enemyCell = new Uint16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.enemyDirection = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.distance = new Uint8Array(CAPACITY.MAX_CELLS);
    this.targetDistance = new Uint8Array(CAPACITY.MAX_CELLS);
    this.queue = new Uint16Array(CAPACITY.MAX_CELLS);
    this.optionSeen = new Int16Array(CAPACITY.MAX_CELLS * 4);
    this.rowSupported = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowProgress = new Int8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowDeadline = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowResponseCoverage = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.count = 0; this.selected = -1; this.generation = 0;
    this.committedCell = NONE_CELL; this.committedDirection = 0;
    this.lastContextSignature = 0; this.rootCount = 0;
    this.optionCount = 0; this.optionOverflowCount = 0;
    this.completeRootCount = 0; this.incompleteRootCount = 0;
    this.supportedRowCount = 0; this.directFireRowCount = 0;
    this.progressRowCount = 0; this.routeTurnCount = 0;
    this.rejectedPrematureTurnCount = 0; this.contextChangeCount = 0;
    this.commitKeepCount = 0; this.commitSwitchCount = 0;
    this.commitInvalidationCount = 0; this.generatedOptionCount = 0;
    this.fullCoverageRootCount = 0; this.partialCoverageRootCount = 0;
    this.fullCoverageRejectedCount = 0;
    this.uncoveredRegressionRejectedRowCount = 0;
    this.responseDerivedRootCount = 0; this.responseDerivedPoseCount = 0;
    this.successorViabilityCheckCount = 0;
    this.successorViableRowCount = 0;
    this.successorRejectedRowCount = 0;
    this.successorDistanceFillCount = 0;
    this.hotAllocationCount = 0;
  }

  turns(from, to) {
    const delta = Math.abs(from - to); return Math.min(delta, 4 - delta);
  }

  walkable(state, cell) {
    if (cell === NONE_CELL || cell >= state.cells) return 0;
    const tile = state.arrays[ARRAY.TERRAIN][cell];
    return tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT ? 1 : 0;
  }

  contextSignature(engine) {
    const state = engine.adapter.state; const a = state.arrays;
    let hash = mix32(0x6a09e667, a[ARRAY.TANK_CELL][1]);
    hash = mix32(hash, a[ARRAY.TANK_DIR][1]);
    hash = mix32(hash, a[ARRAY.TANK_SHIELD_HITS][1]);
    hash = mix32(hash, engine.enemyCount);
    for (let column = 0; column < engine.enemyCount; column += 1)
      hash = mix32(hash, engine.enemyActions[column] * 257 + column);
    return hash;
  }

  fillDistances(state, origin, target,
    blocked = state.arrays[ARRAY.TANK_CELL][1]) {
    target.fill(UNREACHABLE, 0, state.cells);
    if (!this.walkable(state, origin)) return 0;
    let head = 0; let tail = 1; this.queue[0] = origin; target[origin] = 0;
    while (head < tail) {
      const cell = this.queue[head++]; const nextDistance = target[cell] + 1;
      const x = state.x(cell); const y = state.y(cell);
      for (let direction = 0; direction < 4; direction += 1) {
        const nx = x + DX[direction]; const ny = y + DY[direction];
        if (nx < 0 || nx >= state.width || ny < 0 || ny >= state.height) continue;
        const next = state.cell(nx, ny);
        if (next === blocked || !this.walkable(state, next) ||
            target[next] !== UNREACHABLE) continue;
        target[next] = nextDistance; this.queue[tail++] = next;
      }
    }
    return tail;
  }

  successorResponseCoverage(engine, row) {
    const state = engine.adapter.state; const cell = engine.projectedCell[row];
    const direction = engine.projectedDirection[row]; let coverage = 0;
    this.successorViabilityCheckCount += 1;
    for (let column = 0; column < this.count; column += 1) {
      const enemy = this.enemyCell[column];
      if (cell === enemy) continue;
      this.fillDistances(state, cell, this.distance, enemy);
      this.successorDistanceFillCount += 1;
      let viable = 0;
      for (let option = 0; option < this.optionCount; option += 1) {
        if (!(this.responseMask[option] & (1 << column)) ||
            this.cell[option] === enemy ||
            this.distance[this.cell[option]] === UNREACHABLE) continue;
        const deadline = this.distance[this.cell[option]] +
          this.turns(direction, this.direction[option]) + 1;
        if (deadline <= 5) { viable = 1; break; }
      }
      if (viable) coverage += 1;
    }
    this.rowResponseCoverage[row] = coverage;
    return coverage;
  }

  projectEnemy(engine) {
    const state = engine.adapter.state; const a = state.arrays;
    const start = a[ARRAY.TANK_CELL][1]; const startDirection = a[ARRAY.TANK_DIR][1];
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const speed = a[ARRAY.TANK_BOOST_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_BOOST_UNTIL][1] > frame ? 2 : 1;
    let complete = 1;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      const action = engine.enemyActions[column]; let cell = start;
      let direction = startDirection;
      if (action === ACTION.TURN_LEFT) direction = (direction + 3) & 3;
      else if (action === ACTION.TURN_RIGHT) direction = (direction + 1) & 3;
      else if (action === ACTION.GO) {
        for (let step = 0; step < speed; step += 1) {
          const x = state.x(cell) + DX[direction];
          const y = state.y(cell) + DY[direction];
          if (x < 0 || x >= state.width || y < 0 || y >= state.height) break;
          const next = state.cell(x, y);
          if (!this.walkable(state, next) ||
              next === a[ARRAY.TANK_CELL][0]) break;
          cell = next;
        }
      } else if (action === ACTION.CAST_TELEPORT) complete = 0;
      this.enemyCell[column] = cell; this.enemyDirection[column] = direction;
    }
    return complete;
  }

  escapeCount(state, pose) {
    const x = state.x(pose); const y = state.y(pose); let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const nx = x + DX[direction]; const ny = y + DY[direction];
      if (nx < 0 || nx >= state.width || ny < 0 || ny >= state.height) continue;
      const next = state.cell(nx, ny);
      if (!this.walkable(state, next) ||
          next === state.arrays[ARRAY.TANK_CELL][1]) continue;
      let exposed = 0;
      for (let column = 0; column < this.count; column += 1) {
        const enemy = this.enemyCell[column]; const enemyDirection = this.enemyDirection[column];
        if (isAhead(state, enemy, enemyDirection, next) &&
            rayClear(state, enemy, next)) { exposed = 1; break; }
      }
      if (!exposed) count += 1;
    }
    return count;
  }

  betterOption(index, best) {
    if (best < 0) return 1;
    if (this.responseCoverage[index] !== this.responseCoverage[best])
      return this.responseCoverage[index] > this.responseCoverage[best];
    if (this.fireDeadline[index] !== this.fireDeadline[best])
      return this.fireDeadline[index] < this.fireDeadline[best];
    if (this.postFireEscape[index] !== this.postFireEscape[best])
      return this.postFireEscape[index] > this.postFireEscape[best];
    if (this.counterExposure[index] !== this.counterExposure[best])
      return this.counterExposure[index] < this.counterExposure[best];
    if (this.cell[index] !== this.cell[best]) return this.cell[index] < this.cell[best];
    return this.direction[index] < this.direction[best];
  }

  addOption(state, pose, direction, deadline) {
    let coverage = 0; let responseMask = 0; let counter = 0;
    for (let column = 0; column < this.count; column += 1) {
      const enemy = this.enemyCell[column];
      if (isAhead(state, pose, direction, enemy) && rayClear(state, pose, enemy)) {
        coverage += 1; responseMask = (responseMask | (1 << column)) >>> 0;
      }
      if (isAhead(state, enemy, this.enemyDirection[column], pose) &&
          rayClear(state, enemy, pose)) counter += 1;
    }
    if (!coverage) return 0;
    const escape = this.escapeCount(state, pose);
    if (!escape) return 0;
    if (this.optionCount >= this.capacity) { this.optionOverflowCount += 1; return 0; }
    const index = this.optionCount++;
    this.cell[index] = pose; this.direction[index] = direction;
    this.fireDeadline[index] = deadline; this.responseCoverage[index] = coverage;
    this.responseMask[index] = responseMask;
    this.postFireEscape[index] = escape; this.counterExposure[index] = counter;
    this.generatedOptionCount += 1;
    return 1;
  }

  buildResponseDerivedOptions(state) {
    const a = state.arrays; const ownDirection = a[ARRAY.TANK_DIR][0];
    this.optionSeen.fill(-1, 0, state.cells * 4);
    for (let column = 0; column < this.count; column += 1) {
      const target = this.enemyCell[column];
      for (let direction = 0; direction < 4; direction += 1) {
        let x = state.x(target) - DX[direction];
        let y = state.y(target) - DY[direction];
        while (x >= 0 && x < state.width && y >= 0 && y < state.height) {
          const pose = state.cell(x, y); const tile = a[ARRAY.TERRAIN][pose];
          if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) break;
          const seen = pose * 4 + direction;
          if (this.optionSeen[seen] < 0) {
            this.optionSeen[seen] = -2;
            if (pose !== a[ARRAY.TANK_CELL][1] &&
                this.distance[pose] !== UNREACHABLE) {
              const deadline = this.distance[pose] +
                this.turns(ownDirection, direction) + 1;
              if (deadline <= 6 && this.addOption(state, pose, direction, deadline)) {
                this.optionSeen[seen] = this.optionCount - 1;
                this.responseDerivedPoseCount += 1;
              }
            }
          }
          x -= DX[direction]; y -= DY[direction];
        }
      }
    }
  }

  dominates(left, right) {
    if (left < 0 || right < 0) return 0;
    const noWorse = this.responseCoverage[left] >= this.responseCoverage[right] &&
      this.fireDeadline[left] <= this.fireDeadline[right] &&
      this.postFireEscape[left] >= this.postFireEscape[right] &&
      this.counterExposure[left] <= this.counterExposure[right];
    const strict = this.responseCoverage[left] > this.responseCoverage[right] ||
      this.fireDeadline[left] < this.fireDeadline[right] ||
      this.postFireEscape[left] > this.postFireEscape[right] ||
      this.counterExposure[left] < this.counterExposure[right];
    return noWorse && strict ? 1 : 0;
  }

  applyPersistence() {
    if (!this.persistent || this.selected < 0) return this.selected >= 0 ? 1 : 0;
    let prior = -1;
    for (let index = 0; index < this.optionCount; index += 1)
      if (this.cell[index] === this.committedCell &&
          this.direction[index] === this.committedDirection) { prior = index; break; }
    if (prior >= 0 && !this.dominates(this.selected, prior)) {
      this.selected = prior; this.commitKeepCount += 1;
    } else {
      if (this.committedCell !== NONE_CELL) {
        if (prior < 0) this.commitInvalidationCount += 1;
        else this.commitSwitchCount += 1;
      } else this.commitSwitchCount += 1;
      this.committedCell = this.cell[this.selected];
      this.committedDirection = this.direction[this.selected];
      this.generation = (this.generation + 1) >>> 0;
    }
    return 1;
  }

  buildOptions(engine) {
    const state = engine.adapter.state; const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    this.optionCount = 0; this.selected = -1; this.count = engine.enemyCount;
    const complete = this.projectEnemy(engine);
    this.fillDistances(state, own, this.distance);
    if (this.responseDerivedPoses) {
      this.responseDerivedRootCount += 1; this.buildResponseDerivedOptions(state);
    } else for (let pose = 0; pose < state.cells; pose += 1) {
        if (!this.walkable(state, pose) || pose === enemy ||
            this.distance[pose] === UNREACHABLE) continue;
        const direction = state.x(pose) === state.x(enemy) ?
          (state.y(enemy) < state.y(pose) ? 0 : 2) :
          state.y(pose) === state.y(enemy) ?
            (state.x(enemy) > state.x(pose) ? 1 : 3) : -1;
        if (direction < 0 || !rayClear(state, pose, enemy)) continue;
        const deadline = this.distance[pose] +
          this.turns(a[ARRAY.TANK_DIR][0], direction) + 1;
        if (deadline > 6) continue;
        this.addOption(state, pose, direction, deadline);
      }
    for (let index = 0; index < this.optionCount; index += 1)
      if (this.betterOption(index, this.selected)) this.selected = index;
    if (complete && this.selected >= 0) this.completeRootCount += 1;
    else this.incompleteRootCount += 1;
    return complete && this.selected >= 0 ? 1 : 0;
  }

  prepare(engine, count) {
    this.rootCount += 1; this.rowSupported.fill(0, 0, count);
    this.rowProgress.fill(0, 0, count); this.rowDeadline.fill(UNREACHABLE, 0, count);
    this.rowResponseCoverage.fill(0, 0, count);
    const signature = this.contextSignature(engine);
    if (this.lastContextSignature && signature !== this.lastContextSignature) {
      if (!this.persistent) this.generation = (this.generation + 1) >>> 0;
      this.contextChangeCount += 1;
    }
    this.lastContextSignature = signature;
    if (!this.buildOptions(engine)) {
      if (this.persistent && this.committedCell !== NONE_CELL) {
        this.committedCell = NONE_CELL; this.commitInvalidationCount += 1;
        this.generation = (this.generation + 1) >>> 0;
      }
      return 0;
    }
    this.applyPersistence();
    if (this.responseCoverage[this.selected] === this.count)
      this.fullCoverageRootCount += 1;
    else {
      this.partialCoverageRootCount += 1;
      if (this.requireFullCoverage) { this.fullCoverageRejectedCount += 1; return 0; }
    }
    const state = engine.adapter.state; const option = this.selected;
    const target = this.cell[option]; const wanted = this.direction[option];
    this.fillDistances(state, target, this.targetDistance);
    const own = state.arrays[ARRAY.TANK_CELL][0];
    const ownDirection = state.arrays[ARRAY.TANK_DIR][0];
    const current = this.targetDistance[own] + this.turns(ownDirection, wanted) + 1;
    for (let row = 0; row < count; row += 1) {
      const cell = engine.projectedCell[row]; const direction = engine.projectedDirection[row];
      if (cell === NONE_CELL || this.targetDistance[cell] === UNREACHABLE) continue;
      const deadline = this.targetDistance[cell] + this.turns(direction, wanted) + 1;
      this.rowDeadline[row] = deadline;
      const exactFire = engine.ourActions[row] === ACTION.FIRE &&
        cell === target && direction === wanted;
      let progress = exactFire ? current + 1 : current - deadline;
      if (this.routeProof && !exactFire) {
        const action = engine.ourActions[row]; progress = 0;
        if (action === ACTION.GO && cell !== own &&
            this.targetDistance[cell] < this.targetDistance[own]) {
          progress = this.targetDistance[own] - this.targetDistance[cell];
        } else if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) {
          if (own === target) {
            if (this.turns(direction, wanted) < this.turns(ownDirection, wanted))
              progress = 1;
          } else {
            const nextX = state.x(own) + DX[direction];
            const nextY = state.y(own) + DY[direction];
            const oldX = state.x(own) + DX[ownDirection];
            const oldY = state.y(own) + DY[ownDirection];
            const next = nextX < 0 || nextX >= state.width || nextY < 0 ||
              nextY >= state.height ? NONE_CELL : state.cell(nextX, nextY);
            const oldNext = oldX < 0 || oldX >= state.width || oldY < 0 ||
              oldY >= state.height ? NONE_CELL : state.cell(oldX, oldY);
            const nextShorter = next !== NONE_CELL && this.walkable(state, next) &&
              this.targetDistance[next] + 1 === this.targetDistance[own];
            const oldShorter = oldNext !== NONE_CELL && this.walkable(state, oldNext) &&
              this.targetDistance[oldNext] + 1 === this.targetDistance[own];
            if (nextShorter && !oldShorter) { progress = 1; this.routeTurnCount += 1; }
            else this.rejectedPrematureTurnCount += 1;
          }
        }
      }
      if (progress <= 0) continue;
      if (this.requireSuccessorResponseViability && !exactFire) {
        if (this.successorResponseCoverage(engine, row) !== this.count) {
          this.successorRejectedRowCount += 1; continue;
        }
        this.successorViableRowCount += 1;
      }
      this.rowSupported[row] = 1; this.rowProgress[row] = Math.min(127, progress);
      this.supportedRowCount += 1;
      if (exactFire) this.directFireRowCount += 1; else this.progressRowCount += 1;
    }
    return 1;
  }

  supports(row) { return this.rowSupported[row] ? 1 : 0; }

  uncoveredNonRegressing(source, row, baseline, enemyCount) {
    if (!this.requireUncoveredNonRegression) return 1;
    if (!source?.rootCellScore || this.selected < 0) return 0;
    const mask = this.responseMask[this.selected];
    const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
    for (let column = 0; column < enemyCount; column += 1) {
      if (mask & (1 << column)) continue;
      if (source.rootCellScore[row * stride + column] <
          source.rootCellScore[baseline * stride + column]) {
        this.uncoveredRegressionRejectedRowCount += 1; return 0;
      }
    }
    return 1;
  }

  betterRow(engine, left, right) {
    if (right < 0) return 1;
    const leftFire = engine.ourActions[left] === ACTION.FIRE;
    const rightFire = engine.ourActions[right] === ACTION.FIRE;
    if (leftFire !== rightFire) return leftFire;
    if (this.routeProof) {
      const leftGo = engine.ourActions[left] === ACTION.GO;
      const rightGo = engine.ourActions[right] === ACTION.GO;
      if (leftGo !== rightGo) return leftGo;
    }
    if (this.rowProgress[left] !== this.rowProgress[right])
      return this.rowProgress[left] > this.rowProgress[right];
    if (this.rowDeadline[left] !== this.rowDeadline[right])
      return this.rowDeadline[left] < this.rowDeadline[right];
    return left < right;
  }

  summary() {
    return { capacity: this.capacity, routeProof: this.routeProof,
      persistent: this.persistent,
      requireFullCoverage: this.requireFullCoverage,
      requireUncoveredNonRegression: this.requireUncoveredNonRegression,
      responseDerivedPoses: this.responseDerivedPoses,
      requireSuccessorResponseViability: this.requireSuccessorResponseViability,
      generation: this.generation,
      rootCount: this.rootCount, optionCount: this.optionCount,
      optionOverflowCount: this.optionOverflowCount,
      completeRootCount: this.completeRootCount,
      incompleteRootCount: this.incompleteRootCount,
      supportedRowCount: this.supportedRowCount,
      directFireRowCount: this.directFireRowCount,
      progressRowCount: this.progressRowCount,
      routeTurnCount: this.routeTurnCount,
      rejectedPrematureTurnCount: this.rejectedPrematureTurnCount,
      generatedOptionCount: this.generatedOptionCount,
      commitKeepCount: this.commitKeepCount,
      commitSwitchCount: this.commitSwitchCount,
      commitInvalidationCount: this.commitInvalidationCount,
      fullCoverageRootCount: this.fullCoverageRootCount,
      partialCoverageRootCount: this.partialCoverageRootCount,
      fullCoverageRejectedCount: this.fullCoverageRejectedCount,
      uncoveredRegressionRejectedRowCount:
        this.uncoveredRegressionRejectedRowCount,
      responseDerivedRootCount: this.responseDerivedRootCount,
      responseDerivedPoseCount: this.responseDerivedPoseCount,
      successorViabilityCheckCount: this.successorViabilityCheckCount,
      successorViableRowCount: this.successorViableRowCount,
      successorRejectedRowCount: this.successorRejectedRowCount,
      successorDistanceFillCount: this.successorDistanceFillCount,
      contextChangeCount: this.contextChangeCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

// Diagnostic-only receding-horizon policy adapter.  The root action remains
// a primitive action and all root rows are valued by the same minimax search.
// At every later own node this adapter recomputes a reachable firing pose from
// the current PhysicalState and promotes exactly one route action into the
// bounded representative set.  It intentionally adds no score: any benefit
// must come from making the searched continuation match the policy that will
// actually be replanned on the next callback.
class NativeAttackPoseFeedbackSearchPoc {
  constructor(options = {}) {
    this.forcePolicy = options.forcePolicy === true;
    this.fixedOption = options.fixedOption === true;
    this.boundCell = NONE_CELL; this.boundDirection = 0;
    this.distance = new Uint8Array(CAPACITY.MAX_CELLS);
    this.targetDistance = new Uint8Array(CAPACITY.MAX_CELLS);
    this.queue = new Uint16Array(CAPACITY.MAX_CELLS);
    this.prepareCount = 0; this.completeCount = 0; this.noPoseCount = 0;
    this.nonContactSkipCount = 0; this.hostileSkipCount = 0;
    this.promotedCount = 0; this.alreadyFirstCount = 0;
    this.injectedCount = 0; this.displacedCount = 0;
    this.fireCount = 0; this.goCount = 0; this.turnCount = 0;
    this.bindCount = 0; this.fixedInvalidCount = 0;
    this.hotAllocationCount = 0;
  }

  bind(pose) {
    if (!this.fixedOption || !pose || pose.selected < 0) {
      this.boundCell = NONE_CELL; return 0;
    }
    this.boundCell = pose.cell[pose.selected];
    this.boundDirection = pose.direction[pose.selected];
    this.bindCount += 1; return 1;
  }

  turns(from, to) {
    const delta = Math.abs(from - to); return Math.min(delta, 4 - delta);
  }

  walkable(state, cell) {
    if (cell === NONE_CELL || cell >= state.cells) return 0;
    const tile = state.arrays[ARRAY.TERRAIN][cell];
    return tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT ? 1 : 0;
  }

  fillDistances(state, origin, target, blocked) {
    target.fill(UNREACHABLE, 0, state.cells);
    if (!this.walkable(state, origin)) return 0;
    let head = 0; let tail = 1; this.queue[0] = origin; target[origin] = 0;
    while (head < tail) {
      const cell = this.queue[head++]; const nextDistance = target[cell] + 1;
      const x = state.x(cell); const y = state.y(cell);
      for (let direction = 0; direction < 4; direction += 1) {
        const nx = x + DX[direction]; const ny = y + DY[direction];
        if (nx < 0 || nx >= state.width || ny < 0 || ny >= state.height) continue;
        const next = state.cell(nx, ny);
        if (next === blocked || !this.walkable(state, next) ||
            target[next] !== UNREACHABLE) continue;
        target[next] = nextDistance; this.queue[tail++] = next;
      }
    }
    return tail;
  }

  canFire(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_FIRE_LOCK][0] !== NONE_FRAME &&
        a[ARRAY.TANK_FIRE_LOCK][0] > frame) return 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === 0) return 0;
    return 1;
  }

  hasHostileProjectile(state) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === 1) return 1;
    return 0;
  }

  escapeCount(state, pose, enemy) {
    const a = state.arrays; const x = state.x(pose); const y = state.y(pose);
    const enemyDirection = a[ARRAY.TANK_DIR][1]; let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const nx = x + DX[direction]; const ny = y + DY[direction];
      if (nx < 0 || nx >= state.width || ny < 0 || ny >= state.height) continue;
      const next = state.cell(nx, ny);
      if (!this.walkable(state, next) || next === enemy) continue;
      if (isAhead(state, enemy, enemyDirection, next) && rayClear(state, enemy, next)) continue;
      count += 1;
    }
    return count;
  }

  targetAction(state, own, ownDirection, target, wanted) {
    if (own === target) {
      if (ownDirection === wanted && this.canFire(state)) return ACTION.FIRE;
      const left = (ownDirection + 3) & 3;
      return wanted === left ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
    }
    const forwardX = state.x(own) + DX[ownDirection];
    const forwardY = state.y(own) + DY[ownDirection];
    const forward = forwardX < 0 || forwardX >= state.width ||
      forwardY < 0 || forwardY >= state.height ? NONE_CELL :
      state.cell(forwardX, forwardY);
    if (forward !== NONE_CELL && this.walkable(state, forward) &&
        this.targetDistance[forward] + 1 === this.targetDistance[own]) return ACTION.GO;
    const left = (ownDirection + 3) & 3; const right = (ownDirection + 1) & 3;
    const leftCell = state.x(own) + DX[left] < 0 ||
      state.x(own) + DX[left] >= state.width || state.y(own) + DY[left] < 0 ||
      state.y(own) + DY[left] >= state.height ? NONE_CELL :
      state.cell(state.x(own) + DX[left], state.y(own) + DY[left]);
    const rightCell = state.x(own) + DX[right] < 0 ||
      state.x(own) + DX[right] >= state.width || state.y(own) + DY[right] < 0 ||
      state.y(own) + DY[right] >= state.height ? NONE_CELL :
      state.cell(state.x(own) + DX[right], state.y(own) + DY[right]);
    const leftProgress = leftCell !== NONE_CELL && this.walkable(state, leftCell) &&
      this.targetDistance[leftCell] + 1 === this.targetDistance[own];
    const rightProgress = rightCell !== NONE_CELL && this.walkable(state, rightCell) &&
      this.targetDistance[rightCell] + 1 === this.targetDistance[own];
    if (leftProgress) return ACTION.TURN_LEFT;
    if (rightProgress) return ACTION.TURN_RIGHT;
    return ACTION.NONE;
  }

  recordAction(action) {
    if (action === ACTION.NONE) { this.noPoseCount += 1; return action; }
    this.completeCount += 1;
    if (action === ACTION.FIRE) this.fireCount += 1;
    else if (action === ACTION.GO) this.goCount += 1;
    else this.turnCount += 1;
    return action;
  }

  fixedRouteAction(state, own, ownDirection, enemy) {
    const target = this.boundCell; const wanted = this.boundDirection;
    if (target === NONE_CELL || target === enemy || !this.walkable(state, target) ||
        !isAhead(state, target, wanted, enemy) || !rayClear(state, target, enemy)) {
      this.fixedInvalidCount += 1; return ACTION.NONE;
    }
    this.fillDistances(state, own, this.distance, enemy);
    if (this.distance[target] === UNREACHABLE ||
        this.distance[target] + this.turns(ownDirection, wanted) + 1 > 6) {
      this.fixedInvalidCount += 1; return ACTION.NONE;
    }
    this.fillDistances(state, target, this.targetDistance, enemy);
    return this.recordAction(this.targetAction(state, own, ownDirection,
      target, wanted));
  }

  routeAction(state) {
    this.prepareCount += 1; const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    if (own === NONE_CELL || enemy === NONE_CELL) { this.noPoseCount += 1; return ACTION.NONE; }
    if (this.hasHostileProjectile(state)) {
      this.hostileSkipCount += 1; return ACTION.NONE;
    }
    if (this.fixedOption)
      return this.fixedRouteAction(state, own, a[ARRAY.TANK_DIR][0], enemy);
    const contact = Math.abs(state.x(own) - state.x(enemy)) +
      Math.abs(state.y(own) - state.y(enemy)) <= 9 || rayClear(state, own, enemy);
    if (!contact) { this.nonContactSkipCount += 1; return ACTION.NONE; }
    this.fillDistances(state, own, this.distance, enemy);
    let best = NONE_CELL; let bestDirection = 0; let bestDeadline = UNREACHABLE;
    let bestEscape = -1; let bestExposure = 2;
    const ownDirection = a[ARRAY.TANK_DIR][0];
    for (let pose = 0; pose < state.cells; pose += 1) {
      if (pose === enemy || this.distance[pose] === UNREACHABLE ||
          !this.walkable(state, pose)) continue;
      const direction = state.x(pose) === state.x(enemy) ?
        (state.y(enemy) < state.y(pose) ? 0 : 2) :
        state.y(pose) === state.y(enemy) ?
          (state.x(enemy) > state.x(pose) ? 1 : 3) : -1;
      if (direction < 0 || !rayClear(state, pose, enemy)) continue;
      const deadline = this.distance[pose] + this.turns(ownDirection, direction) + 1;
      if (deadline > 6) continue;
      const escape = this.escapeCount(state, pose, enemy);
      if (!escape) continue;
      const exposed = isAhead(state, enemy, a[ARRAY.TANK_DIR][1], pose) &&
        rayClear(state, enemy, pose) ? 1 : 0;
      if (best === NONE_CELL || deadline < bestDeadline ||
          deadline === bestDeadline && escape > bestEscape ||
          deadline === bestDeadline && escape === bestEscape && exposed < bestExposure ||
          deadline === bestDeadline && escape === bestEscape && exposed === bestExposure &&
            (pose < best || pose === best && direction < bestDirection)) {
        best = pose; bestDirection = direction; bestDeadline = deadline;
        bestEscape = escape; bestExposure = exposed;
      }
    }
    if (best === NONE_CELL) { this.noPoseCount += 1; return ACTION.NONE; }
    this.fillDistances(state, best, this.targetDistance, enemy);
    return this.recordAction(this.targetAction(state, own, ownDirection,
      best, bestDirection));
  }

  promote(search, top, action) {
    const offset = top * 4; let count = search.frameOurCount[top]; let at = 0;
    while (at < count && search.deepOurActions[offset + at] !== action) at += 1;
    if (at === 0) { this.alreadyFirstCount += 1; return; }
    if (at < count) {
      const argument = search.deepOurArguments[offset + at];
      for (; at > 0; at -= 1) {
        search.deepOurActions[offset + at] = search.deepOurActions[offset + at - 1];
        search.deepOurArguments[offset + at] = search.deepOurArguments[offset + at - 1];
      }
      search.deepOurActions[offset] = action; search.deepOurArguments[offset] = argument;
      this.promotedCount += 1; return;
    }
    const limit = Math.min(4, Math.max(2, search.iterationExpansionLimit | 0));
    const nextCount = Math.min(limit, count + 1);
    if (count >= limit) this.displacedCount += 1;
    for (let index = nextCount - 1; index > 0; index -= 1) {
      search.deepOurActions[offset + index] = search.deepOurActions[offset + index - 1];
      search.deepOurArguments[offset + index] = search.deepOurArguments[offset + index - 1];
    }
    search.deepOurActions[offset] = action;
    search.deepOurArguments[offset] = NONE_CELL;
    search.frameOurCount[top] = nextCount;
    if (search.frameOurGeneratedCount[top] < count + 1)
      search.frameOurGeneratedCount[top] = Math.min(255, count + 1);
    this.injectedCount += 1;
  }

  force(search, top, action) {
    const offset = top * 4;
    if (search.frameOurCount[top] === 1 && search.deepOurActions[offset] === action) {
      this.alreadyFirstCount += 1; return;
    }
    search.deepOurActions[offset] = action;
    search.deepOurArguments[offset] = NONE_CELL;
    search.frameOurCount[top] = 1; search.frameOurGeneratedCount[top] = 1;
    this.promotedCount += 1;
  }

  install(search) {
    const feedback = this; const generate = search.generateDeep;
    search.generateDeep = function(top, state, seat) {
      const result = Reflect.apply(generate, this, [top, state, seat]);
      if (!seat) {
        const action = feedback.routeAction(state);
        if (action !== ACTION.NONE) {
          if (feedback.forcePolicy) feedback.force(this, top, action);
          else feedback.promote(this, top, action);
        }
      }
      return result;
    };
    return this;
  }

  summary() {
    return { forcePolicy: this.forcePolicy, fixedOption: this.fixedOption,
      bindCount: this.bindCount, fixedInvalidCount: this.fixedInvalidCount,
      prepareCount: this.prepareCount, completeCount: this.completeCount,
      noPoseCount: this.noPoseCount, nonContactSkipCount: this.nonContactSkipCount,
      hostileSkipCount: this.hostileSkipCount, promotedCount: this.promotedCount,
      alreadyFirstCount: this.alreadyFirstCount, injectedCount: this.injectedCount,
      displacedCount: this.displacedCount, fireCount: this.fireCount,
      goCount: this.goCount, turnCount: this.turnCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

class NativeTacticalHistoryPoc {
  constructor() {
    this.signatureCount = 0; this.heuristicCount = 0;
    this.turnStreakCount = 0; this.turnReversalCount = 0;
    this.hotAllocationCount = 0;
  }

  signature(state) {
    this.signatureCount += 1; let hash = 0x6d2b79f5; let commands = 0;
    for (let at = state.eventUsed - 1; at >= 0 && commands < 8; at -= 1) {
      if (state.eventType[at] !== EVENT.COMMAND_EXECUTED) continue;
      hash = mix32(hash, state.eventEntity[at] * 257 +
        state.eventValueAfter[at] * 17 + commands);
      commands += 1;
    }
    return mix32(hash, commands);
  }

  seatPenalty(state, entity) {
    let last = ACTION.NONE; let streak = 0; let penalty = 0;
    for (let at = state.eventUsed - 1; at >= 0; at -= 1) {
      if (state.eventType[at] !== EVENT.COMMAND_EXECUTED ||
          state.eventEntity[at] !== entity) continue;
      const action = state.eventValueAfter[at];
      if (action !== ACTION.TURN_LEFT && action !== ACTION.TURN_RIGHT) break;
      if (streak === 0) last = action;
      else if (streak === 1 && action !== last) {
        penalty += 110; this.turnReversalCount += 1;
      }
      streak += 1;
      if (streak >= 4) break;
    }
    if (streak) {
      this.turnStreakCount += 1;
      for (let count = 1; count <= streak; count += 1) {
        penalty += 12 + count * 10;
        if (count === 2) penalty += 60;
        else if (count === 3) penalty += 180;
        else if (count >= 4) penalty += 360;
      }
    }
    return penalty;
  }

  install(search) {
    const history = this; const cacheKey = search.cacheKey;
    const cacheKeyHi = search.cacheKeyHi; const cacheSignature = search.cacheSignature;
    const heuristic = search.heuristic;
    search.cacheKey = function(state, depth) {
      return mix32(Reflect.apply(cacheKey, this, [state, depth]), history.signature(state));
    };
    search.cacheKeyHi = function(state, depth) {
      return mix32(Reflect.apply(cacheKeyHi, this, [state, depth]),
        history.signature(state) ^ 0x9e3779b9);
    };
    search.cacheSignature = function(state, depth) {
      return mix32(Reflect.apply(cacheSignature, this, [state, depth]),
        history.signature(state) ^ 0x7f4a7c15);
    };
    search.heuristic = function(state) {
      history.heuristicCount += 1;
      const base = Reflect.apply(heuristic, this, [state]);
      return history.adjust(state, base);
    };
    return this;
  }

  adjustOwn(state, base) {
    this.heuristicCount += 1;
    return clamp(base - this.seatPenalty(state, 1), -25000, 25000);
  }

  adjust(state, base) {
    return clamp(base - this.seatPenalty(state, 1) +
      this.seatPenalty(state, 2), -25000, 25000);
  }

  summary() {
    return { signatureCount: this.signatureCount,
      heuristicCount: this.heuristicCount, turnStreakCount: this.turnStreakCount,
      turnReversalCount: this.turnReversalCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { DOMAIN_MODE, NativeTacticalDomainPoc,
  NativeTacticalLeafEvaluatorPoc, NativeTacticalLeafAblationPoc,
  LEAF_COMPONENT, LEAF_COMPONENT_ALL, NativeTacticalRaceLeafEvaluatorPoc,
  NativePolicyOutcomeLexicographicPoc,
  NativeProjectileSettlementLexicographicPoc, SETTLEMENT,
  NativeTacticalRepresentativePoc,
  NativeTacticalIntentPoc, NativeAttackPoseOptionPoc,
  NativeAttackPoseFeedbackSearchPoc, NativeTacticalHistoryPoc, isAhead, rayClear };
