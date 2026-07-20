"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { fingerprintObject } = require("../../tools/agentank/core/hash");
const { FastRegressionStore } = require("../../tools/agentank/fast-regression/artifact-store");
const { rehydratePhysical } = require("../../tools/agentank/fast-regression/rehydrate");
const { PHYSICAL_SAFETY_STATUS, PhysicalSafetyOracle } =
  require("../../tools/agentank/fast-regression/physical-safety-oracle");
const { VERDICT, buildPreferences } =
  require("../../tools/agentank/fast-regression/physical-safety-classifier");
const { actionCommand, sameCommand, inspectRootsAtFrames } =
  require("../../tools/agentank/fast-regression/focused-diagnostic");
const { loadFrozenCandidate, v2Options } =
  require("../../tools/agentank/candidate/imp8-g10a");
const { HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { SAFETY_STATUS } =
  require("../../engine-v2/src/search/information-safety-closure");

const workspaceRoot = path.resolve(__dirname, "../..");
const classificationFile = path.join(workspaceRoot, "artifacts", "fast-regression", "reports",
  "physical-safety-oracle", "latest.json");
const defectFile = path.join(workspaceRoot, "artifacts", "fast-regression", "defect-corpora",
  "physical-safety-v1", "latest.json");
const focusedFile = path.join(workspaceRoot, "artifacts", "fast-regression", "reports",
  "native-poison-death-safety-chance", "latest.json");

function load(file) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(value.fingerprint, fingerprintObject(value)); return value;
}

test("physical Safety classification freezes 4 defects separately from 8 policy witnesses", () => {
  const report = load(classificationFile); const corpus = load(defectFile);
  assert.equal(report.status, "COMPLETED");
  assert.deepEqual(report.counts, { cases: 12, confirmedFalseProvenSafe: 4,
    observationConsistentWindowWitness: 8, unresolvedIncomplete: 0,
    transitions: 27160, nodes: 2535 });
  const confirmed = report.results.filter(item => item.verdict === VERDICT.CONFIRMED)
    .map(item => `${item.capsuleFingerprint}:${item.frame}`);
  assert.deepEqual(confirmed, [
    "03414b85edafd432dd07532f827b58b757b71324e38a1989cfa1b407173b462e:38",
    "11ef62c235b0fabbaff0cb573bddf19a80bf1f4766d7c2e5df6f6fbdd634b575:22",
    "1723388cef7c3d036b02b84e70929ae5353e21a553b99d6c7846e775d3521a57:15",
    "c484c9b0f59225fb73986f16b90b6f8083825971be4b040527adf459a597bbfc:51"
  ]);
  assert.equal(corpus.counts.confirmedDefects, 4);
  assert.deepEqual(corpus.confirmedDefects.map(item =>
    `${item.capsuleFingerprint}:${item.frame}`), confirmed);
  assert.ok(report.results.every(item => item.productionSafety === "PROVEN_SAFE" &&
    item.outcome.complete === true));
});

test("each frozen physical Safety defect remains executable against the pinned simulator", async () => {
  const classification = load(classificationFile); const focused = load(focusedFile);
  const store = new FastRegressionStore(workspaceRoot);
  for (const expected of classification.results.filter(item => item.verdict === VERDICT.CONFIRMED)) {
    const { capsule } = store.readCapsule(expected.capsuleFingerprint);
    const focusedResult = focused.results.find(item => item.fingerprint ===
      expected.capsuleFingerprint && item.frames.some(frame => frame.frame === expected.frame));
    assert.ok(focusedResult);
    const frame = focusedResult.frames.find(item => item.frame === expected.frame);
    assert.ok(frame);
    const restored = await rehydratePhysical(workspaceRoot, capsule, expected.frame);
    const preferences = buildPreferences(capsule, focusedResult);
    const oracle = new PhysicalSafetyOracle({ ...classification.budgets,
      preferredOwnByFrame: preferences.own, preferredEnemyByFrame: preferences.enemy });
    const actual = oracle.classifyRoot(restored.simulator, expected.v2Seat,
      expected.selectedCommand, expected.horizonFrames);
    assert.equal(actual.status, PHYSICAL_SAFETY_STATUS.NO_WITNESS,
      `${expected.capsuleFingerprint}:${expected.frame}`);
    assert.equal(actual.complete, true);
    assert.equal(fingerprintObject(actual.counterexample),
      fingerprintObject(expected.outcome.counterexample));
  }
});

test("production Safety consumes future enemy capability without promoting it to Hard", async () => {
  const classification = load(classificationFile); const store = new FastRegressionStore(workspaceRoot);
  const frozen = loadFrozenCandidate(workspaceRoot);
  const settings = v2Options(frozen.manifest.parameters).engine;
  const byCapsule = new Map();
  for (const expected of classification.results) {
    const list = byCapsule.get(expected.capsuleFingerprint) || [];
    list.push(expected); byCapsule.set(expected.capsuleFingerprint, list);
  }
  for (const [fingerprint, cases] of byCapsule) {
    const { capsule } = store.readCapsule(fingerprint);
    const roots = await inspectRootsAtFrames(workspaceRoot, capsule,
      cases.map(item => item.frame), settings);
    for (const expected of cases) {
      const root = roots.get(expected.frame);
      const selected = root.candidates.find(candidate => {
        const mapped = actionCommand(candidate.actionCode, candidate.argument,
          root.engine.adapter.state);
        return mapped.supported && sameCommand(mapped.command, expected.selectedCommand);
      });
      assert.ok(selected, `${fingerprint}:${expected.frame}`);
      assert.equal(selected.hardCode, HARD_STATUS.ALLOW,
        `${fingerprint}:${expected.frame}:potential FIRE is not Hard`);
      if (expected.verdict === VERDICT.CONFIRMED) {
        assert.notEqual(selected.safetyCode, SAFETY_STATUS.PROVEN_SAFE,
          `${fingerprint}:${expected.frame}:future FIRE omitted`);
        assert.ok(selected.horizonFatalMass > 0 || selected.unknownMass > 0,
          `${fingerprint}:${expected.frame}:missing risk/unknown mass`);
        const simulatorCadenceConflict = fingerprint.startsWith("1723388c") ||
          fingerprint.startsWith("c484c9b0");
        assert.equal(root.diagnostics.enemyCapabilitySupportComplete,
          !simulatorCadenceConflict, `${fingerprint}:${expected.frame}:cadence authority`);
        if (simulatorCadenceConflict) assert.ok(selected.unknownMass > 0,
          `${fingerprint}:${expected.frame}:simulator poison mismatch must stay incomplete`);
      } else assert.notEqual(selected.safetyCode, SAFETY_STATUS.PROVEN_DEAD,
        `${fingerprint}:${expected.frame}:window witness cannot be proven dead`);
    }
  }
});
