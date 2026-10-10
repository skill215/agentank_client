#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { runPairedArena } = require("../simulation/paired-arena");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function positiveInteger(name, fallback) {
  const value = Number(option(name, fallback));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function sha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

function add(target, key, amount = 1) { target[key] = (target[key] || 0) + amount; }

function summarize(matches, label) {
  const output = { label, matches: matches.length, v2Wins: 0, v1Wins: 0, draws: 0,
    scoreBasisPoints: 0, v2Stars: 0, v1Stars: 0, v2SingleCrashWins: 0,
    v2SingleCrashLosses: 0, bullets: 0, fireActions: 0, stageMatrixSolves: 0,
    completeValueOwners: 0, incompleteValueOwners: 0,
    incompleteValueEvidenceOnly: 0, runtimeMicros: 0,
    invariants: { avoidableHardRejects: 0, riskDominatedSelections: 0,
      rootRestoreFailures: 0, timeoutErrors: 0 }, outcomes: {} };
  let scoreUnits = 0;
  for (const match of matches) {
    const classified = classifyAnalysisOutcome(match);
    add(output.outcomes, classified.analysisOutcome);
    if (classified.analysisOutcome === "V2_WIN") { output.v2Wins += 1; scoreUnits += 2; }
    else if (classified.analysisOutcome === "V1_WIN") output.v1Wins += 1;
    else { output.draws += 1; scoreUnits += 1; }
    const seat = match.v2Seat; const other = seat ^ 1;
    output.v2Stars += match.counts.stars[seat]; output.v1Stars += match.counts.stars[other];
    output.bullets += match.counts.bullets[seat] || 0;
    output.fireActions += (match.v2.actionCounts?.FIRE || 0) +
      (match.v2.actionCounts?.fire || 0);
    if (classified.terminalCategory === "SINGLE_CRASH") {
      if (classified.analysisOutcome === "V2_WIN") output.v2SingleCrashWins += 1;
      else if (classified.analysisOutcome === "V1_WIN") output.v2SingleCrashLosses += 1;
    }
    const layer = match.v2.layerTotals || {};
    output.stageMatrixSolves += layer.stageMatrixSolves || 0;
    output.completeValueOwners += layer.completeValueOwners || 0;
    output.incompleteValueOwners += layer.incompleteValueOwners || 0;
    output.incompleteValueEvidenceOnly += layer.incompleteValueEvidenceOnly || 0;
    output.runtimeMicros += match.v2.totalRuntimeMicros || 0;
    output.invariants.avoidableHardRejects += layer.avoidableHardRejects || 0;
    output.invariants.riskDominatedSelections += layer.riskDominatedSelections || 0;
    output.invariants.rootRestoreFailures += layer.depthRootRestoreFailures || 0;
    output.invariants.timeoutErrors += (match.v2.timeoutCount || 0) + (match.v2.errorCount || 0);
  }
  output.scoreBasisPoints = Math.floor(scoreUnits * 5000 / Math.max(1, matches.length));
  output.starDelta = output.v2Stars - output.v1Stars;
  return output;
}

function compare(legacyMatches, exactMatches) {
  const legacy = new Map();
  for (const match of legacyMatches)
    legacy.set(match.matchId, classifyAnalysisOutcome(match).analysisOutcome);
  const transitions = {}; let comparable = 0;
  for (const match of exactMatches) {
    const before = legacy.get(match.matchId); if (!before) continue;
    const after = classifyAnalysisOutcome(match).analysisOutcome;
    add(transitions, `${before}_TO_${after}`); comparable += 1;
  }
  return { comparable, transitions };
}

function actionDivergence(beforeMatches, afterMatches) {
  const before = new Map(beforeMatches.map(match => [match.matchId, match]));
  const output = { comparable: 0, divergentMatches: 0, firstActionTransitions: {},
    outcomeByActionTransition: {} };
  for (const after of afterMatches) {
    const prior = before.get(after.matchId); if (!prior) continue;
    output.comparable += 1;
    const left = Buffer.from(prior.v2.compactActionStream || "", "base64");
    const right = Buffer.from(after.v2.compactActionStream || "", "base64");
    const length = Math.min(left.length, right.length); let first = -1;
    for (let frame = 0; frame < length; frame += 1)
      if (left[frame] !== right[frame]) { first = frame; break; }
    if (first < 0 && left.length !== right.length) first = length;
    if (first < 0) continue;
    output.divergentMatches += 1;
    const transition = `${left[first] ?? 256}_TO_${right[first] ?? 256}`;
    add(output.firstActionTransitions, transition);
    const priorOutcome = classifyAnalysisOutcome(prior).analysisOutcome;
    const afterOutcome = classifyAnalysisOutcome(after).analysisOutcome;
    add(output.outcomeByActionTransition,
      `${transition}:${priorOutcome}_TO_${afterOutcome}`);
  }
  return output;
}

function invariantTotal(summary) {
  return Object.values(summary.invariants).reduce((sum, value) => sum + value, 0);
}

