#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { ProductionRootEngine } = require("../../../engine-v2/src/runtime/production-root");
const { ProductionDepthSearch } = require("../../../engine-v2/src/search/production-depth-search");
const { ProductionCacheBank } = require("../../../engine-v2/src/cache/production-cache");
const { RUNTIME_CONFIG } = require("../../../engine-v2/src/generated/runtime-config");
const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { productionRootFixture } = require("../build/imp6-builder");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { sourceIdentity } = require("../diagnostics/v1-v2-working-arena");

const DEFAULT_SCENARIOS = 96;
const DEFAULT_BATCHES = 5;
const PROFILES = Object.freeze([
  Object.freeze({ id: "legacy-250", kind: "legacy", budget: 250 }),
  Object.freeze({ id: "adaptive-d2-w2-250", kind: "adaptive", depth: 2, width: 2,
    budget: 250 }),
  Object.freeze({ id: "direct-d2-w2-250", kind: "direct", depth: 2, width: 2, budget: 250 }),
  Object.freeze({ id: "direct-d2-w3-250", kind: "direct", depth: 2, width: 3, budget: 250 }),
  Object.freeze({ id: "direct-d2-w4-250", kind: "direct", depth: 2, width: 4, budget: 250 }),
  Object.freeze({ id: "direct-d2-w4-312", kind: "direct", depth: 2, width: 4, budget: 312 })
]);

function percentile(values, numerator) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * numerator / 100) - 1)] || 0;
}

function randomGenerator(initialSeed) {
  let seed = initialSeed >>> 0;
  return maximum => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return maximum > 0 ? seed % maximum : 0; };
}

function benchmarkFixture(index) {
  const random = randomGenerator((0x51f15e ^ Math.imul(index + 1, 2654435761)) >>> 0);
  const fixture = productionRootFixture(); const size = 7;
  fixture.game.map = Array.from({ length: size }, (_, x) => Array.from({ length: size }, (_, y) =>
    x === 0 || y === 0 || x === size - 1 || y === size - 1 ? "x" : "."));
  const cells = [];
  for (let x = 1; x < size - 1; x += 1)
    for (let y = 1; y < size - 1; y += 1) cells.push([x, y]);
  for (let wall = 0; wall < 4; wall += 1) {
    const cell = cells[random(cells.length)]; fixture.game.map[cell[0]][cell[1]] = "x";
  }
  const open = cells.filter(cell => fixture.game.map[cell[0]][cell[1]] === ".");
  const own = open[random(open.length)];
  const nearby = open.filter(cell => (cell[0] !== own[0] || cell[1] !== own[1]) &&
    Math.abs(cell[0] - own[0]) + Math.abs(cell[1] - own[1]) <= 5);
  const enemy = nearby[random(nearby.length)];
  const starCells = open.filter(cell => (cell[0] !== own[0] || cell[1] !== own[1]) &&
    (cell[0] !== enemy[0] || cell[1] !== enemy[1]));
  fixture.me.tank.position = own; fixture.enemy.tank.position = enemy;
  fixture.me.tank.direction = ["up", "right", "down", "left"][random(4)];
  fixture.enemy.tank.direction = ["up", "right", "down", "left"][random(4)];
  fixture.game.star = starCells[random(starCells.length)];
  const variant = index & 3;
  if (variant === 1) fixture.enemy.status.fireLocked = true;
  if (variant === 2) {
    fixture.me.status.stunned = true; fixture.enemy.status.stunned = true;
    fixture.me.effects.debuff = { type: "stun", remainingFrames: 2 };
    fixture.enemy.effects.debuff = { type: "stun", remainingFrames: 2 };
  }
  if (variant === 3) {
    fixture.me.tank.direction = "right"; fixture.enemy.tank.direction = "left";
  }
  return fixture;
}

function preparedFixture(index) {
  const fixture = benchmarkFixture(index); const engine = new ProductionRootEngine();
  const adapted = engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
  if (!adapted.bundle) throw new Error(`SEARCH_BENCHMARK_ADAPT_FAILED:${index}:${adapted.status}`);
  engine.generateActions(); let ourCount = engine.ourCount;
  if (ourCount > 1 && engine.ourActions[ourCount - 1] === ACTION.NONE) ourCount -= 1;
  return { engine, bundle: adapted.bundle, ourCount };
}

