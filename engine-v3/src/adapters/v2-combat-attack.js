"use strict";

const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { V3_COMPONENT_ABI, V3_COMPONENT_MODE, V3_RESULT_STATUS,
  V3_PROPOSAL_CLASS, V3_EVIDENCE, V3_SLOT, actionFromLegacy,
  actionToLegacy } = require("../contracts");
const { ComponentResult } = require("../component-result");
const { PAC_STATUS } = require("../../../engine-v2/src/search/projectile-attack-closure");

class V2CombatAttackOwner {
  constructor(bridge, mode = V3_COMPONENT_MODE.SHADOW) {
    this.bridge = bridge;
    this.mode = mode;
    this.results = new Array(2);
    this.results[0] = new ComponentResult(bridge.proposals, V3_SLOT.DIRECT_ATTACK,
      mode === V3_COMPONENT_MODE.ACTIVE);
    this.results[1] = new ComponentResult(bridge.proposals, V3_SLOT.TACTICAL_SEARCH,
      mode === V3_COMPONENT_MODE.ACTIVE);
    this.result = this.results[0];
    this.evaluatedFrame = -1;
    this.selected = -1;
    this.supportComplete = false;
    this.callCount = 0;
    this.evaluationCount = 0;
    this.proposalCount = 0;
    this.overrideCount = 0;
    this.directKillCount = 0;
    this.possibleHitCount = 0;
    this.purposeMissingCount = 0;
    this.riskBlockedCount = 0;
    this.selfEscapeBlockedCount = 0;
    this.counterExposureBlockedCount = 0;
    this.noEnemyReductionCount = 0;
    this.verifiedCount = 0;
  }

  better(left, right) {
    if (right < 0) return true;
    const vector = this.bridge.engine.combat.vector;
    if (vector.directKill[left] !== vector.directKill[right])
      return vector.directKill[left] > vector.directKill[right];
    if (vector.enemyDoomedFirstActions[left] !== vector.enemyDoomedFirstActions[right])
      return vector.enemyDoomedFirstActions[left] > vector.enemyDoomedFirstActions[right];
    if (vector.robustPressure[left] !== vector.robustPressure[right])
      return vector.robustPressure[left] > vector.robustPressure[right];
    if (vector.pressureValue[left] !== vector.pressureValue[right])
      return vector.pressureValue[left] > vector.pressureValue[right];
    if (vector.purposeCompleteness[left] !== vector.purposeCompleteness[right])
      return vector.purposeCompleteness[left] > vector.purposeCompleteness[right];
    if (vector.ownCounterExposure[left] !== vector.ownCounterExposure[right])
      return vector.ownCounterExposure[left] < vector.ownCounterExposure[right];
    return left < right;
  }

