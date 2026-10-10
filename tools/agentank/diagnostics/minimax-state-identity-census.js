#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ProductionDepthSearch } = require(
  "../../../engine-v2/src/search/production-depth-search");
const { ProductionCacheBank } = require("../../../engine-v2/src/cache/production-cache");
const { SEARCH_CAPACITY } = require("../../../engine-v2/src/generated/search-config");
const { RUNTIME_CONFIG, CACHE_CONFIG } = require(
  "../../../engine-v2/src/generated/runtime-config");
const { CACHE_ID, CACHE_MISS } = require("../../../engine-v2/src/abi/cache-runtime-codes");
const { ACTION, FAST_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const calibration = require("./minimax-depth-calibration");
const { defaultWorkspaceRoot } = require("../core/paths");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { writeJsonAtomic } = require("../core/atomic-file");

const OBJECT_KIND = "MINIMAX_STATE_IDENTITY_CENSUS_V1";
const LEVELS = SEARCH_CAPACITY.MAX_DECISION_DEPTH + 2;

function option(name, fallback = null) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1];
}

function integer(value, fallback, label) {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`HP27_OPTION:${label}:${value}`);
  return parsed;
}

function vector() { return new Uint32Array(LEVELS); }

function collector() {
  return { directProbes: 0, directHits: 0, directMisses: 0,
    uniqueExactIdentities: 0, repeatedExactProbes: 0,
    repeatedExactHits: 0, repeatedExactMisses: 0,
    uniquePhysicalStates: 0, repeatedPhysicalProbes: 0,
    crossDepthFirstProbes: 0, crossWidthFirstProbes: 0,
    writes: 0, fullBucketWrites: 0,
    completedFrames: 0, bestRowZeroFrames: 0,
    prunedRows: 0, perfectEnemyOrderCellSavings: 0,
    chanceGroups: 0, multiOutcomeChanceGroups: 0, aliasedChanceGroups: 0,
    chanceOutcomeCodes: 0, uniqueChanceSuccessors: 0, aliasedChanceOutcomes: 0,
    chanceOutcomeInconsistencies: 0,
    probesByPly: vector(), hitsByPly: vector(), missesByPly: vector(),
    uniqueExactByPly: vector(), repeatedExactByPly: vector(),
    repeatedExactMissesByPly: vector(), fullBucketWritesByPly: vector(),
    completedFramesByPly: vector(), bestRowZeroByPly: vector(),
    prunedRowsByPly: vector(), perfectEnemyOrderCellSavingsByPly: vector(),
    bestRowIndexCounts: new Uint32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS),
    cutoffEnemyActionCounts: new Uint32Array(ACTION.BOOST_RIGHT_BOMB + 1),
    cutoffOwnActionCounts: new Uint32Array(ACTION.BOOST_RIGHT_BOMB + 1),
    chanceGroupsByPly: vector(), multiOutcomeChanceGroupsByPly: vector(),
    aliasedChanceGroupsByPly: vector(), aliasedChanceOutcomesByPly: vector() };
}

function physicalKey(state) { return `${state.hashLo}:${state.hashHi}`; }
function bounded(value) { return Math.max(0, Math.min(LEVELS - 1, value | 0)); }
function configurationBit(depth, width) { return 2 ** Math.min(30, depth * 4 + width); }

