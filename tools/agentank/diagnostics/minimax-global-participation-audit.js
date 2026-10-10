#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { fingerprintObject, sha256Bytes } = require("../core/hash");

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function inputOptions() {
  const output = [];
  for (let index = 0; index < process.argv.length; index += 1)
    if (process.argv[index] === "--input" && process.argv[index + 1])
      output.push(path.resolve(process.argv[index + 1]));
  return output;
}

function readRun(directory) {
  const overviewFile = path.join(directory, "overview.json");
  const manifestFile = path.join(directory, "manifest.json");
  const matchesFile = path.join(directory, "matches.ndjson.gz");
  const text = zlib.gunzipSync(fs.readFileSync(matchesFile)).toString("utf8").trim();
  return {
    directory,
    overview: JSON.parse(fs.readFileSync(overviewFile, "utf8")),
    manifest: JSON.parse(fs.readFileSync(manifestFile, "utf8")),
    matches: text ? text.split(/\n/).map(JSON.parse) : [],
    hashes: {
      overview: sha256Bytes(fs.readFileSync(overviewFile)),
      manifest: sha256Bytes(fs.readFileSync(manifestFile)),
      matches: sha256Bytes(fs.readFileSync(matchesFile))
    }
  };
}

function add(target, key, value) {
  target[key] += Number.isFinite(value) ? value : 0;
}

function summarize(matches, implementation) {
  const result = {
    implementation,
    matches: 0,
    decisions: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    candidateStars: 0,
    controlStars: 0,
    candidateCrashes: 0,
    controlCrashes: 0,
    fire: 0,
    candidateRuntimeMicros: 0,
    contactRoots: 0,
    exactContactRoots: 0,
    inexactContactRoots: 0,
    valueBudgetRoots: 0,
    valueBudgetBlockedRoots: 0,
    informationConsumerBlockedRoots: 0,
    searchAttemptRoots: 0,
    searchCompletedRoots: 0,
    physicalSearchRoots: 0,
    informationSearchRoots: 0,
    searchNodes: 0,
    stageMatrixSolves: 0,
    completeValueOwners: 0,
    incompleteValueOwners: 0,
    incompleteValueEvidenceOnly: 0,
    timeoutError: 0,
    avoidableHardReject: 0,
    riskDominatedSelection: 0,
    rootRestoreFailure: 0
  };
  for (const match of matches) {
    if (match.implementation !== implementation) continue;
    const engine = match.candidateEngine || {};
    const funnel = engine.contactSearchFunnel || {};
    const schedule = engine.runtimeSchedule || {};
    const layers = engine.layerTotals || {};
    result.matches += 1;
    add(result, "decisions", engine.decisionCount);
    if (match.analysisOutcome === "V2_WIN") result.wins += 1;
    else if (match.analysisOutcome === "DRAW") result.draws += 1;
    else result.losses += 1;
    add(result, "candidateStars", match.counts?.stars?.[match.candidateSeat]);
    add(result, "controlStars", match.counts?.stars?.[match.candidateSeat ^ 1]);
    add(result, "candidateCrashes", match.counts?.crashes?.[match.candidateSeat]);
    add(result, "controlCrashes", match.counts?.crashes?.[match.candidateSeat ^ 1]);
    add(result, "fire", match.candidate?.actionCounts?.fire);
    add(result, "candidateRuntimeMicros", match.candidate?.totalRuntimeMicros);
    add(result, "exactContactRoots", funnel.exact);
    add(result, "inexactContactRoots", funnel.inexact);
    add(result, "valueBudgetRoots", funnel.valueBudget);
    add(result, "valueBudgetBlockedRoots", funnel.valueBudgetBlocked);
    add(result, "informationConsumerBlockedRoots", funnel.informationConsumerBlocked);
    add(result, "searchAttemptRoots", schedule.searchAttemptFrames);
    add(result, "searchCompletedRoots", schedule.searchFrames);
    add(result, "physicalSearchRoots", schedule.physicalSearchFrames);
    add(result, "informationSearchRoots", schedule.informationSearchFrames);
    add(result, "searchNodes", schedule.searchNodes);
    add(result, "stageMatrixSolves", layers.stageMatrixSolves);
    add(result, "completeValueOwners", layers.completeValueOwners);
    add(result, "incompleteValueOwners", layers.incompleteValueOwners);
    add(result, "incompleteValueEvidenceOnly", layers.incompleteValueEvidenceOnly);
    add(result, "timeoutError", match.candidate?.timeoutCount);
    add(result, "timeoutError", match.candidate?.errorCount);
    add(result, "avoidableHardReject", layers.avoidableHardRejects);
    add(result, "riskDominatedSelection", layers.riskDominatedSelections);
    add(result, "rootRestoreFailure", layers.depthRootRestoreFailures);
  }
  result.contactRoots = result.exactContactRoots + result.inexactContactRoots;
  result.scoreBasisPoints = Math.round((result.wins * 2 + result.draws) * 5000 /
    Math.max(1, result.matches));
  result.searchParticipationBasisPoints = Math.round(result.searchCompletedRoots * 10000 /
    Math.max(1, result.contactRoots));
  result.inexactBlockedBasisPoints = Math.round(result.informationConsumerBlockedRoots * 10000 /
    Math.max(1, result.inexactContactRoots));
  result.nodesPerCompletedRoot = Math.round(result.searchNodes /
    Math.max(1, result.searchCompletedRoots));
  result.informationEvidenceOnlyRoots = Math.min(result.informationSearchRoots,
    result.incompleteValueEvidenceOnly);
  return result;
}

