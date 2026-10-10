"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { SemanticAttackPolicyIntervalActivePoc } = require(
  "../../tools/agentank/diagnostics/semantic-attack-policy-interval-active-poc");

function subject(finalAllows = true) {
  const active = new SemanticAttackPolicyIntervalActivePoc();
  active.ledger = { hotAllocationCount: 0, observe() {} };
  active.epoch = { hotAllocationCount: 0, observe() {} };
  active.coverage = { hotAllocationCount: 0, observe() {} };
  active.shadow = { hotAllocationCount: 0, strictDominanceCount: 0,
    lastProposal: -1, totalHotAllocationCount() { return 0; },
    observe() { this.strictDominanceCount += 1; this.lastProposal = 1; },
    summary() { return {}; } };
  const engine = { ourCount: 2,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.TURN_LEFT]),
    ourArguments: new Uint16Array(2),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    adapter: { bundle: {} }, finalGate: { finalAllows() { return finalAllows; } } };
  return { active, engine };
}

test("new branch-local policy certificate passes through FinalGate", () => {
  const { active, engine } = subject();
  const result = active.selectOverride(engine, ACTION.GO, 0);
  assert.deepEqual(result, { action: ACTION.TURN_LEFT, argument: 0, row: 1 });
  assert.equal(active.summary().overrideCount, 1);
});

test("FinalGate rejection keeps the incumbent action", () => {
  const { active, engine } = subject(false);
  assert.equal(active.selectOverride(engine, ACTION.GO, 0), null);
  assert.equal(active.summary().finalRejectCount, 1);
});

test("active owner forwards common host continuation to its shadow", () => {
  const active = new SemanticAttackPolicyIntervalActivePoc({}, {
    depth: 2, nodeBudget: 128, commonContinuation: true
  });
  const engine = { runtime: { runtimeConfig: {} } };
  active.initialize(engine);
  assert.equal(active.shadow.policy.commonContinuation, true);
  assert.equal(active.shadow.policy.feedback, null);
});
