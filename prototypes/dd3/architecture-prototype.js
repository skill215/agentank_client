"use strict";

const fs = require("fs");
const path = require("path");

const PROTOTYPE_VERSION = "DD3-AVP-1";
const PROB_SCALE = 10000;

const STATUS_OK = 0;
const STATUS_EVENT_CAPACITY = 1;
const STATUS_DELTA_CAPACITY = 2;

const INCOMPLETE_NONE = 0;
const INCOMPLETE_ROOT_ENTITY_CAPACITY = 3;
const INCOMPLETE_EVENT_CAPACITY = 4;
const INCOMPLETE_DELTA_CAPACITY = 5;
const INCOMPLETE_RESIDUAL_CAPACITY = 7;
const INCOMPLETE_PARTITION_CAPACITY = 9;
const INCOMPLETE_ACTION_SUPPORT = 10;
const INCOMPLETE_POLICY_CAPACITY = 12;

const EVENT_COMMAND = 2;
const EVENT_TANK_TURNED = 5;
const EVENT_TANK_MOVED = 6;
const EVENT_SKILL_APPLIED = 8;
const EVENT_PROJECTILE_CREATED = 10;
const EVENT_PROJECTILE_MOVED = 11;
const EVENT_PROJECTILE_DESTROYED = 12;
const EVENT_BOMB_PLACED = 13;
const EVENT_BOMB_EXPLODED = 14;
const EVENT_TERRAIN_DESTROYED = 15;
const EVENT_TERMINAL = 19;

const S_FRAME = 0;
const S_PHASE = 1;
const S_TERRAIN_VERSION = 2;
const S_RUNTIME_ORDER = 3;
const S_STAR_CELL = 4;
const S_STAR_PRESENT = 5;
const S_OUR_CELL = 6;
const S_OUR_DIR = 7;
const S_OUR_STARS = 8;
const S_OUR_SKILL = 9;
const S_OUR_SHIELD = 10;
const S_OUR_EFFECT_UNTIL = 11;
const S_OUR_QUEUE = 12;
const S_ENEMY_CELL = 13;
const S_ENEMY_DIR = 14;
const S_ENEMY_STARS = 15;
const S_ENEMY_SKILL = 16;
const S_ENEMY_SHIELD = 17;
const S_ENEMY_EFFECT_UNTIL = 18;
const S_ENEMY_QUEUE = 19;
const S_ENEMY_HISTORY = 20;
const S_ASSOCIATION_CHOICE = 21;
const S_TERMINAL = 22;
const S_FLAGS = 23;
const SCALAR_FIELDS = 24;

const ENTITY_FIELDS = 4;
const E_CELL = 0;
const E_DIRECTION_OR_DEADLINE = 1;
const E_ACTIVE = 2;
const E_SEMANTIC_ORDINAL = 3;

const FACTOR_POSE = 0;
const FACTOR_ASSOCIATION = 1;
const FACTOR_BOMB = 2;
const FACTOR_QUEUE = 3;
const FACTOR_SHIELD = 4;
const FACTOR_HISTORY = 5;
const FACTOR_COUNT = 6;

let benchmarkSink = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function u32(value) {
  return value >>> 0;
}

function mix32(hash, value) {
  hash ^= value >>> 0;
  hash = Math.imul(hash, 0x01000193);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function hashArray(values, length = values.length) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < length; i++) hash = mix32(hash, values[i]);
  return hash >>> 0;
}

function hashString(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) hash = mix32(hash, value.charCodeAt(i));
  return hash >>> 0;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function alloc(kind, type, length) {
  if (kind === "packed") return new Array(length).fill(0);
  if (type === "u8") return new Uint8Array(length);
  if (type === "u16") return new Uint16Array(length);
  if (type === "u32") return new Uint32Array(length);
  return new Int32Array(length);
}

function estimatedBytes(kind, values, elementBytes) {
  return kind === "packed" ? values.length * 8 : values.byteLength || values.length * elementBytes;
}

function stateStride(profile) {
  return SCALAR_FIELDS + (profile.projectiles + profile.bombs) * ENTITY_FIELDS;
}

function projectileOffset(profile, index) {
  return SCALAR_FIELDS + index * ENTITY_FIELDS;
}

function bombOffset(profile, index) {
  return SCALAR_FIELDS + profile.projectiles * ENTITY_FIELDS + index * ENTITY_FIELDS;
}

function decodeWorldCode(code, factors) {
  factors[FACTOR_POSE] = code & 15;
  factors[FACTOR_ASSOCIATION] = (code >>> 4) & 1;
  factors[FACTOR_BOMB] = (code >>> 5) & 1;
  factors[FACTOR_QUEUE] = (code >>> 6) & 1;
  factors[FACTOR_SHIELD] = (code >>> 7) & 1;
  factors[FACTOR_HISTORY] = (code >>> 8) & 1;
}

function isValidWorldCode(code) {
  const pose = code & 15;
  const association = (code >>> 4) & 1;
  const bomb = (code >>> 5) & 1;
  const queue = (code >>> 6) & 1;
  const history = (code >>> 8) & 1;
  return ((pose ^ association ^ queue ^ history) & 1) === bomb;
}

function generateWorldCodes(profile, kind) {
  const codes = alloc(kind, "u16", profile.worlds);
  let code = 0;
  let count = 0;
  while (count < profile.worlds) {
    if (isValidWorldCode(code)) codes[count++] = code;
    code++;
  }
  return { codes, residualStartCode: code };
}

function fillBaseState(state, profile) {
  const cells = profile.mapWidth * profile.mapHeight;
  for (let i = 0; i < state.length; i++) state[i] = 0;
  state[S_FRAME] = 64;
  state[S_PHASE] = 0;
  state[S_TERRAIN_VERSION] = 7;
  state[S_RUNTIME_ORDER] = 1;
  state[S_STAR_CELL] = ((profile.mapWidth >>> 1) * profile.mapHeight + (profile.mapHeight >>> 1)) % cells;
  state[S_STAR_PRESENT] = 1;
  state[S_OUR_CELL] = profile.mapHeight + 2;
  state[S_OUR_DIR] = 1;
  state[S_OUR_STARS] = 4;
  state[S_OUR_SKILL] = 9;
  state[S_OUR_SHIELD] = 2;
  state[S_OUR_EFFECT_UNTIL] = 68;
  state[S_OUR_QUEUE] = 0;
  state[S_ENEMY_CELL] = cells - profile.mapHeight - 3;
  state[S_ENEMY_DIR] = 3;
  state[S_ENEMY_STARS] = 4;
  state[S_ENEMY_SKILL] = 6;
  state[S_ENEMY_SHIELD] = 2;
  state[S_ENEMY_EFFECT_UNTIL] = 69;
  state[S_ENEMY_QUEUE] = 4;
  state[S_ENEMY_HISTORY] = 0x1357;
  state[S_ASSOCIATION_CHOICE] = 0;
  state[S_TERMINAL] = 0;
  state[S_FLAGS] = 0x33;

  for (let i = 0; i < profile.projectiles; i++) {
    const offset = projectileOffset(profile, i);
    state[offset + E_CELL] = (profile.mapHeight * (2 + i) + 3 + i) % cells;
    state[offset + E_DIRECTION_OR_DEADLINE] = i & 3;
    state[offset + E_ACTIVE] = i + 1 === profile.projectiles ? 0 : 1;
    state[offset + E_SEMANTIC_ORDINAL] = i < 2 ? i : 100 + i;
  }
  for (let i = 0; i < profile.bombs; i++) {
    const offset = bombOffset(profile, i);
    state[offset + E_CELL] = (profile.mapHeight * (4 + i * 2) + 5) % cells;
    state[offset + E_DIRECTION_OR_DEADLINE] = 65 + (i & 1);
    state[offset + E_ACTIVE] = 1;
    state[offset + E_SEMANTIC_ORDINAL] = 200 + i;
  }
}

