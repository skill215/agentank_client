"use strict";

// Diagnostic-only BP40.  Keep the complete primitive enemy domain at the
// root, then evaluate a small portfolio of persistent, state-conditioned
// enemy policies.  Each policy keeps its identity for the rest of the
// horizon; this is deliberately different from choosing a fresh primitive
// action at every ply.  The result is Risk/value evidence only.

const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, NONE_CELL } = require("../../../engine-v2/src/abi/fast-codes");
const { MASS_INDEX, MASS_DIMENSION, RESPONSE_RELATION } = require(
  "./native-long-option-response-mass-poc");
const { NativeStunTurnDomainCompactionPoc } = require(
  "./native-stun-turn-domain-compaction-poc");
const { StatefulOptionRollout } = require("./stateful-option-rollout");

const DOMAIN_WIDTH = 6;
const ACTION_WIDTH = ACTION.BOOST_RIGHT_BOMB + 1;
const RELATION_WIDTH = RESPONSE_RELATION.INCOMPLETE + 1;
const ENEMY_RESPONSE_POLICY = Object.freeze({
  ATTACK: 0,
  POSITION: 1,
  DEFENSE: 2,
  COUNT: 3
});
const POLICY_WEIGHTS = Object.freeze([4000, 3500, 2500]);
const FAILURE_MASK = (1 << MASS_INDEX.DEATH) | (1 << MASS_INDEX.POLICY_LOSS);
const INCOMPLETE_MASK = 1 << MASS_INDEX.INCOMPLETE;

function dominates(leftMask, left, rightMask, right) {
  const leftBad = leftMask & (FAILURE_MASK | INCOMPLETE_MASK);
  const rightBad = rightMask & (FAILURE_MASK | INCOMPLETE_MASK);
  if (leftBad & ~rightBad) return 0;
  const noWorse = left[MASS_INDEX.FAILURE] <= right[MASS_INDEX.FAILURE] &&
    left[MASS_INDEX.INCOMPLETE] <= right[MASS_INDEX.INCOMPLETE] &&
    left[MASS_INDEX.UNRESOLVED] <= right[MASS_INDEX.UNRESOLVED] &&
    left[MASS_INDEX.SUCCESS] >= right[MASS_INDEX.SUCCESS];
  if (!noWorse) return 0;
  return leftBad !== rightBad ||
    left[MASS_INDEX.FAILURE] < right[MASS_INDEX.FAILURE] ||
    left[MASS_INDEX.INCOMPLETE] < right[MASS_INDEX.INCOMPLETE] ||
    left[MASS_INDEX.UNRESOLVED] < right[MASS_INDEX.UNRESOLVED] ||
    left[MASS_INDEX.SUCCESS] > right[MASS_INDEX.SUCCESS] ? 1 : 0;
}

function responseRelation(baseMask, baseMass, candidateMask, candidateMass) {
  let equal = baseMask === candidateMask;
  for (let dimension = 0; dimension < MASS_DIMENSION && equal; dimension += 1)
    equal = baseMass[dimension] === candidateMass[dimension];
  if (equal) return RESPONSE_RELATION.EQUAL;
  const candidate = dominates(candidateMask, candidateMass, baseMask, baseMass);
  const base = dominates(baseMask, baseMass, candidateMask, candidateMass);
  if (candidate) return RESPONSE_RELATION.CANDIDATE_DOMINATES;
  if (base) return RESPONSE_RELATION.BASE_DOMINATES;
  return RESPONSE_RELATION.TRADEOFF;
}

