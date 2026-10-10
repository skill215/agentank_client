"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classifyAnalysisOutcome } = require("../../tools/agentank/analysis/analysis-outcome");
const { analyzeFixedCohort, verifyHistoricalCandidate } =
  require("../../tools/agentank/structural/sr0");

const root = path.resolve(__dirname, "../..");
const baseline = JSON.parse(fs.readFileSync(path.join(root,
  "config/engine-v2/structural-repair-baseline.json")));

test("SR0 classifies equal-star frame limit and mutual crash as analysis draws", () => {
  const base = { seatImplementations: ["v1", "v2"], counts: { stars: [2, 2], crashes: [0, 0] },
    result: { winnerSeat: 0, winnerImplementation: "v1", reason: "frameLimit" } };
  assert.equal(classifyAnalysisOutcome(base).analysisOutcome, "DRAW");
  base.counts.crashes = [1, 1]; base.result.reason = "crashed";
  assert.equal(classifyAnalysisOutcome(base).analysisOutcome, "DRAW");
});

test("SR0 fixed cohort derives the exact runtime-independent W L D and seat-pair denominator", () => {
  const report = analyzeFixedCohort(root, baseline);
  assert.deepEqual(report.analysisCounts, { V1_WIN: 907, V2_WIN: 1029, DRAW: 192 });
  assert.deepEqual(report.seatPairs, { V2_SWEEP: 238, V1_SWEEP: 186, SPLIT: 464,
    V2_WIN_DRAW: 89, V1_WIN_DRAW: 71, DOUBLE_DRAW: 16 });
  assert.equal(report.terminalCategories.FRAME_LIMIT_EQUAL_STARS, 161);
  assert.equal(report.terminalCategories.MUTUAL_CRASH_EQUAL_STARS, 31);
  assert.equal(report.rawPlatform.unchanged, true);
  assert.equal(report.rawPlatform.verificationMode, "RETAINED_ACCEPTANCE_ATTESTATION");
  assert.equal(report.rawPlatform.sourcePayloadRetained, false);
});

test("SR0 preserves rejected historical Candidate bytes and denies their publish identity", () => {
  const identity = verifyHistoricalCandidate(root, baseline);
  assert.equal(identity.status, "PASS"); assert.equal(identity.immutable, true);
  assert.equal(identity.publishEligible, false); assert.equal(identity.historicalImp9Status, "REJECTED");
});
