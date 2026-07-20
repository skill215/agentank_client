"use strict";

const crypto = require("node:crypto");
const { STATE_KIND, TERRAIN, DIRECTIONS, SKILLS } = require("./codes");

function assertInteger(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} must be an integer >= ${minimum}`);
  return value;
}
function assertCell(cell, width, height, name = "cell") {
  if (!Array.isArray(cell) || cell.length !== 2 || !Number.isSafeInteger(cell[0]) ||
      !Number.isSafeInteger(cell[1]) || cell[0] < 0 || cell[0] >= width ||
      cell[1] < 0 || cell[1] >= height) throw new TypeError(`${name} is out of map bounds`);
  return [cell[0], cell[1]];
}
function clone(value) { return structuredClone(value); }
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Reference state contains non-integer number");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new TypeError(`Reference state contains undefined at ${key}`);
    out[key] = canonical(value[key]);
  }
  return out;
}
function signature(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function makeTank(spec, context) {
  if (!spec || (spec.seat !== 0 && spec.seat !== 1)) throw new TypeError("tank seat must be 0 or 1");
  if (!DIRECTIONS.includes(spec.direction)) throw new TypeError("tank direction is invalid");
  const skillId = spec.skillId ?? null;
  if (skillId !== null && !SKILLS.includes(skillId)) throw new TypeError("tank skill is invalid");
  return {
    entityId: spec.entityId ?? spec.seat + 1, seat: spec.seat, cell: [...spec.cell],
    direction: spec.direction, crashed: spec.crashed ?? false, stars: spec.stars ?? 0,
    runtimeMs: spec.runtimeMs ?? null, queue: clone(spec.queue ?? []), skillId,
    skillReadyFrame: spec.skillReadyFrame ?? 0, shieldHitsRemaining: spec.shieldHitsRemaining ?? 0,
    shieldUntilFrame: spec.shieldUntilFrame ?? null, frozenUntilFrame: spec.frozenUntilFrame ?? null,
    stunUntilFrame: spec.stunUntilFrame ?? null, overloadUntilFrame: spec.overloadUntilFrame ?? null,
    cloakUntilFrame: spec.cloakUntilFrame ?? null, poisonAppliedFrame: spec.poisonAppliedFrame ?? null,
    poisonUntilFrame: spec.poisonUntilFrame ?? null, boostUntilFrame: spec.boostUntilFrame ?? null,
    revealUntilFrame: spec.revealUntilFrame ?? null, pickupLockUntilFrame: spec.pickupLockUntilFrame ?? null,
    fireLockUntilFrame: spec.fireLockUntilFrame ?? null,
    bombCooldownReadyFrame: spec.bombCooldownReadyFrame ?? 0,
    canActThisFrame: spec.canActThisFrame ?? true, actionSpeedClass: spec.actionSpeedClass ?? 1,
    trackEpoch: spec.trackEpoch ?? 0, cooldownFrames: skillId ? context.constants.skillCooldownFrames[skillId] : 0
  };
}

function makeProjectile(spec, id, platformFrame) {
  return { entityId: spec.entityId ?? id, ownerSeat: spec.ownerSeat, cell: [...spec.cell],
    direction: spec.direction, active: spec.active ?? true, shotGroupId: spec.shotGroupId ?? id,
    memberIndex: spec.memberIndex ?? 0, createdFrame: spec.createdFrame ?? platformFrame };
}
function makeBomb(spec, id, bombFuseFrames) {
  return { entityId: spec.entityId ?? id, ownerSeat: spec.ownerSeat, cell: [...spec.cell],
    placedFrame: spec.placedFrame ?? spec.explodeFrame - bombFuseFrames,
    explodeFrame: spec.explodeFrame, active: spec.active ?? true,
    visibility: spec.visibility ?? "VISIBLE_OPEN" };
}

function createPhysicalState(spec, context) {
  if (!context) throw new TypeError("RuleContext is required");
  const width = assertInteger(spec?.map?.width, "map.width", 1);
  const height = assertInteger(spec?.map?.height, "map.height", 1);
  if (!Array.isArray(spec.map.terrainColumnMajor) || spec.map.terrainColumnMajor.length !== width) {
    throw new TypeError("terrainColumnMajor width mismatch");
  }
  const terrain = spec.map.terrainColumnMajor.map((column, x) => {
    if (!Array.isArray(column) || column.length !== height) throw new TypeError(`terrain column ${x} mismatch`);
    return column.map(tile => { if (!TERRAIN[tile]) throw new TypeError(`unknown terrain ${tile}`); return tile; });
  });
  if (!Array.isArray(spec.tanks) || spec.tanks.length !== 2) throw new TypeError("exactly two tanks required");
  const tanks = spec.tanks.map(tank => makeTank(tank, context)).sort((a, b) => a.seat - b.seat);
  for (const tank of tanks) assertCell(tank.cell, width, height, `tank ${tank.seat} cell`);
  const used = new Set(tanks.map(tank => tank.entityId));
  let nextEntityId = spec.nextEntityId ?? Math.max(...used) + 1;
  const allocate = requested => {
    const id = requested ?? nextEntityId++;
    if (!Number.isSafeInteger(id) || id <= 0 || used.has(id)) throw new TypeError(`duplicate entityId ${id}`);
    used.add(id); if (id >= nextEntityId) nextEntityId = id + 1; return id;
  };
  const projectiles = (spec.projectiles ?? []).map(item =>
    makeProjectile(item, allocate(item.entityId), spec.platformFrame));
  const bombs = (spec.bombs ?? []).map(item =>
    makeBomb(item, allocate(item.entityId), context.constants.bombFuseFrames));
  for (const entity of [...projectiles, ...bombs]) assertCell(entity.cell, width, height, "entity cell");
  const state = { stateKind: STATE_KIND.PHYSICAL, rulesetVersion: context.rulesetVersion,
    phaseOrderId: context.phaseOrderId, terminalPolicyId: context.terminalPolicyId,
    platformFrame: assertInteger(spec.platformFrame, "platformFrame"),
    recordIndex: assertInteger(spec.recordIndex ?? spec.platformFrame, "recordIndex"), phaseOrdinal: 0,
    map: { width, height, terrainColumnMajor: terrain,
      terrainVersion: spec.map.terrainVersion ?? 0, topologyVersion: spec.map.topologyVersion ?? 0 },
    tanks, projectiles, bombs, star: spec.star === null || spec.star === undefined ? null :
      { cell: assertCell(spec.star.cell ?? spec.star, width, height, "star"),
        spawnAtFrame: spec.star.spawnAtFrame ?? null },
    nextStarSpawnFrame: spec.nextStarSpawnFrame ?? null, nextEntityId,
    terminalFlags: clone(spec.terminalFlags ?? { timeoutSeat: null, scriptErrorSeat: null }),
    assumptionIds: [...(spec.assumptionIds ?? [])].sort(), terminal: null };
  validatePhysicalState(state);
  return state;
}

function validatePhysicalState(state) {
  if (state?.stateKind !== STATE_KIND.PHYSICAL) throw new TypeError("not a PhysicalState");
  const ids = new Set();
  for (const entity of [...state.tanks, ...state.projectiles, ...state.bombs]) {
    if (!Number.isSafeInteger(entity.entityId) || entity.entityId <= 0 || ids.has(entity.entityId)) {
      throw new TypeError("entity IDs must be unique positive integers");
    }
    ids.add(entity.entityId);
  }
  canonical(state);
  return state;
}

function createInformationState(spec) {
  if (!Array.isArray(spec?.worlds) || spec.worlds.length < 1) throw new TypeError("InformationState worlds required");
  const worlds = spec.worlds.map(world => clone(validatePhysicalState(world)));
  const value = { stateKind: STATE_KIND.INFORMATION, platformFrame: worlds[0].platformFrame,
    worlds, residualSupport: clone(spec.residualSupport ?? []),
    associationRelations: clone(spec.associationRelations ?? []),
    observationHistorySignature: spec.observationHistorySignature,
    complete: spec.complete ?? true, incompleteReasons: [...(spec.incompleteReasons ?? [])].sort() };
  if (worlds.some(world => world.platformFrame !== value.platformFrame)) {
    throw new TypeError("InformationState worlds must share platformFrame");
  }
  canonical(value);
  return Object.freeze(value);
}

function clonePhysicalState(state) { return clone(validatePhysicalState(state)); }
function allocateEntityId(state) { const id = state.nextEntityId; state.nextEntityId += 1; return id; }

module.exports = { assertInteger, assertCell, canonical, signature, makeTank, createPhysicalState,
  validatePhysicalState, createInformationState, clonePhysicalState, allocateEntityId };
