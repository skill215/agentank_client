"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { VARIANTS, mergeActionTrace } = require("../../tools/agentank/simulation/paired-arena");
const { readPlan, pairedSummary, repetitionSummary, summarizeExact, selectTraceCases,
  analyzeTrace } = require("../../tools/agentank/diagnostics/v1-v2-paired-diagnostic");
const { positiveInteger, duration } = require("../../tools/agentank/cli/v1-v2-diagnostic");
const { loadRollingV1Scenarios } =
  require("../../tools/agentank/simulation/historical-scenarios");
const { loadDd9Assignment } = require("../../tools/agentank/simulation/dd9-assignment");
const { readPlan: readRuntimePlan, parametersFor, qualifyProfile, selectProfile } =
  require("../../tools/agentank/benchmark/v1-v2-runtime-matrix");
const { compareArenas, traceCoverage } =
  require("../../tools/agentank/qualification/v2-local-release");
const { FAILURE_CLASS, classifyReplay, sameOutcomeAndActions, frameSettlement } =
  require("../../tools/agentank/diagnostics/v1-v2-failure-analysis");

function match(id, variantId, family, seat, winner, cause = "NONE", frames = 30, repetition = 0) {
  return { matchId: `${id}:${variantId}:r${repetition}`, historicalMatchUrlId: id,
    historicalRole: "DISCOVERY", scenarioFingerprint: "a".repeat(64), mapHash: "b".repeat(64),
    originalSubjectSeat: 0, repetition, variantId, family, v2Seat: seat,
    result: { winnerImplementation: winner, reason: frames === 128 ? "frames" : "crashed" },
    frames, counts: { v2CrashCause: cause },
    v1: { timeoutCount: 0, errorCount: 0, totalRuntimeMicros: 10, actionCounts: { go: 1 } },
    v2: { timeoutCount: 0, errorCount: 0, totalRuntimeMicros: 20, actionCounts: { GO: 1 } } };
}

test("diagnostic plan requires repeated exact four-cell Discovery execution", () => {
  const { plan } = readPlan(process.cwd());
  assert.equal(plan.evidenceLane, "DISCOVERY"); assert.ok(plan.repetitions >= 2);
  assert.deepEqual(plan.roles, ["DISCOVERY", "CALIBRATION", "FROZEN_REGRESSION"]);
  assert.equal(VARIANTS.length, 4); assert.equal(plan.allowProductionMutation, false);
});

test("paired analysis separates implementation sweeps from seat splits", () => {
  const matches = [match("a", VARIANTS[0].variantId, "NATIVE", 1, "v1"),
    match("a", VARIANTS[1].variantId, "NATIVE", 0, "v1"),
    match("b", VARIANTS[0].variantId, "NATIVE", 1, "v2"),
    match("b", VARIANTS[1].variantId, "NATIVE", 0, "v1")];
  const paired = pairedSummary(matches);
  assert.equal(paired.native.v2Swept, 1); assert.equal(paired.native.split, 1);
  const summary = summarizeExact(matches, 4);
  assert.equal(summary.complete, true); assert.equal(summary.v2Losses, 3);
});

test("repetition instability and trace selection retain different failure strata", () => {
  const values = [match("a", VARIANTS[0].variantId, "NATIVE", 1, "v1", "BOMB", 12, 0),
    match("a", VARIANTS[0].variantId, "NATIVE", 1, "v2", "NONE", 40, 1),
    match("b", VARIANTS[1].variantId, "NATIVE", 0, "v1",
      "PROJECTILE_OR_COLLISION", 80, 0)];
  assert.equal(repetitionSummary(values).unstableGroupCount, 1);
  const selected = selectTraceCases(values, 3);
  assert.deepEqual(new Set(selected.map(item => item.counts.v2CrashCause)),
    new Set(["BOMB", "PROJECTILE_OR_COLLISION"]));
});

