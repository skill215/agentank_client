"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { CAPACITY } = require("../generated/fast-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, SKILL, FAST_STATUS, TERMINAL, NONE_FRAME, NONE_CELL } =
  require("../abi/fast-codes");
const { PROOF_STATUS } = require("../abi/search-codes");

class ProductionForcedWinSearch {
  constructor() {
    const frames = SEARCH_CAPACITY.MAX_DECISION_DEPTH + 1;
    this.ourActions = new Uint8Array(frames * SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.ourArguments = new Uint16Array(frames * SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.enemyActions = new Uint8Array(frames * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.enemyArguments = new Uint16Array(frames * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.ourCount = new Uint8Array(frames); this.enemyCount = new Uint8Array(frames);
    this.nodeBudget = 0; this.nodes = 0; this.completedDepth = 0;
    this.lastStatus = PROOF_STATUS.UNKNOWN; this.winningRootRow = -1;
    this.incompleteCount = 0; this.budgetStopCount = 0; this.rootRestoreFailures = 0;
    this.hotAllocationCount = 0;
  }
  resetRoot() {
    this.nodes = 0; this.completedDepth = 0; this.lastStatus = PROOF_STATUS.UNKNOWN;
    this.winningRootRow = -1; this.incompleteCount = 0; this.budgetStopCount = 0;
  }
  active(a, arrayId, seat, frame) {
    return a[arrayId][seat] !== NONE_FRAME && a[arrayId][seat] > frame;
  }
  canAct(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.active(a, ARRAY.TANK_FROZEN_UNTIL, seat, frame)) return 0;
    if (this.active(a, ARRAY.TANK_POISON_UNTIL, seat, frame)) {
      const applied = a[ARRAY.TANK_POISON_APPLIED][seat];
      if (applied === NONE_FRAME || ((frame - applied) & 1) !== 0) return 0;
    }
    return 1;
  }
  activeProjectile(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] && a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 1;
    return 0;
  }
  activeBomb(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot] && a[ARRAY.BOMB_OWNER][slot] === seat) return 1;
    return 0;
  }
  push(top, seat, action, argument = NONE_CELL) {
    const countArray = seat ? this.enemyCount : this.ourCount;
    const maximum = seat ? SEARCH_CAPACITY.MAX_ENEMY_POLICIES : SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    const count = countArray[top]; if (count >= maximum) return 0;
    const actions = seat ? this.enemyActions : this.ourActions;
    const arguments_ = seat ? this.enemyArguments : this.ourArguments;
    const base = top * maximum;
    for (let index = 0; index < count; index += 1)
      if (actions[base + index] === action && arguments_[base + index] === argument) return 1;
    actions[base + count] = action; arguments_[base + count] = argument;
    countArray[top] = count + 1; return 1;
  }
  generate(top, state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (seat) this.enemyCount[top] = 0; else this.ourCount[top] = 0;
    if (!this.push(top, seat, ACTION.NONE)) return 0;
    if (!this.canAct(state, seat)) return seat ? 1 : this.push(top, seat, ACTION.NONE);
    if (!this.push(top, seat, ACTION.GO) || !this.push(top, seat, ACTION.TURN_LEFT) ||
        !this.push(top, seat, ACTION.TURN_RIGHT)) return 0;
    if (!this.activeProjectile(state, seat) &&
        (a[ARRAY.TANK_FIRE_LOCK][seat] === NONE_FRAME || a[ARRAY.TANK_FIRE_LOCK][seat] <= frame) &&
        !this.push(top, seat, ACTION.FIRE)) return 0;
    if (!this.activeBomb(state, seat) && a[ARRAY.TANK_BOMB_READY][seat] <= frame &&
        !this.push(top, seat, ACTION.THROW_BOMB)) return 0;
    const skill = a[ARRAY.TANK_SKILL][seat];
    if (skill !== SKILL.NONE && a[ARRAY.TANK_SKILL_READY][seat] <= frame) {
      // Teleport target support and active boost compound programs need their
      // dedicated complete family generator. Until then this strict proof
      // returns UNKNOWN instead of silently pruning an enemy response.
      if (skill === SKILL.TELEPORT || this.active(a, ARRAY.TANK_BOOST_UNTIL, seat, frame)) return 0;
      if (!this.push(top, seat, ACTION.CAST_SHIELD + skill - SKILL.SHIELD)) return 0;
    }
    return 1;
  }
  actionAt(top, seat, index) {
    const maximum = seat ? SEARCH_CAPACITY.MAX_ENEMY_POLICIES : SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    return (seat ? this.enemyActions : this.ourActions)[top * maximum + index];
  }
  argumentAt(top, seat, index) {
    const maximum = seat ? SEARCH_CAPACITY.MAX_ENEMY_POLICIES : SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    return (seat ? this.enemyArguments : this.ourArguments)[top * maximum + index];
  }
  terminalStatus(code) {
    return code === TERMINAL.WIN0 ? PROOF_STATUS.PROVEN : PROOF_STATUS.DISPROVEN;
  }
  proveOutcome(bundle, depth, top, action0, argument0, action1, argument1,
      chance0, chance1) {
    if (this.nodes >= this.nodeBudget) { this.budgetStopCount += 1; return PROOF_STATUS.UNKNOWN; }
    const status = bundle.kernel.applyFrame(action0, argument0, action1, argument1,
      chance0, chance1); this.nodes += 1;
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
      this.incompleteCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const mark = bundle.kernel.lastMark;
    const terminal = bundle.state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    let result;
    if (terminal) result = this.terminalStatus(terminal);
    else if (depth <= 1) result = PROOF_STATUS.DISPROVEN;
    else result = this.proveState(bundle, depth - 1, top + 1);
    bundle.state.undoTo(mark); return result;
  }
  proveRow(bundle, depth, top, row) {
    const action0 = this.actionAt(top, 0, row); const argument0 = this.argumentAt(top, 0, row);
    let unknown = 0;
    for (let column = 0; column < this.enemyCount[top]; column += 1) {
      const action1 = this.actionAt(top, 1, column); const argument1 = this.argumentAt(top, 1, column);
      const ownChance = bundle.hard.chanceAlternativeCount(0, action0);
      const enemyChance = bundle.hard.chanceAlternativeCount(1, action1);
      for (let chance = 0; chance < ownChance * enemyChance; chance += 1) {
        const result = this.proveOutcome(bundle, depth, top, action0, argument0,
          action1, argument1, chance % ownChance, Math.floor(chance / ownChance));
        if (result === PROOF_STATUS.DISPROVEN) return PROOF_STATUS.DISPROVEN;
        if (result === PROOF_STATUS.UNKNOWN) unknown = 1;
      }
    }
    return unknown ? PROOF_STATUS.UNKNOWN : PROOF_STATUS.PROVEN;
  }
  proveState(bundle, depth, top) {
    if (top > SEARCH_CAPACITY.MAX_DECISION_DEPTH ||
        !this.generate(top, bundle.state, 0) || !this.generate(top, bundle.state, 1)) {
      this.incompleteCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    let unknown = 0;
    for (let row = 0; row < this.ourCount[top]; row += 1) {
      const result = this.proveRow(bundle, depth, top, row);
      if (result === PROOF_STATUS.PROVEN) return PROOF_STATUS.PROVEN;
      if (result === PROOF_STATUS.UNKNOWN) unknown = 1;
    }
    return unknown ? PROOF_STATUS.UNKNOWN : PROOF_STATUS.DISPROVEN;
  }
  search(bundle, rootActions, rootArguments, rootOurCount,
      rootEnemyActions, rootEnemyArguments, rootEnemyCount, depth, nodeBudget) {
    this.resetRoot();
    if (!bundle || !Number.isInteger(rootOurCount) || !Number.isInteger(rootEnemyCount) ||
        !Number.isInteger(depth) || !Number.isInteger(nodeBudget) || nodeBudget < 1 ||
        rootOurCount < 1 || rootEnemyCount < 1 || depth < 1 ||
        rootOurCount > SEARCH_CAPACITY.MAX_OUR_ACTIONS ||
        rootEnemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES) return this.lastStatus;
    this.nodeBudget = nodeBudget;
    this.ourCount[0] = rootOurCount; this.enemyCount[0] = rootEnemyCount;
    for (let index = 0; index < rootOurCount; index += 1) {
      this.ourActions[index] = rootActions[index]; this.ourArguments[index] = rootArguments[index];
    }
    for (let index = 0; index < rootEnemyCount; index += 1) {
      this.enemyActions[index] = rootEnemyActions[index];
      this.enemyArguments[index] = rootEnemyArguments[index];
    }
    const state = bundle.state; const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    for (let horizon = 1; horizon <= depth && this.nodes < this.nodeBudget; horizon += 1) {
      let unknown = 0; let proven = 0;
      for (let row = 0; row < rootOurCount; row += 1) {
        const result = this.proveRow(bundle, horizon, 0, row);
        if (result === PROOF_STATUS.PROVEN) { this.winningRootRow = row;
          this.lastStatus = PROOF_STATUS.PROVEN; proven = 1; break; }
        if (result === PROOF_STATUS.UNKNOWN) unknown = 1;
      }
      if (proven) { this.completedDepth = horizon; break; }
      this.lastStatus = unknown ? PROOF_STATUS.UNKNOWN : PROOF_STATUS.DISPROVEN;
      if (!unknown) this.completedDepth = horizon;
    }
    state.undoTo(rootMark);
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== rootMark) {
      this.rootRestoreFailures += 1; this.lastStatus = PROOF_STATUS.UNKNOWN;
      this.winningRootRow = -1; this.completedDepth = 0;
    }
    return this.lastStatus;
  }
}

module.exports = { ProductionForcedWinSearch };
