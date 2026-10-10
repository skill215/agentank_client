"use strict";

// BP131 keeps depth and fixed-pair identity constant while varying only the
// representative width and, in the final lane, node capacity.

const { NativeAttackPosePolicySearchPoc, PAIR_RELATION,
  PAIR_SUPPORT_REASON, DIAGNOSTIC_ACTION_CAPACITY,
  DIAGNOSTIC_FAST_STATUS_CAPACITY, DIAGNOSTIC_HARD_STATUS_CAPACITY,
  DIAGNOSTIC_FAST_REASON_CAPACITY, DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY,
  DIAGNOSTIC_DEPTH_CAPACITY } = require(
  "./native-attack-pose-policy-search-poc");

const WIDTH_LANE = Object.freeze({ W2_B2048: 0, W3_B2048: 1,
  W4_B2048: 2, W4_B4096: 3, COUNT: 4 });
const WIDTH_LANE_NAME = Object.freeze([
  "D3_W2_B2048", "D3_W3_B2048", "D3_W4_B2048", "D3_W4_B4096"
]);
const WIDTH = Object.freeze([2, 3, 4, 4]);
const NODE_BUDGET = Object.freeze([2048, 2048, 2048, 4096]);
const REASON_BIT_COUNT = 11;
const TRANSITION_DETAIL_FIELD = Object.freeze({ OUTER_FAST_COUNT: 0,
  HARD_INTERNAL_FAST_COUNT: 1, HARD_INCOMPLETE_COUNT: 2,
  FIRST_FAST_STATUS: 3, FIRST_FAST_REASON: 4, FIRST_FAST_DETAIL: 5,
  FIRST_FAST_INSIDE_HARD: 6, FIRST_FAST_ACTION0: 7, FIRST_FAST_ACTION1: 8,
  FIRST_FAST_ARGUMENT0: 9, FIRST_FAST_ARGUMENT1: 10,
  FIRST_FAST_CHANCE0: 11, FIRST_FAST_CHANCE1: 12, FIRST_FAST_PLY: 13,
  FIRST_HARD_ACTION0: 14, FIRST_HARD_ACTION1: 15,
  FIRST_HARD_ARGUMENT0: 16, FIRST_HARD_ARGUMENT1: 17,
  FIRST_HARD_CHANCE0: 18, FIRST_HARD_CHANCE1: 19, FIRST_HARD_PLY: 20,
  DOMINANT_OUTER_FAST_PAIR: 21, DOMINANT_OUTER_FAST_COUNT: 22,
  DOMINANT_INTERNAL_FAST_PAIR: 23, DOMINANT_INTERNAL_FAST_COUNT: 24,
  DOMINANT_HARD_PAIR: 25, DOMINANT_HARD_COUNT: 26,
  FIRST_HARD_VIABLE_CODE: 27, FIRST_HARD_HAZARD_COMPLETE: 28,
  FIRST_HARD_NARROW_PROOF_COMPLETE: 29, FIRST_HARD_HORIZON_TICK: 30,
  FIRST_HARD_SHIELD_ESCAPE: 31, FIRST_HARD_BOOST_ESCAPE: 32,
  FIRST_HARD_TELEPORT_ESCAPE: 33, FIRST_FAST_START_CELL0: 34,
  FIRST_FAST_START_CELL1: 35, FIRST_FAST_PREPARED_TARGET0: 36,
  FIRST_FAST_PREPARED_TARGET1: 37,
  FIRST_FAST_CONFIRMED_VACATING_MASK: 38,
  FIRST_FAST_EFFECT_MASK0: 39, FIRST_FAST_EFFECT_MASK1: 40, COUNT: 41 });

