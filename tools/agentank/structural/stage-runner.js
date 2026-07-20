"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { summarizeTestOutput } = require("../harness/test-runner");
const { buildImp6Production } = require("../build/imp6-builder");
const { analyzeFixedCohort, verifyExpectedCohort, verifyHistoricalCandidate } = require("./sr0");

const STAGES = Object.freeze(["SR0", "SR1", "SR2", "SR3", "SR4", "SR5", "SR6"]);
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function stageDirectory(root, stage) {
  return contained(root, "artifacts", "reports", "structural-repair", stage);
}
function check(checkId, status, evidence = {}) { return { checkId, status, evidence }; }
function reportStatus(checks) {
  return checks.some(item => item.status === "FAIL") ? "REJECTED" :
    checks.some(item => item.status === "BLOCKED") ? "BLOCKED" : "ACCEPTED";
}
function previousAcceptance(root, stage) {
  const index = STAGES.indexOf(stage); if (index === 0) return null;
  const previous = STAGES[index - 1]; const file = path.join(stageDirectory(root, previous),
    `${previous.toLowerCase()}-acceptance-report.json`);
  if (!fs.existsSync(file)) return { stage: previous, status: "MISSING", fingerprint: null };
  const report = readJson(file); return { stage: previous, status: report.status,
    fingerprint: report.fingerprint, file };
}

async function verifySr0(root, options) {
  const baselineFile = contained(root, "config", "engine-v2", "structural-repair-baseline.json");
  const baselineBytes = fs.readFileSync(baselineFile); const baseline = JSON.parse(baselineBytes);
  const cohort = analyzeFixedCohort(root, baseline); cohort.fingerprint = fingerprintObject(cohort);
  const candidate = verifyHistoricalCandidate(root, baseline);
  const buildDirectory = path.join(stageDirectory(root, "SR0"), "build-verification");
  const build = await buildImp6Production({ workspaceRoot: root, outputDirectory: buildDirectory });
  const tests = summarizeTestOutput(root, options.testOutputFile, options.testExitCode,
    stageDirectory(root, "SR0"), { testDirectories: ["sr0"] });
  const checks = verifyExpectedCohort(cohort, baseline.fixedCohort);
  checks.push(check("PRODUCTION_SOURCE_UNCHANGED", build.manifest.sourceHash ===
    baseline.sr0ProductionBaseline.sourceSha256 ? "PASS" : "FAIL",
  { actual: build.manifest.sourceHash, expected: baseline.sr0ProductionBaseline.sourceSha256 }));
  checks.push(check("PRODUCTION_MINIFIED_UNCHANGED", build.manifest.minifiedHash ===
    baseline.sr0ProductionBaseline.minifiedSha256 ? "PASS" : "FAIL",
  { actual: build.manifest.minifiedHash, expected: baseline.sr0ProductionBaseline.minifiedSha256 }));
  checks.push(check("PRODUCTION_MODULE_DENOMINATOR", build.manifest.moduleCount ===
    baseline.sr0ProductionBaseline.moduleCount ? "PASS" : "FAIL",
  { actual: build.manifest.moduleCount, expected: baseline.sr0ProductionBaseline.moduleCount }));
  checks.push(check("HISTORICAL_CANDIDATE_IMMUTABLE", candidate.status,
    { candidateId: candidate.candidateId, actual: candidate.actual, expected: candidate.expected }));
  checks.push(check("WORKING_SOURCE_NOT_OLD_CANDIDATE",
    build.manifest.sourceHash !== candidate.actual.sourceSha256 ? "PASS" : "FAIL",
  { workingSourceSha256: build.manifest.sourceHash, historicalSourceSha256: candidate.actual.sourceSha256 }));
  checks.push(check("SR0_TESTS", tests.report.status, { tests: tests.report.tests,
    pass: tests.report.pass, fail: tests.report.fail, rawOutputSha256: tests.report.rawOutputSha256 }));
  return { baseline: { relativePath: path.relative(root, baselineFile), sha256: sha256Bytes(baselineBytes),
      fingerprint: fingerprintObject(baseline) }, cohort, candidate,
    build: { status: build.manifest.status, sourceSha256: build.manifest.sourceHash,
      minifiedSha256: build.manifest.minifiedHash, moduleCount: build.manifest.moduleCount,
      semanticFingerprint: build.manifest.differential.sourceFingerprint },
    benchmark: { stage: "SR0", status: "BASELINE_CAPTURED", fixedNode: process.version,
      warmupBatches: 1, measuredBatches: 5, p95GuardPer10000: 12000 },
    regression: { status: tests.report.status, denominator: tests.report.tests,
      pass: tests.report.pass, fail: tests.report.fail }, checks };
}