class NativeEnemyPolicyResponseMassPoc extends
    NativeStunTurnDomainCompactionPoc {
  constructor(mode = "off", options = {}) {
    super(mode, options);
    this.enemyPolicyId = Number.isSafeInteger(options.enemyPolicyId) ?
      options.enemyPolicyId : ENEMY_RESPONSE_POLICY.ATTACK;
    this.primitivePrefixDepth = Number.isSafeInteger(options.primitivePrefixDepth) ?
      Math.max(0, Math.min(this.maximumFrames - 1,
        options.primitivePrefixDepth)) : 0;
    this.enemyOption = options.enemyOption || new StatefulOptionRollout(2,
      this.maximumFrames);
    this.enemyPolicyStateCount = 0;
    this.enemyPolicyRouteByAction = new Uint32Array(ACTION_WIDTH);
    this.enemyPolicyHotAllocationCount = 0;
  }

  attackAction() {
    const option = this.enemyOption; const a = option.state.arrays;
    const cell = a[ARRAY.TANK_CELL][1]; const target = a[ARRAY.TANK_CELL][0];
    const wanted = option.desiredDirection(cell, target);
    if (option.canFire(1) && wanted === a[ARRAY.TANK_DIR][1] &&
        option.clearLine(cell, target)) return ACTION.FIRE;
    return option.targetAction(1, target);
  }

  positionAction() {
    const option = this.enemyOption; const a = option.state.arrays;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const target = star === NONE_CELL ? a[ARRAY.TANK_CELL][0] : star;
    return option.targetAction(1, target);
  }

  defenseAction() {
    const option = this.enemyOption; const state = option.state;
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][1];
    const own = a[ARRAY.TANK_CELL][0]; const direction = a[ARRAY.TANK_DIR][1];
    let bestAction = ACTION.NONE; let bestLane = 2;
    let bestDistance = option.distance(cell, own); let bestMobility = -1;
    for (let choice = 0; choice < 3; choice += 1) {
      const action = choice === 0 ? ACTION.GO :
        choice === 1 ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
      const nextDirection = action === ACTION.TURN_LEFT ? (direction + 3) & 3 :
        action === ACTION.TURN_RIGHT ? (direction + 1) & 3 : direction;
      const nextCell = action === ACTION.GO ? option.target(cell, direction) : cell;
      if (action === ACTION.GO && !option.walkable(nextCell, 1)) continue;
      const lane = option.clearLine(own, nextCell) &&
        option.desiredDirection(own, nextCell) === a[ARRAY.TANK_DIR][0] ? 1 : 0;
      const distance = option.distance(nextCell, own);
      const forward = option.target(nextCell, nextDirection);
      const mobility = option.walkable(forward, 1) ? 1 : 0;
      if (lane < bestLane || lane === bestLane && distance > bestDistance ||
          lane === bestLane && distance === bestDistance &&
            mobility > bestMobility) {
        bestAction = action; bestLane = lane;
        bestDistance = distance; bestMobility = mobility;
      }
    }
    return bestAction;
  }

  enemyPolicyAction(state) {
    const option = this.enemyOption; option.bind(state);
    const a = state.arrays;
    if (a[ARRAY.TANK_CRASH][1]) return ACTION.NONE;
    if (option.committedDanger(1)) return option.escapeAction(1);
    if (this.enemyPolicyId === ENEMY_RESPONSE_POLICY.ATTACK)
      return this.attackAction();
    if (this.enemyPolicyId === ENEMY_RESPONSE_POLICY.POSITION)
      return this.positionAction();
    return this.defenseAction();
  }

  copyEnemyDomain(engine, search, depth) {
    if (depth === 0 || depth <= this.primitivePrefixDepth)
      return super.copyEnemyDomain(engine, search, depth);
    const action = this.enemyPolicyAction(engine.adapter.state);
    const offset = depth * DOMAIN_WIDTH;
    this.enemyActions[offset] = action;
    this.enemyArguments[offset] = NONE_CELL;
    this.enemyCount[depth] = 1; this.compactedIndex[depth] = 255;
    this.enemyPolicyStateCount += 1;
    this.enemyPolicyRouteByAction[action] += 1;
    return 1;
  }

  summary() {
    return { ...super.summary(),
      semantics: "DUAL_POLICY_PERSISTENT_ENEMY_RESPONSE_OPTION",
      enemyPolicyId: this.enemyPolicyId,
      primitivePrefixDepth: this.primitivePrefixDepth,
      enemyPolicyStateCount: this.enemyPolicyStateCount,
      enemyPolicyRouteByAction: Array.from(this.enemyPolicyRouteByAction),
      enemyPolicyHotAllocationCount: this.enemyPolicyHotAllocationCount };
  }
}

