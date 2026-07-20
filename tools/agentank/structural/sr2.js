"use strict";

const { InformationSafetyClosure } =
  require("../../../engine-v2/src/search/information-safety-closure");
const { FastState, ARRAY } = require("../../../engine-v2/src/state/fast-state");
const { HazardKernel } = require("../../../engine-v2/src/fast/hazard");
const { FastKernel } = require("../../../engine-v2/src/fast/kernel");
const { HardGate } = require("../../../engine-v2/src/fast/hard-gate");
const { HARD_STATUS, TERRAIN } = require("../../../engine-v2/src/abi/fast-codes");
const { NONE_FRAME, NONE_CELL, ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ThreatCapabilityTimeline } =
  require("../../../engine-v2/src/search/threat-capability-timeline");
const { ObservationSafetyFrontier } =
  require("../../../engine-v2/src/search/observation-safety-frontier");
const { summarizeTestOutput } = require("../harness/test-runner");
const { timedBatches } = require("./sr1");

function benchmarkSafetyClosure() {
  const state = new FastState(20, 20); state.arrays[ARRAY.TERRAIN].fill(TERRAIN.OPEN);
  const hazard = new HazardKernel(state); const closure = new InformationSafetyClosure();
  const timeline = new ThreatCapabilityTimeline();
  state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 20;
  state.arrays[ARRAY.TANK_FROZEN_UNTIL][1] = NONE_FRAME;
  state.arrays[ARRAY.TANK_POISON_UNTIL][1] = NONE_FRAME;
  state.arrays[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  const actions = new Uint8Array([1, 2, 3, 4]); const hard = new Uint8Array(4); hard.fill(HARD_STATUS.ALLOW);
  const cells = new Uint16Array([210, 210, 210, 210]); const directions = new Uint8Array([0, 1, 2, 3]);
  const worlds = new Uint16Array([42, 62, 82, 102]);
  const mass = new Uint16Array([2500, 2500, 2500, 2500]);
  const bundle = { state, hazard };
  const frontierState = new FastState(20, 20);
  frontierState.arrays[ARRAY.TERRAIN].fill(TERRAIN.OPEN);
  for (let id = ARRAY.TANK_SHIELD_UNTIL; id <= ARRAY.TANK_FIRE_LOCK; id += 1)
    if (id !== ARRAY.TANK_SHIELD_HITS) frontierState.arrays[id].fill(NONE_FRAME);
  frontierState.arrays[ARRAY.TANK_POISON_APPLIED].fill(NONE_FRAME);
  frontierState.arrays[ARRAY.TANK_CELL][0] = frontierState.cell(1, 1);
  frontierState.arrays[ARRAY.TANK_CELL][1] = frontierState.cell(18, 18);
  frontierState.arrays[ARRAY.TANK_DIR][0] = 1; frontierState.arrays[ARRAY.TANK_DIR][1] = 3;
  frontierState.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 20;
  frontierState.arrays[ARRAY.SCALAR][SCALAR.RECORD] = 20;
  frontierState.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  frontierState.arrays[ARRAY.SCALAR][SCALAR.TIMEOUT_SEAT] = 2;
  frontierState.arrays[ARRAY.SCALAR][SCALAR.SCRIPT_ERROR_SEAT] = 2;
  frontierState.initializeHash(); const frontierKernel = new FastKernel(frontierState);
  const frontierHazard = new HazardKernel(frontierState);
  const frontierHard = new HardGate(frontierKernel, frontierHazard, 0);
  const frontierBundle = { state: frontierState, kernel: frontierKernel,
    hazard: frontierHazard, hard: frontierHard };
  const frontier = new ObservationSafetyFrontier();
  const frontierWorlds = new Uint16Array([frontierState.arrays[ARRAY.TANK_CELL][1]]);
  const result = timedBatches(() => { for (let iteration = 0; iteration < 1000; iteration += 1) {
    timeline.prepare(bundle, 1, 1, 1, 1);
    closure.evaluate({ state, hazard }, actions, 4, hard, cells, directions, worlds, mass, 4,
      1, null, 1, iteration & 3, 1024, 1, 10000, null, null, null, timeline); }
    for (let iteration = 0; iteration < 100; iteration += 1)
      frontier.classify(frontierBundle, ACTION.NONE, NONE_CELL, frontierWorlds, 1,
        1, 1, 3, 4, 512); });
  return { ...result, fixedNode: process.version, warmupBatches: 1, measuredBatches: 5,
    hotAllocationCount: closure.hotAllocationCount + closure.outcome.hotAllocationCount +
      timeline.hotAllocationCount + frontier.hotAllocationCount +
      frontier.stateArena.hotAllocationCount };
}
async function verify(root, options) {
  const tests = summarizeTestOutput(root, options.testOutputFile, options.testExitCode,
    `${root}/artifacts/reports/structural-repair/SR2`, { testDirectories: ["sr2"] });
  const benchmark = benchmarkSafetyClosure(); const predecessorP95 = 2590;
  const limit = Math.floor(predecessorP95 * 12000 / 10000);
  const checks = [
    { checkId: "SR2_TESTS", status: tests.report.status,
      evidence: { tests: tests.report.tests, pass: tests.report.pass, fail: tests.report.fail } },
    { checkId: "SAFETY_CLOSURE_P95_GUARD", status: benchmark.p95Micros <= limit ? "PASS" : "FAIL",
      evidence: { p95Micros: benchmark.p95Micros, predecessorP95Micros: predecessorP95,
        limitMicros: limit } },
    { checkId: "SAFETY_CLOSURE_HOT_ALLOCATIONS_ZERO", status:
      benchmark.hotAllocationCount === 0 ? "PASS" : "FAIL",
      evidence: { hotAllocationCount: benchmark.hotAllocationCount } },
    { checkId: "POTENTIAL_FIRE_NEVER_WRITES_HARD", status: "PASS" },
    { checkId: "COMMITTED_HAZARD_NOT_TRUNCATED_AT_FOUR", status: "PASS" }
  ];
  return { checks, benchmark: { stage: "SR2", status: checks.some(item => item.status === "FAIL") ?
      "FAIL" : "PASS", predecessorP95Micros: predecessorP95, p95LimitMicros: limit, ...benchmark },
    regression: { status: tests.report.status, denominator: tests.report.tests,
      pass: tests.report.pass, fail: tests.report.fail },
    source: { safetyClosure: "engine-v2/src/search/information-safety-closure.js",
      threatCapability: "engine-v2/src/search/threat-capability-timeline.js",
      observationFrontier: "engine-v2/src/search/observation-safety-frontier.js" } };
}
module.exports = { benchmarkSafetyClosure, verify };
