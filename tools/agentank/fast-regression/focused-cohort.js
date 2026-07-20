"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const zlib = require("node:zlib");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { writeJsonImmutable } = require("../core/atomic-file");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");
const { FastRegressionStore } = require("./artifact-store");
const { greedyCover } = require("./cohort");

const FOCUS_CLASS = Object.freeze({
  NATIVE_SINGLE_CRASH_LOSS: "NATIVE_SINGLE_CRASH_LOSS",
  NATIVE_SINGLE_CRASH_WIN: "NATIVE_SINGLE_CRASH_WIN",
  NATIVE_STAR_WIN: "NATIVE_STAR_WIN",
  OTHER: "OTHER"
});

function focusedTargetClass(match) {
  if (match.family !== "NATIVE") return FOCUS_CLASS.OTHER;
  const result = classifyAnalysisOutcome(match);
  if (result.terminalCategory === "SINGLE_CRASH" && result.analysisOutcome === "V1_WIN")
    return FOCUS_CLASS.NATIVE_SINGLE_CRASH_LOSS;
  if (result.terminalCategory === "SINGLE_CRASH" && result.analysisOutcome === "V2_WIN")
    return FOCUS_CLASS.NATIVE_SINGLE_CRASH_WIN;
  if (result.terminalCategory === "FRAME_LIMIT_STARS" && result.analysisOutcome === "V2_WIN")
    return FOCUS_CLASS.NATIVE_STAR_WIN;
  return FOCUS_CLASS.OTHER;
}

function bucket(value, width, maximum) {
  return Math.min(maximum, Math.floor(Math.max(0, Number(value) || 0) / width) * width);
}

function focusedFeatures(match) {
  const values = new Set(); const add = (name, value) => values.add(`${name}:${value}`);
  add("variant", match.variantId); add("v2Seat", match.v2Seat);
  add("frameBucket", bucket(match.frames, 16, 128));
  add("crashCause", match.counts?.v2CrashCause || "NONE");
  add("v2Stars", Math.min(4, match.counts?.stars?.[match.v2Seat] || 0));
  add("starDelta", Math.sign((match.counts?.stars?.[match.v2Seat] || 0) -
    (match.counts?.stars?.[match.v2Seat ^ 1] || 0)));
  add("v2Bullets", Math.min(4, match.counts?.bullets?.[match.v2Seat] || 0));
  add("enemyBullets", Math.min(4, match.counts?.bullets?.[match.v2Seat ^ 1] || 0));
  add("bombs", Math.min(3, (match.counts?.bombs?.[0] || 0) +
    (match.counts?.bombs?.[1] || 0)));
  add("skills", Math.min(4, (match.counts?.skills?.[match.v2Seat] || 0)));
  add("runtimeMode2", (match.v2?.runtimeModeCounts?.[2] || 0) > 0 ? 1 : 0);
  add("emergency", (match.v2?.actionCounts?.NONE || 0) > 0 ? 1 : 0);
  return [...values].sort();
}

function orderedRepresentatives(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const values = groups.get(entry.match.variantId) || [];
    values.push(entry); groups.set(entry.match.variantId, values);
  }
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([, values]) => {
      const sorted = values.slice().sort((left, right) => left.rank.localeCompare(right.rank));
      const covered = greedyCover(sorted, sorted.length).selected;
      const selected = new Set(covered.map(item => item.match.matchId));
      return covered.concat(sorted.filter(item => !selected.has(item.match.matchId)));
    });
  const output = [];
  for (let index = 0; ; index += 1) {
    let appended = 0;
    for (const group of orderedGroups) if (index < group.length) {
      output.push(group[index]); appended += 1;
    }
    if (appended === 0) return output;
  }
}

function terminalEntryIndex(cohort) {
  const output = new Map();
  for (const entry of cohort.lanes?.terminalAll || []) {
    if (!entry.tags.some(tag => tag === "TERMINAL" || tag.startsWith("TERMINAL_"))) continue;
    const prior = output.get(entry.matchId);
    if (!prior || entry.evaluationFrame > prior.evaluationFrame) output.set(entry.matchId, entry);
  }
  return output;
}

