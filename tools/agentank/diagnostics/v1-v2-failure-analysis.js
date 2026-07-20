"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { loadDd9Assignment } = require("../simulation/dd9-assignment");
const { scenariosForIds, loadRollingV1Scenarios } = require("../simulation/historical-scenarios");
const { VARIANTS, loadSimulator, runMatch } = require("../simulation/paired-arena");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");
const { sourceIdentity } = require("./v1-v2-working-arena");

const FAILURE_CLASS = Object.freeze({
  COMMITTED_PROJECTILE: "COMMITTED_ENEMY_PROJECTILE",
  SAME_FRAME_FIRE: "SAME_FRAME_NEW_FIRE",
  TANK_COLLISION: "TANK_COLLISION",
  FRAME_SETTLEMENT: "FRAME_128_SETTLEMENT",
  SIMULATOR_BOMB: "SIMULATOR_BOMB_PHASE",
  UNRESOLVED: "UNRESOLVED_CRASH",
  NON_REPRODUCIBLE: "NON_REPRODUCIBLE"
});

function outcome(match) {
  return match?.result?.winnerImplementation === "v2" ? "WIN" :
    match?.result?.winnerImplementation === "v1" ? "LOSS" : "DRAW";
}

function loadArena(root, overviewFile) {
  const file = path.resolve(overviewFile); const overview = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(overview.reportKind === "V1_V2_WORKING_STRUCTURAL_ARENA",
    "FAILURE_ANALYSIS_OVERVIEW_KIND_INVALID", file);
  const matches = [];
  for (const item of overview.reports || []) {
    const reportFile = contained(root, item.relativePath);
    const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    invariant(report.fingerprint === item.fingerprint,
      "FAILURE_ANALYSIS_REPORT_FINGERPRINT_MISMATCH", item.relativePath);
    matches.push(...report.matches);
  }
  invariant(matches.length === overview.execution.matchCount,
    "FAILURE_ANALYSIS_MATCH_COUNT_MISMATCH", `${matches.length}/${overview.execution.matchCount}`);
  return { file, overview, matches, byId: new Map(matches.map(match => [match.matchId, match])) };
}

function actionSignature(match) {
  return (match.actionTrace || []).map(frame => `${frame.frame}:` + (frame.seats || []).map(seat =>
    seat ? `${seat.implementation}/${seat.action}` : "HOLD").join("|")).join(";");
}

function sameOutcomeAndActions(original, replayed) {
  return original.result.winnerImplementation === replayed.result.winnerImplementation &&
    original.result.reason === replayed.result.reason && original.frames === replayed.frames &&
    actionSignature(original) === actionSignature(replayed);
}

function eventOwnerSeat(event) {
  const id = event?.tank?.id;
  if (id === "tank-0") return 0;
  if (id === "tank-1") return 1;
  return -1;
}

function classifyReplay(match) {
  if (match.result.reason === "frameLimit") return {
    failureClass: FAILURE_CLASS.FRAME_SETTLEMENT, evidenceAuthority: "EXTERNAL_SIM_TERMINAL_MODEL",
    frame: match.frames - 1
  };
  const records = match.replay?.records || []; const v2Seat = match.v2Seat;
  const enemySeat = v2Seat ^ 1; const createdFrame = new Map();
  for (let frame = 0; frame < records.length; frame += 1)
    for (const event of records[frame] || [])
      if (event.type === "bullet" && event.action === "created")
        createdFrame.set(event.objectId, frame);
  for (let frame = records.length - 1; frame >= 0; frame -= 1) {
    const events = records[frame] || [];
    const crashIndex = events.findIndex(event => event.type === "tank" &&
      event.action === "crashed" && (event.index === v2Seat || event.objectId === `tank-${v2Seat}`));
    if (crashIndex < 0) continue;
    const bomb = events.slice(0, crashIndex).findLast(event =>
      event.type === "bomb" && event.action === "exploded");
    if (bomb) return { failureClass: FAILURE_CLASS.SIMULATOR_BOMB,
      evidenceAuthority: "EXTERNAL_SIM_KNOWN_PHASE_DEVIATION", frame,
      sourceEntityId: bomb.objectId || null };
    let projectile = null;
    for (let index = crashIndex - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type === "bullet" && event.action === "go" &&
          eventOwnerSeat(event) === enemySeat) { projectile = event; break; }
    }
    if (projectile) {
      const created = createdFrame.get(projectile.objectId);
      return { failureClass: created === frame ? FAILURE_CLASS.SAME_FRAME_FIRE :
        FAILURE_CLASS.COMMITTED_PROJECTILE,
        evidenceAuthority: "EXTERNAL_SIM_PROJECTILE_TRACE", frame,
        sourceEntityId: projectile.objectId, createdFrame: created ?? null,
        substep: Number.isSafeInteger(projectile.order) ? projectile.order : null,
        hitPosition: Array.isArray(projectile.position) ? projectile.position.slice() : null };
    }
    const tankCrashes = events.filter(event => event.type === "tank" && event.action === "crashed");
    if (tankCrashes.length === 2) return { failureClass: FAILURE_CLASS.TANK_COLLISION,
      evidenceAuthority: "EXTERNAL_SIM_ONLY_PLATFORM_RULE_VARIANT_UNRESOLVED", frame };
    return { failureClass: FAILURE_CLASS.UNRESOLVED,
      evidenceAuthority: "INSUFFICIENT_EVENT_CAUSALITY", frame };
  }
  return { failureClass: FAILURE_CLASS.UNRESOLVED,
    evidenceAuthority: "V2_CRASH_EVENT_NOT_FOUND", frame: null };
}

