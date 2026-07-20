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
  "A2-01": ["ObservationAdapter integerizes platform input without retaining mutable platform references",
    "PhysicalState requires integer fields and unique IDs for every dynamic entity",
    "InformationState preserves joint immutable worlds and residual support",
    "singular bullet observation creates an ambiguous relation instead of greedy identity collapse",
    "TrackedState uses shadow reconciliation and commits only a complete generation",
    "visible exact observation reconciles into one PhysicalState without platform references",
    "hidden enemy observation yields incomplete InformationState instead of a most-likely pose"],
  "A2-02": ["scheduler applies seat zero freeze before seat one action without dequeuing the frozen queue",
    "all eight skill cooldown and duration values are read from the frozen RuleCorpus",
    "projectiles execute two ordered substeps and pass through each other without cancellation",
    "bomb resolution follows action and both projectile substeps in canonical phase order"],
  "A2-03": ["RuleCorpus closes every rule handler fixture variant and provenance edge",
    "RuleCorpus keeps every unresolved variant explicit instead of selecting the first candidate",
    "typed unknown values cannot participate in ordinary Reference arithmetic",
    "multiple due bombs require an explicit finite variant before any Reference mutation"],
  "A2-04": ["last record index 127 executes full action and projectile phases before frame-limit terminal",
    "equal-star terminal uses lower runtime and never converts unknown runtime into zero",
    "mutual projectile destruction waits for the batch then resolves stars",
    "canonical traces are byte-stable and independently replayable for all required scenarios"],
  "A2-05": ["shield absorbs two separate bullet hits and expires only after the second hit",
    "overload consumes on successful fire and creates two independent projectile IDs",
    "rejected external defaults cannot overwrite shield poison frame-limit or chance semantics"],
  "A2-06": ["external simulator and framework records are frozen to exact commits",
    "candidate-only external evidence cannot be promoted to strict platform truth",
    "Reference implementation remains physically isolated from future FastKernel modules"],
  "A2-08": ["missing public skill identity produces explicit incomplete root capability",
    "exact runtime tie and exact timeout boundary remain variant-required in the default context"]
});

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function loadPreviousAcceptance(root) {
  const current = contained(root, "artifacts", "reports", "acceptance", "IMP1",
    "imp1-acceptance-report.json");
  invariant(fs.existsSync(current), "IMP1_ACCEPTANCE_NOT_FOUND", "IMP2 requires IMP1 acceptance");
  const report = readJson(current); validateSchemaObject("imp-acceptance-report", report, root);
  assertFingerprint(report, "IMP1_ACCEPTANCE_FINGERPRINT_MISMATCH");
  invariant(report.status === "ACCEPTED", "IMP1_NOT_ACCEPTED", "IMP1 is not ACCEPTED");
  const immutable = contained(root, "artifacts", "reports", "acceptance", "IMP1", "history",
    `imp1-acceptance-${report.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP1_ACCEPTANCE_CURRENT_DIVERGES", "IMP1 acceptance pointer is not immutable evidence");
  return report;
}

function loadSourceGate(root, gateFile) {
  const current = gateFile || contained(root, "artifacts", "reports", "imp2", "imp2-gate-report.json");
  invariant(fs.existsSync(current), "IMP2_GATE_NOT_FOUND", "IMP2 implementation gate is missing");
  const gate = readJson(current); validateSchemaObject("imp2-gate-report", gate, root);
  assertFingerprint(gate, "IMP2_GATE_FINGERPRINT_MISMATCH");
  const immutable = contained(root, "artifacts", "reports", "imp2", "history",
    `imp2-gate-${gate.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP2_CURRENT_GATE_DIVERGES", "current IMP2 gate differs from immutable evidence");
  return { gate, immutable, sha256: sha256Bytes(fs.readFileSync(immutable)) };
}

function evidenceMap(root, gate) {
  const history = contained(root, "artifacts", "reports", "imp2", "history"); const output = new Map();
  for (const entry of gate.artifacts) {
    invariant(!output.has(entry.artifactId), "DUPLICATE_ACCEPTANCE_EVIDENCE",
      `duplicate evidence ${entry.artifactId}`);
    const file = contained(root, entry.relativePath);
    invariant(file.startsWith(`${history}${path.sep}`) && fs.existsSync(file),
      "ACCEPTANCE_EVIDENCE_MISSING", `missing immutable evidence ${entry.artifactId}`);
    const bytes = fs.readFileSync(file);
    invariant(sha256Bytes(bytes) === entry.sha256, "ACCEPTANCE_EVIDENCE_SHA_MISMATCH",
      `evidence hash mismatch ${entry.artifactId}`);
    const value = file.endsWith(".json") ? JSON.parse(bytes.toString("utf8")) : null;
    if (value?.fingerprint) assertFingerprint(value);
    output.set(entry.artifactId, { entry, file, bytes, value });
  }
  return output;
}

function inspectImp2Acceptance(workspaceRoot = defaultWorkspaceRoot(), gateFile) {
  const root = path.resolve(workspaceRoot);
  const contractFile = contained(root, "docs", "design", "imp-acceptance-contract.md");
  const acceptanceContractSha256 = sha256Bytes(fs.readFileSync(contractFile));
  const previous = loadPreviousAcceptance(root);
  invariant(previous.acceptanceContractSha256 === acceptanceContractSha256,
    "PREVIOUS_ACCEPTANCE_CONTRACT_STALE", "IMP1 was accepted against a different contract");
  const source = loadSourceGate(root, gateFile); const evidence = evidenceMap(root, source.gate);
  const required = id => { const item = evidence.get(id); invariant(item,
    "ACCEPTANCE_EVIDENCE_ID_MISSING", `missing evidence ${id}`); return item; };
  const check = id => { const item = source.gate.checks.find(value => value.checkId === id);
    invariant(item, "IMP2_GATE_CHECK_MISSING", `missing gate check ${id}`); return item; };
  const tap = required("test-output").bytes.toString("utf8"); const tests = required("tests").value;
  invariant(tests.status === "PASS" && tests.tests > 0 && tests.fail === 0,
    "IMP2_TEST_DENOMINATOR_INVALID", "IMP2 tests are incomplete");
  const criteria = [
    criterion("A2-01", () => { const structure = required("reference-structure").value;
      invariant(check("INPUT_STATE_MODEL").status === "PASS" && structure.status === "PASS",
        "STATE_MODEL_ACCEPTANCE_FAILED", "state/input model failed");
      return { referenceModuleCount: structure.implementedModuleCount,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A2-01"]) }; }),
    criterion("A2-02", () => { const structure = required("reference-structure").value;
      invariant(check("REFERENCE_ORACLE_INDEPENDENCE").status === "PASS" &&
        structure.referenceFastSharedImplementationCount === 0, "REFERENCE_INDEPENDENCE_FAILED",
      "Reference implementation is not independent");
      return { sharedImplementationCount: 0,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A2-02"]) }; }),
    criterion("A2-03", () => { const corpus = required("rule-corpus").value;
      invariant(corpus.status === "PASS" && corpus.unknownStrictUpgradeCount === 0 &&
        corpus.unresolvedHandlerCount === 0,
        "RULE_CORPUS_ACCEPTANCE_FAILED", "RuleCorpus closure failed");
      return { ruleCount: corpus.ruleCount, variantCount: corpus.variantCount,
        unresolvedVariantIds: corpus.unresolvedVariantIds,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A2-03"]) }; }),
    criterion("A2-04", () => { const traces = required("canonical-traces").value;
      invariant(traces.status === "PASS" && traces.requiredTraceCount === traces.traceCount &&
        traces.traces.every(item => item.replayMatches), "CANONICAL_TRACE_ACCEPTANCE_FAILED",
      "canonical traces are incomplete");
      return { traceHashes: traces.traces.map(item => item.traceSha256),
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A2-04"]) }; }),
    criterion("A2-05", () => { const skills = required("skill-evidence").value;
      invariant(skills.status === "PASS" && skills.skillRuleIds.length === 8 &&
        skills.shieldBulletHits === 2 && skills.overloadStatus === "PLATFORM_REPLAY_CONFIRMED",
      "SKILL_EVIDENCE_ACCEPTANCE_FAILED", "skill evidence failed");
      return { skillRuleIds: skills.skillRuleIds, shieldBulletHits: skills.shieldBulletHits,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A2-05"]) }; }),
    criterion("A2-06", () => { const external = required("external-boundary").value;
      invariant(external.status === "PASS" && external.candidatePromotionRejected,
        "EXTERNAL_BOUNDARY_ACCEPTANCE_FAILED", "external candidate boundary failed");
      return { simulatorCommit: external.externalSimulatorCommit,
        frameworkCommit: external.frameworkCommit,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A2-06"]) }; }),
    criterion("A2-07", () => { const probes = required("official-probes").value;
      if (probes.status === "BLOCKED") return { status: "BLOCKED", evidence: {
        errorCode: "OFFICIAL_RULE_PROBES_INCOMPLETE", requiredProbeCount: probes.requiredProbeCount,
        completedProbeCount: probes.completedProbeCount,
        missingProbeIds: probes.results.filter(item => item.status === "NOT_RUN").map(item => item.probeId) } };
      invariant(probes.status === "PASS" && probes.completedProbeCount === probes.requiredProbeCount,
        "OFFICIAL_PROBE_ACCEPTANCE_FAILED", "official probe coverage failed");
      return { requiredProbeCount: probes.requiredProbeCount,
        completedProbeCount: probes.completedProbeCount,
        conclusiveProbeCount: probes.conclusiveProbeCount,
        inconclusiveProbeCount: probes.inconclusiveProbeCount,
        targetReachedProbeCount: probes.targetReachedProbeCount }; }),
    criterion("A2-08", () => {
      invariant(check("G1_TEST_DENOMINATOR").status === "PASS" && tests.tests > 0 && tests.fail === 0,
        "G1_ACCEPTANCE_FAILED", "G1 test denominator failed");
      return { testFileCount: tests.testFileCount, tests: tests.tests, pass: tests.pass,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A2-08"]) }; })
  ];
  if (source.gate.status !== "PASS") criteria[7] = { criterionId: "A2-08", status: "FAIL",
    evidence: { errorCode: "IMP2_IMPLEMENTATION_GATE_FAILED", blockers: source.gate.blockers } };
  const status = acceptanceStatus(criteria); const blockers = criteria.filter(item =>
    item.status !== "PASS").map(item => item.criterionId);
  const report = { schemaVersion: 1, acceptanceContractVersion: "IMP-ACCEPTANCE-V1",
    acceptanceContractSha256, stageId: "IMP2", status,
    previousStageAcceptanceFingerprint: previous.fingerprint,
    sourceGate: { relativePath: path.relative(root, source.immutable), sha256: source.sha256,
      fingerprint: source.gate.fingerprint }, criteria,
    evidenceArtifacts: source.gate.artifacts.map(item => ({ ...item })), blockers, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); validateSchemaObject("imp-acceptance-report", report, root);
  return report;
}

function acceptImp2(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const report = inspectImp2Acceptance(root);
  const directory = contained(root, "artifacts", "reports", "acceptance", "IMP2");
  const history = contained(directory, "history"); ensureDirectory(history);
  const immutable = contained(history, `imp2-acceptance-${report.fingerprint}.json`);
  writeJsonImmutable(immutable, report, { mode: 0o644 });
  writeJsonAtomic(contained(directory, "imp2-acceptance-report.json"), report, { mode: 0o644 });
  return { report, immutable };
}

module.exports = { REQUIRED_TEST_TITLES, loadPreviousAcceptance, loadSourceGate, evidenceMap,
  inspectImp2Acceptance, acceptImp2 };
