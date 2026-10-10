#!/usr/bin/env node
"use strict";

// BP128 labels every completed paired-search comparison, not only scalar
// positives.  The corpus exposes false positives and false negatives of the
// finite-depth value while preserving outcome, death, kill and stars as
// separate terminal dimensions.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { loadCohort } = require("./v2-native-initiative-arena");
const { runReplayBranch } = require("./root-counterfactual-labels");
const { readMatches, rootKey, sourceTerminal, terminalDimensions,
  scenarioIndex, exactEvidence, transition } = require(
  "./semantic-attack-certificate-root-corpus");
const { outcomeRank } = require("./semantic-attack-chance-interval-corpus");
const { POLICY_RELATION } = require("./semantic-attack-policy-interval-shadow");

const POLICY_RELATION_NAME = Object.freeze({
  [POLICY_RELATION.CANDIDATE_HIGHER]: "CANDIDATE_HIGHER",
  [POLICY_RELATION.EQUAL]: "EQUAL",
  [POLICY_RELATION.CANDIDATE_LOWER]: "CANDIDATE_LOWER"
});

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function extractComparisons(matches) {
  const roots = []; const seen = new Set();
  let completeCount = 0; let comparisonCount = 0;
  let overflowCount = 0; let missingCandidateCount = 0;
  for (const match of matches) {
    const shadow = match.candidateEngine?.semanticAttackPolicyIntervalShadow;
    if (!shadow) continue;
    completeCount += shadow.completeCount || 0;
    comparisonCount += shadow.comparisonCount || 0;
    overflowCount += shadow.comparisonOverflowCount || 0;
    missingCandidateCount += shadow.comparisonMissingCandidateCount || 0;
    for (const comparison of shadow.comparisonRoots || []) {
      const key = rootKey(match, comparison);
      if (seen.has(key)) throw new Error("BP128_COMPARISON_DUPLICATE:" + key);
      seen.add(key);
      roots.push({ key, matchUrlId: match.matchUrlId,
        scenarioFingerprint: match.scenarioFingerprint,
        candidateSeat: match.candidateSeat, seatSkills: match.seatSkills,
        sourceOutcome: match.analysisOutcome,
        sourceTerminalCategory: match.terminalCategory,
        sourceTerminal: sourceTerminal(match), comparison,
        replayPrefix: {
          seatSkills: match.seatSkills,
          candidateActionStream: match.candidateEngine.compactActionStream,
          candidateArguments: match.candidateEngine.compactArguments || [],
          controlActionStream: match.control?.compactActionStream || "",
          controlArguments: match.control?.compactArguments || []
        } });
    }
  }
  return { roots, completeCount, comparisonCount, overflowCount,
    missingCandidateCount };
}

function outcomeRelation(incumbent, candidate) {
  const delta = outcomeRank(candidate.outcome) - outcomeRank(incumbent.outcome);
  return delta > 0 ? "CANDIDATE_BETTER" :
    delta < 0 ? "INCUMBENT_BETTER" : "EQUAL";
}

function paretoRelation(incumbent, candidate) {
  const left = terminalDimensions(incumbent);
  const right = terminalDimensions(candidate);
  const candidateNoWorse = outcomeRank(candidate.outcome) >=
      outcomeRank(incumbent.outcome) && Number(right.death) <= Number(left.death) &&
    Number(right.kill) >= Number(left.kill) && right.starDiff >= left.starDiff;
  const candidateStrict = outcomeRank(candidate.outcome) >
      outcomeRank(incumbent.outcome) || Number(right.death) < Number(left.death) ||
    Number(right.kill) > Number(left.kill) || right.starDiff > left.starDiff;
  if (candidateNoWorse && candidateStrict) return "CANDIDATE_DOMINATES";
  const incumbentNoWorse = outcomeRank(incumbent.outcome) >=
      outcomeRank(candidate.outcome) && Number(left.death) <= Number(right.death) &&
    Number(left.kill) >= Number(right.kill) && left.starDiff >= right.starDiff;
  const incumbentStrict = outcomeRank(incumbent.outcome) >
      outcomeRank(candidate.outcome) || Number(left.death) < Number(right.death) ||
    Number(left.kill) > Number(right.kill) || left.starDiff > right.starDiff;
  if (incumbentNoWorse && incumbentStrict) return "INCUMBENT_DOMINATES";
  if (!candidateStrict && !incumbentStrict) return "EQUAL";
  return "MIXED";
}

