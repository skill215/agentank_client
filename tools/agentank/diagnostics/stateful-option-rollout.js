"use strict";

// Diagnostic-only bounded option evaluator.  This module deliberately does
// not own an action and does not publish Hard/Proof facts.  It asks a smaller
// causal question: after a root candidate, what does one deterministic,
// stateful four-frame continuation do to the physical state?

const { FastKernel } = require("../../../engine-v2/src/fast/kernel");
const { MOVE_CONTEST_VARIANT, MoveContestVariantKernel } = require(
  "./move-contest-variant-kernel");
const { HazardKernel } = require("../../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../../engine-v2/src/fast/hard-gate");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { CAPACITY, RULE } = require("../../../engine-v2/src/generated/fast-config");
const { SEARCH_CAPACITY } =
  require("../../../engine-v2/src/generated/search-config");
const { ACTION, FAST_STATUS, HARD_STATUS, TERMINAL, TERRAIN, CHANCE,
  NONE_FRAME, NONE_CELL, DX, DY } =
  require("../../../engine-v2/src/abi/fast-codes");

const OPTION_KIND = Object.freeze({ WAIT: 0, POSITION: 1, ATTACK: 2, ZONE: 3,
  DEFENSE: 4 });
const ROLLOUT_INCOMPLETE_REASON = Object.freeze({
  NONE: 0,
  UNKNOWN: 1,
  INVALID_INPUT: 2,
  APPLY_UNSUPPORTED_RULE: FAST_STATUS.UNSUPPORTED_RULE,
  APPLY_INCOMPLETE_STATE: FAST_STATUS.INCOMPLETE_STATE,
  APPLY_ENTITY_CAPACITY: FAST_STATUS.INCOMPLETE_ENTITY_CAPACITY,
  APPLY_EVENT_CAPACITY: FAST_STATUS.INCOMPLETE_EVENT_CAPACITY,
  APPLY_DELTA_CAPACITY: FAST_STATUS.INCOMPLETE_DELTA_CAPACITY,
  APPLY_OBSERVATION_CAPACITY: FAST_STATUS.INCOMPLETE_OBSERVATION_CAPACITY,
  APPLY_INTERNAL_CONSISTENCY: FAST_STATUS.INCOMPLETE_INTERNAL_CONSISTENCY,
  APPLY_EXECUTION_ERROR: FAST_STATUS.EXECUTION_ERROR,
  HARD_INCOMPLETE: 11,
  ROOT_RESTORE: 12,
  COUNT: 13
});
const ROLLOUT_UNSUPPORTED_SITE = Object.freeze({
  NONE: 0,
  PREFLIGHT_SHARED_RESOURCE: 1,
  MOVE_CONTEST: 2,
  SKILL_COOLDOWN: 3,
  TELEPORT_TARGET: 4,
  BOOST_INACTIVE: 5,
  STAR_CONTEST: 6,
  TERMINAL_RUNTIME_TIE: 7,
  UNKNOWN: 8,
  COUNT: 9
});
const OPTION_HORIZON = 4;
const ESCAPE_ACTIONS = Object.freeze([ACTION.GO, ACTION.TURN_LEFT,
  ACTION.TURN_RIGHT]);
const ENEMY_DEBUFF_ARRAYS = Object.freeze([ARRAY.TANK_FROZEN_UNTIL,
  ARRAY.TANK_STUN_UNTIL, ARRAY.TANK_POISON_UNTIL]);

function isPositionAction(action) {
  return action === ACTION.GO || action === ACTION.TURN_LEFT ||
    action === ACTION.TURN_RIGHT ||
    action >= ACTION.BOOST_LEFT_GO && action <= ACTION.BOOST_RIGHT_BOMB;
}

function optionKind(action) {
  if (action === ACTION.NONE) return OPTION_KIND.WAIT;
  if (isPositionAction(action)) return OPTION_KIND.POSITION;
  if (action === ACTION.THROW_BOMB) return OPTION_KIND.ZONE;
  if (action === ACTION.CAST_SHIELD || action === ACTION.CAST_CLOAK ||
      action === ACTION.CAST_BOOST || action === ACTION.CAST_TELEPORT)
    return OPTION_KIND.DEFENSE;
  return OPTION_KIND.ATTACK;
}

