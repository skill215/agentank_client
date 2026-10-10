#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Text } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { ProductionDiagnosticBot } =
  require("../simulation/production-diagnostic-bot");
const { V3DiagnosticBot } = require("../../../engine-v3/src");
const cohortTool = require("./v3-repair-cohort");
const arena = require("./v2-native-initiative-arena");
const { ACTION, HARD_STATUS, TERRAIN, NONE_CELL } =
  require("../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } =
  require("../../../engine-v2/src/state/fast-state");
const { NONE_HANDLE } =
  require("../../../engine-v2/src/abi/policy-codes");
const { SEARCH_CAPACITY } =
  require("../../../engine-v2/src/generated/search-config");
const { OPTION_KIND, StatefulOptionRollout } =
  require("./stateful-option-rollout");

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function copyAction(action) {
  if (!action || typeof action !== "object") return null;
  const output = { type: action.type };
  if (typeof action.side === "string") output.side = action.side;
  if (Number.isSafeInteger(action.x)) output.x = action.x;
  if (Number.isSafeInteger(action.y)) output.y = action.y;
  return output;
}

function actionObject(code, argument, state) {
  if (code === ACTION.GO) return { type: "go" };
  if (code === ACTION.TURN_LEFT) return { type: "turn", side: "left" };
  if (code === ACTION.TURN_RIGHT) return { type: "turn", side: "right" };
  if (code === ACTION.FIRE) return { type: "fire" };
  if (code === ACTION.THROW_BOMB) return { type: "throwBomb" };
  const skill = {
    [ACTION.CAST_SHIELD]: "shield",
    [ACTION.CAST_FREEZE]: "freeze",
    [ACTION.CAST_STUN]: "stun",
    [ACTION.CAST_OVERLOAD]: "overload",
    [ACTION.CAST_CLOAK]: "cloak",
    [ACTION.CAST_POISON]: "poison",
    [ACTION.CAST_TELEPORT]: "teleport",
    [ACTION.CAST_BOOST]: "boost"
  }[code];
  if (!skill) return null;
  if (code !== ACTION.CAST_TELEPORT) return { type: skill };
  if (argument === NONE_CELL || !state) return null;
  return { type: skill, x: state.x(argument), y: state.y(argument) };
}

function recordedAction(code, arguments_, frame) {
  if (code !== ACTION.CAST_TELEPORT) return actionObject(code, NONE_CELL, null);
  for (const entry of arguments_ || [])
    if (entry[0] === frame)
      return { type: "teleport", x: entry[1], y: entry[2] };
  return null;
}

function starProviderAfter(stars, frame) {
  let index = 0;
  while (index < stars.length && stars[index].frame <= frame) index += 1;
  return ({ frame: current }) => {
    const next = stars[index];
    if (!next || current < next.frame) return null;
    index += 1;
    return next.position.slice();
  };
}

function deterministicRandom(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 0x100000000;
  };
}

function chanceBranchOptions(root, scenario, candidateSeat,
    chanceOutcome = "HISTORICAL") {
  if (chanceOutcome === "HISTORICAL") return {
    cloneOptions: { starProvider: starProviderAfter(scenario.stars, root.frame) },
    chanceSeed: null
  };
  const seed = Number.parseInt(sha256Text([
    scenario.fingerprint, candidateSeat, root.frame, root.hashLo, root.hashHi,
    chanceOutcome
  ].join("\0")).slice(0, 8), 16) >>> 0;
  return { cloneOptions: { starProvider: null,
    rng: deterministicRandom(seed) }, chanceSeed: seed };
}

class FrameTrackingBot {
  constructor(bot) {
    this.bot = bot;
    this.lastFrame = -1;
    this.lastDecision = null;
  }
  decide(context) {
    this.lastFrame = context.game.frames;
    this.lastDecision = this.bot.decide(context);
    return this.lastDecision;
  }
}

function analysisOutcome(simulator, candidateSeat) {
  const me = simulator.players[candidateSeat];
  const enemy = simulator.players[candidateSeat ^ 1];
  if ((me.crashed && enemy.crashed) ||
      (!me.crashed && !enemy.crashed && simulator.frame >= simulator.maxFrames)) {
    if (me.stars === enemy.stars) return "DRAW";
    return me.stars > enemy.stars ? "V2_WIN" : "V1_WIN";
  }
  if (me.crashed) return "V1_WIN";
  if (enemy.crashed) return "V2_WIN";
  const winner = simulator.result?.winner;
  return winner === candidateSeat ? "V2_WIN" :
    winner === (candidateSeat ^ 1) ? "V1_WIN" : "DRAW";
}

function terminalLabel(simulator, candidateSeat) {
  const me = simulator.players[candidateSeat];
  const enemy = simulator.players[candidateSeat ^ 1];
  return {
    outcome: analysisOutcome(simulator, candidateSeat),
    frame: simulator.frame,
    reason: simulator.result?.reason || "UNKNOWN",
    candidateStars: me.stars,
    controlStars: enemy.stars,
    candidateCrashed: Boolean(me.crashed),
    controlCrashed: Boolean(enemy.crashed)
  };
}

function sameTerminal(left, right) {
  return left && right &&
    left.outcome === right.outcome &&
    left.frame === right.frame &&
    left.reason === right.reason &&
    left.candidateStars === right.candidateStars &&
    left.controlStars === right.controlStars &&
    left.candidateCrashed === right.candidateCrashed &&
    left.controlCrashed === right.controlCrashed;
}

function actionKey(action) {
  if (!action) return "null";
  return `${action.type || ""}:${action.side || ""}:${action.x ?? ""}:${action.y ?? ""}`;
}

function observedAction(action) {
  if (!action || typeof action !== "object") return ACTION.NONE;
  if (action.type === "go") return ACTION.GO;
  if (action.type === "turn") return action.side === "left" ?
    ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
  if (action.type === "fire") return ACTION.FIRE;
  if (action.type === "throwBomb") return ACTION.THROW_BOMB;
  const skill = {
    shield: ACTION.CAST_SHIELD,
    freeze: ACTION.CAST_FREEZE,
    stun: ACTION.CAST_STUN,
    overload: ACTION.CAST_OVERLOAD,
    cloak: ACTION.CAST_CLOAK,
    poison: ACTION.CAST_POISON,
    teleport: ACTION.CAST_TELEPORT,
    boost: ACTION.CAST_BOOST
  }[action.type];
  return skill === undefined ? ACTION.NONE : skill;
}

