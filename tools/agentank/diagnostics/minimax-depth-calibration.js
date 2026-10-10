#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ProductionRootEngine } = require("../../../engine-v2/src/runtime/production-root");
const { ProductionDepthSearch } = require(
  "../../../engine-v2/src/search/production-depth-search");
const { ProductionInformationSearch } = require(
  "../../../engine-v2/src/search/production-information-search");
const { ProductionCacheBank } = require("../../../engine-v2/src/cache/production-cache");
const { RiskProfile } = require("../../../engine-v2/src/search/risk");
const { SEARCH_CAPACITY } = require("../../../engine-v2/src/generated/search-config");
const { RUNTIME_CONFIG } = require("../../../engine-v2/src/generated/runtime-config");
const { ACTION, TERRAIN } = require("../../../engine-v2/src/abi/fast-codes");
const { ARRAY } = require("../../../engine-v2/src/state/fast-state");
const { benchmarkFixture } = require("../benchmark/search-frontier-benchmark");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");

const OBJECT_KIND = "MINIMAX_DEPTH_CALIBRATION_V1";
const SOURCE_FILES = Object.freeze([
  "engine-v2/src/cache/production-cache.js",
  "engine-v2/src/abi/cache-runtime-codes.js",
  "engine-v2/src/search/production-depth-search.js",
  "engine-v2/src/search/production-information-search.js",
  "engine-v2/src/search/selective-geometry-shadow.js",
  "engine-v2/src/search/root-transition-slab.js",
  "engine-v2/src/search/contender-frontier.js",
  "engine-v2/src/search/value-search.js",
  "engine-v2/src/search/engine.js",
  "engine-v2/src/runtime/production-root.js",
  "engine-v2/src/runtime/controller.js",
  "engine-v2/src/fast/kernel.js",
  "engine-v2/src/fast/hard-gate.js",
  "engine-v2/src/fast/hazard.js",
  "engine-v2/src/generated/search-config.js",
  "engine-v2/src/generated/runtime-config.js"
]);
const HARNESS_FILES = Object.freeze([
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
    throw new Error(`MINIMAX_CALIBRATION_OPTION:${name}:${value}`);
  return value;
}

function percentile(values, percent) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percent / 100) - 1)];
}

function median(values) { return percentile(values, 50); }
function mean(values) {
  return values.length ? Math.floor(values.reduce((sum, value) => sum + value, 0) /
    values.length) : 0;
}

function loadContract(root = defaultWorkspaceRoot()) {
  const file = contained(root, "config", "engine-v2", "minimax-depth-calibration-contract.json");
  const contract = JSON.parse(fs.readFileSync(file, "utf8"));
  if (contract.schemaVersion !== 1 || contract.contractId !== "MINIMAX_DEPTH_CALIBRATION_V1")
    throw new Error("MINIMAX_CALIBRATION_CONTRACT_INVALID");
  return { file, contract, fingerprint: fingerprintObject(contract) };
}

function sourceIdentity(root = defaultWorkspaceRoot()) {
  const files = {};
  for (const relative of SOURCE_FILES) {
    const file = contained(root, ...relative.split("/"));
    files[relative] = sha256Bytes(fs.readFileSync(file));
  }
  return { files, fingerprint: fingerprintObject(files) };
}

function harnessIdentity(root = defaultWorkspaceRoot()) {
  const files = {};
  for (const relative of HARNESS_FILES) {
    const file = contained(root, ...relative.split("/"));
    files[relative] = sha256Bytes(fs.readFileSync(file));
  }
  return { files, fingerprint: fingerprintObject(files) };
}

function environmentIdentity() {
  return { node: process.version, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0]?.model || "UNKNOWN" };
}

function profiles(contract) {
  const output = [];
  for (const depth of contract.physicalDepths)
    output.push(Object.freeze({ id: `P${depth}`, kind: "PHYSICAL",
      requestedDepth: depth, requestedInformationRootDepth: 0,
      requestedPhysicalContinuationDepth: depth, worldCount: 0 }));
  for (const worldCount of contract.informationWorldCounts)
    for (const continuation of contract.physicalContinuationDepths)
      output.push(Object.freeze({ id: `I1W${worldCount}-P${continuation}`,
        kind: "INFORMATION", requestedDepth: 1 + continuation,
        requestedInformationRootDepth: 1,
        requestedPhysicalContinuationDepth: continuation, worldCount }));
  return output;
}

