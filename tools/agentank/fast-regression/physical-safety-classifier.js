"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { SIMULATOR_COMMIT, SIMULATOR_ARCHIVE_SHA256 } = require("../simulation/paired-arena");
const { FastRegressionStore } = require("./artifact-store");
const { rehydratePhysical } = require("./rehydrate");
const { PHYSICAL_SAFETY_STATUS, PhysicalSafetyOracle } = require("./physical-safety-oracle");

const TARGET_MODEL_CLASS = "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES";
const VERDICT = Object.freeze({ CONFIRMED: "CONFIRMED_FALSE_PROVEN_SAFE",
  WITNESS: "OBSERVATION_CONSISTENT_WINDOW_WITNESS", UNKNOWN: "UNRESOLVED_INCOMPLETE" });

function loadArtifact(file, kind) {
  invariant(fs.existsSync(file), "FAST_REGRESSION_ARTIFACT_NOT_FOUND", file);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(value.artifactKind === kind && value.fingerprint === fingerprintObject(value),
    "FAST_REGRESSION_ARTIFACT_INVALID", file); return value;
}

function commandForActionName(name) {
  if (name === "NONE") return null;
  if (name === "GO") return { type: "go" };
  if (name === "TURN_LEFT") return { type: "turn", side: "left" };
  if (name === "TURN_RIGHT") return { type: "turn", side: "right" };
  if (name === "FIRE") return { type: "fire" };
  if (name === "THROW_BOMB") return { type: "throwBomb" };
  if (typeof name === "string" && name.startsWith("CAST_"))
    return { type: name.slice(5).toLowerCase() };
  return undefined;
}

function pushUnique(target, command) {
  if (command === undefined) return;
  const key = JSON.stringify(command || null);
  if (!target.some(item => JSON.stringify(item || null) === key))
    target.push(command ? { ...command } : null);
}

function buildPreferences(capsule, result) {
  const own = new Map(); const enemy = new Map(); const seat = capsule.assignment.v2Seat;
  for (const step of capsule.prefix.stepTrace || []) {
    const ownList = own.get(step.frame) || []; pushUnique(ownList, step.actions?.[seat]);
    own.set(step.frame, ownList);
    const enemyList = enemy.get(step.frame) || []; pushUnique(enemyList, step.actions?.[seat ^ 1]);
    enemy.set(step.frame, enemyList);
  }
  for (const frame of result.frames || []) {
    const list = own.get(frame.frame) || []; pushUnique(list, frame.selectedCommand);
    for (const name of frame.rescuingActions || []) pushUnique(list, commandForActionName(name));
    own.set(frame.frame, list);
  }
  return { own, enemy };
}

function selectCases(report, corpus) {
  const admitted = new Set(corpus.continuationCandidates.map(item =>
    `${item.capsuleFingerprint}:${item.frame}`));
  const selected = [];
  for (const result of report.results || []) {
    if (result.role !== "PRIMARY_LOSS") continue;
    for (const frame of result.frames || []) {
      if (frame.modelClass !== TARGET_MODEL_CLASS) continue;
      const key = `${result.fingerprint}:${frame.frame}`;
      invariant(admitted.has(key), "PHYSICAL_SAFETY_CASE_NOT_IN_FROZEN_CORPUS", key);
      invariant(Number.isSafeInteger(frame.distanceToTerminal) && frame.distanceToTerminal > 0 &&
        frame.distanceToTerminal < 4, "PHYSICAL_SAFETY_HORIZON_INVALID", key);
      selected.push({ key, result, frame });
    }
  }
  selected.sort((left, right) => left.result.fingerprint.localeCompare(right.result.fingerprint) ||
    left.frame.frame - right.frame.frame);
  return selected;
}

function classifyVerdict(outcome) {
  if (outcome.status === PHYSICAL_SAFETY_STATUS.NO_WITNESS && outcome.complete)
    return VERDICT.CONFIRMED;
  if (outcome.status === PHYSICAL_SAFETY_STATUS.WINDOW_SAFE && outcome.complete)
    return VERDICT.WITNESS;
  return VERDICT.UNKNOWN;
}

function oracleSourceBinding(workspaceRoot) {
  const files = ["physical-safety-oracle.js", "physical-safety-classifier.js"];
  const hashes = files.map(name => ({ file: `tools/agentank/fast-regression/${name}`,
    sha256: sha256Bytes(fs.readFileSync(path.join(workspaceRoot, "tools", "agentank",
      "fast-regression", name))) }));
  return { files: hashes, aggregateSha256: fingerprintObject({ hashes }) };
}

