"use strict";

const { CAPACITY } = require("../generated/fast-config");
const { FAST_STATUS, TERRAIN, DIRECTION, SKILL, NONE_FRAME, NONE_CELL,
  UNKNOWN_RUNTIME } = require("../abi/fast-codes");

const ARRAY = Object.freeze({ TERRAIN: 0, TANK_CELL: 1, TANK_DIR: 2, TANK_CRASH: 3,
  TANK_STARS: 4, TANK_RUNTIME: 5, TANK_SKILL: 6, TANK_SKILL_READY: 7,
  TANK_SHIELD_HITS: 8, TANK_SHIELD_UNTIL: 9, TANK_FROZEN_UNTIL: 10,
  TANK_STUN_UNTIL: 11, TANK_OVERLOAD_UNTIL: 12, TANK_CLOAK_UNTIL: 13,
  TANK_POISON_APPLIED: 14, TANK_POISON_UNTIL: 15, TANK_BOOST_UNTIL: 16,
  TANK_REVEAL_UNTIL: 17, TANK_PICKUP_LOCK: 18, TANK_FIRE_LOCK: 19,
  TANK_BOMB_READY: 20, PROJECTILE_ACTIVE: 21, PROJECTILE_GENERATION: 22,
  PROJECTILE_ID: 23, PROJECTILE_OWNER: 24, PROJECTILE_CELL: 25, PROJECTILE_DIR: 26,
  PROJECTILE_GROUP: 27, PROJECTILE_MEMBER: 28, PROJECTILE_CREATED: 29,
  BOMB_ACTIVE: 30, BOMB_GENERATION: 31, BOMB_ID: 32, BOMB_OWNER: 33,
  BOMB_CELL: 34, BOMB_PLACED: 35, BOMB_EXPLODE: 36, SCALAR: 37 });
const SCALAR = Object.freeze({ FRAME: 0, RECORD: 1, NEXT_ENTITY: 2, TERRAIN_VERSION: 3,
  TOPOLOGY_VERSION: 4, STAR_CELL: 5, TIMEOUT_SEAT: 6, SCRIPT_ERROR_SEAT: 7,
  TERMINAL_CODE: 8, WINNER_SEAT: 9, STATE_VERSION: 10, RUNTIME_POLICY: 11 });
const TERRAIN_BY_CHAR = Object.freeze({ ".": TERRAIN.OPEN, x: TERRAIN.WALL,
  m: TERRAIN.DIRT, o: TERRAIN.GRASS });
const DIRECTION_BY_NAME = Object.freeze({ up: DIRECTION.UP, right: DIRECTION.RIGHT,
  down: DIRECTION.DOWN, left: DIRECTION.LEFT });
const SKILL_BY_NAME = Object.freeze({ shield: SKILL.SHIELD, freeze: SKILL.FREEZE,
  stun: SKILL.STUN, overload: SKILL.OVERLOAD, cloak: SKILL.CLOAK, poison: SKILL.POISON,
  teleport: SKILL.TELEPORT, boost: SKILL.BOOST });

function mix32(value) {
  let x = value >>> 0;
  x ^= x >>> 16; x = (x + ((x << 3) >>> 0)) >>> 0;
  x ^= x >>> 4; x = (x + ((x << 10) >>> 0)) >>> 0; x ^= x >>> 15;
  return x >>> 0;
}
function token(arrayId, index, value) {
  return mix32(((arrayId + 1) * 0x10001 + index * 0x101 + (value >>> 0)) >>> 0);
}
function frameValue(value) { return value === null || value === undefined ? NONE_FRAME : value; }
function runtimeValue(value) { return value === null || value === undefined ? UNKNOWN_RUNTIME : value; }
function cellOf(point, width) { return point[1] * width + point[0]; }
function xOf(cell, width) { return cell % width; }
function yOf(cell, width) { return (cell / width) | 0; }