  evaluate() {
    const bridge = this.bridge;
    if (this.evaluatedFrame === bridge.frame) return this.selected;
    this.evaluatedFrame = bridge.frame; this.selected = -1; this.supportComplete = false;
    if (!bridge.prepared || !bridge.bundle || !bridge.supportComplete ||
        !bridge.engine.adapter.enemyVisible) return -1;
    const count = bridge.actionCount; const gate = bridge.engine.finalGate;
    if (gate.evaluate(bridge.bundle, bridge.actions, bridge.arguments, count) !== count) return -1;
    const vector = bridge.engine.combat.evaluate(bridge.bundle, bridge.actions, count,
      bridge.projectedCell, bridge.projectedDirection, 1, null,
      bridge.engine.tactical, bridge.engine.adapter.enemyCanAct);
    bridge.engine.projectileAttack.evaluate(bridge.bundle, bridge.actions, bridge.arguments,
      count, bridge.enemyActions, bridge.enemyArguments, bridge.enemyActionCount, vector);
    this.evaluationCount += 1; this.supportComplete = true;
    for (let row = 0; row < count; row += 1) {
      if (gate.status[row] !== HARD_STATUS.ALLOW) continue;
      const purposeful = vector.directKill[row] || vector.aimSetup[row] ||
        vector.intercept[row] || vector.escapeDenial[row] || vector.shieldBreak[row] ||
        vector.zoneDenial[row];
      if (!purposeful || vector.purposeCompleteness[row] === 0) {
        if (bridge.actions[row] === ACTION.FIRE) this.purposeMissingCount += 1;
        continue;
      }
      if ((vector.purposeFlags[row] & bridge.combatPurposeMask) === 0)
        continue;
      if (bridge.combatPrimaryPurpose &&
          vector.purpose[row] !== bridge.combatPrimaryPurpose)
        continue;
      if (bridge.combatRequireFrontier && vector.enemyFrontierColumns[row] === 0)
        continue;
      const risk = bridge.engine.possibleRisk(bridge.projectedCell[row],
        bridge.projectedDirection[row]);
      const riskLimit = 99 * Math.max(0, Math.min(100, bridge.engine.policy.baseRisk | 0));
      if (risk > riskLimit || vector.ownCounterExposure[row] >= 10000) {
        this.riskBlockedCount += 1; continue;
      }
      const possible = vector.possibleHit[row] && vector.pressureValue[row] > 0 &&
        vector.purposeCompleteness[row] >= 4500;
      const committed = vector.robustPressure[row] > 0 || vector.directKill[row] ||
        vector.aimSetup[row] || vector.escapeDenial[row] || vector.zoneDenial[row];
      if (!possible && !committed) continue;
      if (this.better(row, this.selected)) this.selected = row;
    }
    if (this.selected >= 0) {
      this.proposalCount += 1;
      if (vector.directKill[this.selected]) this.directKillCount += 1;
      if (vector.possibleHit[this.selected]) this.possibleHitCount += 1;
    }
    return this.selected;
  }

  invoke(slot, call) {
    this.callCount += 1;
    const legacy = call.next();
    if (this.mode === V3_COMPONENT_MODE.PASS_THROUGH) return legacy;
    const selected = this.evaluate();
    const result = slot === V3_SLOT.DIRECT_ATTACK ? this.results[0] : this.results[1];
    if (selected < 0) {
      result.set(this.supportComplete ? V3_RESULT_STATUS.NO_PROPOSAL :
        V3_RESULT_STATUS.INCOMPLETE, actionFromLegacy(legacy), -1,
        this.supportComplete, this.supportComplete ? V3_EVIDENCE.NONE :
          V3_EVIDENCE.INFORMATION | V3_EVIDENCE.FALLBACK, 1);
      return legacy;
    }
    const action = this.bridge.actions[selected]; const vector = this.bridge.engine.combat.vector;
    const legacyAction = actionFromLegacy(legacy);
    let legacyRow = -1;
    for (let row = 0; row < this.bridge.actionCount; row += 1)
      if (this.bridge.actions[row] === legacyAction) { legacyRow = row; break; }
    const legacyExposure = legacyRow < 0 ? 10000 : vector.ownCounterExposure[legacyRow];
    const legacyDoomed = legacyRow < 0 ? 0 : vector.enemyDoomedFirstActions[legacyRow];
    const legacyRobust = legacyRow < 0 ? -10000 : vector.robustPressure[legacyRow];
    const selfEscape = vector.postFireEscape[selected] > 0;
    const counterNoWorse = vector.ownCounterExposure[selected] <= legacyExposure;
    const enemyReduced = vector.directKill[selected] ||
      vector.enemyDoomedFirstActions[selected] > legacyDoomed;
    const completeAttack = this.bridge.actions[selected] === ACTION.FIRE &&
      vector.attackClosureStatus[selected] === PAC_STATUS.COMPLETE &&
      vector.purposeCompleteness[selected] >= 4500;
    const robustNoWorse = vector.robustPressure[selected] >= legacyRobust;
    if (!selfEscape) this.selfEscapeBlockedCount += 1;
    if (!counterNoWorse) this.counterExposureBlockedCount += 1;
    if (!enemyReduced) this.noEnemyReductionCount += 1;
    const owns = completeAttack && selfEscape && counterNoWorse && enemyReduced &&
      robustNoWorse &&
      (vector.purposeFlags[selected] & this.bridge.combatPurposeMask) !== 0 &&
      (!this.bridge.combatPrimaryPurpose ||
        vector.purpose[selected] === this.bridge.combatPrimaryPurpose) &&
      (!this.bridge.combatRequireFrontier || vector.enemyFrontierColumns[selected] > 0);
    if (owns) this.verifiedCount += 1;
    result.set(V3_RESULT_STATUS.PROPOSED, action,
      this.bridge.arguments[selected], true, V3_EVIDENCE.INFORMATION,
      this.bridge.engine.projectileAttack.evaluationCount,
      V3_PROPOSAL_CLASS.VERIFIED_ATTACK,
      this.mode === V3_COMPONENT_MODE.ACTIVE && owns);
    return legacy;
  }

