"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { tankPaths, assertBranch } = require("../core/paths");
const { fingerprintObject, sha256Text } = require("../core/hash");
const { invariant } = require("../core/errors");
const { writeFileImmutable, writeJsonAtomic, writeJsonImmutable } =
  require("../core/atomic-file");
const { extractCodeCandidate } = require("../profiles/context-identity");

function archiveBranchBaseline(options) {
  const branch = assertBranch(options.identity.branch);
  const tank = tankPaths(options.workspaceRoot, options.profile.tankProfileId);
  const directory = path.join(tank.baselines, branch);
  const published = extractCodeCandidate(options.context, branch);
  let sourceRelativePath = null;
  if (published.code !== null) {
    invariant(options.identity.publishedCodeHash !== null, "BASELINE_HASH_MISSING",
      "published baseline code requires a code hash");
    invariant(sha256Text(published.code) === options.identity.publishedCodeHash,
      "BASELINE_SOURCE_HASH_MISMATCH", "baseline source bytes changed before archival");
    const source = path.join(directory, "sources", `${options.identity.publishedCodeHash}.js`);
    writeFileImmutable(source, published.code, { mode: 0o600 });
    sourceRelativePath = path.relative(options.workspaceRoot, source);
  }
  const manifest = {
    schemaVersion: 1,
    tankProfileId: options.profile.tankProfileId,
    tankId: options.identity.tankId,
    tankName: options.identity.tankName,
    tankUrlId: options.identity.tankUrlId,
    skillId: options.identity.skillId,
    branch,
    publishedVersion: options.identity.publishedVersion,
    publishedCodeHash: options.identity.publishedCodeHash,
    baselineStatus: options.identity.baselineStatus,
    contextArtifactId: options.contextArtifact.artifactId,
    contextSha256: options.contextArtifact.sha256,
    sourceRelativePath,
    capturedAt: options.now,
    fingerprint: ""
  };
  manifest.fingerprint = fingerprintObject(manifest);
  const immutable = path.join(directory, "history", `baseline-${manifest.fingerprint}.json`);
  writeJsonImmutable(immutable, manifest, { mode: 0o600 });
  writeJsonAtomic(path.join(directory, "baseline-manifest.json"), manifest, { mode: 0o600 });
  return { manifest, relativePath: path.relative(options.workspaceRoot, immutable) };
}

function loadCurrentBaseline(workspaceRoot, profileId, branch = "main") {
  const file = path.join(tankPaths(workspaceRoot, profileId).baselines, assertBranch(branch),
    "baseline-manifest.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

module.exports = { archiveBranchBaseline, loadCurrentBaseline };