test("trace classifier distinguishes Hard, runtime reduction and mirror divergence", () => {
  const exact = match("a", VARIANTS[0].variantId, "NATIVE", 1, "v1", "BOMB", 12, 0);
  const frame = { frame: 11, action: "TURN_LEFT", root: "OK", informationComplete: false,
    selectedHard: "REJECT_PROVEN", allowCount: 0, proof: "UNKNOWN", completedDepth: 0,
    depthNodes: 0, score: -1, runtimeMode: 2, fallback: true, state: {}, candidates: [] };
  const mirror = { ...exact, result: { winnerImplementation: "v2", reason: "crashed" },
    replay: { records: [[], [], [], [], [], [], [], [], [], [], [],
      [{ type: "tank", action: "crashed", index: 1 }]] },
    v2: { diagnosticFrames: [frame], layerTotals: { avoidableHardRejects: 0 } } };
  const analysis = analyzeTrace(exact, mirror, 6);
  assert.equal(analysis.mirrorDiverged, true);
  assert.ok(analysis.classifications.includes("BOMB_DEATH_WINDOW"));
  assert.ok(analysis.classifications.includes("ALL_ACTIONS_PROVEN_LOSS_NEAR_TERMINAL"));
  assert.ok(analysis.classifications.includes("REDUCED_RUNTIME_MODE_NEAR_TERMINAL"));
});

test("diagnostic CLI normalizes progress cadence and human durations", () => {
  assert.equal(positiveInteger("8", 32), 8);
  assert.equal(positiveInteger("0", 32), 32);
  assert.equal(positiveInteger("bad", 32), 32);
  assert.equal(duration(9.25), "9.3s");
  assert.equal(duration(65), "1m05s");
  assert.equal(duration(7265), "2h01m");
});

test("working arena derives the rolling V1 corpus without a fixed battle count", () => {
  const { snapshot, scenarios } = loadRollingV1Scenarios(process.cwd());
  const { assignment } = loadDd9Assignment(process.cwd());
  assert.equal(scenarios.length, snapshot.matchUrlIds.length);
  assert.equal(new Set(snapshot.matchUrlIds).size, snapshot.matchUrlIds.length);
  assert.equal(new Set(scenarios.map(item => item.matchUrlId)).size, scenarios.length);
  assert.ok(scenarios.length >= assignment.assignments.length);
  for (const scenario of scenarios) {
    assert.equal(scenario.schemaVersion, 1);
    assert.equal(scenario.scenarioKind, "HISTORICAL_MAP_STAR_SEQUENCE");
    assert.equal(scenario.fingerprint.length, 64);
    assert.equal(scenario.starts.length, 2);
    assert.ok(scenario.stars.length > 0);
  }
});

test("action trace aligns both implementations and retains V2 decision layers", () => {
  const v1 = { actionFrames: [{ frame: 7, action: "fire", runtimeMicros: 20 }] };
  const v2 = { actionFrames: [{ frame: 7, action: "TURN_LEFT", runtimeMicros: 10,
    root: "OK", informationComplete: false, selectedHard: "ALLOW", allowCount: 5,
    proof: "UNKNOWN", proofCompletedDepth: 0, proofNodes: 0, completedDepth: 1,
    depthNodes: 24, score: 100, runtimeMode: 2, fallback: false, invalidFallback: false }] };
  const trace = mergeActionTrace(v1, v2, 0, 1, ["stun", "poison"]);
  assert.equal(trace.length, 1); assert.equal(trace[0].seats[0].action, "fire");
  assert.equal(trace[0].seats[1].selectedHard, "ALLOW");
  assert.equal(trace[0].seats[1].depthNodes, 24);
});

test("runtime matrix profiles are integer, ordered and selected only after strict gates", () => {
  const { plan } = readRuntimePlan(process.cwd());
  const base = { cacheConfig: {}, runtimeConfig: {}, searchBudget: {}, tacticalConfig: {} };
  const parameters = parametersFor(base, plan.profiles[1]);
  assert.equal(parameters.runtimeConfig.FALLBACK_ENTER_WORK_UNITS, 18000);
  assert.equal(parameters.runtimeConfig.FALLBACK_ENTER_FRAME, 104);
  const reference = { totalDecisionMicros: 1000, p95DecisionMicros: 100 };
  const profile = { profileId: "p", matchedInput: { totalDecisionMicros: 800,
    p95DecisionMicros: 80, invariants: { avoidableHardRejects: 0,
      rootRestoreFailures: 0, hotAllocations: 0 } }, gameplay: { summary: { native: { wins: 8 } },
    invariants: { avoidableHardRejects: 0, rootRestoreFailures: 0, hotAllocations: 0 } } };
  profile.qualification = qualifyProfile(profile, reference, 9, plan.selection);
  assert.equal(profile.qualification.qualifies, true);
  const rejected = structuredClone(profile); rejected.profileId = "bad";
  rejected.matchedInput.totalDecisionMicros = 1200;
  rejected.qualification = qualifyProfile(rejected, reference, 9, plan.selection);
  assert.equal(rejected.qualification.qualifies, false);
  assert.equal(selectProfile([rejected, profile]).profileId, "p");
});