function compactCandidate(candidate) {
  const fire = (candidate.enemyScores || []).find(item => item[0] === "FIRE");
  return { action: candidate.action, hard: candidate.hard, score: candidate.score,
    informationScore: candidate.informationScore, worstEnemyAction: candidate.worstEnemyAction,
    enemyFireScore: fire ? fire[1] : null };
}

function deathWindow(match, radius = 3) {
  const classification = classifyReplay(match); const end = classification.frame == null ?
    match.frames - 1 : classification.frame; const start = Math.max(0, end - radius + 1);
  const diagnostic = new Map((match.v2?.diagnosticFrames || []).map(frame => [frame.frame, frame]));
  const actions = new Map((match.actionTrace || []).map(frame => [frame.frame, frame]));
  const frames = [];
  for (let frame = start; frame <= end; frame += 1) {
    const item = diagnostic.get(frame);
    frames.push({ frame, actions: actions.get(frame)?.seats || [null, null],
      v2: item ? { action: item.action, root: item.root,
        informationComplete: item.informationComplete, selectedHard: item.selectedHard,
        allowCount: item.allowCount, score: item.score, runtimeMode: item.runtimeMode,
        fallback: item.fallback, state: item.state,
        candidates: (item.candidates || []).map(compactCandidate) } : null,
      events: match.replay?.records?.[frame] || [] });
  }
  return { classification, frames };
}

function frameSettlement(match) {
  const stars = match.counts?.stars || [0, 0]; const v2Seat = match.v2Seat;
  const equalStars = stars[0] === stars[1];
  const v2Runtime = match.v2?.totalRuntimeMicros ?? null;
  const v1Runtime = match.v1?.totalRuntimeMicros ?? null;
  return { failureClass: FAILURE_CLASS.FRAME_SETTLEMENT,
    evidenceAuthority: "EXTERNAL_SIM_TERMINAL_MODEL_PLATFORM_ORDER_CONFIRMED_RUNTIME_LOCAL_ONLY",
    frame: match.frames - 1, stars, equalStars,
    v2RuntimeMicros: v2Runtime, v1RuntimeMicros: v1Runtime,
    runtimeOrder: v2Runtime == null || v1Runtime == null ? "UNKNOWN" :
      v2Runtime < v1Runtime ? "V2_LOWER" : v2Runtime > v1Runtime ? "V2_HIGHER" : "EQUAL",
    v2StarOrder: stars[v2Seat] < stars[v2Seat ^ 1] ? "LOWER" :
      stars[v2Seat] > stars[v2Seat ^ 1] ? "HIGHER" : "EQUAL" };
}

function increment(target, key) { target[key] = (target[key] || 0) + 1; }

function summarize(entries) {
  const summary = { failures: entries.length, byClass: {}, byTransition: {},
    byFamily: {}, byClassAndTransition: {}, reproducible: 0, nonReproducible: 0 };
  for (const entry of entries) {
    increment(summary.byClass, entry.failureClass); increment(summary.byTransition, entry.transition);
    increment(summary.byFamily, entry.family); increment(summary.byClassAndTransition,
      `${entry.failureClass}:${entry.transition}`);
    if (entry.reproducible === true) summary.reproducible += 1;
    if (entry.reproducible === false) summary.nonReproducible += 1;
  }
  return summary;
}

