"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionDepthSearch, VALUE_BOUND } = require(
  "../../engine-v2/src/search/production-depth-search");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { RUNTIME_CONFIG } = require("../../engine-v2/src/generated/runtime-config");
const calibration = require("../../tools/agentank/diagnostics/minimax-depth-calibration");
const { PhysicalMaximinPoc } = require(
  "../../tools/agentank/diagnostics/windowed-maximin-poc");

function rootSpec(prepared) {
  return { ourActions: prepared.engine.ourActions,
    ourArguments: prepared.engine.ourArguments, ourCount: prepared.ourCount,
    enemyActions: prepared.engine.enemyActions,
    enemyArguments: prepared.engine.enemyArguments, enemyCount: prepared.engine.enemyCount };
}

function candidate(index, risk, budget) {
  const prepared = calibration.preparedScenario(index, true);
  const search = new ProductionDepthSearch(new ProductionCacheBank(), RUNTIME_CONFIG,
    prepared.engine.rootTransitions, { selectiveContinuationEnabled: true,
      crossFramePVEnabled: true, diagnosticNodeCapacity: budget,
      windowedBoundsEnabled: true });
  search.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 3, budget, risk);
  return { prepared, search };
}

test("HP28 completed fixed-stack window proofs match the independent exact oracle", () => {
  let checked = 0;
  for (const risk of [0, 50, 100]) {
    for (let index = 0; index < 16; index += 1) {
      const exactPrepared = calibration.preparedScenario(index, true);
      const exact = new PhysicalMaximinPoc(exactPrepared.bundle,
        rootSpec(exactPrepared), risk).rootExact(3);
      const actual = candidate(index, risk, 4096);
      if (actual.search.selectiveCompletedDepth !== 3) continue;
      assert.equal(actual.prepared.engine.ourActions[actual.search.selectiveBestRow],
        exactPrepared.engine.ourActions[exact.bestRow], `risk=${risk} index=${index}`);
      assert.equal(actual.prepared.engine.ourArguments[actual.search.selectiveBestRow],
        exactPrepared.engine.ourArguments[exact.bestRow], `risk=${risk} index=${index}`);
      assert.equal(actual.search.selectiveBestValue, exact.value,
        `risk=${risk} index=${index}`);
      assert.equal(actual.search.rootRestoreFailures, 0);
      checked += 1;
    }
  }
  // The accepted vacated-start rule deliberately excludes a blocked vacate:
  // an action token of GO is not evidence that the tank can actually leave.
  // Dedicated joint-vacated-follow fixtures own that rule contract; this
  // fixed-stack census therefore remains at 27 completed proofs.
  assert.equal(checked, 27);
});

test("HP28 bounds stay intervals and never become exact StageMatrix cells", () => {
  const actual = candidate(1, 50, 512); const search = actual.search;
  assert.equal(search.selectiveCompletedDepth, 3);
  assert.ok(search.windowBoundReturnCount > 0);
  assert.ok(Array.from(search.iterationCellBound).some(bound => bound === VALUE_BOUND.LOWER ||
    bound === VALUE_BOUND.UPPER));
  assert.equal(search.representativeSupportDepth, 2,
    "the exact P2 StageMatrix remains the value owner");
  assert.equal(search.rootRestoreFailures, 0);
});