test("local qualification reports every transition and treats no callback as an explicit hold", () => {
  const oldMatch = match("a", VARIANTS[0].variantId, "NATIVE", 1, "v2");
  const newMatch = { ...match("a", VARIANTS[0].variantId, "NATIVE", 1, "v1"), frames: 1,
    actionTrace: [{ frame: 0, seats: [{ action: "go" }, null] }] };
  const before = { overview: { combined: { v2Wins: 1 } }, matches: [oldMatch] };
  const after = { overview: { combined: { v2Wins: 0 } }, matches: [newMatch] };
  const comparison = compareArenas(before, after);
  assert.equal(comparison.transitions.WIN_TO_LOSS, 1);
  assert.equal(comparison.native.winDelta, -1);
  const coverage = traceCoverage(after); assert.equal(coverage.complete, true);
  assert.equal(coverage.callbackActionCount, 1); assert.equal(coverage.holdNoCallbackCount, 1);
});

test("failure classifier separates committed projectile, same-frame fire and collision evidence", () => {
  const base = { result: { reason: "crashed" }, v2Seat: 0, frames: 3 };
  const committed = { ...base, replay: { records: [
    [{ type: "bullet", action: "created", objectId: "b1", tank: { id: "tank-1" } }],
    [], [{ type: "bullet", action: "go", objectId: "b1", order: 1,
      position: [2, 2], tank: { id: "tank-1" } },
    { type: "tank", action: "crashed", objectId: "tank-0", index: 0 }]] } };
  assert.equal(classifyReplay(committed).failureClass, FAILURE_CLASS.COMMITTED_PROJECTILE);
  const sameFrame = structuredClone(committed);
  sameFrame.replay.records[0] = []; sameFrame.replay.records[2].unshift(
    { type: "bullet", action: "created", objectId: "b1", tank: { id: "tank-1" } });
  assert.equal(classifyReplay(sameFrame).failureClass, FAILURE_CLASS.SAME_FRAME_FIRE);
  const collision = { ...base, replay: { records: [[], [], [
    { type: "tank", action: "crashed", objectId: "tank-0", index: 0 },
    { type: "tank", action: "crashed", objectId: "tank-1", index: 1 }]] } };
  const classified = classifyReplay(collision);
  assert.equal(classified.failureClass, FAILURE_CLASS.TANK_COLLISION);
  assert.match(classified.evidenceAuthority, /PLATFORM_RULE_VARIANT_UNRESOLVED/);
});

test("failure evidence requires the same action path and keeps frame-limit runtime local", () => {
  const left = { frames: 2, result: { winnerImplementation: "v1", reason: "crashed" },
    actionTrace: [{ frame: 0, seats: [{ implementation: "v2", action: "GO" }, null] }] };
  assert.equal(sameOutcomeAndActions(left, structuredClone(left)), true);
  const right = structuredClone(left); right.actionTrace[0].seats[0].action = "FIRE";
  assert.equal(sameOutcomeAndActions(left, right), false);
  const terminal = frameSettlement({ frames: 128, v2Seat: 0, counts: { stars: [2, 2] },
    v2: { totalRuntimeMicros: 20 }, v1: { totalRuntimeMicros: 10 } });
  assert.equal(terminal.failureClass, FAILURE_CLASS.FRAME_SETTLEMENT);
  assert.equal(terminal.runtimeOrder, "V2_HIGHER");
  assert.match(terminal.evidenceAuthority, /RUNTIME_LOCAL_ONLY/);
});
