"use strict";

const { ProductionRootEngine, ROOT_STATUS, INFORMATION_GAP } =
  require("../../../engine-v2/src/runtime/production-root");
const { ROOT_CONTROL_MODE } =
  require("../../../engine-v2/src/runtime/root-control-mode");
const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { OPTION_KIND } = require("../../../engine-v2/src/policy/option-portfolio");
const { WORK_KIND, WORK_ACCOUNT } = require("../../../engine-v2/src/abi/cache-runtime-codes");
const { installSoftStackAblation } =
  require("../diagnostics/soft-stack-ablation-runtime");
const { ActionContinuationEnvelope } = require(
  "../../../engine-v2/src/search/action-continuation-envelope");
const { CommonPolicyOptionInterval } = require(
  "../../../engine-v2/src/search/common-policy-option-interval");
const { installStrategyPriorityDiagnostic } =
  require("../diagnostics/strategy-priority-runtime");
const { SelectiveInformationSearchProbe } =
  require("../diagnostics/selective-information-search-probe");
const { InformationSupportProbe } =
  require("../diagnostics/information-support-probe");
const { InformationIntervalOwnershipProbe } =
  require("../diagnostics/information-interval-ownership-probe");
const { SelectiveGeometrySearchProbe } =
  require("../diagnostics/selective-geometry-search-probe");
const { RiskFrontierPhysicalSearchProbe } =
  require("../diagnostics/risk-frontier-physical-search-probe");
const { NoAcceptableCensus } = require("../diagnostics/no-acceptable-census");
const { AttackOpportunityCensus } = require("../diagnostics/attack-opportunity-census");
const { VerifiedAttackProposal } = require("../diagnostics/verified-attack-proposal");
const { AttackObjectiveFieldProposal } = require("../diagnostics/attack-objective-field");
const { EventDrivenOptionShadow } = require(
  "../diagnostics/event-driven-option-shadow");
const { StableOptionLedgerShadow } = require(
  "../diagnostics/stable-option-ledger-shadow");
const { StrategicStateLedgerShadow } = require(
  "../diagnostics/strategic-state-ledger-shadow");
const { ObjectiveEpochContinuityShadow } = require(
  "../diagnostics/objective-epoch-continuity-shadow");
const { ObjectiveEpochExecutionShadow } = require(
  "../diagnostics/objective-epoch-execution-shadow");
const { ObjectiveEpochOptionArbiterShadow } = require(
  "../diagnostics/objective-epoch-option-arbiter-shadow");
const { SemanticObjectiveEpochShadow } = require(
  "../diagnostics/semantic-objective-epoch-shadow");
const { SemanticAttackOptionCoverageShadow } = require(
  "../diagnostics/semantic-attack-option-coverage-shadow");
const { SemanticAttackExecutionIntervalShadow } = require(
  "../diagnostics/semantic-attack-execution-interval-shadow");
const { SemanticAttackPolicyIntervalShadow } = require(
  "../diagnostics/semantic-attack-policy-interval-shadow");
const { StrategicConflictArbiterShadow } = require(
  "../diagnostics/strategic-conflict-arbiter-shadow");
const { EXECUTION_STATUS, StrategicTargetExecutionShadow } = require(
  "../diagnostics/strategic-target-execution-shadow");
const { StableOptionIntervalShadow } = require(
  "../diagnostics/stable-option-interval-shadow");
const { AttackContinuationProgressShadow } = require(
  "../diagnostics/attack-continuation-progress-shadow");
const { AttackSequenceGeneratorShadow } = require(
  "../diagnostics/attack-sequence-generator-shadow");
const { AttackPolicyReachabilityShadow } = require(
  "../diagnostics/attack-policy-reachability-shadow");
const { AttackResponseSetShadow } = require(
  "../diagnostics/attack-response-set-shadow");
const { CombatUtilityEnvelopeShadow } = require(
  "../diagnostics/combat-utility-envelope-shadow");
const { AttackStarPolicyFrontierShadow } = require(
  "../diagnostics/attack-star-policy-frontier-shadow");
const { ResponseConditionedOptionPolicyShadow } = require(
  "../diagnostics/response-conditioned-option-policy-shadow");
const { RiskConditionedCombatProposal } = require(
  "../diagnostics/risk-conditioned-combat-proposal");
const { QualifiedAttackOverStarProposal } = require(
  "../diagnostics/qualified-attack-over-star");
const { StrategicAttackOverStarProposal } = require(
  "../diagnostics/strategic-attack-over-star-proposal");
const { PersistentAttackTargetController } = require(
  "../diagnostics/persistent-attack-target-controller");
const { OptionScopedTargetContinuationSearch } = require(
  "../diagnostics/option-scoped-target-continuation-search");

const ACTION_NAME = Object.freeze(Object.fromEntries(Object.entries(ACTION).map(([name, value]) => [value, name])));
const ROOT_NAME = Object.freeze(Object.fromEntries(Object.entries(ROOT_STATUS).map(([name, value]) => [value, name])));
const HARD_NAME = Object.freeze(Object.fromEntries(Object.entries(HARD_STATUS).map(([name, value]) => [value, name])));
const PROOF_NAME = Object.freeze(Object.fromEntries(Object.entries(PROOF_STATUS).map(([name, value]) => [value, name])));
const WORK_KIND_NAME = Object.freeze(Object.fromEntries(Object.entries(WORK_KIND)
  .filter(([name]) => name !== "COUNT").map(([name, value]) => [value, name])));
const PHASE_NAME = Object.freeze([
  "OBSERVATION", "NAVIGATION", "PLAN_SKETCH", "HIDDEN_RISK", "FINAL_HARD",
  "SAFETY_CLOSURE", "MULTI_FRAME_RISK", "OBSERVATION_SAFETY", "COMMITTED_EO",
  "COMBAT_VECTOR", "PROJECTILE_ATTACK", "STRATEGY_EVIDENCE", "FORCED_WIN",
  "PHYSICAL_SEARCH", "INFORMATION_SEARCH", "INFORMATION_OVERLAY", "STAGE_MATRIX",
  "FINAL_SELECTION", "FAST_APPLY", "HARD_CLASSIFY", "REVERSE_VIABILITY",
  "DEPTH_HEURISTIC", "INFO_CONTINUATION", "MATRIX_SOLVER"
]);
const SAMPLE_FRAME_STRIDE = 19;

function rootFlag(status) {
  return status === ROOT_STATUS.OK ? 0 : status === ROOT_STATUS.INCOMPLETE ? 1 :
    status === ROOT_STATUS.INVALID ? 2 : 3;
}

function actionProxy(snapshot, actions) {
  const proxy = {
    tank: snapshot.tank, stars: snapshot.stars, bullet: snapshot.bullet,
    skill: snapshot.skill, status: snapshot.status, effects: snapshot.effects,
    go() { actions.push({ type: "go" }); },
    turn(side) { actions.push({ type: "turn", side: side === "left" ? "left" : "right" }); },
    fire() { actions.push({ type: "fire" }); },
    throwBomb() { actions.push({ type: "throwBomb" }); }
  };
  const skill = snapshot.skill?.type;
  if (skill) proxy[skill] = (...values) => actions.push(skill === "teleport" ?
    { type: skill, x: Number(values[0]), y: Number(values[1]) } : { type: skill });
  return proxy;
}

function percentile(values, numerator) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * numerator / 100))];
}

