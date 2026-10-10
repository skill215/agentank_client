"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { AttackEventPolicySearch, AttackEventPolicySnapshot } = require(
  "../../engine-v2/src/search/attack-event-policy-search");
const { ATTACK_POLICY_GOAL, AttackPolicyContinuationTable,
  AttackPolicyReachabilitySearch } = require(
  "../../tools/agentank/diagnostics/attack-policy-reachability-shadow");

function fixture(options = {}) {
  const map = boxedMap(8, 7);
  if (options.hidden) map[3][3] = "o";
  return fast.createFastPhysical(physical({
    map: { width: 8, height: 7, terrainColumnMajor: map },
    tanks: [tank(0, [1, 3], "up", { skillReadyFrame: 255 }),
      tank(1, [3, 3], "up", {
        frozenUntilFrame: options.mobile ? null : 10,
        skillReadyFrame: 255
      })]
  }));
}

function diagnostic(budget = 4096) {
  return new AttackPolicyReachabilitySearch(budget, {
    allowDebuffGoal: false,
    allowedGoalMask: ATTACK_POLICY_GOAL.ENEMY_CRASH,
    completeRootEnemyDomain: true
  });
}

function compareCase(options, action, depth, budget) {
  const built = fixture(options);
  const enemyActions = Uint8Array.from([fast.ACTION.NONE]);
  const enemyArguments = Uint16Array.from([fast.NONE_CELL]);
  const reference = diagnostic(budget);
  const lean = new AttackEventPolicySearch(budget);
  const expected = reference.evaluateCandidate(built, action, fast.NONE_CELL,
    enemyActions, enemyArguments, 1, depth, budget);
  const actual = lean.evaluateCandidate(built, action, fast.NONE_CELL,
    enemyActions, enemyArguments, 1, depth, budget);
  assert.equal(actual, expected);
  assert.equal(lean.nodes, reference.nodes);
  assert.equal(lean.completedDepth, reference.completedDepth);
  assert.equal(lean.poisonHoldTransitionCount,
    reference.poisonHoldTransitionCount);
  assert.equal(lean.provenPolicyEntryCount,
    reference.provenPolicyEntryCount);
  assert.equal(lean.rootRestoreFailures, 0);
  return { built, reference, lean, status: actual };
}

test("lean attack-event search is node-for-node equivalent to diagnostic oracle", () => {
  compareCase({}, fast.ACTION.TURN_RIGHT, 4, 4096);
  compareCase({ mobile: true }, fast.ACTION.TURN_RIGHT, 2, 4096);
  compareCase({ hidden: true }, fast.ACTION.TURN_RIGHT, 4, 4096);
  compareCase({}, fast.ACTION.TURN_RIGHT, 4, 1);
});

test("lean 64-entry snapshot preserves the diagnostic executable policy", () => {
  const value = compareCase({}, fast.ACTION.TURN_RIGHT, 4, 4096);
  assert.equal(value.status, PROOF_STATUS.PROVEN);
  const referenceTable = new AttackPolicyContinuationTable(64);
  const leanTable = new AttackEventPolicySnapshot(64);
  assert.equal(referenceTable.capture(value.reference), 1);
  assert.equal(leanTable.capture(value.lean), 1);
  assert.equal(leanTable.count, referenceTable.count);

  assert.equal(value.built.kernel.applyFrame(fast.ACTION.TURN_RIGHT,
    fast.NONE_CELL, fast.ACTION.NONE, fast.NONE_CELL, 0, 0),
  fast.FAST_STATUS.APPLIED);
  const mark = value.built.kernel.lastMark;
  assert.equal(referenceTable.policyFor(value.built.state, 1,
    value.reference), 1);
  assert.equal(leanTable.policyFor(value.built.state, 1, value.lean), 1);
  assert.equal(leanTable.selectedAction, referenceTable.actionResult);
  assert.equal(leanTable.selectedArgument, referenceTable.argumentResult);
  value.built.state.undoTo(mark);
});
