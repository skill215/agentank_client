"use strict";

const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { createHistoricalStarProvider } = require("../simulation/historical-scenarios");
const { loadSimulator } = require("../simulation/paired-arena");
const { ProductionRootEngine } = require("../../../engine-v2/src/runtime/production-root");
const { actionProxy } = require("../simulation/production-diagnostic-bot");
const { decisionMemoryFingerprint } = require("./memory-fingerprint");
const { observationFingerprint } = require("./capsule");

function decisionsForStep(step) {
  return (step.decisions || []).map(decision => ({ action: null, logs: decision.logs || [],
    runtimeMs: Math.max(0, Number(decision.runtimeMicros || 0)) / 1000 }));
}

function createSimulator(module, capsule) {
  const scenario = capsule.scenario; const star = createHistoricalStarProvider(scenario.stars);
  return new module.AgenTankSimulator({ map: scenario.map,
    tanks: scenario.starts.map((tank, seat) => ({ ...tank, id: `tank-${seat}` })),
    skills: capsule.assignment.seatSkills.slice(), star: star.initialStar,
    starProvider: value => star.provider(value), seed: capsule.simulator.seed,
    maxFrames: capsule.simulator.maxFrames, starLimit: false });
}

function stepIndex(capsule) {
  return new Map(capsule.prefix.stepTrace.map(step => [step.frame, step]));
}

function decisionIndex(capsule) {
  return new Map(capsule.prefix.decisionTrace.map(frame => [frame.frame, frame]));
}

function publicPhysicalSnapshot(simulator) {
  return {
    frame: simulator.frame,
    map: simulator.map.map(column => column.slice()),
    players: simulator.players.map(player => ({ index: player.index,
      objectId: player.objectId, position: player.position.slice(), direction: player.direction,
      stars: player.stars, crashed: player.crashed, skillType: player.skillType,
      skillCooldownUntil: player.skillCooldownUntil,
      bombCooldownUntil: player.bombCooldownUntil,
      effects: { self: player.effects.self ? { ...player.effects.self } : null,
        debuff: player.effects.debuff ? { ...player.effects.debuff } : null } })),
    bullets: simulator.bullets.map(bullet => ({ objectId: bullet.objectId,
      ownerIndex: bullet.ownerIndex, position: bullet.position.slice(),
      direction: bullet.direction, crashed: bullet.crashed })),
    bombs: simulator.bombs.map(bomb => ({ objectId: bomb.objectId,
      ownerIndex: bomb.ownerIndex, position: bomb.position.slice(), createdAt: bomb.createdAt,
      explodesAt: bomb.explodesAt, exploded: bomb.exploded })),
    star: simulator.star ? simulator.star.slice() : null,
    nextStarSpawnFrame: simulator.nextStarSpawnFrame,
    nextObjectId: simulator.nextObjectId,
    result: simulator.result ? { ...simulator.result } : null
  };
}

function publicPhysicalFingerprint(simulator) {
  return fingerprintObject(JSON.parse(JSON.stringify(publicPhysicalSnapshot(simulator))));
}

async function rehydratePhysical(workspaceRoot, capsule, targetFrame = capsule.window.evaluationFrame) {
  invariant(Number.isSafeInteger(targetFrame) && targetFrame >= 0,
    "REPLAY_CAPSULE_TARGET_INVALID", targetFrame);
  const loaded = await loadSimulator(workspaceRoot); const simulator = createSimulator(loaded.module, capsule);
  const steps = stepIndex(capsule); let verifiedEvents = 0;
  while (!simulator.result && simulator.frame < targetFrame) {
    const step = steps.get(simulator.frame);
    invariant(step, "REPLAY_CAPSULE_PREFIX_GAP", `${capsule.fingerprint}:${simulator.frame}`);
    const events = simulator.step(step.actions.map(action => action ? { ...action } : null),
      decisionsForStep(step));
    invariant(fingerprintObject({ events: JSON.parse(JSON.stringify(events)) }) === step.eventFingerprint,
      "REPLAY_CAPSULE_EVENT_DIVERGENCE", `${capsule.fingerprint}:${step.frame}`);
    verifiedEvents += 1;
  }
  invariant(simulator.frame === targetFrame, "REPLAY_CAPSULE_TERMINATED_BEFORE_TARGET",
    `${simulator.frame}/${targetFrame}`);
  return { simulator, verifiedEvents, physicalFingerprint:
    publicPhysicalFingerprint(simulator) };
}

