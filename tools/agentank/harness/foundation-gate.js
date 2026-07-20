"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable, writeFileImmutable } =
  require("../core/atomic-file");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { scanForSecrets } = require("../core/secret-scan");
const { validateSchemaObject } = require("../core/schema-validator");
const { inspectToolVersions } = require("./tool-versions");
const { auditImp0Isolation } = require("./imp0-isolation");
const { loadFixtureSet } = require("./fixture-loader");
const { auditWorkspaceStructure } = require("./structure-audit");
const { summarizeTestOutput } = require("./test-runner");
const { runBenchmarkPlan } = require("../benchmark/runner");
const { auditProductionTree } = require("../build/production-policy");

function writeReport(directory, filename, value) {
  const file = path.join(directory, filename);
  writeJsonAtomic(file, value, { mode: 0o644 });
  return file;
}

function writeImmutableJsonEvidence(outputDirectory, artifactId, value) {
  const history = path.join(outputDirectory, "history");
  const identity = value.fingerprint || fingerprintObject(value);
  const file = path.join(history, `${artifactId}-${identity}.json`);
  writeJsonImmutable(file, value, { mode: 0o644 });
  return file;
}

function writeImmutableRawEvidence(outputDirectory, artifactId, extension, contents) {
  const history = path.join(outputDirectory, "history");
  const identity = sha256Bytes(Buffer.from(contents));
  const file = path.join(history, `${artifactId}-${identity}.${extension}`);
  writeFileImmutable(file, contents, { mode: 0o644 });
  return file;
}

function artifactEntry(root, artifactId, file) {
  return { artifactId, relativePath: path.relative(root, file),
    sha256: sha256Bytes(fs.readFileSync(file)) };
}

function check(checkId, status, evidence) {
  return { checkId, status, evidence };
}

function runImp0FoundationGate(workspaceRoot = defaultWorkspaceRoot(), options = {}) {
  const root = path.resolve(workspaceRoot);
  const outputDirectory = path.join(root, "artifacts", "reports", "imp0");
  ensureDirectory(outputDirectory);

  const toolchain = inspectToolVersions(root);
  const fixtureFirst = loadFixtureSet(root);
  const fixtureSecond = loadFixtureSet(root);
  const fixtureSummary = { ...fixtureFirst.summary, fingerprint: fixtureFirst.fingerprint };
  const structure = auditWorkspaceStructure(root);
  const isolation = auditImp0Isolation(root);
  const production = auditProductionTree(root);
  const benchmark = runBenchmarkPlan({ workspaceRoot: root });
  const tests = summarizeTestOutput(root, options.testOutputFile, options.testExitCode,
    outputDirectory);
  const secrets = scanForSecrets(root);

  writeReport(outputDirectory, "toolchain-report.json", toolchain);
  writeReport(outputDirectory, "fixture-set-report.json", fixtureSummary);
  writeReport(outputDirectory, "structure-audit.json", structure);
  writeReport(outputDirectory, "imp0-isolation-audit.json", isolation);
  writeReport(outputDirectory, "production-boundary-audit.json", production);
  writeReport(outputDirectory, "benchmark-skeleton.json", benchmark);
  const files = [
    ["toolchain", writeImmutableJsonEvidence(outputDirectory, "toolchain", toolchain)],
    ["fixtures", writeImmutableJsonEvidence(outputDirectory, "fixtures", fixtureSummary)],
    ["structure", writeImmutableJsonEvidence(outputDirectory, "structure", structure)],
    ["isolation", writeImmutableJsonEvidence(outputDirectory, "isolation", isolation)],
    ["production-policy", writeImmutableJsonEvidence(outputDirectory, "production-policy", production)],
    ["benchmark", writeImmutableJsonEvidence(outputDirectory, "benchmark", benchmark)],
    ["tests", writeImmutableJsonEvidence(outputDirectory, "tests", tests.report)],
    ["test-output", writeImmutableRawEvidence(outputDirectory, "test-output", "tap", tests.output)]
  ];
  const fixtureStable = fixtureFirst.fingerprint === fixtureSecond.fingerprint;
  const benchmarkSkeletonValid = benchmark.status === "NOT_RUN" && benchmark.layers.length === 6 &&
    benchmark.layers.every(layer => layer.status === "NOT_RUN" && layer.reason === "ZERO_SAMPLES");
  const checks = [
    check("TOOLCHAIN_PINNED", toolchain.status, { fingerprint: toolchain.fingerprint }),
    check("STRUCTURE_COMPATIBLE", structure.status, { fingerprint: structure.fingerprint,
      legacyLayoutStatus: structure.legacyLayoutStatus, recordCounts: structure.recordCounts }),
    check("FIXTURE_HASH_REPRODUCIBLE", fixtureStable ? "PASS" : "FAIL",
      { fixtureSetFingerprint: fixtureFirst.fingerprint, fixtureCount: fixtureFirst.fixtures.length }),
    check("BENCHMARK_ZERO_SAMPLE_SEMANTICS", benchmarkSkeletonValid ? "PASS" : "FAIL",
      { benchmarkFingerprint: benchmark.fingerprint, runnerStatus: benchmark.status }),
    check("PRODUCTION_BOUNDARY_POLICY", production.status,
      { policyFingerprint: production.policyFingerprint,
        productionSourceStatus: production.productionSourceStatus }),
    check("FAULT_INJECTION_TESTS", tests.report.status,
      { tests: tests.report.tests, pass: tests.report.pass, fail: tests.report.fail,
        rawOutputSha256: tests.report.rawOutputSha256 }),
    check("SECRET_SCAN", secrets.findings.length === 0 ? "PASS" : "FAIL",
      { scannedFiles: secrets.scannedFiles, findingCount: secrets.findings.length }),
    check("PLATFORM_MUTATION_ABSENT", isolation.status, { auditFingerprint: isolation.fingerprint,
      scannedFiles: isolation.scannedFiles, findingCount: isolation.findings.length,
      externalRequestsDuringGate: 0 })
  ];
  const blockers = checks.filter(item => item.status === "FAIL").map(item => item.checkId);
  const gate = {
    schemaVersion: 1,
    reportId: "imp0-foundation-gate-v1",
    status: blockers.length === 0 ? "PASS" : "FAIL",
    checks,
    artifacts: files.map(([id, file]) => artifactEntry(root, id, file)),
    blockers,
    fingerprint: ""
  };
  gate.fingerprint = fingerprintObject(gate);
  validateSchemaObject("imp0-gate-report", gate, root);
  writeReport(outputDirectory, "imp0-gate-report.json", gate);
  const gateFile = writeImmutableJsonEvidence(outputDirectory, "imp0-gate", gate);
  return { gate, gateFile };
}

module.exports = { writeReport, writeImmutableJsonEvidence, writeImmutableRawEvidence,
  artifactEntry, check, runImp0FoundationGate };
