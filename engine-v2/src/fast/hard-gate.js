"use strict";

const { FAST_STATUS, HARD_STATUS, ACTION, CHANCE, NONE_FRAME, NONE_CELL, TERMINAL } =
  require("../abi/fast-codes");
const { BOOST_COMPOUND_BASE, BOOST_COMPOUND_STRIDE, BOOST_COMPOUND_END } =
  require("../abi/fast-codes");
const { RULE } = require("../generated/fast-config");
const { ARRAY, SCALAR } = require("../state/fast-state");

class HardGate {
  constructor(kernel, hazard, perspectiveSeat = 0) {
    this.kernel = kernel; this.hazard = hazard; this.perspectiveSeat = perspectiveSeat;
    this.lastStatus = HARD_STATUS.INCOMPLETE; this.lastFastStatus = FAST_STATUS.INCOMPLETE_STATE;
    this.lastTerminal = TERMINAL.INCOMPLETE; this.lastViable = -1;
    this.lastChanceSupportCount = 0; this.lastChanceFatalSupportCount = 0;
    this.lastChanceIncompleteSupportCount = 0;
    this.lastAppliedOwnCell = NONE_CELL; this.lastAppliedOwnDirection = 0xff;
    this.rootMismatchCount = 0; this.staleReadCount = 0; this.checkedActions = 0;
    this.rejectCount = 0; this.policyRejectCount = 0; this.incompleteCount = 0; this.fastAllowCount = 0;
    this.classifyCount = 0; this.reverseQueryCount = 0;
    this.reverseCacheHitCount = 0; this.reverseBuildCount = 0;
    this.hotAllocationCount = 0;
  }

