"use strict";

// Diagnostic-only, event-driven Option identity ledger.  The production
// portfolio describes aliases between this frame's primitive rows and their
// purposes.  It is deliberately not used as a cross-frame identity because
// primitive actions, poses and PlanSketch signatures are allowed to change
// while one semantic Option remains active.

const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { GLOBAL_MODE, NONE_HANDLE } = require(
  "../../../engine-v2/src/abi/policy-codes");
const { OPTION_KIND } = require("../../../engine-v2/src/policy/option-portfolio");
const { LONG_OPTION, OPTION_EVENT, OPTION_NAME, EventDrivenOptionShadow } =
  require("./event-driven-option-shadow");

const LEDGER_CAPACITY = 24;
const OPTION_EXPIRY = Object.freeze({ TARGET_REPLACED: 0, TARGET_GONE: 1,
  SUPPORT_REVOKED: 2, MATCH_RESET: 3, COUNT: 4 });
const EXPIRY_NAME = Object.freeze([
  "TARGET_REPLACED", "TARGET_GONE", "SUPPORT_REVOKED", "MATCH_RESET"
]);
const TARGET_CLASS = Object.freeze({ ENEMY: 1, STAR: 2, RESOURCE: 3,
  TERMINAL: 4, COMMITTED: 5 });

function namedArray(values, names) {
  const output = {};
  for (let index = 0; index < names.length; index += 1)
    output[names[index]] = values[index];
  return output;
}

function sourceKind(kind) {
  if (kind === OPTION_KIND.COMMITTED_RESCUE) return LONG_OPTION.COMMITTED_RESCUE;
  if (kind === OPTION_KIND.DIRECT_KILL || kind === OPTION_KIND.ATTACK_SETUP)
    return LONG_OPTION.ATTACK;
  if (kind === OPTION_KIND.STAR_CONTROL) return LONG_OPTION.STAR_CONTROL;
  if (kind === OPTION_KIND.TERMINAL) return LONG_OPTION.TERMINAL;
  if (kind === OPTION_KIND.POSITION) return LONG_OPTION.POSITION;
  if (kind === OPTION_KIND.RESOURCE) return LONG_OPTION.RESOURCE;
  return LONG_OPTION.NONE;
}

// observe() performs no object or array allocation.  summary() is the only
// allocating path and is never called from a tank callback.
class StableOptionLedgerShadow {
  constructor(capacity = LEDGER_CAPACITY) {
    this.capacity = capacity;
    this.active = new Uint8Array(capacity);
    this.available = new Uint8Array(capacity);
    this.seen = new Uint8Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.generation = new Uint16Array(capacity);
    this.targetGeneration = new Uint16Array(capacity);
    this.targetSignature = new Uint32Array(capacity);
    this.createdFrame = new Uint16Array(capacity);
    this.lastSeenFrame = new Uint16Array(capacity);
    this.lastQualifiedFrame = new Uint16Array(capacity);
    this.lastContextEpoch = new Uint32Array(capacity);
    this.deadline = new Uint16Array(capacity);
    this.lastPrimitive = new Uint8Array(capacity);
    this.lastPlanSignature = new Uint32Array(capacity);

    this.createdByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.reusedByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.revalidatedByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.expiredByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.qualifiedFramesByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.selectedByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.selectedExistingByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.selectedNewByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.gapStartsByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.gapRecoveriesByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.expiryReasons = new Uint32Array(OPTION_EXPIRY.COUNT);

    this.classifier = new EventDrivenOptionShadow();
    this.decisionCount = 0; this.matchCount = 0; this.contextEpochs = 0;
    this.creationCount = 0; this.reuseCount = 0; this.revalidationCount = 0;
    this.expiryCount = 0; this.targetReplacementCount = 0;
    this.availabilityGapCount = 0; this.availabilityRecoveryCount = 0;
    this.selectedTrackedCount = 0; this.selectedExistingCount = 0;
    this.selectedNewCount = 0; this.selectedUntrackedCount = 0;
    this.selectedGenerationContinuationCount = 0;
    this.selectedGenerationSwitchCount = 0;
    this.eventGenerationSwitchCount = 0;
    this.unsignaledGenerationSwitchCount = 0;
    this.primitiveChangesWithinGeneration = 0;
    this.planSignatureChangesWithinGeneration = 0;
    this.capacityFailureCount = 0; this.hotAllocationCount = 0;
    this.selectedTargetAmbiguityCount = 0;
    this.matchGeneration = 0; this.nextOptionGeneration = 0; this.initialized = 0;
    this.previousFrame = -1; this.previousSelectedSlot = -1;
    this.previousSelectedGeneration = 0; this.previousSelectedAction = ACTION.NONE;
    this.previousSelectedPlanSignature = 0;
    this.lastSelectedSlot = -1; this.lastSelectedGeneration = 0;
    this.lastSelectedKind = LONG_OPTION.NONE; this.lastEventMask = 0;
    this.lastActiveCount = 0; this.lastAvailableCount = 0;
    this.tempTargetSignature = 0; this.tempTargetGeneration = 0;
  }

