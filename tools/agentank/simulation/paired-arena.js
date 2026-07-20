"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { loadDd9Assignment, idsForRole } = require("./dd9-assignment");
const { scenariosForIds, createHistoricalStarProvider } = require("./historical-scenarios");
const { ProductionDiagnosticBot, diagnosticCopy } = require("./production-diagnostic-bot");

const SIMULATOR_COMMIT = "1ef804eb2c187138c4c8e5229fb37cd0126beddf";
const SIMULATOR_ARCHIVE_SHA256 = "b9498c1a7d8a2d5bcc015c05fe838ca5a87b7c211629884d3a830cfb6eae70a4";
const VARIANTS = Object.freeze([
  Object.freeze({ variantId: "NATIVE_V1_SEAT0", family: "NATIVE", bots: ["v1", "v2"],
    skills: ["stun", "poison"] }),
  Object.freeze({ variantId: "NATIVE_V2_SEAT0", family: "NATIVE", bots: ["v2", "v1"],
    skills: ["poison", "stun"] }),
  Object.freeze({ variantId: "SKILL_CROSS_V1_SEAT0", family: "SKILL_CROSS", bots: ["v1", "v2"],
    skills: ["poison", "stun"] }),
  Object.freeze({ variantId: "SKILL_CROSS_V2_SEAT0", family: "SKILL_CROSS", bots: ["v2", "v1"],
    skills: ["stun", "poison"] })
]);

function percentile(values, numerator) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1,
    Math.floor((sorted.length - 1) * numerator / 100))];
}

class DecisionAudit {
  constructor(bot, options = {}) {
    this.bot = bot; this.decisions = 0; this.timeoutCount = 0; this.errorCount = 0;
    this.runtimeMicros = []; this.actionCounts = {}; this.actionFrames = [];
    this.captureActionFrames = Boolean(options.captureActionFrames);
  }
  decide(context) {
    const decision = this.bot.decide(context); const action = decision?.action || null;
    const runtimeMicros = Math.max(0, Math.round(Number(decision?.runtimeMs || 0) * 1000));
    this.decisions += 1; this.runtimeMicros.push(runtimeMicros);
    const name = action?.type || "none"; this.actionCounts[name] = (this.actionCounts[name] || 0) + 1;
    if (name === "timeout") this.timeoutCount += 1;
    if (name === "error") this.errorCount += 1;
    if (this.captureActionFrames) this.actionFrames.push({
      frame: Number.isSafeInteger(context?.game?.frames) ? context.game.frames :
        Number.isSafeInteger(context?.game?.frame) ? context.game.frame : this.decisions - 1,
      action: name, command: action ? JSON.parse(JSON.stringify(action)) : null, runtimeMicros });
    return decision;
  }
  summary() {
    return { decisionCount: this.decisions, timeoutCount: this.timeoutCount,
      errorCount: this.errorCount,
      totalRuntimeMicros: this.runtimeMicros.reduce((sum, value) => sum + value, 0),
      p50RuntimeMicros: percentile(this.runtimeMicros, 50),
      p95RuntimeMicros: percentile(this.runtimeMicros, 95),
      maxRuntimeMicros: this.runtimeMicros.length ? Math.max(...this.runtimeMicros) : 0,
      actionCounts: this.actionCounts,
      ...(this.captureActionFrames ? { actionFrames: this.actionFrames } : {}) };
  }
}

function mergeActionTrace(v1, v2, v1Seat, v2Seat, skills) {
  const byFrame = new Map();
  for (const item of v1.actionFrames || []) {
    const frame = byFrame.get(item.frame) || { frame: item.frame, seats: [null, null] };
    frame.seats[v1Seat] = { implementation: "v1", skill: skills[v1Seat],
      action: item.action, command: portableScheduledAction(item.command),
      runtimeMicros: item.runtimeMicros }; byFrame.set(item.frame, frame);
  }
  for (const item of v2.actionFrames || []) {
    const frame = byFrame.get(item.frame) || { frame: item.frame, seats: [null, null] };
    frame.seats[v2Seat] = { implementation: "v2", skill: skills[v2Seat],
      action: item.action, command: portableScheduledAction(item.command),
      runtimeMicros: item.runtimeMicros, workUnits: item.workUnits, root: item.root,
      informationComplete: item.informationComplete, selectedHard: item.selectedHard,
      allowCount: item.allowCount, proof: item.proof,
      proofCompletedDepth: item.proofCompletedDepth, proofNodes: item.proofNodes,
      completedDepth: item.completedDepth, depthNodes: item.depthNodes, score: item.score,
      runtimeMode: item.runtimeMode, fallback: item.fallback,
      invalidFallback: item.invalidFallback }; byFrame.set(item.frame, frame);
  }
  return [...byFrame.values()].sort((left, right) => left.frame - right.frame);
}

