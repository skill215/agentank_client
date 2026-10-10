#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { createHistoricalStarProvider } = require("../simulation/historical-scenarios");
const { loadSimulator, DecisionAudit, collectCounts } = require("../simulation/paired-arena");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");
const { V3DiagnosticBot } = require("../../../engine-v3/src");
const repairCohort = require("./v3-repair-cohort");
const transplantCohort = require("./v2-component-transplant-cohort");
const { seedFor } = require("./v1-v3-arena");

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function loadSelectedCohort(root, file, role) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.objectKind === repairCohort.KIND)
    return repairCohort.load(root, file, role);
  if (manifest.objectKind === transplantCohort.COHORT_KIND)
    return transplantCohort.loadBlindCohort(root, file, role);
  throw new Error(`CTR_V2_V3_COHORT_KIND:${manifest.objectKind}`);
}

function classify(match) {
  const mapped = {
    ...match,
    seatImplementations: match.seatImplementations.map(value =>
      value === "V2_BASE" ? "v2" : "v1"),
    result: {
      ...match.result,
      winnerImplementation: match.result.winnerImplementation === "V2_BASE" ? "v2" :
        match.result.winnerImplementation === "V3_BASE" ? "v1" : "draw"
    }
  };
  const value = classifyAnalysisOutcome(mapped);
  return {
    outcome: value.analysisOutcome === "V2_WIN" ? "V2_BASE_WIN" :
      value.analysisOutcome === "V1_WIN" ? "V3_BASE_WIN" : "DRAW",
    terminalCategory: value.terminalCategory
  };
}

async function play(module, scenario, v2Code, v2Seat) {
  const star = createHistoricalStarProvider(scenario.stars);
  const simulator = new module.AgenTankSimulator({
    map: scenario.map,
    tanks: scenario.starts.map((tank, seat) => ({ ...tank, id: `ctr-v2-v3-${seat}` })),
    skills: ["stun", "stun"],
    star: star.initialStar,
    starProvider: value => star.provider(value),
    seed: seedFor(scenario),
    maxFrames: 128,
    starLimit: false
  });
  const v2 = new DecisionAudit(module.loadBotFromCode(v2Code,
    { timeoutMs: 500, loadTimeoutMs: 2000 }), { captureCompactFrames: true });
  const v3 = new DecisionAudit(new V3DiagnosticBot(),
    { captureCompactFrames: true });
  const bots = v2Seat === 0 ? [v2, v3] : [v3, v2];
  const replay = simulator.run(bots[0], bots[1]);
  const winnerSeat = replay.result?.winner;
  const result = {
    winnerSeat: winnerSeat === 0 || winnerSeat === 1 ? winnerSeat : null,
    winnerImplementation: winnerSeat === v2Seat ? "V2_BASE" :
      winnerSeat === (v2Seat ^ 1) ? "V3_BASE" : "DRAW",
    reason: replay.result?.reason || "UNKNOWN"
  };
  const match = {
    matchId: `${scenario.matchUrlId}:V2_BASE_SEAT_${v2Seat}`,
    historicalMatchUrlId: scenario.matchUrlId,
    scenarioFingerprint: scenario.fingerprint,
    v2Seat,
    comparison: {
      kind: "REAL_V2_VS_V3_BASE",
      challengerImplementation: "V2_BASE",
      controlImplementation: "V3_BASE"
    },
    seatImplementations: v2Seat === 0 ? ["V2_BASE", "V3_BASE"] :
      ["V3_BASE", "V2_BASE"],
    seatSkills: ["stun", "stun"],
    frames: replay.replayData.replay.records.length,
    result,
    counts: collectCounts(replay, v2Seat),
    v2: v2.summary(),
    v3: v3.summary()
  };
  const analysis = classify(match);
  match.analysisOutcome = analysis.outcome;
  match.terminalCategory = analysis.terminalCategory;
  return match;
}

function add(target, source) {
  for (const [key, value] of Object.entries(source || {}))
    target[key] = (target[key] || 0) + value;
}

