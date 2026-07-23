"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const readline = require("node:readline");
const { once } = require("node:events");
const { pipeline } = require("node:stream/promises");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic } = require("../core/atomic-file");
const { loadDd9Assignment, idsForRole } = require("../simulation/dd9-assignment");
const { aggregate, VARIANTS, loadSimulator, runMatch, runPairedArena } =
  require("../simulation/paired-arena");
const { loadRollingV1Scenarios } = require("../simulation/historical-scenarios");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");
const { classifyAnalysisOutcome, pairCategory } = require("../analysis/analysis-outcome");

const ALL_ROLES = Object.freeze(["DISCOVERY", "CALIBRATION", "FROZEN_REGRESSION"]);
const RETENTION_ROOT = "artifacts/retention/gr0/baselines";
const BASELINE_IDS = Object.freeze(["imp8-common-1952", "working-0ed5c5-common-5936"]);
const FIXED_BASELINE_ID = "sr3-final-2128";
const MATCH_BUDGET = 20 * 1024 * 1024;
const SAMPLE_BUDGET = 10 * 1024 * 1024;
const METADATA_BUDGET = 2 * 1024 * 1024;
const RUN_BUDGET = 32 * 1024 * 1024;
const ARTIFACT_BUDGET = 64 * 1024 * 1024;

function sourceFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(file, output);
    else if (entry.isFile() && entry.name.endsWith(".js")) output.push(file);
  }
  return output;
}
function directoryBytes(directory) {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) total += directoryBytes(file);
    else if (entry.isFile()) total += fs.statSync(file).size;
  }
  return total;
}
function sourceIdentity(root) {
  const base = contained(root, "engine-v2", "src"); const files = sourceFiles(base).sort();
  const entries = files.map(file => ({ relativePath: path.relative(root, file).replaceAll("\\", "/"),
    sha256: sha256Bytes(fs.readFileSync(file)) }));
  return { fileCount: entries.length, sha256: sha256Text(entries.map(entry =>
    `${entry.relativePath}\0${entry.sha256}`).join("\n")), entries };
}
async function sha256File(file) {
  const hash = crypto.createHash("sha256"); const stream = fs.createReadStream(file);
  stream.on("data", chunk => hash.update(chunk)); await once(stream, "end");
  return hash.digest("hex");
}
async function loadLegacyBaseline(root, baselineId) {
  const manifestFile = contained(root, RETENTION_ROOT, baselineId, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  invariant(manifest.status === "COMPACTED" &&
    manifest.fingerprint === fingerprintObject(manifest),
  "WORKING_ARENA_BASELINE_MANIFEST_INVALID", baselineId);
  const file = contained(root, manifest.compact.relativePath);
  invariant(fs.statSync(file).size === manifest.compact.size &&
    await sha256File(file) === manifest.compact.sha256,
  "WORKING_ARENA_BASELINE_BYTES_INVALID", baselineId);
  const records = new Map(); const scenarioIds = new Set();
  const lines = readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity
  });
  for await (const line of lines) if (line) {
    const record = JSON.parse(line);
    records.set(record.matchId, record);
    scenarioIds.add(record.historicalMatchUrlId);
  }
  invariant(records.size === manifest.extractedRecords,
    "WORKING_ARENA_BASELINE_DENOMINATOR", baselineId);
  return { baselineId, manifest, records, scenarioIds };
}
function compactMatch(match) {
  const classified = classifyAnalysisOutcome(match); const layer = match.v2.layerTotals;
  return {
    schemaVersion: 1,
    objectKind: "ArenaCompactMatchV1",
    matchId: match.matchId,
    historicalMatchUrlId: match.historicalMatchUrlId,
    scenarioFingerprint: match.scenarioFingerprint,
    cohort: match.cohort,
    variantId: match.variantId,
    family: match.family,
    repetition: match.repetition,
    seatImplementations: match.seatImplementations,
    seatSkills: match.seatSkills,
    v2Seat: match.v2Seat,
    analysisOutcome: classified.analysisOutcome,
    terminalCategory: classified.terminalCategory,
    rawResult: match.result,
    frames: match.frames,
    stars: classified.stars,
    crashes: classified.crashes,
    bullets: match.counts.bullets,
    bombs: match.counts.bombs,
    skills: match.counts.skills,
    v2CrashCause: match.counts.v2CrashCause,
    v1: {
      decisions: match.v1.decisionCount,
      timeoutCount: match.v1.timeoutCount || 0,
      errorCount: match.v1.errorCount || 0,
      totalRuntimeMicros: match.v1.totalRuntimeMicros,
      p95RuntimeMicros: match.v1.p95RuntimeMicros,
      actionCounts: match.v1.actionCounts,
      actionStream: match.v1.compactActionStream || "",
      arguments: match.v1.compactArguments || []
    },
    v2: {
      decisions: match.v2.decisionCount,
      timeoutCount: match.v2.timeoutCount || 0,
      errorCount: match.v2.errorCount || 0,
      totalRuntimeMicros: match.v2.totalRuntimeMicros,
      p95RuntimeMicros: match.v2.p95RuntimeMicros,
      actionCounts: match.v2.actionCounts,
      runtimeModeCounts: match.v2.runtimeModeCounts,
      actionStream: match.v2.compactActionStream || "",
      frameFlags: match.v2.compactFrameFlags || "",
      arguments: match.v2.compactArguments || [],
      layerTotals: {
        rootCounts: layer.rootCounts,
        hardRejects: layer.hardRejects,
        selectedHardRejects: layer.selectedHardRejects,
        avoidableHardRejects: layer.avoidableHardRejects,
        unavoidableAllRejected: layer.unavoidableAllRejected,
        proofWins: layer.proofWins,
        noAcceptableActions: layer.noAcceptableActions,
        riskDominatedSelections: layer.riskDominatedSelections,
        stageMatrixSolves: layer.stageMatrixSolves,
        escapeRestrictions: layer.escapeRestrictions || 0,
        escapeRescueOverrides: layer.escapeRescueOverrides || 0,
        fallbacks: layer.fallbacks,
        rootRestoreFailures: layer.depthRootRestoreFailures,
        hotAllocations: layer.hotAllocations
      }
    }
  };
}
function addCount(target, key, amount = 1) { target[key] = (target[key] || 0) + amount; }
function analysisSummary(matches) {
  const summary = {
    matchCount: matches.length, scenarios: new Set(), analysisV1Wins: 0, analysisV2Wins: 0,
    analysisDraws: 0, scoreUnits: 0, scoreRatePer10000: 0,
    terminalCategories: {}, variants: {}, pairs: {},
    fixedMatchCount: 0, fixedV2SingleCrashWins: 0, fixedV2SingleCrashLosses: 0,
    v1ActionCounts: {}, v2ActionCounts: {}, layerTotals: {
      avoidableHardRejects: 0, riskDominatedSelections: 0, rootRestoreFailures: 0,
      v2Timeouts: 0, v2Errors: 0, stageMatrixSolves: 0,
      escapeRestrictions: 0, escapeRescueOverrides: 0
    }
  };
  const pairGroups = new Map();
  for (const match of matches) {
    summary.scenarios.add(match.historicalMatchUrlId);
    if (match.analysisOutcome === "V2_WIN") { summary.analysisV2Wins += 1; summary.scoreUnits += 2; }
    else if (match.analysisOutcome === "V1_WIN") summary.analysisV1Wins += 1;
    else { summary.analysisDraws += 1; summary.scoreUnits += 1; }
    addCount(summary.terminalCategories, match.terminalCategory);
    const variant = summary.variants[match.variantId] ||
      (summary.variants[match.variantId] = { matches: 0, v1Wins: 0, v2Wins: 0, draws: 0 });
    variant.matches += 1;
    if (match.analysisOutcome === "V2_WIN") variant.v2Wins += 1;
    else if (match.analysisOutcome === "V1_WIN") variant.v1Wins += 1;
    else variant.draws += 1;
    if (match.cohort === "FIXED_266") {
      summary.fixedMatchCount += 1;
      if (match.terminalCategory === "SINGLE_CRASH") {
        if (match.analysisOutcome === "V2_WIN") summary.fixedV2SingleCrashWins += 1;
        else if (match.analysisOutcome === "V1_WIN") summary.fixedV2SingleCrashLosses += 1;
      }
    }
    for (const [name, count] of Object.entries(match.v1.actionCounts))
      addCount(summary.v1ActionCounts, name, count);
    for (const [name, count] of Object.entries(match.v2.actionCounts))
      addCount(summary.v2ActionCounts, name, count);
    const layer = match.v2.layerTotals;
    summary.layerTotals.avoidableHardRejects += layer.avoidableHardRejects;
    summary.layerTotals.riskDominatedSelections += layer.riskDominatedSelections;
    summary.layerTotals.rootRestoreFailures += layer.rootRestoreFailures;
    summary.layerTotals.v2Timeouts += match.v2.timeoutCount;
    summary.layerTotals.v2Errors += match.v2.errorCount;
    summary.layerTotals.stageMatrixSolves += layer.stageMatrixSolves;
    summary.layerTotals.escapeRestrictions += layer.escapeRestrictions;
    summary.layerTotals.escapeRescueOverrides += layer.escapeRescueOverrides;
    const key = `${match.historicalMatchUrlId}:${match.family}:r${match.repetition}`;
    const pair = pairGroups.get(key) || [];
    pair.push(match); pairGroups.set(key, pair);
  }
  for (const pair of pairGroups.values()) {
    if (pair.length !== 2) { addCount(summary.pairs, "INCOMPLETE"); continue; }
    addCount(summary.pairs, pairCategory(pair[0], pair[1]));
  }
  summary.scenarioCount = summary.scenarios.size; delete summary.scenarios;
  summary.scoreRatePer10000 = summary.matchCount ?
    Math.floor(summary.scoreUnits * 5000 / summary.matchCount) : 0;
  return summary;
}
function compareBaseline(baseline, matches) {
  const comparison = { baselineId: baseline.baselineId, comparableMatches: 0,
    baselineV1Wins: 0, baselineV2Wins: 0, baselineDraws: 0,
    currentV1Wins: 0, currentV2Wins: 0, currentDraws: 0, transitions: {} };
  for (const current of matches) {
    const before = baseline.records.get(current.matchId); if (!before) continue;
    comparison.comparableMatches += 1;
    if (before.analysisOutcome === "V1_WIN") comparison.baselineV1Wins += 1;
    else if (before.analysisOutcome === "V2_WIN") comparison.baselineV2Wins += 1;
    else comparison.baselineDraws += 1;
    if (current.analysisOutcome === "V1_WIN") comparison.currentV1Wins += 1;
    else if (current.analysisOutcome === "V2_WIN") comparison.currentV2Wins += 1;
    else comparison.currentDraws += 1;
    addCount(comparison.transitions, `${before.analysisOutcome}_TO_${current.analysisOutcome}`);
  }
  return comparison;
}
class SampleCollector {
  constructor(baseline, oldScenarioIds) {
    this.baseline = baseline; this.oldScenarioIds = oldScenarioIds;
    this.categoryCounts = {}; this.samples = new Map();
  }
  categories(match, compact) {
    const categories = []; const before = this.baseline.records.get(compact.matchId);
    if (before && before.analysisOutcome !== compact.analysisOutcome)
      categories.push(`${before.analysisOutcome}_TO_${compact.analysisOutcome}`);
    if (compact.terminalCategory === "SINGLE_CRASH")
      categories.push(compact.analysisOutcome === "V2_WIN" ?
        "V2_SINGLE_CRASH_WIN" : compact.analysisOutcome === "V1_WIN" ?
          "V2_SINGLE_CRASH_LOSS" : "SINGLE_CRASH_DRAW");
    if (compact.terminalCategory === "FRAME_LIMIT_STARS")
      categories.push(compact.analysisOutcome === "V2_WIN" ?
        "FRAME_LIMIT_STAR_WIN" : "FRAME_LIMIT_STAR_LOSS");
    if (compact.v2.layerTotals.noAcceptableActions > 0) categories.push("NO_ACCEPTABLE");
    if (compact.v2.layerTotals.escapeRescueOverrides > 0) categories.push("EO_RESCUE_OVERRIDE");
    if (compact.v2.layerTotals.avoidableHardRejects > 0 ||
        compact.v2.layerTotals.riskDominatedSelections > 0 ||
        compact.v2.layerTotals.rootRestoreFailures > 0 ||
        compact.v2.timeoutCount > 0 || compact.v2.errorCount > 0)
      categories.push("STRUCTURAL_ANOMALY");
    if (!this.oldScenarioIds.has(compact.historicalMatchUrlId) &&
        compact.analysisOutcome !== "V2_WIN") categories.push("NEW_SCENARIO_FAILURE");
    return categories;
  }
  consider(match, compact) {
    const eligible = this.categories(match, compact).filter(category =>
      (this.categoryCounts[category] || 0) < 8);
    if (eligible.length && (this.samples.has(compact.matchId) || this.samples.size < 64)) {
      let sample = this.samples.get(compact.matchId);
      if (!sample) {
        const words = match.v2.sampleFrameWords;
        const frameData = words && Number.isSafeInteger(match.v2.sampleFrameCount) ? {
          encoding: "I32_NATIVE_LE_BASE64",
          count: match.v2.sampleFrameCount,
          stride: match.v2.sampleFrameStride,
          fields: [
            "frame", "action", "root", "selectedHard", "proof", "runtimeMode",
            "allowCount", "physicalDepth", "informationDepth", "informationWorlds",
            "depthNodes", "score", "workUnits", "eoSupport", "eoMembers",
            "eoRootSlack", "noAcceptable", "acceptableCount", "stageMatrixSolves"
          ],
          data: Buffer.from(words.buffer, words.byteOffset, words.byteLength).toString("base64")
        } : null;
        sample = { schemaVersion: 1, objectKind: "ArenaDiagnosticSampleV1",
          match: compact, categories: [], frameData };
        this.samples.set(compact.matchId, sample);
      }
      for (const category of eligible) if (!sample.categories.includes(category)) {
        sample.categories.push(category); addCount(this.categoryCounts, category);
      }
    }
    delete match.v2.sampleFrameWords;
    delete match.v2.sampleFrameCount;
    delete match.v2.sampleFrameStride;
  }
  values() { return [...this.samples.values()]; }
}
async function writeGzipNdjson(file, records) {
  ensureDirectory(path.dirname(file));
  const temp = `${file}.tmp-${process.pid}`; const gzip = zlib.createGzip({ level: 9 });
  const sink = fs.createWriteStream(temp, { mode: 0o644 }); const piping = pipeline(gzip, sink);
  for (const record of records) {
    if (!gzip.write(`${JSON.stringify(record)}\n`)) await once(gzip, "drain");
  }
  gzip.end(); await piping; fs.renameSync(temp, file);
  return { relativePath: file, size: fs.statSync(file).size, sha256: await sha256File(file),
    records: records.length };
}
function strictInvariants(matches) {
  const output = { selectedHardRejects: 0, avoidableHardRejects: 0,
    unavoidableAllRejected: 0, riskDominatedSelections: 0, rootRestoreFailures: 0,
    hotAllocations: 0, v2Timeouts: 0, v2Errors: 0 };
  for (const match of matches) {
    const layer = match.v2.layerTotals;
    output.selectedHardRejects += layer.selectedHardRejects;
    output.avoidableHardRejects += layer.avoidableHardRejects;
    output.unavoidableAllRejected += layer.unavoidableAllRejected;
    output.riskDominatedSelections += layer.riskDominatedSelections || 0;
    output.rootRestoreFailures += layer.depthRootRestoreFailures;
    output.hotAllocations += layer.hotAllocations;
    output.v2Timeouts += match.v2.timeoutCount || 0;
    output.v2Errors += match.v2.errorCount || 0;
  }
  return output;
}
function scenarioInventory(scenarios) {
  const maps = new Set(); const starts = new Set(); const stars = new Set();
  for (const scenario of scenarios) {
    maps.add(scenario.mapHash);
    starts.add(fingerprintObject({ starts: scenario.starts }));
    stars.add(fingerprintObject({ stars: scenario.stars }));
  }
  return { scenarios: scenarios.length, maps: maps.size, starts: starts.size, stars: stars.size };
}

