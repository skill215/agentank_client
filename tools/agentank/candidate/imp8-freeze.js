"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory, writeFileImmutable, writeJsonAtomic, writeJsonImmutable } =
  require("../core/atomic-file");
const { assembleProductionSource, buildImp6Production } = require("../build/imp6-builder");
const { readPlan } = require("../calibration/imp8-candidate-comparison");
const { candidateTestPlan } = require("./imp8-preflight");
const generated = require("../../../engine-v2/src/generated/runtime-config");

const RUNTIME_MODULE = "engine-v2/src/generated/runtime-config.js";
const TACTICAL_MODULE = "engine-v2/src/generated/tactical-config.js";

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function frozenJavascript(value) {
  if (Array.isArray(value)) return `Object.freeze([${value.map(frozenJavascript).join(",")}])`;
  if (value && typeof value === "object") return `Object.freeze({${Object.entries(value).map(
    ([key, item]) => `${JSON.stringify(key)}:${frozenJavascript(item)}`).join(",")}})`;
  invariant(Number.isSafeInteger(value) || typeof value === "string" || typeof value === "boolean" ||
    value === null, "IMP8_CANDIDATE_NON_INTEGER_CONFIG", String(value));
  return JSON.stringify(value);
}
function candidateParameters(plan, candidate) {
  const runtimeConfig = { ...clone(generated.RUNTIME_CONFIG),
    ...(candidate.runtime || plan.runtimeTemplate), WORK_CHARGES: candidate.workCharges.slice() };
  const selected = candidate.searchBudget || plan.searchBudget;
  const searchBudget = { DECISION_DEPTH: selected.DECISION_DEPTH.slice(),
    NODE_BUDGET: selected.NODE_BUDGET.slice(), PROOF_BUDGET: selected.PROOF_BUDGET.slice(),
    MATRIX_ITERATIONS: selected.MATRIX_ITERATIONS.slice(), MATRIX_BATCH: selected.MATRIX_BATCH.slice() };
  return { cacheConfig: clone(generated.CACHE_CONFIG), runtimeConfig,
    searchBudget, tacticalConfig: clone(candidate.tactical) };
}
function moduleOverrides(parameters) {
  return {
    [RUNTIME_MODULE]: `"use strict";\nconst CACHE_CONFIG=${frozenJavascript(parameters.cacheConfig)};\n` +
      `const RUNTIME_CONFIG=${frozenJavascript(parameters.runtimeConfig)};\n` +
      `const SEARCH_BUDGET=${frozenJavascript(parameters.searchBudget)};\n` +
      `const BUILD_CONFIG=${frozenJavascript(clone(generated.BUILD_CONFIG))};\n` +
      "module.exports={CACHE_CONFIG,RUNTIME_CONFIG,SEARCH_BUDGET,BUILD_CONFIG};\n",
    [TACTICAL_MODULE]: `"use strict";\nconst TACTICAL_CONFIG=${frozenJavascript(
      parameters.tacticalConfig)};\nmodule.exports={TACTICAL_CONFIG};\n`
  };
}
function artifact(root, relativePath) {
  const file = contained(root, relativePath); invariant(fs.existsSync(file),
    "IMP8_FREEZE_EVIDENCE_MISSING", relativePath); const bytes = fs.readFileSync(file);
  const value = file.endsWith(".json") ? JSON.parse(bytes) : null;
  return { relativePath, sha256: sha256Bytes(bytes), fingerprint: value?.fingerprint || null, value };
}
function comparisonEvidence(root, relativePath, planPath) {
  const comparison = artifact(root, relativePath); const loaded = readPlan(root, planPath);
  const { plan } = loaded; const report = comparison.value;
  invariant(report.reportKind === "IMP8_CANDIDATE_COMPARISON" && report.status === "SELECTED",
    "IMP8_COMPARISON_HAS_NO_SELECTION", relativePath);
  invariant(report.plan.relativePath === loaded.relativePath && report.plan.sha256 === loaded.sha256,
    "IMP8_COMPARISON_PLAN_BINDING_MISMATCH", relativePath);
  invariant(report.executedLimit === null && report.executedRepetitions === plan.repetitions,
    "IMP8_COMPARISON_NOT_FULL_RUN", `${report.executedLimit}/${report.executedRepetitions}`);
  invariant(report.v1BaselineSnapshot.sourceChangedDuringRun === false,
    "IMP8_COMPARISON_SOURCE_CHANGED", report.v1BaselineSnapshot.relativePath);
  const candidate = plan.candidates.find(item => item.candidateProfileId ===
    report.selectedCandidateProfileId);
  invariant(candidate, "IMP8_SELECTED_CANDIDATE_NOT_IN_PLAN", report.selectedCandidateProfileId);
  const metric = report.metrics.find(item => item.candidateProfileId === candidate.candidateProfileId);
  invariant(metric?.qualified === true && metric.hardPass === true,
    "IMP8_SELECTED_CANDIDATE_NOT_QUALIFIED", candidate.candidateProfileId);
  return { comparison, loaded, plan, report, candidate, metric };
}
function provenance(root, selection, buildRef = null) {
  const comparisonRef = `${selection.comparison.relativePath}#${selection.report.fingerprint}`;
  const planRef = `${selection.loaded.relativePath}#sha256:${selection.loaded.sha256}`;
  const calibration = artifact(root, "artifacts/imp8/calibration/local-suite-v1/calibration-report.json");
  invariant(calibration.value.status === "PASS" && calibration.value.invariants.allZeroTolerancePass,
    "IMP8_LOCAL_CALIBRATION_INVALID", calibration.relativePath);
  const runtime = artifact(root,
    "artifacts/imp8/calibration/runtime-envelope-v1/runtime-evidence-report.json");
  const runtimeRef = `${runtime.relativePath}#${runtime.fingerprint || runtime.sha256}`;
  const cacheRef = `${calibration.relativePath}#${calibration.fingerprint}`;
  const refs = {
    risk: [planRef, comparisonRef], weights: [planRef, comparisonRef],
    depth: [planRef, comparisonRef], cache: [cacheRef,
      "config/engine-v2/imp6-runtime-build-profile.json#LOCAL_BENCHMARK_SELECTED"],
    arena: [cacheRef, comparisonRef], batch: [runtimeRef, planRef, comparisonRef],
    fallback: [runtimeRef, planRef, comparisonRef]
  };
  if (buildRef) { refs.cache.push(buildRef); refs.arena.push(buildRef); }
  return Object.keys(refs).map(dimension => ({ dimension, status: "CALIBRATED_LOCAL",
    evidenceRefs: refs[dimension] }));
}
function discoveryEvidence(root) {
  const evidence = artifact(root, "artifacts/reports/imp8/discovery-skill-regression-report.json");
  const report = evidence.value;
  invariant(report.status === "PASS" && report.lane === "DISCOVERY" &&
    report.laneIsolation.tuningAllowed === false && report.laneIsolation.calibrationMembership === 0 &&
    report.laneIsolation.frozenMembership === 0, "IMP8_DISCOVERY_REGRESSION_INVALID", evidence.relativePath);
  return { lane: report.lane, status: report.status, relativePath: evidence.relativePath,
    fingerprint: report.fingerprint, sha256: evidence.sha256,
    membershipCount: report.coverage.matchMemberships };
}
function assertSameBuild(left, right) {
  invariant(left.manifest.status === "PASS" && right.manifest.status === "PASS" &&
    left.manifest.platformCode.withinLimit && right.manifest.platformCode.withinLimit &&
    left.manifest.sourceHash === right.manifest.sourceHash &&
    left.manifest.minifiedHash === right.manifest.minifiedHash &&
    left.manifest.fingerprint === right.manifest.fingerprint,
  "IMP8_CANDIDATE_BUILD_NOT_REPRODUCIBLE",
  left.manifest.platformCode.withinLimit ? left.manifest.fingerprint :
    `PLATFORM_SCRIPT_BYTE_LIMIT_EXCEEDED:${left.manifest.minifiedBytes}/` +
      `${left.manifest.platformCode.maximumBytes}`); return true;
}

