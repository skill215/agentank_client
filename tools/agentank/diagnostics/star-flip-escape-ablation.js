#!/usr/bin/env node
"use strict";

// Discovery probe: star-flip WIN→LOSS scenarios under Escape Quality / demote ablations.
// Not a production gate. Writes one content-addressed report under artifacts/diagnostics.

const fs = require("node:fs");
const path = require("node:path");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");
const { loadRollingV1Scenarios } = require("../simulation/historical-scenarios");
const { loadSimulator, runMatch, VARIANTS } = require("../simulation/paired-arena");
const { fingerprintObject } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic } = require("../core/atomic-file");

const ROOT = path.resolve(__dirname, "../../..");
const ARENA = path.join(ROOT, "artifacts/diagnostics/v1-v2-working",
  "0ed5c5b27938bf3e-r2-discovery-calibration-frozen-p080aa18a0f3f-rolling-f8b22c94");
const BASELINE = path.join(ROOT,
  "artifacts/diagnostics/v1-v2/imp8-v2-a5ce6f8ef59abb61",
  "v1_v2_exact_paired_failure_diagnostic_v1/exact-match-report.json");

const MODES = [
  { id: "current", diagnosticDisableEscapeQuality: 0, diagnosticDisableGoDemote: 0,
    diagnosticDisableSoftEscape: 0, diagnosticDisableEscapeObligation: 0 },
  { id: "noQuality", diagnosticDisableEscapeQuality: 1, diagnosticDisableGoDemote: 0,
    diagnosticDisableSoftEscape: 0, diagnosticDisableEscapeObligation: 0 },
  { id: "noEscapeObligation", diagnosticDisableEscapeQuality: 0, diagnosticDisableGoDemote: 0,
    diagnosticDisableSoftEscape: 0, diagnosticDisableEscapeObligation: 1 }
];

function starFlipHistIds(limit) {
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  const cur = [];
  for (const role of ["discovery", "calibration", "frozen_regression"]) {
    const report = JSON.parse(fs.readFileSync(
      path.join(ARENA, role, "paired-arena-report.json"), "utf8"));
    cur.push(...report.matches);
  }
  const curMap = new Map(cur.map(match => [match.matchId, match]));
  const ids = [];
  const seen = new Set();
  for (const before of base.matches) {
    const after = curMap.get(before.matchId);
    if (!after) continue;
    if (before.result.winnerImplementation !== "v2" ||
        after.result.winnerImplementation !== "v1") continue;
    if (after.result.reason !== "frameLimit") continue;
    const seat = after.v2Seat;
    const bLead = before.counts.stars[seat] - before.counts.stars[1 - seat];
    const cLead = after.counts.stars[seat] - after.counts.stars[1 - seat];
    if (!(bLead > 0 && cLead <= 0)) continue;
    if (seen.has(after.historicalMatchUrlId)) continue;
    seen.add(after.historicalMatchUrlId);
    ids.push(after.historicalMatchUrlId);
    if (ids.length >= limit) break;
  }
  return ids;
}

function summarize(matches) {
  let wins = 0, losses = 0, flWins = 0, flLosses = 0, v2Stars = 0, v1Stars = 0;
  let go = 0, turn = 0, fire = 0;
  for (const match of matches) {
    if (match.result.winnerImplementation === "v2") wins += 1; else losses += 1;
    if (match.result.reason === "frameLimit") {
      if (match.result.winnerImplementation === "v2") flWins += 1; else flLosses += 1;
    }
    const seat = match.v2Seat;
    v2Stars += match.counts.stars[seat];
    v1Stars += match.counts.stars[1 - seat];
    const ac = match.v2.actionCounts;
    go += ac.GO || 0; turn += (ac.TURN_LEFT || 0) + (ac.TURN_RIGHT || 0);
    fire += ac.FIRE || 0;
  }
  const n = matches.length || 1;
  return {
    matches: matches.length, wins, losses, winRatePer10000: Math.round(wins / n * 10000),
    frameLimitWins: flWins, frameLimitLosses: flLosses,
    meanV2StarsPer1000: Math.round(v2Stars / n * 1000),
    meanV1StarsPer1000: Math.round(v1Stars / n * 1000),
    meanStarLeadPer1000: Math.round((v2Stars - v1Stars) / n * 1000),
    turnSharePer10000: Math.round(turn / Math.max(1, go + turn) * 10000),
    meanFirePer100: Math.round(fire / n * 100)
  };
}

