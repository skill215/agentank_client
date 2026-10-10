"use strict";

// Behavior-neutral semantic target epoch. Unlike the BP112 kind/generation
// observer, POSITION is never an objective. ATTACK/STAR and POSITION aliases
// that point at the same target signature/generation share one epoch.

const { ARRAY, SCALAR } = require(
  "../../../engine-v2/src/state/fast-state");
const { HARD_STATUS } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND } = require(
  "../../../engine-v2/src/policy/option-portfolio");
const { LONG_OPTION, OPTION_EVENT, OPTION_NAME } = require(
  "./event-driven-option-shadow");
const { TARGET_CLASS } = require("./stable-option-ledger-shadow");
const { OBJECTIVE_EPOCH_STATUS, OBJECTIVE_EPOCH_STATUS_NAME,
  REPLAN_EVENT_MASK } = require("./objective-epoch-continuity-shadow");

function optionSourceKind(kind) {
  if (kind === OPTION_KIND.DIRECT_KILL || kind === OPTION_KIND.ATTACK_SETUP)
    return LONG_OPTION.ATTACK;
  if (kind === OPTION_KIND.STAR_CONTROL) return LONG_OPTION.STAR_CONTROL;
  if (kind === OPTION_KIND.POSITION) return LONG_OPTION.POSITION;
  return LONG_OPTION.NONE;
}

function goalKind(signature) {
  const targetClass = signature >>> 28;
  return targetClass === TARGET_CLASS.ENEMY ? LONG_OPTION.ATTACK :
    targetClass === TARGET_CLASS.STAR ? LONG_OPTION.STAR_CONTROL : LONG_OPTION.NONE;
}

function interrupt(kind) {
  return kind === LONG_OPTION.COMMITTED_RESCUE ||
    kind === LONG_OPTION.STRICT_PROOF || kind === LONG_OPTION.RESOURCE ||
    kind === LONG_OPTION.TERMINAL;
}

function named(values, names = OPTION_NAME) {
  const output = {};
  for (let at = 0; at < names.length; at += 1) output[names[at]] = values[at];
  return output;
}

function matrix(values) {
  const output = {};
  for (let left = 0; left < LONG_OPTION.COUNT; left += 1) {
    output[OPTION_NAME[left]] = {};
    for (let right = 0; right < LONG_OPTION.COUNT; right += 1)
      output[OPTION_NAME[left]][OPTION_NAME[right]] =
        values[left * LONG_OPTION.COUNT + right];
  }
  return output;
}

class SemanticObjectiveEpochShadow {
  constructor(ledger) {
    if (!ledger) throw new Error(
      "SemanticObjectiveEpochShadow requires StableOptionLedgerShadow");
    this.ledger = ledger;
    this.statusCount = new Uint32Array(OBJECTIVE_EPOCH_STATUS.COUNT);
    this.adoptedByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.heldFromKind = new Uint32Array(LONG_OPTION.COUNT);
    this.replannedToKind = new Uint32Array(LONG_OPTION.COUNT);
    this.executionRowsByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.supportedFramesByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.gapFramesByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.selectedInsideByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.selectedOutsideByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.searchInsideByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.searchOutsideByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.holdMatrix = new Uint32Array(LONG_OPTION.COUNT * LONG_OPTION.COUNT);
    this.gapSelectedMatrix = new Uint32Array(LONG_OPTION.COUNT * LONG_OPTION.COUNT);
    this.decisionCount = 0; this.matchCount = 0; this.epochCount = 0;
    this.epochFrameCount = 0; this.maximumEpochFrames = 0;
    this.continuationCount = 0; this.crossKindContinuationCount = 0;
    this.interruptYieldCount = 0; this.eventReplanCount = 0;
    this.unsignaledHoldCount = 0; this.executionSupportedCount = 0;
    this.executionGapCount = 0; this.selectedInsideEpochCount = 0;
    this.selectedOutsideEpochCount = 0; this.invalidatedCount = 0;
    this.searchComparableCount = 0; this.searchArgmaxInsideCount = 0;
    this.searchArgmaxOutsideCount = 0; this.capacityFailureCount = 0;
    this.hotAllocationCount = 0; this.initialized = 0; this.previousFrame = -1;
    this.activeSlot = -1; this.activeGeneration = 0; this.nextGeneration = 0;
    this.activeKind = LONG_OPTION.NONE; this.activeSourceKind = LONG_OPTION.NONE;
    this.activeTargetSignature = 0; this.activeTargetGeneration = 0;
    this.activeFrames = 0; this.lastStatus = OBJECTIVE_EPOCH_STATUS.NONE;
    this.lastExecutionRowMask = 0; this.lastExecutionRowCount = 0;
    this.lastSearchArgmax = -1;
  }

  resetMatch() {
    this.activeSlot = -1; this.activeGeneration = 0;
    this.activeKind = LONG_OPTION.NONE; this.activeSourceKind = LONG_OPTION.NONE;
    this.activeTargetSignature = 0; this.activeTargetGeneration = 0;
    this.activeFrames = 0; this.lastStatus = OBJECTIVE_EPOCH_STATUS.NONE;
  }