function scenarioMap(root) {
  const { assignment, manifest } = loadDd9Assignment(root);
  const assignedIds = assignment.assignments.map(item => item.matchUrlId);
  const scenarios = scenariosForIds(manifest, assignedIds, root);
  const rolling = loadRollingV1Scenarios(root).scenarios;
  return new Map([...scenarios, ...rolling].map(scenario => [scenario.matchUrlId, scenario]));
}

function selectedParameters(root, arena) {
  const relative = arena.overview.parameters?.performanceBinding?.reportRelativePath;
  invariant(relative, "FAILURE_ANALYSIS_PERFORMANCE_BINDING_MISSING", arena.file);
  const report = JSON.parse(fs.readFileSync(contained(root, relative), "utf8"));
  invariant(report.selection?.status === "SELECTED" && report.selection.parameters,
    "FAILURE_ANALYSIS_PERFORMANCE_SELECTION_INVALID", relative);
  invariant(fingerprintObject(report.selection.parameters) === arena.overview.parameters.fingerprint,
    "FAILURE_ANALYSIS_PARAMETER_FINGERPRINT_MISMATCH", relative);
  return { parameters: report.selection.parameters, report };
}

function checkpointState(directory, identity) {
  const metaFile = path.join(directory, "replay-checkpoint-meta.json");
  const dataFile = path.join(directory, "replay-checkpoint.jsonl");
  if (fs.existsSync(metaFile)) {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    invariant(fingerprintObject(meta.identity) === fingerprintObject(identity),
      "FAILURE_ANALYSIS_CHECKPOINT_IDENTITY_MISMATCH", directory);
  } else writeJsonAtomic(metaFile, { schemaVersion: 1, identity }, { mode: 0o644 });
  const entries = new Map();
  if (fs.existsSync(dataFile)) for (const line of fs.readFileSync(dataFile, "utf8").split(/\r?\n/)) {
    if (!line) continue; const entry = JSON.parse(line); entries.set(entry.matchId, entry);
  }
  return { dataFile, entries };
}

