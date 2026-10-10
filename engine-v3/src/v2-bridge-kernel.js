"use strict";

const { ProductionRootEngine, ROOT_STATUS } =
  require("../../engine-v2/src/runtime/production-root");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ACTION, SKILL, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { actionFromLegacy } = require("./contracts");
const { ProposalBus } = require("./proposal-bus");
const { SUPPORT_STATUS } = require("../../engine-v2/src/runtime/escape-obligation");
const { OPPONENT_EVENT } = require("../../engine-v2/src/abi/policy-codes");
const { PLAN_STATUS, NONE_HANDLE } = require("../../engine-v2/src/abi/policy-codes");
const { RISK_BOUNDS_STATUS } =
  require("../../engine-v2/src/search/multi-frame-risk-bounds");

const SOFT_SAFETY_SUPPORT = Object.freeze({ NOT_APPLICABLE: 0, COMPLETE: 1, INCOMPLETE: 2 });

// The bridge is the sole V1-boundary owner of V2 state for one controller.
// Components borrow these arrays; they never adapt me/enemy/game themselves.
class V2BridgeKernel {
  constructor(options = {}) {
    this.engine = options.engine || new ProductionRootEngine(options.engineOptions || {});
    this.proposals = new ProposalBus();
    this.disableOpponentModel = options.disableOpponentModel ? 1 : 0;
    this.combatPurposeMask = Number.isSafeInteger(options.combatPurposeMask) ?
      options.combatPurposeMask & 0x7f : 0x7f;
    this.combatPrimaryPurpose = Number.isSafeInteger(options.combatPrimaryPurpose) ?
      options.combatPrimaryPurpose & 0xff : 0;
    this.combatRequireFrontier = options.combatRequireFrontier ? 1 : 0;
    // The bridge is the only root candidate builder in V3. Reuse the native
    // engine slabs instead of maintaining a second copy of the same rows.
    this.actions = this.engine.ourActions;
    this.arguments = this.engine.ourArguments;
    this.enemyActions = this.engine.enemyActions;
    this.enemyArguments = this.engine.enemyArguments;
    this.projectedCell = this.engine.projectedCell;
    this.projectedDirection = this.engine.projectedDirection;
    this.actionCount = 0;
    this.enemyActionCount = 0;
    this.bundle = null;
    this.status = ROOT_STATUS.INVALID;
    this.supportComplete = false;
    this.frame = -1;
    this.prepared = false;
    this.hiddenPrepared = false;
    this.prepareCount = 0;
    this.sameFrameReuseCount = 0;
    this.incompleteCount = 0;
    this.emissionCount = 0;
    this.pendingResolvedAction = ACTION.NONE;
    this.pendingResolvedArgument = NONE_CELL;
    this.pendingResolvedValid = false;
    this.pendingTacticalIndex = -1;
    this.pendingTacticalPlan = false;
    this.tacticalHandoffHandle = NONE_HANDLE;
    this.tacticalHandoffCommitCount = 0;
    this.tacticalHandoffCompletionCount = 0;
    this.tacticalRecoveryDeadline = -1;
    this.tacticalRecoveryKind = 0;
    this.tacticalRecoveryPurpose = 0;
    this.tacticalRecoveryTargetSignature = 0;
    this.tacticalRecoveryInitialScore = 0;
    this.tacticalRecoveryStartCount = 0;
    this.tacticalRecoveryCompletionCount = 0;
    this.matchReset = false;
    this.physicalEvidenceFrame = -1;
    this.physicalEvidenceSupport = SUPPORT_STATUS.INCOMPLETE;
    this.physicalSelectionCount = 0;
    this.physicalEvidenceBuildCount = 0;
    this.physicalEvidenceReuseCount = 0;
    this.combatEvidenceFrame = -1;
    this.combatEvidenceBuildCount = 0;
    this.combatEvidenceReuseCount = 0;
    this.softSafetyEvidenceFrame = -1;
    this.softSafetyEvidenceStatus = SOFT_SAFETY_SUPPORT.NOT_APPLICABLE;
    this.softSafetyEvidenceBuildCount = 0;
    this.softSafetyEvidenceReuseCount = 0;
    this.optionPolicyCandidate = null;
    this.nativeBasePolicyTacticalObserver = null;
  }

