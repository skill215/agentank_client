"use strict";

// BP134 reruns only BP133's fail-closed joint-movement roots in three explicit
// finite rule worlds. No world is selected as platform truth or owns an action.

const { HazardKernel } = require("../../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../../engine-v2/src/fast/hard-gate");
const { FAST_UNSUPPORTED_REASON } = require("../../../engine-v2/src/fast/kernel");
const { WIDTH_LANE, TRANSITION_DETAIL_FIELD } = require(
  "./semantic-attack-depth3-width-shadow");
const { PAIR_RELATION, NativeAttackPosePolicySearchPoc } = require(
  "./native-attack-pose-policy-search-poc");
const { MOVE_CONTEST_VARIANT, MoveContestVariantKernel } = require(
  "./move-contest-variant-kernel");

const MOVE_VARIANTS = Object.freeze([MOVE_CONTEST_VARIANT.SEQUENTIAL_BLOCK,
  MOVE_CONTEST_VARIANT.INTENT_BLOCK, MOVE_CONTEST_VARIANT.COLLISION_CRASH]);
const MOVE_VARIANT_NAME = Object.freeze([
  "SEQUENTIAL_BLOCK", "INTENT_BLOCK", "COLLISION_CRASH"]);
const VARIANT_COUNT = MOVE_VARIANTS.length;
const ROOT_CAPACITY = 32;
const VARIANT_COMMON_STATUS = Object.freeze({ NOT_EVALUATED: 0,
  INCOMPLETE: 1, AGREEMENT: 2, DISAGREEMENT: 3 });

function isJointMovementGap(widthShadow) {
  if (!widthShadow || widthShadow.lastComplete[WIDTH_LANE.W4_B4096]) return 0;
  const baseline = widthShadow.lastBaselineTransitionDetail;
  const candidate = widthShadow.lastCandidateTransitionDetail;
  const reasonField = TRANSITION_DETAIL_FIELD.FIRST_FAST_REASON;
  return baseline?.[reasonField] ===
      FAST_UNSUPPORTED_REASON.JOINT_TANK_RELOCATION ||
    candidate?.[reasonField] ===
      FAST_UNSUPPORTED_REASON.JOINT_TANK_RELOCATION ? 1 : 0;
}

function commonStatus(complete, relation) {
  for (let variant = 0; variant < VARIANT_COUNT; variant += 1)
    if (!complete[variant]) return VARIANT_COMMON_STATUS.INCOMPLETE;
  return relation[0] === relation[1] && relation[1] === relation[2] ?
    VARIANT_COMMON_STATUS.AGREEMENT : VARIANT_COMMON_STATUS.DISAGREEMENT;
}

class SemanticAttackDepth3MoveVariantShadow {
  constructor(runtimeConfig, options = {}) {
    this.policies = options.policies || MOVE_VARIANTS.map(() =>
      new NativeAttackPosePolicySearchPoc(runtimeConfig, { nodeBudget: 4096,
        pairedDepth: 3, commonContinuation: true, deepExpansionLimit: 4 }));
    this.state = null; this.kernels = new Array(VARIANT_COUNT).fill(null);
    this.hazards = new Array(VARIANT_COUNT).fill(null);
    this.hards = new Array(VARIANT_COUNT).fill(null);
    this.lastAttempted = 0;
    this.lastComplete = new Uint8Array(VARIANT_COUNT);
    this.lastRelation = new Uint8Array(VARIANT_COUNT);
    this.lastBaselineValue = new Int32Array(VARIANT_COUNT);
    this.lastCandidateValue = new Int32Array(VARIANT_COUNT);
    this.lastBaselineNodes = new Uint16Array(VARIANT_COUNT);
    this.lastCandidateNodes = new Uint16Array(VARIANT_COUNT);
    this.lastBaselineReasonMask = new Uint16Array(VARIANT_COUNT);
    this.lastCandidateReasonMask = new Uint16Array(VARIANT_COUNT);
    this.lastCommonStatus = VARIANT_COMMON_STATUS.NOT_EVALUATED;
    this.lastCommonRelation = PAIR_RELATION.INCOMPLETE;
    this.recordAttempted = new Uint8Array(ROOT_CAPACITY);
    this.recordComplete = new Uint8Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordRelation = new Uint8Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordBaselineValue = new Int32Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordCandidateValue = new Int32Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordBaselineNodes = new Uint16Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordCandidateNodes = new Uint16Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordBaselineReasonMask = new Uint16Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordCandidateReasonMask = new Uint16Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordCommonStatus = new Uint8Array(ROOT_CAPACITY);
    this.recordCommonRelation = new Uint8Array(ROOT_CAPACITY);
    this.attemptCount = 0; this.completeAcrossVariantsCount = 0;
    this.incompleteCount = 0; this.agreementCount = 0;
    this.disagreementCount = 0; this.rootRestoreFailureCount = 0;
    this.totalNodes = new Uint32Array(VARIANT_COUNT);
    this.relationCount = new Uint32Array(VARIANT_COUNT * 4);
    this.hotAllocationCount = 0;
  }

