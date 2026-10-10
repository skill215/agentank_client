#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ProductionRootEngine } = require(
  "../../../engine-v2/src/runtime/production-root");
const { SEARCH_CAPACITY } = require("../../../engine-v2/src/generated/search-config");
const { CACHE_CONFIG } = require("../../../engine-v2/src/generated/runtime-config");
const { CACHE_ID } = require("../../../engine-v2/src/abi/cache-runtime-codes");
const { ACTION, CHANCE, FAST_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { benchmarkFixture } = require("./search-frontier-benchmark");
const calibration = require("../diagnostics/minimax-depth-calibration");
const { defaultWorkspaceRoot } = require("../core/paths");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { writeJsonAtomic } = require("../core/atomic-file");

const OBJECT_KIND = "PHYSICAL_TT_SUCCESSOR_BENCHMARK_V1";
const DEFAULT_CAPACITIES = Object.freeze([32, 64, 128, 256]);
const DEFAULT_FIXTURES = 16;
const TARGET_DEPTH = 3;
const NODE_BUDGET = 512;
const BASE_RISK = 50;
const DEPTH_VALUE_MIN = -32000;

function option(name, fallback = null) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1];
}

function positiveInteger(value, fallback, label) {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`HP26_OPTION:${label}:${value}`);
  return parsed;
}

function capacities(value = null) {
  const output = value === null || value === undefined ? Array.from(DEFAULT_CAPACITIES) :
    String(value).split(",").map(item => positiveInteger(item.trim(), 0, "capacity"));
  if (!output.includes(CACHE_CONFIG.ENTRY_COUNT[CACHE_ID.PHYSICAL_VALUE_TT]))
    output.unshift(CACHE_CONFIG.ENTRY_COUNT[CACHE_ID.PHYSICAL_VALUE_TT]);
  return Array.from(new Set(output)).sort((left, right) => left - right);
}

function makeEngine(entryCount) {
  return new ProductionRootEngine({
    diagnosticPhysicalTTEntries: entryCount,
    diagnosticCrossFramePV: false,
    diagnosticCrossFrameRootPV: false
  });
}

function trimOurCount(engine) {
  return engine.ourCount > 1 && engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
    engine.ourCount - 1 : engine.ourCount;
}

function prepareRoot(index, entryCount) {
  const fixture = benchmarkFixture(index); const engine = makeEngine(entryCount);
  const adapted = engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
  if (!adapted.bundle) throw new Error(`HP26_ADAPT:${index}:${adapted.status}`);
  engine.generateActions();
  return { index, fixture, engine, bundle: adapted.bundle, ourCount: trimOurCount(engine) };
}

function search(item) {
  const engine = item.engine; const depth = engine.depthSearch;
  const beforeProbes = depth.cacheProbes; const beforeHits = depth.cacheHits;
  const beforeWrites = depth.cacheWrites;
  const reached = depth.search(item.bundle, engine.ourActions, engine.ourArguments,
    item.ourCount, engine.enemyActions, engine.enemyArguments, engine.enemyCount,
    TARGET_DEPTH, NODE_BUDGET, BASE_RISK);
  const score = Array.from(depth.rootScore.slice(0, item.ourCount));
  const cells = [];
  for (let row = 0; row < item.ourCount; row += 1)
    for (let column = 0; column < engine.enemyCount; column += 1)
      cells.push(depth.rootCellScore[row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column]);
  const semantic = { reached, completedDepth: depth.completedDepth,
    selectiveCompletedDepth: depth.selectiveCompletedDepth,
    supportDepth: depth.representativeSupportDepth,
    supportComplete: depth.representativeSupportComplete,
    action: engine.ourActions[depth.bestRow], argument: engine.ourArguments[depth.bestRow],
    value: depth.bestValue, score, cells };
  return { ...semantic, fingerprint: fingerprintObject(semantic), nodes: depth.nodes,
    workUnits: depth.workUnits, probes: depth.cacheProbes - beforeProbes,
    hits: depth.cacheHits - beforeHits, writes: depth.cacheWrites - beforeWrites,
    rootRestoreFailures: depth.rootRestoreFailures };
}

