"use strict";

const { ACTION, DIRECTION } = require("../../../engine-v2/src/abi/fast-codes");

const GEOMETRY = Object.freeze({
  UNKNOWN: 0,
  OFF_AXIS: 1,
  AXIS_WRONG_FACING: 2,
  DIRECT_BLOCKED: 3,
  DIRECT_CLEAR: 4
});

const FIELD = Object.freeze({
  FRAME: 0, GEOMETRY: 1, DISTANCE: 2, RAY_LENGTH: 3,
  OWN_MOBILITY: 4, ENEMY_MOBILITY: 5, COUNTER_LINE: 6,
  OWN_X: 7, OWN_Y: 8, OWN_DIRECTION: 9,
  ENEMY_X: 10, ENEMY_Y: 11, ENEMY_DIRECTION: 12,
  OWN_STARS: 13, ENEMY_STARS: 14, ENGINE_SUPPORTED: 15, ROW: 16,
  DIRECT_KILL: 17, POSSIBLE_HIT: 18, INTERCEPT: 19, AIM_SETUP: 20,
  HIT_DEADLINE: 21, DOOMED: 22, SURVIVES: 23, UNKNOWN: 24,
  FRONTIER: 25, COUNTERFIRE_DELAY: 26, MOBILITY_LOSS: 27,
  ENDPOINT_REDUCTION: 28, OWN_COUNTER_EXPOSURE: 29,
  POST_FIRE_ESCAPE: 30, PURPOSE_COMPLETENESS: 31, PAC_STATUS: 32,
  RISK_ACCEPTABLE: 33, RISK_DOMINATED: 34, ROBUST_LOWER: 35,
  EXPECTED_VALUE: 36, IMMEDIATE_FATAL: 37, HORIZON_FATAL: 38,
  UNKNOWN_MASS: 39, ESCAPE_SLACK: 40, INFORMATION_COMPLETE: 41,
  CONTINUATION_1: 42, CONTINUATION_2: 43,
  CONTINUATION_3: 44, CONTINUATION_4: 45,
  POST_FIRE_STATUS: 46, POST_FIRE_NODES: 47, POST_FIRE_DEPTH: 48,
  POST_FIRE_CONTINUATION_MASK: 49, AIM_STATUS: 50, AIM_ROW: 51,
  AIM_ACTION: 52, AIM_DIRECT_BRANCHES: 53, AIM_ALIGNED_BRANCHES: 54,
  AIM_TOTAL_BRANCHES: 55, AIM_SAFETY_STATUS: 56, AIM_NODES: 57,
  AIM_RESCUE: 58, AIM_STATIC_RISK_NO_WORSE: 59, STRIDE: 60
});

const DIRECTION_CODE = Object.freeze({
  up: DIRECTION.UP, right: DIRECTION.RIGHT,
  down: DIRECTION.DOWN, left: DIRECTION.LEFT
});
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

function position(value) {
  return Array.isArray(value) && Number.isSafeInteger(value[0]) &&
    Number.isSafeInteger(value[1]) ? value : null;
}

function direction(value) {
  const result = DIRECTION_CODE[value];
  return result === undefined ? -1 : result;
}

function inBounds(map, x, y) {
  return Array.isArray(map) && x >= 0 && x < map.length &&
    Array.isArray(map[x]) && y >= 0 && y < map[x].length;
}

function walkable(map, x, y) {
  if (!inBounds(map, x, y)) return 0;
  const tile = map[x][y];
  return tile === "." || tile === "o" ? 1 : 0;
}

function directionTo(from, to) {
  if (from[0] === to[0]) return to[1] < from[1] ? DIRECTION.UP :
    to[1] > from[1] ? DIRECTION.DOWN : -1;
  if (from[1] === to[1]) return to[0] > from[0] ? DIRECTION.RIGHT :
    DIRECTION.LEFT;
  return -1;
}

function clearLine(map, from, to, facing) {
  let x = from[0] + DX[facing]; let y = from[1] + DY[facing];
  while (inBounds(map, x, y)) {
    if (x === to[0] && y === to[1]) return 1;
    if (!walkable(map, x, y)) return 0;
    x += DX[facing]; y += DY[facing];
  }
  return 0;
}

function rayLength(map, from, facing) {
  if (facing < 0) return 0;
  let length = 0; let x = from[0] + DX[facing]; let y = from[1] + DY[facing];
  while (walkable(map, x, y)) {
    length += 1; x += DX[facing]; y += DY[facing];
  }
  return length;
}

function mobility(map, from, occupied) {
  let count = 0;
  for (let move = 0; move < 4; move += 1) {
    const x = from[0] + DX[move]; const y = from[1] + DY[move];
    if (walkable(map, x, y) && (!occupied ||
        x !== occupied[0] || y !== occupied[1])) count += 1;
  }
  return count;
}

