"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { instrumentV1PolicyValues, instrumentV1DeterministicPolicyOracle } = require(
  "../../tools/agentank/diagnostics/v1-policy-value-instrumentation");

test("V1 policy value instrumentation is behavior-neutral assignment", () => {
  const source = "before\n  applyMonteCarloLeafExtension(state, evaluated, hasSafeAction);\nafter";
  const instrumented = instrumentV1PolicyValues(source);
  assert.match(instrumented, /state\._v3PolicyEvaluated = evaluated/);
  assert.match(instrumented,
    /state\._v3PolicyTransitionCensus = v3CapturePolicyTransitions/);
  assert.match(instrumented, /function v3CapturePolicyTransitions/);
  assert.equal((instrumented.match(/applyMonteCarloLeafExtension/g) || []).length, 1);
});

test("V1 policy instrumentation captures the selected persistent intent", () => {
  const source = `  applyMonteCarloLeafExtension(state, evaluated, hasSafeAction);
  return bestAction;
}

function armedOverloadForcesNextFrameLoss`;
  const instrumented = instrumentV1PolicyValues(source);
  assert.match(instrumented,
    /evaluated\._v3SelectedIntent = state\._selectedIntent/);
  assert.match(instrumented,
    /snapshot\.ownTacticalActions = tacticalActions\(next, true\)\.slice\(\)/);
  assert.match(instrumented,
    /snapshot\.enemyTacticalActions = tacticalActions\(next, false\)\.slice\(\)/);
  assert.match(instrumented, /deepSampleLimitPerRootAction: 2/);
  assert.match(instrumented, /deepSampleCountByRootAction\[sampleKey\]/);
});

test("deterministic policy oracle removes wall-clock fallback only", () => {
  const source = `before
  applyMonteCarloLeafExtension(state, evaluated, hasSafeAction);
after
function runtimeClockMs() {
  return typeof Date === "function" && typeof Date.now === "function" ?
    Date.now() : 0;
}`;
  const instrumented = instrumentV1DeterministicPolicyOracle(source);
  assert.match(instrumented, /state\._v3PolicyEvaluated = evaluated/);
  assert.match(instrumented, /function runtimeClockMs\(\) \{\n  return 0;\n\}/);
  assert.doesNotMatch(instrumented, /Date\.now/);
});

test("V1 policy value instrumentation requires one exact anchor", () => {
  assert.throws(() => instrumentV1PolicyValues("missing"),
    /V1_POLICY_VALUE_INSTRUMENTATION_ANCHOR/);
});
