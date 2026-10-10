"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionDepthSearch, SEARCH_SCHEDULE } =
  require("../../engine-v2/src/search/production-depth-search");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { ACTION, FAST_STATUS, NONE_CELL } =
  require("../../engine-v2/src/abi/fast-codes");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");

const ACTIONS = Uint8Array.from([ACTION.GO, ACTION.TURN_LEFT]);
const ARGUMENTS = new Uint16Array(ACTIONS.length).fill(NONE_CELL);

function fixture() {
  return fast.createFastPhysical(physical({
    platformFrame: 4,
    map: { width: 7, height: 7, terrainColumnMajor: boxedMap(7, 7) },
    tanks: [
      tank(0, [1, 1], "right", { stunUntilFrame: 6, skillReadyFrame: 255 }),
      tank(1, [5, 4], "left", { skillReadyFrame: 255 })
    ],
    star: [3, 3]
  }));
}

function run(directDuringStun, maximumRootNodes) {
  const bundle = fixture();
  assert.equal(bundle.status, FAST_STATUS.APPLIED);
  const root = bundle.state.rootSignature();
  const cache = new ProductionCacheBank();
  const search = new ProductionDepthSearch(cache, undefined, null, {
    directDepthTwoDuringStunEnabled: directDuringStun,
    directDepthTwoStunMaxRootNodes: maximumRootNodes
  });
  search.cache.setEnabled(false);
  search.rootTransitions.setEnabled(false);
  search.search(bundle, ACTIONS, ARGUMENTS, ACTIONS.length,
    ACTIONS, ARGUMENTS, ACTIONS.length, 2, SEARCH_CAPACITY.MAX_NODES, 50, 0);
  assert.equal(search.rootRestoreFailures, 0);
  assert.equal(bundle.state.rootSignature(), root);
  return search;
}

test("HP21 stun Direct-P2 switch is explicit and preserves exact ChanceOutcome value", () => {
  const legacy = run(false);
  const direct = run(true);
  assert.equal(legacy.lastSchedule, SEARCH_SCHEDULE.LEGACY_ITERATIVE);
  assert.equal(direct.lastSchedule, SEARCH_SCHEDULE.DIRECT_DEPTH_TWO);
  assert.equal(direct.directStunRootCount, 1);
  assert.equal(direct.directStunP1Completed, 1);
  assert.equal(direct.directStunP2Completed, 1);
  assert.equal(direct.directStunP2Failed, 0);
  assert.equal(direct.representativeSupportComplete, 1);
  assert.equal(direct.representativeSupportDepth, legacy.representativeSupportDepth);
  assert.equal(direct.bestRow, legacy.bestRow);
  assert.equal(direct.bestValue, legacy.bestValue);
  for (let row = 0; row < ACTIONS.length; row += 1) {
    assert.equal(direct.rootScore[row], legacy.rootScore[row]);
    for (let column = 0; column < ACTIONS.length; column += 1) {
      const cell = row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column;
      assert.equal(direct.rootCellScore[cell], legacy.rootCellScore[cell]);
    }
  }
});

test("HP21 stun Direct-P2 diagnostic counters remain cold by default", () => {
  const legacy = run(false);
  assert.equal(legacy.directDepthTwoDuringStunEnabled, 0);
  assert.equal(legacy.directStunRootCount, 0);
  assert.equal(legacy.directStunP1Completed, 0);
  assert.equal(legacy.directStunP2Completed, 0);
  assert.equal(legacy.directStunP2Failed, 0);
});

test("HP21 selective stun schedule keeps wide ChanceOutcome roots on legacy path", () => {
  const search = run(true, 1);
  assert.equal(search.lastSchedule, SEARCH_SCHEDULE.LEGACY_ITERATIVE);
  assert.equal(search.directStunRootCount, 0);
  assert.equal(search.directStunSizeBlockedCount, 1);
});

test("HP21 production defaults to the 48-node stun gate and keeps a legacy diagnostic", () => {
  const current = new ProductionRootEngine();
  assert.equal(current.depthSearch.directDepthTwoDuringStunEnabled, 1);
  assert.equal(current.depthSearch.directDepthTwoStunMaxRootNodes, 48);
  const legacy = new ProductionRootEngine({ diagnosticDirectDepthTwoDuringStun: false });
  assert.equal(legacy.depthSearch.directDepthTwoDuringStunEnabled, 0);
  assert.equal(legacy.depthSearch.directDepthTwoStunMaxRootNodes, 48);
});
