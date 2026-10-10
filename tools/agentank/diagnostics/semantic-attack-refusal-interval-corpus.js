#!/usr/bin/env node
"use strict";

// BP140-Q1 reaches each exact historical root once, then evaluates incumbent
// and candidate under the refusal-aware fixed-policy AND search in every
// finite movement-rule world.  No result owns a production action.

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
const {
  VALUE_RELATION,
  POINTWISE_RELATION,
  unpackVector,
  valueRelation,
  pointwiseRelation,
  RefusalAwareEventValueSearch
} = require("./semantic-attack-refusal-value-search");

const VALUE_RELATION_NAME = Object.freeze(["INCOMPLETE", "CANDIDATE_HIGHER",
  "EQUAL", "CANDIDATE_LOWER"]);
const POINTWISE_RELATION_NAME = Object.freeze(["INCOMPLETE",
  "CANDIDATE_DOMINATES", "EQUAL", "INCUMBENT_DOMINATES", "MIXED"]);

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function copyCells(search, count) {
  const output = new Array(count);
  for (let at = 0; at < count; at += 1)
    output[at] = search.rootColumnValue[at];
  return output;
}

function localClassification(variants) {
  if (!variants.length || variants.some(item => !item.complete))
    return "INCOMPLETE";
  const candidate = variants.every(item =>
    item.valueRelation === VALUE_RELATION.CANDIDATE_HIGHER &&
    item.pointwiseRelation === POINTWISE_RELATION.CANDIDATE_DOMINATES);
  if (candidate) return "LOCAL_ROBUST_CANDIDATE";
  const incumbent = variants.every(item =>
    item.valueRelation === VALUE_RELATION.CANDIDATE_LOWER &&
    item.pointwiseRelation === POINTWISE_RELATION.INCUMBENT_DOMINATES);
  if (incumbent) return "LOCAL_ROBUST_INCUMBENT";
  const relation = variants[0].valueRelation;
  if (variants.every(item => item.valueRelation === relation))
    return relation === VALUE_RELATION.EQUAL ? "LOCAL_EQUAL" :
      "LOCAL_TRADEOFF";
  return "RULE_WORLD_DISAGREEMENT";
}

