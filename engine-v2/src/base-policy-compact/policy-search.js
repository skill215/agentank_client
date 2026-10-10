"use strict";

// Generated compact BP68 candidate. Do not edit by hand.

// Generated BP68 production search closure. Unlike the strict physical search,
// exhausting a per-root budget settles the remaining branch at the current
// heuristic leaf. The result is therefore policy evidence, never Proof/Hard.
// Every root action receives the same continuation allowance.

const { SEARCH_CAPACITY } = require(
  "../generated/search-config");
const { CAPACITY, RULE } = require("../generated/fast-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, FAST_STATUS, HARD_STATUS, TERMINAL, CHANCE, TERRAIN, SKILL, PHASE,
  NONE_FRAME, DX, DY } = require(
  "../abi/fast-codes");
const { FastKernel } = require("../fast/kernel");
const { OPPONENT_EVENT, OPPONENT_CONTEXT } = require(
  "../abi/policy-codes");
const { HazardKernel } = require("../fast/hazard");
const { HardGate } = require("../fast/hard-gate");

const VALUE_MIN = -32000;
const VALUE_MAX = 32000;
const DEEP_WIDTH = 6;
const ACTION_WIDTH = ACTION.BOOST_RIGHT_BOMB + 1;
const DOMAIN_BUCKET_COUNT = 8;
const EXACT_BLOCK = Object.freeze({
  BUDGET: 1,
  FAST_INCOMPLETE: 2,
  HARD_INCOMPLETE: 4,
  DEPTH_LEAF: 8,
  TOP_LEAF: 16,
  POLICY_REJECT_LEAF: 32,
  NO_ACTION_LEAF: 64
});
const EXACT_BLOCK_BUCKETS = 128;
const V1_ENEMY_ROOT_ORDER = Object.freeze([
  ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT, ACTION.TURN_RIGHT, ACTION.CAST_STUN
]);
const ROOT_ENEMY_DOMAIN = Object.freeze({
  DROP_PASSIVE: 1,
  QUALIFY_FIRE: 2,
  QUALIFY_MOTION_SKILL: 4
});
const EVENT_QUIESCENCE = Object.freeze({ OFF: "off", PROJECTILE_BOMB:
  "projectile-bomb" });
const CONTINUATION_POLICY = Object.freeze({ BASE: 0, ATTACK_TARGET: 1 });
const ACTION_NAME = Object.freeze(["NONE", "GO", "TURN_LEFT", "TURN_RIGHT",
  "FIRE", "BOMB", "SHIELD", "FREEZE", "STUN", "OVERLOAD", "CLOAK",
  "POISON", "TELEPORT", "BOOST", "BOOST_LEFT_GO", "BOOST_LEFT_TURN_LEFT",
  "BOOST_LEFT_TURN_RIGHT", "BOOST_LEFT_FIRE", "BOOST_LEFT_BOMB",
  "BOOST_RIGHT_GO", "BOOST_RIGHT_TURN_LEFT", "BOOST_RIGHT_TURN_RIGHT",
  "BOOST_RIGHT_FIRE", "BOOST_RIGHT_BOMB"]);
const LEGACY_DIRECTION = Object.freeze({ up: 0, right: 1, down: 2, left: 3 });
const LEGACY_ACTION = Object.freeze({ WAIT: ACTION.NONE, NONE: ACTION.NONE,
  GO: ACTION.GO, LEFT: ACTION.TURN_LEFT, RIGHT: ACTION.TURN_RIGHT,
  FIRE: ACTION.FIRE, BOMB: ACTION.THROW_BOMB,
  SHIELD: ACTION.CAST_SHIELD, FREEZE: ACTION.CAST_FREEZE,
  STUN: ACTION.CAST_STUN, ENEMY_STUN: ACTION.CAST_STUN,
  OVERLOAD: ACTION.CAST_OVERLOAD, CLOAK: ACTION.CAST_CLOAK,
  POISON: ACTION.CAST_POISON, TELEPORT: ACTION.CAST_TELEPORT,
  BOOST: ACTION.CAST_BOOST,
  LEFT_GO: ACTION.BOOST_LEFT_GO,
  LEFT_LEFT: ACTION.BOOST_LEFT_TURN_LEFT,
  LEFT_RIGHT: ACTION.BOOST_LEFT_TURN_RIGHT,
  LEFT_FIRE: ACTION.BOOST_LEFT_FIRE,
  LEFT_BOMB: ACTION.BOOST_LEFT_BOMB,
  RIGHT_GO: ACTION.BOOST_RIGHT_GO,
  RIGHT_LEFT: ACTION.BOOST_RIGHT_TURN_LEFT,
  RIGHT_RIGHT: ACTION.BOOST_RIGHT_TURN_RIGHT,
  RIGHT_FIRE: ACTION.BOOST_RIGHT_FIRE,
  RIGHT_BOMB: ACTION.BOOST_RIGHT_BOMB });

class V1EntryCollisionKernel extends FastKernel {
  advanceProjectiles() {
    const a = this.state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot]) continue;
      const target = a[ARRAY.PROJECTILE_OWNER][slot] ^ 1;
      if (a[ARRAY.PROJECTILE_CELL][slot] !== a[ARRAY.TANK_CELL][target]) continue;
      if (!a[ARRAY.TANK_CRASH][target] &&
          !this.projectileHitTank(slot, target, PHASE.PROJECTILE0, 0)) return 0;
      if (!this.destroyProjectile(slot, 20)) return 0;
    }
    return super.advanceProjectiles();
  }
}