class StatefulOptionRollout {
  constructor(maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS,
      horizon = OPTION_HORIZON, options = null) {
    this.maxActions = maxActions; this.horizon = horizon;
    this.moveContestVariant = options?.moveContestVariant ||
      MOVE_CONTEST_VARIANT.FAIL_CLOSED;
    this.state = null; this.kernel = null; this.hazard = null; this.hard = null;
    this.kind = new Uint8Array(maxActions);
    this.physicalComplete = new Uint8Array(maxActions);
    this.rootRestored = new Uint8Array(maxActions);
    this.frames = new Uint8Array(maxActions);
    this.hardFatal = new Uint8Array(maxActions);
    this.terminalReached = new Uint8Array(maxActions);
    this.terminalUtility = new Uint8Array(maxActions);
    this.ownCrashed = new Uint8Array(maxActions);
    this.enemyCrashed = new Uint8Array(maxActions);
    this.starGain = new Int16Array(maxActions);
    this.starDelta = new Int16Array(maxActions);
    // Keep the physical star distance for every policy row.  objectiveProgress
    // is intentionally option-relative (ATTACK measures enemy approach while
    // POSITION measures star approach), so comparing it across option kinds is
    // a category error.
    this.starDistance = new Uint16Array(maxActions);
    this.objectiveProgress = new Int16Array(maxActions);
    this.enemyDistance = new Uint16Array(maxActions);
    this.mobility = new Uint8Array(maxActions);
    this.ownProjectileCount = new Uint8Array(maxActions);
    this.projectileThreat = new Uint8Array(maxActions);
    this.ownBombCount = new Uint8Array(maxActions);
    this.enemyDebuffCount = new Uint8Array(maxActions);
    this.ownFireLane = new Uint8Array(maxActions);
    this.enemyFireLane = new Uint8Array(maxActions);
    this.enemyMobility = new Uint8Array(maxActions);
    // Endpoint fields above preserve the original policy semantics. These
    // temporal fields are diagnostic-only and retain pressure that existed
    // during the rollout but disappeared before the horizon endpoint.
    this.projectileThreatFrames = new Uint8Array(maxActions);
    this.minimumEnemyMobility = new Uint8Array(maxActions);
    this.enemyMobilityIntegral = new Uint16Array(maxActions);
    this.ownFireLaneFrames = new Uint8Array(maxActions);
    this.enemyFireLaneFrames = new Uint8Array(maxActions);
    this.sequenceAction = new Uint8Array(maxActions * horizon);
    this.sequenceArgument = new Uint16Array(maxActions * horizon);
    this.sequenceArgument.fill(NONE_CELL);
    this.incompleteReason = new Uint8Array(maxActions);
    this.incompleteStep = new Uint8Array(maxActions);
    this.incompleteStep.fill(0xff);
    this.incompleteStatus = new Uint8Array(maxActions);
    this.incompleteUnsupportedSite = new Uint8Array(maxActions);
    this.incompleteOwnAction = new Uint8Array(maxActions);
    this.incompleteEnemyAction = new Uint8Array(maxActions);
    this.incompleteOwnAction.fill(0xff);
    this.incompleteEnemyAction.fill(0xff);
    this.incompleteReasonCount = new Uint32Array(
      ROLLOUT_INCOMPLETE_REASON.COUNT);
    this.unsupportedSiteCount = new Uint32Array(
      ROLLOUT_UNSUPPORTED_SITE.COUNT);
    this.kernelUnsupportedSite = ROLLOUT_UNSUPPORTED_SITE.NONE;
    this.diagnosticFailureStackAllocationCount = 0;
    this.transitionCount = 0; this.incompleteCount = 0;
    this.hardFatalCount = 0; this.rootRestoreFailureCount = 0;
    this.hotAllocationCount = 0;
  }

  clearIncomplete(row) {
    this.incompleteReason[row] = ROLLOUT_INCOMPLETE_REASON.NONE;
    this.incompleteStep[row] = 0xff; this.incompleteStatus[row] = 0;
    this.incompleteUnsupportedSite[row] = ROLLOUT_UNSUPPORTED_SITE.NONE;
    this.incompleteOwnAction[row] = 0xff;
    this.incompleteEnemyAction[row] = 0xff;
    this.projectileThreatFrames[row] = 0;
    this.minimumEnemyMobility[row] = 0xff;
    this.enemyMobilityIntegral[row] = 0;
    this.ownFireLaneFrames[row] = 0;
    this.enemyFireLaneFrames[row] = 0;
  }

  observeTemporal(row) {
    const enemyMobility = this.mobilityCount(1);
    if (enemyMobility < this.minimumEnemyMobility[row])
      this.minimumEnemyMobility[row] = enemyMobility;
    this.enemyMobilityIntegral[row] += enemyMobility;
    if (this.approachingProjectile(1) >= 0)
      this.projectileThreatFrames[row] += 1;
    if (this.fireLane(0)) this.ownFireLaneFrames[row] += 1;
    if (this.fireLane(1)) this.enemyFireLaneFrames[row] += 1;
  }

