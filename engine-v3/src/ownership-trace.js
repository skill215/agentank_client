"use strict";

const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { V3_COMPONENT_ABI, V3_SLOT, V3_SLOT_COUNT, actionFromLegacy } =
  require("./contracts");

const OWNERSHIP_STAGE = Object.freeze({
  NONE: 0,
  VISIBLE_BOMB_SAFETY: 1,
  VISIBLE_PROJECTILE_SAFETY: 2,
  PROJECTILE_ESCAPE: 3,
  HIDDEN_ATTACK: 4,
  DIRECT_ATTACK: 5,
  PREEMPTIVE_SAFETY: 6,
  INLINE_STABILITY: 7,
  TACTICAL_SEARCH: 8,
  NAVIGATION: 9,
  FINAL_ACTION_GATE: 10,
  UNATTRIBUTED: 11
});

const OWNERSHIP_STAGE_NAMES = Object.freeze([
  "NONE",
  "VISIBLE_BOMB_SAFETY",
  "VISIBLE_PROJECTILE_SAFETY",
  "PROJECTILE_ESCAPE",
  "HIDDEN_ATTACK",
  "DIRECT_ATTACK",
  "PREEMPTIVE_SAFETY",
  "INLINE_STABILITY",
  "TACTICAL_SEARCH",
  "NAVIGATION",
  "FINAL_ACTION_GATE",
  "UNATTRIBUTED"
]);

const SLOT_TO_STAGE = new Int8Array(V3_SLOT_COUNT);
SLOT_TO_STAGE[V3_SLOT.VISIBLE_BOMB_SAFETY] = OWNERSHIP_STAGE.VISIBLE_BOMB_SAFETY;
SLOT_TO_STAGE[V3_SLOT.VISIBLE_PROJECTILE_SAFETY] =
  OWNERSHIP_STAGE.VISIBLE_PROJECTILE_SAFETY;
SLOT_TO_STAGE[V3_SLOT.PROJECTILE_ESCAPE] = OWNERSHIP_STAGE.PROJECTILE_ESCAPE;
SLOT_TO_STAGE[V3_SLOT.HIDDEN_ATTACK] = OWNERSHIP_STAGE.HIDDEN_ATTACK;
SLOT_TO_STAGE[V3_SLOT.DIRECT_ATTACK] = OWNERSHIP_STAGE.DIRECT_ATTACK;
SLOT_TO_STAGE[V3_SLOT.PREEMPTIVE_SAFETY] = OWNERSHIP_STAGE.PREEMPTIVE_SAFETY;
SLOT_TO_STAGE[V3_SLOT.TACTICAL_SEARCH] = OWNERSHIP_STAGE.TACTICAL_SEARCH;
SLOT_TO_STAGE[V3_SLOT.NAVIGATION] = OWNERSHIP_STAGE.NAVIGATION;
SLOT_TO_STAGE[V3_SLOT.FINAL_ACTION_GATE] = OWNERSHIP_STAGE.FINAL_ACTION_GATE;

function actionResult(slot, value) {
  if (slot === V3_SLOT.VISIBLE_BOMB_SAFETY ||
      slot === V3_SLOT.VISIBLE_PROJECTILE_SAFETY ||
      slot === V3_SLOT.PROJECTILE_ESCAPE ||
      slot === V3_SLOT.HIDDEN_ATTACK ||
      slot === V3_SLOT.DIRECT_ATTACK ||
      slot === V3_SLOT.PREEMPTIVE_SAFETY ||
      slot === V3_SLOT.TACTICAL_SEARCH ||
      slot === V3_SLOT.FINAL_ACTION_GATE)
    return actionFromLegacy(value);
  return ACTION.NONE;
}

// Diagnostic-only ownership observer. It never returns an action and never
// changes the wrapped component result. All per-frame state is fixed storage.
class V1OwnershipTrace {
  constructor() {
    this.stack = new Int8Array(V3_SLOT_COUNT + 2);
    this.returnedAction = new Uint8Array(V3_SLOT_COUNT);
    this.called = new Uint8Array(V3_SLOT_COUNT);
    this.stageCounts = new Uint32Array(OWNERSHIP_STAGE_NAMES.length);
    this.actionCounts = new Uint32Array(16);
    this.stageStream = new Uint8Array(128);
    this.actionStream = new Uint8Array(128);
    this.streamUsed = 0;
    this.depth = 0;
    this.frame = -1;
    this.decisionCount = 0;
    this.emissionCount = 0;
    this.finalOverrideCount = 0;
    this.inlineStabilityCount = 0;
    this.unattributedCount = 0;
    this.pendingStage = OWNERSHIP_STAGE.NONE;
    this.pendingAction = ACTION.NONE;
    this.requestedAction = ACTION.NONE;
    this.resolvedAction = ACTION.NONE;
    this.selectedStage = OWNERSHIP_STAGE.NONE;
    this.emitted = 0;
    this.hotAllocationCount = 0;
  }

  beginDecision(frame = -1) {
    this.called.fill(0);
    this.returnedAction.fill(ACTION.NONE);
    this.depth = 0;
    this.frame = frame | 0;
    this.pendingStage = OWNERSHIP_STAGE.NONE;
    this.pendingAction = ACTION.NONE;
    this.requestedAction = ACTION.NONE;
    this.resolvedAction = ACTION.NONE;
    this.selectedStage = OWNERSHIP_STAGE.NONE;
    this.emitted = 0;
    this.decisionCount += 1;
  }

