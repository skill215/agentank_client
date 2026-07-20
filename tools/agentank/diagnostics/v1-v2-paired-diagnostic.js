"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { validateSchemaObject } = require("../core/schema-validator");
const { loadDd9Assignment, idsForRole } = require("../simulation/dd9-assignment");
const { scenariosForIds, createHistoricalStarProvider } = require("../simulation/historical-scenarios");
const { SIMULATOR_COMMIT, SIMULATOR_ARCHIVE_SHA256, VARIANTS, DecisionAudit,
  loadSimulator, collectCounts, runMatch } = require("../simulation/paired-arena");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");

const DEFAULT_PLAN = "config/engine-v2/v1-v2-failure-diagnostic-v1.json";
const KNOWN_SIMULATOR_DEVIATIONS = Object.freeze(["BOMB_PHASE", "POISON_COOLDOWN_DURATION",
  "PLATFORM_RUNTIME_MODEL", "SAME_FRAME_TERMINAL", "STAR_RANDOM_DISTRIBUTION_UNUSED_HERE"]);

function slash(value) { return value.replaceAll("\\", "/"); }
function percentile(values, numerator) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1,
    Math.floor((sorted.length - 1) * numerator / 100))];
}
function readPlan(root, relativePath = DEFAULT_PLAN) {
  const file = contained(root, relativePath); const bytes = fs.readFileSync(file);
  const plan = JSON.parse(bytes); validateSchemaObject("v1-v2-failure-diagnostic-plan", plan, root);
  return { plan, file, relativePath: slash(path.relative(root, file)), sha256: sha256Bytes(bytes) };
}
function seedFor(scenario, repetition) {
  return Number.parseInt(sha256Text(`${scenario.fingerprint}\0${repetition}`).slice(0, 8), 16) >>> 0;
}
function resultFor(replay, variant) {
  const seat = replay.result?.winner;
  return { winnerSeat: seat === 0 || seat === 1 ? seat : null,
    winnerImplementation: seat === 0 || seat === 1 ? variant.bots[seat] : "draw",
    reason: replay.result?.reason || "UNKNOWN" };
}

function compileBotFactory(simulatorModule, code, options = {}) {
  invariant(typeof simulatorModule.BotRunner === "function",
    "V1_V2_DIAGNOSTIC_BOT_RUNNER_MISSING", "BotRunner");
  const script = new vm.Script(`${code}\nthis.__agentankOnIdle = typeof onIdle === "function" ? onIdle : null;\n`);
  return function createIsolatedBot() {
    const logs = []; const sandbox = {
      print: (...args) => logs.push({ type: "print", data: args.join(" ") }),
      speak: text => logs.push({ type: "speak", data: String(text ?? "") })
    };
    vm.createContext(sandbox, { microtaskMode: "afterEvaluate" });
    script.runInContext(sandbox, { timeout: options.loadTimeoutMs || 2000 });
    invariant(typeof sandbox.__agentankOnIdle === "function",
      "V1_V2_DIAGNOSTIC_ON_IDLE_MISSING", "onIdle");
    return new simulatorModule.BotRunner(sandbox, logs, options);
  };
}

async function runExactMatch(simulatorModule, scenario, variant, repetition, codes, timeoutMs,
    maxFrames) {
  const v2Seat = variant.bots.indexOf("v2"); const star = createHistoricalStarProvider(scenario.stars);
  const simulator = new simulatorModule.AgenTankSimulator({ map: scenario.map,
    tanks: scenario.starts.map((tank, seat) => ({ ...tank, id: `tank-${seat}` })),
    skills: variant.skills.slice(), star: star.initialStar, starProvider: value => star.provider(value),
    seed: seedFor(scenario, repetition), maxFrames, starLimit: false });
  const bots = variant.bots.map(implementation => new DecisionAudit(
    typeof codes[implementation] === "function" ? codes[implementation]() :
      simulatorModule.loadBotFromCode(codes[implementation], { timeoutMs, loadTimeoutMs: 2000 })));
  const replay = simulator.run(bots[0], bots[1]);
  return { matchId: `${scenario.matchUrlId}:${variant.variantId}:r${repetition}`,
    historicalMatchUrlId: scenario.matchUrlId, historicalRole: scenario.historicalRole,
    scenarioFingerprint: scenario.fingerprint, mapHash: scenario.mapHash,
    originalSubjectSeat: scenario.originalSubjectSeat, repetition,
    variantId: variant.variantId, family: variant.family,
    seatImplementations: variant.bots.slice(), seatSkills: variant.skills.slice(), v2Seat,
    frames: replay.replayData.replay.records.length, result: resultFor(replay, variant),
    counts: collectCounts(replay, v2Seat), starSequence: star.stats(),
    v1: bots[variant.bots.indexOf("v1")].summary(), v2: bots[v2Seat].summary() };
}

