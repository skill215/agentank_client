"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SCHEMAS, compileSchemas, validateSchemaObject, validateSchemaFile } =
  require("../../tools/agentank/core/schema-validator");
const { defaultWorkspaceRoot } = require("../../tools/agentank/core/paths");

test("all registered platform and IMP0 schemas compile under the pinned validator", () => {
  assert.equal(compileSchemas().size, Object.keys(SCHEMAS).length);
});

test("valid example registry passes and malformed registry fails", () => {
  const root = defaultWorkspaceRoot();
  const file = path.join(root, "config", "agentank", "tanks.example.json");
  assert.doesNotThrow(() => validateSchemaFile("tank-registry", file));
  const malformed = JSON.parse(fs.readFileSync(file, "utf8"));
  malformed.profiles[0].secretRef.name = "not-an-env-name";
  assert.throws(() => validateSchemaObject("tank-registry", malformed),
    { code: "SCHEMA_VALIDATION_FAILED" });
});
