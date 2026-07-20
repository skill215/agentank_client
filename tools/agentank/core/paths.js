"use strict";

const path = require("node:path");
const { invariant } = require("./errors");

const PROFILE_ID = /^[a-z][a-z0-9_-]*$/;
const BRANCHES = new Set(["main", "raid", "multiplayer"]);

function defaultWorkspaceRoot() {
  return path.resolve(__dirname, "../../..");
}

function assertProfileId(profileId) {
  invariant(PROFILE_ID.test(profileId || ""), "INVALID_TANK_PROFILE_ID",
    "tankProfileId must match ^[a-z][a-z0-9_-]*$");
  return profileId;
}

function assertBranch(branch) {
  invariant(BRANCHES.has(branch), "INVALID_BRANCH", "branch must be main, raid, or multiplayer");
  return branch;
}

function contained(root, ...parts) {
  const base = path.resolve(root);
  const resolved = path.resolve(base, ...parts);
  invariant(resolved === base || resolved.startsWith(`${base}${path.sep}`),
    "PATH_ESCAPE", "resolved path escapes its configured root");
  return resolved;
}

function workspacePaths(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const records = contained(root, "battle-records");
  return {
    root,
    records,
    control: contained(records, "control"),
    registry: contained(records, "control", "tank-registry.json"),
    bootstrapConfig: contained(root, "config", "agentank", "profiles.bootstrap.json"),
    artifacts: contained(root, "artifacts"),
    tanks: contained(records, "tanks"),
    corpus: contained(records, "corpus")
  };
}

function tankPaths(workspaceRoot, profileId) {
  assertProfileId(profileId);
  const base = workspacePaths(workspaceRoot);
  const tank = contained(base.tanks, profileId);
  return {
    ...base,
    tank,
    runs: contained(tank, "runs"),
    baselines: contained(tank, "baselines"),
    standing: contained(tank, "standing"),
    imports: contained(tank, "imports")
  };
}

module.exports = {
  PROFILE_ID,
  BRANCHES,
  defaultWorkspaceRoot,
  assertProfileId,
  assertBranch,
  contained,
  workspacePaths,
  tankPaths
};