async function verifyStage(stage, options = {}) {
  invariant(STAGES.includes(stage), "STRUCTURAL_STAGE_INVALID", stage);
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const previous = previousAcceptance(root, stage); const output = stageDirectory(root, stage);
  ensureDirectory(output); let evidence; let checks = [];
  if (previous && previous.status !== "ACCEPTED") {
    checks.push(check("PREVIOUS_STAGE_ACCEPTED", "BLOCKED", previous)); evidence = {};
  } else if (stage === "SR0") evidence = await verifySr0(root, options);
  else {
    const implementation = require(`./${stage.toLowerCase()}`);
    evidence = await implementation.verify(root, options);
  }
  checks = [...checks, ...(evidence?.checks || [])];
  const status = reportStatus(checks); const cleanEvidence = { ...(evidence || {}) };
  delete cleanEvidence.checks;
  const report = { schemaVersion: 1,
    reportKind: "STRUCTURAL_REPAIR_GATE", trackId: "V2_STRUCTURAL_REPAIR_SR0_SR6",
    stageId: stage, status, previousStage: previous,
    sourceConfigFingerprint: evidence?.baseline?.fingerprint || null,
    testDenominator: evidence?.regression?.denominator || 0,
    benchmark: evidence?.benchmark || null, regression: evidence?.regression || null,
    checks, evidence: cleanEvidence, fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  writeJsonAtomic(path.join(output, `${stage.toLowerCase()}-gate-report.json`), report, { mode: 0o644 });
  writeJsonImmutable(path.join(output, "history", `${stage.toLowerCase()}-gate-${report.fingerprint}.json`),
    report, { mode: 0o644 });
  const overview = { schemaVersion: 1, reportKind: "STRUCTURAL_REPAIR_OVERVIEW",
    stageId: stage, status, gateFingerprint: report.fingerprint,
    passedChecks: checks.filter(item => item.status === "PASS").length,
    failedChecks: checks.filter(item => item.status === "FAIL").map(item => item.checkId),
    blockedChecks: checks.filter(item => item.status === "BLOCKED").map(item => item.checkId),
    predecessor: previous, fingerprint: "" };
  overview.fingerprint = fingerprintObject(overview);
  writeJsonAtomic(path.join(output, `${stage.toLowerCase()}-overview.json`), overview, { mode: 0o644 });
  writeJsonImmutable(path.join(output, "history", `${stage.toLowerCase()}-overview-${overview.fingerprint}.json`),
    overview, { mode: 0o644 });
  return { report, overview };
}

function acceptStage(stage, workspaceRoot = defaultWorkspaceRoot()) {
  invariant(STAGES.includes(stage), "STRUCTURAL_STAGE_INVALID", stage);
  const root = path.resolve(workspaceRoot); const output = stageDirectory(root, stage);
  const gateFile = path.join(output, `${stage.toLowerCase()}-gate-report.json`);
  invariant(fs.existsSync(gateFile), "STRUCTURAL_GATE_MISSING", stage);
  const gateBytes = fs.readFileSync(gateFile); const gate = JSON.parse(gateBytes);
  invariant(gate.fingerprint === fingerprintObject(gate), "STRUCTURAL_GATE_FINGERPRINT_INVALID", stage);
  const previous = previousAcceptance(root, stage);
  const predecessorAccepted = !previous || previous.status === "ACCEPTED";
  const status = !predecessorAccepted ? "BLOCKED" : gate.status;
  const report = { schemaVersion: 1, reportKind: "STRUCTURAL_REPAIR_ACCEPTANCE",
    trackId: gate.trackId, stageId: stage, status,
    previousStageAcceptanceFingerprint: previous?.fingerprint || null,
    sourceGate: { relativePath: path.relative(root, gateFile), sha256: sha256Bytes(gateBytes),
      fingerprint: gate.fingerprint }, testDenominator: gate.testDenominator,
    benchmark: gate.benchmark, regression: gate.regression,
    blockers: gate.checks.filter(item => item.status !== "PASS").map(item => item.checkId),
    fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  writeJsonAtomic(path.join(output, `${stage.toLowerCase()}-acceptance-report.json`), report,
    { mode: 0o644 });
  const immutable = path.join(output, "history",
    `${stage.toLowerCase()}-acceptance-${report.fingerprint}.json`);
  writeJsonImmutable(immutable, report, { mode: 0o644 }); return { report, immutable };
}

module.exports = { STAGES, stageDirectory, previousAcceptance, verifyStage, acceptStage };
