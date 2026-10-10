"use strict";

// Behavior-neutral policy comparison for semantic ATTACK execution gaps.
// The incumbent and receding AttackPose continuations keep separate search
// identities. A completed strict dominance is recorded, never emitted.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { RUNTIME_MODE } = require(
  "../../../engine-v2/src/abi/cache-runtime-codes");
const { LONG_OPTION } = require("./event-driven-option-shadow");
const { OBJECTIVE_EPOCH_STATUS } = require(
  "./objective-epoch-continuity-shadow");
const { NativeAttackPoseOptionPoc } = require(
  "./native-tactical-domain-evaluator-poc");
const { NativeAttackPosePolicySearchPoc } = require(
  "./native-attack-pose-policy-search-poc");
const { OBJECTIVE_DIMENSION, OBJECTIVE_RELATION, vectorObject,
  SemanticAttackObjectiveProgressInterval } = require(
  "./semantic-attack-objective-progress-interval");
const { DEPTH_LANE, DEPTH_LANE_NAME,
  SemanticAttackDepthStabilityShadow } = require(
  "./semantic-attack-depth-stability-shadow");
const { WIDTH_LANE, WIDTH_LANE_NAME,
  TRANSITION_DETAIL_FIELD, SemanticAttackDepth3WidthShadow } = require(
  "./semantic-attack-depth3-width-shadow");
const { SemanticAttackDepth3MoveVariantShadow } = require(
  "./semantic-attack-depth3-move-variant-shadow");
const { SemanticAttackDepth3LeafBackupShadow } = require(
  "./semantic-attack-depth3-leaf-backup-shadow");
const { SemanticAttackDepth3ResponseMatrixShadow } = require(
  "./semantic-attack-depth3-response-matrix-shadow");
const { SemanticAttackResponseConditionedShadow } = require(
  "./semantic-attack-response-conditioned-shadow");
const { SemanticAttackEventDeadlineShadow } = require(
  "./semantic-attack-event-deadline-shadow");
const { SemanticAttackEventHorizonShadow } = require(
  "./semantic-attack-event-horizon-shadow");
const { DIAGNOSTIC_FAST_STATUS_CAPACITY, DIAGNOSTIC_HARD_STATUS_CAPACITY,
  DIAGNOSTIC_FAST_REASON_CAPACITY, DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY,
  DIAGNOSTIC_DEPTH_CAPACITY } = require(
  "./native-attack-pose-policy-search-poc");

const ACTION_BUCKETS = 16;
const SAMPLE_CAPACITY = 16;
const CERTIFICATE_CAPACITY = 64;
const COMPARISON_CAPACITY = 32;
const POLICY_RELATION = Object.freeze({ CANDIDATE_HIGHER: 1, EQUAL: 2,
  CANDIDATE_LOWER: 3 });

function namedActions(values) {
  const output = {};
  for (const [name, action] of Object.entries(ACTION))
    if (action >= 0 && action < ACTION_BUCKETS) output[name] = values[action];
  return output;
}

function fixedValues(source, offset, count) {
  const output = new Array(count);
  for (let at = 0; at < count; at += 1) output[at] = source[offset + at];
  return output;
}

function transitionDetailObject(source, offset) {
  const output = {};
  for (const [name, index] of Object.entries(TRANSITION_DETAIL_FIELD))
    if (name !== "COUNT") output[name] = source[offset + index];
  return output;
}

