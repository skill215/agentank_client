"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveFrozenV1 } = require("../../engine-v3/src/legacy/default-source");
const { componentOptions, implementationId, overview } =
  require("../../tools/agentank/diagnostics/v3-component-arena");
const { COMBAT_PURPOSE, PLAN_PURPOSE } =
  require("../../engine-v2/src/abi/policy-codes");
const cohort =
  require("../../tools/agentank/diagnostics/v2-component-transplant-cohort");
const transplant =
  require("../../tools/agentank/diagnostics/v2-component-transplant");

const ROOT = path.resolve(__dirname, "../..");

test("CTR0 gives V3 hosts explicit non-V2 implementation identities", () => {
  assert.equal(implementationId("BASE_V3"), "V3_BASE");
  assert.equal(implementationId("V3R8_NATIVE_BEST"), "V3_NATIVE_BASELINE");
  assert.equal(implementationId("VC2_HARD_ACTIVE"), "V3_PLUS_VC2_HARD_ACTIVE");
  assert.equal(implementationId("BASE_V3").includes("V2"), false);
  assert.equal(implementationId("V3R8_NATIVE_BEST").includes("V2"), false);
});

test("V3 component summaries retain challenger/control semantics without claiming V2", () => {
  const match = {
    comparison: {
      challengerImplementation: "V3_PLUS_TEST",
      controlImplementation: "V3_BASE"
    },
    analysisOutcome: "DRAW",
    candidateSeat: 0,
    counts: { crashes: [0, 0], stars: [0, 0] },
    candidate: { actionCounts: {}, totalRuntimeMicros: 1, p95RuntimeMicros: 1 },
    baseline: { actionCounts: {}, totalRuntimeMicros: 1, p95RuntimeMicros: 1 },
    candidateController: { bridge: null }
  };
  const value = overview([match, { ...match, candidateSeat: 1 }], 2);
  assert.deepEqual(value.identities, {
    challenger: "V3_PLUS_TEST",
    control: "V3_BASE"
  });
  assert.deepEqual(value.analysis, {
    challengerWins: 0,
    controlWins: 0,
    draws: 2,
    scoreBasisPoints: 5000,
    scorePercent: "50.00"
  });
});

test("CTR fresh inventory excludes every exposed VC0 and V3R scenario", () => {
  const files = transplant.locations(ROOT);
  const value = cohort.validateInventory(JSON.parse(
    fs.readFileSync(files.inventory, "utf8")));
  const exposed = new Set(value.exposed.scenarioFingerprints);
  assert.equal(value.exposed.uniqueScenarios, 896);
  assert.equal(value.fresh.scenarios.some(item =>
    exposed.has(item.scenarioFingerprint)), false);
  assert.equal(value.fresh.availableScenarios + value.exposed.uniqueScenarios,
    value.source.uniqueScenarios);
});

test("CTR0 identity binds V3_BASE to V1 and keeps real V2 separately hashed", () => {
  const files = transplant.locations(ROOT);
  const identity = JSON.parse(fs.readFileSync(files.identity, "utf8"));
  const v1 = resolveFrozenV1(ROOT);
  assert.equal(identity.implementations.V3_BASE.behaviorSourceSha256, v1.sha256);
  assert.equal(identity.implementations.V3_BASE.isV2, false);
  assert.equal(identity.implementations.V3_NATIVE_BASELINE.isV2, false);
  assert.equal(identity.implementations.V2_BASE.isV2, true);
  assert.notEqual(identity.implementations.V2_BASE.sourceSha256, v1.sha256);
  assert.equal(identity.legacyEvidenceRelabel.correctedLabel,
    "V3_NATIVE_BASELINE_EQUIVALENCE");
  assert.match(identity.cohort.readiness, /^BLOCKED_NEEDS_\d+_FRESH_SCENARIOS$/);
});

test("blind CTR cohort cannot freeze below its fixed 368-scenario denominator", () => {
  const files = transplant.locations(ROOT);
  const value = cohort.validateInventory(JSON.parse(
    fs.readFileSync(files.inventory, "utf8")));
  if (value.fresh.ready) {
    assert.equal(cohort.buildBlindCohort(value).scenarios.length,
      cohort.REQUIRED_FRESH_SCENARIOS);
  } else {
    assert.throws(() => cohort.buildBlindCohort(value),
      /CTR_BLIND_COHORT_INSUFFICIENT/);
  }
});

test("CTR4 combat modes isolate one purpose mask instead of activating the whole package", () => {
  assert.equal(componentOptions("CTR4_DIRECT_KILL").bridgeOptions.combatPurposeMask,
    COMBAT_PURPOSE.DIRECT_KILL);
  assert.equal(componentOptions("CTR4_AIM_SETUP").bridgeOptions.combatPurposeMask,
    COMBAT_PURPOSE.AIM_SETUP);
  assert.equal(componentOptions("CTR4_INTERCEPT").bridgeOptions.combatPurposeMask,
    COMBAT_PURPOSE.INTERCEPT);
  assert.equal(componentOptions("CTR4_INTERCEPT").bridgeOptions.combatPrimaryPurpose,
    PLAN_PURPOSE.INTERCEPT);
  assert.equal(componentOptions("CTR4_ESCAPE_DENIAL").bridgeOptions.combatPurposeMask,
    COMBAT_PURPOSE.ESCAPE_DENIAL);
  assert.equal(componentOptions("CTR4_ESCAPE_DENIAL").bridgeOptions.combatPrimaryPurpose,
    PLAN_PURPOSE.ESCAPE_FORCING);
  assert.equal(componentOptions("CTR4_SURVIVOR_FRONTIER").bridgeOptions.combatRequireFrontier,
    true);
});

test("CTR0-CTR8 report keeps V3 as a control and blocks V2 recovery without a positive component", () => {
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "engine-v3",
    "v2-component-transplant-acceptance.json"), "utf8"));
  assert.equal(report.v3Base.role, "EXPERIMENT_CONTROL_ONLY");
  assert.equal(report.v3Base.includedInV2Bundle, false);
  assert.deepEqual(report.best.behaviorPositive, []);
  assert.deepEqual(report.best.performancePositive, []);
  assert.deepEqual(report.best.enabledInV3ComponentBest, []);
  assert.equal(report.best.v3ComponentBest, "V3_BASE");
  assert.equal(report.best.v2RepairedCreated, false);
  assert.equal(report.realV2Base.discovery.analysis.scoreBasisPoints, 938);
  assert.equal(report.stages.find(item => item.stage === "CTR7").status, "BLOCKED");
  assert.equal(report.stages.find(item => item.stage === "CTR8").status, "BLOCKED");
  assert.equal(report.data.blindHoldoutRead, false);
  assert.equal(report.officialPlatformOperationPerformed, false);
});

test("CTR5 valid navigation experiment records the corrected before-emission ordering", () => {
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "engine-v3",
    "v2-component-transplant-acceptance.json"), "utf8"));
  const strategy = report.components.find(item =>
    item.id === "TARGET_GENERATION_STRATEGIC_ARBITER");
  assert.equal(strategy.classification, "NEGATIVE");
  assert.equal(strategy.extra, undefined);
  assert.equal(strategy.ports.failureNotPrepared, 0);
  assert.equal(strategy.ports.completeCount, 496);
  assert.equal(strategy.ports.qualifiedCount, 467);
  assert.equal(strategy.scoreBasisPoints, 2500);
});
