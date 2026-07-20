"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");

const REQUIREMENTS = "config/engine-v2/v2-local-release-qualification-v1.json";
const TOOL_FILES = Object.freeze([
  "tools/v1-v2-working-arena.sh",
  "tools/v1-v2-runtime-matrix.sh",
  "tools/agentank/cli/v1-v2-working-arena.js",
  "tools/agentank/cli/v1-v2-runtime-matrix.js",
  "tools/agentank/diagnostics/v1-v2-working-arena.js",
  "tools/agentank/benchmark/v1-v2-runtime-matrix.js",
  "tools/agentank/simulation/paired-arena.js",
  "tools/agentank/simulation/production-diagnostic-bot.js"
]);

function workspaceFile(root, value) {
  const file = path.resolve(root, value); invariant(file === root || file.startsWith(`${root}${path.sep}`),
    "V2_LOCAL_QUALIFICATION_PATH_ESCAPE", value); return file;
}
function readFingerprintJson(file, code) {
  const bytes = fs.readFileSync(file); const value = JSON.parse(bytes);
  invariant(value.fingerprint === fingerprintObject(value), code, file); return { value, bytes };
}
function ratio(value, reference) { return reference > 0 ? Math.floor(value * 10000 / reference) : 0xffff; }
function outcome(match) { return match.result.winnerImplementation === "v2" ? "WIN" :
  match.result.winnerImplementation === "v1" ? "LOSS" : "DRAW"; }
function loadArena(root, file) {
  const loaded = readFingerprintJson(file, "V2_LOCAL_ARENA_FINGERPRINT_INVALID");
  const overview = loaded.value; const reports = overview.reports.map(item => {
    const reportFile = contained(root, item.relativePath);
    const report = readFingerprintJson(reportFile, "V2_LOCAL_ROLE_FINGERPRINT_INVALID").value;
    return { meta: item, report, reportFile };
  });
  return { overview, reports, matches: reports.flatMap(item => item.report.matches), file,
    sha256: sha256Bytes(loaded.bytes) };
}
function compareArenas(before, after) {
  const prior = new Map(before.matches.map(match => [match.matchId, match]));
  const transitions = {}; const native = { matches: 0, beforeWins: 0, afterWins: 0,
    transitions: {} }; let comparableMatches = 0;
  for (const match of after.matches) {
    const old = prior.get(match.matchId); if (!old) continue; comparableMatches += 1;
    const key = `${outcome(old)}_TO_${outcome(match)}`;
    transitions[key] = (transitions[key] || 0) + 1;
    if (match.family === "NATIVE") { native.matches += 1;
      if (outcome(old) === "WIN") native.beforeWins += 1;
      if (outcome(match) === "WIN") native.afterWins += 1;
      native.transitions[key] = (native.transitions[key] || 0) + 1; }
  }
  native.winDelta = native.afterWins - native.beforeWins;
  native.deltaPer10000 = native.matches ? Math.floor(native.winDelta * 10000 / native.matches) : 0;
  return { comparableMatches, transitions, native,
    beforeWins: before.overview.combined.v2Wins, afterWins: after.overview.combined.v2Wins,
    winDelta: after.overview.combined.v2Wins - before.overview.combined.v2Wins };
}
function traceCoverage(arena) {
  let frameCount = 0; let actionFrames = 0; let missingMatchTrace = 0;
  let frameIndexMismatch = 0; let callbackActionCount = 0; let holdNoCallbackCount = 0;
  for (const match of arena.matches) {
    frameCount += match.frames;
    if (!Array.isArray(match.actionTrace) || match.actionTrace.length !== match.frames) {
      missingMatchTrace += 1; continue; }
    actionFrames += match.actionTrace.length;
    for (let index = 0; index < match.actionTrace.length; index += 1) {
      const frame = match.actionTrace[index]; if (frame.frame !== index) frameIndexMismatch += 1;
      for (let seat = 0; seat < 2; seat += 1) {
        if (frame.seats?.[seat] && typeof frame.seats[seat].action === "string")
          callbackActionCount += 1;
        else holdNoCallbackCount += 1;
      }
    }
  }
  return { matchCount: arena.matches.length, frameCount, actionFrames, missingMatchTrace,
    frameIndexMismatch, callbackActionCount, holdNoCallbackCount,
    complete: missingMatchTrace === 0 && frameIndexMismatch === 0 && actionFrames === frameCount };
}
function strictPass(combined) { return combined.avoidableHardRejects === 0 &&
  combined.rootRestoreFailures === 0 && combined.hotAllocations === 0 &&
  combined.v2Timeouts === 0 && combined.v2Errors === 0; }
function toolIdentity(root) { return TOOL_FILES.map(relativePath => ({ relativePath,
  sha256: sha256Bytes(fs.readFileSync(contained(root, relativePath))) })); }

