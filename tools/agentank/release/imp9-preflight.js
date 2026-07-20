"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { loadRegistry, getProfile } = require("../profiles/registry");
const { sha256Text } = require("../core/hash");
const { canonicalStorageJson } = require("../core/storage-json");
const { verifyLiveContext, assertAttestationBinding } = require("./imp9-guards");
const { measureCodeSize } = require("../platform/code-size-policy");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function optionalJson(file) { return fs.existsSync(file) ? readJson(file) : null; }
function finalized(value) { value.fingerprint = fingerprintObject(value); return value; }

function loadImp8Acceptance(root) {
  const relativePath = "artifacts/reports/acceptance/IMP8/imp8-acceptance-report.json";
  const file = contained(root, relativePath); const report = optionalJson(file);
  return { relativePath, exists: report !== null, status: report?.status || "MISSING",
    fingerprint: report?.fingerprint || null, accepted: report?.status === "ACCEPTED" };
}

function loadImp8Readiness(root) {
  const file = contained(root, "artifacts", "reports", "imp8", "candidate-readiness-report.json");
  invariant(fs.existsSync(file), "IMP8_READINESS_NOT_FOUND",
    "run IMP8 verify before IMP9 preflight");
  const report = readJson(file); validateSchemaObject("imp8-readiness-report", report, root);
  invariant(fingerprintObject(report) === report.fingerprint, "IMP8_READINESS_FINGERPRINT_MISMATCH",
    "IMP8 readiness evidence changed");
  return report;
}

function verifyRollback(root, target) {
  const relativePath = `battle-records/tanks/${target.tankProfileId}/baselines/${target.branch}/baseline-manifest.json`;
  const manifest = readJson(contained(root, relativePath));
  const source = manifest.sourceRelativePath ? contained(root, manifest.sourceRelativePath) : null;
  const sourceExists = Boolean(source && fs.existsSync(source));
  const exactSourceHash = sourceExists && sha256Bytes(fs.readFileSync(source)) === manifest.publishedCodeHash;
  const identityExact = manifest.tankProfileId === target.tankProfileId &&
    manifest.tankId === target.tankId && manifest.tankUrlId === target.tankUrlId &&
    manifest.skillId === target.skillId && manifest.branch === target.branch;
  const status = manifest.baselineStatus === "VERIFIED_BASELINE" && identityExact && exactSourceHash ?
    "PASS" : "FAIL";
  return { status, mode: manifest.baselineStatus === "VERIFIED_BASELINE" ?
    "VERIFIED_BASELINE" : "FIRST_PUBLISH_NO_ROLLBACK", relativePath,
    baselineFingerprint: manifest.fingerprint, artifactSha256: manifest.publishedCodeHash,
    sourceRelativePath: manifest.sourceRelativePath, sourceExists, exactSourceHash, identityExact };
}

function inspectCandidate(root, readiness) {
  const identity = readiness.candidateIdentity; const relativePath = readiness.buildReproducibility.minifiedFile;
  const file = relativePath ? contained(root, relativePath) : null;
  const artifactExists = Boolean(file && fs.existsSync(file));
  const artifactBytes = artifactExists ? fs.readFileSync(file) : null;
  const actualSha256 = artifactBytes ? sha256Bytes(artifactBytes) : null;
  const exactArtifact = actualSha256 !== null && actualSha256 === identity.publishArtifactSha256;
  const codeSize = artifactBytes ? measureCodeSize(artifactBytes.toString("utf8")) : null;
  const codeSizeWithinLimit = codeSize?.withinLimit === true;
  return { status: identity.candidateFrozen && exactArtifact && codeSizeWithinLimit ? "PASS" : "BLOCKED",
    candidateId: identity.candidateId, candidateFingerprint: identity.candidateFingerprint,
    candidateFrozen: identity.candidateFrozen, targetTankProfileId: identity.targetTankProfileId,
    targetTankId: identity.targetTankId, targetSkillId: identity.targetSkillId,
    branch: identity.branch, publishArtifactKind: identity.publishArtifactKind,
    publishArtifactRelativePath: relativePath, publishArtifactSha256: identity.publishArtifactSha256,
    publishArtifactBytes: identity.publishArtifactBytes, artifactExists, actualSha256, exactArtifact,
    codeSizeWithinLimit, platformCodeLimitBytes: codeSize?.maximumCodeBytes ?? null,
    platformCodeHeadroomBytes: codeSize?.headroomBytes ?? null };
}

