"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { bootstrapPlatform } = require("../../tools/agentank/platform/bootstrap");
const { createPlatformClient } = require("../../tools/agentank/platform/client");
const { PlatformHttpError } = require("../../tools/agentank/platform/client");
const { registerTankProfile, verifyTankProfile, rotateTankKey, planReadOnlyOperation } =
  require("../../tools/agentank/platform/context-service");
const { loadCurrentBaseline } = require("../../tools/agentank/platform/baseline-store");
const { loadCurrentCapability } = require("../../tools/agentank/platform/capability-store");
const { workspacePaths } = require("../../tools/agentank/core/paths");
const { writeFileAtomic } = require("../../tools/agentank/core/atomic-file");
const { loadRegistry, getProfile, updateProfile } =
  require("../../tools/agentank/profiles/registry");
const { bootstrapRegistry } = require("../../tools/agentank/profiles/registry");
const { execute: executePlatform } = require("../../tools/agentank/cli/agentank-ops");

const SECRET_1 = "fixture-current-secret-long-enough";
const SECRET_2 = "fixture-rotated-secret-long-enough";

function createWorkspace(t, profiles = [{ tankProfileId: "v2", alias: "new",
  ownerScopeId: "same-owner", keyEnv: "KEY_V2", expectedTankName: "Slay The Tank",
  expectedSkillId: "poison" }]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-imp1-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "config", "agentank");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "profiles.bootstrap.json"), JSON.stringify({
    schemaVersion: 1, registryId: "imp1-test", profiles
  }));
  bootstrapPlatform(root, "2026-07-16T00:00:00.000Z");
  return root;
}

function context(overrides = {}) {
  return {
    tank: { id: 77, name: "Slay The Tank", urlId: "tnk_v2", skillType: "poison" },
    skill: { type: "poison" },
    latestCode: { code: "function onIdle(me) { me.go(); }", version: 4 },
    ...overrides
  };
}

function clients(values) {
  return ({ secret }) => ({
    getTankContext: async () => {
      const value = values[secret];
      if (value instanceof Error) throw value;
      assert.ok(value, "fixture secret must map to a context");
      return structuredClone(value);
    }
  });
}

async function activate(root, clientFactory = clients({ [SECRET_1]: context() })) {
  const paths = workspacePaths(root);
  return registerTankProfile({ workspaceRoot: root, registryFile: paths.registry,
    profileId: "v2", branch: "main", expectedTankId: 77, environment: { KEY_V2: SECRET_1 },
    clientFactory, now: "2026-07-16T01:00:00.000Z" });
}

test("registered profile archives a main baseline and UNKNOWN-safe CapabilityProfile", async t => {
  const root = createWorkspace(t);
  const result = await activate(root);
  const baseline = loadCurrentBaseline(root, "v2", "main");
  const capability = loadCurrentCapability(root, "v2", "main");
  assert.equal(result.expectedSkillId, "poison");
  assert.equal(baseline.publishedCodeHash, result.identity.publishedCodeHash);
  assert.equal(fs.existsSync(path.join(root, baseline.sourceRelativePath)), true);
  assert.equal(capability.profileId, "v2");
  assert.equal(capability.facts.find(item => item.name === "runtime.Math.imul").status, "UNKNOWN");
  assert.equal(capability.apiBehaviors.every(item => item.status === "UNKNOWN"), true);
});

test("expected poison onboarding constraint rejects a conflicting platform skill", async t => {
  const root = createWorkspace(t);
  const bad = context({ tank: { id: 77, urlId: "tnk_v2", skillType: "boost" },
    skill: { type: "boost" } });
  await assert.rejects(activate(root, clients({ [SECRET_1]: bad })),
    { code: "EXPECTED_SKILL_MISMATCH" });
  assert.equal(getProfile(loadRegistry(workspacePaths(root).registry), "v2").status, "BOOTSTRAP");
});

test("expected tank name onboarding constraint rejects a different tank", async t => {
  const root = createWorkspace(t);
  const bad = context({ tank: { id: 77, name: "Other Tank", urlId: "tnk_v2",
    skillType: "poison" } });
  await assert.rejects(activate(root, clients({ [SECRET_1]: bad })),
    { code: "EXPECTED_TANK_NAME_MISMATCH" });
});

