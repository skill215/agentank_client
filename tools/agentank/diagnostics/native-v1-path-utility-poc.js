"use strict";

// Diagnostic-only FastState port of V1's path-local actionScore. The normal
// leaf describes the reached position; this component describes the quality
// of the actions used to reach it.

const { CAPACITY } = require("../../../engine-v2/src/generated/fast-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, SKILL, TERRAIN, NONE_FRAME, NONE_CELL, DX, DY } = require(
  "../../../engine-v2/src/abi/fast-codes");

class NativeV1PathUtilityPoc {
  constructor(leafEvaluator = null, options = {}) {
    this.leaf = leafEvaluator;
    this.enableFire = options.fire !== false;
    this.enableBomb = options.bomb !== false;
    this.enableTurn = options.turn !== false;
    this.enableStun = options.stun !== false;
    this.rootTurnOnly = options.rootTurnOnly === true;
    this.reversalOnly = options.reversalOnly === true;
    this.exactFireTransition = options.exactFireTransition === true;
    this.responseConditionedFire = options.responseConditionedFire === true;
    this.goEdgeTransition = options.goEdgeTransition === true;
    this.enemyActionCounts = new Uint32Array(4);
    this.enemyActionCounts.fill(1);
    this.enemyStationaryStreak = 0;
    this.callCount = 0; this.fireCount = 0; this.directFireCount = 0;
    this.dirtFireCount = 0; this.emptyFireCount = 0; this.bombCount = 0;
    this.turnCount = 0; this.reversalCount = 0; this.stunCount = 0;
    this.goCount = 0; this.goEdgePenaltyCount = 0; this.goEdgeReliefCount = 0;
    this.exactFireTransitionCount = 0;
    this.responseFirePrepareCount = 0;
    this.responseFireAppliedCount = 0;
    this.responseFirePositiveCount = 0;
    this.responseFireDeltaTotal = 0;
    this.hotAllocationCount = 0;
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

  distance(state, left, right) {
    return Math.abs(state.x(left) - state.x(right)) +
      Math.abs(state.y(left) - state.y(right));
  }

  alignedDirection(state, from, target) {
    const fx = state.x(from); const fy = state.y(from);
    const tx = state.x(target); const ty = state.y(target);
    if (fx === tx) return ty < fy ? 0 : ty > fy ? 2 : -1;
    if (fy === ty) return tx > fx ? 1 : tx < fx ? 3 : -1;
    return -1;
  }

  scanRay(state, from, direction, target) {
    let cell = this.target(state, from, direction); let distance = 1;
    while (cell !== NONE_CELL) {
      if (cell === target) return (1 << 16) | distance;
      const tile = state.arrays[ARRAY.TERRAIN][cell];
      if (tile === TERRAIN.WALL) return (2 << 16) | distance;
      if (tile === TERRAIN.DIRT) return (3 << 16) | distance;
      cell = this.target(state, cell, direction); distance += 1;
    }
    return (4 << 16) | Math.min(0xffff, distance);
  }

  mobility(state, seat) {
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][seat];
    const blocked = a[ARRAY.TANK_CELL][seat ^ 1]; let count = 0;
    for (let direction = 0; direction < 4; direction += 1)
      count += this.walkable(state, this.target(state, cell, direction), blocked);
    return count;
  }

  edgeDistance(state, cell) {
    const x = state.x(cell); const y = state.y(cell);
    return Math.max(0, Math.min(x - 1, state.width - 2 - x,
      y - 1, state.height - 2 - y));
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

  lateralExitCount(state, target, shotDirection, blocked) {
    const first = (shotDirection + 1) & 3; const second = (shotDirection + 3) & 3;
    return this.walkable(state, this.target(state, target, first), blocked) +
      this.walkable(state, this.target(state, target, second), blocked);
  }

  longRangeHitScore(state, distance, shotDirection) {
    if (distance <= 4) return 0;
    const a = state.arrays; const target = a[ARRAY.TANK_CELL][1];
    if (a[ARRAY.TANK_SHIELD_HITS][1] > 0) return 0;
    const targetDirection = a[ARRAY.TANK_DIR][1];
    const forward = this.target(state, target, targetDirection);
    const moving = this.walkable(state, forward, a[ARRAY.TANK_CELL][0]);
    const parallel = (targetDirection & 1) === (shotDirection & 1);
    const exits = this.lateralExitCount(state, target, shotDirection,
      a[ARRAY.TANK_CELL][0]);
    const arrival = (distance + 1) >> 1; let chance = 1400;
    if (parallel && moving) chance += 2700;
    chance += exits === 0 ? 3600 : exits === 1 ? 1600 : 0;
    if (arrival <= 3) chance += 1800;
    else if (arrival >= 6) chance -= 600;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star !== NONE_CELL && moving &&
        this.distance(state, forward, star) < this.distance(state, target, star))
      chance += 1200;
    chance = Math.max(500, Math.min(9200, chance));
    return Math.min(260, Math.max(0,
      Math.trunc(chance * 380 / 10000) - arrival * 6));
  }

