"use strict";

// A compact, proof-only SAFE_THREAT_FIRE certificate.  It is intentionally
// default-disabled production-tree certificate. Positive support requires the
// same result in every unresolved movement-rule world; any unsupported
// transition, budget stop or capacity stop is UNKNOWN. ProductionRoot may run
// it in Shadow or an explicit diagnostic POC, but the default path never
// constructs the arena or gives it action ownership.

const { CAPACITY, RULE } = require("../generated/fast-config");
const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { FastKernel } = require("../fast/kernel");
const { HazardKernel } = require("../fast/hazard");
const { HardGate } = require("../fast/hard-gate");
const { AttackEventPolicySearch } = require("./attack-event-policy-search");
const { ProjectileAttackTimeline, AttackReverseViability } = require(
  "./projectile-attack-closure");
const { ACTION, DIRECTION, SKILL, FAST_STATUS, HARD_STATUS, TERMINAL,
  TERRAIN, CHANCE, EVENT, PHASE, NONE_FRAME, NONE_CELL, DX, DY } = require(
  "../abi/fast-codes");
const { PROOF_STATUS } = require("../abi/search-codes");

const STRICT_SAFE_THREAT_TT_CAPACITY = 64;
const STRICT_SAFE_THREAT_DEPTH = 6;
const STRICT_SAFE_THREAT_NODE_BUDGET = 64;
const SETTLEMENT = Object.freeze({ NONE: 0, SURVIVES: 1, DOOMED: 2,
  UNKNOWN: 3 });
const MOVE_WORLD = Object.freeze({ SEQUENTIAL_BLOCK: 1, INTENT_BLOCK: 2,
  COLLISION_CRASH: 3, COUNT: 3 });
const MOVE_WORLDS = Object.freeze([MOVE_WORLD.SEQUENTIAL_BLOCK,
  MOVE_WORLD.INTENT_BLOCK, MOVE_WORLD.COLLISION_CRASH]);
const MOVE_CONTEST_KIND = Object.freeze({ NONE: 0, STATIC_OCCUPIED: 1,
  SAME_TARGET: 2, SWAP: 3, ENTER_OCCUPIED_START: 4,
  BOOST_UNSUPPORTED: 5, COUNT: 6 });

function isAhead(state, from, direction, target) {
  const fx = state.x(from); const fy = state.y(from);
  const tx = state.x(target); const ty = state.y(target);
  if (direction === DIRECTION.UP) return fx === tx && ty < fy;
  if (direction === DIRECTION.RIGHT) return fy === ty && tx > fx;
  if (direction === DIRECTION.DOWN) return fx === tx && ty > fy;
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

class StrictProjectileEventSettlement {
  constructor() {
    this.timeline = new ProjectileAttackTimeline();
    this.reverse = new AttackReverseViability();
    this.callCount = 0; this.timelineCount = 0; this.noThreatCount = 0;
    this.surviveCount = 0; this.doomedCount = 0; this.unknownCount = 0;
    this.multiProjectileCount = 0; this.hotAllocationCount = 0;
  }

  active(state, array, seat) {
    const value = state.arrays[array][seat];
    return value !== NONE_FRAME &&
      value > state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
  }

  survivalSpecial(state, seat, ticks) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.active(state, ARRAY.TANK_SHIELD_UNTIL, seat) ||
        this.active(state, ARRAY.TANK_BOOST_UNTIL, seat)) return 1;
    const frames = Math.max(1, Math.ceil(ticks / RULE.PROJECTILE_STEPS));
    const skill = a[ARRAY.TANK_SKILL][seat];
    return (skill === SKILL.SHIELD || skill === SKILL.TELEPORT ||
      skill === SKILL.BOOST) && a[ARRAY.TANK_SKILL_READY][seat] <=
      frame + frames ? 1 : 0;
  }

  classifyThreat(state, owner) {
    this.callCount += 1;
    const a = state.arrays; const targetSeat = owner ^ 1;
    const target = a[ARRAY.TANK_CELL][targetSeat]; let slot = -1; let count = 0;
    for (let at = 0; at < CAPACITY.MAX_PROJECTILES; at += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][at] ||
          a[ARRAY.PROJECTILE_OWNER][at] !== owner) continue;
      const cell = a[ARRAY.PROJECTILE_CELL][at];
      const direction = a[ARRAY.PROJECTILE_DIR][at];
      if (!isAhead(state, cell, direction, target) ||
          !rayClear(state, cell, target)) continue;
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
    if (this.reverse.poseViable(root, target,
      a[ARRAY.TANK_DIR][targetSeat])) {
      this.surviveCount += 1; return SETTLEMENT.SURVIVES;
    }
    if (this.survivalSpecial(state, targetSeat, this.timeline.horizonTick)) {
      this.unknownCount += 1; return SETTLEMENT.UNKNOWN;
    }
    this.doomedCount += 1; return SETTLEMENT.DOOMED;
  }
}

