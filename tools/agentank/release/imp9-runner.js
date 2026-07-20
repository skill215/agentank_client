"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained, tankPaths } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { canonicalStorageJson } = require("../core/storage-json");
const { sanitizeForStorage } = require("../core/sanitize");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { loadRegistry, getProfile } = require("../profiles/registry");
const { resolveSecret } = require("../profiles/secret-ref");
const { createReleaseClient } = require("../platform/release-client");
const { inspectImp9Readiness } = require("./imp9-preflight");
const { assertExactArtifact, verifyLiveContext, qualifySimulationResponse,
  buildSimulationAttestation, assertAttestationBinding, assertPublishAdmission,
  publishIntent, branchState, reconcilePublish } = require("./imp9-guards");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function assertSimulationAdmission(readiness, authorization) {
  invariant(authorization === true, "IMP9_EXPLICIT_SIMULATION_AUTHORIZATION_REQUIRED",
    "official simulation requires --authorize-simulation");
  invariant(readiness.prerequisite.accepted, "IMP9_REQUIRES_ACCEPTED_IMP8",
    "official simulation cannot run before IMP8 acceptance");
  invariant(readiness.candidate.codeSizeWithinLimit,
    "PLATFORM_CODE_SIZE_LIMIT_EXCEEDED",
    `Candidate is ${readiness.candidate.publishArtifactBytes} UTF-8 bytes; maximum is ` +
      `${readiness.candidate.platformCodeLimitBytes}`);
  invariant(readiness.candidate.candidateFrozen && readiness.candidate.candidateId,
    "IMP9_REQUIRES_FROZEN_CANDIDATE", "official simulation requires a frozen Candidate");
  invariant(readiness.candidate.exactArtifact, "IMP9_PUBLISH_ARTIFACT_HASH_MISMATCH",
    "frozen publish bytes are unavailable or changed");
  invariant(readiness.profileIsolation.status === "PASS", "IMP9_PROFILE_ISOLATION_FAILED",
    "Candidate target differs from the active TankProfile");
  invariant(readiness.rollback.status === "PASS", "IMP9_ROLLBACK_NOT_VERIFIED",
    "official simulation requires a verified same-profile rollback baseline");
  invariant(readiness.simulation.status !== "FAIL", "IMP9_FAILED_CANDIDATE_RETRY_FORBIDDEN",
    "a Candidate with failed official simulation cannot be retried or published");
  invariant(readiness.localQualification?.status === "PASS",
    "IMP9_LOCAL_V1_V2_QUALIFICATION_REQUIRED",
    "official simulation requires a reviewed Candidate-bound V1/V2 local qualification");
  return true;
}

function runDirectory(root, readiness) {
  const id = readiness.candidate.candidateId;
  invariant(/^(?:cand_|imp8-v2-)[A-Za-z0-9_-]+$/.test(id || ""),
    "IMP9_CANDIDATE_ID_INVALID", id || "missing");
  return path.join(tankPaths(root, readiness.target.tankProfileId).runs, `imp9-${id}`);
}

async function waitForServer(nextSimulationAt, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!nextSimulationAt) return 0;
  const delay = Math.max(0, Date.parse(nextSimulationAt) - Date.now());
  invariant(Number.isFinite(delay) && delay <= 30000, "IMP9_SIMULATION_COOLDOWN_INVALID",
    "server simulation cooldown exceeds the bounded runner window");
  if (delay > 0) await sleep(delay); return delay;
}

