"use strict";

const { LONG_EVENT_OUTCOME } = require("./native-long-option-event-envelope-poc");
const { RESPONSE_RELATION } = require("./native-long-option-response-mass-poc");
const { NativeDualPolicyResponseMassPoc } = require(
  "./native-dual-policy-response-mass-poc");

const HORIZONS = Object.freeze([2, 4, 6]);
const RELATION_WIDTH = RESPONSE_RELATION.INCOMPLETE + 1;
const UNRESOLVED_MASK = LONG_EVENT_OUTCOME.ABORT |
  LONG_EVENT_OUTCOME.RESCUE | LONG_EVENT_OUTCOME.OPEN |
  LONG_EVENT_OUTCOME.INCOMPLETE;

function exactVectorEqual(left, right) {
  if (left.lastRelation !== right.lastRelation ||
      left.baseMask !== right.baseMask ||
      left.candidateMask !== right.candidateMask) return false;
  for (let index = 0; index < left.baseMass.length; index += 1) {
    if (left.baseMass[index] !== right.baseMass[index] ||
        left.candidateMass[index] !== right.candidateMass[index]) return false;
  }
  return true;
}

function formallyClosed(evaluator) {
  return ((evaluator.baseMask | evaluator.candidateMask) &
    UNRESOLVED_MASK) === 0;
}

class NativeProgressiveHorizonResponseMassPoc {
  constructor(mode = "off", options = {}) {
    this.mode = mode === "shadow" ? "shadow" : "off";
    this.horizons = HORIZONS;
    this.evaluators = options.evaluators || HORIZONS.map(maximumFrames =>
      new NativeDualPolicyResponseMassPoc(this.mode, {
        maximumFrames,
        nodeBudget: options.nodeBudget || 2048
      }));
    if (this.evaluators.length !== HORIZONS.length)
      throw new Error("PROGRESSIVE_HORIZON_EVALUATOR_COUNT");
    this.rootCount = 0;
    this.rootMismatchCount = 0;
    this.horizonPairCount = new Uint32Array(HORIZONS.length);
    this.horizonClosedCount = new Uint32Array(HORIZONS.length);
    this.horizonNodeCount = new Uint32Array(HORIZONS.length);
    this.horizonTransitionCount = new Uint32Array(HORIZONS.length);
    this.beforePairs = new Uint32Array(HORIZONS.length);
    this.beforeNodes = new Uint32Array(HORIZONS.length);
    this.beforeTransitions = new Uint32Array(HORIZONS.length);
    this.relation2To4 = new Uint32Array(RELATION_WIDTH * RELATION_WIDTH);
    this.relation4To6 = new Uint32Array(RELATION_WIDTH * RELATION_WIDTH);
    this.relation2To6 = new Uint32Array(RELATION_WIDTH * RELATION_WIDTH);
    this.exact2To4Count = 0;
    this.exact4To6Count = 0;
    this.exact2To6Count = 0;
    this.closed2Exact6Count = 0;
    this.closed4Exact6Count = 0;
    this.closed2DriftCount = 0;
    this.closed4DriftCount = 0;
    this.strictStopAt2Count = 0;
    this.strictStopAt4Count = 0;
    this.strictStopAt6Count = 0;
    this.strictSavedNodeCount = 0;
    this.strictSavedTransitionCount = 0;
  }

