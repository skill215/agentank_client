"use strict";

// Behavior-neutral ObjectiveEpoch census.  The stable Option ledger owns
// semantic target identity; this observer asks whether that identity could
// survive ordinary callbacks while primitive actions remain replaceable.
// It never changes an action, Risk, Hard, Proof, Plan or search state.

const { ARRAY, SCALAR } = require(
  "../../../engine-v2/src/state/fast-state");
const { HARD_STATUS } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND } = require(
  "../../../engine-v2/src/policy/option-portfolio");
const { LONG_OPTION, OPTION_EVENT, OPTION_NAME } = require(
  "./event-driven-option-shadow");

const OBJECTIVE_EPOCH_STATUS = Object.freeze({
  NONE: 0,
  ADOPTED: 1,
  CONTINUED: 2,
  INTERRUPT_YIELD: 3,
  EVENT_REPLAN: 4,
  UNSIGNALED_HOLD: 5,
  EXECUTION_GAP: 6,
  INVALIDATED: 7,
  COUNT: 8
});
const OBJECTIVE_EPOCH_STATUS_NAME = Object.freeze([
  "NONE", "ADOPTED", "CONTINUED", "INTERRUPT_YIELD", "EVENT_REPLAN",
  "UNSIGNALED_HOLD", "EXECUTION_GAP", "INVALIDATED"
]);
const REPLAN_EVENT_MASK = OPTION_EVENT.STAR_TARGET | OPTION_EVENT.STAR_SCORE |
  OPTION_EVENT.ENEMY_VISIBILITY | OPTION_EVENT.CONTACT_MODE |
  OPTION_EVENT.TERMINAL_OR_EFFECT;

function sourceKind(kind) {
  if (kind === OPTION_KIND.DIRECT_KILL || kind === OPTION_KIND.ATTACK_SETUP)
    return LONG_OPTION.ATTACK;
  if (kind === OPTION_KIND.STAR_CONTROL) return LONG_OPTION.STAR_CONTROL;
  if (kind === OPTION_KIND.POSITION) return LONG_OPTION.POSITION;
  return LONG_OPTION.NONE;
}

function strategic(kind) {
  return kind === LONG_OPTION.ATTACK || kind === LONG_OPTION.STAR_CONTROL ||
    kind === LONG_OPTION.POSITION;
}

function interrupt(kind) {
  return kind === LONG_OPTION.COMMITTED_RESCUE ||
    kind === LONG_OPTION.STRICT_PROOF || kind === LONG_OPTION.RESOURCE ||
    kind === LONG_OPTION.TERMINAL;
}

function named(values, names) {
  const output = {};
  for (let at = 0; at < names.length; at += 1) output[names[at]] = values[at];
  return output;
}

function kindMatrix(values) {
  const output = {};
  for (let left = 0; left < LONG_OPTION.COUNT; left += 1) {
    const row = {};
    for (let right = 0; right < LONG_OPTION.COUNT; right += 1)
      row[OPTION_NAME[right]] = values[left * LONG_OPTION.COUNT + right];
    output[OPTION_NAME[left]] = row;
  }
  return output;
}

