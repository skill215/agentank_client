#!/usr/bin/env node
"use strict";

// BP147B freezes the cheapest action-owner proof scheduler supported by the
// BP147A blind split.  It consumes artifacts only; production remains intact.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { readRoots } = require("./semantic-attack-chance-qualified-labels");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function needsActionCertificate(root) {
  return Boolean(root.label.safeThreat && !root.features.selectedIsFire);
}

function schedulerMatches(root) {
  // Both fields already exist at the decision boundary: selectedIsFire comes
  // from the selected action, and ControlModeRouter.context.clearLine caches
  // the ray bit computed during root classification.
  return Boolean(root.features.clearLineToEnemy &&
    !root.features.selectedIsFire);
}

function evaluate(records, proofByKey) {
  const output = { rootCount: records.length, actionableCertificateCount: 0,
    scheduledCount: 0, truePositive: 0, falsePositive: 0, falseNegative: 0,
    trueNegative: 0, doomedActionableCount: 0, doomedCoveredCount: 0,
    allProofNodes: 0, scheduledProofNodes: 0, scheduledBySource: {},
    actionableBySource: {} };
  for (const root of records) {
    const proof = proofByKey.get(root.key);
    if (!proof) throw new Error("BP147B_PROOF_MISSING:" + root.key);
    const target = needsActionCertificate(root); const hit = schedulerMatches(root);
    output.actionableCertificateCount += target ? 1 : 0;
    output.scheduledCount += hit ? 1 : 0;
    output.allProofNodes += proof.totalNodes | 0;
    if (hit) {
      output.scheduledProofNodes += proof.totalNodes | 0;
      output.scheduledBySource[root.sourceClass] =
        (output.scheduledBySource[root.sourceClass] || 0) + 1;
    }
    if (target) output.actionableBySource[root.sourceClass] =
      (output.actionableBySource[root.sourceClass] || 0) + 1;
    if (hit && target) output.truePositive += 1;
    else if (hit) output.falsePositive += 1;
    else if (target) output.falseNegative += 1;
    else output.trueNegative += 1;
    if (root.label.doomedTarget && !root.features.selectedIsFire) {
      output.doomedActionableCount += 1;
      output.doomedCoveredCount += hit ? 1 : 0;
    }
  }
  output.recallPermille = output.actionableCertificateCount ?
    Math.floor(output.truePositive * 1000 / output.actionableCertificateCount) : 0;
  output.precisionPermille = output.scheduledCount ?
    Math.floor(output.truePositive * 1000 / output.scheduledCount) : 0;
  output.rootReductionPermille = output.rootCount ?
    Math.floor((output.rootCount - output.scheduledCount) * 1000 /
      output.rootCount) : 0;
  output.nodeReductionPermille = output.allProofNodes ?
    Math.floor((output.allProofNodes - output.scheduledProofNodes) * 1000 /
      output.allProofNodes) : 0;
  return output;
}

function build(root = defaultWorkspaceRoot()) {
  const censusDirectory = path.resolve(option("--census", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp147-semantic-attack-certificate-feature-census")));
  const proofDirectory = path.resolve(option("--proof-source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp145-semantic-attack-real-event-proof-v2")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp147-semantic-attack-certificate-scheduler-evidence")));
  const census = readRoots(censusDirectory); const proof = readRoots(proofDirectory);
  const proofByKey = new Map(proof.roots.map(item => [item.key, item]));
  const discoveryRoots = census.roots.filter(item => item.split === "DISCOVERY");
  const holdoutRoots = census.roots.filter(item => item.split === "HOLDOUT");
  const discovery = evaluate(discoveryRoots, proofByKey);
  const holdout = evaluate(holdoutRoots, proofByKey);
  const all = evaluate(census.roots, proofByKey);
  const accepted = discovery.falseNegative === 0 && holdout.falseNegative === 0 &&
    all.falseNegative === 0 && all.doomedCoveredCount ===
      all.doomedActionableCount && holdout.rootReductionPermille >= 750 &&
    all.nodeReductionPermille >= 900;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_CERTIFICATE_SCHEDULER_OVERVIEW_V1",
    status: accepted ? "ACCEPT_SHADOW_SCHEDULER_EVIDENCE" : "REJECTED",
    scheduler: {
      expression: "ControlModeRouter.context.clearLine && selectedAction !== FIRE",
      inputsAlreadyComputed: true, actionOwnership: false,
      proofRemainsOwnerVerifier: true }, discovery, holdout, all,
    decisionBoundary: "The scheduler may only decide whether to invoke the strict BP145 proof. It cannot emit FIRE, convert UNKNOWN to safe, or bypass Hard. Production integration requires a separate causal acceptance stage." };
  const scheduled = census.roots.filter(schedulerMatches).map(item => ({
    key: item.key, split: item.split, sourceClass: item.sourceClass,
    actionableCertificate: needsActionCertificate(item),
    safeThreat: Boolean(item.label.safeThreat),
    doomedTarget: Boolean(item.label.doomedTarget),
    selectedAction: item.selectedAction,
    distance: item.features.distance,
    proofNodes: proofByKey.get(item.key).totalNodes | 0
  }));
  const lines = scheduled.map(item => JSON.stringify(item)).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_CERTIFICATE_SCHEDULER_MANIFEST_V1",
    status: overview.status, censusDirectory, proofDirectory,
    censusRootsSha256: sha256Bytes(census.bytes),
    proofRootsSha256: sha256Bytes(proof.bytes),
    productionRootSha256: sha256Bytes(fs.readFileSync(productionFile)),
    scheduledRootsSha256: sha256Bytes(bytes), scheduledCount: scheduled.length,
    arguments: process.argv.slice(2), fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "scheduled.ndjson.gz"), bytes);
  process.stdout.write(JSON.stringify({ output: outputDirectory, overview,
    fingerprint: manifest.fingerprint }, null, 2) + "\n");
  if (!accepted) throw new Error("BP147B_SCHEDULER_REJECTED");
  return { output: outputDirectory, manifest, overview, scheduled };
}

if (require.main === module) {
  try { build(); } catch (error) {
    process.stderr.write((error.stack || error.message) + "\n");
    process.exitCode = 1;
  }
}

module.exports = { needsActionCertificate, schedulerMatches, evaluate, build };
