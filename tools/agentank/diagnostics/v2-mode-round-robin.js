"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { writeFileAtomic, writeJsonAtomic } = require("../core/atomic-file");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");
const { loadRollingV1Scenarios, loadRollingV1ScenariosForIds, createHistoricalStarProvider } =
  require("../simulation/historical-scenarios");
const { loadSimulator, collectCounts } = require("../simulation/paired-arena");
const { ProductionDiagnosticBot } = require("../simulation/production-diagnostic-bot");
const { loadFixedScenarioIndex } = require("./soft-stack-ablation");
const { selectScenarios } = require("./strategy-priority-sample");
const { sourceIdentity } = require("./v1-v2-working-arena");
const { STRATEGY_PRIORITY_MODE } = require("./strategy-priority-runtime");

const MODES = Object.freeze({
  CURRENT: STRATEGY_PRIORITY_MODE.CURRENT,
  BAND_OFF: STRATEGY_PRIORITY_MODE.BAND_OFF,
  PVA: STRATEGY_PRIORITY_MODE.PVA_CONTROLLER
});

const CYCLE = Object.freeze([
  Object.freeze({ pairId: "CURRENT_VS_BAND_OFF", left: MODES.CURRENT, right: MODES.BAND_OFF }),
  Object.freeze({ pairId: "BAND_OFF_VS_PVA", left: MODES.BAND_OFF, right: MODES.PVA }),
  Object.freeze({ pairId: "PVA_VS_CURRENT", left: MODES.PVA, right: MODES.CURRENT })
]);
const STORAGE_BUDGET = 16 * 1024 * 1024;

function scheduleForCycle(cycle = CYCLE) {
  const schedule = [];
  for (const edge of cycle) {
    schedule.push(Object.freeze({ ...edge, leg: "FORWARD", seatModes: [edge.left, edge.right] }));
    schedule.push(Object.freeze({ ...edge, leg: "REVERSE", seatModes: [edge.right, edge.left] }));
  }
  return Object.freeze(schedule);
}

function classifyModeOutcome(rawResult, counts, seatModes) {
  const stars = counts.stars || [0, 0];
  const crashes = counts.crashes || [0, 0];
  const mutualCrash = crashes[0] > 0 && crashes[1] > 0;
  let winnerSeat = null; let terminalCategory;
  if (rawResult?.reason === "frameLimit") {
    winnerSeat = stars[0] === stars[1] ? null : stars[0] > stars[1] ? 0 : 1;
    terminalCategory = winnerSeat == null ? "FRAME_LIMIT_EQUAL_STARS" : "FRAME_LIMIT_STARS";
  } else if (mutualCrash) {
    winnerSeat = stars[0] === stars[1] ? null : stars[0] > stars[1] ? 0 : 1;
    terminalCategory = winnerSeat == null ? "MUTUAL_CRASH_EQUAL_STARS" : "MUTUAL_CRASH_STARS";
  } else if (crashes[0] > 0 || crashes[1] > 0) {
    winnerSeat = crashes[0] > 0 ? 1 : 0;
    terminalCategory = "SINGLE_CRASH";
  } else {
    winnerSeat = rawResult?.winner === 0 || rawResult?.winner === 1 ? rawResult.winner : null;
    terminalCategory = winnerSeat == null ? "RAW_DRAW" : "RAW_FALLBACK";
  }
  return Object.freeze({ winnerSeat, winnerMode: winnerSeat == null ? "DRAW" : seatModes[winnerSeat],
    terminalCategory, stars: Object.freeze(stars.slice()), crashes: Object.freeze(crashes.slice()),
    rawWinnerSeat: rawResult?.winner === 0 || rawResult?.winner === 1 ? rawResult.winner : null,
    rawReason: rawResult?.reason || "UNKNOWN" });
}

function botOptions(parameters, mode) {
  const options = v2Options(parameters);
  options.engine.diagnosticStrategyMode = mode;
  options.captureExceptionalFrames = false;
  return options;
}

function invariantSummary(summary) {
  return {
    avoidableHardRejects: summary.layerTotals.avoidableHardRejects,
    riskDominatedSelections: summary.layerTotals.riskDominatedSelections,
    rootRestoreFailures: summary.layerTotals.depthRootRestoreFailures,
    hotAllocations: summary.layerTotals.hotAllocations
  };
}

function gzipNdjson(records) {
  const text = records.length ? `${records.map(value => JSON.stringify(value)).join("\n")}\n` : "";
  return zlib.gzipSync(Buffer.from(text), { level: 9, mtime: 0 });
}

function seedFor(scenario, repetition) {
  return Number.parseInt(sha256Text(`${scenario.fingerprint}\0${repetition}`).slice(0, 8), 16) >>> 0;
}

