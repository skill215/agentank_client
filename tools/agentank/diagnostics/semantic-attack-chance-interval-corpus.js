#!/usr/bin/env node
"use strict";

// BP126 expands the accepted BP125 physical root identities over independent
// future star streams. Enemy policy remains fixed. Discovery and Chance
// holdout are explicit, immutable quantifiers rather than an unlabeled group.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { loadCohort } = require("./v2-native-initiative-arena");
const { runReplayBranch } = require("./root-counterfactual-labels");
const { terminalDimensions, exactEvidence, scenarioIndex } = require(
  "./semantic-attack-certificate-root-corpus");

const DISCOVERY_CHANCE = Object.freeze([
  "HISTORICAL", "RANDOM0", "RANDOM1", "RANDOM2"
]);
const HOLDOUT_CHANCE = Object.freeze([
  "RANDOM3", "RANDOM4", "RANDOM5", "RANDOM6"
]);

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function readRoots(directory) {
  const file = path.join(path.resolve(directory), "roots.ndjson.gz");
  const bytes = fs.readFileSync(file);
  const text = zlib.gunzipSync(bytes).toString("utf8").trim();
  return { file, bytes, roots: text ? text.split("\n").map(JSON.parse) : [] };
}

function outcomeRank(outcome) {
  return outcome === "V2_WIN" ? 2 : outcome === "DRAW" ? 1 : 0;
}

function cell(chanceOutcome, chanceSeed, terminal, evidence) {
  return { chanceOutcome, chanceSeed, terminal,
    dimensions: terminalDimensions(terminal), evidence,
    exact: evidence ? exactEvidence({ evidence }) : true };
}

function historicalCell(root, side) {
  const branch = root[side];
  return cell("HISTORICAL", null, branch.terminal, branch.evidence);
}

function vector(cells) {
  let worstOutcome = 2; let bestOutcome = 0;
  let nonloss = 0; let kill = 0; let death = 0;
  let minimumStarDiff = 32767; let totalStarDiff = 0;
  for (const item of cells) {
    const rank = outcomeRank(item.terminal.outcome);
    if (rank < worstOutcome) worstOutcome = rank;
    if (rank > bestOutcome) bestOutcome = rank;
    nonloss += item.dimensions.nonloss ? 1 : 0;
    kill += item.dimensions.kill ? 1 : 0;
    death += item.dimensions.death ? 1 : 0;
    if (item.dimensions.starDiff < minimumStarDiff)
      minimumStarDiff = item.dimensions.starDiff;
    totalStarDiff += item.dimensions.starDiff;
  }
  if (!cells.length) minimumStarDiff = 0;
  return { count: cells.length, worstOutcome, bestOutcome, nonloss, kill,
    death, minimumStarDiff, totalStarDiff };
}

function cellsByChance(cells) {
  return new Map(cells.map(function(item) {
    return [item.chanceOutcome, item];
  }));
}

function pairedRelation(incumbentCells, candidateCells) {
  const incumbent = cellsByChance(incumbentCells);
  let outcomeRegression = 0; let deathRegression = 0;
  let killRegression = 0; let comparableStarRegression = 0;
  let strictOutcome = 0; let strictDeath = 0;
  let strictKill = 0; let strictStar = 0;
  for (const candidate of candidateCells) {
    const base = incumbent.get(candidate.chanceOutcome);
    if (!base) throw new Error("BP126_CHANCE_PAIR_MISSING:" +
      candidate.chanceOutcome);
    const baseRank = outcomeRank(base.terminal.outcome);
    const candidateRank = outcomeRank(candidate.terminal.outcome);
    if (candidateRank < baseRank) outcomeRegression += 1;
    else if (candidateRank > baseRank) strictOutcome += 1;
    if (candidate.dimensions.death && !base.dimensions.death)
      deathRegression += 1;
    else if (!candidate.dimensions.death && base.dimensions.death)
      strictDeath += 1;
    if (candidateRank === baseRank) {
      if (base.dimensions.kill && !candidate.dimensions.kill)
        killRegression += 1;
      else if (!base.dimensions.kill && candidate.dimensions.kill)
        strictKill += 1;
      if (!base.dimensions.kill && !candidate.dimensions.kill) {
        if (candidate.dimensions.starDiff < base.dimensions.starDiff)
          comparableStarRegression += 1;
        else if (candidate.dimensions.starDiff > base.dimensions.starDiff)
          strictStar += 1;
      }
    }
  }
  const regressionCount = outcomeRegression + deathRegression +
    killRegression + comparableStarRegression;
  const strictCount = strictOutcome + strictDeath + strictKill + strictStar;
  return { outcomeRegression, deathRegression, killRegression,
    comparableStarRegression, strictOutcome, strictDeath, strictKill,
    strictStar, regressionCount, strictCount,
    noRegression: regressionCount === 0,
    strictNoRegression: regressionCount === 0 && strictCount > 0 };
}

