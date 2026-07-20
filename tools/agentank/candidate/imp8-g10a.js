"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { runPairedArena } = require("../simulation/paired-arena");
const { runDiscoverySkillRegression } = require("../discovery/skill-regression-corpus");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function loadFrozenCandidate(root, manifestPath) {
  const relativePath = manifestPath || "artifacts/imp8/frozen/candidate-manifest.json";
  const file = contained(root, relativePath); invariant(fs.existsSync(file),
    "IMP8_FROZEN_CANDIDATE_MISSING", relativePath); const bytes = fs.readFileSync(file);
  const manifest = JSON.parse(bytes); validateSchemaObject("imp8-candidate-manifest", manifest, root);
  invariant(manifest.status === "FROZEN" && manifest.fingerprint === fingerprintObject(manifest),
    "IMP8_FROZEN_CANDIDATE_INVALID", relativePath);
  const minified = contained(root, manifest.build.minifiedRelativePath);
  invariant(fs.existsSync(minified) && sha256Bytes(fs.readFileSync(minified)) ===
    manifest.build.minifiedSha256, "IMP8_FROZEN_BUILD_HASH_MISMATCH", manifest.candidateId);
  const v1 = contained(root, manifest.selection.frozenV1RelativePath);
  invariant(fs.existsSync(v1) && sha256Bytes(fs.readFileSync(v1)) === manifest.selection.v1Sha256,
    "IMP8_FROZEN_V1_HASH_MISMATCH", manifest.candidateId);
  return { manifest, file, bytes, relativePath: path.relative(root, file).replaceAll("\\", "/"),
    v1File: v1 };
}
function v2Options(parameters) {
  return { engine: { runtime: { runtimeConfig: Object.freeze({ ...parameters.runtimeConfig,
    WORK_CHARGES: Object.freeze(parameters.runtimeConfig.WORK_CHARGES.slice()) }),
    searchBudget: Object.freeze({
      DECISION_DEPTH: Object.freeze(parameters.searchBudget.DECISION_DEPTH.slice()),
      NODE_BUDGET: Object.freeze(parameters.searchBudget.NODE_BUDGET.slice()),
      PROOF_BUDGET: Object.freeze(parameters.searchBudget.PROOF_BUDGET.slice()),
      MATRIX_ITERATIONS: Object.freeze(parameters.searchBudget.MATRIX_ITERATIONS.slice()),
      MATRIX_BATCH: Object.freeze(parameters.searchBudget.MATRIX_BATCH.slice()) }) },
    tactical: Object.freeze({ ...parameters.tacticalConfig }) } };
}
function gateCheck(checkId, actual, maximum = 0) {
  return { checkId, status: actual <= maximum ? "PASS" : "FAIL", actual, maximum };
}
async function runImp8G10a(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const frozen = loadFrozenCandidate(root, options.manifestPath);
  const discovery = runDiscoverySkillRegression({ workspaceRoot: root });
  const output = contained(root, "artifacts", "imp8", "frozen", "candidates",
    frozen.manifest.candidateId, "g10a"); ensureDirectory(output);
  const arena = await runPairedArena({ workspaceRoot: root, role: "FROZEN_REGRESSION",
    repetitions: 1, timeoutMs: 200, experimentId: "IMP8_G10A_FROZEN_V1",
    v1File: frozen.v1File, v1RelativePath: frozen.manifest.selection.frozenV1RelativePath,
    candidateProfileId: frozen.manifest.selection.candidateProfileId,
    candidateBinding: { candidateId: frozen.manifest.candidateId,
      candidateFingerprint: frozen.manifest.fingerprint,
      publishArtifactSha256: frozen.manifest.build.minifiedSha256 },
    outputDirectory: path.join(output, "arena"), v2Options: v2Options(frozen.manifest.parameters),
    onProgress: options.onProgress });
  const arenaFile = path.join(arena.directory, "paired-arena-report.json");
  const discoveryFile = discovery.current; const inv = arena.report.invariants;
  const discoveryFailures = discovery.report.runs.filter(item => item.status !== "PASS").length +
    (discovery.report.status === "PASS" ? 0 : 1);
  const runtimeFailures = arena.report.summary.v2Timeouts + arena.report.summary.v2Errors;
  const checks = [
    gateCheck("FROZEN_ARENA_COMPLETE", arena.report.gateEligible && arena.report.summary.complete ? 0 : 1),
    gateCheck("NATIVE_CRITICAL_ERRORS", inv.nativeCriticalErrors),
    gateCheck("NATIVE_AVOIDABLE_HARD_REJECTS", inv.nativeAvoidableHardRejects),
    gateCheck("ALL_AVOIDABLE_HARD_REJECTS", inv.avoidableHardRejects),
    gateCheck("ROOT_RESTORE_FAILURES", inv.rootRestoreFailures),
    gateCheck("HOT_ALLOCATIONS", inv.hotAllocations),
    gateCheck("RUNTIME_FAILURES", runtimeFailures),
    gateCheck("DISCOVERY_SKILL_REGRESSION_FAILURES", discoveryFailures)
  ];
  const report = { schemaVersion: 1, reportKind: "IMP8_G10A_FROZEN",
    status: checks.every(item => item.status === "PASS") && arena.report.status === "PASS" ?
      "PASS" : "FAIL", candidate: { candidateId: frozen.manifest.candidateId,
      fingerprint: frozen.manifest.fingerprint, manifestRelativePath: frozen.relativePath,
      manifestSha256: sha256Bytes(frozen.bytes),
      publishArtifactSha256: frozen.manifest.build.minifiedSha256 },
    frozenArena: { status: arena.report.status,
      relativePath: path.relative(root, arenaFile).replaceAll("\\", "/"),
      fingerprint: arena.report.fingerprint, sha256: sha256Bytes(fs.readFileSync(arenaFile)),
      gateEligible: arena.report.gateEligible, role: arena.report.role,
      scenarioCount: arena.report.summary.scenarioCount, matchCount: arena.report.summary.matchCount,
      invariants: { ...inv } }, discoverySkillRegression: { status: discovery.report.status,
      relativePath: path.relative(root, discoveryFile).replaceAll("\\", "/"),
      fingerprint: discovery.report.fingerprint, sha256: sha256Bytes(fs.readFileSync(discoveryFile)),
      lane: discovery.report.lane, membershipCount: discovery.report.coverage.matchMemberships },
    thresholds: { nativeCriticalErrorsMax: 0, nativeAvoidableHardRejectsMax: 0,
      allAvoidableHardRejectsMax: 0, rootRestoreFailuresMax: 0, hotAllocationsMax: 0,
      runtimeFailuresMax: 0, discoveryFailuresMax: 0 },
    checks, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); validateSchemaObject("imp8-g10a-report", report, root);
  const current = contained(root, "artifacts", "imp8", "frozen", "g10a-report.json");
  writeJsonImmutable(path.join(output, "history", `g10a-${report.fingerprint}.json`), report,
    { mode: 0o644 });
  writeJsonAtomic(path.join(output, "g10a-report.json"), report, { mode: 0o644 });
  writeJsonAtomic(current, report, { mode: 0o644 });
  return { report, current, directory: output, arena: arena.report };
}

module.exports = { loadFrozenCandidate, v2Options, gateCheck, runImp8G10a };