async function runFailureAnalysis(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const before = loadArena(root, options.beforeOverview);
  const after = loadArena(root, options.afterOverview);
  const source = sourceIdentity(root);
  invariant(source.sha256 === after.overview.source.sha256,
    "FAILURE_ANALYSIS_SOURCE_NOT_AFTER_ARENA", `${source.sha256}/${after.overview.source.sha256}`);
  const selected = selectedParameters(root, after); const parameters = selected.parameters;
  const token = `${source.sha256.slice(0, 16)}-${before.overview.fingerprint.slice(0, 12)}-` +
    `${after.overview.fingerprint.slice(0, 12)}`;
  const directory = path.resolve(options.outputDirectory || contained(root, "artifacts", "diagnostics",
    "v1-v2-failure-classification", token)); ensureDirectory(directory);
  const identity = { beforeFingerprint: before.overview.fingerprint,
    afterFingerprint: after.overview.fingerprint, sourceSha256: source.sha256,
    parameterFingerprint: after.overview.parameters.fingerprint, classifierVersion: 1 };
  const checkpoint = checkpointState(directory, identity);
  const scenarios = scenarioMap(root); const simulator = await loadSimulator(root);
  const frozen = loadFrozenCandidate(root); const v1Code = fs.readFileSync(frozen.v1File, "utf8");
  const settings = v2Options(parameters); const failures = after.matches.filter(match => outcome(match) === "LOSS")
    .sort((left, right) => left.matchId.localeCompare(right.matchId));
  const replayTargets = failures.filter(match => match.result.reason !== "frameLimit");
  const replayLimit = options.replayLimit == null ? replayTargets.length :
    Math.max(0, Math.floor(Number(options.replayLimit)));
  let attempted = 0;
  for (const original of replayTargets) {
    if (attempted >= replayLimit) break;
    if (checkpoint.entries.has(original.matchId)) { attempted += 1; continue; }
    const scenario = scenarios.get(original.historicalMatchUrlId);
    const variant = VARIANTS.find(item => item.variantId === original.variantId);
    invariant(scenario && variant, "FAILURE_ANALYSIS_REPLAY_INPUT_MISSING", original.matchId);
    const replayed = await runMatch(simulator.module, scenario, variant, original.repetition,
      v1Code, after.overview.execution.timeoutMs, settings,
      { includeReplay: true, captureActions: true, captureAllFrames: true });
    const reproducible = sameOutcomeAndActions(original, replayed);
    const window = deathWindow(replayed, Number(options.deathWindow) || 3);
    const beforeMatch = before.byId.get(original.matchId);
    const entry = { matchId: original.matchId, historicalMatchUrlId: original.historicalMatchUrlId,
      variantId: original.variantId, family: original.family, repetition: original.repetition,
      v2Seat: original.v2Seat, transition: `${beforeMatch ? outcome(beforeMatch) : "MISSING"}_TO_LOSS`,
      reproducible, original: { frames: original.frames, result: original.result,
        counts: original.counts, actionSignature: actionSignature(original) },
      replayed: { frames: replayed.frames, result: replayed.result,
        counts: replayed.counts, actionSignature: actionSignature(replayed) },
      failureClass: reproducible ? window.classification.failureClass :
        FAILURE_CLASS.NON_REPRODUCIBLE,
      classification: reproducible ? window.classification : {
        failureClass: FAILURE_CLASS.NON_REPRODUCIBLE,
        evidenceAuthority: "REPLAY_ACTION_OR_OUTCOME_DIVERGED" },
      deathWindow: window.frames };
    fs.appendFileSync(checkpoint.dataFile, `${JSON.stringify(entry)}\n`);
    checkpoint.entries.set(entry.matchId, entry); attempted += 1;
    if (typeof options.onProgress === "function") options.onProgress(attempted, replayLimit,
      entry.matchId, entry.failureClass, reproducible);
  }
  const entries = [];
  for (const match of failures) {
    const beforeMatch = before.byId.get(match.matchId);
    if (match.result.reason === "frameLimit") {
      const classification = frameSettlement(match);
      entries.push({ matchId: match.matchId, historicalMatchUrlId: match.historicalMatchUrlId,
        variantId: match.variantId, family: match.family, repetition: match.repetition,
        v2Seat: match.v2Seat, transition: `${beforeMatch ? outcome(beforeMatch) : "MISSING"}_TO_LOSS`,
        reproducible: null, failureClass: classification.failureClass, classification,
        original: { frames: match.frames, result: match.result, counts: match.counts },
        deathWindow: (match.actionTrace || []).slice(-3) });
    } else {
      const replay = checkpoint.entries.get(match.matchId);
      if (replay) entries.push(replay);
    }
  }
  const aligned = { beforeMatches: before.matches.length, afterMatches: after.matches.length,
    comparable: 0, transitions: {} };
  for (const match of after.matches) {
    const prior = before.byId.get(match.matchId); if (!prior) continue;
    aligned.comparable += 1; increment(aligned.transitions, `${outcome(prior)}_TO_${outcome(match)}`);
  }
  const report = { schemaVersion: 1, reportKind: "V1_V2_FAILURE_CLASSIFICATION",
    status: entries.length === failures.length ? "COMPLETE" : "PARTIAL",
    identity, inputs: { beforeOverview: path.relative(root, before.file).replaceAll("\\", "/"),
      afterOverview: path.relative(root, after.file).replaceAll("\\", "/"),
      simulatorAuthority: "EXTERNAL_SIM_CANDIDATE_NOT_PLATFORM_TRUTH",
      platformConfirmed: { projectileCreatedThenTwoSubstepsSameFrame: true,
        frameSettlementAfterRecord127: true }, platformUnresolved: { tankMoveCollision: true },
      excludedFromCoreCorrection: ["SIMULATOR_BOMB_PHASE"] }, aligned,
    execution: { totalFailures: failures.length, crashReplayTargets: replayTargets.length,
      replayLimit, replayCompleted: [...checkpoint.entries.keys()].filter(id =>
        replayTargets.some(match => match.matchId === id)).length,
      deathWindowFrames: Number(options.deathWindow) || 3 },
    summary: summarize(entries), entries, fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  const file = path.join(directory, "failure-classification-report.json");
  writeJsonAtomic(file, report, { mode: 0o644 });
  if (report.status === "COMPLETE") writeJsonImmutable(path.join(directory, "history",
    `failure-classification-${report.fingerprint}.json`), report, { mode: 0o644 });
  return { report, file, directory };
}

module.exports = { FAILURE_CLASS, outcome, loadArena, actionSignature, sameOutcomeAndActions,
  classifyReplay, deathWindow, frameSettlement, summarize, runFailureAnalysis };
