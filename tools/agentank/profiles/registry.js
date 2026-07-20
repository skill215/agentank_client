"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { writeJsonAtomic } = require("../core/atomic-file");
const { fingerprintObject } = require("../core/hash");
const { invariant } = require("../core/errors");
const { assertProfileId, BRANCHES } = require("../core/paths");
const { validateSecretRef } = require("./secret-ref");

const SKILLS = new Set(["shield", "freeze", "stun", "overload", "cloak", "poison",
  "teleport", "boost", "UNKNOWN"]);
const PROFILE_STATUS = new Set(["BOOTSTRAP", "ACTIVE", "READ_ONLY", "RETIRED"]);
const BASELINE_STATUS = new Set(["VERIFIED_BASELINE", "UNPUBLISHED", "FALLS_BACK_TO_MAIN", "UNKNOWN"]);

function validateBranch(branch) {
  invariant(branch && BRANCHES.has(branch.branch), "INVALID_PROFILE_BRANCH", "invalid profile branch");
  invariant(branch.publishedVersion === null || Number.isSafeInteger(branch.publishedVersion),
    "INVALID_PUBLISHED_VERSION", "publishedVersion must be an integer or null");
  invariant(branch.publishedCodeHash === null || /^[0-9a-f]{64}$/.test(branch.publishedCodeHash),
    "INVALID_PUBLISHED_HASH", "publishedCodeHash must be sha256 or null");
  invariant(BASELINE_STATUS.has(branch.baselineStatus), "INVALID_BASELINE_STATUS", "invalid baseline status");
}

function validateProfile(profile) {
  assertProfileId(profile.tankProfileId);
  invariant(typeof profile.alias === "string" && profile.alias.length > 0,
    "INVALID_PROFILE_ALIAS", "profile alias is required");
  invariant(PROFILE_STATUS.has(profile.status), "INVALID_PROFILE_STATUS", "invalid profile status");
  invariant(profile.tankId === null || Number.isSafeInteger(profile.tankId),
    "INVALID_TANK_ID", "tankId must be an integer or null");
  invariant(typeof profile.ownerScopeId === "string" && profile.ownerScopeId.length > 0,
    "INVALID_OWNER_SCOPE", "ownerScopeId is required");
  validateSecretRef(profile.secretRef);
  invariant(SKILLS.has(profile.skillId), "INVALID_SKILL_ID", "invalid or unknown skill id");
  invariant(profile.skillProvenance === "UNKNOWN" || profile.skillProvenance === "PLATFORM_CONTEXT",
    "INVALID_SKILL_PROVENANCE", "invalid skill provenance");
  invariant(Array.isArray(profile.branches) && profile.branches.length > 0,
    "MISSING_PROFILE_BRANCH", "at least one branch is required");
  const seen = new Set();
  for (const branch of profile.branches) {
    validateBranch(branch);
    invariant(!seen.has(branch.branch), "DUPLICATE_PROFILE_BRANCH", "profile branch appears more than once");
    seen.add(branch.branch);
  }
}

function validateRegistry(registry, options = {}) {
  invariant(registry && registry.schemaVersion === 1, "INVALID_REGISTRY_SCHEMA", "registry schemaVersion must be 1");
  invariant(typeof registry.registryId === "string" && registry.registryId.length > 0,
    "INVALID_REGISTRY_ID", "registryId is required");
  invariant(Array.isArray(registry.profiles) && registry.profiles.length > 0,
    "EMPTY_TANK_REGISTRY", "registry must contain at least one TankProfile");
  const ids = new Set();
  const aliases = new Set();
  for (const profile of registry.profiles) {
    validateProfile(profile);
    invariant(!ids.has(profile.tankProfileId), "DUPLICATE_TANK_PROFILE", "tankProfileId must be unique");
    invariant(!aliases.has(profile.alias), "DUPLICATE_TANK_ALIAS", "TankProfile alias must be unique");
    ids.add(profile.tankProfileId);
    aliases.add(profile.alias);
  }
  if (options.verifyFingerprint !== false) {
    invariant(/^[0-9a-f]{64}$/.test(registry.fingerprint || ""),
      "INVALID_REGISTRY_FINGERPRINT", "registry fingerprint is missing");
    invariant(fingerprintObject(registry) === registry.fingerprint,
      "REGISTRY_FINGERPRINT_MISMATCH", "registry fingerprint does not match its content");
  }
  return registry;
}

function loadRegistry(file, options = {}) {
  if (!fs.existsSync(file)) {
    if (options.allowMissing) return null;
    invariant(false, "TANK_REGISTRY_NOT_FOUND", `TankRegistry does not exist at ${file}`);
  }
  return validateRegistry(JSON.parse(fs.readFileSync(file, "utf8")));
}

function finalizeRegistry(registry, now = new Date().toISOString()) {
  const value = {
    ...registry,
    profiles: registry.profiles.slice().sort((left, right) =>
      left.tankProfileId.localeCompare(right.tankProfileId)),
    updatedAt: now,
    fingerprint: ""
  };
  value.fingerprint = fingerprintObject(value);
  return validateRegistry(value);
}

