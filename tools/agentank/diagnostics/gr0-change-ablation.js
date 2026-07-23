#!/usr/bin/env node
"use strict";

// Causal A/B for the post-IMP8 search changes. This is deliberately a compact
// discovery probe: it stores terminal outcomes and aggregate counters, never
// frame states, replay events, candidate rows, or action logs.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic } = require("../core/atomic-file");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");
const { loadRollingV1Scenarios } = require("../simulation/historical-scenarios");
const { loadSimulator, runMatch, VARIANTS } = require("../simulation/paired-arena");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");
const { loadLegacyBaseline, sourceIdentity } = require("./v1-v2-working-arena");

const MODES = Object.freeze([
  Object.freeze({ id: "CURRENT" }),
  Object.freeze({ id: "NO_SHALLOW_INFO_ADJUSTMENT",
    diagnosticDisableShallowInfoAdjustment: 1 }),
  Object.freeze({ id: "NO_SHALLOW_CLEAR_LINE_REVERSAL",
    diagnosticDisableShallowClearLineReversal: 1 }),
  Object.freeze({ id: "NO_SHALLOW_ESCAPE_BONUS",
    diagnosticDisableShallowEscapeBonus: 1 }),
  Object.freeze({ id: "LEGACY_SHALLOW_FACING_PENALTY",
    diagnosticEnableLegacyShallowFacingPenalty: 1 }),
  Object.freeze({ id: "INFO_DEPTH_1", diagnosticInformationDepthOne: 1 }),
  Object.freeze({ id: "LEGACY_INFORMATION", diagnosticLegacyInformationSearch: 1 }),
  Object.freeze({ id: "NO_EO", diagnosticDisableEscapeObligation: 1 }),
  Object.freeze({ id: "LEGACY_INFORMATION_NO_EO",
    diagnosticLegacyInformationSearch: 1, diagnosticDisableEscapeObligation: 1 })
]);
const CLASSES = Object.freeze([
  "STAR_REGRESSION", "POSITIVE_FLIP", "SINGLE_CRASH_LOSS", "SINGLE_CRASH_WIN"
]);

function argumentsOf(argv) {
  const output = { current: "", limitPerClass: 16, progressEvery: 32,
    modes: MODES.map(mode => mode.id), holdoutCount: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]; const value = argv[index + 1];
    if (key === "--current") { output.current = value; index += 1; }
    else if (key === "--limit-per-class") {
      output.limitPerClass = Math.max(4, Math.min(32, Number(value) || 16)); index += 1;
    } else if (key === "--progress-every") {
      output.progressEvery = Math.max(1, Number(value) || 32); index += 1;
    } else if (key === "--modes") {
      const requested = String(value || "").split(",").filter(Boolean);
      invariant(requested.length > 0 &&
        requested.every(id => MODES.some(mode => mode.id === id)),
      "GR0_AB_INVALID_MODES", String(value));
      output.modes = requested; index += 1;
    } else if (key === "--holdout-count") {
      output.holdoutCount = Math.max(0, Math.min(256, Number(value) || 0)); index += 1;
    } else throw new Error(`UNKNOWN_ARGUMENT:${key}`);
  }
  invariant(output.current, "GR0_AB_CURRENT_REQUIRED", "--current <matches.ndjson.gz>");
  invariant(output.modes[0] === "CURRENT", "GR0_AB_CURRENT_MODE_FIRST",
    output.modes.join(","));
  return output;
}

