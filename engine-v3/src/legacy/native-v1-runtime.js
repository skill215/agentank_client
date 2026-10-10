"use strict";

const path = require("node:path");

class NativeV1Runtime {
  constructor(options) {
    if (!options || typeof options.moduleFile !== "string")
      throw new Error("V3_NATIVE_MODULE_REQUIRED");
    const loaded = require(path.resolve(options.moduleFile));
    if (!loaded || typeof loaded.createNativeV1Runtime !== "function")
      throw new Error("V3_NATIVE_FACTORY_MISSING");
    this.registry = options.registry;
    this.sourceIdentity = options.sourceIdentity || "UNBOUND";
    this.decisions = 0;
    this.instance = loaded.createNativeV1Runtime({
      dispatch: (slot, original, arity, a, b, c, d) =>
        this.registry.dispatch(slot, this, original, arity, a, b, c, d)
    });
    this.sandbox = this.instance;
    if (!this.instance || typeof this.instance.decide !== "function")
      throw new Error("V3_NATIVE_ENTRY_MISSING");
  }

  decide(me, enemy, game) {
    this.registry.beginDecision(); this.decisions += 1;
    return this.instance.decide.call(this.instance, me, enemy, game);
  }

  callLegacy(name, a, b, c, d) {
    const target = this.instance.originals[name] || this.instance.functions[name];
    if (typeof target !== "function") throw new Error(`V3_NATIVE_FUNCTION_MISSING:${name}`);
    if (arguments.length === 2) return target.call(this.instance, a);
    if (arguments.length === 3) return target.call(this.instance, a, b);
    if (arguments.length === 4) return target.call(this.instance, a, b, c);
    return target.call(this.instance, a, b, c, d);
  }
}

module.exports = { NativeV1Runtime };
