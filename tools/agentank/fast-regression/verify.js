"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { actionProxy } = require("../simulation/production-diagnostic-bot");
const { FastRegressionStore } = require("./artifact-store");
const { rehydrateV2Memory, rehydrateV2MemoryBatch, replayScriptedWindow } = require("./rehydrate");
const { preloadReplayCorpus, loadCompiledReplayCorpus } = require("./preloaded-corpus");
const { DeterministicGenerator, differentialCase, runMutationCampaign } =
  require("./minimax-oracle");

function runMinimaxOracle(options = {}) {
  const started = process.hrtime.bigint();
  const cases = Math.max(32, Math.floor(Number(options.cases) || 512));
  const generator = new DeterministicGenerator(Number(options.seed) || 0x5eed1234);
  const failures = []; const byDepth = {};
  for (let index = 0; index < cases; index += 1) {
    const depth = 1 + index % 4; const risk = index % 101;
    const spec = generator.tree(depth, 2); const result = differentialCase(spec, risk);
    byDepth[depth] = (byDepth[depth] || 0) + 1;
    const valueMismatch = result.expected.lower !== result.actual.lower ||
      result.expected.upper !== result.actual.upper || result.expected.complete !== result.actual.complete;
    const proofMismatch = Object.values(result.proofs).some(item => item.expected !== item.actual);
    if (valueMismatch || proofMismatch) failures.push({ index, depth, risk, valueMismatch,
      proofMismatch, expected: result.expected, actual: result.actual, proofs: result.proofs });
  }
  const mutation = runMutationCampaign();
  return { status: failures.length === 0 && mutation.scorePer10000 === 10000 ? "PASS" : "FAIL",
    cases, byDepth, differentialFailures: failures.length, failures: failures.slice(0, 32), mutation,
    runtimeMicros: Number((process.hrtime.bigint() - started) / 1000n) };
}

function selectedRootAudit(engine, returned) {
  let selectedIndex = -1; let allowCount = 0;
  for (let index = 0; index < engine.ourCount; index += 1) {
    if (engine.hardStatus[index] === HARD_STATUS.ALLOW) allowCount += 1;
    if (engine.ourActions[index] === returned) selectedIndex = index;
  }
  const selectedHard = selectedIndex < 0 ? null : engine.hardStatus[selectedIndex];
  const observationSafety = engine.observationSafety || {};
  return { returned, selectedIndex, selectedHard, allowCount,
    avoidableHardReject: selectedHard === HARD_STATUS.REJECT_PROVEN && allowCount > 0 ? 1 : 0,
    selectedRiskDominated: selectedIndex >= 0 && selectedIndex < engine.riskController.outcome.count &&
      engine.riskController.outcome.dominated[selectedIndex] ? 1 : 0,
    strictProofOnIncomplete: engine.lastProofStatus === PROOF_STATUS.PROVEN &&
      !engine.adapter.informationComplete ? 1 : 0,
    rootRestoreFailures: engine.depthSearch.rootRestoreFailures +
      engine.informationSearch.rootRestoreFailures + engine.forcedWinSearch.rootRestoreFailures +
      (observationSafety.rootRestoreFailures || 0),
    observationSafety: { status: observationSafety.lastStatus || 0,
      nodes: observationSafety.nodes || 0,
      incomplete: observationSafety.incompleteCount || 0,
      capacityStops: observationSafety.capacityStops || 0,
      budgetStops: observationSafety.budgetStops || 0,
      rootRestoreFailures: observationSafety.rootRestoreFailures || 0 },
    informationComplete: Boolean(engine.adapter.informationComplete),
    proofStatus: engine.lastProofStatus,
    depth: Math.max(engine.depthSearch.completedDepth, engine.informationSearch.completedDepth),
    nodes: engine.depthSearch.nodes + engine.informationSearch.nodes,
    runtimeMode: engine.runtime.runtimeMode,
    action: returned === ACTION.NONE ? "NONE" : Object.entries(ACTION).find(([, value]) =>
      value === returned)?.[0] || `ACTION_${returned}` };
}

