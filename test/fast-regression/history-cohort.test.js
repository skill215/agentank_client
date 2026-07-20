"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { historySnapshotDocument, historyDelta } =
  require("../../tools/agentank/fast-regression/history");
const { deduplicateLogical, greedyCover } =
  require("../../tools/agentank/fast-regression/cohort");
const { logicalWindowFingerprint } = require("../../tools/agentank/fast-regression/capsule");

test("unchanged dynamic V1 input has a stable snapshot identity and an empty delta", () => {
  const rolling = { snapshot: { snapshotId: "source", fingerprint: "source-fingerprint",
    sourceIndex: { sha256: "index" } } };
  const entries = [{ matchUrlId: "a", mapFingerprint: "m", startsFingerprint: "s",
    starSequenceFingerprint: "z" }];
  const first = historySnapshotDocument(rolling, entries);
  const second = historySnapshotDocument(rolling, entries);
  assert.equal(second.fingerprint, first.fingerprint);
  const delta = historyDelta(first, second);
  assert.deepEqual(delta.addedMatchUrlIds, []); assert.deepEqual(delta.removedMatchUrlIds, []);
});

test("local runtime measurements do not split one logical Replay Capsule", () => {
  const capsule = { source: { matchId: "m", historicalMatchUrlId: "h",
    scenarioFingerprint: "s", v1Sha256: "v1", v2Sha256: "v2", parameterFingerprint: "p" },
  simulator: { commit: "c", seed: 1, maxFrames: 128 }, assignment: { variantId: "v" },
  window: { startFrame: 0, evaluationFrame: 1, endFrame: 1, tags: ["x"] },
  prefix: { stepTrace: [{ frame: 0, actions: [{ type: "go" }, null],
    decisions: [{ runtimeMicros: 1 }], eventFingerprint: "e" }] } };
  const changedRuntime = JSON.parse(JSON.stringify(capsule));
  changedRuntime.prefix.stepTrace[0].decisions[0].runtimeMicros = 999999;
  assert.equal(logicalWindowFingerprint(changedRuntime), logicalWindowFingerprint(capsule));
});

test("cohort construction removes duplicate logical windows and stops after full coverage", () => {
  const entries = [
    { fingerprint: "a", logicalFingerprint: "same", features: ["map:a", "tag:x"] },
    { fingerprint: "b", logicalFingerprint: "same", features: ["map:a", "tag:x"] },
    { fingerprint: "c", logicalFingerprint: "other", features: ["tag:y"] }
  ];
  const unique = deduplicateLogical(entries); assert.equal(unique.length, 2);
  const cover = greedyCover(unique, 64); assert.equal(cover.selected.length, 2);
  assert.deepEqual(cover.uncovered, []);
});
