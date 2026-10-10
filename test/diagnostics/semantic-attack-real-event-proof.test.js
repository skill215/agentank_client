"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, PROOF_STATUS } = (() => {
  const fast = require("../../engine-v2/src/abi/fast-codes");
  const search = require("../../engine-v2/src/abi/search-codes");
  return { ACTION: fast.ACTION, PROOF_STATUS: search.PROOF_STATUS };
})();
const { selectedProofRoots, replayGroupKey, groupRoots, classifyGoal,
  sourceClass, summarize } = require(
  "../../tools/agentank/diagnostics/semantic-attack-real-event-proof");

function root(family, role, exact = true, suffix = "a") {
  return { key: family + suffix, sourceFamily: family,
    proofSelectionRole: role, exact, scenarioFingerprint: "scene",
    attackSeat: 0, seatSkills: ["stun", "poison"], decisionIndex: 3,
    replayPrefix: { candidateActionStream: "AQ==", controlActionStream: "AQ==",
      candidateArguments: [], controlArguments: [] } };
}

test("BP145 selects only exact historical proof pairs and missed FIRE roots", () => {
  const roots = [root("V1_HISTORICAL_FIRE", "POSITIVE_KILL"),
    root("V1_HISTORICAL_FIRE", "MATCHED_NO_KILL", true, "b"),
    root("V1_HISTORICAL_FIRE", "NONE", true, "c"),
    root("V2_MISSED_V1_FIRE", "MISSED_FIRE", true, "d"),
    root("V2_MISSED_V1_FIRE", "MISSED_FIRE", false, "e")];
  assert.deepEqual(selectedProofRoots(roots).map(item => item.key),
    ["V1_HISTORICAL_FIREa", "V1_HISTORICAL_FIREb",
      "V2_MISSED_V1_FIREd"]);
});

test("BP145 replay grouping binds physical match identity and streams", () => {
  const a = root("V2_MISSED_V1_FIRE", "MISSED_FIRE");
  const b = { ...a, key: "b", decisionIndex: 8 };
  const c = { ...a, key: "c", attackSeat: 1 };
  assert.equal(replayGroupKey(a), replayGroupKey(b));
  assert.notEqual(replayGroupKey(a), replayGroupKey(c));
  assert.equal(groupRoots([a, b, c]).size, 2);
});

test("BP145 all-world proof is fail-closed on incomplete or non-proven world", () => {
  const proven = () => ({ supportComplete: true,
    status: PROOF_STATUS.PROVEN });
  assert.equal(classifyGoal([proven(), proven(), proven()]),
    "PROVEN_ALL_WORLDS");
  assert.equal(classifyGoal([proven(), proven(), { supportComplete: true,
    status: PROOF_STATUS.UNKNOWN }]), "NOT_PROVEN");
  assert.equal(classifyGoal([proven(), proven(), { supportComplete: false,
    status: PROOF_STATUS.PROVEN }]), "INCOMPLETE");
});

test("BP145 source labels remain validation strata, not proof status", () => {
  assert.equal(sourceClass(root("V1_HISTORICAL_FIRE", "POSITIVE_KILL")),
    "HISTORICAL_KILL");
  assert.equal(sourceClass(root("V1_HISTORICAL_FIRE", "MATCHED_NO_KILL")),
    "MATCHED_NO_KILL");
  assert.equal(sourceClass(root("V2_MISSED_V1_FIRE", "MISSED_FIRE")),
    "MISSED_FIRE");
});

test("BP145 summary cross-tabulates executable proofs by factual source", () => {
  const record = { exact: true, sourceClass: "HISTORICAL_KILL",
    fireGenerated: true, fireHardAllowed: true, totalNodes: 7,
    maximumNodes: 5, budgetStopCount: 0, ttCapacityStopCount: 0,
    supportLossCount: 0, rootRestoreFailureCount: 0, hotAllocationCount: 0,
    goals: [{ name: "SAFE_THREAT_FIRE", classification: "PROVEN_ALL_WORLDS",
      executable: true, variants: [{ supportComplete: true }] },
    { name: "DOOMED_TARGET_FIRE", classification: "NOT_PROVEN",
      executable: false, variants: [{ supportComplete: true }] }] };
  const output = summarize([record]);
  assert.equal(output.rootCount, 1);
  assert.equal(output.executableByGoal.SAFE_THREAT_FIRE, 1);
  assert.equal(output.executableBySourceClass[
    "HISTORICAL_KILL/SAFE_THREAT_FIRE"], 1);
  assert.equal(output.totalNodes, 7);
  assert.equal(output.executableRootCount, 1);
  assert.equal(output.unsafeExecutableCount, 0);
});

test("BP145 incomplete proof is retained but cannot contaminate owner set", () => {
  const record = { key: "incomplete", exact: true, sourceClass: "MISSED_FIRE",
    fireGenerated: true, fireHardAllowed: true, totalNodes: 3,
    maximumNodes: 3, budgetStopCount: 0, ttCapacityStopCount: 0,
    supportLossCount: 1, rootRestoreFailureCount: 0, hotAllocationCount: 0,
    goals: [{ name: "SAFE_THREAT_FIRE", classification: "INCOMPLETE",
      executable: false, variants: [{ supportComplete: false }] }] };
  const output = summarize([record]);
  assert.equal(output.incompleteRootCount, 1);
  assert.equal(output.executableRootCount, 0);
  assert.equal(output.unsafeExecutableCount, 0);
});
