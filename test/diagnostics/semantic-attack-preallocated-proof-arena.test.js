"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { EVENT_GOAL } = require(
  "../../tools/agentank/diagnostics/semantic-attack-event-horizon-shadow");
const { OneDeviationAttackEventProof } = require(
  "../../tools/agentank/diagnostics/semantic-attack-one-deviation-event-proof");
const { resizeProofTransposition, classifyVariants, ownedTypedArrayBytes,
  expectedClassification } = require(
  "../../tools/agentank/diagnostics/semantic-attack-preallocated-proof-arena");

test("BP149 compact TT resizes every identity and policy array together", () => {
  const search = new OneDeviationAttackEventProof(
    EVENT_GOAL.SAFE_THREAT_FIRE, 64, 2048);
  resizeProofTransposition(search, 64);
  for (const key of ["ttLo", "ttHi", "ttSemanticLo", "ttSemanticHi",
    "ttDepth", "ttStatus", "ttPolicyAction", "ttPolicyArgument",
    "ttConsumesDeviation"])
    assert.equal(search[key].length, 64, key);
  assert.throws(() => resizeProofTransposition(search, 48),
    /BP149_TT_CAPACITY_POWER_OF_TWO_REQUIRED/);
});

test("BP149 three-world classification is strict and fail-closed", () => {
  assert.equal(classifyVariants(new Uint8Array([
    PROOF_STATUS.PROVEN, PROOF_STATUS.PROVEN, PROOF_STATUS.PROVEN]),
  new Uint8Array([1, 1, 1])), "PROVEN_ALL_WORLDS");
  assert.equal(classifyVariants(new Uint8Array([
    PROOF_STATUS.PROVEN, PROOF_STATUS.DISPROVEN, PROOF_STATUS.PROVEN]),
  new Uint8Array([1, 1, 1])), "NOT_PROVEN");
  assert.equal(classifyVariants(new Uint8Array([
    PROOF_STATUS.PROVEN, PROOF_STATUS.PROVEN, PROOF_STATUS.PROVEN]),
  new Uint8Array([1, 0, 1])), "INCOMPLETE");
});

test("BP149 owned memory census excludes shared state and deduplicates buffers", () => {
  const shared = { bytes: new Uint8Array(16) };
  const view = new Uint8Array(shared.bytes.buffer, 4, 4);
  const object = { one: new Uint16Array(8), two: view,
    again: view, excluded: shared };
  assert.equal(ownedTypedArrayBytes(object, shared), 16 + 16);
});

test("BP149 expected label reads only SAFE_THREAT_FIRE", () => {
  const proof = { key: "a", goals: [
    { name: "DOOMED_TARGET_FIRE", classification: "NOT_PROVEN" },
    { name: "SAFE_THREAT_FIRE", classification: "PROVEN_ALL_WORLDS" }
  ] };
  assert.equal(expectedClassification(proof), "PROVEN_ALL_WORLDS");
});