function analyzeShotGeometry(context) {
  const map = context?.game?.map;
  const own = position(context?.me?.tank?.position);
  const enemy = position(context?.enemy?.tank?.position);
  const ownDirection = direction(context?.me?.tank?.direction);
  const enemyDirection = direction(context?.enemy?.tank?.direction);
  if (!own || !enemy || ownDirection < 0) return {
    geometry: GEOMETRY.UNKNOWN, distance: -1, rayLength: 0,
    ownMobility: own && map ? mobility(map, own, enemy) : -1,
    enemyMobility: enemy && map ? mobility(map, enemy, own) : -1,
    counterLine: 0, own, enemy, ownDirection, enemyDirection
  };
  const axis = directionTo(own, enemy);
  const distance = Math.abs(own[0] - enemy[0]) + Math.abs(own[1] - enemy[1]);
  let geometry = GEOMETRY.OFF_AXIS;
  if (axis >= 0 && axis !== ownDirection) geometry = GEOMETRY.AXIS_WRONG_FACING;
  else if (axis === ownDirection)
    geometry = clearLine(map, own, enemy, axis) ?
      GEOMETRY.DIRECT_CLEAR : GEOMETRY.DIRECT_BLOCKED;
  const enemyAxis = directionTo(enemy, own);
  const counterLine = enemyDirection >= 0 && enemyAxis === enemyDirection &&
    clearLine(map, enemy, own, enemyAxis) ? 1 : 0;
  return { geometry, distance, rayLength: rayLength(map, own, ownDirection),
    ownMobility: mobility(map, own, enemy),
    enemyMobility: mobility(map, enemy, own), counterLine,
    own, enemy, ownDirection, enemyDirection };
}

function selectedFireRow(engine) {
  if (!engine || !Number.isSafeInteger(engine.ourCount)) return -1;
  for (let row = 0; row < engine.ourCount; row += 1)
    if (engine.ourActions[row] === ACTION.FIRE) return row;
  return -1;
}

function decisionActionCode(decision) {
  const action = decision?.action;
  if (!action) return ACTION.NONE;
  if (action.type === "go") return ACTION.GO;
  if (action.type === "turn") return action.side === "left" ?
    ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
  if (action.type === "fire") return ACTION.FIRE;
  if (action.type === "throwBomb") return ACTION.THROW_BOMB;
  const skill = { shield: ACTION.CAST_SHIELD, freeze: ACTION.CAST_FREEZE,
    stun: ACTION.CAST_STUN, overload: ACTION.CAST_OVERLOAD,
    cloak: ACTION.CAST_CLOAK, poison: ACTION.CAST_POISON,
    teleport: ACTION.CAST_TELEPORT, boost: ACTION.CAST_BOOST };
  return skill[action.type] === undefined ? ACTION.NONE : skill[action.type];
}

class ShotRootCensus {
  constructor(capacity = 128) {
    this.capacity = capacity;
    this.words = new Int32Array(capacity * FIELD.STRIDE);
    this.count = 0; this.overflowCount = 0; this.hotAllocationCount = 0;
  }