function install(search, bundle, out) {
  const exactSeen = new Map(); const physicalSeen = new Map();
  const chanceGroups = new Map(); const state = bundle.state;
  const rootFrame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
  const originalProbe = search.probeFrame; const originalWrite = search.writeFrame;
  const originalConsume = search.consume;
  const originalApply = bundle.kernel.applyFrame;
  bundle.kernel.applyFrame = function(action0, argument0, action1, argument1, chance0, chance1) {
    const parent = physicalKey(state); const ply = bounded(
      state.arrays[ARRAY.SCALAR][SCALAR.FRAME] - rootFrame + 1);
    const key = `${parent}:${action0}:${argument0}:${action1}:${argument1}`;
    const outcome = `${chance0}:${chance1}`;
    const status = originalApply.call(bundle.kernel, action0, argument0,
      action1, argument1, chance0, chance1);
    if (status === FAST_STATUS.APPLIED || status === FAST_STATUS.APPLIED_TERMINAL) {
      let group = chanceGroups.get(key);
      if (!group) { group = { ply, outcomes: new Map() }; chanceGroups.set(key, group); }
      const child = physicalKey(state); const previous = group.outcomes.get(outcome);
      if (previous !== undefined && previous !== child) out.chanceOutcomeInconsistencies += 1;
      else group.outcomes.set(outcome, child);
    }
    return status;
  };
  search.probeFrame = function(top, state) {
    const ply = bounded(top); const depth = search.frameDepth[top];
    const width = search.iterationExpansionLimit; const physical = physicalKey(state);
    const exact = `${physical}:${depth}:${width}:${search.baseRisk}`;
    const seen = exactSeen.get(exact) || 0; const config = physicalSeen.get(physical) || 0;
    out.directProbes += 1; out.probesByPly[ply] += 1;
    if (seen) { out.repeatedExactProbes += 1; out.repeatedExactByPly[ply] += 1; }
    else { out.uniqueExactIdentities += 1; out.uniqueExactByPly[ply] += 1; }
    if (config) {
      out.repeatedPhysicalProbes += 1;
      let sameDepth = 0;
      for (let candidateWidth = 1; candidateWidth <= 4; candidateWidth += 1)
        if (config & configurationBit(depth, candidateWidth)) sameDepth = 1;
      if (!sameDepth) out.crossDepthFirstProbes += 1;
      else if (!(config & configurationBit(depth, width))) out.crossWidthFirstProbes += 1;
    } else out.uniquePhysicalStates += 1;
    exactSeen.set(exact, seen + 1);
    physicalSeen.set(physical, config | configurationBit(depth, width));
    const slot = originalProbe.call(search, top, state);
    if (slot === CACHE_MISS) {
      out.directMisses += 1; out.missesByPly[ply] += 1;
      if (seen) { out.repeatedExactMisses += 1; out.repeatedExactMissesByPly[ply] += 1; }
    } else {
      out.directHits += 1; out.hitsByPly[ply] += 1;
      if (seen) out.repeatedExactHits += 1;
    }
    return slot;
  };
  search.writeFrame = function(top, state, value) {
    let full = 0; const ply = bounded(top);
    if (!search.frameRoot[top]) {
      const bestRow = search.frameBestRow[top]; out.completedFrames += 1;
      out.completedFramesByPly[ply] += 1;
      if (bestRow === 0) { out.bestRowZeroFrames += 1; out.bestRowZeroByPly[ply] += 1; }
      if (bestRow < out.bestRowIndexCounts.length) out.bestRowIndexCounts[bestRow] += 1;
    }
    if (!search.frameRoot[top] && search.frameCacheable[top]) {
      const cache = search.cache; const start = cache.bucketStart(search.cacheKey(state,
        search.frameDepth[top])); full = 1;
      for (let way = 0; way < cache.ways; way += 1) {
        const slot = start + way;
        if (!cache.valid[slot] || cache.generation[slot] !== cache.currentGeneration) {
          full = 0; break;
        }
      }
    }
    const slot = originalWrite.call(search, top, state, value);
    if (slot !== CACHE_MISS) {
      out.writes += 1;
      if (full) { out.fullBucketWrites += 1; out.fullBucketWritesByPly[ply] += 1; }
    }
    return slot;
  };
  search.consume = function(top, value, cacheable, bound) {
    const root = search.frameRoot[top]; const before = search.frameColumn[top];
    const count = search.frameEnemyCount[top]; const row = search.frameRow[top];
    let ownAction = ACTION.NONE; let enemyAction = ACTION.NONE;
    if (!root && before < count && row < search.frameOurCount[top]) {
      ownAction = search.actionAt(top, 0, row); enemyAction = search.actionAt(top, 1, before);
    }
    const result = originalConsume.call(search, top, value, cacheable, bound);
    if (!root && before + 1 < count && search.frameColumn[top] === count) {
      const ply = bounded(top); out.prunedRows += 1; out.prunedRowsByPly[ply] += 1;
      out.perfectEnemyOrderCellSavings += before;
      out.perfectEnemyOrderCellSavingsByPly[ply] += before;
      if (enemyAction < out.cutoffEnemyActionCounts.length)
        out.cutoffEnemyActionCounts[enemyAction] += 1;
      if (ownAction < out.cutoffOwnActionCounts.length)
        out.cutoffOwnActionCounts[ownAction] += 1;
    }
    return result;
  };
  return { exactSeen, physicalSeen, chanceGroups,
    finalize() {
      for (const group of chanceGroups.values()) {
        const ply = group.ply; const outcomes = group.outcomes.size;
        const successors = new Set(group.outcomes.values()).size;
        out.chanceGroups += 1; out.chanceGroupsByPly[ply] += 1;
        out.chanceOutcomeCodes += outcomes; out.uniqueChanceSuccessors += successors;
        if (outcomes > 1) {
          out.multiOutcomeChanceGroups += 1; out.multiOutcomeChanceGroupsByPly[ply] += 1;
        }
        if (successors < outcomes) {
          const aliased = outcomes - successors; out.aliasedChanceGroups += 1;
          out.aliasedChanceGroupsByPly[ply] += 1; out.aliasedChanceOutcomes += aliased;
          out.aliasedChanceOutcomesByPly[ply] += aliased;
        }
      }
    },
    restore() { search.probeFrame = originalProbe; search.writeFrame = originalWrite;
      search.consume = originalConsume; bundle.kernel.applyFrame = originalApply; } };
}

