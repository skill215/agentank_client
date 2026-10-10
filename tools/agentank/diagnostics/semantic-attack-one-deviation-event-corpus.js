#!/usr/bin/env node
"use strict";

// BP143 evaluates the eight BP142 local candidate roots against strict safe
// attack events and merges proven finite continuation policies across movement
// rule worlds only when identical semantic states choose identical actions.

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
const { readRoots, replayPrefixIndex } = require(
  "./semantic-attack-chance-qualified-labels");
const { HazardKernel } = require("../../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../../engine-v2/src/fast/hard-gate");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { EVENT_GOAL, EVENT_GOAL_NAME } = require(
  "./semantic-attack-event-horizon-shadow");
const { MOVE_VARIANTS, MOVE_VARIANT_NAME, VARIANT_COUNT } = require(
  "./semantic-attack-depth3-move-variant-shadow");
const { MoveContestVariantKernel } = require("./move-contest-variant-kernel");
const { OneDeviationAttackEventProof } = require(
  "./semantic-attack-one-deviation-event-proof");

const STATUS_NAME = Object.freeze(["UNKNOWN", "PROVEN", "DISPROVEN"]);

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function policyKey(entry) {
  return entry.semanticLo + ":" + entry.semanticHi + ":" + entry.depth +
    ":" + entry.deviationAvailable;
}

function mergePolicies(policySets) {
  const merged = new Map(); let conflictCount = 0; let duplicateCount = 0;
  for (const entries of policySets)
    for (const entry of entries) {
      const key = policyKey(entry); const prior = merged.get(key);
      if (!prior) { merged.set(key, entry); continue; }
      duplicateCount += 1;
      if (prior.action !== entry.action || prior.argument !== entry.argument ||
          prior.consumesDeviation !== entry.consumesDeviation)
        conflictCount += 1;
    }
  const entries = Array.from(merged.values()).sort((left, right) =>
    left.semanticLo - right.semanticLo || left.semanticHi - right.semanticHi ||
    left.depth - right.depth ||
    left.deviationAvailable - right.deviationAvailable);
  return { compatible: conflictCount === 0, conflictCount, duplicateCount,
    entryCount: entries.length, entries,
    fingerprint: fingerprintObject({ entries }) };
}

function goalClassification(variants) {
  if (variants.length !== VARIANT_COUNT ||
      variants.some(item => !item.supportComplete)) return "INCOMPLETE";
  const incumbent = variants.every(item =>
    item.incumbentStatus === PROOF_STATUS.PROVEN);
  const candidate = variants.every(item =>
    item.candidateStatus === PROOF_STATUS.PROVEN);
  if (incumbent && candidate) return "BOTH_PROVEN";
  if (candidate) return "CANDIDATE_ONLY";
  if (incumbent) return "INCUMBENT_ONLY";
  return "NEITHER_PROVEN";
}

