"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeStorageValue, canonicalStorageJson } = require("../core/storage-json");
const { writeJsonImmutable } = require("../core/atomic-file");
const { sha256Text } = require("../core/hash");
const { invariant } = require("../core/errors");
const { sanitizeForStorage } = require("../core/sanitize");
const { tankPaths, workspacePaths, assertBranch } = require("../core/paths");
const { loadRegistry, getProfile, updateProfile, publicProfile } =
  require("../profiles/registry");
const { resolveSecret, validateSecretRef } = require("../profiles/secret-ref");
const { extractContextIdentity, verifyProfileIdentity } = require("../profiles/context-identity");
const { createPlatformClient } = require("./client");
const { archiveBranchBaseline } = require("./baseline-store");
const { storeCapabilityProfile } = require("./capability-store");

function contextArtifact(workspaceRoot, profileId, branch, context) {
  const sanitized = sanitizeForStorage(context);
  const stable = normalizeStorageValue(sanitized);
  const canonical = canonicalStorageJson(stable);
  const sha256 = sha256Text(canonical);
  const artifactId = `ctx_${sha256.slice(0, 24)}`;
  const paths = tankPaths(workspaceRoot, profileId);
  const file = path.join(paths.baselines, branch, "contexts", `${artifactId}.json`);
  writeJsonImmutable(file, stable, { mode: 0o600 });
  return { artifactId, sha256, relativePath: path.relative(workspaceRoot, file), sanitized: stable };
}

function expectedSkillForProfile(workspaceRoot, profileId) {
  const file = workspacePaths(workspaceRoot).bootstrapConfig;
  if (!fs.existsSync(file)) return null;
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const profile = (config.profiles || []).find(item => item.tankProfileId === profileId);
  return profile?.expectedSkillId || null;
}

function expectedTankNameForProfile(workspaceRoot, profileId) {
  const file = workspacePaths(workspaceRoot).bootstrapConfig;
  if (!fs.existsSync(file)) return null;
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const profile = (config.profiles || []).find(item => item.tankProfileId === profileId);
  return profile?.expectedTankName || null;
}

function verifyExpectedIdentity(workspaceRoot, profileId, identity) {
  const expectedSkillId = expectedSkillForProfile(workspaceRoot, profileId);
  const expectedTankName = expectedTankNameForProfile(workspaceRoot, profileId);
  if (expectedSkillId !== null) {
    invariant(identity.skillId === expectedSkillId, "EXPECTED_SKILL_MISMATCH",
      `platform skill does not match configured expectation for ${profileId}`);
  }
  if (expectedTankName !== null) {
    invariant(identity.tankName === expectedTankName, "EXPECTED_TANK_NAME_MISMATCH",
      `platform tank name does not match configured expectation for ${profileId}`);
  }
  return { expectedSkillId, expectedTankName };
}

function mergeBranch(profile, identity, contextArtifactId) {
  const branches = profile.branches.slice();
  const index = branches.findIndex(item => item.branch === identity.branch);
  const branch = {
    branch: identity.branch,
    publishedVersion: identity.publishedVersion,
    publishedCodeHash: identity.publishedCodeHash,
    baselineStatus: identity.baselineStatus,
    contextArtifactId
  };
  if (index >= 0) branches[index] = branch;
  else branches.push(branch);
  return branches.sort((left, right) => left.branch.localeCompare(right.branch));
}

async function fetchContextForProfile(options) {
  const branch = assertBranch(options.branch || "main");
  const registry = loadRegistry(options.registryFile);
  const registeredProfile = getProfile(registry, options.profileId);
  const profile = options.profileOverride || registeredProfile;
  const secretRef = options.secretRefOverride || profile.secretRef;
  validateSecretRef(secretRef);
  const secret = resolveSecret(secretRef, options.environment);
  const client = (options.clientFactory || createPlatformClient)({
    secret,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs
  });
  const context = await client.getTankContext(branch);
  const identity = extractContextIdentity(context, branch);
  verifyProfileIdentity(profile, identity, { allowBootstrap: options.allowBootstrap });
  const expected = verifyExpectedIdentity(options.workspaceRoot, profile.tankProfileId, identity);
  const sanitized = sanitizeForStorage(context);
  invariant(!JSON.stringify(sanitized).includes(secret), "SECRET_ECHO_IN_CONTEXT",
    "platform response secret material survived sanitization; context artifact was rejected");
  const artifact = contextArtifact(options.workspaceRoot, profile.tankProfileId, branch, sanitized);
  return { profile: registeredProfile, identity, artifact, context: sanitized, ...expected,
    registryFingerprint: registry.fingerprint };
}

function storeVerifiedContext(options, fetched, now) {
  const baseline = archiveBranchBaseline({ workspaceRoot: options.workspaceRoot,
    profile: fetched.profile, identity: fetched.identity, context: fetched.context,
    contextArtifact: fetched.artifact, now });
  const capability = storeCapabilityProfile({ workspaceRoot: options.workspaceRoot,
    profile: fetched.profile, identity: fetched.identity, contextArtifact: fetched.artifact, now });
  return { baseline, capability };
}

function publicArtifacts(fetched, stored = null) {
  return {
    artifact: { artifactId: fetched.artifact.artifactId, sha256: fetched.artifact.sha256,
      relativePath: fetched.artifact.relativePath },
    baseline: stored ? { fingerprint: stored.baseline.manifest.fingerprint,
      relativePath: stored.baseline.relativePath } : null,
    capability: stored ? { fingerprint: stored.capability.profile.fingerprint,
      relativePath: stored.capability.relativePath } : null
  };
}

