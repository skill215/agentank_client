"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sha256Bytes } = require("../../tools/agentank/core/hash");
const { inspectImp9Readiness, inspectLocalQualification, verifyRollback } =
  require("../../tools/agentank/release/imp9-preflight");
const { assertExactArtifact, verifyLiveContext, qualifySimulationResponse,
  buildSimulationAttestation, assertAttestationBinding, assertPublishAdmission,
  publishIntent, reconcilePublish } = require("../../tools/agentank/release/imp9-guards");
const { createReleaseClient } = require("../../tools/agentank/platform/release-client");
const { runOfficialSimulationSuite, runOfficialPublish } =
  require("../../tools/agentank/release/imp9-runner");

const root = path.resolve(__dirname, "../..");
const suite = JSON.parse(fs.readFileSync(path.join(root, "config/engine-v2/imp9-official-suite.json"), "utf8"));
const context = JSON.parse(fs.readFileSync(path.join(root,
  "battle-records/tanks/v2/baselines/main/contexts/ctx_5a25f93e3a1c1e8112c84594.json"), "utf8"));
const target = suite.target;
const candidate = { candidateId: "cand_test", candidateFingerprint: "1".repeat(64),
  candidateFrozen: true, publishArtifactKind: "PRODUCTION_MINIFIED",
  publishArtifactSha256: "2".repeat(64) };

test("exact simulation binds every response and attestation to the frozen publish bytes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-imp9-"));
  const file = path.join(dir, "candidate.js"); fs.writeFileSync(file, "candidate-bytes");
  const hash = sha256Bytes(fs.readFileSync(file));
  assert.equal(assertExactArtifact(file, hash).actualSha256, hash);
  assert.throws(() => assertExactArtifact(file, "0".repeat(64)),
    { code: "IMP9_PUBLISH_ARTIFACT_HASH_MISMATCH" });
  const simulationCase = suite.cases[0]; const verdict = qualifySimulationResponse({
    usedCandidateCode: true, resultReason: "crashed",
    replayData: { replay: { meta: { result: { reason: "crashed" } }, records: [[]] } }
  }, simulationCase);
  const boundCandidate = { ...candidate, publishArtifactSha256: hash };
  const attestation = buildSimulationAttestation({ suiteVersion: suite.suiteVersion, target,
    candidate: boundCandidate, capabilityProfileSha256: "3".repeat(64),
    liveContextSha256: "4".repeat(64), expectedCaseIds: [simulationCase.caseId],
    caseVerdicts: [verdict], qualifiedAt: "2026-07-16T00:00:00.000Z" });
  assert.match(attestation.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(assertAttestationBinding(attestation, target, boundCandidate), true);
});

test("official suite inventory comes from live context and mandatory cold smoke cannot disappear", () => {
  const verified = verifyLiveContext(context, target, suite);
  assert.equal(verified.identity.tankId, 7214);
  assert.ok(verified.botIds.includes("nova-scout")); assert.ok(verified.mapIds.includes("classic"));
  const removed = { ...suite, cases: suite.cases.filter(item => item.role !== "COLD_SMOKE") };
  assert.throws(() => verifyLiveContext(context, target, removed), { code: "IMP9_COLD_SMOKE_REMOVED" });
});

test("same profile rollback baseline is byte verified and cross profile reuse is rejected", () => {
  const rollback = verifyRollback(root, target); assert.equal(rollback.status, "PASS");
  assert.equal(rollback.exactSourceHash, true); assert.equal(rollback.identityExact, true);
  assert.equal(verifyRollback(root, { ...target, tankProfileId: "v1", tankId: 7214 }).status, "FAIL");
});

test("official simulation stays blocked until Candidate-bound local V1/V2 evidence exists", () => {
  const missing = inspectLocalQualification(root, suite, target, {
    candidateId: "cand_missing_local_qualification", candidateFingerprint: "1".repeat(64),
    publishArtifactSha256: "2".repeat(64) });
  assert.equal(missing.status, "NOT_RUN");
  assert.equal(missing.reason, "LOCAL_QUALIFICATION_ATTESTATION_MISSING");
});

test("publish admission requires durable intent and explicit authorization before POST", () => {
  const attestation = buildSimulationAttestation({ suiteVersion: suite.suiteVersion, target, candidate,
    capabilityProfileSha256: "3".repeat(64), liveContextSha256: "4".repeat(64),
    expectedCaseIds: ["c"], caseVerdicts: [{ caseId: "c" }],
    qualifiedAt: "2026-07-16T00:00:00.000Z" });
  const base = { imp8AcceptanceStatus: "ACCEPTED", target, candidate, attestation,
    rollback: { status: "PASS", mode: "VERIFIED_BASELINE" }, intentPersisted: true };
  assert.throws(() => assertPublishAdmission({ ...base, authorization: { authorizePublish: false } }),
    { code: "IMP9_EXPLICIT_PUBLISH_AUTHORIZATION_REQUIRED" });
  assert.equal(assertPublishAdmission({ ...base, authorization: { authorizePublish: true } }), true);
  const intent = publishIntent({ target, candidate, basePublishedCodeHash: "5".repeat(64),
    submittedBy: "codex", authorizationId: "user-turn", createdAt: "2026-07-16T00:00:00.000Z" });
  assert.equal(intent.publishArtifactSha256, candidate.publishArtifactSha256);
});