function emptyBucket() {
  return { count: 0, outcome: { CANDIDATE_BETTER: 0, EQUAL: 0,
    INCUMBENT_BETTER: 0 }, pareto: { CANDIDATE_DOMINATES: 0,
    INCUMBENT_DOMINATES: 0, EQUAL: 0, MIXED: 0 }, transitions: {},
    incumbent: { nonloss: 0, kill: 0, death: 0, starDiff: 0 },
    candidate: { nonloss: 0, kill: 0, death: 0, starDiff: 0 },
    delta: { nonloss: 0, kill: 0, death: 0, starDiff: 0 } };
}

function addDimensions(target, values) {
  target.nonloss += values.nonloss ? 1 : 0;
  target.kill += values.kill ? 1 : 0;
  target.death += values.death ? 1 : 0;
  target.starDiff += values.starDiff;
}

function summarize(records) {
  const byPolicyRelation = {};
  for (const record of records) {
    const bucket = byPolicyRelation[record.policyRelation] ||
      (byPolicyRelation[record.policyRelation] = emptyBucket());
    bucket.count += 1; bucket.outcome[record.outcomeRelation] += 1;
    bucket.pareto[record.paretoRelation] += 1;
    bucket.transitions[record.transition] =
      (bucket.transitions[record.transition] || 0) + 1;
    addDimensions(bucket.incumbent, record.incumbent.dimensions);
    addDimensions(bucket.candidate, record.candidate.dimensions);
  }
  for (const bucket of Object.values(byPolicyRelation))
    for (const key of Object.keys(bucket.delta))
      bucket.delta[key] = bucket.candidate[key] - bucket.incumbent[key];
  const higher = byPolicyRelation.CANDIDATE_HIGHER || emptyBucket();
  const equal = byPolicyRelation.EQUAL || emptyBucket();
  const lower = byPolicyRelation.CANDIDATE_LOWER || emptyBucket();
  return { recordCount: records.length, byPolicyRelation,
    scalarOutcomeConfusion: {
      truePositive: higher.outcome.CANDIDATE_BETTER,
      falsePositive: higher.outcome.INCUMBENT_BETTER,
      higherOutcomeEqual: higher.outcome.EQUAL,
      equalMissedPositive: equal.outcome.CANDIDATE_BETTER,
      equalMissedNegative: equal.outcome.INCUMBENT_BETTER,
      equalOutcomeEqual: equal.outcome.EQUAL,
      falseNegative: lower.outcome.CANDIDATE_BETTER,
      trueNegative: lower.outcome.INCUMBENT_BETTER,
      lowerOutcomeEqual: lower.outcome.EQUAL
    } };
}

function actionRow(actionCode, argument) { return { actionCode, argument }; }

