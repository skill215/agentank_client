"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { POLICY_ID, POLICY_EVENT, POLICY_EVENT_DIMENSION, BENEFIT_MASK,
  FAILURE_MASK, eventBit, PolicyIdentityTranspositionTablePoc,
  NativeDualPolicyContinuationPoc, NativeCombatFirstContinuationPoc } = require(
  "../../tools/agentank/diagnostics/native-dual-policy-continuation-poc");

test("FIRE emission is neither benefit nor failure", () => {
  const fire = eventBit(POLICY_EVENT.FIRE_EMITTED);
  assert.equal(fire & BENEFIT_MASK, 0); assert.equal(fire & FAILURE_MASK, 0);
  assert.notEqual(eventBit(POLICY_EVENT.ENEMY_DEATH) & BENEFIT_MASK, 0);
  assert.notEqual(eventBit(POLICY_EVENT.OWN_DEATH) & FAILURE_MASK, 0);
});
test("same PhysicalState has separate TT entries per policy", () => {
  const tt = new PolicyIdentityTranspositionTablePoc();
  const state = { hashLo: 0x12345678, hashHi: 0x9abcdef0 };
  const baseMass = new Uint16Array(POLICY_EVENT_DIMENSION);
  const attackMass = new Uint16Array(POLICY_EVENT_DIMENSION);
  baseMass[POLICY_EVENT.OPEN] = 10000;
  attackMass[POLICY_EVENT.FIRE_EMITTED] = 10000; tt.nextEpoch();
  const base = tt.store(state, 4, POLICY_ID.BASE, 1, baseMass);
  const attack = tt.store(state, 4, POLICY_ID.ATTACK_POSE, 2, attackMass);
  assert.notEqual(base, attack);
  assert.equal(tt.index(state, 4, POLICY_ID.BASE), base);
  assert.equal(tt.index(state, 4, POLICY_ID.ATTACK_POSE), attack);
  assert.equal(tt.mass[base * POLICY_EVENT_DIMENSION + POLICY_EVENT.OPEN], 10000);
  assert.equal(tt.mass[attack * POLICY_EVENT_DIMENSION + POLICY_EVENT.FIRE_EMITTED], 10000);
});
test("one state can choose different continuations", () => {
  const dual = new NativeDualPolicyContinuationPoc(
    { routeAction: () => 1 }, { routeAction: () => 4 });
  assert.equal(dual.routeAction({}, POLICY_ID.BASE), 1);
  assert.equal(dual.routeAction({}, POLICY_ID.ATTACK_POSE), 4);
  assert.deepEqual(Array.from(dual.routeCount), [0, 1, 1]);
  assert.equal(dual.hotAllocationCount + dual.tt.hotAllocationCount, 0);
});
test("missing policy support is explicit incomplete", () => {
  const dual = new NativeDualPolicyContinuationPoc(null, null);
  assert.equal(dual.routeAction({}, POLICY_ID.BASE), -1);
  assert.equal(dual.routeIncompleteCount[POLICY_ID.BASE], 1);
});

test("combat-first continuation orders direct, safety, attack, then strategy", () => {
  const state = {}; const engine = { adapter: { state } };
  let direct = 0; let safety = 0; let strategic = 3; let attack = 2;
  const intent = {
    directAttackAction() { return direct; },
    preemptiveSafetyAction() { return safety; },
    proposedV1Exact() { return 1; },
    v1ActionForIntent() { return strategic; }
  };
  const policy = new NativeCombatFirstContinuationPoc(engine, intent,
    { routeAction() { return attack; } });
  direct = 4; assert.equal(policy.routeAction(state), 4);
  direct = 0; safety = 1; assert.equal(policy.routeAction(state), 1);
  safety = 0; assert.equal(policy.routeAction(state), 2);
  attack = 0; assert.equal(policy.routeAction(state), 3);
  strategic = 0; assert.equal(policy.routeAction(state), -1);
  assert.deepEqual([policy.directCount, policy.preemptiveCount,
    policy.attackCount, policy.strategicCount, policy.incompleteCount],
  [1, 1, 1, 1, 1]);
});

test("response mass keeps FIRE separate from terminal benefit", () => {
  const { NativeDualPolicyResponseMassPoc } = require(
    "../../tools/agentank/diagnostics/native-dual-policy-response-mass-poc");
  const { MASS_INDEX } = require(
    "../../tools/agentank/diagnostics/native-long-option-response-mass-poc");
  const { LONG_EVENT_OUTCOME } = require(
    "../../tools/agentank/diagnostics/native-long-option-event-envelope-poc");
  const poc = new NativeDualPolicyResponseMassPoc("shadow");
  assert.equal(poc.massForMask(LONG_EVENT_OUTCOME.FIRE, MASS_INDEX.FIRE), 10000);
  assert.equal(poc.massForMask(LONG_EVENT_OUTCOME.FIRE, MASS_INDEX.SUCCESS), 0);
  assert.equal(poc.massForMask(LONG_EVENT_OUTCOME.WIN, MASS_INDEX.SUCCESS), 10000);
  assert.equal(poc.basePolicyId, POLICY_ID.BASE);
  assert.equal(poc.candidatePolicyId, POLICY_ID.ATTACK_POSE);
});
