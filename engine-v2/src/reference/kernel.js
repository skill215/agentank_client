"use strict";

const { ReferenceRuleError } = require("./errors");
const { advanceFrame } = require("./timeline");

class ReferenceKernel {
  constructor(ruleContext) { if (!ruleContext) throw new TypeError("RuleContext required"); this.context = ruleContext; }
  advanceFrame(state, options = {}) {
    try { return advanceFrame(state, this.context, options); }
    catch (error) {
      if (!(error instanceof ReferenceRuleError)) throw error;
      return { status: error.code, childState: null, orderedEvents: [], statePatch: [],
        physicalSignature: null, observationsBySide: [], terminalResolution: null,
        activeAssumptionIds: [...(state.assumptionIds || [])], consumedRuleIds: [error.ruleId],
        firstUnknownRuleId: error.ruleId, incompleteReason: error.message, details: error.details };
    }
  }
}

module.exports = { ReferenceKernel };
