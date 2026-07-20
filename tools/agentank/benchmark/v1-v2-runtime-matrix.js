"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { loadDd9Assignment, idsForRole } = require("../simulation/dd9-assignment");
const { scenariosForIds } = require("../simulation/historical-scenarios");
const { VARIANTS, DecisionAudit, loadSimulator, runMatch, runPairedArena } =
  require("../simulation/paired-arena");
const { ProductionDiagnosticBot } = require("../simulation/production-diagnostic-bot");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");
const { sourceIdentity } = require("../diagnostics/v1-v2-working-arena");

const DEFAULT_PLAN = "config/engine-v2/v2-runtime-performance-matrix-v1.json";

function percentile(values, numerator) {
  if (!values.length) return 0; const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1,
    Math.floor((sorted.length - 1) * numerator / 100))];
}
function summarizeTimings(decisions, sequences, creations) {
  return { decisionCount: decisions.length, sequenceCount: sequences.length,
    totalDecisionMicros: decisions.reduce((sum, value) => sum + value, 0),
    p50DecisionMicros: percentile(decisions, 50), p95DecisionMicros: percentile(decisions, 95),
    p99DecisionMicros: percentile(decisions, 99),
    maxDecisionMicros: decisions.length ? Math.max(...decisions) : 0,
    p50SequenceMicros: percentile(sequences, 50), p95SequenceMicros: percentile(sequences, 95),
    maxSequenceMicros: sequences.length ? Math.max(...sequences) : 0,
    totalCreationMicros: creations.reduce((sum, value) => sum + value, 0),
    p95CreationMicros: percentile(creations, 95) };
}
function validateProfile(profile) {
  invariant(profile && typeof profile.profileId === "string" && profile.runtimeConfig &&
    profile.searchBudget, "V2_RUNTIME_PROFILE_INVALID", profile?.profileId || "missing");
  const runtime = profile.runtimeConfig; const budget = profile.searchBudget;
  for (const key of ["DEGRADED_ENTER_WORK_UNITS", "FALLBACK_ENTER_WORK_UNITS",
    "EMERGENCY_ENTER_WORK_UNITS", "DEGRADED_ENTER_FRAME", "FALLBACK_ENTER_FRAME",
    "EMERGENCY_ENTER_FRAME", "PER_CALLBACK_WORK_UNIT_LIMIT",
    "MINIMUM_EMERGENCY_BATCH_RESERVE"])
    invariant(Number.isSafeInteger(runtime[key]) && runtime[key] >= 0,
      "V2_RUNTIME_PROFILE_INTEGER_REQUIRED", `${profile.profileId}:${key}`);
  invariant(runtime.DEGRADED_ENTER_WORK_UNITS < runtime.FALLBACK_ENTER_WORK_UNITS &&
    runtime.FALLBACK_ENTER_WORK_UNITS < runtime.EMERGENCY_ENTER_WORK_UNITS,
  "V2_RUNTIME_PROFILE_WORK_ORDER_INVALID", profile.profileId);
  invariant(runtime.DEGRADED_ENTER_FRAME <= runtime.FALLBACK_ENTER_FRAME &&
    runtime.FALLBACK_ENTER_FRAME <= runtime.EMERGENCY_ENTER_FRAME,
  "V2_RUNTIME_PROFILE_FRAME_ORDER_INVALID", profile.profileId);
  invariant(Array.isArray(runtime.WORK_CHARGES) && runtime.WORK_CHARGES.length === 10 &&
    runtime.WORK_CHARGES.every(Number.isSafeInteger), "V2_RUNTIME_PROFILE_CHARGES_INVALID",
  profile.profileId);
  for (const key of ["DECISION_DEPTH", "NODE_BUDGET", "PROOF_BUDGET",
    "MATRIX_ITERATIONS", "MATRIX_BATCH"])
    invariant(Array.isArray(budget[key]) && budget[key].length === 4 &&
      budget[key].every(Number.isSafeInteger), "V2_RUNTIME_PROFILE_BUDGET_INVALID",
    `${profile.profileId}:${key}`);
  return profile;
}
function readPlan(root, relativePath = DEFAULT_PLAN) {
  const file = contained(root, relativePath); const bytes = fs.readFileSync(file);
  const plan = JSON.parse(bytes); invariant(plan.schemaVersion === 1 &&
    plan.evidenceLane === "CALIBRATION" && Array.isArray(plan.profiles) &&
    plan.profiles.length > 1, "V2_RUNTIME_PLAN_INVALID", relativePath);
  plan.profiles.forEach(validateProfile); return { plan, file,
    sha256: sha256Bytes(bytes), fingerprint: fingerprintObject(plan) };
}
function parametersFor(base, profile) {
  validateProfile(profile); return { cacheConfig: base.cacheConfig,
    runtimeConfig: { ...profile.runtimeConfig,
      WORK_CHARGES: profile.runtimeConfig.WORK_CHARGES.slice() },
    searchBudget: Object.fromEntries(Object.entries(profile.searchBudget)
      .map(([key, value]) => [key, value.slice()])), tacticalConfig: base.tacticalConfig };
}
function collectLayer(target, summary) {
  if (!summary?.layerTotals) return;
  target.avoidableHardRejects += summary.layerTotals.avoidableHardRejects || 0;
  target.rootRestoreFailures += summary.layerTotals.depthRootRestoreFailures || 0;
  target.hotAllocations += summary.layerTotals.hotAllocations || 0;
  for (const [mode, count] of Object.entries(summary.runtimeModeCounts || {}))
    target.runtimeModeCounts[mode] = (target.runtimeModeCounts[mode] || 0) + count;
}
function benchmarkV1(simulator, v1Code, sequences, rounds, timeoutMs) {
  const decisions = []; const sequenceTimes = []; const creations = [];
  let timeoutCount = 0; let errorCount = 0;
  for (let round = 0; round < rounds; round += 1) for (const sequence of sequences) {
    const started = process.hrtime.bigint(); const bot = new DecisionAudit(
      simulator.loadBotFromCode(v1Code, { timeoutMs, loadTimeoutMs: 2000 }));
    creations.push(Number((process.hrtime.bigint() - started) / 1000n));
    for (const context of sequence.contexts) bot.decide(context);
    const selected = bot.runtimeMicros; decisions.push(...selected);
    sequenceTimes.push(selected.reduce((sum, value) => sum + value, 0));
    const summary = bot.summary(); timeoutCount += summary.timeoutCount; errorCount += summary.errorCount;
  }
  return { ...summarizeTimings(decisions, sequenceTimes, creations), timeoutCount, errorCount };
}
function benchmarkV2(options, sequences, rounds) {
  const decisions = []; const sequenceTimes = []; const creations = [];
  const invariants = { avoidableHardRejects: 0, rootRestoreFailures: 0,
    hotAllocations: 0, runtimeModeCounts: {} };
  for (let round = 0; round < rounds; round += 1) for (const sequence of sequences) {
    const started = process.hrtime.bigint(); const bot = new ProductionDiagnosticBot(options);
    creations.push(Number((process.hrtime.bigint() - started) / 1000n));
    for (const context of sequence.contexts) bot.decide(context);
    const selected = bot.runtimeMicros; decisions.push(...selected);
    sequenceTimes.push(selected.reduce((sum, value) => sum + value, 0));
    collectLayer(invariants, bot.summary());
  }
  return { ...summarizeTimings(decisions, sequenceTimes, creations), invariants,
    timeoutCount: 0, errorCount: 0 };
}
function ratio(value, reference) { return reference > 0 ? Math.floor(value * 10000 / reference) : 0xffff; }
function qualifyProfile(profile, reference, baselineNativeWins, selection) {
  const reasons = []; const runtime = profile.matchedInput;
  if (runtime.invariants.avoidableHardRejects || runtime.invariants.rootRestoreFailures ||
      runtime.invariants.hotAllocations || profile.gameplay.invariants.avoidableHardRejects ||
      profile.gameplay.invariants.rootRestoreFailures || profile.gameplay.invariants.hotAllocations)
    reasons.push("STRICT_INVARIANT_FAILED");
  if (selection.requireTotalRuntimeBelowV1 &&
      runtime.totalDecisionMicros >= reference.totalDecisionMicros)
    reasons.push("TOTAL_RUNTIME_NOT_BELOW_V1");
  if (selection.requireP95DecisionBelowV1 &&
      runtime.p95DecisionMicros >= reference.p95DecisionMicros)
    reasons.push("P95_DECISION_NOT_BELOW_V1");
  if (profile.gameplay.summary.native.wins < baselineNativeWins -
      selection.maximumNativeWinRegressionFromBaseline)
    reasons.push("NATIVE_GAMEPLAY_REGRESSION");
  return { qualifies: reasons.length === 0, reasons,
    totalRuntimeRatioPer10000: ratio(runtime.totalDecisionMicros, reference.totalDecisionMicros),
    p95DecisionRatioPer10000: ratio(runtime.p95DecisionMicros, reference.p95DecisionMicros) };
}
function selectProfile(profiles) {
  const eligible = profiles.filter(item => item.qualification.qualifies);
  eligible.sort((left, right) => right.gameplay.summary.native.wins - left.gameplay.summary.native.wins ||
    left.matchedInput.totalDecisionMicros - right.matchedInput.totalDecisionMicros ||
    left.matchedInput.p95DecisionMicros - right.matchedInput.p95DecisionMicros ||
    left.profileId.localeCompare(right.profileId)); return eligible[0] || null;
}

