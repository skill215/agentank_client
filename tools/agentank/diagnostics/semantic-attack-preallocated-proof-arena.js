#!/usr/bin/env node
"use strict";

// BP149 compares fixed-memory, single-goal proof arenas on BP147's 100
// scheduled real roots.  Every mode reuses one search object; compact modes
// also reuse one Kernel/Hazard/Hard world while changing only the explicit
// movement-rule variant between fully restored searches.

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
const { OneDeviationAttackEventProof } = require(
  "./semantic-attack-one-deviation-event-proof");
const { EVENT_GOAL } = require("./semantic-attack-event-horizon-shadow");
const { MOVE_VARIANTS, MOVE_VARIANT_NAME, VARIANT_COUNT } = require(
  "./semantic-attack-depth3-move-variant-shadow");
const { MoveContestVariantKernel } = require("./move-contest-variant-kernel");
const { HazardKernel } = require("../../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../../engine-v2/src/fast/hard-gate");
const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");

const MODE = Object.freeze([
  Object.freeze({ name: "SEPARATE_TT2048", sharedWorld: false, ttCapacity: 2048 }),
  Object.freeze({ name: "SHARED_TT2048", sharedWorld: true, ttCapacity: 2048 }),
  Object.freeze({ name: "SHARED_TT128", sharedWorld: true, ttCapacity: 128 }),
  Object.freeze({ name: "SHARED_TT64", sharedWorld: true, ttCapacity: 64 })
]);

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function resizeProofTransposition(search, capacity) {
  if (!Number.isSafeInteger(capacity) || capacity < 64 ||
      (capacity & (capacity - 1)) !== 0)
    throw new Error("BP149_TT_CAPACITY_POWER_OF_TWO_REQUIRED");
  if (search.ttDepth.length === capacity) return search;
  search.ttLo = new Uint32Array(capacity);
  search.ttHi = new Uint32Array(capacity);
  search.ttSemanticLo = new Uint32Array(capacity);
  search.ttSemanticHi = new Uint32Array(capacity);
  search.ttDepth = new Uint8Array(capacity);
  search.ttStatus = new Uint8Array(capacity);
  search.ttPolicyAction = new Uint8Array(capacity);
  search.ttPolicyArgument = new Uint16Array(capacity);
  search.ttConsumesDeviation = new Uint8Array(capacity);
  return search;
}

function classifyVariants(status, support) {
  for (let variant = 0; variant < VARIANT_COUNT; variant += 1)
    if (!support[variant]) return "INCOMPLETE";
  for (let variant = 0; variant < VARIANT_COUNT; variant += 1)
    if (status[variant] !== PROOF_STATUS.PROVEN) return "NOT_PROVEN";
  return "PROVEN_ALL_WORLDS";
}

function ownedTypedArrayBytes(root, excluded = null) {
  const objects = new Set(); const buffers = new Set();
  function visit(value) {
    if (!value || typeof value !== "object" || value === excluded ||
        objects.has(value)) return;
    objects.add(value);
    if (ArrayBuffer.isView(value)) {
      if (!buffers.has(value.buffer)) buffers.add(value.buffer);
      return;
    }
    if (value instanceof ArrayBuffer) { buffers.add(value); return; }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const key of Object.keys(value)) visit(value[key]);
  }
  visit(root); let bytes = 0;
  for (const buffer of buffers) bytes += buffer.byteLength;
  return bytes;
}

class PreallocatedSafeThreatProofArena {
  constructor(state, options = {}) {
    this.state = state; this.sharedWorld = options.sharedWorld ? 1 : 0;
    this.maximumDepth = options.maximumDepth || 6;
    this.nodeBudget = options.nodeBudget || 64;
    this.ttCapacity = options.ttCapacity || 2048;
    this.search = resizeProofTransposition(new OneDeviationAttackEventProof(
      EVENT_GOAL.SAFE_THREAT_FIRE, this.nodeBudget, 2048), this.ttCapacity);
    const count = this.sharedWorld ? 1 : VARIANT_COUNT;
    this.worlds = new Array(count);
    for (let index = 0; index < count; index += 1) {
      const kernel = new MoveContestVariantKernel(state,
        MOVE_VARIANTS[this.sharedWorld ? 0 : index]);
      const hazard = new HazardKernel(state);
      this.worlds[index] = { kernel, hazard,
        hard: new HardGate(kernel, hazard, 0) };
    }
    this.status = new Uint8Array(VARIANT_COUNT);
    this.support = new Uint8Array(VARIANT_COUNT);
    this.nodes = new Uint16Array(VARIANT_COUNT);
    this.lastClassification = "INCOMPLETE";
    this.lastTotalNodes = 0; this.lastBudgetStops = 0;
    this.lastTtStops = 0; this.lastRestoreFailures = 0;
    this.lastSupportLoss = 0; this.evaluationCount = 0;
    this.totalNodes = 0; this.totalNanoseconds = 0;
    this.maximumNodes = 0; this.hotAllocationCount = 0;
    this.ownedTypedArrayBytes = ownedTypedArrayBytes(this, state);
  }

