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
  "A4-01": ["deep Value results preserve sound lower upper complete and incomplete reasons",
    "ordinary evaluator ordering points never narrow the terminal game interval",
    "pure simultaneous bounds contain the exact mixed oracle and incomplete equality is not exact"],
  "A4-02": ["chance probability size is ignored by Proof while every complete support member is covered",
    "hidden world strategy fusion and incomplete response partitions force Proof UNKNOWN",
    "observation split permits different continuation policies only after the split"],
  "A4-03": ["restricted matrix full best response scans every row and column before reporting its gap",
    "initial restricted support cannot hide a mixed best response or dominated support trap",
    "interval midpoint regret never upgrades an unresolved matrix to exact"],
  "A4-04": ["InformationState one row all columns proves ForcedWin with complete CoverageCertificate",
    "per row different enemy columns never produce a false simultaneous ForcedLoss",
    "AND OR DFS and DFPN agree and interruption cannot publish a strict false positive"],
  "A4-05": ["a fired projectile with a real dodge is not promoted to forced loss by the search adapter"],
  "A4-06": ["recursive epsilon contamination is integer outward monotone across chance hidden and enemy",
    "risk changes Value policy inputs but cannot change Hard or strict Proof fingerprints"],
  "A4-07": ["normal and fallback budgets share search semantics and differ only in completed work"],
  "A4-08": ["RPS and Matching Pennies produce reproducible mixed policies with exact probability mass",
    "IMP4 hot search structures use bounded integer TypedArrays and report zero tracked allocation",
    "search capacity faults stay incomplete and never become exact proof or a truncated policy",
    "deep physical search expands Fast make undo with explicit frames and restores root"]
});

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function loadPreviousAcceptance(root) {
  const current = contained(root, "artifacts", "reports", "acceptance", "IMP3",
    "imp3-acceptance-report.json");
  invariant(fs.existsSync(current), "IMP3_ACCEPTANCE_NOT_FOUND", "IMP4 requires IMP3 acceptance");
  const report = readJson(current); validateSchemaObject("imp-acceptance-report", report, root);
  assertFingerprint(report, "IMP3_ACCEPTANCE_FINGERPRINT_MISMATCH");
  invariant(report.status === "ACCEPTED", "IMP3_NOT_ACCEPTED", "IMP3 is not ACCEPTED");
  const immutable = contained(root, "artifacts", "reports", "acceptance", "IMP3", "history",
    `imp3-acceptance-${report.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP3_ACCEPTANCE_CURRENT_DIVERGES", "IMP3 acceptance pointer is not immutable evidence");
  return report;
}
function loadSourceGate(root) {
  const current = contained(root, "artifacts", "reports", "imp4", "imp4-gate-report.json");
  invariant(fs.existsSync(current), "IMP4_GATE_NOT_FOUND", "IMP4 implementation gate is missing");
  const gate = readJson(current); validateSchemaObject("imp4-gate-report", gate, root);
  assertFingerprint(gate, "IMP4_GATE_FINGERPRINT_MISMATCH");
  const immutable = contained(root, "artifacts", "reports", "imp4", "history",
    `imp4-gate-${gate.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP4_CURRENT_GATE_DIVERGES", "current IMP4 gate differs from immutable evidence");
  return { gate, immutable, sha256: sha256Bytes(fs.readFileSync(immutable)) };
}
function evidenceMap(root, gate) {
  const history = contained(root, "artifacts", "reports", "imp4", "history"); const output = new Map();
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
function inspectImp4Acceptance(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const contractFile = contained(root, "docs", "design",
    "imp-acceptance-contract.md"); const acceptanceContractSha256 = sha256Bytes(fs.readFileSync(contractFile));
  const previous = loadPreviousAcceptance(root); invariant(previous.acceptanceContractSha256 ===
    acceptanceContractSha256, "PREVIOUS_ACCEPTANCE_CONTRACT_STALE",
  "IMP3 was accepted against a different contract");
  const source = loadSourceGate(root); const evidence = evidenceMap(root, source.gate);
  const required = id => { const item = evidence.get(id); invariant(item,
    "ACCEPTANCE_EVIDENCE_ID_MISSING", `missing evidence ${id}`); return item; };
  const gateCheck = id => { const item = source.gate.checks.find(value => value.checkId === id);
    invariant(item, "IMP4_GATE_CHECK_MISSING", `missing gate check ${id}`); return item; };
  const tap = required("test-output").bytes.toString("utf8"); const tests = required("tests").value;
  const criteria = [
    criterion("A4-01", () => { const value = required("value-bounds").value;
      invariant(value.status === "PASS" && value.falseExactCount === 0 &&
        gateCheck("VALUE_SOUND_BOUNDS").status === "PASS", "VALUE_BOUND_ACCEPTANCE_FAILED",
      "Value bound semantics failed"); return { soundIntervalCount: value.soundIntervalCount,
        falseExactCount: value.falseExactCount,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A4-01"]) }; }),
    criterion("A4-02", () => { const value = required("quantifiers").value;
      invariant(value.status === "PASS" && value.strategyFusionCount === 0,
        "QUANTIFIER_ACCEPTANCE_FAILED", "quantifier separation failed");
      return { chanceStatus: value.chanceStatus, observationSplitStatus: value.observationSplitStatus,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A4-02"]) }; }),
    criterion("A4-03", () => { const value = required("matrix").value;
      invariant(value.status === "PASS" && value.fullBestResponseLeakCount === 0,
        "MATRIX_ACCEPTANCE_FAILED", "matrix best response coverage failed");
      return { rps: value.rps, matchingPennies: value.matchingPennies,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A4-03"]) }; }),
    criterion("A4-04", () => { const value = required("proof").value;
      invariant(value.status === "PASS" && value.falsePositiveCount === 0,
        "PROOF_ACCEPTANCE_FAILED", "strict proof failed");
      return { forcedWinStatus: value.forcedWinStatus, dfsStatus: value.dfsStatus,
        dfpnStatus: value.dfpnStatus,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A4-04"]) }; }),
    criterion("A4-05", () => { const value = required("dodge-shot").value;
      invariant(value.status === "PASS" && value.dodgeHardRejectCells === 0 &&
        value.unavoidableHardRejectCells === 1, "DODGE_ACCEPTANCE_FAILED",
      "shot dodge timeline failed"); return { rootMismatchCount: value.rootMismatchCount,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A4-05"]) }; }),
    criterion("A4-06", () => { const value = required("risk").value;
      invariant(value.status === "PASS" && value.monotonicViolations === 0 &&
        value.strictMismatch === 0 && value.repeatedRootRiskApplicationCount === 0,
      "RISK_ACCEPTANCE_FAILED", "recursive robust risk failed");
      return { risk0: value.risk0, risk100: value.risk100,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A4-06"]) }; }),
    criterion("A4-07", () => { const value = required("budget").value;
      invariant(value.status === "PASS" && value.completeSemanticMismatchCount === 0 &&
        value.monteCarloCount === 0, "BUDGET_ACCEPTANCE_FAILED", "budget semantics failed");
      return { normalVisitedNodes: value.normalVisitedNodes,
        limitedVisitedNodes: value.limitedVisitedNodes,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A4-07"]) }; }),
    criterion("A4-08", () => { const value = required("oracle-performance").value;
      const layout = required("search-layout").value;
      const physicalTree = required("physical-tree").value;
      invariant(value.status === "PASS" && value.intervalMismatchCount === 0 &&
        value.policyMismatchCount === 0 && value.proofFalsePositiveCount === 0 &&
        value.declaredHotAllocationCount === 0 && physicalTree.status === "PASS" &&
        physicalTree.rootMismatchCount === 0 && tests.status === "PASS" && tests.fail === 0,
      "ORACLE_ACCEPTANCE_FAILED", "small-state oracle or performance structure failed");
      return { exhaustiveMatrixGames: value.exhaustiveMatrixGames,
        exhaustiveProofCases: value.exhaustiveProofCases, typedArrayCount: layout.typedArrayCount,
        totalCoreBytes: layout.totalCoreBytes, deepPhysicalHardChecks: physicalTree.hardCheckedCells,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A4-08"]) }; })
  ];
  const status = acceptanceStatus(criteria); const blockers = criteria.filter(item =>
    item.status !== "PASS").map(item => item.criterionId);
  const report = { schemaVersion: 1, acceptanceContractVersion: "IMP-ACCEPTANCE-V1",
    acceptanceContractSha256, stageId: "IMP4", status,
    previousStageAcceptanceFingerprint: previous.fingerprint,
    sourceGate: { relativePath: path.relative(root, source.immutable), sha256: source.sha256,
      fingerprint: source.gate.fingerprint }, criteria,
    evidenceArtifacts: source.gate.artifacts.map(item => ({ ...item })), blockers, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); validateSchemaObject("imp-acceptance-report", report, root);
  return report;
}
function acceptImp4(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const report = inspectImp4Acceptance(root);
  const directory = contained(root, "artifacts", "reports", "acceptance", "IMP4");
  const history = contained(directory, "history"); ensureDirectory(history);
  const immutable = contained(history, `imp4-acceptance-${report.fingerprint}.json`);
  writeJsonImmutable(immutable, report, { mode: 0o644 });
  writeJsonAtomic(contained(directory, "imp4-acceptance-report.json"), report, { mode: 0o644 });
  return { report, immutable };
}

module.exports = { REQUIRED_TEST_TITLES, loadPreviousAcceptance, loadSourceGate,
  inspectImp4Acceptance, acceptImp4 };
