"use strict";

const fs = require("node:fs");
const { invariant } = require("../core/errors");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { extractContextIdentity } = require("../profiles/context-identity");

function assertExactArtifact(file, expectedSha256) {
  invariant(typeof file === "string" && fs.existsSync(file), "IMP9_PUBLISH_ARTIFACT_MISSING",
    "Candidate publish artifact is missing");
  const bytes = fs.readFileSync(file); const actualSha256 = sha256Bytes(bytes);
  invariant(actualSha256 === expectedSha256, "IMP9_PUBLISH_ARTIFACT_HASH_MISMATCH",
    "publish bytes differ from the frozen Candidate");
  return { bytes, actualSha256 };
}

function verifyLiveContext(context, target, suite) {
  const identity = extractContextIdentity(context, target.branch);
  invariant(identity.tankId === target.tankId && identity.tankUrlId === target.tankUrlId,
    "IMP9_LIVE_TANK_IDENTITY_MISMATCH", "the resolved key belongs to another tank");
  invariant(identity.skillId === target.skillId && identity.branch === target.branch,
    "IMP9_LIVE_SKILL_BRANCH_MISMATCH", "live skill or branch differs from Candidate target");
  const bots = new Set((context.trainingBots || []).map(item => item.id));
  const maps = new Set((context.maps || []).map(item => item.id));
  for (const item of suite.cases) {
    invariant(bots.has(item.opponentBot), "IMP9_SUITE_BOT_NOT_IN_LIVE_CONTEXT", item.caseId);
    invariant(maps.has(item.mapId), "IMP9_SUITE_MAP_NOT_IN_LIVE_CONTEXT", item.caseId);
  }
  invariant(suite.cases.some(item => item.role === "COLD_SMOKE" && item.mandatory),
    "IMP9_COLD_SMOKE_REMOVED", "mandatory cold smoke cannot be removed");
  return { identity, botIds: [...bots].sort(), mapIds: [...maps].sort() };
}

function qualifySimulationResponse(response, simulationCase) {
  invariant(response && typeof response === "object", "IMP9_SIMULATION_RESPONSE_INVALID",
    simulationCase.caseId);
  invariant(response.usedCandidateCode === true, "IMP9_CANDIDATE_CODE_NOT_USED", simulationCase.caseId);
  invariant(!response.error, "IMP9_SIMULATION_SCRIPT_ERROR", simulationCase.caseId);
  const replay = response.replayData?.replay;
  invariant(replay?.meta && replay?.records && Array.isArray(replay.records),
    "IMP9_SIMULATION_REPLAY_MISSING", simulationCase.caseId);
  invariant(replay.meta.result || response.resultReason,
    "IMP9_SIMULATION_RESULT_MISSING", simulationCase.caseId);
  const reason = String(replay.meta.result?.reason || response.resultReason || "").toLowerCase();
  invariant(reason !== "timeout" && reason !== "runtime" && reason !== "script_error",
    "IMP9_SIMULATION_RELIABILITY_FAILURE", `${simulationCase.caseId}:${reason}`);
  return { caseId: simulationCase.caseId, usedCandidateCode: true, resultReason: reason,
    tacticalOutcomeIsGate: false };
}

function buildSimulationAttestation(options) {
  invariant(options.caseVerdicts.length === options.expectedCaseIds.length,
    "IMP9_SIMULATION_CASE_COUNT_MISMATCH", "mandatory simulation cases are incomplete");
  const actual = new Set(options.caseVerdicts.map(item => item.caseId));
  invariant(options.expectedCaseIds.every(id => actual.has(id)), "IMP9_SIMULATION_CASE_MISSING",
    "mandatory simulation case is missing");
  const value = {
    schemaVersion: 1,
    objectKind: "SIMULATION_ATTESTATION",
    suiteVersion: options.suiteVersion,
    tankProfileId: options.target.tankProfileId,
    tankId: options.target.tankId,
    tankUrlId: options.target.tankUrlId,
    skillId: options.target.skillId,
    branch: options.target.branch,
    candidateId: options.candidate.candidateId,
    candidateFingerprint: options.candidate.candidateFingerprint,
    publishArtifactKind: options.candidate.publishArtifactKind,
    publishArtifactSha256: options.candidate.publishArtifactSha256,
    capabilityProfileSha256: options.capabilityProfileSha256,
    liveContextSha256: options.liveContextSha256,
    caseIds: options.expectedCaseIds.slice(),
    caseVerdicts: options.caseVerdicts.map(item => ({ ...item })),
    qualifiedAt: options.qualifiedAt,
    verdict: "PASS",
    fingerprint: ""
  };
  value.fingerprint = fingerprintObject(value); return value;
}

