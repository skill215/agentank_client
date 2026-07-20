"use strict";

const crypto = require("node:crypto");
const { canonical, signature } = require("./state");

function buildCanonicalTrace(fixtureId, parentState, transition, context) {
  const trace = { schemaVersion: 1, fixtureId, header: { rulesetVersion: context.rulesetVersion,
    phaseOrderId: context.phaseOrderId, terminalPolicyId: context.terminalPolicyId,
    ruleCorpusSha256: context.ruleCorpusSha256, activeVariantByGroup: context.activeVariantByGroup,
    parentPhysicalSignature: signature(parentState) }, status: transition.status,
    events: transition.orderedEvents, statePatch: transition.statePatch,
    childPhysicalSignature: transition.physicalSignature,
    observationsBySide: transition.observationsBySide,
    terminalResolution: transition.terminalResolution,
    activeAssumptionIds: transition.activeAssumptionIds,
    firstUnknownRuleId: transition.firstUnknownRuleId };
  const bytes = JSON.stringify(canonical(trace));
  return { trace: canonical(trace), bytes,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

function replayTrace(parentState, traceRecord, kernel, options = {}) {
  const rerun = kernel.advanceFrame(parentState, options);
  const rebuilt = buildCanonicalTrace(traceRecord.trace.fixtureId, parentState, rerun, kernel.context);
  return { matches: rebuilt.bytes === traceRecord.bytes && rebuilt.sha256 === traceRecord.sha256,
    rebuilt, transition: rerun };
}

module.exports = { buildCanonicalTrace, replayTrace };
