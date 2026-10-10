"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { validate } = require(
  "../../tools/agentank/diagnostics/poison-attack-event-cohort");

test("Poison attack event holdout excludes every previously frozen cohort", () => {
  const root = path.resolve(__dirname, "../..");
  const manifest = validate(JSON.parse(fs.readFileSync(path.join(root,
    "config/engine-v2/poison-attack-event-cohort.json"), "utf8")));
  const ids = new Set(manifest.scenarios.map(item => item.matchUrlId));
  const fingerprints = new Set(
    manifest.scenarios.map(item => item.scenarioFingerprint));
  assert.equal(manifest.scenarios.length, 27);
  assert.equal(manifest.source.selected, 27);
  for (const source of manifest.source.exclusionSources) {
    const prior = JSON.parse(fs.readFileSync(path.join(root, source.relativePath),
      "utf8"));
    for (const item of prior.scenarios || []) {
      assert.equal(ids.has(item.matchUrlId), false);
      assert.equal(fingerprints.has(item.scenarioFingerprint), false);
    }
  }
});