function evaluateRoot(engine, certificate, maximumDepth, nodeBudget,
    ttCapacity) {
  const bundle = engine.adapter.bundle; const state = bundle?.state;
  if (!state) throw new Error("BP143_FAST_STATE_MISSING");
  const originalKernel = bundle.kernel; const originalHazard = bundle.hazard;
  const originalHard = bundle.hard; const beforeLo = state.hashLo;
  const beforeHi = state.hashHi; const beforeDelta = state.deltaUsed;
  const beforeEvent = state.eventUsed; const goals = [];
  let totalNodes = 0; let maximumNodes = 0; let rootRestoreFailureCount = 0;
  let hotAllocationCount = 0; let budgetStopCount = 0;
  let ttCapacityStopCount = 0; let supportLossCount = 0;
  try {
    for (let goal = 0; goal < EVENT_GOAL.COUNT; goal += 1) {
      const variants = [];
      for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
        const kernel = new MoveContestVariantKernel(state,
          MOVE_VARIANTS[variant]);
        const hazard = new HazardKernel(state);
        const hard = new HardGate(kernel, hazard, 0);
        const search = new OneDeviationAttackEventProof(goal, nodeBudget,
          ttCapacity);
        bundle.kernel = kernel; bundle.hazard = hazard; bundle.hard = hard;
        const incumbentStatus = search.evaluateCandidate(bundle,
          certificate.currentAction, certificate.currentArgument,
          engine.enemyActions, engine.enemyArguments, engine.enemyCount,
          maximumDepth, nodeBudget);
        const incumbentSupportComplete = Boolean(search.lastSupportComplete);
        const incumbentNodes = search.nodes;
        const incumbentPolicy = incumbentStatus === PROOF_STATUS.PROVEN ?
          search.exportPolicyEntries() : [];
        const incumbentMetrics = { fireEvents: search.fireEventCount,
          threatFireEvents: search.threatFireCount,
          doomedFireEvents: search.doomedFireCount,
          counterUnsafeEvents: search.counterUnsafeCount,
          horizonStops: search.horizonStopCount,
          deviationStates: search.deviationStateCount,
          deviationRows: search.deviationRowCount,
          deviationsSelected: search.deviationSelectedCount,
          ttHits: search.ttHits };
        rootRestoreFailureCount += search.rootRestoreFailures;
        hotAllocationCount += search.hotAllocationCount +
          (search.settlement?.hotAllocationCount || 0);
        budgetStopCount += search.budgetStopCount;
        ttCapacityStopCount += search.ttCapacityStops;
        supportLossCount += search.supportLossCount;
        const candidateStatus = search.evaluateCandidate(bundle,
          certificate.candidateAction, certificate.candidateArgument,
          engine.enemyActions, engine.enemyArguments, engine.enemyCount,
          maximumDepth, nodeBudget);
        const candidateSupportComplete = Boolean(search.lastSupportComplete);
        const candidateNodes = search.nodes;
        const candidatePolicy = candidateStatus === PROOF_STATUS.PROVEN ?
          search.exportPolicyEntries() : [];
        const candidateMetrics = { fireEvents: search.fireEventCount,
          threatFireEvents: search.threatFireCount,
          doomedFireEvents: search.doomedFireCount,
          counterUnsafeEvents: search.counterUnsafeCount,
          horizonStops: search.horizonStopCount,
          deviationStates: search.deviationStateCount,
          deviationRows: search.deviationRowCount,
          deviationsSelected: search.deviationSelectedCount,
          ttHits: search.ttHits };
        rootRestoreFailureCount += search.rootRestoreFailures;
        hotAllocationCount += search.hotAllocationCount +
          (search.settlement?.hotAllocationCount || 0);
        budgetStopCount += search.budgetStopCount;
        ttCapacityStopCount += search.ttCapacityStops;
        supportLossCount += search.supportLossCount;
        totalNodes += incumbentNodes + candidateNodes;
        maximumNodes = Math.max(maximumNodes, incumbentNodes, candidateNodes);
        const supportComplete = incumbentSupportComplete &&
          candidateSupportComplete;
        variants.push({ name: MOVE_VARIANT_NAME[variant], supportComplete,
          incumbentStatus, incumbentStatusName: STATUS_NAME[incumbentStatus],
          candidateStatus, candidateStatusName: STATUS_NAME[candidateStatus],
          incumbentNodes, candidateNodes, incumbentMetrics, candidateMetrics,
          incumbentPolicy, candidatePolicy });
        if (state.hashLo !== beforeLo || state.hashHi !== beforeHi ||
            state.deltaUsed !== beforeDelta || state.eventUsed !== beforeEvent)
          rootRestoreFailureCount += 1;
      }
      const classification = goalClassification(variants);
      const candidateCommonProven = classification === "CANDIDATE_ONLY" ||
        classification === "BOTH_PROVEN";
      const incumbentCommonProven = classification === "INCUMBENT_ONLY" ||
        classification === "BOTH_PROVEN";
      const candidateMergedPolicy = candidateCommonProven ?
        mergePolicies(variants.map(item => item.candidatePolicy)) : null;
      const incumbentMergedPolicy = incumbentCommonProven ?
        mergePolicies(variants.map(item => item.incumbentPolicy)) : null;
      goals.push({ name: EVENT_GOAL_NAME[goal], classification,
        candidateCommonProven, incumbentCommonProven,
        candidateExecutable: Boolean(candidateMergedPolicy?.compatible),
        incumbentExecutable: Boolean(incumbentMergedPolicy?.compatible),
        candidateMergedPolicy, incumbentMergedPolicy, variants });
    }
  } finally {
    bundle.kernel = originalKernel; bundle.hazard = originalHazard;
    bundle.hard = originalHard;
  }
  return { goals, totalNodes, maximumNodes, budgetStopCount,
    ttCapacityStopCount, supportLossCount, rootRestoreFailureCount,
    hotAllocationCount };
}

