"use strict";

// BP18 behavior-neutral comparison of two receding policies.  Both policies
// start from one FastState and consume the same enemy first-response columns.
// The baseline keeps the V1-shaped continuation already installed in the
// bounded search.  The challenger keeps pursuing one bound AttackPose target;
// committed hazards temporarily restore the ordinary rescue domain.
//
// A completed result is only HORIZON_POLICY_ENVELOPE evidence.  It cannot
// publish an action, Hard rejection or strict win proof.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ACTION, HARD_STATUS } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { CONTINUATION_POLICY } = require(
  "./native-bounded-policy-search-poc");
const { NativeAttackPoseOptionPoc, NativeAttackPoseFeedbackSearchPoc } = require(
  "./native-tactical-domain-evaluator-poc");

const POLICY_ENVELOPE_RELATION = Object.freeze({
  NONE: 0,
  EQUAL: 1,
  CANDIDATE_DOMINATES: 2,
  BASE_DOMINATES: 3,
  TRADEOFF: 4,
  INCOMPLETE: 5
});

function mix32(hash, value) {
  hash = Math.imul((hash ^ (value >>> 0)) >>> 0, 0x45d9f3b) >>> 0;
  return (hash ^ hash >>> 16) >>> 0;
}

class NativePolicyResponseEnvelopePoc {
  constructor(mode = "off", options = {}) {
    this.mode = mode === "active" ? "active" : mode === "shadow" ?
      "shadow" : "off";
    this.depth = Math.max(2, Math.min(4,
      Number.isSafeInteger(options.depth) ? options.depth : 3));
    this.nodeBudget = Math.max(64, Math.min(4096,
      Number.isSafeInteger(options.nodeBudget) ? options.nodeBudget : 768));
    this.policyId = CONTINUATION_POLICY.ATTACK_TARGET;
    this.requireEventClosure = options.requireEventClosure === true;
    this.reusePreparedBase = options.reusePreparedBase === true;
    this.rootEventOnly = options.rootEventOnly === true;
    this.pose = options.pose || new NativeAttackPoseOptionPoc({ routeProof: true });
    this.feedback = options.feedback || new NativeAttackPoseFeedbackSearchPoc({
      forcePolicy: true, fixedOption: false
    });
    this.comparedColumn = new Uint8Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.checkCount = 0; this.poseMissingCount = 0;
    this.committedBlockedCount = 0; this.baseRowMissingCount = 0;
    this.candidateRowMissingCount = 0; this.sameRootActionCount = 0;
    this.differentRootActionCount = 0; this.bindFailureCount = 0;
    this.rootPolicyNoActionCount = 0; this.rootPolicyAction = ACTION.NONE;
    this.searchIncompleteCount = 0; this.completeCount = 0;
    this.equalCount = 0; this.candidateDominanceCount = 0;
    this.baseDominanceCount = 0; this.tradeoffCount = 0;
    this.candidateWorstImprovementCount = 0;
    this.candidateValueImprovementCount = 0;
    this.terminalLossAvoidedCount = 0; this.terminalLossIntroducedCount = 0;
    this.wouldOverrideCount = 0; this.overrideCount = 0;
    this.eventQualifiedDominanceCount = 0;
    this.eventRejectedDominanceCount = 0;
    this.rootEventCheckCount = 0;
    this.rootEventDeferredCount = 0;
    this.preparedDepthCount = new Uint32Array(5);
    this.lastBaseRow = -1; this.lastCandidateRow = -1;
    this.lastBaseAction = ACTION.NONE; this.lastCandidateAction = ACTION.NONE;
    this.lastTargetSignature = 0;
    this.lastRelation = POLICY_ENVELOPE_RELATION.NONE;
    this.lastComparedColumns = 0; this.lastBaseWorst = -32000;
    this.lastCandidateWorst = -32000; this.lastBaseValue = -32000;
    this.lastCandidateValue = -32000; this.hotAllocationCount = 0;
  }

  targetSignature(pose) {
    const option = pose.selected;
    let hash = mix32(0x9e3779b9, pose.cell[option] + 1);
    hash = mix32(hash, pose.direction[option] + 1);
    hash = mix32(hash, (pose.fireDeadline?.[option] ?? 255) + 1);
    hash = mix32(hash, (pose.responseMask?.[option] ?? 0) + 1);
    return hash || 1;
  }

