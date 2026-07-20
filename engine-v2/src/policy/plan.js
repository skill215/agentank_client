"use strict";

const { POLICY_CAPACITY } = require("../generated/policy-config");
const { POLICY_STATUS, PLAN_KIND, PLAN_STATUS, PLAN_REASON, NONE_HANDLE } =
  require("../abi/policy-codes");
const { HARD_STATUS, NONE_CELL } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");

class PlanSketchArena {
  constructor() {
    const count = POLICY_CAPACITY.MAX_PLAN_SKETCHES; this.used = 0;
    this.kind = new Uint8Array(count); this.purpose = new Uint8Array(count);
    this.action = new Uint8Array(count); this.argument = new Uint16Array(count);
    this.deadline = new Uint16Array(count); this.dependencyMask = new Uint16Array(count);
    this.targetSignature = new Uint32Array(count); this.rawScore = new Int16Array(count);
    this.directKill = new Uint8Array(count); this.aimSetup = new Uint8Array(count);
    this.intercept = new Uint8Array(count); this.escapeDenial = new Uint8Array(count);
    this.shieldBreak = new Uint8Array(count); this.zoneDenial = new Uint8Array(count);
    this.beliefSweep = new Uint8Array(count); this.hitDeadline = new Uint8Array(count);
    this.enemySafeSuccessors = new Uint8Array(count);
    this.ownCounterExposure = new Uint16Array(count);
    this.resourceOccupancy = new Uint8Array(count); this.blockadeValue = new Uint16Array(count);
    this.purposeCompleteness = new Uint16Array(count); this.postFireEscape = new Uint8Array(count);
    this.hotAllocationCount = 0;
  }
  reset() { this.used = 0; }
  create(kind, purpose, action, argument = NONE_CELL, deadline = 0xffff,
      dependencyMask = 0, targetSignature = 0, rawScore = 0) {
    if (this.used >= this.kind.length || kind <= PLAN_KIND.NONE || kind >= PLAN_KIND.COUNT) return NONE_HANDLE;
    const index = this.used++; this.kind[index] = kind; this.purpose[index] = purpose;
    this.action[index] = action; this.argument[index] = argument; this.deadline[index] = deadline;
    this.dependencyMask[index] = dependencyMask; this.targetSignature[index] = targetSignature >>> 0;
    this.rawScore[index] = rawScore; this.directKill[index] = 0; this.aimSetup[index] = 0;
    this.intercept[index] = 0; this.escapeDenial[index] = 0; this.shieldBreak[index] = 0;
    this.zoneDenial[index] = 0; this.beliefSweep[index] = 0; this.hitDeadline[index] = 255;
    this.enemySafeSuccessors[index] = 0; this.ownCounterExposure[index] = 0;
    this.resourceOccupancy[index] = 0; this.blockadeValue[index] = 0;
    this.purposeCompleteness[index] = 0; this.postFireEscape[index] = 0; return index;
  }
  annotateCombat(handle, combat, row) {
    if (handle === NONE_HANDLE || handle >= this.used || !combat || row < 0 || row >= combat.count)
      return 0;
    this.directKill[handle] = combat.directKill[row]; this.aimSetup[handle] = combat.aimSetup[row];
    this.intercept[handle] = combat.intercept[row]; this.escapeDenial[handle] = combat.escapeDenial[row];
    this.shieldBreak[handle] = combat.shieldBreak[row]; this.zoneDenial[handle] = combat.zoneDenial[row];
    this.beliefSweep[handle] = combat.beliefSweep[row]; this.hitDeadline[handle] = combat.hitDeadline[row];
    this.enemySafeSuccessors[handle] = combat.enemySafeSuccessors[row];
    this.ownCounterExposure[handle] = combat.ownCounterExposure[row];
    this.resourceOccupancy[handle] = combat.resourceOccupancy[row];
    this.blockadeValue[handle] = combat.blockadeValue[row];
    this.purposeCompleteness[handle] = combat.purposeCompleteness[row];
    this.postFireEscape[handle] = combat.postFireEscape[row]; return 1;
  }
}

