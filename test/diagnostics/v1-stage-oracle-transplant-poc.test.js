"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { V3_SLOT } = require("../../engine-v3/src/contracts");
const { V1StageOracleTransplantPoc } = require(
  "../../tools/agentank/diagnostics/v1-stage-oracle-transplant-poc");

function oracle(proposed = ACTION.TURN_RIGHT, called = 1,
    stage = V3_SLOT.DIRECT_ATTACK) {
  const trace = { called: new Uint8Array(14), returnedAction: new Uint8Array(14) };
  trace.called[stage] = called;
  trace.returnedAction[stage] = proposed;
  return { controller: { ownershipTrace: trace }, decide() {},
    summary() { return { decisions: 1 }; } };
}

function engine() {
  return { ourCount: 3,
    ourActions: new Uint8Array([ACTION.GO, ACTION.TURN_RIGHT, ACTION.FIRE]),
    ourArguments: new Int16Array([0, 0, 0]),
    hardStatus: new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW,
      HARD_STATUS.ALLOW]), escapeObligation: { committedEntityCount: 0 },
    lastProofStatus: 0, lastSelectionWasStrictRescue: false,
    lastSelectionWasVerifiedDirectKill: false };
}

test("V1 direct stage can replace V2 selection after Physical Hard", () => {
  const poc = new V1StageOracleTransplantPoc(oracle());
  assert.deepEqual(poc.selectOverride(engine(), 0, ACTION.GO, 0, {}),
    { action: ACTION.TURN_RIGHT, argument: 0 });
  assert.equal(poc.summary().turnOverrideCount, 1);
});

test("V1 stage proposal cannot cross committed danger or Physical Hard", () => {
  const committedEngine = engine(); committedEngine.escapeObligation.committedEntityCount = 1;
  const committed = new V1StageOracleTransplantPoc(oracle());
  assert.equal(committed.selectOverride(committedEngine, 0, ACTION.GO, 0, {}), null);
  assert.equal(committed.summary().committedSkipCount, 1);
  const blockedEngine = engine();
  blockedEngine.hardStatus[1] = HARD_STATUS.REJECT_PROVEN;
  const blocked = new V1StageOracleTransplantPoc(oracle());
  assert.equal(blocked.selectOverride(blockedEngine, 0, ACTION.GO, 0, {}), null);
  assert.equal(blocked.summary().hardBlockedCount, 1);
});

test("uncalled or empty V1 stage is no proposal", () => {
  const poc = new V1StageOracleTransplantPoc(oracle(ACTION.NONE, 0));
  assert.equal(poc.selectOverride(engine(), 0, ACTION.GO, 0, {}), null);
  assert.equal(poc.summary().noProposalCount, 1);
});

test("the same ownership contract can isolate V1 tactical search", () => {
  const source = oracle(ACTION.FIRE, 1, V3_SLOT.TACTICAL_SEARCH);
  const poc = new V1StageOracleTransplantPoc(source, V3_SLOT.TACTICAL_SEARCH);
  assert.deepEqual(poc.selectOverride(engine(), 0, ACTION.GO, 0, {}),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(poc.summary().fireOverrideCount, 1);
});

test("optional V2 Risk qualification isolates Risk ownership cost", () => {
  const source = oracle(ACTION.FIRE, 1, V3_SLOT.TACTICAL_SEARCH);
  const poc = new V1StageOracleTransplantPoc(source, V3_SLOT.TACTICAL_SEARCH,
    { requireRisk: true });
  const value = engine();
  value.riskController = { outcome: { count: 3,
    acceptable: new Uint8Array([1, 1, 0]), dominated: new Uint8Array(3) } };
  assert.equal(poc.selectOverride(value, 0, ACTION.GO, 0, {}), null);
  assert.equal(poc.summary().riskBlockedCount, 1);
  value.riskController.outcome.acceptable[2] = 1;
  value.riskController.outcome.dominated[2] = 1;
  assert.equal(poc.selectOverride(value, 0, ACTION.GO, 0, {}), null);
  assert.equal(poc.summary().dominatedBlockedCount, 1);
});

test("ownership attribution compares the policy prior without changing it", () => {
  const source = oracle(ACTION.FIRE, 1, V3_SLOT.TACTICAL_SEARCH);
  const poc = new V1StageOracleTransplantPoc(source, V3_SLOT.TACTICAL_SEARCH);
  const value = engine();
  value.riskController = { outcome: { count: 3,
    acceptable: new Uint8Array([1, 1, 0]),
    dominated: new Uint8Array([0, 0, 1]),
    robustLower: new Int32Array([40, 50, 30]) } };
  value.combat = { vector: { count: 3,
    purposeCompleteness: new Uint8Array([0, 0, 0]) } };
  value.depthSearch = { completedDepth: 2, representativeSupportComplete: 1,
    rootDomainRestricted: 0, rootScore: new Int32Array([100, 80, 70]) };
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO, 0, {}),
    { action: ACTION.FIRE, argument: 0 });
  const audit = poc.summary().ownershipAttribution;
  assert.equal(audit.proposalRiskRejectCount, 1);
  assert.equal(audit.proposalDominatedCount, 1);
  assert.equal(audit.proposalPurposeMissingCount, 1);
  assert.equal(audit.physicalValueCount, 1);
  assert.equal(audit.proposalValueLowerCount, 1);
  assert.equal(audit.proposalRobustLowerCount, 1);
  assert.equal(audit.familyDisagreement["GO->FIRE"], 1);
});