function diagnosticCopy(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function emittedActionRow(engine, returned) {
  let emittedRow = engine.diagnosticFinalOverrideIndex;
  if (emittedRow >= 0 && emittedRow < engine.ourCount &&
      engine.ourActions[emittedRow] === returned) return emittedRow;
  const internal = engine.diagnosticInternalSelectedIndex;
  if (internal >= 0 && internal < engine.ourCount &&
      engine.ourActions[internal] === returned) return internal;
  const emittedArgument = engine.diagnosticFinalOverrideArgument;
  emittedRow = -1;
  for (let index = 0; index < engine.ourCount; index += 1) {
    if (engine.ourActions[index] !== returned ||
        engine.ourArguments[index] !== emittedArgument) continue;
    if (emittedRow < 0 || engine.hardStatus[index] === HARD_STATUS.ALLOW)
      emittedRow = index;
  }
  return emittedRow;
}

class ProductionDiagnosticBot {
  constructor(options = {}) {
    const engineOptions = options.engine || options;
    this.engine = new ProductionRootEngine(engineOptions);
    // ProductionRoot clears lastSelectedIndex after emission. Preserve the
    // internal row in the diagnostic wrapper so an outer action-owner POC can
    // be audited against the action that the production selector originally
    // chose. This is observation only and never changes the selected row.
    const selectAction = this.engine.selectAction.bind(this.engine);
    this.engine.selectAction = function selectActionWithDiagnosticAudit(...args) {
      const selected = selectAction(...args);
      this.diagnosticInternalSelectedIndex = selected;
      this.diagnosticInternalSelectedDominated = selected >= 0 &&
        selected < this.riskController.outcome.count ?
        this.riskController.outcome.dominated[selected] | 0 : 0;
      return selected;
    };
    // Root counterfactuals must bind the state seen by FinalActionGate, before
    // emit/ACTION_EMIT advances pending commands or observation bookkeeping.
    // Capturing after decide() returns creates a different physical identity.
    const finalGateSelect = this.engine.finalGate.select.bind(
      this.engine.finalGate);
    this.engine.finalGate.select = (...args) => {
      const state = this.engine.adapter.state;
      if (state) {
        this.engine.diagnosticPhysicalRootHashLo = state.hashLo;
        this.engine.diagnosticPhysicalRootHashHi = state.hashHi;
        this.engine.diagnosticPhysicalRootFrame =
          state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
      }
      return finalGateSelect(...args);
    };
    if (typeof options.diagnosticFinalActionOverride === "function") {
      const engine = this.engine;
      const emit = engine.emit.bind(engine);
      const override = options.diagnosticFinalActionOverride;
      const bot = this;
      engine.emit = function(me, action, argument) {
        const replacement = override(engine, action, argument, bot.currentContext);
        engine.diagnosticPreOverrideAction = action;
        engine.diagnosticPreOverrideArgument = argument;
        engine.diagnosticFinalOverrideAction = replacement &&
          Number.isSafeInteger(replacement.action) ? replacement.action : action;
        engine.diagnosticFinalOverrideArgument = replacement &&
          Number.isSafeInteger(replacement.argument) ? replacement.argument : argument;
        engine.diagnosticFinalOverrideIndex = replacement &&
          Number.isSafeInteger(replacement.row) ? replacement.row : -1;
        if (replacement && Number.isSafeInteger(replacement.action)) {
          const replacementArgument = Number.isSafeInteger(replacement.argument) ?
            replacement.argument : argument;
          if (typeof engine.diagnosticReplacementEmitter === "function")
            return engine.diagnosticReplacementEmitter(me, replacement.action,
              replacementArgument, emit);
          return emit(me, replacement.action, replacementArgument);
        }
        return emit(me, action, argument);
      };
    }
    this.stunDirectRootMatrixBuckets = new Uint32Array(33);
    this.stunDirectP2CompletedBuckets = new Uint32Array(33);
    this.stunDirectExactP2Buckets = new Uint32Array(33);
    this.stunDirectFailedBuckets = new Uint32Array(33);
    if (engineOptions.diagnosticDirectDepthTwoDuringStun) {
      const bot = this; const search = this.engine.depthSearch;
      const originalSearch = search.search;
      search.search = function(...args) {
        const rootsBefore = this.directStunRootCount;
        const p2Before = this.directStunP2Completed;
        const failedBefore = this.directStunP2Failed;
        const result = Reflect.apply(originalSearch, this, args);
        if (this.directStunRootCount > rootsBefore) {
          const matrixNodes = this.rootMatrixNodeCount(args[0].state);
          const bucket = Math.min(32, matrixNodes >>> 4);
          bot.stunDirectRootMatrixBuckets[bucket] += 1;
          if (this.directStunP2Completed > p2Before)
            bot.stunDirectP2CompletedBuckets[bucket] += 1;
          if (this.representativeSupportComplete && this.representativeSupportDepth >= 2)
            bot.stunDirectExactP2Buckets[bucket] += 1;
          if (this.directStunP2Failed > failedBefore)
            bot.stunDirectFailedBuckets[bucket] += 1;
        }
        return result;
      };
    }
    this.captureWorkLedger = Boolean(options.captureWorkLedger);
    this.workLedgerUnits = this.captureWorkLedger ? new Float64Array(WORK_KIND.COUNT) : null;
    this.workLedgerCalls = this.captureWorkLedger ? new Uint32Array(WORK_KIND.COUNT) : null;
    this.workAccountUnits = this.captureWorkLedger ? new Float64Array(WORK_ACCOUNT.COUNT) : null;
    if (this.captureWorkLedger) {
      const runtime = this.engine.runtime;
      const chargeUnits = runtime.chargeUnits.bind(runtime);
      runtime.chargeUnits = (units, kind = WORK_KIND.UNKNOWN, account) => {
        if (Number.isSafeInteger(units) && units >= 0 &&
            Number.isSafeInteger(kind) && kind >= 0 && kind < WORK_KIND.COUNT) {
          this.workLedgerUnits[kind] += units;
          this.workLedgerCalls[kind] += 1;
          const resolved = account === undefined ? runtime.defaultAccount(kind) : account;
          if (Number.isSafeInteger(resolved) && resolved >= 0 && resolved < WORK_ACCOUNT.COUNT)
            this.workAccountUnits[resolved] += units;
        }
        return chargeUnits(units, kind, account);
      };
    }
    this.softStackAblation = installSoftStackAblation(this.engine,
      engineOptions.diagnosticSoftMode);
    this.actionContinuationEnvelope = engineOptions.diagnosticActionContinuationEnvelope ?
      new ActionContinuationEnvelope(this.engine.runtime.runtimeConfig, {
        maximumRows: engineOptions.diagnosticActionContinuationRows,
        depth: engineOptions.diagnosticActionContinuationDepth,
        nodeBudget: engineOptions.diagnosticActionContinuationNodeBudget,
        cooldownFrames: engineOptions.diagnosticActionContinuationCooldownFrames,
        optionAware: engineOptions.diagnosticActionContinuationOptionAware,
        active: engineOptions.diagnosticActionContinuationActive,
        strictTargetOwnership:
          engineOptions.diagnosticActionContinuationStrictTargetOwnership,
        dynamicContactTarget:
          engineOptions.diagnosticActionContinuationDynamicContactTarget,
        postRiskArbitration:
          engineOptions.diagnosticActionContinuationPostRiskArbitration
      }) : null;
    if (this.actionContinuationEnvelope) {
      const envelope = this.actionContinuationEnvelope;
      const engine = this.engine;
      const selectFinalAction = engine.selectFinalAction.bind(engine);
      engine.selectFinalAction = (bundle, preferred, selectionCount,
        strictProof = 0, exactValueProposal = 0) => {
        const selected = selectFinalAction(bundle, preferred, selectionCount,
          strictProof, exactValueProposal);
        const proposal = !strictProof ?
          envelope.evaluate(engine, bundle, selected, selectionCount) : -1;
        if (proposal < 0 || proposal === selected) return selected;
        if (!engine.finalGate.finalAllows(bundle, engine.ourActions,
            engine.ourArguments, proposal, engine.ourCount)) {
          envelope.activeRejectedCount += 1; return selected;
        }
        // Diagnostic ablation only. Keep the original Pareto marker intact so
        // the report explicitly counts this as a soft-risk ownership override.
        // No source fatal/unknown mass is rewritten.
        engine.finalGate.lastSelected = proposal;
        return proposal;
      };
    }
    this.commonPolicyOptionInterval =
      engineOptions.diagnosticCommonPolicyOptionInterval ?
        new CommonPolicyOptionInterval(this.engine.runtime.runtimeConfig, {
          maximumRoots: engineOptions.diagnosticCommonPolicyOptionRoots,
          nodeBudget: engineOptions.diagnosticCommonPolicyOptionNodeBudget,
          active: engineOptions.diagnosticCommonPolicyOptionActive
        }) : null;
    if (this.commonPolicyOptionInterval) {
      const interval = this.commonPolicyOptionInterval;
      const engine = this.engine;
      const selectFinalAction = engine.selectFinalAction.bind(engine);
      engine.selectFinalAction = (bundle, preferred, selectionCount,
        strictProof = 0, exactValueProposal = 0) => {
        const selected = selectFinalAction(bundle, preferred, selectionCount,
          strictProof, exactValueProposal);
        const proposal = !strictProof ?
          interval.evaluate(engine, bundle, selected, selectionCount) : -1;
        if (proposal < 0 || proposal === selected) return selected;
        if (!engine.finalGate.finalAllows(bundle, engine.ourActions,
            engine.ourArguments, proposal, engine.ourCount)) return selected;
        engine.finalGate.lastSelected = proposal; return proposal;
      };
    }
    this.verifiedAttackProposal = engineOptions.diagnosticVerifiedAttackProposal ?
      new VerifiedAttackProposal({
        active: engineOptions.diagnosticVerifiedAttackProposalActive
      }) : null;
    if (this.verifiedAttackProposal) {
      const attack = this.verifiedAttackProposal;
      const engine = this.engine;
      const selectFinalAction = engine.selectFinalAction.bind(engine);
      engine.selectFinalAction = (bundle, preferred, selectionCount,
        strictProof = 0, exactValueProposal = 0) => {
        const selected = selectFinalAction(bundle, preferred, selectionCount,
          strictProof, exactValueProposal);
        const proposal = !strictProof && !exactValueProposal ?
          attack.evaluate(engine, selected, selectionCount) : -1;
        if (!attack.active || proposal < 0 || proposal === selected) return selected;
        if (!engine.finalGate.finalAllows(bundle, engine.ourActions,
            engine.ourArguments, proposal, engine.ourCount)) {
          attack.rejectFinal(); return selected;
        }
        attack.confirmOverride();
        engine.finalGate.lastSelected = proposal;
        return proposal;
      };
    }
    this.attackObjectiveField = engineOptions.diagnosticAttackObjectiveField ?
      new AttackObjectiveFieldProposal({
        active: engineOptions.diagnosticAttackObjectiveFieldActive
      }) : null;
    if (this.attackObjectiveField) {
      const objective = this.attackObjectiveField;
      const engine = this.engine;
      const selectFinalAction = engine.selectFinalAction.bind(engine);
      engine.selectFinalAction = (bundle, preferred, selectionCount,
        strictProof = 0, exactValueProposal = 0) => {
        const selected = selectFinalAction(bundle, preferred, selectionCount,
          strictProof, exactValueProposal);
        const proposal = !strictProof && !exactValueProposal ?
          objective.evaluate(engine, selected, selectionCount) : -1;
        if (!objective.active || proposal < 0 || proposal === selected) return selected;
        if (!engine.finalGate.finalAllows(bundle, engine.ourActions,
            engine.ourArguments, proposal, engine.ourCount)) {
          objective.rejectFinal(); return selected;
        }
        objective.confirmOverride();
        engine.finalGate.lastSelected = proposal;
        return proposal;
      };
    }
    this.qualifiedAttackOverStar = engineOptions.diagnosticQualifiedAttackOverStar ?
      new QualifiedAttackOverStarProposal({
        active: engineOptions.diagnosticQualifiedAttackOverStarActive
      }) : null;
    if (this.qualifiedAttackOverStar) {
      const proposalOwner = this.qualifiedAttackOverStar;
      const engine = this.engine;
      const selectFinalAction = engine.selectFinalAction.bind(engine);
      engine.selectFinalAction = (bundle, preferred, selectionCount,
        strictProof = 0, exactValueProposal = 0) => {
        const selected = selectFinalAction(bundle, preferred, selectionCount,
          strictProof, exactValueProposal);
        const proposal = !strictProof && !exactValueProposal ?
          proposalOwner.evaluate(engine, selected, selectionCount) : -1;
        if (!proposalOwner.active || proposal < 0 || proposal === selected) return selected;
        if (!engine.finalGate.finalAllows(bundle, engine.ourActions,
            engine.ourArguments, proposal, engine.ourCount)) {
          proposalOwner.rejectFinal(); return selected;
        }
        proposalOwner.confirmOverride(engine, proposal);
        engine.finalGate.lastSelected = proposal;
        return proposal;
      };
    }
    this.riskConditionedResponsePolicyShadow =
      engineOptions.diagnosticRiskConditionedCombatResponsePolicy ?
        new ResponseConditionedOptionPolicyShadow(null) : null;
    this.riskConditionedResponsePolicyRequired = Boolean(
      engineOptions.diagnosticRiskConditionedCombatResponsePolicyRequired);
    this.riskConditionedCombatProposal =
      engineOptions.diagnosticRiskConditionedCombatProposal ?
        new RiskConditionedCombatProposal({
          active: engineOptions.diagnosticRiskConditionedCombatProposalActive
        }) : null;
    if (this.riskConditionedCombatProposal) {
      const proposalOwner = this.riskConditionedCombatProposal;
      const engine = this.engine;
      const selectFinalAction = engine.selectFinalAction.bind(engine);
      engine.selectFinalAction = (bundle, preferred, selectionCount,
        strictProof = 0, exactValueProposal = 0) => {
        const selected = selectFinalAction(bundle, preferred, selectionCount,
          strictProof, exactValueProposal);
        const proposal = !strictProof && !exactValueProposal ?
          proposalOwner.evaluate(engine, selected, selectionCount) : -1;
        let responsePolicy = null;
        let responsePolicyQualified = this.riskConditionedResponsePolicyRequired ? 0 : 1;
        if (proposal >= 0 && this.riskConditionedResponsePolicyShadow) {
          this.riskConditionedResponsePolicyShadow.evaluateRows(
            engine, selected, proposal);
          responsePolicyQualified =
            this.riskConditionedResponsePolicyShadow.qualifiesCurrentRisk();
          if (this.captureRiskConditionedCombatRoots &&
              this.riskConditionedCombatRoots.length < 32)
            responsePolicy = this.riskConditionedResponsePolicyShadow.sample();
        }
        if (proposal >= 0 && this.captureRiskConditionedCombatRoots &&
            this.riskConditionedCombatRoots.length < 32) {
          const sample = proposalOwner.sample(engine, selected, proposal,
            responsePolicy);
          if (sample) this.riskConditionedCombatRoots.push(sample);
        }
        if (proposalOwner.active && proposal >= 0 &&
            !responsePolicyQualified) return selected;
        if (!proposalOwner.active || proposal < 0 || proposal === selected)
          return selected;
        if (!engine.finalGate.finalAllows(bundle, engine.ourActions,
            engine.ourArguments, proposal, engine.ourCount)) {
          proposalOwner.rejectFinal(); return selected;
        }
        proposalOwner.confirmOverride();
        engine.finalGate.lastSelected = proposal; return proposal;
      };
    }
    this.strategicAttackOverStarProposal =
      engineOptions.diagnosticStrategicAttackOverStarProposal ||
      engineOptions.diagnosticPersistentAttackTarget ?
        new StrategicAttackOverStarProposal({
          active: engineOptions.diagnosticStrategicAttackOverStarProposalActive,
          possibleProjectileWorlds:
            engineOptions.diagnosticStrategicAttackPossibleProjectileWorlds,
          moveContestVariantEnvelope:
            engineOptions.diagnosticStrategicAttackMoveContestVariantEnvelope
        }) : null;
    this.persistentAttackTarget = this.strategicAttackOverStarProposal &&
      engineOptions.diagnosticPersistentAttackTarget ?
        new PersistentAttackTargetController(this.strategicAttackOverStarProposal, {
          active: engineOptions.diagnosticPersistentAttackTargetActive,
          continuationSearch:
            engineOptions.diagnosticPersistentAttackTargetOptionSearch ?
              new OptionScopedTargetContinuationSearch(
                this.engine.runtime.runtimeConfig, {
                  active: engineOptions.diagnosticPersistentAttackTargetOptionSearchActive,
                  depth: engineOptions.diagnosticPersistentAttackTargetOptionSearchDepth,
                  nodeBudget:
                    engineOptions.diagnosticPersistentAttackTargetOptionSearchNodeBudget
                }) : null
        }) : null;
    if (this.persistentAttackTarget) {
      const owner = this.persistentAttackTarget;
      const engine = this.engine;
      const selectFinalAction = engine.selectFinalAction.bind(engine);
      engine.selectFinalAction = (bundle, preferred, selectionCount,
        strictProof = 0, exactValueProposal = 0) => {
        const selected = selectFinalAction(bundle, preferred, selectionCount,
          strictProof, exactValueProposal);
        const proposal = !strictProof && !exactValueProposal ?
          owner.evaluate(engine, bundle, selected, selectionCount) : -1;
        if (!owner.active || proposal < 0 || proposal === selected) return selected;
        if (!engine.finalGate.finalAllows(bundle, engine.ourActions,
            engine.ourArguments, proposal, engine.ourCount)) {
          owner.rejectFinal(); return selected;
        }
        owner.confirmOverride(); engine.finalGate.lastSelected = proposal;
        return proposal;
      };
    } else if (this.strategicAttackOverStarProposal) {
      const owner = this.strategicAttackOverStarProposal;
      const engine = this.engine;
      const selectFinalAction = engine.selectFinalAction.bind(engine);
      engine.selectFinalAction = (bundle, preferred, selectionCount,
        strictProof = 0, exactValueProposal = 0) => {
        const selected = selectFinalAction(bundle, preferred, selectionCount,
          strictProof, exactValueProposal);
        const proposal = !strictProof && !exactValueProposal ?
          owner.evaluate(engine, selected, selectionCount) : -1;
        if (!owner.active || proposal < 0 || proposal === selected) return selected;
        if (!engine.finalGate.finalAllows(bundle, engine.ourActions,
            engine.ourArguments, proposal, engine.ourCount)) {
          owner.rejectFinal(); return selected;
        }
        owner.confirmOverride(); engine.finalGate.lastSelected = proposal;
        return proposal;
      };
    }
    this.strategyPriority = installStrategyPriorityDiagnostic(this.engine,
      engineOptions.diagnosticStrategyMode);
    this.capturePhaseTiming = Boolean(options.capturePhaseTiming);
    this.phaseTimingNanos = this.capturePhaseTiming ? new Float64Array(PHASE_NAME.length) : null;
    this.phaseExclusiveNanos = this.capturePhaseTiming ? new Float64Array(PHASE_NAME.length) : null;
    this.phaseTimingCalls = this.capturePhaseTiming ? new Uint32Array(PHASE_NAME.length) : null;
    this.phaseTimer = this.capturePhaseTiming ? {
      depth: 0, start: new BigInt64Array(64), child: new BigInt64Array(64)
    } : null;
    this.matrixSolverIterations = 0;
    this.dynamicPhaseTimingInstalled = false;
    if (this.capturePhaseTiming) this.installPhaseTiming();
    this.selectiveInformationProbe = options.captureSelectiveInformationProbe ?
      new SelectiveInformationSearchProbe(this.engine,
        Number.isSafeInteger(options.selectiveContenderCount) ?
          options.selectiveContenderCount : 3) : null;
    this.informationSupportProbe = options.captureInformationSupportProbe ?
      new InformationSupportProbe(this.engine) : null;
    this.informationIntervalOwnershipProbe =
      options.captureInformationIntervalOwnershipProbe ?
        new InformationIntervalOwnershipProbe() : null;
    this.selectiveGeometrySearchProbe = options.captureSelectiveGeometrySearchProbe ?
      new SelectiveGeometrySearchProbe(this.engine,
        Number.isSafeInteger(options.selectiveGeometryRows) ?
          options.selectiveGeometryRows : 3) : null;
    this.riskFrontierPhysicalSearchProbe = options.captureRiskFrontierPhysicalSearchProbe ?
      new RiskFrontierPhysicalSearchProbe(this.engine) : null;
    this.noAcceptableCensus = options.captureNoAcceptableCensus ?
      new NoAcceptableCensus(Number.isSafeInteger(options.noAcceptableSampleLimit) ?
        options.noAcceptableSampleLimit : 0) : null;
    this.attackOpportunityCensus = options.captureAttackOpportunityCensus ?
      new AttackOpportunityCensus() : null;
    this.eventDrivenOptionShadow = options.captureEventDrivenOptionShadow ?
      new EventDrivenOptionShadow() : null;
    this.stableOptionLedgerShadow = options.captureStableOptionLedgerShadow ||
      options.captureStrategicStateLedgerShadow ||
      options.captureObjectiveEpochContinuityShadow ||
      options.captureObjectiveEpochOptionArbiterShadow ||
      options.captureObjectiveEpochOptionIntervalShadow ||
      options.captureSemanticObjectiveEpochOptionIntervalShadow ||
      options.captureSemanticAttackOptionCoverageShadow ||
      options.captureSemanticAttackExecutionIntervalShadow ||
      options.captureSemanticAttackPolicyIntervalShadow ||
      options.captureStrategicConflictArbiterShadow ||
      options.captureStrategicTargetExecutionShadow ||
      options.captureStableOptionIntervalShadow ||
      options.captureAttackContinuationProgressShadow ||
      options.captureAttackSequenceGeneratorShadow ||
      options.captureAttackPolicyReachabilityShadow ||
      options.captureAttackResponseSetShadow ||
      options.captureCombatUtilityEnvelopeShadow ||
      options.captureAttackStarPolicyFrontierShadow ||
      options.captureResponseConditionedOptionPolicyShadow ?
      new StableOptionLedgerShadow() : null;
    this.strategicStateLedgerShadow = options.captureStrategicStateLedgerShadow ||
      options.captureStrategicConflictArbiterShadow ||
      options.captureStrategicTargetExecutionShadow ?
      new StrategicStateLedgerShadow(this.stableOptionLedgerShadow) : null;
    this.objectiveEpochContinuityShadow =
      options.captureSemanticObjectiveEpochOptionIntervalShadow ||
      options.captureSemanticAttackOptionCoverageShadow ||
      options.captureSemanticAttackExecutionIntervalShadow ||
      options.captureSemanticAttackPolicyIntervalShadow ?
        new SemanticObjectiveEpochShadow(this.stableOptionLedgerShadow) :
      options.captureObjectiveEpochContinuityShadow ||
      options.captureObjectiveEpochOptionArbiterShadow ||
      options.captureObjectiveEpochOptionIntervalShadow ?
        new ObjectiveEpochContinuityShadow(this.stableOptionLedgerShadow) : null;
    this.objectiveEpochExecutionShadow = options.captureObjectiveEpochExecutionShadow ?
      new ObjectiveEpochExecutionShadow(this.objectiveEpochContinuityShadow) : null;
    this.semanticAttackOptionCoverageShadow =
      options.captureSemanticAttackOptionCoverageShadow ||
      options.captureSemanticAttackExecutionIntervalShadow ||
      options.captureSemanticAttackPolicyIntervalShadow ?
        new SemanticAttackOptionCoverageShadow(
          this.objectiveEpochContinuityShadow) : null;
    this.semanticAttackExecutionIntervalShadow =
      options.captureSemanticAttackExecutionIntervalShadow ?
        new SemanticAttackExecutionIntervalShadow(
          this.objectiveEpochContinuityShadow,
          this.semanticAttackOptionCoverageShadow,
          this.engine.runtime.runtimeConfig, {
            depth: options.semanticAttackExecutionDepth,
            nodeBudget: options.semanticAttackExecutionNodeBudget
          }) : null;
    this.semanticAttackPolicyIntervalShadow =
      options.captureSemanticAttackPolicyIntervalShadow ?
        new SemanticAttackPolicyIntervalShadow(
          this.objectiveEpochContinuityShadow,
          this.semanticAttackOptionCoverageShadow,
          this.engine.runtime.runtimeConfig, {
            depth: options.semanticAttackPolicyDepth,
            nodeBudget: options.semanticAttackPolicyNodeBudget,
            depthStability:
              options.semanticAttackPolicyDepthStability === true,
            depthWidthStability:
              options.semanticAttackPolicyDepthWidthStability === true,
            depthMoveVariant:
              options.semanticAttackPolicyDepthMoveVariant === true,
            depthLeafBackup:
              options.semanticAttackPolicyDepthLeafBackup === true,
            depthResponseMatrix:
              options.semanticAttackPolicyDepthResponseMatrix === true,
            responseConditioned:
              options.semanticAttackPolicyResponseConditioned === true,
            eventDeadline:
              options.semanticAttackPolicyEventDeadline === true,
            eventHorizon:
              options.semanticAttackPolicyEventHorizon === true,
            commonContinuation:
              options.semanticAttackPolicyCommonContinuation === true
          }) : null;
    this.objectiveEpochOptionArbiterShadow =
      options.captureObjectiveEpochOptionArbiterShadow ||
      options.captureObjectiveEpochOptionIntervalShadow ||
      options.captureSemanticObjectiveEpochOptionIntervalShadow ?
        new ObjectiveEpochOptionArbiterShadow(
          this.objectiveEpochContinuityShadow, {
            verifyInterval: options.captureObjectiveEpochOptionIntervalShadow ||
              options.captureSemanticObjectiveEpochOptionIntervalShadow,
            runtimeConfig: this.engine.runtime.runtimeConfig,
            depth: options.objectiveEpochOptionIntervalDepth,
            nodeBudget: options.objectiveEpochOptionIntervalNodeBudget
          }) : null;
    this.stableOptionIntervalShadow = options.captureStableOptionIntervalShadow ||
      options.captureStrategicConflictArbiterShadow ||
      options.captureStrategicTargetExecutionShadow ||
      options.captureAttackContinuationProgressShadow ||
      options.captureAttackSequenceGeneratorShadow ||
      options.captureAttackPolicyReachabilityShadow ||
      options.captureAttackResponseSetShadow ||
      options.captureCombatUtilityEnvelopeShadow ||
      options.captureAttackStarPolicyFrontierShadow ||
      options.captureResponseConditionedOptionPolicyShadow ?
      new StableOptionIntervalShadow(this.stableOptionLedgerShadow,
        this.engine.adapter.state) : null;
    this.attackContinuationProgressShadow =
      options.captureAttackContinuationProgressShadow ?
        new AttackContinuationProgressShadow(this.stableOptionIntervalShadow) : null;
    this.attackSequenceGeneratorShadow = options.captureAttackSequenceGeneratorShadow ?
      new AttackSequenceGeneratorShadow(this.stableOptionIntervalShadow,
        this.stableOptionLedgerShadow) : null;
    this.attackPolicyReachabilityShadow = options.captureAttackPolicyReachabilityShadow ?
      new AttackPolicyReachabilityShadow(this.stableOptionIntervalShadow) : null;
    this.attackResponseSetShadow = options.captureAttackResponseSetShadow ?
      new AttackResponseSetShadow(this.stableOptionIntervalShadow) : null;
    this.combatUtilityEnvelopeShadow = options.captureCombatUtilityEnvelopeShadow ||
      options.captureAttackStarPolicyFrontierShadow ?
      new CombatUtilityEnvelopeShadow(this.stableOptionIntervalShadow) : null;
    this.attackStarPolicyFrontierShadow =
      options.captureAttackStarPolicyFrontierShadow ?
        new AttackStarPolicyFrontierShadow(this.stableOptionIntervalShadow,
          this.combatUtilityEnvelopeShadow) : null;
    this.responseConditionedOptionPolicyShadow =
      options.captureResponseConditionedOptionPolicyShadow ||
      options.captureStrategicConflictArbiterShadow ||
      options.captureStrategicTargetExecutionShadow ?
        new ResponseConditionedOptionPolicyShadow(
          this.stableOptionIntervalShadow) : null;
    this.strategicConflictArbiterShadow =
      options.captureStrategicConflictArbiterShadow ||
      options.captureStrategicTargetExecutionShadow ?
        new StrategicConflictArbiterShadow(this.stableOptionLedgerShadow,
          this.strategicStateLedgerShadow, this.stableOptionIntervalShadow,
          this.responseConditionedOptionPolicyShadow) : null;
    this.strategicTargetExecutionShadow =
      options.captureStrategicTargetExecutionShadow ?
        new StrategicTargetExecutionShadow(
          this.strategicConflictArbiterShadow) : null;
    this.captureAllFrames = Boolean(options.captureAllFrames);
    this.captureActionFrames = Boolean(options.captureActionFrames || options.captureAllFrames);
    this.captureCompactFrames = Boolean(options.captureCompactFrames);
    this.captureSampleFrames = Boolean(options.captureSampleFrames);
    this.captureOptionProposalRoots = Boolean(options.captureOptionProposalRoots);
    this.captureRiskConditionedCombatRoots = Boolean(
      options.captureRiskConditionedCombatRoots);
    this.captureStrategicTargetExecutionRoots = Boolean(
      options.captureStrategicTargetExecutionRoots);
    this.captureTwoStageSetupRoots = Boolean(options.captureTwoStageSetupRoots);
    this.captureExceptionalFrames = options.captureExceptionalFrames !== false;
    this.runtimeMicros = []; this.frames = []; this.actionCounts = {};
    this.diagnosticFrames = []; this.actionFrames = [];
    this.optionProposalRoots = [];
    this.riskConditionedCombatRoots = [];
    this.twoStageSetupRoots = [];
    this.strategicTargetExecutionRoots = [];
    this.compactActionCodes = []; this.compactFrameFlags = [];
    this.compactArguments = [];
    this.sampleFrameWords = new Int32Array(128 * SAMPLE_FRAME_STRIDE);
    this.sampleFrameCount = 0;
    this.rootCounts = {}; this.runtimeModeCounts = {};
    this.searchFrameCount = 0; this.searchNodeCount = 0;
    this.searchAttemptFrameCount = 0; this.searchAttemptNodeCount = 0;
    this.physicalSearchFrameCount = 0; this.physicalSearchNodeCount = 0;
    this.informationSearchFrameCount = 0; this.informationSearchNodeCount = 0;
    this.forcedWinSearchFrameCount = 0; this.forcedWinSearchNodeCount = 0;
    this.ourActionTotal = 0; this.enemyActionTotal = 0;
    this.searchOurActionTotal = 0; this.searchEnemyActionTotal = 0;
    this.hardAllowedActionTotal = 0; this.searchHardAllowedActionTotal = 0;
    this.riskAcceptableActionTotal = 0; this.riskFrontierActionTotal = 0;
    this.strategySelectedActionTotal = 0;
    this.searchRiskAcceptableActionTotal = 0; this.searchRiskFrontierActionTotal = 0;
    this.searchStrategySelectedActionTotal = 0;
    this.informationWorldTotal = 0;
    this.contactSupportRootCount = 0; this.contactSupportExactCount = 0;
    this.contactSupportRecoverablePhysicalCount = 0;
    this.contactSupportPossibleOnlyTrackedCount = 0;
    this.contactSupportPossibleOnlyIncompleteCount = 0;
    this.contactSupportPossibleWithOtherCount = 0;
    this.contactSupportOtherGapCount = 0;
    this.contactSupportGapBitCount = new Uint32Array(14);
    this.contactSupportPossibleCount = new Uint32Array(9);
    this.searchCompletedDepthCounts = new Uint32Array(8);
    this.physicalValueSupportDepthCounts = new Uint32Array(8);
    this.selectiveSearchFrameCount = 0; this.selectiveSearchNodeCount = 0;
    this.selectiveCompletedDepthCounts = new Uint32Array(8);
    this.firstRuntimeModeFrame = new Int16Array(4); this.firstRuntimeModeFrame.fill(-1);
    this.exceptionalFrameCount = 0;
    this.hardSelectedRejectCount = 0; this.avoidableHardRejectCount = 0;
    this.unavoidableAllRejectedCount = 0; this.rootRestoreFailures = 0;
    this.riskDominatedSelectionCount = 0;
  }
  captureContactSupport() {
    if (this.engine.lastControlMode !== ROOT_CONTROL_MODE.TACTICAL_CONTACT) return 0;
    this.contactSupportRootCount += 1;
    const adapter = this.engine.adapter;
    if (adapter.informationComplete) {
      this.contactSupportExactCount += 1; return 1;
    }
    const gap = adapter.informationGapMask >>> 0;
    for (let bit = 0; bit < this.contactSupportGapBitCount.length; bit += 1)
      if (gap & (1 << bit)) this.contactSupportGapBitCount[bit] += 1;
    const possible = this.engine.possibleProjectiles;
    const count = possible ? Math.min(8, possible.count()) : 0;
    this.contactSupportPossibleCount[count] += 1;
    if (gap === INFORMATION_GAP.POSSIBLE_ENEMY_PROJECTILE) {
      if (possible?.pool?.complete) {
        this.contactSupportPossibleOnlyTrackedCount += 1;
        if (count === 0) this.contactSupportRecoverablePhysicalCount += 1;
      } else this.contactSupportPossibleOnlyIncompleteCount += 1;
    } else if (gap & INFORMATION_GAP.POSSIBLE_ENEMY_PROJECTILE)
      this.contactSupportPossibleWithOtherCount += 1;
    else this.contactSupportOtherGapCount += 1;
    return 1;
  }
  installPhaseTiming() {
    const nanos = this.phaseTimingNanos; const exclusive = this.phaseExclusiveNanos;
    const calls = this.phaseTimingCalls; const timer = this.phaseTimer; const bot = this;
    const wrap = (target, method, phase, after = null) => {
      if (!target || typeof target[method] !== "function") return;
      const original = target[method];
      target[method] = function(...args) {
        const at = timer.depth; timer.depth += 1;
        timer.start[at] = process.hrtime.bigint(); timer.child[at] = 0n;
        try { return Reflect.apply(original, this, args); }
        finally {
          const elapsed = process.hrtime.bigint() - timer.start[at];
          const own = elapsed - timer.child[at]; timer.depth -= 1;
          if (timer.depth > 0) timer.child[timer.depth - 1] += elapsed;
          nanos[phase] += Number(elapsed); exclusive[phase] += Number(own);
          calls[phase] += 1;
          if (after) after(this, bot);
        }
      };
    };
    const engine = this.engine;
    wrap(engine.adapter, "adapt", 0);
    wrap(engine, "prepareNavigation", 1);
    wrap(engine, "createPlanSketches", 2);
    wrap(engine, "prepareHiddenRisk", 3);
    wrap(engine.finalGate, "evaluate", 4);
    wrap(engine.safetyClosure, "evaluate", 5);
    wrap(engine.multiFrameRisk, "evaluate", 6);
    wrap(engine, "refineObservationSafety", 7);
    wrap(engine.escapeObligation, "evaluateCommitted", 8);
    wrap(engine, "prepareCombatVectors", 9);
    wrap(engine.projectileAttack, "evaluate", 10);
    wrap(engine, "prepareStrategyEvidence", 11);
    wrap(engine.forcedWinSearch, "search", 12);
    wrap(engine.forcedWinSearch, "searchInformation", 12);
    wrap(engine.depthSearch, "search", 13);
    wrap(engine.informationSearch, "search", 14);
    wrap(engine.informationSearch, "applyRiskEnvelopes", 15);
    wrap(engine, "wireProductionStageMatrix", 16);
    wrap(engine, "selectFinalAction", 17);
    wrap(engine.depthSearch, "heuristic", 21);
    wrap(engine.depthSearch, "continuationValue", 22);
    wrap(engine.search.matrixSolver, "solve", 23,
      solver => { bot.matrixSolverIterations += solver.iterations; });
  }
  installDynamicPhaseTiming() {
    if (!this.capturePhaseTiming || this.dynamicPhaseTimingInstalled ||
        !this.engine.adapter.kernel || !this.engine.adapter.hard ||
        !this.engine.adapter.hazard) return;
    this.dynamicPhaseTimingInstalled = true;
    const nanos = this.phaseTimingNanos; const exclusive = this.phaseExclusiveNanos;
    const calls = this.phaseTimingCalls; const timer = this.phaseTimer;
    const wrap = (target, method, phase) => {
      const original = target[method];
      if (typeof original !== "function") return;
      target[method] = function(...args) {
        const at = timer.depth; timer.depth += 1;
        timer.start[at] = process.hrtime.bigint(); timer.child[at] = 0n;
        try { return Reflect.apply(original, this, args); }
        finally {
          const elapsed = process.hrtime.bigint() - timer.start[at];
          const own = elapsed - timer.child[at]; timer.depth -= 1;
          if (timer.depth > 0) timer.child[timer.depth - 1] += elapsed;
          nanos[phase] += Number(elapsed); exclusive[phase] += Number(own);
          calls[phase] += 1;
        }
      };
    };
    wrap(this.engine.adapter.kernel, "applyFrame", 18);
    wrap(this.engine.adapter.hard, "classifyApplied", 19);
    wrap(this.engine.adapter.hazard, "reverseViable", 20);
  }
  decide(context) {
    this.currentContext = context;
    const actions = []; const me = actionProxy(context.me, actions);
    const beforeHard = this.engine.hardRejectAvoided;
    const beforeRestore = this.engine.depthSearch.rootRestoreFailures;
    const beforeInformationRestore = this.engine.informationSearch.rootRestoreFailures;
    const beforeProofRestore = this.engine.forcedWinSearch.rootRestoreFailures;
    const beforeResidualProofRestore = this.engine.residualAttackProof ?
      this.engine.residualAttackProof.rootRestoreFailures : 0;
    const beforeStrictFireRestore =
      this.engine.strictSafeThreatFireShadowRestoreFailures;
    const beforeSafetyRestore = this.engine.observationSafety.rootRestoreFailures;
    const beforeFallback = this.engine.fallbackCount;
    const beforeInvalid = this.engine.invalidRootCount;
    const beforeRiskGate = this.engine.riskController.gateCount;
    const beforeWorkUnits = this.engine.runtime.accumulatedWorkUnits;
    const beforeOptionIntervalAttempts = this.engine.optionInformationInterval ?
      this.engine.optionInformationInterval.attemptCount : 0;
    const beforeTwoStageEvaluations = this.engine.attackSetupClosure?.twoStage ?
      this.engine.attackSetupClosure.twoStage.evaluationCount : 0;
    const started = process.hrtime.bigint();
    const returned = this.engine.decide(me, context.enemy, context.game);
    this.installDynamicPhaseTiming();
    this.captureContactSupport();
    if (this.selectiveInformationProbe)
      this.selectiveInformationProbe.capture(this.engine, returned, this.engine.lastArgument);
    if (this.informationIntervalOwnershipProbe)
      this.informationIntervalOwnershipProbe.capture(
        this.engine, returned, this.engine.lastArgument);
    if (this.selectiveGeometrySearchProbe)
      this.selectiveGeometrySearchProbe.capture(
        this.engine, returned, this.engine.lastArgument);
    if (this.riskFrontierPhysicalSearchProbe)
      this.riskFrontierPhysicalSearchProbe.capture(this.engine);
    this.strategyPriority.capture(returned);
    if (this.attackOpportunityCensus)
      this.attackOpportunityCensus.observe(this.engine, returned);
    if (this.eventDrivenOptionShadow)
      this.eventDrivenOptionShadow.observe(this.engine, returned);
    if (this.stableOptionLedgerShadow)
      this.stableOptionLedgerShadow.observe(this.engine, returned);
    if (this.strategicStateLedgerShadow)
      this.strategicStateLedgerShadow.observe(this.engine, returned);
    if (this.objectiveEpochContinuityShadow)
      this.objectiveEpochContinuityShadow.observe(this.engine);
    if (this.semanticAttackOptionCoverageShadow)
      this.semanticAttackOptionCoverageShadow.observe(this.engine, returned);
    if (this.semanticAttackExecutionIntervalShadow)
      this.semanticAttackExecutionIntervalShadow.observe(this.engine, returned);
    if (this.semanticAttackPolicyIntervalShadow)
      this.semanticAttackPolicyIntervalShadow.observe(this.engine, returned);
    if (this.objectiveEpochOptionArbiterShadow)
      this.objectiveEpochOptionArbiterShadow.observe(this.engine, returned);
    if (this.objectiveEpochExecutionShadow)
      this.objectiveEpochExecutionShadow.observe(this.engine);
    if (this.stableOptionIntervalShadow)
      this.stableOptionIntervalShadow.observe(this.engine, returned);
    if (this.attackContinuationProgressShadow)
      this.attackContinuationProgressShadow.observe(this.engine);
    if (this.attackSequenceGeneratorShadow)
      this.attackSequenceGeneratorShadow.observe(this.engine);
    if (this.attackPolicyReachabilityShadow)
      this.attackPolicyReachabilityShadow.observe(this.engine);
    if (this.attackResponseSetShadow)
      this.attackResponseSetShadow.observe(this.engine);
    if (this.combatUtilityEnvelopeShadow)
      this.combatUtilityEnvelopeShadow.observe(this.engine);
    if (this.attackStarPolicyFrontierShadow)
      this.attackStarPolicyFrontierShadow.observe(this.engine);
    if (this.responseConditionedOptionPolicyShadow)
      this.responseConditionedOptionPolicyShadow.observe(this.engine);
    if (this.strategicConflictArbiterShadow)
      this.strategicConflictArbiterShadow.observe(this.engine);
    if (this.strategicTargetExecutionShadow)
      this.strategicTargetExecutionShadow.observe(this.engine, returned);
    if (this.captureStrategicTargetExecutionRoots &&
        this.strategicTargetExecutionShadow &&
        this.strategicTargetExecutionShadow.lastStatus ===
          EXECUTION_STATUS.DIFFERENT_PRIMITIVE &&
        this.strategicTargetExecutionRoots.length < 32) {
      const sample = this.strategicTargetExecutionShadow.sample(this.engine);
      if (sample) this.strategicTargetExecutionRoots.push(sample);
    }
    const runtimeMicros = Number((process.hrtime.bigint() - started) / 1000n);
    const action = actions[0] || null; const actionName = ACTION_NAME[returned] || `ACTION_${returned}`;
    const rootName = ROOT_NAME[this.engine.lastRootStatus] || String(this.engine.lastRootStatus);
    this.runtimeMicros.push(runtimeMicros);
    this.actionCounts[actionName] = (this.actionCounts[actionName] || 0) + 1;
    this.rootCounts[rootName] = (this.rootCounts[rootName] || 0) + 1;
    const runtimeMode = this.engine.runtime.runtimeMode;
    this.runtimeModeCounts[runtimeMode] = (this.runtimeModeCounts[runtimeMode] || 0) + 1;
    if (runtimeMode >= 0 && runtimeMode < this.firstRuntimeModeFrame.length &&
        this.firstRuntimeModeFrame[runtimeMode] < 0)
      this.firstRuntimeModeFrame[runtimeMode] = context.game.frames;
    const physicalDepth = this.engine.depthSearch.completedDepth;
    const selectiveDepth = this.engine.depthSearch.selectiveCompletedDepth;
    const informationDepth = this.engine.informationSearch.completedDepth;
    const completedDepth = Math.max(physicalDepth, informationDepth);
    const physicalNodes = this.engine.depthSearch.nodes;
    const informationNodes = this.engine.informationSearch.nodes;
    // InformationSearch reuses ProductionDepthSearch for continuation leaves
    // and already includes those nodes in its own counter. Count the owning
    // search once, exactly as ProductionRoot charges it.
    const attemptedNodes = informationNodes > 0 ? informationNodes : physicalNodes;
    this.ourActionTotal += this.engine.ourCount;
    this.enemyActionTotal += this.engine.enemyCount;
    let hardAllowed = 0;
    for (let row = 0; row < this.engine.ourCount; row += 1)
      if (this.engine.hardStatus[row] === HARD_STATUS.ALLOW) hardAllowed += 1;
    const risk = this.engine.riskController.outcome;
    let riskAcceptable = 0; let riskFrontier = 0; let strategySelected = 0;
    for (let row = 0; row < risk.count; row += 1) {
      if (risk.acceptable[row]) {
        riskAcceptable += 1;
        if (!risk.dominated[row]) riskFrontier += 1;
      }
      if (this.engine.strategyBands.selected[row]) strategySelected += 1;
    }
    this.riskAcceptableActionTotal += riskAcceptable;
    this.riskFrontierActionTotal += riskFrontier;
    this.strategySelectedActionTotal += strategySelected;
    this.hardAllowedActionTotal += hardAllowed;
    this.informationWorldTotal += this.engine.informationSearch.worldsEvaluated;
    if (attemptedNodes > 0) {
      this.searchAttemptFrameCount += 1; this.searchAttemptNodeCount += attemptedNodes;
      this.searchOurActionTotal += this.engine.ourCount;
      this.searchEnemyActionTotal += this.engine.enemyCount;
      this.searchHardAllowedActionTotal += hardAllowed;
      this.searchRiskAcceptableActionTotal += riskAcceptable;
      this.searchRiskFrontierActionTotal += riskFrontier;
      this.searchStrategySelectedActionTotal += strategySelected;
    }
    if (completedDepth > 0) {
      this.searchFrameCount += 1; this.searchNodeCount += attemptedNodes;
      this.searchCompletedDepthCounts[Math.min(
        this.searchCompletedDepthCounts.length - 1, completedDepth)] += 1;
    }
    if (physicalDepth > 0) {
      this.physicalSearchFrameCount += 1; this.physicalSearchNodeCount += physicalNodes;
    }
    if (this.engine.depthSearch.representativeSupportComplete) {
      const supportDepth = Math.min(this.physicalValueSupportDepthCounts.length - 1,
        this.engine.depthSearch.representativeSupportDepth);
      this.physicalValueSupportDepthCounts[supportDepth] += 1;
    }
    if (selectiveDepth > 0) {
      this.selectiveSearchFrameCount += 1;
      this.selectiveSearchNodeCount += this.engine.depthSearch.selectiveNodeCount;
      this.selectiveCompletedDepthCounts[Math.min(
        this.selectiveCompletedDepthCounts.length - 1, selectiveDepth)] += 1;
    }
    if (informationDepth > 0) {
      this.informationSearchFrameCount += 1;
      this.informationSearchNodeCount += informationNodes;
    }
    if (this.engine.forcedWinSearch.nodes > 0) {
      this.forcedWinSearchFrameCount += 1;
      this.forcedWinSearchNodeCount += this.engine.forcedWinSearch.nodes;
    }
    let selectedHard = "NOT_INDEXED"; let selectedHardCode = HARD_STATUS.INCOMPLETE;
    let allowCount = 0;
    for (let index = 0; index < this.engine.ourCount; index += 1) {
      if (this.engine.hardStatus[index] === HARD_STATUS.ALLOW) allowCount += 1;
    }
    // The emitted primitive may have multiple rows.  Auditing only by action
    // and retaining the last matching row can label an ALLOW override as a
    // rejected action.  Prefer the exact diagnostic row, then the production
    // selected row, and finally match the complete action+argument identity.
    const emittedRow = emittedActionRow(this.engine, returned);
    if (emittedRow >= 0) {
      selectedHardCode = this.engine.hardStatus[emittedRow];
      selectedHard = HARD_NAME[selectedHardCode] || String(selectedHardCode);
    }
    if (selectedHard === "REJECT_PROVEN") {
      this.hardSelectedRejectCount += 1;
      if (allowCount > 0) this.avoidableHardRejectCount += 1;
      else this.unavoidableAllRejectedCount += 1;
    }
    this.rootRestoreFailures += this.engine.depthSearch.rootRestoreFailures - beforeRestore;
    this.rootRestoreFailures += this.engine.informationSearch.rootRestoreFailures -
      beforeInformationRestore;
    this.rootRestoreFailures += this.engine.forcedWinSearch.rootRestoreFailures - beforeProofRestore;
    if (this.engine.residualAttackProof)
      this.rootRestoreFailures += this.engine.residualAttackProof.rootRestoreFailures -
        beforeResidualProofRestore;
    this.rootRestoreFailures +=
      this.engine.strictSafeThreatFireShadowRestoreFailures -
      beforeStrictFireRestore;
    this.rootRestoreFailures += this.engine.observationSafety.rootRestoreFailures - beforeSafetyRestore;
    // Audit the action actually emitted after a diagnostic owner runs. The
    // production counter is updated before engine.emit(), so using its delta
    // here would attribute the pre-override row to the candidate policy.
    if (this.engine.riskController.gateCount > beforeRiskGate &&
        emittedRow >= 0 && emittedRow < risk.count && risk.dominated[emittedRow])
      this.riskDominatedSelectionCount += 1;
    const frame = {
      frame: context.game.frames,
      action: actionName,
      root: rootName,
      informationComplete: Boolean(this.engine.adapter.informationComplete),
      enemyVisible: Boolean(this.engine.adapter.enemyVisible),
      ownCanAct: Boolean(this.engine.adapter.ownCanAct),
      selectedHard, allowCount,
      hardRejects: this.engine.hardRejectAvoided - beforeHard,
      proof: PROOF_NAME[this.engine.lastProofStatus] || String(this.engine.lastProofStatus),
      proofCompletedDepth: this.engine.forcedWinSearch.completedDepth,
      proofNodes: this.engine.forcedWinSearch.nodes,
      completedDepth: Math.max(this.engine.depthSearch.completedDepth,
        this.engine.informationSearch.completedDepth),
      physicalCompletedDepth: this.engine.depthSearch.completedDepth,
      informationCompletedDepth: this.engine.informationSearch.completedDepth,
      informationWorlds: this.engine.informationSearch.worldsEvaluated,
      informationSupportComplete: Boolean(this.engine.informationSearch.supportComplete),
      observationSafetySupportComplete:
        Boolean(this.engine.observationSafetySupportComplete()),
      physicalValueSupportComplete:
        Boolean(this.engine.depthSearch.representativeSupportComplete),
      physicalValueSupportDepth: this.engine.depthSearch.representativeSupportDepth,
      physicalValueSupportExpansionLimit:
        this.engine.depthSearch.representativeSupportExpansionLimit,
      physicalValueBestRow: this.engine.depthSearch.representativeBestRow,
      physicalValueBestValue: this.engine.depthSearch.representativeBestValue,
      physicalSearchSchedule: this.engine.depthSearch.lastSchedule,
      optionSearchStatus: this.engine.optionAwareDepthSearch ?
        this.engine.optionAwareDepthSearch.lastStatus : 0,
      optionBestKind: this.engine.optionAwareDepthSearch ?
        this.engine.optionAwareDepthSearch.lastBestKind : 0,
      optionBestPrimitiveRow: this.engine.optionAwareDepthSearch ?
        this.engine.optionAwareDepthSearch.lastBestPrimitiveRow : 255,
      optionBestIndex: this.engine.optionAwareDepthSearch ?
        this.engine.optionAwareDepthSearch.lastBestOption : 255,
      selectedIndex: this.engine.lastSelectedIndex,
      internalSelectedIndex: this.engine.diagnosticInternalSelectedIndex ?? -1,
      internalSelectedDominated:
        Boolean(this.engine.diagnosticInternalSelectedDominated),
      committedContinuationRequired:
        Boolean(this.engine.escapeObligation.continuationRequired),
      persistentEscapeOverride:
        Boolean(this.engine.lastSelectionWasPersistentEscape),
      preOverrideAction: ACTION_NAME[this.engine.diagnosticPreOverrideAction] ||
        String(this.engine.diagnosticPreOverrideAction),
      finalOverrideAction: ACTION_NAME[this.engine.diagnosticFinalOverrideAction] ||
        String(this.engine.diagnosticFinalOverrideAction),
      possibleProjectileCount: this.engine.possibleProjectiles.count(),
      possibleProjectileRisk: this.engine.possibleShotRisk(
        this.engine.adapter.state.arrays[
          require("../../../engine-v2/src/state/fast-state").ARRAY.TANK_CELL][0]),
      controlMode: this.engine.lastControlMode,
      responseOptionActive: Boolean(this.engine.responseOption.active),
      responseOptionKind: this.engine.responseOption.kind,
      responseOptionReason: this.engine.responseOption.lastReason,
      responseOptionProposal: this.engine.responseOption.lastProposal,
      noAcceptableAction: Boolean(this.engine.riskController.noAcceptableAction),
      acceptableCount: this.engine.riskController.acceptableCount,
      multiFrameRiskStatus: this.engine.multiFrameRisk.status,
      depthNodes: this.engine.depthSearch.nodes + this.engine.informationSearch.nodes,
      depthCacheHits: this.engine.depthSearch.cacheHits,
      score: this.engine.lastScore,
      runtimeMode: this.engine.runtime.runtimeMode,
      fallback: this.engine.fallbackCount > beforeFallback,
      invalidFallback: this.engine.invalidRootCount > beforeInvalid,
      runtimeMicros,
      workUnits: this.engine.runtime.accumulatedWorkUnits - beforeWorkUnits
    };
    if (this.noAcceptableCensus)
      this.noAcceptableCensus.observeEngine(this.engine, returned, frame.frame);
    if (this.captureCompactFrames) {
      this.compactActionCodes.push(returned & 0xff);
      this.compactFrameFlags.push(rootFlag(this.engine.lastRootStatus) |
        ((selectedHardCode & 3) << 2) | ((this.engine.lastProofStatus & 3) << 4) |
        ((runtimeMode & 3) << 6));
      if (action?.type === "teleport" && Number.isSafeInteger(action.x) &&
          Number.isSafeInteger(action.y))
        this.compactArguments.push([frame.frame, action.x, action.y]);
    }
    if (this.captureOptionProposalRoots && this.optionProposalRoots.length < 64 &&
        this.engine.optionInformationInterval &&
        this.engine.optionInformationInterval.attemptCount > beforeOptionIntervalAttempts) {
      const interval = this.engine.optionInformationInterval;
      if (interval && interval.lastProposalOption >= 0 &&
          interval.lastIncumbentOption >= 0 &&
          interval.lastProposalPrimitive !==
            interval.evaluator.optionPrimitiveRow[interval.lastIncumbentOption]) {
        const evaluator = interval.evaluator;
        const incumbentOption = interval.lastIncumbentOption;
        const proposalOption = interval.lastProposalOption;
        const incumbentRow = evaluator.optionPrimitiveRow[incumbentOption];
        const proposalRow = evaluator.optionPrimitiveRow[proposalOption];
        const risk = this.engine.riskController.outcome;
        const combat = this.engine.combat.vector;
        const pac = this.engine.projectileAttack;
        const closure = this.engine.attackSetupClosure;
        const escape = this.engine.escapeObligation;
        const state = this.engine.adapter.state;
        const copyRow = row => ({
          row,
          action: this.engine.ourActions[row],
          argument: this.engine.ourArguments[row],
          hard: this.engine.hardStatus[row],
          acceptable: risk.acceptable[row],
          dominated: risk.dominated[row],
          immediateFatalMass: risk.immediateFatalMass[row],
          committedChanceFatalMass: risk.committedChanceFatalMass[row],
          horizonFatalMass: risk.horizonFatalMass[row],
          unknownMass: risk.unknownMass[row],
          escapeSlack: risk.escapeSlack[row],
          robustLower: risk.robustLower[row],
          expectedValue: risk.expectedValue[row],
          hitDeadline: combat.hitDeadline[row],
          ownCounterExposure: combat.ownCounterExposure[row],
          postFireEscape: combat.postFireEscape[row],
          purposeCompleteness: combat.purposeCompleteness[row],
          attackClosureStatus: combat.attackClosureStatus[row],
          enemyDoomedFirstActions: combat.enemyDoomedFirstActions[row],
          enemySurvivingFirstActions: combat.enemySurvivingFirstActions[row],
          enemyUnknownFirstActions: combat.enemyUnknownFirstActions[row],
          enemyFrontierColumns: combat.enemyFrontierColumns[row],
          enemyCounterfireDelay: combat.enemyCounterfireDelay[row],
          enemyMobilityLoss: combat.enemyMobilityLoss[row],
          enemyEndpointReduction: combat.enemyEndpointReduction[row],
          committedEscapeMember: escape.member[row],
          committedSuccessorProof: escape.successorProof[row],
          committedSuccessorSurvivalMass: escape.successorSurvivalMass[row],
          attackSetupCertificate: closure ? closure.status[row] : 0,
          attackSetupReason: closure ? closure.reason[row] : 0,
          attackSetupDoomedColumns: closure ? closure.doomedColumns[row] : 0,
          attackSetupConstrainedColumns: closure ? closure.constrainedColumns[row] : 0,
          attackSetupUncoveredColumns: closure ? closure.uncoveredColumns[row] : 0
        });
        const proposalColumns = [];
        for (let column = 0; column < this.engine.enemyCount; column += 1) {
          const at = proposalRow * pac.maxEnemy + column;
          proposalColumns.push({
            status: pac.cellStatus[at],
            setupDelay: pac.cellSetupDelay[at],
            mobilityLoss: pac.cellMobilityLoss[at],
            endpointReduction: pac.cellEndpointReduction[at]
          });
        }
        this.optionProposalRoots.push({
          schemaVersion: 2,
          frame: frame.frame,
          stateHashLo: state.hashLo,
          stateHashHi: state.hashHi,
          mapHashLo: this.engine.adapter.mapHashLo,
          mapHashHi: this.engine.adapter.mapHashHi,
          informationComplete: this.engine.adapter.informationComplete,
          hiddenSupportComplete: this.engine.hiddenSupportComplete,
          hiddenWorldCell: Array.from(this.engine.hiddenWorldCell.subarray(
            0, this.engine.hiddenWorldCount)),
          hiddenWorldMass: Array.from(this.engine.hiddenWorldMass.subarray(
            0, this.engine.hiddenWorldCount)),
          enemyActions: Array.from(this.engine.enemyActions.subarray(0, this.engine.enemyCount)),
          enemyArguments: Array.from(this.engine.enemyArguments.subarray(0, this.engine.enemyCount)),
          committedSupportStatus: escape.supportStatus,
          committedEntityCount: escape.committedEntityCount,
          incumbentOptionKind: evaluator.optionKind[incumbentOption],
          proposalOptionKind: evaluator.optionKind[proposalOption],
          incumbentLower: interval.lower[incumbentOption],
          incumbentUpper: interval.upper[incumbentOption],
          proposalLower: interval.lower[proposalOption],
          proposalUpper: interval.upper[proposalOption],
          incumbent: copyRow(incumbentRow),
          proposal: copyRow(proposalRow),
          proposalAttackColumns: proposalColumns,
          selectedAction: returned,
          actionPrefixThroughDecision: Buffer.from(this.compactActionCodes).toString("base64"),
          observation: {
            ownPosition: diagnosticCopy(context.me?.tank?.position),
            ownDirection: context.me?.tank?.direction || null,
            enemyPosition: diagnosticCopy(context.enemy?.tank?.position),
            enemyDirection: context.enemy?.tank?.direction || null,
            ownStars: context.me?.stars || 0,
            enemyStars: context.enemy?.stars || 0,
            star: diagnosticCopy(context.game?.star),
            ownBullet: diagnosticCopy(context.me?.bullet),
            enemyBullet: diagnosticCopy(context.enemy?.bullet),
            bombs: diagnosticCopy(context.game?.bombs)
          }
        });
      }
    }
    if (this.captureTwoStageSetupRoots &&
        this.engine.optionInformationInterval &&
        this.engine.optionInformationInterval.attemptCount > beforeOptionIntervalAttempts) {
      const interval = this.engine.optionInformationInterval;
      const evaluator = interval.evaluator;
      const closure = this.engine.attackSetupClosure;
      const twoStage = closure && closure.twoStage;
      const possibleSetup = closure && closure.possibleProjectile;
      if (twoStage && twoStage.evaluationCount > beforeTwoStageEvaluations)
        for (let row = 0; row < this.engine.ourCount; row += 1) {
        if (!twoStage.status[row]) continue;
        let option = -1;
        for (let index = 0; index < interval.optionCount; index += 1)
          if (evaluator.optionPrimitiveRow[index] === row) { option = index; break; }
        const incumbentOption = interval.lastIncumbentOption;
        const incumbentRow = incumbentOption >= 0 ?
          evaluator.optionPrimitiveRow[incumbentOption] : -1;
        const risk = this.engine.riskController.outcome;
        const combat = this.engine.combat.vector;
        const rootMetrics = target => target < 0 ? null : {
          row: target,
          action: this.engine.ourActions[target],
          argument: this.engine.ourArguments[target],
          hard: this.engine.hardStatus[target],
          acceptable: risk.acceptable[target],
          dominated: risk.dominated[target],
          safety: risk.safety[target],
          immediateFatalMass: risk.immediateFatalMass[target],
          horizonFatalMass: risk.horizonFatalMass[target],
          committedFatalMass: risk.committedFatalMass[target],
          possibleProjectileFatalMass: risk.possibleProjectileFatalMass[target],
          futureFireFatalMass: risk.futureFireFatalMass[target],
          unknownMass: risk.unknownMass[target],
          earliestFatalFrame: risk.earliestFatalFrame[target],
          escapeSlack: risk.escapeSlack[target],
          coverage: risk.coverage[target],
          worstValue: risk.worstValue[target],
          nominalRobustLower: risk.nominalRobustLower[target],
          searchEstimate: risk.searchEstimate[target],
          robustLower: risk.robustLower[target],
          expectedValue: risk.expectedValue[target],
          tacticalValue: risk.tacticalValue[target],
          hitDeadline: combat.hitDeadline[target],
          ownCounterExposure: combat.ownCounterExposure[target],
          postFireEscape: combat.postFireEscape[target],
          purposeCompleteness: combat.purposeCompleteness[target],
          attackClosureStatus: combat.attackClosureStatus[target],
          enemyDoomedFirstActions: combat.enemyDoomedFirstActions[target],
          enemySurvivingFirstActions: combat.enemySurvivingFirstActions[target],
          enemyUnknownFirstActions: combat.enemyUnknownFirstActions[target],
          enemyFrontierColumns: combat.enemyFrontierColumns[target],
          enemyCounterfireDelay: combat.enemyCounterfireDelay[target],
          enemyMobilityLoss: combat.enemyMobilityLoss[target],
          enemyEndpointReduction: combat.enemyEndpointReduction[target]
        };
        const sample = {
          schemaVersion: 1,
          frame: frame.frame,
          stateHashLo: this.engine.adapter.state.hashLo,
          stateHashHi: this.engine.adapter.state.hashHi,
          mapHashLo: this.engine.adapter.mapHashLo,
          mapHashHi: this.engine.adapter.mapHashHi,
          informationComplete: this.engine.adapter.informationComplete,
          hiddenSupportComplete: this.engine.hiddenSupportComplete,
          hiddenWorldCount: this.engine.hiddenWorldCount,
          hiddenWorldMass0: this.engine.hiddenWorldMass[0] || 0,
          observationSafetySupportComplete:
            this.engine.observationSafetySupportComplete(),
          possibleProjectileCount: this.engine.possibleProjectiles.count(),
          trackerComplete: this.engine.adapter.tracker.complete,
          threatCapabilityComplete: this.engine.threatCapability.complete,
          enemyCapabilitySupportComplete:
            this.engine.adapter.enemyCapabilitySupportComplete,
          enemyCapabilityReason: this.engine.adapter.enemyCapabilityReason,
          informationSupportComplete: interval.information.supportComplete,
          informationApproximate: interval.information.approximate,
          informationSelectedWorldCount:
            interval.information.lastSelectedWorldCount,
          informationEffectiveEnemyCount:
            interval.information.lastEffectiveEnemyCount,
          informationDirectionCount: interval.information.lastDirectionCount,
          informationWorkInterruptedCount:
            interval.information.workInterruptedCount,
          option,
          primitiveRow: row,
          action: this.engine.ourActions[row],
          argument: this.engine.ourArguments[row],
          intervalLower: option >= 0 ? interval.lower[option] : null,
          intervalUpper: option >= 0 ? interval.upper[option] : null,
          incumbentOption,
          incumbentLower: incumbentOption >= 0 ? interval.lower[incumbentOption] : null,
          incumbentUpper: incumbentOption >= 0 ? interval.upper[incumbentOption] : null,
          candidateRoot: rootMetrics(row),
          incumbentRoot: rootMetrics(incumbentRow),
          status: twoStage.status[row],
          reason: twoStage.reason[row],
          rootBranches: twoStage.rootBranches[row],
          secondBranches: twoStage.secondBranches[row],
          doomedColumns: twoStage.doomedColumns[row],
          constrainedColumns: twoStage.constrainedColumns[row],
          uncoveredColumns: twoStage.uncoveredColumns[row],
          possibleSetupStatus: possibleSetup ? possibleSetup.status[row] : 0,
          possibleSetupReason: possibleSetup ? possibleSetup.reason[row] : 0,
          possiblePresentRootBranches: possibleSetup ?
            possibleSetup.presentRootBranches[row] : 0,
          possiblePresentSecondBranches: possibleSetup ?
            possibleSetup.presentSecondBranches[row] : 0,
          possiblePresentDoomedColumns: possibleSetup ?
            possibleSetup.presentDoomedColumns[row] : 0,
          possiblePresentConstrainedColumns: possibleSetup ?
            possibleSetup.presentConstrainedColumns[row] : 0,
          possiblePresentUncoveredColumns: possibleSetup ?
            possibleSetup.presentUncoveredColumns[row] : 0,
          selectedAction: returned,
          observation: {
            ownPosition: diagnosticCopy(context.me?.tank?.position),
            ownDirection: context.me?.tank?.direction || null,
            enemyPosition: diagnosticCopy(context.enemy?.tank?.position),
            enemyDirection: context.enemy?.tank?.direction || null,
            ownStars: context.me?.stars || 0,
            enemyStars: context.enemy?.stars || 0,
            star: diagnosticCopy(context.game?.star)
          }
        };
        if (this.twoStageSetupRoots.length < 64) this.twoStageSetupRoots.push(sample);
        else if (sample.status === 1) {
          const replace = this.twoStageSetupRoots.findIndex(root => root.status !== 1);
          if (replace >= 0) this.twoStageSetupRoots[replace] = sample;
        }
      }
    }
    if (this.captureSampleFrames && this.sampleFrameCount < 128) {
      let at = this.sampleFrameCount * SAMPLE_FRAME_STRIDE;
      const words = this.sampleFrameWords;
      words[at++] = frame.frame; words[at++] = returned;
      words[at++] = this.engine.lastRootStatus; words[at++] = selectedHardCode;
      words[at++] = this.engine.lastProofStatus; words[at++] = runtimeMode;
      words[at++] = allowCount; words[at++] = frame.physicalCompletedDepth;
      words[at++] = frame.informationCompletedDepth; words[at++] = frame.informationWorlds;
      words[at++] = frame.depthNodes; words[at++] = frame.score; words[at++] = frame.workUnits;
      words[at++] = this.engine.escapeObligation.supportStatus;
      words[at++] = this.engine.escapeObligation.firstActionCount;
      words[at++] = this.engine.escapeObligation.rootSlack;
      words[at++] = this.engine.riskController.noAcceptableAction;
      words[at++] = this.engine.riskController.acceptableCount;
      words[at++] = this.engine.stageMatrixSolveCount;
      this.sampleFrameCount += 1;
    }
    if (this.captureActionFrames) this.actionFrames.push({ frame: frame.frame,
      action: frame.action, command: action ? diagnosticCopy(action) : null,
      workUnits: frame.workUnits, root: frame.root, informationComplete: frame.informationComplete,
      selectedHard: frame.selectedHard, allowCount: frame.allowCount, proof: frame.proof,
      proofCompletedDepth: frame.proofCompletedDepth, proofNodes: frame.proofNodes,
      completedDepth: frame.completedDepth, depthNodes: frame.depthNodes,
      score: frame.score, runtimeMode: frame.runtimeMode, fallback: frame.fallback,
      invalidFallback: frame.invalidFallback, runtimeMicros: frame.runtimeMicros });
    if (this.captureAllFrames) {
      const candidates = [];
      for (let index = 0; index < this.engine.ourCount; index += 1) {
        const risk = this.engine.riskController.outcome;
        const rawSafety = this.engine.safetyClosure.outcome;
        const riskDomain = index < risk.count;
        const safetyBase = index * 4;
        let rawCommittedFatalMass = 0;
        let rawPossibleProjectileFatalMass = 0;
        let rawFutureFireFatalMass = 0;
        for (let depth = 0; depth < 4; depth += 1) {
          rawCommittedFatalMass = Math.min(10000, rawCommittedFatalMass +
            rawSafety.committedDeathMass[safetyBase + depth]);
          rawPossibleProjectileFatalMass = Math.min(10000,
            rawPossibleProjectileFatalMass +
            rawSafety.possibleProjectileDeathMass[safetyBase + depth]);
          rawFutureFireFatalMass = Math.min(10000, rawFutureFireFatalMass +
            rawSafety.futureFireDeathMass[safetyBase + depth]);
        }
        const depthSource = this.engine.informationSearch.completedDepth > 0 ?
          this.engine.informationSearch : this.engine.depthSearch;
        const chanceSupportCount = this.engine.finalGate.chanceSupportCount[index];
        const chanceOffset = index * this.engine.finalGate.chanceDirection.length /
          this.engine.finalGate.chanceSupportCount.length;
        const chanceSuccessors = [];
        for (let chance = 0; chance < chanceSupportCount; chance += 1) {
          const at = chanceOffset + chance;
          chanceSuccessors.push([
            this.engine.finalGate.chanceCell[at],
            this.engine.finalGate.chanceDirection[at]
          ]);
        }
        const enemyScores = []; let worstEnemyIndex = -1; let worstEnemyScore = 32001;
        for (let enemyIndex = 0; enemyIndex < this.engine.enemyCount; enemyIndex += 1) {
          const value = depthSource.rootCellScore[index * 24 + enemyIndex];
          enemyScores.push([ACTION_NAME[this.engine.enemyActions[enemyIndex]] ||
            `ACTION_${this.engine.enemyActions[enemyIndex]}`, value]);
          if (value < worstEnemyScore) { worstEnemyScore = value; worstEnemyIndex = enemyIndex; }
        }
        candidates.push({
          action: ACTION_NAME[this.engine.ourActions[index]] || `ACTION_${this.engine.ourActions[index]}`,
          projectedCell: this.engine.projectedCell[index],
          projectedDirection: this.engine.projectedDirection[index],
          chanceSupportCount,
          chanceFatalSupportCount: this.engine.finalGate.chanceFatalSupportCount[index],
          chanceIncompleteSupportCount:
            this.engine.finalGate.chanceIncompleteSupportCount[index],
          chanceSuccessors,
          hard: HARD_NAME[this.engine.hardStatus[index]] || String(this.engine.hardStatus[index]),
          score: this.engine.score[index], depthScore: this.engine.depthSearch.rootScore[index],
          informationScore: this.engine.informationSearch.rootScore[index],
          safety: this.engine.safetyClosure.outcome.status[index],
          riskDomain,
          immediateFatalMass: riskDomain ? risk.immediateFatalMass[index] : null,
          committedChanceFatalMass: riskDomain ?
            risk.committedChanceFatalMass[index] : null,
          horizonFatalMass: riskDomain ? risk.horizonFatalMass[index] : null,
          unknownMass: riskDomain ? risk.unknownMass[index] : null,
          committedFatalMass: riskDomain ? risk.committedFatalMass[index] : null,
          possibleProjectileFatalMass: riskDomain ?
            risk.possibleProjectileFatalMass[index] : null,
          futureFireFatalMass: riskDomain ? risk.futureFireFatalMass[index] : null,
          rawCommittedFatalMass,
          rawPossibleProjectileFatalMass,
          rawFutureFireFatalMass,
          unknownFallbackRisk: riskDomain ? risk.unknownFallbackRisk[index] : null,
          earliestFatalFrame: riskDomain ? risk.earliestFatalFrame[index] : null,
          escapeSlack: riskDomain ? risk.escapeSlack[index] : null,
          acceptable: riskDomain && Boolean(risk.acceptable[index]),
          dominated: riskDomain && Boolean(risk.dominated[index]),
          robustLower: riskDomain ? risk.robustLower[index] : null,
          tacticalValue: riskDomain ? risk.tacticalValue[index] : null,
          expectedValue: riskDomain ? risk.expectedValue[index] : null,
          combatPurpose: riskDomain ? risk.combatPurpose[index] : null,
          directKill: Boolean(this.engine.combat.vector.directKill[index]),
          attackClosureStatus: this.engine.combat.vector.attackClosureStatus[index],
          enemyDoomedFirstActions:
            this.engine.combat.vector.enemyDoomedFirstActions[index],
          enemySurvivingFirstActions:
            this.engine.combat.vector.enemySurvivingFirstActions[index],
          enemyUnknownFirstActions:
            this.engine.combat.vector.enemyUnknownFirstActions[index],
          enemyFrontierColumns:
            this.engine.combat.vector.enemyFrontierColumns[index],
          enemyCounterfireDelay:
            this.engine.combat.vector.enemyCounterfireDelay[index],
          enemyMobilityLoss:
            this.engine.combat.vector.enemyMobilityLoss[index],
          enemyEndpointReduction:
            this.engine.combat.vector.enemyEndpointReduction[index],
          hitDeadline: riskDomain ? risk.hitDeadline[index] : null,
          enemySafeSuccessors: riskDomain ? risk.enemySafeSuccessors[index] : null,
          ownCounterExposure: riskDomain ? risk.ownCounterExposure[index] : null,
          blockadeValue: riskDomain ? risk.blockadeValue[index] : null,
          purposeCompleteness: riskDomain ? risk.purposeCompleteness[index] : null,
          postFireEscape: riskDomain ? risk.postFireEscape[index] : null,
          residualAttackProof: this.engine.residualAttackProofStatus ?
            PROOF_NAME[this.engine.residualAttackProofStatus[index]] : null,
          residualAttackProofSupportComplete: this.engine.residualAttackProofStatus ?
            Boolean(this.engine.adapter.informationComplete) : null,
          residualAttackProofNodes: this.engine.residualAttackProofStatus &&
            this.engine.ourActions[index] === ACTION.FIRE ?
            this.engine.residualAttackProof.nodes : null,
          residualAttackProofCompletedDepth: this.engine.residualAttackProofStatus &&
            this.engine.ourActions[index] === ACTION.FIRE ?
            this.engine.residualAttackProof.completedDepth : null,
          residualAttackProofIncompleteNodes: this.engine.residualAttackProofStatus &&
            this.engine.ourActions[index] === ACTION.FIRE ?
            this.engine.residualAttackProof.incompleteCount : null,
          residualAttackProofBudgetStops: this.engine.residualAttackProofStatus &&
            this.engine.ourActions[index] === ACTION.FIRE ?
            this.engine.residualAttackProof.budgetStopCount : null,
          committedEscapeMember: Boolean(this.engine.escapeObligation.member[index]),
          committedSuccessorProof: this.engine.escapeObligation.successorProof[index],
          committedSuccessorExposed:
            this.engine.escapeObligation.successorExposed[index],
          committedSuccessorSlack: this.engine.escapeObligation.successorSlack[index],
          committedSuccessorBranches:
            this.engine.escapeObligation.successorBranches[index],
          committedSuccessorCoverage:
            this.engine.escapeObligation.successorCoverage[index],
          committedSuccessorSurvivalMass:
            this.engine.escapeObligation.successorSurvivalMass[index],
          combatPressure: riskDomain ? risk.combatPressure[index] : null,
          policyProbability: this.engine.policyProbability[index],
          worstEnemyAction: worstEnemyIndex < 0 ? null :
            ACTION_NAME[this.engine.enemyActions[worstEnemyIndex]], enemyScores
        });
      }
      const ownPosition = context.me?.tank?.position; const enemyPosition = context.enemy?.tank?.position;
      const star = context.game?.star;
      frame.state = { ownPosition: Array.isArray(ownPosition) ? ownPosition.slice() : null,
        ownDirection: context.me?.tank?.direction || null, ownStars: context.me?.stars || 0,
        ownStatus: diagnosticCopy(context.me?.status),
        ownEffects: diagnosticCopy(context.me?.effects),
        enemyPosition: Array.isArray(enemyPosition) ? enemyPosition.slice() : null,
        enemyDirection: context.enemy?.tank?.direction || null, enemyStars: context.enemy?.stars || 0,
        enemyStatus: diagnosticCopy(context.enemy?.status),
        enemyEffects: diagnosticCopy(context.enemy?.effects),
        star: Array.isArray(star) ? star.slice() : null,
        ownBullet: diagnosticCopy(context.me?.bullet),
        enemyBullet: diagnosticCopy(context.enemy?.bullet),
        bombs: diagnosticCopy(context.game?.bombs) };
      frame.candidates = candidates; this.diagnosticFrames.push(frame);
    }
    if (this.captureExceptionalFrames && (frame.root !== "OK" ||
        frame.selectedHard !== "ALLOW" || frame.fallback ||
        frame.proof === "PROVEN" || frame.completedDepth === 0)) {
      this.exceptionalFrameCount += 1;
      if (this.frames.length < 32) this.frames.push(frame);
    }
    return { action, logs: [], runtimeMs: runtimeMicros / 1000 };
  }
  summary() {
    const engine = this.engine; const total = this.runtimeMicros.reduce((sum, value) => sum + value, 0);
    const p2FastActionPairs = [];
    const p2PairCounts = engine.depthSearch.depthTwoPreflightP2FastActionPairCounts;
    if (p2PairCounts) {
      const stride = ACTION.BOOST_RIGHT_BOMB + 1;
      for (let own = 0; own < stride; own += 1)
        for (let enemy = 0; enemy < stride; enemy += 1) {
          const count = p2PairCounts[own * stride + enemy];
          if (count) p2FastActionPairs.push([own, enemy, count]);
        }
    }
    const summary = {
      decisionCount: engine.decisionCount,
      totalRuntimeMicros: total,
      p50RuntimeMicros: percentile(this.runtimeMicros, 50),
      p95RuntimeMicros: percentile(this.runtimeMicros, 95),
      maxRuntimeMicros: this.runtimeMicros.length ? Math.max(...this.runtimeMicros) : 0,
      actionCounts: this.actionCounts,
      runtimeModeCounts: this.runtimeModeCounts,
      runtimeSchedule: {
        firstModeFrame: Array.from(this.firstRuntimeModeFrame),
        searchFrames: this.searchFrameCount,
        searchNodes: this.searchNodeCount,
        searchAttemptFrames: this.searchAttemptFrameCount,
        searchAttemptNodes: this.searchAttemptNodeCount,
        physicalSearchFrames: this.physicalSearchFrameCount,
        physicalSearchNodes: this.physicalSearchNodeCount,
        informationSearchFrames: this.informationSearchFrameCount,
        informationSearchNodes: this.informationSearchNodeCount,
        forcedWinSearchFrames: this.forcedWinSearchFrameCount,
        forcedWinSearchNodes: this.forcedWinSearchNodeCount,
        forcedWinProofs: engine.forcedWinCount,
        observationSafetyAudits: engine.observationSafetyAuditCount,
        rootActionTotal: this.ourActionTotal,
        hardAllowedActionTotal: this.hardAllowedActionTotal,
        enemyActionTotal: this.enemyActionTotal,
        searchRootActionTotal: this.searchOurActionTotal,
        searchHardAllowedActionTotal: this.searchHardAllowedActionTotal,
        riskAcceptableActionTotal: this.riskAcceptableActionTotal,
        riskFrontierActionTotal: this.riskFrontierActionTotal,
        strategySelectedActionTotal: this.strategySelectedActionTotal,
        searchRiskAcceptableActionTotal: this.searchRiskAcceptableActionTotal,
        searchRiskFrontierActionTotal: this.searchRiskFrontierActionTotal,
        searchStrategySelectedActionTotal: this.searchStrategySelectedActionTotal,
        searchEnemyActionTotal: this.searchEnemyActionTotal,
        informationWorldTotal: this.informationWorldTotal,
        completedDepthCounts: Array.from(this.searchCompletedDepthCounts),
        physicalValueSupportDepthCounts:
          Array.from(this.physicalValueSupportDepthCounts),
        selectiveFrames: this.selectiveSearchFrameCount,
        selectiveNodes: this.selectiveSearchNodeCount,
        selectiveCompletedDepthCounts: Array.from(this.selectiveCompletedDepthCounts)
      },
      contactSupportCensus: {
        roots: this.contactSupportRootCount,
        exact: this.contactSupportExactCount,
        recoverablePhysical: this.contactSupportRecoverablePhysicalCount,
        possibleOnlyTracked: this.contactSupportPossibleOnlyTrackedCount,
        possibleOnlyIncomplete: this.contactSupportPossibleOnlyIncompleteCount,
        possibleWithOther: this.contactSupportPossibleWithOtherCount,
        otherGap: this.contactSupportOtherGapCount,
        gapBitCount: Array.from(this.contactSupportGapBitCount),
        possibleCount: Array.from(this.contactSupportPossibleCount)
      },
      compactPhysicalRiskFrontier: {
        enabled: Boolean(engine.compactPhysicalRiskFrontierEnabled),
        attempts: engine.compactPhysicalRiskFrontierAttempts,
        fullRows: engine.compactPhysicalRiskFrontierFullRows,
        compactRows: engine.compactPhysicalRiskFrontierRows,
        singleRows: engine.compactPhysicalRiskFrontierSingleRows,
        violations: engine.compactPhysicalRiskFrontierViolations
      },
      depthTwoPreflight: {
        enabled: Boolean(engine.depthSearch.depthTwoPreflightEnabled),
        roots: engine.depthSearch.depthTwoPreflightRootCount,
        impossibleRoots: engine.depthSearch.depthTwoPreflightImpossibleCount,
        states: engine.depthSearch.depthTwoPreflightStateCountTotal,
        projectedNodes: engine.depthSearch.depthTwoPreflightProjectedNodesTotal,
        availableNodes: engine.depthSearch.depthTwoPreflightAvailableNodesTotal,
        p2Attempts: engine.depthSearch.depthTwoPreflightP2Attempts,
        p2Completed: engine.depthSearch.depthTwoPreflightP2Completed,
        p2ExactCompleted: engine.depthSearch.depthTwoPreflightP2ExactCompleted,
        p2CompletedNonExact:
          engine.depthSearch.depthTwoPreflightP2CompletedNonExact,
        p2WithExactP1: engine.depthSearch.depthTwoPreflightP2WithExactP1,
        p2WithoutExactP1: engine.depthSearch.depthTwoPreflightP2WithoutExactP1,
        p2NonExactWithoutExactP1:
          engine.depthSearch.depthTwoPreflightP2NonExactWithoutExactP1,
        p2BudgetInterrupted: engine.depthSearch.depthTwoPreflightP2BudgetInterrupted,
        p2SupportAborted: engine.depthSearch.depthTwoPreflightP2SupportAborted,
        p2WidthAborted: engine.depthSearch.depthTwoPreflightP2WidthAborted,
        p2FastAborted: engine.depthSearch.depthTwoPreflightP2FastAborted,
        p2HardAborted: engine.depthSearch.depthTwoPreflightP2HardAborted,
        p2UnclassifiedAborted:
          engine.depthSearch.depthTwoPreflightP2UnclassifiedAborted,
        p2PrincipalBlockedWidth:
          engine.depthSearch.depthTwoPreflightP2PrincipalBlockedWidth,
        p2PrincipalBlockedFast:
          engine.depthSearch.depthTwoPreflightP2PrincipalBlockedFast,
        p2PrincipalBlockedHard:
          engine.depthSearch.depthTwoPreflightP2PrincipalBlockedHard,
        p2FastStatusCounts: engine.depthSearch.depthTwoPreflightP2FastStatusCounts ?
          Array.from(engine.depthSearch.depthTwoPreflightP2FastStatusCounts) : [],
        p2FastActionPairs,
        p2TransitionIncomplete:
          engine.depthSearch.depthTwoPreflightP2TransitionIncomplete,
        p2OtherFailure: engine.depthSearch.depthTwoPreflightP2OtherFailure,
        scheduleEligible: engine.depthSearch.depthTwoPreflightScheduleEligible,
        scheduleBudgetBlocked:
          engine.depthSearch.depthTwoPreflightScheduleBudgetBlocked,
        scheduleStunBlocked: engine.depthSearch.depthTwoPreflightScheduleStunBlocked,
        scheduleFireContactBlocked:
          engine.depthSearch.depthTwoPreflightScheduleFireContactBlocked,
        directStunRoots: engine.depthSearch.directStunRootCount,
        directStunSizeBlocked: engine.depthSearch.directStunSizeBlockedCount,
        directStunP1Completed: engine.depthSearch.directStunP1Completed,
        directStunP2Completed: engine.depthSearch.directStunP2Completed,
        directStunP2Failed: engine.depthSearch.directStunP2Failed,
        directStunRootMatrixBuckets: Array.from(this.stunDirectRootMatrixBuckets),
        directStunP2CompletedBuckets: Array.from(this.stunDirectP2CompletedBuckets),
        directStunExactP2Buckets: Array.from(this.stunDirectExactP2Buckets),
        directStunFailedBuckets: Array.from(this.stunDirectFailedBuckets),
        hotAllocationCount: 0
      },
      reverseViabilityCache: engine.adapter.hazard ? {
        entries: engine.adapter.hazard.reverseCacheEntries,
        hits: engine.adapter.hazard.reverseCacheHitCount,
        misses: engine.adapter.hazard.reverseCacheMissCount,
        latticeEntries: engine.adapter.hazard.reverseLatticeEntries,
        latticeHits: engine.adapter.hazard.reverseLatticeHitCount,
        latticeMisses: engine.adapter.hazard.reverseLatticeMissCount,
        planeRebuilds: engine.adapter.hazard.rebuildCount,
        planeHits: engine.adapter.hazard.cacheHitCount,
        layerHits: engine.adapter.hazard.reverseLatticeLayerHitCount,
        layerMisses: engine.adapter.hazard.reverseLatticeLayerMissCount,
        latticeBuilds: engine.adapter.hazard.reverseLatticeBuildCount,
        latticeBuildNodes: engine.adapter.hazard.reverseLatticeBuildNodeCount,
        uncachedBuilds: engine.adapter.hazard.reverseUncachedBuildCount,
        uncachedBuildNodes: engine.adapter.hazard.reverseUncachedBuildNodeCount,
        deadlineSharedBuilds: engine.escapeObligation.deadline.sharedLayerBuildCount,
        deadlineSharedHits: engine.escapeObligation.deadline.sharedLayerHitCount,
        deadlinePrivateBuilds: engine.escapeObligation.deadline.privateReverseBuildCount,
        timelineBuilds: engine.escapeObligation.deadline.timelineBuildCount,
        timelineNodes: engine.escapeObligation.deadline.timelineNodeCount,
        successorSlabFills: engine.escapeObligation.successorSlabFillCount
      } : { entries: 0, hits: 0, misses: 0, latticeEntries: 0,
        latticeHits: 0, latticeMisses: 0, planeRebuilds: 0, planeHits: 0,
        layerHits: 0, layerMisses: 0, latticeBuilds: 0, latticeBuildNodes: 0,
        uncachedBuilds: 0, uncachedBuildNodes: 0, deadlineSharedBuilds: 0,
        deadlineSharedHits: 0, deadlinePrivateBuilds: 0, timelineBuilds: 0,
        timelineNodes: 0, successorSlabFills: 0 },
      crossFramePV: {
        successorOrderingEnabled: Boolean(engine.depthSearch.crossFramePVEnabled),
        rootOrderingEnabled: Boolean(engine.depthSearch.crossFrameRootPVEnabled),
        lookups: engine.depthSearch.crossFramePVLookupCount,
        hits: engine.depthSearch.crossFramePVHitCount,
        rootPromotions: engine.depthSearch.crossFramePVRootPromoteCount,
        deepPromotions: engine.depthSearch.crossFramePVDeepPromoteCount,
        stores: engine.rootTransitions.principalStoreCount,
        commits: engine.rootTransitions.principalCommitCount,
        overflows: engine.rootTransitions.principalOverflowCount
      },
      accumulatedWorkUnits: engine.runtime.accumulatedWorkUnits,
      accumulatedMandatoryWorkUnits: engine.runtime.accumulatedMandatoryWorkUnits,
      accumulatedOptionalWorkUnits: engine.runtime.accumulatedOptionalWorkUnits,
      opponent: { updateCount: engine.policy.opponent.updateCount,
        riskPreference: engine.policy.opponent.riskPreference,
        riskConfidence: engine.policy.opponent.riskConfidence },
      strategyPriority: this.strategyPriority.summary(),
      nativeInitiative: {
        enabled: Boolean(engine.nativeInitiativeEnabled),
        ...engine.nativeInitiativeArbiter.summary()
      },
      responseOption: engine.responseOption.summary(),
      optionPortfolio: engine.optionPortfolio ? engine.optionPortfolio.summary() : null,
      objectiveOption: engine.objectiveOptionRouter ?
        engine.objectiveOptionRouter.summary() : null,
      nominalPhysicalEvidence: engine.nominalPhysicalEvidenceArbiter.summary(),
      noAcceptableCensus: this.noAcceptableCensus ?
        this.noAcceptableCensus.summary() : null,
      expandedTacticalContact: {
        mask: engine.expandedTacticalContactMask,
        disabled: engine.expandedContactDisabledCount,
        bomb: engine.expandedContactBombCount,
        predictive: engine.expandedContactPredictiveCount
      },
      contactSearchFunnel: {
        exact: engine.contactExactCount,
        inexact: engine.contactInexactCount,
        emergency: engine.contactEmergencyCount,
        valueBudget: engine.contactValueBudgetCount,
        valueBudgetBlocked: engine.contactValueBudgetBlockedCount,
        informationConsumerBlocked: engine.contactInformationConsumerBlockedCount,
        nominalPhysicalCalls: engine.nominalPhysicalSearchCount,
        nominalPhysicalCompleted: engine.nominalPhysicalCompletedCount,
        nominalPhysicalScheduleBlocked: engine.nominalPhysicalScheduleBlockedCount,
        refutedPossiblePhysicalEligible:
          engine.refutedPossiblePhysicalEligibleCount,
        refutedPossiblePhysicalCalls:
          engine.refutedPossiblePhysicalSearchCount,
        refutedPossiblePhysicalCompleted:
          engine.refutedPossiblePhysicalCompletedCount,
        refutedPossiblePhysicalCombatBlocked:
          engine.refutedPossiblePhysicalCombatBlockedCount,
        refutedPossiblePhysicalVerifierChecks:
          engine.refutedPossiblePhysicalVerifierCheckCount,
        refutedPossiblePhysicalVerifierProposals:
          engine.refutedPossiblePhysicalVerifierProposalCount,
        refutedPossiblePhysicalVerifierOverrides:
          engine.refutedPossiblePhysicalVerifierOverrideCount,
        refutedPossiblePhysicalVerifierIncomplete:
          engine.refutedPossiblePhysicalVerifierIncompleteCount,
        refutedPossiblePhysicalVerifierRiskBlocked:
          engine.refutedPossiblePhysicalVerifierRiskBlockedCount
      },
      strictSafeThreatFireShadow: {
        enabled: Boolean(engine.diagnosticStrictSafeThreatFireShadow),
        scheduled: engine.strictSafeThreatFireShadowScheduledCount,
        exactBlocked: engine.strictSafeThreatFireShadowExactBlockedCount,
        possibleOnlyBlocked:
          engine.strictSafeThreatFireShadowPossibleOnlyBlockedCount,
        possibleWithOtherBlocked:
          engine.strictSafeThreatFireShadowPossibleWithOtherBlockedCount,
        otherGapBlocked: engine.strictSafeThreatFireShadowOtherGapBlockedCount,
        gapBitCount: engine.strictSafeThreatFireShadowGapBitCount ?
          Array.from(engine.strictSafeThreatFireShadowGapBitCount) :
          new Array(15).fill(0),
        possibleCount: engine.strictSafeThreatFireShadowPossibleCount ?
          Array.from(engine.strictSafeThreatFireShadowPossibleCount) :
          new Array(9).fill(0),
        possiblePoolComplete:
          engine.strictSafeThreatFireShadowPossiblePoolCompleteCount,
        possiblePoolIncomplete:
          engine.strictSafeThreatFireShadowPossiblePoolIncompleteCount,
        resolvedPossibleGap:
          engine.strictSafeThreatFireShadowResolvedPossibleGapCount,
        budgetBlocked: engine.strictSafeThreatFireShadowBudgetBlockedCount,
        rootFireBlocked:
          engine.strictSafeThreatFireShadowRootFireBlockedCount,
        proven: engine.strictSafeThreatFireShadowProvenCount,
        doomedProven: engine.strictSafeThreatFireShadowDoomedProvenCount,
        threatOnlyProven:
          engine.strictSafeThreatFireShadowThreatOnlyProvenCount,
        pacComplete: engine.strictSafeThreatFireShadowPacCompleteCount,
        pacIncomplete: engine.strictSafeThreatFireShadowPacIncompleteCount,
        prunableRoots:
          engine.strictSafeThreatFireShadowPrunableRootCount,
        prunableColumns:
          engine.strictSafeThreatFireShadowPrunableColumnCount,
        prunableRootNodes:
          engine.strictSafeThreatFireShadowPrunableRootNodeCount,
        unknown: engine.strictSafeThreatFireShadowUnknownCount,
        actionable: engine.strictSafeThreatFireShadowActionableCount,
        alreadyFire: engine.strictSafeThreatFireShadowAlreadyFireCount,
        active: Boolean(engine.diagnosticStrictSafeThreatFireActive),
        doomedActive: Boolean(engine.diagnosticStrictDoomedFireActive),
        overrides: engine.strictSafeThreatFireActiveOverrideCount,
        doomedOverrides: engine.strictDoomedFireActiveOverrideCount,
        missingRows: engine.strictSafeThreatFireActiveMissingRowCount,
        finalRejects: engine.strictSafeThreatFireActiveFinalRejectCount,
        nodes: engine.strictSafeThreatFireShadowNodes,
        workUnits: engine.strictSafeThreatFireShadowWorkUnits,
        restoreFailures: engine.strictSafeThreatFireShadowRestoreFailures,
        hotAllocations: engine.strictSafeThreatFireShadowHotAllocationCount
      },
      optionAwareSearch: engine.optionAwareDepthSearch ? {
        active: Boolean(engine.optionAwareSearchActive),
        singleSearch: Boolean(engine.optionAwareSingleSearch),
        ...engine.optionAwareDepthSearch.summary(),
        selectedProposalCount: engine.optionAwareSearchProposalCount,
        overrideCount: engine.optionAwareSearchOverrideCount,
        hardBlockedCount: engine.optionAwareSearchHardBlockedCount,
        riskBlockedCount: engine.optionAwareSearchRiskBlockedCount,
        committedBlockedCount: engine.optionAwareSearchCommittedBlockedCount,
        nonTacticalBlockedCount: engine.optionAwareSearchNonTacticalBlockedCount,
        incompleteSupportCount: engine.optionAwareSearchIncompleteSupportCount,
        lastProposal: engine.optionAwareSearchLastProposal
      } : null,
      optionInformationInterval: engine.optionInformationInterval ?
        engine.optionInformationInterval.summary() : null,
      selectiveGeometryRuntimeShadow: engine.selectiveGeometryShadow ?
        engine.selectiveGeometryShadow.summary() : { enabled: false },
      actionContinuationEnvelope: this.actionContinuationEnvelope ?
        this.actionContinuationEnvelope.summary() : { enabled: false },
      commonPolicyOptionInterval: this.commonPolicyOptionInterval ?
        this.commonPolicyOptionInterval.summary() : { enabled: false },
      attackOpportunityCensus: this.attackOpportunityCensus ?
        this.attackOpportunityCensus.summary() : null,
      verifiedAttackProposal: this.verifiedAttackProposal ?
        this.verifiedAttackProposal.summary() : null,
      attackObjectiveField: this.attackObjectiveField ?
        this.attackObjectiveField.summary() : null,
      eventDrivenOptionShadow: this.eventDrivenOptionShadow ?
        this.eventDrivenOptionShadow.summary() : null,
      stableOptionLedgerShadow: this.stableOptionLedgerShadow ?
        this.stableOptionLedgerShadow.summary() : null,
      strategicStateLedgerShadow: this.strategicStateLedgerShadow ?
        this.strategicStateLedgerShadow.summary() : null,
      objectiveEpochContinuityShadow: this.objectiveEpochContinuityShadow ?
        this.objectiveEpochContinuityShadow.summary() : null,
      objectiveEpochExecutionShadow: this.objectiveEpochExecutionShadow ?
        this.objectiveEpochExecutionShadow.summary() : null,
      semanticAttackOptionCoverageShadow:
        this.semanticAttackOptionCoverageShadow ?
          this.semanticAttackOptionCoverageShadow.summary() : null,
      semanticAttackExecutionIntervalShadow:
        this.semanticAttackExecutionIntervalShadow ?
          this.semanticAttackExecutionIntervalShadow.summary() : null,
      semanticAttackPolicyIntervalShadow:
        this.semanticAttackPolicyIntervalShadow ?
          this.semanticAttackPolicyIntervalShadow.summary() : null,
      objectiveEpochOptionArbiterShadow: this.objectiveEpochOptionArbiterShadow ?
        this.objectiveEpochOptionArbiterShadow.summary() : null,
      objectiveEpochActivePoc: this.objectiveEpochActivePoc ?
        this.objectiveEpochActivePoc.summary() : null,
      semanticObjectiveEpochOptionActivePoc:
        this.semanticObjectiveEpochOptionActivePoc ?
          this.semanticObjectiveEpochOptionActivePoc.summary() : null,
      strategicConflictArbiterShadow: this.strategicConflictArbiterShadow ?
        this.strategicConflictArbiterShadow.summary() : null,
      strategicTargetExecutionShadow: this.strategicTargetExecutionShadow ?
        this.strategicTargetExecutionShadow.summary() : null,
      strategicTargetExecutionRoots: this.captureStrategicTargetExecutionRoots ?
        this.strategicTargetExecutionRoots : undefined,
      stableOptionIntervalShadow: this.stableOptionIntervalShadow ?
        this.stableOptionIntervalShadow.summary() : null,
      attackContinuationProgressShadow: this.attackContinuationProgressShadow ?
        this.attackContinuationProgressShadow.summary() : null,
      attackSequenceGeneratorShadow: this.attackSequenceGeneratorShadow ?
        this.attackSequenceGeneratorShadow.summary() : null,
      attackPolicyReachabilityShadow: this.attackPolicyReachabilityShadow ?
        this.attackPolicyReachabilityShadow.summary() : null,
      attackResponseSetShadow: this.attackResponseSetShadow ?
        this.attackResponseSetShadow.summary() : null,
      combatUtilityEnvelopeShadow: this.combatUtilityEnvelopeShadow ?
        this.combatUtilityEnvelopeShadow.summary() : null,
      attackStarPolicyFrontierShadow: this.attackStarPolicyFrontierShadow ?
        this.attackStarPolicyFrontierShadow.summary() : null,
      responseConditionedOptionPolicyShadow:
        this.responseConditionedOptionPolicyShadow ?
          this.responseConditionedOptionPolicyShadow.summary() : null,
      riskConditionedResponsePolicyShadow:
        this.riskConditionedResponsePolicyShadow ?
          this.riskConditionedResponsePolicyShadow.summary() : null,
      riskConditionedCombatProposal: this.riskConditionedCombatProposal ?
        this.riskConditionedCombatProposal.summary() : null,
      qualifiedAttackOverStar: this.qualifiedAttackOverStar ?
        this.qualifiedAttackOverStar.summary() : null,
      strategicAttackOverStarProposal: this.strategicAttackOverStarProposal ?
        this.strategicAttackOverStarProposal.summary() : null,
      persistentAttackTarget: this.persistentAttackTarget ?
        this.persistentAttackTarget.summary() : null,
      riskFrontierPhysicalSearchProbe: this.riskFrontierPhysicalSearchProbe ?
        this.riskFrontierPhysicalSearchProbe.summary() : null,
      planLifecycle: {
        commits: engine.planCommitCount,
        activations: engine.planActivateCount,
        completions: engine.planCompleteCount,
        invalidations: engine.planInvalidateCount,
        navigationCommits: engine.navigationPlanCommitCount,
        navigationActivations: engine.navigationPlanActivateCount,
        navigationReuses: engine.navigationPlanReuseCount,
        navigationExpirations: engine.navigationPlanExpireCount
      },
      exceptionalFrameCount: this.exceptionalFrameCount,
      layerTotals: {
        rootCounts: this.rootCounts,
        hardRejects: engine.hardRejectAvoided,
        selectedHardRejects: this.hardSelectedRejectCount,
        avoidableHardRejects: this.avoidableHardRejectCount,
        unavoidableAllRejected: this.unavoidableAllRejectedCount,
        proofWins: engine.forcedWinCount,
        noAcceptableActions: engine.noAcceptableActionCount,
        riskDominatedSelections: this.riskDominatedSelectionCount,
        stageMatrixSolves: engine.stageMatrixSolveCount,
        completeValueOwners: engine.riskController.completeValueOwnerCount,
        incompleteValueOwners: engine.riskController.incompleteValueOwnerCount,
        incompleteValueEvidenceOnly: engine.riskController.incompleteValueEvidenceOnlyCount,
        fallbacks: engine.fallbackCount,
        depthRootRestoreFailures: this.rootRestoreFailures,
        selectiveSearchFrames: this.selectiveSearchFrameCount,
        selectiveSearchNodes: this.selectiveSearchNodeCount,
        hotAllocations: engine.hotAllocationCount + engine.depthSearch.hotAllocationCount +
          engine.informationSearch.hotAllocationCount + engine.forcedWinSearch.hotAllocationCount +
          engine.strictSafeThreatFireShadowHotAllocationCount +
          (engine.residualAttackProof ? engine.residualAttackProof.hotAllocationCount : 0) +
          engine.path.hotAllocationCount + engine.combat.hotAllocationCount +
          engine.combat.vector.hotAllocationCount + engine.safetyClosure.hotAllocationCount +
          engine.safetyClosure.outcome.hotAllocationCount +
          engine.threatCapability.hotAllocationCount +
          engine.observationSafety.hotAllocationCount +
          engine.observationSafety.stateArena.hotAllocationCount +
          engine.policy.proposalArbiter.hotAllocationCount +
          (engine.selectiveGeometryShadow ?
            engine.selectiveGeometryShadow.hotAllocationCount : 0) +
          (this.actionContinuationEnvelope ?
            this.actionContinuationEnvelope.hotAllocationCount : 0) +
          (this.commonPolicyOptionInterval ?
            this.commonPolicyOptionInterval.hotAllocationCount : 0) +
          (this.stableOptionLedgerShadow ?
            this.stableOptionLedgerShadow.hotAllocationCount : 0) +
          (this.strategicStateLedgerShadow ?
            this.strategicStateLedgerShadow.hotAllocationCount : 0) +
          (this.objectiveEpochContinuityShadow ?
            this.objectiveEpochContinuityShadow.hotAllocationCount : 0) +
          (this.objectiveEpochExecutionShadow ?
            this.objectiveEpochExecutionShadow.hotAllocationCount : 0) +
          (this.semanticAttackOptionCoverageShadow ?
            this.semanticAttackOptionCoverageShadow.hotAllocationCount : 0) +
          (this.semanticAttackExecutionIntervalShadow ?
            this.semanticAttackExecutionIntervalShadow.hotAllocationCount : 0) +
          (this.semanticAttackPolicyIntervalShadow ?
            this.semanticAttackPolicyIntervalShadow.totalHotAllocationCount() : 0) +
          (this.objectiveEpochOptionArbiterShadow ?
            this.objectiveEpochOptionArbiterShadow.hotAllocationCount : 0) +
          (this.semanticObjectiveEpochOptionActivePoc ?
            this.semanticObjectiveEpochOptionActivePoc.hotAllocationCount : 0) +
          (this.objectiveEpochActivePoc ?
            this.objectiveEpochActivePoc.hotAllocationCount : 0) +
          (this.strategicConflictArbiterShadow ?
            this.strategicConflictArbiterShadow.hotAllocationCount : 0) +
          (this.strategicTargetExecutionShadow ?
            this.strategicTargetExecutionShadow.hotAllocationCount : 0) +
          (this.stableOptionIntervalShadow ?
            this.stableOptionIntervalShadow.hotAllocationCount : 0) +
          (this.attackContinuationProgressShadow ?
            this.attackContinuationProgressShadow.hotAllocationCount : 0) +
          (this.attackSequenceGeneratorShadow ?
            this.attackSequenceGeneratorShadow.hotAllocationCount : 0) +
          (this.attackPolicyReachabilityShadow ?
            this.attackPolicyReachabilityShadow.hotAllocationCount : 0) +
          (this.attackResponseSetShadow ?
            this.attackResponseSetShadow.hotAllocationCount : 0) +
          (this.combatUtilityEnvelopeShadow ?
            this.combatUtilityEnvelopeShadow.hotAllocationCount : 0) +
          (this.attackStarPolicyFrontierShadow ?
            this.attackStarPolicyFrontierShadow.hotAllocationCount : 0) +
          (this.responseConditionedOptionPolicyShadow ?
            this.responseConditionedOptionPolicyShadow.hotAllocationCount : 0) +
          (this.riskConditionedResponsePolicyShadow ?
            this.riskConditionedResponsePolicyShadow.hotAllocationCount : 0) +
          (this.riskConditionedCombatProposal ?
            this.riskConditionedCombatProposal.hotAllocationCount : 0) +
          (this.strategicAttackOverStarProposal ?
            this.strategicAttackOverStarProposal.hotAllocationCount : 0) +
          (this.persistentAttackTarget ?
            this.persistentAttackTarget.hotAllocationCount : 0)
      },
      ...(this.captureExceptionalFrames ? { exceptionalFrames: this.frames } : {})
    };
    if (this.captureActionFrames) summary.actionFrames = this.actionFrames;
    if (this.captureAllFrames) summary.diagnosticFrames = this.diagnosticFrames;
    if (this.captureOptionProposalRoots)
      summary.optionProposalRoots = this.optionProposalRoots;
    if (this.captureRiskConditionedCombatRoots)
      summary.riskConditionedCombatRoots = this.riskConditionedCombatRoots;
    if (this.captureTwoStageSetupRoots)
      summary.twoStageSetupRoots = this.twoStageSetupRoots;
    if (this.captureCompactFrames) {
      summary.compactActionStream = Buffer.from(this.compactActionCodes).toString("base64");
      summary.compactFrameFlags = Buffer.from(this.compactFrameFlags).toString("base64");
      summary.compactArguments = this.compactArguments;
    }
    if (this.captureSampleFrames) {
      summary.sampleFrameStride = SAMPLE_FRAME_STRIDE;
      summary.sampleFrameCount = this.sampleFrameCount;
      summary.sampleFrameWords = this.sampleFrameWords.subarray(
        0, this.sampleFrameCount * SAMPLE_FRAME_STRIDE);
    }
    if (this.captureWorkLedger) {
      const units = {}; const calls = {};
      for (let kind = 0; kind < WORK_KIND.COUNT; kind += 1) {
        const name = WORK_KIND_NAME[kind] || `WORK_KIND_${kind}`;
        units[name] = this.workLedgerUnits[kind];
        calls[name] = this.workLedgerCalls[kind];
      }
      summary.workLedger = {
        units,
        calls,
        accountUnits: {
          MANDATORY: this.workAccountUnits[WORK_ACCOUNT.MANDATORY],
          OPTIONAL: this.workAccountUnits[WORK_ACCOUNT.OPTIONAL]
        },
        totalUnits: this.workLedgerUnits.reduce((sum, value) => sum + value, 0)
      };
    }
    if (this.capturePhaseTiming) {
      const micros = {}; const exclusiveMicros = {}; const calls = {};
      for (let phase = 0; phase < PHASE_NAME.length; phase += 1) {
        micros[PHASE_NAME[phase]] = Math.round(this.phaseTimingNanos[phase] / 1000);
        exclusiveMicros[PHASE_NAME[phase]] =
          Math.round(this.phaseExclusiveNanos[phase] / 1000);
        calls[PHASE_NAME[phase]] = this.phaseTimingCalls[phase];
      }
      summary.phaseTiming = { micros, exclusiveMicros, calls,
        matrixIterations: this.matrixSolverIterations };
    }
    if (this.selectiveInformationProbe)
      summary.selectiveInformationProbe = this.selectiveInformationProbe.summary();
    if (this.informationSupportProbe)
      summary.informationSupportProbe = this.informationSupportProbe.summary();
    if (this.informationIntervalOwnershipProbe)
      summary.informationIntervalOwnershipProbe =
        this.informationIntervalOwnershipProbe.summary();
    if (this.selectiveGeometrySearchProbe)
      summary.selectiveGeometrySearchProbe = this.selectiveGeometrySearchProbe.summary();
    summary.layerTotals.escapeRestrictions = engine.escapeObligation.restrictedSelectionCount;
    summary.layerTotals.escapeRescueOverrides = engine.escapeObligation.rescueOverrideCount;
    summary.layerTotals.strictRescueChecks = engine.escapeObligation.strictRescueCheckCount;
    summary.layerTotals.strictRescueCandidates = engine.escapeObligation.strictRescueCandidateCount;
    summary.layerTotals.strictRescueOverrides = engine.escapeObligation.strictRescueOverrideCount;
    summary.layerTotals.strictRescueFinalRejects =
      engine.escapeObligation.strictRescueFinalRejectCount;
    summary.layerTotals.persistentEscapeChecks =
      engine.escapeObligation.persistentCheckCount;
    summary.layerTotals.persistentEscapeCandidates =
      engine.escapeObligation.persistentCandidateCount;
    summary.layerTotals.persistentEscapeOverrides =
      engine.escapeObligation.persistentOverrideCount;
    summary.layerTotals.persistentEscapeFinalRejects =
      engine.escapeObligation.persistentFinalRejectCount;
    summary.layerTotals.strictProofRescueConflicts = engine.strictProofRescueConflictCount;
    summary.layerTotals.verifiedDirectKillChecks = engine.verifiedDirectKillCheckCount;
    summary.layerTotals.verifiedDirectKillCandidates = engine.verifiedDirectKillCandidateCount;
    summary.layerTotals.verifiedDirectKillOverrides = engine.verifiedDirectKillOverrideCount;
    summary.layerTotals.verifiedDirectKillFinalRejects =
      engine.verifiedDirectKillFinalRejectCount;
    summary.layerTotals.verifiedDirectKillObserved = engine.verifiedDirectKillObservedCount;
    summary.layerTotals.verifiedDirectKillHardBlocked =
      engine.verifiedDirectKillHardBlockedCount;
    summary.layerTotals.verifiedDirectKillRiskBlocked =
      engine.verifiedDirectKillRiskBlockedCount;
    summary.layerTotals.verifiedDirectKillClosureBlocked =
      engine.verifiedDirectKillClosureBlockedCount;
    summary.layerTotals.verifiedDirectKillPurposeBlocked =
      engine.verifiedDirectKillPurposeBlockedCount;
    summary.layerTotals.verifiedDirectKillEscapeBlocked =
      engine.verifiedDirectKillEscapeBlockedCount;
    summary.layerTotals.verifiedDirectKillExposureBlocked =
      engine.verifiedDirectKillExposureBlockedCount;
    summary.layerTotals.verifiedDirectKillRobustBlocked =
      engine.verifiedDirectKillRobustBlockedCount;
    summary.layerTotals.verifiedDirectKillSourceBlocked =
      engine.verifiedDirectKillSourceBlockedCount;
    summary.layerTotals.verifiedDirectKillAlreadySelected =
      engine.verifiedDirectKillAlreadySelectedCount;
    summary.layerTotals.verifiedDirectKillCausalCandidates =
      engine.verifiedDirectKillCausalCandidateCount;
    summary.layerTotals.verifiedDirectKillCausalOverrides =
      engine.verifiedDirectKillCausalOverrideCount;
    summary.layerTotals.residualAttackProofChecks = engine.residualAttackProofCheckCount;
    summary.layerTotals.residualAttackProofProven = engine.residualAttackProofProvenCount;
    summary.layerTotals.residualAttackProofDisproven = engine.residualAttackProofDisprovenCount;
    summary.layerTotals.residualAttackProofUnknown = engine.residualAttackProofUnknownCount;
    summary.layerTotals.residualAttackProofIncompleteSupportProven =
      engine.residualAttackProofIncompleteSupportProvenCount;
    summary.layerTotals.residualAttackProofNodes = engine.residualAttackProofNodeCount;
    summary.layerTotals.residualAttackProofRootRestoreFailures =
      engine.residualAttackProof ? engine.residualAttackProof.rootRestoreFailures : 0;
    return summary;
  }
}

module.exports = { ACTION_NAME, ROOT_NAME, HARD_NAME, PROOF_NAME, SAMPLE_FRAME_STRIDE,
  rootFlag, actionProxy, diagnosticCopy, emittedActionRow,
  ProductionDiagnosticBot };