  resetMatch() {
    for (let slot = 0; slot < this.capacity; slot += 1) {
      if (this.active[slot]) this.expire(slot, OPTION_EXPIRY.MATCH_RESET);
      this.active[slot] = 0; this.available[slot] = 0; this.seen[slot] = 0;
    }
    this.matchGeneration = (this.matchGeneration + 1) & 0xffff;
    if (!this.matchGeneration) this.matchGeneration = 1;
    this.previousSelectedSlot = -1; this.previousSelectedGeneration = 0;
    this.previousSelectedAction = ACTION.NONE; this.previousSelectedPlanSignature = 0;
  }

  planSignature(engine, row) {
    if (row < 0 || !engine.planSketchHandle || !engine.policy ||
        !engine.policy.sketches) return 0;
    const handle = engine.planSketchHandle[row]; const sketches = engine.policy.sketches;
    return handle === NONE_HANDLE || handle >= sketches.used ? 0 :
      sketches.targetSignature[handle] >>> 0;
  }

  resourceClass(action) {
    return action === ACTION.THROW_BOMB ? 1 : action >= ACTION.CAST_SHIELD ?
      (action & 0xff) + 1 : 0;
  }

  deriveTarget(engine, kind, row, action, sourceIndex = -1) {
    const a = engine.adapter.state.arrays;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (kind === LONG_OPTION.COMMITTED_RESCUE) {
      this.tempTargetSignature = this.classifier.targetSignature(engine, kind, row, action);
      this.tempTargetGeneration = this.tempTargetSignature & 0xffff;
      return;
    }
    if (kind === LONG_OPTION.ATTACK || kind === LONG_OPTION.STRICT_PROOF) {
      this.tempTargetSignature = (TARGET_CLASS.ENEMY << 28) | 1;
      this.tempTargetGeneration = this.matchGeneration;
      return;
    }
    if (kind === LONG_OPTION.RESOURCE) {
      this.tempTargetSignature = (TARGET_CLASS.RESOURCE << 28) |
        this.resourceClass(action);
      this.tempTargetGeneration = this.matchGeneration;
      return;
    }
    if (kind === LONG_OPTION.STAR_CONTROL) {
      this.tempTargetSignature = (TARGET_CLASS.STAR << 28) |
        (this.classifier.starGeneration & 0x0fffffff);
      this.tempTargetGeneration = this.classifier.starGeneration & 0xffff;
      return;
    }
    if (kind === LONG_OPTION.TERMINAL) {
      this.tempTargetSignature = (TARGET_CLASS.TERMINAL << 28) |
        (engine.rootGlobalMode() & 0xff);
      this.tempTargetGeneration = this.matchGeneration;
      return;
    }
    if (kind === LONG_OPTION.POSITION) {
      const portfolio = engine.optionPortfolio;
      const target = sourceIndex >= 0 && portfolio ?
        portfolio.targetCell[sourceIndex] : star !== NONE_CELL ? star :
          engine.adapter.enemyVisible ? a[ARRAY.TANK_CELL][1] : NONE_CELL;
      if (star !== NONE_CELL && target === star) {
        this.tempTargetSignature = (TARGET_CLASS.STAR << 28) |
          (this.classifier.starGeneration & 0x0fffffff);
        this.tempTargetGeneration = this.classifier.starGeneration & 0xffff;
      } else {
        this.tempTargetSignature = target === NONE_CELL ? 0 :
          (TARGET_CLASS.ENEMY << 28) | 1;
        this.tempTargetGeneration = this.matchGeneration;
      }
      return;
    }
    this.tempTargetSignature = 0; this.tempTargetGeneration = 0;
  }