  observe(context, decision, engine = null, closure = null) {
    const frame = Number.isSafeInteger(context?.game?.frames) ?
      context.game.frames : this.count;
    const actionCode = decisionActionCode(decision);
    for (let index = this.count - 1; index >= 0; index -= 1) {
      const at = index * FIELD.STRIDE;
      const delta = frame - this.words[at + FIELD.FRAME];
      if (delta > 4) break;
      if (delta >= 1)
        this.words[at + FIELD.CONTINUATION_1 + delta - 1] = actionCode;
    }
    if (decision?.action?.type !== "fire") return 0;
    if (this.count >= this.capacity) { this.overflowCount += 1; return 0; }
    const geometry = analyzeShotGeometry(context);
    const at = this.count * FIELD.STRIDE; const words = this.words;
    words[at + FIELD.FRAME] = frame;
    for (let delta = 0; delta < 4; delta += 1)
      words[at + FIELD.CONTINUATION_1 + delta] = -1;
    words[at + FIELD.GEOMETRY] = geometry.geometry;
    words[at + FIELD.DISTANCE] = geometry.distance;
    words[at + FIELD.RAY_LENGTH] = geometry.rayLength;
    words[at + FIELD.OWN_MOBILITY] = geometry.ownMobility;
    words[at + FIELD.ENEMY_MOBILITY] = geometry.enemyMobility;
    words[at + FIELD.COUNTER_LINE] = geometry.counterLine;
    words[at + FIELD.OWN_X] = geometry.own ? geometry.own[0] : -1;
    words[at + FIELD.OWN_Y] = geometry.own ? geometry.own[1] : -1;
    words[at + FIELD.OWN_DIRECTION] = geometry.ownDirection;
    words[at + FIELD.ENEMY_X] = geometry.enemy ? geometry.enemy[0] : -1;
    words[at + FIELD.ENEMY_Y] = geometry.enemy ? geometry.enemy[1] : -1;
    words[at + FIELD.ENEMY_DIRECTION] = geometry.enemyDirection;
    words[at + FIELD.OWN_STARS] = Number(context?.me?.stars) || 0;
    words[at + FIELD.ENEMY_STARS] = Number(context?.enemy?.stars) || 0;
    const row = selectedFireRow(engine);
    words[at + FIELD.ROW] = row;
    if (row >= 0) {
      words[at + FIELD.ENGINE_SUPPORTED] = 1;
      const combat = engine.combat?.vector; const pac = engine.projectileAttack;
      const risk = engine.riskController?.outcome;
      if (combat) {
        words[at + FIELD.DIRECT_KILL] = combat.directKill[row];
        words[at + FIELD.POSSIBLE_HIT] = combat.possibleHit[row];
        words[at + FIELD.INTERCEPT] = combat.intercept[row];
        words[at + FIELD.AIM_SETUP] = combat.aimSetup[row];
        words[at + FIELD.HIT_DEADLINE] = combat.hitDeadline[row];
        words[at + FIELD.DOOMED] = combat.enemyDoomedFirstActions[row];
        words[at + FIELD.SURVIVES] = combat.enemySurvivingFirstActions[row];
        words[at + FIELD.UNKNOWN] = combat.enemyUnknownFirstActions[row];
        words[at + FIELD.FRONTIER] = combat.enemyFrontierColumns[row];
        words[at + FIELD.COUNTERFIRE_DELAY] = combat.enemyCounterfireDelay[row];
        words[at + FIELD.MOBILITY_LOSS] = combat.enemyMobilityLoss[row];
        words[at + FIELD.ENDPOINT_REDUCTION] = combat.enemyEndpointReduction[row];
        words[at + FIELD.OWN_COUNTER_EXPOSURE] = combat.ownCounterExposure[row];
        words[at + FIELD.POST_FIRE_ESCAPE] = combat.postFireEscape[row];
        words[at + FIELD.PURPOSE_COMPLETENESS] = combat.purposeCompleteness[row];
      }
      words[at + FIELD.PAC_STATUS] = pac ? pac.status[row] : 0;
      if (risk && row < risk.count) {
        words[at + FIELD.RISK_ACCEPTABLE] = risk.acceptable[row];
        words[at + FIELD.RISK_DOMINATED] = risk.dominated[row];
        words[at + FIELD.ROBUST_LOWER] = risk.robustLower[row];
        words[at + FIELD.EXPECTED_VALUE] = risk.expectedValue[row];
        words[at + FIELD.IMMEDIATE_FATAL] = risk.immediateFatalMass[row];
        words[at + FIELD.HORIZON_FATAL] = risk.horizonFatalMass[row];
        words[at + FIELD.UNKNOWN_MASS] = risk.unknownMass[row];
        words[at + FIELD.ESCAPE_SLACK] = risk.escapeSlack[row];
      }
      words[at + FIELD.INFORMATION_COMPLETE] =
        engine.adapter?.informationComplete ? 1 : 0;
    } else words[at + FIELD.HIT_DEADLINE] = 255;
    if (closure && closure.lastFrame === frame) {
      words[at + FIELD.POST_FIRE_STATUS] = closure.lastPostFireStatus;
      words[at + FIELD.POST_FIRE_NODES] = closure.lastPostFireNodes;
      words[at + FIELD.POST_FIRE_DEPTH] = closure.lastPostFireDepth;
      words[at + FIELD.POST_FIRE_CONTINUATION_MASK] = closure.lastContinuationMask;
      words[at + FIELD.AIM_STATUS] = closure.lastAimStatus;
      words[at + FIELD.AIM_ROW] = closure.lastAimRow;
      words[at + FIELD.AIM_ACTION] = closure.lastAimAction;
      words[at + FIELD.AIM_DIRECT_BRANCHES] = closure.lastAimDirectBranches;
      words[at + FIELD.AIM_ALIGNED_BRANCHES] = closure.lastAimAlignedBranches;
      words[at + FIELD.AIM_TOTAL_BRANCHES] = closure.lastAimTotalBranches;
      words[at + FIELD.AIM_SAFETY_STATUS] = closure.lastAimSafetyStatus;
      words[at + FIELD.AIM_NODES] = closure.lastAimNodes;
      words[at + FIELD.AIM_RESCUE] = closure.lastAimRescue;
      words[at + FIELD.AIM_STATIC_RISK_NO_WORSE] = closure.lastAimStaticRiskNoWorse;
    } else words[at + FIELD.AIM_ROW] = -1;
    this.count += 1; return 1;
  }