class NativeBasePolicySearch {
constructor(options = {}) {
this.targetDepth = Math.max(1, Math.min(4,
      Number.isSafeInteger(options.targetDepth) ? options.targetDepth : 3));
this.depthSchedule = options.depthSchedule === "v1-state" ? "v1-state" : "fixed";
this.currentDepth = this.targetDepth;
;
this.nodeBudget = Math.max(32, Math.min(4096,
      Number.isSafeInteger(options.nodeBudget) ? options.nodeBudget : 128));
this.hardBudgetInterrupt = options.hardBudgetInterrupt === true ? 1 : 0;
this.iterationBudgetInterrupted = 0;
;
this.blendBasisPoints = Math.max(0, Math.min(5000,
      Number.isSafeInteger(options.blendBasisPoints) ?
        options.blendBasisPoints : 2000));
this.blendSchedule = options.blendSchedule === "star-state" ?
      "star-state" : "fixed";
this.leadingBlendBasisPoints = Math.max(0, Math.min(5000,
      Number.isSafeInteger(options.leadingBlendBasisPoints) ?
        options.leadingBlendBasisPoints : 0));
this.trailingBlendBasisPoints = Math.max(0, Math.min(5000,
      Number.isSafeInteger(options.trailingBlendBasisPoints) ?
        options.trailingBlendBasisPoints : this.blendBasisPoints * 2));
;
this.fullPrimitiveDomain = options.fullPrimitiveDomain === true;
this.deepFireMode = options.deepFireMode === "v1-own" ? "v1-own" : "simple";
this.deepFireDomain = options.deepFireDomain || null;
this.deepSkillMode = options.deepSkillMode === "own" ? 1 :
      options.deepSkillMode === "enemy" ? 2 :
      options.deepSkillMode === "both" ? 3 : 0;
this.deepDomainMode = options.deepDomainMode === "v1-shaped" ?
      "v1-shaped" : "primitive";
this.deepBombMode = options.deepBombMode === "qualified" ?
      "qualified" : "off";
this.leafEvaluator = options.leafEvaluator || null;
this.eventQuiescenceMode = options.eventQuiescenceMode ===
      EVENT_QUIESCENCE.PROJECTILE_BOMB ? EVENT_QUIESCENCE.PROJECTILE_BOMB :
      EVENT_QUIESCENCE.OFF;
this.eventQuiescenceContinuationMode =
      options.eventQuiescenceContinuationMode === "base-policy" ?
        "base-policy" : "full";
this.eventQuiescenceContinuation =
      options.eventQuiescenceContinuation || null;
this.ownContinuationMode = options.ownContinuationMode === "base-policy" ?
      "base-policy" : options.ownContinuationMode === "combat-first" ?
        "combat-first" : options.ownContinuationMode === "portfolio" ?
          "portfolio" : options.ownContinuationMode === "root-policy" ?
            "root-policy" : options.ownContinuationMode ===
              "root-policy-direct" ? "root-policy-direct" : "full";
this.ownContinuation = options.ownContinuation || null;
this.ownContinuationSecondary = options.ownContinuationSecondary || null;
this.currentOwnContinuation = this.ownContinuation;
;
;
;
;
;
;
this.ownContinuationPortfolioWidthCount = new Uint32Array(3);
this.ownContinuationActionCount = new Uint32Array(ACTION_WIDTH);
;
;
;
;
;
;
this.eventQuiescenceMaximumPly = Math.max(1, Math.min(3,
      Number.isSafeInteger(options.eventQuiescenceMaximumPly) ?
        options.eventQuiescenceMaximumPly : 3));
;
;
;
;
;
;
this.eventQuiescenceExpansionByPly = new Uint32Array(4);
this.eventQuiescenceRoutingTop = -1;
this.eventQuiescenceRoutedAction = ACTION.NONE;
;
;
;
this.pathUtility = options.pathUtility || null;
this.pathEvidenceMode = options.pathEvidenceMode === "split-nominal" ?
      "split-nominal" : "single";
this.historyEvaluator = options.historyEvaluator || null;
this.superkoMode = options.superkoMode === "v1" ? "v1" : "off";
this.collectTerminalTrade = options.collectTerminalTrade === true;
this.opponentMode = options.opponentMode === "v1-exact" ? "v1-exact" :
      options.opponentWeighted === true ? "v2-weighted" : "uniform";
this.opponentWeighted = this.opponentMode !== "uniform";
this.currentBlendBasisPoints = this.blendBasisPoints;
this.oracleOpponentReady = 0;
this.oracleOpponentCounts = new Uint32Array(4);
;
this.oracleOpponentGoStreak = 0;
this.oracleEnemyStationaryStreak = 0;
this.v1StunCountdown = options.v1StunCountdown === true;
this.v1EntryProjectileCollision = options.v1EntryProjectileCollision === true;
this.deepHardMode = options.deepHardMode === "terminal-only" ? "terminal-only" :
      options.deepHardMode === "proof-only" ? "proof-only" : "full";
this.rootDomainMode = options.rootDomainMode === "v1-actions" ?
      "v1-actions" : options.rootDomainMode === "v1-shaped" ? "v1-shaped" :
      options.rootDomainMode === "primitive" ? "primitive" : "all";
this.rootExtraPoison = options.rootExtraPoison === true;
this.terminalMode = options.terminalMode === "v1" ? "v1" : "platform";
this.ownChanceMode = options.ownChanceMode === "v1-deterministic" ?
      "v1-deterministic" : options.ownChanceMode === "worst" ?
        "worst" : "expected";
switch (options.rootEnemyDomainMode) {
      case "v1-shaped":
      case "tactical":
      case "drop-passive":
      case "qualify-fire":
      case "qualify-motion-skill":
      case "drop-passive-fire":
      case "drop-passive-motion-skill":
      case "qualify-fire-motion-skill":
        this.rootEnemyDomainMode = options.rootEnemyDomainMode; break;
      default: this.rootEnemyDomainMode = "all";
    }
this.rootEnemyDomainFlags = this.rootEnemyDomainMode === "tactical" ||
      this.rootEnemyDomainMode === "v1-shaped" ? 7 :
      (this.rootEnemyDomainMode.includes("drop-passive") ?
        ROOT_ENEMY_DOMAIN.DROP_PASSIVE : 0) |
      (this.rootEnemyDomainMode.includes("qualify-fire") ?
        ROOT_ENEMY_DOMAIN.QUALIFY_FIRE : 0) |
      (this.rootEnemyDomainMode.includes("motion-skill") ?
        ROOT_ENEMY_DOMAIN.QUALIFY_MOTION_SKILL : 0);
this.rootColumnOrder = options.rootColumnOrder === "reverse" ? "reverse" :
      options.rootColumnOrder === "v1" ? "v1" : "forward";
this.rootBudgetMode = options.rootBudgetMode === "cell-equal" ?
      "cell-equal" : "row-shared";
this.oracleRootActionMask = new Uint8Array(ACTION_WIDTH);
this.oracleRootActionReady = 0;
this.deepOurActions = new Uint8Array(5 * DEEP_WIDTH);
this.deepOurArguments = new Uint16Array(5 * DEEP_WIDTH);
this.deepEnemyActions = new Uint8Array(5 * DEEP_WIDTH);
this.deepEnemyArguments = new Uint16Array(5 * DEEP_WIDTH);
this.deepOurCount = new Uint8Array(5);
this.deepEnemyCount = new Uint8Array(5);
this.rootScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
this.rootNominalScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
this.rootCellScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
this.rootNominalCellScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
this.lastNominalValue = VALUE_MIN;
;
;
;
;
this.currentContinuationPolicy = CONTINUATION_POLICY.BASE;
this.currentContinuationGenerator = null;
this.rootTradeClass = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
this.currentRootMatrixIndex = -1;
this.rootDomainMask = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
;
;
;
;
this.rootEnemyDomainMask = new Uint8Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
this.rootColumnSequence = new Uint8Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
this.rootColumnUsed = new Uint8Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
this.pathAction = new Uint8Array(5);
this.pathTurnStreak = new Uint8Array(5);
this.pathPolicyEvent = new Uint8Array(5);
this.pathPolicyAbort = new Uint8Array(5);
this.pathPolicyRescue = new Uint8Array(5);
this.policyEnvelopeAbortNode = new Uint8Array(5);
this.policyEnvelopeRescueNode = new Uint8Array(5);
this.pathPoseKey = new Uint16Array(5);
this.pathRepeatLastPenalty = new Uint16Array(5);
this.pathRepeatCumulative = new Uint16Array(5);
this.pathRepeatReference = new Int32Array(5);
this.rootHistoryKey = new Uint16Array(8);
this.rootHistoryEpoch = new Uint16Array(8);
this.rootHistoryValue = new Int32Array(8);
this.rootHistoryCursor = 0;
this.rootHistoryCount = 0;
this.lastObservedHistoryFrame = -1;
this.historyContextEpoch = 0;
;
;
;
;
;
;
this.rootDomainRestricted = 0;
;
;
;
;
;
;
this.lastOwnershipSupportComplete = 0;
this.lastValueExact = 0;
this.lastBudgetLeafCount = 0;
this.lastFastIncompleteCount = 0;
this.lastHardIncompleteCount = 0;
this.lastDepthLeafCount = 0;
this.lastTopLeafCount = 0;
this.lastPolicyRejectCount = 0;
this.lastNoActionLeafCount = 0;
;
this.rowExactBlockMask = new Uint8Array(
      SEARCH_CAPACITY.MAX_OUR_ACTIONS);
this.rowExactBlockMask.fill(127);
this.rowExactBlockMaskCount = new Uint32Array(EXACT_BLOCK_BUCKETS);
;
;
;
this.exactBlockMaskCount = new Uint32Array(EXACT_BLOCK_BUCKETS);
;
;
;
this.noActionLeafCount = 0;
;
;
;
;
;
;
this.nodes = 0;
;
this.maximumNodes = 0;
this.leafBudgetCount = 0;
this.fastIncompleteCount = 0;
this.hardIncompleteCount = 0;
;
;
this.hardRejectPolicyCount = 0;
;
;
;
;
;
this.policyNodeDepthCount = new Uint32Array(5);
this.depthLeafCount = 0;
this.topLeafCount = 0;
;
;
;
;
;
;
this.deepActionCount = new Uint32Array(ACTION_WIDTH * 2);
;
;
;
;
;
this.diagnosticState = null;
this.diagnosticKernel = null;
this.diagnosticHazard = null;
this.diagnosticHard = null;
;
  }

bindIsolatedHard(bundle) {
    if (this.diagnosticState === bundle.state && this.diagnosticHard) return;
    this.diagnosticState = bundle.state;
    const Kernel = this.v1EntryProjectileCollision ?
      V1EntryCollisionKernel : FastKernel;
    this.diagnosticKernel = new Kernel(bundle.state, {
      stationaryOccupiedBlock: Boolean(bundle.kernel.stationaryOccupiedBlockEnabled)
    });
    this.diagnosticHazard = new HazardKernel(bundle.state, {
      reverseViabilityCacheEntries: 16,
      reverseLatticeCacheEntries: 4,
      reverseLatticeIncludesOwnProjectiles: true,
      reverseLatticeLayerCache: false,
      hazardSignatureCache: true
    });
    this.diagnosticHard = new HardGate(this.diagnosticKernel,
      this.diagnosticHazard, 0);
    ;
  }

poseKey(state) {
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][0];
    return ((state.x(cell) * 64 + state.y(cell)) * 4 +
      a[ARRAY.TANK_DIR][0]) & 0xffff;
  }

observeRoot(engine, contextEpoch = 0) {
    if (this.superkoMode !== "v1" || !engine.adapter?.state) return;
    const state = engine.adapter.state;
    const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (frame === this.lastObservedHistoryFrame) return;
    this.lastObservedHistoryFrame = frame;
    this.historyContextEpoch = contextEpoch & 0xffff;
    const at = this.rootHistoryCursor;
    this.rootHistoryKey[at] = this.poseKey(state);
    this.rootHistoryEpoch[at] = this.historyContextEpoch;
    if (this.leafEvaluator && typeof this.leafEvaluator.beginRoot === "function")
      this.leafEvaluator.beginRoot(state);
    this.rootHistoryValue[at] = this.leafEvaluator ?
      this.leafEvaluator.evaluate(state) : 0;
    this.rootHistoryCursor = (at + 1) & 7;
    if (this.rootHistoryCount < 8) this.rootHistoryCount += 1;
  }

repetitionPenalty(distance) {
    return distance === 2 ? 240 : distance === 3 ? 170 :
      distance === 4 ? 120 : distance >= 5 && distance <= 8 ? 60 : 0;
  }

superkoPenalty(state, top) {
    if (this.superkoMode !== "v1") return 0;
    ;
    const key = this.poseKey(state); let penalty = 0;
    let reference = -2147483648;
    if (top >= 3 && this.pathPoseKey[top - 2] === key) {
      penalty = 240; ;
    } else if (top >= 4 && this.pathPoseKey[top - 3] === key) {
      penalty = 170; ;
    } else for (let offset = 0; offset < this.rootHistoryCount; offset += 1) {
      const distance = top + offset;
      if (distance > 8) break;
      let index = this.rootHistoryCursor - 1 - offset;
      if (index < 0) index += 8;
      if (this.rootHistoryKey[index] !== key) continue;
      penalty = this.repetitionPenalty(distance);
      if (penalty && this.rootHistoryEpoch[index] !== this.historyContextEpoch)
        penalty >>= 1;
      if (penalty) {
        ;
        reference = this.rootHistoryValue[index];
      }
      break;
    }
    this.pathPoseKey[top] = key;
    this.pathRepeatLastPenalty[top] = penalty;
    this.pathRepeatCumulative[top] =
      (top > 1 ? this.pathRepeatCumulative[top - 1] : 0) + penalty;
    this.pathRepeatReference[top] = reference;
    if (penalty) {
      ; ;
    }
    return penalty;
  }

extendV1StunCountdown(state, action0, action1, beforeFrame) {
    if (!this.v1StunCountdown ||
        state.arrays[ARRAY.SCALAR][SCALAR.FRAME] !== beforeFrame + 1) return;
    const a = state.arrays;
    if (action0 === ACTION.CAST_STUN && a[ARRAY.TANK_SKILL][0] === SKILL.STUN &&
        a[ARRAY.TANK_SKILL_READY][0] > beforeFrame &&
        a[ARRAY.TANK_STUN_UNTIL][1] !== NONE_FRAME)
      state.write(ARRAY.TANK_STUN_UNTIL, 1, a[ARRAY.TANK_STUN_UNTIL][1] + 1);
    if (action1 === ACTION.CAST_STUN && a[ARRAY.TANK_SKILL][1] === SKILL.STUN &&
        a[ARRAY.TANK_SKILL_READY][1] > beforeFrame &&
        a[ARRAY.TANK_STUN_UNTIL][0] !== NONE_FRAME)
      state.write(ARRAY.TANK_STUN_UNTIL, 0, a[ARRAY.TANK_STUN_UNTIL][0] + 1);
  }

setOracleRootActions(evaluated) {
    this.oracleRootActionMask.fill(0);
    this.oracleRootActionReady = Array.isArray(evaluated) ? 1 : 0;
    if (!this.oracleRootActionReady) return;
    for (let index = 0; index < evaluated.length; index += 1) {
      const action = this.legacyAction(evaluated[index]?.action);
      if (action >= 0) this.oracleRootActionMask[action] = 1;
    }
  }

