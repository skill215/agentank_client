"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { ensureDirectory, writeFileAtomic, writeJsonAtomic } = require("../core/atomic-file");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");
const { loadRollingV1ScenariosForIds } = require("../simulation/historical-scenarios");
const { VARIANTS, loadSimulator, runMatch } = require("../simulation/paired-arena");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");
const { sourceIdentity, loadLegacyBaseline } = require("./v1-v2-working-arena");
const { SOFT_MODE, MODE_FLAGS } = require("./soft-stack-ablation-runtime");

const ANCHOR_COMMIT = "9de24c9f842d460a42f5821bd10a56fe8c48f03f";
const ANCHOR_ENGINE_SOURCE_SHA256 =
  "6682643a47fdb7f48dc7d3d7d81dae9f39c6c615a602b1ab07a5c1e679942701";
const ANCHOR_SOURCE_SHA256 = "798a2a2c7f89013652d0f0dcf6de5424495ec436f4585c8f9c5166fb36224eaa";
const ANCHOR_MINIFIED_SHA256 = "a7ccf63151b4ff013739364af1ae27a20a2a5d26a5a6d5aad27980d77647c412";
const FIXED_BASELINE_ID = "sr4-final-2128";
const SPLIT_SALT = "SS-A0-FIXED-266-V1";
const DISCOVERY_SCENARIOS = 96;
const HOLDOUT_SCENARIOS = 170;
const DISCOVERY_REPETITIONS = 1;
const HOLDOUT_REPETITIONS = 2;
const FILES = Object.freeze([
  "manifest.json", "overview.json", "matches.ndjson.gz", "diagnostic-samples.ndjson.gz"
]);
const MODES = Object.freeze([
  SOFT_MODE.CURRENT,
  SOFT_MODE.NO_OBSERVATION_FRONTIER,
  SOFT_MODE.COMMITTED_ONLY_RISK,
  SOFT_MODE.NO_INFORMATION_ENVELOPES,
  SOFT_MODE.SOFT_ALL_OFF
]);
const ARTIFACT_BUDGET = 10 * 1024 * 1024;
const SAMPLE_LIMIT = 32;
const PER_SAMPLE_CATEGORY_LIMIT = 8;

