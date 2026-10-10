#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { sha256Bytes } = require("../core/hash");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");
const { actionToLegacy } = require("../../../engine-v3/src");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1] : fallback;
}

function readMatches(file) {
  const bytes = fs.readFileSync(file);
  return { bytes, matches: zlib.gunzipSync(bytes).toString("utf8").trim().split("\n")
    .filter(Boolean).map(line => JSON.parse(line)) };
}

function keyFor(match) {
  return `${match.scenarioFingerprint}:${match.candidateSeat}`;
}

function candidateOutcome(match) {
  const candidateSeat = match.candidateSeat;
  const winnerSeat = match.result?.winnerSeat;
  const classified = classifyAnalysisOutcome({
    seatImplementations: candidateSeat === 0 ? ["v2", "v1"] : ["v1", "v2"],
    counts: match.counts,
    result: { ...match.result, winnerImplementation:
      winnerSeat === candidateSeat ? "v2" :
        winnerSeat === (candidateSeat ^ 1) ? "v1" : "draw" }
  });
  return { outcome: classified.analysisOutcome === "V2_WIN" ? "WIN" :
    classified.analysisOutcome === "V1_WIN" ? "LOSS" : "DRAW",
    terminalCategory: classified.terminalCategory };
}

function terminalVector(match) {
  const seat = match.candidateSeat; const other = seat ^ 1;
  const result = candidateOutcome(match);
  const outcomeRank = result.outcome === "WIN" ? 2 : result.outcome === "DRAW" ? 1 : 0;
  const crashes = match.counts?.crashes || [0, 0];
  const stars = match.counts?.stars || [0, 0];
  return [outcomeRank, crashes[seat] > 0 ? 0 : 1, crashes[other] > 0 ? 1 : 0,
    (stars[seat] || 0) - (stars[other] || 0)];
}

function compareVector(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function decodeActions(match) {
  return Buffer.from(match.candidate?.compactActionStream || "", "base64");
}

function firstActionDifference(candidate, baseline) {
  const after = decodeActions(candidate); const before = decodeActions(baseline);
  const length = Math.max(after.length, before.length);
  let firstFrame = -1; let differenceCount = 0;
  for (let frame = 0; frame < length; frame += 1) {
    const beforeAction = frame < before.length ? before[frame] : -1;
    const afterAction = frame < after.length ? after[frame] : -1;
    if (beforeAction === afterAction) continue;
    differenceCount += 1;
    if (firstFrame < 0) firstFrame = frame;
  }
  return { different: firstFrame >= 0, firstFrame, differenceCount,
    beforeAction: firstFrame < 0 || firstFrame >= before.length ? null : before[firstFrame],
    afterAction: firstFrame < 0 || firstFrame >= after.length ? null : after[firstFrame],
    beforeActionName: firstFrame < 0 || firstFrame >= before.length ? null :
      actionToLegacy(before[firstFrame]),
    afterActionName: firstFrame < 0 || firstFrame >= after.length ? null :
      actionToLegacy(after[firstFrame]) };
}

function add(target, key) { target[key] = (target[key] || 0) + 1; }

function compareMatches(candidateMatches, baselineMatches) {
  const baselineByKey = new Map();
  for (const match of baselineMatches) {
    const key = keyFor(match);
    if (baselineByKey.has(key)) throw new Error(`COUNTERFACTUAL_DUPLICATE_BASELINE:${key}`);
    baselineByKey.set(key, match);
  }
  const summary = { matches: 0, candidateOutcomes: {}, baselineOutcomes: {}, transitions: {},
    changedActionMatches: 0, changedActionFrames: 0,
    terminalQuality: { improved: 0, equal: 0, regressed: 0 }, details: [] };
  for (const candidate of candidateMatches) {
    const key = keyFor(candidate); const baseline = baselineByKey.get(key);
    if (!baseline) throw new Error(`COUNTERFACTUAL_BASELINE_MISSING:${key}`);
    baselineByKey.delete(key); summary.matches += 1;
    const before = candidateOutcome(baseline); const after = candidateOutcome(candidate);
    add(summary.baselineOutcomes, before.outcome); add(summary.candidateOutcomes, after.outcome);
    const transition = `${before.outcome}->${after.outcome}`; add(summary.transitions, transition);
    const difference = firstActionDifference(candidate, baseline);
    const quality = compareVector(terminalVector(candidate), terminalVector(baseline));
    add(summary.terminalQuality, quality > 0 ? "improved" : quality < 0 ? "regressed" : "equal");
    if (!difference.different) continue;
    summary.changedActionMatches += 1; summary.changedActionFrames += difference.differenceCount;
    const tactical = candidate.candidateController?.tacticalCore || {};
    summary.details.push({ key, scenarioFingerprint: candidate.scenarioFingerprint,
      candidateSeat: candidate.candidateSeat, transition,
      terminalQuality: quality > 0 ? "IMPROVED" : quality < 0 ? "REGRESSED" : "EQUAL",
      firstDifference: difference,
      baselineTerminal: { frames: baseline.frames, reason: baseline.result?.reason,
        stars: baseline.counts?.stars, crashes: baseline.counts?.crashes,
        category: before.terminalCategory },
      candidateTerminal: { frames: candidate.frames, reason: candidate.result?.reason,
        stars: candidate.counts?.stars, crashes: candidate.counts?.crashes,
        category: after.terminalCategory },
      physicalEvidence: { frame: tactical.firstPhysicalCellFrame ?? -1,
        legacyAction: tactical.firstPhysicalCellLegacyAction ?? -1,
        candidateAction: tactical.firstPhysicalCellCandidateAction ?? -1,
        depth: tactical.firstPhysicalCellDepth ?? 0,
        legacyValue: tactical.firstPhysicalCellLegacyValue ?? 0,
        candidateValue: tactical.firstPhysicalCellCandidateValue ?? 0,
        minimumMargin: tactical.firstPhysicalCellMinimumMargin ?? 0,
        planKind: tactical.firstPhysicalCellPlanKind ?? 0,
        planPurpose: tactical.firstPhysicalCellPlanPurpose ?? 0,
        planDeadline: tactical.firstPhysicalCellPlanDeadline ?? 0,
        planRawScore: tactical.firstPhysicalCellPlanRawScore ?? 0 } });
  }
  if (baselineByKey.size)
    throw new Error(`COUNTERFACTUAL_UNUSED_BASELINES:${baselineByKey.size}`);
  summary.details.sort((a, b) => a.key.localeCompare(b.key));
  return summary;
}

function main() {
  const candidateFile = path.resolve(option("--candidate"));
  const baselineFile = path.resolve(option("--baseline"));
  if (!option("--candidate") || !option("--baseline"))
    throw new Error("COUNTERFACTUAL_REQUIRES_CANDIDATE_AND_BASELINE");
  const candidate = readMatches(candidateFile); const baseline = readMatches(baselineFile);
  const report = { schemaVersion: 1, objectKind: "V3_COMPONENT_COUNTERFACTUAL_V1",
    candidate: { file: candidateFile, sha256: sha256Bytes(candidate.bytes),
      records: candidate.matches.length },
    baseline: { file: baselineFile, sha256: sha256Bytes(baseline.bytes),
      records: baseline.matches.length },
    summary: compareMatches(candidate.matches, baseline.matches) };
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  const output = option("--output");
  if (output) { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(path.resolve(output), bytes); }
  process.stdout.write(bytes);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1; }
}

module.exports = { candidateOutcome, terminalVector, compareVector,
  firstActionDifference, compareMatches };
