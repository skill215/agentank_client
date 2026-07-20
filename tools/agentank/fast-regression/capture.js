"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");
const { sourceIdentity } = require("../diagnostics/v1-v2-working-arena");
const { loadSimulator, runMatch, VARIANTS, SIMULATOR_COMMIT,
  SIMULATOR_ARCHIVE_SHA256, aggregate } = require("../simulation/paired-arena");
const { FastRegressionStore, canonicalLine } = require("./artifact-store");
const { ensureDirectory, writeJsonAtomic } = require("../core/atomic-file");
const { buildHistorySnapshot } = require("./history");
const { selectWindows, buildCapsuleDraft, reducedDecisionTrace } = require("./capsule");

const CAPTURE_HARNESS_FILES = Object.freeze([
  "tools/agentank/fast-regression/artifact-store.js",
  "tools/agentank/fast-regression/capsule.js",
  "tools/agentank/fast-regression/capture.js",
  "tools/agentank/simulation/paired-arena.js"
]);

function captureHarnessIdentity(root) {
  const files = CAPTURE_HARNESS_FILES.map(relativePath => ({ relativePath,
    sha256: sha256Bytes(fs.readFileSync(path.join(root, relativePath))) }));
  return { files, fingerprint: fingerprintObject({ files }) };
}

function seedFor(scenario, repetition) {
  return Number.parseInt(sha256Text(`${scenario.fingerprint}\0${repetition}`).slice(0, 8), 16) >>> 0;
}

function matchSummary(match) {
  const v2 = { ...match.v2 }; delete v2.actionFrames; delete v2.diagnosticFrames;
  return { matchId: match.matchId, historicalMatchUrlId: match.historicalMatchUrlId,
    scenarioFingerprint: match.scenarioFingerprint, variantId: match.variantId,
    family: match.family, repetition: match.repetition,
    seatImplementations: match.seatImplementations, seatSkills: match.seatSkills,
    v2Seat: match.v2Seat, frames: match.frames, result: match.result, counts: match.counts,
    starSequence: match.starSequence, v1: match.v1, v2 };
}

function materializeCapsuleSpool(workspaceRoot, spoolPath, runId, options = {}) {
  const root = path.resolve(workspaceRoot || defaultWorkspaceRoot());
  const store = new FastRegressionStore(root); store.initialize();
  const spool = path.resolve(spoolPath);
  invariant(spool.startsWith(`${store.paths.work}${path.sep}`) && fs.statSync(spool).isDirectory(),
    "FAST_REGRESSION_SPOOL_INVALID", spool);
  const manifestFile = path.join(store.paths.runs, runId, "manifest.json");
  invariant(fs.existsSync(manifestFile), "FAST_REGRESSION_RUN_NOT_FOUND", runId);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  invariant(manifest.runId === runId && manifest.completion === "COMPLETE",
    "FAST_REGRESSION_RUN_NOT_COMPLETE", runId);
  const names = fs.readdirSync(spool).filter(name => name.endsWith(".json")).sort();
  invariant(names.length === manifest.summary.capsuleCount, "FAST_REGRESSION_SPOOL_COUNT_MISMATCH",
    `${names.length}/${manifest.summary.capsuleCount}`);
  const capsules = [];
  for (let index = 0; index < names.length; index += 1) {
    const draft = JSON.parse(fs.readFileSync(path.join(spool, names[index]), "utf8"));
    capsules.push(store.writeCapsule({ ...draft,
      source: { ...draft.source, runId } }));
    if (typeof options.onProgress === "function") options.onProgress(index + 1, names.length);
  }
  fs.rmSync(spool, { recursive: true, force: true });
  return { runId, capsules, count: capsules.length };
}

