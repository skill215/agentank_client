"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { NativeBasePolicySearch } = require(
  "../../engine-v2/src/base-policy/policy-search");
const { generate } = require(
  "../../tools/agentank/build/generate-base-policy-search");

const root = path.resolve(__dirname, "../..");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("BP160 generated search contains exactly the native reachable closure", () => {
  const evidence = JSON.parse(fs.readFileSync(path.join(root,
    "config/engine-v3/base-policy-kernel-bp160-search-reachability-evidence.json"),
  "utf8"));
  const expected = evidence.reachability.nativeCalledMethods.map(entry =>
    entry.name).filter(name => name !==
      evidence.reachability.hotNoOpCandidate.name).sort();
  const actual = Object.getOwnPropertyNames(NativeBasePolicySearch.prototype)
    .filter(name => name !== "constructor").sort();
  assert.deepEqual(actual, expected);
  for (const name of ["compareInvocation", "compareOneStep",
    "compareDeepTransitions", "compareRootActionDomains",
    "compareRootValueOrdering", "evaluateSyntheticRoot",
    "evaluatePolicyResponseEnvelope"])
    assert.equal(typeof NativeBasePolicySearch.prototype[name], "undefined");
});

test("BP160 search generation is deterministic and production-local", () => {
  const before = fs.readFileSync(path.join(root,
    "engine-v2/src/base-policy/policy-search.js"));
  const result = generate(root);
  const after = fs.readFileSync(result.outputFile);
  assert.equal(sha256(after), sha256(before));
  const text = after.toString("utf8");
  assert.equal(text.includes("tools/agentank/diagnostics"), false);
  assert.equal(text.includes("../../../engine-v2/src/"), false);
  assert.equal(result.retainedMethods, 50);
  assert.ok(result.removedMethods >= 35);
  assert.equal(result.removedHotNoOpMethod, "recordPolicyEnvelopeLeaf");
  assert.equal(result.removedHotNoOpCalls, 4);
  assert.equal(text.includes("recordPolicyEnvelopeLeaf"), false);
});
