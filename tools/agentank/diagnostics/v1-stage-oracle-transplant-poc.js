"use strict";

// Diagnostic inverse transplant. A frozen structured V1 controller observes
// the same root as V2. Only one named V1 component port may propose an action;
// V2 strict owners, committed hazards and Physical Hard retain priority.

const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { V3_SLOT } = require("../../../engine-v3/src/contracts");

const ACTION_FAMILY = Object.freeze({ NONE: 0, GO: 1, TURN: 2, FIRE: 3,
  RESOURCE: 4 });
const ACTION_FAMILY_COUNT = 5;

function actionFamily(action) {
  if (action === ACTION.GO) return ACTION_FAMILY.GO;
  if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT)
    return ACTION_FAMILY.TURN;
  if (action === ACTION.FIRE) return ACTION_FAMILY.FIRE;
  if (action === ACTION.NONE) return ACTION_FAMILY.NONE;
  return ACTION_FAMILY.RESOURCE;
}

const V1_ORACLE_STAGE = Object.freeze({
  DIRECT_ATTACK: V3_SLOT.DIRECT_ATTACK,
  TACTICAL_SEARCH: V3_SLOT.TACTICAL_SEARCH
});

class V1StageOracleTransplantPoc {
  constructor(oracle, stage = V1_ORACLE_STAGE.DIRECT_ATTACK, options = {}) {
    this.oracle = oracle; this.stage = stage;
    this.requireRisk = options.requireRisk === true;
    this.checkCount = 0; this.stageCallCount = 0; this.noProposalCount = 0;
    this.strictOwnerSkipCount = 0; this.committedSkipCount = 0;
    this.noRowCount = 0; this.hardBlockedCount = 0;
    this.riskBlockedCount = 0; this.dominatedBlockedCount = 0;
    this.proposalCount = 0; this.sameActionCount = 0; this.overrideCount = 0;
    this.goOverrideCount = 0; this.turnOverrideCount = 0;
    this.fireOverrideCount = 0; this.otherOverrideCount = 0;
    // Behavior-neutral ownership attribution. The oracle proposal remains the
    // action owner; these counters only explain which V2 layer disagrees.
    this.proposalRiskAcceptCount = 0; this.proposalRiskRejectCount = 0;
    this.proposalDominatedCount = 0; this.proposalPurposeCompleteCount = 0;
    this.proposalPurposeMissingCount = 0;
    this.physicalValueCount = 0; this.informationValueCount = 0;
    this.incompleteValueCount = 0; this.unsupportedValueCount = 0;
    this.proposalValueHigherCount = 0; this.proposalValueEqualCount = 0;
    this.proposalValueLowerCount = 0; this.proposalValueMarginSum = 0;
    this.proposalRobustHigherCount = 0; this.proposalRobustEqualCount = 0;
    this.proposalRobustLowerCount = 0;
    this.familyDisagreement = new Uint32Array(
      ACTION_FAMILY_COUNT * ACTION_FAMILY_COUNT);
    this.searchRoundsCount = new Uint32Array(5);
    this.lastSearchRounds = 0;
    this.lastPolicyEvaluated = null;
    this.lastPolicyTransitionCensus = null;
    this.lastPolicyRootSnapshot = null;
    this.lastPolicyRecursionCensus = null;
    this.lastMonteCarloUsed = 0;
    this.lastProposedAction = ACTION.NONE;
    this.lastRuntimeIntent = null;
    this.lastRuntimeIntentEpoch = -1;
    this.lastRuntimeContextEpoch = 0;
    this.policyValueRootCount = 0; this.monteCarloRootCount = 0;
    this.hotAllocationCount = 0;
  }

