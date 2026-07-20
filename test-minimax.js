const fs = require("fs");
const vm = require("vm");
const { performance } = require("perf_hooks");

function loadAgent(file = "tiny-tank-minimax.js", runtime = {}) {
  const context = { console, Math: runtime.Math || Math };
  if (!runtime.omitWeakMap) context.WeakMap = WeakMap;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, "utf8"), context);
  return context;
}

function legacyMathWithoutImul() {
  const legacy = {};
  for (const name of Object.getOwnPropertyNames(Math)) {
    if (name === "imul") continue;
    Object.defineProperty(legacy, name,
      Object.getOwnPropertyDescriptor(Math, name));
  }
  return legacy;
}

function makeMap() {
  const size = 17;
  const map = Array.from({ length: size }, (_, x) =>
    Array.from({ length: size }, (_, y) =>
      x === 0 || y === 0 || x === size - 1 || y === size - 1 ? "x" : "."));
  [[4, 4], [4, 5], [4, 6], [8, 8], [9, 8], [10, 8],
    [12, 3], [12, 4], [12, 5]].forEach(([x, y], i) => {
    map[x][y] = i % 3 === 0 ? "m" : "x";
  });
  map[7][6] = "o";
  map[11][11] = "o";
  return map;
}

function mapFromReplayRaw(raw) {
  const rows = raw.split("|");
  return Array.from({ length: rows[0].length }, (_, x) =>
    rows.map(row => row[x] === "a" || row[x] === "C" ? "." : row[x]));
}

function actor(position, direction, extra = {}) {
  return {
    tank: { position: position.slice(), direction },
    stars: extra.stars || 0,
    bullet: extra.bullet || null,
    status: Object.assign({
      boosted: false, fireLocked: false, stunned: false,
      shielded: false, frozen: false, poisoned: false,
      overloaded: false, cloaked: false, canActThisFrame: true,
      bombActive: false, bombCooldownFrames: 0
    }, extra.status),
    effects: extra.effects || {},
    skill: extra.skill || { type: "stun", remainingCooldownFrames: 0 }
  };
}

function recordActions(unit) {
  unit.commands = [];
  unit.go = function() { this.commands.push("GO"); };
  unit.turn = function(direction) {
    this.commands.push(direction === "left" ? "LEFT" : "RIGHT");
  };
  unit.fire = function() { this.commands.push("FIRE"); };
  unit.stun = function() { this.commands.push("STUN"); };
  unit.throwBomb = function() { this.commands.push("BOMB"); };
  return unit;
}

function bombAndSkillChecks() {
  const context = loadAgent();
  const map = makeMap();
  map[7][6] = "x";
  map[9][6] = "m";
  map[8][8] = ".";
  map[9][8] = ".";
  const blast = context.bombBlastEffect([8, 6], map);
  if (!blast.codes[context.positionCode([8, 6])] ||
      !blast.codes[context.positionCode([8, 5])] ||
      blast.codes[context.positionCode([7, 6])] ||
      blast.codes[context.positionCode([9, 6])] ||
      !blast.mounds.some(p => p[0] === 9 && p[1] === 6)) {
    throw new Error("bomb blast wall/mound geometry is incorrect");
  }

  const me = actor([8, 8], "right");
  const enemy = actor([13, 12], "left", {
    skill: { type: "freeze", remainingCooldownFrames: 0 }
  });
  const detonationGame = {
    map, star: null, frames: 1,
    bombs: [{ position: [8, 6], placedFrame: -9, explodeFrame: 1 }]
  };
  const root = context.makeSearchState(me, enemy, detonationGame);
  const escaped = context.applyJointActions(root, "GO", "LEFT", false);
  const stayed = context.applyJointActions(root, "LEFT", "LEFT", false);
  if (escaped.myDead || !stayed.myDead) {
    throw new Error(`detonation-frame movement is not terminally resolved: escaped=${escaped.myDead}, stayed=${stayed.myDead}, escapedPos=${escaped.myPos}, stayedPos=${stayed.myPos}`);
  }

  const shieldedMe = actor([8, 8], "right", {
    status: { shielded: true },
    effects: { self: { type: "shield", remainingFrames: 4 } }
  });
  const shieldRoot = context.makeSearchState(shieldedMe, enemy,
    detonationGame);
  const shielded = context.applyJointActions(shieldRoot, "LEFT", "LEFT",
    false);
  if (shielded.myDead || shielded.myShieldHits !== 0 ||
      shielded.myShielded) {
    throw new Error("bomb must consume one active shield without killing");
  }

  const deadlineGame = {
    map, star: null, frames: 0,
    bombs: [{ position: [8, 6], placedFrame: -8, explodeFrame: 2 }]
  };
  const deadlineMe = actor([8, 8], "up");
  const freezeRoot = context.makeSearchState(deadlineMe, enemy, deadlineGame);
  const frozen = context.applyJointActions(freezeRoot, "RIGHT", "FREEZE",
    false);
  if (!context.hasForcedBombDeath(frozen, true)) {
    throw new Error("freeze-created forced bomb death was not detected");
  }

  const overloadedEnemy = actor([8, 6], "down", {
    status: { overloaded: true },
    effects: { self: { type: "overload", remainingFrames: 5 } },
    skill: { type: "overload", remainingCooldownFrames: 20 }
  });
  const oneHitShield = actor([8, 8], "right", {
    status: { shielded: true },
    effects: { self: { type: "shield", remainingFrames: 4 } }
  });
  const overloadRoot = context.makeSearchState(oneHitShield,
    overloadedEnemy, { map, star: null, frames: 0, bombs: [] });
  const overloadedHit = context.applyJointActions(overloadRoot, "LEFT",
    "FIRE", false);
  if (overloadedHit.myDead || overloadedHit.myShieldHits !== 0 ||
      overloadedHit.myShielded) {
    throw new Error("one overload lane must consume, not bypass, one shield hit");
  }

  const boostedEnemy = actor([8, 8], "up", {
    status: { boosted: true },
    effects: { self: { type: "boost", remainingFrames: 5 } },
    skill: { type: "boost", remainingCooldownFrames: 20 }
  });
  const boostTarget = actor([9, 8], "up");
  const boostState = context.makeSearchState(boostTarget, boostedEnemy,
    { map, star: null, frames: 0, bombs: [] });
  const boostActions = context.tacticalActions(boostState, false);
  if (!boostActions.includes("RIGHT_FIRE")) {
    throw new Error("active boost must include free-turn plus fire");
  }

  const bombMe = actor([8, 8], "left");
  const bombEnemy = actor([8, 10], "left", {
    skill: { type: "freeze", remainingCooldownFrames: 20 }
  });
  const bombState = context.makeSearchState(bombMe, bombEnemy,
    { map, star: null, frames: 0, bombs: [] });
  if (!context.shouldConsiderBomb(bombState, true)) {
    throw new Error("safe close-range area denial bomb was not generated");
  }
  const placed = context.applyJointActions(bombState, "BOMB", "LEFT",
    false);
  if (placed.bombs.length !== 1 || placed.bombs[0].explodeFrame !== 10 ||
      placed.myBombReady) {
    throw new Error("own bomb placement state is incorrect");
  }

  const runtimeMe = actor([8, 8], "right");
  const runtimeEnemy = actor([13, 12], "left");
  const urgentAction = context.chooseVisibleBombSafetyAction(runtimeMe,
    runtimeEnemy, detonationGame);
  if (urgentAction !== "GO") {
    throw new Error(`urgent bomb escape expected GO, got ${urgentAction}`);
  }

  return {
    blastTiles: blast.tiles,
    escaped: !escaped.myDead,
    stayedDead: stayed.myDead,
    shieldConsumed: shielded.myShieldHits === 0,
    freezeForcedDeath: context.hasForcedBombDeath(frozen, true),
    overloadShieldConsumed: !overloadedHit.myDead &&
      overloadedHit.myShieldHits === 0,
    boostActions,
    ownBombUtility: context.bombPlacementUtility(bombState, true),
    urgentAction
  };
}

function featurePerformance() {
  const skills = ["shield", "freeze", "stun", "overload", "cloak",
    "poison", "teleport", "boost"];
  const samples = [];
  let maxNodes = 0;
  for (let pass = 0; pass < 8; pass++) {
    const context = loadAgent();
    const map = makeMap();
    const start = performance.now();
    for (const skill of skills) {
      const me = actor([8, 8], "right");
      const enemy = actor([11, 8], "left", {
        skill: { type: skill, remainingCooldownFrames: 0 }
      });
      const game = {
        map, star: [8, 11], frames: 4,
        bombs: [{ position: [8, 8], placedFrame: 0, explodeFrame: 10 }]
      };
      const result = decide(context, { me, enemy, game });
      maxNodes = Math.max(maxNodes, result.nodes);
    }
    samples.push((performance.now() - start) / skills.length);
  }
  samples.sort((a, b) => a - b);
  const medianMsPerDecision = samples[Math.floor(samples.length / 2)];
  if (medianMsPerDecision > 15 || maxNodes > 128) {
    throw new Error(`feature performance budget exceeded: ${medianMsPerDecision}ms, ${maxNodes} nodes`);
  }
  return {
    medianMsPerDecision: Number(medianMsPerDecision.toFixed(4)),
    minMsPerDecision: Number(samples[0].toFixed(4)),
    maxMsPerDecision: Number(samples[samples.length - 1].toFixed(4)),
    maxNodes
  };
}

function cases() {
  const map = makeMap();
  return [
    {
      name: "adjacent-winning-shot",
      me: actor([6, 6], "right"), enemy: actor([7, 6], "left"),
      game: { map, star: [13, 13] }, expected: "FIRE"
    },
    {
      name: "predictive-intercept",
      me: actor([6, 10], "right"), enemy: actor([10, 9], "down"),
      game: { map, star: [10, 13] }
    },
    {
      name: "enemy-muzzle-risk",
      me: actor([6, 12], "up"), enemy: actor([6, 9], "down"),
      game: { map, star: [13, 13] }
    },
    {
      name: "visible-projectile",
      me: actor([10, 6], "right", {
        bullet: { position: [5, 2], direction: "right" }
      }),
      enemy: actor([10, 11], "up", {
        bullet: { position: [10, 8], direction: "up" }
      }),
      game: { map, star: [6, 13] }
    },
    {
      name: "edge-contact",
      me: actor([1, 7], "up", { stars: 1 }),
      enemy: actor([5, 7], "left"),
      game: { map, star: [11, 12] }
    },
    {
      name: "stunned-window",
      me: actor([9, 10], "up"),
      enemy: actor([9, 6], "left", {
        status: { stunned: true }, effects: { debuff: { remainingFrames: 2 } }
      }),
      game: { map, star: [7, 6] }
    }
  ];
}

function decide(context, scenario) {
  context.resetFrameCaches(scenario.game.map);
  const state = context.makeSearchState(scenario.me, scenario.enemy,
    scenario.game);
  context.AT_SEARCH_NODES = 0;
  const rounds = context.tacticalSearchRounds(state);
  const action = context.chooseTacticalAction(state, rounds);
  return {
    action, rounds, value: state._chosenValue, nodes: context.AT_SEARCH_NODES,
    monteCarloUsed: !!state._monteCarloUsed,
    monteCarloTransitions: state._monteCarloTransitions || 0,
    monteCarloPrunedReason: state._monteCarloPrunedReason || null,
    monteCarloBudget: state._monteCarloBudget || null
  };
}

function fixedStateMonteCarloChecks() {
  const raw = "xxxxxxxxxxxxxxxxxxx|x.............xmm.x|x.a.........xx....x|x...o.............x|xm..o.m......m..xxx|x.xmxxm......x..xxx|x.x.m.x...........x|x...moo....ooom...x|x...........x.m.x.x|xxx..x......mxxmx.x|xxx..m......m.o..mx|x.............o...x|x....xx.........C.x|x.mmx.............x|xxxxxxxxxxxxxxxxxxx";
  const replayFrame16 = {
    me: actor([7, 7], "down", {
      skill: { type: "stun", remainingCooldownFrames: 17 }
    }),
    enemy: actor([10, 10], "left", {
      status: { stunned: true },
      effects: { debuff: { remainingFrames: 3 } },
      skill: { type: "freeze", remainingCooldownFrames: 0 }
    }),
    game: {
      map: mapFromReplayRaw(raw), star: [6, 10], bombs: [], frames: 16
    }
  };
  const stunContext = loadAgent();
  stunContext.AT_ENEMY_OBSERVATIONS = 10;
  stunContext.AT_ENEMY_COUNTS = { GO: 7, LEFT: 2, RIGHT: 2, FIRE: 3 };
  const stunned = decide(stunContext, replayFrame16);
  if (!stunned.monteCarloUsed ||
      (stunned.action !== "LEFT" && stunned.action !== "RIGHT") ||
      !stunned.monteCarloBudget ||
      stunned.monteCarloBudget.mode !== "stunned-half" ||
      stunned.monteCarloTransitions > 32) {
    throw new Error(`stunned-frame pruning changed the safe turn or budget: ${JSON.stringify(stunned)}`);
  }

  const finalStunContext = loadAgent();
  finalStunContext.AT_ENEMY_OBSERVATIONS = 10;
  const finalStunScenario = {
    me: replayFrame16.me,
    enemy: actor([10, 10], "left", {
      status: { stunned: true },
      effects: { debuff: { remainingFrames: 2 } },
      skill: { type: "freeze", remainingCooldownFrames: 0 }
    }),
    game: replayFrame16.game
  };
  const finalStun = decide(finalStunContext, finalStunScenario);
  if (finalStun.monteCarloUsed ||
      finalStun.monteCarloPrunedReason !== "stun-final-frames") {
    throw new Error(`final stun frames must fully prune MC: ${JSON.stringify(finalStun)}`);
  }

  const frozenContext = loadAgent();
  frozenContext.AT_ENEMY_OBSERVATIONS = 10;
  frozenContext.AT_ENEMY_COUNTS = { GO: 7, LEFT: 2, RIGHT: 2, FIRE: 3 };
  const frozen = decide(frozenContext, {
    me: actor([2, 12], "right"),
    enemy: actor([11, 3], "down", {
      status: { frozen: true },
      effects: { debuff: { remainingFrames: 4 } }
    }),
    game: { map: makeMap(), star: [8, 10], bombs: [], frames: 8 }
  });
  if (!frozen.monteCarloUsed || !frozen.monteCarloBudget ||
      frozen.monteCarloBudget.mode !== "forced-wait-quarter" ||
      frozen.monteCarloTransitions > 16) {
    throw new Error(`long freeze must use quarter MC budget: ${JSON.stringify(frozen)}`);
  }

  const terminalContext = loadAgent();
  terminalContext.AT_ENEMY_OBSERVATIONS = 10;
  terminalContext.resetFrameCaches();
  const terminalState = terminalContext.makeSearchState(
    actor([2, 12], "right"), actor([11, 3], "down"),
    { map: makeMap(), star: [8, 10], bombs: [], frames: 8 });
  const terminalEvaluated = [
    { action: "GO", value: 100000, rawValue: 100000, unsafe: false },
    { action: "LEFT", value: 100000, rawValue: 100000, unsafe: false }
  ];
  terminalContext.applyMonteCarloLeafExtension(terminalState,
    terminalEvaluated, true);
  if (terminalState._monteCarloUsed ||
      terminalState._monteCarloPrunedReason !== "exact-terminal-win") {
    throw new Error("exact terminal wins must not be resampled by MC");
  }

  return { stunned, finalStun, frozen,
    terminalReason: terminalState._monteCarloPrunedReason };
}