async function runLeg(simulatorModule, scenario, scheduled, repetition, parameters, timeoutMs) {
  const star = createHistoricalStarProvider(scenario.stars);
  const simulator = new simulatorModule.AgenTankSimulator({ map: scenario.map,
    tanks: scenario.starts.map((tank, seat) => ({ ...tank, id: `tank-${seat}` })),
    skills: ["poison", "poison"], star: star.initialStar,
    starProvider: value => star.provider(value), seed: seedFor(scenario, repetition),
    maxFrames: 128, starLimit: false });
  const bots = scheduled.seatModes.map(mode => new ProductionDiagnosticBot(
    botOptions(parameters, mode)));
  const replay = simulator.run(bots[0], bots[1], { timeoutMs });
  const counts = collectCounts(replay, 0);
  const summaries = bots.map(bot => bot.summary());
  const outcome = classifyModeOutcome(replay.result, counts, scheduled.seatModes);
  return {
    schemaVersion: 1,
    objectKind: "V2ModeRoundRobinMatchV1",
    matchId: `${scenario.matchUrlId}:${scheduled.pairId}:${scheduled.leg}:r${repetition}`,
    historicalMatchUrlId: scenario.matchUrlId,
    scenarioFingerprint: scenario.fingerprint,
    pairId: scheduled.pairId,
    leg: scheduled.leg,
    repetition,
    seatModes: scheduled.seatModes.slice(),
    seatSkills: ["poison", "poison"],
    frames: replay.replayData.replay.records.length,
    outcome,
    counts: { stars: counts.stars, crashes: counts.crashes, bullets: counts.bullets,
      bombs: counts.bombs, skills: counts.skills },
    seats: summaries.map((summary, seat) => ({ seat, mode: scheduled.seatModes[seat],
      decisions: summary.decisionCount, runtimeMicros: summary.totalRuntimeMicros,
      p95RuntimeMicros: summary.p95RuntimeMicros, actionCounts: summary.actionCounts,
      invariants: invariantSummary(summary),
      proposalVerification: summary.strategyPriority.proposalVerification }))
  };
}

function add(target, key, amount = 1) { target[key] = (target[key] || 0) + amount; }

