#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");

const PROFILE = "SELECTIVE_GEOMETRY_SHADOW";
const KEY_COUNT = 4096;
const SALT = "HP17_SELECTIVE_GEOMETRY_TRIGGER_V1";

const DIMENSIONS = Object.freeze([
  Object.freeze({ name: "width3", mask: 1, values: [0, 1] }),
  Object.freeze({ name: "selectedAttack", mask: 2, values: [0, 2] }),
  Object.freeze({ name: "attackChallenger", mask: 4, values: [0, 4] }),
  Object.freeze({ name: "tacticalRelation", mask: 24, values: [0, 8, 16] }),
  Object.freeze({ name: "expectedRelation", mask: 96, values: [0, 32, 64] }),
  Object.freeze({ name: "distanceBucket", mask: 384, values: [0, 128, 256, 384] }),
  Object.freeze({ name: "clearLine", mask: 512, values: [0, 512] }),
  Object.freeze({ name: "selectedFire", mask: 1024, values: [0, 1024] }),
  Object.freeze({ name: "earlyHalf", mask: 2048, values: [0, 2048] })
]);

function basis(value, total) { return total ? Math.floor(value * 10000 / total) : 0; }
function scenarioRank(fingerprint) {
  return crypto.createHash("sha256").update(`${SALT}:${fingerprint}`).digest("hex");
}

function splitScenarios(matches) {
  const unique = [...new Set(matches.map(row => row.scenarioFingerprint))].sort((a, b) =>
    scenarioRank(a).localeCompare(scenarioRank(b)));
  const discoveryCount = Math.floor(unique.length / 2);
  return { discovery: new Set(unique.slice(0, discoveryCount)),
    validation: new Set(unique.slice(discoveryCount)), ordered: unique };
}

function emptyHistogram() {
  return { total: new Uint32Array(KEY_COUNT), positive: new Uint32Array(KEY_COUNT),
    nodes: new Uint32Array(KEY_COUNT) };
}

function aggregate(matches, scenarios) {
  const histogram = emptyHistogram();
  for (const row of matches) {
    if (!scenarios.has(row.scenarioFingerprint)) continue;
    for (const bucket of row.selectiveGeometryRuntimeShadow?.featureBuckets || []) {
      histogram.total[bucket.key] += bucket.total || 0;
      histogram.positive[bucket.key] += bucket.positive || 0;
      histogram.nodes[bucket.key] += bucket.nodes || 0;
    }
  }
  return histogram;
}

function totals(histogram, mask = 0, value = 0) {
  let total = 0; let positive = 0; let nodes = 0;
  for (let key = 0; key < KEY_COUNT; key += 1)
    if ((key & mask) === value) {
      total += histogram.total[key]; positive += histogram.positive[key];
      nodes += histogram.nodes[key];
    }
  return { total, positive, nodes };
}

function metrics(histogram, baseline, mask, value) {
  const selected = totals(histogram, mask, value);
  return { ...selected,
    positiveRecallBasisPoints: basis(selected.positive, baseline.positive),
    nodeRetentionBasisPoints: basis(selected.nodes, baseline.nodes),
    completionRetentionBasisPoints: basis(selected.total, baseline.total),
    precisionBasisPoints: basis(selected.positive, selected.total),
    baselinePrecisionBasisPoints: basis(baseline.positive, baseline.total),
    gainBasisPoints: basis(selected.positive, baseline.positive) -
      basis(selected.nodes, baseline.nodes) };
}

function describe(mask, value) {
  const output = [];
  for (const dimension of DIMENSIONS)
    if ((mask & dimension.mask) === dimension.mask) {
      const selected = value & dimension.mask;
      output.push(`${dimension.name}=${dimension.values.indexOf(selected)}`);
    }
  return output;
}

function candidateBetter(left, right) {
  if (!right) return true;
  if (left.discovery.gainBasisPoints !== right.discovery.gainBasisPoints)
    return left.discovery.gainBasisPoints > right.discovery.gainBasisPoints;
  if (left.discovery.positiveRecallBasisPoints !== right.discovery.positiveRecallBasisPoints)
    return left.discovery.positiveRecallBasisPoints > right.discovery.positiveRecallBasisPoints;
  if (left.discovery.nodeRetentionBasisPoints !== right.discovery.nodeRetentionBasisPoints)
    return left.discovery.nodeRetentionBasisPoints < right.discovery.nodeRetentionBasisPoints;
  return left.conditionCount < right.conditionCount;
}

function selectRule(discovery) {
  const baseline = totals(discovery); let best = null;
  function visit(index, mask, value, conditionCount) {
    if (index === DIMENSIONS.length) {
      if (!conditionCount) return;
      const result = metrics(discovery, baseline, mask, value);
      if (result.positive < 8 || result.positiveRecallBasisPoints < 4000 ||
          result.nodeRetentionBasisPoints > 4500 ||
          result.precisionBasisPoints < result.baselinePrecisionBasisPoints) return;
      const candidate = { mask, value, conditionCount, conditions: describe(mask, value),
        discovery: result };
      if (candidateBetter(candidate, best)) best = candidate;
      return;
    }
    const dimension = DIMENSIONS[index];
    visit(index + 1, mask, value, conditionCount);
    for (const selected of dimension.values)
      visit(index + 1, mask | dimension.mask, value | selected, conditionCount + 1);
  }
  visit(0, 0, 0, 0); return { baseline, best };
}

function analyze(report) {
  const matches = (report.matches || []).filter(row => row.profile === PROFILE);
  const split = splitScenarios(matches);
  const discovery = aggregate(matches, split.discovery);
  const validation = aggregate(matches, split.validation);
  const selection = selectRule(discovery);
  const validationBaseline = totals(validation);
  const selected = selection.best ? { ...selection.best,
    validation: metrics(validation, validationBaseline,
      selection.best.mask, selection.best.value) } : null;
  const accepted = Boolean(selected &&
    selected.validation.positiveRecallBasisPoints >= 3000 &&
    selected.validation.nodeRetentionBasisPoints <= 4500 &&
    selected.validation.precisionBasisPoints >=
      selected.validation.baselinePrecisionBasisPoints &&
    selected.validation.gainBasisPoints >= 1000);
  return { schemaVersion: 1, objectKind: "HP17_GEOMETRY_TRIGGER_ANALYSIS_V1",
    salt: SALT, scenarioCount: split.ordered.length,
    discoveryScenarioCount: split.discovery.size,
    validationScenarioCount: split.validation.size,
    discoveryScenarios: [...split.discovery], validationScenarios: [...split.validation],
    discoveryBaseline: selection.baseline, validationBaseline,
    selectedRule: selected, status: accepted ? "ACCEPTED_FOR_RUNTIME_SHADOW" : "REJECTED" };
}

function option(name, fallback = null) {
  const at = process.argv.indexOf(name); return at < 0 ? fallback : process.argv[at + 1];
}

function main() {
  const input = option("--input"); if (!input) throw new Error("HP17_INPUT_REQUIRED");
  const report = JSON.parse(fs.readFileSync(input, "utf8")); const result = analyze(report);
  const output = option("--output");
  if (output) fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1; }
}

module.exports = { KEY_COUNT, DIMENSIONS, splitScenarios, aggregate, totals, metrics,
  selectRule, analyze };