async function runMode(mode, scenarios, frozen, simulator, timeoutMs) {
  const base = v2Options(frozen.manifest.parameters);
  const v2 = {
    ...base,
    engine: {
      ...base.engine,
      diagnosticDisableEscapeQuality: mode.diagnosticDisableEscapeQuality,
      diagnosticDisableGoDemote: mode.diagnosticDisableGoDemote,
      diagnosticDisableSoftEscape: mode.diagnosticDisableSoftEscape,
      diagnosticDisableEscapeObligation: mode.diagnosticDisableEscapeObligation
    }
  };
  const v1Code = fs.readFileSync(frozen.v1File, "utf8");
  const matches = [];
  for (const scenario of scenarios) {
    for (const variant of VARIANTS) {
      matches.push(await runMatch(simulator.module, scenario, variant, 0, v1Code,
        timeoutMs, v2, { captureActions: false }));
    }
  }
  return { mode: mode.id, flags: mode, summary: summarize(matches) };
}

async function main() {
  const limit = Math.max(8, Math.min(48, Number(process.argv[2]) || 24));
  const timeoutMs = 200;
  const ids = starFlipHistIds(limit);
  const rolling = loadRollingV1Scenarios(ROOT);
  const byId = new Map(rolling.scenarios.map(scenario => [scenario.matchUrlId, scenario]));
  const scenarios = ids.map(id => {
    const scenario = byId.get(id);
    if (!scenario) throw new Error(`STAR_FLIP_SCENARIO_MISSING:${id}`);
    return scenario;
  });
  const frozen = loadFrozenCandidate(ROOT);
  const simulator = await loadSimulator(ROOT);
  console.error(`[probe] scenarios=${scenarios.length} matchesPerMode=${scenarios.length * 4}`);
  const started = Date.now();
  const results = [];
  for (const mode of MODES) {
    const t0 = Date.now();
    const result = await runMode(mode, scenarios, frozen, simulator, timeoutMs);
    results.push(result);
    console.error(`[probe] ${mode.id} wins=${result.summary.wins}/${result.summary.matches} ` +
      `starLeadPer1000=${result.summary.meanStarLeadPer1000} ` +
      `turnShare=${result.summary.turnSharePer10000} ms=${Date.now() - t0}`);
  }
  const report = {
    artifactKind: "STAR_FLIP_ESCAPE_ABLATION_PROBE",
    status: "COMPLETED",
    properties: ["DISCOVERY_ONLY", "NOT_A_GATE", "STAR_FLIP_SAMPLE"],
    sample: { historicalMatchUrlIds: ids, scenarioCount: scenarios.length,
      variantsPerScenario: 4, repetitions: 1 },
    baseline: "imp8 exact-match locked WIN→LOSS frameLimit star-flip",
    results,
    elapsedMs: Date.now() - started
  };
  report.fingerprint = fingerprintObject(report);
  const outDir = path.join(ROOT, "artifacts/diagnostics/star-flip-escape-ablation");
  ensureDirectory(outDir);
  const file = path.join(outDir, "latest.json");
  writeJsonAtomic(file, report, { mode: 0o644 });
  writeJsonAtomic(path.join(outDir, `${report.fingerprint}.json`), report, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify({
    status: report.status, scenarios: scenarios.length, fingerprint: report.fingerprint,
    results: results.map(item => ({ mode: item.mode, ...item.summary })), file
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
