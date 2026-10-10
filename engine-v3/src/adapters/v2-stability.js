"use strict";

const { ACTION, HARD_STATUS, NONE_CELL } =
  require("../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { V3_COMPONENT_ABI, V3_COMPONENT_MODE, V3_RESULT_STATUS,
  V3_PROPOSAL_CLASS, V3_EVIDENCE, V3_SLOT, actionFromLegacy,
  actionToLegacy } = require("../contracts");
const { ComponentResult } = require("../component-result");
const { V2CommittedEscapeOwner, V2CommittedRescueFinalAdapter } =
  require("./v2-committed-escape");

class V2StabilityShadowOwner {
  constructor(bridge, options = {}) {
    this.bridge = bridge;
    this.requireZeroRisk = options.requireZeroRisk ? 1 : 0;
    // Stability is evidence-only in this stage.  Do not write an eligible row
    // to ProposalBus or compete with committed rescue.
    this.result = new ComponentResult();
    this.callCount = 0;
    this.streakRootCount = 0;
    this.v1HandledGoCount = 0;
    this.turnPreferredCount = 0;
    this.higherPriorityActionCount = 0;
    this.candidateCount = 0;
    this.hardBlockedCount = 0;
    this.committedBlockedCount = 0;
    this.geometryBlockedCount = 0;
    this.riskBlockedCount = 0;
    this.riskUnder20000Count = 0;
    this.risk20000To34999Count = 0;
    this.risk35000OrMoreCount = 0;
    this.zeroRiskBlockedCount = 0;
    this.streamUsed = 0;
    this.preferredActionStream = new Uint8Array(128);
    this.candidateActionStream = new Uint8Array(128);
    this.turnStreakStream = new Uint8Array(128);
    this.reasonStream = new Uint8Array(128);
    this.riskStream = new Uint16Array(128);
    this.preferredActionStream.fill(0xff);
    this.candidateActionStream.fill(0xff);
  }

  indexOf(action) {
    const count = this.bridge.physicalSelectionCount || this.bridge.actionCount;
    for (let row = 0; row < count; row += 1)
      if (this.bridge.actions[row] === action) return row;
    return -1;
  }

  manhattan(left, right, width) {
    return Math.abs(left % width - right % width) +
      Math.abs(((left / width) | 0) - ((right / width) | 0));
  }

  edgeDistance(cell, width, height) {
    const x = cell % width; const y = (cell / width) | 0;
    return Math.min(x, y, width - 1 - x, height - 1 - y);
  }

  progressAllowed(goRow) {
    const state = this.bridge.bundle.state; const arrays = state.arrays;
    const own = arrays[ARRAY.TANK_CELL][0]; const next = this.bridge.projectedCell[goRow];
    if (next === own) return false;
    if (this.edgeDistance(next, state.width, state.height) >=
        this.edgeDistance(own, state.width, state.height)) return true;
    const star = arrays[ARRAY.SCALAR][SCALAR.STAR_CELL];
    return star !== NONE_CELL && this.manhattan(next, star, state.width) <
      this.manhattan(own, star, state.width);
  }

  record(preferred, candidate, reason, risk) {
    const frame = this.bridge.frame;
    if (frame < 0 || frame >= this.preferredActionStream.length) return;
    this.streamUsed = Math.max(this.streamUsed, frame + 1);
    this.preferredActionStream[frame] = preferred;
    if (candidate >= 0) this.candidateActionStream[frame] = ACTION.GO;
    this.turnStreakStream[frame] = Math.min(255, this.bridge.engine.turnStreak);
    this.reasonStream[frame] = reason;
    this.riskStream[frame] = Math.min(0xffff, Math.max(0, risk));
  }

  observe(preferred) {
    this.callCount += 1;
    const bridge = this.bridge; const engine = bridge.engine;
    if (engine.turnStreak < 3) { this.record(preferred, -1, 0, 0); return -1; }
    this.streakRootCount += 1;
    bridge.preparePhysicalEvidence();
    if (preferred === ACTION.GO) {
      this.v1HandledGoCount += 1; this.record(preferred, -1, 1, 0); return -1;
    }
    if (preferred !== ACTION.TURN_LEFT && preferred !== ACTION.TURN_RIGHT) {
      this.higherPriorityActionCount += 1; this.record(preferred, -1, 2, 0); return -1;
    }
    this.turnPreferredCount += 1;
    const go = this.indexOf(ACTION.GO);
    if (go < 0 || engine.hardStatus[go] !== HARD_STATUS.ALLOW) {
      this.hardBlockedCount += 1; this.record(preferred, -1, 3, 0); return -1;
    }
    if (engine.escapeObligation.committedEntityCount > 0) {
      this.committedBlockedCount += 1; this.record(preferred, -1, 4, 0); return -1;
    }
    if (!this.progressAllowed(go)) {
      this.geometryBlockedCount += 1; this.record(preferred, -1, 5, 0); return -1;
    }
    bridge.ensureHiddenRisk();
    const risk = engine.possibleRisk(bridge.projectedCell[go], bridge.projectedDirection[go]);
    if (risk < 20000) this.riskUnder20000Count += 1;
    else if (risk < 35000) this.risk20000To34999Count += 1;
    else this.risk35000OrMoreCount += 1;
    if (risk >= 35000) {
      this.riskBlockedCount += 1; this.record(preferred, -1, 6, risk); return -1;
    }
    if (this.requireZeroRisk && risk !== 0) {
      this.zeroRiskBlockedCount += 1; this.record(preferred, -1, 8, risk); return -1;
    }
    this.candidateCount += 1;
    this.result.set(V3_RESULT_STATUS.PROPOSED, ACTION.GO, bridge.arguments[go], true,
      V3_EVIDENCE.PHYSICAL_HARD | V3_EVIDENCE.INFORMATION, 1,
      V3_PROPOSAL_CLASS.NONE, false);
    this.record(preferred, go, 7, risk);
    return go;
  }

