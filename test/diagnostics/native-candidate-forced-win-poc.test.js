"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { NativeCandidateForcedWinPoc } = require(
  "../../tools/agentank/diagnostics/native-candidate-forced-win-poc");
const { INFORMATION_GAP } = require(
  "../../engine-v2/src/runtime/production-root");

function fixture(complete = 1) {
  const proof = { nodes: 17, rootRestoreFailures: 0, winningRootRow: 0,
    search() { return PROOF_STATUS.PROVEN; } };
  const poc = new NativeCandidateForcedWinPoc("shadow", { proofSearch: proof });
  const engine = { adapter: { informationComplete: complete, bundle: {} },
    ourActions: new Uint8Array([ACTION.GO, ACTION.FIRE]),
    ourArguments: new Uint16Array(2),
    hardStatus: new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    enemyActions: new Uint8Array([ACTION.GO, ACTION.FIRE]),
    enemyArguments: new Uint16Array(2), enemyCount: 2 };
  const source = { rootScore: new Int32Array([10, 30]),
    rootCellScore: new Int32Array([10, 10, 30, 30]),
    rowExactBlockMask: new Uint8Array(2), rootDomainRestricted: 0 };
  return { poc, proof, engine, source };
}

test("heuristic candidate needs an independent strict forced-win certificate", () => {
  const value = fixture();
  assert.equal(value.poc.audit(value.engine, value.source, 2, ACTION.GO),
    PROOF_STATUS.PROVEN);
  const summary = value.poc.summary();
  assert.equal(summary.proofCheckCount, 1);
  assert.equal(summary.provenCount, 1);
  assert.equal(summary.wouldOverrideCount, 1);
  assert.equal(summary.overrideCount, 0);
  assert.equal(summary.lastCertifiedRow, 1);
  assert.equal(summary.provenByAction[ACTION.FIRE], 1);
  assert.equal(summary.exactPairCount, 1);
  assert.equal(summary.exactDominanceCount, 1);
  assert.equal(summary.exactDominanceByAction[ACTION.FIRE], 1);
  assert.equal(summary.nodeCount, 17);
  assert.equal(summary.hotAllocationCount, 0);
});

test("incomplete information cannot start a physical forced-win certificate", () => {
  const value = fixture(0); let called = 0;
  value.proof.search = () => { called += 1; return PROOF_STATUS.PROVEN; };
  assert.equal(value.poc.audit(value.engine, value.source, 2, ACTION.GO),
    PROOF_STATUS.UNKNOWN);
  assert.equal(called, 0);
  assert.equal(value.poc.summary().informationBlockedCount, 1);
});

test("a fully refuted possible-projectile gap can close physical support", () => {
  const value = fixture(0);
  value.engine.adapter.informationGapMask =
    INFORMATION_GAP.POSSIBLE_ENEMY_PROJECTILE;
  value.engine.possibleProjectiles = { pool: { complete: 1 }, count() { return 0; } };
  assert.equal(value.poc.audit(value.engine, value.source, 2, ACTION.GO),
    PROOF_STATUS.PROVEN);
  assert.equal(value.poc.summary().resolvedProjectileGapCount, 1);
});

test("an unresolved possible projectile remains an InformationState", () => {
  const value = fixture(0);
  value.engine.adapter.informationGapMask =
    INFORMATION_GAP.POSSIBLE_ENEMY_PROJECTILE;
  value.engine.possibleProjectiles = { pool: { complete: 1 }, count() { return 1; } };
  assert.equal(value.poc.audit(value.engine, value.source, 2, ACTION.GO),
    PROOF_STATUS.UNKNOWN);
  assert.equal(value.poc.summary().possibleProjectileWorldBlockedCount, 1);
  assert.equal(value.poc.summary().proofCheckCount, 0);
});

test("a non-improving or identical heuristic row is never sent to proof", () => {
  const value = fixture(); value.source.rootScore[1] = 10;
  assert.equal(value.poc.audit(value.engine, value.source, 2, ACTION.GO),
    PROOF_STATUS.UNKNOWN);
  assert.equal(value.poc.summary().sameBestCount, 1);
  assert.equal(value.poc.summary().proofCheckCount, 0);
});

test("policy-exact dominance can be audited without claiming ForcedWin", () => {
  const value = fixture(); let proofCalls = 0;
  const poc = new NativeCandidateForcedWinPoc("off", {
    exactDominanceMode: "active",
    proofSearch: { search() { proofCalls += 1; return PROOF_STATUS.PROVEN; } }
  });
  assert.equal(poc.audit(value.engine, value.source, 2, ACTION.GO),
    PROOF_STATUS.UNKNOWN);
  const summary = poc.summary();
  assert.equal(proofCalls, 0);
  assert.equal(summary.exactDominanceCount, 1);
  assert.equal(summary.exactDominanceOverrideCount, 1);
  assert.equal(summary.lastExactDominanceRow, 1);
  assert.equal(summary.provenCount, 0);
});
