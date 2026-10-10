"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { writeJsonAtomic, writeJsonImmutable, ensureDirectory } = require("../core/atomic-file");
const { loadDd9Assignment } = require("../simulation/dd9-assignment");
const { scenariosForIds, loadRollingV1Scenarios } = require("../simulation/historical-scenarios");
const { VARIANTS, loadSimulator, runMatch, aggregate } = require("../simulation/paired-arena");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");
const { sourceIdentity } = require("../diagnostics/v1-v2-working-arena");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");

function fixedIds(root, baseline) {
  if (baseline.fixedCohort.scenarioIdentityManifestRelativePath) {
    const manifestRelativePath = baseline.fixedCohort.scenarioIdentityManifestRelativePath;
    const manifest = JSON.parse(fs.readFileSync(contained(root, manifestRelativePath)));
    invariant(manifest.fingerprint === fingerprintObject(manifest),
      "SR_FIXED_ID_MANIFEST_FINGERPRINT_INVALID", manifestRelativePath);
    const compactFile = contained(root, manifest.compact.relativePath);
    const compactBytes = fs.readFileSync(compactFile);
    invariant(sha256Bytes(compactBytes) === manifest.compact.sha256,
      "SR_FIXED_ID_COMPACT_HASH_INVALID", manifest.compact.relativePath);
    const ids = []; const seen = new Set();
    const lines = zlib.gunzipSync(compactBytes).toString("utf8").trim().split("\n");
    for (const line of lines) {
      const id = JSON.parse(line).historicalMatchUrlId;
      if (!seen.has(id)) { seen.add(id); ids.push(id); }
    }
    invariant(ids.length === baseline.fixedCohort.scenarioCount, "SR_FIXED_ID_DENOMINATOR_INVALID",
      `${ids.length}/${baseline.fixedCohort.scenarioCount}`); return ids;
  }
  const overview = JSON.parse(fs.readFileSync(contained(root,
    baseline.fixedCohort.overviewRelativePath))); const ids = []; const seen = new Set();
  for (const ref of overview.reports) {
    const report = JSON.parse(fs.readFileSync(contained(root, ref.relativePath)));
    for (const match of report.matches) if (!seen.has(match.historicalMatchUrlId)) {
      seen.add(match.historicalMatchUrlId); ids.push(match.historicalMatchUrlId);
    }
  }
  invariant(ids.length === baseline.fixedCohort.scenarioCount, "SR_FIXED_ID_DENOMINATOR_INVALID",
    `${ids.length}/${baseline.fixedCohort.scenarioCount}`); return ids;
}
function fixedScenarios(root, ids) {
  const { manifest } = loadDd9Assignment(root); const manifestIds = new Set(
    manifest.matches.map(match => match.urlId)); const known = ids.filter(id => manifestIds.has(id));
  const byId = new Map(scenariosForIds(manifest, known, root).map(item => [item.matchUrlId, item]));
  for (const scenario of loadRollingV1Scenarios(root).scenarios)
    if (!byId.has(scenario.matchUrlId)) byId.set(scenario.matchUrlId, scenario);
  const scenarios = ids.map(id => byId.get(id));
  invariant(scenarios.every(Boolean), "SR_FIXED_SCENARIO_MISSING",
    ids.filter((id, index) => !scenarios[index]).join(",")); return scenarios;
}
function parameters(root, frozen) {
  const matrix = JSON.parse(fs.readFileSync(contained(root, "config", "engine-v2",
    "v2-runtime-performance-matrix-v1.json")));
  const profile = matrix.profiles.find(item => item.profileId === "BALANCED_18K_FRAME104");
  invariant(profile, "SR_BALANCED_PROFILE_MISSING", matrix.planId);
  return { ...frozen.manifest.parameters, runtimeConfig: profile.runtimeConfig,
    searchBudget: profile.searchBudget };
}
function analyze(matches) {
  const output = { analysisV1Wins: 0, analysisV2Wins: 0, analysisDraws: 0,
    v2SingleCrashWins: 0, v2SingleCrashLosses: 0, frameLimitEqualStarDraws: 0,
    mutualCrashEqualStarDraws: 0, runtimeRawWinnerReclassifiedDraw: 0,
    analysisScoreUnits: 0, analysisScoreRatePer10000: 0 };
  for (const match of matches) {
    const result = classifyAnalysisOutcome(match);
    if (result.analysisOutcome === "V1_WIN") output.analysisV1Wins += 1;
    else if (result.analysisOutcome === "V2_WIN") output.analysisV2Wins += 1;
    else output.analysisDraws += 1;
    const crashes = match.counts.crashes;
    if (crashes[match.v2Seat] > 0 && crashes[match.v2Seat ^ 1] === 0 &&
        result.analysisOutcome === "V1_WIN") output.v2SingleCrashLosses += 1;
    if (crashes[match.v2Seat ^ 1] > 0 && crashes[match.v2Seat] === 0 &&
        result.analysisOutcome === "V2_WIN") output.v2SingleCrashWins += 1;
    if (result.terminalCategory === "FRAME_LIMIT_EQUAL_STARS") output.frameLimitEqualStarDraws += 1;
    if (result.terminalCategory === "MUTUAL_CRASH_EQUAL_STARS") output.mutualCrashEqualStarDraws += 1;
    if (result.analysisOutcome === "DRAW" && match.result.winnerImplementation !== "draw")
      output.runtimeRawWinnerReclassifiedDraw += 1;
  }
  // Earlier analysis contracts define an equal-star frame limit and an
  // equal-star mutual crash as an average result.  Keep the calculation
  // integer-only: win=2 units, draw=1 unit, loss=0 units.
  output.analysisScoreUnits = output.analysisV2Wins * 2 + output.analysisDraws;
  output.analysisScoreRatePer10000 = matches.length ?
    Math.floor(output.analysisScoreUnits * 10000 / (matches.length * 2)) : 0;
  return output;
}
async function runFixedArena(root, stage, options = {}) {
  const baseline = JSON.parse(fs.readFileSync(contained(root, "config", "engine-v2",
    "structural-repair-baseline.json"))); const ids = fixedIds(root, baseline);
  const fixed = fixedScenarios(root, ids); const offset = Number.isSafeInteger(options.scenarioOffset) &&
    options.scenarioOffset >= 0 ? options.scenarioOffset : 0;
  const end = Number.isSafeInteger(options.scenarioLimit) && options.scenarioLimit > 0 ?
    offset + options.scenarioLimit : fixed.length;
  const scenarios = fixed.slice(offset, end); const selectedIds = scenarios.map(item => item.matchUrlId);
  const simulator = await loadSimulator(root);
  const frozen = loadFrozenCandidate(root); const v1Code = fs.readFileSync(frozen.v1File, "utf8");
  const candidateOptions = v2Options(parameters(root, frozen)); const matches = [];
  const repetitions = Number.isSafeInteger(options.repetitions) && options.repetitions > 0 ?
    options.repetitions : baseline.fixedCohort.repetitions;
  const variants = Array.isArray(options.variants) && options.variants.length ? options.variants : VARIANTS;
  const expected = scenarios.length * repetitions * variants.length;
  for (const scenario of scenarios) for (let repetition = 0; repetition < repetitions; repetition += 1)
    for (const variant of variants) {
      matches.push(await runMatch(simulator.module, scenario, variant, repetition, v1Code, 200,
        candidateOptions, options.diagnostics || {}));
      if (typeof options.onProgress === "function" &&
          (matches.length === expected || matches.length % 50 === 0))
        options.onProgress(matches.length, expected, scenario.matchUrlId, variant.variantId);
    }
  const combined = aggregate(matches, scenarios.length, repetitions); const analysis = analyze(matches);
  const source = sourceIdentity(root); const report = { schemaVersion: 1,
    reportKind: "STRUCTURAL_REPAIR_FIXED_SR0_ARENA", stageId: stage, status:
    combined.complete && combined.avoidableHardRejects === 0 && combined.rootRestoreFailures === 0 &&
      combined.riskDominatedSelections === 0 && combined.hotAllocations === 0 &&
      combined.v2Timeouts === 0 && combined.v2Errors === 0 ? "PASS" : "FAIL",
    source, cohort: { scenarioCount: scenarios.length, repetitions,
      variants: variants.length, matchCount: matches.length, scenarioOffset: offset,
      idsFingerprint: fingerprintObject({ ids: selectedIds }) },
    ...analysis, avoidableHardRejects: combined.avoidableHardRejects,
    riskDominatedSelections: combined.riskDominatedSelections,
    rootRestoreFailures: combined.rootRestoreFailures, hotAllocations: combined.hotAllocations,
    v2Timeouts: combined.v2Timeouts, v2Errors: combined.v2Errors,
    runtime: { v1: combined.v1Runtime, v2: combined.v2Runtime }, rawSummary: combined,
    matches, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); const directory = contained(root, "artifacts", "reports",
    "structural-repair", stage); ensureDirectory(directory);
  const file = path.join(directory, `${stage.toLowerCase()}-fixed-arena.json`);
  if (options.persist !== false) {
    writeJsonAtomic(file, report, { mode: 0o644 });
    writeJsonImmutable(path.join(directory, "history",
      `${stage.toLowerCase()}-fixed-arena-${report.fingerprint}.json`), report, { mode: 0o644 });
  }
  return { report, file };
}