function temporalEvidence(ownHistory, enemyHistory) {
  const own = ownHistory.slice(-4);
  const enemy = enemyHistory.slice(-4);
  const count = (values, predicate) => values.reduce((sum, value) =>
    sum + (predicate(value) ? 1 : 0), 0);
  const repeats = values => {
    if (values.length === 0) return 0;
    const last = values[values.length - 1]; let total = 0;
    for (let at = values.length - 1; at >= 0 && values[at] === last; at -= 1)
      total += 1;
    return total;
  };
  const aggressive = value => value === ACTION.FIRE ||
    value === ACTION.THROW_BOMB || value === ACTION.CAST_STUN ||
    value === ACTION.CAST_POISON || value === ACTION.CAST_OVERLOAD;
  return {
    recentOwnActions: own,
    recentEnemyActions: enemy,
    ownLastAction: own.length ? own[own.length - 1] : ACTION.NONE,
    enemyLastAction: enemy.length ? enemy[enemy.length - 1] : ACTION.NONE,
    ownRepeatLength: repeats(own),
    enemyRepeatLength: repeats(enemy),
    ownRecentFireCount: count(own, value => value === ACTION.FIRE),
    enemyRecentFireCount: count(enemy, value => value === ACTION.FIRE),
    ownRecentAggressionCount: count(own, aggressive),
    enemyRecentAggressionCount: count(enemy, aggressive)
  };
}

function rootSearchEvidence(engine) {
  const physical = engine.depthSearch;
  const information = engine.informationSearch;
  const controller = engine.riskController;
  const obligation = engine.escapeObligation;
  const source = information.completedDepth > 0 ? "INFORMATION" :
    physical.completedDepth > 0 ? "PHYSICAL" : "NONE";
  const state = engine.adapter.state;
  const a = state.arrays;
  const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
  const ownStarDistance = star === NONE_CELL ? 0 :
    engine.starDistance(a[ARRAY.TANK_CELL][0]);
  const enemyStarDistance = star === NONE_CELL ? 0 :
    engine.starDistance(a[ARRAY.TANK_CELL][1]);
  return {
    ownCell: a[ARRAY.TANK_CELL][0],
    ownDirection: a[ARRAY.TANK_DIR][0],
    enemyCell: a[ARRAY.TANK_CELL][1],
    enemyDirection: a[ARRAY.TANK_DIR][1],
    ownStars: a[ARRAY.TANK_STARS][0],
    enemyStars: a[ARRAY.TANK_STARS][1],
    starCell: a[ARRAY.SCALAR][SCALAR.STAR_CELL],
    ownStarDistance,
    enemyStarDistance,
    starRaceAdvantage: enemyStarDistance - ownStarDistance,
    mapWidth: state.width,
    mapHeight: state.height,
    ownEnemyDistance: engine.manhattan(a[ARRAY.TANK_CELL][0],
      a[ARRAY.TANK_CELL][1]),
    ownFacesEnemy: engine.directionTo(a[ARRAY.TANK_CELL][0],
      a[ARRAY.TANK_CELL][1]) === a[ARRAY.TANK_DIR][0],
    enemyFacesOwn: engine.directionTo(a[ARRAY.TANK_CELL][1],
      a[ARRAY.TANK_CELL][0]) === a[ARRAY.TANK_DIR][1],
    clearLineToEnemy: Boolean(engine.clearLine(a[ARRAY.TANK_CELL][0],
      a[ARRAY.TANK_CELL][1])),
    ownMobility: engine.countMobility(a[ARRAY.TANK_CELL][0]),
    enemyMobility: engine.countMobility(a[ARRAY.TANK_CELL][1]),
    lastAction: engine.lastAction,
    turnStreak: engine.turnStreak,
    goStallStreak: engine.goStallStreak,
    ownCanFire: Boolean(engine.adapter.ownCanFire),
    ownBombReady: Boolean(engine.adapter.ownBombReady),
    ownSkillReady: Boolean(engine.adapter.ownSkillReady),
    enemyCanFire: Boolean(engine.adapter.enemyCanFire),
    committedProjectileCount: state.activeProjectileCount(),
    committedBombCount: state.activeBombCount(),
    enemyVisible: Boolean(engine.adapter.enemyVisible),
    informationComplete: Boolean(engine.adapter.informationComplete),
    hiddenWorldCount: engine.hiddenWorldCount,
    hiddenSupportComplete: Boolean(engine.hiddenSupportComplete),
    possibleProjectileCount: engine.possibleProjectiles.count(),
    runtimeMode: engine.runtime.runtimeMode,
    accumulatedWorkUnits: engine.runtime.accumulatedWorkUnits,
    decisionDepthBudget: engine.searchOptions.decisionDepth,
    valueNodeBudget: engine.searchOptions.nodeBudget,
    proofNodeBudget: engine.searchOptions.proofBudget,
    ourActionCount: engine.ourCount,
    enemyActionCount: engine.enemyCount,
    strategicProfile: engine.strategicProfile,
    strategyId: engine.policy.strategyId,
    planArbitrationEnabled: Boolean(engine.planArbitrationEnabled),
    proposalArbiterEnabled: Boolean(engine.policy.proposalArbiter.enabled),
    selectedStrategyBand: engine.strategyBands.selectedBand,
    strategyBaseAnchorRow: engine.strategyBands.baseAnchorRow,
    source,
    physical: {
      completedDepth: physical.completedDepth,
      attemptedDepth: physical.attemptedDepth,
      nodes: physical.nodes,
      supportComplete: Boolean(physical.representativeSupportComplete),
      expansionLimit: physical.completedExpansionLimit,
      generatedMax: physical.completedGeneratedMax,
      truncatedCount: physical.completedTruncatedCount,
      continuationUsable: Boolean(physical.lastContinuationUsable),
      continuationComplete: Boolean(physical.lastContinuationComplete)
    },
    information: {
      completedDepth: information.completedDepth,
      attemptedDepth: information.attemptedDepth,
      nodes: information.nodes,
      worldsEvaluated: information.worldsEvaluated,
      supportComplete: Boolean(information.supportComplete),
      approximate: Boolean(information.approximate),
      continuationLeafBudget: information.continuationLeafBudget,
      continuationPoolRemaining: information.continuationPoolRemaining
    },
    risk: {
      adjustedRisk: controller.risk,
      stateRiskClass: controller.stateRiskClass,
      immediateLimit: controller.immediateLimit,
      horizonLimit: controller.horizonLimit,
      unknownLimit: controller.unknownLimit,
      minimumEscapeSlack: controller.minimumEscapeSlack,
      acceptableCount: controller.acceptableCount,
      safeFloor: controller.safeFloor
    },
    committedEscape: {
      supportStatus: obligation.supportStatus,
      entityCount: obligation.committedEntityCount,
      rootSlack: obligation.rootSlack,
      memberCount: obligation.firstActionCount,
      qualityReady: Boolean(obligation.successorQualityReady)
    },
    priorContinuation: {
      action: engine.diagnosticPriorContinuation ?? ACTION.NONE,
      requestedRow: engine.diagnosticContinuationRow ?? -1,
      committed: Boolean(engine.diagnosticContinuationCommitted)
    }
  };
}

