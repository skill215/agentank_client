"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { sourceIdentity } = require("../diagnostics/v1-v2-working-arena");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");
const { loadSimulator } = require("../simulation/paired-arena");
const { actionProxy } = require("../simulation/production-diagnostic-bot");
const { ProductionRootEngine } = require("../../../engine-v2/src/runtime/production-root");
const { ACTION, HARD_STATUS, NONE_CELL } = require("../../../engine-v2/src/abi/fast-codes");
const { SAFETY_STATUS } = require("../../../engine-v2/src/search/information-safety-closure");
const { FastRegressionStore } = require("./artifact-store");
const { observationFingerprint } = require("./capsule");
const { decisionMemoryFingerprint } = require("./memory-fingerprint");
const { createSimulator, decisionsForStep, replayScriptedWindow, stepIndex, decisionIndex,
  publicPhysicalFingerprint } = require("./rehydrate");

const ACTION_NAME = Object.freeze(Object.fromEntries(Object.entries(ACTION)
  .map(([name, value]) => [value, name])));
const HARD_NAME = Object.freeze(Object.fromEntries(Object.entries(HARD_STATUS)
  .map(([name, value]) => [value, name])));
const SAFETY_NAME = Object.freeze(Object.fromEntries(Object.entries(SAFETY_STATUS)
  .map(([name, value]) => [value, name])));

function actionCommand(action, argument = NONE_CELL, state = null) {
  if (action === ACTION.NONE) return { supported: true, command: null };
  if (action === ACTION.GO) return { supported: true, command: { type: "go" } };
  if (action === ACTION.TURN_LEFT) return { supported: true,
    command: { type: "turn", side: "left" } };
  if (action === ACTION.TURN_RIGHT) return { supported: true,
    command: { type: "turn", side: "right" } };
  if (action === ACTION.FIRE) return { supported: true, command: { type: "fire" } };
  if (action === ACTION.THROW_BOMB) return { supported: true, command: { type: "throwBomb" } };
  const skillTypes = { [ACTION.CAST_SHIELD]: "shield", [ACTION.CAST_FREEZE]: "freeze",
    [ACTION.CAST_STUN]: "stun", [ACTION.CAST_OVERLOAD]: "overload",
    [ACTION.CAST_CLOAK]: "cloak", [ACTION.CAST_POISON]: "poison",
    [ACTION.CAST_BOOST]: "boost" };
  if (skillTypes[action]) return { supported: true, command: { type: skillTypes[action] } };
  if (action === ACTION.CAST_TELEPORT && state && argument !== NONE_CELL)
    return { supported: true, command: { type: "teleport",
      x: argument % state.width, y: Math.floor(argument / state.width) } };
  return { supported: false, command: null };
}

function sameCommand(left, right) { return JSON.stringify(left || null) === JSON.stringify(right || null); }

function branchCacheKey(capsule, frame, command) {
  return { version: 1, capsuleFingerprint: capsule.fingerprint,
    simulatorCommit: capsule.simulator.commit, simulatorArchiveSha256: capsule.simulator.archiveSha256,
    branchFrame: frame, endFrame: capsule.window.endFrame, command: command || null,
    semantics: "FIXED_HISTORICAL_CONTINUATION_DIAGNOSTIC" };
}