function summarize(matches) {
  const standings = {};
  const pairs = {};
  const terminalCategories = {}; const seatResults = { seat0Wins: 0, seat1Wins: 0, draws: 0 };
  let totalFrames = 0; let fullLengthMatches = 0;
  for (const match of matches) {
    const edge = CYCLE.find(value => value.pairId === match.pairId) ||
      { pairId: match.pairId, left: match.seatModes[0], right: match.seatModes[1] };
    const pair = pairs[match.pairId] || (pairs[match.pairId] = { matches: 0,
      pairId: edge.pairId, left: edge.left, right: edge.right, wins: {}, draws: 0, points2: {},
      stars: {}, crashes: {}, fire: {}, runtimeMicros: {} });
    pair.matches += 1;
    totalFrames += Number(match.frames) || 0; if (match.frames >= 128) fullLengthMatches += 1;
    add(terminalCategories, match.outcome.terminalCategory || "UNKNOWN");
    if (match.outcome.winnerMode === "DRAW") {
      pair.draws += 1; seatResults.draws += 1;
      add(pair.points2, edge.left); add(pair.points2, edge.right);
    } else {
      add(pair.wins, match.outcome.winnerMode); add(pair.points2, match.outcome.winnerMode, 2);
      if (match.outcome.winnerSeat === 0) seatResults.seat0Wins += 1;
      else seatResults.seat1Wins += 1;
    }
    for (let seat = 0; seat < 2; seat += 1) {
      const mode = match.seatModes[seat];
      const table = standings[mode] || (standings[mode] = { matches: 0, wins: 0, losses: 0,
        draws: 0, points2: 0, stars: 0, crashes: 0, fire: 0, runtimeMicros: 0,
        invariantFailures: 0 });
      table.matches += 1;
      if (match.outcome.winnerMode === "DRAW") { table.draws += 1; table.points2 += 1; }
      else if (match.outcome.winnerMode === mode) { table.wins += 1; table.points2 += 2; }
      else table.losses += 1;
      table.stars += match.counts.stars[seat]; table.crashes += match.counts.crashes[seat];
      table.fire += match.seats[seat].actionCounts.FIRE || 0;
      table.runtimeMicros += match.seats[seat].runtimeMicros;
      table.invariantFailures += Object.values(match.seats[seat].invariants)
        .reduce((sum, value) => sum + value, 0);
      add(pair.stars, mode, match.counts.stars[seat]);
      add(pair.crashes, mode, match.counts.crashes[seat]);
      add(pair.fire, mode, match.seats[seat].actionCounts.FIRE || 0);
      add(pair.runtimeMicros, mode, match.seats[seat].runtimeMicros);
    }
  }
  const grouped = new Map();
  for (const match of matches) {
    const key = `${match.pairId}\0${match.historicalMatchUrlId}\0${match.repetition}`;
    const group = grouped.get(key) || []; group.push(match); grouped.set(key, group);
  }
  for (const pair of Object.values(pairs)) {
    pair.scoreRatePer10000 = {
      [pair.left]: Math.floor((pair.points2[pair.left] || 0) * 10000 / (2 * pair.matches)),
      [pair.right]: Math.floor((pair.points2[pair.right] || 0) * 10000 / (2 * pair.matches))
    };
    const categories = { LEFT_SWEEP: 0, RIGHT_SWEEP: 0, SPLIT: 0,
      LEFT_WIN_DRAW: 0, RIGHT_WIN_DRAW: 0, DOUBLE_DRAW: 0, INCOMPLETE: 0 };
    const differentials = []; const scenarioDifferentials = new Map();
    for (const [key, group] of grouped) {
      if (!key.startsWith(`${pair.pairId}\0`)) continue;
      if (group.length !== 2) { categories.INCOMPLETE += 1; continue; }
      let leftWins = 0; let rightWins = 0; let draws = 0; let differential2 = 0;
      for (const match of group) {
        if (match.outcome.winnerMode === pair.left) { leftWins += 1; differential2 += 2; }
        else if (match.outcome.winnerMode === pair.right) { rightWins += 1; differential2 -= 2; }
        else draws += 1;
      }
      const differential = differential2 / 4; differentials.push(differential);
      const scenarioId = group[0].historicalMatchUrlId;
      const bucket = scenarioDifferentials.get(scenarioId) || [];
      bucket.push(differential); scenarioDifferentials.set(scenarioId, bucket);
      if (leftWins === 2) categories.LEFT_SWEEP += 1;
      else if (rightWins === 2) categories.RIGHT_SWEEP += 1;
      else if (leftWins === 1 && rightWins === 1) categories.SPLIT += 1;
      else if (leftWins === 1 && draws === 1) categories.LEFT_WIN_DRAW += 1;
      else if (rightWins === 1 && draws === 1) categories.RIGHT_WIN_DRAW += 1;
      else categories.DOUBLE_DRAW += 1;
    }
    const independent = [...scenarioDifferentials.values()].map(values =>
      values.reduce((sum, value) => sum + value, 0) / values.length);
    const count = independent.length;
    const mean = count ? independent.reduce((sum, value) => sum + value, 0) / count : 0;
    const variance = count > 1 ? independent.reduce((sum, value) =>
      sum + (value - mean) ** 2, 0) / (count - 1) : 0;
    const margin = count > 1 ? 1.96 * Math.sqrt(variance / count) : 0;
    pair.pairedCycles = { count: differentials.length, independentScenarioCount: count, categories,
      scoreDeltaPer10000: Math.round(mean * 10000),
      ci95LowPer10000: Math.round((mean - margin) * 10000),
      ci95HighPer10000: Math.round((mean + margin) * 10000) };
  }
  return { matches: matches.length, totalFrames,
    averageFrames: matches.length ? Math.floor(totalFrames / matches.length) : 0,
    fullLengthMatches, fullLengthRatePer10000: matches.length ?
      Math.floor(fullLengthMatches * 10000 / matches.length) : 0,
    terminalCategories, seatResults, standings, pairs };
}

