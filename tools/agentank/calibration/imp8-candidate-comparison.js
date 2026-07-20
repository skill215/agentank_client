"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { runPairedArena } = require("../simulation/paired-arena");

function readPlan(root, selectedPath = "config/engine-v2/imp8-candidate-comparison-v5.json") {
  const relativePath = selectedPath;
  const bytes = fs.readFileSync(contained(root, relativePath)); const plan = JSON.parse(bytes);
  invariant(plan.schemaVersion === 1 && plan.lane === "CALIBRATION" &&
    typeof plan.v1Baseline === "string" && plan.v1Baseline.length > 0 &&
    Array.isArray(plan.candidates) && plan.candidates.length > 1,
  "IMP8_CANDIDATE_PLAN_INVALID", relativePath);
  return { plan, relativePath, sha256: sha256Bytes(bytes) };
}

function defaultOutputDirectory(root, relativePlanPath) {
  const match = path.basename(relativePlanPath).match(/candidate-comparison-(v\d+)\.json$/i);
  const suffix = match ? match[1].toLowerCase() : "custom";
  return contained(root, "artifacts", "imp8", "calibration", `candidate-comparison-${suffix}`);
}

function candidateOptions(plan, candidate) {
  const selectedSearch = candidate.searchBudget || plan.searchBudget;
  const selectedRuntime = candidate.runtime || plan.runtimeTemplate;
  return { engine: { runtime: { runtimeConfig: Object.freeze({
    ...selectedRuntime, WORK_CHARGES: Object.freeze(candidate.workCharges.slice()) }),
    searchBudget: Object.freeze({
      DECISION_DEPTH: Object.freeze(selectedSearch.DECISION_DEPTH.slice()),
      NODE_BUDGET: Object.freeze(selectedSearch.NODE_BUDGET.slice()),
      PROOF_BUDGET: Object.freeze(selectedSearch.PROOF_BUDGET.slice()),
      MATRIX_ITERATIONS: Object.freeze(selectedSearch.MATRIX_ITERATIONS.slice()),
      MATRIX_BATCH: Object.freeze(selectedSearch.MATRIX_BATCH.slice())
    }) }, tactical: Object.freeze({ ...candidate.tactical }) } };
}

function metric(report, baselineWinRate, policy) {
  const s = report.summary; const nativeMatches = s.native.matches;
  const nativeWinRate = nativeMatches ? Math.floor(s.native.wins * 10000 / nativeMatches) : 0;
  const allWinRate = s.matchCount ? Math.floor(s.v2Wins * 10000 / s.matchCount) : 0;
  const hardPass = report.invariants.nativeCriticalErrors === 0 &&
    report.invariants.nativeAvoidableHardRejects === 0 && report.invariants.rootRestoreFailures === 0 &&
    report.invariants.hotAllocations === 0;
  const qualified = hardPass && s.v2ReducedModeRatePer10000 <= policy.maximumFallbackRatePer10000 &&
    nativeWinRate >= policy.minimumNativeWinRatePer10000 &&
    nativeWinRate - baselineWinRate >= policy.minimumNativeWinRateGainOverBaselinePer10000;
  return { candidateProfileId: report.candidateProfileId, reportFingerprint: report.fingerprint,
    hardPass, qualified, nativeWinRatePer10000: nativeWinRate,
    nativeWinRateGainOverBaselinePer10000: nativeWinRate - baselineWinRate,
    nativeCrashLosses: s.native.crashLosses, allWinRatePer10000: allWinRate,
    reducedModeRatePer10000: s.v2ReducedModeRatePer10000,
    emergencyActionRatePer10000: s.v2EmergencyActionRatePer10000,
    p95RuntimeMicrosPerMatch: s.v2Runtime.p95PerMatch, v2Decisions: s.v2Decisions,
    v2ReducedModeDecisions: s.v2ReducedModeDecisions,
    v2EmergencyActions: s.v2EmergencyActions, v2ActionCounts: s.v2ActionCounts };
}