  markIncomplete(row, reason, step, status = 0, ownAction = 0xff,
      enemyAction = 0xff) {
    if (this.incompleteReason[row] !== ROLLOUT_INCOMPLETE_REASON.NONE) return;
    const normalized = reason > 0 && reason < ROLLOUT_INCOMPLETE_REASON.COUNT ?
      reason : ROLLOUT_INCOMPLETE_REASON.UNKNOWN;
    this.incompleteReason[row] = normalized;
    this.incompleteStep[row] = step >= 0 && step < 0xff ? step : 0xff;
    this.incompleteStatus[row] = status;
    this.incompleteOwnAction[row] = ownAction;
    this.incompleteEnemyAction[row] = enemyAction;
    if (normalized === ROLLOUT_INCOMPLETE_REASON.APPLY_UNSUPPORTED_RULE) {
      const site = this.kernelUnsupportedSite > ROLLOUT_UNSUPPORTED_SITE.NONE &&
        this.kernelUnsupportedSite < ROLLOUT_UNSUPPORTED_SITE.COUNT ?
        this.kernelUnsupportedSite : ROLLOUT_UNSUPPORTED_SITE.UNKNOWN;
      this.incompleteUnsupportedSite[row] = site;
      this.unsupportedSiteCount[site] += 1;
    }
    this.incompleteReasonCount[normalized] += 1;
  }

  classifyUnsupportedStack(stack) {
    if (stack.includes("FastKernel.preflightSharedResources"))
      return ROLLOUT_UNSUPPORTED_SITE.PREFLIGHT_SHARED_RESOURCE;
    if (stack.includes("FastKernel.move"))
      return ROLLOUT_UNSUPPORTED_SITE.MOVE_CONTEST;
    if (stack.includes("FastKernel.cast")) {
      return stack.includes("kernel.js:180") ?
        ROLLOUT_UNSUPPORTED_SITE.SKILL_COOLDOWN :
        ROLLOUT_UNSUPPORTED_SITE.TELEPORT_TARGET;
    }
    if (stack.includes("FastKernel.executeSeat"))
      return ROLLOUT_UNSUPPORTED_SITE.BOOST_INACTIVE;
    if (stack.includes("FastKernel.collectStar"))
      return ROLLOUT_UNSUPPORTED_SITE.STAR_CONTEST;
    if (stack.includes("FastKernel.resolveTerminal"))
      return ROLLOUT_UNSUPPORTED_SITE.TERMINAL_RUNTIME_TIE;
    return ROLLOUT_UNSUPPORTED_SITE.UNKNOWN;
  }

  bind(state) {
    if (this.state === state) return;
    this.state = state; this.kernel = this.moveContestVariant ===
      MOVE_CONTEST_VARIANT.FAIL_CLOSED ? new FastKernel(state) :
      new MoveContestVariantKernel(state, this.moveContestVariant);
    const owner = this; const fail = this.kernel.fail;
    this.kernel.fail = function diagnosticFail(status) {
      if (status === FAST_STATUS.UNSUPPORTED_RULE) {
        owner.diagnosticFailureStackAllocationCount += 1;
        owner.kernelUnsupportedSite = owner.classifyUnsupportedStack(
          String(new Error().stack || ""));
      }
      return fail.call(this, status);
    };
    this.hazard = new HazardKernel(state);
    this.hard = new HardGate(this.kernel, this.hazard, 0);
  }

  target(cell, direction) {
    const state = this.state;
    const x = state.x(cell) + DX[direction];
    const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ?
      NONE_CELL : state.cell(x, y);
  }

  walkable(cell, seat) {
    if (cell === NONE_CELL) return 0;
    const a = this.state.arrays; const tile = a[ARRAY.TERRAIN][cell];
    if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
    return a[ARRAY.TANK_CRASH][seat ^ 1] ||
      a[ARRAY.TANK_CELL][seat ^ 1] !== cell ? 1 : 0;
  }

  distance(left, right) {
    if (left === NONE_CELL || right === NONE_CELL) return 255;
    return Math.abs(this.state.x(left) - this.state.x(right)) +
      Math.abs(this.state.y(left) - this.state.y(right));
  }

  desiredDirection(from, to) {
    if (from === NONE_CELL || to === NONE_CELL) return -1;
    const dx = this.state.x(to) - this.state.x(from);
    const dy = this.state.y(to) - this.state.y(from);
    if (Math.abs(dx) >= Math.abs(dy) && dx) return dx > 0 ? 1 : 3;
    if (dy) return dy > 0 ? 2 : 0;
    return -1;
  }

  clearLine(from, to) {
    if (from === NONE_CELL || to === NONE_CELL) return 0;
    const state = this.state; const fromX = state.x(from); const fromY = state.y(from);
    const toX = state.x(to); const toY = state.y(to);
    if (fromX !== toX && fromY !== toY) return 0;
    const dx = toX === fromX ? 0 : toX > fromX ? 1 : -1;
    const dy = toY === fromY ? 0 : toY > fromY ? 1 : -1;
    const terrain = state.arrays[ARRAY.TERRAIN];
    let x = fromX + dx; let y = fromY + dy;
    while (x !== toX || y !== toY) {
      const tile = terrain[state.cell(x, y)];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
      x += dx; y += dy;
    }
    return 1;
  }