class SemanticAttackPolicyIntervalShadow {
  constructor(epoch, coverage, runtimeConfig = {}, options = {}) {
    this.epoch = epoch; this.coverage = coverage;
    this.pose = options.pose || new NativeAttackPoseOptionPoc({ routeProof: true });
    this.policy = options.policy || new NativeAttackPosePolicySearchPoc(
      runtimeConfig, { nodeBudget: options.nodeBudget || 256,
        pairedDepth: options.depth || 2, fixedOption: false,
        commonContinuation: options.commonContinuation === true });
    this.objective = options.objective ||
      new SemanticAttackObjectiveProgressInterval();
    this.depthStability = options.depthStability ?
      new SemanticAttackDepthStabilityShadow(runtimeConfig,
        options.depthStabilityOptions) : null;
    this.depthWidthStability = options.depthWidthStability ?
      new SemanticAttackDepth3WidthShadow(runtimeConfig,
        options.depthWidthStabilityOptions) : null;
    this.depthMoveVariant = options.depthMoveVariant && this.depthWidthStability ?
      new SemanticAttackDepth3MoveVariantShadow(runtimeConfig,
        options.depthMoveVariantOptions) : null;
    this.depthLeafBackup = options.depthLeafBackup && this.depthWidthStability ?
      new SemanticAttackDepth3LeafBackupShadow(runtimeConfig,
        options.depthLeafBackupOptions) : null;
    this.depthResponseMatrix = options.depthResponseMatrix &&
      this.depthLeafBackup ? new SemanticAttackDepth3ResponseMatrixShadow(
        options.depthResponseMatrixOptions) : null;
    this.responseConditioned = options.responseConditioned &&
      this.depthResponseMatrix ? new SemanticAttackResponseConditionedShadow() : null;
    this.eventDeadline = options.eventDeadline && this.responseConditioned &&
      this.depthWidthStability ? new SemanticAttackEventDeadlineShadow(
        runtimeConfig, options.eventDeadlineOptions) : null;
    this.eventHorizon = options.eventHorizon && this.eventDeadline ?
      new SemanticAttackEventHorizonShadow(options.eventHorizonOptions) : null;
    this.allowedRows = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.candidateByAction = new Uint32Array(ACTION_BUCKETS);
    this.dominanceByAction = new Uint32Array(ACTION_BUCKETS);
    this.decisionCount = 0; this.inactiveCount = 0; this.suspendedCount = 0;
    this.strictExecutionAvailableCount = 0; this.runtimeSkipCount = 0;
    this.supportSkipCount = 0; this.committedSkipCount = 0;
    this.invalidCurrentCount = 0; this.noPoseCount = 0;
    this.policyAttemptCount = 0; this.noPolicyDomainCount = 0;
    this.completeCount = 0;
    this.incompleteCount = 0; this.refutedCount = 0; this.equalCount = 0;
    this.strictDominanceCount = 0; this.samePrimitiveDominanceCount = 0;
    this.hotAllocationCount = 0; this.lastProposal = -1;
    this.sampleCount = 0;
    this.sampleFrame = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleCurrentAction = new Uint8Array(SAMPLE_CAPACITY);
    this.sampleCandidateAction = new Uint8Array(SAMPLE_CAPACITY);
    this.sampleBaselineValue = new Int32Array(SAMPLE_CAPACITY);
    this.sampleCandidateValue = new Int32Array(SAMPLE_CAPACITY);
    this.sampleDominance = new Uint8Array(SAMPLE_CAPACITY);
    this.certificateCount = 0; this.certificateOverflowCount = 0;
    this.certificateFrame = new Uint16Array(CERTIFICATE_CAPACITY);
    this.certificateHashLo = new Uint32Array(CERTIFICATE_CAPACITY);
    this.certificateHashHi = new Uint32Array(CERTIFICATE_CAPACITY);
    this.certificateCurrentRow = new Uint8Array(CERTIFICATE_CAPACITY);
    this.certificateCandidateRow = new Uint8Array(CERTIFICATE_CAPACITY);
    this.certificateCurrentAction = new Uint8Array(CERTIFICATE_CAPACITY);
    this.certificateCandidateAction = new Uint8Array(CERTIFICATE_CAPACITY);
    this.certificateCurrentArgument = new Uint16Array(CERTIFICATE_CAPACITY);
    this.certificateCandidateArgument = new Uint16Array(CERTIFICATE_CAPACITY);
    this.certificateBaselineValue = new Int32Array(CERTIFICATE_CAPACITY);
    this.certificateCandidateValue = new Int32Array(CERTIFICATE_CAPACITY);
    this.certificateEpochGeneration = new Uint16Array(CERTIFICATE_CAPACITY);
    this.certificateTargetSignature = new Uint32Array(CERTIFICATE_CAPACITY);
    this.certificateTargetGeneration = new Uint16Array(CERTIFICATE_CAPACITY);
    this.certificateControlMode = new Uint8Array(CERTIFICATE_CAPACITY);
    this.certificateObjectiveRelation = new Uint8Array(CERTIFICATE_CAPACITY);
    this.certificateObjective = new Uint16Array(CERTIFICATE_CAPACITY * 2 *
      OBJECTIVE_DIMENSION.COUNT);
    this.comparisonCount = 0; this.comparisonOverflowCount = 0;
    this.comparisonMissingCandidateCount = 0;
    this.comparisonFrame = new Uint16Array(COMPARISON_CAPACITY);
    this.comparisonHashLo = new Uint32Array(COMPARISON_CAPACITY);
    this.comparisonHashHi = new Uint32Array(COMPARISON_CAPACITY);
    this.comparisonCurrentRow = new Uint8Array(COMPARISON_CAPACITY);
    this.comparisonCandidateRow = new Uint8Array(COMPARISON_CAPACITY);
    this.comparisonCurrentAction = new Uint8Array(COMPARISON_CAPACITY);
    this.comparisonCandidateAction = new Uint8Array(COMPARISON_CAPACITY);
    this.comparisonCurrentArgument = new Uint16Array(COMPARISON_CAPACITY);
    this.comparisonCandidateArgument = new Uint16Array(COMPARISON_CAPACITY);
    this.comparisonBaselineValue = new Int32Array(COMPARISON_CAPACITY);
    this.comparisonCandidateValue = new Int32Array(COMPARISON_CAPACITY);
    this.comparisonPolicyRelation = new Uint8Array(COMPARISON_CAPACITY);
    this.comparisonObjectiveRelation = new Uint8Array(COMPARISON_CAPACITY);
    this.comparisonObjective = new Uint16Array(COMPARISON_CAPACITY * 2 *
      OBJECTIVE_DIMENSION.COUNT);
    this.comparisonDepthComplete = new Uint8Array(COMPARISON_CAPACITY *
      DEPTH_LANE.COUNT);
    this.comparisonDepthRelation = new Uint8Array(COMPARISON_CAPACITY *
      DEPTH_LANE.COUNT);
    this.comparisonDepthBaselineValue = new Int32Array(COMPARISON_CAPACITY *
      DEPTH_LANE.COUNT);
    this.comparisonDepthCandidateValue = new Int32Array(COMPARISON_CAPACITY *
      DEPTH_LANE.COUNT);
    this.comparisonDepthBaselineNodes = new Uint16Array(COMPARISON_CAPACITY *
      DEPTH_LANE.COUNT);
    this.comparisonDepthCandidateNodes = new Uint16Array(COMPARISON_CAPACITY *
      DEPTH_LANE.COUNT);
    this.comparisonDepthBaselineReasonMask = new Uint16Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonDepthCandidateReasonMask = new Uint16Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonDepthBaselineCompletedDepth = new Uint8Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonDepthCandidateCompletedDepth = new Uint8Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonDepthBaselineSupportDepth = new Uint8Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonDepthCandidateSupportDepth = new Uint8Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonDepthBaselineTruncatedCount = new Uint8Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonDepthCandidateTruncatedCount = new Uint8Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonDepthBaselineIncompleteTransitions = new Uint16Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonDepthCandidateIncompleteTransitions = new Uint16Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonDepthBaselineInterrupted = new Uint8Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonDepthCandidateInterrupted = new Uint8Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonDepthBaselineAbortReason = new Uint8Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonDepthCandidateAbortReason = new Uint8Array(
      COMPARISON_CAPACITY * DEPTH_LANE.COUNT);
    this.comparisonWidthComplete = new Uint8Array(COMPARISON_CAPACITY *
      WIDTH_LANE.COUNT);
    this.comparisonWidthRelation = new Uint8Array(COMPARISON_CAPACITY *
      WIDTH_LANE.COUNT);
    this.comparisonWidthBaselineValue = new Int32Array(COMPARISON_CAPACITY *
      WIDTH_LANE.COUNT);
    this.comparisonWidthCandidateValue = new Int32Array(COMPARISON_CAPACITY *
      WIDTH_LANE.COUNT);
    this.comparisonWidthBaselineNodes = new Uint16Array(COMPARISON_CAPACITY *
      WIDTH_LANE.COUNT);
    this.comparisonWidthCandidateNodes = new Uint16Array(COMPARISON_CAPACITY *
      WIDTH_LANE.COUNT);
    this.comparisonWidthBaselineReasonMask = new Uint16Array(
      COMPARISON_CAPACITY * WIDTH_LANE.COUNT);
    this.comparisonWidthCandidateReasonMask = new Uint16Array(
      COMPARISON_CAPACITY * WIDTH_LANE.COUNT);
    this.comparisonBaselineTransitionDetail = new Uint16Array(
      COMPARISON_CAPACITY * TRANSITION_DETAIL_FIELD.COUNT);
    this.comparisonCandidateTransitionDetail = new Uint16Array(
      COMPARISON_CAPACITY * TRANSITION_DETAIL_FIELD.COUNT);
    this.comparisonBaselineFastStatusCounts = new Uint16Array(
      COMPARISON_CAPACITY * DIAGNOSTIC_FAST_STATUS_CAPACITY * 2);
    this.comparisonCandidateFastStatusCounts = new Uint16Array(
      COMPARISON_CAPACITY * DIAGNOSTIC_FAST_STATUS_CAPACITY * 2);
    this.comparisonBaselineFastReasonCounts = new Uint16Array(
      COMPARISON_CAPACITY * DIAGNOSTIC_FAST_REASON_CAPACITY * 2);
    this.comparisonCandidateFastReasonCounts = new Uint16Array(
      COMPARISON_CAPACITY * DIAGNOSTIC_FAST_REASON_CAPACITY * 2);
    this.comparisonBaselineRelocationDetailCounts = new Uint16Array(
      COMPARISON_CAPACITY * DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY * 2);
    this.comparisonCandidateRelocationDetailCounts = new Uint16Array(
      COMPARISON_CAPACITY * DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY * 2);
    this.comparisonBaselineHardStatusCounts = new Uint16Array(
      COMPARISON_CAPACITY * DIAGNOSTIC_HARD_STATUS_CAPACITY);
    this.comparisonCandidateHardStatusCounts = new Uint16Array(
      COMPARISON_CAPACITY * DIAGNOSTIC_HARD_STATUS_CAPACITY);
    this.comparisonBaselineFastFailureByDepth = new Uint16Array(
      COMPARISON_CAPACITY * DIAGNOSTIC_DEPTH_CAPACITY * 2);
    this.comparisonCandidateFastFailureByDepth = new Uint16Array(
      COMPARISON_CAPACITY * DIAGNOSTIC_DEPTH_CAPACITY * 2);
    this.comparisonBaselineHardIncompleteByDepth = new Uint16Array(
      COMPARISON_CAPACITY * DIAGNOSTIC_DEPTH_CAPACITY);
    this.comparisonCandidateHardIncompleteByDepth = new Uint16Array(
      COMPARISON_CAPACITY * DIAGNOSTIC_DEPTH_CAPACITY);
  }

