"use strict";

const fast = require("../../engine-v2/src/fast");

const ACTION_BY_COMMAND = Object.freeze({ GO: fast.ACTION.GO, TURN_LEFT: fast.ACTION.TURN_LEFT,
  TURN_RIGHT: fast.ACTION.TURN_RIGHT, FIRE: fast.ACTION.FIRE, THROW_BOMB: fast.ACTION.THROW_BOMB,
  CAST_SHIELD: fast.ACTION.CAST_SHIELD, CAST_FREEZE: fast.ACTION.CAST_FREEZE,
  CAST_STUN: fast.ACTION.CAST_STUN, CAST_OVERLOAD: fast.ACTION.CAST_OVERLOAD,
  CAST_CLOAK: fast.ACTION.CAST_CLOAK, CAST_POISON: fast.ACTION.CAST_POISON,
  CAST_TELEPORT: fast.ACTION.CAST_TELEPORT, CAST_BOOST: fast.ACTION.CAST_BOOST });

function boxedMap(width = 7, height = 5) {
  return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "x" : "."));
}
function tank(seat, cell, direction, extra = {}) {
  return { entityId: seat + 1, seat, cell, direction, crashed: false, stars: 0, runtimeMs: 0,
    skillId: null, skillReadyFrame: 0, shieldHitsRemaining: 0, shieldUntilFrame: null,
    frozenUntilFrame: null, stunUntilFrame: null, overloadUntilFrame: null,
    cloakUntilFrame: null, poisonAppliedFrame: null, poisonUntilFrame: null,
    boostUntilFrame: null, revealUntilFrame: null, pickupLockUntilFrame: null,
    fireLockUntilFrame: null, bombCooldownReadyFrame: 0, ...extra };
}
function physical(overrides = {}) {
  const map = overrides.map || { width: 7, height: 5, terrainColumnMajor: boxedMap() };
  return { platformFrame: 0, recordIndex: 0, map,
    tanks: [tank(0, [1, 1], "right"), tank(1, [5, 3], "left")], projectiles: [],
    bombs: [], star: null, terminalFlags: { timeoutSeat: null, scriptErrorSeat: null }, ...overrides };
}
function commandAction(tankState, width) {
  const command = tankState.queue?.[0]; if (!command) return [fast.ACTION.NONE, fast.NONE_CELL];
  const record = typeof command === "string" ? { command } : command;
  const argument = record.targetCell ? record.targetCell[1] * width + record.targetCell[0] : fast.NONE_CELL;
  return [ACTION_BY_COMMAND[record.command], argument];
}
function fastSnapshot(state) {
  const a = state.arrays; const scalar = a[fast.ARRAY.SCALAR];
  const terrain = Array.from({ length: state.width }, (_, x) => Array.from({ length: state.height },
    (_, y) => a[fast.ARRAY.TERRAIN][y * state.width + x]));
  const tanks = [0, 1].map(seat => ({ cell: a[fast.ARRAY.TANK_CELL][seat],
    direction: a[fast.ARRAY.TANK_DIR][seat], crashed: a[fast.ARRAY.TANK_CRASH][seat],
    stars: a[fast.ARRAY.TANK_STARS][seat], runtimeMs: a[fast.ARRAY.TANK_RUNTIME][seat],
    skillReadyFrame: a[fast.ARRAY.TANK_SKILL_READY][seat],
    shieldHitsRemaining: a[fast.ARRAY.TANK_SHIELD_HITS][seat],
    shieldUntilFrame: a[fast.ARRAY.TANK_SHIELD_UNTIL][seat],
    frozenUntilFrame: a[fast.ARRAY.TANK_FROZEN_UNTIL][seat] }));
  const projectiles = []; for (let slot = 0; slot < a[fast.ARRAY.PROJECTILE_ACTIVE].length; slot += 1)
    if (a[fast.ARRAY.PROJECTILE_ACTIVE][slot]) projectiles.push({
      id: a[fast.ARRAY.PROJECTILE_ID][slot], owner: a[fast.ARRAY.PROJECTILE_OWNER][slot],
      cell: a[fast.ARRAY.PROJECTILE_CELL][slot], direction: a[fast.ARRAY.PROJECTILE_DIR][slot],
      group: a[fast.ARRAY.PROJECTILE_GROUP][slot], member: a[fast.ARRAY.PROJECTILE_MEMBER][slot] });
  const bombs = []; for (let slot = 0; slot < a[fast.ARRAY.BOMB_ACTIVE].length; slot += 1)
    if (a[fast.ARRAY.BOMB_ACTIVE][slot]) bombs.push({ id: a[fast.ARRAY.BOMB_ID][slot],
      owner: a[fast.ARRAY.BOMB_OWNER][slot], cell: a[fast.ARRAY.BOMB_CELL][slot],
      explode: a[fast.ARRAY.BOMB_EXPLODE][slot] });
  return { frame: scalar[fast.SCALAR.FRAME], record: scalar[fast.SCALAR.RECORD],
    terrain, tanks, projectiles, bombs, star: scalar[fast.SCALAR.STAR_CELL],
    terminal: scalar[fast.SCALAR.TERMINAL_CODE], winner: scalar[fast.SCALAR.WINNER_SEAT] };
}

module.exports = { fast, boxedMap, tank, physical, commandAction, fastSnapshot };