function transitionBalance(comparison) {
  const t = comparison.transitions || {};
  const positive = 2 * (t.V1_WIN_TO_V2_WIN || 0) +
    (t.V1_WIN_TO_DRAW || 0) + (t.DRAW_TO_V2_WIN || 0);
  const negative = 2 * (t.V2_WIN_TO_V1_WIN || 0) +
    (t.V2_WIN_TO_DRAW || 0) + (t.DRAW_TO_V1_WIN || 0);
  return { positiveUnits: positive, negativeUnits: negative, netUnits: positive - negative };
}

function delta(after, before) {
  return { scoreBasisPoints: after.scoreBasisPoints - before.scoreBasisPoints,
    starDelta: after.starDelta - before.starDelta,
    singleCrashWins: after.v2SingleCrashWins - before.v2SingleCrashWins,
    singleCrashLosses: after.v2SingleCrashLosses - before.v2SingleCrashLosses,
    fireActions: after.fireActions - before.fireActions,
    bullets: after.bullets - before.bullets,
    runtimeMicros: after.runtimeMicros - before.runtimeMicros };
}

async function main() {
  const root = path.resolve(__dirname, "../../..");
  const role = option("--role", "DISCOVERY");
  if (role !== "DISCOVERY" && role !== "CALIBRATION" && role !== "FROZEN_REGRESSION")
    throw new Error(`HP10_ROLE_INVALID:${role}`);
  const limit = positiveInteger("--limit", 16);
  const repetitions = positiveInteger("--repetitions", 1);
  const common = { workspaceRoot: root, role, limit, repetitions,
    timeoutMs: positiveInteger("--timeout-ms", 200), persistReport: false,
    diagnostics: { captureCompact: true, captureSamples: false } };
  const legacy = await runPairedArena({ ...common, experimentId: "HP10_INCOMPLETE_OWNER",
    v2Options: { diagnosticIncompleteSearchOwnership: true } });
  const exact = await runPairedArena({ ...common, experimentId: "HP10_EXACT_OWNER",
    v2Options: {} });
  const soft = await runPairedArena({ ...common, experimentId: "HP10_SOFT_PROPOSAL_EVIDENCE",
    v2Options: { diagnosticSoftSearchProposalEvidence: true } });
  const legacySummary = summarize(legacy.report.matches, "INCOMPLETE_OWNER");
  const exactSummary = summarize(exact.report.matches, "EXACT_OWNER_ONLY");
  const softSummary = summarize(soft.report.matches, "SOFT_PROPOSAL_EVIDENCE");
  const exactVsLegacy = compare(legacy.report.matches, exact.report.matches);
  const softVsExact = compare(exact.report.matches, soft.report.matches);
  const softVsLegacy = compare(legacy.report.matches, soft.report.matches);
  const softDelta = delta(softSummary, exactSummary);
  const balance = transitionBalance(softVsExact);
  const checks = { allInvariantsZero: invariantTotal(legacySummary) === 0 &&
      invariantTotal(exactSummary) === 0 && invariantTotal(softSummary) === 0,
    softScoreImprovesThreePoints: softDelta.scoreBasisPoints >= 300,
    softStarDeltaNonnegative: softDelta.starDelta >= 0,
    softPositiveTransitionsWin: balance.positiveUnits > balance.negativeUnits,
    incompleteSearchNeverOwns: softSummary.incompleteValueOwners === 0,
    incompleteSearchObserved: softSummary.incompleteValueEvidenceOnly > 0 };
  const accepted = Object.values(checks).every(Boolean);
  const report = { schemaVersion: 1, objectKind: "HP10_MINIMAX_DECISION_QUALIFICATION_V1",
    status: role === "DISCOVERY" ? (checks.allInvariantsZero ? "PASS_DIAGNOSTIC" : "FAIL") :
      accepted ? "PASS_HOLDOUT" : "FAIL_HOLDOUT", node: process.version, cohort: {
      role, scenarioLimit: limit, repetitions,
      matchesPerMode: exactSummary.matches, assignmentFingerprint:
        exact.report.assignment.fingerprint },
    source: { productionRoot: sha(fs.readFileSync(path.join(root,
      "engine-v2/src/runtime/production-root.js"))), riskController: sha(fs.readFileSync(path.join(root,
      "engine-v2/src/search/risk-acceptance-controller.js"))), tool: sha(fs.readFileSync(__filename)) },
    legacy: legacySummary, exactOwner: exactSummary, softProposal: softSummary,
    deltas: { exactVsLegacy: delta(exactSummary, legacySummary),
      softVsExact: softDelta,
      softVsLegacy: delta(softSummary, legacySummary) },
    comparisons: { exactVsLegacy, softVsExact, softVsLegacy },
    qualification: { checks, transitionBalance: balance },
    actionDivergence: {
      exactVsLegacy: actionDivergence(legacy.report.matches, exact.report.matches),
      softVsExact: actionDivergence(exact.report.matches, soft.report.matches),
      softVsLegacy: actionDivergence(legacy.report.matches, soft.report.matches)
    } };
  report.fingerprint = sha(JSON.stringify(report));
  const target = path.resolve(option("--output", path.join(root,
    "artifacts/benchmarks/minimax-decision/hp10-exact-owner.json")));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "PASS_DIAGNOSTIC" && report.status !== "PASS_HOLDOUT")
    process.exitCode = 1;
}

if (require.main === module)
  main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1; });

module.exports = { summarize, compare, actionDivergence, invariantTotal, transitionBalance, delta };