function addCount(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function readGzipNdjson(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return [];
  return zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").split(/\r?\n/)
    .filter(Boolean).map(line => JSON.parse(line));
}

function gzipNdjson(records) {
  const text = records.length ? `${records.map(record => JSON.stringify(record)).join("\n")}\n` : "";
  return zlib.gzipSync(Buffer.from(text), { level: 9, mtime: 0 });
}

function outputArtifact(file, records) {
  const bytes = gzipNdjson(records);
  writeFileAtomic(file, bytes, { mode: 0o644 });
  return { records: records.length, size: bytes.length, sha256: sha256Bytes(bytes) };
}

function relative(root, file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function starDelta(record) {
  return record.stars[record.v2Seat] - record.stars[record.v2Seat ^ 1];
}

function isV2SingleCrashLoss(record) {
  return record.terminalCategory === "SINGLE_CRASH" && record.analysisOutcome === "V1_WIN";
}

function compactMatch(match, phase, mode) {
  const classified = classifyAnalysisOutcome(match);
  const layer = match.v2.layerTotals;
  return {
    schemaVersion: 1,
    objectKind: "SoftStackAblationMatchV1",
    phase,
    mode,
    matchId: match.matchId,
    historicalMatchUrlId: match.historicalMatchUrlId,
    scenarioFingerprint: match.scenarioFingerprint,
    variantId: match.variantId,
    family: match.family,
    repetition: match.repetition,
    seatImplementations: match.seatImplementations,
    seatSkills: match.seatSkills,
    v2Seat: match.v2Seat,
    analysisOutcome: classified.analysisOutcome,
    terminalCategory: classified.terminalCategory,
    frames: match.frames,
    rawResult: match.result,
    stars: classified.stars,
    crashes: classified.crashes,
    bullets: match.counts.bullets,
    bombs: match.counts.bombs,
    skills: match.counts.skills,
    v1: {
      actionCounts: match.v1.actionCounts,
      actionStream: match.v1.compactActionStream || "",
      timeoutCount: match.v1.timeoutCount || 0,
      errorCount: match.v1.errorCount || 0
    },
    v2: {
      actionCounts: match.v2.actionCounts,
      actionStream: match.v2.compactActionStream || "",
      frameFlags: match.v2.compactFrameFlags || "",
      arguments: match.v2.compactArguments || [],
      timeoutCount: match.v2.timeoutCount || 0,
      errorCount: match.v2.errorCount || 0,
      layerTotals: {
        hardRejects: layer.hardRejects,
        selectedHardRejects: layer.selectedHardRejects,
        avoidableHardRejects: layer.avoidableHardRejects,
        proofWins: layer.proofWins,
        noAcceptableActions: layer.noAcceptableActions,
        riskDominatedSelections: layer.riskDominatedSelections,
        stageMatrixSolves: layer.stageMatrixSolves,
        escapeRestrictions: layer.escapeRestrictions || 0,
        escapeRescueOverrides: layer.escapeRescueOverrides || 0,
        rootRestoreFailures: layer.depthRootRestoreFailures,
        fallbacks: layer.fallbacks
      }
    }
  };
}

function emptyCounters() {
  return {
    hardRejects: 0,
    selectedHardRejects: 0,
    avoidableHardRejects: 0,
    proofWins: 0,
    noAcceptableActions: 0,
    riskDominatedSelections: 0,
    stageMatrixSolves: 0,
    escapeRestrictions: 0,
    escapeRescueOverrides: 0,
    rootRestoreFailures: 0,
    fallbacks: 0,
    v2Timeouts: 0,
    v2Errors: 0
  };
}

function summaryFor(records) {
  const summary = {
    matches: records.length,
    scenarios: 0,
    v2Wins: 0,
    v1Wins: 0,
    draws: 0,
    scoreUnits: 0,
    scoreRatePer10000: 0,
    starDelta: 0,
    v2SingleCrashWins: 0,
    v2SingleCrashLosses: 0,
    terminalCategories: {},
    v2ActionCounts: {},
    variants: {},
    counters: emptyCounters()
  };
  const scenarioIds = new Set();
  for (const record of records) {
    scenarioIds.add(record.historicalMatchUrlId);
    if (record.analysisOutcome === "V2_WIN") {
      summary.v2Wins += 1;
      summary.scoreUnits += 2;
    } else if (record.analysisOutcome === "V1_WIN") {
      summary.v1Wins += 1;
    } else {
      summary.draws += 1;
      summary.scoreUnits += 1;
    }
    summary.starDelta += starDelta(record);
    addCount(summary.terminalCategories, record.terminalCategory);
    if (record.terminalCategory === "SINGLE_CRASH") {
      if (record.analysisOutcome === "V2_WIN") summary.v2SingleCrashWins += 1;
      else if (record.analysisOutcome === "V1_WIN") summary.v2SingleCrashLosses += 1;
    }
    for (const [action, count] of Object.entries(record.v2.actionCounts))
      addCount(summary.v2ActionCounts, action, count);
    const variant = summary.variants[record.variantId] ||
      (summary.variants[record.variantId] = {
        matches: 0, v2Wins: 0, v1Wins: 0, draws: 0, scoreUnits: 0,
        scoreRatePer10000: 0, starDelta: 0
      });
    variant.matches += 1;
    variant.starDelta += starDelta(record);
    if (record.analysisOutcome === "V2_WIN") {
      variant.v2Wins += 1;
      variant.scoreUnits += 2;
    } else if (record.analysisOutcome === "V1_WIN") {
      variant.v1Wins += 1;
    } else {
      variant.draws += 1;
      variant.scoreUnits += 1;
    }
    const layer = record.v2.layerTotals;
    for (const key of Object.keys(summary.counters))
      if (key === "v2Timeouts") summary.counters[key] += record.v2.timeoutCount;
      else if (key === "v2Errors") summary.counters[key] += record.v2.errorCount;
      else summary.counters[key] += layer[key] || 0;
  }
  summary.scenarios = scenarioIds.size;
  summary.scoreRatePer10000 = summary.matches ?
    Math.floor(summary.scoreUnits * 5000 / summary.matches) : 0;
  for (const variant of Object.values(summary.variants))
    variant.scoreRatePer10000 = variant.matches ?
      Math.floor(variant.scoreUnits * 5000 / variant.matches) : 0;
  return summary;
}

function recordKey(record) {
  return `${record.historicalMatchUrlId}\0${record.variantId}\0${record.repetition}`;
}

function indexRecords(records) {
  return new Map(records.map(record => [recordKey(record), record]));
}

function compareModes(currentRecords, candidateRecords) {
  const current = summaryFor(currentRecords);
  const candidate = summaryFor(candidateRecords);
  const beforeByKey = indexRecords(currentRecords);
  const transitions = {};
  let behaviorChanges = 0;
  let lossToWin = 0;
  let winToLoss = 0;
  let scoreUnitGains = 0;
  let scoreUnitLosses = 0;
  for (const after of candidateRecords) {
    const before = beforeByKey.get(recordKey(after));
    invariant(before, "SS_A0_COMPARISON_MATCH_MISSING", after.matchId);
    addCount(transitions, `${before.analysisOutcome}_TO_${after.analysisOutcome}`);
    if (before.v2.actionStream !== after.v2.actionStream ||
        JSON.stringify(before.v2.arguments) !== JSON.stringify(after.v2.arguments))
      behaviorChanges += 1;
    if (before.analysisOutcome === "V1_WIN" && after.analysisOutcome === "V2_WIN")
      lossToWin += 1;
    if (before.analysisOutcome === "V2_WIN" && after.analysisOutcome === "V1_WIN")
      winToLoss += 1;
    const beforeUnits = before.analysisOutcome === "V2_WIN" ? 2 :
      before.analysisOutcome === "DRAW" ? 1 : 0;
    const afterUnits = after.analysisOutcome === "V2_WIN" ? 2 :
      after.analysisOutcome === "DRAW" ? 1 : 0;
    if (afterUnits > beforeUnits) scoreUnitGains += afterUnits - beforeUnits;
    else scoreUnitLosses += beforeUnits - afterUnits;
  }
  const variantDeltas = {};
  let improvedVariants = 0;
  let worstVariantDelta = 10000;
  for (const variant of VARIANTS) {
    const id = variant.variantId;
    const delta = candidate.variants[id].scoreRatePer10000 -
      current.variants[id].scoreRatePer10000;
    variantDeltas[id] = delta;
    if (delta > 0) improvedVariants += 1;
    if (delta < worstVariantDelta) worstVariantDelta = delta;
  }
  return {
    current,
    candidate,
    scoreRateGainPer10000: candidate.scoreRatePer10000 - current.scoreRatePer10000,
    starDeltaGain: candidate.starDelta - current.starDelta,
    singleCrashLossDelta: candidate.v2SingleCrashLosses - current.v2SingleCrashLosses,
    behaviorChanges,
    transitions,
    lossToWin,
    winToLoss,
    scoreUnitGains,
    scoreUnitLosses,
    variantDeltas,
    improvedVariants,
    worstVariantDelta
  };
}

function invariantFailures(summary) {
  const counters = summary.counters;
  return counters.avoidableHardRejects + counters.riskDominatedSelections +
    counters.rootRestoreFailures + counters.v2Timeouts + counters.v2Errors;
}

function discoveryGate(comparison) {
  const checks = {
    hardInvariantsZero: invariantFailures(comparison.candidate) === 0,
    scoreGainAtLeast3Points: comparison.scoreRateGainPer10000 >= 300,
    starDeltaNotWorse: comparison.starDeltaGain >= 0,
    singleCrashLossIncreaseWithinOnePercent: comparison.singleCrashLossDelta <= 3,
    atLeastTwoVariantsImprove: comparison.improvedVariants >= 2,
    noVariantDropsMoreThan2Points: comparison.worstVariantDelta >= -200
  };
  return { status: Object.values(checks).every(Boolean) ? "PASS" : "FAIL", checks };
}

function holdoutGate(comparison) {
  const checks = {
    hardInvariantsZero: invariantFailures(comparison.candidate) === 0,
    scoreGainAtLeast3Points: comparison.scoreRateGainPer10000 >= 300,
    starDeltaImprovesAtLeast136: comparison.starDeltaGain >= 136,
    lossToWinExceedsWinToLoss: comparison.lossToWin > comparison.winToLoss,
    singleCrashLossIncreaseAtMost14: comparison.singleCrashLossDelta <= 14,
    atLeastTwoVariantsImprove: comparison.improvedVariants >= 2,
    noVariantDropsMoreThan2Points: comparison.worstVariantDelta >= -200
  };
  return { status: Object.values(checks).every(Boolean) ? "PASS" : "FAIL", checks };
}

function fixedScenarioEntries(baseline) {
  const byId = new Map();
  for (const record of baseline.records.values()) {
    const prior = byId.get(record.historicalMatchUrlId);
    if (prior) invariant(prior === record.scenarioFingerprint,
      "SS_A0_SCENARIO_FINGERPRINT_CONFLICT", record.historicalMatchUrlId);
    else byId.set(record.historicalMatchUrlId, record.scenarioFingerprint);
  }
  const entries = [...byId].map(([id, fingerprint]) => ({ id, fingerprint }))
    .sort((left, right) => left.id.localeCompare(right.id));
  invariant(entries.length === DISCOVERY_SCENARIOS + HOLDOUT_SCENARIOS,
    "SS_A0_FIXED_SCENARIO_DENOMINATOR", String(entries.length));
  return entries;
}

function loadFixedScenarioIndex(root) {
  const manifestFile = contained(root, "artifacts", "retention", "gr0", "baselines",
    FIXED_BASELINE_ID, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  invariant(manifest.status === "COMPACTED" &&
    manifest.fingerprint === fingerprintObject(manifest),
  "SS_A0_FIXED_BASELINE_MANIFEST", FIXED_BASELINE_ID);
  const compactFile = contained(root, manifest.compact.relativePath);
  const bytes = fs.readFileSync(compactFile);
  invariant(bytes.length === manifest.compact.size &&
    sha256Bytes(bytes) === manifest.compact.sha256,
  "SS_A0_FIXED_BASELINE_BYTES", FIXED_BASELINE_ID);
  const byId = new Map();
  for (const line of zlib.gunzipSync(bytes).toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    const record = JSON.parse(line);
    const prior = byId.get(record.historicalMatchUrlId);
    if (prior) invariant(prior === record.scenarioFingerprint,
      "SS_A0_SCENARIO_FINGERPRINT_CONFLICT", record.historicalMatchUrlId);
    else byId.set(record.historicalMatchUrlId, record.scenarioFingerprint);
  }
  const scenarios = [...byId].map(([id, fingerprint]) => ({ id, fingerprint }))
    .sort((left, right) => left.id.localeCompare(right.id));
  invariant(scenarios.length === DISCOVERY_SCENARIOS + HOLDOUT_SCENARIOS,
    "SS_A0_FIXED_SCENARIO_DENOMINATOR", String(scenarios.length));
  return { scenarios, baseline: {
    baselineId: FIXED_BASELINE_ID,
    manifestFingerprint: manifest.fingerprint,
    compactSha256: manifest.compact.sha256
  } };
}

function splitScenarioIds(entries) {
  const ranked = entries.map(entry => ({
    id: entry.id,
    fingerprint: entry.fingerprint,
    rank: sha256Text(`${entry.fingerprint}\0${SPLIT_SALT}`)
  })).sort((left, right) => left.rank.localeCompare(right.rank) ||
    left.id.localeCompare(right.id));
  const discovery = ranked.slice(0, DISCOVERY_SCENARIOS).map(item => item.id);
  const holdout = ranked.slice(DISCOVERY_SCENARIOS).map(item => item.id);
  const discoveryEntries = ranked.slice(0, DISCOVERY_SCENARIOS)
    .map(item => ({ id: item.id, fingerprint: item.fingerprint }));
  const holdoutEntries = ranked.slice(DISCOVERY_SCENARIOS)
    .map(item => ({ id: item.id, fingerprint: item.fingerprint }));
  invariant(new Set([...discovery, ...holdout]).size === entries.length,
    "SS_A0_SPLIT_OVERLAP", String(entries.length));
  return {
    discovery,
    holdout,
    discoveryFingerprint: fingerprintObject({ salt: SPLIT_SALT, scenarios: discoveryEntries }),
    holdoutFingerprint: fingerprintObject({ salt: SPLIT_SALT, scenarios: holdoutEntries }),
    completeFingerprint: fingerprintObject({ salt: SPLIT_SALT,
      scenarios: entries.slice().sort((left, right) => left.id.localeCompare(right.id)) })
  };
}

function engineOptions(frozen, mode) {
  const options = v2Options(frozen.manifest.parameters);
  options.engine.diagnosticSoftMode = mode;
  return options;
}

async function executeLane(context, phase, mode, scenarios, repetitions, progress) {
  const records = [];
  const total = scenarios.length * repetitions * VARIANTS.length;
  for (const scenario of scenarios)
    for (let repetition = 0; repetition < repetitions; repetition += 1)
      for (const variant of VARIANTS) {
        const match = await runMatch(context.simulator.module, scenario, variant, repetition,
          context.v1Code, context.timeoutMs, engineOptions(context.frozen, mode),
          { captureCompact: true });
        records.push(compactMatch(match, phase, mode));
        if (progress && (records.length % progress === 0 || records.length === total))
          context.onProgress?.({ phase, mode, completed: records.length, total,
            scenario: scenario.matchUrlId, variant: variant.variantId });
      }
  return records;
}

async function loadContext(root, scenarioIds, options = {}) {
  const frozen = loadFrozenCandidate(root, options.candidateManifest);
  const v1Code = fs.readFileSync(frozen.v1File, "utf8");
  const rolling = loadRollingV1ScenariosForIds(scenarioIds, root);
  const simulator = await loadSimulator(root);
  return {
    root,
    frozen,
    v1Code,
    rolling,
    scenarios: rolling.scenarios,
    simulator,
    timeoutMs: Math.max(20, Math.floor(Number(options.timeoutMs) || 200)),
    onProgress: options.onProgress
  };
}

function defaultOutput(root) {
  const id = sha256Text(`${ANCHOR_COMMIT}\0${SPLIT_SALT}\0SEALED_SELECTIVE_V1`).slice(0, 16);
  return contained(root, "artifacts", "diagnostics", "soft-stack-ablation", `ss-a0-${id}`);
}

function artifactFiles(output) {
  return Object.fromEntries(FILES.map(name => [name, path.join(output, name)]));
}

function assertOnlyEvidenceFiles(output) {
  const actual = fs.readdirSync(output).filter(name => !name.startsWith(".")).sort();
  invariant(JSON.stringify(actual) === JSON.stringify(FILES.slice().sort()),
    "SS_A0_UNEXPECTED_OUTPUT_FILE", actual.join(","));
}

function productionIdentity(root) {
  const engineSource = sourceIdentity(root);
  invariant(engineSource.sha256 === ANCHOR_ENGINE_SOURCE_SHA256,
    "SS_A0_ENGINE_SOURCE_NOT_ANCHORED", engineSource.sha256);
  return {
    anchorCommit: ANCHOR_COMMIT,
    engineSource,
    productionBuild: {
      sourceSha256: ANCHOR_SOURCE_SHA256,
      minifiedSha256: ANCHOR_MINIFIED_SHA256
    }
  };
}

function fileDescriptor(root, file, records = undefined) {
  const bytes = fs.readFileSync(file);
  return {
    relativePath: relative(root, file),
    size: bytes.length,
    sha256: sha256Bytes(bytes),
    ...(records === undefined ? {} : { records })
  };
}

function writeEvidence(root, output, overview, matches, samples) {
  ensureDirectory(output);
  const files = artifactFiles(output);
  const matchArtifact = outputArtifact(files["matches.ndjson.gz"], matches);
  const sampleArtifact = outputArtifact(files["diagnostic-samples.ndjson.gz"], samples);
  overview.fingerprint = fingerprintObject(overview);
  writeJsonAtomic(files["overview.json"], overview, { mode: 0o644 });
  const manifest = {
    schemaVersion: 1,
    objectKind: "SoftStackAblationManifestV1",
    status: overview.status,
    anchorCommit: ANCHOR_COMMIT,
    source: overview.source,
    split: overview.split,
    files: {
      overview: fileDescriptor(root, files["overview.json"]),
      matches: fileDescriptor(root, files["matches.ndjson.gz"], matchArtifact.records),
      diagnosticSamples: fileDescriptor(root, files["diagnostic-samples.ndjson.gz"],
        sampleArtifact.records)
    },
    totalBytes: 0,
    storageBudgetBytes: ARTIFACT_BUDGET,
    fingerprint: ""
  };
  writeJsonAtomic(files["manifest.json"], manifest, { mode: 0o644 });
  manifest.totalBytes = FILES.reduce((sum, name) => sum + fs.statSync(files[name]).size, 0);
  invariant(manifest.totalBytes <= ARTIFACT_BUDGET, "SS_A0_STORAGE_BUDGET",
    String(manifest.totalBytes));
  manifest.fingerprint = fingerprintObject(manifest);
  writeJsonAtomic(files["manifest.json"], manifest, { mode: 0o644 });
  manifest.totalBytes = FILES.reduce((sum, name) => sum + fs.statSync(files[name]).size, 0);
  manifest.fingerprint = fingerprintObject(manifest);
  writeJsonAtomic(files["manifest.json"], manifest, { mode: 0o644 });
  assertOnlyEvidenceFiles(output);
  return { manifest, files };
}

function discoveryRanking(results) {
  return Object.values(results).filter(item => item.mode !== SOFT_MODE.CURRENT &&
      item.gate.status === "PASS").sort((left, right) =>
    right.comparison.scoreRateGainPer10000 - left.comparison.scoreRateGainPer10000 ||
    right.comparison.starDeltaGain - left.comparison.starDeltaGain ||
    left.comparison.singleCrashLossDelta - right.comparison.singleCrashLossDelta ||
    left.comparison.behaviorChanges - right.comparison.behaviorChanges ||
    MODES.indexOf(left.mode) - MODES.indexOf(right.mode));
}

async function discover(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const output = path.resolve(options.output || defaultOutput(root));
  invariant(!fs.existsSync(output) || fs.readdirSync(output).length === 0,
    "SS_A0_OUTPUT_NOT_EMPTY", output);
  const fixed = loadFixedScenarioIndex(root);
  const split = splitScenarioIds(fixed.scenarios);
  const context = await loadContext(root, split.discovery, options);
  const scenarios = context.scenarios;
  const records = [];
  const byMode = {};
  for (const mode of MODES) {
    const lane = await executeLane(context, "DISCOVERY", mode, scenarios,
      DISCOVERY_REPETITIONS, options.progressEvery || 32);
    byMode[mode] = lane;
    records.push(...lane);
  }
  const current = byMode[SOFT_MODE.CURRENT];
  const results = {};
  for (const mode of MODES) {
    const comparison = compareModes(current, byMode[mode]);
    results[mode] = {
      mode,
      flags: MODE_FLAGS[mode],
      comparison,
      gate: mode === SOFT_MODE.CURRENT ? { status: "REFERENCE", checks: {} } :
        discoveryGate(comparison)
    };
  }
  const ranking = discoveryRanking(results);
  const winner = ranking.length ? ranking[0].mode : null;
  const source = productionIdentity(root);
  const overview = {
    schemaVersion: 1,
    objectKind: "SoftStackAblationOverviewV1",
    experimentId: "SS-A0",
    status: winner ? "DISCOVERY_PASS" : "DISCOVERY_REJECTED",
    source,
    candidate: {
      candidateId: context.frozen.manifest.candidateId,
      candidateFingerprint: context.frozen.manifest.fingerprint,
      frozenV1Sha256: context.frozen.manifest.selection.v1Sha256
    },
    split: {
      salt: SPLIT_SALT,
      fixedScenarioCount: DISCOVERY_SCENARIOS + HOLDOUT_SCENARIOS,
      discoveryScenarioCount: DISCOVERY_SCENARIOS,
      holdoutScenarioCount: HOLDOUT_SCENARIOS,
      discoveryFingerprint: split.discoveryFingerprint,
      holdoutFingerprint: split.holdoutFingerprint,
      completeFingerprint: split.completeFingerprint,
      discoveryScenarioIds: split.discovery,
      baseline: fixed.baseline,
      selectiveLoader: {
        sourceIndex: context.rolling.sourceIndex,
        loadedScenarioCount: context.scenarios.length,
        holdoutScenarioPayloadsLoaded: 0
      }
    },
    discovery: {
      repetitions: DISCOVERY_REPETITIONS,
      variants: VARIANTS.map(variant => variant.variantId),
      matchesPerMode: DISCOVERY_SCENARIOS * VARIANTS.length * DISCOVERY_REPETITIONS,
      totalMatches: records.length,
      modes: results,
      ranking: ranking.map(item => item.mode),
      winner,
      conclusion: winner ? "HOLDOUT_ELIGIBLE" :
        "SOFT_STACK_NOT_PROVEN_AS_PRIMARY_CAUSE"
    },
    holdout: null,
    evidenceBoundary: {
      productionSemanticsChanged: false,
      officialSimulation: false,
      publishAuthorized: false,
      full6608ArenaRun: false
    },
    fingerprint: ""
  };
  const written = writeEvidence(root, output, overview, records, []);
  return { output, overview, manifest: written.manifest };
}

function loadOverview(output) {
  const file = path.join(output, "overview.json");
  invariant(fs.existsSync(file), "SS_A0_OVERVIEW_MISSING", file);
  const overview = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(overview.fingerprint === fingerprintObject(overview),
    "SS_A0_OVERVIEW_FINGERPRINT", file);
  return overview;
}

function loadDiscovery(output) {
  const overview = loadOverview(output);
  invariant(overview.status === "DISCOVERY_PASS" && overview.discovery?.winner,
    "SS_A0_HOLDOUT_NOT_ELIGIBLE", overview.status);
  invariant(overview.holdout === null, "SS_A0_HOLDOUT_ALREADY_RUN", output);
  const records = readGzipNdjson(path.join(output, "matches.ndjson.gz"));
  invariant(records.length === MODES.length * DISCOVERY_SCENARIOS *
    VARIANTS.length * DISCOVERY_REPETITIONS, "SS_A0_DISCOVERY_DENOMINATOR",
  String(records.length));
  return { overview, records };
}

function compareSr4(baseline, currentRecords, candidateRecords) {
  const current = indexRecords(currentRecords);
  const candidate = indexRecords(candidateRecords);
  let comparableMatches = 0;
  let sr4ScoreUnits = 0;
  let currentScoreUnits = 0;
  let candidateScoreUnits = 0;
  let sr4WinToCurrentLoss = 0;
  let recoveredToWin = 0;
  let recoveredToDraw = 0;
  let currentWinsBroken = 0;
  const units = outcome => outcome === "V2_WIN" ? 2 : outcome === "DRAW" ? 1 : 0;
  for (const before of baseline.records.values()) {
    const key = `${before.historicalMatchUrlId}\0${before.variantId}\0${before.repetition}`;
    const now = current.get(key);
    const after = candidate.get(key);
    if (!now || !after) continue;
    comparableMatches += 1;
    sr4ScoreUnits += units(before.analysisOutcome);
    currentScoreUnits += units(now.analysisOutcome);
    candidateScoreUnits += units(after.analysisOutcome);
    if (before.analysisOutcome === "V2_WIN" && now.analysisOutcome === "V1_WIN") {
      sr4WinToCurrentLoss += 1;
      if (after.analysisOutcome === "V2_WIN") recoveredToWin += 1;
      else if (after.analysisOutcome === "DRAW") recoveredToDraw += 1;
    }
    if (now.analysisOutcome === "V2_WIN" && after.analysisOutcome !== "V2_WIN")
      currentWinsBroken += 1;
  }
  const currentGap = sr4ScoreUnits - currentScoreUnits;
  const restored = candidateScoreUnits - currentScoreUnits;
  return {
    baselineId: baseline.baselineId,
    comparableMatches,
    sr4ScoreUnits,
    currentScoreUnits,
    candidateScoreUnits,
    sr4WinToCurrentLoss,
    recoveredToWin,
    recoveredToDraw,
    currentWinsBroken,
    restoredScoreUnits: restored,
    currentGapScoreUnits: currentGap,
    gapRecoveryPer10000: currentGap > 0 ? Math.floor(restored * 10000 / currentGap) : 0
  };
}

function sampleCategories(current, candidate) {
  const categories = [];
  if (current.analysisOutcome === "V1_WIN" && candidate.analysisOutcome === "V2_WIN")
    categories.push("IMPROVEMENT");
  if (current.analysisOutcome === "V2_WIN" && candidate.analysisOutcome !== "V2_WIN")
    categories.push("REGRESSION");
  if (starDelta(candidate) > starDelta(current)) categories.push("STAR_RECOVERY");
  if (!isV2SingleCrashLoss(current) && isV2SingleCrashLoss(candidate))
    categories.push("CRASH_REGRESSION");
  return categories;
}

function selectSamplePairs(currentRecords, candidateRecords) {
  const current = indexRecords(currentRecords);
  const categoryCounts = {};
  const selected = [];
  const seen = new Set();
  for (const candidate of candidateRecords.slice().sort((left, right) =>
    recordKey(left).localeCompare(recordKey(right)))) {
    const before = current.get(recordKey(candidate));
    if (!before) continue;
    const eligible = sampleCategories(before, candidate).filter(category =>
      (categoryCounts[category] || 0) < PER_SAMPLE_CATEGORY_LIMIT);
    if (!eligible.length || selected.length >= SAMPLE_LIMIT) continue;
    const key = recordKey(candidate);
    if (!seen.has(key)) {
      selected.push({ current: before, candidate, categories: eligible.slice() });
      seen.add(key);
    }
    for (const category of eligible) addCount(categoryCounts, category);
  }
  return { selected, categoryCounts };
}

function strippedFrame(frame) {
  return {
    frame: frame.frame,
    action: frame.action,
    root: frame.root,
    selectedHard: frame.selectedHard,
    allowCount: frame.allowCount,
    proof: frame.proof,
    informationComplete: frame.informationComplete,
    informationCompletedDepth: frame.informationCompletedDepth,
    informationWorlds: frame.informationWorlds,
    possibleProjectileCount: frame.possibleProjectileCount,
    possibleProjectileRisk: frame.possibleProjectileRisk,
    candidates: (frame.candidates || []).map(candidate => ({
      action: candidate.action,
      hard: candidate.hard,
      safety: candidate.safety,
      immediateFatalMass: candidate.immediateFatalMass,
      horizonFatalMass: candidate.horizonFatalMass,
      unknownMass: candidate.unknownMass,
      escapeSlack: candidate.escapeSlack,
      acceptable: candidate.acceptable,
      dominated: candidate.dominated,
      robustLower: candidate.robustLower,
      score: candidate.score,
      depthScore: candidate.depthScore,
      informationScore: candidate.informationScore,
      tacticalValue: candidate.tacticalValue,
      policyProbability: candidate.policyProbability
    }))
  };
}

function firstDivergence(currentFrames, candidateFrames) {
  const candidateByFrame = new Map(candidateFrames.map(frame => [frame.frame, frame]));
  for (const current of currentFrames) {
    const candidate = candidateByFrame.get(current.frame);
    if (candidate && current.action !== candidate.action)
      return { frame: current.frame, current: strippedFrame(current),
        candidate: strippedFrame(candidate) };
  }
  return null;
}

async function buildSamples(context, pairs, winner) {
  const scenarioById = new Map(context.scenarios.map(scenario =>
    [scenario.matchUrlId, scenario]));
  const variantById = new Map(VARIANTS.map(variant => [variant.variantId, variant]));
  const samples = [];
  for (const pair of pairs) {
    const scenario = scenarioById.get(pair.candidate.historicalMatchUrlId);
    const variant = variantById.get(pair.candidate.variantId);
    invariant(scenario && variant, "SS_A0_SAMPLE_INPUT_MISSING", pair.candidate.matchId);
    const current = await runMatch(context.simulator.module, scenario, variant,
      pair.candidate.repetition, context.v1Code, context.timeoutMs,
      engineOptions(context.frozen, SOFT_MODE.CURRENT), { captureAllFrames: true });
    const candidate = await runMatch(context.simulator.module, scenario, variant,
      pair.candidate.repetition, context.v1Code, context.timeoutMs,
      engineOptions(context.frozen, winner), { captureAllFrames: true });
    const divergence = firstDivergence(current.v2.diagnosticFrames || [],
      candidate.v2.diagnosticFrames || []);
    if (!divergence) continue;
    samples.push({
      schemaVersion: 1,
      objectKind: "SoftStackAblationFirstDivergenceV1",
      categories: pair.categories,
      matchId: pair.candidate.matchId,
      historicalMatchUrlId: pair.candidate.historicalMatchUrlId,
      scenarioFingerprint: pair.candidate.scenarioFingerprint,
      variantId: pair.candidate.variantId,
      repetition: pair.candidate.repetition,
      currentOutcome: pair.current.analysisOutcome,
      candidateOutcome: pair.candidate.analysisOutcome,
      currentStarDelta: starDelta(pair.current),
      candidateStarDelta: starDelta(pair.candidate),
      firstDivergence: divergence
    });
  }
  return samples;
}

async function validate(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const output = path.resolve(options.output || defaultOutput(root));
  const discovery = loadDiscovery(output);
  const fixed = loadFixedScenarioIndex(root);
  const split = splitScenarioIds(fixed.scenarios);
  invariant(discovery.overview.split.discoveryFingerprint === split.discoveryFingerprint &&
    discovery.overview.split.holdoutFingerprint === split.holdoutFingerprint,
  "SS_A0_SPLIT_DRIFT", output);
  const context = await loadContext(root, split.holdout, options);
  invariant(discovery.overview.source.engineSource.sha256 === sourceIdentity(root).sha256,
    "SS_A0_SOURCE_DRIFT", output);
  const winner = discovery.overview.discovery.winner;
  const scenarios = context.scenarios;
  const currentRecords = await executeLane(context, "HOLDOUT", SOFT_MODE.CURRENT,
    scenarios, HOLDOUT_REPETITIONS, options.progressEvery || 32);
  const candidateRecords = await executeLane(context, "HOLDOUT", winner,
    scenarios, HOLDOUT_REPETITIONS, options.progressEvery || 32);
  const comparison = compareModes(currentRecords, candidateRecords);
  const gate = holdoutGate(comparison);
  const baseline = await loadLegacyBaseline(root, FIXED_BASELINE_ID);
  const sr4 = compareSr4(baseline, currentRecords, candidateRecords);
  const selection = selectSamplePairs(currentRecords, candidateRecords);
  const samples = await buildSamples(context, selection.selected, winner);
  const records = [...discovery.records, ...currentRecords, ...candidateRecords];
  const overview = {
    ...discovery.overview,
    status: gate.status === "PASS" ? "HOLDOUT_ACCEPTED" : "HOLDOUT_REJECTED",
    split: {
      ...discovery.overview.split,
      holdoutScenarioIds: split.holdout,
      holdoutSelectiveLoader: {
        sourceIndex: context.rolling.sourceIndex,
        loadedScenarioCount: context.scenarios.length
      }
    },
    holdout: {
      winner,
      repetitions: HOLDOUT_REPETITIONS,
      variants: VARIANTS.map(variant => variant.variantId),
      matchesPerMode: HOLDOUT_SCENARIOS * VARIANTS.length * HOLDOUT_REPETITIONS,
      totalMatches: currentRecords.length + candidateRecords.length,
      comparison,
      gate,
      sr4Comparison: sr4,
      diagnosticSamples: {
        selectedPairs: selection.selected.length,
        emitted: samples.length,
        categoryCounts: selection.categoryCounts
      },
      conclusion: gate.status === "PASS" ?
        "SOFT_STACK_CAUSAL_EFFECT_CONFIRMED_ON_HOLDOUT" :
        "SOFT_STACK_CAUSAL_EFFECT_NOT_CONFIRMED_ON_HOLDOUT"
    },
    fingerprint: ""
  };
  const written = writeEvidence(root, output, overview, records, samples);
  return { output, overview, manifest: written.manifest };
}

function expectedCounts(overview) {
  const counts = {
    discovery: MODES.length * DISCOVERY_SCENARIOS * VARIANTS.length * DISCOVERY_REPETITIONS,
    holdout: overview.holdout ?
      2 * HOLDOUT_SCENARIOS * VARIANTS.length * HOLDOUT_REPETITIONS : 0
  };
  counts.total = counts.discovery + counts.holdout;
  return counts;
}

async function verify(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const output = path.resolve(options.output || defaultOutput(root));
  assertOnlyEvidenceFiles(output);
  const files = artifactFiles(output);
  const overview = loadOverview(output);
  const manifest = JSON.parse(fs.readFileSync(files["manifest.json"], "utf8"));
  invariant(manifest.fingerprint === fingerprintObject(manifest),
    "SS_A0_MANIFEST_FINGERPRINT", output);
  const records = readGzipNdjson(files["matches.ndjson.gz"]);
  const samples = readGzipNdjson(files["diagnostic-samples.ndjson.gz"]);
  const counts = expectedCounts(overview);
  invariant(records.length === counts.total, "SS_A0_MATCH_DENOMINATOR",
    `${records.length}/${counts.total}`);
  invariant(samples.length <= SAMPLE_LIMIT, "SS_A0_SAMPLE_DENOMINATOR", String(samples.length));
  const descriptors = {
    overview: fileDescriptor(root, files["overview.json"]),
    matches: fileDescriptor(root, files["matches.ndjson.gz"], records.length),
    diagnosticSamples: fileDescriptor(root, files["diagnostic-samples.ndjson.gz"], samples.length)
  };
  for (const key of Object.keys(descriptors))
    invariant(JSON.stringify(descriptors[key]) === JSON.stringify(manifest.files[key]),
      "SS_A0_ARTIFACT_HASH_MISMATCH", key);
  const totalBytes = FILES.reduce((sum, name) => sum + fs.statSync(files[name]).size, 0);
  invariant(totalBytes === manifest.totalBytes && totalBytes <= ARTIFACT_BUDGET,
    "SS_A0_STORAGE_BUDGET", `${totalBytes}/${manifest.totalBytes}`);
  const source = productionIdentity(root);
  invariant(source.engineSource.sha256 === overview.source.engineSource.sha256,
    "SS_A0_ENGINE_SOURCE_DRIFT", source.engineSource.sha256);
  invariant(overview.source.anchorCommit === ANCHOR_COMMIT &&
    overview.source.productionBuild.sourceSha256 === ANCHOR_SOURCE_SHA256 &&
    overview.source.productionBuild.minifiedSha256 === ANCHOR_MINIFIED_SHA256,
  "SS_A0_PRODUCTION_ANCHOR_DRIFT", overview.source.anchorCommit);
  const baseline = await loadLegacyBaseline(root, FIXED_BASELINE_ID);
  const split = splitScenarioIds(fixedScenarioEntries(baseline));
  invariant(split.discoveryFingerprint === overview.split.discoveryFingerprint &&
    split.holdoutFingerprint === overview.split.holdoutFingerprint &&
    split.completeFingerprint === overview.split.completeFingerprint,
  "SS_A0_SPLIT_EVIDENCE_DRIFT", output);
  invariant(overview.split.selectiveLoader?.loadedScenarioCount === DISCOVERY_SCENARIOS &&
    overview.split.selectiveLoader?.holdoutScenarioPayloadsLoaded === 0 &&
    overview.split.selectiveLoader?.sourceIndex?.requestedMatches === DISCOVERY_SCENARIOS,
  "SS_A0_DISCOVERY_PAYLOAD_ISOLATION", JSON.stringify(overview.split.selectiveLoader || null));
  const discoveryRecords = records.filter(record => record.phase === "DISCOVERY");
  const discoveryByMode = Object.fromEntries(MODES.map(mode =>
    [mode, discoveryRecords.filter(record => record.mode === mode)]));
  const currentDiscovery = discoveryByMode[SOFT_MODE.CURRENT];
  for (const mode of MODES) {
    const recomputed = compareModes(currentDiscovery, discoveryByMode[mode]);
    invariant(fingerprintObject(recomputed) ===
      fingerprintObject(overview.discovery.modes[mode].comparison),
    "SS_A0_DISCOVERY_SUMMARY_MISMATCH", mode);
  }
  if (overview.holdout) {
    const holdoutRecords = records.filter(record => record.phase === "HOLDOUT");
    const current = holdoutRecords.filter(record => record.mode === SOFT_MODE.CURRENT);
    const candidate = holdoutRecords.filter(record => record.mode === overview.holdout.winner);
    const recomputed = compareModes(current, candidate);
    invariant(fingerprintObject(recomputed) ===
      fingerprintObject(overview.holdout.comparison),
    "SS_A0_HOLDOUT_SUMMARY_MISMATCH", overview.holdout.winner);
  }
  return {
    status: "VERIFIED",
    experimentStatus: overview.status,
    output,
    matches: records.length,
    samples: samples.length,
    totalBytes,
    fingerprint: manifest.fingerprint
  };
}

module.exports = {
  ANCHOR_COMMIT,
  ANCHOR_ENGINE_SOURCE_SHA256,
  ANCHOR_SOURCE_SHA256,
  ANCHOR_MINIFIED_SHA256,
  FIXED_BASELINE_ID,
  SPLIT_SALT,
  DISCOVERY_SCENARIOS,
  HOLDOUT_SCENARIOS,
  DISCOVERY_REPETITIONS,
  HOLDOUT_REPETITIONS,
  MODES,
  ARTIFACT_BUDGET,
  readGzipNdjson,
  gzipNdjson,
  compactMatch,
  summaryFor,
  compareModes,
  discoveryGate,
  holdoutGate,
  splitScenarioIds,
  loadFixedScenarioIndex,
  discover,
  validate,
  verify
};
