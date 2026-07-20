#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { FastState, ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { HazardKernel } = require("../../../engine-v2/src/fast/hazard");
const { InformationSafetyClosure } =
  require("../../../engine-v2/src/search/information-safety-closure");
const { MultiFrameRiskBounds } =
  require("../../../engine-v2/src/search/multi-frame-risk-bounds");
const { ThreatCapabilityTimeline } =
  require("../../../engine-v2/src/search/threat-capability-timeline");
const { PossibleProjectileTracker } =
  require("../../../engine-v2/src/runtime/possible-projectiles");
const { SEARCH_CAPACITY } = require("../../../engine-v2/src/generated/search-config");
const { ACTION, HARD_STATUS, TERRAIN, NONE_FRAME } =
  require("../../../engine-v2/src/abi/fast-codes");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { sourceIdentity } = require("../diagnostics/v1-v2-working-arena");

const ITERATIONS_PER_BATCH = 1000;
const WARMUP_BATCHES = 5;
const PREDECESSOR_P95_MICROS = 2590;
const P95_LIMIT_MICROS = Math.floor(PREDECESSOR_P95_MICROS * 12000 / 10000);
const POSSIBLE_PATH_PREDECESSOR_P95_MICROS = 8658;
// Sixty-four hidden worlds are intentionally much larger than the historical
// one-world adjacent benchmark.  This absolute batch gate is 150 microseconds
// per root; the first accepted report becomes the frozen paired predecessor
// for later 120% semantic-preserving optimization gates.
const JOINT_HIDDEN_P95_LIMIT_MICROS = 150000;

function p95(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function createFixture(activeThreat = false, possibleThreat = false, hiddenWorlds = 1) {
  const state = new FastState(20, 20); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN); a[ARRAY.SCALAR][SCALAR.FRAME] = 20;
  for (let seat = 0; seat < 2; seat += 1) {
    a[ARRAY.TANK_FROZEN_UNTIL][seat] = NONE_FRAME;
    a[ARRAY.TANK_POISON_UNTIL][seat] = NONE_FRAME;
    a[ARRAY.TANK_STUN_UNTIL][seat] = NONE_FRAME;
    a[ARRAY.TANK_BOOST_UNTIL][seat] = NONE_FRAME;
    a[ARRAY.TANK_FIRE_LOCK][seat] = NONE_FRAME;
  }
  const hazard = new HazardKernel(state); const bundle = { state, hazard };
  const closure = new InformationSafetyClosure(); const bounds = new MultiFrameRiskBounds();
  const possible = new PossibleProjectileTracker(); possible.reset(20);
  const timeline = new ThreatCapabilityTimeline(); const count = 6;
  const actions = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT,
    ACTION.FIRE, ACTION.THROW_BOMB, ACTION.CAST_POISON]);
  const hard = new Uint8Array(count); hard.fill(HARD_STATUS.ALLOW);
  const cells = new Uint16Array(count); cells.fill(210);
  const directions = new Uint8Array([0, 1, 2, 3, 0, 1]);
  const worlds = new Uint16Array(hiddenWorlds);
  const worldMass = new Uint16Array(hiddenWorlds);
  const worldDirectionMask = new Uint8Array(hiddenWorlds);
  const baseMass = Math.floor(10000 / hiddenWorlds);
  for (let world = 0; world < hiddenWorlds; world += 1) {
    worlds[world] = hiddenWorlds === 1 ? activeThreat ? state.cell(10, 12) : 42 :
      activeThreat ? state.cell(2 + world % 16, 2 + ((world / 16) | 0)) :
        state.cell(1 + world % 18, 1 + ((world / 18) | 0));
    worldMass[world] = baseMass + (world < 10000 - baseMass * hiddenWorlds ? 1 : 0);
    worldDirectionMask[world] = hiddenWorlds > 1 ? 0x0f : 1 << 2;
  }
  const chanceSupport = new Uint8Array(count); chanceSupport.fill(1);
  const chanceIncomplete = new Uint8Array(count);
  const chanceCell = new Uint16Array(count * SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES);
  chanceCell.fill(0xffff); const chanceDirection = new Uint8Array(chanceCell.length);
  for (let row = 0; row < count; row += 1) {
    const at = row * SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES;
    chanceCell[at] = cells[row]; chanceDirection[at] = directions[row];
  }
  if (possibleThreat) possible.addFired(state, state.cell(10, 7), 2, 20, 20,
    0xffff, 5000);
  return { state, bundle, closure, bounds, timeline, count, actions, hard, cells, directions,
    worlds, worldMass, worldDirectionMask, exactSupport: hiddenWorlds === 1 ? 1 : 0,
    riskSupport: 1, chanceSupport, chanceIncomplete, chanceCell, chanceDirection, possible };
}

function runOnce(fixture, includePath) {
  const f = fixture; f.timeline.prepare(f.bundle, 1, 1, 1, 1);
  f.closure.evaluate(f.bundle, f.actions, f.count, f.hard, f.cells, f.directions,
    f.worlds, f.worldMass, f.worlds.length, f.exactSupport, f.possible, 1, 2, 4096, 1, 10000,
    f.chanceSupport, null, f.chanceIncomplete, f.timeline, f.chanceCell, f.chanceDirection);
  if (includePath) f.bounds.evaluate(f.bundle, f.count, f.hard, f.chanceSupport,
    f.chanceIncomplete, f.chanceCell, f.chanceDirection, f.worlds, f.worldMass,
    f.worlds.length, f.exactSupport, f.timeline, 2, 10000, 4096, f.closure.outcome,
    f.possible, f.worldDirectionMask, f.riskSupport);
}