rootV1ShapedAllowed(engine, action) {
    const state = engine.adapter.state; const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const frozen = a[ARRAY.TANK_FROZEN_UNTIL][0] !== NONE_FRAME &&
      a[ARRAY.TANK_FROZEN_UNTIL][0] > frame;
    const poisonUntil = a[ARRAY.TANK_POISON_UNTIL][0];
    const poisonApplied = a[ARRAY.TANK_POISON_APPLIED][0];
    const poisonHold = poisonUntil !== NONE_FRAME && poisonUntil > frame &&
      poisonApplied !== NONE_FRAME && ((frame - poisonApplied) & 1) !== 0;
    if (frozen || poisonHold)
      return action === ACTION.NONE ? 1 : 0;
    if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) return 1;
    if (action === ACTION.GO) {
      const cell = a[ARRAY.TANK_CELL][0]; const direction = a[ARRAY.TANK_DIR][0];
      const next = engine.depthSearch.target(state, cell, direction);
      return engine.depthSearch.walkable(state, next) &&
        next !== a[ARRAY.TANK_CELL][1] ? 1 : 0;
    }
    if (action === ACTION.FIRE)
      return this.deepFireDomain &&
        typeof this.deepFireDomain.qualifiedFireForSeat === "function" ?
        this.deepFireDomain.qualifiedFireForSeat(state, 0) : this.usefulFire(state, 0);
    if (action === ACTION.CAST_STUN) return this.v1ShapedStun(state, 0);
    if (action === ACTION.THROW_BOMB)
      return this.deepFireDomain && a[ARRAY.TANK_BOMB_READY][0] <= frame &&
        typeof this.deepFireDomain.qualifiedBomb === "function" &&
        this.deepFireDomain.qualifiedBomb(state) ? 1 : 0;
    return 0;
  }

blended(worst, sum, count) {
    if (!count || !this.currentBlendBasisPoints) return worst;
    const expected = Math.trunc(sum / count);
    return worst + Math.trunc((expected - worst) *
      this.currentBlendBasisPoints / 10000);
  }

leaf(engine, pathScore = 0, top = 0) {
    const state = engine.adapter.state;
    const value = this.leafEvaluator ? this.leafEvaluator.evaluate(state) :
      engine.depthSearch.heuristic(state);
    let adjusted = value + pathScore;
    if (this.superkoMode === "v1" && top > 0 &&
        this.pathRepeatReference[top] !== -2147483648 &&
        this.pathRepeatLastPenalty[top] > 0 &&
        adjusted + this.pathRepeatCumulative[top] >
          this.pathRepeatReference[top] + 150) {
      adjusted += this.pathRepeatLastPenalty[top] >> 1;
      ;
    }
    return this.historyEvaluator ? this.historyEvaluator.adjustOwn(state, adjusted) : adjusted;
  }

terminalUtility(engine, terminal, depth, pathScore, top = 0) {
    if (this.terminalMode !== "v1")
      return engine.depthSearch.terminalValue(terminal, depth);
    const state = engine.adapter.state; const a = state.arrays;
    const crash0 = a[ARRAY.TANK_CRASH][0] !== 0;
    const crash1 = a[ARRAY.TANK_CRASH][1] !== 0;
    if (!crash0 && !crash1) return this.leaf(engine, pathScore, top);
    const stars0 = a[ARRAY.TANK_STARS][0]; const stars1 = a[ARRAY.TANK_STARS][1];
    if (crash0 && crash1) {
      if (stars0 > stars1) return 100000;
      if (stars0 < stars1) return -100000;
      return -60000;
    }
    return crash1 ? 100000 : -100000;
  }

pairedLeaf(engine, robustPathScore, nominalPathScore, top = 0) {
    const value = this.leaf(engine, robustPathScore, top);
    this.lastNominalValue = value + nominalPathScore - robustPathScore;
    return value;
  }

pairedTerminalUtility(engine, terminal, depth, robustPathScore,
    nominalPathScore, top = 0) {
    const value = this.terminalUtility(engine, terminal, depth,
      robustPathScore, top);
    const a = engine.adapter.state.arrays;
    const fixedTerminal = this.terminalMode !== "v1" ||
      a[ARRAY.TANK_CRASH][0] || a[ARRAY.TANK_CRASH][1];
    this.lastNominalValue = fixedTerminal ? value :
      value + nominalPathScore - robustPathScore;
    return value;
  }

activeProjectile(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 1;
    return 0;
  }

canFire(state, seat) {
    const a = state.arrays; const lock = a[ARRAY.TANK_FIRE_LOCK][seat];
    return !this.activeProjectile(state, seat) &&
      (lock === NONE_FRAME || lock <= a[ARRAY.SCALAR][SCALAR.FRAME]);
  }

terminalTradeClass(state) {
    if (!this.collectTerminalTrade) return 0;
    const a = state.arrays;
    if (a[ARRAY.TANK_CRASH][0] || a[ARRAY.TANK_CRASH][1]) return 0;
    const ownFrames = this.earliestAttackFrames(state, 0, 1);
    if (ownFrames >= 99) return 0;
    const enemyFrames = this.earliestAttackFrames(state, 1, 0);
    if (ownFrames < enemyFrames) return 1;
    if (ownFrames === enemyFrames)
      return a[ARRAY.TANK_STARS][0] > a[ARRAY.TANK_STARS][1] ? 1 : 2;
    return 3;
  }

distance(state, left, right) {
    return Math.abs(state.x(left) - state.x(right)) +
      Math.abs(state.y(left) - state.y(right));
  }

targetCell(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ? 0xffff :
      state.cell(x, y);
  }

directionTo(state, from, to) {
    const fx = state.x(from); const fy = state.y(from);
    const tx = state.x(to); const ty = state.y(to);
    if (fx === tx) return ty < fy ? 0 : ty > fy ? 2 : -1;
    if (fy === ty) return tx > fx ? 1 : tx < fx ? 3 : -1;
    return -1;
  }

clearLine(state, from, to) {
    const direction = this.directionTo(state, from, to);
    if (direction < 0) return 0;
    let cell = this.targetCell(state, from, direction);
    while (cell !== 0xffff && cell !== to) {
      const tile = state.arrays[ARRAY.TERRAIN][cell];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
      cell = this.targetCell(state, cell, direction);
    }
    return cell === to ? 1 : 0;
  }

v1ShapedStun(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_SKILL][seat] !== SKILL.STUN ||
        a[ARRAY.TANK_SKILL_READY][seat] > frame) return 0;
    const own = a[ARRAY.TANK_CELL][seat]; const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
    const distance = this.distance(state, own, enemy);
    if (seat) {
      if (distance <= 8) return 1;
      return this.leafEvaluator &&
        typeof this.leafEvaluator.bombPressure === "function" &&
        this.leafEvaluator.bombPressure(state, 0) >= 1200 ? 1 : 0;
    }
    const enemyStun = a[ARRAY.TANK_STUN_UNTIL][1];
    if (enemyStun !== NONE_FRAME && enemyStun > frame || distance > 9) return 0;
    if (this.oracleEnemyStationaryStreak >= 6) {
      const wanted = this.directionTo(state, enemy, own);
      const immediate = wanted === a[ARRAY.TANK_DIR][1] &&
        this.clearLine(state, enemy, own) && this.canFire(state, 1);
      const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
      const contested = star !== 0xffff &&
        this.distance(state, enemy, star) <= this.distance(state, own, star) + 1 &&
        this.v1EnemyMotionBasisPoints() > 2500;
      if (!immediate && distance > 3 && !contested) return 0;
    }
    if (distance <= 4 || this.clearLine(state, own, enemy)) return 1;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    return star !== 0xffff && this.distance(state, enemy, star) <=
      this.distance(state, own, star) + 3 ? 1 : 0;
  }

v1EnemyMotionBasisPoints() {
    let streak = 10000;
    if (this.oracleEnemyStationaryStreak >= 12) streak = 600;
    else if (this.oracleEnemyStationaryStreak >= 8) streak = 1200;
    else if (this.oracleEnemyStationaryStreak >= 5) streak = 3000;
    else if (this.oracleEnemyStationaryStreak >= 3) streak = 6000;
    const total = this.oracleOpponentCounts[0] + this.oracleOpponentCounts[1] +
      this.oracleOpponentCounts[2] + this.oracleOpponentCounts[3];
    const observed = Math.max(800, Math.min(10000,
      Math.trunc(this.oracleOpponentCounts[0] * 40000 / Math.max(1, total))));
    return Math.min(streak, observed);
  }

rootEnemyActionAllowed(engine, action) {
    const flags = this.rootEnemyDomainFlags;
    if (!flags) return 1;
    const state = engine.adapter.state; const a = state.arrays;
    if ((flags & ROOT_ENEMY_DOMAIN.DROP_PASSIVE) &&
        (action === ACTION.NONE || action === ACTION.THROW_BOMB)) return 0;
    if ((flags & ROOT_ENEMY_DOMAIN.QUALIFY_FIRE) &&
        action === ACTION.FIRE)
      return this.rootEnemyDomainMode === "v1-shaped" &&
        this.deepFireDomain &&
        typeof this.deepFireDomain.qualifiedFireForSeat === "function" ?
        this.deepFireDomain.qualifiedFireForSeat(state, 1, 10000) :
        this.usefulFire(state, 1);
    if ((flags & ROOT_ENEMY_DOMAIN.QUALIFY_MOTION_SKILL) &&
        action === ACTION.GO) {
      const next = this.targetCell(state, a[ARRAY.TANK_CELL][1],
        a[ARRAY.TANK_DIR][1]);
      return next !== 0xffff && next !== a[ARRAY.TANK_CELL][0] &&
        a[ARRAY.TERRAIN][next] !== TERRAIN.WALL &&
        a[ARRAY.TERRAIN][next] !== TERRAIN.DIRT ? 1 : 0;
    }
    if ((flags & ROOT_ENEMY_DOMAIN.QUALIFY_MOTION_SKILL) &&
        action === ACTION.CAST_STUN)
      return this.rootEnemyDomainMode === "v1-shaped" ?
        this.v1ShapedStun(state, 1) : this.usefulStun(state, 1);
    if (this.rootEnemyDomainMode !== "tactical") return 1;
    return action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT ? 1 : 0;
  }

scheduledDepth(engine) {
    if (this.depthSchedule !== "v1-state" || this.targetDepth < 3) return this.targetDepth;
    const state = engine.adapter.state; const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    if (this.distance(state, own, enemy) <= 6) return 3;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot]) return 3;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot] &&
          (!this.leafEvaluator || this.leafEvaluator.bombHits(state,
            a[ARRAY.BOMB_CELL][slot], own))) return 3;
    const x = state.x(own); const y = state.y(own);
    if (Math.min(x - 1, state.width - 2 - x, y - 1, state.height - 2 - y) <= 2)
      return 3;
    const stun = a[ARRAY.TANK_STUN_UNTIL][1];
    if (stun !== NONE_FRAME && stun > frame && stun - frame <= 2) return 3;
    return 2;
  }

