"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");

const REQUIRED_TEST_TITLES = Object.freeze({
  "A0-03": [
    "atomic JSON write is idempotent for identical bytes",
    "content-addressed evidence cannot be overwritten with different bytes",
    "RunManifest chain verification detects an altered immutable revision",
    "all registered platform and IMP0 schemas compile under the pinned validator"
  ],
  "A0-04": [
    "fixed seed PRNG has a stable integer sequence",
    "fixture loader returns the same raw and semantic fingerprints",
    "synthetic clock is integer and deterministic",
    "allocation and arena instrumentation fail closed"
  ],
  "A0-06": [
    "semantic fingerprints preserve integer TypedArray type and values",
    "root comparator identifies and rejects an intentional mutation",
    "differential report distinguishes semantic and root failures"
  ],
  "A0-07": [
    "an intentionally malformed IMP0 manifest is rejected by schema",
    "root comparator identifies and rejects an intentional mutation",
    "allocation and arena instrumentation fail closed",
    "an intentionally unstripped source is rejected",
    "production imports cannot escape to Reference or offline tools",
    "zero-test output is a hard failure even with exit code zero",
    "content-addressed evidence cannot be overwritten with different bytes"
  ]
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertFingerprint(value, code = "ACCEPTANCE_FINGERPRINT_MISMATCH") {
  invariant(typeof value.fingerprint === "string" && fingerprintObject(value) === value.fingerprint,
    code, "artifact fingerprint is invalid");
  return value.fingerprint;
}

function loadSourceGate(workspaceRoot = defaultWorkspaceRoot(), gateFile) {
  const root = path.resolve(workspaceRoot);
  const current = gateFile || contained(root, "artifacts", "reports", "imp0",
    "imp0-gate-report.json");
  invariant(fs.existsSync(current), "IMP0_GATE_NOT_FOUND", "IMP0 implementation gate is missing");
  const gate = readJson(current);
  validateSchemaObject("imp0-gate-report", gate, root);
  assertFingerprint(gate, "IMP0_GATE_FINGERPRINT_MISMATCH");
  const immutable = contained(root, "artifacts", "reports", "imp0", "history",
    `imp0-gate-${gate.fingerprint}.json`);
  invariant(fs.existsSync(immutable), "IMP0_IMMUTABLE_GATE_NOT_FOUND",
    "content-addressed IMP0 gate is missing");
  invariant(fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP0_CURRENT_GATE_DIVERGES", "current IMP0 gate differs from immutable evidence");
  return { gate, current, immutable, sha256: sha256Bytes(fs.readFileSync(immutable)) };
}

function verifyEvidenceArtifact(workspaceRoot, entry) {
  const root = path.resolve(workspaceRoot);
  const historyRoot = contained(root, "artifacts", "reports", "imp0", "history");
  const file = contained(root, entry.relativePath);
  invariant(file.startsWith(`${historyRoot}${path.sep}`), "ACCEPTANCE_EVIDENCE_NOT_IMMUTABLE",
    "IMP0 evidence must be stored under the content-addressed history directory");
  invariant(fs.existsSync(file), "ACCEPTANCE_EVIDENCE_MISSING",
    `evidence artifact is missing: ${entry.artifactId}`);
  const bytes = fs.readFileSync(file);
  invariant(sha256Bytes(bytes) === entry.sha256, "ACCEPTANCE_EVIDENCE_SHA_MISMATCH",
    `evidence artifact hash mismatch: ${entry.artifactId}`);
  let value = null;
  if (file.endsWith(".json")) {
    value = JSON.parse(bytes.toString("utf8"));
    if (value && typeof value.fingerprint === "string") assertFingerprint(value);
  }
  return { entry, file, bytes, value };
}

function evidenceMap(workspaceRoot, gate) {
  const map = new Map();
  for (const entry of gate.artifacts) {
    invariant(!map.has(entry.artifactId), "DUPLICATE_ACCEPTANCE_EVIDENCE",
      `duplicate evidence artifact: ${entry.artifactId}`);
    map.set(entry.artifactId, verifyEvidenceArtifact(workspaceRoot, entry));
  }
  return map;
}

function requireEvidence(map, artifactId) {
  const value = map.get(artifactId);
  invariant(value, "ACCEPTANCE_EVIDENCE_ID_MISSING", `missing evidence id: ${artifactId}`);
  return value;
}

function assertTapTitles(tap, titles) {
  const missing = titles.filter(title => !tap.includes(`# Subtest: ${title}`));
  invariant(missing.length === 0, "ACCEPTANCE_NEGATIVE_CONTROL_MISSING",
    `required test evidence is missing: ${missing.join(", ")}`);
  for (const title of titles) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    invariant(new RegExp(`^ok \\d+ - ${escaped}$`, "m").test(tap),
      "ACCEPTANCE_REQUIRED_TEST_NOT_PASS", `required test did not pass: ${title}`);
  }
  return titles.length;
}

function evaluateCriterion(criterionId, evaluator) {
  try {
    return { criterionId, status: "PASS", evidence: evaluator() };
  } catch (error) {
    return { criterionId, status: "FAIL", evidence: { errorCode: error.code ||
      "ACCEPTANCE_CRITERION_ERROR" } };
  }
}

function inspectImp0Acceptance(workspaceRoot = defaultWorkspaceRoot(), gateFile) {
  const root = path.resolve(workspaceRoot);
  const acceptanceContract = contained(root, "docs", "design", "imp-acceptance-contract.md");
  invariant(fs.existsSync(acceptanceContract), "ACCEPTANCE_CONTRACT_NOT_FOUND",
    "IMP acceptance contract is missing");
  const acceptanceContractSha256 = sha256Bytes(fs.readFileSync(acceptanceContract));
  let source = null;
  let sourceError = null;
  let evidence = null;
  try {
    source = loadSourceGate(root, gateFile);
    evidence = evidenceMap(root, source.gate);
  } catch (error) {
    sourceError = error;
  }
  const withSource = evaluator => {
    invariant(!sourceError && source && evidence, sourceError?.code || "IMP0_SOURCE_GATE_INVALID",
      "IMP0 source gate is invalid");
    return evaluator(source, evidence);
  };
  const tap = () => requireEvidence(evidence, "test-output").bytes.toString("utf8");
  const criteria = [
    evaluateCriterion("A0-01", () => withSource((_source, map) => {
      const toolchain = requireEvidence(map, "toolchain").value;
      invariant(toolchain.status === "PASS" && Object.values(toolchain.checks).every(Boolean),
        "TOOLCHAIN_ACCEPTANCE_FAILED", "toolchain report did not pass all checks");
      return { toolchainFingerprint: toolchain.fingerprint, node: toolchain.actual.node,
        npm: toolchain.actual.npm, terser: toolchain.actual.terser };
    })),
    evaluateCriterion("A0-02", () => withSource((_source, map) => {
      const structure = requireEvidence(map, "structure").value;
      invariant(structure.status === "PASS" && structure.missingDirectories.length === 0 &&
        structure.hardcodedLegacyCountFiles.length === 0 && structure.legacyLayoutStatus ===
        "MIGRATION_INPUT", "STRUCTURE_ACCEPTANCE_FAILED", "workspace structure is incompatible");
      return { structureFingerprint: structure.fingerprint, recordCounts: structure.recordCounts,
        legacyLayoutStatus: structure.legacyLayoutStatus };
    })),
    evaluateCriterion("A0-03", () => withSource(() => ({
      requiredPassingTests: assertTapTitles(tap(), REQUIRED_TEST_TITLES["A0-03"])
    }))),
    evaluateCriterion("A0-04", () => withSource((_source, map) => {
      const fixture = requireEvidence(map, "fixtures").value;
      invariant(fixture.fixtureCount > 0, "ZERO_FIXTURE_ACCEPTANCE",
        "fixture set must not be empty");
      return { fixtureSetFingerprint: fixture.fingerprint,
        requiredPassingTests: assertTapTitles(tap(), REQUIRED_TEST_TITLES["A0-04"]) };
    })),
    evaluateCriterion("A0-05", () => withSource((_source, map) => {
      const benchmark = requireEvidence(map, "benchmark").value;
      const expected = ["function", "composite", "pipeline", "terminal", "full-game", "platform"];
      invariant(benchmark.status === "NOT_RUN" && benchmark.layers.length === 6 &&
        benchmark.layers.map(layer => layer.layerId).join("|") === expected.join("|") &&
        benchmark.layers.every(layer => layer.status === "NOT_RUN" &&
          layer.reason === "ZERO_SAMPLES" && layer.sampleCount === 0),
      "BENCHMARK_ZERO_SAMPLE_ACCEPTANCE_FAILED", "six-layer zero-sample semantics are invalid");
      return { benchmarkFingerprint: benchmark.fingerprint, layerCount: benchmark.layers.length,
        status: benchmark.status };
    })),
    evaluateCriterion("A0-06", () => withSource(() => ({
      requiredPassingTests: assertTapTitles(tap(), REQUIRED_TEST_TITLES["A0-06"])
    }))),
    evaluateCriterion("A0-07", () => withSource(() => ({
      requiredNegativeControls: assertTapTitles(tap(), REQUIRED_TEST_TITLES["A0-07"])
    }))),
    evaluateCriterion("A0-08", () => withSource((_source, map) => {
      const production = requireEvidence(map, "production-policy").value;
      const structure = requireEvidence(map, "structure").value;
      invariant(production.status === "PASS" && production.productionSourceStatus === "NOT_RUN" &&
        production.scannedFiles === 0 && structure.productionJavaScriptFiles === 0,
      "PRODUCTION_BOUNDARY_ACCEPTANCE_FAILED", "production boundary is not an empty IMP0 skeleton");
      return { policyFingerprint: production.policyFingerprint,
        productionSourceStatus: production.productionSourceStatus };
    })),
    evaluateCriterion("A0-09", () => withSource((gateSource, map) => {
      const isolation = requireEvidence(map, "isolation").value;
      const gateCheck = gateSource.gate.checks.find(item => item.checkId ===
        "PLATFORM_MUTATION_ABSENT");
      invariant(isolation.status === "PASS" && isolation.findings.length === 0 && gateCheck &&
        gateCheck.status === "PASS" && gateCheck.evidence.externalRequestsDuringGate === 0,
      "IMP0_PLATFORM_BOUNDARY_FAILED", "IMP0 reached a platform/network mutation boundary");
      return { isolationFingerprint: isolation.fingerprint, scannedFiles: isolation.scannedFiles,
        externalRequests: 0 };
    })),
    evaluateCriterion("A0-10", () => withSource((gateSource, map) => {
      invariant(gateSource.gate.status === "PASS" && gateSource.gate.blockers.length === 0,
        "IMP0_GATE_NOT_PASS", "IMP0 implementation gate is not PASS");
      const tests = requireEvidence(map, "tests").value;
      invariant(tests.status === "PASS" && tests.tests > 0 && tests.pass === tests.tests &&
        tests.fail === 0, "IMP0_TEST_DENOMINATOR_INVALID", "IMP0 tests are incomplete");
      return { gateFingerprint: gateSource.gate.fingerprint, immutableArtifactCount: map.size,
        tests: tests.tests, pass: tests.pass, fail: tests.fail };
    }))
  ];
  const blockers = criteria.filter(item => item.status === "FAIL").map(item => item.criterionId);
  const gate = source?.gate || null;
  const verifiedEntries = [];
  if (gate && evidence) {
    for (const entry of gate.artifacts) {
      if (evidence.has(entry.artifactId)) verifiedEntries.push({ ...entry });
    }
  }
  const sourcePath = source?.immutable || gateFile || contained(root, "artifacts", "reports", "imp0",
    "imp0-gate-report.json");
  const report = {
    schemaVersion: 1,
    acceptanceContractVersion: "IMP-ACCEPTANCE-V1",
    acceptanceContractSha256,
    stageId: "IMP0",
    status: blockers.length === 0 ? "ACCEPTED" : "REJECTED",
    previousStageAcceptanceFingerprint: null,
    sourceGate: {
      relativePath: path.relative(root, sourcePath),
      sha256: source?.sha256 || null,
      fingerprint: gate?.fingerprint || null
    },
    criteria,
    evidenceArtifacts: verifiedEntries,
    blockers,
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  validateSchemaObject("imp-acceptance-report", report, root);
  return report;
}

function acceptImp0(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const report = inspectImp0Acceptance(root);
  const directory = contained(root, "artifacts", "reports", "acceptance", "IMP0");
  const history = contained(directory, "history");
  ensureDirectory(history);
  const immutable = contained(history, `imp0-acceptance-${report.fingerprint}.json`);
  writeJsonImmutable(immutable, report, { mode: 0o644 });
  writeJsonAtomic(contained(directory, "imp0-acceptance-report.json"), report, { mode: 0o644 });
  return { report, immutable };
}

module.exports = { REQUIRED_TEST_TITLES, readJson, assertFingerprint, loadSourceGate,
  verifyEvidenceArtifact, evidenceMap, requireEvidence, assertTapTitles, evaluateCriterion,
  inspectImp0Acceptance, acceptImp0 };