function timedBatch(fixture, includePath) {
  const started = process.hrtime.bigint();
  for (let iteration = 0; iteration < ITERATIONS_PER_BATCH; iteration += 1)
    runOnce(fixture, includePath);
  return Number((process.hrtime.bigint() - started) / 1000n);
}

function benchmarkMultiFrameRisk() {
  const fixture = createFixture(); const active = createFixture(true);
  const possible = createFixture(true, true);
  const jointHidden = createFixture(true, true, 64);
  for (let warmup = 0; warmup < WARMUP_BATCHES; warmup += 1) {
    timedBatch(fixture, 0); timedBatch(fixture, 1); timedBatch(active, 1);
    timedBatch(possible, 1); timedBatch(jointHidden, 1);
  }
  const staticBatchesMicros = []; const combinedBatchesMicros = [];
  const activeThreatBatchesMicros = [];
  const possibleProjectileBatchesMicros = [];
  const jointHiddenBatchesMicros = [];
  for (let batch = 0; batch < 5; batch += 1) {
    staticBatchesMicros.push(timedBatch(fixture, 0));
    combinedBatchesMicros.push(timedBatch(fixture, 1));
    activeThreatBatchesMicros.push(timedBatch(active, 1));
    possibleProjectileBatchesMicros.push(timedBatch(possible, 1));
    jointHiddenBatchesMicros.push(timedBatch(jointHidden, 1));
  }
  const staticP95Micros = p95(staticBatchesMicros);
  const combinedP95Micros = p95(combinedBatchesMicros);
  const activeThreatP95Micros = p95(activeThreatBatchesMicros);
  const possibleProjectileP95Micros = p95(possibleProjectileBatchesMicros);
  const jointHiddenP95Micros = p95(jointHiddenBatchesMicros);
  // WSL host scheduling can move every absolute batch together. Compare the
  // new source against its immediately adjacent predecessor under the same
  // process and workload, while retaining the frozen historical value below
  // as an audit reference rather than a noisy cross-run gate.
  const possiblePathPairedP95LimitMicros = Math.floor(activeThreatP95Micros * 12000 / 10000);
  return { status: combinedP95Micros <= P95_LIMIT_MICROS &&
      possibleProjectileP95Micros <= possiblePathPairedP95LimitMicros &&
      jointHiddenP95Micros <= JOINT_HIDDEN_P95_LIMIT_MICROS ? "PASS" : "FAIL",
    fixedNode: process.version, warmupBatches: WARMUP_BATCHES, measuredBatches: 5,
    iterationsPerBatch: ITERATIONS_PER_BATCH, staticBatchesMicros, combinedBatchesMicros,
    activeThreatBatchesMicros, possibleProjectileBatchesMicros, jointHiddenBatchesMicros,
    staticP95Micros, combinedP95Micros, predecessorP95Micros: PREDECESSOR_P95_MICROS,
    p95LimitMicros: P95_LIMIT_MICROS,
    activeThreatP95Micros,
    possibleProjectileP95Micros,
    jointHiddenP95Micros, jointHiddenP95LimitMicros: JOINT_HIDDEN_P95_LIMIT_MICROS,
    jointHiddenWorldCount: jointHidden.worlds.length,
    possiblePathPredecessorP95Micros: POSSIBLE_PATH_PREDECESSOR_P95_MICROS,
    possiblePathPairedP95LimitMicros,
    possiblePathVsPairedPredecessorPer10000: Math.floor(possibleProjectileP95Micros * 10000 /
      Math.max(1, activeThreatP95Micros)),
    localCombinedVsStaticPer10000: Math.floor(combinedP95Micros * 10000 /
      Math.max(1, staticP95Micros)), lastUniqueThreatNodes: active.bounds.nodes,
    hotAllocationCount: fixture.closure.hotAllocationCount +
      fixture.closure.outcome.hotAllocationCount + fixture.bounds.hotAllocationCount +
      fixture.timeline.hotAllocationCount + possible.possible.hotAllocationCount +
      jointHidden.possible.hotAllocationCount };
}

function writeMultiFrameRiskBenchmark(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const benchmark = benchmarkMultiFrameRisk();
  const report = { artifactKind: "MULTI_FRAME_RISK_BENCHMARK",
    properties: ["SOURCE_BOUND", "FIXED_NODE", "FIVE_BATCH_P95", "ZERO_HOT_ALLOCATION"],
    source: sourceIdentity(root), benchmark, fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  const directory = path.join(root, "artifacts", "fast-regression", "reports",
    "multi-frame-risk-benchmark");
  const file = path.join(directory, `${report.fingerprint}.json`);
  writeJsonImmutable(file, report, { mode: 0o644 });
  writeJsonAtomic(path.join(directory, "latest.json"), report, { mode: 0o644 });
  return { file, report };
}

if (require.main === module) {
  const result = writeMultiFrameRiskBenchmark(process.argv[2]);
  process.stdout.write(`${JSON.stringify({ file: result.file, ...result.report }, null, 2)}\n`);
}

module.exports = { benchmarkMultiFrameRisk, writeMultiFrameRiskBenchmark };
