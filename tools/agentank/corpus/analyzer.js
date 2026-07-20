"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { contained, defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes, sha256Text } = require("../core/hash");
const { ensureDirectory, writeFileAtomic, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { validateSchemaObject } = require("../core/schema-validator");
const { corpusPolicy, appendEntries, semanticValidateEntries, makeHead, makeSnapshot,
  assignClosedCohorts, encodeLedger, decodeLedger } = require("./ledger");
const { importAggregate, recordsOf, replay } = require("./legacy-importer");
const { DualTrackReplay } = require("./dual-track");
const { extractWindows, positiveProtection } = require("./windows");
const { BidirectionalCounterfactualRunner } = require("./counterfactual");

function finalized(value) { value.fingerprint = fingerprintObject(value); return value; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function legacyIntegrity(root) {
  const manifest = readJson(contained(root, "docs", "design", "dd9-legacy-corpus-manifest.json"));
  const aggregate = contained(root, manifest.corpus.aggregateDirectory); const findings = [];
  for (const [name, expected] of Object.entries(manifest.integrity.aggregateArtifacts)) {
    const file = path.join(aggregate, name); const actual = fs.existsSync(file) ? sha256Bytes(fs.readFileSync(file)) : null;
    if (actual !== expected) findings.push({ name, expected, actual });
  }
  const aggregateManifest = readJson(path.join(aggregate, "manifest.json")); const leaves = [];
  for (const match of aggregateManifest.matches.slice().sort((a, b) => a.urlId.localeCompare(b.urlId))) {
    const directory = path.resolve(aggregate, match.directory);
    for (const name of ["raw.json", "events.json", "summary.json"]) { const bytes = fs.readFileSync(path.join(directory, name));
      leaves.push(`${match.urlId}/${name}\0${bytes.length}\0${sha256Bytes(bytes)}\n`); }
  }
  const rootHash = sha256Text(leaves.join("")); if (rootHash !== manifest.integrity.artifactSet.root)
    findings.push({ name: "artifactSet.root", expected: manifest.integrity.artifactSet.root, actual: rootHash });
  return finalized({ schemaVersion: 1, status: findings.length ? "FAIL" : "PASS",
    legacyCorpusVersion: manifest.legacyCorpusVersion, uniqueMatches: manifest.corpus.uniqueMatches,
    artifactCount: leaves.length, artifactRoot: rootHash,
    corpusFingerprint: manifest.corpus.historicalRegressionFingerprint,
    splitFingerprint: manifest.split.assignmentFingerprint, findings });
}

function buildAnalysis(root, entries, snapshot, cohorts = []) {
  const levelCounts = { L0: entries.length, L1: entries.length, L2: 0, L3: 0, L4: 0 };
  const classCounts = {}; const profileCounts = {}; const allWindows = []; const results = [];
  let frameCount = 0; let trackBytes = 0; let unknownTrackCount = 0; let infrastructureFailures = 0;
  const runner = new BidirectionalCounterfactualRunner(); const cohortByMatch = new Map();
  for (const cohort of cohorts) for (const id of cohort.matchUrlIds) cohortByMatch.set(id, cohort.cohortId);
  for (const entry of entries) {
    profileCounts[entry.subjectTankProfileId] = (profileCounts[entry.subjectTankProfileId] || 0) + 1;
    classCounts[entry.terminal.terminalClass] = (classCounts[entry.terminal.terminalClass] || 0) + 1;
    if (["SCRIPT_ERROR", "RUNTIME_TIMEOUT", "TERMINAL_INCOMPLETE"].includes(entry.terminal.terminalClass)) infrastructureFailures += 1;
    const raw = readJson(contained(root, entry.artifacts.raw.relativePath)); const records = recordsOf(raw);
    const replayValue = replay(raw); const tankIds = (replayValue.meta?.players || []).map(player => player.tank?.id);
    const tracks = new DualTrackReplay(records.length).ingest(records, tankIds, null); trackBytes += tracks.bytes();
    frameCount += records.length; levelCounts.L2 += 1; if (!tracks.publicInputCaptured) unknownTrackCount += 1;
    const extraction = extractWindows(entry, records); levelCounts.L3 += extraction.windows.length;
    for (let index = 0; index < extraction.windows.length; index += 1) {
      const window = extraction.windows[index]; const frame = Math.min(Math.max(0, window.startFrame), Math.max(0, records.length - 1));
      const id = `${entry.matchUrlId}:${window.windowType}:${index}`; const checkpoint = {
        checkpointId: id, frame, baselineObservations: records.length ? [tracks.observation(0, frame), tracks.observation(1, frame)] :
          [{ signatureLo: 0, signatureHi: 0, unknownMask: 1 }, { signatureLo: 0, signatureHi: 0, unknownMask: 1 }],
        supportComplete: false, observationComplete: false, ruleComplete: false, assumptionMask: 1 };
      const bidirectional = runner.runBoth(checkpoint); levelCounts.L4 += 2; results.push(...bidirectional);
      allWindows.push({ matchUrlId: entry.matchUrlId, subjectTankProfileId: entry.subjectTankProfileId,
        snapshotId: snapshot.snapshotId, cohortId: cohortByMatch.get(entry.matchUrlId) || entry.cohortId,
        ...window, metrics: extraction.metrics,
        counterfactualResultIds: bidirectional.map(item => item.fingerprint) });
    }
  }
  const protection = positiveProtection(allWindows, allWindows);
  const report = { schemaVersion: 1, reportKind: "IMP7_CORPUS_ANALYSIS", status: protection.status,
    snapshotRef: { snapshotId: snapshot.snapshotId, matchSetRoot: snapshot.matchSetRoot,
      ledgerWatermark: snapshot.ledgerWatermark }, denominator: { matchCount: entries.length, profileCounts,
      frameCount, windowCount: allWindows.length, counterfactualPerspectiveCount: results.length },
    levelCounts, terminalClassCounts: classCounts, infrastructureFailures,
    truthObserved: { trackBytes, policyTruthHandleCount: 0, publicInputCaptureCount: 0,
      observationUnknownCount: unknownTrackCount, postDivergenceSuffixFrames: 0 },
    strictCounterfactualLabels: { ROBUST_AVOIDABLE: 0, STRICT_UNAVOIDABLE: 0,
      UNKNOWN: results.length }, positiveProtection: protection, windows: allWindows,
    counterfactualResults: results, fingerprint: "" };
  return finalized(report);
}

function rebuildCorpus(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const imported = importAggregate(root);
  const directory = contained(root, "battle-records", "corpus", "imp7"); const history = path.join(directory, "history");
  ensureDirectory(history); const ledgerFile = path.join(directory, "match-ledger-epoch-imp7-v2.jsonl");
  const existing = fs.existsSync(ledgerFile) ? decodeLedger(fs.readFileSync(ledgerFile, "utf8")) : [];
  const appended = appendEntries(existing, imported.entries); const entries = appended.entries;
  const policy = corpusPolicy(imported.source.manifest.generatedAt); semanticValidateEntries(entries, root);
  validateSchemaObject("corpus", policy, root);
  const previousHeadFile = path.join(directory, "corpus-head.json"); const previousHead = fs.existsSync(previousHeadFile) ? readJson(previousHeadFile) : null;
  const provisional = makeHead(entries, policy, imported.source.manifest.generatedAt, null);
  const sameHead = previousHead && previousHead.artifactRoot === provisional.artifactRoot &&
    previousHead.policyFingerprint === provisional.policyFingerprint;
  const head = sameHead ? previousHead : makeHead(entries, policy, imported.source.manifest.generatedAt,
    previousHead ? sha256Bytes(fs.readFileSync(previousHeadFile)) : null);
  const v1Snapshot = makeSnapshot(entries, head, policy, "v1"); const v2Snapshot = makeSnapshot(entries, head, policy, "v2");
  const cohortFile = path.join(directory, "cohorts.json");
  const closedCohorts = fs.existsSync(cohortFile) ? readJson(cohortFile) : [];
  const cohorts = assignClosedCohorts(entries.filter(x => x.cohortId !== "legacy-dd9"), policy,
    Date.parse(imported.source.manifest.generatedAt), closedCohorts);
  for (const value of [head, v1Snapshot, v2Snapshot, ...cohorts]) validateSchemaObject("corpus", value, root);
  const ledgerBytes = encodeLedger(entries); writeFileAtomic(ledgerFile, ledgerBytes, { mode: 0o644 });
  writeJsonAtomic(path.join(directory, "corpus-policy.json"), policy, { mode: 0o644 });
  writeJsonAtomic(previousHeadFile, head, { mode: 0o644 });
  writeJsonImmutable(path.join(history, `head-${head.fingerprint}.json`), head, { mode: 0o644 });
  for (const snapshot of [v1Snapshot, v2Snapshot]) { writeJsonAtomic(path.join(directory,
    `snapshot-${snapshot.subjectTankProfileIds[0]}.json`), snapshot, { mode: 0o644 });
    writeJsonImmutable(path.join(history, `snapshot-${snapshot.fingerprint}.json`), snapshot, { mode: 0o644 }); }
  writeJsonAtomic(cohortFile, cohorts, { mode: 0o644 });
  const analysis = buildAnalysis(root, entries.filter(x => x.subjectTankProfileId === "v1"), v1Snapshot, cohorts);
  validateSchemaObject("imp7-analysis-report", analysis, root);
  writeJsonAtomic(path.join(directory, "analysis-report.json"), analysis, { mode: 0o644 });
  writeJsonImmutable(path.join(history, `analysis-${analysis.fingerprint}.json`), analysis, { mode: 0o644 });
  const legacy = legacyIntegrity(root);
  return { source: { batchId: imported.source.name, artifactCount: imported.source.count,
      generatedAt: imported.source.manifest.generatedAt }, entries, appended: appended.appended,
    duplicates: appended.duplicates, policy, head, snapshots: { v1: v1Snapshot, v2: v2Snapshot },
    cohorts, analysis, legacy, files: { ledgerFile, directory } };
}

module.exports = { legacyIntegrity, buildAnalysis, rebuildCorpus };
