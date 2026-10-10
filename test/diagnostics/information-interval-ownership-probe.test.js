"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { INFORMATION_INTERVAL_LOSS, InformationDominanceIntervals,
  InformationIntervalOwnershipProbe } = require(
  "../../tools/agentank/diagnostics/information-interval-ownership-probe");

test("incomplete Information point estimates remain full-range ordering only", () => {
  const bounds = new InformationDominanceIntervals(3);
  bounds.importPointEstimates(new Int32Array([31000, -20000, 400]), 3, false,
    INFORMATION_INTERVAL_LOSS.INPUT_SUPPORT);
  assert.deepEqual(Array.from(bounds.lower), [-32000, -32000, -32000]);
  assert.deepEqual(Array.from(bounds.upper), [32000, 32000, 32000]);
  assert.deepEqual(Array.from(bounds.ordering), [31000, -20000, 400]);
  assert.equal(bounds.bestStrictCandidate(1), -1);
});

test("strict ownership requires candidate lower greater than incumbent upper", () => {
  const bounds = new InformationDominanceIntervals(3);
  bounds.reset(3);
  assert.equal(bounds.setInterval(0, -100, 100), 1);
  assert.equal(bounds.setInterval(1, 101, 900), 1);
  assert.equal(bounds.setInterval(2, 100, 1000), 1);
  assert.equal(bounds.strictlyDominates(1, 0), 1);
  assert.equal(bounds.strictlyDominates(2, 0), 0);
  assert.equal(bounds.bestStrictCandidate(0), 1);
});

test("exact point estimates can propose but stable equality cannot", () => {
  const bounds = new InformationDominanceIntervals(3);
  bounds.importPointEstimates(new Int32Array([20, 20, 30]), 3, true, 0);
  assert.equal(bounds.strictlyDominates(1, 0), 0);
  assert.equal(bounds.bestStrictCandidate(0), 2);
});

test("probe refuses action ownership when observation policy support is absent", () => {
  const engine = {
    ourCount: 2,
    ourActions: new Uint8Array([1, 3]),
    ourArguments: new Uint16Array([65535, 65535]),
    enemyCount: 4,
    hiddenWorldCount: 1,
    hiddenWorldMass: new Uint16Array([10000]),
    hiddenSupportComplete: 0,
    adapter: { informationComplete: 0, enemyVisible: 1 },
    informationSearch: {
      completedDepth: 2, supportComplete: 0, approximate: 1,
      rootScore: new Int32Array([1200, 9000]),
      lastSelectedWorldCount: 1, lastEffectiveEnemyCount: 2,
      lastContinuationPool: 40, workInterruptedCount: 0,
      rootRestoreFailures: 0
    }
  };
  const probe = new InformationIntervalOwnershipProbe();
  assert.equal(probe.capture(engine, 1, 65535), 1);
  const summary = probe.summary();
  assert.equal(summary.pointEstimateDisagreements, 1);
  assert.equal(summary.strictDominanceProposals, 0);
  assert.equal(summary.fullRangeRows, 2);
  assert.equal(summary.lossCounts.INPUT_SUPPORT, 1);
  assert.equal(summary.lossCounts.ENEMY_COLUMNS, 1);
  assert.equal(summary.lossCounts.OBSERVATION_POLICY, 1);
  assert.equal(summary.policyOnlyRepairableAttempts, 0);
});

test("probe isolates roots blocked only by input composition and common policy", () => {
  const engine = {
    ourCount: 2,
    ourActions: new Uint8Array([1, 3]),
    ourArguments: new Uint16Array([65535, 65535]),
    enemyCount: 2,
    hiddenWorldCount: 1,
    hiddenWorldMass: new Uint16Array([10000]),
    hiddenSupportComplete: 1,
    adapter: { informationComplete: 0, enemyVisible: 1 },
    informationSearch: {
      completedDepth: 2, supportComplete: 0, approximate: 1,
      rootScore: new Int32Array([100, 200]),
      lastSelectedWorldCount: 1, lastEffectiveEnemyCount: 2,
      lastContinuationPool: 40, workInterruptedCount: 0,
      rootRestoreFailures: 0
    }
  };
  const probe = new InformationIntervalOwnershipProbe();
  probe.capture(engine, 1, 65535);
  assert.equal(probe.summary().policyOnlyRepairableAttempts, 1);
  assert.equal(probe.summary().policyOnlyRepairableDisagreements, 1);
  assert.equal(probe.summary().policyOnlyRepairableRows, 2);
  assert.equal(probe.summary().hiddenSupportIncompleteAttempts, 0);
  assert.equal(probe.summary().observationFactIncompleteAttempts, 1);
  assert.equal(probe.summary().geometryCompleteAttempts, 0);
});

test("probe identifies complete depth-one geometry behind unrelated facts", () => {
  const engine = {
    ourCount: 2,
    ourActions: new Uint8Array([1, 3]),
    ourArguments: new Uint16Array([65535, 65535]),
    enemyCount: 2,
    hiddenWorldCount: 1,
    hiddenWorldMass: new Uint16Array([10000]),
    hiddenSupportComplete: 1,
    adapter: { informationComplete: 0, enemyVisible: 1 },
    informationSearch: {
      completedDepth: 1, supportComplete: 0, approximate: 1,
      rootScore: new Int32Array([100, 200]),
      lastSelectedWorldCount: 1, lastEffectiveEnemyCount: 2,
      lastContinuationPool: 0, workInterruptedCount: 0,
      rootRestoreFailures: 0
    }
  };
  const probe = new InformationIntervalOwnershipProbe();
  probe.capture(engine, 1, 65535);
  assert.equal(probe.summary().geometryCompleteAttempts, 1);
  assert.equal(probe.summary().geometryCompleteDisagreements, 1);
  assert.equal(probe.summary().geometryCompleteRows, 2);
  assert.equal(probe.summary().strictDominanceProposals, 0);
});
