"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const calibration = require("../../tools/agentank/diagnostics/minimax-depth-calibration");
const { ProductionDepthSearch, DEPTH_VALUE_MIN } = require(
  "../../engine-v2/src/search/production-depth-search");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { RUNTIME_CONFIG } = require("../../engine-v2/src/generated/runtime-config");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { SUPPORT_STATUS } = require("../../engine-v2/src/runtime/escape-obligation");
const { SAFETY_STATUS } = require(
  "../../engine-v2/src/search/information-safety-closure");

test("HP30 production defaults to the compact Risk frontier with an explicit full-domain switch", () => {
  assert.equal(new ProductionRootEngine().compactPhysicalRiskFrontierEnabled, 1);
  assert.equal(new ProductionRootEngine({ diagnosticCompactPhysicalRiskFrontier: false })
    .compactPhysicalRiskFrontierEnabled, 0);
});

function searchScenario(rows = null) {
  const prepared = calibration.preparedScenario(4, true);
  const search = new ProductionDepthSearch(new ProductionCacheBank(), RUNTIME_CONFIG,
    prepared.engine.rootTransitions, { selectiveContinuationEnabled: true,
      windowedBoundsEnabled: true, diagnosticNodeCapacity: 2048 });
  search.search(prepared.bundle, prepared.engine.ourActions, prepared.engine.ourArguments,
    prepared.ourCount, prepared.engine.enemyActions, prepared.engine.enemyArguments,
    prepared.engine.enemyCount, 2, 2048, 50, 0, rows, rows ? rows.length : 0);
  return { prepared, search };
}

test("HP30 sparse root domain preserves exact included P2 cells and full slab identity", () => {
  const full = searchScenario(); const rows = Uint8Array.from([0, 2, 4]);
  const compact = searchScenario(rows);
  assert.equal(full.search.representativeSupportDepth, 2);
  assert.equal(compact.search.representativeSupportDepth, 2);
  assert.equal(compact.search.rootDomainRestricted, 1);
  assert.equal(compact.search.rootOurCount, rows.length);
  assert.equal(compact.prepared.engine.rootTransitions.ourCount, compact.prepared.ourCount);
  assert.ok(compact.search.nodes < full.search.nodes);
  compact.search.expandRootDomain();
  assert.equal(compact.search.rootOurCount, compact.prepared.ourCount);
  for (const row of rows) {
    assert.equal(compact.search.rootScore[row], full.search.rootScore[row]);
    for (let column = 0; column < compact.prepared.engine.enemyCount; column += 1) {
      const at = row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column;
      assert.equal(compact.search.rootCellScore[at], full.search.rootCellScore[at]);
    }
  }
  for (let row = 0; row < compact.prepared.ourCount; row += 1)
    if (!rows.includes(row)) assert.equal(compact.search.rootScore[row], DEPTH_VALUE_MIN);
  assert.equal(compact.search.rootRestoreFailures, 0);
});

test("HP30 sparse root evidence expires at the next reset", () => {
  const rows = Uint8Array.from([0, 2, 4]);
  const compact = searchScenario(rows);
  compact.search.expandRootDomain();
  assert.equal(compact.search.rootDomainRestricted, 1);
  compact.search.resetRoot();
  assert.equal(compact.search.rootDomainRestricted, 0);
  assert.equal(compact.search.rootDomainActive, 0);
  assert.equal(compact.search.rootDomainRows, null);
  assert.equal(compact.search.rootDomainOriginalCount, 0);
  assert.equal(compact.search.rootDomainEvaluatedCount, 0);
});

test("HP30 pre-search domain keeps only the least-risk committed rescue when Risk has no intersection", () => {
  const prepared = calibration.preparedScenario(4, true);
  const engine = prepared.engine; const count = 2;
  engine.hardStatus.fill(HARD_STATUS.ALLOW, 0, count);
  const safety = engine.safetyClosure.outcome; safety.reset(count);
  safety.status[0] = SAFETY_STATUS.PROVEN_SAFE; safety.coverage[0] = 10000;
  safety.status[1] = SAFETY_STATUS.POSSIBLE_DEATH;
  safety.immediateFatalMass[1] = 10000; safety.horizonFatalMass[1] = 10000;
  safety.unknownMass[1] = 10000;
  engine.escapeObligation.resetRows(count);
  engine.escapeObligation.supportStatus = SUPPORT_STATUS.COMPLETE;
  engine.escapeObligation.member[1] = 1;
  engine.escapeObligation.firstActionCount = 1;
  engine.escapeObligation.successorProof[1] = 1;
  engine.escapeObligation.successorSlack[1] = 1;
  engine.combat.vector.count = count;
  const domainCount = engine.preparePhysicalSearchDomain(count);
  assert.equal(domainCount, 1);
  assert.deepEqual(Array.from(engine.stageRowMap.subarray(0, domainCount)), [1]);
});