function simulatorDirectory(root) {
  const directory = contained(root, "artifacts", "vendor", `agentank-simulator-${SIMULATOR_COMMIT}`);
  invariant(fs.existsSync(path.join(directory, "src", "index.js")),
    "PINNED_SIMULATOR_NOT_BOOTSTRAPPED", "run ./tools/bootstrap-local-simulator.sh first");
  return directory;
}

async function loadSimulator(root) {
  const directory = simulatorDirectory(root);
  const module = await import(pathToFileURL(path.join(directory, "src", "index.js")).href);
  invariant(typeof module.AgenTankSimulator === "function" && typeof module.loadBotFromCode === "function",
    "PINNED_SIMULATOR_EXPORT_MISSING", directory);
  return { module, directory };
}

function seedFor(scenario, repetition) {
  return Number.parseInt(sha256Text(`${scenario.fingerprint}\0${repetition}`).slice(0, 8), 16) >>> 0;
}

function collectCounts(replay, v2Seat) {
  const counts = { stars: [0, 0], crashes: [0, 0], bullets: [0, 0], bombs: [0, 0],
    skills: [0, 0], v2CrashCause: "NONE" };
  const ids = replay.replayData.replay.meta.players.map(item => item.tank.id);
  for (const frame of replay.replayData.replay.records) {
    let bombExploded = false; let bulletMoved = false;
    for (const event of frame) {
      if (event.type === "star" && event.action === "collected" && (event.by === 0 || event.by === 1))
        counts.stars[event.by] += 1;
      if (event.type === "bullet" && event.action === "created") {
        const seat = ids.indexOf(event.tank?.id); if (seat >= 0) counts.bullets[seat] += 1;
      }
      if (event.type === "bullet" && event.action === "go") bulletMoved = true;
      if (event.type === "bomb" && event.action === "created" && (event.by === 0 || event.by === 1))
        counts.bombs[event.by] += 1;
      if (event.type === "bomb" && event.action === "exploded") bombExploded = true;
      if (event.type === "skill" && event.action === "cast" && (event.by === 0 || event.by === 1))
        counts.skills[event.by] += 1;
    }
    for (const event of frame) if (event.type === "tank" && event.action === "crashed") {
      const seat = event.index === 0 || event.index === 1 ? event.index : ids.indexOf(event.objectId);
      if (seat >= 0) counts.crashes[seat] += 1;
      if (seat === v2Seat) counts.v2CrashCause = bombExploded ? "BOMB" :
        bulletMoved ? "PROJECTILE_OR_COLLISION" : "COLLISION_OR_UNKNOWN";
    }
  }
  return counts;
}

function resultFor(replay, variant) {
  const winnerSeat = replay.result?.winner;
  return { winnerSeat: winnerSeat === 0 || winnerSeat === 1 ? winnerSeat : null,
    winnerImplementation: winnerSeat === 0 || winnerSeat === 1 ? variant.bots[winnerSeat] : "draw",
    reason: replay.result?.reason || "UNKNOWN" };
}

function createV2Bot(options) { return new ProductionDiagnosticBot(options || {}); }

