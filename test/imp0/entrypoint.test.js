"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

test("IMP0 has one versioned WSL-native entrypoint", () => {
  const source = fs.readFileSync(path.join(ROOT, "tools", "imp0-toolchain.sh"), "utf8");
  for (const command of ["verify", "benchmark", "fixtures", "audit-structure",
    "audit-production", "toolchain", "test"]) assert.match(source, new RegExp(command));
  assert.match(source, /tools\/wsl-node\.sh/);
  assert.match(source, /tools\/wsl-npm\.sh/);
  assert.doesNotMatch(source, /curl|fetch|challenge|publish|simulate/);
});
