"use strict";

const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory } = require("../core/atomic-file");
const { summarizeTestOutput } = require("./test-runner");
const { writeReport, writeImmutableJsonEvidence, writeImmutableRawEvidence,
  artifactEntry, check } = require("./foundation-gate");
const { runImp9Preflight } = require("../release/imp9-preflight");

async function runImp9Gate(workspaceRoot = defaultWorkspaceRoot(), options = {}) {
  const root = path.resolve(workspaceRoot); const output = contained(root, "artifacts", "reports", "imp9");
  ensureDirectory(output); const { report: readiness } = runImp9Preflight(root);
  const tests = summarizeTestOutput(root, options.testOutputFile, options.testExitCode, output,
    { testDirectories: ["imp0", "platform", "imp1", "imp2", "imp3", "imp4", "imp5",
      "imp6", "imp7", "imp8", "imp9"] });
  const evidenceFiles = [
    ["readiness", writeImmutableJsonEvidence(output, "readiness", readiness)],
    ["target", writeImmutableJsonEvidence(output, "target", readiness.target)],
    ["suite", writeImmutableJsonEvidence(output, "suite", readiness.suite)],
    ["candidate", writeImmutableJsonEvidence(output, "candidate", readiness.candidate)],
    ["rollback", writeImmutableJsonEvidence(output, "rollback", readiness.rollback)],
    ["operations", writeImmutableJsonEvidence(output, "operations", readiness.operationAudit)],
    ["tests", writeImmutableJsonEvidence(output, "tests", tests.report)],
    ["test-output", writeImmutableRawEvidence(output, "test-output", "tap", tests.output)]
  ];
  const checks = [
    check("EXACT_CANDIDATE_SIMULATION", readiness.simulation.status === "PASS" ? "PASS" :
      readiness.simulation.status === "FAIL" ? "FAIL" : "BLOCKED",
      { status: readiness.simulation.status, attestationFingerprint:
        readiness.simulation.attestationFingerprint, exactPublishArtifactSha256:
        readiness.simulation.exactPublishArtifactSha256 }),
    check("LIVE_CONTEXT_SUITE_ELIGIBILITY", readiness.liveContext.status === "PASS" &&
      readiness.liveContext.suiteInventoryVerified ? "PASS" : "BLOCKED",
    { status: readiness.liveContext.status, suiteFingerprint: readiness.suite.suiteFingerprint,
      caseIds: readiness.suite.caseIds, coldSmokePresent: readiness.suite.coldSmokePresent }),
    check("ROLLBACK_VERIFIED", readiness.rollback.status,
      { mode: readiness.rollback.mode, baselineFingerprint: readiness.rollback.baselineFingerprint,
        artifactSha256: readiness.rollback.artifactSha256,
        exactSourceHash: readiness.rollback.exactSourceHash }),
    check("PUBLISH_EXPLICITLY_AUTHORIZED", readiness.publish.explicitAuthorization &&
      readiness.publish.intentFingerprint ? "PASS" : "BLOCKED",
    { explicitAuthorization: readiness.publish.explicitAuthorization,
      intentFingerprint: readiness.publish.intentFingerprint, postCount: readiness.publish.postCount }),
    check("PUBLISH_RECONCILED", readiness.reconciliation.status === "PUBLISHED_VERIFIED" ? "PASS" : "BLOCKED",
      { status: readiness.reconciliation.status, getAfterPostCount:
        readiness.reconciliation.getAfterPostCount, blindRetryCount: readiness.reconciliation.blindRetryCount }),
    check("PROFILE_AND_HASH_ISOLATION", readiness.profileIsolation.status,
      { profileExact: readiness.profileIsolation.profileExact,
        staleAttestationRejected: readiness.profileIsolation.staleAttestationRejected,
        sourceMinifiedMismatchRejected: readiness.profileIsolation.sourceMinifiedMismatchRejected,
        crossProfileRollbackRejected: readiness.profileIsolation.crossProfileRollbackRejected }),
    check("CANARY_PUBLISHED_VERIFIED", readiness.publish.canaryStatus === "PUBLISHED_VERIFIED" ? "PASS" : "BLOCKED",
      { canaryStatus: readiness.publish.canaryStatus, prerequisiteStatus: readiness.prerequisite.status,
        candidateFrozen: readiness.candidate.candidateFrozen }),
    check("NO_UNEXPECTED_CHALLENGE", readiness.operationAudit.challengePostCount === 0 &&
      readiness.forwardPlan.status === "PREREGISTERED_NOT_EXECUTABLE_IN_IMP9" &&
      readiness.forwardPlan.executeInImp9 === false ? "PASS" : "FAIL",
    { challengePostCount: readiness.operationAudit.challengePostCount,
      forwardPlanFingerprint: readiness.forwardPlan.planFingerprint,
      parametersMutableAfterFirstMatch: readiness.forwardPlan.parametersMutableAfterFirstMatch }),
    check("FAIL_CLOSED_TESTS", tests.report.status,
      { tests: tests.report.tests, pass: tests.report.pass, fail: tests.report.fail })
  ];
  const failed = checks.filter(item => item.status === "FAIL").map(item => item.checkId);
  const blocked = checks.filter(item => item.status === "BLOCKED").map(item => item.checkId);
  const gate = { schemaVersion: 1, reportId: "imp9-official-simulation-canary-gate-v1",
    status: failed.length ? "FAIL" : blocked.length ? "BLOCKED" : "PASS", checks,
    artifacts: evidenceFiles.map(([id, file]) => artifactEntry(root, id, file)),
    blockers: [...new Set([...readiness.blockers, ...failed])], fingerprint: "" };
  gate.fingerprint = fingerprintObject(gate); validateSchemaObject("imp9-gate-report", gate, root);
  writeReport(output, "imp9-gate-report.json", gate);
  const gateFile = writeImmutableJsonEvidence(output, "imp9-gate", gate);
  return { gate, gateFile, readiness };
}

module.exports = { runImp9Gate };