function preparedScenario(index, rootTransitionsEnabled = true) {
  const fixture = benchmarkFixture(index); const engine = new ProductionRootEngine({
    diagnosticRootTransitionSlab: rootTransitionsEnabled
  });
  const adapted = engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
  if (!adapted.bundle)
    throw new Error(`MINIMAX_CALIBRATION_ADAPT:${index}:${adapted.status}`);
  engine.generateActions(); let ourCount = engine.ourCount;
  if (ourCount > 1 && engine.ourActions[ourCount - 1] === ACTION.NONE) ourCount -= 1;
  const state = adapted.bundle.state; const a = state.arrays; const enemy = a[ARRAY.TANK_CELL][1];
  const candidates = [enemy];
  for (let distance = 1; candidates.length < 4 && distance < state.width + state.height;
      distance += 1)
    for (let cell = 0; cell < state.cells && candidates.length < 4; cell += 1) {
      if (cell === enemy || cell === a[ARRAY.TANK_CELL][0] ||
          a[ARRAY.TERRAIN][cell] === TERRAIN.WALL ||
          a[ARRAY.TERRAIN][cell] === TERRAIN.DIRT) continue;
      const delta = Math.abs(state.x(cell) - state.x(enemy)) +
        Math.abs(state.y(cell) - state.y(enemy));
      if (delta === distance) candidates.push(cell);
    }
  return { fixture, engine, bundle: adapted.bundle, ourCount,
    worldCells: Uint16Array.from(candidates),
    scenarioClass: `V${index & 3}`, rootHashLo: state.hashLo, rootHashHi: state.hashHi };
}

function scenarioSetIdentity(count) {
  const scenarios = [];
  for (let index = 0; index < count; index += 1) {
    const prepared = preparedScenario(index);
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
  return { count, scenarios, fingerprint: fingerprintObject({ scenarios }) };
}

function uniformMass(count) {
  const output = new Uint16Array(count); const base = Math.floor(10000 / count);
  output.fill(base); let assigned = base * count;
  for (let index = 0; assigned < 10000; index = (index + 1) % count) {
    output[index] += 1; assigned += 1;
  }
  return output;
}

function uniformEnemyProbability(count) {
  const output = new Uint16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  if (!count) return output;
  const base = Math.floor(10000 / count); let assigned = 0;
  for (let index = 0; index < count; index += 1) {
    output[index] = base; assigned += base;
  }
  for (let index = 0; assigned < 10000; index = (index + 1) % count) {
    output[index] += 1; assigned += 1;
  }
  return output;
}

function activeValues(search, ourCount, enemyCount) {
  const rows = [];
  for (let row = 0; row < ourCount; row += 1) {
    const cells = [];
    for (let column = 0; column < enemyCount; column += 1)
      cells.push(search.rootCellScore[row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column]);
    rows.push([search.rootScore[row], cells]);
  }
  return rows;
}

function depthFields(search, profile) {
  if (profile.kind === "PHYSICAL") return {
    completedDepth: search.completedDepth,
    informationRootDepth: 0,
    physicalContinuationDepth: search.completedDepth,
    valueSupportDepth: search.representativeSupportComplete ?
      search.representativeSupportDepth : 0,
    valueSupportExpansionLimit: search.representativeSupportComplete ?
      search.representativeSupportExpansionLimit : 0
  };
  const informationRootDepth = Number.isSafeInteger(search.informationRootDepth) ?
    search.informationRootDepth : search.completedDepth > 0 ? 1 : 0;
  const physicalContinuationDepth = Number.isSafeInteger(search.physicalContinuationDepth) ?
    search.physicalContinuationDepth : Math.max(0, search.completedDepth - informationRootDepth);
  const completedDepth = informationRootDepth + physicalContinuationDepth;
  return { completedDepth, informationRootDepth, physicalContinuationDepth,
    valueSupportDepth: search.supportComplete === 1 && search.approximate === 0 ?
      completedDepth : 0, valueSupportExpansionLimit: 0 };
}

function physicalRunner(prepared, profile, contract, selectiveContinuationEnabled = false,
    successorTTPVEnabled = true, windowedBoundsEnabled = false) {
  const search = new ProductionDepthSearch(new ProductionCacheBank(), RUNTIME_CONFIG,
    prepared.engine.rootTransitions, { selectiveContinuationEnabled,
      crossFramePVEnabled: successorTTPVEnabled, windowedBoundsEnabled });
  return () => {
    const started = process.hrtime.bigint();
    search.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
      prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
      prepared.engine.enemyCount, profile.requestedDepth, contract.nodeBudget,
      contract.baseRisk);
    const micros = Number((process.hrtime.bigint() - started) / 1000n);
    const depth = depthFields(search, profile);
    return { micros, nodes: search.nodes, attemptedDepth: search.attemptedDepth,
      selectiveCompletedDepth: search.selectiveCompletedDepth,
      ...depth, supportComplete: search.representativeSupportComplete,
      exactOwnerEarlyAborts: search.exactOwnerEarlyAbortCount,
      rootTransitionHits: search.rootTransitionHits,
      rootTransitionReplayFailures: prepared.engine.rootTransitions.replayFailureCount,
      rootRestoreFailures: search.rootRestoreFailures,
      hotAllocations: search.hotAllocationCount,
      semantic: fingerprintObject({ depth, values: activeValues(search,
        prepared.ourCount, prepared.engine.enemyCount) }) };
  };
}

