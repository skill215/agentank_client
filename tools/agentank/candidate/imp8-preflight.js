"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { buildImp6Production, productionRootFixture } = require("../build/imp6-builder");
const { loadDd9Assignment, idsForRole } = require("../simulation/dd9-assignment");

const INTERNAL_BLOCKERS = Object.freeze([
  "CANDIDATE_MANIFEST_NOT_FROZEN",
  "CALIBRATION_DEPTH_PENDING",
  "CALIBRATION_CACHE_PENDING",
  "CALIBRATION_RISK_WEIGHTS_ARE_BUILD_CONFIGURED",
  "CALIBRATION_ARENA_IS_BUILD_CONFIGURED",
  "G10A_FROZEN_NOT_RUN"
]);
const EXTERNAL_BLOCKERS = Object.freeze([
  "PLATFORM_ENGINE_UNKNOWN",
  "PLATFORM_SCRIPT_BYTE_LIMIT_UNKNOWN",
  "PLATFORM_RUNTIME_CALIBRATION_PENDING",
  "MANDATORY_SERVER_SIMULATION_NOT_RUN",
  "USER_PUBLISH_AUTHORIZATION_REQUIRED"
]);

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function finalized(value) { value.fingerprint = fingerprintObject(value); return value; }
function artifactRef(root, relativePath) { const file = contained(root, relativePath);
  invariant(fs.existsSync(file), "IMP8_PROFILE_INPUT_MISSING", relativePath);
  const value = file.endsWith(".json") ? readJson(file) : null;
  return { relativePath, sha256: sha256Bytes(fs.readFileSync(file)), fingerprint: value?.fingerprint || null };
}
function assertLaneWrite(sourceLane, targetLane, operation) {
  invariant(["DISCOVERY", "CALIBRATION", "FROZEN"].includes(sourceLane) &&
    ["DISCOVERY", "CALIBRATION", "FROZEN"].includes(targetLane), "IMP8_LANE_INVALID", "unknown lane");
  invariant(!(sourceLane === "FROZEN" && operation === "TUNE") &&
    !(targetLane === "FROZEN" && operation === "TUNE"), "FROZEN_TUNING_FORBIDDEN",
  "Frozen evidence cannot change parameters"); return true;
}

function laneIsolation(root, plan) {
  const paths = Object.values(plan.lanes); for (const relative of paths) ensureDirectory(contained(root, relative));
  const unique = new Set(paths.map(relative => path.resolve(root, relative)));
  return finalized({ schemaVersion: 1, status: unique.size === 3 ? "PASS" : "FAIL",
    policy: plan.selectionPolicy, paths: { ...plan.lanes }, frozenCanTune: false,
    candidateParametersWritableAfterFreeze: false, fingerprint: "" });
}

function parameterProvenance(root, frozenCandidate = null) {
  if (frozenCandidate) {
    const relativePath = "artifacts/imp8/frozen/candidate-manifest.json";
    const artifactSha256 = sha256Bytes(fs.readFileSync(contained(root, relativePath)));
    const dimensions = frozenCandidate.parameterProvenance.map(item => ({ dimension: item.dimension,
      relativePath, artifactSha256, sourceKind: "CANDIDATE_FROZEN_CALIBRATION",
      status: item.status }));
    return finalized({ schemaVersion: 1, status: dimensions.every(item =>
      item.status === "CALIBRATED_LOCAL") ? "PASS" : "BLOCKED", dimensions,
    calibratedCount: dimensions.filter(x => x.status === "CALIBRATED_LOCAL").length,
    uncalibratedCount: dimensions.filter(x => x.status !== "CALIBRATED_LOCAL").length,
    fingerprint: "" });
  }
  const policyPath = "config/engine-v2/imp5-policy-manifest.json";
  const capacityPath = "config/engine-v2/imp3-capacity-manifest.json";
  const runtimePath = "config/engine-v2/imp6-runtime-build-profile.json";
  const dimensions = [
    ["risk", policyPath, "BUILD_CONFIGURED", "UNCALIBRATED"],
    ["weights", policyPath, "BUILD_CONFIGURED", "UNCALIBRATED"],
    ["depth", runtimePath, "PRODUCTION_WIRED_PENDING_FULL_CALIBRATION", "WIRED_UNCALIBRATED"],
    ["cache", runtimePath, "PRODUCTION_WIRED_PENDING_FULL_CALIBRATION", "WIRED_UNCALIBRATED"],
    ["arena", capacityPath, "BUILD_CONFIGURED", "UNCALIBRATED"],
    ["batch", runtimePath, "LOCAL_BENCHMARK_SELECTED", "CALIBRATED_LOCAL"],
    ["fallback", runtimePath, "LOCAL_BENCHMARK_SELECTED", "CALIBRATED_LOCAL"]
  ].map(([dimension, relativePath, sourceKind, status]) => ({ dimension, relativePath,
    artifactSha256: artifactRef(root, relativePath).sha256, sourceKind, status }));
  return finalized({ schemaVersion: 1, status: dimensions.every(item => item.status === "CALIBRATED_LOCAL") ?
    "PASS" : "BLOCKED", dimensions, calibratedCount: dimensions.filter(x => x.status === "CALIBRATED_LOCAL").length,
    uncalibratedCount: dimensions.filter(x => x.status !== "CALIBRATED_LOCAL").length, fingerprint: "" });
}

