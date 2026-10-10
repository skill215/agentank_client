"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { SelectiveGeometrySearchProbe } = require(
  "../../tools/agentank/diagnostics/selective-geometry-search-probe");

function fakeEngine() {
  return {
    runtime: { runtimeConfig: require("../../engine-v2/src/generated/runtime-config").RUNTIME_CONFIG },
    riskProfile: undefined,
    ourActions: new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.FIRE, ACTION.THROW_BOMB]),
    ourArguments: new Uint16Array([65535, 65535, 65535, 65535]),
    riskController: { outcome: {
      acceptable: new Uint8Array([1, 1, 1, 1]),
      dominated: new Uint8Array([0, 0, 0, 1]),
      tacticalValue: new Int16Array([100, 300, 250, 1000]),
      expectedValue: new Int16Array([100, 300, 250, 1000]),
      combatPurpose: new Uint8Array([0, 0, 1, 1])
    } }
  };
}

test("selective geometry keeps selected ordinary and qualified attack rows", () => {
  const engine = fakeEngine(); const probe = new SelectiveGeometrySearchProbe(engine, 3);
  assert.equal(probe.selectCandidates(engine, 0, 4), 3);
  assert.deepEqual(Array.from(probe.rowMap.slice(0, 3)), [0, 1, 2]);
});

test("dominated high-score attack cannot enter the compact geometry set", () => {
  const engine = fakeEngine(); const probe = new SelectiveGeometrySearchProbe(engine, 2);
  assert.equal(probe.selectCandidates(engine, 0, 4), 2);
  assert.deepEqual(Array.from(probe.rowMap.slice(0, 2)), [0, 1]);
});

test("selected row lookup requires exact argument unless action identity is unique", () => {
  const engine = fakeEngine(); const probe = new SelectiveGeometrySearchProbe(engine, 3);
  assert.equal(probe.selectedRow(engine, ACTION.GO, 65535, 4), 0);
  assert.equal(probe.selectedRow(engine, ACTION.FIRE, 123, 4), 2);
  engine.ourActions[3] = ACTION.FIRE;
  assert.equal(probe.selectedRow(engine, ACTION.FIRE, 123, 4), -1);
});

test("selective geometry probe owns fixed construction-time memory", () => {
  const probe = new SelectiveGeometrySearchProbe(fakeEngine(), 3);
  assert.equal(probe.hotAllocationCount, 0);
  assert.equal(probe.summary().attempts, 0);
});

test("qualified full winner cannot come from a Risk rejected row", () => {
  const engine = fakeEngine(); const probe = new SelectiveGeometrySearchProbe(engine, 3);
  const score = new Int32Array([0, 10, 20, 1000]);
  assert.equal(probe.bestQualifiedRow(engine, score, 4, 0), 2);
});
