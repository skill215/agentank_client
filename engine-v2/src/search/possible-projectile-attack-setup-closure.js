"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { NONE_FRAME } = require("../abi/fast-codes");
const { OPTION_KIND } = require("../policy/option-portfolio");
const { TWO_STAGE_SETUP_STATUS, TwoStageAttackSetupShadow } =
  require("./two-stage-attack-setup-shadow");

const POSSIBLE_SETUP_STATUS = Object.freeze({
  NONE: 0,
  ROBUST_CERTIFIED: 1,
  INCOMPLETE: 2,
  REJECTED: 3
});

const POSSIBLE_SETUP_REASON = Object.freeze({
  NONE: 0,
  SUPPORT: 1 << 0,
  PROJECTILE_COUNT: 1 << 1,
  PROJECTILE_OWNER: 1 << 2,
  INJECTION: 1 << 3,
  PRESENT_WORLD_REJECTED: 1 << 4,
  PRESENT_WORLD_INCOMPLETE: 1 << 5,
  ROOT_RESTORE: 1 << 6,
  CADENCE_SUPPORT: 1 << 7
});

// A certificate-specific InformationState closure. The absence world is the
// already-certified physical row. This service injects the single possible
// projectile as a committed entity and requires the exact same setup action
// and FIRE continuation to survive and preserve attack pressure there too.
// It is deliberately stronger than observation-split policy: no world gets a
// different second action.
class PossibleProjectileAttackSetupClosure {
  constructor(maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS, nodeBudget = 1024) {
    this.maxActions = maxActions;
    this.status = new Uint8Array(maxActions);
    this.reason = new Uint8Array(maxActions);
    this.presentRootBranches = new Uint16Array(maxActions);
    this.presentSecondBranches = new Uint16Array(maxActions);
    this.presentDoomedColumns = new Uint16Array(maxActions);
    this.presentConstrainedColumns = new Uint16Array(maxActions);
    this.presentUncoveredColumns = new Uint16Array(maxActions);
    this.present = new TwoStageAttackSetupShadow(maxActions, nodeBudget);
    this.count = 0;
    this.evaluationCount = 0;
    this.certifiedCount = 0;
    this.rejectedCount = 0;
    this.incompleteCount = 0;
    this.rootRestoreFailures = 0;
    this.cadenceRephaseCount = 0;
    this.hotAllocationCount = 0;
  }

  reset(count) {
    this.count = count;
    this.status.fill(POSSIBLE_SETUP_STATUS.NONE, 0, count);
    this.reason.fill(POSSIBLE_SETUP_REASON.NONE, 0, count);
    this.presentRootBranches.fill(0, 0, count);
    this.presentSecondBranches.fill(0, 0, count);
    this.presentDoomedColumns.fill(0, 0, count);
    this.presentConstrainedColumns.fill(0, 0, count);
    this.presentUncoveredColumns.fill(0, 0, count);
    this.present.reset(count);
  }

  incomplete(row, reason) {
    this.status[row] = POSSIBLE_SETUP_STATUS.INCOMPLETE;
    this.reason[row] = reason;
    this.incompleteCount += 1;
    return 0;
  }

