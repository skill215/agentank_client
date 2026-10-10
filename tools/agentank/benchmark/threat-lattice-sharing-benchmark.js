#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const fast = require("../../../engine-v2/src/fast");
const { ARRAY } = require("../../../engine-v2/src/state/fast-state");
const { FinalActionGate } = require("../../../engine-v2/src/runtime/final-action-gate");
const { EscapeObligation } = require("../../../engine-v2/src/runtime/escape-obligation");
const { InformationSafetyClosure } =
  require("../../../engine-v2/src/search/information-safety-closure");
const { ACTION, NONE_CELL } = require("../../../engine-v2/src/abi/fast-codes");

const ACTIONS = new Uint8Array([
  ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT, ACTION.FIRE, ACTION.NONE
]);
const ARGUMENTS = new Uint16Array(ACTIONS.length).fill(NONE_CELL);
const BATCHES = 5; const ITERATIONS = 160;
const ROOT = path.resolve(__dirname, "../../..");

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function percentile(values, p) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0,
    Math.ceil(sorted.length * p) - 1))];
}

function sourceIdentity() {
  const relatives = [
    "engine-v2/src/fast/hazard.js",
    "engine-v2/src/fast/deadline-kernel.js",
    "engine-v2/src/runtime/escape-obligation.js",
    "engine-v2/src/runtime/final-action-gate.js",
    "engine-v2/src/search/information-safety-closure.js",
    "tools/agentank/benchmark/threat-lattice-sharing-benchmark.js"
  ];
  const files = {};
  for (const relative of relatives) files[relative] = sha(fs.readFileSync(path.join(ROOT, relative)));
  return { files, fingerprint: sha(JSON.stringify(files)) };
}

function createFixture(size, variant, shared) {
  const center = Math.floor(size / 2); const frame = 10 + variant;
  const map = Array.from({ length: size }, (_, x) => Array.from({ length: size }, (_, y) =>
    x === 0 || y === 0 || x === size - 1 || y === size - 1 ? "x" : "."));
  const tank = (seat, cell, direction) => ({ entityId: seat + 1, seat, cell, direction,
    crashed: false, stars: 0, runtimeMs: 0, skillId: null, skillReadyFrame: frame + 10,
    shieldHitsRemaining: 0, shieldUntilFrame: null, frozenUntilFrame: null,
    stunUntilFrame: null, overloadUntilFrame: null, cloakUntilFrame: null,
    poisonAppliedFrame: null, poisonUntilFrame: null, boostUntilFrame: null,
    revealUntilFrame: null, pickupLockUntilFrame: null, fireLockUntilFrame: null,
    bombCooldownReadyFrame: frame + 10 });
  // A non-immediate committed bomb keeps every root action non-terminal, so
  // FinalHard, Safety and EO all query the same physical threat field.
  const bombCell = variant >= 2 ? [2, center] : [2, 2];
  const projectiles = variant & 1 ? [{ entityId: 200 + variant, ownerSeat: 1,
    cell: [1, 2], direction: "right" }] : [];
  const built = fast.createFastPhysical({ platformFrame: frame, recordIndex: frame,
    map: { width: size, height: size, terrainColumnMajor: map }, tanks: [
      tank(0, [center, center], ["up", "right", "down", "left"][variant & 3]),
      tank(1, [size - 2, size - 2], "left")
    ], projectiles, bombs: [{ entityId: 300 + variant, ownerSeat: 1,
      cell: bombCell, placedFrame: frame, explodeFrame: frame + 5 }], star: null,
    terminalFlags: { timeoutSeat: null, scriptErrorSeat: null } }, shared ? {
    reverseLatticeCacheEntries: 16, reverseLatticeLayerCache: true
  } : {});
  if (!built.state) throw new Error(`invalid HP7 fixture: ${built.errorCode}`);
  const state = built.state; const a = state.arrays;
  const hazard = built.hazard; const hard = built.hard;
  const bundle = { state, kernel: built.kernel, hazard, hard };
  return { state, hazard, hard, bundle, gate: new FinalActionGate(),
    safety: new InformationSafetyClosure(), eo: new EscapeObligation(),
    projectedCell: new Uint16Array(ACTIONS.length),
    projectedDirection: new Uint8Array(ACTIONS.length),
    worldCells: new Uint16Array([a[ARRAY.TANK_CELL][1]]),
    worldMass: new Uint16Array([10000]) };
}

