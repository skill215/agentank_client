"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PAIR_RELATION } = require(
  "../../tools/agentank/diagnostics/native-attack-pose-policy-search-poc");
const { DEPTH_LANE, SemanticAttackDepthStabilityShadow } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth-stability-shadow");

test("depth ladder reuses one fixed-pair evaluator and preserves lane identity", () => {
  const calls = []; let cacheResets = 0;
  const policy = { pairedDepth: 0, nodeBudget: 0, hotAllocationCount: 0,
    rootRestoreFailureCount: 0,
    searchEngine: { cacheBank: { beginMatch() { cacheResets += 1; } } },
    baselineSearch: { cacheBank: { beginMatch() { cacheResets += 1; } } },
    lastBaselineValue: 0, lastBestValue: 0,
    lastBaselineNodes: 0, lastCandidateNodes: 0,
    lastBaselineReasonMask: 0, lastCandidateReasonMask: 0,
    lastBaselineCompletedDepth: 0, lastCandidateCompletedDepth: 0,
    lastBaselineSupportDepth: 0, lastCandidateSupportDepth: 0,
    lastBaselineTruncatedCount: 0, lastCandidateTruncatedCount: 0,
    lastBaselineIncompleteTransitions: 0,
    lastCandidateIncompleteTransitions: 0,
    lastBaselineInterrupted: 0, lastCandidateInterrupted: 0,
    lastBaselineAbortReason: 0, lastCandidateAbortReason: 0,
    comparePair(engine, pose, count, source, current, candidate) {
      calls.push([this.pairedDepth, this.nodeBudget, current, candidate]);
      this.lastBaselineValue = this.pairedDepth * 10;
      this.lastBestValue = this.lastBaselineValue + (this.pairedDepth - 1);
      this.lastBaselineNodes = this.pairedDepth;
      this.lastCandidateNodes = this.pairedDepth + 1;
      return this.pairedDepth === 1 ? PAIR_RELATION.EQUAL :
        PAIR_RELATION.CANDIDATE_HIGHER;
    } };
  const shadow = new SemanticAttackDepthStabilityShadow({}, { policy });
  const engine = { depthSearch: {} };
  shadow.evaluate(engine, {}, 4, 1, 3, new Uint8Array(4));
  assert.deepEqual(calls, [[1, 2048, 1, 3], [2, 256, 1, 3],
    [2, 2048, 1, 3], [3, 2048, 1, 3]]);
  assert.equal(shadow.lastRelation[DEPTH_LANE.D1_B2048],
    PAIR_RELATION.EQUAL);
  assert.equal(shadow.lastRelation[DEPTH_LANE.D3_B2048],
    PAIR_RELATION.CANDIDATE_HIGHER);
  assert.equal(shadow.summary().evaluationCount, 1);
  assert.equal(shadow.summary().lanes[3].maximumNodes, 7);
  assert.equal(shadow.summary().hotAllocationCount, 0);
  assert.equal(cacheResets, 8);
});

test("incomplete lanes still account attempted nodes", () => {
  const policy = { pairedDepth: 0, nodeBudget: 0, hotAllocationCount: 0,
    rootRestoreFailureCount: 0, searchEngine: {}, baselineSearch: {},
    lastBaselineValue: 0, lastBestValue: 0,
    lastBaselineNodes: 0, lastCandidateNodes: 0,
    lastBaselineReasonMask: 0, lastCandidateReasonMask: 0,
    lastBaselineCompletedDepth: 0, lastCandidateCompletedDepth: 0,
    lastBaselineSupportDepth: 0, lastCandidateSupportDepth: 0,
    lastBaselineTruncatedCount: 0, lastCandidateTruncatedCount: 0,
    lastBaselineIncompleteTransitions: 0,
    lastCandidateIncompleteTransitions: 0,
    lastBaselineInterrupted: 0, lastCandidateInterrupted: 0,
    lastBaselineAbortReason: 0, lastCandidateAbortReason: 0,
    comparePair() {
      this.lastBaselineNodes = 17; this.lastCandidateNodes = 31;
      this.lastBaselineReasonMask = 160;
      return PAIR_RELATION.INCOMPLETE;
    } };
  const shadow = new SemanticAttackDepthStabilityShadow({}, { policy });
  shadow.evaluate({ depthSearch: {} }, {}, 2, 0, 1, new Uint8Array(2));
  const lane = shadow.summary().lanes[DEPTH_LANE.D3_B2048];
  assert.equal(lane.incompleteCount, 1);
  assert.equal(lane.baselineNodeTotal, 17);
  assert.equal(lane.candidateNodeTotal, 31);
  assert.equal(lane.maximumNodes, 48);
  assert.equal(shadow.summary().reasons[DEPTH_LANE.D3_B2048].baseline[160], 1);
});
