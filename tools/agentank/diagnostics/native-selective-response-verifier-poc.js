"use strict";

// BP42 execution POC.  Unlike the BP40/BP41 census, this class does not run
// the complete primitive oracle on every root.  It first evaluates the cheap
// prefix-1 persistent-policy portfolio and invokes the full verifier only for
// a candidate-dominance proposal.  The portfolio can never own an action.

const { ACTION, NONE_CELL } = require("../../../engine-v2/src/abi/fast-codes");
const { MASS_INDEX, MASS_DIMENSION, RESPONSE_RELATION } = require(
  "./native-long-option-response-mass-poc");
const { NativeHostContinuationStunVerifierPoc } = require(
  "./native-host-continuation-stun-verifier-poc");
const { ENEMY_RESPONSE_POLICY, POLICY_WEIGHTS,
  NativeEnemyPolicyResponseMassPoc, responseRelation } = require(
  "./native-enemy-response-portfolio-poc");

const INCOMPLETE_MASK = 1 << MASS_INDEX.INCOMPLETE;
const FAILURE_MASK = (1 << MASS_INDEX.DEATH) |
  (1 << MASS_INDEX.POLICY_LOSS) | INCOMPLETE_MASK;
const NONTERMINAL_MASK = (1 << MASS_INDEX.ABORT) |
  (1 << MASS_INDEX.RESCUE) | (1 << MASS_INDEX.OPEN) | INCOMPLETE_MASK;
const CERTIFICATE_CLASS = Object.freeze({
  NONE: 0,
  TERMINAL_WIN_CLOSURE: 1,
  HORIZON_FAILURE_ELIMINATION: 2,
  FAILURE_SUPPORT_REDUCTION: 3,
  NOMINAL_MASS_ONLY: 4,
  OUTCOME_MASK_CHANGE: 5,
  COUNT: 6
});
const ROOT_VALUE_RELATION = Object.freeze({
  UNAVAILABLE: 0,
  CANDIDATE_HIGHER: 1,
  EQUAL: 2,
  CANDIDATE_LOWER: 3,
  COUNT: 4
});

class NativeSelectiveResponseVerifierPoc {
  constructor(mode = "off", options = {}) {
    this.mode = mode === "value-active" ? "value-active" :
      mode === "strict-active" ? "strict-active" :
      mode === "active" ? "active" :
      mode === "guarded-shadow" ? "guarded-shadow" :
      mode === "shadow" ? "shadow" : "off";
    this.responseOwnershipActive = this.mode === "active" ||
      this.mode === "strict-active" || this.mode === "value-active" ? 1 : 0;
    this.strictResponseOwnership = this.mode === "strict-active" ? 1 : 0;
    this.valueResponseOwnership = this.mode === "value-active" ? 1 : 0;
    this.hostClosureActive = this.mode === "guarded-shadow" ||
      this.responseOwnershipActive ? 1 : 0;
    this.maximumFrames = options.maximumFrames || 6;
    this.nodeBudget = options.nodeBudget || 2048;
    this.candidateProposalMode =
      options.candidateProposalMode === "root-value-mobility" ?
        "root-value-mobility" :
        options.candidateProposalMode === "root-value" ?
          "root-value" : "attack-pose";
    this.full = options.full || new NativeHostContinuationStunVerifierPoc(
      "shadow", options);
    this.policy = options.policy || new Array(ENEMY_RESPONSE_POLICY.COUNT);
    for (let id = 0; id < ENEMY_RESPONSE_POLICY.COUNT; id += 1)
      if (!this.policy[id]) this.policy[id] =
        new NativeEnemyPolicyResponseMassPoc("shadow", {
          ...options, enemyPolicyId: id, primitivePrefixDepth: 1 });
    this.weights = options.weights || Uint16Array.from(POLICY_WEIGHTS);
    this.baseMass = new Uint16Array(MASS_DIMENSION);
    this.candidateMass = new Uint16Array(MASS_DIMENSION);
    this.baseMassSum = new Uint32Array(MASS_DIMENSION);
    this.candidateMassSum = new Uint32Array(MASS_DIMENSION);
    this.checkCount = 0; this.pairCount = 0;
    this.portfolioIncompleteCount = 0; this.portfolioEqualCount = 0;
    this.portfolioCandidateCount = 0; this.portfolioBaseCount = 0;
    this.portfolioTradeoffCount = 0; this.rootMismatchCount = 0;
    this.verifierAttemptCount = 0; this.verifierCertifiedCount = 0;
    this.verifierRejectedCount = 0; this.verifierIncompleteCount = 0;
    this.verifierMissingCount = 0; this.sameActionCount = 0;
    this.wouldOverrideCount = 0; this.overrideCount = 0;
    this.ownershipClassRejectCount = 0;
    this.ownershipValueRejectCount = 0;
    this.finalGateRejectCount = 0; this.rootRestoreFailureCount = 0;
    this.hostFinalCheckCount = 0; this.hostFinalApprovedCount = 0;
    this.hostFinalRejectCount = 0; this.hostFinalFallbackCount = 0;
    this.hostFinalFallbackFailureCount = 0;
    this.hostFinalNoSafeActionCount = 0;
    this.portfolioNodeCount = 0; this.portfolioTransitionCount = 0;
    this.verifierNodeCount = 0; this.verifierTransitionCount = 0;
    this.hotAllocationCount = 0;
    this.certifiedClassCount = new Uint32Array(CERTIFICATE_CLASS.COUNT);
    this.wouldOverrideClassCount = new Uint32Array(CERTIFICATE_CLASS.COUNT);
    this.overrideClassCount = new Uint32Array(CERTIFICATE_CLASS.COUNT);
    this.rootValueRelationCount = new Uint32Array(ROOT_VALUE_RELATION.COUNT);
    this.certificateValueRelationCount = new Uint32Array(
      CERTIFICATE_CLASS.COUNT * ROOT_VALUE_RELATION.COUNT);
    this.lastCertificateClass = CERTIFICATE_CLASS.NONE;
    this.lastRootValueRelation = ROOT_VALUE_RELATION.UNAVAILABLE;
    this.lastIncumbentRootValue = 0; this.lastCandidateRootValue = 0;
    this.lastRelation = RESPONSE_RELATION.NONE;
    this.lastVerifiedRelation = RESPONSE_RELATION.NONE;
    this.lastAction = ACTION.NONE; this.lastArgument = NONE_CELL;
  }