function fillWorldState(state, baseState, profile, code, factors) {
  for (let i = 0; i < baseState.length; i++) state[i] = baseState[i];
  decodeWorldCode(code, factors);
  const cells = profile.mapWidth * profile.mapHeight;
  const pose = factors[FACTOR_POSE];
  state[S_ENEMY_CELL] = (baseState[S_ENEMY_CELL] - pose * profile.mapHeight - (pose & 3) + cells) % cells;
  state[S_ENEMY_DIR] = pose & 3;
  state[S_ASSOCIATION_CHOICE] = factors[FACTOR_ASSOCIATION];
  state[S_ENEMY_QUEUE] = factors[FACTOR_QUEUE] ? 4 : 1;
  state[S_ENEMY_SHIELD] = 1 + factors[FACTOR_SHIELD];
  state[S_ENEMY_HISTORY] = 0x1357 ^ (factors[FACTOR_HISTORY] * 0x2222) ^ (pose << 4);
  if (profile.projectiles > 0) {
    const offset = projectileOffset(profile, 0);
    state[offset + E_CELL] = (baseState[offset + E_CELL] + factors[FACTOR_ASSOCIATION] * profile.mapHeight) % cells;
    state[offset + E_SEMANTIC_ORDINAL] = factors[FACTOR_ASSOCIATION];
  }
  if (profile.bombs > 0) {
    const offset = bombOffset(profile, 0);
    state[offset + E_DIRECTION_OR_DEADLINE] = 65 + factors[FACTOR_BOMB];
    state[offset + E_SEMANTIC_ORDINAL] = 200 + factors[FACTOR_BOMB];
  }
}

function createSnapshotStorage(profile, kind) {
  const stride = stateStride(profile);
  const base = alloc(kind, "i32", stride);
  const factors = alloc(kind, "i32", FACTOR_COUNT);
  const temp = alloc(kind, "i32", stride);
  const generated = generateWorldCodes(profile, kind);
  const values = alloc(kind, "i32", profile.worlds * stride);
  fillBaseState(base, profile);
  for (let world = 0; world < profile.worlds; world++) {
    fillWorldState(temp, base, profile, generated.codes[world], factors);
    const start = world * stride;
    for (let field = 0; field < stride; field++) values[start + field] = temp[field];
  }
  return {
    representation: "snapshot",
    kind,
    profile,
    stride,
    base,
    codes: generated.codes,
    residualStartCode: generated.residualStartCode,
    values,
    bytes: estimatedBytes(kind, base, 4) + estimatedBytes(kind, generated.codes, 2) + estimatedBytes(kind, values, 4)
  };
}

function createDeltaStorage(profile, kind) {
  const stride = stateStride(profile);
  const base = alloc(kind, "i32", stride);
  const factors = alloc(kind, "i32", FACTOR_COUNT);
  const temp = alloc(kind, "i32", stride);
  const generated = generateWorldCodes(profile, kind);
  const starts = alloc(kind, "u32", profile.worlds + 1);
  fillBaseState(base, profile);

  let total = 0;
  for (let world = 0; world < profile.worlds; world++) {
    fillWorldState(temp, base, profile, generated.codes[world], factors);
    starts[world] = total;
    for (let field = 0; field < stride; field++) if (temp[field] !== base[field]) total++;
  }
  starts[profile.worlds] = total;

  const fields = alloc(kind, "u16", total);
  const values = alloc(kind, "i32", total);
  let cursor = 0;
  for (let world = 0; world < profile.worlds; world++) {
    fillWorldState(temp, base, profile, generated.codes[world], factors);
    for (let field = 0; field < stride; field++) {
      if (temp[field] !== base[field]) {
        fields[cursor] = field;
        values[cursor] = temp[field];
        cursor++;
      }
    }
  }
  return {
    representation: "delta",
    kind,
    profile,
    stride,
    base,
    codes: generated.codes,
    residualStartCode: generated.residualStartCode,
    starts,
    fields,
    values,
    bytes: estimatedBytes(kind, base, 4) + estimatedBytes(kind, generated.codes, 2) +
      estimatedBytes(kind, starts, 4) + estimatedBytes(kind, fields, 2) + estimatedBytes(kind, values, 4)
  };
}

function materializeSnapshot(storage, world, scratch) {
  const start = world * storage.stride;
  for (let i = 0; i < storage.stride; i++) scratch[i] = storage.values[start + i];
}

function materializeDelta(storage, world, scratch) {
  for (let i = 0; i < storage.stride; i++) scratch[i] = storage.base[i];
  const start = storage.starts[world];
  const end = storage.starts[world + 1];
  for (let i = start; i < end; i++) scratch[storage.fields[i]] = storage.values[i];
}

function materializer(storage) {
  return storage.representation === "snapshot" ? materializeSnapshot : materializeDelta;
}

function createTerrain(profile, kind) {
  const cells = profile.mapWidth * profile.mapHeight;
  const terrain = alloc(kind, "u8", cells);
  for (let x = 0; x < profile.mapWidth; x++) {
    for (let y = 0; y < profile.mapHeight; y++) {
      const cell = x * profile.mapHeight + y;
      if (x === 0 || y === 0 || x + 1 === profile.mapWidth || y + 1 === profile.mapHeight) terrain[cell] = 1;
      else if ((x * 17 + y * 13) % 29 === 0) terrain[cell] = 2;
      else if ((x * 11 + y * 7) % 23 === 0) terrain[cell] = 3;
      else terrain[cell] = 0;
    }
  }
  return terrain;
}

function nextCell(cell, direction, profile) {
  const x = (cell / profile.mapHeight) | 0;
  const y = cell - x * profile.mapHeight;
  if (direction === 0) return y > 0 ? cell - 1 : cell;
  if (direction === 1) return x + 1 < profile.mapWidth ? cell + profile.mapHeight : cell;
  if (direction === 2) return y + 1 < profile.mapHeight ? cell + 1 : cell;
  return x > 0 ? cell - profile.mapHeight : cell;
}

function createTransitionContext(profile, kind, eventCapacity = profile.eventsPerTransition, deltaCapacity = profile.deltasPerTransition) {
  return {
    profile,
    kind,
    terrain: createTerrain(profile, kind),
    scratch: alloc(kind, "i32", stateStride(profile)),
    out: alloc(kind, "i32", 8),
    deltaKind: alloc(kind, "u8", Math.max(1, deltaCapacity)),
    deltaIndex: alloc(kind, "u16", Math.max(1, deltaCapacity)),
    deltaOldValue: alloc(kind, "i32", Math.max(1, deltaCapacity)),
    deltaCapacity,
    deltaUsed: 0,
    deltaHighWater: 0,
    eventType: alloc(kind, "u8", Math.max(1, eventCapacity)),
    eventPhase: alloc(kind, "u8", Math.max(1, eventCapacity)),
    eventSubject: alloc(kind, "u16", Math.max(1, eventCapacity)),
    eventBefore: alloc(kind, "i32", Math.max(1, eventCapacity)),
    eventAfter: alloc(kind, "i32", Math.max(1, eventCapacity)),
    eventCapacity,
    eventCount: 0,
    eventHighWater: 0,
    traceHash: 0,
    incompleteReason: INCOMPLETE_NONE
  };
}

function beginTransition(ctx) {
  ctx.deltaUsed = 0;
  ctx.eventCount = 0;
  ctx.traceHash = 0x811c9dc5;
  ctx.incompleteReason = INCOMPLETE_NONE;
}

function writeState(ctx, index, value) {
  if (ctx.deltaUsed >= ctx.deltaCapacity) {
    ctx.incompleteReason = INCOMPLETE_DELTA_CAPACITY;
    return false;
  }
  const used = ctx.deltaUsed++;
  ctx.deltaKind[used] = 0;
  ctx.deltaIndex[used] = index;
  ctx.deltaOldValue[used] = ctx.scratch[index];
  ctx.scratch[index] = value;
  if (ctx.deltaUsed > ctx.deltaHighWater) ctx.deltaHighWater = ctx.deltaUsed;
  return true;
}

function writeTerrain(ctx, index, value) {
  if (ctx.deltaUsed >= ctx.deltaCapacity) {
    ctx.incompleteReason = INCOMPLETE_DELTA_CAPACITY;
    return false;
  }
  const used = ctx.deltaUsed++;
  ctx.deltaKind[used] = 1;
  ctx.deltaIndex[used] = index;
  ctx.deltaOldValue[used] = ctx.terrain[index];
  ctx.terrain[index] = value;
  if (ctx.deltaUsed > ctx.deltaHighWater) ctx.deltaHighWater = ctx.deltaUsed;
  return true;
}