opponentWeight(engine, state, action) {
    if (this.opponentMode === "v1-exact" && this.oracleOpponentReady)
      return this.v1OpponentWeight(state, action);
    if (!this.opponentWeighted || !engine.policy?.opponent) return 1000;
    const model = engine.policy.opponent; const context = this.context(state);
    let weight = 1000;
    if (action === ACTION.FIRE || action === ACTION.BOOST_LEFT_FIRE ||
        action === ACTION.BOOST_RIGHT_FIRE)
      weight += model.propensity(OPPONENT_EVENT.FIRE, context) * 2;
    else if (action === ACTION.THROW_BOMB || action === ACTION.BOOST_LEFT_BOMB ||
        action === ACTION.BOOST_RIGHT_BOMB)
      weight += model.propensity(OPPONENT_EVENT.BOMB, context);
    else if (action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST)
      weight += model.propensity(OPPONENT_EVENT.SKILL, context);
    else if (action === ACTION.GO || action === ACTION.BOOST_LEFT_GO ||
        action === ACTION.BOOST_RIGHT_GO)
      weight += model.propensity(OPPONENT_EVENT.ADVANCE, context);
    else if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT ||
        action === ACTION.BOOST_LEFT_TURN_LEFT ||
        action === ACTION.BOOST_LEFT_TURN_RIGHT ||
        action === ACTION.BOOST_RIGHT_TURN_LEFT ||
        action === ACTION.BOOST_RIGHT_TURN_RIGHT)
      weight += model.propensity(OPPONENT_EVENT.TURN_EXTRA, context);
    else weight += 5000 - model.riskPreference * 50;

    const a = state.arrays; const enemy = a[ARRAY.TANK_CELL][1];
    const own = a[ARRAY.TANK_CELL][0]; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (action === ACTION.GO) {
      const next = this.targetCell(state, enemy, a[ARRAY.TANK_DIR][1]);
      if (star !== 0xffff && next !== 0xffff &&
          this.distance(state, next, star) < this.distance(state, enemy, star))
        weight = Math.trunc(weight * 3 / 2);
    } else if (action === ACTION.FIRE &&
        this.usefulFire(state, 1)) weight = Math.trunc(weight * 5 / 2);
    else if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) {
      const direction = (a[ARRAY.TANK_DIR][1] +
        (action === ACTION.TURN_LEFT ? 3 : 1)) & 3;
      const dx = state.x(own) - state.x(enemy); const dy = state.y(own) - state.y(enemy);
      const wanted = !dx ? (dy < 0 ? 0 : 2) : !dy ? (dx > 0 ? 1 : 3) : -1;
      if (direction === wanted) weight = Math.trunc(weight * 17 / 10);
      if (star !== 0xffff) {
        const sx = state.x(star) - state.x(enemy); const sy = state.y(star) - state.y(enemy);
        const starDirection = Math.abs(sx) >= Math.abs(sy) && sx ?
          (sx > 0 ? 1 : 3) : sy ? (sy > 0 ? 2 : 0) : -1;
        if (direction === starDirection) weight = Math.trunc(weight * 13 / 10);
      }
    }
    ;
    return Math.max(1, weight);
  }

v1OpponentWeight(state, action) {
    const actionIndex = action === ACTION.GO ? 0 : action === ACTION.TURN_LEFT ? 1 :
      action === ACTION.TURN_RIGHT ? 2 : action === ACTION.FIRE ? 3 : -1;
    let weight = (actionIndex >= 0 ? this.oracleOpponentCounts[actionIndex] : 1) * 1000;
    const a = state.arrays; const enemy = a[ARRAY.TANK_CELL][1];
    const own = a[ARRAY.TANK_CELL][0]; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (action === ACTION.GO) {
      const next = this.targetCell(state, enemy, a[ARRAY.TANK_DIR][1]);
      if (next === 0xffff || next === own ||
          a[ARRAY.TERRAIN][next] === TERRAIN.WALL ||
          a[ARRAY.TERRAIN][next] === TERRAIN.DIRT) return 50;
      weight = Math.trunc(weight * (10 + Math.min(5,
        this.oracleOpponentGoStreak) * 3) / 10);
      let streakFactor = 10000;
      if (this.oracleEnemyStationaryStreak >= 12) streakFactor = 600;
      else if (this.oracleEnemyStationaryStreak >= 8) streakFactor = 1200;
      else if (this.oracleEnemyStationaryStreak >= 5) streakFactor = 3000;
      else if (this.oracleEnemyStationaryStreak >= 3) streakFactor = 6000;
      const total = this.oracleOpponentCounts[0] + this.oracleOpponentCounts[1] +
        this.oracleOpponentCounts[2] + this.oracleOpponentCounts[3];
      const observedMove = Math.max(800, Math.min(10000,
        Math.trunc(this.oracleOpponentCounts[0] * 40000 / Math.max(1, total))));
      weight = Math.trunc(weight * Math.min(streakFactor, observedMove) / 10000);
      if (star !== 0xffff && this.distance(state, next, star) <
          this.distance(state, enemy, star)) weight = Math.trunc(weight * 3 / 2);
    } else if (action === ACTION.FIRE) {
      const wanted = this.directionTo(state, enemy, own);
      if (wanted === a[ARRAY.TANK_DIR][1] && this.clearLine(state, enemy, own))
        weight = Math.trunc(weight * 5 / 2);
    } else if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) {
      const direction = (a[ARRAY.TANK_DIR][1] +
        (action === ACTION.TURN_LEFT ? 3 : 1)) & 3;
      const wanted = this.directionTo(state, enemy, own);
      if (wanted === direction) weight = Math.trunc(weight * 17 / 10);
      if (star !== 0xffff) {
        const starDirection = this.directionTo(state, enemy, star);
        if (starDirection === direction) weight = Math.trunc(weight * 13 / 10);
      }
    }
    ;
    return Math.max(10, weight);
  }

push(top, seat, action, argument = 0) {
    const counts = seat ? this.deepEnemyCount : this.deepOurCount;
    const actions = seat ? this.deepEnemyActions : this.deepOurActions;
    const arguments_ = seat ? this.deepEnemyArguments : this.deepOurArguments;
    const count = counts[top]; if (count >= DEEP_WIDTH) return;
    const at = top * DEEP_WIDTH + count;
    actions[at] = action; arguments_[at] = argument; counts[top] = count + 1;
  }

generatePrimitive(engine, top, seat) {
    const counts = seat ? this.deepEnemyCount : this.deepOurCount;
    counts[top] = 0; const state = engine.adapter.state; const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.deepDomainMode === "v1-shaped") {
      const frozenUntil = a[ARRAY.TANK_FROZEN_UNTIL][seat];
      const poisonUntil = a[ARRAY.TANK_POISON_UNTIL][seat];
      const poisonApplied = a[ARRAY.TANK_POISON_APPLIED][seat];
      const poisonHold = poisonUntil !== NONE_FRAME && poisonUntil > frame &&
        poisonApplied !== NONE_FRAME && ((frame - poisonApplied) & 1) !== 0;
      if (frozenUntil !== NONE_FRAME && frozenUntil > frame ||
          poisonHold) {
        this.push(top, seat, ACTION.NONE);
        return counts[top];
      }
    }
    const cell = a[ARRAY.TANK_CELL][seat]; const other = a[ARRAY.TANK_CELL][seat ^ 1];
    const direction = a[ARRAY.TANK_DIR][seat];
    const next = engine.depthSearch.target(state, cell, direction);
    if (engine.depthSearch.walkable(state, next) && next !== other)
      this.push(top, seat, ACTION.GO);
    const fire = this.deepDomainMode === "v1-shaped" && this.deepFireDomain &&
        typeof this.deepFireDomain.qualifiedFireForSeat === "function" ?
      this.deepFireDomain.qualifiedFireForSeat(state, seat,
        seat ? 10000 : this.v1EnemyMotionBasisPoints()) :
      !seat && this.deepFireMode === "v1-own" && this.deepFireDomain ?
      (this.deepV1FireCheckCount += 1, this.deepFireDomain.qualifiedFire(state)) :
      this.usefulFire(state, seat);
    if (fire) this.push(top, seat, ACTION.FIRE);
    const stun = this.deepDomainMode === "v1-shaped" ?
      this.v1ShapedStun(state, seat) :
      (this.deepSkillMode & (seat ? 2 : 1)) && this.usefulStun(state, seat);
    // V1 inserts our stun before turns, but appends the opponent skill after
    // LEFT/RIGHT. Preserve this ordering because equal minimax values keep the
    // first action.
    if (stun && !seat) {
      this.push(top, seat, ACTION.CAST_STUN);
      ;
    }
    if (this.deepDomainMode === "v1-shaped" &&
        this.deepBombMode === "qualified" && !seat && this.deepFireDomain &&
        a[ARRAY.TANK_BOMB_READY][0] <= frame &&
        typeof this.deepFireDomain.qualifiedBomb === "function" &&
        this.deepFireDomain.qualifiedBomb(state))
      this.push(top, seat, ACTION.THROW_BOMB);
    this.push(top, seat, ACTION.TURN_LEFT);
    this.push(top, seat, ACTION.TURN_RIGHT);
    if (stun && seat) {
      this.push(top, seat, ACTION.CAST_STUN);
      ;
    }
    if (!counts[top]) this.push(top, seat, ACTION.NONE);
    return counts[top];
  }