  summary() {
    return { callCount: this.callCount, evaluationCount: this.evaluationCount,
      proposalCount: this.proposalCount, overrideCount: this.overrideCount,
      directKillCount: this.directKillCount, possibleHitCount: this.possibleHitCount,
      purposeMissingCount: this.purposeMissingCount, riskBlockedCount: this.riskBlockedCount,
      selfEscapeBlockedCount: this.selfEscapeBlockedCount,
      counterExposureBlockedCount: this.counterExposureBlockedCount,
      noEnemyReductionCount: this.noEnemyReductionCount, verifiedCount: this.verifiedCount,
      purposeMask: this.bridge.combatPurposeMask,
      primaryPurpose: this.bridge.combatPrimaryPurpose,
      requireFrontier: this.bridge.combatRequireFrontier,
      projectileRootRestoreFailures: this.bridge.engine.projectileAttack.rootRestoreFailures };
  }
}

// Final-boundary attack owner. Unlike the legacy early-port experiment it
// scans FIRE directly and compares it with the already-resolved V1 action.
class V2VerifiedAttackOwner {
  constructor(bridge, options = {}) {
    this.bridge = bridge;
    this.requireDirectKill = options.requireDirectKill ? 1 : 0;
    this.evaluatedFrame = -1;
    this.selected = -1;
    this.supportComplete = false;
    this.evaluationCount = 0;
    this.proposalCount = 0;
    this.directKillCount = 0;
    this.enemyReductionCount = 0;
    this.riskBlockedCount = 0;
    this.escapeBlockedCount = 0;
    this.exposureBlockedCount = 0;
    this.purposeBlockedCount = 0;
    this.closureBlockedCount = 0;
    this.noReductionCount = 0;
    this.robustBlockedCount = 0;
    this.nonDirectBlockedCount = 0;
    this.streamUsed = 0;
    this.preferredActionStream = new Uint8Array(128);
    this.proposalActionStream = new Uint8Array(128);
    this.directKillStream = new Uint8Array(128);
    this.enemyReductionStream = new Uint8Array(128);
    this.proposalActionStream.fill(0xff);
  }

  indexOf(action) {
    for (let row = 0; row < this.bridge.actionCount; row += 1)
      if (this.bridge.actions[row] === action) return row;
    return -1;
  }

  better(left, right) {
    if (right < 0) return true;
    const vector = this.bridge.engine.combat.vector;
    if (vector.directKill[left] !== vector.directKill[right])
      return vector.directKill[left] > vector.directKill[right];
    if (vector.enemyDoomedFirstActions[left] !== vector.enemyDoomedFirstActions[right])
      return vector.enemyDoomedFirstActions[left] > vector.enemyDoomedFirstActions[right];
    if (vector.hitDeadline[left] !== vector.hitDeadline[right])
      return vector.hitDeadline[left] < vector.hitDeadline[right];
    if (vector.ownCounterExposure[left] !== vector.ownCounterExposure[right])
      return vector.ownCounterExposure[left] < vector.ownCounterExposure[right];
    if (vector.robustPressure[left] !== vector.robustPressure[right])
      return vector.robustPressure[left] > vector.robustPressure[right];
    return left < right;
  }