function assertAttestationBinding(attestation, target, candidate) {
  invariant(attestation?.verdict === "PASS", "IMP9_ATTESTATION_NOT_QUALIFIED",
    "simulation attestation is absent or failed");
  invariant(attestation.tankProfileId === target.tankProfileId &&
    attestation.tankId === target.tankId && attestation.tankUrlId === target.tankUrlId &&
    attestation.skillId === target.skillId && attestation.branch === target.branch,
  "IMP9_STALE_OR_CROSS_PROFILE_ATTESTATION", "attestation target does not match live target");
  invariant(attestation.candidateId === candidate.candidateId &&
    attestation.candidateFingerprint === candidate.candidateFingerprint &&
    attestation.publishArtifactKind === candidate.publishArtifactKind &&
    attestation.publishArtifactSha256 === candidate.publishArtifactSha256,
  "IMP9_STALE_OR_WRONG_HASH_ATTESTATION", "attestation does not bind the frozen Candidate bytes");
  return true;
}

function assertPublishAdmission(input) {
  invariant(input.imp8AcceptanceStatus === "ACCEPTED", "IMP9_REQUIRES_ACCEPTED_IMP8",
    "IMP9 cannot operate before IMP8 acceptance");
  invariant(input.candidate.candidateFrozen === true && input.candidate.candidateId,
    "IMP9_REQUIRES_FROZEN_CANDIDATE", "Candidate is not frozen");
  assertAttestationBinding(input.attestation, input.target, input.candidate);
  invariant(input.rollback.status === "PASS" && input.rollback.mode === "VERIFIED_BASELINE",
    "IMP9_ROLLBACK_NOT_VERIFIED", "a same-profile exact rollback baseline is required");
  invariant(input.authorization?.authorizePublish === true,
    "IMP9_EXPLICIT_PUBLISH_AUTHORIZATION_REQUIRED", "publish requires explicit authorization");
  invariant(input.intentPersisted === true, "IMP9_PUBLISH_INTENT_REQUIRED",
    "publish intent must be durable before POST");
  return true;
}

function publishIntent(input) {
  const value = { schemaVersion: 1, objectKind: "PUBLISH_INTENT",
    target: { tankProfileId: input.target.tankProfileId, tankId: input.target.tankId,
      tankUrlId: input.target.tankUrlId, skillId: input.target.skillId, branch: input.target.branch },
    candidateId: input.candidate.candidateId,
    candidateFingerprint: input.candidate.candidateFingerprint,
    publishArtifactKind: input.candidate.publishArtifactKind,
    publishArtifactSha256: input.candidate.publishArtifactSha256,
    basePublishedCodeHash: input.basePublishedCodeHash,
    submittedBy: input.submittedBy,
    notes: input.notes || null,
    authorizationId: input.authorizationId,
    createdAt: input.createdAt,
    fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function branchState(context, branch) {
  const item = (context.codeBranches || []).find(value => value.branch === branch);
  return { branch, codeHash: item?.codeHash || context?.tank?.codeHash || null,
    version: Number.isSafeInteger(item?.version) ? item.version :
      Number.isSafeInteger(context?.tank?.codeVersion) ? context.tank.codeVersion : null };
}

function reconcilePublish(context, target, candidate, base) {
  const identity = extractContextIdentity(context, target.branch);
  invariant(identity.tankId === target.tankId && identity.tankUrlId === target.tankUrlId &&
    identity.skillId === target.skillId, "IMP9_LIVE_TANK_IDENTITY_MISMATCH",
  "publish reconciliation resolved another tank or skill");
  const state = branchState(context, target.branch);
  if (state.codeHash === candidate.publishArtifactSha256) return { status: "PUBLISHED_VERIFIED",
    disposition: "TARGET_HASH_PRESENT", ...state };
  if (state.codeHash === base.codeHash && state.version === base.version) return { status: "NOT_PUBLISHED",
    disposition: "BASE_UNCHANGED", ...state };
  return { status: "CONFLICT", disposition: "REMOTE_HASH_OR_VERSION_DIVERGED", ...state };
}

module.exports = { assertExactArtifact, verifyLiveContext, qualifySimulationResponse,
  buildSimulationAttestation, assertAttestationBinding, assertPublishAdmission,
  publishIntent, branchState, reconcilePublish };