async function verifyCapsule(workspaceRoot, capsule, options = {}) {
  const started = process.hrtime.bigint();
  const restored = await rehydrateV2Memory(workspaceRoot, capsule,
    capsule.window.evaluationFrame, { historicalRuntime: options.historicalRuntime !== false,
      v2Options: options.v2Options });
  const actions = []; const me = actionProxy(restored.context.me, actions);
  const returned = restored.engine.decide(me, restored.context.enemy, restored.context.game);
  const audit = selectedRootAudit(restored.engine, returned);
  const windowReplay = options.branchWindow ? await replayScriptedWindow(workspaceRoot,
    capsule, actions[0] || null) : null;
  return { fingerprint: capsule.fingerprint, matchId: capsule.source.matchId,
    evaluationFrame: capsule.window.evaluationFrame, tags: capsule.window.tags,
    restored: { physicalFingerprint: restored.physicalFingerprint,
      memoryFingerprint: restored.memoryFingerprint, observedDecisions: restored.observedDecisions,
      verifiedEvents: restored.verifiedEvents }, emittedCommand: actions[0] || null, audit,
    windowReplay, runtimeMicros: Number((process.hrtime.bigint() - started) / 1000n),
    status: audit.avoidableHardReject === 0 && audit.selectedRiskDominated === 0 &&
      audit.strictProofOnIncomplete === 0 && audit.rootRestoreFailures === 0 &&
      (!windowReplay || windowReplay.exactReproductionFailure === 0) ? "PASS" : "FAIL" };
}

function verifyRestoredTarget(target, restored) {
  const started = process.hrtime.bigint(); const actions = [];
  const me = actionProxy(restored.context.me, actions);
  const returned = restored.engine.decide(me, restored.context.enemy, restored.context.game);
  const audit = selectedRootAudit(restored.engine, returned);
  return { fingerprint: target.fingerprint, matchId: target.matchId,
    evaluationFrame: target.evaluationFrame, tags: target.tags,
    restored: { physicalFingerprint: restored.physicalFingerprint,
      memoryFingerprint: restored.memoryFingerprint, observedDecisions: restored.observedDecisions,
      verifiedEvents: restored.verifiedEvents }, emittedCommand: actions[0] || null, audit,
    windowReplay: null, runtimeMicros: Number((process.hrtime.bigint() - started) / 1000n),
    status: audit.avoidableHardReject === 0 && audit.selectedRiskDominated === 0 &&
      audit.strictProofOnIncomplete === 0 && audit.rootRestoreFailures === 0 ? "PASS" : "FAIL" };
}

async function verifyPreloadedBundle(workspaceRoot, bundle, options = {}) {
  const started = process.hrtime.bigint();
  const batch = await rehydrateV2MemoryBatch(workspaceRoot, bundle,
    { historicalRuntime: options.historicalRuntime !== false, v2Options: options.v2Options });
  const results = bundle.targets.map(target => verifyRestoredTarget(target,
    batch.restored.get(target.fingerprint)));
  return { results, physicalSteps: batch.physicalSteps,
    runtimeMicros: Number((process.hrtime.bigint() - started) / 1000n) };
}

