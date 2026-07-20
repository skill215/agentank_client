"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FastRegressionStore } = require("../../tools/agentank/fast-regression/artifact-store");
const { writeCompiledReplayCorpus, loadCompiledReplayCorpus } =
  require("../../tools/agentank/fast-regression/preloaded-corpus");

function fixture() {
  const bundle = { matchId: "match-a", sourceRunId: "run-a", replayIdentity: "identity",
    authority: { source: { matchId: "match-a" }, simulator: { seed: 1 },
      scenario: { map: [["."]], starts: [], stars: [] },
      assignment: { v2Seat: 0, seatSkills: ["poison", "stun"] },
      prefix: { stepTrace: [], decisionTrace: [] }, restorePolicy: {} },
    targets: [{ fingerprint: "a".repeat(64), matchId: "match-a", evaluationFrame: 0,
      tags: ["ROOT"], expectedObservationFingerprint: "b".repeat(64) }], maximumTarget: 0 };
  return { bundles: [bundle], stats: { executionModel: "PRELOAD_COMPACT_MATCH_BUNDLES_V1",
    loadedBeforeReplay: true, capsulesLoaded: 1, matchesLoaded: 1, rawBytesRead: 10,
    legacyPrefixFrames: 0, sharedPhysicalPrefixFrames: 0,
    repeatedPhysicalFramesEliminated: 0, physicalReplayReductionPer10000: 10000,
    preloadRuntimeMicros: 123 } };
}

test("compiled replay corpus loads one verified memory image for repeated regression", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-compiled-replay-"));
  const store = new FastRegressionStore(root); store.initialize();
  const cohort = { fingerprint: "c".repeat(64), source: { capsuleRoot: "d".repeat(64) } };
  const written = writeCompiledReplayCorpus(store, cohort, fixture());
  const loaded = loadCompiledReplayCorpus(store, cohort);
  assert.equal(loaded.cacheHit, true); assert.equal(loaded.bundles.length, 1);
  assert.deepEqual(loaded.bundles, fixture().bundles);
  assert.equal(loaded.stats.capsulesLoaded, 1);
  assert.equal(loaded.manifest.fingerprint, written.manifest.fingerprint);
});

test("compiled replay corpus rejects a corrupted memory image", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-compiled-corrupt-"));
  const store = new FastRegressionStore(root); store.initialize();
  const cohort = { fingerprint: "e".repeat(64), source: { capsuleRoot: "f".repeat(64) } };
  const written = writeCompiledReplayCorpus(store, cohort, fixture());
  fs.writeFileSync(written.dataFile, "corrupt");
  assert.throws(() => loadCompiledReplayCorpus(store, cohort),
    error => error.code === "FAST_REGRESSION_COMPILED_BYTES_MISMATCH");
});
