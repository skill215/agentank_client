"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { FOCUS_CLASS, focusedTargetClass, orderedRepresentatives } =
  require("../../tools/agentank/fast-regression/focused-cohort");
const { actionCommand, branchCacheKey, commandActionName, classifyCounterfactualFrame,
  classifyCurrentDelta, focusedDiagnosticJobs } =
  require("../../tools/agentank/fast-regression/focused-diagnostic");

function match(overrides = {}) {
  return { family: "NATIVE", variantId: "NATIVE_V1_SEAT0", v2Seat: 1,
    seatImplementations: ["v1", "v2"], counts: { stars: [1, 1], crashes: [0, 1] },
    result: { reason: "crashed", winnerImplementation: "v1", winnerSeat: 0 }, ...overrides };
}

test("focused classification uses analysis semantics and ignores raw runtime winners", () => {
  assert.equal(focusedTargetClass(match()), FOCUS_CLASS.NATIVE_SINGLE_CRASH_LOSS);
  assert.equal(focusedTargetClass(match({ counts: { stars: [1, 1], crashes: [1, 0] },
    result: { reason: "crashed", winnerImplementation: "v2", winnerSeat: 1 } })),
  FOCUS_CLASS.NATIVE_SINGLE_CRASH_WIN);
  assert.equal(focusedTargetClass(match({ counts: { stars: [1, 2], crashes: [0, 0] },
    result: { reason: "frameLimit", winnerImplementation: "v1", winnerSeat: 0 } })),
  FOCUS_CLASS.NATIVE_STAR_WIN);
  assert.equal(focusedTargetClass(match({ counts: { stars: [1, 1], crashes: [0, 0] },
    result: { reason: "frameLimit", winnerImplementation: "v1", winnerSeat: 0 } })),
  FOCUS_CLASS.OTHER);
});

test("representative ordering alternates swapped seats and remains deterministic", () => {
  const entries = [];
  for (const variant of ["NATIVE_V1_SEAT0", "NATIVE_V2_SEAT0"])
    for (let index = 0; index < 3; index += 1) entries.push({
      match: { matchId: `${variant}-${index}`, variantId: variant }, rank: `${index}-${variant}`,
      fingerprint: `${variant}-${index}`, features: [`variant:${variant}`, `bucket:${index % 2}`] });
  const first = orderedRepresentatives(entries); const second = orderedRepresentatives(entries);
  assert.deepEqual(second.map(item => item.match.matchId), first.map(item => item.match.matchId));
  assert.notEqual(first[0].match.variantId, first[1].match.variantId);
  assert.equal(first.length, entries.length);
});

test("action mapping is physical and explicitly rejects unsupported compound actions", () => {
  assert.deepEqual(actionCommand(ACTION.GO), { supported: true, command: { type: "go" } });
  assert.deepEqual(actionCommand(ACTION.CAST_POISON),
    { supported: true, command: { type: "poison" } });
  assert.deepEqual(actionCommand(ACTION.NONE), { supported: true, command: null });
  assert.deepEqual(actionCommand(ACTION.CAST_TELEPORT, 17, { width: 8 }),
    { supported: true, command: { type: "teleport", x: 1, y: 2 } });
  assert.deepEqual(actionCommand(ACTION.CAST_TELEPORT, NONE_CELL),
    { supported: false, command: null });
  assert.deepEqual(actionCommand(ACTION.BOOST_LEFT_GO), { supported: false, command: null });
  assert.equal(commandActionName({ type: "turn", side: "left" }), "TURN_LEFT");
  assert.equal(commandActionName({ type: "poison" }), "CAST_POISON");
});

test("fixed-continuation classification separates avoidable and unavoidable deaths", () => {
  const branch = crashed => ({ replayable: true, result: { branch: { v2Crashed: crashed } } });
  assert.equal(classifyCounterfactualFrame(true, [branch(true), branch(false)]),
    "AVOIDABLE_UNDER_FIXED_CONTINUATION");
  assert.equal(classifyCounterfactualFrame(true, [branch(true), branch(true)]),
    "ALL_REPLAYABLE_ACTIONS_DIE");
  assert.equal(classifyCounterfactualFrame(false, [branch(false)]), "SELECTED_SURVIVES_WINDOW");
  assert.equal(classifyCounterfactualFrame(true, [{ replayable: false }]), "NO_REPLAYABLE_ACTION");
});

test("current action delta reports both rescued deaths and introduced deaths", () => {
  assert.equal(classifyCurrentDelta(true, false, true),
    "DEATH_AVOIDED_BY_CURRENT_ACTION");
  assert.equal(classifyCurrentDelta(false, true, true),
    "SURVIVAL_LOST_BY_CURRENT_ACTION");
  assert.equal(classifyCurrentDelta(true, true, true), "CHANGED_ACTION_STILL_DIES");
  assert.equal(classifyCurrentDelta(false, false, true), "CHANGED_ACTION_STILL_SURVIVES");
  assert.equal(classifyCurrentDelta(true, true, false), "UNCHANGED_ACTION_DIES");
  assert.equal(classifyCurrentDelta(false, null, true), "CURRENT_ACTION_NOT_REPLAYED");
});

test("physical branch cache identity excludes V2 source and includes simulator semantics", () => {
  const capsule = { fingerprint: "capsule", simulator: { commit: "commit", archiveSha256: "archive" },
    window: { endFrame: 12 }, source: { v2Sha256: "old" } };
  const first = branchCacheKey(capsule, 9, { type: "go" });
  capsule.source.v2Sha256 = "new";
  const second = branchCacheKey(capsule, 9, { type: "go" });
  assert.deepEqual(second, first);
  assert.notDeepEqual(branchCacheKey(capsule, 10, { type: "go" }), first);
  assert.notDeepEqual(branchCacheKey(capsule, 9, { type: "fire" }), first);
});

test("focused smoke selection trims only primary execution and leaves the cohort immutable", () => {
  const lanes = { nativeSingleCrashLoss: Array.from({ length: 64 }, (_, id) => ({ id })),
    nativeSwappedCounterpart: Array.from({ length: 64 }, (_, id) => ({ id })),
    nativeSingleCrashWinControl: Array.from({ length: 16 }, (_, id) => ({ id })),
    nativeStarWinControl: Array.from({ length: 16 }, (_, id) => ({ id })) };
  const cohort = { lanes };
  const smoke = focusedDiagnosticJobs(cohort, { primaryLimit: 16, skipControls: true });
  assert.deepEqual(smoke.selection, { primaryAvailable: 64, primarySelected: 16,
    controlsIncluded: false, executionLane: "SMOKE" });
  assert.equal(smoke.jobs.length, 1); assert.equal(smoke.jobs[0].entries.length, 16);
  assert.equal(lanes.nativeSingleCrashLoss.length, 64);
  const full = focusedDiagnosticJobs(cohort);
  assert.equal(full.selection.executionLane, "FULL_FOCUSED");
  assert.equal(full.jobs.reduce((sum, job) => sum + job.entries.length, 0), 160);
});
