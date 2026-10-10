"use strict";

// BP68 uses only the qualified-resource half of the old multi-purpose
// diagnostic domain. Keep that exact semantic slice here and leave FIRE to
// the bounded policy search/intent contract.

const { CAPACITY, RULE } = require("../generated/fast-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, SKILL, TERRAIN, NONE_FRAME, NONE_CELL, DX, DY } = require(
  "../abi/fast-codes");

const RESOURCE_DOMAIN_MODE = 2;
const UNREACHABLE = 0xff;
const BOMB_POSE_COUNT = CAPACITY.MAX_CELLS * 4;

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

class NativeBasePolicyActionDomain {
  constructor() {
    this.mode = RESOURCE_DOMAIN_MODE;
    this.checkCount = 0;
    this.fireCheckCount = 0;
    this.directFireCount = 0;
    this.interceptFireCount = 0;
    this.blockedFireCount = 0;
    this.resourceCheckCount = 0;
    this.bombAllowedCount = 0;
    this.bombBlockedCount = 0;
    this.skillAllowedCount = 0;
    this.skillBlockedCount = 0;
    this.hotAllocationCount = 0;
    this.bombDistance = new Uint8Array(CAPACITY.MAX_CELLS);
    this.bombQueue = new Uint16Array(CAPACITY.MAX_CELLS);
    this.bombPoseStamp = new Uint16Array(BOMB_POSE_COUNT);
    this.bombPoseCell = new Uint16Array(BOMB_POSE_COUNT);
    this.bombPoseDirection = new Uint8Array(BOMB_POSE_COUNT);
    this.bombPoseDepth = new Uint8Array(BOMB_POSE_COUNT);
    this.bombStamp = 0;
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

  qualifiedFire(state) {
    return this.qualifiedFireForSeat(state, 0);
  }

  qualifiedFireForSeat(state, seat, targetMotionBasisPoints = 10000) {
    const a = state.arrays; const otherSeat = seat ^ 1;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (!this.canFire(state, seat)) {
      this.blockedFireCount += 1;
      return 0;
    }
    const targetCloak = a[ARRAY.TANK_CLOAK_UNTIL][otherSeat];
    if (targetCloak !== NONE_FRAME && targetCloak > frame) {
      this.blockedFireCount += 1;
      return 0;
    }
    const own = a[ARRAY.TANK_CELL][seat];
    const enemy = a[ARRAY.TANK_CELL][otherSeat];
    const direction = a[ARRAY.TANK_DIR][seat];
    if (isAhead(state, own, direction, enemy) && rayClear(state, own, enemy)) {
      const shield = a[ARRAY.TANK_SHIELD_UNTIL][otherSeat];
      if (seat === 0 && a[ARRAY.TANK_SHIELD_HITS][otherSeat] > 0 &&
          shield !== NONE_FRAME && shield > frame) {
        this.blockedFireCount += 1;
        return 0;
      }
      this.directFireCount += 1;
      return 1;
    }
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
      const onLikelyRoute = pathDistance + positionObjective <=
        targetObjective + 1;
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
      const ownStar = Math.abs(ox - state.x(star)) +
        Math.abs(oy - state.y(star));
      const enemyStar = Math.abs(ex - state.x(star)) +
        Math.abs(ey - state.y(star));
      thresholdTimes100 = ownStar <= enemyStar + 3 ? 11000 : 7000;
    }
    if (best > thresholdTimes100) {
      this.interceptFireCount += 1;
      return 1;
    }
    this.blockedFireCount += 1;
    return 0;
  }

  allows(engine, row) {
    this.checkCount += 1;
    const action = engine.ourActions[row]; const state = engine.adapter.state;
    if (action === ACTION.THROW_BOMB) {
      this.resourceCheckCount += 1;
      const allowed = this.qualifiedBomb(state);
      if (allowed) this.bombAllowedCount += 1;
      else this.bombBlockedCount += 1;
      return allowed;
    }
    if (action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST) {
      this.resourceCheckCount += 1;
      const allowed = this.qualifiedSkill(state, action);
      if (allowed) this.skillAllowedCount += 1;
      else this.skillBlockedCount += 1;
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
      if (target !== other && tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT)
        count += 1;
    }
    return count;
  }

  target(state, cell, direction) {
    const x = state.x(cell) + DX[direction];
    const y = state.y(cell) + DY[direction];
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
    if (!this.bombStamp) {
      this.bombPoseStamp.fill(0);
      this.bombStamp = 1;
    }
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
    this.bombPoseCell[0] = start;
    this.bombPoseDirection[0] = a[ARRAY.TANK_DIR][seat];
    this.bombPoseDepth[0] = 0;
    this.bombPoseStamp[start * 4 + this.bombPoseDirection[0]] = stamp;
    while (head < tail) {
      const cell = this.bombPoseCell[head];
      const direction = this.bombPoseDirection[head];
      const depth = this.bombPoseDepth[head++];
      if (depth >= limit) continue;
      for (let branch = 0; branch < 3; branch += 1) {
        const nextDirection = branch === 0 ? direction :
          branch === 1 ? (direction + 3) & 3 : (direction + 1) & 3;
        const nextCell = branch === 0 ?
          this.advance(state, cell, direction, boosted ? 2 : 1, blocked) : cell;
        const nextDepth = depth + 1;
        if (!this.bombHits(state, center, nextCell)) return nextDepth;
        const key = nextCell * 4 + nextDirection;
        if (this.bombPoseStamp[key] === stamp || tail >= BOMB_POSE_COUNT) continue;
        this.bombPoseStamp[key] = stamp;
        this.bombPoseCell[tail] = nextCell;
        this.bombPoseDirection[tail] = nextDirection;
        this.bombPoseDepth[tail] = nextDepth;
        tail += 1;
      }
    }
    return 99;
  }

  starDistances(state, star) {
    const distance = this.bombDistance;
    distance.fill(UNREACHABLE, 0, state.cells);
    let head = 0; let tail = 1;
    this.bombQueue[0] = star;
    distance[star] = 0;
    while (head < tail) {
      const cell = this.bombQueue[head++];
      const nextDistance = distance[cell] + 1;
      for (let direction = 0; direction < 4; direction += 1) {
        const next = this.target(state, cell, direction);
        if (!this.walkable(state, next) || distance[next] !== UNREACHABLE) continue;
        distance[next] = nextDistance;
        this.bombQueue[tail++] = next;
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
        cell = this.target(state, cell, direction);
        if (cell === NONE_CELL) break;
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
    if (isAhead(state, enemy, enemyDirection, own) &&
        rayClear(state, enemy, own) && this.canFire(state, 1)) utility -= 600;
    if (ox <= 1 || oy <= 1 || ox >= state.width - 2 || oy >= state.height - 2)
      utility -= 160;
    return utility >= 140 ? 1 : 0;
  }

  qualifiedSkill(state, action) {
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
      fireCheckCount: this.fireCheckCount,
      directFireCount: this.directFireCount,
      interceptFireCount: this.interceptFireCount,
      blockedFireCount: this.blockedFireCount,
      resourceCheckCount: this.resourceCheckCount,
      bombAllowedCount: this.bombAllowedCount,
      bombBlockedCount: this.bombBlockedCount,
      skillAllowedCount: this.skillAllowedCount,
      skillBlockedCount: this.skillBlockedCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { RESOURCE_DOMAIN_MODE, NativeBasePolicyActionDomain };
