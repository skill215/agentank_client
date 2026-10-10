"use strict";

// BP139: exact-Physical AND/OR search to the first qualified attack event.
// A fixed frame cap without FIRE is UNKNOWN, never a negative leaf value.
// The enemy/chance domains stay complete.  The existential own domain is a
// deterministic, allocation-free attack-policy subset: a positive result is
// therefore a sound witness, while a negative subset result is UNKNOWN.
// This is diagnostic-only.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ARRAY, SCALAR } = require(
  "../../../engine-v2/src/state/fast-state");
const { ACTION, DIRECTION, FAST_STATUS, HARD_STATUS, TERMINAL, TERRAIN,
  NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require(
  "../../../engine-v2/src/abi/search-codes");
const { AttackEventPolicySearch } = require(
  "../../../engine-v2/src/search/attack-event-policy-search");
const { HazardKernel } = require("../../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../../engine-v2/src/fast/hard-gate");
const { NativeProjectileSettlementLexicographicPoc, SETTLEMENT } = require(
  "./native-tactical-domain-evaluator-poc");
const { MOVE_VARIANTS, MOVE_VARIANT_NAME, VARIANT_COUNT,
  VARIANT_COMMON_STATUS, isJointMovementGap } = require(
  "./semantic-attack-depth3-move-variant-shadow");
const { MoveContestVariantKernel } = require("./move-contest-variant-kernel");
const { ROOT_CAPACITY } = require(
  "./semantic-attack-depth3-leaf-backup-shadow");

const EVENT_GOAL = Object.freeze({ SAFE_THREAT_FIRE: 0,
  DOOMED_TARGET_FIRE: 1, COUNT: 2 });
const EVENT_GOAL_NAME = Object.freeze(["SAFE_THREAT_FIRE",
  "DOOMED_TARGET_FIRE"]);
const SIDE = Object.freeze({ BASELINE: 0, CANDIDATE: 1, COUNT: 2 });
const SEARCH_CELLS = EVENT_GOAL.COUNT * VARIANT_COUNT;
const RESULT_CELLS = SEARCH_CELLS * SIDE.COUNT;

function fireEventStatus(goal, outgoing, incoming) {
  if (incoming === SETTLEMENT.DOOMED) return PROOF_STATUS.DISPROVEN;
  if (incoming === SETTLEMENT.UNKNOWN) return PROOF_STATUS.UNKNOWN;
  if (outgoing === SETTLEMENT.UNKNOWN) return PROOF_STATUS.UNKNOWN;
  if (goal === EVENT_GOAL.DOOMED_TARGET_FIRE)
    return outgoing === SETTLEMENT.DOOMED ?
      PROOF_STATUS.PROVEN : PROOF_STATUS.DISPROVEN;
  return outgoing === SETTLEMENT.SURVIVES || outgoing === SETTLEMENT.DOOMED ?
    PROOF_STATUS.PROVEN : PROOF_STATUS.DISPROVEN;
}

function pairRelation(baseline, candidate) {
  if (baseline === PROOF_STATUS.UNKNOWN ||
      candidate === PROOF_STATUS.UNKNOWN) return 0;
  if (baseline === candidate) return 2;
  if (candidate === PROOF_STATUS.PROVEN &&
      baseline === PROOF_STATUS.DISPROVEN) return 1;
  if (candidate === PROOF_STATUS.DISPROVEN &&
      baseline === PROOF_STATUS.PROVEN) return 3;
  return 0;
}

class SafeFireEventHorizonSearch extends AttackEventPolicySearch {
  constructor(goal, nodeBudget = 4096) {
    super(nodeBudget); this.goal = goal; this.defaultNodeBudget = nodeBudget;
    this.settlement = new NativeProjectileSettlementLexicographicPoc();
    this.supportLossCount = 0; this.hardIncompleteCount = 0;
    this.fastIncompleteCount = 0; this.horizonStopCount = 0;
    this.fireEventCount = 0; this.threatFireCount = 0;
    this.doomedFireCount = 0; this.counterUnsafeCount = 0;
    this.maximumNodes = 0; this.lastSupportComplete = 0;
    this.ownDomainRestrictedCount = 0; this.maximumOwnDomain = 0;
    this.restrictedDisproofToUnknownCount = 0;
  }

  resetEvent(nodeBudget) {
    this.resetPolicy(nodeBudget); this.workUnitBudget = 0;
    this.supportLossCount = 0; this.hardIncompleteCount = 0;
    this.fastIncompleteCount = 0; this.horizonStopCount = 0;
    this.fireEventCount = 0; this.threatFireCount = 0;
    this.doomedFireCount = 0; this.counterUnsafeCount = 0;
    this.lastSupportComplete = 0;
    this.ownDomainRestrictedCount = 0; this.maximumOwnDomain = 0;
    this.restrictedDisproofToUnknownCount = 0;
  }

  actionIndex(top, action, count) {
    const base = top * SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    for (let row = 0; row < count; row += 1)
      if (this.ourActions[base + row] === action) return row;
    return -1;
  }

  appendOwnRepresentative(top, action, argument, count) {
    if (action < 0) return count;
    const base = top * SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    for (let row = 0; row < count; row += 1)
      if (this.ourActions[base + row] === action &&
          this.ourArguments[base + row] === argument) return count;
    this.ourActions[base + count] = action;
    this.ourArguments[base + count] = argument;
    return count + 1;
  }

  pursuitAction(state, secondary) {
    const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    if (own >= state.cells || enemy >= state.cells) return ACTION.NONE;
    const dx = state.x(enemy) - state.x(own);
    const dy = state.y(enemy) - state.y(own);
    if (!dx && !dy) return ACTION.NONE;
    let desired;
    if ((!secondary && Math.abs(dx) >= Math.abs(dy)) ||
        (secondary && Math.abs(dx) < Math.abs(dy))) {
      if (!dx) return ACTION.NONE;
      desired = dx > 0 ? DIRECTION.RIGHT : DIRECTION.LEFT;
    } else {
      if (!dy) return ACTION.NONE;
      desired = dy > 0 ? DIRECTION.DOWN : DIRECTION.UP;
    }
    const facing = a[ARRAY.TANK_DIR][0];
    if (facing === desired) return ACTION.GO;
    return ((desired - facing + 4) & 3) === 3 ?
      ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
  }

  firingDirection(state) {
    const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    if (own >= state.cells || enemy >= state.cells) return -1;
    const ox = state.x(own); const oy = state.y(own);
    const ex = state.x(enemy); const ey = state.y(enemy);
    let direction = -1; let step = 0;
    if (ox === ex) {
      direction = ey < oy ? DIRECTION.UP : DIRECTION.DOWN;
      step = ey < oy ? -state.width : state.width;
    } else if (oy === ey) {
      direction = ex < ox ? DIRECTION.LEFT : DIRECTION.RIGHT;
      step = ex < ox ? -1 : 1;
    } else return -1;
    const terrain = a[ARRAY.TERRAIN];
    for (let cell = own + step; cell !== enemy; cell += step)
      if (terrain[cell] === TERRAIN.WALL || terrain[cell] === TERRAIN.DIRT)
        return -1;
    return direction;
  }

  forwardBlocked(state) {
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][0];
    if (own >= state.cells) return 1;
    const direction = a[ARRAY.TANK_DIR][0];
    const x = state.x(own) + (direction === DIRECTION.RIGHT ? 1 :
      direction === DIRECTION.LEFT ? -1 : 0);
    const y = state.y(own) + (direction === DIRECTION.DOWN ? 1 :
      direction === DIRECTION.UP ? -1 : 0);
    if (x < 0 || x >= state.width || y < 0 || y >= state.height) return 1;
    const cell = state.cell(x, y); const tile = a[ARRAY.TERRAIN][cell];
    return tile === TERRAIN.WALL || tile === TERRAIN.DIRT ||
      cell === a[ARRAY.TANK_CELL][1] ? 1 : 0;
  }

  policyAction(state) {
    const fireDirection = this.firingDirection(state);
    const facing = state.arrays[ARRAY.TANK_DIR][0];
    if (fireDirection >= 0) {
      if (facing === fireDirection) return ACTION.FIRE;
      return ((fireDirection - facing + 4) & 3) === 3 ?
        ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
    }
    const primary = this.pursuitAction(state, 0);
    if (primary !== ACTION.GO || !this.forwardBlocked(state)) return primary;
    const secondary = this.pursuitAction(state, 1);
    return secondary === ACTION.NONE ? ACTION.TURN_RIGHT : secondary;
  }

  generate(top, state, seat) {
    const supported = super.generate(top, state, seat);
    if (!supported || seat) return supported;
    const fullCount = this.ourCount[top];
    const base = top * SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    const wanted = this.policyAction(state);
    const selected = wanted === ACTION.NONE ? -1 :
      this.actionIndex(top, wanted, fullCount);
    const none = this.actionIndex(top, ACTION.NONE, fullCount);
    const selectedArgument = selected < 0 ? NONE_CELL :
      this.ourArguments[base + selected];
    const noneArgument = none < 0 ? NONE_CELL : this.ourArguments[base + none];
    let count = 0;
    count = this.appendOwnRepresentative(top,
      selected < 0 ? -1 : wanted, selectedArgument, count);
    if (!count) count = this.appendOwnRepresentative(top,
      none < 0 ? -1 : ACTION.NONE, noneArgument, count);
    this.ourCount[top] = count;
    if (count < fullCount) this.ownDomainRestrictedCount += 1;
    if (count > this.maximumOwnDomain) this.maximumOwnDomain = count;
    // Clear the first unused slot so stale actions cannot masquerade as part
    // of the compact domain in diagnostics.
    if (count < SEARCH_CAPACITY.MAX_OUR_ACTIONS) {
      this.ourActions[base + count] = ACTION.NONE;
      this.ourArguments[base + count] = NONE_CELL;
    }
    return supported;
  }

  projectileCount(state, seat) {
    const active = state.arrays[ARRAY.PROJECTILE_ACTIVE]; let count = 0;
    const owner = state.arrays[ARRAY.PROJECTILE_OWNER];
    for (let slot = 0; slot < active.length; slot += 1)
      if (active[slot] && owner[slot] === seat) count += 1;
    return count;
  }

  terminalEvent(terminal) {
    return terminal === TERMINAL.WIN0 ? PROOF_STATUS.PROVEN :
      PROOF_STATUS.DISPROVEN;
  }

  proveOutcome(bundle, depth, top, action0, argument0, action1, argument1,
      chance0, chance1) {
    if (this.nodes >= this.nodeBudget) {
      this.budgetStopCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const beforeProjectile = this.projectileCount(bundle.state, 0);
    const status = bundle.kernel.applyFrame(action0, argument0,
      action1, argument1, chance0, chance1);
    this.nodes += 1;
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
      this.incompleteCount += 1; this.fastIncompleteCount += 1;
      this.supportLossCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const mark = bundle.kernel.lastMark;
    const hard = bundle.hard.classifyApplied();
    const terminal = bundle.state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    let result;
    if (hard === HARD_STATUS.INCOMPLETE) {
      this.incompleteCount += 1; this.hardIncompleteCount += 1;
      this.supportLossCount += 1; result = PROOF_STATUS.UNKNOWN;
    } else if (hard !== HARD_STATUS.ALLOW ||
        bundle.state.arrays[ARRAY.TANK_CRASH][0]) {
      result = PROOF_STATUS.DISPROVEN;
    } else if (terminal) result = this.terminalEvent(terminal);
    else if (action0 === ACTION.FIRE &&
        this.projectileCount(bundle.state, 0) > beforeProjectile) {
      this.fireEventCount += 1;
      const incoming = this.settlement.classifyThreat(bundle.state, 1);
      const outgoing = this.settlement.classifyThreat(bundle.state, 0);
      if (incoming === SETTLEMENT.DOOMED) this.counterUnsafeCount += 1;
      if (outgoing === SETTLEMENT.SURVIVES || outgoing === SETTLEMENT.DOOMED)
        this.threatFireCount += 1;
      if (outgoing === SETTLEMENT.DOOMED) this.doomedFireCount += 1;
      result = fireEventStatus(this.goal, outgoing, incoming);
    } else if (depth <= 1) {
      this.horizonStopCount += 1; result = PROOF_STATUS.UNKNOWN;
    } else result = this.proveState(bundle, depth - 1, top + 1);
    bundle.state.undoTo(mark); return result;
  }

  evaluateRoot(bundle, rootAction, rootArgument, enemyActions,
      enemyArguments, enemyCount, maximumDepth = 4,
      nodeBudget = this.defaultNodeBudget) {
    this.resetEvent(nodeBudget);
    if (!bundle || !enemyActions || !enemyArguments || enemyCount < 1 ||
        enemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES || maximumDepth < 1 ||
        maximumDepth > SEARCH_CAPACITY.MAX_DECISION_DEPTH || nodeBudget < 1) {
      this.supportLossCount += 1; return this.lastStatus;
    }
    this.ourCount[0] = 1; this.ourActions[0] = rootAction;
    this.ourArguments[0] = rootArgument; this.enemyCount[0] = enemyCount;
    for (let column = 0; column < enemyCount; column += 1) {
      this.enemyActions[column] = enemyActions[column];
      this.enemyArguments[column] = enemyArguments[column];
    }
    const state = bundle.state; const rootLo = state.hashLo;
    const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    this.lastStatus = this.proveRow(bundle, maximumDepth, 0, 0);
    if (this.lastStatus === PROOF_STATUS.DISPROVEN) {
      // The own action domain is intentionally a subset.  Failure to find a
      // witness is not a proof that no full-domain witness exists.
      this.restrictedDisproofToUnknownCount += 1;
      this.lastStatus = PROOF_STATUS.UNKNOWN;
    }
    if (this.lastStatus !== PROOF_STATUS.UNKNOWN)
      this.completedDepth = maximumDepth;
    state.undoTo(rootMark);
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== rootMark) {
      this.rootRestoreFailures += 1; this.supportLossCount += 1;
      this.lastStatus = PROOF_STATUS.UNKNOWN; this.completedDepth = 0;
    }
    this.lastSupportComplete = this.supportLossCount === 0 &&
      this.budgetStopCount === 0 && this.rootRestoreFailures === 0 &&
      this.ttCapacityStops === 0 && this.unsupportedGenerationStops === 0 ? 1 : 0;
    if (this.nodes > this.maximumNodes) this.maximumNodes = this.nodes;
    return this.lastStatus;
  }
}