function fixedStateMonteCarloPerformance() {
  const raw = "xxxxxxxxxxxxxxxxxxx|x.............xmm.x|x.a.........xx....x|x...o.............x|xm..o.m......m..xxx|x.xmxxm......x..xxx|x.x.m.x...........x|x...moo....ooom...x|x...........x.m.x.x|xxx..x......mxxmx.x|xxx..m......m.o..mx|x.............o...x|x....xx.........C.x|x.mmx.............x|xxxxxxxxxxxxxxxxxxx";
  const scenario = {
    me: actor([7, 7], "down", {
      skill: { type: "stun", remainingCooldownFrames: 17 }
    }),
    enemy: actor([10, 10], "left", {
      status: { stunned: true },
      effects: { debuff: { remainingFrames: 3 } },
      skill: { type: "freeze", remainingCooldownFrames: 0 }
    }),
    game: {
      map: mapFromReplayRaw(raw), star: [6, 10], bombs: [], frames: 16
    }
  };
  function sample(pruning) {
    const context = loadAgent();
    context.console = { log() {} };
    context.AT_MC_FIXED_STATE_PRUNING = pruning;
    context.AT_ENEMY_OBSERVATIONS = 10;
    context.AT_ENEMY_COUNTS = { GO: 7, LEFT: 2, RIGHT: 2, FIRE: 3 };
    const start = performance.now();
    let last = null;
    for (let repeat = 0; repeat < 20; repeat++) {
      last = decide(context, scenario);
    }
    return { elapsed: (performance.now() - start) / 20, last };
  }
  const full = [];
  const pruned = [];
  let fullLast = null;
  let prunedLast = null;
  for (let pass = 0; pass < 8; pass++) {
    const order = pass % 2 === 0 ? [false, true] : [true, false];
    for (const pruning of order) {
      const result = sample(pruning);
      if (pruning) {
        pruned.push(result.elapsed);
        prunedLast = result.last;
      } else {
        full.push(result.elapsed);
        fullLast = result.last;
      }
    }
  }
  full.sort((a, b) => a - b);
  pruned.sort((a, b) => a - b);
  const fullMedian = full[Math.floor(full.length / 2)];
  const prunedMedian = pruned[Math.floor(pruned.length / 2)];
  if (fullLast.action !== prunedLast.action ||
      prunedLast.monteCarloTransitions >= fullLast.monteCarloTransitions) {
    throw new Error(`fixed-state pruning regression: full=${JSON.stringify(fullLast)}, pruned=${JSON.stringify(prunedLast)}`);
  }
  return {
    full: {
      medianMsPerDecision: Number(fullMedian.toFixed(4)),
      action: fullLast.action,
      transitions: fullLast.monteCarloTransitions
    },
    pruned: {
      medianMsPerDecision: Number(prunedMedian.toFixed(4)),
      action: prunedLast.action,
      transitions: prunedLast.monteCarloTransitions
    },
    reductionPercent: Number(((1 - prunedMedian / fullMedian) * 100).toFixed(2))
  };
}

function monteCarloChecks(scenarioList) {
  const results = [];
  const map = makeMap();
  const probes = scenarioList.concat([
    {
      name: "strategic-ambiguous-a",
      me: actor([8, 12], "up"), enemy: actor([13, 6], "left"),
      game: { map, star: [8, 3] }
    },
    {
      name: "strategic-ambiguous-b",
      me: actor([2, 12], "right"), enemy: actor([11, 3], "down"),
      game: { map, star: [8, 10] }
    },
    {
      name: "strategic-ambiguous-c",
      me: actor([7, 12], "left"), enemy: actor([13, 7], "up"),
      game: { map, star: [7, 4] }
    }
  ]);
  for (const scenario of probes) {
    const context = loadAgent();
    context.AT_ENEMY_OBSERVATIONS = 10;
    context.AT_ENEMY_COUNTS = { GO: 7, LEFT: 2, RIGHT: 2, FIRE: 3 };
    const result = decide(context, scenario);
    if (result.monteCarloUsed) results.push({ name: scenario.name, ...result });
  }
  return results;
}

function runtimeBudgetChecks() {
  const scenario = {
    name: "strategic-ambiguous-b",
    me: actor([2, 12], "right"), enemy: actor([11, 3], "down"),
    game: { map: makeMap(), star: [8, 10], frames: 40 }
  };
  const controlContext = loadAgent();
  if (controlContext.AT_MC_DISABLE_AFTER_MS !== 1000 ||
      controlContext.AT_MINIMAX_REDUCE_AFTER_MS !== 2250 ||
      controlContext.AT_MINIMAX_EMERGENCY_AFTER_MS !== 2700 ||
      controlContext.AT_MC_DISABLE_AFTER_PROGRESS !== 64 ||
      controlContext.AT_MINIMAX_REDUCE_AFTER_PROGRESS !== 100 ||
      controlContext.AT_MINIMAX_EMERGENCY_AFTER_PROGRESS !== 112) {
    throw new Error("runtime thresholds must be 1000/2250/2700ms and 64/100/112 progress");
  }
  controlContext.AT_ENEMY_OBSERVATIONS = 10;
  controlContext.AT_ENEMY_COUNTS = { GO: 7, LEFT: 2, RIGHT: 2, FIRE: 3 };
  const control = decide(controlContext, scenario);
  if (!control.monteCarloUsed) {
    throw new Error(`runtime budget control must use MC: ${JSON.stringify(control)}`);
  }

  const progressMcContext = loadAgent();
  progressMcContext.runtimeClockMs = () => 0;
  progressMcContext.AT_ENEMY_OBSERVATIONS = 10;
  progressMcContext.AT_ENEMY_COUNTS = { GO: 7, LEFT: 2, RIGHT: 2, FIRE: 3 };
  progressMcContext.beginRuntimeMeasurement({ frames: 63 });
  const progressMcBefore = decide(progressMcContext, scenario);
  progressMcContext.beginRuntimeMeasurement({ frames: 64 });
  const progressMcAfter = decide(progressMcContext, scenario);
  if (!progressMcBefore.monteCarloUsed || progressMcAfter.monteCarloUsed ||
      progressMcAfter.monteCarloPrunedReason !== "runtime-budget") {
    throw new Error(`progress 64 must disable MC: before=${JSON.stringify(progressMcBefore)}, after=${JSON.stringify(progressMcAfter)}`);
  }

  const budgetContext = loadAgent();
  budgetContext.AT_ENEMY_OBSERVATIONS = 10;
  budgetContext.AT_ENEMY_COUNTS = { GO: 7, LEFT: 2, RIGHT: 2, FIRE: 3 };
  budgetContext.AT_ACCUMULATED_RUNTIME_MS =
    budgetContext.AT_MC_DISABLE_AFTER_MS;
  const pruned = decide(budgetContext, scenario);
  if (pruned.monteCarloUsed || pruned.monteCarloTransitions !== 0 ||
      pruned.monteCarloPrunedReason !== "runtime-budget") {
    throw new Error(`1000ms runtime fuse must prune MC: ${JSON.stringify(pruned)}`);
  }

  const fullDepthContext = loadAgent();
  fullDepthContext.AT_ACCUMULATED_RUNTIME_MS =
    fullDepthContext.AT_MINIMAX_REDUCE_AFTER_MS - 1;
  const fullDepth = decide(fullDepthContext, scenario);
  if (fullDepth.rounds !== 3) {
    throw new Error(`2249ms must retain normal Minimax depth: ${JSON.stringify(fullDepth)}`);
  }

  const reducedContext = loadAgent();
  reducedContext.AT_ACCUMULATED_RUNTIME_MS =
    reducedContext.AT_MINIMAX_REDUCE_AFTER_MS;
  const reduced = decide(reducedContext, scenario);
  if (reduced.rounds !== 2 || reduced.monteCarloUsed) {
    throw new Error(`2250ms must cap Minimax at two rounds: ${JSON.stringify(reduced)}`);
  }

  const reducedSafetyContext = loadAgent();
  reducedSafetyContext.AT_ACCUMULATED_RUNTIME_MS =
    reducedSafetyContext.AT_MINIMAX_REDUCE_AFTER_MS;
  const reducedMuzzle = decide(reducedSafetyContext, cases()[2]);
  if (reducedMuzzle.rounds !== 2 || reducedMuzzle.action !== "RIGHT") {
    throw new Error(`reduced Minimax must retain two-frame muzzle safety: ${JSON.stringify(reducedMuzzle)}`);
  }

  const emergencyContext = loadAgent();
  emergencyContext.AT_ACCUMULATED_RUNTIME_MS =
    emergencyContext.AT_MINIMAX_EMERGENCY_AFTER_MS;
  const emergencyScenario = cases()[2];
  const emergencyMuzzle = decide(emergencyContext, emergencyScenario);
  const emergencyResolved = emergencyContext.saferRuntimeAction(
    emergencyScenario.me, emergencyScenario.enemy, emergencyScenario.game,
    emergencyMuzzle.action);
  if (emergencyMuzzle.rounds !== 1 ||
      (emergencyResolved !== "LEFT" && emergencyResolved !== "RIGHT")) {
    throw new Error(`2700ms emergency Minimax must retain final muzzle safety: search=${JSON.stringify(emergencyMuzzle)}, resolved=${emergencyResolved}`);
  }

  const frameFallbackContext = loadAgent();
  frameFallbackContext.runtimeClockMs = () => 0;
  frameFallbackContext.beginRuntimeMeasurement({ frames: 99 });
  const beforeFrameFallback = decide(frameFallbackContext, scenario);
  frameFallbackContext.beginRuntimeMeasurement({ frames: 100 });
  const frameReduced = decide(frameFallbackContext, scenario);
  frameFallbackContext.beginRuntimeMeasurement({ frames: 112 });
  const frameEmergency = decide(frameFallbackContext, cases()[2]);
  const frameEmergencyResolved = frameFallbackContext.saferRuntimeAction(
    emergencyScenario.me, emergencyScenario.enemy, emergencyScenario.game,
    frameEmergency.action);
  if (beforeFrameFallback.rounds !== 3 ||
      frameReduced.rounds !== 2 || frameReduced.monteCarloUsed ||
      frameEmergency.rounds !== 1 ||
      (frameEmergencyResolved !== "LEFT" &&
        frameEmergencyResolved !== "RIGHT")) {
    throw new Error(`frame fallback tiers are incorrect: before=${JSON.stringify(beforeFrameFallback)}, reduced=${JSON.stringify(frameReduced)}, emergency=${JSON.stringify(frameEmergency)}`);
  }

  const callFallbackContext = loadAgent();
  callFallbackContext.runtimeClockMs = () => 0;
  for (let call = 0; call <= 100; call++) {
    callFallbackContext.beginRuntimeMeasurement({ frames: 0 });
  }
  const callReduced = decide(callFallbackContext, scenario);
  if (callFallbackContext.AT_MATCH_PROGRESS !== 100 ||
      callReduced.rounds !== 2 || callReduced.monteCarloUsed) {
    throw new Error(`onIdle-call fallback did not reduce at 100: progress=${callFallbackContext.AT_MATCH_PROGRESS}, result=${JSON.stringify(callReduced)}`);
  }

  let now = 1000;
  budgetContext.runtimeClockMs = () => now;
  budgetContext.AT_ACCUMULATED_RUNTIME_MS = 992;
  budgetContext.AT_MC_DISABLED_BY_RUNTIME = false;
  budgetContext.AT_LAST_TIMED_FRAME = 40;
  const startedAt = budgetContext.beginRuntimeMeasurement({ frames: 41 });
  now += 8;
  budgetContext.finishRuntimeMeasurement(startedAt);
  if (!budgetContext.AT_MC_DISABLED_BY_RUNTIME ||
      budgetContext.AT_ACCUMULATED_RUNTIME_MS !== 1000) {
    throw new Error("runtime measurement must trip the MC fuse at 1000ms");
  }

  budgetContext.beginRuntimeMeasurement({ frames: 1 });
  if (budgetContext.AT_MC_DISABLED_BY_RUNTIME ||
      budgetContext.AT_ACCUMULATED_RUNTIME_MS !== 0 ||
      budgetContext.AT_MATCH_DECISION_CALLS !== 1 ||
      budgetContext.AT_MATCH_PROGRESS !== 1) {
    throw new Error("frame rollback must reset the per-match runtime fuse");
  }
  return {
    controlAction: control.action,
    controlTransitions: control.monteCarloTransitions,
    progressMcTransitions: [progressMcBefore.monteCarloTransitions,
      progressMcAfter.monteCarloTransitions],
    prunedAction: pruned.action,
    prunedReason: pruned.monteCarloPrunedReason,
    fullDepthBefore2250: fullDepth.rounds,
    reducedDepthAt2250: reduced.rounds,
    reducedMuzzleAction: reducedMuzzle.action,
    emergencyDepthAt2700: emergencyMuzzle.rounds,
    emergencyMuzzleAction: emergencyResolved,
    frameDepths: [beforeFrameFallback.rounds, frameReduced.rounds,
      frameEmergency.rounds],
    callFallbackProgress: callFallbackContext.AT_MATCH_PROGRESS,
    callFallbackDepth: callReduced.rounds,
    accumulatedAtTrip: 1000,
    resetOnNewMatch: true
  };
}

function runtimeCompatibilityChecks() {
  const modern = loadAgent();
  const legacy = loadAgent("tiny-tank-minimax.js", {
    Math: legacyMathWithoutImul(), omitWeakMap: true
  });
  const map = makeMap();
  const modernFingerprint = modern.physicalMapFingerprint(map);
  const legacyFingerprint = legacy.physicalMapFingerprint(map);
  if (modernFingerprint !== legacyFingerprint) {
    throw new Error("portable map fingerprint differs in legacy sandbox");
  }
  const me = recordActions(actor([8, 8], "right"));
  legacy.onIdle(me, actor([12, 8], "left"),
    { map, star: [8, 10], bombs: [], frames: 1 });
  if (me.commands.length !== 1) {
    throw new Error(`legacy runtime must queue one command, got ${me.commands}`);
  }
  return {
    noMathImul: typeof legacy.Math.imul === "undefined",
    noWeakMap: typeof legacy.WeakMap === "undefined",
    fingerprint: legacyFingerprint,
    action: me.commands[0]
  };
}