class ObjectiveEpochContinuityShadow {
  constructor(ledger) {
    if (!ledger) throw new Error(
      "ObjectiveEpochContinuityShadow requires StableOptionLedgerShadow");
    this.ledger = ledger;
    this.statusCount = new Uint32Array(OBJECTIVE_EPOCH_STATUS.COUNT);
    this.adoptedByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.heldFromKind = new Uint32Array(LONG_OPTION.COUNT);
    this.replannedToKind = new Uint32Array(LONG_OPTION.COUNT);
    this.executionRowsByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.searchInsideByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.searchOutsideByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.supportedFramesByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.gapFramesByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.selectedInsideByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.selectedOutsideByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.holdMatrix = new Uint32Array(LONG_OPTION.COUNT * LONG_OPTION.COUNT);
    this.gapSelectedMatrix = new Uint32Array(LONG_OPTION.COUNT * LONG_OPTION.COUNT);
    this.decisionCount = 0; this.matchCount = 0; this.epochCount = 0;
    this.epochFrameCount = 0; this.maximumEpochFrames = 0;
    this.continuationCount = 0; this.interruptYieldCount = 0;
    this.eventReplanCount = 0; this.unsignaledHoldCount = 0;
    this.executionSupportedCount = 0; this.executionGapCount = 0;
    this.selectedInsideEpochCount = 0; this.selectedOutsideEpochCount = 0;
    this.invalidatedCount = 0; this.searchComparableCount = 0;
    this.searchArgmaxInsideCount = 0; this.searchArgmaxOutsideCount = 0;
    this.capacityFailureCount = 0; this.hotAllocationCount = 0;
    this.initialized = 0; this.previousFrame = -1;
    this.activeSlot = -1; this.activeGeneration = 0;
    this.activeKind = LONG_OPTION.NONE; this.activeStartFrame = 0;
    this.activeFrames = 0; this.lastStatus = OBJECTIVE_EPOCH_STATUS.NONE;
    this.lastExecutionRowMask = 0; this.lastExecutionRowCount = 0;
    this.lastSearchArgmax = -1;
  }

  resetMatch() {
    this.activeSlot = -1; this.activeGeneration = 0;
    this.activeKind = LONG_OPTION.NONE; this.activeFrames = 0;
    this.lastStatus = OBJECTIVE_EPOCH_STATUS.NONE;
  }

  slotForGeneration(generation) {
    if (!generation) return -1;
    for (let slot = 0; slot < this.ledger.capacity; slot += 1)
      if (this.ledger.active[slot] && this.ledger.generation[slot] === generation)
        return slot;
    return -1;
  }

  adopt(slot, frame, status = OBJECTIVE_EPOCH_STATUS.ADOPTED) {
    if (slot < 0 || !this.ledger.active[slot] ||
        !strategic(this.ledger.kind[slot])) return 0;
    if (this.activeFrames > this.maximumEpochFrames)
      this.maximumEpochFrames = this.activeFrames;
    this.activeSlot = slot; this.activeGeneration = this.ledger.generation[slot];
    this.activeKind = this.ledger.kind[slot]; this.activeStartFrame = frame;
    this.activeFrames = 1; this.epochCount += 1; this.epochFrameCount += 1;
    this.adoptedByKind[this.activeKind] += 1;
    this.lastStatus = status; this.statusCount[status] += 1;
    return 1;
  }

  invalidate() {
    if (this.activeFrames > this.maximumEpochFrames)
      this.maximumEpochFrames = this.activeFrames;
    this.activeSlot = -1; this.activeGeneration = 0;
    this.activeKind = LONG_OPTION.NONE; this.activeFrames = 0;
    this.invalidatedCount += 1;
    this.lastStatus = OBJECTIVE_EPOCH_STATUS.INVALIDATED;
    this.statusCount[this.lastStatus] += 1;
  }

  executionRows(engine) {
    if (this.activeSlot < 0) return 0;
    const risk = engine.riskController && engine.riskController.outcome;
    const portfolio = engine.optionPortfolio;
    if (!risk || !portfolio) return 0;
    let mask = 0;
    for (let at = 0; at < portfolio.count; at += 1) {
      const row = portfolio.primitiveRow[at];
      if (row >= engine.ourCount || row >= risk.count || row >= 31 ||
          !portfolio.supportComplete[at] ||
          engine.hardStatus[row] !== HARD_STATUS.ALLOW ||
          !risk.acceptable[row] || risk.dominated[row]) continue;
      const kind = sourceKind(portfolio.kind[at]);
      if (kind !== this.activeKind ||
          !this.ledger.classifier.purposeComplete(
            engine, kind, row, engine.ourActions[row])) continue;
      this.ledger.deriveTarget(engine, kind, row, engine.ourActions[row], at);
      const slot = this.ledger.slotFor(kind, this.ledger.tempTargetSignature,
        this.ledger.tempTargetGeneration);
      if (slot === this.activeSlot && this.ledger.generation[slot] ===
          this.activeGeneration) mask |= 1 << row;
    }
    return mask >>> 0;
  }

