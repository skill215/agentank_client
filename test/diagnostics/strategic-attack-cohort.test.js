"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const cohort = require(
  "../../tools/agentank/diagnostics/strategic-attack-cohort");

const root = path.resolve(__dirname, "../..");

test("strategic attack cohort freezes disjoint blind partitions", () => {
  const manifest = cohort.build(root);
  assert.equal(cohort.validate(manifest), manifest);
  assert.equal(manifest.scenarios.length, 224);
  assert.equal(manifest.scenarios.filter(item => item.role === "DISCOVERY").length,
    96);
  assert.equal(manifest.scenarios.filter(item => item.role === "HOLDOUT").length,
    128);
  const excluded = new Set();
  for (const relative of cohort.EXCLUSION_FILES) {
    const value = JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
    for (const item of value.scenarios || []) excluded.add(item.matchUrlId);
  }
  for (const item of manifest.scenarios)
    assert.equal(excluded.has(item.matchUrlId), false, item.matchUrlId);
});