async function rehydrateV2Memory(workspaceRoot, capsule, targetFrame = capsule.window.evaluationFrame,
    options = {}) {
  const loaded = await loadSimulator(workspaceRoot); const simulator = createSimulator(loaded.module, capsule);
  const steps = stepIndex(capsule); const decisions = decisionIndex(capsule);
  const engine = new ProductionRootEngine(options.v2Options || {}); const v2Seat = capsule.assignment.v2Seat;
  let observedDecisions = 0; let verifiedEvents = 0;
  while (!simulator.result && simulator.frame < targetFrame) {
    const frameDecision = decisions.get(simulator.frame); const own = frameDecision?.seats?.[v2Seat];
    if (own && own.implementation === "v2") {
      const context = simulator.snapshotFor(v2Seat);
      engine.observeOnly(context.me, context.enemy, context.game, own.command || own.action,
        { historicalWorkUnits: options.historicalRuntime === false ? undefined : own.workUnits });
      observedDecisions += 1;
    }
    const step = steps.get(simulator.frame);
    invariant(step, "REPLAY_CAPSULE_PREFIX_GAP", `${capsule.fingerprint}:${simulator.frame}`);
    const events = simulator.step(step.actions.map(action => action ? { ...action } : null),
      decisionsForStep(step));
    invariant(fingerprintObject({ events: JSON.parse(JSON.stringify(events)) }) === step.eventFingerprint,
      "REPLAY_CAPSULE_EVENT_DIVERGENCE", `${capsule.fingerprint}:${step.frame}`);
    verifiedEvents += 1;
  }
  invariant(simulator.frame === targetFrame, "REPLAY_CAPSULE_TERMINATED_BEFORE_TARGET",
    `${simulator.frame}/${targetFrame}`);
  const expected = capsule.observations.find(item => item.frame === targetFrame);
  const context = simulator.snapshotFor(v2Seat);
  if (expected) invariant(observationFingerprint(context) === expected.fingerprint,
    "REPLAY_CAPSULE_OBSERVATION_DIVERGENCE", `${capsule.fingerprint}:${targetFrame}`);
  return { simulator, engine, context, observedDecisions, verifiedEvents,
    memoryFingerprint: decisionMemoryFingerprint(engine,
      { includeRuntime: options.historicalRuntime !== false }),
    physicalFingerprint: publicPhysicalFingerprint(simulator) };
}

async function rehydrateV2MemoryBatch(workspaceRoot, bundle, options = {}) {
  invariant(bundle && bundle.authority && Array.isArray(bundle.targets) && bundle.targets.length > 0,
    "REPLAY_BATCH_INVALID", bundle?.matchId || "missing");
  const loaded = await loadSimulator(workspaceRoot);
  const authority = bundle.authority; const simulator = createSimulator(loaded.module, authority);
  const steps = stepIndex(authority); const decisions = decisionIndex(authority);
  const historicalRuntime = options.historicalRuntime !== false;
  const v2Seat = authority.assignment.v2Seat;
  const slots = bundle.targets.map(target => ({ target,
    engine: new ProductionRootEngine(options.v2Options || {}),
    observedDecisions: 0, verifiedEvents: 0 }));
  const restored = new Map(); let physicalSteps = 0;
  const maximum = bundle.maximumTarget ?? Math.max(...slots.map(slot => slot.target.evaluationFrame));
  while (!simulator.result && simulator.frame <= maximum) {
    const frame = simulator.frame; const context = simulator.snapshotFor(v2Seat);
    const frameDecision = decisions.get(frame); const own = frameDecision?.seats?.[v2Seat];
    for (const slot of slots) {
      if (frame < slot.target.evaluationFrame && own && own.implementation === "v2") {
        slot.engine.observeOnly(context.me, context.enemy, context.game,
          own.command || own.action, { historicalWorkUnits: historicalRuntime ? own.workUnits : undefined });
        slot.observedDecisions += 1;
      } else if (frame === slot.target.evaluationFrame) {
        if (slot.target.expectedObservationFingerprint) invariant(
          observationFingerprint(context) === slot.target.expectedObservationFingerprint,
          "REPLAY_CAPSULE_OBSERVATION_DIVERGENCE",
          `${slot.target.fingerprint}:${frame}`);
        restored.set(slot.target.fingerprint, { simulator, engine: slot.engine, context,
          observedDecisions: slot.observedDecisions, verifiedEvents: slot.verifiedEvents,
          memoryFingerprint: decisionMemoryFingerprint(slot.engine,
            { includeRuntime: historicalRuntime }),
          physicalFingerprint: publicPhysicalFingerprint(simulator) });
      }
    }
    if (frame === maximum) break;
    const step = steps.get(frame);
    invariant(step, "REPLAY_CAPSULE_PREFIX_GAP", `${bundle.matchId}:${frame}`);
    const events = simulator.step(step.actions.map(action => action ? { ...action } : null),
      decisionsForStep(step));
    invariant(fingerprintObject({ events: JSON.parse(JSON.stringify(events)) }) ===
      step.eventFingerprint, "REPLAY_CAPSULE_EVENT_DIVERGENCE", `${bundle.matchId}:${frame}`);
    physicalSteps += 1;
    for (const slot of slots) if (frame < slot.target.evaluationFrame) slot.verifiedEvents += 1;
  }
  invariant(restored.size === slots.length, "REPLAY_BATCH_TARGET_INCOMPLETE",
    `${bundle.matchId}:${restored.size}/${slots.length}`);
  return { restored, physicalSteps, targets: slots.length };
}

