"use strict";

// Diagnostic-only event certificate for Poison.  It does not compare a
// heuristic value at a fixed horizon.  Candidate ownership requires an exact
// visible Physical AND/OR policy that reaches an irreversible attack event
// (enemy crash), observes at least one relative Poison HOLD, and
// a paired baseline policy that is completely DISPROVEN at the same horizon.

const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, SKILL, HARD_STATUS, NONE_CELL, NONE_FRAME } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { FastKernel } = require("../../../engine-v2/src/fast/kernel");
const { HazardKernel } = require("../../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../../engine-v2/src/fast/hard-gate");
const { ATTACK_POLICY_GOAL, AttackPolicyContinuationTable,
  AttackPolicyReachabilitySearch } = require(
  "./attack-policy-reachability-shadow");
const { AttackEventPolicySearch, AttackEventPolicySnapshot } = require(
  "../../../engine-v2/src/search/attack-event-policy-search");

class NativePoisonAttackEventOptionPoc {
  constructor(mode = "off", options = {}) {
    this.mode = mode === "active" ? "active" : mode === "shadow" ?
      "shadow" : "off";
    this.maximumDepth = Math.max(2, Math.min(4,
      Number.isSafeInteger(options.maximumDepth) ? options.maximumDepth : 4));
    this.nodeBudget = Math.max(64, Math.min(4096,
      Number.isSafeInteger(options.nodeBudget) ? options.nodeBudget : 2048));
    this.triggerMode = options.triggerMode === "axis" ? "axis" : "all";
    this.requireSimulatorCadenceAgreement =
      options.requireSimulatorCadenceAgreement === true;
    this.sharedSearch = options.sharedSearch === true;
    this.snapshotSearch = options.snapshotSearch === true;
    this.leanSearch = options.leanSearch === true;
    if (this.sharedSearch && this.snapshotSearch)
      throw new Error("POISON_ATTACK_EVENT_SEARCH_MODE_CONFLICT");
    this.candidateSearch = options.candidateSearch || (this.leanSearch ?
      new AttackEventPolicySearch(this.nodeBudget) :
      new AttackPolicyReachabilitySearch(this.nodeBudget, {
        allowDebuffGoal: false,
        allowedGoalMask: ATTACK_POLICY_GOAL.ENEMY_CRASH,
        completeRootEnemyDomain: true
      }));
    this.baselineSearch = options.baselineSearch ||
      (this.sharedSearch || this.snapshotSearch ? this.candidateSearch :
      this.leanSearch ? new AttackEventPolicySearch(this.nodeBudget) :
      new AttackPolicyReachabilitySearch(this.nodeBudget, {
        allowDebuffGoal: false,
        allowedGoalMask: ATTACK_POLICY_GOAL.ENEMY_CRASH,
        completeRootEnemyDomain: true
      }));
    this.continuationTable = this.snapshotSearch ? (this.leanSearch ?
      new AttackEventPolicySnapshot(64) :
      new AttackPolicyContinuationTable(64)) : null;
    this.policySnapshotIncompleteCount = 0;
    this.checkCount = 0; this.prefilterRootCount = 0; this.eligibleCount = 0;
    this.triggerBlockedCount = 0;
    this.cadenceCompatibilityBlockedCount = 0;
    this.strictOwnerBlockedCount = 0; this.committedBlockedCount = 0;
    this.skillBlockedCount = 0; this.visibilityBlockedCount = 0;
    this.supportBlockedCount = 0; this.effectBlockedCount = 0;
    this.distanceBlockedCount = 0; this.candidateProvenCount = 0;
    this.candidateDisprovenCount = 0; this.candidateUnknownCount = 0;
    this.noHoldEvidenceCount = 0; this.baselineDisprovenCount = 0;
    this.baselineProvenCount = 0; this.baselineUnknownCount = 0;
    this.certificateCount = 0; this.wouldOverrideCount = 0;
    this.overrideCount = 0; this.candidateNodes = 0; this.baselineNodes = 0;
    this.maximumCandidateNodes = 0; this.maximumBaselineNodes = 0;
    this.candidateProvenPolicyEntries = 0;
    this.maximumCandidateProvenPolicyEntries = 0;
    this.searchTransitionCount = 0; this.searchHardClassifyCount = 0;
    this.searchReverseBuildCount = 0;
    this.rootRestoreFailureCount = 0; this.lastCandidateStatus = 0;
    this.lastBaselineStatus = 0; this.lastGoalMask = 0;
    this.lastHoldTransitions = 0; this.lastCandidateCompletedDepth = 0;
    this.hotAllocationCount = 0;
    this.isolatedState = null; this.isolatedBundle = null;
    this.isolationAllocationCount = 0;
    this.featureDistance = 0; this.featureProjectileBucket = 0;
    this.featureAxis = 0; this.featureIncumbentAction = 0;
    this.eligibleByDistance = new Uint32Array(10);
    this.provenByDistance = new Uint32Array(10);
    this.certificateByDistance = new Uint32Array(10);
    this.candidateNodesByDistance = new Uint32Array(10);
    this.eligibleByProjectileBucket = new Uint32Array(3);
    this.provenByProjectileBucket = new Uint32Array(3);
    this.certificateByProjectileBucket = new Uint32Array(3);
    this.candidateNodesByProjectileBucket = new Uint32Array(3);
    this.eligibleByAxis = new Uint32Array(2);
    this.provenByAxis = new Uint32Array(2);
    this.certificateByAxis = new Uint32Array(2);
    this.candidateNodesByAxis = new Uint32Array(2);
    this.eligibleByIncumbentAction = new Uint32Array(256);
    this.provenByIncumbentAction = new Uint32Array(256);
    this.certificateByIncumbentAction = new Uint32Array(256);
    this.certificateByCompletedDepth = new Uint32Array(5);
    this.continuationActive = 0; this.continuationRemaining = 0;
    this.continuationArmCount = 0; this.continuationCheckCount = 0;
    this.continuationSelectCount = 0; this.continuationSameCount = 0;
    this.continuationMissCount = 0; this.continuationSupportAbortCount = 0;
    this.continuationHardAbortCount = 0; this.continuationOwnerAbortCount = 0;
    this.continuationCompleteCount = 0;
    this.continuationExactHitCount = 0; this.continuationSemanticHitCount = 0;
    this.continuationMismatchMaskCount = new Uint32Array(32);
    this.continuationStatusFieldMismatchCount = new Uint32Array(15);
    this.continuationCandidateEntryCount = 0;
    this.lastExpectedStunUntil0 = 0; this.lastExpectedStunUntil1 = 0;
    this.lastActualStunUntil0 = 0; this.lastActualStunUntil1 = 0;
    this.lastExpectedBombReady0 = 0; this.lastExpectedBombReady1 = 0;
    this.lastActualBombReady0 = 0; this.lastActualBombReady1 = 0;
    this.lastCertificateFrame = NONE_FRAME;
    this.lastContinuationCheckFrame = NONE_FRAME;
  }

