"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bootstrapPlatform } = require("../../tools/agentank/platform/bootstrap");
const { registerTankProfile, verifyTankContext, contextArtifact } =
  require("../../tools/agentank/platform/context-service");
const { workspacePaths } = require("../../tools/agentank/core/paths");
const { loadRegistry, getProfile } = require("../../tools/agentank/profiles/registry");

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "config", "agentank");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "profiles.bootstrap.json"), JSON.stringify({
    schemaVersion: 1,
    registryId: "test",
    profiles: [{ tankProfileId: "v2", alias: "new", ownerScopeId: "same-owner", keyEnv: "KEY_V2" }]
  }));
  bootstrapPlatform(root, "2026-07-16T00:00:00.000Z");
  return root;
}

function clientFactory(expectedSecret) {
  return options => {
    assert.equal(options.secret, expectedSecret);
    return { getTankContext: async () => ({
      tank: { id: 77, urlId: "tnk_v2", skillType: "boost" },
      skill: { type: "boost" },
      latestCode: { code: "function onIdle(me) { me.go(); }", version: 1 }
    }) };
  };
}

test("bootstrap context can be inspected but first binding requires expected tankId", async t => {
  const root = workspace(t);
  const paths = workspacePaths(root);
  const environment = { KEY_V2: "test-secret-value-long-enough" };
  const inspected = await verifyTankContext({ workspaceRoot: root, registryFile: paths.registry,
    profileId: "v2", branch: "main", environment,
    clientFactory: clientFactory(environment.KEY_V2) });
  assert.equal(inspected.bindingRequired, true);
  assert.equal(inspected.identity.tankId, 77);
  await assert.rejects(registerTankProfile({ workspaceRoot: root, registryFile: paths.registry,
    profileId: "v2", branch: "main", environment,
    clientFactory: clientFactory(environment.KEY_V2) }),
  { code: "BOOTSTRAP_TANK_ID_CONFIRMATION_REQUIRED" });
});

test("confirmed first binding activates profile and stores a secret-free context artifact", async t => {
  const root = workspace(t);
  const paths = workspacePaths(root);
  const secret = "test-secret-value-long-enough";
  const result = await registerTankProfile({ workspaceRoot: root, registryFile: paths.registry,
    profileId: "v2", branch: "main", expectedTankId: 77, environment: { KEY_V2: secret },
    clientFactory: clientFactory(secret), now: "2026-07-16T01:00:00.000Z" });
  assert.equal(result.profile.status, "ACTIVE");
  assert.equal(result.profile.skillId, "boost");
  const artifact = fs.readFileSync(path.join(root, result.artifact.relativePath), "utf8");
  assert.equal(artifact.includes(secret), false);
  const profile = getProfile(loadRegistry(paths.registry), "v2");
  assert.equal(profile.tankId, 77);
  assert.equal(profile.branches[0].baselineStatus, "VERIFIED_BASELINE");
});

test("platform context artifacts accept finite ranking decimals without weakening engine canonical JSON", t => {
  const root = workspace(t);
  const first = contextArtifact(root, "v2", "main", {
    tank: { id: 77, effectiveWins: 12.5, rating: 1700.25 }
  });
  const second = contextArtifact(root, "v2", "main", {
    tank: { rating: 1700.25, effectiveWins: 12.5, id: 77 }
  });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.artifactId, second.artifactId);
});
