"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const frontier = require("../../tools/agentank/diagnostics/minimax-support-frontier");

test("support frontier separates depth, representative width, node and work budgets", () => {
  const loaded = frontier.loadContract(); const profiles = frontier.profiles(loaded.contract);
  assert.equal(profiles.length, 60);
  assert.ok(profiles.some(profile => profile.id === "P1W2N192-WU60000"));
  assert.ok(profiles.some(profile => profile.id === "P2W4N2048-WUINF"));
  assert.ok(profiles.every(profile => profile.depth === 1 || profile.depth === 2));
  assert.ok(profiles.every(profile => profile.width >= 2 && profile.width <= 4));
  assert.deepEqual(loaded.contract.rules, {
    measureExactRepresentativeSupport: true,
    compareCacheOffColdWarm: true,
    preserveHp9WorkCharges: true,
    winRateIsNotAPerformanceGate: true,
    rootRestoreFailuresMaximum: 0,
    hotAllocationsMaximum: 0,
    cacheSemanticMismatchesMaximum: 0
  });
});

test("small support frontier run verifies cache, restore and allocation invariants", () => {
  const report = frontier.benchmark({ scenarioCount: 1, warmupBatches: 0,
    measuredBatches: 1, depths: [2], widths: [4], nodeBudgets: [2048],
    workUnitBudgets: [0] });
  assert.equal(report.status, "PASS");
  assert.deepEqual(frontier.verify(report), { status: "PASS", errors: [] });
  assert.equal(report.profileCount, 1); assert.equal(report.measuredCallsPerProfile, 1);
  const full = report.summaries["P2W4N2048-WUINF"];
  assert.equal(full.cacheOff.calls, 1); assert.equal(full.cold.calls, 1);
  assert.equal(full.warm.calls, 1);
  assert.ok(full.cacheOff.exactSupportPer10000 === 0 ||
    full.cacheOff.exactSupportPer10000 === 10000);
  assert.deepEqual(report.invariantTotals, { rootRestoreFailures: 0,
    rootRestoreMismatches: 0, hotAllocations: 0, cacheSemanticMismatches: 0 });
});

test("support frontier refuses a cache semantic mismatch", () => {
  const report = frontier.benchmark({ scenarioCount: 1, warmupBatches: 0,
    measuredBatches: 1, depths: [1], widths: [2], nodeBudgets: [192],
    workUnitBudgets: [60000] });
  report.invariantTotals.cacheSemanticMismatches = 1;
  report.fingerprint = require("../../tools/agentank/core/hash").fingerprintObject(
    { ...report, fingerprint: "" });
  const verified = frontier.verify(report);
  assert.equal(verified.status, "FAIL");
  assert.ok(verified.errors.includes("INVARIANT:cacheSemanticMismatches:1"));
});
