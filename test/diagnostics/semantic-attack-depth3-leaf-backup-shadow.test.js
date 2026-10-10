"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { FAST_UNSUPPORTED_REASON } = require("../../engine-v2/src/fast/kernel");
const { fast, physical } = require("../imp3/helpers");
const { PAIR_RELATION } = require(
  "../../tools/agentank/diagnostics/native-attack-pose-policy-search-poc");
const { WIDTH_LANE, TRANSITION_DETAIL_FIELD } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-width-shadow");
const { VARIANT_COMMON_STATUS } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-move-variant-shadow");
const { LEAF_LANE, LEAF_LANE_COUNT, laneOptions, relation,
  SemanticAttackDepth3LeafBackupShadow } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-leaf-backup-shadow");

function policy(value) {
  const size = SEARCH_CAPACITY.MAX_OUR_ACTIONS *
    SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
  const baseline = new Int16Array(size); const candidate = new Int16Array(size);
  baseline[0] = 1; baseline[1] = 3;
  candidate[SEARCH_CAPACITY.MAX_ENEMY_POLICIES] = 4;
  candidate[SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1] = 2;
  return { searchEngine: { rootCellScore: candidate,
    cacheBank: { beginMatch() {} }, hotAllocationCount: 0 },
  baselineSearch: { rootCellScore: baseline,
    cacheBank: { beginMatch() {} }, hotAllocationCount: 0 },
  hotAllocationCount: 0, lastBaselineValue: 10, lastBestValue: 20,
  lastBaselineNodes: 4, lastCandidateNodes: 5,
  comparePair() { return value; } };
}

function widthGap() {
  const lastComplete = new Uint8Array(4);
  lastComplete[WIDTH_LANE.W4_B4096] = 0;
  const detail = new Uint16Array(TRANSITION_DETAIL_FIELD.COUNT);
  detail[TRANSITION_DETAIL_FIELD.FIRST_FAST_REASON] =
    FAST_UNSUPPORTED_REASON.JOINT_TANK_RELOCATION;
  return { lastComplete, lastBaselineTransitionDetail: detail,
    lastCandidateTransitionDetail:
      new Uint16Array(TRANSITION_DETAIL_FIELD.COUNT) };
}

test("BP135 lane contracts preserve FULL and isolate history/zero leaf", () => {
  assert.equal(laneOptions(LEAF_LANE.FULL).leafMask, undefined);
  assert.equal(laneOptions(LEAF_LANE.NO_HISTORY).historyEnabled, false);
  assert.equal(laneOptions(LEAF_LANE.ZERO_LEAF).leafMask, 0);
  assert.equal(relation(3, 2), PAIR_RELATION.CANDIDATE_HIGHER);
  assert.equal(relation(2, 2), PAIR_RELATION.EQUAL);
  assert.equal(relation(1, 2), PAIR_RELATION.CANDIDATE_LOWER);
});

test("BP135 shadow keeps variants separate and audits root backup", () => {
  const policies = [];
  for (let lane = 0; lane < LEAF_LANE_COUNT; lane += 1)
    for (let variant = 0; variant < 3; variant += 1)
      policies.push(policy(lane === LEAF_LANE.NO_STAR ?
        PAIR_RELATION.EQUAL : PAIR_RELATION.CANDIDATE_HIGHER));
  const shadow = new SemanticAttackDepth3LeafBackupShadow({}, { policies });
  const bundle = fast.createFastPhysical(physical());
  const engine = { adapter: { bundle }, depthSearch: {}, enemyCount: 2 };
  shadow.evaluate(engine, {}, 2, 0, 1, new Uint8Array([1, 1]), widthGap());
  assert.equal(shadow.attemptCount, 1);
  assert.equal(shadow.lastCommonStatus[LEAF_LANE.FULL],
    VARIANT_COMMON_STATUS.AGREEMENT);
  assert.equal(shadow.lastCommonRelation[LEAF_LANE.NO_STAR],
    PAIR_RELATION.EQUAL);
  assert.deepEqual(Array.from(shadow.lastBaselineMean), [2, 2, 2]);
  assert.deepEqual(Array.from(shadow.lastCandidateMean), [3, 3, 3]);
  assert.deepEqual(Array.from(shadow.lastColumnHigher), [1, 1, 1]);
  assert.deepEqual(Array.from(shadow.lastColumnLower), [1, 1, 1]);
  shadow.record(0); const root = shadow.root(0);
  assert.equal(root.lanes.length, LEAF_LANE_COUNT);
  assert.equal(root.backup[0].meanRelation, PAIR_RELATION.CANDIDATE_HIGHER);
  assert.equal(shadow.rootRestoreFailureCount, 0);
  assert.equal(shadow.totalHotAllocationCount(), 0);
});
