#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ProductionDepthSearch } = require(
  "../../../engine-v2/src/search/production-depth-search");
const { ProductionCacheBank } = require("../../../engine-v2/src/cache/production-cache");
const { SEARCH_CAPACITY } = require("../../../engine-v2/src/generated/search-config");
const { RUNTIME_CONFIG, CACHE_CONFIG } = require("../../../engine-v2/src/generated/runtime-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { CACHE_MISS } = require("../../../engine-v2/src/abi/cache-runtime-codes");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { writeJsonAtomic } = require("../core/atomic-file");
const calibration = require("./minimax-depth-calibration");

const OBJECT_KIND = "MINIMAX_COST_CENSUS_V1";
const LEVELS = SEARCH_CAPACITY.MAX_DECISION_DEPTH + 2;

function option(name, fallback = null) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1];
}

function integerOption(name, fallback, minimum = 0) {
  const raw = option(name, null);
  if (raw === null || raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`MINIMAX_COST_CENSUS_OPTION:${name}:${raw}`);
  return value;
}

function vector() { return new Uint32Array(LEVELS); }

function collector() {
  return {
    fastApplyByPly: vector(), hardClassifyByPly: vector(), hardReverseBuildByPly: vector(),
    hardAllowByPly: vector(), hardRejectPolicyByPly: vector(),
    hardRejectProvenByPly: vector(), hardIncompleteByPly: vector(),
    cacheProbeByStatePly: vector(), cacheHitByStatePly: vector(),
    cacheWriteByStatePly: vector(), deepGenerationByStatePly: vector(),
    deepOurActionTotalByStatePly: vector(), deepEnemyActionTotalByStatePly: vector(),
    deepJointCellTotalByStatePly: vector(), deepProjectedChanceNodeTotalByStatePly: vector(),
    alphaBetaPrunedCellsByStatePly: vector(), ttPromotionProbeByStatePly: vector(),
    ttPromotionHitByStatePly: vector(),
    iterationCallsByDepth: vector(), iterationCompletedByDepth: vector(),
    iterationNodesByDepth: vector(), selectiveIterationCallsByDepth: vector(),
    selectiveIterationCompletedByDepth: vector(), selectiveIterationNodesByDepth: vector(),
    heuristicByStatePly: vector(), terminalValueByRemainingDepth: vector(),
    rootSlabCalls: 0, rootSlabReplays: 0, rootSlabHardReplays: 0,
    rootSlabBuilds: 0, trapProbeCalls: 0, trapProbeNodes: 0,
    nodeAccountingMismatch: 0
  };
}

function boundedLevel(value) {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(LEVELS - 1, value);
}

function resetCollector(out) {
  for (const value of Object.values(out)) {
    if (value instanceof Uint32Array) value.fill(0);
  }
  out.rootSlabCalls = 0; out.rootSlabReplays = 0; out.rootSlabHardReplays = 0;
  out.rootSlabBuilds = 0; out.trapProbeCalls = 0; out.trapProbeNodes = 0;
  out.nodeAccountingMismatch = 0;
}

function snapshotCollector(out, nodes) {
  const result = {};
  for (const [key, value] of Object.entries(out))
    result[key] = value instanceof Uint32Array ? Array.from(value) : value;
  const fast = result.fastApplyByPly.reduce((sum, value) => sum + value, 0);
  const replay = result.rootSlabReplays;
  result.accountedNodes = fast + replay;
  result.nodes = nodes;
  result.nodeAccountingMismatch = nodes - result.accountedNodes;
  return result;
}