class SemanticAttackEventHorizonShadow {
  constructor(options = {}) {
    this.maximumDepth = options.maximumDepth || 4;
    this.nodeBudget = options.nodeBudget || 4096;
    this.searches = options.searches || new Array(SEARCH_CELLS);
    if (!options.searches)
      for (let goal = 0; goal < EVENT_GOAL.COUNT; goal += 1)
        for (let variant = 0; variant < VARIANT_COUNT; variant += 1)
          this.searches[goal * VARIANT_COUNT + variant] =
            new SafeFireEventHorizonSearch(goal, this.nodeBudget);
    this.state = null; this.kernels = new Array(VARIANT_COUNT).fill(null);
    this.hazards = new Array(VARIANT_COUNT).fill(null);
    this.hards = new Array(VARIANT_COUNT).fill(null);
    this.lastAttempted = 0; this.lastStatus = new Uint8Array(RESULT_CELLS);
    this.lastSupport = new Uint8Array(RESULT_CELLS);
    this.lastNodes = new Uint16Array(RESULT_CELLS);
    this.lastRelation = new Uint8Array(SEARCH_CELLS);
    this.lastCommonStatus = new Uint8Array(EVENT_GOAL.COUNT);
    this.lastCommonRelation = new Uint8Array(EVENT_GOAL.COUNT);
    this.recordAttempted = new Uint8Array(ROOT_CAPACITY);
    this.recordStatus = new Uint8Array(ROOT_CAPACITY * RESULT_CELLS);
    this.recordSupport = new Uint8Array(ROOT_CAPACITY * RESULT_CELLS);
    this.recordNodes = new Uint16Array(ROOT_CAPACITY * RESULT_CELLS);
    this.recordRelation = new Uint8Array(ROOT_CAPACITY * SEARCH_CELLS);
    this.recordCommonStatus = new Uint8Array(
      ROOT_CAPACITY * EVENT_GOAL.COUNT);
    this.recordCommonRelation = new Uint8Array(
      ROOT_CAPACITY * EVENT_GOAL.COUNT);
    this.attemptCount = 0; this.supportCompleteCount = 0;
    this.supportIncompleteCount = 0; this.rootRestoreFailureCount = 0;
    this.totalNodes = 0; this.hotAllocationCount = 0;
    this.ownDomainRestrictedCount = 0; this.maximumOwnDomain = 0;
    this.restrictedDisproofToUnknownCount = 0;
  }