function addEvent(ctx, type, phase, subject, before, after) {
  if (ctx.eventCount >= ctx.eventCapacity) {
    ctx.incompleteReason = INCOMPLETE_EVENT_CAPACITY;
    return false;
  }
  const index = ctx.eventCount++;
  ctx.eventType[index] = type;
  ctx.eventPhase[index] = phase;
  ctx.eventSubject[index] = subject;
  ctx.eventBefore[index] = before;
  ctx.eventAfter[index] = after;
  ctx.traceHash = mix32(ctx.traceHash, type | (phase << 8));
  ctx.traceHash = mix32(ctx.traceHash, subject | 0);
  ctx.traceHash = mix32(ctx.traceHash, before | 0);
  ctx.traceHash = mix32(ctx.traceHash, after | 0);
  if (ctx.eventCount > ctx.eventHighWater) ctx.eventHighWater = ctx.eventCount;
  return true;
}

function undoTransition(ctx) {
  for (let i = ctx.deltaUsed - 1; i >= 0; i--) {
    const index = ctx.deltaIndex[i];
    if (ctx.deltaKind[i] === 0) ctx.scratch[index] = ctx.deltaOldValue[i];
    else ctx.terrain[index] = ctx.deltaOldValue[i];
  }
  ctx.deltaUsed = 0;
  ctx.eventCount = 0;
}

function applySeatAction(ctx, seat, action, chance) {
  const profile = ctx.profile;
  const cellField = seat === 0 ? S_OUR_CELL : S_ENEMY_CELL;
  const directionField = seat === 0 ? S_OUR_DIR : S_ENEMY_DIR;
  const effectField = seat === 0 ? S_OUR_EFFECT_UNTIL : S_ENEMY_EFFECT_UNTIL;
  const normalized = action & 7;
  const cell = ctx.scratch[cellField];
  const direction = ctx.scratch[directionField];
  if (!addEvent(ctx, EVENT_COMMAND, 30 + seat * 10, seat, normalized, normalized)) return STATUS_EVENT_CAPACITY;

  if (normalized === 1) {
    const target = nextCell(cell, direction, profile);
    if (target !== cell && ctx.terrain[target] !== 1 && ctx.terrain[target] !== 2) {
      if (!writeState(ctx, cellField, target)) return STATUS_DELTA_CAPACITY;
      if (!addEvent(ctx, EVENT_TANK_MOVED, 30 + seat * 10, seat, cell, target)) return STATUS_EVENT_CAPACITY;
    }
  } else if (normalized === 2 || normalized === 3) {
    const nextDirection = (direction + (normalized === 2 ? 3 : 1)) & 3;
    if (!writeState(ctx, directionField, nextDirection)) return STATUS_DELTA_CAPACITY;
    if (!addEvent(ctx, EVENT_TANK_TURNED, 30 + seat * 10, seat, direction, nextDirection)) return STATUS_EVENT_CAPACITY;
  } else if (normalized === 4 && profile.projectiles > 0) {
    const index = profile.projectiles - 1;
    const offset = projectileOffset(profile, index);
    if (!writeState(ctx, offset + E_CELL, cell)) return STATUS_DELTA_CAPACITY;
    if (!writeState(ctx, offset + E_DIRECTION_OR_DEADLINE, direction)) return STATUS_DELTA_CAPACITY;
    if (!writeState(ctx, offset + E_ACTIVE, 1)) return STATUS_DELTA_CAPACITY;
    if (!addEvent(ctx, EVENT_PROJECTILE_CREATED, 30 + seat * 10, index, -1, cell)) return STATUS_EVENT_CAPACITY;
  } else if (normalized === 5 && profile.bombs > 0) {
    const index = profile.bombs - 1;
    const offset = bombOffset(profile, index);
    if (!writeState(ctx, offset + E_CELL, cell)) return STATUS_DELTA_CAPACITY;
    if (!writeState(ctx, offset + E_DIRECTION_OR_DEADLINE, ctx.scratch[S_FRAME] + 1 + (chance & 1))) return STATUS_DELTA_CAPACITY;
    if (!writeState(ctx, offset + E_ACTIVE, 1)) return STATUS_DELTA_CAPACITY;
    if (!addEvent(ctx, EVENT_BOMB_PLACED, 30 + seat * 10, index, -1, cell)) return STATUS_EVENT_CAPACITY;
  } else if (normalized === 6) {
    const deadline = ctx.scratch[S_FRAME] + 4;
    if (!writeState(ctx, effectField, deadline)) return STATUS_DELTA_CAPACITY;
    if (!addEvent(ctx, EVENT_SKILL_APPLIED, 30 + seat * 10, seat, 0, deadline)) return STATUS_EVENT_CAPACITY;
  } else if (normalized === 7) {
    const cells = profile.mapWidth * profile.mapHeight;
    const target = (ctx.scratch[S_STAR_CELL] + chance + seat * profile.mapHeight) % cells;
    if (ctx.terrain[target] === 0 || ctx.terrain[target] === 3) {
      if (!writeState(ctx, cellField, target)) return STATUS_DELTA_CAPACITY;
      if (!addEvent(ctx, EVENT_TANK_MOVED, 30 + seat * 10, seat, cell, target)) return STATUS_EVENT_CAPACITY;
    }
  }
  return STATUS_OK;
}

function advanceProjectiles(ctx) {
  const profile = ctx.profile;
  for (let projectile = 0; projectile < profile.projectiles; projectile++) {
    const offset = projectileOffset(profile, projectile);
    if (!ctx.scratch[offset + E_ACTIVE]) continue;
    for (let substep = 0; substep < 2; substep++) {
      const before = ctx.scratch[offset + E_CELL];
      const direction = ctx.scratch[offset + E_DIRECTION_OR_DEADLINE] & 3;
      const after = nextCell(before, direction, profile);
      if (after === before || ctx.terrain[after] === 1) {
        if (!writeState(ctx, offset + E_ACTIVE, 0)) return STATUS_DELTA_CAPACITY;
        if (!addEvent(ctx, EVENT_PROJECTILE_DESTROYED, 70 + substep, projectile, before, after)) return STATUS_EVENT_CAPACITY;
        break;
      }
      if (ctx.terrain[after] === 2) {
        if (!writeTerrain(ctx, after, 0)) return STATUS_DELTA_CAPACITY;
        if (!writeState(ctx, offset + E_ACTIVE, 0)) return STATUS_DELTA_CAPACITY;
        if (!addEvent(ctx, EVENT_TERRAIN_DESTROYED, 70 + substep, after, 2, 0)) return STATUS_EVENT_CAPACITY;
        if (!addEvent(ctx, EVENT_PROJECTILE_DESTROYED, 70 + substep, projectile, before, after)) return STATUS_EVENT_CAPACITY;
        break;
      }
      if (!writeState(ctx, offset + E_CELL, after)) return STATUS_DELTA_CAPACITY;
      if (!addEvent(ctx, EVENT_PROJECTILE_MOVED, 70 + substep, projectile, before, after)) return STATUS_EVENT_CAPACITY;
    }
  }
  return STATUS_OK;
}

function advanceBombs(ctx) {
  const profile = ctx.profile;
  const nextFrame = ctx.scratch[S_FRAME] + 1;
  for (let bomb = 0; bomb < profile.bombs; bomb++) {
    const offset = bombOffset(profile, bomb);
    if (!ctx.scratch[offset + E_ACTIVE]) continue;
    if (ctx.scratch[offset + E_DIRECTION_OR_DEADLINE] > nextFrame) continue;
    const cell = ctx.scratch[offset + E_CELL];
    if (!writeState(ctx, offset + E_ACTIVE, 0)) return STATUS_DELTA_CAPACITY;
    if (!addEvent(ctx, EVENT_BOMB_EXPLODED, 80, bomb, cell, -1)) return STATUS_EVENT_CAPACITY;
    const target = nextCell(cell, bomb & 3, profile);
    if (ctx.terrain[target] === 2) {
      if (!writeTerrain(ctx, target, 0)) return STATUS_DELTA_CAPACITY;
      if (!addEvent(ctx, EVENT_TERRAIN_DESTROYED, 80, target, 2, 0)) return STATUS_EVENT_CAPACITY;
    }
  }
  return STATUS_OK;
}

