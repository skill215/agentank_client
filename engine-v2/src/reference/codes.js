"use strict";

const FIELD = Object.freeze({ ABSENT: "FIELD_ABSENT", NULL: "FIELD_NULL", PRESENT: "FIELD_PRESENT" });
const ROOT_STATUS = Object.freeze({ OK: "ROOT_OK", INCOMPLETE: "ROOT_INCOMPLETE_RULE",
  INVALID: "ROOT_INVALID_INPUT" });
const REFERENCE_STATUS = Object.freeze({ OK: "REFERENCE_OK", TERMINAL: "REFERENCE_TERMINAL",
  UNKNOWN_RULE: "REFERENCE_UNKNOWN_RULE", VARIANT_REQUIRED: "REFERENCE_VARIANT_REQUIRED",
  INCOMPLETE_INPUT: "REFERENCE_INCOMPLETE_INPUT",
  INCONSISTENT_SOURCE: "REFERENCE_INCONSISTENT_SOURCE",
  UNSUPPORTED_RULE: "REFERENCE_UNSUPPORTED_RULE", INTERNAL_ERROR: "REFERENCE_INTERNAL_ERROR" });
const STATE_KIND = Object.freeze({ PHYSICAL: "PHYSICAL_STATE", INFORMATION: "INFORMATION_STATE" });
const TERRAIN = Object.freeze({ ".": "OPEN", x: "WALL", m: "DIRT", o: "GRASS" });
const DIRECTIONS = Object.freeze(["up", "right", "down", "left"]);
const DELTAS = Object.freeze({ up: Object.freeze([0, -1]), right: Object.freeze([1, 0]),
  down: Object.freeze([0, 1]), left: Object.freeze([-1, 0]) });
const SKILLS = Object.freeze(["shield", "freeze", "stun", "overload", "cloak", "poison",
  "teleport", "boost"]);
const COMMANDS = Object.freeze(["GO", "TURN_LEFT", "TURN_RIGHT", "FIRE", "THROW_BOMB",
  "CAST_SHIELD", "CAST_FREEZE", "CAST_STUN", "CAST_OVERLOAD", "CAST_CLOAK",
  "CAST_POISON", "CAST_TELEPORT", "CAST_BOOST"]);

function directionId(value) {
  const id = DIRECTIONS.indexOf(value);
  if (id < 0) throw new TypeError(`invalid direction: ${String(value)}`);
  return id;
}

function turn(direction, side) {
  const id = directionId(direction);
  return DIRECTIONS[(id + (side === "left" ? 3 : 1)) & 3];
}

function opposite(direction) {
  return DIRECTIONS[(directionId(direction) + 2) & 3];
}

module.exports = { FIELD, ROOT_STATUS, REFERENCE_STATUS, STATE_KIND, TERRAIN, DIRECTIONS, DELTAS,
  SKILLS, COMMANDS, directionId, turn, opposite };