class FastState {
  constructor(width, height, options = {}) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > CAPACITY.MAX_MAP_WIDTH || height > CAPACITY.MAX_MAP_HEIGHT) {
      throw Object.assign(new RangeError("map exceeds IMP3 capacity"),
        { code: "FAST_INCOMPLETE_ENTITY_CAPACITY" });
    }
    this.width = width; this.height = height; this.cells = width * height;
    const u8 = length => new Uint8Array(length); const u16 = length => new Uint16Array(length);
    const u32 = length => new Uint32Array(length);
    this.arrays = [];
    this.arrays[ARRAY.TERRAIN] = u8(CAPACITY.MAX_CELLS);
    this.arrays[ARRAY.TANK_CELL] = u16(2); this.arrays[ARRAY.TANK_DIR] = u8(2);
    this.arrays[ARRAY.TANK_CRASH] = u8(2); this.arrays[ARRAY.TANK_STARS] = u16(2);
    this.arrays[ARRAY.TANK_RUNTIME] = u32(2); this.arrays[ARRAY.TANK_SKILL] = u8(2);
    for (let id = ARRAY.TANK_SKILL_READY; id <= ARRAY.TANK_BOMB_READY; id += 1)
      this.arrays[id] = u16(2);
    this.arrays[ARRAY.PROJECTILE_ACTIVE] = u8(CAPACITY.MAX_PROJECTILES);
    this.arrays[ARRAY.PROJECTILE_GENERATION] = u16(CAPACITY.MAX_PROJECTILES);
    this.arrays[ARRAY.PROJECTILE_ID] = u32(CAPACITY.MAX_PROJECTILES);
    this.arrays[ARRAY.PROJECTILE_OWNER] = u8(CAPACITY.MAX_PROJECTILES);
    this.arrays[ARRAY.PROJECTILE_CELL] = u16(CAPACITY.MAX_PROJECTILES);
    this.arrays[ARRAY.PROJECTILE_DIR] = u8(CAPACITY.MAX_PROJECTILES);
    this.arrays[ARRAY.PROJECTILE_GROUP] = u32(CAPACITY.MAX_PROJECTILES);
    this.arrays[ARRAY.PROJECTILE_MEMBER] = u8(CAPACITY.MAX_PROJECTILES);
    this.arrays[ARRAY.PROJECTILE_CREATED] = u16(CAPACITY.MAX_PROJECTILES);
    this.arrays[ARRAY.BOMB_ACTIVE] = u8(CAPACITY.MAX_BOMBS);
    this.arrays[ARRAY.BOMB_GENERATION] = u16(CAPACITY.MAX_BOMBS);
    this.arrays[ARRAY.BOMB_ID] = u32(CAPACITY.MAX_BOMBS);
    this.arrays[ARRAY.BOMB_OWNER] = u8(CAPACITY.MAX_BOMBS);
    this.arrays[ARRAY.BOMB_CELL] = u16(CAPACITY.MAX_BOMBS);
    this.arrays[ARRAY.BOMB_PLACED] = u16(CAPACITY.MAX_BOMBS);
    this.arrays[ARRAY.BOMB_EXPLODE] = u16(CAPACITY.MAX_BOMBS);
    this.arrays[ARRAY.SCALAR] = u32(16);
    this.deltaArray = u8(options.deltaCapacity || CAPACITY.DELTA_CAPACITY);
    this.deltaIndex = u16(this.deltaArray.length); this.deltaOld = u32(this.deltaArray.length);
    this.eventPhase = u8(options.eventCapacity || CAPACITY.EVENT_CAPACITY);
    this.eventType = u8(this.eventPhase.length); this.eventEntity = u32(this.eventPhase.length);
    this.eventSource = u32(this.eventPhase.length); this.eventCellBefore = u16(this.eventPhase.length);
    this.eventCellAfter = u16(this.eventPhase.length); this.eventValueBefore = u32(this.eventPhase.length);
    this.eventValueAfter = u32(this.eventPhase.length); this.eventReason = u16(this.eventPhase.length);
    this.deltaUsed = 0; this.eventUsed = 0; this.transitionDeltaBase = 0;
    this.transitionEventBase = 0; this.hashLo = 0; this.hashHi = 0;
    this.highWaterDelta = 0; this.highWaterEvent = 0; this.hotAllocationCount = 0;
  }

  initializeHash() {
    let lo = 0; let hi = 0;
    for (let id = 0; id < this.arrays.length; id += 1) {
      const array = this.arrays[id];
      for (let index = 0; index < array.length; index += 1) {
        const value = array[index]; if (value !== 0) {
          const part = token(id, index, value); lo ^= part; hi ^= mix32(part ^ 0x9e3779b9);
        }
      }
    }
    this.hashLo = lo >>> 0; this.hashHi = hi >>> 0;
  }

  beginTransition() {
    this.transitionDeltaBase = this.deltaUsed; this.transitionEventBase = this.eventUsed;
    return this.deltaUsed * 1024 + this.eventUsed;
  }

  write(arrayId, index, value) {
    const array = this.arrays[arrayId]; const old = array[index];
    if (old === value) return 1;
    if (this.deltaUsed >= this.deltaArray.length ||
        this.deltaUsed - this.transitionDeltaBase >= CAPACITY.MAX_DELTAS_PER_TRANSITION) return 0;
    const cursor = this.deltaUsed++;
    this.deltaArray[cursor] = arrayId; this.deltaIndex[cursor] = index; this.deltaOld[cursor] = old;
    const oldToken = token(arrayId, index, old); const newToken = token(arrayId, index, value);
    this.hashLo = (this.hashLo ^ oldToken ^ newToken) >>> 0;
    this.hashHi = (this.hashHi ^ mix32(oldToken ^ 0x9e3779b9) ^ mix32(newToken ^ 0x9e3779b9)) >>> 0;
    array[index] = value;
    if (this.deltaUsed > this.highWaterDelta) this.highWaterDelta = this.deltaUsed;
    return 1;
  }

  emit(phase, type, entity, source, beforeCell, afterCell, beforeValue, afterValue, reason) {
    if (this.eventUsed >= this.eventPhase.length ||
        this.eventUsed - this.transitionEventBase >= CAPACITY.MAX_EVENTS_PER_TRANSITION) return 0;
    const at = this.eventUsed++;
    this.eventPhase[at] = phase; this.eventType[at] = type;
    this.eventEntity[at] = entity >>> 0; this.eventSource[at] = source >>> 0;
    this.eventCellBefore[at] = beforeCell; this.eventCellAfter[at] = afterCell;
    this.eventValueBefore[at] = beforeValue >>> 0; this.eventValueAfter[at] = afterValue >>> 0;
    this.eventReason[at] = reason;
    if (this.eventUsed > this.highWaterEvent) this.highWaterEvent = this.eventUsed;
    return 1;
  }

  undoTo(mark) {
    const deltaMark = (mark / 1024) | 0; const eventMark = mark - deltaMark * 1024;
    while (this.deltaUsed > deltaMark) {
      const cursor = --this.deltaUsed; const id = this.deltaArray[cursor];
      const index = this.deltaIndex[cursor]; const array = this.arrays[id];
      const current = array[index]; const old = this.deltaOld[cursor];
      const currentToken = token(id, index, current); const oldToken = token(id, index, old);
      this.hashLo = (this.hashLo ^ currentToken ^ oldToken) >>> 0;
      this.hashHi = (this.hashHi ^ mix32(currentToken ^ 0x9e3779b9) ^
        mix32(oldToken ^ 0x9e3779b9)) >>> 0;
      array[index] = old;
    }
    this.eventUsed = eventMark; return FAST_STATUS.APPLIED;
  }

  cell(x, y) { return y * this.width + x; }
  x(cell) { return xOf(cell, this.width); }
  y(cell) { return yOf(cell, this.width); }
  activeProjectileCount() { let count = 0; const active = this.arrays[ARRAY.PROJECTILE_ACTIVE];
    for (let index = 0; index < active.length; index += 1) count += active[index]; return count; }
  activeBombCount() { let count = 0; const active = this.arrays[ARRAY.BOMB_ACTIVE];
    for (let index = 0; index < active.length; index += 1) count += active[index]; return count; }
  rootSignature() { return `${this.hashLo.toString(16)}:${this.hashHi.toString(16)}:` +
    `${this.deltaUsed}:${this.eventUsed}`; }
}