function physicalStateCacheChecks() {
  const context = loadAgent();
  const map = makeMap();
  context.resetFrameCaches(map);
  const firstFingerprint = context.AT_ROOT_MAP_FINGERPRINT;
  const firstFeatures = context.staticPositionFeatures([6, 6], map);
  const firstTable = context.AT_POSITION_FEATURE_CACHE[0];
  context.buildDistanceField(map, [13, 13]);
  const firstDistanceTable = context.AT_DISTANCE_FIELD_CACHE[0];

  // Runtime may provide a fresh array instance for unchanged terrain. The
  // content fingerprint, not object identity, controls physical cache reuse.
  const identicalMap = map.map(column => column.slice());
  context.resetFrameCaches(identicalMap);
  const repeatedFeatures = context.staticPositionFeatures([6, 6],
    identicalMap);
  if (context.AT_ROOT_MAP_FINGERPRINT !== firstFingerprint ||
      context.AT_POSITION_FEATURE_CACHE[0] !== firstTable ||
      context.AT_DISTANCE_FIELD_CACHE[0] !== firstDistanceTable ||
      repeatedFeatures !== firstFeatures) {
    throw new Error("unchanged physical map state must reuse frozen geometry");
  }

  identicalMap[6][6] = "m";
  context.resetFrameCaches(identicalMap);
  const changedFeatures = context.staticPositionFeatures([6, 6],
    identicalMap);
  if (context.AT_ROOT_MAP_FINGERPRINT === firstFingerprint ||
      context.AT_POSITION_FEATURE_CACHE[0] === firstTable ||
      changedFeatures === firstFeatures || changedFeatures.tile !== "m") {
    throw new Error("terrain changes must invalidate frozen physical geometry");
  }
  return {
    identicalMapReused: true,
    terrainChangeInvalidated: true,
    cachedTileBefore: firstFeatures.tile,
    cachedTileAfter: changedFeatures.tile
  };
}

function monteCarloPerformance() {
  const scenario = {
    name: "strategic-ambiguous-b",
    me: actor([2, 12], "right"), enemy: actor([11, 3], "down"),
    game: { map: makeMap(), star: [8, 10] }
  };
  function runSample(observations) {
    let last = null;
    const context = loadAgent();
    context.AT_ENEMY_OBSERVATIONS = observations;
    context.AT_ENEMY_COUNTS = { GO: 7, LEFT: 2, RIGHT: 2, FIRE: 3 };
    const start = performance.now();
    for (let repeat = 0; repeat < 20; repeat++) {
      last = decide(context, scenario);
    }
    return { elapsed: (performance.now() - start) / 20, last };
  }
  function summarize(samples, last) {
    samples.sort((a, b) => a - b);
    return {
      medianMsPerDecision: Number(samples[Math.floor(samples.length / 2)].toFixed(4)),
      minMsPerDecision: Number(samples[0].toFixed(4)),
      maxMsPerDecision: Number(samples[samples.length - 1].toFixed(4)),
      monteCarloUsed: last.monteCarloUsed,
      transitions: last.monteCarloTransitions
    };
  }
  const exactSamples = [];
  const hybridSamples = [];
  let exactLast = null;
  let hybridLast = null;
  for (let sample = 0; sample < 8; sample++) {
    const order = sample % 2 === 0 ? [0, 10] : [10, 0];
    for (const observations of order) {
      const result = runSample(observations);
      if (observations === 0) {
        exactSamples.push(result.elapsed);
        exactLast = result.last;
      } else {
        hybridSamples.push(result.elapsed);
        hybridLast = result.last;
      }
    }
  }
  return {
    exactOnly: summarize(exactSamples, exactLast),
    hybrid: summarize(hybridSamples, hybridLast)
  };
}

function superkoChecks() {
  const context = loadAgent();
  const map = makeMap();
  const game = { map, star: [13, 13] };
  const enemy = actor([13, 10], "right", {
    skill: { type: "stun", remainingCooldownFrames: 9 }
  });
  const previous = actor([6, 10], "right");
  const current = actor([6, 10], "up");

  context.beginHistoryFrame(previous, game);
  context.AT_ACTIVE_HISTORY_RECORD.totalValue = 100;
  context.beginHistoryFrame(current, game);
  const root = context.makeSearchState(current, enemy, game);
  context.captureHistoryEvaluation(root);
  const repeated = context.applyJointActions(root, "RIGHT", "LEFT", false);
  const fresh = context.applyJointActions(root, "LEFT", "LEFT", false);
  const fire = context.applyJointActions(root, "FIRE", "LEFT", false);
  if (repeated.repetitionPenalty !== 240) {
    throw new Error(`two-frame repeat penalty: expected 240, got ${repeated.repetitionPenalty}`);
  }
  if (fresh.repetitionPenalty !== 0) {
    throw new Error(`fresh state penalty: expected 0, got ${fresh.repetitionPenalty}`);
  }
  if (fire.repetitionPenalty !== 0) {
    throw new Error(`fire should not receive a one-frame repeat penalty, got ${fire.repetitionPenalty}`);
  }

  context.recentHistoryRecord(1).epoch = -1;
  const changedContext = context.applyJointActions(root, "RIGHT", "LEFT", false);
  if (changedContext.repetitionPenalty !== 120) {
    throw new Error(`cross-epoch repeat penalty: expected 120, got ${changedContext.repetitionPenalty}`);
  }

  const record = context.recentHistoryRecord(0);
  const componentNames = ["survival", "objective", "action", "projectile",
    "attack", "position", "status", "repetition"];
  if (!record.components || componentNames.some(name =>
      typeof record.components[name] !== "number")) {
    throw new Error("history score components were not captured");
  }
  return {
    repeatedPenalty: repeated.repetitionPenalty,
    freshPenalty: fresh.repetitionPenalty,
    firePenalty: fire.repetitionPenalty,
    crossEpochPenalty: changedContext.repetitionPenalty,
    componentNames
  };
}

function v13BehaviorChecks() {
  const scenario = cases()[1];
  const mobileContext = loadAgent();
  mobileContext.resetFrameCaches();
  const mobileState = mobileContext.makeSearchState(scenario.me,
    scenario.enemy, scenario.game);
  const mobileFire = mobileContext.fireUtility(mobileState, true);

  const stationaryContext = loadAgent();
  stationaryContext.AT_ENEMY_COUNTS = { GO: 1, LEFT: 18, RIGHT: 18, FIRE: 1 };
  stationaryContext.resetFrameCaches();
  const stationaryState = stationaryContext.makeSearchState(scenario.me,
    scenario.enemy, scenario.game);
  stationaryState.enemyStationaryStreak = 12;
  const stationaryFire = stationaryContext.fireUtility(stationaryState, true);
  if (!(stationaryFire < mobileFire * 0.25)) {
    throw new Error(`stationary intercept was not sufficiently reduced: ${mobileFire} -> ${stationaryFire}`);
  }

  const map = makeMap();
  const starGame = { map, star: [10, 10] };
  const stunMe = actor([10, 7], "down");
  const stunEnemy = actor([13, 11], "left");
  const stunState = stationaryContext.makeSearchState(stunMe, stunEnemy,
    starGame);
  stunState.enemyStationaryStreak = 12;
  if (stationaryContext.shouldConsiderStun(stunState)) {
    throw new Error("stationary non-threatening enemy should not be stunned");
  }

  const navContext = loadAgent();
  const navGame = { map, star: [6, 13] };
  const navEnemy = actor([13, 10], "up");
  const previous = actor([6, 10], "right");
  const current = actor([6, 10], "up");
  current.commands = [];
  current.go = function() { this.commands.push("GO"); };
  current.turn = function(direction) {
    this.commands.push(direction === "left" ? "LEFT" : "RIGHT");
  };
  current.fire = function() { this.commands.push("FIRE"); };
  current.stun = function() { this.commands.push("STUN"); };
  navContext.beginHistoryFrame(previous, navGame);
  navContext.beginHistoryFrame(current, navGame);
  const field = navContext.buildDistanceField(map, navGame.star);
  const first = navContext.stableStrategicStep(current.tank.position,
    [6, 11], field, map, navEnemy.tank.position);
  const retained = navContext.stableStrategicStep(current.tank.position,
    [5, 10], field, map, navEnemy.tank.position);
  if (retained[0] !== first[0] || retained[1] !== first[1]) {
    throw new Error("strategic direction was not retained within the same cell");
  }
  navContext.faceOrMove(current, navEnemy, navGame, retained, field);
  if (current.commands[0] !== "LEFT") {
    throw new Error(`navigation superko expected LEFT, got ${current.commands[0]}`);
  }

  return {
    mobileFire,
    stationaryFire,
    stationaryScale: Number((stationaryFire / mobileFire).toFixed(4)),
    retainedStep: retained,
    navigationAction: current.commands[0]
  };
}

