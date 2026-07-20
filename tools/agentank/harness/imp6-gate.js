"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory } = require("../core/atomic-file");
const { summarizeTestOutput } = require("./test-runner");
const { writeReport, writeImmutableJsonEvidence, writeImmutableRawEvidence,
  artifactEntry, check } = require("./foundation-gate");
const { buildImp6Production } = require("../build/imp6-builder");
const { runImp6Benchmark } = require("../benchmark/imp6-runner");
const { CacheBank } = require("../../../engine-v2/src/cache");
const { ProductionCacheBank } = require("../../../engine-v2/src/cache/production-cache");
const { CACHE_ID, CACHE_FLAG, CACHE_MISS, CACHE_DEPENDENCY, WORK_KIND,
  RUNTIME_MODE } = require("../../../engine-v2/src/abi/cache-runtime-codes");
const { RUNTIME_CONFIG, SEARCH_BUDGET } = require("../../../engine-v2/src/generated/runtime-config");
const { RuntimeController, EmergencyReserve } = require("../../../engine-v2/src/runtime");
const search = require("../../../engine-v2/src/search");

function finalized(value) { value.fingerprint = fingerprintObject(value); return value; }
function cacheAudit(root, productionSource) {
  const inventory = JSON.parse(fs.readFileSync(contained(root, "docs", "design",
    "dd8-cache-inventory.json"), "utf8")); const bank = new CacheBank({ enabled: new Array(11).fill(1) });
  let semanticMismatchCount = 0; let collisionMissCount = 0; let staleMissCount = 0;
  let exactInvalidationCount = 0; let protectedFailureCount = 0;
  const production = new ProductionCacheBank();
  for (let id = 0; id < CACHE_ID.COUNT; id += 1) { production.setEnabled(id, true);
    const cache = bank.get(id); const stripped = production.get(id);
    const slot = cache.write(id, id + 1, id + 2, id + 3, 1, cache.currentGeneration,
      CACHE_DEPENDENCY.PHYSICAL, id, CACHE_FLAG.COMPLETE, 2, id * 7, 0, 0, 0);
    const strippedSlot = stripped.write(id, id + 1, id + 2, id + 3, 1,
      stripped.currentGeneration, CACHE_DEPENDENCY.PHYSICAL, id, CACHE_FLAG.COMPLETE,
      2, id * 7, 0, 0, 0);
    if (slot === CACHE_MISS || strippedSlot !== slot ||
        cache.probe(id, id + 1, id + 2, id + 3, 1) !== slot ||
        stripped.probe(id, id + 1, id + 2, id + 3, 1) !== slot)
      semanticMismatchCount += 1;
    if (cache.probe(id, id + 1, id + 22, id + 33, 1) === CACHE_MISS &&
        stripped.probe(id, id + 1, id + 22, id + 33, 1) === CACHE_MISS) collisionMissCount += 1;
    if (cache.probe(id, id + 1, id + 2, id + 3, 2) === CACHE_MISS &&
        stripped.probe(id, id + 1, id + 2, id + 3, 2) === CACHE_MISS) staleMissCount += 1;
    const direct = id * 7; cache.setEnabled(false); stripped.setEnabled(false);
    if (cache.probe(id, id + 1, id + 2, id + 3, 1) !== CACHE_MISS ||
        stripped.probe(id, id + 1, id + 2, id + 3, 1) !== CACHE_MISS || direct !== id * 7)
      semanticMismatchCount += 1;
  }
  const exact = new CacheBank({ enabled: new Array(11).fill(1) }).get(CACHE_ID.FEATURE_CACHE);
  const terrain = exact.write(1, 1, 1, 1, 1, exact.currentGeneration, CACHE_DEPENDENCY.TERRAIN,
    10, 0, 1, 0, 0, 0, 0); const entity = exact.write(2, 1, 2, 1, 1, exact.currentGeneration,
    CACHE_DEPENDENCY.ENTITY, 11, 0, 1, 0, 0, 0, 0);
  exactInvalidationCount = exact.invalidateDependencies(CACHE_DEPENDENCY.ENTITY, 11);
  if (!exact.valid[terrain] || exact.valid[entity]) semanticMismatchCount += 1;
  const proof = new (require("../../../engine-v2/src/cache").CanonicalCache)(CACHE_ID.PROOF_CACHE, 2, 2, 1);
  proof.write(0, 1, 2, 3, 1, proof.currentGeneration, CACHE_DEPENDENCY.OBSERVATION, 1,
    CACHE_FLAG.PROTECTED, 5, 0, 0, 0, 0); proof.write(2, 1, 4, 5, 1, proof.currentGeneration,
    CACHE_DEPENDENCY.OBSERVATION, 2, CACHE_FLAG.PINNED, 5, 0, 0, 0, 0);
  if (proof.write(4, 1, 6, 7, 1, proof.currentGeneration, CACHE_DEPENDENCY.OBSERVATION,
    3, 0, 1, 0, 0, 0, 0) === CACHE_MISS) protectedFailureCount = 1;
  const counterPattern = /probeCount|hitCount|writeCount|replacementCount|invalidationCount|collisionCount|staleCount/;
  return finalized({ schemaVersion: 1, status: inventory.canonicalCacheIds.length === 11 &&
    CACHE_ID.COUNT === 11 && semanticMismatchCount === 0 && collisionMissCount === 11 &&
    staleMissCount === 11 && exactInvalidationCount === 1 && protectedFailureCount === 1 &&
    !counterPattern.test(productionSource) ? "PASS" : "FAIL", inventoryId: inventory.inventoryId,
  cacheCount: CACHE_ID.COUNT, cacheBytes: bank.totalBytes(), semanticMismatchCount,
  collisionMissCount, staleMissCount, exactInvalidationCount, protectedFailureCount,
  optionalDefaultOff: 2, productionCounterFindingCount: counterPattern.test(productionSource) ? 1 : 0 });
}
function matchingPennies() { const graph = new search.InformationGraph();
  const a = graph.addTerminal(search.VALUE_MAX); const b = graph.addTerminal(search.VALUE_MIN);
  const c = graph.addTerminal(search.VALUE_MIN); const d = graph.addTerminal(search.VALUE_MAX);
  return { graph, root: graph.addSimultaneous(2, 2, new Uint16Array([a, b, c, d])) }; }