class PersistentPlanArena {
  constructor() {
    const count = POLICY_CAPACITY.MAX_PERSISTENT_PLANS; const entities = count * POLICY_CAPACITY.MAX_PLAN_ENTITIES;
    this.entityStride = POLICY_CAPACITY.MAX_PLAN_ENTITIES;
    this.generation = new Uint16Array(count); this.kind = new Uint8Array(count);
    this.purpose = new Uint8Array(count); this.status = new Uint8Array(count);
    this.reason = new Uint8Array(count); this.action = new Uint8Array(count);
    this.argument = new Uint16Array(count); this.deadline = new Uint16Array(count);
    this.dependencyMask = new Uint16Array(count); this.targetSignature = new Uint32Array(count);
    this.cachedScore = new Int16Array(count); this.profileId = new Uint8Array(count);
    this.directKill = new Uint8Array(count); this.aimSetup = new Uint8Array(count);
    this.intercept = new Uint8Array(count); this.escapeDenial = new Uint8Array(count);
    this.shieldBreak = new Uint8Array(count); this.zoneDenial = new Uint8Array(count);
    this.beliefSweep = new Uint8Array(count); this.hitDeadline = new Uint8Array(count);
    this.enemySafeSuccessors = new Uint8Array(count);
    this.ownCounterExposure = new Uint16Array(count);
    this.resourceOccupancy = new Uint8Array(count); this.blockadeValue = new Uint16Array(count);
    this.purposeCompleteness = new Uint16Array(count); this.postFireEscape = new Uint8Array(count);
    this.entityCount = new Uint8Array(count); this.entitySlot = new Uint16Array(entities);
    this.entityGeneration = new Uint16Array(entities); this.lastValidatedFrame = new Uint16Array(count);
    this.selectedFrame = new Uint16Array(count); this.activatedFrame = new Uint16Array(count);
    this.executionDeadline = new Uint16Array(count);
    this.materializedCount = 0; this.hardValidationCount = 0; this.hotAllocationCount = 0;
  }
  reset() { this.status.fill(PLAN_STATUS.FREE); this.reason.fill(PLAN_REASON.NONE);
    this.entityCount.fill(0); }
  encode(slot) { return this.generation[slot] * POLICY_CAPACITY.MAX_PERSISTENT_PLANS + slot; }
  decode(handle) {
    if (handle === NONE_HANDLE) return -1; const slot = handle % POLICY_CAPACITY.MAX_PERSISTENT_PLANS;
    return Math.floor(handle / POLICY_CAPACITY.MAX_PERSISTENT_PLANS) === this.generation[slot] ? slot : -1;
  }
  materialize(sketches, sketchHandle, finalist, profileId = 0, selectedFrame = 0,
      executionDeadline = 0xffff) {
    if (!finalist || sketchHandle === NONE_HANDLE || sketchHandle >= sketches.used) return NONE_HANDLE;
    let slot = -1;
    for (let index = 0; index < this.status.length; index += 1) if (this.status[index] === PLAN_STATUS.FREE ||
        this.status[index] === PLAN_STATUS.COMPLETED || this.status[index] === PLAN_STATUS.COMPLETED_NO_EFFECT ||
        this.status[index] === PLAN_STATUS.INVALIDATED) { slot = index; break; }
    if (slot < 0) return NONE_HANDLE;
    this.generation[slot] = (this.generation[slot] + 1) & 0xffff; if (!this.generation[slot]) this.generation[slot] = 1;
    this.kind[slot] = sketches.kind[sketchHandle]; this.purpose[slot] = sketches.purpose[sketchHandle];
    this.status[slot] = PLAN_STATUS.PENDING_EXECUTION; this.reason[slot] = PLAN_REASON.NONE;
    this.action[slot] = sketches.action[sketchHandle]; this.argument[slot] = sketches.argument[sketchHandle];
    this.deadline[slot] = sketches.deadline[sketchHandle]; this.dependencyMask[slot] = sketches.dependencyMask[sketchHandle];
    this.targetSignature[slot] = sketches.targetSignature[sketchHandle]; this.cachedScore[slot] = sketches.rawScore[sketchHandle];
    this.directKill[slot] = sketches.directKill[sketchHandle]; this.aimSetup[slot] = sketches.aimSetup[sketchHandle];
    this.intercept[slot] = sketches.intercept[sketchHandle];
    this.escapeDenial[slot] = sketches.escapeDenial[sketchHandle];
    this.shieldBreak[slot] = sketches.shieldBreak[sketchHandle];
    this.zoneDenial[slot] = sketches.zoneDenial[sketchHandle];
    this.beliefSweep[slot] = sketches.beliefSweep[sketchHandle];
    this.hitDeadline[slot] = sketches.hitDeadline[sketchHandle];
    this.enemySafeSuccessors[slot] = sketches.enemySafeSuccessors[sketchHandle];
    this.ownCounterExposure[slot] = sketches.ownCounterExposure[sketchHandle];
    this.resourceOccupancy[slot] = sketches.resourceOccupancy[sketchHandle];
    this.blockadeValue[slot] = sketches.blockadeValue[sketchHandle];
    this.purposeCompleteness[slot] = sketches.purposeCompleteness[sketchHandle];
    this.postFireEscape[slot] = sketches.postFireEscape[sketchHandle];
    this.profileId[slot] = profileId; this.entityCount[slot] = 0;
    this.selectedFrame[slot] = selectedFrame; this.activatedFrame[slot] = 0xffff;
    this.executionDeadline[slot] = executionDeadline;
    this.materializedCount += 1; return this.encode(slot);
  }
  activate(handle, frame = 0xffff) { const slot = this.decode(handle); if (slot < 0 ||
      this.status[slot] !== PLAN_STATUS.PENDING_EXECUTION) return 0;
    this.status[slot] = PLAN_STATUS.ACTIVE; this.activatedFrame[slot] = frame; return 1; }
  bindEntity(handle, entitySlot, generation) {
    const slot = this.decode(handle); if (slot < 0 || this.entityCount[slot] >= POLICY_CAPACITY.MAX_PLAN_ENTITIES) return 0;
    const base = slot * POLICY_CAPACITY.MAX_PLAN_ENTITIES + this.entityCount[slot]++;
    this.entitySlot[base] = entitySlot; this.entityGeneration[base] = generation; return 1;
  }
  invalidate(handle, reason) { const slot = this.decode(handle); if (slot < 0) return 0;
    this.status[slot] = PLAN_STATUS.INVALIDATED; this.reason[slot] = reason; return 1; }
  complete(handle, reason = PLAN_REASON.PURPOSE_COMPLETE, noEffect = false) {
    const slot = this.decode(handle); if (slot < 0) return 0;
    this.status[slot] = noEffect ? PLAN_STATUS.COMPLETED_NO_EFFECT : PLAN_STATUS.COMPLETED;
    this.reason[slot] = reason; return 1;
  }
  validateContinuation(handle, bundle, action, argument = NONE_CELL) {
    const slot = this.decode(handle); if (slot < 0 || !bundle || !bundle.hard) return POLICY_STATUS.INVALID;
    const frame = bundle.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.deadline[slot] !== 0xffff && frame > this.deadline[slot]) {
      this.invalidate(handle, PLAN_REASON.DEADLINE_EXPIRED); return POLICY_STATUS.INVALID;
    }
    this.hardValidationCount += 1; const hard = bundle.hard.evaluate(action, argument);
    this.lastValidatedFrame[slot] = frame;
    if (hard === HARD_STATUS.REJECT_PROVEN) { this.invalidate(handle, PLAN_REASON.HARD_REJECTED);
      return POLICY_STATUS.HARD_REJECTED; }
    return hard === HARD_STATUS.ALLOW ? POLICY_STATUS.COMPLETE : POLICY_STATUS.INCOMPLETE;
  }
}

module.exports = { PlanSketchArena, PersistentPlanArena };
