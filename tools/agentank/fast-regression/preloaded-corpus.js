"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { invariant } = require("../core/errors");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { writeFileImmutable, writeJsonAtomic, writeJsonImmutable } =
  require("../core/atomic-file");

const COMPILED_FORMAT_VERSION = 1;

function sameValue(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function replayIdentity(capsule) {
  const source = capsule.source || {};
  return fingerprintObject({ source: { matchId: source.matchId ?? null,
    historicalMatchUrlId: source.historicalMatchUrlId ?? null,
    scenarioFingerprint: source.scenarioFingerprint ?? null,
    v1Sha256: source.v1Sha256 ?? null, v2Sha256: source.v2Sha256 ?? null,
    parameterFingerprint: source.parameterFingerprint ?? null }, simulator: capsule.simulator,
    scenario: capsule.scenario, assignment: capsule.assignment,
    restorePolicy: capsule.restorePolicy });
}

function validateEntry(entry, capsule) {
  invariant(entry.fingerprint === capsule.fingerprint,
    "FAST_REGRESSION_PRELOAD_FINGERPRINT_MISMATCH", entry.fingerprint);
  invariant(entry.matchId === capsule.source.matchId,
    "FAST_REGRESSION_PRELOAD_MATCH_MISMATCH", entry.fingerprint);
  invariant(entry.evaluationFrame === capsule.window.evaluationFrame,
    "FAST_REGRESSION_PRELOAD_FRAME_MISMATCH", entry.fingerprint);
  invariant(sameValue(entry.tags, capsule.window.tags),
    "FAST_REGRESSION_PRELOAD_TAG_MISMATCH", entry.fingerprint);
}

function validatePrefix(authority, capsule) {
  invariant(replayIdentity(authority) === replayIdentity(capsule),
    "FAST_REGRESSION_PRELOAD_IDENTITY_DIVERGENCE", capsule.fingerprint);
  invariant(capsule.prefix.stepTrace.length <= authority.prefix.stepTrace.length &&
    capsule.prefix.decisionTrace.length <= authority.prefix.decisionTrace.length,
  "FAST_REGRESSION_PRELOAD_AUTHORITY_TOO_SHORT", capsule.fingerprint);
  for (let index = 0; index < capsule.prefix.stepTrace.length; index += 1) {
    const expected = authority.prefix.stepTrace[index];
    const actual = capsule.prefix.stepTrace[index];
    invariant(expected && expected.frame === actual.frame &&
      expected.eventFingerprint === actual.eventFingerprint &&
      sameValue(expected.actions, actual.actions) && sameValue(expected.decisions, actual.decisions),
    "FAST_REGRESSION_PRELOAD_STEP_DIVERGENCE", `${capsule.fingerprint}:${actual.frame}`);
  }
  for (let index = 0; index < capsule.prefix.decisionTrace.length; index += 1) {
    const expected = authority.prefix.decisionTrace[index];
    const actual = capsule.prefix.decisionTrace[index];
    invariant(expected && expected.frame === actual.frame && sameValue(expected, actual),
      "FAST_REGRESSION_PRELOAD_DECISION_DIVERGENCE",
      `${capsule.fingerprint}:${actual.frame}`);
  }
}

function compactAuthority(capsule) {
  return { fingerprint: capsule.fingerprint, source: capsule.source,
    simulator: capsule.simulator, scenario: capsule.scenario, assignment: capsule.assignment,
    prefix: capsule.prefix, restorePolicy: capsule.restorePolicy };
}

function compactTarget(capsule) {
  const evaluationFrame = capsule.window.evaluationFrame;
  const expected = capsule.observations.find(item => item.frame === evaluationFrame);
  return { fingerprint: capsule.fingerprint, matchId: capsule.source.matchId,
    evaluationFrame, tags: capsule.window.tags.slice(),
    expectedObservationFingerprint: expected?.fingerprint || null };
}

function preloadReplayCorpus(store, entries, options = {}) {
  const started = process.hrtime.bigint(); const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.matchId)) groups.set(entry.matchId, []);
    groups.get(entry.matchId).push(entry);
  }
  const bundles = []; let capsulesLoaded = 0; let rawBytesRead = 0;
  let legacyPrefixFrames = 0; let sharedPhysicalPrefixFrames = 0;
  for (const [matchId, groupEntries] of groups) {
    const loaded = groupEntries.map(entry => {
      const result = store.readCapsule(entry); validateEntry(entry, result.capsule);
      if (fs.existsSync(result.file)) rawBytesRead += fs.statSync(result.file).size;
      capsulesLoaded += 1;
      if (typeof options.onProgress === "function")
        options.onProgress(capsulesLoaded, entries.length, matchId);
      return result.capsule;
    });
    const sourceRuns = new Map();
    for (const capsule of loaded) {
      const key = `${capsule.source.runId || "UNBOUND"}\0${replayIdentity(capsule)}`;
      if (!sourceRuns.has(key)) sourceRuns.set(key, []);
      sourceRuns.get(key).push(capsule);
    }
    for (const sourceRun of sourceRuns.values()) {
      sourceRun.sort((left, right) => right.prefix.stepTrace.length - left.prefix.stepTrace.length ||
        right.window.evaluationFrame - left.window.evaluationFrame ||
        left.fingerprint.localeCompare(right.fingerprint));
      const authoritySource = sourceRun[0];
      for (const capsule of sourceRun) validatePrefix(authoritySource, capsule);
      const targets = sourceRun.map(compactTarget).sort((left, right) =>
        left.evaluationFrame - right.evaluationFrame || left.fingerprint.localeCompare(right.fingerprint));
      const maximumTarget = targets.at(-1).evaluationFrame;
      invariant(authoritySource.prefix.stepTrace.length > maximumTarget,
        "FAST_REGRESSION_PRELOAD_TARGET_UNAVAILABLE", `${matchId}:${maximumTarget}`);
      legacyPrefixFrames += targets.reduce((sum, target) => sum + target.evaluationFrame, 0);
      sharedPhysicalPrefixFrames += maximumTarget;
      bundles.push({ matchId, sourceRunId: authoritySource.source.runId || null,
        replayIdentity: replayIdentity(authoritySource), authority: compactAuthority(authoritySource),
        targets, maximumTarget });
    }
  }
  return { bundles, stats: { executionModel: "PRELOAD_COMPACT_MATCH_BUNDLES_V1",
    loadedBeforeReplay: true, capsulesLoaded, matchesLoaded: bundles.length, rawBytesRead,
    legacyPrefixFrames, sharedPhysicalPrefixFrames,
    repeatedPhysicalFramesEliminated: legacyPrefixFrames - sharedPhysicalPrefixFrames,
    physicalReplayReductionPer10000: sharedPhysicalPrefixFrames === 0 ? 10000 :
      Math.floor(legacyPrefixFrames * 10000 / sharedPhysicalPrefixFrames),
    preloadRuntimeMicros: Number((process.hrtime.bigint() - started) / 1000n) } };
}

