#!/usr/bin/env node
"use strict";

// BP127 joins the observable objective relation recorded at each BP125 root
// with the already-frozen BP126 Chance corpus.  No replay is performed here;
// terminal outcomes are labels used only after the observable relation exists.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { readMatches, extractCertificates } = require(
  "./semantic-attack-certificate-root-corpus");
const { readRoots, qualify, outcomeRank } = require(
  "./semantic-attack-chance-interval-corpus");
const { OBJECTIVE_RELATION } = require(
  "./semantic-attack-objective-progress-interval");

const RELATION_NAME = Object.freeze({
  [OBJECTIVE_RELATION.INCOMPLETE]: "INCOMPLETE",
  [OBJECTIVE_RELATION.CANDIDATE_DOMINATES]: "CANDIDATE_DOMINATES",
  [OBJECTIVE_RELATION.INCUMBENT_DOMINATES]: "INCUMBENT_DOMINATES",
  [OBJECTIVE_RELATION.EQUAL]: "EQUAL",
  [OBJECTIVE_RELATION.INCOMPARABLE]: "INCOMPARABLE"
});

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function emptyBucket() {
  return { rootCount: 0, discoveryNoRegressionCount: 0,
    discoveryQualifiedCount: 0, holdoutNoRegressionCount: 0,
    holdoutQualifiedCount: 0, allChanceNoRegressionCount: 0,
    allChanceStrictNoRegressionCount: 0, allChanceQualifiedCount: 0,
    chanceOutcomeImprovementCount: 0, chanceOutcomeRegressionCount: 0,
    chanceOutcomeEqualCount: 0, pairedRegressionCount: 0 };
}

function addRecord(bucket, record) {
  bucket.rootCount += 1;
  bucket.discoveryNoRegressionCount += record.discoveryNoRegression ? 1 : 0;
  bucket.discoveryQualifiedCount += record.discoveryQualified ? 1 : 0;
  bucket.holdoutNoRegressionCount += record.holdoutNoRegression ? 1 : 0;
  bucket.holdoutQualifiedCount += record.holdoutQualified ? 1 : 0;
  bucket.allChanceNoRegressionCount += record.allChanceNoRegression ? 1 : 0;
  bucket.allChanceStrictNoRegressionCount +=
    record.allChanceStrictNoRegression ? 1 : 0;
  bucket.allChanceQualifiedCount += record.allChanceQualified ? 1 : 0;
  bucket.chanceOutcomeImprovementCount += record.chanceOutcomeImprovementCount;
  bucket.chanceOutcomeRegressionCount += record.chanceOutcomeRegressionCount;
  bucket.chanceOutcomeEqualCount += record.chanceOutcomeEqualCount;
  bucket.pairedRegressionCount += record.pairedRegressionCount;
}

function summarize(records) {
  const byRelation = {};
  const total = emptyBucket();
  for (const record of records) {
    const bucket = byRelation[record.objectiveRelation] ||
      (byRelation[record.objectiveRelation] = emptyBucket());
    addRecord(bucket, record); addRecord(total, record);
  }
  const dominance = byRelation.CANDIDATE_DOMINATES || emptyBucket();
  const rejectedOwner = dominance.rootCount > 0 &&
    dominance.allChanceQualifiedCount === 0;
  return { rootCount: records.length, byRelation, total,
    candidateDominanceCount: dominance.rootCount,
    candidateDominanceRejectionBasis: {
      allChanceNoRegressionCount: dominance.allChanceNoRegressionCount,
      allChanceStrictNoRegressionCount:
        dominance.allChanceStrictNoRegressionCount,
      allChanceQualifiedCount: dominance.allChanceQualifiedCount,
      outcomeImprovementCount: dominance.chanceOutcomeImprovementCount,
      outcomeRegressionCount: dominance.chanceOutcomeRegressionCount
    }, rejectedOwner };
}

