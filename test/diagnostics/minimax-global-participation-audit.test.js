"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize, paired, verdicts } = require(
  "../../tools/agentank/diagnostics/minimax-global-participation-audit");

function match(implementation, outcome, action, values = {}) {
  return {
    implementation,
    matchUrlId: values.matchUrlId || "mat_test",
    candidateSeat: values.candidateSeat || 0,
    analysisOutcome: outcome,
    counts: { stars: [values.stars || 0, 1], crashes: [values.crash || 0, 0] },
    candidate: { totalRuntimeMicros: values.runtime || 10,
      timeoutCount: 0, errorCount: 0, actionCounts: { fire: values.fire || 0 },
      compactActionStream: action },
    candidateEngine: {
      decisionCount: 10,
      contactSearchFunnel: { exact: values.exact || 0, inexact: values.inexact || 0,
        valueBudget: values.budget || 0, valueBudgetBlocked: values.budgetBlocked || 0,
        informationConsumerBlocked: values.consumerBlocked || 0 },
      runtimeSchedule: { searchAttemptFrames: values.attempts || 0,
        searchFrames: values.completed || 0,
        physicalSearchFrames: values.physical || 0,
        informationSearchFrames: values.information || 0,
        searchNodes: values.nodes || 0 },
      layerTotals: { stageMatrixSolves: values.matrix || 0,
        completeValueOwners: values.completeOwners || 0,
        incompleteValueOwners: values.incompleteOwners || 0,
        incompleteValueEvidenceOnly: values.evidenceOnly || 0,
        avoidableHardRejects: 0,
        riskDominatedSelections: values.dominated || 0,
        depthRootRestoreFailures: 0 }
    }
  };
}

test("global audit computes contact participation and evidence-only information", () => {
  const rows = [match("CURRENT", "V2_WIN", "a", { exact: 1, inexact: 9,
    budget: 10, consumerBlocked: 9, attempts: 1, completed: 1,
    physical: 1, nodes: 20 })];
  const value = summarize(rows, "CURRENT");
  assert.equal(value.scoreBasisPoints, 10000);
  assert.equal(value.searchParticipationBasisPoints, 1000);
  assert.equal(value.inexactBlockedBasisPoints, 10000);
  assert.equal(value.nodesPerCompletedRoot, 20);
});

test("global audit reconciles paired transitions and shared invariant failures", () => {
  const rows = [
    match("BASE", "V2_WIN", "same", { dominated: 1 }),
    match("CAND", "V1_WIN", "same", { dominated: 1 })
  ];
  const value = paired({ matches: rows }, "BASE", "CAND");
  assert.deepEqual(value.transitions, { "V2_WIN->V1_WIN": 1 });
  assert.equal(value.actionMismatchMatches, 0);
  assert.equal(value.sharedRiskDominatedMatches, 1);
});

test("global audit selects the challenger-and-consumer-gated verifier verdict", () => {
  const values = verdicts([{
    experiment: "NO_PRIMITIVE_SEARCH",
    delta: { scoreBasisPoints: -78 },
    baseline: { searchParticipationBasisPoints: 374,
      inexactContactRoots: 10, informationConsumerBlockedRoots: 10 }
  }, {
    experiment: "INFORMATION_VALUE",
    delta: { scoreBasisPoints: -157, candidateRuntimeMicros: 100 },
    candidate: { informationEvidenceOnlyRoots: 12, informationSearchRoots: 12 }
  }]);
  assert.deepEqual(values, [
    "KEEP_EXACT_PHYSICAL_MINIMAX_NET_POSITIVE",
    "CURRENT_MINIMAX_PARTICIPATION_SPARSE",
    "INEXACT_CONTACT_HAS_NO_VALUE_CONSUMER",
    "INFORMATION_SEARCH_ALL_EVIDENCE_ONLY",
    "UNGATED_INFORMATION_WORK_CAUSES_RUNTIME_AND_OUTCOME_REGRESSION",
    "NEXT_SEARCH_CONTRACT_CHALLENGER_AND_CONSUMER_GATED_VERIFIER"
  ]);
});
