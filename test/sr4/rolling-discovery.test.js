"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { sha256Bytes } = require("../../tools/agentank/core/hash");
const { loadRollingV1Scenarios } =
  require("../../tools/agentank/simulation/historical-scenarios");
const { buildRollingDiscoveryCohort } =
  require("../../tools/agentank/structural/rolling-discovery");
const { analyze } = require("../../tools/agentank/structural/fixed-arena");

test("SR4 rolling V1 discovery follows the current match index without mutating frozen SR0", () => {
  const root = process.cwd(); const rolling = loadRollingV1Scenarios(root);
  const frozenCount = rolling.frozenSnapshot.matchUrlIds.length;
  assert.equal(frozenCount, 266); assert.ok(rolling.scenarios.length >= frozenCount);
  assert.equal(rolling.snapshot.discoveredBeyondFrozen, rolling.scenarios.length - frozenCount);
  assert.equal(new Set(rolling.snapshot.matchUrlIds).size, rolling.scenarios.length);
  const indexBytes = fs.readFileSync(rolling.snapshot.sourceIndex.relativePath);
  assert.equal(rolling.snapshot.sourceIndex.sha256, sha256Bytes(indexBytes));
  for (const scenario of rolling.scenarios) {
    assert.ok(scenario.map.length > 0); assert.equal(scenario.starts.length, 2);
    assert.ok(scenario.stars.length > 0); assert.equal(scenario.stars[0].frame, 0);
  }
});

test("SR4 candidate cohort materializes maps, both starts, and exact historical star sequences", () => {
  const built = buildRollingDiscoveryCohort(process.cwd(), "SR4"); const manifest = built.manifest;
  assert.equal(manifest.denominator.scenarios, manifest.entries.length);
  assert.equal(manifest.denominator.discoveredBeyondFrozen, built.scenarios.length);
  assert.ok(manifest.denominator.uniqueMaps > 0 && manifest.denominator.uniqueStarts > 0 &&
    manifest.denominator.uniqueStarSequences > 0);
  for (const entry of manifest.entries) {
    assert.ok(entry.map.length > 0); assert.equal(entry.starts.length, 2);
    assert.ok(entry.stars.length > 0); assert.equal(entry.stars[0].frame, 0);
    assert.equal(entry.scenarioFingerprint.length, 64);
  }
});

test("SR4 total analysis rate gives equal-star draws half weight with integer arithmetic", () => {
  function match(winnerImplementation) {
    return { v2Seat: 0, seatImplementations: ["v2", "v1"],
      counts: { crashes: [0, 0], stars: [1, 1] }, result: { reason: "frameLimit",
        winnerImplementation } };
  }
  const matches = [match("v2"), match("draw"), match("v1")];
  matches[0].counts.stars = [2, 1]; matches[2].counts.stars = [0, 1];
  const result = analyze(matches);
  assert.deepEqual([result.analysisV2Wins, result.analysisDraws, result.analysisV1Wins], [1, 1, 1]);
  assert.equal(result.analysisScoreUnits, 3);
  assert.equal(result.analysisScoreRatePer10000, 5000);
});
