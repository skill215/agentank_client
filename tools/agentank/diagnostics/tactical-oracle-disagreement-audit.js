#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");

const ACTION_NAME = Object.freeze(Object.fromEntries(
  Object.entries(ACTION).map(([name, code]) => [code, name])));

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function readMatches(directory) {
  const bytes = zlib.gunzipSync(fs.readFileSync(path.join(directory, "matches.ndjson.gz")));
  return bytes.toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

function readMatchSet(specification) {
  return String(specification).split(",").filter(Boolean).flatMap(directory =>
    readMatches(path.resolve(directory)));
}

function candidateMatches(matches) {
  return matches.filter(match => !String(match.implementation).includes("CENSUS_SHADOW"));
}

function keyOf(match) {
  return [match.scenarioFingerprint, match.candidateSeat,
    ...(match.seatSkills || [])].join(":");
}

function outcomeValue(outcome) {
  return outcome === "V2_WIN" ? 2 : outcome === "DRAW" ? 1 : 0;
}

function firstDifference(left, right) {
  const a = Buffer.from(left || "", "base64");
  const b = Buffer.from(right || "", "base64");
  const limit = Math.min(a.length, b.length);
  for (let frame = 0; frame < limit; frame += 1) if (a[frame] !== b[frame])
    return { frame, left: a[frame], right: b[frame] };
  if (a.length !== b.length) return { frame: limit,
    left: limit < a.length ? a[limit] : -1,
    right: limit < b.length ? b[limit] : -1 };
  return null;
}

function family(code) {
  if (code === ACTION.GO) return "GO";
  if (code === ACTION.TURN_LEFT || code === ACTION.TURN_RIGHT) return "TURN";
  if (code === ACTION.FIRE) return "FIRE";
  if (code === ACTION.NONE || code < 0) return "NONE";
  return "RESOURCE";
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function exactScenarioRandomization(deltas) {
  const nonZero = deltas.filter(value => value !== 0);
  if (!nonZero.length) return { scenarioCount: deltas.length, nonZeroScenarioCount: 0,
    observedDelta: 0, oneSidedP: 1, twoSidedP: 1 };
  let distribution = new Map([[0, 1n]]);
  for (const delta of nonZero) {
    const magnitude = Math.abs(delta); const next = new Map();
    for (const [sum, count] of distribution) {
      next.set(sum + magnitude, (next.get(sum + magnitude) || 0n) + count);
      next.set(sum - magnitude, (next.get(sum - magnitude) || 0n) + count);
    }
    distribution = next;
  }
  const observed = nonZero.reduce((sum, value) => sum + value, 0);
  let oneSided = 0n; let twoSided = 0n; let total = 0n;
  for (const [sum, count] of distribution) {
    total += count;
    if (sum >= observed) oneSided += count;
    if (Math.abs(sum) >= Math.abs(observed)) twoSided += count;
  }
  return { scenarioCount: deltas.length, nonZeroScenarioCount: nonZero.length,
    observedDelta: observed,
    oneSidedP: Number(oneSided) / Number(total),
    twoSidedP: Number(twoSided) / Number(total) };
}

function audit(leftDirectory, rightDirectory) {
  const left = candidateMatches(readMatchSet(leftDirectory));
  const right = candidateMatches(readMatchSet(rightDirectory));
  const rightByKey = new Map(right.map(match => [keyOf(match), match]));
  const matrix = {}; const directional = {}; const samples = [];
  const scenarioDelta = new Map();
  let compared = 0; let identicalActions = 0; let missing = 0;
  let improvement = 0; let regression = 0; let neutral = 0;
  for (const leftMatch of left) {
    const rightMatch = rightByKey.get(keyOf(leftMatch));
    if (!rightMatch) { missing += 1; continue; }
    compared += 1;
    const difference = firstDifference(leftMatch.candidate?.compactActionStream,
      rightMatch.candidate?.compactActionStream);
    if (!difference) identicalActions += 1;
    const leftValue = outcomeValue(leftMatch.analysisOutcome);
    const rightValue = outcomeValue(rightMatch.analysisOutcome);
    const delta = rightValue - leftValue;
    scenarioDelta.set(leftMatch.scenarioFingerprint,
      (scenarioDelta.get(leftMatch.scenarioFingerprint) || 0) + delta);
    if (delta > 0) improvement += 1;
    else if (delta < 0) regression += 1;
    else neutral += 1;
    const pair = difference ? `${family(difference.left)}->${family(difference.right)}` : "IDENTICAL";
    increment(matrix, pair);
    increment(directional, `${pair}:${delta > 0 ? "IMPROVED" : delta < 0 ? "REGRESSED" : "NEUTRAL"}`);
    if (difference && samples.length < 32 && delta !== 0) samples.push({
      scenarioFingerprint: leftMatch.scenarioFingerprint,
      matchUrlId: leftMatch.matchUrlId,
      candidateSeat: leftMatch.candidateSeat,
      frame: difference.frame,
      leftAction: ACTION_NAME[difference.left] || String(difference.left),
      rightAction: ACTION_NAME[difference.right] || String(difference.right),
      leftOutcome: leftMatch.analysisOutcome,
      rightOutcome: rightMatch.analysisOutcome,
      terminal: [leftMatch.terminalCategory, rightMatch.terminalCategory]
    });
  }
  return { objectKind: "TACTICAL_ORACLE_DISAGREEMENT_AUDIT_V1",
    leftImplementation: left[0]?.implementation || null,
    rightImplementation: right[0]?.implementation || null,
    leftMatches: left.length, rightMatches: right.length, compared, missing,
    identicalActions, firstDivergenceCount: compared - identicalActions,
    outcomeTransitions: { improvement, regression, neutral, net: improvement - regression },
    scenarioRandomization: exactScenarioRandomization([...scenarioDelta.values()]),
    firstDivergenceMatrix: matrix, firstDivergenceByOutcome: directional, samples };
}

function main() {
  const left = option("--left"); const right = option("--right");
  const output = option("--output");
  if (!left || !right) throw new Error("--left and --right are required");
  const report = audit(left, right);
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { audit, exactScenarioRandomization, firstDifference, family,
  outcomeValue };