class BranchBatchCache {
  constructor(store, cohortFingerprint) {
    this.store = store; this.cohortFingerprint = cohortFingerprint;
    this.directory = path.join(store.paths.history, "counterfactual-batches", cohortFingerprint);
    this.latestFile = path.join(this.directory, "latest.json"); this.records = new Map();
    this.hits = 0; this.misses = 0; this.legacyImports = 0;
    if (fs.existsSync(this.latestFile)) {
      const artifact = JSON.parse(fs.readFileSync(this.latestFile, "utf8"));
      invariant(artifact.fingerprint === fingerprintObject(artifact) &&
        artifact.cohortFingerprint === cohortFingerprint,
      "FAST_REGRESSION_BRANCH_BATCH_INVALID", cohortFingerprint);
      for (const record of artifact.records) this.records.set(record.keyFingerprint, record);
    }
  }
  async replay(workspaceRoot, capsule, frame, command) {
    const key = branchCacheKey(capsule, frame, command); const keyFingerprint = fingerprintObject(key);
    const cached = this.records.get(keyFingerprint);
    if (cached) { this.hits += 1; return { result: cached.result, cacheHit: true, keyFingerprint }; }
    // Import the interrupted per-branch prototype cache once, then consolidate it into the batch.
    const legacyFile = path.join(this.store.paths.history, "counterfactual-branches",
      keyFingerprint.slice(0, 2), `${keyFingerprint}.json`);
    if (fs.existsSync(legacyFile)) {
      const artifact = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
      invariant(artifact.fingerprint === fingerprintObject(artifact) &&
        artifact.keyFingerprint === keyFingerprint,
      "FAST_REGRESSION_BRANCH_CACHE_INVALID", keyFingerprint);
      const record = { key, keyFingerprint, result: artifact.result };
      this.records.set(keyFingerprint, record); this.hits += 1; this.legacyImports += 1;
      return { result: record.result, cacheHit: true, keyFingerprint };
    }
    const result = await replayScriptedWindow(workspaceRoot, capsule, command,
      { branchFrame: frame, skipOriginalReplay: true });
    this.records.set(keyFingerprint, { key, keyFingerprint, result }); this.misses += 1;
    return { result, cacheHit: false, keyFingerprint };
  }
  finalize() {
    const artifact = { artifactKind: "FAST_REGRESSION_COUNTERFACTUAL_BRANCH_BATCH",
      properties: ["IMMUTABLE", "CONTENT_ADDRESSED", "PHYSICAL_ONLY",
        "SOURCE_CODE_INDEPENDENT", "BATCHED_FOR_WSL_NTFS"],
      cohortFingerprint: this.cohortFingerprint,
      records: [...this.records.values()].sort((left, right) =>
        left.keyFingerprint.localeCompare(right.keyFingerprint)), fingerprint: "" };
    artifact.fingerprint = fingerprintObject(artifact);
    const file = path.join(this.directory, `${artifact.fingerprint}.json`);
    writeJsonImmutable(file, artifact, { mode: 0o644 });
    writeJsonAtomic(this.latestFile, artifact, { mode: 0o644 });
    return { fingerprint: artifact.fingerprint, file, records: artifact.records.length,
      hits: this.hits, misses: this.misses, legacyImports: this.legacyImports };
  }
}

function commandActionName(command) {
  if (!command) return "NONE";
  if (command.type === "turn") return command.side === "left" ? "TURN_LEFT" : "TURN_RIGHT";
  const names = { go: "GO", fire: "FIRE", throwBomb: "THROW_BOMB", shield: "CAST_SHIELD",
    freeze: "CAST_FREEZE", stun: "CAST_STUN", overload: "CAST_OVERLOAD", cloak: "CAST_CLOAK",
    poison: "CAST_POISON", teleport: "CAST_TELEPORT", boost: "CAST_BOOST" };
  return names[command.type] || `COMMAND_${String(command.type).toUpperCase()}`;
}

