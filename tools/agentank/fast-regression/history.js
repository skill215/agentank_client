"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadRollingV1Scenarios } = require("../simulation/historical-scenarios");
const { fingerprintObject } = require("../core/hash");
const { writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { FastRegressionStore } = require("./artifact-store");

function historySnapshotDocument(rolling, entries) {
  const matchUrlIds = entries.map(item => item.matchUrlId);
  const snapshot = {
    schemaVersion: 1,
    artifactKind: "FAST_REGRESSION_DYNAMIC_V1_HISTORY",
    properties: ["DISCOVERY_ONLY", "DYNAMIC_SOURCE", "APPEND_ONLY_SNAPSHOTS"],
    sourceSnapshotId: rolling.snapshot.snapshotId,
    sourceSnapshotFingerprint: rolling.snapshot.fingerprint,
    sourceIndex: rolling.snapshot.sourceIndex,
    matchUrlIds,
    denominator: {
      scenarios: entries.length,
      uniqueMaps: new Set(entries.map(item => item.mapFingerprint)).size,
      uniqueStarts: new Set(entries.map(item => item.startsFingerprint)).size,
      uniqueStarSequences: new Set(entries.map(item => item.starSequenceFingerprint)).size
    },
    entries,
    fingerprint: ""
  };
  snapshot.fingerprint = fingerprintObject(snapshot); return snapshot;
}

function historyDelta(previous, snapshot) {
  const priorIds = new Set(previous?.matchUrlIds || []); const currentIds = new Set(snapshot.matchUrlIds);
  const delta = { schemaVersion: 1, artifactKind: "FAST_REGRESSION_V1_HISTORY_DELTA",
    previousFingerprint: previous?.fingerprint || null, currentFingerprint: snapshot.fingerprint,
    addedMatchUrlIds: snapshot.matchUrlIds.filter(id => !priorIds.has(id)),
    removedMatchUrlIds: previous ? previous.matchUrlIds.filter(id => !currentIds.has(id)) : [],
    fingerprint: "" };
  delta.fingerprint = fingerprintObject(delta); return delta;
}

function buildHistorySnapshot(workspaceRoot) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const rolling = loadRollingV1Scenarios(workspaceRoot);
  const entries = rolling.scenarios.map(scenario => ({
    matchUrlId: scenario.matchUrlId,
    scenarioFingerprint: scenario.fingerprint,
    mapHash: scenario.mapHash,
    mapFingerprint: fingerprintObject({ map: scenario.map }),
    startsFingerprint: fingerprintObject({ starts: scenario.starts }),
    starSequenceFingerprint: fingerprintObject({ stars: scenario.stars }),
    originalSubjectSeat: scenario.originalSubjectSeat,
    originalFrames: scenario.originalFrames
  }));
  const currentFile = path.join(store.paths.history, "current-v1-snapshot.json");
  const previous = fs.existsSync(currentFile) ? JSON.parse(fs.readFileSync(currentFile, "utf8")) : null;
  const snapshot = historySnapshotDocument(rolling, entries); const delta = historyDelta(previous, snapshot);
  writeJsonImmutable(path.join(store.paths.history, "snapshots", `${snapshot.fingerprint}.json`),
    snapshot, { mode: 0o644 });
  writeJsonImmutable(path.join(store.paths.history, "deltas", `${delta.fingerprint}.json`),
    delta, { mode: 0o644 });
  writeJsonAtomic(currentFile, snapshot, { mode: 0o644 });
  return { snapshot, delta, scenarios: rolling.scenarios, file: currentFile };
}

function walkReports(directory, output) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walkReports(file, output);
    else if (entry.isFile() && (entry.name === "paired-arena-report.json" ||
        entry.name === "working-arena-overview.json" ||
        entry.name === "failure-classification-report.json")) output.push(file);
  }
}

function buildLegacyEvidenceIndex(workspaceRoot) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize(); const files = [];
  walkReports(path.join(workspaceRoot, "artifacts"), files); const entries = [];
  for (const file of files.sort()) {
    let report;
    try { report = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    const matches = Array.isArray(report.matches) ? report.matches : [];
    let actionTraces = 0; let replayEvents = 0; let stepTraces = 0; let allFrames = 0;
    for (const match of matches) {
      if (Array.isArray(match.actionTrace)) actionTraces += 1;
      if (Array.isArray(match.replay?.records)) replayEvents += 1;
      if (Array.isArray(match.stepTrace)) stepTraces += 1;
      if (Array.isArray(match.v2?.diagnosticFrames)) allFrames += 1;
    }
    entries.push({ relativePath: path.relative(workspaceRoot, file).replaceAll("\\", "/"),
      sha256: require("../core/hash").sha256Bytes(fs.readFileSync(file)),
      reportKind: report.reportKind || "UNKNOWN", reportFingerprint: report.fingerprint || null,
      matchCount: matches.length,
      capabilities: { actionTraces, replayEvents, scheduledStepTraces: stepTraces,
        allV2Frames: allFrames, replayCapsuleEligible: stepTraces },
      limitation: stepTraces === matches.length && matches.length > 0 ? null :
        "MISSING_SCHEDULED_STEP_PREFIX_CANNOT_RECONSTRUCT_CAPSULE_WITHOUT_ONE_TIME_BACKFILL" });
  }
  const index = { schemaVersion: 1, artifactKind: "FAST_REGRESSION_LEGACY_EVIDENCE_INDEX",
    properties: ["READ_ONLY_IMPORT", "CAPABILITY_EXPLICIT", "NO_FABRICATED_DETAIL"],
    denominator: { reports: entries.length, matches: entries.reduce((sum, item) =>
      sum + item.matchCount, 0), capsuleEligibleMatches: entries.reduce((sum, item) =>
      sum + item.capabilities.replayCapsuleEligible, 0) }, entries, fingerprint: "" };
  index.fingerprint = fingerprintObject(index);
  writeJsonImmutable(path.join(store.paths.history, "legacy-index", `${index.fingerprint}.json`),
    index, { mode: 0o644 });
  writeJsonAtomic(path.join(store.paths.history, "legacy-index-current.json"), index, { mode: 0o644 });
  return index;
}

module.exports = { historySnapshotDocument, historyDelta, buildHistorySnapshot,
  buildLegacyEvidenceIndex };
