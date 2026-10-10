"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { ATTACK_POLICY_GOAL, AttackPolicyContinuationTable,
  AttackPolicyReachabilitySearch,
  AttackPolicyReachabilityShadow } = require(
  "../../tools/agentank/diagnostics/attack-policy-reachability-shadow");

function fixture(overrides = {}) {
  const map = boxedMap(8, 7);
  if (overrides.enemyGrass) map[3][3] = "o";
  const own = tank(0, [1, 3], "up", {
    skillReadyFrame: 255, ...(overrides.own || {})
  });
  const enemy = tank(1, [3, 3], "up", {
    frozenUntilFrame: 10, skillReadyFrame: 255, ...(overrides.enemy || {})
  });
  const built = fast.createFastPhysical(physical({
    map: { width: 8, height: 7, terrainColumnMajor: map },
    tanks: [own, enemy]
  }));
  return { built,
    enemyActions: Uint8Array.from(overrides.enemyActions || [fast.ACTION.NONE]),
    enemyArguments: new Uint16Array((overrides.enemyActions || [0]).length) };
}

function identity(state) {
  return [state.hashLo, state.hashHi, state.deltaUsed, state.eventUsed,
    state.arrays[fast.ARRAY.SCALAR][fast.SCALAR.FRAME]];
}

test("adaptive Physical policy proves TURN then FIRE crash and restores root", () => {
  const f = fixture(); const before = identity(f.built.state);
  const search = new AttackPolicyReachabilitySearch();
  const status = search.evaluateCandidate(f.built, fast.ACTION.TURN_RIGHT,
    fast.NONE_CELL, f.enemyActions, f.enemyArguments, 1, 4, 4096);
  assert.equal(status, PROOF_STATUS.PROVEN);
  assert.equal(search.completedDepth, 2);
  assert.ok(search.goalMask & ATTACK_POLICY_GOAL.ENEMY_CRASH);
  assert.deepEqual(identity(f.built.state), before);
  assert.equal(search.rootRestoreFailures, 0);
  assert.equal(search.hotAllocationCount, 0);
  assert.equal(f.built.kernel.applyFrame(fast.ACTION.TURN_RIGHT, fast.NONE_CELL,
    fast.ACTION.NONE, fast.NONE_CELL, 0, 0), fast.FAST_STATUS.APPLIED);
  const mark = f.built.kernel.lastMark;
  assert.equal(search.policyFor(f.built.state, 1), 1);
  assert.equal(search.policyAction, fast.ACTION.FIRE);
  assert.equal(search.policyArgument, fast.NONE_CELL);
  assert.equal(search.policyLookupKind, 1);
  const appliedLo = f.built.state.hashLo; const appliedHi = f.built.state.hashHi;
  const nextEntity = f.built.state.arrays[fast.ARRAY.SCALAR][fast.SCALAR.NEXT_ENTITY];
  f.built.state.arrays[fast.ARRAY.SCALAR][fast.SCALAR.NEXT_ENTITY] = nextEntity + 17;
  f.built.state.initializeHash();
  assert.equal(search.policyFor(f.built.state, 1), 1);
  assert.equal(search.policyLookupKind, 2);
  assert.equal(search.policyAction, fast.ACTION.FIRE);
  const skillReady = f.built.state.arrays[fast.ARRAY.TANK_SKILL_READY][0];
  f.built.state.arrays[fast.ARRAY.TANK_SKILL_READY][0] =
    f.built.state.arrays[fast.ARRAY.SCALAR][fast.SCALAR.FRAME] + 99;
  f.built.state.initializeHash();
  assert.equal(search.policyFor(f.built.state, 1), 1);
  assert.equal(search.policyLookupKind, 2);
  f.built.state.arrays[fast.ARRAY.TANK_SKILL_READY][0] = skillReady;
  f.built.state.arrays[fast.ARRAY.SCALAR][fast.SCALAR.NEXT_ENTITY] = nextEntity;
  const frame = f.built.state.arrays[fast.ARRAY.SCALAR][fast.SCALAR.FRAME];
  const bombReady = f.built.state.arrays[fast.ARRAY.TANK_BOMB_READY][0];
  f.built.state.arrays[fast.ARRAY.TANK_BOMB_READY][0] = frame;
  f.built.state.initializeHash();
  assert.equal(search.policyFor(f.built.state, 1), 1,
    "already-ready bomb endpoints are semantically equivalent");
  assert.equal(search.policyLookupKind, 2);
  f.built.state.arrays[fast.ARRAY.TANK_BOMB_READY][0] = frame + 2;
  f.built.state.initializeHash();
  assert.equal(search.policyFor(f.built.state, 1), 0,
    "a cooldown inside the remaining proof window is not equivalent");
  f.built.state.arrays[fast.ARRAY.TANK_BOMB_READY][0] = bombReady;
  const stunUntil = f.built.state.arrays[fast.ARRAY.TANK_STUN_UNTIL][0];
  f.built.state.arrays[fast.ARRAY.TANK_STUN_UNTIL][0] = frame;
  f.built.state.initializeHash();
  assert.equal(search.policyFor(f.built.state, 1), 1,
    "an expired effect endpoint is equivalent to no active effect");
  f.built.state.arrays[fast.ARRAY.TANK_STUN_UNTIL][0] = frame + 1;
  f.built.state.initializeHash();
  assert.equal(search.policyFor(f.built.state, 1), 0,
    "an active effect inside the proof window remains distinct");
  f.built.state.arrays[fast.ARRAY.TANK_STUN_UNTIL][0] = stunUntil;
  f.built.state.hashLo = appliedLo; f.built.state.hashHi = appliedHi;
  f.built.state.undoTo(mark);
  assert.deepEqual(identity(f.built.state), before);
});

