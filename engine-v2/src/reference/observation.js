"use strict";

const crypto = require("node:crypto");
const { FIELD, ROOT_STATUS, TERRAIN, DIRECTIONS, SKILLS } = require("./codes");
const { canonical, signature } = require("./state");

const CAPABILITY = Object.freeze({ ENEMY_TANK: 1, OWN_BULLET: 2, ENEMY_BULLET: 4,
  BOMBS: 8, STAR: 16, SKILLS: 32, EFFECTS: 64, STATUS: 128 });

function has(object, field) { return object !== null && typeof object === "object" && Object.hasOwn(object, field); }
function fieldStatus(object, field) {
  if (!has(object, field)) return FIELD.ABSENT;
  return object[field] === null ? FIELD.NULL : FIELD.PRESENT;
}
function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} must be an integer >= ${minimum}`);
  return value;
}
function booleanOrAbsent(object, field) {
  if (!has(object, field)) return { status: FIELD.ABSENT, value: null };
  if (typeof object[field] !== "boolean") throw new TypeError(`${field} must be boolean`);
  return { status: FIELD.PRESENT, value: object[field] };
}
function cell(value, width, height, name) {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isSafeInteger(value[0]) ||
      !Number.isSafeInteger(value[1]) || value[0] < 0 || value[0] >= width ||
      value[1] < 0 || value[1] >= height) throw new TypeError(`${name} cell invalid`);
  return [value[0], value[1]];
}
function externalKey(value) {
  if (value === null || value === undefined) return { status: FIELD.ABSENT, lo: 0, hi: 0 };
  const bytes = crypto.createHash("sha256").update(String(value)).digest();
  return { status: FIELD.PRESENT, lo: bytes.readUInt32LE(0), hi: bytes.readUInt32LE(4) };
}
function deadline(frame, remaining, name) {
  if (remaining === null || remaining === undefined) return null;
  return frame + integer(remaining, name);
}

function adaptTerrain(map) {
  if (!Array.isArray(map) || map.length < 1) throw new TypeError("game.map must be a non-empty column array");
  const width = map.length;
  if (!Array.isArray(map[0]) || map[0].length < 1) throw new TypeError("game.map height invalid");
  const height = map[0].length;
  const terrainColumnMajor = map.map((column, x) => {
    if (!Array.isArray(column) || column.length !== height) throw new TypeError(`game.map column ${x} is ragged`);
    return column.map(tile => { if (!TERRAIN[tile]) throw new TypeError(`game.map tile ${tile} invalid`); return tile; });
  });
  return { width, height, cellCount: width * height, terrainColumnMajor };
}

function adaptSkill(side, frame) {
  if (!has(side, "skill")) return { fieldStatus: FIELD.ABSENT, type: null, cooldownFrames: null,
    readyFrame: null, activeType: null, activeUntilFrame: null };
  const skill = side.skill;
  if (!skill || typeof skill !== "object" || !SKILLS.includes(skill.type)) {
    throw new TypeError("skill.type must name one of eight skills");
  }
  return { fieldStatus: FIELD.PRESENT, type: skill.type,
    cooldownFrames: integer(skill.cooldownFrames, "skill.cooldownFrames"),
    readyFrame: deadline(frame, skill.remainingCooldownFrames, "skill.remainingCooldownFrames"),
    activeType: skill.activeType ?? null,
    activeUntilFrame: deadline(frame, skill.activeRemainingFrames, "skill.activeRemainingFrames") };
}

function adaptEffect(value, frame, name) {
  if (value === null) return { fieldStatus: FIELD.NULL, type: null, untilFrame: null };
  if (value === undefined) return { fieldStatus: FIELD.ABSENT, type: null, untilFrame: null };
  if (!value || typeof value !== "object" || typeof value.type !== "string") {
    throw new TypeError(`${name} effect invalid`);
  }
  return { fieldStatus: FIELD.PRESENT, type: value.type,
    untilFrame: deadline(frame, value.remainingFrames, `${name}.remainingFrames`) };
}

function adaptTank(side, seat, frame, width, height, required) {
  const tankStatus = fieldStatus(side, "tank");
  if (required && tankStatus !== FIELD.PRESENT) throw new TypeError("me.tank must be present");
  const tank = tankStatus === FIELD.PRESENT ? side.tank : null;
  if (tank && (!DIRECTIONS.includes(tank.direction) || typeof tank.crashed !== "boolean")) {
    throw new TypeError("tank direction/crashed invalid");
  }
  const status = side.status ?? {};
  return { seat, tankFieldStatus: tankStatus, externalKey: externalKey(tank?.id),
    cell: tank ? cell(tank.position, width, height, `tank ${seat}`) : null,
    direction: tank?.direction ?? null, crashed: tank?.crashed ?? null,
    stars: has(side, "stars") ? integer(side.stars, "stars") : null,
    starsFieldStatus: fieldStatus(side, "stars"), skill: adaptSkill(side, frame),
    effects: { self: adaptEffect(side.effects?.self, frame, "self"),
      debuff: adaptEffect(side.effects?.debuff, frame, "debuff") },
    status: { shielded: booleanOrAbsent(status, "shielded"), cloaked: booleanOrAbsent(status, "cloaked"),
      boosted: booleanOrAbsent(status, "boosted"), overloaded: booleanOrAbsent(status, "overloaded"),
      frozen: booleanOrAbsent(status, "frozen"), stunned: booleanOrAbsent(status, "stunned"),
      poisoned: booleanOrAbsent(status, "poisoned"), fireLocked: booleanOrAbsent(status, "fireLocked"),
      bombActive: booleanOrAbsent(status, "bombActive"),
      actionSpeed: has(status, "actionSpeed") ? integer(status.actionSpeed, "actionSpeed", 1) : null,
      canActThisFrame: has(status, "canActThisFrame") ?
        booleanOrAbsent(status, "canActThisFrame") : { status: FIELD.ABSENT, value: null },
      bombCooldownReadyFrame: has(status, "bombCooldownFrames") ?
        deadline(frame, status.bombCooldownFrames, "bombCooldownFrames") : null } };
}

function adaptProjectile(value, ownerSeat, frame, width, height, sourceField) {
  if (value === null || value === undefined) return [];
  const values = Array.isArray(value) && Array.isArray(value[0]?.position) ? value : [value];
  return values.map((item, index) => {
    if (!item || typeof item !== "object" || !DIRECTIONS.includes(item.direction)) {
      throw new TypeError(`${sourceField} projectile invalid`);
    }
    return { observationOrdinal: index, ownerSeat, cell: cell(item.position, width, height, sourceField),
      direction: item.direction, externalKey: externalKey(item.id ?? item.objectId),
      observedAtFrame: frame, sourceField };
  });
}

function adaptBombs(game, frame, width, height, bombFuseFrames) {
  if (!has(game, "bombs")) return { fieldStatus: FIELD.ABSENT, records: [] };
  if (!Array.isArray(game.bombs)) throw new TypeError("game.bombs must be an array");
  return { fieldStatus: FIELD.PRESENT, records: game.bombs.map((bomb, index) => {
    if (!bomb || typeof bomb !== "object") throw new TypeError("bomb observation invalid");
    const remaining = has(bomb, "remainingFrames") ? integer(bomb.remainingFrames, "bomb.remainingFrames") : null;
    return { observationOrdinal: index, cell: cell(bomb.position, width, height, "bomb"),
      ownerKey: externalKey(bomb.ownerId ?? bomb.owner), externalKey: externalKey(bomb.id ?? bomb.objectId),
      explodeInterval: remaining === null ? [frame, frame + bombFuseFrames] :
        [frame + remaining, frame + remaining],
      observedAtFrame: frame };
  }) };
}

function adaptObservedRoot(me, enemy, game, context, options = {}) {
  try {
    if (!me || !enemy || !game || !context) throw new TypeError("adapter inputs are required");
    const map = adaptTerrain(game.map);
    const platformFrame = integer(game.frames, "game.frames");
    const tanks = [adaptTank(me, options.observerSeat ?? 0, platformFrame, map.width, map.height, true),
      adaptTank(enemy, (options.observerSeat ?? 0) ^ 1, platformFrame, map.width, map.height, false)]
      .sort((a, b) => a.seat - b.seat);
    const projectileRecords = [
      ...adaptProjectile(me.bullet, options.observerSeat ?? 0, platformFrame, map.width, map.height, "me.bullet"),
      ...adaptProjectile(enemy.bullet, (options.observerSeat ?? 0) ^ 1, platformFrame,
        map.width, map.height, "enemy.bullet")
    ];
    const bombs = adaptBombs(game, platformFrame, map.width, map.height,
      context.constants.bombFuseFrames);
    const starFieldStatus = fieldStatus(game, "star");
    const incompleteReasons = [];
    if (tanks.some(tank => tank.skill.fieldStatus !== FIELD.PRESENT)) {
      incompleteReasons.push("INCOMPLETE_SKILL_IDENTITY");
    }
    const root = { rootGeneration: integer(options.rootGeneration ?? 1, "rootGeneration", 1),
      platformFrame, observerSeat: options.observerSeat ?? 0, rulesetVersion: context.rulesetVersion,
      phaseOrderId: context.phaseOrderId, terminalPolicyId: context.terminalPolicyId,
      inputCapabilityMask: CAPABILITY.ENEMY_TANK | CAPABILITY.OWN_BULLET |
        CAPABILITY.ENEMY_BULLET | (bombs.fieldStatus === FIELD.PRESENT ? CAPABILITY.BOMBS : 0) |
        (starFieldStatus !== FIELD.ABSENT ? CAPABILITY.STAR : 0) |
        (incompleteReasons.length === 0 ? CAPABILITY.SKILLS : 0) |
        CAPABILITY.EFFECTS | CAPABILITY.STATUS,
      rootStatus: incompleteReasons.length === 0 ? ROOT_STATUS.OK : ROOT_STATUS.INCOMPLETE,
      incompleteReasons, map, tanks,
      projectileFieldStatus: { own: fieldStatus(me, "bullet"), enemy: fieldStatus(enemy, "bullet") },
      projectileRecords, bombs, star: { fieldStatus: starFieldStatus,
        cell: starFieldStatus === FIELD.PRESENT ? cell(game.star, map.width, map.height, "star") : null } };
    canonical(root);
    root.observationSignature = signature(root);
    return root;
  } catch (error) {
    error.code ||= "ROOT_INVALID_INPUT";
    throw error;
  }
}

module.exports = { CAPABILITY, has, fieldStatus, externalKey, adaptTerrain, adaptObservedRoot };