// The platform has not exposed a definitive GO/GO contest rule.  A positive
// certificate therefore has to survive all three finite interpretations.  The
// wrapper changes only contest handling and delegates every other rule to the
// production FastKernel.
class StrictProofMoveWorldKernel extends FastKernel {
  constructor(state, variant = MOVE_WORLD.SEQUENTIAL_BLOCK) {
    super(state);
    this.variant = variant; this.blockMask = 0; this.crashContest = 0;
    this.collisionApplied = 0; this.contestKind = MOVE_CONTEST_KIND.NONE;
    this.variantTransitionCount = 0; this.unsupportedBoostCount = 0;
    this.hotAllocationCount = 0;
  }

  eligibleGoTarget(seat, action, chance) {
    if (action !== ACTION.GO) return NONE_CELL;
    const a = this.state.arrays; const frame = this.frame();
    if (a[ARRAY.TANK_CRASH][seat] ||
        this.active(a[ARRAY.TANK_FROZEN_UNTIL][seat])) return NONE_CELL;
    if (this.active(a[ARRAY.TANK_POISON_UNTIL][seat])) {
      const applied = a[ARRAY.TANK_POISON_APPLIED][seat];
      if (applied === NONE_FRAME || ((frame - applied) & 1) !== 0)
        return NONE_CELL;
    }
    if (this.active(a[ARRAY.TANK_BOOST_UNTIL][seat])) {
      this.unsupportedBoostCount += 1;
      this.contestKind = MOVE_CONTEST_KIND.BOOST_UNSUPPORTED;
      return NONE_CELL;
    }
    let direction = a[ARRAY.TANK_DIR][seat];
    if (this.active(a[ARRAY.TANK_STUN_UNTIL][seat])) {
      if (chance === CHANCE.MISSING) return NONE_CELL;
      if (chance === CHANCE.REVERSED) direction = (direction + 2) & 3;
    }
    const cell = a[ARRAY.TANK_CELL][seat];
    const x = this.state.x(cell) + DX[direction];
    const y = this.state.y(cell) + DY[direction];
    if (x < 0 || x >= this.state.width || y < 0 || y >= this.state.height)
      return NONE_CELL;
    const target = this.state.cell(x, y); const terrain = a[ARRAY.TERRAIN][target];
    return terrain === TERRAIN.WALL || terrain === TERRAIN.DIRT ?
      NONE_CELL : target;
  }

