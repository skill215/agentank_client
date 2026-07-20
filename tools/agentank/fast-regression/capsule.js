"use strict";

const { invariant } = require("../core/errors");
const { fingerprintObject, sha256Text } = require("../core/hash");
const { ARTIFACT_PROPERTY, AUTHORITY } = require("./properties");

function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function increment(set, value) { if (value) set.add(value); }

function v2DecisionFrames(match) {
  return (match.actionTrace || []).filter(frame => frame.seats?.[match.v2Seat]?.implementation === "v2")
    .map(frame => frame.frame).sort((left, right) => left - right);
}

function nearestDecisionFrame(frames, wanted, direction = "AT_OR_BEFORE") {
  if (!frames.length) return null;
  if (direction === "AT_OR_AFTER") return frames.find(frame => frame >= wanted) ?? frames.at(-1);
  let selected = frames[0];
  for (const frame of frames) { if (frame > wanted) break; selected = frame; }
  return selected;
}

function eventTags(events) {
  const tags = new Set();
  for (const event of events || []) {
    if (event.type === "bullet" && event.action === "created") increment(tags, "PROJECTILE_CREATED");
    if (event.type === "bullet" && event.action === "go") increment(tags, "PROJECTILE_ACTIVE");
    if (event.type === "bomb" && event.action === "created") increment(tags, "BOMB_CREATED");
    if (event.type === "bomb" && event.action === "exploded") increment(tags, "BOMB_EXPLODED");
    if (event.type === "skill" && event.action === "cast") increment(tags, `SKILL_${event.skillType || "UNKNOWN"}`);
    if (event.type === "star" && event.action === "collected") increment(tags, "STAR_COLLECTED");
    if (event.type === "tank" && event.action === "crashed") increment(tags, "TERMINAL_CRASH");
  }
  return [...tags].sort();
}

function selectWindows(match, options = {}) {
  const decisionFrames = v2DecisionFrames(match); if (!decisionFrames.length) return [];
  const replay = match.replay?.records || []; const diagnostics = match.v2?.diagnosticFrames || [];
  const radius = Math.max(1, Math.floor(Number(options.defaultRadius) || 6));
  const candidates = [];
  const add = (wanted, tags, requestedRadius = radius) => {
    const evaluationFrame = nearestDecisionFrame(decisionFrames, wanted);
    if (evaluationFrame == null) return;
    const startFrame = Math.max(0, evaluationFrame - Math.max(1, requestedRadius) + 1);
    const endFrame = Math.min(match.frames - 1, Math.max(wanted, evaluationFrame));
    candidates.push({ evaluationFrame, startFrame, endFrame, tags: [...new Set(tags)].sort() });
  };
  add(match.frames - 1, [match.result?.reason === "frameLimit" ? "TERMINAL_FRAME_LIMIT" :
    "TERMINAL", match.result?.winnerImplementation === "v2" ? "OUTCOME_WIN" :
    match.result?.winnerImplementation === "v1" ? "OUTCOME_LOSS" : "OUTCOME_DRAW"],
  match.result?.reason === "frameLimit" ? 8 : radius);
  for (let frame = 0; frame < replay.length; frame += 1) {
    const tags = eventTags(replay[frame]);
    if (tags.some(tag => tag === "TERMINAL_CRASH" || tag === "BOMB_EXPLODED" ||
        tag === "PROJECTILE_CREATED" || tag.startsWith("SKILL_") || tag === "STAR_COLLECTED"))
      add(frame, tags, tags.includes("PROJECTILE_CREATED") || tags.includes("BOMB_CREATED") ? 8 : radius);
  }
  for (const frame of diagnostics) {
    const tags = [];
    if (frame.root !== "OK") tags.push(`ROOT_${frame.root}`);
    if (frame.proof === "PROVEN") tags.push("STRICT_PROOF");
    if (frame.informationComplete === false) tags.push("INFORMATION_INCOMPLETE");
    if (frame.fallback) tags.push("FALLBACK");
    if (frame.invalidFallback) tags.push("INVALID_FALLBACK");
    if (frame.runtimeMode > 0) tags.push(`RUNTIME_MODE_${frame.runtimeMode}`);
    if (frame.allowCount === 0) tags.push("NO_HARD_ALLOW");
    if (tags.length) add(frame.frame, tags);
  }
  add(decisionFrames[0], ["NORMAL_CONTROL_OPEN"], 1);
  add(decisionFrames[Math.floor(decisionFrames.length / 2)], ["NORMAL_CONTROL_MIDDLE"], 1);
  const byKey = new Map();
  for (const item of candidates) {
    const key = `${item.evaluationFrame}:${item.startFrame}:${item.endFrame}`;
    const existing = byKey.get(key);
    if (existing) existing.tags = [...new Set([...existing.tags, ...item.tags])].sort();
    else byKey.set(key, item);
  }
  const all = [...byKey.values()]; const maximum = Math.max(3,
    Math.floor(Number(options.maximumPerMatch) || 8));
  if (all.length <= maximum) return all.sort((left, right) =>
    left.evaluationFrame - right.evaluationFrame || left.startFrame - right.startFrame);
  const selected = []; const selectedKeys = new Set(); const covered = new Set();
  const take = item => { const key = `${item.evaluationFrame}:${item.startFrame}:${item.endFrame}`;
    if (selectedKeys.has(key) || selected.length >= maximum) return;
    selected.push(item); selectedKeys.add(key); for (const tag of item.tags) covered.add(tag); };
  for (const item of all.filter(entry => entry.tags.some(tag => tag.startsWith("TERMINAL") ||
      tag.startsWith("OUTCOME_")))) take(item);
  while (selected.length < maximum) {
    let best = null; let bestGain = -1;
    for (const item of all) {
      const key = `${item.evaluationFrame}:${item.startFrame}:${item.endFrame}`;
      if (selectedKeys.has(key)) continue;
      const gain = item.tags.filter(tag => !covered.has(tag)).length;
      if (gain > bestGain || (gain === bestGain && best && item.evaluationFrame < best.evaluationFrame)) {
        best = item; bestGain = gain;
      }
    }
    if (!best) break; take(best);
  }
  return selected.sort((left, right) => left.evaluationFrame - right.evaluationFrame ||
    left.startFrame - right.startFrame);
}

