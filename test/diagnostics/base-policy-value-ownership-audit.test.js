"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { build } = require(
  "../../tools/agentank/diagnostics/base-policy-value-ownership-audit");

function row(id, outcome, actions, tieBreaks = 0) {
  return { implementation: "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE",
    scenarioFingerprint: id, candidateSeat: 0, analysisOutcome: outcome,
    counts: { stars: [1, 0], crashes: [0, 0] },
    candidate: { compactActionStream: actions, actionCounts: { FIRE: 1 },
      decisionCount: 2, totalRuntimeMicros: 20,
      nativeTacticalActionOwner: { pathNominalTieBreakCount: tieBreaks,
        hotAllocationCount: 0, policySearch: { totalNodes: 3,
          pathEvidenceMode: tieBreaks ? "split-nominal" : "single",
          hotAllocationCount: 0 } } } };
}

test("value ownership audit reconciles scores and causal transitions", () => {
  const base = { rows: [row("a", "V1_WIN", "AA=="), row("b", "DRAW", "AQ==")] };
  const robust = { rows: [row("a", "V1_WIN", "Ag=="),
    row("b", "V1_WIN", "AQ==")] };
  const nominal = { rows: [row("a", "V2_WIN", "Aw==", 1),
    row("b", "DRAW", "AQ==", 2)] };
  const output = build(base, robust, nominal);
  assert.equal(output.modes.ROBUST_BASE.scoreBasisPoints, 2500);
  assert.equal(output.modes.SOFT_NOMINAL_ONLY.scoreBasisPoints, 7500);
  assert.equal(output.modes.SOFT_NOMINAL_ONLY.pathNominalTieBreaks, 3);
  assert.equal(output.relativeToRobustBase.SOFT_IN_ROBUST.negativeTransitions, 1);
  assert.equal(output.relativeToRobustBase.SOFT_NOMINAL_ONLY.positiveTransitions, 1);
  assert.equal(output.relativeToRobustBase.SOFT_NOMINAL_ONLY.actionDifferent, 1);
});
