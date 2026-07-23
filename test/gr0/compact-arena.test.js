"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ROOT_STATUS } = require("../../engine-v2/src/runtime/production-root");
const { HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { RUNTIME_MODE } = require("../../engine-v2/src/abi/cache-runtime-codes");
const { rootFlag, SAMPLE_FRAME_STRIDE } =
  require("../../tools/agentank/simulation/production-diagnostic-bot");
const { analysisSummary, scenarioInventory, SampleCollector } =
  require("../../tools/agentank/diagnostics/v1-v2-working-arena");

function compactMatch(id, outcome, category, cohort = "ROLLING_DISCOVERY") {
  return {
    matchId: id,
    historicalMatchUrlId: id.split(":")[0],
    family: "NATIVE",
    repetition: 0,
    cohort,
    variantId: id.includes("seat1") ? "NATIVE_V1_SEAT0" : "NATIVE_V2_SEAT0",
    analysisOutcome: outcome,
    terminalCategory: category,
    v1: { actionCounts: {} },
    v2: {
      timeoutCount: 0,
      errorCount: 0,
      actionCounts: {},
      layerTotals: {
        avoidableHardRejects: 0,
        riskDominatedSelections: 0,
        rootRestoreFailures: 0,
        stageMatrixSolves: 1,
        escapeRestrictions: 0,
        escapeRescueOverrides: 0,
        noAcceptableActions: 0
      }
    }
  };
}

test("GR0 compact root flags encode all four statuses without collision", () => {
  assert.deepEqual([
    rootFlag(ROOT_STATUS.OK),
    rootFlag(ROOT_STATUS.INCOMPLETE),
    rootFlag(ROOT_STATUS.INVALID),
    rootFlag(ROOT_STATUS.CAPACITY)
  ], [0, 1, 2, 3]);
  const encoded = rootFlag(ROOT_STATUS.CAPACITY) |
    (HARD_STATUS.INCOMPLETE << 2) |
    (PROOF_STATUS.PROVEN << 4) |
    (RUNTIME_MODE.EMERGENCY << 6);
  assert.equal(encoded & 3, 3);
  assert.equal((encoded >>> 2) & 3, HARD_STATUS.INCOMPLETE);
  assert.equal((encoded >>> 4) & 3, PROOF_STATUS.PROVEN);
  assert.equal((encoded >>> 6) & 3, RUNTIME_MODE.EMERGENCY);
});

test("GR0 runtime-independent summary gives draws half a win and pairs seat swaps", () => {
  const matches = [
    compactMatch("scenario-a:seat0", "V2_WIN", "SINGLE_CRASH", "FIXED_266"),
    compactMatch("scenario-a:seat1", "DRAW", "FRAME_LIMIT_EQUAL_STARS", "FIXED_266")
  ];
  const summary = analysisSummary(matches);
  assert.equal(summary.analysisV2Wins, 1);
  assert.equal(summary.analysisDraws, 1);
  assert.equal(summary.scoreRatePer10000, 7500);
  assert.equal(summary.fixedMatchCount, 2);
  assert.equal(summary.fixedV2SingleCrashWins, 1);
  assert.equal(summary.pairs.V2_WIN_DRAW, 1);
});

test("GR0 scenario inventory fingerprints array-valued starts and star sequences", () => {
  const inventory = scenarioInventory([
    { mapHash: "map-a", starts: [[1, 1], [2, 2]], stars: [[3, 3, 1]] },
    { mapHash: "map-a", starts: [[1, 1], [2, 2]], stars: [[4, 4, 1]] },
    { mapHash: "map-b", starts: [[2, 2], [1, 1]], stars: [[4, 4, 1]] }
  ]);
  assert.deepEqual(inventory, { scenarios: 3, maps: 2, starts: 2, stars: 2 });
});

test("GR0 diagnostic sampling converts fixed TypedArray frames only for selected matches", () => {
  const before = compactMatch("scenario-a:seat0", "V1_WIN", "SINGLE_CRASH");
  const baseline = { records: new Map([[before.matchId, before]]) };
  const collector = new SampleCollector(baseline, new Set(["scenario-a"]));
  const current = compactMatch("scenario-a:seat0", "V2_WIN", "SINGLE_CRASH");
  const words = new Int32Array(SAMPLE_FRAME_STRIDE);
  for (let index = 0; index < words.length; index += 1) words[index] = index - 4;
  const raw = { v2: { sampleFrameWords: words, sampleFrameCount: 1,
    sampleFrameStride: SAMPLE_FRAME_STRIDE } };
  collector.consider(raw, current);
  assert.equal(collector.values().length, 1);
  const sample = collector.values()[0];
  assert.equal(sample.frameData.count, 1);
  assert.equal(sample.frameData.stride, SAMPLE_FRAME_STRIDE);
  assert.equal(sample.frameData.fields.length, SAMPLE_FRAME_STRIDE);
  const decoded = Buffer.from(sample.frameData.data, "base64");
  const values = [];
  for (let index = 0; index < SAMPLE_FRAME_STRIDE; index += 1)
    values.push(decoded.readInt32LE(index * 4));
  assert.deepEqual(values, Array.from(words));
  assert.equal(raw.v2.sampleFrameWords, undefined);
  assert.ok(sample.categories.includes("V1_WIN_TO_V2_WIN"));
});