function profileLock(root) {
  const inputs = {
    rule: artifactRef(root, "docs/design/dd4-rule-corpus.json"),
    featureWeight: artifactRef(root, "config/engine-v2/imp5-policy-manifest.json"),
    search: artifactRef(root, "config/engine-v2/imp4-search-manifest.json"),
    runtime: artifactRef(root, "config/engine-v2/imp6-runtime-build-profile.json"),
    memory: artifactRef(root, "config/engine-v2/imp3-capacity-manifest.json"),
    cache: artifactRef(root, "docs/design/dd8-cache-inventory.json"),
    capability: artifactRef(root, "battle-records/control/capabilities/v2/main/capability-profile.json")
  };
  const floating = Object.values(inputs).filter(item => /latest/i.test(item.relativePath)).length;
  return finalized({ schemaVersion: 1, status: floating ? "FAIL" : "PASS", targetTankProfileId: "v2",
    inputs, floatingInputCount: floating, fingerprint: "" });
}

function productionRootAudit(source) {
  const { me, enemy, game, calls } = productionRootFixture();
  const sandbox = { Math }; vm.createContext(sandbox); vm.runInContext(source, sandbox, { timeout: 2000 });
  const returned = sandbox.onIdle(me, enemy, game);
  const readsPlatformRoot = !/function onIdle\(me, enemy, game\)[\s\S]*?return ACTION\.NONE;\s*}/.test(source);
  return finalized({ schemaVersion: 1, status: calls.length > 0 && readsPlatformRoot ? "PASS" : "BLOCKED",
    emittedCallCount: calls.length, emittedCalls: calls, returnedActionCode: Number.isSafeInteger(returned) ? returned : null,
    readsPlatformRoot, actionSideEffectRequired: true, fingerprint: "" });
}

async function buildReproducibility(root) {
  const base = contained(root, "artifacts", "build", "imp8");
  const left = await buildImp6Production({ workspaceRoot: root, outputDirectory: path.join(base, "rebuild-a") });
  const right = await buildImp6Production({ workspaceRoot: root, outputDirectory: path.join(base, "rebuild-b") });
  const sourceEqual = fs.readFileSync(left.sourceFile).equals(fs.readFileSync(right.sourceFile));
  const minifiedEqual = fs.readFileSync(left.minifiedFile).equals(fs.readFileSync(right.minifiedFile));
  const manifestEqual = left.manifest.fingerprint === right.manifest.fingerprint;
  const rootAudit = productionRootAudit(fs.readFileSync(left.minifiedFile, "utf8"));
  return finalized({ schemaVersion: 1, status: sourceEqual && minifiedEqual && manifestEqual &&
    left.manifest.status === "PASS" ? "PASS" : "FAIL", sourceEqual, minifiedEqual, manifestEqual,
    sourceSha256: left.manifest.sourceHash, minifiedSha256: left.manifest.minifiedHash,
    buildManifestFingerprint: left.manifest.fingerprint, buildManifestSha256: sha256Bytes(fs.readFileSync(left.manifestFile)),
    stripStatus: left.manifest.strip.status, differentialStatus: left.manifest.differential.status,
    differentialMismatchCount: left.manifest.differential.mismatchCount,
    localCapacityGatesPass: Object.values(left.verification.localGates).every(Boolean),
    platformCodeGatePass: left.manifest.platformCode.withinLimit,
    platformCodeBytes: left.manifest.platformCode.bytes,
    platformCodeLimitBytes: left.manifest.platformCode.maximumBytes,
    productionRootAudit: rootAudit, sourceFile: path.relative(root, left.sourceFile),
    minifiedFile: path.relative(root, left.minifiedFile), fingerprint: "" });
}