  records() {
    const output = [];
    for (let index = 0; index < this.count; index += 1) {
      const at = index * FIELD.STRIDE; const get = field => this.words[at + field];
      output.push({ frame: get(FIELD.FRAME), geometry: get(FIELD.GEOMETRY),
        distance: get(FIELD.DISTANCE), rayLength: get(FIELD.RAY_LENGTH),
        ownMobility: get(FIELD.OWN_MOBILITY), enemyMobility: get(FIELD.ENEMY_MOBILITY),
        counterLine: get(FIELD.COUNTER_LINE),
        ownPose: [get(FIELD.OWN_X), get(FIELD.OWN_Y), get(FIELD.OWN_DIRECTION)],
        enemyPose: [get(FIELD.ENEMY_X), get(FIELD.ENEMY_Y), get(FIELD.ENEMY_DIRECTION)],
        ownStars: get(FIELD.OWN_STARS), enemyStars: get(FIELD.ENEMY_STARS),
        engineSupported: get(FIELD.ENGINE_SUPPORTED), row: get(FIELD.ROW),
        directKill: get(FIELD.DIRECT_KILL), possibleHit: get(FIELD.POSSIBLE_HIT),
        intercept: get(FIELD.INTERCEPT), aimSetup: get(FIELD.AIM_SETUP),
        hitDeadline: get(FIELD.HIT_DEADLINE), doomed: get(FIELD.DOOMED),
        survives: get(FIELD.SURVIVES), unknown: get(FIELD.UNKNOWN),
        frontier: get(FIELD.FRONTIER), counterfireDelay: get(FIELD.COUNTERFIRE_DELAY),
        mobilityLoss: get(FIELD.MOBILITY_LOSS),
        endpointReduction: get(FIELD.ENDPOINT_REDUCTION),
        ownCounterExposure: get(FIELD.OWN_COUNTER_EXPOSURE),
        postFireEscape: get(FIELD.POST_FIRE_ESCAPE),
        purposeCompleteness: get(FIELD.PURPOSE_COMPLETENESS),
        pacStatus: get(FIELD.PAC_STATUS), riskAcceptable: get(FIELD.RISK_ACCEPTABLE),
        riskDominated: get(FIELD.RISK_DOMINATED), robustLower: get(FIELD.ROBUST_LOWER),
        expectedValue: get(FIELD.EXPECTED_VALUE),
        immediateFatal: get(FIELD.IMMEDIATE_FATAL), horizonFatal: get(FIELD.HORIZON_FATAL),
        unknownMass: get(FIELD.UNKNOWN_MASS), escapeSlack: get(FIELD.ESCAPE_SLACK),
        informationComplete: get(FIELD.INFORMATION_COMPLETE),
        postFireClosureStatus: get(FIELD.POST_FIRE_STATUS),
        postFireClosureNodes: get(FIELD.POST_FIRE_NODES),
        postFireClosureDepth: get(FIELD.POST_FIRE_DEPTH),
        postFireContinuationMask: get(FIELD.POST_FIRE_CONTINUATION_MASK),
        aimStatus: get(FIELD.AIM_STATUS), aimRow: get(FIELD.AIM_ROW),
        aimAction: get(FIELD.AIM_ACTION),
        aimDirectBranches: get(FIELD.AIM_DIRECT_BRANCHES),
        aimAlignedBranches: get(FIELD.AIM_ALIGNED_BRANCHES),
        aimTotalBranches: get(FIELD.AIM_TOTAL_BRANCHES),
        aimSafetyStatus: get(FIELD.AIM_SAFETY_STATUS),
        aimNodes: get(FIELD.AIM_NODES),
        aimRescue: get(FIELD.AIM_RESCUE),
        aimStaticRiskNoWorse: get(FIELD.AIM_STATIC_RISK_NO_WORSE),
        continuation: [get(FIELD.CONTINUATION_1), get(FIELD.CONTINUATION_2),
          get(FIELD.CONTINUATION_3), get(FIELD.CONTINUATION_4)] });
    }
    return output;
  }

  summary() {
    return { count: this.count, overflowCount: this.overflowCount,
      hotAllocationCount: this.hotAllocationCount, records: this.records() };
  }
}

