"use strict";

const { HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { SUPPORT_STATUS, SUCCESSOR_PROOF } =
  require("../../../engine-v2/src/runtime/escape-obligation");
const { V3_COMPONENT_ABI, V3_COMPONENT_MODE, V3_RESULT_STATUS,
  V3_PROPOSAL_CLASS, V3_EVIDENCE, V3_SLOT, actionFromLegacy,
  actionToLegacy } = require("../contracts");
const { ComponentResult } = require("../component-result");

class V2CommittedEscapeOwner {
  constructor(bridge, mode = V3_COMPONENT_MODE.SHADOW) {
    this.bridge = bridge;
    this.mode = mode;
    this.results = new Array(3);
    this.results[0] = new ComponentResult(bridge.proposals, V3_SLOT.VISIBLE_BOMB_SAFETY,
      mode === V3_COMPONENT_MODE.ACTIVE);
    this.results[1] = new ComponentResult(bridge.proposals, V3_SLOT.VISIBLE_PROJECTILE_SAFETY,
      mode === V3_COMPONENT_MODE.ACTIVE);
    this.results[2] = new ComponentResult(bridge.proposals, V3_SLOT.PROJECTILE_ESCAPE,
      mode === V3_COMPONENT_MODE.ACTIVE);
    this.result = this.results[0];
    this.evaluatedFrame = -1;
    this.supportStatus = SUPPORT_STATUS.NONE;
    this.callCount = 0;
    this.completeCount = 0;
    this.incompleteCount = 0;
    this.trappedCount = 0;
    this.overrideCount = 0;
    this.legacyMemberCount = 0;
    this.nonPrimitiveMemberCount = 0;
    this.finalProposalCount = 0;
    this.preferredProvenDeadCount = 0;
    this.finalPreferredViableCount = 0;
    this.finalSelectedViableCount = 0;
    this.finalStreamUsed = 0;
    this.finalPreferredActionStream = new Uint8Array(128);
    this.finalProposalActionStream = new Uint8Array(128);
    this.finalSupportStream = new Uint8Array(128);
    this.finalEntityCountStream = new Uint8Array(128);
    this.finalRootSlackStream = new Int8Array(128);
    this.finalProposalActionStream.fill(0xff);
  }

  evaluate() {
    const bridge = this.bridge;
    if (this.evaluatedFrame === bridge.frame) return this.supportStatus;
    this.evaluatedFrame = bridge.frame;
    if (!bridge.prepared || !bridge.bundle) {
      this.supportStatus = SUPPORT_STATUS.INCOMPLETE;
      return this.supportStatus;
    }
    this.supportStatus = bridge.preparePhysicalEvidence();
    if (this.supportStatus === SUPPORT_STATUS.COMPLETE) this.completeCount += 1;
    else if (this.supportStatus === SUPPORT_STATUS.INCOMPLETE) this.incompleteCount += 1;
    else if (this.supportStatus === SUPPORT_STATUS.TRAPPED) this.trappedCount += 1;
    return this.supportStatus;
  }

  indexOf(action) {
    // The bridge deliberately excludes the synthetic NONE row from physical
    // selection while the tank can act.  EscapeObligation only refreshes the
    // rows it evaluates, so scanning actionCount here could resurrect a
    // member bit left on NONE by an earlier frame with a different action set.
    const count = this.bridge.physicalSelectionCount || this.bridge.actionCount;
    for (let row = 0; row < count; row += 1)
      if (this.bridge.actions[row] === action) return row;
    return -1;
  }

  better(left, right) {
    const escape = this.bridge.engine.escapeObligation;
    if (right < 0) return true;
    if (escape.successorExposed[left] !== escape.successorExposed[right])
      return escape.successorExposed[left] < escape.successorExposed[right];
    if (escape.successorSlack[left] !== escape.successorSlack[right])
      return escape.successorSlack[left] > escape.successorSlack[right];
    if (escape.successorBranches[left] !== escape.successorBranches[right])
      return escape.successorBranches[left] > escape.successorBranches[right];
    if (escape.successorCoverage[left] !== escape.successorCoverage[right])
      return escape.successorCoverage[left] > escape.successorCoverage[right];
    return left < right;
  }

  select(preferredAction) {
    const preferred = this.indexOf(preferredAction);
    const escape = this.bridge.engine.escapeObligation;
    if (preferred >= 0 && escape.member[preferred]) {
      this.legacyMemberCount += 1;
      return preferred;
    }
    let selected = -1;
    const count = this.bridge.physicalSelectionCount || this.bridge.actionCount;
    for (let row = 0; row < count; row += 1)
      if (escape.member[row] && this.better(row, selected)) selected = row;
    return selected;
  }

  proposeFinal(preferredAction) {
    this.callCount += 1;
    const result = this.results[0];
    if (this.mode === V3_COMPONENT_MODE.PASS_THROUGH) return -1;
    const support = this.evaluate();
    if (support !== SUPPORT_STATUS.COMPLETE) {
      result.set(support === SUPPORT_STATUS.INCOMPLETE ? V3_RESULT_STATUS.INCOMPLETE :
        V3_RESULT_STATUS.NO_PROPOSAL, preferredAction, -1,
        support !== SUPPORT_STATUS.INCOMPLETE,
        support === SUPPORT_STATUS.INCOMPLETE ? V3_EVIDENCE.INFORMATION | V3_EVIDENCE.FALLBACK :
          V3_EVIDENCE.NONE, this.bridge.engine.escapeObligation.evaluatedCount);
      this.recordFinal(preferredAction, -1, support);
      return -1;
    }
    const preferred = this.indexOf(preferredAction);
    const escape = this.bridge.engine.escapeObligation;
    // Final rescue is intentionally narrow: V1's final action must be proved
    // dead by the same complete committed closure that proves the replacement
    // viable. UNKNOWN never authorizes an override.
    if (preferred < 0 || escape.successorProof[preferred] !== SUCCESSOR_PROOF.PROVEN_DEAD) {
      if (preferred >= 0 && escape.member[preferred]) {
        this.legacyMemberCount += 1; this.finalPreferredViableCount += 1;
      }
      result.set(V3_RESULT_STATUS.NO_PROPOSAL, preferredAction, -1, true,
        V3_EVIDENCE.COMMITTED, escape.evaluatedCount);
      this.recordFinal(preferredAction, -1, support);
      return -1;
    }
    this.preferredProvenDeadCount += 1;
    const selected = this.select(preferredAction);
    if (selected < 0 ||
        escape.successorProof[selected] !== SUCCESSOR_PROOF.PROVEN_VIABLE) {
      result.set(V3_RESULT_STATUS.INCOMPLETE, preferredAction, -1, false,
        V3_EVIDENCE.COMMITTED | V3_EVIDENCE.FALLBACK, escape.evaluatedCount);
      this.recordFinal(preferredAction, -1, support);
      return -1;
    }
    const action = this.bridge.actions[selected];
    result.set(V3_RESULT_STATUS.PROPOSED, action, this.bridge.arguments[selected], true,
      V3_EVIDENCE.COMMITTED | V3_EVIDENCE.PHYSICAL_HARD, escape.evaluatedCount,
      V3_PROPOSAL_CLASS.COMMITTED_RESCUE, this.mode === V3_COMPONENT_MODE.ACTIVE);
    this.finalProposalCount += 1; this.finalSelectedViableCount += 1;
    this.recordFinal(preferredAction, selected, support);
    return selected;
  }

  recordFinal(preferredAction, selected, support) {
    if (this.finalStreamUsed >= this.finalProposalActionStream.length) return;
    const at = this.finalStreamUsed++;
    this.finalPreferredActionStream[at] = preferredAction;
    this.finalProposalActionStream[at] = selected < 0 ? 0xff : this.bridge.actions[selected];
    this.finalSupportStream[at] = support;
    const escape = this.bridge.engine.escapeObligation;
    this.finalEntityCountStream[at] = Math.min(255, escape.committedEntityCount);
    this.finalRootSlackStream[at] = Math.max(-128, Math.min(127, escape.rootSlack));
  }

  invoke(slot, call) {
    this.callCount += 1;
    const legacy = call.next(); const preferredAction = actionFromLegacy(legacy);
    const result = this.results[slot - V3_SLOT.VISIBLE_BOMB_SAFETY];
    if (this.mode === V3_COMPONENT_MODE.PASS_THROUGH) return legacy;
    const support = this.evaluate();
    if (support !== SUPPORT_STATUS.COMPLETE) {
      result.set(support === SUPPORT_STATUS.INCOMPLETE ? V3_RESULT_STATUS.INCOMPLETE :
        V3_RESULT_STATUS.NO_PROPOSAL, preferredAction, -1, support !== SUPPORT_STATUS.INCOMPLETE,
        support === SUPPORT_STATUS.INCOMPLETE ? V3_EVIDENCE.INFORMATION | V3_EVIDENCE.FALLBACK :
          V3_EVIDENCE.NONE, 1);
      return legacy;
    }
    const selected = this.select(preferredAction);
    if (selected < 0) {
      result.set(V3_RESULT_STATUS.INCOMPLETE, preferredAction, -1, false,
        V3_EVIDENCE.COMMITTED | V3_EVIDENCE.FALLBACK, 1);
      return legacy;
    }
    const action = this.bridge.actions[selected];
    if (action >= 4) this.nonPrimitiveMemberCount += 1;
    result.set(V3_RESULT_STATUS.PROPOSED, action, this.bridge.arguments[selected], true,
      V3_EVIDENCE.COMMITTED, this.bridge.engine.escapeObligation.evaluatedCount,
      V3_PROPOSAL_CLASS.COMMITTED_RESCUE,
      this.mode === V3_COMPONENT_MODE.ACTIVE && action !== preferredAction);
    return legacy;
  }

  summary() {
    return { callCount: this.callCount, completeCount: this.completeCount,
      incompleteCount: this.incompleteCount, trappedCount: this.trappedCount,
      overrideCount: this.overrideCount, legacyMemberCount: this.legacyMemberCount,
      nonPrimitiveMemberCount: this.nonPrimitiveMemberCount,
      finalProposalCount: this.finalProposalCount,
      preferredProvenDeadCount: this.preferredProvenDeadCount,
      finalPreferredViableCount: this.finalPreferredViableCount,
      finalSelectedViableCount: this.finalSelectedViableCount,
      finalStreamUsed: this.finalStreamUsed,
      finalPreferredActionStream: Buffer.from(this.finalPreferredActionStream.subarray(
        0, this.finalStreamUsed)).toString("base64"),
      finalProposalActionStream: Buffer.from(this.finalProposalActionStream.subarray(
        0, this.finalStreamUsed)).toString("base64"),
      finalSupportStream: Buffer.from(this.finalSupportStream.subarray(
        0, this.finalStreamUsed)).toString("base64"),
      finalEntityCountStream: Buffer.from(this.finalEntityCountStream.subarray(
        0, this.finalStreamUsed)).toString("base64"),
      finalRootSlackStream: Buffer.from(this.finalRootSlackStream.buffer,
        this.finalRootSlackStream.byteOffset, this.finalStreamUsed).toString("base64") };
  }
}

class V2CommittedRescueShadowAdapter {
  constructor(bridge, owner = new V2CommittedEscapeOwner(bridge,
      V3_COMPONENT_MODE.SHADOW)) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.FINAL_ACTION_GATE;
    this.id = "V2_COMMITTED_RESCUE_FINAL_SHADOW";
    this.bridge = bridge;
    this.owner = owner;
  }

  invoke(call) {
    const legacy = call.next();
    this.bridge.recordResolvedLegacy(legacy);
    this.owner.proposeFinal(actionFromLegacy(legacy));
    return legacy;
  }

  summary() { return this.owner.summary(); }
}

