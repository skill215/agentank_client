"use strict";

const scheduler = require("./scheduler");
const timeline = require("./timeline");
const entities = require("./entities");
const objective = require("./objective");
const terminal = require("./terminal");
const visibility = require("./visibility");
const skills = require("./skills");
const { unknownRule } = require("./errors");

const ReferenceScheduler = Object.freeze({ applyOrderedSeatSlots: scheduler.applyOrderedSeatSlots });
const ReferenceFrameTimeline = Object.freeze({ advanceFrame: timeline.advanceFrame });
const ReferenceEntityKernel = Object.freeze({ advanceProjectiles: entities.advanceProjectiles,
  resolveDueBombs: entities.resolveDueBombs });
const ReferenceObjectiveKernel = Object.freeze({ resolveStar: objective.resolveStar });
const ReferenceTerminalResolver = Object.freeze({ resolve: terminal.resolve });
const ReferenceTerrainKernel = Object.freeze({ resolveMoves: scheduler.moveTank });
const ReferenceObservationKernel = Object.freeze({ observeForSide: visibility.observeForSide });
const ReferenceSkillKernel = Object.freeze({
  applyShield: skills.castSkill, applyFreeze: skills.castSkill,
  applyStunOutcome: skills.transformStunned, applyOverloadFire: skills.fire,
  applyCloak: skills.castSkill, applyPoisonCadence: skills.poisonAllowsAction,
  applyTeleport: skills.teleportLandingSupport, applyBoostSlot: scheduler.prepareSeatSlot,
  applyFailedCast: skills.applyFailedCast
});
const ReferenceChanceKernel = Object.freeze({ enumerateStun: skills.stunSupport,
  enumerateTeleportLanding: skills.teleportLandingSupport,
  rejectUnconfirmedFutureStarModel() { unknownRule("R2-FUTURE-STAR",
    "future star model is not confirmed"); } });

const HANDLER_NAMESPACES = Object.freeze({ ReferenceScheduler, ReferenceFrameTimeline,
  ReferenceEntityKernel, ReferenceObjectiveKernel, ReferenceTerminalResolver,
  ReferenceTerrainKernel, ReferenceObservationKernel, ReferenceSkillKernel,
  ReferenceChanceKernel });

function resolveReferenceHandler(binding) {
  const [namespace, method, extra] = String(binding).split(".");
  if (extra !== undefined || typeof HANDLER_NAMESPACES[namespace]?.[method] !== "function") return null;
  return HANDLER_NAMESPACES[namespace][method];
}

module.exports = { ...HANDLER_NAMESPACES, HANDLER_NAMESPACES, resolveReferenceHandler };
