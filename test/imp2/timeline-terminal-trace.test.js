"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ref = require("../../engine-v2/src/reference");

const root = path.resolve(__dirname, "../..");
const loaded = ref.loadRuleCorpus(root);
const context = ref.createRuleContext(loaded, ref.TRACE_VARIANTS);
const kernel = new ref.ReferenceKernel(context);

test("projectiles execute two ordered substeps and pass through each other without cancellation", () => {
  const state = ref.createPhysicalState({ platformFrame: 2, recordIndex: 2,
    map: { width: 7, height: 5, terrainColumnMajor: ref.boxedMap() },
    tanks: [ref.tank(0, [1, 1], "right"), ref.tank(1, [5, 3], "left")],
    projectiles: [{ ownerSeat: 0, cell: [2, 2], direction: "right" },
      { ownerSeat: 1, cell: [4, 2], direction: "left" }],
    assumptionIds: ["USER_BULLET_CROSSING"] }, context);
  const transition = kernel.advanceFrame(state);
  const moves = transition.orderedEvents.filter(event => event.eventCode === "PROJECTILE_MOVED");
  assert.deepEqual([...new Set(moves.map(event => event.phaseOrdinal))], [60, 61]);
  assert.equal(transition.childState.projectiles.filter(item => item.active).length, 2);
});

test("shield absorbs two separate bullet hits and expires only after the second hit", () => {
  const spec = ref.scenarioSpecs(context)[3];
  const transition = kernel.advanceFrame(spec.state);
  const hits = transition.orderedEvents.filter(event => event.eventCode === "SHIELD_HIT" &&
    event.reasonCode === "PROJECTILE");
  assert.deepEqual(hits.map(event => event.valueAfter), [1, 0]);
  assert.equal(transition.childState.tanks[1].shieldHitsRemaining, 0);
});

test("bomb resolution follows action and both projectile substeps in canonical phase order", () => {
  const transition = kernel.advanceFrame(ref.scenarioSpecs(context)[3].state);
  const skill = transition.orderedEvents.findIndex(event => event.eventCode === "SKILL_CAST");
  const lastProjectile = transition.orderedEvents.map(event => event.eventCode).lastIndexOf("PROJECTILE_DESTROYED");
  const bomb = transition.orderedEvents.findIndex(event => event.eventCode === "BOMB_EXPLODED");
  assert.ok(skill >= 0 && skill < lastProjectile && lastProjectile < bomb);
  assert.deepEqual([...new Set(transition.orderedEvents.map(event => event.phaseOrdinal))],
    [30, 60, 61, 70, 80]);
});

test("multiple due bombs require an explicit finite variant before any Reference mutation", () => {
  const undecided = ref.createRuleContext(loaded);
  const state = ref.createPhysicalState({ platformFrame: 10, recordIndex: 10,
    map: { width: 7, height: 5, terrainColumnMajor: ref.boxedMap() },
    tanks: [ref.tank(0, [1, 1], "right"), ref.tank(1, [5, 3], "left")],
    bombs: [{ ownerSeat: 0, cell: [2, 2], explodeFrame: 10 },
      { ownerSeat: 1, cell: [4, 2], explodeFrame: 10 }] }, undecided);
  const before = ref.signature(state); const transition = new ref.ReferenceKernel(undecided).advanceFrame(state);
  assert.equal(transition.status, "REFERENCE_VARIANT_REQUIRED");
  assert.equal(transition.firstUnknownRuleId, "R0-BOMB-LIFECYCLE");
  assert.equal(ref.signature(state), before);
});

test("last record index 127 executes full action and projectile phases before frame-limit terminal", () => {
  const result = ref.runCanonicalScenarios(root).results[0];
  assert.equal(result.status, "REFERENCE_TERMINAL");
  assert.equal(result.terminalResolution.cause, "FRAME_LIMIT_RUNTIME");
  assert.ok(result.traceRecord.trace.events.some(event => event.eventCode === "TANK_TURNED"));
  assert.ok(result.traceRecord.trace.events.some(event => event.eventCode === "TERRAIN_DESTROYED"));
  assert.equal(result.traceRecord.trace.events.at(-1).eventCode, "TERMINAL_RESOLVED");
});

