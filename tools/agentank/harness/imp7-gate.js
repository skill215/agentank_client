"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory } = require("../core/atomic-file");
const { summarizeTestOutput } = require("./test-runner");
const { writeReport, writeImmutableJsonEvidence, writeImmutableRawEvidence,
  artifactEntry, check } = require("./foundation-gate");
const { rebuildCorpus } = require("../corpus/analyzer");

function finalized(value) { value.fingerprint = fingerprintObject(value); return value; }
function productionIsolation(root) {
  const base = contained(root, "engine-v2", "src"); const findings = [];
  const banned = /match.?ledger|truthtrack|failure.?window|historical.?suffix|battle-records|counterfactual/i;
  const walk = directory => { for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name); if (item.isDirectory()) walk(file);
    else if (item.isFile() && file.endsWith(".js") && banned.test(fs.readFileSync(file, "utf8")))
      findings.push(path.relative(root, file)); } };
  walk(base); return finalized({ schemaVersion: 1, status: findings.length ? "FAIL" : "PASS",
    productionRoot: path.relative(root, base), corpusModuleImportCount: findings.length, findings });
}

async function runImp7Gate(workspaceRoot = defaultWorkspaceRoot(), options = {}) {
  const root = path.resolve(workspaceRoot); const output = contained(root, "artifacts", "reports", "imp7");
  ensureDirectory(output); const corpus = rebuildCorpus(root); const analysis = corpus.analysis;
  const isolation = productionIsolation(root); const tests = summarizeTestOutput(root,
    options.testOutputFile, options.testExitCode, output, { testDirectories: ["imp0", "platform", "imp1",
      "imp2", "imp3", "imp4", "imp5", "imp6", "imp7"] });
  const ledgerSummary = finalized({ schemaVersion: 1, status: "PASS", source: corpus.source,
    uniqueMatchCount: corpus.entries.length, appended: corpus.appended, duplicates: corpus.duplicates,
    headFingerprint: corpus.head.fingerprint, policyFingerprint: corpus.policy.fingerprint,
    profileCounts: { v1: corpus.snapshots.v1.matchUrlIds.length, v2: corpus.snapshots.v2.matchUrlIds.length },
    cohortCount: corpus.cohorts.length });
  const evidenceFiles = [
    ["ledger", writeImmutableJsonEvidence(output, "ledger", ledgerSummary)],
    ["ledger-jsonl", writeImmutableRawEvidence(output, "ledger", "jsonl", fs.readFileSync(corpus.files.ledgerFile))],
    ["head", writeImmutableJsonEvidence(output, "head", corpus.head)],
    ["snapshot-v1", writeImmutableJsonEvidence(output, "snapshot-v1", corpus.snapshots.v1)],
    ["snapshot-v2", writeImmutableJsonEvidence(output, "snapshot-v2", corpus.snapshots.v2)],
    ["cohorts", writeImmutableJsonEvidence(output, "cohorts", finalized({ schemaVersion: 1,
      cohorts: corpus.cohorts, fingerprint: "" }))],
    ["analysis", writeImmutableJsonEvidence(output, "analysis", analysis)],
    ["legacy", writeImmutableJsonEvidence(output, "legacy", corpus.legacy)],
    ["production-isolation", writeImmutableJsonEvidence(output, "production-isolation", isolation)],
    ["tests", writeImmutableJsonEvidence(output, "tests", tests.report)],
    ["test-output", writeImmutableRawEvidence(output, "test-output", "tap", tests.output)]
  ];
  const unknownSkills = corpus.entries.filter(entry => entry.enemySkill.skillId === "UNKNOWN").length;
  const symmetry = analysis.counterfactualResults.length === analysis.denominator.windowCount * 2 &&
    analysis.counterfactualResults.every(item => item.historicalSuffixConsumedFrames === 0);
  const cohortIds = new Set(["legacy-dd9", ...corpus.cohorts.map(item => item.cohortId)]);
  const traceable = analysis.windows.every(item => item.snapshotId === corpus.snapshots.v1.snapshotId &&
    cohortIds.has(item.cohortId));
  const checks = [
    check("DYNAMIC_APPEND_STABLE_LEDGER", corpus.entries.length === corpus.source.artifactCount ? "PASS" : "FAIL",
      { sourceArtifactCount: corpus.source.artifactCount, ledgerCount: corpus.entries.length,
        appended: corpus.appended, duplicates: corpus.duplicates }),
    check("PROFILE_DENOMINATOR_ISOLATION", corpus.snapshots.v1.matchUrlIds.length === corpus.entries.length &&
      corpus.snapshots.v2.matchUrlIds.length === 0 ? "PASS" : "FAIL",
      { v1: corpus.snapshots.v1.matchUrlIds.length, v2: corpus.snapshots.v2.matchUrlIds.length }),
    check("LEGACY_ROOT_AND_UNKNOWN_PROVENANCE", corpus.legacy.status === "PASS" && unknownSkills > 0 ? "PASS" : "FAIL",
      { artifactRoot: corpus.legacy.artifactRoot, unknownEnemySkills: unknownSkills }),
    check("L0_L4_WINDOWS_AND_METRICS", analysis.status, { levelCounts: analysis.levelCounts,
      denominator: analysis.denominator, infrastructureFailures: analysis.infrastructureFailures }),
    check("TRUTH_OBSERVED_NO_LEAKAGE", analysis.truthObserved.policyTruthHandleCount === 0 &&
      analysis.truthObserved.postDivergenceSuffixFrames === 0 ? "PASS" : "FAIL", analysis.truthObserved),
    check("BIDIRECTIONAL_COUNTERFACTUAL", symmetry ? "PASS" : "FAIL", {
      perspectiveCount: analysis.counterfactualResults.length, unknownLabels: analysis.strictCounterfactualLabels.UNKNOWN }),
    check("POSITIVE_WINDOW_PROTECTION", analysis.positiveProtection.status,
      { regressionCount: analysis.positiveProtection.regressions.length }),
    check("FAIL_CLOSED_FAULTS", tests.report.status, { tests: tests.report.tests, fail: tests.report.fail }),
    check("G5_G6_SNAPSHOT_COHORT_TRACE", traceable && corpus.cohorts.length > 0 ? "PASS" : "FAIL",
      { snapshotId: corpus.snapshots.v1.snapshotId, cohortCount: corpus.cohorts.length,
        tracedWindows: traceable ? analysis.windows.length : 0 }),
    check("PRODUCTION_CORPUS_STRIP", isolation.status, { findingCount: isolation.findings.length })
  ];
  const blockers = checks.filter(item => item.status === "FAIL").map(item => item.checkId);
  const gate = { schemaVersion: 1, reportId: "imp7-dynamic-corpus-counterfactual-gate-v1",
    status: blockers.length ? "FAIL" : "PASS", checks,
    artifacts: evidenceFiles.map(([id, file]) => artifactEntry(root, id, file)), blockers,
    releaseBlockers: ["PLATFORM_ENGINE_UNKNOWN", "PLATFORM_SCRIPT_BYTE_LIMIT_UNKNOWN",
      "PLATFORM_RUNTIME_CALIBRATION_PENDING"], fingerprint: "" };
  gate.fingerprint = fingerprintObject(gate); validateSchemaObject("imp7-gate-report", gate, root);
  writeReport(output, "imp7-gate-report.json", gate);
  const gateFile = writeImmutableJsonEvidence(output, "imp7-gate", gate);
  return { gate, gateFile, corpus };
}

module.exports = { productionIsolation, runImp7Gate };