  resetMatchState() {
    this.engine.resetActionHistory();
    this.engine.opponentObservationReady = 0;
    this.engine.policy.beginMatch(this.engine.runtime.matchRuntimeGeneration + 1);
    this.engine.escapeObligation.resetMatch();
    this.engine.cacheBank.beginMatch();
    this.pendingResolvedAction = ACTION.NONE;
    this.pendingResolvedArgument = NONE_CELL;
    this.pendingResolvedValid = false;
    this.pendingTacticalIndex = -1;
    this.pendingTacticalPlan = false;
    this.tacticalHandoffHandle = NONE_HANDLE;
    this.tacticalRecoveryDeadline = -1;
    this.tacticalRecoveryKind = 0;
    this.tacticalRecoveryPurpose = 0;
    this.tacticalRecoveryTargetSignature = 0;
    this.tacticalRecoveryInitialScore = 0;
    this.physicalEvidenceFrame = -1;
    this.combatEvidenceFrame = -1;
    this.softSafetyEvidenceFrame = -1;
  }

  prepare(me, enemy, game) {
    const frame = game && Number.isSafeInteger(game.frames) ? game.frames : 0;
    if (this.prepared && frame === this.frame) {
      this.sameFrameReuseCount += 1;
      return this;
    }
    const adapted = this.engine.adapter.adapt(me, enemy, game);
    this.bundle = adapted.bundle;
    this.status = adapted.status;
    this.supportComplete = adapted.status === ROOT_STATUS.OK;
    this.matchReset = !!adapted.matchReset;
    this.frame = adapted.frame;
    this.prepared = true;
    this.hiddenPrepared = false;
    this.prepareCount += 1;
    this.proposals.beginFrame(this.frame);
    if (!adapted.bundle) {
      this.actionCount = 0;
      this.incompleteCount += 1;
      return this;
    }
    if (adapted.matchReset) this.resetMatchState();
    else this.engine.updateActionHistory();
    if (this.disableOpponentModel) {
      this.engine.possibleProjectiles.reset(adapted.frame);
      this.engine.snapshotOpponentObservation();
    } else this.engine.updateOpponentModel(adapted.matchReset);
    this.buildCandidates();
    if (!this.supportComplete) this.incompleteCount += 1;
    return this;
  }

  push(action, argument = NONE_CELL) {
    if (this.actionCount >= this.actions.length) {
      this.supportComplete = false;
      this.status = ROOT_STATUS.CAPACITY;
      return false;
    }
    const index = this.actionCount++;
    this.actions[index] = action;
    this.arguments[index] = argument;
    const packed = this.engine.projected(action);
    this.projectedCell[index] = (packed / 4) | 0;
    this.projectedDirection[index] = packed & 3;
    return true;
  }

  buildCandidates() {
    const adapter = this.engine.adapter;
    this.actionCount = 0;
    this.arguments.fill(NONE_CELL);
    if (!adapter.ownCanAct) {
      this.push(ACTION.NONE);
      this.buildEnemyCandidates();
      return;
    }
    this.push(ACTION.GO);
    this.push(ACTION.TURN_LEFT);
    this.push(ACTION.TURN_RIGHT);
    if (adapter.ownCanFire) this.push(ACTION.FIRE);
    if (adapter.ownBombReady) this.push(ACTION.THROW_BOMB);
    const ownSkill = adapter.state.arrays[ARRAY.TANK_SKILL][0];
    if (adapter.ownSkillReady && ownSkill >= SKILL.SHIELD && ownSkill <= SKILL.BOOST)
      this.push(ACTION.CAST_SHIELD + ownSkill - SKILL.SHIELD);
    this.push(ACTION.NONE);
    this.buildEnemyCandidates();
  }

  preparePhysicalEvidence() {
    if (this.physicalEvidenceFrame === this.frame) {
      this.physicalEvidenceReuseCount += 1;
      return this.physicalEvidenceSupport;
    }
    this.physicalEvidenceFrame = this.frame;
    this.physicalEvidenceSupport = SUPPORT_STATUS.INCOMPLETE;
    this.physicalSelectionCount = 0;
    if (!this.prepared || !this.bundle || this.actionCount < 1) return this.physicalEvidenceSupport;
    const engine = this.engine; const count = this.actionCount;
    if (engine.finalGate.evaluate(this.bundle, this.actions, this.arguments, count) !== count)
      return this.physicalEvidenceSupport;
    for (let row = 0; row < count; row += 1)
      engine.hardStatus[row] = engine.finalGate.status[row];
    this.physicalSelectionCount = count > 1 && this.actions[count - 1] === ACTION.NONE ?
      count - 1 : count;
    this.physicalEvidenceSupport = engine.escapeObligation.evaluateCommitted(this.bundle,
      this.actions, this.arguments, this.projectedCell, this.projectedDirection,
      engine.hardStatus, this.physicalSelectionCount);
    this.physicalEvidenceBuildCount += 1;
    return this.physicalEvidenceSupport;
  }

