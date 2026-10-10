"use strict";

// Behavior-neutral causal probe for the two deficits exposed by the shot
// census.  It never mutates the production decision.  A selected FIRE is
// checked by a finite survival AND/OR closure, while zero-signal FIRE roots
// also scan already-generated GO/TURN rows for a safer next-frame direct ray.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, FAST_STATUS, HARD_STATUS, TERMINAL, TERRAIN, NONE_CELL,
  NONE_FRAME, DX, DY } = require("../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { ProductionForcedWinSearch } = require(
  "../../../engine-v2/src/search/production-forced-win-search");

const POST_FIRE_STATUS = Object.freeze({
  SKIPPED: 0, PROVEN_SAFE: 1, PROVEN_DEAD: 2, UNKNOWN: 3
});

const AIM_SETUP_STATUS = Object.freeze({
  SKIPPED: 0, NO_IMPROVEMENT: 1, PROPOSED: 2, UNKNOWN: 3
});

const AIM_ACTIVE_MODE = Object.freeze({
  OFF: 0, RESCUE_ONLY: 1, ALL: 2, LONG_RANGE_QUALITY: 3,
  LONG_RANGE_QUALITY_FAST: 4
});

const ACTIVE_FIELD = Object.freeze({
  FRAME: 0, SELECTED_ROW: 1, AIM_ROW: 2, AIM_ACTION: 3, RESCUE: 4,
  POST_FIRE_STATUS: 5, CONTINUATION_MASK: 6, DIRECT_BRANCHES: 7,
  ALIGNED_BRANCHES: 8, TOTAL_BRANCHES: 9,
  SELECTED_IMMEDIATE: 10, AIM_IMMEDIATE: 11,
  SELECTED_HORIZON: 12, AIM_HORIZON: 13,
  SELECTED_UNKNOWN: 14, AIM_UNKNOWN: 15,
  SELECTED_SLACK: 16, AIM_SLACK: 17,
  SELECTED_ROBUST: 18, AIM_ROBUST: 19,
  SELECTED_EXPECTED: 20, AIM_EXPECTED: 21,
  OWN_CELL: 22, ENEMY_CELL: 23, AIM_CELL: 24, AIM_DIRECTION: 25,
  CURRENT_DISTANCE: 26, AIM_MAXIMUM_DISTANCE: 27, STRIDE: 28
});

function movement(action) {
  return action === ACTION.GO || action === ACTION.TURN_LEFT ||
    action === ACTION.TURN_RIGHT ? 1 : 0;
}

function statusCode(proof) {
  return proof === PROOF_STATUS.PROVEN ? POST_FIRE_STATUS.PROVEN_SAFE :
    proof === PROOF_STATUS.DISPROVEN ? POST_FIRE_STATUS.PROVEN_DEAD :
      POST_FIRE_STATUS.UNKNOWN;
}

function actionMask(action) {
  if (action === ACTION.GO) return 1 << 0;
  if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) return 1 << 1;
  if (action === ACTION.FIRE) return 1 << 2;
  if (action === ACTION.THROW_BOMB) return 1 << 3;
  if (action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST) return 1 << 4;
  return 1 << 5;
}

class HorizonSurvivalSearch extends ProductionForcedWinSearch {
  constructor() {
    super(null);
    this.continuationMask = 0;
  }

  resetRoot() {
    super.resetRoot(); this.continuationMask = 0;
  }

