"use strict";

const { V3_COMPONENT_ABI, V3_SLOT, V3_SLOT_COUNT, V3_PORTS } = require("./contracts");

class PortInvocation {
  constructor(slot) {
    this.slot = slot;
    this.runtime = null;
    this.original = null;
    this.arity = 0;
    this.a = undefined;
    this.b = undefined;
    this.c = undefined;
    this.d = undefined;
    // Stable aliases let adapters avoid positional V1 knowledge. Fields that
    // do not apply to the current port are reset to null.
    this.me = null;
    this.enemy = null;
    this.game = null;
    this.searchState = null;
    this.searchRounds = 0;
    this.requestedAction = null;
    this.legacyContact = false;
  }

  reset(runtime, original, arity, a, b, c, d) {
    this.runtime = runtime;
    this.original = original;
    this.arity = arity;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.me = null;
    this.enemy = null;
    this.game = null;
    this.searchState = null;
    this.searchRounds = 0;
    this.requestedAction = null;
    this.legacyContact = false;
    if (this.slot === V3_SLOT.TACTICAL_SEARCH) {
      this.searchState = a;
      this.searchRounds = b | 0;
    } else if (this.slot === V3_SLOT.TACTICAL_CONTACT) {
      this.me = a;
      this.enemy = b;
      this.game = c;
      this.legacyContact = !!d;
    } else if (this.slot === V3_SLOT.ACTION_EMIT) {
      this.me = a;
      this.requestedAction = b;
      this.enemy = c;
      this.game = d;
    } else {
      this.me = a;
      this.enemy = b;
      this.game = c;
      if (this.slot === V3_SLOT.FINAL_ACTION_GATE) this.requestedAction = d;
    }
    return this;
  }

  next() {
    if (this.arity === 2) return this.original.call(this.runtime.sandbox, this.a, this.b);
    if (this.arity === 3) return this.original.call(this.runtime.sandbox, this.a, this.b, this.c);
    return this.original.call(this.runtime.sandbox, this.a, this.b, this.c, this.d);
  }
}

class LegacyPassThroughComponent {
  constructor(slot) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = slot;
    this.id = `V1_PASS_THROUGH_${V3_PORTS[slot].name}`;
  }
  invoke(call) { return call.next(); }
}

class ComponentRegistry {
  constructor() {
    this.components = new Array(V3_SLOT_COUNT);
    this.invocations = new Array(V3_SLOT_COUNT);
    this.callCounts = new Array(V3_SLOT_COUNT).fill(0);
    this.replacementMask = 0;
    this.locked = false;
    for (let slot = 0; slot < V3_SLOT_COUNT; slot += 1) {
      this.components[slot] = new LegacyPassThroughComponent(slot);
      this.invocations[slot] = new PortInvocation(slot);
    }
  }

  replace(slot, component) {
    if (this.locked) throw new Error("V3_COMPONENT_REGISTRY_LOCKED");
    if (!Number.isInteger(slot) || slot < 0 || slot >= V3_SLOT_COUNT)
      throw new Error(`V3_UNKNOWN_SLOT:${slot}`);
    if (!component || component.abi !== V3_COMPONENT_ABI || component.slot !== slot ||
        typeof component.invoke !== "function")
      throw new Error(`V3_COMPONENT_CONTRACT_MISMATCH:${V3_PORTS[slot].name}`);
    this.components[slot] = component;
    this.replacementMask |= 1 << slot;
    return this;
  }

  decorate(slot, decorator) {
    if (this.locked) throw new Error("V3_COMPONENT_REGISTRY_LOCKED");
    if (!Number.isInteger(slot) || slot < 0 || slot >= V3_SLOT_COUNT)
      throw new Error(`V3_UNKNOWN_SLOT:${slot}`);
    const component = decorator(this.components[slot]);
    if (!component || component.abi !== V3_COMPONENT_ABI || component.slot !== slot ||
        typeof component.invoke !== "function")
      throw new Error(`V3_COMPONENT_DECORATOR_MISMATCH:${V3_PORTS[slot].name}`);
    this.components[slot] = component;
    return this;
  }

  beginDecision() { this.locked = true; }

  dispatch(slot, runtime, original, arity, a, b, c, d) {
    this.callCounts[slot] += 1;
    return this.components[slot].invoke(
      this.invocations[slot].reset(runtime, original, arity, a, b, c, d));
  }

  describe() {
    return V3_PORTS.map(port => ({ slot: port.slot, name: port.name,
      legacyName: port.legacyName, componentId: this.components[port.slot].id || "ANONYMOUS",
      replaced: (this.replacementMask & (1 << port.slot)) !== 0,
      calls: this.callCounts[port.slot], details: typeof this.components[port.slot].summary ===
        "function" ? this.components[port.slot].summary() : null }));
  }
}

module.exports = { PortInvocation, LegacyPassThroughComponent, ComponentRegistry };
