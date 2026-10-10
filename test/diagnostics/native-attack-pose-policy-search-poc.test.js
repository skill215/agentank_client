"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, FAST_STATUS, HARD_STATUS, CHANCE, NONE_CELL } = require(
  "../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { NativeAttackPosePolicySearchPoc, PAIR_RELATION,
  PAIR_SUPPORT_REASON, DIAGNOSTIC_FAST_STATUS_CAPACITY,
  DIAGNOSTIC_ACTION_CAPACITY, DiagnosticExpansionDepthSearch } = require(
  "../../tools/agentank/diagnostics/native-attack-pose-policy-search-poc");

function fixture(value) {
  const search = {
    rootRestoreFailures: 0, representativeSupportComplete: 0,
    representativeSupportDepth: 0, nodes: 0,
    rootScore: new Int32Array(8),
    search(bundle, actions, arguments_, count, enemyActions, enemyArguments,
        enemyCount, depth) {
      this.representativeSupportComplete = 1;
      this.representativeSupportDepth = depth; this.nodes = 17;
      this.rootScore[1] = value; return depth;
    },
    expandRootDomain() {}
  };
  const policy = new NativeAttackPosePolicySearchPoc({}, { search, nodeBudget: 128 });
  const engine = {
    depthSearch: { representativeSupportDepth: 2 },
    adapter: { bundle: {} }, ourActions: new Uint8Array(8),
    ourArguments: new Uint16Array(8), enemyActions: new Uint8Array([0]),
    enemyArguments: new Uint16Array([0]), enemyCount: 1,
    hardStatus: new Uint8Array(8), policy: { baseRisk: 20 }
  };
  engine.hardStatus.fill(HARD_STATUS.ALLOW);
  const pose = { supports(row) { return row === 1 ? 1 : 0; },
    betterRow(engine_, left, right) { return right < 0 || left < right; } };
  return { policy, engine, pose };
}

test("policy search owns only strict completed dominance", () => {
  const { policy, engine, pose } = fixture(101);
  const allowed = new Uint8Array(8); allowed[1] = 1;
  assert.equal(policy.select(engine, pose, 3, engine.depthSearch, 0, 100, allowed), 1);
  assert.equal(policy.summary().strictDominanceCount, 1);
  assert.equal(policy.rowValue(1), 101);
  assert.equal(policy.rowValue(0), null);
  assert.equal(policy.summary().lastComplete, 1);
  assert.equal(policy.summary().lastDepth, 2);
});

test("policy search rejects equality and incomplete depth-one support", () => {
  const equal = fixture(100); const allowed = new Uint8Array(8); allowed[1] = 1;
  assert.equal(equal.policy.select(equal.engine, equal.pose, 3,
    equal.engine.depthSearch, 0, 100, allowed), -1);
  equal.engine.depthSearch.representativeSupportDepth = 1;
  assert.equal(equal.policy.select(equal.engine, equal.pose, 3,
    equal.engine.depthSearch, 0, 0, allowed), -1);
  assert.equal(equal.policy.rowValue(1), null);
  assert.equal(equal.policy.summary().depthOneSkipCount, 1);
});

test("paired policy search compares baseline and attack at the same fixed depth", () => {
  const attack = fixture(151); const baselineSearch = {
    rootRestoreFailures: 0, representativeSupportComplete: 0,
    representativeSupportDepth: 0, nodes: 0, rootScore: new Int32Array(8),
    search(bundle, actions, arguments_, count, enemyActions, enemyArguments,
        enemyCount, depth) {
      this.representativeSupportComplete = 1;
      this.representativeSupportDepth = depth; this.nodes = 9;
      this.rootScore[0] = 150; return depth;
    },
    expandRootDomain() {}
  };
  attack.policy.pairedDepth = 2;
  attack.policy.baselineSearch = baselineSearch;
  const allowed = new Uint8Array(8); allowed[1] = 1;
  attack.engine.depthSearch.representativeSupportDepth = 1;
  assert.equal(attack.policy.select(attack.engine, attack.pose, 3,
    attack.engine.depthSearch, 0, -999, allowed), 1);
  assert.equal(attack.policy.summary().pairedCompleteCount, 1);
  assert.equal(attack.policy.summary().lastBaselineValue, 150);
});

