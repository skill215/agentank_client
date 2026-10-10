"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { sha256Text, fingerprintObject } = require("../core/hash");
const { loadRollingV1Scenarios, loadRollingV1ScenariosForIds } =
  require("../simulation/historical-scenarios");

const INVENTORY_SCHEMA = 1;
const INVENTORY_KIND = "V2_COMPONENT_TRANSPLANT_FRESH_INVENTORY_V1";
const COHORT_SCHEMA = 1;
const COHORT_KIND = "V2_COMPONENT_TRANSPLANT_BLIND_COHORT_V1";
const SALT = "v2-component-transplant-ctr0-2026-07-31";
const PARTITIONS = Object.freeze([
  Object.freeze({ role: "SAFETY_HOLDOUT", scenarios: 48 }),
  Object.freeze({ role: "TACTICAL_HOLDOUT", scenarios: 64 }),
  Object.freeze({ role: "COMBAT_HOLDOUT", scenarios: 64 }),
  Object.freeze({ role: "STRATEGY_HOLDOUT", scenarios: 64 }),
  Object.freeze({ role: "V2_FINAL_HOLDOUT", scenarios: 128 })
]);
const REQUIRED_FRESH_SCENARIOS = PARTITIONS.reduce((sum, item) => sum + item.scenarios, 0);

function uniqueScenarios(values) {
  const output = [];
  const fingerprints = new Set();
  for (const item of values) {
    if (fingerprints.has(item.fingerprint)) continue;
    fingerprints.add(item.fingerprint);
    output.push(item);
  }
  return output;
}

function rank(scenario) {
  return sha256Text(`${SALT}\0${scenario.fingerprint}\0${scenario.matchUrlId}`);
}

function exposedRecords(vc0Manifest, repairManifest) {
  return [...vc0Manifest.scenarios, ...repairManifest.scenarios];
}

function inventoryRecord(scenario) {
  return {
    matchUrlId: scenario.matchUrlId,
    scenarioFingerprint: scenario.fingerprint,
    mapHash: scenario.mapHash,
    rank: rank(scenario)
  };
}

function buildInventory(root, vc0Manifest, repairManifest) {
  const rolling = loadRollingV1Scenarios(root);
  const exposed = exposedRecords(vc0Manifest, repairManifest);
  const exposedIds = new Set(exposed.map(item => item.matchUrlId));
  const exposedFingerprints = new Set(exposed.map(item => item.scenarioFingerprint));
  const unique = uniqueScenarios(rolling.scenarios);
  const fresh = unique.filter(item => !exposedIds.has(item.matchUrlId) &&
    !exposedFingerprints.has(item.fingerprint)).sort((left, right) =>
    rank(left).localeCompare(rank(right)));
  const inventory = {
    schemaVersion: INVENTORY_SCHEMA,
    objectKind: INVENTORY_KIND,
    selectionSalt: SALT,
    generatedAt: new Date().toISOString(),
    source: {
      snapshotId: rolling.snapshot.snapshotId,
      snapshotFingerprint: rolling.snapshot.fingerprint,
      loadedScenarios: rolling.scenarios.length,
      uniqueScenarios: unique.length
    },
    exposed: {
      vc0Scenarios: vc0Manifest.scenarios.length,
      v3RepairScenarios: repairManifest.scenarios.length,
      uniqueScenarios: exposedFingerprints.size,
      scenarioFingerprints: [...exposedFingerprints].sort()
    },
    requirement: {
      partitions: PARTITIONS,
      requiredFreshScenarios: REQUIRED_FRESH_SCENARIOS
    },
    fresh: {
      availableScenarios: fresh.length,
      missingScenarios: Math.max(0, REQUIRED_FRESH_SCENARIOS - fresh.length),
      ready: fresh.length >= REQUIRED_FRESH_SCENARIOS,
      scenarios: fresh.map(inventoryRecord)
    },
    fingerprint: ""
  };
  const payload = { ...inventory };
  delete payload.generatedAt;
  delete payload.fingerprint;
  inventory.fingerprint = fingerprintObject(payload);
  return inventory;
}

function validateInventory(inventory) {
  if (!inventory || inventory.schemaVersion !== INVENTORY_SCHEMA ||
      inventory.objectKind !== INVENTORY_KIND)
    throw new Error("CTR_FRESH_INVENTORY_SCHEMA");
  const exposed = new Set(inventory.exposed?.scenarioFingerprints || []);
  const freshIds = new Set();
  const freshFingerprints = new Set();
  for (const item of inventory.fresh?.scenarios || []) {
    if (freshIds.has(item.matchUrlId) || freshFingerprints.has(item.scenarioFingerprint))
      throw new Error(`CTR_FRESH_INVENTORY_DUPLICATE:${item.matchUrlId}`);
    if (exposed.has(item.scenarioFingerprint))
      throw new Error(`CTR_FRESH_INVENTORY_EXPOSED:${item.matchUrlId}`);
    if (rank({ fingerprint: item.scenarioFingerprint,
      matchUrlId: item.matchUrlId }) !== item.rank)
      throw new Error(`CTR_FRESH_INVENTORY_RANK:${item.matchUrlId}`);
    freshIds.add(item.matchUrlId);
    freshFingerprints.add(item.scenarioFingerprint);
  }
  if (freshIds.size !== inventory.fresh.availableScenarios)
    throw new Error("CTR_FRESH_INVENTORY_DENOMINATOR");
  if (inventory.fresh.missingScenarios !==
      Math.max(0, REQUIRED_FRESH_SCENARIOS - freshIds.size))
    throw new Error("CTR_FRESH_INVENTORY_MISSING_COUNT");
  if (Boolean(inventory.fresh.ready) !== (freshIds.size >= REQUIRED_FRESH_SCENARIOS))
    throw new Error("CTR_FRESH_INVENTORY_READINESS");
  const payload = { ...inventory };
  delete payload.generatedAt;
  delete payload.fingerprint;
  if (fingerprintObject(payload) !== inventory.fingerprint)
    throw new Error("CTR_FRESH_INVENTORY_FINGERPRINT");
  return inventory;
}

