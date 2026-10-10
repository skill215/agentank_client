#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ProductionDepthSearch, ROOT_INTERVAL_STATUS } = require(
  "../../../engine-v2/src/search/production-depth-search");
const { ProductionCacheBank } = require("../../../engine-v2/src/cache/production-cache");
const { RUNTIME_CONFIG } = require("../../../engine-v2/src/generated/runtime-config");
const { SEARCH_CAPACITY } = require("../../../engine-v2/src/generated/search-config");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { writeJsonAtomic } = require("../core/atomic-file");
const { preparedScenario } = require("./minimax-depth-calibration");

const OBJECT_KIND = "MINIMAX_SUPPORT_FRONTIER_V1";
const SOURCE_FILES = Object.freeze([
  "engine-v2/src/search/production-depth-search.js",
  "engine-v2/src/search/root-transition-slab.js",
  "engine-v2/src/cache/production-cache.js",
  "engine-v2/src/fast/kernel.js",
  "engine-v2/src/fast/hard-gate.js",
  "engine-v2/src/fast/hazard.js",
  "engine-v2/src/generated/search-config.js",
  "engine-v2/src/generated/runtime-config.js"
]);
const HARNESS_FILES = Object.freeze([
  "tools/agentank/diagnostics/minimax-support-frontier.js",
  "tools/agentank/diagnostics/minimax-depth-calibration.js",
  "tools/agentank/benchmark/search-frontier-benchmark.js"
]);

function option(name, fallback = null) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1];
}

function integerOption(name, fallback, minimum = 0) {
  const raw = option(name, null);
  if (raw === null || raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`MINIMAX_SUPPORT_OPTION:${name}:${value}`);
  return value;
}

function percentile(values, percent) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percent / 100) - 1)];
}

function identity(root, files) {
  const hashes = {};
  for (const relative of files)
    hashes[relative] = sha256Bytes(fs.readFileSync(contained(root, ...relative.split("/"))));
  return { files: hashes, fingerprint: fingerprintObject(hashes) };
}

function loadContract(root = defaultWorkspaceRoot()) {
  const file = contained(root, "config", "engine-v2", "minimax-support-frontier-contract.json");
  const contract = JSON.parse(fs.readFileSync(file, "utf8"));
  if (contract.schemaVersion !== 1 || contract.contractId !== "MINIMAX_SUPPORT_FRONTIER_V1")
    throw new Error("MINIMAX_SUPPORT_CONTRACT_INVALID");
  return { file, contract, fingerprint: fingerprintObject(contract) };
}

function profiles(contract) {
  const output = [];
  for (const depth of contract.depths)
    for (const width of contract.widths)
      for (const nodeBudget of contract.nodeBudgets)
        for (const workUnitBudget of contract.workUnitBudgets) {
          const work = workUnitBudget ? `WU${workUnitBudget}` : "WUINF";
          output.push(Object.freeze({ id: `P${depth}W${width}N${nodeBudget}-${work}`,
            depth, width, nodeBudget, workUnitBudget }));
        }
  return output;
}

function configure(search, prepared, profile, cacheEnabled, baseRisk = 50) {
  search.cache.setEnabled(cacheEnabled);
  search.rootTransitions.setEnabled(false);
  search.rootActions = prepared.engine.ourActions;
  search.rootArguments = prepared.engine.ourArguments;
  search.rootOurCount = prepared.ourCount;
  search.rootEnemyActions = prepared.engine.enemyActions;
  search.rootEnemyArguments = prepared.engine.enemyArguments;
  search.rootEnemyCount = prepared.engine.enemyCount;
  search.resetRoot(); search.baseRisk = baseRisk; search.activeRootTransitions = null;
  search.beginWorkMeter(prepared.bundle, profile.workUnitBudget);
}

function activeValues(search, prepared) {
  const rows = [];
  for (let row = 0; row < prepared.ourCount; row += 1) {
    const cells = [];
    for (let column = 0; column < prepared.engine.enemyCount; column += 1)
      cells.push(search.iterationCellScore[
        row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column]);
    rows.push([search.iterationScore[row], cells]);
  }
  return rows;
}

