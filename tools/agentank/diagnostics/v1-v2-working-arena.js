"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { loadDd9Assignment, idsForRole } = require("../simulation/dd9-assignment");
const { aggregate, VARIANTS, loadSimulator, runMatch, runPairedArena } =
  require("../simulation/paired-arena");
const { loadRollingV1Scenarios } = require("../simulation/historical-scenarios");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");

const ALL_ROLES = Object.freeze(["DISCOVERY", "CALIBRATION", "FROZEN_REGRESSION"]);
const BASELINE_REPORT = "artifacts/diagnostics/v1-v2/imp8-v2-a5ce6f8ef59abb61/" +
  "v1_v2_exact_paired_failure_diagnostic_v1/exact-match-report.json";

function sourceFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(file, output);
    else if (entry.isFile() && entry.name.endsWith(".js")) output.push(file);
  }
  return output;
}
function sourceIdentity(root) {
  const base = contained(root, "engine-v2", "src"); const files = sourceFiles(base).sort();
  const entries = files.map(file => ({ relativePath: path.relative(root, file).replaceAll("\\", "/"),
    sha256: sha256Bytes(fs.readFileSync(file)) }));
  return { fileCount: entries.length, sha256: sha256Text(entries.map(entry =>
    `${entry.relativePath}\0${entry.sha256}`).join("\n")), entries };
}
function outcome(match) {
  return match.result.winnerImplementation === "v2" ? "WIN" :
    match.result.winnerImplementation === "v1" ? "LOSS" : "DRAW";
}
function compareBaseline(root, currentMatches) {
  const file = contained(root, BASELINE_REPORT); const report = JSON.parse(fs.readFileSync(file));
  const baseline = new Map(report.matches.map(match => [match.matchId, match]));
  const counts = { comparableMatches: 0, baselineWins: 0, currentWins: 0,
    baselineNativeWins: 0, currentNativeWins: 0, nativeMatches: 0, transitions: {} };
  const byFamily = {}; const byVariant = {};
  for (const current of currentMatches) {
    const before = baseline.get(current.matchId); if (!before) continue;
    const left = outcome(before); const right = outcome(current); const key = `${left}_TO_${right}`;
    counts.comparableMatches += 1; counts.transitions[key] = (counts.transitions[key] || 0) + 1;
    if (left === "WIN") counts.baselineWins += 1;
    if (right === "WIN") counts.currentWins += 1;
    if (current.family === "NATIVE") {
      counts.nativeMatches += 1;
      if (left === "WIN") counts.baselineNativeWins += 1;
      if (right === "WIN") counts.currentNativeWins += 1;
    }
    for (const [target, group] of [[byFamily, current.family], [byVariant, current.variantId]]) {
      const value = target[group] || (target[group] = { matches: 0, baselineWins: 0,
        currentWins: 0, transitions: {} });
      value.matches += 1; if (left === "WIN") value.baselineWins += 1;
      if (right === "WIN") value.currentWins += 1;
      value.transitions[key] = (value.transitions[key] || 0) + 1;
    }
  }
  counts.winDelta = counts.currentWins - counts.baselineWins;
  counts.nativeWinDelta = counts.currentNativeWins - counts.baselineNativeWins;
  for (const target of [byFamily, byVariant]) for (const value of Object.values(target))
    value.winDelta = value.currentWins - value.baselineWins;
  return { baselineRelativePath: BASELINE_REPORT, baselineFingerprint: report.fingerprint,
    ...counts, byFamily, byVariant };
}

function strictInvariants(matches) {
  const output = { selectedHardRejects: 0, avoidableHardRejects: 0,
    unavoidableAllRejected: 0, rootRestoreFailures: 0, hotAllocations: 0,
    v2Timeouts: 0, v2Errors: 0 };
  for (const match of matches) {
    const layer = match.v2.layerTotals; output.selectedHardRejects += layer.selectedHardRejects;
    output.avoidableHardRejects += layer.avoidableHardRejects;
    output.unavoidableAllRejected += layer.unavoidableAllRejected;
    output.rootRestoreFailures += layer.depthRootRestoreFailures;
    output.hotAllocations += layer.hotAllocations;
    output.v2Timeouts += match.v2.timeoutCount || 0; output.v2Errors += match.v2.errorCount || 0;
  }
  return output;
}

