"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { assertFingerprint, assertTapTitles } = require("./imp0");
const { criterion, acceptanceStatus } = require("./imp1");

const REQUIRED_TEST_TITLES = Object.freeze({
  "A8-01": ["Discovery Calibration and Frozen lanes reject every Frozen tuning path"],
  "A8-02": ["risk weights depth cache Arena batch and fallback expose calibration provenance"],
  "A8-03": ["Rule Feature Search Runtime Memory and Capability locks contain no floating latest input"],
  "A8-04": ["source minified and BuildManifest rebuild byte identically with strip differential and local byte gates"],
  "A8-05": ["candidate preflight binds and freezes the exact executable v2 poison manifest"],
  "A8-06": ["Frozen denominator membership and thresholds are reconstructed and preregistered before execution"],
  "A8-07": ["nonweighted G0 through G9 and G10A all pass for the frozen candidate"],
  "A8-08": ["external-only boundary closes after every internal Candidate blocker is resolved"]
});

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function loadPrevious(root) {
  const current = contained(root, "artifacts", "reports", "acceptance", "IMP7",
    "imp7-acceptance-report.json");
  invariant(fs.existsSync(current), "IMP7_ACCEPTANCE_NOT_FOUND", "IMP8 requires IMP7 acceptance");
  const report = readJson(current); validateSchemaObject("imp-acceptance-report", report, root);
  assertFingerprint(report); invariant(report.status === "ACCEPTED", "IMP7_NOT_ACCEPTED", "IMP7 is not accepted");
  const immutable = contained(root, "artifacts", "reports", "acceptance", "IMP7", "history",
    `imp7-acceptance-${report.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP7_ACCEPTANCE_CURRENT_DIVERGES", "IMP7 acceptance is not immutable");
  return report;
}

function loadGate(root) {
  const current = contained(root, "artifacts", "reports", "imp8", "imp8-gate-report.json");
  invariant(fs.existsSync(current), "IMP8_GATE_NOT_FOUND", "IMP8 gate missing");
  const gate = readJson(current); validateSchemaObject("imp8-gate-report", gate, root); assertFingerprint(gate);
  const immutable = contained(root, "artifacts", "reports", "imp8", "history",
    `imp8-gate-${gate.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP8_CURRENT_GATE_DIVERGES", "IMP8 gate is not immutable");
  return { gate, immutable, sha256: sha256Bytes(fs.readFileSync(immutable)) };
}

function evidence(root, gate) {
  const base = contained(root, "artifacts", "reports", "imp8", "history"); const map = new Map();
  for (const entry of gate.artifacts) {
    invariant(!map.has(entry.artifactId), "DUPLICATE_ACCEPTANCE_EVIDENCE", entry.artifactId);
    const file = contained(root, entry.relativePath);
    invariant(file.startsWith(`${base}${path.sep}`) && fs.existsSync(file),
      "IMP8_EVIDENCE_MISSING", entry.artifactId);
    const bytes = fs.readFileSync(file);
    invariant(sha256Bytes(bytes) === entry.sha256, "IMP8_EVIDENCE_HASH_INVALID", entry.artifactId);
    const value = file.endsWith(".json") ? JSON.parse(bytes) : null;
    if (value?.fingerprint) assertFingerprint(value);
    map.set(entry.artifactId, { bytes, value });
  }
  return map;
}

function inspectImp8Acceptance(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const contract = contained(root, "docs", "design", "imp-acceptance-contract.md");
  const contractHash = sha256Bytes(fs.readFileSync(contract)); const previous = loadPrevious(root);
  invariant(previous.acceptanceContractSha256 === contractHash,
    "PREVIOUS_ACCEPTANCE_CONTRACT_STALE", "IMP7 used a different acceptance contract");
  const source = loadGate(root); const files = evidence(root, source.gate);
  const required = id => { const value = files.get(id); invariant(value, "IMP8_EVIDENCE_ID_MISSING", id); return value; };
  const tap = required("test-output").bytes.toString("utf8"); const tests = required("tests").value;
  invariant(tests.status === "PASS" && tests.tests > 0 && tests.fail === 0,
    "IMP8_TEST_DENOMINATOR_INVALID", "IMP8 tests are incomplete");
  const readiness = required("readiness").value; const provenance = required("parameter-provenance").value;
  const lock = required("profile-lock").value; const build = required("build-reproducibility").value;
  const identity = required("candidate-identity").value; const testPlan = required("test-plan").value;
  const localGates = required("local-gates").value;
  const candidateBlocker = build.productionRootAudit.status === "PASS" ?
    "CANDIDATE_MANIFEST_NOT_FROZEN" : "PRODUCTION_ROOT_PIPELINE_NOT_IMPLEMENTED";
  const gateCheck = id => { const item = source.gate.checks.find(value => value.checkId === id);
    invariant(item, "IMP8_GATE_CHECK_MISSING", id); return item; };
  const conditional = (criterionId, checkId, errorCode, value, passValidator) => criterion(criterionId, () => {
    const gate = gateCheck(checkId); const requiredPassingTests = assertTapTitles(tap,
      REQUIRED_TEST_TITLES[criterionId]);
    invariant(gate.status !== "FAIL", "IMP8_GATE_CHECK_FAILED", checkId);
    if (gate.status === "BLOCKED") return { status: "BLOCKED",
      evidence: { errorCode, ...value, requiredPassingTests } };
    invariant(gate.status === "PASS", "IMP8_GATE_CHECK_STATUS_INVALID", checkId);
    passValidator(); return { ...value, requiredPassingTests };
  });
  const criteria = [
    criterion("A8-01", () => { invariant(gateCheck("LANE_ISOLATION").status === "PASS" &&
      readiness.laneIsolation.frozenCanTune === false, "IMP8_LANE_ISOLATION_FAILED", "Frozen can tune");
      return { laneFingerprint: readiness.laneIsolation.fingerprint,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A8-01"]) }; }),
    conditional("A8-02", "CALIBRATION_PROVENANCE", "CALIBRATION_PROVENANCE_INCOMPLETE", { uncalibrated:
      provenance.dimensions.filter(item => item.status !== "CALIBRATED_LOCAL").map(item => item.dimension) },
    () => invariant(provenance.dimensions.every(item => item.status === "CALIBRATED_LOCAL"),
      "IMP8_CALIBRATION_INCOMPLETE", "parameter provenance is incomplete")),
    criterion("A8-03", () => { invariant(gateCheck("PROFILE_LOCK_EXACT").status === "PASS" &&
      lock.floatingInputCount === 0, "IMP8_PROFILE_LOCK_FAILED", "profile lock is floating");
      return { profileLockFingerprint: lock.fingerprint,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A8-03"]) }; }),
    criterion("A8-04", () => { invariant(gateCheck("BUILD_REPRODUCIBLE").status === "PASS" &&
      build.sourceEqual && build.minifiedEqual && build.manifestEqual,
    "IMP8_BUILD_REPRODUCIBILITY_FAILED", "build is not reproducible");
      return { sourceSha256: build.sourceSha256, minifiedSha256: build.minifiedSha256,
        buildManifestFingerprint: build.buildManifestFingerprint,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A8-04"]) }; }),
    conditional("A8-05", "CANDIDATE_IDENTITY_AND_PUBLISH_BINDING", candidateBlocker, {
      targetTankProfileId: identity.targetTankProfileId, targetTankId: identity.targetTankId,
      targetSkillId: identity.targetSkillId, branch: identity.branch,
      publishArtifactSha256: identity.publishArtifactSha256,
      emittedCallCount: build.productionRootAudit.emittedCallCount, candidateFrozen: identity.candidateFrozen },
    () => invariant(identity.candidateFrozen && build.productionRootAudit.status === "PASS" &&
      build.productionRootAudit.emittedCallCount > 0, "IMP8_CANDIDATE_NOT_EXECUTABLE",
    "Candidate root is not executable")),
    conditional("A8-06", "FROZEN_TEST_PLAN_PREREGISTRATION", "FROZEN_ASSIGNMENT_MEMBERSHIP_MISSING", {
      testPlanFingerprint: testPlan.fingerprint, expectedMatchCount: testPlan.frozenSource.expectedMatchCount,
      actualMatchCount: testPlan.frozenSource.matchUrlIds.length, thresholds: testPlan.thresholds },
    () => invariant(testPlan.status === "READY" && testPlan.frozenSource.assignmentAvailable &&
      testPlan.frozenSource.matchUrlIds.length === testPlan.frozenSource.expectedMatchCount,
    "IMP8_FROZEN_TEST_PLAN_INCOMPLETE", "Frozen TestPlan is incomplete")),
    conditional("A8-07", "NONWEIGHTED_LOCAL_GATES", "NONWEIGHTED_LOCAL_GATE_INCOMPLETE", {
      gateStatuses: localGates.gates.map(item => ({ gateId: item.gateId, status: item.status })),
      strictErrorTolerance: 0 }, () => invariant(localGates.gates.every(item => item.status === "PASS"),
      "IMP8_LOCAL_GATE_INCOMPLETE", "a nonweighted local gate is incomplete")),
    conditional("A8-08", "EXTERNAL_ONLY_BOUNDARY", "INTERNAL_CANDIDATE_BLOCKERS_REMAIN", {
      internalBlockers: source.gate.blockers, externalBlockers: source.gate.externalBlockers },
    () => invariant(source.gate.blockers.length === 0 && source.gate.externalBlockers.length > 0,
      "IMP8_EXTERNAL_BOUNDARY_INVALID", "internal blockers remain or external boundary is absent"))
  ];
  invariant(source.gate.status !== "FAIL", "IMP8_IMPLEMENTATION_GATE_FAILED",
    "IMP8 gate has a local failure rather than a declared blocker");
  const status = acceptanceStatus(criteria);
  const blockers = [...new Set([...criteria.filter(item => item.status !== "PASS").map(item => item.criterionId),
    ...source.gate.blockers])];
  const report = { schemaVersion: 1, acceptanceContractVersion: "IMP-ACCEPTANCE-V1",
    acceptanceContractSha256: contractHash, stageId: "IMP8", status,
    previousStageAcceptanceFingerprint: previous.fingerprint,
    sourceGate: { relativePath: path.relative(root, source.immutable), sha256: source.sha256,
      fingerprint: source.gate.fingerprint }, criteria,
    evidenceArtifacts: source.gate.artifacts.map(item => ({ ...item })), blockers, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); validateSchemaObject("imp-acceptance-report", report, root);
  return report;
}

function acceptImp8(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const report = inspectImp8Acceptance(root);
  const directory = contained(root, "artifacts", "reports", "acceptance", "IMP8");
  const history = path.join(directory, "history"); ensureDirectory(history);
  const immutable = path.join(history, `imp8-acceptance-${report.fingerprint}.json`);
  writeJsonImmutable(immutable, report, { mode: 0o644 });
  writeJsonAtomic(path.join(directory, "imp8-acceptance-report.json"), report, { mode: 0o644 });
  return { report, immutable };
}

module.exports = { REQUIRED_TEST_TITLES, inspectImp8Acceptance, acceptImp8 };
