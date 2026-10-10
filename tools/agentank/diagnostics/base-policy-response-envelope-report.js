#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { fingerprintObject } = require("../core/hash");
const { ACTION_NAME } = require("../simulation/production-diagnostic-bot");

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function readMatches(directory) {
  const file = path.join(path.resolve(directory), "matches.ndjson.gz");
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").trim();
  if (!text) return [];
  return text.split("\n").map(line => JSON.parse(line)).filter(record =>
    String(record.implementation || "").includes(
      "NATIVE_BOUNDED_POLICY_DIFFERENTIAL"));
}

function key(record) {
  return `${record.scenarioFingerprint}:${record.candidateSeat}`;
}

function add(target, name, value = 1) {
  target[name] = (target[name] || 0) + value;
}

function actionName(code) {
  return String(ACTION_NAME[code] || `ACTION_${code}`).toUpperCase();
}

function stream(record) {
  return Buffer.from(record.candidate?.compactActionStream || "", "base64");
}

function firstDivergence(left, right) {
  const count = Math.max(left.length, right.length);
  for (let frame = 0; frame < count; frame += 1)
    if (left[frame] !== right[frame]) return frame;
  return -1;
}

function units(outcome) {
  return outcome === "V2_WIN" ? 2 : outcome === "DRAW" ? 1 : 0;
}

function candidateValue(record, values) {
  return values?.[record.candidateSeat] ?? 0;
}

function frameBucket(frame) {
  if (frame < 0) return "SAME";
  if (frame < 16) return "00_15";
  if (frame < 32) return "16_31";
  if (frame < 64) return "32_63";
  if (frame < 96) return "64_95";
  return "96_PLUS";
}

function analyze(shadowMatches, activeMatches, sampleLimit = 32) {
  const shadow = new Map(shadowMatches.map(record => [key(record), record]));
  const active = new Map(activeMatches.map(record => [key(record), record]));
  const report = { schemaVersion: 1,
    objectKind: "BASE_POLICY_RESPONSE_ENVELOPE_CAUSAL_REPORT_V1",
    comparableMatches: 0, missingShadow: 0, missingActive: 0,
    exactActionStreams: 0, divergentActionStreams: 0,
    shadowUnits: 0, activeUnits: 0, netUnits: 0,
    shadowStars: 0, activeStars: 0, netStars: 0,
    shadowCrashes: 0, activeCrashes: 0, netCrashes: 0,
    improvedMatches: 0, regressedMatches: 0, equalOutcomeMatches: 0,
    outcomeTransitions: {}, firstActionTransitions: {},
    firstDivergenceBuckets: {}, actionTransitionOutcomeUnits: {}, samples: [],
    fingerprint: "" };
  const keys = new Set([...shadow.keys(), ...active.keys()]);
  for (const matchKey of [...keys].sort()) {
    const before = shadow.get(matchKey); const after = active.get(matchKey);
    if (!before) { report.missingShadow += 1; continue; }
    if (!after) { report.missingActive += 1; continue; }
    report.comparableMatches += 1;
    const beforeUnits = units(before.analysisOutcome);
    const afterUnits = units(after.analysisOutcome);
    const deltaUnits = afterUnits - beforeUnits;
    report.shadowUnits += beforeUnits; report.activeUnits += afterUnits;
    report.shadowStars += candidateValue(before, before.counts?.stars);
    report.activeStars += candidateValue(after, after.counts?.stars);
    report.shadowCrashes += candidateValue(before, before.counts?.crashes);
    report.activeCrashes += candidateValue(after, after.counts?.crashes);
    if (deltaUnits > 0) report.improvedMatches += 1;
    else if (deltaUnits < 0) report.regressedMatches += 1;
    else report.equalOutcomeMatches += 1;
    add(report.outcomeTransitions,
      `${before.analysisOutcome}_TO_${after.analysisOutcome}`);
    const beforeActions = stream(before); const afterActions = stream(after);
    const frame = firstDivergence(beforeActions, afterActions);
    if (frame < 0) report.exactActionStreams += 1;
    else report.divergentActionStreams += 1;
    add(report.firstDivergenceBuckets, frameBucket(frame));
    const transition = frame < 0 ? "SAME" :
      `${actionName(beforeActions[frame])}_TO_${actionName(afterActions[frame])}`;
    add(report.firstActionTransitions, transition);
    add(report.actionTransitionOutcomeUnits, transition, deltaUnits);
    if (frame >= 0 && report.samples.length < sampleLimit) report.samples.push({
      matchUrlId: before.matchUrlId,
      scenarioFingerprint: before.scenarioFingerprint,
      candidateSeat: before.candidateSeat, firstDivergenceFrame: frame,
      firstActionTransition: transition,
      outcomeTransition: `${before.analysisOutcome}_TO_${after.analysisOutcome}`,
      deltaUnits,
      terminalTransition: `${before.terminalCategory}_TO_${after.terminalCategory}`,
      starTransition: `${candidateValue(before, before.counts?.stars)}_TO_${
        candidateValue(after, after.counts?.stars)}`,
      crashTransition: `${candidateValue(before, before.counts?.crashes)}_TO_${
        candidateValue(after, after.counts?.crashes)}`
    });
  }
  report.netUnits = report.activeUnits - report.shadowUnits;
  report.netStars = report.activeStars - report.shadowStars;
  report.netCrashes = report.activeCrashes - report.shadowCrashes;
  report.shadowScoreBasisPoints = Math.round(report.shadowUnits * 5000 /
    Math.max(1, report.comparableMatches));
  report.activeScoreBasisPoints = Math.round(report.activeUnits * 5000 /
    Math.max(1, report.comparableMatches));
  report.scoreDeltaBasisPoints = report.activeScoreBasisPoints -
    report.shadowScoreBasisPoints;
  report.fingerprint = fingerprintObject({ ...report, fingerprint: "" });
  return report;
}

function run() {
  const shadowDirectory = option("--shadow", 
    "/tmp/agentank-base-policy-bp20-bellman-shadow");
  const activeDirectory = option("--active",
    "/tmp/agentank-base-policy-bp20-bellman-active");
  const outputFile = path.resolve(option("--output",
    "/tmp/agentank-base-policy-bp20-causal-report.json"));
  const report = analyze(readMatches(shadowDirectory),
    readMatches(activeDirectory));
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputFile,
    comparableMatches: report.comparableMatches,
    scores: { shadow: report.shadowScoreBasisPoints,
      active: report.activeScoreBasisPoints,
      delta: report.scoreDeltaBasisPoints },
    transitions: report.outcomeTransitions,
    improvedMatches: report.improvedMatches,
    regressedMatches: report.regressedMatches,
    netStars: report.netStars, netCrashes: report.netCrashes,
    firstActionTransitions: report.firstActionTransitions,
    actionTransitionOutcomeUnits: report.actionTransitionOutcomeUnits,
    fingerprint: report.fingerprint }, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try { run(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { readMatches, firstDivergence, analyze, run };
