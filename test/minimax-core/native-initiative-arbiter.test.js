"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { COMBAT_PURPOSE, NONE_HANDLE } =
  require("../../engine-v2/src/abi/policy-codes");
const { NativeInitiativeArbiter, INITIATIVE_REASON } =
  require("../../engine-v2/src/policy/native-initiative-arbiter");

function fixture() {
  const count = 6;
  const outcome = {
    count,
    acceptable: new Uint8Array(count).fill(1),
    dominated: new Uint8Array(count),
    robustLower: new Int16Array([100, 200, 300, 900, 800, 50]),
    expectedValue: new Int16Array([100, 200, 300, 900, 800, 50]),
    tacticalValue: new Int16Array([100, 200, 300, 900, 800, 50]),
    purposeCompleteness: new Uint16Array(count),
    combatPurpose: new Uint8Array(count),
    postFireEscape: new Uint8Array(count),
    ownCounterExposure: new Uint16Array(count),
    hitDeadline: new Uint8Array(count).fill(0xff),
    enemySafeSuccessors: new Uint8Array(count),
    immediateFatalMass: new Uint16Array(count),
    unknownMass: new Uint16Array(count),
    horizonFatalMass: new Uint16Array(count),
    earliestFatalFrame: new Uint8Array(count).fill(0xff),
    escapeSlack: new Int8Array(count),
    hard: new Uint8Array(count)
  };
  const controller = { outcome, select() { return 0; } };
  const actions = new Uint8Array([
    ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT,
    ACTION.THROW_BOMB, ACTION.FIRE, ACTION.CAST_POISON
  ]);
  const attack = {
    status: new Uint8Array(count),
    doomedEnemyColumns: new Uint8Array(count),
    frontierColumns: new Uint8Array(count)
  };
  const handles = new Uint32Array(count).fill(NONE_HANDLE);
  const sketches = { rawScore: new Int16Array(8), deadline: new Uint16Array(8) };
  const strategic = { selectEscape() { return -1; } };
  return { outcome, controller, actions, attack, handles, sketches, strategic };
}

test("native initiative suppresses an unverified bomb in navigation", () => {
  const f = fixture();
  f.handles[0] = 0;
  f.sketches.rawScore[0] = 7000;
  const arbiter = new NativeInitiativeArbiter();
  const selected = arbiter.select(3, f.strategic, f.controller, f.actions,
    null, f.attack, f.handles, f.sketches, 1);
  assert.equal(selected, 0);
  assert.equal(arbiter.lastReason, INITIATIVE_REASON.STRATEGIC_PROGRESS);
});

test("verified direct fire owns initiative before navigation", () => {
  const f = fixture();
  f.outcome.combatPurpose[4] = COMBAT_PURPOSE.DIRECT_KILL;
  f.outcome.purposeCompleteness[4] = 10000;
  f.outcome.postFireEscape[4] = 1;
  f.outcome.hitDeadline[4] = 1;
  f.attack.status[4] = 1;
  const arbiter = new NativeInitiativeArbiter();
  const selected = arbiter.select(3, f.strategic, f.controller, f.actions,
    null, f.attack, f.handles, f.sketches, 1);
  assert.equal(selected, 4);
  assert.equal(arbiter.lastReason, INITIATIVE_REASON.VERIFIED_DIRECT_FIRE);
});

test("possible fire is soft initiative but still needs a self-escape witness", () => {
  const f = fixture();
  f.outcome.combatPurpose[4] = COMBAT_PURPOSE.INTERCEPT;
  f.outcome.purposeCompleteness[4] = 6000;
  const arbiter = new NativeInitiativeArbiter();
  let selected = arbiter.select(2, f.strategic, f.controller, f.actions,
    null, f.attack, f.handles, f.sketches, 1);
  assert.notEqual(selected, 4);
  f.outcome.postFireEscape[4] = 1;
  selected = arbiter.select(2, f.strategic, f.controller, f.actions,
    null, f.attack, f.handles, f.sketches, 1);
  assert.equal(selected, 4);
  assert.equal(arbiter.lastReason, INITIATIVE_REASON.VERIFIED_INTERCEPT_FIRE);
});

test("no-acceptable fallback suppresses bomb only inside the same minimum-risk tuple", () => {
  const f = fixture();
  f.controller.outcome.acceptable.fill(0);
  f.controller.outcome.robustLower[3] = 9000;
  const arbiter = new NativeInitiativeArbiter();
  let selected = arbiter.select(3, f.strategic, f.controller, f.actions,
    null, f.attack, f.handles, f.sketches, 1);
  assert.notEqual(selected, 3);
  f.controller.outcome.immediateFatalMass.fill(100);
  f.controller.outcome.immediateFatalMass[3] = 0;
  selected = arbiter.select(3, f.strategic, f.controller, f.actions,
    null, f.attack, f.handles, f.sketches, 1);
  assert.equal(selected, 3);
});

test("committed escape stays ahead of every attack proposal", () => {
  const f = fixture();
  f.outcome.combatPurpose[4] = COMBAT_PURPOSE.DIRECT_KILL;
  f.outcome.purposeCompleteness[4] = 10000;
  f.outcome.postFireEscape[4] = 1;
  f.strategic.selectEscape = () => 1;
  const arbiter = new NativeInitiativeArbiter();
  const selected = arbiter.select(1, f.strategic, f.controller, f.actions,
    null, f.attack, f.handles, f.sketches, 1);
  assert.equal(selected, 1);
  assert.equal(arbiter.lastReason, INITIATIVE_REASON.COMMITTED_ESCAPE);
});

test("three completed turns hand ownership to an acceptable GO", () => {
  const f = fixture();
  const arbiter = new NativeInitiativeArbiter();
  const projected = new Uint16Array([2, 1, 1, 1, 1, 1]);
  const selected = arbiter.select(3, f.strategic, f.controller, f.actions,
    null, f.attack, f.handles, f.sketches, 1, 3, projected, 1);
  assert.equal(selected, 0);
  assert.equal(arbiter.lastReason, INITIATIVE_REASON.STABILITY_GO);
});

test("blocked GO never satisfies stability or navigation progress", () => {
  const f = fixture();
  f.handles[0] = 0;
  f.sketches.rawScore[0] = 10000;
  const projected = new Uint16Array(6).fill(1);
  const arbiter = new NativeInitiativeArbiter();
  const selected = arbiter.select(3, f.strategic, f.controller, f.actions,
    null, f.attack, f.handles, f.sketches, 1, 3, projected, 1);
  assert.notEqual(selected, 0);
  assert.notEqual(arbiter.lastReason, INITIATIVE_REASON.STABILITY_GO);
});
