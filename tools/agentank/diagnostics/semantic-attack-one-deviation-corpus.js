#!/usr/bin/env node
"use strict";

// BP142 replays the exact BP140/Q1 roots and evaluates a bounded adaptive
// policy: DIRECT_PURSUIT with at most one supported deviation on each observed
// world line.  Historical outcomes remain audit-only.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { loadCohort } = require("./v2-native-initiative-arena");
const { runReplayBranch } = require("./root-counterfactual-labels");
const { readMatches, exactEvidence, scenarioIndex } = require(
  "./semantic-attack-certificate-root-corpus");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { readRoots, replayCertificate, selectReplayRoots,
  replayPrefixIndex } = require(
  "./semantic-attack-chance-qualified-labels");
const { HazardKernel } = require("../../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../../engine-v2/src/fast/hard-gate");
const { MOVE_VARIANTS, MOVE_VARIANT_NAME, VARIANT_COUNT } = require(
  "./semantic-attack-depth3-move-variant-shadow");
const { MoveContestVariantKernel } = require("./move-contest-variant-kernel");
const { VALUE_RELATION, POINTWISE_RELATION, unpackVector,
  valueRelation, pointwiseRelation } = require(
  "./semantic-attack-refusal-value-search");
const { VALUE_RELATION_NAME, POINTWISE_RELATION_NAME, copyCells,
  localClassification } = require("./semantic-attack-refusal-interval-corpus");
const { OneDeviationRefusalValueSearch } = require(
  "./semantic-attack-one-deviation-value-search");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function actionCounts(search) {
  const output = [];
  for (let action = 0; action < search.deviationActionCount.length; action += 1)
    if (search.deviationActionCount[action])
      output.push([action, search.deviationActionCount[action]]);
  return output;
}

function sideImprovement(variants, side) {
  if (!variants.length || variants.some(item => !item.complete))
    return "INCOMPLETE";
  let higher = 0; let lower = 0;
  for (const variant of variants) {
    const value = variant[side + "Value"];
    const baseline = variant["baseline" +
      side[0].toUpperCase() + side.slice(1) + "Value"];
    if (value > baseline) higher = 1;
    else if (value < baseline) lower = 1;
  }
  if (lower) return "MONOTONICITY_FAILURE";
  return higher ? "STRICT_IMPROVEMENT" : "EQUAL";
}