function buildBlindCohort(inventory) {
  validateInventory(inventory);
  if (!inventory.fresh.ready)
    throw new Error(`CTR_BLIND_COHORT_INSUFFICIENT:${inventory.fresh.availableScenarios}:${
      REQUIRED_FRESH_SCENARIOS}`);
  const selected = inventory.fresh.scenarios.slice(0, REQUIRED_FRESH_SCENARIOS);
  const records = [];
  let offset = 0;
  for (const partition of PARTITIONS) {
    for (let index = 0; index < partition.scenarios; index += 1) {
      const item = selected[offset++];
      records.push({ index: records.length, role: partition.role,
        matchUrlId: item.matchUrlId, scenarioFingerprint: item.scenarioFingerprint,
        mapHash: item.mapHash });
    }
  }
  const manifest = {
    schemaVersion: COHORT_SCHEMA,
    objectKind: COHORT_KIND,
    selectionSalt: SALT,
    frozenAt: new Date().toISOString(),
    inventoryFingerprint: inventory.fingerprint,
    contract: {
      scenarioCount: REQUIRED_FRESH_SCENARIOS,
      matchCount: REQUIRED_FRESH_SCENARIOS * 2,
      seatSwapsPerScenario: 2,
      skills: ["stun", "stun"],
      partitions: PARTITIONS
    },
    scenarios: records,
    fingerprint: ""
  };
  const payload = { ...manifest };
  delete payload.frozenAt;
  delete payload.fingerprint;
  manifest.fingerprint = fingerprintObject(payload);
  return manifest;
}

function validateBlindCohort(manifest) {
  if (!manifest || manifest.schemaVersion !== COHORT_SCHEMA ||
      manifest.objectKind !== COHORT_KIND)
    throw new Error("CTR_BLIND_COHORT_SCHEMA");
  if (!Array.isArray(manifest.scenarios) ||
      manifest.scenarios.length !== REQUIRED_FRESH_SCENARIOS)
    throw new Error("CTR_BLIND_COHORT_DENOMINATOR");
  const ids = new Set();
  const fingerprints = new Set();
  const counts = Object.create(null);
  for (const item of manifest.scenarios) {
    if (ids.has(item.matchUrlId) || fingerprints.has(item.scenarioFingerprint))
      throw new Error(`CTR_BLIND_COHORT_DUPLICATE:${item.matchUrlId}`);
    ids.add(item.matchUrlId);
    fingerprints.add(item.scenarioFingerprint);
    counts[item.role] = (counts[item.role] || 0) + 1;
  }
  for (const partition of PARTITIONS)
    if (counts[partition.role] !== partition.scenarios)
      throw new Error(`CTR_BLIND_COHORT_PARTITION:${partition.role}:${
        counts[partition.role] || 0}`);
  const payload = { ...manifest };
  delete payload.frozenAt;
  delete payload.fingerprint;
  if (fingerprintObject(payload) !== manifest.fingerprint)
    throw new Error("CTR_BLIND_COHORT_FINGERPRINT");
  return manifest;
}

function loadBlindCohort(root, manifestFile, role) {
  const manifest = validateBlindCohort(JSON.parse(
    fs.readFileSync(path.resolve(manifestFile), "utf8")));
  const records = role === "ALL" ? manifest.scenarios :
    manifest.scenarios.filter(item => item.role === role);
  if (!records.length) throw new Error(`CTR_BLIND_COHORT_ROLE:${role}`);
  const loaded = loadRollingV1ScenariosForIds(records.map(item => item.matchUrlId), root);
  for (let index = 0; index < records.length; index += 1)
    if (loaded.scenarios[index].fingerprint !== records[index].scenarioFingerprint)
      throw new Error(`CTR_BLIND_SCENARIO_DRIFT:${records[index].matchUrlId}`);
  return { manifest, records, scenarios: loaded.scenarios, sourceIndex: loaded.sourceIndex };
}

module.exports = {
  INVENTORY_SCHEMA,
  INVENTORY_KIND,
  COHORT_SCHEMA,
  COHORT_KIND,
  SALT,
  PARTITIONS,
  REQUIRED_FRESH_SCENARIOS,
  uniqueScenarios,
  rank,
  buildInventory,
  validateInventory,
  buildBlindCohort,
  validateBlindCohort,
  loadBlindCohort
};