function informationRunner(prepared, profile, contract, successorTTPVEnabled = true) {
  const risk = new RiskProfile();
  const evaluator = new ProductionDepthSearch(new ProductionCacheBank(), RUNTIME_CONFIG,
    prepared.engine.rootTransitions, { crossFramePVEnabled: successorTTPVEnabled });
  const search = new ProductionInformationSearch({ riskProfile: risk });
  const worldCount = Math.min(profile.worldCount, prepared.worldCells.length);
  const worldCells = prepared.worldCells.slice(0, worldCount);
  const worldMass = uniformMass(worldCount);
  const enemyProbability = uniformEnemyProbability(prepared.engine.enemyCount);
  return () => {
    const started = process.hrtime.bigint();
    search.search(prepared.bundle, evaluator,
      prepared.engine.ourActions, prepared.engine.ourArguments, prepared.ourCount,
      prepared.engine.enemyActions, prepared.engine.enemyArguments, prepared.engine.enemyCount,
      worldCells, worldMass, worldCount, 1, contract.nodeBudget, contract.baseRisk,
      prepared.bundle.state.arrays[ARRAY.TANK_DIR][1], 1, enemyProbability,
      profile.requestedDepth);
    const micros = Number((process.hrtime.bigint() - started) / 1000n);
    const depth = depthFields(search, profile);
    return { micros, nodes: search.nodes, attemptedDepth: search.attemptedDepth,
      ...depth, supportComplete: search.supportComplete,
      exactOwnerEarlyAborts: evaluator.exactOwnerEarlyAbortCount,
      rootTransitionHits: search.rootTransitionHits + evaluator.rootTransitionHits,
      rootTransitionReplayFailures: prepared.engine.rootTransitions.replayFailureCount,
      rootRestoreFailures: search.rootRestoreFailures + evaluator.rootRestoreFailures,
      hotAllocations: search.hotAllocationCount + evaluator.hotAllocationCount,
      semantic: fingerprintObject({ depth, values: activeValues(search,
        prepared.ourCount, prepared.engine.enemyCount) }) };
  };
}

function runSample(index, profile, contract, rootTransitionsEnabled = true,
    selectiveContinuationEnabled = false, successorTTPVEnabled = true,
    windowedBoundsEnabled = false) {
  const prepared = preparedScenario(index, rootTransitionsEnabled);
  const run = profile.kind === "PHYSICAL" ? physicalRunner(prepared, profile, contract,
    selectiveContinuationEnabled, successorTTPVEnabled, windowedBoundsEnabled) :
    informationRunner(prepared, profile, contract, successorTTPVEnabled);
  const cold = run(); const warm = run();
  const state = prepared.bundle.state;
  const rootRestored = state.hashLo === prepared.rootHashLo && state.hashHi === prepared.rootHashHi;
  return { scenarioIndex: index, scenarioClass: prepared.scenarioClass,
    rootActions: prepared.ourCount, enemyActions: prepared.engine.enemyCount,
    cold, warm, semanticMismatch: cold.semantic === warm.semantic ? 0 : 1,
    comparableSemanticMismatch: cold.supportComplete && warm.supportComplete &&
      cold.completedDepth === warm.completedDepth &&
      cold.semantic !== warm.semantic ? 1 : 0,
    cacheDepthGain: warm.completedDepth - cold.completedDepth,
    rootRestored: rootRestored ? 1 : 0 };
}

