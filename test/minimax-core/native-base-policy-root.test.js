"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { NativeBasePolicyRoot, NATIVE_BASE_POLICY_PROFILE,
  NativeBasePolicyActionOwner, NativeBasePolicyActionDomain,
  NativeBasePolicyStrategicIntent, NativeBasePolicyOpponentHistory,
  NativeBasePolicySearch, NativeBasePolicyLeafEvaluator,
  NativeBasePolicyPathUtility } = require("../../engine-v2/src/base-policy");
const { ProductionRootEngine } = require(
  "../../engine-v2/src/runtime/production-root");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");

test("native base-policy root binds one shared BP68 component graph", () => {
  const root = new NativeBasePolicyRoot();
  assert.ok(root.owner instanceof NativeBasePolicyActionOwner);
  assert.ok(root.domain instanceof NativeBasePolicyActionDomain);
  assert.ok(root.intent instanceof NativeBasePolicyStrategicIntent);
  assert.ok(root.opponentHistory instanceof NativeBasePolicyOpponentHistory);
  assert.ok(root.policySearch instanceof NativeBasePolicySearch);
  assert.ok(root.leafEvaluator instanceof NativeBasePolicyLeafEvaluator);
  assert.ok(root.pathUtility instanceof NativeBasePolicyPathUtility);
  assert.equal(root.owner.domain, root.domain);
  assert.equal(root.owner.intent, root.intent);
  assert.equal(root.owner.opponentHistory, root.opponentHistory);
  assert.equal(root.owner.policySearch, root.policySearch);
  assert.equal(root.policySearch.deepFireDomain, root.domain);
  assert.equal(root.policySearch.leafEvaluator, root.leafEvaluator);
  assert.equal(root.policySearch.pathUtility, root.pathUtility);
  assert.equal(root.pathUtility.leaf, root.leafEvaluator);
  assert.deepEqual(Object.values(root).filter(ArrayBuffer.isView), []);
});

test("native base-policy root freezes the validated BP68 performance profile", () => {
  const root = new NativeBasePolicyRoot(); const search = root.policySearch;
  assert.equal(NATIVE_BASE_POLICY_PROFILE.id, "BP68_EXACT_NATIVE_CACHE2");
  assert.equal(Object.isFrozen(NATIVE_BASE_POLICY_PROFILE), true);
  assert.equal(search.targetDepth, 3);
  assert.equal(search.depthSchedule, "v1-state");
  assert.equal(search.nodeBudget, 128);
  assert.equal(search.blendBasisPoints, 2000);
  assert.equal(search.fullPrimitiveDomain, true);
  assert.equal(search.deepFireMode, "v1-own");
  assert.equal(search.deepSkillMode, 3);
  assert.equal(search.deepDomainMode, "v1-shaped");
  assert.equal(search.opponentMode, "v1-exact");
  assert.equal(search.v1StunCountdown, true);
  assert.equal(search.v1EntryProjectileCollision, true);
  assert.equal(search.rootDomainMode, "v1-shaped");
  assert.equal(search.rootEnemyDomainMode, "v1-shaped");
  assert.equal(search.rootColumnOrder, "v1");
  assert.equal(search.terminalMode, "v1");
  assert.equal(search.ownChanceMode, "v1-deterministic");
  assert.equal(search.superkoMode, "v1");
  assert.equal(root.leafEvaluator.starFieldCacheEntries, 2);
  assert.equal(root.leafEvaluator.precomputeGeometry, true);
  assert.equal(root.pathUtility.exactFireTransition, true);
  assert.equal(root.pathUtility.goEdgeTransition, true);
  assert.equal(root.owner.riskFrontierMode, "joint");
  assert.equal(root.owner.riskSoftBandMode, "intent-known");
  assert.equal(root.owner.intentValueMode, "bonus");
});

test("native base-policy root has no diagnostic or V1 VM dependency", () => {
  const file = path.resolve(__dirname,
    "../../engine-v2/src/base-policy/native-root.js");
  const source = fs.readFileSync(file, "utf8");
  assert.equal(source.includes("tools/agentank/diagnostics"), false);
  assert.equal(source.includes("V3DiagnosticBot"), false);
  assert.equal(source.includes("native-v1-"), false);
  assert.equal(source.includes("new Uint"), false);
  assert.equal(source.includes("new Int"), false);
  assert.equal(source.includes("new Float"), false);
});

test("production hook is default-off and preserves non-poison resource ownership", () => {
  const productionRootSource = fs.readFileSync(path.resolve(__dirname,
    "../../engine-v2/src/runtime/production-root.js"), "utf8");
  assert.equal(productionRootSource.includes('require("../base-policy")'), false);
  assert.equal(productionRootSource.includes("new NativeBasePolicyRoot"), false);
  const off = new ProductionRootEngine();
  assert.equal(off.basePolicyOwnsViableCommitted, undefined);
  assert.equal(off.nativeBasePolicyRoot, null);
  assert.equal(off.selectNativeBasePolicy(ACTION.GO, 0), null);
  assert.equal(off.nativeBasePolicyRootCheckCount, 0);

  const calls = [];
  const proposal = { action: ACTION.FIRE, argument: 0xffff, row: 2 };
  const root = { selectOverride(engine, selected, action, argument) {
    calls.push([engine, selected, action, argument]); return proposal;
  } };
  const active = new ProductionRootEngine({ nativeBasePolicyRoot: root });
  active.lastSelectedIndex = 3;
  assert.equal(active.selectNativeBasePolicy(ACTION.CAST_STUN, 0xffff), null);
  assert.equal(active.nativeBasePolicyRootResourceSkipCount, 1);
  assert.equal(active.nativeBasePolicyRootCheckCount, 0);
  assert.equal(calls.length, 0);
  assert.equal(active.selectNativeBasePolicy(ACTION.GO, 17), proposal);
  assert.equal(active.nativeBasePolicyRootCheckCount, 1);
  assert.deepEqual(calls[0], [active, 3, ACTION.GO, 17]);
  // Poison is V2's ordinary strategic resource and stays inside BP68's
  // accepted candidate domain rather than taking the symmetric-skill bypass.
  active.selectNativeBasePolicy(ACTION.CAST_POISON, 0xffff);
  assert.equal(active.nativeBasePolicyRootCheckCount, 2);
});
