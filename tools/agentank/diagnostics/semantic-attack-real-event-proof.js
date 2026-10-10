#!/usr/bin/env node
"use strict";

// BP145 runs the strict BP143 attack-event proof on roots that actually come
// from FIRE/kill evidence or same-root V1 FIRE disagreements.  Simulator
// physics remains owned by the immutable recorded command streams; the V2
// engine is a shadow state/proof host only.

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
const { mergePolicies } = require(
  "./semantic-attack-one-deviation-event-corpus");
const { OneDeviationAttackEventProof } = require(
  "./semantic-attack-one-deviation-event-proof");
const { EVENT_GOAL, EVENT_GOAL_NAME } = require(
  "./semantic-attack-event-horizon-shadow");
const { MOVE_VARIANTS, MOVE_VARIANT_NAME, VARIANT_COUNT } = require(
  "./semantic-attack-depth3-move-variant-shadow");
const { MoveContestVariantKernel } = require("./move-contest-variant-kernel");
const { HazardKernel } = require("../../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../../engine-v2/src/fast/hard-gate");
const { ACTION, HARD_STATUS, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { RecordedActionBot, RecordedProductionShadowBot,
  installRecordedSkillEmitter, actionArgument } = require(
  "./semantic-attack-real-opportunity-corpus");

const STATUS_NAME = Object.freeze(["UNKNOWN", "PROVEN", "DISPROVEN"]);

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function selectedProofRoots(roots) {
  return roots.filter(root => root.exact && (
    root.sourceFamily === "V2_MISSED_V1_FIRE" ||
    root.sourceFamily === "V1_HISTORICAL_FIRE" &&
      (root.proofSelectionRole === "POSITIVE_KILL" ||
       root.proofSelectionRole === "MATCHED_NO_KILL")));
}

function replayGroupKey(root) {
  return fingerprintObject({ scenarioFingerprint: root.scenarioFingerprint,
    attackSeat: root.attackSeat, seatSkills: root.seatSkills,
    replayPrefix: root.replayPrefix });
}

function groupRoots(roots) {
  const groups = new Map();
  for (const root of roots) {
    const key = replayGroupKey(root); const bucket = groups.get(key) || [];
    bucket.push(root); groups.set(key, bucket);
  }
  return groups;
}

function exactPhysicalRoot(engine, source) {
  const state = engine.adapter.state; const a = state?.arrays;
  if (!state || !source?.root) return false;
  const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
  return a[ARRAY.SCALAR][SCALAR.FRAME] === source.root.frame &&
    state.hashLo === source.root.hashLo && state.hashHi === source.root.hashHi &&
    state.x(own) === source.root.ownPose[0] &&
    state.y(own) === source.root.ownPose[1] &&
    a[ARRAY.TANK_DIR][0] === source.root.ownPose[2] &&
    state.x(enemy) === source.root.enemyPose[0] &&
    state.y(enemy) === source.root.enemyPose[1] &&
    a[ARRAY.TANK_DIR][1] === source.root.enemyPose[2] &&
    a[ARRAY.TANK_STARS][0] === source.root.ownStars &&
    a[ARRAY.TANK_STARS][1] === source.root.enemyStars;
}

function proofMetrics(search) {
  return { fireEvents: search.fireEventCount,
    threatFireEvents: search.threatFireCount,
    doomedFireEvents: search.doomedFireCount,
    counterUnsafeEvents: search.counterUnsafeCount,
    horizonStops: search.horizonStopCount,
    deviationStates: search.deviationStateCount,
    deviationRows: search.deviationRowCount,
    deviationsSelected: search.deviationSelectedCount,
    ttHits: search.ttHits, incomplete: search.incompleteCount,
    fastIncomplete: search.fastIncompleteCount,
    hardIncomplete: search.hardIncompleteCount,
    baselineMissing: search.baselineMissingCount,
    unsupportedGenerationStops: search.unsupportedGenerationStops,
    supportLoss: search.supportLossCount };
}

function classifyGoal(variants) {
  if (variants.length !== VARIANT_COUNT ||
      variants.some(item => !item.supportComplete)) return "INCOMPLETE";
  return variants.every(item => item.status === PROOF_STATUS.PROVEN) ?
    "PROVEN_ALL_WORLDS" : "NOT_PROVEN";
}

function evaluateFireRoot(engine, maximumDepth = 6, nodeBudget = 32768,
    ttCapacity = 8192) {
  const bundle = engine.adapter.bundle; const state = bundle?.state;
  if (!state) throw new Error("BP145_FAST_STATE_MISSING");
  let fireRow = -1;
  for (let row = 0; row < engine.ourCount; row += 1)
    if (engine.ourActions[row] === ACTION.FIRE) { fireRow = row; break; }
  const originalKernel = bundle.kernel; const originalHazard = bundle.hazard;
  const originalHard = bundle.hard; const beforeLo = state.hashLo;
  const beforeHi = state.hashHi; const beforeDelta = state.deltaUsed;
  const beforeEvent = state.eventUsed; const goals = [];
  let totalNodes = 0; let maximumNodes = 0; let budgetStopCount = 0;
  let ttCapacityStopCount = 0; let supportLossCount = 0;
  let rootRestoreFailureCount = 0; let hotAllocationCount = 0;
  try {
    for (let goal = 0; goal < EVENT_GOAL.COUNT; goal += 1) {
      const variants = [];
      for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
        const kernel = new MoveContestVariantKernel(state,
          MOVE_VARIANTS[variant]);
        const hazard = new HazardKernel(state);
        const hard = new HardGate(kernel, hazard, 0);
        const search = new OneDeviationAttackEventProof(goal, nodeBudget,
          ttCapacity);
        bundle.kernel = kernel; bundle.hazard = hazard; bundle.hard = hard;
        const status = search.evaluateCandidate(bundle, ACTION.FIRE, NONE_CELL,
          engine.enemyActions, engine.enemyArguments, engine.enemyCount,
          maximumDepth, nodeBudget);
        const supportComplete = Boolean(search.lastSupportComplete);
        const policy = status === PROOF_STATUS.PROVEN ?
          search.exportPolicyEntries() : [];
        variants.push({ name: MOVE_VARIANT_NAME[variant], status,
          statusName: STATUS_NAME[status], supportComplete,
          nodes: search.nodes, metrics: proofMetrics(search), policy });
        totalNodes += search.nodes; maximumNodes = Math.max(maximumNodes,
          search.nodes); budgetStopCount += search.budgetStopCount;
        ttCapacityStopCount += search.ttCapacityStops;
        supportLossCount += search.supportLossCount;
        rootRestoreFailureCount += search.rootRestoreFailures;
        hotAllocationCount += search.hotAllocationCount +
          (search.settlement?.hotAllocationCount || 0);
        if (state.hashLo !== beforeLo || state.hashHi !== beforeHi ||
            state.deltaUsed !== beforeDelta || state.eventUsed !== beforeEvent)
          rootRestoreFailureCount += 1;
      }
      const classification = classifyGoal(variants);
      const mergedPolicy = classification === "PROVEN_ALL_WORLDS" ?
        mergePolicies(variants.map(item => item.policy)) : null;
      goals.push({ name: EVENT_GOAL_NAME[goal], classification,
        executable: Boolean(mergedPolicy?.compatible), mergedPolicy, variants });
    }
  } finally {
    bundle.kernel = originalKernel; bundle.hazard = originalHazard;
    bundle.hard = originalHard;
  }
  return { fireGenerated: fireRow >= 0,
    fireHardStatus: fireRow >= 0 ? engine.hardStatus[fireRow] : null,
    fireHardAllowed: fireRow >= 0 && engine.hardStatus[fireRow] ===
      HARD_STATUS.ALLOW, goals, totalNodes, maximumNodes, budgetStopCount,
    ttCapacityStopCount, supportLossCount, rootRestoreFailureCount,
    hotAllocationCount };
}