  setOpponentContext(go, left, right, fire, stationaryStreak) {
    this.enemyActionCounts[0] = Math.max(1, go | 0);
    this.enemyActionCounts[1] = Math.max(1, left | 0);
    this.enemyActionCounts[2] = Math.max(1, right | 0);
    this.enemyActionCounts[3] = Math.max(1, fire | 0);
    this.enemyStationaryStreak = Math.max(0, stationaryStreak | 0);
  }

  enemyMotionBasisPoints() {
    const streak = this.enemyStationaryStreak;
    const streakFactor = streak >= 12 ? 600 : streak >= 8 ? 1200 :
      streak >= 5 ? 3000 : streak >= 3 ? 6000 : 10000;
    const total = this.enemyActionCounts[0] + this.enemyActionCounts[1] +
      this.enemyActionCounts[2] + this.enemyActionCounts[3];
    const observed = Math.max(800, Math.min(10000,
      Math.trunc(this.enemyActionCounts[0] * 40000 / total)));
    return Math.min(streakFactor, observed);
  }

  quarterTurns(from, to) {
    const difference = Math.abs(from - to);
    return Math.min(difference, 4 - difference);
  }

  predictiveInterceptUtility(state) {
    const a = state.arrays; const shooter = a[ARRAY.TANK_CELL][0];
    const direction = a[ARRAY.TANK_DIR][0];
    const target = a[ARRAY.TANK_CELL][1]; const targetDir = a[ARRAY.TANK_DIR][1];
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const boosted = a[ARRAY.TANK_BOOST_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_BOOST_UNTIL][1] > frame;
    const targetSpeed = boosted ? 2 : 1;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const objective = star === NONE_CELL ? shooter : star;
    const targetToObjective = this.distance(state, target, objective);
    let cell = shooter; let best = -32768;
    for (let distance = 1; distance <= 18; distance += 1) {
      cell = this.target(state, cell, direction);
      if (cell === NONE_CELL) break;
      const tile = a[ARRAY.TERRAIN][cell];
      if (tile !== TERRAIN.OPEN && tile !== TERRAIN.GRASS) break;
      if (cell === target) break;
      const pathDistance = this.distance(state, target, cell);
      const arrivalFrame = (distance + 1) >> 1;
      const dx = state.x(cell) - state.x(target);
      const dy = state.y(cell) - state.y(target);
      const firstDirection = dx > 0 ? 1 : dx < 0 ? 3 : dy > 0 ? 2 : 0;
      const turnFrames = this.quarterTurns(targetDir, firstDirection);
      const reachFrame = turnFrames + Math.trunc(
        (pathDistance + targetSpeed - 1) / targetSpeed);
      const timingDelta = Math.abs(reachFrame - arrivalFrame);
      if (reachFrame > arrivalFrame + 1 || timingDelta > 2) continue;
      const positionToObjective = this.distance(state, cell, objective);
      const onLikelyRoute = pathDistance + positionToObjective <=
        targetToObjective + 1;
      if (!onLikelyRoute && timingDelta > 0) continue;
      let chance = 1200;
      if (timingDelta === 0) chance += 3400;
      else if (timingDelta === 1) chance += 1700;
      if (onLikelyRoute) chance += 2400;
      if (firstDirection === targetDir) chance += 1600;
      chance = Math.min(8800, chance);
      const value = Math.trunc(chance * 320 / 10000) - arrivalFrame * 7;
      if (value > best) best = value;
    }
    if (best === -32768) return 0;
    return Math.trunc(best * this.enemyMotionBasisPoints() / 10000);
  }

  distanceToShotLane(state, cell, shooter, direction) {
    return direction === 0 || direction === 2 ?
      Math.abs(state.x(cell) - state.x(shooter)) :
      Math.abs(state.y(cell) - state.y(shooter));
  }