  record(preferredAction, selected) {
    if (this.streamUsed >= this.proposalActionStream.length) return;
    const at = this.streamUsed++;
    this.preferredActionStream[at] = preferredAction;
    this.proposalActionStream[at] = selected < 0 ? 0xff : this.bridge.actions[selected];
    if (selected >= 0) {
      const vector = this.bridge.engine.combat.vector;
      this.directKillStream[at] = vector.directKill[selected] ? 1 : 0;
      this.enemyReductionStream[at] = vector.enemyDoomedFirstActions[selected];
    }
  }

  evaluateFinal(preferredAction) {
    this.selected = -1; this.supportComplete = false;
    if (!this.bridge.prepareCombatEvidence()) {
      this.record(preferredAction, -1); return -1;
    }
    this.evaluationCount += 1; this.supportComplete = true;
    const bridge = this.bridge; const engine = bridge.engine;
    const vector = engine.combat.vector; const preferred = this.indexOf(preferredAction);
    const preferredExposure = preferred < 0 ? 10000 : vector.ownCounterExposure[preferred];
    const preferredDoomed = preferred < 0 ? 0 : vector.enemyDoomedFirstActions[preferred];
    const preferredRobust = preferred < 0 ? -10000 : vector.robustPressure[preferred];
    const preferredRisk = preferred < 0 ? 10000 : engine.possibleRisk(
      bridge.projectedCell[preferred], bridge.projectedDirection[preferred]);
    const riskLimit = 99 * Math.max(0, Math.min(100, engine.policy.baseRisk | 0));
    for (let row = 0; row < bridge.actionCount; row += 1) {
      if (bridge.actions[row] !== ACTION.FIRE ||
          engine.hardStatus[row] !== HARD_STATUS.ALLOW) continue;
      if (vector.attackClosureStatus[row] !== PAC_STATUS.COMPLETE) {
        this.closureBlockedCount += 1; continue;
      }
      if (vector.purposeCompleteness[row] < 4500 ||
          (vector.purposeFlags[row] & bridge.combatPurposeMask) === 0 ||
          (bridge.combatPrimaryPurpose && vector.purpose[row] !== bridge.combatPrimaryPurpose)) {
        this.purposeBlockedCount += 1; continue;
      }
      if (this.requireDirectKill && !vector.directKill[row]) {
        this.nonDirectBlockedCount += 1; continue;
      }
      if (!vector.postFireEscape[row]) { this.escapeBlockedCount += 1; continue; }
      if (vector.ownCounterExposure[row] >= 10000 ||
          vector.ownCounterExposure[row] > preferredExposure) {
        this.exposureBlockedCount += 1; continue;
      }
      const reduced = vector.directKill[row] ||
        vector.enemyDoomedFirstActions[row] > preferredDoomed;
      if (!reduced) { this.noReductionCount += 1; continue; }
      if (vector.robustPressure[row] < preferredRobust) {
        this.robustBlockedCount += 1; continue;
      }
      const risk = engine.possibleRisk(bridge.projectedCell[row],
        bridge.projectedDirection[row]);
      if (risk > riskLimit && risk > preferredRisk) {
        this.riskBlockedCount += 1; continue;
      }
      if (this.better(row, this.selected)) this.selected = row;
    }
    if (this.selected >= 0) {
      this.proposalCount += 1;
      if (vector.directKill[this.selected]) this.directKillCount += 1;
      if (vector.enemyDoomedFirstActions[this.selected] > preferredDoomed)
        this.enemyReductionCount += 1;
    }
    this.record(preferredAction, this.selected);
    return this.selected;
  }