  expire(slot, reason) {
    if (!this.active[slot]) return;
    const kind = this.kind[slot];
    this.active[slot] = 0; this.available[slot] = 0; this.seen[slot] = 0;
    this.expiryCount += 1; this.expiredByKind[kind] += 1;
    this.expiryReasons[reason] += 1;
  }

  slotFor(kind, signature, targetGeneration) {
    for (let slot = 0; slot < this.capacity; slot += 1)
      if (this.active[slot] && this.kind[slot] === kind &&
          this.targetSignature[slot] === signature &&
          this.targetGeneration[slot] === targetGeneration) return slot;
    return -1;
  }

  allocate(kind, signature, targetGeneration, frame, event, deadline) {
    let slot = -1;
    for (let at = 0; at < this.capacity; at += 1)
      if (!this.active[at]) { slot = at; break; }
    if (slot < 0) { this.capacityFailureCount += 1; return -1; }
    let replaced = 0;
    for (let at = 0; at < this.capacity; at += 1)
      if (this.active[at] && this.kind[at] === kind &&
          this.targetSignature[at] !== signature) { replaced = 1; break; }
    this.nextOptionGeneration = (this.nextOptionGeneration + 1) & 0xffff;
    if (!this.nextOptionGeneration) this.nextOptionGeneration = 1;
    this.generation[slot] = this.nextOptionGeneration;
    this.active[slot] = 1; this.available[slot] = 1; this.seen[slot] = 1;
    this.kind[slot] = kind; this.targetSignature[slot] = signature;
    this.targetGeneration[slot] = targetGeneration;
    this.createdFrame[slot] = frame; this.lastSeenFrame[slot] = frame;
    this.lastQualifiedFrame[slot] = frame;
    this.lastContextEpoch[slot] = this.classifier.contextEpoch;
    this.deadline[slot] = deadline;
    this.lastPrimitive[slot] = ACTION.NONE; this.lastPlanSignature[slot] = 0;
    this.creationCount += 1; this.createdByKind[kind] += 1;
    if (replaced) this.targetReplacementCount += 1;
    if (event) { this.revalidationCount += 1; this.revalidatedByKind[kind] += 1; }
    return slot;
  }

  qualify(engine, kind, row, action, sourceIndex, frame, event) {
    this.deriveTarget(engine, kind, row, action, sourceIndex);
    const signature = this.tempTargetSignature;
    const targetGeneration = this.tempTargetGeneration;
    if (!signature && kind !== LONG_OPTION.COMMITTED_RESCUE) return -1;
    let slot = this.slotFor(kind, signature, targetGeneration);
    const portfolio = engine.optionPortfolio;
    const deadline = sourceIndex >= 0 && portfolio ? portfolio.deadline[sourceIndex] : 0xffff;
    if (slot < 0) slot = this.allocate(kind, signature, targetGeneration,
      frame, event, deadline);
    else {
      if (!this.seen[slot]) {
        this.reuseCount += 1; this.reusedByKind[kind] += 1;
        if (event && this.lastContextEpoch[slot] !== this.classifier.contextEpoch) {
          this.revalidationCount += 1; this.revalidatedByKind[kind] += 1;
        }
        if (!this.available[slot]) {
          this.availabilityRecoveryCount += 1;
          this.gapRecoveriesByKind[kind] += 1;
        }
      }
      this.seen[slot] = 1; this.available[slot] = 1;
      this.lastSeenFrame[slot] = frame; this.lastQualifiedFrame[slot] = frame;
      this.lastContextEpoch[slot] = this.classifier.contextEpoch;
      this.deadline[slot] = deadline;
    }
    return slot;
  }

