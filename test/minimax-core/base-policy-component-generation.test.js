"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { NativeBasePolicyLeafEvaluator } = require(
  "../../engine-v2/src/base-policy/policy-leaf");
const { NativeBasePolicyPathUtility } = require(
  "../../engine-v2/src/base-policy/path-utility");
const { generate } = require(
  "../../tools/agentank/build/generate-base-policy-components");

const root = path.resolve(__dirname, "../..");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function methods(value) {
  return Object.getOwnPropertyNames(value.prototype)
    .filter(name => name !== "constructor").sort();
}

test("BP164 generated leaf and path contain exactly their reachable closures", () => {
  const evidence = JSON.parse(fs.readFileSync(path.join(root,
    "config/engine-v3/base-policy-kernel-bp160-search-reachability-evidence.json"),
  "utf8"));
  assert.deepEqual(methods(NativeBasePolicyLeafEvaluator),
    evidence.leafPathReachability.leaf.calledMethods.map(entry =>
      entry.name).sort());
  assert.deepEqual(methods(NativeBasePolicyPathUtility),
    evidence.leafPathReachability.path.calledMethods.map(entry =>
      entry.name).sort());
  for (const name of evidence.leafPathReachability.leaf.neverCalledMethods)
    assert.equal(typeof NativeBasePolicyLeafEvaluator.prototype[name], "undefined");
  for (const name of evidence.leafPathReachability.path.neverCalledMethods)
    assert.equal(typeof NativeBasePolicyPathUtility.prototype[name], "undefined");
});

test("BP164 leaf and path generation is deterministic and production-local", () => {
  const leafFile = path.join(root, "engine-v2/src/base-policy/policy-leaf.js");
  const pathFile = path.join(root, "engine-v2/src/base-policy/path-utility.js");
  const beforeLeaf = fs.readFileSync(leafFile);
  const beforePath = fs.readFileSync(pathFile);
  const result = generate(root);
  const afterLeaf = fs.readFileSync(leafFile);
  const afterPath = fs.readFileSync(pathFile);
  assert.equal(sha256(afterLeaf), sha256(beforeLeaf));
  assert.equal(sha256(afterPath), sha256(beforePath));
  for (const text of [afterLeaf.toString("utf8"), afterPath.toString("utf8")]) {
    assert.equal(text.includes("tools/agentank/diagnostics"), false);
    assert.equal(text.includes("../../../engine-v2/src/"), false);
  }
  assert.equal(result.leaf.retainedMethods, 32);
  assert.equal(result.path.retainedMethods, 21);
});