  prepareCombatEvidence() {
    if (this.combatEvidenceFrame === this.frame) {
      this.combatEvidenceReuseCount += 1;
      return true;
    }
    if (!this.prepared || !this.bundle || !this.engine.adapter.enemyVisible) return false;
    this.preparePhysicalEvidence();
    const engine = this.engine; const count = this.actionCount;
    const vector = engine.combat.evaluate(this.bundle, this.actions, count,
      this.projectedCell, this.projectedDirection, 1, null,
      engine.tactical, engine.adapter.enemyCanAct);
    engine.projectileAttack.evaluate(this.bundle, this.actions, this.arguments,
      count, this.enemyActions, this.enemyArguments, this.enemyActionCount, vector);
    this.combatEvidenceFrame = this.frame;
    this.combatEvidenceBuildCount += 1;
    return true;
  }

  // Build only the bounded future-FIRE / possible-projectile safety prefix.
  // It is diagnostic Information evidence: it never writes Hard or EO and it
  // deliberately does not run Minimax, StageMatrix, Strategy, or observation
  // proof.  All arrays are owned by ProductionRootEngine and reused in place.
  prepareSoftSafetyEvidence() {
    if (this.softSafetyEvidenceFrame === this.frame) {
      this.softSafetyEvidenceReuseCount += 1;
      return this.softSafetyEvidenceStatus;
    }
    this.softSafetyEvidenceFrame = this.frame;
    this.softSafetyEvidenceStatus = SOFT_SAFETY_SUPPORT.INCOMPLETE;
    if (!this.prepared || !this.bundle || this.actionCount < 1)
      return this.softSafetyEvidenceStatus;
    const engine = this.engine;
    this.preparePhysicalEvidence();
    if (this.physicalSelectionCount < 1) return this.softSafetyEvidenceStatus;
    if (!engine.adapter.enemyVisible || !engine.adapter.enemyCanFire) {
      this.softSafetyEvidenceStatus = SOFT_SAFETY_SUPPORT.NOT_APPLICABLE;
      this.softSafetyEvidenceBuildCount += 1;
      return this.softSafetyEvidenceStatus;
    }
    // A real enemy projectile belongs to committed rescue.  This prefix only
    // measures a shot that has not happened yet or an explicitly possible
    // hidden track.
    if (engine.adapter.tracker.hasActiveProjectile(1)) {
      this.softSafetyEvidenceStatus = SOFT_SAFETY_SUPPORT.NOT_APPLICABLE;
      this.softSafetyEvidenceBuildCount += 1;
      return this.softSafetyEvidenceStatus;
    }
    this.ensureHiddenRisk();
    engine.threatCapability.prepare(this.bundle, 1, engine.adapter.enemyCanAct,
      engine.adapter.enemyCanFire, engine.adapter.enemyCapabilitySupportComplete);
    const count = this.physicalSelectionCount;
    const fireProbability = engine.policy.opponent.propensity(OPPONENT_EVENT.FIRE,
      engine.opponentContext());
    const safetyBudget = SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE;
    engine.safetyClosure.evaluate(this.bundle, this.actions, count, engine.hardStatus,
      this.projectedCell, this.projectedDirection, engine.hiddenWorldCell,
      engine.hiddenWorldMass, engine.hiddenWorldCount, engine.hiddenSupportComplete,
      engine.possibleProjectiles, engine.adapter.enemyCanFire,
      engine.adapter.lastEnemyDirection, safetyBudget, 1, fireProbability,
      engine.finalGate.chanceSupportCount, engine.finalGate.chanceFatalSupportCount,
      engine.finalGate.chanceIncompleteSupportCount, engine.threatCapability,
      engine.finalGate.chanceCell, engine.finalGate.chanceDirection, 0);
    const multiStatus = engine.multiFrameRisk.evaluate(this.bundle, count,
      engine.hardStatus, engine.finalGate.chanceSupportCount,
      engine.finalGate.chanceIncompleteSupportCount, engine.finalGate.chanceCell,
      engine.finalGate.chanceDirection, engine.hiddenWorldCell, engine.hiddenWorldMass,
      engine.hiddenWorldCount, engine.hiddenSupportComplete, engine.threatCapability,
      engine.adapter.lastEnemyDirection, fireProbability, 4096,
      engine.safetyClosure.outcome, engine.possibleProjectiles,
      engine.hiddenWorldDirectionMask, engine.hiddenRiskSupportComplete,
      engine.hiddenProjectileRisk);
    const multiComplete = multiStatus === RISK_BOUNDS_STATUS.APPLIED ||
      multiStatus === RISK_BOUNDS_STATUS.NOT_APPLICABLE;
    this.softSafetyEvidenceStatus = engine.safetyClosure.supportComplete &&
      !engine.safetyClosure.interrupted && engine.hiddenRiskSupportComplete &&
      multiComplete ? SOFT_SAFETY_SUPPORT.COMPLETE : SOFT_SAFETY_SUPPORT.INCOMPLETE;
    this.softSafetyEvidenceBuildCount += 1;
    return this.softSafetyEvidenceStatus;
  }

