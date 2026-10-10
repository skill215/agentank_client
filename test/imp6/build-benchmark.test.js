"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { imp6Evidence } = require("./helpers");

test("identical build inputs reproduce source minified and BuildManifest hashes", async () => {
  const { left, right } = await imp6Evidence();
  assert.equal(left.manifest.sourceHash, right.manifest.sourceHash);
  assert.equal(left.manifest.minifiedHash, right.manifest.minifiedHash);
  assert.equal(left.manifest.fingerprint, right.manifest.fingerprint);
  assert.deepEqual(left.manifest.terser, right.manifest.terser);
  assert.equal(fs.readFileSync(left.sourceFile, "utf8"), fs.readFileSync(right.sourceFile, "utf8"));
  assert.equal(fs.readFileSync(left.minifiedFile, "utf8"), fs.readFileSync(right.minifiedFile, "utf8"));
});

test("production bundle strips Reference replay v1 logs IO async randomness and float arrays", async () => {
  const { left } = await imp6Evidence(); const source = fs.readFileSync(left.sourceFile, "utf8");
  assert.equal(left.manifest.strip.status, "PASS"); assert.equal(left.manifest.strip.findingCount, 0);
  assert.doesNotMatch(source, /ReferenceKernel|ExternalSimulator|battle-records|tiny-tank|console\s*\.|\n\s*log\s*\(|\bfetch\s*\(|\bPromise\b|\basync\b|Math\.random|Float32Array|Float64Array/);
  assert.doesNotMatch(source, /probeCount|hitCount|writeCount|replacementCount|invalidationCount|collisionCount|staleCount/);
});

test("poison build contains one own emitter and eight enemy descriptors", async () => {
  const { left } = await imp6Evidence(); const source = fs.readFileSync(left.sourceFile, "utf8");
  assert.equal(left.manifest.ownSkillId, 6); assert.equal(left.manifest.evaluatorMode, "GENERATED");
  assert.equal((source.match(/class OwnPoisonEmitter/g) || []).length, 1);
  assert.equal((source.match(/class ProductionEnemySkillDescriptors/g) || []).length, 1);
  const { ProductionEnemySkillDescriptors } = require(
    "../../engine-v2/src/generated/production-poison-skill");
  const descriptors = new ProductionEnemySkillDescriptors();
  for (let skill = 1; skill <= 8; skill += 1) assert.equal(descriptors.lookup(skill), skill);
});

test("source and minified full semantic fingerprints match without Math imul", async () => {
  const { left } = await imp6Evidence();
  assert.equal(left.manifest.differential.status, "PASS");
  assert.equal(left.manifest.differential.mismatchCount, 0);
  assert.equal(left.manifest.differential.sourceFingerprint,
    left.manifest.differential.minifiedFingerprint);
  assert.equal(left.manifest.sandbox.status, "PASS");
  assert.equal(left.manifest.sandbox.mathImulAvailable, false);
  assert.equal(left.verification.source.values.length, 24);
  assert.deepEqual(left.verification.source.values, left.verification.minified.values);
  assert.equal(left.verification.source.action, left.verification.minified.action);
  assert.deepEqual(left.verification.source.emittedCalls, left.verification.minified.emittedCalls);
  assert.ok(left.verification.source.emittedCalls.length > 0);
});

test("six layer benchmark has nonzero local denominators and explicit platform blocker", async () => {
  const { benchmark } = await imp6Evidence(); const report = benchmark.report;
  assert.equal(report.status, "PASS"); assert.equal(report.layers.length, 6);
  for (const layer of report.layers.slice(0, 5)) {
    assert.equal(layer.status, "PASS"); assert.ok(layer.caseCount > 0 && layer.sampleCount > 0);
    assert.ok(layer.metrics.operations > 0); assert.ok(layer.metrics.p95Micros >= layer.metrics.p50Micros);
    assert.ok(layer.metrics.p99Micros >= layer.metrics.p95Micros);
    assert.ok(layer.metrics.maxMicros >= layer.metrics.p99Micros); assert.ok(layer.bytes > 0);
  }
  assert.equal(report.layers[5].status, "BLOCKED"); assert.equal(report.layers[5].caseCount, 0);
  assert.match(report.layers[5].reason, /PLATFORM_ENGINE_BYTE_LIMIT_AND_RUNTIME_CALIBRATION_PENDING/);
});

test("cold init callback arena emergency memory and exact UTF8 bytes pass independently of source size", async () => {
  const { left, benchmark } = await imp6Evidence(); const gates = left.verification.localGates;
  assert.equal(gates.typedArrayBytes, true);
  assert.equal(gates.coldInit, true);
  assert.equal(gates.callback, true);
  assert.equal(gates.sourceBytes, false, "the upload-source size blocker must remain explicit");
  assert.equal(left.manifest.sourceBytes, Buffer.byteLength(fs.readFileSync(left.sourceFile, "utf8")));
  assert.equal(left.manifest.minifiedBytes, Buffer.byteLength(fs.readFileSync(left.minifiedFile, "utf8")));
  assert.equal(left.manifest.memory.emergencyBytes, 2688);
  assert.ok(left.manifest.memory.productionRootBytes > left.manifest.memory.emergencyBytes);
  assert.equal(left.manifest.memory.totalTypedArrayBytes,
    left.manifest.memory.productionRootBytes);
  assert.equal(left.manifest.memory.measuredMapCells, 1024);
  assert.ok(left.manifest.memory.productionRootBytes > left.manifest.memory.cacheBytes);
  assert.ok(left.manifest.memory.totalTypedArrayBytes <= 1000000);
  assert.equal(left.manifest.memory.independentEmergency, true);
  assert.ok(benchmark.report.layers.every(layer => layer.status === "BLOCKED" || layer.bytes > 0));
  assert.equal(left.verification.platformGates.minifiedCodeBytes, false);
  assert.deepEqual(left.manifest.platformCode, {
    measurement: "UTF8_BYTES", artifactKind: "PRODUCTION_MINIFIED",
    bytes: left.manifest.minifiedBytes, maximumBytes: 204800, warningBytes: 190000,
    headroomBytes: 204800 - left.manifest.minifiedBytes, withinLimit: false, warning: true
  });
  assert.equal(left.manifest.platformStatus, "PLATFORM_LIMIT_EXCEEDED");
});

test("IMP6 G4 G7 G9 evidence passes while platform release blockers remain", async () => {
  const { left, benchmark } = await imp6Evidence();
  assert.equal(left.manifest.status, "PASS"); assert.equal(benchmark.report.status, "PASS");
  assert.equal(left.manifest.releaseEligibility, false);
  assert.deepEqual(left.manifest.blockers, ["PLATFORM_ENGINE_UNKNOWN",
    "PLATFORM_SCRIPT_BYTE_LIMIT_UNKNOWN", "PLATFORM_RUNTIME_CALIBRATION_PENDING",
    "PLATFORM_SCRIPT_BYTE_LIMIT_EXCEEDED"]);
});