function runOnce(search, prepared, profile, cacheEnabled, baseRisk = 50) {
  configure(search, prepared, profile, cacheEnabled, baseRisk);
  const started = process.hrtime.bigint();
  const traversed = search.runIteration(prepared.bundle, profile.depth,
    profile.nodeBudget, profile.width);
  const micros = Number((process.hrtime.bigint() - started) / 1000n);
  if (traversed) search.commitIteration(prepared.ourCount, profile.depth);
  search.updateWorkMeter(prepared.bundle);
  const complete = traversed && search.attemptIntervalStatus === ROOT_INTERVAL_STATUS.COMPLETE ? 1 : 0;
  const supportComplete = complete && search.representativeSupportComplete ? 1 : 0;
  const state = prepared.bundle.state;
  return { micros, nodes: search.nodes, workUnits: search.workUnits,
    complete, supportComplete, generatedMax: search.iterationGeneratedMax,
    truncatedCount: search.iterationTruncatedCount,
    intervalStatus: search.attemptIntervalStatus,
    workInterrupted: search.workInterruptedCount,
    rootRestoreFailures: search.rootRestoreFailures,
    rootRestored: state.hashLo === prepared.rootHashLo && state.hashHi === prepared.rootHashHi ? 1 : 0,
    hotAllocations: search.hotAllocationCount, cacheHits: search.cacheHits,
    semantic: complete ? fingerprintObject({ supportComplete,
      values: activeValues(search, prepared) }) : null };
}

function runSample(index, profile, baseRisk = 50) {
  const prepared = preparedScenario(index, false);
  const disabled = new ProductionDepthSearch(new ProductionCacheBank(), RUNTIME_CONFIG,
    prepared.engine.rootTransitions);
  const enabled = new ProductionDepthSearch(new ProductionCacheBank(), RUNTIME_CONFIG,
    prepared.engine.rootTransitions);
  const cacheOff = runOnce(disabled, prepared, profile, false, baseRisk);
  const cold = runOnce(enabled, prepared, profile, true, baseRisk);
  const warm = runOnce(enabled, prepared, profile, true, baseRisk);
  return { scenarioIndex: index, scenarioClass: prepared.scenarioClass,
    rootActions: prepared.ourCount, enemyActions: prepared.engine.enemyCount,
    cacheOff, cold, warm };
}

function lane() {
  return { micros: [], nodes: [], workUnits: [], generatedMax: [], truncatedCount: [],
    cacheHits: [], calls: 0, complete: 0, supportComplete: 0, workInterrupted: 0,
    rootRestoreFailures: 0, rootRestoreMismatches: 0, hotAllocations: 0 };
}

function addLane(output, value) {
  output.calls += 1; output.micros.push(value.micros); output.nodes.push(value.nodes);
  output.workUnits.push(value.workUnits); output.generatedMax.push(value.generatedMax);
  output.truncatedCount.push(value.truncatedCount); output.cacheHits.push(value.cacheHits);
  output.complete += value.complete; output.supportComplete += value.supportComplete;
  output.workInterrupted += value.workInterrupted;
  output.rootRestoreFailures += value.rootRestoreFailures;
  output.rootRestoreMismatches += value.rootRestored ? 0 : 1;
  output.hotAllocations += value.hotAllocations;
}

function summarizeLane(value) {
  const rate = count => value.calls ? Math.floor(count * 10000 / value.calls) : 0;
  return { calls: value.calls, completionPer10000: rate(value.complete),
    exactSupportPer10000: rate(value.supportComplete),
    p50Micros: percentile(value.micros, 50), p95Micros: percentile(value.micros, 95),
    p50Nodes: percentile(value.nodes, 50), p95Nodes: percentile(value.nodes, 95),
    p50WorkUnits: percentile(value.workUnits, 50), p95WorkUnits: percentile(value.workUnits, 95),
    p95GeneratedMax: percentile(value.generatedMax, 95),
    p95TruncatedCount: percentile(value.truncatedCount, 95),
    p95CacheHits: percentile(value.cacheHits, 95),
    invariants: { workInterrupted: value.workInterrupted,
      rootRestoreFailures: value.rootRestoreFailures,
      rootRestoreMismatches: value.rootRestoreMismatches,
      hotAllocations: value.hotAllocations } };
}

