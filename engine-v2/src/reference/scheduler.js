"use strict";

const { DELTAS, opposite, turn } = require("./codes");
const { allocateEntityId } = require("./state");
const { requireVariant, ReferenceRuleError } = require("./errors");
const { CAST_TO_SKILL, activeUntil, poisonAllowsAction, stunSupport, transformStunned,
  castSkill, fire } = require("./skills");

function normalizeCommand(record, frame) {
  if (typeof record === "string") return { command: record, eligibleAtFrame: frame };
  if (!record || typeof record !== "object" || typeof record.command !== "string") {
    throw new TypeError("queue command record is invalid");
  }
  return { command: record.command, eligibleAtFrame: record.eligibleAtFrame ?? frame,
    targetCell: record.targetCell ? [...record.targetCell] : null };
}

function prepareSeatSlot(state, seat, chanceCodes, context) {
  const tank = state.tanks[seat]; const frame = state.platformFrame;
  if (tank.crashed) return { slotStatus: "SLOT_NO_ACTION", commands: [] };
  if (activeUntil(tank, "frozenUntilFrame", frame)) {
    if (tank.queue.length === 0) {
      const variant = requireVariant(context, "FREEZE_EMPTY_QUEUE_POLL_V1", "R1-FREEZE");
      return { slotStatus: "SLOT_DEFERRED_CONTROL", commands: [], variant };
    }
    return { slotStatus: "SLOT_DEFERRED_CONTROL", commands: [] };
  }
  if (!tank.canActThisFrame || !poisonAllowsAction(tank, frame)) {
    if (tank.queue.length === 0 && activeUntil(tank, "poisonUntilFrame", frame)) {
      const variant = requireVariant(context, "POISON_EMPTY_QUEUE_REPOLL_V1", "R1-POISON");
      return { slotStatus: "SLOT_DEFERRED_CONTROL", commands: [], variant };
    }
    return { slotStatus: "SLOT_DEFERRED_CONTROL", commands: [] };
  }
  if (tank.queue.length === 0) return { slotStatus: "SLOT_NO_ACTION", commands: [] };
  const first = normalizeCommand(tank.queue[0], frame);
  if (first.eligibleAtFrame > frame) return { slotStatus: "SLOT_DEFERRED_NOT_ELIGIBLE", commands: [] };
  const boosted = activeUntil(tank, "boostUntilFrame", frame);
  const commands = [];
  if (boosted && (first.command === "TURN_LEFT" || first.command === "TURN_RIGHT")) {
    commands.push({ ...first, freeTurn: true, queueIndex: 0 });
    if (tank.queue.length > 1) {
      const second = normalizeCommand(tank.queue[1], frame);
      if (second.eligibleAtFrame <= frame) commands.push({ ...second, freeTurn: false, queueIndex: 1 });
    } else {
      const variant = requireVariant(context, "BOOST_EMPTY_QUEUE_REPOLL_V1", "R1-BOOST");
      if (variant === "SAME_FRAME_REPOLL") return { slotStatus: "SLOT_INCOMPLETE_RULE",
        commands, incompleteReason: "INCOMPLETE_ACTION_SUPPORT" };
    }
  } else commands.push({ ...first, freeTurn: false, queueIndex: 0 });
  for (const command of commands) {
    if (activeUntil(tank, "stunUntilFrame", frame)) {
      const support = stunSupport(command.command);
      if (support.length === 0) throw new ReferenceRuleError("REFERENCE_UNKNOWN_RULE", "R1-STUN",
        `stun support unknown for ${command.command}`);
      const code = chanceCodes?.stunBySeat?.[seat];
      if (!code) return { slotStatus: "SLOT_NEEDS_CHANCE", commands, chanceSupport: support };
      Object.assign(command, transformStunned(command.command, code));
    }
  }
  return { slotStatus: "SLOT_PREPARED", commands };
}

function seatMayRelocate(state, seat) {
  const tank = state.tanks[seat]; const frame = state.platformFrame;
  if (tank.crashed || activeUntil(tank, "frozenUntilFrame", frame) ||
      !tank.canActThisFrame || !poisonAllowsAction(tank, frame) || tank.queue.length === 0)
    return false;
  const first = normalizeCommand(tank.queue[0], frame);
  if (first.eligibleAtFrame > frame) return false;
  if (first.command === "GO" || first.command === "CAST_TELEPORT") return true;
  if (!activeUntil(tank, "boostUntilFrame", frame) ||
      (first.command !== "TURN_LEFT" && first.command !== "TURN_RIGHT") ||
      tank.queue.length < 2) return false;
  const second = normalizeCommand(tank.queue[1], frame);
  return second.eligibleAtFrame <= frame &&
    (second.command === "GO" || second.command === "CAST_TELEPORT");
}