function evaluateRoot(engine, certificate, baseline, maximumDepth,
    nodeBudget, ttCapacity = 8192) {
  const bundle = engine.adapter.bundle; const state = bundle?.state;
  if (!state) throw new Error("BP142_FAST_STATE_MISSING");
  const originalKernel = bundle.kernel; const originalHazard = bundle.hazard;
  const originalHard = bundle.hard; const beforeLo = state.hashLo;
  const beforeHi = state.hashHi; const beforeDelta = state.deltaUsed;
  const beforeEvent = state.eventUsed; const variants = [];
  let rootRestoreFailureCount = 0; let hotAllocationCount = 0;
  let totalNodes = 0; let maximumNodes = 0; let totalTtHits = 0;
  let totalLowerBoundCutoffs = 0; let totalDeviationStates = 0;
  let totalDeviationCandidates = 0; let totalDeviationSelections = 0;
  const selectedActionCounts = {};
  try {
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
      const baselineVariant = baseline.variants[variant];
      if (!baselineVariant || baselineVariant.name !== MOVE_VARIANT_NAME[variant])
        throw new Error("BP142_BASELINE_VARIANT_MISMATCH:" + variant);
      const kernel = new MoveContestVariantKernel(state, MOVE_VARIANTS[variant]);
      const hazard = new HazardKernel(state);
      const hard = new HardGate(kernel, hazard, 0);
      const search = new OneDeviationRefusalValueSearch(nodeBudget, ttCapacity);
      bundle.kernel = kernel; bundle.hazard = hazard; bundle.hard = hard;
      const incumbentValue = search.evaluateRoot(bundle,
        certificate.currentAction, certificate.currentArgument,
        engine.enemyActions, engine.enemyArguments, engine.enemyCount,
        maximumDepth, nodeBudget);
      const incumbentComplete = Boolean(search.lastSupportComplete);
      const incumbentCells = copyCells(search, engine.enemyCount);
      const incumbentNodes = search.nodes;
      const incumbentTtHits = search.ttHits;
      const incumbentLowerBoundCutoffs = search.absoluteLowerBoundCutoffCount;
      const incumbentDeviationStates = search.deviationStateCount;
      const incumbentDeviationCandidates = search.deviationCandidateCount;
      const incumbentDeviationSelections = search.deviationSelectedCount;
      const incumbentDominanceCutoffs =
        search.deviationDominanceCutoffCount;
      const incumbentSelectedActions = actionCounts(search);
      const incumbentBudgetStops = search.budgetStopCount;
      const incumbentTtCapacityStops = search.ttCapacityStops;
      const incumbentUnsupportedStops = search.unsupportedGenerationStops;
      const incumbentFastIncomplete = search.fastIncompleteCount;
      const incumbentHardIncomplete = search.hardIncompleteCount;
      rootRestoreFailureCount += search.rootRestoreFailures;
      hotAllocationCount += search.hotAllocationCount +
        (search.settlement?.hotAllocationCount || 0);
      const candidateValue = search.evaluateRoot(bundle,
        certificate.candidateAction, certificate.candidateArgument,
        engine.enemyActions, engine.enemyArguments, engine.enemyCount,
        maximumDepth, nodeBudget);
      const candidateComplete = Boolean(search.lastSupportComplete);
      const candidateCells = copyCells(search, engine.enemyCount);
      const candidateNodes = search.nodes;
      const candidateTtHits = search.ttHits;
      const candidateLowerBoundCutoffs = search.absoluteLowerBoundCutoffCount;
      const candidateDeviationStates = search.deviationStateCount;
      const candidateDeviationCandidates = search.deviationCandidateCount;
      const candidateDeviationSelections = search.deviationSelectedCount;
      const candidateDominanceCutoffs =
        search.deviationDominanceCutoffCount;
      const candidateSelectedActions = actionCounts(search);
      const candidateBudgetStops = search.budgetStopCount;
      const candidateTtCapacityStops = search.ttCapacityStops;
      const candidateUnsupportedStops = search.unsupportedGenerationStops;
      const candidateFastIncomplete = search.fastIncompleteCount;
      const candidateHardIncomplete = search.hardIncompleteCount;
      rootRestoreFailureCount += search.rootRestoreFailures;
      hotAllocationCount += search.hotAllocationCount +
        (search.settlement?.hotAllocationCount || 0);
      const complete = incumbentComplete && candidateComplete;
      const relation = valueRelation(incumbentValue, candidateValue, complete);
      const pointwise = complete ? pointwiseRelation(incumbentCells,
        candidateCells, engine.enemyCount) : POINTWISE_RELATION.INCOMPLETE;
      totalNodes += incumbentNodes + candidateNodes;
      maximumNodes = Math.max(maximumNodes, incumbentNodes, candidateNodes);
      totalTtHits += incumbentTtHits + candidateTtHits;
      totalLowerBoundCutoffs += incumbentLowerBoundCutoffs +
        candidateLowerBoundCutoffs;
      totalDeviationStates += incumbentDeviationStates +
        candidateDeviationStates;
      totalDeviationCandidates += incumbentDeviationCandidates +
        candidateDeviationCandidates;
      totalDeviationSelections += incumbentDeviationSelections +
        candidateDeviationSelections;
      for (const counts of [incumbentSelectedActions, candidateSelectedActions])
        for (const [action, count] of counts)
          selectedActionCounts[action] = (selectedActionCounts[action] || 0) + count;
      variants.push({ name: MOVE_VARIANT_NAME[variant], complete,
        enemyCount: engine.enemyCount,
        baselineIncumbentValue: baselineVariant.incumbentValue,
        baselineCandidateValue: baselineVariant.candidateValue,
        incumbentValue, candidateValue,
        incumbentVector: unpackVector(incumbentValue),
        candidateVector: unpackVector(candidateValue),
        incumbentGain: complete ?
          incumbentValue - baselineVariant.incumbentValue : null,
        candidateGain: complete ?
          candidateValue - baselineVariant.candidateValue : null,
        valueRelation: relation,
        valueRelationName: VALUE_RELATION_NAME[relation],
        pointwiseRelation: pointwise,
        pointwiseRelationName: POINTWISE_RELATION_NAME[pointwise],
        incumbentCells, candidateCells, incumbentNodes, candidateNodes,
        incumbentTtHits, candidateTtHits,
        incumbentLowerBoundCutoffs, candidateLowerBoundCutoffs,
        incumbentDeviationStates, candidateDeviationStates,
        incumbentDeviationCandidates, candidateDeviationCandidates,
        incumbentDeviationSelections, candidateDeviationSelections,
        incumbentDominanceCutoffs, candidateDominanceCutoffs,
        incumbentSelectedActions, candidateSelectedActions,
        incumbentBudgetStops, candidateBudgetStops,
        incumbentTtCapacityStops, candidateTtCapacityStops,
        incumbentUnsupportedStops, candidateUnsupportedStops,
        incumbentFastIncomplete, candidateFastIncomplete,
        incumbentHardIncomplete, candidateHardIncomplete });
      if (state.hashLo !== beforeLo || state.hashHi !== beforeHi ||
          state.deltaUsed !== beforeDelta || state.eventUsed !== beforeEvent)
        rootRestoreFailureCount += 1;
    }
  } finally {
    bundle.kernel = originalKernel; bundle.hazard = originalHazard;
    bundle.hard = originalHard;
  }
  return { variants, baselineClassification: baseline.classification,
    classification: localClassification(variants),
    incumbentImprovement: sideImprovement(variants, "incumbent"),
    candidateImprovement: sideImprovement(variants, "candidate"),
    totalNodes, maximumNodes, totalTtHits, totalLowerBoundCutoffs,
    totalDeviationStates, totalDeviationCandidates, totalDeviationSelections,
    selectedActionCounts, rootRestoreFailureCount, hotAllocationCount };
}