function loadCohort(store, reference = "current") {
  const name = String(reference || "current");
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
  const file = path.join(store.paths.cohorts, name.endsWith(".json") ? name : `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function laneEntries(store, lane, cohortReference = "current") {
  const manifest = loadCohort(store, cohortReference);
  if (!manifest) return [];
  if (lane === "smoke" || lane === "root" || lane === "window") return manifest.lanes.smoke || [];
  if (lane === "minimax-impacted") return manifest.lanes.minimaxImpacted || [];
  if (lane === "terminal-all") return manifest.lanes.terminalAll || [];
  if (lane === "capsule-all") return manifest.lanes.capsuleAll || [];
  return [];
}

async function verifyFastRegression(workspaceRoot, options = {}) {
  const started = process.hrtime.bigint();
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const lane = String(options.lane || "all").toLowerCase();
  const runOracle = lane === "all" || lane === "minimax" || lane === "minimax-oracle";
  const oracle = runOracle ? runMinimaxOracle(options) : null;
  const cohort = loadCohort(store, options.cohort || "current");
  const entries = lane === "all" ? laneEntries(store, "smoke", options.cohort) :
    laneEntries(store, lane, options.cohort);
  let capsuleResults = []; let preload = null; let replayExecution = null;
  const usePreloadedBundles = lane === "capsule-all" && entries.length > 0 &&
    options.preload !== false;
  if (usePreloadedBundles) {
    const compiled = options.compiled !== false && cohort ?
      loadCompiledReplayCorpus(store, cohort) : null;
    const corpus = compiled || preloadReplayCorpus(store, entries,
      { onProgress: options.onPreloadProgress });
    const targetFingerprints = new Set(corpus.bundles.flatMap(bundle =>
      bundle.targets.map(target => target.fingerprint)));
    invariant(targetFingerprints.size === entries.length && entries.every(entry =>
      targetFingerprints.has(entry.fingerprint)), "FAST_REGRESSION_PRELOAD_DENOMINATOR_MISMATCH",
    `${targetFingerprints.size}/${entries.length}`);
    preload = corpus.stats; const byFingerprint = new Map();
    let completed = 0; let physicalSteps = 0; let bundleRuntimeMicros = 0;
    for (const bundle of corpus.bundles) {
      const verified = await verifyPreloadedBundle(workspaceRoot, bundle, options);
      physicalSteps += verified.physicalSteps; bundleRuntimeMicros += verified.runtimeMicros;
      for (const item of verified.results) {
        byFingerprint.set(item.fingerprint, item); completed += 1;
        if (typeof options.onProgress === "function") options.onProgress(completed,
          entries.length, item.fingerprint, item.status);
      }
    }
    capsuleResults = entries.map(entry => byFingerprint.get(entry.fingerprint));
    replayExecution = { mode: "PRELOADED_MATCH_PREFIX_BATCH_V1",
      matchBundles: corpus.bundles.length, physicalSteps, bundleRuntimeMicros };
  } else for (let index = 0; index < entries.length; index += 1) {
    const { capsule } = store.readCapsule(entries[index]);
    capsuleResults.push(await verifyCapsule(workspaceRoot, capsule,
      { ...options, branchWindow: lane === "window" || lane === "all" }));
    if (typeof options.onProgress === "function") options.onProgress(index + 1, entries.length,
      capsule.fingerprint, capsuleResults.at(-1).status);
  }
  const invariantTotals = { avoidableHardRejects: 0, riskDominatedSelections: 0,
    strictProofFalsePositives: 0, rootRestoreFailures: 0, capsuleFailures: 0 };
  const observationSafetyTotals = { executedCapsules: 0, nodes: 0, incomplete: 0,
    capacityStops: 0, budgetStops: 0, rootRestoreFailures: 0, statuses: {} };
  for (const item of capsuleResults) {
    invariantTotals.avoidableHardRejects += item.audit.avoidableHardReject;
    invariantTotals.riskDominatedSelections += item.audit.selectedRiskDominated;
    invariantTotals.strictProofFalsePositives += item.audit.strictProofOnIncomplete;
    invariantTotals.rootRestoreFailures += item.audit.rootRestoreFailures;
    if (item.status !== "PASS") invariantTotals.capsuleFailures += 1;
    const safety = item.audit.observationSafety;
    if (safety.nodes > 0) observationSafetyTotals.executedCapsules += 1;
    observationSafetyTotals.nodes += safety.nodes;
    observationSafetyTotals.incomplete += safety.incomplete;
    observationSafetyTotals.capacityStops += safety.capacityStops;
    observationSafetyTotals.budgetStops += safety.budgetStops;
    observationSafetyTotals.rootRestoreFailures += safety.rootRestoreFailures;
    observationSafetyTotals.statuses[safety.status] =
      (observationSafetyTotals.statuses[safety.status] || 0) + 1;
  }
  const blocked = !runOracle && entries.length === 0;
  const status = blocked ? "BLOCKED" : (!oracle || oracle.status === "PASS") &&
    Object.values(invariantTotals).every(value => value === 0) ? "ACCEPTED" : "REJECTED";
  const report = {
    artifactKind: "FAST_REGRESSION_VERIFICATION_REPORT",
    status,
    lane,
    properties: ["SOURCE_BOUND", "RULE_BOUND", "ACTION_EQUALITY_NOT_REQUIRED",
      "ABSOLUTE_SAFETY_INVARIANTS"],
    cohort: cohort ? { reference: options.cohort || "current",
      fingerprint: cohort.fingerprint, capsuleRoot: cohort.source?.capsuleRoot || null } : null,
    oracle,
    capsuleExecution: { requested: entries.length, completed: capsuleResults.length,
      historicalRuntime: options.historicalRuntime !== false,
      mode: usePreloadedBundles ? "PRELOADED_MATCH_PREFIX_BATCH_V1" : "LEGACY_CAPSULE_V1",
      preload, replayExecution },
    performance: { totalRuntimeMicros: Number((process.hrtime.bigint() - started) / 1000n),
      capsuleRuntimeMicros: capsuleResults.reduce((sum, item) => sum + item.runtimeMicros, 0) },
    invariantTotals, observationSafetyTotals,
    capsuleResults
  };
  return store.writeReport(report, lane.replaceAll("/", "-"));
}

module.exports = { runMinimaxOracle, selectedRootAudit, verifyCapsule, loadCohort, laneEntries,
  verifyRestoredTarget, verifyPreloadedBundle, verifyFastRegression };
