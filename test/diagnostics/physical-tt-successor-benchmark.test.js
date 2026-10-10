"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { run, verify } = require(
  "../../tools/agentank/benchmark/physical-tt-successor-benchmark");

const ROOT = path.resolve(__dirname, "../..");

test("HP26 exact successor benchmark compares retained-parent and cold-child caches", () => {
  const report = run({ workspaceRoot: ROOT, scenarioCount: 2, capacities: "32,128" });
  assert.equal(report.status, "PASS");
  assert.deepEqual(report.entryCounts, [32, 128]);
  assert.equal(report.capacities[32].calls, 2);
  assert.equal(report.capacities[128].calls, 2);
  assert.equal(report.capacities[32].identicalSuccessorFailures, 0);
  assert.equal(report.capacities[128].identicalSuccessorFailures, 0);
  assert.ok(report.capacities[128].additionalBytes > 0);
  assert.deepEqual(verify(report), { status: "PASS", errors: [] });
});

test("HP26 exact successor verifier rejects a physical child mismatch", () => {
  const report = run({ workspaceRoot: ROOT, scenarioCount: 1, capacities: "32" });
  report.capacities[32].identicalSuccessorFailures = 1;
  assert.equal(verify(report).status, "FAIL");
});
