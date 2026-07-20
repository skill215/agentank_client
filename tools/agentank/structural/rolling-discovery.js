"use strict";

const path = require("node:path");
const { contained } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { loadRollingV1Scenarios } = require("../simulation/historical-scenarios");

function buildRollingDiscoveryCohort(root, stage = "SR4") {
  const rolling = loadRollingV1Scenarios(root); const frozenIds = new Set(
    rolling.frozenSnapshot?.matchUrlIds || []); const entries = rolling.scenarios.map(scenario => ({
      matchUrlId: scenario.matchUrlId, scenarioFingerprint: scenario.fingerprint,
      mapHash: scenario.mapHash, mapFingerprint: fingerprintObject({ map: scenario.map }),
      map: scenario.map, startsFingerprint: fingerprintObject({ starts: scenario.starts }),
      starts: scenario.starts, starSequenceFingerprint: fingerprintObject({ stars: scenario.stars }),
      stars: scenario.stars, originalSubjectSeat: scenario.originalSubjectSeat,
      originalFrames: scenario.originalFrames, originalResult: scenario.originalResult,
      discoveredBeyondFrozen: frozenIds.has(scenario.matchUrlId) ? 0 : 1
    }));
  const manifest = { schemaVersion: 1, reportKind: "V2_ROLLING_DISCOVERY_COHORT",
    stageId: stage, policy: { fixedSr0Immutable: true, rollingDiscoveryDynamic: true,
      includesMapGeometry: true, includesBothStarts: true, includesExactHistoricalStarSequence: true },
    sourceSnapshot: { snapshotId: rolling.snapshot.snapshotId, headId: rolling.snapshot.headId,
      fingerprint: rolling.snapshot.fingerprint, sourceIndex: rolling.snapshot.sourceIndex },
    denominator: { scenarios: entries.length,
      frozenScenarios: entries.length - rolling.snapshot.discoveredBeyondFrozen,
      discoveredBeyondFrozen: rolling.snapshot.discoveredBeyondFrozen,
      uniqueMaps: new Set(entries.map(entry => entry.mapFingerprint)).size,
      uniqueStarts: new Set(entries.map(entry => entry.startsFingerprint)).size,
      uniqueStarSequences: new Set(entries.map(entry => entry.starSequenceFingerprint)).size },
    entries, fingerprint: "" };
  manifest.fingerprint = fingerprintObject(manifest);
  const directory = contained(root, "artifacts", "reports", "structural-repair", stage);
  const file = path.join(directory, `${stage.toLowerCase()}-rolling-discovery-cohort.json`);
  writeJsonAtomic(file, manifest, { mode: 0o644 });
  writeJsonImmutable(path.join(directory, "history",
    `${stage.toLowerCase()}-rolling-discovery-cohort-${manifest.fingerprint}.json`), manifest,
  { mode: 0o644 });
  const newIds = new Set(entries.filter(entry => entry.discoveredBeyondFrozen)
    .map(entry => entry.matchUrlId));
  return { manifest, file, scenarios: rolling.scenarios.filter(scenario => newIds.has(scenario.matchUrlId)) };
}

module.exports = { buildRollingDiscoveryCohort };
