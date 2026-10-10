"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ACTION } = require("../abi/fast-codes");
const { OPTION_KIND } = require("../policy/option-portfolio");
const { PAC_STATUS, PAC_CELL } = require("./projectile-attack-closure");
const { SUPPORT_STATUS, SUCCESSOR_PROOF } = require("../runtime/escape-obligation");
const { TWO_STAGE_SETUP_STATUS, TwoStageAttackSetupShadow } =
  require("./two-stage-attack-setup-shadow");
const { PossibleProjectileAttackSetupClosure } =
  require("./possible-projectile-attack-setup-closure");

const ATTACK_SETUP_CERTIFICATE = Object.freeze({
  NONE: 0,
  CERTIFIED: 1,
  INCOMPLETE: 2,
  REJECTED: 3
});

const ATTACK_SETUP_REASON = Object.freeze({
  NONE: 0,
  NOT_SETUP: 1 << 0,
  INTERVAL_INCOMPLETE: 1 << 1,
  PAC_INCOMPLETE: 1 << 2,
  UNKNOWN_COLUMN: 1 << 3,
  NO_DEADLINE: 1 << 4,
  NO_ESCAPE: 1 << 5,
  EXPOSURE_REGRESSION: 1 << 6,
  RISK_REGRESSION: 1 << 7,
  NONLOSS_REGRESSION: 1 << 8,
  UNCONSTRAINED_COLUMN: 1 << 9,
  NO_HIT_PROGRESS: 1 << 10,
  COMMITTED_SUPPORT: 1 << 11
});

// A certificate over the already event-driven projectile horizon. PAC follows
// every emitted projectile to hit or normative invalidation and publishes one
// cell per enemy root response. This layer does not add another Minimax stack:
// it decides whether that complete response matrix is strong enough to let an
// ATTACK_SETUP Option own the current action.
class AttackSetupClosure {
  constructor(maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS, options = null) {
    this.status = new Uint8Array(maxActions);
    this.reason = new Uint16Array(maxActions);
    this.hitDeadline = new Uint8Array(maxActions);
    this.doomedColumns = new Uint8Array(maxActions);
    this.constrainedColumns = new Uint8Array(maxActions);
    this.uncoveredColumns = new Uint8Array(maxActions);
    this.escapeBranches = new Uint8Array(maxActions);
    this.counterExposure = new Uint16Array(maxActions);
    this.robustDelta = new Int16Array(maxActions);
    this.count = 0; this.incumbentRow = -1;
    this.evaluationCount = 0; this.certifiedCount = 0;
    this.rejectedCount = 0; this.incompleteCount = 0;
    this.hotAllocationCount = 0;
    this.twoStageOwnership = options && options.twoStageOwnership ? 1 : 0;
    this.twoStage = options && options.twoStageShadow ?
      new TwoStageAttackSetupShadow(maxActions) : null;
    this.possibleProjectile = options && options.possibleProjectileShadow ?
      new PossibleProjectileAttackSetupClosure(maxActions) : null;
  }

  reset(count, incumbentRow) {
    this.count = count; this.incumbentRow = incumbentRow;
    this.status.fill(ATTACK_SETUP_CERTIFICATE.NONE, 0, count);
    this.reason.fill(ATTACK_SETUP_REASON.NONE, 0, count);
    this.hitDeadline.fill(0xff, 0, count);
    this.doomedColumns.fill(0, 0, count);
    this.constrainedColumns.fill(0, 0, count);
    this.uncoveredColumns.fill(0, 0, count);
    this.escapeBranches.fill(0, 0, count);
    this.counterExposure.fill(0, 0, count);
    this.robustDelta.fill(0, 0, count);
    if (this.twoStage) this.twoStage.reset(count);
    if (this.possibleProjectile) this.possibleProjectile.reset(count);
  }

  scanTwoStageFrontier(bundle, ourActions, ourArguments, count,
      enemyActions, enemyArguments, enemyCount) {
    if (!this.twoStage || !bundle || !ourActions || !enemyActions) return 0;
    let evaluated = 0;
    for (let row = 0; row < count; row += 1) {
      const action = ourActions[row];
      if (action !== ACTION.GO && action !== ACTION.TURN_LEFT &&
          action !== ACTION.TURN_RIGHT) continue;
      this.twoStage.evaluateCandidate(bundle, row, OPTION_KIND.ATTACK_SETUP,
        ourActions, ourArguments, enemyActions, enemyArguments, enemyCount);
      evaluated += 1;
    }
    return evaluated;
  }

  allowsOwnership(row, immediateCertificate) {
    if (!this.twoStageOwnership) return immediateCertificate ? 1 : 0;
    return this.twoStage && this.twoStage.status[row] ===
      TWO_STAGE_SETUP_STATUS.CERTIFIED ? 1 : 0;
  }

  scanPossibleProjectileFrontier(bundle, ourActions, ourArguments, count,
      enemyActions, enemyArguments, enemyCount, possibleProjectiles,
      supportComplete, cadenceRephase = 0, enemyCanAct = 0) {
    if (!this.possibleProjectile || !this.twoStage) return 0;
    if (!possibleProjectiles || possibleProjectiles.count() === 0) return 0;
    let evaluated = 0;
    for (let row = 0; row < count; row += 1) {
      if (this.twoStage.status[row] !== TWO_STAGE_SETUP_STATUS.CERTIFIED) continue;
      this.possibleProjectile.evaluateRow(bundle, row, ourActions, ourArguments,
        enemyActions, enemyArguments, enemyCount, possibleProjectiles,
        supportComplete, cadenceRephase, enemyCanAct);
      evaluated += 1;
    }
    return evaluated;
  }