function inspectLocalQualification(root, suite, target, candidate) {
  const config = suite.localQualification;
  if (!config || !candidate.candidateId) return { status: "NOT_RUN",
    reason: "LOCAL_QUALIFICATION_CONFIG_OR_CANDIDATE_MISSING", attestationFile: null,
    attestationFingerprint: null, engineEvidenceFingerprint: null };
  const directory = contained(root, "battle-records", "tanks", target.tankProfileId, "runs",
    `imp9-${candidate.candidateId}`);
  const file = path.join(directory, config.candidateAttestationFileName);
  if (!fs.existsSync(file)) return { status: "NOT_RUN",
    reason: "LOCAL_QUALIFICATION_ATTESTATION_MISSING", attestationFile: file,
    attestationFingerprint: null, engineEvidenceFingerprint: null };
  const attestation = readJson(file); const contractFile = contained(root,
    config.contractRelativePath); const requirementsFile = contained(root,
    config.requirementsRelativePath);
  invariant(attestation.fingerprint === fingerprintObject(attestation) &&
    attestation.reportKind === "V2_CANDIDATE_LOCAL_QUALIFICATION_ATTESTATION",
  "IMP9_LOCAL_QUALIFICATION_ATTESTATION_INVALID", candidate.candidateId);
  invariant(attestation.candidateId === candidate.candidateId &&
    attestation.candidateFingerprint === candidate.candidateFingerprint &&
    attestation.publishArtifactSha256 === candidate.publishArtifactSha256 &&
    attestation.targetTankProfileId === target.tankProfileId &&
    attestation.contractSha256 === sha256Bytes(fs.readFileSync(contractFile)) &&
    attestation.requirementsSha256 === sha256Bytes(fs.readFileSync(requirementsFile)),
  "IMP9_LOCAL_QUALIFICATION_BINDING_MISMATCH", candidate.candidateId);
  const engineFile = contained(root, attestation.engineEvidenceRelativePath);
  const engineBytes = fs.readFileSync(engineFile); const engine = JSON.parse(engineBytes);
  invariant(sha256Bytes(engineBytes) === attestation.engineEvidenceSha256 &&
    engine.fingerprint === attestation.engineEvidenceFingerprint &&
    engine.fingerprint === fingerprintObject(engine),
  "IMP9_LOCAL_QUALIFICATION_ENGINE_EVIDENCE_INVALID", candidate.candidateId);
  const pass = engine.structuralGate?.pass === true && engine.performanceGate?.pass === true &&
    (!config.requireGameplayReviewClosed || attestation.gameplayReview?.reviewed === true) &&
    (!config.requireEngineEvidencePass || engine.status === "PASS" ||
      engine.status === "PASS_PENDING_GAMEPLAY_REVIEW");
  return { status: pass ? "PASS" : "BLOCKED", reason: pass ? null :
    "LOCAL_QUALIFICATION_REVIEW_OR_GATE_INCOMPLETE", attestationFile: file,
    attestationFingerprint: attestation.fingerprint,
    engineEvidenceFingerprint: engine.fingerprint,
    exactPublishArtifactBinding: attestation.publishArtifactSha256 ===
      candidate.publishArtifactSha256, gameplayReview: attestation.gameplayReview || null };
}