  searchSource(engine) {
    const information = engine.informationSearch;
    if (information && information.completedDepth > 0 &&
        information.approximate === 0 && information.supportComplete === 1)
      return information;
    const physical = engine.depthSearch;
    if (physical && physical.completedDepth > 0 &&
        physical.representativeSupportComplete === 1) return physical;
    return null;
  }

  observeSearch(engine, mask) {
    this.lastSearchArgmax = -1;
    const source = this.searchSource(engine);
    if (!source || !source.rootScore || source.rootOurCount <= 0) return;
    let best = -1;
    for (let row = 0; row < source.rootOurCount; row += 1) {
      if (source.rootDomainRestricted && source.rootDomainMask &&
          !source.rootDomainMask[row]) continue;
      if (best < 0 || source.rootScore[row] > source.rootScore[best]) best = row;
    }
    if (best < 0) return;
    this.lastSearchArgmax = best; this.searchComparableCount += 1;
    if (mask & (1 << best)) {
      this.searchArgmaxInsideCount += 1; this.searchInsideByKind[this.activeKind] += 1;
    } else {
      this.searchArgmaxOutsideCount += 1; this.searchOutsideByKind[this.activeKind] += 1;
    }
  }

  observe(engine) {
    if (!engine || !engine.adapter || !engine.adapter.state) return;
    const frame = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (!this.initialized || frame <= this.previousFrame) {
      if (this.initialized && this.activeFrames > this.maximumEpochFrames)
        this.maximumEpochFrames = this.activeFrames;
      this.resetMatch(); this.matchCount += 1; this.initialized = 1;
    }
    this.previousFrame = frame; this.decisionCount += 1;
    const selectedKind = this.ledger.lastSelectedKind;
    const selectedGeneration = this.ledger.lastSelectedGeneration;
    const selectedSlot = this.ledger.lastSelectedSlot;
    const event = this.ledger.lastEventMask;

    if (this.activeGeneration) {
      const slot = this.slotForGeneration(this.activeGeneration);
      if (slot < 0) this.invalidate();
      else this.activeSlot = slot;
    }
    if (!this.activeGeneration) {
      if (!this.adopt(selectedSlot, frame)) {
        this.lastStatus = OBJECTIVE_EPOCH_STATUS.NONE;
        this.statusCount[this.lastStatus] += 1;
      }
    } else if (interrupt(selectedKind)) {
      this.activeFrames += 1; this.epochFrameCount += 1;
      this.interruptYieldCount += 1;
      this.lastStatus = OBJECTIVE_EPOCH_STATUS.INTERRUPT_YIELD;
      this.statusCount[this.lastStatus] += 1;
    } else if (selectedGeneration === this.activeGeneration) {
      this.activeFrames += 1; this.epochFrameCount += 1;
      this.continuationCount += 1;
      this.lastStatus = OBJECTIVE_EPOCH_STATUS.CONTINUED;
      this.statusCount[this.lastStatus] += 1;
    } else if (strategic(selectedKind) && event & REPLAN_EVENT_MASK &&
        selectedSlot >= 0) {
      this.eventReplanCount += 1; this.replannedToKind[selectedKind] += 1;
      this.adopt(selectedSlot, frame, OBJECTIVE_EPOCH_STATUS.EVENT_REPLAN);
    } else {
      this.activeFrames += 1; this.epochFrameCount += 1;
      this.unsignaledHoldCount += 1; this.heldFromKind[selectedKind] += 1;
      this.holdMatrix[this.activeKind * LONG_OPTION.COUNT + selectedKind] += 1;
      this.lastStatus = OBJECTIVE_EPOCH_STATUS.UNSIGNALED_HOLD;
      this.statusCount[this.lastStatus] += 1;
    }

    this.lastExecutionRowMask = this.executionRows(engine);
    this.lastExecutionRowCount = 0;
    for (let bits = this.lastExecutionRowMask; bits; bits >>>= 1)
      this.lastExecutionRowCount += bits & 1;
    if (this.activeGeneration && this.lastExecutionRowCount) {
      this.executionSupportedCount += 1;
      this.supportedFramesByKind[this.activeKind] += 1;
      this.executionRowsByKind[this.activeKind] += this.lastExecutionRowCount;
      if (selectedGeneration === this.activeGeneration) {
        this.selectedInsideEpochCount += 1;
        this.selectedInsideByKind[this.activeKind] += 1;
      } else {
        this.selectedOutsideEpochCount += 1;
        this.selectedOutsideByKind[this.activeKind] += 1;
      }
      this.observeSearch(engine, this.lastExecutionRowMask);
    } else if (this.activeGeneration) {
      this.executionGapCount += 1;
      this.gapFramesByKind[this.activeKind] += 1;
      this.gapSelectedMatrix[this.activeKind * LONG_OPTION.COUNT + selectedKind] += 1;
      if (this.lastStatus === OBJECTIVE_EPOCH_STATUS.UNSIGNALED_HOLD) {
        this.statusCount[this.lastStatus] -= 1;
        this.lastStatus = OBJECTIVE_EPOCH_STATUS.EXECUTION_GAP;
        this.statusCount[this.lastStatus] += 1;
      }
    }
    this.capacityFailureCount = this.ledger.capacityFailureCount;
  }