  evaluateRow(row, kind, intervalExact, outcome, combat, pac, enemyCount, escape,
      bundle = null, ourActions = null, ourArguments = null,
      rootEnemyActions = null, rootEnemyArguments = null, rootEnemyCount = 0) {
    this.evaluationCount += 1;
    if (kind !== OPTION_KIND.ATTACK_SETUP) {
      this.reason[row] = ATTACK_SETUP_REASON.NOT_SETUP; return 0;
    }
    let reason = 0; let incomplete = 0;
    if (!intervalExact) { reason |= ATTACK_SETUP_REASON.INTERVAL_INCOMPLETE; incomplete = 1; }
    if (!combat || !pac || combat.attackClosureStatus[row] !== PAC_STATUS.COMPLETE ||
        pac.status[row] !== PAC_STATUS.COMPLETE) {
      reason |= ATTACK_SETUP_REASON.PAC_INCOMPLETE; incomplete = 1;
    }
    if (combat && combat.enemyUnknownFirstActions[row] > 0) {
      reason |= ATTACK_SETUP_REASON.UNKNOWN_COLUMN; incomplete = 1;
    }
    const incumbent = this.incumbentRow;
    if (combat) {
      this.hitDeadline[row] = combat.hitDeadline[row];
      this.escapeBranches[row] = combat.postFireEscape[row];
      this.counterExposure[row] = combat.ownCounterExposure[row];
      if (combat.hitDeadline[row] === 0xff) reason |= ATTACK_SETUP_REASON.NO_DEADLINE;
      if (!combat.postFireEscape[row]) reason |= ATTACK_SETUP_REASON.NO_ESCAPE;
      if (incumbent >= 0 &&
          combat.ownCounterExposure[row] > combat.ownCounterExposure[incumbent])
        reason |= ATTACK_SETUP_REASON.EXPOSURE_REGRESSION;
    }
    if (outcome && incumbent >= 0) {
      const riskWorse = outcome.immediateFatalMass[row] > outcome.immediateFatalMass[incumbent] ||
        outcome.horizonFatalMass[row] > outcome.horizonFatalMass[incumbent] ||
        outcome.unknownMass[row] > outcome.unknownMass[incumbent] ||
        outcome.escapeSlack[row] < outcome.escapeSlack[incumbent];
      if (riskWorse) reason |= ATTACK_SETUP_REASON.RISK_REGRESSION;
      const delta = outcome.robustLower[row] - outcome.robustLower[incumbent];
      this.robustDelta[row] = Math.max(-32768, Math.min(32767, delta));
      if (delta < 0) reason |= ATTACK_SETUP_REASON.NONLOSS_REGRESSION;
    }
    if (escape && escape.committedEntityCount > 0) {
      if (escape.supportStatus !== SUPPORT_STATUS.COMPLETE) {
        reason |= ATTACK_SETUP_REASON.COMMITTED_SUPPORT; incomplete = 1;
      } else if (!escape.member[row] ||
          escape.successorProof[row] !== SUCCESSOR_PROOF.PROVEN_VIABLE)
        reason |= ATTACK_SETUP_REASON.COMMITTED_SUPPORT;
    }
    let doomed = 0; let constrained = 0; let uncovered = 0;
    if (pac && enemyCount > 0) {
      for (let column = 0; column < enemyCount; column += 1) {
        const at = row * pac.maxEnemy + column;
        if (pac.cellStatus[at] === PAC_CELL.PROVEN_DOOMED) { doomed += 1; continue; }
        if (pac.cellStatus[at] === PAC_CELL.SURVIVES &&
            (pac.cellSetupDelay[at] > 0 || pac.cellMobilityLoss[at] > 0 ||
             pac.cellEndpointReduction[at] > 0)) { constrained += 1; continue; }
        uncovered += 1;
      }
    } else { uncovered = enemyCount; incomplete = 1; }
    this.doomedColumns[row] = doomed;
    this.constrainedColumns[row] = constrained;
    this.uncoveredColumns[row] = uncovered;
    if (uncovered) reason |= ATTACK_SETUP_REASON.UNCONSTRAINED_COLUMN;
    // Setup ownership needs a real hit branch. Pure posture/zone pressure is
    // useful ordering evidence but cannot replace navigation robustly.
    if (!doomed) reason |= ATTACK_SETUP_REASON.NO_HIT_PROGRESS;
    this.reason[row] = reason;
    if (incomplete) {
      this.status[row] = ATTACK_SETUP_CERTIFICATE.INCOMPLETE;
      this.incompleteCount += 1; return 0;
    }
    if (reason) {
      this.status[row] = ATTACK_SETUP_CERTIFICATE.REJECTED;
      this.rejectedCount += 1; return 0;
    }
    this.status[row] = ATTACK_SETUP_CERTIFICATE.CERTIFIED;
    this.certifiedCount += 1; return 1;
  }

  summary() {
    return { evaluationCount: this.evaluationCount,
      certifiedCount: this.certifiedCount, rejectedCount: this.rejectedCount,
      incompleteCount: this.incompleteCount, hotAllocationCount: this.hotAllocationCount,
      twoStageOwnership: Boolean(this.twoStageOwnership),
      twoStage: this.twoStage ? this.twoStage.summary() : null,
      possibleProjectile: this.possibleProjectile ?
        this.possibleProjectile.summary() : null };
  }
}

module.exports = { ATTACK_SETUP_CERTIFICATE, ATTACK_SETUP_REASON, AttackSetupClosure };