class AttackGeometryOpportunityCensus {
  constructor(ownershipTrace = null, ownershipStageCount = 12) {
    this.ownershipTrace = ownershipTrace;
    this.ownershipStageCount = ownershipStageCount;
    this.decisionCount = 0; this.visibleCount = 0;
    this.geometryCount = new Uint32Array(5);
    this.geometryActionCount = new Uint32Array(30);
    this.directActionCount = new Uint32Array(6);
    this.directEntryActionCount = new Uint32Array(6);
    this.directDistanceCount = new Uint32Array(4);
    this.geometryTransitionCount = new Uint32Array(25);
    this.directEntryPreviousActionCount = new Uint32Array(30);
    this.directEntryPreviousOwnershipCount = new Uint32Array(ownershipStageCount);
    this.directEntryCurrentOwnershipCount = new Uint32Array(ownershipStageCount);
    this.wrongFacingOwnershipCount = new Uint32Array(ownershipStageCount);
    this.directEntryDistanceCount = new Uint32Array(4);
    this.directEntryCount = 0; this.directRun = 0; this.maximumDirectRun = 0;
    this.directEntryActive = 0; this.directEntryFired = 0;
    this.directEntryConvertedToFireCount = 0;
    this.directEntryAbandonedWithoutFireCount = 0;
    this.directEntryHiddenWithoutFireCount = 0;
    this.wrongFacingCorrectTurnCount = 0;
    this.wrongFacingWrongTurnCount = 0;
    this.wrongFacingNonTurnCount = 0;
    this.visibleEpisodeCount = 0; this.visibleEpisodeActive = 0;
    this.visibleEpisodeLength = 0; this.maximumVisibleEpisodeLength = 0;
    this.visibleEpisodeReachedDirect = 0; this.visibleEpisodeFiredDirect = 0;
    this.visibleEpisodeReachedDirectCount = 0;
    this.visibleEpisodeDirectFireCount = 0;
    this.visibleEpisodeWithoutDirectCount = 0;
    this.initialDirectCount = 0; this.previousGeometry = GEOMETRY.UNKNOWN;
    this.previousActionFamily = 0; this.previousOwnershipStage = 0;
    this.hotAllocationCount = 0;
  }
  actionFamily(decision) {
    const action = decisionActionCode(decision);
    if (action === ACTION.GO) return 1;
    if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) return 2;
    if (action === ACTION.FIRE) return 3;
    if (action === ACTION.THROW_BOMB) return 4;
    if (action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST) return 5;
    return 0;
  }
  finishDirectEntry(hidden) {
    if (!this.directEntryActive) return;
    if (this.directEntryFired) this.directEntryConvertedToFireCount += 1;
    else {
      this.directEntryAbandonedWithoutFireCount += 1;
      if (hidden) this.directEntryHiddenWithoutFireCount += 1;
    }
    this.directEntryActive = 0; this.directEntryFired = 0;
  }
  finishVisibleEpisode() {
    if (!this.visibleEpisodeActive) return;
    if (this.visibleEpisodeReachedDirect) this.visibleEpisodeReachedDirectCount += 1;
    else this.visibleEpisodeWithoutDirectCount += 1;
    if (this.visibleEpisodeFiredDirect) this.visibleEpisodeDirectFireCount += 1;
    if (this.visibleEpisodeLength > this.maximumVisibleEpisodeLength)
      this.maximumVisibleEpisodeLength = this.visibleEpisodeLength;
    this.visibleEpisodeActive = 0; this.visibleEpisodeLength = 0;
    this.visibleEpisodeReachedDirect = 0; this.visibleEpisodeFiredDirect = 0;
  }
  isCorrectTurn(geometry, decision) {
    const wanted = directionTo(geometry.own, geometry.enemy);
    const action = decisionActionCode(decision);
    if (wanted < 0 || (action !== ACTION.TURN_LEFT &&
        action !== ACTION.TURN_RIGHT)) return -1;
    const after = action === ACTION.TURN_LEFT ?
      (geometry.ownDirection + 3) & 3 : (geometry.ownDirection + 1) & 3;
    return after === wanted ? 1 : 0;
  }
  observe(context, decision) {
    this.decisionCount += 1;
    const ownershipStage = this.ownershipTrace ?
      this.ownershipTrace.selectedStage | 0 : 0;
    const geometry = analyzeShotGeometry(context);
    if (!geometry.own || !geometry.enemy) {
      this.finishDirectEntry(1); this.finishVisibleEpisode();
      this.previousGeometry = GEOMETRY.UNKNOWN;
      this.previousActionFamily = this.actionFamily(decision);
      this.previousOwnershipStage = ownershipStage;
      this.directRun = 0; return;
    }
    if (!this.visibleEpisodeActive) {
      this.visibleEpisodeActive = 1; this.visibleEpisodeCount += 1;
      this.visibleEpisodeLength = 0; this.visibleEpisodeReachedDirect = 0;
      this.visibleEpisodeFiredDirect = 0;
    }
    this.visibleEpisodeLength += 1;
    this.visibleCount += 1; this.geometryCount[geometry.geometry] += 1;
    const currentAction = this.actionFamily(decision);
    this.geometryActionCount[geometry.geometry * 6 + currentAction] += 1;
    if (this.decisionCount > 1)
      this.geometryTransitionCount[this.previousGeometry * 5 + geometry.geometry] += 1;
    if (geometry.geometry === GEOMETRY.AXIS_WRONG_FACING) {
      if (ownershipStage >= 0 && ownershipStage < this.ownershipStageCount)
        this.wrongFacingOwnershipCount[ownershipStage] += 1;
      const correct = this.isCorrectTurn(geometry, decision);
      if (correct > 0) this.wrongFacingCorrectTurnCount += 1;
      else if (correct === 0) this.wrongFacingWrongTurnCount += 1;
      else this.wrongFacingNonTurnCount += 1;
    }
    if (geometry.geometry === GEOMETRY.DIRECT_CLEAR) {
      this.directActionCount[currentAction] += 1;
      const bucket = geometry.distance <= 2 ? 0 : geometry.distance <= 4 ? 1 :
        geometry.distance <= 7 ? 2 : 3;
      this.directDistanceCount[bucket] += 1;
      if (this.previousGeometry !== GEOMETRY.DIRECT_CLEAR) {
        this.directEntryCount += 1; this.directEntryDistanceCount[bucket] += 1;
        this.directEntryActive = 1; this.directEntryFired = 0;
        this.directEntryActionCount[currentAction] += 1;
        if (this.decisionCount === 1) this.initialDirectCount += 1;
        else {
          this.directEntryPreviousActionCount[
            this.previousGeometry * 6 + this.previousActionFamily] += 1;
          if (this.previousOwnershipStage >= 0 &&
              this.previousOwnershipStage < this.ownershipStageCount)
            this.directEntryPreviousOwnershipCount[this.previousOwnershipStage] += 1;
        }
        if (ownershipStage >= 0 && ownershipStage < this.ownershipStageCount)
          this.directEntryCurrentOwnershipCount[ownershipStage] += 1;
      }
      this.visibleEpisodeReachedDirect = 1;
      if (currentAction === 3) {
        this.directEntryFired = 1; this.visibleEpisodeFiredDirect = 1;
      }
      this.directRun += 1;
      if (this.directRun > this.maximumDirectRun) this.maximumDirectRun = this.directRun;
    } else {
      this.finishDirectEntry(0); this.directRun = 0;
    }
    this.previousGeometry = geometry.geometry;
    this.previousActionFamily = this.actionFamily(decision);
    this.previousOwnershipStage = ownershipStage;
  }
  summary() {
    const openEntryConverted = this.directEntryActive && this.directEntryFired ? 1 : 0;
    const openEntryAbandoned = this.directEntryActive && !this.directEntryFired ? 1 : 0;
    const openEpisodeReached = this.visibleEpisodeActive &&
      this.visibleEpisodeReachedDirect ? 1 : 0;
    const openEpisodeWithout = this.visibleEpisodeActive &&
      !this.visibleEpisodeReachedDirect ? 1 : 0;
    const openEpisodeFired = this.visibleEpisodeActive &&
      this.visibleEpisodeFiredDirect ? 1 : 0;
    return { decisionCount: this.decisionCount, visibleCount: this.visibleCount,
      geometryCount: Array.from(this.geometryCount),
      geometryActionCount: Array.from(this.geometryActionCount),
      directActionCount: Array.from(this.directActionCount),
      directEntryActionCount: Array.from(this.directEntryActionCount),
      directDistanceCount: Array.from(this.directDistanceCount),
      geometryTransitionCount: Array.from(this.geometryTransitionCount),
      directEntryPreviousActionCount: Array.from(this.directEntryPreviousActionCount),
      directEntryPreviousOwnershipCount:
        Array.from(this.directEntryPreviousOwnershipCount),
      directEntryCurrentOwnershipCount:
        Array.from(this.directEntryCurrentOwnershipCount),
      wrongFacingOwnershipCount: Array.from(this.wrongFacingOwnershipCount),
      directEntryDistanceCount: Array.from(this.directEntryDistanceCount),
      directEntryCount: this.directEntryCount, initialDirectCount: this.initialDirectCount,
      maximumDirectRun: this.maximumDirectRun,
      directEntryConvertedToFireCount:
        this.directEntryConvertedToFireCount + openEntryConverted,
      directEntryAbandonedWithoutFireCount:
        this.directEntryAbandonedWithoutFireCount + openEntryAbandoned,
      directEntryHiddenWithoutFireCount: this.directEntryHiddenWithoutFireCount,
      wrongFacingCorrectTurnCount: this.wrongFacingCorrectTurnCount,
      wrongFacingWrongTurnCount: this.wrongFacingWrongTurnCount,
      wrongFacingNonTurnCount: this.wrongFacingNonTurnCount,
      visibleEpisodeCount: this.visibleEpisodeCount,
      visibleEpisodeReachedDirectCount:
        this.visibleEpisodeReachedDirectCount + openEpisodeReached,
      visibleEpisodeDirectFireCount:
        this.visibleEpisodeDirectFireCount + openEpisodeFired,
      visibleEpisodeWithoutDirectCount:
        this.visibleEpisodeWithoutDirectCount + openEpisodeWithout,
      maximumVisibleEpisodeLength: Math.max(this.maximumVisibleEpisodeLength,
        this.visibleEpisodeLength),
      hotAllocationCount: this.hotAllocationCount };
  }
}