function candidateSnapshot(engine, index) {
  const risk = engine.riskController.outcome; const safety = engine.safetyClosure.outcome;
  const action = engine.ourActions[index]; const riskDomain = index < risk.count;
  return { index, actionCode: action, action: ACTION_NAME[action] || `ACTION_${action}`,
    argument: engine.ourArguments[index], hardCode: engine.hardStatus[index],
    hard: HARD_NAME[engine.hardStatus[index]] || String(engine.hardStatus[index]),
    safetyCode: safety.status[index], safety: SAFETY_NAME[safety.status[index]] ||
      String(safety.status[index]), score: engine.score[index], riskDomain,
    immediateFatalMass: riskDomain ? risk.immediateFatalMass[index] : null,
    horizonFatalMass: riskDomain ? risk.horizonFatalMass[index] : null,
    unknownMass: riskDomain ? risk.unknownMass[index] : null,
    earliestFatalFrame: riskDomain ? risk.earliestFatalFrame[index] : null,
    escapeSlack: riskDomain ? risk.escapeSlack[index] : null,
    coverage: riskDomain ? risk.coverage[index] : null,
    worstValue: riskDomain ? risk.worstValue[index] : null,
    tacticalValue: riskDomain ? risk.tacticalValue[index] : null,
    acceptable: riskDomain && Boolean(risk.acceptable[index]),
    dominated: riskDomain && Boolean(risk.dominated[index]),
    robustLower: riskDomain ? risk.robustLower[index] : null,
    expectedValue: riskDomain ? risk.expectedValue[index] : null,
    committedFatalMass: riskDomain ? risk.committedFatalMass[index] : null,
    possibleProjectileFatalMass: riskDomain ? risk.possibleProjectileFatalMass[index] : null,
    futureFireFatalMass: riskDomain ? risk.futureFireFatalMass[index] : null,
    combatPurpose: riskDomain ? risk.combatPurpose[index] : null,
    hitDeadline: riskDomain ? risk.hitDeadline[index] : null,
    enemySafeSuccessors: riskDomain ? risk.enemySafeSuccessors[index] : null,
    ownCounterExposure: riskDomain ? risk.ownCounterExposure[index] : null,
    blockadeValue: riskDomain ? risk.blockadeValue[index] : null,
    purposeCompleteness: riskDomain ? risk.purposeCompleteness[index] : null,
    postFireEscape: riskDomain ? risk.postFireEscape[index] : null,
    combatPressure: riskDomain ? risk.combatPressure[index] : null,
    chanceSupportCount: safety.chanceSupportCount[index],
    chanceFatalSupportCount: safety.chanceFatalSupportCount[index],
    futureFireDepth: safety.futureFireDepth[index],
    strategyRiskApplied: Boolean(safety.strategyRiskApplied?.[index]),
    possibleProjectileStrategyApplied:
      Boolean(safety.possibleProjectileStrategyApplied?.[index]),
    futureFireStrategyApplied: Boolean(safety.futureFireStrategyApplied?.[index]),
    strategyRiskStatus: engine.multiFrameRisk?.status ?? 0,
    strategyRiskNodes: engine.multiFrameRisk?.nodes ?? 0,
    strategyEarliestFatalFrame: engine.multiFrameRisk?.earliestFatalFrame?.[index] ?? 255,
    frontierAudited: Boolean(engine.observationSafetyAudited?.[index]),
    frontierStatus: engine.observationSafetyStatusByAction?.[index] ?? 0,
    frontierNodes: engine.observationSafetyNodesByAction?.[index] ?? 0,
    frontierFatalFrame: engine.observationSafetyFatalFrameByAction?.[index] ?? 255,
    policyProbability: engine.policyProbability[index] };
}