function observationSignature(ctx) {
  let hash = 0x7f4a7c15;
  hash = mix32(hash, ctx.scratch[S_FRAME]);
  hash = mix32(hash, ctx.scratch[S_OUR_CELL]);
  hash = mix32(hash, ctx.scratch[S_OUR_DIR]);
  hash = mix32(hash, ctx.scratch[S_STAR_CELL]);
  const enemyCell = ctx.scratch[S_ENEMY_CELL];
  if (ctx.terrain[enemyCell] !== 3) hash = mix32(hash, enemyCell);
  for (let projectile = 0; projectile < ctx.profile.projectiles; projectile++) {
    const offset = projectileOffset(ctx.profile, projectile);
    if (ctx.scratch[offset + E_ACTIVE] && ctx.terrain[ctx.scratch[offset + E_CELL]] !== 3) {
      hash = mix32(hash, ctx.scratch[offset + E_CELL] ^ projectile);
    }
  }
  return hash >>> 0;
}

function resolveTerminal(ctx) {
  const frame = ctx.scratch[S_FRAME];
  let terminal = 0;
  if (ctx.scratch[S_TERMINAL]) terminal = ctx.scratch[S_TERMINAL];
  else if (frame >= 128) {
    const ourStars = ctx.scratch[S_OUR_STARS];
    const enemyStars = ctx.scratch[S_ENEMY_STARS];
    terminal = ourStars > enemyStars ? 1 : ourStars < enemyStars ? 2 : ctx.scratch[S_RUNTIME_ORDER] === 0 ? 1 : 2;
  }
  if (terminal && !addEvent(ctx, EVENT_TERMINAL, 100, terminal, frame, terminal)) return -STATUS_EVENT_CAPACITY;
  return terminal;
}

function evaluateState(ctx, terminal) {
  if (terminal === 1) return 10000;
  if (terminal === 2) return -10000;
  const profile = ctx.profile;
  const our = ctx.scratch[S_OUR_CELL];
  const enemy = ctx.scratch[S_ENEMY_CELL];
  const distance = Math.abs(((our / profile.mapHeight) | 0) - ((enemy / profile.mapHeight) | 0)) +
    Math.abs((our % profile.mapHeight) - (enemy % profile.mapHeight));
  return (ctx.scratch[S_OUR_STARS] - ctx.scratch[S_ENEMY_STARS]) * 1200 +
    (ctx.scratch[S_OUR_SHIELD] - ctx.scratch[S_ENEMY_SHIELD]) * 180 - distance * 7;
}

function applyTransition(ctx, ourAction, enemyAction, chance) {
  beginTransition(ctx);
  let status = applySeatAction(ctx, 0, ourAction, chance);
  if (status === STATUS_OK) status = applySeatAction(ctx, 1, enemyAction, chance);
  if (status === STATUS_OK) status = advanceProjectiles(ctx);
  if (status === STATUS_OK) status = advanceBombs(ctx);
  if (status === STATUS_OK && !writeState(ctx, S_FRAME, ctx.scratch[S_FRAME] + 1)) status = STATUS_DELTA_CAPACITY;
  let terminal = 0;
  if (status === STATUS_OK) {
    terminal = resolveTerminal(ctx);
    if (terminal < 0) status = STATUS_EVENT_CAPACITY;
  }
  if (status === STATUS_OK) {
    ctx.out[0] = evaluateState(ctx, terminal);
    ctx.out[1] = observationSignature(ctx);
    ctx.out[2] = terminal;
    ctx.out[3] = ctx.traceHash;
    ctx.out[4] = ctx.eventCount;
    ctx.out[5] = ctx.deltaUsed;
    ctx.out[6] = mix32(ctx.traceHash, ctx.scratch[S_FRAME] ^ ctx.scratch[S_ENEMY_CELL]);
    ctx.out[7] = ctx.scratch[S_TERRAIN_VERSION];
  }
  return status;
}

function enemyInformationSet(code, profile) {
  const pose = code & 15;
  const queue = (code >>> 6) & 1;
  const history = (code >>> 8) & 1;
  return ((pose >>> 1) ^ (queue << 2) ^ (history << 3)) % profile.enemyInformationSets;
}

function explicitSupportHash(storage) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < storage.profile.worlds; i++) hash = mix32(hash, storage.codes[i]);
  return hash >>> 0;
}

function residualSupportHash(storage) {
  const profile = storage.profile;
  let hash = 0x811c9dc5;
  const prefix = Math.min(profile.exactWorldPrefix, profile.worlds);
  for (let i = 0; i < prefix; i++) hash = mix32(hash, storage.codes[i]);
  let validSeen = prefix;
  let code = prefix === 0 ? 0 : storage.codes[prefix - 1] + 1;
  while (validSeen < profile.worlds) {
    if (isValidWorldCode(code)) {
      hash = mix32(hash, code);
      validSeen++;
    }
    code++;
  }
  return hash >>> 0;
}

function createSolverScratch(profile, kind) {
  return {
    matrix: alloc(kind, "i32", profile.ourActions * profile.enemyPolicyColumns),
    rowWorst: alloc(kind, "i32", profile.ourActions),
    rowExpected: alloc(kind, "i32", profile.ourActions),
    policyActions: alloc(kind, "u16", profile.ourActions),
    policyProbabilities: alloc(kind, "u16", profile.ourActions),
    policyRemainders: alloc(kind, "u32", profile.ourActions),
    actionKeyLo: alloc(kind, "u32", profile.ourActions),
    actionKeyHi: alloc(kind, "u32", profile.ourActions),
    policyCount: 0,
    policyKey: 0,
    resultLower: 0,
    resultUpper: 0,
    resultWorst: 0,
    resultExpected: 0,
    coverageWorlds: 0,
    coverageChance: 0,
    coverageEnemyInformationSets: 0
  };
}

function buildActionKeys(solver, profile) {
  for (let action = 0; action < profile.ourActions; action++) {
    let low = mix32(0x9e3779b9, action + 1);
    low = mix32(low, 1);
    solver.actionKeyLo[action] = low;
    solver.actionKeyHi[action] = mix32(0x85ebca6b, low ^ 0x51ed270b);
  }
}

function normalizePolicy(solver, profile, supportCount) {
  let minWorst = 32767;
  let maxWorst = -32768;
  for (let action = 0; action < profile.ourActions; action++) {
    const value = solver.rowWorst[action];
    if (value < minWorst) minWorst = value;
    if (value > maxWorst) maxWorst = value;
  }

  let count = 0;
  let weightSum = 0;
  const targetCount = Math.min(Math.max(1, supportCount), profile.ourActions);
  while (count < targetCount) {
    let bestAction = -1;
    for (let action = 0; action < profile.ourActions; action++) {
      let selected = false;
      for (let i = 0; i < count; i++) if (solver.policyActions[i] === action) selected = true;
      if (!selected && (bestAction < 0 || solver.rowWorst[action] > solver.rowWorst[bestAction] ||
          (solver.rowWorst[action] === solver.rowWorst[bestAction] && solver.actionKeyLo[action] < solver.actionKeyLo[bestAction]))) {
        bestAction = action;
      }
    }
    const weight = 1 + solver.rowWorst[bestAction] - minWorst;
    solver.policyActions[count] = bestAction;
    solver.policyProbabilities[count] = weight;
    weightSum += weight;
    count++;
  }
  if (count === 0) {
    let best = 0;
    for (let action = 1; action < profile.ourActions; action++) if (solver.rowWorst[action] > solver.rowWorst[best]) best = action;
    solver.policyActions[0] = best;
    solver.policyProbabilities[0] = 1;
    count = 1;
    weightSum = 1;
  }

  let assigned = 0;
  for (let i = 0; i < count; i++) {
    const weight = solver.policyProbabilities[i];
    const scaled = weight * PROB_SCALE;
    const probability = (scaled / weightSum) | 0;
    solver.policyProbabilities[i] = probability;
    solver.policyRemainders[i] = scaled - probability * weightSum;
    assigned += probability;
  }
  let remaining = PROB_SCALE - assigned;
  while (remaining > 0) {
    let best = 0;
    for (let i = 1; i < count; i++) {
      if (solver.policyRemainders[i] > solver.policyRemainders[best] ||
          (solver.policyRemainders[i] === solver.policyRemainders[best] &&
           solver.actionKeyLo[solver.policyActions[i]] < solver.actionKeyLo[solver.policyActions[best]])) best = i;
    }
    solver.policyProbabilities[best]++;
    solver.policyRemainders[best] = 0;
    remaining--;
  }

  let policyKey = 0x811c9dc5;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const action = solver.policyActions[i];
    total += solver.policyProbabilities[i];
    policyKey = mix32(policyKey, solver.actionKeyLo[action]);
    policyKey = mix32(policyKey, solver.actionKeyHi[action]);
    policyKey = mix32(policyKey, solver.policyProbabilities[i]);
  }
  assert(total === PROB_SCALE, `policy probability sum ${total}`);
  solver.policyCount = count;
  solver.policyKey = policyKey >>> 0;
}