function importPhysicalState(spec, options = {}) {
  let state;
  try { state = new FastState(spec.map.width, spec.map.height, options); }
  catch (error) { return { status: FAST_STATUS.INCOMPLETE_ENTITY_CAPACITY, state: null,
    errorCode: error.code || "FAST_INCOMPLETE_ENTITY_CAPACITY" }; }
  if (!Array.isArray(spec.tanks) || spec.tanks.length !== 2 ||
      (spec.projectiles || []).length > CAPACITY.MAX_PROJECTILES ||
      (spec.bombs || []).length > CAPACITY.MAX_BOMBS) {
    return { status: FAST_STATUS.INCOMPLETE_ENTITY_CAPACITY, state: null,
      errorCode: "FAST_INCOMPLETE_ENTITY_CAPACITY" };
  }
  const arrays = state.arrays;
  for (let x = 0; x < state.width; x += 1) for (let y = 0; y < state.height; y += 1) {
    const value = TERRAIN_BY_CHAR[spec.map.terrainColumnMajor[x][y]];
    if (value === undefined) return { status: FAST_STATUS.INCOMPLETE_STATE, state: null,
      errorCode: "FAST_INCOMPLETE_STATE" };
    arrays[ARRAY.TERRAIN][cellOf([x, y], state.width)] = value;
  }
  for (const tank of spec.tanks) {
    const seat = tank.seat; const direction = DIRECTION_BY_NAME[tank.direction];
    if ((seat !== 0 && seat !== 1) || direction === undefined) return {
      status: FAST_STATUS.INCOMPLETE_STATE, state: null, errorCode: "FAST_INCOMPLETE_STATE" };
    arrays[ARRAY.TANK_CELL][seat] = cellOf(tank.cell, state.width);
    arrays[ARRAY.TANK_DIR][seat] = direction; arrays[ARRAY.TANK_CRASH][seat] = tank.crashed ? 1 : 0;
    arrays[ARRAY.TANK_STARS][seat] = tank.stars || 0;
    arrays[ARRAY.TANK_RUNTIME][seat] = runtimeValue(tank.runtimeMs);
    arrays[ARRAY.TANK_SKILL][seat] = SKILL_BY_NAME[tank.skillId] || SKILL.NONE;
    arrays[ARRAY.TANK_SKILL_READY][seat] = tank.skillReadyFrame || 0;
    arrays[ARRAY.TANK_SHIELD_HITS][seat] = tank.shieldHitsRemaining || 0;
    arrays[ARRAY.TANK_SHIELD_UNTIL][seat] = frameValue(tank.shieldUntilFrame);
    arrays[ARRAY.TANK_FROZEN_UNTIL][seat] = frameValue(tank.frozenUntilFrame);
    arrays[ARRAY.TANK_STUN_UNTIL][seat] = frameValue(tank.stunUntilFrame);
    arrays[ARRAY.TANK_OVERLOAD_UNTIL][seat] = frameValue(tank.overloadUntilFrame);
    arrays[ARRAY.TANK_CLOAK_UNTIL][seat] = frameValue(tank.cloakUntilFrame);
    arrays[ARRAY.TANK_POISON_APPLIED][seat] = frameValue(tank.poisonAppliedFrame);
    arrays[ARRAY.TANK_POISON_UNTIL][seat] = frameValue(tank.poisonUntilFrame);
    arrays[ARRAY.TANK_BOOST_UNTIL][seat] = frameValue(tank.boostUntilFrame);
    arrays[ARRAY.TANK_REVEAL_UNTIL][seat] = frameValue(tank.revealUntilFrame);
    arrays[ARRAY.TANK_PICKUP_LOCK][seat] = frameValue(tank.pickupLockUntilFrame);
    arrays[ARRAY.TANK_FIRE_LOCK][seat] = frameValue(tank.fireLockUntilFrame);
    arrays[ARRAY.TANK_BOMB_READY][seat] = tank.bombCooldownReadyFrame || 0;
  }
  let maxId = 2;
  for (let slot = 0; slot < (spec.projectiles || []).length; slot += 1) {
    const item = spec.projectiles[slot]; const id = item.entityId || maxId + 1; maxId = Math.max(maxId, id);
    arrays[ARRAY.PROJECTILE_ACTIVE][slot] = item.active === false ? 0 : 1;
    arrays[ARRAY.PROJECTILE_GENERATION][slot] = 1; arrays[ARRAY.PROJECTILE_ID][slot] = id;
    arrays[ARRAY.PROJECTILE_OWNER][slot] = item.ownerSeat;
    arrays[ARRAY.PROJECTILE_CELL][slot] = cellOf(item.cell, state.width);
    arrays[ARRAY.PROJECTILE_DIR][slot] = DIRECTION_BY_NAME[item.direction];
    arrays[ARRAY.PROJECTILE_GROUP][slot] = item.shotGroupId || id;
    arrays[ARRAY.PROJECTILE_MEMBER][slot] = item.memberIndex || 0;
    arrays[ARRAY.PROJECTILE_CREATED][slot] = item.createdFrame ?? spec.platformFrame;
  }
  for (let slot = 0; slot < (spec.bombs || []).length; slot += 1) {
    const item = spec.bombs[slot]; const id = item.entityId || maxId + 1; maxId = Math.max(maxId, id);
    arrays[ARRAY.BOMB_ACTIVE][slot] = item.active === false ? 0 : 1;
    arrays[ARRAY.BOMB_GENERATION][slot] = 1; arrays[ARRAY.BOMB_ID][slot] = id;
    arrays[ARRAY.BOMB_OWNER][slot] = item.ownerSeat;
    arrays[ARRAY.BOMB_CELL][slot] = cellOf(item.cell, state.width);
    arrays[ARRAY.BOMB_PLACED][slot] = item.placedFrame ?? item.explodeFrame - 10;
    arrays[ARRAY.BOMB_EXPLODE][slot] = item.explodeFrame;
  }
  const scalar = arrays[ARRAY.SCALAR]; scalar[SCALAR.FRAME] = spec.platformFrame;
  scalar[SCALAR.RECORD] = spec.recordIndex ?? spec.platformFrame;
  scalar[SCALAR.NEXT_ENTITY] = Math.max(spec.nextEntityId || 0, maxId + 1);
  scalar[SCALAR.TERRAIN_VERSION] = spec.map.terrainVersion || 0;
  scalar[SCALAR.TOPOLOGY_VERSION] = spec.map.topologyVersion || 0;
  scalar[SCALAR.STAR_CELL] = spec.star ? cellOf(spec.star.cell || spec.star, state.width) : NONE_CELL;
  scalar[SCALAR.TIMEOUT_SEAT] = spec.terminalFlags?.timeoutSeat ?? 2;
  scalar[SCALAR.SCRIPT_ERROR_SEAT] = spec.terminalFlags?.scriptErrorSeat ?? 2;
  scalar[SCALAR.RUNTIME_POLICY] = spec.runtimeOrderAssumption === "OWN_SLOWER" ? 1 : 0;
  scalar[SCALAR.WINNER_SEAT] = 2; state.initializeHash();
  return { status: FAST_STATUS.APPLIED, state, errorCode: null };
}

module.exports = { ARRAY, SCALAR, FastState, importPhysicalState, cellOf, xOf, yOf,
  TERRAIN_BY_CHAR, DIRECTION_BY_NAME, SKILL_BY_NAME };