class ShotQualityDecisionAudit {
  constructor(audit, engine = null, closure = null, closureObservedExternally = false,
      ownershipTrace = null) {
    this.audit = audit; this.engine = engine; this.closure = closure;
    this.closureObservedExternally = closureObservedExternally;
    this.census = new ShotRootCensus();
    this.geometryOpportunity = new AttackGeometryOpportunityCensus(ownershipTrace);
  }
  decide(context) {
    const decision = this.audit.decide(context);
    const frame = Number.isSafeInteger(context?.game?.frames) ? context.game.frames : -1;
    if (this.closure && !this.closureObservedExternally &&
        decision?.action?.type === "fire")
      this.closure.observe(this.engine, selectedFireRow(this.engine), frame);
    this.geometryOpportunity.observe(context, decision);
    this.census.observe(context, decision, this.engine, this.closure);
    return decision;
  }
  summary() { return { ...this.audit.summary(), shotRootCensus: this.census.summary(),
    attackGeometryOpportunity: this.geometryOpportunity.summary(),
    ...(this.closure ? { aimSetupPostFireClosure: this.closure.summary() } : {}) }; }
}

function emptyOutcome(record) {
  return { ...record, projectiles: 0, tankKills: 0, terrainHits: 0,
    shieldBreaks: 0, noTankImpact: 0, survivedAtTerminal: 0,
    lifetimeFrames: 0, ownerCrashWithin4: 0, ownerProjectileKilledWithin4: 0,
    emissionFrame: -1, emissionDelay: -1 };
}