function matchingProgram(actions, argumentsList, count, action, argument) {
  for (let index = 0; index < count; index += 1)
    if (actions[index] === action && argumentsList[index] === argument) return index;
  return -1;
}

function selectReferenceProgram(index) {
  const item = prepareRoot(index, CACHE_CONFIG.ENTRY_COUNT[CACHE_ID.PHYSICAL_VALUE_TT]);
  search(item); const depth = item.engine.depthSearch; const row = depth.bestRow;
  let column = -1; let worst = 32000;
  for (let candidate = 0; candidate < item.engine.enemyCount; candidate += 1) {
    const entry = item.engine.rootTransitions.entryIndex(
      row, candidate, CHANCE.NORMAL, CHANCE.NORMAL);
    if (!item.engine.rootTransitions.hasPrincipalEntry(entry)) continue;
    const score = depth.rootCellScore[
      row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + candidate];
    if (column < 0 || score < worst || score === worst && candidate < column) {
      column = candidate; worst = score;
    }
  }
  if (column < 0) throw new Error(`HP26_NO_EXACT_SUCCESSOR:${index}`);
  return { ownAction: item.engine.ourActions[row], ownArgument: item.engine.ourArguments[row],
    enemyAction: item.engine.enemyActions[column],
    enemyArgument: item.engine.enemyArguments[column], referenceCellValue: worst };
}

function physicalHash(state) {
  return `${state.hashLo.toString(16)}:${state.hashHi.toString(16)}`;
}

function activeCacheEntries(engine) {
  const cache = engine.depthSearch.cache; let count = 0;
  for (let slot = 0; slot < cache.entryCount; slot += 1)
    if (cache.valid[slot] && cache.generation[slot] === cache.currentGeneration) count += 1;
  return count;
}

function advanceRetainedParent(index, entryCount, program) {
  const item = prepareRoot(index, entryCount); const parent = search(item);
  const row = matchingProgram(item.engine.ourActions, item.engine.ourArguments,
    item.ourCount, program.ownAction, program.ownArgument);
  const column = matchingProgram(item.engine.enemyActions, item.engine.enemyArguments,
    item.engine.enemyCount, program.enemyAction, program.enemyArgument);
  if (row < 0 || column < 0) throw new Error(`HP26_PROGRAM_MISSING:${index}:${entryCount}`);
  const retainedEntries = activeCacheEntries(item.engine);
  const status = item.engine.rootTransitions.apply(
    item.bundle, row, column, CHANCE.NORMAL, CHANCE.NORMAL, 1);
  if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL)
    throw new Error(`HP26_CHAIN_APPLY:${index}:${entryCount}:${status}`);
  item.engine.generateActions(); item.ourCount = trimOurCount(item.engine);
  return { item, parent, retainedEntries, childHash: physicalHash(item.bundle.state) };
}

function advanceCold(index, entryCount, program) {
  const item = prepareRoot(index, entryCount);
  const status = item.bundle.kernel.applyFrame(program.ownAction, program.ownArgument,
    program.enemyAction, program.enemyArgument, CHANCE.NORMAL, CHANCE.NORMAL);
  if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL)
    throw new Error(`HP26_COLD_APPLY:${index}:${entryCount}:${status}`);
  item.bundle.hard.classifyApplied(); item.engine.generateActions();
  item.ourCount = trimOurCount(item.engine);
  return { item, childHash: physicalHash(item.bundle.state) };
}