function rootStratum(evidence) {
  if (evidence?.source === "INFORMATION") return "INFORMATION_SEARCH";
  if (evidence?.source === "PHYSICAL") return "PHYSICAL_SEARCH";
  if ((evidence?.committedProjectileCount || 0) > 0 ||
      (evidence?.committedBombCount || 0) > 0) return "COMMITTED_HAZARD";
  if (evidence?.enemyVisible &&
      ((evidence?.ownEnemyDistance || 255) <= 9 || evidence?.clearLineToEnemy))
    return "TACTICAL_CONTACT_NO_SEARCH";
  return "STRATEGIC_NAVIGATION";
}

function candidateGeometry(engine, cell, direction) {
  const state = engine.adapter.state; const a = state.arrays;
  const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
  const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
  const currentStarDistance = star === NONE_CELL ? 0 : engine.starDistance(own);
  const projectedStarDistance = star === NONE_CELL ? 0 : engine.starDistance(cell);
  const terrain = a[ARRAY.TERRAIN];
  const passable = target => target !== NONE_CELL &&
    terrain[target] !== TERRAIN.WALL && terrain[target] !== TERRAIN.DIRT;
  const degree = target => {
    let total = 0;
    for (let side = 0; side < 4; side += 1)
      total += passable(engine.target(target, side)) ? 1 : 0;
    return total;
  };
  let projectedForwardClearance = 0; let forward = cell;
  for (; projectedForwardClearance < 8; projectedForwardClearance += 1) {
    const next = engine.target(forward, direction);
    if (!passable(next)) break;
    forward = next;
  }
  const cells = state.cells || state.width * state.height;
  const queue = new Uint16Array(cells); const distance = new Uint8Array(cells);
  const seen = new Uint8Array(cells); let head = 0; let tail = 0;
  queue[tail++] = cell; seen[cell] = 1;
  let projectedJunctionDistance = degree(cell) >= 3 ? 0 : 255;
  while (head < tail && projectedJunctionDistance === 255) {
    const current = queue[head++]; const nextDistance = distance[current] + 1;
    if (nextDistance > 8) continue;
    for (let side = 0; side < 4; side += 1) {
      const next = engine.target(current, side);
      if (!passable(next) || seen[next]) continue;
      seen[next] = 1; distance[next] = nextDistance;
      if (degree(next) >= 3) { projectedJunctionDistance = nextDistance; break; }
      queue[tail++] = next;
    }
  }
  seen.fill(0); distance.fill(0); head = 0; tail = 0;
  queue[tail++] = cell; seen[cell] = 1;
  let projectedEnemyPathDistance = cell === enemy ? 0 : 255;
  while (head < tail && projectedEnemyPathDistance === 255) {
    const current = queue[head++]; const nextDistance = distance[current] + 1;
    for (let side = 0; side < 4; side += 1) {
      const next = engine.target(current, side);
      if (!passable(next) || seen[next]) continue;
      seen[next] = 1; distance[next] = nextDistance;
      if (next === enemy) { projectedEnemyPathDistance = nextDistance; break; }
      queue[tail++] = next;
    }
  }
  return {
    projectedEnemyDistance: engine.manhattan(cell, enemy),
    projectedOwnFacesEnemy: engine.directionTo(cell, enemy) === direction,
    projectedEnemyFacesOwn: engine.directionTo(enemy, cell) === a[ARRAY.TANK_DIR][1],
    projectedClearLineToEnemy: Boolean(engine.clearLine(cell, enemy)),
    projectedMobility: engine.countMobility(cell),
    projectedOpenDegree: degree(cell),
    projectedForwardClearance,
    projectedJunctionDistance,
    projectedEnemyPathDistance,
    projectedStarDistance,
    projectedStarProgress: currentStarDistance - projectedStarDistance
  };
}

function installContinuationAudit(engine) {
  engine.diagnosticPriorContinuation = ACTION.NONE;
  engine.diagnosticContinuationRow = -1;
  engine.diagnosticContinuationCommitted = 0;
  const risk = engine.multiFrameRisk;
  const originalRecommended = risk.recommendedContinuation.bind(risk);
  risk.recommendedContinuation = state => {
    const action = originalRecommended(state);
    engine.diagnosticPriorContinuation = action;
    engine.diagnosticContinuationRow = -1;
    engine.diagnosticContinuationCommitted = 0;
    return action;
  };
  const controller = engine.riskController;
  const originalCommit = controller.commitContinuation.bind(controller);
  controller.commitContinuation = row => {
    const result = originalCommit(row);
    engine.diagnosticContinuationRow = row;
    engine.diagnosticContinuationCommitted = result;
    return result;
  };
}

function optionBestRow(candidates, rollout, combatFirst, group = "ALL") {
  if (!rollout) return -1;
  let best = -1;
  for (let index = 0; index < candidates.length; index += 1) {
    const row = candidates[index].row; const kind = rollout.kind[row];
    if (group === "POSITION" && kind !== OPTION_KIND.POSITION) continue;
    if (group === "RESOURCE" && (kind === OPTION_KIND.POSITION ||
        kind === OPTION_KIND.WAIT)) continue;
    if (rollout.compare(row, best, combatFirst)) best = row;
  }
  return best;
}