function observationFingerprint(context) { return sha256Text(JSON.stringify(context)); }

function reducedDecisionTrace(match) {
  return (match.actionTrace || []).map(frame => ({ frame: frame.frame,
    seats: (frame.seats || []).map(seat => seat ? {
      implementation: seat.implementation,
      skill: seat.skill,
      action: seat.action,
      command: copy(seat.command),
      runtimeMicros: seat.runtimeMicros || 0,
      workUnits: seat.workUnits || 0
    } : null) }));
}

function logicalWindowFingerprint(capsule) {
  return fingerprintObject({
    source: { matchId: capsule.source.matchId,
      historicalMatchUrlId: capsule.source.historicalMatchUrlId,
      scenarioFingerprint: capsule.source.scenarioFingerprint,
      v1Sha256: capsule.source.v1Sha256,
      v2Sha256: capsule.source.v2Sha256,
      parameterFingerprint: capsule.source.parameterFingerprint },
    simulator: { commit: capsule.simulator.commit, seed: capsule.simulator.seed,
      maxFrames: capsule.simulator.maxFrames },
    assignment: capsule.assignment,
    window: capsule.window,
    physicalPrefix: capsule.prefix.stepTrace.map(step => ({ frame: step.frame,
      actions: step.actions, eventFingerprint: step.eventFingerprint }))
  });
}

function buildCapsuleDraft(match, scenario, window, binding = {}) {
  invariant(Array.isArray(match.stepTrace) && match.stepTrace.length >= window.evaluationFrame,
    "REPLAY_CAPSULE_STEP_TRACE_MISSING", match.matchId);
  const contexts = match.contexts?.[`seat${match.v2Seat}`] || [];
  const observations = contexts.filter(context => context.game?.frames >= window.startFrame &&
    context.game?.frames <= window.endFrame).map(context => ({
      frame: context.game.frames, fingerprint: observationFingerprint(context)
    }));
  const capsule = {
    artifactKind: "REPLAY_CAPSULE_DRAFT",
    properties: [ARTIFACT_PROPERTY.IMMUTABLE, ARTIFACT_PROPERTY.CONTENT_ADDRESSED,
      ARTIFACT_PROPERTY.DETERMINISTIC, ARTIFACT_PROPERTY.REHYDRATABLE,
      ARTIFACT_PROPERTY.SOURCE_BOUND, ARTIFACT_PROPERTY.RULE_BOUND],
    authority: AUTHORITY.PINNED_SIMULATOR,
    source: {
      runId: binding.runId || null,
      matchId: match.matchId,
      historicalMatchUrlId: match.historicalMatchUrlId,
      scenarioFingerprint: match.scenarioFingerprint,
      v1Sha256: binding.v1Sha256 || "UNBOUND",
      v2Sha256: binding.v2Sha256 || "UNBOUND",
      parameterFingerprint: binding.parameterFingerprint || "UNBOUND"
    },
    simulator: {
      commit: binding.simulatorCommit,
      archiveSha256: binding.simulatorArchiveSha256,
      seed: binding.seed,
      maxFrames: 128,
      ruleAuthority: "PINNED_EXTERNAL_SIMULATOR_NOT_PLATFORM_TRUTH"
    },
    scenario: {
      matchUrlId: scenario.matchUrlId,
      fingerprint: scenario.fingerprint,
      mapHash: scenario.mapHash,
      map: copy(scenario.map),
      starts: copy(scenario.starts),
      stars: copy(scenario.stars)
    },
    assignment: {
      variantId: match.variantId,
      family: match.family,
      repetition: match.repetition,
      seatImplementations: match.seatImplementations.slice(),
      seatSkills: match.seatSkills.slice(),
      v2Seat: match.v2Seat
    },
    window: {
      startFrame: window.startFrame,
      evaluationFrame: window.evaluationFrame,
      endFrame: window.endFrame,
      tags: window.tags,
      continuationSemantics: "ROOT_FACT_REPLAY_WITH_OPTIONAL_SCRIPTED_COUNTERFACTUAL"
    },
    prefix: {
      stepTrace: copy(match.stepTrace.slice(0, window.endFrame + 1)),
      decisionTrace: reducedDecisionTrace(match).filter(frame => frame.frame <= window.endFrame)
    },
    observations,
    original: {
      frames: match.frames,
      result: copy(match.result),
      counts: copy(match.counts),
      v2Diagnostics: copy((match.v2?.diagnosticFrames || []).filter(frame =>
        frame.frame >= window.startFrame && frame.frame <= window.endFrame))
    },
    restorePolicy: {
      physicalState: "REPLAY_STEP_PREFIX",
      factMemory: "OBSERVE_ONLY",
      runtime: "HISTORICAL_WORK_UNITS_OR_NORMAL_LANE",
      plans: "COLD",
      caches: "COLD",
      actionEqualityAssertion: false
    }
  };
  capsule.windowFingerprint = logicalWindowFingerprint(capsule);
  return capsule;
}

module.exports = { v2DecisionFrames, nearestDecisionFrame, eventTags, selectWindows,
  observationFingerprint, reducedDecisionTrace, logicalWindowFingerprint, buildCapsuleDraft };