function evaluateRoot(engine, certificate, maximumDepth, nodeBudget,
    policyKind = 0) {
  const bundle = engine.adapter.bundle; const state = bundle?.state;
  if (!state) throw new Error("BP140Q1_FAST_STATE_MISSING");
  const originalKernel = bundle.kernel; const originalHazard = bundle.hazard;
  const originalHard = bundle.hard; const beforeLo = state.hashLo;
  const beforeHi = state.hashHi; const beforeDelta = state.deltaUsed;
  const beforeEvent = state.eventUsed; const variants = [];
  let rootRestoreFailureCount = 0; let hotAllocationCount = 0;
  let totalNodes = 0; let maximumNodes = 0;
  try {
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
      const kernel = new MoveContestVariantKernel(state, MOVE_VARIANTS[variant]);
      const hazard = new HazardKernel(state);
      const hard = new HardGate(kernel, hazard, 0);
      const search = new RefusalAwareEventValueSearch(nodeBudget, policyKind);
      bundle.kernel = kernel; bundle.hazard = hazard; bundle.hard = hard;
      const incumbentValue = search.evaluateRoot(bundle,
        certificate.currentAction, certificate.currentArgument,
        engine.enemyActions, engine.enemyArguments, engine.enemyCount,
        maximumDepth, nodeBudget);
      const incumbentComplete = Boolean(search.lastSupportComplete);
      const incumbentCells = copyCells(search, engine.enemyCount);
      const incumbentNodes = search.nodes;
      const incumbentLowerBoundCutoffs =
        search.absoluteLowerBoundCutoffCount;
      const incumbentTtHits = search.ttHits;
      const incumbentPolicyDecisionCount = search.policyDecisionCount;
      const incumbentDirectRayDecisionCount = search.directRayDecisionCount;
      const incumbentFlankingDecisionCount = search.flankingDecisionCount;
      const incumbentCounterEscapeDecisionCount =
        search.counterEscapeDecisionCount;
      const incumbentFallbackDecisionCount = search.fallbackDecisionCount;
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
      const candidateLowerBoundCutoffs =
        search.absoluteLowerBoundCutoffCount;
      const candidateTtHits = search.ttHits;
      const candidatePolicyDecisionCount = search.policyDecisionCount;
      const candidateDirectRayDecisionCount = search.directRayDecisionCount;
      const candidateFlankingDecisionCount = search.flankingDecisionCount;
      const candidateCounterEscapeDecisionCount =
        search.counterEscapeDecisionCount;
      const candidateFallbackDecisionCount = search.fallbackDecisionCount;
      rootRestoreFailureCount += search.rootRestoreFailures;
      hotAllocationCount += search.hotAllocationCount +
        (search.settlement?.hotAllocationCount || 0);
      const complete = incumbentComplete && candidateComplete;
      const relation = valueRelation(incumbentValue, candidateValue, complete);
      const pointwise = complete ? pointwiseRelation(incumbentCells,
        candidateCells, engine.enemyCount) : POINTWISE_RELATION.INCOMPLETE;
      totalNodes += incumbentNodes + candidateNodes;
      maximumNodes = Math.max(maximumNodes, incumbentNodes, candidateNodes);
      variants.push({ name: MOVE_VARIANT_NAME[variant], complete,
        enemyCount: engine.enemyCount,
        incumbentValue, candidateValue,
        incumbentVector: unpackVector(incumbentValue),
        candidateVector: unpackVector(candidateValue),
        valueRelation: relation,
        valueRelationName: VALUE_RELATION_NAME[relation],
        pointwiseRelation: pointwise,
        pointwiseRelationName: POINTWISE_RELATION_NAME[pointwise],
        incumbentCells, candidateCells, incumbentNodes, candidateNodes,
        incumbentLowerBoundCutoffs, candidateLowerBoundCutoffs,
        incumbentTtHits, candidateTtHits,
        incumbentPolicyDecisionCount, candidatePolicyDecisionCount,
        incumbentDirectRayDecisionCount, candidateDirectRayDecisionCount,
        incumbentFlankingDecisionCount, candidateFlankingDecisionCount,
        incumbentCounterEscapeDecisionCount,
        candidateCounterEscapeDecisionCount,
        incumbentFallbackDecisionCount, candidateFallbackDecisionCount });
      if (state.hashLo !== beforeLo || state.hashHi !== beforeHi ||
          state.deltaUsed !== beforeDelta || state.eventUsed !== beforeEvent)
        rootRestoreFailureCount += 1;
    }
  } finally {
    bundle.kernel = originalKernel; bundle.hazard = originalHazard;
    bundle.hard = originalHard;
  }
  return { variants, classification: localClassification(variants),
    totalNodes, maximumNodes, rootRestoreFailureCount, hotAllocationCount };
}

