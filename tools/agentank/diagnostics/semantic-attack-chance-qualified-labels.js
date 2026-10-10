#!/usr/bin/env node
"use strict";

// BP140-Q0 re-qualifies directional roots over explicit ChanceOutcome sets.
// A single historical stun realization is evidence, not a robust label.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { loadCohort } = require("./v2-native-initiative-arena");
const { runReplayBranch } = require("./root-counterfactual-labels");
const { readMatches, terminalDimensions, exactEvidence, scenarioIndex } = require(
  "./semantic-attack-certificate-root-corpus");
const { extractComparisons } = require(
  "./semantic-attack-comparison-root-corpus");
const {
  DISCOVERY_CHANCE,
  HOLDOUT_CHANCE,
  cell,
  qualify,
  selectCells
} = require("./semantic-attack-chance-interval-corpus");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function readRoots(directory) {
  const absolute = path.resolve(directory);
  const file = path.join(absolute, "roots.ndjson.gz");
  const bytes = fs.readFileSync(file);
  const text = zlib.gunzipSync(bytes).toString("utf8").trim();
  return { directory: absolute, file, bytes,
    roots: text ? text.split("\n").map(JSON.parse) : [] };
}

function historicalCell(root, side) {
  const branch = root[side];
  return cell("HISTORICAL", null, branch.terminal, branch.evidence);
}

function replayCertificate(root) {
  if (root.certificate) return root.certificate;
  const value = root.comparison;
  if (!value) throw new Error("BP140Q0_REPLAY_CERTIFICATE_MISSING:" + root.key);
  const required = ["frame", "hashLo", "hashHi", "currentAction",
    "currentArgument", "candidateAction", "candidateArgument"];
  for (const field of required)
    if (!Number.isSafeInteger(value[field]))
      throw new Error("BP140Q0_REPLAY_CERTIFICATE_FIELD:" + field + ":" +
        root.key);
  return value;
}

function classifyChanceSupport(candidateDiscovery, candidateHoldout,
    incumbentDiscovery, incumbentHoldout, supportComplete) {
  if (!supportComplete) return "INCOMPLETE";
  if (candidateDiscovery.qualified && candidateHoldout.qualified)
    return "ROBUST_CANDIDATE";
  if (incumbentDiscovery.qualified && incumbentHoldout.qualified)
    return "ROBUST_INCUMBENT";
  return "MIXED";
}

function summarize(records) {
  const output = {
    rootCount: records.length,
    cellCount: 0,
    exactCellCount: 0,
    classifications: {
      ROBUST_CANDIDATE: 0,
      ROBUST_INCUMBENT: 0,
      MIXED: 0,
      INCOMPLETE: 0
    },
    candidate: { discoveryQualified: 0, holdoutQualified: 0,
      bothQualified: 0 },
    incumbent: { discoveryQualified: 0, holdoutQualified: 0,
      bothQualified: 0 },
    historicalLabels: {},
    historicalLabelByClassification: {}
  };
  for (const record of records) {
    for (const side of ["incumbent", "candidate"])
      for (const item of record.cells[side]) {
        output.cellCount += 1;
        output.exactCellCount += item.exact ? 1 : 0;
      }
    output.classifications[record.classification] += 1;
    const label = record.historicalLabel;
    output.historicalLabels[label] = (output.historicalLabels[label] || 0) + 1;
    const cross = label + "/" + record.classification;
    output.historicalLabelByClassification[cross] =
      (output.historicalLabelByClassification[cross] || 0) + 1;
    for (const side of ["candidate", "incumbent"]) {
      if (record[side].discovery.qualified)
        output[side].discoveryQualified += 1;
      if (record[side].holdout.qualified)
        output[side].holdoutQualified += 1;
      if (record[side].discovery.qualified &&
          record[side].holdout.qualified)
        output[side].bothQualified += 1;
    }
  }
  return output;
}

function selectReplayRoots(replayRoots, labelRoots) {
  const wanted = new Map(labelRoots.map(root => [root.key, root]));
  if (wanted.size !== labelRoots.length)
    throw new Error("BP140Q0_DUPLICATE_LABEL_KEY");
  const selected = [];
  for (const root of replayRoots) {
    const label = wanted.get(root.key);
    if (!label) continue;
    selected.push({ root, label });
    wanted.delete(root.key);
  }
  if (wanted.size)
    throw new Error("BP140Q0_REPLAY_ROOT_MISSING:" +
      Array.from(wanted.keys()).slice(0, 4).join(","));
  return selected;
}