function writeDefectCorpus(store, report) {
  const confirmedDefects = report.results.filter(item => item.verdict === VERDICT.CONFIRMED)
    .map(item => ({ caseId: item.caseId, capsuleFingerprint: item.capsuleFingerprint,
      historicalMatchUrlId: item.historicalMatchUrlId, variantId: item.variantId,
      v2Seat: item.v2Seat, frame: item.frame, horizonFrames: item.horizonFrames,
      selectedCommand: item.selectedCommand, physicalFingerprint: item.physicalFingerprint,
      counterexample: item.outcome.counterexample, counters: item.outcome.counters }));
  const artifact = { artifactKind: "FAST_REGRESSION_PHYSICAL_SAFETY_DEFECT_CORPUS",
    properties: ["IMMUTABLE", "CONTENT_ADDRESSED", "SOURCE_BOUND", "RULE_BOUND",
      "PINNED_SIMULATOR_PROOF"], semantics: {
      defect: "FIXED_ROOT_ACTION_HAS_NO_OBSERVATION_CONSISTENT_SURVIVAL_POLICY_IN_TERMINAL_WINDOW",
      ownDecision: "EXISTS_PER_OBSERVATION_HISTORY",
      environment: "FOR_ALL_PHYSICAL_WORLD_ENEMY_ACTION_CHANCE_OUTCOME",
      incomplete: "NEVER_PROMOTED_TO_DEFECT" },
    source: { classificationReportFingerprint: report.fingerprint,
      focusedReportFingerprint: report.source.focusedReportFingerprint,
      baselineCorpusFingerprint: report.source.baselineCorpusFingerprint,
      simulatorCommit: report.source.simulator.commit,
      workingSourceSha256: report.source.workingSourceSha256,
      oracleSourceSha256: report.source.oracle.aggregateSha256 },
    counts: { confirmedDefects: confirmedDefects.length }, confirmedDefects,
    fingerprint: "" };
  artifact.fingerprint = fingerprintObject(artifact);
  const directory = path.join(store.paths.root, "defect-corpora", "physical-safety-v1");
  ensureDirectory(directory); const file = path.join(directory, `${artifact.fingerprint}.json`);
  writeJsonImmutable(file, artifact, { mode: 0o644 });
  writeJsonAtomic(path.join(directory, "latest.json"), artifact, { mode: 0o644 });
  return { artifact, file };
}

