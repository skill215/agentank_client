#!/usr/bin/env node
"use strict";

// BP150A replays BP149's 100 scheduled real roots and compares the new
// production-tree proof component with the frozen diagnostic oracle.  The
// component is default-disabled in ProductionRoot. This differential invokes
// the standalone arena directly and cannot change an action.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { ProductionDiagnosticBot } = require(
  "../simulation/production-diagnostic-bot");
const { field, loadCohort } = require("./v2-native-initiative-arena");
const { scenarioIndex } = require("./semantic-attack-certificate-root-corpus");
const { readRoots } = require("./semantic-attack-chance-qualified-labels");
const { groupRoots, exactPhysicalRoot } = require(
  "./semantic-attack-real-event-proof");
const { schedulerMatches } = require(
  "./semantic-attack-certificate-scheduler-evidence");
const { RecordedActionBot, RecordedProductionShadowBot,
  installRecordedSkillEmitter, actionArgument } = require(
  "./semantic-attack-real-opportunity-corpus");
const { ownedTypedArrayBytes } = require(
  "./semantic-attack-preallocated-proof-arena");
const { StrictSafeThreatFireProofArena } = require(
  "../../../engine-v2/src/search/strict-safe-threat-fire-proof");
const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function hotAllocationCount(arena) {
  return (arena.hotAllocationCount || 0) +
    (arena.search.hotAllocationCount || 0) +
    (arena.search.settlement.hotAllocationCount || 0) +
    (arena.search.settlement.timeline.hotAllocationCount || 0) +
    (arena.search.settlement.reverse.hotAllocationCount || 0) +
    (arena.kernel.hotAllocationCount || 0) +
    (arena.hazard.hotAllocationCount || 0) +
    (arena.hard.hotAllocationCount || 0);
}

function expectedOverall(record) {
  return record.expectedClassification === "PROVEN_ALL_WORLDS" ?
    PROOF_STATUS.PROVEN : PROOF_STATUS.UNKNOWN;
}

