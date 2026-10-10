"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("V1 policy oracle is evaluated before variable-cost native diagnostics", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../tools/agentank/diagnostics",
    "v2-native-initiative-arena.js"), "utf8");
  const start = source.indexOf("diagnosticFinalActionOverride: nativeBasePolicyDifferential");
  assert.ok(start >= 0);
  const oracle = source.indexOf("const oracleBefore", start);
  const native = source.indexOf("const nativeBefore", start);
  const observe = source.indexOf("nativeBasePolicyDifferential.observe", start);
  assert.ok(oracle >= 0 && native > oracle && observe > native);
});