  selectionCount(engine) {
    return engine.ourCount > 1 &&
      engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
        engine.ourCount - 1 : engine.ourCount;
  }

  currentRow(engine, emittedAction, count) {
    const selected = engine.diagnosticInternalSelectedIndex;
    if (Number.isSafeInteger(selected) && selected >= 0 && selected < count)
      return selected;
    for (let row = 0; row < count; row += 1)
      if (engine.ourActions[row] === emittedAction) return row;
    return -1;
  }

  exactPhysicalSupport(engine) {
    if (!engine.adapter || !engine.adapter.enemyVisible || engine.enemyCount < 1)
      return 0;
    if (Number.isSafeInteger(engine.hiddenWorldCount) &&
        (engine.hiddenWorldCount !== 1 || !engine.hiddenWorldMass ||
          engine.hiddenWorldMass[0] !== 10000)) return 0;
    return 1;
  }

  prepareAllowed(engine, count) {
    const outcome = engine.riskController && engine.riskController.outcome;
    this.allowedRows.fill(0, 0, count);
    if (!outcome) return 0;
    let allowed = 0;
    for (let row = 0; row < count; row += 1)
      if (engine.hardStatus[row] === HARD_STATUS.ALLOW &&
          row < outcome.count && outcome.acceptable[row] &&
          !outcome.dominated[row]) {
        this.allowedRows[row] = 1; allowed += 1;
      }
    return allowed;
  }

  record(engine, current, candidate, dominates) {
    if (this.sampleCount >= SAMPLE_CAPACITY || candidate < 0) return;
    const at = this.sampleCount++;
    this.sampleFrame[at] =
      engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    this.sampleCurrentAction[at] = engine.ourActions[current];
    this.sampleCandidateAction[at] = engine.ourActions[candidate];
    this.sampleBaselineValue[at] = this.policy.lastBaselineValue;
    this.sampleCandidateValue[at] = this.policy.lastBestValue;
    this.sampleDominance[at] = dominates ? 1 : 0;
  }

