"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fingerprintObject } = require("../../tools/agentank/core/hash");
const { preloadReplayCorpus } =
  require("../../tools/agentank/fast-regression/preloaded-corpus");

function capsule(matchId, frame, length, mutation = null) {
  const steps = Array.from({ length }, (_, index) => ({ frame: index,
    actions: [{ type: "go" }, null], decisions: [], eventFingerprint: `event-${index}` }));
  if (mutation) mutation(steps);
  const decisions = Array.from({ length }, (_, index) => ({ frame: index,
    seats: [{ implementation: "v2", command: { type: "go" }, workUnits: index }, null] }));
  const value = { source: { matchId, runId: "run", scenarioFingerprint: "scenario",
      v1Sha256: "v1", v2Sha256: "v2", parameterFingerprint: "parameters" },
    simulator: { commit: "commit", archiveSha256: "archive", seed: 1, maxFrames: 128 },
    scenario: { map: [["."]], starts: [], stars: [] },
    assignment: { v2Seat: 0, seatSkills: ["poison", "stun"] },
    restorePolicy: { physicalState: "REPLAY_STEP_PREFIX", factMemory: "OBSERVE_ONLY" },
    window: { startFrame: frame, evaluationFrame: frame, endFrame: frame,
      tags: [`FRAME_${frame}`] }, prefix: { stepTrace: steps, decisionTrace: decisions },
    observations: [{ frame, fingerprint: `observation-${frame}` }],
    original: { intentionallyLargeAndUnused: "x".repeat(4096) }, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function entry(value) { return { fingerprint: value.fingerprint,
  relativePath: `replay-capsules/${value.fingerprint}.json`,
  matchId: value.source.matchId, evaluationFrame: value.window.evaluationFrame,
  tags: value.window.tags.slice() }; }

test("preload compacts every historical match before replay and reads each capsule once", () => {
  const first = capsule("match-a", 0, 1); const last = capsule("match-a", 3, 4);
  const other = capsule("match-b", 1, 2); const values = new Map(
    [first, last, other].map(value => [value.fingerprint, value]));
  const reads = [];
  const store = { readCapsule(reference) { reads.push(reference.fingerprint);
    return { capsule: values.get(reference.fingerprint), file: reference.relativePath }; } };
  const corpus = preloadReplayCorpus(store, [entry(first), entry(other), entry(last)]);
  assert.equal(corpus.bundles.length, 2); assert.equal(corpus.stats.capsulesLoaded, 3);
  assert.equal(corpus.stats.matchesLoaded, 2); assert.equal(new Set(reads).size, 3);
  const bundle = corpus.bundles.find(item => item.matchId === "match-a");
  assert.equal(bundle.authority.prefix.stepTrace.length, 4);
  assert.deepEqual(bundle.targets.map(target => target.evaluationFrame), [0, 3]);
  assert.equal("original" in bundle.authority, false);
  assert.equal("original" in bundle.targets[0], false);
});

test("preload rejects divergent prefixes inside one historical match", () => {
  const first = capsule("match-a", 1, 2);
  const divergent = capsule("match-a", 3, 4, steps => {
    steps[0].actions[0] = { type: "turn", side: "left" };
  });
  const values = new Map([first, divergent].map(value => [value.fingerprint, value]));
  const store = { readCapsule(reference) { return {
    capsule: values.get(reference.fingerprint), file: reference.relativePath }; } };
  assert.throws(() => preloadReplayCorpus(store, [entry(first), entry(divergent)]),
    error => error.code === "FAST_REGRESSION_PRELOAD_STEP_DIVERGENCE");
});