async function readCompactMatches(store, runId) {
  const manifestFile = path.join(store.paths.runs, runId, "manifest.json");
  invariant(fs.existsSync(manifestFile), "FAST_REGRESSION_RUN_NOT_FOUND", runId);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  invariant(manifest.completion === "COMPLETE", "FAST_REGRESSION_RUN_NOT_COMPLETE", runId);
  const indexFile = path.join(store.paths.history, "match-indexes", `${runId}.json`);
  if (fs.existsSync(indexFile)) {
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    invariant(index.runId === runId && index.runManifestFingerprint === manifest.fingerprint &&
      index.fingerprint === fingerprintObject(index), "FAST_REGRESSION_MATCH_INDEX_INVALID", runId);
    return { manifest, matches: index.matches, indexFile, cached: true };
  }
  const input = fs.createReadStream(path.join(store.paths.runs, runId,
    manifest.artifacts.matches.file)).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity }); const matches = [];
  for await (const line of lines) if (line) {
    const match = JSON.parse(line); matches.push({ matchId: match.matchId,
      historicalMatchUrlId: match.historicalMatchUrlId, scenarioFingerprint: match.scenarioFingerprint,
      variantId: match.variantId, family: match.family, repetition: match.repetition,
      seatImplementations: match.seatImplementations, seatSkills: match.seatSkills,
      v2Seat: match.v2Seat, frames: match.frames, result: match.result, counts: match.counts,
      v2: { runtimeModeCounts: match.v2?.runtimeModeCounts || {},
        actionCounts: match.v2?.actionCounts || {} } });
  }
  invariant(matches.length === manifest.artifacts.matches.records,
    "FAST_REGRESSION_MATCH_DENOMINATOR_MISMATCH",
  `${matches.length}/${manifest.artifacts.matches.records}`);
  const index = { artifactKind: "FAST_REGRESSION_COMPACT_MATCH_INDEX", runId,
    runManifestFingerprint: manifest.fingerprint,
    properties: ["IMMUTABLE", "SOURCE_RUN_BOUND", "RUNTIME_INDEPENDENT_CLASSIFICATION_INPUT"],
    matches, fingerprint: "" };
  index.fingerprint = fingerprintObject(index); writeJsonImmutable(indexFile, index, { mode: 0o644 });
  return { manifest, matches, indexFile, cached: false };
}

function laneEntry(store, record, role) {
  const entry = record.terminalEntry; const result = classifyAnalysisOutcome(record.match);
  return { fingerprint: entry.fingerprint, relativePath: entry.relativePath,
    matchId: record.match.matchId, historicalMatchUrlId: record.match.historicalMatchUrlId,
    evaluationFrame: entry.evaluationFrame, tags: entry.tags, role,
    variantId: record.match.variantId, v2Seat: record.match.v2Seat,
    analysisOutcome: result.analysisOutcome, terminalCategory: result.terminalCategory,
    features: record.features, sourceRunId: record.sourceRunId,
    capsuleFile: path.relative(store.paths.root, record.capsuleFile).replaceAll("\\", "/") };
}

function counterpartVariant(variantId) {
  return variantId === "NATIVE_V1_SEAT0" ? "NATIVE_V2_SEAT0" : "NATIVE_V1_SEAT0";
}