  prepareContest(action0, action1, chance0, chance1) {
    this.blockMask = 0; this.crashContest = 0; this.collisionApplied = 0;
    this.contestKind = MOVE_CONTEST_KIND.NONE;
    if (action0 !== ACTION.GO || action1 !== ACTION.GO) return;
    const a = this.state.arrays;
    const cell0 = a[ARRAY.TANK_CELL][0]; const cell1 = a[ARRAY.TANK_CELL][1];
    const target0 = this.eligibleGoTarget(0, action0, chance0);
    const target1 = this.eligibleGoTarget(1, action1, chance1);
    if (this.contestKind === MOVE_CONTEST_KIND.BOOST_UNSUPPORTED) return;
    const enter0 = target0 === cell1; const enter1 = target1 === cell0;
    if (target0 === NONE_CELL || target1 === NONE_CELL) {
      if (enter0) this.blockMask |= 1;
      if (enter1) this.blockMask |= 2;
      if (this.blockMask) this.contestKind = MOVE_CONTEST_KIND.STATIC_OCCUPIED;
      return;
    }
    const same = target0 === target1; const swap = enter0 && enter1;
    if (!same && !swap && !enter0 && !enter1) return;
    this.contestKind = same ? MOVE_CONTEST_KIND.SAME_TARGET :
      swap ? MOVE_CONTEST_KIND.SWAP : MOVE_CONTEST_KIND.ENTER_OCCUPIED_START;
    if (this.variant === MOVE_WORLD.COLLISION_CRASH) {
      this.crashContest = 1; return;
    }
    if (same || swap) {
      this.blockMask = this.variant === MOVE_WORLD.SEQUENTIAL_BLOCK && same ? 2 : 3;
      return;
    }
    if (enter0) this.blockMask |= 1;
    if (enter1 && this.variant === MOVE_WORLD.INTENT_BLOCK) this.blockMask |= 2;
  }

  crashBoth(seat) {
    if (this.collisionApplied) return 1;
    this.collisionApplied = 1;
    const phase = seat === 0 ? PHASE.SEAT0 : PHASE.SEAT1;
    if (!this.set(ARRAY.TANK_CRASH, 0, 1) ||
        !this.event(phase, EVENT.TANK_CRASHED, 1, 2,
          NONE_CELL, NONE_CELL, 0, 1, this.contestKind) ||
        !this.set(ARRAY.TANK_CRASH, 1, 1) ||
        !this.event(phase, EVENT.TANK_CRASHED, 2, 1,
          NONE_CELL, NONE_CELL, 0, 1, this.contestKind)) return 0;
    return 1;
  }

  move(seat, reversed, opposingAction) {
    if (this.crashContest) return this.crashBoth(seat);
    if (this.blockMask & (1 << seat)) return 1;
    return super.move(seat, reversed, opposingAction);
  }

  applyFrame(action0 = ACTION.NONE, arg0 = NONE_CELL,
      action1 = ACTION.NONE, arg1 = NONE_CELL,
      chance0 = CHANCE.NORMAL, chance1 = CHANCE.NORMAL) {
    this.prepareContest(action0, action1, chance0, chance1);
    if (this.contestKind === MOVE_CONTEST_KIND.BOOST_UNSUPPORTED)
      return super.applyFrame(action0, arg0, action1, arg1, chance0, chance1);
    if (this.contestKind !== MOVE_CONTEST_KIND.NONE)
      this.variantTransitionCount += 1;
    return super.applyFrame(action0, arg0, action1, arg1, chance0, chance1);
  }
}

class StrictSafeThreatFireProof extends AttackEventPolicySearch {
  constructor(nodeBudget = STRICT_SAFE_THREAT_NODE_BUDGET,
      ttCapacity = STRICT_SAFE_THREAT_TT_CAPACITY) {
    super(nodeBudget, ttCapacity);
    this.settlement = new StrictProjectileEventSettlement();
    this.ttConsumesDeviation = new Uint8Array(ttCapacity);
    this.supportLossCount = 0; this.hardIncompleteCount = 0;
    this.fastIncompleteCount = 0; this.horizonStopCount = 0;
    this.fireEventCount = 0; this.threatFireCount = 0;
    this.counterUnsafeCount = 0; this.lastSupportComplete = 0;
    this.deviationStateCount = 0; this.deviationRowCount = 0;
    this.deviationSelectedCount = 0; this.baselineMissingCount = 0;
    this.rootFireMissingCount = 0; this.rootFireBranchCount = 0;
    this.rootOutgoingAllDoomed = 1; this.lastRootAllDoomed = 0;
    this.hotAllocationCount = 0;
  }

