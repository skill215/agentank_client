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
  "A6-01": ["all eleven canonical caches verify dual hash signature lifecycle and cache off semantics",
    "cache collisions stale generations and protected replacement fail closed"],
  "A6-02": ["terrain entity opponent profile and plan invalidation is dependency exact",
    "active projectile bomb and plan facts survive cache eviction and disabled caches"],
  "A6-03": ["runtime counter latches fallback at 1500 equivalent work and preserves emergency reserve",
    "same frame and ambiguous reset cannot erase accumulated runtime"],
  "A6-04": ["fallback uses benchmark selected nonzero Minimax depth with unchanged Hard Terminal semantics",
    "emergency emitter works with every cache disabled and still checks Hard"],
  "A6-05": ["identical build inputs reproduce source minified and BuildManifest hashes"],
  "A6-06": ["production bundle strips Reference replay v1 logs IO async randomness and float arrays",
    "poison build contains one own emitter and eight enemy descriptors"],
  "A6-07": ["source and minified full semantic fingerprints match without Math imul"],
  "A6-08": ["six layer benchmark has nonzero local denominators and explicit platform blocker"],
  "A6-09": ["cold init callback arena emergency and exact UTF8 bytes pass local capacity gates"],
  "A6-10": ["IMP6 G4 G7 G9 evidence passes while platform release blockers remain"]
});

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function loadPreviousAcceptance(root) {
  const current = contained(root, "artifacts", "reports", "acceptance", "IMP5",
    "imp5-acceptance-report.json");
  invariant(fs.existsSync(current), "IMP5_ACCEPTANCE_NOT_FOUND", "IMP6 requires IMP5 acceptance");
  const report = readJson(current); validateSchemaObject("imp-acceptance-report", report, root);
  assertFingerprint(report, "IMP5_ACCEPTANCE_FINGERPRINT_MISMATCH");
  invariant(report.status === "ACCEPTED", "IMP5_NOT_ACCEPTED", "IMP5 is not ACCEPTED");
  const immutable = contained(root, "artifacts", "reports", "acceptance", "IMP5", "history",
    `imp5-acceptance-${report.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP5_ACCEPTANCE_CURRENT_DIVERGES", "IMP5 acceptance pointer is not immutable evidence");
  return report;
}
function loadSourceGate(root) {
  const current = contained(root, "artifacts", "reports", "imp6", "imp6-gate-report.json");
  invariant(fs.existsSync(current), "IMP6_GATE_NOT_FOUND", "IMP6 implementation gate is missing");
  const gate = readJson(current); validateSchemaObject("imp6-gate-report", gate, root);
  assertFingerprint(gate, "IMP6_GATE_FINGERPRINT_MISMATCH");
  const immutable = contained(root, "artifacts", "reports", "imp6", "history",
    `imp6-gate-${gate.fingerprint}.json`);
  invariant(fs.existsSync(immutable) && fs.readFileSync(current).equals(fs.readFileSync(immutable)),
    "IMP6_CURRENT_GATE_DIVERGES", "current IMP6 gate differs from immutable evidence");
  return { gate, immutable, sha256: sha256Bytes(fs.readFileSync(immutable)) };
}
function evidenceMap(root, gate) { const output = new Map();
  const allowedRoots = [contained(root, "artifacts", "reports", "imp6", "history"),
    contained(root, "artifacts", "build", "imp6", "history"),
    contained(root, "artifacts", "benchmarks", "imp6", "history")];
  for (const entry of gate.artifacts) { const file = contained(root, entry.relativePath);
    invariant(allowedRoots.some(base => file.startsWith(`${base}${path.sep}`)) && fs.existsSync(file),
      "ACCEPTANCE_EVIDENCE_MISSING", `missing evidence ${entry.artifactId}`);
    const bytes = fs.readFileSync(file); invariant(sha256Bytes(bytes) === entry.sha256,
      "ACCEPTANCE_EVIDENCE_SHA_MISMATCH", `evidence hash mismatch ${entry.artifactId}`);
    output.set(entry.artifactId, { entry, bytes,
      value: file.endsWith(".json") ? JSON.parse(bytes.toString("utf8")) : null }); }
  return output;
}
function inspectImp6Acceptance(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const contractFile = contained(root, "docs", "design",
    "imp-acceptance-contract.md"); const acceptanceContractSha256 = sha256Bytes(fs.readFileSync(contractFile));
  const previous = loadPreviousAcceptance(root); invariant(previous.acceptanceContractSha256 ===
    acceptanceContractSha256, "PREVIOUS_ACCEPTANCE_CONTRACT_STALE",
  "IMP5 was accepted against a different contract"); const source = loadSourceGate(root);
  const evidence = evidenceMap(root, source.gate); const required = id => { const item = evidence.get(id);
    invariant(item, "ACCEPTANCE_EVIDENCE_ID_MISSING", `missing evidence ${id}`); return item; };
  const tap = required("test-output").bytes.toString("utf8"); const tests = required("tests").value;
  const cache = required("cache").value; const runtime = required("runtime").value;
  const build = required("build").value; const benchmark = required("benchmark").value;
  const manifest = build.manifest; const verification = build.verification;
  const criteria = [
    criterion("A6-01", () => { invariant(cache.status === "PASS" && cache.cacheCount === 11 &&
      cache.semanticMismatchCount === 0 && cache.collisionMissCount === 11 && cache.staleMissCount === 11,
      "CACHE_INVENTORY_ACCEPTANCE_FAILED", "canonical cache inventory failed");
      return { cacheCount: cache.cacheCount, cacheBytes: cache.cacheBytes,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A6-01"]) }; }),
    criterion("A6-02", () => { invariant(cache.status === "PASS" && cache.exactInvalidationCount === 1 &&
      cache.protectedFailureCount === 1, "CACHE_INVALIDATION_ACCEPTANCE_FAILED",
      "cache invalidation or protected replacement failed"); return { exactInvalidationCount:
        cache.exactInvalidationCount, requiredPassingTests: assertTapTitles(tap,
          REQUIRED_TEST_TITLES["A6-02"]) }; }),
    criterion("A6-03", () => { invariant(runtime.status === "PASS" && runtime.fallbackAt === 150000 &&
      runtime.fallbackLatched === 1 && runtime.reserveIndependent && runtime.ambiguousResetCount === 0,
      "RUNTIME_ACCEPTANCE_FAILED", "runtime latch or reserve failed"); return { fallbackAt:
        runtime.fallbackAt, reserveBytes: runtime.reserveBytes,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A6-03"]) }; }),
    criterion("A6-04", () => { invariant(runtime.status === "PASS" && runtime.fallbackDepth === 3 &&
      runtime.minimaxEnabled && !runtime.mctsEnabled && runtime.strictMismatchCount === 0,
      "FALLBACK_MINIMAX_ACCEPTANCE_FAILED", "fallback Minimax semantics failed");
      return { fallbackDepth: runtime.fallbackDepth, fallbackNodeBudget: runtime.fallbackNodeBudget,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A6-04"]) }; }),
    criterion("A6-05", () => { invariant(manifest.status === "PASS" && manifest.terser.version === "5.43.1" &&
      manifest.sourceHash.length === 64 && manifest.minifiedHash.length === 64,
      "DETERMINISTIC_BUILD_ACCEPTANCE_FAILED", "deterministic build failed"); return { buildFingerprint:
        manifest.fingerprint, sourceHash: manifest.sourceHash,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A6-05"]) }; }),
    criterion("A6-06", () => { invariant(manifest.strip.status === "PASS" &&
      manifest.strip.findingCount === 0 && cache.productionCounterFindingCount === 0 &&
      manifest.ownSkillId === 6 && manifest.evaluatorMode === "GENERATED",
      "PRODUCTION_STRIP_ACCEPTANCE_FAILED", "production strip failed"); return { sourceBytes:
        manifest.sourceBytes, minifiedBytes: manifest.minifiedBytes,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A6-06"]) }; }),
    criterion("A6-07", () => { invariant(manifest.differential.status === "PASS" &&
      manifest.differential.mismatchCount === 0 && manifest.sandbox.status === "PASS" &&
      !manifest.sandbox.mathImulAvailable, "SOURCE_MINIFIED_ACCEPTANCE_FAILED",
      "source/minified differential failed"); return { semanticFingerprint:
        manifest.differential.sourceFingerprint,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A6-07"]) }; }),
    criterion("A6-08", () => { invariant(benchmark.status === "PASS" && benchmark.layers.length === 6 &&
      benchmark.layers.slice(0, 5).every(layer => layer.status === "PASS" && layer.caseCount > 0 &&
        layer.sampleCount > 0 && layer.metrics.operations > 0) && benchmark.layers[5].status === "BLOCKED",
      "BENCHMARK_ACCEPTANCE_FAILED", "six-layer benchmark failed"); return { benchmarkFingerprint:
        benchmark.fingerprint, platformStatus: benchmark.layers[5].status,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A6-08"]) }; }),
    criterion("A6-09", () => { invariant(Object.values(verification.localGates).every(Boolean) &&
      manifest.memory.emergencyBytes === 2688 && manifest.memory.independentEmergency,
      "LOCAL_CAPACITY_ACCEPTANCE_FAILED", "local capacity gates failed"); return { localGates:
        verification.localGates, cacheBytes: manifest.memory.cacheBytes,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A6-09"]) }; }),
    criterion("A6-10", () => { invariant(source.gate.status === "PASS" && tests.status === "PASS" &&
      tests.fail === 0 && source.gate.releaseBlockers.length === 4 && manifest.releaseEligibility === false,
      "G4_G7_G9_ACCEPTANCE_FAILED", "IMP6 gate or release blockers failed"); return { tests: tests.tests,
        releaseBlockers: source.gate.releaseBlockers,
        requiredPassingTests: assertTapTitles(tap, REQUIRED_TEST_TITLES["A6-10"]) }; })
  ];
  const status = acceptanceStatus(criteria); const blockers = criteria.filter(item => item.status !== "PASS")
    .map(item => item.criterionId); const report = { schemaVersion: 1,
    acceptanceContractVersion: "IMP-ACCEPTANCE-V1", acceptanceContractSha256, stageId: "IMP6", status,
    previousStageAcceptanceFingerprint: previous.fingerprint,
    sourceGate: { relativePath: path.relative(root, source.immutable), sha256: source.sha256,
      fingerprint: source.gate.fingerprint }, criteria,
    evidenceArtifacts: source.gate.artifacts.map(item => ({ ...item })), blockers, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); validateSchemaObject("imp-acceptance-report", report, root);
  return report;
}
function acceptImp6(workspaceRoot = defaultWorkspaceRoot()) { const root = path.resolve(workspaceRoot);
  const report = inspectImp6Acceptance(root); const directory = contained(root, "artifacts", "reports",
    "acceptance", "IMP6"); const history = contained(directory, "history"); ensureDirectory(history);
  const immutable = contained(history, `imp6-acceptance-${report.fingerprint}.json`);
  writeJsonImmutable(immutable, report, { mode: 0o644 });
  writeJsonAtomic(contained(directory, "imp6-acceptance-report.json"), report, { mode: 0o644 });
  return { report, immutable }; }

module.exports = { REQUIRED_TEST_TITLES, loadPreviousAcceptance, loadSourceGate,
  inspectImp6Acceptance, acceptImp6 };