  summary() {
    return {
      evaluationCount: this.evaluationCount,
      proposalCount: this.proposalCount,
      directKillCount: this.directKillCount,
      enemyReductionCount: this.enemyReductionCount,
      riskBlockedCount: this.riskBlockedCount,
      escapeBlockedCount: this.escapeBlockedCount,
      exposureBlockedCount: this.exposureBlockedCount,
      purposeBlockedCount: this.purposeBlockedCount,
      closureBlockedCount: this.closureBlockedCount,
      noReductionCount: this.noReductionCount,
      robustBlockedCount: this.robustBlockedCount,
      nonDirectBlockedCount: this.nonDirectBlockedCount,
      requireDirectKill: this.requireDirectKill,
      streamUsed: this.streamUsed,
      preferredActionStream: Buffer.from(this.preferredActionStream.subarray(
        0, this.streamUsed)).toString("base64"),
      proposalActionStream: Buffer.from(this.proposalActionStream.subarray(
        0, this.streamUsed)).toString("base64"),
      directKillStream: Buffer.from(this.directKillStream.subarray(
        0, this.streamUsed)).toString("base64"),
      enemyReductionStream: Buffer.from(this.enemyReductionStream.subarray(
        0, this.streamUsed)).toString("base64"),
      projectileRootRestoreFailures: this.bridge.engine.projectileAttack.rootRestoreFailures
    };
  }
}

class V2OrderedRescueAttackFinalAdapter {
  constructor(bridge, rescueOwner, attackOwner, mode = V3_COMPONENT_MODE.SHADOW) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.FINAL_ACTION_GATE;
    this.id = mode === V3_COMPONENT_MODE.ACTIVE ?
      "V2_ORDERED_RESCUE_ATTACK_ACTIVE" : "V2_ORDERED_RESCUE_ATTACK_SHADOW";
    this.bridge = bridge;
    this.rescueOwner = rescueOwner;
    this.attackOwner = attackOwner;
    this.mode = mode;
    this.rescueOverrideCount = 0;
    this.attackOverrideCount = 0;
  }

  select(row, preferred, legacy, attack) {
    if (row < 0) return null;
    const action = this.bridge.actions[row];
    const argument = this.bridge.arguments[row];
    this.bridge.pendingResolvedAction = action;
    this.bridge.pendingResolvedArgument = argument;
    this.bridge.pendingResolvedValid = true;
    if (action !== preferred) {
      if (attack) this.attackOverrideCount += 1;
      else this.rescueOverrideCount += 1;
    }
    return actionToLegacy(action) || legacy;
  }

  invoke(call) {
    const legacy = call.next(); const preferred = actionFromLegacy(legacy);
    const rescue = this.rescueOwner ? this.rescueOwner.proposeFinal(preferred) : -1;
    if (rescue >= 0) {
      this.attackOwner.record(preferred, -1);
      return this.select(rescue, preferred, legacy, false);
    }
    const attack = this.attackOwner.evaluateFinal(preferred);
    if (this.mode === V3_COMPONENT_MODE.ACTIVE && attack >= 0)
      return this.select(attack, preferred, legacy, true);
    this.bridge.recordResolvedLegacy(legacy);
    return legacy;
  }

  summary() {
    return { mode: this.mode, rescueOverrideCount: this.rescueOverrideCount,
      attackOverrideCount: this.attackOverrideCount,
      rescue: this.rescueOwner ? this.rescueOwner.summary() : null,
      attack: this.attackOwner.summary() };
  }
}

class V2CombatAttackPort {
  constructor(slot, owner) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = slot;
    this.id = slot === V3_SLOT.DIRECT_ATTACK ? "V2_COMBAT_DIRECT_ATTACK" :
      "V2_COMBAT_TACTICAL_ELEVATION";
    this.owner = owner;
  }
  invoke(call) { return this.owner.invoke(this.slot, call); }
  summary() { return this.owner.summary(); }
}

function combatAttackPorts(bridge, mode) {
  const owner = new V2CombatAttackOwner(bridge, mode);
  return [new V2CombatAttackPort(V3_SLOT.DIRECT_ATTACK, owner),
    new V2CombatAttackPort(V3_SLOT.TACTICAL_SEARCH, owner)];
}

module.exports = { V2CombatAttackOwner, V2CombatAttackPort,
  V2VerifiedAttackOwner, V2OrderedRescueAttackFinalAdapter, combatAttackPorts };