  distance(state, left, right) {
    return Math.abs(state.x(left) - state.x(right)) +
      Math.abs(state.y(left) - state.y(right));
  }

  captureFeatures(state, incumbentAction) {
    const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    this.featureDistance = this.distance(state, own, enemy);
    this.featureAxis = state.x(own) === state.x(enemy) ||
      state.y(own) === state.y(enemy) ? 1 : 0;
    let projectiles = 0;
    const active = a[ARRAY.PROJECTILE_ACTIVE];
    const owner = a[ARRAY.PROJECTILE_OWNER];
    for (let slot = 0; slot < active.length; slot += 1)
      if (active[slot] && owner[slot] === 0) projectiles += 1;
    this.featureProjectileBucket = projectiles > 1 ? 2 : projectiles;
    this.featureIncumbentAction = incumbentAction & 255;
    this.eligibleByDistance[this.featureDistance] += 1;
    this.eligibleByProjectileBucket[this.featureProjectileBucket] += 1;
    this.eligibleByAxis[this.featureAxis] += 1;
    this.eligibleByIncumbentAction[this.featureIncumbentAction] += 1;
    this.prefilterRootCount += 1;
  }

  eligible(engine, incumbentAction) {
    const adapter = engine?.adapter; const state = adapter?.state;
    if (!state || !adapter.ownCanAct || !adapter.ownSkillReady ||
        state.arrays[ARRAY.TANK_SKILL][0] !== SKILL.POISON) {
      this.skillBlockedCount += 1; return 0;
    }
    if (!adapter.enemyVisible) {
      this.visibilityBlockedCount += 1; return 0;
    }
    if (!adapter.tracker?.complete || engine.hiddenSupportComplete !== 1 ||
        engine.hiddenWorldCount !== 1 || engine.hiddenWorldMass[0] !== 10000 ||
        engine.possibleProjectiles?.count() > 0 || engine.enemyCount < 1) {
      this.supportBlockedCount += 1; return 0;
    }
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    // The pinned external simulator uses absolute even-frame Poison cadence,
    // while platform replay proves relative ACT-HOLD cadence.  A cast on an
    // even frame is the exact intersection of both models for the full effect
    // window.  Odd-frame casts remain valid platform actions, but this local
    // simulator cannot provide outcome evidence for them.
    if (this.requireSimulatorCadenceAgreement && (frame & 1)) {
      this.cadenceCompatibilityBlockedCount += 1; return 0;
    }
    const poisoned = a[ARRAY.TANK_POISON_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_POISON_UNTIL][1] > frame;
    const frozen = a[ARRAY.TANK_FROZEN_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_FROZEN_UNTIL][1] > frame;
    const stunned = a[ARRAY.TANK_STUN_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_STUN_UNTIL][1] > frame;
    if (poisoned || frozen || stunned) {
      this.effectBlockedCount += 1; return 0;
    }
    if (this.distance(state, a[ARRAY.TANK_CELL][0], a[ARRAY.TANK_CELL][1]) > 9) {
      this.distanceBlockedCount += 1; return 0;
    }
    this.captureFeatures(state, incumbentAction);
    if (this.triggerMode === "axis" && !this.featureAxis) {
      this.triggerBlockedCount += 1; return 0;
    }
    return 1;
  }