  stillValid(engine, slot) {
    const kind = this.kind[slot]; const a = engine.adapter.state.arrays;
    if (kind === LONG_OPTION.COMMITTED_RESCUE || kind === LONG_OPTION.STRICT_PROOF)
      return 0;
    if (kind === LONG_OPTION.ATTACK)
      return a[ARRAY.TANK_CRASH][1] ? 0 : 1;
    if (kind === LONG_OPTION.STAR_CONTROL)
      return a[ARRAY.SCALAR][SCALAR.STAR_CELL] !== NONE_CELL &&
        this.targetGeneration[slot] === (this.classifier.starGeneration & 0xffff);
    if (kind === LONG_OPTION.TERMINAL)
      return engine.rootGlobalMode() !== GLOBAL_MODE.NORMAL &&
        (this.targetSignature[slot] & 0xff) === (engine.rootGlobalMode() & 0xff);
    if (kind === LONG_OPTION.RESOURCE) {
      const resource = this.targetSignature[slot] & 0xff;
      return resource === 1 ? engine.adapter.ownBombReady ? 1 : 0 :
        engine.adapter.ownSkillReady ? 1 : 0;
    }
    if (kind === LONG_OPTION.POSITION) {
      const targetClass = this.targetSignature[slot] >>> 28;
      return targetClass === TARGET_CLASS.STAR ?
        a[ARRAY.SCALAR][SCALAR.STAR_CELL] !== NONE_CELL &&
          this.targetGeneration[slot] === (this.classifier.starGeneration & 0xffff) :
        a[ARRAY.TANK_CRASH][1] ? 0 : 1;
    }
    return 0;
  }

  selectedSlotFor(engine, selectedKind, selectedRow, selectedAction) {
    const portfolio = engine.optionPortfolio;
    let selectedSlot = -1; let ambiguous = 0;
    if (portfolio && selectedRow >= 0) {
      for (let at = 0; at < portfolio.count; at += 1) {
        if (portfolio.primitiveRow[at] !== selectedRow ||
            !portfolio.supportComplete[at] ||
            sourceKind(portfolio.kind[at]) !== selectedKind ||
            !this.classifier.purposeComplete(
              engine, selectedKind, selectedRow, selectedAction)) continue;
        this.deriveTarget(engine, selectedKind, selectedRow, selectedAction, at);
        const slot = this.slotFor(selectedKind, this.tempTargetSignature,
          this.tempTargetGeneration);
        if (slot < 0) continue;
        if (selectedSlot < 0) selectedSlot = slot;
        else if (selectedSlot !== slot) ambiguous = 1;
      }
      if (ambiguous) {
        this.selectedTargetAmbiguityCount += 1; return -1;
      }
      if (selectedSlot >= 0) return selectedSlot;
    }
    this.deriveTarget(engine, selectedKind, selectedRow, selectedAction, -1);
    return this.slotFor(selectedKind, this.tempTargetSignature,
      this.tempTargetGeneration);
  }

  availableGeneration(kind) {
    for (let slot = 0; slot < this.capacity; slot += 1)
      if (this.active[slot] && this.available[slot] && this.kind[slot] === kind)
        return this.generation[slot];
    return 0;
  }