  enter(slot) {
    this.called[slot] = 1;
    if (this.depth < this.stack.length) this.stack[this.depth++] = slot;
  }

  leave() {
    if (this.depth > 0) this.depth -= 1;
  }

  activeProducer() {
    for (let at = this.depth - 1; at >= 0; at -= 1) {
      const stage = SLOT_TO_STAGE[this.stack[at]];
      if (stage && stage !== OWNERSHIP_STAGE.FINAL_ACTION_GATE) return stage;
    }
    return OWNERSHIP_STAGE.NONE;
  }

  recordRequested(token) {
    this.requestedAction = actionFromLegacy(token);
    let stage = this.activeProducer();
    if (!stage) stage = this.pendingStage;
    // The only direct executeAction call in frozen V1 without an action-return
    // port or an enclosing navigation call is its inline turn-streak guard.
    if (!stage && this.requestedAction === ACTION.GO &&
        !this.called[V3_SLOT.TACTICAL_CONTACT] &&
        !this.called[V3_SLOT.NAVIGATION]) {
      stage = OWNERSHIP_STAGE.INLINE_STABILITY;
      this.inlineStabilityCount += 1;
    }
    if (!stage) {
      stage = OWNERSHIP_STAGE.UNATTRIBUTED;
      this.unattributedCount += 1;
    }
    this.selectedStage = stage;
    this.emitted = 1;
  }

  recordReturn(slot, value, requested) {
    if (slot === V3_SLOT.ACTION_EMIT) return;
    const action = actionResult(slot, value);
    this.returnedAction[slot] = action;
    if (slot === V3_SLOT.FINAL_ACTION_GATE) {
      this.resolvedAction = action;
      const before = actionFromLegacy(requested);
      if (action !== ACTION.NONE && action !== before) {
        this.selectedStage = OWNERSHIP_STAGE.FINAL_ACTION_GATE;
        this.finalOverrideCount += 1;
      }
      return;
    }
    const stage = SLOT_TO_STAGE[slot];
    if (stage && action !== ACTION.NONE) {
      this.pendingStage = stage;
      this.pendingAction = action;
    }
  }

  finishDecision(actualAction = ACTION.NONE) {
    if (!this.emitted && actualAction !== ACTION.NONE) {
      this.selectedStage = OWNERSHIP_STAGE.UNATTRIBUTED;
      this.unattributedCount += 1;
    }
    if (actualAction !== ACTION.NONE) this.resolvedAction = actualAction;
    if (this.selectedStage < this.stageCounts.length)
      this.stageCounts[this.selectedStage] += 1;
    if (this.resolvedAction < this.actionCounts.length)
      this.actionCounts[this.resolvedAction] += 1;
    if (this.streamUsed < this.stageStream.length) {
      this.stageStream[this.streamUsed] = this.selectedStage;
      this.actionStream[this.streamUsed] = this.resolvedAction;
      this.streamUsed += 1;
    }
    if (this.emitted) this.emissionCount += 1;
    return this.selectedStage;
  }

  frameSnapshot() {
    return {
      frame: this.frame,
      stage: this.selectedStage,
      stageName: OWNERSHIP_STAGE_NAMES[this.selectedStage],
      requestedAction: this.requestedAction,
      resolvedAction: this.resolvedAction,
      finalOverride: this.selectedStage === OWNERSHIP_STAGE.FINAL_ACTION_GATE,
      emitted: Boolean(this.emitted)
    };
  }

  summary() {
    const stages = {};
    for (let stage = 0; stage < OWNERSHIP_STAGE_NAMES.length; stage += 1)
      stages[OWNERSHIP_STAGE_NAMES[stage]] = this.stageCounts[stage];
    return {
      decisionCount: this.decisionCount,
      emissionCount: this.emissionCount,
      finalOverrideCount: this.finalOverrideCount,
      inlineStabilityCount: this.inlineStabilityCount,
      unattributedCount: this.unattributedCount,
      hotAllocationCount: this.hotAllocationCount,
      streamUsed: this.streamUsed,
      stageStream: Buffer.from(this.stageStream.subarray(0, this.streamUsed)).toString("base64"),
      actionStream: Buffer.from(this.actionStream.subarray(0, this.streamUsed)).toString("base64"),
      stages
    };
  }
}

class OwnershipTraceComponent {
  constructor(slot, inner, trace) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = slot;
    this.inner = inner;
    this.trace = trace;
    this.id = `TRACE_${inner.id || slot}`;
  }

  invoke(call) {
    this.trace.enter(this.slot);
    if (this.slot === V3_SLOT.ACTION_EMIT)
      this.trace.recordRequested(call.requestedAction);
    let value;
    try {
      value = this.inner.invoke(call);
      this.trace.recordReturn(this.slot, value, call.requestedAction);
      return value;
    } finally {
      this.trace.leave();
    }
  }

  summary() {
    return typeof this.inner.summary === "function" ? this.inner.summary() : null;
  }
}

module.exports = { OWNERSHIP_STAGE, OWNERSHIP_STAGE_NAMES, V1OwnershipTrace,
  OwnershipTraceComponent };
