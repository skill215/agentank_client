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
  constructor() {
    const maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    this.deadline = new DeadlineKernel();
    this.member = new Uint8Array(maxActions);
    this.successorProof = new Uint8Array(maxActions);
    this.successorExposed = new Uint8Array(maxActions);
    this.successorSlack = new Int8Array(maxActions);
    this.successorBranches = new Uint8Array(maxActions);
    this.successorCoverage = new Uint8Array(maxActions);
    // Compatibility aliases used by existing diagnostics while GR0 changes the
    // semantic owner from "heuristic first action" to committed membership.
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
    this.evaluatedCount = 0;
    this.restrictedSelectionCount = 0;
    this.rescueOverrideCount = 0;
    this.activateCount = 0;
    this.hotAllocationCount = 0;
  }

  resetRows(count) {
    this.member.fill(0, 0, count);
    this.postViable.fill(0, 0, count);
    this.successorProof.fill(SUCCESSOR_PROOF.PROVEN_DEAD, 0, count);
    this.successorExposed.fill(0, 0, count);
    this.successorSlack.fill(-128, 0, count);
    this.successorBranches.fill(0, 0, count);
    this.successorCoverage.fill(0, 0, count);
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
      hardStatus, count) {
    this.deadline.reset();
    this.resetRows(count);
    this.supportStatus = SUPPORT_STATUS.NONE;
    this.rootSlack = 0;
    this.active = 0;
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
    for (let row = 0; row < count; row += 1) {
      this.evaluatedCount += 1;
      if (hardStatus[row] === HARD_STATUS.REJECT_PROVEN ||
          hardStatus[row] === HARD_STATUS.REJECT_POLICY) continue;
      const quality = this.deadline.evaluateSuccessor(bundle,
        projectedCell[row], projectedDirection[row]);
      this.successorProof[row] = quality.proofStatus;
      this.successorExposed[row] = quality.stillExposedAtDeadline;
      this.successorSlack[row] = quality.slack;
      this.successorBranches[row] = quality.viableNextActionCount;
      this.successorCoverage[row] = quality.coverageComplete;
      if (quality.proofStatus === SUCCESSOR_PROOF.PROVEN_VIABLE) {
        this.member[row] = 1;
        this.postViable[row] = 1;
        this.firstActionCount += 1;
      }
    }
    this.successorQualityReady = this.supportStatus === SUPPORT_STATUS.COMPLETE ? 1 : 0;
    if (this.firstActionCount === 0) this.supportStatus = SUPPORT_STATUS.TRAPPED;
    this.active = this.supportStatus === SUPPORT_STATUS.COMPLETE ? 1 : 0;
    return this.supportStatus;
  }

  // Legacy call shape retained only so old diagnostics fail semantically, not
  // with an ABI exception. New production and UT call evaluateCommitted.
  evaluate(bundle, actions, arguments_, count, hardStatus, projectedCell,
      projectedDirection) {
    return this.evaluateCommitted(bundle, actions, arguments_, projectedCell,
      projectedDirection, hardStatus, count);
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

  restrictRiskController(controller, state, count) {
    if (!controller || !state || this.supportStatus !== SUPPORT_STATUS.COMPLETE ||
        this.firstActionCount === 0 || this.firstActionCount >= count) return 0;
    const outcome = controller.outcome;
    let intersection = 0;
    for (let row = 0; row < count; row += 1)
      if (outcome.acceptable[row] && this.member[row]) intersection += 1;

    if (intersection === 0) {
      let restored = 0;
      for (let row = 0; row < count; row += 1) {
        if (!this.member[row] || outcome.hard[row] === HARD_STATUS.REJECT_PROVEN ||
            outcome.hard[row] === HARD_STATUS.REJECT_POLICY) continue;
        if (!outcome.acceptable[row]) {
          outcome.acceptable[row] = 1;
          controller.acceptableCount += 1;
          restored += 1;
        }
      }
      if (restored) {
        controller.noAcceptableAction = 0;
        controller.recomputeSelectionFrontier();
        this.rescueOverrideCount += 1;
        this.restrictedSelectionCount += 1;
      }
      return restored;
    }

    let removed = 0;
    for (let row = 0; row < count; row += 1)
      if (outcome.acceptable[row] && !this.member[row]) {
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

  activateAfterSelection(selectedIndex) {
    if (this.supportStatus !== SUPPORT_STATUS.COMPLETE ||
        selectedIndex < 0 || !this.member[selectedIndex]) {
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