function paired(run, baselineImplementation, candidateImplementation) {
  const pairs = new Map();
  for (const match of run.matches) {
    const key = `${match.matchUrlId}:${match.candidateSeat}`;
    const pair = pairs.get(key) || {};
    pair[match.implementation] = match;
    pairs.set(key, pair);
  }
  const transitions = {};
  let completePairs = 0; let actionMismatchMatches = 0;
  let sharedRiskDominatedMatches = 0;
  for (const pair of pairs.values()) {
    const baseline = pair[baselineImplementation];
    const candidate = pair[candidateImplementation];
    if (!baseline || !candidate) continue;
    completePairs += 1;
    const transition = `${baseline.analysisOutcome}->${candidate.analysisOutcome}`;
    transitions[transition] = (transitions[transition] || 0) + 1;
    if (baseline.candidate?.compactActionStream !== candidate.candidate?.compactActionStream)
      actionMismatchMatches += 1;
    if ((baseline.candidateEngine?.layerTotals?.riskDominatedSelections || 0) > 0 &&
        (candidate.candidateEngine?.layerTotals?.riskDominatedSelections || 0) > 0 &&
        baseline.candidate?.compactActionStream === candidate.candidate?.compactActionStream)
      sharedRiskDominatedMatches += 1;
  }
  return { completePairs, actionMismatchMatches, sharedRiskDominatedMatches, transitions };
}

function analyzeRun(run) {
  const baselineImplementation = run.overview.baseline?.implementation;
  const candidateImplementation = run.overview.candidate?.implementation;
  const baseline = summarize(run.matches, baselineImplementation);
  const candidate = candidateImplementation ? summarize(run.matches,
    candidateImplementation) : null;
  return {
    experiment: run.overview.experiment,
    cohortFingerprint: run.overview.cohortFingerprint,
    scenarios: run.overview.scenarios,
    source: run.overview.source,
    hashes: run.hashes,
    baseline,
    candidate,
    paired: candidate ? paired(run, baselineImplementation, candidateImplementation) : null,
    delta: candidate ? {
      scoreBasisPoints: candidate.scoreBasisPoints - baseline.scoreBasisPoints,
      wins: candidate.wins - baseline.wins,
      losses: candidate.losses - baseline.losses,
      draws: candidate.draws - baseline.draws,
      candidateStars: candidate.candidateStars - baseline.candidateStars,
      candidateCrashes: candidate.candidateCrashes - baseline.candidateCrashes,
      fire: candidate.fire - baseline.fire,
      candidateRuntimeMicros: candidate.candidateRuntimeMicros -
        baseline.candidateRuntimeMicros
    } : null
  };
}

function verdicts(analyses) {
  const output = [];
  const physical = analyses.find(value => value.experiment === "NO_PRIMITIVE_SEARCH");
  if (physical) {
    if (physical.delta.scoreBasisPoints < 0)
      output.push("KEEP_EXACT_PHYSICAL_MINIMAX_NET_POSITIVE");
    if (physical.baseline.searchParticipationBasisPoints < 1000)
      output.push("CURRENT_MINIMAX_PARTICIPATION_SPARSE");
    if (physical.baseline.informationConsumerBlockedRoots ===
        physical.baseline.inexactContactRoots)
      output.push("INEXACT_CONTACT_HAS_NO_VALUE_CONSUMER");
  }
  const information = analyses.find(value => value.experiment === "INFORMATION_VALUE");
  if (information?.candidate) {
    if (information.candidate.informationEvidenceOnlyRoots ===
        information.candidate.informationSearchRoots)
      output.push("INFORMATION_SEARCH_ALL_EVIDENCE_ONLY");
    if (information.delta.candidateRuntimeMicros > 0 &&
        information.delta.scoreBasisPoints < 0)
      output.push("UNGATED_INFORMATION_WORK_CAUSES_RUNTIME_AND_OUTCOME_REGRESSION");
  }
  output.push("NEXT_SEARCH_CONTRACT_CHALLENGER_AND_CONSUMER_GATED_VERIFIER");
  return output;
}

function analyze(directories) {
  const runs = directories.map(readRun);
  const analyses = runs.map(analyzeRun);
  const report = {
    schemaVersion: 1,
    objectKind: "MINIMAX_GLOBAL_PARTICIPATION_AUDIT_V1",
    productionBehaviorChanged: false,
    analyses,
    verdicts: verdicts(analyses),
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject({ ...report, fingerprint: "" });
  return report;
}

function run() {
  const inputs = inputOptions();
  if (!inputs.length) throw new Error("MINIMAX_GLOBAL_AUDIT_INPUT_REQUIRED");
  const output = path.resolve(option("--output",
    "/tmp/agentank-minimax-global-participation-audit.json"));
  const report = analyze(inputs);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, fingerprint: report.fingerprint,
    verdicts: report.verdicts }, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try { run(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { readRun, summarize, paired, analyzeRun, verdicts, analyze, run };