async function runRollingDiscoveryArena(root, stage, scenarios, snapshot, options = {}) {
  invariant(Array.isArray(scenarios), "SR_ROLLING_SCENARIOS_INVALID", stage);
  const simulator = await loadSimulator(root); const frozen = loadFrozenCandidate(root);
  const v1Code = fs.readFileSync(frozen.v1File, "utf8");
  const candidateOptions = v2Options(parameters(root, frozen)); const matches = [];
  const repetitions = Number.isSafeInteger(options.repetitions) && options.repetitions > 0 ?
    options.repetitions : 1;
  const variants = Array.isArray(options.variants) && options.variants.length ? options.variants : VARIANTS;
  const expected = scenarios.length * repetitions * variants.length;
  for (const scenario of scenarios) for (let repetition = 0; repetition < repetitions; repetition += 1)
    for (const variant of variants) {
      matches.push(await runMatch(simulator.module, scenario, variant, repetition, v1Code, 200,
        candidateOptions, options.diagnostics || {}));
      if (typeof options.onProgress === "function" &&
          (matches.length === expected || matches.length % 50 === 0))
        options.onProgress(matches.length, expected, scenario.matchUrlId, variant.variantId);
    }
  const combined = aggregate(matches, scenarios.length, repetitions); const analysis = analyze(matches);
  const source = sourceIdentity(root); const report = { schemaVersion: 1,
    reportKind: "STRUCTURAL_REPAIR_ROLLING_DISCOVERY_ARENA", stageId: stage, status:
    combined.complete && combined.avoidableHardRejects === 0 && combined.rootRestoreFailures === 0 &&
      combined.riskDominatedSelections === 0 && combined.hotAllocations === 0 &&
      combined.v2Timeouts === 0 && combined.v2Errors === 0 ? "PASS" : "FAIL",
    source, cohort: { scenarioCount: scenarios.length, repetitions, variants: variants.length,
      matchCount: matches.length, snapshotId: snapshot.snapshotId, headId: snapshot.headId,
      snapshotFingerprint: snapshot.fingerprint,
      idsFingerprint: fingerprintObject({ ids: scenarios.map(item => item.matchUrlId) }) },
    ...analysis, avoidableHardRejects: combined.avoidableHardRejects,
    riskDominatedSelections: combined.riskDominatedSelections,
    rootRestoreFailures: combined.rootRestoreFailures, hotAllocations: combined.hotAllocations,
    v2Timeouts: combined.v2Timeouts, v2Errors: combined.v2Errors,
    runtime: { v1: combined.v1Runtime, v2: combined.v2Runtime }, rawSummary: combined,
    matches, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); const directory = contained(root, "artifacts", "reports",
    "structural-repair", stage); ensureDirectory(directory);
  const file = path.join(directory, `${stage.toLowerCase()}-rolling-discovery-arena.json`);
  if (options.persist !== false) {
    writeJsonAtomic(file, report, { mode: 0o644 });
    writeJsonImmutable(path.join(directory, "history",
      `${stage.toLowerCase()}-rolling-discovery-arena-${report.fingerprint}.json`), report,
    { mode: 0o644 });
  }
  return { report, file };
}

module.exports = { fixedIds, fixedScenarios, parameters, analyze, runFixedArena,
  runRollingDiscoveryArena };
