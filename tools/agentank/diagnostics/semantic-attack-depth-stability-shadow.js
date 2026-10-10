"use strict";

// BP129 compares one incumbent/candidate pair under a preregistered horizon
// ladder.  A single maximum-capacity search pair is reused across lanes, so
// deeper diagnostics do not multiply the resident search state.

const { NativeAttackPosePolicySearchPoc, PAIR_RELATION,
  PAIR_REASON_CAPACITY } = require(
  "./native-attack-pose-policy-search-poc");

const DEPTH_LANE = Object.freeze({ D1_B2048: 0, D2_B256: 1,
  D2_B2048: 2, D3_B2048: 3, COUNT: 4 });
const DEPTH_LANE_NAME = Object.freeze([
  "D1_B2048", "D2_B256", "D2_B2048", "D3_B2048"
]);
const DEPTH = Object.freeze([1, 2, 2, 3]);
const NODE_BUDGET = Object.freeze([2048, 256, 2048, 2048]);

class SemanticAttackDepthStabilityShadow {
  constructor(runtimeConfig, options = {}) {
    this.policy = options.policy || new NativeAttackPosePolicySearchPoc(
      runtimeConfig, { nodeBudget: 2048, pairedDepth: 3,
        commonContinuation: true });
    this.lastComplete = new Uint8Array(DEPTH_LANE.COUNT);
    this.lastRelation = new Uint8Array(DEPTH_LANE.COUNT);
    this.lastBaselineValue = new Int32Array(DEPTH_LANE.COUNT);
    this.lastCandidateValue = new Int32Array(DEPTH_LANE.COUNT);
    this.lastBaselineNodes = new Uint16Array(DEPTH_LANE.COUNT);
    this.lastCandidateNodes = new Uint16Array(DEPTH_LANE.COUNT);
    this.lastBaselineReasonMask = new Uint16Array(DEPTH_LANE.COUNT);
    this.lastCandidateReasonMask = new Uint16Array(DEPTH_LANE.COUNT);
    this.lastBaselineCompletedDepth = new Uint8Array(DEPTH_LANE.COUNT);
    this.lastCandidateCompletedDepth = new Uint8Array(DEPTH_LANE.COUNT);
    this.lastBaselineSupportDepth = new Uint8Array(DEPTH_LANE.COUNT);
    this.lastCandidateSupportDepth = new Uint8Array(DEPTH_LANE.COUNT);
    this.lastBaselineTruncatedCount = new Uint8Array(DEPTH_LANE.COUNT);
    this.lastCandidateTruncatedCount = new Uint8Array(DEPTH_LANE.COUNT);
    this.lastBaselineIncompleteTransitions = new Uint16Array(DEPTH_LANE.COUNT);
    this.lastCandidateIncompleteTransitions = new Uint16Array(DEPTH_LANE.COUNT);
    this.lastBaselineInterrupted = new Uint8Array(DEPTH_LANE.COUNT);
    this.lastCandidateInterrupted = new Uint8Array(DEPTH_LANE.COUNT);
    this.lastBaselineAbortReason = new Uint8Array(DEPTH_LANE.COUNT);
    this.lastCandidateAbortReason = new Uint8Array(DEPTH_LANE.COUNT);
    this.completeCount = new Uint32Array(DEPTH_LANE.COUNT);
    this.incompleteCount = new Uint32Array(DEPTH_LANE.COUNT);
    this.relationCount = new Uint32Array(DEPTH_LANE.COUNT * 4);
    this.baselineNodeTotal = new Uint32Array(DEPTH_LANE.COUNT);
    this.candidateNodeTotal = new Uint32Array(DEPTH_LANE.COUNT);
    this.maximumNodes = new Uint16Array(DEPTH_LANE.COUNT);
    this.baselineReasonCount = new Uint32Array(DEPTH_LANE.COUNT *
      PAIR_REASON_CAPACITY);
    this.candidateReasonCount = new Uint32Array(DEPTH_LANE.COUNT *
      PAIR_REASON_CAPACITY);
    this.evaluationCount = 0; this.hotAllocationCount = 0;
  }