function failureRegressionChecks() {
  const terminalContext = loadAgent();
  const map = makeMap();
  const terminalGame = { map, star: null, bombs: [], frames: 27 };
  function deadState(myStars, enemyStars) {
    const state = terminalContext.makeSearchState(
      actor([7, 7], "right", { stars: myStars }),
      actor([8, 7], "left", { stars: enemyStars }), terminalGame);
    state.myDead = true;
    state.enemyDead = true;
    return state;
  }
  const behindTrade = terminalContext.evaluateState(deadState(0, 1));
  const aheadTrade = terminalContext.evaluateState(deadState(1, 0));
  const tiedTrade = terminalContext.evaluateState(deadState(0, 0));
  if (behindTrade !== -terminalContext.AT_TERMINAL_SCORE ||
      aheadTrade !== terminalContext.AT_TERMINAL_SCORE ||
      tiedTrade !== terminalContext.AT_TIED_MUTUAL_DEATH_SCORE) {
    throw new Error(`star-aware mutual death is incorrect: ${behindTrade}, ${aheadTrade}, ${tiedTrade}`);
  }
  if (!terminalContext.stateIsLosingTerminal(deadState(0, 1)) ||
      !terminalContext.stateIsLosingTerminal(deadState(0, 0)) ||
      terminalContext.stateIsLosingTerminal(deadState(1, 0))) {
    throw new Error("root safety must reject mutual death unless we lead on stars");
  }

  const duelRaw = "xxxxxxxxxxxxxxxxxxx|x..........x...xxxx|x.a............xxmx|x.............xxxxx|x..oxx.........o..x|x..o..............x|x.................x|x..x.o.......o.x..x|x.................x|x..............o..x|x..o.........xxo..x|xxxxx.............x|xmxx............C.x|xxxx...x..........x|xxxxxxxxxxxxxxxxxxx";
  const duelMap = mapFromReplayRaw(duelRaw);
  const duelContext = loadAgent();
  const duelMe = actor([13, 2], "up", {
    stars: 0, skill: { type: "stun", remainingCooldownFrames: 6 }
  });
  const duelEnemy = actor([14, 2], "down", {
    stars: 1, skill: { type: "freeze", remainingCooldownFrames: 20 }
  });
  const duel = decide(duelContext, {
    me: duelMe, enemy: duelEnemy,
    game: { map: duelMap, star: null, bombs: [], frames: 26 }
  });
  if (duel.action !== "GO") {
    throw new Error(`behind-star duel must avoid mutual aim with GO, got ${duel.action}`);
  }

  // mat_8Lb9U23U5swBHv19E frame 58: while trailing 1-2, RIGHT lets one
  // possible reversal of the stunned opponent create an adjacent mutual-fire
  // loss next frame. GO leaves the contact lane and must remain safe.
  const meteorRaw = "xxxxxxxxxxxxxxxxxxx|x...x.......o.om..x|x..........xx.....x|x......o....xoomm.x|x......o....m...x.x|x.m.........m.m.x.x|xo...........o....x|x.....o.....o.....x|x....o...........ox|x.x.m.m.........m.x|x.x...m....o......x|x.mmoox....o......x|x.....xx..........x|x..mo.o.......x...x|xxxxxxxxxxxxxxxxxxx";
  const meteorMap = mapFromReplayRaw(meteorRaw);
  const meteorMe = actor([9, 6], "up", {
    stars: 1, skill: { type: "stun", remainingCooldownFrames: 20 }
  });
  const meteorEnemy = actor([10, 6], "down", {
    stars: 2,
    status: { stunned: true },
    effects: { debuff: { type: "stun", remainingFrames: 6 } },
    skill: { type: "teleport", remainingCooldownFrames: 24 }
  });
  const meteorGame = {
    map: meteorMap, star: [10, 12], bombs: [], frames: 58
  };
  const meteorState = terminalContext.makeSearchState(meteorMe,
    meteorEnemy, meteorGame);
  if (!terminalContext.stunnedContactForcesUnfavorableTrade(
        meteorState, "RIGHT") ||
      terminalContext.stunnedContactForcesUnfavorableTrade(
        meteorState, "GO")) {
    throw new Error("Meteor stunned-contact trap classification is wrong");
  }
  const meteorContext = loadAgent();
  const meteorRuntimeMe = recordActions(meteorMe);
  meteorContext.onIdle(meteorRuntimeMe, meteorEnemy, meteorGame);
  const meteorAction = meteorRuntimeMe.commands[0];
  if (meteorAction !== "GO") {
    throw new Error(`Meteor 1-2 contact must disengage with GO, got ${meteorAction}`);
  }

  // mat_KpE7l2dniRDEzG0bf frame 26: GO enters [13,8] with a wall
  // directly ahead. The ordinary opponent simultaneously turns right and
  // can FIRE from [12,8] next frame; every reply dies. Remaining in [13,9]
  // keeps a lateral escape and must not be hard-filtered.
  const kpRaw = "xxxxxxxxxxxxxxxxxxx|x.........xx.....xx|x................xx|x..........x......x|x..x...........xxxx|x..........oox....x|x...m..........m..x|x.momxx....oxxmom.x|x..m..........m...x|x....xoo..........x|xxxx...........x..x|x......x..........x|xx................x|xx.....xx.........x|xxxxxxxxxxxxxxxxxxx";
  const kpContext = loadAgent();
  const kpState = kpContext.makeSearchState(
    actor([13, 9], "up", {
      stars: 0, skill: { type: "stun", remainingCooldownFrames: 2 }
    }),
    actor([12, 8], "down", {
      stars: 2, skill: { type: "teleport", remainingCooldownFrames: 18 }
    }),
    { map: mapFromReplayRaw(kpRaw), star: null, bombs: [], frames: 25 });
  if (!kpContext.ordinaryTurnThenFireForcesLoss(kpState, "GO") ||
      kpContext.ordinaryTurnThenFireForcesLoss(kpState, "LEFT")) {
    throw new Error("Kp close turn-then-fire dead-end classification is wrong");
  }
  const kpAction = kpContext.chooseTacticalAction(kpState,
    kpContext.tacticalSearchRounds(kpState));
  if (kpAction === "GO") {
    throw new Error("Kp frame 26 must reject GO into the ordinary FIRE trap");
  }

  // mat_HziASMvWojpJnX3mi frame 23 is the star-leading counterpart.
  // A favorable mutual trade is allowed elsewhere, but GO to [14,3] is not
  // mutual: our barrel points into a wall while the enemy turns up and gets
  // an unavoidable two-tile shot.
  const hziRaw = "xxxxxxxxxxxxxxxxxxx|xx............o.o.x|x....x......o.mm..x|x...........x..xx.x|x..x..mm...mx..xx.x|x.........mm......x|x.................x|xm.o..o.....o..o.mx|x.................x|x......mm.........x|x.xx..xm...mm..x..x|x.xx..x...........x|x..mm.o......x....x|x.o.o............xx|xxxxxxxxxxxxxxxxxxx";
  const hziContext = loadAgent();
  const hziState = hziContext.makeSearchState(
    actor([13, 3], "right", {
      stars: 1, skill: { type: "stun", remainingCooldownFrames: 9 }
    }),
    actor([14, 5], "right", {
      stars: 0, skill: { type: "shield", remainingCooldownFrames: 5 }
    }),
    { map: mapFromReplayRaw(hziRaw), star: null, bombs: [], frames: 22 });
  if (!hziContext.ordinaryTurnThenFireForcesLoss(hziState, "GO") ||
      hziContext.ordinaryTurnThenFireForcesLoss(hziState, "RIGHT")) {
    throw new Error("Hzi close turn-then-fire dead-end classification is wrong");
  }
  const hziAction = hziContext.chooseTacticalAction(hziState,
    hziContext.tacticalSearchRounds(hziState));
  if (hziAction === "GO") {
    throw new Error("Hzi frame 23 must reject GO into the ordinary FIRE trap");
  }

  // Exact tactical regression for mat_K804TZyB9fYJQae6s. At frame 26 tiny
  // tank led 1-0, and at frame 27 both tanks were aimed down the same clear
  // column with equal projectile arrival time. A mutual destruction is a win
  // for the star leader, so the direct initiative guard must prefer FIRE.
  const favorableTradeRaw = "xxxxxxxxxxxxxxxxxxx|x...o...........mmx|x.a.......oo......x|x....x.....x.m....x|x....x.x..........x|x.................x|x......x....xx....x|x..oo......o..oo..x|x....xx...xx......x|x.................x|x..........x.x....x|x....m.x.....x....x|x......oo.......C.x|xmm...........o...x|xxxxxxxxxxxxxxxxxxx";
  const favorableTradeMap = mapFromReplayRaw(favorableTradeRaw);
  const favorableTradeContext = loadAgent();
  const favorableTurn = favorableTradeContext.winningAttackAction(
    actor([14, 2], "right", {
      stars: 1, skill: { type: "stun", remainingCooldownFrames: 10 }
    }),
    actor([14, 7], "left", {
      stars: 0, skill: { type: "freeze", remainingCooldownFrames: 10 }
    }),
    { map: favorableTradeMap, star: null, bombs: [], frames: 26 });
  if (favorableTurn !== "RIGHT") {
    throw new Error(`star-leading equal-arrival trade must aim first, got ${favorableTurn}`);
  }

  const favorableFire = favorableTradeContext.winningAttackAction(
    actor([14, 2], "down", {
      stars: 1, skill: { type: "stun", remainingCooldownFrames: 10 }
    }),
    actor([14, 7], "up", {
      stars: 0, skill: { type: "freeze", remainingCooldownFrames: 10 }
    }),
    { map: favorableTradeMap, star: null, bombs: [], frames: 27 });
  if (favorableFire !== "FIRE") {
    throw new Error(`star-leading equal-arrival trade must FIRE, got ${favorableFire}`);
  }

  const tiedTradeGuard = favorableTradeContext.winningAttackAction(
    actor([14, 2], "down", { stars: 0 }),
    actor([14, 7], "up", {
      stars: 0, skill: { type: "freeze", remainingCooldownFrames: 10 }
    }),
    { map: favorableTradeMap, star: null, bombs: [], frames: 27 });
  if (tiedTradeGuard !== null) {
    throw new Error(`equal-arrival trade without a star lead must remain optional, got ${tiedTradeGuard}`);
  }

  const hiddenRaw = "xxxxxxxxxxxxxxxxxxx|xo.........x...mx.x|x.a..oxxx.....o...x|x....o.x.....m.m..x|x...........xm....x|x.........oo......x|x.....oo....xx....x|x...oo.....o.oo...x|x....xx....oo.....x|x......oo.........x|x....mx...........x|x..m.m.....x.o....x|x...o.....xxxo..C.x|x.xm...x.........ox|xxxxxxxxxxxxxxxxxxx";
  const hiddenMap = mapFromReplayRaw(hiddenRaw);
  const hiddenContext = loadAgent();
  const visibleMe = actor([3, 12], "right", {
    stars: 1, skill: { type: "stun", remainingCooldownFrames: 8 }
  });
  const visibleEnemy = actor([4, 11], "down", {
    skill: { type: "freeze", remainingCooldownFrames: 20 }
  });
  hiddenContext.observeEnemyBehavior(visibleMe, visibleEnemy,
    { map: hiddenMap, frames: 23 });
  const hiddenEnemy = actor([4, 12], "down", {
    skill: { type: "freeze", remainingCooldownFrames: 20 }
  });
  hiddenEnemy.tank = null;
  const hiddenMe = recordActions(actor([3, 12], "right", {
    stars: 1, skill: { type: "stun", remainingCooldownFrames: 7 }
  }));
  hiddenContext.onIdle(hiddenMe, hiddenEnemy,
    { map: hiddenMap, star: null, bombs: [], frames: 24 });
  const inferred = hiddenContext.probableHiddenEnemyPosition();
  if (hiddenMe.commands[0] !== "FIRE" || !inferred ||
      inferred[0] !== 4 || inferred[1] !== 12) {
    throw new Error(`adjacent grass disappearance must blind FIRE at 4,12; action=${hiddenMe.commands[0]}, inferred=${inferred}`);
  }

  const blockedContext = loadAgent();
  blockedContext.observeEnemyBehavior(visibleMe, visibleEnemy,
    { map: hiddenMap, frames: 23 });
  const unavailableMe = recordActions(actor([3, 12], "right", {
    stars: 1,
    bullet: { position: [8, 8], direction: "right" },
    skill: { type: "stun", remainingCooldownFrames: 7 }
  }));
  blockedContext.onIdle(unavailableMe, hiddenEnemy,
    { map: hiddenMap, star: null, bombs: [], frames: 24 });
  if (unavailableMe.commands[0] === "GO") {
    throw new Error("probable hidden enemy tile must block navigation GO");
  }

  const bombRaw = "xxxxxxxxxxxxxxxxxxx|x....xoo......o...x|x.a..x......xo....x|x...m........oo...x|x...m.........o...x|x.m...oo...xxx....x|x.m..o......xx....x|x.o........o....o.x|x....xx......o..m.x|x....xxx...oo...m.x|x...o.........m...x|x...oo........m...x|x....ox......x..C.x|x...o......oox....x|xxxxxxxxxxxxxxxxxxx";
  const bombMap = mapFromReplayRaw(bombRaw);
  const bombContext = loadAgent();
  const bombMe = recordActions(actor([10, 11], "up", {
    skill: { type: "stun", remainingCooldownFrames: 10 }
  }));
  const bombEnemy = actor([8, 10], "down", {
    stars: 1, skill: { type: "freeze", remainingCooldownFrames: 10 }
  });
  bombContext.onIdle(bombMe, bombEnemy, {
    map: bombMap, star: [5, 13], frames: 34,
    bombs: [{ by: 0, position: [8, 10], placedFrame: 24,
      explodeFrame: 34 }]
  });
  if (bombMe.commands[0] === "GO") {
    throw new Error("v15 must not replay the frame-34 move into bomb blast");
  }

  // Exact regression for mat_1BxFCwFBX5h7HZSCC. At the start of frame 12
  // the bullet is visible at [8,7]; after our turn it advances to [10,7] but
  // falls outside the new downward vision cone. Frame 13 must extrapolate it
  // and complete TURN -> GO instead of turning back into the firing line.
  const dodgeRaw = "xxxxxxxxxxxxxxxxxxx|x..........o....m.x|x.a........xx.....x|x...........xm...mx|x...........xmx...x|x...ox......xoox..x|x...o.............x|x..........o......x|x.............o...x|x..xoox......xo...x|x...xmx...........x|xm...mx...........x|x.....xx........C.x|x.m....o..........x|xxxxxxxxxxxxxxxxxxx";
  const dodgeMap = mapFromReplayRaw(dodgeRaw);
  const dodgeContext = loadAgent();
  const frame12Me = recordActions(actor([13, 7], "left", {
    skill: { type: "stun", remainingCooldownFrames: 9 }
  }));
  const frame12Enemy = actor([5, 7], "right", {
    bullet: { position: [8, 7], direction: "right" },
    skill: { type: "freeze", remainingCooldownFrames: 20 }
  });
  dodgeContext.onIdle(frame12Me, frame12Enemy, {
    map: dodgeMap, star: [9, 7], bombs: [], frames: 12
  });
  if (frame12Me.commands[0] !== "LEFT") {
    throw new Error(`visible long shot must begin lateral dodge with LEFT, got ${frame12Me.commands[0]}`);
  }

  const frame13Me = recordActions(actor([13, 7], "down", {
    skill: { type: "stun", remainingCooldownFrames: 8 }
  }));
  const frame13Enemy = actor([6, 7], "right", {
    skill: { type: "freeze", remainingCooldownFrames: 19 }
  });
  dodgeContext.onIdle(frame13Me, frame13Enemy, {
    map: dodgeMap, star: [9, 7], bombs: [], frames: 13
  });
  const ghost = dodgeContext.AT_ENEMY_PROJECTILE_TRACK;
  if (frame13Me.commands[0] !== "GO" || !ghost ||
      ghost.position[0] !== 10 || ghost.position[1] !== 7) {
    throw new Error(`hidden projectile must remain tracked at 10,7 and force GO; action=${frame13Me.commands[0]}, ghost=${JSON.stringify(ghost)}`);
  }

  const visibleDodgeContext = loadAgent();
  const visibleFrame13Me = recordActions(actor([13, 7], "down"));
  const visibleFrame13Enemy = actor([6, 7], "right", {
    bullet: { position: [10, 7], direction: "right" }
  });
  visibleDodgeContext.onIdle(visibleFrame13Me, visibleFrame13Enemy, {
    map: dodgeMap, star: [9, 7], bombs: [], frames: 13
  });
  if (visibleFrame13Me.commands[0] !== "GO") {
    throw new Error(`visible frame-13 projectile must force GO, got ${visibleFrame13Me.commands[0]}`);
  }

  const lethalContext = loadAgent();
  lethalContext.resetFrameCaches();
  const lethalState = lethalContext.makeSearchState(
    actor([13, 7], "left"),
    actor([7, 7], "right", {
      bullet: { position: [12, 7], direction: "right" }
    }),
    { map: dodgeMap, star: [9, 7], bombs: [], frames: 14 });
  const lethalActions = ["GO", "FIRE", "STUN", "LEFT", "RIGHT"];
  const lethalValues = {};
  for (const action of lethalActions) {
    const next = lethalContext.applyJointActions(lethalState, action,
      "LEFT", false);
    lethalValues[action] = lethalContext.evaluateState(next);
    if (!next.myDead || lethalValues[action] !==
        -lethalContext.AT_TERMINAL_SCORE) {
      throw new Error(`adjacent projectile must make ${action} terminal: dead=${next.myDead}, value=${lethalValues[action]}`);
    }
  }

  const deadlineThreat = lethalContext.projectileThreat(
    { position: [12, 7], direction: "right", damage: 1, observed: true },
    [13, 7], "down", 1, dodgeMap);
  if (deadlineThreat !== 35000) {
    throw new Error(`exact projectile escape deadline expected 35000, got ${deadlineThreat}`);
  }

  return {
    behindTrade,
    aheadTrade,
    tiedTrade,
    favorableTradeTurn: favorableTurn,
    favorableTradeAction: favorableFire,
    tiedTradeGuard,
    behindDuelAction: duel.action,
    meteorAction,
    ordinaryTurnThenFire: { kpAction, hziAction },
    hiddenAction: hiddenMe.commands[0],
    hiddenPosition: inferred,
    blockedFallback: unavailableMe.commands[0],
    bombFrame34Action: bombMe.commands[0],
    visibleDodgeAction: visibleFrame13Me.commands[0],
    hiddenDodgeAction: frame13Me.commands[0],
    hiddenProjectile: ghost && ghost.position,
    deadlineThreat,
    lethalValues
  };
}