async function runOfficialSimulationSuite(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const readiness = inspectImp9Readiness(root);
  assertSimulationAdmission(readiness, options.authorizeSimulation === true);
  const suite = readJson(contained(root, "config", "engine-v2", "imp9-official-suite.json"));
  const registry = loadRegistry(contained(root, "battle-records", "control", "tank-registry.json"));
  const profile = getProfile(registry, readiness.target.tankProfileId);
  const secret = (options.resolveSecret || resolveSecret)(profile.secretRef, options.environment);
  const client = (options.clientFactory || createReleaseClient)({ secret,
    fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs });
  const live = await client.getContext(); const verified = verifyLiveContext(live, readiness.target, suite);
  const safeContext = sanitizeForStorage(live); const liveContextSha256 =
    sha256Text(canonicalStorageJson(safeContext));
  const artifact = assertExactArtifact(contained(root,
    readiness.candidate.publishArtifactRelativePath), readiness.candidate.publishArtifactSha256);
  const code = artifact.bytes.toString("utf8"); const directory = runDirectory(root, readiness);
  ensureDirectory(directory); writeJsonImmutable(path.join(directory, "context.json"), safeContext, { mode: 0o600 });
  const verdicts = []; let requestCount = 1; let waitedMs = 0;
  for (const item of suite.cases) {
    const caseDirectory = path.join(directory, "simulations", item.caseId); ensureDirectory(caseDirectory);
    const request = { schemaVersion: 1, caseId: item.caseId, opponentBot: item.opponentBot,
      mapId: item.mapId, codeRelativePath: readiness.candidate.publishArtifactRelativePath,
      codeSha256: artifact.actualSha256, requestBodySha256: sha256Text(JSON.stringify({
        opponentBot: item.opponentBot, mapId: item.mapId, code })) };
    writeJsonImmutable(path.join(caseDirectory, "request.sanitized.json"), request, { mode: 0o600 });
    const response = await client.simulate({ opponentBot: item.opponentBot, mapId: item.mapId, code });
    requestCount += 1; const safeResponse = sanitizeForStorage(response);
    writeJsonImmutable(path.join(caseDirectory, "response.json"), safeResponse, { mode: 0o600 });
    const verdict = qualifySimulationResponse(response, item); verdicts.push(verdict);
    writeJsonImmutable(path.join(caseDirectory, "verdict.json"), verdict, { mode: 0o600 });
    if (item !== suite.cases[suite.cases.length - 1])
      waitedMs += await waitForServer(response.nextSimulationAt, options.sleep);
  }
  const capabilityFile = contained(root, "battle-records", "control", "capabilities",
    readiness.target.tankProfileId, readiness.target.branch, "capability-profile.json");
  const attestation = buildSimulationAttestation({ suiteVersion: suite.suiteVersion,
    target: readiness.target, candidate: readiness.candidate,
    capabilityProfileSha256: sha256Bytes(fs.readFileSync(capabilityFile)), liveContextSha256,
    expectedCaseIds: suite.cases.map(item => item.caseId), caseVerdicts: verdicts,
    qualifiedAt: options.now || new Date().toISOString() });
  const attestationFile = path.join(directory, "simulation-attestation.json");
  writeJsonImmutable(attestationFile, attestation, { mode: 0o600 });
  const report = { schemaVersion: 1, reportKind: "IMP9_OFFICIAL_SIMULATION_RUN", status: "PASS",
    candidateId: readiness.candidate.candidateId, publishArtifactSha256: artifact.actualSha256,
    liveIdentity: verified.identity, caseIds: verdicts.map(item => item.caseId),
    requestCount, waitedMs, mutationCount: verdicts.length, challengeCount: 0,
    attestationFingerprint: attestation.fingerprint, fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  writeJsonAtomic(path.join(directory, "simulation-run-report.json"), report, { mode: 0o600 });
  return { report, attestation, attestationFile, directory };
}

function reconcileOfficialSimulationAttempt(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const readiness = inspectImp9Readiness(root);
  invariant(readiness.prerequisite.accepted && readiness.candidate.candidateFrozen,
    "IMP9_REQUIRES_ACCEPTED_IMP8", "simulation reconciliation requires the frozen IMP8 Candidate");
  const suite = readJson(contained(root, "config", "engine-v2", "imp9-official-suite.json"));
  const directory = runDirectory(root, readiness); const contextFile = path.join(directory, "context.json");
  invariant(fs.existsSync(contextFile), "IMP9_SIMULATION_CONTEXT_MISSING", directory);
  const context = readJson(contextFile); const verified = verifyLiveContext(context, readiness.target, suite);
  const qualified = []; const failed = []; const missing = []; let responseCount = 0;
  for (const item of suite.cases) {
    const caseDirectory = path.join(directory, "simulations", item.caseId);
    const responseFile = path.join(caseDirectory, "response.json");
    if (!fs.existsSync(responseFile)) { missing.push(item.caseId); continue; }
    responseCount += 1; const response = readJson(responseFile);
    try {
      const verdict = qualifySimulationResponse(response, item); qualified.push(verdict);
      writeJsonImmutable(path.join(caseDirectory, "verdict.json"), verdict, { mode: 0o600 });
    } catch (error) {
      const verdict = { caseId: item.caseId, status: "FAIL",
        errorCode: error.code || "IMP9_SIMULATION_CASE_FAILED",
        resultReason: String(response.resultReason ||
          response.replayData?.replay?.meta?.result?.reason || "unknown").toLowerCase(),
        usedCandidateCode: response.usedCandidateCode === true };
      failed.push(verdict); writeJsonImmutable(path.join(caseDirectory, "verdict.json"), verdict,
        { mode: 0o600 });
    }
  }
  const report = { schemaVersion: 1, reportKind: "IMP9_OFFICIAL_SIMULATION_RUN",
    status: failed.length || missing.length ? "FAIL" : "PASS",
    candidateId: readiness.candidate.candidateId,
    publishArtifactSha256: readiness.candidate.publishArtifactSha256,
    liveIdentity: verified.identity, caseIds: qualified.map(item => item.caseId),
    failedCases: failed, missingCaseIds: missing, requestCount: 1 + responseCount,
    waitedMs: 0, mutationCount: responseCount, challengeCount: 0,
    attestationFingerprint: null, fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  const reportFile = path.join(directory, "simulation-run-report.json");
  writeJsonAtomic(reportFile, report, { mode: 0o600 });
  writeJsonImmutable(path.join(directory, "history", `simulation-run-${report.fingerprint}.json`),
    report, { mode: 0o600 });
  return { report, reportFile, directory };
}

async function runOfficialPublish(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const readiness = inspectImp9Readiness(root);
  assertSimulationAdmission(readiness, true);
  invariant(options.authorizePublish === true, "IMP9_EXPLICIT_PUBLISH_AUTHORIZATION_REQUIRED",
    "official publish requires --authorize-publish");
  invariant(typeof options.authorizationId === "string" && options.authorizationId.length > 0,
    "IMP9_PUBLISH_AUTHORIZATION_ID_REQUIRED", "publish authorization id is required");
  invariant(typeof options.submittedBy === "string" && options.submittedBy.length > 0,
    "IMP9_SUBMITTED_BY_REQUIRED", "submittedBy is required");
  const directory = runDirectory(root, readiness);
  const attestationFile = path.join(directory, "simulation-attestation.json");
  invariant(fs.existsSync(attestationFile), "IMP9_SIMULATION_ATTESTATION_MISSING",
    "run the exact official simulation suite first");
  const attestation = readJson(attestationFile);
  assertAttestationBinding(attestation, readiness.target, readiness.candidate);
  const artifact = assertExactArtifact(contained(root,
    readiness.candidate.publishArtifactRelativePath), readiness.candidate.publishArtifactSha256);
  const registry = loadRegistry(contained(root, "battle-records", "control", "tank-registry.json"));
  const profile = getProfile(registry, readiness.target.tankProfileId);
  const secret = (options.resolveSecret || resolveSecret)(profile.secretRef, options.environment);
  const client = (options.clientFactory || createReleaseClient)({ secret,
    fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs });
  const before = await client.getContext(); verifyLiveContext(before, readiness.target,
    readJson(contained(root, "config", "engine-v2", "imp9-official-suite.json")));
  const base = branchState(before, readiness.target.branch);
  invariant(base.codeHash === readiness.rollback.artifactSha256, "IMP9_BASELINE_REMOTE_DRIFT",
    "remote main changed after rollback archival");
  const intent = publishIntent({ target: readiness.target, candidate: readiness.candidate,
    basePublishedCodeHash: base.codeHash, submittedBy: options.submittedBy, notes: options.notes,
    authorizationId: options.authorizationId, createdAt: options.now || new Date().toISOString() });
  const publishDirectory = path.join(directory, "publish"); ensureDirectory(publishDirectory);
  writeJsonImmutable(path.join(publishDirectory, "intent.json"), intent, { mode: 0o600 });
  assertPublishAdmission({ imp8AcceptanceStatus: readiness.prerequisite.status,
    target: readiness.target, candidate: readiness.candidate, attestation,
    rollback: readiness.rollback, authorization: { authorizePublish: options.authorizePublish },
    intentPersisted: true });
  let response = null; let reconciliation; let responseLost = false;
  try {
    response = await client.publish({ code: artifact.bytes.toString("utf8"),
      submittedBy: options.submittedBy, branch: readiness.target.branch,
      ...(options.notes ? { notes: options.notes } : {}) });
    writeJsonImmutable(path.join(publishDirectory, "response.json"),
      sanitizeForStorage(response), { mode: 0o600 });
    const after = await client.getContext();
    writeJsonImmutable(path.join(publishDirectory, "verify-context.json"),
      sanitizeForStorage(after), { mode: 0o600 });
    reconciliation = reconcilePublish(after, readiness.target, readiness.candidate, base);
  } catch (error) {
    invariant(error.retryClass === "RECONCILE_BEFORE_RETRY", error.code || "IMP9_PUBLISH_FAILED",
      error.message || "publish failed");
    const after = await client.getContext(); reconciliation = reconcilePublish(after,
      readiness.target, readiness.candidate, base); responseLost = reconciliation.status === "PUBLISHED_VERIFIED";
    invariant(responseLost, "IMP9_PUBLISH_AMBIGUOUS_NOT_RECONCILED",
      "ambiguous publish did not reconcile to the target hash; no retry was attempted");
  }
  writeJsonImmutable(path.join(publishDirectory, "reconciliation.json"),
    { ...reconciliation, responseLost }, { mode: 0o600 });
  invariant(reconciliation.status === "PUBLISHED_VERIFIED", "IMP9_PUBLISH_RECONCILIATION_FAILED",
    reconciliation.disposition);
  return { status: "PUBLISHED_VERIFIED", intent, response: sanitizeForStorage(response),
    reconciliation, responseLost, publishPostCount: 1, challengePostCount: 0, directory };
}

module.exports = { assertSimulationAdmission, runDirectory, waitForServer,
  runOfficialSimulationSuite, reconcileOfficialSimulationAttempt, runOfficialPublish };