  bind(bundle) {
    if (this.state === bundle.state) return;
    this.state = bundle.state;
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
      const kernel = new MoveContestVariantKernel(this.state,
        MOVE_VARIANTS[variant]);
      const hazard = new HazardKernel(this.state);
      this.kernels[variant] = kernel; this.hazards[variant] = hazard;
      this.hards[variant] = new HardGate(kernel, hazard, 0);
    }
  }

  clearLast() {
    this.lastAttempted = 0; this.lastStatus.fill(PROOF_STATUS.UNKNOWN);
    this.lastSupport.fill(0); this.lastNodes.fill(0);
    this.lastRelation.fill(0);
    this.lastCommonStatus.fill(VARIANT_COMMON_STATUS.NOT_EVALUATED);
    this.lastCommonRelation.fill(0);
  }

  evaluate(engine, current, candidate, widthShadow, eventDeadline) {
    this.clearLast();
    if (!isJointMovementGap(widthShadow) || !eventDeadline?.lastAttempted)
      return;
    const bundle = engine.adapter.bundle; if (!bundle?.state) return;
    this.bind(bundle); this.lastAttempted = 1; this.attemptCount += 1;
    const originalKernel = bundle.kernel; const originalHazard = bundle.hazard;
    const originalHard = bundle.hard; const beforeLo = bundle.state.hashLo;
    const beforeHi = bundle.state.hashHi; const beforeDelta = bundle.state.deltaUsed;
    const beforeEvent = bundle.state.eventUsed;
    try {
      for (let goal = 0; goal < EVENT_GOAL.COUNT; goal += 1) {
        for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
          bundle.kernel = this.kernels[variant];
          bundle.hazard = this.hazards[variant]; bundle.hard = this.hards[variant];
          const search = this.searches[goal * VARIANT_COUNT + variant];
          for (let side = 0; side < SIDE.COUNT; side += 1) {
            const row = side === SIDE.BASELINE ? current : candidate;
            const result = search.evaluateRoot(bundle, engine.ourActions[row],
              engine.ourArguments[row], engine.enemyActions,
              engine.enemyArguments, engine.enemyCount,
              this.maximumDepth, this.nodeBudget);
            const cell = (goal * VARIANT_COUNT + variant) * SIDE.COUNT + side;
            this.lastStatus[cell] = result;
            this.lastSupport[cell] = search.lastSupportComplete;
            this.lastNodes[cell] = Math.min(65535, search.nodes);
            this.totalNodes += search.nodes;
            this.ownDomainRestrictedCount +=
              search.ownDomainRestrictedCount;
            this.restrictedDisproofToUnknownCount +=
              search.restrictedDisproofToUnknownCount;
            if (search.maximumOwnDomain > this.maximumOwnDomain)
              this.maximumOwnDomain = search.maximumOwnDomain;
            this.rootRestoreFailureCount += search.rootRestoreFailures;
            if (search.lastSupportComplete) this.supportCompleteCount += 1;
            else this.supportIncompleteCount += 1;
          }
          const resultCell = (goal * VARIANT_COUNT + variant) * SIDE.COUNT;
          const relationCell = goal * VARIANT_COUNT + variant;
          this.lastRelation[relationCell] = pairRelation(
            this.lastStatus[resultCell + SIDE.BASELINE],
            this.lastStatus[resultCell + SIDE.CANDIDATE]);
          if (bundle.state.hashLo !== beforeLo ||
              bundle.state.hashHi !== beforeHi ||
              bundle.state.deltaUsed !== beforeDelta ||
              bundle.state.eventUsed !== beforeEvent)
            this.rootRestoreFailureCount += 1;
        }
        const start = goal * VARIANT_COUNT;
        let status = VARIANT_COMMON_STATUS.AGREEMENT;
        for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
          const result = (goal * VARIANT_COUNT + variant) * SIDE.COUNT;
          if (!this.lastSupport[result] || !this.lastSupport[result + 1]) {
            status = VARIANT_COMMON_STATUS.INCOMPLETE; break;
          }
          if (variant && this.lastRelation[start + variant] !==
              this.lastRelation[start]) {
            status = VARIANT_COMMON_STATUS.DISAGREEMENT; break;
          }
        }
        this.lastCommonStatus[goal] = status;
        if (status === VARIANT_COMMON_STATUS.AGREEMENT)
          this.lastCommonRelation[goal] = this.lastRelation[start];
      }
    } finally {
      bundle.kernel = originalKernel; bundle.hazard = originalHazard;
      bundle.hard = originalHard;
    }
  }

  record(at) {
    if (at < 0 || at >= ROOT_CAPACITY) return;
    this.recordAttempted[at] = this.lastAttempted;
    this.recordStatus.set(this.lastStatus, at * RESULT_CELLS);
    this.recordSupport.set(this.lastSupport, at * RESULT_CELLS);
    this.recordNodes.set(this.lastNodes, at * RESULT_CELLS);
    this.recordRelation.set(this.lastRelation, at * SEARCH_CELLS);
    this.recordCommonStatus.set(this.lastCommonStatus,
      at * EVENT_GOAL.COUNT);
    this.recordCommonRelation.set(this.lastCommonRelation,
      at * EVENT_GOAL.COUNT);
  }

  root(at) {
    if (at < 0 || at >= ROOT_CAPACITY || !this.recordAttempted[at]) return null;
    const goals = [];
    for (let goal = 0; goal < EVENT_GOAL.COUNT; goal += 1) {
      const variants = [];
      for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
        const relationCell = at * SEARCH_CELLS +
          goal * VARIANT_COUNT + variant;
        const resultCell = at * RESULT_CELLS +
          (goal * VARIANT_COUNT + variant) * SIDE.COUNT;
        variants.push({ name: MOVE_VARIANT_NAME[variant],
          relation: this.recordRelation[relationCell],
          baselineStatus: this.recordStatus[resultCell + SIDE.BASELINE],
          candidateStatus: this.recordStatus[resultCell + SIDE.CANDIDATE],
          baselineSupport: Boolean(
            this.recordSupport[resultCell + SIDE.BASELINE]),
          candidateSupport: Boolean(
            this.recordSupport[resultCell + SIDE.CANDIDATE]),
          baselineNodes: this.recordNodes[resultCell + SIDE.BASELINE],
          candidateNodes: this.recordNodes[resultCell + SIDE.CANDIDATE] });
      }
      goals.push({ name: EVENT_GOAL_NAME[goal],
        commonStatus: this.recordCommonStatus[
          at * EVENT_GOAL.COUNT + goal],
        commonRelation: this.recordCommonRelation[
          at * EVENT_GOAL.COUNT + goal], variants });
    }
    return { diagnosticOnly: true, actionOwnership: false,
      quantifier:
        "FIXED_REPLANNING_ATTACK_POLICY_AND_ALL_ENEMY_AND_ALL_CHANCE",
      positiveCertificateSound: true, negativeSubsetResult: "UNKNOWN",
      nonEventAtCap: "UNKNOWN", maximumDepth: this.maximumDepth, goals };
  }

  totalHotAllocationCount() {
    let total = this.hotAllocationCount;
    for (let at = 0; at < this.searches.length; at += 1)
      total += (this.searches[at]?.hotAllocationCount || 0) +
        (this.searches[at]?.settlement?.hotAllocationCount || 0);
    return total;
  }

  summary() {
    return { diagnosticOnly: true, actionOwnership: false,
      quantifier:
        "FIXED_REPLANNING_ATTACK_POLICY_AND_ALL_ENEMY_AND_ALL_CHANCE",
      positiveCertificateSound: true, negativeSubsetResult: "UNKNOWN",
      nonEventAtCap: "UNKNOWN", maximumDepth: this.maximumDepth,
      nodeBudget: this.nodeBudget, attemptCount: this.attemptCount,
      supportCompleteCount: this.supportCompleteCount,
      supportIncompleteCount: this.supportIncompleteCount,
      rootRestoreFailureCount: this.rootRestoreFailureCount,
      totalNodes: this.totalNodes,
      ownDomainRestrictedCount: this.ownDomainRestrictedCount,
      maximumOwnDomain: this.maximumOwnDomain,
      restrictedDisproofToUnknownCount:
        this.restrictedDisproofToUnknownCount,
      hotAllocationCount: this.totalHotAllocationCount() };
  }
}

module.exports = { EVENT_GOAL, EVENT_GOAL_NAME, SIDE, fireEventStatus,
  pairRelation, SafeFireEventHorizonSearch,
  SemanticAttackEventHorizonShadow };