function summarize(records) {
  const output = { rootCount: records.length, exactCount: 0,
    statusMismatchCount: 0, supportMismatchCount: 0, nodeMismatchCount: 0,
    overallMismatchCount: 0, budgetStopCount: 0, ttCapacityStopCount: 0,
    restoreFailureCount: 0, supportLossCount: 0, hotAllocationCount: 0,
    totalNodes: 0, maximumNodes: 0, maximumOwnedTypedArrayBytes: 0,
    provenCount: 0, unknownCount: 0 };
  for (const record of records) {
    output.exactCount += record.exact ? 1 : 0;
    output.statusMismatchCount += record.statusMismatch ? 1 : 0;
    output.supportMismatchCount += record.supportMismatch ? 1 : 0;
    output.nodeMismatchCount += record.nodeMismatch ? 1 : 0;
    output.overallMismatchCount += record.overallMismatch ? 1 : 0;
    output.budgetStopCount += record.budgetStops;
    output.ttCapacityStopCount += record.ttStops;
    output.restoreFailureCount += record.restoreFailures;
    output.supportLossCount += record.supportLoss;
    output.hotAllocationCount = Math.max(output.hotAllocationCount,
      record.hotAllocationCount);
    output.totalNodes += record.totalNodes;
    output.maximumNodes = Math.max(output.maximumNodes, record.totalNodes);
    output.maximumOwnedTypedArrayBytes = Math.max(
      output.maximumOwnedTypedArrayBytes, record.ownedTypedArrayBytes);
    if (record.overallStatus === PROOF_STATUS.PROVEN) output.provenCount += 1;
    else output.unknownCount += 1;
  }
  output.meanNodes = Math.floor(output.totalNodes /
    Math.max(1, output.rootCount));
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--root-source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp144-semantic-attack-real-opportunity-corpus-v4")));
  const censusDirectory = path.resolve(option("--census", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp147-semantic-attack-certificate-feature-census")));
  const oracleDirectory = path.resolve(option("--oracle", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp149-semantic-attack-preallocated-proof-arena")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp150-semantic-attack-production-proof-differential")));
  const cohortFile = path.resolve(option("--cohort", path.join(root,
    "config", "engine-v2", "strategic-attack-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const expectedRoots = Number(option("--expected-roots", 100));
  const sources = readRoots(sourceDirectory); const census = readRoots(censusDirectory);
  const oracle = readRoots(oracleDirectory);
  const sourceByKey = new Map(sources.roots.map(item => [item.key, item]));
  const oracleByKey = new Map(oracle.roots.map(item => [item.key, item]));
  const selectedCensus = census.roots.filter(schedulerMatches);
  const selectedSources = selectedCensus.map(item => sourceByKey.get(item.key));
  if (selectedSources.some(item => !item)) throw new Error("BP150_SOURCE_MISSING");
  if (selectedSources.length !== expectedRoots || oracle.roots.length !== expectedRoots)
    throw new Error("BP150_ROOT_DENOMINATOR:" + selectedSources.length + "/" +
      oracle.roots.length + "/" + expectedRoots);
  const groups = groupRoots(selectedSources);
  const loaded = loadCohort(root, cohortFile, role);
  const scenarios = scenarioIndex(loaded.scenarios);
  const simulator = await loadSimulator(root); const records = [];
  let replayMismatchCount = 0; let schedulerMismatchCount = 0;
  let groupIndex = 0;
  for (const roots of groups.values()) {
    const exemplar = roots[0]; const prefix = exemplar.replayPrefix;
    const scenario = scenarios.get(exemplar.scenarioFingerprint) ||
      scenarios.get(exemplar.matchUrlId);
    if (!scenario) throw new Error("BP150_SCENARIO_MISSING:" + exemplar.key);
    const actions = Buffer.from(prefix.candidateActionStream, "base64");
    const byIndex = new Map();
    for (const sourceRoot of roots) {
      const bucket = byIndex.get(sourceRoot.decisionIndex) || [];
      bucket.push(sourceRoot); byIndex.set(sourceRoot.decisionIndex, bucket);
    }
    let decisionIndex = 0; let arena = null;
    const shadow = new ProductionDiagnosticBot({ captureExceptionalFrames: false,
      diagnosticFinalActionOverride(engine, selectedAction) {
        const index = decisionIndex++; const code = actions[index] ?? ACTION.NONE;
        const targets = byIndex.get(index) || [];
        if (targets.length && !arena)
          arena = new StrictSafeThreatFireProofArena(engine.adapter.state);
        for (const sourceRoot of targets) {
          const oracleRoot = oracleByKey.get(sourceRoot.key);
          if (!oracleRoot) throw new Error("BP150_ORACLE_MISSING:" + sourceRoot.key);
          const liveSchedule = Boolean(engine.controlMode.context.clearLine &&
            selectedAction !== ACTION.FIRE);
          if (!liveSchedule) schedulerMismatchCount += 1;
          const overallStatus = arena.evaluate(engine.adapter.bundle,
            engine.enemyActions, engine.enemyArguments, engine.enemyCount);
          const expected = oracleRoot.modes.SHARED_TT64;
          const status = Array.from(arena.status);
          const support = Array.from(arena.support);
          const nodes = Array.from(arena.nodes);
          records.push({ schemaVersion: 1,
            objectKind: "SEMANTIC_ATTACK_PRODUCTION_PROOF_DIFFERENTIAL_ROOT_V1",
            key: sourceRoot.key, sourceClass: sourceRoot.sourceClass,
            exact: exactPhysicalRoot(engine, sourceRoot), status, support, nodes,
            overallStatus, expectedOverallStatus: expectedOverall(oracleRoot),
            statusMismatch: Number(status.some((value, at) =>
              value !== expected.status[at])),
            supportMismatch: Number(support.some((value, at) =>
              value !== expected.support[at])),
            nodeMismatch: Number(nodes.some((value, at) =>
              value !== expected.nodes[at])),
            overallMismatch: Number(overallStatus !== expectedOverall(oracleRoot)),
            totalNodes: arena.lastTotalNodes,
            budgetStops: arena.lastBudgetStops, ttStops: arena.lastTtStops,
            restoreFailures: arena.lastRestoreFailures,
            supportLoss: arena.lastSupportLoss,
            ownedTypedArrayBytes: ownedTypedArrayBytes(arena, engine.adapter.state),
            hotAllocationCount: hotAllocationCount(arena) });
        }
        return { action: code, argument: actionArgument(engine, code,
          prefix.candidateArguments, index) };
      } });
    installRecordedSkillEmitter(shadow.engine);
    const candidate = new RecordedProductionShadowBot(shadow,
      prefix.candidateActionStream, prefix.candidateArguments);
    const opponent = new RecordedActionBot(prefix.controlActionStream,
      prefix.controlArguments);
    const built = field(simulator.module, scenario, exemplar.attackSeat,
      exemplar.seatSkills);
    const bots = exemplar.attackSeat === 0 ? [candidate, opponent] :
      [opponent, candidate];
    built.simulator.run(bots[0], bots[1]);
    if (candidate.index !== candidate.actions.length ||
        decisionIndex !== candidate.actions.length ||
        candidate.shadowOutputMismatchCount !== 0 ||
        opponent.index !== opponent.actions.length) replayMismatchCount += 1;
    groupIndex += 1;
    if (groupIndex % 16 === 0 || groupIndex === groups.size)
      process.stderr.write("[bp150-production-proof] " + groupIndex + "/" +
        groups.size + " roots=" + records.length + "\n");
  }
  records.sort((left, right) => left.key.localeCompare(right.key));
  const summary = summarize(records);
  const accepted = records.length === expectedRoots && replayMismatchCount === 0 &&
    schedulerMismatchCount === 0 && summary.exactCount === records.length &&
    summary.statusMismatchCount === 0 && summary.supportMismatchCount === 0 &&
    summary.nodeMismatchCount === 0 && summary.overallMismatchCount === 0 &&
    summary.budgetStopCount === 0 && summary.ttCapacityStopCount === 0 &&
    summary.restoreFailureCount === 0 && summary.hotAllocationCount === 0;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_PRODUCTION_PROOF_DIFFERENTIAL_OVERVIEW_V1",
    status: accepted ? "ACCEPT_PRODUCTION_PROOF_DIFFERENTIAL" : "REJECTED",
    role, cohortFingerprint: loaded.manifest.fingerprint,
    replayGroupCount: groups.size, replayMismatchCount, schedulerMismatchCount,
    maximumDepth: 6, nodeBudget: 64, ttCapacity: 64, ...summary,
    decisionBoundary: "Standalone production-tree equivalence only. Default ProductionRoot does not construct this proof. Explicit Shadow/causal-POC modes are separately qualified and remain disabled by default." };
  const lines = records.map(record => JSON.stringify(record)).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const proofFile = path.join(root, "engine-v2", "src", "search",
    "strict-safe-threat-fire-proof.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_PRODUCTION_PROOF_DIFFERENTIAL_MANIFEST_V1",
    status: overview.status, sourceDirectory, censusDirectory, oracleDirectory,
    sourceRootsSha256: sha256Bytes(sources.bytes),
    censusRootsSha256: sha256Bytes(census.bytes),
    oracleRootsSha256: sha256Bytes(oracle.bytes), cohortFile,
    cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    productionRootSha256: sha256Bytes(fs.readFileSync(productionFile)),
    productionProofSha256: sha256Bytes(fs.readFileSync(proofFile)),
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
  if (!accepted) throw new Error("BP150_PRODUCTION_PROOF_DIFFERENTIAL_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(error => {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { hotAllocationCount, expectedOverall, summarize, build };
