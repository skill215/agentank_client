"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { fingerprintObject, sha256Text } = require("../core/hash");
const { canonicalJson } = require("../core/canonical-json");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { buildImp6Production, productionRootFixture } = require("../build/imp6-builder");
const { CacheBank } = require("../../../engine-v2/src/cache");
const { CACHE_ID, CACHE_FLAG, CACHE_DEPENDENCY, WORK_KIND,
  RUNTIME_MODE } = require("../../../engine-v2/src/abi/cache-runtime-codes");
const fast = require("../../../engine-v2/src/fast");
const search = require("../../../engine-v2/src/search");
const { RuntimeController, RuntimeSearchCoordinator,
  EmergencyReserve } = require("../../../engine-v2/src/runtime");
const { ProductionRootEngine } = require("../../../engine-v2/src/runtime/production-root");

const LAYERS = Object.freeze(["function", "composite", "pipeline", "terminal", "full-game", "platform"]);

function percentile(sorted, numerator, denominator) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * numerator / denominator) - 1));
  return sorted[index];
}
function inspectBytes(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value); if (ArrayBuffer.isView(value)) return value.byteLength;
  let bytes = 0; for (const key of Object.keys(value)) bytes += inspectBytes(value[key], seen); return bytes;
}
function measureLayer(layerId, caseCount, sampleCount, operation) {
  const samples = new Array(sampleCount); const outputs = new Array(sampleCount);
  let operations = 0; let allocations = 0; let highWater = 0; let bytes = 0;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const started = process.hrtime.bigint(); const result = operation(sample);
    samples[sample] = Number((process.hrtime.bigint() - started) / 1000n);
    outputs[sample] = result.semantic; operations += result.operations;
    allocations += result.allocations || 0; highWater = Math.max(highWater, result.highWater || 0);
    bytes = Math.max(bytes, result.bytes || 0);
  }
  samples.sort((left, right) => left - right);
  return { layerId, status: "PASS", reason: null, caseCount, sampleCount,
    metrics: { p50Micros: percentile(samples, 50, 100), p95Micros: percentile(samples, 95, 100),
      p99Micros: percentile(samples, 99, 100), maxMicros: samples[samples.length - 1], operations,
      instrumentedAllocations: allocations, highWater },
    semanticFingerprint: sha256Text(canonicalJson(outputs)), bytes };
}
function boxedMap(width, height) {
  return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "x" : "."));
}
function tank(seat, cell, direction) {
  return { entityId: seat + 1, seat, cell, direction, crashed: false, stars: 0, runtimeMs: 0,
    skillId: seat ? "overload" : "poison", skillReadyFrame: 0, shieldHitsRemaining: 0,
    shieldUntilFrame: null, frozenUntilFrame: null, stunUntilFrame: null,
    overloadUntilFrame: null, cloakUntilFrame: null, poisonAppliedFrame: null,
    poisonUntilFrame: null, boostUntilFrame: null, revealUntilFrame: null,
    pickupLockUntilFrame: null, fireLockUntilFrame: null, bombCooldownReadyFrame: 0 };
}
function compositePhysical() {
  return { platformFrame: 3, recordIndex: 3,
    map: { width: 9, height: 7, terrainColumnMajor: boxedMap(9, 7) },
    tanks: [tank(0, [3, 3], "up"), tank(1, [7, 5], "left")],
    projectiles: [{ entityId: 3, ownerSeat: 1, cell: [3, 5], direction: "up" },
      { entityId: 4, ownerSeat: 1, cell: [4, 5], direction: "up" }],
    bombs: [{ entityId: 5, ownerSeat: 1, cell: [5, 3], placedFrame: 0, explodeFrame: 5 }],
    star: [6, 1], terminalFlags: { timeoutSeat: null, scriptErrorSeat: null } };
}
function matchingPennies() {
  const graph = new search.InformationGraph(); const a = graph.addTerminal(search.VALUE_MAX);
  const b = graph.addTerminal(search.VALUE_MIN); const c = graph.addTerminal(search.VALUE_MIN);
  const d = graph.addTerminal(search.VALUE_MAX);
  return { graph, root: graph.addSimultaneous(2, 2, new Uint16Array([a, b, c, d])) };
}
function safeMath() { return Object.freeze({ abs: Math.abs, floor: Math.floor, max: Math.max,
  min: Math.min, ceil: Math.ceil, round: Math.round, trunc: Math.trunc, sign: Math.sign }); }