  slotGoal(slot) {
    return slot >= 0 && this.ledger.active[slot] ?
      goalKind(this.ledger.targetSignature[slot]) : LONG_OPTION.NONE;
  }

  slotMatchesActive(slot) {
    return slot >= 0 && this.ledger.active[slot] &&
      this.ledger.targetSignature[slot] === this.activeTargetSignature &&
      this.ledger.targetGeneration[slot] === this.activeTargetGeneration &&
      this.slotGoal(slot) === this.activeKind;
  }

  findActiveSlot() {
    for (let slot = 0; slot < this.ledger.capacity; slot += 1)
      if (this.slotMatchesActive(slot)) return slot;
    return -1;
  }

  adopt(slot, status = OBJECTIVE_EPOCH_STATUS.ADOPTED) {
    const kind = this.slotGoal(slot);
    if (kind === LONG_OPTION.NONE) return 0;
    if (this.activeFrames > this.maximumEpochFrames)
      this.maximumEpochFrames = this.activeFrames;
    this.nextGeneration = (this.nextGeneration + 1) & 0xffff;
    if (!this.nextGeneration) this.nextGeneration = 1;
    this.activeGeneration = this.nextGeneration; this.activeSlot = slot;
    this.activeKind = kind; this.activeSourceKind = this.ledger.kind[slot];
    this.activeTargetSignature = this.ledger.targetSignature[slot];
    this.activeTargetGeneration = this.ledger.targetGeneration[slot];
    this.activeFrames = 1; this.epochCount += 1; this.epochFrameCount += 1;
    this.adoptedByKind[kind] += 1; this.lastStatus = status;
    this.statusCount[status] += 1; return 1;
  }

  invalidate() {
    if (this.activeFrames > this.maximumEpochFrames)
      this.maximumEpochFrames = this.activeFrames;
    this.activeSlot = -1; this.activeGeneration = 0;
    this.activeKind = LONG_OPTION.NONE; this.activeSourceKind = LONG_OPTION.NONE;
    this.activeTargetSignature = 0; this.activeTargetGeneration = 0;
    this.activeFrames = 0; this.invalidatedCount += 1;
    this.lastStatus = OBJECTIVE_EPOCH_STATUS.INVALIDATED;
    this.statusCount[this.lastStatus] += 1;
  }