test("compact continuation table survives search reuse and fails closed on overflow", () => {
  const f = fixture();
  const search = new AttackPolicyReachabilitySearch();
  assert.equal(search.evaluateCandidate(f.built, fast.ACTION.TURN_RIGHT,
    fast.NONE_CELL, f.enemyActions, f.enemyArguments, 1, 4, 4096),
  PROOF_STATUS.PROVEN);
  const table = new AttackPolicyContinuationTable(64);
  assert.equal(table.capture(search), 1);
  assert.ok(table.count > 0);
  assert.equal(table.maximumEntries, table.count);

  assert.equal(f.built.kernel.applyFrame(fast.ACTION.TURN_RIGHT, fast.NONE_CELL,
    fast.ACTION.NONE, fast.NONE_CELL, 0, 0), fast.FAST_STATUS.APPLIED);
  const mark = f.built.kernel.lastMark;
  assert.equal(table.policyFor(f.built.state, 1, search), 1);
  assert.equal(table.actionResult, fast.ACTION.FIRE);
  assert.equal(table.argumentResult, fast.NONE_CELL);
  // A later search clears and reuses its large TT; the compact policy remains.
  search.resetPolicy(4096);
  assert.equal(table.policyFor(f.built.state, 1, search), 1);
  f.built.state.undoTo(mark);

  const overflow = new AttackPolicyContinuationTable(1);
  assert.equal(overflow.capture({
    ttDepth: Uint8Array.from([1, 1]),
    ttStatus: Uint8Array.from([PROOF_STATUS.PROVEN, PROOF_STATUS.PROVEN]),
    ttSemanticLo: Uint32Array.from([1, 2]),
    ttSemanticHi: Uint32Array.from([3, 4]),
    ttPolicyAction: Uint8Array.from([fast.ACTION.GO, fast.ACTION.FIRE]),
    ttPolicyArgument: Uint16Array.from([fast.NONE_CELL, fast.NONE_CELL])
  }), 0);
  assert.equal(overflow.complete, 0);
  assert.equal(overflow.count, 0);
  assert.equal(overflow.overflowCount, 1);
});

test("enemy response that escapes the line refutes the two-frame policy", () => {
  const f = fixture({ enemy: { frozenUntilFrame: null },
    enemyActions: [fast.ACTION.GO] });
  const search = new AttackPolicyReachabilitySearch();
  assert.equal(search.evaluateCandidate(f.built, fast.ACTION.TURN_RIGHT,
    fast.NONE_CELL, f.enemyActions, f.enemyArguments, 1, 2, 4096),
  PROOF_STATUS.DISPROVEN);
  assert.equal(search.completedDepth, 2);
});