  combine() {
    this.baseMassSum.fill(0); this.candidateMassSum.fill(0);
    let baseMask = 0; let candidateMask = 0; let totalWeight = 0;
    for (let id = 0; id < ENEMY_RESPONSE_POLICY.COUNT; id += 1) {
      const policy = this.policy[id]; const weight = this.weights[id];
      baseMask |= policy.baseMask; candidateMask |= policy.candidateMask;
      totalWeight += weight;
      for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1) {
        this.baseMassSum[dimension] += policy.baseMass[dimension] * weight;
        this.candidateMassSum[dimension] +=
          policy.candidateMass[dimension] * weight;
      }
    }
    for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1) {
      this.baseMass[dimension] = Math.min(10000, Math.trunc(
        (this.baseMassSum[dimension] + (totalWeight >> 1)) / totalWeight));
      this.candidateMass[dimension] = Math.min(10000, Math.trunc(
        (this.candidateMassSum[dimension] + (totalWeight >> 1)) /
          totalWeight));
    }
    let relation = responseRelation(baseMask, this.baseMass,
      candidateMask, this.candidateMass);
    if (((baseMask | candidateMask) & INCOMPLETE_MASK) &&
        relation !== RESPONSE_RELATION.EQUAL)
      relation = RESPONSE_RELATION.INCOMPLETE;
    return relation;
  }

  finalAllowedRow(engine, action, argument) {
    if (!engine.finalGate || !engine.adapter?.bundle) return -1;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (engine.ourActions[row] !== action ||
          engine.ourArguments[row] !== argument) continue;
      if (engine.finalGate.finalAllows(engine.adapter.bundle,
          engine.ourActions, engine.ourArguments, row, engine.ourCount))
        return row;
    }
    return -1;
  }

  certificateClass() {
    const baseMask = this.full.baseMask | 0;
    const candidateMask = this.full.candidateMask | 0;
    const baseFailure = baseMask & FAILURE_MASK;
    const candidateFailure = candidateMask & FAILURE_MASK;
    const candidateTerminalWin = Boolean(candidateMask &
      (1 << MASS_INDEX.WIN)) && !(candidateMask &
        (FAILURE_MASK | NONTERMINAL_MASK));
    const baseTerminalWin = Boolean(baseMask & (1 << MASS_INDEX.WIN)) &&
      !(baseMask & (FAILURE_MASK | NONTERMINAL_MASK));
    if (candidateTerminalWin && !baseTerminalWin)
      return CERTIFICATE_CLASS.TERMINAL_WIN_CLOSURE;
    if (!candidateFailure && baseFailure)
      return CERTIFICATE_CLASS.HORIZON_FAILURE_ELIMINATION;
    if (candidateFailure !== baseFailure &&
        !(candidateFailure & ~baseFailure))
      return CERTIFICATE_CLASS.FAILURE_SUPPORT_REDUCTION;
    if (candidateMask === baseMask)
      return CERTIFICATE_CLASS.NOMINAL_MASS_ONLY;
    return CERTIFICATE_CLASS.OUTCOME_MASK_CHANGE;
  }

  rootValueRelation(engine, search, incumbentAction, incumbentArgument,
      candidateRow) {
    if (!search?.representativeSupportComplete || !search.rootScore ||
        !search.rootDomainMask || candidateRow < 0 ||
        !search.rootDomainMask[candidateRow])
      return ROOT_VALUE_RELATION.UNAVAILABLE;
    const candidateValue = search.rootScore[candidateRow];
    let incumbentValue = -2147483648; let found = 0;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (!search.rootDomainMask[row] ||
          engine.ourActions[row] !== incumbentAction ||
          engine.ourArguments[row] !== incumbentArgument) continue;
      if (!found || search.rootScore[row] > incumbentValue)
        incumbentValue = search.rootScore[row];
      found = 1;
    }
    if (!found || !Number.isFinite(candidateValue) ||
        !Number.isFinite(incumbentValue))
      return ROOT_VALUE_RELATION.UNAVAILABLE;
    this.lastIncumbentRootValue = incumbentValue;
    this.lastCandidateRootValue = candidateValue;
    if (candidateValue > incumbentValue)
      return ROOT_VALUE_RELATION.CANDIDATE_HIGHER;
    if (candidateValue < incumbentValue)
      return ROOT_VALUE_RELATION.CANDIDATE_LOWER;
    return ROOT_VALUE_RELATION.EQUAL;
  }

  observe(engine, search, incumbentAction, incumbentArgument = NONE_CELL) {
    if (this.mode === "off") return null;
    this.checkCount += 1; this.lastRelation = RESPONSE_RELATION.NONE;
    this.lastVerifiedRelation = RESPONSE_RELATION.NONE;
    let nodesBefore = 0; let transitionsBefore = 0;
    for (let id = 0; id < ENEMY_RESPONSE_POLICY.COUNT; id += 1) {
      nodesBefore += this.policy[id].baseNodeCount +
        this.policy[id].candidateNodeCount;
      transitionsBefore += this.policy[id].baseTransitionCount +
        this.policy[id].candidateTransitionCount;
    }
    const firstBefore = this.policy[0].pairCount;
    for (let id = 0; id < ENEMY_RESPONSE_POLICY.COUNT; id += 1) {
      const policy = this.policy[id]; const before = policy.pairCount;
      policy.observe(engine, search, incumbentAction, incumbentArgument);
      if (policy.pairCount === before) return null;
      if (id && (policy.lastAction !== this.policy[0].lastAction ||
          policy.lastArgument !== this.policy[0].lastArgument)) {
        this.rootMismatchCount += 1; return null;
      }
    }
    if (this.policy[0].pairCount === firstBefore) return null;
    let nodesAfter = 0; let transitionsAfter = 0;
    for (let id = 0; id < ENEMY_RESPONSE_POLICY.COUNT; id += 1) {
      nodesAfter += this.policy[id].baseNodeCount +
        this.policy[id].candidateNodeCount;
      transitionsAfter += this.policy[id].baseTransitionCount +
        this.policy[id].candidateTransitionCount;
    }
    this.portfolioNodeCount += nodesAfter - nodesBefore;
    this.portfolioTransitionCount += transitionsAfter - transitionsBefore;
    this.pairCount += 1; this.lastAction = this.policy[0].lastAction;
    this.lastArgument = this.policy[0].lastArgument;
    const relation = this.combine(); this.lastRelation = relation;
    if (relation === RESPONSE_RELATION.INCOMPLETE) {
      this.portfolioIncompleteCount += 1; return null;
    }
    if (relation === RESPONSE_RELATION.EQUAL) {
      this.portfolioEqualCount += 1; return null;
    }
    if (relation === RESPONSE_RELATION.BASE_DOMINATES) {
      this.portfolioBaseCount += 1; return null;
    }
    if (relation === RESPONSE_RELATION.TRADEOFF) {
      this.portfolioTradeoffCount += 1; return null;
    }
    this.portfolioCandidateCount += 1; this.verifierAttemptCount += 1;
    const fullBefore = this.full.pairCount;
    const fullNodesBefore = this.full.baseNodeCount +
      this.full.candidateNodeCount;
    const fullTransitionsBefore = this.full.baseTransitionCount +
      this.full.candidateTransitionCount;
    this.full.observe(engine, search, incumbentAction, incumbentArgument);
    this.verifierNodeCount += this.full.baseNodeCount +
      this.full.candidateNodeCount - fullNodesBefore;
    this.verifierTransitionCount += this.full.baseTransitionCount +
      this.full.candidateTransitionCount - fullTransitionsBefore;
    if (this.full.pairCount === fullBefore ||
        this.full.lastAction !== this.lastAction ||
        this.full.lastArgument !== this.lastArgument) {
      this.verifierMissingCount += 1; return null;
    }
    const verified = this.full.lastRelation;
    this.lastVerifiedRelation = verified;
    if (verified === RESPONSE_RELATION.INCOMPLETE) {
      this.verifierIncompleteCount += 1; return null;
    }
    if (verified !== RESPONSE_RELATION.CANDIDATE_DOMINATES) {
      this.verifierRejectedCount += 1; return null;
    }
    this.verifierCertifiedCount += 1;
    const certificateClass = this.certificateClass();
    this.lastCertificateClass = certificateClass;
    this.certifiedClassCount[certificateClass] += 1;
    if (this.lastAction === incumbentAction &&
        this.lastArgument === incumbentArgument) {
      this.sameActionCount += 1; return null;
    }
    const row = this.finalAllowedRow(engine, this.lastAction, this.lastArgument);
    if (row < 0) { this.finalGateRejectCount += 1; return null; }
    this.wouldOverrideCount += 1;
    this.wouldOverrideClassCount[certificateClass] += 1;
    const rootValueRelation = this.rootValueRelation(engine, search,
      incumbentAction, incumbentArgument, row);
    this.lastRootValueRelation = rootValueRelation;
    this.rootValueRelationCount[rootValueRelation] += 1;
    this.certificateValueRelationCount[
      certificateClass * ROOT_VALUE_RELATION.COUNT + rootValueRelation] += 1;
    if (!this.responseOwnershipActive) return null;
    if (this.strictResponseOwnership &&
        certificateClass !== CERTIFICATE_CLASS.TERMINAL_WIN_CLOSURE &&
        certificateClass !== CERTIFICATE_CLASS.HORIZON_FAILURE_ELIMINATION) {
      this.ownershipClassRejectCount += 1;
      return null;
    }
    if (this.valueResponseOwnership &&
        rootValueRelation !== ROOT_VALUE_RELATION.CANDIDATE_HIGHER) {
      this.ownershipValueRejectCount += 1;
      return null;
    }
    this.overrideCount += 1;
    this.overrideClassCount[certificateClass] += 1;
    return { action: this.lastAction, argument: this.lastArgument, row };
  }

  closeHostOverride(engine, originalAction, originalArgument, resolved) {
    if (!this.hostClosureActive || !resolved ||
        !Number.isSafeInteger(resolved.action)) return resolved;
    const argument = Number.isSafeInteger(resolved.argument) ?
      resolved.argument : originalArgument;
    if (resolved.action === originalAction && argument === originalArgument)
      return null;
    this.hostFinalCheckCount += 1;
    if (!engine.finalGate || !engine.adapter?.bundle) {
      this.hostFinalFallbackFailureCount += 1;
      return null;
    }
    let row = this.finalAllowedRow(engine, resolved.action, argument,
      Number.isSafeInteger(resolved.row) ? resolved.row : -1);
    if (row >= 0) {
      this.hostFinalApprovedCount += 1;
      resolved.argument = argument; resolved.row = row;
      return resolved;
    }
    this.hostFinalRejectCount += 1;
    row = this.finalAllowedRow(engine, originalAction, originalArgument,
      engine.diagnosticInternalSelectedIndex | 0);
    if (row >= 0) {
      this.hostFinalFallbackCount += 1;
      return null;
    }
    for (row = 0; row < engine.ourCount; row += 1) {
      if (!engine.finalGate.finalAllows(engine.adapter.bundle,
          engine.ourActions, engine.ourArguments, row, engine.ourCount)) continue;
      resolved.action = engine.ourActions[row];
      resolved.argument = engine.ourArguments[row]; resolved.row = row;
      this.hostFinalFallbackCount += 1;
      return resolved;
    }
    this.hostFinalNoSafeActionCount += 1;
    return null;
  }

  summary() {
    let rootRestoreFailureCount = this.full.rootRestoreFailureCount;
    let budgetStopCount = this.full.budgetStopCount;
    for (let id = 0; id < ENEMY_RESPONSE_POLICY.COUNT; id += 1) {
      rootRestoreFailureCount += this.policy[id].rootRestoreFailureCount;
      budgetStopCount += this.policy[id].budgetStopCount;
    }
    return { enabled: this.mode !== "off", mode: this.mode,
      semantics: "SELECTIVE_PORTFOLIO_THEN_HOST_CONTINUATION_VERIFIER",
      responseOwnershipActive: Boolean(this.responseOwnershipActive),
      strictResponseOwnership: Boolean(this.strictResponseOwnership),
      valueResponseOwnership: Boolean(this.valueResponseOwnership),
      hostClosureActive: Boolean(this.hostClosureActive),
      hostFinalCheckCount: this.hostFinalCheckCount,
      hostFinalApprovedCount: this.hostFinalApprovedCount,
      hostFinalRejectCount: this.hostFinalRejectCount,
      hostFinalFallbackCount: this.hostFinalFallbackCount,
      hostFinalFallbackFailureCount: this.hostFinalFallbackFailureCount,
      hostFinalNoSafeActionCount: this.hostFinalNoSafeActionCount,
      maximumFrames: this.maximumFrames,
      nodeBudget: this.nodeBudget, massScale: 10000,
      massDimensionNames: Object.keys(MASS_INDEX),
      selectiveResponseVerifier: true,
      candidateProposalMode: this.candidateProposalMode,
      rootValueProposalCount: this.policy[0].rootValueProposalCount,
      rootValueProposalMissingCount:
        this.policy[0].rootValueProposalMissingCount,
      verifierRootValueProposalCount: this.full.rootValueProposalCount,
      verifierRootValueProposalMissingCount:
        this.full.rootValueProposalMissingCount,
      firstActionInterventionOnly: true,
      sharedHostContinuation: true,
      checkCount: this.checkCount, pairCount: this.pairCount,
      pairCompleteCount: this.pairCount - this.portfolioIncompleteCount,
      pairIncompleteCount: this.portfolioIncompleteCount,
      equalCount: this.portfolioEqualCount,
      candidateDominanceCount: this.portfolioCandidateCount,
      baseDominanceCount: this.portfolioBaseCount,
      tradeoffCount: this.portfolioTradeoffCount,
      verifierAttemptCount: this.verifierAttemptCount,
      verifierCertifiedCount: this.verifierCertifiedCount,
      verifierRejectedCount: this.verifierRejectedCount,
      verifierIncompleteCount: this.verifierIncompleteCount,
      verifierMissingCount: this.verifierMissingCount,
      sameRootActionCount: this.sameActionCount,
      wouldOverrideCount: this.wouldOverrideCount,
      overrideCount: this.overrideCount,
      ownershipClassRejectCount: this.ownershipClassRejectCount,
      ownershipValueRejectCount: this.ownershipValueRejectCount,
      certificateClassNames: Object.keys(CERTIFICATE_CLASS),
      certifiedClassCount: Array.from(this.certifiedClassCount),
      wouldOverrideClassCount: Array.from(this.wouldOverrideClassCount),
      overrideClassCount: Array.from(this.overrideClassCount),
      rootValueRelationNames: Object.keys(ROOT_VALUE_RELATION),
      rootValueRelationCount: Array.from(this.rootValueRelationCount),
      certificateValueRelationCount:
        Array.from(this.certificateValueRelationCount),
      finalGateRejectCount: this.finalGateRejectCount,
      baseNodeCount: this.portfolioNodeCount,
      candidateNodeCount: this.verifierNodeCount,
      baseTransitionCount: this.portfolioTransitionCount,
      candidateTransitionCount: this.verifierTransitionCount,
      budgetStopCount, rootRestoreFailureCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { CERTIFICATE_CLASS, ROOT_VALUE_RELATION,
  NativeSelectiveResponseVerifierPoc };