  pushEnemy(action, argument = NONE_CELL) {
    if (this.enemyActionCount >= this.enemyActions.length) {
      this.supportComplete = false;
      this.status = ROOT_STATUS.CAPACITY;
      return false;
    }
    const index = this.enemyActionCount++;
    this.enemyActions[index] = action;
    this.enemyArguments[index] = argument;
    return true;
  }

  buildEnemyCandidates() {
    const adapter = this.engine.adapter;
    this.enemyActionCount = 0;
    this.enemyArguments.fill(NONE_CELL);
    this.pushEnemy(ACTION.NONE);
    if (!adapter.enemyCanAct) return;
    this.pushEnemy(ACTION.GO);
    this.pushEnemy(ACTION.TURN_LEFT);
    this.pushEnemy(ACTION.TURN_RIGHT);
    if (adapter.enemyCanFire) this.pushEnemy(ACTION.FIRE);
    if (adapter.enemyBombReady) this.pushEnemy(ACTION.THROW_BOMB);
    const enemySkill = adapter.state.arrays[ARRAY.TANK_SKILL][1];
    if (adapter.enemySkillReady && enemySkill >= SKILL.SHIELD && enemySkill <= SKILL.BOOST)
      this.pushEnemy(ACTION.CAST_SHIELD + enemySkill - SKILL.SHIELD);
  }

  ensureHiddenRisk() {
    if (!this.prepared || !this.bundle || this.hiddenPrepared) return this.hiddenPrepared;
    this.engine.prepareHiddenRisk();
    this.hiddenPrepared = true;
    return true;
  }

  recordResolvedLegacy(token, argument = NONE_CELL) {
    this.pendingResolvedAction = actionFromLegacy(token);
    this.pendingResolvedArgument = argument;
    this.pendingResolvedValid = true;
  }

  recordEmissionFromPending(fallbackToken) {
    const action = this.pendingResolvedValid ? this.pendingResolvedAction :
      actionFromLegacy(fallbackToken);
    const argument = this.pendingResolvedValid ? this.pendingResolvedArgument : NONE_CELL;
    if (action !== ACTION.NONE) {
      this.engine.adapter.recordEmission(action, argument);
      this.engine.lastAction = action;
      this.engine.lastArgument = argument;
      this.emissionCount += 1;
    }
    if (this.nativeBasePolicyTacticalObserver)
      this.nativeBasePolicyTacticalObserver.observeEmission(action);
    let committedHandle = NONE_HANDLE;
    if (this.pendingTacticalIndex >= 0 &&
        this.pendingTacticalIndex < this.engine.ourCount &&
        this.engine.ourActions[this.pendingTacticalIndex] === action)
      committedHandle = this.engine.commitSelectedPlan(this.pendingTacticalIndex);
    if (this.pendingTacticalPlan && committedHandle !== NONE_HANDLE) {
      this.tacticalHandoffHandle = committedHandle;
      this.tacticalHandoffCommitCount += 1;
      const state = this.engine.adapter.state.arrays;
      if (state[ARRAY.TANK_STARS][0] <= state[ARRAY.TANK_STARS][1]) {
        const plans = this.engine.policy.plans;
        const slot = plans.decode(committedHandle);
        if (slot >= 0 && plans.status[slot] === PLAN_STATUS.ACTIVE &&
            plans.deadline[slot] !== 0xffff) {
          this.tacticalRecoveryDeadline = Math.min(127, plans.deadline[slot]);
          this.tacticalRecoveryKind = plans.kind[slot];
          this.tacticalRecoveryPurpose = plans.purpose[slot];
          this.tacticalRecoveryTargetSignature = plans.targetSignature[slot];
          this.tacticalRecoveryInitialScore = plans.cachedScore[slot];
          this.tacticalRecoveryStartCount += 1;
        }
      }
    }
    this.pendingTacticalIndex = -1;
    this.pendingTacticalPlan = false;
    this.pendingResolvedValid = false;
    this.prepared = false;
    return action;
  }