test("complete root enemy domain does not trust a pruned representative list", () => {
  const f = fixture({ enemy: { frozenUntilFrame: null },
    enemyActions: [fast.ACTION.NONE] });
  const search = new AttackPolicyReachabilitySearch(4096, {
    completeRootEnemyDomain: true
  });
  assert.equal(search.evaluateCandidate(f.built, fast.ACTION.TURN_RIGHT,
    fast.NONE_CELL, f.enemyActions, f.enemyArguments, 1, 2, 4096),
  PROOF_STATUS.DISPROVEN);
  assert.equal(search.rootDomainGenerationCount, 1);
  assert.ok(search.enemyCount[0] > 1);
});

test("a real projectile shield hit is an irreversible goal", () => {
  const f = fixture({ enemy: { shieldHitsRemaining: 2, shieldUntilFrame: 10 } });
  const search = new AttackPolicyReachabilitySearch();
  assert.equal(search.evaluateCandidate(f.built, fast.ACTION.TURN_RIGHT,
    fast.NONE_CELL, f.enemyActions, f.enemyArguments, 1, 2, 4096),
  PROOF_STATUS.PROVEN);
  assert.ok(search.goalMask & ATTACK_POLICY_GOAL.SHIELD_HIT);

  const crashOnlyFixture = fixture({
    enemy: { shieldHitsRemaining: 2, shieldUntilFrame: 10 }
  });
  const crashOnly = new AttackPolicyReachabilitySearch(4096, {
    allowedGoalMask: ATTACK_POLICY_GOAL.ENEMY_CRASH
  });
  assert.equal(crashOnly.evaluateCandidate(crashOnlyFixture.built,
    fast.ACTION.TURN_RIGHT, fast.NONE_CELL, crashOnlyFixture.enemyActions,
    crashOnlyFixture.enemyArguments, 1, 2, 4096), PROOF_STATUS.DISPROVEN);
});

test("only a root debuff skill owns debuff progress; setup movement and expiry do not", () => {
  const f = fixture({ own: { skillId: "stun", skillReadyFrame: 0 },
    enemy: { frozenUntilFrame: null } });
  const search = new AttackPolicyReachabilitySearch();
  assert.equal(search.evaluateCandidate(f.built, fast.ACTION.CAST_STUN,
    fast.NONE_CELL, f.enemyActions, f.enemyArguments, 1, 2, 4096),
  PROOF_STATUS.PROVEN);
  assert.ok(search.goalMask & ATTACK_POLICY_GOAL.DEBUFF);

  const arbitrary = fixture({ own: { skillId: "stun", skillReadyFrame: 0 },
    enemy: { frozenUntilFrame: null } });
  const arbitrarySearch = new AttackPolicyReachabilitySearch();
  assert.equal(arbitrarySearch.evaluateCandidate(arbitrary.built, fast.ACTION.TURN_LEFT,
    fast.NONE_CELL, arbitrary.enemyActions, arbitrary.enemyArguments, 1, 2, 4096),
  PROOF_STATUS.DISPROVEN);
  assert.equal(arbitrarySearch.goalMask & ATTACK_POLICY_GOAL.DEBUFF, 0);

  const expiring = fixture({ enemy: { frozenUntilFrame: 1 } });
  const expirySearch = new AttackPolicyReachabilitySearch();
  assert.equal(expirySearch.evaluateCandidate(expiring.built, fast.ACTION.TURN_LEFT,
    fast.NONE_CELL, expiring.enemyActions, expiring.enemyArguments, 1, 2, 4096),
  PROOF_STATUS.DISPROVEN);
  assert.equal(expirySearch.goalMask & ATTACK_POLICY_GOAL.DEBUFF, 0);

  const attackOnly = fixture({ own: { skillId: "stun", skillReadyFrame: 0 },
    enemy: { frozenUntilFrame: null } });
  const attackOnlySearch = new AttackPolicyReachabilitySearch(4096,
    { allowDebuffGoal: false });
  assert.equal(attackOnlySearch.evaluateCandidate(attackOnly.built,
    fast.ACTION.CAST_STUN, fast.NONE_CELL, attackOnly.enemyActions,
    attackOnly.enemyArguments, 1, 2, 4096), PROOF_STATUS.DISPROVEN);
  assert.equal(attackOnlySearch.goalMask & ATTACK_POLICY_GOAL.DEBUFF, 0);
});