  rowFor(engine, action) {
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === action) return row;
    return -1;
  }

  valueSource(engine) {
    const information = engine.informationSearch;
    if (information?.completedDepth > 0 && information.supportComplete === 1 &&
        information.approximate === 0) {
      this.informationValueCount += 1; return information;
    }
    const physical = engine.depthSearch;
    if (physical?.completedDepth > 0 &&
        physical.representativeSupportComplete === 1) {
      this.physicalValueCount += 1; return physical;
    }
    this.incompleteValueCount += 1; return null;
  }

  auditProposal(engine, selected, row, proposed) {
    const selectedAction = selected >= 0 && selected < engine.ourCount ?
      engine.ourActions[selected] : ACTION.NONE;
    this.familyDisagreement[actionFamily(selectedAction) * ACTION_FAMILY_COUNT +
      actionFamily(proposed)] += 1;
    const outcome = engine.riskController?.outcome;
    if (outcome && row < outcome.count) {
      if (outcome.acceptable[row]) this.proposalRiskAcceptCount += 1;
      else this.proposalRiskRejectCount += 1;
      if (outcome.dominated[row]) this.proposalDominatedCount += 1;
      if (outcome.robustLower && selected >= 0 && selected < outcome.count) {
        const candidate = outcome.robustLower[row];
        const incumbent = outcome.robustLower[selected];
        if (candidate > incumbent) this.proposalRobustHigherCount += 1;
        else if (candidate < incumbent) this.proposalRobustLowerCount += 1;
        else this.proposalRobustEqualCount += 1;
      }
    }
    const combat = engine.combat?.vector;
    if (combat && row < combat.count && combat.purposeCompleteness[row])
      this.proposalPurposeCompleteCount += 1;
    else this.proposalPurposeMissingCount += 1;
    const source = this.valueSource(engine);
    if (!source || selected < 0 || selected >= engine.ourCount ||
        source.rootDomainRestricted && (!source.rootDomainMask[row] ||
          !source.rootDomainMask[selected])) {
      if (source) this.unsupportedValueCount += 1;
      return;
    }
    const margin = source.rootScore[row] - source.rootScore[selected];
    this.proposalValueMarginSum += margin;
    if (margin > 0) this.proposalValueHigherCount += 1;
    else if (margin < 0) this.proposalValueLowerCount += 1;
    else this.proposalValueEqualCount += 1;
  }

  selectOverride(engine, selected, action, argument, context) {
    this.checkCount += 1;
    this.lastSearchRounds = 0;
    this.lastPolicyEvaluated = null;
    this.lastPolicyTransitionCensus = null;
    this.lastPolicyRootSnapshot = null;
    this.lastPolicyRecursionCensus = null;
    this.lastMonteCarloUsed = 0;
    this.lastProposedAction = ACTION.NONE;
    this.oracle.decide(context);
    const sandbox = this.oracle?.controller?.runtime?.sandbox;
    this.lastRuntimeIntent = sandbox?.AT_LAST_INTENT || null;
    this.lastRuntimeIntentEpoch = Number.isSafeInteger(sandbox?.AT_LAST_INTENT_EPOCH) ?
      sandbox.AT_LAST_INTENT_EPOCH : -1;
    this.lastRuntimeContextEpoch = Number.isSafeInteger(sandbox?.AT_CONTEXT_EPOCH) ?
      sandbox.AT_CONTEXT_EPOCH : 0;
    this.lastRuntimeContextSignature = typeof sandbox?.AT_LAST_CONTEXT_SIGNATURE ===
      "string" ? sandbox.AT_LAST_CONTEXT_SIGNATURE : null;
    const trace = this.oracle.controller.ownershipTrace;
    if (!trace.called[this.stage]) { this.noProposalCount += 1; return null; }
    this.stageCallCount += 1;
    if (this.stage === V1_ORACLE_STAGE.TACTICAL_SEARCH) {
      const invocation = this.oracle.controller.registry?.invocations?.[this.stage];
      this.lastSearchRounds = Math.max(0, Math.min(4,
        invocation?.searchRounds | 0));
      this.searchRoundsCount[this.lastSearchRounds] += 1;
      this.lastPolicyEvaluated = invocation?.searchState?._v3PolicyEvaluated || null;
      this.lastPolicyTransitionCensus =
        invocation?.searchState?._v3PolicyTransitionCensus || null;
      this.lastPolicyRootSnapshot =
        invocation?.searchState?._v3PolicyRootSnapshot || null;
      this.lastPolicyRecursionCensus =
        invocation?.searchState?._v3PolicyRecursionCensus || null;
      this.lastMonteCarloUsed = invocation?.searchState?._monteCarloUsed ? 1 : 0;
      if (this.lastPolicyEvaluated) this.policyValueRootCount += 1;
      if (this.lastMonteCarloUsed) this.monteCarloRootCount += 1;
    }
    const proposed = trace.returnedAction[this.stage] | 0;
    this.lastProposedAction = proposed;
    if (proposed === ACTION.NONE) { this.noProposalCount += 1; return null; }
    if (engine.lastProofStatus === PROOF_STATUS.PROVEN ||
        engine.lastSelectionWasStrictRescue ||
        engine.lastSelectionWasVerifiedDirectKill) {
      this.strictOwnerSkipCount += 1; return null;
    }
    const escape = engine.escapeObligation;
    if (escape && escape.committedEntityCount > 0) {
      this.committedSkipCount += 1; return null;
    }
    const row = this.rowFor(engine, proposed);
    if (row < 0) { this.noRowCount += 1; return null; }
    if (engine.hardStatus[row] !== HARD_STATUS.ALLOW) {
      this.hardBlockedCount += 1; return null;
    }
    this.auditProposal(engine, selected, row, proposed);
    if (this.requireRisk) {
      const outcome = engine.riskController?.outcome;
      if (!outcome || row >= outcome.count || !outcome.acceptable[row]) {
        this.riskBlockedCount += 1; return null;
      }
      if (outcome.dominated[row]) {
        this.dominatedBlockedCount += 1; return null;
      }
    }
    this.proposalCount += 1;
    if (proposed === action) { this.sameActionCount += 1; return null; }
    this.overrideCount += 1;
    if (proposed === ACTION.GO) this.goOverrideCount += 1;
    else if (proposed === ACTION.TURN_LEFT || proposed === ACTION.TURN_RIGHT)
      this.turnOverrideCount += 1;
    else if (proposed === ACTION.FIRE) this.fireOverrideCount += 1;
    else this.otherOverrideCount += 1;
    return { action: proposed, argument: engine.ourArguments[row] };
  }

  summary() {
    const familyDisagreement = {};
    const names = ["NONE", "GO", "TURN", "FIRE", "RESOURCE"];
    for (let from = 0; from < ACTION_FAMILY_COUNT; from += 1)
      for (let to = 0; to < ACTION_FAMILY_COUNT; to += 1) {
        const count = this.familyDisagreement[from * ACTION_FAMILY_COUNT + to];
        if (count) familyDisagreement[`${names[from]}->${names[to]}`] = count;
      }
    return { enabled: true, stage: this.stage, requireRisk: this.requireRisk,
      checkCount: this.checkCount,
      stageCallCount: this.stageCallCount, noProposalCount: this.noProposalCount,
      strictOwnerSkipCount: this.strictOwnerSkipCount,
      committedSkipCount: this.committedSkipCount, noRowCount: this.noRowCount,
      hardBlockedCount: this.hardBlockedCount,
      riskBlockedCount: this.riskBlockedCount,
      dominatedBlockedCount: this.dominatedBlockedCount,
      proposalCount: this.proposalCount,
      sameActionCount: this.sameActionCount, overrideCount: this.overrideCount,
      goOverrideCount: this.goOverrideCount, turnOverrideCount: this.turnOverrideCount,
      fireOverrideCount: this.fireOverrideCount, otherOverrideCount: this.otherOverrideCount,
      ownershipAttribution: {
        proposalRiskAcceptCount: this.proposalRiskAcceptCount,
        proposalRiskRejectCount: this.proposalRiskRejectCount,
        proposalDominatedCount: this.proposalDominatedCount,
        proposalPurposeCompleteCount: this.proposalPurposeCompleteCount,
        proposalPurposeMissingCount: this.proposalPurposeMissingCount,
        physicalValueCount: this.physicalValueCount,
        informationValueCount: this.informationValueCount,
        incompleteValueCount: this.incompleteValueCount,
        unsupportedValueCount: this.unsupportedValueCount,
        proposalValueHigherCount: this.proposalValueHigherCount,
        proposalValueEqualCount: this.proposalValueEqualCount,
        proposalValueLowerCount: this.proposalValueLowerCount,
        proposalValueMarginSum: this.proposalValueMarginSum,
        proposalRobustHigherCount: this.proposalRobustHigherCount,
        proposalRobustEqualCount: this.proposalRobustEqualCount,
        proposalRobustLowerCount: this.proposalRobustLowerCount,
        familyDisagreement
      },
      searchRoundsCount: Array.from(this.searchRoundsCount),
      policyValueRootCount: this.policyValueRootCount,
      monteCarloRootCount: this.monteCarloRootCount,
      hotAllocationCount: this.hotAllocationCount, oracle: this.oracle.summary() };
  }
}

module.exports = { ACTION_FAMILY, V1_ORACLE_STAGE, V1StageOracleTransplantPoc };