function inspectPreparedRoot(capsule, frame, engine, context, physicalFingerprint, memoryFingerprint) {
  const emitted = []; const returned = engine.decide(actionProxy(context.me, emitted),
    context.enemy, context.game);
  const candidates = [];
  for (let index = 0; index < engine.ourCount; index += 1)
    candidates.push(candidateSnapshot(engine, index));
  const historical = stepIndex(capsule).get(frame)?.actions?.[capsule.assignment.v2Seat] || null;
  const command = emitted[0] || null;
  return { frame, returned, selectedAction: ACTION_NAME[returned] || `ACTION_${returned}`,
    command, historicalCommand: historical, actionReproduced: sameCommand(command, historical),
    physicalFingerprint, memoryFingerprint, candidates,
    diagnostics: { rootStatus: engine.lastRootStatus,
      informationComplete: Boolean(engine.adapter.informationComplete),
      enemyVisible: Boolean(engine.adapter.enemyVisible),
      hiddenWorldCount: engine.hiddenWorldCount,
      hiddenSupportComplete: Boolean(engine.hiddenSupportComplete),
      hiddenRiskSupportComplete: Boolean(engine.hiddenRiskSupportComplete),
      safetySupportComplete: Boolean(engine.safetyClosure.supportComplete),
      possibleProjectileCount: engine.possibleProjectiles.count(),
      committedProjectileCount: engine.adapter.state.activeProjectileCount(),
      committedBombCount: engine.adapter.state.activeBombCount(),
      committedHazardHorizonTick: engine.adapter.hazard.horizonTick,
      ownCanAct: Boolean(engine.adapter.ownCanAct),
      enemyCanAct: Boolean(engine.adapter.enemyCanAct),
      enemyCanFire: Boolean(engine.adapter.enemyCanFire),
      enemyCapabilitySupportComplete: Boolean(engine.adapter.enemyCapabilitySupportComplete),
      futureEnemyFireSupport: Boolean(engine.threatCapability?.hasFireSupport),
      futureEnemyFireDepth: engine.threatCapability?.earliestFireDepth ?? 255,
      enemyProjectileReleaseDepth: engine.threatCapability?.projectileReleaseDepth ?? 255,
      observationSafetyStatus: engine.observationSafety?.lastStatus ?? 0,
      observationSafetyNodes: engine.observationSafety?.nodes ?? 0,
      observationSafetyGroups: engine.observationSafety?.observationGroups ?? 0,
      observationSafetyIncomplete: engine.observationSafety?.incompleteCount ?? 0,
      observationSafetyRootRestoreFailures: engine.observationSafety?.rootRestoreFailures ?? 0,
      multiFrameRiskStatus: engine.multiFrameRisk?.status ?? 0,
      multiFrameRiskNodes: engine.multiFrameRisk?.nodes ?? 0,
      multiFrameRiskCompletedActions: engine.multiFrameRisk?.completedActions ?? 0,
      multiFrameRiskAppliedActions: engine.multiFrameRisk?.appliedActions ?? 0,
      strategyId: engine.policy.strategyId,
      baseRisk: engine.policy.baseRisk,
      adjustedRisk: engine.riskController.risk,
      stateRiskClass: engine.riskController.stateRiskClass,
      immediateRiskLimit: engine.riskController.immediateLimit,
      horizonRiskLimit: engine.riskController.horizonLimit,
      unknownRiskLimit: engine.riskController.unknownLimit,
      minimumEscapeSlack: engine.riskController.minimumEscapeSlack,
      safeFloor: engine.riskController.safeFloor,
      acceptableCount: engine.riskController.acceptableCount,
      noAcceptableAction: engine.riskController.noAcceptableAction,
      physicalDepth: engine.depthSearch.completedDepth,
      informationDepth: engine.informationSearch.completedDepth,
      runtimeMode: engine.runtime.runtimeMode,
      ownPosition: context.me?.tank?.position?.slice() || null,
      enemyPosition: context.enemy?.tank?.position?.slice() || null,
      observedOwnBullet: context.me?.bullet ? 1 : 0,
      observedEnemyBullet: context.enemy?.bullet ? 1 : 0,
      observedBombCount: Array.isArray(context.game?.bombs) ? context.game.bombs.length : 0 },
    engine };
}

async function inspectRootsAtFrames(workspaceRoot, capsule, frames, engineOptions) {
  const targets = [...new Set(frames)].sort((left, right) => left - right);
  invariant(targets.length > 0 && targets[0] >= 0,
    "FAST_REGRESSION_ROOT_TARGETS_INVALID", targets.join(","));
  const loaded = await loadSimulator(workspaceRoot); const simulator = createSimulator(loaded.module, capsule);
  const steps = stepIndex(capsule); const decisions = decisionIndex(capsule);
  const slots = targets.map(frame => ({ frame, engine: new ProductionRootEngine(engineOptions),
    observedDecisions: 0 }));
  const results = new Map(); const v2Seat = capsule.assignment.v2Seat; const maximum = targets.at(-1);
  while (!simulator.result && simulator.frame <= maximum) {
    const frame = simulator.frame; const context = simulator.snapshotFor(v2Seat);
    const frameDecision = decisions.get(frame); const own = frameDecision?.seats?.[v2Seat];
    for (const slot of slots) {
      if (frame < slot.frame && own && own.implementation === "v2") {
        slot.engine.observeOnly(context.me, context.enemy, context.game, own.command || own.action,
          { historicalWorkUnits: own.workUnits }); slot.observedDecisions += 1;
      } else if (frame === slot.frame) {
        const expected = capsule.observations.find(item => item.frame === frame);
        if (expected) invariant(observationFingerprint(context) === expected.fingerprint,
          "REPLAY_CAPSULE_OBSERVATION_DIVERGENCE", `${capsule.fingerprint}:${frame}`);
        const memory = decisionMemoryFingerprint(slot.engine, { includeRuntime: true });
        results.set(frame, inspectPreparedRoot(capsule, frame, slot.engine, context,
          publicPhysicalFingerprint(simulator), memory));
      }
    }
    if (frame === maximum) break;
    const step = steps.get(frame);
    invariant(step, "REPLAY_CAPSULE_PREFIX_GAP", `${capsule.fingerprint}:${frame}`);
    const events = simulator.step(step.actions.map(action => action ? { ...action } : null),
      decisionsForStep(step));
    invariant(fingerprintObject({ events: JSON.parse(JSON.stringify(events)) }) === step.eventFingerprint,
      "REPLAY_CAPSULE_EVENT_DIVERGENCE", `${capsule.fingerprint}:${frame}`);
  }
  invariant(results.size === targets.length, "REPLAY_CAPSULE_ROOT_TARGET_INCOMPLETE",
  `${results.size}/${targets.length}`);
  return results;
}

