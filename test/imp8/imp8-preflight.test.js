"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { imp8Evidence } = require("./helpers");
const { assertLaneWrite, assertCandidateIdentity, INTERNAL_BLOCKERS, EXTERNAL_BLOCKERS } =
  require("../../tools/agentank/candidate/imp8-preflight");
const { writeJsonImmutable } = require("../../tools/agentank/core/atomic-file");

function clone(value) { return JSON.parse(JSON.stringify(value)); }

test("Discovery Calibration and Frozen lanes reject every Frozen tuning path", async () => {
  const { report } = await imp8Evidence();
  assert.equal(report.laneIsolation.status, "PASS");
  assert.equal(new Set(Object.values(report.laneIsolation.paths)).size, 3);
  assert.equal(report.laneIsolation.frozenCanTune, false);
  assert.equal(assertLaneWrite("DISCOVERY", "CALIBRATION", "TUNE"), true);
  assert.throws(() => assertLaneWrite("CALIBRATION", "FROZEN", "TUNE"),
    { code: "FROZEN_TUNING_FORBIDDEN" });
  assert.throws(() => assertLaneWrite("FROZEN", "DISCOVERY", "TUNE"),
    { code: "FROZEN_TUNING_FORBIDDEN" });
});

test("risk weights depth cache Arena batch and fallback expose calibration provenance", async () => {
  const { report } = await imp8Evidence(); const value = report.parameterProvenance;
  assert.deepEqual(value.dimensions.map(item => item.dimension),
    ["risk", "weights", "depth", "cache", "arena", "batch", "fallback"]);
  assert.ok(value.dimensions.every(item => /^[0-9a-f]{64}$/.test(item.artifactSha256)));
  assert.ok(value.dimensions.every(item => item.status === "CALIBRATED_LOCAL" &&
    item.sourceKind === "CANDIDATE_FROZEN_CALIBRATION"));
  assert.equal(value.calibratedCount, 7); assert.equal(value.uncalibratedCount, 0);
  assert.equal(value.status, "PASS");
});

test("Rule Feature Search Runtime Memory and Capability locks contain no floating latest input", async () => {
  const { report } = await imp8Evidence(); const value = report.profileLock;
  assert.equal(value.status, "PASS"); assert.equal(value.targetTankProfileId, "v2");
  assert.equal(value.floatingInputCount, 0);
  assert.deepEqual(Object.keys(value.inputs),
    ["rule", "featureWeight", "search", "runtime", "memory", "cache", "capability"]);
  assert.ok(Object.values(value.inputs).every(item => /^[0-9a-f]{64}$/.test(item.sha256) &&
    !/latest/i.test(item.relativePath)));
});

test("working build is reproducible but the oversized historical Candidate cannot be reused", async () => {
  const { report } = await imp8Evidence(); const value = report.buildReproducibility;
  assert.equal(value.status, "FAIL"); assert.equal(value.sourceEqual, true);
  assert.equal(value.minifiedEqual, true); assert.equal(value.manifestEqual, true);
  assert.equal(value.frozenExpectedEqual, false);
  assert.equal(value.stripStatus, "PASS"); assert.equal(value.differentialStatus, "PASS");
  assert.equal(value.differentialMismatchCount, 0); assert.equal(value.localCapacityGatesPass, true);
  assert.equal(value.platformCodeGatePass, false);
  assert.equal(value.platformCodeLimitBytes, 204800);
  assert.ok(value.platformCodeBytes > value.platformCodeLimitBytes);
  assert.match(value.sourceSha256, /^[0-9a-f]{64}$/); assert.match(value.minifiedSha256, /^[0-9a-f]{64}$/);
});

test("candidate preflight preserves identity but blocks the stale oversized Candidate", async () => {
  const { report } = await imp8Evidence(); const identity = report.candidateIdentity;
  assert.equal(assertCandidateIdentity(identity), true);
  assert.equal(identity.status, "IDENTITY_VERIFIED_CANDIDATE_BLOCKED");
  assert.equal(identity.candidateFrozen, false); assert.match(identity.candidateId,
    /^imp8-v2-[a-f0-9]{16}$/); assert.match(identity.candidateFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(report.buildReproducibility.productionRootAudit.status, "PASS");
  assert.ok(report.buildReproducibility.productionRootAudit.emittedCallCount > 0);
  const wrong = clone(identity); wrong.targetTankProfileId = "v1";
  assert.throws(() => assertCandidateIdentity(wrong), { code: "IMP8_CROSS_PROFILE_CANDIDATE" });
});

test("Frozen denominator membership and thresholds are reconstructed and preregistered before execution", async () => {
  const { report } = await imp8Evidence(); const plan = report.testPlan;
  assert.equal(plan.status, "READY"); assert.equal(plan.candidateBinding, "BEFORE_CANDIDATE_FREEZE");
  assert.equal(plan.frozenSource.expectedMatchCount, 63);
  assert.equal(plan.frozenSource.assignmentAvailable, true);
  assert.equal(plan.frozenSource.matchUrlIds.length, 63);
  assert.equal(new Set(plan.frozenSource.matchUrlIds).size, 63);
  assert.ok(Object.values(plan.thresholds).every(value => value === 0));
  assert.deepEqual(plan.mandatoryGates.slice(-2), ["G9", "G10A_FROZEN"]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-imp8-frozen-"));
  const file = path.join(directory, "plan.json"); writeJsonImmutable(file, plan);
  assert.throws(() => writeJsonImmutable(file, { ...plan, status: "BLOCKED" }),
    { code: "IMMUTABLE_ARTIFACT_CONFLICT" });
});

test("historical G0 through G10A stay immutable while current Candidate qualification is blocked", async () => {
  const { report } = await imp8Evidence(); const gates = report.localGateMatrix;
  assert.deepEqual(gates.map(item => item.gateId),
    ["G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10A_FROZEN"]);
  assert.ok(gates.every(item => item.status === "PASS"));
  assert.equal(report.candidateFrozen, false);
});

test("platform byte overflow is an internal blocker before any external operation", async () => {
  const { report } = await imp8Evidence();
  assert.equal(report.status, "BLOCKED");
  assert.deepEqual(report.internalBlockers,
    ["PLATFORM_SCRIPT_BYTE_LIMIT_EXCEEDED", "CANDIDATE_MANIFEST_NOT_FROZEN"]);
  assert.deepEqual(report.externalBlockers, EXTERNAL_BLOCKERS);
  assert.ok(INTERNAL_BLOCKERS.length > 0); assert.ok(report.externalBlockers.length > 0);
});
