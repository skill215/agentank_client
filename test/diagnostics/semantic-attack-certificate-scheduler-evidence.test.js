"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { needsActionCertificate, schedulerMatches, evaluate } = require(
  "../../tools/agentank/diagnostics/semantic-attack-certificate-scheduler-evidence");

function root(key, options = {}) {
  return { key, sourceClass: options.sourceClass || "TEST",
    label: { safeThreat: options.safeThreat ? 1 : 0,
      doomedTarget: options.doomedTarget ? 1 : 0 },
    features: { clearLineToEnemy: options.clearLine ? 1 : 0,
      selectedIsFire: options.selectedIsFire ? 1 : 0 } };
}

test("BP147B scheduler never invokes proof when FIRE already owns the root", () => {
  const item = root("a", { safeThreat: true, clearLine: true,
    selectedIsFire: true });
  assert.equal(needsActionCertificate(item), false);
  assert.equal(schedulerMatches(item), false);
});

test("BP147B scheduler only gates strict proof and preserves actionable labels", () => {
  const records = [root("p", { safeThreat: true, doomedTarget: true,
    clearLine: true }), root("fp", { clearLine: true }),
  root("tn", { clearLine: false })];
  const proof = new Map([["p", { totalNodes: 8 }],
    ["fp", { totalNodes: 12 }], ["tn", { totalNodes: 80 }]]);
  const output = evaluate(records, proof);
  assert.equal(output.truePositive, 1); assert.equal(output.falsePositive, 1);
  assert.equal(output.falseNegative, 0); assert.equal(output.trueNegative, 1);
  assert.equal(output.doomedActionableCount, 1);
  assert.equal(output.doomedCoveredCount, 1);
  assert.equal(output.allProofNodes, 100);
  assert.equal(output.scheduledProofNodes, 20);
  assert.equal(output.nodeReductionPermille, 800);
});

test("BP147B scheduler metrics expose a missed certificate as failure", () => {
  const records = [root("miss", { safeThreat: true, clearLine: false })];
  const output = evaluate(records, new Map([["miss", { totalNodes: 5 }]]));
  assert.equal(output.falseNegative, 1);
  assert.equal(output.recallPermille, 0);
});