async function runImp6Benchmark(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const outputDirectory = path.resolve(options.outputDirectory ||
    contained(root, "artifacts", "benchmarks", "imp6"));
  const built = options.buildResult || await buildImp6Production({ workspaceRoot: root });
  const layers = [];
  const cacheBank = new CacheBank(); const valueCache = cacheBank.get(CACHE_ID.PHYSICAL_VALUE_TT);
  const risk = new search.RiskKernel(); const edgeChild = new Uint16Array([0, 1]);
  const edgeProbability = new Uint16Array([5000, 5000]);
  const childLower = new Int16Array([-5000, 5000]); const childUpper = new Int16Array([-4000, 6000]);
  const matrix = new search.StageMatrix(); matrix.initialize(2, 2); matrix.setCell(0, 0, -1000, -1000);
  matrix.setCell(0, 1, 1000, 1000); matrix.setCell(1, 0, 1000, 1000); matrix.setCell(1, 1, -1000, -1000);
  const functionRuntime = new RuntimeController();
  layers.push(measureLayer("function", 4, 64, sample => {
    const functionCase = sample & 3;
    if (functionCase === 0) { const key = (sample + 1) >>> 0; const signature = (key * 65537) >>> 0;
      const slot = valueCache.write(key, key ^ 0x55aa, signature, signature ^ 0xaa55, 1,
        valueCache.currentGeneration, CACHE_DEPENDENCY.PHYSICAL, key, CACHE_FLAG.COMPLETE,
        2, sample, -sample, key, signature);
      const hit = valueCache.probe(key, key ^ 0x55aa, signature, signature ^ 0xaa55, 1);
      return { semantic: [functionCase, slot >= 0 ? 1 : 0, hit >= 0 ? 1 : 0, valueCache.value0[hit]],
        operations: 2, highWater: valueCache.writeCount, bytes: cacheBank.totalBytes() }; }
    if (functionCase === 1) { const status = risk.backupIndexed(2, 0, edgeChild, edgeProbability,
      childLower, childUpper, sample % 101, sample & 3, search.RISK_DIMENSION.ENEMY_ACTION);
      return { semantic: [functionCase, status, risk.lower, risk.upper], operations: 2,
        highWater: risk.backupCount, bytes: inspectBytes(risk) }; }
    if (functionCase === 2) { const complete = matrix.computePureBounds();
      return { semantic: [functionCase, complete, matrix.pureLower, matrix.pureUpper], operations: 4,
        highWater: 4, bytes: inspectBytes(matrix) }; }
    functionRuntime.beginCallback(0, sample, sample ^ 1, true);
    functionRuntime.charge(WORK_KIND.FAST_TRANSITION, 4); functionRuntime.finishCallback();
    return { semantic: [functionCase, functionRuntime.runtimeMode,
      functionRuntime.accumulatedWorkUnits], operations: 4, highWater: functionRuntime.batchCount,
    bytes: inspectBytes(functionRuntime) };
  }));
  const composite = fast.createFastPhysical(compositePhysical()); const dueBombSpec = compositePhysical();
  dueBombSpec.platformFrame = 5; dueBombSpec.recordIndex = 5; dueBombSpec.projectiles = [];
  dueBombSpec.tanks = [tank(0, [5, 3], "left"), tank(1, [7, 5], "left")];
  dueBombSpec.bombs = [{ entityId: 5, ownerSeat: 1, cell: [5, 3], placedFrame: 0, explodeFrame: 5 }];
  const dueBomb = fast.createFastPhysical(dueBombSpec); const projectileSpec = compositePhysical();
  projectileSpec.projectiles = [{ entityId: 3, ownerSeat: 1, cell: [1, 3], direction: "right" }];
  projectileSpec.bombs = []; projectileSpec.tanks = [tank(0, [4, 3], "up"), tank(1, [7, 5], "left")];
  const projectile = fast.createFastPhysical(projectileSpec); const compositeCases = [composite, dueBomb, projectile];
  const compositeActions = new Uint8Array([fast.ACTION.GO, fast.ACTION.TURN_LEFT,
    fast.ACTION.TURN_RIGHT, fast.ACTION.FIRE, fast.ACTION.THROW_BOMB]);
  layers.push(measureLayer("composite", 3, 33, sample => {
    const compositeCase = sample % compositeCases.length; const bundle = compositeCases[compositeCase];
    const hard = bundle.hard.evaluate(compositeActions[sample % compositeActions.length]);
    return { semantic: [compositeCase, hard, bundle.state.hashLo, bundle.state.hashHi], operations: 1,
      highWater: bundle.state.highWaterDelta + bundle.state.highWaterEvent,
      bytes: inspectBytes(bundle.state) };
  }));
  const productionSource = fs.readFileSync(built.sourceFile, "utf8");
  const productionMinified = fs.readFileSync(built.minifiedFile, "utf8");
  const sandbox = { Math: safeMath() }; const minifiedSandbox = { Math: safeMath() };
  vm.createContext(sandbox); vm.runInContext(productionSource, sandbox, { timeout: 2000 });
  vm.createContext(minifiedSandbox); vm.runInContext(productionMinified, minifiedSandbox, { timeout: 2000 });
  layers.push(measureLayer("pipeline", 3, 12, sample => {
    const pipelineCase = sample % 3;
    if (pipelineCase === 2) { const fixture = productionRootFixture();
      fixture.game.frame = sample; fixture.game.frames = sample;
      const action = sandbox.onIdle(fixture.me, fixture.enemy, fixture.game);
      return { semantic: [pipelineCase, action, ...fixture.calls], operations: 1, highWater: sample,
        bytes: built.manifest.sourceBytes }; }
    const target = pipelineCase ? minifiedSandbox : sandbox;
    const result = Array.from(target.__agentankFixture(sample + 1));
    return { semantic: [pipelineCase, ...result], operations: 1, highWater: result[18],
      bytes: pipelineCase ? built.manifest.minifiedBytes : built.manifest.sourceBytes };
  }));
  const terminalValues = [[[search.VALUE_MAX, search.VALUE_MIN], [search.VALUE_MIN, search.VALUE_MAX]],
    [[search.VALUE_MAX, search.VALUE_MAX], [search.VALUE_MIN, search.VALUE_MAX]], [[0, 0], [0, 0]],
    [[0, search.VALUE_MIN, search.VALUE_MAX], [search.VALUE_MAX, 0, search.VALUE_MIN],
      [search.VALUE_MIN, search.VALUE_MAX, 0]]];
  const terminalCases = terminalValues.map(values => { const graph = new search.InformationGraph();
    const children = []; for (const row of values) for (const value of row) children.push(graph.addTerminal(value));
    const rootNode = graph.addSimultaneous(values.length, values[0].length, children);
    return { root: rootNode, engine: new search.SearchEngine(graph) }; });
  layers.push(measureLayer("terminal", 4, 32, sample => {
    const terminalCase = sample & 3; const selected = terminalCases[terminalCase];
    const status = selected.engine.solveRoot(selected.root,
      { nodeBudget: 192, proofBudget: 128, matrixIterations: 32, matrixBatch: 8 });
    return { semantic: [terminalCase, status, selected.engine.value.lower[selected.root],
      selected.engine.value.upper[selected.root], selected.engine.lastPolicyHandle],
    operations: selected.engine.value.visitedNodes + selected.engine.proof.visitedNodes,
    highWater: Math.max(selected.engine.value.visitedNodes, selected.engine.proof.visitedNodes),
    bytes: inspectBytes(selected.engine) };
  }));
  layers.push(measureLayer("full-game", 3, 9, sample => {
    const engine = new ProductionRootEngine(); const fixture = productionRootFixture();
    let lastAction = 0; for (let frame = 0; frame < 128; frame += 1) {
      fixture.game.frame = frame; fixture.game.frames = frame;
      lastAction = engine.decide(fixture.me, fixture.enemy, fixture.game);
    }
    return { semantic: [sample % 3, lastAction, engine.runtime.runtimeMode,
      engine.runtime.fallbackLatched, engine.runtime.accumulatedWorkUnits,
      engine.coordinator.minimaxInvocationCount, fixture.calls.length],
    operations: engine.runtime.batchCount, allocations: engine.hotAllocationCount +
      engine.adapter.hotAllocationCount + engine.adapter.tracker.hotAllocationCount,
    highWater: engine.runtime.accumulatedWorkUnits, bytes: inspectBytes(engine) };
  }));
  layers.push({ layerId: "platform", status: "BLOCKED",
    reason: "PLATFORM_ENGINE_BYTE_LIMIT_AND_RUNTIME_CALIBRATION_PENDING", caseCount: 0,
    sampleCount: 0, metrics: null, semanticFingerprint: null, bytes: 0 });
  const localPassed = layers.slice(0, 5).every(layer => layer.status === "PASS" &&
    layer.caseCount > 0 && layer.sampleCount > 0 && layer.metrics.operations > 0);
  const report = { schemaVersion: 1, reportId: "imp6-six-layer-benchmark-v1",
    status: localPassed && layers[5].status === "BLOCKED" ? "PASS" : "FAIL",
    platformBlocked: true, layers, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); validateSchemaObject("imp6-benchmark-report", report, root);
  ensureDirectory(outputDirectory); const reportFile = path.join(outputDirectory, "benchmark-report.json");
  writeJsonAtomic(reportFile, report); const immutableReport = path.join(outputDirectory, "history",
    `benchmark-report-${report.fingerprint}.json`); writeJsonImmutable(immutableReport, report);
  return { report, reportFile, immutableReport, buildResult: built };
}

module.exports = { LAYERS, percentile, inspectBytes, measureLayer, runImp6Benchmark };
