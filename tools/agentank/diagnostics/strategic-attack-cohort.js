#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { sha256Text, fingerprintObject } = require("../core/hash");
const { loadRollingV1Scenarios, loadRollingV1ScenariosForIds } = require(
  "../simulation/historical-scenarios");

const SCHEMA = 1;
const KIND = "STRATEGIC_ATTACK_BLIND_COHORT_V1";
const SALT = "strategic-attack-over-star-frozen-2026-08-17";
const PARTITIONS = Object.freeze([
  Object.freeze({ role: "DISCOVERY", scenarios: 96 }),
  Object.freeze({ role: "HOLDOUT", scenarios: 128 })
]);
const COUNT = 224;
const EXCLUSION_FILES = Object.freeze([
  "config/engine-v3/v3-repair-cohort.json",
  "config/engine-v3/vc0-scenario-manifest.json",
  "config/engine-v2/objective-option-cohort.json"
]);

function rank(item) {
  return sha256Text(`${SALT}\0${item.fingerprint}\0${item.matchUrlId}`);
}

function exclusions(root) {
  const ids = new Set(); const fingerprints = new Set(); const sources = [];
  for (const relative of EXCLUSION_FILES) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    let count = 0;
    for (const item of manifest.scenarios || []) {
      if (item.matchUrlId) ids.add(item.matchUrlId);
      if (item.scenarioFingerprint) fingerprints.add(item.scenarioFingerprint);
      count += 1;
    }
    sources.push({ relativePath: relative, fingerprint: manifest.fingerprint,
      scenarios: count });
  }
  return { ids, fingerprints, sources };
}

function build(root = defaultWorkspaceRoot()) {
  const rolling = loadRollingV1Scenarios(root); const excluded = exclusions(root);
  const seen = new Set(); const eligible = [];
  for (const item of rolling.scenarios)
    if (!seen.has(item.fingerprint) && !excluded.ids.has(item.matchUrlId) &&
        !excluded.fingerprints.has(item.fingerprint)) {
      seen.add(item.fingerprint); eligible.push(item);
    }
  eligible.sort((left, right) => rank(left).localeCompare(rank(right)));
  if (eligible.length < COUNT)
    throw new Error(`STRATEGIC_ATTACK_COHORT_INSUFFICIENT:${eligible.length}:${COUNT}`);
  const scenarios = []; let offset = 0;
  for (const partition of PARTITIONS)
    for (let index = 0; index < partition.scenarios; index += 1) {
      const item = eligible[offset++];
      scenarios.push({ index: scenarios.length, role: partition.role,
        matchUrlId: item.matchUrlId, scenarioFingerprint: item.fingerprint,
        mapHash: item.mapHash, originalFrames: item.originalFrames,
        originalSubjectSeat: item.originalSubjectSeat,
        starts: item.starts.map(value => ({ position: value.position,
          direction: value.direction })), starCount: item.stars.length });
    }
  const manifest = { schemaVersion: SCHEMA, objectKind: KIND,
    selectionSalt: SALT, frozenAt: new Date().toISOString(),
    source: { snapshotId: rolling.snapshot.snapshotId,
      snapshotFingerprint: rolling.snapshot.fingerprint,
      ledgerWatermark: rolling.snapshot.ledgerWatermark,
      available: rolling.scenarios.length, excluded: excluded.ids.size,
      eligible: eligible.length, selected: scenarios.length,
      exclusionSources: excluded.sources },
    contract: { scenarioCount: COUNT, matchCount: COUNT * 2,
      seatSwapsPerScenario: 2, skills: ["poison", "stun"],
      partitions: PARTITIONS }, scenarios, fingerprint: "" };
  const payload = { ...manifest }; delete payload.frozenAt;
  delete payload.fingerprint;
  manifest.fingerprint = fingerprintObject(payload); return manifest;
}

function validate(manifest) {
  if (!manifest || manifest.schemaVersion !== SCHEMA ||
      manifest.objectKind !== KIND) throw new Error("STRATEGIC_ATTACK_COHORT_SCHEMA");
  if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length !== COUNT)
    throw new Error("STRATEGIC_ATTACK_COHORT_DENOMINATOR");
  const ids = new Set(); const fingerprints = new Set(); const counts = {};
  for (const item of manifest.scenarios) {
    if (ids.has(item.matchUrlId) || fingerprints.has(item.scenarioFingerprint))
      throw new Error(`STRATEGIC_ATTACK_COHORT_DUPLICATE:${item.matchUrlId}`);
    ids.add(item.matchUrlId); fingerprints.add(item.scenarioFingerprint);
    counts[item.role] = (counts[item.role] || 0) + 1;
  }
  for (const partition of PARTITIONS)
    if (counts[partition.role] !== partition.scenarios)
      throw new Error(`STRATEGIC_ATTACK_COHORT_PARTITION:${partition.role}`);
  const payload = { ...manifest }; delete payload.frozenAt;
  delete payload.fingerprint;
  if (fingerprintObject(payload) !== manifest.fingerprint)
    throw new Error("STRATEGIC_ATTACK_COHORT_FINGERPRINT");
  return manifest;
}

function load(root, file, role) {
  const manifest = validate(JSON.parse(fs.readFileSync(path.resolve(file), "utf8")));
  const records = role === "ALL" ? manifest.scenarios :
    manifest.scenarios.filter(item => item.role === role);
  if (!records.length) throw new Error(`STRATEGIC_ATTACK_COHORT_ROLE:${role}`);
  const loaded = loadRollingV1ScenariosForIds(
    records.map(item => item.matchUrlId), root);
  for (let index = 0; index < records.length; index += 1)
    if (loaded.scenarios[index].fingerprint !== records[index].scenarioFingerprint)
      throw new Error(`STRATEGIC_ATTACK_SCENARIO_DRIFT:${records[index].matchUrlId}`);
  return { manifest, records, scenarios: loaded.scenarios,
    sourceIndex: loaded.sourceIndex };
}

function main() {
  const root = defaultWorkspaceRoot(); const command = process.argv[2] || "verify";
  const file = path.resolve(process.argv[3] || path.join(root, "config",
    "engine-v2", "strategic-attack-cohort.json"));
  if (command === "freeze") {
    const manifest = build(root);
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ file,
      fingerprint: manifest.fingerprint, source: manifest.source,
      partitions: manifest.contract.partitions }, null, 2)}\n`); return;
  }
  const manifest = validate(JSON.parse(fs.readFileSync(file, "utf8")));
  process.stdout.write(`${JSON.stringify({ file,
    fingerprint: manifest.fingerprint,
    partitions: manifest.contract.partitions }, null, 2)}\n`);
}

if (require.main === module) main();
module.exports = { SCHEMA, KIND, SALT, PARTITIONS, COUNT, EXCLUSION_FILES,
  build, validate, load };
