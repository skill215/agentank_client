"use strict";

const { ACTION, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { V3_SLOT_COUNT, V3_RESULT_STATUS, V3_PROPOSAL_CLASS,
  V3_EVIDENCE } = require("./contracts");

// One fixed bus belongs to one controller. A generation stamp makes stale
// proposals invisible without allocating or clearing objects per callback.
class ProposalBus {
  constructor(storage = null) {
    const borrowed = storage !== null;
    this.status = borrowed ? storage.status : new Uint8Array(V3_SLOT_COUNT);
    this.action = borrowed ? storage.action : new Uint8Array(V3_SLOT_COUNT);
    this.argument = borrowed ? storage.argument : new Uint16Array(V3_SLOT_COUNT);
    this.proposalClass = borrowed ? storage.proposalClass : new Uint8Array(V3_SLOT_COUNT);
    this.supportComplete = borrowed ? storage.supportComplete : new Uint8Array(V3_SLOT_COUNT);
    this.evidenceFlags = borrowed ? storage.evidenceFlags : new Uint16Array(V3_SLOT_COUNT);
    this.workUnits = borrowed ? storage.workUnits : new Uint32Array(V3_SLOT_COUNT);
    this.generation = borrowed ? storage.generation : new Uint16Array(V3_SLOT_COUNT);
    this.eligible = borrowed ? storage.eligible : new Uint8Array(V3_SLOT_COUNT);
    this.borrowedStorage = borrowed;
    this.currentGeneration = 1;
    this.frame = -1;
    this.proposedNoneViolationCount = 0;
    this.selectedNoneViolationCount = 0;
    this.selectedOwnershipViolationCount = 0;
    this.hotAllocationCount = 0;
    this.argument.fill(NONE_CELL);
  }

  beginFrame(frame) {
    if (frame === this.frame) return;
    this.frame = frame;
    this.currentGeneration = (this.currentGeneration + 1) & 0xffff;
    if (this.currentGeneration === 0) {
      this.generation.fill(0); this.currentGeneration = 1;
    }
  }

  write(slot, status, action, argument, proposalClass, supportComplete,
      evidenceFlags, workUnits, eligible) {
    let actualStatus = status;
    if (actualStatus === V3_RESULT_STATUS.SELECTED && slot !== 10) {
      this.selectedOwnershipViolationCount += 1;
      actualStatus = V3_RESULT_STATUS.PROPOSED;
    }
    const intentionalWait = proposalClass === V3_PROPOSAL_CLASS.INTENTIONAL_WAIT &&
      (evidenceFlags & V3_EVIDENCE.INTENTIONAL_WAIT) !== 0;
    if ((status === V3_RESULT_STATUS.PROPOSED || status === V3_RESULT_STATUS.SELECTED) &&
        action === ACTION.NONE && !intentionalWait) {
      if (status === V3_RESULT_STATUS.PROPOSED) this.proposedNoneViolationCount += 1;
      else this.selectedNoneViolationCount += 1;
      actualStatus = V3_RESULT_STATUS.NO_PROPOSAL;
      proposalClass = V3_PROPOSAL_CLASS.NONE;
      eligible = false;
    }
    this.status[slot] = actualStatus;
    this.action[slot] = action;
    this.argument[slot] = argument < 0 ? NONE_CELL : argument;
    this.proposalClass[slot] = proposalClass;
    this.supportComplete[slot] = supportComplete ? 1 : 0;
    this.evidenceFlags[slot] = evidenceFlags;
    this.workUnits[slot] = workUnits;
    this.eligible[slot] = eligible ? 1 : 0;
    this.generation[slot] = this.currentGeneration;
    return actualStatus;
  }

  current(slot) { return this.generation[slot] === this.currentGeneration; }

  bytes() {
    // The ABI has 210 fixed logical bytes, allocated once per controller.
    return V3_SLOT_COUNT * (1 + 1 + 2 + 1 + 1 + 2 + 4 + 2 + 1);
  }

  allocatedBytes() { return this.borrowedStorage ? 0 : this.bytes(); }
}

module.exports = { ProposalBus };