class NativeEnemyResponsePortfolioCensusPoc {
  constructor(mode = "off", options = {}) {
    this.mode = mode === "shadow" ? "shadow" : "off";
    this.full = options.full || new NativeStunTurnDomainCompactionPoc(
      this.mode, options);
    this.policy = options.policy || new Array(ENEMY_RESPONSE_POLICY.COUNT);
    for (let id = 0; id < ENEMY_RESPONSE_POLICY.COUNT; id += 1)
      if (!this.policy[id]) this.policy[id] =
        new NativeEnemyPolicyResponseMassPoc(this.mode,
          { ...options, enemyPolicyId: id,
            primitivePrefixDepth: Number.isSafeInteger(
              options.primitivePrefixDepth) ? options.primitivePrefixDepth : 2 });
    this.weights = options.weights || Uint16Array.from(POLICY_WEIGHTS);
    this.baseMass = new Uint16Array(MASS_DIMENSION);
    this.candidateMass = new Uint16Array(MASS_DIMENSION);
    this.baseMassSum = new Uint32Array(MASS_DIMENSION);
    this.candidateMassSum = new Uint32Array(MASS_DIMENSION);
    this.baseMassTotal = new Uint32Array(MASS_DIMENSION);
    this.candidateMassTotal = new Uint32Array(MASS_DIMENSION);
    this.massDeltaTotal = new Int32Array(MASS_DIMENSION);
    this.baseOutcomeMaskCount = new Uint32Array(256);
    this.candidateOutcomeMaskCount = new Uint32Array(256);
    this.relationMatrix = new Uint32Array(RELATION_WIDTH * RELATION_WIDTH);
    this.rootCount = 0; this.rootMismatchCount = 0;
    this.relationAgreementCount = 0; this.relationDisagreementCount = 0;
    this.exactMassCount = 0; this.pairCompleteCount = 0;
    this.pairIncompleteCount = 0;
    this.fullCompleteOptionCompleteCount = 0;
    this.fullCompleteOptionIncompleteCount = 0;
    this.fullIncompleteOptionCompleteCount = 0;
    this.fullIncompleteOptionIncompleteCount = 0;
    this.equalCount = 0; this.candidateDominanceCount = 0;
    this.baseDominanceCount = 0; this.tradeoffCount = 0;
    this.policyConsensusCount = 0; this.policyConsensusAgreementCount = 0;
    this.policyConsensusDisagreementCount = 0;
    this.candidateConsensusCount = 0; this.candidateConsensusTrueCount = 0;
    this.candidateConsensusFalseCount = 0;
    this.selectiveVerifierAttemptCount = 0;
    this.selectiveVerifierCertifiedCount = 0;
    this.selectiveVerifierRejectedCount = 0;
    this.selectiveVerifierIncompleteCount = 0;
    this.selectiveVerifierMissedCertificateCount = 0;
    this.selectiveVerifierPortfolioNodeCount = 0;
    this.selectiveVerifierPortfolioTransitionCount = 0;
    this.selectiveVerifierPrimitiveNodeCount = 0;
    this.selectiveVerifierPrimitiveTransitionCount = 0;
    this.policyRelationPatternCount = new Uint32Array(
      RELATION_WIDTH * RELATION_WIDTH * RELATION_WIDTH);
    this.censusHotAllocationCount = 0;
  }

