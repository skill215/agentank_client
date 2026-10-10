"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

function resolveFrozenV1(workspaceRoot = path.resolve(__dirname, "../../..")) {
  const manifestFile = path.join(workspaceRoot,
    "artifacts/imp8/frozen/candidate-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const relativePath = manifest?.selection?.frozenV1RelativePath;
  const expectedSha256 = manifest?.selection?.v1Sha256;
  if (!relativePath || !expectedSha256) throw new Error("V3_FROZEN_V1_MANIFEST_INCOMPLETE");
  const sourceFile = path.resolve(workspaceRoot, relativePath);
  if (!sourceFile.startsWith(`${path.resolve(workspaceRoot)}${path.sep}`))
    throw new Error("V3_FROZEN_V1_PATH_ESCAPES_WORKSPACE");
  const bytes = fs.readFileSync(sourceFile);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256)
    throw new Error(`V3_FROZEN_V1_HASH_MISMATCH:${actualSha256}`);
  return { workspaceRoot, manifestFile, sourceFile, source: bytes.toString("utf8"),
    sha256: actualSha256 };
}

module.exports = { resolveFrozenV1, sha256 };