async function inspectRootAtFrame(workspaceRoot, capsule, frame, engineOptions) {
  return (await inspectRootsAtFrames(workspaceRoot, capsule, [frame], engineOptions)).get(frame);
}

function classifyCounterfactualFrame(selectedDies, branches) {
  const replayable = branches.filter(branch => branch.replayable);
  const survivors = replayable.filter(branch => !branch.result.branch.v2Crashed);
  if (replayable.length === 0) return "NO_REPLAYABLE_ACTION";
  if (selectedDies && survivors.length > 0) return "AVOIDABLE_UNDER_FIXED_CONTINUATION";
  if (replayable.every(branch => branch.result.branch.v2Crashed)) return "ALL_REPLAYABLE_ACTIONS_DIE";
  if (!selectedDies) return "SELECTED_SURVIVES_WINDOW";
  return "UNRESOLVED";
}

function classifyCurrentDelta(historicalDies, currentDies, actionChanged) {
  if (currentDies == null) return "CURRENT_ACTION_NOT_REPLAYED";
  if (historicalDies && !currentDies) return "DEATH_AVOIDED_BY_CURRENT_ACTION";
  if (!historicalDies && currentDies) return "SURVIVAL_LOST_BY_CURRENT_ACTION";
  if (!actionChanged) return historicalDies ? "UNCHANGED_ACTION_DIES" : "UNCHANGED_ACTION_SURVIVES";
  return historicalDies ? "CHANGED_ACTION_STILL_DIES" : "CHANGED_ACTION_STILL_SURVIVES";
}

function increment(target, key) { target[key] = (target[key] || 0) + 1; }

async function diagnoseFrame(workspaceRoot, branchCache, capsule, root, allActions) {
  const frame = root.frame;
  const currentSelectedCandidate = root.candidates.find(item => item.actionCode === root.returned) || null;
  const mappedCandidates = root.candidates.map(candidate => ({ candidate,
    mapped: actionCommand(candidate.actionCode, candidate.argument, root.engine.adapter.state) }));
  const historicalCandidatePair = mappedCandidates.find(item => item.mapped.supported &&
    sameCommand(item.mapped.command, root.historicalCommand));
  const selectedCandidate = historicalCandidatePair?.candidate || null;
  const candidates = allActions ? root.candidates.filter(item => item.hardCode === HARD_STATUS.ALLOW) :
    [selectedCandidate, currentSelectedCandidate].filter((candidate, index, values) => candidate &&
      values.findIndex(other => other?.index === candidate.index) === index);
  const branches = [];
  for (const candidate of candidates) {
    const mapped = actionCommand(candidate.actionCode, candidate.argument,
      root.engine.adapter.state);
    if (!mapped.supported) { branches.push({ ...candidate, replayable: false, result: null }); continue; }
    const replay = await branchCache.replay(workspaceRoot, capsule, frame, mapped.command);
    branches.push({ ...candidate, replayable: true, command: mapped.command,
      cacheHit: replay.cacheHit, branchCacheKey: replay.keyFingerprint, result: replay.result });
  }
  let historical = branches.find(branch => branch.replayable &&
    sameCommand(branch.command, root.historicalCommand));
  if (!historical) {
    const replay = await branchCache.replay(workspaceRoot, capsule, frame, root.historicalCommand);
    historical = { ...(selectedCandidate || {}), action: commandActionName(root.historicalCommand),
      replayable: true, command: root.historicalCommand, historicalOnly: true,
      cacheHit: replay.cacheHit, branchCacheKey: replay.keyFingerprint, result: replay.result };
    branches.push(historical);
  }
  historical.historicalSelected = true;
  const selectedDies = historical.result.branch.v2Crashed;
  const current = branches.find(branch => branch.replayable &&
    sameCommand(branch.command, root.command)) || null;
  if (current) current.currentSelected = true;
  const currentDies = current ? Boolean(current.result.branch.v2Crashed) : null;
  const currentActionChanged = !sameCommand(root.command, root.historicalCommand);
  const frameClass = classifyCounterfactualFrame(selectedDies, branches);
  const modelClass = selectedDies && selectedCandidate?.safetyCode === SAFETY_STATUS.PROVEN_SAFE ?
    "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES" : selectedDies && selectedCandidate?.safetyCode ===
      SAFETY_STATUS.POSSIBLE_DEATH ? "MODEL_POSSIBLE_DEATH_FIXED_CONTINUATION_DIES" :
      selectedDies ? "MODEL_UNKNOWN_OR_DEAD_FIXED_CONTINUATION_DIES" : "SELECTED_SURVIVES";
  const oneStepProvenSafeContradiction = selectedDies &&
    selectedCandidate?.safetyCode === SAFETY_STATUS.PROVEN_SAFE &&
    capsule.window.endFrame - frame === 0 ? 1 : 0;
  return { frame, distanceToTerminal: capsule.window.endFrame - frame,
    selectedAction: historical.action, selectedCommand: root.historicalCommand,
    currentSelectedAction: root.selectedAction, currentSelectedCommand: root.command,
    historicalCommand: root.historicalCommand, actionReproduced: root.actionReproduced,
    historicalSelectedDies: Boolean(selectedDies), currentSelectedDies: currentDies,
    currentActionChanged,
    currentDelta: classifyCurrentDelta(Boolean(selectedDies), currentDies, currentActionChanged),
    rootDiagnostics: root.diagnostics, selectedCandidate, currentSelectedCandidate,
    frameClass, modelClass, oneStepProvenSafeContradiction,
    rescuingActions: branches.filter(branch => branch.replayable &&
      !branch.result.branch.v2Crashed).map(branch => branch.action), branches };
}