function configureDirect(search, prepared, risk) {
  search.rootActions = prepared.engine.ourActions;
  search.rootArguments = prepared.engine.ourArguments;
  search.rootOurCount = prepared.ourCount;
  search.rootEnemyActions = prepared.engine.enemyActions;
  search.rootEnemyArguments = prepared.engine.enemyArguments;
  search.rootEnemyCount = prepared.engine.enemyCount;
  search.resetRoot(); search.baseRisk = risk;
}

function materializeDirect(search, profile, prepared, complete) {
  search.attemptedDepth = profile.depth;
  if (!complete) return;
  search.commitIteration(prepared.ourCount, profile.depth);
}

function runProfile(prepared, profile, risk = 50) {
  const runtime = profile.kind === "legacy" ? { ...RUNTIME_CONFIG,
    DIRECT_DEPTH_TWO_MIN_NODE_BUDGET: 0xffff } : RUNTIME_CONFIG;
  const search = new ProductionDepthSearch(new ProductionCacheBank(), runtime);
  const started = process.hrtime.bigint(); let complete = 0;
  if (profile.kind === "legacy" || profile.kind === "adaptive")
    complete = search.search(prepared.bundle,
    prepared.engine.ourActions, prepared.engine.ourArguments, prepared.ourCount,
    prepared.engine.enemyActions, prepared.engine.enemyArguments, prepared.engine.enemyCount,
    6, profile.budget, risk) > 0 ? 1 : 0;
  else {
    configureDirect(search, prepared, risk);
    complete = search.runIteration(prepared.bundle, profile.depth, profile.budget,
      profile.width) ? 1 : 0;
    materializeDirect(search, profile, prepared, complete);
  }
  const micros = Number((process.hrtime.bigint() - started) / 1000n);
  return { search, complete, micros };
}

function oracle(prepared) {
  const profile = { kind: "direct", depth: 2, width: 4, budget: 10000 };
  const result = runProfile(prepared, profile);
  if (!result.complete || result.search.rootRestoreFailures)
    throw new Error("SEARCH_FRONTIER_ORACLE_INCOMPLETE");
  return result;
}

function emptyMetrics(profile) {
  return { profile, calls: 0, completed: 0, noValue: 0, supportComplete: 0,
    rootRestoreFailures: 0, hotAllocationCount: 0, nodes: [], micros: [], exactOracleChoice: 0,
    oracleRegretTotal: 0, oracleRegretMaximum: 0, changedFromLegacy: 0,
    improvedFromLegacy: 0, degradedFromLegacy: 0, equalToLegacy: 0, selectionDeltas: [] };
}

function oracleRegret(oracleSearch, candidate) {
  if (!candidate.complete) return null;
  const row = candidate.search.bestRow;
  return oracleSearch.bestValue - oracleSearch.rootScore[row];
}