function emptyAggregate(profile) {
  return { profile, calls: 0, coldMicros: [], warmMicros: [], coldNodes: [], warmNodes: [],
    completedDepth: [], informationRootDepth: [], physicalContinuationDepth: [],
    valueSupportDepth: [], valueSupportExpansionLimit: [],
    warmCompletedDepth: [], warmInformationRootDepth: [], warmPhysicalContinuationDepth: [],
    warmValueSupportDepth: [], warmValueSupportExpansionLimit: [],
    cacheDepthGain: [], selectiveCompletedDepth: [],
    exactOwnerEarlyAborts: 0,
    attemptedDepth: [], requestedCompleted: 0, supportComplete: 0,
    rootRestoreFailures: 0, rootTransitionReplayFailures: 0, hotAllocations: 0,
    rootTransitionHits: [], semanticMismatches: 0,
    rootRestoreMismatches: 0, rootActions: [], enemyActions: [] };
}

function addSample(aggregate, sample) {
  const value = sample.cold; aggregate.calls += 1;
  aggregate.coldMicros.push(value.micros); aggregate.warmMicros.push(sample.warm.micros);
  aggregate.coldNodes.push(value.nodes); aggregate.warmNodes.push(sample.warm.nodes);
  aggregate.completedDepth.push(value.completedDepth);
  aggregate.informationRootDepth.push(value.informationRootDepth);
  aggregate.physicalContinuationDepth.push(value.physicalContinuationDepth);
  aggregate.valueSupportDepth.push(value.valueSupportDepth);
  aggregate.valueSupportExpansionLimit.push(value.valueSupportExpansionLimit);
  aggregate.warmCompletedDepth.push(sample.warm.completedDepth);
  aggregate.warmInformationRootDepth.push(sample.warm.informationRootDepth);
  aggregate.warmPhysicalContinuationDepth.push(sample.warm.physicalContinuationDepth);
  aggregate.warmValueSupportDepth.push(sample.warm.valueSupportDepth);
  aggregate.warmValueSupportExpansionLimit.push(sample.warm.valueSupportExpansionLimit);
  aggregate.cacheDepthGain.push(sample.cacheDepthGain);
  aggregate.selectiveCompletedDepth.push(value.selectiveCompletedDepth || 0);
  aggregate.exactOwnerEarlyAborts += value.exactOwnerEarlyAborts || 0;
  aggregate.attemptedDepth.push(value.attemptedDepth);
  if (value.completedDepth >= aggregate.profile.requestedDepth)
    aggregate.requestedCompleted += 1;
  aggregate.supportComplete += value.supportComplete ? 1 : 0;
  aggregate.rootRestoreFailures += value.rootRestoreFailures + sample.warm.rootRestoreFailures;
  aggregate.rootTransitionReplayFailures += value.rootTransitionReplayFailures +
    sample.warm.rootTransitionReplayFailures;
  aggregate.rootTransitionHits.push(value.rootTransitionHits);
  aggregate.hotAllocations += value.hotAllocations + sample.warm.hotAllocations;
  aggregate.semanticMismatches += sample.comparableSemanticMismatch;
  aggregate.rootRestoreMismatches += sample.rootRestored ? 0 : 1;
  aggregate.rootActions.push(sample.rootActions); aggregate.enemyActions.push(sample.enemyActions);
}

function histogram(values) {
  const output = {};
  for (const value of values) output[value] = (output[value] || 0) + 1;
  return output;
}

