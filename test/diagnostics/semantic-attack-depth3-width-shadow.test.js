"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PAIR_RELATION, PAIR_SUPPORT_REASON } = require(
  "../../tools/agentank/diagnostics/native-attack-pose-policy-search-poc");
const { WIDTH_LANE, SemanticAttackDepth3WidthShadow } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-width-shadow");

test("width ladder changes only deep width and final lane budget", () => {
  const calls = []; let resets = 0;
  const policy = { pairedDepth: 0, nodeBudget: 0, hotAllocationCount: 0,
    rootRestoreFailureCount: 0,
    searchEngine: { diagnosticDeepExpansionLimit: 0, hotAllocationCount: 0,
      cacheBank: { beginMatch() { resets += 1; } } },
    baselineSearch: { diagnosticDeepExpansionLimit: 0, hotAllocationCount: 0,
      cacheBank: { beginMatch() { resets += 1; } } },
    lastBaselineValue: 0, lastBestValue: 0,
    lastBaselineNodes: 0, lastCandidateNodes: 0,
    lastBaselineReasonMask: 0, lastCandidateReasonMask: 0,
    comparePair() {
      const width = this.searchEngine.diagnosticDeepExpansionLimit;
      calls.push([this.pairedDepth, width, this.nodeBudget]);
      this.lastBaselineNodes = width * 10;
      this.lastCandidateNodes = width * 11;
      this.lastBaselineReasonMask = width === 2 ?
        PAIR_SUPPORT_REASON.WIDTH : 0;
      this.lastCandidateReasonMask = 0;
      this.lastBaselineValue = 10; this.lastBestValue = width === 3 ? 11 : 10;
      return width === 2 ? PAIR_RELATION.INCOMPLETE : width === 3 ?
        PAIR_RELATION.CANDIDATE_HIGHER : PAIR_RELATION.EQUAL;
    } };
  const shadow = new SemanticAttackDepth3WidthShadow({}, { policy });
  shadow.evaluate({ depthSearch: {} }, {}, 2, 0, 1, new Uint8Array(2));
  assert.deepEqual(calls, [[3, 2, 2048], [3, 3, 2048], [3, 4, 2048],
    [3, 4, 4096]]);
  assert.equal(shadow.lastRelation[WIDTH_LANE.W2_B2048],
    PAIR_RELATION.INCOMPLETE);
  assert.equal(shadow.summary().lanes[0].baselineReasonBits.WIDTH, 1);
  assert.equal(shadow.summary().lanes[1].relationCount.candidateHigher, 1);
  assert.equal(shadow.summary().hotAllocationCount, 0);
  assert.equal(resets, 8);
});
