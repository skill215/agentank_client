#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { sha256Text, fingerprintObject } = require("../core/hash");
const { loadRollingV1Scenarios, loadRollingV1ScenariosForIds } = require(
  "../simulation/historical-scenarios");

const SCHEMA = 1;
const KIND = "POISON_ATTACK_EVENT_POC_COHORT_V1";
const SALT = "poison-attack-event-independent-2026-08-22";
const MAXIMUM_SCENARIOS = 64;
const EXCLUSIONS = Object.freeze([
  "config/engine-v3/vc0-scenario-manifest.json",
  "config/engine-v3/v3-repair-cohort.json",
  "config/engine-v2/objective-option-cohort.json",
  "config/engine-v2/strategic-attack-cohort.json"
]);

function rank(item) {
  return sha256Text(`${SALT}\0${item.fingerprint}\0${item.matchUrlId}`);
}

function excluded(root) {
  const ids = new Set(); const fingerprints = new Set(); const sources = [];
  for (const relativePath of EXCLUSIONS) {
    const file = path.join(root, relativePath);
    if (!fs.existsSync(file)) continue;
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const item of manifest.scenarios || []) {
      if (item.matchUrlId) ids.add(item.matchUrlId);
      if (item.scenarioFingerprint) fingerprints.add(item.scenarioFingerprint);
    }
    sources.push({ relativePath, fingerprint: manifest.fingerprint,
      scenarios: (manifest.scenarios || []).length });
  }
  return { ids, fingerprints, sources };
}

function build(root = defaultWorkspaceRoot()) {
  const rolling = loadRollingV1Scenarios(root); const prior = excluded(root);
  const seen = new Set(); const eligible = [];
  for (const item of rolling.scenarios)
    if (!seen.has(item.fingerprint) && !prior.ids.has(item.matchUrlId) &&
        !prior.fingerprints.has(item.fingerprint)) {
      seen.add(item.fingerprint); eligible.push(item);
    }
  eligible.sort((left, right) => rank(left).localeCompare(rank(right)));
  const selected = eligible.slice(0, MAXIMUM_SCENARIOS);
  if (selected.length < 16)
    throw new Error(`POISON_ATTACK_EVENT_COHORT_INSUFFICIENT:${selected.length}`);
  const scenarios = selected.map((item, index) => ({ index, role: "HOLDOUT",
    matchUrlId: item.matchUrlId, scenarioFingerprint: item.fingerprint,
    mapHash: item.mapHash, originalFrames: item.originalFrames,
    originalSubjectSeat: item.originalSubjectSeat,
    starts: item.starts.map(value => ({ position: value.position,
      direction: value.direction })), starCount: item.stars.length }));
  const manifest = { schemaVersion: SCHEMA, objectKind: KIND,
    selectionSalt: SALT, frozenAt: new Date().toISOString(),
    source: { snapshotId: rolling.snapshot.snapshotId,
      snapshotFingerprint: rolling.snapshot.fingerprint,
      ledgerWatermark: rolling.snapshot.ledgerWatermark,
      available: rolling.scenarios.length, excluded: prior.ids.size,
      eligible: eligible.length, selected: scenarios.length,
      exclusionSources: prior.sources },
    contract: { scenarioCount: scenarios.length, matchCount: scenarios.length * 2,
      seatSwapsPerScenario: 2, skills: ["poison", "stun"],
      partitions: [{ role: "HOLDOUT", scenarios: scenarios.length }] },
    scenarios, fingerprint: "" };
  const payload = { ...manifest }; delete payload.frozenAt; delete payload.fingerprint;
  manifest.fingerprint = fingerprintObject(payload); return manifest;
}

function validate(manifest) {
  if (!manifest || manifest.schemaVersion !== SCHEMA || manifest.objectKind !== KIND)
    throw new Error("POISON_ATTACK_EVENT_COHORT_SCHEMA");
  const expected = manifest.contract?.scenarioCount;
  if (!Number.isSafeInteger(expected) || expected < 16 || expected > MAXIMUM_SCENARIOS ||
      !Array.isArray(manifest.scenarios) || manifest.scenarios.length !== expected)
    throw new Error("POISON_ATTACK_EVENT_COHORT_DENOMINATOR");
  const ids = new Set(); const fingerprints = new Set();
  for (const item of manifest.scenarios) {
    if (item.role !== "HOLDOUT" || ids.has(item.matchUrlId) ||
        fingerprints.has(item.scenarioFingerprint))
      throw new Error(`POISON_ATTACK_EVENT_COHORT_RECORD:${item.matchUrlId}`);
    ids.add(item.matchUrlId); fingerprints.add(item.scenarioFingerprint);
  }
  const payload = { ...manifest }; delete payload.frozenAt; delete payload.fingerprint;
  if (fingerprintObject(payload) !== manifest.fingerprint)
    throw new Error("POISON_ATTACK_EVENT_COHORT_FINGERPRINT");
  return manifest;
}

function load(root, file, role) {
  const manifest = validate(JSON.parse(fs.readFileSync(path.resolve(file), "utf8")));
  if (role !== "ALL" && role !== "HOLDOUT")
    throw new Error(`POISON_ATTACK_EVENT_COHORT_ROLE:${role}`);
  const records = manifest.scenarios;
  const loaded = loadRollingV1ScenariosForIds(
    records.map(item => item.matchUrlId), root);
  for (let index = 0; index < records.length; index += 1)
    if (loaded.scenarios[index].fingerprint !== records[index].scenarioFingerprint)
      throw new Error(`POISON_ATTACK_EVENT_SCENARIO_DRIFT:${records[index].matchUrlId}`);
  return { manifest, records, scenarios: loaded.scenarios,
    sourceIndex: loaded.sourceIndex };
}

function main() {
  const root = defaultWorkspaceRoot(); const command = process.argv[2] || "verify";
  const file = path.resolve(process.argv[3] || path.join(root, "config", "engine-v2",
    "poison-attack-event-cohort.json"));
  if (command === "freeze") {
    const manifest = build(root);
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ file, fingerprint: manifest.fingerprint,
      source: manifest.source, contract: manifest.contract }, null, 2)}\n`); return;
  }
  const manifest = validate(JSON.parse(fs.readFileSync(file, "utf8")));
  process.stdout.write(`${JSON.stringify({ file, fingerprint: manifest.fingerprint,
    source: manifest.source, contract: manifest.contract }, null, 2)}\n`);
}

if (require.main === module) main();
module.exports = { SCHEMA, KIND, SALT, MAXIMUM_SCENARIOS, EXCLUSIONS,
  build, validate, load };