async function classifyPhysicalSafety(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const reportName = String(options.reportName || "native-poison-death-safety-chance");
  const reportFile = options.reportPath ? path.resolve(workspaceRoot, options.reportPath) :
    path.join(store.paths.reports, reportName, "latest.json");
  const corpusFile = options.corpusPath ? path.resolve(workspaceRoot, options.corpusPath) :
    path.join(store.paths.root, "defect-corpora", "safety-v1", "latest.json");
  const focused = loadArtifact(reportFile, "FAST_REGRESSION_FOCUSED_COUNTERFACTUAL_DIAGNOSTIC");
  const corpus = loadArtifact(corpusFile, "FAST_REGRESSION_SAFETY_DEFECT_CORPUS");
  invariant(focused.cohort.fingerprint === corpus.source.cohortFingerprint,
    "PHYSICAL_SAFETY_COHORT_MISMATCH", focused.cohort.fingerprint);
  const cases = selectCases(focused, corpus);
  invariant(cases.length > 0, "PHYSICAL_SAFETY_CASES_EMPTY", focused.fingerprint);
  const budgets = { transitionBudget: Number(options.transitionBudget ?? 200000),
    nodeBudget: Number(options.nodeBudget ?? 20000),
    maximumBeliefWorlds: Number(options.maximumBeliefWorlds ?? 2048) };
  for (const [name, value] of Object.entries(budgets)) invariant(Number.isSafeInteger(value) &&
    value >= 0, "PHYSICAL_SAFETY_BUDGET_INVALID", `${name}:${value}`);
  const results = [];
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index]; const { capsule } = store.readCapsule(item.result.fingerprint);
    invariant(capsule.simulator.commit === SIMULATOR_COMMIT &&
      capsule.simulator.archiveSha256 === SIMULATOR_ARCHIVE_SHA256,
    "PHYSICAL_SAFETY_SIMULATOR_BINDING_MISMATCH", capsule.fingerprint);
    const restored = await rehydratePhysical(workspaceRoot, capsule, item.frame.frame);
    const preferences = buildPreferences(capsule, item.result);
    const oracle = new PhysicalSafetyOracle({ ...budgets,
      preferredOwnByFrame: preferences.own, preferredEnemyByFrame: preferences.enemy });
    const horizonFrames = item.frame.distanceToTerminal + 1;
    const outcome = oracle.classifyRoot(restored.simulator, capsule.assignment.v2Seat,
      item.frame.selectedCommand, horizonFrames);
    const result = { caseId: fingerprintObject({ capsuleFingerprint: capsule.fingerprint,
      frame: item.frame.frame, selectedCommand: item.frame.selectedCommand, horizonFrames }),
    capsuleFingerprint: capsule.fingerprint, matchId: item.result.matchId,
    historicalMatchUrlId: item.result.historicalMatchUrlId, variantId: item.result.variantId,
    v2Seat: capsule.assignment.v2Seat, frame: item.frame.frame,
    distanceToTerminal: item.frame.distanceToTerminal, horizonFrames,
    selectedAction: item.frame.selectedAction, selectedCommand: item.frame.selectedCommand,
    productionSafety: item.frame.selectedCandidate?.safety,
    physicalFingerprint: restored.physicalFingerprint,
    verifiedPrefixEvents: restored.verifiedEvents, verdict: classifyVerdict(outcome), outcome };
    results.push(result);
    if (typeof options.onProgress === "function") options.onProgress(index + 1, cases.length,
      capsule.fingerprint, result.verdict, outcome.counters);
  }
  const counts = { cases: results.length,
    confirmedFalseProvenSafe: results.filter(item => item.verdict === VERDICT.CONFIRMED).length,
    observationConsistentWindowWitness: results.filter(item => item.verdict === VERDICT.WITNESS).length,
    unresolvedIncomplete: results.filter(item => item.verdict === VERDICT.UNKNOWN).length,
    transitions: results.reduce((sum, item) => sum + item.outcome.counters.transitions, 0),
    nodes: results.reduce((sum, item) => sum + item.outcome.counters.nodes, 0) };
  const report = { artifactKind: "FAST_REGRESSION_PHYSICAL_SAFETY_CLASSIFICATION",
    status: counts.unresolvedIncomplete === 0 ? "COMPLETED" : "PARTIAL",
    properties: ["IMMUTABLE", "CONTENT_ADDRESSED", "SOURCE_BOUND", "RULE_BOUND",
      "PINNED_SIMULATOR_PROOF", "NO_PRODUCTION_MUTATION"], semantics: {
      rootAction: "FIXED_TO_AUDITED_V2_ACTION", futureOwnAction: "EXISTS_PER_OBSERVATION_HISTORY",
      enemyAction: "FOR_ALL_COMPLETE_PRIMITIVE_SUPPORT", chanceOutcome: "FOR_ALL_BINARY_STUN_SUPPORT",
      horizon: "DISTANCE_TO_HISTORICAL_TERMINAL_PLUS_ONE_MAXIMUM_FOUR",
      windowSafe: "SURVIVES_WINDOW_NOT_GLOBAL_PROOF",
      futureStar: "CURRENT_STAR_PRESERVED_NEW_SPAWNS_SUPPRESSED_PHYSICAL_SURVIVAL_NEUTRAL",
      incomplete: "UNKNOWN_NEVER_SAFE_OR_DEFECT" },
    source: { focusedReportFingerprint: focused.fingerprint,
      baselineCorpusFingerprint: corpus.fingerprint, cohortFingerprint: focused.cohort.fingerprint,
      runId: focused.cohort.runId, workingSourceSha256: focused.execution.workingSourceSha256,
      simulator: { commit: SIMULATOR_COMMIT, archiveSha256: SIMULATOR_ARCHIVE_SHA256 },
      oracle: oracleSourceBinding(workspaceRoot) }, budgets, counts, results };
  const written = store.writeReport(report, options.outputName || "physical-safety-oracle");
  const corpusWritten = writeDefectCorpus(store, written.report);
  return { ...written, defectCorpus: corpusWritten };
}

module.exports = { TARGET_MODEL_CLASS, VERDICT, loadArtifact, commandForActionName,
  buildPreferences, selectCases, classifyVerdict, oracleSourceBinding, writeDefectCorpus,
  classifyPhysicalSafety };