  resetProof(nodeBudget) {
    this.resetPolicy(nodeBudget); this.ttConsumesDeviation.fill(0);
    this.supportLossCount = 0; this.hardIncompleteCount = 0;
    this.fastIncompleteCount = 0; this.horizonStopCount = 0;
    this.fireEventCount = 0; this.threatFireCount = 0;
    this.counterUnsafeCount = 0; this.lastSupportComplete = 0;
    this.deviationStateCount = 0; this.deviationRowCount = 0;
    this.deviationSelectedCount = 0; this.baselineMissingCount = 0;
    this.rootFireMissingCount = 0; this.rootFireBranchCount = 0;
    this.rootOutgoingAllDoomed = 1; this.lastRootAllDoomed = 0;
  }

  actionIndex(top, action, count) {
    const base = top * SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    for (let row = 0; row < count; row += 1)
      if (this.ourActions[base + row] === action) return row;
    return -1;
  }

  pursuitAction(state, secondary) {
    const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    if (own >= state.cells || enemy >= state.cells) return ACTION.NONE;
    const dx = state.x(enemy) - state.x(own);
    const dy = state.y(enemy) - state.y(own);
    if (!dx && !dy) return ACTION.NONE;
    let desired;
    if ((!secondary && Math.abs(dx) >= Math.abs(dy)) ||
        (secondary && Math.abs(dx) < Math.abs(dy))) {
      if (!dx) return ACTION.NONE;
      desired = dx > 0 ? DIRECTION.RIGHT : DIRECTION.LEFT;
    } else {
      if (!dy) return ACTION.NONE;
      desired = dy > 0 ? DIRECTION.DOWN : DIRECTION.UP;
    }
    const facing = a[ARRAY.TANK_DIR][0];
    if (facing === desired) return ACTION.GO;
    return ((desired - facing + 4) & 3) === 3 ?
      ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
  }

  firingDirection(state) {
    const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    if (own >= state.cells || enemy >= state.cells) return -1;
    const ox = state.x(own); const oy = state.y(own);
    const ex = state.x(enemy); const ey = state.y(enemy);
    let direction = -1; let step = 0;
    if (ox === ex) {
      direction = ey < oy ? DIRECTION.UP : DIRECTION.DOWN;
      step = ey < oy ? -state.width : state.width;
    } else if (oy === ey) {
      direction = ex < ox ? DIRECTION.LEFT : DIRECTION.RIGHT;
      step = ex < ox ? -1 : 1;
    } else return -1;
    const terrain = a[ARRAY.TERRAIN];
    for (let cell = own + step; cell !== enemy; cell += step)
      if (terrain[cell] === TERRAIN.WALL || terrain[cell] === TERRAIN.DIRT)
        return -1;
    return direction;
  }