function summarize(records) {
  const output = { rootCount: records.length, exactRootCount: 0,
    completeVariantCount: 0, incompleteVariantCount: 0,
    classifications: {}, baselineToImproved: {},
    incumbentImprovements: {}, candidateImprovements: {},
    totalNodes: 0, maximumNodes: 0, totalTtHits: 0,
    totalLowerBoundCutoffs: 0, totalDeviationStates: 0,
    totalDeviationCandidates: 0, totalDeviationSelections: 0,
    totalDominanceCutoffs: 0,
    selectedActionCounts: {}, monotonicityFailureCount: 0,
    budgetStopCount: 0, ttCapacityStopCount: 0,
    unsupportedGenerationStopCount: 0, fastIncompleteCount: 0,
    hardIncompleteCount: 0,
    rootRestoreFailureCount: 0, hotAllocationCount: 0 };
  for (const record of records) {
    output.exactRootCount += record.exact ? 1 : 0;
    output.classifications[record.classification] =
      (output.classifications[record.classification] || 0) + 1;
    const transition = record.baselineClassification + "/" +
      record.classification;
    output.baselineToImproved[transition] =
      (output.baselineToImproved[transition] || 0) + 1;
    for (const side of ["incumbent", "candidate"]) {
      const key = side + "Improvement"; const value = record[key];
      const target = output[side + "Improvements"];
      target[value] = (target[value] || 0) + 1;
      if (value === "MONOTONICITY_FAILURE")
        output.monotonicityFailureCount += 1;
    }
    for (const variant of record.variants)
      if (variant.complete) output.completeVariantCount += 1;
      else output.incompleteVariantCount += 1;
    for (const variant of record.variants) {
      output.budgetStopCount += variant.incumbentBudgetStops +
        variant.candidateBudgetStops;
      output.ttCapacityStopCount += variant.incumbentTtCapacityStops +
        variant.candidateTtCapacityStops;
      output.unsupportedGenerationStopCount +=
        variant.incumbentUnsupportedStops + variant.candidateUnsupportedStops;
      output.fastIncompleteCount += variant.incumbentFastIncomplete +
        variant.candidateFastIncomplete;
      output.hardIncompleteCount += variant.incumbentHardIncomplete +
        variant.candidateHardIncomplete;
      output.totalDominanceCutoffs += variant.incumbentDominanceCutoffs +
        variant.candidateDominanceCutoffs;
    }
    for (const [action, count] of Object.entries(record.selectedActionCounts))
      output.selectedActionCounts[action] =
        (output.selectedActionCounts[action] || 0) + count;
    for (const field of ["totalNodes", "totalTtHits",
      "totalLowerBoundCutoffs", "totalDeviationStates",
      "totalDeviationCandidates", "totalDeviationSelections",
      "rootRestoreFailureCount", "hotAllocationCount"])
      output[field] += record[field];
    output.maximumNodes = Math.max(output.maximumNodes, record.maximumNodes);
  }
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const replayOption = option("--replay-source");
  const labelsOption = option("--labels");
  const prefixOption = option("--prefix-source");
  const baselineOption = option("--baseline-source");
  if (!replayOption || !labelsOption || !prefixOption || !baselineOption)
    throw new Error("BP142_SOURCE_REQUIRED");
  const replaySource = readRoots(replayOption);
  const labels = readRoots(labelsOption);
  const prefixSource = readMatches(prefixOption);
  const baselineSource = readRoots(baselineOption);
  const baselines = new Map(baselineSource.roots.map(item => [item.key, item]));
  const prefixes = replayPrefixIndex(prefixSource.matches);
  const selectedAll = selectReplayRoots(replaySource.roots, labels.roots);
  const expectedRoots = Number(option("--expected-roots", 35));
  if (expectedRoots > 0 && selectedAll.length !== expectedRoots)
    throw new Error("BP142_ROOT_DENOMINATOR:" + selectedAll.length + "/" +
      expectedRoots);
  const rootLimit = Number(option("--root-limit", 0));
  const selected = rootLimit > 0 ? selectedAll.slice(0, rootLimit) : selectedAll;
  const maximumDepth = Number(option("--depth", 4));
  const nodeBudget = Number(option("--node-budget", 4096));
  const ttCapacity = Number(option("--tt-capacity", 8192));
  const cohortFile = path.resolve(option("--cohort", path.join(root,
    "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const loaded = loadCohort(root, cohortFile, role);
  const scenarios = scenarioIndex(loaded.scenarios);
  const simulator = await loadSimulator(root);
  const records = []; let missingScenarioCount = 0;

  for (let index = 0; index < selected.length; index += 1) {
    const replay = selected[index].root; const label = selected[index].label;
    const certificate = replayCertificate(replay);
    const replayPrefix = prefixes.get(replay.key);
    const baseline = baselines.get(replay.key);
    const scenario = scenarios.get(replay.scenarioFingerprint) ||
      scenarios.get(replay.matchUrlId);
    if (!scenario) { missingScenarioCount += 1; continue; }
    if (!replayPrefix) throw new Error("BP142_PREFIX_MISSING:" + replay.key);
    if (!baseline) throw new Error("BP142_BASELINE_MISSING:" + replay.key);
    let evaluation = null;
    const branch = runReplayBranch(simulator.module, {
      frame: certificate.frame, hashLo: certificate.hashLo,
      hashHi: certificate.hashHi
    }, { actionCode: certificate.currentAction,
      argument: certificate.currentArgument }, scenario, replay.candidateSeat,
    {}, null, "HISTORICAL", {
      diagnosticFinalActionOverride(engine) {
        const state = engine.adapter.state;
        if (evaluation || !state ||
            state.arrays[ARRAY.SCALAR][SCALAR.FRAME] !== certificate.frame ||
            state.hashLo !== certificate.hashLo ||
            state.hashHi !== certificate.hashHi) return null;
        evaluation = evaluateRoot(engine, certificate, baseline,
          maximumDepth, nodeBudget, ttCapacity);
        return null;
      }
    }, replayPrefix);
    const exact = exactEvidence(branch);
    if (!evaluation) throw new Error("BP142_ROOT_NOT_CAPTURED:" + replay.key);
    records.push({ schemaVersion: 1,
      objectKind: "SEMANTIC_ATTACK_ONE_DEVIATION_ROOT_V1",
      key: replay.key, matchUrlId: replay.matchUrlId,
      scenarioFingerprint: replay.scenarioFingerprint,
      candidateSeat: replay.candidateSeat, certificate,
      historicalLabel: label.outcomeRelation,
      historicalPareto: label.paretoRelation,
      historicalTransition: replay.transition, geometry: label.geometry,
      exact, quantifiers: {
        ownContinuation: "DIRECT_WITH_AT_MOST_ONE_OBSERVED_STATE_DEVIATION",
        deviationPrivilege: "ONE_PER_WORLD_LINE_AFTER_ROOT",
        simultaneousEnemyActionObservable: false,
        chanceOutcomeObservableBeforeAction: false,
        enemyContinuation: "ALL_GENERATED_ACTIONS",
        chanceContinuation: "ALL_GENERATED_OUTCOMES",
        movementWorlds: MOVE_VARIANT_NAME.slice(),
        maximumDepth, nodeBudget, ttCapacity
      }, ...evaluation });
    if ((index + 1) % 4 === 0 || index + 1 === selected.length)
      process.stderr.write("[bp142-one-deviation] " + (index + 1) + "/" +
        selected.length + "\n");
  }

  const summary = summarize(records);
  const accepted = missingScenarioCount === 0 &&
    records.length === selected.length &&
    summary.exactRootCount === records.length &&
    summary.completeVariantCount === records.length * VARIANT_COUNT &&
    summary.incompleteVariantCount === 0 &&
    summary.monotonicityFailureCount === 0 &&
    summary.rootRestoreFailureCount === 0 && summary.hotAllocationCount === 0;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_ONE_DEVIATION_OVERVIEW_V1",
    status: accepted ? "ACCEPT_ONE_DEVIATION_CLASSIFIED" : "REJECTED",
    role, cohortFingerprint: loaded.manifest.fingerprint,
    sourceRootCount: selectedAll.length, selectedRootCount: selected.length,
    rootLimit,
    maximumDepth, nodeBudget, ttCapacity, ...summary,
    decisionBoundary:
      "Diagnostic policy improvement only. One deviation is allowed per observed world line after the fixed root action. No result owns production action."
  };
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp142-semantic-attack-one-deviation")));
  const lines = records.map(record => JSON.stringify(record)).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_ONE_DEVIATION_MANIFEST_V1",
    status: overview.status, replaySource: replaySource.directory,
    labelSource: labels.directory, prefixSource: path.resolve(prefixOption),
    baselineSource: baselineSource.directory,
    replayRootsSha256: sha256Bytes(replaySource.bytes),
    labelRootsSha256: sha256Bytes(labels.bytes),
    prefixMatchesSha256: sha256Bytes(prefixSource.bytes),
    baselineRootsSha256: sha256Bytes(baselineSource.bytes),
    cohortFile, cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    productionRootSha256: sha256Bytes(fs.readFileSync(productionFile)),
    recordsSha256: sha256Bytes(bytes), rootCount: records.length,
    arguments: process.argv.slice(2), fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"), bytes);
  process.stdout.write(JSON.stringify({ output: outputDirectory,
    overview, fingerprint: manifest.fingerprint }, null, 2) + "\n");
  if (!accepted) throw new Error("BP142_ONE_DEVIATION_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { actionCounts, sideImprovement, evaluateRoot, summarize,
  build };