function batchRiskRegressionChecks() {
  const context = loadAgent();
  const map = makeMap();
  const game = { map, star: [2, 2], bombs: [], frames: 40 };

  const crossingMe = actor([8, 3], "up", { stars: 1 });
  const crossingEnemy = actor([2, 2], "right", {
    bullet: { position: [6, 2], direction: "right" }
  });
  const crossingAction = context.saferRuntimeAction(crossingMe,
    crossingEnemy, game, "GO");
  if (crossingAction === "GO") {
    throw new Error("future bullet intersection must reject GO into [8,2]");
  }

  const inFlightMe = actor([8, 5], "up", { stars: 3 });
  const inFlightEnemy = actor([2, 5], "right", {
    bullet: { position: [6, 5], direction: "right" }
  });
  const inFlightAction = context.saferRuntimeAction(inFlightMe,
    inFlightEnemy, game, "LEFT");
  if (inFlightAction !== "GO") {
    throw new Error(`in-flight projectile must keep moving out of lane, got ${inFlightAction}`);
  }

  const diagonalEntryAction = context.saferRuntimeAction(
    actor([10, 10], "up"), actor([11, 9], "left"), game, "GO");
  if (diagonalEntryAction === "GO") {
    throw new Error("muzzle endpoint guard must reject diagonal GO into [10,9]");
  }

  const adjacentAction = context.saferRuntimeAction(
    actor([6, 8], "right"), actor([6, 9], "up"), game, "LEFT");
  if (adjacentAction !== "GO") {
    throw new Error(`adjacent aimed muzzle must escape laterally, got ${adjacentAction}`);
  }

  const boostedAction = context.saferRuntimeAction(
    actor([6, 10], "left"), actor([6, 7], "down", {
      status: { boosted: true },
      effects: { self: { remainingFrames: 3 } },
      skill: { type: "boost", remainingCooldownFrames: 10 }
    }), game, "RIGHT");
  if (boostedAction !== "GO") {
    throw new Error(`boosted three-tile muzzle must prefer immediate lateral GO, got ${boostedAction}`);
  }

  const frozenAction = context.saferRuntimeAction(
    actor([6, 8], "right"), actor([6, 9], "up", {
      status: { frozen: true, canActThisFrame: false }
    }), game, "LEFT");
  if (frozenAction !== "LEFT") {
    throw new Error(`inactive frozen enemy must not force a false dodge, got ${frozenAction}`);
  }

  const favorableFire = context.saferRuntimeAction(
    actor([8, 5], "right", { stars: 1 }),
    actor([9, 5], "left", { stars: 0 }), game, "FIRE");
  if (favorableFire !== "FIRE") {
    throw new Error(`star-leading immediate mutual hit must retain FIRE, got ${favorableFire}`);
  }

  const beliefContext = loadAgent();
  const visibleMe = actor([13, 7], "left");
  const visibleEnemy = actor([12, 7], "right");
  beliefContext.observeEnemyBehavior(visibleMe, visibleEnemy,
    { map, star: [14, 7], bombs: [], frames: 33 });
  const hiddenEnemy = actor([12, 7], "right");
  hiddenEnemy.tank = null;
  const turnedMe = actor([13, 7], "down");
  beliefContext.observeEnemyBehavior(turnedMe, hiddenEnemy,
    { map, star: [14, 7], bombs: [], frames: 34 });
  const hiddenAction = beliefContext.saferRuntimeAction(turnedMe,
    hiddenEnemy, { map, star: [14, 7], bombs: [], frames: 34 }, "LEFT");
  if (hiddenAction !== "GO" ||
      !beliefContext.AT_HIDDEN_ENEMY_BELIEF.some(c =>
        c.position[0] === 12 && c.position[1] === 7)) {
    throw new Error(`turning away must retain rear muzzle belief and GO out; action=${hiddenAction}`);
  }

  // mat_I1nyxXinVhs2ot1n2: KANE cloaked on frame 11, advanced, turned
  // left, and fired from [10,8] as cloak expired. The old three-frame FIFO
  // belief discarded this legal path before tiny tank entered [8,8].
  const cloakRaw = "xxxxxxxxxxxxxxxxxxx|x..........x..oo..x|x.a....m...x......x|x......m....xx....x|x...o.............x|x...o..mm.........x|x..x.x........xm..x|xo.mo.m....mm.om.ox|x..mx........x.x..x|x.........mm..o...x|x.............o...x|x....xx....m......x|x......x...m....C.x|x..oo..x..........x|xxxxxxxxxxxxxxxxxxx";
  const cloakMap = mapFromReplayRaw(cloakRaw);
  const cloakContext = loadAgent();
  cloakContext.observeEnemyBehavior(actor([6, 6], "right"),
    actor([12, 10], "up"),
    { map: cloakMap, star: [8, 8], bombs: [], frames: 10 });
  // Frame 11 is the CLOAK cast itself and preserves the last visible pose;
  // frames 12-16 are the five hidden action windows.
  const cloakPositions = [[6, 6], [7, 6], [8, 6], [8, 7], [8, 8], [8, 8]];
  const cloakDirections = ["right", "right", "right", "down", "down", "left"];
  let cloakedEnemy;
  let cloakMe;
  for (let frame = 0; frame < cloakPositions.length; frame++) {
    cloakMe = actor(cloakPositions[frame], cloakDirections[frame]);
    cloakedEnemy = actor([0, 0], "up", {
      status: { cloaked: true },
      effects: { self: { type: "cloak", remainingFrames: 6 - frame } },
      skill: { type: "cloak", remainingCooldownFrames: 20 }
    });
    cloakedEnemy.tank = null;
    cloakContext.observeEnemyBehavior(cloakMe, cloakedEnemy,
      { map: cloakMap, star: [8, 8], bombs: [], frames: 11 + frame });
  }
  const cloakPathRetained = cloakContext.AT_HIDDEN_ENEMY_BELIEF.some(c =>
    c.position[0] === 10 && c.position[1] === 8 && c.direction === "left");
  const cloakEscape = cloakContext.saferRuntimeAction(cloakMe,
    cloakedEnemy,
    { map: cloakMap, star: null, bombs: [], frames: 16 }, "LEFT");
  if (cloakContext.AT_HIDDEN_ENEMY_MODE !== 1 || !cloakPathRetained ||
      cloakEscape !== "GO") {
    throw new Error(`cloak expiry prediction failed: mode=${cloakContext.AT_HIDDEN_ENEMY_MODE}, retained=${cloakPathRetained}, action=${cloakEscape}`);
  }

  const grassContext = loadAgent();
  const grassMap = makeMap();
  const grassMe = actor([3, 6], "right");
  grassContext.observeEnemyBehavior(grassMe, actor([6, 6], "right"),
    { map: grassMap, star: null, bombs: [], frames: 8 });
  const grassEnemy = actor([0, 0], "right");
  grassEnemy.tank = null;
  grassContext.observeEnemyBehavior(grassMe, grassEnemy,
    { map: grassMap, star: null, bombs: [], frames: 9 });
  const grassPathRetained = grassContext.AT_HIDDEN_ENEMY_BELIEF.some(c =>
    c.position[0] === 7 && c.position[1] === 6);
  if (grassContext.AT_HIDDEN_ENEMY_MODE !== 2 || !grassPathRetained) {
    throw new Error(`grass-only prediction branch failed: mode=${grassContext.AT_HIDDEN_ENEMY_MODE}, retained=${grassPathRetained}`);
  }

  // Once the bounded seven-frame grass beam expires, keep the connected
  // grass component as a cheap long-term muzzle region. This avoids assuming
  // an old exact pose while still refusing to remain on any open firing lane
  // emerging from that component.
  grassContext.AT_HIDDEN_ENEMY_AGE =
    grassContext.AT_HIDDEN_SPECIAL_MAX_AGE;
  grassContext.updateHiddenEnemyBelief(grassMe, grassEnemy,
    { map: grassMap, star: null, bombs: [], frames: 16 }, 16);
  const grassRegionBuilt = !!grassContext.AT_HIDDEN_GRASS_REGION;
  const grassLaneRisk = grassContext.runtimeGrassRegionMuzzleRisk(
    [7, 3], "up", 1, grassMap);
  const grassTurnRisk = grassContext.runtimeGrassRegionMuzzleRisk(
    [7, 3], "right", 1, grassMap);
  if (!grassRegionBuilt || grassLaneRisk < 35000 ||
      grassTurnRisk >= 35000) {
    throw new Error(`expired grass region risk is incorrect: built=${grassRegionBuilt}, lane=${grassLaneRisk}, turn=${grassTurnRisk}`);
  }

  // mat_6hSOGi1zCYcgvv5LW: stun reversed GO into the enemy's adjacent muzzle.
  // The runtime guard must score both the requested and reversed poses.
  const stunMap = makeMap();
  const stunnedMe = actor([14, 10], "left", {
    status: { stunned: true },
    effects: { debuff: { remainingFrames: 3 } }
  });
  const stunEnemy = actor([15, 9], "down");
  const stunnedGame = {
    map: stunMap, star: null, bombs: [], frames: 22
  };
  const stunnedReverseRisk = context.runtimeActionRisk(stunnedMe,
    stunEnemy, stunnedGame, "GO", null, null);
  const stunnedSafeAction = context.saferRuntimeAction(stunnedMe,
    stunEnemy, stunnedGame, "GO");
  if (stunnedReverseRisk < context.AT_TERMINAL_SCORE ||
      stunnedSafeAction === "GO") {
    throw new Error(`stun-reversed muzzle entry was not rejected: risk=${stunnedReverseRisk}, action=${stunnedSafeAction}`);
  }

  // The final runtime layer used to bypass search/history and could sustain
  // 95+ alternating turns. A fourth safe turn request must yield to GO, but
  // only when the forward pose is below the hard danger threshold.
  const lockContext = loadAgent();
  lockContext.AT_TURN_STREAK = 3;
  lockContext.AT_LAST_ACTION = "LEFT";
  const lockAction = lockContext.saferRuntimeAction(
    actor([5, 12], "right"), actor([13, 3], "left"),
    { map: makeMap(), star: [10, 12], bombs: [], frames: 60 }, "RIGHT");
  if (lockAction !== "GO") {
    throw new Error(`fourth safe turn must break the lock with GO, got ${lockAction}`);
  }
  const unsafeLockContext = loadAgent();
  unsafeLockContext.AT_TURN_STREAK = 3;
  unsafeLockContext.AT_LAST_ACTION = "LEFT";
  const unsafeLockAction = unsafeLockContext.saferRuntimeAction(
    actor([6, 8], "right"), actor([7, 7], "down"),
    { map: makeMap(), star: null, bombs: [], frames: 60 }, "RIGHT");
  if (unsafeLockAction === "GO") {
    throw new Error("turn-lock breaker must not enter an adjacent muzzle");
  }

  // Low-confidence predictive fire must not replace a contested-star route
  // while tied/behind. Exact line fire remains above the higher threshold.
  const starContext = loadAgent();
  const starState = starContext.makeSearchState(
    actor([2, 2], "right"), actor([12, 12], "left", { stars: 1 }),
    { map: makeMap(), star: [5, 2], bombs: [], frames: 8 });
  starState._myFireUtility = 80;
  const lowConfidenceActions = starContext.tacticalActions(starState, true);
  if (lowConfidenceActions.includes("FIRE")) {
    throw new Error("low-confidence fire displaced a contested-star route");
  }
  const exactFireState = starContext.makeSearchState(
    actor([2, 2], "right"), actor([6, 2], "left", { stars: 1 }),
    { map: makeMap(), star: [5, 3], bombs: [], frames: 8 });
  const exactFireActions = starContext.tacticalActions(exactFireState, true);
  if (!exactFireActions.includes("FIRE")) {
    throw new Error("higher star threshold incorrectly removed exact line fire");
  }

  const repeatMap = makeMap();
  repeatMap[12][3] = "x";
  const repeatState = context.makeSearchState(
    actor([12, 5], "up"), actor([10, 4], "right"),
    { map: repeatMap, star: [12, 4], bombs: [], frames: 23 });
  repeatState.lastMyAction = "FIRE";
  repeatState.myCanFire = true;
  const repeatUtility = context.fireUtility(repeatState, true);
  if (repeatUtility !== -Infinity) {
    throw new Error(`same-state repeated wall FIRE must be pruned, got ${repeatUtility}`);
  }

  return {
    crossingAction,
    inFlightAction,
    diagonalEntryAction,
    adjacentAction,
    boostedAction,
    frozenAction,
    favorableFire,
    hiddenAction,
    hiddenBeliefs: beliefContext.AT_HIDDEN_ENEMY_BELIEF.length,
    cloakPathRetained,
    cloakEscape,
    grassPathRetained,
    grassRegionBuilt,
    grassLaneRisk,
    grassTurnRisk,
    stunnedReverseRisk,
    stunnedSafeAction,
    lockAction,
    unsafeLockAction,
    lowConfidenceFirePruned: !lowConfidenceActions.includes("FIRE"),
    exactFireRetained: exactFireActions.includes("FIRE"),
    repeatUtility: String(repeatUtility)
  };
}

