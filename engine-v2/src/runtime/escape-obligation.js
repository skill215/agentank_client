"use strict";

const { CAPACITY } = require("../generated/fast-config");
const { SEARCH_CAPACITY } = require("../generated/search-config");
const { HARD_STATUS } = require("../abi/fast-codes");
const { ARRAY } = require("../state/fast-state");
const { DeadlineKernel, DEADLINE_PROOF, SUCCESSOR_PROOF } = require("../fast/deadline-kernel");

const ENTITY_BOMB = 1;
const ENTITY_PROJECTILE = 2;
const ENTITY_CAPACITY = CAPACITY.MAX_BOMBS + CAPACITY.MAX_PROJECTILES;
const SUPPORT_STATUS = Object.freeze({
  NONE: 0,
  COMPLETE: 1,
  INCOMPLETE: 2,
  TRAPPED: 3
});

// EscapeObligation owns only already committed physical hazards. Hidden worlds,
// possible projectiles, a future FIRE and enemy facing remain Safety/Risk facts.
// The class produces a fixed-array membership certificate; it never writes a
// death probability and never creates a Hard rejection.
class EscapeObligation {
  constructor(options = {}) {
    const maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    this.chanceComplete = options.chanceComplete === true ? 1 : 0;
    this.chanceSurvivalMass = options.chanceSurvivalMass === true ? 1 : 0;
    this.deadline = new DeadlineKernel({ chanceCompleteStun: this.chanceComplete,
      chanceSurvivalMass: this.chanceSurvivalMass });
    this.member = new Uint8Array(maxActions);
    this.successorProof = new Uint8Array(maxActions);
    this.successorExposed = new Uint8Array(maxActions);
    this.successorSlack = new Int8Array(maxActions);
    this.successorBranches = new Uint8Array(maxActions);
    this.successorCoverage = new Uint8Array(maxActions);
    this.successorSurvivalMass = new Uint16Array(maxActions);
    this.successorOutput = {
      proofStatus: this.successorProof,
      stillExposedAtDeadline: this.successorExposed,
      slack: this.successorSlack,
      viableNextActionCount: this.successorBranches,
      coverageComplete: this.successorCoverage,
      survivalMass: this.successorSurvivalMass
    };
    // Compatibility aliases used by existing diagnostics while GR0 transfers
    // semantic ownership: heuristic-first-action becomes committed membership.
    this.firstAction = this.member;
    this.postViable = new Int8Array(maxActions);
    this.stillExposed = this.successorExposed;
    this.entityKind = new Uint8Array(ENTITY_CAPACITY);
    this.entityOwner = new Uint8Array(ENTITY_CAPACITY);
    this.entityId = new Uint32Array(ENTITY_CAPACITY);
    this.entityGeneration = new Uint16Array(ENTITY_CAPACITY);
    this.supportStatus = SUPPORT_STATUS.NONE;
    this.committedEntityCount = 0;
    this.entityCount = 0;
    this.rootSlack = 0;
    this.firstActionCount = 0;
    this.successorQualityReady = 0;
    this.active = 0;
    this.continuationRequired = 0;
    this.evaluatedCount = 0;
    this.restrictedSelectionCount = 0;
    this.rescueOverrideCount = 0;
    this.strictRescueCheckCount = 0;
    this.strictRescueDeadPreferredCount = 0;
    this.strictRescueCandidateCount = 0;
    this.strictRescueOverrideCount = 0;
    this.strictRescueFinalRejectCount = 0;
    this.persistentCheckCount = 0;
    this.persistentCandidateCount = 0;
    this.persistentOverrideCount = 0;
    this.persistentFinalRejectCount = 0;
    this.activateCount = 0;
    this.hotAllocationCount = 0;
    this.successorSlabFillCount = 0;
    this.chanceMergeCount = 0;
    this.chanceMixedRowCount = 0;
  }

