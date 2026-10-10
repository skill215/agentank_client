"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { MAX_PACKED_VALUE, deviationCacheKey, preferDeviation,
  OneDeviationRefusalValueSearch } = require(
  "../../tools/agentank/diagnostics/semantic-attack-one-deviation-value-search");

test("one-deviation cache identity includes depth and remaining privilege", () => {
  assert.notEqual(deviationCacheKey(3, 0), deviationCacheKey(3, 1));
  assert.notEqual(deviationCacheKey(3, 1), deviationCacheKey(4, 0));
  assert.ok(deviationCacheKey(1, 0) > 0);
});

test("deviation requires strict value improvement and preserves baseline ties", () => {
  assert.equal(preferDeviation(8, 7, 2, 0, 0), true);
  assert.equal(preferDeviation(7, 8, 2, 0, 0), false);
  assert.equal(preferDeviation(8, 8, 2, 0, 0), false);
  assert.equal(preferDeviation(8, 8, 0, 2, 0), true);
  assert.equal(preferDeviation(8, 8, 3, 2, 0), false);
});

test("one-deviation search is fixed-memory and starts with no synthetic owner", () => {
  const search = new OneDeviationRefusalValueSearch(128);
  assert.equal(search.maximumOwnDomain, 0);
  assert.equal(search.deviationSelectedCount, 0);
  assert.equal(search.deviationDominanceCutoffCount, 0);
  assert.equal(search.deviationActionCount.length,
    ACTION.BOOST_RIGHT_BOMB + 1);
  assert.ok(MAX_PACKED_VALUE > 0);
  assert.equal(search.ttDepth.length, 8192);
  assert.equal(search.hotAllocationCount, 0);
});

test("one-deviation TT capacity is fixed, power-of-two and explicit", () => {
  assert.equal(new OneDeviationRefusalValueSearch(128, 4096).ttDepth.length,
    4096);
  assert.throws(() => new OneDeviationRefusalValueSearch(128, 3000),
    /BP142_TT_CAPACITY_POWER_OF_TWO_REQUIRED/);
});
