"use strict";

// Behavior-neutral event-triggered sequence generator.  It reuses the existing
// TwoStageAttackSetupShadow to ask a narrow common-policy question on CURRENT:
// can one qualified setup primitive be followed by the same FIRE after every
// supported enemy first response, with complete second-response support?

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND } = require("../../../engine-v2/src/policy/option-portfolio");
const { TWO_STAGE_SETUP_STATUS, TwoStageAttackSetupShadow } = require(
  "../../../engine-v2/src/search/two-stage-attack-setup-shadow");

class AttackSequenceGeneratorShadow {
  constructor(interval, ledger, closure = null, nodeBudget = 1024) {
    this.interval = interval; this.ledger = ledger;
    this.closure = closure || new TwoStageAttackSetupShadow(
      SEARCH_CAPACITY.MAX_OUR_ACTIONS, nodeBudget);
    this.seenRow = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.candidateByAction = new Uint32Array(256);
    this.certifiedByAction = new Uint32Array(256);
    this.observationCount = 0; this.eventEvaluationCount = 0;
    this.duplicateSkipCount = 0; this.noSetupCandidateCount = 0;
    this.candidateRowCount = 0; this.certifiedRowCount = 0;
    this.rejectedRowCount = 0; this.incompleteRowCount = 0;
    this.rootWithCertificateCount = 0; this.multipleCertificateRootCount = 0;
    this.lastEvaluationSerial = 0; this.lastCertifiedRow = -1;
    this.hotAllocationCount = 0;
  }

  setupPrimitive(action) {
    return action === ACTION.GO || action === ACTION.TURN_LEFT ||
      action === ACTION.TURN_RIGHT ? 1 : 0;
  }

  observe(engine) {
    this.observationCount += 1;
    if (!this.interval ||
        this.interval.evaluationSerial === this.lastEvaluationSerial) {
      this.duplicateSkipCount += 1; return;
    }
    this.lastEvaluationSerial = this.interval.evaluationSerial;
    if (!engine || !engine.adapter || !engine.adapter.bundle) return;
    this.eventEvaluationCount += 1; this.lastCertifiedRow = -1;
    this.seenRow.fill(0, 0, engine.ourCount);
    this.closure.reset(engine.ourCount);
    const risk = engine.riskController && engine.riskController.outcome;
    let candidates = 0; let certificates = 0;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (this.seenRow[row] || engine.hardStatus[row] !== HARD_STATUS.ALLOW ||
          !risk || row >= risk.count || !risk.acceptable[row] ||
          risk.dominated[row] || !this.setupPrimitive(engine.ourActions[row])) continue;
      this.seenRow[row] = 1; candidates += 1; this.candidateRowCount += 1;
      this.candidateByAction[engine.ourActions[row]] += 1;
      const certified = this.closure.evaluateCandidate(engine.adapter.bundle, row,
        OPTION_KIND.ATTACK_SETUP, engine.ourActions, engine.ourArguments,
        engine.enemyActions, engine.enemyArguments, engine.enemyCount);
      const status = this.closure.status[row];
      if (certified && status === TWO_STAGE_SETUP_STATUS.CERTIFIED) {
        certificates += 1; this.certifiedRowCount += 1;
        this.certifiedByAction[engine.ourActions[row]] += 1;
        if (this.lastCertifiedRow < 0) this.lastCertifiedRow = row;
      } else if (status === TWO_STAGE_SETUP_STATUS.INCOMPLETE)
        this.incompleteRowCount += 1;
      else this.rejectedRowCount += 1;
    }
    if (!candidates) this.noSetupCandidateCount += 1;
    if (certificates) this.rootWithCertificateCount += 1;
    if (certificates > 1) this.multipleCertificateRootCount += 1;
  }

  sparseActions(values) {
    const output = {};
    for (let action = 0; action < values.length; action += 1)
      if (values[action]) output[action] = values[action];
    return output;
  }

  summary() {
    const closure = this.closure.summary();
    return { enabled: true, behaviorNeutral: true, commonPolicySequence: true,
      observationCount: this.observationCount,
      eventEvaluationCount: this.eventEvaluationCount,
      duplicateSkipCount: this.duplicateSkipCount,
      noSetupCandidateCount: this.noSetupCandidateCount,
      candidateRowCount: this.candidateRowCount,
      certifiedRowCount: this.certifiedRowCount,
      rejectedRowCount: this.rejectedRowCount,
      incompleteRowCount: this.incompleteRowCount,
      rootWithCertificateCount: this.rootWithCertificateCount,
      multipleCertificateRootCount: this.multipleCertificateRootCount,
      lastEvaluationSerial: this.lastEvaluationSerial,
      lastCertifiedRow: this.lastCertifiedRow,
      candidateByAction: this.sparseActions(this.candidateByAction),
      certifiedByAction: this.sparseActions(this.certifiedByAction),
      closure,
      hotAllocationCount: this.hotAllocationCount + closure.hotAllocationCount };
  }
}

module.exports = { AttackSequenceGeneratorShadow };
