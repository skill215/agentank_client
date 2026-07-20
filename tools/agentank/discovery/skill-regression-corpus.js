"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { analyzeSkill } = require("./public-skill-evidence");

const DEFAULT_SUITE = "config/engine-v2/discovery-skill-regression-v1.json";

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function assertFingerprint(value, label) {
  invariant(value && value.fingerprint === fingerprintObject(value),
    "DISCOVERY_SKILL_FINGERPRINT_INVALID", label);
}
function readClaim(value, dottedPath) {
  let current = value;
  for (const part of dottedPath.split(".")) current = current && current[part];
  return current;
}
function runDirectory(root, entry) {
  return contained(root, "battle-records", "discovery", "skills", entry.skill,
    entry.tankUrlId, "runs", entry.runId);
}

function runDiscoverySkillRegression(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const suiteRelativePath = options.suitePath || DEFAULT_SUITE;
  const suiteFile = contained(root, suiteRelativePath); const suiteBytes = fs.readFileSync(suiteFile);
  const suite = JSON.parse(suiteBytes); validateSchemaObject("discovery-skill-regression-suite", suite, root);
  invariant(!suite.tuningAllowed && !suite.calibrationEligible && !suite.frozenEligible,
    "DISCOVERY_SKILL_LANE_VIOLATION", "Discovery replay regression cannot tune or enter Frozen");
  const runReports = []; const uniqueMatches = new Set(); let matchMemberships = 0;
  let verifiedArtifacts = 0; let requiredClaims = 0; let failed = 0;
  for (const entry of suite.runs) {
    const directory = runDirectory(root, entry);
    const manifest = readJson(path.join(directory, "collection-manifest.json"));
    const storedReport = readJson(path.join(directory, "skill-evidence-report.json"));
    assertFingerprint(manifest, `${entry.runId}:collection-manifest`);
    assertFingerprint(storedReport, `${entry.runId}:skill-evidence-report`);
    invariant(manifest.lane === "DISCOVERY" && manifest.skill === entry.skill &&
      manifest.runId === entry.runId && manifest.tank.urlId === entry.tankUrlId,
    "DISCOVERY_SKILL_RUN_IDENTITY_MISMATCH", entry.runId);
    invariant(manifest.matchCount === manifest.matchUrlIds.length &&
      manifest.matchCount >= entry.minimumMatchCount,
    "DISCOVERY_SKILL_RUN_COVERAGE_INSUFFICIENT", entry.runId);
    const matches = [];
    for (const matchUrlId of manifest.matchUrlIds) {
      const matchDirectory = path.join(directory, "matches", matchUrlId);
      const artifactManifest = readJson(path.join(matchDirectory, "artifact-manifest.json"));
      assertFingerprint(artifactManifest, `${entry.runId}:${matchUrlId}:artifact-manifest`);
      invariant(artifactManifest.matchUrlId === matchUrlId,
        "DISCOVERY_SKILL_MATCH_ID_MISMATCH", matchUrlId);
      const values = {};
      for (const kind of ["summary", "events", "raw"]) {
        const bytes = fs.readFileSync(path.join(matchDirectory, `${kind}.json`));
        const metadata = artifactManifest.artifacts[kind];
        invariant(metadata && metadata.sha256 === sha256Bytes(bytes) &&
          metadata.byteLength === bytes.length,
        "DISCOVERY_SKILL_ARTIFACT_HASH_MISMATCH", `${matchUrlId}:${kind}`);
        values[kind] = JSON.parse(bytes); verifiedArtifacts += 1;
      }
      matches.push({ urlId: matchUrlId, summary: values.summary,
        events: values.events, raw: values.raw });
      uniqueMatches.add(matchUrlId); matchMemberships += 1;
    }
    const fresh = analyzeSkill(entry.skill, manifest.tank, matches); const claims = [];
    for (const [claimPath, minimumEvidence] of Object.entries(entry.requiredClaims)) {
      const observed = readClaim(fresh, claimPath); const pass = observed?.status === "CONFIRMED" &&
        observed.evidenceCount >= minimumEvidence;
      if (!pass) failed += 1; requiredClaims += 1;
      claims.push({ claimPath, expectedStatus: "CONFIRMED", minimumEvidence,
        actualStatus: observed?.status || "MISSING", actualEvidence: observed?.evidenceCount || 0, pass });
    }
    runReports.push({ skill: entry.skill, tankUrlId: entry.tankUrlId, runId: entry.runId,
      manifestFingerprint: manifest.fingerprint, storedReportFingerprint: storedReport.fingerprint,
      matchCount: matches.length, codeHashes: fresh.codeHashes || [], claims,
      status: claims.every(item => item.pass) ? "PASS" : "FAIL" });
  }
  const report = { schemaVersion: 1, reportKind: "DISCOVERY_SKILL_REGRESSION",
    suiteId: suite.suiteId, status: failed === 0 ? "PASS" : "FAIL", lane: "DISCOVERY",
    role: "REGRESSION_ONLY", laneIsolation: { tuningAllowed: false,
      calibrationMembership: 0, frozenMembership: 0 }, coverage: {
      runCount: suite.runs.length, matchMemberships, uniqueMatches: uniqueMatches.size,
      verifiedArtifacts, requiredClaims }, runs: runReports, fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  validateSchemaObject("discovery-skill-regression-report", report, root);
  const output = contained(root, "artifacts", "reports", "imp8"); ensureDirectory(output);
  const current = path.join(output, "discovery-skill-regression-report.json");
  const immutable = path.join(output, "history", `discovery-skill-regression-${report.fingerprint}.json`);
  writeJsonAtomic(current, report, { mode: 0o644 });
  writeJsonImmutable(immutable, report, { mode: 0o644 });
  return { report, current, immutable, suite: { relativePath: suiteRelativePath,
    sha256: sha256Bytes(suiteBytes) } };
}

module.exports = { DEFAULT_SUITE, runDiscoverySkillRegression };