function candidateIdentity(root, build, frozenCandidate = null) {
  const registry = readJson(contained(root, "battle-records", "control", "tank-registry.json"));
  const profile = registry.profiles.find(item => item.tankProfileId === "v2");
  const baseline = readJson(contained(root, "battle-records", "tanks", "v2", "baselines", "main", "baseline-manifest.json"));
  const capability = readJson(contained(root, "battle-records", "control", "capabilities", "v2", "main", "capability-profile.json"));
  const exact = profile && profile.tankId === baseline.tankId && profile.skillId === "poison" &&
    baseline.skillId === "poison" && capability.profileId === "v2" && capability.branch === "main";
  const candidateExact = frozenCandidate && frozenCandidate.status === "FROZEN" &&
    frozenCandidate.target.tankProfileId === "v2" && frozenCandidate.target.tankId === profile?.tankId &&
    frozenCandidate.target.skillId === "poison" && frozenCandidate.target.branch === "main" &&
    frozenCandidate.build.minifiedSha256 === build.minifiedSha256;
  return finalized({ schemaVersion: 1, status: exact && candidateExact ? "FROZEN_IDENTITY_VERIFIED" :
    exact ? "IDENTITY_VERIFIED_CANDIDATE_BLOCKED" : "IDENTITY_MISMATCH",
    targetTankProfileId: "v2", targetTankId: profile?.tankId || null, targetTankUrlId: profile?.tankUrlId || null,
    targetSkillId: profile?.skillId || null, branch: "main", baselineStatus: baseline.baselineStatus,
    rollbackMode: baseline.baselineStatus === "VERIFIED_BASELINE" ? "VERIFIED_BASELINE" : "FIRST_PUBLISH_NO_ROLLBACK",
    rollbackArtifactSha256: baseline.publishedCodeHash, platformCapabilityProfileId: capability.profileId,
    platformCapabilityProfileFingerprint: capability.fingerprint, publishArtifactKind: "PRODUCTION_MINIFIED",
    publishArtifactSha256: build.minifiedSha256, publishArtifactBytes: fs.statSync(contained(root, build.minifiedFile)).size,
    candidateId: frozenCandidate?.candidateId || null,
    candidateFingerprint: frozenCandidate?.fingerprint || null,
    candidateFrozen: Boolean(candidateExact), fingerprint: "" });
}

function assertCandidateIdentity(identity) {
  invariant(identity && identity.targetTankProfileId === "v2", "IMP8_CROSS_PROFILE_CANDIDATE",
    "IMP8 Candidate must target the v2 profile");
  invariant(identity.targetTankId === 7214 && identity.targetTankUrlId === "tnk_AguYVXrZXBsFiBGEB",
    "IMP8_TANK_IDENTITY_MISMATCH", "IMP8 Candidate tank identity drifted");
  invariant(identity.targetSkillId === "poison" && identity.branch === "main",
    "IMP8_SKILL_BRANCH_MISMATCH", "IMP8 Candidate must bind poison on main");
  invariant(identity.baselineStatus === "VERIFIED_BASELINE",
    "IMP8_ROLLBACK_BASELINE_MISSING", "IMP8 Candidate requires the verified v2 baseline");
  invariant(identity.publishArtifactKind === "PRODUCTION_MINIFIED" &&
    /^[0-9a-f]{64}$/.test(identity.publishArtifactSha256) && identity.publishArtifactBytes > 0,
  "IMP8_PUBLISH_BINDING_INVALID", "IMP8 Candidate publish bytes are not exactly bound");
  return true;
}