function captureCandidates(engine, optionRollout = null) {
  const outcome = engine.riskController.outcome;
  const state = engine.adapter.state;
  const source = engine.informationSearch.completedDepth > 0 ?
    engine.informationSearch : engine.depthSearch.completedDepth > 0 ?
      engine.depthSearch : null;
  const combat = engine.combat.vector;
  const obligation = engine.escapeObligation;
  const sketches = engine.policy.sketches;
  if (optionRollout) optionRollout.evaluate(engine.adapter.bundle,
    engine.ourActions, engine.ourArguments, engine.ourCount);
  const rows = [];
  for (let row = 0; row < outcome.count; row += 1) {
    const hard = engine.hardStatus[row];
    if (hard === HARD_STATUS.REJECT_PROVEN ||
        hard === HARD_STATUS.REJECT_POLICY) continue;
    const action = actionObject(engine.ourActions[row],
      engine.ourArguments[row], state);
    if (!action) continue;
    let searchMinimum = 32001;
    let searchMaximum = -32001;
    if (source) {
      for (let column = 0; column < engine.enemyCount; column += 1) {
        const value = source.rootCellScore[
          row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column];
        if (value < searchMinimum) searchMinimum = value;
        if (value > searchMaximum) searchMaximum = value;
      }
    }
    const handle = engine.planSketchHandle[row];
    const hasPlan = handle !== NONE_HANDLE && handle < sketches.used;
    const geometry = candidateGeometry(engine, engine.projectedCell[row],
      engine.projectedDirection[row]);
    rows.push({
      row,
      actionCode: engine.ourActions[row],
      argument: engine.ourArguments[row],
      action,
      hard,
      projectedCell: engine.projectedCell[row],
      projectedDirection: engine.projectedDirection[row],
      projectedPathDistance: engine.path.read(engine.projectedCell[row]),
      ...geometry,
      acceptable: Boolean(outcome.acceptable[row]),
      dominated: Boolean(outcome.dominated[row]),
      safetyStatus: outcome.safety[row],
      coverage: outcome.coverage[row],
      immediateFatalMass: outcome.immediateFatalMass[row],
      horizonFatalMass: outcome.horizonFatalMass[row],
      unknownMass: outcome.unknownMass[row],
      committedFatalMass: outcome.committedFatalMass[row],
      possibleProjectileFatalMass: outcome.possibleProjectileFatalMass[row],
      futureFireFatalMass: outcome.futureFireFatalMass[row],
      earliestFatalFrame: outcome.earliestFatalFrame[row],
      escapeSlack: outcome.escapeSlack[row],
      unknownFallbackRisk: outcome.unknownFallbackRisk[row],
      worstValue: outcome.worstValue[row],
      nominalRobustLower: outcome.nominalRobustLower[row],
      robustLower: outcome.robustLower[row],
      expectedValue: outcome.expectedValue[row],
      tacticalValue: outcome.tacticalValue[row],
      searchMinimum: source ? searchMinimum : null,
      searchMaximum: source ? searchMaximum : null,
      searchSpread: source ? searchMaximum - searchMinimum : null,
      policyProbability: engine.policyProbability[row],
      strategyPurpose: engine.strategyBands.purpose[row],
      strategySelected: Boolean(engine.strategyBands.selected[row]),
      strategyBand: engine.strategyBands.band[row],
      strategyOwner: engine.strategyBands.ownerStrategy[row],
      planContinuity: engine.strategyBands.planContinuity[row],
      combatPurpose: outcome.combatPurpose[row],
      purposeCompleteness: outcome.purposeCompleteness[row],
      hitDeadline: outcome.hitDeadline[row],
      enemySafeSuccessors: outcome.enemySafeSuccessors[row],
      ownCounterExposure: outcome.ownCounterExposure[row],
      blockadeValue: outcome.blockadeValue[row],
      postFireEscape: outcome.postFireEscape[row],
      combatPressure: outcome.combatPressure[row],
      combatRobustPressure: outcome.combatRobustPressure[row],
      possibleHit: Boolean(combat.possibleHit[row]),
      attackClosureStatus: combat.attackClosureStatus[row],
      enemyDoomedFirstActions: combat.enemyDoomedFirstActions[row],
      enemySurvivingFirstActions: combat.enemySurvivingFirstActions[row],
      enemyUnknownFirstActions: combat.enemyUnknownFirstActions[row],
      attackDoomedByFrame: combat.attackDoomedByFrame[row],
      attackPressureContribution: combat.attackPressureContribution[row],
      escapeMember: Boolean(obligation.member[row]),
      escapeSuccessorProof: obligation.successorProof[row],
      escapeSuccessorExposed: Boolean(obligation.successorExposed[row]),
      escapeSuccessorSlack: obligation.successorSlack[row],
      escapeSuccessorBranches: obligation.successorBranches[row],
      escapeSuccessorCoverage: Boolean(obligation.successorCoverage[row]),
      optionRollout: optionRollout ? optionRollout.snapshot(row) : null,
      plan: hasPlan ? {
        kind: sketches.kind[handle],
        purpose: sketches.purpose[handle],
        deadline: sketches.deadline[handle],
        rawScore: sketches.rawScore[handle],
        dependencyMask: sketches.dependencyMask[handle],
        targetSignature: sketches.targetSignature[handle]
      } : null
    });
  }
  return rows;
}

function branchBots(candidateSeat, engineOptions) {
  const candidate = new ProductionDiagnosticBot({
    engine: engineOptions,
    captureExceptionalFrames: false
  });
  const control = new V3DiagnosticBot();
  return candidateSeat === 0 ? [candidate, control] : [control, candidate];
}

const RESPONSE_POLICY = Object.freeze({
  V2: "V2",
  V3: "V3"
});

function responsePolicyBot(policy, engineOptions) {
  if (policy === RESPONSE_POLICY.V2) return new ProductionDiagnosticBot({
    engine: engineOptions,
    captureExceptionalFrames: false
  });
  if (policy === RESPONSE_POLICY.V3) return new V3DiagnosticBot();
  throw new Error(`ROOT_LABEL_RESPONSE_POLICY:${policy}`);
}

class ResponseTraceBot {
  constructor(bot, limit = 8) {
    this.bot = bot; this.limit = limit; this.actions = [];
  }
  record(action) {
    if (this.actions.length < this.limit) this.actions.push(observedAction(action));
  }
  decide(context) {
    const decision = this.bot.decide(context);
    this.record(decision?.action);
    return decision;
  }
}

// Deliberately reset controller-private history at the exact physical root.
// This makes each matrix cell comparable and prevents the baseline
// controller's hidden state from privileging its own selected action.  The
// forced candidate action is applied first; both policies then own the suffix.
function runResponseMatrixBranch(root, row, scenario, candidateSeat,
    engineOptions, ownPolicy, enemyPolicy, chanceOutcome = "HISTORICAL") {
  const chance = chanceBranchOptions(root, scenario, candidateSeat,
    chanceOutcome);
  const simulator = root.simulator.clone(chance.cloneOptions);
  const enemySeat = candidateSeat ^ 1;
  const ownBot = new ResponseTraceBot(responsePolicyBot(ownPolicy,
    engineOptions));
  const enemyBot = new ResponseTraceBot(responsePolicyBot(enemyPolicy,
    engineOptions));
  const enemyDecision = enemyBot.decide(simulator.snapshotFor(enemySeat)) || {};
  const actions = [null, null];
  const decisions = [{ action: null, logs: [], runtimeMs: 0 },
    { action: null, logs: [], runtimeMs: 0 }];
  actions[candidateSeat] = copyAction(row.action);
  ownBot.record(actions[candidateSeat]);
  decisions[candidateSeat] = { action: actions[candidateSeat], logs: [],
    runtimeMs: 0 };
  actions[enemySeat] = copyAction(enemyDecision.action);
  decisions[enemySeat] = { action: actions[enemySeat],
    logs: Array.isArray(enemyDecision.logs) ? enemyDecision.logs : [],
    runtimeMs: Number(enemyDecision.runtimeMs || 0) };
  simulator.step(actions, decisions);
  if (!simulator.result && simulator.frame < simulator.maxFrames) {
    const bots = candidateSeat === 0 ? [ownBot, enemyBot] : [enemyBot, ownBot];
    simulator.run(bots[0], bots[1]);
  }
  return {
    ownPolicy,
    enemyPolicy,
    chanceOutcome,
    chanceSeed: chance.chanceSeed,
    enemyRootAction: copyAction(actions[enemySeat]),
    ownActionPrefix: ownBot.actions.slice(),
    enemyActionPrefix: enemyBot.actions.slice(),
    terminal: terminalLabel(simulator, candidateSeat)
  };
}

