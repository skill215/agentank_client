"use strict";

const { DELTAS, SKILLS, opposite, turn } = require("./codes");
const { allocateEntityId } = require("./state");
const { ReferenceRuleError, unknownRule } = require("./errors");

const CAST_TO_SKILL = Object.freeze(Object.fromEntries(SKILLS.map(skill =>
  [`CAST_${skill.toUpperCase()}`, skill])));

function activeUntil(tank, field, frame) { return tank[field] !== null && tank[field] > frame; }

function expireTimedEffects(state, sink, context) {
  const fields = ["shieldUntilFrame", "frozenUntilFrame", "stunUntilFrame", "overloadUntilFrame",
    "cloakUntilFrame", "poisonUntilFrame", "boostUntilFrame", "revealUntilFrame"];
  for (const tank of state.tanks) {
    for (const field of fields) {
      if (tank[field] !== null && tank[field] <= state.platformFrame) {
        const before = tank[field]; tank[field] = null;
        if (field === "shieldUntilFrame") tank.shieldHitsRemaining = 0;
        if (field === "poisonUntilFrame") tank.poisonAppliedFrame = null;
        sink.emit(context.phaseOrdinalById.TIMED_EXPIRY, "SKILL_EXPIRED",
          { actorSeat: tank.seat, valueBefore: before, valueAfter: null,
          reasonCode: field, ruleId: field === "shieldUntilFrame" ? "R1-SHIELD" : "R0-FRAME-PHASE-ORDER" });
      }
    }
  }
}

function stunSupport(command) {
  if (command === "GO") return ["NORMAL_FORWARD", "REVERSED_BACK"];
  if (command === "TURN_LEFT") return ["NORMAL_LEFT", "REVERSED_RIGHT"];
  if (command === "TURN_RIGHT") return ["NORMAL_RIGHT", "REVERSED_LEFT"];
  if (["FIRE", "THROW_BOMB", ...Object.keys(CAST_TO_SKILL)].includes(command)) return ["NORMAL"];
  return [];
}

function transformStunned(command, chanceCode) {
  if (command === "GO") {
    if (chanceCode === "NORMAL_FORWARD") return { command, movementMode: "FORWARD" };
    if (chanceCode === "REVERSED_BACK") return { command, movementMode: "REVERSE" };
  } else if (command === "TURN_LEFT") {
    if (chanceCode === "NORMAL_LEFT") return { command };
    if (chanceCode === "REVERSED_RIGHT") return { command: "TURN_RIGHT" };
  } else if (command === "TURN_RIGHT") {
    if (chanceCode === "NORMAL_RIGHT") return { command };
    if (chanceCode === "REVERSED_LEFT") return { command: "TURN_LEFT" };
  } else if (chanceCode === "NORMAL") return { command };
  throw new ReferenceRuleError("REFERENCE_INCOMPLETE_INPUT", "R1-STUN",
    `chanceCode ${String(chanceCode)} is outside stun support for ${command}`);
}

function poisonAllowsAction(tank, frame) {
  if (!activeUntil(tank, "poisonUntilFrame", frame)) return true;
  if (tank.poisonAppliedFrame === null) unknownRule("R1-POISON", "poison applied frame is unknown");
  return ((frame - tank.poisonAppliedFrame) & 1) === 0;
}

function teleportLandingSupport(state, targetCell) {
  const star = state.star?.cell;
  if (!star || targetCell[0] !== star[0] || targetCell[1] !== star[1]) return [targetCell];
  const support = [];
  for (const delta of Object.values(DELTAS)) {
    const cell = [star[0] + delta[0], star[1] + delta[1]];
    if (cell[0] >= 0 && cell[0] < state.map.width && cell[1] >= 0 && cell[1] < state.map.height &&
        state.map.terrainColumnMajor[cell[0]][cell[1]] === ".") support.push(cell);
  }
  return support;
}

