"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EVENT_GOAL } = require(
  "../../tools/agentank/diagnostics/semantic-attack-event-horizon-shadow");
const { OneDeviationAttackEventProof } = require(
  "../../tools/agentank/diagnostics/semantic-attack-one-deviation-event-proof");

test("one-deviation event proof uses fixed explicit TT and no hot objects", () => {
  const search = new OneDeviationAttackEventProof(
    EVENT_GOAL.SAFE_THREAT_FIRE, 1024, 4096);
  assert.equal(search.ttDepth.length, 4096);
  assert.equal(search.ttConsumesDeviation.length, 4096);
  assert.equal(search.deviationSelectedCount, 0);
  assert.equal(search.hotAllocationCount, 0);
});

test("one-deviation event proof rejects non-power-of-two TT capacity", () => {
  assert.throws(() => new OneDeviationAttackEventProof(
    EVENT_GOAL.SAFE_THREAT_FIRE, 1024, 3000),
  /BP143_TT_CAPACITY_POWER_OF_TWO_REQUIRED/);
});

test("exported continuation policy contains only proven TT entries", () => {
  const search = new OneDeviationAttackEventProof(
    EVENT_GOAL.SAFE_THREAT_FIRE, 1024, 2048);
  search.ttDepth[7] = 7;
  search.ttStatus[7] = 1;
  search.ttSemanticLo[7] = 11; search.ttSemanticHi[7] = 12;
  search.ttPolicyAction[7] = 3; search.ttPolicyArgument[7] = 99;
  search.ttConsumesDeviation[7] = 1;
  search.ttDepth[9] = 6; search.ttStatus[9] = 2;
  assert.deepEqual(search.exportPolicyEntries(), [{ semanticLo: 11,
    semanticHi: 12, depth: 3, deviationAvailable: 1,
    action: 3, argument: 99, consumesDeviation: 1 }]);
});