// Persist only fields consumed by the pinned simulator. A bot may attach diagnostic metadata
// (including fractional scores) to an action; that metadata is not part of physical replay and
// must not make an integer-canonical evidence run fail.
function portableScheduledAction(action) {
  if (!action || typeof action !== "object") return null;
  const type = typeof action.type === "string" ? action.type : "";
  if (!type) return null;
  const output = { type };
  if (typeof action.side === "string") output.side = action.side === "left" ? "left" : "right";
  if (type === "teleport") {
    invariant(Number.isSafeInteger(action.x) && Number.isSafeInteger(action.y),
      "NON_CANONICAL_TELEPORT_ACTION", `${action.x},${action.y}`);
    output.x = action.x; output.y = action.y;
  }
  if (typeof action.reason === "string") output.reason = action.reason;
  return output;
}

function portableScheduledDecision(decision) {
  const runtimeMicros = Math.max(0, Math.round(Number(decision?.runtimeMs || 0) * 1000));
  invariant(Number.isSafeInteger(runtimeMicros), "NON_CANONICAL_DECISION_RUNTIME",
    String(decision?.runtimeMs));
  const logs = [];
  for (const log of Array.isArray(decision?.logs) ? decision.logs : []) {
    if (!log || (log.type !== "speak" && log.type !== "print")) continue;
    logs.push({ type: log.type, data: String(log.data ?? "") });
  }
  return { runtimeMicros, logs };
}

async function runMatch(simulatorModule, scenario, variant, repetition, v1Code, timeoutMs, v2Options,
    diagnostics = {}) {
  const v2Seat = variant.bots.indexOf("v2"); const star = createHistoricalStarProvider(scenario.stars);
  const simulator = new simulatorModule.AgenTankSimulator({ map: scenario.map,
    tanks: scenario.starts.map((tank, seat) => ({ ...tank, id: `tank-${seat}` })),
    skills: variant.skills.slice(), star: star.initialStar, starProvider: value => star.provider(value),
    seed: seedFor(scenario, repetition), maxFrames: 128, starLimit: false });
  const bots = [];
  for (let seat = 0; seat < 2; seat += 1) {
    if (variant.bots[seat] === "v2") bots.push(createV2Bot({ ...(v2Options || {}),
      captureActionFrames: diagnostics.captureActions === true,
      captureAllFrames: diagnostics.captureAllFrames === true }));
    else bots.push(new DecisionAudit(simulatorModule.loadBotFromCode(v1Code,
      { timeoutMs, loadTimeoutMs: 2000 }),
      { captureActionFrames: diagnostics.captureActions === true }));
  }
  const contexts = diagnostics.includeContexts ? [[], []] : null;
  if (contexts) for (let seat = 0; seat < 2; seat += 1) {
    const bot = bots[seat]; const decide = bot.decide.bind(bot);
    bot.decide = context => { contexts[seat].push(diagnosticCopy(context)); return decide(context); };
  }
  const stepTrace = diagnostics.captureStepTrace ? [] : null;
  if (stepTrace) {
    const step = simulator.step.bind(simulator);
    simulator.step = (actions, decisions) => {
      const frame = simulator.frame;
      const scheduledActions = (actions || []).map(portableScheduledAction);
      const scheduledDecisions = (decisions || []).map(portableScheduledDecision);
      const events = step(actions, decisions);
      const portableEvents = JSON.parse(JSON.stringify(events));
      stepTrace.push({ frame, actions: scheduledActions, decisions: scheduledDecisions,
        eventFingerprint: fingerprintObject({ events: portableEvents }) });
      return events;
    };
  }
  const replay = simulator.run(bots[0], bots[1]);
  const result = resultFor(replay, variant); const counts = collectCounts(replay, v2Seat);
  const v2 = bots[v2Seat].summary(); const v1 = bots[v2Seat ^ 1].summary();
  const output = { matchId: `${scenario.matchUrlId}:${variant.variantId}:r${repetition}`,
    historicalMatchUrlId: scenario.matchUrlId, scenarioFingerprint: scenario.fingerprint,
    variantId: variant.variantId, family: variant.family, repetition,
    seatImplementations: variant.bots.slice(), seatSkills: variant.skills.slice(), v2Seat,
    frames: replay.replayData.replay.records.length, result, counts,
    starSequence: star.stats(), v1, v2 };
  if (diagnostics.captureActions) {
    output.actionTrace = mergeActionTrace(v1, v2, v2Seat ^ 1, v2Seat, variant.skills);
    delete v1.actionFrames; delete v2.actionFrames;
  }
  if (contexts) output.contexts = { seat0: contexts[0], seat1: contexts[1] };
  if (stepTrace) output.stepTrace = stepTrace;
  // Simulator meta contains host timing floats. A diagnostic trace needs the
  // deterministic event records, not those non-portable elapsed values.
  if (diagnostics.includeReplay) output.replay = {
    records: JSON.parse(JSON.stringify(replay.replayData.replay.records))
  };
  return output;
}