  forwardBlocked(state) {
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][0];
    if (own >= state.cells) return 1;
    const direction = a[ARRAY.TANK_DIR][0];
    const x = state.x(own) + DX[direction];
    const y = state.y(own) + DY[direction];
    if (x < 0 || x >= state.width || y < 0 || y >= state.height) return 1;
    const cell = state.cell(x, y); const tile = a[ARRAY.TERRAIN][cell];
    return tile === TERRAIN.WALL || tile === TERRAIN.DIRT ||
      cell === a[ARRAY.TANK_CELL][1] ? 1 : 0;
  }

  policyAction(state) {
    const fireDirection = this.firingDirection(state);
    const facing = state.arrays[ARRAY.TANK_DIR][0];
    if (fireDirection >= 0) {
      if (facing === fireDirection) return ACTION.FIRE;
      return ((fireDirection - facing + 4) & 3) === 3 ?
        ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
    }
    const primary = this.pursuitAction(state, 0);
    if (primary !== ACTION.GO || !this.forwardBlocked(state)) return primary;
    const secondary = this.pursuitAction(state, 1);
    return secondary === ACTION.NONE ? ACTION.TURN_RIGHT : secondary;
  }

  projectileCount(state, seat) {
    const active = state.arrays[ARRAY.PROJECTILE_ACTIVE];
    const owner = state.arrays[ARRAY.PROJECTILE_OWNER]; let count = 0;
    for (let slot = 0; slot < active.length; slot += 1)
      if (active[slot] && owner[slot] === seat) count += 1;
    return count;
  }

  generateFull(top, state, seat) {
    return AttackEventPolicySearch.prototype.generate.call(this, top, state, seat);
  }

  lookupDeviationState(state, depth, available) {
    return this.lookupState(state, (depth << 1) | (available ? 1 : 0));
  }

  storeDeviationState(state, depth, available, status, action, argument,
      consumesDeviation) {
    if (status === PROOF_STATUS.UNKNOWN) return;
    const key = (depth << 1) | (available ? 1 : 0);
    this.storeState(state, key, status, action, argument);
    if (status !== PROOF_STATUS.PROVEN) return;
    const slot = this.ttSlot(state, key);
    if (slot >= 0) this.ttConsumesDeviation[slot] = consumesDeviation ? 1 : 0;
  }

  baselineRow(top, state) {
    const wanted = this.policyAction(state);
    let row = wanted === ACTION.NONE ? -1 :
      this.actionIndex(top, wanted, this.ourCount[top]);
    if (row < 0) row = this.actionIndex(top, ACTION.NONE, this.ourCount[top]);
    if (row < 0) this.baselineMissingCount += 1;
    return row;
  }

  fireStatus(outgoing, incoming) {
    if (incoming === SETTLEMENT.DOOMED) return PROOF_STATUS.DISPROVEN;
    if (incoming === SETTLEMENT.UNKNOWN || outgoing === SETTLEMENT.UNKNOWN)
      return PROOF_STATUS.UNKNOWN;
    return outgoing === SETTLEMENT.SURVIVES || outgoing === SETTLEMENT.DOOMED ?
      PROOF_STATUS.PROVEN : PROOF_STATUS.DISPROVEN;
  }

  rootFireCreated(state, mark) {
    const start = mark % 1024;
    for (let at = start; at < state.eventUsed; at += 1)
      if (state.eventPhase[at] === PHASE.SEAT0 &&
          state.eventType[at] === EVENT.PROJECTILE_CREATED) return 1;
    return 0;
  }

  proveDeviationOutcome(bundle, depth, top, action0, argument0,
      action1, argument1, chance0, chance1, availableAfterAction) {
    if (this.nodes >= this.nodeBudget) {
      this.budgetStopCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const beforeProjectile = this.projectileCount(bundle.state, 0);
    const status = bundle.kernel.applyFrame(action0, argument0,
      action1, argument1, chance0, chance1);
    this.nodes += 1;
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
      this.incompleteCount += 1; this.fastIncompleteCount += 1;
      this.supportLossCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const mark = bundle.kernel.lastMark;
    const rootFire = top === 0 && action0 === ACTION.FIRE;
    const rootFireCreated = rootFire ?
      this.rootFireCreated(bundle.state, mark) : 0;
    const hard = bundle.hard.classifyApplied();
    const terminal = bundle.state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    let result;
    if (rootFire && !rootFireCreated) {
      this.rootFireMissingCount += 1; this.supportLossCount += 1;
      result = PROOF_STATUS.UNKNOWN;
    } else if (hard === HARD_STATUS.INCOMPLETE) {
      this.incompleteCount += 1; this.hardIncompleteCount += 1;
      this.supportLossCount += 1; result = PROOF_STATUS.UNKNOWN;
    } else if (hard !== HARD_STATUS.ALLOW ||
        bundle.state.arrays[ARRAY.TANK_CRASH][0]) {
      result = PROOF_STATUS.DISPROVEN;
    } else if (terminal) {
      if (rootFire && terminal === TERMINAL.WIN0)
        this.rootFireBranchCount += 1;
      result = terminal === TERMINAL.WIN0 ?
        PROOF_STATUS.PROVEN : PROOF_STATUS.DISPROVEN;
    } else if (action0 === ACTION.FIRE &&
        this.projectileCount(bundle.state, 0) > beforeProjectile) {
      this.fireEventCount += 1;
      const incoming = this.settlement.classifyThreat(bundle.state, 1);
      const outgoing = this.settlement.classifyThreat(bundle.state, 0);
      if (rootFire) {
        this.rootFireBranchCount += 1;
        if (outgoing !== SETTLEMENT.DOOMED)
          this.rootOutgoingAllDoomed = 0;
      }
      if (incoming === SETTLEMENT.DOOMED) this.counterUnsafeCount += 1;
      if (outgoing === SETTLEMENT.SURVIVES || outgoing === SETTLEMENT.DOOMED)
        this.threatFireCount += 1;
      result = this.fireStatus(outgoing, incoming);
    } else if (depth <= 1) {
      this.horizonStopCount += 1; result = PROOF_STATUS.UNKNOWN;
    } else result = this.proveDeviationState(bundle, depth - 1, top + 1,
      availableAfterAction);
    bundle.state.undoTo(mark); return result;
  }

  proveDeviationColumn(bundle, depth, top, row, column,
      availableAfterAction) {
    const action0 = this.actionAt(top, 0, row);
    const argument0 = this.argumentAt(top, 0, row);
    const action1 = this.actionAt(top, 1, column);
    const argument1 = this.argumentAt(top, 1, column);
    const ownChance = bundle.hard.chanceAlternativeCount(0, action0);
    const enemyChance = bundle.hard.chanceAlternativeCount(1, action1);
    let unknown = 0;
    for (let chance = 0; chance < ownChance * enemyChance; chance += 1) {
      const result = this.proveDeviationOutcome(bundle, depth, top,
        action0, argument0, action1, argument1,
        chance % ownChance, Math.floor(chance / ownChance),
        availableAfterAction);
      if (result === PROOF_STATUS.DISPROVEN) return result;
      if (result === PROOF_STATUS.UNKNOWN) unknown = 1;
    }
    return unknown ? PROOF_STATUS.UNKNOWN : PROOF_STATUS.PROVEN;
  }

  proveDeviationRow(bundle, depth, top, row, availableAfterAction) {
    for (let column = 0; column < this.enemyCount[top]; column += 1) {
      const result = this.proveDeviationColumn(bundle, depth, top, row,
        column, availableAfterAction);
      if (result !== PROOF_STATUS.PROVEN) return result;
    }
    return PROOF_STATUS.PROVEN;
  }

  proveDeviationState(bundle, depth, top, deviationAvailable) {
    const state = bundle.state;
    const cached = this.lookupDeviationState(state, depth, deviationAvailable);
    if (cached) return cached;
    if (top > SEARCH_CAPACITY.MAX_DECISION_DEPTH ||
        !this.generateFull(top, state, 0) ||
        !this.generateFull(top, state, 1)) {
      this.incompleteCount += 1; this.supportLossCount += 1;
      return PROOF_STATUS.UNKNOWN;
    }
    const baseline = this.baselineRow(top, state);
    if (baseline < 0) {
      this.incompleteCount += 1; this.supportLossCount += 1;
      return PROOF_STATUS.UNKNOWN;
    }
    this.deviationStateCount += 1;
    let result = this.proveDeviationRow(bundle, depth, top, baseline,
      deviationAvailable);
    let selectedRow = result === PROOF_STATUS.PROVEN ? baseline : -1;
    let sawUnknown = result === PROOF_STATUS.UNKNOWN ? 1 : 0;
    if (selectedRow < 0 && deviationAvailable) {
      for (let row = 0; row < this.ourCount[top]; row += 1) {
        if (row === baseline) continue;
        this.deviationRowCount += 1;
        const rowResult = this.proveDeviationRow(bundle, depth, top, row, 0);
        if (rowResult === PROOF_STATUS.PROVEN) {
          selectedRow = row; result = rowResult; break;
        }
        if (rowResult === PROOF_STATUS.UNKNOWN) sawUnknown = 1;
      }
    }
    if (selectedRow < 0) result = sawUnknown ?
      PROOF_STATUS.UNKNOWN : PROOF_STATUS.DISPROVEN;
    const action = selectedRow < 0 ? ACTION.NONE :
      this.actionAt(top, 0, selectedRow);
    const argument = selectedRow < 0 ? NONE_CELL :
      this.argumentAt(top, 0, selectedRow);
    const consumes = selectedRow >= 0 && selectedRow !== baseline;
    if (consumes) this.deviationSelectedCount += 1;
    this.storeDeviationState(state, depth, deviationAvailable, result,
      action, argument, consumes);
    return result;
  }

  evaluateCandidate(bundle, rootAction, rootArgument, enemyActions,
      enemyArguments, enemyCount, maximumDepth = STRICT_SAFE_THREAT_DEPTH,
      nodeBudget = this.defaultNodeBudget) {
    this.resetProof(nodeBudget);
    if (!bundle || !enemyActions || !enemyArguments || enemyCount < 1 ||
        enemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES || maximumDepth < 2 ||
        maximumDepth > SEARCH_CAPACITY.MAX_DECISION_DEPTH || nodeBudget < 1 ||
        !this.visiblePhysical(bundle.state)) {
      this.lastStatus = PROOF_STATUS.UNKNOWN; return this.lastStatus;
    }
    this.ourCount[0] = 1; this.ourActions[0] = rootAction;
    this.ourArguments[0] = rootArgument; this.enemyCount[0] = enemyCount;
    for (let column = 0; column < enemyCount; column += 1) {
      this.enemyActions[column] = enemyActions[column];
      this.enemyArguments[column] = enemyArguments[column];
    }
    const state = bundle.state; const rootLo = state.hashLo;
    const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    this.lastStatus = this.proveDeviationRow(bundle, maximumDepth, 0, 0, 1);
    if (this.lastStatus !== PROOF_STATUS.UNKNOWN)
      this.completedDepth = maximumDepth;
    state.undoTo(rootMark);
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== rootMark) {
      this.rootRestoreFailures += 1; this.supportLossCount += 1;
      this.lastStatus = PROOF_STATUS.UNKNOWN; this.completedDepth = 0;
    }
    this.lastSupportComplete = this.supportLossCount === 0 &&
      this.budgetStopCount === 0 && this.rootRestoreFailures === 0 &&
      this.ttCapacityStops === 0 && this.unsupportedGenerationStops === 0 ? 1 : 0;
    this.lastRootAllDoomed = this.lastStatus === PROOF_STATUS.PROVEN &&
      this.lastSupportComplete && this.rootFireBranchCount > 0 &&
      this.rootOutgoingAllDoomed ? 1 : 0;
    return this.lastStatus;
  }
}