async function runWorkingArena(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const roles = options.roles && options.roles.length ? options.roles.slice() : ALL_ROLES.slice();
  invariant(roles.every(role => ALL_ROLES.includes(role)) && new Set(roles).size === roles.length,
    "V1_V2_WORKING_ROLE_INVALID", roles.join(","));
  const repetitions = Math.max(1, Math.floor(Number(options.repetitions) || 1));
  const timeoutMs = Math.max(20, Math.floor(Number(options.timeoutMs) || 200));
  const limit = options.limit == null ? null : Math.max(1, Math.floor(Number(options.limit)));
  const compactTrace = options.diagnostics?.captureCompact === true;
  invariant(compactTrace, "WORKING_ARENA_COMPACT_TRACE_REQUIRED", "use --trace compact");
  const baselines = {};
  for (const id of [...BASELINE_IDS, FIXED_BASELINE_ID])
    baselines[id] = await loadLegacyBaseline(root, id);
  const frozen = loadFrozenCandidate(root, options.manifestPath); const source = sourceIdentity(root);
  const parameters = options.parametersOverride || frozen.manifest.parameters;
  invariant(parameters && parameters.runtimeConfig && parameters.searchBudget &&
    parameters.tacticalConfig, "V1_V2_WORKING_PARAMETERS_INVALID", "missing runtime/search/tactical");
  const parameterFingerprint = fingerprintObject(parameters);
  const parameterProfileId = options.parameterProfileId ||
    frozen.manifest.selection.candidateProfileId;
  const candidateOptions = v2Options(parameters);
  const { assignment } = loadDd9Assignment(root);
  const requestedScenarioCount = roles.reduce((sum, role) =>
    sum + Math.min(idsForRole(assignment, role).length, limit || Number.MAX_SAFE_INTEGER), 0);
  const rolling = options.includeRolling === false ? null : loadRollingV1Scenarios(root);
  const assignedIds = new Set(assignment.assignments.map(item => item.matchUrlId));
  const rollingScenarios = rolling ? rolling.scenarios.filter(scenario =>
    !assignedIds.has(scenario.matchUrlId)).slice(0, limit || Number.MAX_SAFE_INTEGER) : [];
  const totalScenarioCount = requestedScenarioCount + rollingScenarios.length;
  const universe = rolling ? rolling.scenarios : [];
  const inputInventory = scenarioInventory(universe);
  const token = `${source.sha256.slice(0, 16)}-r${repetitions}-compact-` +
    `${roles.map(role => role.toLowerCase().replace("_regression", "")).join("-")}` +
    (limit == null ? "" : `-l${limit}`) + `-p${parameterFingerprint.slice(0, 12)}` +
    (rolling ? `-rolling-${rolling.snapshot.headId.slice(-8)}` : "");
  const output = path.resolve(options.outputDirectory || contained(root, "artifacts", "diagnostics",
    "v1-v2-working", token));
  invariant(!fs.existsSync(output) || fs.readdirSync(output).length === 0,
    "WORKING_ARENA_OUTPUT_NOT_EMPTY", output);
  ensureDirectory(output);
  const reports = []; const compactMatches = [];
  const samples = new SampleCollector(baselines["working-0ed5c5-common-5936"],
    baselines["working-0ed5c5-common-5936"].scenarioIds);
  const fixedScenarioIds = baselines[FIXED_BASELINE_ID].scenarioIds;
  const onMatch = match => {
    match.cohort = fixedScenarioIds.has(match.historicalMatchUrlId) ?
      "FIXED_266" : "ROLLING_DISCOVERY";
    const compact = compactMatch(match);
    samples.consider(match, compact);
    compactMatches.push(compact);
  };
  let completedBeforeRole = 0;
  for (const role of roles) {
    const roleResult = await runPairedArena({ workspaceRoot: root, role, limit, repetitions, timeoutMs,
      experimentId: `V1_V2_WORKING_${source.sha256.slice(0, 16)}`,
      candidateProfileId: parameterProfileId,
      candidateBinding: { workingSourceSha256: source.sha256,
        parameterFingerprint, frozenV1Sha256: frozen.manifest.selection.v1Sha256 },
      v1File: frozen.v1File, v1RelativePath: frozen.manifest.selection.frozenV1RelativePath,
      v2Options: candidateOptions, diagnostics: options.diagnostics, persistReport: false, onMatch,
      onProgress(done, total, matchUrlId, variantId) {
        if (typeof options.onProgress === "function") options.onProgress(completedBeforeRole + done,
          totalScenarioCount * repetitions * 4, role, done, total, matchUrlId, variantId);
      } });
    reports.push({ role, status: roleResult.report.status,
      summary: roleResult.report.summary, invariants: roleResult.report.invariants });
    completedBeforeRole += roleResult.report.summary.matchCount;
    invariant(sourceIdentity(root).sha256 === source.sha256,
      "V1_V2_WORKING_SOURCE_CHANGED_DURING_RUN", role);
  }
  if (rollingScenarios.length) {
    const simulator = await loadSimulator(root); const v1Code = fs.readFileSync(frozen.v1File, "utf8");
    const rollingMatches = []; const rollingTotal = rollingScenarios.length * repetitions * 4;
    for (const scenario of rollingScenarios)
      for (let repetition = 0; repetition < repetitions; repetition += 1)
        for (const variant of VARIANTS) {
          const match = await runMatch(simulator.module, scenario, variant, repetition,
            v1Code, timeoutMs, candidateOptions, options.diagnostics);
          onMatch(match);
          rollingMatches.push(match);
          if (typeof options.onProgress === "function") options.onProgress(
            completedBeforeRole + rollingMatches.length, totalScenarioCount * repetitions * 4,
            "ROLLING_DISCOVERY", rollingMatches.length, rollingTotal,
            scenario.matchUrlId, variant.variantId);
        }
    const rollingSummary = aggregate(rollingMatches, rollingScenarios.length, repetitions);
    const invariants = strictInvariants(rollingMatches);
    reports.push({ role: "ROLLING_DISCOVERY",
      status: rollingSummary.complete && invariants.avoidableHardRejects === 0 &&
        invariants.rootRestoreFailures === 0 && invariants.v2Timeouts === 0 &&
        invariants.v2Errors === 0 ? "PASS" : "FAIL",
      summary: rollingSummary, invariants });
    completedBeforeRole += rollingMatches.length;
    invariant(sourceIdentity(root).sha256 === source.sha256,
      "V1_V2_WORKING_SOURCE_CHANGED_DURING_RUN", "ROLLING_DISCOVERY");
  }

  const summary = analysisSummary(compactMatches);
  const comparisons = {};
  for (const id of BASELINE_IDS) comparisons[id] = compareBaseline(baselines[id], compactMatches);
  const expectedMatches = totalScenarioCount * repetitions * VARIANTS.length;
  const newScenarios = new Set(compactMatches.filter(match =>
    !baselines["working-0ed5c5-common-5936"].scenarioIds.has(match.historicalMatchUrlId))
    .map(match => match.historicalMatchUrlId)).size;
  const checks = {
    denominator: compactMatches.length === expectedMatches && expectedMatches === 6608,
    scenarioDenominator: totalScenarioCount === 826 && inputInventory.scenarios === 826,
    latestInputShape: inputInventory.maps === 813 && inputInventory.starts === 6 &&
      inputInventory.stars === 601,
    newScenarioCount: newScenarios === 84,
    scoreRate: summary.scoreRatePer10000 > 6000,
    fixedSingleCrashWins: summary.fixedMatchCount === 2128 &&
      summary.fixedV2SingleCrashWins >= 358,
    avoidableHardRejects: summary.layerTotals.avoidableHardRejects === 0,
    riskDominatedSelections: summary.layerTotals.riskDominatedSelections === 0,
    rootRestoreFailures: summary.layerTotals.rootRestoreFailures === 0,
    timeoutError: summary.layerTotals.v2Timeouts === 0 && summary.layerTotals.v2Errors === 0,
    baselineImp8: comparisons["imp8-common-1952"].comparableMatches === 1952,
    baselineWorking: comparisons["working-0ed5c5-common-5936"].comparableMatches === 5936
  };
  let status = Object.values(checks).every(Boolean) ? "ACCEPTED" : "REJECTED";
  const matchesFile = path.join(output, "matches.ndjson.gz");
  const samplesFile = path.join(output, "diagnostic-samples.ndjson.gz");
  const matchArtifact = await writeGzipNdjson(matchesFile, compactMatches);
  const sampleArtifact = await writeGzipNdjson(samplesFile, samples.values());
  const overview = {
    schemaVersion: 1,
    reportKind: "V2_GR0_COMPACT_WORKING_ARENA",
    status,
    source: { fileCount: source.fileCount, sha256: source.sha256 },
    frozenV1: { candidateId: frozen.manifest.candidateId,
      relativePath: frozen.manifest.selection.frozenV1RelativePath,
      sha256: frozen.manifest.selection.v1Sha256 },
    parameters: { profileId: parameterProfileId, fingerprint: parameterFingerprint,
      performanceBinding: options.performanceBinding || null },
    execution: { roles, repetitions, limitPerRole: limit,
      lockedAssignmentScenarioCount: requestedScenarioCount,
      rollingScenarioCount: rollingScenarios.length, scenarioCount: totalScenarioCount,
      matchCount: compactMatches.length, expectedMatches, timeoutMs, traceMode: "COMPACT",
      rollingSnapshotId: rolling?.snapshot.snapshotId || null,
      rollingHeadId: rolling?.snapshot.headId || null, newScenarios },
    inputInventory,
    summary,
    comparisons,
    reports,
    diagnosticSamples: { count: samples.values().length,
      categoryCounts: samples.categoryCounts },
    checks,
    evidenceBoundary: { officialRuleTruth: false, localRuntimeIsPlatformRuntime: false,
      knownSimulatorDeviations: ["BOMB_PHASE", "POISON_COOLDOWN_DURATION",
        "PLATFORM_RUNTIME_MODEL", "SAME_FRAME_TERMINAL", "STAR_RANDOM_DISTRIBUTION_UNUSED_HERE"],
      runtimeWinnerIgnored: true },
    compactEncoding: {
      actionStream: "base64 bytes using engine-v2 ACTION ABI",
      frameFlags: {
        encoding: "base64 bytes",
        bits0To1: "root: OK=0, INCOMPLETE=1, INVALID=2, CAPACITY=3",
        bits2To3: "HARD_STATUS",
        bits4To5: "PROOF_STATUS",
        bits6To7: "RUNTIME_MODE"
      },
      sparseArguments: "[frameOrDecisionIndex,x,y]"
    },
    fingerprint: ""
  };
  overview.fingerprint = fingerprintObject(overview);
  const overviewFile = path.join(output, "working-arena-overview.json");
  writeJsonAtomic(overviewFile, overview, { mode: 0o644 });
  const metadataBytes = fs.statSync(overviewFile).size;
  const storageChecks = {
    matches: matchArtifact.size <= MATCH_BUDGET,
    samples: sampleArtifact.size <= SAMPLE_BUDGET,
    metadata: metadataBytes <= METADATA_BUDGET,
    total: matchArtifact.size + sampleArtifact.size + metadataBytes <= RUN_BUDGET,
    artifactsTotal: directoryBytes(contained(root, "artifacts")) + METADATA_BUDGET <=
      ARTIFACT_BUDGET
  };
  if (!Object.values(storageChecks).every(Boolean)) status = "REJECTED";
  overview.status = status; overview.storageChecks = storageChecks;
  overview.fingerprint = fingerprintObject(overview);
  writeJsonAtomic(overviewFile, overview, { mode: 0o644 });
  const manifest = {
    schemaVersion: 1,
    objectKind: "ArenaCompactManifestV1",
    status,
    sourceSha256: source.sha256,
    overview: { relativePath: path.relative(root, overviewFile).replaceAll("\\", "/"),
      size: fs.statSync(overviewFile).size, sha256: await sha256File(overviewFile),
      fingerprint: overview.fingerprint },
    matches: { relativePath: path.relative(root, matchesFile).replaceAll("\\", "/"),
      size: matchArtifact.size, sha256: matchArtifact.sha256, records: matchArtifact.records },
    diagnosticSamples: { relativePath: path.relative(root, samplesFile).replaceAll("\\", "/"),
      size: sampleArtifact.size, sha256: sampleArtifact.sha256, records: sampleArtifact.records },
    storageChecks,
    fingerprint: ""
  };
  manifest.fingerprint = fingerprintObject(manifest);
  const manifestFile = path.join(output, "manifest.json");
  writeJsonAtomic(manifestFile, manifest, { mode: 0o644 });
  const finalMetadata = fs.statSync(overviewFile).size + fs.statSync(manifestFile).size;
  invariant(finalMetadata <= METADATA_BUDGET &&
    matchArtifact.size + sampleArtifact.size + finalMetadata <= RUN_BUDGET,
  "ARENA_STORAGE_BUDGET_EXCEEDED", String(matchArtifact.size + sampleArtifact.size + finalMetadata));
  return { overview, manifest, file: overviewFile, output };
}

module.exports = { ALL_ROLES, BASELINE_IDS, sourceIdentity, loadLegacyBaseline,
  compactMatch, analysisSummary, compareBaseline, scenarioInventory, SampleCollector,
  runWorkingArena };