function summarize(records) {
  const output = { rootCount: records.length, exactRootCount: 0,
    goalClassifications: {}, candidateExecutableByGoal: {},
    incumbentExecutableByGoal: {}, totalNodes: 0, maximumNodes: 0,
    budgetStopCount: 0, ttCapacityStopCount: 0, supportLossCount: 0,
    rootRestoreFailureCount: 0, hotAllocationCount: 0 };
  for (const record of records) {
    output.exactRootCount += record.exact ? 1 : 0;
    for (const goal of record.goals) {
      const key = goal.name + "/" + goal.classification;
      output.goalClassifications[key] =
        (output.goalClassifications[key] || 0) + 1;
      if (goal.candidateExecutable)
        output.candidateExecutableByGoal[goal.name] =
          (output.candidateExecutableByGoal[goal.name] || 0) + 1;
      if (goal.incumbentExecutable)
        output.incumbentExecutableByGoal[goal.name] =
          (output.incumbentExecutableByGoal[goal.name] || 0) + 1;
    }
    for (const field of ["totalNodes", "budgetStopCount",
      "ttCapacityStopCount", "supportLossCount", "rootRestoreFailureCount",
      "hotAllocationCount"]) output[field] += record[field];
    output.maximumNodes = Math.max(output.maximumNodes, record.maximumNodes);
  }
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const certificateOption = option("--certificate-source");
  const prefixOption = option("--prefix-source");
  if (!certificateOption || !prefixOption)
    throw new Error("BP143_SOURCE_REQUIRED");
  const certificateSource = readRoots(certificateOption);
  const selection = option("--selection", "CANDIDATE").toUpperCase();
  const selected = selection === "ALL" ? certificateSource.roots.slice() :
    certificateSource.roots.filter(item =>
      item.classification === "LOCAL_ROBUST_CANDIDATE");
  const expectedRoots = Number(option("--expected-roots", 8));
  if (selected.length !== expectedRoots)
    throw new Error("BP143_ROOT_DENOMINATOR:" + selected.length + "/" +
      expectedRoots);
  const prefixSource = readMatches(prefixOption);
  const prefixes = replayPrefixIndex(prefixSource.matches);
  const maximumDepth = Number(option("--depth", 4));
  const nodeBudget = Number(option("--node-budget", 32768));
  const ttCapacity = Number(option("--tt-capacity", 8192));
  const cohortFile = path.resolve(option("--cohort", path.join(root,
    "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const loaded = loadCohort(root, cohortFile, role);
  const scenarios = scenarioIndex(loaded.scenarios);
  const simulator = await loadSimulator(root);
  const records = []; let missingScenarioCount = 0;

  for (let index = 0; index < selected.length; index += 1) {
    const source = selected[index]; const certificate = source.certificate;
    const replayPrefix = prefixes.get(source.key);
    const scenario = scenarios.get(source.scenarioFingerprint) ||
      scenarios.get(source.matchUrlId);
    if (!scenario) { missingScenarioCount += 1; continue; }
    if (!replayPrefix) throw new Error("BP143_PREFIX_MISSING:" + source.key);
    let evaluation = null;
    const branch = runReplayBranch(simulator.module, {
      frame: certificate.frame, hashLo: certificate.hashLo,
      hashHi: certificate.hashHi
    }, { actionCode: certificate.currentAction,
      argument: certificate.currentArgument }, scenario, source.candidateSeat,
    {}, null, "HISTORICAL", {
      diagnosticFinalActionOverride(engine) {
        const state = engine.adapter.state;
        if (evaluation || !state ||
            state.arrays[ARRAY.SCALAR][SCALAR.FRAME] !== certificate.frame ||
            state.hashLo !== certificate.hashLo ||
            state.hashHi !== certificate.hashHi) return null;
        evaluation = evaluateRoot(engine, certificate, maximumDepth,
          nodeBudget, ttCapacity);
        return null;
      }
    }, replayPrefix);
    const exact = exactEvidence(branch);
    if (!evaluation) throw new Error("BP143_ROOT_NOT_CAPTURED:" + source.key);
    records.push({ schemaVersion: 1,
      objectKind: "SEMANTIC_ATTACK_ONE_DEVIATION_EVENT_ROOT_V1",
      key: source.key, matchUrlId: source.matchUrlId,
      scenarioFingerprint: source.scenarioFingerprint,
      candidateSeat: source.candidateSeat, certificate,
      historicalLabel: source.historicalLabel,
      historicalTransition: source.historicalTransition,
      localValueClassification: source.classification, exact,
      quantifiers: {
        ownPolicy: "DIRECT_WITH_AT_MOST_ONE_OBSERVED_STATE_DEVIATION",
        enemyContinuation: "ALL_GENERATED_ACTIONS",
        chanceContinuation: "ALL_GENERATED_OUTCOMES",
        movementWorlds: MOVE_VARIANT_NAME.slice(),
        nonEventAtHorizon: "UNKNOWN",
        maximumDepth, nodeBudget, ttCapacity
      }, ...evaluation });
    process.stderr.write("[bp143-attack-event] " + (index + 1) + "/" +
      selected.length + "\n");
  }

  const summary = summarize(records);
  const accepted = missingScenarioCount === 0 &&
    records.length === selected.length &&
    summary.exactRootCount === records.length &&
    summary.budgetStopCount === 0 && summary.ttCapacityStopCount === 0 &&
    summary.supportLossCount === 0 &&
    summary.rootRestoreFailureCount === 0 && summary.hotAllocationCount === 0;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_ONE_DEVIATION_EVENT_OVERVIEW_V1",
    status: accepted ? "ACCEPT_ATTACK_EVENTS_CLASSIFIED" : "REJECTED",
    role, cohortFingerprint: loaded.manifest.fingerprint,
    sourceRootCount: certificateSource.roots.length, selection,
    selectedRootCount: selected.length, missingScenarioCount,
    maximumDepth, nodeBudget, ttCapacity, ...summary,
    decisionBoundary:
      "Strict positive attack-event proof only. UNKNOWN and non-executable cross-world policies cannot own an action."
  };
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp143-semantic-attack-one-deviation-event")));
  const lines = records.map(record => JSON.stringify(record)).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_ONE_DEVIATION_EVENT_MANIFEST_V1",
    status: overview.status, certificateSource: certificateSource.directory,
    prefixSource: path.resolve(prefixOption),
    certificateRootsSha256: sha256Bytes(certificateSource.bytes),
    prefixMatchesSha256: sha256Bytes(prefixSource.bytes),
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
  if (!accepted) throw new Error("BP143_ATTACK_EVENT_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { policyKey, mergePolicies, goalClassification,
  evaluateRoot, summarize, build };
