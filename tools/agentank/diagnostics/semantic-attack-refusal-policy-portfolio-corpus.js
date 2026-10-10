#!/usr/bin/env node
"use strict";

// BP141 evaluates a deliberately small portfolio of persistent named attack
// policies.  Policy identity is fixed for the complete horizon.  Every policy
// is evaluated independently against all generated enemy actions, all chance
// outcomes and all finite movement-rule worlds before a root policy is chosen.

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
const { VARIANT_COUNT } = require(
  "./semantic-attack-depth3-move-variant-shadow");
const { POLICY_KIND, POLICY_KIND_NAME, VALUE_RELATION,
  POINTWISE_RELATION, unpackVector, valueRelation,
  pointwiseRelation } = require("./semantic-attack-refusal-value-search");
const { VALUE_RELATION_NAME, POINTWISE_RELATION_NAME,
  localClassification, evaluateRoot } = require(
  "./semantic-attack-refusal-interval-corpus");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function policyComplete(evaluation) {
  return Boolean(evaluation && evaluation.variants.length === VARIANT_COUNT &&
    evaluation.variants.every(item => item.complete));
}

function selectRobustPolicy(evaluations, side) {
  let selected = null;
  for (let policyKind = 0; policyKind < evaluations.length; policyKind += 1) {
    const evaluation = evaluations[policyKind];
    if (!policyComplete(evaluation)) continue;
    let robustValue = 2147483647;
    const variantValues = new Array(VARIANT_COUNT);
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
      const value = evaluation.variants[variant][side + "Value"];
      variantValues[variant] = value;
      if (value < robustValue) robustValue = value;
    }
    if (!selected || robustValue > selected.robustValue) {
      selected = { complete: true, policyKind,
        policyName: POLICY_KIND_NAME[policyKind], robustValue, variantValues };
    }
  }
  return selected || { complete: false, policyKind: -1,
    policyName: "INCOMPLETE", robustValue: null, variantValues: [] };
}

function compareSelectedPolicies(evaluations, incumbent, candidate,
    requireCompletePortfolio = true) {
  const portfolioComplete = evaluations.length === POLICY_KIND.COUNT &&
    evaluations.every(policyComplete);
  const supportComplete = incumbent.complete && candidate.complete &&
    (!requireCompletePortfolio || portfolioComplete);
  const variants = [];
  for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
    if (!supportComplete) {
      variants.push({ name: "INCOMPLETE_" + variant, complete: false,
        valueRelation: VALUE_RELATION.INCOMPLETE,
        valueRelationName: VALUE_RELATION_NAME[VALUE_RELATION.INCOMPLETE],
        pointwiseRelation: POINTWISE_RELATION.INCOMPLETE,
        pointwiseRelationName:
          POINTWISE_RELATION_NAME[POINTWISE_RELATION.INCOMPLETE] });
      continue;
    }
    const incumbentVariant =
      evaluations[incumbent.policyKind].variants[variant];
    const candidateVariant =
      evaluations[candidate.policyKind].variants[variant];
    const relation = valueRelation(incumbentVariant.incumbentValue,
      candidateVariant.candidateValue, true);
    const pointwise = pointwiseRelation(incumbentVariant.incumbentCells,
      candidateVariant.candidateCells, incumbentVariant.enemyCount);
    variants.push({ name: incumbentVariant.name, complete: true,
      enemyCount: incumbentVariant.enemyCount,
      incumbentPolicyKind: incumbent.policyKind,
      incumbentPolicyName: incumbent.policyName,
      candidatePolicyKind: candidate.policyKind,
      candidatePolicyName: candidate.policyName,
      incumbentValue: incumbentVariant.incumbentValue,
      candidateValue: candidateVariant.candidateValue,
      incumbentVector: unpackVector(incumbentVariant.incumbentValue),
      candidateVector: unpackVector(candidateVariant.candidateValue),
      valueRelation: relation,
      valueRelationName: VALUE_RELATION_NAME[relation],
      pointwiseRelation: pointwise,
      pointwiseRelationName: POINTWISE_RELATION_NAME[pointwise],
      incumbentCells: incumbentVariant.incumbentCells,
      candidateCells: candidateVariant.candidateCells });
  }
  return { portfolioComplete, supportComplete, variants,
    classification: localClassification(variants) };
}

