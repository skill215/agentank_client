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
const { sourceIdentity } = require("./v1-v2-working-arena");
const { loadFixedScenarioIndex, splitScenarioIds } = require("./soft-stack-ablation");
const { STRATEGY_PRIORITY_MODE, MODES, VALID_MODES } =
  require("./strategy-priority-runtime");

const EXPERIMENT_ID = "STRAT2-FIRE-PRIORITY-SAMPLE-V1";
const SAMPLE_SALT = "STRAT2-FIRE-PRIORITY-DISCOVERY-32-V1";
const SAMPLE_SCENARIOS = 32;
const REPETITIONS = 1;
const STORAGE_BUDGET = 2 * 1024 * 1024;

function addCount(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function rate(numerator, denominator) {
  return denominator > 0 ? Math.floor(numerator * 10000 / denominator) : 0;
}

function gzipNdjson(records) {
  const text = records.length ? `${records.map(item => JSON.stringify(item)).join("\n")}\n` : "";
  return zlib.gzipSync(Buffer.from(text), { level: 9, mtime: 0 });
}

function selectScenarios(fixed, options = {}) {
  const scenarioCount = Number.isSafeInteger(options.scenarioCount) ?
    options.scenarioCount : SAMPLE_SCENARIOS;
  const scenarioOffset = Number.isSafeInteger(options.scenarioOffset) ?
    options.scenarioOffset : 0;
  const sampleSalt = options.sampleSalt || SAMPLE_SALT;
  invariant(scenarioCount > 0 && scenarioOffset >= 0,
    "STRAT2_SAMPLE_WINDOW_INVALID", `${scenarioOffset}:${scenarioCount}`);
  const split = splitScenarioIds(fixed.scenarios);
  const discovery = new Set(split.discovery);
  const selected = fixed.scenarios.filter(item => discovery.has(item.id)).map(item => ({
    ...item,
    rank: sha256Text(`${item.fingerprint}\0${sampleSalt}`)
  })).sort((left, right) => left.rank.localeCompare(right.rank) ||
    left.id.localeCompare(right.id)).slice(scenarioOffset, scenarioOffset + scenarioCount);
  invariant(selected.length === scenarioCount, "STRAT2_SAMPLE_DENOMINATOR",
    String(selected.length));
  for (const item of selected)
    invariant(!split.holdout.includes(item.id), "STRAT2_SAMPLE_HOLDOUT_READ", item.id);
  return { ids: selected.map(item => item.id), entries: selected.map(item => ({
    id: item.id, fingerprint: item.fingerprint
  })), split };
}

function engineOptions(frozen, mode) {
  const options = v2Options(frozen.manifest.parameters);
  options.engine.diagnosticStrategyMode = mode;
  return options;
}

function compactMatch(match, mode) {
  const classified = classifyAnalysisOutcome(match);
  return {
    schemaVersion: 1,
    objectKind: "StrategyPrioritySampleMatchV1",
    mode,
    matchId: match.matchId,
    historicalMatchUrlId: match.historicalMatchUrlId,
    scenarioFingerprint: match.scenarioFingerprint,
    variantId: match.variantId,
    family: match.family,
    repetition: match.repetition,
    v2Seat: match.v2Seat,
    seatSkills: match.seatSkills,
    analysisOutcome: classified.analysisOutcome,
    terminalCategory: classified.terminalCategory,
    frames: match.frames,
    stars: classified.stars,
    crashes: classified.crashes,
    bullets: match.counts.bullets,
    v2ActionCounts: match.v2.actionCounts,
    v2DecisionCount: match.v2.decisionCount,
    v2TotalRuntimeMicros: match.v2.totalRuntimeMicros,
    v2P95RuntimeMicros: match.v2.p95RuntimeMicros,
    strategyPriority: match.v2.strategyPriority,
    invariants: {
      avoidableHardRejects: match.v2.layerTotals.avoidableHardRejects,
      riskDominatedSelections: match.v2.layerTotals.riskDominatedSelections,
      rootRestoreFailures: match.v2.layerTotals.depthRootRestoreFailures,
      timeoutCount: match.v2.timeoutCount || 0,
      errorCount: match.v2.errorCount || 0
    }
  };
}

function emptyStrategyTotals() {
  return {
    roots: 0,
    eligibleRoots: 0,
    qualifiedFireOpportunityRoots: 0,
    qualifiedFirePrimaryRoots: 0,
    qualifiedFireInSelectedBandRoots: 0,
    qualifiedFireChosenRoots: 0,
    qualifiedFireMissedRoots: 0,
    possibleHitOpportunityRoots: 0,
    possibleHitInSelectedBandRoots: 0,
    possibleHitFireChosenRoots: 0,
    setupOpportunityRoots: 0,
    attackOpportunityRoots: 0,
    attackPurposeChosenRoots: 0,
    fireChosenRoots: 0,
    purposefulFireChosenRoots: 0,
    purposelessFireChosenRoots: 0,
    anyPurposeFireChosenRoots: 0,
    planContinuationFireChosenRoots: 0,
    visibleFireChosenRoots: 0,
    hiddenFireChosenRoots: 0,
    visibleMissFireChosenRoots: 0,
    hiddenNoBeliefFireChosenRoots: 0,
    fireInsideSelectedBandRoots: 0,
    fireOutsideSelectedBandRoots: 0,
    forcedProofFireChosenRoots: 0,
    finalGateOverrideFireChosenRoots: 0,
    noAcceptableFireChosenRoots: 0,
    starPurposeChosenRoots: 0,
    projectileAttackEvaluations: 0,
    projectileAttackReverseBuilds: 0,
    projectileAttackCacheHits: 0,
    projectileAttackCompleteRows: 0,
    projectileAttackIncompleteRows: 0,
    projectileAttackDoomedCells: 0,
    projectileFrontierDistanceBuilds: 0,
    projectileFrontierBuilds: 0,
    projectileFrontierPressureCells: 0,
    projectileFrontierSetupDelay: 0,
    projectileFrontierMobilityLoss: 0,
    projectileFrontierEndpointReduction: 0,
    projectileFrontierIncomplete: 0,
    ownershipPoc: { recoveredRiskRoots: 0, recoveredRiskRows: 0,
      strategicSelections: 0, tacticalSelections: 0, escapeSelections: 0,
      recoverRisk: 0, routeOwnership: 0, strategicRecoveryOnly: 0 },
    proposalVerification: { enabled: 0, goalArbitration: 0, buildCount: 0,
      verifyCount: 0, selectCount: 0, guardOverrideCount: 0,
      goalOverrideCount: 0, refutedCount: 0, unknownCount: 0,
      viableCount: 0, certifiedCount: 0, hotAllocationCount: 0 },
    strategyCounts: {},
    selectedBandCounts: {}
  };
}

function summarize(records) {
  const output = {
    matches: records.length,
    scenarios: new Set(records.map(item => item.historicalMatchUrlId)).size,
    v2Wins: 0, v1Wins: 0, draws: 0, scoreUnits: 0, scoreRatePer10000: 0,
    starDelta: 0, v2SingleCrashWins: 0, v2SingleCrashLosses: 0,
    decisions: 0, fireActions: 0, bulletsCreated: 0,
    totalRuntimeMicros: 0, p95MatchRuntimeMicros: 0, p95CallbackMicros: 0,
    actionCounts: {}, terminalCategories: {}, variants: {},
    invariants: { avoidableHardRejects: 0, riskDominatedSelections: 0,
      rootRestoreFailures: 0, timeoutCount: 0, errorCount: 0 },
    strategy: emptyStrategyTotals()
  };
  for (const record of records) {
    if (record.analysisOutcome === "V2_WIN") {
      output.v2Wins += 1; output.scoreUnits += 2;
    } else if (record.analysisOutcome === "V1_WIN") output.v1Wins += 1;
    else { output.draws += 1; output.scoreUnits += 1; }
    output.starDelta += record.stars[record.v2Seat] - record.stars[record.v2Seat ^ 1];
    if (record.terminalCategory === "SINGLE_CRASH") {
      if (record.analysisOutcome === "V2_WIN") output.v2SingleCrashWins += 1;
      else if (record.analysisOutcome === "V1_WIN") output.v2SingleCrashLosses += 1;
    }
    output.decisions += record.v2DecisionCount;
    output.totalRuntimeMicros += record.v2TotalRuntimeMicros || 0;
    output.fireActions += record.v2ActionCounts.FIRE || 0;
    output.bulletsCreated += record.bullets[record.v2Seat] || 0;
    for (const [key, value] of Object.entries(record.v2ActionCounts))
      addCount(output.actionCounts, key, value);
    addCount(output.terminalCategories, record.terminalCategory);
    const variant = output.variants[record.variantId] ||
      (output.variants[record.variantId] = {
        matches: 0, v2Wins: 0, v1Wins: 0, draws: 0, scoreUnits: 0,
        scoreRatePer10000: 0, starDelta: 0
      });
    variant.matches += 1;
    variant.starDelta += record.stars[record.v2Seat] - record.stars[record.v2Seat ^ 1];
    if (record.analysisOutcome === "V2_WIN") {
      variant.v2Wins += 1; variant.scoreUnits += 2;
    } else if (record.analysisOutcome === "V1_WIN") variant.v1Wins += 1;
    else { variant.draws += 1; variant.scoreUnits += 1; }
    for (const key of Object.keys(output.invariants))
      output.invariants[key] += record.invariants[key] || 0;
    const strategy = record.strategyPriority;
    for (const key of Object.keys(output.strategy)) {
      if (key === "strategyCounts" || key === "selectedBandCounts" ||
          key === "ownershipPoc" || key === "proposalVerification") continue;
      output.strategy[key] += strategy[key] || 0;
    }
    if (strategy.ownershipPoc)
      for (const key of Object.keys(output.strategy.ownershipPoc))
        output.strategy.ownershipPoc[key] += strategy.ownershipPoc[key] || 0;
    if (strategy.proposalVerification)
      for (const key of Object.keys(output.strategy.proposalVerification))
        output.strategy.proposalVerification[key] +=
          strategy.proposalVerification[key] || 0;
    for (const [key, value] of Object.entries(strategy.strategyCounts || {}))
      addCount(output.strategy.strategyCounts, key, value);
    for (const [key, value] of Object.entries(strategy.selectedBandCounts || {}))
      addCount(output.strategy.selectedBandCounts, key, value);
  }
  output.scoreRatePer10000 = rate(output.scoreUnits, output.matches * 2);
  const matchRuntime = records.map(item => item.v2TotalRuntimeMicros || 0)
    .sort((left, right) => left - right);
  const callbackP95 = records.map(item => item.v2P95RuntimeMicros || 0)
    .sort((left, right) => left - right);
  const percentile95 = values => values.length ?
    values[Math.min(values.length - 1, Math.floor((values.length - 1) * 95 / 100))] : 0;
  output.p95MatchRuntimeMicros = percentile95(matchRuntime);
  output.p95CallbackMicros = percentile95(callbackP95);
  output.fireRatePer10000 = rate(output.fireActions, output.decisions);
  output.strategy.qualifiedFireBandRatePer10000 = rate(
    output.strategy.qualifiedFireInSelectedBandRoots,
    output.strategy.qualifiedFireOpportunityRoots);
  output.strategy.qualifiedFireConversionPer10000 = rate(
    output.strategy.qualifiedFireChosenRoots,
    output.strategy.qualifiedFireOpportunityRoots);
  output.strategy.attackConversionPer10000 = rate(
    output.strategy.attackPurposeChosenRoots,
    output.strategy.attackOpportunityRoots);
  output.strategy.purposefulFireRatePer10000 = rate(
    output.strategy.purposefulFireChosenRoots,
    output.strategy.fireChosenRoots);
  for (const variant of Object.values(output.variants))
    variant.scoreRatePer10000 = rate(variant.scoreUnits, variant.matches * 2);
  return output;
}

function recordKey(record) {
  return `${record.historicalMatchUrlId}\0${record.variantId}\0${record.repetition}`;
}

function compare(referenceRecords, candidateRecords) {
  const reference = summarize(referenceRecords);
  const candidate = summarize(candidateRecords);
  const before = new Map(referenceRecords.map(item => [recordKey(item), item]));
  const transitions = {};
  for (const item of candidateRecords) {
    const prior = before.get(recordKey(item));
    invariant(prior, "STRAT2_SAMPLE_PAIR_MISSING", item.matchId);
    addCount(transitions, `${prior.analysisOutcome}_TO_${item.analysisOutcome}`);
  }
  return {
    reference,
    candidate,
    deltas: {
      scoreRatePer10000: candidate.scoreRatePer10000 - reference.scoreRatePer10000,
      starDelta: candidate.starDelta - reference.starDelta,
      fireActions: candidate.fireActions - reference.fireActions,
      fireRatePer10000: candidate.fireRatePer10000 - reference.fireRatePer10000,
      totalRuntimeMicros: candidate.totalRuntimeMicros - reference.totalRuntimeMicros,
      p95MatchRuntimeMicros:
        candidate.p95MatchRuntimeMicros - reference.p95MatchRuntimeMicros,
      p95CallbackMicros: candidate.p95CallbackMicros - reference.p95CallbackMicros,
      qualifiedFireBandRatePer10000:
        candidate.strategy.qualifiedFireBandRatePer10000 -
        reference.strategy.qualifiedFireBandRatePer10000,
      qualifiedFireConversionPer10000:
        candidate.strategy.qualifiedFireConversionPer10000 -
        reference.strategy.qualifiedFireConversionPer10000,
      attackConversionPer10000:
        candidate.strategy.attackConversionPer10000 -
        reference.strategy.attackConversionPer10000,
      purposefulFireRatePer10000:
        candidate.strategy.purposefulFireRatePer10000 -
        reference.strategy.purposefulFireRatePer10000,
      possibleHitOpportunityRoots:
        candidate.strategy.possibleHitOpportunityRoots -
        reference.strategy.possibleHitOpportunityRoots,
      possibleHitFireChosenRoots:
        candidate.strategy.possibleHitFireChosenRoots -
        reference.strategy.possibleHitFireChosenRoots,
      projectileAttackReverseBuilds:
        candidate.strategy.projectileAttackReverseBuilds -
        reference.strategy.projectileAttackReverseBuilds,
      projectileAttackCompleteRows:
        candidate.strategy.projectileAttackCompleteRows -
        reference.strategy.projectileAttackCompleteRows,
      projectileAttackIncompleteRows:
        candidate.strategy.projectileAttackIncompleteRows -
        reference.strategy.projectileAttackIncompleteRows,
      projectileAttackDoomedCells:
        candidate.strategy.projectileAttackDoomedCells -
        reference.strategy.projectileAttackDoomedCells,
      projectileFrontierDistanceBuilds:
        candidate.strategy.projectileFrontierDistanceBuilds -
        reference.strategy.projectileFrontierDistanceBuilds,
      projectileFrontierBuilds:
        candidate.strategy.projectileFrontierBuilds -
        reference.strategy.projectileFrontierBuilds,
      projectileFrontierPressureCells:
        candidate.strategy.projectileFrontierPressureCells -
        reference.strategy.projectileFrontierPressureCells,
      projectileFrontierSetupDelay:
        candidate.strategy.projectileFrontierSetupDelay -
        reference.strategy.projectileFrontierSetupDelay,
      projectileFrontierMobilityLoss:
        candidate.strategy.projectileFrontierMobilityLoss -
        reference.strategy.projectileFrontierMobilityLoss,
      projectileFrontierEndpointReduction:
        candidate.strategy.projectileFrontierEndpointReduction -
        reference.strategy.projectileFrontierEndpointReduction,
      projectileFrontierIncomplete:
        candidate.strategy.projectileFrontierIncomplete -
        reference.strategy.projectileFrontierIncomplete,
      v2SingleCrashWins: candidate.v2SingleCrashWins - reference.v2SingleCrashWins,
      v2SingleCrashLosses: candidate.v2SingleCrashLosses - reference.v2SingleCrashLosses
    },
    transitions
  };
}

function invariantFailures(summary) {
  return Object.values(summary.invariants).reduce((sum, value) => sum + value, 0);
}

function conclusion(currentVsStar) {
  const delta = currentVsStar.deltas;
  const bandLift = -delta.qualifiedFireBandRatePer10000;
  const conversionLift = -delta.qualifiedFireConversionPer10000;
  return {
    status: bandLift > 0 && conversionLift > 0 ? "CONFIRMED" :
      bandLift > 0 || conversionLift > 0 ? "PARTIAL" : "NOT_OBSERVED",
    interpretation:
      "CURRENT is the candidate; FORCE_STAR_CONTROL is the same engine with only NORMAL-mode strategy forced to STAR_CONTROL.",
    currentLiftOverForcedStar: {
      qualifiedFireBandRatePer10000: bandLift,
      qualifiedFireConversionPer10000: conversionLift,
      fireRatePer10000: -delta.fireRatePer10000,
      attackConversionPer10000: -delta.attackConversionPer10000
    }
  };
}

function defaultOutput(root, source, scenarioFingerprint, modes, repetitions = REPETITIONS) {
  const id = sha256Text(`${EXPERIMENT_ID}\0${source.sha256}\0${scenarioFingerprint}\0` +
    `${modes.join(",")}\0${repetitions}`).slice(0, 16);
  return contained(root, "artifacts", "diagnostics", "strategy-priority-sample",
    `strat2-${id}`);
}

async function runSample(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const scenarioCount = Math.max(1, Math.floor(Number(options.scenarioCount) ||
    SAMPLE_SCENARIOS));
  const scenarioOffset = Math.max(0, Math.floor(Number(options.scenarioOffset) || 0));
  const repetitions = Math.max(1, Math.floor(Number(options.repetitions) || REPETITIONS));
  const sampleSalt = options.sampleSalt || SAMPLE_SALT;
  const fixed = loadFixedScenarioIndex(root); const sample = selectScenarios(fixed, {
    scenarioCount, scenarioOffset, sampleSalt
  });
  const rolling = loadRollingV1ScenariosForIds(sample.ids, root);
  invariant(rolling.scenarios.length === scenarioCount,
    "STRAT2_SAMPLE_SCENARIO_LOAD", String(rolling.scenarios.length));
  const frozen = loadFrozenCandidate(root, options.candidateManifest);
  const v1Code = fs.readFileSync(frozen.v1File, "utf8");
  const simulator = await loadSimulator(root); const sourceBefore = sourceIdentity(root);
  const records = []; const byMode = {};
  const runModes = options.modes || MODES;
  invariant(runModes.length > 0 && runModes.every(mode => VALID_MODES.includes(mode)),
    "STRAT2_SAMPLE_MODES_INVALID", String(runModes));
  const expectedPerMode = scenarioCount * VARIANTS.length * repetitions;
  for (const mode of runModes) {
    const lane = [];
    for (const scenario of rolling.scenarios)
      for (let repetition = 0; repetition < repetitions; repetition += 1)
        for (const variant of VARIANTS) {
          const match = await runMatch(simulator.module, scenario, variant, repetition,
            v1Code, Math.max(20, Number(options.timeoutMs) || 200),
            engineOptions(frozen, mode), {});
          lane.push(compactMatch(match, mode));
          if (typeof options.onProgress === "function" &&
              (lane.length % (options.progressEvery || 16) === 0 ||
               lane.length === expectedPerMode))
            options.onProgress({ mode, completed: lane.length, total: expectedPerMode,
              scenario: scenario.matchUrlId, variant: variant.variantId });
        }
    byMode[mode] = lane; records.push(...lane);
  }
  const sourceAfter = sourceIdentity(root);
  invariant(sourceBefore.sha256 === sourceAfter.sha256,
    "STRAT2_SAMPLE_SOURCE_CHANGED", `${sourceBefore.sha256}:${sourceAfter.sha256}`);
  const summaries = Object.fromEntries(runModes.map(mode => [mode, summarize(byMode[mode])]));
  const hasCurrent = Boolean(byMode[STRATEGY_PRIORITY_MODE.CURRENT]);
  const hasStar = Boolean(byMode[STRATEGY_PRIORITY_MODE.FORCE_STAR_CONTROL]);
  const hasBandOff = Boolean(byMode[STRATEGY_PRIORITY_MODE.BAND_OFF]);
  const hasPossibleHitOff = Boolean(byMode[STRATEGY_PRIORITY_MODE.POSSIBLE_HIT_OFF]);
  const hasProjectileAttackOff =
    Boolean(byMode[STRATEGY_PRIORITY_MODE.PROJECTILE_ATTACK_OFF]);
  const hasSurvivorFrontierOff =
    Boolean(byMode[STRATEGY_PRIORITY_MODE.SURVIVOR_FRONTIER_OFF]);
  const hasOwnershipPoc = Boolean(byMode[STRATEGY_PRIORITY_MODE.OWNERSHIP_POC]);
  const currentVsStar = hasCurrent && hasStar ? compare(
    byMode[STRATEGY_PRIORITY_MODE.CURRENT],
    byMode[STRATEGY_PRIORITY_MODE.FORCE_STAR_CONTROL]) : null;
  const currentVsBandOff = hasCurrent && hasBandOff ? compare(
    byMode[STRATEGY_PRIORITY_MODE.BAND_OFF],
    byMode[STRATEGY_PRIORITY_MODE.CURRENT]) : null;
  const currentVsPossibleHitOff = hasCurrent && hasPossibleHitOff ? compare(
    byMode[STRATEGY_PRIORITY_MODE.POSSIBLE_HIT_OFF],
    byMode[STRATEGY_PRIORITY_MODE.CURRENT]) : null;
  const currentVsProjectileAttackOff = hasCurrent && hasProjectileAttackOff ? compare(
    byMode[STRATEGY_PRIORITY_MODE.PROJECTILE_ATTACK_OFF],
    byMode[STRATEGY_PRIORITY_MODE.CURRENT]) : null;
  const currentVsSurvivorFrontierOff = hasCurrent && hasSurvivorFrontierOff ? compare(
    byMode[STRATEGY_PRIORITY_MODE.SURVIVOR_FRONTIER_OFF],
    byMode[STRATEGY_PRIORITY_MODE.CURRENT]) : null;
  const currentVsOwnershipPoc = hasCurrent && hasOwnershipPoc ? compare(
    byMode[STRATEGY_PRIORITY_MODE.CURRENT],
    byMode[STRATEGY_PRIORITY_MODE.OWNERSHIP_POC]) : null;
  const invariantsZero = runModes.every(mode => invariantFailures(summaries[mode]) === 0);
  const scenarioFingerprint = fingerprintObject({
    salt: sampleSalt, scenarioOffset, scenarioCount, scenarios: sample.entries
  });
  const overview = {
    schemaVersion: 1,
    objectKind: "StrategyPrioritySampleOverviewV1",
    experimentId: EXPERIMENT_ID,
    status: invariantsZero ? "SAMPLE_COMPLETE" : "SAMPLE_INVALID",
    evidenceClass: "DISCOVERY_SAMPLE_NOT_QUALIFICATION",
    productionSemanticsChanged: false,
    source: sourceBefore,
    candidateParameters: {
      candidateId: frozen.manifest.candidateId,
      candidateFingerprint: frozen.manifest.fingerprint,
      v1Sha256: frozen.manifest.selection.v1Sha256
    },
    sample: {
      salt: sampleSalt,
      scenarioCount,
      scenarioOffset,
      repetitions,
      variants: VARIANTS.map(item => item.variantId),
      matchesPerMode: expectedPerMode,
      totalMatches: records.length,
      modes: runModes,
      scenarioFingerprint,
      scenarioIds: sample.ids,
      discoveryFingerprint: sample.split.discoveryFingerprint,
      holdoutFingerprint: sample.split.holdoutFingerprint,
      holdoutPayloadsLoaded: 0,
      rollingSourceIndex: rolling.sourceIndex
    },
    modes: summaries,
    comparisons: { currentVsForcedStar: currentVsStar,
      currentVsBandOff, currentVsPossibleHitOff, currentVsProjectileAttackOff,
      currentVsSurvivorFrontierOff, currentVsOwnershipPoc },
    conclusion: currentVsOwnershipPoc ? {
      status: currentVsOwnershipPoc.deltas.scoreRatePer10000 >= 500 &&
        currentVsOwnershipPoc.deltas.starDelta >= 0 ? "OWNERSHIP_POC_PROMISING" :
        "OWNERSHIP_POC_REJECTED",
      interpretation:
        "Deltas are OWNERSHIP_POC minus CURRENT on identical paired Discovery scenarios.",
      deltas: currentVsOwnershipPoc.deltas,
      transitions: currentVsOwnershipPoc.transitions
    } : currentVsSurvivorFrontierOff ? {
      status: "SURVIVOR_FRONTIER_AB",
      interpretation:
        "Deltas are CURRENT minus SURVIVOR_FRONTIER_OFF on paired Discovery scenarios.",
      deltas: currentVsSurvivorFrontierOff.deltas
    } : currentVsProjectileAttackOff ? {
      status: "PROJECTILE_ATTACK_CLOSURE_AB",
      interpretation:
        "Deltas are CURRENT minus PROJECTILE_ATTACK_OFF on paired Discovery scenarios.",
      deltas: currentVsProjectileAttackOff.deltas
    } : currentVsPossibleHitOff ? {
      status: "POSSIBLE_HIT_AB",
      interpretation: "Deltas are CURRENT minus POSSIBLE_HIT_OFF on paired Discovery scenarios.",
      deltas: currentVsPossibleHitOff.deltas
    } : currentVsStar ? conclusion(currentVsStar) : {
      status: "CLASSIFICATION_ONLY",
      interpretation: "Single-mode audit; no causal gameplay conclusion."
    },
    invariantsZero,
    fingerprint: ""
  };
  overview.fingerprint = fingerprintObject(overview);
  const output = path.resolve(options.output ||
    defaultOutput(root, sourceBefore, scenarioFingerprint, runModes, repetitions));
  invariant(!fs.existsSync(output) || fs.readdirSync(output).length === 0,
    "STRAT2_SAMPLE_OUTPUT_NOT_EMPTY", output);
  ensureDirectory(output);
  const matchBytes = gzipNdjson(records);
  writeFileAtomic(path.join(output, "matches.ndjson.gz"), matchBytes, { mode: 0o644 });
  writeJsonAtomic(path.join(output, "overview.json"), overview, { mode: 0o644 });
  const overviewBytes = fs.readFileSync(path.join(output, "overview.json"));
  const manifest = {
    schemaVersion: 1,
    objectKind: "StrategyPrioritySampleManifestV1",
    status: overview.status,
    experimentId: EXPERIMENT_ID,
    sourceSha256: sourceBefore.sha256,
    scenarioFingerprint,
    files: {
      overview: { size: overviewBytes.length, sha256: sha256Bytes(overviewBytes) },
      matches: { records: records.length, size: matchBytes.length,
        sha256: sha256Bytes(matchBytes) }
    },
    totalBytes: overviewBytes.length + matchBytes.length,
    storageBudgetBytes: STORAGE_BUDGET,
    fingerprint: ""
  };
  invariant(manifest.totalBytes <= STORAGE_BUDGET, "STRAT2_SAMPLE_STORAGE_BUDGET",
    String(manifest.totalBytes));
  manifest.fingerprint = fingerprintObject(manifest);
  writeJsonAtomic(path.join(output, "manifest.json"), manifest, { mode: 0o644 });
  return { output, overview, manifest };
}

module.exports = {
  EXPERIMENT_ID,
  SAMPLE_SALT,
  SAMPLE_SCENARIOS,
  REPETITIONS,
  STORAGE_BUDGET,
  selectScenarios,
  compactMatch,
  summarize,
  compare,
  conclusion,
  runSample
};