function readNdjsonGzip(file) {
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function classFor(before, current) {
  const classes = [];
  if (before && before.analysisOutcome === "V2_WIN" &&
      current.analysisOutcome === "V1_WIN" &&
      current.terminalCategory === "FRAME_LIMIT_STARS") classes.push("STAR_REGRESSION");
  if (before && before.analysisOutcome === "V1_WIN" &&
      current.analysisOutcome === "V2_WIN") classes.push("POSITIVE_FLIP");
  if (current.terminalCategory === "SINGLE_CRASH" &&
      current.analysisOutcome === "V1_WIN") classes.push("SINGLE_CRASH_LOSS");
  if (current.terminalCategory === "SINGLE_CRASH" &&
      current.analysisOutcome === "V2_WIN") classes.push("SINGLE_CRASH_WIN");
  return classes;
}

function selectScenarios(currentRecords, baseline, limitPerClass) {
  const membership = new Map();
  for (const current of currentRecords) {
    const before = baseline.records.get(current.matchId);
    for (const category of classFor(before, current)) {
      const classes = membership.get(current.historicalMatchUrlId) || new Set();
      classes.add(category); membership.set(current.historicalMatchUrlId, classes);
    }
  }
  const selected = new Set(); const classIds = {};
  for (const category of CLASSES) {
    const ids = [...membership.entries()].filter(([, classes]) => classes.has(category))
      .map(([id]) => id).sort().slice(0, limitPerClass);
    classIds[category] = ids; for (const id of ids) selected.add(id);
  }
  invariant(selected.size > 0, "GR0_AB_EMPTY_SAMPLE", "");
  const classMembership = {};
  for (const id of [...selected].sort())
    classMembership[id] = [...(membership.get(id) || [])].sort();
  return { ids: [...selected].sort(), classIds, classMembership };
}

function emptySummary() {
  return { matches: 0, v1Wins: 0, v2Wins: 0, draws: 0, scoreUnits: 0,
    scoreRatePer10000: 0, starLead: 0, singleCrashV1Wins: 0, singleCrashV2Wins: 0,
    terminal: {}, actions: {}, layer: { noAcceptableActions: 0, avoidableHardRejects: 0,
      riskDominatedSelections: 0, rootRestoreFailures: 0, escapeRestrictions: 0,
      escapeRescueOverrides: 0, v2Timeouts: 0, v2Errors: 0 }, runtimeMicros: 0 };
}

function add(target, key, value = 1) { target[key] = (target[key] || 0) + value; }

function summarize(matches) {
  const summary = emptySummary(); const records = [];
  for (const match of matches) {
    const classified = classifyAnalysisOutcome(match); const layer = match.v2.layerTotals;
    summary.matches += 1; summary.starLead +=
      classified.stars[match.v2Seat] - classified.stars[match.v2Seat ^ 1];
    if (classified.analysisOutcome === "V2_WIN") {
      summary.v2Wins += 1; summary.scoreUnits += 2;
    } else if (classified.analysisOutcome === "V1_WIN") summary.v1Wins += 1;
    else { summary.draws += 1; summary.scoreUnits += 1; }
    add(summary.terminal, classified.terminalCategory);
    if (classified.terminalCategory === "SINGLE_CRASH") {
      if (classified.analysisOutcome === "V2_WIN") summary.singleCrashV2Wins += 1;
      else if (classified.analysisOutcome === "V1_WIN") summary.singleCrashV1Wins += 1;
    }
    for (const [name, count] of Object.entries(match.v2.actionCounts || {}))
      add(summary.actions, name, count);
    summary.layer.noAcceptableActions += layer.noAcceptableActions || 0;
    summary.layer.avoidableHardRejects += layer.avoidableHardRejects || 0;
    summary.layer.riskDominatedSelections += layer.riskDominatedSelections || 0;
    summary.layer.rootRestoreFailures += layer.depthRootRestoreFailures || 0;
    summary.layer.escapeRestrictions += layer.escapeRestrictions || 0;
    summary.layer.escapeRescueOverrides += layer.escapeRescueOverrides || 0;
    summary.layer.v2Timeouts += match.v2.timeoutCount || 0;
    summary.layer.v2Errors += match.v2.errorCount || 0;
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

function classSummary(records, classMembership) {
  const output = {};
  for (const category of CLASSES) {
    const ids = new Set(Object.entries(classMembership)
      .filter(([, classes]) => classes.includes(category)).map(([id]) => id));
    const selected = records.filter(record => ids.has(record.historicalMatchUrlId));
    const summary = emptySummary();
    for (const record of selected) {
      summary.matches += 1;
      if (record.analysisOutcome === "V2_WIN") {
        summary.v2Wins += 1; summary.scoreUnits += 2;
      } else if (record.analysisOutcome === "V1_WIN") summary.v1Wins += 1;
      else { summary.draws += 1; summary.scoreUnits += 1; }
      const v2Seat = record.variantId.endsWith("V2_SEAT0") ? 0 : 1;
      summary.starLead += record.stars[v2Seat] - record.stars[v2Seat ^ 1];
      if (record.terminalCategory === "SINGLE_CRASH") {
        if (record.analysisOutcome === "V2_WIN") summary.singleCrashV2Wins += 1;
        else if (record.analysisOutcome === "V1_WIN") summary.singleCrashV1Wins += 1;
      }
    }
    summary.scoreRatePer10000 = summary.matches ?
      Math.floor(summary.scoreUnits * 5000 / summary.matches) : 0;
    output[category] = summary;
  }
  return output;
}

function compare(current, candidate) {
  const byId = new Map(current.map(record => [record.matchId, record]));
  const transitions = {}; let comparable = 0;
  for (const record of candidate) {
    const before = byId.get(record.matchId); if (!before) continue;
    comparable += 1; add(transitions, `${before.analysisOutcome}_TO_${record.analysisOutcome}`);
  }
  return { comparable, transitions };
}

async function runMode(mode, scenarios, simulator, v1Code, baseOptions, progressEvery) {
  const engine = { ...baseOptions.engine,
    diagnosticInformationDepthOne: mode.diagnosticInformationDepthOne || 0,
    diagnosticLegacyInformationSearch: mode.diagnosticLegacyInformationSearch || 0,
    diagnosticDisableShallowInfoAdjustment: mode.diagnosticDisableShallowInfoAdjustment || 0,
    diagnosticDisableShallowClearLineReversal:
      mode.diagnosticDisableShallowClearLineReversal || 0,
    diagnosticDisableShallowEscapeBonus:
      mode.diagnosticDisableShallowEscapeBonus || 0,
    diagnosticEnableLegacyShallowFacingPenalty:
      mode.diagnosticEnableLegacyShallowFacingPenalty || 0,
    diagnosticDisableEscapeObligation: mode.diagnosticDisableEscapeObligation || 0 };
  const matches = []; const expected = scenarios.length * VARIANTS.length;
  for (const scenario of scenarios) for (const variant of VARIANTS) {
    matches.push(await runMatch(simulator.module, scenario, variant, 0, v1Code, 200,
      { ...baseOptions, engine }, { captureActions: false }));
    if (matches.length % progressEvery === 0 || matches.length === expected)
      process.stderr.write(`[ab] ${mode.id} ${matches.length}/${expected}\n`);
  }
  return summarize(matches);
}

async function main() {
  const args = argumentsOf(process.argv.slice(2)); const root = defaultWorkspaceRoot();
  const currentFile = path.isAbsolute(args.current) ? args.current : contained(root, args.current);
  invariant(fs.existsSync(currentFile), "GR0_AB_CURRENT_MISSING", currentFile);
  const currentRecords = readNdjsonGzip(currentFile);
  const baseline = await loadLegacyBaseline(root, "imp8-common-1952");
  const sample = selectScenarios(currentRecords, baseline, args.limitPerClass);
  const rolling = loadRollingV1Scenarios(root);
  if (args.holdoutCount) {
    const excluded = new Set(sample.ids);
    const ids = rolling.scenarios.map(scenario => scenario.matchUrlId)
      .filter(id => !excluded.has(id)).sort().slice(0, args.holdoutCount);
    invariant(ids.length === args.holdoutCount, "GR0_AB_HOLDOUT_TOO_SMALL",
      `${ids.length}/${args.holdoutCount}`);
    sample.ids = ids; sample.classIds = {}; sample.classMembership = {};
    for (const id of ids) sample.classMembership[id] = [];
  }
  const scenariosById = new Map(rolling.scenarios.map(scenario => [scenario.matchUrlId, scenario]));
  const scenarios = sample.ids.map(id => {
    const scenario = scenariosById.get(id);
    invariant(scenario, "GR0_AB_SCENARIO_MISSING", id); return scenario;
  });
  const frozen = loadFrozenCandidate(root); const simulator = await loadSimulator(root);
  const v1Code = fs.readFileSync(frozen.v1File, "utf8");
  const baseOptions = v2Options(frozen.manifest.parameters);
  // Establish write authority before spending simulation time, then checkpoint
  // after every mode so a final-report failure cannot discard completed A/B.
  const output = contained(root, "artifacts", "diagnostics", "gr0-change-ablation");
  ensureDirectory(output);
  const checkpointFile = path.join(output, "checkpoint.json");
  const source = sourceIdentity(root); const results = []; let current = null;
  const modes = args.modes.map(id => MODES.find(mode => mode.id === id));
  for (const mode of modes) {
    const started = Date.now();
    const result = await runMode(mode, scenarios, simulator, v1Code, baseOptions,
      args.progressEvery);
    const item = { mode: mode.id, flags: mode, elapsedMs: Date.now() - started,
      summary: result.summary, classes: classSummary(result.records, sample.classMembership),
      records: result.records };
    if (mode.id === "CURRENT") current = item;
    else item.vsCurrent = compare(current.records, item.records);
    results.push(item);
    writeJsonAtomic(checkpointFile, {
      schemaVersion: 1, objectKind: "GR0_CHANGE_ABLATION_CHECKPOINT_V1",
      status: "RUNNING", sourceSha256: source.sha256,
      sample: { scenarioCount: scenarios.length,
        matchesPerMode: scenarios.length * VARIANTS.length },
      completedModes: results.map(result => result.mode), results
    }, { mode: 0o644 });
    process.stderr.write(`[ab] ${mode.id} score=${item.summary.scoreRatePer10000} ` +
      `W/L/D=${item.summary.v2Wins}/${item.summary.v1Wins}/${item.summary.draws}\n`);
  }
  const report = { schemaVersion: 1, objectKind: "GR0_CHANGE_ABLATION_V1",
    status: "COMPLETED", properties: ["DISCOVERY_ONLY", "COMPACT", "NO_FRAME_TRACES"],
    source, baselineId: baseline.baselineId,
    currentInput: path.relative(root, currentFile).replaceAll("\\", "/"),
    sample: { kind: args.holdoutCount ? "DETERMINISTIC_HOLDOUT" : "DIAGNOSTIC_CLASSES",
      limitPerClass: args.limitPerClass, scenarioCount: scenarios.length,
      matchesPerMode: scenarios.length * VARIANTS.length,
      classIds: sample.classIds, classMembership: sample.classMembership },
    results, fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  const file = path.join(output, `${report.fingerprint}.json`);
  writeJsonAtomic(file, report, { mode: 0o644 });
  writeJsonAtomic(path.join(output, "latest.json"), report, { mode: 0o644 });
  fs.unlinkSync(checkpointFile);
  process.stdout.write(`${JSON.stringify({ status: report.status,
    fingerprint: report.fingerprint, file,
    sample: { scenarios: scenarios.length, matchesPerMode: scenarios.length * VARIANTS.length },
    results: results.map(item => ({ mode: item.mode, elapsedMs: item.elapsedMs,
      summary: item.summary, classes: item.classes, vsCurrent: item.vsCurrent })) }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;
});
