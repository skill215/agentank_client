"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { fireDecisionIndices, shotLabel, distanceBucket, shotStratum,
  extractHistoricalFireRoots, matchedControlLevel,
  selectHistoricalProofCohort, actionObject, RecordedProductionShadowBot,
  installRecordedSkillEmitter, snapshotMatchesShot, summarize } =
  require("../../tools/agentank/diagnostics/semantic-attack-real-opportunity-corpus");

function shot(frame, options = {}) {
  return { frame, geometry: 4, distance: 2, rayLength: 4,
    ownMobility: 3, enemyMobility: 2, counterLine: 0,
    ownPose: [1, 2, 3], enemyPose: [1, 4, 1], ownStars: 1,
    enemyStars: 0, projectiles: 1, tankKills: 0, terrainHits: 0,
    shieldBreaks: 0, noTankImpact: 1, survivedAtTerminal: 0,
    lifetimeFrames: 2, ownerCrashWithin4: 0,
    ownerProjectileKilledWithin4: 0, emissionFrame: frame,
    emissionDelay: 0, continuation: [1, 2, -1, -1], ...options };
}

function match(shots, actions) {
  return { implementation: "SOURCE", matchUrlId: "mat_a",
    scenarioFingerprint: "scene", candidateSeat: 0,
    seatSkills: ["poison", "stun"], analysisOutcome: "V1_WIN",
    terminalCategory: "SINGLE_CRASH",
    control: { compactActionStream: Buffer.from(actions).toString("base64"),
      compactArguments: [] }, shotQualityRecords: { control: shots } };
}

test("BP144 aligns shot outcomes to FIRE decision order, not frame number", () => {
  assert.deepEqual(fireDecisionIndices(Buffer.from(
    [ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT, ACTION.FIRE]).toString("base64")),
  [1, 3]);
  const extracted = extractHistoricalFireRoots([
    match([shot(6), shot(11)],
      [ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT, ACTION.FIRE])
  ]);
  assert.equal(extracted.actionCountMismatch, 0);
  assert.deepEqual(extracted.roots.map(root => root.decisionIndex), [1, 3]);
  assert.deepEqual(extracted.roots.map(root => root.frame), [6, 11]);
});

test("BP144 projectile labels keep kill, shield, terrain and miss facts separate", () => {
  assert.equal(shotLabel(shot(1, { tankKills: 1 })), "KILL_SAFE");
  assert.equal(shotLabel(shot(1, { tankKills: 1, ownerCrashWithin4: 1 })),
    "KILL_COUNTER_CRASH");
  assert.equal(shotLabel(shot(1, { shieldBreaks: 1 })), "SHIELD_BREAK");
  assert.equal(shotLabel(shot(1, { terrainHits: 1 })), "TERRAIN_HIT");
  assert.equal(shotLabel(shot(1, { survivedAtTerminal: 1 })),
    "TERMINAL_SURVIVOR");
  assert.equal(shotLabel(shot(1)), "NO_TANK_IMPACT");
});

test("BP144 matched controls are deterministic, unique and geometry-first", () => {
  const roots = [];
  for (let index = 0; index < 3; index += 1) {
    const positive = extractHistoricalFireRoots([match([
      shot(index + 1, { tankKills: 1 })], [ACTION.FIRE])]).roots[0];
    positive.key += ":P" + index; roots.push(positive);
    const negative = extractHistoricalFireRoots([match([
      shot(index + 11)], [ACTION.FIRE])]).roots[0];
    negative.key += ":N" + index; roots.push(negative);
  }
  const selected = selectHistoricalProofCohort(roots);
  assert.equal(selected.length, 6);
  assert.equal(new Set(selected.map(root => root.key)).size, 6);
  assert.equal(selected.filter(root =>
    root.proofSelectionRole === "POSITIVE_KILL").length, 3);
  assert.equal(selected.filter(root =>
    root.proofSelectionRole === "MATCHED_NO_KILL").length, 3);
  assert.ok(selected.filter(root => root.matchLevel !== undefined)
    .every(root => root.matchLevel === 0));
});

test("BP144 strata broaden only after exact geometry/distance/counterline", () => {
  const base = { stratum: "4:D0_2:0" };
  assert.equal(matchedControlLevel(base, { stratum: "4:D0_2:0" }), 0);
  assert.equal(matchedControlLevel(base, { stratum: "4:D0_2:1" }), 1);
  assert.equal(matchedControlLevel(base, { stratum: "4:D3_4:0" }), 2);
  assert.equal(matchedControlLevel(base, { stratum: "1:D0_2:0" }), 3);
  assert.equal(distanceBucket(7), "D5_7");
  assert.equal(shotStratum(shot(1)), "4:D0_2:0");
});

test("BP144 exact root validation compares physical pose, stars and frame", () => {
  const source = shot(9); const snapshot = { frame: 9,
    ownPose: [1, 2, 3], enemyPose: [1, 4, 1], ownStars: 1, enemyStars: 0 };
  assert.equal(snapshotMatchesShot(snapshot, source), true);
  assert.equal(snapshotMatchesShot({ ...snapshot, ownStars: 2 }, source), false);
  assert.deepEqual(actionObject(ACTION.CAST_TELEPORT, [[3, 5, 6]], 3),
    { type: "teleport", x: 5, y: 6 });
});

test("BP144 recorded command owns replay physics even when shadow output differs", () => {
  const shadow = { decide() { return { action: { type: "turn", side: "right" },
    logs: ["shadow"] }; } };
  const replay = new RecordedProductionShadowBot(shadow,
    Buffer.from([ACTION.CAST_STUN]).toString("base64"), []);
  const decision = replay.decide({});
  assert.deepEqual(decision.action, { type: "stun" });
  assert.equal(replay.index, 1);
  assert.equal(replay.shadowOutputMismatchCount, 1);
});

test("BP144 recorded skill emitter does not wrap or bypass final override", () => {
  const emitted = []; const originalEmit = function originalEmit() {};
  const engine = { emit: originalEmit,
    adapter: { recordEmission(action, argument) {
      emitted.push([action, argument]); } } };
  installRecordedSkillEmitter(engine);
  assert.equal(engine.emit, originalEmit);
  let casts = 0;
  assert.equal(engine.diagnosticReplacementEmitter.call(engine,
    { stun() { casts += 1; } }, ACTION.CAST_STUN, 65535, originalEmit),
  ACTION.CAST_STUN);
  assert.equal(casts, 1);
  assert.deepEqual(emitted, [[ACTION.CAST_STUN, 65535]]);
});

test("BP144 summary preserves source-family denominators", () => {
  const roots = [{ historicalLabel: "KILL_SAFE", stratum: "4:D0_2:0",
    proofSelectionRole: "POSITIVE_KILL", exact: true },
  { historicalLabel: "NO_TANK_IMPACT", stratum: "4:D0_2:0",
    proofSelectionRole: "MATCHED_NO_KILL", matchLevel: 0, exact: true }];
  const output = summarize(roots, roots,
    [{ exact: true }], [{ exact: true }], { historicalMatches: 1,
      oracleMatches: 1, terminalReproduced: 2, actionStreamMismatches: 0 });
  assert.equal(output.historicalFireRootCount, 2);
  assert.equal(output.historicalProofRootCount, 2);
  assert.equal(output.pairedFirstDivergenceCount, 1);
  assert.equal(output.missedFireCount, 1);
  assert.equal(output.sourceTerminalReproductionCount, 2);
});
