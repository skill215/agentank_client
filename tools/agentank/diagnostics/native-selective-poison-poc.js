"use strict";

// Diagnostic-only final proposal for poison. The action generator must first
// remove CAST_POISON, so incumbentAction is the exact no-poison controller
// result. This POC may then replace only a low-opportunity close-contact
// TURN_LEFT. It never participates in search, Risk, Hard or Plan construction.

const { ACTION, HARD_STATUS, SKILL, NONE_FRAME } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { RULE } = require("../../../engine-v2/src/generated/fast-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { SUPPORT_STATUS } = require("../../../engine-v2/src/runtime/escape-obligation");
const { ROOT_CONTROL_MODE } = require("../../../engine-v2/src/runtime/root-control-mode");

class NativeSelectivePoisonPoc {
  constructor(mode = "off") {
    this.mode = mode === "active" ? "active" : mode === "shadow" ? "shadow" : "off";
    this.result = { action: ACTION.CAST_POISON, argument: 0xffff };
    this.checkCount = 0; this.evidenceCount = 0; this.wouldOverrideCount = 0;
    this.overrideCount = 0; this.sameActionCount = 0;
    this.skillBlockedCount = 0; this.supportBlockedCount = 0;
    this.modeBlockedCount = 0; this.incumbentBlockedCount = 0;
    this.visibilityBlockedCount = 0; this.distanceBlockedCount = 0;
    this.effectBlockedCount = 0; this.cadenceBlockedCount = 0;
    this.committedBlockedCount = 0; this.possibleBlockedCount = 0;
    this.stationaryHardBlockedCount = 0; this.stationaryRiskBlockedCount = 0;
    this.deadlineBlockedCount = 0;
    this.hotAllocationCount = 0;
  }

  activeEffect(until, frame) {
    return until !== NONE_FRAME && until > frame;
  }

  selectOverride(engine, incumbentAction, incumbentArgument) {
    if (this.mode === "off") return null;
    this.checkCount += 1;
    const adapter = engine && engine.adapter; const state = adapter && adapter.state;
    if (!state || !adapter.ownCanAct || !adapter.ownSkillReady ||
        state.arrays[ARRAY.TANK_SKILL][0] !== SKILL.POISON) {
      this.skillBlockedCount += 1; return null;
    }
    if (engine.lastControlMode !== ROOT_CONTROL_MODE.TACTICAL_CONTACT) {
      this.modeBlockedCount += 1; return null;
    }
    if (incumbentAction !== ACTION.TURN_LEFT) {
      this.incumbentBlockedCount += 1; return null;
    }
    if (!adapter.enemyVisible) {
      this.visibilityBlockedCount += 1; return null;
    }
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1];
    const distance = Math.abs(state.x(own) - state.x(enemy)) +
      Math.abs(state.y(own) - state.y(enemy));
    if (distance > 4) {
      this.distanceBlockedCount += 1; return null;
    }
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.activeEffect(a[ARRAY.TANK_POISON_UNTIL][1], frame) ||
        this.activeEffect(a[ARRAY.TANK_FROZEN_UNTIL][1], frame) ||
        this.activeEffect(a[ARRAY.TANK_STUN_UNTIL][1], frame)) {
      this.effectBlockedCount += 1; return null;
    }
    if (!adapter.enemyCanAct) {
      this.cadenceBlockedCount += 1; return null;
    }
    const escape = engine.escapeObligation;
    if (!escape || escape.supportStatus !== SUPPORT_STATUS.NONE ||
        escape.committedEntityCount !== 0) {
      this.committedBlockedCount += 1; return null;
    }
    if (!engine.possibleProjectiles || engine.possibleProjectiles.count() !== 0) {
      this.possibleBlockedCount += 1; return null;
    }
    let noneRow = -1;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === ACTION.NONE) { noneRow = row; break; }
    if (noneRow < 0 || engine.hardStatus[noneRow] !== HARD_STATUS.ALLOW) {
      this.stationaryHardBlockedCount += 1; return null;
    }
    const risk = engine.riskController && engine.riskController.outcome;
    if (!risk || !risk.acceptable[noneRow] || risk.dominated[noneRow]) {
      this.stationaryRiskBlockedCount += 1; return null;
    }
    if (RULE.FRAME_RECORD_LIMIT - 1 - frame <= RULE.SKILL_DURATION[SKILL.POISON]) {
      this.deadlineBlockedCount += 1; return null;
    }
    this.evidenceCount += 1; this.wouldOverrideCount += 1;
    if (this.mode !== "active") return null;
    this.overrideCount += 1; this.result.argument = incumbentArgument;
    return this.result;
  }

  summary() {
    return { enabled: this.mode !== "off", mode: this.mode,
      checkCount: this.checkCount, evidenceCount: this.evidenceCount,
      wouldOverrideCount: this.wouldOverrideCount, overrideCount: this.overrideCount,
      sameActionCount: this.sameActionCount,
      skillBlockedCount: this.skillBlockedCount,
      supportBlockedCount: this.supportBlockedCount,
      modeBlockedCount: this.modeBlockedCount,
      incumbentBlockedCount: this.incumbentBlockedCount,
      visibilityBlockedCount: this.visibilityBlockedCount,
      distanceBlockedCount: this.distanceBlockedCount,
      effectBlockedCount: this.effectBlockedCount,
      cadenceBlockedCount: this.cadenceBlockedCount,
      committedBlockedCount: this.committedBlockedCount,
      possibleBlockedCount: this.possibleBlockedCount,
      stationaryHardBlockedCount: this.stationaryHardBlockedCount,
      stationaryRiskBlockedCount: this.stationaryRiskBlockedCount,
      deadlineBlockedCount: this.deadlineBlockedCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { NativeSelectivePoisonPoc };
