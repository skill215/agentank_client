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

function readNdjson(file) {
  const bytes = fs.readFileSync(file);
  const text = file.endsWith(".gz") ? zlib.gunzipSync(bytes).toString("utf8") :
    bytes.toString("utf8");
  return text.trim() ? text.trim().split("\n").map(line => JSON.parse(line)) : [];
}

function pairKey(match) {
  return `${match.scenarioFingerprint}:${match.candidateSeat}`;
}

function outcomeRank(outcome) {
  return outcome === "V2_WIN" ? 2 : outcome === "DRAW" ? 1 : 0;
}

function commandKey(frame) {
  return JSON.stringify(frame?.command ?? null);
}

function firstDivergence(leftFrames = [], rightFrames = []) {
  const rightByFrame = new Map(rightFrames.map(frame => [frame.frame, frame]));
  for (const left of leftFrames) {
    const right = rightByFrame.get(left.frame);
    if (right && (left.action !== right.action || commandKey(left) !== commandKey(right)))
      return { frame: left.frame, left, right };
  }
  return null;
}

function frameAt(frames, frame) {
  for (const value of frames || []) if (value.frame === frame) return value;
  return null;
}

function compactCandidate(value) {
  return {
    action: value.action ?? null,
    argument: value.argument ?? null,
    hard: value.hard ?? null,
    safety: value.safety ?? null,
    immediateFatalMass: value.immediateFatalMass ?? null,
    horizonFatalMass: value.horizonFatalMass ?? null,
    unknownMass: value.unknownMass ?? null,
    earliestFatalFrame: value.earliestFatalFrame ?? null,
    escapeSlack: value.escapeSlack ?? null,
    coverage: value.coverage ?? null,
    acceptable: value.acceptable ?? null,
    dominated: value.dominated ?? null,
    robustLower: value.robustLower ?? null,
    expectedValue: value.expectedValue ?? null,
    tacticalValue: value.tacticalValue ?? null,
    policyProbability: value.policyProbability ?? null,
    purposeCompleteness: value.purposeCompleteness ?? null,
    committedEscapeMember: value.committedEscapeMember ?? null,
    committedSuccessorProof: value.committedSuccessorProof ?? null,
    committedSuccessorSlack: value.committedSuccessorSlack ?? null
  };
}

function compactRoot(frame) {
  if (!frame) return null;
  return {
    frame: frame.frame,
    action: frame.action,
    root: frame.root ?? null,
    controlMode: frame.controlMode ?? null,
    runtimeMode: frame.runtimeMode ?? null,
    completedDepth: frame.completedDepth ?? null,
    physicalCompletedDepth: frame.physicalCompletedDepth ?? null,
    informationCompletedDepth: frame.informationCompletedDepth ?? null,
    informationSupportComplete: frame.informationSupportComplete ?? null,
    observationSafetySupportComplete:
      frame.observationSafetySupportComplete === undefined ? null :
        Boolean(frame.observationSafetySupportComplete),
    informationComplete: frame.informationComplete ?? null,
    possibleProjectileCount: frame.possibleProjectileCount ?? null,
    noAcceptableAction: frame.noAcceptableAction ?? null,
    acceptableCount: frame.acceptableCount ?? null,
    state: frame.state || null,
    candidates: (frame.candidates || []).map(compactCandidate)
  };
}

function increment(target, key) { target[key] = (target[key] || 0) + 1; }

