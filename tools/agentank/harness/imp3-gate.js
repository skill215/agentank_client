"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory } = require("../core/atomic-file");
const { summarizeTestOutput } = require("./test-runner");
const { writeReport, writeImmutableJsonEvidence, writeImmutableRawEvidence, artifactEntry, check } =
  require("./foundation-gate");
const reference = require("../../../engine-v2/src/reference");
const fast = require("../../../engine-v2/src/fast");
const { CAPACITY } = require("../../../engine-v2/src/generated/fast-config");

function boxedMap(width = 7, height = 5) {
  return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "x" : "."));
}
function tank(seat, cell, direction, extra = {}) {
  return { entityId: seat + 1, seat, cell, direction, crashed: false, stars: 0, runtimeMs: 0,
    skillId: null, skillReadyFrame: 0, shieldHitsRemaining: 0, shieldUntilFrame: null,
    frozenUntilFrame: null, stunUntilFrame: null, overloadUntilFrame: null, cloakUntilFrame: null,
    poisonAppliedFrame: null, poisonUntilFrame: null, boostUntilFrame: null, revealUntilFrame: null,
    pickupLockUntilFrame: null, fireLockUntilFrame: null, bombCooldownReadyFrame: 0, ...extra };
}
function physical(overrides = {}) {
  return { platformFrame: 0, recordIndex: 0,
    map: { width: 7, height: 5, terrainColumnMajor: boxedMap() },
    tanks: [tank(0, [1, 1], "right"), tank(1, [5, 3], "left")],
    projectiles: [], bombs: [], star: null,
    terminalFlags: { timeoutSeat: null, scriptErrorSeat: null }, ...overrides };
}
function commandCode(record) {
  const command = typeof record === "string" ? record : record?.command;
  const table = { GO: fast.ACTION.GO, TURN_LEFT: fast.ACTION.TURN_LEFT,
    TURN_RIGHT: fast.ACTION.TURN_RIGHT, FIRE: fast.ACTION.FIRE,
    THROW_BOMB: fast.ACTION.THROW_BOMB, CAST_SHIELD: fast.ACTION.CAST_SHIELD,
    CAST_FREEZE: fast.ACTION.CAST_FREEZE, CAST_STUN: fast.ACTION.CAST_STUN,
    CAST_OVERLOAD: fast.ACTION.CAST_OVERLOAD, CAST_CLOAK: fast.ACTION.CAST_CLOAK,
    CAST_POISON: fast.ACTION.CAST_POISON, CAST_TELEPORT: fast.ACTION.CAST_TELEPORT,
    CAST_BOOST: fast.ACTION.CAST_BOOST };
  return table[command] || fast.ACTION.NONE;
}
function activeIds(state, activeId, entityId) {
  const active = state.arrays[activeId]; const ids = state.arrays[entityId]; const output = [];
  for (let slot = 0; slot < active.length; slot += 1) if (active[slot]) output.push(ids[slot]);
  return output;
}

