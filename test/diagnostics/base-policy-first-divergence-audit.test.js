"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAudit, firstDifference } = require(
  "../../tools/agentank/diagnostics/base-policy-first-divergence-audit");

function row(outcome, actions, proposed, scores) {
  const root = { engineDecisionIndex: 1, stateHashLo: 7, stateHashHi: 9,
    stateFrame: 1, proposedAction: proposed, oracleStageAction: 4,
    rows: scores.map((score, index) => ({ row: index, action: index + 1,
      allowed: 1, sourceSupported: 1, backedValue: score, rootScore: score,
      enemyCells: [score] })) };
  return { implementation: "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE",
    matchUrlId: "m", scenarioFingerprint: "s", candidateSeat: 0,
    analysisOutcome: outcome, candidate: {
      compactActionStream: Buffer.from(actions).toString("base64"),
      nativeTacticalActionOwner: { rootSamples: [root] }
    } };
}

test("first divergence audit binds an exact root to the realized transition", () => {
  assert.equal(firstDifference(Buffer.from([1, 2]), Buffer.from([1, 4])), 1);
  const off = row("V2_WIN", [1, 2], 2, [10, 20, 0, 18]);
  const on = row("V1_WIN", [1, 4], 4, [10, 20, 0, 25]);
  const audit = buildAudit([off], [on]);
  assert.equal(audit.overview.outcomeChanged, 1);
  assert.deepEqual(audit.overview.outcomeChangedScenarioIds, ["m"]);
  assert.equal(audit.overview.stateExactRootCount, 1);
  assert.equal(audit.overview.onOracleAgreementCount, 1);
  assert.equal(audit.overview.negativeOnOracleAgreementCount, 1);
  assert.equal(audit.overview.onProposedActionCount.FIRE, 1);
  assert.equal(audit.overview.responseDeltaOwnsFlipCount, 1);
  assert.equal(audit.overview.selectionMargin.values[0], 5);
  assert.equal(audit.roots[0].actionDeltas[3].rootScoreDelta, 7);
});
