"use strict";

// BP27 paired long-Option response mass.
//
// Both roots use the same receding AttackPose continuation, enemy response
// domain, chance semantics, Fast transition, Hard classifier, event boundary,
// and Physical-state transposition table.  Only the first own action differs:
// the current incumbent versus the AttackPose route proposal.
//
// Worst-case outcome masks remain intact.  In parallel, every outcome bit and
// three derived classes are backed up with integer 0..10000 nominal response
// mass.  This is diagnostic Risk/strategy evidence, never direct ownership.

const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, FAST_STATUS, HARD_STATUS, TERMINAL, CHANCE, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { NativeLongOptionEventEnvelopePoc, LONG_EVENT_OUTCOME } = require(
  "./native-long-option-event-envelope-poc");

const MASS_INDEX = Object.freeze({
  FIRE: 0, DEATH: 1, ABORT: 2, RESCUE: 3, OPEN: 4,
  INCOMPLETE: 5, WIN: 6, POLICY_LOSS: 7,
  SUCCESS: 8, FAILURE: 9, UNRESOLVED: 10
});
const MASS_DIMENSION = 11;
const DEEP_WIDTH = 6;
const FRAME_SLOTS = 10;
const ACTION_WIDTH = ACTION.BOOST_RIGHT_BOMB + 1;
const RESPONSE_RELATION = Object.freeze({
  NONE: 0, EQUAL: 1, CANDIDATE_DOMINATES: 2,
  BASE_DOMINATES: 3, TRADEOFF: 4, INCOMPLETE: 5
});
const FAILURE_MASK = LONG_EVENT_OUTCOME.DEATH |
  LONG_EVENT_OUTCOME.POLICY_LOSS;
const INCOMPLETE_MASK = LONG_EVENT_OUTCOME.INCOMPLETE;

function policyMix32(hash, value) {
  hash = Math.imul((hash ^ (value >>> 0)) >>> 0, 0x45d9f3b) >>> 0;
  return (hash ^ hash >>> 16) >>> 0;
}

function bitMass(mask, dimension) {
  if (dimension < 8) return mask & (1 << dimension) ? 10000 : 0;
  if (dimension === MASS_INDEX.SUCCESS)
    return mask & (LONG_EVENT_OUTCOME.FIRE | LONG_EVENT_OUTCOME.WIN) ? 10000 : 0;
  if (dimension === MASS_INDEX.FAILURE)
    return mask & FAILURE_MASK ? 10000 : 0;
  return mask & (LONG_EVENT_OUTCOME.ABORT | LONG_EVENT_OUTCOME.RESCUE |
    LONG_EVENT_OUTCOME.OPEN | LONG_EVENT_OUTCOME.INCOMPLETE) ? 10000 : 0;
}