async function diagnoseEntry(workspaceRoot, store, branchCache, entry, engineOptions, mode) {
  const { capsule } = store.readCapsule(entry.fingerprint);
  const end = capsule.window.evaluationFrame; const start = mode === "PRIMARY" ?
    Math.max(capsule.window.startFrame, end - 3) : end;
  const targetFrames = []; for (let frame = start; frame <= end; frame += 1) targetFrames.push(frame);
  const roots = await inspectRootsAtFrames(workspaceRoot, capsule, targetFrames, engineOptions);
  const frames = [];
  for (const frame of targetFrames) frames.push(await diagnoseFrame(workspaceRoot,
    branchCache, capsule, roots.get(frame), mode === "PRIMARY"));
  const avoidable = frames.filter(frame => frame.frameClass === "AVOIDABLE_UNDER_FIXED_CONTINUATION");
  return { fingerprint: capsule.fingerprint, matchId: capsule.source.matchId,
    historicalMatchUrlId: capsule.source.historicalMatchUrlId, role: entry.role,
    variantId: capsule.assignment.variantId, v2Seat: capsule.assignment.v2Seat,
    original: capsule.original, evaluationFrame: end, inspectedFrames: frames.length,
    classification: avoidable.length ? "FIXED_CONTINUATION_ESCAPE_EXISTS" :
      frames.every(frame => frame.frameClass === "ALL_REPLAYABLE_ACTIONS_DIE") ?
        "NO_ESCAPE_IN_INSPECTED_ACTIONS" : "NO_FIXED_CONTINUATION_ESCAPE_OBSERVED",
    earliestAvoidableFrame: avoidable.length ? avoidable[0].frame : null, frames };
}

