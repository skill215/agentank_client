"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ACTION, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { STRATEGY_PURPOSE, COMBAT_PURPOSE, GLOBAL_MODE, NONE_HANDLE } =
  require("../../engine-v2/src/abi/policy-codes");
const { OPTION_KIND, OptionPortfolioSlab } =
  require("../../engine-v2/src/policy/option-portfolio");

test("one primitive action keeps independent option identities", () => {
  const slab = new OptionPortfolioSlab(12);
  const arrays = [];
  arrays[ARRAY.SCALAR] = new Uint16Array(32);
  arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 7;
  arrays[ARRAY.TANK_CELL] = new Uint16Array([1, 8]);
  const bands = { purpose: new Uint16Array([
    STRATEGY_PURPOSE.AIM_SETUP | STRATEGY_PURPOSE.STAR_COLLECT |
      STRATEGY_PURPOSE.NEUTRAL_POSITION]) };
  const combat = { directKill: new Uint8Array(1),
    purposeCompleteness: new Uint16Array([7000]) };
  const escape = { member: new Uint8Array(1), supportStatus: 0 };
  const handles = new Uint32Array([0]);
  const sketches = { used: 1, targetSignature: new Uint32Array([11]),
    deadline: new Uint16Array([6]) };
  const count = slab.build(new Uint8Array([ACTION.TURN_LEFT]), 1, bands,
    combat, escape, handles, sketches, { arrays });
  assert.equal(count, 3);
  assert.deepEqual(Array.from(slab.kind.subarray(0, count)), [
    OPTION_KIND.ATTACK_SETUP, OPTION_KIND.STAR_CONTROL, OPTION_KIND.POSITION]);
  assert.equal(slab.optionCountByRow[0], 3);
  assert.equal(slab.aliasRootCount, 1);
  assert.equal(slab.capacityFailureCount, 0);
  assert.equal(slab.hotAllocationCount, 0);
});

test("option capacity failure is explicit", () => {
  const slab = new OptionPortfolioSlab(1);
  assert.equal(slab.add(0, OPTION_KIND.POSITION, NONE_CELL), 0);
  assert.equal(slab.add(0, OPTION_KIND.STAR_CONTROL, 4), -1);
  assert.equal(slab.capacityFailureCount, 1);
});

test("selection funnel distinguishes verified and unverified resource ownership", () => {
  const slab = new OptionPortfolioSlab(8);
  slab.add(0, OPTION_KIND.ATTACK_SETUP, 4, 1, 8, 0, 1);
  slab.add(0, OPTION_KIND.STAR_CONTROL, 7, 2, 8, 0, 1);
  slab.add(1, OPTION_KIND.RESOURCE, 4, 3, 4, 0, 1);
  slab.optionCountByRow[0] = 2; slab.optionCountByRow[1] = 1;
  slab.observeSelection(0, ACTION.TURN_LEFT, 0);
  slab.observeSelection(1, ACTION.CAST_POISON, 0);
  slab.observeSelection(1, ACTION.CAST_POISON, 1);
  assert.equal(slab.selectionCount, 3);
  assert.equal(slab.selectedAliasCount, 1);
  assert.equal(slab.selectedAttackCount, 1);
  assert.equal(slab.selectedResourceCount, 2);
  assert.equal(slab.unverifiedResourceCount, 1);
  assert.equal(slab.verifiedResourceCount, 1);
});

test("typed generator emits only targeted objectives and verified resources", () => {
  const slab = new OptionPortfolioSlab(16); const arrays = [];
  arrays[ARRAY.SCALAR] = new Uint16Array(32);
  arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 7;
  arrays[ARRAY.TANK_CELL] = new Uint16Array([1, 8]);
  arrays[ARRAY.TANK_POISON_UNTIL] = new Uint16Array([0xffff, 0xffff]);
  const actions = new Uint8Array([
    ACTION.FIRE, ACTION.GO, ACTION.CAST_POISON, ACTION.THROW_BOMB]);
  const bands = { starPurpose: new Uint16Array([
    0, STRATEGY_PURPOSE.STAR_COLLECT, 0, 0]) };
  const combat = { purposeFlags: new Uint8Array([
    COMBAT_PURPOSE.DIRECT_KILL, 0, 0, 0]),
  directKill: new Uint8Array([1, 0, 0, 0]),
  purposeCompleteness: new Uint16Array([8000, 0, 0, 0]),
  postFireEscape: new Uint8Array([1, 0, 0, 0]) };
  const escape = { member: new Uint8Array(4), supportStatus: 0 };
  const handles = new Uint32Array(4).fill(NONE_HANDLE);
  const sketches = { used: 0, targetSignature: new Uint32Array(1),
    deadline: new Uint16Array(1) };
  const count = slab.buildTyped(actions, 4, bands, combat, escape, handles,
    sketches, { arrays }, GLOBAL_MODE.NORMAL, 1);
  assert.equal(count, 3);
  assert.deepEqual(Array.from(slab.kind.subarray(0, count)), [
    OPTION_KIND.DIRECT_KILL, OPTION_KIND.STAR_CONTROL, OPTION_KIND.RESOURCE]);
  assert.equal(slab.optionCountByRow[3], 0);
  assert.equal(slab.rowWithoutOptionCount, 1);
});
