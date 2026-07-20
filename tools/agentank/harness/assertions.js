"use strict";

const { canonicalJson } = require("../core/canonical-json");
const { invariant } = require("../core/errors");

function assertSafeInteger(value, name = "value") {
  invariant(Number.isSafeInteger(value), "ASSERT_INTEGER_FAILED", `${name} must be a safe integer`);
  return value;
}

function assertCanonicalEqual(actual, expected, code = "ASSERT_CANONICAL_EQUAL_FAILED") {
  invariant(canonicalJson(actual) === canonicalJson(expected), code,
    "canonical values are not equal");
}

module.exports = { assertSafeInteger, assertCanonicalEqual };
