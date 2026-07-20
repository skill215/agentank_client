"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ensureDirectory } = require("../core/atomic-file");
const { invariant } = require("../core/errors");
const { workspacePaths, tankPaths, defaultWorkspaceRoot } = require("../core/paths");
const { bootstrapRegistry } = require("../profiles/registry");
const { validateSchemaObject } = require("../core/schema-validator");
const { SKILLS } = require("../profiles/registry");

function readBootstrapConfig(file) {
  invariant(fs.existsSync(file), "BOOTSTRAP_CONFIG_NOT_FOUND", `bootstrap config not found at ${file}`);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const profile of value.profiles || []) {
    if (profile.expectedSkillId !== undefined) {
      invariant(SKILLS.has(profile.expectedSkillId) && profile.expectedSkillId !== "UNKNOWN",
        "INVALID_EXPECTED_SKILL", "bootstrap expectedSkillId must name a supported skill");
    }
    if (profile.expectedTankName !== undefined) {
      invariant(typeof profile.expectedTankName === "string" && profile.expectedTankName.length > 0,
        "INVALID_EXPECTED_TANK_NAME", "bootstrap expectedTankName must be a non-empty string");
    }
  }
  return value;
}

function ensurePlatformDirectories(workspaceRoot, profiles) {
  const common = workspacePaths(workspaceRoot);
  const directories = [
    common.control,
    path.join(common.control, "capabilities"),
    path.join(common.control, "locks"),
    path.join(common.control, "rate-limit"),
    common.tanks,
    common.corpus,
    path.join(common.corpus, "ledger"),
    path.join(common.corpus, "heads"),
    path.join(common.corpus, "snapshots"),
    path.join(common.corpus, "cohorts"),
    path.join(common.corpus, "forward"),
    common.artifacts,
    path.join(common.artifacts, "builds"),
    path.join(common.artifacts, "candidates"),
    path.join(common.artifacts, "reports")
  ];
  for (const profile of profiles) {
    const tank = tankPaths(workspaceRoot, profile.tankProfileId);
    directories.push(tank.tank, tank.runs, tank.baselines, tank.standing, tank.imports);
    for (const branch of ["main", "raid", "multiplayer"]) {
      directories.push(path.join(tank.baselines, branch),
        path.join(tank.baselines, branch, "contexts"),
        path.join(common.control, "capabilities", profile.tankProfileId, branch));
    }
  }
  for (const directory of directories) ensureDirectory(directory);
  return directories.sort();
}

function bootstrapPlatform(workspaceRoot, now = new Date().toISOString(),
  schemaWorkspaceRoot = defaultWorkspaceRoot()) {
  const paths = workspacePaths(workspaceRoot);
  const config = readBootstrapConfig(paths.bootstrapConfig);
  const directories = ensurePlatformDirectories(workspaceRoot, config.profiles);
  const result = bootstrapRegistry(paths.registry, config, now);
  validateSchemaObject("tank-registry", result.registry, schemaWorkspaceRoot);
  return {
    changed: result.changed,
    addedProfiles: result.added,
    registryFingerprint: result.registry.fingerprint,
    tankProfiles: result.registry.profiles.map(profile => profile.tankProfileId),
    ensuredDirectoryCount: directories.length
  };
}

module.exports = { readBootstrapConfig, ensurePlatformDirectories, bootstrapPlatform };
