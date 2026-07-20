"use strict";

const { invariant } = require("./errors");

function normalizeStorageValue(value, location = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    invariant(Number.isFinite(value), "NON_FINITE_STORAGE_NUMBER",
      `storage JSON requires a finite number at ${location}`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeStorageValue(item, `${location}[${index}]`));
  }
  invariant(value && typeof value === "object", "UNSUPPORTED_STORAGE_VALUE",
    `unsupported storage JSON value at ${location}`);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item !== undefined) output[key] = normalizeStorageValue(item, `${location}.${key}`);
  }
  return output;
}

function canonicalStorageJson(value) {
  return JSON.stringify(normalizeStorageValue(value));
}

module.exports = { normalizeStorageValue, canonicalStorageJson };
