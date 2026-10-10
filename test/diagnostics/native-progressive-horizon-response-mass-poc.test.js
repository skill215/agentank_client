"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { LONG_EVENT_OUTCOME } = require(
  "../../tools/agentank/diagnostics/native-long-option-event-envelope-poc");
const { RESPONSE_RELATION } = require(
  "../../tools/agentank/diagnostics/native-long-option-response-mass-poc");
const { NativeProgressiveHorizonResponseMassPoc, formallyClosed } = require(
  "../../tools/agentank/diagnostics/native-progressive-horizon-response-mass-poc");

function evaluator(mask, relation, nodes, transitions, action = 1) {
  return {
    pairCount: 0, nodeCount: 0, transitionCount: 0,
    baseMask: mask, candidateMask: mask, lastRelation: relation,
    lastAction: action, lastArgument: 65535,
    baseMass: new Uint16Array(11), candidateMass: new Uint16Array(11),
    observe() {
      this.pairCount += 1; this.nodeCount += nodes;
      this.transitionCount += transitions;
    },
    summary() { return { mode: "shadow", baseMask: this.baseMask,
      candidateMask: this.candidateMask, lastRelation: this.lastRelation,
      baseMass: Array.from(this.baseMass),
      candidateMass: Array.from(this.candidateMass) }; }
  };
}

test("strict progressive stop accepts only fully terminal masks", () => {
  assert.equal(formallyClosed(evaluator(LONG_EVENT_OUTCOME.WIN,
    RESPONSE_RELATION.EQUAL, 1, 1)), true);
  assert.equal(formallyClosed(evaluator(LONG_EVENT_OUTCOME.WIN |
    LONG_EVENT_OUTCOME.OPEN, RESPONSE_RELATION.EQUAL, 1, 1)), false);
  assert.equal(formallyClosed(evaluator(LONG_EVENT_OUTCOME.DEATH |
    LONG_EVENT_OUTCOME.INCOMPLETE, RESPONSE_RELATION.EQUAL, 1, 1)), false);
});

test("closed depth two records exact depth-six evidence and saved work", () => {
  const evaluators = [
    evaluator(LONG_EVENT_OUTCOME.WIN, RESPONSE_RELATION.EQUAL, 2, 3),
    evaluator(LONG_EVENT_OUTCOME.WIN, RESPONSE_RELATION.EQUAL, 5, 8),
    evaluator(LONG_EVENT_OUTCOME.WIN, RESPONSE_RELATION.EQUAL, 9, 13)
  ];
  const poc = new NativeProgressiveHorizonResponseMassPoc("shadow",
    { evaluators });
  assert.equal(poc.observe({}, {}, 1, 65535), null);
  const summary = poc.summary();
  assert.equal(summary.progressiveRootCount, 1);
  assert.equal(summary.strictStopAt2Count, 1);
  assert.equal(summary.closed2Exact6Count, 1);
  assert.equal(summary.closed2DriftCount, 0);
  assert.equal(summary.strictSavedNodeCount, 14);
  assert.equal(summary.strictSavedTransitionCount, 21);
});

test("open depth two advances to a closed depth four", () => {
  const evaluators = [
    evaluator(LONG_EVENT_OUTCOME.OPEN, RESPONSE_RELATION.TRADEOFF, 2, 3),
    evaluator(LONG_EVENT_OUTCOME.DEATH,
      RESPONSE_RELATION.BASE_DOMINATES, 5, 8),
    evaluator(LONG_EVENT_OUTCOME.DEATH,
      RESPONSE_RELATION.BASE_DOMINATES, 9, 13)
  ];
  const poc = new NativeProgressiveHorizonResponseMassPoc("shadow",
    { evaluators });
  poc.observe({}, {}, 1, 65535);
  const summary = poc.summary();
  assert.equal(summary.strictStopAt2Count, 0);
  assert.equal(summary.strictStopAt4Count, 1);
  assert.equal(summary.closed4Exact6Count, 1);
  assert.equal(summary.strictSavedNodeCount, 9);
  assert.equal(summary.relation2To6[
    RESPONSE_RELATION.TRADEOFF * 6 + RESPONSE_RELATION.BASE_DOMINATES], 1);
});

test("closed shallow drift is audited and never owns an action", () => {
  const shallow = evaluator(LONG_EVENT_OUTCOME.WIN,
    RESPONSE_RELATION.CANDIDATE_DOMINATES, 2, 3);
  const middle = evaluator(LONG_EVENT_OUTCOME.WIN,
    RESPONSE_RELATION.CANDIDATE_DOMINATES, 5, 8);
  const deep = evaluator(LONG_EVENT_OUTCOME.DEATH,
    RESPONSE_RELATION.BASE_DOMINATES, 9, 13);
  const poc = new NativeProgressiveHorizonResponseMassPoc("shadow",
    { evaluators: [shallow, middle, deep] });
  assert.equal(poc.observe({}, {}, 1, 65535), null);
  assert.equal(poc.closeHostOverride(), null);
  const summary = poc.summary();
  assert.equal(summary.closed2DriftCount, 1);
  assert.equal(summary.closed2Exact6Count, 0);
});