  resetRows(count) {
    this.member.fill(0, 0, count);
    this.postViable.fill(0, 0, count);
    this.successorProof.fill(SUCCESSOR_PROOF.PROVEN_DEAD, 0, count);
    this.successorExposed.fill(0, 0, count);
    this.successorSlack.fill(-128, 0, count);
    this.successorBranches.fill(0, 0, count);
    this.successorCoverage.fill(0, 0, count);
    this.successorSurvivalMass.fill(0, 0, count);
    this.firstActionCount = 0;
    this.successorQualityReady = 0;
    this.evaluatedCount = 0;
  }

  resetMatch() {
    this.supportStatus = SUPPORT_STATUS.NONE;
    this.committedEntityCount = 0;
    this.entityCount = 0;
    this.rootSlack = 0;
    this.active = 0;
    this.continuationRequired = 0;
    this.firstActionCount = 0;
    this.successorQualityReady = 0;
    this.deadline.reset();
  }

  bindOne(kind, owner, id, generation) {
    if (this.committedEntityCount >= ENTITY_CAPACITY) return 0;
    const at = this.committedEntityCount++;
    this.entityKind[at] = kind;
    this.entityOwner[at] = owner;
    this.entityId[at] = id;
    this.entityGeneration[at] = generation;
    return 1;
  }