function cloakRedesignRegressionChecks() {
  function hiddenCloakEnemy(remaining, stars = 0) {
    const enemy = actor([0, 0], "up", {
      stars,
      status: { cloaked: true },
      effects: { self: { type: "cloak", remainingFrames: remaining } },
      skill: {
        type: "cloak", remainingCooldownFrames: 29 + remaining,
        activeType: "cloak", activeRemainingFrames: remaining
      }
    });
    enemy.tank = null;
    return enemy;
  }

  // Exact six-frame reachability: the cast frame preserves the last pose,
  // then five ordinary action windows are expanded without a Top-8 beam.
  const exactContext = loadAgent();
  const exactMap = makeMap();
  exactContext.observeEnemyBehavior(actor([3, 3], "right"),
    actor([12, 12], "left", {
      skill: { type: "cloak", remainingCooldownFrames: 0 }
    }), { map: exactMap, star: null, bombs: [], frames: 10 });
  const exactCounts = [];
  for (let remaining = 6; remaining >= 1; remaining--) {
    exactContext.observeEnemyBehavior(actor([3, 3], "right"),
      hiddenCloakEnemy(remaining), {
        map: exactMap, star: null, bombs: [], frames: 17 - remaining
      });
    exactCounts.push(exactContext.AT_HIDDEN_ENEMY_BELIEF.length);
  }
  if (exactCounts[0] !== 1 || exactCounts[5] <= 8 ||
      exactContext.AT_HIDDEN_ENEMY_BELIEF.length >
        exactMap.length * exactMap[0].length * 4) {
    throw new Error(`cloak reachability is not exact and bounded: ${exactCounts}`);
  }
  const cloakBenchmarkEnemy = hiddenCloakEnemy(1);
  const cloakBenchmarkMe = actor([3, 3], "right");
  const cloakBenchmarkGame = {
    map: exactMap, star: null, bombs: [], frames: 16
  };
  const cloakBenchmarkIterations = 200;
  const cloakBenchmarkStarted = performance.now();
  for (let iteration = 0; iteration < cloakBenchmarkIterations; iteration++) {
    exactContext.saferRuntimeAction(cloakBenchmarkMe, cloakBenchmarkEnemy,
      cloakBenchmarkGame, "GO");
  }
  const cloakGuardMicros = (performance.now() - cloakBenchmarkStarted) *
    1000 / cloakBenchmarkIterations;
  if (cloakGuardMicros > 5000) {
    throw new Error(`bounded cloak guard is too slow: ${cloakGuardMicros}us`);
  }

  // mat_DA3ZiBD0kSZFpkifp frames 98-103: the true [16,6]/right pose remains
  // possible. GO is a hard hidden occupancy collision, while a 2-1 lead makes
  // the adjacent mutual-shot FIRE the winning action.
  const daRaw = "xxxxxxxxxxxxxxxxxxx|xooo..............x|xoax.....x........x|xxxx.....x........x|x........x........x|x..xxxxxxxxxxx....x|x....ooxoooooo....x|x....ooooooooo....x|x....ooooooxoo....x|x....xxxxxxxxxxx..x|x........x........x|x........x.....xxxx|x........x.....xCox|x..............ooox|xxxxxxxxxxxxxxxxxxx";
  const daMap = mapFromReplayRaw(daRaw);
  const daContext = loadAgent();
  daContext.observeEnemyBehavior(actor([17, 6], "down", { stars: 2 }),
    actor([16, 7], "right", {
      stars: 1, skill: { type: "cloak", remainingCooldownFrames: 0 }
    }), { map: daMap, star: null, bombs: [], frames: 98 });
  const daDirections = ["down", "right", "up", "left"];
  let daEnemy;
  for (let index = 0; index < daDirections.length; index++) {
    daEnemy = hiddenCloakEnemy(6 - index, 1);
    daContext.observeEnemyBehavior(
      actor([17, 6], daDirections[index], { stars: 2 }), daEnemy,
      { map: daMap, star: null, bombs: [], frames: 99 + index });
  }
  const daTruePose = daContext.AT_HIDDEN_ENEMY_BELIEF.some(candidate =>
    candidate.position[0] === 16 && candidate.position[1] === 6 &&
    candidate.direction === "right");
  const daMe = recordActions(actor([17, 6], "left", { stars: 2 }));
  const daGame = { map: daMap, star: null, bombs: [], frames: 102 };
  const daGoPose = daContext.runtimeActionPose(daMe, daEnemy, daGame, "GO");
  const daGoRisk = daContext.runtimeActionRisk(daMe, daEnemy, daGame,
    "GO", null, null, daGoPose, null);
  daContext.onIdle(daMe, daEnemy, daGame);
  if (!daTruePose || daGoRisk < daContext.AT_TERMINAL_SCORE ||
      daMe.commands[0] !== "FIRE") {
    throw new Error(`DA cloak contact not solved: retained=${daTruePose}, goRisk=${daGoRisk}, action=${daMe.commands[0]}`);
  }

  // mat_JdbjzgP6Old8SF0k7: after the first hidden GO, a turn now and lateral
  // GO next frame survives the possible RIGHT -> FIRE preparation. Continuing
  // right eventually creates the invisible [6,2]/right projectile hypothesis.
  const jdbRaw = "xxxxxxxxxxxxxxx|xa...........Bx|x.............x|x....ooooo....x|x.............x|x.....xxx.....x|x.............x|x....ooooo....x|x.............x|xC...........dx|xxxxxxxxxxxxxxx";
  const jdbMap = mapFromReplayRaw(jdbRaw);
  const jdbContext = loadAgent();
  jdbContext.observeEnemyBehavior(actor([5, 2], "down"),
    actor([4, 3], "up", {
      skill: { type: "cloak", remainingCooldownFrames: 0 }
    }), { map: jdbMap, star: null, bombs: [], frames: 26 });
  jdbContext.observeEnemyBehavior(actor([5, 2], "down"),
    hiddenCloakEnemy(6),
    { map: jdbMap, star: null, bombs: [], frames: 27 });
  const jdbEnemy = hiddenCloakEnemy(5);
  const jdbMe = actor([5, 2], "right");
  const jdbGame = { map: jdbMap, star: null, bombs: [], frames: 28 };
  jdbContext.observeEnemyBehavior(jdbMe, jdbEnemy, jdbGame);
  const jdbPreparedAction = jdbContext.saferRuntimeAction(jdbMe,
    jdbEnemy, jdbGame, "GO");
  const jdbMetrics = ["GO", "LEFT", "RIGHT"].map(action => {
    const pose = jdbContext.runtimeActionPose(jdbMe, jdbEnemy, jdbGame,
      action, null);
    return {
      action,
      pose,
      risk: jdbContext.runtimeActionRisk(jdbMe, jdbEnemy, jdbGame,
        action, null, null, pose, null),
      tie: jdbContext.cloakActionTieScore(jdbMe, jdbGame, action, pose,
        null)
    };
  });
  if (jdbPreparedAction !== "LEFT" && jdbPreparedAction !== "RIGHT") {
    throw new Error(`Jdb cloak must prepare a lateral exit, got ${jdbPreparedAction}: ${JSON.stringify(jdbMetrics)}`);
  }
  jdbContext.observeEnemyBehavior(actor([6, 2], "right"),
    hiddenCloakEnemy(4),
    { map: jdbMap, star: null, bombs: [], frames: 29 });
  const jdbFrame30Enemy = hiddenCloakEnemy(3);
  const jdbFrame30Me = actor([7, 2], "right");
  const jdbFrame30Game = {
    map: jdbMap, star: null, bombs: [], frames: 30
  };
  jdbContext.observeEnemyBehavior(jdbFrame30Me, jdbFrame30Enemy,
    jdbFrame30Game);
  const invisibleBulletRetained =
    jdbContext.AT_CLOAK_PROJECTILE_BELIEF.some(projectile =>
      projectile.position[0] === 6 && projectile.position[1] === 2 &&
      projectile.direction === "right");
  const jdbGoRisk = jdbContext.runtimeActionRisk(jdbFrame30Me,
    jdbFrame30Enemy, jdbFrame30Game, "GO", null, null);
  if (!invisibleBulletRetained ||
      jdbGoRisk < jdbContext.AT_TERMINAL_SCORE) {
    throw new Error(`Jdb invisible shot was not retained: bullet=${invisibleBulletRetained}, risk=${jdbGoRisk}`);
  }

  // Cloak expiry while still unseen proves that the surviving pose is grass;
  // the grass region is built immediately and an already-fired bullet remains.
  const transitionContext = loadAgent();
  const transitionMap = makeMap();
  transitionContext.AT_HIDDEN_ENEMY_MODE = 1;
  transitionContext.AT_HIDDEN_ENEMY_AGE = 5;
  transitionContext.AT_HIDDEN_ENEMY_BELIEF = [
    { position: [7, 6], direction: "right", score: 1 },
    { position: [7, 7], direction: "down", score: 1 }
  ];
  transitionContext.AT_CLOAK_PROJECTILE_BELIEF = [
    { position: [5, 10], direction: "right", damage: 1, observed: false }
  ];
  transitionContext.AT_CLOAK_LAST_UPDATE_FRAME = 26;
  const expiredEnemy = actor([0, 0], "up", {
    status: { cloaked: false },
    skill: { type: "cloak", remainingCooldownFrames: 29 }
  });
  expiredEnemy.tank = null;
  transitionContext.updateHiddenEnemyBelief(actor([3, 3], "right"),
    expiredEnemy, { map: transitionMap, star: null, bombs: [], frames: 27 },
    27);
  if (transitionContext.AT_HIDDEN_ENEMY_MODE !== 2 ||
      !transitionContext.AT_HIDDEN_GRASS_REGION ||
      transitionContext.AT_HIDDEN_ENEMY_BELIEF.length !== 1 ||
      transitionContext.AT_CLOAK_PROJECTILE_BELIEF.length !== 1) {
    throw new Error("cloak expiry did not transition to grass with bullet persistence");
  }

  return {
    exactCounts,
    exactProjectiles: exactContext.AT_CLOAK_PROJECTILE_BELIEF.length,
    cloakGuardMicros: Number(cloakGuardMicros.toFixed(3)),
    daTruePose,
    daGoRisk,
    daAction: daMe.commands[0],
    jdbPreparedAction,
    jdbMetrics,
    invisibleBulletRetained,
    jdbGoRisk,
    grassTransition: transitionContext.AT_HIDDEN_ENEMY_MODE
  };
}

function v20RealBattleRegressionChecks() {
  // mat_85U88IjKCkwEd5cRj frame 16: tiny tank at [4,10], the opponent
  // one move from [4,12], and BOMB would not explode until frame 26.
  const starRaw = "xxxxxxxxxxxxxxxxxxx|x.................x|x.a....oo.......x.x|x....m.x....xx..x.x|x......x........x.x|xo...x............x|xom...............x|xo..oxo....ooxo..ox|x...............mox|x............x...ox|x.x........x......x|x.x..xx....x.m....x|x.x.......oo....C.x|x.................x|xxxxxxxxxxxxxxxxxxx";
  const starMap = mapFromReplayRaw(starRaw);
  const bombContext = loadAgent();
  const bombState = bombContext.makeSearchState(
    actor([4, 10], "right", {
      skill: { type: "stun", remainingCooldownFrames: 18 }
    }),
    actor([5, 12], "left", {
      status: { shielded: true, stunned: true },
      effects: {
        self: { type: "shield", remainingFrames: 1 },
        debuff: { type: "stun", remainingFrames: 4 }
      },
      skill: { type: "shield", remainingCooldownFrames: 22 }
    }),
    { map: starMap, star: [4, 12], bombs: [], frames: 16 });
  const lateBombUtility = bombContext.bombPlacementUtility(bombState, true);
  const lateBombConsidered = bombContext.shouldConsiderBomb(bombState, true);
  const lateBombActions = bombContext.tacticalActions(bombState, true);
  if (lateBombUtility < 140 || lateBombConsidered ||
      lateBombActions.includes("BOMB")) {
    throw new Error(`urgent star deadline did not prune delayed BOMB: utility=${lateBombUtility}, considered=${lateBombConsidered}, actions=${lateBombActions}`);
  }
  const leadingBombState = bombContext.makeSearchState(
    actor([4, 10], "right", {
      stars: 1,
      skill: { type: "stun", remainingCooldownFrames: 18 }
    }),
    actor([5, 12], "left", {
      status: { shielded: true, stunned: true },
      effects: {
        self: { type: "shield", remainingFrames: 1 },
        debuff: { type: "stun", remainingFrames: 4 }
      },
      skill: { type: "shield", remainingCooldownFrames: 22 }
    }),
    { map: starMap, star: [4, 12], bombs: [], frames: 16 });
  const leadingBombRetained = bombContext.shouldConsiderBomb(
    leadingBombState, true);
  if (!leadingBombRetained) {
    throw new Error("urgent-star bomb pruning incorrectly removed a lead-protecting trap");
  }

  // mat_Hoo0zaDiWttHI6Vln frames 67-70: the mound at [15,5] had already
  // been opened. With a 2-0 lead, moving farther up the same x=15 muzzle
  // lane led to an unseen bullet catching us at [15,1].
  const laneRaw = "xxxxxxxxxxxxxxxxxxx|x.........mmxo...ox|x.a..........m....x|x...oo......mm...mx|x...o.x....mmm..m.x|x.....x........mm.x|x.................x|x....xo.....ox....x|x.................x|x.mm........x.....x|x.m..mmm....x.o...x|xm...mm......oo...x|x....m..........C.x|xo...oxmm.........x|xxxxxxxxxxxxxxxxxxx";
  const laneMap = mapFromReplayRaw(laneRaw);
  laneMap[15][5] = ".";
  const laneContext = loadAgent();
  const laneMe = recordActions(actor([15, 3], "up", {
    stars: 2,
    skill: { type: "stun", remainingCooldownFrames: 2 }
  }));
  const laneEnemy = actor([15, 9], "up", {
    status: { shielded: true },
    effects: { self: { type: "shield", remainingFrames: 2 } },
    skill: { type: "shield", remainingCooldownFrames: 23 }
  });
  laneContext.onIdle(laneMe, laneEnemy,
    { map: laneMap, star: [15, 12], bombs: [], frames: 67 });
  const prepareAction = laneMe.commands[0];
  if (prepareAction !== "LEFT" && prepareAction !== "RIGHT") {
    throw new Error(`long muzzle lane must prepare a lateral exit, got ${prepareAction}`);
  }
  const preparedDirection = prepareAction === "LEFT" ? "left" : "right";
  const preparedMe = recordActions(actor([15, 3], preparedDirection, {
    stars: 2,
    skill: { type: "stun", remainingCooldownFrames: 1 }
  }));
  const turnedEnemy = actor([15, 9], "right", {
    status: { shielded: true },
    effects: { self: { type: "shield", remainingFrames: 1 } },
    skill: { type: "shield", remainingCooldownFrames: 22 }
  });
  laneContext.onIdle(preparedMe, turnedEnemy,
    { map: laneMap, star: [15, 12], bombs: [], frames: 68 });
  const committedExit = preparedMe.commands[0];
  if (committedExit !== "GO") {
    throw new Error(`long muzzle preparation must commit lateral GO, got ${committedExit}`);
  }

  // Do not convert every harmless central long-range alignment into a dodge.
  const centralMap = makeMap();
  for (let y = 1; y < 16; y++) centralMap[8][y] = ".";
  const centralDodge = laneContext.preemptiveMuzzleDodge(
    actor([8, 7], "up"), actor([8, 13], "up"),
    { map: centralMap, star: [3, 3], bombs: [], frames: 20 });
  if (centralDodge !== null) {
    throw new Error(`tied central long lane was over-defended with ${centralDodge}`);
  }

  // Position-pair geometry cache must be shared across direction-only states.
  const geometryA = bombContext.makeSearchState(
    actor([3, 3], "up"), actor([10, 10], "left"),
    { map: starMap, star: null, bombs: [], frames: 2 });
  const geometryB = bombContext.makeSearchState(
    actor([3, 3], "right"), actor([10, 10], "down"),
    { map: starMap, star: null, bombs: [], frames: 2 });
  const sharedGeometry = bombContext.stateGeometry(geometryA) ===
    bombContext.stateGeometry(geometryB);
  if (!sharedGeometry) {
    throw new Error("direction-only states did not share position geometry");
  }

  return {
    lateBombUtility,
    lateBombConsidered,
    leadingBombRetained,
    prepareAction,
    committedExit,
    centralDodge,
    sharedGeometry
  };
}

