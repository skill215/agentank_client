"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PAIR_RELATION } = require(
  "../../tools/agentank/diagnostics/native-attack-pose-policy-search-poc");
const { VARIANT_COMMON_STATUS } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-move-variant-shadow");
const { summarize, aggregateRuntime, exactLane } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-leaf-backup-report");

function lane(name, relation) {
  return { name, commonStatus: VARIANT_COMMON_STATUS.AGREEMENT,
    commonRelation: relation, variants: [] };
}

test("BP135 summary keeps leaf causality separate from backup semantics", () => {
  const backup = [0, 1, 2].map(index => ({ name: String(index), enemyCount: 3,
    baselineMean: 4, candidateMean: 5,
    meanRelation: PAIR_RELATION.CANDIDATE_HIGHER,
    columnHigher: 2, columnEqual: 0, columnLower: 1 }));
  const value = summarize([{ fullParity: true,
    outcomeRelation: "INCUMBENT_BETTER",
    lanes: [lane("FULL", "CANDIDATE_HIGHER"),
      lane("NO_ATTACK", "EQUAL")], backup }]);
  assert.equal(value.lanes.NO_ATTACK.transitionsFromFull[
    "CANDIDATE_HIGHER->EQUAL"], 1);
  assert.equal(value.backup.byOutcome.INCUMBENT_BETTER.mean.CANDIDATE_HIGHER, 1);
  assert.equal(value.backup.columnPattern["2/0/1"], 1);
  assert.equal(value.backup.valueVariantDisagreementRoots, 0);
});

test("BP135 runtime acceptance requires complete cross-world lanes", () => {
  const summary = { attemptCount: 1, rootRestoreFailureCount: 0,
    hotAllocationCount: 0, lanes: [{ name: "FULL", completeCount: 1,
      agreementCount: 1, disagreementCount: 0, relationCount: {
        incomplete: 0, candidateHigher: 1, equal: 0, candidateLower: 0 },
      variants: [{ totalNodes: 4 }, { totalNodes: 4 }, { totalNodes: 4 }] }] };
  const value = aggregateRuntime([{ candidateEngine: {
    semanticAttackPolicyIntervalShadow: { depthLeafBackup: summary } } }]);
  assert.equal(value.attempts, 1);
  assert.deepEqual(value.lanes.FULL.nodes, [4, 4, 4]);
  value.lanes.FULL.complete = 35; value.lanes.FULL.agreement = 35;
  value.lanes.FULL.relationCount.candidateHigher = 17;
  value.lanes.FULL.relationCount.equal = 9;
  value.lanes.FULL.relationCount.candidateLower = 9;
  assert.equal(exactLane(value, "FULL", 17, 9, 9), true);
});