function isCellLegal(state, cell, seat) {
  if (!Array.isArray(cell) || cell.length !== 2 || !Number.isSafeInteger(cell[0]) ||
      !Number.isSafeInteger(cell[1]) || cell[0] < 0 || cell[0] >= state.map.width ||
      cell[1] < 0 || cell[1] >= state.map.height) return false;
  if (state.map.terrainColumnMajor[cell[0]][cell[1]] !== "." &&
      state.map.terrainColumnMajor[cell[0]][cell[1]] !== "o") return false;
  return !state.tanks.some(tank => tank.seat !== seat && !tank.crashed &&
    tank.cell[0] === cell[0] && tank.cell[1] === cell[1]);
}

function applyFailedCast(state, tank, skill, failureReason, context, sink, phase) {
  if (skill === "poison" && failureReason === "COOLDOWN") {
    sink.emit(phase, "COMMAND_FAILED", { actorSeat: tank.seat, reasonCode: "SKILL_COOLDOWN",
      ruleId: "R1-FAILED-CAST" });
    return { executionStatus: "FAILED_COOLDOWN_PRESERVED", reasonCode: "SKILL_COOLDOWN" };
  }
  if (skill === "teleport" && failureReason === "INVALID_TARGET") {
    tank.skillReadyFrame = state.platformFrame + context.constants.skillCooldownFrames.teleport;
    sink.emit(phase, "COMMAND_FAILED", { actorSeat: tank.seat,
      reasonCode: "INVALID_TELEPORT_TARGET", ruleId: "R1-FAILED-CAST" });
    return { executionStatus: "FAILED_COOLDOWN_CONSUMED", reasonCode: "INVALID_TELEPORT_TARGET" };
  }
  unknownRule("R1-FAILED-CAST", `failed-cast behavior is unknown for ${skill}/${failureReason}`,
    { variantGroupId: "FAILED_CAST_COOLDOWN_V1" });
}

function castSkill(state, seat, commandRecord, context, sink, chanceCodes) {
  const tank = state.tanks[seat];
  const skill = CAST_TO_SKILL[commandRecord.command];
  if (!skill || tank.skillId !== skill) return { executionStatus: "FAILED_COOLDOWN_PRESERVED",
    reasonCode: "SKILL_MISMATCH" };
  const phase = seat === 0 ? context.phaseOrdinalById.SEAT_0_ACTION :
    context.phaseOrdinalById.SEAT_1_ACTION;
  if (tank.skillReadyFrame > state.platformFrame) {
    return applyFailedCast(state, tank, skill, "COOLDOWN", context, sink, phase);
  }
  const cooldown = context.constants.skillCooldownFrames[skill];
  const duration = context.constants.skillDurationFrames[skill];
  const target = state.tanks[seat ^ 1];
  let landed = null;
  if (skill === "teleport") {
    const requested = commandRecord.targetCell;
    const support = teleportLandingSupport(state, requested);
    if (support.length === 0 || !support.some(cell => isCellLegal(state, cell, seat))) {
      return applyFailedCast(state, tank, skill, "INVALID_TARGET", context, sink, phase);
    }
    landed = support.length === 1 ? support[0] : chanceCodes?.teleportCellBySeat?.[seat];
    if (!landed || !support.some(cell => cell[0] === landed[0] && cell[1] === landed[1])) {
      throw new ReferenceRuleError("REFERENCE_INCOMPLETE_INPUT", "R1-TELEPORT",
        "teleport star request requires a landing ChanceCode", { landingSupport: support });
    }
  }
  tank.skillReadyFrame = state.platformFrame + cooldown;
  sink.emit(phase, "SKILL_CAST", { actorSeat: seat, targetSeat: skill === "teleport" ? seat : seat ^ 1,
    reasonCode: skill, ruleId: `R1-${skill.toUpperCase()}` });
  if (skill === "shield") { tank.shieldHitsRemaining = context.constants.shieldBulletHits;
    tank.shieldUntilFrame = state.platformFrame + duration; }
  else if (skill === "freeze") target.frozenUntilFrame = state.platformFrame + duration;
  else if (skill === "stun") target.stunUntilFrame = state.platformFrame + duration;
  else if (skill === "overload") tank.overloadUntilFrame = state.platformFrame + duration;
  else if (skill === "cloak") tank.cloakUntilFrame = state.platformFrame + duration;
  else if (skill === "poison") { target.poisonAppliedFrame = state.platformFrame;
    target.poisonUntilFrame = state.platformFrame + duration; }
  else if (skill === "boost") tank.boostUntilFrame = state.platformFrame + duration;
  else if (skill === "teleport") {
    const before = [...tank.cell]; tank.cell = [...landed];
    tank.pickupLockUntilFrame = state.platformFrame + context.constants.teleportPickupLockFrames;
    const distance = Math.abs(tank.cell[0] - target.cell[0]) + Math.abs(tank.cell[1] - target.cell[1]);
    if (distance <= context.constants.teleportNearEnemyDistance) {
      tank.fireLockUntilFrame = state.platformFrame + context.constants.teleportFireLockFrames;
    }
    tank.revealUntilFrame = state.platformFrame + 1;
    sink.emit(phase, "TANK_MOVED", { actorSeat: seat, cellBefore: before, cellAfter: [...landed],
      reasonCode: "TELEPORT_LANDING", ruleId: "R1-TELEPORT" });
  }
  sink.emit(phase, "SKILL_APPLIED", { actorSeat: seat, targetSeat: skill === "shield" ||
    skill === "overload" || skill === "cloak" || skill === "boost" || skill === "teleport" ? seat : seat ^ 1,
    reasonCode: skill, valueAfter: duration, ruleId: `R1-${skill.toUpperCase()}` });
  return { executionStatus: "EXECUTED_EFFECT", reasonCode: skill };
}