function outcome(match) {
  return match.result.winnerImplementation === "v2" ? "WIN" :
    match.result.winnerImplementation === "v1" ? "LOSS" : "DRAW";
}
function rate(value, total) { return total ? Math.floor(value * 10000 / total) : 0; }
function addCount(target, key, amount = 1) { target[key] = (target[key] || 0) + amount; }
function runtimeSummary(values) {
  return { totalMicros: values.reduce((sum, value) => sum + value, 0),
    p50MicrosPerMatch: percentile(values, 50), p95MicrosPerMatch: percentile(values, 95),
    maxMicrosPerMatch: values.length ? Math.max(...values) : 0 };
}

function pairedSummary(matches) {
  const groups = new Map();
  for (const match of matches) {
    const key = `${match.historicalMatchUrlId}\0${match.repetition}\0${match.family}`;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(match);
  }
  const output = { pairCount: groups.size, completePairCount: 0, v2Sweeps: 0, v2Swept: 0,
    split: 0, drawAffected: 0, native: { pairCount: 0, v2Sweeps: 0, v2Swept: 0,
      split: 0, drawAffected: 0 }, skillCross: { pairCount: 0, v2Sweeps: 0, v2Swept: 0,
      split: 0, drawAffected: 0 } };
  for (const group of groups.values()) {
    const family = group[0]?.family === "NATIVE" ? output.native : output.skillCross;
    family.pairCount += 1; if (group.length === 2) output.completePairCount += 1;
    const values = group.map(outcome); const wins = values.filter(value => value === "WIN").length;
    const losses = values.filter(value => value === "LOSS").length;
    const field = values.includes("DRAW") ? "drawAffected" : wins === 2 ? "v2Sweeps" :
      losses === 2 ? "v2Swept" : "split";
    output[field] += 1; family[field] += 1;
  }
  return output;
}

function repetitionSummary(matches) {
  const groups = new Map();
  for (const match of matches) {
    const key = `${match.historicalMatchUrlId}\0${match.variantId}`;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(match);
  }
  let stable = 0; const unstable = [];
  for (const group of groups.values()) {
    const signatures = new Set(group.map(match =>
      `${outcome(match)}:${match.result.reason}:${match.counts.v2CrashCause}`));
    if (signatures.size === 1) stable += 1;
    else unstable.push({ historicalMatchUrlId: group[0].historicalMatchUrlId,
      variantId: group[0].variantId, signatures: [...signatures].sort() });
  }
  return { groupCount: groups.size, stableGroupCount: stable,
    unstableGroupCount: unstable.length, unstable };
}