generate(engine, top, seat) {
    let count;
    if (this.fullPrimitiveDomain) count = this.generatePrimitive(engine, top, seat);
    else {
      const search = engine.depthSearch;
      search.generateDeep(top, engine.adapter.state, seat);
      const sourceActions = seat ? search.deepEnemyActions : search.deepOurActions;
      const sourceArguments = seat ? search.deepEnemyArguments : search.deepOurArguments;
      const sourceCount = seat ? search.frameEnemyCount[top] : search.frameOurCount[top];
      const actions = seat ? this.deepEnemyActions : this.deepOurActions;
      const arguments_ = seat ? this.deepEnemyArguments : this.deepOurArguments;
      const counts = seat ? this.deepEnemyCount : this.deepOurCount;
      counts[top] = sourceCount;
      for (let index = 0; index < sourceCount; index += 1) {
        const from = top * 4 + index; const to = top * DEEP_WIDTH + index;
        actions[to] = sourceActions[from]; arguments_[to] = sourceArguments[from];
      }
      count = sourceCount;
    }
    if (!seat) {
      this.policyEnvelopeAbortNode[top] = 0;
      this.policyEnvelopeRescueNode[top] = 0;
    }
    if (!seat && this.currentContinuationPolicy !== CONTINUATION_POLICY.BASE) {
      const state = engine.adapter.state; const a = state.arrays;
      let committed = 0;
      for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
        if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
            a[ARRAY.PROJECTILE_OWNER][slot] === 1) {
          committed = 1; break;
        }
      if (!committed)
        for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
          if (a[ARRAY.BOMB_ACTIVE][slot]) { committed = 1; break; }
      if (committed) {
        // Safety owns committed danger.  Keep the ordinary legal domain so
        // the search may find a rescue instead of forcing attack progress.
        ;
        this.policyEnvelopeRescueNode[top] = 1;
      } else if (this.pathPolicyEvent[top]) {
        // FIRE is the terminal event of ATTACK_TARGET.  Once emitted, the
        // option hands control back to the baseline policy for positioning
        // and escape instead of circling the already-completed firing pose.
        ;
      } else {
        const wanted = this.currentContinuationGenerator &&
            typeof this.currentContinuationGenerator.routeAction === "function" ?
          this.currentContinuationGenerator.routeAction(state) : ACTION.NONE;
        let found = -1;
        for (let index = 0; index < count; index += 1)
          if (this.deepOurActions[top * DEEP_WIDTH + index] === wanted) {
            found = index; break;
          }
        if (wanted === ACTION.NONE) {
          // A long policy has an explicit abort condition.  Losing contact or
          // finding no viable firing pose returns control to the baseline
          // policy; it is not fake exactness and not a stuck plan.
          ;
          this.policyEnvelopeAbortNode[top] = 1;
        } else {
          const offset = top * DEEP_WIDTH;
          if (found < 0) ;
          this.deepOurActions[offset] = wanted;
          this.deepOurArguments[offset] = found < 0 ? 0xffff :
            this.deepOurArguments[offset + found];
          this.deepOurCount[top] = 1; count = 1;
        }
      }
    }
    if (!seat && this.eventQuiescenceContinuationMode === "base-policy" &&
        this.eventQuiescenceRoutingTop === top) {
      const wanted = this.eventQuiescenceRoutedAction;
      let found = -1;
      for (let index = 0; index < count; index += 1)
        if (this.deepOurActions[top * DEEP_WIDTH + index] === wanted) {
          found = index; break;
        }
      if (found >= 0) {
        const offset = top * DEEP_WIDTH;
        this.deepOurActions[offset] = this.deepOurActions[offset + found];
        this.deepOurArguments[offset] = this.deepOurArguments[offset + found];
        this.deepOurCount[top] = 1; count = 1;
      } else ;
    }
    if (!seat && this.ownContinuationMode !== "full" && count > 0) {
      const continuation = this.currentOwnContinuation || this.ownContinuation;
      const wanted = continuation &&
          typeof continuation.routeAction === "function" ?
        continuation.routeAction(engine.adapter.state) : -1;
      let found = -1; let secondaryFound = -1; let secondaryWanted = -1;
      if (wanted > ACTION.NONE && wanted <= ACTION.BOOST_RIGHT_BOMB) {
        ;
        for (let index = 0; index < count; index += 1)
          if (this.deepOurActions[top * DEEP_WIDTH + index] === wanted) {
            found = index; break;
          }
      } else ;
      if (this.ownContinuationMode === "portfolio") {
        const secondary = this.ownContinuationSecondary;
        secondaryWanted = secondary &&
            typeof secondary.routeAction === "function" ?
          secondary.routeAction(engine.adapter.state) : -1;
        if (secondaryWanted > ACTION.NONE &&
            secondaryWanted <= ACTION.BOOST_RIGHT_BOMB) {
          ;
          if (secondaryWanted === wanted)
            ;
          else for (let index = 0; index < count; index += 1)
            if (this.deepOurActions[top * DEEP_WIDTH + index] ===
                secondaryWanted) { secondaryFound = index; break; }
        } else ;
      }
      // A policy must remain total over the legal domain.  If its preferred
      // action is unavailable, use the generator's stable first legal action
      // instead of silently reopening the full Minimax branch.
      if (found < 0) {
        found = 0; ;
      }
      const offset = top * DEEP_WIDTH;
      const selectedAction = this.deepOurActions[offset + found];
      const selectedArgument = this.deepOurArguments[offset + found];
      const secondaryAction = secondaryFound >= 0 ?
        this.deepOurActions[offset + secondaryFound] : ACTION.NONE;
      const secondaryArgument = secondaryFound >= 0 ?
        this.deepOurArguments[offset + secondaryFound] : 0xffff;
      this.deepOurActions[offset] = selectedAction;
      this.deepOurArguments[offset] = selectedArgument;
      count = 1;
      if (secondaryFound >= 0 && secondaryAction !== selectedAction) {
        this.deepOurActions[offset + 1] = secondaryAction;
        this.deepOurArguments[offset + 1] = secondaryArgument;
        count = 2;
      }
      this.deepOurCount[top] = count;
      this.ownContinuationPortfolioWidthCount[count] += 1;
      this.ownContinuationActionCount[this.deepOurActions[offset]] += 1;
      if (count === 2)
        this.ownContinuationActionCount[this.deepOurActions[offset + 1]] += 1;
    }
    if (seat) ;
    else ;
    const actions = seat ? this.deepEnemyActions : this.deepOurActions;
    const offset = top * DEEP_WIDTH; const actionBase = seat * ACTION_WIDTH;
    for (let index = 0; index < count; index += 1)
      this.deepActionCount[actionBase + actions[offset + index]] += 1;
    return count;
  }

positionWalkable(state, cell, blocked = 0xffff) {
    if (cell === 0xffff || cell === blocked) return 0;
    const tile = state.arrays[ARRAY.TERRAIN][cell];
    return tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT ? 1 : 0;
  }

positionAdvance(state, cell, direction, speed, blocked = 0xffff) {
    let result = cell;
    for (let step = 0; step < speed; step += 1) {
      const next = this.targetCell(state, result, direction);
      if (!this.positionWalkable(state, next, blocked)) break;
      result = next;
    }
    return result;
  }

positionBombHit(state, center, candidate) {
    const cx = state.x(center); const cy = state.y(center);
    const tx = state.x(candidate); const ty = state.y(candidate);
    if (cx === tx && cy === ty) return 1;
    if (cx !== tx && cy !== ty) return 0;
    const distance = Math.abs(cx - tx) + Math.abs(cy - ty);
    if (distance > RULE.BOMB_RANGE) return 0;
    const dx = tx === cx ? 0 : tx > cx ? 1 : -1;
    const dy = ty === cy ? 0 : ty > cy ? 1 : -1;
    const terrain = state.arrays[ARRAY.TERRAIN];
    for (let step = 1; step <= distance; step += 1) {
      const tile = terrain[state.cell(cx + dx * step, cy + dy * step)];
      if (tile === TERRAIN.WALL) return 0;
      if (tile === TERRAIN.DIRT) return step === distance ? 1 : 0;
    }
    return 1;
  }

positionProjectileEscape(state, cell, direction, speed, bulletDirection) {
    const forward = this.positionAdvance(state, cell, direction, speed);
    if (forward !== cell && ((bulletDirection & 1) ?
      state.y(forward) !== state.y(cell) : state.x(forward) !== state.x(cell)))
      return 1;
    const left = this.positionAdvance(state, cell, (direction + 3) & 3, speed);
    const right = this.positionAdvance(state, cell, (direction + 1) & 3, speed);
    if (left !== cell && ((bulletDirection & 1) ?
      state.y(left) !== state.y(cell) : state.x(left) !== state.x(cell))) return 2;
    if (right !== cell && ((bulletDirection & 1) ?
      state.y(right) !== state.y(cell) : state.x(right) !== state.x(cell))) return 2;
    return 99;
  }

positionSingleMuzzleRisk(state, shooter, shooterDirection, target,
    targetDirection, targetSpeed, canFire, boosted) {
    if (!canFire || shooter === 0xffff) return 0;
    const wanted = this.directionTo(state, shooter, target);
    const distance = this.distance(state, shooter, target);
    const lineOpen = wanted >= 0 && this.clearLine(state, shooter, target);
    if (wanted >= 0 && lineOpen) {
      const delta = Math.abs(shooterDirection - wanted);
      const turns = Math.min(delta, 4 - delta);
      if (turns === 0 && distance <= 2)
        return this.positionProjectileEscape(state, target, targetDirection,
          targetSpeed, shooterDirection) <= 1 ? 1200 : 50000;
      if (turns === 0 && distance <= 4) {
        const frames = (distance + 1) >> 1;
        const escape = this.positionProjectileEscape(state, target,
          targetDirection, targetSpeed, shooterDirection) <= frames;
        if (distance === 3) return escape ? 4000 : 22000;
        return escape ? 1800 : 10000;
      }
      if (boosted && turns === 1 && distance <= 2) return 35000;
      if (distance === 1) return 1200;
    }
    if (distance <= 2) return 650;
    if (distance === 3) return 400;
    return 0;
  }

positionMuzzleRisk(state, target, targetDirection, targetSpeed) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const shooter = a[ARRAY.TANK_CELL][1];
    const shooterDirection = a[ARRAY.TANK_DIR][1];
    const canFire = this.canFire(state, 1);
    const boosted = a[ARRAY.TANK_BOOST_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_BOOST_UNTIL][1] > frame;
    let risk = this.positionSingleMuzzleRisk(state, shooter, shooterDirection,
      target, targetDirection, targetSpeed, canFire, boosted);
    const overloaded = a[ARRAY.TANK_OVERLOAD_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_OVERLOAD_UNTIL][1] > frame;
    if (!overloaded || !canFire) return risk;
    const horizontal = shooterDirection === 1 || shooterDirection === 3;
    const x = state.x(shooter) + (horizontal ? 0 : 1);
    const y = state.y(shooter) + (horizontal ? 1 : 0);
    const secondary = x < 0 || x >= state.width || y < 0 || y >= state.height ?
      0xffff : state.cell(x, y);
    return Math.max(risk, this.positionSingleMuzzleRisk(state, secondary,
      shooterDirection, target, targetDirection, targetSpeed, canFire, boosted));
  }

