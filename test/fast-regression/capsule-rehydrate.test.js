"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { fingerprintObject } = require("../../tools/agentank/core/hash");
const { loadSimulator, runMatch, VARIANTS, SIMULATOR_COMMIT,
  SIMULATOR_ARCHIVE_SHA256, portableScheduledAction, portableScheduledDecision } =
  require("../../tools/agentank/simulation/paired-arena");
const { selectWindows, buildCapsuleDraft } =
  require("../../tools/agentank/fast-regression/capsule");
const { rehydratePhysical, rehydrateV2Memory, rehydrateV2MemoryBatch,
  replayScriptedWindow } =
  require("../../tools/agentank/fast-regression/rehydrate");
const { preloadReplayCorpus } =
  require("../../tools/agentank/fast-regression/preloaded-corpus");
const { inspectRootsAtFrames } =
  require("../../tools/agentank/fast-regression/focused-diagnostic");
const { actionProxy } =
  require("../../tools/agentank/simulation/production-diagnostic-bot");
const { selectedRootAudit } = require("../../tools/agentank/fast-regression/verify");

const root = path.resolve(__dirname, "../..");

test("Replay Capsule rehydrates physical events and V2 fact memory from logical prefixes", async () => {
  const map = Array.from({ length: 7 }, (_, x) => Array.from({ length: 7 }, (_, y) =>
    x === 0 || y === 0 || x === 6 || y === 6 ? "x" : "."));
  const scenario = { matchUrlId: "synthetic-fast-regression", mapHash: "synthetic",
    map, starts: [
      { id: "historical-seat-0", position: [1, 1], direction: "right" },
      { id: "historical-seat-1", position: [5, 5], direction: "left" }
    ], stars: [{ frame: 0, position: [3, 3] }], fingerprint: "" };
  scenario.fingerprint = fingerprintObject(scenario);
  const loaded = await loadSimulator(root); const variant = VARIANTS[1];
  const v1Code = 'function onIdle(me){ me.turn("right"); }';
  const match = await runMatch(loaded.module, scenario, variant, 0, v1Code, 200, {},
    { captureActions: true, captureAllFrames: true, captureStepTrace: true,
      includeReplay: true, includeContexts: true });
  const windows = selectWindows(match, { maximumPerMatch: 4 }); assert.ok(windows.length >= 1);
  const window = windows.at(-1); const capsule = buildCapsuleDraft(match, scenario, window,
    { simulatorCommit: SIMULATOR_COMMIT, simulatorArchiveSha256: SIMULATOR_ARCHIVE_SHA256,
      seed: Number.parseInt(require("node:crypto").createHash("sha256")
        .update(`${scenario.fingerprint}\0${0}`).digest("hex").slice(0, 8), 16) >>> 0,
      v1Sha256: "v1", v2Sha256: "v2", parameterFingerprint: "parameters" });
  capsule.fingerprint = fingerprintObject(capsule);
  const physical = await rehydratePhysical(root, capsule, window.evaluationFrame);
  const memory = await rehydrateV2Memory(root, capsule, window.evaluationFrame);
  assert.equal(physical.physicalFingerprint, memory.physicalFingerprint);
  assert.equal(physical.verifiedEvents, window.evaluationFrame);
  assert.ok(memory.observedDecisions >= 0); assert.match(memory.memoryFingerprint, /^[a-f0-9]{64}$/);
  const historicalCommand = capsule.prefix.stepTrace.find(step =>
    step.frame === window.evaluationFrame).actions[match.v2Seat];
  const scripted = await replayScriptedWindow(root, capsule, historicalCommand);
  assert.equal(scripted.sameFirstAction, true); assert.equal(scripted.exactReproductionFailure, 0);
  const earlierFrame = Math.max(window.startFrame, window.evaluationFrame - 1);
  const earlierCommand = capsule.prefix.stepTrace.find(step => step.frame === earlierFrame)
    .actions[match.v2Seat];
  const earlier = await replayScriptedWindow(root, capsule, earlierCommand,
    { branchFrame: earlierFrame });
  assert.equal(earlier.branchFrame, earlierFrame); assert.equal(earlier.sameFirstAction, true);
  assert.equal(earlier.exactReproductionFailure, 0);
  const trajectory = await inspectRootsAtFrames(root, capsule,
    [earlierFrame, window.evaluationFrame]);
  assert.equal(trajectory.size, earlierFrame === window.evaluationFrame ? 1 : 2);
  const earlierPhysical = await rehydratePhysical(root, capsule, earlierFrame);
  assert.equal(trajectory.get(earlierFrame).physicalFingerprint,
    earlierPhysical.physicalFingerprint);

  const selectedWindows = [windows[0], windows.at(-1)].filter((item, index, values) =>
    values.findIndex(candidate => candidate.evaluationFrame === item.evaluationFrame) === index);
  assert.ok(selectedWindows.length >= 2);
  const capsules = selectedWindows.map(item => {
    const value = buildCapsuleDraft(match, scenario, item,
      { simulatorCommit: SIMULATOR_COMMIT, simulatorArchiveSha256: SIMULATOR_ARCHIVE_SHA256,
        seed: Number.parseInt(require("node:crypto").createHash("sha256")
          .update(`${scenario.fingerprint}\0${0}`).digest("hex").slice(0, 8), 16) >>> 0,
        v1Sha256: "v1", v2Sha256: "v2", parameterFingerprint: "parameters" });
    value.fingerprint = fingerprintObject(value); return value;
  });
  const byFingerprint = new Map(capsules.map(value => [value.fingerprint, value]));
  const entries = capsules.map(value => ({ fingerprint: value.fingerprint,
    relativePath: `memory/${value.fingerprint}.json`, matchId: value.source.matchId,
    evaluationFrame: value.window.evaluationFrame, tags: value.window.tags }));
  const corpus = preloadReplayCorpus({ readCapsule(reference) { return {
    capsule: byFingerprint.get(reference.fingerprint), file: reference.relativePath }; } }, entries);
  const batch = await rehydrateV2MemoryBatch(root, corpus.bundles[0]);
  for (const value of capsules) {
    const legacy = await rehydrateV2Memory(root, value, value.window.evaluationFrame);
    const restored = batch.restored.get(value.fingerprint);
    assert.equal(restored.physicalFingerprint, legacy.physicalFingerprint);
    assert.equal(restored.memoryFingerprint, legacy.memoryFingerprint);
    assert.equal(restored.observedDecisions, legacy.observedDecisions);
    assert.equal(restored.verifiedEvents, legacy.verifiedEvents);
    const batchActions = []; const legacyActions = [];
    const batchAction = restored.engine.decide(actionProxy(restored.context.me, batchActions),
      restored.context.enemy, restored.context.game);
    const legacyAction = legacy.engine.decide(actionProxy(legacy.context.me, legacyActions),
      legacy.context.enemy, legacy.context.game);
    assert.equal(batchAction, legacyAction); assert.deepEqual(batchActions, legacyActions);
    assert.deepEqual(selectedRootAudit(restored.engine, batchAction),
      selectedRootAudit(legacy.engine, legacyAction));
  }
});

test("scheduled replay evidence excludes non-physical fractional action metadata", () => {
  assert.deepEqual(portableScheduledAction({ type: "go", reason: 12.5, score: 9.75 }),
    { type: "go" });
  assert.deepEqual(portableScheduledAction({ type: "timeout", runtimeMs: 200.125 }),
    { type: "timeout" });
  assert.deepEqual(portableScheduledAction({ type: "turn", side: "left", reason: "evade" }),
    { type: "turn", side: "left", reason: "evade" });
  assert.deepEqual(portableScheduledDecision({ runtimeMs: 0.1234, logs: [
    { type: "speak", data: 4.5, confidence: 0.75 },
    { type: "debug", data: 1.25 }
  ] }), { runtimeMicros: 123, logs: [{ type: "speak", data: "4.5" }] });
});