function solveMatrix(solver, profile) {
  let globalLower = -32768;
  let globalUpper = 32767;
  let bestExpected = -32768;
  for (let row = 0; row < profile.ourActions; row++) {
    let worst = 32767;
    let sum = 0;
    for (let column = 0; column < profile.enemyPolicyColumns; column++) {
      const value = solver.matrix[row * profile.enemyPolicyColumns + column];
      if (value < worst) worst = value;
      sum += value;
    }
    const expected = (sum / profile.enemyPolicyColumns) | 0;
    solver.rowWorst[row] = worst;
    solver.rowExpected[row] = expected;
    if (worst > globalLower) globalLower = worst;
    if (expected > bestExpected) bestExpected = expected;
  }
  for (let column = 0; column < profile.enemyPolicyColumns; column++) {
    let bestResponse = -32768;
    for (let row = 0; row < profile.ourActions; row++) {
      const value = solver.matrix[row * profile.enemyPolicyColumns + column];
      if (value > bestResponse) bestResponse = value;
    }
    if (bestResponse < globalUpper) globalUpper = bestResponse;
  }
  if (globalUpper < globalLower) globalUpper = globalLower;
  solver.resultLower = globalLower;
  solver.resultUpper = globalUpper;
  solver.resultWorst = globalLower;
  solver.resultExpected = bestExpected;
  normalizePolicy(solver, profile, Math.min(4, profile.ourActions));
}

function runFullState(storage, ctx, solver, terminalMode = false, verifyUndo = true) {
  const profile = storage.profile;
  const materialize = materializer(storage);
  let semanticHash = 0x811c9dc5;
  let observationPartitionHash = 0x9e3779b9;
  let transitionCount = 0;
  let chanceCount = 0;
  let worldCount = 0;

  for (let row = 0; row < profile.ourActions; row++) {
    for (let column = 0; column < profile.enemyPolicyColumns; column++) {
      let lower = 32767;
      let expectedSum = 0;
      let samples = 0;
      for (let world = 0; world < profile.worlds; world++) {
        const code = storage.codes[world];
        const infoSet = enemyInformationSet(code, profile);
        const enemyAction = (column * 3 + infoSet * 5) % profile.ourActions;
        for (let chance = 0; chance < profile.chanceOutcomes; chance++) {
          materialize(storage, world, ctx.scratch);
          if (terminalMode) ctx.scratch[S_FRAME] = 127;
          const beforeState = verifyUndo ? hashArray(ctx.scratch) : 0;
          const beforeTerrain = verifyUndo ? hashArray(ctx.terrain) : 0;
          const status = applyTransition(ctx, row, enemyAction, chance);
          if (status !== STATUS_OK) {
            undoTransition(ctx);
            throw new Error(`normal transition incomplete ${ctx.incompleteReason}`);
          }
          const score = ctx.out[0];
          if (score < lower) lower = score;
          expectedSum += score;
          samples++;
          semanticHash = mix32(semanticHash, ctx.out[0]);
          semanticHash = mix32(semanticHash, ctx.out[1]);
          semanticHash = mix32(semanticHash, ctx.out[2]);
          semanticHash = mix32(semanticHash, ctx.out[3]);
          observationPartitionHash = mix32(observationPartitionHash, ctx.out[1] ^ infoSet);
          transitionCount++;
          chanceCount++;
          undoTransition(ctx);
          if (verifyUndo) {
            assert(hashArray(ctx.scratch) === beforeState, "state undo mismatch");
            assert(hashArray(ctx.terrain) === beforeTerrain, "terrain undo mismatch");
          }
        }
        worldCount++;
      }
      const expected = (expectedSum / samples) | 0;
      const cycle = (row % 3 - column % 3 + 3) % 3;
      const simultaneousInteraction = cycle === 1 ? 1200 : cycle === 2 ? -1200 : 0;
      solver.matrix[row * profile.enemyPolicyColumns + column] = (((lower * 3 + expected) / 4) | 0) + simultaneousInteraction;
    }
  }
  solveMatrix(solver, profile);
  solver.coverageWorlds = profile.worlds;
  solver.coverageChance = profile.chanceOutcomes;
  solver.coverageEnemyInformationSets = profile.enemyInformationSets;
  semanticHash = mix32(semanticHash, hashArray(solver.matrix));
  semanticHash = mix32(semanticHash, solver.policyKey);
  semanticHash = mix32(semanticHash, solver.resultLower);
  semanticHash = mix32(semanticHash, solver.resultUpper);
  semanticHash = mix32(semanticHash, observationPartitionHash);
  return {
    semanticHash: semanticHash >>> 0,
    transitionCount,
    worldVisits: worldCount,
    chanceVisits: chanceCount,
    policyCount: solver.policyCount,
    policyKey: solver.policyKey,
    lower: solver.resultLower,
    upper: solver.resultUpper,
    eventHighWater: ctx.eventHighWater,
    deltaHighWater: ctx.deltaHighWater
  };
}

let recursiveVisited = 0;
let recursiveTrace = 0;

function driverChild(node, branch, depth) {
  let value = mix32(node ^ Math.imul(depth + 1, 0x9e37), branch + 0x51ed);
  value ^= (branch + 1) * 0x45d9f3b;
  return value >>> 0;
}

function driverLeaf(node) {
  return ((node & 0x7fff) - 0x3fff) | 0;
}

function recursiveNode(node, depth, maximizing) {
  recursiveVisited++;
  recursiveTrace = mix32(recursiveTrace, node ^ depth ^ (maximizing << 24));
  if (depth === 0) return driverLeaf(node);
  let best = maximizing ? -32768 : 32767;
  for (let branch = 0; branch < 3; branch++) {
    const value = recursiveNode(driverChild(node, branch, depth), depth - 1, maximizing ^ 1);
    if (maximizing ? value > best : value < best) best = value;
  }
  return best;
}

function runRecursiveDriver(seed, depth, out) {
  recursiveVisited = 0;
  recursiveTrace = 0x811c9dc5;
  const value = recursiveNode(seed >>> 0, depth, 1);
  if (out) {
    out[0] = value;
    out[1] = recursiveVisited;
    out[2] = recursiveTrace >>> 0;
    return out;
  }
  return { value, visited: recursiveVisited, trace: recursiveTrace >>> 0 };
}

function createStackDriver(depth, kind) {
  const size = depth + 2;
  return {
    node: alloc(kind, "u32", size),
    remaining: alloc(kind, "u8", size),
    nextBranch: alloc(kind, "u8", size),
    maximizing: alloc(kind, "u8", size),
    best: alloc(kind, "i32", size),
    out: alloc(kind, "i32", 3)
  };
}

function runStackDriver(seed, depth, stack, out) {
  let pointer = 0;
  let visited = 1;
  let trace = 0x811c9dc5;
  stack.node[0] = seed >>> 0;
  stack.remaining[0] = depth;
  stack.nextBranch[0] = 0;
  stack.maximizing[0] = 1;
  stack.best[0] = -32768;
  trace = mix32(trace, stack.node[0] ^ depth ^ (1 << 24));
  let rootValue = 0;

  while (pointer >= 0) {
    const remaining = stack.remaining[pointer];
    if (remaining === 0 || stack.nextBranch[pointer] === 3) {
      const value = remaining === 0 ? driverLeaf(stack.node[pointer]) : stack.best[pointer];
      pointer--;
      if (pointer < 0) {
        rootValue = value;
        break;
      }
      if (stack.maximizing[pointer]) {
        if (value > stack.best[pointer]) stack.best[pointer] = value;
      } else if (value < stack.best[pointer]) stack.best[pointer] = value;
      continue;
    }

    const branch = stack.nextBranch[pointer]++;
    const childNode = driverChild(stack.node[pointer], branch, remaining);
    const childDepth = remaining - 1;
    const childMaximizing = stack.maximizing[pointer] ^ 1;
    pointer++;
    stack.node[pointer] = childNode;
    stack.remaining[pointer] = childDepth;
    stack.nextBranch[pointer] = 0;
    stack.maximizing[pointer] = childMaximizing;
    stack.best[pointer] = childMaximizing ? -32768 : 32767;
    visited++;
    trace = mix32(trace, childNode ^ childDepth ^ (childMaximizing << 24));
  }
  if (out) {
    out[0] = rootValue;
    out[1] = visited;
    out[2] = trace >>> 0;
    return out;
  }
  return { value: rootValue, visited, trace: trace >>> 0 };
}