function intervalRelation(incumbentCells, candidateCells) {
  const incumbent = vector(incumbentCells);
  const candidate = vector(candidateCells);
  const terminalNonWorse =
    candidate.worstOutcome >= incumbent.worstOutcome &&
    candidate.nonloss >= incumbent.nonloss &&
    candidate.death <= incumbent.death;
  const terminalStrict =
    candidate.worstOutcome > incumbent.worstOutcome ||
    candidate.nonloss > incumbent.nonloss ||
    candidate.death < incumbent.death ||
    candidate.kill > incumbent.kill;
  const fullNonWorse = terminalNonWorse &&
    candidate.kill >= incumbent.kill &&
    candidate.minimumStarDiff >= incumbent.minimumStarDiff &&
    candidate.totalStarDiff >= incumbent.totalStarDiff;
  const fullStrict = terminalStrict ||
    candidate.minimumStarDiff > incumbent.minimumStarDiff ||
    candidate.totalStarDiff > incumbent.totalStarDiff;
  return { incumbent, candidate,
    terminalDominance: terminalNonWorse && terminalStrict,
    fullVectorDominance: fullNonWorse && fullStrict };
}

function qualify(incumbentCells, candidateCells) {
  const paired = pairedRelation(incumbentCells, candidateCells);
  const interval = intervalRelation(incumbentCells, candidateCells);
  return { paired, interval,
    qualified: paired.strictNoRegression && interval.fullVectorDominance };
}

function selectCells(cells, outcomes) {
  const wanted = new Set(outcomes);
  return cells.filter(function(item) { return wanted.has(item.chanceOutcome); });
}

