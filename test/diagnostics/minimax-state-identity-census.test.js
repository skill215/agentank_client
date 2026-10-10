"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { run, verify } = require(
  "../../tools/agentank/diagnostics/minimax-state-identity-census");

const ROOT = path.resolve(__dirname, "../..");

test("HP27 state identity census is an exact external observer", () => {
  const report = run({ workspaceRoot: ROOT, scenarioCount: 2, nodeBudget: 512 });
  assert.equal(report.status, "PASS");
  assert.equal(report.census.directProbes,
    report.census.directHits + report.census.directMisses);
  assert.equal(report.census.directProbes,
    report.census.uniqueExactIdentities + report.census.repeatedExactProbes);
  assert.ok(report.census.uniquePhysicalStates > 0);
  assert.deepEqual(verify(report), { status: "PASS", errors: [] });
});

test("HP27 verifier rejects an identity accounting mismatch", () => {
  const report = run({ workspaceRoot: ROOT, scenarioCount: 1 });
  report.census.uniqueExactIdentities += 1;
  assert.equal(verify(report).status, "FAIL");
});