function collectShotOutcomeRecords(replay, recordsBySeat) {
  const output = recordsBySeat.map(records => (records || []).map(emptyOutcome));
  const frameIndex = output.map(records => {
    const byFrame = new Map();
    for (let index = 0; index < records.length; index += 1)
      byFrame.set(records[index].frame, index);
    return byFrame;
  });
  const ids = replay.replayData.replay.meta.players.map(item => item.tank.id);
  const crashFrame = [0xffff, 0xffff]; const projectileCrashFrame = [0xffff, 0xffff];
  const tracks = new Map();
  const unpairedProjectiles = [0, 0]; const eventsByFrame = replay.replayData.replay.records;
  const findShot = (owner, frame) => {
    const exact = frameIndex[owner].get(frame);
    if (exact !== undefined) return exact;
    const records = output[owner];
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index]; const delay = frame - record.frame;
      if (delay < 1) continue;
      if (delay > 2) break;
      if (record.projectiles === 0 || record.emissionFrame === frame) return index;
    }
    return undefined;
  };
  for (let frame = 0; frame < eventsByFrame.length; frame += 1) {
    const events = eventsByFrame[frame];
    for (const event of events) {
      if (event.type === "tank" && event.action === "crashed") {
        const seat = event.index === 0 || event.index === 1 ? event.index :
          ids.indexOf(event.objectId);
        if (seat >= 0 && crashFrame[seat] === 0xffff) crashFrame[seat] = frame;
      } else if (event.type === "bullet" && event.action === "created") {
        const owner = ids.indexOf(event.tank?.id); if (owner < 0) continue;
        const shot = findShot(owner, frame);
        if (shot === undefined) unpairedProjectiles[owner] += 1;
        else {
          output[owner][shot].projectiles += 1;
          output[owner][shot].emissionFrame = frame;
          output[owner][shot].emissionDelay = frame - output[owner][shot].frame;
        }
        tracks.set(event.objectId, { owner, frame, shot, ended: 0 });
      }
    }
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.type !== "bullet" || event.action !== "crashed") continue;
      const track = tracks.get(event.objectId); if (!track || track.ended) continue;
      track.ended = 1; if (track.shot === undefined) continue;
      const record = output[track.owner][track.shot];
      record.lifetimeFrames += Math.max(1, frame - track.frame + 1);
      let go = -1;
      for (let at = index - 1; at >= 0; at -= 1) {
        const before = events[at];
        if (before.type === "bullet" && before.objectId === event.objectId &&
            before.action === "go") { go = at; break; }
      }
      let tankKill = 0; let victimSeat = -1; let shieldBreak = 0; let terrain = 0;
      if (go >= 0) for (let at = go + 1; at < index; at += 1) {
        const between = events[at];
        if (between.type === "tank" && between.action === "crashed") {
          const victim = between.index === 0 || between.index === 1 ? between.index :
            ids.indexOf(between.objectId);
          if (victim >= 0 && victim !== track.owner) {
            tankKill = 1; victimSeat = victim;
          }
        } else if (between.type === "skill" && between.action === "expired" &&
            between.skillType === "shield") shieldBreak = 1;
        else if (between.type === "map" && between.action === "destroyed") terrain = 1;
      }
      if (tankKill) {
        record.tankKills += 1;
        if (projectileCrashFrame[victimSeat] === 0xffff)
          projectileCrashFrame[victimSeat] = frame;
      }
      else if (shieldBreak) record.shieldBreaks += 1;
      else if (terrain) record.terrainHits += 1;
      else record.noTankImpact += 1;
    }
  }
  for (const track of tracks.values()) {
    if (track.shot === undefined) continue;
    const record = output[track.owner][track.shot];
    if (!track.ended) record.survivedAtTerminal += 1;
  }
  for (let seat = 0; seat < output.length; seat += 1)
    for (const record of output[seat]) {
      const origin = record.emissionFrame >= 0 ? record.emissionFrame : record.frame;
      const crashed = crashFrame[seat];
      if (crashed !== 0xffff && crashed >= origin && crashed <= origin + 4)
        record.ownerCrashWithin4 = 1;
      const projectileCrashed = projectileCrashFrame[seat];
      if (projectileCrashed !== 0xffff && projectileCrashed >= origin &&
          projectileCrashed <= origin + 4) record.ownerProjectileKilledWithin4 = 1;
    }
  output.unpairedProjectiles = unpairedProjectiles;
  return output;
}

function bucket() {
  return { commands: 0, projectiles: 0, tankKills: 0, killCommands: 0,
    counterCrashCommands: 0, counterKilledCommands: 0,
    terrainHits: 0, noTankImpact: 0,
    survivedAtTerminal: 0, lifetimeFrames: 0 };
}

function addBucket(target, record) {
  target.commands += 1; target.projectiles += record.projectiles;
  target.tankKills += record.tankKills;
  if (record.tankKills) target.killCommands += 1;
  if (record.ownerCrashWithin4) target.counterCrashCommands += 1;
  if (record.ownerProjectileKilledWithin4) target.counterKilledCommands += 1;
  target.terrainHits += record.terrainHits; target.noTankImpact += record.noTankImpact;
  target.survivedAtTerminal += record.survivedAtTerminal;
  target.lifetimeFrames += record.lifetimeFrames;
}

function finish(target) {
  target.killsPer10000Projectiles = target.projectiles ?
    Math.round(target.tankKills * 10000 / target.projectiles) : 0;
  target.killCommandsPer10000 = target.commands ?
    Math.round(target.killCommands * 10000 / target.commands) : 0;
  target.counterCrashCommandsPer10000 = target.commands ?
    Math.round(target.counterCrashCommands * 10000 / target.commands) : 0;
  target.counterKilledCommandsPer10000 = target.commands ?
    Math.round(target.counterKilledCommands * 10000 / target.commands) : 0;
  return target;
}

function group(labels) {
  return Object.fromEntries(labels.map(label => [label, bucket()]));
}