function bootstrapProfile(template, now) {
  assertProfileId(template.tankProfileId);
  invariant(/^[A-Z][A-Z0-9_]*$/.test(template.keyEnv || ""),
    "INVALID_BOOTSTRAP_KEY_ENV", "bootstrap keyEnv must be an environment variable name");
  return {
    tankProfileId: template.tankProfileId,
    alias: template.alias,
    status: "BOOTSTRAP",
    tankId: null,
    tankUrlId: null,
    ownerScopeId: template.ownerScopeId,
    secretRef: { provider: "ENV", name: template.keyEnv, keyGenerationId: "initial" },
    skillId: "UNKNOWN",
    skillProvenance: "UNKNOWN",
    branches: [{
      branch: "main",
      publishedVersion: null,
      publishedCodeHash: null,
      baselineStatus: "UNKNOWN",
      contextArtifactId: null
    }],
    createdAt: now,
    updatedAt: now,
    lastVerifiedAt: null
  };
}

function bootstrapRegistry(file, bootstrapConfig, now = new Date().toISOString()) {
  return withRegistryLock(file, () => {
    invariant(bootstrapConfig && bootstrapConfig.schemaVersion === 1,
      "INVALID_BOOTSTRAP_CONFIG", "bootstrap config schemaVersion must be 1");
    invariant(Array.isArray(bootstrapConfig.profiles) && bootstrapConfig.profiles.length > 0,
      "EMPTY_BOOTSTRAP_CONFIG", "bootstrap config must contain profiles");
    const existing = loadRegistry(file, { allowMissing: true });
    const registry = existing || {
      schemaVersion: 1,
      registryId: bootstrapConfig.registryId,
      profiles: [],
      updatedAt: now,
      fingerprint: ""
    };
    const known = new Set(registry.profiles.map(profile => profile.tankProfileId));
    const added = [];
    for (const template of bootstrapConfig.profiles) {
      if (known.has(template.tankProfileId)) continue;
      registry.profiles.push(bootstrapProfile(template, now));
      known.add(template.tankProfileId);
      added.push(template.tankProfileId);
    }
    if (!existing || added.length > 0) writeJsonAtomic(file, finalizeRegistry(registry, now));
    return { registry: loadRegistry(file), added, changed: !existing || added.length > 0 };
  });
}

function withRegistryLock(file, callback) {
  const lockFile = `${file}.lock`;
  const token = crypto.randomUUID();
  let descriptor;
  try {
    descriptor = fs.openSync(lockFile, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify({ token, pid: process.pid }));
    fs.closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (error.code === "EEXIST") {
      invariant(false, "TANK_REGISTRY_LOCKED", "TankRegistry is being updated by another process");
    }
    throw error;
  }
  try {
    return callback();
  } finally {
    try {
      const held = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      if (held.token === token) fs.unlinkSync(lockFile);
    } catch {}
  }
}

function updateProfile(file, profileId, updater, now = new Date().toISOString(), options = {}) {
  return withRegistryLock(file, () => {
    const registry = loadRegistry(file);
    if (options.expectedRegistryFingerprint !== undefined) {
      invariant(registry.fingerprint === options.expectedRegistryFingerprint,
        "TANK_REGISTRY_STALE_REVISION", "TankRegistry changed before profile update");
    }
    const index = registry.profiles.findIndex(profile => profile.tankProfileId === profileId);
    invariant(index >= 0, "TANK_PROFILE_NOT_FOUND", `TankProfile ${profileId} does not exist`);
    if (options.expectedKeyGenerationId !== undefined) {
      invariant(registry.profiles[index].secretRef.keyGenerationId === options.expectedKeyGenerationId,
        "STALE_KEY_GENERATION", "TankProfile key generation changed before update");
    }
    const updated = updater(structuredClone(registry.profiles[index]));
    updated.updatedAt = now;
    registry.profiles[index] = updated;
    const finalized = finalizeRegistry(registry, now);
    writeJsonAtomic(file, finalized);
    return finalized.profiles.find(profile => profile.tankProfileId === profileId);
  });
}

function getProfile(registry, profileId) {
  assertProfileId(profileId);
  const profile = registry.profiles.find(item => item.tankProfileId === profileId);
  invariant(profile, "TANK_PROFILE_NOT_FOUND", `TankProfile ${profileId} does not exist`);
  return profile;
}

function publicProfile(profile) {
  return {
    tankProfileId: profile.tankProfileId,
    alias: profile.alias,
    status: profile.status,
    tankId: profile.tankId,
    tankUrlId: profile.tankUrlId,
    ownerScopeId: profile.ownerScopeId,
    secretRef: { ...profile.secretRef },
    skillId: profile.skillId,
    skillProvenance: profile.skillProvenance,
    branches: profile.branches.map(branch => ({ ...branch })),
    lastVerifiedAt: profile.lastVerifiedAt
  };
}

module.exports = {
  SKILLS,
  validateRegistry,
  loadRegistry,
  finalizeRegistry,
  bootstrapRegistry,
  withRegistryLock,
  updateProfile,
  getProfile,
  publicProfile
};