function summarize(aggregate) {
  const calls = aggregate.calls;
  return { profile: aggregate.profile, calls,
    requestedCompletionPer10000: calls ?
      Math.floor(aggregate.requestedCompleted * 10000 / calls) : 0,
    supportCompletePer10000: calls ? Math.floor(aggregate.supportComplete * 10000 / calls) : 0,
    completedDepthHistogram: histogram(aggregate.completedDepth),
    informationRootDepthHistogram: histogram(aggregate.informationRootDepth),
    physicalContinuationDepthHistogram: histogram(aggregate.physicalContinuationDepth),
    valueSupportDepthHistogram: histogram(aggregate.valueSupportDepth),
    valueSupportExpansionLimitHistogram: histogram(aggregate.valueSupportExpansionLimit),
    warmCompletedDepthHistogram: histogram(aggregate.warmCompletedDepth),
    warmInformationRootDepthHistogram: histogram(aggregate.warmInformationRootDepth),
    warmPhysicalContinuationDepthHistogram: histogram(aggregate.warmPhysicalContinuationDepth),
    warmValueSupportDepthHistogram: histogram(aggregate.warmValueSupportDepth),
    warmValueSupportExpansionLimitHistogram:
      histogram(aggregate.warmValueSupportExpansionLimit),
    cacheDepthGainHistogram: histogram(aggregate.cacheDepthGain),
    selectiveCompletedDepthHistogram: histogram(aggregate.selectiveCompletedDepth),
    attemptedDepthHistogram: histogram(aggregate.attemptedDepth),
    exactOwnerEarlyAborts: aggregate.exactOwnerEarlyAborts,
    cold: { p50Micros: median(aggregate.coldMicros),
      p95Micros: percentile(aggregate.coldMicros, 95),
      p99Micros: percentile(aggregate.coldMicros, 99),
      meanNodes: mean(aggregate.coldNodes), p50Nodes: median(aggregate.coldNodes),
      p95Nodes: percentile(aggregate.coldNodes, 95) },
    warm: { p50Micros: median(aggregate.warmMicros),
      p95Micros: percentile(aggregate.warmMicros, 95),
      p99Micros: percentile(aggregate.warmMicros, 99),
      meanNodes: mean(aggregate.warmNodes), p50Nodes: median(aggregate.warmNodes),
      p95Nodes: percentile(aggregate.warmNodes, 95) },
    rootTransitionHits: { p50: median(aggregate.rootTransitionHits),
      p95: percentile(aggregate.rootTransitionHits, 95) },
    rootActions: { p50: median(aggregate.rootActions), p95: percentile(aggregate.rootActions, 95) },
    enemyActions: { p50: median(aggregate.enemyActions), p95: percentile(aggregate.enemyActions, 95) },
    invariants: { rootRestoreFailures: aggregate.rootRestoreFailures,
      rootTransitionReplayFailures: aggregate.rootTransitionReplayFailures,
      rootRestoreMismatches: aggregate.rootRestoreMismatches,
      hotAllocations: aggregate.hotAllocations,
      warmColdSemanticMismatches: aggregate.semanticMismatches } };
}

