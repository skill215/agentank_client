"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND } = require(
  "../../engine-v2/src/policy/option-portfolio");
const { LONG_OPTION } = require(
  "../../tools/agentank/diagnostics/event-driven-option-shadow");
const { EXECUTION_STATUS, StrategicTargetExecutionShadow } = require(
  "../../tools/agentank/diagnostics/strategic-target-execution-shadow");

function fixture() {
  const selectedRow = { value: 0 };
  const arbiter = {
    shadowTargetKind: LONG_OPTION.ATTACK,
    shadowTargetGeneration: 22,
    shadowTargetProposalOwned: 1,
    proposalTargetAdoptionCount: 1,
    releaseCounterfactual() {
      this.shadowTargetKind = LONG_OPTION.NONE;
      this.shadowTargetGeneration = 0;
      this.shadowTargetProposalOwned = 0;
    },
    ledger: { classifier: { selectedRow() { return selectedRow.value; } } }
  };
  const risk = {
    count: 3,
    acceptable: Uint8Array.from([1, 1, 1]),
    dominated: new Uint8Array(3),
    robustLower: Int16Array.from([50, 40, 60]),
    expectedValue: Int16Array.from([50, 40, 60])
  };
  const combat = {
    directKill: Uint8Array.from([0, 0, 1]),
    enemyDoomedFirstActions: Uint8Array.from([0, 1, 1]),
    enemyEndpointReduction: Uint8Array.from([1, 2, 2]),
    enemyMobilityLoss: Uint8Array.from([0, 1, 1]),
    purposeCompleteness: Uint16Array.from([5000, 5000, 5000]),
    ownCounterExposure: Uint16Array.from([0, 0, 0]),
    postFireEscape: Uint8Array.from([1, 1, 1]),
    hitDeadline: Uint8Array.from([4, 3, 2])
  };
  const engine = {
    ourCount: 3,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.TURN_LEFT, ACTION.FIRE]),
    hardStatus: Uint8Array.from([
      HARD_STATUS.ALLOW, HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    riskController: { outcome: risk },
    combat: { vector: combat },
    optionPortfolio: {
      count: 3,
      primitiveRow: Uint8Array.from([0, 1, 2]),
      kind: Uint8Array.from([
        OPTION_KIND.ATTACK_SETUP, OPTION_KIND.ATTACK_SETUP,
        OPTION_KIND.DIRECT_KILL]),
      supportComplete: Uint8Array.from([1, 1, 1])
    }
  };
  return { arbiter, selectedRow, risk, combat, engine,
    shadow: new StrategicTargetExecutionShadow(arbiter) };
}

test("target execution picks a qualified direct kill without mutating evidence", () => {
  const value = fixture();
  const hard = Array.from(value.engine.hardStatus);
  const acceptable = Array.from(value.risk.acceptable);
  value.shadow.observe(value.engine, ACTION.GO);
  assert.equal(value.shadow.lastProposalRow, 2);
  assert.equal(value.shadow.lastStatus, EXECUTION_STATUS.DIFFERENT_PRIMITIVE);
  assert.equal(value.shadow.fireProposalCount, 1);
  assert.equal(value.shadow.directKillProposalCount, 1);
  assert.equal(value.shadow.counterfactualBoundaryCount, 1);
  assert.equal(value.arbiter.shadowTargetGeneration, 0);
  assert.deepEqual(Array.from(value.engine.hardStatus), hard);
  assert.deepEqual(Array.from(value.risk.acceptable), acceptable);
  assert.equal(value.shadow.hotAllocationCount, 0);
});

test("a per-frame attack gap retains the semantic target and never invents NONE", () => {
  const value = fixture();
  value.risk.acceptable.fill(0);
  value.shadow.observe(value.engine, ACTION.GO);
  assert.equal(value.shadow.lastProposalRow, -1);
  assert.equal(value.shadow.lastStatus, EXECUTION_STATUS.TARGET_GAP);
  assert.equal(value.arbiter.shadowTargetGeneration, 22);
  assert.equal(value.shadow.targetGapCount, 1);
  assert.equal(value.shadow.proposalByAction[ACTION.NONE], 0);
});

test("an actual ATTACK selection is not mistaken for arbiter target ownership", () => {
  const value = fixture();
  value.arbiter.shadowTargetProposalOwned = 0;
  value.shadow.observe(value.engine, ACTION.GO);
  assert.equal(value.shadow.attackTargetFrameCount, 0);
  assert.equal(value.shadow.proposalRootCount, 0);
});

test("execution distinguishes an already selected primitive from an override", () => {
  const value = fixture();
  value.selectedRow.value = 2;
  value.shadow.observe(value.engine, ACTION.FIRE);
  assert.equal(value.shadow.lastStatus, EXECUTION_STATUS.SAME_PRIMITIVE);
  assert.equal(value.shadow.samePrimitiveCount, 1);
  assert.equal(value.shadow.differentPrimitiveCount, 0);
  assert.equal(value.arbiter.shadowTargetGeneration, 22);
});