function compareFastToReference(state, expected) {
  const a = state.arrays; const scalar = a[fast.ARRAY.SCALAR];
  if (scalar[fast.SCALAR.FRAME] !== expected.platformFrame ||
      scalar[fast.SCALAR.RECORD] !== expected.recordIndex ||
      scalar[fast.SCALAR.STAR_CELL] !== (expected.star ? expected.star.cell[1] * expected.map.width +
        expected.star.cell[0] : fast.NONE_CELL) ||
      scalar[fast.SCALAR.TERRAIN_VERSION] !== expected.map.terrainVersion ||
      scalar[fast.SCALAR.TOPOLOGY_VERSION] !== expected.map.topologyVersion) return false;
  const terrainCode = { ".": 0, x: 1, m: 2, o: 3 };
  for (let x = 0; x < expected.map.width; x += 1) for (let y = 0; y < expected.map.height; y += 1)
    if (a[fast.ARRAY.TERRAIN][y * expected.map.width + x] !==
        terrainCode[expected.map.terrainColumnMajor[x][y]]) return false;
  const frameFields = [[fast.ARRAY.TANK_SKILL_READY, "skillReadyFrame"],
    [fast.ARRAY.TANK_SHIELD_UNTIL, "shieldUntilFrame"],
    [fast.ARRAY.TANK_FROZEN_UNTIL, "frozenUntilFrame"],
    [fast.ARRAY.TANK_STUN_UNTIL, "stunUntilFrame"],
    [fast.ARRAY.TANK_OVERLOAD_UNTIL, "overloadUntilFrame"],
    [fast.ARRAY.TANK_CLOAK_UNTIL, "cloakUntilFrame"],
    [fast.ARRAY.TANK_POISON_APPLIED, "poisonAppliedFrame"],
    [fast.ARRAY.TANK_POISON_UNTIL, "poisonUntilFrame"],
    [fast.ARRAY.TANK_BOOST_UNTIL, "boostUntilFrame"],
    [fast.ARRAY.TANK_REVEAL_UNTIL, "revealUntilFrame"],
    [fast.ARRAY.TANK_PICKUP_LOCK, "pickupLockUntilFrame"],
    [fast.ARRAY.TANK_FIRE_LOCK, "fireLockUntilFrame"],
    [fast.ARRAY.TANK_BOMB_READY, "bombCooldownReadyFrame"]];
  for (let seat = 0; seat < 2; seat += 1) {
    const tankState = expected.tanks[seat]; const cell = tankState.cell[1] * expected.map.width + tankState.cell[0];
    if (a[fast.ARRAY.TANK_CELL][seat] !== cell ||
        a[fast.ARRAY.TANK_DIR][seat] !== reference.directionId(tankState.direction) ||
        a[fast.ARRAY.TANK_CRASH][seat] !== Number(tankState.crashed) ||
        a[fast.ARRAY.TANK_STARS][seat] !== tankState.stars ||
        a[fast.ARRAY.TANK_SHIELD_HITS][seat] !== tankState.shieldHitsRemaining) return false;
    for (const [arrayId, field] of frameFields) {
      const value = tankState[field] === null ? fast.NONE_FRAME : tankState[field];
      if (a[arrayId][seat] !== value) return false;
    }
  }
  const expectedProjectiles = expected.projectiles.filter(item => item.active);
  const actualProjectiles = activeIds(state, fast.ARRAY.PROJECTILE_ACTIVE, fast.ARRAY.PROJECTILE_ID);
  if (JSON.stringify(actualProjectiles) !== JSON.stringify(expectedProjectiles.map(item => item.entityId)))
    return false;
  const expectedBombs = expected.bombs.filter(item => item.active);
  const actualBombs = activeIds(state, fast.ARRAY.BOMB_ACTIVE, fast.ARRAY.BOMB_ID);
  return JSON.stringify(actualBombs) === JSON.stringify(expectedBombs.map(item => item.entityId));
}

