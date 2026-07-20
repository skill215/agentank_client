"use strict";

const { fingerprintObject } = require("../core/hash");
const { invariant } = require("../core/errors");
const { divergence } = require("./dual-track");
const { LABEL } = require("./codes");
const { ProofSearch } = require("../../../engine-v2/src/search/proof-search");
const { PROOF_GOAL, PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");

const QUANTIFIERS = Object.freeze({ ourAction: "EXISTS", enemyAction: "FOR_ALL",
  hiddenWorld: "FOR_ALL", chanceOutcome: "FOR_ALL_SUPPORT", observation: "STRATEGY_CONSISTENT" });

function classifyGraph(graph, root, budget) {
  const nonloss = new ProofSearch(graph); const nonlossStatus = nonloss.solve(root, PROOF_GOAL.FORCED_NONLOSS, budget);
  if (nonlossStatus === PROOF_STATUS.PROVEN) return { labelCode: LABEL.ROBUST_AVOIDABLE,
    label: "ROBUST_AVOIDABLE", proofGoal: "FORCED_NONLOSS", proofStatus: "PROVEN",
    visitedNodes: nonloss.visitedNodes, coverageMask: nonloss.mask[root], assumptionMask: graph.assumptionMask[root] };
  const loss = new ProofSearch(graph); const lossStatus = loss.solve(root, PROOF_GOAL.FORCED_LOSS, budget);
  if (lossStatus === PROOF_STATUS.PROVEN) return { labelCode: LABEL.STRICT_UNAVOIDABLE,
    label: "STRICT_UNAVOIDABLE", proofGoal: "FORCED_LOSS", proofStatus: "PROVEN",
    visitedNodes: loss.visitedNodes, coverageMask: loss.mask[root], assumptionMask: graph.assumptionMask[root] };
  return { labelCode: LABEL.UNKNOWN, label: "UNKNOWN", proofGoal: "NONE", proofStatus: "UNKNOWN",
    visitedNodes: nonloss.visitedNodes + loss.visitedNodes, coverageMask: nonloss.mask[root],
    assumptionMask: graph.assumptionMask[root] };
}

class BidirectionalCounterfactualRunner {
  constructor(options = {}) { this.nodeBudget = options.nodeBudget || 4096; this.quantifiers = QUANTIFIERS; }

  run(checkpoint, controlledSide) {
    invariant(controlledSide === 0 || controlledSide === 1, "COUNTERFACTUAL_SIDE_INVALID", "side");
    const baselineObservation = checkpoint.baselineObservations?.[controlledSide];
    const candidateObservation = checkpoint.candidateObservations?.[controlledSide] || baselineObservation;
    invariant(baselineObservation && candidateObservation, "COUNTERFACTUAL_OBSERVATION_MISSING", "observation");
    const fork = divergence(baselineObservation, candidateObservation, checkpoint.frame || 0);
    const complete = checkpoint.supportComplete === true && checkpoint.observationComplete === true &&
      checkpoint.ruleComplete === true && (checkpoint.assumptionMask || 0) === 0;
    let proof = { labelCode: LABEL.UNKNOWN, label: "UNKNOWN", proofGoal: "NONE",
      proofStatus: "UNKNOWN", visitedNodes: 0, coverageMask: 0, assumptionMask: checkpoint.assumptionMask || 0 };
    const graphCase = checkpoint.graphBySide?.[controlledSide];
    if (complete && graphCase?.graph && Number.isSafeInteger(graphCase.root))
      proof = classifyGraph(graphCase.graph, graphCase.root, this.nodeBudget);
    const value = { schemaVersion: 1, resultKind: "BIDIRECTIONAL_COUNTERFACTUAL",
      checkpointId: checkpoint.checkpointId, controlledSide, perspective: controlledSide === 0 ? "CHALLENGER" : "DEFENDER",
      quantifiers: { ...this.quantifiers }, supportComplete: complete, assumptionMask: checkpoint.assumptionMask || 0,
      divergenceFrame: fork.divergenceFrame, historicalSuffixConsumedFrames: fork.historicalSuffixConsumedFrames,
      label: proof.label, labelCode: proof.labelCode, proofGoal: proof.proofGoal,
      proofStatus: proof.proofStatus, visitedNodes: proof.visitedNodes, coverageMask: proof.coverageMask,
      observationSignature: `${baselineObservation.signatureHi.toString(16)}:${baselineObservation.signatureLo.toString(16)}`,
      fingerprint: "" };
    value.fingerprint = fingerprintObject(value); return value;
  }

  runBoth(checkpoint) { const challenger = this.run(checkpoint, 0); const defender = this.run(checkpoint, 1);
    invariant(JSON.stringify(challenger.quantifiers) === JSON.stringify(defender.quantifiers),
      "COUNTERFACTUAL_QUANTIFIER_ASYMMETRY", checkpoint.checkpointId);
    return [challenger, defender]; }
}

module.exports = { QUANTIFIERS, classifyGraph, BidirectionalCounterfactualRunner };