  observe(engine, emittedAction) {
    if (!engine || !engine.adapter || !engine.adapter.state) return;
    const frame = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const wasInitialized = this.initialized;
    const continuing = wasInitialized && frame > this.previousFrame;
    this.classifier.observe(engine, emittedAction);
    const event = this.classifier.lastEventMask;
    if (event & OPTION_EVENT.MATCH_START) {
      this.resetMatch(); this.matchCount += 1; this.initialized = 1;
    }
    this.previousFrame = frame; this.decisionCount += 1;
    this.contextEpochs = this.classifier.contextEpoch; this.lastEventMask = event;
    this.seen.fill(0);

    const risk = engine.riskController && engine.riskController.outcome;
    const portfolio = engine.optionPortfolio; const forced = this.classifier.forcedWinRow(engine);
    let qualifiedMask = 0;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (engine.hardStatus[row] !== HARD_STATUS.ALLOW || !risk || row >= risk.count ||
          !risk.acceptable[row] || risk.dominated[row]) continue;
      const action = engine.ourActions[row];
      if (row === forced && engine.lastProofStatus === PROOF_STATUS.PROVEN) {
        this.qualify(engine, LONG_OPTION.STRICT_PROOF, row, action, -1,
          frame, event); qualifiedMask |= 1 << LONG_OPTION.STRICT_PROOF;
      }
      if (!portfolio) continue;
      for (let at = 0; at < portfolio.count; at += 1) {
        if (portfolio.primitiveRow[at] !== row || !portfolio.supportComplete[at]) continue;
        const kind = sourceKind(portfolio.kind[at]);
        if (kind === LONG_OPTION.NONE ||
            !this.classifier.purposeComplete(engine, kind, row, action)) continue;
        this.qualify(engine, kind, row, action, at, frame, event);
        qualifiedMask |= 1 << kind;
      }
    }
    for (let kind = 1; kind < LONG_OPTION.COUNT; kind += 1)
      if (qualifiedMask & (1 << kind)) this.qualifiedFramesByKind[kind] += 1;

    for (let slot = 0; slot < this.capacity; slot += 1) {
      if (!this.active[slot] || this.seen[slot]) continue;
      if (!this.stillValid(engine, slot)) {
        this.expire(slot, this.kind[slot] === LONG_OPTION.COMMITTED_RESCUE ||
          this.kind[slot] === LONG_OPTION.STRICT_PROOF ?
          OPTION_EXPIRY.SUPPORT_REVOKED : OPTION_EXPIRY.TARGET_GONE);
      } else if (this.available[slot]) {
        this.available[slot] = 0; this.availabilityGapCount += 1;
        this.gapStartsByKind[this.kind[slot]] += 1;
      }
    }

    const selectedRow = this.classifier.selectedRow(engine, emittedAction);
    const selectedKind = this.classifier.classifyRow(engine, selectedRow, forced);
    const selectedAction = selectedRow < 0 ? emittedAction : engine.ourActions[selectedRow];
    const selectedSlot = this.selectedSlotFor(engine, selectedKind,
      selectedRow, selectedAction);
    const selectedGeneration = selectedSlot < 0 ? 0 : this.generation[selectedSlot];
    const planSignature = this.planSignature(engine, selectedRow);
    this.selectedByKind[selectedKind] += 1; this.lastSelectedKind = selectedKind;
    this.lastSelectedSlot = selectedSlot; this.lastSelectedGeneration = selectedGeneration;
    if (selectedSlot < 0 || !this.available[selectedSlot]) this.selectedUntrackedCount += 1;
    else {
      this.selectedTrackedCount += 1;
      if (this.createdFrame[selectedSlot] === frame) {
        this.selectedNewCount += 1; this.selectedNewByKind[selectedKind] += 1;
      } else {
        this.selectedExistingCount += 1; this.selectedExistingByKind[selectedKind] += 1;
      }
      if (continuing && this.previousSelectedSlot === selectedSlot &&
          this.previousSelectedGeneration === selectedGeneration) {
        this.selectedGenerationContinuationCount += 1;
        if (selectedAction !== this.previousSelectedAction)
          this.primitiveChangesWithinGeneration += 1;
        if (planSignature !== this.previousSelectedPlanSignature)
          this.planSignatureChangesWithinGeneration += 1;
      } else if (continuing && this.previousSelectedGeneration) {
        this.selectedGenerationSwitchCount += 1;
        if (event) this.eventGenerationSwitchCount += 1;
        else this.unsignaledGenerationSwitchCount += 1;
      }
      this.lastPrimitive[selectedSlot] = selectedAction;
      this.lastPlanSignature[selectedSlot] = planSignature;
    }
    this.previousSelectedSlot = selectedSlot;
    this.previousSelectedGeneration = selectedGeneration;
    this.previousSelectedAction = selectedAction;
    this.previousSelectedPlanSignature = planSignature;