function responseMatrix(root, row, scenario, candidateSeat, engineOptions,
    policies, chanceOutcomes = ["HISTORICAL"], ownPolicies = policies,
    enemyPolicies = policies) {
  if (!root.simulator || !ownPolicies.length || !enemyPolicies.length)
    return null;
  const cells = [];
  for (const chanceOutcome of chanceOutcomes)
    for (const ownPolicy of ownPolicies)
      for (const enemyPolicy of enemyPolicies)
        cells.push(runResponseMatrixBranch(root, row, scenario, candidateSeat,
          engineOptions, ownPolicy, enemyPolicy, chanceOutcome));
  return { resetControllerHistory: true, policies: policies.slice(),
    ownPolicies: ownPolicies.slice(), enemyPolicies: enemyPolicies.slice(),
    chanceOutcomes: chanceOutcomes.slice(), cells };
}

function horizonSnapshot(simulator, candidateSeat, rootFrame) {
  const me = simulator.players[candidateSeat];
  const enemy = simulator.players[candidateSeat ^ 1];
  const mePosition = Array.isArray(me.position) ? me.position :
    Array.isArray(me.tank?.position) ? me.tank.position : null;
  const enemyPosition = Array.isArray(enemy.position) ? enemy.position :
    Array.isArray(enemy.tank?.position) ? enemy.tank.position : null;
  return {
    delta: Math.max(0, simulator.frame - rootFrame),
    frame: simulator.frame,
    terminal: Boolean(simulator.result),
    candidateStars: me.stars,
    controlStars: enemy.stars,
    candidateCrashed: Boolean(me.crashed),
    controlCrashed: Boolean(enemy.crashed),
    candidatePosition: mePosition ? mePosition.slice() : null,
    controlPosition: enemyPosition ? enemyPosition.slice() : null,
    tankDistance: mePosition && enemyPosition ?
      Math.abs(mePosition[0] - enemyPosition[0]) +
      Math.abs(mePosition[1] - enemyPosition[1]) : null
  };
}

function captureHorizons(simulator, rootFrame, candidateSeat) {
  const wanted = [1, 4, 8, 16];
  const output = [];
  const originalStep = simulator.step.bind(simulator);
  simulator.step = (actions, decisions) => {
    const result = originalStep(actions, decisions);
    while (output.length < wanted.length &&
        simulator.frame - rootFrame >= wanted[output.length])
      output.push(horizonSnapshot(simulator, candidateSeat, rootFrame));
    return result;
  };
  return {
    output,
    finish() {
      while (output.length < wanted.length)
        output.push(horizonSnapshot(simulator, candidateSeat, rootFrame));
      return output;
    }
  };
}

function runBranch(root, row, scenario, candidateSeat, engineOptions) {
  const simulator = root.simulator.clone({
    starProvider: starProviderAfter(scenario.stars, root.frame)
  });
  const horizons = captureHorizons(simulator, root.frame, candidateSeat);
  const actions = root.actions.map(copyAction);
  actions[candidateSeat] = copyAction(row.action);
  const decisions = [{ action: actions[0], logs: [], runtimeMs: 0 },
    { action: actions[1], logs: [], runtimeMs: 0 }];
  simulator.step(actions, decisions);
  if (!simulator.result && simulator.frame < simulator.maxFrames) {
    const bots = branchBots(candidateSeat, engineOptions);
    simulator.run(bots[0], bots[1]);
  }
  return {
    terminal: terminalLabel(simulator, candidateSeat),
    horizons: horizons.finish()
  };
}

function runReplayBranch(module, root, row, scenario, candidateSeat,
    engineOptions, forcedSequence = null, chanceOutcome = "HISTORICAL",
    diagnosticBotOptions = null, replayPrefix = null) {
  const built = arena.field(module, scenario, candidateSeat,
    replayPrefix?.seatSkills || null);
  const chance = chanceBranchOptions(root, scenario, candidateSeat,
    chanceOutcome);
  const horizons = captureHorizons(built.simulator, root.frame, candidateSeat);
  const candidateStream = replayPrefix?.candidateActionStream ||
    replayPrefix?.actionStream;
  const prefixActions = candidateStream ?
    Buffer.from(candidateStream, "base64") : null;
  const prefixArguments = replayPrefix?.candidateArguments ||
    replayPrefix?.arguments || [];
  const requestedOptions = diagnosticBotOptions || {};
  const requestedOverride = requestedOptions.diagnosticFinalActionOverride;
  const replayOverride = prefixActions ? function(engine_, action, argument,
      context) {
    const frame = context?.game?.frames;
    if (Number.isSafeInteger(frame) && frame < root.frame &&
        frame < prefixActions.length) {
      const actionCode = prefixActions[frame]; let actionArgument = NONE_CELL;
      if (actionCode === ACTION.CAST_TELEPORT)
        for (const entry of prefixArguments)
          if (entry[0] === frame) {
            actionArgument = engine_.adapter.state.cell(entry[1], entry[2]); break;
          }
      return { action: actionCode, argument: actionArgument };
    }
    return typeof requestedOverride === "function" ?
      requestedOverride(engine_, action, argument, context) : null;
  } : requestedOverride;
  const candidate = new ProductionDiagnosticBot({
    ...requestedOptions,
    diagnosticFinalActionOverride: replayOverride,
    engine: engineOptions,
    captureExceptionalFrames: false
  });
  const engine = candidate.engine;
  const originalSelect = engine.finalGate.select.bind(engine.finalGate);
  let targetFrameSeen = 0;
  let physicalRootMatched = 0;
  let observedHashLo = 0; let observedHashHi = 0;
  let forced = 0;
  let sequenceRequested = 0; let sequenceForced = 0;
  let sequenceFallback = 0; let sequenceAbortedFrame = -1;
  engine.finalGate.select = (bundle, actions, arguments_, count, preferred,
      order, orderCount) => {
    const selected = originalSelect(bundle, actions, arguments_, count,
      preferred, order, orderCount);
    const state = engine.adapter.state;
    if (!state) return selected;
    const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const sequenceIndex = frame - root.frame;
    if (sequenceIndex < 0 || (forcedSequence ?
        sequenceIndex >= forcedSequence.length : sequenceIndex !== 0)) return selected;
    if (sequenceIndex === 0) {
      targetFrameSeen = 1;
      observedHashLo = state.hashLo; observedHashHi = state.hashHi;
      if (state.hashLo !== root.hashLo || state.hashHi !== root.hashHi)
        return selected;
      physicalRootMatched = 1;
      if (chanceOutcome !== "HISTORICAL") {
        built.simulator.starProvider = chance.cloneOptions.starProvider;
        built.simulator.rng = chance.cloneOptions.rng;
      }
    }
    const desired = forcedSequence ? forcedSequence[sequenceIndex] :
      { actionCode: row.actionCode, argument: row.argument };
    sequenceRequested += 1;
    for (let index = 0; index < count; index += 1) {
      if (actions[index] !== desired.actionCode ||
          arguments_[index] !== desired.argument) continue;
      if (!engine.finalGate.finalAllows(bundle, actions, arguments_, index,
        count)) break;
      engine.finalGate.lastSelected = index;
      if (index !== selected) engine.finalGate.overrideCount += 1;
      forced = 1; sequenceForced += 1;
      return index;
    }
    sequenceFallback += 1;
    if (sequenceAbortedFrame < 0) sequenceAbortedFrame = frame;
    return selected;
  };
  const controlDelegate = new V3DiagnosticBot();
  const controlActions = replayPrefix?.controlActionStream ?
    Buffer.from(replayPrefix.controlActionStream, "base64") : null;
  const controlArguments = replayPrefix?.controlArguments || [];
  const control = controlActions ? { decide(context) {
    const decision = controlDelegate.decide(context);
    const frame = context?.game?.frames;
    if (!Number.isSafeInteger(frame) || frame >= root.frame ||
        frame >= controlActions.length) return decision;
    const action = recordedAction(controlActions[frame], controlArguments, frame);
    return { ...decision, action };
  } } : controlDelegate;
  const bots = candidateSeat === 0 ? [candidate, control] : [control, candidate];
  built.simulator.run(bots[0], bots[1]);
  return {
    chanceOutcome,
    chanceSeed: chance.chanceSeed,
    terminal: terminalLabel(built.simulator, candidateSeat),
    horizons: horizons.finish(),
    evidence: {
      targetFrameSeen: Boolean(targetFrameSeen),
      physicalRootMatched: Boolean(physicalRootMatched),
      observedHashLo, observedHashHi,
      forced: Boolean(forced), sequenceRequested, sequenceForced,
      sequenceFallback, sequenceAbortedFrame,
      sequenceSatisfied: sequenceFallback === 0 &&
        (sequenceForced === (forcedSequence?.length || 1) ||
         Boolean(built.simulator.result))
    }
  };
}