async function freezeImp8Candidate(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const planPath = options.planPath || "config/engine-v2/imp8-candidate-comparison-v6.json";
  const comparisonPath = options.comparisonPath ||
    "artifacts/imp8/calibration/candidate-comparison-v6/candidate-comparison-report.json";
  const selection = comparisonEvidence(root, comparisonPath, planPath);
  const parameters = candidateParameters(selection.plan, selection.candidate);
  const overrides = moduleOverrides(parameters);
  const productionSourceSha256 = sha256Text(assembleProductionSource(root,
    { moduleSourceOverrides: overrides }).source);
  const seed = fingerprintObject({ comparisonFingerprint: selection.report.fingerprint,
    candidateProfileId: selection.candidate.candidateProfileId, parameters, productionSourceSha256 });
  const candidateId = `imp8-v2-${seed.slice(0, 16)}`;
  const directory = contained(root, "artifacts", "imp8", "frozen", "candidates", candidateId);
  const manifestFile = path.join(directory, "candidate-manifest.json");
  const frozenAt = fs.existsSync(manifestFile) ? readJson(manifestFile).frozenAt :
    options.now || new Date().toISOString();
  const currentManifestFile = contained(root, "artifacts", "imp8", "frozen",
    "candidate-manifest.json");
  if (fs.existsSync(currentManifestFile)) {
    const currentCandidate = readJson(currentManifestFile);
    if (currentCandidate.candidateId !== candidateId) {
      const dispositionFile = contained(root, "artifacts", "imp8", "frozen", "candidates",
        currentCandidate.candidateId, "candidate-disposition.json");
      const disposition = fs.existsSync(dispositionFile) ? readJson(dispositionFile) : null;
      invariant(disposition?.status === "REJECTED" &&
        disposition.candidateFingerprint === currentCandidate.fingerprint,
      "FROZEN_CANDIDATE_REPLACEMENT_FORBIDDEN", candidateId);
    }
  }
  const buildDirectory = path.join(directory, "build");
  const rebuildDirectory = contained(root, "artifacts", "build", "imp8-freeze", candidateId,
    "reproducibility-check");
  const left = await buildImp6Production({ workspaceRoot: root, outputDirectory: buildDirectory,
    moduleSourceOverrides: overrides });
  const right = await buildImp6Production({ workspaceRoot: root, outputDirectory: rebuildDirectory,
    moduleSourceOverrides: overrides });
  assertSameBuild(left, right);
  const v1Source = fs.readFileSync(contained(root, selection.report.v1BaselineSnapshot.relativePath));
  invariant(sha256Bytes(v1Source) === selection.report.v1BaselineSnapshot.sha256,
    "IMP8_V1_SOURCE_DRIFTED_BEFORE_FREEZE", selection.report.v1BaselineSnapshot.relativePath);
  const frozenV1File = path.join(directory, "inputs",
    `v1-baseline-${selection.report.v1BaselineSnapshot.sha256}.js`);
  writeFileImmutable(frozenV1File, v1Source, { mode: 0o644 });
  const snapshot = readJson(contained(root, "battle-records", "corpus", "imp7", "snapshot-v1.json"));
  const testPlan = candidateTestPlan(root, snapshot.createdAt);
  const testPlanRelative = path.join("artifacts", "imp8", "frozen", "plans",
    `test-plan-${testPlan.fingerprint}.json`).replaceAll("\\", "/");
  const testPlanFile = contained(root, testPlanRelative); writeJsonImmutable(testPlanFile, testPlan);
  const testPlanRef = artifact(root, testPlanRelative); const discovery = discoveryEvidence(root);
  const buildManifestRelative = path.relative(root, left.manifestFile).replaceAll("\\", "/");
  const manifest = { schemaVersion: 1, objectKind: "IMP8_CANDIDATE_MANIFEST", status: "FROZEN",
    candidateId, target: { tankProfileId: "v2", tankId: 7214,
      tankUrlId: "tnk_AguYVXrZXBsFiBGEB", skillId: "poison", branch: "main" },
    selection: { status: "SELECTED", candidateProfileId: selection.candidate.candidateProfileId,
      comparisonFingerprint: selection.report.fingerprint, comparisonSha256: selection.comparison.sha256,
      planRelativePath: selection.loaded.relativePath, planSha256: selection.loaded.sha256,
      fullCalibrationRun: true, v1SourceChangedDuringRun: false,
      productionSourceSha256,
      v1RelativePath: selection.report.v1BaselineSnapshot.relativePath,
      v1Sha256: selection.report.v1BaselineSnapshot.sha256,
      frozenV1RelativePath: path.relative(root, frozenV1File).replaceAll("\\", "/") }, parameters,
    parameterProvenance: provenance(root, selection,
      `${buildManifestRelative}#${left.manifest.fingerprint}`),
    build: { status: left.manifest.status,
      sourceRelativePath: path.relative(root, left.sourceFile).replaceAll("\\", "/"),
      sourceSha256: left.manifest.sourceHash, sourceBytes: left.manifest.sourceBytes,
      minifiedRelativePath: path.relative(root, left.minifiedFile).replaceAll("\\", "/"),
      minifiedSha256: left.manifest.minifiedHash, minifiedBytes: left.manifest.minifiedBytes,
      buildManifestRelativePath: buildManifestRelative,
      buildManifestFingerprint: left.manifest.fingerprint,
      buildManifestSha256: sha256Bytes(fs.readFileSync(left.manifestFile)), reproducible: true },
    testPlan: { relativePath: testPlanRelative, fingerprint: testPlan.fingerprint,
      sha256: testPlanRef.sha256 }, discoveryRegression: discovery,
    frozenAt, fingerprint: "" };
  manifest.fingerprint = fingerprintObject(manifest);
  validateSchemaObject("imp8-candidate-manifest", manifest, root);
  ensureDirectory(directory);
  writeJsonImmutable(path.join(directory, "history", `candidate-manifest-${manifest.fingerprint}.json`),
    manifest, { mode: 0o644 });
  writeJsonImmutable(manifestFile, manifest, { mode: 0o644 });
  writeJsonAtomic(currentManifestFile, manifest, { mode: 0o644 });
  return { manifest, manifestFile, directory };
}

