"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { emptyExecutablePolicies, selectActionable, summarize } = require(
  "../../tools/agentank/diagnostics/semantic-attack-actionable-certificate-active-poc");

function proof(key, executable = true, entries = []) {
  return { key, sourceClass: "MISSED_FIRE", goals: [{
    name: "SAFE_THREAT_FIRE", executable,
    mergedPolicy: executable ? { entries } : null }] };
}

test("BP148 selects strict non-FIRE certificates and rejects policy suffixes", () => {
  const proofs = [proof("a"), proof("b"), proof("c", false)];
  const sources = [{ key: "a" }, { key: "b" }, { key: "c" }];
  const census = [{ key: "a", label: { safeThreat: 1 },
    features: { selectedIsFire: 0 } },
  { key: "b", label: { safeThreat: 1 }, features: { selectedIsFire: 1 } },
  { key: "c", label: { safeThreat: 0 }, features: { selectedIsFire: 0 } }];
  assert.deepEqual(selectActionable(proofs, sources, census)
    .map(item => item.root.key), ["a"]);
  assert.equal(emptyExecutablePolicies(proof("x", true, [])), true);
  assert.equal(emptyExecutablePolicies(proof("x", true, [{ hashLo: 1 }])), false);
});

test("BP148 summary reconciles action identity and causal directions", () => {
  const arm = (outcome, action = 2) => ({ targetSeen: true, rootExact: true,
    preOverrideAction: action, fireHardAllowed: true, hardRejects: 0,
    rootRestoreFailures: 0, terminal: { outcome } });
  const records = [{ sourceClass: "A", expectedPreOverrideAction: 2,
    control: arm("V1_WIN"), active: arm("V2_WIN") },
  { sourceClass: "B", expectedPreOverrideAction: 2,
    control: arm("DRAW"), active: arm("V1_WIN") }];
  const output = summarize(records);
  assert.equal(output.exactArmCount, 4);
  assert.equal(output.preOverrideMismatchCount, 0);
  assert.equal(output.positiveCount, 1); assert.equal(output.negativeCount, 1);
  assert.equal(output.pointDelta, 1);
});