function compareChild(chain, cold) {
  // A truncated attempt may leave bestValue as traversal residue even though
  // the published root cells/action are unchanged.  Only a complete
  // representative certificate owns comparable Minimax semantics.
  const sameOwner = chain.supportComplete && cold.supportComplete &&
    chain.completedDepth === cold.completedDepth &&
    chain.selectiveCompletedDepth === cold.selectiveCompletedDepth &&
    chain.supportDepth === cold.supportDepth && chain.supportComplete === cold.supportComplete;
  return { sameOwner: sameOwner ? 1 : 0,
    comparableSemanticMismatch: sameOwner && chain.fingerprint !== cold.fingerprint ? 1 : 0,
    completedDepthDelta: chain.completedDepth - cold.completedDepth,
    selectiveDepthDelta: chain.selectiveCompletedDepth - cold.selectiveCompletedDepth,
    nodesSaved: cold.nodes - chain.nodes, workUnitsSaved: cold.workUnits - chain.workUnits,
    probeDelta: chain.probes - cold.probes, hitDelta: chain.hits - cold.hits };
}

function histogramAdd(target, value) {
  target[value] = (target[value] || 0) + 1;
}

function aggregate(rows, baselineBytes) {
  const output = { calls: rows.length, cacheBytes: rows[0]?.cacheBytes || 0,
    additionalBytes: (rows[0]?.cacheBytes || 0) - baselineBytes,
    identicalSuccessorFailures: 0, comparableSemanticMismatches: 0,
    sameOwnerCalls: 0, chainNodes: 0, coldNodes: 0, nodesSaved: 0,
    chainWorkUnits: 0, coldWorkUnits: 0, workUnitsSaved: 0,
    chainProbes: 0, coldProbes: 0, chainHits: 0, coldHits: 0,
    chainWrites: 0, coldWrites: 0, retainedParentEntries: 0,
    rootRestoreFailures: 0, completedDepthGainCalls: 0, selectiveDepthGainCalls: 0,
    chainSelectiveDepthHistogram: {}, coldSelectiveDepthHistogram: {} };
  for (const row of rows) {
    output.identicalSuccessorFailures += row.identicalSuccessor ? 0 : 1;
    output.comparableSemanticMismatches += row.comparison.comparableSemanticMismatch;
    output.sameOwnerCalls += row.comparison.sameOwner;
    output.chainNodes += row.chain.nodes; output.coldNodes += row.cold.nodes;
    output.chainWorkUnits += row.chain.workUnits; output.coldWorkUnits += row.cold.workUnits;
    output.chainProbes += row.chain.probes; output.coldProbes += row.cold.probes;
    output.chainHits += row.chain.hits; output.coldHits += row.cold.hits;
    output.chainWrites += row.chain.writes; output.coldWrites += row.cold.writes;
    output.retainedParentEntries += row.retainedParentEntries;
    output.rootRestoreFailures += row.chain.rootRestoreFailures + row.cold.rootRestoreFailures +
      row.parent.rootRestoreFailures;
    if (row.comparison.completedDepthDelta > 0) output.completedDepthGainCalls += 1;
    if (row.comparison.selectiveDepthDelta > 0) output.selectiveDepthGainCalls += 1;
    histogramAdd(output.chainSelectiveDepthHistogram, row.chain.selectiveCompletedDepth);
    histogramAdd(output.coldSelectiveDepthHistogram, row.cold.selectiveCompletedDepth);
  }
  output.nodesSaved = output.coldNodes - output.chainNodes;
  output.workUnitsSaved = output.coldWorkUnits - output.chainWorkUnits;
  output.nodeReductionBasisPoints = Math.floor(output.nodesSaved * 10000 /
    Math.max(1, output.coldNodes));
  output.workReductionBasisPoints = Math.floor(output.workUnitsSaved * 10000 /
    Math.max(1, output.coldWorkUnits));
  return output;
}

function sourceIdentity(workspaceRoot) {
  const source = calibration.sourceIdentity(workspaceRoot);
  const relative = "tools/agentank/benchmark/physical-tt-successor-benchmark.js";
  const file = path.join(workspaceRoot, relative);
  return { ...source, benchmarkFile: relative, benchmarkSha256: sha256Bytes(fs.readFileSync(file)) };
}