async function runRoundRobin(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const scenarioOffset = Math.max(0, Math.floor(Number(options.scenarioOffset) || 0));
  const pool = options.pool === "rolling-all" ? "ROLLING_ALL" :
    options.pool === "fixed-all" ? "FIXED_ALL" : "DISCOVERY";
  const repetitionStart = Math.max(0, Math.floor(Number(options.repetition) || 0));
  const repetitions = Math.max(1, Math.floor(Number(options.repetitions) || 1));
  const fixed = loadFixedScenarioIndex(root); let selected; let rolling; let scenarioCount;
  if (pool === "ROLLING_ALL") {
    const all = loadRollingV1Scenarios(root);
    const available = Math.max(0, all.scenarios.length - scenarioOffset);
    scenarioCount = Math.max(1, Math.floor(Number(options.scenarioCount) || available));
    const scenarios = all.scenarios.slice(scenarioOffset, scenarioOffset + scenarioCount);
    invariant(scenarios.length === scenarioCount, "V2_ROUND_ROBIN_ROLLING_DENOMINATOR",
      `${scenarios.length}:${scenarioCount}`);
    selected = { ids: scenarios.map(value => value.matchUrlId), entries: scenarios.map(value => ({
      id: value.matchUrlId, fingerprint: value.fingerprint })) };
    rolling = { scenarios, sourceIndex: all.snapshot.sourceIndex };
  } else if (pool === "FIXED_ALL") {
    const available = Math.max(0, fixed.scenarios.length - scenarioOffset);
    scenarioCount = Math.max(1, Math.floor(Number(options.scenarioCount) || available));
    const entries = fixed.scenarios.slice(scenarioOffset, scenarioOffset + scenarioCount);
    invariant(entries.length === scenarioCount, "V2_ROUND_ROBIN_FIXED_DENOMINATOR",
      `${entries.length}:${scenarioCount}`);
    selected = { ids: entries.map(value => value.id), entries: entries.map(value => ({
      id: value.id, fingerprint: value.fingerprint })) };
    rolling = loadRollingV1ScenariosForIds(selected.ids, root);
  } else {
    scenarioCount = Math.max(1, Math.floor(Number(options.scenarioCount) || 1));
    selected = selectScenarios(fixed, { scenarioCount, scenarioOffset,
      sampleSalt: options.sampleSalt });
    rolling = loadRollingV1ScenariosForIds(selected.ids, root);
  }
  const frozen = loadFrozenCandidate(root, options.candidateManifest);
  const simulator = await loadSimulator(root); const before = sourceIdentity(root);
  const schedule = scheduleForCycle(); const matches = [];
  const total = scenarioCount * repetitions * schedule.length;
  for (const scenario of rolling.scenarios)
    for (let repetition = repetitionStart; repetition < repetitionStart + repetitions;
      repetition += 1)
      for (const scheduled of schedule) {
        matches.push(await runLeg(simulator.module, scenario, scheduled, repetition,
          frozen.manifest.parameters, Math.max(20, Number(options.timeoutMs) || 200)));
        if (typeof options.onProgress === "function" &&
            (matches.length % Math.max(1, options.progressEvery || 32) === 0 ||
             matches.length === total))
          options.onProgress({ pairId: scheduled.pairId, leg: scheduled.leg,
            scenario: scenario.matchUrlId, completed: matches.length, total });
      }
  const after = sourceIdentity(root);
  invariant(before.sha256 === after.sha256, "V2_ROUND_ROBIN_SOURCE_CHANGED", before.sha256);
  const matchFingerprint = fingerprintObject({ matches });
  const overview = { schemaVersion: 1, objectKind: "V2ModeRoundRobinOverviewV1",
    status: "COMPLETE", sample: { pool, scenarioCount, scenarioOffset,
      repetitionStart, repetitions,
      scenarioIds: selected.ids, scenarioFingerprint: fingerprintObject({
        scenarios: selected.entries }),
      expectedMatches: total },
    rules: { cycle: CYCLE, twoLegs: true, bothSkills: "poison",
      maxFrames: 128, runtimeIndependentOutcome: true }, source: before,
    matchFingerprint, summary: summarize(matches), fingerprint: "" };
  overview.fingerprint = fingerprintObject(overview);
  const runId = fingerprintObject({ source: before.sha256, sample: overview.sample,
    rules: overview.rules });
  const output = path.resolve(options.output || contained(root, "artifacts", "diagnostics",
    "v2-mode-round-robin", `rr-${runId.slice(0, 16)}`));
  invariant(!fs.existsSync(output) || fs.readdirSync(output).length === 0,
    "V2_ROUND_ROBIN_OUTPUT_NOT_EMPTY", output);
  const matchBytes = gzipNdjson(matches);
  writeFileAtomic(path.join(output, "matches.ndjson.gz"), matchBytes, { mode: 0o644 });
  writeJsonAtomic(path.join(output, "overview.json"), overview, { mode: 0o644 });
  const overviewBytes = fs.readFileSync(path.join(output, "overview.json"));
  const manifest = { schemaVersion: 1, objectKind: "V2ModeRoundRobinManifestV1",
    status: overview.status, files: {
      overview: { size: overviewBytes.length, sha256: sha256Bytes(overviewBytes) },
      matches: { records: matches.length, size: matchBytes.length, sha256: sha256Bytes(matchBytes) }
    }, totalBytes: overviewBytes.length + matchBytes.length, storageBudgetBytes: STORAGE_BUDGET,
    fingerprint: "" };
  invariant(manifest.totalBytes <= STORAGE_BUDGET, "V2_ROUND_ROBIN_STORAGE_BUDGET",
    String(manifest.totalBytes));
  manifest.fingerprint = fingerprintObject(manifest);
  writeJsonAtomic(path.join(output, "manifest.json"), manifest, { mode: 0o644 });
  return { output, overview, manifest };
}

module.exports = { MODES, CYCLE, STORAGE_BUDGET, scheduleForCycle, classifyModeOutcome,
  gzipNdjson, summarize, runRoundRobin };