  combine() {
    this.baseMassSum.fill(0); this.candidateMassSum.fill(0);
    let totalWeight = 0; let baseMask = 0; let candidateMask = 0;
    for (let id = 0; id < ENEMY_RESPONSE_POLICY.COUNT; id += 1) {
      const policy = this.policy[id]; const weight = this.weights[id];
      totalWeight += weight; baseMask |= policy.baseMask;
      candidateMask |= policy.candidateMask;
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
        (this.candidateMassSum[dimension] + (totalWeight >> 1)) / totalWeight));
    }
    return [baseMask, candidateMask];
  }

  observe(engine, search, incumbentAction, incumbentArgument) {
    if (this.mode === "off") return null;
    const fullBefore = this.full.pairCount;
    const fullNodesBefore = this.full.baseNodeCount +
      this.full.candidateNodeCount;
    const fullTransitionsBefore = this.full.baseTransitionCount +
      this.full.candidateTransitionCount;
    this.full.observe(engine, search, incumbentAction, incumbentArgument);
    if (this.full.pairCount === fullBefore) return null;
    const fullPairNodes = this.full.baseNodeCount +
      this.full.candidateNodeCount - fullNodesBefore;
    const fullPairTransitions = this.full.baseTransitionCount +
      this.full.candidateTransitionCount - fullTransitionsBefore;
    let portfolioNodesBefore = 0; let portfolioTransitionsBefore = 0;
    for (let id = 0; id < ENEMY_RESPONSE_POLICY.COUNT; id += 1) {
      portfolioNodesBefore += this.policy[id].baseNodeCount +
        this.policy[id].candidateNodeCount;
      portfolioTransitionsBefore += this.policy[id].baseTransitionCount +
        this.policy[id].candidateTransitionCount;
    }
    for (let id = 0; id < ENEMY_RESPONSE_POLICY.COUNT; id += 1) {
      const policy = this.policy[id]; const before = policy.pairCount;
      policy.observe(engine, search, incumbentAction, incumbentArgument);
      if (policy.pairCount === before ||
          policy.lastAction !== this.full.lastAction ||
          policy.lastArgument !== this.full.lastArgument) {
        this.rootMismatchCount += 1; return null;
      }
    }
    let portfolioNodesAfter = 0; let portfolioTransitionsAfter = 0;
    for (let id = 0; id < ENEMY_RESPONSE_POLICY.COUNT; id += 1) {
      portfolioNodesAfter += this.policy[id].baseNodeCount +
        this.policy[id].candidateNodeCount;
      portfolioTransitionsAfter += this.policy[id].baseTransitionCount +
        this.policy[id].candidateTransitionCount;
    }
    this.selectiveVerifierPortfolioNodeCount +=
      portfolioNodesAfter - portfolioNodesBefore;
    this.selectiveVerifierPortfolioTransitionCount +=
      portfolioTransitionsAfter - portfolioTransitionsBefore;
    this.rootCount += 1;
    const masks = this.combine(); const baseMask = masks[0];
    const candidateMask = masks[1];
    let relation = responseRelation(baseMask, this.baseMass,
      candidateMask, this.candidateMass);
    const incomplete = (baseMask | candidateMask) & INCOMPLETE_MASK;
    if (incomplete && relation !== RESPONSE_RELATION.EQUAL)
      relation = RESPONSE_RELATION.INCOMPLETE;
    const fullRelation = this.full.lastRelation;
    const relation0 = this.policy[0].lastRelation;
    const relation1 = this.policy[1].lastRelation;
    const relation2 = this.policy[2].lastRelation;
    this.policyRelationPatternCount[
      (relation0 * RELATION_WIDTH + relation1) * RELATION_WIDTH +
        relation2] += 1;
    if (relation0 === relation1 && relation1 === relation2 &&
        relation0 !== RESPONSE_RELATION.INCOMPLETE) {
      this.policyConsensusCount += 1;
      if (relation0 === fullRelation) this.policyConsensusAgreementCount += 1;
      else this.policyConsensusDisagreementCount += 1;
      if (relation0 === RESPONSE_RELATION.CANDIDATE_DOMINATES) {
        this.candidateConsensusCount += 1;
        if (fullRelation === RESPONSE_RELATION.CANDIDATE_DOMINATES)
          this.candidateConsensusTrueCount += 1;
        else this.candidateConsensusFalseCount += 1;
      }
    }
    // Counterfactual work ledger for the intended two-channel architecture:
    // run the cheap portfolio on every root, and pay for the complete
    // primitive verifier only when the portfolio proposes candidate
    // dominance.  The census still runs both paths to obtain ground truth;
    // these counters describe what the selective production schedule would
    // have charged.
    if (relation === RESPONSE_RELATION.CANDIDATE_DOMINATES) {
      this.selectiveVerifierAttemptCount += 1;
      this.selectiveVerifierPrimitiveNodeCount += fullPairNodes;
      this.selectiveVerifierPrimitiveTransitionCount += fullPairTransitions;
      if (fullRelation === RESPONSE_RELATION.CANDIDATE_DOMINATES)
        this.selectiveVerifierCertifiedCount += 1;
      else if (fullRelation === RESPONSE_RELATION.INCOMPLETE)
        this.selectiveVerifierIncompleteCount += 1;
      else this.selectiveVerifierRejectedCount += 1;
    } else if (fullRelation === RESPONSE_RELATION.CANDIDATE_DOMINATES)
      this.selectiveVerifierMissedCertificateCount += 1;
    this.relationMatrix[fullRelation * RELATION_WIDTH + relation] += 1;
    if (fullRelation === relation) this.relationAgreementCount += 1;
    else this.relationDisagreementCount += 1;
    let exact = this.full.baseMask === baseMask &&
      this.full.candidateMask === candidateMask;
    for (let dimension = 0; dimension < MASS_DIMENSION && exact;
      dimension += 1)
      exact = this.full.baseMass[dimension] === this.baseMass[dimension] &&
        this.full.candidateMass[dimension] === this.candidateMass[dimension];
    if (exact) this.exactMassCount += 1;
    const fullComplete = fullRelation !== RESPONSE_RELATION.INCOMPLETE;
    const optionComplete = relation !== RESPONSE_RELATION.INCOMPLETE;
    if (optionComplete) this.pairCompleteCount += 1;
    else this.pairIncompleteCount += 1;
    if (fullComplete && optionComplete)
      this.fullCompleteOptionCompleteCount += 1;
    else if (fullComplete) this.fullCompleteOptionIncompleteCount += 1;
    else if (optionComplete) this.fullIncompleteOptionCompleteCount += 1;
    else this.fullIncompleteOptionIncompleteCount += 1;
    if (relation === RESPONSE_RELATION.EQUAL) this.equalCount += 1;
    else if (relation === RESPONSE_RELATION.CANDIDATE_DOMINATES)
      this.candidateDominanceCount += 1;
    else if (relation === RESPONSE_RELATION.BASE_DOMINATES)
      this.baseDominanceCount += 1;
    else if (relation === RESPONSE_RELATION.TRADEOFF) this.tradeoffCount += 1;
    this.baseOutcomeMaskCount[baseMask & 0xff] += 1;
    this.candidateOutcomeMaskCount[candidateMask & 0xff] += 1;
    for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1) {
      this.baseMassTotal[dimension] += this.baseMass[dimension];
      this.candidateMassTotal[dimension] += this.candidateMass[dimension];
      this.massDeltaTotal[dimension] +=
        this.candidateMass[dimension] - this.baseMass[dimension];
    }
    return null;
  }

  closeHostOverride(engine, originalAction, originalArgument, resolved) {
    return resolved;
  }

  summary() {
    const first = this.policy[0].summary(); const full = this.full.summary();
    const route = new Uint32Array(ENEMY_RESPONSE_POLICY.COUNT * ACTION_WIDTH);
    let enemyPolicyStateCount = 0;
    let baseNodeCount = 0; let candidateNodeCount = 0;
    let baseTransitionCount = 0; let candidateTransitionCount = 0;
    let budgetStopCount = 0; let rootRestoreFailureCount = 0;
    for (let id = 0; id < ENEMY_RESPONSE_POLICY.COUNT; id += 1) {
      const item = this.policy[id].summary();
      enemyPolicyStateCount += item.enemyPolicyStateCount || 0;
      baseNodeCount += item.baseNodeCount || 0;
      candidateNodeCount += item.candidateNodeCount || 0;
      baseTransitionCount += item.baseTransitionCount || 0;
      candidateTransitionCount += item.candidateTransitionCount || 0;
      budgetStopCount += item.budgetStopCount || 0;
      rootRestoreFailureCount += item.rootRestoreFailureCount || 0;
      for (let action = 0; action < ACTION_WIDTH; action += 1)
        route[id * ACTION_WIDTH + action] =
          item.enemyPolicyRouteByAction[action] || 0;
    }
    return { ...first,
      semantics: "ENEMY_RESPONSE_POLICY_PORTFOLIO_FIDELITY_CENSUS",
      enemyResponsePortfolioCensus: true,
      enemyResponseOptionCensus: false,
      enemyPortfolioPolicyCount: ENEMY_RESPONSE_POLICY.COUNT,
      enemyPortfolioPrimitivePrefixDepth: first.primitivePrefixDepth,
      enemyPortfolioWeights: Array.from(this.weights),
      enemyPolicyStateCount,
      enemyPolicyRouteByPolicyAction: Array.from(route),
      pairCount: this.rootCount,
      pairCompleteCount: this.pairCompleteCount,
      pairIncompleteCount: this.pairIncompleteCount,
      equalCount: this.equalCount,
      candidateDominanceCount: this.candidateDominanceCount,
      baseDominanceCount: this.baseDominanceCount,
      tradeoffCount: this.tradeoffCount,
      baseNodeCount, candidateNodeCount,
      baseTransitionCount, candidateTransitionCount,
      budgetStopCount, rootRestoreFailureCount,
      baseMassTotal: Array.from(this.baseMassTotal),
      candidateMassTotal: Array.from(this.candidateMassTotal),
      massDeltaTotal: Array.from(this.massDeltaTotal),
      baseOutcomeMaskCount: Array.from(this.baseOutcomeMaskCount),
      candidateOutcomeMaskCount: Array.from(this.candidateOutcomeMaskCount),
      optionCensusRootCount: this.rootCount,
      optionCensusRootMismatchCount: this.rootMismatchCount,
      optionRelationAgreementCount: this.relationAgreementCount,
      optionRelationDisagreementCount: this.relationDisagreementCount,
      optionExactMassCount: this.exactMassCount,
      fullCompleteOptionCompleteCount: this.fullCompleteOptionCompleteCount,
      fullCompleteOptionIncompleteCount: this.fullCompleteOptionIncompleteCount,
      fullIncompleteOptionCompleteCount: this.fullIncompleteOptionCompleteCount,
      fullIncompleteOptionIncompleteCount:
        this.fullIncompleteOptionIncompleteCount,
      optionRelationMatrix: Array.from(this.relationMatrix),
      policyConsensusCount: this.policyConsensusCount,
      policyConsensusAgreementCount: this.policyConsensusAgreementCount,
      policyConsensusDisagreementCount: this.policyConsensusDisagreementCount,
      candidateConsensusCount: this.candidateConsensusCount,
      candidateConsensusTrueCount: this.candidateConsensusTrueCount,
      candidateConsensusFalseCount: this.candidateConsensusFalseCount,
      selectiveVerifierAttemptCount: this.selectiveVerifierAttemptCount,
      selectiveVerifierCertifiedCount: this.selectiveVerifierCertifiedCount,
      selectiveVerifierRejectedCount: this.selectiveVerifierRejectedCount,
      selectiveVerifierIncompleteCount: this.selectiveVerifierIncompleteCount,
      selectiveVerifierMissedCertificateCount:
        this.selectiveVerifierMissedCertificateCount,
      selectiveVerifierPortfolioNodeCount:
        this.selectiveVerifierPortfolioNodeCount,
      selectiveVerifierPortfolioTransitionCount:
        this.selectiveVerifierPortfolioTransitionCount,
      selectiveVerifierPrimitiveNodeCount:
        this.selectiveVerifierPrimitiveNodeCount,
      selectiveVerifierPrimitiveTransitionCount:
        this.selectiveVerifierPrimitiveTransitionCount,
      policyRelationPatternCount: Array.from(this.policyRelationPatternCount),
      fullBaseNodeCount: full.baseNodeCount,
      fullCandidateNodeCount: full.candidateNodeCount,
      fullBaseTransitionCount: full.baseTransitionCount,
      fullCandidateTransitionCount: full.candidateTransitionCount,
      fullBudgetStopCount: full.budgetStopCount,
      fullPairCompleteCount: full.pairCompleteCount,
      fullPairIncompleteCount: full.pairIncompleteCount,
      fullRootRestoreFailureCount: full.rootRestoreFailureCount,
      optionCensusHotAllocationCount: this.censusHotAllocationCount };
  }
}

module.exports = { ENEMY_RESPONSE_POLICY, POLICY_WEIGHTS,
  NativeEnemyPolicyResponseMassPoc, NativeEnemyResponsePortfolioCensusPoc,
  dominates, responseRelation };