function originalTerminalSummary(capsule) {
  const v2Seat = capsule.assignment.v2Seat; const counts = capsule.original.counts;
  return { frame: capsule.original.frames,
    v2Crashed: Boolean(counts.crashes[v2Seat]),
    v1Crashed: Boolean(counts.crashes[v2Seat ^ 1]),
    v2Stars: counts.stars[v2Seat], v1Stars: counts.stars[v2Seat ^ 1],
    result: capsule.original.result ? { ...capsule.original.result } : null };
}

async function replayScriptedWindow(workspaceRoot, capsule, emittedCommand, options = {}) {
  const branchFrame = options.branchFrame == null ? capsule.window.evaluationFrame :
    Math.floor(Number(options.branchFrame));
  invariant(Number.isSafeInteger(branchFrame) && branchFrame >= capsule.window.startFrame &&
    branchFrame <= capsule.window.endFrame, "REPLAY_CAPSULE_BRANCH_FRAME_INVALID",
  `${branchFrame}/${capsule.window.startFrame}-${capsule.window.endFrame}`);
  let original = null;
  if (!options.skipOriginalReplay) {
    const originalTarget = capsule.window.endFrame + 1;
    original = await rehydratePhysical(workspaceRoot, capsule, originalTarget);
  } else invariant(capsule.window.tags.some(tag => tag === "TERMINAL" ||
    tag.startsWith("TERMINAL_")), "REPLAY_CAPSULE_TERMINAL_SUMMARY_INVALID",
  capsule.fingerprint);
  const restored = await rehydratePhysical(workspaceRoot, capsule, branchFrame);
  const simulator = restored.simulator; const steps = stepIndex(capsule); const v2Seat = capsule.assignment.v2Seat;
  let first = 1; let eventDivergences = 0;
  while (!simulator.result && simulator.frame <= capsule.window.endFrame) {
    const step = steps.get(simulator.frame);
    invariant(step, "REPLAY_CAPSULE_WINDOW_STEP_GAP", `${capsule.fingerprint}:${simulator.frame}`);
    const actions = step.actions.map(action => action ? { ...action } : null);
    if (first) { actions[v2Seat] = emittedCommand ? { ...emittedCommand } : null; first = 0; }
    const events = simulator.step(actions, decisionsForStep(step));
    if (fingerprintObject({ events: JSON.parse(JSON.stringify(events)) }) !== step.eventFingerprint)
      eventDivergences += 1;
  }
  const summarize = target => ({ frame: target.frame,
    v2Crashed: Boolean(target.players[v2Seat].crashed),
    v1Crashed: Boolean(target.players[v2Seat ^ 1].crashed),
    v2Stars: target.players[v2Seat].stars,
    v1Stars: target.players[v2Seat ^ 1].stars,
    result: target.result ? { ...target.result } : null });
  const originalState = original ? publicPhysicalSnapshot(original.simulator) : null;
  const originalSummary = original ? summarize(originalState) : originalTerminalSummary(capsule);
  const branchState = publicPhysicalSnapshot(simulator);
  const historicalStep = steps.get(branchFrame);
  const historicalCommand = historicalStep?.actions?.[v2Seat] || null;
  const sameFirstAction = JSON.stringify(historicalCommand) === JSON.stringify(emittedCommand || null);
  return { semantics: "FIXED_HISTORICAL_CONTINUATION_DIAGNOSTIC",
    branchFrame, sameFirstAction, eventDivergences, original: originalSummary,
    branch: summarize(branchState), exactReproductionFailure: sameFirstAction && eventDivergences > 0 ? 1 : 0,
    potentialSurvivalRegression: !originalSummary.v2Crashed &&
      branchState.players[v2Seat].crashed ? 1 : 0,
    potentialSurvivalImprovement: originalSummary.v2Crashed &&
      !branchState.players[v2Seat].crashed ? 1 : 0 };
}