class SemanticAttackDepth3WidthShadow {
  constructor(runtimeConfig, options = {}) {
    this.policy = options.policy || new NativeAttackPosePolicySearchPoc(
      runtimeConfig, { nodeBudget: 4096, pairedDepth: 3,
        commonContinuation: true, deepExpansionLimit: 4 });
    this.lastComplete = new Uint8Array(WIDTH_LANE.COUNT);
    this.lastRelation = new Uint8Array(WIDTH_LANE.COUNT);
    this.lastBaselineValue = new Int32Array(WIDTH_LANE.COUNT);
    this.lastCandidateValue = new Int32Array(WIDTH_LANE.COUNT);
    this.lastBaselineNodes = new Uint16Array(WIDTH_LANE.COUNT);
    this.lastCandidateNodes = new Uint16Array(WIDTH_LANE.COUNT);
    this.lastBaselineReasonMask = new Uint16Array(WIDTH_LANE.COUNT);
    this.lastCandidateReasonMask = new Uint16Array(WIDTH_LANE.COUNT);
    this.completeCount = new Uint32Array(WIDTH_LANE.COUNT);
    this.incompleteCount = new Uint32Array(WIDTH_LANE.COUNT);
    this.relationCount = new Uint32Array(WIDTH_LANE.COUNT * 4);
    this.baselineNodeTotal = new Uint32Array(WIDTH_LANE.COUNT);
    this.candidateNodeTotal = new Uint32Array(WIDTH_LANE.COUNT);
    this.maximumNodes = new Uint16Array(WIDTH_LANE.COUNT);
    this.baselineReasonBitCount = new Uint32Array(WIDTH_LANE.COUNT *
      REASON_BIT_COUNT);
    this.candidateReasonBitCount = new Uint32Array(WIDTH_LANE.COUNT *
      REASON_BIT_COUNT);
    this.lastBaselineTransitionDetail = new Uint16Array(
      TRANSITION_DETAIL_FIELD.COUNT);
    this.lastCandidateTransitionDetail = new Uint16Array(
      TRANSITION_DETAIL_FIELD.COUNT);
    this.lastBaselineFastStatusCounts = new Uint16Array(
      DIAGNOSTIC_FAST_STATUS_CAPACITY * 2);
    this.lastCandidateFastStatusCounts = new Uint16Array(
      DIAGNOSTIC_FAST_STATUS_CAPACITY * 2);
    this.lastBaselineFastReasonCounts = new Uint16Array(
      DIAGNOSTIC_FAST_REASON_CAPACITY * 2);
    this.lastCandidateFastReasonCounts = new Uint16Array(
      DIAGNOSTIC_FAST_REASON_CAPACITY * 2);
    this.lastBaselineRelocationDetailCounts = new Uint16Array(
      DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY * 2);
    this.lastCandidateRelocationDetailCounts = new Uint16Array(
      DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY * 2);
    this.lastBaselineHardStatusCounts = new Uint16Array(
      DIAGNOSTIC_HARD_STATUS_CAPACITY);
    this.lastCandidateHardStatusCounts = new Uint16Array(
      DIAGNOSTIC_HARD_STATUS_CAPACITY);
    this.lastBaselineFastFailureByDepth = new Uint16Array(
      DIAGNOSTIC_DEPTH_CAPACITY * 2);
    this.lastCandidateFastFailureByDepth = new Uint16Array(
      DIAGNOSTIC_DEPTH_CAPACITY * 2);
    this.lastBaselineHardIncompleteByDepth = new Uint16Array(
      DIAGNOSTIC_DEPTH_CAPACITY);
    this.lastCandidateHardIncompleteByDepth = new Uint16Array(
      DIAGNOSTIC_DEPTH_CAPACITY);
    this.evaluationCount = 0; this.hotAllocationCount = 0;
  }

  resetTransitionDetail() {
    this.lastBaselineTransitionDetail.fill(0);
    this.lastCandidateTransitionDetail.fill(0);
    this.lastBaselineFastStatusCounts.fill(0);
    this.lastCandidateFastStatusCounts.fill(0);
    this.lastBaselineFastReasonCounts.fill(0);
    this.lastCandidateFastReasonCounts.fill(0);
    this.lastBaselineRelocationDetailCounts.fill(0);
    this.lastCandidateRelocationDetailCounts.fill(0);
    this.lastBaselineHardStatusCounts.fill(0);
    this.lastCandidateHardStatusCounts.fill(0);
    this.lastBaselineFastFailureByDepth.fill(0);
    this.lastCandidateFastFailureByDepth.fill(0);
    this.lastBaselineHardIncompleteByDepth.fill(0);
    this.lastCandidateHardIncompleteByDepth.fill(0);
  }