function runtimeAudit() {
  const controller = new RuntimeController(); for (let frame = 0; frame < 3; frame += 1) {
    controller.beginCallback(frame, 1, 2, frame === 0); controller.chargeUnits(50000, WORK_KIND.VALUE_NODE);
    controller.finishCallback(); }
  const fallbackAt = controller.accumulatedWorkUnits; const fallbackLatched = controller.fallbackLatched;
  const fallbackOptions = {}; controller.writeSearchOptions(fallbackOptions);
  const fixture = matchingPennies(); const normal = new search.SearchEngine(fixture.graph);
  normal.solveRoot(fixture.root, { nodeBudget: SEARCH_BUDGET.NODE_BUDGET[RUNTIME_MODE.NORMAL],
    proofBudget: SEARCH_BUDGET.PROOF_BUDGET[RUNTIME_MODE.NORMAL], matrixIterations: 128, matrixBatch: 16 });
  const fallback = new search.SearchEngine(fixture.graph);
  fallback.solveRoot(fixture.root, { nodeBudget: fallbackOptions.nodeBudget,
    proofBudget: fallbackOptions.proofBudget, matrixIterations: fallbackOptions.matrixIterations,
    matrixBatch: fallbackOptions.matrixBatch });
  const strictMismatchCount = normal.strictFingerprintLo === fallback.strictFingerprintLo &&
    normal.strictFingerprintHi === fallback.strictFingerprintHi ? 0 : 1;
  const ambiguousGeneration = controller.matchRuntimeGeneration; controller.beginCallback(0, 1, 2, false);
  controller.finishCallback(); const ambiguousResetCount = controller.matchRuntimeGeneration ===
    ambiguousGeneration && controller.accumulatedWorkUnits === fallbackAt ? 0 : 1;
  const reserve = new EmergencyReserve(); const emergency = new RuntimeController({ emergencyReserve: reserve });
  emergency.beginCallback(0, 3, 4, true); emergency.chargeUnits(59000, WORK_KIND.VALUE_NODE);
  const batchAllowed = emergency.canStartBatch(WORK_KIND.VALUE_NODE, 20); const reserveIndependent =
    reserve.bytes() === 2688 && batchAllowed === 0 && emergency.runtimeMode === RUNTIME_MODE.EMERGENCY;
  return finalized({ schemaVersion: 1, status: fallbackAt === RUNTIME_CONFIG.FALLBACK_ENTER_WORK_UNITS &&
    fallbackLatched === 1 && fallbackOptions.decisionDepth === 3 && fallbackOptions.nodeBudget > 0 &&
    strictMismatchCount === 0 && ambiguousResetCount === 0 && reserveIndependent ? "PASS" : "FAIL",
  fallbackAt, fallbackLatched, fallbackDepth: fallbackOptions.decisionDepth,
  fallbackNodeBudget: fallbackOptions.nodeBudget, fallbackProofBudget: fallbackOptions.proofBudget,
  strictMismatchCount, ambiguousResetCount, reserveBytes: reserve.bytes(), reserveIndependent,
  emergencyMode: emergency.runtimeMode, minimaxEnabled: fallbackOptions.nodeBudget > 0, mctsEnabled: false });
}

