"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { canonicalJson } = require("../core/canonical-json");
const { sha256Text, fingerprintObject } = require("../core/hash");
const { writeJsonAtomic, ensureDirectory } = require("../core/atomic-file");
const { invariant } = require("../core/errors");
const { validateSchemaObject } = require("../core/schema-validator");

function revisionFile(runDirectory, revision) {
  return path.join(runDirectory, `run-manifest.r${String(revision).padStart(3, "0")}.json`);
}

function revisionSha256(manifest) {
  return sha256Text(canonicalJson(manifest));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadLatestRun(runDirectory) {
  const file = path.join(runDirectory, "run-manifest.json");
  if (!fs.existsSync(file)) return null;
  const value = readJson(file);
  validateSchemaObject("platform-run", value);
  invariant(fingerprintObject(value) === value.fingerprint, "RUN_FINGERPRINT_MISMATCH",
    "latest RunManifest fingerprint is invalid");
  return value;
}

function commitRunRevision(runDirectory, proposed, options = {}) {
  ensureDirectory(runDirectory);
  const previous = loadLatestRun(runDirectory);
  const revision = previous === null ? 0 : previous.revision + 1;
  if (options.expectedRevision !== undefined) {
    invariant(options.expectedRevision === revision, "RUN_REVISION_CONFLICT",
      "RunManifest revision changed before commit");
  }
  const now = options.now || new Date().toISOString();
  const value = {
    ...structuredClone(proposed),
    createdAt: previous ? previous.createdAt : (proposed.createdAt || now),
    updatedAt: now,
    revision,
    previousRevisionSha256: previous === null ? null : revisionSha256(previous),
    fingerprint: ""
  };
  value.fingerprint = fingerprintObject(value);
  validateSchemaObject("platform-run", value);
  const immutableFile = revisionFile(runDirectory, revision);
  invariant(!fs.existsSync(immutableFile), "RUN_REVISION_ALREADY_EXISTS",
    `RunManifest revision ${revision} already exists`);
  writeJsonAtomic(immutableFile, value);
  writeJsonAtomic(path.join(runDirectory, "run-manifest.json"), value);
  return { manifest: value, revisionFile: immutableFile, revisionSha256: revisionSha256(value) };
}

function verifyRunChain(runDirectory) {
  const latest = loadLatestRun(runDirectory);
  invariant(latest !== null, "RUN_MANIFEST_NOT_FOUND", "RunManifest does not exist");
  let previous = null;
  for (let revision = 0; revision <= latest.revision; revision++) {
    const file = revisionFile(runDirectory, revision);
    invariant(fs.existsSync(file), "RUN_REVISION_MISSING", `RunManifest revision ${revision} is missing`);
    const value = readJson(file);
    validateSchemaObject("platform-run", value);
    invariant(value.revision === revision, "RUN_REVISION_NUMBER_MISMATCH",
      `RunManifest revision number mismatch at ${revision}`);
    invariant(fingerprintObject(value) === value.fingerprint, "RUN_FINGERPRINT_MISMATCH",
      `RunManifest fingerprint mismatch at revision ${revision}`);
    const expectedPrevious = previous === null ? null : revisionSha256(previous);
    invariant(value.previousRevisionSha256 === expectedPrevious, "RUN_PREVIOUS_HASH_MISMATCH",
      `RunManifest previous hash mismatch at revision ${revision}`);
    previous = value;
  }
  invariant(revisionSha256(previous) === revisionSha256(latest), "RUN_LATEST_POINTER_MISMATCH",
    "run-manifest.json does not match the final immutable revision");
  return { ok: true, revisions: latest.revision + 1, latestRevision: latest.revision,
    latestSha256: revisionSha256(latest) };
}

module.exports = {
  revisionFile,
  revisionSha256,
  loadLatestRun,
  commitRunRevision,
  verifyRunChain
};