function summarizeExact(matches, expectedMatches) {
  const summary = { matchCount: matches.length, expectedMatches,
    complete: matches.length === expectedMatches, v2Wins: 0, v2Losses: 0, draws: 0,
    v2WinRatePer10000: 0, native: { matches: 0, wins: 0, losses: 0, draws: 0 },
    skillCross: { matches: 0, wins: 0, losses: 0, draws: 0 },
    byVariant: {}, byV2Seat: { 0: { matches: 0, wins: 0, losses: 0, draws: 0 },
      1: { matches: 0, wins: 0, losses: 0, draws: 0 } },
    v2CrashCauses: {}, resultReasons: {}, v2Timeouts: 0, v2Errors: 0,
    v1Timeouts: 0, v1Errors: 0, v2ActionCounts: {}, v1ActionCounts: {},
    paired: null, repetitionStability: null, v2Runtime: null, v1Runtime: null };
  const v2Runtime = []; const v1Runtime = [];
  for (const match of matches) {
    const value = outcome(match); const family = match.family === "NATIVE" ? summary.native :
      summary.skillCross; const variant = summary.byVariant[match.variantId] ||
      (summary.byVariant[match.variantId] = { matches: 0, wins: 0, losses: 0, draws: 0 });
    const seat = summary.byV2Seat[match.v2Seat]; family.matches += 1; variant.matches += 1;
    seat.matches += 1;
    if (value === "WIN") { summary.v2Wins += 1; family.wins += 1; variant.wins += 1;
      seat.wins += 1; }
    else if (value === "LOSS") { summary.v2Losses += 1; family.losses += 1;
      variant.losses += 1; seat.losses += 1; }
    else { summary.draws += 1; family.draws += 1; variant.draws += 1; seat.draws += 1; }
    addCount(summary.v2CrashCauses, match.counts.v2CrashCause);
    addCount(summary.resultReasons, match.result.reason);
    summary.v2Timeouts += match.v2.timeoutCount; summary.v2Errors += match.v2.errorCount;
    summary.v1Timeouts += match.v1.timeoutCount; summary.v1Errors += match.v1.errorCount;
    for (const [name, count] of Object.entries(match.v2.actionCounts))
      addCount(summary.v2ActionCounts, name, count);
    for (const [name, count] of Object.entries(match.v1.actionCounts))
      addCount(summary.v1ActionCounts, name, count);
    v2Runtime.push(match.v2.totalRuntimeMicros); v1Runtime.push(match.v1.totalRuntimeMicros);
  }
  summary.v2WinRatePer10000 = rate(summary.v2Wins, summary.matchCount);
  summary.native.winRatePer10000 = rate(summary.native.wins, summary.native.matches);
  summary.skillCross.winRatePer10000 = rate(summary.skillCross.wins, summary.skillCross.matches);
  for (const value of Object.values(summary.byVariant)) value.winRatePer10000 = rate(value.wins, value.matches);
  for (const value of Object.values(summary.byV2Seat)) value.winRatePer10000 = rate(value.wins, value.matches);
  summary.paired = pairedSummary(matches); summary.repetitionStability = repetitionSummary(matches);
  summary.v2Runtime = runtimeSummary(v2Runtime); summary.v1Runtime = runtimeSummary(v1Runtime);
  return summary;
}

function frameBucket(frames) { return frames <= 16 ? "EARLY_0_16" : frames <= 64 ?
  "MID_17_64" : frames < 128 ? "LATE_65_127" : "TERMINAL_128"; }
function selectTraceCases(matches, maximum) {
  const losses = matches.filter(match => match.family === "NATIVE" && outcome(match) === "LOSS")
    .sort((left, right) => left.frames - right.frames || left.matchId.localeCompare(right.matchId));
  const selected = []; const selectedIds = new Set(); const coverage = new Set();
  for (const match of losses) {
    const key = `${match.counts.v2CrashCause}:${match.v2Seat}:${frameBucket(match.frames)}:${match.result.reason}`;
    if (coverage.has(key)) continue; coverage.add(key); selected.push(match); selectedIds.add(match.matchId);
    if (selected.length >= maximum) return selected;
  }
  const priority = losses.slice().sort((left, right) => {
    const critical = match => (match.v2.timeoutCount + match.v2.errorCount) * -100000 +
      (match.counts.v2CrashCause === "BOMB" ? -10000 : 0) + match.frames;
    return critical(left) - critical(right) || left.matchId.localeCompare(right.matchId);
  });
  for (const match of priority) if (!selectedIds.has(match.matchId)) {
    selected.push(match); selectedIds.add(match.matchId); if (selected.length >= maximum) break;
  }
  return selected;
}