class StrictSafeThreatFireProofArena {
  constructor(state, options = {}) {
    this.state = state;
    this.maximumDepth = Number.isSafeInteger(options.maximumDepth) ?
      options.maximumDepth : STRICT_SAFE_THREAT_DEPTH;
    this.nodeBudget = Number.isSafeInteger(options.nodeBudget) ?
      options.nodeBudget : STRICT_SAFE_THREAT_NODE_BUDGET;
    this.search = new StrictSafeThreatFireProof(this.nodeBudget,
      Number.isSafeInteger(options.ttCapacity) ? options.ttCapacity :
        STRICT_SAFE_THREAT_TT_CAPACITY);
    this.kernel = new StrictProofMoveWorldKernel(state, MOVE_WORLDS[0]);
    this.hazard = new HazardKernel(state);
    this.hard = new HardGate(this.kernel, this.hazard, 0);
    this.status = new Uint8Array(MOVE_WORLD.COUNT);
    this.support = new Uint8Array(MOVE_WORLD.COUNT);
    this.nodes = new Uint16Array(MOVE_WORLD.COUNT);
    this.doomed = new Uint8Array(MOVE_WORLD.COUNT);
    this.lastStatus = PROOF_STATUS.UNKNOWN; this.lastSupportComplete = 0;
    this.lastAllDoomed = 0;
    this.lastTotalNodes = 0; this.lastBudgetStops = 0;
    this.lastTtStops = 0; this.lastRestoreFailures = 0;
    this.lastSupportLoss = 0; this.evaluationCount = 0;
    this.totalNodes = 0; this.maximumNodes = 0; this.hotAllocationCount = 0;
  }

