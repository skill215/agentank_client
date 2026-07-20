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
  "A3-01": ["Fast physical layout uses fixed TypedArray SoA and generation-bearing entity slots",
    "capacity manifest separates FACT SUPPORT SEARCH CACHE and OUTPUT overflow classes"],
  "A3-02": ["Fast apply and undo restore every physical field hash arena count and event cursor",
    "every scored action is applied checked through Terminal and Hard then fully undone"],
  "A3-03": ["Fast exact and common canonical physical results match the independent Reference Oracle",
    "unresolved shared-resource and exact-tie rules return unsupported with no partial mutation"],
  "A3-04": ["every scored action is applied checked through Terminal and Hard then fully undone"],
  "A3-05": ["committed SourcePlans persist across cache hits and disappear only after physical invalidation",
    "confirmed shield and overload mechanics use independent slots and exact charge consumption"],
  "A3-06": ["an already committed unavoidable projectile loss is rejected before scoring",
    "a committed projectile with a legal dodge does not become a false forced death",
    "a due bomb rejects blast cells but permits an actual first-step escape"],
  "A3-07": ["FACT entity overflow returns incomplete without truncating an observed projectile",
    "EVENT and DELTA required-minus-one capacity faults fail closed and fully undo",
    "root FACT overflow is explicit and cache absence means recompute rather than a semantic default"],
  "A3-08": ["declared hot kernels allocate no tracked temporary objects and publish bounded high-water"],
  "A3-09": ["enemy possible future fire is not inserted into the committed Hard plane",
    "shield boost teleport and dirt-dependent narrow paths fail closed instead of proving death"]
});

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function loadPreviousAcceptance(root) {
  const current = contained(root, "artifacts", "reports", "acceptance", "IMP2",
    "imp2-acceptance-report.json");
  invariant(fs.existsSync(current), "IMP2_ACCEPTANCE_NOT_FOUND", "IMP3 requires IMP2 acceptance");
  const report = readJson(current); validateSchemaObject("imp-acceptance-report", report, root);
  assertFingerprint(report, "IMP2_ACCEPTANCE_FINGERPRINT_MISMATCH");
  invariant(report.status === "ACCEPTED", "IMP2_NOT_ACCEPTED", "IMP2 is not ACCEPTED");
  const immutable = contained(root, "artifacts", "reports", "acceptance", "IMP2", "history",
    `imp2-acceptance-${report.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP2_ACCEPTANCE_CURRENT_DIVERGES", "IMP2 acceptance pointer is not immutable evidence");
  return report;
}
function loadSourceGate(root) {
  const current = contained(root, "artifacts", "reports", "imp3", "imp3-gate-report.json");
  invariant(fs.existsSync(current), "IMP3_GATE_NOT_FOUND", "IMP3 implementation gate is missing");
  const gate = readJson(current); validateSchemaObject("imp3-gate-report", gate, root);
  assertFingerprint(gate, "IMP3_GATE_FINGERPRINT_MISMATCH");
  const immutable = contained(root, "artifacts", "reports", "imp3", "history",
    `imp3-gate-${gate.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP3_CURRENT_GATE_DIVERGES", "current IMP3 gate differs from immutable evidence");
  return { gate, immutable, sha256: sha256Bytes(fs.readFileSync(immutable)) };
}
function evidenceMap(root, gate) {
  const history = contained(root, "artifacts", "reports", "imp3", "history"); const output = new Map();
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
function inspectImp3Acceptance(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const contractFile = contained(root, "docs", "design",
    "imp-acceptance-contract.md"); const acceptanceContractSha256 = sha256Bytes(fs.readFileSync(contractFile));
  const previous = loadPreviousAcceptance(root); invariant(previous.acceptanceContractSha256 ===
    acceptanceContractSha256, "PREVIOUS_ACCEPTANCE_CONTRACT_STALE",
  "IMP2 was accepted against a different contract");
  const source = loadSourceGate(root); const evidence = evidenceMap(root, source.gate);
  const required = id => { const item = evidence.get(id); invariant(item,
    "ACCEPTANCE_EVIDENCE_ID_MISSING", `missing evidence ${id}`); return item; };
  const check = id => { const item = source.gate.checks.find(value => value.checkId === id); invariant(item,
    "IMP3_GATE_CHECK_MISSING", `missing gate check ${id}`); return item; };
  const tap = required("test-output").bytes.toString("utf8"); const tests = required("tests").value;
  const criteria = [
    criterion("A3-01", () => { const value = required("fast-layout").value;
      invariant(check("FAST_TYPED_LAYOUT").status === "PASS" && value.typedArrayCount > 0,
        "FAST_LAYOUT_ACCEPTANCE_FAILED", "Fast layout failed");
      return { profileId: value.profileId, typedArrayCount: value.typedArrayCount,
        totalCoreBytes: value.totalCoreBytes,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A3-01"]) }; }),
    criterion("A3-02", () => { const value = required("apply-undo").value;
      invariant(value.status === "PASS" && value.rootMismatchCount === 0 && value.staleReadCount === 0,
        "FAST_UNDO_ACCEPTANCE_FAILED", "Fast apply/undo failed");
      return { fixtureCount: value.fixtureCount, rootMismatchCount: 0, staleReadCount: 0,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A3-02"]) }; }),
    criterion("A3-03", () => { const value = required("reference-differential").value;
      invariant(value.status === "PASS" && value.mismatchCount === 0 && value.partialMutationCount === 0,
        "FAST_DIFFERENTIAL_ACCEPTANCE_FAILED", "Reference/Fast differential failed");
      return { exactCommonCount: value.exactCommonCount,
        expectedUnsupportedCount: value.expectedUnsupportedCount, mismatchCount: 0,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A3-03"]) }; }),
    criterion("A3-04", () => { const value = required("hard-gate").value;
      invariant(value.status === "PASS" && value.scoringBeforeHardCount === 0 &&
        value.rootMismatchCount === 0, "HARD_GATE_ACCEPTANCE_FAILED", "per-action Hard failed");
      return { checkedActionCount: value.checkedActionCount, scoringBeforeHardCount: 0,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A3-04"]) }; }),
    criterion("A3-05", () => { const value = required("source-plans").value;
      invariant(value.status === "PASS" && value.depthTruncationCount === 0 &&
        value.afterPhysicalInvalidationPlanCount === 0, "SOURCE_PLAN_ACCEPTANCE_FAILED",
      "committed source lifecycle failed");
      return { initialPlanCount: value.initialPlanCount, cacheHitCount: value.cacheHitCount,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A3-05"]) }; }),
    criterion("A3-06", () => { const value = required("hard-gate").value;
      invariant(check("REVERSE_VIABILITY").status === "PASS" &&
        value.committedRejectStatus !== value.possibleFutureFireStatus,
        "REVERSE_VIABILITY_ACCEPTANCE_FAILED", "reverse viability failed");
      return { committedRejectStatus: value.committedRejectStatus,
        possibleFutureFireStatus: value.possibleFutureFireStatus,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A3-06"]) }; }),
    criterion("A3-07", () => { const value = required("overflow").value;
      invariant(value.status === "PASS" && value.silentTruncationCount === 0 &&
        value.partialMutationCount === 0 && value.cacheFullSemanticDefaultCount === 0,
        "FAST_OVERFLOW_ACCEPTANCE_FAILED", "capacity failure semantics failed");
      return { eventStatus: value.eventStatus, deltaStatus: value.deltaStatus,
        rootEntityStatus: value.rootEntityStatus,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A3-07"]) }; }),
    criterion("A3-08", () => { const value = required("performance-structure").value;
      invariant(value.status === "PASS" && value.declaredHotAllocationCount === 0 &&
        value.forbiddenHotConstructCount === 0, "FAST_PERFORMANCE_STRUCTURE_FAILED",
      "hot structure bounds failed");
      return { totalCoreBytes: value.totalCoreBytes, loopBounds: value.loopBounds,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A3-08"]) }; }),
    criterion("A3-09", () => {
      invariant(check("G2_G3_G4_CORE_TESTS").status === "PASS" && tests.tests > 0 && tests.fail === 0,
        "IMP3_CORE_GATE_FAILED", "G2/G3/G4 core tests failed");
      return { testFileCount: tests.testFileCount, tests: tests.tests, pass: tests.pass,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A3-09"]) }; })
  ];
  const status = acceptanceStatus(criteria); const blockers = criteria.filter(item =>
    item.status !== "PASS").map(item => item.criterionId);
  const report = { schemaVersion: 1, acceptanceContractVersion: "IMP-ACCEPTANCE-V1",
    acceptanceContractSha256, stageId: "IMP3", status,
    previousStageAcceptanceFingerprint: previous.fingerprint,
    sourceGate: { relativePath: path.relative(root, source.immutable), sha256: source.sha256,
      fingerprint: source.gate.fingerprint }, criteria,
    evidenceArtifacts: source.gate.artifacts.map(item => ({ ...item })), blockers, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); validateSchemaObject("imp-acceptance-report", report, root);
  return report;
}
function acceptImp3(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const report = inspectImp3Acceptance(root);
  const directory = contained(root, "artifacts", "reports", "acceptance", "IMP3");
  const history = contained(directory, "history"); ensureDirectory(history);
  const immutable = contained(history, `imp3-acceptance-${report.fingerprint}.json`);
  writeJsonImmutable(immutable, report, { mode: 0o644 });
  writeJsonAtomic(contained(directory, "imp3-acceptance-report.json"), report, { mode: 0o644 });
  return { report, immutable };
}

module.exports = { REQUIRED_TEST_TITLES, loadPreviousAcceptance, loadSourceGate,
  inspectImp3Acceptance, acceptImp3 };