function compiledDirectory(store, cohort) {
  invariant(cohort && /^[a-f0-9]{64}$/.test(cohort.fingerprint || ""),
    "FAST_REGRESSION_COMPILED_COHORT_INVALID", cohort?.fingerprint || "missing");
  return path.join(store.paths.history, "compiled-replay-corpora", cohort.fingerprint);
}

function stablePreloadStats(stats) {
  const output = { ...stats }; delete output.preloadRuntimeMicros; return output;
}

function writeCompiledReplayCorpus(store, cohort, corpus) {
  const data = { formatVersion: COMPILED_FORMAT_VERSION, bundles: corpus.bundles };
  const raw = Buffer.from(JSON.stringify(data), "utf8");
  const compressed = zlib.gzipSync(raw, { level: 1, mtime: 0 });
  const rawSha256 = sha256Bytes(raw); const compressedSha256 = sha256Bytes(compressed);
  const directory = compiledDirectory(store, cohort);
  const dataName = `${compressedSha256}.json.gz`; const dataFile = path.join(directory, dataName);
  writeFileImmutable(dataFile, compressed, { mode: 0o644 });
  const manifest = { artifactKind: "FAST_REGRESSION_COMPILED_REPLAY_CORPUS",
    formatVersion: COMPILED_FORMAT_VERSION,
    properties: ["DERIVED_CACHE", "CONTENT_ADDRESSED", "SOURCE_BOUND", "RULE_BOUND",
      "SINGLE_MEMORY_IMAGE", "REBUILDABLE_FROM_CAPSULES"],
    cohort: { fingerprint: cohort.fingerprint,
      capsuleRoot: cohort.source?.capsuleRoot || null },
    denominator: { capsules: corpus.stats.capsulesLoaded,
      matchBundles: corpus.bundles.length },
    data: { file: dataName, compressedBytes: compressed.byteLength,
      uncompressedBytes: raw.byteLength, compressedSha256, rawSha256 },
    preload: stablePreloadStats(corpus.stats), fingerprint: "" };
  manifest.fingerprint = fingerprintObject(manifest);
  const manifestFile = path.join(directory, `${manifest.fingerprint}.manifest.json`);
  writeJsonImmutable(manifestFile, manifest, { mode: 0o644 });
  writeJsonAtomic(path.join(directory, "latest.json"), manifest, { mode: 0o644 });
  return { manifest, manifestFile, dataFile };
}

