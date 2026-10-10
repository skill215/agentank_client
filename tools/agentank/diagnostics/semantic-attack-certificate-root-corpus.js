#!/usr/bin/env node
"use strict";

// BP125 materializes every behavior-neutral common-continuation scalar
// certificate as an exact-prefix counterfactual root. EnemyPolicy and
// independent ChanceOutcome remain separate quantifiers for BP126.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { loadCohort } = require("./v2-native-initiative-arena");
const { runReplayBranch, sameTerminal } = require(
  "./root-counterfactual-labels");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function readMatches(directory) {
  const file = path.join(path.resolve(directory), "matches.ndjson.gz");
  const bytes = fs.readFileSync(file);
  const text = zlib.gunzipSync(bytes).toString("utf8").trim();
  return { file, bytes,
    matches: text ? text.split("\n").map(JSON.parse) : [] };
}

function rootKey(match, root) {
  return [match.scenarioFingerprint, match.candidateSeat, root.frame,
    root.hashLo, root.hashHi, root.currentAction, root.currentArgument,
    root.candidateAction, root.candidateArgument].join(":");
}

function sourceTerminal(match) {
  const seat = match.candidateSeat;
  return { outcome: match.analysisOutcome, frame: match.frames,
    reason: match.result?.reason || "UNKNOWN",
    candidateStars: match.counts.stars[seat],
    controlStars: match.counts.stars[seat ^ 1],
    candidateCrashed: Boolean(match.counts.crashes[seat]),
    controlCrashed: Boolean(match.counts.crashes[seat ^ 1]) };
}

function extractCertificates(matches) {
  const roots = []; const seen = new Set();
  let strictDominanceCount = 0; let overflowCount = 0;
  for (const match of matches) {
    const shadow = match.candidateEngine?.semanticAttackPolicyIntervalShadow;
    if (!shadow) continue;
    strictDominanceCount += shadow.strictDominanceCount || 0;
    overflowCount += shadow.certificateOverflowCount || 0;
    for (const root of shadow.certificateRoots || []) {
      const key = rootKey(match, root);
      if (seen.has(key))
        throw new Error("BP125_CERTIFICATE_DUPLICATE:" + key);
      seen.add(key);
      roots.push({ key, matchUrlId: match.matchUrlId,
        scenarioFingerprint: match.scenarioFingerprint,
        candidateSeat: match.candidateSeat, seatSkills: match.seatSkills,
        sourceOutcome: match.analysisOutcome,
        sourceTerminalCategory: match.terminalCategory,
        sourceTerminal: sourceTerminal(match), certificate: root });
    }
  }
  return { roots, strictDominanceCount, overflowCount };
}

function terminalDimensions(terminal) {
  const starDiff = terminal.candidateStars - terminal.controlStars;
  const kill = terminal.controlCrashed && !terminal.candidateCrashed;
  const death = terminal.candidateCrashed && !terminal.controlCrashed;
  const failureType = kill ? "SINGLE_KILL" :
    death ? "SINGLE_DEATH" :
    terminal.candidateCrashed && terminal.controlCrashed ? "MUTUAL_CRASH" :
      terminal.frame >= 128 ? (starDiff < 0 ? "FRAME_LIMIT_STAR_LOSS" :
        starDiff > 0 ? "FRAME_LIMIT_STAR_WIN" : "FRAME_LIMIT_EQUAL_STAR") :
        terminal.reason || "OTHER";
  return { nonloss: terminal.outcome !== "V1_WIN", kill, death, starDiff,
    failureType };
}

function scenarioIndex(scenarios) {
  const output = new Map();
  for (const scenario of scenarios) {
    output.set(scenario.matchUrlId, scenario);
    output.set(scenario.scenarioFingerprint || scenario.fingerprint, scenario);
  }
  return output;
}

function actionRow(actionCode, argument) {
  return { actionCode, argument };
}

function exactEvidence(branch) {
  return branch.evidence.targetFrameSeen &&
    branch.evidence.physicalRootMatched && branch.evidence.forced &&
    branch.evidence.sequenceSatisfied;
}