async function registerTankProfile(options) {
  const fetched = await fetchContextForProfile({ ...options, allowBootstrap: true });
  if (fetched.profile.tankId === null) {
    invariant(Number.isSafeInteger(options.expectedTankId), "BOOTSTRAP_TANK_ID_CONFIRMATION_REQUIRED",
      "first TankProfile binding requires --expected-tank-id from a separately inspected context");
    invariant(options.expectedTankId === fetched.identity.tankId,
      "BOOTSTRAP_TANK_ID_CONFIRMATION_MISMATCH", "expected tankId does not match platform context");
  }
  const now = options.now || new Date().toISOString();
  const stored = storeVerifiedContext(options, fetched, now);
  const profile = updateProfile(options.registryFile, options.profileId, current => ({
    ...current,
    status: "ACTIVE",
    tankId: fetched.identity.tankId,
    tankUrlId: fetched.identity.tankUrlId,
    skillId: fetched.identity.skillId,
    skillProvenance: "PLATFORM_CONTEXT",
    branches: mergeBranch(current, fetched.identity, fetched.artifact.artifactId),
    lastVerifiedAt: now
  }), now, { expectedRegistryFingerprint: fetched.registryFingerprint,
    expectedKeyGenerationId: fetched.profile.secretRef.keyGenerationId });
  return { profile: publicProfile(profile), identity: fetched.identity,
    expectedSkillId: fetched.expectedSkillId, expectedTankName: fetched.expectedTankName,
    ...publicArtifacts(fetched, stored) };
}

async function verifyTankContext(options) {
  const fetched = await fetchContextForProfile({ ...options, allowBootstrap: true });
  return { profile: publicProfile(fetched.profile), identity: fetched.identity,
    expectedSkillId: fetched.expectedSkillId, expectedTankName: fetched.expectedTankName,
    ...publicArtifacts(fetched),
    bindingRequired: fetched.profile.status === "BOOTSTRAP" };
}

async function verifyTankProfile(options) {
  const registry = loadRegistry(options.registryFile);
  const current = getProfile(registry, options.profileId);
  invariant(current.status === "ACTIVE" || current.status === "READ_ONLY",
    "PROFILE_NOT_ACTIVE", "verify-profile requires an ACTIVE or READ_ONLY TankProfile");
  const fetched = await fetchContextForProfile({ ...options, allowBootstrap: false });
  const now = options.now || new Date().toISOString();
  const stored = storeVerifiedContext(options, fetched, now);
  const profile = updateProfile(options.registryFile, options.profileId, value => ({
    ...value,
    branches: mergeBranch(value, fetched.identity, fetched.artifact.artifactId),
    lastVerifiedAt: now
  }), now, { expectedRegistryFingerprint: fetched.registryFingerprint,
    expectedKeyGenerationId: fetched.profile.secretRef.keyGenerationId });
  return { profile: publicProfile(profile), identity: fetched.identity,
    expectedSkillId: fetched.expectedSkillId, expectedTankName: fetched.expectedTankName,
    ...publicArtifacts(fetched, stored) };
}

async function rotateTankKey(options) {
  const registry = loadRegistry(options.registryFile);
  const current = getProfile(registry, options.profileId);
  invariant(current.status === "ACTIVE" || current.status === "READ_ONLY",
    "PROFILE_NOT_ACTIVE", "rotate-key requires an ACTIVE or READ_ONLY TankProfile");
  invariant(options.expectedKeyGenerationId === current.secretRef.keyGenerationId,
    "STALE_KEY_GENERATION", "--expected-key-generation does not match the registry");
  const nextSecretRef = { provider: "ENV", name: options.secretRefEnv,
    keyGenerationId: options.keyGenerationId };
  validateSecretRef(nextSecretRef);
  invariant(nextSecretRef.keyGenerationId !== current.secretRef.keyGenerationId,
    "KEY_GENERATION_NOT_ADVANCED", "keyGenerationId must change during rotation");
  const fetched = await fetchContextForProfile({ ...options, allowBootstrap: false,
    profileOverride: current, secretRefOverride: nextSecretRef });
  const now = options.now || new Date().toISOString();
  const stored = storeVerifiedContext(options, fetched, now);
  const profile = updateProfile(options.registryFile, options.profileId, value => ({
    ...value,
    secretRef: nextSecretRef,
    branches: mergeBranch(value, fetched.identity, fetched.artifact.artifactId),
    lastVerifiedAt: now
  }), now, { expectedRegistryFingerprint: registry.fingerprint,
    expectedKeyGenerationId: options.expectedKeyGenerationId });
  return { profile: publicProfile(profile), identity: fetched.identity,
    expectedSkillId: fetched.expectedSkillId, expectedTankName: fetched.expectedTankName,
    ...publicArtifacts(fetched, stored) };
}

function planReadOnlyOperation(options) {
  const branch = assertBranch(options.branch || "main");
  const registry = loadRegistry(options.registryFile);
  const profile = getProfile(registry, options.profileId);
  return {
    dryRun: true,
    operation: options.operation,
    tankProfileId: profile.tankProfileId,
    branch,
    endpoint: branch === "main" ? "/api/agent/tank" : `/api/agent/tank?branch=${branch}`,
    method: "GET",
    platformMutation: false,
    localMutation: false,
    secretResolved: false,
    secretRef: { provider: profile.secretRef.provider, name: profile.secretRef.name,
      keyGenerationId: profile.secretRef.keyGenerationId },
    plannedWrites: [path.relative(options.workspaceRoot,
      path.join(tankPaths(options.workspaceRoot, profile.tankProfileId).baselines, branch))]
  };
}

module.exports = { contextArtifact, expectedSkillForProfile, expectedTankNameForProfile,
  verifyExpectedIdentity, mergeBranch,
  fetchContextForProfile, storeVerifiedContext, registerTankProfile, verifyTankContext,
  verifyTankProfile, rotateTankKey, planReadOnlyOperation };