  observeSearch(search, candidate) {
    if (candidate) {
      this.candidateNodes += search.nodes;
      if (search.nodes > this.maximumCandidateNodes)
        this.maximumCandidateNodes = search.nodes;
    } else {
      this.baselineNodes += search.nodes;
      if (search.nodes > this.maximumBaselineNodes)
        this.maximumBaselineNodes = search.nodes;
    }
    this.rootRestoreFailureCount += search.rootRestoreFailures;
  }

  evaluateSearch(search, bundle, action, argument, engine, candidate) {
    const applied = bundle.kernel.appliedActionCount;
    const classified = bundle.hard.classifyCount;
    const built = bundle.hard.reverseBuildCount;
    const result = search.evaluateCandidate(bundle, action, argument,
      engine.enemyActions, engine.enemyArguments, engine.enemyCount,
      this.maximumDepth, this.nodeBudget);
    this.observeSearch(search, candidate);
    this.searchTransitionCount += bundle.kernel.appliedActionCount - applied;
    this.searchHardClassifyCount += bundle.hard.classifyCount - classified;
    this.searchReverseBuildCount += bundle.hard.reverseBuildCount - built;
    return result;
  }

  exactSupport(engine) {
    const adapter = engine?.adapter;
    return adapter?.enemyVisible && adapter.tracker?.complete &&
      engine.hiddenSupportComplete === 1 && engine.hiddenWorldCount === 1 &&
      engine.hiddenWorldMass[0] === 10000 &&
      engine.possibleProjectiles?.count() === 0;
  }