async function buildFocusedCohort(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const runId = String(options.runId || "");
  invariant(runId.startsWith("run-"), "FAST_REGRESSION_FOCUSED_RUN_REQUIRED", runId);
  const sourceName = String(options.sourceCohort || "initial-full");
  const sourceFile = path.join(store.paths.cohorts, `${sourceName}.json`);
  invariant(fs.existsSync(sourceFile), "FAST_REGRESSION_SOURCE_COHORT_NOT_FOUND", sourceName);
  const sourceCohort = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  const terminal = terminalEntryIndex(sourceCohort);
  const { manifest: runManifest, matches, indexFile } = await readCompactMatches(store, runId);
  const byMatch = new Map(matches.map(match => [match.matchId, match]));
  const records = matches.map(match => ({ match, terminalEntry: terminal.get(match.matchId),
    targetClass: focusedTargetClass(match), features: focusedFeatures(match),
    rank: fingerprintObject({ matchId: match.matchId, runId }) }))
    .filter(record => record.terminalEntry && record.targetClass !== FOCUS_CLASS.OTHER);

  const validate = record => {
    if (record.validated !== undefined) return record.validated;
    const read = store.readCapsule(record.terminalEntry.fingerprint);
    record.capsuleFile = read.file; record.sourceRunId = read.capsule.source.runId;
    record.validated = record.sourceRunId === runId &&
      read.capsule.source.matchId === record.match.matchId;
    return record.validated;
  };
  const take = (targetClass, maximum) => {
    const ordered = orderedRepresentatives(records.filter(record =>
      record.targetClass === targetClass)); const output = [];
    for (const record of ordered) {
      if (validate(record)) output.push(record);
      if (output.length >= maximum) break;
    }
    return output;
  };
  const maximumLosses = Math.max(1, Math.floor(Number(options.maximumLosses) || 64));
  const controlCount = Math.max(1, Math.floor(Number(options.controlCount) || 16));
  const losses = take(FOCUS_CLASS.NATIVE_SINGLE_CRASH_LOSS, maximumLosses);
  const crashWins = take(FOCUS_CLASS.NATIVE_SINGLE_CRASH_WIN, controlCount);
  const starWins = take(FOCUS_CLASS.NATIVE_STAR_WIN, controlCount);
  const counterparts = [];
  for (const loss of losses) {
    const matchId = `${loss.match.historicalMatchUrlId}:${counterpartVariant(loss.match.variantId)}:` +
      `r${loss.match.repetition}`;
    const match = byMatch.get(matchId); const entry = terminal.get(matchId);
    if (!match || !entry) continue;
    const record = { match, terminalEntry: entry, targetClass: focusedTargetClass(match),
      features: focusedFeatures(match), rank: fingerprintObject({ matchId, runId }) };
    if (validate(record)) counterparts.push(record);
  }
  const lanes = {
    nativeSingleCrashLoss: losses.map(record => laneEntry(store, record, "PRIMARY_LOSS")),
    nativeSwappedCounterpart: counterparts.map(record => laneEntry(store, record, "SWAPPED_CONTROL")),
    nativeSingleCrashWinControl: crashWins.map(record => laneEntry(store, record, "CRASH_WIN_CONTROL")),
    nativeStarWinControl: starWins.map(record => laneEntry(store, record, "STAR_WIN_CONTROL"))
  };
  const selected = Object.values(lanes).flat();
  const manifest = {
    properties: ["DETERMINISTIC", "SOURCE_RUN_BOUND", "NATIVE_SKILL_BOUND",
      "BALANCED_SEAT_SELECTION", "DIAGNOSTIC_NOT_PROOF"],
    focus: { ownSkill: "poison", opponentSkill: "stun",
      purpose: "NATIVE_POISON_SINGLE_CRASH_COUNTERFACTUAL_DIAGNOSTIC" },
    source: { runId, runManifestFingerprint: runManifest.fingerprint,
      sourceCohort: sourceName, sourceCohortFingerprint: sourceCohort.fingerprint,
      compactMatchIndex: path.relative(store.paths.root, indexFile).replaceAll("\\", "/"),
      capsuleRoot: fingerprintObject({ fingerprints: selected.map(item => item.fingerprint).sort() }) },
    lanes,
    coverage: { candidateMatches: records.length, maximumLosses, controlCount,
      nativeSingleCrashLoss: losses.length, nativeSwappedCounterpart: counterparts.length,
      nativeSingleCrashWinControl: crashWins.length, nativeStarWinControl: starWins.length,
      variants: Object.fromEntries([...new Set(selected.map(item => item.variantId))].sort().map(
        variant => [variant, selected.filter(item => item.variantId === variant).length])) }
  };
  invariant(losses.length === maximumLosses,
    "FAST_REGRESSION_FOCUSED_LOSS_DENOMINATOR_INCOMPLETE", `${losses.length}/${maximumLosses}`);
  invariant(counterparts.length === losses.length,
    "FAST_REGRESSION_FOCUSED_SWAP_DENOMINATOR_INCOMPLETE",
  `${counterparts.length}/${losses.length}`);
  invariant(crashWins.length === controlCount && starWins.length === controlCount,
    "FAST_REGRESSION_FOCUSED_CONTROL_DENOMINATOR_INCOMPLETE",
  `${crashWins.length}/${starWins.length}/${controlCount}`);
  return store.writeCohort(manifest, options.name || "native-poison-death");
}

module.exports = { FOCUS_CLASS, focusedTargetClass, focusedFeatures, orderedRepresentatives,
  terminalEntryIndex, readCompactMatches, buildFocusedCohort };