function semantic(search, prepared) {
  return fingerprintObject({ completedDepth: search.completedDepth,
    selectiveCompletedDepth: search.selectiveCompletedDepth,
    supportDepth: search.representativeSupportDepth,
    supportComplete: search.representativeSupportComplete,
    bestRow: search.bestRow, bestValue: search.bestValue,
    rootScore: Array.from(search.rootScore.slice(0, prepared.ourCount)),
    rootCells: Array.from(search.rootCellScore.slice(0,
      prepared.ourCount * SEARCH_CAPACITY.MAX_ENEMY_POLICIES)) });
}

function execute(index, observed, nodeBudget) {
  const prepared = calibration.preparedScenario(index, true);
  const search = new ProductionDepthSearch(new ProductionCacheBank(), RUNTIME_CONFIG,
    prepared.engine.rootTransitions, { selectiveContinuationEnabled: true,
      crossFramePVEnabled: true, diagnosticNodeCapacity: nodeBudget });
  const out = collector(); const installed = observed ? install(search, prepared.bundle, out) : null;
  try {
    search.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
      prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
      prepared.engine.enemyCount, 3, nodeBudget, 50);
    if (installed) installed.finalize();
    return { semantic: semantic(search, prepared), nodes: search.nodes,
      workUnits: search.updateWorkMeter(prepared.bundle), completedDepth: search.completedDepth,
      selectiveCompletedDepth: search.selectiveCompletedDepth,
      rootRestoreFailures: search.rootRestoreFailures, census: out };
  } finally { if (installed) installed.restore(); }
}

function add(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value instanceof Uint32Array) {
      for (let index = 0; index < value.length; index += 1) target[key][index] += value[index];
    } else target[key] += value;
  }
}

function plain(out) {
  const result = {};
  for (const [key, value] of Object.entries(out))
    result[key] = value instanceof Uint32Array ? Array.from(value) : value;
  result.exactRepeatBasisPoints = Math.floor(result.repeatedExactProbes * 10000 /
    Math.max(1, result.directProbes));
  result.repeatedMissBasisPoints = Math.floor(result.repeatedExactMisses * 10000 /
    Math.max(1, result.directProbes));
  result.crossDepthBasisPoints = Math.floor(result.crossDepthFirstProbes * 10000 /
    Math.max(1, result.directProbes));
  result.fullBucketWriteBasisPoints = Math.floor(result.fullBucketWrites * 10000 /
    Math.max(1, result.writes));
  result.bestRowZeroBasisPoints = Math.floor(result.bestRowZeroFrames * 10000 /
    Math.max(1, result.completedFrames));
  result.chanceAliasBasisPoints = Math.floor(result.aliasedChanceOutcomes * 10000 /
    Math.max(1, result.chanceOutcomeCodes));
  return result;
}