function aggregate(matches, expectedScenarios, repetitions) {
  const output = { matchCount: matches.length, scenarioCount: new Set(matches.map(item =>
    item.historicalMatchUrlId)).size, expectedScenarios, repetitions, variantsPerScenario: VARIANTS.length,
    v2Wins: 0, v2Losses: 0, draws: 0, nativeV2Wins: 0, nativeV2Losses: 0,
    crossV2Wins: 0, crossV2Losses: 0, v2CrashLosses: 0, v2Timeouts: 0, v2Errors: 0,
    v1Timeouts: 0, v1Errors: 0, selectedHardRejects: 0, avoidableHardRejects: 0,
    unavoidableAllRejected: 0, riskDominatedSelections: 0, rootRestoreFailures: 0,
    hotAllocations: 0, v2Decisions: 0, v2EmergencyActions: 0,
    v2ReducedModeDecisions: 0,
    v2ActionCounts: {}, v1ActionCounts: {}, v2RuntimeModeCounts: {},
    v2CrashCauses: {}, resultReasons: {},
    native: { matches: 0, wins: 0, losses: 0, draws: 0, crashLosses: 0 },
    skillCross: { matches: 0, wins: 0, losses: 0, draws: 0, crashLosses: 0 },
    variants: {}, v2RuntimeMicros: [], v1RuntimeMicros: [], layerRootCounts: {} };
  for (const match of matches) {
    const winner = match.result.winnerImplementation;
    const family = match.family === "NATIVE" ? output.native : output.skillCross;
    const variant = output.variants[match.variantId] || (output.variants[match.variantId] =
      { matches: 0, wins: 0, losses: 0, draws: 0, crashLosses: 0 });
    family.matches += 1; variant.matches += 1;
    if (winner === "v2") { output.v2Wins += 1;
      family.wins += 1; variant.wins += 1;
      if (match.family === "NATIVE") output.nativeV2Wins += 1; else output.crossV2Wins += 1; }
    else if (winner === "v1") { output.v2Losses += 1;
      family.losses += 1; variant.losses += 1;
      if (match.family === "NATIVE") output.nativeV2Losses += 1; else output.crossV2Losses += 1; }
    else { output.draws += 1; family.draws += 1; variant.draws += 1; }
    if (winner === "v1" && match.counts.crashes[match.v2Seat] > 0) {
      output.v2CrashLosses += 1; family.crashLosses += 1; variant.crashLosses += 1; }
    output.v2CrashCauses[match.counts.v2CrashCause] =
      (output.v2CrashCauses[match.counts.v2CrashCause] || 0) + 1;
    output.resultReasons[match.result.reason] = (output.resultReasons[match.result.reason] || 0) + 1;
    output.v2Timeouts += match.v2.timeoutCount || 0; output.v2Errors += match.v2.errorCount || 0;
    output.v1Timeouts += match.v1.timeoutCount || 0; output.v1Errors += match.v1.errorCount || 0;
    output.selectedHardRejects += match.v2.layerTotals.selectedHardRejects;
    output.avoidableHardRejects += match.v2.layerTotals.avoidableHardRejects;
    output.unavoidableAllRejected += match.v2.layerTotals.unavoidableAllRejected;
    output.riskDominatedSelections += match.v2.layerTotals.riskDominatedSelections || 0;
    output.rootRestoreFailures += match.v2.layerTotals.depthRootRestoreFailures;
    output.hotAllocations += match.v2.layerTotals.hotAllocations;
    output.v2Decisions += match.v2.decisionCount || 0;
    output.v2EmergencyActions += match.v2.layerTotals.fallbacks || 0;
    for (const [name, count] of Object.entries(match.v2.actionCounts || {}))
      output.v2ActionCounts[name] = (output.v2ActionCounts[name] || 0) + count;
    for (const [name, count] of Object.entries(match.v1.actionCounts || {}))
      output.v1ActionCounts[name] = (output.v1ActionCounts[name] || 0) + count;
    for (const [name, count] of Object.entries(match.v2.runtimeModeCounts || {}))
      output.v2RuntimeModeCounts[name] = (output.v2RuntimeModeCounts[name] || 0) + count;
    output.v2RuntimeMicros.push(match.v2.totalRuntimeMicros);
    output.v1RuntimeMicros.push(match.v1.totalRuntimeMicros);
    for (const [name, count] of Object.entries(match.v2.layerTotals.rootCounts))
      output.layerRootCounts[name] = (output.layerRootCounts[name] || 0) + count;
  }
  const runtime = values => ({ total: values.reduce((sum, value) => sum + value, 0),
    p50PerMatch: percentile(values, 50), p95PerMatch: percentile(values, 95),
    maxPerMatch: values.length ? Math.max(...values) : 0 });
  output.v2Runtime = runtime(output.v2RuntimeMicros); output.v1Runtime = runtime(output.v1RuntimeMicros);
  output.v2ReducedModeDecisions = (output.v2RuntimeModeCounts[2] || 0) +
    (output.v2RuntimeModeCounts[3] || 0);
  output.v2ReducedModeRatePer10000 = output.v2Decisions ?
    Math.floor(output.v2ReducedModeDecisions * 10000 / output.v2Decisions) : 0;
  output.v2EmergencyActionRatePer10000 = output.v2Decisions ?
    Math.floor(output.v2EmergencyActions * 10000 / output.v2Decisions) : 0;
  delete output.v2RuntimeMicros; delete output.v1RuntimeMicros;
  output.complete = output.scenarioCount === expectedScenarios &&
    output.matchCount === expectedScenarios * repetitions * VARIANTS.length;
  return output;
}

