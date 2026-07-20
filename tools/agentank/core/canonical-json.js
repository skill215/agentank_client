"use strict";

const { invariant } = require("./errors");

function normalize(value, path = "$") {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    invariant(Number.isSafeInteger(value), "NON_CANONICAL_NUMBER",
      `canonical JSON requires a safe integer at ${path}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => normalize(item, `${path}[${index}]`));
  invariant(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype,
    "NON_CANONICAL_OBJECT", `canonical JSON requires a plain object at ${path}`);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    invariant(value[key] !== undefined, "NON_CANONICAL_UNDEFINED",
      `canonical JSON forbids undefined at ${path}.${key}`);
    output[key] = normalize(value[key], `${path}.${key}`);
  }
  return output;
}

function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

function withoutTopLevelFingerprint(value) {
  invariant(value && typeof value === "object" && !Array.isArray(value),
    "MANIFEST_NOT_OBJECT", "fingerprinted artifact must be an object");
  const copy = { ...value };
  delete copy.fingerprint;
  return copy;
}

module.exports = { canonicalJson, normalize, withoutTopLevelFingerprint };