  evaluate(engine, pose, count, current, candidate, allowedRows) {
    this.evaluationCount += 1;
    this.lastComplete.fill(0); this.lastRelation.fill(0);
    this.lastBaselineValue.fill(0); this.lastCandidateValue.fill(0);
    this.lastBaselineNodes.fill(0); this.lastCandidateNodes.fill(0);
    this.lastBaselineReasonMask.fill(0); this.lastCandidateReasonMask.fill(0);
    this.lastBaselineCompletedDepth.fill(0);
    this.lastCandidateCompletedDepth.fill(0);
    this.lastBaselineSupportDepth.fill(0); this.lastCandidateSupportDepth.fill(0);
    this.lastBaselineTruncatedCount.fill(0);
    this.lastCandidateTruncatedCount.fill(0);
    this.lastBaselineIncompleteTransitions.fill(0);
    this.lastCandidateIncompleteTransitions.fill(0);
    this.lastBaselineInterrupted.fill(0); this.lastCandidateInterrupted.fill(0);
    this.lastBaselineAbortReason.fill(0); this.lastCandidateAbortReason.fill(0);
    for (let lane = 0; lane < DEPTH_LANE.COUNT; lane += 1) {
      // Each lane gets a fresh TT generation.  The search arrays are reused,
      // but shallower lanes must not warm deeper-lane work measurements.
      if (typeof this.policy.searchEngine?.cacheBank?.beginMatch === "function")
        this.policy.searchEngine.cacheBank.beginMatch();
      if (typeof this.policy.baselineSearch?.cacheBank?.beginMatch === "function")
        this.policy.baselineSearch.cacheBank.beginMatch();
      this.policy.pairedDepth = DEPTH[lane];
      this.policy.nodeBudget = NODE_BUDGET[lane];
      const relation = this.policy.comparePair(engine, pose, count,
        engine.depthSearch, current, candidate, allowedRows);
      this.lastRelation[lane] = relation;
      this.relationCount[lane * 4 + relation] += 1;
      this.lastBaselineNodes[lane] = this.policy.lastBaselineNodes;
      this.lastCandidateNodes[lane] = this.policy.lastCandidateNodes;
      this.lastBaselineReasonMask[lane] = this.policy.lastBaselineReasonMask;
      this.lastCandidateReasonMask[lane] = this.policy.lastCandidateReasonMask;
      this.lastBaselineCompletedDepth[lane] =
        this.policy.lastBaselineCompletedDepth;
      this.lastCandidateCompletedDepth[lane] =
        this.policy.lastCandidateCompletedDepth;
      this.lastBaselineSupportDepth[lane] = this.policy.lastBaselineSupportDepth;
      this.lastCandidateSupportDepth[lane] = this.policy.lastCandidateSupportDepth;
      this.lastBaselineTruncatedCount[lane] =
        this.policy.lastBaselineTruncatedCount;
      this.lastCandidateTruncatedCount[lane] =
        this.policy.lastCandidateTruncatedCount;
      this.lastBaselineIncompleteTransitions[lane] =
        this.policy.lastBaselineIncompleteTransitions;
      this.lastCandidateIncompleteTransitions[lane] =
        this.policy.lastCandidateIncompleteTransitions;
      this.lastBaselineInterrupted[lane] = this.policy.lastBaselineInterrupted;
      this.lastCandidateInterrupted[lane] = this.policy.lastCandidateInterrupted;
      this.lastBaselineAbortReason[lane] = this.policy.lastBaselineAbortReason;
      this.lastCandidateAbortReason[lane] = this.policy.lastCandidateAbortReason;
      this.baselineReasonCount[lane * PAIR_REASON_CAPACITY +
        this.policy.lastBaselineReasonMask] += 1;
      this.candidateReasonCount[lane * PAIR_REASON_CAPACITY +
        this.policy.lastCandidateReasonMask] += 1;
      this.baselineNodeTotal[lane] += this.policy.lastBaselineNodes;
      this.candidateNodeTotal[lane] += this.policy.lastCandidateNodes;
      const nodes = this.policy.lastBaselineNodes +
        this.policy.lastCandidateNodes;
      if (nodes > this.maximumNodes[lane]) this.maximumNodes[lane] = nodes;
      if (relation === PAIR_RELATION.INCOMPLETE) {
        this.incompleteCount[lane] += 1; continue;
      }
      this.lastComplete[lane] = 1; this.completeCount[lane] += 1;
      this.lastBaselineValue[lane] = this.policy.lastBaselineValue;
      this.lastCandidateValue[lane] = this.policy.lastBestValue;
    }
  }

  totalHotAllocationCount() {
    return this.hotAllocationCount + (this.policy.hotAllocationCount || 0) +
      (this.policy.searchEngine?.hotAllocationCount || 0) +
      (this.policy.baselineSearch?.hotAllocationCount || 0);
  }

  summary() {
    const lanes = [];
    for (let lane = 0; lane < DEPTH_LANE.COUNT; lane += 1) lanes.push({
      name: DEPTH_LANE_NAME[lane], depth: DEPTH[lane],
      nodeBudget: NODE_BUDGET[lane], completeCount: this.completeCount[lane],
      incompleteCount: this.incompleteCount[lane],
      relationCount: {
        incomplete: this.relationCount[lane * 4 + PAIR_RELATION.INCOMPLETE],
        candidateHigher:
          this.relationCount[lane * 4 + PAIR_RELATION.CANDIDATE_HIGHER],
        equal: this.relationCount[lane * 4 + PAIR_RELATION.EQUAL],
        candidateLower:
          this.relationCount[lane * 4 + PAIR_RELATION.CANDIDATE_LOWER]
      },
      baselineNodeTotal: this.baselineNodeTotal[lane],
      candidateNodeTotal: this.candidateNodeTotal[lane],
      maximumNodes: this.maximumNodes[lane]
    });
    const reasons = [];
    for (let lane = 0; lane < DEPTH_LANE.COUNT; lane += 1) {
      const baseline = {}; const candidate = {};
      for (let mask = 0; mask < PAIR_REASON_CAPACITY; mask += 1) {
        const b = this.baselineReasonCount[lane * PAIR_REASON_CAPACITY + mask];
        const c = this.candidateReasonCount[lane * PAIR_REASON_CAPACITY + mask];
        if (b) baseline[mask] = b;
        if (c) candidate[mask] = c;
      }
      reasons.push({ name: DEPTH_LANE_NAME[lane], baseline, candidate });
    }
    return { evaluationCount: this.evaluationCount, lanes, reasons,
      rootRestoreFailureCount: this.policy.rootRestoreFailureCount,
      hotAllocationCount: this.totalHotAllocationCount() };
  }
}

module.exports = { DEPTH_LANE, DEPTH_LANE_NAME, DEPTH, NODE_BUDGET,
  SemanticAttackDepthStabilityShadow };