function transition(left, right) {
  return left.outcome + "_TO_" + right.outcome;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceOption = option("--source");
  if (!sourceOption) throw new Error("BP125_SOURCE_REQUIRED");
  const sourceDirectory = path.resolve(sourceOption);
  const cohortFile = path.resolve(option("--cohort", path.join(root,
    "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const expectedRoots = Number(option("--expected-roots", 64));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative", "bp125-semantic-attack-roots")));
  const source = readMatches(sourceDirectory);
  const extracted = extractCertificates(source.matches);
  if (extracted.overflowCount)
    throw new Error("BP125_CERTIFICATE_OVERFLOW:" + extracted.overflowCount);
  if (extracted.strictDominanceCount !== extracted.roots.length)
    throw new Error("BP125_CERTIFICATE_DENOMINATOR:" +
      extracted.strictDominanceCount + "/" + extracted.roots.length);
  if (expectedRoots > 0 && extracted.roots.length !== expectedRoots)
    throw new Error("BP125_EXPECTED_ROOTS:" + extracted.roots.length + "/" +
      expectedRoots);

  const loaded = loadCohort(root, cohortFile, role);
  const byScenario = scenarioIndex(loaded.scenarios);
  const simulator = await loadSimulator(root);
  const records = []; let missingScenarioCount = 0;
  for (let index = 0; index < extracted.roots.length; index += 1) {
    const item = extracted.roots[index];
    const scenario = byScenario.get(item.scenarioFingerprint) ||
      byScenario.get(item.matchUrlId);
    if (!scenario) { missingScenarioCount += 1; continue; }
    const rootIdentity = { frame: item.certificate.frame,
      hashLo: item.certificate.hashLo, hashHi: item.certificate.hashHi };
    const incumbent = runReplayBranch(simulator.module, rootIdentity,
      actionRow(item.certificate.currentAction,
        item.certificate.currentArgument), scenario, item.candidateSeat, {},
      null, "HISTORICAL");
    const candidate = runReplayBranch(simulator.module, rootIdentity,
      actionRow(item.certificate.candidateAction,
        item.certificate.candidateArgument), scenario, item.candidateSeat, {},
      null, "HISTORICAL");
    const incumbentExact = exactEvidence(incumbent);
    const candidateExact = exactEvidence(candidate);
    const incumbentReproduced = sameTerminal(item.sourceTerminal,
      incumbent.terminal);
    records.push({ schemaVersion: 1,
      objectKind: "SEMANTIC_ATTACK_CERTIFICATE_ROOT_V1",
      key: item.key, matchUrlId: item.matchUrlId,
      scenarioFingerprint: item.scenarioFingerprint,
      candidateSeat: item.candidateSeat, seatSkills: item.seatSkills,
      sourceOutcome: item.sourceOutcome,
      sourceTerminalCategory: item.sourceTerminalCategory,
      certificate: item.certificate,
      quantifiers: { basePolicy: "V2_PRODUCTION_OBSERVABLE",
        enemyPolicy: "V3_HISTORICAL_CONTROLLER",
        chanceOutcome: "HISTORICAL", exactControllerHistory: true },
      incumbent: { terminal: incumbent.terminal,
        dimensions: terminalDimensions(incumbent.terminal),
        evidence: incumbent.evidence, exact: incumbentExact,
        sourceTerminalReproduced: incumbentReproduced },
      candidate: { terminal: candidate.terminal,
        dimensions: terminalDimensions(candidate.terminal),
        evidence: candidate.evidence, exact: candidateExact },
      transition: transition(incumbent.terminal, candidate.terminal) });
    if ((index + 1) % 8 === 0 || index + 1 === extracted.roots.length)
      process.stderr.write("[bp125-root-corpus] " + (index + 1) + "/" +
        extracted.roots.length + "\n");
  }

  const exactIncumbentCount = records.filter(function(record) {
    return record.incumbent.exact;
  }).length;
  const exactCandidateCount = records.filter(function(record) {
    return record.candidate.exact;
  }).length;
  const sourceReproductionCount = records.filter(function(record) {
    return record.incumbent.sourceTerminalReproduced;
  }).length;
  const transitions = {}; const actionPairs = {};
  const failureTypes = { incumbent: {}, candidate: {} };
  const dimensions = {
    incumbent: { nonloss: 0, kill: 0, death: 0, starDiff: 0 },
    candidate: { nonloss: 0, kill: 0, death: 0, starDiff: 0 }
  };
  for (const record of records) {
    transitions[record.transition] = (transitions[record.transition] || 0) + 1;
    const pair = record.certificate.currentAction + ":" +
      record.certificate.currentArgument + "->" +
      record.certificate.candidateAction + ":" +
      record.certificate.candidateArgument;
    actionPairs[pair] = (actionPairs[pair] || 0) + 1;
    for (const side of ["incumbent", "candidate"]) {
      const values = record[side].dimensions;
      const kind = values.failureType;
      failureTypes[side][kind] = (failureTypes[side][kind] || 0) + 1;
      dimensions[side].nonloss += values.nonloss ? 1 : 0;
      dimensions[side].kill += values.kill ? 1 : 0;
      dimensions[side].death += values.death ? 1 : 0;
      dimensions[side].starDiff += values.starDiff;
    }
  }
  const dimensionDelta = {
    nonloss: dimensions.candidate.nonloss - dimensions.incumbent.nonloss,
    kill: dimensions.candidate.kill - dimensions.incumbent.kill,
    death: dimensions.candidate.death - dimensions.incumbent.death,
    starDiff: dimensions.candidate.starDiff - dimensions.incumbent.starDiff
  };
  const accepted = missingScenarioCount === 0 &&
    records.length === extracted.roots.length &&
    exactIncumbentCount === records.length &&
    exactCandidateCount === records.length &&
    sourceReproductionCount === records.length;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_CERTIFICATE_ROOT_CORPUS_OVERVIEW_V1",
    status: accepted ? "ACCEPTED" : "REJECTED", role,
    cohortFingerprint: loaded.manifest.fingerprint,
    sourceMatchCount: source.matches.length,
    strictDominanceCount: extracted.strictDominanceCount,
    certificateRootCount: extracted.roots.length,
    certificateOverflowCount: extracted.overflowCount,
    recordCount: records.length, missingScenarioCount,
    exactIncumbentCount, exactCandidateCount, sourceReproductionCount,
    transitions, actionPairs, failureTypes, dimensions, dimensionDelta,
    quantifierBoundary:
      "BP125 fixes historical EnemyPolicy and ChanceOutcome; it does not claim robust policy/chance dominance." };

  const lines = records.map(function(record) {
    return JSON.stringify(record);
  }).join("\n");
  const rootBytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_CERTIFICATE_ROOT_CORPUS_MANIFEST_V1",
    status: overview.status, sourceDirectory,
    sourceManifestSha256: sha256Bytes(fs.readFileSync(path.join(sourceDirectory,
      "manifest.json"))),
    sourceOverviewSha256: sha256Bytes(fs.readFileSync(path.join(sourceDirectory,
      "overview.json"))), sourceMatchesSha256: sha256Bytes(source.bytes),
    cohortFile, cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    productionRootSha256: sha256Bytes(fs.readFileSync(productionFile)),
    rootsSha256: sha256Bytes(rootBytes), rootCount: records.length,
    arguments: process.argv.slice(2), fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"), rootBytes);
  process.stdout.write(JSON.stringify({ output: outputDirectory,
    overview, fingerprint: manifest.fingerprint }, null, 2) + "\n");
  if (!accepted) throw new Error("BP125_ROOT_CORPUS_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(function(error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { readMatches, rootKey, extractCertificates, sourceTerminal,
  terminalDimensions, scenarioIndex, exactEvidence, transition, build };