function bolunOverloadRegressionChecks() {
  const context = loadAgent();
  if (context.AT_OVERLOAD_PROJECTILE_TRACK_MAX_AGE !== 8 ||
      context.AT_PROJECTILE_TRACK_MAX_AGE !== 4) {
    throw new Error("overload projectile memory must be 8 frames without extending generic bullets");
  }
  const origins = {
    right: context.overloadSecondaryOrigin([8, 8], "right"),
    left: context.overloadSecondaryOrigin([8, 8], "left"),
    down: context.overloadSecondaryOrigin([8, 8], "down"),
    up: context.overloadSecondaryOrigin([8, 8], "up")
  };
  if (JSON.stringify(origins) !== JSON.stringify({
    right: [8, 9], left: [8, 9], down: [9, 8], up: [9, 8]
  })) {
    throw new Error(`overload secondary origins mismatch replay evidence: ${JSON.stringify(origins)}`);
  }
  const directionalCases = [
    { direction: "right", enemy: [5, 5], target: [7, 6] },
    { direction: "left", enemy: [8, 5], target: [6, 6] },
    { direction: "down", enemy: [5, 5], target: [6, 7] },
    { direction: "up", enemy: [5, 8], target: [6, 6] }
  ];
  const directionalHits = {};
  for (const sample of directionalCases) {
    const sampleState = context.makeSearchState(
      actor(sample.target, "left"),
      actor(sample.enemy, sample.direction, {
        status: { overloaded: true },
        effects: { self: { type: "overload", remainingFrames: 5 } },
        skill: { type: "overload", remainingCooldownFrames: 27 }
      }),
      { map: makeMap(), star: null, bombs: [], frames: 10 });
    const resolved = context.applyJointActions(
      sampleState, "LEFT", "FIRE", false);
    directionalHits[sample.direction] = resolved.myDead;
  }
  if (!Object.values(directionalHits).every(Boolean)) {
    throw new Error(`overload secondary lanes did not resolve in all directions: ${JSON.stringify(directionalHits)}`);
  }

  // mat_18v3efiTPa9EKt2R7 frames 20-21: the pre-move pose is diagonal,
  // so utility-pruned enemy action generation used to omit FIRE. Our GO
  // enters the primary lane while a stationary turn remains in the secondary
  // lane. The root guard must test the physical shot directly.
  const immediateRaw = "xxxxxxxxxxxxxxxxxxx|x............m...xx|x......xx.........x|x...o.......ox..xxx|x...........o.....x|x.x...m.....o.x.o.x|x...m........x....x|x....o.....o.o....x|x....x........m...x|x.o.x.o.....m...x.x|x.....o...........x|xxx..xo.......o...x|x.........xx......x|xx...m............x|xxxxxxxxxxxxxxxxxxx";
  const immediateMap = mapFromReplayRaw(immediateRaw);
  const immediateMe = actor([9, 7], "up", {
    skill: { type: "stun", remainingCooldownFrames: 1 }
  });
  const immediateEnemy = actor([10, 6], "left", {
    status: { overloaded: true },
    effects: { self: { type: "overload", remainingFrames: 9 } },
    skill: { type: "overload", remainingCooldownFrames: 30 }
  });
  const immediateGame = {
    map: immediateMap, star: [6, 10], bombs: [], frames: 20
  };
  const immediateState = context.makeSearchState(immediateMe,
    immediateEnemy, immediateGame);
  if (!context.immediateOverloadFireForcesLoss(immediateState, "GO") ||
      !context.immediateOverloadFireForcesLoss(immediateState, "LEFT")) {
    throw new Error("18v immediate primary/secondary Overload lanes were not hard-filtered");
  }

  const favorableState = context.makeSearchState(
    actor([8, 6], "right", { stars: 1 }),
    actor([10, 6], "left", {
      status: { overloaded: true },
      effects: { self: { type: "overload", remainingFrames: 9 } },
      skill: { type: "overload", remainingCooldownFrames: 30 }
    }), immediateGame);
  const tiedState = context.makeSearchState(
    actor([8, 6], "right"),
    actor([10, 6], "left", {
      status: { overloaded: true },
      effects: { self: { type: "overload", remainingFrames: 9 } },
      skill: { type: "overload", remainingCooldownFrames: 30 }
    }), immediateGame);
  if (context.immediateOverloadFireForcesLoss(favorableState, "FIRE") ||
      !context.immediateOverloadFireForcesLoss(tiedState, "FIRE")) {
    throw new Error("immediate Overload filter broke star-aware mutual trades");
  }

  // The frame-20 turn trap was reached through the anti-oscillation shortcut.
  // Its old runtimeMuzzleRiskAt call supplied explicit null geometry and
  // collapsed a certain hit to 650. The final guard must now reject both the
  // immediate GO and the LEFT that enters next frame's double-lane mate.
  const armedContext = loadAgent();
  const armedTurnMe = actor([9, 7], "right", {
    skill: { type: "stun", remainingCooldownFrames: 2 }
  });
  const armedTurnEnemy = actor([10, 6], "down", {
    status: { overloaded: true },
    effects: { self: { type: "overload", remainingFrames: 10 } },
    skill: { type: "overload", remainingCooldownFrames: 31 }
  });
  const armedTurnGame = {
    map: immediateMap, star: [6, 10], bombs: [], frames: 19
  };
  if (armedContext.runtimeMuzzleRiskAt([10, 7], armedTurnEnemy,
      armedTurnGame) < armedContext.AT_TERMINAL_SCORE) {
    throw new Error("exact runtime Overload muzzle was reduced to a soft proximity score");
  }
  armedContext.AT_TURN_STREAK = 3;
  const armedRuntimeAction = armedContext.saferRuntimeAction(armedTurnMe,
    armedTurnEnemy, armedTurnGame, "GO");
  if (armedRuntimeAction !== "RIGHT") {
    throw new Error(`18v armed runtime guard must choose RIGHT, got ${armedRuntimeAction}`);
  }

  // mat_IHaBRaAu1fNKaRO8x frame 60: the visible primary travels on y=1
  // and the inferred secondary on y=2. Turning up looks like a lateral escape
  // from the secondary in isolation, but enters the primary lane and is a
  // forced loss. Turning down is the only pair-safe preparation.
  const pairRaw = "xxxxxxxxxxxxxxxxxxx|xx................x|x.................x|x..........x......x|x...........mm....x|xm....x.........x.x|x...xo........x.o.x|x.o.ooo.....ooo.o.x|x.o.x........ox...x|x.x.........x....mx|x....mm...........x|x......x..........x|x.................x|x................xx|xxxxxxxxxxxxxxxxxxx";
  const pairMap = mapFromReplayRaw(pairRaw);
  const pairContext = loadAgent();
  const pairMe = actor([4, 2], "right", {
    skill: { type: "stun", remainingCooldownFrames: 10 }
  });
  const pairEnemy = actor([14, 1], "left", {
    bullet: { position: [10, 1], direction: "left" },
    skill: { type: "overload", remainingCooldownFrames: 29 }
  });
  const pairGame = { map: pairMap, star: null, bombs: [], frames: 60 };
  pairContext.AT_OVERLOAD_PROJECTILE_TRACKS = [{
    position: [10, 2], direction: "left", damage: 1, observed: false,
    inferredOverload: true, seenFrame: 59, projectedFrame: 60
  }];
  const pairPrimary = pairContext.currentEnemyProjectile(pairEnemy,
    pairGame);
  const pairRisks = {};
  for (const action of ["GO", "LEFT", "RIGHT"]) {
    const pose = pairContext.runtimeActionPose(pairMe, pairEnemy,
      pairGame, action);
    pairRisks[action] = pairContext.runtimeActionRisk(pairMe, pairEnemy,
      pairGame, action, pairPrimary, null, pose);
  }
  const pairRuntimeAction = pairContext.saferRuntimeAction(pairMe,
    pairEnemy, pairGame, "GO");
  if (pairRisks.LEFT < pairContext.AT_TERMINAL_SCORE ||
      pairRisks.RIGHT >= pairContext.AT_TERMINAL_SCORE ||
      pairRuntimeAction !== "RIGHT") {
    throw new Error(`IHa Overload pair escape is wrong: risks=${JSON.stringify(pairRisks)}, action=${pairRuntimeAction}`);
  }

  // mat_5EvhGQHB9EA2audfD frame 16: Bolun has not cast Overload yet.
  // RIGHT was safe against the current pose but, after the ready cast, every
  // following reply loses. LEFT/GO retain an escape and must stay eligible.
  const readyRaw = "xxxxxxxxxxxxxxxxxxx|x....mm.....x.....x|x....m...........ox|x............x...ox|x..x...oo....x..oox|x..xxx.o........xox|x.x..o.......xo...x|x.x.oo.......oo.x.x|x...ox.......o..x.x|xox........o.xxx..x|xoo..x....oo...x..x|xo...x............x|xo...........m....x|x.....x.....mm....x|xxxxxxxxxxxxxxxxxxx";
  const readyMap = mapFromReplayRaw(readyRaw);
  const readyMe = actor([12, 6], "left", {
    bullet: { position: [12, 2], direction: "up" },
    skill: { type: "stun", remainingCooldownFrames: 4 }
  });
  const readyEnemy = actor([11, 4], "right", {
    skill: { type: "overload", remainingCooldownFrames: 0 }
  });
  const readyGame = {
    map: readyMap, star: [12, 4], bombs: [], frames: 16
  };
  const readyState = context.makeSearchState(readyMe, readyEnemy, readyGame);
  if (!context.overloadForcesNextFrameLoss(readyState, "RIGHT") ||
      context.overloadForcesNextFrameLoss(readyState, "LEFT") ||
      context.overloadForcesNextFrameLoss(readyState, "GO")) {
    throw new Error("ready Overload cast trap did not isolate the losing RIGHT");
  }
  const readyRuntime = loadAgent();
  const readyRuntimeMe = recordActions(readyMe);
  readyRuntime.onIdle(readyRuntimeMe, readyEnemy, readyGame);
  const readyCastAction = readyRuntimeMe.commands[0];
  if (readyCastAction === "RIGHT") {
    throw new Error("5E ready Overload trap retained the losing RIGHT");
  }

  // mat_Kn08XIMXCsG7CrqtG frame 35: Bolun fires up from [11,7].
  // The primary x=11 bullet misses, while the parallel x=12 bullet hits us
  // at [12,6]. GO to [13,6] was open and must beat another stationary turn.
  const knRaw = "xxxxxxxxxxxxxxxxxxx|x..............x.ox|x.a....xx...x..o.ox|x......x..........x|x...m..x..........x|x...mx......x.....x|x...x.............x|xm..oo.......oo..mx|x.............x...x|x.....x......xm...x|x..........x..m...x|x..........x......x|xo.o..x...xx....C.x|xo.x..............x|xxxxxxxxxxxxxxxxxxx";
  const knMap = mapFromReplayRaw(knRaw);
  const knMe = actor([12, 6], "right", {
    bullet: { position: [6, 6], direction: "left" },
    skill: { type: "stun", remainingCooldownFrames: 0 }
  });
  const knEnemy = actor([11, 7], "up", {
    stars: 1,
    status: { overloaded: true },
    effects: { self: { type: "overload", remainingFrames: 8 } },
    skill: { type: "overload", remainingCooldownFrames: 30 }
  });
  const knGame = { map: knMap, star: [12, 8], bombs: [], frames: 34 };
  const knState = context.makeSearchState(knMe, knEnemy, knGame);
  const knTurnDeath = context.applyJointActions(knState, "RIGHT", "FIRE", false);
  const knGoEscape = context.applyJointActions(knState, "GO", "FIRE", false);
  if (!knTurnDeath.myDead || knGoEscape.myDead ||
      knTurnDeath.enemyProjectile2 !== null) {
    throw new Error(`Kn overload lane resolution incorrect: turnDead=${knTurnDeath.myDead}, goDead=${knGoEscape.myDead}, secondary=${JSON.stringify(knTurnDeath.enemyProjectile2)}`);
  }
  const knRuntimeContext = loadAgent();
  const knRuntimeMe = recordActions(knMe);
  knRuntimeContext.onIdle(knRuntimeMe, knEnemy, knGame);
  const knAction = knRuntimeMe.commands[0];
  if (knAction !== "GO") {
    throw new Error(`Kn fatal overload state must use open lateral GO, got ${knAction}`);
  }

  // mat_JCzHY1CDvuWJOJdUn frames 81-83: after overload is armed,
  // GO enters the future x=12 secondary lane while Bolun turns down. Every
  // following one-frame action then dies to FIRE; staying at [12,5], turning
  // left, and moving to [11,5] preserves a two-step escape.
  const jcRaw = "xxxxxxxxxxxxxxxxxxx|x...........x..x..x|x.a...x...........x|x...xxm....m....mmx|x..x..........xx..x|x.ooo.............x|xoo...........m...x|xo...o.......o...ox|x...m...........oox|x.............ooo.x|x..xx..........x..x|xmm....m....mxx...x|x...........x...C.x|x..x..x...........x|xxxxxxxxxxxxxxxxxxx";
  const jcMap = mapFromReplayRaw(jcRaw);
  const jcMe = actor([12, 5], "up", {
    stars: 1,
    bullet: { position: [12, 3], direction: "up" },
    skill: { type: "stun", remainingCooldownFrames: 9 }
  });
  const jcEnemy = actor([11, 2], "right", {
    stars: 1,
    status: { overloaded: true },
    effects: { self: { type: "overload", remainingFrames: 10 } },
    skill: { type: "overload", remainingCooldownFrames: 32 }
  });
  const jcGame = { map: jcMap, star: [16, 2], bombs: [], frames: 81 };
  const jcState = context.makeSearchState(jcMe, jcEnemy, jcGame);
  const jcEnteredLane = context.applyJointActions(jcState, "GO", "RIGHT", false);
  const jcReplies = ["GO", "LEFT", "RIGHT", "FIRE", "STUN"].map(action =>
    context.applyJointActions(jcEnteredLane, action, "FIRE", false));
  if (!jcReplies.every(state => state.myDead)) {
    throw new Error(`JC entered overload lane was not a forced death: ${jcReplies.map(state => state.myDead)}`);
  }
  const jcTurnedAway = context.applyJointActions(jcState, "LEFT", "RIGHT", false);
  const jcFirstEscape = context.applyJointActions(jcTurnedAway, "GO", "FIRE", false);
  const jcSecondEscape = context.applyJointActions(jcFirstEscape, "GO", "LEFT", false);
  if (jcFirstEscape.myDead || jcSecondEscape.myDead) {
    throw new Error("JC safe two-step overload escape was incorrectly killed");
  }
  const jcRuntimeContext = loadAgent();
  const jcRuntimeMe = recordActions(jcMe);
  jcRuntimeContext.onIdle(jcRuntimeMe, jcEnemy, jcGame);
  const jcAction = jcRuntimeMe.commands[0];
  if (jcAction === "GO") {
    throw new Error("JC must not enter the armed overload secondary lane");
  }

  // mat_549FdxlSa3B7fec7Q is the non-overload edge chase. Keep it as a
  // control: the v21 projectile commitment should still leave the y=6 lane.
  const edgeRaw = "xxxxxxxxxxxxxxxxxxx|xm.........x....m.x|x.a..x..........m.x|x....mm.....oo....x|x...x.......x.....x|x...x..o...oo..o..x|x..........oo.....x|x....oo....ooo....x|x.....oo..........x|x..o..oo...o..x...x|x.....x.......x...x|x....oo.....mm....x|x.m..........x..C.x|x.m....x.........mx|xxxxxxxxxxxxxxxxxxx";
  const edgeMap = mapFromReplayRaw(edgeRaw);
  const edgeContext = loadAgent();
  const edgeMe = recordActions(actor([2, 6], "down", {
    stars: 3,
    skill: { type: "stun", remainingCooldownFrames: 0 }
  }));
  const edgeEnemy = actor([9, 6], "left", {
    bullet: { position: [5, 6], direction: "left" },
    skill: { type: "overload", remainingCooldownFrames: 4 }
  });
  edgeContext.onIdle(edgeMe, edgeEnemy,
    { map: edgeMap, star: [1, 13], bombs: [], frames: 83 });
  const edgeAction = edgeMe.commands[0];
  if (edgeAction !== "GO") {
    throw new Error(`Bolun edge chase control regressed, got ${edgeAction}`);
  }

  // mat_3bA29CMN9qz8sfnSU frame 29 is a separate control for the fourth
  // Bolun loss. We are adjacent, trail 0-1, and Bolun can fire immediately.
  // Every legal root action is already losing here: FIRE trades both tanks,
  // but the 0-1 star score awards that mutual crash to Bolun. The overload
  // repair must not pretend that this terminal position can be rescued.
  const behindRaw = "xxxxxxxxxxxxxxxxxxx|x.....x......m....x|x.a..........m....x|x......o....oox...x|x.........oo......x|x................xx|xoox...x........xmx|xo..ooo....oooo..ox|xmx........x...xoox|xx................x|x......oo.........x|x...xoo....o......x|x....m..........C.x|x....m......x.....x|xxxxxxxxxxxxxxxxxxx";
  const behindMap = mapFromReplayRaw(behindRaw);
  const behindState = context.makeSearchState(
    actor([12, 6], "up", {
      skill: { type: "stun", remainingCooldownFrames: 1 }
    }),
    actor([12, 5], "down", {
      stars: 1,
      skill: { type: "overload", remainingCooldownFrames: 0 }
    }),
    { map: behindMap, star: null, bombs: [], frames: 29 });
  const behindReplies = ["GO", "LEFT", "RIGHT", "FIRE", "STUN", "BOMB"]
    .map(action => context.applyJointActions(
      behindState, action, "FIRE", false));
  const behindValues = behindReplies.map(state => context.evaluateState(state));
  if (!behindValues.every(value => value <= -100000)) {
    throw new Error(`Bolun 0-1 adjacent terminal was falsely rescued: ${behindValues}`);
  }

  // mat_3YVgw5Pezak5qdX6x frame 26: RIGHT was immediately safe but let
  // Bolun turn right and cover both our current tile and the requested GO.
  // LEFT prepares GO down and survives the same turn -> overload FIRE line.
  const turnTrapRaw = "xxxxxxxxxxxxxxxxxxx|x.............xm..x|x.a....o....mmxm..x|x.....oo...o.....xx|x..........x......x|x.....m.........x.x|x...x.........o...x|xox.o......o..o.xox|x...o.........x...x|x.x.........m.....x|x......x..........x|xx.....o...oo.....x|x..mxmm....o....C.x|x..mx.............x|xxxxxxxxxxxxxxxxxxx";
  const turnTrapMap = mapFromReplayRaw(turnTrapRaw);
  const turnTrapMe = actor([11, 8], "left", {
    skill: { type: "stun", remainingCooldownFrames: 14 }
  });
  const turnTrapEnemy = actor([9, 7], "down", {
    status: { overloaded: true },
    effects: { self: { type: "overload", remainingFrames: 10 } },
    skill: { type: "overload", remainingCooldownFrames: 32 }
  });
  const turnTrapGame = { map: turnTrapMap, star: [8, 8], bombs: [], frames: 26 };
  const turnTrapState = context.makeSearchState(turnTrapMe, turnTrapEnemy,
    turnTrapGame);
  if (context.overloadForcesNextFrameLoss(turnTrapState, "LEFT") ||
      !context.overloadForcesNextFrameLoss(turnTrapState, "RIGHT")) {
    throw new Error("3YV overload turn trap did not distinguish the prepared LEFT escape");
  }
  const turnTrapRuntime = loadAgent();
  const turnTrapRuntimeMe = recordActions(turnTrapMe);
  turnTrapRuntime.onIdle(turnTrapRuntimeMe, turnTrapEnemy, turnTrapGame);
  const turnTrapAction = turnTrapRuntimeMe.commands[0];
  if (turnTrapAction !== "LEFT") {
    throw new Error(`3YV overload escape must prepare LEFT, got ${turnTrapAction}`);
  }

  // mat_96OHiZEeewKGHkegx frame 25: the wall shot kept us in the future
  // double lane. GO or LEFT preserves a second action; FIRE must be rejected.
  const fireTrapRaw = "xxxxxxxxxxxxxxxxxxx|x....o.......mom.mx|x.a..ox....x....mmx|x......o..........x|x............m..x.x|x.o..........m.xx.x|x...........xm...ox|x...o.o.....o.o...x|xo...mx...........x|x.xx.m..........o.x|x.x..m............x|x..........o......x|xmm....x....xo..C.x|xm.mom.......o....x|xxxxxxxxxxxxxxxxxxx";
  const fireTrapMap = mapFromReplayRaw(fireTrapRaw);
  const fireTrapMe = actor([14, 3], "up", {
    skill: { type: "stun", remainingCooldownFrames: 15 }
  });
  const fireTrapEnemy = actor([13, 2], "up", {
    status: { overloaded: true },
    effects: { self: { type: "overload", remainingFrames: 10 } },
    skill: { type: "overload", remainingCooldownFrames: 32 }
  });
  const fireTrapGame = { map: fireTrapMap, star: [9, 7], bombs: [], frames: 25 };
  const fireTrapState = context.makeSearchState(fireTrapMe, fireTrapEnemy,
    fireTrapGame);
  if (!context.overloadForcesNextFrameLoss(fireTrapState, "FIRE") ||
      context.overloadForcesNextFrameLoss(fireTrapState, "GO")) {
    throw new Error("96O overload trap did not reject the non-hitting FIRE");
  }
  const fireTrapRuntime = loadAgent();
  const fireTrapRuntimeMe = recordActions(fireTrapMe);
  fireTrapRuntime.onIdle(fireTrapRuntimeMe, fireTrapEnemy, fireTrapGame);
  const fireTrapAction = fireTrapRuntimeMe.commands[0];
  if (fireTrapAction === "FIRE") {
    throw new Error("96O overload trap retained the losing wall FIRE");
  }

  // mat_8d1aKO08AtpFDKE7X frames 27-28: enemy.bullet did not expose the
  // secondary x=16 projectile. Early overload disappearance must infer the
  // fired pair, retain [16,3], and force the lateral GO away from x=16.
  const unseenPairRaw = "xxxxxxxxxxxxxxxxxxx|xm...xx....oox....x|x.a..............ox|x...oo.........x..x|x..ox.........xx..x|x.................x|xo..oo...........mx|xo.m...........m.ox|xm...........oo..ox|x.................x|x..xx.........xo..x|x..x.........oo...x|xo..............C.x|x....xoo....xx...mx|xxxxxxxxxxxxxxxxxxx";
  const unseenPairMap = mapFromReplayRaw(unseenPairRaw);
  const unseenContext = loadAgent();
  const armedMe = recordActions(actor([16, 5], "down", {
    bullet: { position: [6, 2], direction: "left" },
    skill: { type: "stun", remainingCooldownFrames: 14 }
  }));
  const armedEnemy = actor([15, 1], "down", {
    status: { overloaded: true },
    effects: { self: { type: "overload", remainingFrames: 9 } },
    skill: { type: "overload", remainingCooldownFrames: 31 }
  });
  unseenContext.onIdle(armedMe, armedEnemy,
    { map: unseenPairMap, star: [5, 5], bombs: [], frames: 27 });
  const firedMe = recordActions(actor([16, 5], "left", {
    bullet: { position: [4, 2], direction: "left" },
    skill: { type: "stun", remainingCooldownFrames: 13 }
  }));
  const firedEnemy = actor([15, 1], "down", {
    skill: { type: "overload", remainingCooldownFrames: 30 }
  });
  unseenContext.onIdle(firedMe, firedEnemy,
    { map: unseenPairMap, star: [5, 5], bombs: [], frames: 28 });
  const unseenPairAction = firedMe.commands[0];
  const inferredSecondary = unseenContext.AT_OVERLOAD_PROJECTILE_TRACKS
    .some(track => track.position[0] === 16 && track.position[1] === 3 &&
      track.direction === "down");
  if (!inferredSecondary || unseenPairAction !== "GO") {
    throw new Error(`8d1 unseen overload pair was not escaped: inferred=${inferredSecondary}, action=${unseenPairAction}`);
  }

  return {
    origins,
    directionalHits,
    immediateRootFiltered: true,
    favorableTradePreserved: true,
    armedRuntimeAction,
    pairRisks,
    pairRuntimeAction,
    readyCastAction,
    knTurnDead: knTurnDeath.myDead,
    knGoSafe: !knGoEscape.myDead,
    knAction,
    jcForcedDeaths: jcReplies.filter(state => state.myDead).length,
    jcEscapeSafe: !jcSecondEscape.myDead,
    jcAction,
    edgeAction,
    behindForcedLosses: behindValues.filter(value => value <= -100000).length,
    turnTrapAction,
    fireTrapAction,
    inferredSecondary,
    unseenPairAction,
    overloadTrackFrames: context.AT_OVERLOAD_PROJECTILE_TRACK_MAX_AGE
  };
}