test("hidden grass and insufficient budget fail closed without corrupting root", () => {
  const hidden = fixture({ enemyGrass: true });
  const search = new AttackPolicyReachabilitySearch();
  assert.equal(search.evaluateCandidate(hidden.built, fast.ACTION.TURN_RIGHT,
    fast.NONE_CELL, hidden.enemyActions, hidden.enemyArguments, 1, 4, 4096),
  PROOF_STATUS.UNKNOWN);

  const small = fixture(); const before = identity(small.built.state);
  assert.equal(search.evaluateCandidate(small.built, fast.ACTION.TURN_RIGHT,
    fast.NONE_CELL, small.enemyActions, small.enemyArguments, 1, 4, 1),
  PROOF_STATUS.UNKNOWN);
  assert.ok(search.budgetStopCount > 0);
  assert.deepEqual(identity(small.built.state), before);
});

test("identical observable successors reuse one deterministic policy result", () => {
  const f = fixture({ enemyActions: [fast.ACTION.NONE, fast.ACTION.NONE] });
  const search = new AttackPolicyReachabilitySearch();
  assert.equal(search.evaluateCandidate(f.built, fast.ACTION.TURN_RIGHT,
    fast.NONE_CELL, f.enemyActions, f.enemyArguments, 2, 2, 4096),
  PROOF_STATUS.PROVEN);
  assert.ok(search.ttHits > 0);
});

test("shadow scans only complete Risk-frontier movement roots and stays neutral", () => {
  const calls = [];
  const fakeSearch = { nodes: 7, maximumNodes: 7, ttHits: 1, ttStores: 2,
    hiddenStops: 0, budgetStopCount: 0, incompleteCount: 0,
    hardIncompleteStops: 0, unsupportedGenerationStops: 0, hardRejects: 0,
    rootRestoreFailures: 0, hotAllocationCount: 0,
    goalLeafCounts: Uint32Array.from([1, 0, 0]),
    horizonStatus: Uint8Array.from([0, 0, PROOF_STATUS.PROVEN, 0, 0]),
    horizonNodes: Uint32Array.from([0, 0, 7, 0, 0]),
    evaluateCandidate(_bundle, action) { calls.push(action); return PROOF_STATUS.PROVEN; } };
  const interval = { evaluationSerial: 1 };
  const shadow = new AttackPolicyReachabilityShadow(interval, fakeSearch);
  const engine = { adapter: { bundle: {}, enemyVisible: 1, tracker: { complete: 1 } },
    possibleProjectiles: { count: () => 0 }, hiddenSupportComplete: 1,
    hiddenWorldCount: 1, hiddenWorldMass: Uint16Array.from([10000]),
    ourCount: 3, enemyCount: 1,
    ourActions: Uint8Array.from([fast.ACTION.TURN_RIGHT, fast.ACTION.FIRE,
      fast.ACTION.GO]), ourArguments: new Uint16Array(3),
    enemyActions: Uint8Array.from([fast.ACTION.NONE]), enemyArguments: new Uint16Array(1),
    hardStatus: Uint8Array.from([fast.HARD_STATUS.ALLOW, fast.HARD_STATUS.ALLOW,
      fast.HARD_STATUS.ALLOW]), riskController: { outcome: { count: 3,
      acceptable: Uint8Array.from([1, 1, 1]), dominated: Uint8Array.from([0, 0, 1]) } } };
  shadow.observe(engine); shadow.observe(engine);
  const summary = shadow.summary();
  assert.deepEqual(calls, [fast.ACTION.TURN_RIGHT]);
  assert.equal(summary.provenRowCount, 1);
  assert.equal(summary.duplicateSkipCount, 1);
  assert.equal(summary.hotAllocationCount, 0);
});
