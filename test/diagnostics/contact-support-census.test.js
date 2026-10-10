"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionDiagnosticBot } = require(
  "../../tools/agentank/simulation/production-diagnostic-bot");
const { ROOT_CONTROL_MODE } = require(
  "../../engine-v2/src/runtime/root-control-mode");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { INFORMATION_GAP, ProductionRootEngine } = require(
  "../../engine-v2/src/runtime/production-root");

function bot(engine) {
  const value = Object.create(ProductionDiagnosticBot.prototype);
  value.engine = engine;
  value.contactSupportRootCount = 0; value.contactSupportExactCount = 0;
  value.contactSupportRecoverablePhysicalCount = 0;
  value.contactSupportPossibleOnlyTrackedCount = 0;
  value.contactSupportPossibleOnlyIncompleteCount = 0;
  value.contactSupportPossibleWithOtherCount = 0;
  value.contactSupportOtherGapCount = 0;
  value.contactSupportGapBitCount = new Uint32Array(14);
  value.contactSupportPossibleCount = new Uint32Array(9);
  return value;
}

test("contact support census restores only a refuted possible-projectile gap", () => {
  const engine = {
    lastControlMode: ROOT_CONTROL_MODE.TACTICAL_CONTACT,
    adapter: { informationComplete: 0,
      informationGapMask: INFORMATION_GAP.POSSIBLE_ENEMY_PROJECTILE },
    possibleProjectiles: { count: () => 0, pool: { complete: 1 } }
  };
  const value = bot(engine);
  assert.equal(value.captureContactSupport(), 1);
  assert.equal(value.contactSupportRecoverablePhysicalCount, 1);
  assert.equal(value.contactSupportPossibleOnlyTrackedCount, 1);
  assert.equal(value.contactSupportGapBitCount[13], 1);
});

test("contact support census never restores a real possible world or another gap", () => {
  const engine = {
    lastControlMode: ROOT_CONTROL_MODE.TACTICAL_CONTACT,
    adapter: { informationComplete: 0,
      informationGapMask: INFORMATION_GAP.POSSIBLE_ENEMY_PROJECTILE },
    possibleProjectiles: { count: () => 1, pool: { complete: 1 } }
  };
  const value = bot(engine);
  value.captureContactSupport();
  engine.adapter.informationGapMask |= INFORMATION_GAP.BOMB_TRACK;
  engine.possibleProjectiles.count = () => 0;
  value.captureContactSupport();
  assert.equal(value.contactSupportRecoverablePhysicalCount, 0);
  assert.equal(value.contactSupportPossibleWithOtherCount, 1);
  assert.equal(value.contactSupportPossibleCount[1], 1);
});

test("contact support census ignores non-contact roots", () => {
  const engine = { lastControlMode: ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION,
    adapter: { informationComplete: 1, informationGapMask: 0 },
    possibleProjectiles: { count: () => 0, pool: { complete: 1 } } };
  const value = bot(engine);
  assert.equal(value.captureContactSupport(), 0);
  assert.equal(value.contactSupportRootCount, 0);
});

function physicalSupport(enabled, gap, count, complete = 1, visible = 1) {
  const engine = Object.create(ProductionRootEngine.prototype);
  engine.diagnosticRefutedPossiblePhysicalSearch = enabled ? 1 : 0;
  engine.adapter = { enemyVisible: visible, informationGapMask: gap };
  engine.possibleProjectiles = { count: () => count, pool: { complete } };
  return engine.refutedPossiblePhysicalValueSupport(0);
}

test("refuted possible-projectile Physical search requires an enabled exact refutation", () => {
  const onlyPossible = INFORMATION_GAP.POSSIBLE_ENEMY_PROJECTILE;
  assert.equal(physicalSupport(true, onlyPossible, 0), 1);
  assert.equal(physicalSupport(false, onlyPossible, 0), 0);
  assert.equal(physicalSupport(true, onlyPossible, 1), 0);
  assert.equal(physicalSupport(true, onlyPossible, 0, 0), 0);
  assert.equal(physicalSupport(true, onlyPossible | INFORMATION_GAP.BOMB_TRACK, 0), 0);
  assert.equal(physicalSupport(true, onlyPossible, 0, 1, 0), 0);
});

