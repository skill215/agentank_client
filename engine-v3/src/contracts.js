"use strict";

const { ACTION } = require("../../engine-v2/src/abi/fast-codes");

const V3_COMPONENT_ABI = 1;

const V3_COMPONENT_MODE = Object.freeze({
  PASS_THROUGH: 0,
  SHADOW: 1,
  ACTIVE: 2
});

const V3_RESULT_STATUS = Object.freeze({
  PASS: 0,
  PROPOSED: 1,
  SELECTED: 2,
  INCOMPLETE: 3,
  NO_PROPOSAL: 4
});

const V3_PROPOSAL_CLASS = Object.freeze({
  NONE: 0,
  COMMITTED_RESCUE: 1,
  STRICT_FORCED_WIN: 2,
  EXACT_VALUE_DOMINANCE: 3,
  VERIFIED_ATTACK: 4,
  STRATEGIC_PROGRESS: 5,
  INTENTIONAL_WAIT: 6
});

const V3_EVIDENCE = Object.freeze({
  NONE: 0,
  OBSERVATION_COMPLETE: 1 << 0,
  COMMITTED: 1 << 1,
  PHYSICAL_HARD: 1 << 2,
  STRICT_PROOF: 1 << 3,
  INFORMATION: 1 << 4,
  FALLBACK: 1 << 5,
  INTENTIONAL_WAIT: 1 << 6
});

const V3_SLOT = Object.freeze({
  OBSERVE_ENEMY: 0,
  TRACK_PROJECTILES: 1,
  VISIBLE_BOMB_SAFETY: 2,
  VISIBLE_PROJECTILE_SAFETY: 3,
  PROJECTILE_ESCAPE: 4,
  HIDDEN_ATTACK: 5,
  DIRECT_ATTACK: 6,
  PREEMPTIVE_SAFETY: 7,
  TACTICAL_SEARCH: 8,
  NAVIGATION: 9,
  FINAL_ACTION_GATE: 10,
  FRAME_PREPARE: 11,
  TACTICAL_CONTACT: 12,
  ACTION_EMIT: 13
});

const V3_SLOT_COUNT = 14;

const V3_PORTS = Object.freeze([
  Object.freeze({ slot: V3_SLOT.OBSERVE_ENEMY,
    name: "OBSERVE_ENEMY", legacyName: "observeEnemyBehavior", arity: 3 }),
  Object.freeze({ slot: V3_SLOT.TRACK_PROJECTILES,
    name: "TRACK_PROJECTILES", legacyName: "updateEnemyProjectileTracking", arity: 3 }),
  Object.freeze({ slot: V3_SLOT.VISIBLE_BOMB_SAFETY,
    name: "VISIBLE_BOMB_SAFETY", legacyName: "chooseVisibleBombSafetyAction", arity: 3 }),
  Object.freeze({ slot: V3_SLOT.VISIBLE_PROJECTILE_SAFETY,
    name: "VISIBLE_PROJECTILE_SAFETY", legacyName: "dodgeVisibleBullet", arity: 3 }),
  Object.freeze({ slot: V3_SLOT.PROJECTILE_ESCAPE,
    name: "PROJECTILE_ESCAPE", legacyName: "continueProjectileEvasion", arity: 3 }),
  Object.freeze({ slot: V3_SLOT.HIDDEN_ATTACK,
    name: "HIDDEN_ATTACK", legacyName: "winningHiddenAttackAction", arity: 3 }),
  Object.freeze({ slot: V3_SLOT.DIRECT_ATTACK,
    name: "DIRECT_ATTACK", legacyName: "winningAttackAction", arity: 3 }),
  Object.freeze({ slot: V3_SLOT.PREEMPTIVE_SAFETY,
    name: "PREEMPTIVE_SAFETY", legacyName: "preemptiveMuzzleDodge", arity: 3 }),
  Object.freeze({ slot: V3_SLOT.TACTICAL_SEARCH,
    name: "TACTICAL_SEARCH", legacyName: "chooseTacticalAction", arity: 2 }),
  Object.freeze({ slot: V3_SLOT.NAVIGATION,
    name: "NAVIGATION", legacyName: "navigateWhenHidden", arity: 3 }),
  Object.freeze({ slot: V3_SLOT.FINAL_ACTION_GATE,
    name: "FINAL_ACTION_GATE", legacyName: "saferRuntimeAction", arity: 4 }),
  Object.freeze({ slot: V3_SLOT.FRAME_PREPARE,
    name: "FRAME_PREPARE", legacyName: "v3FramePrepare", arity: 3 }),
  Object.freeze({ slot: V3_SLOT.TACTICAL_CONTACT,
    name: "TACTICAL_CONTACT", legacyName: "v3TacticalContact", arity: 4 }),
  Object.freeze({ slot: V3_SLOT.ACTION_EMIT,
    name: "ACTION_EMIT", legacyName: "executeAction", arity: 4 })
]);

const LEGACY_TO_ACTION = Object.freeze({
  NONE: ACTION.NONE,
  GO: ACTION.GO,
  LEFT: ACTION.TURN_LEFT,
  RIGHT: ACTION.TURN_RIGHT,
  FIRE: ACTION.FIRE,
  BOMB: ACTION.THROW_BOMB,
  SHIELD: ACTION.CAST_SHIELD,
  FREEZE: ACTION.CAST_FREEZE,
  STUN: ACTION.CAST_STUN,
  OVERLOAD: ACTION.CAST_OVERLOAD,
  CLOAK: ACTION.CAST_CLOAK,
  POISON: ACTION.CAST_POISON,
  TELEPORT: ACTION.CAST_TELEPORT,
  BOOST: ACTION.CAST_BOOST
});

const ACTION_TO_LEGACY = Object.freeze(Object.fromEntries(
  Object.entries(LEGACY_TO_ACTION).map(([token, code]) => [code, token])));

function actionFromLegacy(token) {
  if (token === null || token === undefined) return ACTION.NONE;
  return LEGACY_TO_ACTION[token] === undefined ? ACTION.NONE : LEGACY_TO_ACTION[token];
}

function actionToLegacy(action) {
  return ACTION_TO_LEGACY[action] === undefined ? "NONE" : ACTION_TO_LEGACY[action];
}

module.exports = { V3_COMPONENT_ABI, V3_COMPONENT_MODE, V3_RESULT_STATUS,
  V3_PROPOSAL_CLASS, V3_EVIDENCE,
  V3_SLOT, V3_SLOT_COUNT, V3_PORTS,
  LEGACY_TO_ACTION, ACTION_TO_LEGACY, actionFromLegacy, actionToLegacy };