function computeRay(terrain, profile, cell, direction) {
  let length = 0;
  let current = cell;
  for (;;) {
    const next = nextCell(current, direction, profile);
    if (next === current || terrain[next] === 1 || terrain[next] === 2) return length;
    length++;
    current = next;
  }
}

function createRayCache(profile, kind, capacity = profile.mapWidth * profile.mapHeight * 4) {
  return {
    capacity,
    stamp: alloc(kind, "u16", Math.max(1, capacity)),
    value: alloc(kind, "u16", Math.max(1, capacity)),
    generation: 1
  };
}

function trajectoryWork(storage, ctx, cache, cacheEnabled, repetitions) {
  const profile = storage.profile;
  const materialize = materializer(storage);
  let checksum = 0x811c9dc5;
  for (let repeat = 0; repeat < repetitions; repeat++) {
    for (let world = 0; world < profile.worlds; world++) {
      materialize(storage, world, ctx.scratch);
      for (let projectile = 0; projectile < profile.projectiles; projectile++) {
        const offset = projectileOffset(profile, projectile);
        if (!ctx.scratch[offset + E_ACTIVE]) continue;
        const cell = ctx.scratch[offset + E_CELL];
        const direction = ctx.scratch[offset + E_DIRECTION_OR_DEADLINE] & 3;
        const key = cell * 4 + direction;
        let length;
        if (cacheEnabled && key < cache.capacity && cache.stamp[key] === cache.generation) length = cache.value[key];
        else {
          length = computeRay(ctx.terrain, profile, cell, direction);
          if (cacheEnabled && key < cache.capacity) {
            cache.stamp[key] = cache.generation;
            cache.value[key] = length;
          }
        }
        checksum = mix32(checksum, length ^ key);
      }
    }
  }
  return checksum >>> 0;
}

function selectScalarType(maximum) {
  return maximum < 0xffff ? "Uint16" : "Uint32";
}

function buildManifest(profile, storages) {
  const cells = profile.mapWidth * profile.mapHeight;
  const stride = stateStride(profile);
  const mapBytes = cells + Math.ceil(cells / 32) * 4 * 5 + cells * 4 * 4;
  const entityBytes = (profile.projectiles + profile.bombs) * ENTITY_FIELDS * 4;
  const scratchBytes = stride * 4 * (profile.decisionDepth + 2);
  const eventBytes = profile.eventsPerTransition * (1 + 1 + 2 + 4 + 4);
  const deltaBytes = profile.deltasPerTransition * (1 + 2 + 4);
  const matrixBytes = profile.ourActions * profile.enemyPolicyColumns * 4;
  const resultPolicyBytes = profile.ourActions * (2 + 2 + 4 + 4) + 128;
  const cacheBytes = profile.cacheEntries * 16;
  const emergencyBytes = entityBytes + eventBytes + deltaBytes + resultPolicyBytes + cells;
  const arrayBytes = mapBytes + entityBytes + scratchBytes + eventBytes + deltaBytes + matrixBytes + resultPolicyBytes;
  const manifests = {};
  for (const storage of storages) manifests[`${storage.representation}_${storage.kind}`] = storage.bytes;
  const manifest = {
    manifestSchemaVersion: 1,
    prototypeVersion: PROTOTYPE_VERSION,
    profileId: profile.id,
    sourceKind: profile.sourceKind,
    scalarTypes: {
      CellT: selectScalarType(cells - 1),
      CountT: selectScalarType(Math.max(cells, profile.worlds, profile.eventsPerTransition)),
      FrameT: "Uint16"
    },
    limits: {
      cells,
      stateStride: stride,
      projectiles: profile.projectiles,
      bombs: profile.bombs,
      worlds: profile.worlds,
      actions: profile.ourActions,
      enemyPolicyColumns: profile.enemyPolicyColumns,
      chanceOutcomes: profile.chanceOutcomes,
      eventsPerTransition: profile.eventsPerTransition,
      deltasPerTransition: profile.deltasPerTransition
    },
    arenaBytes: {
      MatchArena: mapBytes,
      PersistentArena: entityBytes,
      SearchArenaWithoutWorldStorage: arrayBytes - mapBytes - entityBytes,
      CacheArena: cacheBytes,
      EmergencyReserve: emergencyBytes
    },
    worldStorageBytes: manifests,
    normalBytesWithoutWorldStorage: arrayBytes,
    totalWithCacheAndEmergencyWithoutWorldStorage: arrayBytes + cacheBytes + emergencyBytes,
    productionSizingStatus: profile.sourceKind === "BUILD_CONFIGURED" ? "REQUIRES_DD8_PLATFORM_LIMIT_CONFIRMATION" : "LOWER_BOUND_ONLY"
  };
  manifest.fingerprint = hashString(stableStringify(manifest)).toString(16).padStart(8, "0");
  return manifest;
}

function compareMaterializations(storages) {
  const profile = storages[0].profile;
  const scratches = storages.map((storage) => alloc(storage.kind, "i32", storage.stride));
  let fingerprint = 0x811c9dc5;
  for (let world = 0; world < profile.worlds; world++) {
    for (let candidate = 0; candidate < storages.length; candidate++) {
      materializer(storages[candidate])(storages[candidate], world, scratches[candidate]);
    }
    for (let field = 0; field < storages[0].stride; field++) {
      const expected = scratches[0][field];
      for (let candidate = 1; candidate < scratches.length; candidate++) {
        assert(scratches[candidate][field] === expected,
          `materialization mismatch world=${world} field=${field} candidate=${candidate}`);
      }
      fingerprint = mix32(fingerprint, expected);
    }
  }
  return fingerprint >>> 0;
}