test("already exact roots are not relabelled as refuted-possible roots", () => {
  const engine = Object.create(ProductionRootEngine.prototype);
  engine.diagnosticRefutedPossiblePhysicalSearch = 1;
  engine.adapter = { enemyVisible: 1, informationGapMask: 0 };
  engine.possibleProjectiles = { count: () => 0, pool: { complete: 1 } };
  assert.equal(engine.refutedPossiblePhysicalValueSupport(1), 0);
});

test("refuted Physical challenger is a safe FIRE row, not generic contact", () => {
  const engine = Object.create(ProductionRootEngine.prototype);
  engine.ourActions = Uint8Array.from([ACTION.GO, ACTION.FIRE]);
  engine.hardStatus = Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
  engine.controlMode = { context: { clearLine: 1 } };
  engine.combat = { vector: {
    postFireEscape: Uint8Array.from([0, 1]),
    directKill: new Uint8Array(2), possibleHit: new Uint8Array(2)
  } };
  assert.equal(engine.refutedPossiblePhysicalChallenger(2), 1);
  engine.combat.vector.postFireEscape[1] = 0;
  assert.equal(engine.refutedPossiblePhysicalChallenger(2), 0);
  engine.combat.vector.postFireEscape[1] = 1;
  engine.hardStatus[1] = HARD_STATUS.REJECT_PROVEN;
  assert.equal(engine.refutedPossiblePhysicalChallenger(2), 0);
});

function verifierFixture() {
  const engine = Object.create(ProductionRootEngine.prototype);
  const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
  engine.ourActions = Uint8Array.from([ACTION.GO, ACTION.FIRE]);
  engine.hardStatus = Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
  engine.combat = { vector: { postFireEscape: Uint8Array.from([0, 1]) } };
  engine.riskController = { outcome: {
    acceptable: Uint8Array.from([1, 1]), dominated: new Uint8Array(2)
  } };
  engine.enemyCount = 2;
  engine.depthSearch = { representativeSupportComplete: 1, completedDepth: 2,
    rootDomainRestricted: 0, rootDomainMask: new Uint8Array(2),
    iterationCellComplete: new Uint8Array(stride * 2),
    rootCellScore: new Int32Array(stride * 2) };
  for (let column = 0; column < engine.enemyCount; column += 1) {
    engine.depthSearch.iterationCellComplete[column] = 1;
    engine.depthSearch.iterationCellComplete[stride + column] = 1;
    engine.depthSearch.rootCellScore[column] = 10;
    engine.depthSearch.rootCellScore[stride + column] = 20;
  }
  engine.refutedPossiblePhysicalVerifierCheckCount = 0;
  engine.refutedPossiblePhysicalVerifierProposalCount = 0;
  engine.refutedPossiblePhysicalVerifierOverrideCount = 0;
  engine.refutedPossiblePhysicalVerifierIncompleteCount = 0;
  engine.refutedPossiblePhysicalVerifierRiskBlockedCount = 0;
  return engine;
}

test("FIRE verifier requires exact per-response dominance", () => {
  const engine = verifierFixture(); const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
  assert.equal(engine.selectRefutedPossiblePhysicalFire(0, 2), 1);
  assert.equal(engine.refutedPossiblePhysicalVerifierProposalCount, 1);
  engine.depthSearch.rootCellScore[stride + 1] = 9;
  assert.equal(engine.selectRefutedPossiblePhysicalFire(0, 2), 0);
  engine.depthSearch.rootCellScore[stride + 1] = 20;
  engine.depthSearch.iterationCellComplete[stride + 1] = 0;
  assert.equal(engine.selectRefutedPossiblePhysicalFire(0, 2), 0);
  assert.equal(engine.refutedPossiblePhysicalVerifierIncompleteCount, 1);
});