test("verify-profile rejects tankUrlId drift and cross-profile identity", async t => {
  const root = createWorkspace(t);
  await activate(root);
  const paths = workspacePaths(root);
  const badUrl = context({ tank: { id: 77, urlId: "other-url", skillType: "poison" } });
  await assert.rejects(verifyTankProfile({ workspaceRoot: root, registryFile: paths.registry,
    profileId: "v2", branch: "main", environment: { KEY_V2: SECRET_1 },
    clientFactory: clients({ [SECRET_1]: badUrl }) }), { code: "TANK_URL_IDENTITY_MISMATCH" });
  const wrongTank = context({ tank: { id: 88, urlId: "tnk_other", skillType: "poison" } });
  await assert.rejects(verifyTankProfile({ workspaceRoot: root, registryFile: paths.registry,
    profileId: "v2", branch: "main", environment: { KEY_V2: SECRET_1 },
    clientFactory: clients({ [SECRET_1]: wrongTank }) }), { code: "TANK_IDENTITY_MISMATCH" });
});

test("key rotation rejects stale generations and a key bound to another tank", async t => {
  const root = createWorkspace(t);
  await activate(root);
  const paths = workspacePaths(root);
  const shared = { workspaceRoot: root, registryFile: paths.registry, profileId: "v2",
    branch: "main", secretRefEnv: "KEY_V2_NEXT", keyGenerationId: "g2",
    environment: { KEY_V2_NEXT: SECRET_2 } };
  await assert.rejects(rotateTankKey({ ...shared, expectedKeyGenerationId: "stale",
    clientFactory: clients({ [SECRET_2]: context() }) }), { code: "STALE_KEY_GENERATION" });
  const other = context({ tank: { id: 88, urlId: "tnk_other", skillType: "poison" } });
  await assert.rejects(rotateTankKey({ ...shared, expectedKeyGenerationId: "initial",
    clientFactory: clients({ [SECRET_2]: other }) }), { code: "TANK_IDENTITY_MISMATCH" });
  assert.equal(getProfile(loadRegistry(paths.registry), "v2").secretRef.keyGenerationId, "initial");
});

test("wrong key authentication failure does not bind or alter a profile", async t => {
  const root = createWorkspace(t);
  const paths = workspacePaths(root);
  const before = fs.readFileSync(paths.registry);
  const clientFactory = () => ({ getTankContext: async () => {
    throw new PlatformHttpError(401, "unauthorized");
  } });
  await assert.rejects(registerTankProfile({ workspaceRoot: root, registryFile: paths.registry,
    profileId: "v2", branch: "main", expectedTankId: 77, environment: { KEY_V2: SECRET_1 },
    clientFactory }), error => error.status === 401);
  assert.equal(fs.readFileSync(paths.registry).equals(before), true);
});

test("successful key rotation changes only the non-secret reference after GET verification", async t => {
  const root = createWorkspace(t);
  await activate(root);
  const paths = workspacePaths(root);
  const result = await rotateTankKey({ workspaceRoot: root, registryFile: paths.registry,
    profileId: "v2", branch: "main", secretRefEnv: "KEY_V2_NEXT", keyGenerationId: "g2",
    expectedKeyGenerationId: "initial", environment: { KEY_V2_NEXT: SECRET_2 },
    clientFactory: clients({ [SECRET_2]: context() }), now: "2026-07-16T02:00:00.000Z" });
  assert.equal(result.profile.secretRef.name, "KEY_V2_NEXT");
  assert.equal(result.profile.secretRef.keyGenerationId, "g2");
  assert.equal(fs.readFileSync(paths.registry, "utf8").includes(SECRET_2), false);
});

test("dry-run resolves no secret and performs no local or platform write", t => {
  const root = createWorkspace(t);
  const paths = workspacePaths(root);
  const before = fs.readFileSync(paths.registry);
  const plan = planReadOnlyOperation({ operation: "register-tank", workspaceRoot: root,
    registryFile: paths.registry, profileId: "v2", branch: "main" });
  assert.equal(plan.secretResolved, false);
  assert.equal(plan.platformMutation, false);
  assert.equal(plan.localMutation, false);
  assert.equal(fs.readFileSync(paths.registry).equals(before), true);
});