function benchmarkSearchFrontier(options = {}) {
  const scenarioCount = options.scenarioCount || DEFAULT_SCENARIOS;
  const measuredBatches = options.measuredBatches || DEFAULT_BATCHES;
  const metrics = Object.fromEntries(PROFILES.map(profile => [profile.id, emptyMetrics(profile)]));
  for (let batch = 0; batch < measuredBatches; batch += 1) {
    for (let index = 0; index < scenarioCount; index += 1) {
      const prepared = preparedFixture(index); const exact = oracle(prepared); const results = {};
      for (const profile of PROFILES) results[profile.id] = runProfile(prepared, profile);
      const legacy = results["legacy-250"];
      const legacyRegret = oracleRegret(exact.search, legacy);
      for (const profile of PROFILES) {
        const result = results[profile.id]; const output = metrics[profile.id];
        output.calls += 1; output.completed += result.complete; output.noValue += result.complete ? 0 : 1;
        output.supportComplete += result.search.representativeSupportComplete;
        output.rootRestoreFailures += result.search.rootRestoreFailures;
        output.hotAllocationCount += result.search.hotAllocationCount;
        output.nodes.push(result.search.nodes); output.micros.push(result.micros);
        const regret = oracleRegret(exact.search, result);
        if (regret !== null) {
          output.exactOracleChoice += regret === 0 ? 1 : 0;
          output.oracleRegretTotal += regret;
          if (regret > output.oracleRegretMaximum) output.oracleRegretMaximum = regret;
        }
        if (batch === 0 && profile.id !== "legacy-250" && result.complete && legacy.complete) {
          if (result.search.bestRow !== legacy.search.bestRow) {
            output.changedFromLegacy += 1;
            output.selectionDeltas.push({ scenarioIndex: index, variant: index & 3,
              legacyRow: legacy.search.bestRow, candidateRow: result.search.bestRow,
              legacyAction: prepared.engine.ourActions[legacy.search.bestRow],
              candidateAction: prepared.engine.ourActions[result.search.bestRow],
              legacyRegret, candidateRegret: regret,
              oracleRegretDelta: legacyRegret - regret });
          }
          if (regret < legacyRegret) output.improvedFromLegacy += 1;
          else if (regret > legacyRegret) output.degradedFromLegacy += 1;
          else output.equalToLegacy += 1;
        }
      }
    }
  }
  const summaries = {};
  for (const profile of PROFILES) {
    const input = metrics[profile.id]; const completed = Math.max(1, input.completed);
    summaries[profile.id] = { profile: input.profile, calls: input.calls,
      completed: input.completed, completionPer10000: Math.floor(input.completed * 10000 / input.calls),
      noValue: input.noValue, supportComplete: input.supportComplete,
      supportCompletePer10000: Math.floor(input.supportComplete * 10000 / input.calls),
      meanNodes: Math.floor(input.nodes.reduce((sum, value) => sum + value, 0) / input.calls),
      p95Nodes: percentile(input.nodes, 95), p95Micros: percentile(input.micros, 95),
      exactOracleChoice: input.exactOracleChoice,
      exactOracleChoicePer10000: Math.floor(input.exactOracleChoice * 10000 / completed),
      meanOracleRegret: Math.floor(input.oracleRegretTotal / completed),
      maximumOracleRegret: input.oracleRegretMaximum,
      changedFromLegacy: input.changedFromLegacy, improvedFromLegacy: input.improvedFromLegacy,
      degradedFromLegacy: input.degradedFromLegacy, equalToLegacy: input.equalToLegacy,
      selectionDeltas: input.selectionDeltas,
      rootRestoreFailures: input.rootRestoreFailures, hotAllocationCount: input.hotAllocationCount };
  }
  const allSafe = Object.values(summaries).every(result =>
    result.rootRestoreFailures === 0 && result.hotAllocationCount === 0);
  return { status: allSafe ? "PASS" : "FAIL", fixedNode: process.version,
    scenarioCount, measuredBatches, totalScenarioEvaluations: scenarioCount * measuredBatches,
    oracle: "DEPTH_2_WIDTH_4_UNBOUNDED", summaries };
}

function writeSearchFrontierBenchmark(workspaceRoot = defaultWorkspaceRoot(), options = {}) {
  const root = path.resolve(workspaceRoot); const benchmark = benchmarkSearchFrontier(options);
  const report = { artifactKind: "SEARCH_FRONTIER_BENCHMARK",
    properties: ["SOURCE_BOUND", "DETERMINISTIC_SCENARIOS", "SELECTION_REGRET", "FIVE_BATCH_P95"],
    source: sourceIdentity(root), benchmark, fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  const directory = path.join(root, "artifacts", "benchmarks", "search-frontier");
  const file = path.join(directory, `${report.fingerprint}.json`);
  writeJsonImmutable(file, report, { mode: 0o644 });
  writeJsonAtomic(path.join(directory, "latest.json"), report, { mode: 0o644 });
  return { file, report };
}

if (require.main === module) {
  const result = writeSearchFrontierBenchmark(process.argv[2]);
  process.stdout.write(`${JSON.stringify({ file: result.file, ...result.report }, null, 2)}\n`);
}

module.exports = { PROFILES, benchmarkFixture, benchmarkSearchFrontier,
  writeSearchFrontierBenchmark };
