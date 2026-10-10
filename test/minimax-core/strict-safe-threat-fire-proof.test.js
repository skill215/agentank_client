"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState } = require("../../engine-v2/src/state/fast-state");
const { AttackEventPolicySearch } = require(
  "../../engine-v2/src/search/attack-event-policy-search");
const { StrictProjectileEventSettlement, StrictSafeThreatFireProofArena } =
  require("../../engine-v2/src/search/strict-safe-threat-fire-proof");
const { ProductionRootEngine } = require(
  "../../engine-v2/src/runtime/production-root");
const { INFORMATION_GAP } = require(
  "../../engine-v2/src/runtime/production-root");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { ACTION, HARD_STATUS } = require(
  "../../engine-v2/src/abi/fast-codes");
const { productionRootFixture } = require(
  "../../tools/agentank/build/imp6-builder");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");

test("BP150 compact attack-event TT allocates its requested cold capacity", () => {
  const search = new AttackEventPolicySearch(64, 64);
  for (const key of ["ttLo", "ttHi", "ttSemanticLo", "ttSemanticHi",
    "ttDepth", "ttStatus", "ttPolicyAction", "ttPolicyArgument"])
    assert.equal(search[key].length, 64, key);
  assert.equal(search.ttCapacity, 64);
  assert.throws(() => new AttackEventPolicySearch(64, 48),
    /ATTACK_EVENT_TT_CAPACITY_POWER_OF_TWO_REQUIRED/);
});

test("BP150 projectile settlement and proof arena fail closed without support", () => {
  const state = new FastState(5, 5);
  const settlement = new StrictProjectileEventSettlement();
  assert.equal(settlement.classifyThreat(state, 0), 0);
  const arena = new StrictSafeThreatFireProofArena(state);
  assert.equal(arena.evaluate(null, null, null, 0), PROOF_STATUS.UNKNOWN);
  assert.equal(arena.lastSupportComplete, 0);
});

test("BP150 Shadow is absent by default and cannot change the selected action", () => {
  const controlFixture = productionRootFixture();
  const shadowFixture = productionRootFixture();
  const control = new ProductionRootEngine();
  const shadow = new ProductionRootEngine({
    diagnosticStrictSafeThreatFireShadow: true
  });
  const controlAction = control.decide(controlFixture.me, controlFixture.enemy,
    controlFixture.game);
  const shadowAction = shadow.decide(shadowFixture.me, shadowFixture.enemy,
    shadowFixture.game);
  assert.equal(control.strictSafeThreatFireProofArena, null);
  assert.equal(control.diagnosticStrictSafeThreatFireShadow, 0);
  assert.equal(shadowAction, controlAction);
  assert.equal(shadow.strictSafeThreatFireShadowActionableCount +
    shadow.strictSafeThreatFireShadowAlreadyFireCount <=
    shadow.strictSafeThreatFireShadowProvenCount, true);
});

test("BP150C closes only a fully refuted possible-projectile information gap", () => {
  const engine = new ProductionRootEngine({
    diagnosticStrictSafeThreatFireShadow: true
  });
  engine.adapter.informationGapMask =
    INFORMATION_GAP.POSSIBLE_ENEMY_PROJECTILE;
  engine.possibleProjectiles.pool.complete = 1;
  assert.equal(engine.possibleProjectiles.count(), 0);
  assert.equal(engine.strictSafeThreatFirePhysicalSupport(0), 1);
  engine.possibleProjectiles.addFired = () => 1;
  engine.possibleProjectiles.count = () => 1;
  assert.equal(engine.strictSafeThreatFirePhysicalSupport(0), 0);
  engine.possibleProjectiles.count = () => 0;
  engine.possibleProjectiles.pool.complete = 0;
  assert.equal(engine.strictSafeThreatFirePhysicalSupport(0), 0);
  engine.possibleProjectiles.pool.complete = 1;
  engine.adapter.informationGapMask |= INFORMATION_GAP.BOMB_TRACK;
  assert.equal(engine.strictSafeThreatFirePhysicalSupport(0), 0);
});

test("BP150D ACTIVE can select only a proven, Hard-allowed FIRE row", () => {
  const engine = new ProductionRootEngine({
    diagnosticStrictSafeThreatFireActive: true
  });
  engine.ourCount = 2;
  engine.ourActions[0] = ACTION.GO;
  engine.ourActions[1] = ACTION.FIRE;
  engine.hardStatus[0] = HARD_STATUS.ALLOW;
  engine.hardStatus[1] = HARD_STATUS.ALLOW;
  engine.finalGate.finalAllows = () => 1;
  engine.strictSafeThreatFireShadowLastStatus = PROOF_STATUS.UNKNOWN;
  assert.equal(engine.applyStrictSafeThreatFireActive({}, 0), 0);
  engine.strictSafeThreatFireShadowLastStatus = PROOF_STATUS.PROVEN;
  engine.strictSafeThreatFireShadowLastFireRow = 1;
  assert.equal(engine.applyStrictSafeThreatFireActive({}, 0), 1);
  assert.equal(engine.strictSafeThreatFireActiveOverrideCount, 1);
  engine.hardStatus[1] = HARD_STATUS.REJECT_PROVEN;
  assert.equal(engine.applyStrictSafeThreatFireActive({}, 0), 0);
  assert.equal(engine.strictSafeThreatFireActiveMissingRowCount, 1);
});

test("BP150E a root FIRE no-op can never produce a strict certificate", () => {
  const map = boxedMap(7, 5);
  const built = fast.createFastPhysical(physical({
    map: { width: 7, height: 5, terrainColumnMajor: map },
    tanks: [tank(0, [1, 2], "right"), tank(1, [5, 2], "left")],
    projectiles: [{ entityId: 9, owner: 0, cell: [2, 1], direction: "right",
      groupId: 9, memberIndex: 0, createdFrame: 0 }]
  }));
  const arena = new StrictSafeThreatFireProofArena(built.state);
  const enemyActions = Uint8Array.from([ACTION.NONE]);
  const enemyArguments = Uint16Array.from([fast.NONE_CELL]);
  assert.equal(arena.evaluate(built, enemyActions, enemyArguments, 1),
    PROOF_STATUS.UNKNOWN);
  assert.ok(arena.search.rootFireMissingCount > 0);
  assert.equal(arena.lastAllDoomed, 0);
});

test("BP150E doomed-only ACTIVE rejects an ordinary safe-threat certificate", () => {
  const engine = new ProductionRootEngine({
    diagnosticStrictDoomedFireActive: true
  });
  engine.ourCount = 2;
  engine.ourActions[0] = ACTION.GO;
  engine.ourActions[1] = ACTION.FIRE;
  engine.hardStatus[1] = HARD_STATUS.ALLOW;
  engine.finalGate.finalAllows = () => 1;
  engine.strictSafeThreatFireShadowLastStatus = PROOF_STATUS.PROVEN;
  engine.strictSafeThreatFireShadowLastFireRow = 1;
  assert.equal(engine.applyStrictSafeThreatFireActive({}, 0), 0);
  engine.strictSafeThreatFireShadowLastAllDoomed = 1;
  assert.equal(engine.applyStrictSafeThreatFireActive({}, 0), 1);
  assert.equal(engine.strictDoomedFireActiveOverrideCount, 1);
});