function newGuardPerformance() {
  const context = loadAgent();
  const map = makeMap();
  context.AT_HIDDEN_GRASS_REGION = new Uint8Array(map.length * 256);
  context.AT_HIDDEN_GRASS_REGION[7 * 256 + 6] = 1;
  context.AT_HIDDEN_GRASS_REGION_TTL = 12;
  let sink = 0;
  let startedAt = performance.now();
  const grassIterations = 50000;
  for (let i = 0; i < grassIterations; i++) {
    sink += context.runtimeGrassRegionMuzzleRisk([7, 3],
      i & 1 ? "right" : "up", 1, map);
  }
  const grassMicros = (performance.now() - startedAt) * 1000 /
    grassIterations;

  const game = { map, star: null, bombs: [], frames: 22 };
  const enemy = actor([15, 9], "down");
  const normalMe = actor([14, 10], "left");
  const stunnedMe = actor([14, 10], "left", {
    status: { stunned: true },
    effects: { debuff: { remainingFrames: 3 } }
  });
  const actionIterations = 20000;
  startedAt = performance.now();
  for (let i = 0; i < actionIterations; i++) {
    sink += context.runtimeActionRisk(normalMe, enemy, game, "LEFT",
      null, null);
  }
  const normalMicros = (performance.now() - startedAt) * 1000 /
    actionIterations;
  startedAt = performance.now();
  for (let i = 0; i < actionIterations; i++) {
    sink += context.runtimeActionRisk(stunnedMe, enemy, game, "LEFT",
      null, null);
  }
  const stunnedMicros = (performance.now() - startedAt) * 1000 /
    actionIterations;
  const closeState = context.makeSearchState(
    actor([8, 9], "up"), actor([7, 8], "down"), game);
  const closeIterations = 5000;
  startedAt = performance.now();
  for (let i = 0; i < closeIterations; i++) {
    sink += context.ordinaryTurnThenFireForcesLoss(closeState, "GO") ? 1 : 0;
  }
  const turnThenFireMicros = (performance.now() - startedAt) * 1000 /
    closeIterations;
  if (!Number.isFinite(sink)) throw new Error("guard benchmark was elided");
  return {
    grassRegionMicrosPerCheck: Number(grassMicros.toFixed(4)),
    normalActionMicrosPerCheck: Number(normalMicros.toFixed(4)),
    stunnedActionMicrosPerCheck: Number(stunnedMicros.toFixed(4)),
    closeTurnThenFireMicrosPerCheck: Number(turnThenFireMicros.toFixed(4))
  };
}

function benchmarkAgentPass(file, repeats = 50) {
  const context = loadAgent(file);
  context.console = { log() {} };
  const scenarioList = cases();
  const startedAt = performance.now();
  let decisions = null;
  for (let repeat = 0; repeat < repeats; repeat++) {
    decisions = scenarioList.map(scenario => decide(context, scenario));
  }
  return {
    elapsedMs: performance.now() - startedAt,
    decisions: decisions.map(decision => decision.action),
    nodes: decisions.map(decision => decision.nodes)
  };
}

function main() {
  const scenarioList = cases();
  const validationContext = loadAgent();
  const decisions = scenarioList.map(s => ({ name: s.name, ...decide(validationContext, s) }));
  const superko = superkoChecks();
  const v13Behavior = v13BehaviorChecks();
  const monteCarlo = monteCarloChecks(scenarioList);
  const runtimeBudget = runtimeBudgetChecks();
  const runtimeCompatibility = runtimeCompatibilityChecks();
  const physicalStateCache = physicalStateCacheChecks();
  const bombAndSkills = bombAndSkillChecks();
  const failureRegressions = failureRegressionChecks();
  const batchRiskRegressions = batchRiskRegressionChecks();
  const cloakRedesignRegressions = cloakRedesignRegressionChecks();
  const v20RealBattleRegressions = v20RealBattleRegressionChecks();
  const bolunOverloadRegressions = bolunOverloadRegressionChecks();
  const newGuardTiming = newGuardPerformance();
  const fixedStateMonteCarlo = fixedStateMonteCarloChecks();
  for (let i = 0; i < scenarioList.length; i++) {
    if (scenarioList[i].expected && decisions[i].action !== scenarioList[i].expected) {
      throw new Error(`${scenarioList[i].name}: expected ${scenarioList[i].expected}, got ${decisions[i].action}`);
    }
  }

  const samples = [];
  for (let sample = 0; sample < 15; sample++) {
    const context = loadAgent();
    const start = performance.now();
    for (let repeat = 0; repeat < 30; repeat++) {
      for (const scenario of scenarioList) decide(context, scenario);
    }
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const monteCarloTiming = monteCarloPerformance();
  const fixedStateMonteCarloTiming = fixedStateMonteCarloPerformance();
  const featureTiming = featurePerformance();
  console.log(JSON.stringify({
    decisions,
    superko,
    v13Behavior,
    monteCarlo,
    runtimeBudget,
    runtimeCompatibility,
    physicalStateCache,
    bombAndSkills,
    failureRegressions,
    batchRiskRegressions,
    cloakRedesignRegressions,
    v20RealBattleRegressions,
    bolunOverloadRegressions,
    newGuardTiming,
    fixedStateMonteCarlo,
    monteCarloTiming,
    fixedStateMonteCarloTiming,
    featureTiming,
    decisionsPerSample: scenarioList.length * 30,
    medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(4)),
    minMs: Number(samples[0].toFixed(4)),
    maxMs: Number(samples[samples.length - 1].toFixed(4)),
    samples: samples.map(x => Number(x.toFixed(4)))
  }, null, 2));
}

if (require.main === module) main();

module.exports = { benchmarkAgentPass };
