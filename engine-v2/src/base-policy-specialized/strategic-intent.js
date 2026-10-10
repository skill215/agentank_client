"use strict";

// Generated specialized BP68 candidate. Do not edit by hand.

// Thin production form of the BP68 strategic-intent contract. It owns only
// the reachable v1-exact classification, v1-action mapping and epoch-based
// continuity path. Oracle comparison and alternate diagnostic policies stay
// outside the production engine.

const { CAPACITY } = require("../generated/fast-config");
const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, TERRAIN, NONE_FRAME, NONE_CELL, DX, DY } = require(
  "../abi/fast-codes");

const BASE_POLICY_INTENT = Object.freeze({
  NONE: 0,
  ATTACK: 1,
  CHASE_STAR: 2,
  EXIT_EDGE: 3,
  FACE_ENEMY: 4,
  EVADE: 5
});

const PATH_UNREACHABLE = 0xffff;

function mix32(hash, value) {
  let result = (hash ^ (value >>> 0)) >>> 0;
  result = (result + ((result << 1) >>> 0) + ((result << 4) >>> 0) +
    ((result << 7) >>> 0) + ((result << 8) >>> 0) +
    ((result << 24) >>> 0)) >>> 0;
  return result;
}

class NativeBasePolicyStrategicIntent {
  constructor(margin = 150) {
    ;
    this.rowBonus = new Int16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowMember = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.pathDistance = new Uint16Array(CAPACITY.MAX_CELLS);
    this.pathQueue = new Uint16Array(CAPACITY.MAX_CELLS);
    this.pathFirst = new Uint16Array(CAPACITY.MAX_CELLS);
    ;
    ;
    ;
    this.committed = BASE_POLICY_INTENT.NONE;
    this.target = NONE_CELL;
    this.lastContextSignature = -1;
    this.contextEpoch = 0;
    this.lastIntent = BASE_POLICY_INTENT.NONE;
    this.lastIntentEpoch = -1;
    this.currentProposed = BASE_POLICY_INTENT.NONE;
    this.currentCommitted = BASE_POLICY_INTENT.NONE;
    this.currentCommittedAction = ACTION.NONE;
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

  contextSignature(engine) {
    const a = engine.adapter.state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    let ownProjectile = 0;
    let enemyProjectile = 0;
    let bombs = 0;
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

  observeContext(engine) {
    const signature = this.contextSignature(engine);
    if (this.lastContextSignature >= 0 && signature !== this.lastContextSignature) {
      this.contextEpoch += 1;
      ;
    }
    this.lastContextSignature = signature;
  }

  commitSelection(action) {
    this.lastIntent = action === this.currentCommittedAction ?
      this.currentCommitted : this.currentProposed;
    this.lastIntentEpoch = this.contextEpoch;
  }

  canFire(state, seat) {
    const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
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

  walkable(state, cell) {
    if (cell === NONE_CELL || cell >= state.cells) return 0;
    const tile = state.arrays[ARRAY.TERRAIN][cell];
    return tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT ? 1 : 0;
  }

  adjacent(state, cell, direction) {
    const x = state.x(cell) + DX[direction];
    const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ?
      NONE_CELL : state.cell(x, y);
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

  minimumProjectileEscapeActions(state, cell, direction, speed,
      bulletDirection) {
    const forward = this.advance(state, cell, direction, speed);
    if (forward !== cell &&
        !this.sameProjectileAxis(state, cell, forward, bulletDirection)) return 1;
    const left = this.advance(state, cell, (direction + 3) & 3, speed);
    const right = this.advance(state, cell, (direction + 1) & 3, speed);
    if (left !== cell &&
        !this.sameProjectileAxis(state, cell, left, bulletDirection) ||
        right !== cell &&
        !this.sameProjectileAxis(state, cell, right, bulletDirection))
      return 2;
    return 99;
  }

  sameProjectileAxis(state, origin, candidate, bulletDirection) {
    return bulletDirection === 0 || bulletDirection === 2 ?
      state.x(origin) === state.x(candidate) :
      state.y(origin) === state.y(candidate);
  }

  quarterTurns(from, to) {
    const difference = Math.abs(from - to);
    return Math.min(difference, 4 - difference);
  }

  attackArrivalFrames(engine, state, seat, wanted, lineOpen, distance) {
    const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const targetSeat = seat ^ 1;
    const shielded = this.activeEffect(a, ARRAY.TANK_SHIELD_UNTIL,
      targetSeat, frame) && a[ARRAY.TANK_SHIELD_HITS][targetSeat] > 0;
    if (!this.canFire(state, seat) || shielded || wanted < 0 || !lineOpen)
      return 99;
    const turns = this.quarterTurns(a[ARRAY.TANK_DIR][seat], wanted);
    const boosted = this.activeEffect(a, ARRAY.TANK_BOOST_UNTIL, seat, frame);
    return Math.max(0, turns - boosted) + ((distance + 1) >> 1);
  }

  singleMuzzleRisk(engine, state, shooter, shooterDirection, target,
      canFire, boosted, targetDirection, targetSpeed) {
    if (!canFire || shooter === NONE_CELL) return 0;
    const distance = engine.manhattan(shooter, target);
    const wanted = engine.directionTo(shooter, target);
    const lineOpen = wanted >= 0 && engine.clearLine(shooter, target);
    if (wanted >= 0 && lineOpen) {
      const turns = this.quarterTurns(shooterDirection, wanted);
      if (turns === 0 && distance <= 2)
        return this.minimumProjectileEscapeActions(state, target,
          targetDirection, targetSpeed, shooterDirection) <= 1 ? 1200 : 50000;
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
    const a = state.arrays;
    const projectile = a[ARRAY.PROJECTILE_CELL][slot];
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

  outerEdgeDistance(state, cell) {
    const x = state.x(cell);
    const y = state.y(cell);
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
    let head = 0;
    let tail = 1;
    this.pathQueue[0] = goal;
    this.pathDistance[goal] = 0;
    while (head < tail) {
      const cell = this.pathQueue[head++];
      const nextDistance = this.pathDistance[cell] + 1;
      for (let direction = 0; direction < 4; direction += 1) {
        const next = this.adjacent(state, cell, direction);
        if (!this.walkable(state, next) ||
            this.pathDistance[next] !== PATH_UNREACHABLE) continue;
        this.pathDistance[next] = nextDistance;
        this.pathQueue[tail++] = next;
      }
    }
    return tail;
  }

  nextStarStep(state, start, star, blocked) {
    if (!this.fillDistanceField(state, star)) return NONE_CELL;
    let best = NONE_CELL;
    let bestDistance = this.pathDistance[start];
    if (bestDistance === PATH_UNREACHABLE) bestDistance = 99;
    for (let direction = 0; direction < 4; direction += 1) {
      const next = this.adjacent(state, start, direction);
      if (next === blocked || !this.walkable(state, next)) continue;
      const distance = this.pathDistance[next] === PATH_UNREACHABLE ?
        99 : this.pathDistance[next];
      if (distance < bestDistance) {
        bestDistance = distance;
        best = next;
      }
    }
    return best;
  }

  nextAttackLaneStep(engine, state, start, enemy) {
    this.pathDistance.fill(PATH_UNREACHABLE, 0, state.cells);
    if (!this.walkable(state, start)) return NONE_CELL;
    let head = 0;
    let tail = 1;
    this.pathQueue[0] = start;
    this.pathFirst[0] = start;
    this.pathDistance[start] = 0;
    while (head < tail) {
      const cell = this.pathQueue[head];
      const first = this.pathFirst[head++];
      if (cell !== start && engine.clearLine(cell, enemy)) return first;
      for (let direction = 0; direction < 4; direction += 1) {
        const next = this.adjacent(state, cell, direction);
        if (next === enemy || !this.walkable(state, next) ||
            this.pathDistance[next] !== PATH_UNREACHABLE) continue;
        this.pathDistance[next] = this.pathDistance[cell] + 1;
        this.pathQueue[tail] = next;
        this.pathFirst[tail] = first === start ? next : first;
        tail += 1;
      }
    }
    return NONE_CELL;
  }

  actionForStep(state, start, direction, step) {
    const sx = state.x(start);
    const sy = state.y(start);
    const tx = state.x(step);
    const ty = state.y(step);
    const wanted = tx > sx ? 1 : tx < sx ? 3 : ty > sy ? 2 : 0;
    if (wanted === direction) return ACTION.GO;
    return wanted === ((direction + 3) & 3) ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
  }

  v1ActionForIntent(engine, intent) {
    if (intent === BASE_POLICY_INTENT.NONE || intent === BASE_POLICY_INTENT.EVADE)
      return ACTION.NONE;
    const state = engine.adapter.state;
    const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1];
    const direction = a[ARRAY.TANK_DIR][0];
    let step = NONE_CELL;
    let wanted = -1;
    if (intent === BASE_POLICY_INTENT.CHASE_STAR) {
      const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
      if (star !== NONE_CELL) step = this.nextStarStep(state, own, star, enemy);
    } else if (intent === BASE_POLICY_INTENT.EXIT_EDGE) {
      let bestEdge = this.outerEdgeDistance(state, own);
      let bestOpen = -1;
      for (let candidateDirection = 0; candidateDirection < 4;
          candidateDirection += 1) {
        const candidate = this.adjacent(state, own, candidateDirection);
        if (candidate === enemy || !this.walkable(state, candidate)) continue;
        const edge = this.outerEdgeDistance(state, candidate);
        const open = this.openNeighborCount(state, candidate);
        if (edge > bestEdge || edge === bestEdge && open > bestOpen) {
          bestEdge = edge;
          bestOpen = open;
          step = candidate;
        }
      }
    } else if (intent === BASE_POLICY_INTENT.ATTACK ||
        intent === BASE_POLICY_INTENT.FACE_ENEMY) {
      wanted = engine.directionTo(own, enemy);
      if (wanted < 0) step = this.nextAttackLaneStep(engine, state, own, enemy);
    }
    if (step !== NONE_CELL) return this.actionForStep(state, own, direction, step);
    if (wanted < 0) return ACTION.NONE;
    if (wanted === direction)
      return intent === BASE_POLICY_INTENT.ATTACK && this.canFire(state, 0) ?
        ACTION.FIRE : ACTION.GO;
    return wanted === ((direction + 3) & 3) ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
  }

  proposed(engine) {
    const state = engine.adapter.state;
    const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1];
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
    const enemyOverloaded = this.activeEffect(a, ARRAY.TANK_OVERLOAD_UNTIL, 1,
      frame);
    const muzzle = this.muzzleRisk(engine, state, enemy, enemyDirection, own,
      enemyCanFire, enemyBoosted, ownDirection, ownSpeed, enemyOverloaded);
    if (incoming >= 1200 || muzzle >= 10000) return BASE_POLICY_INTENT.EVADE;
    const distance = engine.manhattan(own, enemy);
    const mine = engine.directionTo(own, enemy);
    const theirs = engine.directionTo(enemy, own);
    const line = mine >= 0 && engine.clearLine(own, enemy);
    const myFrames = this.attackArrivalFrames(engine, state, 0,
      mine, line, distance);
    const enemyFrames = this.attackArrivalFrames(engine, state, 1,
      theirs, line, distance);
    if (myFrames < enemyFrames && myFrames <= 3) return BASE_POLICY_INTENT.ATTACK;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const edge = this.outerEdgeDistance(state, own);
    if (edge <= 1 && star === NONE_CELL) return BASE_POLICY_INTENT.EXIT_EDGE;
    if (star !== NONE_CELL) return BASE_POLICY_INTENT.CHASE_STAR;
    return edge <= 2 ? BASE_POLICY_INTENT.EXIT_EDGE : BASE_POLICY_INTENT.FACE_ENEMY;
  }

  prepare(engine, count) {
    ;
    this.rowBonus.fill(0, 0, count);
    this.rowMember.fill(0, 0, count);
    this.observeContext(engine);
    const proposed = this.proposed(engine);
    let intent = proposed;
    if (proposed !== BASE_POLICY_INTENT.ATTACK &&
        proposed !== BASE_POLICY_INTENT.EVADE &&
        this.lastIntent !== BASE_POLICY_INTENT.NONE &&
        this.lastIntentEpoch === this.contextEpoch) {
      intent = this.lastIntent;
      ;
    }
    this.currentProposed = proposed;
    this.currentCommitted = intent;
    const star = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (intent !== this.committed) ;
    this.committed = intent;
    this.target = intent === BASE_POLICY_INTENT.CHASE_STAR ? star : NONE_CELL;
    if (intent === BASE_POLICY_INTENT.ATTACK) ;
    else if (intent === BASE_POLICY_INTENT.CHASE_STAR) ;
    else if (intent === BASE_POLICY_INTENT.EXIT_EDGE) ;
    else if (intent === BASE_POLICY_INTENT.FACE_ENEMY) ;
    else if (intent === BASE_POLICY_INTENT.EVADE) ;
    const mapped = this.v1ActionForIntent(engine, intent);
    this.currentCommittedAction = mapped;
    ;
    let found = 0;
    for (let row = 0; row < count; row += 1)
      if (engine.ourActions[row] === mapped && mapped !== ACTION.NONE) {
        this.rowBonus[row] = 150;
        this.rowMember[row] = 1;
        ;
        found = 1;
      }
    if (!found && mapped !== ACTION.NONE) ;
  }

  bonus(row) { return this.rowBonus[row] | 0; }
  member(row) { return this.rowMember[row] | 0; }

  
}

module.exports = { BASE_POLICY_INTENT, NativeBasePolicyStrategicIntent };