function benchmark(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const loaded = loadContract(root); const contract = { ...loaded.contract };
  if (Number.isSafeInteger(options.scenarioCount)) contract.scenarioCount = options.scenarioCount;
  if (Number.isSafeInteger(options.warmupBatches)) contract.warmupBatches = options.warmupBatches;
  if (Number.isSafeInteger(options.measuredBatches)) contract.measuredBatches = options.measuredBatches;
  if (Array.isArray(options.depths)) contract.depths = options.depths;
  if (Array.isArray(options.widths)) contract.widths = options.widths;
  if (Array.isArray(options.nodeBudgets)) contract.nodeBudgets = options.nodeBudgets;
  if (Array.isArray(options.workUnitBudgets)) contract.workUnitBudgets = options.workUnitBudgets;
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor !== contract.requiredNodeMajor)
    throw new Error(`MINIMAX_SUPPORT_NODE_MAJOR:${nodeMajor}`);
  const matrix = profiles(contract);
  for (let batch = 0; batch < contract.warmupBatches; batch += 1)
    for (let index = 0; index < contract.scenarioCount; index += 1)
      for (const profile of matrix) runSample(index, profile, contract.baseRisk);
  const aggregates = Object.fromEntries(matrix.map(profile => [profile.id,
    { profile, cacheOff: lane(), cold: lane(), warm: lane(), semanticMismatches: 0 }]));
  for (let batch = 0; batch < contract.measuredBatches; batch += 1)
    for (let index = 0; index < contract.scenarioCount; index += 1)
      for (const profile of matrix) {
        const sample = runSample(index, profile, contract.baseRisk);
        const aggregate = aggregates[profile.id];
        addLane(aggregate.cacheOff, sample.cacheOff); addLane(aggregate.cold, sample.cold);
        addLane(aggregate.warm, sample.warm);
        if (sample.cacheOff.complete && sample.cold.complete &&
            sample.cacheOff.semantic !== sample.cold.semantic) aggregate.semanticMismatches += 1;
        if (sample.cold.complete && sample.warm.complete &&
            sample.cold.semantic !== sample.warm.semantic) aggregate.semanticMismatches += 1;
      }
  const summaries = {};
  const invariantTotals = { rootRestoreFailures: 0, rootRestoreMismatches: 0,
    hotAllocations: 0, cacheSemanticMismatches: 0 };
  for (const profile of matrix) {
    const aggregate = aggregates[profile.id];
    summaries[profile.id] = { profile, cacheOff: summarizeLane(aggregate.cacheOff),
      cold: summarizeLane(aggregate.cold), warm: summarizeLane(aggregate.warm),
      cacheSemanticMismatches: aggregate.semanticMismatches };
    invariantTotals.cacheSemanticMismatches += aggregate.semanticMismatches;
    for (const name of ["cacheOff", "cold", "warm"]) {
      const invariants = summaries[profile.id][name].invariants;
      invariantTotals.rootRestoreFailures += invariants.rootRestoreFailures;
      invariantTotals.rootRestoreMismatches += invariants.rootRestoreMismatches;
      invariantTotals.hotAllocations += invariants.hotAllocations;
    }
  }
  const scenarioSet = [];
  for (let index = 0; index < contract.scenarioCount; index += 1) {
    const prepared = preparedScenario(index, false);
    scenarioSet.push({ index, rootHashLo: prepared.rootHashLo, rootHashHi: prepared.rootHashHi,
      rootActions: prepared.ourCount, enemyActions: prepared.engine.enemyCount });
  }
  const report = { schemaVersion: 1, objectKind: OBJECT_KIND,
    status: Object.values(invariantTotals).every(value => value === 0) ? "PASS" : "FAIL",
    createdAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch,
      cpu: os.cpus()[0]?.model || "UNKNOWN" }, contract,
    contractFingerprint: fingerprintObject(contract), canonicalContractFingerprint: loaded.fingerprint,
    scenarioSet: { count: scenarioSet.length, scenarios: scenarioSet,
      fingerprint: fingerprintObject({ scenarios: scenarioSet }) },
    source: identity(root, SOURCE_FILES), harness: identity(root, HARNESS_FILES),
    hp9WorkCharges: Array.from(RUNTIME_CONFIG.WORK_CHARGES), profileCount: matrix.length,
    measuredCallsPerProfile: contract.scenarioCount * contract.measuredBatches,
    invariantTotals, summaries, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); return report;
}