function confirmedPlainGoDestination(state, seat) {
  const tank = state.tanks[seat]; const frame = state.platformFrame;
  if (tank.crashed || activeUntil(tank, "frozenUntilFrame", frame) ||
      activeUntil(tank, "stunUntilFrame", frame) || activeUntil(tank, "poisonUntilFrame", frame) ||
      activeUntil(tank, "boostUntilFrame", frame) || !tank.canActThisFrame || tank.queue.length === 0)
    return null;
  const command = normalizeCommand(tank.queue[0], frame);
  if (command.eligibleAtFrame > frame || command.command !== "GO") return null;
  const delta = DELTAS[tank.direction]; const target = [tank.cell[0] + delta[0], tank.cell[1] + delta[1]];
  if (target[0] < 0 || target[0] >= state.map.width ||
      target[1] < 0 || target[1] >= state.map.height) return null;
  const tile = state.map.terrainColumnMajor[target[0]][target[1]];
  return tile === "x" || tile === "m" ? null : target;
}

function buildRelocationSupport(state) {
  const startCells = state.tanks.map(tank => [...tank.cell]);
  const destination = [confirmedPlainGoDestination(state, 0),
    confirmedPlainGoDestination(state, 1)];
  const same = (left, right) => left && right && left[0] === right[0] && left[1] === right[1];
  const bothPlain = Boolean(destination[0] && destination[1]);
  const confirmedVacating = [bothPlain, bothPlain];
  if (same(destination[0], startCells[1]) && same(destination[1], startCells[0])) {
    confirmedVacating[0] = false; confirmedVacating[1] = false;
  }
  return { mayRelocate: [seatMayRelocate(state, 0), seatMayRelocate(state, 1)],
    confirmedVacating, startCells };
}

function moveTank(state, seat, mode, boosted, context, sink, phase, relocationSupport) {
  const tank = state.tanks[seat]; const direction = mode === "REVERSE" ? opposite(tank.direction) : tank.direction;
  const delta = DELTAS[direction]; const steps = boosted ? 2 : 1; const before = [...tank.cell];
  let moved = 0;
  for (let step = 0; step < steps; step += 1) {
    const target = [tank.cell[0] + delta[0], tank.cell[1] + delta[1]];
    if (target[0] < 0 || target[0] >= state.map.width || target[1] < 0 || target[1] >= state.map.height) break;
    const tile = state.map.terrainColumnMajor[target[0]][target[1]];
    if (tile === "x" || tile === "m") break;
    const occupied = state.tanks.find(other => other.seat !== seat && !other.crashed &&
      other.cell[0] === target[0] && other.cell[1] === target[1]);
    if (occupied) {
      if (!relocationSupport?.mayRelocate?.[occupied.seat]) break;
      const occupiedStart = relocationSupport.startCells[occupied.seat];
      if (relocationSupport.confirmedVacating[occupied.seat] &&
          occupiedStart[0] === target[0] && occupiedStart[1] === target[1]) {
        tank.cell = target; moved += 1; continue;
      }
      const variant = requireVariant(context, "MOVE_CONTEST_V1", "R0-MOVE-AND-CONTEST");
      if (variant === "COLLISION_CRASH") { tank.crashed = true; occupied.crashed = true;
        sink.emit(phase, "TANK_CRASHED", { actorSeat: seat, targetSeat: occupied.seat,
          reasonCode: "MOVE_COLLISION", ruleId: "R0-MOVE-AND-CONTEST" }); }
      break;
    }
    tank.cell = target; moved += 1;
  }
  if (moved > 0) sink.emit(phase, "TANK_MOVED", { actorSeat: seat, cellBefore: before,
    cellAfter: [...tank.cell], valueAfter: moved, reasonCode: mode,
    ruleId: "R0-MOVE-AND-CONTEST" });
  return { executionStatus: moved ? "EXECUTED_EFFECT" : "EXECUTED_NO_EFFECT",
    reasonCode: moved ? (boosted ? "BOOST_GO" : "GO") : "MOVE_BLOCKED" };
}