async function build(root = defaultWorkspaceRoot()) {
  const sourceOption = option("--source");
  if (!sourceOption) throw new Error("BP128_SOURCE_REQUIRED");
  const sourceDirectory = path.resolve(sourceOption);
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp128-semantic-attack-comparison-roots")));
  const cohortFile = path.resolve(option("--cohort", path.join(root,
    "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const expectedRoots = Number(option("--expected-roots", 211));
  const source = readMatches(sourceDirectory);
  const extracted = extractComparisons(source.matches);
  if (extracted.overflowCount)
    throw new Error("BP128_COMPARISON_OVERFLOW:" + extracted.overflowCount);
  if (extracted.missingCandidateCount)
    throw new Error("BP128_COMPARISON_MISSING_CANDIDATE:" +
      extracted.missingCandidateCount);
  if (extracted.completeCount !== extracted.comparisonCount ||
      extracted.comparisonCount !== extracted.roots.length)
    throw new Error("BP128_COMPARISON_DENOMINATOR:" +
      [extracted.completeCount, extracted.comparisonCount,
        extracted.roots.length].join("/"));
  if (expectedRoots > 0 && extracted.roots.length !== expectedRoots)
    throw new Error("BP128_EXPECTED_ROOTS:" + extracted.roots.length + "/" +
      expectedRoots);

  const loaded = loadCohort(root, cohortFile, role);
  const byScenario = scenarioIndex(loaded.scenarios);
  const simulator = await loadSimulator(root);
  const records = []; let missingScenarioCount = 0;
  for (let index = 0; index < extracted.roots.length; index += 1) {
    const item = extracted.roots[index];
    const scenario = byScenario.get(item.scenarioFingerprint) ||
      byScenario.get(item.matchUrlId);
    if (!scenario) { missingScenarioCount += 1; continue; }
    const identity = { frame: item.comparison.frame,
      hashLo: item.comparison.hashLo, hashHi: item.comparison.hashHi };
    const incumbent = runReplayBranch(simulator.module, identity,
      actionRow(item.comparison.currentAction,
        item.comparison.currentArgument), scenario, item.candidateSeat, {},
      null, "HISTORICAL", null, item.replayPrefix);
    const candidate = runReplayBranch(simulator.module, identity,
      actionRow(item.comparison.candidateAction,
        item.comparison.candidateArgument), scenario, item.candidateSeat, {},
      null, "HISTORICAL", null, item.replayPrefix);
    const incumbentDimensions = terminalDimensions(incumbent.terminal);
    const candidateDimensions = terminalDimensions(candidate.terminal);
    records.push({ schemaVersion: 1,
      objectKind: "SEMANTIC_ATTACK_COMPARISON_ROOT_V1", key: item.key,
      matchUrlId: item.matchUrlId,
      scenarioFingerprint: item.scenarioFingerprint,
      candidateSeat: item.candidateSeat, seatSkills: item.seatSkills,
      sourceOutcome: item.sourceOutcome,
      sourceTerminalCategory: item.sourceTerminalCategory,
      comparison: item.comparison,
      policyRelation: POLICY_RELATION_NAME[item.comparison.policyRelation] ||
        "UNKNOWN",
      quantifiers: { basePolicy: "V2_PRODUCTION_OBSERVABLE",
        enemyPolicy: "V3_HISTORICAL_CONTROLLER",
        chanceOutcome: "HISTORICAL", exactControllerHistory: true },
      incumbent: { terminal: incumbent.terminal,
        dimensions: incumbentDimensions, evidence: incumbent.evidence,
        exact: exactEvidence(incumbent),
        sourceTerminalReproduced:
          JSON.stringify(item.sourceTerminal) === JSON.stringify(incumbent.terminal) },
      candidate: { terminal: candidate.terminal,
        dimensions: candidateDimensions, evidence: candidate.evidence,
        exact: exactEvidence(candidate) },
      outcomeRelation: outcomeRelation(incumbent.terminal, candidate.terminal),
      paretoRelation: paretoRelation(incumbent.terminal, candidate.terminal),
      transition: transition(incumbent.terminal, candidate.terminal) });
    if ((index + 1) % 16 === 0 || index + 1 === extracted.roots.length)
      process.stderr.write("[bp128-comparison] " + (index + 1) + "/" +
        extracted.roots.length + "\n");
  }

  const exactIncumbentCount = records.filter(r => r.incumbent.exact).length;
  const exactCandidateCount = records.filter(r => r.candidate.exact).length;
  const sourceReproductionCount = records.filter(
    r => r.incumbent.sourceTerminalReproduced).length;
  const summary = summarize(records);
  const accepted = missingScenarioCount === 0 &&
    records.length === extracted.roots.length &&
    exactIncumbentCount === records.length &&
    exactCandidateCount === records.length &&
    sourceReproductionCount === records.length;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_COMPARISON_ROOT_CORPUS_OVERVIEW_V1",
    status: accepted ? "ACCEPTED" : "REJECTED", role,
    cohortFingerprint: loaded.manifest.fingerprint,
    sourceMatchCount: source.matches.length,
    completeCount: extracted.completeCount,
    comparisonCount: extracted.comparisonCount,
    comparisonOverflowCount: extracted.overflowCount,
    comparisonMissingCandidateCount: extracted.missingCandidateCount,
    missingScenarioCount, exactIncumbentCount, exactCandidateCount,
    sourceReproductionCount, ...summary,
    quantifierBoundary:
      "BP128 is exact historical EnemyPolicy and Chance only; it diagnoses finite-depth direction and does not activate an owner." };
  const lines = records.map(record => JSON.stringify(record)).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_COMPARISON_ROOT_CORPUS_MANIFEST_V1",
    status: overview.status, sourceDirectory,
    sourceManifestSha256: sha256Bytes(fs.readFileSync(path.join(sourceDirectory,
      "manifest.json"))), sourceOverviewSha256: sha256Bytes(fs.readFileSync(
      path.join(sourceDirectory, "overview.json"))),
    sourceMatchesSha256: sha256Bytes(source.bytes), cohortFile,
    cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    productionRootSha256: sha256Bytes(fs.readFileSync(productionFile)),
    rootsSha256: sha256Bytes(bytes), rootCount: records.length,
    arguments: process.argv.slice(2), fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"), bytes);
  process.stdout.write(JSON.stringify({ output: outputDirectory, overview,
    fingerprint: manifest.fingerprint }, null, 2) + "\n");
  if (!accepted) throw new Error("BP128_COMPARISON_CORPUS_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { POLICY_RELATION_NAME, extractComparisons, outcomeRelation,
  paretoRelation, emptyBucket, summarize, build };