  optionMatchesActiveTarget(engine, sourceIndex, row) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio || sourceIndex < 0 || sourceIndex >= portfolio.count) return 0;
    const source = optionSourceKind(portfolio.kind[sourceIndex]);
    if (source === LONG_OPTION.NONE) return 0;
    this.ledger.deriveTarget(engine, source, row, engine.ourActions[row], sourceIndex);
    return this.ledger.tempTargetSignature === this.activeTargetSignature &&
      this.ledger.tempTargetGeneration === this.activeTargetGeneration &&
      goalKind(this.ledger.tempTargetSignature) === this.activeKind ? 1 : 0;
  }

  executionRows(engine) {
    const risk = engine.riskController && engine.riskController.outcome;
    const portfolio = engine.optionPortfolio;
    if (!risk || !portfolio || !this.activeGeneration) return 0;
    let mask = 0;
    for (let at = 0; at < portfolio.count; at += 1) {
      const row = portfolio.primitiveRow[at];
      if (row < 0 || row >= engine.ourCount || row >= risk.count || row >= 31 ||
          !portfolio.supportComplete[at] ||
          engine.hardStatus[row] !== HARD_STATUS.ALLOW ||
          !risk.acceptable[row] || risk.dominated[row]) continue;
      const source = optionSourceKind(portfolio.kind[at]);
      if (source === LONG_OPTION.NONE ||
          !this.ledger.classifier.purposeComplete(
            engine, source, row, engine.ourActions[row]) ||
          !this.optionMatchesActiveTarget(engine, at, row)) continue;
      mask |= 1 << row;
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
    this.lastSearchArgmax = -1; const source = this.searchSource(engine);
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

  selectedRow(engine) {
    const row = engine.diagnosticInternalSelectedIndex;
    return Number.isSafeInteger(row) && row >= 0 && row < engine.ourCount ? row : -1;
  }

  selectedRowMatchesActive(engine, row) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio || row < 0 || !this.activeGeneration) return 0;
    for (let at = 0; at < portfolio.count; at += 1)
      if (portfolio.primitiveRow[at] === row && portfolio.supportComplete[at] &&
          this.optionMatchesActiveTarget(engine, at, row)) return 1;
    return 0;
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
    const selectedSlot = this.ledger.lastSelectedSlot;
    const selectedRawKind = this.ledger.lastSelectedKind;
    const selectedGoal = this.slotGoal(selectedSlot);
    const event = this.ledger.lastEventMask;
    const selectedRow = this.selectedRow(engine);
    if (this.activeGeneration) {
      const slot = this.findActiveSlot();
      if (slot < 0) this.invalidate();
      else this.activeSlot = slot;
    }
    if (!this.activeGeneration) {
      if (!this.adopt(selectedSlot)) {
        this.lastStatus = OBJECTIVE_EPOCH_STATUS.NONE;
        this.statusCount[this.lastStatus] += 1;
      }
    } else if (interrupt(selectedRawKind)) {
      this.activeFrames += 1; this.epochFrameCount += 1;
      this.interruptYieldCount += 1;
      this.lastStatus = OBJECTIVE_EPOCH_STATUS.INTERRUPT_YIELD;
      this.statusCount[this.lastStatus] += 1;
    } else if (selectedGoal !== LONG_OPTION.NONE &&
        this.slotMatchesActive(selectedSlot) ||
        this.selectedRowMatchesActive(engine, selectedRow)) {
      this.activeFrames += 1; this.epochFrameCount += 1;
      this.continuationCount += 1;
      if (selectedRawKind !== this.activeSourceKind)
        this.crossKindContinuationCount += 1;
      this.activeSourceKind = selectedRawKind;
      this.lastStatus = OBJECTIVE_EPOCH_STATUS.CONTINUED;
      this.statusCount[this.lastStatus] += 1;
    } else if (selectedGoal !== LONG_OPTION.NONE && event & REPLAN_EVENT_MASK) {
      this.eventReplanCount += 1; this.replannedToKind[selectedGoal] += 1;
      this.adopt(selectedSlot, OBJECTIVE_EPOCH_STATUS.EVENT_REPLAN);
    } else {
      this.activeFrames += 1; this.epochFrameCount += 1;
      this.unsignaledHoldCount += 1; this.heldFromKind[selectedRawKind] += 1;
      this.holdMatrix[this.activeKind * LONG_OPTION.COUNT + selectedRawKind] += 1;
      this.lastStatus = OBJECTIVE_EPOCH_STATUS.UNSIGNALED_HOLD;
      this.statusCount[this.lastStatus] += 1;
    }

    this.lastExecutionRowMask = this.executionRows(engine);
    this.lastExecutionRowCount = 0;
    for (let bits = this.lastExecutionRowMask; bits; bits >>>= 1)
      this.lastExecutionRowCount += bits & 1;
    const selected = selectedRow;
    if (this.activeGeneration && this.lastExecutionRowCount) {
      this.executionSupportedCount += 1;
      this.supportedFramesByKind[this.activeKind] += 1;
      this.executionRowsByKind[this.activeKind] += this.lastExecutionRowCount;
      if (selected >= 0 && this.lastExecutionRowMask & (1 << selected)) {
        this.selectedInsideEpochCount += 1;
        this.selectedInsideByKind[this.activeKind] += 1;
      } else {
        this.selectedOutsideEpochCount += 1;
        this.selectedOutsideByKind[this.activeKind] += 1;
      }
      this.observeSearch(engine, this.lastExecutionRowMask);
    } else if (this.activeGeneration) {
      this.executionGapCount += 1; this.gapFramesByKind[this.activeKind] += 1;
      this.gapSelectedMatrix[this.activeKind * LONG_OPTION.COUNT +
        selectedRawKind] += 1;
      if (this.lastStatus === OBJECTIVE_EPOCH_STATUS.UNSIGNALED_HOLD) {
        this.statusCount[this.lastStatus] -= 1;
        this.lastStatus = OBJECTIVE_EPOCH_STATUS.EXECUTION_GAP;
        this.statusCount[this.lastStatus] += 1;
      }
    }
    this.capacityFailureCount = this.ledger.capacityFailureCount;
  }

  summary() {
    return { decisionCount: this.decisionCount, matchCount: this.matchCount,
      epochCount: this.epochCount, epochFrameCount: this.epochFrameCount,
      maximumEpochFrames: Math.max(this.maximumEpochFrames, this.activeFrames),
      continuationCount: this.continuationCount,
      crossKindContinuationCount: this.crossKindContinuationCount,
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
      lastTargetSignature: this.activeTargetSignature,
      lastTargetGeneration: this.activeTargetGeneration,
      lastExecutionRowCount: this.lastExecutionRowCount,
      lastSearchArgmax: this.lastSearchArgmax,
      statusCount: named(this.statusCount, OBJECTIVE_EPOCH_STATUS_NAME),
      adoptedByKind: named(this.adoptedByKind), heldFromKind: named(this.heldFromKind),
      replannedToKind: named(this.replannedToKind),
      executionRowsByKind: named(this.executionRowsByKind),
      supportedFramesByKind: named(this.supportedFramesByKind),
      gapFramesByKind: named(this.gapFramesByKind),
      selectedInsideByKind: named(this.selectedInsideByKind),
      selectedOutsideByKind: named(this.selectedOutsideByKind),
      searchInsideByKind: named(this.searchInsideByKind),
      searchOutsideByKind: named(this.searchOutsideByKind),
      holdMatrix: matrix(this.holdMatrix), gapSelectedMatrix: matrix(this.gapSelectedMatrix) };
  }
}

module.exports = { goalKind, SemanticObjectiveEpochShadow };
