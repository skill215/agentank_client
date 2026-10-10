"use strict";

// Behavior-neutral execution-domain adapter for ObjectiveEpoch.  It expands a
// durable semantic target into this frame's legal primitive rows, but never
// selects or emits one.  Physical Hard and the existing Risk frontier remain
// mandatory membership gates.

const { ARRAY, SCALAR } = require(
  "../../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { LONG_OPTION, OPTION_NAME } = require("./event-driven-option-shadow");
const { TARGET_CLASS } = require("./stable-option-ledger-shadow");
const { ObjectiveOptionRouter } = require(
  "../../../engine-v2/src/policy/objective-option-router");
const { OBJECTIVE_EPOCH_STATUS } = require(
  "./objective-epoch-continuity-shadow");

function named(values) {
  const output = {};
  for (let at = 0; at < OPTION_NAME.length; at += 1)
    output[OPTION_NAME[at]] = values[at];
  return output;
}

class ObjectiveEpochExecutionShadow {
  constructor(epoch) {
    if (!epoch) throw new Error(
      "ObjectiveEpochExecutionShadow requires ObjectiveEpochContinuityShadow");
    this.epoch = epoch; this.router = new ObjectiveOptionRouter();
    this.strictSupportedByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.expandedSupportedByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.recoveredGapByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.remainingGapByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.generatedRowsByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.selectedInsideExpandedByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.searchInsideExpandedByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.searchOutsideExpandedByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.decisionCount = 0; this.activeFrameCount = 0;
    this.suspendedFrameCount = 0; this.noTargetGapCount = 0;
    this.noProgressGapCount = 0;
    this.strictSupportedCount = 0; this.expandedSupportedCount = 0;
    this.recoveredGapCount = 0; this.remainingGapCount = 0;
    this.generatedRowCount = 0; this.directFireRowCount = 0;
    this.approachRowCount = 0; this.selectedInsideExpandedCount = 0;
    this.selectedOutsideExpandedCount = 0; this.searchComparableCount = 0;
    this.searchInsideExpandedCount = 0; this.searchOutsideExpandedCount = 0;
    this.hotAllocationCount = 0; this.lastGeneratedMask = 0;
    this.lastExpandedMask = 0; this.lastExpandedCount = 0;
  }

  eligible(engine, row) {
    const risk = engine.riskController && engine.riskController.outcome;
    return row >= 0 && row < engine.ourCount && row < 31 && risk &&
      row < risk.count && engine.hardStatus[row] === HARD_STATUS.ALLOW &&
      risk.acceptable[row] && !risk.dominated[row];
  }

  targetCell(engine) {
    const a = engine.adapter.state.arrays;
    if (this.epoch.activeKind === LONG_OPTION.ATTACK)
      return engine.adapter.enemyVisible ? a[ARRAY.TANK_CELL][1] : NONE_CELL;
    if (this.epoch.activeKind === LONG_OPTION.STAR_CONTROL)
      return a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (this.epoch.activeKind !== LONG_OPTION.POSITION ||
        this.epoch.activeSlot < 0) return NONE_CELL;
    const signature = this.epoch.ledger.targetSignature[this.epoch.activeSlot];
    return signature >>> 28 === TARGET_CLASS.STAR ?
      a[ARRAY.SCALAR][SCALAR.STAR_CELL] :
      engine.adapter.enemyVisible ? a[ARRAY.TANK_CELL][1] : NONE_CELL;
  }

  directFireMask(engine, target) {
    if (target === NONE_CELL) return 0;
    const own = engine.adapter.state.arrays[ARRAY.TANK_CELL][0];
    if (!engine.clearLine(own, target)) return 0;
    const direction = engine.directionTo(own, target); let mask = 0;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (this.eligible(engine, row) && engine.ourActions[row] === ACTION.FIRE &&
          engine.projectedDirection[row] === direction) mask |= 1 << row;
    return mask >>> 0;
  }

  targetProgressMask(engine, target) {
    if (target === NONE_CELL) return 0;
    const a = engine.adapter.state.arrays; const own = a[ARRAY.TANK_CELL][0];
    const originalDistance = engine.manhattan(own, target);
    const desired = this.router.approachDirection(a && engine.adapter.state,
      own, target);
    let bestDistance = 0xffff; let bestFacing = -1; let mask = 0;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (!this.eligible(engine, row)) continue;
      const action = engine.ourActions[row];
      if (action !== ACTION.GO && action !== ACTION.TURN_LEFT &&
          action !== ACTION.TURN_RIGHT) continue;
      const cell = engine.projectedCell[row]; const direction = engine.projectedDirection[row];
      const distance = engine.manhattan(cell, target);
      const facing = direction === desired ? 1 : 0;
      const strictProgress = distance < originalDistance ||
        distance === originalDistance && facing;
      if (!strictProgress) continue;
      if (distance < bestDistance || distance === bestDistance && facing > bestFacing) {
        bestDistance = distance; bestFacing = facing; mask = 1 << row;
      } else if (distance === bestDistance && facing === bestFacing) mask |= 1 << row;
    }
    return mask >>> 0;
  }

  generatedMask(engine) {
    const target = this.targetCell(engine);
    if (target === NONE_CELL) return 0;
    let mask = this.targetProgressMask(engine, target);
    const signature = this.epoch.activeSlot < 0 ? 0 :
      this.epoch.ledger.targetSignature[this.epoch.activeSlot];
    if (this.epoch.activeKind === LONG_OPTION.ATTACK ||
        this.epoch.activeKind === LONG_OPTION.POSITION &&
          signature >>> 28 === TARGET_CLASS.ENEMY)
      mask |= this.directFireMask(engine, target);
    return mask >>> 0;
  }

  selectedRow(engine) {
    const selected = engine.finalGate && engine.finalGate.lastSelected;
    return Number.isSafeInteger(selected) && selected >= 0 &&
      selected < engine.ourCount ? selected : -1;
  }

  observeSearch(engine, mask) {
    const source = this.epoch.searchSource(engine);
    if (!source || !source.rootScore || source.rootOurCount <= 0) return;
    let best = -1;
    for (let row = 0; row < source.rootOurCount; row += 1) {
      if (source.rootDomainRestricted && source.rootDomainMask &&
          !source.rootDomainMask[row]) continue;
      if (best < 0 || source.rootScore[row] > source.rootScore[best]) best = row;
    }
    if (best < 0) return;
    this.searchComparableCount += 1;
    if (mask & (1 << best)) {
      this.searchInsideExpandedCount += 1;
      this.searchInsideExpandedByKind[this.epoch.activeKind] += 1;
    } else {
      this.searchOutsideExpandedCount += 1;
      this.searchOutsideExpandedByKind[this.epoch.activeKind] += 1;
    }
  }

  observe(engine) {
    this.decisionCount += 1; this.lastGeneratedMask = 0;
    this.lastExpandedMask = 0; this.lastExpandedCount = 0;
    if (!this.epoch.activeGeneration) return;
    if (this.epoch.lastStatus === OBJECTIVE_EPOCH_STATUS.INTERRUPT_YIELD) {
      this.suspendedFrameCount += 1; return;
    }
    this.activeFrameCount += 1; const kind = this.epoch.activeKind;
    const strict = this.epoch.lastExecutionRowMask >>> 0;
    const generated = this.generatedMask(engine);
    const expanded = (strict | generated) >>> 0;
    this.lastGeneratedMask = generated; this.lastExpandedMask = expanded;
    for (let bits = expanded; bits; bits >>>= 1) this.lastExpandedCount += bits & 1;
    let generatedCount = 0;
    for (let bits = generated; bits; bits >>>= 1) generatedCount += bits & 1;
    this.generatedRowCount += generatedCount; this.generatedRowsByKind[kind] += generatedCount;
    if (strict) {
      this.strictSupportedCount += 1; this.strictSupportedByKind[kind] += 1;
    }
    if (expanded) {
      this.expandedSupportedCount += 1; this.expandedSupportedByKind[kind] += 1;
      if (!strict) {
        this.recoveredGapCount += 1; this.recoveredGapByKind[kind] += 1;
      }
      const selected = this.selectedRow(engine);
      if (selected >= 0 && expanded & (1 << selected)) {
        this.selectedInsideExpandedCount += 1;
        this.selectedInsideExpandedByKind[kind] += 1;
      } else this.selectedOutsideExpandedCount += 1;
      this.observeSearch(engine, expanded);
    } else {
      this.remainingGapCount += 1; this.remainingGapByKind[kind] += 1;
      if (this.targetCell(engine) === NONE_CELL) this.noTargetGapCount += 1;
      else this.noProgressGapCount += 1;
    }
    const signature = this.epoch.activeSlot < 0 ? 0 :
      this.epoch.ledger.targetSignature[this.epoch.activeSlot];
    const direct = this.epoch.activeKind === LONG_OPTION.ATTACK ||
      this.epoch.activeKind === LONG_OPTION.POSITION &&
        signature >>> 28 === TARGET_CLASS.ENEMY ?
      this.directFireMask(engine, this.targetCell(engine)) : 0;
    let directCount = 0;
    for (let bits = direct; bits; bits >>>= 1) directCount += bits & 1;
    this.directFireRowCount += directCount;
    this.approachRowCount += Math.max(0, generatedCount - directCount);
  }

  summary() {
    return {
      decisionCount: this.decisionCount, activeFrameCount: this.activeFrameCount,
      suspendedFrameCount: this.suspendedFrameCount,
      noTargetGapCount: this.noTargetGapCount,
      noProgressGapCount: this.noProgressGapCount,
      strictSupportedCount: this.strictSupportedCount,
      expandedSupportedCount: this.expandedSupportedCount,
      recoveredGapCount: this.recoveredGapCount,
      remainingGapCount: this.remainingGapCount,
      generatedRowCount: this.generatedRowCount,
      directFireRowCount: this.directFireRowCount,
      approachRowCount: this.approachRowCount,
      selectedInsideExpandedCount: this.selectedInsideExpandedCount,
      selectedOutsideExpandedCount: this.selectedOutsideExpandedCount,
      searchComparableCount: this.searchComparableCount,
      searchInsideExpandedCount: this.searchInsideExpandedCount,
      searchOutsideExpandedCount: this.searchOutsideExpandedCount,
      hotAllocationCount: this.hotAllocationCount,
      lastExpandedCount: this.lastExpandedCount,
      strictSupportedByKind: named(this.strictSupportedByKind),
      expandedSupportedByKind: named(this.expandedSupportedByKind),
      recoveredGapByKind: named(this.recoveredGapByKind),
      remainingGapByKind: named(this.remainingGapByKind),
      generatedRowsByKind: named(this.generatedRowsByKind),
      selectedInsideExpandedByKind: named(this.selectedInsideExpandedByKind),
      searchInsideExpandedByKind: named(this.searchInsideExpandedByKind),
      searchOutsideExpandedByKind: named(this.searchOutsideExpandedByKind)
    };
  }
}

module.exports = { ObjectiveEpochExecutionShadow };