test("equal-star terminal uses lower runtime and never converts unknown runtime into zero", () => {
  const result = ref.runCanonicalScenarios(root).results[1];
  assert.equal(result.terminalResolution.winnerSeat, 1);
  assert.equal(result.terminalResolution.tiebreak, "RUNTIME");
  const state = structuredClone(result.parentState); state.tanks[1].runtimeMs = null;
  const incomplete = ref.resolve(state, context);
  assert.equal(incomplete.status, "INCOMPLETE_STATE");
  assert.equal(incomplete.incompleteReason, "RUNTIME_ORDER_UNKNOWN");
});

test("mutual projectile destruction waits for the batch then resolves stars", () => {
  const result = ref.runCanonicalScenarios(root).results[2];
  assert.equal(result.terminalResolution.trigger, "CRASH");
  assert.equal(result.terminalResolution.cause, "MUTUAL_CRASH_STAR");
  assert.equal(result.terminalResolution.winnerSeat, 0);
  assert.equal(result.traceRecord.trace.events.filter(event => event.eventCode === "TANK_CRASHED").length, 2);
});

test("exact runtime tie and exact timeout boundary remain variant-required in the default context", () => {
  const undecided = ref.createRuleContext(loaded);
  assert.throws(() => ref.timeoutBoundary(3000, undecided), error =>
    error.code === "REFERENCE_VARIANT_REQUIRED");
  const state = ref.createPhysicalState({ platformFrame: 127, recordIndex: 127,
    map: { width: 7, height: 5, terrainColumnMajor: ref.boxedMap() },
    tanks: [ref.tank(0, [1, 1], "right", { stars: 2, runtimeMs: 1000 }),
      ref.tank(1, [5, 3], "left", { stars: 2, runtimeMs: 1000 })] }, undecided);
  assert.throws(() => ref.resolve(state, undecided), error =>
    error.code === "REFERENCE_VARIANT_REQUIRED");
});

test("canonical traces are byte-stable and independently replayable for all required scenarios", () => {
  const first = ref.runCanonicalScenarios(root); const second = ref.runCanonicalScenarios(root);
  assert.equal(first.results.length, 4);
  assert.deepEqual(first.results.map(item => item.traceSha256), second.results.map(item => item.traceSha256));
  assert.ok(first.results.every(item => item.replayMatches && item.byteLength > 0 && item.eventCount > 0));
});

test("empty-queue control and boost repoll dependencies remain explicit Reference variants", () => {
  const undecided = ref.createRuleContext(loaded);
  const frozen = ref.createPhysicalState({ platformFrame: 5, recordIndex: 5,
    map: { width: 7, height: 5, terrainColumnMajor: ref.boxedMap() },
    tanks: [ref.tank(0, [1, 1], "right", { frozenUntilFrame: 7 }),
      ref.tank(1, [5, 3], "left")] }, undecided);
  const frozenResult = new ref.ReferenceKernel(undecided).advanceFrame(frozen);
  assert.equal(frozenResult.status, "REFERENCE_VARIANT_REQUIRED");
  assert.equal(frozenResult.firstUnknownRuleId, "R1-FREEZE");
  const boosted = ref.createPhysicalState({ platformFrame: 5, recordIndex: 5,
    map: { width: 7, height: 5, terrainColumnMajor: ref.boxedMap() },
    tanks: [ref.tank(0, [1, 1], "right", { boostUntilFrame: 7,
      queue: [{ command: "TURN_LEFT", eligibleAtFrame: 5 }] }),
      ref.tank(1, [5, 3], "left")] }, undecided);
  assert.equal(new ref.ReferenceKernel(undecided).advanceFrame(boosted).status,
    "REFERENCE_VARIANT_REQUIRED");
});

test("teleport reveal deadline propagates incomplete observation into transition status", () => {
  const undecided = ref.createRuleContext(loaded);
  const state = ref.createPhysicalState({ platformFrame: 5, recordIndex: 5,
    map: { width: 7, height: 5, terrainColumnMajor: ref.boxedMap() },
    tanks: [ref.tank(0, [1, 1], "right"),
      ref.tank(1, [5, 3], "left")] }, undecided);
  state.tanks[0].revealUntilFrame = 6;
  const transition = new ref.ReferenceKernel(undecided).advanceFrame(state);
  assert.equal(transition.status, "REFERENCE_UNKNOWN_RULE");
  assert.equal(transition.firstUnknownRuleId, "R0-OBSERVATION-VISIBILITY");
  assert.ok(transition.observationsBySide.some(observation => !observation.complete));
});