function sameCommand(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

// Replace one root action, then let the current V2 policy decide every later
// callback while the opponent keeps the same historical action script. This
// complements (and never replaces) fixed-continuation causality: it detects
// whether the root choice remains defective under the policy that will
// actually consume its own four-frame safety recurrence.
async function replayPolicyContinuationWindow(workspaceRoot, capsule, emittedCommand,
    options = {}) {
  const branchFrame = options.branchFrame == null ? capsule.window.evaluationFrame :
    Math.floor(Number(options.branchFrame));
  invariant(Number.isSafeInteger(branchFrame) && branchFrame >= capsule.window.startFrame &&
    branchFrame <= capsule.window.endFrame, "REPLAY_POLICY_BRANCH_FRAME_INVALID",
  `${branchFrame}/${capsule.window.startFrame}-${capsule.window.endFrame}`);
  const loaded = await loadSimulator(workspaceRoot); const simulator = createSimulator(loaded.module, capsule);
  simulator.maxFrames = capsule.window.endFrame + 1;
  const steps = stepIndex(capsule); const decisions = decisionIndex(capsule);
  const v2Seat = capsule.assignment.v2Seat;
  const engine = new ProductionRootEngine(options.v2Options || {});
  const useComputedRoot = Object.hasOwn(options, "currentRootCommand") &&
    sameCommand(emittedCommand, options.currentRootCommand);
  const actionTrace = []; let rootActionVerified = 0;
  const bots = [0, 1].map(seat => ({ decide(context) {
    const frame = context.game.frames; const step = steps.get(frame);
    const historical = step?.actions?.[seat] || null;
    if (seat !== v2Seat) return { action: historical, runtimeMs: 0, logs: [] };
    const own = decisions.get(frame)?.seats?.[v2Seat];
    if (frame < branchFrame) {
      engine.observeOnly(context.me, context.enemy, context.game, historical,
        { historicalWorkUnits: own?.workUnits });
      return { action: historical, runtimeMs: 0, logs: [] };
    }
    if (frame === branchFrame && !useComputedRoot) {
      engine.observeOnly(context.me, context.enemy, context.game, emittedCommand,
        { historicalWorkUnits: own?.workUnits });
      actionTrace.push({ frame, command: emittedCommand || null, forced: true });
      return { action: emittedCommand || null, runtimeMs: 0, logs: [] };
    }
    const emitted = [];
    engine.decide(actionProxy(context.me, emitted), context.enemy, context.game);
    const command = emitted[0] || null;
    if (frame === branchFrame) {
      invariant(sameCommand(command, emittedCommand), "REPLAY_POLICY_ROOT_ACTION_DRIFT",
        `${capsule.fingerprint}:${frame}`); rootActionVerified = 1;
    }
    actionTrace.push({ frame, command, forced: false });
    return { action: command, runtimeMs: 0, logs: [] };
  } }));
  simulator.run(bots[0], bots[1]);
  const snapshot = publicPhysicalSnapshot(simulator);
  return { semantics: "FORCED_ROOT_THEN_CURRENT_V2_POLICY_WITH_HISTORICAL_OPPONENT",
    branchFrame, rootActionVerified, useComputedRoot, actionTrace,
    branch: { frame: simulator.frame,
      v2Crashed: Boolean(snapshot.players[v2Seat].crashed),
      v1Crashed: Boolean(snapshot.players[v2Seat ^ 1].crashed),
      v2Stars: snapshot.players[v2Seat].stars,
      v1Stars: snapshot.players[v2Seat ^ 1].stars,
      result: snapshot.result ? { ...snapshot.result } : null },
    eventFingerprint: fingerprintObject({ records: JSON.parse(JSON.stringify(
      simulator.records.slice(branchFrame))) }),
    rootRestoreFailures: engine.depthSearch.rootRestoreFailures +
      engine.informationSearch.rootRestoreFailures + engine.forcedWinSearch.rootRestoreFailures +
      engine.observationSafety.rootRestoreFailures };
}

module.exports = { decisionsForStep, createSimulator, stepIndex, decisionIndex,
  publicPhysicalSnapshot, publicPhysicalFingerprint, rehydratePhysical, rehydrateV2Memory,
  rehydrateV2MemoryBatch, originalTerminalSummary, replayScriptedWindow,
  replayPolicyContinuationWindow };