  recordCertificate(engine, current, candidate, objectiveRelation) {
    if (this.certificateCount >= CERTIFICATE_CAPACITY) {
      this.certificateOverflowCount += 1; return;
    }
    const at = this.certificateCount++;
    const state = engine.adapter.state;
    const scalar = state.arrays[ARRAY.SCALAR];
    const frame = scalar[SCALAR.FRAME];
    const sameGateFrame = engine.diagnosticPhysicalRootFrame === frame;
    this.certificateFrame[at] = frame;
    this.certificateHashLo[at] = sameGateFrame && Number.isSafeInteger(
      engine.diagnosticPhysicalRootHashLo) ?
      engine.diagnosticPhysicalRootHashLo : state.hashLo;
    this.certificateHashHi[at] = sameGateFrame && Number.isSafeInteger(
      engine.diagnosticPhysicalRootHashHi) ?
      engine.diagnosticPhysicalRootHashHi : state.hashHi;
    this.certificateCurrentRow[at] = current;
    this.certificateCandidateRow[at] = candidate;
    this.certificateCurrentAction[at] = engine.ourActions[current];
    this.certificateCandidateAction[at] = engine.ourActions[candidate];
    this.certificateCurrentArgument[at] = engine.ourArguments[current];
    this.certificateCandidateArgument[at] = engine.ourArguments[candidate];
    this.certificateBaselineValue[at] = this.policy.lastBaselineValue;
    this.certificateCandidateValue[at] = this.policy.lastBestValue;
    this.certificateEpochGeneration[at] = this.epoch.activeGeneration;
    this.certificateTargetSignature[at] = this.epoch.activeTargetSignature;
    this.certificateTargetGeneration[at] = this.epoch.activeTargetGeneration;
    this.certificateControlMode[at] = engine.lastControlMode | 0;
    this.certificateObjectiveRelation[at] = objectiveRelation;
    const offset = at * 2 * OBJECTIVE_DIMENSION.COUNT;
    this.certificateObjective.set(this.objective.current, offset);
    this.certificateObjective.set(this.objective.candidate,
      offset + OBJECTIVE_DIMENSION.COUNT);
  }

