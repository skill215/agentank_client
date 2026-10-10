"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { OWNERSHIP_STAGE } = require("../../engine-v3/src/ownership-trace");
const { GEOMETRY, analyzeShotGeometry, ShotRootCensus,
  AttackGeometryOpportunityCensus,
  collectShotOutcomeRecords, summarizeShotRecords } = require(
  "../../tools/agentank/diagnostics/shot-quality-counterexposure-census");

function openMap(size = 5) {
  return Array.from({ length: size }, () => new Array(size).fill("."));
}

function context(map = openMap()) {
  return { game: { frames: 7, map },
    me: { stars: 2, tank: { position: [1, 1], direction: "right" } },
    enemy: { stars: 1, tank: { position: [3, 1], direction: "left" } } };
}

test("shared shot geometry distinguishes direct line blockage and counter aim", () => {
  const direct = analyzeShotGeometry(context());
  assert.equal(direct.geometry, GEOMETRY.DIRECT_CLEAR);
  assert.equal(direct.distance, 2);
  assert.equal(direct.counterLine, 1);
  assert.equal(direct.ownMobility, 4);
  const blockedMap = openMap(); blockedMap[2][1] = "m";
  assert.equal(analyzeShotGeometry(context(blockedMap)).geometry,
    GEOMETRY.DIRECT_BLOCKED);
  const offAxis = context(); offAxis.enemy.tank.position = [3, 2];
  assert.equal(analyzeShotGeometry(offAxis).geometry, GEOMETRY.OFF_AXIS);
});

test("all-frame geometry census separates reaching a clear ray from firing on it", () => {
  const census = new AttackGeometryOpportunityCensus();
  const context = { me: { tank: { position: [1, 1], direction: "right" } },
    enemy: { tank: { position: [4, 1], direction: "left" } },
    game: { map: Array.from({ length: 6 }, () => Array(4).fill(".")) } };
  census.observe(context, { action: { type: "go" } });
  census.observe(context, { action: { type: "fire" } });
  const summary = census.summary();
  assert.equal(summary.geometryCount[GEOMETRY.DIRECT_CLEAR], 2);
  assert.equal(summary.directActionCount[1], 1);
  assert.equal(summary.directActionCount[3], 1);
  assert.equal(summary.directEntryCount, 1);
  assert.equal(summary.initialDirectCount, 1);
  assert.equal(summary.directEntryConvertedToFireCount, 1);
  assert.equal(summary.directEntryAbandonedWithoutFireCount, 0);
  assert.equal(summary.visibleEpisodeCount, 1);
  assert.equal(summary.visibleEpisodeReachedDirectCount, 1);
  assert.equal(summary.visibleEpisodeDirectFireCount, 1);
  assert.equal(summary.geometryActionCount[GEOMETRY.DIRECT_CLEAR * 6 + 1], 1);
  assert.equal(summary.geometryActionCount[GEOMETRY.DIRECT_CLEAR * 6 + 3], 1);
  assert.equal(summary.maximumDirectRun, 2);
  assert.equal(summary.hotAllocationCount, 0);
});

test("target-continuity census distinguishes correct alignment from abandoned ray", () => {
  const census = new AttackGeometryOpportunityCensus();
  const value = context();
  value.me.tank.direction = "up";
  census.observe(value, { action: { type: "turn", side: "right" } });
  value.me.tank.direction = "right";
  census.observe(value, { action: { type: "go" } });
  value.enemy.tank.position = null;
  census.observe(value, { action: { type: "go" } });
  const summary = census.summary();
  assert.equal(summary.wrongFacingCorrectTurnCount, 1);
  assert.equal(summary.wrongFacingWrongTurnCount, 0);
  assert.equal(summary.directEntryCount, 1);
  assert.equal(summary.directEntryConvertedToFireCount, 0);
  assert.equal(summary.directEntryAbandonedWithoutFireCount, 1);
  assert.equal(summary.directEntryHiddenWithoutFireCount, 1);
  assert.equal(summary.visibleEpisodeReachedDirectCount, 1);
  assert.equal(summary.visibleEpisodeDirectFireCount, 0);
  assert.equal(summary.maximumVisibleEpisodeLength, 2);
});

