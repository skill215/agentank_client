"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { FIXED, specializeSource } = require(
  "../../tools/agentank/build/generate-specialized-base-policy");
const { NATIVE_BASE_POLICY_PROFILE } = require(
  "../../engine-v2/src/base-policy/native-root");
const { NativeBasePolicyRoot } = require(
  "../../engine-v2/src/base-policy-specialized/native-root");

const ROOT = path.resolve(__dirname, "../..");

test("closed BP68 constants preserve the accepted depth and budget", () => {
  assert.equal(FIXED["policy-search"].targetDepth,
    NATIVE_BASE_POLICY_PROFILE.targetDepth);
  assert.equal(FIXED["policy-search"].nodeBudget,
    NATIVE_BASE_POLICY_PROFILE.nodeBudget);
  assert.equal(FIXED["policy-leaf"].starFieldCacheEntries,
    NATIVE_BASE_POLICY_PROFILE.starFieldCacheEntries);
  assert.equal(FIXED["action-owner"].riskFrontierMode,
    NATIVE_BASE_POLICY_PROFILE.riskFrontier);
});

test("specialized modules are reproducible from compact sources", () => {
  for (const moduleName of Object.keys(FIXED)) {
    const source = fs.readFileSync(path.join(ROOT,
      `engine-v2/src/base-policy-compact/${moduleName}.js`), "utf8");
    const generated = fs.readFileSync(path.join(ROOT,
      `engine-v2/src/base-policy-specialized/${moduleName}.js`), "utf8");
    assert.equal(generated, specializeSource(source, moduleName).output,
      moduleName);
  }
});

test("specialized root keeps the depth-3 search behavior as constants", () => {
  const root = new NativeBasePolicyRoot();
  assert.equal(root.policySearch.targetDepth, undefined);
  assert.equal(root.policySearch.nodeBudget, undefined);
  assert.equal(root.policySearch.currentDepth, 3);
  assert.equal(root.leafEvaluator.starFieldCacheEntries, undefined);
  assert.equal(root.leafEvaluator.starCacheStar.length, 2);
  assert.equal(root.policySearch.rootScore.length > 0, true);
});
