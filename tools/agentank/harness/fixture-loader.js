"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { canonicalJson } = require("../core/canonical-json");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { invariant } = require("../core/errors");
const { contained, defaultWorkspaceRoot } = require("../core/paths");
const { validateSchemaObject } = require("../core/schema-validator");

function loadFixtureSet(workspaceRoot = defaultWorkspaceRoot(), manifestFile) {
  const root = path.resolve(workspaceRoot);
  const file = manifestFile || contained(root, "config", "agentank", "imp0-fixtures.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  validateSchemaObject("imp0-fixture-manifest", manifest, root);
  const fixtureRoot = contained(root, "engine-v2", "test", "fixture");
  const seen = new Set();
  const fixtures = manifest.fixtures.map(entry => {
    invariant(!seen.has(entry.fixtureId), "DUPLICATE_FIXTURE_ID",
      `duplicate fixture id: ${entry.fixtureId}`);
    seen.add(entry.fixtureId);
    const fixtureFile = contained(root, entry.relativePath);
    invariant(fixtureFile.startsWith(`${fixtureRoot}${path.sep}`), "FIXTURE_PATH_OUTSIDE_ROOT",
      "fixture path must stay under engine-v2/test/fixture");
    invariant(fs.existsSync(fixtureFile), "FIXTURE_FILE_NOT_FOUND",
      `fixture file not found: ${entry.relativePath}`);
    const bytes = fs.readFileSync(fixtureFile);
    const value = JSON.parse(bytes.toString("utf8"));
    invariant(value.fixtureId === entry.fixtureId, "FIXTURE_ID_MISMATCH",
      `fixture id mismatch in ${entry.relativePath}`);
    return {
      fixtureId: entry.fixtureId,
      relativePath: entry.relativePath,
      bytes: bytes.length,
      rawSha256: sha256Bytes(bytes),
      semanticSha256: sha256Text(canonicalJson(value)),
      value
    };
  });
  const summary = {
    schemaVersion: 1,
    fixtureSetId: manifest.fixtureSetId,
    fixtureCount: fixtures.length,
    fixtures: fixtures.map(({ value, ...entry }) => entry)
  };
  return { manifest, fixtures, summary, fingerprint: fingerprintObject(summary) };
}

module.exports = { loadFixtureSet };
