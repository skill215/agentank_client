"use strict";

const { fingerprintObject } = require("../core/hash");
const { FastRegressionStore } = require("./artifact-store");
const { preloadReplayCorpus } = require("./preloaded-corpus");
const { loadCohort, laneEntries, verifyCapsule, verifyPreloadedBundle } = require("./verify");

function selectMatchEntries(entries, maximumMatches) {
  const selected = new Set();
  for (const entry of entries) {
    if (!selected.has(entry.matchId) && selected.size >= maximumMatches) continue;
    selected.add(entry.matchId);
    if (selected.size >= maximumMatches) break;
  }
  return entries.filter(entry => selected.has(entry.matchId));
}

function comparableFingerprint(result) {
  const value = { ...result }; delete value.runtimeMicros;
  return fingerprintObject(value);
}

async function benchmarkReplay(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const cohortReference = options.cohort || "initial-full";
  const cohort = loadCohort(store, cohortReference);
  const allEntries = laneEntries(store, "capsule-all", cohortReference);
  const maximumMatches = Math.max(1, Math.floor(Number(options.maximumMatches) || 8));
  const entries = selectMatchEntries(allEntries, maximumMatches);

  const legacyStarted = process.hrtime.bigint(); const legacy = [];
  for (let index = 0; index < entries.length; index += 1) {
    const { capsule } = store.readCapsule(entries[index]);
    legacy.push(await verifyCapsule(workspaceRoot, capsule,
      { historicalRuntime: options.historicalRuntime !== false, branchWindow: false }));
    if (typeof options.onProgress === "function")
      options.onProgress("LEGACY", index + 1, entries.length);
  }
  const legacyRuntimeMicros = Number((process.hrtime.bigint() - legacyStarted) / 1000n);

  const preloadedStarted = process.hrtime.bigint();
  const corpus = preloadReplayCorpus(store, entries, { onProgress(done, total) {
    if (typeof options.onProgress === "function") options.onProgress("PRELOAD", done, total);
  } });
  const byFingerprint = new Map(); let physicalSteps = 0;
  for (let index = 0; index < corpus.bundles.length; index += 1) {
    const verified = await verifyPreloadedBundle(workspaceRoot, corpus.bundles[index], options);
    physicalSteps += verified.physicalSteps;
    for (const result of verified.results) byFingerprint.set(result.fingerprint, result);
    if (typeof options.onProgress === "function")
      options.onProgress("BATCH", index + 1, corpus.bundles.length);
  }
  const preloadedRuntimeMicros = Number((process.hrtime.bigint() - preloadedStarted) / 1000n);
  const preloaded = entries.map(entry => byFingerprint.get(entry.fingerprint));
  const mismatches = [];
  for (let index = 0; index < entries.length; index += 1) {
    const expected = comparableFingerprint(legacy[index]);
    const actual = comparableFingerprint(preloaded[index]);
    if (expected !== actual) mismatches.push({ fingerprint: entries[index].fingerprint,
      expected, actual });
  }
  const faster = preloadedRuntimeMicros < legacyRuntimeMicros;
  const report = { artifactKind: "FAST_REGRESSION_REPLAY_PERFORMANCE_BENCHMARK",
    status: mismatches.length === 0 && faster ? "PASS" : "FAIL",
    properties: ["HISTORICAL_ONLY", "NO_NEW_ARENA", "RESULT_DIFFERENTIAL",
      "END_TO_END_IO_INCLUDED"], cohort: cohort ? { reference: cohortReference,
      fingerprint: cohort.fingerprint, capsuleRoot: cohort.source?.capsuleRoot || null } : null,
    denominator: { requestedMaximumMatches: maximumMatches,
      selectedMatchIds: new Set(entries.map(entry => entry.matchId)).size,
      capsules: entries.length }, preload: corpus.stats,
    replay: { legacyRuntimeMicros, preloadedRuntimeMicros, physicalSteps,
      speedupPer10000: preloadedRuntimeMicros === 0 ? 0 :
        Math.floor(legacyRuntimeMicros * 10000 / preloadedRuntimeMicros), faster },
    differential: { compared: entries.length, mismatchCount: mismatches.length,
      mismatches: mismatches.slice(0, 32) }, memory: process.memoryUsage() };
  return store.writeReport(report, options.reportName || "replay-performance");
}

module.exports = { selectMatchEntries, comparableFingerprint, benchmarkReplay };