function exactHistoryChanceMatrix(module, root, row, scenario, candidateSeat,
    engineOptions, chanceOutcomes) {
  const cells = chanceOutcomes.map(chanceOutcome => {
    const branch = runReplayBranch(module, root, row, scenario, candidateSeat,
      engineOptions, null, chanceOutcome);
    return { ownPolicy: "V2", enemyPolicy: "V3", chanceOutcome,
      chanceSeed: branch.chanceSeed, exactControllerHistory: true,
      branchEvidence: branch.evidence, terminal: branch.terminal };
  });
  return { resetControllerHistory: false, exactControllerHistory: true,
    policies: ["V2", "V3"], ownPolicies: ["V2"], enemyPolicies: ["V3"],
    chanceOutcomes: chanceOutcomes.slice(), cells };
}

async function playAndCapture(module, scenario, candidateSeat, rootsPerLoss,
    rootStride, branchMode, engineOptions, targetFrame, captureOutcomes,
    optionSequences, responsePolicies = [], samplingMode = "LATEST",
    chanceOutcomes = ["HISTORICAL"], ownResponsePolicies = responsePolicies,
    enemyResponsePolicies = responsePolicies,
    exactHistoryChanceEnabled = false) {
  const built = arena.field(module, scenario, candidateSeat);
  const candidateBot = new ProductionDiagnosticBot({
    engine: engineOptions,
    captureExceptionalFrames: false
  });
  const optionRollout = new StatefulOptionRollout();
  installContinuationAudit(candidateBot.engine);
  const candidate = new FrameTrackingBot(candidateBot);
  const control = new FrameTrackingBot(new V3DiagnosticBot());
  const bots = candidateSeat === 0 ? [candidate, control] : [control, candidate];
  const captures = [];
  const stratifiedCaptures = new Map();
  const recentActions = [[], []];
  const originalStep = built.simulator.step.bind(built.simulator);
  built.simulator.step = (actions, decisions) => {
    const proposalRow = samplingMode === "PROPOSAL" &&
      candidateBot.attackObjectiveField ?
      candidateBot.attackObjectiveField.lastProposal : -1;
    const proposalDifferent = proposalRow >= 0 &&
      candidateBot.engine.ourActions[proposalRow] !==
        observedAction(actions[candidateSeat]);
    const scheduled = samplingMode === "PROPOSAL" ? proposalDifferent :
      (targetFrame >= 0 ? built.simulator.frame === targetFrame :
        built.simulator.frame % rootStride === 0);
    if (candidate.lastFrame === built.simulator.frame &&
        actions[candidateSeat] && built.simulator.frame <= 120 &&
        scheduled && (samplingMode !== "PROPOSAL" || captures.length < rootsPerLoss)) {
      const searchEvidence = {
        ...rootSearchEvidence(candidateBot.engine),
        ...temporalEvidence(recentActions[candidateSeat],
          recentActions[candidateSeat ^ 1])
      };
      const samplingStratum = rootStratum(searchEvidence);
      const existingBucket = stratifiedCaptures.get(samplingStratum) || [];
      if (samplingMode !== "STRATIFIED" ||
          existingBucket.length < rootsPerLoss) {
      const candidates = captureCandidates(candidateBot.engine, optionRollout);
      const capture = {
        frame: built.simulator.frame,
        simulator: branchMode === "RESET_SUFFIX" ?
          built.simulator.clone({ starProvider: null }) : null,
        hashLo: candidateBot.engine.adapter.state.hashLo,
        hashHi: candidateBot.engine.adapter.state.hashHi,
        actions: actions.map(copyAction),
        selectedAction: copyAction(actions[candidateSeat]),
        proposalRow,
        controlMode: candidateBot.engine.lastControlMode,
        noAcceptableAction:
          Boolean(candidateBot.engine.riskController.noAcceptableAction),
        searchEvidence,
        samplingStratum,
        optionRollout: {
          horizon: optionRollout.horizon,
          balancedRow: optionBestRow(candidates, optionRollout, false),
          combatRow: optionBestRow(candidates, optionRollout, true),
          positionRow: optionBestRow(candidates, optionRollout, false,
            "POSITION"),
          resourceRow: optionBestRow(candidates, optionRollout, true,
            "RESOURCE"),
          transitionCount: optionRollout.transitionCount,
          incompleteCount: optionRollout.incompleteCount,
          hardFatalCount: optionRollout.hardFatalCount,
          rootRestoreFailureCount: optionRollout.rootRestoreFailureCount
        },
        candidates
      };
      if (samplingMode === "STRATIFIED") {
        existingBucket.push(capture);
        stratifiedCaptures.set(capture.samplingStratum, existingBucket);
      } else {
        captures.push(capture);
        if (samplingMode !== "PROPOSAL" && captures.length > rootsPerLoss)
          captures.shift();
      }
      }
    }
    for (let seat = 0; seat < 2; seat += 1) {
      recentActions[seat].push(observedAction(actions[seat]));
      if (recentActions[seat].length > 4) recentActions[seat].shift();
    }
    return originalStep(actions, decisions);
  };
  built.simulator.run(bots[0], bots[1]);
  const baseline = terminalLabel(built.simulator, candidateSeat);
  if (!captureOutcomes.has(baseline.outcome)) return {
    matchUrlId: scenario.matchUrlId,
    candidateSeat,
    baseline,
    roots: []
  };
  const selectedCaptures = samplingMode === "STRATIFIED" ?
    Array.from(stratifiedCaptures.values()).flat()
      .sort((left, right) => left.frame - right.frame) : captures;
  const roots = selectedCaptures.map(root => {
    const selectedRow = root.candidates.find(row =>
      actionKey(row.action) === actionKey(root.selectedAction))?.row ?? -1;
    const branchCandidates = root.proposalRow >= 0 ? root.candidates.filter(row =>
      row.row === selectedRow || row.row === root.proposalRow) : root.candidates;
    const labels = branchCandidates.map(row => {
      const branch = branchMode === "EXACT_REPLAY" ?
        runReplayBranch(module, root, row, scenario, candidateSeat,
          engineOptions) :
        { ...runBranch(root, row, scenario, candidateSeat, engineOptions),
          evidence: { targetFrameSeen: true, physicalRootMatched: true,
            forced: true } };
      const optionBranch = optionSequences && branchMode === "EXACT_REPLAY" &&
        row.optionRollout?.sequence?.length > 1 ?
        runReplayBranch(module, root, row, scenario, candidateSeat,
          engineOptions, row.optionRollout.sequence) : null;
      return { ...row,
        planDeadlineRemaining: row.plan ? Math.max(0,
          row.plan.deadline - root.frame) : null,
        branchEvidence: branch.evidence,
        horizons: branch.horizons,
        terminal: branch.terminal,
        optionBranchEvidence: optionBranch?.evidence || null,
        optionHorizons: optionBranch?.horizons || null,
        optionTerminal: optionBranch?.terminal || null,
        responseMatrix: exactHistoryChanceEnabled ? exactHistoryChanceMatrix(
          module, root, row, scenario, candidateSeat, engineOptions,
          chanceOutcomes) : responseMatrix(root, row, scenario, candidateSeat,
            engineOptions, responsePolicies, chanceOutcomes,
            ownResponsePolicies, enemyResponsePolicies) };
    });
    const selected = labels.find(label => label.row === selectedRow);
    return {
      frame: root.frame,
      hashLo: root.hashLo,
      hashHi: root.hashHi,
      controlMode: root.controlMode,
      samplingStratum: root.samplingStratum,
      noAcceptableAction: root.noAcceptableAction,
      optionRollout: root.optionRollout,
      selectedAction: root.selectedAction,
      selectedRow,
      proposalRow: root.proposalRow,
      selectedReproduced: branchMode === "EXACT_REPLAY" ?
        Boolean(selected && selected.branchEvidence.forced &&
          sameTerminal(selected.terminal, baseline)) : null,
      searchEvidence: root.searchEvidence,
      labels
    };
  });
  return {
    matchUrlId: scenario.matchUrlId,
    scenarioFingerprint: scenario.fingerprint,
    candidateSeat,
    baseline,
    roots
  };
}