  recordComparison(engine, current, candidate, policyRelation,
      objectiveRelation) {
    if (this.comparisonCount >= COMPARISON_CAPACITY) {
      this.comparisonOverflowCount += 1; return;
    }
    const at = this.comparisonCount++;
    const state = engine.adapter.state;
    const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const sameGateFrame = engine.diagnosticPhysicalRootFrame === frame;
    this.comparisonFrame[at] = frame;
    this.comparisonHashLo[at] = sameGateFrame && Number.isSafeInteger(
      engine.diagnosticPhysicalRootHashLo) ?
      engine.diagnosticPhysicalRootHashLo : state.hashLo;
    this.comparisonHashHi[at] = sameGateFrame && Number.isSafeInteger(
      engine.diagnosticPhysicalRootHashHi) ?
      engine.diagnosticPhysicalRootHashHi : state.hashHi;
    this.comparisonCurrentRow[at] = current;
    this.comparisonCandidateRow[at] = candidate;
    this.comparisonCurrentAction[at] = engine.ourActions[current];
    this.comparisonCandidateAction[at] = engine.ourActions[candidate];
    this.comparisonCurrentArgument[at] = engine.ourArguments[current];
    this.comparisonCandidateArgument[at] = engine.ourArguments[candidate];
    this.comparisonBaselineValue[at] = this.policy.lastBaselineValue;
    this.comparisonCandidateValue[at] = this.policy.lastBestValue;
    this.comparisonPolicyRelation[at] = policyRelation;
    this.comparisonObjectiveRelation[at] = objectiveRelation;
    const offset = at * 2 * OBJECTIVE_DIMENSION.COUNT;
    this.comparisonObjective.set(this.objective.current, offset);
    this.comparisonObjective.set(this.objective.candidate,
      offset + OBJECTIVE_DIMENSION.COUNT);
    if (this.depthStability) {
      const laneOffset = at * DEPTH_LANE.COUNT;
      this.comparisonDepthComplete.set(this.depthStability.lastComplete,
        laneOffset);
      this.comparisonDepthRelation.set(this.depthStability.lastRelation,
        laneOffset);
      this.comparisonDepthBaselineValue.set(
        this.depthStability.lastBaselineValue, laneOffset);
      this.comparisonDepthCandidateValue.set(
        this.depthStability.lastCandidateValue, laneOffset);
      this.comparisonDepthBaselineNodes.set(
        this.depthStability.lastBaselineNodes, laneOffset);
      this.comparisonDepthCandidateNodes.set(
        this.depthStability.lastCandidateNodes, laneOffset);
      this.comparisonDepthBaselineReasonMask.set(
        this.depthStability.lastBaselineReasonMask, laneOffset);
      this.comparisonDepthCandidateReasonMask.set(
        this.depthStability.lastCandidateReasonMask, laneOffset);
      this.comparisonDepthBaselineCompletedDepth.set(
        this.depthStability.lastBaselineCompletedDepth, laneOffset);
      this.comparisonDepthCandidateCompletedDepth.set(
        this.depthStability.lastCandidateCompletedDepth, laneOffset);
      this.comparisonDepthBaselineSupportDepth.set(
        this.depthStability.lastBaselineSupportDepth, laneOffset);
      this.comparisonDepthCandidateSupportDepth.set(
        this.depthStability.lastCandidateSupportDepth, laneOffset);
      this.comparisonDepthBaselineTruncatedCount.set(
        this.depthStability.lastBaselineTruncatedCount, laneOffset);
      this.comparisonDepthCandidateTruncatedCount.set(
        this.depthStability.lastCandidateTruncatedCount, laneOffset);
      this.comparisonDepthBaselineIncompleteTransitions.set(
        this.depthStability.lastBaselineIncompleteTransitions, laneOffset);
      this.comparisonDepthCandidateIncompleteTransitions.set(
        this.depthStability.lastCandidateIncompleteTransitions, laneOffset);
      this.comparisonDepthBaselineInterrupted.set(
        this.depthStability.lastBaselineInterrupted, laneOffset);
      this.comparisonDepthCandidateInterrupted.set(
        this.depthStability.lastCandidateInterrupted, laneOffset);
      this.comparisonDepthBaselineAbortReason.set(
        this.depthStability.lastBaselineAbortReason, laneOffset);
      this.comparisonDepthCandidateAbortReason.set(
        this.depthStability.lastCandidateAbortReason, laneOffset);
    }
    if (this.depthWidthStability) {
      const widthOffset = at * WIDTH_LANE.COUNT;
      this.comparisonWidthComplete.set(
        this.depthWidthStability.lastComplete, widthOffset);
      this.comparisonWidthRelation.set(
        this.depthWidthStability.lastRelation, widthOffset);
      this.comparisonWidthBaselineValue.set(
        this.depthWidthStability.lastBaselineValue, widthOffset);
      this.comparisonWidthCandidateValue.set(
        this.depthWidthStability.lastCandidateValue, widthOffset);
      this.comparisonWidthBaselineNodes.set(
        this.depthWidthStability.lastBaselineNodes, widthOffset);
      this.comparisonWidthCandidateNodes.set(
        this.depthWidthStability.lastCandidateNodes, widthOffset);
      this.comparisonWidthBaselineReasonMask.set(
        this.depthWidthStability.lastBaselineReasonMask, widthOffset);
      this.comparisonWidthCandidateReasonMask.set(
        this.depthWidthStability.lastCandidateReasonMask, widthOffset);
      if (this.depthWidthStability.lastBaselineTransitionDetail) {
        const detailOffset = at * TRANSITION_DETAIL_FIELD.COUNT;
        this.comparisonBaselineTransitionDetail.set(
          this.depthWidthStability.lastBaselineTransitionDetail, detailOffset);
        this.comparisonCandidateTransitionDetail.set(
          this.depthWidthStability.lastCandidateTransitionDetail, detailOffset);
        const fastStatusOffset = at * DIAGNOSTIC_FAST_STATUS_CAPACITY * 2;
        this.comparisonBaselineFastStatusCounts.set(
          this.depthWidthStability.lastBaselineFastStatusCounts, fastStatusOffset);
        this.comparisonCandidateFastStatusCounts.set(
          this.depthWidthStability.lastCandidateFastStatusCounts, fastStatusOffset);
        const fastReasonOffset = at * DIAGNOSTIC_FAST_REASON_CAPACITY * 2;
        this.comparisonBaselineFastReasonCounts.set(
          this.depthWidthStability.lastBaselineFastReasonCounts, fastReasonOffset);
        this.comparisonCandidateFastReasonCounts.set(
          this.depthWidthStability.lastCandidateFastReasonCounts, fastReasonOffset);
        const relocationOffset = at * DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY * 2;
        this.comparisonBaselineRelocationDetailCounts.set(
          this.depthWidthStability.lastBaselineRelocationDetailCounts,
          relocationOffset);
        this.comparisonCandidateRelocationDetailCounts.set(
          this.depthWidthStability.lastCandidateRelocationDetailCounts,
          relocationOffset);
        const hardStatusOffset = at * DIAGNOSTIC_HARD_STATUS_CAPACITY;
        this.comparisonBaselineHardStatusCounts.set(
          this.depthWidthStability.lastBaselineHardStatusCounts, hardStatusOffset);
        this.comparisonCandidateHardStatusCounts.set(
          this.depthWidthStability.lastCandidateHardStatusCounts, hardStatusOffset);
        const fastDepthOffset = at * DIAGNOSTIC_DEPTH_CAPACITY * 2;
        this.comparisonBaselineFastFailureByDepth.set(
          this.depthWidthStability.lastBaselineFastFailureByDepth,
          fastDepthOffset);
        this.comparisonCandidateFastFailureByDepth.set(
          this.depthWidthStability.lastCandidateFastFailureByDepth,
          fastDepthOffset);
        const hardDepthOffset = at * DIAGNOSTIC_DEPTH_CAPACITY;
        this.comparisonBaselineHardIncompleteByDepth.set(
          this.depthWidthStability.lastBaselineHardIncompleteByDepth,
          hardDepthOffset);
        this.comparisonCandidateHardIncompleteByDepth.set(
          this.depthWidthStability.lastCandidateHardIncompleteByDepth,
          hardDepthOffset);
      }
    }
    if (this.depthMoveVariant) this.depthMoveVariant.record(at);
    if (this.depthLeafBackup) this.depthLeafBackup.record(at);
    if (this.depthResponseMatrix) this.depthResponseMatrix.record(at);
    if (this.responseConditioned) this.responseConditioned.record(at);
    if (this.eventDeadline) this.eventDeadline.record(at);
    if (this.eventHorizon) this.eventHorizon.record(at);
  }

