"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { DeterministicPrng } = require("../../tools/agentank/harness/deterministic-prng");
const { AllocationCounter, HighWaterTracker } = require("../../tools/agentank/harness/instrumentation");
const { SyntheticClock } = require("../../tools/agentank/harness/clock");
const { semanticFingerprint, compareSnapshots, assertRootRestored } =
  require("../../tools/agentank/harness/semantic");
const { loadFixtureSet } = require("../../tools/agentank/harness/fixture-loader");
const { createDifferentialReport } = require("../../tools/agentank/harness/differential");
const { validateSchemaObject } = require("../../tools/agentank/core/schema-validator");

const ROOT = path.resolve(__dirname, "../..");

test("fixed seed PRNG has a stable integer sequence", () => {
  const prng = new DeterministicPrng(324508639);
  assert.deepEqual([prng.nextUint32(), prng.nextUint32(), prng.nextUint32(), prng.nextUint32()],
    [3853349609, 905876785, 205526333, 3524393870]);
});

test("fixture loader returns the same raw and semantic fingerprints", () => {
  const first = loadFixtureSet(ROOT);
  const second = loadFixtureSet(ROOT);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.deepEqual(first.summary, second.summary);
  assert.equal(first.fixtures.length, 1);
});

test("semantic fingerprints preserve integer TypedArray type and values", () => {
  assert.equal(semanticFingerprint({ cells: new Uint16Array([1, 2, 3]) }),
    semanticFingerprint({ cells: new Uint16Array([1, 2, 3]) }));
  assert.notEqual(semanticFingerprint({ cells: new Uint16Array([1, 2, 3]) }),
    semanticFingerprint({ cells: new Uint32Array([1, 2, 3]) }));
  assert.throws(() => semanticFingerprint({ cells: new Float32Array([1]) }),
    { code: "NON_INTEGER_SEMANTIC_ARRAY" });
});

test("root comparator identifies and rejects an intentional mutation", () => {
  const before = { frame: 7, cells: new Uint8Array([0, 1]) };
  const restored = { cells: new Uint8Array([0, 1]), frame: 7 };
  assert.equal(assertRootRestored(before, restored).equal, true);
  const changed = { frame: 7, cells: new Uint8Array([1, 1]) };
  assert.equal(compareSnapshots(before, changed).firstDifference, "$.cells.values[0]");
  assert.throws(() => assertRootRestored(before, changed), { code: "ROOT_SNAPSHOT_MISMATCH" });
});

test("allocation and arena instrumentation fail closed", () => {
  const allocations = new AllocationCounter(0);
  const mark = allocations.mark();
  allocations.record(1);
  assert.throws(() => allocations.assertWithin(mark), { code: "ALLOCATION_BUDGET_EXCEEDED" });

  const arena = new HighWaterTracker(3);
  arena.reserve(2);
  arena.reserve(1);
  assert.deepEqual(arena.snapshot(), { capacity: 3, current: 3, peak: 3 });
  assert.throws(() => arena.reserve(1), { code: "ARENA_CAPACITY_EXCEEDED" });
  assert.equal(arena.snapshot().current, 3);
});

test("synthetic clock is integer and deterministic", () => {
  const clock = new SyntheticClock(5);
  const start = clock.nowNanoseconds();
  clock.advanceMicroseconds(17);
  assert.equal(clock.elapsedMicroseconds(start), 17);
});

test("differential report distinguishes semantic and root failures", () => {
  const pass = createDifferentialReport({ fixtureId: "IMP0-DIFF", reference: { x: 1 },
    fast: { x: 1 }, rootBefore: { y: 2 }, rootAfter: { y: 2 } }, ROOT);
  assert.equal(pass.status, "PASS");
  const fail = createDifferentialReport({ fixtureId: "IMP0-DIFF", reference: { x: 1 },
    fast: { x: 2 }, rootBefore: { y: 2 }, rootAfter: { y: 3 } }, ROOT);
  assert.equal(fail.status, "FAIL");
  assert.equal(fail.semanticEqual, false);
  assert.equal(fail.rootRestored, false);
});

test("an intentionally malformed IMP0 manifest is rejected by schema", () => {
  assert.throws(() => validateSchemaObject("imp0-benchmark-plan", { schemaVersion: 1 }, ROOT),
    { code: "SCHEMA_VALIDATION_FAILED" });
});
