"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  rootKey,
  extractCertificates,
  sourceTerminal,
  terminalDimensions,
  exactEvidence,
  transition
} = require(
  "../../tools/agentank/diagnostics/semantic-attack-certificate-root-corpus");

function match() {
  return {
    matchUrlId: "mat_x", scenarioFingerprint: "scene", candidateSeat: 1,
    seatSkills: ["stun", "stun"], analysisOutcome: "V2_WIN",
    terminalCategory: "SINGLE_CRASH", frames: 12,
    result: { reason: "crash" },
    counts: { stars: [1, 2], crashes: [1, 0] },
    candidateEngine: { semanticAttackPolicyIntervalShadow: {
      strictDominanceCount: 1, certificateOverflowCount: 0,
      certificateRoots: [{ frame: 7, hashLo: 11, hashHi: 12,
        currentAction: 1, currentArgument: 65535,
        candidateAction: 3, candidateArgument: 65535 }]
    } }
  };
}

test("certificate extraction preserves denominator and exact root identity", () => {
  const input = match();
  const extracted = extractCertificates([input]);
  assert.equal(extracted.strictDominanceCount, 1);
  assert.equal(extracted.overflowCount, 0);
  assert.equal(extracted.roots.length, 1);
  assert.equal(extracted.roots[0].key,
    rootKey(input, input.candidateEngine.semanticAttackPolicyIntervalShadow
      .certificateRoots[0]));
  assert.deepEqual(extracted.roots[0].sourceTerminal, {
    outcome: "V2_WIN", frame: 12, reason: "crash",
    candidateStars: 2, controlStars: 1,
    candidateCrashed: false, controlCrashed: true
  });
});

test("duplicate physical certificate roots fail instead of being merged", () => {
  const input = match();
  assert.throws(() => extractCertificates([input, input]),
    /BP125_CERTIFICATE_DUPLICATE/);
});

test("terminal dimensions keep nonloss kill star and failure type separate", () => {
  const terminal = sourceTerminal(match());
  assert.deepEqual(terminalDimensions(terminal), {
    nonloss: true, kill: true, death: false, starDiff: 1,
    failureType: "SINGLE_KILL"
  });
  const loss = { ...terminal, outcome: "V1_WIN", frame: 128,
    reason: "frameLimit", candidateStars: 0, controlStars: 2,
    candidateCrashed: false, controlCrashed: false };
  assert.deepEqual(terminalDimensions(loss), {
    nonloss: false, kill: false, death: false, starDiff: -2,
    failureType: "FRAME_LIMIT_STAR_LOSS"
  });
  assert.equal(transition(loss, terminal), "V1_WIN_TO_V2_WIN");
});

test("exact replay evidence requires root, action and complete sequence", () => {
  assert.equal(exactEvidence({ evidence: { targetFrameSeen: true,
    physicalRootMatched: true, forced: true, sequenceSatisfied: true } }), true);
  assert.equal(exactEvidence({ evidence: { targetFrameSeen: true,
    physicalRootMatched: false, forced: true, sequenceSatisfied: true } }), false);
});