test("ambiguous publish is reconciled by GET and never classified from POST alone", () => {
  const published = structuredClone(context);
  published.codeBranches.find(item => item.branch === "main").codeHash = candidate.publishArtifactSha256;
  published.codeBranches.find(item => item.branch === "main").version = 2;
  published.tank.codeHash = candidate.publishArtifactSha256; published.tank.codeVersion = 2;
  assert.equal(reconcilePublish(published, target, candidate,
    { codeHash: "5".repeat(64), version: 1 }).status, "PUBLISHED_VERIFIED");
  const conflict = structuredClone(published); conflict.tank.codeHash = "6".repeat(64);
  conflict.codeBranches.find(item => item.branch === "main").codeHash = "6".repeat(64);
  assert.equal(reconcilePublish(conflict, target, candidate,
    { codeHash: "5".repeat(64), version: 1 }).status, "CONFLICT");
});

test("wrong key stale attestation source mismatch and cross profile rollback fail closed", () => {
  assert.throws(() => verifyLiveContext(context, { ...target, tankId: 6821 }, suite),
    { code: "IMP9_LIVE_TANK_IDENTITY_MISMATCH" });
  const stale = buildSimulationAttestation({ suiteVersion: suite.suiteVersion, target,
    candidate: { ...candidate, candidateId: "cand_old" }, capabilityProfileSha256: "3".repeat(64),
    liveContextSha256: "4".repeat(64), expectedCaseIds: ["c"], caseVerdicts: [{ caseId: "c" }],
    qualifiedAt: "2026-07-16T00:00:00.000Z" });
  assert.throws(() => assertAttestationBinding(stale, target, candidate),
    { code: "IMP9_STALE_OR_WRONG_HASH_ATTESTATION" });
  assert.equal(verifyRollback(root, { ...target, tankProfileId: "v1", tankId: 7214 }).status, "FAIL");
});

test("canary readiness blocks the oversized Candidate before reading stale simulation evidence", () => {
  const report = inspectImp9Readiness(root); assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("PLATFORM_SCRIPT_BYTE_LIMIT_EXCEEDED"));
  assert.equal(report.prerequisite.status, "ACCEPTED");
  assert.equal(report.candidate.codeSizeWithinLimit, false);
  assert.equal(report.candidate.platformCodeLimitBytes, 204800);
  assert.equal(report.liveContext.status, "NOT_RUN");
  assert.equal(report.simulation.status, "NOT_RUN");
  assert.equal(report.simulation.externalRequestCount, 0);
  assert.equal(report.operationAudit.networkRequestCount, 0);
  assert.equal(report.operationAudit.secretResolved, false);
  assert.equal(report.publish.canaryStatus, "NOT_ELIGIBLE");
});

test("IMP9 exposes no challenge method and preregisters immutable Forward policy", async () => {
  const requests = []; const client = createReleaseClient({ secret: "agtk_" + "a".repeat(32),
    fetchImpl: async (url, options) => { requests.push({ url, method: options.method }); return {
      ok: true, status: 200, text: async () => "{}" }; } });
  assert.equal(client.challenge, undefined);
  await client.getContext(); assert.deepEqual(requests.map(item => item.method), ["GET"]);
  assert.equal(suite.publish.allowChallenge, false); assert.equal(suite.forwardPlan.executeInImp9, false);
  assert.equal(suite.forwardPlan.candidateParametersMutableAfterFirstMatch, false);
});

test("IMP9 wrapper loads the shared local key file and preserves the failed simulation evidence", () => {
  const wrapper = fs.readFileSync(path.join(root, "tools/imp9-toolchain.sh"), "utf8");
  assert.match(wrapper, /load-agentank-local-env\.sh/);
  const readiness = inspectImp9Readiness(root);
  const report = JSON.parse(fs.readFileSync(path.join(root, "battle-records/tanks/v2/runs",
    `imp9-${readiness.candidate.candidateId}/simulation-run-report.json`), "utf8"));
  assert.equal(report.status, "FAIL"); assert.equal(report.requestCount, 2);
  assert.deepEqual(report.failedCases.map(item => [item.caseId, item.resultReason]),
    [["cold-smoke-classic", "timeout"]]);
  assert.deepEqual(report.missingCaseIds, ["pressure-arena", "robustness-random"]);
  assert.equal(report.challengeCount, 0);
});

test("official simulation runner requires explicit authorization before resolving a secret or transport", async () => {
  let secretCalls = 0; let clientCalls = 0;
  await assert.rejects(() => runOfficialSimulationSuite({ workspaceRoot: root,
    authorizeSimulation: false, resolveSecret() { secretCalls += 1; return "x"; },
    clientFactory() { clientCalls += 1; return {}; } }),
  { code: "IMP9_EXPLICIT_SIMULATION_AUTHORIZATION_REQUIRED" });
  assert.equal(secretCalls, 0); assert.equal(clientCalls, 0);
});

test("oversized Candidate cannot simulate before resolving a secret or transport", async () => {
  let secretCalls = 0; let clientCalls = 0;
  await assert.rejects(() => runOfficialSimulationSuite({ workspaceRoot: root,
    authorizeSimulation: true, resolveSecret() { secretCalls += 1; return "x"; },
    clientFactory() { clientCalls += 1; return {}; } }),
  { code: "PLATFORM_CODE_SIZE_LIMIT_EXCEEDED" });
  assert.equal(secretCalls, 0); assert.equal(clientCalls, 0);
});

test("official publish runner rejects the oversized Candidate before intent key or POST", async () => {
  let secretCalls = 0; let clientCalls = 0;
  await assert.rejects(() => runOfficialPublish({ workspaceRoot: root, authorizePublish: false,
    authorizationId: "test-authorization", submittedBy: "test",
    resolveSecret() { secretCalls += 1; return "x"; },
    clientFactory() { clientCalls += 1; return {}; } }),
  { code: "PLATFORM_CODE_SIZE_LIMIT_EXCEEDED" });
  assert.equal(secretCalls, 0); assert.equal(clientCalls, 0);
});
