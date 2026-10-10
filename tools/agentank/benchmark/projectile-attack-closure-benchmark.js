#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ProductionRootEngine } =
  require("../../../engine-v2/src/runtime/production-root");
const { productionRootFixture } = require("../build/imp6-builder");
const { sourceIdentity } = require("../diagnostics/v1-v2-working-arena");
const { fingerprintObject } = require("../core/hash");

const WARMUP_BATCHES = 5;
const MEASURED_BATCHES = 5;
const ROOTS_PER_BATCH = 128;
const P95_RATIO_LIMIT = 12000;

function boxedMap(width, height) {
  return Array.from({ length: width }, (_, x) =>
    Array.from({ length: height }, (_, y) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "x" : "."));
}

const MAP_20 = boxedMap(20, 20);

function benchmarkFixture(index) {
  const fixture = productionRootFixture();
  fixture.game.map = MAP_20;
  fixture.game.star = [10, 16];
  fixture.game.frame = 1;
  fixture.game.frames = 1;
  fixture.me.tank.position = [2, index & 1 ? 9 : 10];
  fixture.me.tank.direction = "right";
  fixture.enemy.tank.position = index & 1 ? [11, 10] : [5, 10];
  fixture.enemy.tank.direction = "up";
  return fixture;
}

function prepareLane(disabled, roots) {
  const engines = new Array(roots);
  const fixtures = new Array(roots);
  for (let index = 0; index < roots; index += 1) {
    engines[index] = new ProductionRootEngine({
      diagnosticDisableProjectileAttackClosure: disabled ? 1 : 0
    });
    fixtures[index] = benchmarkFixture(index);
  }
  return { engines, fixtures };
}

function timeLane(lane) {
  const started = process.hrtime.bigint();
  for (let index = 0; index < lane.engines.length; index += 1) {
    const fixture = lane.fixtures[index];
    lane.engines[index].decide(fixture.me, fixture.enemy, fixture.game);
  }
  const micros = Number((process.hrtime.bigint() - started) / 1000n);
  let evaluations = 0; let reverseBuilds = 0; let doomedCells = 0;
  let rootRestoreFailures = 0; let hotAllocationCount = 0;
  for (const engine of lane.engines) {
    evaluations += engine.projectileAttack.evaluationCount;
    reverseBuilds += engine.projectileAttack.reverseBuildCount;
    doomedCells += engine.projectileAttack.doomedCellCount;
    rootRestoreFailures += engine.projectileAttack.rootRestoreFailures +
      engine.depthSearch.rootRestoreFailures +
      engine.informationSearch.rootRestoreFailures +
      engine.forcedWinSearch.rootRestoreFailures;
    hotAllocationCount += engine.projectileAttack.hotAllocationCount +
      engine.projectileAttack.timeline.hotAllocationCount +
      engine.projectileAttack.deadline.hotAllocationCount;
  }
  return { micros, evaluations, reverseBuilds, doomedCells,
    rootRestoreFailures, hotAllocationCount };
}

function percentile(values, numerator) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * numerator / 100) - 1)] || 0;
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[(sorted.length / 2) | 0] || 0;
}

function pairedBatch(batch, roots) {
  const off = prepareLane(1, roots);
  const on = prepareLane(0, roots);
  let offResult; let onResult;
  if (batch & 1) {
    onResult = timeLane(on);
    offResult = timeLane(off);
  } else {
    offResult = timeLane(off);
    onResult = timeLane(on);
  }
  return {
    batch,
    off: offResult,
    on: onResult,
    ratioPer10000: Math.floor(onResult.micros * 10000 /
      Math.max(1, offResult.micros))
  };
}

function benchmarkProjectileAttackClosure(options = {}) {
  const roots = options.rootsPerBatch || ROOTS_PER_BATCH;
  for (let batch = 0; batch < WARMUP_BATCHES; batch += 1)
    pairedBatch(batch, Math.max(16, Math.floor(roots / 2)));
  const batches = new Array(MEASURED_BATCHES);
  for (let batch = 0; batch < MEASURED_BATCHES; batch += 1)
    batches[batch] = pairedBatch(batch, roots);
  const offMicros = batches.map(item => item.off.micros);
  const onMicros = batches.map(item => item.on.micros);
  const ratios = batches.map(item => item.ratioPer10000);
  const offP95Micros = percentile(offMicros, 95);
  const onP95Micros = percentile(onMicros, 95);
  const p95RatioPer10000 = Math.floor(onP95Micros * 10000 /
    Math.max(1, offP95Micros));
  const rootRestoreFailures = batches.reduce((sum, item) =>
    sum + item.off.rootRestoreFailures + item.on.rootRestoreFailures, 0);
  const hotAllocationCount = batches.reduce((sum, item) =>
    sum + item.off.hotAllocationCount + item.on.hotAllocationCount, 0);
  const reverseBuilds = batches.reduce((sum, item) =>
    sum + item.on.reverseBuilds, 0);
  const doomedCells = batches.reduce((sum, item) =>
    sum + item.on.doomedCells, 0);
  return {
    status: p95RatioPer10000 <= P95_RATIO_LIMIT &&
      rootRestoreFailures === 0 && hotAllocationCount === 0 &&
      reverseBuilds > 0 && doomedCells > 0 ? "PASS" : "FAIL",
    fixedNode: process.version,
    warmupBatches: WARMUP_BATCHES,
    measuredBatches: MEASURED_BATCHES,
    rootsPerBatch: roots,
    batches,
    offP95Micros,
    onP95Micros,
    p95RatioPer10000,
    pairedMedianRatioPer10000: median(ratios),
    p95RatioLimitPer10000: P95_RATIO_LIMIT,
    rootRestoreFailures,
    hotAllocationCount,
    reverseBuilds,
    doomedCells
  };
}

function parse(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--roots")
      options.rootsPerBatch = Math.max(16, Math.floor(Number(argv[++index]) || 0));
    else if (argv[index] === "--output") options.output = path.resolve(argv[++index]);
    else throw new Error(`PAC_BENCHMARK_UNKNOWN_ARGUMENT:${argv[index]}`);
  }
  return options;
}

if (require.main === module) {
  const options = parse(process.argv);
  const workspaceRoot = path.resolve(__dirname, "../../..");
  const report = {
    schemaVersion: 1,
    objectKind: "ProjectileAttackClosureBenchmarkV1",
    source: sourceIdentity(workspaceRoot),
    benchmark: benchmarkProjectileAttackClosure(options),
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.benchmark.status !== "PASS") process.exitCode = 1;
}

module.exports = {
  WARMUP_BATCHES,
  MEASURED_BATCHES,
  ROOTS_PER_BATCH,
  P95_RATIO_LIMIT,
  benchmarkFixture,
  benchmarkProjectileAttackClosure
};
