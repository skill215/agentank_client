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
  "A5-01": ["FeatureRegistry declares integer ranges dependencies costs and no semantic float arrays"],
  "A5-02": ["Table and Generated evaluators produce identical raw vectors and scores",
    "changing one action or plan weight only redoes the integer dot product"],
  "A5-03": ["strategy phase opponent and situation changes obey hysteresis without frame jitter"],
  "A5-04": ["opponent model updates only current match opportunity normalized event families",
    "enemy nominal probabilities sum to 10000 without changing own parameters"],
  "A5-05": ["own poison emitter is specialized while every enemy skill descriptor is direct lookup",
    "skill descriptors match Fast rule constants and paired mechanics"],
  "A5-06": ["only finalist plan sketches persist and every continuation rechecks Hard",
    "overload shot members and bomb safety remain physical rather than plan facts"],
  "A5-07": ["grass cloak and belief routes remain PossibleHazard soft inputs only"],
  "A5-08": ["weights strategy opponent and risk never change Terminal Hard or strict Proof fingerprints"],
  "A5-09": ["IMP5 policy structures use bounded integer TypedArrays and report zero tracked allocation"]
});

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function loadPreviousAcceptance(root) {
  const current = contained(root, "artifacts", "reports", "acceptance", "IMP4",
    "imp4-acceptance-report.json");
  invariant(fs.existsSync(current), "IMP4_ACCEPTANCE_NOT_FOUND", "IMP5 requires IMP4 acceptance");
  const report = readJson(current); validateSchemaObject("imp-acceptance-report", report, root);
  assertFingerprint(report, "IMP4_ACCEPTANCE_FINGERPRINT_MISMATCH");
  invariant(report.status === "ACCEPTED", "IMP4_NOT_ACCEPTED", "IMP4 is not ACCEPTED");
  const immutable = contained(root, "artifacts", "reports", "acceptance", "IMP4", "history",
    `imp4-acceptance-${report.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP4_ACCEPTANCE_CURRENT_DIVERGES", "IMP4 acceptance pointer is not immutable evidence");
  return report;
}
function loadSourceGate(root) {
  const current = contained(root, "artifacts", "reports", "imp5", "imp5-gate-report.json");
  invariant(fs.existsSync(current), "IMP5_GATE_NOT_FOUND", "IMP5 implementation gate is missing");
  const gate = readJson(current); validateSchemaObject("imp5-gate-report", gate, root);
  assertFingerprint(gate, "IMP5_GATE_FINGERPRINT_MISMATCH");
  const immutable = contained(root, "artifacts", "reports", "imp5", "history",
    `imp5-gate-${gate.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP5_CURRENT_GATE_DIVERGES", "current IMP5 gate differs from immutable evidence");
  return { gate, immutable, sha256: sha256Bytes(fs.readFileSync(immutable)) };
}
function evidenceMap(root, gate) {
  const history = contained(root, "artifacts", "reports", "imp5", "history"); const output = new Map();
  for (const entry of gate.artifacts) {
    const file = contained(root, entry.relativePath); invariant(file.startsWith(`${history}${path.sep}`) &&
      fs.existsSync(file), "ACCEPTANCE_EVIDENCE_MISSING", `missing evidence ${entry.artifactId}`);
    const bytes = fs.readFileSync(file); invariant(sha256Bytes(bytes) === entry.sha256,
      "ACCEPTANCE_EVIDENCE_SHA_MISMATCH", `evidence hash mismatch ${entry.artifactId}`);
    output.set(entry.artifactId, { entry, bytes,
      value: file.endsWith(".json") ? JSON.parse(bytes.toString("utf8")) : null });
  }
  return output;
}
function inspectImp5Acceptance(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const contractFile = contained(root, "docs", "design",
    "imp-acceptance-contract.md"); const acceptanceContractSha256 = sha256Bytes(fs.readFileSync(contractFile));
  const previous = loadPreviousAcceptance(root); invariant(previous.acceptanceContractSha256 ===
    acceptanceContractSha256, "PREVIOUS_ACCEPTANCE_CONTRACT_STALE",
  "IMP4 was accepted against a different contract");
  const source = loadSourceGate(root); const evidence = evidenceMap(root, source.gate);
  const required = id => { const item = evidence.get(id); invariant(item,
    "ACCEPTANCE_EVIDENCE_ID_MISSING", `missing evidence ${id}`); return item; };
  const tap = required("test-output").bytes.toString("utf8"); const tests = required("tests").value;
  const layout = required("policy-layout").value; const evaluator = required("evaluator").value;
  const strategy = required("strategy").value; const opponent = required("opponent").value;
  const skillsPlans = required("skills-plans").value; const hidden = required("hidden-strict").value;
  const performance = required("performance").value;
  const criteria = [
    criterion("A5-01", () => { invariant(layout.status === "PASS" && layout.floatArrayCount === 0 &&
      layout.incompleteDescriptors === 0, "INTEGER_FEATURE_ACCEPTANCE_FAILED", "feature registry failed");
      return { featureCount: layout.featureCount, typedArrayCount: layout.typedArrayCount,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A5-01"]) }; }),
    criterion("A5-02", () => { invariant(evaluator.status === "PASS" && evaluator.rawMismatchCount === 0 &&
      evaluator.scoreMismatchCount === 0 && evaluator.dotOnly, "EVALUATOR_ACCEPTANCE_FAILED",
      "evaluator equivalence failed"); return { comparisons: evaluator.comparisons,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A5-02"]) }; }),
    criterion("A5-03", () => { invariant(strategy.status === "PASS" && strategy.jitterCount === 0,
      "STRATEGY_ACCEPTANCE_FAILED", "strategy hysteresis failed"); return { switchCount: strategy.switchCount,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A5-03"]) }; }),
    criterion("A5-04", () => { invariant(opponent.status === "PASS" && opponent.probabilityMass === 10000 &&
      opponent.crossMatchMass === 0, "OPPONENT_ACCEPTANCE_FAILED", "opponent model failed");
      return { updatedFamilies: opponent.updatedFamilies, riskPreference: opponent.riskPreference,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A5-04"]) }; }),
    criterion("A5-05", () => { invariant(skillsPlans.status === "PASS" &&
      skillsPlans.descriptorMismatchCount === 0 && skillsPlans.ownSkillId === 6,
      "SKILL_ACCEPTANCE_FAILED", "skill specialization failed"); return { ownSkillId: skillsPlans.ownSkillId,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A5-05"]) }; }),
    criterion("A5-06", () => { invariant(skillsPlans.status === "PASS" &&
      !skillsPlans.nonFinalistPersisted && skillsPlans.hardValidationCount === 2,
      "PLAN_ACCEPTANCE_FAILED", "plan lifecycle failed"); return { sketchCount: skillsPlans.sketchCount,
        persistentCount: skillsPlans.persistentCount,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A5-06"]) }; }),
    criterion("A5-07", () => { invariant(hidden.status === "PASS" && hidden.hardWriteCount === 0 &&
      hidden.proofWriteCount === 0, "HIDDEN_RISK_ACCEPTANCE_FAILED", "hidden risk isolation failed");
      return { possibleExposure: hidden.possibleExposure,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A5-07"]) }; }),
    criterion("A5-08", () => { invariant(hidden.status === "PASS" && hidden.strictMismatchCount === 0,
      "STRICT_ISOLATION_ACCEPTANCE_FAILED", "soft policy changed strict fingerprint");
      return { strictMismatchCount: hidden.strictMismatchCount,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A5-08"]) }; }),
    criterion("A5-09", () => { invariant(performance.status === "PASS" &&
      performance.invalidMetricCount === 0 && performance.featureMetricCount === 21 &&
      performance.opponentMetricCount === 10 && performance.planMetricCount === 4 &&
      tests.status === "PASS" && tests.fail === 0, "POLICY_PERFORMANCE_ACCEPTANCE_FAILED",
      "policy performance inventory failed"); return { metricCount: performance.metricCount,
        totalCoreBytes: layout.bytes, requiredPassingTests:
        assertTapTitles(tap, REQUIRED_TEST_TITLES["A5-09"]) }; })
  ];
  const status = acceptanceStatus(criteria); const blockers = criteria.filter(item => item.status !== "PASS")
    .map(item => item.criterionId);
  const report = { schemaVersion: 1, acceptanceContractVersion: "IMP-ACCEPTANCE-V1",
    acceptanceContractSha256, stageId: "IMP5", status,
    previousStageAcceptanceFingerprint: previous.fingerprint,
    sourceGate: { relativePath: path.relative(root, source.immutable), sha256: source.sha256,
      fingerprint: source.gate.fingerprint }, criteria,
    evidenceArtifacts: source.gate.artifacts.map(item => ({ ...item })), blockers, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); validateSchemaObject("imp-acceptance-report", report, root);
  return report;
}
function acceptImp5(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const report = inspectImp5Acceptance(root);
  const directory = contained(root, "artifacts", "reports", "acceptance", "IMP5");
  const history = contained(directory, "history"); ensureDirectory(history);
  const immutable = contained(history, `imp5-acceptance-${report.fingerprint}.json`);
  writeJsonImmutable(immutable, report, { mode: 0o644 });
  writeJsonAtomic(contained(directory, "imp5-acceptance-report.json"), report, { mode: 0o644 });
  return { report, immutable };
}

module.exports = { REQUIRED_TEST_TITLES, loadPreviousAcceptance, loadSourceGate,
  inspectImp5Acceptance, acceptImp5 };