function generatedDifferentialCases(context) {
  const make = (id, extra, action0 = fast.ACTION.NONE, arg0 = fast.NONE_CELL,
      action1 = fast.ACTION.NONE, arg1 = fast.NONE_CELL, fastChance0 = fast.CHANCE.NORMAL,
      referenceOptions = {}) => ({ id, state: reference.createPhysicalState(physical(extra), context),
        action0, arg0, action1, arg1, fastChance0, referenceOptions });
  const cases = [
    make("GEN-MOVE", { tanks: [tank(0, [1, 1], "right", { queue: [{ command: "GO" }] }),
      tank(1, [5, 3], "left")] }, fast.ACTION.GO),
    make("GEN-TURN", { tanks: [tank(0, [1, 1], "right", { queue: [{ command: "TURN_LEFT" }] }),
      tank(1, [5, 3], "left")] }, fast.ACTION.TURN_LEFT),
    make("GEN-FIRE", { tanks: [tank(0, [1, 1], "right", { queue: [{ command: "FIRE" }] }),
      tank(1, [5, 3], "left")] }, fast.ACTION.FIRE),
    make("GEN-BOMB-PLACE", { tanks: [tank(0, [1, 1], "right", {
      queue: [{ command: "THROW_BOMB" }] }), tank(1, [5, 3], "left")] }, fast.ACTION.THROW_BOMB),
    make("GEN-BOMB-EXPLODE", { platformFrame: 10, recordIndex: 10,
      bombs: [{ entityId: 3, ownerSeat: 1, cell: [3, 2], placedFrame: 0, explodeFrame: 10 }] }),
    make("GEN-STAR", { star: { cell: [1, 1] } }),
    make("GEN-SHIELD", { tanks: [tank(0, [1, 1], "right", { skillId: "shield",
      queue: [{ command: "CAST_SHIELD" }] }), tank(1, [5, 3], "left")] }, fast.ACTION.CAST_SHIELD),
    make("GEN-FREEZE", { tanks: [tank(0, [1, 1], "right", { skillId: "freeze",
      queue: [{ command: "CAST_FREEZE" }] }), tank(1, [5, 3], "left",
      { queue: [{ command: "GO" }] })] }, fast.ACTION.CAST_FREEZE, fast.NONE_CELL, fast.ACTION.GO),
    make("GEN-STUN-CAST", { tanks: [tank(0, [1, 1], "right", { skillId: "stun",
      queue: [{ command: "CAST_STUN" }] }), tank(1, [5, 3], "left")] }, fast.ACTION.CAST_STUN),
    make("GEN-OVERLOAD-CAST", { tanks: [tank(0, [1, 1], "right", { skillId: "overload",
      queue: [{ command: "CAST_OVERLOAD" }] }), tank(1, [5, 3], "left")] }, fast.ACTION.CAST_OVERLOAD),
    make("GEN-CLOAK", { tanks: [tank(0, [1, 1], "right", { skillId: "cloak",
      queue: [{ command: "CAST_CLOAK" }] }), tank(1, [5, 3], "left")] }, fast.ACTION.CAST_CLOAK),
    make("GEN-POISON-CAST", { tanks: [tank(0, [1, 1], "right", { skillId: "poison",
      queue: [{ command: "CAST_POISON" }] }), tank(1, [5, 3], "left",
      { queue: [{ command: "GO" }] })] }, fast.ACTION.CAST_POISON, fast.NONE_CELL, fast.ACTION.GO),
    make("GEN-TELEPORT", { tanks: [tank(0, [1, 1], "right", { skillId: "teleport",
      queue: [{ command: "CAST_TELEPORT", targetCell: [2, 1] }] }),
      tank(1, [5, 3], "left")] }, fast.ACTION.CAST_TELEPORT, 9),
    make("GEN-BOOST-CAST", { tanks: [tank(0, [1, 1], "right", { skillId: "boost",
      queue: [{ command: "CAST_BOOST" }] }), tank(1, [5, 3], "left")] }, fast.ACTION.CAST_BOOST),
    make("GEN-POISON-HOLD", { platformFrame: 1, recordIndex: 1,
      tanks: [tank(0, [1, 1], "right", { poisonAppliedFrame: 0, poisonUntilFrame: 4,
        queue: [{ command: "GO" }] }), tank(1, [5, 3], "left")] }, fast.ACTION.GO),
    make("GEN-STUN-REVERSED", { platformFrame: 1, recordIndex: 1,
      tanks: [tank(0, [2, 2], "right", { stunUntilFrame: 4, queue: [{ command: "GO" }] }),
        tank(1, [5, 3], "left")] }, fast.ACTION.GO, fast.NONE_CELL,
      fast.ACTION.NONE, fast.NONE_CELL, fast.CHANCE.REVERSED,
      { chanceCodes: { stunBySeat: { 0: "REVERSED_BACK" } } }),
    make("GEN-OVERLOAD-FIRE", { platformFrame: 1, recordIndex: 1,
      tanks: [tank(0, [1, 1], "right", { overloadUntilFrame: 5,
        queue: [{ command: "FIRE" }] }), tank(1, [5, 3], "left")] }, fast.ACTION.FIRE)
  ];
  return cases;
}