function verify(report) {
  const errors = [];
  if (!report || report.objectKind !== OBJECT_KIND) errors.push("OBJECT_KIND");
  if (!report || report.scenarioCount < 1) errors.push("SCENARIO_COUNT");
  for (const result of Object.values(report?.capacities || {})) {
    if (result.calls !== report.scenarioCount) errors.push("CALL_DENOMINATOR");
    if (result.identicalSuccessorFailures) errors.push("SUCCESSOR_IDENTITY");
    if (result.comparableSemanticMismatches) errors.push("SEMANTIC_MISMATCH");
    if (result.rootRestoreFailures) errors.push("ROOT_RESTORE");
  }
  return { status: errors.length ? "FAIL" : "PASS", errors };
}

function run(options = {}) {
  const workspaceRoot = options.workspaceRoot || defaultWorkspaceRoot();
  const scenarioCount = positiveInteger(options.scenarioCount, DEFAULT_FIXTURES, "fixtures");
  const entryCounts = capacities(options.capacities);
  const programs = new Array(scenarioCount);
  for (let index = 0; index < scenarioCount; index += 1)
    programs[index] = selectReferenceProgram(index);
  const rowsByCapacity = {};
  for (const entryCount of entryCounts) {
    const rows = [];
    for (let index = 0; index < scenarioCount; index += 1) {
      const retained = advanceRetainedParent(index, entryCount, programs[index]);
      const cold = advanceCold(index, entryCount, programs[index]);
      const chainResult = search(retained.item); const coldResult = search(cold.item);
      rows.push({ index, cacheBytes: retained.item.engine.cacheBank.totalBytes(),
        program: programs[index], parent: retained.parent,
        retainedParentEntries: retained.retainedEntries,
        identicalSuccessor: retained.childHash === cold.childHash,
        childHash: retained.childHash, chain: chainResult, cold: coldResult,
        comparison: compareChild(chainResult, coldResult) });
    }
    rowsByCapacity[entryCount] = rows;
  }
  const baselineCount = CACHE_CONFIG.ENTRY_COUNT[CACHE_ID.PHYSICAL_VALUE_TT];
  const baselineBytes = rowsByCapacity[baselineCount][0].cacheBytes;
  const results = {};
  for (const entryCount of entryCounts)
    results[entryCount] = aggregate(rowsByCapacity[entryCount], baselineBytes);
  const baseline = results[baselineCount];
  let best = baselineCount;
  for (const entryCount of entryCounts) {
    const candidate = results[entryCount]; const selected = results[best];
    if (candidate.selectiveDepthGainCalls > selected.selectiveDepthGainCalls ||
        candidate.selectiveDepthGainCalls === selected.selectiveDepthGainCalls &&
        candidate.nodeReductionBasisPoints > selected.nodeReductionBasisPoints) best = entryCount;
  }
  const bestResult = results[best];
  const materialGain = best !== baselineCount &&
    (bestResult.selectiveDepthGainCalls > baseline.selectiveDepthGainCalls ||
      bestResult.nodeReductionBasisPoints >= 500) && bestResult.workUnitsSaved > 0;
  const report = { schemaVersion: 1, objectKind: OBJECT_KIND,
    createdAt: new Date().toISOString(), node: process.version,
    source: sourceIdentity(workspaceRoot), scenarioCount, targetDepth: TARGET_DEPTH,
    nodeBudget: NODE_BUDGET, baseRisk: BASE_RISK, baselineEntries: baselineCount,
    entryCounts, programs, capacities: results,
    decision: materialGain ? "QUALIFY_FOR_ARENA_POC" : "REJECT_CAPACITY_EXPANSION",
    selectedEntries: materialGain ? best : baselineCount,
    rows: rowsByCapacity, status: "PENDING", fingerprint: "" };
  const checked = verify(report); report.status = checked.status;
  report.fingerprint = fingerprintObject(report);
  return report;
}

function main() {
  const report = run({ scenarioCount: positiveInteger(option("--fixtures"),
    DEFAULT_FIXTURES, "fixtures"), capacities: option("--capacities") });
  const output = option("--output");
  if (output) writeJsonAtomic(path.resolve(output), report, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "PASS") process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { OBJECT_KIND, capacities, run, verify };