function benchmark(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const loaded = loadContract(root); const contract = { ...loaded.contract };
  if (Number.isSafeInteger(options.scenarioCount)) contract.scenarioCount = options.scenarioCount;
  if (Number.isSafeInteger(options.warmupBatches)) contract.warmupBatches = options.warmupBatches;
  if (Number.isSafeInteger(options.measuredBatches)) contract.measuredBatches = options.measuredBatches;
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor !== contract.requiredNodeMajor)
    throw new Error(`MINIMAX_CALIBRATION_NODE_MAJOR:${nodeMajor}`);
  const matrix = profiles(contract);
  const rootTransitionsEnabled = options.rootTransitionsEnabled !== false;
  const selectiveContinuationEnabled = options.selectiveContinuationEnabled === true;
  const successorTTPVEnabled = options.successorTTPVEnabled !== false;
  const windowedBoundsEnabled = options.windowedBoundsEnabled === true;
  const scenarioSet = scenarioSetIdentity(contract.scenarioCount);
  for (let batch = 0; batch < contract.warmupBatches; batch += 1)
    for (let index = 0; index < contract.scenarioCount; index += 1)
      for (const profile of matrix)
        runSample(index, profile, contract, rootTransitionsEnabled,
          selectiveContinuationEnabled, successorTTPVEnabled, windowedBoundsEnabled);
  const aggregates = Object.fromEntries(matrix.map(profile => [profile.id, emptyAggregate(profile)]));
  for (let batch = 0; batch < contract.measuredBatches; batch += 1)
    for (let index = 0; index < contract.scenarioCount; index += 1)
      for (const profile of matrix)
        addSample(aggregates[profile.id], runSample(index, profile, contract,
          rootTransitionsEnabled, selectiveContinuationEnabled, successorTTPVEnabled,
          windowedBoundsEnabled));
  const summaries = Object.fromEntries(matrix.map(profile =>
    [profile.id, summarize(aggregates[profile.id])]));
  const invariantTotals = { rootRestoreFailures: 0, rootTransitionReplayFailures: 0,
    rootRestoreMismatches: 0,
    hotAllocations: 0, warmColdSemanticMismatches: 0 };
  for (const summary of Object.values(summaries))
    for (const key of Object.keys(invariantTotals)) invariantTotals[key] += summary.invariants[key];
  const report = { schemaVersion: 1, objectKind: OBJECT_KIND, status:
    Object.values(invariantTotals).every(value => value === 0) ? "PASS" : "FAIL",
    createdAt: new Date().toISOString(), node: process.version,
    environment: environmentIdentity(), harness: harnessIdentity(root), scenarioSet,
    contract, contractFingerprint: fingerprintObject(contract),
    features: { rootTransitionSlab: rootTransitionsEnabled ? 1 : 0,
      selectiveContinuation: selectiveContinuationEnabled ? 1 : 0,
      successorTTPV: successorTTPVEnabled ? 1 : 0,
      windowedBounds: windowedBoundsEnabled ? 1 : 0 },
    canonicalContractFingerprint: loaded.fingerprint,
    source: sourceIdentity(root), profileCount: matrix.length,
    measuredCallsPerProfile: contract.scenarioCount * contract.measuredBatches,
    invariantTotals, summaries, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); return report;
}

function verify(report) {
  const errors = [];
  if (!report || report.objectKind !== OBJECT_KIND || report.schemaVersion !== 1)
    errors.push("REPORT_IDENTITY");
  const expectedCalls = report?.contract?.scenarioCount * report?.contract?.measuredBatches;
  if (!Number.isSafeInteger(expectedCalls) || expectedCalls < 1) errors.push("DENOMINATOR");
  const expectedProfiles = report?.contract ? profiles(report.contract).map(item => item.id) : [];
  const actualProfiles = Object.keys(report?.summaries || {});
  if (report?.profileCount !== expectedProfiles.length ||
      actualProfiles.length !== expectedProfiles.length ||
      expectedProfiles.some(id => !Object.hasOwn(report?.summaries || {}, id)))
    errors.push("PROFILE_SET");
  if (report?.contractFingerprint !== fingerprintObject(report?.contract || {}))
    errors.push("CONTRACT_FINGERPRINT");
  if (report?.scenarioSet?.count !== report?.contract?.scenarioCount ||
      report?.scenarioSet?.fingerprint !==
        fingerprintObject({ scenarios: report?.scenarioSet?.scenarios || [] }))
    errors.push("SCENARIO_SET_FINGERPRINT");
  if (!report?.harness?.fingerprint || !report?.environment?.node)
    errors.push("CALIBRATION_IDENTITY");
  for (const [id, summary] of Object.entries(report?.summaries || {})) {
    if (summary.calls !== expectedCalls) errors.push(`CALLS:${id}`);
    if (!summary.cold || !summary.warm) errors.push(`CACHE_LANES:${id}`);
  }
  for (const [key, value] of Object.entries(report?.invariantTotals || {}))
    if (value !== 0) errors.push(`INVARIANT:${key}:${value}`);
  if (report?.fingerprint !== fingerprintObject({ ...report, fingerprint: "" }))
    errors.push("FINGERPRINT");
  return { status: errors.length ? "FAIL" : "PASS", errors };
}