  proveOutcome(bundle, depth, top, action0, argument0, action1, argument1,
      chance0, chance1) {
    if (this.nodes >= this.nodeBudget) {
      this.budgetStopCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const status = bundle.kernel.applyFrame(action0, argument0, action1, argument1,
      chance0, chance1);
    this.nodes += 1;
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
      this.incompleteCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const mark = bundle.kernel.lastMark; const state = bundle.state;
    const hard = bundle.hard.classifyApplied();
    const terminal = state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    const crashed = state.arrays[ARRAY.TANK_CRASH][0];
    let result;
    if (hard === HARD_STATUS.INCOMPLETE) result = PROOF_STATUS.UNKNOWN;
    else if (crashed || hard === HARD_STATUS.REJECT_PROVEN ||
        terminal === TERMINAL.WIN1) result = PROOF_STATUS.DISPROVEN;
    else if (terminal || depth <= 1) result = PROOF_STATUS.PROVEN;
    else result = this.proveState(bundle, depth - 1, top + 1);
    state.undoTo(mark); return result;
  }

  proveState(bundle, depth, top) {
    if (top > SEARCH_CAPACITY.MAX_DECISION_DEPTH ||
        !this.generate(top, bundle.state, 0) || !this.generate(top, bundle.state, 1)) {
      this.incompleteCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    let unknown = 0;
    for (let row = 0; row < this.ourCount[top]; row += 1) {
      const result = this.proveRow(bundle, depth, top, row);
      if (result === PROOF_STATUS.PROVEN) {
        if (top === 1) this.continuationMask |= actionMask(this.actionAt(top, 0, row));
        return result;
      }
      if (result === PROOF_STATUS.UNKNOWN) unknown = 1;
    }
    return unknown ? PROOF_STATUS.UNKNOWN : PROOF_STATUS.DISPROVEN;
  }

  searchExact(bundle, rootAction, rootArgument, enemyActions, enemyArguments,
      enemyCount, depth, nodeBudget) {
    this.resetRoot();
    if (!bundle || !enemyActions || !enemyArguments || enemyCount < 1 ||
        enemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES || depth < 1 ||
        depth > SEARCH_CAPACITY.MAX_DECISION_DEPTH || nodeBudget < 1)
      return this.lastStatus;
    this.nodeBudget = nodeBudget; this.ourCount[0] = 1; this.enemyCount[0] = enemyCount;
    this.ourActions[0] = rootAction; this.ourArguments[0] = rootArgument;
    for (let column = 0; column < enemyCount; column += 1) {
      this.enemyActions[column] = enemyActions[column];
      this.enemyArguments[column] = enemyArguments[column];
    }
    const state = bundle.state; const lo = state.hashLo; const hi = state.hashHi;
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    this.lastStatus = this.proveRow(bundle, depth, 0, 0);
    state.undoTo(mark);
    if (state.hashLo !== lo || state.hashHi !== hi ||
        state.deltaUsed * 1024 + state.eventUsed !== mark) {
      this.rootRestoreFailures += 1; this.lastStatus = PROOF_STATUS.UNKNOWN;
    }
    if (this.lastStatus !== PROOF_STATUS.UNKNOWN) this.completedDepth = depth;
    return this.lastStatus;
  }
}

class AimSetupPostFireClosureShadow {
  constructor(options = {}) {
    this.postFireDepth = Number.isSafeInteger(options.postFireDepth) ?
      Math.max(2, Math.min(4, options.postFireDepth)) : 4;
    this.postFireBudget = Number.isSafeInteger(options.postFireBudget) ?
      Math.max(64, options.postFireBudget) : 4096;
    this.setupSafetyDepth = Number.isSafeInteger(options.setupSafetyDepth) ?
      Math.max(1, Math.min(3, options.setupSafetyDepth)) : 2;
    this.setupSafetyBudget = Number.isSafeInteger(options.setupSafetyBudget) ?
      Math.max(32, options.setupSafetyBudget) : 768;
    this.postFireSearch = new HorizonSurvivalSearch();
    this.setupSearch = new HorizonSurvivalSearch();
    this.rowDirect = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowAligned = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowBranches = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowMaximumDistance = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowComplete = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.activeWords = new Int32Array(32 * ACTIVE_FIELD.STRIDE);
    this.activeRecordCount = 0; this.activeRecordOverflowCount = 0;
    this.resetLast();
    this.observationCount = 0; this.fireRootCount = 0; this.supportSkipCount = 0;
    this.zeroSignalFireCount = 0; this.postFireEvaluationCount = 0;
    this.postFireSafeCount = 0; this.postFireDeadCount = 0;
    this.postFireUnknownCount = 0; this.aimCandidateCount = 0;
    this.aimMovementRowCount = 0; this.aimHardBlockedCount = 0;
    this.aimRiskBlockedCount = 0; this.aimDominatedSeenCount = 0;
    this.aimRiskWorseCount = 0; this.aimRawRayImprovementRootCount = 0;
    this.aimCompleteCandidateCount = 0; this.aimIncompleteCandidateCount = 0;
    this.aimRayImprovementRootCount = 0; this.aimProposalCount = 0;
    this.aimUnsafeCount = 0; this.aimUnknownCount = 0;
    this.aimRescueProposalCount = 0; this.aimQualityProposalCount = 0;
    this.aimProposalDespiteStaticRiskCount = 0;
    this.fastQualityTriggerCount = 0; this.fastQualityDistanceSkipCount = 0;
    this.activeOverrideCount = 0; this.activeRescueOverrideCount = 0;
    this.activeQualityOverrideCount = 0;
    this.postFireNodeCount = 0; this.setupNodeCount = 0;
    this.rootRestoreFailures = 0; this.hotAllocationCount = 0;
  }

  resetLast() {
    this.lastFrame = -1; this.lastPostFireStatus = POST_FIRE_STATUS.SKIPPED;
    this.lastPostFireNodes = 0; this.lastPostFireDepth = 0;
    this.lastContinuationMask = 0; this.lastAimStatus = AIM_SETUP_STATUS.SKIPPED;
    this.lastAimRow = -1; this.lastAimAction = ACTION.NONE;
    this.lastAimDirectBranches = 0; this.lastAimAlignedBranches = 0;
    this.lastAimTotalBranches = 0; this.lastAimSafetyStatus = POST_FIRE_STATUS.SKIPPED;
    this.lastAimNodes = 0; this.lastAimRescue = 0;
    this.lastAimStaticRiskNoWorse = 0;
  }

  supportComplete(engine) {
    return engine && engine.adapter && engine.adapter.bundle &&
      engine.adapter.enemyVisible && engine.adapter.tracker &&
      engine.adapter.tracker.complete && engine.hiddenSupportComplete === 1 &&
      engine.hiddenWorldCount === 1 && engine.hiddenWorldMass[0] === 10000 &&
      engine.enemyCount > 0 &&
      engine.enemyCount <= SEARCH_CAPACITY.MAX_ENEMY_POLICIES &&
      (!engine.possibleProjectiles || engine.possibleProjectiles.count() === 0);
  }

  zeroSignal(engine, row) {
    const combat = engine.combat && engine.combat.vector;
    return combat && !combat.directKill[row] && !combat.possibleHit[row] &&
      !combat.intercept[row] && !combat.aimSetup[row] &&
      !combat.enemyDoomedFirstActions[row] ? 1 : 0;
  }

  riskNoWorse(outcome, row, selected) {
    return outcome.immediateFatalMass[row] <= outcome.immediateFatalMass[selected] &&
      outcome.horizonFatalMass[row] <= outcome.horizonFatalMass[selected] &&
      outcome.unknownMass[row] <= outcome.unknownMass[selected] &&
      outcome.escapeSlack[row] >= outcome.escapeSlack[selected];
  }

  active(a, id, seat, frame) {
    return a[id][seat] !== NONE_FRAME && a[id][seat] > frame;
  }

  canFire(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.active(a, ARRAY.TANK_FROZEN_UNTIL, 0, frame)) return 0;
    if (this.active(a, ARRAY.TANK_POISON_UNTIL, 0, frame)) {
      const applied = a[ARRAY.TANK_POISON_APPLIED][0];
      if (applied === NONE_FRAME || ((frame - applied) & 1) !== 0) return 0;
    }
    for (let slot = 0; slot < a[ARRAY.PROJECTILE_ACTIVE].length; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] && a[ARRAY.PROJECTILE_OWNER][slot] === 0)
        return 0;
    return a[ARRAY.TANK_FIRE_LOCK][0] === NONE_FRAME ||
      a[ARRAY.TANK_FIRE_LOCK][0] <= frame ? 1 : 0;
  }