async function runWorkingArena(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const roles = options.roles && options.roles.length ? options.roles.slice() : ALL_ROLES.slice();
  invariant(roles.every(role => ALL_ROLES.includes(role)) && new Set(roles).size === roles.length,
    "V1_V2_WORKING_ROLE_INVALID", roles.join(","));
  const repetitions = Math.max(1, Math.floor(Number(options.repetitions) || 1));
  const timeoutMs = Math.max(20, Math.floor(Number(options.timeoutMs) || 200));
  const limit = options.limit == null ? null : Math.max(1, Math.floor(Number(options.limit)));
  const frozen = loadFrozenCandidate(root, options.manifestPath); const source = sourceIdentity(root);
  const parameters = options.parametersOverride || frozen.manifest.parameters;
  invariant(parameters && parameters.runtimeConfig && parameters.searchBudget &&
    parameters.tacticalConfig, "V1_V2_WORKING_PARAMETERS_INVALID", "missing runtime/search/tactical");
  const parameterFingerprint = fingerprintObject(parameters);
  const parameterProfileId = options.parameterProfileId ||
    frozen.manifest.selection.candidateProfileId;
  const candidateOptions = v2Options(parameters);
  const { assignment } = loadDd9Assignment(root); const requestedScenarioCount = roles.reduce((sum, role) =>
    sum + Math.min(idsForRole(assignment, role).length, limit || Number.MAX_SAFE_INTEGER), 0);
  const rolling = options.includeRolling === false ? null : loadRollingV1Scenarios(root);
  const assignedIds = new Set(assignment.assignments.map(item => item.matchUrlId));
  const rollingScenarios = rolling ? rolling.scenarios.filter(scenario =>
    !assignedIds.has(scenario.matchUrlId)).slice(0, limit || Number.MAX_SAFE_INTEGER) : [];
  const totalScenarioCount = requestedScenarioCount + rollingScenarios.length;
  const token = `${source.sha256.slice(0, 16)}-r${repetitions}-` +
    `${roles.map(role => role.toLowerCase().replace("_regression", "")).join("-")}` +
    (limit == null ? "" : `-l${limit}`) + `-p${parameterFingerprint.slice(0, 12)}` +
    (rolling ? `-rolling-${rolling.snapshot.headId.slice(-8)}` : "");
  const output = path.resolve(options.outputDirectory || contained(root, "artifacts", "diagnostics",
    "v1-v2-working", token)); ensureDirectory(output);
  const reports = []; const matches = []; let completedBeforeRole = 0;
  for (const role of roles) {
    const roleDirectory = path.join(output, role.toLowerCase());
    const roleResult = await runPairedArena({ workspaceRoot: root, role, limit, repetitions, timeoutMs,
      experimentId: `V1_V2_WORKING_${source.sha256.slice(0, 16)}`,
      candidateProfileId: parameterProfileId,
      candidateBinding: { workingSourceSha256: source.sha256,
        parameterFingerprint,
        frozenV1Sha256: frozen.manifest.selection.v1Sha256 },
      v1File: frozen.v1File, v1RelativePath: frozen.manifest.selection.frozenV1RelativePath,
      v2Options: candidateOptions, diagnostics: options.diagnostics,
      outputDirectory: roleDirectory,
      onProgress(done, total, matchUrlId, variantId) {
        if (typeof options.onProgress === "function") options.onProgress(completedBeforeRole + done,
          totalScenarioCount * repetitions * 4, role, done, total, matchUrlId, variantId);
      } });
    reports.push({ role, status: roleResult.report.status, fingerprint: roleResult.report.fingerprint,
      relativePath: path.relative(root, path.join(roleDirectory, "paired-arena-report.json"))
        .replaceAll("\\", "/"), summary: roleResult.report.summary,
      invariants: roleResult.report.invariants });
    matches.push(...roleResult.report.matches); completedBeforeRole += roleResult.report.summary.matchCount;
    invariant(sourceIdentity(root).sha256 === source.sha256,
      "V1_V2_WORKING_SOURCE_CHANGED_DURING_RUN", role);
  }
  if (rollingScenarios.length) {
    const simulator = await loadSimulator(root); const v1Code = fs.readFileSync(frozen.v1File, "utf8");
    const rollingMatches = []; const rollingTotal = rollingScenarios.length * repetitions * 4;
    for (const scenario of rollingScenarios)
      for (let repetition = 0; repetition < repetitions; repetition += 1)
        for (const variant of VARIANTS) {
          rollingMatches.push(await runMatch(simulator.module, scenario, variant, repetition,
            v1Code, timeoutMs, candidateOptions, options.diagnostics));
          if (typeof options.onProgress === "function") options.onProgress(
            completedBeforeRole + rollingMatches.length, totalScenarioCount * repetitions * 4,
            "ROLLING_DISCOVERY", rollingMatches.length, rollingTotal,
            scenario.matchUrlId, variant.variantId);
        }
    const rollingSummary = aggregate(rollingMatches, rollingScenarios.length, repetitions);
    const invariants = strictInvariants(rollingMatches); const rollingReport = { schemaVersion: 1,
      reportKind: "V1_V2_ROLLING_DISCOVERY_ARENA", status: invariants.avoidableHardRejects === 0 &&
        invariants.rootRestoreFailures === 0 && invariants.hotAllocations === 0 &&
        invariants.v2Timeouts === 0 && invariants.v2Errors === 0 ? "PASS" : "FAIL",
      lane: "DISCOVERY", sourceSha256: source.sha256,
      corpus: { snapshotId: rolling.snapshot.snapshotId, headId: rolling.snapshot.headId,
        ledgerWatermark: rolling.snapshot.ledgerWatermark, totalV1Matches: rolling.snapshot.matchUrlIds.length,
        newBeyondLockedAssignment: rollingScenarios.length }, repetitions, summary: rollingSummary,
      invariants, matches: rollingMatches, fingerprint: "" };
    rollingReport.fingerprint = fingerprintObject(rollingReport); const rollingDirectory =
      path.join(output, "rolling_discovery"); ensureDirectory(rollingDirectory);
    writeJsonAtomic(path.join(rollingDirectory, "paired-arena-report.json"), rollingReport, { mode: 0o644 });
    reports.push({ role: "ROLLING_DISCOVERY", status: rollingReport.status,
      fingerprint: rollingReport.fingerprint, relativePath: path.relative(root,
        path.join(rollingDirectory, "paired-arena-report.json")).replaceAll("\\", "/"),
      summary: rollingSummary, invariants });
    matches.push(...rollingMatches); completedBeforeRole += rollingMatches.length;
    invariant(sourceIdentity(root).sha256 === source.sha256,
      "V1_V2_WORKING_SOURCE_CHANGED_DURING_RUN", "ROLLING_DISCOVERY");
  }
  const combined = aggregate(matches, totalScenarioCount, repetitions);
  const overview = { schemaVersion: 1, reportKind: "V1_V2_WORKING_STRUCTURAL_ARENA",
    status: limit == null ? "COMPLETE" : "PARTIAL", evidenceLane: "DISCOVERY",
    source: { fileCount: source.fileCount, sha256: source.sha256 },
    frozenV1: { candidateId: frozen.manifest.candidateId,
      relativePath: frozen.manifest.selection.frozenV1RelativePath,
      sha256: frozen.manifest.selection.v1Sha256 },
    parameters: { profileId: parameterProfileId, fingerprint: parameterFingerprint,
      performanceBinding: options.performanceBinding || null },
    execution: { roles, repetitions, limitPerRole: limit,
      lockedAssignmentScenarioCount: requestedScenarioCount,
      rollingScenarioCount: rollingScenarios.length, scenarioCount: totalScenarioCount,
      rollingSnapshotId: rolling?.snapshot.snapshotId || null,
      matchCount: matches.length, timeoutMs,
      traceMode: options.diagnostics?.captureAllFrames ? "FULL" :
        options.diagnostics?.captureActions ? "ACTIONS" : "NONE" }, reports, combined,
    baselineComparison: compareBaseline(root, matches),
    evidenceBoundary: { officialRuleTruth: false, localRuntimeIsPlatformRuntime: false,
      knownSimulatorDeviations: ["BOMB_PHASE", "POISON_COOLDOWN_DURATION",
        "PLATFORM_RUNTIME_MODEL", "SAME_FRAME_TERMINAL", "STAR_RANDOM_DISTRIBUTION_UNUSED_HERE"],
      bombDeathsExcludedFromPlatformCorrectnessClaims: true }, fingerprint: "" };
  overview.fingerprint = fingerprintObject(overview);
  const file = path.join(output, "working-arena-overview.json");
  writeJsonAtomic(file, overview, { mode: 0o644 });
  writeJsonImmutable(path.join(output, "history", `overview-${overview.fingerprint}.json`), overview,
    { mode: 0o644 });
  return { overview, file, output };
}

module.exports = { ALL_ROLES, BASELINE_REPORT, sourceIdentity, compareBaseline, runWorkingArena };