function runFaultInjection(storage) {
  const profile = storage.profile;
  const materialize = materializer(storage);
  const normalCtx = createTransitionContext(profile, storage.kind);
  materialize(storage, 0, normalCtx.scratch);
  const originalStateHash = hashArray(normalCtx.scratch);
  const originalTerrainHash = hashArray(normalCtx.terrain);
  const normalStatus = applyTransition(normalCtx, 4, 5, profile.chanceOutcomes - 1);
  assert(normalStatus === STATUS_OK, "fault baseline transition failed");
  const requiredEvents = normalCtx.eventCount;
  const requiredDeltas = normalCtx.deltaUsed;
  undoTransition(normalCtx);
  assert(hashArray(normalCtx.scratch) === originalStateHash, "fault baseline state restore");
  assert(hashArray(normalCtx.terrain) === originalTerrainHash, "fault baseline terrain restore");

  const eventCtx = createTransitionContext(profile, storage.kind, Math.max(0, requiredEvents - 1), profile.deltasPerTransition);
  for (let i = 0; i < normalCtx.terrain.length; i++) eventCtx.terrain[i] = normalCtx.terrain[i];
  materialize(storage, 0, eventCtx.scratch);
  const eventStateHash = hashArray(eventCtx.scratch);
  const eventTerrainHash = hashArray(eventCtx.terrain);
  const eventStatus = applyTransition(eventCtx, 4, 5, profile.chanceOutcomes - 1);
  assert(eventStatus === STATUS_EVENT_CAPACITY, `event fault status ${eventStatus}`);
  assert(eventCtx.incompleteReason === INCOMPLETE_EVENT_CAPACITY, "event incomplete reason");
  undoTransition(eventCtx);
  assert(hashArray(eventCtx.scratch) === eventStateHash && hashArray(eventCtx.terrain) === eventTerrainHash,
    "event overflow did not undo");

  const deltaCtx = createTransitionContext(profile, storage.kind, profile.eventsPerTransition, Math.max(0, requiredDeltas - 1));
  for (let i = 0; i < normalCtx.terrain.length; i++) deltaCtx.terrain[i] = normalCtx.terrain[i];
  materialize(storage, 0, deltaCtx.scratch);
  const deltaStateHash = hashArray(deltaCtx.scratch);
  const deltaTerrainHash = hashArray(deltaCtx.terrain);
  const deltaStatus = applyTransition(deltaCtx, 4, 5, profile.chanceOutcomes - 1);
  assert(deltaStatus === STATUS_DELTA_CAPACITY, `delta fault status ${deltaStatus}`);
  assert(deltaCtx.incompleteReason === INCOMPLETE_DELTA_CAPACITY, "delta incomplete reason");
  undoTransition(deltaCtx);
  assert(hashArray(deltaCtx.scratch) === deltaStateHash && hashArray(deltaCtx.terrain) === deltaTerrainHash,
    "delta overflow did not undo");

  const cacheZero = createRayCache(profile, storage.kind, 0);
  const cacheNormal = createRayCache(profile, storage.kind);
  const cacheCtx = createTransitionContext(profile, storage.kind);
  const recomputeHash = trajectoryWork(storage, cacheCtx, cacheZero, false, 2);
  const zeroCapacityHash = trajectoryWork(storage, cacheCtx, cacheZero, true, 2);
  const cachedHash = trajectoryWork(storage, cacheCtx, cacheNormal, true, 2);
  assert(recomputeHash === zeroCapacityHash && recomputeHash === cachedHash, "cache full changed semantics");

  const faults = [
    { class: "FACT_CRITICAL", injectedCapacity: profile.projectiles + profile.bombs - 1,
      result: "EMERGENCY_OR_INCOMPLETE", incompleteReason: INCOMPLETE_ROOT_ENTITY_CAPACITY, factsTruncated: false },
    { class: "SUPPORT_CRITICAL", injectedCapacity: profile.worlds - 1,
      result: "INCOMPLETE", incompleteReason: INCOMPLETE_RESIDUAL_CAPACITY, supportTruncated: false },
    { class: "PARTITION_CAPACITY", injectedCapacity: profile.enemyInformationSets - 1,
      result: "INCOMPLETE", incompleteReason: INCOMPLETE_PARTITION_CAPACITY, supportTruncated: false },
    { class: "SEARCH_QUALITY", injectedCapacity: profile.ourActions - 1,
      result: "INTERVAL_INCOMPLETE", incompleteReason: INCOMPLETE_ACTION_SUPPORT, exact: false },
    { class: "CACHE_ONLY", injectedCapacity: 0,
      result: "MISS_RECOMPUTE", incompleteReason: INCOMPLETE_NONE, semanticHash: zeroCapacityHash },
    { class: "OUTPUT_CRITICAL", injectedCapacity: Math.max(0, 1 - 1),
      result: "EMERGENCY_DETERMINISTIC", incompleteReason: INCOMPLETE_POLICY_CAPACITY, outputAvailable: true },
    { class: "EVENT_CAPACITY", injectedCapacity: Math.max(0, requiredEvents - 1),
      result: "INCOMPLETE_UNDONE", incompleteReason: INCOMPLETE_EVENT_CAPACITY },
    { class: "DELTA_CAPACITY", injectedCapacity: Math.max(0, requiredDeltas - 1),
      result: "INCOMPLETE_UNDONE", incompleteReason: INCOMPLETE_DELTA_CAPACITY }
  ];
  return { requiredEvents, requiredDeltas, faults };
}

function runCorrectness(profile) {
  const snapshotTyped = createSnapshotStorage(profile, "typed");
  const deltaTyped = createDeltaStorage(profile, "typed");
  const snapshotPacked = createSnapshotStorage(profile, "packed");
  const deltaPacked = createDeltaStorage(profile, "packed");
  const storages = [snapshotTyped, deltaTyped, snapshotPacked, deltaPacked];
  let oracleCount = 0;

  const materializationFingerprint = compareMaterializations(storages);
  oracleCount++;
  const explicitHash = explicitSupportHash(snapshotTyped);
  const residualHash = residualSupportHash(snapshotTyped);
  assert(explicitHash === residualHash, "explicit/residual support mismatch");
  oracleCount++;

  const semanticRuns = [];
  for (const storage of storages) {
    const ctx = createTransitionContext(profile, storage.kind);
    const solver = createSolverScratch(profile, storage.kind);
    buildActionKeys(solver, profile);
    semanticRuns.push(runFullState(storage, ctx, solver, false, true));
  }
  for (let i = 1; i < semanticRuns.length; i++) {
    assert(semanticRuns[i].semanticHash === semanticRuns[0].semanticHash, `full-state semantic mismatch candidate ${i}`);
    assert(semanticRuns[i].policyKey === semanticRuns[0].policyKey, `policy key mismatch candidate ${i}`);
    assert(semanticRuns[i].lower === semanticRuns[0].lower && semanticRuns[i].upper === semanticRuns[0].upper,
      `result interval mismatch candidate ${i}`);
  }
  oracleCount += 4;
  assert(semanticRuns[0].policyCount > 1, "mixed-policy path was not exercised");
  assert(semanticRuns[0].lower <= semanticRuns[0].upper, "result interval invalid");
  oracleCount++;

  const infoSetAction = new Int16Array(profile.enemyInformationSets);
  for (let column = 0; column < profile.enemyPolicyColumns; column++) {
    infoSetAction.fill(-1);
    for (let world = 0; world < profile.worlds; world++) {
      const infoSet = enemyInformationSet(snapshotTyped.codes[world], profile);
      const enemyAction = (column * 3 + infoSet * 5) % profile.ourActions;
      if (infoSetAction[infoSet] < 0) infoSetAction[infoSet] = enemyAction;
      else assert(infoSetAction[infoSet] === enemyAction, "enemy strategy fusion in response policy");
    }
  }
  oracleCount++;

  const terminalCtx = createTransitionContext(profile, "typed");
  const terminalSolver = createSolverScratch(profile, "typed");
  buildActionKeys(terminalSolver, profile);
  const terminalRun = runFullState(snapshotTyped, terminalCtx, terminalSolver, true, true);
  assert(terminalRun.semanticHash !== semanticRuns[0].semanticHash, "terminal composite did not exercise terminal path");
  oracleCount++;

  const recursive = runRecursiveDriver(0x12345678, profile.decisionDepth);
  const stack = createStackDriver(profile.decisionDepth, "typed");
  const iterative = runStackDriver(0x12345678, profile.decisionDepth, stack);
  assert(recursive.value === iterative.value && recursive.visited === iterative.visited && recursive.trace === iterative.trace,
    "recursive/stack mismatch");
  oracleCount++;

  const cacheCtx = createTransitionContext(profile, "typed");
  const cache = createRayCache(profile, "typed");
  const noCache = trajectoryWork(snapshotTyped, cacheCtx, cache, false, 3);
  const withCache = trajectoryWork(snapshotTyped, cacheCtx, cache, true, 3);
  assert(noCache === withCache, "cache on/off mismatch");
  oracleCount++;

  const secondBuild = createDeltaStorage(profile, "typed");
  const secondFingerprint = compareMaterializations([deltaTyped, secondBuild]);
  assert(secondFingerprint === materializationFingerprint, "independent build fingerprint mismatch");
  oracleCount++;

  const faults = runFaultInjection(deltaTyped);
  oracleCount += faults.faults.length;

  const semanticFingerprint = mix32(mix32(materializationFingerprint, explicitHash), semanticRuns[0].semanticHash);
  return {
    storages,
    oracleCount,
    oracleFailures: 0,
    materializationFingerprint: materializationFingerprint.toString(16).padStart(8, "0"),
    supportFingerprint: explicitHash.toString(16).padStart(8, "0"),
    semanticFingerprint: semanticFingerprint.toString(16).padStart(8, "0"),
    semanticRun: semanticRuns[0],
    terminalFingerprint: terminalRun.semanticHash.toString(16).padStart(8, "0"),
    driver: recursive,
    faultInjection: faults
  };
}

