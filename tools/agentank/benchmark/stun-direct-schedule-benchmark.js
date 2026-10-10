#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ProductionRootEngine } = require("../../../engine-v2/src/runtime/production-root");
const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { SEARCH_CAPACITY } = require("../../../engine-v2/src/generated/search-config");
const { benchmarkFixture } = require("./search-frontier-benchmark");
const { fingerprintObject, sha256Bytes } = require("../core/hash");

const PROFILE = Object.freeze({ LEGACY: "LEGACY_STUN", DIRECT: "SELECTIVE_STUN_P2_LE48" });

function percentile(values, percent) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percent / 100) - 1)];
}

function histogram(values) {
  const output = {};
  for (const value of values) output[value] = (output[value] || 0) + 1;
  return output;
}

function prepare(index, direct) {
  // benchmarkFixture variant 2 marks both tanks stunned. Spacing the index by
  // four keeps every scenario in that rule class while preserving geometry.
  const fixture = benchmarkFixture(index * 4 + 2);
  const engine = new ProductionRootEngine({
    diagnosticDirectDepthTwoDuringStun: direct,
    diagnosticDirectDepthTwoStunMaxRootNodes: direct ? 48 : undefined
  });
  const adapted = engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
  if (!adapted.bundle) throw new Error(`HP21_ADAPT:${index}:${adapted.status}`);
  engine.generateActions();
  let ourCount = engine.ourCount;
  if (ourCount > 1 && engine.ourActions[ourCount - 1] === ACTION.NONE) ourCount -= 1;
  const root = adapted.bundle.state.rootSignature();
  return { engine, bundle: adapted.bundle, ourCount, root };
}

function runPrepared(prepared) {
  const { engine, bundle, ourCount, root } = prepared;
  const search = engine.depthSearch;
  const beforeDirect = search.directStunRootCount;
  const started = process.hrtime.bigint();
  search.search(bundle, engine.ourActions, engine.ourArguments, ourCount,
    engine.enemyActions, engine.enemyArguments, engine.enemyCount,
    SEARCH_CAPACITY.MAX_DECISION_DEPTH, SEARCH_CAPACITY.MAX_NODES, 50, 0);
  const micros = Number((process.hrtime.bigint() - started) / 1000n);
  const rootMatrixNodes = search.rootMatrixNodeCount(bundle.state);
  const cells = [];
  for (let row = 0; row < ourCount; row += 1)
    for (let column = 0; column < engine.enemyCount; column += 1)
      cells.push(search.rootCellScore[
        row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column]);
  return { micros, nodes: search.nodes, rootMatrixNodes,
    completedDepth: search.completedDepth,
    supportDepth: search.representativeSupportComplete ?
      search.representativeSupportDepth : 0,
    supportComplete: search.representativeSupportComplete,
    bestRow: search.bestRow, bestValue: search.bestValue,
    directStunRoots: search.directStunRootCount - beforeDirect,
    rootRestoreFailures: search.rootRestoreFailures,
    hotAllocations: search.hotAllocationCount,
    rootRestored: bundle.state.rootSignature() === root ? 1 : 0,
    semantic: fingerprintObject({ supportDepth: search.representativeSupportDepth,
      supportComplete: search.representativeSupportComplete, bestRow: search.bestRow,
      bestValue: search.bestValue, rows: Array.from(search.rootScore.slice(0, ourCount)), cells }) };
}

function sample(index, direct) {
  const prepared = prepare(index, direct);
  const cold = runPrepared(prepared);
  const warm = runPrepared(prepared);
  return { index, cold, warm };
}

function summarize(rows, profile) {
  const cold = rows.map(row => row.cold); const warm = rows.map(row => row.warm);
  return { profile, calls: rows.length,
    cold: { p50Micros: percentile(cold.map(row => row.micros), 50),
      p95Micros: percentile(cold.map(row => row.micros), 95),
      meanNodes: Math.floor(cold.reduce((sum, row) => sum + row.nodes, 0) /
        Math.max(1, cold.length)),
      p95Nodes: percentile(cold.map(row => row.nodes), 95),
      completedDepthHistogram: histogram(cold.map(row => row.completedDepth)),
      supportDepthHistogram: histogram(cold.map(row => row.supportDepth)) },
    warm: { p50Micros: percentile(warm.map(row => row.micros), 50),
      p95Micros: percentile(warm.map(row => row.micros), 95),
      meanNodes: Math.floor(warm.reduce((sum, row) => sum + row.nodes, 0) /
        Math.max(1, warm.length)),
      p95Nodes: percentile(warm.map(row => row.nodes), 95),
      completedDepthHistogram: histogram(warm.map(row => row.completedDepth)),
      supportDepthHistogram: histogram(warm.map(row => row.supportDepth)) },
    directStunRoots: cold.reduce((sum, row) => sum + row.directStunRoots, 0),
    rootMatrixNodeHistogram: histogram(cold.map(row => row.rootMatrixNodes)),
    invariants: {
      rootRestoreFailures: cold.reduce((sum, row) => sum + row.rootRestoreFailures, 0) +
        warm.reduce((sum, row) => sum + row.rootRestoreFailures, 0),
      rootRestoreMismatches: cold.reduce((sum, row) => sum + (row.rootRestored ? 0 : 1), 0) +
        warm.reduce((sum, row) => sum + (row.rootRestored ? 0 : 1), 0),
      hotAllocations: cold.reduce((sum, row) => sum + row.hotAllocations, 0) +
        warm.reduce((sum, row) => sum + row.hotAllocations, 0),
      coldWarmSemanticMismatches: rows.reduce((sum, row) =>
        sum + (row.cold.semantic === row.warm.semantic ? 0 : 1), 0)
    } };
}