class NativeLongOptionResponseMassPoc extends NativeLongOptionEventEnvelopePoc {
  constructor(mode = "off", options = {}) {
    const normalized = mode === "guarded-shadow" ? "shadow" : mode;
    super(normalized, options);
    this.mode = mode === "active" || mode === "shadow" ||
      mode === "guarded-shadow" ? mode : "off";
    this.responseOwnershipActive = mode === "active" ? 1 : 0;
    this.hostClosureActive = mode === "active" || mode === "guarded-shadow" ? 1 : 0;
    this.stateMask = new Uint8Array(FRAME_SLOTS);
    this.branchMask = new Uint8Array(FRAME_SLOTS);
    this.stateMass = new Uint16Array(FRAME_SLOTS * MASS_DIMENSION);
    this.branchMass = new Uint16Array(FRAME_SLOTS * MASS_DIMENSION);
    this.stateMassSum = new Uint32Array(FRAME_SLOTS * MASS_DIMENSION);
    this.branchMassSum = new Uint32Array(FRAME_SLOTS * MASS_DIMENSION);
    this.ttMass = new Uint16Array(this.ttStamp.length * MASS_DIMENSION);
    this.ttPolicyId = new Uint8Array(this.ttStamp.length);
    // Defaults preserve BP27/BP29: both roots share the same continuation.
    // BP30 overrides these identities and routeOwnAction/massForMask.
    this.basePolicyId = 0; this.candidatePolicyId = 0;
    this.currentPolicyId = 0;
    this.candidateProposalMode =
      options.candidateProposalMode === "root-value-mobility" ?
        "root-value-mobility" :
        options.candidateProposalMode === "root-value" ?
          "root-value" : "attack-pose";
    this.rootValueProposalCount = 0;
    this.rootValueProposalMissingCount = 0;
    this.transitionObserver = options.transitionObserver || null;
    this.baseMass = new Uint16Array(MASS_DIMENSION);
    this.candidateMass = new Uint16Array(MASS_DIMENSION);
    this.baseMassTotal = new Uint32Array(MASS_DIMENSION);
    this.candidateMassTotal = new Uint32Array(MASS_DIMENSION);
    this.massDeltaTotal = new Int32Array(MASS_DIMENSION);
    this.baseOutcomeMaskCount = new Uint32Array(256);
    this.candidateOutcomeMaskCount = new Uint32Array(256);
    this.baseMask = 0; this.candidateMask = 0;
    this.pairCount = 0; this.pairCompleteCount = 0;
    this.sameRootActionCount = 0; this.differentRootActionCount = 0;
    this.sameActionMismatchCount = 0;
    this.sameActionPartialDriftCount = 0;
    this.equalCount = 0; this.candidateDominanceCount = 0;
    this.baseDominanceCount = 0; this.tradeoffCount = 0;
    this.pairIncompleteCount = 0; this.wouldOverrideCount = 0;
    this.overrideCount = 0;
    this.finalGateCheckCount = 0; this.finalGateRejectCount = 0;
    this.hostFinalCheckCount = 0; this.hostFinalApprovedCount = 0;
    this.hostFinalRejectCount = 0; this.hostFinalFallbackCount = 0;
    this.hostFinalNoSafeActionCount = 0;
    this.hostFinalFallbackFailureCount = 0;
    this.overrideByAction = new Uint32Array(ACTION_WIDTH);
    this.overrideActionMatrix = new Uint32Array(ACTION_WIDTH * ACTION_WIDTH);
    this.baseNodeCount = 0; this.candidateNodeCount = 0;
    this.baseTransitionCount = 0; this.candidateTransitionCount = 0;
    this.sharedMergeHitCount = 0;
    this.lastRelation = RESPONSE_RELATION.NONE;
  }