function buildCorpus(matches, baselineImplementation, candidateImplementation) {
  const pairs = new Map();
  for (const match of matches) {
    if (match.implementation !== baselineImplementation &&
        match.implementation !== candidateImplementation) continue;
    const key = pairKey(match);
    if (!pairs.has(key)) pairs.set(key, {});
    pairs.get(key)[match.implementation === baselineImplementation ? "baseline" :
      "candidate"] = match;
  }
  const summary = { matchedPairs: 0, missingPairs: 0, identicalPolicies: 0,
    divergentPolicies: 0, depthZeroRoots: 0, observationIncompleteRoots: 0,
    observationIncompleteDepthZeroRoots: 0, positiveOutcomeTransitions: 0,
    negativeOutcomeTransitions: 0, neutralOutcomeTransitions: 0,
    outcomeTransitions: {}, actionTransitions: {}, controlModes: {},
    possibleProjectileCounts: {} };
  const roots = [];
  for (const [key, pair] of [...pairs].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!pair.baseline || !pair.candidate) { summary.missingPairs += 1; continue; }
    summary.matchedPairs += 1;
    const baselineFrames = pair.baseline.candidateEngine?.actionFrames || [];
    const candidateFrames = pair.candidate.candidateEngine?.actionFrames || [];
    const divergence = firstDivergence(baselineFrames, candidateFrames);
    if (!divergence) { summary.identicalPolicies += 1; continue; }
    summary.divergentPolicies += 1;
    const baselineRoot = compactRoot(frameAt(
      pair.baseline.candidateEngine?.diagnosticFrames, divergence.frame));
    const candidateRoot = compactRoot(frameAt(
      pair.candidate.candidateEngine?.diagnosticFrames, divergence.frame));
    const depthZero = !candidateRoot || candidateRoot.completedDepth === 0;
    const observationIncomplete = candidateRoot ?
      candidateRoot.observationSafetySupportComplete === false ||
        (candidateRoot.observationSafetySupportComplete === null &&
         candidateRoot.possibleProjectileCount > 0) : false;
    if (depthZero) summary.depthZeroRoots += 1;
    if (observationIncomplete) summary.observationIncompleteRoots += 1;
    if (depthZero && observationIncomplete)
      summary.observationIncompleteDepthZeroRoots += 1;
    const baselineOutcome = pair.baseline.analysisOutcome;
    const candidateOutcome = pair.candidate.analysisOutcome;
    const delta = outcomeRank(candidateOutcome) - outcomeRank(baselineOutcome);
    if (delta > 0) summary.positiveOutcomeTransitions += 1;
    else if (delta < 0) summary.negativeOutcomeTransitions += 1;
    else summary.neutralOutcomeTransitions += 1;
    increment(summary.outcomeTransitions, `${baselineOutcome}>${candidateOutcome}`);
    increment(summary.actionTransitions,
      `${divergence.left.action}>${divergence.right.action}`);
    increment(summary.controlModes, String(candidateRoot?.controlMode ?? "MISSING"));
    increment(summary.possibleProjectileCounts,
      String(candidateRoot?.possibleProjectileCount ?? "MISSING"));
    roots.push({ schemaVersion: 1,
      objectKind: "PAIRED_FIRST_DIVERGENCE_ROOT_V1", key,
      matchUrlId: pair.candidate.matchUrlId,
      scenarioFingerprint: pair.candidate.scenarioFingerprint,
      candidateSeat: pair.candidate.candidateSeat,
      frame: divergence.frame, baselineImplementation, candidateImplementation,
      baselineOutcome, candidateOutcome, outcomeRankDelta: delta,
      baselineTerminalCategory: pair.baseline.terminalCategory,
      candidateTerminalCategory: pair.candidate.terminalCategory,
      depthZero, observationIncomplete,
      baselineRoot, candidateRoot });
  }
  const document = { schemaVersion: 1,
    objectKind: "PAIRED_FIRST_DIVERGENCE_CORPUS_V1",
    baselineImplementation, candidateImplementation, summary, roots,
    fingerprint: "" };
  document.fingerprint = fingerprintObject({ ...document, fingerprint: "" });
  return document;
}

function writeCorpus(document, inputFile, outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const rootLines = document.roots.map(root => JSON.stringify(root)).join("\n");
  const rootsBytes = zlib.gzipSync(rootLines ? `${rootLines}\n` : "", { level: 9 });
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"), rootsBytes);
  const overview = { ...document, roots: undefined };
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    `${JSON.stringify(overview, null, 2)}\n`);
  const inputBytes = fs.readFileSync(inputFile);
  const manifest = { schemaVersion: 1,
    objectKind: "PAIRED_FIRST_DIVERGENCE_MANIFEST_V1",
    inputFile, inputSha256: sha256Bytes(inputBytes),
    baselineImplementation: document.baselineImplementation,
    candidateImplementation: document.candidateImplementation,
    rootCount: document.roots.length, corpusFingerprint: document.fingerprint,
    rootsSha256: sha256Bytes(rootsBytes), fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, fingerprint: "" });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function run() {
  const inputFile = path.resolve(option("--input", "/tmp/matches.ndjson.gz"));
  const outputDirectory = path.resolve(option("--output",
    "/tmp/paired-first-divergence-corpus"));
  const baseline = option("--baseline", "V2_WORKING_CURRENT");
  const candidate = option("--candidate", "V2_OBSERVATION_SUPPORT_GUARD");
  const document = buildCorpus(readNdjson(inputFile), baseline, candidate);
  const manifest = writeCorpus(document, inputFile, outputDirectory);
  process.stdout.write(`${JSON.stringify({ outputDirectory,
    summary: document.summary, fingerprint: document.fingerprint,
    manifestFingerprint: manifest.fingerprint }, null, 2)}\n`);
  return document;
}

if (require.main === module) {
  try { run(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { readNdjson, pairKey, outcomeRank, commandKey, firstDivergence,
  compactCandidate, compactRoot, buildCorpus, writeCorpus, run };
