"use strict";

const { ACTION, NONE_CELL } = require("../../../engine-v2/src/abi/fast-codes");
const { NativeStunTurnDomainCompactionPoc } = require(
  "./native-stun-turn-domain-compaction-poc");
const { StatefulOptionRollout, OPTION_KIND } = require(
  "./stateful-option-rollout");
const { RESPONSE_RELATION } = require("./native-long-option-response-mass-poc");

const DOMAIN_WIDTH = 6;
const RELATION_WIDTH = RESPONSE_RELATION.INCOMPLETE + 1;

function exactMassEqual(left, right) {
  if (left.baseMask !== right.baseMask ||
      left.candidateMask !== right.candidateMask) return false;
  for (let index = 0; index < left.baseMass.length; index += 1)
    if (left.baseMass[index] !== right.baseMass[index] ||
        left.candidateMass[index] !== right.candidateMass[index]) return false;
  return true;
}

class NativeEnemyNominalOptionResponseMassPoc extends
    NativeStunTurnDomainCompactionPoc {
  constructor(mode = "off", options = {}) {
    super(mode, options);
    this.enemyOption = options.enemyOption || new StatefulOptionRollout(2,
      this.maximumFrames);
    this.enemyOptionStateCount = 0;
    this.enemyOptionRouteByAction = new Uint32Array(ACTION.BOOST_RIGHT_BOMB + 1);
    this.enemyOptionHotAllocationCount = 0;
  }

  copyEnemyDomain(engine, search, depth) {
    if (depth === 0) return super.copyEnemyDomain(engine, search, depth);
    const state = engine.adapter.state;
    this.enemyOption.bind(state);
    const action = this.enemyOption.nominalAction(1, OPTION_KIND.POSITION);
    const offset = depth * DOMAIN_WIDTH;
    this.enemyActions[offset] = action;
    this.enemyArguments[offset] = NONE_CELL;
    this.enemyCount[depth] = 1;
    this.compactedIndex[depth] = 255;
    this.enemyOptionStateCount += 1;
    this.enemyOptionRouteByAction[action] += 1;
    return 1;
  }

  summary() {
    return { ...super.summary(),
      semantics: "DUAL_POLICY_ENEMY_NOMINAL_RESPONSE_OPTION",
      enemyResponseOption: true,
      enemyOptionStateCount: this.enemyOptionStateCount,
      enemyOptionRouteByAction: Array.from(this.enemyOptionRouteByAction),
      enemyOptionHotAllocationCount: this.enemyOptionHotAllocationCount };
  }
}

class NativeEnemyResponseOptionCensusPoc {
  constructor(mode = "off", options = {}) {
    this.mode = mode === "shadow" ? "shadow" : "off";
    this.full = options.full || new NativeStunTurnDomainCompactionPoc(
      this.mode, options);
    this.option = options.option || new NativeEnemyNominalOptionResponseMassPoc(
      this.mode, options);
    this.rootCount = 0;
    this.rootMismatchCount = 0;
    this.relationAgreementCount = 0;
    this.relationDisagreementCount = 0;
    this.exactMassCount = 0;
    this.fullCompleteOptionCompleteCount = 0;
    this.fullCompleteOptionIncompleteCount = 0;
    this.fullIncompleteOptionCompleteCount = 0;
    this.fullIncompleteOptionIncompleteCount = 0;
    this.relationMatrix = new Uint32Array(RELATION_WIDTH * RELATION_WIDTH);
    this.censusHotAllocationCount = 0;
  }

  observe(engine, search, incumbentAction, incumbentArgument) {
    if (this.mode === "off") return null;
    const fullBefore = this.full.pairCount;
    const optionBefore = this.option.pairCount;
    this.full.observe(engine, search, incumbentAction, incumbentArgument);
    this.option.observe(engine, search, incumbentAction, incumbentArgument);
    if (this.full.pairCount === fullBefore ||
        this.option.pairCount === optionBefore) return null;
    if (this.full.lastAction !== this.option.lastAction ||
        this.full.lastArgument !== this.option.lastArgument) {
      this.rootMismatchCount += 1; return null;
    }
    this.rootCount += 1;
    const fullRelation = this.full.lastRelation;
    const optionRelation = this.option.lastRelation;
    this.relationMatrix[fullRelation * RELATION_WIDTH + optionRelation] += 1;
    if (fullRelation === optionRelation) this.relationAgreementCount += 1;
    else this.relationDisagreementCount += 1;
    if (exactMassEqual(this.full, this.option)) this.exactMassCount += 1;
    const fullComplete = fullRelation !== RESPONSE_RELATION.INCOMPLETE;
    const optionComplete = optionRelation !== RESPONSE_RELATION.INCOMPLETE;
    if (fullComplete && optionComplete)
      this.fullCompleteOptionCompleteCount += 1;
    else if (fullComplete) this.fullCompleteOptionIncompleteCount += 1;
    else if (optionComplete) this.fullIncompleteOptionCompleteCount += 1;
    else this.fullIncompleteOptionIncompleteCount += 1;
    return null;
  }

  // A fidelity census is observation-only.  Preserve the action already
  // resolved by the host (normally the frozen V3-base oracle); returning null
  // here would silently restore the pre-override V2 action in
  // ProductionDiagnosticBot.emit().
  closeHostOverride(engine, originalAction, originalArgument, resolved) {
    return resolved;
  }

  summary() {
    const summary = this.option.summary();
    const full = this.full.summary();
    return { ...summary,
      semantics: "ENEMY_RESPONSE_OPTION_FIDELITY_CENSUS",
      enemyResponseOptionCensus: true,
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

module.exports = { NativeEnemyNominalOptionResponseMassPoc,
  NativeEnemyResponseOptionCensusPoc, exactMassEqual };