class V2CommittedRescueFinalAdapter {
  constructor(bridge, owner = new V2CommittedEscapeOwner(bridge,
      V3_COMPONENT_MODE.ACTIVE)) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.FINAL_ACTION_GATE;
    this.id = "V2_COMMITTED_RESCUE_FINAL_ACTIVE";
    this.bridge = bridge;
    this.owner = owner;
    this.overrideCount = 0;
  }

  invoke(call) {
    const legacy = call.next();
    const preferred = actionFromLegacy(legacy);
    const selected = this.owner.proposeFinal(preferred);
    if (selected < 0) {
      this.bridge.recordResolvedLegacy(legacy);
      return legacy;
    }
    const action = this.bridge.actions[selected];
    const argument = this.bridge.arguments[selected];
    this.bridge.pendingResolvedAction = action;
    this.bridge.pendingResolvedArgument = argument;
    this.bridge.pendingResolvedValid = true;
    if (action !== preferred) this.overrideCount += 1;
    return actionToLegacy(action);
  }

  summary() { return { ...this.owner.summary(), overrideCount: this.overrideCount }; }
}

class V2CommittedEscapePort {
  constructor(slot, owner) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = slot;
    this.id = `V2_COMMITTED_ESCAPE_${slot}`;
    this.owner = owner;
  }
  invoke(call) { return this.owner.invoke(this.slot, call); }
  summary() { return this.owner.summary(); }
}

function committedEscapePorts(bridge, mode) {
  const owner = new V2CommittedEscapeOwner(bridge, mode);
  return [new V2CommittedEscapePort(V3_SLOT.VISIBLE_BOMB_SAFETY, owner),
    new V2CommittedEscapePort(V3_SLOT.VISIBLE_PROJECTILE_SAFETY, owner),
    new V2CommittedEscapePort(V3_SLOT.PROJECTILE_ESCAPE, owner)];
}

module.exports = { V2CommittedEscapeOwner, V2CommittedEscapePort,
  V2CommittedRescueShadowAdapter, V2CommittedRescueFinalAdapter,
  committedEscapePorts };