  summary() {
    return {
      decisionCount: this.decisionCount, matchCount: this.matchCount,
      epochCount: this.epochCount, epochFrameCount: this.epochFrameCount,
      maximumEpochFrames: Math.max(this.maximumEpochFrames, this.activeFrames),
      continuationCount: this.continuationCount,
      interruptYieldCount: this.interruptYieldCount,
      eventReplanCount: this.eventReplanCount,
      unsignaledHoldCount: this.unsignaledHoldCount,
      executionSupportedCount: this.executionSupportedCount,
      executionGapCount: this.executionGapCount,
      selectedInsideEpochCount: this.selectedInsideEpochCount,
      selectedOutsideEpochCount: this.selectedOutsideEpochCount,
      invalidatedCount: this.invalidatedCount,
      searchComparableCount: this.searchComparableCount,
      searchArgmaxInsideCount: this.searchArgmaxInsideCount,
      searchArgmaxOutsideCount: this.searchArgmaxOutsideCount,
      capacityFailureCount: this.capacityFailureCount,
      hotAllocationCount: this.hotAllocationCount,
      lastStatus: OBJECTIVE_EPOCH_STATUS_NAME[this.lastStatus],
      lastActiveKind: OPTION_NAME[this.activeKind],
      lastActiveGeneration: this.activeGeneration,
      lastExecutionRowCount: this.lastExecutionRowCount,
      lastSearchArgmax: this.lastSearchArgmax,
      statusCount: named(this.statusCount, OBJECTIVE_EPOCH_STATUS_NAME),
      adoptedByKind: named(this.adoptedByKind, OPTION_NAME),
      heldFromKind: named(this.heldFromKind, OPTION_NAME),
      replannedToKind: named(this.replannedToKind, OPTION_NAME),
      executionRowsByKind: named(this.executionRowsByKind, OPTION_NAME),
      supportedFramesByKind: named(this.supportedFramesByKind, OPTION_NAME),
      gapFramesByKind: named(this.gapFramesByKind, OPTION_NAME),
      selectedInsideByKind: named(this.selectedInsideByKind, OPTION_NAME),
      selectedOutsideByKind: named(this.selectedOutsideByKind, OPTION_NAME),
      searchInsideByKind: named(this.searchInsideByKind, OPTION_NAME),
      searchOutsideByKind: named(this.searchOutsideByKind, OPTION_NAME),
      holdMatrix: kindMatrix(this.holdMatrix),
      gapSelectedMatrix: kindMatrix(this.gapSelectedMatrix)
    };
  }
}

module.exports = { OBJECTIVE_EPOCH_STATUS, OBJECTIVE_EPOCH_STATUS_NAME,
  REPLAN_EVENT_MASK, ObjectiveEpochContinuityShadow };
