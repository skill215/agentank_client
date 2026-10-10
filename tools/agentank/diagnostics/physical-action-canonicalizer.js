"use strict";

const { CAPACITY } = require("../../../engine-v2/src/generated/fast-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, CHANCE, TERRAIN, NONE_FRAME, NONE_CELL, DX, DY,
  BOOST_COMPOUND_BASE, BOOST_COMPOUND_END } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { actionMayRelocate } = require("../../../engine-v2/src/fast/kernel");

function commandCode(ownAction, enemyAction, ownChance, enemyChance) {
  return (ownAction | enemyAction << 5 | ownChance << 10 |
    enemyChance << 12) >>> 0;
}
function argumentCode(ownArgument, enemyArgument) {
  return ((ownArgument & 0xffff) | (enemyArgument & 0xffff) << 16) >>> 0;
}

const CANONICAL_REASON = Object.freeze({
  HELD_CRASH: 1,
  HELD_FROZEN: 2,
  HELD_POISON_TICK: 4,
  SUPPRESSED_FIRE_LOCK: 8,
  SUPPRESSED_FIRE_ACTIVE_PROJECTILE: 16,
  SUPPRESSED_BOMB_COOLDOWN: 32,
  SUPPRESSED_BOMB_ACTIVE: 64,
  BLOCKED_GO_BOUNDARY: 128,
  BLOCKED_GO_TERRAIN: 256,
  BLOCKED_GO_STATIONARY_TANK: 512,
  STUN_REVERSAL_NORMALIZED: 1024,
  CHANCE_IGNORED: 2048,
  ARGUMENT_IGNORED: 4096
});
const CANONICAL_REASON_NAMES = Object.freeze(Object.keys(CANONICAL_REASON));

function active(deadline, frame) {
  return deadline !== NONE_FRAME && deadline > frame;
}

class PhysicalActionCanonicalizer {
  constructor() {
    this.action = new Uint8Array(2);
    this.chance = new Uint8Array(2);
    this.argument = new Uint16Array(2);
    this.reason = new Uint16Array(2);
    this.command = 0; this.arguments = 0; this.reasonMask = 0;
  }

