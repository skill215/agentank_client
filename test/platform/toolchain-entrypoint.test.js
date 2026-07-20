"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

test("one checked-in entrypoint owns every repeatable foundation operation", () => {
  const script = fs.readFileSync(path.join(ROOT, "tools/platform-toolchain.sh"), "utf8");
  for (const command of ["bootstrap", "doctor", "profiles", "context", "register-tank",
    "scan-secrets", "validate-schema", "test", "verify"]) {
    assert.match(script, new RegExp(`(^|[|\\s])${command}([|)\\s]|$)`, "m"));
  }
  assert.match(script, /tools\/wsl-node\.sh/);
  assert.match(script, /tools\/wsl-npm\.sh/);
});

test("the aggregate verify gate is assembled from stable commands", () => {
  const script = fs.readFileSync(path.join(ROOT, "tools/platform-toolchain.sh"), "utf8");
  const verify = script.slice(script.indexOf("  verify)"), script.indexOf("  help|"));
  for (const operation of ["bootstrap", "doctor", "scan-secrets"]) {
    assert.match(verify, new RegExp(`agentank-ops\\.js\" ${operation}`));
  }
  assert.match(verify, /wsl-npm\.sh\" test/);
});