  evaluate(engine) {
    const bundle = engine.adapter.bundle; const state = bundle.state;
    const originalKernel = bundle.kernel; const originalHazard = bundle.hazard;
    const originalHard = bundle.hard; const beforeLo = state.hashLo;
    const beforeHi = state.hashHi; const beforeDelta = state.deltaUsed;
    const beforeEvent = state.eventUsed; const started = process.hrtime.bigint();
    this.lastTotalNodes = 0; this.lastBudgetStops = 0; this.lastTtStops = 0;
    this.lastRestoreFailures = 0; this.lastSupportLoss = 0;
    try {
      for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
        const world = this.worlds[this.sharedWorld ? 0 : variant];
        if (this.sharedWorld) world.kernel.variant = MOVE_VARIANTS[variant];
        bundle.kernel = world.kernel; bundle.hazard = world.hazard;
        bundle.hard = world.hard;
        const restoreBefore = this.search.rootRestoreFailures;
        const status = this.search.evaluateCandidate(bundle, ACTION.FIRE, 0xffff,
          engine.enemyActions, engine.enemyArguments, engine.enemyCount,
          this.maximumDepth, this.nodeBudget);
        this.status[variant] = status;
        this.support[variant] = this.search.lastSupportComplete ? 1 : 0;
        this.nodes[variant] = Math.min(65535, this.search.nodes);
        this.lastTotalNodes += this.search.nodes;
        this.lastBudgetStops += this.search.budgetStopCount;
        this.lastTtStops += this.search.ttCapacityStops;
        this.lastRestoreFailures += this.search.rootRestoreFailures - restoreBefore;
        this.lastSupportLoss += this.search.supportLossCount;
        if (state.hashLo !== beforeLo || state.hashHi !== beforeHi ||
            state.deltaUsed !== beforeDelta || state.eventUsed !== beforeEvent)
          this.lastRestoreFailures += 1;
      }
    } finally {
      bundle.kernel = originalKernel; bundle.hazard = originalHazard;
      bundle.hard = originalHard;
    }
    this.totalNanoseconds += Number(process.hrtime.bigint() - started);
    this.lastClassification = classifyVariants(this.status, this.support);
    this.evaluationCount += 1; this.totalNodes += this.lastTotalNodes;
    if (this.lastTotalNodes > this.maximumNodes)
      this.maximumNodes = this.lastTotalNodes;
    return this.lastClassification;
  }

  totalHotAllocationCount() {
    return this.hotAllocationCount + (this.search.hotAllocationCount || 0) +
      (this.search.settlement?.hotAllocationCount || 0) +
      this.worlds.reduce((sum, world) => sum +
        (world.kernel.hotAllocationCount || 0) +
        (world.hazard.hotAllocationCount || 0) +
        (world.hard.hotAllocationCount || 0), 0);
  }
}

function expectedClassification(proof) {
  const goal = proof.goals.find(item => item.name === "SAFE_THREAT_FIRE");
  if (!goal) throw new Error("BP149_SAFE_GOAL_MISSING:" + proof.key);
  return goal.classification;
}

function percentile(values, percent) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1,
    Math.floor((sorted.length - 1) * percent / 100))];
}