function loadCompiledReplayCorpus(store, cohort) {
  const started = process.hrtime.bigint(); const directory = compiledDirectory(store, cohort);
  const latest = path.join(directory, "latest.json"); if (!fs.existsSync(latest)) return null;
  const manifest = JSON.parse(fs.readFileSync(latest, "utf8"));
  invariant(manifest.fingerprint === fingerprintObject(manifest) &&
    manifest.artifactKind === "FAST_REGRESSION_COMPILED_REPLAY_CORPUS" &&
    manifest.formatVersion === COMPILED_FORMAT_VERSION &&
    manifest.cohort.fingerprint === cohort.fingerprint &&
    manifest.cohort.capsuleRoot === (cohort.source?.capsuleRoot || null),
  "FAST_REGRESSION_COMPILED_MANIFEST_INVALID", latest);
  invariant(/^[a-f0-9]{64}\.json\.gz$/.test(manifest.data.file),
    "FAST_REGRESSION_COMPILED_FILE_INVALID", manifest.data.file);
  const dataFile = path.join(directory, manifest.data.file);
  invariant(fs.existsSync(dataFile), "FAST_REGRESSION_COMPILED_FILE_MISSING", dataFile);
  const compressed = fs.readFileSync(dataFile);
  invariant(compressed.byteLength === manifest.data.compressedBytes &&
    sha256Bytes(compressed) === manifest.data.compressedSha256,
  "FAST_REGRESSION_COMPILED_BYTES_MISMATCH", dataFile);
  let raw;
  try { raw = zlib.gunzipSync(compressed); }
  catch { invariant(false, "FAST_REGRESSION_COMPILED_DECOMPRESSION_FAILED", dataFile); }
  invariant(raw.byteLength === manifest.data.uncompressedBytes &&
    sha256Bytes(raw) === manifest.data.rawSha256,
  "FAST_REGRESSION_COMPILED_RAW_MISMATCH", dataFile);
  const data = JSON.parse(raw.toString("utf8"));
  invariant(data.formatVersion === COMPILED_FORMAT_VERSION && Array.isArray(data.bundles) &&
    data.bundles.length === manifest.denominator.matchBundles,
  "FAST_REGRESSION_COMPILED_DATA_INVALID", dataFile);
  return { cacheHit: true, bundles: data.bundles, manifest, dataFile,
    stats: { ...manifest.preload, executionModel: "COMPILED_REPLAY_MEMORY_IMAGE_V1",
      loadedBeforeReplay: true, cacheHit: true,
      memoryImageCompressedBytes: compressed.byteLength,
      memoryImageUncompressedBytes: raw.byteLength,
      preloadRuntimeMicros: Number((process.hrtime.bigint() - started) / 1000n) } };
}

module.exports = { COMPILED_FORMAT_VERSION, replayIdentity, validatePrefix,
  preloadReplayCorpus, writeCompiledReplayCorpus, loadCompiledReplayCorpus };