function compare(baseline, candidate) {
  const errors = [];
  if (baseline.contractFingerprint !== candidate.contractFingerprint)
    errors.push("CONTRACT_FINGERPRINT");
  if (baseline.harness?.fingerprint !== candidate.harness?.fingerprint)
    errors.push("HARNESS_FINGERPRINT");
  if (baseline.scenarioSet?.fingerprint !== candidate.scenarioSet?.fingerprint)
    errors.push("SCENARIO_SET_FINGERPRINT");
  if (fingerprintObject(baseline.environment || {}) !==
      fingerprintObject(candidate.environment || {}))
    errors.push("ENVIRONMENT_FINGERPRINT");
  const profiles_ = {};
  for (const id of Object.keys(baseline.summaries || {})) {
    const before = baseline.summaries[id]; const after = candidate.summaries?.[id];
    if (!after) { errors.push(`PROFILE_MISSING:${id}`); continue; }
    profiles_[id] = {
      requestedCompletionDelta: after.requestedCompletionPer10000 -
        before.requestedCompletionPer10000,
      coldP95MicrosDelta: after.cold.p95Micros - before.cold.p95Micros,
      warmP95MicrosDelta: after.warm.p95Micros - before.warm.p95Micros,
      coldP95NodesDelta: after.cold.p95Nodes - before.cold.p95Nodes,
      coldMeanNodesDelta: Number.isSafeInteger(before.cold.meanNodes) ?
        after.cold.meanNodes - before.cold.meanNodes : null,
      completedDepthBefore: before.completedDepthHistogram,
      completedDepthAfter: after.completedDepthHistogram,
      valueSupportDepthBefore: before.valueSupportDepthHistogram,
      valueSupportDepthAfter: after.valueSupportDepthHistogram,
      valueSupportExpansionLimitBefore: before.valueSupportExpansionLimitHistogram,
      valueSupportExpansionLimitAfter: after.valueSupportExpansionLimitHistogram
    };
  }
  const output = { schemaVersion: 1, objectKind: "MINIMAX_DEPTH_CALIBRATION_COMPARISON_V1",
    status: errors.length ? "FAIL" : "PASS", errors,
    baselineFingerprint: baseline.fingerprint, candidateFingerprint: candidate.fingerprint,
    sourceChanged: baseline.source.fingerprint === candidate.source.fingerprint ? 0 : 1,
    profiles: profiles_, fingerprint: "" };
  output.fingerprint = fingerprintObject(output); return output;
}

function reportPath(root, fingerprint) {
  return contained(root, "artifacts", "benchmarks", "minimax-depth-calibration",
    "runs", fingerprint, "report.json");
}

function readReport(file) { return JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); }

function unwrapReport(value) {
  if (value?.objectKind === "MINIMAX_DEPTH_CALIBRATION_BASELINE_V1")
    return value.report;
  return value;
}

function writeRun(root, report, requestedOutput = null) {
  const file = requestedOutput ? path.resolve(requestedOutput) : reportPath(root, report.fingerprint);
  writeJsonImmutable(file, report, { mode: 0o644 });
  const latest = contained(root, "artifacts", "benchmarks", "minimax-depth-calibration",
    "latest.json");
  writeJsonAtomic(latest, report, { mode: 0o644 }); return { file, latest };
}

function freeze(root, report, name) {
  if (!/^[a-z][a-z0-9_-]*$/.test(name || ""))
    throw new Error("MINIMAX_CALIBRATION_BASELINE_NAME");
  const verification = verify(report);
  if (verification.status !== "PASS")
    throw new Error(`MINIMAX_CALIBRATION_VERIFY:${verification.errors.join(",")}`);
  const baseline = { schemaVersion: 1, objectKind: "MINIMAX_DEPTH_CALIBRATION_BASELINE_V1",
    name, frozenAt: new Date().toISOString(), reportFingerprint: report.fingerprint,
    source: report.source, contractFingerprint: report.contractFingerprint,
    node: report.node, report, fingerprint: "" };
  baseline.fingerprint = fingerprintObject(baseline);
  const file = contained(root, "artifacts", "benchmarks", "minimax-depth-calibration",
    "baselines", `${name}-${baseline.fingerprint}.json`);
  writeJsonImmutable(file, baseline, { mode: 0o644 });
  const trackedFile = contained(root, "config", "engine-v2", "minimax-depth-baselines",
    `${name}.json`);
  writeJsonImmutable(trackedFile, baseline, { mode: 0o644 });
  writeJsonAtomic(contained(root, "artifacts", "benchmarks", "minimax-depth-calibration",
    `baseline-${name}.json`), baseline, { mode: 0o644 });
  return { file, trackedFile, baseline };
}

