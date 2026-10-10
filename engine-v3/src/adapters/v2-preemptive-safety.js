"use strict";

const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { SAFETY_HORIZON } =
  require("../../../engine-v2/src/search/information-safety-closure");
const { V3_COMPONENT_ABI, V3_COMPONENT_MODE, V3_RESULT_STATUS,
  V3_PROPOSAL_CLASS, V3_EVIDENCE, V3_SLOT, actionFromLegacy } = require("../contracts");
const { ComponentResult } = require("../component-result");
const { SOFT_SAFETY_SUPPORT } = require("../v2-bridge-kernel");

const SOFT_SOURCE = Object.freeze({ FUTURE_FIRE: 1, POSSIBLE_PROJECTILE: 2, UNKNOWN: 4 });

// Information risk is an evidence service here.  It may describe a lower-risk
// preemptive pose, but it never turns a possible future shot into Hard or an
// eligible proposal.  An ACTIVE owner, if ever justified, needs a separate
// causal contract after Shadow evidence is frozen.
class V2PreemptiveSafetyShadowAdapter {
  constructor(bridge, mode = V3_COMPONENT_MODE.SHADOW) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.PREEMPTIVE_SAFETY;
    this.id = "V2_PREEMPTIVE_SAFETY_SHADOW";
    this.bridge = bridge;
    this.mode = mode;
    this.result = new ComponentResult(bridge.proposals, this.slot, false);
    this.callCount = 0;
    this.completeCount = 0;
    this.incompleteCount = 0;
    this.notApplicableCount = 0;
    this.v1ProposalCount = 0;
    this.v2EvidenceCount = 0;
    this.agreeCount = 0;
    this.v1OnlyCount = 0;
    this.v2OnlyCount = 0;
    this.disagreeCount = 0;
    this.strictRefinementCount = 0;
    this.v1DominatesCount = 0;
    this.incomparableCount = 0;
    this.futureFireCount = 0;
    this.possibleProjectileCount = 0;
    this.unknownCount = 0;
    this.lastSupport = SOFT_SAFETY_SUPPORT.NOT_APPLICABLE;
    this.lastSelected = -1;
    this.lastSourceMask = 0;
    this.streamUsed = 0;
    this.v1ActionStream = new Uint8Array(128);
    this.recommendedActionStream = new Uint8Array(128);
    this.supportStream = new Uint8Array(128);
    this.sourceStream = new Uint8Array(128);
    this.v1ActionStream.fill(0xff);
    this.recommendedActionStream.fill(0xff);
  }

  indexOf(action) {
    const count = this.bridge.physicalSelectionCount || this.bridge.actionCount;
    for (let row = 0; row < count; row += 1)
      if (this.bridge.actions[row] === action) return row;
    return -1;
  }

  mass(source, row) {
    const base = row * SAFETY_HORIZON; let total = 0;
    for (let depth = 0; depth < SAFETY_HORIZON; depth += 1)
      total = Math.min(10000, total + source[base + depth]);
    return total;
  }

  immediate(source, row) { return source[row * SAFETY_HORIZON]; }

  poseRisk(row) {
    return this.bridge.engine.possibleRisk(this.bridge.projectedCell[row],
      this.bridge.projectedDirection[row]);
  }

  better(left, right) {
    if (right < 0) return true;
    const safety = this.bridge.engine.safetyClosure.outcome;
    const lp = this.immediate(safety.possibleProjectileDeathMass, left);
    const rp = this.immediate(safety.possibleProjectileDeathMass, right);
    if (lp !== rp) return lp < rp;
    const lpt = this.mass(safety.possibleProjectileDeathMass, left);
    const rpt = this.mass(safety.possibleProjectileDeathMass, right);
    if (lpt !== rpt) return lpt < rpt;
    const lf = this.immediate(safety.futureFireDeathMass, left);
    const rf = this.immediate(safety.futureFireDeathMass, right);
    if (lf !== rf) return lf < rf;
    const lft = this.mass(safety.futureFireDeathMass, left);
    const rft = this.mass(safety.futureFireDeathMass, right);
    if (lft !== rft) return lft < rft;
    if (safety.unknownMass[left] !== safety.unknownMass[right])
      return safety.unknownMass[left] < safety.unknownMass[right];
    if (safety.escapeSlack[left] !== safety.escapeSlack[right])
      return safety.escapeSlack[left] > safety.escapeSlack[right];
    const lr = this.poseRisk(left); const rr = this.poseRisk(right);
    if (lr !== rr) return lr < rr;
    return left < right;
  }

  dominates(left, right) {
    if (left < 0 || right < 0) return false;
    let strict = false;
    for (let index = 0; index < 7; index += 1) {
      const lv = this.dimension(left, index); const rv = this.dimension(right, index);
      if (lv > rv) return false;
      if (lv < rv) strict = true;
    }
    return strict;
  }

  dimension(row, index) {
    const safety = this.bridge.engine.safetyClosure.outcome;
    if (index === 0) return this.immediate(safety.possibleProjectileDeathMass, row);
    if (index === 1) return this.mass(safety.possibleProjectileDeathMass, row);
    if (index === 2) return this.immediate(safety.futureFireDeathMass, row);
    if (index === 3) return this.mass(safety.futureFireDeathMass, row);
    if (index === 4) return safety.unknownMass[row];
    if (index === 5) return -safety.escapeSlack[row];
    return this.poseRisk(row);
  }

  evaluate() {
    const support = this.bridge.prepareSoftSafetyEvidence();
    this.lastSupport = support; this.lastSelected = -1; this.lastSourceMask = 0;
    if (support === SOFT_SAFETY_SUPPORT.INCOMPLETE) {
      this.incompleteCount += 1; return -1;
    }
    if (support === SOFT_SAFETY_SUPPORT.NOT_APPLICABLE) {
      this.notApplicableCount += 1; return -1;
    }
    this.completeCount += 1;
    const safety = this.bridge.engine.safetyClosure.outcome;
    const count = this.bridge.physicalSelectionCount;
    let selected = -1; let sourceMask = 0; let first = -1; let differentiated = false;
    for (let row = 0; row < count; row += 1) {
      const action = this.bridge.actions[row];
      if (action !== ACTION.GO && action !== ACTION.TURN_LEFT && action !== ACTION.TURN_RIGHT)
        continue;
      if (this.bridge.engine.hardStatus[row] !== HARD_STATUS.ALLOW) continue;
      const future = this.mass(safety.futureFireDeathMass, row);
      const possible = this.mass(safety.possibleProjectileDeathMass, row);
      if (future > 0) sourceMask |= SOFT_SOURCE.FUTURE_FIRE;
      if (possible > 0) sourceMask |= SOFT_SOURCE.POSSIBLE_PROJECTILE;
      if (safety.unknownMass[row] > 0) sourceMask |= SOFT_SOURCE.UNKNOWN;
      if (first < 0) first = row;
      else if (this.better(row, first) || this.better(first, row)) differentiated = true;
      if (this.better(row, selected)) selected = row;
    }
    // Equal soft tuples do not justify a recommendation. UNKNOWN by itself is
    // recorded but cannot manufacture a preemptive action.
    if (!differentiated || !(sourceMask &
        (SOFT_SOURCE.FUTURE_FIRE | SOFT_SOURCE.POSSIBLE_PROJECTILE))) selected = -1;
    this.lastSelected = selected; this.lastSourceMask = sourceMask;
    if (selected >= 0) this.v2EvidenceCount += 1;
    if (sourceMask & SOFT_SOURCE.FUTURE_FIRE) this.futureFireCount += 1;
    if (sourceMask & SOFT_SOURCE.POSSIBLE_PROJECTILE) this.possibleProjectileCount += 1;
    if (sourceMask & SOFT_SOURCE.UNKNOWN) this.unknownCount += 1;
    return selected;
  }

  record(v1Action, selected, support, sourceMask) {
    const frame = this.bridge.frame;
    if (frame < 0 || frame >= this.v1ActionStream.length) return;
    this.streamUsed = Math.max(this.streamUsed, frame + 1);
    if (v1Action !== ACTION.NONE) this.v1ActionStream[frame] = v1Action;
    if (selected >= 0) this.recommendedActionStream[frame] = this.bridge.actions[selected];
    this.supportStream[frame] = support;
    this.sourceStream[frame] = sourceMask;
  }

  invoke(call) {
    this.callCount += 1;
    const legacy = call.next(); const v1Action = actionFromLegacy(legacy);
    if (v1Action !== ACTION.NONE) this.v1ProposalCount += 1;
    if (this.mode === V3_COMPONENT_MODE.PASS_THROUGH) return legacy;
    const selected = this.evaluate();
    if (selected < 0) {
      if (v1Action !== ACTION.NONE) this.v1OnlyCount += 1;
      this.result.set(this.lastSupport === SOFT_SAFETY_SUPPORT.INCOMPLETE ?
        V3_RESULT_STATUS.INCOMPLETE : V3_RESULT_STATUS.NO_PROPOSAL,
      v1Action, -1, this.lastSupport !== SOFT_SAFETY_SUPPORT.INCOMPLETE,
      V3_EVIDENCE.INFORMATION, this.bridge.engine.safetyClosure.nodes +
        this.bridge.engine.multiFrameRisk.nodes);
      this.record(v1Action, -1, this.lastSupport, this.lastSourceMask);
      return legacy;
    }
    const recommended = this.bridge.actions[selected]; const v1Row = this.indexOf(v1Action);
    if (v1Action === ACTION.NONE) this.v2OnlyCount += 1;
    else if (recommended === v1Action) this.agreeCount += 1;
    else {
      this.disagreeCount += 1;
      if (this.dominates(selected, v1Row)) this.strictRefinementCount += 1;
      else if (this.dominates(v1Row, selected)) this.v1DominatesCount += 1;
      else this.incomparableCount += 1;
    }
    this.result.set(V3_RESULT_STATUS.PROPOSED, recommended,
      this.bridge.arguments[selected], true, V3_EVIDENCE.INFORMATION,
      this.bridge.engine.safetyClosure.nodes + this.bridge.engine.multiFrameRisk.nodes,
      V3_PROPOSAL_CLASS.NONE, false);
    this.record(v1Action, selected, this.lastSupport, this.lastSourceMask);
    return legacy;
  }

  summary() {
    return { callCount: this.callCount, completeCount: this.completeCount,
      incompleteCount: this.incompleteCount, notApplicableCount: this.notApplicableCount,
      v1ProposalCount: this.v1ProposalCount, v2EvidenceCount: this.v2EvidenceCount,
      agreeCount: this.agreeCount, v1OnlyCount: this.v1OnlyCount,
      v2OnlyCount: this.v2OnlyCount, disagreeCount: this.disagreeCount,
      strictRefinementCount: this.strictRefinementCount,
      v1DominatesCount: this.v1DominatesCount, incomparableCount: this.incomparableCount,
      futureFireCount: this.futureFireCount,
      possibleProjectileCount: this.possibleProjectileCount,
      unknownCount: this.unknownCount, streamUsed: this.streamUsed,
      v1ActionStream: Buffer.from(this.v1ActionStream.subarray(0, this.streamUsed)).toString("base64"),
      recommendedActionStream: Buffer.from(this.recommendedActionStream.subarray(
        0, this.streamUsed)).toString("base64"),
      supportStream: Buffer.from(this.supportStream.subarray(0, this.streamUsed)).toString("base64"),
      sourceStream: Buffer.from(this.sourceStream.subarray(0, this.streamUsed)).toString("base64") };
  }
}

module.exports = { SOFT_SOURCE, V2PreemptiveSafetyShadowAdapter };
