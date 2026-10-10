"use strict";

// Cold diagnostic wrapper used only to identify the methods reached by a
// frozen BasePolicy configuration. It deliberately does not belong to the
// deployable search and is never enabled by default.
function installBasePolicySearchMethodCensus(instance) {
  const methods = [];
  const seen = new Set();
  let prototype = Object.getPrototypeOf(instance);
  while (prototype && prototype !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === "constructor" || name === "summary" || seen.has(name)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (!descriptor || typeof descriptor.value !== "function") continue;
      seen.add(name); methods.push({ name, fn: descriptor.value });
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  methods.sort((left, right) => left.name.localeCompare(right.name));
  const counts = new Uint32Array(methods.length);
  for (let index = 0; index < methods.length; index += 1) {
    const original = methods[index].fn;
    instance[methods[index].name] = function basePolicyMethodCensusWrapper() {
      counts[index] += 1;
      return Reflect.apply(original, this, arguments);
    };
  }
  return {
    methods, counts,
    summary() {
      const called = {}; const uncalled = [];
      let totalCalls = 0;
      for (let index = 0; index < methods.length; index += 1) {
        const count = counts[index]; totalCalls += count;
        if (count) called[methods[index].name] = count;
        else uncalled.push(methods[index].name);
      }
      return { methodCount: methods.length,
        calledMethodCount: Object.keys(called).length,
        uncalledMethodCount: uncalled.length, totalCalls, called, uncalled,
        semantics: "DIAGNOSTIC_WRAPPER_NOT_PERFORMANCE_EVIDENCE" };
    }
  };
}

module.exports = { installBasePolicySearchMethodCensus };