function rejectCurrentCandidate(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const currentFile = contained(root, "artifacts", "imp8", "frozen", "candidate-manifest.json");
  invariant(fs.existsSync(currentFile), "IMP8_FROZEN_CANDIDATE_MISSING", currentFile);
  const candidate = readJson(currentFile); validateSchemaObject("imp8-candidate-manifest", candidate, root);
  invariant(candidate.fingerprint === fingerprintObject(candidate),
    "IMP8_FROZEN_CANDIDATE_INVALID", candidate.candidateId);
  const gateRelativePath = "artifacts/reports/imp8/imp8-gate-report.json";
  const gateFile = contained(root, gateRelativePath); const gateBytes = fs.readFileSync(gateFile);
  const gate = JSON.parse(gateBytes); invariant(gate.status === "FAIL" &&
    gate.fingerprint === fingerprintObject(gate), "IMP8_REJECTION_REQUIRES_FAILED_GATE", gate.status);
  const directory = contained(root, "artifacts", "imp8", "frozen", "candidates",
    candidate.candidateId); const file = path.join(directory, "candidate-disposition.json");
  const rejectedAt = fs.existsSync(file) ? readJson(file).rejectedAt :
    options.now || new Date().toISOString();
  const disposition = { schemaVersion: 1, objectKind: "IMP8_CANDIDATE_DISPOSITION",
    status: "REJECTED", candidateId: candidate.candidateId,
    candidateFingerprint: candidate.fingerprint, reason: "IMP8_GATE_FAILED",
    gate: { relativePath: gateRelativePath, sha256: sha256Bytes(gateBytes),
      fingerprint: gate.fingerprint, status: gate.status,
      failedCheckIds: gate.checks.filter(item => item.status === "FAIL").map(item => item.checkId) },
    rejectedAt, fingerprint: "" };
  disposition.fingerprint = fingerprintObject(disposition);
  validateSchemaObject("imp8-candidate-disposition", disposition, root);
  writeJsonImmutable(file, disposition, { mode: 0o644 });
  writeJsonImmutable(path.join(directory, "history", `candidate-disposition-${disposition.fingerprint}.json`),
    disposition, { mode: 0o644 });
  writeJsonAtomic(contained(root, "artifacts", "imp8", "frozen", "candidate-disposition.json"),
    disposition, { mode: 0o644 });
  return { candidate, disposition, file };
}

module.exports = { RUNTIME_MODULE, TACTICAL_MODULE, frozenJavascript, candidateParameters,
  moduleOverrides, comparisonEvidence, provenance, discoveryEvidence, assertSameBuild,
  freezeImp8Candidate, rejectCurrentCandidate };