  captureTransitionDetail(search, detail, fastStatus, fastReason, relocation,
      hardStatus, fastDepth, hardDepth) {
    if (!search?.diagnosticFastStatusCounts) return;
    fastStatus.set(search.diagnosticFastStatusCounts);
    fastReason.set(search.diagnosticFastReasonCounts);
    relocation.set(search.diagnosticRelocationDetailCounts);
    hardStatus.set(search.diagnosticHardStatusCounts);
    let outerFast = 0; let internalFast = 0; let hardIncomplete = 0;
    for (let status = 0; status < DIAGNOSTIC_FAST_STATUS_CAPACITY; status += 1) {
      outerFast += search.diagnosticFastStatusCounts[status];
      internalFast += search.diagnosticFastStatusCounts[
        DIAGNOSTIC_FAST_STATUS_CAPACITY + status];
    }
    hardIncomplete = search.diagnosticHardStatusCounts[3] | 0;
    detail[TRANSITION_DETAIL_FIELD.OUTER_FAST_COUNT] = outerFast;
    detail[TRANSITION_DETAIL_FIELD.HARD_INTERNAL_FAST_COUNT] = internalFast;
    detail[TRANSITION_DETAIL_FIELD.HARD_INCOMPLETE_COUNT] = hardIncomplete;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_STATUS] =
      search.diagnosticFirstFastStatus | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_REASON] =
      search.diagnosticFirstFastReason | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_DETAIL] =
      search.diagnosticFirstFastDetail | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_INSIDE_HARD] =
      search.diagnosticFirstFastInsideHard | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_ACTION0] =
      search.diagnosticFirstFastAction0 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_ACTION1] =
      search.diagnosticFirstFastAction1 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_ARGUMENT0] =
      search.diagnosticFirstFastArgument0 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_ARGUMENT1] =
      search.diagnosticFirstFastArgument1 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_CHANCE0] =
      search.diagnosticFirstFastChance0 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_CHANCE1] =
      search.diagnosticFirstFastChance1 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_PLY] =
      search.diagnosticFirstFastPly | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_START_CELL0] =
      search.diagnosticFirstFastStartCell0 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_START_CELL1] =
      search.diagnosticFirstFastStartCell1 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_PREPARED_TARGET0] =
      search.diagnosticFirstFastPreparedTarget0 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_PREPARED_TARGET1] =
      search.diagnosticFirstFastPreparedTarget1 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_CONFIRMED_VACATING_MASK] =
      search.diagnosticFirstFastConfirmedVacatingMask | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_EFFECT_MASK0] =
      search.diagnosticFirstFastEffectMask0 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_EFFECT_MASK1] =
      search.diagnosticFirstFastEffectMask1 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_ACTION0] =
      search.diagnosticFirstHardAction0 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_ACTION1] =
      search.diagnosticFirstHardAction1 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_ARGUMENT0] =
      search.diagnosticFirstHardArgument0 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_ARGUMENT1] =
      search.diagnosticFirstHardArgument1 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_CHANCE0] =
      search.diagnosticFirstHardChance0 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_CHANCE1] =
      search.diagnosticFirstHardChance1 | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_PLY] =
      search.diagnosticFirstHardPly | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_VIABLE_CODE] =
      search.diagnosticFirstHardViableCode | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_HAZARD_COMPLETE] =
      search.diagnosticFirstHardHazardComplete | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_NARROW_PROOF_COMPLETE] =
      search.diagnosticFirstHardNarrowProofComplete | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_HORIZON_TICK] =
      search.diagnosticFirstHardHorizonTick | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_SHIELD_ESCAPE] =
      search.diagnosticFirstHardShieldEscape | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_BOOST_ESCAPE] =
      search.diagnosticFirstHardBoostEscape | 0;
    detail[TRANSITION_DETAIL_FIELD.FIRST_HARD_TELEPORT_ESCAPE] =
      search.diagnosticFirstHardTeleportEscape | 0;
    let outerPair = 0; let outerCount = 0; let internalPair = 0;
    let internalCount = 0; let hardPair = 0; let hardCount = 0;
    const pairCount = DIAGNOSTIC_ACTION_CAPACITY * DIAGNOSTIC_ACTION_CAPACITY;
    for (let pair = 0; pair < pairCount; pair += 1) {
      const outer = search.diagnosticFastActionPairCounts[pair];
      const internal = search.diagnosticFastActionPairCounts[pairCount + pair];
      const hard = search.diagnosticHardIncompleteActionPairCounts[pair];
      if (outer > outerCount) { outerCount = outer; outerPair = pair; }
      if (internal > internalCount) { internalCount = internal; internalPair = pair; }
      if (hard > hardCount) { hardCount = hard; hardPair = pair; }
    }
    detail[TRANSITION_DETAIL_FIELD.DOMINANT_OUTER_FAST_PAIR] = outerPair;
    detail[TRANSITION_DETAIL_FIELD.DOMINANT_OUTER_FAST_COUNT] = outerCount;
    detail[TRANSITION_DETAIL_FIELD.DOMINANT_INTERNAL_FAST_PAIR] = internalPair;
    detail[TRANSITION_DETAIL_FIELD.DOMINANT_INTERNAL_FAST_COUNT] = internalCount;
    detail[TRANSITION_DETAIL_FIELD.DOMINANT_HARD_PAIR] = hardPair;
    detail[TRANSITION_DETAIL_FIELD.DOMINANT_HARD_COUNT] = hardCount;
    for (let phase = 0; phase < 2; phase += 1)
      for (let depth = 0; depth < DIAGNOSTIC_DEPTH_CAPACITY; depth += 1) {
        let count = 0;
        const offset = (phase * DIAGNOSTIC_DEPTH_CAPACITY + depth) *
          DIAGNOSTIC_FAST_STATUS_CAPACITY;
        for (let status = 0; status < DIAGNOSTIC_FAST_STATUS_CAPACITY; status += 1)
          count += search.diagnosticFastDepthStatusCounts[offset + status];
        fastDepth[phase * DIAGNOSTIC_DEPTH_CAPACITY + depth] = count;
      }
    for (let depth = 0; depth < DIAGNOSTIC_DEPTH_CAPACITY; depth += 1)
      hardDepth[depth] = search.diagnosticHardDepthStatusCounts[depth *
        DIAGNOSTIC_HARD_STATUS_CAPACITY + 3];
  }

  countReasonBits(target, lane, mask) {
    for (let bit = 0; bit < REASON_BIT_COUNT; bit += 1)
      if (mask & (1 << bit)) target[lane * REASON_BIT_COUNT + bit] += 1;
  }

  evaluate(engine, pose, count, current, candidate, allowedRows) {
    this.evaluationCount += 1;
    this.lastComplete.fill(0); this.lastRelation.fill(0);
    this.lastBaselineValue.fill(0); this.lastCandidateValue.fill(0);
    this.lastBaselineNodes.fill(0); this.lastCandidateNodes.fill(0);
    this.lastBaselineReasonMask.fill(0); this.lastCandidateReasonMask.fill(0);
    this.resetTransitionDetail();
    for (let lane = 0; lane < WIDTH_LANE.COUNT; lane += 1) {
      if (typeof this.policy.searchEngine?.cacheBank?.beginMatch === "function")
        this.policy.searchEngine.cacheBank.beginMatch();
      if (typeof this.policy.baselineSearch?.cacheBank?.beginMatch === "function")
        this.policy.baselineSearch.cacheBank.beginMatch();
      this.policy.pairedDepth = 3;
      this.policy.nodeBudget = NODE_BUDGET[lane];
      if (this.policy.searchEngine)
        this.policy.searchEngine.diagnosticDeepExpansionLimit = WIDTH[lane];
      if (this.policy.baselineSearch)
        this.policy.baselineSearch.diagnosticDeepExpansionLimit = WIDTH[lane];
      const relation = this.policy.comparePair(engine, pose, count,
        engine.depthSearch, current, candidate, allowedRows);
      if (lane === WIDTH_LANE.W4_B4096) {
        this.captureTransitionDetail(this.policy.baselineSearch,
          this.lastBaselineTransitionDetail,
          this.lastBaselineFastStatusCounts,
          this.lastBaselineFastReasonCounts,
          this.lastBaselineRelocationDetailCounts,
          this.lastBaselineHardStatusCounts,
          this.lastBaselineFastFailureByDepth,
          this.lastBaselineHardIncompleteByDepth);
        if (this.policy.lastCandidateNodes > 0)
          this.captureTransitionDetail(this.policy.searchEngine,
            this.lastCandidateTransitionDetail,
            this.lastCandidateFastStatusCounts,
            this.lastCandidateFastReasonCounts,
            this.lastCandidateRelocationDetailCounts,
            this.lastCandidateHardStatusCounts,
            this.lastCandidateFastFailureByDepth,
            this.lastCandidateHardIncompleteByDepth);
      }
      this.lastRelation[lane] = relation;
      this.relationCount[lane * 4 + relation] += 1;
      this.lastBaselineNodes[lane] = this.policy.lastBaselineNodes;
      this.lastCandidateNodes[lane] = this.policy.lastCandidateNodes;
      this.lastBaselineReasonMask[lane] = this.policy.lastBaselineReasonMask;
      this.lastCandidateReasonMask[lane] = this.policy.lastCandidateReasonMask;
      this.countReasonBits(this.baselineReasonBitCount, lane,
        this.policy.lastBaselineReasonMask);
      this.countReasonBits(this.candidateReasonBitCount, lane,
        this.policy.lastCandidateReasonMask);
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

  reasonBits(source, lane) {
    const output = {};
    for (const [name, mask] of Object.entries(PAIR_SUPPORT_REASON)) {
      if (!mask) continue;
      const bit = 31 - Math.clz32(mask);
      output[name] = source[lane * REASON_BIT_COUNT + bit] || 0;
    }
    return output;
  }

  totalHotAllocationCount() {
    return this.hotAllocationCount + (this.policy.hotAllocationCount || 0) +
      (this.policy.searchEngine?.hotAllocationCount || 0) +
      (this.policy.baselineSearch?.hotAllocationCount || 0);
  }

  summary() {
    const lanes = [];
    for (let lane = 0; lane < WIDTH_LANE.COUNT; lane += 1) lanes.push({
      name: WIDTH_LANE_NAME[lane], depth: 3, width: WIDTH[lane],
      nodeBudget: NODE_BUDGET[lane], completeCount: this.completeCount[lane],
      incompleteCount: this.incompleteCount[lane], relationCount: {
        incomplete: this.relationCount[lane * 4 + PAIR_RELATION.INCOMPLETE],
        candidateHigher:
          this.relationCount[lane * 4 + PAIR_RELATION.CANDIDATE_HIGHER],
        equal: this.relationCount[lane * 4 + PAIR_RELATION.EQUAL],
        candidateLower:
          this.relationCount[lane * 4 + PAIR_RELATION.CANDIDATE_LOWER]
      }, baselineNodeTotal: this.baselineNodeTotal[lane],
      candidateNodeTotal: this.candidateNodeTotal[lane],
      maximumNodes: this.maximumNodes[lane],
      baselineReasonBits: this.reasonBits(this.baselineReasonBitCount, lane),
      candidateReasonBits: this.reasonBits(this.candidateReasonBitCount, lane)
    });
    return { evaluationCount: this.evaluationCount, lanes,
      rootRestoreFailureCount: this.policy.rootRestoreFailureCount,
      hotAllocationCount: this.totalHotAllocationCount() };
  }
}

module.exports = { WIDTH_LANE, WIDTH_LANE_NAME, WIDTH, NODE_BUDGET,
  TRANSITION_DETAIL_FIELD, SemanticAttackDepth3WidthShadow };