positionEdgePenalty(state, cell, direction) {
    const a = state.arrays; const enemy = a[ARRAY.TANK_CELL][1];
    const x = state.x(cell); const y = state.y(cell);
    const ring = Math.max(0, Math.min(x - 1, state.width - 2 - x,
      y - 1, state.height - 2 - y));
    let exits = 0;
    for (let axis = 0; axis < 4; axis += 1)
      exits += this.positionWalkable(state,
        this.targetCell(state, cell, axis), 0xffff);
    let penalty = ring <= 1 ? 105 : ring === 2 ? 48 : ring === 3 ? 16 : 0;
    if (exits <= 1) penalty += 145;
    else if (exits === 2) penalty += ring <= 2 ? 58 : 26;
    if (ring <= 2 && !this.positionWalkable(state,
      this.targetCell(state, cell, direction), 0xffff)) penalty += 34;
    const pressureDistance = this.distance(state, cell, enemy);
    if (pressureDistance <= 3) penalty *= 1.65;
    else if (pressureDistance <= 5) penalty *= 1.3;
    if (a[ARRAY.TANK_STARS][0] > a[ARRAY.TANK_STARS][1]) penalty *= 1.35;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star !== 0xffff && this.distance(state, cell, star) <= 2) penalty *= 0.5;
    return penalty;
  }

positionImmediateRisk(state, cell, direction) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    let risk = 0;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1) {
      if (!a[ARRAY.BOMB_ACTIVE][slot] ||
          !this.positionBombHit(state, a[ARRAY.BOMB_CELL][slot], cell)) continue;
      const remaining = a[ARRAY.BOMB_EXPLODE][slot] - frame;
      if (remaining <= 0) return 100000;
      risk = Math.max(risk, Math.max(250, 9000 / (remaining + 1)));
    }
    const speed = a[ARRAY.TANK_BOOST_UNTIL][0] !== NONE_FRAME &&
      a[ARRAY.TANK_BOOST_UNTIL][0] > frame ? 2 : 1;
    risk += this.positionMuzzleRisk(state, cell, direction, speed);
    return risk + this.positionEdgePenalty(state, cell, direction) * 0.2;
  }

v1OwnChance(state, action) {
    ;
    if (action !== ACTION.GO && action !== ACTION.TURN_LEFT &&
        action !== ACTION.TURN_RIGHT) return CHANCE.NORMAL;
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][0];
    const direction = a[ARRAY.TANK_DIR][0];
    let normalCell = cell; let reverseCell = cell;
    let normalDirection = direction; let reverseDirection = direction;
    if (action === ACTION.GO) {
      const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
      const speed = a[ARRAY.TANK_BOOST_UNTIL][0] !== NONE_FRAME &&
        a[ARRAY.TANK_BOOST_UNTIL][0] > frame ? 2 : 1;
      normalCell = this.positionAdvance(state, cell, direction, speed,
        a[ARRAY.TANK_CELL][1]);
      reverseCell = this.positionAdvance(state, cell, (direction + 2) & 3,
        speed, a[ARRAY.TANK_CELL][1]);
    } else {
      const amount = action === ACTION.TURN_LEFT ? 3 : 1;
      normalDirection = (direction + amount) & 3;
      reverseDirection = (direction + (4 - amount)) & 3;
    }
    const normalRisk = this.positionImmediateRisk(state, normalCell,
      normalDirection);
    const reverseRisk = this.positionImmediateRisk(state, reverseCell,
      reverseDirection);
    if (reverseRisk >= normalRisk) {
      ; return CHANCE.REVERSED;
    }
    return CHANCE.NORMAL;
  }

transitionValue(engine, action0, argument0, action1, argument1, depth, top,
    pathScore = 0, nominalPathScore = pathScore) {
    ;
    const bundle = engine.adapter.bundle; const state = bundle.state;
    const previousAction = top > 1 ? this.pathAction[top - 1] :
      (engine.lastAction ?? ACTION.NONE);
    const previousTurnStreak = top > 1 ? this.pathTurnStreak[top - 1] :
      (engine.turnStreak | 0);
    const turning = action0 === ACTION.TURN_LEFT || action0 === ACTION.TURN_RIGHT;
    this.pathAction[top] = action0;
    this.pathTurnStreak[top] = turning ? Math.min(255, previousTurnStreak + 1) : 0;
    this.pathPolicyEvent[top] = ((top > 1 ? this.pathPolicyEvent[top - 1] : 0) ||
      action0 === ACTION.FIRE) ? 1 : 0;
    this.pathPolicyAbort[top] = top > 1 &&
      (this.pathPolicyAbort[top - 1] || this.policyEnvelopeAbortNode[top - 1]) ?
      1 : 0;
    this.pathPolicyRescue[top] = top > 1 &&
      (this.pathPolicyRescue[top - 1] || this.policyEnvelopeRescueNode[top - 1]) ?
      1 : 0;
    const actionScore = this.pathUtility ? this.pathUtility.scoreTransition(state,
      action0, action1, previousAction, previousTurnStreak, top) : 0;
    const baseNextPathScore = pathScore + actionScore;
    const baseNextNominalPathScore = nominalPathScore + actionScore;
    let ownChance = engine.depthSearch.chanceAlternatives(state, 0, action0);
    let ownDeterministicChance = CHANCE.NORMAL;
    if (this.ownChanceMode === "v1-deterministic" && ownChance > 1) {
      ownDeterministicChance = this.v1OwnChance(state, action0);
      ownChance = 1;
    }
    const enemyChance = engine.depthSearch.chanceAlternatives(state, 1, action1);
    let sum = 0; let nominalSum = 0; let count = 0;
    let worstOwn = VALUE_MAX; let worstOwnNominal = VALUE_MAX;
    for (let own = 0; own < ownChance; own += 1) {
      let ownSum = 0; let ownNominalSum = 0; let ownCount = 0;
      for (let enemy = 0; enemy < enemyChance; enemy += 1) {
        ;
        const mark = state.deltaUsed * 1024 + state.eventUsed;
        const appliedPathToken = this.pathUtility &&
            typeof this.pathUtility.prepareAppliedTransition === "function" ?
          this.pathUtility.prepareAppliedTransition(state, action0) : 0xffffffff;
        const beforeFrame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
        const status = this.diagnosticKernel.applyFrame(action0, argument0,
          action1, argument1, ownChance === 1 ? ownDeterministicChance : own,
          enemyChance === 1 ? CHANCE.NORMAL : enemy);
        let value; let nominalValue; let leaf = 0;
        let nextPathScore = baseNextPathScore;
        let nextNominalPathScore = baseNextNominalPathScore;
        if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
          value = -22000; nominalValue = value; this.fastIncompleteCount += 1;
          leaf = 1;
        } else {
          this.extendV1StunCountdown(state, action0, action1, beforeFrame);
          if (this.pathUtility &&
              typeof this.pathUtility.scoreAppliedTransition === "function") {
            const appliedScore = this.pathUtility.scoreAppliedTransition(state,
              action0, action1, enemyChance === 1 ? CHANCE.NORMAL : enemy,
              appliedPathToken);
            nextNominalPathScore += appliedScore;
            if (this.pathEvidenceMode !== "split-nominal")
              nextPathScore += appliedScore;
          }
          if (top === 1 && this.currentRootMatrixIndex >= 0)
            this.rootTradeClass[this.currentRootMatrixIndex] =
              this.terminalTradeClass(state);
          const superko = this.superkoPenalty(state, top);
          nextPathScore -= superko; nextNominalPathScore -= superko;
          const terminal = state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
          const hard = this.deepHardMode === "terminal-only" ? HARD_STATUS.ALLOW :
            this.diagnosticHard.classifyApplied();
          if (hard === HARD_STATUS.ALLOW) ;
          else if (hard === HARD_STATUS.REJECT_PROVEN)
            ;
          else if (hard === HARD_STATUS.REJECT_POLICY)
            this.hardRejectPolicyCount += 1;
          else if (hard === HARD_STATUS.INCOMPLETE) this.hardIncompleteCount += 1;
          if (terminal && terminal !== TERMINAL.INCOMPLETE) {
            const a = state.arrays;
            const combat = a[ARRAY.TANK_CRASH][0] || a[ARRAY.TANK_CRASH][1];
            if (combat) {
              ;
              if (a[ARRAY.TANK_CRASH][0] && a[ARRAY.TANK_CRASH][1])
                ;
            } else ;
            value = this.pairedTerminalUtility(engine, terminal, depth,
              nextPathScore, nextNominalPathScore, top);
            nominalValue = this.lastNominalValue;
            ;
            leaf = 1;
          } else if (hard === HARD_STATUS.REJECT_PROVEN) {
            value = -30000; nominalValue = value; leaf = 1;
          } else if (hard === HARD_STATUS.REJECT_POLICY && this.deepHardMode === "full") {
            value = -29000; nominalValue = value; leaf = 1;
          }
          else if (hard === HARD_STATUS.INCOMPLETE) {
            value = this.pairedLeaf(engine, nextPathScore,
              nextNominalPathScore, top) -
              (this.deepHardMode === "full" ? 6000 : 0);
            nominalValue = this.lastNominalValue -
              (this.deepHardMode === "full" ? 6000 : 0);
            leaf = 1;
          } else {
            value = this.policyValue(engine, depth - 1, top, nextPathScore,
              nextNominalPathScore);
            nominalValue = this.lastNominalValue;
          }
        }
        state.undoTo(mark); sum += value; nominalSum += nominalValue; count += 1;
        ownSum += value; ownNominalSum += nominalValue; ownCount += 1;
        if (this.hardBudgetInterrupt && this.iterationBudgetInterrupted) break;
      }
      if (ownCount) {
        const ownValue = Math.trunc(ownSum / ownCount);
        const ownNominal = Math.trunc(ownNominalSum / ownCount);
        if (count === ownCount || ownValue < worstOwn || ownValue === worstOwn &&
            ownNominal < worstOwnNominal) {
          worstOwn = ownValue; worstOwnNominal = ownNominal;
        }
      }
      if (this.hardBudgetInterrupt && this.iterationBudgetInterrupted) break;
    }
    if (!count) {
      return this.pairedLeaf(engine, baseNextPathScore,
        baseNextNominalPathScore, top);
    }
    if (this.ownChanceMode === "worst") {
      this.lastNominalValue = worstOwnNominal; return worstOwn;
    }
    this.lastNominalValue = Math.trunc(nominalSum / count);
    return Math.trunc(sum / count);
  }