function summarize(matches, elapsedMs) {
  const output = {
    identities: { challenger: "V2_BASE", control: "V3_BASE" },
    matches: matches.length,
    scenarios: matches.length / 2,
    analysis: { v2Wins: 0, v3Wins: 0, draws: 0,
      scoreBasisPoints: 0, scorePercent: "0.00" },
    pairs: { v2Sweep: 0, v3Sweep: 0, split: 0, drawAffected: 0 },
    stars: { v2: 0, v3: 0 },
    crashes: { v2: 0, v3: 0 },
    projectiles: { v2: 0, v3: 0 },
    actions: { v2: {}, v3: {} },
    runtime: { elapsedMs, v2TotalMicros: 0, v3TotalMicros: 0 },
    timeoutError: { v2: 0, v3: 0 }
  };
  let units = 0;
  for (const match of matches) {
    if (match.analysisOutcome === "V2_BASE_WIN") {
      output.analysis.v2Wins += 1;
      units += 2;
    } else if (match.analysisOutcome === "V3_BASE_WIN") {
      output.analysis.v3Wins += 1;
    } else {
      output.analysis.draws += 1;
      units += 1;
    }
    const other = match.v2Seat ^ 1;
    output.stars.v2 += match.counts.stars[match.v2Seat];
    output.stars.v3 += match.counts.stars[other];
    output.crashes.v2 += match.counts.crashes[match.v2Seat];
    output.crashes.v3 += match.counts.crashes[other];
    output.projectiles.v2 += match.counts.bullets[match.v2Seat];
    output.projectiles.v3 += match.counts.bullets[other];
    add(output.actions.v2, match.v2.actionCounts);
    add(output.actions.v3, match.v3.actionCounts);
    output.runtime.v2TotalMicros += match.v2.totalRuntimeMicros;
    output.runtime.v3TotalMicros += match.v3.totalRuntimeMicros;
    output.timeoutError.v2 += match.v2.timeoutCount + match.v2.errorCount;
    output.timeoutError.v3 += match.v3.timeoutCount + match.v3.errorCount;
  }
  output.analysis.scoreBasisPoints = Math.round(units * 5000 / Math.max(1, matches.length));
  output.analysis.scorePercent = (output.analysis.scoreBasisPoints / 100).toFixed(2);
  for (let at = 0; at < matches.length; at += 2) {
    const pair = [matches[at].analysisOutcome, matches[at + 1].analysisOutcome];
    if (pair.every(value => value === "V2_BASE_WIN")) output.pairs.v2Sweep += 1;
    else if (pair.every(value => value === "V3_BASE_WIN")) output.pairs.v3Sweep += 1;
    else if (pair.includes("DRAW")) output.pairs.drawAffected += 1;
    else output.pairs.split += 1;
  }
  return output;
}

async function run(root) {
  const identityFile = path.join(root, "config", "engine-v3",
    "v2-component-transplant-identity.json");
  const identity = JSON.parse(fs.readFileSync(identityFile, "utf8"));
  const v2File = path.join(root, identity.implementations.V2_BASE.minifiedRelativePath);
  const v2Bytes = fs.readFileSync(v2File);
  if (sha256Bytes(v2Bytes) !== identity.implementations.V2_BASE.minifiedSha256)
    throw new Error("CTR_V2_BASE_HASH_DRIFT");
  const cohortFile = path.resolve(option("--cohort",
    path.join(root, "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const selected = loadSelectedCohort(root, cohortFile, role);
  const output = path.resolve(option("--output", path.join(root, "artifacts",
    "v2-component-transplant", `v2-base-vs-v3-${role.toLowerCase()}-${
      selected.manifest.fingerprint.slice(0, 12)}`)));
  const simulator = await loadSimulator(root);
  const matches = [];
  const started = Date.now();
  for (let index = 0; index < selected.scenarios.length; index += 1) {
    const scenario = selected.scenarios[index];
    matches.push(await play(simulator.module, scenario, v2Bytes.toString("utf8"), 0));
    matches.push(await play(simulator.module, scenario, v2Bytes.toString("utf8"), 1));
    if ((index + 1) % 8 === 0 || index + 1 === selected.scenarios.length)
      process.stderr.write(`[ctr-v2-v3] ${index + 1}/${selected.scenarios.length}\n`);
  }
  const overview = summarize(matches, Date.now() - started);
  fs.mkdirSync(output, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    objectKind: "V2_COMPONENT_TRANSPLANT_REAL_V2_ARENA_V1",
    comparison: { challengerImplementation: "V2_BASE",
      controlImplementation: "V3_BASE" },
    v2MinifiedSha256: identity.implementations.V2_BASE.minifiedSha256,
    cohortFingerprint: selected.manifest.fingerprint,
    role,
    scenarioCount: selected.scenarios.length,
    matchCount: matches.length,
    fingerprint: ""
  };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "overview.json"), `${JSON.stringify(overview, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "matches.ndjson.gz"), zlib.gzipSync(Buffer.from(
    `${matches.map(item => JSON.stringify(item)).join("\n")}\n`), { level: 9 }));
  fs.writeFileSync(path.join(output, "diagnostic-samples.ndjson.gz"),
    zlib.gzipSync(Buffer.from(""), { level: 9 }));
  process.stdout.write(`${JSON.stringify({ output, overview }, null, 2)}\n`);
  return { output, overview };
}

if (require.main === module)
  run(defaultWorkspaceRoot()).catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });

module.exports = { loadSelectedCohort, classify, play, summarize, run };