test("direct-entry census attributes the creating action to the previous V1 owner", () => {
  const trace = { selectedStage: OWNERSHIP_STAGE.TACTICAL_SEARCH };
  const census = new AttackGeometryOpportunityCensus(trace);
  const value = context();
  value.me.tank.direction = "up";
  census.observe(value, { action: { type: "turn", side: "right" } });
  trace.selectedStage = OWNERSHIP_STAGE.DIRECT_ATTACK;
  value.me.tank.direction = "right";
  census.observe(value, { action: { type: "fire" } });
  const summary = census.summary();
  assert.equal(summary.directEntryCount, 1);
  assert.equal(summary.directEntryPreviousOwnershipCount[
    OWNERSHIP_STAGE.TACTICAL_SEARCH], 1);
  assert.equal(summary.directEntryCurrentOwnershipCount[
    OWNERSHIP_STAGE.DIRECT_ATTACK], 1);
  assert.equal(summary.wrongFacingOwnershipCount[
    OWNERSHIP_STAGE.TACTICAL_SEARCH], 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("V2 FIRE root captures existing Combat PAC and Risk dimensions without ownership", () => {
  const engine = { ourCount: 2, ourActions: new Uint8Array([ACTION.GO, ACTION.FIRE]),
    combat: { vector: {
      directKill: new Uint8Array([0, 0]), possibleHit: new Uint8Array([0, 1]),
      intercept: new Uint8Array([0, 1]), aimSetup: new Uint8Array(2),
      hitDeadline: new Uint8Array([255, 3]), enemyDoomedFirstActions: new Uint8Array([0, 1]),
      enemySurvivingFirstActions: new Uint8Array([0, 2]),
      enemyUnknownFirstActions: new Uint8Array(2), enemyFrontierColumns: new Uint8Array([0, 2]),
      enemyCounterfireDelay: new Uint8Array([0, 1]), enemyMobilityLoss: new Uint8Array([0, 1]),
      enemyEndpointReduction: new Uint16Array([0, 4]),
      ownCounterExposure: new Uint16Array([0, 3400]), postFireEscape: new Uint8Array([0, 2]),
      purposeCompleteness: new Uint16Array([0, 6000]) } },
    projectileAttack: { status: new Uint8Array([0, 1]) },
    riskController: { outcome: { count: 2, acceptable: new Uint8Array([1, 1]),
      dominated: new Uint8Array(2), robustLower: new Int32Array([0, 120]),
      expectedValue: new Int32Array([0, 300]), immediateFatalMass: new Uint16Array(2),
      horizonFatalMass: new Uint16Array([0, 100]), unknownMass: new Uint16Array(2),
      escapeSlack: new Int8Array([0, 2]) } },
    adapter: { informationComplete: true } };
  const census = new ShotRootCensus();
  assert.equal(census.observe(context(), { action: { type: "fire" } }, engine), 1);
  const record = census.records()[0];
  assert.equal(record.row, 1);
  assert.equal(record.possibleHit, 1);
  assert.equal(record.doomed, 1);
  assert.equal(record.survives, 2);
  assert.equal(record.ownCounterExposure, 3400);
  assert.equal(record.postFireEscape, 2);
  assert.equal(record.robustLower, 120);
  census.observe({ ...context(), game: { ...context().game, frames: 8 } },
    { action: { type: "go" } }, engine);
  assert.equal(census.records()[0].continuation[0], ACTION.GO);
  assert.equal(census.hotAllocationCount, 0);
});

function replay(records) {
  return { replayData: { replay: { meta: { players: [
    { tank: { id: "a" } }, { tank: { id: "b" } }
  ] }, records } } };
}

test("outcome binding preserves overload members and command-level counter exposure", () => {
  const roots = [[{ frame: 0, geometry: GEOMETRY.DIRECT_CLEAR,
    distance: 2, engineSupported: 1, postFireEscape: 0,
    ownCounterExposure: 9000, survives: 0, unknown: 0 }],
  [{ frame: 0, geometry: GEOMETRY.OFF_AXIS, distance: 4,
    engineSupported: 0, postFireEscape: 0, ownCounterExposure: 0,
    survives: 0, unknown: 0 }]];
  const result = collectShotOutcomeRecords(replay([
    [
      { type: "bullet", action: "created", objectId: "p1", tank: { id: "a" } },
      { type: "bullet", action: "created", objectId: "p2", tank: { id: "a" } },
      { type: "bullet", action: "created", objectId: "q1", tank: { id: "b" } }
    ],
    [
      { type: "bullet", action: "go", objectId: "p1", tank: { id: "a" } },
      { type: "tank", action: "crashed", objectId: "b", index: 1 },
      { type: "bullet", action: "crashed", objectId: "p1", tank: { id: "a" } },
      { type: "bullet", action: "go", objectId: "p2", tank: { id: "a" } },
      { type: "map", action: "destroyed", position: [4, 1] },
      { type: "bullet", action: "crashed", objectId: "p2", tank: { id: "a" } },
      { type: "bullet", action: "crashed", objectId: "q1", tank: { id: "b" } }
    ],
    [],
    [{ type: "tank", action: "crashed", objectId: "a", index: 0 }]
  ]), roots);
  assert.equal(result[0][0].projectiles, 2);
  assert.equal(result[0][0].tankKills, 1);
  assert.equal(result[0][0].terrainHits, 1);
  assert.equal(result[0][0].ownerCrashWithin4, 1);
  assert.equal(result[1][0].ownerProjectileKilledWithin4, 1);
  assert.equal(result[1][0].projectiles, 1);
  assert.equal(result[1][0].noTankImpact, 1);
  assert.equal(result[1][0].ownerCrashWithin4, 1);
  assert.deepEqual(result.unpairedProjectiles, [0, 0]);
});

test("poison-style delayed emission binds to the latest unmatched FIRE command", () => {
  const result = collectShotOutcomeRecords(replay([
    [],
    [{ type: "bullet", action: "created", objectId: "p1", tank: { id: "a" } }]
  ]), [[{ frame: 0, geometry: GEOMETRY.OFF_AXIS, distance: 4,
    engineSupported: 1, postFireEscape: 1, ownCounterExposure: 0,
    survives: 2, unknown: 0 }], []]);
  assert.equal(result[0][0].projectiles, 1);
  assert.equal(result[0][0].emissionDelay, 1);
  assert.deepEqual(result.unpairedProjectiles, [0, 0]);
});

test("shot summary keeps geometry engine evidence and survival dimensions separate", () => {
  const summary = summarizeShotRecords([
    { geometry: GEOMETRY.DIRECT_CLEAR, distance: 2, counterLine: 1,
      engineSupported: 1, directKill: 1, doomed: 1, possibleHit: 0,
      aimSetup: 0, intercept: 0, postFireEscape: 0, survives: 0, unknown: 0,
      pacStatus: 1,
      ownCounterExposure: 9000, projectiles: 1, tankKills: 1,
      ownerCrashWithin4: 1, terrainHits: 0, noTankImpact: 0,
      survivedAtTerminal: 0, lifetimeFrames: 2,
      ownerProjectileKilledWithin4: 1, continuation: [ACTION.GO, -1, -1, -1] },
    { geometry: GEOMETRY.OFF_AXIS, distance: 8, counterLine: 0,
      engineSupported: 1, directKill: 0, doomed: 0, possibleHit: 1,
      aimSetup: 0, intercept: 1, postFireEscape: 3, survives: 3, unknown: 0,
      pacStatus: 1,
      ownCounterExposure: 0, projectiles: 1, tankKills: 0,
      ownerCrashWithin4: 0, terrainHits: 0, noTankImpact: 1,
      survivedAtTerminal: 0, lifetimeFrames: 5,
      ownerProjectileKilledWithin4: 0,
      postFireClosureStatus: 1, aimStatus: 2,
      continuation: [ACTION.TURN_LEFT, -1, -1, -1] }
  ]);
  assert.equal(summary.total.commands, 2);
  assert.equal(summary.total.killsPer10000Projectiles, 5000);
  assert.equal(summary.geometry.DIRECT_CLEAR.tankKills, 1);
  assert.equal(summary.engineSignal.POSSIBLE_HIT.commands, 1);
  assert.equal(summary.postFireEscape.ZERO.counterCrashCommands, 1);
  assert.equal(summary.firstContinuation.GO.counterKilledCommands, 1);
  assert.equal(summary.enemySurvivors.TWO_PLUS.commands, 1);
  assert.equal(summary.postFireClosure.PROVEN_SAFE.commands, 1);
  assert.equal(summary.aimSetupShadow.PROPOSED_QUALITY.commands, 1);
});