  prepareAppliedTransition(state, ownAction) {
    if (!this.responseConditionedFire || ownAction !== ACTION.FIRE ||
        !this.canFire(state, 0)) return 0xffffffff;
    this.responseFirePrepareCount += 1;
    const a = state.arrays; const shooter = a[ARRAY.TANK_CELL][0];
    const target = a[ARRAY.TANK_CELL][1]; const direction = a[ARRAY.TANK_DIR][0];
    const base = Math.max(-32767, Math.min(32767,
      this.predictiveInterceptUtility(state)));
    const beforeDistance = Math.min(255,
      this.distanceToShotLane(state, target, shooter, direction));
    return (((base + 32768) << 8) | beforeDistance) >>> 0;
  }

  responseEnemyAction(action) {
    if (action === ACTION.GO || action === ACTION.BOOST_LEFT_GO ||
        action === ACTION.BOOST_RIGHT_GO) return ACTION.GO;
    if (action === ACTION.FIRE || action === ACTION.BOOST_LEFT_FIRE ||
        action === ACTION.BOOST_RIGHT_FIRE) return ACTION.FIRE;
    if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT ||
        action === ACTION.BOOST_LEFT_TURN_LEFT ||
        action === ACTION.BOOST_LEFT_TURN_RIGHT ||
        action === ACTION.BOOST_RIGHT_TURN_LEFT ||
        action === ACTION.BOOST_RIGHT_TURN_RIGHT) return ACTION.TURN_LEFT;
    return action;
  }

  scoreAppliedTransition(state, ownAction, enemyAction, enemyChance, token) {
    if (!this.responseConditionedFire || ownAction !== ACTION.FIRE ||
        token === 0xffffffff) return 0;
    this.responseFireAppliedCount += 1;
    const base = (token >>> 8) - 32768;
    let score;
    if (base <= 25) score = Math.max(0, base);
    else {
      const a = state.arrays; const shooter = a[ARRAY.TANK_CELL][0];
      const target = a[ARRAY.TANK_CELL][1]; const direction = a[ARRAY.TANK_DIR][0];
      const ray = this.scanRay(state, shooter, direction, target);
      if ((ray >>> 16) === 1) {
        const arrival = ((ray & 0xffff) + 1) >> 1;
        score = Math.min(220, Math.trunc(Math.max(base * 3 / 4, 95) +
          Math.max(0, 70 - arrival * 14)));
      } else {
        const beforeDistance = token & 255;
        const afterDistance = this.distanceToShotLane(state, target,
          shooter, direction);
        const action = this.responseEnemyAction(enemyAction);
        let multiplier = 3500;
        if (action === ACTION.GO) {
          if (afterDistance < beforeDistance) multiplier = 10000;
          else if (afterDistance === beforeDistance &&
              ((a[ARRAY.TANK_DIR][1] ^ direction) & 1) === 0)
            multiplier = 5500;
          else multiplier = enemyChance !== 0 ? 2800 : 2000;
        } else if (action === ACTION.TURN_LEFT) multiplier = 3800;
        else if (action === ACTION.FIRE) multiplier = 3000;
        score = Math.min(180, Math.max(0,
          Math.trunc(base * multiplier / 10000)));
      }
    }
    if (score > 0) this.responseFirePositiveCount += 1;
    this.responseFireDeltaTotal += score;
    return score;
  }

  fireUtility(state) {
    if (!this.canFire(state, 0)) return 0;
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1]; const direction = a[ARRAY.TANK_DIR][0];
    const ray = this.scanRay(state, own, direction, enemy);
    const kind = ray >>> 16; const distance = ray & 0xffff;
    if (kind === 1) {
      this.directFireCount += 1;
      if (a[ARRAY.TANK_SHIELD_HITS][1] > 0) return -180;
      return 260 + Math.max(0, 120 - distance * 10) +
        this.longRangeHitScore(state, distance, direction);
    }
    if (kind === 3) {
      this.dirtFireCount += 1; let score = -50 - distance * 8;
      if (this.alignedDirection(state, own, enemy) === direction) score += 180;
      const enemyRay = this.scanRay(state, enemy, a[ARRAY.TANK_DIR][1], own);
      if ((enemyRay >>> 16) === 1 && this.canFire(state, 1)) score -= 120;
      return Math.min(220, score);
    }
    this.emptyFireCount += 1; let score = -30;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star !== NONE_CELL && a[ARRAY.TANK_STARS][0] <= a[ARRAY.TANK_STARS][1] &&
        this.distance(state, own, star) <= this.distance(state, enemy, star) + 3)
      score -= 90;
    return score;
  }

  fireTransitionUtility(state) {
    this.exactFireTransitionCount += 1;
    if (!this.canFire(state, 0)) return 0;
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1]; const direction = a[ARRAY.TANK_DIR][0];
    const ray = this.scanRay(state, own, direction, enemy);
    const kind = ray >>> 16; const distance = ray & 0xffff;
    // V1 does not add fireUtility for an already aligned target. The reached
    // leaf carries the projectile value; actionScore adds only the verified
    // long-range conversion term.
    if (kind === 1) return this.longRangeHitScore(state, distance, direction);
    if (kind === 3) return Math.min(220, this.fireUtility(state));
    let score = -30; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star !== NONE_CELL && a[ARRAY.TANK_STARS][0] <= a[ARRAY.TANK_STARS][1] &&
        this.distance(state, own, star) <= this.distance(state, enemy, star) + 3)
      score -= 90;
    // The response-conditioned intercept term depends on the post-move enemy
    // pose and stun chance. It belongs in an applied-transition hook rather
    // than being guessed once for all chance branches.
    return score;
  }

  goEdgeUtility(state) {
    this.goCount += 1; const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_STUN_UNTIL][0] !== NONE_FRAME &&
        a[ARRAY.TANK_STUN_UNTIL][0] > frame) return 0;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const direction = a[ARRAY.TANK_DIR][0];
    const speed = a[ARRAY.TANK_BOOST_UNTIL][0] !== NONE_FRAME &&
      a[ARRAY.TANK_BOOST_UNTIL][0] > frame ? 2 : 1;
    const next = this.leaf && typeof this.leaf.advance === "function" ?
      this.leaf.advance(state, own, direction, speed, enemy) : own;
    const before = this.edgeDistance(state, own); const after = this.edgeDistance(state, next);
    if (after < before) {
      let cost = after <= 1 ?
        (a[ARRAY.TANK_STARS][0] > a[ARRAY.TANK_STARS][1] ? 190 : 105) :
        (a[ARRAY.TANK_STARS][0] > a[ARRAY.TANK_STARS][1] ? 90 : 50);
      if (this.distance(state, next, enemy) <= 4) cost += 55;
      this.goEdgePenaltyCount += 1; return -(before - after) * cost;
    }
    if (after > before && before <= 2) {
      this.goEdgeReliefCount += 1; return 28;
    }
    return 0;
  }

  bombHits(state, center, candidate) {
    if (this.leaf && typeof this.leaf.bombHits === "function")
      return this.leaf.bombHits(state, center, candidate);
    const cx = state.x(center); const cy = state.y(center);
    const tx = state.x(candidate); const ty = state.y(candidate);
    return (cx === tx && Math.abs(cy - ty) <= 2) ||
      (cy === ty && Math.abs(cx - tx) <= 2) ? 1 : 0;
  }

  activeProjectile(state, owner) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === owner) return 1;
    return 0;
  }

  bombPlacementUtility(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_BOMB_READY][0] > frame) return 0;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const escape = this.leaf && typeof this.leaf.minimumBombEscape === "function" ?
      this.leaf.minimumBombEscape(state, 0, own, 8) : 1;
    if (escape > 6) return -24000;
    let score = 0; const terrain = a[ARRAY.TERRAIN];
    for (let direction = 0; direction < 4; direction += 1) {
      let cell = own;
      for (let step = 1; step <= 2; step += 1) {
        cell = this.target(state, cell, direction); if (cell === NONE_CELL) break;
        if (terrain[cell] === TERRAIN.WALL) break;
        if (terrain[cell] === TERRAIN.DIRT) { score += 45; break; }
      }
    }
    if (this.bombHits(state, own, enemy)) score += 190;
    const enemyOpen = this.mobility(state, 1);
    if (enemyOpen <= 2 && this.distance(state, own, enemy) <= 4)
      score += (3 - enemyOpen) * 90;
    const stunUntil = a[ARRAY.TANK_STUN_UNTIL][1];
    if (stunUntil !== NONE_FRAME && stunUntil > frame)
      score += Math.min(180, (stunUntil - frame) * 24);
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star !== NONE_CELL && this.bombHits(state, own, star))
      score += this.distance(state, enemy, star) <=
        this.distance(state, own, star) ? 90 : -80;
    const enemySkill = a[ARRAY.TANK_SKILL][1];
    if (a[ARRAY.TANK_SKILL_READY][1] <= frame &&
        (enemySkill === SKILL.TELEPORT || enemySkill === SKILL.BOOST ||
         enemySkill === SKILL.SHIELD)) score = Math.trunc(score * 45 / 100);
    const ownBombPressure = this.leaf && typeof this.leaf.bombPressure === "function" ?
      this.leaf.bombPressure(state, 0) : 0;
    if (this.activeProjectile(state, 1) || ownBombPressure > 0) score -= 500;
    if (this.leaf && typeof this.leaf.muzzleRisk === "function") {
      const wanted = this.leaf.alignedDirection(state, enemy, own);
      const line = wanted >= 0 && this.leaf.rayClear(state, enemy, own);
      if (this.leaf.muzzleRisk(state, 1, wanted, line,
        this.distance(state, own, enemy)) >= 1800) score -= 600;
    }
    if (this.fireUtility(state) >= 400) score -= 180;
    if (this.edgeDistance(state, own) <= 1) score -= 160;
    return score;
  }

  scoreTransition(state, ownAction, enemyAction, previousAction, turnStreak, top = 1) {
    this.callCount += 1; let score = 0;
    if (ownAction === ACTION.FIRE && this.enableFire) {
      this.fireCount += 1; score += this.exactFireTransition ?
        this.fireTransitionUtility(state) : this.fireUtility(state);
    }
    if (ownAction === ACTION.GO && this.goEdgeTransition)
      score += this.goEdgeUtility(state);
    if (ownAction === ACTION.THROW_BOMB && this.enableBomb) {
      this.bombCount += 1; score += this.bombPlacementUtility(state);
    }
    if (ownAction === ACTION.CAST_STUN && this.enableStun) {
      this.stunCount += 1; score -= 20;
    }
    if (this.enableTurn &&
        (ownAction === ACTION.TURN_LEFT || ownAction === ACTION.TURN_RIGHT)) {
      if (this.rootTurnOnly && top > 1) return score;
      const reversed = (previousAction === ACTION.TURN_LEFT &&
        ownAction === ACTION.TURN_RIGHT) ||
        (previousAction === ACTION.TURN_RIGHT && ownAction === ACTION.TURN_LEFT);
      if (this.reversalOnly) {
        if (reversed) { this.reversalCount += 1; score -= 110; }
        return score;
      }
      this.turnCount += 1; const next = turnStreak + 1;
      score -= 12 + next * 10;
      if (reversed) {
        score -= 110; this.reversalCount += 1;
      }
      if (next === 2) score -= 60;
      else if (next === 3) score -= 180;
      else if (next >= 4) score -= 360;
    }
    return score;
  }

  summary() {
    return { semantics: "V1_PATH_LOCAL_ACTION_UTILITY_FASTSTATE",
      enableFire: this.enableFire, enableBomb: this.enableBomb,
      enableTurn: this.enableTurn, enableStun: this.enableStun,
      exactFireTransition: this.exactFireTransition,
      responseConditionedFire: this.responseConditionedFire,
      goEdgeTransition: this.goEdgeTransition,
      rootTurnOnly: this.rootTurnOnly,
      reversalOnly: this.reversalOnly,
      callCount: this.callCount, fireCount: this.fireCount,
      directFireCount: this.directFireCount, dirtFireCount: this.dirtFireCount,
      emptyFireCount: this.emptyFireCount, bombCount: this.bombCount,
      turnCount: this.turnCount, reversalCount: this.reversalCount,
      stunCount: this.stunCount, goCount: this.goCount,
      goEdgePenaltyCount: this.goEdgePenaltyCount,
      goEdgeReliefCount: this.goEdgeReliefCount,
      exactFireTransitionCount: this.exactFireTransitionCount,
      responseFirePrepareCount: this.responseFirePrepareCount,
      responseFireAppliedCount: this.responseFireAppliedCount,
      responseFirePositiveCount: this.responseFirePositiveCount,
      responseFireDeltaTotal: this.responseFireDeltaTotal,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { NativeV1PathUtilityPoc };