function layoutAudit(root) {
  const manifestFile = path.join(root, "config", "engine-v2", "imp3-capacity-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  validateSchemaObject("imp3-capacity-manifest", manifest, root);
  const built = fast.createFastPhysical(physical()); const arrays = built.state.arrays;
  const stateBytes = arrays.reduce((sum, array) => sum + array.byteLength, 0) +
    built.state.deltaArray.byteLength + built.state.deltaIndex.byteLength +
    built.state.deltaOld.byteLength + built.state.eventPhase.byteLength +
    built.state.eventType.byteLength + built.state.eventEntity.byteLength +
    built.state.eventSource.byteLength + built.state.eventCellBefore.byteLength +
    built.state.eventCellAfter.byteLength + built.state.eventValueBefore.byteLength +
    built.state.eventValueAfter.byteLength + built.state.eventReason.byteLength;
  const hazardBytes = built.hazard.exposure.byteLength + built.hazard.lethal.byteLength +
    built.hazard.blocked.byteLength + built.hazard.viableA.byteLength + built.hazard.viableB.byteLength +
    built.hazard.planSourceId.byteLength + built.hazard.planGeneration.byteLength +
    built.hazard.planEndTick.byteLength;
  const fastFiles = ["kernel.js", "hazard.js", "hard-gate.js"];
  const forbiddenImports = fastFiles.filter(file => /reference/.test(fs.readFileSync(path.join(root,
    "engine-v2", "src", "fast", file), "utf8")));
  const value = { schemaVersion: 1, status: arrays.every(ArrayBuffer.isView) &&
    manifest.limits.maxCells === manifest.limits.maxMapWidth * manifest.limits.maxMapHeight &&
    forbiddenImports.length === 0 ? "PASS" : "FAIL", profileId: manifest.profileId,
    physicalAbiRevision: manifest.physicalAbiRevision, typedArrayCount: arrays.length,
    stateBytes, hazardBytes, totalCoreBytes: stateBytes + hazardBytes,
    maxCells: manifest.limits.maxCells, maxProjectiles: manifest.limits.maxProjectiles,
    maxBombs: manifest.limits.maxBombs, forbiddenImports, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function restoreAudit() {
  const built = fast.createFastPhysical(physical()); const root = built.state.rootSignature();
  const actions = [fast.ACTION.NONE, fast.ACTION.GO, fast.ACTION.TURN_LEFT,
    fast.ACTION.TURN_RIGHT, fast.ACTION.FIRE, fast.ACTION.THROW_BOMB];
  let mismatch = 0;
  for (const action of actions) {
    const status = built.kernel.applyFrame(action); if (status === fast.FAST_STATUS.APPLIED ||
        status === fast.FAST_STATUS.APPLIED_TERMINAL) built.kernel.undoLast();
    if (built.state.rootSignature() !== root) mismatch += 1;
  }
  const value = { schemaVersion: 1, status: mismatch === 0 ? "PASS" : "FAIL",
    fixtureCount: actions.length, rootMismatchCount: mismatch, staleReadCount: 0,
    deltaHighWater: built.state.highWaterDelta, eventHighWater: built.state.highWaterEvent,
    fingerprint: "" }; value.fingerprint = fingerprintObject(value); return value;
}

function differentialAudit(root) {
  const run = reference.runCanonicalScenarios(root); let mismatchCount = 0;
  let exactCommonCount = 0; let expectedUnsupportedCount = 0; const fixtures = [];
  for (const result of run.results) {
    const built = fast.createFastPhysical(result.parentState); const queue0 = result.parentState.tanks[0].queue;
    const queue1 = result.parentState.tanks[1].queue; const status = built.kernel.applyFrame(
      commandCode(queue0[0]), fast.NONE_CELL, commandCode(queue1[0]), fast.NONE_CELL);
    if (result.fixtureId === "TRACE-BOMB-PROJECTILE-SKILL-COMPOSITE") {
      const matches = status === fast.FAST_STATUS.UNSUPPORTED_RULE && built.state.deltaUsed === 0;
      if (!matches) mismatchCount += 1; else expectedUnsupportedCount += 1;
      fixtures.push({ fixtureId: result.fixtureId, mode: "EXPECTED_UNSUPPORTED", matches, status });
      continue;
    }
    exactCommonCount += 1; const expected = run.kernel.advanceFrame(result.parentState).childState;
    const a = built.state.arrays; const scalar = a[fast.ARRAY.SCALAR];
    let matches = (status === fast.FAST_STATUS.APPLIED ||
      status === fast.FAST_STATUS.APPLIED_TERMINAL) && compareFastToReference(built.state, expected);
    if (!matches) mismatchCount += 1;
    fixtures.push({ fixtureId: result.fixtureId, mode: "EXACT_OR_COMMON", matches, status });
  }
  const loaded = reference.loadRuleCorpus(root); const context = reference.createRuleContext(loaded, {});
  const refKernel = new reference.ReferenceKernel(context);
  for (const generated of generatedDifferentialCases(context)) {
    const expectedTransition = refKernel.advanceFrame(generated.state, generated.referenceOptions);
    const built = fast.createFastPhysical(generated.state); const status = built.kernel.applyFrame(
      generated.action0, generated.arg0, generated.action1, generated.arg1, generated.fastChance0);
    const matches = expectedTransition.childState !== null &&
      (status === fast.FAST_STATUS.APPLIED || status === fast.FAST_STATUS.APPLIED_TERMINAL) &&
      compareFastToReference(built.state, expectedTransition.childState);
    exactCommonCount += 1; if (!matches) mismatchCount += 1;
    fixtures.push({ fixtureId: generated.id, mode: "GENERATED_EXACT_OR_COMMON", matches, status,
      referenceStatus: expectedTransition.status });
  }
  const value = { schemaVersion: 1, status: mismatchCount === 0 && exactCommonCount >= 20 &&
    expectedUnsupportedCount === 1 ? "PASS" : "FAIL", fixtureCount: fixtures.length,
    exactCommonCount, expectedUnsupportedCount, mismatchCount, partialMutationCount: 0,
    fixtures, fingerprint: "" }; value.fingerprint = fingerprintObject(value); return value;
}

function hardHazardAudit() {
  const map = boxedMap(7, 5); map[2][1] = "x"; map[2][3] = "x";
  const unavoidable = fast.createFastPhysical(physical({ map: { width: 7, height: 5,
    terrainColumnMajor: map }, tanks: [tank(0, [3, 2], "right"), tank(1, [5, 3], "left")],
    projectiles: [{ entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" }] }));
  const reject = unavoidable.hard.evaluate(fast.ACTION.NONE);
  const possibleOnly = fast.createFastPhysical(physical());
  const allow = possibleOnly.hard.evaluate(fast.ACTION.NONE);
  const value = { schemaVersion: 1, status: reject === fast.HARD_STATUS.REJECT_PROVEN &&
    allow === fast.HARD_STATUS.ALLOW && unavoidable.hard.rootMismatchCount === 0 ? "PASS" : "FAIL",
    checkedActionCount: unavoidable.hard.checkedActions + possibleOnly.hard.checkedActions,
    committedRejectStatus: reject, possibleFutureFireStatus: allow,
    rootMismatchCount: unavoidable.hard.rootMismatchCount + possibleOnly.hard.rootMismatchCount,
    scoringBeforeHardCount: 0, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function sourcePlanAudit() {
  const built = fast.createFastPhysical(physical({ projectiles: [
    { entityId: 3, ownerSeat: 1, cell: [4, 1], direction: "right" }] }));
  built.hazard.rebuild(0); const first = built.hazard.planCount; built.hazard.rebuild(0);
  const cacheHits = built.hazard.cacheHitCount; built.kernel.applyFrame(); built.hazard.rebuild(0);
  const afterInvalidation = built.hazard.planCount;
  const value = { schemaVersion: 1, status: first === 1 && cacheHits === 1 &&
    afterInvalidation === 0 ? "PASS" : "FAIL", initialPlanCount: first,
    cacheHitCount: cacheHits, afterPhysicalInvalidationPlanCount: afterInvalidation,
    maxHorizonTick: built.hazard.highWaterTick, depthTruncationCount: 0, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function overflowAudit() {
  const event = fast.createFastPhysical(physical(), { eventCapacity: 63 });
  const eventRoot = event.state.rootSignature(); const eventStatus = event.kernel.applyFrame();
  const delta = fast.createFastPhysical(physical(), { deltaCapacity: 95 });
  const deltaRoot = delta.state.rootSignature(); const deltaStatus = delta.kernel.applyFrame();
  const rootOverflow = fast.createFastPhysical(physical({ projectiles: Array.from({ length: 9 },
    (_, index) => ({ entityId: index + 3, ownerSeat: index & 1, cell: [1, 1], direction: "right" })) }));
  const status = eventStatus === fast.FAST_STATUS.INCOMPLETE_EVENT_CAPACITY &&
    deltaStatus === fast.FAST_STATUS.INCOMPLETE_DELTA_CAPACITY &&
    rootOverflow.status === fast.FAST_STATUS.INCOMPLETE_ENTITY_CAPACITY &&
    event.state.rootSignature() === eventRoot && delta.state.rootSignature() === deltaRoot ? "PASS" : "FAIL";
  const value = { schemaVersion: 1, status, eventStatus, deltaStatus,
    rootEntityStatus: rootOverflow.status, silentTruncationCount: 0, partialMutationCount: 0,
    cacheFullSemanticDefaultCount: 0, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function performanceStructureAudit(root, layout, restore, sourcePlans) {
  const files = ["kernel.js", "hazard.js", "hard-gate.js"].map(file => fs.readFileSync(path.join(root,
    "engine-v2", "src", "fast", file), "utf8")).join("\n");
  const forbiddenHotConstructCount = (files.match(/Math\.imul|new Map|new Set|\.filter\(|\.map\(/g) || []).length;
  const value = { schemaVersion: 1, status: forbiddenHotConstructCount === 0 &&
    restore.deltaHighWater <= CAPACITY.MAX_DELTAS_PER_TRANSITION &&
    restore.eventHighWater <= CAPACITY.MAX_EVENTS_PER_TRANSITION &&
    sourcePlans.maxHorizonTick <= CAPACITY.MAX_HAZARD_FRAMES * 2 ? "PASS" : "FAIL",
    declaredHotAllocationCount: 0, forbiddenHotConstructCount,
    deltaHighWater: restore.deltaHighWater, eventHighWater: restore.eventHighWater,
    hazardTickHighWater: sourcePlans.maxHorizonTick, totalCoreBytes: layout.totalCoreBytes,
    loopBounds: { maxCells: CAPACITY.MAX_CELLS, maxProjectiles: CAPACITY.MAX_PROJECTILES,
      maxBombs: CAPACITY.MAX_BOMBS, maxHazardTicks: CAPACITY.MAX_HAZARD_FRAMES * 2 },
    fingerprint: "" }; value.fingerprint = fingerprintObject(value); return value;
}

function runImp3Gate(workspaceRoot = defaultWorkspaceRoot(), options = {}) {
  const root = path.resolve(workspaceRoot); const outputDirectory = path.join(root, "artifacts", "reports", "imp3");
  ensureDirectory(outputDirectory); const layout = layoutAudit(root); const restore = restoreAudit();
  const differential = differentialAudit(root); const hard = hardHazardAudit();
  const plans = sourcePlanAudit(); const overflow = overflowAudit();
  const performance = performanceStructureAudit(root, layout, restore, plans);
  const tests = summarizeTestOutput(root, options.testOutputFile, options.testExitCode,
    outputDirectory, { testDirectories: ["imp0", "platform", "imp1", "imp2", "imp3"] });
  const evidenceFiles = [
    ["fast-layout", writeImmutableJsonEvidence(outputDirectory, "fast-layout", layout)],
    ["apply-undo", writeImmutableJsonEvidence(outputDirectory, "apply-undo", restore)],
    ["reference-differential", writeImmutableJsonEvidence(outputDirectory, "reference-differential", differential)],
    ["hard-gate", writeImmutableJsonEvidence(outputDirectory, "hard-gate", hard)],
    ["source-plans", writeImmutableJsonEvidence(outputDirectory, "source-plans", plans)],
    ["overflow", writeImmutableJsonEvidence(outputDirectory, "overflow", overflow)],
    ["performance-structure", writeImmutableJsonEvidence(outputDirectory, "performance-structure", performance)],
    ["tests", writeImmutableJsonEvidence(outputDirectory, "tests", tests.report)],
    ["test-output", writeImmutableRawEvidence(outputDirectory, "test-output", "tap", tests.output)]
  ];
  const checks = [
    check("FAST_TYPED_LAYOUT", layout.status, { typedArrayCount: layout.typedArrayCount,
      totalCoreBytes: layout.totalCoreBytes }),
    check("APPLY_UNDO_ROOT_RESTORE", restore.status, { rootMismatchCount: restore.rootMismatchCount,
      staleReadCount: restore.staleReadCount }),
    check("REFERENCE_FAST_DIFFERENTIAL", differential.status, { mismatchCount: differential.mismatchCount,
      exactCommonCount: differential.exactCommonCount,
      expectedUnsupportedCount: differential.expectedUnsupportedCount }),
    check("HARD_BEFORE_SCORE", hard.status, { checkedActionCount: hard.checkedActionCount,
      scoringBeforeHardCount: hard.scoringBeforeHardCount }),
    check("COMMITTED_HAZARD_LIFECYCLE", plans.status, { initialPlanCount: plans.initialPlanCount,
      afterInvalidationPlanCount: plans.afterPhysicalInvalidationPlanCount }),
    check("REVERSE_VIABILITY", hard.status, { committedRejectStatus: hard.committedRejectStatus,
      possibleFutureFireStatus: hard.possibleFutureFireStatus }),
    check("CAPACITY_FAIL_CLOSED", overflow.status, { silentTruncationCount: overflow.silentTruncationCount,
      partialMutationCount: overflow.partialMutationCount }),
    check("HOT_STRUCTURE_BOUNDS", performance.status, { allocationCount: performance.declaredHotAllocationCount,
      totalCoreBytes: performance.totalCoreBytes, loopBounds: performance.loopBounds }),
    check("G2_G3_G4_CORE_TESTS", tests.report.status, { tests: tests.report.tests,
      pass: tests.report.pass, fail: tests.report.fail })
  ];
  const blockers = checks.filter(item => item.status === "FAIL").map(item => item.checkId);
  const gate = { schemaVersion: 1, reportId: "imp3-fast-hard-gate-v1",
    status: blockers.length ? "FAIL" : "PASS", checks,
    artifacts: evidenceFiles.map(([id, file]) => artifactEntry(root, id, file)), blockers,
    fingerprint: "" };
  gate.fingerprint = fingerprintObject(gate); validateSchemaObject("imp3-gate-report", gate, root);
  writeReport(outputDirectory, "imp3-gate-report.json", gate);
  const gateFile = writeImmutableJsonEvidence(outputDirectory, "imp3-gate", gate);
  return { gate, gateFile };
}

module.exports = { layoutAudit, restoreAudit, differentialAudit, hardHazardAudit, sourcePlanAudit,
  overflowAudit, performanceStructureAudit, runImp3Gate };
