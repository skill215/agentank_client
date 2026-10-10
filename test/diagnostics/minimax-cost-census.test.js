"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { run, verify } = require("../../tools/agentank/diagnostics/minimax-cost-census");

const ROOT = path.resolve(__dirname, "../..");

test("HP25 cost census is external, exact, and reconciles every searched node", () => {
  const report = run({ workspaceRoot: ROOT, scenarioCount: 2, maxDepth: 2 });
  assert.equal(report.status, "PASS");
  assert.deepEqual(Object.keys(report.profiles), ["P1", "P2"]);
  assert.deepEqual(report.invariants, {
    rootRestoreFailures: 0, semanticMismatches: 0, nodeAccountingMismatchCalls: 0
  });
  for (const profile of Object.values(report.profiles)) {
    for (const phase of [profile.cold, profile.warm]) {
      assert.equal(phase.calls, 2);
      assert.ok(phase.nodes > 0);
      assert.equal(phase.nodes,
        phase.census.fastApplyByPly.reduce((sum, value) => sum + value, 0) +
        phase.census.rootSlabReplays);
      assert.equal(phase.census.nodeAccountingMismatchCalls, 0);
    }
  }
  assert.equal(verify(report).status, "PASS");
});

test("HP25 verifier rejects a node-accounting mismatch", () => {
  const report = run({ workspaceRoot: ROOT, scenarioCount: 1, maxDepth: 1 });
  report.profiles.P1.cold.census.nodeAccountingMismatchCalls = 1;
  assert.equal(verify(report).status, "FAIL");
});

test("HP25 cost census can isolate a depth and scale its node budget", () => {
  const report = run({ workspaceRoot: ROOT, scenarioCount: 1,
    minDepth: 3, maxDepth: 3, nodeBudget: 1024 });
  assert.deepEqual(Object.keys(report.profiles), ["P3"]);
  assert.equal(report.nodeBudget, 1024);
  assert.equal(report.profiles.P3.cold.calls, 1);
  assert.equal(verify(report).status, "PASS");
});

test("HP26 cost census can sweep Physical TT capacity without changing production defaults", () => {
  const report = run({ workspaceRoot: ROOT, scenarioCount: 1,
    minDepth: 3, maxDepth: 3, physicalTTEntries: 64 });
  assert.equal(report.physicalTTEntries, 64);
  assert.equal(report.profiles.P3.cold.calls, 1);
  assert.equal(verify(report).status, "PASS");
});

test("HP28 cost census can enable fixed-stack window bounds diagnostically", () => {
  const report = run({ workspaceRoot: ROOT, scenarioCount: 1,
    minDepth: 3, maxDepth: 3, windowedBounds: true });
  assert.equal(report.windowedBounds, 1);
  assert.equal(report.profiles.P3.cold.calls, 1);
  assert.equal(verify(report).status, "PASS");
});

test("HP30 cost census isolates an exact scenario offset and binds its identity", () => {
  const isolated = run({ workspaceRoot: ROOT, scenarioCount: 1, scenarioOffset: 4,
    minDepth: 3, maxDepth: 3, windowedBounds: true });
  const zero = run({ workspaceRoot: ROOT, scenarioCount: 1, scenarioOffset: 0,
    minDepth: 3, maxDepth: 3, windowedBounds: true });
  assert.equal(isolated.scenarioOffset, 4);
  assert.deepEqual(isolated.scenarioIndices, [4]);
  assert.equal(isolated.scenarioSet.scenarios[0].index, 4);
  assert.equal(isolated.profiles.P3.samples[0].scenarioIndex, 4);
  assert.deepEqual(isolated.profiles.P3.cold.census.iterationCallsByDepth.slice(1, 4),
    [1, 1, 0]);
  assert.deepEqual(isolated.profiles.P3.cold.census.selectiveIterationCallsByDepth.slice(1, 4),
    [0, 0, 1]);
  assert.equal(isolated.profiles.P3.cold.census.iterationNodesByDepth.reduce(
    (sum, value) => sum + value, 0) +
    isolated.profiles.P3.cold.census.selectiveIterationNodesByDepth.reduce(
      (sum, value) => sum + value, 0), isolated.profiles.P3.cold.nodes);
  assert.notEqual(isolated.scenarioSet.fingerprint, zero.scenarioSet.fingerprint);
  assert.equal(verify(isolated).status, "PASS");
});

test("HP30 verifier rejects a mismatched exact scenario sample", () => {
  const report = run({ workspaceRoot: ROOT, scenarioCount: 1, scenarioOffset: 4,
    minDepth: 3, maxDepth: 3, windowedBounds: true });
  report.profiles.P3.samples[0].scenarioIndex = 3;
  assert.equal(verify(report).status, "FAIL");
});

test("HP30 direct-selective diagnostic keeps P1 exact fallback and completes scenario 4 P3", () => {
  const direct = run({ workspaceRoot: ROOT, scenarioCount: 1, scenarioOffset: 4,
    minDepth: 3, maxDepth: 3, nodeBudget: 512, windowedBounds: true,
    directSelectiveDepth: true });
  const reference = run({ workspaceRoot: ROOT, scenarioCount: 1, scenarioOffset: 4,
    minDepth: 3, maxDepth: 3, nodeBudget: 620, windowedBounds: true });
  assert.equal(direct.directSelectiveDepth, 1);
  assert.deepEqual(direct.profiles.P3.cold.valueSupportDepth, { 1: 1 });
  assert.deepEqual(direct.profiles.P3.cold.selectiveCompletedDepth, { 3: 1 });
  assert.ok(direct.profiles.P3.cold.nodes < 512);
  assert.deepEqual(reference.profiles.P3.cold.selectiveCompletedDepth, { 3: 1 });
  assert.equal(verify(direct).status, "PASS");
});
