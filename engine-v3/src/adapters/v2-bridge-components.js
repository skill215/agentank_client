"use strict";

const { V3_COMPONENT_ABI, V3_COMPONENT_MODE, V3_RESULT_STATUS, V3_EVIDENCE,
  V3_SLOT } = require("../contracts");
const { ComponentResult } = require("../component-result");

class V2FramePrepareAdapter {
  constructor(bridge, mode = V3_COMPONENT_MODE.SHADOW, controlShadow = null) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.FRAME_PREPARE;
    this.id = "V2_BRIDGE_FRAME_PREPARE";
    this.bridge = bridge;
    this.mode = mode;
    this.controlShadow = controlShadow;
    this.result = new ComponentResult();
  }

  invoke(call) {
    const legacy = call.next();
    if (this.mode === V3_COMPONENT_MODE.PASS_THROUGH) return legacy;
    const bridge = this.bridge.prepare(call.me, call.enemy, call.game);
    if (this.controlShadow) this.controlShadow.observe(bridge);
    this.result.set(bridge.supportComplete ? V3_RESULT_STATUS.PASS :
      V3_RESULT_STATUS.INCOMPLETE, 0, -1, bridge.supportComplete,
      bridge.supportComplete ? V3_EVIDENCE.OBSERVATION_COMPLETE : V3_EVIDENCE.INFORMATION,
      1);
    return legacy;
  }
}

class V2FinalActionObserver {
  constructor(bridge) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.FINAL_ACTION_GATE;
    this.id = "V2_BRIDGE_FINAL_ACTION_OBSERVER";
    this.bridge = bridge;
    this.result = new ComponentResult();
  }

  invoke(call) {
    const resolved = call.next();
    this.bridge.recordResolvedLegacy(resolved);
    this.result.set(V3_RESULT_STATUS.PASS, 0, -1, true, V3_EVIDENCE.NONE, 1);
    return resolved;
  }
}

class V2ActionEmitAdapter {
  constructor(bridge, mode = V3_COMPONENT_MODE.SHADOW) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.ACTION_EMIT;
    this.id = "V2_BRIDGE_ACTION_EMIT";
    this.bridge = bridge;
    this.mode = mode;
    this.result = new ComponentResult();
  }

  invoke(call) {
    const emitted = call.next();
    if (this.mode === V3_COMPONENT_MODE.PASS_THROUGH) return emitted;
    if (call.runtime.sandbox.V3_CAPTURE_ACTION) {
      this.result.set(V3_RESULT_STATUS.PASS, 0, -1, true,
        V3_EVIDENCE.NONE, 1);
      return emitted;
    }
    const action = this.bridge.recordEmissionFromPending(call.requestedAction);
    this.result.set(V3_RESULT_STATUS.PASS, action, -1, true,
      V3_EVIDENCE.COMMITTED, 1);
    return emitted;
  }
}

class V2TacticalContactAdapter {
  constructor(bridge, mode = V3_COMPONENT_MODE.SHADOW) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.TACTICAL_CONTACT;
    this.id = "V2_TACTICAL_CONTACT";
    this.bridge = bridge;
    this.mode = mode;
    this.result = new ComponentResult();
    this.callCount = 0;
    this.divergenceCount = 0;
    this.fallbackCount = 0;
  }

  invoke(call) {
    this.callCount += 1;
    if (this.mode === V3_COMPONENT_MODE.PASS_THROUGH) return call.next();
    const proposed = !!(this.bridge.prepared && this.bridge.bundle &&
      this.bridge.engine.tacticalContact());
    if (proposed !== call.legacyContact) this.divergenceCount += 1;
    if (!this.bridge.prepared || !this.bridge.bundle || !this.bridge.supportComplete) {
      this.fallbackCount += 1;
      this.result.set(V3_RESULT_STATUS.INCOMPLETE, 0, -1, false,
        V3_EVIDENCE.INFORMATION | V3_EVIDENCE.FALLBACK, 1);
      return call.legacyContact;
    }
    this.result.set(this.mode === V3_COMPONENT_MODE.ACTIVE ? V3_RESULT_STATUS.SELECTED :
      V3_RESULT_STATUS.PROPOSED, proposed ? 1 : 0, -1, true,
      V3_EVIDENCE.OBSERVATION_COMPLETE, 1);
    return this.mode === V3_COMPONENT_MODE.ACTIVE ? proposed : call.legacyContact;
  }

  summary() {
    return { callCount: this.callCount, divergenceCount: this.divergenceCount,
      fallbackCount: this.fallbackCount };
  }
}

module.exports = { V2FramePrepareAdapter, V2FinalActionObserver, V2ActionEmitAdapter,
  V2TacticalContactAdapter };
