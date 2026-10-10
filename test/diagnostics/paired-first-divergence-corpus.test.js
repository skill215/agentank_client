"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { firstDivergence, buildCorpus } = require(
  "../../tools/agentank/diagnostics/paired-first-divergence-corpus");

function match(implementation, actions, outcome, root = {}) {
  const actionFrames = actions.map((action, index) => ({
    frame: index + 1, action, command: action
  }));
  const diagnosticFrames = actions.map((action, index) => ({
    frame: index + 1, action, completedDepth: 0,
    observationSafetySupportComplete: false, possibleProjectileCount: 1,
    controlMode: 2, candidates: [], ...root
  }));
  return { implementation, scenarioFingerprint: "scenario", candidateSeat: 0,
    matchUrlId: "match", analysisOutcome: outcome,
    terminalCategory: "FRAME_LIMIT_STARS",
    candidateEngine: { actionFrames, diagnosticFrames } };
}

test("paired corpus finds divergence by callback frame instead of array offset", () => {
  const left = [{ frame: 2, action: "GO" }, { frame: 4, action: "FIRE" }];
  const right = [{ frame: 2, action: "GO" }, { frame: 4, action: "TURN_LEFT" }];
  assert.equal(firstDivergence(left, right).frame, 4);
});

test("paired corpus compares structured commands by value", () => {
  const left = [{ frame: 2, action: "CAST_POISON", command: { target: [1, 2] } }];
  const right = [{ frame: 2, action: "CAST_POISON", command: { target: [1, 2] } }];
  assert.equal(firstDivergence(left, right), null);
});

test("paired corpus binds first divergent root to the eventual outcome transition", () => {
  const document = buildCorpus([
    match("BASE", ["GO", "GO"], "V2_WIN"),
    match("CAND", ["GO", "TURN_LEFT"], "V1_WIN")
  ], "BASE", "CAND");
  assert.equal(document.summary.matchedPairs, 1);
  assert.equal(document.summary.divergentPolicies, 1);
  assert.equal(document.summary.negativeOutcomeTransitions, 1);
  assert.equal(document.summary.observationIncompleteDepthZeroRoots, 1);
  assert.equal(document.roots[0].frame, 2);
  assert.equal(document.roots[0].baselineRoot.action, "GO");
  assert.equal(document.roots[0].candidateRoot.action, "TURN_LEFT");
});

test("paired corpus keeps identical policies out of the root payload", () => {
  const document = buildCorpus([
    match("BASE", ["GO"], "DRAW"), match("CAND", ["GO"], "DRAW")
  ], "BASE", "CAND");
  assert.equal(document.summary.identicalPolicies, 1);
  assert.equal(document.roots.length, 0);
});