function crashFrame(records, seat) {
  for (let frame = 0; frame < records.length; frame += 1)
    if (records[frame].some(event => event.type === "tank" && event.action === "crashed" &&
      event.index === seat)) return frame;
  return null;
}
function turnReversals(frames) {
  let previous = null; let count = 0;
  for (const frame of frames) if (frame.action === "TURN_LEFT" || frame.action === "TURN_RIGHT") {
    if (previous && previous !== frame.action) count += 1; previous = frame.action;
  } else previous = null;
  return count;
}
function causalThreat(records, deathFrame, seat, cause) {
  if (deathFrame == null || !records[deathFrame]) return null;
  const terminalEvents = records[deathFrame];
  if (cause === "BOMB") {
    const explosion = terminalEvents.filter(event => event.type === "bomb" &&
      event.action === "exploded").at(-1);
    if (!explosion) return null; let createdFrame = null;
    for (let frame = 0; frame <= deathFrame; frame += 1)
      if (records[frame].some(event => event.type === "bomb" && event.action === "created" &&
        event.objectId === explosion.objectId)) createdFrame = frame;
    return { kind: "BOMB", owner: explosion.by === seat ? "SELF" :
      explosion.by === (seat ^ 1) ? "ENEMY" : "UNKNOWN", objectId: explosion.objectId || null,
    createdFrame, deathFrame, ageFrames: createdFrame == null ? null : deathFrame - createdFrame };
  }
  if (cause === "PROJECTILE_OR_COLLISION") {
    const crashIndex = terminalEvents.findIndex(event => event.type === "tank" &&
      event.action === "crashed" && event.index === seat);
    const movement = terminalEvents.slice(0, crashIndex < 0 ? terminalEvents.length : crashIndex)
      .filter(event => event.type === "bullet" && event.action === "go").at(-1);
    if (!movement) return { kind: "COLLISION_OR_UNKNOWN", owner: "UNKNOWN", objectId: null,
      createdFrame: null, deathFrame, ageFrames: null };
    let createdFrame = null;
    for (let frame = 0; frame <= deathFrame; frame += 1)
      if (records[frame].some(event => event.type === "bullet" && event.action === "created" &&
        event.objectId === movement.objectId)) createdFrame = frame;
    const ownerId = movement.tank?.id; const ownerSeat = ownerId === "tank-0" ? 0 :
      ownerId === "tank-1" ? 1 : -1;
    return { kind: "PROJECTILE", owner: ownerSeat === seat ? "SELF" :
      ownerSeat === (seat ^ 1) ? "ENEMY" : "UNKNOWN", objectId: movement.objectId || null,
    createdFrame, deathFrame, ageFrames: createdFrame == null ? null : deathFrame - createdFrame };
  }
  return null;
}
function analyzeTrace(exact, mirror, windowFrames) {
  const diagnostic = mirror.v2.diagnosticFrames || []; const records = mirror.replay?.records || [];
  const deathFrame = crashFrame(records, mirror.v2Seat); const end = deathFrame == null ?
    Math.max(0, mirror.frames - 1) : deathFrame; const start = Math.max(0, end - windowFrames + 1);
  const window = diagnostic.filter(frame => frame.frame >= start && frame.frame <= end);
  const threat = causalThreat(records, deathFrame, mirror.v2Seat, exact.counts.v2CrashCause);
  const classifications = new Set(); const totals = mirror.v2.layerTotals;
  if (exact.v2.timeoutCount || exact.v2.errorCount) classifications.add("LOCAL_VM_RUNTIME_FAILURE");
  if (totals.avoidableHardRejects) classifications.add("HARD_GATE_AVOIDABLE_REJECT");
  if (window.some(frame => frame.selectedHard === "REJECT_PROVEN" && frame.allowCount === 0))
    classifications.add("ALL_ACTIONS_PROVEN_LOSS_NEAR_TERMINAL");
  if (exact.counts.v2CrashCause === "BOMB") classifications.add("BOMB_DEATH_WINDOW");
  if (exact.counts.v2CrashCause === "PROJECTILE_OR_COLLISION")
    classifications.add("PROJECTILE_OR_COLLISION_DEATH_WINDOW");
  if (window.some(frame => frame.fallback)) classifications.add("FALLBACK_ACTIVE_NEAR_TERMINAL");
  if (window.some(frame => frame.runtimeMode >= 2)) classifications.add("REDUCED_RUNTIME_MODE_NEAR_TERMINAL");
  if (window.some(frame => frame.completedDepth === 0)) classifications.add("ZERO_COMPLETED_DEPTH_NEAR_TERMINAL");
  if (window.some(frame => !frame.informationComplete)) classifications.add("INFORMATION_STATE_NEAR_TERMINAL");
  const reversals = turnReversals(window); if (reversals) classifications.add("TURN_REVERSAL_NEAR_TERMINAL");
  if (exact.frames >= 128) classifications.add("FRAME_128_TERMINAL");
  if (threat?.kind === "BOMB") classifications.add(threat.owner === "SELF" ?
    "SELF_BOMB_DEATH" : threat.owner === "ENEMY" ? "ENEMY_BOMB_DEATH" : "UNKNOWN_BOMB_OWNER");
  if (threat?.kind === "PROJECTILE") classifications.add(threat.ageFrames === 0 ?
    "SAME_FRAME_POTENTIAL_FIRE" : "KNOWN_IN_FLIGHT_PROJECTILE");
  const mirrorOutcome = outcome(mirror); const exactOutcome = outcome(exact);
  if (mirrorOutcome !== exactOutcome || mirror.result.reason !== exact.result.reason)
    classifications.add("EXACT_INSTRUMENTED_MIRROR_DIVERGENCE");
  if (classifications.size === 0) classifications.add("SCORING_OR_PLAN_QUALITY_UNRESOLVED");
  return { exactOutcome, mirrorOutcome, mirrorDiverged: classifications.has(
    "EXACT_INSTRUMENTED_MIRROR_DIVERGENCE"), exactCrashCause: exact.counts.v2CrashCause,
    exactFrames: exact.frames, mirrorFrames: mirror.frames, deathFrame, windowStart: start,
    windowEnd: end, turnReversals: reversals, firstFallbackFrame:
      diagnostic.find(frame => frame.fallback)?.frame ?? null,
    firstReducedRuntimeFrame: diagnostic.find(frame => frame.runtimeMode >= 2)?.frame ?? null,
    causalThreat: threat, classifications: [...classifications].sort(),
    terminalWindow: window.map(frame => ({ frame: frame.frame, action: frame.action,
      root: frame.root, informationComplete: frame.informationComplete,
      selectedHard: frame.selectedHard, allowCount: frame.allowCount, proof: frame.proof,
      completedDepth: frame.completedDepth, depthNodes: frame.depthNodes,
      score: frame.score, runtimeMode: frame.runtimeMode, fallback: frame.fallback,
      state: frame.state, candidates: frame.candidates })) };
}

