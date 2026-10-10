"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionRootEngine } =
  require("../../engine-v2/src/runtime/production-root");
const { SelectiveInformationSearchProbe } =
  require("../../tools/agentank/diagnostics/selective-information-search-probe");

test("selective Information probe allocates only at construction and starts empty", () => {
  const engine = new ProductionRootEngine();
  const probe = new SelectiveInformationSearchProbe(engine, 3);
  assert.equal(probe.shallow.maximumEnemyColumns, 4);
  assert.equal(probe.deep.maximumEnemyColumns, 4);
  assert.deepEqual(probe.summary(), {
    contenderCount: 3,
    attempts: 0,
    shallowComplete: 0,
    compactComplete: 0,
    fullWinnerInTop1: 0,
    fullWinnerInTop2: 0,
    fullWinnerInTop3: 0,
    selectedInTop3: 0,
    fullWinnerInContenders: 0,
    selectedInContenders: 0,
    compactWinnerAgreement: 0,
    fullWinnerRankCounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    selectedRankCounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    marginThresholds: [0, 250, 500, 1000, 2000, 4000, 8000, 16000, 64000],
    marginContenderTotal: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    marginFullWinnerIncluded: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    marginSelectedIncluded: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    depthDeltaAbsoluteTotal: 0,
    depthDeltaAbsoluteMaximum: 0,
    rootRestoreFailures: 0,
    fullNodes: 0,
    shallowNodes: 0,
    compactNodes: 0,
    estimatedSharedNodes: 0,
    nodeRatioBasisPoints: 0,
    hotAllocationCount: 0
  });
});

test("selective Information probe clamps contender width to fixed capacity", () => {
  const engine = new ProductionRootEngine();
  assert.equal(new SelectiveInformationSearchProbe(engine, 0).contenderCount, 1);
  assert.equal(new SelectiveInformationSearchProbe(engine, 99).contenderCount, 12);
});