function aggregateDiagnostics(results) {
  const output = { entries: results.length, classifications: {}, frameClasses: {}, modelClasses: {},
    selectedActions: {}, rescuingActions: {}, earliestRescueDistance: {}, actionReproductionFailures: 0,
    currentActionChanges: 0, currentDelta: {},
    exactReplayFailures: 0, controlSurvivalRegressions: 0,
    branchCacheHits: 0, branchCacheMisses: 0,
    modelProvenSafeFixedContinuationFatalFrames: 0, oneStepProvenSafeContradictions: 0,
    causalAvoidableFrames: 0, reproducedCausalAvoidableFrames: 0,
    causalWithAcceptableRescue: 0, causalWithNonDominatedRescue: 0,
    causalWithHigherRobustRescue: 0, causalWithNoneRescue: 0 };
  for (const result of results) {
    increment(output.classifications, result.classification);
    if (result.earliestAvoidableFrame != null) increment(output.earliestRescueDistance,
      result.evaluationFrame - result.earliestAvoidableFrame);
    for (const frame of result.frames) {
      increment(output.frameClasses, frame.frameClass); increment(output.modelClasses, frame.modelClass);
      increment(output.currentDelta, frame.currentDelta || "CURRENT_DELTA_MISSING");
      if (frame.currentActionChanged) output.currentActionChanges += 1;
      increment(output.selectedActions, frame.selectedAction);
      for (const action of frame.rescuingActions) increment(output.rescuingActions, action);
      if (!frame.actionReproduced) output.actionReproductionFailures += 1;
      if (frame.modelClass === "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES")
        output.modelProvenSafeFixedContinuationFatalFrames += 1;
      output.oneStepProvenSafeContradictions += frame.oneStepProvenSafeContradiction;
      if (frame.frameClass === "AVOIDABLE_UNDER_FIXED_CONTINUATION") {
        output.causalAvoidableFrames = (output.causalAvoidableFrames || 0) + 1;
        if (frame.actionReproduced) output.reproducedCausalAvoidableFrames =
          (output.reproducedCausalAvoidableFrames || 0) + 1;
        const survivors = frame.branches.filter(branch => branch.replayable &&
          !branch.result.branch.v2Crashed);
        if (survivors.some(branch => branch.acceptable)) output.causalWithAcceptableRescue =
          (output.causalWithAcceptableRescue || 0) + 1;
        if (survivors.some(branch => !branch.dominated)) output.causalWithNonDominatedRescue =
          (output.causalWithNonDominatedRescue || 0) + 1;
        if (frame.selectedCandidate && survivors.some(branch =>
          branch.robustLower > frame.selectedCandidate.robustLower))
          output.causalWithHigherRobustRescue = (output.causalWithHigherRobustRescue || 0) + 1;
        if (frame.rescuingActions.includes("NONE")) output.causalWithNoneRescue =
          (output.causalWithNoneRescue || 0) + 1;
      }
      for (const branch of frame.branches) if (branch.replayable) {
        if (branch.cacheHit) output.branchCacheHits += 1;
        else output.branchCacheMisses += 1;
        output.exactReplayFailures += branch.result.exactReproductionFailure;
        if (result.role !== "PRIMARY_LOSS")
          output.controlSurvivalRegressions += branch.result.potentialSurvivalRegression;
      }
    }
  }
  return output;
}

function focusedDiagnosticJobs(cohort, options = {}) {
  const primaryEntries = cohort.lanes.nativeSingleCrashLoss || [];
  const requestedLimit = options.primaryLimit == null ? primaryEntries.length :
    Number(options.primaryLimit);
  invariant(Number.isSafeInteger(requestedLimit) && requestedLimit > 0,
    "FAST_REGRESSION_PRIMARY_LIMIT_INVALID", String(options.primaryLimit));
  const selectedPrimary = primaryEntries.slice(0, requestedLimit);
  const jobs = [{ lane: "nativeSingleCrashLoss", mode: "PRIMARY", entries: selectedPrimary }];
  if (!options.skipControls) jobs.push(
    { lane: "nativeSwappedCounterpart", mode: "CONTROL",
      entries: cohort.lanes.nativeSwappedCounterpart || [] },
    { lane: "nativeSingleCrashWinControl", mode: "CONTROL",
      entries: cohort.lanes.nativeSingleCrashWinControl || [] },
    { lane: "nativeStarWinControl", mode: "CONTROL",
      entries: cohort.lanes.nativeStarWinControl || [] }
  );
  return { jobs, selection: { primaryAvailable: primaryEntries.length,
    primarySelected: selectedPrimary.length, controlsIncluded: !options.skipControls,
    executionLane: options.skipControls || selectedPrimary.length < primaryEntries.length ?
      "SMOKE" : "FULL_FOCUSED" } };
}