function rank(left, right) {
  if (left.qualified !== right.qualified) return left.qualified ? -1 : 1;
  if (left.nativeWinRatePer10000 !== right.nativeWinRatePer10000)
    return right.nativeWinRatePer10000 - left.nativeWinRatePer10000;
  if (left.nativeCrashLosses !== right.nativeCrashLosses)
    return left.nativeCrashLosses - right.nativeCrashLosses;
  if (left.allWinRatePer10000 !== right.allWinRatePer10000)
    return right.allWinRatePer10000 - left.allWinRatePer10000;
  if (left.p95RuntimeMicrosPerMatch !== right.p95RuntimeMicrosPerMatch)
    return left.p95RuntimeMicrosPerMatch - right.p95RuntimeMicrosPerMatch;
  return left.candidateProfileId.localeCompare(right.candidateProfileId);
}

async function runCandidateComparison(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const loaded = readPlan(root, options.planPath); const { plan } = loaded;
  const output = path.resolve(options.outputDirectory || defaultOutputDirectory(root,
    loaded.relativePath)); ensureDirectory(output);
  // A comparison is one experiment. Read the mutable v1 development source
  // exactly once so every candidate faces byte-identical opponent code even if
  // that source is edited while the batch is running.
  const v1File = contained(root, plan.v1Baseline);
  const v1Code = fs.readFileSync(v1File, "utf8"); const v1Sha256 = sha256Bytes(v1Code);
  const reports = [];
  for (const candidate of plan.candidates) {
    const candidateDirectory = path.join(output, candidate.candidateProfileId.toLowerCase());
    const result = await runPairedArena({ workspaceRoot: root, role: plan.role,
      repetitions: options.repetitions || plan.repetitions, timeoutMs: plan.timeoutMs,
      limit: options.limit, experimentId: plan.experimentId,
      v1File: plan.v1Baseline, v1Code, v1RelativePath: plan.v1Baseline,
      candidateProfileId: candidate.candidateProfileId,
      outputDirectory: candidateDirectory, v2Options: candidateOptions(plan, candidate),
      onProgress: options.onProgress ? (done, total, scenario, variant) =>
        options.onProgress(candidate.candidateProfileId, done, total, scenario, variant) : null });
    reports.push(result.report);
  }
  invariant(reports.every(item => item.v1Baseline.sha256 === v1Sha256),
    "IMP8_COMPARISON_V1_SNAPSHOT_DRIFT", v1Sha256);
  const baselineReport = reports.find(item => item.candidateProfileId ===
    (plan.baselineCandidateProfileId || "BASELINE_WORK_V1"));
  invariant(baselineReport, "IMP8_COMPARISON_BASELINE_MISSING", plan.experimentId);
  const baselineWinRate = baselineReport.summary.native.matches ? Math.floor(
    baselineReport.summary.native.wins * 10000 / baselineReport.summary.native.matches) : 0;
  const metrics = reports.map(report => metric(report, baselineWinRate, plan.selectionPolicy)).sort(rank);
  const selected = metrics.find(item => item.qualified) || null;
  const v1SourceSha256AtCompletion = sha256Bytes(fs.readFileSync(v1File));
  const report = { schemaVersion: 1, reportKind: "IMP8_CANDIDATE_COMPARISON",
    experimentId: plan.experimentId, status: selected ? "SELECTED" : "NO_SELECTION",
    lane: "CALIBRATION", role: plan.role, plan: { relativePath: loaded.relativePath,
      sha256: loaded.sha256 }, executedRepetitions: options.repetitions || plan.repetitions,
    executedLimit: options.limit == null ? null : Number(options.limit),
    v1BaselineSnapshot: { relativePath: plan.v1Baseline, sha256: v1Sha256,
      sourceSha256AtCompletion: v1SourceSha256AtCompletion,
      sourceChangedDuringRun: v1SourceSha256AtCompletion !== v1Sha256 },
    selectionPolicy: plan.selectionPolicy, baselineNativeWinRatePer10000: baselineWinRate,
    selectedCandidateProfileId: selected?.candidateProfileId || null, metrics,
    candidateReportFingerprints: Object.fromEntries(reports.map(item =>
      [item.candidateProfileId, item.fingerprint])), fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  writeJsonAtomic(path.join(output, "candidate-comparison-report.json"), report);
  writeJsonImmutable(path.join(output, "history", `candidate-comparison-${report.fingerprint}.json`), report);
  return { report, reports, directory: output };
}

module.exports = { readPlan, defaultOutputDirectory, candidateOptions, metric, rank,
  runCandidateComparison };