function inspectSimulationEvidence(root, suite, target, candidate) {
  if (!candidate.candidateId) return null;
  const directory = contained(root, "battle-records", "tanks", target.tankProfileId, "runs",
    `imp9-${candidate.candidateId}`);
  const contextFile = path.join(directory, "context.json");
  const attestationFile = path.join(directory, "simulation-attestation.json");
  const reportFile = path.join(directory, "simulation-run-report.json");
  if (!fs.existsSync(contextFile) || !fs.existsSync(reportFile)) return null;
  const context = readJson(contextFile); const report = readJson(reportFile);
  verifyLiveContext(context, target, suite);
  invariant(report.fingerprint === fingerprintObject(report) &&
    report.candidateId === candidate.candidateId &&
    report.publishArtifactSha256 === candidate.publishArtifactSha256 && report.challengeCount === 0,
  "IMP9_SIMULATION_REPORT_INVALID", candidate.candidateId);
  if (report.status === "FAIL") return { status: "FAIL", directory, contextFile,
    attestationFile: null, reportFile, context, attestation: null, report };
  invariant(fs.existsSync(attestationFile), "IMP9_SIMULATION_ATTESTATION_MISSING", candidate.candidateId);
  const attestation = readJson(attestationFile);
  invariant(attestation.fingerprint === fingerprintObject(attestation),
    "IMP9_ATTESTATION_FINGERPRINT_MISMATCH", candidate.candidateId);
  assertAttestationBinding(attestation, target, candidate);
  invariant(attestation.suiteVersion === suite.suiteVersion &&
    suite.cases.every(item => attestation.caseIds.includes(item.caseId)) &&
    attestation.liveContextSha256 === sha256Text(canonicalStorageJson(context)),
  "IMP9_SIMULATION_EVIDENCE_BINDING_MISMATCH", candidate.candidateId);
  invariant(report.status === "PASS" &&
    report.attestationFingerprint === attestation.fingerprint && report.challengeCount === 0,
  "IMP9_SIMULATION_REPORT_INVALID", candidate.candidateId);
  return { status: "PASS", directory, contextFile, attestationFile, reportFile,
    context, attestation, report };
}