function loadJournal(file, expectedIds) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean); const matches = [];
  const seen = new Set();
  for (const line of lines) {
    const match = JSON.parse(line); invariant(expectedIds.has(match.matchId),
      "V1_V2_DIAGNOSTIC_JOURNAL_FOREIGN_MATCH", match.matchId);
    invariant(!seen.has(match.matchId), "V1_V2_DIAGNOSTIC_JOURNAL_DUPLICATE", match.matchId);
    seen.add(match.matchId); matches.push(match);
  }
  return matches;
}

async function runV1V2FailureDiagnostic(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const loaded = readPlan(root, options.planPath); const plan = loaded.plan;
  const repetitions = options.repetitions == null ? plan.repetitions :
    Math.max(2, Math.floor(Number(options.repetitions)));
  const maximumTraces = options.maxTraceCases == null ? plan.maxTraceCases :
    Math.max(1, Math.floor(Number(options.maxTraceCases)));
  const frozen = loadFrozenCandidate(root, plan.candidateManifest);
  const { assignment, manifest } = loadDd9Assignment(root); const roleById = new Map();
  const allIds = [];
  for (const role of plan.roles) for (const id of idsForRole(assignment, role)) {
    invariant(!roleById.has(id), "V1_V2_DIAGNOSTIC_ROLE_OVERLAP", id);
    roleById.set(id, role); allIds.push(id);
  }
  allIds.sort(); const limit = options.limit == null ? allIds.length :
    Math.max(1, Math.min(allIds.length, Math.floor(Number(options.limit))));
  const ids = allIds.slice(0, limit); const scenarios = scenariosForIds(manifest, ids, root)
    .map(scenario => ({ ...scenario, historicalRole: roleById.get(scenario.matchUrlId) }));
  const v1File = frozen.v1File; const v2File = contained(root, frozen.manifest.build.minifiedRelativePath);
  const codes = { v1: fs.readFileSync(v1File, "utf8"), v2: fs.readFileSync(v2File, "utf8") };
  invariant(sha256Bytes(codes.v1) === frozen.manifest.selection.v1Sha256,
    "V1_V2_DIAGNOSTIC_V1_HASH_MISMATCH", frozen.manifest.candidateId);
  invariant(sha256Bytes(codes.v2) === frozen.manifest.build.minifiedSha256,
    "V1_V2_DIAGNOSTIC_V2_HASH_MISMATCH", frozen.manifest.candidateId);
  const output = path.resolve(options.outputDirectory || contained(root, "artifacts", "diagnostics",
    "v1-v2", frozen.manifest.candidateId, plan.suiteId.toLowerCase())); ensureDirectory(output);
  const expectedIds = [];
  for (const scenario of scenarios) for (let repetition = 0; repetition < repetitions; repetition += 1)
    for (const variant of VARIANTS)
      expectedIds.push(`${scenario.matchUrlId}:${variant.variantId}:r${repetition}`);
  const expectedIdSet = new Set(expectedIds);
  const context = { schemaVersion: 1, objectKind: "V1_V2_DIAGNOSTIC_RUN_CONTEXT",
    suiteId: plan.suiteId, planSha256: loaded.sha256, candidateId: frozen.manifest.candidateId,
    candidateFingerprint: frozen.manifest.fingerprint, v1Sha256: frozen.manifest.selection.v1Sha256,
    v2Sha256: frozen.manifest.build.minifiedSha256,
    assignmentFingerprint: assignment.assignmentFingerprint, roles: plan.roles.slice(),
    scenarioIds: ids, repetitions, variants: VARIANTS.map(variant => variant.variantId),
    simulatorCommit: SIMULATOR_COMMIT, fingerprint: "" };
  context.fingerprint = fingerprintObject(context); const contextFile = path.join(output, "run-context.json");
  if (fs.existsSync(contextFile)) {
    const previous = JSON.parse(fs.readFileSync(contextFile, "utf8"));
    invariant(previous.fingerprint === context.fingerprint,
      "V1_V2_DIAGNOSTIC_RUN_CONTEXT_MISMATCH", previous.fingerprint);
  } else writeJsonAtomic(contextFile, context, { mode: 0o644 });
  const journal = path.join(output, "exact-matches.jsonl"); const resumed = loadJournal(journal,
    expectedIdSet); const byId = new Map(resumed.map(match => [match.matchId, match]));
  const simulator = await loadSimulator(root); let newExactMatches = 0;
  const factories = { v1: compileBotFactory(simulator.module, codes.v1,
    { timeoutMs: plan.timeoutMs, loadTimeoutMs: 2000 }),
  v2: compileBotFactory(simulator.module, codes.v2,
    { timeoutMs: plan.timeoutMs, loadTimeoutMs: 2000 }) };
  let processedExactMatches = 0;
  for (const scenario of scenarios) for (let repetition = 0; repetition < repetitions; repetition += 1)
    for (const variant of VARIANTS) {
      const matchId = `${scenario.matchUrlId}:${variant.variantId}:r${repetition}`;
      if (!byId.has(matchId)) {
        const match = await runExactMatch(simulator.module, scenario, variant, repetition, factories,
          plan.timeoutMs, plan.maxFrames); fs.appendFileSync(journal, `${JSON.stringify(match)}\n`);
        byId.set(matchId, match); newExactMatches += 1;
      }
      processedExactMatches += 1;
      if (typeof options.onProgress === "function") options.onProgress(processedExactMatches,
        expectedIds.length, scenario.matchUrlId, variant.variantId, newExactMatches);
    }
  const matches = expectedIds.map(id => byId.get(id));
  invariant(matches.every(Boolean), "V1_V2_DIAGNOSTIC_EXACT_MATCH_MISSING", plan.suiteId);
  const exact = { schemaVersion: 1, reportKind: "V1_V2_EXACT_SCRIPT_PAIRED_MATCHES",
    status: matches.length === expectedIds.length ? "COMPLETE" : "PARTIAL",
    candidate: { candidateId: frozen.manifest.candidateId,
      candidateFingerprint: frozen.manifest.fingerprint,
      v1Sha256: frozen.manifest.selection.v1Sha256, v2Sha256: frozen.manifest.build.minifiedSha256 },
    runContextFingerprint: context.fingerprint,
    simulator: { repository: "cyhhao/agentank-simulator", commit: SIMULATOR_COMMIT,
      archiveSha256: SIMULATOR_ARCHIVE_SHA256 }, summary: summarizeExact(matches, expectedIds.length),
    matches, fingerprint: "" };
  exact.fingerprint = fingerprintObject(exact); const exactFile = path.join(output, "exact-match-report.json");
  writeJsonAtomic(exactFile, exact, { mode: 0o644 });
  writeJsonImmutable(path.join(output, "history", `exact-${exact.fingerprint}.json`), exact,
    { mode: 0o644 });
  const selected = selectTraceCases(matches, maximumTraces); const scenarioById = new Map(
    scenarios.map(scenario => [scenario.matchUrlId, scenario])); const traceCases = [];
  for (let index = 0; index < selected.length; index += 1) {
    const selectedMatch = selected[index]; const variant = VARIANTS.find(item =>
      item.variantId === selectedMatch.variantId); const settings = v2Options(frozen.manifest.parameters);
    settings.captureAllFrames = true;
    const mirror = await runMatch(simulator.module, scenarioById.get(selectedMatch.historicalMatchUrlId),
      variant, selectedMatch.repetition, codes.v1, plan.timeoutMs, settings, { includeReplay: true });
    const analysis = analyzeTrace(selectedMatch, mirror, plan.traceWindowFrames);
    const trace = { schemaVersion: 1, reportKind: "V1_V2_INSTRUMENTED_FAILURE_TRACE",
      candidateId: frozen.manifest.candidateId, exactMatch: selectedMatch, mirror, analysis,
      fingerprint: "" };
    trace.fingerprint = fingerprintObject(trace); const token = sha256Text(selectedMatch.matchId).slice(0, 16);
    const traceFile = path.join(output, "traces", token, "trace-report.json");
    writeJsonAtomic(traceFile, trace, { mode: 0o644 });
    traceCases.push({ exactMatchId: selectedMatch.matchId,
      historicalMatchUrlId: selectedMatch.historicalMatchUrlId,
      variantId: selectedMatch.variantId, repetition: selectedMatch.repetition,
      traceRelativePath: slash(path.relative(root, traceFile)), traceSha256: sha256Bytes(
        fs.readFileSync(traceFile)), traceFingerprint: trace.fingerprint, analysis });
    if (typeof options.onTraceProgress === "function") options.onTraceProgress(index + 1,
      selected.length, selectedMatch.matchId);
  }
  const classificationCounts = {};
  for (const item of traceCases) for (const value of item.analysis.classifications)
    addCount(classificationCounts, value);
  const report = { schemaVersion: 1,
    reportKind: "V1_V2_EXACT_PAIRED_FAILURE_DIAGNOSTIC",
    status: ids.length === allIds.length ? "COMPLETE" : "PARTIAL", evidenceLane: "DISCOVERY",
    suite: { suiteId: plan.suiteId, relativePath: loaded.relativePath, sha256: loaded.sha256 },
    candidate: { candidateId: frozen.manifest.candidateId,
      candidateFingerprint: frozen.manifest.fingerprint,
      manifestRelativePath: frozen.relativePath, v1Sha256: frozen.manifest.selection.v1Sha256,
      v2Sha256: frozen.manifest.build.minifiedSha256 },
    corpus: { assignmentFingerprint: assignment.assignmentFingerprint, roles: plan.roles.slice(),
      availableScenarioCount: allIds.length, executedScenarioCount: ids.length },
    execution: { repetitions, variantsPerScenario: VARIANTS.length,
      expectedExactMatches: expectedIds.length, executedExactMatches: matches.length,
      resumedExactMatches: resumed.length, newExactMatches, traceCaseCount: traceCases.length },
    exact: { reportRelativePath: slash(path.relative(root, exactFile)),
      reportSha256: sha256Bytes(fs.readFileSync(exactFile)), reportFingerprint: exact.fingerprint,
      summary: exact.summary },
    failureAnalysis: { traceCases, classificationCounts,
      mirrorDivergenceCount: traceCases.filter(item => item.analysis.mirrorDiverged).length },
    evidenceBoundary: { officialRuleTruth: false, localRuntimeIsPlatformRuntime: false,
      futureCandidatePolicy: plan.futureCandidatePolicy,
      knownSimulatorDeviations: KNOWN_SIMULATOR_DEVIATIONS.slice() }, fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  validateSchemaObject("v1-v2-failure-diagnostic-report", report, root);
  const reportFile = path.join(output, "failure-diagnostic-report.json");
  writeJsonAtomic(reportFile, report, { mode: 0o644 });
  writeJsonImmutable(path.join(output, "history", `diagnostic-${report.fingerprint}.json`), report,
    { mode: 0o644 });
  return { report, exact, reportFile, output };
}

module.exports = { DEFAULT_PLAN, KNOWN_SIMULATOR_DEVIATIONS, readPlan, seedFor, resultFor,
  compileBotFactory,
  runExactMatch, outcome, pairedSummary, repetitionSummary, summarizeExact, frameBucket,
  selectTraceCases, crashFrame, turnReversals, causalThreat, analyzeTrace, loadJournal,
  runV1V2FailureDiagnostic };
