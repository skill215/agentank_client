"use strict";

const { loadRuleCorpus, createRuleContext } = require("./rule-corpus");
const { createPhysicalState } = require("./state");
const { ReferenceKernel } = require("./kernel");
const { buildCanonicalTrace, replayTrace } = require("./trace");

const TRACE_VARIANTS = Object.freeze({ MOVE_CONTEST_V1: "SEQUENTIAL_BLOCK",
  STAR_CONTEST_V1: "SEAT_PRIORITY",
  PROJECTILE_SHARED_RESOURCE_V1: "SEQUENTIAL_REPLAY_ORDER",
  MULTI_BOMB_BATCH_V1: "SEQUENTIAL_PLACEMENT_ORDER",
  FREEZE_EMPTY_QUEUE_POLL_V1: "POLL_AND_HOLD",
  BOOST_EMPTY_QUEUE_REPOLL_V1: "NO_REPOLL",
  POISON_EMPTY_QUEUE_REPOLL_V1: "NO_REPOLL_UNTIL_NEXT_FRAME",
  TELEPORT_REVEAL_DEADLINE_V1: "ONE_ENEMY_DECISION_FRAME",
  VISIBLE_MULTI_PROJECTILE_V1: "ONE_OF_VISIBLE_SET",
  TIMEOUT_COMPARATOR_V1: "GE_3000_MS", EXACT_RUNTIME_TIE_V1: "DRAW",
  FAILED_CAST_COOLDOWN_V1: "FAMILY_SPECIFIC" });

function boxedMap(width = 7, height = 5) {
  return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "x" : "."));
}
function tank(seat, cell, direction, extra = {}) {
  return { seat, cell, direction, skillId: extra.skillId ?? null, stars: extra.stars ?? 0,
    runtimeMs: extra.runtimeMs ?? null, crashed: extra.crashed ?? false,
    queue: extra.queue ?? [], shieldHitsRemaining: extra.shieldHitsRemaining ?? 0,
    shieldUntilFrame: extra.shieldUntilFrame ?? null, frozenUntilFrame: extra.frozenUntilFrame ?? null,
    stunUntilFrame: extra.stunUntilFrame ?? null, overloadUntilFrame: extra.overloadUntilFrame ?? null,
    cloakUntilFrame: extra.cloakUntilFrame ?? null, poisonAppliedFrame: extra.poisonAppliedFrame ?? null,
    poisonUntilFrame: extra.poisonUntilFrame ?? null, boostUntilFrame: extra.boostUntilFrame ?? null,
    revealUntilFrame: extra.revealUntilFrame ?? null,
    pickupLockUntilFrame: extra.pickupLockUntilFrame ?? null,
    fireLockUntilFrame: extra.fireLockUntilFrame ?? null,
    skillReadyFrame: extra.skillReadyFrame ?? 0,
    bombCooldownReadyFrame: extra.bombCooldownReadyFrame ?? 0 };
}

function scenarioSpecs(context) {
  const limitMap = boxedMap(); limitMap[3][2] = "m";
  return [
    { fixtureId: "TRACE-128-FULL-LAST-RECORD", state: createPhysicalState({ platformFrame: 127,
      recordIndex: 127, map: { width: 7, height: 5, terrainColumnMajor: limitMap },
      tanks: [tank(0, [1, 1], "right", { stars: 2, runtimeMs: 1400,
        queue: [{ command: "TURN_RIGHT", eligibleAtFrame: 127 }] }),
      tank(1, [5, 3], "left", { stars: 2, runtimeMs: 900 })],
      projectiles: [{ ownerSeat: 0, cell: [2, 2], direction: "right" }] }, context), options: {} },
    { fixtureId: "TRACE-EQUAL-STAR-RUNTIME", state: createPhysicalState({ platformFrame: 127,
      recordIndex: 127, map: { width: 7, height: 5, terrainColumnMajor: boxedMap() },
      tanks: [tank(0, [1, 1], "right", { stars: 3, runtimeMs: 1600 }),
        tank(1, [5, 3], "left", { stars: 3, runtimeMs: 1200 })] }, context), options: {} },
    { fixtureId: "TRACE-MUTUAL-PROJECTILE-KILL", state: createPhysicalState({ platformFrame: 24,
      recordIndex: 24, map: { width: 7, height: 5, terrainColumnMajor: boxedMap() },
      tanks: [tank(0, [2, 2], "right", { stars: 2, runtimeMs: 900 }),
        tank(1, [4, 2], "left", { stars: 1, runtimeMs: 800 })],
      projectiles: [{ ownerSeat: 1, cell: [1, 2], direction: "right" },
        { ownerSeat: 0, cell: [5, 2], direction: "left" }] }, context), options: {} },
    { fixtureId: "TRACE-BOMB-PROJECTILE-SKILL-COMPOSITE", state: createPhysicalState({
      platformFrame: 10, recordIndex: 10, map: { width: 7, height: 5, terrainColumnMajor: boxedMap() },
      tanks: [tank(0, [1, 1], "right", { skillId: "freeze", stars: 1, runtimeMs: 700,
        queue: [{ command: "CAST_FREEZE", eligibleAtFrame: 10 }] }),
      tank(1, [3, 2], "left", { skillId: "shield", stars: 1, runtimeMs: 800,
        shieldHitsRemaining: 2, shieldUntilFrame: 14 })],
      projectiles: [{ ownerSeat: 0, cell: [1, 2], direction: "right" },
        { ownerSeat: 0, cell: [2, 2], direction: "right" }],
      bombs: [{ ownerSeat: 1, cell: [1, 1], explodeFrame: 10 }] }, context), options: {} }
  ];
}

function runCanonicalScenarios(workspaceRoot) {
  const loaded = loadRuleCorpus(workspaceRoot); const context = createRuleContext(loaded, TRACE_VARIANTS);
  const kernel = new ReferenceKernel(context);
  const results = scenarioSpecs(context).map(spec => {
    const transition = kernel.advanceFrame(spec.state, spec.options);
    const traceRecord = buildCanonicalTrace(spec.fixtureId, spec.state, transition, context);
    const replay = replayTrace(spec.state, traceRecord, kernel, spec.options);
    return { fixtureId: spec.fixtureId, status: transition.status, traceSha256: traceRecord.sha256,
      byteLength: Buffer.byteLength(traceRecord.bytes), replayMatches: replay.matches,
      eventCount: transition.orderedEvents.length, terminalResolution: transition.terminalResolution,
      traceRecord, parentState: spec.state };
  });
  return { loaded, context, kernel, results };
}

module.exports = { TRACE_VARIANTS, boxedMap, tank, scenarioSpecs, runCanonicalScenarios };
