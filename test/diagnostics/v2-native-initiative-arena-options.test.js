"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CANDIDATE, engineOptions } = require(
  "../../tools/agentank/diagnostics/v2-native-initiative-arena");

test("BP5 forwards the bounded-policy tactical contact mask into ProductionRoot", () => {
  const argv = process.argv;
  try {
    process.argv = argv.concat(["--bounded-policy-tactical-contact-mask", "1"]);
    const options = engineOptions(CANDIDATE.NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE);
    assert.equal(options.diagnosticExpandedTacticalContactMask, 1);
  } finally {
    process.argv = argv;
  }
});

test("BP154 combat-gated support restoration enables no nominal approximation", () => {
  const options = engineOptions(CANDIDATE.REFUTED_POSSIBLE_PHYSICAL_COMBAT);
  assert.equal(options.diagnosticRefutedPossiblePhysicalSearch, true);
  assert.equal(options.diagnosticRefutedPossiblePhysicalCombatOnly, true);
  assert.equal(options.diagnosticNominalPhysicalCombatOnly, undefined);
  assert.equal(options.diagnosticVisibleNominalPhysicalSearch, undefined);
  assert.equal(options.diagnosticInformationEvidenceSearch, undefined);
});

test("BP155 FIRE verifier suppresses global Physical value ownership", () => {
  const options = engineOptions(CANDIDATE.REFUTED_POSSIBLE_FIRE_VERIFIER);
  assert.equal(options.diagnosticRefutedPossiblePhysicalSearch, true);
  assert.equal(options.diagnosticRefutedPossiblePhysicalCombatOnly, true);
  assert.equal(options.diagnosticRefutedPossiblePhysicalVerifierOnly, true);
  assert.equal(options.diagnosticVisibleNominalPhysicalSearch, undefined);
});