function compactRecord(source, chance) {
  const allChance = qualify(chance.cells.incumbent, chance.cells.candidate);
  let improvement = 0; let regression = 0; let equal = 0;
  for (let index = 0; index < chance.cells.incumbent.length; index += 1) {
    const delta = outcomeRank(chance.cells.candidate[index].terminal.outcome) -
      outcomeRank(chance.cells.incumbent[index].terminal.outcome);
    if (delta > 0) improvement += 1;
    else if (delta < 0) regression += 1;
    else equal += 1;
  }
  const certificate = source.certificate;
  return { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_OBJECTIVE_PROGRESS_ROOT_V1",
    key: source.key, scenarioFingerprint: source.scenarioFingerprint,
    candidateSeat: source.candidateSeat, frame: certificate.frame,
    currentAction: certificate.currentAction,
    candidateAction: certificate.candidateAction,
    objectiveRelation: RELATION_NAME[certificate.objectiveRelation] || "UNKNOWN",
    objectiveCurrent: certificate.objectiveCurrent,
    objectiveCandidate: certificate.objectiveCandidate,
    discoveryNoRegression: chance.discovery.paired.noRegression,
    discoveryQualified: chance.discovery.qualified,
    holdoutNoRegression: chance.holdout.paired.noRegression,
    holdoutQualified: chance.holdout.qualified,
    allChanceNoRegression: allChance.paired.noRegression,
    allChanceStrictNoRegression: allChance.paired.strictNoRegression,
    allChanceQualified: allChance.qualified,
    pairedRegressionCount: allChance.paired.regressionCount,
    chanceOutcomeImprovementCount: improvement,
    chanceOutcomeRegressionCount: regression,
    chanceOutcomeEqualCount: equal };
}

async function build(root = defaultWorkspaceRoot()) {
  const shadowDirectory = path.resolve(option("--shadow", path.join(root,
    "artifacts", "v2-native-initiative", "bp127-objective-progress-shadow")));
  const chanceDirectory = path.resolve(option("--chance", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp126-semantic-attack-chance-interval")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp127-semantic-attack-objective-progress")));
  const expectedRoots = Number(option("--expected-roots", 64));
  const shadow = readMatches(shadowDirectory);
  const extracted = extractCertificates(shadow.matches);
  const chance = readRoots(chanceDirectory);
  const chanceByKey = new Map(chance.roots.map(function(record) {
    return [record.key, record];
  }));
  const records = []; let missingChanceRootCount = 0;
  for (const source of extracted.roots) {
    const label = chanceByKey.get(source.key);
    if (!label) { missingChanceRootCount += 1; continue; }
    records.push(compactRecord(source, label));
  }
  const summary = summarize(records);
  const accepted = extracted.overflowCount === 0 && missingChanceRootCount === 0 &&
    extracted.strictDominanceCount === extracted.roots.length &&
    extracted.roots.length === expectedRoots && records.length === expectedRoots;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_OBJECTIVE_PROGRESS_OVERVIEW_V1",
    status: accepted ? "ACCEPT_EVIDENCE_REJECT_OWNER" : "REJECTED",
    sourceRootCount: extracted.roots.length,
    strictDominanceCount: extracted.strictDominanceCount,
    certificateOverflowCount: extracted.overflowCount,
    chanceRootCount: chance.roots.length, missingChanceRootCount,
    ...summary,
    quantifierBoundary:
      "Observable objective vectors are formed before terminal labels. BP126 Chance outcomes are joined offline and never feed the relation.",
    decision: "Objective progress is useful descriptive evidence but is not a sufficient action-ownership certificate." };
  const lines = records.map(JSON.stringify).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_OBJECTIVE_PROGRESS_MANIFEST_V1",
    status: overview.status, shadowDirectory, chanceDirectory,
    shadowManifestSha256: sha256Bytes(fs.readFileSync(path.join(shadowDirectory,
      "manifest.json"))),
    shadowMatchesSha256: sha256Bytes(shadow.bytes),
    chanceManifestSha256: sha256Bytes(fs.readFileSync(path.join(chanceDirectory,
      "manifest.json"))), chanceRootsSha256: sha256Bytes(chance.bytes),
    productionRootSha256: sha256Bytes(fs.readFileSync(productionFile)),
    recordsSha256: sha256Bytes(bytes), arguments: process.argv.slice(2),
    fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"), bytes);
  process.stdout.write(JSON.stringify({ output: outputDirectory, overview,
    fingerprint: manifest.fingerprint }, null, 2) + "\n");
  if (!accepted) throw new Error("BP127_OBJECTIVE_PROGRESS_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { RELATION_NAME, emptyBucket, addRecord, summarize,
  compactRecord, build };
