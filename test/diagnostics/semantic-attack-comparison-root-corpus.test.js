"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { POLICY_RELATION } = require(
  "../../tools/agentank/diagnostics/semantic-attack-policy-interval-shadow");
const { extractComparisons, outcomeRelation, paretoRelation, summarize } =
  require("../../tools/agentank/diagnostics/semantic-attack-comparison-root-corpus");

function terminal(outcome, stars, crashed = false, killed = false) {
  return { outcome, frame: 128, reason: "frameLimit",
    candidateStars: stars, controlStars: 1, candidateCrashed: crashed,
    controlCrashed: killed };
}

test("comparison extraction preserves all three scalar verdicts", () => {
  const match = { matchUrlId: "mat_x", scenarioFingerprint: "scene",
    candidateSeat: 0, seatSkills: ["stun", "stun"],
    analysisOutcome: "V1_WIN", terminalCategory: "FRAME_LIMIT",
    frames: 128, result: { reason: "frameLimit" },
    counts: { stars: [0, 1], crashes: [0, 0] },
    candidateEngine: { semanticAttackPolicyIntervalShadow: {
      completeCount: 3, comparisonCount: 3, comparisonOverflowCount: 0,
      comparisonMissingCandidateCount: 0,
      comparisonRoots: [1, 2, 3].map((policyRelation, index) => ({
        frame: index + 1, hashLo: index + 2, hashHi: index + 3,
        currentAction: 1, currentArgument: 65535,
        candidateAction: 2, candidateArgument: 65535, policyRelation })) } } };
  const extracted = extractComparisons([match]);
  assert.equal(extracted.roots.length, 3);
  assert.deepEqual(extracted.roots.map(r => r.comparison.policyRelation),
    [POLICY_RELATION.CANDIDATE_HIGHER, POLICY_RELATION.EQUAL,
      POLICY_RELATION.CANDIDATE_LOWER]);
  assert.deepEqual(extracted.roots[0].replayPrefix.seatSkills,
    ["stun", "stun"]);
});

test("historical outcome and Pareto relations keep dimensions separate", () => {
  const loss = terminal("V1_WIN", 0);
  const win = terminal("V2_WIN", 2, false, true);
  assert.equal(outcomeRelation(loss, win), "CANDIDATE_BETTER");
  assert.equal(paretoRelation(loss, win), "CANDIDATE_DOMINATES");
  const mixed = terminal("V1_WIN", 3, true, false);
  assert.equal(paretoRelation(loss, mixed), "MIXED");
});

test("confusion summary exposes scalar false positives and false negatives", () => {
  function record(policyRelation, outcome) {
    const incumbent = terminal("V1_WIN", 0);
    const candidate = outcome === "CANDIDATE_BETTER" ?
      terminal("V2_WIN", 2, false, true) :
      outcome === "INCUMBENT_BETTER" ? terminal("V1_WIN", -1, true) : incumbent;
    return { policyRelation, outcomeRelation: outcome,
      paretoRelation: paretoRelation(incumbent, candidate),
      transition: incumbent.outcome + "_TO_" + candidate.outcome,
      incumbent: { dimensions: { nonloss: false, kill: false, death: false,
        starDiff: -1 } }, candidate: { dimensions: {
        nonloss: candidate.outcome !== "V1_WIN", kill: candidate.controlCrashed,
        death: candidate.candidateCrashed,
        starDiff: candidate.candidateStars - candidate.controlStars } } };
  }
  const summary = summarize([
    record("CANDIDATE_HIGHER", "INCUMBENT_BETTER"),
    record("CANDIDATE_LOWER", "CANDIDATE_BETTER"),
    record("EQUAL", "EQUAL")
  ]);
  assert.equal(summary.scalarOutcomeConfusion.falsePositive, 1);
  assert.equal(summary.scalarOutcomeConfusion.falseNegative, 1);
  assert.equal(summary.scalarOutcomeConfusion.equalOutcomeEqual, 1);
});
