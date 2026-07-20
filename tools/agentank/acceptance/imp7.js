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
  "A7-01": ["dynamic ledger count comes from artifacts and append duplicate late rebuild remains stable"],
  "A7-02": ["subject profile identity isolates v1 v2 and future denominators"],
  "A7-03": ["legacy roots remain immutable while missing skill runtime terminal facts stay UNKNOWN"],
  "A7-04": ["L0 through L4 classify infrastructure before reproducible failure positive windows and metrics"],
  "A7-05": ["policy reads only side ObservedTrack and divergence consumes zero historical suffix"],
  "A7-06": ["bidirectional counterfactual uses symmetric quantifiers assumptions and independent observations"],
  "A7-07": ["positive kill escape bomb skill and endgame windows block systematic safety regression"],
  "A7-08": ["duplicate conflict partial schema and provenance faults fail closed"],
  "A7-09": ["G5 G6 denominators trace every result to immutable snapshot and cohort"]
});
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function loadPrevious(root) { const current = contained(root, "artifacts", "reports", "acceptance", "IMP6", "imp6-acceptance-report.json");
  invariant(fs.existsSync(current), "IMP6_ACCEPTANCE_NOT_FOUND", "IMP7 requires IMP6 acceptance");
  const report = readJson(current); validateSchemaObject("imp-acceptance-report", report, root); assertFingerprint(report);
  invariant(report.status === "ACCEPTED", "IMP6_NOT_ACCEPTED", "IMP6 is not accepted");
  const immutable = contained(root, "artifacts", "reports", "acceptance", "IMP6", "history", `imp6-acceptance-${report.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP6_ACCEPTANCE_CURRENT_DIVERGES", "IMP6 acceptance is not immutable"); return report; }
function loadGate(root) { const current = contained(root, "artifacts", "reports", "imp7", "imp7-gate-report.json");
  invariant(fs.existsSync(current), "IMP7_GATE_NOT_FOUND", "IMP7 gate missing"); const gate = readJson(current);
  validateSchemaObject("imp7-gate-report", gate, root); assertFingerprint(gate); const immutable = contained(root,
    "artifacts", "reports", "imp7", "history", `imp7-gate-${gate.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP7_CURRENT_GATE_DIVERGES", "IMP7 gate is not immutable"); return { gate, immutable, sha256: sha256Bytes(fs.readFileSync(immutable)) }; }
function evidence(root, gate) { const base = contained(root, "artifacts", "reports", "imp7", "history"); const map = new Map();
  for (const entry of gate.artifacts) { const file = contained(root, entry.relativePath);
    invariant(file.startsWith(`${base}${path.sep}`) && fs.existsSync(file), "IMP7_EVIDENCE_MISSING", entry.artifactId);
    const bytes = fs.readFileSync(file); invariant(sha256Bytes(bytes) === entry.sha256, "IMP7_EVIDENCE_HASH_INVALID", entry.artifactId);
    map.set(entry.artifactId, { bytes, value: file.endsWith(".json") ? JSON.parse(bytes) : null }); }
  return map; }
function inspectImp7Acceptance(workspaceRoot = defaultWorkspaceRoot()) { const root = path.resolve(workspaceRoot);
  const contract = contained(root, "docs", "design", "imp-acceptance-contract.md"); const contractHash = sha256Bytes(fs.readFileSync(contract));
  const previous = loadPrevious(root); invariant(previous.acceptanceContractSha256 === contractHash,
    "PREVIOUS_ACCEPTANCE_CONTRACT_STALE", "IMP6 used a different acceptance contract");
  const source = loadGate(root); const files = evidence(root, source.gate); const required = id => { const value = files.get(id);
    invariant(value, "IMP7_EVIDENCE_ID_MISSING", id); return value; }; const tap = required("test-output").bytes.toString("utf8");
  const analysis = required("analysis").value; const ledger = required("ledger").value; const legacy = required("legacy").value;
  const snapshotV1 = required("snapshot-v1").value; const snapshotV2 = required("snapshot-v2").value;
  const gateCheck = id => { const item = source.gate.checks.find(value => value.checkId === id); invariant(item?.status === "PASS", "IMP7_GATE_CHECK_FAILED", id); return item; };
  const criteria = [
    criterion("A7-01", () => ({ ...gateCheck("DYNAMIC_APPEND_STABLE_LEDGER").evidence,
      requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A7-01"]) })),
    criterion("A7-02", () => { gateCheck("PROFILE_DENOMINATOR_ISOLATION"); invariant(ledger.profileCounts.v1 === snapshotV1.matchUrlIds.length && ledger.profileCounts.v2 === snapshotV2.matchUrlIds.length,
      "PROFILE_DENOMINATOR_INVALID", "profile denominator mismatch"); return { profileCounts: ledger.profileCounts,
      requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A7-02"]) }; }),
    criterion("A7-03", () => { gateCheck("LEGACY_ROOT_AND_UNKNOWN_PROVENANCE"); invariant(legacy.status === "PASS" && legacy.uniqueMatches > 0,
      "LEGACY_PROTECTION_FAILED", "legacy root changed"); return { artifactRoot: legacy.artifactRoot,
      requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A7-03"]) }; }),
    criterion("A7-04", () => { gateCheck("L0_L4_WINDOWS_AND_METRICS"); invariant(Object.values(analysis.levelCounts).every(value => value > 0),
      "ANALYSIS_LEVEL_EMPTY", "L0-L4 incomplete"); return { levelCounts: analysis.levelCounts,
      requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A7-04"]) }; }),
    criterion("A7-05", () => { gateCheck("TRUTH_OBSERVED_NO_LEAKAGE"); invariant(analysis.truthObserved.policyTruthHandleCount === 0 && analysis.truthObserved.postDivergenceSuffixFrames === 0,
      "TRUTH_TRACK_LEAK", "TruthTrack leaked or suffix consumed"); return { truthObserved: analysis.truthObserved,
      requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A7-05"]) }; }),
    criterion("A7-06", () => ({ ...gateCheck("BIDIRECTIONAL_COUNTERFACTUAL").evidence,
      requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A7-06"]) })),
    criterion("A7-07", () => { gateCheck("POSITIVE_WINDOW_PROTECTION"); invariant(analysis.positiveProtection.regressions.length === 0,
      "POSITIVE_WINDOW_REGRESSION", "positive window regression"); return { windowCount: analysis.denominator.windowCount,
      requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A7-07"]) }; }),
    criterion("A7-08", () => ({ ...gateCheck("FAIL_CLOSED_FAULTS").evidence,
      requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A7-08"]) })),
    criterion("A7-09", () => { const value = gateCheck("G5_G6_SNAPSHOT_COHORT_TRACE").evidence;
      invariant(source.gate.status === "PASS" && analysis.snapshotRef.snapshotId === snapshotV1.snapshotId,
        "G5_G6_TRACE_INVALID", "G5/G6 evidence is not snapshot traced"); return { ...value,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A7-09"]) }; })
  ];
  const status = acceptanceStatus(criteria); const blockers = criteria.filter(item => item.status !== "PASS").map(item => item.criterionId);
  const report = { schemaVersion: 1, acceptanceContractVersion: "IMP-ACCEPTANCE-V1", acceptanceContractSha256: contractHash,
    stageId: "IMP7", status, previousStageAcceptanceFingerprint: previous.fingerprint,
    sourceGate: { relativePath: path.relative(root, source.immutable), sha256: source.sha256, fingerprint: source.gate.fingerprint },
    criteria, evidenceArtifacts: source.gate.artifacts.map(item => ({ ...item })), blockers, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); validateSchemaObject("imp-acceptance-report", report, root); return report; }
function acceptImp7(workspaceRoot = defaultWorkspaceRoot()) { const root = path.resolve(workspaceRoot); const report = inspectImp7Acceptance(root);
  const directory = contained(root, "artifacts", "reports", "acceptance", "IMP7"); const history = path.join(directory, "history"); ensureDirectory(history);
  const immutable = path.join(history, `imp7-acceptance-${report.fingerprint}.json`); writeJsonImmutable(immutable, report, { mode: 0o644 });
  writeJsonAtomic(path.join(directory, "imp7-acceptance-report.json"), report, { mode: 0o644 }); return { report, immutable }; }

module.exports = { REQUIRED_TEST_TITLES, inspectImp7Acceptance, acceptImp7 };