  bind(bundle) {
    if (this.state === bundle.state) return;
    this.state = bundle.state;
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
      const kernel = new MoveContestVariantKernel(this.state,
        MOVE_VARIANTS[variant]);
      const hazard = new HazardKernel(this.state);
      this.kernels[variant] = kernel; this.hazards[variant] = hazard;
      this.hards[variant] = new HardGate(kernel, hazard, 0);
    }
  }

  clearLast() {
    this.lastAttempted = 0; this.lastComplete.fill(0);
    this.lastRelation.fill(PAIR_RELATION.INCOMPLETE);
    this.lastBaselineValue.fill(0); this.lastCandidateValue.fill(0);
    this.lastBaselineNodes.fill(0); this.lastCandidateNodes.fill(0);
    this.lastBaselineReasonMask.fill(0); this.lastCandidateReasonMask.fill(0);
    this.lastCommonStatus = VARIANT_COMMON_STATUS.NOT_EVALUATED;
    this.lastCommonRelation = PAIR_RELATION.INCOMPLETE;
  }

  evaluate(engine, pose, count, current, candidate, allowedRows, widthShadow) {
    this.clearLast();
    if (!isJointMovementGap(widthShadow)) return;
    const bundle = engine.adapter.bundle; if (!bundle?.state) return;
    this.bind(bundle); this.lastAttempted = 1; this.attemptCount += 1;
    const originalKernel = bundle.kernel; const originalHazard = bundle.hazard;
    const originalHard = bundle.hard;
    const beforeLo = bundle.state.hashLo; const beforeHi = bundle.state.hashHi;
    const beforeDelta = bundle.state.deltaUsed; const beforeEvent = bundle.state.eventUsed;
    try {
      for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
        bundle.kernel = this.kernels[variant];
        bundle.hazard = this.hazards[variant]; bundle.hard = this.hards[variant];
        const policy = this.policies[variant];
        policy.searchEngine?.cacheBank?.beginMatch?.();
        policy.baselineSearch?.cacheBank?.beginMatch?.();
        const relation = policy.comparePair(engine, pose, count,
          engine.depthSearch, current, candidate, allowedRows);
        this.lastRelation[variant] = relation;
        this.relationCount[variant * 4 + relation] += 1;
        this.lastBaselineValue[variant] = policy.lastBaselineValue;
        this.lastCandidateValue[variant] = policy.lastBestValue;
        this.lastBaselineNodes[variant] = policy.lastBaselineNodes;
        this.lastCandidateNodes[variant] = policy.lastCandidateNodes;
        this.lastBaselineReasonMask[variant] = policy.lastBaselineReasonMask;
        this.lastCandidateReasonMask[variant] = policy.lastCandidateReasonMask;
        this.totalNodes[variant] += policy.lastBaselineNodes +
          policy.lastCandidateNodes;
        if (relation !== PAIR_RELATION.INCOMPLETE) this.lastComplete[variant] = 1;
        if (bundle.state.hashLo !== beforeLo || bundle.state.hashHi !== beforeHi ||
            bundle.state.deltaUsed !== beforeDelta ||
            bundle.state.eventUsed !== beforeEvent)
          this.rootRestoreFailureCount += 1;
      }
    } finally {
      bundle.kernel = originalKernel; bundle.hazard = originalHazard;
      bundle.hard = originalHard;
    }
    this.lastCommonStatus = commonStatus(this.lastComplete, this.lastRelation);
    if (this.lastCommonStatus === VARIANT_COMMON_STATUS.AGREEMENT) {
      this.lastCommonRelation = this.lastRelation[0];
      this.completeAcrossVariantsCount += 1; this.agreementCount += 1;
    } else if (this.lastCommonStatus === VARIANT_COMMON_STATUS.DISAGREEMENT) {
      this.completeAcrossVariantsCount += 1; this.disagreementCount += 1;
    } else this.incompleteCount += 1;
  }

  record(at) {
    if (at < 0 || at >= ROOT_CAPACITY) return;
    this.recordAttempted[at] = this.lastAttempted;
    const offset = at * VARIANT_COUNT;
    this.recordComplete.set(this.lastComplete, offset);
    this.recordRelation.set(this.lastRelation, offset);
    this.recordBaselineValue.set(this.lastBaselineValue, offset);
    this.recordCandidateValue.set(this.lastCandidateValue, offset);
    this.recordBaselineNodes.set(this.lastBaselineNodes, offset);
    this.recordCandidateNodes.set(this.lastCandidateNodes, offset);
    this.recordBaselineReasonMask.set(this.lastBaselineReasonMask, offset);
    this.recordCandidateReasonMask.set(this.lastCandidateReasonMask, offset);
    this.recordCommonStatus[at] = this.lastCommonStatus;
    this.recordCommonRelation[at] = this.lastCommonRelation;
  }

  root(at) {
    if (at < 0 || at >= ROOT_CAPACITY || !this.recordAttempted[at]) return null;
    const offset = at * VARIANT_COUNT; const variants = [];
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) variants.push({
      name: MOVE_VARIANT_NAME[variant],
      complete: Boolean(this.recordComplete[offset + variant]),
      relation: this.recordRelation[offset + variant],
      baselineValue: this.recordBaselineValue[offset + variant],
      candidateValue: this.recordCandidateValue[offset + variant],
      baselineNodes: this.recordBaselineNodes[offset + variant],
      candidateNodes: this.recordCandidateNodes[offset + variant],
      baselineReasonMask: this.recordBaselineReasonMask[offset + variant],
      candidateReasonMask: this.recordCandidateReasonMask[offset + variant]
    });
    return { commonStatus: this.recordCommonStatus[at],
      commonRelation: this.recordCommonRelation[at], variants };
  }

  totalHotAllocationCount() {
    let count = this.hotAllocationCount;
    for (const policy of this.policies) count += policy.hotAllocationCount || 0;
    return count;
  }

  summary() {
    const variants = [];
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) variants.push({
      name: MOVE_VARIANT_NAME[variant], totalNodes: this.totalNodes[variant],
      variantTransitionCount:
        this.kernels[variant]?.variantTransitionCount || 0,
      contestKindCount: this.kernels[variant] ?
        Array.from(this.kernels[variant].contestKindCount) : [],
      relationCount: { incomplete:
          this.relationCount[variant * 4 + PAIR_RELATION.INCOMPLETE],
        candidateHigher:
          this.relationCount[variant * 4 + PAIR_RELATION.CANDIDATE_HIGHER],
        equal: this.relationCount[variant * 4 + PAIR_RELATION.EQUAL],
        candidateLower:
          this.relationCount[variant * 4 + PAIR_RELATION.CANDIDATE_LOWER] } });
    return { diagnosticOnly: true, actionOwnership: false,
      attemptCount: this.attemptCount,
      completeAcrossVariantsCount: this.completeAcrossVariantsCount,
      incompleteCount: this.incompleteCount, agreementCount: this.agreementCount,
      disagreementCount: this.disagreementCount,
      rootRestoreFailureCount: this.rootRestoreFailureCount, variants,
      hotAllocationCount: this.totalHotAllocationCount() };
  }
}

module.exports = { MOVE_VARIANTS, MOVE_VARIANT_NAME, VARIANT_COUNT,
  ROOT_CAPACITY, VARIANT_COMMON_STATUS, isJointMovementGap, commonStatus,
  SemanticAttackDepth3MoveVariantShadow };