  canFire(seat) {
    const a = this.state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_FIRE_LOCK][seat] !== NONE_FRAME &&
        a[ARRAY.TANK_FIRE_LOCK][seat] > frame) return 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 0;
    return 1;
  }

  approachingProjectile(seat) {
    const a = this.state.arrays; const tank = a[ARRAY.TANK_CELL][seat];
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot] ||
          a[ARRAY.PROJECTILE_OWNER][slot] === seat) continue;
      const projectile = a[ARRAY.PROJECTILE_CELL][slot];
      const direction = a[ARRAY.PROJECTILE_DIR][slot];
      const px = this.state.x(projectile); const py = this.state.y(projectile);
      const tx = this.state.x(tank); const ty = this.state.y(tank);
      const approaching = direction === 0 ? px === tx && py > ty :
        direction === 1 ? py === ty && px < tx :
          direction === 2 ? px === tx && py < ty : py === ty && px > tx;
      if (approaching && this.clearLine(projectile, tank)) return slot;
    }
    return -1;
  }

  blastExposure(cell) {
    const a = this.state.arrays; let exposure = 0;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot] &&
          this.kernel.bombHitsCell(a[ARRAY.BOMB_CELL][slot], cell)) exposure += 1;
    return exposure;
  }

  escapeAction(seat) {
    const a = this.state.arrays; const cell = a[ARRAY.TANK_CELL][seat];
    const direction = a[ARRAY.TANK_DIR][seat];
    const projectile = this.approachingProjectile(seat);
    let best = ACTION.NONE; let bestExposure = this.blastExposure(cell);
    let bestPotential = -1; let bestProjectileAxis = -1;
    for (let index = 0; index < ESCAPE_ACTIONS.length; index += 1) {
      const action = ESCAPE_ACTIONS[index];
      const nextDirection = action === ACTION.TURN_LEFT ? (direction + 3) & 3 :
        action === ACTION.TURN_RIGHT ? (direction + 1) & 3 : direction;
      const nextCell = action === ACTION.GO ? this.target(cell, direction) : cell;
      if (action === ACTION.GO && !this.walkable(nextCell, seat)) continue;
      const exposure = this.blastExposure(nextCell);
      const forward = this.target(nextCell, nextDirection);
      const potential = this.walkable(forward, seat) ?
        this.blastExposure(forward) === 0 ? 2 : 1 : 0;
      const projectileAxis = projectile < 0 ? 0 :
        ((nextDirection & 1) !==
          (a[ARRAY.PROJECTILE_DIR][projectile] & 1) ? 1 : 0);
      if (exposure < bestExposure ||
          (exposure === bestExposure && projectileAxis > bestProjectileAxis) ||
          (exposure === bestExposure && projectileAxis === bestProjectileAxis &&
           potential > bestPotential)) {
        best = action; bestExposure = exposure;
        bestProjectileAxis = projectileAxis; bestPotential = potential;
      }
    }
    return best;
  }

  targetAction(seat, target) {
    const a = this.state.arrays; const cell = a[ARRAY.TANK_CELL][seat];
    const direction = a[ARRAY.TANK_DIR][seat];
    const wanted = this.desiredDirection(cell, target);
    if (wanted < 0) return ACTION.NONE;
    if (wanted === direction && this.walkable(this.target(cell, direction), seat))
      return ACTION.GO;
    const left = (direction + 3) & 3;
    if (wanted === left) return ACTION.TURN_LEFT;
    return ACTION.TURN_RIGHT;
  }

  committedDanger(seat) {
    if (this.approachingProjectile(seat) >= 0) return 1;
    const a = this.state.arrays; const cell = a[ARRAY.TANK_CELL][seat];
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot] &&
          a[ARRAY.BOMB_EXPLODE][slot] <= frame + 6 &&
          this.kernel.bombHitsCell(a[ARRAY.BOMB_CELL][slot], cell)) return 1;
    return 0;
  }

  nominalAction(seat, kind) {
    const a = this.state.arrays;
    if (a[ARRAY.TANK_CRASH][seat]) return ACTION.NONE;
    if (this.committedDanger(seat)) return this.escapeAction(seat);
    const cell = a[ARRAY.TANK_CELL][seat]; const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
    const direction = a[ARRAY.TANK_DIR][seat];
    const wanted = this.desiredDirection(cell, enemy);
    if (this.canFire(seat) && wanted === direction && this.clearLine(cell, enemy))
      return ACTION.FIRE;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const target = seat === 0 && kind !== OPTION_KIND.POSITION ? enemy :
      star !== NONE_CELL ? star : enemy;
    return this.targetAction(seat, target);
  }

  mobilityCount(seat) {
    const a = this.state.arrays; const cell = a[ARRAY.TANK_CELL][seat]; let count = 0;
    for (let direction = 0; direction < 4; direction += 1)
      count += this.walkable(this.target(cell, direction), seat);
    return count;
  }

  countOwned(arrayActive, arrayOwner, seat) {
    const a = this.state.arrays; let count = 0;
    for (let slot = 0; slot < a[arrayActive].length; slot += 1)
      if (a[arrayActive][slot] && a[arrayOwner][slot] === seat) count += 1;
    return count;
  }

  enemyDebuffs() {
    const a = this.state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    let count = 0;
    for (let index = 0; index < ENEMY_DEBUFF_ARRAYS.length; index += 1) {
      const deadline = a[ENEMY_DEBUFF_ARRAYS[index]][1];
      if (deadline !== NONE_FRAME && deadline > frame) count += 1;
    }
    return count;
  }

  fireLane(seat) {
    const a = this.state.arrays; const cell = a[ARRAY.TANK_CELL][seat];
    const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
    return this.desiredDirection(cell, enemy) === a[ARRAY.TANK_DIR][seat] &&
      this.clearLine(cell, enemy) ? 1 : 0;
  }

  store(row, baselineStars, baselineStar, baselineStarDistance, kind, frames,
      complete, hardFatal) {
    const a = this.state.arrays; const own = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1];
    const terminal = a[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    this.kind[row] = kind; this.frames[row] = frames;
    this.physicalComplete[row] = complete; this.hardFatal[row] = hardFatal;
    this.terminalUtility[row] = terminal === TERMINAL.WIN0 ? 2 :
      terminal === TERMINAL.WIN1 ? 0 : 1;
    this.terminalReached[row] = terminal !== TERMINAL.NONE &&
      terminal !== TERMINAL.INCOMPLETE ? 1 : 0;
    this.ownCrashed[row] = a[ARRAY.TANK_CRASH][0];
    this.enemyCrashed[row] = a[ARRAY.TANK_CRASH][1];
    this.starGain[row] = a[ARRAY.TANK_STARS][0] - baselineStars;
    this.starDelta[row] = a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1];
    this.starDistance[row] = baselineStar === NONE_CELL ? 255 :
      this.distance(own, baselineStar);
    this.enemyDistance[row] = this.distance(own, enemy);
    this.mobility[row] = this.mobilityCount(0);
    this.enemyMobility[row] = this.mobilityCount(1);
    this.ownProjectileCount[row] = this.countOwned(ARRAY.PROJECTILE_ACTIVE,
      ARRAY.PROJECTILE_OWNER, 0);
    this.projectileThreat[row] = this.approachingProjectile(1) >= 0 ? 1 : 0;
    this.ownBombCount[row] = this.countOwned(ARRAY.BOMB_ACTIVE,
      ARRAY.BOMB_OWNER, 0);
    this.enemyDebuffCount[row] = this.enemyDebuffs();
    this.ownFireLane[row] = this.fireLane(0);
    this.enemyFireLane[row] = this.fireLane(1);
    if (kind === OPTION_KIND.POSITION && baselineStar !== NONE_CELL)
      this.objectiveProgress[row] = baselineStarDistance -
        this.distance(own, baselineStar);
    else this.objectiveProgress[row] = 0;
  }

  evaluate(bundle, actions, arguments_, count) {
    const state = bundle && bundle.state;
    if (!state || count < 1 || count > this.maxActions) return 0;
    this.bind(state);
    const a = state.arrays; const baselineStars = a[ARRAY.TANK_STARS][0];
    const baselineOwn = a[ARRAY.TANK_CELL][0]; const baselineEnemy = a[ARRAY.TANK_CELL][1];
    const baselineEnemyDistance = this.distance(baselineOwn, baselineEnemy);
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const baselineStarDistance = star === NONE_CELL ? 255 : this.distance(baselineOwn, star);
    const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootDelta = state.deltaUsed; const rootEvent = state.eventUsed;
    const rootMark = rootDelta * 1024 + rootEvent;
    const savedDeltaBase = state.transitionDeltaBase;
    const savedEventBase = state.transitionEventBase;
    for (let row = 0; row < count; row += 1) {
      this.clearIncomplete(row);
      const kind = optionKind(actions[row]); let complete = 1; let hardFatal = 0;
      let frames = 0; let ownAction = actions[row]; let ownArgument = arguments_[row];
      for (let step = 0; step < this.horizon; step += 1) {
        const sequenceAt = row * this.horizon + step;
        this.sequenceAction[sequenceAt] = ownAction;
        this.sequenceArgument[sequenceAt] = ownArgument;
        const enemyAction = this.nominalAction(1, OPTION_KIND.POSITION);
        this.kernelUnsupportedSite = ROLLOUT_UNSUPPORTED_SITE.NONE;
        const status = this.kernel.applyFrame(ownAction, ownArgument,
          enemyAction, NONE_CELL, CHANCE.NORMAL, CHANCE.NORMAL);
        this.transitionCount += 1;
        if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
          complete = 0; this.incompleteCount += 1;
          this.markIncomplete(row, status, step, status, ownAction,
            enemyAction); break;
        }
        frames += 1;
        const hard = this.hard.classifyApplied();
        this.observeTemporal(row);
        if (hard === HARD_STATUS.REJECT_PROVEN || hard === HARD_STATUS.REJECT_POLICY) {
          hardFatal = 1; this.hardFatalCount += 1;
        } else if (hard === HARD_STATUS.INCOMPLETE) {
          complete = 0; this.incompleteCount += 1;
          this.markIncomplete(row, ROLLOUT_INCOMPLETE_REASON.HARD_INCOMPLETE,
            step, hard);
        }
        if (status === FAST_STATUS.APPLIED_TERMINAL || hardFatal || !complete) break;
        ownAction = this.nominalAction(0, kind); ownArgument = NONE_CELL;
      }
      this.store(row, baselineStars, star, baselineStarDistance, kind, frames,
        complete, hardFatal);
      if (kind !== OPTION_KIND.POSITION)
        this.objectiveProgress[row] = baselineEnemyDistance - this.enemyDistance[row];
      state.undoTo(rootMark);
      state.transitionDeltaBase = savedDeltaBase;
      state.transitionEventBase = savedEventBase;
      const restored = state.hashLo === rootLo && state.hashHi === rootHi &&
        state.deltaUsed === rootDelta && state.eventUsed === rootEvent;
      this.rootRestored[row] = restored ? 1 : 0;
      if (!restored) {
        this.rootRestoreFailureCount += 1;
        this.markIncomplete(row, ROLLOUT_INCOMPLETE_REASON.ROOT_RESTORE,
          frames, 0);
      }
    }
    return count;
  }

  // Evaluate one semantic policy against one explicit enemy first response.
  // Later actions are state-conditioned nominal policy actions, so the own
  // continuation may change after observing the first response.  The method
  // restores the exact FastState root and writes only into a caller-selected
  // preallocated result row.
  evaluatePolicy(bundle, rootAction, rootArgument, kind, enemyRootAction,
      enemyRootArgument, row = 0) {
    const state = bundle && bundle.state;
    if (row < 0 || row >= this.maxActions) return 0;
    this.clearIncomplete(row);
    if (!state) {
      this.markIncomplete(row, ROLLOUT_INCOMPLETE_REASON.INVALID_INPUT, 0, 0);
      return 0;
    }
    this.bind(state);
    const a = state.arrays; const baselineStars = a[ARRAY.TANK_STARS][0];
    const baselineOwn = a[ARRAY.TANK_CELL][0];
    const baselineEnemy = a[ARRAY.TANK_CELL][1];
    const baselineEnemyDistance = this.distance(baselineOwn, baselineEnemy);
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const baselineStarDistance = star === NONE_CELL ? 255 :
      this.distance(baselineOwn, star);
    const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootDelta = state.deltaUsed; const rootEvent = state.eventUsed;
    const rootMark = rootDelta * 1024 + rootEvent;
    const savedDeltaBase = state.transitionDeltaBase;
    const savedEventBase = state.transitionEventBase;
    let ownAction = rootAction; let ownArgument = rootArgument;
    let enemyAction = enemyRootAction; let enemyArgument = enemyRootArgument;
    let complete = 1; let hardFatal = 0; let frames = 0;
    for (let step = 0; step < this.horizon; step += 1) {
      const sequenceAt = row * this.horizon + step;
      this.sequenceAction[sequenceAt] = ownAction;
      this.sequenceArgument[sequenceAt] = ownArgument;
      this.kernelUnsupportedSite = ROLLOUT_UNSUPPORTED_SITE.NONE;
      const status = this.kernel.applyFrame(ownAction, ownArgument,
        enemyAction, enemyArgument, CHANCE.NORMAL, CHANCE.NORMAL);
      this.transitionCount += 1;
      if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
        complete = 0; this.incompleteCount += 1;
        this.markIncomplete(row, status, step, status, ownAction,
          enemyAction); break;
      }
      frames += 1;
      const hard = this.hard.classifyApplied();
      this.observeTemporal(row);
      if (hard === HARD_STATUS.REJECT_PROVEN || hard === HARD_STATUS.REJECT_POLICY) {
        hardFatal = 1; this.hardFatalCount += 1;
      } else if (hard === HARD_STATUS.INCOMPLETE) {
        complete = 0; this.incompleteCount += 1;
        this.markIncomplete(row, ROLLOUT_INCOMPLETE_REASON.HARD_INCOMPLETE,
          step, hard);
      }
      if (status === FAST_STATUS.APPLIED_TERMINAL || hardFatal || !complete) break;
      ownAction = this.nominalAction(0, kind); ownArgument = NONE_CELL;
      enemyAction = this.nominalAction(1, OPTION_KIND.POSITION);
      enemyArgument = NONE_CELL;
    }
    this.store(row, baselineStars, star, baselineStarDistance, kind, frames,
      complete, hardFatal);
    if (kind !== OPTION_KIND.POSITION)
      this.objectiveProgress[row] = baselineEnemyDistance - this.enemyDistance[row];
    state.undoTo(rootMark);
    state.transitionDeltaBase = savedDeltaBase;
    state.transitionEventBase = savedEventBase;
    const restored = state.hashLo === rootLo && state.hashHi === rootHi &&
      state.deltaUsed === rootDelta && state.eventUsed === rootEvent;
    this.rootRestored[row] = restored ? 1 : 0;
    if (!restored) {
      this.rootRestoreFailureCount += 1;
      this.markIncomplete(row, ROLLOUT_INCOMPLETE_REASON.ROOT_RESTORE,
        frames, 0);
    }
    return complete && restored ? 1 : 0;
  }

  // Replay an already materialized own-policy sequence against one explicit
  // enemy first response.  This is intentionally stricter than an
  // observation-conditioned policy: every hidden world receives the exact
  // same own actions, while the opponent may still react to its physical
  // world after the first response.  The caller owns the fixed arrays and the
  // method performs no hot-path allocation.
  evaluatePolicySequence(bundle, actions, arguments_, offset, kind,
      enemyRootAction, enemyRootArgument, row = 0) {
    const state = bundle && bundle.state;
    if (row < 0 || row >= this.maxActions) return 0;
    this.clearIncomplete(row);
    if (!state || !actions || !arguments_ || offset < 0 ||
        offset + this.horizon > actions.length ||
        offset + this.horizon > arguments_.length) {
      this.markIncomplete(row, ROLLOUT_INCOMPLETE_REASON.INVALID_INPUT, 0, 0);
      return 0;
    }
    this.bind(state);
    const a = state.arrays; const baselineStars = a[ARRAY.TANK_STARS][0];
    const baselineOwn = a[ARRAY.TANK_CELL][0];
    const baselineEnemy = a[ARRAY.TANK_CELL][1];
    const baselineEnemyDistance = this.distance(baselineOwn, baselineEnemy);
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const baselineStarDistance = star === NONE_CELL ? 255 :
      this.distance(baselineOwn, star);
    const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootDelta = state.deltaUsed; const rootEvent = state.eventUsed;
    const rootMark = rootDelta * 1024 + rootEvent;
    const savedDeltaBase = state.transitionDeltaBase;
    const savedEventBase = state.transitionEventBase;
    let enemyAction = enemyRootAction; let enemyArgument = enemyRootArgument;
    let complete = 1; let hardFatal = 0; let frames = 0;
    for (let step = 0; step < this.horizon; step += 1) {
      const ownAction = actions[offset + step];
      const ownArgument = arguments_[offset + step];
      const sequenceAt = row * this.horizon + step;
      this.sequenceAction[sequenceAt] = ownAction;
      this.sequenceArgument[sequenceAt] = ownArgument;
      this.kernelUnsupportedSite = ROLLOUT_UNSUPPORTED_SITE.NONE;
      const status = this.kernel.applyFrame(ownAction, ownArgument,
        enemyAction, enemyArgument, CHANCE.NORMAL, CHANCE.NORMAL);
      this.transitionCount += 1;
      if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
        complete = 0; this.incompleteCount += 1;
        this.markIncomplete(row, status, step, status, ownAction,
          enemyAction); break;
      }
      frames += 1;
      const hard = this.hard.classifyApplied();
      this.observeTemporal(row);
      if (hard === HARD_STATUS.REJECT_PROVEN || hard === HARD_STATUS.REJECT_POLICY) {
        hardFatal = 1; this.hardFatalCount += 1;
      } else if (hard === HARD_STATUS.INCOMPLETE) {
        complete = 0; this.incompleteCount += 1;
        this.markIncomplete(row, ROLLOUT_INCOMPLETE_REASON.HARD_INCOMPLETE,
          step, hard);
      }
      if (status === FAST_STATUS.APPLIED_TERMINAL || hardFatal || !complete) break;
      enemyAction = this.nominalAction(1, OPTION_KIND.POSITION);
      enemyArgument = NONE_CELL;
    }
    this.store(row, baselineStars, star, baselineStarDistance, kind, frames,
      complete, hardFatal);
    if (kind !== OPTION_KIND.POSITION)
      this.objectiveProgress[row] = baselineEnemyDistance - this.enemyDistance[row];
    state.undoTo(rootMark);
    state.transitionDeltaBase = savedDeltaBase;
    state.transitionEventBase = savedEventBase;
    const restored = state.hashLo === rootLo && state.hashHi === rootHi &&
      state.deltaUsed === rootDelta && state.eventUsed === rootEvent;
    this.rootRestored[row] = restored ? 1 : 0;
    if (!restored) {
      this.rootRestoreFailureCount += 1;
      this.markIncomplete(row, ROLLOUT_INCOMPLETE_REASON.ROOT_RESTORE,
        frames, 0);
    }
    return complete && restored ? 1 : 0;
  }

  compare(left, right, combatFirst = false) {
    if (right < 0) return 1;
    let result = this.compareDimension(this.physicalComplete, left, right, 1);
    if (result) return result > 0;
    result = this.compareDimension(this.rootRestored, left, right, 1);
    if (result) return result > 0;
    result = this.compareDimension(this.hardFatal, left, right, -1);
    if (result) return result > 0;
    result = this.compareDimension(this.ownCrashed, left, right, -1);
    if (result) return result > 0;
    result = this.compareDimension(this.enemyCrashed, left, right, 1);
    if (result) return result > 0;
    result = this.compareDimension(this.terminalUtility, left, right, 1);
    if (result) return result > 0;
    if (!combatFirst) {
      result = this.compareDimension(this.starGain, left, right, 1);
      if (result) return result > 0;
      result = this.compareDimension(this.starDelta, left, right, 1);
      if (result) return result > 0;
    }
    result = this.compareDimension(this.projectileThreat, left, right, 1);
    if (combatFirst && result) return result > 0;
    result = this.compareDimension(this.ownFireLane, left, right, 1);
    if (result) return result > 0;
    result = this.compareDimension(this.enemyFireLane, left, right, -1);
    if (result) return result > 0;
    result = this.compareDimension(this.objectiveProgress, left, right, 1);
    if (result) return result > 0;
    result = this.compareDimension(this.mobility, left, right, 1);
    if (result) return result > 0;
    result = this.compareDimension(this.enemyMobility, left, right, -1);
    if (result) return result > 0;
    if (combatFirst) {
      result = this.compareDimension(this.starGain, left, right, 1);
      if (result) return result > 0;
      result = this.compareDimension(this.starDelta, left, right, 1);
      if (result) return result > 0;
    } else {
      result = this.compareDimension(this.projectileThreat, left, right, 1);
      if (result) return result > 0;
      result = this.compareDimension(this.enemyDebuffCount, left, right, 1);
      if (result) return result > 0;
    }
    return left < right;
  }

  compareDimension(values, left, right, direction) {
    if (values[left] === values[right]) return 0;
    return (direction > 0 ? values[left] > values[right] :
      values[left] < values[right]) ? 1 : -1;
  }

  best(count, combatFirst = false, kindFilter = -1) {
    let best = -1;
    for (let row = 0; row < count; row += 1) {
      if (kindFilter >= 0 && this.kind[row] !== kindFilter) continue;
      if (this.compare(row, best, combatFirst)) best = row;
    }
    return best;
  }

  snapshot(row) {
    if (row < 0 || row >= this.maxActions) return null;
    const sequence = [];
    for (let step = 0; step < this.frames[row]; step += 1) {
      const at = row * this.horizon + step;
      sequence.push({ actionCode: this.sequenceAction[at],
        argument: this.sequenceArgument[at] });
    }
    return {
      kind: this.kind[row], physicalComplete: Boolean(this.physicalComplete[row]),
      rootRestored: Boolean(this.rootRestored[row]), frames: this.frames[row],
      incompleteReason: this.incompleteReason[row],
      incompleteStep: this.incompleteStep[row],
      incompleteStatus: this.incompleteStatus[row],
      incompleteUnsupportedSite: this.incompleteUnsupportedSite[row],
      incompleteOwnAction: this.incompleteOwnAction[row],
      incompleteEnemyAction: this.incompleteEnemyAction[row],
      nominalOnly: true, hardFatal: Boolean(this.hardFatal[row]),
      terminalReached: Boolean(this.terminalReached[row]),
      terminalUtility: this.terminalUtility[row], ownCrashed: Boolean(this.ownCrashed[row]),
      enemyCrashed: Boolean(this.enemyCrashed[row]), starGain: this.starGain[row],
      starDelta: this.starDelta[row], starDistance: this.starDistance[row],
      objectiveProgress: this.objectiveProgress[row],
      enemyDistance: this.enemyDistance[row], mobility: this.mobility[row],
      enemyMobility: this.enemyMobility[row],
      ownProjectileCount: this.ownProjectileCount[row],
      projectileThreat: Boolean(this.projectileThreat[row]),
      ownBombCount: this.ownBombCount[row],
      enemyDebuffCount: this.enemyDebuffCount[row], ownFireLane: Boolean(this.ownFireLane[row]),
      enemyFireLane: Boolean(this.enemyFireLane[row]),
      projectileThreatFrames: this.projectileThreatFrames[row],
      minimumEnemyMobility: this.minimumEnemyMobility[row],
      enemyMobilityIntegral: this.enemyMobilityIntegral[row],
      ownFireLaneFrames: this.ownFireLaneFrames[row],
      enemyFireLaneFrames: this.enemyFireLaneFrames[row], sequence
    };
  }
}

module.exports = { OPTION_KIND, OPTION_HORIZON, ROLLOUT_INCOMPLETE_REASON,
  ROLLOUT_UNSUPPORTED_SITE, isPositionAction, optionKind, StatefulOptionRollout };