  evaluateRow(bundle, row, ourActions, ourArguments, enemyActions,
      enemyArguments, enemyCount, possibleProjectiles, supportComplete,
      cadenceRephase = 0, enemyCanAct = 0) {
    this.evaluationCount += 1;
    if (!supportComplete || !bundle || !possibleProjectiles ||
        !possibleProjectiles.pool || !possibleProjectiles.pool.complete)
      return this.incomplete(row, POSSIBLE_SETUP_REASON.SUPPORT);
    if (possibleProjectiles.count() !== 1)
      return this.incomplete(row, POSSIBLE_SETUP_REASON.PROJECTILE_COUNT);
    const pool = possibleProjectiles.pool;
    let slot = -1;
    for (let index = 0; index < pool.active.length; index += 1)
      if (pool.active[index]) { slot = index; break; }
    if (slot < 0) return this.incomplete(row, POSSIBLE_SETUP_REASON.PROJECTILE_COUNT);
    if (pool.owner[slot] === 0)
      return this.incomplete(row, POSSIBLE_SETUP_REASON.PROJECTILE_OWNER);

    const state = bundle.state; const kernel = bundle.kernel;
    const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    const transitionDeltaBase = state.transitionDeltaBase;
    const transitionEventBase = state.transitionEventBase;
    const kernelFailure = kernel.failure; const kernelLastMark = kernel.lastMark;
    const mark = state.beginTransition(); kernel.failure = 0;
    const group = pool.group[slot] || pool.id[slot];
    let reason = 0;
    if (cadenceRephase) {
      const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
      const until = a[ARRAY.TANK_POISON_UNTIL][1];
      const applied = a[ARRAY.TANK_POISON_APPLIED][1];
      const phaseAnchor = frame - (enemyCanAct ? 0 : 1);
      if (until === NONE_FRAME || until <= frame || applied === NONE_FRAME || phaseAnchor < 0 ||
          !kernel.set(ARRAY.TANK_POISON_APPLIED, 1, phaseAnchor))
        reason = POSSIBLE_SETUP_REASON.CADENCE_SUPPORT;
      else this.cadenceRephaseCount += 1;
    }
    if (!reason && !kernel.allocateProjectile(pool.owner[slot], pool.cell[slot],
        pool.direction[slot], group, pool.member[slot]))
      reason = POSSIBLE_SETUP_REASON.INJECTION;
    else if (!reason) {
      this.present.evaluateCandidate(bundle, row, OPTION_KIND.ATTACK_SETUP,
        ourActions, ourArguments,
        enemyActions, enemyArguments, enemyCount);
      this.presentRootBranches[row] = this.present.rootBranches[row];
      this.presentSecondBranches[row] = this.present.secondBranches[row];
      this.presentDoomedColumns[row] = this.present.doomedColumns[row];
      this.presentConstrainedColumns[row] = this.present.constrainedColumns[row];
      this.presentUncoveredColumns[row] = this.present.uncoveredColumns[row];
      if (this.present.status[row] === TWO_STAGE_SETUP_STATUS.INCOMPLETE)
        reason = POSSIBLE_SETUP_REASON.PRESENT_WORLD_INCOMPLETE;
      else if (this.present.status[row] !== TWO_STAGE_SETUP_STATUS.CERTIFIED)
        reason = POSSIBLE_SETUP_REASON.PRESENT_WORLD_REJECTED;
    }
    state.undoTo(mark);
    state.transitionDeltaBase = transitionDeltaBase;
    state.transitionEventBase = transitionEventBase;
    kernel.failure = kernelFailure; kernel.lastMark = kernelLastMark;
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== rootMark) {
      state.undoTo(rootMark);
      reason |= POSSIBLE_SETUP_REASON.ROOT_RESTORE;
      this.rootRestoreFailures += 1;
    }
    this.reason[row] = reason;
    if (reason & (POSSIBLE_SETUP_REASON.SUPPORT |
        POSSIBLE_SETUP_REASON.PROJECTILE_COUNT |
        POSSIBLE_SETUP_REASON.PROJECTILE_OWNER |
        POSSIBLE_SETUP_REASON.INJECTION |
        POSSIBLE_SETUP_REASON.PRESENT_WORLD_INCOMPLETE |
        POSSIBLE_SETUP_REASON.CADENCE_SUPPORT |
        POSSIBLE_SETUP_REASON.ROOT_RESTORE))
      return this.incomplete(row, reason);
    if (reason) {
      this.status[row] = POSSIBLE_SETUP_STATUS.REJECTED;
      this.rejectedCount += 1;
      return 0;
    }
    this.status[row] = POSSIBLE_SETUP_STATUS.ROBUST_CERTIFIED;
    this.certifiedCount += 1;
    return 1;
  }

  summary() {
    return {
      evaluationCount: this.evaluationCount,
      certifiedCount: this.certifiedCount,
      rejectedCount: this.rejectedCount,
      incompleteCount: this.incompleteCount,
      rootRestoreFailures: this.rootRestoreFailures,
      cadenceRephaseCount: this.cadenceRephaseCount,
      presentNodeCount: this.present.nodeCount,
      maximumPresentNodes: this.present.maximumNodes,
      hotAllocationCount: this.hotAllocationCount + this.present.hotAllocationCount
    };
  }
}

module.exports = { POSSIBLE_SETUP_STATUS, POSSIBLE_SETUP_REASON,
  PossibleProjectileAttackSetupClosure };
