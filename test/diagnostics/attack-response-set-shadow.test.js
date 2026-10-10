"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fast } = require("../imp3/helpers");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { AttackResponseSetShadow } = require(
  "../../tools/agentank/diagnostics/attack-response-set-shadow");

class FakeSearch {
  constructor() {
    this.hotAllocationCount = 0; this.nodes = 3; this.ttHits = 1;
    this.budgetStopCount = 0; this.incompleteCount = 0;
    this.hardIncompleteStops = 0; this.unsupportedGenerationStops = 0;
    this.rootRestoreFailures = 0;
  }
  evaluateCandidate(_bundle, own, _arg, enemy) {
    this.nodes = 3;
    if (own === fast.ACTION.TURN_RIGHT) return PROOF_STATUS.PROVEN;
    if (own === fast.ACTION.FIRE) return enemy[0] === fast.ACTION.NONE ?
      PROOF_STATUS.PROVEN : PROOF_STATUS.DISPROVEN;
    if (own === fast.ACTION.GO) return enemy[0] === fast.ACTION.GO ?
      PROOF_STATUS.PROVEN : PROOF_STATUS.DISPROVEN;
    return PROOF_STATUS.DISPROVEN;
  }
}

function fixture() {
  const interval = { evaluationSerial: 1, lastSelectedRow: 0 };
  const engine = { adapter: { bundle: {}, enemyVisible: 1, tracker: { complete: 1 } },
    possibleProjectiles: { count: () => 0 }, hiddenSupportComplete: 1,
    hiddenWorldCount: 1, hiddenWorldMass: Uint16Array.from([10000]),
    ourCount: 4, enemyCount: 2,
    ourActions: Uint8Array.from([fast.ACTION.FIRE, fast.ACTION.TURN_RIGHT,
      fast.ACTION.GO, fast.ACTION.TURN_LEFT]),
    ourArguments: new Uint16Array(4),
    enemyActions: Uint8Array.from([fast.ACTION.NONE, fast.ACTION.GO]),
    enemyArguments: new Uint16Array(2),
    hardStatus: new Uint8Array(4),
    riskController: { outcome: { count: 4,
      acceptable: Uint8Array.from([1, 1, 1, 1]), dominated: new Uint8Array(4) } } };
  return { interval, engine };
}

test("response-set comparison separates strict superset, tradeoff and subset", () => {
  const built = fixture(); const shadow = new AttackResponseSetShadow(
    built.interval, new FakeSearch());
  shadow.observe(built.engine); shadow.observe(built.engine);
  const summary = shadow.summary();
  assert.equal(summary.candidateRowCount, 3);
  assert.equal(summary.columnEvaluationCount, 8);
  assert.equal(summary.strictSupersetCount, 1);
  assert.equal(summary.tradeoffCount, 1);
  assert.equal(summary.strictSubsetCount, 1);
  assert.equal(summary.rootWithStrictSupersetCount, 1);
  assert.deepEqual(summary.strictSupersetByAction,
    { [fast.ACTION.TURN_RIGHT]: 1 });
  assert.equal(summary.duplicateSkipCount, 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("unknown support never becomes a strict response-set improvement", () => {
  const built = fixture(); const search = new FakeSearch();
  search.evaluateCandidate = (_bundle, own, _arg, enemy) =>
    own === fast.ACTION.TURN_RIGHT && enemy[0] === fast.ACTION.GO ?
      PROOF_STATUS.UNKNOWN : FakeSearch.prototype.evaluateCandidate.call(
        search, _bundle, own, _arg, enemy);
  const shadow = new AttackResponseSetShadow(built.interval, search);
  shadow.observe(built.engine); const summary = shadow.summary();
  assert.equal(summary.unknownColumnCount, 1);
  assert.equal(summary.strictSupersetCount, 0);
});

test("hidden, incomplete tracking and possible projectile roots fail closed", () => {
  for (const mode of ["hidden", "tracking", "possible"]) {
    const built = fixture(); const shadow = new AttackResponseSetShadow(
      built.interval, new FakeSearch());
    if (mode === "hidden") built.engine.adapter.enemyVisible = 0;
    if (mode === "tracking") built.engine.adapter.tracker.complete = 0;
    if (mode === "possible") built.engine.possibleProjectiles.count = () => 1;
    shadow.observe(built.engine); const summary = shadow.summary();
    assert.equal(summary.columnEvaluationCount, 0, mode);
    assert.equal(summary.strictSupersetCount, 0, mode);
  }
});
