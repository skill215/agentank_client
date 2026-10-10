"use strict";

const { FAST_STATUS, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { SEARCH_CAPACITY } = require("../../../engine-v2/src/generated/search-config");
const { NONE_HANDLE } = require("../../../engine-v2/src/abi/policy-codes");
const { WORK_KIND } = require("../../../engine-v2/src/abi/cache-runtime-codes");
const { V3_COMPONENT_ABI, V3_COMPONENT_MODE, V3_RESULT_STATUS,
  V3_PROPOSAL_CLASS, V3_EVIDENCE, V3_SLOT } = require("../contracts");
const { actionFromLegacy } = require("../contracts");
const { ComponentResult } = require("../component-result");
const { NONEXACT_ABORT_REASON } = require(
  "../../../engine-v2/src/search/production-depth-search");
const { FAST_UNSUPPORTED_REASON, JOINT_RELOCATION_DETAIL } =
  require("../../../engine-v2/src/fast/kernel");
const { MOVE_CONTEST_VARIANT, MoveContestVariantKernel } = require(
  "../../../tools/agentank/diagnostics/move-contest-variant-kernel");
const { OptionPolicyCertificate } = require("../option-policy-certificate");
const { NativeV1PolicyLeafEvaluatorPoc } = require(
  "../../../tools/agentank/diagnostics/native-v1-policy-leaf-evaluator-poc");

const OWNERSHIP_MODE = Object.freeze({
  RISK_ROBUST: "risk-robust",
  PHYSICAL_CELL_DOMINANCE: "physical-cell-dominance",
  PHYSICAL_STRICT_MAXIMIN: "physical-strict-maximin-dominance"
});

class V2TacticalCoreAdapter {
  constructor(bridge, mode = V3_COMPONENT_MODE.SHADOW, options = {}) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.TACTICAL_SEARCH;
    this.id = "V2_TACTICAL_CORE";
    this.bridge = bridge;
    this.mode = mode;
    this.allowCompletionOwnership = options.allowCompletionOwnership ? 1 : 0;
    this.ownershipMode = options.ownershipMode === OWNERSHIP_MODE.PHYSICAL_CELL_DOMINANCE ?
      OWNERSHIP_MODE.PHYSICAL_CELL_DOMINANCE :
      options.ownershipMode === OWNERSHIP_MODE.PHYSICAL_STRICT_MAXIMIN ?
        OWNERSHIP_MODE.PHYSICAL_STRICT_MAXIMIN : OWNERSHIP_MODE.RISK_ROBUST;
    this.minimumOwnershipDepth = Number.isInteger(options.minimumOwnershipDepth) &&
      options.minimumOwnershipDepth > 0 ? options.minimumOwnershipDepth : 1;
    this.refineDepthTwo = options.refineDepthTwo ? 1 : 0;
    this.refineMoveVariants = options.refineMoveVariants ? 1 : 0;
    this.refinementNodeBudget = Number.isInteger(options.refinementNodeBudget) &&
      options.refinementNodeBudget > 0 ? options.refinementNodeBudget : 512;
    this.refinementRows = this.refineDepthTwo ?
      new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS) : null;
    this.variantNonWorse = this.refineMoveVariants ?
      new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS) : null;
    this.variantWorst = this.refineMoveVariants ?
      new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS) : null;
    this.variantKernels = this.refineMoveVariants ? [
      new MoveContestVariantKernel(null, MOVE_CONTEST_VARIANT.SEQUENTIAL_BLOCK),
      new MoveContestVariantKernel(null, MOVE_CONTEST_VARIANT.INTENT_BLOCK),
      new MoveContestVariantKernel(null, MOVE_CONTEST_VARIANT.COLLISION_CRASH)
    ] : null;
    this.optionPolicyCertificate = options.optionPolicyCertificateShadow ||
      options.optionPolicyCertificateActive ?
      new OptionPolicyCertificate() : null;
    if (this.optionPolicyCertificate) bridge.optionPolicyCandidate = this.optionPolicyCertificate;
    this.leafEvaluator = options.leafEvaluator === "v1-policy" ?
      new NativeV1PolicyLeafEvaluatorPoc({ discountSimulatedProjectiles: true }) : null;
    if (this.leafEvaluator) this.leafEvaluator.install(bridge.engine.depthSearch);
    this.rootPolicyPrior = options.rootPolicyPrior === "v1-action-seed" ? 1 :
      options.rootPolicyPrior === "v1-action-persistent" ? 2 : 0;
    this.variantSelectedRow = -1;
    this.result = new ComponentResult(bridge.proposals, V3_SLOT.TACTICAL_SEARCH,
      mode === V3_COMPONENT_MODE.ACTIVE);
    this.callCount = 0;
    this.completeCount = 0;
    this.incompleteCount = 0;
    this.overrideCount = 0;
    this.exceptionCount = 0;
    this.physicalSearchCount = 0;
    this.informationSearchCount = 0;
    this.stageMatrixCount = 0;
    this.supportExactCount = 0;
    this.exactDominanceCount = 0;
    this.physicalCellCheckCount = 0;
    this.physicalCellSupportCount = 0;
    this.physicalCellLegacyMissingCount = 0;
    this.physicalCellDominanceCount = 0;
    this.physicalCellNoDominanceCount = 0;
    this.physicalWorstTieBlockedCount = 0;
    this.physicalDepthBlockedCount = 0;
    this.refinementCheckCount = 0;
    this.refinementEligibleCount = 0;
    this.refinementCompleteCount = 0;
    this.refinementIncompleteCount = 0;
    this.refinementNodeCount = 0;
    this.refinementMaximumRows = 0;
    this.refinementWidthAbortCount = 0;
    this.refinementFastAbortCount = 0;
    this.refinementHardAbortCount = 0;
    this.refinementBudgetAbortCount = 0;
    this.refinementOtherAbortCount = 0;
    this.refinementFastStatusCount = new Uint32Array(FAST_STATUS.EXECUTION_ERROR + 1);
    this.refinementUnsupportedReasonCount = new Uint32Array(
      FAST_UNSUPPORTED_REASON.TERMINAL_RUNTIME_TIE + 1);
    this.refinementFailureActionPairCount = new Uint32Array(24 * 24);
    this.refinementJointRelocationDetailCount = new Uint32Array(
      JOINT_RELOCATION_DETAIL.OTHER + 1);
    this.variantRefinementAttemptCount = 0;
    this.variantRefinementCompleteCount = 0;
    this.variantRefinementIncompleteCount = 0;
    this.variantRefinementNodeCount = 0;
    this.variantRefinementSelectionCount = 0;
    this.firstPhysicalCellFrame = -1;
    this.firstPhysicalCellLegacyAction = -1;
    this.firstPhysicalCellCandidateAction = -1;
    this.firstPhysicalCellDepth = 0;
    this.firstPhysicalCellLegacyValue = 0;
    this.firstPhysicalCellCandidateValue = 0;
    this.firstPhysicalCellMinimumMargin = 0;
    this.firstPhysicalCellPlanKind = 0;
    this.firstPhysicalCellPlanPurpose = 0;
    this.firstPhysicalCellPlanDeadline = 0;
    this.firstPhysicalCellPlanRawScore = 0;
    this.sameActionCount = 0;
  }

  matrixDominates(source, candidate, incumbent, enemyCount) {
    if (!source || candidate < 0 || incumbent < 0 || enemyCount < 1) return false;
    const stride = source.rootCellScore.length / source.rootScore.length;
    let strict = false;
    for (let column = 0; column < enemyCount; column += 1) {
      const left = source.rootCellScore[candidate * stride + column];
      const right = source.rootCellScore[incumbent * stride + column];
      if (left < right) return false;
      if (left > right) strict = true;
    }
    return strict;
  }

  physicalDominates(source, candidate, incumbent, enemyCount) {
    if (!this.matrixDominates(source, candidate, incumbent, enemyCount)) return false;
    return this.ownershipMode !== OWNERSHIP_MODE.PHYSICAL_STRICT_MAXIMIN ||
      source.rootScore[candidate] > source.rootScore[incumbent];
  }

  physicalCellDominanceSelection(engine, legacyAction) {
    this.physicalCellCheckCount += 1;
    if (this.variantSelectedRow >= 0) {
      this.physicalCellSupportCount += 1;
      this.physicalCellDominanceCount += 1;
      return this.variantSelectedRow;
    }
    const source = engine.depthSearch;
    if (source.completedDepth < 1 || !source.representativeSupportComplete ||
        source.representativeSupportDepth < 1 || source.rootEnemyCount < 1) return -1;
    this.physicalCellSupportCount += 1;
    if (source.representativeSupportDepth < this.minimumOwnershipDepth) {
      this.physicalDepthBlockedCount += 1; return -1;
    }
    let incumbent = -1;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === legacyAction &&
          engine.hardStatus[row] === HARD_STATUS.ALLOW &&
          (!source.rootDomainRestricted || source.rootDomainMask[row])) {
        incumbent = row; break;
      }
    if (incumbent < 0) {
      this.physicalCellLegacyMissingCount += 1; return -1;
    }
    let best = -1; let bestValue = -32001;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (row === incumbent || engine.hardStatus[row] !== HARD_STATUS.ALLOW ||
          source.rootDomainRestricted && !source.rootDomainMask[row] ||
          !this.matrixDominates(source, row, incumbent, source.rootEnemyCount)) continue;
      if (this.ownershipMode === OWNERSHIP_MODE.PHYSICAL_STRICT_MAXIMIN &&
          source.rootScore[row] <= source.rootScore[incumbent]) {
        this.physicalWorstTieBlockedCount += 1; continue;
      }
      const value = source.rootScore[row];
      if (best < 0 || value > bestValue || value === bestValue && row < best) {
        best = row; bestValue = value;
      }
    }
    if (best < 0) this.physicalCellNoDominanceCount += 1;
    else {
      this.physicalCellDominanceCount += 1;
      if (this.firstPhysicalCellFrame < 0) {
        let minimumMargin = 32000;
        const stride = source.rootCellScore.length / source.rootScore.length;
        for (let column = 0; column < source.rootEnemyCount; column += 1)
          minimumMargin = Math.min(minimumMargin,
            source.rootCellScore[best * stride + column] -
            source.rootCellScore[incumbent * stride + column]);
        this.firstPhysicalCellFrame = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
        this.firstPhysicalCellLegacyAction = engine.ourActions[incumbent];
        this.firstPhysicalCellCandidateAction = engine.ourActions[best];
        this.firstPhysicalCellDepth = source.representativeSupportDepth;
        this.firstPhysicalCellLegacyValue = source.rootScore[incumbent];
        this.firstPhysicalCellCandidateValue = source.rootScore[best];
        this.firstPhysicalCellMinimumMargin = minimumMargin;
        const handle = engine.planSketchHandle[best];
        if (handle !== NONE_HANDLE && handle < engine.policy.sketches.used) {
          const sketches = engine.policy.sketches;
          this.firstPhysicalCellPlanKind = sketches.kind[handle];
          this.firstPhysicalCellPlanPurpose = sketches.purpose[handle];
          this.firstPhysicalCellPlanDeadline = sketches.deadline[handle];
          this.firstPhysicalCellPlanRawScore = sketches.rawScore[handle];
        }
      }
    }
    return best;
  }

  refinePhysicalDepthTwo(engine, legacyAction) {
    if (!this.refineDepthTwo) return;
    this.variantSelectedRow = -1;
    this.refinementCheckCount += 1;
    const source = engine.depthSearch;
    if (!source.representativeSupportComplete ||
        source.representativeSupportDepth !== 1 || source.rootEnemyCount < 1) return;
    let incumbent = -1;
    for (let row = 0; row < source.rootActionCount; row += 1)
      if (engine.ourActions[row] === legacyAction &&
          engine.hardStatus[row] === HARD_STATUS.ALLOW &&
          (!source.rootDomainRestricted || source.rootDomainMask[row])) {
        incumbent = row; break;
      }
    if (incumbent < 0) return;
    let count = 0;
    for (let row = 0; row < source.rootActionCount; row += 1) {
      const included = row === incumbent ||
        engine.hardStatus[row] === HARD_STATUS.ALLOW &&
        (!source.rootDomainRestricted || source.rootDomainMask[row]) &&
        this.matrixDominates(source, row, incumbent, source.rootEnemyCount) &&
        source.rootScore[row] > source.rootScore[incumbent];
      if (included) this.refinementRows[count++] = row;
    }
    if (count < 2 || count >= source.rootActionCount) return;
    this.refinementEligibleCount += 1;
    this.refinementMaximumRows = Math.max(this.refinementMaximumRows, count);
    const completed = source.search(this.bridge.bundle, engine.ourActions,
      engine.ourArguments, source.rootActionCount, engine.enemyActions,
      engine.enemyArguments, engine.enemyCount, 2, this.refinementNodeBudget,
      engine.policy.baseRisk, 0, this.refinementRows, count);
    source.expandRootDomain();
    engine.chargeValueSearchWork(source);
    this.refinementNodeCount += source.nodes;
    if (completed >= 2 && source.representativeSupportComplete &&
        source.representativeSupportDepth >= 2) this.refinementCompleteCount += 1;
    else {
      this.refinementIncompleteCount += 1;
      if (source.lastNonExactAbortReason === NONEXACT_ABORT_REASON.WIDTH)
        this.refinementWidthAbortCount += 1;
      else if (source.lastNonExactAbortReason === NONEXACT_ABORT_REASON.FAST)
        { this.refinementFastAbortCount += 1;
          const failure = this.bridge.bundle.kernel.failure | 0;
          if (failure >= 0 && failure < this.refinementFastStatusCount.length)
            this.refinementFastStatusCount[failure] += 1;
          const reason = this.bridge.bundle.kernel.failureReason | 0;
          if (reason >= 0 && reason < this.refinementUnsupportedReasonCount.length)
            this.refinementUnsupportedReasonCount[reason] += 1;
          const action0 = this.bridge.bundle.kernel.failureAction0 | 0;
          const action1 = this.bridge.bundle.kernel.failureAction1 | 0;
          if (action0 >= 0 && action0 < 24 && action1 >= 0 && action1 < 24)
            this.refinementFailureActionPairCount[action0 * 24 + action1] += 1;
          const detail = this.bridge.bundle.kernel.failureDetail | 0;
          if (detail >= 0 && detail < this.refinementJointRelocationDetailCount.length)
            this.refinementJointRelocationDetailCount[detail] += 1; }
      else if (source.lastNonExactAbortReason === NONEXACT_ABORT_REASON.HARD)
        this.refinementHardAbortCount += 1;
      else if (source.nodes >= this.refinementNodeBudget)
        this.refinementBudgetAbortCount += 1;
      else this.refinementOtherAbortCount += 1;
      if (this.refineMoveVariants &&
          source.lastNonExactAbortReason === NONEXACT_ABORT_REASON.FAST &&
          this.bridge.bundle.kernel.failureReason ===
            FAST_UNSUPPORTED_REASON.JOINT_TANK_RELOCATION)
        this.refineAcrossMoveVariants(engine, incumbent, count);
    }
  }

  refineAcrossMoveVariants(engine, incumbent, count) {
    this.variantRefinementAttemptCount += 1;
    const source = engine.depthSearch; const bundle = this.bridge.bundle;
    const originalKernel = bundle.kernel; const originalHardKernel = bundle.hard.kernel;
    const rootTransitions = source.rootTransitions;
    const rootTransitionsEnabled = rootTransitions?.enabled ? 1 : 0;
    const cacheEnabled = source.cache.enabled ? 1 : 0;
    this.variantNonWorse.fill(0); this.variantWorst.fill(32000);
    for (let at = 0; at < count; at += 1) this.variantNonWorse[this.refinementRows[at]] = 1;
    let complete = 1; let nodes = 0;
    try {
      source.cache.setEnabled(false);
      if (rootTransitions) rootTransitions.setEnabled(false);
      for (let variant = 0; variant < this.variantKernels.length; variant += 1) {
        const kernel = this.variantKernels[variant]; kernel.state = bundle.state;
        bundle.kernel = kernel; bundle.hard.kernel = kernel;
        const completed = source.search(bundle, engine.ourActions, engine.ourArguments,
          source.rootActionCount, engine.enemyActions, engine.enemyArguments,
          engine.enemyCount, 2, this.refinementNodeBudget, engine.policy.baseRisk,
          0, this.refinementRows, count);
        nodes += source.nodes; engine.chargeValueSearchWork(source);
        if (completed < 2 || !source.representativeSupportComplete ||
            source.representativeSupportDepth < 2) { complete = 0; break; }
        const stride = source.rootCellScore.length / source.rootScore.length;
        for (let at = 0; at < count; at += 1) {
          const row = this.refinementRows[at];
          this.variantWorst[row] = Math.min(this.variantWorst[row], source.rootScore[row]);
          for (let column = 0; column < source.rootEnemyCount; column += 1)
            if (source.rootCellScore[row * stride + column] <
                source.rootCellScore[incumbent * stride + column])
              this.variantNonWorse[row] = 0;
        }
      }
    } finally {
      bundle.kernel = originalKernel; bundle.hard.kernel = originalHardKernel;
      source.cache.setEnabled(cacheEnabled);
      if (rootTransitions) {
        rootTransitions.setEnabled(rootTransitionsEnabled);
        rootTransitions.prepared = 0;
      }
      source.expandRootDomain();
    }
    this.refinementNodeCount += nodes;
    this.variantRefinementNodeCount += nodes;
    if (!complete) { this.variantRefinementIncompleteCount += 1; return; }
    this.variantRefinementCompleteCount += 1;
    let best = -1; let bestWorst = -32001;
    for (let at = 0; at < count; at += 1) {
      const row = this.refinementRows[at];
      if (row === incumbent || !this.variantNonWorse[row] ||
          this.variantWorst[row] <= this.variantWorst[incumbent]) continue;
      if (best < 0 || this.variantWorst[row] > bestWorst ||
          this.variantWorst[row] === bestWorst && row < best) {
        best = row; bestWorst = this.variantWorst[row];
      }
    }
    if (best >= 0) {
      this.variantSelectedRow = best;
      this.variantRefinementSelectionCount += 1;
    }
  }

  select(legacyAction) {
    const bridge = this.bridge; const engine = bridge.engine;
    if (!bridge.prepared || !bridge.bundle) return -1;
    const runtime = engine.runtime;
    runtime.beginCallback(bridge.frame, engine.adapter.mapHashLo,
      engine.adapter.mapHashHi, bridge.matchReset);
    runtime.charge(WORK_KIND.ROOT, 1);
    let selected = -1;
    try {
      if (!bridge.matchReset) engine.reconcilePlans();
      if (this.leafEvaluator) this.leafEvaluator.beginRoot(bridge.bundle.state);
      engine.generateActions();
      if (this.rootPolicyPrior)
        engine.depthSearch.setDiagnosticRootPrior(legacyAction, 0xffff, 0,
          this.rootPolicyPrior === 1);
      const matrixBefore = engine.stageMatrixSolveCount;
      selected = engine.selectAction(bridge.bundle, engine.adapter.informationComplete);
      this.refinePhysicalDepthTwo(engine, legacyAction);
      if (engine.depthSearch.completedDepth > 0) this.physicalSearchCount += 1;
      if (engine.informationSearch.completedDepth > 0) this.informationSearchCount += 1;
      if (engine.stageMatrixSolveCount > matrixBefore) this.stageMatrixCount += 1;
      if (selected >= 0) engine.validatePlanContinuations(bridge.bundle, selected);
    } finally {
      if (this.rootPolicyPrior) engine.depthSearch.clearDiagnosticRootPrior();
      runtime.finishCallback();
    }
    if (selected < 0 || selected >= engine.ourCount ||
        engine.hardStatus[selected] !== HARD_STATUS.ALLOW ||
        !engine.finalGate.finalAllows(bridge.bundle, engine.ourActions,
          engine.ourArguments, selected, engine.ourCount)) return -1;
    return selected;
  }

  invoke(call) {
    this.callCount += 1;
    if (this.mode === V3_COMPONENT_MODE.PASS_THROUGH) return call.next();
    // V1 supplies the default proposal first. V2 is evaluated as evidence and
    // may replace it only when a completed finite-horizon interval is strictly
    // separated. Search completion alone is never ownership.
    const legacy = call.next();
    const legacyAction = actionFromLegacy(legacy);
    let selected = -1;
    try { selected = this.select(legacyAction); }
    catch (_) { this.exceptionCount += 1; selected = -1; }
    if (selected < 0) {
      this.incompleteCount += 1;
      this.result.set(V3_RESULT_STATUS.INCOMPLETE, 0, -1, false,
        V3_EVIDENCE.INFORMATION | V3_EVIDENCE.FALLBACK, 0);
      return legacy;
    }
    this.completeCount += 1;
    const engine = this.bridge.engine; const action = engine.ourActions[selected];
    const argument = engine.ourArguments[selected];
    if (this.ownershipMode === OWNERSHIP_MODE.PHYSICAL_CELL_DOMINANCE ||
        this.ownershipMode === OWNERSHIP_MODE.PHYSICAL_STRICT_MAXIMIN) {
      const dominant = this.physicalCellDominanceSelection(engine, legacyAction);
      if (dominant < 0) {
        this.result.set(V3_RESULT_STATUS.NO_PROPOSAL, legacyAction, -1, true,
          V3_EVIDENCE.OBSERVATION_COMPLETE, engine.depthSearch.nodes,
          V3_PROPOSAL_CLASS.EXACT_VALUE_DOMINANCE, false);
        return legacy;
      }
      selected = dominant;
    }
    const selectedAction = engine.ourActions[selected];
    const selectedArgument = engine.ourArguments[selected];
    let legacyRow = -1;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === legacyAction) { legacyRow = row; break; }
    const information = engine.informationSearch.completedDepth > 0;
    const source = information ? engine.informationSearch : engine.depthSearch;
    const exactSupport = information ? source.supportComplete && !source.approximate &&
      source.completedDepth > 0 && source.completedDepth === source.attemptedDepth :
      source.completedDepth > 0 && source.completedDepth === source.attemptedDepth &&
      source.representativeSupportComplete;
    if (exactSupport) this.supportExactCount += 1;
    const outcome = engine.riskController.outcome;
    const exactDominance = this.ownershipMode === OWNERSHIP_MODE.PHYSICAL_CELL_DOMINANCE ||
      this.ownershipMode === OWNERSHIP_MODE.PHYSICAL_STRICT_MAXIMIN ||
      exactSupport && legacyRow >= 0 && legacyRow < outcome.count &&
      selected < outcome.count && selectedAction !== legacyAction && outcome.coverage[selected] === 10000 &&
      outcome.coverage[legacyRow] === 10000 && outcome.robustLower[selected] >
        outcome.robustLower[legacyRow];
    if (selectedAction === legacyAction) this.sameActionCount += 1;
    if (exactDominance) this.exactDominanceCount += 1;
    if (exactDominance && selectedAction !== legacyAction && this.optionPolicyCertificate)
      this.optionPolicyCertificate.build(this.bridge.bundle, engine.depthSearch,
        selected, engine);
    const eligible = this.mode === V3_COMPONENT_MODE.ACTIVE &&
      (this.allowCompletionOwnership || exactDominance);
    this.result.set(V3_RESULT_STATUS.PROPOSED, selectedAction, selectedArgument, true,
      engine.adapter.informationComplete ? V3_EVIDENCE.OBSERVATION_COMPLETE :
        V3_EVIDENCE.INFORMATION,
      engine.depthSearch.nodes + engine.informationSearch.nodes,
      V3_PROPOSAL_CLASS.EXACT_VALUE_DOMINANCE, eligible);
    return legacy;
  }

  summary() {
    return { callCount: this.callCount, completeCount: this.completeCount,
      incompleteCount: this.incompleteCount, overrideCount: this.overrideCount,
      exceptionCount: this.exceptionCount, physicalSearchCount: this.physicalSearchCount,
      informationSearchCount: this.informationSearchCount,
      stageMatrixCount: this.stageMatrixCount,
      supportExactCount: this.supportExactCount,
      exactDominanceCount: this.exactDominanceCount,
      ownershipMode: this.ownershipMode,
      minimumOwnershipDepth: this.minimumOwnershipDepth,
      refineDepthTwo: this.refineDepthTwo,
      refineMoveVariants: this.refineMoveVariants,
      refinementNodeBudget: this.refinementNodeBudget,
      refinementCheckCount: this.refinementCheckCount,
      refinementEligibleCount: this.refinementEligibleCount,
      refinementCompleteCount: this.refinementCompleteCount,
      refinementIncompleteCount: this.refinementIncompleteCount,
      refinementNodeCount: this.refinementNodeCount,
      refinementMaximumRows: this.refinementMaximumRows,
      refinementWidthAbortCount: this.refinementWidthAbortCount,
      refinementFastAbortCount: this.refinementFastAbortCount,
      refinementHardAbortCount: this.refinementHardAbortCount,
      refinementBudgetAbortCount: this.refinementBudgetAbortCount,
      refinementOtherAbortCount: this.refinementOtherAbortCount,
      refinementFastStatusCount: Array.from(this.refinementFastStatusCount),
      refinementUnsupportedReasonCount:
        Array.from(this.refinementUnsupportedReasonCount),
      refinementFailureActionPairCount:
        Array.from(this.refinementFailureActionPairCount),
      refinementJointRelocationDetailCount:
        Array.from(this.refinementJointRelocationDetailCount),
      variantRefinementAttemptCount: this.variantRefinementAttemptCount,
      variantRefinementCompleteCount: this.variantRefinementCompleteCount,
      variantRefinementIncompleteCount: this.variantRefinementIncompleteCount,
      variantRefinementNodeCount: this.variantRefinementNodeCount,
      variantRefinementSelectionCount: this.variantRefinementSelectionCount,
      physicalCellCheckCount: this.physicalCellCheckCount,
      physicalCellSupportCount: this.physicalCellSupportCount,
      physicalCellLegacyMissingCount: this.physicalCellLegacyMissingCount,
      physicalCellDominanceCount: this.physicalCellDominanceCount,
      physicalCellNoDominanceCount: this.physicalCellNoDominanceCount,
      physicalWorstTieBlockedCount: this.physicalWorstTieBlockedCount,
      physicalDepthBlockedCount: this.physicalDepthBlockedCount,
      firstPhysicalCellFrame: this.firstPhysicalCellFrame,
      firstPhysicalCellLegacyAction: this.firstPhysicalCellLegacyAction,
      firstPhysicalCellCandidateAction: this.firstPhysicalCellCandidateAction,
      firstPhysicalCellDepth: this.firstPhysicalCellDepth,
      firstPhysicalCellLegacyValue: this.firstPhysicalCellLegacyValue,
      firstPhysicalCellCandidateValue: this.firstPhysicalCellCandidateValue,
      firstPhysicalCellMinimumMargin: this.firstPhysicalCellMinimumMargin,
      firstPhysicalCellPlanKind: this.firstPhysicalCellPlanKind,
      firstPhysicalCellPlanPurpose: this.firstPhysicalCellPlanPurpose,
      firstPhysicalCellPlanDeadline: this.firstPhysicalCellPlanDeadline,
      firstPhysicalCellPlanRawScore: this.firstPhysicalCellPlanRawScore,
      sameActionCount: this.sameActionCount,
      depthRootRestoreFailures: this.bridge.engine.depthSearch.rootRestoreFailures,
      informationRootRestoreFailures: this.bridge.engine.informationSearch.rootRestoreFailures,
      proofRootRestoreFailures: this.bridge.engine.forcedWinSearch.rootRestoreFailures,
      optionPolicyCertificate: this.optionPolicyCertificate ?
        this.optionPolicyCertificate.summary() : null,
      leafEvaluator: this.leafEvaluator ? this.leafEvaluator.summary() : null,
      rootPolicyPrior: this.rootPolicyPrior ? {
        semantics: this.rootPolicyPrior === 1 ?
          "V1_ACTION_INITIAL_ROOT_ORDER_THEN_SEARCH_PV" :
          "V1_ACTION_PERSISTENT_ROOT_ORDER_ONLY",
        prepareCount: this.bridge.engine.depthSearch.diagnosticRootPriorPrepareCount,
        promoteCount: this.bridge.engine.depthSearch.diagnosticRootPriorPromoteCount,
        missingCount: this.bridge.engine.depthSearch.diagnosticRootPriorMissingCount,
        ambiguousCount: this.bridge.engine.depthSearch.diagnosticRootPriorAmbiguousCount
      } : null };
  }
}

module.exports = { OWNERSHIP_MODE, V2TacticalCoreAdapter };