  bestRowForAction(engine, action) {
    let best = -1; let value = -2147483648;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (engine.ourActions[row] !== action ||
          engine.hardStatus[row] !== HARD_STATUS.ALLOW) continue;
      const candidate = engine.riskController?.outcome?.robustLower?.[row] ?? 0;
      if (best < 0 || candidate > value || candidate === value && row < best) {
        best = row; value = candidate;
      }
    }
    return best;
  }

  bestAttackRow(engine, owner, pose, policyAction) {
    let best = -1;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (engine.ourActions[row] !== policyAction ||
          engine.hardStatus[row] !== HARD_STATUS.ALLOW ||
          (engine.riskController?.outcome?.acceptable &&
            !engine.riskController.outcome.acceptable[row]) ||
          !pose.supports(row)) continue;
      if (best < 0 || pose.betterRow(engine, row, best)) best = row;
    }
    return best;
  }

  relation(search, engine) {
    let better = 0; let worse = 0; this.lastComparedColumns = 0;
    this.comparedColumn.fill(0, 0, engine.enemyCount);
    for (let column = 0; column < engine.enemyCount; column += 1) {
      if (!search.rootEnemyDomainMask[column]) continue;
      const baseUpper = search.policyEnvelopeBaseCellUpper[column];
      const candidateLower = search.policyEnvelopeCandidateCellLower[column];
      if (baseUpper === 32000 || candidateLower === -32000)
        return POLICY_ENVELOPE_RELATION.INCOMPLETE;
      this.comparedColumn[column] = 1; this.lastComparedColumns += 1;
      if (candidateLower > baseUpper) better = 1;
      else if (candidateLower < baseUpper) worse = 1;
    }
    if (!this.lastComparedColumns) return POLICY_ENVELOPE_RELATION.INCOMPLETE;
    if (better && worse) return POLICY_ENVELOPE_RELATION.TRADEOFF;
    if (better) return POLICY_ENVELOPE_RELATION.CANDIDATE_DOMINATES;
    if (worse) return POLICY_ENVELOPE_RELATION.BASE_DOMINATES;
    return POLICY_ENVELOPE_RELATION.EQUAL;
  }

  eventClosed(search, engine) {
    for (let column = 0; column < engine.enemyCount; column += 1)
      if (search.rootEnemyDomainMask[column] &&
          !search.policyEnvelopeCandidateEventComplete[column]) return false;
    return true;
  }

  observe(engine, search, owner, incumbentAction) {
    if (this.mode === "off") return null;
    this.checkCount += 1; this.lastRelation = POLICY_ENVELOPE_RELATION.NONE;
    this.lastComparedColumns = 0;
    const pose = this.pose;
    if (!pose || !pose.prepare(engine, engine.ourCount) || pose.selected < 0) {
      this.poseMissingCount += 1; return null;
    }
    if ((engine.escapeObligation?.committedEntityCount | 0) > 0) {
      this.committedBlockedCount += 1; return null;
    }
    const baseRow = this.bestRowForAction(engine, incumbentAction);
    // The V3 baseline action need not belong to V2's root candidate slab.
    // Keep the row only as audit metadata and evaluate the primitive directly.
    if (baseRow < 0) this.baseRowMissingCount += 1;
    this.rootPolicyAction = this.feedback.routeAction(engine.adapter.state);
    if (this.rootPolicyAction === ACTION.NONE) {
      this.rootPolicyNoActionCount += 1; return null;
    }
    const candidateRow = this.bestAttackRow(engine, owner, pose,
      this.rootPolicyAction);
    if (candidateRow < 0) { this.candidateRowMissingCount += 1; return null; }
    this.lastBaseRow = baseRow; this.lastCandidateRow = candidateRow;
    this.lastBaseAction = incumbentAction;
    this.lastCandidateAction = engine.ourActions[candidateRow];
    if (this.lastCandidateAction === ACTION.FIRE)
      this.rootEventCheckCount += 1;
    else if (this.rootEventOnly) {
      this.rootEventDeferredCount += 1; return null;
    }
    if (this.lastBaseAction === this.lastCandidateAction)
      this.sameRootActionCount += 1;
    else this.differentRootActionCount += 1;
    if (this.feedback.fixedOption && !this.feedback.bind(pose)) {
      this.bindFailureCount += 1; return null;
    }
    const signature = this.targetSignature(pose);
    this.lastTargetSignature = signature;
    const evaluationDepth = this.reusePreparedBase ?
      Math.max(2, Math.min(4, search.currentDepth | 0)) : this.depth;
    this.preparedDepthCount[evaluationDepth] += 1;
    if (!search.evaluatePolicyResponseEnvelope(engine, incumbentAction, 0xffff,
      engine.ourActions[candidateRow], engine.ourArguments[candidateRow],
      this.feedback, this.policyId, signature, evaluationDepth, this.nodeBudget,
      this.reusePreparedBase ? baseRow : -1, this.reusePreparedBase)) {
      this.searchIncompleteCount += 1;
      this.lastRelation = POLICY_ENVELOPE_RELATION.INCOMPLETE;
      return null;
    }
    this.completeCount += 1;
    this.lastBaseWorst = search.policyEnvelopeBaseWorst;
    this.lastCandidateWorst = search.policyEnvelopeCandidateWorst;
    this.lastBaseValue = search.policyEnvelopeBaseValue;
    this.lastCandidateValue = search.policyEnvelopeCandidateValue;
    this.lastRelation = this.relation(search, engine);
    if (this.lastRelation === POLICY_ENVELOPE_RELATION.EQUAL)
      this.equalCount += 1;
    else if (this.lastRelation === POLICY_ENVELOPE_RELATION.CANDIDATE_DOMINATES)
      this.candidateDominanceCount += 1;
    else if (this.lastRelation === POLICY_ENVELOPE_RELATION.BASE_DOMINATES)
      this.baseDominanceCount += 1;
    else if (this.lastRelation === POLICY_ENVELOPE_RELATION.TRADEOFF)
      this.tradeoffCount += 1;
    if (this.lastCandidateWorst > this.lastBaseWorst)
      this.candidateWorstImprovementCount += 1;
    if (this.lastCandidateValue > this.lastBaseValue)
      this.candidateValueImprovementCount += 1;
    if (this.lastBaseWorst <= -30000 && this.lastCandidateWorst > -30000)
      this.terminalLossAvoidedCount += 1;
    if (this.lastBaseWorst > -30000 && this.lastCandidateWorst <= -30000)
      this.terminalLossIntroducedCount += 1;
    const eventClosed = this.eventClosed(search, engine);
    if (this.lastRelation === POLICY_ENVELOPE_RELATION.CANDIDATE_DOMINATES) {
      if (eventClosed) this.eventQualifiedDominanceCount += 1;
      else this.eventRejectedDominanceCount += 1;
    }
    if (this.lastRelation === POLICY_ENVELOPE_RELATION.CANDIDATE_DOMINATES &&
        (!this.requireEventClosure || eventClosed) &&
        this.lastCandidateWorst > -30000 &&
        this.lastCandidateAction !== incumbentAction) {
      this.wouldOverrideCount += 1;
      if (this.mode === "active") {
        this.overrideCount += 1;
        return { action: this.lastCandidateAction,
          argument: engine.ourArguments[candidateRow] };
      }
    }
    return null;
  }

  summary() {
    return { enabled: this.mode !== "off", mode: this.mode,
      semantics: "HORIZON_POLICY_ENVELOPE", depth: this.depth,
      nodeBudget: this.nodeBudget, policyId: this.policyId,
      requireEventClosure: this.requireEventClosure,
      reusePreparedBase: this.reusePreparedBase,
      rootEventOnly: this.rootEventOnly,
      checkCount: this.checkCount, poseMissingCount: this.poseMissingCount,
      committedBlockedCount: this.committedBlockedCount,
      baseRowMissingCount: this.baseRowMissingCount,
      candidateRowMissingCount: this.candidateRowMissingCount,
      rootPolicyNoActionCount: this.rootPolicyNoActionCount,
      sameRootActionCount: this.sameRootActionCount,
      differentRootActionCount: this.differentRootActionCount,
      bindFailureCount: this.bindFailureCount,
      searchIncompleteCount: this.searchIncompleteCount,
      completeCount: this.completeCount, equalCount: this.equalCount,
      candidateDominanceCount: this.candidateDominanceCount,
      baseDominanceCount: this.baseDominanceCount,
      tradeoffCount: this.tradeoffCount,
      candidateWorstImprovementCount: this.candidateWorstImprovementCount,
      candidateValueImprovementCount: this.candidateValueImprovementCount,
      terminalLossAvoidedCount: this.terminalLossAvoidedCount,
      terminalLossIntroducedCount: this.terminalLossIntroducedCount,
      wouldOverrideCount: this.wouldOverrideCount,
      overrideCount: this.overrideCount,
      eventQualifiedDominanceCount: this.eventQualifiedDominanceCount,
      eventRejectedDominanceCount: this.eventRejectedDominanceCount,
      rootEventCheckCount: this.rootEventCheckCount,
      rootEventDeferredCount: this.rootEventDeferredCount,
      preparedDepthCount: Array.from(this.preparedDepthCount),
      lastBaseRow: this.lastBaseRow,
      lastCandidateRow: this.lastCandidateRow,
      lastBaseAction: this.lastBaseAction,
      lastCandidateAction: this.lastCandidateAction,
      lastTargetSignature: this.lastTargetSignature,
      lastRelation: this.lastRelation,
      lastComparedColumns: this.lastComparedColumns,
      lastBaseWorst: this.lastBaseWorst,
      lastCandidateWorst: this.lastCandidateWorst,
      lastBaseValue: this.lastBaseValue,
      lastCandidateValue: this.lastCandidateValue,
      hotAllocationCount: this.hotAllocationCount,
      pose: this.pose.summary ? this.pose.summary() : null,
      feedback: this.feedback.summary() };
  }
}

module.exports = { NativePolicyResponseEnvelopePoc,
  POLICY_ENVELOPE_RELATION };
