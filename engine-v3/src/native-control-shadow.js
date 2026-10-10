"use strict";

const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { ROOT_CONTROL_MODE, ROOT_CONTROL_REASON } =
  require("../../engine-v2/src/runtime/root-control-mode");
const { SUPPORT_STATUS } = require("../../engine-v2/src/runtime/escape-obligation");

const SHADOW_MODE = Object.freeze({
  INCOMPLETE: 0,
  COMMITTED_ESCAPE: ROOT_CONTROL_MODE.COMMITTED_ESCAPE,
  TACTICAL_CONTACT: ROOT_CONTROL_MODE.TACTICAL_CONTACT,
  STRATEGIC_NAVIGATION: ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION
});

const NATIVE_CONTROL_PORT = Object.freeze({
  COMMITTED_SAFETY: 1 << 0,
  VERIFIED_INITIATIVE: 1 << 1,
  PREEMPTIVE_SAFETY: 1 << 2,
  STABILITY: 1 << 3,
  TACTICAL_EVIDENCE: 1 << 4,
  NAVIGATION: 1 << 5,
  INFORMATION_INCOMPLETE: 1 << 6
});

// Executes only the common physical prefix needed to classify ownership. It
// does not score or select an action, and never runs Minimax/InformationSearch.
class NativeControlModeShadow {
  constructor() {
    this.modeStream = new Uint8Array(128);
    this.reasonStream = new Uint8Array(128);
    this.portMaskStream = new Uint8Array(128);
    this.modeCounts = new Uint32Array(4);
    this.reasonCounts = new Uint32Array(6);
    this.streamUsed = 0;
    this.observeCount = 0;
    this.incompleteCount = 0;
    this.informationIncompleteCount = 0;
    this.rootRestoreFailureCount = 0;
    this.hardEvaluationCount = 0;
    this.escapeEvaluationCount = 0;
    this.searchNodeCount = 0;
    this.hotAllocationCount = 0;
    this.lastMode = SHADOW_MODE.INCOMPLETE;
    this.lastReason = 0;
    this.lastPortMask = 0;
    this.committedPortCount = 0;
    this.stabilityPortCount = 0;
    this.tacticalPortCount = 0;
    this.navigationPortCount = 0;
    this.overlapPortCount = 0;
  }

  record(mode, reason, portMask = 0) {
    this.lastMode = mode;
    this.lastReason = reason;
    this.lastPortMask = portMask;
    this.modeCounts[mode] += 1;
    if (reason < this.reasonCounts.length) this.reasonCounts[reason] += 1;
    if (this.streamUsed < this.modeStream.length) {
      this.modeStream[this.streamUsed] = mode;
      this.reasonStream[this.streamUsed] = reason;
      this.portMaskStream[this.streamUsed] = portMask;
      this.streamUsed += 1;
    }
    return mode;
  }