function evaluatePortfolio(engine, certificate, maximumDepth, nodeBudget) {
  const policies = [];
  let totalNodes = 0; let maximumNodes = 0;
  let rootRestoreFailureCount = 0; let hotAllocationCount = 0;
  let totalTtHits = 0; let totalLowerBoundCutoffs = 0;
  for (let policyKind = 0; policyKind < POLICY_KIND.COUNT; policyKind += 1) {
    const evaluation = evaluateRoot(engine, certificate, maximumDepth,
      nodeBudget, policyKind);
    let ttHits = 0; let lowerBoundCutoffs = 0;
    let policyDecisionCount = 0; let directRayDecisionCount = 0;
    let flankingDecisionCount = 0; let counterEscapeDecisionCount = 0;
    let fallbackDecisionCount = 0;
    for (const variant of evaluation.variants) {
      ttHits += variant.incumbentTtHits + variant.candidateTtHits;
      lowerBoundCutoffs += variant.incumbentLowerBoundCutoffs +
        variant.candidateLowerBoundCutoffs;
      policyDecisionCount += variant.incumbentPolicyDecisionCount +
        variant.candidatePolicyDecisionCount;
      directRayDecisionCount += variant.incumbentDirectRayDecisionCount +
        variant.candidateDirectRayDecisionCount;
      flankingDecisionCount += variant.incumbentFlankingDecisionCount +
        variant.candidateFlankingDecisionCount;
      counterEscapeDecisionCount +=
        variant.incumbentCounterEscapeDecisionCount +
        variant.candidateCounterEscapeDecisionCount;
      fallbackDecisionCount += variant.incumbentFallbackDecisionCount +
        variant.candidateFallbackDecisionCount;
    }
    policies.push({ policyKind, policyName: POLICY_KIND_NAME[policyKind],
      complete: policyComplete(evaluation), ttHits, lowerBoundCutoffs,
      policyDecisionCount, directRayDecisionCount, flankingDecisionCount,
      counterEscapeDecisionCount, fallbackDecisionCount,
      ...evaluation });
    totalNodes += evaluation.totalNodes;
    maximumNodes = Math.max(maximumNodes, evaluation.maximumNodes);
    rootRestoreFailureCount += evaluation.rootRestoreFailureCount;
    hotAllocationCount += evaluation.hotAllocationCount;
    totalTtHits += ttHits; totalLowerBoundCutoffs += lowerBoundCutoffs;
  }
  const incumbentSelection = selectRobustPolicy(policies, "incumbent");
  const candidateSelection = selectRobustPolicy(policies, "candidate");
  const comparison = compareSelectedPolicies(policies, incumbentSelection,
    candidateSelection, true);
  return { policies, incumbentSelection, candidateSelection, ...comparison,
    totalNodes, maximumNodes, totalTtHits, totalLowerBoundCutoffs,
    rootRestoreFailureCount, hotAllocationCount };
}