function sourceIdentity(root) {
  const source = calibration.sourceIdentity(root);
  const relative = "tools/agentank/diagnostics/minimax-state-identity-census.js";
  return { ...source, diagnosticFile: relative,
    diagnosticSha256: sha256Bytes(fs.readFileSync(path.join(root, relative))) };
}

function verify(report) {
  const errors = [];
  if (!report || report.objectKind !== OBJECT_KIND) errors.push("OBJECT_KIND");
  if (!report || report.scenarioCount < 1) errors.push("SCENARIO_COUNT");
  if (report?.invariants?.semanticMismatches) errors.push("SEMANTIC_MISMATCH");
  if (report?.invariants?.nodeMismatches) errors.push("NODE_MISMATCH");
  if (report?.invariants?.rootRestoreFailures) errors.push("ROOT_RESTORE");
  if (report?.census?.chanceOutcomeInconsistencies) errors.push("CHANCE_INCONSISTENCY");
  const census = report?.census;
  if (!census || census.directProbes !== census.directHits + census.directMisses)
    errors.push("PROBE_ACCOUNTING");
  if (census && census.directProbes !==
      census.uniqueExactIdentities + census.repeatedExactProbes)
    errors.push("IDENTITY_ACCOUNTING");
  return { status: errors.length ? "FAIL" : "PASS", errors };
}

function run(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const scenarioCount = integer(options.scenarioCount, 16, "scenarios");
  const nodeBudget = integer(options.nodeBudget, 512, "node-budget");
  const total = collector(); const rows = []; const invariants = {
    semanticMismatches: 0, nodeMismatches: 0, rootRestoreFailures: 0 };
  for (let index = 0; index < scenarioCount; index += 1) {
    const baseline = execute(index, false, nodeBudget);
    const observed = execute(index, true, nodeBudget); add(total, observed.census);
    const semanticMismatch = baseline.semantic === observed.semantic ? 0 : 1;
    const nodeMismatch = baseline.nodes === observed.nodes ? 0 : 1;
    invariants.semanticMismatches += semanticMismatch;
    invariants.nodeMismatches += nodeMismatch;
    invariants.rootRestoreFailures += baseline.rootRestoreFailures +
      observed.rootRestoreFailures;
    rows.push({ index, semanticMismatch, nodeMismatch, nodes: observed.nodes,
      workUnits: observed.workUnits, completedDepth: observed.completedDepth,
      selectiveCompletedDepth: observed.selectiveCompletedDepth,
      census: plain(observed.census) });
  }
  const report = { schemaVersion: 1, objectKind: OBJECT_KIND,
    createdAt: new Date().toISOString(), source: sourceIdentity(root), scenarioCount,
    targetDepth: 3, nodeBudget,
    physicalTTEntries: CACHE_CONFIG.ENTRY_COUNT[CACHE_ID.PHYSICAL_VALUE_TT],
    census: plain(total), invariants, rows, status: "PENDING", fingerprint: "" };
  report.status = verify(report).status; report.fingerprint = fingerprintObject(report);
  return report;
}

function main() {
  const report = run({ scenarioCount: integer(option("--scenarios"), 16, "scenarios"),
    nodeBudget: integer(option("--node-budget"), 512, "node-budget") });
  const output = option("--output");
  if (output) writeJsonAtomic(path.resolve(output), report, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify({ status: report.status, output: output || null,
    fingerprint: report.fingerprint, sourceFingerprint: report.source.fingerprint,
    scenarioCount: report.scenarioCount, census: report.census,
    invariants: report.invariants }, null, 2)}\n`);
  if (report.status !== "PASS") process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { OBJECT_KIND, collector, install, run, verify };