function candidateTestPlan(root, createdAt) {
  const legacy = readJson(contained(root, "docs", "design", "dd9-legacy-corpus-manifest.json"));
  const expected = legacy.split.roles.FROZEN_REGRESSION.matches;
  const { assignment } = loadDd9Assignment(root);
  const ids = idsForRole(assignment, "FROZEN_REGRESSION");
  invariant(assignment.assignmentFingerprint === legacy.split.assignmentFingerprint,
    "IMP8_FROZEN_ASSIGNMENT_FINGERPRINT_MISMATCH", assignment.assignmentFingerprint);
  invariant(ids.length === expected, "IMP8_FROZEN_ASSIGNMENT_CARDINALITY_MISMATCH",
    `${ids.length}/${expected}`);
  const value = { schemaVersion: 1, objectKind: "CANDIDATE_TEST_PLAN", testPlanId: "imp8-v2-local-v1",
    status: ids.length === expected ? "READY" : "BLOCKED", targetTankProfileId: "v2",
    candidateBinding: "BEFORE_CANDIDATE_FREEZE", frozenSource: { legacyCorpusVersion: legacy.legacyCorpusVersion,
      assignmentFingerprint: assignment.assignmentFingerprint, expectedMatchCount: expected,
      matchUrlIds: ids, assignmentAvailable: ids.length === expected }, thresholds: {
      terminalMismatchMax: 0, hardFalsePositiveMax: 0, proofFalsePositiveMax: 0,
      rootRestoreFailureMax: 0, runtimeFailureMax: 0, positiveWindowRegressionMax: 0,
      sourceMinifiedMismatchMax: 0 }, mandatoryGates: ["G0", "G1", "G2", "G3", "G4", "G5",
      "G6", "G7", "G8", "G9", "G10A_FROZEN"], createdAt, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); validateSchemaObject("imp8-test-plan", value, root); return value;
}

function priorAcceptance(root, stage) { const file = contained(root, "artifacts", "reports", "acceptance", stage,
  `${stage.toLowerCase()}-acceptance-report.json`); const report = readJson(file);
  invariant(report.status === "ACCEPTED", "PRIOR_STAGE_NOT_ACCEPTED", stage); return path.relative(root, file); }
function localGateMatrix(root, rootAudit, testPlan, g10a = null) {
  const refs = { IMP0: priorAcceptance(root, "IMP0"), IMP2: priorAcceptance(root, "IMP2"),
    IMP3: priorAcceptance(root, "IMP3"), IMP4: priorAcceptance(root, "IMP4"),
    IMP5: priorAcceptance(root, "IMP5"), IMP6: priorAcceptance(root, "IMP6"),
    IMP7: priorAcceptance(root, "IMP7") };
  return [
    ["G0", "PASS", refs.IMP0], ["G1", "PASS", refs.IMP2], ["G2", "PASS", refs.IMP3],
    ["G3", "PASS", refs.IMP3], ["G4", "PASS", refs.IMP6], ["G5", "PASS", refs.IMP7],
    ["G6", "PASS", refs.IMP7], ["G7", "PASS", refs.IMP6],
    ["G8", "PASS", `${refs.IMP4};${refs.IMP5}`],
    ["G9", rootAudit.status === "PASS" ? "PASS" : "BLOCKED", "imp8:production-root-audit"],
    ["G10A_FROZEN", g10a?.status === "PASS" ? "PASS" :
      testPlan.status === "READY" ? "NOT_RUN" : "BLOCKED",
    g10a?.status === "PASS" ? "artifacts/imp8/frozen/g10a-report.json" : "imp8:candidate-test-plan"]
  ].map(([gateId, status, evidenceRef]) => ({ gateId, status, evidenceRef }));
}

