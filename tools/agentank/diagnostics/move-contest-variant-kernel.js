"use strict";

// Diagnostic-only finite RuleVariant executor for the unresolved GO/GO
// movement contract. Production FastKernel remains fail-closed.  The three
// variants are deliberately explicit worlds; callers may only consume their
// common/worst envelope, never select one as platform truth.

const { FastKernel } = require("../../../engine-v2/src/fast/kernel");
const { ARRAY } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, CHANCE, EVENT, PHASE, TERRAIN, NONE_CELL, DX, DY } =
  require("../../../engine-v2/src/abi/fast-codes");

const MOVE_CONTEST_VARIANT = Object.freeze({
  FAIL_CLOSED: 0,
  SEQUENTIAL_BLOCK: 1,
  INTENT_BLOCK: 2,
  COLLISION_CRASH: 3,
  COUNT: 4
});

const MOVE_CONTEST_KIND = Object.freeze({
  NONE: 0,
  STATIC_OCCUPIED: 1,
  SAME_TARGET: 2,
  SWAP: 3,
  ENTER_OCCUPIED_START: 4,
  BOOST_UNSUPPORTED: 5,
  COUNT: 6
});

class MoveContestVariantKernel extends FastKernel {
  constructor(state, variant) {
    super(state);
    this.variant = variant;
    this.blockMask = 0; this.crashContest = 0; this.collisionApplied = 0;
    this.contestKind = MOVE_CONTEST_KIND.NONE;
    this.variantTransitionCount = 0; this.unsupportedBoostCount = 0;
    this.contestKindCount = new Uint32Array(MOVE_CONTEST_KIND.COUNT);
  }

  eligibleGoTarget(seat, action, chance) {
    if (action !== ACTION.GO) return NONE_CELL;
    const a = this.state.arrays; const frame = this.frame();
    if (a[ARRAY.TANK_CRASH][seat] ||
        this.active(a[ARRAY.TANK_FROZEN_UNTIL][seat])) return NONE_CELL;
    if (this.active(a[ARRAY.TANK_POISON_UNTIL][seat])) {
      const applied = a[ARRAY.TANK_POISON_APPLIED][seat];
      if (applied === 0xffff || ((frame - applied) & 1) !== 0) return NONE_CELL;
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
    if (this.variant === MOVE_CONTEST_VARIANT.FAIL_CLOSED ||
        action0 !== ACTION.GO || action1 !== ACTION.GO) return;
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
    if (this.variant === MOVE_CONTEST_VARIANT.COLLISION_CRASH) {
      this.crashContest = 1; return;
    }
    if (same || swap) {
      this.blockMask = this.variant === MOVE_CONTEST_VARIANT.SEQUENTIAL_BLOCK &&
        same ? 2 : 3;
      return;
    }
    // Seat 0 executes first. Sequential semantics allow seat 1 to enter the
    // cell vacated by seat 0, while intent semantics reject every start-cell
    // claim in the original simultaneous intent batch.
    if (enter0) this.blockMask |= 1;
    if (enter1 && this.variant === MOVE_CONTEST_VARIANT.INTENT_BLOCK)
      this.blockMask |= 2;
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
    if (this.contestKind !== MOVE_CONTEST_KIND.NONE) {
      this.variantTransitionCount += 1;
      this.contestKindCount[this.contestKind] += 1;
    }
    return super.applyFrame(action0, arg0, action1, arg1, chance0, chance1);
  }
}

module.exports = { MOVE_CONTEST_VARIANT, MOVE_CONTEST_KIND,
  MoveContestVariantKernel };