  rootAllows(engine, action, argument) {
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === action && engine.ourArguments[row] === argument &&
          engine.hardStatus[row] === HARD_STATUS.ALLOW) return 1;
    return 0;
  }

  abortContinuation(kind) {
    if (kind === 1) this.continuationSupportAbortCount += 1;
    else if (kind === 2) this.continuationHardAbortCount += 1;
    else if (kind === 3) this.continuationOwnerAbortCount += 1;
    else this.continuationMissCount += 1;
    this.continuationActive = 0; this.continuationRemaining = 0;
  }

  selectContinuation(engine, incumbentAction, incumbentArgument) {
    this.continuationCheckCount += 1;
    if (!this.exactSupport(engine)) {
      this.abortContinuation(1); return null;
    }
    const state = engine.adapter.state;
    this.lastContinuationCheckFrame =
      state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const found = this.snapshotSearch ?
      this.continuationTable.policyFor(state, this.continuationRemaining,
        this.candidateSearch) :
      this.candidateSearch.policyFor &&
        this.candidateSearch.policyFor(state, this.continuationRemaining);
    if (!found) {
      const mask = this.candidateSearch.policyMismatchMask | 0;
      if (mask >= 0 && mask < this.continuationMismatchMaskCount.length)
        this.continuationMismatchMaskCount[mask] += 1;
      this.continuationCandidateEntryCount +=
        this.candidateSearch.policyCandidateEntryCount || 0;
      const statusMask = this.candidateSearch.policyStatusMismatchMask | 0;
      for (let field = 0; field < this.continuationStatusFieldMismatchCount.length;
          field += 1)
        if (statusMask & (1 << field))
          this.continuationStatusFieldMismatchCount[field] += 1;
      this.lastExpectedStunUntil0 = this.candidateSearch.policyExpectedStunUntil0;
      this.lastExpectedStunUntil1 = this.candidateSearch.policyExpectedStunUntil1;
      this.lastActualStunUntil0 = this.candidateSearch.policyActualStunUntil0;
      this.lastActualStunUntil1 = this.candidateSearch.policyActualStunUntil1;
      this.lastExpectedBombReady0 = this.candidateSearch.policyExpectedBombReady0;
      this.lastExpectedBombReady1 = this.candidateSearch.policyExpectedBombReady1;
      this.lastActualBombReady0 = this.candidateSearch.policyActualBombReady0;
      this.lastActualBombReady1 = this.candidateSearch.policyActualBombReady1;
      this.abortContinuation(0); return null;
    }
    const action = this.snapshotSearch ? (this.leanSearch ?
      this.continuationTable.selectedAction :
      this.continuationTable.actionResult) :
      this.candidateSearch.policyAction;
    const argument = this.snapshotSearch ? (this.leanSearch ?
      this.continuationTable.selectedArgument :
      this.continuationTable.argumentResult) :
      this.candidateSearch.policyArgument;
    if (!this.snapshotSearch && this.candidateSearch.policyLookupKind === 1)
      this.continuationExactHitCount += 1;
    else if (this.snapshotSearch || this.candidateSearch.policyLookupKind === 2)
      this.continuationSemanticHitCount += 1;
    if (!this.rootAllows(engine, action, argument)) {
      this.abortContinuation(2); return null;
    }
    this.continuationSelectCount += 1;
    this.continuationRemaining -= 1;
    if (this.continuationRemaining < 1) {
      this.continuationActive = 0; this.continuationCompleteCount += 1;
    }
    if (action === incumbentAction && argument === incumbentArgument) {
      this.continuationSameCount += 1; return null;
    }
    this.overrideCount += 1;
    return { action, argument };
  }

  bindIsolated(source) {
    if (this.isolatedState === source.state && this.isolatedBundle)
      return this.isolatedBundle;
    const kernel = new FastKernel(source.state, {
      stationaryOccupiedBlock: Boolean(source.kernel.stationaryOccupiedBlockEnabled)
    });
    const sourceHazard = source.hazard;
    const hazard = new HazardKernel(source.state, {
      reverseViabilityCacheEntries: sourceHazard ?
        sourceHazard.reverseCacheEntries : 16,
      reverseLatticeCacheEntries: sourceHazard ?
        sourceHazard.reverseLatticeEntries : 0,
      reverseLatticeLayerCache: sourceHazard ?
        Boolean(sourceHazard.reverseLatticeLayerCacheEnabled) : false,
      hazardSignatureCache: sourceHazard ?
        Boolean(sourceHazard.hazardSignatureCacheEnabled) : true
    });
    const hard = new HardGate(kernel, hazard, 0);
    this.isolatedState = source.state;
    this.isolatedBundle = { state: source.state, kernel, hazard, hard };
    this.isolationAllocationCount += 1;
    return this.isolatedBundle;
  }

  restoreSearchState(state, transitionDeltaBase, transitionEventBase,
      highWaterDelta, highWaterEvent) {
    state.transitionDeltaBase = transitionDeltaBase;
    state.transitionEventBase = transitionEventBase;
    state.highWaterDelta = highWaterDelta;
    state.highWaterEvent = highWaterEvent;
  }

  selectOverride(engine, incumbentAction, incumbentArgument) {
    if (this.mode === "off") return null;
    this.checkCount += 1; this.lastCandidateStatus = 0;
    this.lastBaselineStatus = 0; this.lastGoalMask = 0;
    this.lastHoldTransitions = 0; this.lastCandidateCompletedDepth = 0;
    if (engine.lastProofStatus === PROOF_STATUS.PROVEN ||
        engine.lastSelectionWasStrictRescue ||
        engine.lastSelectionWasVerifiedDirectKill) {
      if (this.continuationActive) this.abortContinuation(3);
      this.strictOwnerBlockedCount += 1; return null;
    }
    if (engine.escapeObligation?.committedEntityCount > 0) {
      if (this.continuationActive) this.abortContinuation(3);
      this.committedBlockedCount += 1; return null;
    }
    if (this.continuationActive)
      return this.selectContinuation(engine, incumbentAction, incumbentArgument);
    if (!this.eligible(engine, incumbentAction)) return null;
    this.eligibleCount += 1;
    const sourceBundle = engine.adapter.bundle;
    const bundle = this.bindIsolated(sourceBundle);
    const state = bundle.state;
    const transitionDeltaBase = state.transitionDeltaBase;
    const transitionEventBase = state.transitionEventBase;
    const highWaterDelta = state.highWaterDelta;
    const highWaterEvent = state.highWaterEvent;
    if (this.sharedSearch) {
      const baselineFirst = this.evaluateSearch(this.baselineSearch, bundle,
        incumbentAction, incumbentArgument, engine, 0);
      this.restoreSearchState(state, transitionDeltaBase, transitionEventBase,
        highWaterDelta, highWaterEvent);
      this.lastBaselineStatus = baselineFirst;
      if (baselineFirst === PROOF_STATUS.DISPROVEN)
        this.baselineDisprovenCount += 1;
      else if (baselineFirst === PROOF_STATUS.PROVEN) {
        this.baselineProvenCount += 1; return null;
      } else { this.baselineUnknownCount += 1; return null; }
    }
    const candidate = this.evaluateSearch(this.candidateSearch, bundle,
      ACTION.CAST_POISON, NONE_CELL, engine, 1);
    this.candidateNodesByDistance[this.featureDistance] +=
      this.candidateSearch.nodes;
    this.candidateNodesByProjectileBucket[this.featureProjectileBucket] +=
      this.candidateSearch.nodes;
    this.candidateNodesByAxis[this.featureAxis] += this.candidateSearch.nodes;
    this.restoreSearchState(state, transitionDeltaBase, transitionEventBase,
      highWaterDelta, highWaterEvent);
    this.lastCandidateStatus = candidate;
    this.lastGoalMask = this.candidateSearch.goalMask;
    this.lastHoldTransitions = this.candidateSearch.poisonHoldTransitionCount;
    this.lastCandidateCompletedDepth = this.candidateSearch.completedDepth;
    if (candidate === PROOF_STATUS.PROVEN) {
      const entries = this.candidateSearch.provenPolicyEntryCount || 0;
      this.candidateProvenPolicyEntries += entries;
      if (entries > this.maximumCandidateProvenPolicyEntries)
        this.maximumCandidateProvenPolicyEntries = entries;
      this.candidateProvenCount += 1;
      this.provenByDistance[this.featureDistance] += 1;
      this.provenByProjectileBucket[this.featureProjectileBucket] += 1;
      this.provenByAxis[this.featureAxis] += 1;
      this.provenByIncumbentAction[this.featureIncumbentAction] += 1;
    }
    else if (candidate === PROOF_STATUS.DISPROVEN) {
      this.candidateDisprovenCount += 1; return null;
    } else { this.candidateUnknownCount += 1; return null; }
    if (!(this.lastGoalMask & ATTACK_POLICY_GOAL.ENEMY_CRASH) ||
        !this.lastHoldTransitions) {
      this.noHoldEvidenceCount += 1; return null;
    }
    if (this.snapshotSearch && !this.continuationTable.capture(this.candidateSearch)) {
      this.policySnapshotIncompleteCount += 1; return null;
    }
    if (!this.sharedSearch) {
      const baseline = this.evaluateSearch(this.baselineSearch, bundle,
        incumbentAction, incumbentArgument, engine, 0);
      this.restoreSearchState(state, transitionDeltaBase, transitionEventBase,
        highWaterDelta, highWaterEvent);
      this.lastBaselineStatus = baseline;
      if (baseline === PROOF_STATUS.DISPROVEN) this.baselineDisprovenCount += 1;
      else if (baseline === PROOF_STATUS.PROVEN) {
        this.baselineProvenCount += 1; return null;
      } else { this.baselineUnknownCount += 1; return null; }
    }
    this.certificateCount += 1;
    this.lastCertificateFrame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    this.certificateByDistance[this.featureDistance] += 1;
    this.certificateByProjectileBucket[this.featureProjectileBucket] += 1;
    this.certificateByAxis[this.featureAxis] += 1;
    this.certificateByIncumbentAction[this.featureIncumbentAction] += 1;
    this.certificateByCompletedDepth[this.lastCandidateCompletedDepth] += 1;
    if (incumbentAction !== ACTION.CAST_POISON) this.wouldOverrideCount += 1;
    if (this.mode !== "active" || incumbentAction === ACTION.CAST_POISON)
      return null;
    this.continuationRemaining = this.lastCandidateCompletedDepth - 1;
    this.continuationActive = this.continuationRemaining > 0 ? 1 : 0;
    if (this.continuationActive) this.continuationArmCount += 1;
    this.overrideCount += 1;
    return { action: ACTION.CAST_POISON, argument: NONE_CELL };
  }

  summary() {
    return { enabled: this.mode !== "off", mode: this.mode,
      semantics: "STRICT_ATTACK_EVENT_AND_OR_CAUSAL_DIFFERENTIAL",
      maximumDepth: this.maximumDepth, nodeBudget: this.nodeBudget,
      sharedSearch: this.sharedSearch,
      snapshotSearch: this.snapshotSearch,
      searchImplementation: this.leanSearch ? "LEAN_PRODUCTION" : "DIAGNOSTIC",
      requireSimulatorCadenceAgreement: this.requireSimulatorCadenceAgreement,
      triggerMode: this.triggerMode, checkCount: this.checkCount,
      prefilterRootCount: this.prefilterRootCount,
      eligibleCount: this.eligibleCount,
      triggerBlockedCount: this.triggerBlockedCount,
      cadenceCompatibilityBlockedCount: this.cadenceCompatibilityBlockedCount,
      strictOwnerBlockedCount: this.strictOwnerBlockedCount,
      committedBlockedCount: this.committedBlockedCount,
      skillBlockedCount: this.skillBlockedCount,
      visibilityBlockedCount: this.visibilityBlockedCount,
      supportBlockedCount: this.supportBlockedCount,
      effectBlockedCount: this.effectBlockedCount,
      distanceBlockedCount: this.distanceBlockedCount,
      candidateProvenCount: this.candidateProvenCount,
      candidateDisprovenCount: this.candidateDisprovenCount,
      candidateUnknownCount: this.candidateUnknownCount,
      noHoldEvidenceCount: this.noHoldEvidenceCount,
      baselineDisprovenCount: this.baselineDisprovenCount,
      baselineProvenCount: this.baselineProvenCount,
      baselineUnknownCount: this.baselineUnknownCount,
      certificateCount: this.certificateCount,
      wouldOverrideCount: this.wouldOverrideCount,
      overrideCount: this.overrideCount,
      candidateNodes: this.candidateNodes, baselineNodes: this.baselineNodes,
      searchTransitionCount: this.searchTransitionCount,
      searchHardClassifyCount: this.searchHardClassifyCount,
      searchReverseBuildCount: this.searchReverseBuildCount,
      maximumCandidateNodes: this.maximumCandidateNodes,
      maximumBaselineNodes: this.maximumBaselineNodes,
      candidateProvenPolicyEntries: this.candidateProvenPolicyEntries,
      maximumCandidateProvenPolicyEntries:
        this.maximumCandidateProvenPolicyEntries,
      candidateRootDomainGenerationCount:
        this.candidateSearch.rootDomainGenerationCount || 0,
      candidateRootDomainGenerationFailureCount:
        this.candidateSearch.rootDomainGenerationFailureCount || 0,
      baselineRootDomainGenerationCount:
        this.baselineSearch.rootDomainGenerationCount || 0,
      baselineRootDomainGenerationFailureCount:
        this.baselineSearch.rootDomainGenerationFailureCount || 0,
      candidatePolicyCapacityStopCount:
        this.candidateSearch.ttCapacityStops || 0,
      baselinePolicyCapacityStopCount:
        this.baselineSearch.ttCapacityStops || 0,
      policySnapshotIncompleteCount: this.policySnapshotIncompleteCount,
      policySnapshotCaptureCount: this.continuationTable?.captureCount || 0,
      policySnapshotOverflowCount: this.continuationTable?.overflowCount || 0,
      policySnapshotCapacity: this.continuationTable?.capacity || 0,
      policySnapshotMaximumEntries: this.continuationTable?.maximumEntries || 0,
      policySnapshotLastEntries: this.continuationTable?.count || 0,
      policySnapshotLookupCount: this.continuationTable?.lookupCount || 0,
      policySnapshotHitCount: this.continuationTable?.hitCount || 0,
      rootRestoreFailureCount: this.rootRestoreFailureCount,
      isolationAllocationCount: this.isolationAllocationCount,
      lastCandidateStatus: this.lastCandidateStatus,
      lastBaselineStatus: this.lastBaselineStatus,
      lastGoalMask: this.lastGoalMask,
      lastHoldTransitions: this.lastHoldTransitions,
      lastCandidateCompletedDepth: this.lastCandidateCompletedDepth,
      eligibleByDistance: Array.from(this.eligibleByDistance),
      provenByDistance: Array.from(this.provenByDistance),
      certificateByDistance: Array.from(this.certificateByDistance),
      candidateNodesByDistance: Array.from(this.candidateNodesByDistance),
      eligibleByProjectileBucket: Array.from(this.eligibleByProjectileBucket),
      provenByProjectileBucket: Array.from(this.provenByProjectileBucket),
      certificateByProjectileBucket: Array.from(this.certificateByProjectileBucket),
      candidateNodesByProjectileBucket: Array.from(
        this.candidateNodesByProjectileBucket),
      eligibleByAxis: Array.from(this.eligibleByAxis),
      provenByAxis: Array.from(this.provenByAxis),
      certificateByAxis: Array.from(this.certificateByAxis),
      candidateNodesByAxis: Array.from(this.candidateNodesByAxis),
      eligibleByIncumbentAction: Array.from(this.eligibleByIncumbentAction),
      provenByIncumbentAction: Array.from(this.provenByIncumbentAction),
      certificateByIncumbentAction: Array.from(this.certificateByIncumbentAction),
      certificateByCompletedDepth: Array.from(this.certificateByCompletedDepth),
      continuationActive: this.continuationActive,
      continuationRemaining: this.continuationRemaining,
      continuationArmCount: this.continuationArmCount,
      continuationCheckCount: this.continuationCheckCount,
      continuationSelectCount: this.continuationSelectCount,
      continuationSameCount: this.continuationSameCount,
      continuationMissCount: this.continuationMissCount,
      continuationSupportAbortCount: this.continuationSupportAbortCount,
      continuationHardAbortCount: this.continuationHardAbortCount,
      continuationOwnerAbortCount: this.continuationOwnerAbortCount,
      continuationCompleteCount: this.continuationCompleteCount,
      continuationExactHitCount: this.continuationExactHitCount,
      continuationSemanticHitCount: this.continuationSemanticHitCount,
      continuationCandidateEntryCount: this.continuationCandidateEntryCount,
      continuationMismatchMaskCount: Array.from(this.continuationMismatchMaskCount),
      continuationStatusFieldMismatchCount: Array.from(
        this.continuationStatusFieldMismatchCount),
      lastPolicyMismatchValues: {
        expectedStunUntil: [this.lastExpectedStunUntil0,
          this.lastExpectedStunUntil1],
        actualStunUntil: [this.lastActualStunUntil0,
          this.lastActualStunUntil1],
        expectedBombReady: [this.lastExpectedBombReady0,
          this.lastExpectedBombReady1],
        actualBombReady: [this.lastActualBombReady0,
          this.lastActualBombReady1]
      },
      lastCertificateFrame: this.lastCertificateFrame,
      lastContinuationCheckFrame: this.lastContinuationCheckFrame,
      hotAllocationCount: this.hotAllocationCount +
        this.candidateSearch.hotAllocationCount +
        (this.baselineSearch === this.candidateSearch ? 0 :
          this.baselineSearch.hotAllocationCount) +
        (this.continuationTable?.hotAllocationCount || 0) };
  }
}

module.exports = { NativePoisonAttackEventOptionPoc };