function installCensus(search, bundle, out) {
  const state = bundle.state; const kernel = bundle.kernel; const hard = bundle.hard;
  const rootTransitions = search.rootTransitions;
  let rootFrame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];

  const originalApply = kernel.applyFrame;
  const originalClassify = hard.classifyApplied;
  const originalRootApply = rootTransitions.apply;
  const originalProbeFrame = search.probeFrame;
  const originalWriteFrame = search.writeFrame;
  const originalGenerateDeep = search.generateDeep;
  const originalConsume = search.consume;
  const originalPromote = search.promoteFrameFromTT;
  const originalHeuristic = search.heuristic;
  const originalTerminalValue = search.terminalValue;
  const originalTrap = search.probeDirectFireTrap;
  const originalRunIteration = search.runIteration;

  kernel.applyFrame = function(action0, argument0, action1, argument1, chance0, chance1) {
    const ply = boundedLevel(state.arrays[ARRAY.SCALAR][SCALAR.FRAME] - rootFrame + 1);
    out.fastApplyByPly[ply] += 1;
    return originalApply.call(kernel, action0, argument0, action1, argument1, chance0, chance1);
  };
  hard.classifyApplied = function() {
    const ply = boundedLevel(state.arrays[ARRAY.SCALAR][SCALAR.FRAME] - rootFrame);
    const builds = hard.reverseBuildCount;
    const status = originalClassify.call(hard);
    out.hardClassifyByPly[ply] += 1;
    out.hardReverseBuildByPly[ply] += Math.max(0, hard.reverseBuildCount - builds);
    if (status === HARD_STATUS.ALLOW) out.hardAllowByPly[ply] += 1;
    else if (status === HARD_STATUS.REJECT_POLICY) out.hardRejectPolicyByPly[ply] += 1;
    else if (status === HARD_STATUS.REJECT_PROVEN) out.hardRejectProvenByPly[ply] += 1;
    else out.hardIncompleteByPly[ply] += 1;
    return status;
  };
  rootTransitions.apply = function(rootBundle, row, column, chance0, chance1, requireHard) {
    out.rootSlabCalls += 1;
    const status = originalRootApply.call(rootTransitions, rootBundle, row, column,
      chance0, chance1, requireHard);
    if (rootTransitions.lastReplay) out.rootSlabReplays += 1;
    else if (status) out.rootSlabBuilds += 1;
    if (rootTransitions.lastHardReplay) out.rootSlabHardReplays += 1;
    return status;
  };
  search.probeFrame = function(top, currentState) {
    const level = boundedLevel(top); out.cacheProbeByStatePly[level] += 1;
    const slot = originalProbeFrame.call(search, top, currentState);
    if (slot !== CACHE_MISS) out.cacheHitByStatePly[level] += 1;
    return slot;
  };
  search.writeFrame = function(top, currentState, value) {
    const slot = originalWriteFrame.call(search, top, currentState, value);
    if (slot !== CACHE_MISS) out.cacheWriteByStatePly[boundedLevel(top)] += 1;
    return slot;
  };
  search.generateDeep = function(top, currentState, seat) {
    if (seat === 0) out.deepGenerationByStatePly[boundedLevel(top)] += 1;
    const result = originalGenerateDeep.call(search, top, currentState, seat);
    if (seat === 1) {
      const level = boundedLevel(top);
      const ourCount = search.frameOurCount[top]; const enemyCount = search.frameEnemyCount[top];
      out.deepOurActionTotalByStatePly[level] += ourCount;
      out.deepEnemyActionTotalByStatePly[level] += enemyCount;
      out.deepJointCellTotalByStatePly[level] += ourCount * enemyCount;
      const offset = top * 4; let projected = 0;
      for (let row = 0; row < ourCount; row += 1)
        for (let column = 0; column < enemyCount; column += 1)
          projected += search.chanceAlternatives(currentState, 0,
            search.deepOurActions[offset + row]) *
            search.chanceAlternatives(currentState, 1,
              search.deepEnemyActions[offset + column]);
      out.deepProjectedChanceNodeTotalByStatePly[level] += projected;
    }
    return result;
  };
  search.consume = function(top, value, cacheable, bound) {
    const before = search.frameColumn[top]; const count = search.frameEnemyCount[top];
    const result = originalConsume.call(search, top, value, cacheable, bound);
    if (!search.frameRoot[top] && before + 1 < count && search.frameColumn[top] === count)
      out.alphaBetaPrunedCellsByStatePly[boundedLevel(top)] += count - before - 1;
    return result;
  };
  search.promoteFrameFromTT = function(top, currentState) {
    const level = boundedLevel(top); out.ttPromotionProbeByStatePly[level] += 1;
    const result = originalPromote.call(search, top, currentState);
    if (result) out.ttPromotionHitByStatePly[level] += 1;
    return result;
  };
  search.heuristic = function(currentState) {
    const level = boundedLevel(currentState.arrays[ARRAY.SCALAR][SCALAR.FRAME] - rootFrame);
    out.heuristicByStatePly[level] += 1;
    return originalHeuristic.call(search, currentState);
  };
  search.terminalValue = function(terminal, remainingDepth) {
    out.terminalValueByRemainingDepth[boundedLevel(remainingDepth)] += 1;
    return originalTerminalValue.call(search, terminal, remainingDepth);
  };
  search.probeDirectFireTrap = function(rootBundle, nodeBudget) {
    out.trapProbeCalls += 1; const before = search.nodes;
    const result = originalTrap.call(search, rootBundle, nodeBudget);
    out.trapProbeNodes += search.lastTrapProbeNodes || Math.max(0, search.nodes - before);
    return result;
  };
  search.runIteration = function(rootBundle, depth, nodeBudget, expansionLimit,
      selectiveRoot, abortOnNonExactSupport) {
    const level = boundedLevel(depth); const before = search.nodes;
    const selective = selectiveRoot ? 1 : 0;
    if (selective) out.selectiveIterationCallsByDepth[level] += 1;
    else out.iterationCallsByDepth[level] += 1;
    const result = originalRunIteration.call(search, rootBundle, depth, nodeBudget,
      expansionLimit, selectiveRoot, abortOnNonExactSupport);
    if (selective) {
      out.selectiveIterationNodesByDepth[level] += Math.max(0, search.nodes - before);
      if (result) out.selectiveIterationCompletedByDepth[level] += 1;
    } else {
      out.iterationNodesByDepth[level] += Math.max(0, search.nodes - before);
      if (result) out.iterationCompletedByDepth[level] += 1;
    }
    return result;
  };

  return {
    begin() { rootFrame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME]; resetCollector(out); },
    restore() {
      kernel.applyFrame = originalApply; hard.classifyApplied = originalClassify;
      rootTransitions.apply = originalRootApply; search.probeFrame = originalProbeFrame;
      search.writeFrame = originalWriteFrame; search.generateDeep = originalGenerateDeep;
      search.consume = originalConsume; search.promoteFrameFromTT = originalPromote;
      search.heuristic = originalHeuristic; search.terminalValue = originalTerminalValue;
      search.probeDirectFireTrap = originalTrap; search.runIteration = originalRunIteration;
    }
  };
}

