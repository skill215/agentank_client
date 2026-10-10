"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { sha256Text, fingerprintObject } = require("../core/hash");
const { loadRollingV1Scenarios, loadRollingV1ScenariosForIds } =
  require("../simulation/historical-scenarios");

const SCHEMA = 1;
const KIND = "V3_HIERARCHICAL_REPAIR_COHORT_V1";
const SALT = "v3-hierarchical-repair-v3r0-2026-07-29";
const PARTITIONS = Object.freeze([
  Object.freeze({ role: "DISCOVERY", scenarios: 64 }),
  Object.freeze({ role: "TACTICAL_HOLDOUT", scenarios: 96 }),
  Object.freeze({ role: "EO_HOLDOUT", scenarios: 96 }),
  Object.freeze({ role: "COMBAT_HOLDOUT", scenarios: 128 }),
  Object.freeze({ role: "STRATEGY_HOLDOUT", scenarios: 96 }),
  Object.freeze({ role: "PLAN_HOLDOUT", scenarios: 96 }),
  Object.freeze({ role: "FINAL_RECOVERY", scenarios: 256 })
]);
const SCENARIO_COUNT = PARTITIONS.reduce((sum, item) => sum + item.scenarios, 0);

function rank(scenario) {
  return sha256Text(`${SALT}\0${scenario.fingerprint}\0${scenario.matchUrlId}`);
}

function unique(values) {
  const output = []; const fingerprints = new Set();
  for (const item of values) if (!fingerprints.has(item.fingerprint)) {
    fingerprints.add(item.fingerprint); output.push(item);
  }
  return output;
}

function build(root, v1Sha256, vc0Manifest) {
  const rolling = loadRollingV1Scenarios(root);
  const excludedIds = new Set(vc0Manifest.scenarios.map(item => item.matchUrlId));
  const excludedFingerprints = new Set(vc0Manifest.scenarios.map(item => item.scenarioFingerprint));
  const available = unique(rolling.scenarios).filter(item =>
    !excludedIds.has(item.matchUrlId) && !excludedFingerprints.has(item.fingerprint));
  available.sort((left, right) => rank(left).localeCompare(rank(right)));
  if (available.length < SCENARIO_COUNT)
    throw new Error(`V3_REPAIR_COHORT_INSUFFICIENT:${available.length}:${SCENARIO_COUNT}`);
  const selected = available.slice(0, SCENARIO_COUNT); const records = [];
  let offset = 0;
  for (const partition of PARTITIONS) {
    for (let index = 0; index < partition.scenarios; index += 1) {
      const scenario = selected[offset++];
      records.push({ index: records.length, role: partition.role,
        matchUrlId: scenario.matchUrlId, scenarioFingerprint: scenario.fingerprint,
        mapHash: scenario.mapHash, originalFrames: scenario.originalFrames,
        originalSubjectSeat: scenario.originalSubjectSeat,
        starts: scenario.starts.map(item => ({ position: item.position,
          direction: item.direction })), starCount: scenario.stars.length });
    }
  }
  const manifest = { schemaVersion: SCHEMA, objectKind: KIND, selectionSalt: SALT,
    frozenAt: new Date().toISOString(), v1Sha256,
    source: { snapshotId: rolling.snapshot.snapshotId,
      snapshotFingerprint: rolling.snapshot.fingerprint,
      ledgerWatermark: rolling.snapshot.ledgerWatermark,
      available: rolling.scenarios.length, unique: unique(rolling.scenarios).length,
      excludedVc0: vc0Manifest.scenarios.length,
      eligible: available.length, selected: records.length, unselected: available.length - records.length },
    contract: { scenarioCount: SCENARIO_COUNT, matchCount: SCENARIO_COUNT * 2,
      seatSwapsPerScenario: 2, skills: ["stun", "stun"], partitions: PARTITIONS },
    scenarios: records, fingerprint: "" };
  const payload = { ...manifest }; delete payload.frozenAt; delete payload.fingerprint;
  manifest.fingerprint = fingerprintObject(payload);
  return manifest;
}

function validate(manifest) {
  if (!manifest || manifest.schemaVersion !== SCHEMA || manifest.objectKind !== KIND)
    throw new Error("V3_REPAIR_COHORT_SCHEMA");
  if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length !== SCENARIO_COUNT)
    throw new Error("V3_REPAIR_COHORT_DENOMINATOR");
  const ids = new Set(); const fingerprints = new Set(); const counts = Object.create(null);
  for (const item of manifest.scenarios) {
    if (ids.has(item.matchUrlId) || fingerprints.has(item.scenarioFingerprint))
      throw new Error(`V3_REPAIR_COHORT_DUPLICATE:${item.matchUrlId}`);
    ids.add(item.matchUrlId); fingerprints.add(item.scenarioFingerprint);
    counts[item.role] = (counts[item.role] || 0) + 1;
  }
  for (const partition of PARTITIONS)
    if (counts[partition.role] !== partition.scenarios)
      throw new Error(`V3_REPAIR_COHORT_PARTITION:${partition.role}:${counts[partition.role] || 0}`);
  const payload = { ...manifest }; delete payload.frozenAt; delete payload.fingerprint;
  if (fingerprintObject(payload) !== manifest.fingerprint)
    throw new Error("V3_REPAIR_COHORT_FINGERPRINT");
  return manifest;
}

function load(root, manifestFile, role) {
  const manifest = validate(JSON.parse(fs.readFileSync(path.resolve(manifestFile), "utf8")));
  const records = role === "ALL" ? manifest.scenarios :
    manifest.scenarios.filter(item => item.role === role);
  if (!records.length) throw new Error(`V3_REPAIR_COHORT_ROLE:${role}`);
  const loaded = loadRollingV1ScenariosForIds(records.map(item => item.matchUrlId), root);
  for (let index = 0; index < records.length; index += 1)
    if (loaded.scenarios[index].fingerprint !== records[index].scenarioFingerprint)
      throw new Error(`V3_REPAIR_SCENARIO_DRIFT:${records[index].matchUrlId}`);
  return { manifest, records, scenarios: loaded.scenarios, sourceIndex: loaded.sourceIndex };
}

module.exports = { SCHEMA, KIND, SALT, PARTITIONS, SCENARIO_COUNT, build, validate, load };