worstReply(engine, action0, argument0, depth, top, pathScore,
    nominalPathScore) {
    const count = this.generate(engine, top, 1); const offset = top * DEEP_WIDTH;
    let worst = VALUE_MAX; let nominalWorst = VALUE_MAX;
    let sum = 0; let nominalSum = 0; let weightTotal = 0;
    for (let column = 0; column < count; column += 1) {
      const weight = this.opponentWeight(engine, engine.adapter.state,
        this.deepEnemyActions[offset + column]);
      const value = this.transitionValue(engine, action0, argument0,
        this.deepEnemyActions[offset + column],
        this.deepEnemyArguments[offset + column], depth, top + 1, pathScore,
        nominalPathScore);
      const nominal = this.lastNominalValue;
      if (column === 0 || value < worst || value === worst && nominal < nominalWorst) {
        worst = value; nominalWorst = nominal;
      }
      sum += value * weight; nominalSum += nominal * weight; weightTotal += weight;
      if (this.hardBudgetInterrupt && this.iterationBudgetInterrupted) break;
    }
    if (!count) {
      this.noActionLeafCount += 1;
      return this.pairedLeaf(engine, pathScore, nominalPathScore, top);
    }
    this.lastNominalValue = this.blended(nominalWorst, nominalSum, weightTotal);
    return this.blended(worst, sum, weightTotal);
  }

policyValue(engine, depth, top, pathScore, nominalPathScore) {
    this.nodes += 1;
    let routedEventExtension = 0;
    if (depth <= 0 &&
        this.eventQuiescenceMode !== EVENT_QUIESCENCE.OFF) {
      ;
      const eventMask = this.eventInstabilityMask(engine.adapter.state);
      if (!eventMask) ;
      else {
        if (eventMask & 1) ;
        if (eventMask & 2) ;
        const extraPly = Math.max(0, top - this.currentDepth);
        if (extraPly < this.eventQuiescenceMaximumPly && top < 4 &&
            this.nodes < this.perRootBudget) {
          let continuationReady = 1;
          if (this.eventQuiescenceContinuationMode === "base-policy") {
            const continuation = this.eventQuiescenceContinuation;
            const action = continuation &&
                typeof continuation.routeAction === "function" ?
              continuation.routeAction(engine.adapter.state) : -1;
            if (action > ACTION.NONE && action <= ACTION.BOOST_RIGHT_BOMB) {
              ;
              this.eventQuiescenceRoutedAction = action;
              routedEventExtension = 1;
            } else {
              continuationReady = 0;
              ;
            }
          }
          if (continuationReady) {
            depth = 1;
            ;
            this.eventQuiescenceExpansionByPly[extraPly + 1] += 1;
          } else ;
        } else ;
      }
    }
    this.policyNodeDepthCount[Math.max(0, Math.min(4, depth))] += 1;
    if (depth <= 0 || this.nodes >= this.perRootBudget || top >= 4) {
      if (depth <= 0 && this.hardBudgetInterrupt) {
        this.depthLeafCount += 1;
        if (this.nodes >= this.perRootBudget) {
          // The current leaf is valid, but evaluating any sibling would exceed
          // the shared allowance.  Mark the attempted layer incomplete rather
          // than publishing a matrix whose final cells depend on loop order.
          this.leafBudgetCount += 1;
          this.iterationBudgetInterrupted = 1;
          ;
        }
      }
      else if (this.nodes >= this.perRootBudget) {
        this.leafBudgetCount += 1;
        if (this.hardBudgetInterrupt) {
          this.iterationBudgetInterrupted = 1;
          ;
        }
      }
      else if (depth <= 0) this.depthLeafCount += 1;
      else this.topLeafCount += 1;
      return this.pairedLeaf(engine, pathScore, nominalPathScore, top);
    }
    if (routedEventExtension) this.eventQuiescenceRoutingTop = top;
    const count = this.generate(engine, top, 0); const offset = top * DEEP_WIDTH;
    this.eventQuiescenceRoutingTop = -1;
    let best = VALUE_MIN; let nominalBest = VALUE_MIN;
    for (let row = 0; row < count; row += 1) {
      const value = this.worstReply(engine, this.deepOurActions[offset + row],
        this.deepOurArguments[offset + row], depth, top, pathScore,
        nominalPathScore);
      const nominal = this.lastNominalValue;
      if (row === 0 || value > best || value === best && nominal > nominalBest) {
        best = value; nominalBest = nominal;
      }
      if (this.hardBudgetInterrupt && this.iterationBudgetInterrupted) break;
    }
    if (!count) {
      this.noActionLeafCount += 1;
      return this.pairedLeaf(engine, pathScore, nominalPathScore, top);
    }
    this.lastNominalValue = nominalBest; return best;
  }

rootCell(engine, row, column) {
    this.currentRootMatrixIndex = row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column;
    const value = this.transitionValue(engine, engine.ourActions[row],
      engine.ourArguments[row], engine.enemyActions[column],
      engine.enemyArguments[column], this.currentDepth, 1, 0, 0);
    this.currentRootMatrixIndex = -1;
    return value;
  }

rootColumnIndex(step, count) {
    if (this.rootColumnOrder === "v1") return this.rootColumnSequence[step];
    return this.rootColumnOrder === "reverse" ? count - 1 - step : step;
  }

buildRootColumnSequence(engine) {
    const count = engine.enemyCount;
    this.rootColumnUsed.fill(0, 0, count);
    let output = 0;
    if (this.rootColumnOrder === "v1")
      for (let order = 0; order < V1_ENEMY_ROOT_ORDER.length; order += 1)
        for (let column = 0; column < count; column += 1)
          if (!this.rootColumnUsed[column] && this.rootEnemyDomainMask[column] &&
              engine.enemyActions[column] === V1_ENEMY_ROOT_ORDER[order]) {
            this.rootColumnSequence[output++] = column;
            this.rootColumnUsed[column] = 1;
          }
    for (let column = 0; column < count; column += 1)
      if (!this.rootColumnUsed[column]) {
        this.rootColumnSequence[output++] = column;
        this.rootColumnUsed[column] = 1;
      }
    return output;
  }

setOracleOpponentContext(census) {
    this.oracleOpponentReady = census?.opponentCounts ? 1 : 0;
    this.currentBlendBasisPoints = this.blendBasisPoints;
    if (!this.oracleOpponentReady) return;
    this.oracleOpponentCounts[0] = census.opponentCounts.GO || 1;
    this.oracleOpponentCounts[1] = census.opponentCounts.LEFT || 1;
    this.oracleOpponentCounts[2] = census.opponentCounts.RIGHT || 1;
    this.oracleOpponentCounts[3] = census.opponentCounts.FIRE || 1;
    ;
    this.oracleOpponentGoStreak = census.opponentGoStreak || 0;
    this.oracleEnemyStationaryStreak = census.enemyStationaryStreak || 0;
    if (this.pathUtility &&
        typeof this.pathUtility.setOpponentContext === "function")
      this.pathUtility.setOpponentContext(this.oracleOpponentCounts[0],
        this.oracleOpponentCounts[1], this.oracleOpponentCounts[2],
        this.oracleOpponentCounts[3], this.oracleEnemyStationaryStreak);
    if (this.opponentMode === "v1-exact")
      this.currentBlendBasisPoints = Math.max(0, Math.min(5000,
        Number.isSafeInteger(census.expectationBlendBasisPoints) ?
          census.expectationBlendBasisPoints :
          Math.round((census.expectationBlend || 0) * 10000)));
  }

scheduleBlend(state) {
    if (this.blendSchedule !== "star-state") return this.currentBlendBasisPoints;
    const stars = state.arrays[ARRAY.TANK_STARS];
    const bucket = stars[0] > stars[1] ? 2 : stars[0] < stars[1] ? 0 : 1;
    ;
    this.currentBlendBasisPoints = bucket === 2 ?
      this.leadingBlendBasisPoints : bucket === 0 ?
        this.trailingBlendBasisPoints : this.blendBasisPoints;
    return this.currentBlendBasisPoints;
  }

exactMask(budget, fast, hard, depth, top, policy, noAction) {
    let mask = 0;
    if (budget) mask |= EXACT_BLOCK.BUDGET;
    if (fast) mask |= EXACT_BLOCK.FAST_INCOMPLETE;
    if (hard) mask |= EXACT_BLOCK.HARD_INCOMPLETE;
    if (depth) mask |= EXACT_BLOCK.DEPTH_LEAF;
    if (top) mask |= EXACT_BLOCK.TOP_LEAF;
    if (policy) mask |= EXACT_BLOCK.POLICY_REJECT_LEAF;
    if (noAction) mask |= EXACT_BLOCK.NO_ACTION_LEAF;
    return mask;
  }

classifyExactBlock() {
    const mask = this.exactMask(this.lastBudgetLeafCount,
      this.lastFastIncompleteCount, this.lastHardIncompleteCount,
      this.lastDepthLeafCount, this.lastTopLeafCount,
      this.lastPolicyRejectCount, this.lastNoActionLeafCount);
    ;
    this.exactBlockMaskCount[mask] += 1;
    if (mask) ;
    if (this.lastOwnershipSupportComplete && mask) {
      ;
      if (mask === EXACT_BLOCK.DEPTH_LEAF)
        ;
    }
    return mask;
  }