  bindCommitted(state) {
    const a = state.arrays;
    this.committedEntityCount = 0;
    for (let slot = 0; slot < a[ARRAY.BOMB_ACTIVE].length; slot += 1) {
      if (!a[ARRAY.BOMB_ACTIVE][slot]) continue;
      if (!this.bindOne(ENTITY_BOMB, a[ARRAY.BOMB_OWNER][slot],
        a[ARRAY.BOMB_ID][slot], a[ARRAY.BOMB_GENERATION][slot])) return 0;
    }
    for (let slot = 0; slot < a[ARRAY.PROJECTILE_ACTIVE].length; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot] ||
          a[ARRAY.PROJECTILE_OWNER][slot] === 0) continue;
      if (!this.bindOne(ENTITY_PROJECTILE, a[ARRAY.PROJECTILE_OWNER][slot],
        a[ARRAY.PROJECTILE_ID][slot], a[ARRAY.PROJECTILE_GENERATION][slot])) return 0;
    }
    this.entityCount = this.committedEntityCount;
    return 1;
  }

  entityPresent(state, index) {
    const a = state.arrays;
    const active = this.entityKind[index] === ENTITY_BOMB ?
      a[ARRAY.BOMB_ACTIVE] : a[ARRAY.PROJECTILE_ACTIVE];
    const owner = this.entityKind[index] === ENTITY_BOMB ?
      a[ARRAY.BOMB_OWNER] : a[ARRAY.PROJECTILE_OWNER];
    const id = this.entityKind[index] === ENTITY_BOMB ?
      a[ARRAY.BOMB_ID] : a[ARRAY.PROJECTILE_ID];
    const generation = this.entityKind[index] === ENTITY_BOMB ?
      a[ARRAY.BOMB_GENERATION] : a[ARRAY.PROJECTILE_GENERATION];
    for (let slot = 0; slot < active.length; slot += 1)
      if (active[slot] && owner[slot] === this.entityOwner[index] &&
          id[slot] === this.entityId[index] &&
          generation[slot] === this.entityGeneration[index]) return 1;
    return 0;
  }

  entitiesMatch(state) {
    if (!this.committedEntityCount) return 0;
    for (let index = 0; index < this.committedEntityCount; index += 1)
      if (!this.entityPresent(state, index)) return 0;
    return 1;
  }

  evaluateCommitted(bundle, actions, arguments_, projectedCell, projectedDirection,
      hardStatus, count, chanceSupport = null) {
    const continuing = this.active && bundle && bundle.state &&
      this.entitiesMatch(bundle.state) ? 1 : 0;
    this.deadline.reset();
    this.resetRows(count);
    this.supportStatus = SUPPORT_STATUS.NONE;
    this.rootSlack = 0;
    this.active = 0;
    this.continuationRequired = 0;
    if (!bundle || !bundle.state || !bundle.hazard || count < 1) {
      this.supportStatus = SUPPORT_STATUS.INCOMPLETE;
      return this.supportStatus;
    }
    if (!this.bindCommitted(bundle.state)) {
      this.supportStatus = SUPPORT_STATUS.INCOMPLETE;
      return this.supportStatus;
    }
    if (this.committedEntityCount === 0) return this.supportStatus;

    this.deadline.solve(bundle, 0);
    this.rootSlack = this.deadline.slack;
    if (this.deadline.proofStatus === DEADLINE_PROOF.INCOMPLETE) {
      this.supportStatus = SUPPORT_STATUS.INCOMPLETE;
      return this.supportStatus;
    }

    this.supportStatus = SUPPORT_STATUS.COMPLETE;
    this.deadline.evaluateProjectedSuccessors(bundle, projectedCell,
      projectedDirection, count, this.successorOutput);
    if (this.chanceComplete && chanceSupport) {
      this.deadline.mergeChanceSuccessors(bundle, count,
        chanceSupport.chanceSupportCount, chanceSupport.chanceFatalSupportCount,
        chanceSupport.chanceIncompleteSupportCount, chanceSupport.chanceCell,
        chanceSupport.chanceDirection, SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES,
        this.successorOutput);
      this.chanceMergeCount += 1;
    }
    this.successorSlabFillCount += 1;
    let unknownCount = 0;
    for (let row = 0; row < count; row += 1) {
      this.evaluatedCount += 1;
      if (hardStatus[row] === HARD_STATUS.REJECT_PROVEN ||
          hardStatus[row] === HARD_STATUS.REJECT_POLICY) continue;
      if (this.successorProof[row] === SUCCESSOR_PROOF.PROVEN_VIABLE) {
        this.member[row] = 1;
        this.postViable[row] = 1;
        this.firstActionCount += 1;
      } else if (this.successorProof[row] === SUCCESSOR_PROOF.UNKNOWN) unknownCount += 1;
    }
    this.chanceMixedRowCount += unknownCount;
    if (this.firstActionCount === 0) this.supportStatus = unknownCount > 0 ?
      SUPPORT_STATUS.INCOMPLETE : SUPPORT_STATUS.TRAPPED;
    this.successorQualityReady = this.supportStatus === SUPPORT_STATUS.COMPLETE ? 1 : 0;
    this.active = this.supportStatus === SUPPORT_STATUS.COMPLETE ? 1 : 0;
    this.continuationRequired = continuing &&
      this.supportStatus === SUPPORT_STATUS.COMPLETE ? 1 : 0;
    return this.supportStatus;
  }

  // Legacy call shape retained only so old diagnostics fail semantically, not
  // with an ABI exception. New production and UT call evaluateCommitted.
  evaluate(bundle, actions, arguments_, count, hardStatus, projectedCell,
      projectedDirection) {
    return this.evaluateCommitted(bundle, actions, arguments_, projectedCell,
      projectedDirection, hardStatus, count, null);
  }

  publishSuccessorQuality(controller, count) {
    if (!controller || !controller.outcome ||
        this.supportStatus !== SUPPORT_STATUS.COMPLETE) return 0;
    const outcome = controller.outcome;
    for (let row = 0; row < count; row += 1) {
      outcome.escapeSuccessorProof[row] = this.successorProof[row];
      outcome.escapeSuccessorExposed[row] = this.successorExposed[row];
      outcome.escapeSuccessorSlack[row] = this.successorSlack[row];
      outcome.escapeSuccessorBranches[row] = this.successorBranches[row];
      outcome.escapeSuccessorCoverage[row] = this.successorCoverage[row];
    }
    outcome.escapeSuccessorReady = 1;
    return 1;
  }

  // Diagnostic-only bridge from a complete committed ChanceOutcome mass DP
  // into Risk. It does not change Safety or Hard and remains distinct from a
  // future EnemyAction estimate.
  publishChanceRisk(controller, count) {
    if (!this.chanceSurvivalMass || !controller || !controller.outcome ||
        this.committedEntityCount === 0 ||
        (this.supportStatus !== SUPPORT_STATUS.COMPLETE &&
         this.supportStatus !== SUPPORT_STATUS.INCOMPLETE &&
         this.supportStatus !== SUPPORT_STATUS.TRAPPED)) return 0;
    const outcome = controller.outcome; let published = 0;
    for (let row = 0; row < count; row += 1) {
      if (!this.successorCoverage[row]) continue;
      outcome.committedChanceFatalMass[row] =
        10000 - this.successorSurvivalMass[row];
      published += 1;
    }
    return published;
  }

  restrictRiskController(controller, state, count) {
    if (!controller || !state || this.supportStatus !== SUPPORT_STATUS.COMPLETE ||
        this.firstActionCount === 0 || this.firstActionCount >= count) return 0;
    const outcome = controller.outcome;
    let intersection = 0;
    for (let row = 0; row < count; row += 1)
      if (outcome.acceptable[row] && (this.member[row] ||
          (this.chanceComplete &&
           this.successorProof[row] === SUCCESSOR_PROOF.UNKNOWN &&
           this.successorCoverage[row]))) intersection += 1;

    if (intersection === 0) {
      // Risk rejected every committed-viable successor.  This is an
      // emergency selection, not permission to revive the whole EO set: a
      // member can still carry a strictly worse Information/Safety outcome
      // than another member (for example, known immediate death versus an
      // unknown future threat).  Pick the same lexicographically least-risk
      // row that Risk would use on its normal no-acceptable path, restricted
      // to complete, Hard-allowed committed survivors.
      let selected = -1;
      for (let row = 0; row < count; row += 1) {
        if (!this.member[row] || outcome.hard[row] === HARD_STATUS.REJECT_PROVEN ||
            outcome.hard[row] === HARD_STATUS.REJECT_POLICY) continue;
        if (selected < 0 || controller.emergencyRiskLess(row, selected))
          selected = row;
      }
      // Committed escape owns membership on complete support.  An action that
      // passed ordinary Risk but is not a committed survivor cannot remain in
      // the restored set.
      outcome.acceptable.fill(0, 0, count);
      controller.acceptableCount = 0;
      if (selected >= 0) {
        outcome.acceptable[selected] = 1;
        controller.acceptableCount = 1;
        controller.noAcceptableAction = 0;
        controller.recomputeSelectionFrontier();
        this.rescueOverrideCount += 1;
        this.restrictedSelectionCount += 1;
        return 1;
      }
      controller.noAcceptableAction = 1;
      controller.recomputeSelectionFrontier();
      return 0;
    }

    let removed = 0;
    for (let row = 0; row < count; row += 1)
      if (outcome.acceptable[row] && !this.member[row] &&
          !(this.chanceComplete &&
            this.successorProof[row] === SUCCESSOR_PROOF.UNKNOWN &&
            this.successorCoverage[row])) {
        outcome.acceptable[row] = 0;
        controller.acceptableCount -= 1;
        removed += 1;
      }
    if (removed) {
      controller.recomputeSelectionFrontier();
      this.restrictedSelectionCount += 1;
    }
    return removed;
  }

  // GR0 explicitly forbids EscapeObligation from manufacturing Safety mass.
  applyToSafety() { return 0; }

  betterStrictRescue(left, right) {
    if (right < 0) return 1;
    if (this.successorExposed[left] !== this.successorExposed[right])
      return this.successorExposed[left] < this.successorExposed[right] ? 1 : 0;
    if (this.successorSlack[left] !== this.successorSlack[right])
      return this.successorSlack[left] > this.successorSlack[right] ? 1 : 0;
    if (this.successorBranches[left] !== this.successorBranches[right])
      return this.successorBranches[left] > this.successorBranches[right] ? 1 : 0;
    if (this.successorCoverage[left] !== this.successorCoverage[right])
      return this.successorCoverage[left] > this.successorCoverage[right] ? 1 : 0;
    return left < right ? 1 : 0;
  }

  // Final-only rescue is deliberately narrower than Risk membership. It may
  // replace an already selected action only when one complete committed
  // closure proves that action dead and proves a Hard-allowed alternative
  // viable. UNKNOWN, possible projectiles and future FIRE never reach here.
  strictRescueCandidate(preferred, hardStatus, count) {
    this.strictRescueCheckCount += 1;
    if (this.supportStatus !== SUPPORT_STATUS.COMPLETE || preferred < 0 ||
        preferred >= count || !hardStatus ||
        this.successorProof[preferred] !== SUCCESSOR_PROOF.PROVEN_DEAD) return -1;
    this.strictRescueDeadPreferredCount += 1;
    let selected = -1;
    for (let row = 0; row < count; row += 1) {
      if (!this.member[row] ||
          this.successorProof[row] !== SUCCESSOR_PROOF.PROVEN_VIABLE ||
          hardStatus[row] !== HARD_STATUS.ALLOW) continue;
      if (this.betterStrictRescue(row, selected)) selected = row;
    }
    if (selected >= 0) this.strictRescueCandidateCount += 1;
    return selected;
  }

  confirmStrictRescue() {
    this.strictRescueOverrideCount += 1;
  }

  rejectStrictRescueFinalHard() {
    this.strictRescueFinalRejectCount += 1;
  }

  betterPersistentEscape(left, right) {
    if (right < 0) return 1;
    if (this.chanceSurvivalMass &&
        this.successorSurvivalMass[left] !== this.successorSurvivalMass[right])
      return this.successorSurvivalMass[left] >
        this.successorSurvivalMass[right] ? 1 : 0;
    if (this.successorExposed[left] !== this.successorExposed[right])
      return this.successorExposed[left] < this.successorExposed[right] ? 1 : 0;
    if (this.successorSlack[left] !== this.successorSlack[right])
      return this.successorSlack[left] > this.successorSlack[right] ? 1 : 0;
    if (this.successorBranches[left] !== this.successorBranches[right])
      return this.successorBranches[left] > this.successorBranches[right] ? 1 : 0;
    return left < right ? 1 : 0;
  }

  // A prior selected escape member creates a cross-frame obligation for the
  // same physical entities. It may override only with a strictly better,
  // Hard-allowed, fully proven committed successor. Soft/possible threats do
  // not create this continuation and strict ForcedWin remains above it.
  persistentEscapeCandidate(preferred, hardStatus, count) {
    this.persistentCheckCount += 1;
    if (!this.continuationRequired ||
        this.supportStatus !== SUPPORT_STATUS.COMPLETE || !hardStatus) return -1;
    let selected = -1;
    for (let row = 0; row < count; row += 1) {
      if (!this.member[row] ||
          this.successorProof[row] !== SUCCESSOR_PROOF.PROVEN_VIABLE ||
          !this.successorCoverage[row] || hardStatus[row] !== HARD_STATUS.ALLOW) continue;
      if (this.betterPersistentEscape(row, selected)) selected = row;
    }
    if (selected < 0 || selected === preferred) return -1;
    if (preferred >= 0 && preferred < count && this.member[preferred] &&
        this.successorProof[preferred] === SUCCESSOR_PROOF.PROVEN_VIABLE &&
        this.successorCoverage[preferred] && hardStatus[preferred] === HARD_STATUS.ALLOW &&
        !this.betterPersistentEscape(selected, preferred)) return -1;
    this.persistentCandidateCount += 1;
    return selected;
  }

  confirmPersistentEscape() { this.persistentOverrideCount += 1; }
  rejectPersistentEscapeFinalHard() { this.persistentFinalRejectCount += 1; }

  activateAfterSelection(selectedIndex) {
    if (this.supportStatus !== SUPPORT_STATUS.COMPLETE ||
        selectedIndex < 0 || !this.member[selectedIndex] ||
        !this.successorExposed[selectedIndex]) {
      this.active = 0;
      return 0;
    }
    this.active = 1;
    this.activateCount += 1;
    return 1;
  }
}

module.exports = { EscapeObligation, ENTITY_BOMB, ENTITY_PROJECTILE,
  SUPPORT_STATUS, SUCCESSOR_PROOF };