function status(root, baseline) {
  const current = sourceIdentity(root); const currentHarness = harnessIdentity(root);
  const sourceStale = current.fingerprint !== baseline.source.fingerprint;
  const harnessStale = currentHarness.fingerprint !== baseline.harness?.fingerprint;
  const stale = sourceStale || harnessStale;
  return { status: stale ? "RECALIBRATION_REQUIRED" : "CURRENT",
    baselineSourceFingerprint: baseline.source.fingerprint,
    currentSourceFingerprint: current.fingerprint,
    baselineHarnessFingerprint: baseline.harness?.fingerprint || null,
    currentHarnessFingerprint: currentHarness.fingerprint,
    reasons: [sourceStale ? "SOURCE_CHANGED" : null,
      harnessStale ? "HARNESS_CHANGED" : null].filter(Boolean) };
}

function main(root = defaultWorkspaceRoot()) {
  const command = process.argv[2] || "run"; const workspaceRoot = path.resolve(root);
  if (command === "run") {
    const rootTransitionOption = option("--root-transitions", "on");
    if (rootTransitionOption !== "on" && rootTransitionOption !== "off")
      throw new Error(`MINIMAX_CALIBRATION_OPTION:--root-transitions:${rootTransitionOption}`);
    const selectiveOption = option("--selective-continuation", "off");
    if (selectiveOption !== "on" && selectiveOption !== "off")
      throw new Error(`MINIMAX_CALIBRATION_OPTION:--selective-continuation:${selectiveOption}`);
    const successorPVOption = option("--successor-tt-pv", "on");
    if (successorPVOption !== "on" && successorPVOption !== "off")
      throw new Error(`MINIMAX_CALIBRATION_OPTION:--successor-tt-pv:${successorPVOption}`);
    const windowedOption = option("--windowed-bounds", "off");
    if (windowedOption !== "on" && windowedOption !== "off")
      throw new Error(`MINIMAX_CALIBRATION_OPTION:--windowed-bounds:${windowedOption}`);
    const report = benchmark({ workspaceRoot,
      scenarioCount: integerOption("--scenarios", undefined, 1),
      warmupBatches: integerOption("--warmup", undefined, 0),
      measuredBatches: integerOption("--batches", undefined, 1),
      rootTransitionsEnabled: rootTransitionOption === "on",
      selectiveContinuationEnabled: selectiveOption === "on",
      successorTTPVEnabled: successorPVOption === "on",
      windowedBoundsEnabled: windowedOption === "on" });
    const written = writeRun(workspaceRoot, report, option("--output"));
    process.stdout.write(`${JSON.stringify({ status: report.status, file: written.file,
      fingerprint: report.fingerprint, sourceFingerprint: report.source.fingerprint,
      profileCount: report.profileCount, callsPerProfile: report.measuredCallsPerProfile,
      features: report.features,
      invariantTotals: report.invariantTotals }, null, 2)}\n`); return report;
  }
  if (command === "verify") {
    const report = readReport(option("--report")); const result = verify(report);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "PASS") process.exitCode = 1; return result;
  }
  if (command === "freeze") {
    const result = freeze(workspaceRoot, readReport(option("--report")),
      option("--name", "baseline"));
    process.stdout.write(`${JSON.stringify({ status: "FROZEN", file: result.file,
      trackedFile: result.trackedFile,
      fingerprint: result.baseline.fingerprint }, null, 2)}\n`); return result;
  }
  if (command === "compare") {
    const result = compare(unwrapReport(readReport(option("--baseline"))),
      unwrapReport(readReport(option("--candidate"))));
    const output = option("--output"); if (output) writeJsonAtomic(path.resolve(output), result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "PASS") process.exitCode = 1; return result;
  }
  if (command === "status") {
    const baseline = unwrapReport(readReport(option("--baseline")));
    const result = status(workspaceRoot, baseline);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "CURRENT") process.exitCode = 2; return result;
  }
  throw new Error(`MINIMAX_CALIBRATION_COMMAND:${command}`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1;
  }
}

module.exports = { OBJECT_KIND, SOURCE_FILES, HARNESS_FILES, loadContract, sourceIdentity,
  harnessIdentity, environmentIdentity, scenarioSetIdentity, profiles,
  preparedScenario, depthFields, benchmark, verify, compare, freeze, status, writeRun,
  unwrapReport, main };
