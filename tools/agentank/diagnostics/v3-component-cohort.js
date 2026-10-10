"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { sha256Text, fingerprintObject } = require("../core/hash");
const { loadRollingV1Scenarios, loadRollingV1ScenariosForIds } =
  require("../simulation/historical-scenarios");

const COHORT_SCHEMA = 1;
const COHORT_KIND = "V3_COMPONENT_CAUSAL_COHORT_V1";
const COHORT_SALT = "v3-v2-component-causal-vc0-2026-07-29";
const DISCOVERY_COUNT = 16;
const HOLDOUT_COUNT = 48;

function ranked(values, namespace) {
  return values.slice().sort((left, right) =>
    sha256Text(`${COHORT_SALT}\0${namespace}\0${left.fingerprint}\0${left.matchUrlId}`)
      .localeCompare(sha256Text(
        `${COHORT_SALT}\0${namespace}\0${right.fingerprint}\0${right.matchUrlId}`)));
}

function uniqueScenarios(scenarios) {
  const unique = []; const seen = new Set();
  for (const scenario of scenarios) if (!seen.has(scenario.fingerprint)) {
    seen.add(scenario.fingerprint); unique.push(scenario);
  }
  return unique;
}

function buildCohortManifest(root, v1Sha256) {
  const rolling = loadRollingV1Scenarios(root);
  const unique = uniqueScenarios(rolling.scenarios);
  const frozen = new Set(rolling.frozenSnapshot?.matchUrlIds || []);
  const discovered = ranked(unique.filter(item => !frozen.has(item.matchUrlId)), "new");
  const historical = ranked(unique.filter(item => frozen.has(item.matchUrlId)), "fixed");
  if (discovered.length < 16) throw new Error(`VC0_NEW_SCENARIOS_INSUFFICIENT:${discovered.length}`);
  if (historical.length < 48) throw new Error(`VC0_FIXED_SCENARIOS_INSUFFICIENT:${historical.length}`);
  const selected = discovered.slice(0, 16).concat(historical.slice(0, 48));
  const discoveryIds = new Set(ranked(selected, "split").slice(0, DISCOVERY_COUNT)
    .map(item => item.matchUrlId));
  const records = selected.map((scenario, index) => ({
    index,
    role: discoveryIds.has(scenario.matchUrlId) ? "DISCOVERY" : "HOLDOUT",
    sourceClass: frozen.has(scenario.matchUrlId) ? "FIXED_HASH_SAMPLE" : "NEW_HISTORY",
    matchUrlId: scenario.matchUrlId,
    scenarioFingerprint: scenario.fingerprint,
    mapHash: scenario.mapHash,
    originalFrames: scenario.originalFrames,
    originalSubjectSeat: scenario.originalSubjectSeat,
    starts: scenario.starts.map(item => ({ position: item.position, direction: item.direction })),
    starCount: scenario.stars.length
  }));
  const manifest = { schemaVersion: COHORT_SCHEMA, objectKind: COHORT_KIND,
    selectionSalt: COHORT_SALT, frozenAt: new Date().toISOString(), v1Sha256,
    dynamicSource: { snapshotId: rolling.snapshot.snapshotId,
      snapshotFingerprint: rolling.snapshot.fingerprint,
      available: rolling.scenarios.length, unique: unique.length,
      newAvailable: discovered.length, frozenAvailable: historical.length },
    contract: { scenarioCount: 64, matchCount: 128, newHistoryCount: 16,
      fixedHashCount: 48, discoveryScenarios: DISCOVERY_COUNT,
      holdoutScenarios: HOLDOUT_COUNT, seatSwapsPerScenario: 2, skills: ["stun", "stun"] },
    scenarios: records, fingerprint: "" };
  const payload = { ...manifest }; delete payload.frozenAt; delete payload.fingerprint;
  manifest.fingerprint = fingerprintObject(payload);
  return manifest;
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== COHORT_SCHEMA || manifest.objectKind !== COHORT_KIND)
    throw new Error("VC0_COHORT_SCHEMA_INVALID");
  if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length !== 64)
    throw new Error("VC0_COHORT_DENOMINATOR_INVALID");
  const ids = new Set(); const fingerprints = new Set(); let discovery = 0;
  let holdout = 0; let newer = 0; let fixed = 0;
  for (const item of manifest.scenarios) {
    if (ids.has(item.matchUrlId) || fingerprints.has(item.scenarioFingerprint))
      throw new Error(`VC0_COHORT_DUPLICATE:${item.matchUrlId}`);
    ids.add(item.matchUrlId); fingerprints.add(item.scenarioFingerprint);
    if (item.role === "DISCOVERY") discovery += 1;
    else if (item.role === "HOLDOUT") holdout += 1;
    else throw new Error(`VC0_COHORT_ROLE_INVALID:${item.role}`);
    if (item.sourceClass === "NEW_HISTORY") newer += 1;
    else if (item.sourceClass === "FIXED_HASH_SAMPLE") fixed += 1;
    else throw new Error(`VC0_COHORT_SOURCE_INVALID:${item.sourceClass}`);
  }
  if (discovery !== DISCOVERY_COUNT || holdout !== HOLDOUT_COUNT || newer !== 16 || fixed !== 48)
    throw new Error(`VC0_COHORT_COUNTS_INVALID:${discovery}:${holdout}:${newer}:${fixed}`);
  const payload = { ...manifest }; delete payload.frozenAt; delete payload.fingerprint;
  if (fingerprintObject(payload) !== manifest.fingerprint)
    throw new Error("VC0_COHORT_FINGERPRINT_INVALID");
  return manifest;
}

function loadCohort(root, manifestFile, role = "ALL") {
  const file = path.resolve(manifestFile);
  const manifest = validateManifest(JSON.parse(fs.readFileSync(file, "utf8")));
  const records = role === "ALL" ? manifest.scenarios :
    manifest.scenarios.filter(item => item.role === role);
  const loaded = loadRollingV1ScenariosForIds(records.map(item => item.matchUrlId), root);
  for (let index = 0; index < records.length; index += 1)
    if (loaded.scenarios[index].fingerprint !== records[index].scenarioFingerprint)
      throw new Error(`VC0_SCENARIO_DRIFT:${records[index].matchUrlId}`);
  return { manifest, records, scenarios: loaded.scenarios, sourceIndex: loaded.sourceIndex };
}

module.exports = { COHORT_SCHEMA, COHORT_KIND, COHORT_SALT, DISCOVERY_COUNT,
  HOLDOUT_COUNT, buildCohortManifest, validateManifest, loadCohort };
