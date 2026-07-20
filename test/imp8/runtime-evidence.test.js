"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRuntimeEvidence, sourceFacts } =
  require("../../tools/agentank/calibration/v1-runtime-evidence");

test("v1 runtime evidence keeps platform time separate from local elapsed time", () => {
  const report = buildRuntimeEvidence();
  assert.equal(report.platformHistory.slowest.frames, 127);
  assert.equal(report.platformHistory.slowest.runtimeMs, 2971);
  assert.equal(report.determinations.localElapsedMillisecondsMayPredictPlatformTimeout, false);
  assert.equal(report.determinations.v1TimeFallbackActivationFromReplay, "UNOBSERVABLE");
  assert.equal(report.determinations.v1GuaranteedFallbackMechanism, "FIXED_NODE_AND_DEPTH_BOUNDS");
  assert.equal(report.sourceControl.unconditionalWorkBounds.rootNodeCap, 128);
  assert.deepEqual(report.sourceControl.unconditionalWorkBounds.normalDecisionRounds, [2, 3]);
});

test("v1 static source parser requires both conditional clock and unconditional bounds", () => {
  const facts = sourceFacts([
    "var AT_MAX_NODES = 128;", "var AT_MC_DISABLE_AFTER_MS = 1000;",
    "var AT_MINIMAX_REDUCE_AFTER_MS = 2250;",
    "return typeof Date === \"function\" && typeof Date.now === \"function\" ? Date.now() : 0;",
    "AT_NODE_LIMIT = Math.max(12, Math.floor(AT_MAX_NODES / actions.length));",
    "state._searchRounds = 2;", "state._searchRounds = tactical ? 3 : 2;"
  ].join("\n"));
  assert.equal(facts.clockGuardReturnsZeroWhenUnavailable, true);
  assert.equal(facts.conditionalTimeControls.minimaxReduceAfterMs, 2250);
  assert.equal(facts.unconditionalWorkBounds.rootNodeCap, 128);
});
