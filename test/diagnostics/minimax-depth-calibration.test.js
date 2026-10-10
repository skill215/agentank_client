"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const calibration = require(
  "../../tools/agentank/diagnostics/minimax-depth-calibration");

test("depth calibration identity covers the Physical TT implementation", () => {
  assert.ok(calibration.SOURCE_FILES.includes("engine-v2/src/cache/production-cache.js"));
  assert.ok(calibration.SOURCE_FILES.includes("engine-v2/src/abi/cache-runtime-codes.js"));
});

test("depth calibration contract separates Physical and Information continuation depth", () => {
  const loaded = calibration.loadContract(); const profiles = calibration.profiles(loaded.contract);
  assert.deepEqual(profiles.filter(item => item.kind === "PHYSICAL").map(item => item.id),
    ["P1", "P2", "P3", "P4", "P5", "P6"]);
  assert.ok(profiles.some(item => item.id === "I1W1-P0"));
  assert.ok(profiles.some(item => item.id === "I1W4-P5"));
  assert.ok(profiles.every(item => item.requestedDepth ===
    item.requestedInformationRootDepth + item.requestedPhysicalContinuationDepth));
  assert.equal(loaded.contract.rules.winRateIsNotAPerformanceGate, true);
});

test("small calibration run is self-verifying and records cold and warm lanes", () => {
  const report = calibration.benchmark({ scenarioCount: 1, warmupBatches: 0,
    measuredBatches: 1 });
  assert.equal(report.status, "PASS");
  assert.deepEqual(calibration.verify(report), { status: "PASS", errors: [] });
  assert.equal(report.profileCount, 24);
  assert.equal(report.measuredCallsPerProfile, 1);
  assert.ok(report.summaries.P1.cold.p95Micros >= 0);
  assert.ok(report.summaries.P1.cold.meanNodes >= 0);
  assert.ok(report.summaries.P1.warm.p95Micros >= 0);
  assert.equal(report.summaries.P1.invariants.warmColdSemanticMismatches, 0);
  assert.ok(report.summaries.P1.warmCompletedDepthHistogram);
  assert.ok(report.summaries.P1.valueSupportDepthHistogram);
  assert.ok(report.summaries.P1.valueSupportExpansionLimitHistogram);
  assert.ok(report.summaries.P1.warmValueSupportDepthHistogram);
  assert.ok(report.summaries.P1.cacheDepthGainHistogram);
  assert.equal(report.scenarioSet.count, 1);
  assert.equal(report.scenarioSet.scenarios.length, 1);
  assert.match(report.harness.fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(report.invariantTotals, { rootRestoreFailures: 0,
    rootTransitionReplayFailures: 0, rootRestoreMismatches: 0,
    hotAllocations: 0, warmColdSemanticMismatches: 0 });
  assert.deepEqual(report.features, { rootTransitionSlab: 1, selectiveContinuation: 0,
    successorTTPV: 1, windowedBounds: 0 });
  assert.ok(report.summaries.P1.selectiveCompletedDepthHistogram);
  assert.ok(report.summaries.P1.exactOwnerEarlyAborts >= 0);
  assert.ok(report.summaries.P1.rootTransitionHits.p95 > 0);
});

test("depth calibration can ablate RootTransitionSlab without changing the source identity", () => {
  const enabled = calibration.benchmark({ scenarioCount: 1, warmupBatches: 0,
    measuredBatches: 1, rootTransitionsEnabled: true });
  const disabled = calibration.benchmark({ scenarioCount: 1, warmupBatches: 0,
    measuredBatches: 1, rootTransitionsEnabled: false });
  assert.equal(enabled.source.fingerprint, disabled.source.fingerprint);
  assert.equal(enabled.harness.fingerprint, disabled.harness.fingerprint);
  assert.deepEqual(enabled.features, { rootTransitionSlab: 1, selectiveContinuation: 0,
    successorTTPV: 1, windowedBounds: 0 });
  assert.deepEqual(disabled.features, { rootTransitionSlab: 0, selectiveContinuation: 0,
    successorTTPV: 1, windowedBounds: 0 });
  assert.ok(enabled.summaries.P1.rootTransitionHits.p95 > 0);
  assert.equal(disabled.summaries.P1.rootTransitionHits.p95, 0);
  assert.equal(calibration.compare(disabled, enabled).status, "PASS");
});

test("depth calibration can ablate HP6 selective continuation with one source identity", () => {
  const disabled = calibration.benchmark({ scenarioCount: 2, warmupBatches: 0,
    measuredBatches: 1, selectiveContinuationEnabled: false });
  const enabled = calibration.benchmark({ scenarioCount: 2, warmupBatches: 0,
    measuredBatches: 1, selectiveContinuationEnabled: true });
  assert.equal(enabled.source.fingerprint, disabled.source.fingerprint);
  assert.equal(enabled.harness.fingerprint, disabled.harness.fingerprint);
  assert.equal(disabled.features.selectiveContinuation, 0);
  assert.equal(enabled.features.selectiveContinuation, 1);
  assert.equal(calibration.compare(disabled, enabled).status, "PASS");
});

test("depth calibration can ablate HP8 Successor-TT PV with one source identity", () => {
  const disabled = calibration.benchmark({ scenarioCount: 2, warmupBatches: 0,
    measuredBatches: 1, successorTTPVEnabled: false });
  const enabled = calibration.benchmark({ scenarioCount: 2, warmupBatches: 0,
    measuredBatches: 1, successorTTPVEnabled: true });
  assert.equal(enabled.source.fingerprint, disabled.source.fingerprint);
  assert.equal(enabled.harness.fingerprint, disabled.harness.fingerprint);
  assert.equal(disabled.features.successorTTPV, 0);
  assert.equal(enabled.features.successorTTPV, 1);
  assert.equal(calibration.compare(disabled, enabled).status, "PASS");
});

test("depth calibration can ablate HP28 window bounds with one source identity", () => {
  const disabled = calibration.benchmark({ scenarioCount: 2, warmupBatches: 0,
    measuredBatches: 1, selectiveContinuationEnabled: true,
    windowedBoundsEnabled: false });
  const enabled = calibration.benchmark({ scenarioCount: 2, warmupBatches: 0,
    measuredBatches: 1, selectiveContinuationEnabled: true,
    windowedBoundsEnabled: true });
  assert.equal(enabled.source.fingerprint, disabled.source.fingerprint);
  assert.equal(enabled.harness.fingerprint, disabled.harness.fingerprint);
  assert.equal(disabled.features.windowedBounds, 0);
  assert.equal(enabled.features.windowedBounds, 1);
  assert.equal(calibration.compare(disabled, enabled).status, "PASS");
});

test("comparison reports depth completion and performance independently from gameplay", () => {
  const baseline = calibration.benchmark({ scenarioCount: 1, warmupBatches: 0,
    measuredBatches: 1 });
  const candidate = JSON.parse(JSON.stringify(baseline));
  candidate.createdAt = new Date(Date.parse(baseline.createdAt) + 1000).toISOString();
  candidate.summaries.P3.requestedCompletionPer10000 += 1000;
  candidate.summaries.P3.cold.p95Micros += 7;
  candidate.source.fingerprint = "f".repeat(64);
  candidate.fingerprint = require("../../tools/agentank/core/hash").fingerprintObject(
    { ...candidate, fingerprint: "" });
  const compared = calibration.compare(baseline, candidate);
  assert.equal(compared.status, "PASS"); assert.equal(compared.sourceChanged, 1);
  assert.equal(compared.profiles.P3.requestedCompletionDelta, 1000);
  assert.equal(compared.profiles.P3.coldP95MicrosDelta, 7);
  assert.equal(Object.hasOwn(compared, "wins"), false);
});

test("frozen baseline unwraps to the measured report before comparison", () => {
  const report = calibration.benchmark({ scenarioCount: 1, warmupBatches: 0,
    measuredBatches: 1 });
  const baseline = { schemaVersion: 1,
    objectKind: "MINIMAX_DEPTH_CALIBRATION_BASELINE_V1", report };
  const compared = calibration.compare(calibration.unwrapReport(baseline), report);
  assert.equal(compared.status, "PASS");
  assert.equal(Object.keys(compared.profiles).length, report.profileCount);
  assert.equal(compared.profiles.P6.requestedCompletionDelta, 0);
});

test("source status requires recalibration after a Minimax fingerprint change", () => {
  const report = { source: calibration.sourceIdentity(), harness: calibration.harnessIdentity() };
  assert.equal(calibration.status(process.cwd(), report).status, "CURRENT");
  const stale = { source: { fingerprint: "0".repeat(64) },
    harness: calibration.harnessIdentity() };
  assert.equal(calibration.status(process.cwd(), stale).status, "RECALIBRATION_REQUIRED");
});
