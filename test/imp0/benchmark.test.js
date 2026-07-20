"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { LAYER_IDS, runBenchmarkPlan } = require("../../tools/agentank/benchmark/runner");
const { SyntheticClock } = require("../../tools/agentank/harness/clock");

const ROOT = path.resolve(__dirname, "../..");

test("all six empty benchmark layers are NOT_RUN rather than PASS", () => {
  const report = runBenchmarkPlan({ workspaceRoot: ROOT });
  assert.equal(report.status, "NOT_RUN");
  assert.deepEqual(report.layers.map(layer => layer.layerId), LAYER_IDS);
  for (const layer of report.layers) {
    assert.equal(layer.status, "NOT_RUN");
    assert.equal(layer.reason, "ZERO_SAMPLES");
    assert.equal(layer.sampleCount, 0);
  }
});

test("a registered benchmark case produces integer metrics", () => {
  const clock = new SyntheticClock();
  const report = runBenchmarkPlan({
    workspaceRoot: ROOT,
    clock,
    casesByLayer: {
      function: [{
        caseId: "HARNESS-SELF",
        run(prng) {
          clock.advanceMicroseconds(10);
          return { semantic: prng.nextUint32(), operations: 2, allocations: 0, highWater: 3 };
        }
      }]
    }
  });
  const layer = report.layers[0];
  assert.equal(report.status, "PASS");
  assert.equal(layer.status, "PASS");
  assert.equal(layer.sampleCount, 7);
  assert.equal(layer.metrics.p50Micros, 10);
  assert.equal(layer.metrics.instrumentedAllocations, 0);
  assert.equal(layer.metrics.highWater, 3);
  assert.equal(report.layers[1].status, "NOT_RUN");
});