  evaluate(bundle, enemyActions, enemyArguments, enemyCount) {
    if (!bundle || bundle.state !== this.state) {
      this.lastStatus = PROOF_STATUS.UNKNOWN; this.lastSupportComplete = 0;
      return this.lastStatus;
    }
    const originalKernel = bundle.kernel; const originalHazard = bundle.hazard;
    const originalHard = bundle.hard; const state = bundle.state;
    const beforeLo = state.hashLo; const beforeHi = state.hashHi;
    const beforeMark = state.deltaUsed * 1024 + state.eventUsed;
    this.lastTotalNodes = 0; this.lastBudgetStops = 0;
    this.lastTtStops = 0; this.lastRestoreFailures = 0;
    this.lastSupportLoss = 0; this.lastAllDoomed = 0;
    let allProven = 1; let allComplete = 1; let allDoomed = 1;
    try {
      bundle.kernel = this.kernel; bundle.hazard = this.hazard;
      bundle.hard = this.hard;
      for (let variant = 0; variant < MOVE_WORLD.COUNT; variant += 1) {
        this.kernel.variant = MOVE_WORLDS[variant];
        const restoreBefore = this.search.rootRestoreFailures;
        const status = this.search.evaluateCandidate(bundle, ACTION.FIRE,
          NONE_CELL, enemyActions, enemyArguments, enemyCount,
          this.maximumDepth, this.nodeBudget);
        this.status[variant] = status;
        this.support[variant] = this.search.lastSupportComplete ? 1 : 0;
        this.nodes[variant] = Math.min(0xffff, this.search.nodes);
        this.doomed[variant] = this.search.lastRootAllDoomed ? 1 : 0;
        this.lastTotalNodes += this.search.nodes;
        this.lastBudgetStops += this.search.budgetStopCount;
        this.lastTtStops += this.search.ttCapacityStops;
        this.lastRestoreFailures += this.search.rootRestoreFailures - restoreBefore;
        this.lastSupportLoss += this.search.supportLossCount;
        if (status !== PROOF_STATUS.PROVEN) allProven = 0;
        if (!this.search.lastSupportComplete) allComplete = 0;
        if (!this.search.lastRootAllDoomed) allDoomed = 0;
        if (state.hashLo !== beforeLo || state.hashHi !== beforeHi ||
            state.deltaUsed * 1024 + state.eventUsed !== beforeMark) {
          this.lastRestoreFailures += 1; allComplete = 0;
        }
      }
    } finally {
      bundle.kernel = originalKernel; bundle.hazard = originalHazard;
      bundle.hard = originalHard;
    }
    this.lastSupportComplete = allComplete ? 1 : 0;
    this.lastStatus = allComplete && allProven ?
      PROOF_STATUS.PROVEN : PROOF_STATUS.UNKNOWN;
    this.lastAllDoomed = this.lastStatus === PROOF_STATUS.PROVEN &&
      allDoomed ? 1 : 0;
    this.evaluationCount += 1; this.totalNodes += this.lastTotalNodes;
    if (this.lastTotalNodes > this.maximumNodes)
      this.maximumNodes = this.lastTotalNodes;
    return this.lastStatus;
  }
}

module.exports = { STRICT_SAFE_THREAT_TT_CAPACITY, STRICT_SAFE_THREAT_DEPTH,
  STRICT_SAFE_THREAT_NODE_BUDGET, SETTLEMENT, MOVE_WORLD, MOVE_WORLDS,
  MOVE_CONTEST_KIND, StrictProjectileEventSettlement,
  StrictProofMoveWorldKernel, StrictSafeThreatFireProof,
  StrictSafeThreatFireProofArena };