function createProjectile(state, tank, memberIndex, shotGroupId, context, sink, phase) {
  const offset = memberIndex === 1 ? context.constants.overloadMemberOneOffset[tank.direction] : [0, 0];
  const cell = [tank.cell[0] + offset[0], tank.cell[1] + offset[1]];
  if (cell[0] < 0 || cell[0] >= state.map.width || cell[1] < 0 || cell[1] >= state.map.height ||
      state.map.terrainColumnMajor[cell[0]][cell[1]] === "x") return null;
  const entityId = allocateEntityId(state);
  const projectile = { entityId, ownerSeat: tank.seat, cell, direction: tank.direction,
    active: true, shotGroupId, memberIndex, createdFrame: state.platformFrame };
  state.projectiles.push(projectile);
  sink.emit(phase, "PROJECTILE_CREATED", { actorSeat: tank.seat, entitySemanticId: entityId,
    cellAfter: [...cell], valueAfter: memberIndex, reasonCode: memberIndex ? "OVERLOAD_MEMBER" : "PRIMARY",
    ruleId: memberIndex ? "R1-OVERLOAD" : "R0-PROJECTILE-LIFECYCLE" });
  return projectile;
}

function fire(state, seat, context, sink) {
  const tank = state.tanks[seat]; const phase = seat === 0 ?
    context.phaseOrdinalById.SEAT_0_ACTION : context.phaseOrdinalById.SEAT_1_ACTION;
  if (tank.fireLockUntilFrame !== null && tank.fireLockUntilFrame > state.platformFrame) {
    return { executionStatus: "EXECUTED_NO_EFFECT", reasonCode: "FIRE_LOCKED" };
  }
  if (state.projectiles.some(item => item.active && item.ownerSeat === seat)) {
    return { executionStatus: "EXECUTED_NO_EFFECT", reasonCode: "PROJECTILE_ALREADY_ACTIVE" };
  }
  const overloaded = activeUntil(tank, "overloadUntilFrame", state.platformFrame);
  const groupId = state.nextEntityId;
  createProjectile(state, tank, 0, groupId, context, sink, phase);
  if (overloaded) {
    createProjectile(state, tank, 1, groupId, context, sink, phase);
    tank.overloadUntilFrame = null;
    sink.emit(phase, "SKILL_EXPIRED", { actorSeat: seat, reasonCode: "OVERLOAD_CONSUMED",
      ruleId: "R1-OVERLOAD" });
  }
  return { executionStatus: "EXECUTED_EFFECT", reasonCode: overloaded ? "OVERLOAD_FIRE" : "FIRE" };
}

module.exports = { CAST_TO_SKILL, activeUntil, expireTimedEffects, stunSupport, transformStunned,
  poisonAllowsAction, teleportLandingSupport, isCellLegal, applyFailedCast, castSkill,
  createProjectile, fire };