function runV2LocalQualification(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const requirementFile = contained(root, REQUIREMENTS);
  const requirementBytes = fs.readFileSync(requirementFile); const requirements = JSON.parse(requirementBytes);
  const contractFile = contained(root, requirements.contractRelativePath);
  const before = loadArena(root, workspaceFile(root, options.preTuningArena));
  const performanceFile = workspaceFile(root, options.performanceReport);
  const performanceLoaded = readFingerprintJson(performanceFile,
    "V2_LOCAL_PERFORMANCE_FINGERPRINT_INVALID"); const performance = performanceLoaded.value;
  const after = loadArena(root, workspaceFile(root, options.postTuningArena));
  invariant(performance.status === "PASS" && performance.selection.status === "SELECTED",
    "V2_LOCAL_PERFORMANCE_NOT_SELECTED", performance.status);
  invariant(performance.source.sha256 === after.overview.source.sha256 &&
    performance.selection.parameterFingerprint === after.overview.parameters.fingerprint &&
    after.overview.parameters.performanceBinding?.reportFingerprint === performance.fingerprint,
  "V2_LOCAL_PERFORMANCE_ARENA_BINDING_MISMATCH", performance.selection.profileId);
  const trace = traceCoverage(after); const comparison = compareArenas(before, after);
  const reference = performance.referenceV1; const selected = performance.profiles.find(item =>
    item.profileId === performance.selection.profileId); invariant(selected,
    "V2_LOCAL_SELECTED_PROFILE_MISSING", performance.selection.profileId);
  const performanceGate = { sameInputTotalRatioPer10000: ratio(
    selected.matchedInput.totalDecisionMicros, reference.totalDecisionMicros),
    sameInputP95RatioPer10000: ratio(selected.matchedInput.p95DecisionMicros,
      reference.p95DecisionMicros), interactiveTotalRatioPer10000: ratio(
      after.overview.combined.v2Runtime.total, after.overview.combined.v1Runtime.total),
    interactiveP95RatioPer10000: ratio(after.overview.combined.v2Runtime.p95PerMatch,
      after.overview.combined.v1Runtime.p95PerMatch), selectedProfileQualified:
      selected.qualification.qualifies };
  performanceGate.pass = performanceGate.selectedProfileQualified &&
    performanceGate.sameInputTotalRatioPer10000 < 10000 &&
    performanceGate.sameInputP95RatioPer10000 < 10000;
  const structuralGate = { strictPass: strictPass(after.overview.combined),
    tracePass: trace.complete, repetitionsPass: after.overview.execution.repetitions >=
      requirements.requirements.minimumRepetitions,
    rollingPass: !requirements.requirements.requireDynamicRollingCorpus ||
      after.overview.execution.rollingScenarioCount > 0 };
  structuralGate.pass = Object.values(structuralGate).every(value => value === true);
  const gameplayReview = { required: comparison.native.winDelta < 0 ||
    (comparison.transitions.WIN_TO_LOSS || 0) > 0,
    disposition: comparison.native.winDelta < 0 ? "USER_REVIEW_REQUIRED_NATIVE_REGRESSION" :
      (comparison.transitions.WIN_TO_LOSS || 0) > 0 ? "USER_REVIEW_REQUIRED_TRANSITION_REGRESSION" :
        "NO_REGRESSION_REVIEW_REQUIRED", reviewed: false };
  const status = structuralGate.pass && performanceGate.pass ?
    gameplayReview.required ? "PASS_PENDING_GAMEPLAY_REVIEW" : "PASS" : "FAIL";
  const report = { schemaVersion: 1, reportKind: "V2_LOCAL_RELEASE_QUALIFICATION",
    status, candidateBindingStatus: "PENDING_FROZEN_CANDIDATE",
    requirements: { relativePath: REQUIREMENTS, sha256: sha256Bytes(requirementBytes),
      fingerprint: fingerprintObject(requirements) },
    contract: { relativePath: requirements.contractRelativePath,
      sha256: sha256Bytes(fs.readFileSync(contractFile)) },
    source: after.overview.source, parameters: after.overview.parameters,
    inputs: { preTuningArena: { relativePath: path.relative(root, before.file).replaceAll("\\", "/"),
      sha256: before.sha256, fingerprint: before.overview.fingerprint },
      performanceReport: { relativePath: path.relative(root, performanceFile).replaceAll("\\", "/"),
        sha256: sha256Bytes(performanceLoaded.bytes), fingerprint: performance.fingerprint },
      postTuningArena: { relativePath: path.relative(root, after.file).replaceAll("\\", "/"),
        sha256: after.sha256, fingerprint: after.overview.fingerprint } },
    structuralGate, performanceGate, traceCoverage: trace, gameplayComparison: comparison,
    gameplayReview, toolIdentity: toolIdentity(root), evidenceBoundary: {
      officialPlatformRuntimeVerified: false, localRuntimeIsPlatformRuntime: false,
      simulatorRuleTruth: false, bombDeathsExcludedFromPlatformCorrectness: true,
      frozenCandidateAttestationRequiredBeforeOfficialSimulation: true }, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); const token =
    `${report.source.sha256.slice(0, 16)}-p${after.overview.parameters.fingerprint.slice(0, 12)}`;
  const output = path.resolve(options.outputDirectory || contained(root, "artifacts", "qualification",
    "v2-local", token)); ensureDirectory(output); const reportFile = path.join(output,
    "local-qualification-report.json"); writeJsonAtomic(reportFile, report, { mode: 0o644 });
  writeJsonImmutable(path.join(output, "history", `local-qualification-${report.fingerprint}.json`),
    report, { mode: 0o644 }); return { report, reportFile, output };
}

module.exports = { REQUIREMENTS, TOOL_FILES, compareArenas, traceCoverage,
  runV2LocalQualification };