function inspectImp9Readiness(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const suite = readJson(contained(root, "config", "engine-v2", "imp9-official-suite.json"));
  const prerequisite = loadImp8Acceptance(root); const imp8 = loadImp8Readiness(root);
  const registry = loadRegistry(contained(root, "battle-records", "control", "tank-registry.json"));
  const profile = getProfile(registry, suite.target.tankProfileId); const candidate = inspectCandidate(root, imp8);
  const target = { ...suite.target, registryFingerprint: registry.fingerprint,
    keyGenerationId: profile.secretRef.keyGenerationId, secretRefName: profile.secretRef.name };
  const profileExact = profile.status === "ACTIVE" && profile.tankId === target.tankId &&
    profile.tankUrlId === target.tankUrlId && profile.skillId === target.skillId &&
    candidate.targetTankProfileId === target.tankProfileId && candidate.targetTankId === target.tankId &&
    candidate.targetSkillId === target.skillId && candidate.branch === target.branch;
  const rollback = verifyRollback(root, target);
  const localQualification = inspectLocalQualification(root, suite, target, candidate);
  const official = candidate.status === "PASS" ?
    inspectSimulationEvidence(root, suite, target, candidate) : null;
  const blockers = [];
  if (!prerequisite.accepted) blockers.push("IMP8_NOT_ACCEPTED");
  if (!candidate.candidateFrozen) blockers.push("CANDIDATE_NOT_FROZEN");
  if (!candidate.exactArtifact) blockers.push("PUBLISH_ARTIFACT_HASH_MISMATCH");
  if (!candidate.codeSizeWithinLimit) blockers.push("PLATFORM_SCRIPT_BYTE_LIMIT_EXCEEDED");
  if (!profileExact) blockers.push("PROFILE_IDENTITY_MISMATCH");
  if (rollback.status !== "PASS") blockers.push("VERIFIED_ROLLBACK_BASELINE_MISSING");
  if (localQualification.status !== "PASS") blockers.push(
    localQualification.status === "NOT_RUN" ? "LOCAL_V1_V2_QUALIFICATION_MISSING" :
      "LOCAL_V1_V2_QUALIFICATION_NOT_BOUND");
  if (!official) blockers.push("LIVE_CONTEXT_NOT_REFRESHED_FOR_IMP9", "SIMULATION_ATTESTATION_MISSING");
  else if (official.status === "FAIL") blockers.push("SIMULATION_RELIABILITY_FAILURE");
  blockers.push("EXPLICIT_PUBLISH_AUTHORIZATION_MISSING", "PUBLISH_INTENT_MISSING",
    "PUBLISH_NOT_PERFORMED");
  const report = { schemaVersion: 1, reportKind: "IMP9_CANARY_READINESS",
    status: official?.status === "FAIL" ? "FAIL" : "BLOCKED",
    prerequisite, target,
    suite: { status: "PREREGISTERED", suiteId: suite.suiteId, suiteVersion: suite.suiteVersion,
      suiteFingerprint: fingerprintObject(suite), caseIds: suite.cases.map(item => item.caseId),
      mandatoryCaseCount: suite.cases.filter(item => item.mandatory).length,
      coldSmokePresent: suite.cases.some(item => item.role === "COLD_SMOKE"),
      liveContextRequired: suite.qualification.requireLiveContext },
    candidate, rollback, localQualification,
    liveContext: { status: official ? "PASS" : "NOT_RUN",
      contextArtifactId: official ? path.relative(root, official.contextFile).replaceAll("\\", "/") : null,
      contextSha256: official ? sha256Text(canonicalStorageJson(official.context)) : null,
      targetIdentityVerified: Boolean(official), suiteInventoryVerified: Boolean(official) },
    simulation: { status: official?.status || "NOT_RUN",
      attestationFingerprint: official?.attestation?.fingerprint || null,
      qualifiedCaseIds: official?.attestation?.caseIds || official?.report?.caseIds || [],
      exactPublishArtifactSha256: candidate.publishArtifactSha256,
      externalRequestCount: official?.report.requestCount || 0,
      retryOrSkipCount: 0 },
    publish: { status: "NOT_RUN", canaryStatus: "NOT_ELIGIBLE", intentFingerprint: null,
      explicitAuthorization: false, postCount: 0, challengeCount: 0 },
    reconciliation: { status: "NOT_RUN", getAfterPostCount: 0,
      publishedArtifactSha256: null, publishedVersion: null, blindRetryCount: 0 },
    profileIsolation: { status: profileExact ? "PASS" : "FAIL", profileExact,
      wrongKeyRejectedByLiveContext: "NOT_RUN", staleAttestationRejected: "TESTED_LOCALLY",
      sourceMinifiedMismatchRejected: "TESTED_LOCALLY", crossProfileRollbackRejected: "TESTED_LOCALLY" },
    forwardPlan: { status: suite.forwardPlan.status, planId: suite.forwardPlan.planId,
      planFingerprint: fingerprintObject(suite.forwardPlan), executeInImp9: suite.forwardPlan.executeInImp9,
      parametersMutableAfterFirstMatch: suite.forwardPlan.candidateParametersMutableAfterFirstMatch,
      minimumRecordedMatches: suite.forwardPlan.minimumRecordedMatches },
    operationAudit: { dryRun: true, networkRequestCount: 0, mutationCount: 0,
      simulationPostCount: 0, publishPostCount: 0, challengePostCount: 0,
      secretResolved: false, secretMaterialPersisted: false },
    blockers: [...new Set(blockers)], fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  validateSchemaObject("imp9-readiness-report", report, root); return report;
}

function runImp9Preflight(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const report = inspectImp9Readiness(root);
  const output = contained(root, "artifacts", "reports", "imp9"); ensureDirectory(output);
  writeJsonAtomic(path.join(output, "canary-readiness-report.json"), report, { mode: 0o644 });
  const immutable = path.join(output, "history", `canary-readiness-${report.fingerprint}.json`);
  writeJsonImmutable(immutable, report, { mode: 0o644 });
  return { report, immutable };
}

module.exports = { loadImp8Acceptance, loadImp8Readiness, verifyRollback, inspectCandidate,
  inspectLocalQualification, inspectSimulationEvidence, inspectImp9Readiness, runImp9Preflight };