function addVector(target, source) {
  for (let index = 0; index < target.length; index += 1) target[index] += source[index] || 0;
}

function aggregateSamples(samples, phase) {
  const total = collector(); const completedDepth = {}; const valueSupportDepth = {};
  const selectiveCompletedDepth = {}; const selectiveAttemptedDepth = {};
  let nodes = 0; let workUnits = 0; let rootRestoreFailures = 0;
  let semanticMismatches = 0; let nodeAccountingMismatches = 0;
  for (const sample of samples) {
    const value = sample[phase]; nodes += value.nodes; workUnits += value.workUnits;
    rootRestoreFailures += value.rootRestoreFailures;
    semanticMismatches += sample.semanticMismatch;
    nodeAccountingMismatches += value.census.nodeAccountingMismatch ? 1 : 0;
    completedDepth[value.completedDepth] = (completedDepth[value.completedDepth] || 0) + 1;
    selectiveCompletedDepth[value.selectiveCompletedDepth] =
      (selectiveCompletedDepth[value.selectiveCompletedDepth] || 0) + 1;
    selectiveAttemptedDepth[value.selectiveAttemptedDepth] =
      (selectiveAttemptedDepth[value.selectiveAttemptedDepth] || 0) + 1;
    valueSupportDepth[value.valueSupportDepth] =
      (valueSupportDepth[value.valueSupportDepth] || 0) + 1;
    for (const [key, entry] of Object.entries(total)) {
      if (entry instanceof Uint32Array) addVector(entry, value.census[key]);
      else if (key !== "nodeAccountingMismatch") total[key] += value.census[key] || 0;
    }
  }
  const census = {};
  for (const [key, value] of Object.entries(total))
    census[key] = value instanceof Uint32Array ? Array.from(value) : value;
  census.nodeAccountingMismatchCalls = nodeAccountingMismatches;
  return { calls: samples.length, nodes, meanNodes: samples.length ? Math.floor(nodes / samples.length) : 0,
    workUnits, completedDepth, selectiveCompletedDepth, selectiveAttemptedDepth,
    valueSupportDepth, census,
    rootRestoreFailures, semanticMismatches };
}

function scenarioSetIdentity(indices) {
  const scenarios = [];
  for (const index of indices) {
    const prepared = calibration.preparedScenario(index);
    scenarios.push({ index, scenarioClass: prepared.scenarioClass,
      rootHashLo: prepared.rootHashLo, rootHashHi: prepared.rootHashHi,
      ourActions: Array.from(prepared.engine.ourActions.slice(0, prepared.ourCount)),
      ourArguments: Array.from(prepared.engine.ourArguments.slice(0, prepared.ourCount)),
      enemyActions: Array.from(prepared.engine.enemyActions.slice(0,
        prepared.engine.enemyCount)),
      enemyArguments: Array.from(prepared.engine.enemyArguments.slice(0,
        prepared.engine.enemyCount)),
      worldCells: Array.from(prepared.worldCells) });
  }
  return { count: indices.length, indices: Array.from(indices), scenarios,
    fingerprint: fingerprintObject({ scenarios }) };
}