function throwBomb(state, seat, context, sink, phase) {
  const tank = state.tanks[seat];
  if (tank.bombCooldownReadyFrame > state.platformFrame ||
      state.bombs.some(bomb => bomb.active && bomb.ownerSeat === seat)) {
    return { executionStatus: "EXECUTED_NO_EFFECT", reasonCode: "BOMB_UNAVAILABLE" };
  }
  const id = allocateEntityId(state);
  state.bombs.push({ entityId: id, ownerSeat: seat, cell: [...tank.cell],
    placedFrame: state.platformFrame,
    explodeFrame: state.platformFrame + context.constants.bombFuseFrames,
    active: true, visibility: state.map.terrainColumnMajor[tank.cell[0]][tank.cell[1]] === "o" ?
      "HIDDEN_GRASS" : "VISIBLE_OPEN" });
  sink.emit(phase, "BOMB_PLACED", { actorSeat: seat, entitySemanticId: id,
    cellAfter: [...tank.cell], valueAfter: state.platformFrame + context.constants.bombFuseFrames,
    ruleId: "R0-BOMB-LIFECYCLE" });
  return { executionStatus: "EXECUTED_EFFECT", reasonCode: "BOMB_PLACED" };
}

function executeCommand(state, seat, command, context, sink, chanceCodes, relocationSupport) {
  const tank = state.tanks[seat]; const phase = seat === 0 ?
    context.phaseOrdinalById.SEAT_0_ACTION : context.phaseOrdinalById.SEAT_1_ACTION; let result;
  if (command.command === "TURN_LEFT" || command.command === "TURN_RIGHT") {
    const before = tank.direction; tank.direction = turn(tank.direction,
      command.command === "TURN_LEFT" ? "left" : "right");
    sink.emit(phase, "TANK_TURNED", { actorSeat: seat, valueBefore: before,
      valueAfter: tank.direction, reasonCode: command.freeTurn ? "BOOST_FREE_TURN" : "TURN",
      ruleId: command.freeTurn ? "R1-BOOST" : "R0-SCHEDULER-SEAT-ORDER" });
    result = { executionStatus: command.freeTurn ? "EXECUTED_TRANSFORMED" : "EXECUTED_EFFECT",
      reasonCode: command.freeTurn ? "BOOST_FREE_TURN" : "TURN" };
  } else if (command.command === "GO") result = moveTank(state, seat, command.movementMode ?? "FORWARD",
    activeUntil(tank, "boostUntilFrame", state.platformFrame), context, sink, phase,
    relocationSupport);
  else if (command.command === "FIRE") result = fire(state, seat, context, sink);
  else if (command.command === "THROW_BOMB") result = throwBomb(state, seat, context, sink, phase);
  else if (CAST_TO_SKILL[command.command]) result = castSkill(state, seat, command, context, sink, chanceCodes);
  else throw new ReferenceRuleError("REFERENCE_INCOMPLETE_INPUT", "R0-SCHEDULER-SEAT-ORDER",
    `unknown command ${command.command}`);
  sink.emit(phase, "COMMAND_EXECUTED", { actorSeat: seat, reasonCode: result.reasonCode,
    ruleId: CAST_TO_SKILL[command.command] ? `R1-${CAST_TO_SKILL[command.command].toUpperCase()}` :
      "R0-SCHEDULER-SEAT-ORDER" });
  return result;
}

function applySeatSlot(state, seat, context, sink, chanceCodes, relocationSupport) {
  const prepared = prepareSeatSlot(state, seat, chanceCodes, context);
  if (prepared.slotStatus !== "SLOT_PREPARED") return prepared;
  const results = [];
  for (const command of prepared.commands) results.push(executeCommand(state, seat, command,
    context, sink, chanceCodes, relocationSupport));
  state.tanks[seat].queue.splice(0, prepared.commands.length);
  return { slotStatus: "SLOT_EXECUTED", commands: prepared.commands, results };
}

function applyOrderedSeatSlots(state, context, sink, chanceCodes = {}) {
  const relocationSupport = buildRelocationSupport(state);
  const slots = [applySeatSlot(state, 0, context, sink, chanceCodes, relocationSupport)];
  if (slots[0].slotStatus === "SLOT_NEEDS_CHANCE") return slots;
  slots.push(applySeatSlot(state, 1, context, sink, chanceCodes, relocationSupport));
  return slots;
}

module.exports = { normalizeCommand, prepareSeatSlot, moveTank, throwBomb, executeCommand,
  applySeatSlot, applyOrderedSeatSlots, seatMayRelocate, confirmedPlainGoDestination,
  buildRelocationSupport };
