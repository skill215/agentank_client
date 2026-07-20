"use strict";

const { clonePhysicalState, signature, validatePhysicalState } = require("./state");
const { createEventSink, validateEventOrder } = require("./events");
const { expireTimedEffects } = require("./skills");
const { applyOrderedSeatSlots } = require("./scheduler");
const { advanceProjectiles, resolveDueBombs } = require("./entities");
const { spawnDueKnownStar, resolveStar } = require("./objective");
const { observeForSide } = require("./visibility");
const terminal = require("./terminal");

function diffState(parent, child) {
  const changes = [];
  const present = value => value === undefined ? { valueKind: "FIELD_ABSENT" } : value;
  function visit(left, right, pointer) {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object" ||
        Array.isArray(left) !== Array.isArray(right)) {
      changes.push({ pointer, before: present(left), after: present(right) }); return;
    }
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) visit(left[key], right[key], `${pointer}/${key}`);
  }
  visit(parent, child, ""); return changes;
}

function advanceFrame(parent, context, options = {}) {
  validatePhysicalState(parent);
  const state = clonePhysicalState(parent); const sink = createEventSink(state.platformFrame);
  expireTimedEffects(state, sink, context);
  spawnDueKnownStar(state, sink);
  const slots = applyOrderedSeatSlots(state, context, sink, options.chanceCodes || {});
  if (slots.some(slot => slot.slotStatus === "SLOT_NEEDS_CHANCE")) {
    return { status: "REFERENCE_INCOMPLETE_INPUT", childState: null, orderedEvents: [],
      statePatch: [], physicalSignature: null, observationsBySide: [], terminalResolution: null,
      activeAssumptionIds: [...parent.assumptionIds], consumedRuleIds: ["R1-STUN"],
      firstUnknownRuleId: "R1-STUN", slots };
  }
  if (slots.some(slot => slot.slotStatus === "SLOT_INCOMPLETE_RULE")) {
    return { status: "REFERENCE_UNSUPPORTED_RULE", childState: null, orderedEvents: [],
      statePatch: [], physicalSignature: null, observationsBySide: [], terminalResolution: null,
      activeAssumptionIds: [...parent.assumptionIds], consumedRuleIds: ["R1-BOOST"],
      firstUnknownRuleId: "R1-BOOST", slots };
  }
  resolveStar(state, context, sink);
  advanceProjectiles(state, context, sink);
  resolveDueBombs(state, context, sink);
  const terminalResolution = terminal.resolve(state, context, options.perspectiveSeat ?? 0);
  if (terminalResolution.outcome !== "NON_TERMINAL") {
    state.terminal = structuredClone(terminalResolution);
    sink.emit(context.phaseOrdinalById.TERMINAL_RESOLUTION, "TERMINAL_RESOLVED",
      { valueAfter: terminalResolution.winnerSeat,
      reasonCode: terminalResolution.cause, ruleId: "R0-TERMINAL-PRIORITY" });
  }
  const observationsBySide = [observeForSide(state, 0, context), observeForSide(state, 1, context)];
  const observationIncomplete = observationsBySide.some(observation => !observation.complete);
  state.phaseOrdinal = context.phaseOrdinalById.OBSERVATION_EMISSION;
  validateEventOrder(sink.events); validatePhysicalState(state);
  if (terminalResolution.outcome === "NON_TERMINAL") {
    state.platformFrame += 1;
    state.recordIndex += 1;
    state.phaseOrdinal = 0;
  }
  const physicalSignature = signature(state);
  return { status: observationIncomplete ? "REFERENCE_UNKNOWN_RULE" :
    terminalResolution.outcome === "NON_TERMINAL" ? "REFERENCE_OK" :
    terminalResolution.status === "RESOLVED" ? "REFERENCE_TERMINAL" : "REFERENCE_UNKNOWN_RULE",
    childState: state, orderedEvents: sink.events, statePatch: diffState(parent, state),
    physicalSignature, observationsBySide, terminalResolution,
    activeAssumptionIds: [...state.assumptionIds],
    consumedRuleIds: ["R0-FRAME-PHASE-ORDER", "R0-SCHEDULER-SEAT-ORDER",
      "R0-STAR-LIFECYCLE", "R0-PROJECTILE-LIFECYCLE", "R0-BOMB-LIFECYCLE",
      "R0-TERMINAL-PRIORITY", "R0-OBSERVATION-VISIBILITY"],
    firstUnknownRuleId: observationIncomplete ? "R0-OBSERVATION-VISIBILITY" : null, slots };
}

module.exports = { diffState, advanceFrame };