function compare(legacyRows, directRows) {
  let supportDepthGain = 0; let supportDepthLoss = 0; let supportDepthSame = 0;
  let completedDepthGain = 0; let completedDepthLoss = 0; let bestRowChanges = 0;
  let nodeDelta = 0;
  for (let index = 0; index < legacyRows.length; index += 1) {
    const legacy = legacyRows[index].cold; const direct = directRows[index].cold;
    if (direct.supportDepth > legacy.supportDepth) supportDepthGain += 1;
    else if (direct.supportDepth < legacy.supportDepth) supportDepthLoss += 1;
    else supportDepthSame += 1;
    if (direct.completedDepth > legacy.completedDepth) completedDepthGain += 1;
    else if (direct.completedDepth < legacy.completedDepth) completedDepthLoss += 1;
    if (direct.bestRow !== legacy.bestRow) bestRowChanges += 1;
    nodeDelta += direct.nodes - legacy.nodes;
  }
  return { supportDepthGain, supportDepthLoss, supportDepthSame,
    completedDepthGain, completedDepthLoss, bestRowChanges, nodeDelta,
    meanNodeDelta: Math.floor(nodeDelta / Math.max(1, legacyRows.length)) };
}

function benchmark(options = {}) {
  const scenarioCount = Number.isSafeInteger(options.scenarioCount) ? options.scenarioCount : 16;
  const warmupBatches = Number.isSafeInteger(options.warmupBatches) ? options.warmupBatches : 1;
  const measuredBatches = Number.isSafeInteger(options.measuredBatches) ?
    options.measuredBatches : 5;
  for (let batch = 0; batch < warmupBatches; batch += 1)
    for (let index = 0; index < scenarioCount; index += 1) {
      sample(index, (batch + index & 1) === 0);
      sample(index, (batch + index & 1) !== 0);
    }
  const rows = { [PROFILE.LEGACY]: [], [PROFILE.DIRECT]: [] };
  for (let batch = 0; batch < measuredBatches; batch += 1)
    for (let index = 0; index < scenarioCount; index += 1) {
      const directFirst = ((batch + index) & 1) === 0;
      const first = directFirst ? PROFILE.DIRECT : PROFILE.LEGACY;
      const second = directFirst ? PROFILE.LEGACY : PROFILE.DIRECT;
      rows[first].push(sample(index, first === PROFILE.DIRECT));
      rows[second].push(sample(index, second === PROFILE.DIRECT));
    }
  const summaries = {
    [PROFILE.LEGACY]: summarize(rows[PROFILE.LEGACY], PROFILE.LEGACY),
    [PROFILE.DIRECT]: summarize(rows[PROFILE.DIRECT], PROFILE.DIRECT)
  };
  const invariantTotal = Object.values(summaries).reduce((total, summary) =>
    total + Object.values(summary.invariants).reduce((sum, value) => sum + value, 0), 0);
  const report = { schemaVersion: 1, objectKind: "HP21_STUN_DIRECT_SCHEDULE_BENCHMARK_V1",
    status: invariantTotal === 0 ? "PASS" : "FAIL", node: process.version,
    scenarioCount, warmupBatches, measuredBatches,
    callsPerProfile: scenarioCount * measuredBatches,
    profileOrder: "ALTERNATING_PER_SCENARIO_AND_BATCH",
    summaries, comparison: compare(rows[PROFILE.LEGACY], rows[PROFILE.DIRECT]),
    source: {
      depthSearch: sha256Bytes(fs.readFileSync(path.resolve(__dirname,
        "../../../engine-v2/src/search/production-depth-search.js"))),
      root: sha256Bytes(fs.readFileSync(path.resolve(__dirname,
        "../../../engine-v2/src/runtime/production-root.js")))
    }, fingerprint: "" };
  report.fingerprint = fingerprintObject({ ...report, fingerprint: "" });
  return report;
}

function parse(argv) {
  const output = {};
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--output") output.output = path.resolve(argv[++index]);
    else if (argv[index] === "--scenarios") output.scenarioCount = Number(argv[++index]);
    else if (argv[index] === "--warmup-batches") output.warmupBatches = Number(argv[++index]);
    else if (argv[index] === "--measured-batches") output.measuredBatches = Number(argv[++index]);
  }
  return output;
}

if (require.main === module) {
  const options = parse(process.argv); const report = benchmark(options);
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { PROFILE, benchmark };