  observe(engine, emittedAction) {
    this.decisionCount += 1; this.lastProposal = -1;
    if (!this.epoch || !this.epoch.activeGeneration ||
        this.epoch.activeKind !== LONG_OPTION.ATTACK) {
      this.inactiveCount += 1; return;
    }
    if (this.epoch.lastStatus === OBJECTIVE_EPOCH_STATUS.INTERRUPT_YIELD) {
      this.suspendedCount += 1; return;
    }
    if (this.coverage && this.coverage.lastStrictMask) {
      this.strictExecutionAvailableCount += 1; return;
    }
    if (!engine.runtime || engine.runtime.runtimeMode !== RUNTIME_MODE.NORMAL) {
      this.runtimeSkipCount += 1; return;
    }
    if (!this.exactPhysicalSupport(engine)) {
      this.supportSkipCount += 1; return;
    }
    if ((engine.escapeObligation?.committedEntityCount | 0) > 0) {
      this.committedSkipCount += 1; return;
    }
    const count = this.selectionCount(engine);
    const current = this.currentRow(engine, emittedAction, count);
    if (current < 0 || !this.prepareAllowed(engine, count) ||
        !this.allowedRows[current]) {
      this.invalidCurrentCount += 1; return;
    }
    if (!this.pose.prepare(engine, count)) {
      this.noPoseCount += 1; return;
    }
    this.policyAttemptCount += 1;
    const noDomainBefore = this.policy.noDomainCount || 0;
    const winner = this.policy.select(engine, this.pose, count,
      engine.depthSearch, current, 0, this.allowedRows);
    if (!this.policy.lastComplete) {
      if ((this.policy.noDomainCount || 0) > noDomainBefore)
        this.noPolicyDomainCount += 1;
      else this.incompleteCount += 1;
      return;
    }
    this.completeCount += 1;
    const candidate = this.policy.lastBestRow;
    let objectiveRelation = OBJECTIVE_RELATION.INCOMPLETE;
    if (candidate >= 0 && candidate < count) {
      const action = engine.ourActions[candidate];
      if (action >= 0 && action < ACTION_BUCKETS)
        this.candidateByAction[action] += 1;
      objectiveRelation = this.objective.compare(engine, this.pose,
        current, candidate);
      if (this.depthStability)
        this.depthStability.evaluate(engine, this.pose, count, current,
          candidate, this.allowedRows);
      if (this.depthWidthStability)
        this.depthWidthStability.evaluate(engine, this.pose, count, current,
          candidate, this.allowedRows);
      if (this.depthMoveVariant)
        this.depthMoveVariant.evaluate(engine, this.pose, count, current,
          candidate, this.allowedRows, this.depthWidthStability);
      if (this.depthLeafBackup)
        this.depthLeafBackup.evaluate(engine, this.pose, count, current,
          candidate, this.allowedRows, this.depthWidthStability);
      if (this.depthResponseMatrix)
        this.depthResponseMatrix.evaluate(engine, this.depthLeafBackup,
          current, candidate);
      if (this.responseConditioned)
        this.responseConditioned.evaluate(engine, this.depthLeafBackup,
          this.depthResponseMatrix, this.objective, current, candidate);
      if (this.eventDeadline)
        this.eventDeadline.evaluate(engine, this.pose, count, current,
          candidate, this.allowedRows, this.depthWidthStability,
          this.responseConditioned);
      if (this.eventHorizon)
        this.eventHorizon.evaluate(engine, current, candidate,
          this.depthWidthStability, this.eventDeadline);
      const relation = winner >= 0 ? POLICY_RELATION.CANDIDATE_HIGHER :
        this.policy.lastBestValue === this.policy.lastBaselineValue ?
          POLICY_RELATION.EQUAL : POLICY_RELATION.CANDIDATE_LOWER;
      this.recordComparison(engine, current, candidate, relation,
        objectiveRelation);
    } else this.comparisonMissingCandidateCount += 1;
    if (winner >= 0) {
      this.lastProposal = winner;
      this.strictDominanceCount += 1;
      const action = engine.ourActions[winner];
      if (action >= 0 && action < ACTION_BUCKETS)
        this.dominanceByAction[action] += 1;
      if (action === emittedAction) this.samePrimitiveDominanceCount += 1;
      this.recordCertificate(engine, current, winner, objectiveRelation);
      this.record(engine, current, winner, 1); return;
    }
    if (this.policy.lastBestValue === this.policy.lastBaselineValue)
      this.equalCount += 1;
    else this.refutedCount += 1;
    this.record(engine, current, candidate, 0);
  }

  totalHotAllocationCount() {
    return this.hotAllocationCount + (this.pose?.hotAllocationCount || 0) +
      (this.policy?.hotAllocationCount || 0) +
      (this.policy?.searchEngine?.hotAllocationCount || 0) +
      (this.policy?.baselineSearch?.hotAllocationCount || 0) +
      (this.policy?.feedback?.hotAllocationCount || 0) +
      (this.objective?.hotAllocationCount || 0) +
      (this.depthStability?.totalHotAllocationCount() || 0) +
      (this.depthWidthStability?.totalHotAllocationCount() || 0) +
      (this.depthMoveVariant?.totalHotAllocationCount() || 0) +
      (this.depthLeafBackup?.totalHotAllocationCount() || 0) +
      (this.depthResponseMatrix?.totalHotAllocationCount() || 0) +
      (this.responseConditioned?.hotAllocationCount || 0) +
      (this.eventDeadline?.totalHotAllocationCount() || 0) +
      (this.eventHorizon?.totalHotAllocationCount() || 0);
  }