function summarize(records, mode) {
  const samples = []; const memory = [];
  const output = { name: mode.name, sharedWorld: mode.sharedWorld,
    ttCapacity: mode.ttCapacity, rootCount: records.length, exactCount: 0,
    classificationMismatchCount: 0, crossModeMismatchCount: 0,
    budgetStopCount: 0, ttCapacityStopCount: 0, restoreFailureCount: 0,
    supportLossCount: 0, totalNodes: 0, maximumNodes: 0,
    totalNanoseconds: 0, hotAllocationCount: 0 };
  for (const record of records) {
    const result = record.modes[mode.name];
    output.exactCount += record.exact ? 1 : 0;
    output.classificationMismatchCount += result.classification ===
      record.expectedClassification ? 0 : 1;
    output.crossModeMismatchCount += result.classification ===
      record.modes.SEPARATE_TT2048.classification ? 0 : 1;
    output.budgetStopCount += result.budgetStops;
    output.ttCapacityStopCount += result.ttStops;
    output.restoreFailureCount += result.restoreFailures;
    output.supportLossCount += result.supportLoss;
    output.totalNodes += result.totalNodes;
    output.maximumNodes = Math.max(output.maximumNodes, result.totalNodes);
    output.totalNanoseconds += result.nanoseconds;
    samples.push(result.nanoseconds);
    memory.push(result.ownedTypedArrayBytes);
    output.hotAllocationCount = Math.max(output.hotAllocationCount,
      result.hotAllocationCount);
  }
  output.meanNodes = Math.floor(output.totalNodes / Math.max(1, records.length));
  output.p95Nodes = percentile(records.map(record =>
    record.modes[mode.name].totalNodes), 95);
  output.meanNanoseconds = Math.floor(output.totalNanoseconds /
    Math.max(1, records.length));
  output.p95Nanoseconds = percentile(samples, 95);
  output.minimumOwnedTypedArrayBytes = Math.min(...memory);
  output.maximumOwnedTypedArrayBytes = Math.max(...memory);
  output.p95OwnedTypedArrayBytes = percentile(memory, 95);
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--root-source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp144-semantic-attack-real-opportunity-corpus-v4")));
  const proofDirectory = path.resolve(option("--proof-source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp145-semantic-attack-real-event-proof-v2")));
  const censusDirectory = path.resolve(option("--census", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp147-semantic-attack-certificate-feature-census")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp149-semantic-attack-preallocated-proof-arena")));
  const cohortFile = path.resolve(option("--cohort", path.join(root,
    "config", "engine-v2", "strategic-attack-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const expectedRoots = Number(option("--expected-roots", 100));
  const sources = readRoots(sourceDirectory); const proofs = readRoots(proofDirectory);
  const census = readRoots(censusDirectory);
  const sourceByKey = new Map(sources.roots.map(item => [item.key, item]));
  const proofByKey = new Map(proofs.roots.map(item => [item.key, item]));
  const selectedCensus = census.roots.filter(schedulerMatches);
  const selectedSources = selectedCensus.map(item => sourceByKey.get(item.key));
  if (selectedSources.some(item => !item)) throw new Error("BP149_SOURCE_MISSING");
  if (selectedSources.length !== expectedRoots)
    throw new Error("BP149_ROOT_DENOMINATOR:" + selectedSources.length + "/" +
      expectedRoots);
  const censusByKey = new Map(selectedCensus.map(item => [item.key, item]));
  const groups = groupRoots(selectedSources);
  const loaded = loadCohort(root, cohortFile, role);
  const scenarios = scenarioIndex(loaded.scenarios);
  const simulator = await loadSimulator(root); const records = [];
  let replayMismatchCount = 0; let schedulerMismatchCount = 0; let groupIndex = 0;
  for (const roots of groups.values()) {
    const exemplar = roots[0]; const prefix = exemplar.replayPrefix;
    const scenario = scenarios.get(exemplar.scenarioFingerprint) ||
      scenarios.get(exemplar.matchUrlId);
    if (!scenario) throw new Error("BP149_SCENARIO_MISSING:" + exemplar.key);
    const actions = Buffer.from(prefix.candidateActionStream, "base64");
    const byIndex = new Map();
    for (const sourceRoot of roots) {
      const bucket = byIndex.get(sourceRoot.decisionIndex) || [];
      bucket.push(sourceRoot); byIndex.set(sourceRoot.decisionIndex, bucket);
    }
    let decisionIndex = 0; let arenas = null;
    const shadow = new ProductionDiagnosticBot({ captureExceptionalFrames: false,
      diagnosticFinalActionOverride(engine, selectedAction, selectedArgument) {
        const index = decisionIndex++; const code = actions[index] ?? ACTION.NONE;
        const targets = byIndex.get(index) || [];
        if (targets.length && !arenas) arenas = MODE.map(mode => ({ mode,
          arena: new PreallocatedSafeThreatProofArena(engine.adapter.state,
            { ...mode, maximumDepth: 6, nodeBudget: 64 }) }));
        for (const sourceRoot of targets) {
          const proof = proofByKey.get(sourceRoot.key);
          const censusRoot = censusByKey.get(sourceRoot.key);
          const liveSchedule = Boolean(engine.controlMode.context.clearLine &&
            selectedAction !== ACTION.FIRE);
          if (!liveSchedule || !schedulerMatches(censusRoot))
            schedulerMismatchCount += 1;
          const modeResults = {}; const rotation = records.length % MODE.length;
          for (let offset = 0; offset < arenas.length; offset += 1) {
            const item = arenas[(rotation + offset) % arenas.length];
            const started = item.arena.totalNanoseconds;
            const classification = item.arena.evaluate(engine);
            modeResults[item.mode.name] = { classification,
              status: Array.from(item.arena.status),
              support: Array.from(item.arena.support),
              nodes: Array.from(item.arena.nodes),
              totalNodes: item.arena.lastTotalNodes,
              budgetStops: item.arena.lastBudgetStops,
              ttStops: item.arena.lastTtStops,
              restoreFailures: item.arena.lastRestoreFailures,
              supportLoss: item.arena.lastSupportLoss,
              nanoseconds: item.arena.totalNanoseconds - started,
              ownedTypedArrayBytes: item.arena.ownedTypedArrayBytes,
              hotAllocationCount: item.arena.totalHotAllocationCount() };
          }
          records.push({ schemaVersion: 1,
            objectKind: "SEMANTIC_ATTACK_PREALLOCATED_PROOF_ROOT_V1",
            key: sourceRoot.key, sourceClass: proof.sourceClass,
            scenarioFingerprint: sourceRoot.scenarioFingerprint,
            matchUrlId: sourceRoot.matchUrlId, attackSeat: sourceRoot.attackSeat,
            frame: sourceRoot.frame, decisionIndex: sourceRoot.decisionIndex,
            exact: exactPhysicalRoot(engine, sourceRoot),
            expectedClassification: expectedClassification(proof),
            actionableCertificate: Boolean(censusRoot.label.safeThreat &&
              !censusRoot.features.selectedIsFire), modes: modeResults });
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
      process.stderr.write("[bp149-preallocated-proof] " + groupIndex + "/" +
        groups.size + " roots=" + records.length + "\n");
  }
  records.sort((left, right) => left.key.localeCompare(right.key));
  const modes = MODE.map(mode => summarize(records, mode));
  const selected = modes.find(mode => mode.name === "SHARED_TT64");
  const accepted = records.length === expectedRoots && replayMismatchCount === 0 &&
    schedulerMismatchCount === 0 && modes.every(mode =>
      mode.exactCount === records.length &&
      mode.classificationMismatchCount === 0 &&
      mode.crossModeMismatchCount === 0 && mode.budgetStopCount === 0 &&
      mode.ttCapacityStopCount === 0 && mode.restoreFailureCount === 0 &&
      mode.hotAllocationCount === 0) && selected &&
    selected.maximumOwnedTypedArrayBytes < modes[0].maximumOwnedTypedArrayBytes;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_PREALLOCATED_PROOF_ARENA_OVERVIEW_V1",
    status: accepted ? "ACCEPT_PREALLOCATED_PROOF_ARENA" : "REJECTED", role,
    cohortFingerprint: loaded.manifest.fingerprint,
    rootCount: records.length, replayGroupCount: groups.size,
    replayMismatchCount, schedulerMismatchCount,
    maximumDepth: 6, nodeBudget: 64, goal: "SAFE_THREAT_FIRE", modes,
    selectedMode: selected?.name || null,
    decisionBoundary: "Performance/equivalence evidence only. The selected arena is not wired into ProductionRoot. Local nanoseconds are relative diagnostics; node, support, restore, allocation and memory identities are the acceptance owners." };
  const lines = records.map(record => JSON.stringify(record)).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_PREALLOCATED_PROOF_ARENA_MANIFEST_V1",
    status: overview.status, sourceDirectory, proofDirectory, censusDirectory,
    sourceRootsSha256: sha256Bytes(sources.bytes),
    proofRootsSha256: sha256Bytes(proofs.bytes),
    censusRootsSha256: sha256Bytes(census.bytes), cohortFile,
    cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    productionRootSha256: sha256Bytes(fs.readFileSync(productionFile)),
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
  if (!accepted) throw new Error("BP149_PREALLOCATED_PROOF_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(error => {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { MODE, resizeProofTransposition, classifyVariants,
  ownedTypedArrayBytes, PreallocatedSafeThreatProofArena,
  expectedClassification, summarize, build };
