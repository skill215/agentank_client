#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ProductionRootEngine } = require("../../../engine-v2/src/runtime/production-root");
const { ACTION, CHANCE } = require("../../../engine-v2/src/abi/fast-codes");
const { benchmarkFixture } = require("./search-frontier-benchmark");

const BATCHES = 5; const REPETITIONS = 12; const FIXTURES = 16;
function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function percentile(values, p) {
  const ordered = Array.from(values).sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * p) - 1)];
}
function sourceIdentity() {
  const root = path.resolve(__dirname, "../../..");
  const files = ["engine-v2/src/search/production-depth-search.js",
    "engine-v2/src/search/root-transition-slab.js",
    "engine-v2/src/search/contender-frontier.js",
    "engine-v2/src/runtime/production-root.js", __filename.slice(root.length + 1)];
  const hashes = {};
  for (const file of files) hashes[file] = sha(fs.readFileSync(path.join(root, file)));
  return { files: hashes, fingerprint: sha(JSON.stringify(hashes)) };
}
function make(index, enabled) {
  const fixture = benchmarkFixture(index);
  const engine = new ProductionRootEngine({ diagnosticCrossFramePV: enabled,
    diagnosticCrossFrameRootPV: false });
  const adapted = engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
  engine.generateActions(); let ourCount = engine.ourCount;
  if (ourCount > 1 && engine.ourActions[ourCount - 1] === ACTION.NONE) ourCount -= 1;
  const search = engine.depthSearch;
  search.search(adapted.bundle, engine.ourActions, engine.ourArguments, ourCount,
    engine.enemyActions, engine.enemyArguments, engine.enemyCount, 3, 100000, 50);
  const row = search.bestRow;
  engine.rootTransitions.commitPrincipalAction(engine.ourActions[row], engine.ourArguments[row]);
  let column = -1;
  for (let candidate = 0; candidate < engine.enemyCount; candidate += 1) {
    const entry = engine.rootTransitions.entryIndex(row, candidate, CHANCE.NORMAL, CHANCE.NORMAL);
    if (engine.rootTransitions.hasPrincipalEntry(entry)) { column = candidate; break; }
  }
  if (column < 0) throw new Error(`HP8 fixture ${index} has no exact child PV`);
  engine.rootTransitions.apply(adapted.bundle, row, column, CHANCE.NORMAL, CHANCE.NORMAL, 1);
  engine.generateActions(); ourCount = engine.ourCount;
  if (ourCount > 1 && engine.ourActions[ourCount - 1] === ACTION.NONE) ourCount -= 1;
  return { engine, bundle: adapted.bundle, ourCount };
}
function run(item) {
  const engine = item.engine; const search = engine.depthSearch;
  const depth = search.search(item.bundle, engine.ourActions, engine.ourArguments, item.ourCount,
    engine.enemyActions, engine.enemyArguments, engine.enemyCount, 3, 512, 50);
  const payload = JSON.stringify({ depth, action: engine.ourActions[search.bestRow],
    value: search.bestValue, completedDepth: search.completedDepth,
    selectiveDepth: search.selectiveCompletedDepth,
    rootScore: Array.from(search.rootScore.slice(0, item.ourCount)),
    cells: Array.from(search.rootCellScore.slice(0, item.ourCount * 6)) });
  return { fingerprint: sha(payload), nodes: search.nodes,
    rootRestoreFailures: search.rootRestoreFailures,
    rootPromotions: search.crossFramePVRootPromoteCount,
    deepPromotions: search.crossFramePVDeepPromoteCount,
    observedPV: search.crossFramePVHitCount,
    principalOverflows: engine.rootTransitions.principalOverflowCount };
}
function cold() {
  const rows = []; let disabledNodes = 0; let enabledNodes = 0; let mismatches = 0;
  let rootPromotions = 0; let deepPromotions = 0; let observedPV = 0; let restoreFailures = 0;
  let principalOverflows = 0;
  for (let index = 0; index < FIXTURES; index += 1) {
    const disabled = run(make(index, false)); const enabled = run(make(index, true));
    const equal = disabled.fingerprint === enabled.fingerprint; mismatches += equal ? 0 : 1;
    disabledNodes += disabled.nodes; enabledNodes += enabled.nodes;
    rootPromotions += enabled.rootPromotions; deepPromotions += enabled.deepPromotions;
    observedPV += enabled.observedPV; restoreFailures += enabled.rootRestoreFailures;
    principalOverflows += enabled.principalOverflows;
    rows.push({ index, equal, disabledNodes: disabled.nodes, enabledNodes: enabled.nodes });
  }
  return { rows, disabledNodes, enabledNodes, nodeReductionBasisPoints:
    Math.floor((disabledNodes - enabledNodes) * 10000 / Math.max(1, disabledNodes)),
    semanticMismatches: mismatches, rootPromotions, deepPromotions, observedPV, restoreFailures,
    principalOverflows };
}
function timed(enabled) {
  const items = [];
  for (let index = 0; index < FIXTURES; index += 1) items.push(make(index, enabled));
  for (const item of items) run(item);
  const samples = []; let nodes = 0;
  for (let batch = 0; batch < BATCHES; batch += 1) {
    const started = process.hrtime.bigint();
    for (let repetition = 0; repetition < REPETITIONS; repetition += 1)
      for (const item of items) nodes += run(item).nodes;
    samples.push(Number(process.hrtime.bigint() - started) / (REPETITIONS * items.length));
  }
  return { batches: BATCHES, callsPerBatch: REPETITIONS * items.length,
    samplesNanoseconds: samples, p50Nanoseconds: percentile(samples, 0.5),
    p95Nanoseconds: percentile(samples, 0.95), nodes };
}

const evidence = cold(); const disabled = timed(false); const enabled = timed(true);
const status = evidence.semanticMismatches === 0 && evidence.restoreFailures === 0 &&
  evidence.principalOverflows === 0 &&
  evidence.rootPromotions === 0 && evidence.deepPromotions > 0 &&
  evidence.nodeReductionBasisPoints > 0 && enabled.p95Nanoseconds < disabled.p95Nanoseconds ?
  "PASS" : "FAIL";
const report = { schemaVersion: 1, objectKind: "HP8_CROSS_FRAME_PV_BENCHMARK_V1", status,
  node: process.version, source: sourceIdentity(), contract: { fixtures: FIXTURES,
    batches: BATCHES, repetitions: REPETITIONS, semanticMismatchesMaximum: 0,
    rootPromotionsMaximum: 0, principalOverflowsMaximum: 0, nodeReductionStrictlyPositive: true,
    p95MustImprove: true }, evidence, timing: { disabled, enabled,
    p95RatioBasisPoints: Math.floor(enabled.p95Nanoseconds * 10000 /
      Math.max(1, disabled.p95Nanoseconds)) } };
report.fingerprint = sha(JSON.stringify(report));
const outputAt = process.argv.indexOf("--output");
if (outputAt >= 0 && process.argv[outputAt + 1]) {
  const target = path.resolve(process.argv[outputAt + 1]);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (status !== "PASS") process.exitCode = 1;
