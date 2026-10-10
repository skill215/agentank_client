"use strict";

const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { V3_RESULT_STATUS, V3_PROPOSAL_CLASS, V3_EVIDENCE } = require("./contracts");

// One instance belongs to one component. It is reset in place on every call.
class ComponentResult {
  constructor(bus = null, slot = -1, eligible = false) {
    this.bus = bus;
    this.slot = slot;
    this.eligible = !!eligible;
    this.status = V3_RESULT_STATUS.PASS;
    this.action = ACTION.NONE;
    this.argument = -1;
    this.supportComplete = false;
    this.evidenceFlags = V3_EVIDENCE.NONE;
    this.workUnits = 0;
    this.proposalClass = V3_PROPOSAL_CLASS.NONE;
  }

  reset() {
    this.status = V3_RESULT_STATUS.PASS;
    this.action = ACTION.NONE;
    this.argument = -1;
    this.supportComplete = false;
    this.evidenceFlags = V3_EVIDENCE.NONE;
    this.workUnits = 0;
    this.proposalClass = V3_PROPOSAL_CLASS.NONE;
    return this;
  }

  set(status, action, argument, supportComplete, evidenceFlags, workUnits,
      proposalClass = V3_PROPOSAL_CLASS.NONE, eligible = this.eligible) {
    this.status = status;
    this.action = action;
    this.argument = argument | 0;
    this.supportComplete = !!supportComplete;
    this.evidenceFlags = evidenceFlags | 0;
    this.workUnits = workUnits >>> 0;
    this.proposalClass = proposalClass;
    if (this.bus && this.slot >= 0) this.status = this.bus.write(this.slot, status, action,
      argument, proposalClass, supportComplete, evidenceFlags, workUnits, eligible);
    return this;
  }
}

module.exports = { ComponentResult };