function loadFrozenEvidence(root) {
  const candidateFile = contained(root, "artifacts", "imp8", "frozen", "candidate-manifest.json");
  if (!fs.existsSync(candidateFile)) return { candidate: null, g10a: null };
  const candidate = readJson(candidateFile); validateSchemaObject("imp8-candidate-manifest", candidate, root);
  invariant(candidate.fingerprint === fingerprintObject(candidate) && candidate.status === "FROZEN",
    "IMP8_FROZEN_CANDIDATE_INVALID", path.relative(root, candidateFile));
  const minified = contained(root, candidate.build.minifiedRelativePath);
  invariant(fs.existsSync(minified) && sha256Bytes(fs.readFileSync(minified)) ===
    candidate.build.minifiedSha256, "IMP8_FROZEN_BUILD_HASH_MISMATCH", candidate.candidateId);
  const g10aFile = contained(root, "artifacts", "imp8", "frozen", "g10a-report.json");
  if (!fs.existsSync(g10aFile)) return { candidate, g10a: null };
  const g10a = readJson(g10aFile); validateSchemaObject("imp8-g10a-report", g10a, root);
  invariant(g10a.fingerprint === fingerprintObject(g10a) &&
    g10a.candidate.candidateId === candidate.candidateId &&
    g10a.candidate.fingerprint === candidate.fingerprint,
  "IMP8_G10A_CANDIDATE_BINDING_MISMATCH", candidate.candidateId);
  return { candidate, g10a };
}

async function frozenBuildReproducibility(root, candidate) {
  const { moduleOverrides } = require("./imp8-freeze");
  const base = contained(root, "artifacts", "build", "imp8", candidate.candidateId);
  const left = await buildImp6Production({ workspaceRoot: root, outputDirectory: path.join(base, "rebuild-a"),
    moduleSourceOverrides: moduleOverrides(candidate.parameters) });
  const right = await buildImp6Production({ workspaceRoot: root, outputDirectory: path.join(base, "rebuild-b"),
    moduleSourceOverrides: moduleOverrides(candidate.parameters) });
  const sourceEqual = fs.readFileSync(left.sourceFile).equals(fs.readFileSync(right.sourceFile));
  const minifiedEqual = fs.readFileSync(left.minifiedFile).equals(fs.readFileSync(right.minifiedFile));
  const manifestEqual = left.manifest.fingerprint === right.manifest.fingerprint;
  const expectedEqual = left.manifest.sourceHash === candidate.build.sourceSha256 &&
    left.manifest.minifiedHash === candidate.build.minifiedSha256 &&
    left.manifest.fingerprint === candidate.build.buildManifestFingerprint;
  const rootAudit = productionRootAudit(fs.readFileSync(left.minifiedFile, "utf8"));
  return finalized({ schemaVersion: 1, status: sourceEqual && minifiedEqual && manifestEqual &&
    expectedEqual && left.manifest.status === "PASS" ? "PASS" : "FAIL", sourceEqual,
    minifiedEqual, manifestEqual, frozenExpectedEqual: expectedEqual,
    sourceSha256: left.manifest.sourceHash,
    minifiedSha256: left.manifest.minifiedHash, buildManifestFingerprint: left.manifest.fingerprint,
    buildManifestSha256: sha256Bytes(fs.readFileSync(left.manifestFile)),
    stripStatus: left.manifest.strip.status, differentialStatus: left.manifest.differential.status,
    differentialMismatchCount: left.manifest.differential.mismatchCount,
    localCapacityGatesPass: Object.values(left.verification.localGates).every(Boolean),
    platformCodeGatePass: left.manifest.platformCode.withinLimit,
    platformCodeBytes: left.manifest.platformCode.bytes,
    platformCodeLimitBytes: left.manifest.platformCode.maximumBytes,
    productionRootAudit: rootAudit, sourceFile: path.relative(root, left.sourceFile),
    minifiedFile: path.relative(root, left.minifiedFile), fingerprint: "" });
}