function verify(report) {
  const errors = [];
  if (!report || report.schemaVersion !== 1 || report.objectKind !== OBJECT_KIND)
    errors.push("REPORT_IDENTITY");
  const expectedProfiles = report?.contract ? profiles(report.contract) : [];
  const expectedCalls = (report?.contract?.scenarioCount || 0) *
    (report?.contract?.measuredBatches || 0);
  if (report?.profileCount !== expectedProfiles.length) errors.push("PROFILE_COUNT");
  for (const profile of expectedProfiles) {
    const summary = report?.summaries?.[profile.id];
    if (!summary) { errors.push(`PROFILE_MISSING:${profile.id}`); continue; }
    for (const laneName of ["cacheOff", "cold", "warm"])
      if (summary[laneName]?.calls !== expectedCalls) errors.push(`CALLS:${profile.id}:${laneName}`);
  }
  for (const [key, value] of Object.entries(report?.invariantTotals || {}))
    if (value !== 0) errors.push(`INVARIANT:${key}:${value}`);
  if (fingerprintObject({ charges: report?.hp9WorkCharges || [] }) !==
      fingerprintObject({ charges: Array.from(RUNTIME_CONFIG.WORK_CHARGES) }))
    errors.push("WORK_CHARGES");
  if (report?.scenarioSet?.fingerprint !==
      fingerprintObject({ scenarios: report?.scenarioSet?.scenarios || [] }))
    errors.push("SCENARIO_SET");
  if (report?.fingerprint !== fingerprintObject({ ...report, fingerprint: "" }))
    errors.push("FINGERPRINT");
  return { status: errors.length ? "FAIL" : "PASS", errors };
}

function main(root = defaultWorkspaceRoot()) {
  const command = process.argv[2] || "run";
  if (command === "run") {
    const report = benchmark({ workspaceRoot: root,
      scenarioCount: integerOption("--scenarios", undefined, 1),
      warmupBatches: integerOption("--warmup", undefined, 0),
      measuredBatches: integerOption("--batches", undefined, 1) });
    const output = path.resolve(option("--output", contained(root, "artifacts", "benchmarks",
      "minimax-support-frontier", "latest.json")));
    writeJsonAtomic(output, report, { mode: 0o644 });
    process.stdout.write(`${JSON.stringify({ status: report.status, output,
      fingerprint: report.fingerprint, profiles: report.profileCount,
      callsPerProfile: report.measuredCallsPerProfile,
      invariantTotals: report.invariantTotals }, null, 2)}\n`); return report;
  }
  if (command === "verify") {
    const report = JSON.parse(fs.readFileSync(path.resolve(option("--report")), "utf8"));
    const result = verify(report); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "PASS") process.exitCode = 1; return result;
  }
  throw new Error(`MINIMAX_SUPPORT_COMMAND:${command}`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1;
  }
}

module.exports = { OBJECT_KIND, SOURCE_FILES, HARNESS_FILES, loadContract, profiles,
  runSample, benchmark, verify, main };
