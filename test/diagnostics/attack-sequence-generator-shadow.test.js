"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND } = require("../../engine-v2/src/policy/option-portfolio");
const { TWO_STAGE_SETUP_STATUS } = require(
  "../../engine-v2/src/search/two-stage-attack-setup-shadow");
const { AttackSequenceGeneratorShadow } = require(
  "../../tools/agentank/diagnostics/attack-sequence-generator-shadow");

class FakeClosure {
  constructor() {
    this.status = new Uint8Array(4); this.calls = 0;
    this.hotAllocationCount = 0;
  }
  reset(count) { this.status.fill(0, 0, count); }
  evaluateCandidate(_bundle, row) {
    this.calls += 1;
    this.status[row] = row === 1 ? TWO_STAGE_SETUP_STATUS.CERTIFIED :
      TWO_STAGE_SETUP_STATUS.REJECTED;
    return row === 1 ? 1 : 0;
  }
  summary() { return { nodeCount: this.calls * 3, maximumNodes: 3,
    rootRestoreFailures: 0, reasonBitCounts: [], hotAllocationCount: 0 }; }
}

function fixture() {
  const interval = { evaluationSerial: 1 };
  const ledger = {};
  const engine = { adapter: { bundle: {} }, ourCount: 3, enemyCount: 1,
    ourActions: Uint8Array.from([ACTION.FIRE, ACTION.TURN_LEFT, ACTION.GO]),
    ourArguments: new Uint16Array(3), enemyActions: Uint8Array.from([ACTION.NONE]),
    enemyArguments: new Uint16Array(1),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW,
      HARD_STATUS.ALLOW]),
    riskController: { outcome: { count: 3,
      acceptable: Uint8Array.from([1, 1, 1]), dominated: new Uint8Array(3) } },
    optionPortfolio: { count: 3,
      primitiveRow: Uint8Array.from([0, 1, 2]),
      kind: Uint8Array.from([OPTION_KIND.DIRECT_KILL, OPTION_KIND.ATTACK_SETUP,
        OPTION_KIND.ATTACK_SETUP]),
      supportComplete: Uint8Array.from([1, 1, 1]) } };
  return { interval, ledger, engine };
}

test("event-triggered sequence generator evaluates each qualified setup row once", () => {
  const built = fixture(); const closure = new FakeClosure();
  const shadow = new AttackSequenceGeneratorShadow(built.interval,
    built.ledger, closure);
  shadow.observe(built.engine); shadow.observe(built.engine);
  const summary = shadow.summary();
  assert.equal(closure.calls, 2);
  assert.equal(summary.eventEvaluationCount, 1);
  assert.equal(summary.duplicateSkipCount, 1);
  assert.equal(summary.candidateRowCount, 2);
  assert.equal(summary.certifiedRowCount, 1);
  assert.equal(summary.rootWithCertificateCount, 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("Hard, Risk and non-movement primitives never enter sequence search", () => {
  const built = fixture(); const closure = new FakeClosure();
  built.engine.hardStatus[1] = HARD_STATUS.REJECT_PROVEN;
  built.engine.riskController.outcome.dominated[2] = 1;
  const shadow = new AttackSequenceGeneratorShadow(built.interval,
    built.ledger, closure);
  shadow.observe(built.engine);
  const summary = shadow.summary();
  assert.equal(closure.calls, 0);
  assert.equal(summary.noSetupCandidateCount, 1);
  assert.equal(summary.certifiedRowCount, 0);
});