function replayPrefixIndex(matches) {
  const extracted = extractComparisons(matches);
  if (!extracted.roots.length || extracted.overflowCount ||
      extracted.missingCandidateCount ||
      extracted.completeCount !== extracted.comparisonCount ||
      extracted.comparisonCount !== extracted.roots.length)
    throw new Error("BP140Q0_PREFIX_SOURCE_INCOMPLETE");
  return new Map(extracted.roots.map(item => [item.key, item.replayPrefix]));
}

async function build(root = defaultWorkspaceRoot()) {
  const replayOption = option("--replay-source");
  const labelsOption = option("--labels");
  const prefixOption = option("--prefix-source");
  if (!replayOption) throw new Error("BP140Q0_REPLAY_SOURCE_REQUIRED");
  if (!labelsOption) throw new Error("BP140Q0_LABELS_REQUIRED");
  if (!prefixOption) throw new Error("BP140Q0_PREFIX_SOURCE_REQUIRED");
  const replaySource = readRoots(replayOption);
  const labels = readRoots(labelsOption);
  const prefixSource = readMatches(prefixOption);
  const prefixes = replayPrefixIndex(prefixSource.matches);
  const expectedRoots = Number(option("--expected-roots", 35));
  const selected = selectReplayRoots(replaySource.roots, labels.roots);
  if (expectedRoots > 0 && selected.length !== expectedRoots)
    throw new Error("BP140Q0_ROOT_DENOMINATOR:" + selected.length + "/" +
      expectedRoots);

  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp140q0-semantic-attack-chance-qualified-labels")));
  const cohortFile = path.resolve(option("--cohort", path.join(root,
    "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const loaded = loadCohort(root, cohortFile, role);
  const scenarios = scenarioIndex(loaded.scenarios);
  const simulator = await loadSimulator(root);
  const randomOutcomes = DISCOVERY_CHANCE.slice(1).concat(HOLDOUT_CHANCE);
  const records = [];
  let missingScenarioCount = 0;

  for (let index = 0; index < selected.length; index += 1) {
    const replay = selected[index].root;
    const label = selected[index].label;
    const certificate = replayCertificate(replay);
    const replayPrefix = prefixes.get(replay.key);
    if (!replayPrefix)
      throw new Error("BP140Q0_REPLAY_PREFIX_MISSING:" + replay.key);
    const scenario = scenarios.get(replay.scenarioFingerprint) ||
      scenarios.get(replay.matchUrlId);
    if (!scenario) { missingScenarioCount += 1; continue; }
    const identity = { frame: certificate.frame,
      hashLo: certificate.hashLo,
      hashHi: certificate.hashHi };
    const cells = { incumbent: [historicalCell(replay, "incumbent")],
      candidate: [historicalCell(replay, "candidate")] };
    for (const chanceOutcome of randomOutcomes)
      for (const side of ["incumbent", "candidate"]) {
        const prefix = side === "incumbent" ? "current" : "candidate";
        const branch = runReplayBranch(simulator.module, identity, {
          actionCode: certificate[prefix + "Action"],
          argument: certificate[prefix + "Argument"]
        }, scenario, replay.candidateSeat, {}, null, chanceOutcome, null,
        replayPrefix);
        cells[side].push(cell(chanceOutcome, branch.chanceSeed,
          branch.terminal, branch.evidence));
      }
    for (const side of ["incumbent", "candidate"])
      for (const item of cells[side])
        item.exact = exactEvidence({ evidence: item.evidence });
    const supportComplete = cells.incumbent.concat(cells.candidate)
      .every(item => item.exact);
    const candidate = {
      discovery: qualify(
        selectCells(cells.incumbent, DISCOVERY_CHANCE),
        selectCells(cells.candidate, DISCOVERY_CHANCE)),
      holdout: qualify(
        selectCells(cells.incumbent, HOLDOUT_CHANCE),
        selectCells(cells.candidate, HOLDOUT_CHANCE))
    };
    const incumbent = {
      discovery: qualify(
        selectCells(cells.candidate, DISCOVERY_CHANCE),
        selectCells(cells.incumbent, DISCOVERY_CHANCE)),
      holdout: qualify(
        selectCells(cells.candidate, HOLDOUT_CHANCE),
        selectCells(cells.incumbent, HOLDOUT_CHANCE))
    };
    const classification = classifyChanceSupport(candidate.discovery,
      candidate.holdout, incumbent.discovery, incumbent.holdout,
      supportComplete);
    records.push({ schemaVersion: 1,
      objectKind: "SEMANTIC_ATTACK_CHANCE_QUALIFIED_ROOT_V1",
      key: replay.key,
      matchUrlId: replay.matchUrlId,
      scenarioFingerprint: replay.scenarioFingerprint,
      candidateSeat: replay.candidateSeat,
      certificate,
      historicalLabel: label.outcomeRelation,
      historicalPareto: label.paretoRelation,
      historicalTransition: replay.transition,
      geometry: label.geometry,
      quantifiers: {
        basePolicy: "V2_PRODUCTION_OBSERVABLE",
        enemyPolicy: "V3_HISTORICAL_CONTROLLER",
        discoveryChance: DISCOVERY_CHANCE.slice(),
        holdoutChance: HOLDOUT_CHANCE.slice(),
        exactControllerHistory: true
      },
      supportComplete, classification, cells, candidate, incumbent });
    if ((index + 1) % 4 === 0 || index + 1 === selected.length)
      process.stderr.write("[bp140q0-chance-label] " + (index + 1) + "/" +
        selected.length + "\n");
  }

  const summary = summarize(records);
  const accepted = missingScenarioCount === 0 &&
    records.length === selected.length &&
    summary.exactCellCount === summary.cellCount;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_CHANCE_QUALIFIED_OVERVIEW_V1",
    status: accepted ? "ACCEPT_CHANCE_LABELS_QUALIFIED" : "REJECTED",
    role, cohortFingerprint: loaded.manifest.fingerprint,
    replayRootCount: replaySource.roots.length,
    labelRootCount: labels.roots.length,
    selectedRootCount: selected.length,
    missingScenarioCount,
    discoveryChance: DISCOVERY_CHANCE.slice(),
    holdoutChance: HOLDOUT_CHANCE.slice(),
    ...summary,
    decisionBoundary:
      "Offline truth-label qualification only. MIXED roots cannot train or activate a production owner."
  };
  const lines = records.map(record => JSON.stringify(record)).join("\n");
  const recordBytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_CHANCE_QUALIFIED_MANIFEST_V1",
    status: overview.status,
    replaySource: replaySource.directory,
    labelSource: labels.directory,
    prefixSource: path.resolve(prefixOption),
    replayManifestSha256: sha256Bytes(fs.readFileSync(path.join(
      replaySource.directory, "manifest.json"))),
    replayOverviewSha256: sha256Bytes(fs.readFileSync(path.join(
      replaySource.directory, "overview.json"))),
    replayRootsSha256: sha256Bytes(replaySource.bytes),
    labelManifestSha256: sha256Bytes(fs.readFileSync(path.join(
      labels.directory, "manifest.json"))),
    labelOverviewSha256: sha256Bytes(fs.readFileSync(path.join(
      labels.directory, "overview.json"))),
    labelRootsSha256: sha256Bytes(labels.bytes),
    prefixManifestSha256: sha256Bytes(fs.readFileSync(path.join(
      path.resolve(prefixOption), "manifest.json"))),
    prefixOverviewSha256: sha256Bytes(fs.readFileSync(path.join(
      path.resolve(prefixOption), "overview.json"))),
    prefixMatchesSha256: sha256Bytes(prefixSource.bytes),
    cohortFile,
    cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    productionRootSha256: sha256Bytes(fs.readFileSync(productionFile)),
    recordsSha256: sha256Bytes(recordBytes),
    rootCount: records.length,
    arguments: process.argv.slice(2),
    fingerprint: ""
  };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"), recordBytes);
  process.stdout.write(JSON.stringify({ output: outputDirectory,
    overview, fingerprint: manifest.fingerprint }, null, 2) + "\n");
  if (!accepted) throw new Error("BP140Q0_CHANCE_LABELS_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { readRoots, historicalCell, replayCertificate,
  classifyChanceSupport, summarize, selectReplayRoots, replayPrefixIndex,
  build };
