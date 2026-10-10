"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { validate, KIND, COUNT } = require(
  "../../tools/agentank/diagnostics/objective-option-cohort");

test("objective option blind cohort is frozen, disjoint, and correctly partitioned", () => {
  const file = path.join(process.cwd(), "config", "engine-v2",
    "objective-option-cohort.json");
  assert.ok(fs.existsSync(file));
  const manifest = validate(JSON.parse(fs.readFileSync(file, "utf8")));
  assert.equal(manifest.objectKind, KIND);
  assert.equal(manifest.scenarios.length, COUNT);
  assert.equal(manifest.scenarios.filter(item => item.role === "DISCOVERY").length, 32);
  assert.equal(manifest.scenarios.filter(item => item.role === "HOLDOUT").length, 64);
  for (const name of ["v3-repair-cohort.json", "vc0-scenario-manifest.json"]) {
    const old = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "engine-v3",
      name), "utf8"));
    const oldIds = new Set(old.scenarios.map(item => item.matchUrlId));
    const oldFingerprints = new Set(old.scenarios.map(item => item.scenarioFingerprint));
    assert.equal(manifest.scenarios.some(item => oldIds.has(item.matchUrlId)), false);
    assert.equal(manifest.scenarios.some(item =>
      oldFingerprints.has(item.scenarioFingerprint)), false);
  }
});