async function runRuntimeMatrix(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const loaded = readPlan(root, options.planPath || DEFAULT_PLAN); const plan = loaded.plan;
  const source = sourceIdentity(root); const frozen = loadFrozenCandidate(root);
  const { assignment, manifest } = loadDd9Assignment(root);
  const ids = idsForRole(assignment, plan.role).slice(0, plan.scenarioLimit);
  const scenarios = scenariosForIds(manifest, ids, root); const simulator = await loadSimulator(root);
  const v1Code = fs.readFileSync(frozen.v1File, "utf8"); const byVariant = new Map(VARIANTS.map(item =>
    [item.variantId, item])); const contextVariants = plan.contextVariantIds.map(id => {
      const value = byVariant.get(id); invariant(value, "V2_RUNTIME_CONTEXT_VARIANT_UNKNOWN", id); return value; });
  const baselineParameters = parametersFor(frozen.manifest.parameters, plan.profiles[0]);
  const sequences = []; let driverMatches = 0;
  for (const scenario of scenarios) for (const variant of contextVariants) {
    const match = await runMatch(simulator.module, scenario, variant, 0, v1Code,
      plan.timeoutMs, v2Options(baselineParameters), { includeContexts: true });
    for (let seat = 0; seat < 2; seat += 1) sequences.push({
      sequenceId: `${match.matchId}:seat${seat}`, scenarioId: scenario.matchUrlId,
      variantId: variant.variantId, seat, skill: variant.skills[seat],
      contexts: seat === 0 ? match.contexts.seat0 : match.contexts.seat1 });
    driverMatches += 1; if (options.onProgress) options.onProgress({ phase: "CONTEXT",
      done: driverMatches, total: scenarios.length * contextVariants.length,
      detail: `${scenario.matchUrlId}:${variant.variantId}` });
  }
  const contextFingerprint = sha256Text(JSON.stringify(sequences));
  const reference = benchmarkV1(simulator.module, v1Code, sequences,
    plan.contextRepetitions, plan.timeoutMs);
  invariant(sha256Text(JSON.stringify(sequences)) === contextFingerprint,
    "V2_RUNTIME_CONTEXT_MUTATED_BY_V1", plan.planId);
  const output = path.resolve(options.outputDirectory || contained(root, "artifacts", "benchmarks",
    "v1-v2-runtime", `${source.sha256.slice(0, 16)}-${loaded.fingerprint.slice(0, 12)}`));
  ensureDirectory(output); const profiles = [];
  for (let index = 0; index < plan.profiles.length; index += 1) {
    const profile = plan.profiles[index]; const parameters = parametersFor(frozen.manifest.parameters, profile);
    const matchedInput = benchmarkV2(v2Options(parameters), sequences, plan.contextRepetitions);
    invariant(sha256Text(JSON.stringify(sequences)) === contextFingerprint,
      "V2_RUNTIME_CONTEXT_MUTATED_BY_V2", profile.profileId);
    const arena = await runPairedArena({ workspaceRoot: root, role: plan.role,
      limit: plan.scenarioLimit, repetitions: plan.arenaRepetitions, timeoutMs: plan.timeoutMs,
      experimentId: plan.planId, candidateProfileId: profile.profileId,
      candidateBinding: { workingSourceSha256: source.sha256,
        parameterFingerprint: fingerprintObject(parameters), frozenV1Sha256:
          frozen.manifest.selection.v1Sha256 }, v1File: frozen.v1File,
      v1RelativePath: frozen.manifest.selection.frozenV1RelativePath,
      v2Options: v2Options(parameters), outputDirectory: path.join(output, "gameplay", profile.profileId),
      onProgress(done, total, matchUrlId, variantId) { if (options.onProgress)
        options.onProgress({ phase: "ARENA", profileId: profile.profileId, done, total,
          detail: `${matchUrlId}:${variantId}` }); } });
    profiles.push({ profileId: profile.profileId, parameters,
      parameterFingerprint: fingerprintObject(parameters), matchedInput,
      gameplay: { reportFingerprint: arena.report.fingerprint,
        reportRelativePath: path.relative(root, path.join(arena.directory,
          "paired-arena-report.json")).replaceAll("\\", "/"),
        summary: arena.report.summary, invariants: arena.report.invariants }, qualification: null });
    if (options.onProgress) options.onProgress({ phase: "PROFILE", done: index + 1,
      total: plan.profiles.length, profileId: profile.profileId });
  }
  const baselineNativeWins = profiles[0].gameplay.summary.native.wins;
  for (const profile of profiles) profile.qualification = qualifyProfile(profile,
    reference, baselineNativeWins, plan.selection);
  const selected = selectProfile(profiles); const report = { schemaVersion: 1,
    reportKind: "V1_V2_MATCHED_INPUT_RUNTIME_MATRIX", status: selected ? "PASS" : "NO_SELECTION",
    evidenceLane: plan.evidenceLane, plan: { planId: plan.planId,
      relativePath: path.relative(root, loaded.file).replaceAll("\\", "/"),
      sha256: loaded.sha256, fingerprint: loaded.fingerprint }, source,
    frozenV1: { relativePath: frozen.manifest.selection.frozenV1RelativePath,
      sha256: frozen.manifest.selection.v1Sha256 }, contextCorpus: {
      role: plan.role, scenarioCount: scenarios.length, driverMatchCount: driverMatches,
      sequenceCount: sequences.length, observationCount: sequences.reduce((sum, item) =>
        sum + item.contexts.length, 0), repetitions: plan.contextRepetitions,
      variantIds: plan.contextVariantIds, fingerprint: contextFingerprint },
    referenceV1: reference, profiles, selection: selected ? { status: "SELECTED",
      profileId: selected.profileId, parameterFingerprint: selected.parameterFingerprint,
      parameters: selected.parameters, qualification: selected.qualification,
      rule: plan.selection.priority } : { status: "NO_SELECTION", profileId: null,
      parameterFingerprint: null, parameters: null, qualification: null,
      rule: plan.selection.priority }, evidenceBoundary: {
      localRuntimeIsPlatformRuntime: false, sameObservedInputSequence: true,
      emittedActionsDoNotMutateReplayInput: true, officialPlatformThreeSecondGateStillRequired: true },
    fingerprint: "" };
  report.fingerprint = fingerprintObject(report); const reportFile = path.join(output,
    "runtime-matrix-report.json"); writeJsonAtomic(reportFile, report, { mode: 0o644 });
  writeJsonImmutable(path.join(output, "history", `runtime-matrix-${report.fingerprint}.json`),
    report, { mode: 0o644 }); invariant(sourceIdentity(root).sha256 === source.sha256,
    "V2_RUNTIME_SOURCE_CHANGED_DURING_MATRIX", source.sha256);
  return { report, reportFile, output };
}

module.exports = { DEFAULT_PLAN, percentile, summarizeTimings, validateProfile, readPlan,
  parametersFor, qualifyProfile, selectProfile, runRuntimeMatrix };