function summarize(records) {
  const output = { rootCount: records.length, exactRootCount: 0,
    completePortfolioCount: 0, incompletePortfolioCount: 0,
    completeVariantCount: 0, incompleteVariantCount: 0,
    classifications: {}, historicalCross: {},
    incumbentSelectedPolicies: {}, candidateSelectedPolicies: {},
    policyActivity: {},
    totalNodes: 0, maximumNodes: 0, totalTtHits: 0,
    totalLowerBoundCutoffs: 0, rootRestoreFailureCount: 0,
    hotAllocationCount: 0 };
  for (const record of records) {
    output.exactRootCount += record.exact ? 1 : 0;
    output.completePortfolioCount += record.portfolioComplete ? 1 : 0;
    output.incompletePortfolioCount += record.portfolioComplete ? 0 : 1;
    output.classifications[record.classification] =
      (output.classifications[record.classification] || 0) + 1;
    const cross = record.historicalLabel + "/" + record.classification;
    output.historicalCross[cross] = (output.historicalCross[cross] || 0) + 1;
    for (const variant of record.variants)
      if (variant.complete) output.completeVariantCount += 1;
      else output.incompleteVariantCount += 1;
    for (const side of ["incumbent", "candidate"]) {
      const name = record[side + "Selection"].policyName;
      const target = output[side + "SelectedPolicies"];
      target[name] = (target[name] || 0) + 1;
    }
    for (const policy of record.policies) {
      let activity = output.policyActivity[policy.policyName];
      if (!activity) activity = output.policyActivity[policy.policyName] = {
        policyDecisionCount: 0, directRayDecisionCount: 0,
        flankingDecisionCount: 0, counterEscapeDecisionCount: 0,
        fallbackDecisionCount: 0 };
      for (const field of Object.keys(activity)) activity[field] += policy[field];
    }
    output.totalNodes += record.totalNodes;
    output.maximumNodes = Math.max(output.maximumNodes, record.maximumNodes);
    output.totalTtHits += record.totalTtHits;
    output.totalLowerBoundCutoffs += record.totalLowerBoundCutoffs;
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
    throw new Error("BP141_SOURCE_REQUIRED");
  const replaySource = readRoots(replayOption);
  const labels = readRoots(labelsOption);
  const prefixSource = readMatches(prefixOption);
  const prefixes = replayPrefixIndex(prefixSource.matches);
  const selected = selectReplayRoots(replaySource.roots, labels.roots);
  const expectedRoots = Number(option("--expected-roots", 35));
  if (expectedRoots > 0 && selected.length !== expectedRoots)
    throw new Error("BP141_ROOT_DENOMINATOR:" + selected.length + "/" +
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
      throw new Error("BP141_REPLAY_PREFIX_MISSING:" + replay.key);
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
        evaluation = evaluatePortfolio(engine, certificate, maximumDepth,
          nodeBudget);
        return null;
      }
    }, replayPrefix);
    const exact = exactEvidence(branch);
    if (!evaluation) throw new Error("BP141_ROOT_NOT_CAPTURED:" + replay.key);
    records.push({ schemaVersion: 1,
      objectKind: "SEMANTIC_ATTACK_REFUSAL_POLICY_PORTFOLIO_ROOT_V1",
      key: replay.key, matchUrlId: replay.matchUrlId,
      scenarioFingerprint: replay.scenarioFingerprint,
      candidateSeat: replay.candidateSeat, certificate,
      historicalLabel: label.outcomeRelation,
      historicalPareto: label.paretoRelation,
      historicalTransition: replay.transition,
      geometry: label.geometry, exact,
      quantifiers: {
        ownContinuation: "ONE_PERSISTENT_NAMED_POLICY_PER_HORIZON",
        policyPortfolio: POLICY_KIND_NAME.slice(),
        rootPolicySelection: "MAXIMUM_CROSS_WORLD_WORST_VALUE",
        enemyContinuation: "ALL_GENERATED_ACTIONS",
        chanceContinuation: "ALL_GENERATED_OUTCOMES",
        movementWorlds: "ALL_FINITE_RULE_WORLDS",
        maximumDepth, nodeBudget
      }, ...evaluation });
    if ((index + 1) % 4 === 0 || index + 1 === selected.length)
      process.stderr.write("[bp141-policy-portfolio] " + (index + 1) + "/" +
        selected.length + "\n");
  }

  const summary = summarize(records);
  const q1NodeBaseline = Number(option("--q1-node-baseline", 333717));
  const accepted = missingScenarioCount === 0 &&
    records.length === selected.length &&
    summary.exactRootCount === records.length &&
    summary.completePortfolioCount === records.length &&
    summary.rootRestoreFailureCount === 0 && summary.hotAllocationCount === 0;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_REFUSAL_POLICY_PORTFOLIO_OVERVIEW_V1",
    status: accepted ? "ACCEPT_PERSISTENT_PORTFOLIO_CLASSIFIED" : "REJECTED",
    role, cohortFingerprint: loaded.manifest.fingerprint,
    selectedRootCount: selected.length, missingScenarioCount,
    maximumDepth, nodeBudget, q1NodeBaseline,
    nodeMultiplierVsQ1Bps: q1NodeBaseline > 0 ?
      Math.floor(summary.totalNodes * 10000 / q1NodeBaseline) : null,
    ...summary,
    decisionBoundary:
      "Diagnostic Shadow portfolio only. A named policy is fixed for the complete horizon. Historical labels remain audit columns. No result owns a production action."
  };
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp141-semantic-attack-refusal-policy-portfolio")));
  const lines = records.map(record => JSON.stringify(record)).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_REFUSAL_POLICY_PORTFOLIO_MANIFEST_V1",
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
  if (!accepted) throw new Error("BP141_POLICY_PORTFOLIO_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { policyComplete, selectRobustPolicy,
  compareSelectedPolicies, evaluatePortfolio, summarize, build };