  hasCommittedThreat() {
    const a = this.kernel.state.arrays;
    for (let slot = 0; slot < a[ARRAY.PROJECTILE_ACTIVE].length; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] !== this.perspectiveSeat) return 1;
    for (let slot = 0; slot < a[ARRAY.BOMB_ACTIVE].length; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot]) return 1;
    return 0;
  }

  classifyApplied() {
    const state = this.kernel.state; const terminal = state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    this.classifyCount += 1;
    this.lastTerminal = terminal; this.lastViable = -1;
    if (terminal) {
      const ownWin = this.perspectiveSeat === 0 ? TERMINAL.WIN0 : TERMINAL.WIN1;
      const policyTerminal = state.arrays[ARRAY.SCALAR][SCALAR.RUNTIME_POLICY] === 1 &&
        state.arrays[ARRAY.TANK_STARS][0] === state.arrays[ARRAY.TANK_STARS][1] &&
        ((state.arrays[ARRAY.TANK_CRASH][0] && state.arrays[ARRAY.TANK_CRASH][1]) ||
          state.arrays[ARRAY.SCALAR][SCALAR.RECORD] >= RULE.FRAME_RECORD_LIMIT - 1);
      if (policyTerminal && terminal !== ownWin) return HARD_STATUS.REJECT_POLICY;
      return terminal === ownWin ? HARD_STATUS.ALLOW : HARD_STATUS.REJECT_PROVEN;
    }
    if (!this.hasCommittedThreat()) { this.fastAllowCount += 1; return HARD_STATUS.ALLOW; }
    const beforeExactHits = this.hazard.reverseCacheHitCount;
    const beforeLatticeHits = this.hazard.reverseLatticeHitCount;
    const beforeLatticeMisses = this.hazard.reverseLatticeMissCount;
    const viable = this.hazard.reverseViable(this.perspectiveSeat); this.lastViable = viable;
    this.reverseQueryCount += 1;
    if (this.hazard.reverseCacheHitCount > beforeExactHits ||
        this.hazard.reverseLatticeHitCount > beforeLatticeHits)
      this.reverseCacheHitCount += 1;
    else if (this.hazard.reverseLatticeMissCount > beforeLatticeMisses ||
        !this.hazard.reverseLatticeEntries) this.reverseBuildCount += 1;
    else this.reverseCacheHitCount += 1;
    return viable > 0 ? HARD_STATUS.ALLOW : viable === 0 ?
      HARD_STATUS.REJECT_PROVEN : HARD_STATUS.INCOMPLETE;
  }

  chanceAffected(seat, action) {
    return this.chanceAlternativeCount(seat, action) > 1;
  }

  chanceAlternativeCount(seat, action) {
    const a = this.kernel.state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const active = a[ARRAY.TANK_STUN_UNTIL][seat] !== NONE_FRAME &&
      a[ARRAY.TANK_STUN_UNTIL][seat] > frame;
    if (!active) return 1;
    if (action >= BOOST_COMPOUND_BASE && action <= BOOST_COMPOUND_END) {
      const main = (action - BOOST_COMPOUND_BASE) % BOOST_COMPOUND_STRIDE;
      return main <= 2 ? 4 : 2;
    }
    return action === ACTION.GO || action === ACTION.TURN_LEFT ||
      action === ACTION.TURN_RIGHT ? 2 : 1;
  }

  // Hard rejection needs a proof across every supported chance outcome. A
  // merely possible reversed command remains risk, never a hard fact.
  evaluateAllOwnChance(action, argument = NONE_CELL, enemyAction = ACTION.NONE,
      enemyArgument = NONE_CELL, enemyChance = CHANCE.NORMAL,
      chanceCells = null, chanceDirections = null, chanceOffset = 0) {
    const count = this.chanceAlternativeCount(this.perspectiveSeat, action);
    let anyAllow = 0; let allProven = 1; let allRejected = 1;
    let fatalSupport = 0; let incompleteSupport = 0;
    for (let variant = 0; variant < count; variant += 1) {
      const status = this.evaluate(action, argument, enemyAction, enemyArgument, variant, enemyChance);
      if (chanceCells && chanceDirections) {
        chanceCells[chanceOffset + variant] = this.lastAppliedOwnCell;
        chanceDirections[chanceOffset + variant] = this.lastAppliedOwnDirection;
      }
      if (status === HARD_STATUS.ALLOW) anyAllow = 1;
      if (status === HARD_STATUS.REJECT_PROVEN || status === HARD_STATUS.REJECT_POLICY)
        fatalSupport += 1;
      if (status === HARD_STATUS.INCOMPLETE) incompleteSupport += 1;
      if (status !== HARD_STATUS.REJECT_PROVEN) allProven = 0;
      if (status !== HARD_STATUS.REJECT_PROVEN && status !== HARD_STATUS.REJECT_POLICY) allRejected = 0;
    }
    this.lastChanceSupportCount = count; this.lastChanceFatalSupportCount = fatalSupport;
    this.lastChanceIncompleteSupportCount = incompleteSupport;
    if (allProven) return HARD_STATUS.REJECT_PROVEN;
    if (anyAllow) return HARD_STATUS.ALLOW;
    return allRejected ? HARD_STATUS.REJECT_POLICY : HARD_STATUS.INCOMPLETE;
  }

  evaluate(action, argument = NONE_CELL, enemyAction = ACTION.NONE,
      enemyArgument = NONE_CELL, chance = CHANCE.NORMAL, enemyChance = CHANCE.NORMAL) {
    const state = this.kernel.state; const beforeLo = state.hashLo; const beforeHi = state.hashHi;
    const beforeDelta = state.deltaUsed; const beforeEvent = state.eventUsed;
    const status = this.perspectiveSeat === 0 ?
      this.kernel.applyFrame(action, argument, enemyAction, enemyArgument, chance, enemyChance) :
      this.kernel.applyFrame(enemyAction, enemyArgument, action, argument, enemyChance, chance);
    this.lastFastStatus = status; this.checkedActions += 1; this.kernel.hardCheckedActionCount += 1;
    let hard = HARD_STATUS.INCOMPLETE;
    this.lastAppliedOwnCell = NONE_CELL; this.lastAppliedOwnDirection = 0xff;
    this.lastTerminal = TERMINAL.INCOMPLETE; this.lastViable = -1;
    if (status === FAST_STATUS.APPLIED || status === FAST_STATUS.APPLIED_TERMINAL) {
      this.lastAppliedOwnCell = state.arrays[ARRAY.TANK_CELL][this.perspectiveSeat];
      this.lastAppliedOwnDirection = state.arrays[ARRAY.TANK_DIR][this.perspectiveSeat];
      hard = this.classifyApplied();
      this.kernel.undoLast();
    }
    if (state.hashLo !== beforeLo || state.hashHi !== beforeHi || state.deltaUsed !== beforeDelta ||
        state.eventUsed !== beforeEvent) { this.rootMismatchCount += 1; hard = HARD_STATUS.INCOMPLETE; }
    if (hard === HARD_STATUS.REJECT_PROVEN) this.rejectCount += 1;
    if (hard === HARD_STATUS.REJECT_POLICY) this.policyRejectCount += 1;
    if (hard === HARD_STATUS.INCOMPLETE) this.incompleteCount += 1;
    this.lastStatus = hard; return hard;
  }

  evaluateBatch(actions, actionArguments, count, outStatuses) {
    if (count > actions.length || count > actionArguments.length || count > outStatuses.length) return 0;
    for (let index = 0; index < count; index += 1)
      outStatuses[index] = this.evaluate(actions[index], actionArguments[index]);
    return count;
  }
}

module.exports = { HardGate };
