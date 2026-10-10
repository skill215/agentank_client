"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { splitScenarios, aggregate, totals, selectRule } = require(
  "../../tools/agentank/diagnostics/selective-geometry-trigger-analysis");

function row(scenario, buckets) {
  return { profile: "SELECTIVE_GEOMETRY_SHADOW", scenarioFingerprint: scenario,
    selectiveGeometryRuntimeShadow: { featureBuckets: buckets } };
}

test("HP17 scenario split keeps both seats in one deterministic lane", () => {
  const matches = [row("a", []), row("a", []), row("b", []), row("b", []),
    row("c", []), row("c", []), row("d", []), row("d", [])];
  const split = splitScenarios(matches);
  assert.equal(split.discovery.size, 2); assert.equal(split.validation.size, 2);
  for (const scenario of split.discovery) assert.equal(split.validation.has(scenario), false);
});

test("HP17 histogram preserves completed positive and node denominators", () => {
  const histogram = aggregate([row("a", [{ key: 5, total: 3, positive: 2, nodes: 30 }]),
    row("a", [{ key: 5, total: 1, positive: 0, nodes: 8 }])], new Set(["a"]));
  assert.deepEqual(totals(histogram), { total: 4, positive: 2, nodes: 38 });
});

test("HP17 rule search finds a high-recall low-node semantic conjunction", () => {
  const buckets = [];
  for (let index = 0; index < 12; index += 1)
    buckets.push({ key: 1, total: 1, positive: 1, nodes: 5 });
  for (let index = 0; index < 20; index += 1)
    buckets.push({ key: 0, total: 1, positive: 0, nodes: 20 });
  const histogram = aggregate([row("a", buckets)], new Set(["a"]));
  const selected = selectRule(histogram).best;
  assert.ok(selected); assert.equal(selected.discovery.positiveRecallBasisPoints, 10000);
  assert.ok(selected.discovery.nodeRetentionBasisPoints < 4500);
});