function runProfile(profile, contract, scenarioIndices) {
  const samples = [];
  for (const index of scenarioIndices) {
    const prepared = calibration.preparedScenario(index, true);
    const search = new ProductionDepthSearch(new ProductionCacheBank({
      physicalValueEntries: contract.physicalTTEntries || 0
    }), RUNTIME_CONFIG,
      prepared.engine.rootTransitions, { selectiveContinuationEnabled: true,
        crossFramePVEnabled: true, diagnosticNodeCapacity: contract.nodeBudget,
        windowedBoundsEnabled: Boolean(contract.windowedBounds),
        diagnosticDirectSelectiveDepth: Boolean(contract.directSelectiveDepth) });
    const out = collector(); const installed = installCensus(search, prepared.bundle, out);
    const run = () => {
      installed.begin();
      search.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
        prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
        prepared.engine.enemyCount, profile.requestedDepth, contract.nodeBudget,
        contract.baseRisk);
      const depth = calibration.depthFields(search, profile);
      return { nodes: search.nodes, workUnits: search.updateWorkMeter(prepared.bundle), ...depth,
        attemptedDepth: search.attemptedDepth,
        selectiveCompletedDepth: search.selectiveCompletedDepth,
        selectiveAttemptedDepth: search.selectiveAttemptedDepth,
        rootRestoreFailures: search.rootRestoreFailures,
        census: snapshotCollector(out, search.nodes),
        semantic: fingerprintObject({ depth,
          rootScore: Array.from(search.rootScore.slice(0, prepared.ourCount)),
          rootCells: Array.from(search.rootCellScore.slice(0,
            prepared.ourCount * SEARCH_CAPACITY.MAX_ENEMY_POLICIES)) }) };
    };
    try {
      const cold = run(); const warm = run();
      samples.push({ scenarioIndex: index, cold, warm,
        semanticMismatch: cold.semantic === warm.semantic ? 0 : 1 });
    } finally { installed.restore(); }
  }
  return { profile, cold: aggregateSamples(samples, "cold"),
    warm: aggregateSamples(samples, "warm"),
    samples: samples.map(sample => ({ scenarioIndex: sample.scenarioIndex,
      semanticMismatch: sample.semanticMismatch,
      cold: { nodes: sample.cold.nodes, workUnits: sample.cold.workUnits,
        completedDepth: sample.cold.completedDepth,
        valueSupportDepth: sample.cold.valueSupportDepth,
        selectiveCompletedDepth: sample.cold.selectiveCompletedDepth,
        selectiveAttemptedDepth: sample.cold.selectiveAttemptedDepth },
      warm: { nodes: sample.warm.nodes, workUnits: sample.warm.workUnits,
        completedDepth: sample.warm.completedDepth,
        valueSupportDepth: sample.warm.valueSupportDepth,
        selectiveCompletedDepth: sample.warm.selectiveCompletedDepth,
        selectiveAttemptedDepth: sample.warm.selectiveAttemptedDepth } })) };
}

function run(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const loaded = calibration.loadContract(root); const contract = { ...loaded.contract };
  if (Number.isSafeInteger(options.nodeBudget) && options.nodeBudget > 0)
    contract.nodeBudget = options.nodeBudget;
  if (Number.isSafeInteger(options.physicalTTEntries) && options.physicalTTEntries > 0)
    contract.physicalTTEntries = options.physicalTTEntries;
  contract.windowedBounds = options.windowedBounds ? 1 : 0;
  contract.directSelectiveDepth = options.directSelectiveDepth ? 1 : 0;
  const scenarioCount = Number.isSafeInteger(options.scenarioCount) ? options.scenarioCount :
    contract.scenarioCount;
  const scenarioOffset = Number.isSafeInteger(options.scenarioOffset) ?
    options.scenarioOffset : 0;
  const scenarioIndices = Array.from({ length: scenarioCount }, (_, index) =>
    scenarioOffset + index);
  const selected = calibration.profiles(contract).filter(profile =>
    profile.kind === "PHYSICAL" &&
    (!options.minDepth || profile.requestedDepth >= options.minDepth) &&
    (!options.maxDepth || profile.requestedDepth <= options.maxDepth));
  const report = {
    schemaVersion: 1, objectKind: OBJECT_KIND, status: "PASS",
    contractFingerprint: loaded.fingerprint,
    effectiveContractFingerprint: fingerprintObject(contract),
    nodeBudget: contract.nodeBudget,
    physicalTTEntries: contract.physicalTTEntries || CACHE_CONFIG.ENTRY_COUNT[0],
    windowedBounds: contract.windowedBounds,
    directSelectiveDepth: contract.directSelectiveDepth,
    source: calibration.sourceIdentity(root),
    scenarioSet: scenarioSetIdentity(scenarioIndices),
    scenarioOffset, scenarioIndices, scenarioCount, profiles: {}, invariants: {
      rootRestoreFailures: 0, semanticMismatches: 0, nodeAccountingMismatchCalls: 0
    }
  };
  for (const profile of selected) {
    const result = runProfile(profile, contract, scenarioIndices);
    report.profiles[profile.id] = result;
    for (const phase of [result.cold, result.warm]) {
      report.invariants.rootRestoreFailures += phase.rootRestoreFailures;
      report.invariants.semanticMismatches += phase.semanticMismatches;
      report.invariants.nodeAccountingMismatchCalls +=
        phase.census.nodeAccountingMismatchCalls;
    }
  }
  if (Object.values(report.invariants).some(Boolean)) report.status = "FAIL";
  report.fingerprint = fingerprintObject(report); return report;
}