test("source-domain-only policy cannot resurrect a Physical-unsearched row", () => {
  const { policy, engine, pose } = fixture(101);
  policy.requireSourceSupport = true;
  engine.depthSearch.rootDomainRestricted = 1;
  engine.depthSearch.rootDomainMask = new Uint8Array(8);
  engine.depthSearch.rootDomainMask[0] = 1;
  const allowed = new Uint8Array(8); allowed[1] = 1;
  assert.equal(policy.select(engine, pose, 3, engine.depthSearch, 0, 100, allowed), -1);
  assert.equal(policy.summary().sourceExcludedCount, 1);
  assert.equal(policy.summary().noDomainCount, 1);
});

test("stationary attack policy uses the same state-feedback action at root", () => {
  const { policy, engine, pose } = fixture(101);
  policy.stationaryRootPolicy = true;
  policy.feedback = { routeAction() { return ACTION.TURN_RIGHT; },
    summary() { return {}; } };
  engine.ourActions[1] = ACTION.GO; engine.ourActions[2] = ACTION.TURN_RIGHT;
  pose.supports = () => 0;
  const allowed = new Uint8Array(8); allowed[1] = 1; allowed[2] = 1;
  // The fake search publishes its value on row 1, so row 2 cannot dominate;
  // the assertion is about the exact root policy domain, not ownership.
  assert.equal(policy.select(engine, pose, 3, engine.depthSearch, 0, 100, allowed), -1);
  assert.equal(policy.lastDomainMask[1], 0);
  assert.equal(policy.lastDomainMask[2], 1);
  assert.equal(policy.summary().lastRootPolicyAction, ACTION.TURN_RIGHT);
});

test("common-continuation compares only the root action under one host policy", () => {
  const policy = new NativeAttackPosePolicySearchPoc({}, {
    nodeBudget: 128, pairedDepth: 2, commonContinuation: true
  });
  assert.equal(policy.feedback, null);
  assert.ok(policy.representative);
  assert.ok(policy.baselineRepresentative);
  assert.equal(policy.summary().commonContinuation, true);
});

test("fixed-pair comparison keeps the candidate identity constant", () => {
  const attack = fixture(151); const baselineSearch = {
    rootRestoreFailures: 0, representativeSupportComplete: 0,
    representativeSupportDepth: 0, nodes: 0, rootScore: new Int32Array(8),
    search(bundle, actions, arguments_, count, enemyActions, enemyArguments,
        enemyCount, depth) {
      this.representativeSupportComplete = 1;
      this.representativeSupportDepth = depth; this.nodes = 9;
      this.rootScore[0] = 150;
    },
    expandRootDomain() {}
  };
  attack.policy.pairedDepth = 3;
  attack.policy.baselineSearch = baselineSearch;
  const allowed = new Uint8Array(8); allowed[0] = 1; allowed[1] = 1;
  assert.equal(attack.policy.comparePair(attack.engine, attack.pose, 3,
    attack.engine.depthSearch, 0, 1, allowed),
  PAIR_RELATION.CANDIDATE_HIGHER);
  assert.equal(attack.policy.lastBestRow, 1);
  assert.equal(attack.policy.lastDepth, 3);
  assert.equal(attack.policy.lastBaselineNodes, 9);
  assert.equal(attack.policy.lastCandidateNodes, 17);
});

