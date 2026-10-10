#!/usr/bin/env node
"use strict";

// BP148 expands BP146 from four missed-FIRE roots to every BP147 root where a
// strict certificate exists and current V2 does not already emit FIRE.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { field, loadCohort } = require("./v2-native-initiative-arena");
const { scenarioIndex } = require("./semantic-attack-certificate-root-corpus");
const { readRoots } = require("./semantic-attack-chance-qualified-labels");
const { runArm, transition, outcomePoints } = require(
  "./semantic-attack-real-event-active-poc");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function emptyExecutablePolicies(proof) {
  return proof.goals.filter(goal => goal.executable).every(goal =>
    (goal.mergedPolicy?.entries?.length || 0) === 0);
}

function selectActionable(proofRoots, sourceRoots, censusRoots) {
  const source = new Map(sourceRoots.map(root => [root.key, root]));
  const census = new Map(censusRoots.map(root => [root.key, root]));
  const selected = [];
  for (const proof of proofRoots) {
    const feature = census.get(proof.key);
    if (!feature || !feature.label.safeThreat ||
        feature.features.selectedIsFire) continue;
    const root = source.get(proof.key);
    if (!root) throw new Error("BP148_SOURCE_ROOT_MISSING:" + proof.key);
    if (!emptyExecutablePolicies(proof))
      throw new Error("BP148_CONTINUATION_POLICY_REQUIRED:" + proof.key);
    selected.push({ proof, root, feature });
  }
  return selected;
}

function summarize(records) {
  const output = { rootCount: records.length, transitions: {}, bySource: {},
    controlPoints: 0, activePoints: 0, positiveCount: 0, negativeCount: 0,
    equalCount: 0, exactArmCount: 0, targetSeenArmCount: 0,
    preOverrideMismatchCount: 0, fireHardFailureCount: 0,
    hardFailureCount: 0, restoreFailureCount: 0 };
  for (const record of records) {
    const key = transition(record.control.terminal, record.active.terminal);
    output.transitions[key] = (output.transitions[key] || 0) + 1;
    const source = output.bySource[record.sourceClass] ||
      (output.bySource[record.sourceClass] = { roots: 0, positive: 0,
        negative: 0, equal: 0, pointDelta: 0 });
    source.roots += 1;
    const control = outcomePoints(record.control.terminal.outcome);
    const active = outcomePoints(record.active.terminal.outcome);
    output.controlPoints += control; output.activePoints += active;
    source.pointDelta += active - control;
    if (active > control) { output.positiveCount += 1; source.positive += 1; }
    else if (active < control) { output.negativeCount += 1; source.negative += 1; }
    else { output.equalCount += 1; source.equal += 1; }
    for (const arm of [record.control, record.active]) {
      output.exactArmCount += arm.rootExact ? 1 : 0;
      output.targetSeenArmCount += arm.targetSeen ? 1 : 0;
      output.preOverrideMismatchCount += arm.preOverrideAction ===
        record.expectedPreOverrideAction ? 0 : 1;
      output.fireHardFailureCount += arm.fireHardAllowed ? 0 : 1;
      output.hardFailureCount += arm.hardRejects || 0;
      output.restoreFailureCount += arm.rootRestoreFailures || 0;
    }
  }
  output.pointDelta = output.activePoints - output.controlPoints;
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const proofDirectory = path.resolve(option("--proof-source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp145-semantic-attack-real-event-proof-v2")));
  const sourceDirectory = path.resolve(option("--root-source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp144-semantic-attack-real-opportunity-corpus-v4")));
  const censusDirectory = path.resolve(option("--census", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp147-semantic-attack-certificate-feature-census")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp148-semantic-attack-actionable-certificate-active-poc")));
  const cohortFile = path.resolve(option("--cohort", path.join(root,
    "config", "engine-v2", "strategic-attack-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const expectedRoots = Number(option("--expected-roots", 22));
  const proofs = readRoots(proofDirectory); const sources = readRoots(sourceDirectory);
  const census = readRoots(censusDirectory);
  const selected = selectActionable(proofs.roots, sources.roots, census.roots);
  if (selected.length !== expectedRoots)
    throw new Error("BP148_ROOT_DENOMINATOR:" + selected.length + "/" +
      expectedRoots);
  const loaded = loadCohort(root, cohortFile, role);
  const scenarios = scenarioIndex(loaded.scenarios);
  const simulator = await loadSimulator(root); const records = [];
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index]; const source = item.root;
    const scenario = scenarios.get(source.scenarioFingerprint) ||
      scenarios.get(source.matchUrlId);
    if (!scenario) throw new Error("BP148_SCENARIO_MISSING:" + source.key);
    const control = runArm(simulator.module, scenario, source, false);
    const active = runArm(simulator.module, scenario, source, true);
    records.push({ schemaVersion: 1,
      objectKind: "SEMANTIC_ATTACK_ACTIONABLE_CERTIFICATE_ACTIVE_ROOT_V1",
      key: source.key, sourceClass: item.proof.sourceClass,
      matchUrlId: source.matchUrlId,
      scenarioFingerprint: source.scenarioFingerprint,
      attackSeat: source.attackSeat, seatSkills: source.seatSkills,
      frame: source.frame, decisionIndex: source.decisionIndex,
      split: item.feature.split,
      expectedPreOverrideAction: item.feature.selectedAction,
      proofGoals: item.proof.goals.filter(goal => goal.executable)
        .map(goal => goal.name), control, active,
      transition: transition(control.terminal, active.terminal) });
    if ((index + 1) % 8 === 0 || index + 1 === selected.length)
      process.stderr.write("[bp148-actionable-active] " + (index + 1) + "/" +
        selected.length + "\n");
  }
  const summary = summarize(records); const expectedArms = records.length * 2;
  const accepted = records.length === expectedRoots &&
    summary.exactArmCount === expectedArms &&
    summary.targetSeenArmCount === expectedArms &&
    summary.preOverrideMismatchCount === 0 &&
    summary.fireHardFailureCount === 0 && summary.hardFailureCount === 0 &&
    summary.restoreFailureCount === 0;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_ACTIONABLE_CERTIFICATE_ACTIVE_OVERVIEW_V1",
    status: accepted ? "ACCEPT_ACTIVE_POC_MEASURED" : "REJECTED", role,
    cohortFingerprint: loaded.manifest.fingerprint,
    selectedRootCount: selected.length, ...summary,
    decisionBoundary: "Exact-root one-action causal POC. ACTIVE changes only the certified root to FIRE; current V2 owns every later candidate action and deterministic V3 owns the opponent suffix. The result measures this corpus and is not production approval." };
  const lines = records.map(record => JSON.stringify(record)).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_ACTIONABLE_CERTIFICATE_ACTIVE_MANIFEST_V1",
    status: overview.status, proofDirectory, sourceDirectory, censusDirectory,
    proofRootsSha256: sha256Bytes(proofs.bytes),
    sourceRootsSha256: sha256Bytes(sources.bytes),
    censusRootsSha256: sha256Bytes(census.bytes), cohortFile,
    cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    productionRootSha256: sha256Bytes(fs.readFileSync(productionFile)),
    recordsSha256: sha256Bytes(bytes), rootCount: records.length,
    arguments: process.argv.slice(2), fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"), bytes);
  process.stdout.write(JSON.stringify({ output: outputDirectory, overview,
    fingerprint: manifest.fingerprint }, null, 2) + "\n");
  if (!accepted) throw new Error("BP148_ACTIVE_POC_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(error => {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { emptyExecutablePolicies, selectActionable, summarize, build };