async function run(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const cohortFile = path.resolve(option("--cohort",
    path.join(root, "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const scenarioCount = positiveInteger(option("--scenarios", "2"), 2);
  const offset = Math.max(0, Number(option("--offset", "0")) | 0);
  const rootsPerLoss = positiveInteger(option("--roots-per-loss", "2"), 2);
  const rootStride = positiveInteger(option("--root-stride", "4"), 4);
  const targetFrame = Number(option("--target-frame", "-1"));
  if (!Number.isSafeInteger(targetFrame) || targetFrame < -1 ||
      targetFrame > 120)
    throw new Error(`ROOT_LABEL_TARGET_FRAME:${targetFrame}`);
  const captureOutcomes = new Set(option("--capture-outcomes", "V1_WIN")
    .split(",").map(value => value.trim().toUpperCase()).filter(Boolean));
  for (const outcome of captureOutcomes)
    if (outcome !== "V1_WIN" && outcome !== "V2_WIN" && outcome !== "DRAW")
      throw new Error(`ROOT_LABEL_CAPTURE_OUTCOME:${outcome}`);
  const branchMode = option("--branch-mode", "EXACT_REPLAY").toUpperCase();
  const softSlackMode =
    option("--soft-escape-slack-dominance", "on").toLowerCase();
  const optionSequencesMode = option("--option-sequences", "off").toLowerCase();
  const responsePolicies = option("--response-policies", "")
    .split(",").map(value => value.trim().toUpperCase()).filter(Boolean);
  const parsePolicyList = value => value.split(",")
    .map(item => item.trim().toUpperCase()).filter(Boolean);
  const ownResponsePolicies = parsePolicyList(option("--own-response-policies",
    ""));
  const enemyResponsePolicies = parsePolicyList(option(
    "--enemy-response-policies", ""));
  if (!ownResponsePolicies.length)
    ownResponsePolicies.push(...responsePolicies);
  if (!enemyResponsePolicies.length)
    enemyResponsePolicies.push(...responsePolicies);
  const chanceOutcomes = Array.from(new Set(option("--chance-outcomes",
    "HISTORICAL").split(",").map(value => value.trim().toUpperCase())
    .filter(Boolean)));
  const samplingMode = option("--root-sampling", "LATEST").toUpperCase();
  const exactHistoryChanceMode = option("--exact-history-chance-matrix",
    "off").toLowerCase();
  if (branchMode !== "EXACT_REPLAY" && branchMode !== "RESET_SUFFIX")
    throw new Error(`ROOT_LABEL_BRANCH_MODE:${branchMode}`);
  if (softSlackMode !== "on" && softSlackMode !== "off")
    throw new Error(`ROOT_LABEL_SOFT_ESCAPE_SLACK_DOMINANCE:${
      softSlackMode}`);
  if (optionSequencesMode !== "on" && optionSequencesMode !== "off")
    throw new Error(`ROOT_LABEL_OPTION_SEQUENCES:${optionSequencesMode}`);
  if (exactHistoryChanceMode !== "on" && exactHistoryChanceMode !== "off")
    throw new Error(`ROOT_LABEL_EXACT_HISTORY_CHANCE_MODE:${
      exactHistoryChanceMode}`);
  const exactHistoryChanceEnabled = exactHistoryChanceMode === "on";
  for (const policy of [...responsePolicies, ...ownResponsePolicies,
    ...enemyResponsePolicies])
    if (!Object.values(RESPONSE_POLICY).includes(policy))
      throw new Error(`ROOT_LABEL_RESPONSE_POLICY:${policy}`);
  for (const outcome of chanceOutcomes)
    if (outcome !== "HISTORICAL" && !/^RANDOM[0-9]+$/.test(outcome))
      throw new Error(`ROOT_LABEL_CHANCE_OUTCOME:${outcome}`);
  if (!chanceOutcomes.length)
    throw new Error("ROOT_LABEL_CHANCE_OUTCOME_EMPTY");
  if ((ownResponsePolicies.length || enemyResponsePolicies.length) &&
      branchMode !== "RESET_SUFFIX")
    throw new Error("ROOT_LABEL_RESPONSE_MATRIX_REQUIRES_RESET_SUFFIX");
  if (exactHistoryChanceEnabled && branchMode !== "EXACT_REPLAY")
    throw new Error("ROOT_LABEL_EXACT_HISTORY_CHANCE_REQUIRES_EXACT_REPLAY");
  if (exactHistoryChanceEnabled && (ownResponsePolicies.length ||
      enemyResponsePolicies.length))
    throw new Error("ROOT_LABEL_EXACT_HISTORY_CHANCE_POLICY_CONFLICT");
  if (samplingMode !== "LATEST" && samplingMode !== "STRATIFIED" &&
      samplingMode !== "PROPOSAL")
    throw new Error(`ROOT_LABEL_SAMPLING_MODE:${samplingMode}`);
  const optionSequences = optionSequencesMode === "on";
  const engineOptions = softSlackMode === "off" ?
    { softEscapeSlackDominance: false } : {};
  if (samplingMode === "PROPOSAL")
    engineOptions.diagnosticAttackObjectiveField = true;
  const outputFile = path.resolve(option("--output",
    path.join("/tmp", "agentank-root-counterfactual-labels.json")));
  const loaded = typeof arena.loadCohort === "function" ?
    arena.loadCohort(root, cohortFile, role) : cohortTool.load(root, cohortFile, role);
  const scenarios = loaded.scenarios.slice(offset, offset + scenarioCount);
  if (scenarios.length !== scenarioCount)
    throw new Error(`ROOT_LABEL_SCENARIO_DENOMINATOR:${scenarios.length}`);
  const simulator = await loadSimulator(root);
  const matches = [];
  for (let index = 0; index < scenarios.length; index += 1) {
    for (let seat = 0; seat < 2; seat += 1)
      matches.push(await playAndCapture(simulator.module, scenarios[index],
        seat, rootsPerLoss, rootStride, branchMode, engineOptions, targetFrame,
        captureOutcomes, optionSequences, responsePolicies, samplingMode,
        chanceOutcomes, ownResponsePolicies, enemyResponsePolicies,
        exactHistoryChanceEnabled));
    process.stderr.write(`[root-labels] ${index + 1}/${scenarios.length}\n`);
  }
  const rootCount = matches.reduce((sum, match) => sum + match.roots.length, 0);
  const labelCount = matches.reduce((sum, match) =>
    sum + match.roots.reduce((inner, item) => inner + item.labels.length, 0), 0);
  const selectedReproductionMismatchCount = branchMode === "EXACT_REPLAY" ?
    matches.reduce((sum, match) => sum + match.roots.reduce((inner, item) =>
      inner + (item.selectedReproduced ? 0 : 1), 0), 0) : null;
  if (selectedReproductionMismatchCount)
    throw new Error(`ROOT_LABEL_SELECTED_REPRODUCTION_MISMATCH:${
      selectedReproductionMismatchCount}`);
  const document = {
    schemaVersion: 2,
    objectKind: "ROOT_COUNTERFACTUAL_LABEL_SET_V2",
    supportKind: branchMode === "EXACT_REPLAY" ?
      "DETERMINISTIC_PREFIX_REPLAY_EXACT_CONTROLLER_HISTORY" :
      "SIMULATOR_CLONE_RESET_SUFFIX_POLICY",
    warning: branchMode === "EXACT_REPLAY" ?
      "The full prefix is replayed and only FinalActionGate is overridden at the hash-matched root." :
      "Physical root and RNG are exact; V2/V3 continuation controller state is rebuilt at the root.",
    branchMode,
    engineOptions,
    cohortFingerprint: loaded.manifest.fingerprint,
    role,
    scenarioOffset: offset,
    scenarioCount,
    physicalMatches: matches.length,
    rootsPerLoss,
    rootStride,
    targetFrame,
    optionSequences,
    exactHistoryChanceEnabled,
    responsePolicies: exactHistoryChanceEnabled ? ["V2", "V3"] :
      responsePolicies,
    ownResponsePolicies: exactHistoryChanceEnabled ? ["V2"] :
      ownResponsePolicies,
    enemyResponsePolicies: exactHistoryChanceEnabled ? ["V3"] :
      enemyResponsePolicies,
    chanceOutcomes,
    samplingMode,
    captureOutcomes: Array.from(captureOutcomes),
    rootCount,
    labelCount,
    selectedReproductionMismatchCount,
    matches,
    fingerprint: ""
  };
  document.fingerprint = fingerprintObject({ ...document, fingerprint: "" });
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(document, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    outputFile,
    scenarioCount,
    physicalMatches: matches.length,
    rootCount,
    labelCount,
    fingerprint: document.fingerprint
  }, null, 2)}\n`);
  return document;
}

if (require.main === module)
  run().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });

module.exports = {
  actionObject,
  starProviderAfter,
  deterministicRandom,
  chanceBranchOptions,
  analysisOutcome,
  terminalLabel,
  sameTerminal,
  actionKey,
  observedAction,
  temporalEvidence,
  horizonSnapshot,
  rootSearchEvidence,
  rootStratum,
  candidateGeometry,
  optionBestRow,
  RESPONSE_POLICY,
  responsePolicyBot,
  ResponseTraceBot,
  runReplayBranch,
  runResponseMatrixBranch,
  responseMatrix,
  exactHistoryChanceMatrix,
  installContinuationAudit,
  captureCandidates,
  run
};
