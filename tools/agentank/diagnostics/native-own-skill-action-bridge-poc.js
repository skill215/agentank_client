"use strict";

// Diagnostic-only repair for the asymmetric production root domain.  The
// production V2 tank owns poison, so ProductionRoot historically generated
// only CAST_POISON for our side even when a symmetric-skill arena supplied a
// different observed skill.  This bridge lets the native BasePolicy POC test
// the actual observed scalar skill without changing production semantics.

const { ACTION, SKILL, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");

const METHOD_BY_SKILL = Object.freeze([
  "", "shield", "freeze", "stun", "overload", "cloak", "poison", "teleport", "boost"
]);

function scalarSkillAction(skill) {
  return skill >= SKILL.SHIELD && skill <= SKILL.BOOST && skill !== SKILL.TELEPORT ?
    ACTION.CAST_SHIELD + skill - SKILL.SHIELD : ACTION.NONE;
}

class NativeOwnSkillActionBridgePoc {
  constructor(mode = "off") {
    this.mode = mode === "active" ? "active" : mode === "shadow" ? "shadow" :
      mode === "suppress-poison" ? "suppress-poison" :
      mode === "suppress-poison-opening" ? "suppress-poison-opening" :
      mode === "suppress-poison-distant" ? "suppress-poison-distant" : "off";
    this.installed = 0; this.generateCount = 0; this.eligibleCount = 0;
    this.missingCount = 0; this.insertedCount = 0; this.alreadyGeneratedCount = 0;
    this.unsupportedTargetCount = 0; this.capacityFailureCount = 0;
    this.suppressedPoisonCount = 0; this.retainedPoisonCount = 0;
    this.openingSuppressionCount = 0; this.distantSuppressionCount = 0;
    this.emitCount = 0; this.emitFallbackCount = 0; this.hotAllocationCount = 0;
  }

  suppressesPoison(state) {
    if (this.mode === "suppress-poison") return true;
    if (!state) return false;
    if (this.mode === "suppress-poison-opening")
      return state.arrays[ARRAY.SCALAR][SCALAR.FRAME] === 0;
    if (this.mode !== "suppress-poison-distant") return false;
    const own = state.arrays[ARRAY.TANK_CELL][0];
    const enemy = state.arrays[ARRAY.TANK_CELL][1];
    if (own === NONE_CELL || enemy === NONE_CELL) return false;
    return Math.abs(state.x(own) - state.x(enemy)) +
      Math.abs(state.y(own) - state.y(enemy)) > 9;
  }

  emitObservedSkill(engine, me, action, argument, fallback) {
    if (this.mode === "active" && engine.adapter && engine.adapter.state) {
      const skill = engine.adapter.state.arrays[ARRAY.TANK_SKILL][0];
      const expected = scalarSkillAction(skill); const method = METHOD_BY_SKILL[skill];
      if (action === expected && action !== ACTION.CAST_POISON &&
          method && me && typeof me[method] === "function") {
        me[method](); engine.adapter.recordEmission(action, argument);
        this.emitCount += 1; return action;
      }
      if (action === expected && action !== ACTION.CAST_POISON)
        this.emitFallbackCount += 1;
    }
    return fallback(me, action, argument);
  }

  install(engine) {
    if (!engine || this.installed || this.mode === "off") return 0;
    const originalGenerate = engine.generateActions.bind(engine);
    const originalEmit = engine.emit.bind(engine);
    const bridge = this;
    engine.generateActions = function generateActionsWithObservedOwnSkill() {
      originalGenerate(); bridge.generateCount += 1;
      if (bridge.mode.startsWith("suppress-poison")) {
        const state = this.adapter && this.adapter.state;
        if (!bridge.suppressesPoison(state)) {
          bridge.retainedPoisonCount += 1; return;
        }
        for (let row = 0; row < this.ourCount; row += 1) {
          if (this.ourActions[row] !== ACTION.CAST_POISON) continue;
          for (let next = row + 1; next < this.ourCount; next += 1) {
            this.ourActions[next - 1] = this.ourActions[next];
            this.ourArguments[next - 1] = this.ourArguments[next];
          }
          this.ourCount -= 1; bridge.suppressedPoisonCount += 1;
          if (bridge.mode === "suppress-poison-opening")
            bridge.openingSuppressionCount += 1;
          else if (bridge.mode === "suppress-poison-distant")
            bridge.distantSuppressionCount += 1;
          this.createPlanSketches();
          break;
        }
        return;
      }
      const state = this.adapter && this.adapter.state;
      if (!state || !this.adapter.ownCanAct || !this.adapter.ownSkillReady ||
          this.diagnosticDisableResourceActions) return;
      const skill = state.arrays[ARRAY.TANK_SKILL][0];
      const action = scalarSkillAction(skill);
      if (skill === SKILL.TELEPORT) { bridge.unsupportedTargetCount += 1; return; }
      if (action === ACTION.NONE) return;
      bridge.eligibleCount += 1;
      for (let row = 0; row < this.ourCount; row += 1)
        if (this.ourActions[row] === action) {
          bridge.alreadyGeneratedCount += 1; return;
        }
      bridge.missingCount += 1;
      if (bridge.mode !== "active") return;
      if (this.ourCount >= this.ourActions.length) {
        bridge.capacityFailureCount += 1; return;
      }
      let noneRow = this.ourCount - 1;
      if (noneRow < 0 || this.ourActions[noneRow] !== ACTION.NONE)
        noneRow = this.ourCount;
      if (noneRow < this.ourCount) {
        this.ourActions[this.ourCount] = ACTION.NONE;
        this.ourArguments[this.ourCount] = NONE_CELL;
      }
      this.ourActions[noneRow] = action;
      this.ourArguments[noneRow] = NONE_CELL;
      this.ourCount += 1; bridge.insertedCount += 1;
      // The original call already built sketches. Rebuild from the amended
      // fixed action arrays so the new resource row has the same contracts as
      // every other generated row.
      this.createPlanSketches();
    };
    engine.diagnosticReplacementEmitter = function emitReplacementObservedSkill(
      me, action, argument, fallback) {
      return bridge.emitObservedSkill(this, me, action, argument, fallback);
    };
    engine.emit = function emitObservedOwnSkill(me, action, argument = NONE_CELL) {
      return bridge.emitObservedSkill(this, me, action, argument, originalEmit);
    };
    this.installed = 1; return 1;
  }

  summary() {
    return { enabled: this.mode !== "off", mode: this.mode,
      installed: this.installed, generateCount: this.generateCount,
      eligibleCount: this.eligibleCount, missingCount: this.missingCount,
      insertedCount: this.insertedCount,
      alreadyGeneratedCount: this.alreadyGeneratedCount,
      unsupportedTargetCount: this.unsupportedTargetCount,
      capacityFailureCount: this.capacityFailureCount,
      suppressedPoisonCount: this.suppressedPoisonCount,
      retainedPoisonCount: this.retainedPoisonCount,
      openingSuppressionCount: this.openingSuppressionCount,
      distantSuppressionCount: this.distantSuppressionCount,
      emitCount: this.emitCount, emitFallbackCount: this.emitFallbackCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { scalarSkillAction, NativeOwnSkillActionBridgePoc };
