#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

function score(outcome) {
  return outcome === "V2_WIN" ? 2 : outcome === "DRAW" ? 1 : 0;
}

function exactTwoSidedSignTest(positive, negative) {
  const count = positive + negative;
  if (!count) return 1;
  const tail = Math.min(positive, negative);
  let term = Math.pow(0.5, count); let cumulative = term;
  for (let k = 1; k <= tail; k += 1) {
    term *= (count - k + 1) / k;
    cumulative += term;
  }
  return Math.min(1, cumulative * 2);
}

function readMatches(file) {
  return zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").trim()
    .split("\n").filter(Boolean).map(JSON.parse)
    .filter(match => String(match.implementation).includes("NATIVE"));
}

function summarize(matches) {
  let wins = 0; let losses = 0; let draws = 0;
  for (const match of matches) {
    if (match.analysisOutcome === "V2_WIN") wins += 1;
    else if (match.analysisOutcome === "V1_WIN") losses += 1;
    else draws += 1;
  }
  return { matches: matches.length, wins, losses, draws,
    scoreBasisPoints: matches.length ?
      Math.round((wins * 2 + draws) * 5000 / matches.length) : 0 };
}

function compare(shadow, active) {
  const key = match => `${match.scenarioFingerprint}#${match.candidateSeat}`;
  const shadowByKey = new Map(shadow.map(match => [key(match), match]));
  if (shadowByKey.size !== shadow.length || active.length !== shadow.length)
    throw new Error("BP_RESPONSE_MASS_COMPARISON_DENOMINATOR_MISMATCH");
  const transitions = {}; let positive = 0; let negative = 0; let equal = 0;
  const scenarioDelta = new Map();
  for (const match of active) {
    const previous = shadowByKey.get(key(match));
    if (!previous) throw new Error("BP_RESPONSE_MASS_COMPARISON_KEY_MISSING");
    const transition = `${previous.analysisOutcome}->${match.analysisOutcome}`;
    transitions[transition] = (transitions[transition] || 0) + 1;
    const delta = score(match.analysisOutcome) - score(previous.analysisOutcome);
    if (delta > 0) positive += 1;
    else if (delta < 0) negative += 1;
    else equal += 1;
    const scenarioKey = match.scenarioFingerprint;
    scenarioDelta.set(scenarioKey, (scenarioDelta.get(scenarioKey) || 0) + delta);
  }
  let scenarioPositive = 0; let scenarioNegative = 0; let scenarioEqual = 0;
  for (const delta of scenarioDelta.values()) {
    if (delta > 0) scenarioPositive += 1;
    else if (delta < 0) scenarioNegative += 1;
    else scenarioEqual += 1;
  }
  const shadowSummary = summarize(shadow); const activeSummary = summarize(active);
  return { objectKind: "BASE_POLICY_RESPONSE_MASS_PAIRED_COMPARISON_V1",
    shadow: shadowSummary, active: activeSummary,
    scoreBasisPointDelta:
      activeSummary.scoreBasisPoints - shadowSummary.scoreBasisPoints,
    transitions,
    matchPairs: { positive, negative, equal,
      exactTwoSidedSignP: exactTwoSidedSignTest(positive, negative) },
    scenarioPairs: { scenarios: scenarioDelta.size,
      positive: scenarioPositive, negative: scenarioNegative, equal: scenarioEqual,
      exactTwoSidedSignP:
        exactTwoSidedSignTest(scenarioPositive, scenarioNegative) } };
}

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

if (require.main === module) {
  const shadowFile = path.resolve(option("--shadow"));
  const activeFile = path.resolve(option("--active"));
  if (!shadowFile || !activeFile)
    throw new Error("BP_RESPONSE_MASS_COMPARISON_INPUT_REQUIRED");
  const result = compare(readMatches(shadowFile), readMatches(activeFile));
  const output = option("--output");
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { score, exactTwoSidedSignTest, summarize, compare };