function currentInternalBlockers(rootAudit, provenance, testPlan, candidateFrozen, matrix, build) {
  const blockers = [];
  if (!build.platformCodeGatePass) blockers.push("PLATFORM_SCRIPT_BYTE_LIMIT_EXCEEDED");
  if (rootAudit.status !== "PASS") blockers.push("PRODUCTION_ROOT_PIPELINE_NOT_IMPLEMENTED");
  else if (!candidateFrozen) blockers.push("CANDIDATE_MANIFEST_NOT_FROZEN");
  const uncalibrated = new Set(provenance.dimensions.filter(item =>
    item.status !== "CALIBRATED_LOCAL").map(item => item.dimension));
  if (uncalibrated.has("depth")) blockers.push("CALIBRATION_DEPTH_PENDING");
  if (uncalibrated.has("cache")) blockers.push("CALIBRATION_CACHE_PENDING");
  if (uncalibrated.has("risk") || uncalibrated.has("weights"))
    blockers.push("CALIBRATION_RISK_WEIGHTS_ARE_BUILD_CONFIGURED");
  if (uncalibrated.has("arena")) blockers.push("CALIBRATION_ARENA_IS_BUILD_CONFIGURED");
  if (!testPlan.frozenSource.assignmentAvailable)
    blockers.push("FROZEN_ASSIGNMENT_MEMBERSHIP_MISSING");
  const frozen = matrix.find(item => item.gateId === "G10A_FROZEN");
  if (!frozen || frozen.status !== "PASS") blockers.push("G10A_FROZEN_NOT_RUN");
  return blockers;
}

async function runImp8Preflight(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const plan = readJson(contained(root, "config", "engine-v2", "imp8-calibration-plan.json"));
  const frozen = loadFrozenEvidence(root); const lanes = laneIsolation(root, plan);
  const provenance = parameterProvenance(root, frozen.candidate); const lock = profileLock(root);
  const build = frozen.candidate ? await frozenBuildReproducibility(root, frozen.candidate) :
    await buildReproducibility(root); const identity = candidateIdentity(root, build, frozen.candidate);
  const snapshot = readJson(contained(root, "battle-records", "corpus", "imp7", "snapshot-v1.json"));
  const testPlan = candidateTestPlan(root, snapshot.createdAt); const matrix = localGateMatrix(root,
    build.productionRootAudit, testPlan, frozen.g10a); const internal = currentInternalBlockers(
    build.productionRootAudit, provenance, testPlan, identity.candidateFrozen, matrix, build);
  const report = { schemaVersion: 1, reportKind: "IMP8_CANDIDATE_READINESS",
    status: internal.length ? "BLOCKED" : "PASS",
    laneIsolation: lanes, parameterProvenance: provenance, profileLock: lock,
    buildReproducibility: build, candidateIdentity: identity, testPlan, localGateMatrix: matrix,
    internalBlockers: internal, externalBlockers: EXTERNAL_BLOCKERS.slice(),
    candidateFrozen: identity.candidateFrozen,
    fingerprint: "" };
  report.fingerprint = fingerprintObject(report); validateSchemaObject("imp8-readiness-report", report, root);
  const output = contained(root, "artifacts", "imp8", "frozen", "plans"); ensureDirectory(output);
  writeJsonImmutable(path.join(output, `test-plan-${testPlan.fingerprint}.json`), testPlan, { mode: 0o644 });
  const reportDirectory = contained(root, "artifacts", "reports", "imp8"); ensureDirectory(reportDirectory);
  writeJsonAtomic(path.join(reportDirectory, "candidate-readiness-report.json"), report, { mode: 0o644 });
  writeJsonImmutable(path.join(reportDirectory, "history", `candidate-readiness-${report.fingerprint}.json`), report,
    { mode: 0o644 });
  return { report, plan, files: { reportDirectory, testPlanFile: path.join(output,
    `test-plan-${testPlan.fingerprint}.json`) } };
}

module.exports = { INTERNAL_BLOCKERS, EXTERNAL_BLOCKERS, assertLaneWrite, laneIsolation,
  parameterProvenance, profileLock, productionRootAudit, buildReproducibility,
  candidateIdentity, assertCandidateIdentity, candidateTestPlan, localGateMatrix,
  loadFrozenEvidence, frozenBuildReproducibility, currentInternalBlockers, runImp8Preflight };