function sourceClass(root) {
  if (root.sourceFamily === "V2_MISSED_V1_FIRE") return "MISSED_FIRE";
  return root.proofSelectionRole === "POSITIVE_KILL" ?
    "HISTORICAL_KILL" : "MATCHED_NO_KILL";
}

function summarize(records) {
  const output = { rootCount: records.length, exactRootCount: 0,
    sourceClasses: {}, fireGeneratedCount: 0, fireHardAllowedCount: 0,
    goalClassifications: {}, executableByGoal: {},
    executableBySourceClass: {}, executableRootCount: 0,
    incompleteGoalCount: 0, incompleteRootCount: 0,
    unsafeExecutableCount: 0, totalNodes: 0, maximumNodes: 0,
    budgetStopCount: 0, ttCapacityStopCount: 0, supportLossCount: 0,
    rootRestoreFailureCount: 0, hotAllocationCount: 0 };
  const executableRoots = new Set(); const incompleteRoots = new Set();
  for (const record of records) {
    output.exactRootCount += record.exact ? 1 : 0;
    output.fireGeneratedCount += record.fireGenerated ? 1 : 0;
    output.fireHardAllowedCount += record.fireHardAllowed ? 1 : 0;
    const source = record.sourceClass;
    output.sourceClasses[source] = (output.sourceClasses[source] || 0) + 1;
    for (const goal of record.goals) {
      const key = goal.name + "/" + goal.classification;
      output.goalClassifications[key] =
        (output.goalClassifications[key] || 0) + 1;
      if (goal.classification === "INCOMPLETE") {
        output.incompleteGoalCount += 1; incompleteRoots.add(record.key);
      }
      if (goal.executable) {
        executableRoots.add(record.key);
        output.executableByGoal[goal.name] =
          (output.executableByGoal[goal.name] || 0) + 1;
        const cross = source + "/" + goal.name;
        output.executableBySourceClass[cross] =
          (output.executableBySourceClass[cross] || 0) + 1;
        if (!record.fireHardAllowed ||
            goal.classification !== "PROVEN_ALL_WORLDS" ||
            goal.variants.some(item => !item.supportComplete))
          output.unsafeExecutableCount += 1;
      }
    }
    for (const field of ["totalNodes", "budgetStopCount",
      "ttCapacityStopCount", "supportLossCount", "rootRestoreFailureCount",
      "hotAllocationCount"]) output[field] += record[field];
    output.maximumNodes = Math.max(output.maximumNodes, record.maximumNodes);
  }
  output.executableRootCount = executableRoots.size;
  output.incompleteRootCount = incompleteRoots.size;
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp144-semantic-attack-real-opportunity-corpus-v4")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp145-semantic-attack-real-event-proof-v2")));
  const cohortFile = path.resolve(option("--cohort", path.join(root,
    "config", "engine-v2", "strategic-attack-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const expectedRoots = Number(option("--expected-roots", 476));
  const maximumDepth = Number(option("--depth", 6));
  const nodeBudget = Number(option("--node-budget", 32768));
  const ttCapacity = Number(option("--tt-capacity", 8192));
  const source = readRoots(sourceDirectory);
  const selected = selectedProofRoots(source.roots);
  if (selected.length !== expectedRoots)
    throw new Error("BP145_ROOT_DENOMINATOR:" + selected.length + "/" +
      expectedRoots);
  const groups = groupRoots(selected);
  const loaded = loadCohort(root, cohortFile, role);
  const scenarios = scenarioIndex(loaded.scenarios);
  const simulator = await loadSimulator(root);
  const records = []; let replayMismatchCount = 0; let groupIndex = 0;
  for (const roots of groups.values()) {
    const exemplar = roots[0];
    const scenario = scenarios.get(exemplar.scenarioFingerprint) ||
      scenarios.get(exemplar.matchUrlId);
    if (!scenario) throw new Error("BP145_SCENARIO_MISSING:" +
      exemplar.matchUrlId);
    const prefix = exemplar.replayPrefix;
    const actions = Buffer.from(prefix.candidateActionStream, "base64");
    const byIndex = new Map();
    for (const sourceRoot of roots) {
      const bucket = byIndex.get(sourceRoot.decisionIndex) || [];
      bucket.push(sourceRoot); byIndex.set(sourceRoot.decisionIndex, bucket);
    }
    let decisionIndex = 0;
    const shadow = new ProductionDiagnosticBot({ captureExceptionalFrames: false,
      diagnosticFinalActionOverride(engine) {
        const index = decisionIndex++;
        const code = actions[index] ?? ACTION.NONE;
        const targets = byIndex.get(index) || [];
        for (const sourceRoot of targets) {
          const exact = exactPhysicalRoot(engine, sourceRoot);
          const evaluation = evaluateFireRoot(engine, maximumDepth,
            nodeBudget, ttCapacity);
          records.push({ schemaVersion: 1,
            objectKind: "SEMANTIC_ATTACK_REAL_EVENT_PROOF_ROOT_V1",
            key: sourceRoot.key, sourceFamily: sourceRoot.sourceFamily,
            sourceClass: sourceClass(sourceRoot),
            matchUrlId: sourceRoot.matchUrlId,
            scenarioFingerprint: sourceRoot.scenarioFingerprint,
            attackSeat: sourceRoot.attackSeat,
            seatSkills: sourceRoot.seatSkills, frame: sourceRoot.frame,
            decisionIndex: sourceRoot.decisionIndex,
            historicalLabel: sourceRoot.historicalLabel || null,
            historicalV2Action: sourceRoot.v2Action ?? null,
            oracleAction: sourceRoot.oracleAction ?? null,
            exact, quantifiers: {
              rootAction: "FIRE",
              ownPolicy: "DIRECT_WITH_AT_MOST_ONE_OBSERVED_STATE_DEVIATION",
              enemyContinuation: "ALL_GENERATED_ACTIONS",
              chanceContinuation: "ALL_GENERATED_OUTCOMES",
              movementWorlds: MOVE_VARIANT_NAME.slice(),
              nonEventAtHorizon: "UNKNOWN", maximumDepth, nodeBudget,
              ttCapacity }, ...evaluation });
        }
        return { action: code,
          argument: actionArgument(engine, code,
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
        opponent.index !== opponent.actions.length)
      replayMismatchCount += 1;
    groupIndex += 1;
    if (groupIndex % 16 === 0 || groupIndex === groups.size)
      process.stderr.write("[bp145-real-event-proof] " + groupIndex + "/" +
        groups.size + " roots=" + records.length + "\n");
  }
  const summary = summarize(records);
  const accepted = records.length === selected.length &&
    summary.exactRootCount === records.length && replayMismatchCount === 0 &&
    summary.budgetStopCount === 0 && summary.ttCapacityStopCount === 0 &&
    summary.unsafeExecutableCount === 0 &&
    summary.rootRestoreFailureCount === 0 && summary.hotAllocationCount === 0;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_REAL_EVENT_PROOF_OVERVIEW_V1",
    status: accepted ? summary.incompleteRootCount ?
      "ACCEPT_REAL_EVENT_PROOF_CLASSIFIED_WITH_INCOMPLETE" :
      "ACCEPT_REAL_EVENT_PROOF_CLASSIFIED" : "REJECTED",
    role, cohortFingerprint: loaded.manifest.fingerprint,
    sourceRootCount: source.roots.length, selectedRootCount: selected.length,
    replayGroupCount: groups.size, replayMismatchCount,
    maximumDepth, nodeBudget, ttCapacity, ...summary,
    decisionBoundary: "Only executable all-enemy/all-chance/all-movement-world FIRE proofs may become action-owner candidates. Incomplete roots remain explicit UNKNOWN and can never own an action. Historical kill labels are validation strata, not proof inputs." };
  const lines = records.map(record => JSON.stringify(record)).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_REAL_EVENT_PROOF_MANIFEST_V1",
    status: overview.status, sourceDirectory,
    sourceRootsSha256: sha256Bytes(source.bytes), cohortFile,
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
  if (!accepted) throw new Error("BP145_REAL_EVENT_PROOF_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(error => {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { selectedProofRoots, replayGroupKey, groupRoots,
  exactPhysicalRoot, proofMetrics, classifyGoal, evaluateFireRoot,
  sourceClass, summarize, build };