  observe(bridge) {
    this.observeCount += 1;
    if (!bridge || !bridge.prepared || !bridge.bundle) {
      this.incompleteCount += 1;
      return this.record(SHADOW_MODE.INCOMPLETE, 0,
        NATIVE_CONTROL_PORT.INFORMATION_INCOMPLETE);
    }
    if (!bridge.supportComplete) this.informationIncompleteCount += 1;
    const engine = bridge.engine;
    const state = bridge.bundle.state;
    const hashLo = state.hashLo; const hashHi = state.hashHi;
    const deltaUsed = state.deltaUsed; const eventUsed = state.eventUsed;
    const count = bridge.actionCount;
    bridge.preparePhysicalEvidence();
    this.hardEvaluationCount += count;
    const selectionCount = bridge.physicalSelectionCount;
    this.escapeEvaluationCount += 1;
    const mode = engine.classifyControlMode(selectionCount);
    const reason = engine.controlMode.context.reason;
    let portMask = NATIVE_CONTROL_PORT.NAVIGATION;
    const escape = engine.escapeObligation;
    if (escape.committedEntityCount > 0 &&
        (escape.supportStatus === SUPPORT_STATUS.COMPLETE ||
         escape.supportStatus === SUPPORT_STATUS.TRAPPED))
      portMask |= NATIVE_CONTROL_PORT.COMMITTED_SAFETY;
    if (engine.turnStreak >= 3) portMask |= NATIVE_CONTROL_PORT.STABILITY;
    if (engine.tacticalContact()) portMask |= NATIVE_CONTROL_PORT.TACTICAL_EVIDENCE;
    if (!bridge.supportComplete) portMask |= NATIVE_CONTROL_PORT.INFORMATION_INCOMPLETE;
    if (portMask & NATIVE_CONTROL_PORT.COMMITTED_SAFETY) this.committedPortCount += 1;
    if (portMask & NATIVE_CONTROL_PORT.STABILITY) this.stabilityPortCount += 1;
    if (portMask & NATIVE_CONTROL_PORT.TACTICAL_EVIDENCE) this.tacticalPortCount += 1;
    this.navigationPortCount += 1;
    const behavioral = portMask & 0x3f;
    if ((behavioral & (behavioral - 1)) !== 0) this.overlapPortCount += 1;
    if (state.hashLo !== hashLo || state.hashHi !== hashHi ||
        state.deltaUsed !== deltaUsed || state.eventUsed !== eventUsed)
      this.rootRestoreFailureCount += 1;
    return this.record(mode, reason, portMask);
  }

  summary() {
    return {
      observeCount: this.observeCount,
      incompleteCount: this.incompleteCount,
      informationIncompleteCount: this.informationIncompleteCount,
      rootRestoreFailureCount: this.rootRestoreFailureCount,
      hardEvaluationCount: this.hardEvaluationCount,
      escapeEvaluationCount: this.escapeEvaluationCount,
      searchNodeCount: this.searchNodeCount,
      hotAllocationCount: this.hotAllocationCount,
      streamUsed: this.streamUsed,
      modeStream: Buffer.from(this.modeStream.subarray(0, this.streamUsed)).toString("base64"),
      reasonStream: Buffer.from(this.reasonStream.subarray(0, this.streamUsed)).toString("base64"),
      portMaskStream: Buffer.from(this.portMaskStream.subarray(0, this.streamUsed)).toString("base64"),
      ports: {
        COMMITTED_SAFETY: this.committedPortCount,
        STABILITY: this.stabilityPortCount,
        TACTICAL_EVIDENCE: this.tacticalPortCount,
        NAVIGATION: this.navigationPortCount,
        OVERLAP: this.overlapPortCount
      },
      modes: {
        INCOMPLETE: this.modeCounts[SHADOW_MODE.INCOMPLETE],
        COMMITTED_ESCAPE: this.modeCounts[SHADOW_MODE.COMMITTED_ESCAPE],
        TACTICAL_CONTACT: this.modeCounts[SHADOW_MODE.TACTICAL_CONTACT],
        STRATEGIC_NAVIGATION: this.modeCounts[SHADOW_MODE.STRATEGIC_NAVIGATION]
      },
      reasons: {
        COMMITTED_TRAPPED: this.reasonCounts[ROOT_CONTROL_REASON.COMMITTED_TRAPPED],
        COMMITTED_RESTRICTION: this.reasonCounts[ROOT_CONTROL_REASON.COMMITTED_RESTRICTION],
        VISIBLE_NEAR: this.reasonCounts[ROOT_CONTROL_REASON.VISIBLE_NEAR],
        VISIBLE_RAY: this.reasonCounts[ROOT_CONTROL_REASON.VISIBLE_RAY],
        NO_CONTACT: this.reasonCounts[ROOT_CONTROL_REASON.NO_CONTACT]
      }
    };
  }
}

module.exports = { SHADOW_MODE, NATIVE_CONTROL_PORT, NativeControlModeShadow };