function summarizeShotRecords(records, unpairedProjectiles = 0) {
  const result = { total: bucket(), unpairedProjectiles,
    geometry: group(["UNKNOWN", "OFF_AXIS", "AXIS_WRONG_FACING",
      "DIRECT_BLOCKED", "DIRECT_CLEAR"]),
    distance: group(["UNKNOWN", "D0_2", "D3_4", "D5_7", "D8_PLUS"]),
    counterLine: group(["NO", "YES"]),
    engineSignal: group(["NO_ENGINE", "DIRECT_KILL", "PAC_DOOMED",
      "POSSIBLE_HIT", "AIM_OR_INTERCEPT", "NO_COMBAT_SIGNAL"]),
    postFireEscape: group(["NO_ENGINE", "ZERO", "ONE", "TWO_PLUS"]),
    enemySurvivors: group(["NO_ENGINE", "NO_CLOSURE", "ZERO", "ONE",
      "TWO_PLUS", "UNKNOWN"]),
    counterExposure: group(["NO_ENGINE", "ZERO", "LOW", "MEDIUM", "HIGH"]),
    postFireClosure: group(["NOT_RUN", "PROVEN_SAFE", "PROVEN_DEAD", "UNKNOWN"]),
    aimSetupShadow: group(["NOT_RUN", "NO_IMPROVEMENT", "PROPOSED_QUALITY",
      "PROPOSED_RESCUE", "UNKNOWN"]),
    emissionDelay: group(["NO_PROJECTILE", "SAME_FRAME", "NEXT_FRAME", "TWO_FRAMES"]),
    firstContinuation: group(["MISSING_OR_NONE", "GO", "TURN", "FIRE", "BOMB", "SKILL"])
  };
  const geometryNames = ["UNKNOWN", "OFF_AXIS", "AXIS_WRONG_FACING",
    "DIRECT_BLOCKED", "DIRECT_CLEAR"];
  for (const record of records || []) {
    addBucket(result.total, record);
    addBucket(result.geometry[geometryNames[record.geometry] || "UNKNOWN"], record);
    const distance = record.distance < 0 ? "UNKNOWN" : record.distance <= 2 ? "D0_2" :
      record.distance <= 4 ? "D3_4" : record.distance <= 7 ? "D5_7" : "D8_PLUS";
    addBucket(result.distance[distance], record);
    addBucket(result.counterLine[record.counterLine ? "YES" : "NO"], record);
    let signal = "NO_ENGINE";
    if (record.engineSupported) signal = record.directKill ? "DIRECT_KILL" :
      record.doomed > 0 ? "PAC_DOOMED" : record.possibleHit ? "POSSIBLE_HIT" :
      (record.aimSetup || record.intercept) ? "AIM_OR_INTERCEPT" : "NO_COMBAT_SIGNAL";
    addBucket(result.engineSignal[signal], record);
    const escape = !record.engineSupported ? "NO_ENGINE" : record.postFireEscape < 1 ? "ZERO" :
      record.postFireEscape === 1 ? "ONE" : "TWO_PLUS";
    addBucket(result.postFireEscape[escape], record);
    const survivors = !record.engineSupported ? "NO_ENGINE" :
      !record.pacStatus ? "NO_CLOSURE" : record.unknown > 0 ? "UNKNOWN" :
      record.survives < 1 ? "ZERO" : record.survives === 1 ? "ONE" : "TWO_PLUS";
    addBucket(result.enemySurvivors[survivors], record);
    const exposure = !record.engineSupported ? "NO_ENGINE" :
      record.ownCounterExposure < 1 ? "ZERO" : record.ownCounterExposure < 4000 ? "LOW" :
      record.ownCounterExposure < 8000 ? "MEDIUM" : "HIGH";
    addBucket(result.counterExposure[exposure], record);
    const closure = record.postFireClosureStatus === 1 ? "PROVEN_SAFE" :
      record.postFireClosureStatus === 2 ? "PROVEN_DEAD" :
        record.postFireClosureStatus === 3 ? "UNKNOWN" : "NOT_RUN";
    addBucket(result.postFireClosure[closure], record);
    const aim = record.aimStatus === 1 ? "NO_IMPROVEMENT" :
      record.aimStatus === 2 ? record.aimRescue ? "PROPOSED_RESCUE" :
        "PROPOSED_QUALITY" :
        record.aimStatus === 3 ? "UNKNOWN" : "NOT_RUN";
    addBucket(result.aimSetupShadow[aim], record);
    const emission = record.projectiles < 1 ? "NO_PROJECTILE" :
      record.emissionDelay < 1 ? "SAME_FRAME" :
      record.emissionDelay === 1 ? "NEXT_FRAME" : "TWO_FRAMES";
    addBucket(result.emissionDelay[emission], record);
    const continuation = (record.continuation || []).find(value => value >= 0);
    const continuationName = continuation === ACTION.GO ? "GO" :
      continuation === ACTION.TURN_LEFT || continuation === ACTION.TURN_RIGHT ? "TURN" :
      continuation === ACTION.FIRE ? "FIRE" :
      continuation === ACTION.THROW_BOMB ? "BOMB" :
      continuation >= ACTION.CAST_SHIELD && continuation <= ACTION.CAST_BOOST ?
        "SKILL" : "MISSING_OR_NONE";
    addBucket(result.firstContinuation[continuationName], record);
  }
  finish(result.total);
  for (const name of ["geometry", "distance", "counterLine", "engineSignal",
    "postFireEscape", "enemySurvivors", "counterExposure", "postFireClosure",
    "aimSetupShadow", "emissionDelay",
    "firstContinuation"])
    for (const value of Object.values(result[name])) finish(value);
  return result;
}

module.exports = { GEOMETRY, FIELD, analyzeShotGeometry, ShotRootCensus,
  AttackGeometryOpportunityCensus,
  ShotQualityDecisionAudit, collectShotOutcomeRecords, summarizeShotRecords };
