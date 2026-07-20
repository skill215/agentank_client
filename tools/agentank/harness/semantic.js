"use strict";

const { canonicalJson } = require("../core/canonical-json");
const { sha256Text } = require("../core/hash");
const { invariant } = require("../core/errors");

function semanticValue(value, path = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    invariant(Number.isSafeInteger(value), "NON_INTEGER_SEMANTIC_VALUE",
      `semantic value must be a safe integer at ${path}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => semanticValue(item, `${path}[${index}]`));
  if (ArrayBuffer.isView(value)) {
    invariant(!(value instanceof DataView), "UNSUPPORTED_SEMANTIC_VIEW",
      `DataView is not a semantic array at ${path}`);
    invariant(!/^Float(?:32|64)Array$/.test(value.constructor.name),
      "NON_INTEGER_SEMANTIC_ARRAY", `floating semantic TypedArray is forbidden at ${path}`);
    const values = Array.from(value, (item, index) => {
      invariant(typeof item === "number" && Number.isSafeInteger(item),
        "NON_INTEGER_SEMANTIC_ARRAY", `semantic TypedArray must contain integers at ${path}[${index}]`);
      return item;
    });
    return { typedArray: value.constructor.name, values };
  }
  invariant(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype,
    "UNSUPPORTED_SEMANTIC_VALUE", `unsupported semantic value at ${path}`);
  const output = {};
  for (const key of Object.keys(value)) output[key] = semanticValue(value[key], `${path}.${key}`);
  return output;
}

function semanticFingerprint(value) {
  return sha256Text(canonicalJson(semanticValue(value)));
}

function firstDifference(left, right, path = "$") {
  if (Object.is(left, right)) return null;
  if (typeof left !== typeof right || left === null || right === null) return path;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return path;
    for (let index = 0; index < left.length; index++) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (typeof left === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.join("\u0000") !== rightKeys.join("\u0000")) return path;
    for (const key of leftKeys) {
      const difference = firstDifference(left[key], right[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return path;
}

function compareSnapshots(before, after) {
  const left = semanticValue(before);
  const right = semanticValue(after);
  const difference = firstDifference(left, right);
  return {
    equal: difference === null,
    beforeFingerprint: sha256Text(canonicalJson(left)),
    afterFingerprint: sha256Text(canonicalJson(right)),
    firstDifference: difference
  };
}

function assertRootRestored(before, after) {
  const comparison = compareSnapshots(before, after);
  invariant(comparison.equal, "ROOT_SNAPSHOT_MISMATCH",
    `root snapshot differs at ${comparison.firstDifference}`);
  return comparison;
}

module.exports = { semanticValue, semanticFingerprint, firstDifference, compareSnapshots,
  assertRootRestored };
