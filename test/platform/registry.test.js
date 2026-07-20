"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bootstrapRegistry, loadRegistry, validateRegistry } =
  require("../../tools/agentank/profiles/registry");

const CONFIG = {
  schemaVersion: 1,
  registryId: "test-registry",
  profiles: [
    { tankProfileId: "v1", alias: "legacy", ownerScopeId: "same-owner", keyEnv: "KEY_V1" },
    { tankProfileId: "v2", alias: "new", ownerScopeId: "same-owner", keyEnv: "KEY_V2" }
  ]
};

test("registry bootstrap is idempotent and preserves profiles", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-registry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "tank-registry.json");
  const first = bootstrapRegistry(file, CONFIG, "2026-07-16T00:00:00.000Z");
  const second = bootstrapRegistry(file, CONFIG, "2026-07-17T00:00:00.000Z");
  assert.equal(first.changed, true);
  assert.deepEqual(first.added, ["v1", "v2"]);
  assert.equal(second.changed, false);
  assert.deepEqual(second.added, []);
  assert.equal(second.registry.fingerprint, first.registry.fingerprint);
  assert.deepEqual(loadRegistry(file).profiles.map(profile => profile.tankProfileId), ["v1", "v2"]);
});

test("registry semantic validation rejects duplicate aliases", () => {
  const registry = {
    schemaVersion: 1,
    registryId: "test",
    profiles: [],
    updatedAt: "2026-07-16T00:00:00.000Z",
    fingerprint: ""
  };
  assert.throws(() => validateRegistry(registry, { verifyFingerprint: false }),
    { code: "EMPTY_TANK_REGISTRY" });
});
