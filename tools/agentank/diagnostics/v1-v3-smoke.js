#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { defaultWorkspaceRoot } = require("../core/paths");
const { loadFrozenCandidate } = require("../candidate/imp8-g10a");
const { loadDd9Assignment, idsForRole } = require("../simulation/dd9-assignment");
const { scenariosForIds, createHistoricalStarProvider } =
  require("../simulation/historical-scenarios");
const { loadSimulator } = require("../simulation/paired-arena");
const { StructuredV1Controller, V2ContactAttackAdapter, V3DiagnosticBot } =
  require("../../../engine-v3/src");

function portableAction(action) {
  if (!action) return null;
  const value = { type: action.type || "none" };
  if (action.side) value.side = action.side;
  if (Number.isFinite(action.x)) value.x = action.x;
  if (Number.isFinite(action.y)) value.y = action.y;
  return value;
}

class DifferentialV1V3Bot {
  constructor(v1, v3) {
    this.v1 = v1;
    this.v3 = v3;
    this.compared = 0;
    this.divergences = 0;
    this.firstDivergence = null;
  }
  decide(context) {
    const expected = this.v1.decide(context);
    const actual = this.v3.decide(context);
    this.compared += 1;
    const left = portableAction(expected && expected.action);
    const right = portableAction(actual && actual.action);
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      this.divergences += 1;
      if (!this.firstDivergence) this.firstDivergence = {
        frame: context.game.frames, expected: left, actual: right };
    }
    return actual;
  }
  summary() { return { compared: this.compared, divergences: this.divergences,
    firstDivergence: this.firstDivergence }; }
}

function resultSummary(replay, labels, differential, adapterId) {
  const winner = replay.result && replay.result.winner;
  return { winnerSeat: winner === 0 || winner === 1 ? winner : null,
    winner: winner === 0 || winner === 1 ? labels[winner] : "DRAW",
    reason: replay.result && replay.result.reason || "UNKNOWN",
    frames: replay.replayData.replay.records.length, adapterId,
    differential: differential.summary(), v3: differential.v3.summary() };
}

async function play(simulatorModule, scenario, v1Code, v3Seat, useV2ContactRouter) {
  const star = createHistoricalStarProvider(scenario.stars);
  const simulator = new simulatorModule.AgenTankSimulator({ map: scenario.map,
    tanks: scenario.starts.map((tank, seat) => ({ ...tank, id: `v3-smoke-${seat}` })),
    skills: ["stun", "stun"], star: star.initialStar,
    starProvider: value => star.provider(value), seed: 0x56330000 + v3Seat,
    maxFrames: 64, starLimit: false });
  const v1 = simulatorModule.loadBotFromCode(v1Code, { timeoutMs: 200, loadTimeoutMs: 2000 });
  const shadowV1 = simulatorModule.loadBotFromCode(v1Code,
    { timeoutMs: 200, loadTimeoutMs: 2000 });
  const adapter = useV2ContactRouter ? new V2ContactAttackAdapter() : null;
  const controller = new StructuredV1Controller({ contextName: `v3-smoke-seat-${v3Seat}`,
    replacements: adapter ? [adapter] : [] });
  const v3 = new V3DiagnosticBot({ controller });
  const differential = new DifferentialV1V3Bot(shadowV1, v3);
  const bots = v3Seat === 0 ? [differential, v1] : [v1, differential];
  const labels = v3Seat === 0 ? ["V3", "V1"] : ["V1", "V3"];
  return resultSummary(simulator.run(bots[0], bots[1]), labels, differential,
    adapter ? adapter.id : "V1_PASS_THROUGH");
}

async function main() {
  const root = defaultWorkspaceRoot();
  const frozen = loadFrozenCandidate(root);
  const assignment = loadDd9Assignment(root);
  const scenarioId = idsForRole(assignment.assignment, "FROZEN_REGRESSION")[0];
  const scenario = scenariosForIds(assignment.manifest, [scenarioId], root)[0];
  const simulator = await loadSimulator(root);
  const v1Code = fs.readFileSync(frozen.v1File, "utf8");
  const useV2ContactRouter = process.argv.includes("--v2-contact-router");
  const matches = [await play(simulator.module, scenario, v1Code, 0, useV2ContactRouter),
    await play(simulator.module, scenario, v1Code, 1, useV2ContactRouter)];
  const divergences = matches.reduce((sum, match) => sum + match.differential.divergences, 0);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1,
    objectKind: "V1_V3_STRUCTURAL_SMOKE", scenarioId,
    scenarioFingerprint: scenario.fingerprint, v1Sha256: frozen.manifest.selection.v1Sha256,
    useV2ContactRouter, divergences, matches }, null, 2)}\n`);
  if (divergences > 0) process.exitCode = 2;
}

main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
