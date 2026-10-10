"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PROFILE, benchmark } = require(
  "../../tools/agentank/benchmark/stun-direct-schedule-benchmark");

test("HP21 benchmark alternates profiles and accounts exact owner depth", () => {
  const report = benchmark({ scenarioCount: 2, warmupBatches: 0, measuredBatches: 1 });
  assert.equal(report.status, "PASS");
  assert.equal(report.callsPerProfile, 2);
  assert.equal(report.profileOrder, "ALTERNATING_PER_SCENARIO_AND_BATCH");
  assert.equal(report.summaries[PROFILE.LEGACY].calls, 2);
  assert.equal(report.summaries[PROFILE.DIRECT].calls, 2);
  assert.equal(report.summaries[PROFILE.LEGACY].directStunRoots, 0);
  assert.equal(report.summaries[PROFILE.DIRECT].directStunRoots, 0,
    "the fixed broad roots must remain on the legacy schedule");
  assert.ok(report.comparison.supportDepthGain >= 0);
  assert.equal(report.comparison.supportDepthLoss, 0);
  assert.equal(report.comparison.nodeDelta, 0);
});