async function runImp6Gate(workspaceRoot = defaultWorkspaceRoot(), options = {}) {
  const root = path.resolve(workspaceRoot); const outputDirectory = contained(root, "artifacts", "reports", "imp6");
  ensureDirectory(outputDirectory); const build = await buildImp6Production({ workspaceRoot: root });
  const source = fs.readFileSync(build.sourceFile, "utf8"); const cache = cacheAudit(root, source);
  const runtime = runtimeAudit(); const benchmark = await runImp6Benchmark({ workspaceRoot: root,
    buildResult: build }); const tests = summarizeTestOutput(root, options.testOutputFile,
    options.testExitCode, outputDirectory, { testDirectories: ["imp0", "platform", "imp1", "imp2",
      "imp3", "imp4", "imp5", "imp6"] });
  const buildEvidence = finalized({ schemaVersion: 1, status: build.manifest.status,
    manifest: build.manifest, verification: build.verification });
  const evidenceFiles = [
    ["cache", writeImmutableJsonEvidence(outputDirectory, "cache", cache)],
    ["runtime", writeImmutableJsonEvidence(outputDirectory, "runtime", runtime)],
    ["build", writeImmutableJsonEvidence(outputDirectory, "build", buildEvidence)],
    ["benchmark", writeImmutableJsonEvidence(outputDirectory, "benchmark", benchmark.report)],
    ["tests", writeImmutableJsonEvidence(outputDirectory, "tests", tests.report)],
    ["test-output", writeImmutableRawEvidence(outputDirectory, "test-output", "tap", tests.output)],
    ["production-source", build.immutableSource], ["production-minified", build.immutableMinified],
    ["build-manifest", build.immutableManifest], ["benchmark-report", benchmark.immutableReport]
  ];
  const localGates = build.verification.localGates;
  const checks = [
    check("CACHE_INVENTORY", cache.status, { cacheCount: cache.cacheCount,
      collisionMissCount: cache.collisionMissCount, staleMissCount: cache.staleMissCount }),
    check("CACHE_EXACT_INVALIDATION", cache.status, { exactInvalidationCount: cache.exactInvalidationCount,
      protectedFailureCount: cache.protectedFailureCount }),
    check("RUNTIME_FALLBACK_LATCH", runtime.status, { fallbackAt: runtime.fallbackAt,
      fallbackDepth: runtime.fallbackDepth, reserveBytes: runtime.reserveBytes }),
    check("FALLBACK_MINIMAX_STRICT", runtime.status, { minimaxEnabled: runtime.minimaxEnabled,
      mctsEnabled: runtime.mctsEnabled, strictMismatchCount: runtime.strictMismatchCount }),
    check("DETERMINISTIC_BUILD", build.manifest.status, { sourceHash: build.manifest.sourceHash,
      minifiedHash: build.manifest.minifiedHash, terser: build.manifest.terser }),
    check("PRODUCTION_STRIP", build.manifest.strip.status, { findingCount:
      build.manifest.strip.findingCount, cacheCounterFindingCount: cache.productionCounterFindingCount }),
    check("SOURCE_MINIFIED_DIFFERENTIAL", build.manifest.differential.status,
      { mismatchCount: build.manifest.differential.mismatchCount,
        sandboxStatus: build.manifest.sandbox.status }),
    check("SIX_LAYER_BENCHMARK", benchmark.report.status, { layerCount: benchmark.report.layers.length,
      platformBlocked: benchmark.report.platformBlocked }),
    check("LOCAL_CAPACITY_GATES", Object.values(localGates).every(Boolean) ? "PASS" : "FAIL",
      { sourceByteGate: localGates.sourceBytes, typedArrayBytes: localGates.typedArrayBytes,
        coldInit: localGates.coldInit, callback: localGates.callback, sourceBytes: build.manifest.sourceBytes,
        minifiedBytes: build.manifest.minifiedBytes, cacheBytes: build.manifest.memory.cacheBytes,
        emergencyBytes: build.manifest.memory.emergencyBytes }),
    check("G4_G7_G9_TESTS", tests.report.status, { tests: tests.report.tests,
      pass: tests.report.pass, fail: tests.report.fail }),
    check("PLATFORM_CAPACITY_CALIBRATION", "BLOCKED", { blockers: build.manifest.blockers })
  ];
  const blockers = checks.filter(item => item.status === "FAIL").map(item => item.checkId);
  const gate = { schemaVersion: 1, reportId: "imp6-cache-runtime-build-gate-v1",
    status: blockers.length ? "FAIL" : "PASS", checks,
    artifacts: evidenceFiles.map(([id, file]) => artifactEntry(root, id, file)), blockers,
    releaseBlockers: build.manifest.blockers.slice(), fingerprint: "" };
  gate.fingerprint = fingerprintObject(gate); validateSchemaObject("imp6-gate-report", gate, root);
  writeReport(outputDirectory, "imp6-gate-report.json", gate);
  const gateFile = writeImmutableJsonEvidence(outputDirectory, "imp6-gate", gate);
  return { gate, gateFile, build, benchmark };
}

module.exports = { cacheAudit, runtimeAudit, runImp6Gate };