function runPipeline(item) {
  item.gate.evaluate(item.bundle, ACTIONS, ARGUMENTS, ACTIONS.length);
  for (let row = 0; row < ACTIONS.length; row += 1) {
    const at = row * 8;
    item.projectedCell[row] = item.gate.chanceCell[at];
    item.projectedDirection[row] = item.gate.chanceDirection[at];
  }
  item.safety.evaluate(item.bundle, ACTIONS, ACTIONS.length, item.gate.status,
    item.projectedCell, item.projectedDirection, item.worldCells, item.worldMass,
    1, 1, null, 0, item.state.arrays[ARRAY.TANK_DIR][1], 256, 1, 0,
    item.gate.chanceSupportCount, item.gate.chanceFatalSupportCount,
    item.gate.chanceIncompleteSupportCount);
  item.eo.evaluateCommitted(item.bundle, ACTIONS, ARGUMENTS,
    item.projectedCell, item.projectedDirection, item.gate.status, ACTIONS.length);
}

function counters(item) {
  return {
    hardClassifications: item.hard.classifyCount,
    hardReverseQueries: item.hard.reverseQueryCount,
    hardFastAllows: item.hard.fastAllowCount,
    hazardCachedBuildNodes: item.hazard.reverseLatticeBuildNodeCount,
    hazardUncachedBuildNodes: item.hazard.reverseUncachedBuildNodeCount,
    deadlinePrivateBuildNodes: item.eo.deadline.privateReverseBuildNodeCount,
    layerHits: item.hazard.reverseLatticeLayerHitCount,
    layerMisses: item.hazard.reverseLatticeLayerMissCount,
    successorSlabFills: item.eo.successorSlabFillCount
  };
}

function totalBuildNodes(value) {
  return value.hazardCachedBuildNodes + value.hazardUncachedBuildNodes +
    value.deadlinePrivateBuildNodes;
}

function fingerprint(item) {
  return sha(JSON.stringify({ hard: Array.from(item.gate.status),
    safety: Array.from(item.safety.outcome.status),
    member: Array.from(item.eo.member), proof: Array.from(item.eo.successorProof),
    slack: Array.from(item.eo.successorSlack), branches: Array.from(item.eo.successorBranches),
    support: item.eo.supportStatus }));
}

function coldEvidence() {
  const rows = [];
  for (let variant = 0; variant < 4; variant += 1) {
    const legacy = createFixture(9 + variant * 2, variant, false);
    const shared = createFixture(9 + variant * 2, variant, true);
    runPipeline(legacy); runPipeline(shared);
    const before = counters(legacy); const after = counters(shared);
    rows.push({ variant, semanticEqual: fingerprint(legacy) === fingerprint(shared),
      legacy: before, shared: after, legacyBuildNodes: totalBuildNodes(before),
      sharedBuildNodes: totalBuildNodes(after) });
  }
  const legacy = rows.reduce((sum, row) => sum + row.legacyBuildNodes, 0);
  const shared = rows.reduce((sum, row) => sum + row.sharedBuildNodes, 0);
  return { rows, legacyBuildNodes: legacy, sharedBuildNodes: shared,
    reductionBasisPoints: legacy ? Math.floor((legacy - shared) * 10000 / legacy) : 0,
    semanticMismatches: rows.filter(row => !row.semanticEqual).length };
}

function timed(shared) {
  const items = [0, 1, 2, 3].map(variant => createFixture(9 + variant * 2, variant, shared));
  for (const item of items) runPipeline(item);
  const samples = [];
  for (let batch = 0; batch < BATCHES; batch += 1) {
    const start = process.hrtime.bigint();
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1)
      for (const item of items) runPipeline(item);
    const elapsed = Number(process.hrtime.bigint() - start) / (ITERATIONS * items.length);
    samples.push(elapsed);
  }
  return { batches: BATCHES, iterationsPerBatch: ITERATIONS * items.length,
    samplesNanoseconds: samples, p50Nanoseconds: percentile(samples, 0.5),
    p95Nanoseconds: percentile(samples, 0.95),
    hotAllocations: items.reduce((sum, item) => sum + item.eo.hotAllocationCount +
      item.eo.deadline.hotAllocationCount, 0) };
}

const cold = coldEvidence(); const legacy = timed(false); const shared = timed(true);
const report = { schemaVersion: 1, objectKind: "HP7_THREAT_LATTICE_SHARING_BENCHMARK_V1",
  status: cold.semanticMismatches === 0 && cold.reductionBasisPoints >= 4000 &&
    legacy.hotAllocations === 0 && shared.hotAllocations === 0 ? "PASS" : "FAIL",
  node: process.version, source: sourceIdentity(), contract: { batches: BATCHES, iterations: ITERATIONS,
    minimumDuplicateNodeReductionBasisPoints: 4000, semanticMismatchesMaximum: 0,
    hotAllocationsMaximum: 0 }, cold, timing: { legacy, shared,
    p95RatioBasisPoints: Math.floor(shared.p95Nanoseconds * 10000 /
      Math.max(1, legacy.p95Nanoseconds)) } };
report.fingerprint = sha(JSON.stringify(report));
const outputAt = process.argv.indexOf("--output");
if (outputAt >= 0 && process.argv[outputAt + 1]) {
  const target = path.resolve(process.argv[outputAt + 1]);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status !== "PASS") process.exitCode = 1;
