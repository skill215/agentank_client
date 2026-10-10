"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { selectCertifiedMissedFire, transition, outcomePoints, summarize } =
  require("../../tools/agentank/diagnostics/semantic-attack-real-event-active-poc");

test("BP146 selects only missed-FIRE roots with executable strict proof", () => {
  const source = [{ key: "a" }, { key: "b" }, { key: "c" }];
  const proofs = [{ key: "a", sourceClass: "MISSED_FIRE",
    goals: [{ executable: true }] },
  { key: "b", sourceClass: "MISSED_FIRE", goals: [{ executable: false }] },
  { key: "c", sourceClass: "HISTORICAL_KILL",
    goals: [{ executable: true }] }];
  assert.deepEqual(selectCertifiedMissedFire(proofs, source)
    .map(item => item.root.key), ["a"]);
});

test("BP146 runtime-independent outcome points keep draws at one half", () => {
  assert.equal(outcomePoints("V2_WIN"), 2);
  assert.equal(outcomePoints("DRAW"), 1);
  assert.equal(outcomePoints("V1_WIN"), 0);
  assert.equal(transition({ outcome: "DRAW" }, { outcome: "V2_WIN" }),
    "DRAW_TO_V2_WIN");
});

test("BP146 summary reconciles paired exact arms and causal direction", () => {
  const arm = outcome => ({ targetSeen: true, rootExact: true,
    hardRejects: 0, rootRestoreFailures: 0, terminal: { outcome } });
  const output = summarize([{ control: arm("V1_WIN"), active: arm("DRAW") },
    { control: arm("V2_WIN"), active: arm("V1_WIN") }]);
  assert.equal(output.rootCount, 2);
  assert.equal(output.exactArmCount, 4);
  assert.equal(output.positiveCount, 1);
  assert.equal(output.negativeCount, 1);
  assert.equal(output.pointDelta, -1);
});