async function captureBattleEvidence(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const history = buildHistorySnapshot(root); const added = new Set(history.delta.addedMatchUrlIds);
  const availableScenarios = options.deltaOnly ? history.scenarios.filter(scenario =>
    added.has(scenario.matchUrlId)) : history.scenarios;
  const limit = options.limit == null ? availableScenarios.length :
    Math.max(1, Math.floor(Number(options.limit)));
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
  const scenarios = availableScenarios.slice(offset, offset + limit);
  const repetitions = Math.max(1, Math.floor(Number(options.repetitions) || 1));
  const timeoutMs = Math.max(20, Math.floor(Number(options.timeoutMs) || 200));
  const frozen = loadFrozenCandidate(root, options.manifestPath); const source = sourceIdentity(root);
  const parameters = options.parameters || frozen.manifest.parameters;
  const parameterFingerprint = fingerprintObject(parameters); const settings = v2Options(parameters);
  const v1Code = fs.readFileSync(frozen.v1File, "utf8"); const v1Sha256 = sha256Bytes(v1Code);
  const simulator = await loadSimulator(root); const store = new FastRegressionStore(root);
  const descriptor = {
    purpose: options.purpose || "V1_V2_REUSABLE_REGRESSION_CAPTURE",
    historySnapshotFingerprint: history.snapshot.fingerprint,
    historyDeltaFingerprint: history.delta.fingerprint,
    deltaOnly: Boolean(options.deltaOnly),
    scenarioOffset: offset,
    scenarioCount: scenarios.length,
    repetitions,
    variants: VARIANTS.map(item => item.variantId),
    v1: { relativePath: path.relative(root, frozen.v1File).replaceAll("\\", "/"), sha256: v1Sha256 },
    v2: { sourceSha256: source.sha256, parameterFingerprint },
    simulator: { commit: SIMULATOR_COMMIT, archiveSha256: SIMULATOR_ARCHIVE_SHA256 },
    captureHarness: captureHarnessIdentity(root),
    timeoutMs,
    diagnostics: { actionTrace: true, scheduledStepTrace: true, replayEvents: true,
      allRootCandidates: true, observationFingerprints: true }
  };
  const writer = store.startRun(descriptor); const matches = [];
  const spool = path.join(store.paths.work, `capsule-spool-${writer.sessionId}`);
  ensureDirectory(spool); let capsuleCount = 0;
  const total = scenarios.length * repetitions * VARIANTS.length; let completed = 0;
  try {
    for (const scenario of scenarios) for (let repetition = 0; repetition < repetitions; repetition += 1)
      for (const variant of VARIANTS) {
        const match = await runMatch(simulator.module, scenario, variant, repetition, v1Code,
          timeoutMs, settings, { captureActions: true, captureAllFrames: true,
            captureStepTrace: true, includeReplay: true, includeContexts: true });
        const summaryRecord = matchSummary(match); matches.push(summaryRecord);
        const stepRecord = { matchId: match.matchId, frames: match.stepTrace };
        const decisionRecord = { matchId: match.matchId, frames: reducedDecisionTrace(match) };
        const replayRecord = { matchId: match.matchId, records: match.replay.records };
        const binding = { simulatorCommit: SIMULATOR_COMMIT,
          simulatorArchiveSha256: SIMULATOR_ARCHIVE_SHA256, seed: seedFor(scenario, repetition),
          v1Sha256, v2Sha256: source.sha256, parameterFingerprint };
        const drafts = [];
        for (const window of selectWindows(match, options)) {
          const draft = buildCapsuleDraft(match, scenario, window, binding);
          drafts.push(draft);
        }
        // Validate a whole match before appending any stream. A malformed diagnostic record can
        // therefore produce a clean PARTIAL boundary, never mismatched stream denominators.
        for (const record of [summaryRecord, stepRecord, decisionRecord, replayRecord, ...drafts])
          canonicalLine(record);
        writer.append("matches", summaryRecord);
        writer.append("step-traces", stepRecord);
        writer.append("decision-traces", decisionRecord);
        writer.append("replay-events", replayRecord);
        for (const draft of drafts) {
          writeJsonAtomic(path.join(spool, `${String(capsuleCount).padStart(8, "0")}.json`),
            draft, { mode: 0o600 }); capsuleCount += 1;
          writer.append("selected-windows", { matchId: match.matchId,
            windowFingerprint: draft.windowFingerprint, window: draft.window });
        }
        completed += 1;
        if (typeof options.onProgress === "function")
          options.onProgress(completed, total, match.matchId, capsuleCount);
      }
    const summary = aggregate(matches, scenarios.length, repetitions);
    const finalized = writer.finalize({ matchCount: matches.length,
      capsuleCount, arena: summary }, "COMPLETE");
    const materialized = materializeCapsuleSpool(root, spool, finalized.manifest.runId,
      { onProgress: options.onMaterializeProgress });
    const capsules = materialized.capsules;
    return { run: finalized, capsules, summary, history: history.snapshot };
  } catch (error) {
    if (!writer.closed) {
      writer.abort(`${error.code || "FAST_REGRESSION_CAPTURE_ERROR"}: ${error.message}`);
      fs.rmSync(spool, { recursive: true, force: true });
    }
    throw error;
  }
}

module.exports = { CAPTURE_HARNESS_FILES, captureHarnessIdentity, seedFor, matchSummary,
  materializeCapsuleSpool, captureBattleEvidence };
