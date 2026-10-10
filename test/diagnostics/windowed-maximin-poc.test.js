"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { run, verify } = require("../../tools/agentank/diagnostics/windowed-maximin-poc");

const ROOT = path.resolve(__dirname, "../..");

test("HP28 windowed maximin POC preserves exact action and value", () => {
  const report = run({ workspaceRoot: ROOT, scenarioCount: 4, depth: 2 });
  assert.equal(report.status, "PASS");
  assert.equal(report.invariants.valueMismatches, 0);
  assert.equal(report.invariants.actionMismatches, 0);
  assert.equal(report.invariants.rootRestoreFailures, 0);
  assert.deepEqual(verify(report), { status: "PASS", errors: [] });
});

test("HP28 verifier rejects an unsound bound result", () => {
  const report = run({ workspaceRoot: ROOT, scenarioCount: 1, depth: 2 });
  report.invariants.valueMismatches = 1;
  assert.equal(verify(report).status, "FAIL");
});