prepare(engine, count, rootEligibility = null) {
    ; ;
    ;
    ; ;
    this.lastOwnershipSupportComplete = 0;
    this.lastValueExact = 0;
    this.lastBudgetLeafCount = 0;
    this.lastFastIncompleteCount = 0;
    this.lastHardIncompleteCount = 0;
    this.lastDepthLeafCount = 0; this.lastTopLeafCount = 0;
    this.lastPolicyRejectCount = 0; this.lastNoActionLeafCount = 0;
    ;
    ; this.rowExactBlockMask.fill(127);
    const bundle = engine.adapter?.bundle; const state = bundle?.state;
    if (!bundle || !state || !engine.adapter.enemyVisible || count < 1 ||
        engine.enemyCount < 1) return 0;
    if (this.eventQuiescenceContinuation)
      this.eventQuiescenceContinuation.engine = engine;
    if (this.ownContinuation) this.ownContinuation.engine = engine;
    if (this.ownContinuationSecondary &&
        Object.prototype.hasOwnProperty.call(this.ownContinuationSecondary,
          "engine")) this.ownContinuationSecondary.engine = engine;
    this.currentOwnContinuation = this.ownContinuation;
    let rootPolicyPrimaryAction = ACTION.NONE;
    let rootPolicySecondaryAction = ACTION.NONE;
    if (this.ownContinuationMode === "root-policy" ||
        this.ownContinuationMode === "root-policy-direct") {
      ;
      rootPolicyPrimaryAction = this.ownContinuation &&
          typeof this.ownContinuation.routeAction === "function" ?
        this.ownContinuation.routeAction(state) : ACTION.NONE;
      rootPolicySecondaryAction = this.ownContinuationSecondary &&
          typeof this.ownContinuationSecondary.routeAction === "function" ?
        this.ownContinuationSecondary.routeAction(state) : ACTION.NONE;
      rootPolicySecondaryAction = this.qualifyRootPolicySecondary(
        rootPolicySecondaryAction);
      if (rootPolicyPrimaryAction <= ACTION.NONE ||
          rootPolicyPrimaryAction > ACTION.BOOST_RIGHT_BOMB)
        ;
      if (rootPolicySecondaryAction <= ACTION.NONE ||
          rootPolicySecondaryAction > ACTION.BOOST_RIGHT_BOMB)
        ;
      else if (rootPolicySecondaryAction !== rootPolicyPrimaryAction)
        ;
    }
    ;
    this.scheduleBlend(state);
    for (let row = 0; row < count; row += 1)
      ;
    for (let column = 0; column < engine.enemyCount; column += 1)
      ;
    this.bindIsolatedHard(bundle);
    this.currentDepth = this.scheduledDepth(engine);
    ;
    if (this.leafEvaluator && typeof this.leafEvaluator.beginRoot === "function")
      this.leafEvaluator.beginRoot(state);
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    const hashLo = state.hashLo; const hashHi = state.hashHi;
    const kernel = this.diagnosticKernel;
    const kernelFailure = kernel.failure; const kernelLastMark = kernel.lastMark;
    const kernelApplied = kernel.appliedActionCount;
    const kernelHardChecked = kernel.hardCheckedActionCount;
    const transitionDeltaBase = state.transitionDeltaBase;
    const transitionEventBase = state.transitionEventBase;
    const highWaterDelta = state.highWaterDelta; const highWaterEvent = state.highWaterEvent;
    this.rootScore.fill(VALUE_MIN, 0, count);
    this.rootNominalScore.fill(VALUE_MIN, 0, count);
    if (this.collectTerminalTrade) this.rootTradeClass.fill(0);
    const restrictRoot = this.rootDomainMode === "primitive" ||
      this.rootDomainMode === "v1-shaped" ||
      this.rootDomainMode === "v1-actions" && this.oracleRootActionReady;
    let searchedCount = 0; let extraPoisonCount = 0;
    for (let row = 0; row < count; row += 1) {
      const action = engine.ourActions[row];
      let included = 1;
      if (this.rootDomainMode === "primitive")
        included = action >= ACTION.GO && action <= ACTION.FIRE ? 1 : 0;
      else if (this.rootDomainMode === "v1-shaped")
        included = this.rootV1ShapedAllowed(engine, action);
      else if (this.rootDomainMode === "v1-actions" && this.oracleRootActionReady)
        included = this.oracleRootActionMask[action];
      if (this.rootExtraPoison && action === ACTION.CAST_POISON) {
        if (!included) included = 1;
        extraPoisonCount += 1;
      }
      if (included && rootEligibility && !rootEligibility[row]) {
        included = 0;
        ;
      }
      this.rootDomainMask[row] = included ? 1 : 0;
      if (this.oracleRootActionReady) {
        const oracle = this.oracleRootActionMask[action] ? 1 : 0;
        ;
        if (included && oracle) ;
        else if (included) ;
        else if (oracle) ;
      }
      if (included) searchedCount += 1;
    }
    if (!searchedCount) return 0;
    let searchedEnemyCount = 0;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      const included = this.rootEnemyActionAllowed(engine,
        engine.enemyActions[column]);
      this.rootEnemyDomainMask[column] = included ? 1 : 0;
      if (included) searchedEnemyCount += 1;
    }
    this.buildRootColumnSequence(engine);
    if (!searchedEnemyCount) return 0;
    if (rootEligibility) ;
    this.rootDomainRestricted = restrictRoot || rootEligibility ? 1 : 0;
    const budgetLeafBefore = this.leafBudgetCount;
    const fastIncompleteBefore = this.fastIncompleteCount;
    const hardIncompleteBefore = this.hardIncompleteCount;
    const depthLeafBefore = this.depthLeafCount;
    const topLeafBefore = this.topLeafCount;
    const policyRejectBefore = this.hardRejectPolicyCount;
    const noActionLeafBefore = this.noActionLeafCount;
    this.iterationBudgetInterrupted = 0;
    this.perRootBudget = this.hardBudgetInterrupt ? Math.max(1, this.nodeBudget) :
      Math.max(12, Math.trunc(this.nodeBudget /
        Math.max(1, searchedCount - extraPoisonCount)));
    const rowBudget = this.perRootBudget;
    const cellBudget = Math.max(1, Math.trunc(this.nodeBudget /
      Math.max(1, (searchedCount - extraPoisonCount) * searchedEnemyCount)));
    let runNodes = 0;
    if (this.hardBudgetInterrupt) this.nodes = 0;
    for (let row = 0; row < count; row += 1) {
      if (!this.rootDomainMask[row]) continue;
      if ((this.ownContinuationMode === "root-policy" ||
           this.ownContinuationMode === "root-policy-direct") &&
          rootPolicySecondaryAction > ACTION.NONE &&
          rootPolicySecondaryAction <= ACTION.BOOST_RIGHT_BOMB &&
          rootPolicySecondaryAction !== rootPolicyPrimaryAction &&
          engine.ourActions[row] === rootPolicySecondaryAction) {
        this.currentOwnContinuation = this.ownContinuationSecondary;
        ;
      } else {
        this.currentOwnContinuation = this.ownContinuation;
        if (this.ownContinuationMode === "root-policy" ||
            this.ownContinuationMode === "root-policy-direct")
          ;
      }
      const rowBudgetBefore = this.leafBudgetCount;
      const rowFastBefore = this.fastIncompleteCount;
      const rowHardBefore = this.hardIncompleteCount;
      const rowDepthBefore = this.depthLeafCount;
      const rowTopBefore = this.topLeafCount;
      const rowPolicyBefore = this.hardRejectPolicyCount;
      const rowNoActionBefore = this.noActionLeafCount;
      const rootOffset = row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
      this.rootCellScore.fill(VALUE_MAX, rootOffset,
        rootOffset + engine.enemyCount);
      this.rootNominalCellScore.fill(VALUE_MAX, rootOffset,
        rootOffset + engine.enemyCount);
      if (!this.hardBudgetInterrupt) this.nodes = 0;
      let rowNodes = 0;
      let worst = VALUE_MAX; let nominalWorst = VALUE_MAX;
      let hasResponse = false;
      let sum = 0; let nominalSum = 0; let weightTotal = 0;
      for (let step = 0; step < engine.enemyCount; step += 1) {
        const column = this.rootColumnIndex(step, engine.enemyCount);
        if (!this.rootEnemyDomainMask[column]) continue;
        if (!this.hardBudgetInterrupt && this.rootBudgetMode === "cell-equal") {
          this.nodes = 0; this.perRootBudget = cellBudget;
        }
        const weight = this.opponentWeight(engine, state, engine.enemyActions[column]);
        const value = this.rootCell(engine, row, column);
        const nominalValue = this.lastNominalValue;
        if (!this.hardBudgetInterrupt && this.rootBudgetMode === "cell-equal")
          rowNodes += this.nodes;
        this.rootCellScore[row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column] = value;
        this.rootNominalCellScore[
          row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column] = nominalValue;
        if (!hasResponse || value < worst || value === worst && nominalValue < nominalWorst) {
          worst = value; nominalWorst = nominalValue;
        }
        hasResponse = true;
        sum += value * weight; nominalSum += nominalValue * weight;
        weightTotal += weight;
        if (this.hardBudgetInterrupt && this.iterationBudgetInterrupted) break;
      }
      this.rootScore[row] = this.blended(worst, sum, weightTotal);
      this.rootNominalScore[row] = this.blended(nominalWorst, nominalSum,
        weightTotal);
      const rowMask = this.exactMask(
        this.leafBudgetCount - rowBudgetBefore,
        this.fastIncompleteCount - rowFastBefore,
        this.hardIncompleteCount - rowHardBefore,
        this.depthLeafCount - rowDepthBefore,
        this.topLeafCount - rowTopBefore,
        this.hardRejectPolicyCount - rowPolicyBefore,
        this.noActionLeafCount - rowNoActionBefore);
      this.rowExactBlockMask[row] = rowMask;
      this.rowExactBlockMaskCount[rowMask] += 1;
      if (rowMask === 0) {
        ; ;
      } else ;
      if (!this.hardBudgetInterrupt)
        runNodes += this.rootBudgetMode === "cell-equal" ? rowNodes : this.nodes;
      if (this.hardBudgetInterrupt && this.iterationBudgetInterrupted) break;
    }
    if (this.hardBudgetInterrupt) runNodes = this.nodes;
    this.currentOwnContinuation = this.ownContinuation;
    this.perRootBudget = rowBudget;
    state.undoTo(mark);
    kernel.failure = kernelFailure; kernel.lastMark = kernelLastMark;
    kernel.appliedActionCount = kernelApplied;
    kernel.hardCheckedActionCount = kernelHardChecked;
    state.transitionDeltaBase = transitionDeltaBase;
    state.transitionEventBase = transitionEventBase;
    state.highWaterDelta = highWaterDelta; state.highWaterEvent = highWaterEvent;
    if (state.hashLo !== hashLo || state.hashHi !== hashHi) {
      ; return 0;
    }
    this.nodes = runNodes; ;
    if (runNodes > this.maximumNodes) this.maximumNodes = runNodes;
    ; ;
    ;
    ;
    ;
    this.lastBudgetLeafCount = this.leafBudgetCount - budgetLeafBefore;
    this.lastFastIncompleteCount =
      this.fastIncompleteCount - fastIncompleteBefore;
    this.lastHardIncompleteCount =
      this.hardIncompleteCount - hardIncompleteBefore;
    this.lastDepthLeafCount = this.depthLeafCount - depthLeafBefore;
    this.lastTopLeafCount = this.topLeafCount - topLeafBefore;
    this.lastPolicyRejectCount = this.hardRejectPolicyCount - policyRejectBefore;
    this.lastNoActionLeafCount = this.noActionLeafCount - noActionLeafBefore;
    this.lastOwnershipSupportComplete = !this.lastBudgetLeafCount &&
      !this.lastFastIncompleteCount && !this.lastHardIncompleteCount ? 1 : 0;
    this.lastValueExact = this.classifyExactBlock() === 0 ? 1 : 0;
    if (this.lastOwnershipSupportComplete) ;
    else ;
    if (this.lastValueExact) ;
    return 1;
  }
}

module.exports = { NativeBasePolicySearch, EXACT_BLOCK, CONTINUATION_POLICY, EVENT_QUIESCENCE };
