"use strict";

function known(value) { return Object.freeze({ valueKind: "KNOWN", value }); }
function unknown(ruleId, domainOrInterval) {
  if (typeof ruleId !== "string" || !ruleId) throw new TypeError("unknown value requires ruleId");
  return Object.freeze({ valueKind: "UNKNOWN", ruleId, domainOrInterval });
}
function inconsistent(sourceRefs) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length < 2) {
    throw new TypeError("inconsistent value requires at least two source refs");
  }
  return Object.freeze({ valueKind: "INCONSISTENT", sourceRefs: Object.freeze([...sourceRefs]) });
}
function isKnown(value) { return value?.valueKind === "KNOWN"; }
function readKnown(value, field) {
  if (!isKnown(value)) {
    const error = new TypeError(`${field || "value"} is not known`);
    error.code = "REFERENCE_TYPED_UNKNOWN_READ";
    throw error;
  }
  return value.value;
}

module.exports = { known, unknown, inconsistent, isKnown, readKnown };