  observe(engine, search, incumbentAction, incumbentArgument) {
    if (this.mode === "off") return null;
    let allEvaluated = 1;
    for (let index = 0; index < HORIZONS.length; index += 1) {
      const evaluator = this.evaluators[index];
      this.beforePairs[index] = evaluator.pairCount;
      this.beforeNodes[index] = evaluator.nodeCount;
      this.beforeTransitions[index] = evaluator.transitionCount;
      evaluator.observe(engine, search, incumbentAction, incumbentArgument);
      this.horizonNodeCount[index] +=
        evaluator.nodeCount - this.beforeNodes[index];
      this.horizonTransitionCount[index] +=
        evaluator.transitionCount - this.beforeTransitions[index];
      if (evaluator.pairCount !== this.beforePairs[index])
        this.horizonPairCount[index] += 1;
      else allEvaluated = 0;
    }
    if (!allEvaluated) return null;
    const shallow = this.evaluators[0];
    const middle = this.evaluators[1];
    const deep = this.evaluators[2];
    if (shallow.lastAction !== middle.lastAction ||
        shallow.lastAction !== deep.lastAction ||
        shallow.lastArgument !== middle.lastArgument ||
        shallow.lastArgument !== deep.lastArgument) {
      this.rootMismatchCount += 1;
      return null;
    }
    this.rootCount += 1;
    const r2 = shallow.lastRelation;
    const r4 = middle.lastRelation;
    const r6 = deep.lastRelation;
    this.relation2To4[r2 * RELATION_WIDTH + r4] += 1;
    this.relation4To6[r4 * RELATION_WIDTH + r6] += 1;
    this.relation2To6[r2 * RELATION_WIDTH + r6] += 1;
    const exact24 = exactVectorEqual(shallow, middle);
    const exact46 = exactVectorEqual(middle, deep);
    const exact26 = exactVectorEqual(shallow, deep);
    if (exact24) this.exact2To4Count += 1;
    if (exact46) this.exact4To6Count += 1;
    if (exact26) this.exact2To6Count += 1;
    const closed2 = formallyClosed(shallow);
    const closed4 = formallyClosed(middle);
    const closed6 = formallyClosed(deep);
    if (closed2) this.horizonClosedCount[0] += 1;
    if (closed4) this.horizonClosedCount[1] += 1;
    if (closed6) this.horizonClosedCount[2] += 1;
    if (closed2) {
      this.strictStopAt2Count += 1;
      if (exact26) this.closed2Exact6Count += 1;
      else this.closed2DriftCount += 1;
      this.strictSavedNodeCount += Math.max(0,
        (middle.nodeCount - this.beforeNodes[1]) +
        (deep.nodeCount - this.beforeNodes[2]));
      this.strictSavedTransitionCount += Math.max(0,
        (middle.transitionCount - this.beforeTransitions[1]) +
        (deep.transitionCount - this.beforeTransitions[2]));
    } else if (closed4) {
      this.strictStopAt4Count += 1;
      if (exact46) this.closed4Exact6Count += 1;
      else this.closed4DriftCount += 1;
      this.strictSavedNodeCount += Math.max(0,
        deep.nodeCount - this.beforeNodes[2]);
      this.strictSavedTransitionCount += Math.max(0,
        deep.transitionCount - this.beforeTransitions[2]);
    } else this.strictStopAt6Count += 1;
    return null;
  }

  closeHostOverride() { return null; }

  summary() {
    const deep = this.evaluators[2].summary();
    return { ...deep,
      semantics: "PROGRESSIVE_DUAL_POLICY_RESPONSE_MASS",
      progressiveHorizon: true,
      horizonFrames: Array.from(HORIZONS),
      progressiveRootCount: this.rootCount,
      progressiveRootMismatchCount: this.rootMismatchCount,
      horizonPairCount: Array.from(this.horizonPairCount),
      horizonClosedCount: Array.from(this.horizonClosedCount),
      horizonNodeCount: Array.from(this.horizonNodeCount),
      horizonTransitionCount: Array.from(this.horizonTransitionCount),
      relation2To4: Array.from(this.relation2To4),
      relation4To6: Array.from(this.relation4To6),
      relation2To6: Array.from(this.relation2To6),
      exact2To4Count: this.exact2To4Count,
      exact4To6Count: this.exact4To6Count,
      exact2To6Count: this.exact2To6Count,
      closed2Exact6Count: this.closed2Exact6Count,
      closed4Exact6Count: this.closed4Exact6Count,
      closed2DriftCount: this.closed2DriftCount,
      closed4DriftCount: this.closed4DriftCount,
      strictStopAt2Count: this.strictStopAt2Count,
      strictStopAt4Count: this.strictStopAt4Count,
      strictStopAt6Count: this.strictStopAt6Count,
      strictSavedNodeCount: this.strictSavedNodeCount,
      strictSavedTransitionCount: this.strictSavedTransitionCount,
      progressiveHotAllocationCount: 0 };
  }
}

module.exports = { NativeProgressiveHorizonResponseMassPoc,
  HORIZONS, UNRESOLVED_MASK, exactVectorEqual, formallyClosed };