  summary() {
    const samples = [];
    for (let at = 0; at < this.sampleCount; at += 1) samples.push({
      frame: this.sampleFrame[at], currentAction: this.sampleCurrentAction[at],
      candidateAction: this.sampleCandidateAction[at],
      baselineValue: this.sampleBaselineValue[at],
      candidateValue: this.sampleCandidateValue[at],
      dominates: Boolean(this.sampleDominance[at])
    });
    const certificateRoots = [];
    for (let at = 0; at < this.certificateCount; at += 1)
      {
        const offset = at * 2 * OBJECTIVE_DIMENSION.COUNT;
        certificateRoots.push({
        frame: this.certificateFrame[at],
        hashLo: this.certificateHashLo[at], hashHi: this.certificateHashHi[at],
        currentRow: this.certificateCurrentRow[at],
        candidateRow: this.certificateCandidateRow[at],
        currentAction: this.certificateCurrentAction[at],
        candidateAction: this.certificateCandidateAction[at],
        currentArgument: this.certificateCurrentArgument[at],
        candidateArgument: this.certificateCandidateArgument[at],
        baselineValue: this.certificateBaselineValue[at],
        candidateValue: this.certificateCandidateValue[at],
        epochGeneration: this.certificateEpochGeneration[at],
        targetSignature: this.certificateTargetSignature[at],
        targetGeneration: this.certificateTargetGeneration[at],
          controlMode: this.certificateControlMode[at],
          objectiveRelation: this.certificateObjectiveRelation[at],
          objectiveCurrent: vectorObject(this.certificateObjective, offset),
          objectiveCandidate: vectorObject(this.certificateObjective,
            offset + OBJECTIVE_DIMENSION.COUNT)
        });
      }
    const comparisonRoots = [];
    for (let at = 0; at < this.comparisonCount; at += 1) {
      const offset = at * 2 * OBJECTIVE_DIMENSION.COUNT;
      const depthLadder = [];
      const depthWidthLadder = [];
      const laneOffset = at * DEPTH_LANE.COUNT;
      if (this.depthStability)
        for (let lane = 0; lane < DEPTH_LANE.COUNT; lane += 1)
          depthLadder.push({ name: DEPTH_LANE_NAME[lane],
            complete: Boolean(this.comparisonDepthComplete[laneOffset + lane]),
            relation: this.comparisonDepthRelation[laneOffset + lane],
            baselineValue:
              this.comparisonDepthBaselineValue[laneOffset + lane],
            candidateValue:
              this.comparisonDepthCandidateValue[laneOffset + lane],
            baselineNodes:
              this.comparisonDepthBaselineNodes[laneOffset + lane],
            candidateNodes:
              this.comparisonDepthCandidateNodes[laneOffset + lane],
            baselineReasonMask:
              this.comparisonDepthBaselineReasonMask[laneOffset + lane],
            candidateReasonMask:
              this.comparisonDepthCandidateReasonMask[laneOffset + lane],
            baselineCompletedDepth:
              this.comparisonDepthBaselineCompletedDepth[laneOffset + lane],
            candidateCompletedDepth:
              this.comparisonDepthCandidateCompletedDepth[laneOffset + lane],
            baselineSupportDepth:
              this.comparisonDepthBaselineSupportDepth[laneOffset + lane],
            candidateSupportDepth:
              this.comparisonDepthCandidateSupportDepth[laneOffset + lane],
            baselineTruncatedCount:
              this.comparisonDepthBaselineTruncatedCount[laneOffset + lane],
            candidateTruncatedCount:
              this.comparisonDepthCandidateTruncatedCount[laneOffset + lane],
            baselineIncompleteTransitions:
              this.comparisonDepthBaselineIncompleteTransitions[laneOffset + lane],
            candidateIncompleteTransitions:
              this.comparisonDepthCandidateIncompleteTransitions[laneOffset + lane],
            baselineInterrupted:
              Boolean(this.comparisonDepthBaselineInterrupted[laneOffset + lane]),
            candidateInterrupted:
              Boolean(this.comparisonDepthCandidateInterrupted[laneOffset + lane]),
            baselineAbortReason:
              this.comparisonDepthBaselineAbortReason[laneOffset + lane],
            candidateAbortReason:
              this.comparisonDepthCandidateAbortReason[laneOffset + lane] });
      const widthOffset = at * WIDTH_LANE.COUNT;
      if (this.depthWidthStability)
        for (let lane = 0; lane < WIDTH_LANE.COUNT; lane += 1)
          depthWidthLadder.push({ name: WIDTH_LANE_NAME[lane],
            complete: Boolean(this.comparisonWidthComplete[widthOffset + lane]),
            relation: this.comparisonWidthRelation[widthOffset + lane],
            baselineValue:
              this.comparisonWidthBaselineValue[widthOffset + lane],
            candidateValue:
              this.comparisonWidthCandidateValue[widthOffset + lane],
            baselineNodes:
              this.comparisonWidthBaselineNodes[widthOffset + lane],
            candidateNodes:
              this.comparisonWidthCandidateNodes[widthOffset + lane],
            baselineReasonMask:
              this.comparisonWidthBaselineReasonMask[widthOffset + lane],
            candidateReasonMask:
              this.comparisonWidthCandidateReasonMask[widthOffset + lane] });
      let transitionSupport = null;
      if (this.depthWidthStability) {
        const detailOffset = at * TRANSITION_DETAIL_FIELD.COUNT;
        const fastStatusOffset = at * DIAGNOSTIC_FAST_STATUS_CAPACITY * 2;
        const fastReasonOffset = at * DIAGNOSTIC_FAST_REASON_CAPACITY * 2;
        const relocationOffset = at * DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY * 2;
        const hardStatusOffset = at * DIAGNOSTIC_HARD_STATUS_CAPACITY;
        const fastDepthOffset = at * DIAGNOSTIC_DEPTH_CAPACITY * 2;
        const hardDepthOffset = at * DIAGNOSTIC_DEPTH_CAPACITY;
        transitionSupport = { lane: WIDTH_LANE_NAME[WIDTH_LANE.W4_B4096],
          baseline: { detail: transitionDetailObject(
            this.comparisonBaselineTransitionDetail, detailOffset),
          fastStatusCounts: fixedValues(this.comparisonBaselineFastStatusCounts,
            fastStatusOffset, DIAGNOSTIC_FAST_STATUS_CAPACITY * 2),
          fastReasonCounts: fixedValues(this.comparisonBaselineFastReasonCounts,
            fastReasonOffset, DIAGNOSTIC_FAST_REASON_CAPACITY * 2),
          relocationDetailCounts: fixedValues(
            this.comparisonBaselineRelocationDetailCounts, relocationOffset,
            DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY * 2),
          hardStatusCounts: fixedValues(this.comparisonBaselineHardStatusCounts,
            hardStatusOffset, DIAGNOSTIC_HARD_STATUS_CAPACITY),
          fastFailureByDepth: fixedValues(
            this.comparisonBaselineFastFailureByDepth, fastDepthOffset,
            DIAGNOSTIC_DEPTH_CAPACITY * 2),
          hardIncompleteByDepth: fixedValues(
            this.comparisonBaselineHardIncompleteByDepth, hardDepthOffset,
            DIAGNOSTIC_DEPTH_CAPACITY) },
          candidate: { detail: transitionDetailObject(
            this.comparisonCandidateTransitionDetail, detailOffset),
          fastStatusCounts: fixedValues(this.comparisonCandidateFastStatusCounts,
            fastStatusOffset, DIAGNOSTIC_FAST_STATUS_CAPACITY * 2),
          fastReasonCounts: fixedValues(this.comparisonCandidateFastReasonCounts,
            fastReasonOffset, DIAGNOSTIC_FAST_REASON_CAPACITY * 2),
          relocationDetailCounts: fixedValues(
            this.comparisonCandidateRelocationDetailCounts, relocationOffset,
            DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY * 2),
          hardStatusCounts: fixedValues(this.comparisonCandidateHardStatusCounts,
            hardStatusOffset, DIAGNOSTIC_HARD_STATUS_CAPACITY),
          fastFailureByDepth: fixedValues(
            this.comparisonCandidateFastFailureByDepth, fastDepthOffset,
            DIAGNOSTIC_DEPTH_CAPACITY * 2),
          hardIncompleteByDepth: fixedValues(
            this.comparisonCandidateHardIncompleteByDepth, hardDepthOffset,
            DIAGNOSTIC_DEPTH_CAPACITY) } };
      }
      comparisonRoots.push({ frame: this.comparisonFrame[at],
        hashLo: this.comparisonHashLo[at], hashHi: this.comparisonHashHi[at],
        currentRow: this.comparisonCurrentRow[at],
        candidateRow: this.comparisonCandidateRow[at],
        currentAction: this.comparisonCurrentAction[at],
        candidateAction: this.comparisonCandidateAction[at],
        currentArgument: this.comparisonCurrentArgument[at],
        candidateArgument: this.comparisonCandidateArgument[at],
        baselineValue: this.comparisonBaselineValue[at],
        candidateValue: this.comparisonCandidateValue[at],
        policyRelation: this.comparisonPolicyRelation[at],
        objectiveRelation: this.comparisonObjectiveRelation[at],
        objectiveCurrent: vectorObject(this.comparisonObjective, offset),
          objectiveCandidate: vectorObject(this.comparisonObjective,
            offset + OBJECTIVE_DIMENSION.COUNT), depthLadder,
          depthWidthLadder, transitionSupport,
          moveVariantEnvelope: this.depthMoveVariant ?
            this.depthMoveVariant.root(at) : null,
          leafBackupEnvelope: this.depthLeafBackup ?
            this.depthLeafBackup.root(at) : null,
          responseMatrixEnvelope: this.depthResponseMatrix ?
            this.depthResponseMatrix.root(at) : null,
          responseConditionedEnvelope: this.responseConditioned ?
            this.responseConditioned.root(at) : null,
          eventDeadlineEnvelope: this.eventDeadline ?
            this.eventDeadline.root(at) : null,
          eventHorizonEnvelope: this.eventHorizon ?
            this.eventHorizon.root(at) : null });
    }
    return { decisionCount: this.decisionCount, inactiveCount: this.inactiveCount,
      suspendedCount: this.suspendedCount,
      strictExecutionAvailableCount: this.strictExecutionAvailableCount,
      runtimeSkipCount: this.runtimeSkipCount, supportSkipCount: this.supportSkipCount,
      committedSkipCount: this.committedSkipCount,
      invalidCurrentCount: this.invalidCurrentCount, noPoseCount: this.noPoseCount,
      policyAttemptCount: this.policyAttemptCount,
      noPolicyDomainCount: this.noPolicyDomainCount,
      completeCount: this.completeCount,
      incompleteCount: this.incompleteCount, refutedCount: this.refutedCount,
      equalCount: this.equalCount, strictDominanceCount: this.strictDominanceCount,
      samePrimitiveDominanceCount: this.samePrimitiveDominanceCount,
      certificateCount: this.certificateCount,
      certificateOverflowCount: this.certificateOverflowCount,
      comparisonCount: this.comparisonCount,
      comparisonOverflowCount: this.comparisonOverflowCount,
      comparisonMissingCandidateCount: this.comparisonMissingCandidateCount,
      candidateByAction: namedActions(this.candidateByAction),
      dominanceByAction: namedActions(this.dominanceByAction),
      pose: this.pose.summary(), policy: this.policy.summary(),
      objective: this.objective.summary(),
      depthStability: this.depthStability ? this.depthStability.summary() : null,
      depthWidthStability: this.depthWidthStability ?
        this.depthWidthStability.summary() : null,
      depthMoveVariant: this.depthMoveVariant ?
        this.depthMoveVariant.summary() : null,
      depthLeafBackup: this.depthLeafBackup ?
        this.depthLeafBackup.summary() : null,
      depthResponseMatrix: this.depthResponseMatrix ?
        this.depthResponseMatrix.summary() : null,
      responseConditioned: this.responseConditioned ?
        this.responseConditioned.summary() : null,
      eventDeadline: this.eventDeadline ?
        this.eventDeadline.summary() : null,
      eventHorizon: this.eventHorizon ?
        this.eventHorizon.summary() : null,
      samples,
      certificateRoots, comparisonRoots,
      hotAllocationCount: this.totalHotAllocationCount(),
      lastProposal: this.lastProposal };
  }
}

module.exports = { SemanticAttackPolicyIntervalShadow, CERTIFICATE_CAPACITY,
  COMPARISON_CAPACITY, POLICY_RELATION, OBJECTIVE_RELATION };