  summary() {
    return { callCount: this.callCount, streakRootCount: this.streakRootCount,
      v1HandledGoCount: this.v1HandledGoCount,
      turnPreferredCount: this.turnPreferredCount,
      higherPriorityActionCount: this.higherPriorityActionCount,
      candidateCount: this.candidateCount, hardBlockedCount: this.hardBlockedCount,
      committedBlockedCount: this.committedBlockedCount,
      geometryBlockedCount: this.geometryBlockedCount,
      riskBlockedCount: this.riskBlockedCount,
      riskUnder20000Count: this.riskUnder20000Count,
      risk20000To34999Count: this.risk20000To34999Count,
      risk35000OrMoreCount: this.risk35000OrMoreCount,
      zeroRiskBlockedCount: this.zeroRiskBlockedCount,
      requireZeroRisk: this.requireZeroRisk,
      streamUsed: this.streamUsed,
      preferredActionStream: Buffer.from(this.preferredActionStream.subarray(
        0, this.streamUsed)).toString("base64"),
      candidateActionStream: Buffer.from(this.candidateActionStream.subarray(
        0, this.streamUsed)).toString("base64"),
      turnStreakStream: Buffer.from(this.turnStreakStream.subarray(
        0, this.streamUsed)).toString("base64"),
      reasonStream: Buffer.from(this.reasonStream.subarray(
        0, this.streamUsed)).toString("base64"),
      riskStream: Buffer.from(this.riskStream.buffer, this.riskStream.byteOffset,
        this.streamUsed * Uint16Array.BYTES_PER_ELEMENT).toString("base64") };
  }
}

class V2RescueStabilityShadowFinalAdapter {
  constructor(bridge, stability = new V2StabilityShadowOwner(bridge), rescueOwner =
      new V2CommittedEscapeOwner(bridge, V3_COMPONENT_MODE.ACTIVE)) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.FINAL_ACTION_GATE;
    this.id = "V2_RESCUE_PLUS_STABILITY_SHADOW_FINAL";
    this.bridge = bridge;
    this.stability = stability;
    this.rescueOwner = rescueOwner;
    this.rescue = new V2CommittedRescueFinalAdapter(bridge, rescueOwner);
  }

  invoke(call) {
    const legacy = this.rescue.invoke(call);
    this.stability.observe(actionFromLegacy(legacy));
    return legacy;
  }

  summary() {
    return { stability: this.stability.summary(), rescue: this.rescue.summary() };
  }
}

class V2RescueStabilityFinalAdapter extends V2RescueStabilityShadowFinalAdapter {
  constructor(bridge, stability = new V2StabilityShadowOwner(bridge), rescueOwner =
      new V2CommittedEscapeOwner(bridge, V3_COMPONENT_MODE.ACTIVE)) {
    super(bridge, stability, rescueOwner);
    this.id = "V2_RESCUE_PLUS_STABILITY_ACTIVE_FINAL";
    this.overrideCount = 0;
  }

  invoke(call) {
    const legacy = this.rescue.invoke(call);
    const selected = this.stability.observe(actionFromLegacy(legacy));
    if (selected < 0) return legacy;
    const action = this.bridge.actions[selected];
    this.bridge.pendingResolvedAction = action;
    this.bridge.pendingResolvedArgument = this.bridge.arguments[selected];
    this.bridge.pendingResolvedValid = true;
    if (action !== actionFromLegacy(legacy)) this.overrideCount += 1;
    return actionToLegacy(action);
  }

  summary() {
    return { ...super.summary(), overrideCount: this.overrideCount };
  }
}

module.exports = { V2StabilityShadowOwner, V2RescueStabilityShadowFinalAdapter,
  V2RescueStabilityFinalAdapter };