  setMass(array, offset, mask) {
    for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1)
      array[offset + dimension] = this.massForMask(mask, dimension);
  }

  massForMask(mask, dimension) { return bitMass(mask, dimension); }

  routeOwnAction(state) { return this.feedback.routeAction(state); }

  responseWeight(engine, search, state, enemyAction) {
    return Math.min(65535, search.opponentWeight(engine, state, enemyAction));
  }

  ttIndex(state, remaining) {
    const mask = this.ttStamp.length - 1;
    let index = policyMix32(state.hashLo,
      state.hashHi ^ remaining ^ (this.currentPolicyId << 24)) & mask;
    for (let probe = 0; probe < this.ttStamp.length; probe += 1) {
      if (this.ttStamp[index] !== this.ttEpoch) return -index - 2;
      if (this.ttHashLo[index] === state.hashLo &&
          this.ttHashHi[index] === state.hashHi &&
          this.ttRemaining[index] === remaining &&
          this.ttPolicyId[index] === this.currentPolicyId) return index;
      index = (index + 1) & mask;
    }
    return -1;
  }

  copyMass(source, sourceOffset, target, targetOffset) {
    for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1)
      target[targetOffset + dimension] = source[sourceOffset + dimension];
  }

  setStateLeaf(depth, mask) {
    this.stateMask[depth] = mask;
    this.setMass(this.stateMass, depth * MASS_DIMENSION, mask);
    return mask;
  }

  setBranchLeaf(depth, mask) {
    this.branchMask[depth] = mask;
    this.setMass(this.branchMass, depth * MASS_DIMENSION, mask);
    return mask;
  }

  copyTtToState(index, depth) {
    this.stateMask[depth] = this.ttOutcome[index];
    this.copyMass(this.ttMass, index * MASS_DIMENSION,
      this.stateMass, depth * MASS_DIMENSION);
    return this.stateMask[depth];
  }

  storeMass(state, remaining, outcome, depth) {
    const found = this.ttIndex(state, remaining);
    if (found >= 0) return found;
    if (found === -1) {
      this.ttCapacityFailureCount += 1; return -1;
    }
    const index = -found - 2;
    this.ttStamp[index] = this.ttEpoch;
    this.ttHashLo[index] = state.hashLo; this.ttHashHi[index] = state.hashHi;
    this.ttRemaining[index] = remaining; this.ttOutcome[index] = outcome;
    this.ttPolicyId[index] = this.currentPolicyId;
    this.copyMass(this.stateMass, depth * MASS_DIMENSION,
      this.ttMass, index * MASS_DIMENSION);
    this.ttStoreCount += 1; return index;
  }

  classifyAppliedMass(engine, search, ownAction, depth) {
    const state = engine.adapter.state; const a = state.arrays;
    const terminal = a[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    const event = ownAction === ACTION.FIRE ? LONG_EVENT_OUTCOME.FIRE : 0;
    if (a[ARRAY.TANK_CRASH][0]) return event | LONG_EVENT_OUTCOME.DEATH;
    if (a[ARRAY.TANK_CRASH][1] || terminal === TERMINAL.WIN0)
      return event | LONG_EVENT_OUTCOME.WIN;
    if (terminal === TERMINAL.WIN1 || terminal === TERMINAL.DRAW)
      return event | LONG_EVENT_OUTCOME.POLICY_LOSS;
    const hard = search.diagnosticHard.classifyApplied();
    if (hard === HARD_STATUS.REJECT_PROVEN)
      return event | LONG_EVENT_OUTCOME.DEATH;
    if (hard === HARD_STATUS.REJECT_POLICY)
      return event | LONG_EVENT_OUTCOME.POLICY_LOSS;
    if (hard === HARD_STATUS.INCOMPLETE) {
      this.hardIncompleteCount += 1;
      return event | LONG_EVENT_OUTCOME.INCOMPLETE;
    }
    if (event) return event;
    return 0x100 | this.expandMassState(engine, search, depth + 1);
  }

  applyMassResponse(engine, search, ownAction, ownArgument, enemyAction,
      enemyArgument, depth) {
    const state = engine.adapter.state; const kernel = search.diagnosticKernel;
    let ownChance = engine.depthSearch.chanceAlternatives(state, 0, ownAction);
    let deterministicOwn = CHANCE.NORMAL;
    if (search.ownChanceMode === "v1-deterministic" && ownChance > 1) {
      deterministicOwn = search.v1OwnChance(state, ownAction); ownChance = 1;
    }
    const enemyChance = engine.depthSearch.chanceAlternatives(state, 1,
      enemyAction);
    const offset = depth * MASS_DIMENSION;
    this.branchMassSum.fill(0, offset, offset + MASS_DIMENSION);
    let outcome = 0; let support = 0;
    for (let own = 0; own < ownChance; own += 1) {
      for (let enemy = 0; enemy < enemyChance; enemy += 1) {
        if (this.currentTransitions >= this.nodeBudget) {
          this.budgetStopCount += 1;
          if (this.budgetObserver?.observeBudgetStop)
            this.budgetObserver.observeBudgetStop(1, depth, ownAction,
              enemyAction, this.currentPolicyId);
          return this.setBranchLeaf(depth, LONG_EVENT_OUTCOME.INCOMPLETE);
        }
        this.currentTransitions += 1;
        const actualOwnChance = ownChance === 1 ? deterministicOwn : own;
        const actualEnemyChance = enemyChance === 1 ? CHANCE.NORMAL : enemy;
        const canonicalHit = this.transitionObserver?.lookupCanonicalBranch ?
          this.transitionObserver.lookupCanonicalBranch(state, depth,
            ownAction, ownArgument, enemyAction, enemyArgument,
            actualOwnChance, actualEnemyChance) : -1;
        if (canonicalHit >= 0) {
          let childMask = this.transitionObserver.canonicalMask[canonicalHit];
          const kind = this.transitionObserver.canonicalKind[canonicalHit];
          if (kind === 3) {
            if (this.currentNodes >= this.nodeBudget) {
              this.budgetStopCount += 1;
              childMask = LONG_EVENT_OUTCOME.INCOMPLETE;
              outcome |= childMask; support += 1;
              for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1)
                this.branchMassSum[offset + dimension] +=
                  this.massForMask(childMask, dimension);
              continue;
            }
            this.currentNodes += 1;
            if (this.transitionObserver.canonicalMergeCharge[canonicalHit])
              this.mergeHitCount += 1;
          } else if (kind === 1) this.fastIncompleteCount += 1;
          else if (kind === 2) this.hardIncompleteCount += 1;
          outcome |= childMask; support += 1;
          const cachedOffset = canonicalHit * MASS_DIMENSION;
          for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1)
            this.branchMassSum[offset + dimension] +=
              this.transitionObserver.canonicalMass[cachedOffset + dimension];
          continue;
        }
        const mark = state.deltaUsed * 1024 + state.eventUsed;
        const parentHashLo = state.hashLo; const parentHashHi = state.hashHi;
        const beforeFrame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
        if (this.transitionObserver?.observeTransitionRequest)
          this.transitionObserver.observeTransitionRequest(parentHashLo,
            parentHashHi, ownAction, ownArgument, enemyAction,
            enemyArgument, actualOwnChance, actualEnemyChance,
            this.currentPolicyId, state);
        const status = kernel.applyFrame(ownAction, ownArgument,
          enemyAction, enemyArgument,
          actualOwnChance, actualEnemyChance);
        let encoded;
        let canonicalKind = 0;
        if (status !== FAST_STATUS.APPLIED &&
            status !== FAST_STATUS.APPLIED_TERMINAL) {
          this.fastIncompleteCount += 1;
          canonicalKind = 1;
          encoded = LONG_EVENT_OUTCOME.INCOMPLETE;
        } else {
          search.extendV1StunCountdown(state, ownAction, enemyAction,
            beforeFrame);
          if (this.transitionObserver?.observeTransitionSuccessor)
            this.transitionObserver.observeTransitionSuccessor(parentHashLo,
              parentHashHi, ownAction, ownArgument, enemyAction,
              enemyArgument, actualOwnChance, actualEnemyChance,
              this.currentPolicyId, state, mark);
          encoded = this.classifyAppliedMass(engine, search, ownAction, depth);
          if (!(encoded & 0x100) &&
              (encoded & LONG_EVENT_OUTCOME.INCOMPLETE)) canonicalKind = 2;
          else if (encoded & 0x100) canonicalKind = 3;
        }
        const recursive = encoded & 0x100; const childMask = encoded & 0xff;
        if (this.transitionObserver?.storeCanonicalBranch)
          this.transitionObserver.storeCanonicalBranch(state, depth,
            childMask, recursive, canonicalKind, this);
        outcome |= childMask; support += 1;
        const childOffset = (depth + 1) * MASS_DIMENSION;
        for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1)
          this.branchMassSum[offset + dimension] += recursive ?
            this.stateMass[childOffset + dimension] :
            this.massForMask(childMask, dimension);
        state.undoTo(mark);
      }
    }
    if (!support) return this.setBranchLeaf(depth,
      LONG_EVENT_OUTCOME.INCOMPLETE);
    this.branchMask[depth] = outcome;
    for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1)
      this.branchMass[offset + dimension] = Math.trunc(
        (this.branchMassSum[offset + dimension] + (support >> 1)) / support);
    return outcome;
  }

  expandMassState(engine, search, depth) {
    if (this.currentNodes >= this.nodeBudget) {
      this.budgetStopCount += 1;
      if (this.budgetObserver?.observeBudgetStop)
        this.budgetObserver.observeBudgetStop(2, depth, ACTION.NONE,
          ACTION.NONE, this.currentPolicyId);
      return this.setStateLeaf(depth, LONG_EVENT_OUTCOME.INCOMPLETE);
    }
    this.currentNodes += 1;
    const state = engine.adapter.state; const remaining = this.maximumFrames - depth;
    if (remaining <= 0) return this.setStateLeaf(depth, LONG_EVENT_OUTCOME.OPEN);
    if (this.hasCommittedDanger(state))
      return this.setStateLeaf(depth, LONG_EVENT_OUTCOME.RESCUE);
    const cached = this.ttIndex(state, remaining);
    if (cached >= 0) {
      this.mergeHitCount += 1; return this.copyTtToState(cached, depth);
    }
    if (cached === -1) {
      this.ttCapacityFailureCount += 1;
      return this.setStateLeaf(depth, LONG_EVENT_OUTCOME.INCOMPLETE);
    }
    const ownAction = this.routeOwnAction(state);
    if (ownAction === ACTION.NONE)
      return this.setStateLeaf(depth, LONG_EVENT_OUTCOME.ABORT);
    const enemyCount = this.copyEnemyDomain(engine, search, depth);
    if (!enemyCount)
      return this.setStateLeaf(depth, LONG_EVENT_OUTCOME.INCOMPLETE);
    if (this.transitionObserver?.beginCanonicalState)
      this.transitionObserver.beginCanonicalState(depth);
    const offset = depth * MASS_DIMENSION;
    this.stateMassSum.fill(0, offset, offset + MASS_DIMENSION);
    const actionOffset = depth * DEEP_WIDTH;
    let outcome = 0; let totalWeight = 0;
    for (let index = 0; index < enemyCount; index += 1) {
      const enemyAction = this.enemyActions[actionOffset + index];
      const weight = this.responseWeight(engine, search, state, enemyAction,
        depth, index);
      const branch = this.applyMassResponse(engine, search, ownAction,
        NONE_CELL, enemyAction, this.enemyArguments[actionOffset + index], depth);
      outcome |= branch; totalWeight += weight;
      for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1)
        this.stateMassSum[offset + dimension] +=
          this.branchMass[offset + dimension] * weight;
    }
    if (!totalWeight)
      return this.setStateLeaf(depth, LONG_EVENT_OUTCOME.INCOMPLETE);
    this.stateMask[depth] = outcome;
    for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1)
      this.stateMass[offset + dimension] = Math.min(10000, Math.trunc(
        (this.stateMassSum[offset + dimension] + (totalWeight >> 1)) /
          totalWeight));
    if (this.storeMass(state, remaining, outcome, depth) < 0)
      return this.setStateLeaf(depth, outcome | LONG_EVENT_OUTCOME.INCOMPLETE);
    return outcome;
  }

  evaluateMassRoot(engine, search, action, argument, targetMass) {
    const state = engine.adapter.state; const kernel = search.diagnosticKernel;
    this.currentNodes = 0; this.currentTransitions = 0;
    if (!state || !kernel || !search.diagnosticHard ||
        !search.representativeSupportComplete) {
      this.setMass(targetMass, 0, LONG_EVENT_OUTCOME.INCOMPLETE);
      return LONG_EVENT_OUTCOME.INCOMPLETE;
    }
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    const hashLo = state.hashLo; const hashHi = state.hashHi;
    const kernelFailure = kernel.failure; const kernelLastMark = kernel.lastMark;
    const transitionDeltaBase = state.transitionDeltaBase;
    const transitionEventBase = state.transitionEventBase;
    const highWaterDelta = state.highWaterDelta;
    const highWaterEvent = state.highWaterEvent;
    const enemyCount = this.copyEnemyDomain(engine, search, 0);
    if (this.transitionObserver?.beginCanonicalState)
      this.transitionObserver.beginCanonicalState(0);
    const offset = 0; this.stateMassSum.fill(0, 0, MASS_DIMENSION);
    let outcome = 0; let totalWeight = 0;
    for (let index = 0; index < enemyCount; index += 1) {
      const enemyAction = this.enemyActions[index];
      const weight = this.responseWeight(engine, search, state, enemyAction,
        0, index);
      const branch = this.applyMassResponse(engine, search, action, argument,
        enemyAction, this.enemyArguments[index], 0);
      outcome |= branch; totalWeight += weight;
      for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1)
        this.stateMassSum[offset + dimension] +=
          this.branchMass[offset + dimension] * weight;
    }
    if (!enemyCount || !totalWeight) outcome = LONG_EVENT_OUTCOME.INCOMPLETE;
    if (outcome === LONG_EVENT_OUTCOME.INCOMPLETE)
      this.setMass(targetMass, 0, outcome);
    else
      for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1)
        targetMass[dimension] = Math.min(10000, Math.trunc(
          (this.stateMassSum[dimension] + (totalWeight >> 1)) / totalWeight));
    state.undoTo(mark); kernel.failure = kernelFailure; kernel.lastMark = kernelLastMark;
    state.transitionDeltaBase = transitionDeltaBase;
    state.transitionEventBase = transitionEventBase;
    state.highWaterDelta = highWaterDelta; state.highWaterEvent = highWaterEvent;
    if (state.hashLo !== hashLo || state.hashHi !== hashHi ||
        state.deltaUsed * 1024 + state.eventUsed !== mark) {
      this.rootRestoreFailureCount += 1;
      outcome |= LONG_EVENT_OUTCOME.INCOMPLETE;
      this.setMass(targetMass, 0, outcome);
    }
    this.nodeCount += this.currentNodes;
    this.transitionCount += this.currentTransitions;
    if (this.currentNodes > this.maximumNodes) this.maximumNodes = this.currentNodes;
    if (this.currentTransitions > this.maximumTransitions)
      this.maximumTransitions = this.currentTransitions;
    return outcome || LONG_EVENT_OUTCOME.INCOMPLETE;
  }

  dominates(leftMask, left, rightMask, right) {
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

  relation() {
    let equal = this.baseMask === this.candidateMask;
    for (let dimension = 0; dimension < MASS_DIMENSION && equal; dimension += 1)
      equal = this.baseMass[dimension] === this.candidateMass[dimension];
    if (equal) return RESPONSE_RELATION.EQUAL;
    const candidate = this.dominates(this.candidateMask, this.candidateMass,
      this.baseMask, this.baseMass);
    const base = this.dominates(this.baseMask, this.baseMass,
      this.candidateMask, this.candidateMass);
    if (candidate) return RESPONSE_RELATION.CANDIDATE_DOMINATES;
    if (base) return RESPONSE_RELATION.BASE_DOMINATES;
    return RESPONSE_RELATION.TRADEOFF;
  }

  rootValueCandidateRow(engine, search) {
    if (!search?.representativeSupportComplete || !search.rootScore ||
        !search.rootDomainMask) return -1;
    let best = -1; let bestValue = -2147483648;
    for (let row = 0; row < engine.ourCount; row += 1) {
      const action = engine.ourActions[row];
      if (action === ACTION.NONE || !search.rootDomainMask[row] ||
          engine.hardStatus[row] !== HARD_STATUS.ALLOW ||
          (engine.riskController?.outcome?.acceptable &&
            !engine.riskController.outcome.acceptable[row])) continue;
      if (this.candidateProposalMode === "root-value-mobility" &&
          action !== ACTION.GO && action !== ACTION.TURN_LEFT &&
          action !== ACTION.TURN_RIGHT) continue;
      const value = search.rootScore[row];
      if (!Number.isFinite(value)) continue;
      if (best < 0 || value > bestValue || value === bestValue && row < best) {
        best = row; bestValue = value;
      }
    }
    return best;
  }

  observe(engine, search, incumbentAction, incumbentArgument = NONE_CELL) {
    if (this.mode === "off") return null;
    this.checkCount += 1; this.lastRelation = RESPONSE_RELATION.NONE;
    if ((engine.escapeObligation?.committedEntityCount | 0) > 0 ||
        this.hasCommittedDanger(engine.adapter.state)) {
      this.committedBlockedCount += 1; return null;
    }
    let row; let candidateAction;
    if (this.candidateProposalMode !== "attack-pose") {
      row = this.rootValueCandidateRow(engine, search);
      if (row < 0) { this.rootValueProposalMissingCount += 1; return null; }
      candidateAction = engine.ourActions[row];
      this.rootValueProposalCount += 1;
      this.lastTargetSignature = ((candidateAction + 1) * 65537 ^
        (engine.ourArguments[row] + 1)) >>> 0 || 1;
    } else {
      if (!this.pose.prepare(engine, engine.ourCount) || this.pose.selected < 0) {
        this.poseMissingCount += 1; return null;
      }
      candidateAction = this.feedback.routeAction(engine.adapter.state);
      if (candidateAction === ACTION.NONE) {
        this.poseMissingCount += 1; return null;
      }
      if (candidateAction === ACTION.FIRE) {
        this.rootFireSkipCount += 1; return null;
      }
      row = this.bestAttackRow(engine, this.pose, candidateAction);
      this.lastTargetSignature = this.targetSignature(this.pose);
    }
    if (row < 0) { this.candidateRowMissingCount += 1; return null; }
    this.rootRouteCount += 1; this.routeByAction[candidateAction] += 1;
    this.lastAction = candidateAction; this.lastArgument = engine.ourArguments[row];
    this.pairCount += 1; this.nextEpoch();
    const mergeBefore = this.mergeHitCount;
    this.currentPolicyId = this.basePolicyId;
    this.baseMask = this.evaluateMassRoot(engine, search,
      incumbentAction, incumbentArgument, this.baseMass);
    const baseNodes = this.currentNodes;
    const baseTransitions = this.currentTransitions;
    this.currentPolicyId = this.candidatePolicyId;
    this.candidateMask = this.evaluateMassRoot(engine, search,
      candidateAction, this.lastArgument, this.candidateMass);
    this.currentPolicyId = 0;
    this.baseNodeCount += baseNodes; this.baseTransitionCount += baseTransitions;
    this.candidateNodeCount += this.currentNodes;
    this.candidateTransitionCount += this.currentTransitions;
    this.sharedMergeHitCount += this.mergeHitCount - mergeBefore;
    this.baseOutcomeMaskCount[this.baseMask & 0xff] += 1;
    this.candidateOutcomeMaskCount[this.candidateMask & 0xff] += 1;
    for (let dimension = 0; dimension < MASS_DIMENSION; dimension += 1) {
      this.baseMassTotal[dimension] += this.baseMass[dimension];
      this.candidateMassTotal[dimension] += this.candidateMass[dimension];
      this.massDeltaTotal[dimension] +=
        this.candidateMass[dimension] - this.baseMass[dimension];
    }
    const incomplete = (this.baseMask | this.candidateMask) & INCOMPLETE_MASK;
    if (incomplete) this.pairIncompleteCount += 1;
    else this.pairCompleteCount += 1;
    // Completeness and equality are orthogonal.  Two byte-identical partial
    // intervals are still equal (and are separately counted as incomplete);
    // only a non-equal partial comparison loses its ordering relation.
    const rawRelation = this.relation();
    this.lastRelation = incomplete && rawRelation !== RESPONSE_RELATION.EQUAL ?
      RESPONSE_RELATION.INCOMPLETE : rawRelation;
    if (candidateAction === incumbentAction) {
      this.sameRootActionCount += 1;
      if (this.lastRelation !== RESPONSE_RELATION.EQUAL) {
        if (incomplete) this.sameActionPartialDriftCount += 1;
        else this.sameActionMismatchCount += 1;
      }
    } else this.differentRootActionCount += 1;
    if (this.lastRelation === RESPONSE_RELATION.EQUAL) this.equalCount += 1;
    else if (this.lastRelation === RESPONSE_RELATION.CANDIDATE_DOMINATES) {
      this.candidateDominanceCount += 1;
      if (candidateAction !== incumbentAction) this.wouldOverrideCount += 1;
    } else if (this.lastRelation === RESPONSE_RELATION.BASE_DOMINATES)
      this.baseDominanceCount += 1;
    else if (this.lastRelation === RESPONSE_RELATION.TRADEOFF)
      this.tradeoffCount += 1;
    if (!incomplete && candidateAction !== incumbentAction &&
        this.lastRelation === RESPONSE_RELATION.CANDIDATE_DOMINATES) {
      this.overrideByAction[candidateAction] += 1;
      this.overrideActionMatrix[incumbentAction * ACTION_WIDTH +
        candidateAction] += 1;
      if (this.responseOwnershipActive) {
        this.finalGateCheckCount += 1;
        if (!engine.finalGate || !engine.adapter?.bundle ||
            !engine.finalGate.finalAllows(engine.adapter.bundle,
              engine.ourActions, engine.ourArguments, row, engine.ourCount)) {
          this.finalGateRejectCount += 1;
          return null;
        }
        this.overrideCount += 1;
        return { action: candidateAction, argument: this.lastArgument, row };
      }
    }
    return null;
  }

  finalAllowedRow(engine, action, argument, preferredRow = -1) {
    if (!engine.finalGate || !engine.adapter?.bundle) return -1;
    if (preferredRow >= 0 && preferredRow < engine.ourCount &&
        engine.ourActions[preferredRow] === action &&
        engine.ourArguments[preferredRow] === argument &&
        engine.finalGate.finalAllows(engine.adapter.bundle,
          engine.ourActions, engine.ourArguments, preferredRow, engine.ourCount))
      return preferredRow;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (engine.ourActions[row] !== action ||
          engine.ourArguments[row] !== argument) continue;
      if (engine.finalGate.finalAllows(engine.adapter.bundle,
          engine.ourActions, engine.ourArguments, row, engine.ourCount)) return row;
    }
    return -1;
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
    const row = this.finalAllowedRow(engine, resolved.action, argument,
      Number.isSafeInteger(resolved.row) ? resolved.row : -1);
    if (row >= 0) {
      this.hostFinalApprovedCount += 1;
      resolved.argument = argument; resolved.row = row;
      return resolved;
    }
    this.hostFinalRejectCount += 1;
    const originalRow = this.finalAllowedRow(engine, originalAction,
      originalArgument, engine.diagnosticInternalSelectedIndex | 0);
    if (originalRow >= 0) {
      this.hostFinalFallbackCount += 1;
      return null;
    }
    // The production root can legitimately reach an all-rejected emergency
    // state.  It is not an avoidable fail-open: there is no ALLOW row to
    // restore.  Keep this separate from a missing-gate/identity failure.
    for (let row = 0; row < engine.ourCount; row += 1) {
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
    const base = super.summary();
    return { ...base,
      semantics: "PAIRED_EVENT_RESPONSE_MASS",
      responseOwnershipActive: Boolean(this.responseOwnershipActive),
      hostClosureActive: Boolean(this.hostClosureActive),
      candidateProposalMode: this.candidateProposalMode,
      rootValueProposalCount: this.rootValueProposalCount,
      rootValueProposalMissingCount: this.rootValueProposalMissingCount,
      massScale: 10000, massDimensionNames: Object.keys(MASS_INDEX),
      pairCount: this.pairCount, pairCompleteCount: this.pairCompleteCount,
      pairIncompleteCount: this.pairIncompleteCount,
      sameRootActionCount: this.sameRootActionCount,
      differentRootActionCount: this.differentRootActionCount,
      sameActionMismatchCount: this.sameActionMismatchCount,
      sameActionPartialDriftCount: this.sameActionPartialDriftCount,
      equalCount: this.equalCount,
      candidateDominanceCount: this.candidateDominanceCount,
      baseDominanceCount: this.baseDominanceCount,
      tradeoffCount: this.tradeoffCount,
      wouldOverrideCount: this.wouldOverrideCount,
      overrideCount: this.overrideCount,
      finalGateCheckCount: this.finalGateCheckCount,
      finalGateRejectCount: this.finalGateRejectCount,
      hostFinalCheckCount: this.hostFinalCheckCount,
      hostFinalApprovedCount: this.hostFinalApprovedCount,
      hostFinalRejectCount: this.hostFinalRejectCount,
      hostFinalFallbackCount: this.hostFinalFallbackCount,
      hostFinalNoSafeActionCount: this.hostFinalNoSafeActionCount,
      hostFinalFallbackFailureCount: this.hostFinalFallbackFailureCount,
      overrideByAction: Array.from(this.overrideByAction),
      overrideActionMatrix: Array.from(this.overrideActionMatrix),
      baseNodeCount: this.baseNodeCount,
      candidateNodeCount: this.candidateNodeCount,
      baseTransitionCount: this.baseTransitionCount,
      candidateTransitionCount: this.candidateTransitionCount,
      sharedMergeHitCount: this.sharedMergeHitCount,
      baseMask: this.baseMask, candidateMask: this.candidateMask,
      baseMass: Array.from(this.baseMass),
      candidateMass: Array.from(this.candidateMass),
      baseMassTotal: Array.from(this.baseMassTotal),
      candidateMassTotal: Array.from(this.candidateMassTotal),
      massDeltaTotal: Array.from(this.massDeltaTotal),
      baseOutcomeMaskCount: Array.from(this.baseOutcomeMaskCount),
      candidateOutcomeMaskCount: Array.from(this.candidateOutcomeMaskCount),
      lastRelation: this.lastRelation };
  }
}

module.exports = { NativeLongOptionResponseMassPoc, MASS_INDEX,
  MASS_DIMENSION, RESPONSE_RELATION, bitMass };