  hasActiveTacticalHandoff() {
    if (this.tacticalHandoffHandle === NONE_HANDLE) return false;
    const plans = this.engine.policy.plans;
    const slot = plans.decode(this.tacticalHandoffHandle);
    if (slot >= 0 && plans.status[slot] === PLAN_STATUS.ACTIVE) return true;
    this.tacticalHandoffHandle = NONE_HANDLE;
    this.tacticalHandoffCompletionCount += 1;
    return false;
  }

  hasTacticalRecoveryWindow() {
    if (this.tacticalRecoveryDeadline < 0) return false;
    const state = this.engine.adapter.state.arrays;
    const frame = state[ARRAY.SCALAR][SCALAR.FRAME];
    const plans = this.engine.policy.plans;
    const slot = plans.decode(this.tacticalHandoffHandle);
    if (slot >= 0 && plans.status[slot] === PLAN_STATUS.ACTIVE &&
        frame <= this.tacticalRecoveryDeadline &&
        state[ARRAY.TANK_STARS][0] <= state[ARRAY.TANK_STARS][1]) return true;
    this.tacticalRecoveryDeadline = -1;
    this.tacticalRecoveryKind = 0;
    this.tacticalRecoveryPurpose = 0;
    this.tacticalRecoveryTargetSignature = 0;
    this.tacticalRecoveryInitialScore = 0;
    this.tacticalRecoveryCompletionCount += 1;
    return false;
  }

  matchesTacticalRecoveryPlan(row) {
    if (!this.hasTacticalRecoveryWindow() || row < 0 || row >= this.engine.ourCount)
      return false;
    const sketches = this.engine.policy.sketches;
    const handle = this.engine.planSketchHandle[row];
    if (handle === NONE_HANDLE || handle >= sketches.used) return false;
    return sketches.kind[handle] === this.tacticalRecoveryKind &&
      sketches.purpose[handle] === this.tacticalRecoveryPurpose &&
      sketches.targetSignature[handle] === this.tacticalRecoveryTargetSignature &&
      sketches.deadline[handle] >= this.frame && sketches.rawScore[handle] > 0;
  }

  summary() {
    const tracker = this.engine.adapter.tracker;
    return {
      prepareCount: this.prepareCount,
      sameFrameReuseCount: this.sameFrameReuseCount,
      incompleteCount: this.incompleteCount,
      emissionCount: this.emissionCount,
      projectileHighWater: tracker.projectiles.highWater,
      projectileCapacityFailureCount: tracker.projectiles.capacityFailureCount,
      projectileAmbiguousAssociationCount: tracker.projectiles.ambiguousAssociationCount,
      bombHighWater: tracker.bombHighWater,
      adapterHotAllocationCount: this.engine.adapter.hotAllocationCount,
      engineHotAllocationCount: this.engine.hotAllocationCount,
      proposalBusBytes: this.proposals.bytes(),
      proposalBusAllocatedBytes: this.proposals.allocatedBytes(),
      proposalBusHotAllocationCount: this.proposals.hotAllocationCount,
      physicalEvidenceBuildCount: this.physicalEvidenceBuildCount,
      physicalEvidenceReuseCount: this.physicalEvidenceReuseCount,
      combatEvidenceBuildCount: this.combatEvidenceBuildCount,
      combatEvidenceReuseCount: this.combatEvidenceReuseCount,
      softSafetyEvidenceBuildCount: this.softSafetyEvidenceBuildCount,
      softSafetyEvidenceReuseCount: this.softSafetyEvidenceReuseCount,
      proposedNoneViolationCount: this.proposals.proposedNoneViolationCount,
      selectedNoneViolationCount: this.proposals.selectedNoneViolationCount,
      selectedOwnershipViolationCount: this.proposals.selectedOwnershipViolationCount,
      planCommitCount: this.engine.planCommitCount,
      planActivateCount: this.engine.planActivateCount,
      planCompleteCount: this.engine.planCompleteCount,
      planInvalidateCount: this.engine.planInvalidateCount,
      tacticalHandoffCommitCount: this.tacticalHandoffCommitCount,
      tacticalHandoffCompletionCount: this.tacticalHandoffCompletionCount,
      tacticalRecoveryStartCount: this.tacticalRecoveryStartCount,
      tacticalRecoveryCompletionCount: this.tacticalRecoveryCompletionCount,
      tacticalRecoveryDeadline: this.tacticalRecoveryDeadline,
      tacticalRecoveryKind: this.tacticalRecoveryKind,
      tacticalRecoveryPurpose: this.tacticalRecoveryPurpose,
      tacticalRecoveryTargetSignature: this.tacticalRecoveryTargetSignature,
      tacticalRecoveryInitialScore: this.tacticalRecoveryInitialScore
    };
  }
}

module.exports = { V2BridgeKernel, SOFT_SAFETY_SUPPORT };
