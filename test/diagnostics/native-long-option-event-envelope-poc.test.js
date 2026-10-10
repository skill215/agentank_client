"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { FastKernel } = require("../../engine-v2/src/fast/kernel");
const { ACTION, HARD_STATUS, TERRAIN, NONE_CELL, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { NativeBoundedPolicySearchPoc } = require(
  "../../tools/agentank/diagnostics/native-bounded-policy-search-poc");
const { NativeLongOptionEventEnvelopePoc, LONG_EVENT_OUTCOME,
  eventClosed, terminalClosed } = require(
  "../../tools/agentank/diagnostics/native-long-option-event-envelope-poc");

function routeFixture() {
  const state = new FastState(7, 7); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  a[ARRAY.TANK_CELL][1] = state.cell(5, 2);
  a[ARRAY.TANK_DIR][0] = 0; a[ARRAY.TANK_DIR][1] = 3;
  a[ARRAY.TANK_FIRE_LOCK][0] = NONE_FRAME;
  a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  a[ARRAY.SCALAR][SCALAR.TIMEOUT_SEAT] = 2;
  a[ARRAY.SCALAR][SCALAR.SCRIPT_ERROR_SEAT] = 2;
  state.initializeHash();
  const kernel = new FastKernel(state);
  const search = new NativeBoundedPolicySearchPoc({
    ownChanceMode: "v1-deterministic"
  });
  search.representativeSupportComplete = 1;
  search.rootEnemyDomainMask[0] = 1;
  search.bindIsolatedHard({ state, kernel });
  search.generate = function generate(_engine, top, seat) {
    assert.equal(seat, 1);
    this.deepEnemyCount[top] = 1;
    this.deepEnemyActions[top * 6] = ACTION.NONE;
    this.deepEnemyArguments[top * 6] = NONE_CELL;
    return 1;
  };
  const engine = { ourCount: 2, enemyCount: 1,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.TURN_RIGHT]),
    ourArguments: Uint16Array.from([NONE_CELL, NONE_CELL]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    enemyActions: Uint8Array.from([ACTION.NONE]),
    enemyArguments: Uint16Array.from([NONE_CELL]),
    riskController: { outcome: { acceptable: Uint8Array.from([1, 1]) } },
    escapeObligation: { committedEntityCount: 0 },
    adapter: { state, bundle: { state, kernel } },
    depthSearch: { chanceAlternatives() { return 1; } } };
  const pose = { selected: 0, cell: Uint16Array.from([state.cell(2, 2)]),
    direction: Uint8Array.from([1]), fireDeadline: Uint8Array.from([2]),
    responseMask: Uint32Array.from([1]), prepare() { return 1; },
    supports(row) { return row === 1; },
    betterRow(_engine, left, right) { return right < 0 || left < right; },
    summary() { return {}; } };
  const feedback = { routeAction(current) {
    return current.arrays[ARRAY.TANK_DIR][0] === 1 ? ACTION.FIRE :
      ACTION.TURN_RIGHT;
  }, summary() { return {}; } };
  return { state, engine, search, pose, feedback };
}

test("event backup requires every branch to close without death abort rescue or open", () => {
  assert.equal(eventClosed(LONG_EVENT_OUTCOME.FIRE), true);
  assert.equal(eventClosed(LONG_EVENT_OUTCOME.WIN), false);
  assert.equal(terminalClosed(LONG_EVENT_OUTCOME.WIN), true);
  assert.equal(terminalClosed(LONG_EVENT_OUTCOME.FIRE), false);
  for (const blocked of [LONG_EVENT_OUTCOME.DEATH, LONG_EVENT_OUTCOME.ABORT,
    LONG_EVENT_OUTCOME.RESCUE, LONG_EVENT_OUTCOME.OPEN,
    LONG_EVENT_OUTCOME.INCOMPLETE, LONG_EVENT_OUTCOME.POLICY_LOSS])
    assert.equal(eventClosed(LONG_EVENT_OUTCOME.FIRE | blocked), false);
  assert.equal(eventClosed(0), false);
});

test("TT index zero is an empty slot rather than a false capacity failure", () => {
  const envelope = new NativeLongOptionEventEnvelopePoc("shadow");
  envelope.nextEpoch(); let state = null;
  for (let value = 0; value < 65536; value += 1) {
    const candidate = { hashLo: value >>> 0,
      hashHi: Math.imul(value, 2654435761) >>> 0 };
    if (envelope.ttIndex(candidate, 3) === -2) { state = candidate; break; }
  }
  assert.ok(state, "expected a hash whose first empty slot is index zero");
  assert.equal(envelope.store(state, 3, LONG_EVENT_OUTCOME.FIRE), 0);
  assert.equal(envelope.ttCapacityFailureCount, 0);
  assert.equal(envelope.ttIndex(state, 3), 0);
});

test("long Option expands one own policy action until the FIRE event and restores root", () => {
  const { state, engine, search, pose, feedback } = routeFixture();
  const beforeLo = state.hashLo; const beforeHi = state.hashHi;
  const envelope = new NativeLongOptionEventEnvelopePoc("shadow", {
    pose, feedback, maximumFrames: 4, nodeBudget: 128
  });
  assert.equal(envelope.observe(engine, search, ACTION.GO), null);
  const summary = envelope.summary();
  assert.equal(summary.rootRouteCount, 1);
  assert.equal(summary.eventClosedCount, 1);
  assert.equal(summary.wouldProposeCount, 1);
  assert.equal(summary.deathCount, 0);
  assert.equal(summary.incompleteCount, 0);
  assert.equal(summary.rootRestoreFailureCount, 0);
  assert.equal(state.hashLo, beforeLo); assert.equal(state.hashHi, beforeHi);
  assert.equal(state.deltaUsed, 0); assert.equal(state.eventUsed, 0);
  assert.equal(summary.hotAllocationCount, 0);
});

test("root FIRE stays in shallow Minimax and committed danger stays in safety", () => {
  const { engine, search, pose } = routeFixture();
  const fireEnvelope = new NativeLongOptionEventEnvelopePoc("shadow", {
    pose, feedback: { routeAction() { return ACTION.FIRE; }, summary() { return {}; } }
  });
  assert.equal(fireEnvelope.observe(engine, search, ACTION.GO), null);
  assert.equal(fireEnvelope.summary().rootFireSkipCount, 1);
  assert.equal(fireEnvelope.summary().evaluationCount, 0);
  engine.escapeObligation.committedEntityCount = 1;
  const blocked = new NativeLongOptionEventEnvelopePoc("shadow", {
    pose, feedback: { routeAction() {
      throw new Error("committed safety must own before route policy");
    }, summary() { return {}; } }
  });
  assert.equal(blocked.observe(engine, search, ACTION.GO), null);
  assert.equal(blocked.summary().committedBlockedCount, 1);
});

test("Shadow records a failed long policy but never returns an action", () => {
  const { engine, search, pose, feedback } = routeFixture();
  const envelope = new NativeLongOptionEventEnvelopePoc("shadow", {
    pose, feedback
  });
  envelope.evaluateRoot = () => LONG_EVENT_OUTCOME.FIRE |
    LONG_EVENT_OUTCOME.DEATH;
  assert.equal(envelope.observe(engine, search, ACTION.GO), null);
  assert.equal(envelope.summary().eventClosedCount, 0);
  assert.equal(envelope.summary().deathCount, 1);
  assert.equal(envelope.summary().wouldProposeCount, 0);
});
