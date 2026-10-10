"use strict";

// Explicit candidate entry. The ordinary production-entry intentionally does
// not import this module, so the accepted default bundle remains BasePolicy-off.
const { ProductionRootEngine } = require("./production-root");
const { NativeBasePolicyRoot, NATIVE_BASE_POLICY_PROFILE } = require(
  "../base-policy");

const nativeBasePolicyRoot = new NativeBasePolicyRoot();
const persistentRoot = new ProductionRootEngine({ nativeBasePolicyRoot });

function runProductionFixture(seed = 1) {
  const result = new Int32Array(12);
  result[0] = seed | 0;
  result[1] = nativeBasePolicyRoot.policySearch.targetDepth;
  result[2] = nativeBasePolicyRoot.policySearch.nodeBudget;
  result[3] = nativeBasePolicyRoot.leafEvaluator.starFieldCacheEntries;
  result[4] = nativeBasePolicyRoot.leafEvaluator.precomputeGeometry ? 1 : 0;
  result[5] = nativeBasePolicyRoot.owner.riskFrontierMode === "joint" ? 1 : 0;
  result[6] = nativeBasePolicyRoot.owner.riskSoftBandMode === "intent-known" ? 1 : 0;
  result[7] = nativeBasePolicyRoot.owner.intentValueMode === "bonus" ? 1 : 0;
  result[8] = persistentRoot.nativeBasePolicyRoot ? 1 : 0;
  result[9] = persistentRoot.nativeBasePolicyRootCheckCount;
  result[10] = persistentRoot.nativeBasePolicyRootOverrideCount;
  result[11] = NATIVE_BASE_POLICY_PROFILE.id === "BP68_EXACT_NATIVE_CACHE2" ? 1 : 0;
  return result;
}

function onIdle(me, enemy, game) {
  return persistentRoot.decide(me, enemy, game);
}

module.exports = { onIdle, runProductionFixture };