test("CLI dry-run preserves the registry and returns a GET-only plan", async t => {
  const root = createWorkspace(t);
  const registry = workspacePaths(root).registry;
  const before = fs.readFileSync(registry);
  const result = await executePlatform("context", { "tank-profile": "v2", "dry-run": true },
    {}, root);
  assert.equal(result.value.method, "GET");
  assert.equal(result.value.secretResolved, false);
  assert.equal(fs.readFileSync(registry).equals(before), true);
});

test("publish and challenge commands remain unreachable in IMP1", async () => {
  await assert.rejects(executePlatform("publish", {}), { code: "UNKNOWN_COMMAND" });
  await assert.rejects(executePlatform("challenge", {}), { code: "UNKNOWN_COMMAND" });
});

test("IMP1 read-only client rejects POST before transport", async () => {
  let calls = 0;
  const client = createPlatformClient({ secret: SECRET_1, fetchImpl: async () => { calls++; } });
  await assert.rejects(client.requestJson("/agent/tank", { method: "POST", body: {} }),
    { code: "IMP1_READ_ONLY_METHOD_REJECTED" });
  assert.equal(calls, 0);
});

test("secret echo is rejected before any context artifact is written", async t => {
  const root = createWorkspace(t);
  const paths = workspacePaths(root);
  const leaked = { ...context(), diagnostic: SECRET_1 };
  await assert.rejects(activate(root, clients({ [SECRET_1]: leaked })),
    { code: "SECRET_ECHO_IN_CONTEXT" });
  const contextDirectory = path.join(paths.tanks, "v2", "baselines", "main", "contexts");
  assert.deepEqual(fs.readdirSync(contextDirectory), []);
});

test("registry lock rejects concurrent update and preserves fingerprint", t => {
  const root = createWorkspace(t);
  const file = workspacePaths(root).registry;
  const before = loadRegistry(file).fingerprint;
  fs.writeFileSync(`${file}.lock`, JSON.stringify({ token: "other" }));
  assert.throws(() => updateProfile(file, "v2", value => value),
    { code: "TANK_REGISTRY_LOCKED" });
  assert.equal(loadRegistry(file).fingerprint, before);
});

test("registry bootstrap and update use the same concurrency lock", t => {
  const root = createWorkspace(t);
  const file = workspacePaths(root).registry;
  fs.writeFileSync(`${file}.lock`, JSON.stringify({ token: "other" }));
  assert.throws(() => bootstrapRegistry(file, { schemaVersion: 1, registryId: "imp1-test",
    profiles: [{ tankProfileId: "v2", alias: "new", ownerScopeId: "same-owner",
      keyEnv: "KEY_V2" }] }), { code: "TANK_REGISTRY_LOCKED" });
});

test("corrupt TankRegistry fails closed without being rewritten", t => {
  const root = createWorkspace(t);
  const file = workspacePaths(root).registry;
  fs.writeFileSync(file, "{corrupt");
  const before = fs.readFileSync(file);
  assert.throws(() => loadRegistry(file));
  assert.equal(fs.readFileSync(file).equals(before), true);
});

test("atomic interruption preserves original file and removes temporary bytes", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-atomic-fault-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "value.txt");
  fs.writeFileSync(file, "original");
  assert.throws(() => writeFileAtomic(file, "replacement", { beforeRename() {
    throw new Error("injected interruption");
  } }), /injected interruption/);
  assert.equal(fs.readFileSync(file, "utf8"), "original");
  assert.deepEqual(fs.readdirSync(root), ["value.txt"]);
});

test("future TankProfiles receive physically isolated run baseline standing and import trees", t => {
  const root = createWorkspace(t, [
    { tankProfileId: "v2", alias: "new", ownerScopeId: "same-owner", keyEnv: "KEY_V2" },
    { tankProfileId: "v3", alias: "future", ownerScopeId: "same-owner", keyEnv: "KEY_V3" }
  ]);
  const tanks = workspacePaths(root).tanks;
  for (const profile of ["v2", "v3"]) {
    for (const owner of ["runs", "baselines", "standing", "imports"]) {
      assert.equal(fs.existsSync(path.join(tanks, profile, owner)), true);
    }
  }
  assert.notEqual(path.join(tanks, "v2"), path.join(tanks, "v3"));
});