    let active = 0; let available = 0;
    for (let slot = 0; slot < this.capacity; slot += 1)
      if (this.active[slot]) { active += 1; available += this.available[slot] ? 1 : 0; }
    this.lastActiveCount = active; this.lastAvailableCount = available;
  }

  summary() {
    return {
      decisionCount: this.decisionCount, matchCount: this.matchCount,
      contextEpochs: this.contextEpochs, creationCount: this.creationCount,
      reuseCount: this.reuseCount, revalidationCount: this.revalidationCount,
      expiryCount: this.expiryCount, targetReplacementCount: this.targetReplacementCount,
      availabilityGapCount: this.availabilityGapCount,
      availabilityRecoveryCount: this.availabilityRecoveryCount,
      selectedTrackedCount: this.selectedTrackedCount,
      selectedExistingCount: this.selectedExistingCount,
      selectedNewCount: this.selectedNewCount,
      selectedUntrackedCount: this.selectedUntrackedCount,
      selectedGenerationContinuationCount: this.selectedGenerationContinuationCount,
      selectedGenerationSwitchCount: this.selectedGenerationSwitchCount,
      eventGenerationSwitchCount: this.eventGenerationSwitchCount,
      unsignaledGenerationSwitchCount: this.unsignaledGenerationSwitchCount,
      primitiveChangesWithinGeneration: this.primitiveChangesWithinGeneration,
      planSignatureChangesWithinGeneration: this.planSignatureChangesWithinGeneration,
      capacityFailureCount: this.capacityFailureCount,
      selectedTargetAmbiguityCount: this.selectedTargetAmbiguityCount,
      hotAllocationCount: this.hotAllocationCount,
      lastActiveCount: this.lastActiveCount, lastAvailableCount: this.lastAvailableCount,
      lastSelectedKind: this.lastSelectedKind,
      lastSelectedGeneration: this.lastSelectedGeneration,
      lastEventMask: this.lastEventMask,
      createdByKind: namedArray(this.createdByKind, OPTION_NAME),
      reusedByKind: namedArray(this.reusedByKind, OPTION_NAME),
      revalidatedByKind: namedArray(this.revalidatedByKind, OPTION_NAME),
      expiredByKind: namedArray(this.expiredByKind, OPTION_NAME),
      qualifiedFramesByKind: namedArray(this.qualifiedFramesByKind, OPTION_NAME),
      selectedByKind: namedArray(this.selectedByKind, OPTION_NAME),
      selectedExistingByKind: namedArray(this.selectedExistingByKind, OPTION_NAME),
      selectedNewByKind: namedArray(this.selectedNewByKind, OPTION_NAME),
      gapStartsByKind: namedArray(this.gapStartsByKind, OPTION_NAME),
      gapRecoveriesByKind: namedArray(this.gapRecoveriesByKind, OPTION_NAME),
      expiryReasons: namedArray(this.expiryReasons, EXPIRY_NAME),
      rawPlanSignatureSwitchCount: this.classifier.planSignatureSwitchCount,
      rawUnsignaledPlanSignatureSwitchCount:
        this.classifier.unsignaledPlanSignatureSwitchCount
    };
  }
}

module.exports = { LEDGER_CAPACITY, OPTION_EXPIRY, EXPIRY_NAME, TARGET_CLASS,
  StableOptionLedgerShadow };
