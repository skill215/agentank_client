"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { build } = require(
  "../../tools/agentank/diagnostics/base-policy-host-ownership-audit");

function row(id, outcome, stream, exact = 0) {
  return { scenarioFingerprint: id, matchUrlId: id, candidateSeat: 0,
    analysisOutcome: outcome, counts: { skills: [1, 0] },
    candidate: { compactActionStream: stream, actionCounts: { fire: 2 },
      nativeTacticalActionOwner: { proposalCount: exact, overrideCount: exact,
        policySearch: { strictOwnershipRootCount: 2,
          exactOwnershipRootCount: exact } } } };
}

test("host ownership audit separates budget completeness from exact value", () => {
  const v3 = { rows: [row("a", "V2_WIN", "AA=="),
    row("b", "V1_WIN", "AQ==")] };
  const budget = { rows: [row("a", "V1_WIN", "Ag=="),
    row("b", "V1_WIN", "AQ==")] };
  const exact = { rows: [row("a", "V2_WIN", "AA==", 1),
    row("b", "V1_WIN", "AQ==", 1)] };
  const output = build(v3, budget, exact);
  assert.equal(output.modes.V3_ONLY.scoreBasisPoints, 5000);
  assert.equal(output.relativeToV3.BUDGET_COMPLETE_OVERRIDE.negativeTransitions, 1);
  assert.equal(output.relativeToV3.VALUE_EXACT_OVERRIDE.actionDifferent, 0);
  assert.equal(output.modes.VALUE_EXACT_OVERRIDE.owner.exactRoots, 2);
});
