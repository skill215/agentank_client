"use strict";

const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory } = require("../core/atomic-file");
const { summarizeTestOutput } = require("./test-runner");
const { writeReport, writeImmutableJsonEvidence, writeImmutableRawEvidence,
  artifactEntry, check } = require("./foundation-gate");
const { runImp8Preflight, assertCandidateIdentity } = require("../candidate/imp8-preflight");

function finalized(value) { value.fingerprint = fingerprintObject(value); return value; }
function identityExact(identity) {
  try { assertCandidateIdentity(identity); return true; } catch { return false; }
}

async function runImp8Gate(workspaceRoot = defaultWorkspaceRoot(), options = {}) {
  const root = path.resolve(workspaceRoot);
  const output = contained(root, "artifacts", "reports", "imp8"); ensureDirectory(output);
  const { report: readiness } = await runImp8Preflight(root);
  const tests = summarizeTestOutput(root, options.testOutputFile, options.testExitCode, output,
    { testDirectories: ["imp0", "platform", "imp1", "imp2", "imp3", "imp4", "imp5",
      "imp6", "imp7", "imp8"] });
  const localGates = finalized({ schemaVersion: 1, gates: readiness.localGateMatrix,
    pass: readiness.localGateMatrix.filter(item => item.status === "PASS").length,
    blocked: readiness.localGateMatrix.filter(item => item.status === "BLOCKED").length,
    fingerprint: "" });
  const evidenceFiles = [
    ["readiness", writeImmutableJsonEvidence(output, "readiness", readiness)],
    ["lane-isolation", writeImmutableJsonEvidence(output, "lane-isolation", readiness.laneIsolation)],
    ["parameter-provenance", writeImmutableJsonEvidence(output, "parameter-provenance",
      readiness.parameterProvenance)],
    ["profile-lock", writeImmutableJsonEvidence(output, "profile-lock", readiness.profileLock)],
    ["build-reproducibility", writeImmutableJsonEvidence(output, "build-reproducibility",
      readiness.buildReproducibility)],
    ["candidate-identity", writeImmutableJsonEvidence(output, "candidate-identity",
      readiness.candidateIdentity)],
    ["test-plan", writeImmutableJsonEvidence(output, "test-plan", readiness.testPlan)],
    ["local-gates", writeImmutableJsonEvidence(output, "local-gates", localGates)],
    ["tests", writeImmutableJsonEvidence(output, "tests", tests.report)],
    ["test-output", writeImmutableRawEvidence(output, "test-output", "tap", tests.output)]
  ];
  const exactIdentity = identityExact(readiness.candidateIdentity);
  const rootAudit = readiness.buildReproducibility.productionRootAudit;
  const localFailures = readiness.localGateMatrix.filter(item => item.status === "FAIL");
  const localBlocks = readiness.localGateMatrix.filter(item => item.status !== "PASS");
  const checks = [
    check("LANE_ISOLATION", readiness.laneIsolation.status,
      { fingerprint: readiness.laneIsolation.fingerprint, frozenCanTune: false }),
    check("CALIBRATION_PROVENANCE", readiness.parameterProvenance.status,
      { fingerprint: readiness.parameterProvenance.fingerprint,
        uncalibrated: readiness.parameterProvenance.dimensions.filter(item =>
          item.status !== "CALIBRATED_LOCAL").map(item => item.dimension) }),
    check("PROFILE_LOCK_EXACT", readiness.profileLock.status,
      { fingerprint: readiness.profileLock.fingerprint,
        floatingInputCount: readiness.profileLock.floatingInputCount }),
    check("BUILD_REPRODUCIBLE", readiness.buildReproducibility.status,
      { fingerprint: readiness.buildReproducibility.fingerprint,
        sourceSha256: readiness.buildReproducibility.sourceSha256,
        minifiedSha256: readiness.buildReproducibility.minifiedSha256 }),
    check("CANDIDATE_IDENTITY_AND_PUBLISH_BINDING", !exactIdentity ? "FAIL" :
      rootAudit.status === "PASS" && readiness.candidateFrozen ? "PASS" : "BLOCKED",
    { identityFingerprint: readiness.candidateIdentity.fingerprint,
      publishArtifactSha256: readiness.candidateIdentity.publishArtifactSha256,
      productionRootStatus: rootAudit.status, emittedCallCount: rootAudit.emittedCallCount,
      candidateFrozen: readiness.candidateFrozen }),
    check("FROZEN_TEST_PLAN_PREREGISTRATION", readiness.testPlan.status === "READY" ? "PASS" : "BLOCKED",
      { testPlanFingerprint: readiness.testPlan.fingerprint,
        expectedMatchCount: readiness.testPlan.frozenSource.expectedMatchCount,
        actualMatchCount: readiness.testPlan.frozenSource.matchUrlIds.length,
        assignmentAvailable: readiness.testPlan.frozenSource.assignmentAvailable }),
    check("NONWEIGHTED_LOCAL_GATES", localFailures.length ? "FAIL" :
      localBlocks.length ? "BLOCKED" : "PASS",
    { gateCount: readiness.localGateMatrix.length, blockedGateIds: localBlocks.map(item => item.gateId),
      failedGateIds: localFailures.map(item => item.gateId), strictErrorTolerance: 0 }),
    check("EXTERNAL_ONLY_BOUNDARY", readiness.internalBlockers.length ? "BLOCKED" : "PASS",
      { internalBlockers: readiness.internalBlockers, externalBlockers: readiness.externalBlockers }),
    check("FAIL_CLOSED_TESTS", tests.report.status,
      { tests: tests.report.tests, pass: tests.report.pass, fail: tests.report.fail })
  ];
  const failedChecks = checks.filter(item => item.status === "FAIL").map(item => item.checkId);
  const blockedChecks = checks.filter(item => item.status === "BLOCKED").map(item => item.checkId);
  const blockers = [...new Set([...readiness.internalBlockers, ...failedChecks])];
  const status = failedChecks.length ? "FAIL" : blockedChecks.length ? "BLOCKED" : "PASS";
  const gate = { schemaVersion: 1, reportId: "imp8-calibration-candidate-preflight-gate-v1",
    status, checks, artifacts: evidenceFiles.map(([id, file]) => artifactEntry(root, id, file)),
    blockers, externalBlockers: readiness.externalBlockers.slice(), fingerprint: "" };
  gate.fingerprint = fingerprintObject(gate); validateSchemaObject("imp8-gate-report", gate, root);
  writeReport(output, "imp8-gate-report.json", gate);
  const gateFile = writeImmutableJsonEvidence(output, "imp8-gate", gate);
  return { gate, gateFile, readiness };
}

module.exports = { identityExact, runImp8Gate };
