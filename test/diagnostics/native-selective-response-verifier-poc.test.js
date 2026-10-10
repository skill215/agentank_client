"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, NONE_CELL } = require(
  "../../engine-v2/src/abi/fast-codes");
const { CERTIFICATE_CLASS, ROOT_VALUE_RELATION,
  NativeSelectiveResponseVerifierPoc } = require(
  "../../tools/agentank/diagnostics/native-selective-response-verifier-poc");
const { MASS_INDEX } = require(
  "../../tools/agentank/diagnostics/native-long-option-response-mass-poc");
const { NativeHostContinuationStunVerifierPoc } = require(
  "../../tools/agentank/diagnostics/native-host-continuation-stun-verifier-poc");

test("selective response verifier preserves host action in shadow", () => {
  const verifier = new NativeSelectiveResponseVerifierPoc("shadow");
  const resolved = { action: ACTION.FIRE, argument: NONE_CELL, row: 4 };
  assert.strictEqual(verifier.closeHostOverride(null, ACTION.GO, NONE_CELL,
    resolved), resolved);
  assert.equal(verifier.responseOwnershipActive, 0);
});

test("selective response verifier only enables ownership in active mode", () => {
  assert.equal(new NativeSelectiveResponseVerifierPoc("off").mode, "off");
  assert.equal(new NativeSelectiveResponseVerifierPoc("shadow").mode, "shadow");
  assert.equal(new NativeSelectiveResponseVerifierPoc("active")
    .responseOwnershipActive, 1);
  const strict = new NativeSelectiveResponseVerifierPoc("strict-active");
  assert.equal(strict.responseOwnershipActive, 1);
  assert.equal(strict.strictResponseOwnership, 1);
  const value = new NativeSelectiveResponseVerifierPoc("value-active");
  assert.equal(value.responseOwnershipActive, 1);
  assert.equal(value.valueResponseOwnership, 1);
  const guarded = new NativeSelectiveResponseVerifierPoc("guarded-shadow");
  assert.equal(guarded.responseOwnershipActive, 0);
  assert.equal(guarded.hostClosureActive, 1);
});

test("guarded selective verifier closes unsafe host overrides", () => {
  const verifier = new NativeSelectiveResponseVerifierPoc("guarded-shadow");
  const engine = {
    ourCount: 2,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.TURN_LEFT]),
    ourArguments: Uint16Array.from([NONE_CELL, NONE_CELL]),
    diagnosticInternalSelectedIndex: 1,
    adapter: { bundle: {} },
    finalGate: { finalAllows(bundle, actions, args, row) { return row === 1; } }
  };
  const closed = verifier.closeHostOverride(engine, ACTION.TURN_LEFT,
    NONE_CELL, { action: ACTION.GO, argument: NONE_CELL, row: 0 });
  assert.equal(closed, null);
  assert.equal(verifier.hostFinalRejectCount, 1);
  assert.equal(verifier.hostFinalFallbackCount, 1);
});

test("selective verifier proves only a first-action intervention", () => {
  const verifier = new NativeSelectiveResponseVerifierPoc("shadow");
  assert.ok(verifier.full instanceof NativeHostContinuationStunVerifierPoc);
  assert.equal(verifier.full.basePolicyId, verifier.full.candidatePolicyId);
  const summary = verifier.summary();
  assert.equal(summary.firstActionInterventionOnly, true);
  assert.equal(summary.sharedHostContinuation, true);
});

test("selective verifier exposes root-value proposal diagnostics", () => {
  const verifier = new NativeSelectiveResponseVerifierPoc("shadow", {
    candidateProposalMode: "root-value"
  });
  verifier.policy[0].rootValueProposalCount = 7;
  verifier.policy[0].rootValueProposalMissingCount = 2;
  verifier.full.rootValueProposalCount = 3;
  verifier.full.rootValueProposalMissingCount = 1;
  const summary = verifier.summary();
  assert.equal(summary.candidateProposalMode, "root-value");
  assert.equal(summary.rootValueProposalCount, 7);
  assert.equal(summary.rootValueProposalMissingCount, 2);
  assert.equal(summary.verifierRootValueProposalCount, 3);
  assert.equal(summary.verifierRootValueProposalMissingCount, 1);
});

test("certificate audit separates strict closure from nominal mass", () => {
  const verifier = new NativeSelectiveResponseVerifierPoc("shadow");
  const bit = index => 1 << index;
  verifier.full.baseMask = bit(MASS_INDEX.OPEN) | bit(MASS_INDEX.POLICY_LOSS);
  verifier.full.candidateMask = bit(MASS_INDEX.WIN);
  assert.equal(verifier.certificateClass(),
    CERTIFICATE_CLASS.TERMINAL_WIN_CLOSURE);

  verifier.full.candidateMask = bit(MASS_INDEX.OPEN);
  assert.equal(verifier.certificateClass(),
    CERTIFICATE_CLASS.HORIZON_FAILURE_ELIMINATION);

  verifier.full.baseMask = bit(MASS_INDEX.OPEN) | bit(MASS_INDEX.DEATH) |
    bit(MASS_INDEX.POLICY_LOSS);
  verifier.full.candidateMask = bit(MASS_INDEX.OPEN) | bit(MASS_INDEX.DEATH);
  assert.equal(verifier.certificateClass(),
    CERTIFICATE_CLASS.FAILURE_SUPPORT_REDUCTION);

  verifier.full.baseMask = bit(MASS_INDEX.OPEN) | bit(MASS_INDEX.DEATH);
  verifier.full.candidateMask = verifier.full.baseMask;
  assert.equal(verifier.certificateClass(),
    CERTIFICATE_CLASS.NOMINAL_MASS_ONLY);

  verifier.full.candidateMask = bit(MASS_INDEX.OPEN) | bit(MASS_INDEX.WIN) |
    bit(MASS_INDEX.DEATH);
  assert.equal(verifier.certificateClass(),
    CERTIFICATE_CLASS.OUTCOME_MASK_CHANGE);
});

test("root value cross-check reuses prepared V1-shaped search values", () => {
  const verifier = new NativeSelectiveResponseVerifierPoc("shadow");
  const engine = { ourCount: 3,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.GO, ACTION.FIRE]),
    ourArguments: Uint16Array.from([NONE_CELL, NONE_CELL, NONE_CELL]) };
  const search = { representativeSupportComplete: 1,
    rootDomainMask: Uint8Array.from([1, 1, 1]),
    rootScore: Int32Array.from([40, 60, 70]) };
  assert.equal(verifier.rootValueRelation(engine, search, ACTION.GO,
    NONE_CELL, 2), ROOT_VALUE_RELATION.CANDIDATE_HIGHER);
  search.rootScore[2] = 55;
  assert.equal(verifier.rootValueRelation(engine, search, ACTION.GO,
    NONE_CELL, 2), ROOT_VALUE_RELATION.CANDIDATE_LOWER);
  search.representativeSupportComplete = 0;
  assert.equal(verifier.rootValueRelation(engine, search, ACTION.GO,
    NONE_CELL, 2), ROOT_VALUE_RELATION.UNAVAILABLE);
});