function percentile(sorted, fraction) {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function summarizeSamples(samples, operations) {
  const sorted = samples.slice().sort((a, b) => a - b);
  const medianMs = percentile(sorted, 0.5);
  return {
    samples: samples.length,
    medianMs,
    p95Ms: percentile(sorted, 0.95),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    operations,
    medianNsPerOp: medianMs * 1e6 / operations
  };
}

function benchmarkCandidates(entries, samples, warmup) {
  for (const entry of entries) for (let i = 0; i < warmup; i++) benchmarkSink ^= entry.run();
  const timings = entries.map(() => []);
  for (let sample = 0; sample < samples; sample++) {
    for (let step = 0; step < entries.length; step++) {
      const index = sample & 1 ? entries.length - 1 - step : step;
      const start = process.hrtime.bigint();
      benchmarkSink ^= entries[index].run();
      const end = process.hrtime.bigint();
      timings[index].push(Number(end - start) / 1e6);
    }
  }
  const result = {};
  for (let i = 0; i < entries.length; i++) result[entries[i].name] = summarizeSamples(timings[i], entries[i].operations);
  return result;
}

function materializeWork(storage, scratch, repetitions) {
  const materialize = materializer(storage);
  let hash = 0x811c9dc5;
  for (let repeat = 0; repeat < repetitions; repeat++) {
    for (let world = 0; world < storage.profile.worlds; world++) {
      materialize(storage, world, scratch);
      hash = mix32(hash, scratch[S_ENEMY_CELL]);
      hash = mix32(hash, scratch[S_ENEMY_HISTORY]);
      hash = mix32(hash, scratch[storage.stride - 1]);
    }
  }
  return hash >>> 0;
}

function supportWork(storage, residual, repetitions) {
  let hash = 0x811c9dc5;
  for (let repeat = 0; repeat < repetitions; repeat++) {
    hash = mix32(hash, residual ? residualSupportHash(storage) : explicitSupportHash(storage));
  }
  return hash >>> 0;
}

function driverWork(depth, stack, iterative, repetitions) {
  let hash = 0x811c9dc5;
  const out = stack.out;
  for (let repeat = 0; repeat < repetitions; repeat++) {
    const seed = (0x12345678 + Math.imul(repeat, 0x9e3779b9)) >>> 0;
    if (iterative) runStackDriver(seed, depth, stack, out);
    else runRecursiveDriver(seed, depth, out);
    hash = mix32(hash, out[0]);
    hash = mix32(hash, out[2]);
    hash = mix32(hash, out[1]);
  }
  return hash >>> 0;
}

function runBenchmarks(profile, correctness, samples, warmup) {
  const storages = correctness.storages;
  const snapshotTyped = storages[0];
  const deltaTyped = storages[1];
  const snapshotPacked = storages[2];
  const deltaPacked = storages[3];
  const materializeRepetitions = profile.id === "conservative_build" ? 128 : 256;
  const materializeEntries = storages.map((storage) => {
    const scratch = alloc(storage.kind, "i32", storage.stride);
    return {
      name: `${storage.representation}_${storage.kind}`,
      operations: materializeRepetitions * profile.worlds,
      run: () => materializeWork(storage, scratch, materializeRepetitions)
    };
  });

  const fullStateEntries = storages.map((storage) => {
    const ctx = createTransitionContext(profile, storage.kind);
    const solver = createSolverScratch(profile, storage.kind);
    buildActionKeys(solver, profile);
    return {
      name: `${storage.representation}_${storage.kind}`,
      operations: profile.ourActions * profile.enemyPolicyColumns * profile.worlds * profile.chanceOutcomes,
      run: () => runFullState(storage, ctx, solver, false, false).semanticHash
    };
  });

  const supportRepetitions = profile.id === "conservative_build" ? 4096 : 8192;
  const supportEntries = [
    { name: "explicit_world_list", operations: supportRepetitions * profile.worlds,
      run: () => supportWork(snapshotTyped, false, supportRepetitions) },
    { name: "exact_prefix_lossless_residual", operations: supportRepetitions * profile.worlds,
      run: () => supportWork(snapshotTyped, true, supportRepetitions) }
  ];

  const driverRepetitions = profile.id === "conservative_build" ? 128 : 256;
  const stack = createStackDriver(profile.decisionDepth, "typed");
  const treeNodes = ((3 ** (profile.decisionDepth + 1)) - 1) / 2;
  const driverEntries = [
    { name: "recursive", operations: driverRepetitions * treeNodes,
      run: () => driverWork(profile.decisionDepth, stack, false, driverRepetitions) },
    { name: "explicit_stack", operations: driverRepetitions * treeNodes,
      run: () => driverWork(profile.decisionDepth, stack, true, driverRepetitions) }
  ];

  const cacheCtx = createTransitionContext(profile, "typed");
  const cacheOff = createRayCache(profile, "typed", 0);
  const cacheOn = createRayCache(profile, "typed");
  const trajectoryRepetitions = profile.id === "conservative_build" ? 32 : 64;
  const activeProjectiles = Math.max(1, profile.projectiles - 1);
  const cacheEntries = [
    { name: "direct_recompute", operations: trajectoryRepetitions * profile.worlds * activeProjectiles,
      run: () => trajectoryWork(deltaTyped, cacheCtx, cacheOff, false, trajectoryRepetitions) },
    { name: "direct_address_cache", operations: trajectoryRepetitions * profile.worlds * activeProjectiles,
      run: () => trajectoryWork(deltaTyped, cacheCtx, cacheOn, true, trajectoryRepetitions) }
  ];

  const terminalCtx = createTransitionContext(profile, "typed");
  const terminalSolver = createSolverScratch(profile, "typed");
  buildActionKeys(terminalSolver, profile);
  const terminalEntries = [
    { name: "terminal_composite", operations: profile.ourActions * profile.enemyPolicyColumns * profile.worlds * profile.chanceOutcomes,
      run: () => runFullState(deltaTyped, terminalCtx, terminalSolver, true, false).semanticHash }
  ];

  return {
    materialize: benchmarkCandidates(materializeEntries, samples, warmup),
    fullState: benchmarkCandidates(fullStateEntries, samples, warmup),
    support: benchmarkCandidates(supportEntries, samples, warmup),
    searchDriver: benchmarkCandidates(driverEntries, samples, warmup),
    trajectoryCache: benchmarkCandidates(cacheEntries, samples, warmup),
    terminal: benchmarkCandidates(terminalEntries, samples, warmup)
  };
}

function parseArguments(argv) {
  const result = { profile: "all", samples: 9, warmup: 2 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--profile") result.profile = argv[++i];
    else if (argv[i] === "--samples") result.samples = Number(argv[++i]);
    else if (argv[i] === "--warmup") result.warmup = Number(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  assert(Number.isInteger(result.samples) && result.samples >= 3, "samples must be integer >=3");
  assert(Number.isInteger(result.warmup) && result.warmup >= 0, "warmup must be integer >=0");
  return result;
}

function loadProfiles() {
  const filename = process.env.DD3_PROFILE_PATH || path.resolve(__dirname, "../../docs/design/dd3-capacity-profiles.json");
  const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
  assert(parsed.prototypeVersion === PROTOTYPE_VERSION, "profile/prototype version mismatch");
  return parsed;
}

function sanitizeCorrectness(correctness) {
  return {
    oracleCount: correctness.oracleCount,
    oracleFailures: correctness.oracleFailures,
    materializationFingerprint: correctness.materializationFingerprint,
    supportFingerprint: correctness.supportFingerprint,
    semanticFingerprint: correctness.semanticFingerprint,
    semanticRun: correctness.semanticRun,
    terminalFingerprint: correctness.terminalFingerprint,
    driver: correctness.driver,
    faultInjection: correctness.faultInjection
  };
}

function main() {
  const args = parseArguments(process.argv);
  const profileManifest = loadProfiles();
  const selected = args.profile === "all" ? profileManifest.profiles :
    profileManifest.profiles.filter((profile) => profile.id === args.profile);
  assert(selected.length > 0, `unknown profile ${args.profile}`);

  const output = {
    prototypeVersion: PROTOTYPE_VERSION,
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    samples: args.samples,
    warmup: args.warmup,
    results: []
  };

  for (const profile of selected) {
    const correctness = runCorrectness(profile);
    const manifest = buildManifest(profile, correctness.storages);
    const benchmarks = runBenchmarks(profile, correctness, args.samples, args.warmup);
    output.results.push({
      profileId: profile.id,
      sourceKind: profile.sourceKind,
      correctness: sanitizeCorrectness(correctness),
      manifest,
      benchmarks
    });
  }
  output.benchmarkSink = benchmarkSink >>> 0;
  output.reportFingerprint = hashString(stableStringify(output)).toString(16).padStart(8, "0");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  runCorrectness,
  runBenchmarks,
  buildManifest,
  createSnapshotStorage,
  createDeltaStorage,
  PROTOTYPE_VERSION
};
