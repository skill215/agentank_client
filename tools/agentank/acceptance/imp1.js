"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { assertFingerprint, assertTapTitles } = require("./imp0");

const REQUIRED_TEST_TITLES = Object.freeze({
  "A1-01": ["future TankProfiles receive physically isolated run baseline standing and import trees"],
  "A1-02": ["secret echo is rejected before any context artifact is written",
    "successful key rotation changes only the non-secret reference after GET verification",
    "command line rejects key options and values resembling production keys"],
  "A1-03": ["bootstrap context can be inspected but first binding requires expected tankId",
    "confirmed first binding activates profile and stores a secret-free context artifact",
    "expected tank name onboarding constraint rejects a different tank"],
  "A1-04": ["verify-profile rejects tankUrlId drift and cross-profile identity",
    "key rotation rejects stale generations and a key bound to another tank",
    "wrong key authentication failure does not bind or alter a profile",
    "successful key rotation changes only the non-secret reference after GET verification"],
  "A1-05": ["different tank profiles sharing an owner also share one cooldown",
    "server nextSimulationAt can only extend the local cooldown"],
  "A1-06": ["registered profile archives a main baseline and UNKNOWN-safe CapabilityProfile",
    "expected poison onboarding constraint rejects a conflicting platform skill"],
  "A1-07": ["dry-run resolves no secret and performs no local or platform write",
    "CLI dry-run preserves the registry and returns a GET-only plan",
    "IMP1 read-only client rejects POST before transport",
    "publish and challenge commands remain unreachable in IMP1"],
  "A1-08": ["registry lock rejects concurrent update and preserves fingerprint",
    "registry bootstrap and update use the same concurrency lock",
    "corrupt TankRegistry fails closed without being rewritten",
    "atomic interruption preserves original file and removes temporary bytes",
    "secret echo is rejected before any context artifact is written"]
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadPreviousAcceptance(root) {
  const current = contained(root, "artifacts", "reports", "acceptance", "IMP0",
    "imp0-acceptance-report.json");
  invariant(fs.existsSync(current), "IMP0_ACCEPTANCE_NOT_FOUND",
    "IMP1 requires an IMP0 acceptance report");
  const report = readJson(current);
  validateSchemaObject("imp-acceptance-report", report, root);
  assertFingerprint(report, "IMP0_ACCEPTANCE_FINGERPRINT_MISMATCH");
  invariant(report.status === "ACCEPTED", "IMP0_NOT_ACCEPTED", "IMP0 is not ACCEPTED");
  const immutable = contained(root, "artifacts", "reports", "acceptance", "IMP0", "history",
    `imp0-acceptance-${report.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP0_ACCEPTANCE_CURRENT_DIVERGES", "IMP0 acceptance pointer is not immutable evidence");
  return report;
}

function loadSourceGate(root, gateFile) {
  const current = gateFile || contained(root, "artifacts", "reports", "imp1",
    "imp1-gate-report.json");
  invariant(fs.existsSync(current), "IMP1_GATE_NOT_FOUND", "IMP1 implementation gate is missing");
  const gate = readJson(current);
  validateSchemaObject("imp1-gate-report", gate, root);
  assertFingerprint(gate, "IMP1_GATE_FINGERPRINT_MISMATCH");
  const immutable = contained(root, "artifacts", "reports", "imp1", "history",
    `imp1-gate-${gate.fingerprint}.json`);
  invariant(fs.existsSync(immutable), "IMP1_IMMUTABLE_GATE_NOT_FOUND",
    "content-addressed IMP1 gate is missing");
  invariant(fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP1_CURRENT_GATE_DIVERGES", "current IMP1 gate differs from immutable evidence");
  return { gate, immutable, sha256: sha256Bytes(fs.readFileSync(immutable)) };
}

function evidenceMap(root, gate) {
  const historyRoot = contained(root, "artifacts", "reports", "imp1", "history");
  const map = new Map();
  for (const entry of gate.artifacts) {
    invariant(!map.has(entry.artifactId), "DUPLICATE_ACCEPTANCE_EVIDENCE",
      `duplicate evidence artifact: ${entry.artifactId}`);
    const file = contained(root, entry.relativePath);
    invariant(file.startsWith(`${historyRoot}${path.sep}`), "ACCEPTANCE_EVIDENCE_NOT_IMMUTABLE",
      "IMP1 evidence must be under its content-addressed history directory");
    invariant(fs.existsSync(file), "ACCEPTANCE_EVIDENCE_MISSING",
      `missing IMP1 evidence: ${entry.artifactId}`);
    const bytes = fs.readFileSync(file);
    invariant(sha256Bytes(bytes) === entry.sha256, "ACCEPTANCE_EVIDENCE_SHA_MISMATCH",
      `IMP1 evidence hash mismatch: ${entry.artifactId}`);
    const value = file.endsWith(".json") ? JSON.parse(bytes.toString("utf8")) : null;
    if (value?.fingerprint) assertFingerprint(value);
    map.set(entry.artifactId, { entry, file, bytes, value });
  }
  return map;
}

function criterion(criterionId, evaluator) {
  try {
    const value = evaluator();
    return { criterionId, status: value.status || "PASS", evidence: value.evidence || value };
  } catch (error) {
    return { criterionId, status: "FAIL", evidence: { errorCode: error.code ||
      "ACCEPTANCE_CRITERION_ERROR" } };
  }
}

function acceptanceStatus(criteria) {
  if (criteria.some(item => item.status === "FAIL")) return "REJECTED";
  if (criteria.some(item => item.status === "BLOCKED")) return "BLOCKED";
  return "ACCEPTED";
}

function inspectImp1Acceptance(workspaceRoot = defaultWorkspaceRoot(), gateFile) {
  const root = path.resolve(workspaceRoot);
  const contractFile = contained(root, "docs", "design", "imp-acceptance-contract.md");
  invariant(fs.existsSync(contractFile), "ACCEPTANCE_CONTRACT_NOT_FOUND",
    "IMP acceptance contract is missing");
  const acceptanceContractSha256 = sha256Bytes(fs.readFileSync(contractFile));
  const previous = loadPreviousAcceptance(root);
  invariant(previous.acceptanceContractSha256 === acceptanceContractSha256,
    "PREVIOUS_ACCEPTANCE_CONTRACT_STALE", "IMP0 was accepted against a different contract");
  const source = loadSourceGate(root, gateFile);
  const evidence = evidenceMap(root, source.gate);
  const required = id => {
    const item = evidence.get(id);
    invariant(item, "ACCEPTANCE_EVIDENCE_ID_MISSING", `missing evidence id: ${id}`);
    return item;
  };
  const tap = required("test-output").bytes.toString("utf8");
  const tests = required("tests").value;
  invariant(tests.status === "PASS" && tests.tests > 0 && tests.fail === 0,
    "IMP1_TEST_DENOMINATOR_INVALID", "IMP1 tests are incomplete");
  const check = id => {
    const value = source.gate.checks.find(item => item.checkId === id);
    invariant(value, "IMP1_GATE_CHECK_MISSING", `missing gate check: ${id}`);
    return value;
  };
  const external = required("external-context").value;
  const externalCriterion = (criterionId, localEvidence = {}) => criterion(criterionId, () => {
    if (external.status === "FAIL") return { status: "FAIL", evidence: {
      errorCode: "REAL_CONTEXT_IDENTITY_FAILED", profileResults: external.profileResults,
      ...localEvidence } };
    if (external.status === "BLOCKED") return { status: "BLOCKED", evidence: {
      errorCode: "REAL_CONTEXT_EVIDENCE_BLOCKED", profileResults: external.profileResults,
      ...localEvidence } };
    invariant(external.status === "PASS" && external.platformMutationCount === 0 &&
      external.profileResults.length > 0 && external.profileResults.every(item =>
        item.status === "PASS" && item.verifiedBranches.includes("main")),
    "REAL_CONTEXT_EVIDENCE_INVALID", "real context evidence is incomplete");
    return { profileResults: external.profileResults, ...localEvidence };
  });
  const criteria = [
    criterion("A1-01", () => {
      const audit = required("registry-directories").value;
      invariant(audit.status === "PASS" && check("REGISTRY_DIRECTORIES").status === "PASS",
        "REGISTRY_DIRECTORY_ACCEPTANCE_FAILED", "registry or profile directories failed");
      return { registryFingerprint: audit.registryFingerprint, profileResults: audit.profileResults,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A1-01"]) };
    }),
    criterion("A1-02", () => {
      const scan = required("secret-scan").value;
      invariant(scan.status === "PASS" && scan.findings.length === 0 &&
        check("SECRET_BOUNDARY").status === "PASS", "SECRET_ACCEPTANCE_FAILED",
      "secret material crossed the persistence boundary");
      return { scannedFiles: scan.scannedFiles,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A1-02"]) };
    }),
    externalCriterion("A1-03", { authenticatedGetOnly: external.authenticatedGetOnly,
      requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A1-03"]) }),
    criterion("A1-04", () => {
      invariant(check("IDENTITY_ROTATION_FAULTS").status === "PASS",
        "IDENTITY_ROTATION_TESTS_FAILED", "identity or rotation fault tests failed");
      return { requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A1-04"]) };
    }),
    criterion("A1-05", () => {
      invariant(check("OWNER_SCOPE_RATE_LIMIT").status === "PASS",
        "OWNER_RATE_LIMIT_TESTS_FAILED", "owner-scope limiter tests failed");
      return { requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A1-05"]) };
    }),
    externalCriterion("A1-06", {
      requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A1-06"]),
      unknownPolicy: "PRESERVE_UNKNOWN"
    }),
    criterion("A1-07", () => {
      const audit = required("read-only").value;
      invariant(audit.status === "PASS" && audit.checks.platformMutationsDuringGate === 0 &&
        check("READ_ONLY_BOUNDARY").status === "PASS", "READ_ONLY_ACCEPTANCE_FAILED",
      "IMP1 platform mutation boundary is reachable");
      return { platformMutationCount: 0,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A1-07"]) };
    }),
    criterion("A1-08", () => {
      invariant(check("RECOVERY_FAULTS").status === "PASS", "RECOVERY_TESTS_FAILED",
        "registry recovery fault tests failed");
      return { requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A1-08"]) };
    })
  ];
  if (source.gate.status !== "PASS") {
    criteria[criteria.length - 1] = { criterionId: "A1-08", status: "FAIL",
      evidence: { errorCode: "IMP1_IMPLEMENTATION_GATE_FAILED", blockers: source.gate.blockers } };
  }
  const status = acceptanceStatus(criteria);
  const blockers = criteria.filter(item => item.status !== "PASS").map(item => item.criterionId);
  if (external.status === "BLOCKED") {
    for (const profile of external.profileResults.filter(item => item.status === "BLOCKED")) {
      blockers.push(`${profile.tankProfileId}:${profile.errorCode}`);
    }
  }
  const report = { schemaVersion: 1, acceptanceContractVersion: "IMP-ACCEPTANCE-V1",
    acceptanceContractSha256, stageId: "IMP1", status,
    previousStageAcceptanceFingerprint: previous.fingerprint,
    sourceGate: { relativePath: path.relative(root, source.immutable), sha256: source.sha256,
      fingerprint: source.gate.fingerprint },
    criteria, evidenceArtifacts: source.gate.artifacts.map(item => ({ ...item })), blockers,
    fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  validateSchemaObject("imp-acceptance-report", report, root);
  return report;
}

function acceptImp1(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const report = inspectImp1Acceptance(root);
  const directory = contained(root, "artifacts", "reports", "acceptance", "IMP1");
  const history = contained(directory, "history");
  ensureDirectory(history);
  const immutable = contained(history, `imp1-acceptance-${report.fingerprint}.json`);
  writeJsonImmutable(immutable, report, { mode: 0o644 });
  writeJsonAtomic(contained(directory, "imp1-acceptance-report.json"), report, { mode: 0o644 });
  return { report, immutable };
}

module.exports = { REQUIRED_TEST_TITLES, loadPreviousAcceptance, loadSourceGate, evidenceMap,
  criterion, acceptanceStatus, inspectImp1Acceptance, acceptImp1 };