  directionTo(state, from, to) {
    const fx = state.x(from); const fy = state.y(from);
    const tx = state.x(to); const ty = state.y(to);
    if (fx === tx) return ty < fy ? 0 : ty > fy ? 2 : -1;
    if (fy === ty) return tx > fx ? 1 : 3;
    return -1;
  }

  clearLine(state, from, to, direction) {
    let x = state.x(from) + DX[direction]; let y = state.y(from) + DY[direction];
    const terrain = state.arrays[ARRAY.TERRAIN];
    while (x >= 0 && x < state.width && y >= 0 && y < state.height) {
      const cell = state.cell(x, y);
      if (cell === to) return 1;
      const tile = terrain[cell];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
      x += DX[direction]; y += DY[direction];
    }
    return 0;
  }

  evaluateSetupRow(engine, row) {
    const bundle = engine.adapter.bundle; const state = bundle.state;
    const lo = state.hashLo; const hi = state.hashHi;
    const root = state.deltaUsed * 1024 + state.eventUsed;
    let direct = 0; let aligned = 0; let branches = 0; let maximumDistance = 0;
    let complete = 1;
    for (let column = 0; column < engine.enemyCount && complete; column += 1) {
      const enemyAction = engine.enemyActions[column];
      const ownChance = bundle.hard.chanceAlternativeCount(0, engine.ourActions[row]);
      const enemyChance = bundle.hard.chanceAlternativeCount(1, enemyAction);
      for (let chance = 0; chance < ownChance * enemyChance; chance += 1) {
        const status = bundle.kernel.applyFrame(engine.ourActions[row],
          engine.ourArguments[row], enemyAction, engine.enemyArguments[column],
          chance % ownChance, Math.floor(chance / ownChance));
        if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
          complete = 0; break;
        }
        const mark = bundle.kernel.lastMark; const hard = bundle.hard.classifyApplied();
        if (hard === HARD_STATUS.INCOMPLETE) complete = 0;
        else if (hard === HARD_STATUS.ALLOW &&
            state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE] === TERMINAL.NONE &&
            !state.arrays[ARRAY.TANK_CRASH][0]) {
          branches += 1;
          const own = state.arrays[ARRAY.TANK_CELL][0];
          const enemy = state.arrays[ARRAY.TANK_CELL][1];
          const wanted = this.directionTo(state, own, enemy);
          const distance = Math.abs(state.x(own) - state.x(enemy)) +
            Math.abs(state.y(own) - state.y(enemy));
          if (distance > maximumDistance) maximumDistance = distance;
          if (wanted >= 0 && this.clearLine(state, own, enemy, wanted)) {
            aligned += 1;
            if (state.arrays[ARRAY.TANK_DIR][0] === wanted && this.canFire(state)) direct += 1;
          }
        }
        state.undoTo(mark);
        if (!complete) break;
      }
    }
    state.undoTo(root);
    if (state.hashLo !== lo || state.hashHi !== hi ||
        state.deltaUsed * 1024 + state.eventUsed !== root) {
      this.rootRestoreFailures += 1; complete = 0;
    }
    this.rowDirect[row] = direct; this.rowAligned[row] = aligned;
    this.rowBranches[row] = branches; this.rowMaximumDistance[row] = maximumDistance;
    this.rowComplete[row] = complete; return complete;
  }

  betterSetup(left, right) {
    if (right < 0) return 1;
    if (this.rowDirect[left] !== this.rowDirect[right])
      return this.rowDirect[left] > this.rowDirect[right] ? 1 : 0;
    if (this.rowAligned[left] !== this.rowAligned[right])
      return this.rowAligned[left] > this.rowAligned[right] ? 1 : 0;
    if (this.rowMaximumDistance[left] !== this.rowMaximumDistance[right])
      return this.rowMaximumDistance[left] < this.rowMaximumDistance[right] ? 1 : 0;
    return left < right ? 1 : 0;
  }

  evaluateAim(engine, selected) {
    const outcome = engine.riskController && engine.riskController.outcome;
    if (!outcome || selected >= outcome.count) {
      this.lastAimStatus = AIM_SETUP_STATUS.UNKNOWN; this.aimUnknownCount += 1; return;
    }
    this.rowComplete.fill(0, 0, engine.ourCount);
    let rawBest = -1; let sawIncomplete = 0;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (!movement(engine.ourActions[row])) continue;
      this.aimMovementRowCount += 1;
      if (engine.hardStatus[row] !== HARD_STATUS.ALLOW) {
        this.aimHardBlockedCount += 1; continue;
      }
      if (!outcome.acceptable[row]) { this.aimRiskBlockedCount += 1; continue; }
      if (outcome.dominated[row]) this.aimDominatedSeenCount += 1;
      this.aimCandidateCount += 1;
      if (!this.evaluateSetupRow(engine, row)) {
        this.aimIncompleteCandidateCount += 1; sawIncomplete = 1; continue;
      }
      this.aimCompleteCandidateCount += 1;
      if (this.rowDirect[row] > 0 && this.betterSetup(row, rawBest)) rawBest = row;
      if (!this.riskNoWorse(outcome, row, selected)) this.aimRiskWorseCount += 1;
    }
    if (rawBest >= 0) this.aimRawRayImprovementRootCount += 1;
    if (rawBest < 0) {
      this.lastAimStatus = sawIncomplete ? AIM_SETUP_STATUS.UNKNOWN :
        AIM_SETUP_STATUS.NO_IMPROVEMENT;
      if (sawIncomplete) this.aimUnknownCount += 1;
      return;
    }
    const best = rawBest;
    this.aimRayImprovementRootCount += 1; this.lastAimRow = best;
    this.lastAimAction = engine.ourActions[best];
    this.lastAimDirectBranches = this.rowDirect[best];
    this.lastAimAlignedBranches = this.rowAligned[best];
    this.lastAimTotalBranches = this.rowBranches[best];
    this.lastAimStaticRiskNoWorse = this.riskNoWorse(outcome, best, selected);
    const proof = this.setupSearch.searchExact(engine.adapter.bundle,
      engine.ourActions[best], engine.ourArguments[best], engine.enemyActions,
      engine.enemyArguments, engine.enemyCount, this.setupSafetyDepth,
      this.setupSafetyBudget);
    this.lastAimSafetyStatus = statusCode(proof);
    this.lastAimNodes = this.setupSearch.nodes; this.setupNodeCount += this.setupSearch.nodes;
    this.rootRestoreFailures += this.setupSearch.rootRestoreFailures;
    if (proof === PROOF_STATUS.PROVEN) {
      this.lastAimStatus = AIM_SETUP_STATUS.PROPOSED; this.aimProposalCount += 1;
      if (!this.lastAimStaticRiskNoWorse) this.aimProposalDespiteStaticRiskCount += 1;
      if (this.lastPostFireStatus === POST_FIRE_STATUS.PROVEN_DEAD) {
        this.lastAimRescue = 1; this.aimRescueProposalCount += 1;
      } else this.aimQualityProposalCount += 1;
    } else if (proof === PROOF_STATUS.UNKNOWN) {
      this.lastAimStatus = AIM_SETUP_STATUS.UNKNOWN; this.aimUnknownCount += 1;
    } else {
      this.lastAimStatus = AIM_SETUP_STATUS.NO_IMPROVEMENT; this.aimUnsafeCount += 1;
    }
  }

  observe(engine, selected, frame = -1) {
    this.observationCount += 1; this.resetLast(); this.lastFrame = frame;
    if (!engine || selected < 0 || selected >= engine.ourCount ||
        engine.ourActions[selected] !== ACTION.FIRE) return;
    this.fireRootCount += 1;
    if (!this.supportComplete(engine)) {
      this.supportSkipCount += 1; this.lastPostFireStatus = POST_FIRE_STATUS.UNKNOWN;
      this.lastAimStatus = AIM_SETUP_STATUS.UNKNOWN; return;
    }
    this.postFireEvaluationCount += 1;
    const proof = this.postFireSearch.searchExact(engine.adapter.bundle,
      engine.ourActions[selected], engine.ourArguments[selected], engine.enemyActions,
      engine.enemyArguments, engine.enemyCount, this.postFireDepth, this.postFireBudget);
    this.lastPostFireStatus = statusCode(proof);
    this.lastPostFireNodes = this.postFireSearch.nodes;
    this.lastPostFireDepth = this.postFireSearch.completedDepth;
    this.lastContinuationMask = this.postFireSearch.continuationMask;
    this.postFireNodeCount += this.postFireSearch.nodes;
    this.rootRestoreFailures += this.postFireSearch.rootRestoreFailures;
    if (proof === PROOF_STATUS.PROVEN) this.postFireSafeCount += 1;
    else if (proof === PROOF_STATUS.DISPROVEN) this.postFireDeadCount += 1;
    else this.postFireUnknownCount += 1;
    if (this.zeroSignal(engine, selected)) {
      this.zeroSignalFireCount += 1; this.evaluateAim(engine, selected);
    }
  }

  selectOverride(engine, selected, action, argument, mode, frame = -1) {
    if (action !== ACTION.FIRE) return null;
    if (mode === AIM_ACTIVE_MODE.LONG_RANGE_QUALITY_FAST) {
      this.observationCount += 1; this.resetLast(); this.lastFrame = frame;
      if (!engine || selected < 0 || selected >= engine.ourCount ||
          engine.ourActions[selected] !== ACTION.FIRE) return null;
      this.fireRootCount += 1;
      if (!this.supportComplete(engine)) {
        this.supportSkipCount += 1; this.lastAimStatus = AIM_SETUP_STATUS.UNKNOWN;
        return null;
      }
      if (!this.zeroSignal(engine, selected)) return null;
      this.zeroSignalFireCount += 1;
      const state = engine.adapter.state; const a = state.arrays;
      const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
      const distance = Math.abs(state.x(own) - state.x(enemy)) +
        Math.abs(state.y(own) - state.y(enemy));
      if (distance < 5) { this.fastQualityDistanceSkipCount += 1; return null; }
      this.fastQualityTriggerCount += 1; this.evaluateAim(engine, selected);
    } else this.observe(engine, selected, frame);
    if (mode === AIM_ACTIVE_MODE.OFF ||
        this.lastAimStatus !== AIM_SETUP_STATUS.PROPOSED || this.lastAimRow < 0 ||
        (mode === AIM_ACTIVE_MODE.RESCUE_ONLY && !this.lastAimRescue)) return null;
    if (mode === AIM_ACTIVE_MODE.LONG_RANGE_QUALITY && !this.lastAimRescue) {
      const state = engine.adapter.state; const a = state.arrays;
      const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
      const distance = Math.abs(state.x(own) - state.x(enemy)) +
        Math.abs(state.y(own) - state.y(enemy));
      if (distance < 5) return null;
    }
    this.activeOverrideCount += 1;
    if (this.lastAimRescue) this.activeRescueOverrideCount += 1;
    else this.activeQualityOverrideCount += 1;
    if (this.activeRecordCount < 32) {
      const at = this.activeRecordCount * ACTIVE_FIELD.STRIDE;
      const outcome = engine.riskController.outcome; const row = this.lastAimRow;
      const state = engine.adapter.state; const a = state.arrays;
      const values = [frame, selected, row, this.lastAimAction, this.lastAimRescue,
        this.lastPostFireStatus, this.lastContinuationMask,
        this.lastAimDirectBranches, this.lastAimAlignedBranches,
        this.lastAimTotalBranches,
        outcome.immediateFatalMass[selected], outcome.immediateFatalMass[row],
        outcome.horizonFatalMass[selected], outcome.horizonFatalMass[row],
        outcome.unknownMass[selected], outcome.unknownMass[row],
        outcome.escapeSlack[selected], outcome.escapeSlack[row],
        outcome.robustLower[selected], outcome.robustLower[row],
        outcome.expectedValue[selected], outcome.expectedValue[row],
        a[ARRAY.TANK_CELL][0], a[ARRAY.TANK_CELL][1], engine.projectedCell[row],
        engine.projectedDirection[row],
        Math.abs(state.x(a[ARRAY.TANK_CELL][0]) - state.x(a[ARRAY.TANK_CELL][1])) +
          Math.abs(state.y(a[ARRAY.TANK_CELL][0]) - state.y(a[ARRAY.TANK_CELL][1])),
        this.rowMaximumDistance[row]];
      for (let index = 0; index < ACTIVE_FIELD.STRIDE; index += 1)
        this.activeWords[at + index] = values[index];
      this.activeRecordCount += 1;
    } else this.activeRecordOverflowCount += 1;
    return { action: this.lastAimAction,
      argument: engine.ourArguments[this.lastAimRow] };
  }

  activeRecords() {
    const output = [];
    for (let record = 0; record < this.activeRecordCount; record += 1) {
      const at = record * ACTIVE_FIELD.STRIDE; const get = field => this.activeWords[at + field];
      output.push({ frame: get(ACTIVE_FIELD.FRAME),
        selectedRow: get(ACTIVE_FIELD.SELECTED_ROW), aimRow: get(ACTIVE_FIELD.AIM_ROW),
        aimAction: get(ACTIVE_FIELD.AIM_ACTION), rescue: get(ACTIVE_FIELD.RESCUE),
        postFireStatus: get(ACTIVE_FIELD.POST_FIRE_STATUS),
        continuationMask: get(ACTIVE_FIELD.CONTINUATION_MASK),
        directBranches: get(ACTIVE_FIELD.DIRECT_BRANCHES),
        alignedBranches: get(ACTIVE_FIELD.ALIGNED_BRANCHES),
        totalBranches: get(ACTIVE_FIELD.TOTAL_BRANCHES),
        selectedImmediate: get(ACTIVE_FIELD.SELECTED_IMMEDIATE),
        aimImmediate: get(ACTIVE_FIELD.AIM_IMMEDIATE),
        selectedHorizon: get(ACTIVE_FIELD.SELECTED_HORIZON),
        aimHorizon: get(ACTIVE_FIELD.AIM_HORIZON),
        selectedUnknown: get(ACTIVE_FIELD.SELECTED_UNKNOWN),
        aimUnknown: get(ACTIVE_FIELD.AIM_UNKNOWN),
        selectedSlack: get(ACTIVE_FIELD.SELECTED_SLACK),
        aimSlack: get(ACTIVE_FIELD.AIM_SLACK),
        selectedRobust: get(ACTIVE_FIELD.SELECTED_ROBUST),
        aimRobust: get(ACTIVE_FIELD.AIM_ROBUST),
        selectedExpected: get(ACTIVE_FIELD.SELECTED_EXPECTED),
        aimExpected: get(ACTIVE_FIELD.AIM_EXPECTED),
        ownCell: get(ACTIVE_FIELD.OWN_CELL), enemyCell: get(ACTIVE_FIELD.ENEMY_CELL),
        aimCell: get(ACTIVE_FIELD.AIM_CELL),
        aimDirection: get(ACTIVE_FIELD.AIM_DIRECTION),
        currentDistance: get(ACTIVE_FIELD.CURRENT_DISTANCE),
        aimMaximumDistance: get(ACTIVE_FIELD.AIM_MAXIMUM_DISTANCE) });
    }
    return output;
  }

  summary() {
    return { enabled: true, behaviorNeutral: this.activeOverrideCount === 0,
      physicalOnly: true,
      postFireDepth: this.postFireDepth, postFireBudget: this.postFireBudget,
      setupSafetyDepth: this.setupSafetyDepth, setupSafetyBudget: this.setupSafetyBudget,
      observationCount: this.observationCount, fireRootCount: this.fireRootCount,
      supportSkipCount: this.supportSkipCount,
      zeroSignalFireCount: this.zeroSignalFireCount,
      postFireEvaluationCount: this.postFireEvaluationCount,
      postFireSafeCount: this.postFireSafeCount,
      postFireDeadCount: this.postFireDeadCount,
      postFireUnknownCount: this.postFireUnknownCount,
      aimCandidateCount: this.aimCandidateCount,
      aimMovementRowCount: this.aimMovementRowCount,
      aimHardBlockedCount: this.aimHardBlockedCount,
      aimRiskBlockedCount: this.aimRiskBlockedCount,
      aimDominatedSeenCount: this.aimDominatedSeenCount,
      aimRiskWorseCount: this.aimRiskWorseCount,
      aimRawRayImprovementRootCount: this.aimRawRayImprovementRootCount,
      aimCompleteCandidateCount: this.aimCompleteCandidateCount,
      aimIncompleteCandidateCount: this.aimIncompleteCandidateCount,
      aimRayImprovementRootCount: this.aimRayImprovementRootCount,
      aimProposalCount: this.aimProposalCount, aimUnsafeCount: this.aimUnsafeCount,
      aimUnknownCount: this.aimUnknownCount, postFireNodeCount: this.postFireNodeCount,
      aimRescueProposalCount: this.aimRescueProposalCount,
      aimQualityProposalCount: this.aimQualityProposalCount,
      aimProposalDespiteStaticRiskCount: this.aimProposalDespiteStaticRiskCount,
      fastQualityTriggerCount: this.fastQualityTriggerCount,
      fastQualityDistanceSkipCount: this.fastQualityDistanceSkipCount,
      activeOverrideCount: this.activeOverrideCount,
      activeRescueOverrideCount: this.activeRescueOverrideCount,
      activeQualityOverrideCount: this.activeQualityOverrideCount,
      activeRecordOverflowCount: this.activeRecordOverflowCount,
      activeRecords: this.activeRecords(),
      setupNodeCount: this.setupNodeCount,
      rootRestoreFailures: this.rootRestoreFailures,
      hotAllocationCount: this.hotAllocationCount + this.postFireSearch.hotAllocationCount +
        this.setupSearch.hotAllocationCount };
  }
}

module.exports = { POST_FIRE_STATUS, AIM_SETUP_STATUS, AIM_ACTIVE_MODE,
  HorizonSurvivalSearch,
  AimSetupPostFireClosureShadow };
