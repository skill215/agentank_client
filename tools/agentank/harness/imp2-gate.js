"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory } = require("../core/atomic-file");
const { summarizeTestOutput } = require("./test-runner");
const { writeReport, writeImmutableJsonEvidence, writeImmutableRawEvidence, artifactEntry, check } =
  require("./foundation-gate");
const reference = require("../../../engine-v2/src/reference");

const REQUIRED_REFERENCE_MODULES = Object.freeze(["association.js", "canonical-scenarios.js", "codes.js",
  "entities.js", "errors.js", "events.js", "handlers.js", "index.js", "kernel.js", "objective.js",
  "observation.js", "rule-corpus.js", "scheduler.js", "skills.js", "source-boundary.js",
  "state.js", "terminal.js", "timeline.js", "trace.js", "tracking.js", "typed-value.js",
  "visibility.js"]);

function referenceStructureAudit(root) {
  const directory = path.join(root, "engine-v2", "src", "reference");
  const files = fs.readdirSync(directory).filter(file => file.endsWith(".js")).sort();
  const missing = REQUIRED_REFERENCE_MODULES.filter(file => !files.includes(file));
  const forbiddenImports = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(directory, file), "utf8");
    if (/require\(["'][^"']*\/fast/.test(source)) forbiddenImports.push(file);
  }
  const value = { schemaVersion: 1, status: missing.length === 0 && forbiddenImports.length === 0 ?
    "PASS" : "FAIL", requiredModuleCount: REQUIRED_REFERENCE_MODULES.length,
    implementedModuleCount: files.length, missing, forbiddenImports,
    referenceFastSharedImplementationCount: forbiddenImports.length, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function ruleCorpusAudit(root) {
  const loaded = reference.loadRuleCorpus(root); const report = reference.ruleEvidenceReport(loaded);
  const guide = fs.readFileSync(path.join(root, "docs", "agent-guide.md"));
  const unresolvedHandlerCount = Object.values(loaded.corpus.handlerBindings).filter(binding =>
    reference.resolveReferenceHandler(binding) === null).length;
  const value = { ...report,
    status: sha256Bytes(guide) === loaded.corpus.evidence.guideSha256 &&
      unresolvedHandlerCount === 0 ? "PASS" : "FAIL",
    guideSha256: sha256Bytes(guide), expectedGuideSha256: loaded.corpus.evidence.guideSha256,
    unresolvedVariantIds: loaded.corpus.variantGroups.filter(group => group.active === null)
      .map(group => group.id).sort(), unknownStrictUpgradeCount: report.rules.filter(rule =>
      /^UNKNOWN(?:_|$)/.test(rule.status) && !/^(NOT_STRICT|NEVER)/.test(rule.proofEligibility)).length,
    unresolvedHandlerCount,
    fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function canonicalTraceAudit(root) {
  const run = reference.runCanonicalScenarios(root);
  const required = ["TRACE-128-FULL-LAST-RECORD", "TRACE-EQUAL-STAR-RUNTIME",
    "TRACE-MUTUAL-PROJECTILE-KILL", "TRACE-BOMB-PROJECTILE-SKILL-COMPOSITE"];
  const traces = run.results.map(result => ({ fixtureId: result.fixtureId, status: result.status,
    traceSha256: result.traceSha256, byteLength: result.byteLength, replayMatches: result.replayMatches,
    eventCount: result.eventCount, terminalResolution: result.terminalResolution,
    trace: result.traceRecord.trace }));
  const value = { schemaVersion: 1, status: required.every(id => traces.some(item =>
    item.fixtureId === id && item.replayMatches && item.eventCount > 0)) ? "PASS" : "FAIL",
    requiredTraceCount: required.length, traceCount: traces.length, traces, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function skillEvidenceAudit(root) {
  const loaded = reference.loadRuleCorpus(root); const rules = loaded.index.rules;
  const skillRuleIds = reference.SKILLS.map(skill => `R1-${skill.toUpperCase()}`);
  const skillRules = skillRuleIds.map(id => rules.get(id));
  const value = { schemaVersion: 1,
    status: skillRules.every(Boolean) && loaded.corpus.constants.shieldBulletHits === 2 &&
      rules.get("R1-OVERLOAD").status === "PLATFORM_REPLAY_CONFIRMED" ? "PASS" : "FAIL",
    skillRuleIds, shieldBulletHits: loaded.corpus.constants.shieldBulletHits,
    shieldSourceRefs: rules.get("R1-SHIELD").sourceRefs,
    overloadStatus: rules.get("R1-OVERLOAD").status,
    overloadSourceRefs: rules.get("R1-OVERLOAD").sourceRefs,
    poisonCadenceCompleteSampleCount: loaded.corpus.evidence.poisonCadenceCompleteSampleCount,
    rejectedExternalDefaults: loaded.corpus.rejectedExternalDefaults, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function externalBoundaryAudit(root) {
  const loaded = reference.loadRuleCorpus(root);
  const simulator = reference.createSourceRecord("EXTERNAL_SIMULATOR",
    { commit: loaded.corpus.evidence.externalSimulatorCommit }, { fixture: "candidate" }, loaded);
  const framework = reference.createSourceRecord("FRAMEWORK",
    { commit: loaded.corpus.evidence.frameworkCommit }, { fixture: "candidate" }, loaded);
  let promotionRejected = false;
  try { reference.assertStrictSource(simulator); } catch (error) {
    promotionRejected = error.code === "CANDIDATE_SOURCE_PROMOTION_REJECTED";
  }
  const value = { schemaVersion: 1, status: promotionRejected &&
    simulator.authority === "CANDIDATE_ONLY" && framework.authority === "CANDIDATE_ONLY" ?
    "PASS" : "FAIL", externalSimulatorCommit: loaded.corpus.evidence.externalSimulatorCommit,
    frameworkCommit: loaded.corpus.evidence.frameworkCommit,
    simulatorAuthority: simulator.authority, frameworkAuthority: framework.authority,
    candidatePromotionRejected: promotionRejected, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function officialProbeAudit(root) {
  const planFile = path.join(root, "config", "agentank", "imp2-rule-probes.json");
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  validateSchemaObject("imp2-rule-probe-plan", plan, root);
  const directory = path.join(root, "artifacts", "platform", "probes", "imp2");
  const results = plan.probes.map(probe => {
    const file = path.join(directory, `${probe.probeId}.json`);
    if (!fs.existsSync(file)) return { probeId: probe.probeId, ruleOrVariantId: probe.ruleOrVariantId,
      status: "NOT_RUN", evidenceSha256: null, outcome: null };
    const bytes = fs.readFileSync(file); const value = JSON.parse(bytes.toString("utf8"));
    const valid = value.schemaVersion === 1 && value.probeId === probe.probeId &&
      value.ruleOrVariantId === probe.ruleOrVariantId && value.sourceType === "PLATFORM_SIM" &&
      typeof value.responseSha256 === "string" && /^[a-f0-9]{64}$/.test(value.responseSha256) &&
      ["CONCLUSIVE", "INCONCLUSIVE"].includes(value.outcome) &&
      typeof value.targetEventReached === "boolean" && value.analysis &&
      typeof value.analysis === "object" && !Array.isArray(value.analysis);
    return { probeId: probe.probeId, ruleOrVariantId: probe.ruleOrVariantId,
      status: valid ? "PASS" : "FAIL", evidenceSha256: sha256Bytes(bytes),
      outcome: valid ? value.outcome : null,
      targetEventReached: valid ? value.targetEventReached : null };
  });
  const status = results.some(item => item.status === "FAIL") ? "FAIL" :
    results.some(item => item.status === "NOT_RUN") ? "BLOCKED" : "PASS";
  const value = { schemaVersion: 1, status, planId: plan.planId,
    requiredProbeCount: plan.probes.length, completedProbeCount: results.filter(item =>
      item.status === "PASS").length,
    conclusiveProbeCount: results.filter(item => item.outcome === "CONCLUSIVE").length,
    inconclusiveProbeCount: results.filter(item => item.outcome === "INCONCLUSIVE").length,
    targetReachedProbeCount: results.filter(item => item.targetEventReached === true).length,
    results, platformPublishCount: 0,
    platformChallengeCount: 0, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function runImp2ReferenceGate(workspaceRoot = defaultWorkspaceRoot(), options = {}) {
  const root = path.resolve(workspaceRoot); const outputDirectory = path.join(root, "artifacts", "reports", "imp2");
  ensureDirectory(outputDirectory);
  const structure = referenceStructureAudit(root); const corpus = ruleCorpusAudit(root);
  const traces = canonicalTraceAudit(root); const skills = skillEvidenceAudit(root);
  const external = externalBoundaryAudit(root); const probes = officialProbeAudit(root);
  const tests = summarizeTestOutput(root, options.testOutputFile, options.testExitCode,
    outputDirectory, { testDirectories: ["imp0", "platform", "imp1", "imp2"] });
  const evidenceFiles = [
    ["reference-structure", writeImmutableJsonEvidence(outputDirectory, "reference-structure", structure)],
    ["rule-corpus", writeImmutableJsonEvidence(outputDirectory, "rule-corpus", corpus)],
    ["canonical-traces", writeImmutableJsonEvidence(outputDirectory, "canonical-traces", traces)],
    ["skill-evidence", writeImmutableJsonEvidence(outputDirectory, "skill-evidence", skills)],
    ["external-boundary", writeImmutableJsonEvidence(outputDirectory, "external-boundary", external)],
    ["official-probes", writeImmutableJsonEvidence(outputDirectory, "official-probes", probes)],
    ["tests", writeImmutableJsonEvidence(outputDirectory, "tests", tests.report)],
    ["test-output", writeImmutableRawEvidence(outputDirectory, "test-output", "tap", tests.output)]
  ];
  const checks = [
    check("INPUT_STATE_MODEL", structure.status, { referenceModuleCount: structure.implementedModuleCount }),
    check("REFERENCE_ORACLE_INDEPENDENCE", structure.status,
      { sharedImplementationCount: structure.referenceFastSharedImplementationCount }),
    check("RULE_CORPUS_CLOSURE", corpus.status, { ruleCount: corpus.ruleCount,
      variantCount: corpus.variantCount, unknownStrictUpgradeCount: corpus.unknownStrictUpgradeCount,
      unresolvedHandlerCount: corpus.unresolvedHandlerCount }),
    check("CANONICAL_TRACE_REPLAY", traces.status, { traceCount: traces.traceCount,
      hashes: traces.traces.map(item => item.traceSha256) }),
    check("SKILL_EVIDENCE_ARBITRATION", skills.status, { skillCount: skills.skillRuleIds.length,
      shieldBulletHits: skills.shieldBulletHits, overloadStatus: skills.overloadStatus }),
    check("EXTERNAL_CANDIDATE_BOUNDARY", external.status,
      { simulatorCommit: external.externalSimulatorCommit, frameworkCommit: external.frameworkCommit }),
    check("OFFICIAL_RULE_PROBES", probes.status === "BLOCKED" ? "NOT_RUN" : probes.status,
      { requiredProbeCount: probes.requiredProbeCount, completedProbeCount: probes.completedProbeCount,
        conclusiveProbeCount: probes.conclusiveProbeCount,
        inconclusiveProbeCount: probes.inconclusiveProbeCount,
        targetReachedProbeCount: probes.targetReachedProbeCount,
        publishCount: 0, challengeCount: 0 }),
    check("G1_TEST_DENOMINATOR", tests.report.status, { testFiles: tests.report.testFileCount,
      tests: tests.report.tests, pass: tests.report.pass, fail: tests.report.fail })
  ];
  const blockers = checks.filter(item => item.status === "FAIL").map(item => item.checkId);
  const gate = { schemaVersion: 1, reportId: "imp2-reference-oracle-gate-v1",
    status: blockers.length === 0 ? "PASS" : "FAIL", checks,
    artifacts: evidenceFiles.map(([id, file]) => artifactEntry(root, id, file)), blockers,
    fingerprint: "" };
  gate.fingerprint = fingerprintObject(gate); validateSchemaObject("imp2-gate-report", gate, root);
  writeReport(outputDirectory, "imp2-gate-report.json", gate);
  const gateFile = writeImmutableJsonEvidence(outputDirectory, "imp2-gate", gate);
  return { gate, gateFile, probes };
}

module.exports = { REQUIRED_REFERENCE_MODULES, referenceStructureAudit, ruleCorpusAudit,
  canonicalTraceAudit, skillEvidenceAudit, externalBoundaryAudit, officialProbeAudit,
  runImp2ReferenceGate };
