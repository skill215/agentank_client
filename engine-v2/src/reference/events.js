"use strict";

function createEventSink(platformFrame) {
  const events = [];
  return { events, emit(phaseOrdinal, eventCode, fields = {}) {
    const event = { platformFrame, phaseOrdinal, substepOrdinal: fields.substepOrdinal ?? 0,
      sequenceOrdinal: events.length, eventCode, actorSeat: fields.actorSeat ?? null,
      targetSeat: fields.targetSeat ?? null, entitySemanticId: fields.entitySemanticId ?? null,
      sourceEntitySemanticId: fields.sourceEntitySemanticId ?? null,
      cellBefore: fields.cellBefore ?? null, cellAfter: fields.cellAfter ?? null,
      valueBefore: fields.valueBefore ?? null, valueAfter: fields.valueAfter ?? null,
      reasonCode: fields.reasonCode ?? null, ruleId: fields.ruleId };
    events.push(event); return event;
  } };
}

function validateEventOrder(events) {
  let prior = [-1, -1, -1];
  for (const event of events) {
    const key = [event.phaseOrdinal, event.substepOrdinal, event.sequenceOrdinal];
    if (key[0] < prior[0] || (key[0] === prior[0] && key[1] < prior[1]) ||
        (key[0] === prior[0] && key[1] === prior[1] && key[2] <= prior[2])) {
      throw new TypeError("canonical event order regressed or duplicated");
    }
    prior = key;
  }
  return true;
}

module.exports = { createEventSink, validateEventOrder };