async function diagnoseFocusedCohort(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const cohortName = String(options.cohort || "native-poison-death");
  const cohortFile = path.join(store.paths.cohorts, `${cohortName}.json`);
  invariant(fs.existsSync(cohortFile), "FAST_REGRESSION_FOCUSED_COHORT_NOT_FOUND", cohortName);
  const cohort = JSON.parse(fs.readFileSync(cohortFile, "utf8"));
  const runManifest = JSON.parse(fs.readFileSync(path.join(store.paths.runs,
    cohort.source.runId, "manifest.json"), "utf8"));
  const frozen = loadFrozenCandidate(workspaceRoot, options.manifestPath);
  const parameterFingerprint = fingerprintObject(frozen.manifest.parameters);
  const settings = v2Options(frozen.manifest.parameters).engine;
  const source = sourceIdentity(workspaceRoot); const results = []; const failures = [];
  const branchCache = new BranchBatchCache(store, cohort.fingerprint);
  const selected = focusedDiagnosticJobs(cohort, { primaryLimit: options.primaryLimit,
    skipControls: options.skipControls });
  const total = selected.jobs.reduce((sum, job) => sum + job.entries.length, 0);
  let done = 0;
  for (const job of selected.jobs) for (const entry of job.entries) {
    try { results.push(await diagnoseEntry(workspaceRoot, store, branchCache,
      entry, settings, job.mode)); }
    catch (error) { failures.push({ fingerprint: entry.fingerprint, matchId: entry.matchId,
      code: error.code || "FOCUSED_DIAGNOSTIC_ERROR", message: error.message }); }
    done += 1;
    if (typeof options.onProgress === "function") options.onProgress(done, total, entry.matchId,
      failures.at(-1)?.matchId === entry.matchId ? "ERROR" : "OK");
  }
  const primary = results.filter(item => item.role === "PRIMARY_LOSS");
  const controls = results.filter(item => item.role !== "PRIMARY_LOSS");
  const branchCacheArtifact = branchCache.finalize();
  const primaryAggregate = aggregateDiagnostics(primary);
  const controlAggregate = aggregateDiagnostics(controls);
  const report = { artifactKind: "FAST_REGRESSION_FOCUSED_COUNTERFACTUAL_DIAGNOSTIC",
    status: failures.length ? "PARTIAL" : "COMPLETED",
    properties: ["SOURCE_BOUND", "RULE_BOUND", "FIXED_HISTORICAL_CONTINUATION",
      "COUNTERFACTUAL_DIAGNOSTIC_NOT_PROOF", "NO_STRATEGY_MUTATION"],
    semantics: { branch: "REPLACE_ONE_V2_ACTION_THEN_REPLAY_RECORDED_ACTIONS",
      inspectedPrimaryFrames: "TERMINAL_MINUS_3_THROUGH_TERMINAL",
      controlFrames: "TERMINAL_ONLY",
      inferenceLimit: "SURVIVAL_CHANGE_IS_CAUSAL_FOR_THIS_FIXED_CONTINUATION_ONLY" },
    cohort: { reference: cohortName, fingerprint: cohort.fingerprint,
      runId: cohort.source.runId, capsuleRoot: cohort.source.capsuleRoot },
    execution: { ...selected.selection, requested: total, completed: results.length,
      failures: failures.length,
      workingSourceSha256: source.sha256,
      capturedSourceSha256: runManifest.descriptor.v2.sourceSha256,
      workingSourceMatchesCapture: source.sha256 === runManifest.descriptor.v2.sourceSha256,
      branchCache: { ...branchCacheArtifact,
        file: path.relative(store.paths.root, branchCacheArtifact.file).replaceAll("\\", "/") },
      parameterFingerprint,
      parameterMatchesCapture: results.length === 0 ? null :
        parameterFingerprint === store.readCapsule(results[0].fingerprint).capsule.source.parameterFingerprint },
    primary: primaryAggregate, controls: controlAggregate, failures, results };
  return store.writeReport(report, options.reportName || "native-poison-death");
}

module.exports = { ACTION_NAME, HARD_NAME, SAFETY_NAME, actionCommand, sameCommand,
  branchCacheKey, BranchBatchCache, commandActionName, candidateSnapshot, inspectRootAtFrame,
  inspectRootsAtFrames, classifyCounterfactualFrame, classifyCurrentDelta, diagnoseFrame,
  diagnoseEntry, aggregateDiagnostics, focusedDiagnosticJobs, diagnoseFocusedCohort };