function summarize(records) {
  const output = { rootCount: records.length, exactRootCount: 0,
    classifications: {}, historicalCross: {}, completeVariantCount: 0,
    incompleteVariantCount: 0, totalNodes: 0, maximumNodes: 0,
    rootRestoreFailureCount: 0, hotAllocationCount: 0 };
  for (const record of records) {
    output.exactRootCount += record.exact ? 1 : 0;
    output.classifications[record.classification] =
      (output.classifications[record.classification] || 0) + 1;
    const cross = record.historicalLabel + "/" + record.classification;
    output.historicalCross[cross] = (output.historicalCross[cross] || 0) + 1;
    for (const variant of record.variants)
      if (variant.complete) output.completeVariantCount += 1;
      else output.incompleteVariantCount += 1;
    output.totalNodes += record.totalNodes;
    output.maximumNodes = Math.max(output.maximumNodes, record.maximumNodes);
    output.rootRestoreFailureCount += record.rootRestoreFailureCount;
    output.hotAllocationCount += record.hotAllocationCount;
  }
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const replayOption = option("--replay-source");
  const labelsOption = option("--labels");
  const prefixOption = option("--prefix-source");
  if (!replayOption || !labelsOption || !prefixOption)
    throw new Error("BP140Q1_SOURCE_REQUIRED");
  const replaySource = readRoots(replayOption);
  const labels = readRoots(labelsOption);
  const prefixSource = readMatches(prefixOption);
  const prefixes = replayPrefixIndex(prefixSource.matches);
  const selected = selectReplayRoots(replaySource.roots, labels.roots);
  const expectedRoots = Number(option("--expected-roots", 35));
  if (expectedRoots > 0 && selected.length !== expectedRoots)
    throw new Error("BP140Q1_ROOT_DENOMINATOR:" + selected.length + "/" +
      expectedRoots);
  const maximumDepth = Number(option("--depth", 4));
  const nodeBudget = Number(option("--node-budget", 4096));
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
    const scenario = scenarios.get(replay.scenarioFingerprint) ||
      scenarios.get(replay.matchUrlId);
    if (!scenario) { missingScenarioCount += 1; continue; }
    if (!replayPrefix)
      throw new Error("BP140Q1_REPLAY_PREFIX_MISSING:" + replay.key);
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
        evaluation = evaluateRoot(engine, certificate, maximumDepth, nodeBudget);
        return null;
      }
    }, replayPrefix);
    const exact = exactEvidence(branch);
    if (!evaluation)
      throw new Error("BP140Q1_ROOT_NOT_CAPTURED:" + replay.key);
    records.push({ schemaVersion: 1,
      objectKind: "SEMANTIC_ATTACK_REFUSAL_INTERVAL_ROOT_V1",
      key: replay.key, matchUrlId: replay.matchUrlId,
      scenarioFingerprint: replay.scenarioFingerprint,
      candidateSeat: replay.candidateSeat, certificate,
      historicalLabel: label.outcomeRelation,
      historicalPareto: label.paretoRelation,
      historicalTransition: replay.transition,
      geometry: label.geometry, exact,
      quantifiers: {
        ownContinuation: "FIXED_REPLANNING_ATTACK_POLICY",
        enemyContinuation: "ALL_GENERATED_ACTIONS",
        chanceContinuation: "ALL_GENERATED_OUTCOMES",
        movementWorlds: MOVE_VARIANT_NAME.slice(),
        maximumDepth, nodeBudget
      }, ...evaluation });
    if ((index + 1) % 4 === 0 || index + 1 === selected.length)
      process.stderr.write("[bp140q1-refusal] " + (index + 1) + "/" +
        selected.length + "\n");
  }

  const summary = summarize(records);
  const accepted = missingScenarioCount === 0 &&
    records.length === selected.length &&
    summary.exactRootCount === records.length &&
    summary.rootRestoreFailureCount === 0 && summary.hotAllocationCount === 0;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_REFUSAL_INTERVAL_OVERVIEW_V1",
    status: accepted ? "ACCEPT_LOCAL_REFUSAL_CLASSIFIED" : "REJECTED",
    role, cohortFingerprint: loaded.manifest.fingerprint,
    selectedRootCount: selected.length, missingScenarioCount,
    maximumDepth, nodeBudget, ...summary,
    decisionBoundary:
      "Diagnostic local value only. Historical labels are audit columns, not supervision. No local certificate owns a production action."
  };
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp140q1-semantic-attack-refusal-interval")));
  const lines = records.map(record => JSON.stringify(record)).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_REFUSAL_INTERVAL_MANIFEST_V1",
    status: overview.status, replaySource: replaySource.directory,
    labelSource: labels.directory, prefixSource: path.resolve(prefixOption),
    replayRootsSha256: sha256Bytes(replaySource.bytes),
    labelRootsSha256: sha256Bytes(labels.bytes),
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
  if (!accepted) throw new Error("BP140Q1_REFUSAL_INTERVAL_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { VALUE_RELATION_NAME, POINTWISE_RELATION_NAME, copyCells,
  localClassification, evaluateRoot, summarize, build };