  heldReason(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_CRASH][seat]) return CANONICAL_REASON.HELD_CRASH;
    if (active(a[ARRAY.TANK_FROZEN_UNTIL][seat], frame))
      return CANONICAL_REASON.HELD_FROZEN;
    if (active(a[ARRAY.TANK_POISON_UNTIL][seat], frame)) {
      const applied = a[ARRAY.TANK_POISON_APPLIED][seat];
      if (applied !== NONE_FRAME && ((frame - applied) & 1) !== 0)
        return CANONICAL_REASON.HELD_POISON_TICK;
    }
    return 0;
  }

  activeOwnProjectile(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 1;
    return 0;
  }

  activeOwnBomb(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot] &&
          a[ARRAY.BOMB_OWNER][slot] === seat) return 1;
    return 0;
  }

  firstGoBlockReason(state, seat, chance, opposingEffectiveAction) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    let direction = a[ARRAY.TANK_DIR][seat];
    if (active(a[ARRAY.TANK_STUN_UNTIL][seat], frame) &&
        chance === CHANCE.REVERSED) direction = (direction + 2) & 3;
    const cell = a[ARRAY.TANK_CELL][seat];
    const x = state.x(cell) + DX[direction];
    const y = state.y(cell) + DY[direction];
    if (x < 0 || x >= state.width || y < 0 || y >= state.height)
      return CANONICAL_REASON.BLOCKED_GO_BOUNDARY;
    const target = state.cell(x, y); const terrain = a[ARRAY.TERRAIN][target];
    if (terrain === TERRAIN.WALL || terrain === TERRAIN.DIRT)
      return CANONICAL_REASON.BLOCKED_GO_TERRAIN;
    const other = seat ^ 1;
    if (!a[ARRAY.TANK_CRASH][other] && a[ARRAY.TANK_CELL][other] === target &&
        !actionMayRelocate(opposingEffectiveAction))
      return CANONICAL_REASON.BLOCKED_GO_STATIONARY_TANK;
    return 0;
  }

  canonicalizeSeat(state, seat, action, argument, chance,
      opposingEffectiveAction) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    let reason = this.heldReason(state, seat);
    if (reason) {
      this.action[seat] = ACTION.NONE; this.argument[seat] = NONE_CELL;
      this.chance[seat] = CHANCE.NORMAL; this.reason[seat] = reason; return;
    }
    let canonicalAction = action; let canonicalChance = chance;
    let canonicalArgument = argument;
    const stunned = active(a[ARRAY.TANK_STUN_UNTIL][seat], frame);
    if (!stunned) {
      if (chance !== CHANCE.NORMAL) reason |= CANONICAL_REASON.CHANCE_IGNORED;
      canonicalChance = CHANCE.NORMAL;
    } else if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) {
      if (chance === CHANCE.REVERSED) {
        canonicalAction = action === ACTION.TURN_LEFT ?
          ACTION.TURN_RIGHT : ACTION.TURN_LEFT;
        reason |= CANONICAL_REASON.STUN_REVERSAL_NORMALIZED;
      }
      canonicalChance = CHANCE.NORMAL;
    } else if (action !== ACTION.GO &&
        (action < BOOST_COMPOUND_BASE || action > BOOST_COMPOUND_END)) {
      if (chance !== CHANCE.NORMAL) reason |= CANONICAL_REASON.CHANCE_IGNORED;
      canonicalChance = CHANCE.NORMAL;
    }
    if (canonicalAction !== ACTION.CAST_TELEPORT) {
      if (canonicalArgument !== NONE_CELL)
        reason |= CANONICAL_REASON.ARGUMENT_IGNORED;
      canonicalArgument = NONE_CELL;
    }
    if (canonicalAction === ACTION.FIRE) {
      if (active(a[ARRAY.TANK_FIRE_LOCK][seat], frame)) {
        canonicalAction = ACTION.NONE;
        reason |= CANONICAL_REASON.SUPPRESSED_FIRE_LOCK;
      } else if (this.activeOwnProjectile(state, seat)) {
        canonicalAction = ACTION.NONE;
        reason |= CANONICAL_REASON.SUPPRESSED_FIRE_ACTIVE_PROJECTILE;
      }
    } else if (canonicalAction === ACTION.THROW_BOMB) {
      if (a[ARRAY.TANK_BOMB_READY][seat] > frame) {
        canonicalAction = ACTION.NONE;
        reason |= CANONICAL_REASON.SUPPRESSED_BOMB_COOLDOWN;
      } else if (this.activeOwnBomb(state, seat)) {
        canonicalAction = ACTION.NONE;
        reason |= CANONICAL_REASON.SUPPRESSED_BOMB_ACTIVE;
      }
    } else if (canonicalAction === ACTION.GO) {
      const blocked = this.firstGoBlockReason(state, seat, canonicalChance,
        opposingEffectiveAction);
      if (blocked) { canonicalAction = ACTION.NONE; reason |= blocked; }
    }
    if (canonicalAction === ACTION.NONE) {
      canonicalArgument = NONE_CELL; canonicalChance = CHANCE.NORMAL;
    }
    this.action[seat] = canonicalAction;
    this.argument[seat] = canonicalArgument;
    this.chance[seat] = canonicalChance;
    this.reason[seat] = reason;
  }

  canonicalize(state, action0, argument0, action1, argument1,
      chance0, chance1) {
    const held0 = this.heldReason(state, 0);
    const held1 = this.heldReason(state, 1);
    const effective0 = held0 ? ACTION.NONE : action0;
    const effective1 = held1 ? ACTION.NONE : action1;
    this.canonicalizeSeat(state, 0, action0, argument0, chance0, effective1);
    this.canonicalizeSeat(state, 1, action1, argument1, chance1, effective0);
    this.command = commandCode(this.action[0], this.action[1],
      this.chance[0], this.chance[1]);
    this.arguments = argumentCode(this.argument[0], this.argument[1]);
    this.reasonMask = this.reason[0] | this.reason[1];
    return this.command;
  }
}

module.exports = { CANONICAL_REASON, CANONICAL_REASON_NAMES,
  PhysicalActionCanonicalizer, active };
