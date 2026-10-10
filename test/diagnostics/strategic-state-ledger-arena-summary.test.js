"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require(
  "../../tools/agentank/diagnostics/v2-native-initiative-arena");

function match(commits, regressions, run) {
  return { implementation: "STRATEGIC_LEDGER", analysisOutcome: "DRAW",
    candidateSeat: 0,
    counts: { stars: [0, 0], crashes: [0, 0], bullets: [0, 0],
      bombs: [0, 0], skills: [0, 0] },
    candidate: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0,
      timeoutCount: 0, errorCount: 0 },
    control: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0 },
    candidateEngine: { strategicStateLedgerShadow: {
      decisionCount: 2, matchCount: 1, sameTargetPlanCommitCount: commits,
      leadingAttackWithStarRegression: regressions, maximumTargetRun: run,
      selectedByScoreKind: { LEADING: { ATTACK: 2 } },
      selectedByPhaseKind: { OPENING: { ATTACK: 2 } },
      actionByScore: { LEADING: { FIRE: 2 } },
      targetRunsByScoreKind: { LEADING: { ATTACK: 1 } },
      targetFramesByScoreKind: { LEADING: { ATTACK: run } },
      maximumTargetRunByScoreKind: { LEADING: { ATTACK: run } },
      planCommitsByScoreKind: { LEADING: { ATTACK: commits } },
      planActivationsByScoreKind: {}, planCompletionsByScoreKind: {},
      planInvalidationsByScoreKind: {}, deadlineSlackBuckets: { NINE_PLUS: 2 },
      generationSwitchByScore: { LEADING: 1 }, eventSwitchByScore: {},
      unsignaledSwitchByScore: { LEADING: 1 },
      qualifiedAttackRootByScore: { LEADING: 2 },
      qualifiedStarRootByScore: { LEADING: 2 },
      selectedAttackWithStarAlternativeByScore: { LEADING: 2 },
      selectedStarWithAttackAlternativeByScore: {},
      selectedResourceWithStarAlternativeByScore: {},
      attackStarPathRegressionByScore: { LEADING: regressions },
      resourceStarPathRegressionByScore: {}, eventFramesByScore: {},
      noEventFramesByScore: { LEADING: 2 }, lifecycleCreationsByScore: {},
      lifecycleExpiriesByScore: {}, lifecycleGapsByScore: {},
      lifecycleRecoveriesByScore: {} } } };
}

test("arena summary adds strategic totals but takes maximum run lengths", () => {
  const summary = summarize([match(2, 1, 3), match(4, 2, 7)],
    "STRATEGIC_LEDGER").strategicStateLedgerShadow;
  assert.equal(summary.decisionCount, 4);
  assert.equal(summary.sameTargetPlanCommitCount, 6);
  assert.equal(summary.leadingAttackWithStarRegression, 3);
  assert.equal(summary.selectedByScoreKind.LEADING.ATTACK, 4);
  assert.equal(summary.planCommitsByScoreKind.LEADING.ATTACK, 6);
  assert.equal(summary.maximumTargetRun, 7);
  assert.equal(summary.maximumTargetRunByScoreKind.LEADING.ATTACK, 7);
});