function summarize(records) {
  const output = {
    rootCount: records.length, exactCellCount: 0, cellCount: 0,
    discovery: { pairedSafe: 0, terminalDominance: 0,
      fullVectorDominance: 0, qualified: 0 },
    holdout: { evaluated: 0, pairedSafe: 0, terminalDominance: 0,
      fullVectorDominance: 0, passed: 0 },
    qualifiedTransitions: {}
  };
  for (const record of records) {
    for (const side of ["incumbent", "candidate"])
      for (const item of record.cells[side]) {
        output.cellCount += 1;
        output.exactCellCount += item.exact ? 1 : 0;
      }
    if (record.discovery.paired.noRegression)
      output.discovery.pairedSafe += 1;
    if (record.discovery.interval.terminalDominance)
      output.discovery.terminalDominance += 1;
    if (record.discovery.interval.fullVectorDominance)
      output.discovery.fullVectorDominance += 1;
    if (record.discovery.qualified) output.discovery.qualified += 1;
    if (record.discovery.qualified) {
      output.holdout.evaluated += 1;
      if (record.holdout.paired.noRegression)
        output.holdout.pairedSafe += 1;
      if (record.holdout.interval.terminalDominance)
        output.holdout.terminalDominance += 1;
      if (record.holdout.interval.fullVectorDominance)
        output.holdout.fullVectorDominance += 1;
      if (record.holdout.qualified) output.holdout.passed += 1;
      const historical = record.historicalTransition;
      output.qualifiedTransitions[historical] =
        (output.qualifiedTransitions[historical] || 0) + 1;
    }
  }
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceOption = option("--source");
  if (!sourceOption) throw new Error("BP126_SOURCE_REQUIRED");
  const sourceDirectory = path.resolve(sourceOption);
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp126-semantic-attack-chance-interval")));
  const cohortFile = path.resolve(option("--cohort", path.join(root,
    "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const expectedRoots = Number(option("--expected-roots", 64));
  const source = readRoots(sourceDirectory);
  if (expectedRoots > 0 && source.roots.length !== expectedRoots)
    throw new Error("BP126_ROOT_DENOMINATOR:" + source.roots.length + "/" +
      expectedRoots);
  const loaded = loadCohort(root, cohortFile, role);
  const scenarios = scenarioIndex(loaded.scenarios);
  const simulator = await loadSimulator(root);
  const records = []; let missingScenarioCount = 0;
  const allRandom = DISCOVERY_CHANCE.slice(1).concat(HOLDOUT_CHANCE);
  for (let index = 0; index < source.roots.length; index += 1) {
    const root = source.roots[index];
    const scenario = scenarios.get(root.scenarioFingerprint) ||
      scenarios.get(root.matchUrlId);
    if (!scenario) { missingScenarioCount += 1; continue; }
    const identity = { frame: root.certificate.frame,
      hashLo: root.certificate.hashLo, hashHi: root.certificate.hashHi };
    const cells = { incumbent: [historicalCell(root, "incumbent")],
      candidate: [historicalCell(root, "candidate")] };
    for (const chanceOutcome of allRandom)
      for (const side of ["incumbent", "candidate"]) {
        const prefix = side === "incumbent" ? "current" : "candidate";
        const branch = runReplayBranch(simulator.module, identity, {
          actionCode: root.certificate[prefix + "Action"],
          argument: root.certificate[prefix + "Argument"]
        }, scenario, root.candidateSeat, {}, null, chanceOutcome);
        cells[side].push(cell(chanceOutcome, branch.chanceSeed,
          branch.terminal, branch.evidence));
      }
    const discovery = qualify(
      selectCells(cells.incumbent, DISCOVERY_CHANCE),
      selectCells(cells.candidate, DISCOVERY_CHANCE));
    const holdout = qualify(
      selectCells(cells.incumbent, HOLDOUT_CHANCE),
      selectCells(cells.candidate, HOLDOUT_CHANCE));
    records.push({ schemaVersion: 1,
      objectKind: "SEMANTIC_ATTACK_CHANCE_INTERVAL_ROOT_V1",
      key: root.key, matchUrlId: root.matchUrlId,
      scenarioFingerprint: root.scenarioFingerprint,
      candidateSeat: root.candidateSeat,
      certificate: root.certificate,
      quantifiers: { basePolicy: "V2_PRODUCTION_OBSERVABLE",
        enemyPolicy: "V3_HISTORICAL_CONTROLLER",
        discoveryChance: DISCOVERY_CHANCE.slice(),
        holdoutChance: HOLDOUT_CHANCE.slice(),
        exactControllerHistory: true },
      historicalTransition: root.transition, cells, discovery, holdout });
    if ((index + 1) % 4 === 0 || index + 1 === source.roots.length)
      process.stderr.write("[bp126-chance] " + (index + 1) + "/" +
        source.roots.length + "\n");
  }
  const summary = summarize(records);
  const accepted = missingScenarioCount === 0 &&
    records.length === source.roots.length &&
    summary.exactCellCount === summary.cellCount;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_CHANCE_INTERVAL_OVERVIEW_V1",
    status: accepted ? "ACCEPTED" : "REJECTED", role,
    cohortFingerprint: loaded.manifest.fingerprint,
    sourceRootCount: source.roots.length, recordCount: records.length,
    missingScenarioCount, discoveryChance: DISCOVERY_CHANCE.slice(),
    holdoutChance: HOLDOUT_CHANCE.slice(), ...summary,
    decisionBoundary:
      "BP126 is offline evidence only. Holdout results do not activate an owner or tune a threshold." };
  const lines = records.map(function(record) {
    return JSON.stringify(record);
  }).join("\n");
  const recordBytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_CHANCE_INTERVAL_MANIFEST_V1",
    status: overview.status, sourceDirectory,
    sourceManifestSha256: sha256Bytes(fs.readFileSync(path.join(sourceDirectory,
      "manifest.json"))),
    sourceOverviewSha256: sha256Bytes(fs.readFileSync(path.join(sourceDirectory,
      "overview.json"))), sourceRootsSha256: sha256Bytes(source.bytes),
    cohortFile, cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    productionRootSha256: sha256Bytes(fs.readFileSync(productionFile)),
    recordsSha256: sha256Bytes(recordBytes), rootCount: records.length,
    arguments: process.argv.slice(2), fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"), recordBytes);
  process.stdout.write(JSON.stringify({ output: outputDirectory,
    overview, fingerprint: manifest.fingerprint }, null, 2) + "\n");
  if (!accepted) throw new Error("BP126_CHANCE_INTERVAL_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { DISCOVERY_CHANCE, HOLDOUT_CHANCE, readRoots, outcomeRank,
  cell, vector, pairedRelation, intervalRelation, qualify, selectCells,
  summarize, build };
