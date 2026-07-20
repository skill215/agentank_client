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
  "A9-01": ["exact simulation binds every response and attestation to the frozen publish bytes"],
  "A9-02": ["official suite inventory comes from live context and mandatory cold smoke cannot disappear"],
  "A9-03": ["same profile rollback baseline is byte verified and cross profile reuse is rejected"],
  "A9-04": ["publish admission requires durable intent and explicit authorization before POST"],
  "A9-05": ["ambiguous publish is reconciled by GET and never classified from POST alone"],
  "A9-06": ["wrong key stale attestation source mismatch and cross profile rollback fail closed"],
  "A9-07": ["canary readiness records failed official simulation while offline preflight performs zero requests"],
  "A9-08": ["IMP9 exposes no challenge method and preregisters immutable Forward policy"]
});

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function loadPrevious(root) {
  const current = contained(root, "artifacts", "reports", "acceptance", "IMP8",
    "imp8-acceptance-report.json");
  invariant(fs.existsSync(current), "IMP8_ACCEPTANCE_NOT_FOUND", "IMP9 requires an IMP8 acceptance report");
  const report = readJson(current); validateSchemaObject("imp-acceptance-report", report, root);
  assertFingerprint(report); const immutable = contained(root, "artifacts", "reports", "acceptance", "IMP8",
    "history", `imp8-acceptance-${report.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP8_ACCEPTANCE_CURRENT_DIVERGES", "IMP8 acceptance is not immutable");
  return report;
}

function loadGate(root) {
  const current = contained(root, "artifacts", "reports", "imp9", "imp9-gate-report.json");
  invariant(fs.existsSync(current), "IMP9_GATE_NOT_FOUND", "IMP9 gate is missing");
  const gate = readJson(current); validateSchemaObject("imp9-gate-report", gate, root); assertFingerprint(gate);
  const immutable = contained(root, "artifacts", "reports", "imp9", "history",
    `imp9-gate-${gate.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP9_GATE_CURRENT_DIVERGES", "IMP9 gate is not immutable");
  return { gate, immutable, sha256: sha256Bytes(fs.readFileSync(immutable)) };
}

function evidence(root, gate) {
  const base = contained(root, "artifacts", "reports", "imp9", "history"); const map = new Map();
  for (const entry of gate.artifacts) {
    invariant(!map.has(entry.artifactId), "DUPLICATE_ACCEPTANCE_EVIDENCE", entry.artifactId);
    const file = contained(root, entry.relativePath);
    invariant(file.startsWith(`${base}${path.sep}`) && fs.existsSync(file),
      "IMP9_EVIDENCE_MISSING", entry.artifactId);
    const bytes = fs.readFileSync(file);
    invariant(sha256Bytes(bytes) === entry.sha256, "IMP9_EVIDENCE_HASH_INVALID", entry.artifactId);
    const value = file.endsWith(".json") ? JSON.parse(bytes) : null;
    if (value?.fingerprint) assertFingerprint(value); map.set(entry.artifactId, { bytes, value });
  }
  return map;
}

function inspectImp9Acceptance(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const contract = contained(root, "docs", "design",
    "imp-acceptance-contract.md"); const contractHash = sha256Bytes(fs.readFileSync(contract));
  const previous = loadPrevious(root); invariant(previous.acceptanceContractSha256 === contractHash,
    "PREVIOUS_ACCEPTANCE_CONTRACT_STALE", "IMP8 used a different acceptance contract");
  const source = loadGate(root); const files = evidence(root, source.gate);
  const required = id => { const item = files.get(id); invariant(item, "IMP9_EVIDENCE_ID_MISSING", id); return item; };
  const tap = required("test-output").bytes.toString("utf8"); const tests = required("tests").value;
  invariant(tests.status === "PASS" && tests.tests > 0 && tests.fail === 0,
    "IMP9_TEST_DENOMINATOR_INVALID", "IMP9 tests are incomplete");
  const check = id => { const item = source.gate.checks.find(value => value.checkId === id);
    invariant(item, "IMP9_GATE_CHECK_MISSING", id); return item; };
  const mapping = [
    ["A9-01", "EXACT_CANDIDATE_SIMULATION"],
    ["A9-02", "LIVE_CONTEXT_SUITE_ELIGIBILITY"],
    ["A9-03", "ROLLBACK_VERIFIED"],
    ["A9-04", "PUBLISH_EXPLICITLY_AUTHORIZED"],
    ["A9-05", "PUBLISH_RECONCILED"],
    ["A9-06", "PROFILE_AND_HASH_ISOLATION"],
    ["A9-07", "CANARY_PUBLISHED_VERIFIED"],
    ["A9-08", "NO_UNEXPECTED_CHALLENGE"]
  ];
  const criteria = mapping.map(([criterionId, checkId]) => criterion(criterionId, () => {
    const gateCheck = check(checkId); const requiredPassingTests = assertTapTitles(tap,
      REQUIRED_TEST_TITLES[criterionId]);
    invariant(gateCheck.status !== "FAIL", "IMP9_GATE_CHECK_FAILED", checkId);
    if (gateCheck.status === "BLOCKED") return { status: "BLOCKED", evidence: {
      errorCode: checkId, prerequisiteImp8Status: previous.status,
      gateEvidence: gateCheck.evidence, requiredPassingTests } };
    invariant(gateCheck.status === "PASS", "IMP9_GATE_CHECK_STATUS_INVALID", checkId);
    return { gateEvidence: gateCheck.evidence, requiredPassingTests };
  }));
  // A qualified official simulation is a release criterion, not a toolchain
  // exception. Preserve a FAIL gate as a REJECTED acceptance report so the
  // failed Candidate remains auditable and cannot be mistaken for NOT_RUN.
  const status = acceptanceStatus(criteria); const blockers = [...new Set([
    ...criteria.filter(item => item.status !== "PASS").map(item => item.criterionId),
    ...source.gate.blockers])];
  const report = { schemaVersion: 1, acceptanceContractVersion: "IMP-ACCEPTANCE-V1",
    acceptanceContractSha256: contractHash, stageId: "IMP9", status,
    previousStageAcceptanceFingerprint: previous.fingerprint,
    sourceGate: { relativePath: path.relative(root, source.immutable), sha256: source.sha256,
      fingerprint: source.gate.fingerprint }, criteria,
    evidenceArtifacts: source.gate.artifacts.map(item => ({ ...item })), blockers, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); validateSchemaObject("imp-acceptance-report", report, root);
  return report;
}

function acceptImp9(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const report = inspectImp9Acceptance(root);
  const directory = contained(root, "artifacts", "reports", "acceptance", "IMP9");
  const history = path.join(directory, "history"); ensureDirectory(history);
  const immutable = path.join(history, `imp9-acceptance-${report.fingerprint}.json`);
  writeJsonImmutable(immutable, report, { mode: 0o644 });
  writeJsonAtomic(path.join(directory, "imp9-acceptance-report.json"), report, { mode: 0o644 });
  return { report, immutable };
}

module.exports = { REQUIRED_TEST_TITLES, inspectImp9Acceptance, acceptImp9 };