async function runPairedArena(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const role = options.role || "CALIBRATION";
  invariant(role === "DISCOVERY" || role === "CALIBRATION" || role === "FROZEN_REGRESSION",
    "PAIRED_ARENA_ROLE_INVALID", role);
  const repetitions = Math.max(1, Math.floor(Number(options.repetitions) || 1));
  const timeoutMs = Math.max(20, Math.floor(Number(options.timeoutMs) || 200));
  const { assignment, manifest } = loadDd9Assignment(root);
  let ids = idsForRole(assignment, role); const fullCount = ids.length;
  const limit = options.limit == null ? fullCount : Math.max(1, Math.floor(Number(options.limit)));
  ids = ids.slice(0, limit);
  const scenarios = scenariosForIds(manifest, ids, root); const simulator = await loadSimulator(root);
  const v1File = contained(root, options.v1File || "battle-baselines/tiny-tank-v24-published.js");
  const v1Code = options.v1Code === undefined ? fs.readFileSync(v1File, "utf8") :
    String(options.v1Code); const matches = [];
  const expectedMatches = scenarios.length * repetitions * VARIANTS.length;
  for (const scenario of scenarios) for (let repetition = 0; repetition < repetitions; repetition += 1)
    for (const variant of VARIANTS) {
      matches.push(await runMatch(simulator.module, scenario, variant, repetition, v1Code, timeoutMs,
        options.v2Options, options.diagnostics));
      if (typeof options.onProgress === "function") options.onProgress(matches.length, expectedMatches,
        scenario.matchUrlId, variant.variantId);
    }
  const summary = aggregate(matches, scenarios.length, repetitions);
  const nativeCriticalErrors = matches.filter(item => item.family === "NATIVE").reduce((sum, item) =>
    sum + (item.v2.timeoutCount || 0) + (item.v2.errorCount || 0), 0);
  const nativeAvoidableHardRejects = matches.filter(item => item.family === "NATIVE").reduce((sum, item) =>
    sum + item.v2.layerTotals.avoidableHardRejects, 0);
  const crossAvoidableHardRejects = matches.filter(item => item.family === "SKILL_CROSS").reduce((sum, item) =>
    sum + item.v2.layerTotals.avoidableHardRejects, 0);
  const report = { schemaVersion: 1, reportKind: "IMP8_HISTORICAL_PAIRED_ARENA",
    status: summary.complete && nativeAvoidableHardRejects === 0 &&
      summary.rootRestoreFailures === 0 && summary.hotAllocations === 0 && nativeCriticalErrors === 0 ?
      "PASS" : "FAIL",
    gateEligible: ids.length === fullCount, experimentId: options.experimentId || null,
    candidateProfileId: options.candidateProfileId || null,
    role, lane: role === "DISCOVERY" ? "DISCOVERY" :
      role === "CALIBRATION" ? "CALIBRATION" : "FROZEN",
    targetTankProfileId: "v2", v1Baseline: { relativePath:
      options.v1RelativePath || path.relative(root, v1File),
      sha256: sha256Bytes(v1Code) },
    v2Implementation: "engine-v2/src/runtime/production-root.js",
    assignment: { fingerprint: assignment.assignmentFingerprint, fullRoleMatchCount: fullCount,
      executedRoleMatchCount: ids.length },
    simulator: { repository: "cyhhao/agentank-simulator", commit: SIMULATOR_COMMIT,
      archiveSha256: SIMULATOR_ARCHIVE_SHA256, directory: path.relative(root, simulator.directory),
      evidenceClass: "EXTERNAL_SIM_CANDIDATE",
      knownRuleDeviations: ["BOMB_PHASE", "POISON_COOLDOWN_DURATION", "PLATFORM_RUNTIME_MODEL",
        "SAME_FRAME_TERMINAL", "STAR_RANDOM_DISTRIBUTION_UNUSED_HERE"] },
    experiment: { maxFrames: 128, repetitions, timeoutMs, variants: VARIANTS.map(item => ({
      variantId: item.variantId, family: item.family, bots: item.bots, skills: item.skills })),
      historicalMapExact: true, historicalStartExact: true,
      historicalStarCoordinatesAndEarliestFramesExact: true },
    invariants: { selectedHardRejects: summary.selectedHardRejects,
      avoidableHardRejects: summary.avoidableHardRejects,
      unavoidableAllRejected: summary.unavoidableAllRejected,
      riskDominatedSelections: summary.riskDominatedSelections,
      nativeAvoidableHardRejects, crossAvoidableHardRejects,
      rootRestoreFailures: summary.rootRestoreFailures, hotAllocations: summary.hotAllocations,
      nativeCriticalErrors },
    gameplayQuality: { status: "OBSERVED_NOT_GATE", reason:
      "No win-rate threshold was preregistered before this arena batch; results may diagnose or rank a future preregistered candidate set but cannot retroactively accept this Candidate." },
    summary, matches, fingerprint: "" };
  if (options.candidateBinding) report.candidateBinding = { ...options.candidateBinding };
  report.fingerprint = fingerprintObject(report);
  const base = options.outputDirectory ? path.resolve(options.outputDirectory) :
    role === "DISCOVERY" ? contained(root, "artifacts", "diagnostics", "paired-arena-discovery-v1") :
      role === "CALIBRATION" ? contained(root, "artifacts", "imp8", "calibration",
        "paired-arena-v1") : contained(root, "artifacts", "imp8", "frozen", "g10a-paired-arena-v1");
  ensureDirectory(base); writeJsonAtomic(path.join(base, "paired-arena-report.json"), report, { mode: 0o644 });
  writeJsonImmutable(path.join(base, "history", `paired-arena-${report.fingerprint}.json`),
    report, { mode: 0o644 });
  return { report, directory: base };
}

module.exports = { SIMULATOR_COMMIT, SIMULATOR_ARCHIVE_SHA256, VARIANTS,
  DecisionAudit, mergeActionTrace, simulatorDirectory, loadSimulator, collectCounts, aggregate,
  portableScheduledAction, portableScheduledDecision, runMatch, runPairedArena };