test("paired search classifies non-budget exact-support failure", () => {
  const policy = Object.create(NativeAttackPosePolicySearchPoc.prototype);
  policy.nodeBudget = 2048; policy.rootRestoreFailureCount = 0;
  const search = { rootRestoreFailures: 0, incompleteTransitions: 4,
    interruptedCount: 0, exactOwnerEarlyAbortCount: 0,
    lastNonExactAbortReason: 0, completedDepth: 0, attemptedDepth: 0,
    representativeSupportComplete: 0, representativeSupportDepth: 0,
    completedTruncatedCount: 0, iterationTruncatedCount: 0,
    attemptIntervalStatus: 0, nodes: 0,
    search() {
      this.completedDepth = 3; this.attemptedDepth = 3;
      this.representativeSupportComplete = 1;
      this.representativeSupportDepth = 2;
      this.completedTruncatedCount = 1;
      this.iterationTruncatedCount = 1;
      this.attemptIntervalStatus = 2;
      this.incompleteTransitions += 2; this.nodes = 47;
    }, expandRootDomain() {} };
  const engine = { adapter: { bundle: {} }, ourActions: new Uint8Array(2),
    ourArguments: new Uint16Array(2), enemyActions: new Uint8Array(1),
    enemyArguments: new Uint16Array(1), enemyCount: 1,
    policy: { baseRisk: 20 } };
  assert.equal(policy.run(search, engine, 2, 3, new Uint8Array([0]), 1), 0);
  assert.equal(policy.lastRunReasonMask,
    PAIR_SUPPORT_REASON.WIDTH | PAIR_SUPPORT_REASON.TRANSITION |
    PAIR_SUPPORT_REASON.REPRESENTATIVE_DEPTH);
  assert.equal(policy.lastRunIncompleteTransitions, 2);
  assert.equal(policy.lastRunInterrupted, 0);
});

test("diagnostic search attributes nested Fast failure to outer Hard pair", () => {
  const search = new DiagnosticExpansionDepthSearch(new ProductionCacheBank(),
    undefined, null, { diagnosticDeepExpansionLimit: 4 });
  const arrays = []; arrays[ARRAY.SCALAR] = new Uint32Array(64);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 10;
  let applyCount = 0;
  const kernel = { state: { arrays }, failureReason: 0, failureDetail: 0,
    applyFrame(action0, argument0, action1, argument1, chance0, chance1) {
      applyCount += 1;
      if (applyCount === 1) {
        arrays[ARRAY.SCALAR][SCALAR.FRAME] += 1;
        return FAST_STATUS.APPLIED;
      }
      this.failureReason = 3; this.failureDetail = 2;
      return FAST_STATUS.UNSUPPORTED_RULE;
    } };
  const hard = { classifyApplied() {
    kernel.applyFrame(ACTION.TURN_LEFT, NONE_CELL, ACTION.GO, NONE_CELL,
      CHANCE.NORMAL, CHANCE.NORMAL);
    return HARD_STATUS.INCOMPLETE;
  } };
  search.resetDiagnosticTransitionTelemetry({ state: kernel.state });
  search.diagnosticKernel = kernel; search.diagnosticHard = hard;
  search.diagnosticOriginalApplyFrame = kernel.applyFrame;
  search.diagnosticOriginalClassifyApplied = hard.classifyApplied;
  kernel.applyFrame = search.diagnosticApplyFrameWrapper;
  hard.classifyApplied = search.diagnosticClassifyAppliedWrapper;
  assert.equal(kernel.applyFrame(ACTION.FIRE, NONE_CELL, ACTION.GO, NONE_CELL,
    CHANCE.NORMAL, CHANCE.REVERSED), FAST_STATUS.APPLIED);
  assert.equal(hard.classifyApplied(), HARD_STATUS.INCOMPLETE);
  assert.equal(search.diagnosticFirstFastInsideHard, 1);
  assert.equal(search.diagnosticFirstFastStatus, FAST_STATUS.UNSUPPORTED_RULE);
  assert.equal(search.diagnosticFirstFastReason, 3);
  assert.equal(search.diagnosticFirstFastDetail, 2);
  assert.equal(search.diagnosticFastStatusCounts[
    DIAGNOSTIC_FAST_STATUS_CAPACITY + FAST_STATUS.UNSUPPORTED_RULE], 1);
  assert.equal(search.diagnosticHardStatusCounts[HARD_STATUS.INCOMPLETE], 1);
  assert.equal(search.diagnosticFirstHardAction0, ACTION.FIRE);
  assert.equal(search.diagnosticFirstHardAction1, ACTION.GO);
  assert.equal(search.diagnosticHardIncompleteActionPairCounts[
    ACTION.FIRE * DIAGNOSTIC_ACTION_CAPACITY + ACTION.GO], 1);
});