function verify(report) {
  const errors = [];
  if (!report || report.objectKind !== OBJECT_KIND) errors.push("OBJECT_KIND");
  if (!report || report.status !== "PASS") errors.push("REPORT_STATUS");
  if (!report || Object.values(report.invariants || {}).some(Boolean)) errors.push("INVARIANTS");
  if (!report || !Object.keys(report.profiles || {}).length) errors.push("PROFILES");
  if (!report || !Array.isArray(report.scenarioIndices) ||
      report.scenarioIndices.length !== report.scenarioCount ||
      new Set(report.scenarioIndices).size !== report.scenarioCount)
    errors.push("SCENARIO_INDICES");
  for (const [id, profile] of Object.entries(report?.profiles || {}))
    for (const phase of ["cold", "warm"])
      if (profile[phase].calls !== report.scenarioCount ||
          profile[phase].census.nodeAccountingMismatchCalls)
        errors.push(`DENOMINATOR_OR_ACCOUNTING:${id}:${phase}`);
  for (const [id, profile] of Object.entries(report?.profiles || {})) {
    const sampleIndices = (profile.samples || []).map(sample => sample.scenarioIndex);
    if (sampleIndices.length !== report.scenarioCount ||
        sampleIndices.some((value, index) => value !== report.scenarioIndices[index]))
      errors.push(`SAMPLE_INDICES:${id}`);
  }
  return { status: errors.length ? "FAIL" : "PASS", errors,
    reportFingerprint: report?.fingerprint || null };
}

function readJson(file) { return JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); }

function main(root = defaultWorkspaceRoot()) {
  const command = process.argv[2] || "run";
  if (command === "run") {
    const report = run({ workspaceRoot: root,
      scenarioCount: integerOption("--scenarios", undefined, 1),
      scenarioOffset: integerOption("--offset", 0, 0),
      minDepth: integerOption("--min-depth", undefined, 1),
      maxDepth: integerOption("--max-depth", undefined, 1),
      nodeBudget: integerOption("--node-budget", undefined, 1),
      physicalTTEntries: integerOption("--physical-tt-entries", undefined, 2),
      windowedBounds: option("--windowed-bounds", "off") === "on",
      directSelectiveDepth: option("--direct-selective-depth", "off") === "on" });
    const output = option("--output");
    if (output) writeJsonAtomic(path.resolve(output), report, { mode: 0o644 });
    process.stdout.write(`${JSON.stringify({ status: report.status, output: output || null,
      fingerprint: report.fingerprint, sourceFingerprint: report.source.fingerprint,
      scenarioCount: report.scenarioCount, nodeBudget: report.nodeBudget,
      scenarioOffset: report.scenarioOffset,
      physicalTTEntries: report.physicalTTEntries,
      windowedBounds: report.windowedBounds,
      directSelectiveDepth: report.directSelectiveDepth,
      profiles: Object.keys(report.profiles),
      invariants: report.invariants }, null, 2)}\n`);
    if (report.status !== "PASS") process.exitCode = 1;
    return report;
  }
  if (command === "verify") {
    const result = verify(readJson(option("--report")));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "PASS") process.exitCode = 1;
    return result;
  }
  throw new Error(`MINIMAX_COST_CENSUS_COMMAND:${command}`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1;
  }
}

module.exports = { OBJECT_KIND, collector, installCensus, scenarioSetIdentity,
  runProfile, run, verify, main };
