"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { fingerprintObject, sha256Text } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { DeterministicPrng } = require("../harness/deterministic-prng");
const { SystemClock } = require("../harness/clock");
const { semanticFingerprint } = require("../harness/semantic");

const LAYER_IDS = Object.freeze(["function", "composite", "pipeline", "terminal", "full-game",
  "platform"]);

function loadBenchmarkPlan(workspaceRoot = defaultWorkspaceRoot(), planFile) {
  const root = path.resolve(workspaceRoot);
  const file = planFile || contained(root, "config", "agentank", "imp0-benchmark-plan.json");
  const plan = JSON.parse(fs.readFileSync(file, "utf8"));
  validateSchemaObject("imp0-benchmark-plan", plan, root);
  invariant(plan.layers.map(layer => layer.layerId).join("|") === LAYER_IDS.join("|"),
    "BENCHMARK_LAYER_SET_MISMATCH", "benchmark plan must contain the six layers in canonical order");
  for (const layer of plan.layers) {
    invariant(fs.existsSync(contained(root, layer.directory)), "BENCHMARK_DIRECTORY_MISSING",
      `benchmark directory missing: ${layer.directory}`);
  }
  return { plan, fingerprint: fingerprintObject(plan) };
}

function percentile(sorted, numerator, denominator) {
  invariant(sorted.length > 0, "EMPTY_PERCENTILE", "cannot compute percentile of empty data");
  const index = Math.min(sorted.length - 1, Math.floor(((sorted.length - 1) * numerator) / denominator));
  return sorted[index];
}

function normalizeCaseResult(value) {
  if (value && typeof value === "object" && Object.hasOwn(value, "semantic")) {
    return {
      semantic: value.semantic,
      operations: Number.isSafeInteger(value.operations) ? value.operations : 1,
      allocations: Number.isSafeInteger(value.allocations) ? value.allocations : 0,
      highWater: Number.isSafeInteger(value.highWater) ? value.highWater : 0
    };
  }
  return { semantic: value, operations: 1, allocations: 0, highWater: 0 };
}

function runLayer(layer, cases, plan, clock) {
  if (!Array.isArray(cases) || cases.length === 0) {
    return { layerId: layer.layerId, status: "NOT_RUN", reason: "ZERO_SAMPLES", caseCount: 0,
      sampleCount: 0, metrics: null, semanticFingerprint: null };
  }
  const durations = [];
  const semantics = [];
  let operations = 0;
  let allocations = 0;
  let highWater = 0;
  try {
    for (const benchmarkCase of cases) {
      invariant(benchmarkCase && typeof benchmarkCase.caseId === "string" &&
        typeof benchmarkCase.run === "function", "INVALID_BENCHMARK_CASE",
      "benchmark case requires caseId and run function");
      let seed = Number.parseInt(sha256Text(`${plan.seed}:${layer.layerId}:${benchmarkCase.caseId}`)
        .slice(0, 8), 16) >>> 0;
      if (seed === 0) seed = 1;
      const prng = new DeterministicPrng(seed);
      for (let index = 0; index < plan.warmupIterations; index++) benchmarkCase.run(prng, index, true);
      for (let index = 0; index < plan.sampleIterations; index++) {
        const start = clock.nowNanoseconds();
        const result = normalizeCaseResult(benchmarkCase.run(prng, index, false));
        const end = clock.nowNanoseconds();
        durations.push(clock.elapsedMicroseconds(start, end));
        semantics.push({ caseId: benchmarkCase.caseId, sample: index, value: result.semantic });
        operations += result.operations;
        allocations += result.allocations;
        if (result.highWater > highWater) highWater = result.highWater;
      }
    }
  } catch (error) {
    return { layerId: layer.layerId, status: "FAIL", reason: error.code || "BENCHMARK_CASE_FAILED",
      caseCount: cases.length, sampleCount: durations.length, metrics: null,
      semanticFingerprint: null };
  }
  const sorted = durations.slice().sort((left, right) => left - right);
  const totalMicros = sorted.reduce((sum, value) => sum + value, 0);
  const metrics = {
    minMicros: sorted[0],
    p50Micros: percentile(sorted, 50, 100),
    p95Micros: percentile(sorted, 95, 100),
    p99Micros: percentile(sorted, 99, 100),
    maxMicros: sorted[sorted.length - 1],
    totalMicros,
    operations,
    operationsPerSecond: totalMicros === 0 ? null : Math.floor((operations * 1000000) / totalMicros),
    instrumentedAllocations: allocations,
    highWater
  };
  return { layerId: layer.layerId, status: "PASS", reason: null, caseCount: cases.length,
    sampleCount: durations.length, metrics, semanticFingerprint: semanticFingerprint(semantics) };
}

function runBenchmarkPlan(options = {}) {
  const workspaceRoot = options.workspaceRoot || defaultWorkspaceRoot();
  const loaded = loadBenchmarkPlan(workspaceRoot, options.planFile);
  const casesByLayer = options.casesByLayer || {};
  const clock = options.clock || new SystemClock();
  const layers = loaded.plan.layers.map(layer =>
    runLayer(layer, casesByLayer[layer.layerId], loaded.plan, clock));
  const status = layers.some(layer => layer.status === "FAIL") ? "FAIL" :
    layers.some(layer => layer.status === "PASS") ? "PASS" : "NOT_RUN";
  const report = {
    schemaVersion: 1,
    reportId: "imp0-benchmark-skeleton-v1",
    benchmarkPlanId: loaded.plan.benchmarkPlanId,
    planFingerprint: loaded.fingerprint,
    status,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    layers,
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  validateSchemaObject("imp0-benchmark-report", report, workspaceRoot);
  return report;
}

module.exports = { LAYER_IDS, loadBenchmarkPlan, percentile, normalizeCaseResult, runBenchmarkPlan };
