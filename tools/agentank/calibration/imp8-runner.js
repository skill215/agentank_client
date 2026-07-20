"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { buildImp6Production } = require("../build/imp6-builder");
const { runImp6Benchmark, percentile } = require("../benchmark/imp6-runner");
const { CACHE_ID } = require("../../../engine-v2/src/abi/cache-runtime-codes");
const { ProductionRootEngine } = require("../../../engine-v2/src/runtime/production-root");

const INPUT_FILES = Object.freeze([
  "config/engine-v2/imp8-calibration-plan.json",
  "config/engine-v2/imp8-calibration-suite.json",
  "config/engine-v2/imp3-capacity-manifest.json",
  "config/engine-v2/imp4-search-manifest.json",
  "config/engine-v2/imp5-policy-manifest.json",
  "config/engine-v2/imp6-runtime-build-profile.json"
]);

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function boxedMap(width, height) {
  return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "x" : "."));
}
function side(id, position, direction, skillType, calls) {
  return { tank: { id, position, direction, crashed: false }, stars: 0, bullet: null,
    skill: { type: skillType, remainingCooldownFrames: 1 }, effects: { self: null, debuff: null },
    status: { shielded: false, frozen: false, stunned: false, overloaded: false,
      cloaked: false, poisoned: false, boosted: false, fireLocked: false,
      bombActive: false, bombCooldownFrames: 1, canActThisFrame: true, actionSpeed: 1 },
    go() { calls.push("GO"); }, turn(value) { calls.push(`TURN:${value}`); },
    fire() { calls.push("FIRE"); }, throwBomb() { calls.push("BOMB"); },
    poison() { calls.push("POISON"); } };
}
function fixture(scenarioId) {
  const calls = []; let width = 5; let height = 5; let frame = 1;
  let ownPosition = [1, 1]; let ownDirection = "right"; let enemyPosition = [3, 1];
  let enemyDirection = "left"; let star = [2, 2]; let bombs = [];
  if (scenarioId === "projectile-escape-7x5") {
    width = 7; height = 5; frame = 4; ownPosition = [3, 2]; ownDirection = "up";
    enemyPosition = [5, 3]; enemyDirection = "left"; star = null;
  } else if (scenarioId === "bomb-escape-9x7") {
    width = 9; height = 7; frame = 4; ownPosition = [4, 3]; ownDirection = "down";
    enemyPosition = [7, 5]; enemyDirection = "left"; star = null;
    bombs = [{ position: [4, 1], remainingFrames: 0, owner: "enemy" }];
  } else if (scenarioId === "terminal-wide-20x20") {
    width = 20; height = 20; frame = 127; ownPosition = [2, 2]; ownDirection = "right";
    enemyPosition = [17, 17]; enemyDirection = "left"; star = [10, 10];
  } else invariant(scenarioId === "open-fire-5x5", "IMP8_CALIBRATION_SCENARIO_UNKNOWN", scenarioId);
  const me = side("own", ownPosition, ownDirection, "poison", calls);
  const enemy = side("enemy", enemyPosition, enemyDirection, "stun", calls);
  if (scenarioId === "open-fire-5x5") { me.skill.remainingCooldownFrames = 0;
    me.status.bombCooldownFrames = 0; enemy.skill.remainingCooldownFrames = 0;
    enemy.status.bombCooldownFrames = 0; }
  if (scenarioId === "projectile-escape-7x5")
    enemy.bullet = { position: [1, 2], direction: "right" };
  return { calls, me, enemy, game: { frame, frames: frame,
    map: boxedMap(width, height), star, bombs } };
}
function inputFingerprints(root) {
  const output = {}; for (const relative of INPUT_FILES)
    output[relative] = sha256Bytes(fs.readFileSync(contained(root, relative)));
  return output;
}
function sameObject(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function strictSnapshot(engine, bundle) {
  engine.generateActions(); const hard = new Array(engine.ourCount);
  for (let row = 0; row < engine.ourCount; row += 1)
    hard[row] = bundle.hard.evaluate(engine.ourActions[row], engine.ourArguments[row]);
  const root = engine.rootAdapter.build(bundle, engine.ourActions, engine.ourArguments,
    engine.ourCount, engine.enemyActions, engine.enemyArguments, engine.enemyCount);
  engine.search.solveRoot(root, { nodeBudget: 512, proofBudget: 512,
    matrixIterations: 128, matrixBatch: 16, decisionDepth: 1, baseRisk: 0 });
  return { hard, proof: engine.search.lastProofStatus,
    fingerprintLo: engine.search.strictFingerprintLo >>> 0,
    fingerprintHi: engine.search.strictFingerprintHi >>> 0 };
}
function runCandidate(suite, scenarioId, depth, nodeBudget, cacheMode) {
  const selected = fixture(scenarioId); const engine = new ProductionRootEngine();
  engine.cacheBank.setEnabled(CACHE_ID.PHYSICAL_VALUE_TT, cacheMode === "ON");
  const adapted = engine.adapter.adapt(selected.me, selected.enemy, selected.game);
  invariant(adapted.bundle && adapted.informationComplete, "IMP8_CALIBRATION_ROOT_INCOMPLETE", scenarioId);
  engine.cacheBank.beginMatch(); const strict = strictSnapshot(engine, adapted.bundle);
  const signature = engine.adapter.state.rootSignature(); const samples = [];
  let probes = 0; let hits = 0; let writes = 0; let restoreFailures = 0;
  for (let sample = 0; sample < suite.samplesPerScenario; sample += 1) {
    const beforeProbe = engine.depthSearch.cacheProbes; const beforeHit = engine.depthSearch.cacheHits;
    const beforeWrite = engine.depthSearch.cacheWrites; const beforeRestore = engine.depthSearch.rootRestoreFailures;
    const started = process.hrtime.bigint(); engine.depthSearch.search(adapted.bundle,
      engine.ourActions, engine.ourArguments, engine.ourCount, engine.enemyActions,
      engine.enemyArguments, engine.enemyCount, depth, nodeBudget);
    const micros = Number((process.hrtime.bigint() - started) / 1000n);
    invariant(engine.adapter.state.rootSignature() === signature,
      "IMP8_CALIBRATION_ROOT_RESTORE_FAILED", `${scenarioId}:${depth}:${nodeBudget}:${cacheMode}`);
    probes += engine.depthSearch.cacheProbes - beforeProbe;
    hits += engine.depthSearch.cacheHits - beforeHit; writes += engine.depthSearch.cacheWrites - beforeWrite;
    restoreFailures += engine.depthSearch.rootRestoreFailures - beforeRestore;
    samples.push({ micros, completedDepth: engine.depthSearch.completedDepth,
      attemptedDepth: engine.depthSearch.attemptedDepth, nodes: engine.depthSearch.nodes,
      bestRow: engine.depthSearch.bestRow, bestValue: engine.depthSearch.bestValue,
      rootScores: Array.from(engine.depthSearch.rootScore.slice(0, engine.ourCount)) });
  }
  return { scenarioId, strict, probes, hits, writes, restoreFailures,
    hotAllocations: engine.hotAllocationCount + engine.adapter.hotAllocationCount +
      engine.adapter.tracker.hotAllocationCount + engine.depthSearch.hotAllocationCount, samples };
}
function summarizeCandidate(suite, depth, nodeBudget, cacheMode, scenarioResults) {
  const timings = []; const semantics = []; let nodes = 0; let probes = 0; let hits = 0;
  let writes = 0; let restores = 0; let allocations = 0; let minDepth = 0xff; let maxDepth = 0;
  const strictValues = [];
  for (const result of scenarioResults) {
    strictValues.push([result.scenarioId, result.strict.fingerprintLo,
      result.strict.fingerprintHi, result.strict.proof, result.strict.hard]);
    probes += result.probes; hits += result.hits; writes += result.writes;
    restores += result.restoreFailures; allocations += result.hotAllocations;
    for (const sample of result.samples) { timings.push(sample.micros); nodes += sample.nodes;
      minDepth = Math.min(minDepth, sample.completedDepth); maxDepth = Math.max(maxDepth, sample.completedDepth);
      semantics.push([result.scenarioId, sample.completedDepth, sample.attemptedDepth,
        sample.bestRow, sample.bestValue, sample.rootScores]); }
  }
  timings.sort((left, right) => left - right);
  return { candidateId: `d${depth}-n${nodeBudget}-cache-${cacheMode.toLowerCase()}`,
    depth, nodeBudget, cacheMode, scenarioCount: scenarioResults.length,
    sampleCount: timings.length, p50Micros: percentile(timings, 50, 100),
    p95Micros: percentile(timings, 95, 100), maxMicros: timings[timings.length - 1],
    totalNodes: nodes, completedDepthMin: minDepth === 0xff ? 0 : minDepth,
    completedDepthMax: maxDepth, cacheProbes: probes, cacheHits: hits, cacheWrites: writes,
    rootRestoreFailures: restores, hotAllocations: allocations,
    strictFingerprint: fingerprintObject({ values: strictValues }),
    semanticFingerprint: fingerprintObject({ values: semantics }) };
}
function productionRun(scenarioId, cacheEnabled) {
  const selected = fixture(scenarioId); const engine = new ProductionRootEngine();
  engine.cacheBank.setEnabled(CACHE_ID.PHYSICAL_VALUE_TT, cacheEnabled);
  const first = engine.decide(selected.me, selected.enemy, selected.game); selected.calls.length = 0;
  const second = engine.decide(selected.me, selected.enemy, selected.game);
  return { first, second, hard: Array.from(engine.hardStatus.slice(0, engine.ourCount)),
    proof: engine.lastProofStatus, strictLo: engine.search.strictFingerprintLo >>> 0,
    strictHi: engine.search.strictFingerprintHi >>> 0, hits: engine.depthSearch.cacheHits,
    rootRestoreFailures: engine.depthSearch.rootRestoreFailures };
}
function productionCacheAudit(suite) {
  return suite.scenarioIds.map(scenarioId => { const off = productionRun(scenarioId, false);
    const on = productionRun(scenarioId, true); return { scenarioId, offAction: off.second,
      onAction: on.second, offCacheHits: off.hits, onCacheHits: on.hits,
      actionMismatch: off.first === on.first && off.second === on.second ? 0 : 1,
      hardMismatch: sameObject(off.hard, on.hard) ? 0 : 1,
      proofMismatch: off.proof === on.proof && off.strictLo === on.strictLo &&
        off.strictHi === on.strictHi ? 0 : 1,
      rootRestoreFailures: off.rootRestoreFailures + on.rootRestoreFailures }; });
}
function assertCalibrationOutput(root, plan, outputDirectory) {
  const calibrationRoot = path.resolve(contained(root, plan.lanes.calibration));
  const frozenRoot = path.resolve(contained(root, plan.lanes.frozen));
  const output = path.resolve(outputDirectory);
  invariant(output !== frozenRoot && !output.startsWith(`${frozenRoot}${path.sep}`),
    "IMP8_CALIBRATION_FROZEN_WRITE_FORBIDDEN", output);
  invariant(output === calibrationRoot || output.startsWith(`${calibrationRoot}${path.sep}`),
    "IMP8_CALIBRATION_OUTPUT_OUTSIDE_LANE", output);
  return output;
}

async function runImp8Calibration(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const plan = readJson(contained(root, "config", "engine-v2", "imp8-calibration-plan.json"));
  const suite = readJson(contained(root, "config", "engine-v2", "imp8-calibration-suite.json"));
  validateSchemaObject("imp8-calibration-suite", suite, root);
  invariant(suite.allowConfigMutation === false && suite.allowFrozenInputs === false,
    "IMP8_CALIBRATION_LANE_POLICY_INVALID", suite.suiteId);
  const output = assertCalibrationOutput(root, plan, options.outputDirectory ||
    contained(root, plan.lanes.calibration, "local-suite-v1")); ensureDirectory(output);
  const before = inputFingerprints(root);
  const built = await buildImp6Production({ workspaceRoot: root,
    outputDirectory: path.join(output, "build") });
  const baselineRun = await runImp6Benchmark({ workspaceRoot: root, buildResult: built,
    outputDirectory: path.join(output, "six-layer") });
  const matrix = [];
  for (const depth of suite.depthCandidates) for (const nodeBudget of suite.nodeBudgetCandidates)
    for (const cacheMode of suite.cacheModes) { const results = suite.scenarioIds.map(scenarioId =>
      runCandidate(suite, scenarioId, depth, nodeBudget, cacheMode));
      matrix.push(summarizeCandidate(suite, depth, nodeBudget, cacheMode, results)); }
  const cacheAudit = productionCacheAudit(suite); const after = inputFingerprints(root);
  const baseline = { status: baselineRun.report.status,
    reportFingerprint: baselineRun.report.fingerprint,
    localLayerStatuses: baselineRun.report.layers.slice(0, 5).map(layer => layer.status),
    platformStatus: baselineRun.report.layers[5].status,
    sourceSha256: built.manifest.sourceHash, minifiedSha256: built.manifest.minifiedHash,
    sourceMinifiedMismatches: built.manifest.differential.mismatchCount,
    productionRootBytes: built.manifest.memory.productionRootBytes };
  const invariants = { rootRestoreFailures: matrix.reduce((sum, item) =>
    sum + item.rootRestoreFailures, 0) + cacheAudit.reduce((sum, item) =>
    sum + item.rootRestoreFailures, 0), hotAllocations: matrix.reduce((sum, item) =>
    sum + item.hotAllocations, 0), cacheActionMismatches: cacheAudit.reduce((sum, item) =>
    sum + item.actionMismatch, 0), cacheHardMismatches: cacheAudit.reduce((sum, item) =>
    sum + item.hardMismatch, 0), cacheProofMismatches: cacheAudit.reduce((sum, item) =>
    sum + item.proofMismatch, 0), sourceMinifiedMismatches: baseline.sourceMinifiedMismatches,
    frozenInputCount: 0, configMutationCount: sameObject(before, after) ? 0 : 1,
    allZeroTolerancePass: false };
  invariants.allZeroTolerancePass = suite.zeroToleranceMetrics.every(metric => invariants[metric] === 0) &&
    invariants.configMutationCount === 0;
  const localLayersPass = baseline.localLayerStatuses.every(status => status === "PASS");
  const report = { schemaVersion: 1, reportKind: "IMP8_LOCAL_CALIBRATION_EVIDENCE",
    suiteId: suite.suiteId, status: invariants.allZeroTolerancePass && localLayersPass ? "PASS" : "FAIL",
    calibrationStatus: "MEASURED_NOT_SELECTED", lane: suite.lane,
    targetTankProfileId: suite.targetTankProfileId, branch: suite.branch,
    inputFingerprints: before, baseline, candidateMatrix: matrix, productionCacheAudit: cacheAudit,
    invariants, selection: { status: "PENDING_QUALITY_ORACLE", recommendedCandidateId: null,
      applied: false, measuredDimensions: suite.dimensionsMeasured.slice(),
      deferredDimensions: suite.dimensionsDeferred.slice(), reason:
      "Timing and depth evidence cannot select gameplay parameters without replay or arena outcome quality." },
    fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  validateSchemaObject("imp8-calibration-report", report, root);
  const reportFile = path.join(output, "calibration-report.json"); writeJsonAtomic(reportFile, report);
  const immutableReport = path.join(output, "history", `calibration-report-${report.fingerprint}.json`);
  writeJsonImmutable(immutableReport, report); return { report, reportFile, immutableReport,
    baselineReportFile: baselineRun.reportFile, buildManifestFile: built.manifestFile };
}

module.exports = { INPUT_FILES, fixture, inputFingerprints, runCandidate, summarizeCandidate,
  productionCacheAudit, assertCalibrationOutput, runImp8Calibration };
