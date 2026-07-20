"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bootstrapPlatform } = require("../../tools/agentank/platform/bootstrap");
const { loadRegistry } = require("../../tools/agentank/profiles/registry");
const { workspacePaths } = require("../../tools/agentank/core/paths");

test("platform bootstrap creates isolated v1/v2 trees and does not rebuild them", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-bootstrap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configDirectory = path.join(root, "config", "agentank");
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.writeFileSync(path.join(configDirectory, "profiles.bootstrap.json"), JSON.stringify({
    schemaVersion: 1,
    registryId: "test",
    profiles: [
      { tankProfileId: "v1", alias: "legacy", ownerScopeId: "same-owner", keyEnv: "KEY_V1" },
      { tankProfileId: "v2", alias: "new", ownerScopeId: "same-owner", keyEnv: "KEY_V2" }
    ]
  }));
  const first = bootstrapPlatform(root, "2026-07-16T00:00:00.000Z");
  const second = bootstrapPlatform(root, "2026-07-17T00:00:00.000Z");
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  const paths = workspacePaths(root);
  assert.equal(fs.existsSync(path.join(paths.tanks, "v1", "runs")), true);
  assert.equal(fs.existsSync(path.join(paths.tanks, "v2", "runs")), true);
  const registry = loadRegistry(paths.registry);
  assert.equal(registry.profiles[0].ownerScopeId, registry.profiles[1].ownerScopeId);
  assert.notEqual(path.join(paths.tanks, "v1"), path.join(paths.tanks, "v2"));
});
