#!/usr/bin/env node
"use strict";

// Runs one engine source tree against the exact scenario set frozen by
// gr0-change-ablation. It is intentionally compatible with the pre-GR0 parent
// commit so source worktrees can be compared without importing current engine
// modules into the baseline process.

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic } = require("../core/atomic-file");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");
const { loadRollingV1Scenarios } = require("../simulation/historical-scenarios");
const { loadSimulator, runMatch, VARIANTS } = require("../simulation/paired-arena");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");
const { sourceIdentity } = require("./v1-v2-working-arena");

function argumentsOf(argv) {
  const output = { sampleReport: "", output: "", progressEvery: 32 };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]; const value = argv[index + 1];
    if (key === "--sample-report") { output.sampleReport = value; index += 1; }
    else if (key === "--output") { output.output = value; index += 1; }
    else if (key === "--progress-every") {
      output.progressEvery = Math.max(1, Number(value) || 32); index += 1;
    } else throw new Error(`UNKNOWN_ARGUMENT:${key}`);
  }
  invariant(output.sampleReport, "GR0_PARENT_SAMPLE_REPORT_REQUIRED", "");
  invariant(output.output, "GR0_PARENT_OUTPUT_REQUIRED", "");
  return output;
}

function add(target, key, value = 1) { target[key] = (target[key] || 0) + value; }

function summarize(matches) {
  const summary = { matches: matches.length, v1Wins: 0, v2Wins: 0, draws: 0,
    scoreUnits: 0, scoreRatePer10000: 0, starLead: 0,
    singleCrashV1Wins: 0, singleCrashV2Wins: 0,
    terminal: {}, actions: {}, noAcceptableActions: 0,
    avoidableHardRejects: 0, riskDominatedSelections: 0, rootRestoreFailures: 0,
    v2Timeouts: 0, v2Errors: 0, runtimeMicros: 0 };
  const records = [];
  for (const match of matches) {
    const classified = classifyAnalysisOutcome(match); const layer = match.v2.layerTotals;
    if (classified.analysisOutcome === "V2_WIN") {
      summary.v2Wins += 1; summary.scoreUnits += 2;
    } else if (classified.analysisOutcome === "V1_WIN") summary.v1Wins += 1;
    else { summary.draws += 1; summary.scoreUnits += 1; }
    summary.starLead += classified.stars[match.v2Seat] - classified.stars[match.v2Seat ^ 1];
    add(summary.terminal, classified.terminalCategory);
    if (classified.terminalCategory === "SINGLE_CRASH") {
      if (classified.analysisOutcome === "V2_WIN") summary.singleCrashV2Wins += 1;
      else if (classified.analysisOutcome === "V1_WIN") summary.singleCrashV1Wins += 1;
    }
    for (const [name, count] of Object.entries(match.v2.actionCounts || {}))
      add(summary.actions, name, count);
    summary.noAcceptableActions += layer.noAcceptableActions || 0;
    summary.avoidableHardRejects += layer.avoidableHardRejects || 0;
    summary.riskDominatedSelections += layer.riskDominatedSelections || 0;
    summary.rootRestoreFailures += layer.depthRootRestoreFailures || 0;
    summary.v2Timeouts += match.v2.timeoutCount || 0;
    summary.v2Errors += match.v2.errorCount || 0;
    summary.runtimeMicros += match.v2.totalRuntimeMicros || 0;
    records.push({ matchId: match.matchId, historicalMatchUrlId: match.historicalMatchUrlId,
      variantId: match.variantId, analysisOutcome: classified.analysisOutcome,
      terminalCategory: classified.terminalCategory,
      stars: [classified.stars[0], classified.stars[1]],
      crashes: [classified.crashes[0], classified.crashes[1]] });
  }
  summary.scoreRatePer10000 = summary.matches ?
    Math.floor(summary.scoreUnits * 5000 / summary.matches) : 0;
  return { summary, records };
}

async function main() {
  const args = argumentsOf(process.argv.slice(2)); const root = defaultWorkspaceRoot();
  const sampleFile = path.isAbsolute(args.sampleReport) ? args.sampleReport :
    contained(root, args.sampleReport);
  const sampleReport = JSON.parse(fs.readFileSync(sampleFile, "utf8"));
  invariant(sampleReport.objectKind === "GR0_CHANGE_ABLATION_V1",
    "GR0_PARENT_SAMPLE_KIND", sampleReport.objectKind);
  const ids = Object.keys(sampleReport.sample.classMembership).sort();
  const rolling = loadRollingV1Scenarios(root);
  const byId = new Map(rolling.scenarios.map(scenario => [scenario.matchUrlId, scenario]));
  const scenarios = ids.map(id => {
    const scenario = byId.get(id); invariant(scenario, "GR0_PARENT_SCENARIO_MISSING", id);
    return scenario;
  });
  const frozen = loadFrozenCandidate(root); const simulator = await loadSimulator(root);
  const v1Code = fs.readFileSync(frozen.v1File, "utf8");
  const options = v2Options(frozen.manifest.parameters); const matches = [];
  const expected = scenarios.length * VARIANTS.length;
  for (const scenario of scenarios) for (const variant of VARIANTS) {
    matches.push(await runMatch(simulator.module, scenario, variant, 0, v1Code, 200,
      options, { captureActions: false }));
    if (matches.length % args.progressEvery === 0 || matches.length === expected)
      process.stderr.write(`[parent-ab] ${matches.length}/${expected}\n`);
  }
  const result = summarize(matches); const report = {
    schemaVersion: 1, objectKind: "GR0_PARENT_SAMPLE_RESULT_V1", status: "COMPLETED",
    source: sourceIdentity(root), sampleFingerprint: sampleReport.fingerprint,
    scenarioCount: scenarios.length, classMembership: sampleReport.sample.classMembership,
    summary: result.summary, records: result.records, fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  const output = path.isAbsolute(args.output) ? args.output : contained(root, args.output);
  ensureDirectory(path.dirname(output)); writeJsonAtomic(output, report, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify({ status: report.status, source: report.source,
    scenarioCount: report.scenarioCount, summary: report.summary,
    fingerprint: report.fingerprint, file: output }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;
});
