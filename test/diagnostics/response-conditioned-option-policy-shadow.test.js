"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RiskProfile } = require("../../engine-v2/src/search/risk");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { ROLLOUT_INCOMPLETE_REASON } = require(
  "../../tools/agentank/diagnostics/stateful-option-rollout");
const { POLICY_DIMENSION, POLICY_RELATION,
  ResponseConditionedOptionPolicyShadow } = require(
    "../../tools/agentank/diagnostics/response-conditioned-option-policy-shadow");

function installRollout(rollout) {
  rollout.evaluatePolicy = (_bundle, _action, _argument, kind, enemyAction,
      _enemyArgument, row) => {
    rollout.physicalComplete[row] = 1; rollout.rootRestored[row] = 1;
    rollout.hardFatal[row] = 0; rollout.ownCrashed[row] = 0;
    rollout.terminalUtility[row] = 1; rollout.enemyCrashed[row] =
      kind === 2 && enemyAction === 1 ? 1 : 0;
    rollout.projectileThreat[row] = 0; rollout.enemyMobility[row] = 3;
    rollout.starGain[row] = 0; rollout.starDistance[row] = kind === 1 ? 1 : 2;
    rollout.mobility[row] = 3; rollout.ownFireLane[row] = 0;
    rollout.enemyFireLane[row] = 0;
    rollout.ownProjectileCount[row] = kind === 2 ? 1 : 0;
    rollout.ownBombCount[row] = 0; rollout.transitionCount += 4;
    return 1;
  };
}

function fixture() {
  const interval = { evaluationSerial: 1, lastSelectedRow: 0, lastAttackRow: 1 };
  const shadow = new ResponseConditionedOptionPolicyShadow(interval);
  const rollout = shadow.rollout;
  installRollout(rollout);
  const engine = { ourCount: 2, enemyCount: 2,
    ourActions: Uint8Array.from([1, 4]), ourArguments: new Uint16Array(2),
    enemyActions: Uint8Array.from([1, 2]), enemyArguments: new Uint16Array(2),
    enemyActionFamilies: new Uint8Array(8),
    actionFamilyForShadow: action => action,
    adapter: { enemyVisible: true, tracker: { complete: true }, bundle: {} },
    possibleProjectiles: { count: () => 0 }, hiddenSupportComplete: true,
    hiddenWorldCount: 1, hiddenWorldMass: Uint16Array.from([10000]),
    policy: { baseRisk: 65, opponent: {
      buildNominalPolicy(_families, count, _context, output) {
        output[0] = 8000; output[1] = 2000; return count;
      } } },
    opponentContext: () => 0,
    riskController: { stateRiskClass: 0, riskProfile: new RiskProfile() } };
  return { interval, shadow, rollout, engine };
}

function possibleWorldFixture(injectionSucceeds = true) {
  const built = fixture();
  const shadow = new ResponseConditionedOptionPolicyShadow(null, 4, {
    possibleProjectileWorlds: true
  });
  const rollout = shadow.rollout;
  const scalar = new Uint16Array(32); scalar[0] = 4;
  const poisonUntil = new Uint16Array([255, 255]);
  const poisonApplied = new Uint16Array([255, 255]);
  const state = {
    arrays: [], hashLo: 17, hashHi: 29, deltaUsed: 0, eventUsed: 0,
    transitionDeltaBase: 0, transitionEventBase: 0,
    beginTransition() {
      this.transitionDeltaBase = this.deltaUsed;
      this.transitionEventBase = this.eventUsed;
      return this.deltaUsed * 1024 + this.eventUsed;
    },
    undoTo(mark) {
      this.deltaUsed = (mark / 1024) | 0;
      this.eventUsed = mark - this.deltaUsed * 1024;
      this.hashLo = 17; this.hashHi = 29; return 1;
    }
  };
  // Only cadence-mismatch roots read these arrays.  They are still installed
  // so an accidental read in the ordinary singleton path is deterministic.
  state.arrays[0] = scalar;
  state.arrays[12] = poisonUntil;
  state.arrays[19] = poisonApplied;
  const kernel = { failure: 0, lastMark: 0,
    allocateProjectile() {
      if (!injectionSucceeds) return 0;
      state.deltaUsed = 1; state.hashLo = 31; return 1;
    },
    set() { return 1; }
  };
  const setRow = (kind, row, present) => {
    rollout.physicalComplete[row] = 1; rollout.rootRestored[row] = 1;
    rollout.hardFatal[row] = present && kind === 2 ? 1 : 0;
    rollout.ownCrashed[row] = 0; rollout.terminalUtility[row] = 1;
    rollout.enemyCrashed[row] = !present && kind === 2 ? 1 : 0;
    rollout.projectileThreat[row] = 0; rollout.enemyMobility[row] = 3;
    rollout.starGain[row] = 0; rollout.starDistance[row] = kind === 1 ? 1 : 2;
    rollout.mobility[row] = 3; rollout.ownFireLane[row] = 0;
    rollout.enemyFireLane[row] = 0; rollout.ownProjectileCount[row] = 0;
    rollout.ownBombCount[row] = 0;
  };
  rollout.evaluatePolicy = (_bundle, _action, _argument, kind,
      _enemyAction, _enemyArgument, row) => {
    setRow(kind, row, false);
    for (let step = 0; step < rollout.horizon; step += 1) {
      rollout.sequenceAction[row * rollout.horizon + step] =
        (kind === 1 ? 10 : 20) + step;
      rollout.sequenceArgument[row * rollout.horizon + step] = 100 + step;
    }
    rollout.transitionCount += 4; return 1;
  };
  rollout.evaluatePolicySequence = (_bundle, actions, arguments_, offset, kind,
      _enemyAction, _enemyArgument, row) => {
    assert.equal(actions[offset], kind === 1 ? 10 : 20);
    assert.equal(arguments_[offset], 100);
    setRow(kind, row, true); rollout.transitionCount += 4; return 1;
  };
  built.engine.adapter.bundle = { state, kernel };
  built.engine.adapter.enemyCapabilitySupportComplete = 1;
  built.engine.adapter.enemyCapabilityReason = 0;
  built.engine.adapter.enemyCanAct = true;
  built.engine.enemyCount = 1;
  built.engine.enemyActions = Uint8Array.from([1]);
  built.engine.enemyArguments = new Uint16Array(1);
  built.engine.policy.opponent.buildNominalPolicy =
    (_families, count, _context, output) => {
      output[0] = 10000; return count;
    };
  built.engine.possibleProjectiles = { count: () => 1, pool: {
    complete: 1, active: Uint8Array.from([1]), owner: Uint8Array.from([1]),
    cell: Uint16Array.from([7]), direction: Uint8Array.from([1]),
    group: Uint32Array.from([41]), id: Uint32Array.from([41]),
    member: Uint8Array.from([0])
  } };
  return { shadow, rollout, engine: built.engine, state };
}

test("response-conditioned policy keeps combat and star cost as a tradeoff", () => {
  const built = fixture();
  built.shadow.observe(built.engine); built.shadow.observe(built.engine);
  const summary = built.shadow.summary();
  assert.equal(summary.evaluationCount, 1);
  assert.equal(summary.duplicateSkipCount, 1);
  assert.equal(summary.worldCount, 2);
  assert.equal(summary.currentRiskTradeoffCount, 1);
  assert.equal(summary.lastRelation, POLICY_RELATION.TRADEOFF);
  assert.equal(summary.currentRiskCombatPositiveCount, 1);
  assert.equal(summary.currentRiskStarCostCount, 1);
  assert.equal(summary.lastWorst[POLICY_DIMENSION.ENEMY_CRASH], 0);
  const risk100 = 5 * POLICY_DIMENSION.COUNT + POLICY_DIMENSION.ENEMY_CRASH;
  assert.equal(summary.lastRobust[risk100], 7920);
  assert.equal(summary.transitionCount, 16);
  assert.equal(summary.hotAllocationCount, 0);
});

test("explicit proposal rows publish the exact response-conditioned vector", () => {
  const built = fixture();
  const exact = new ResponseConditionedOptionPolicyShadow(null);
  installRollout(exact.rollout);
  assert.equal(exact.evaluateRows(built.engine, 0, 1), 1);
  const sample = exact.sample();
  assert.equal(sample.complete, true);
  assert.equal(sample.selectedRow, 0);
  assert.equal(sample.attackRow, 1);
  assert.equal(sample.relation, POLICY_RELATION.TRADEOFF);
  assert.equal(sample.robust.length, 6 * POLICY_DIMENSION.COUNT);
  assert.equal(exact.qualifiesCurrentRisk(), 1);
  assert.equal(exact.summary().qualificationCount, 1);
  assert.equal(exact.summary().rowEvaluationRequestCount, 1);
  assert.equal(exact.summary().observationCount, 0);
});

test("qualification requires complete safety and a strict combat improvement", () => {
  const pureStar = fixture();
  pureStar.rollout.evaluatePolicy = (_bundle, _action, _argument, kind,
      _enemyAction, _enemyArgument, row) => {
    pureStar.rollout.physicalComplete[row] = 1;
    pureStar.rollout.rootRestored[row] = 1;
    pureStar.rollout.starDistance[row] = kind === 1 ? 1 : 2;
    return 1;
  };
  assert.equal(pureStar.shadow.evaluateRows(pureStar.engine, 0, 1), 1);
  assert.equal(pureStar.shadow.qualifiesCurrentRisk(), 0);
  assert.equal(pureStar.shadow.summary().qualificationCombatBlockedCount, 1);

  const unsafe = fixture();
  const evaluate = unsafe.rollout.evaluatePolicy;
  unsafe.rollout.evaluatePolicy = (...args) => {
    const complete = evaluate(...args);
    if (args[6] === 1) unsafe.rollout.hardFatal[1] = 1;
    return complete;
  };
  assert.equal(unsafe.shadow.evaluateRows(unsafe.engine, 0, 1), 1);
  assert.equal(unsafe.shadow.qualifiesCurrentRisk(), 0);
  assert.equal(unsafe.shadow.summary().qualificationSafetyBlockedCount, 1);
});

test("incomplete response policy fails closed without publishing a relation", () => {
  const built = fixture();
  built.rollout.evaluatePolicy = () => 0;
  assert.equal(built.shadow.observe(built.engine), 0);
  const summary = built.shadow.summary();
  assert.equal(summary.evaluationCount, 0);
  assert.equal(summary.rolloutIncompleteCount, 1);
  assert.equal(summary.physicalIncompleteRootCount, 1);
  assert.equal(summary.rolloutIncompleteRootByReason[
    ROLLOUT_INCOMPLETE_REASON.UNKNOWN], 1);
  assert.equal(summary.rolloutFailureByReason[
    ROLLOUT_INCOMPLETE_REASON.UNKNOWN], 4);
  assert.equal(built.shadow.sample().complete, false);
});

test("hidden and possible-projectile roots do not become exact policy evidence", () => {
  const hidden = fixture(); hidden.engine.adapter.enemyVisible = false;
  hidden.shadow.observe(hidden.engine);
  assert.equal(hidden.shadow.summary().hiddenSkipCount, 1);
  const possible = fixture(); possible.engine.possibleProjectiles.count = () => 1;
  possible.shadow.observe(possible.engine);
  assert.equal(possible.shadow.summary().possibleProjectileSkipCount, 1);
});

test("singleton possible projectile replays one common own policy and uses the worse world", () => {
  const built = possibleWorldFixture();
  assert.equal(built.shadow.evaluateRows(built.engine, 0, 1), 1);
  assert.equal(built.shadow.qualifiesCurrentRisk(), 0);
  const summary = built.shadow.summary();
  assert.equal(summary.possibleWorldAttemptCount, 1);
  assert.equal(summary.possibleWorldCompleteCount, 1);
  assert.equal(summary.possibleWorldCommonSequenceCount, 2);
  assert.equal(summary.worldCount, 2);
  assert.equal(summary.lastWorst[POLICY_DIMENSION.NONLOSS], -10000);
  assert.equal(summary.qualificationSafetyBlockedCount, 1);
  assert.equal(summary.possibleWorldRootRestoreFailureCount, 0);
  assert.equal(built.state.hashLo, 17);
  assert.equal(built.state.deltaUsed, 0);
});

test("possible projectile injection failure stays incomplete", () => {
  const built = possibleWorldFixture(false);
  assert.equal(built.shadow.evaluateRows(built.engine, 0, 1), 0);
  const summary = built.shadow.summary();
  assert.equal(summary.possibleWorldAttemptCount, 1);
  assert.equal(summary.possibleWorldCompleteCount, 0);
  assert.equal(summary.possibleWorldIncompleteCount, 1);
  assert.equal(summary.possibleWorldInjectionFailureCount, 1);
  assert.equal(summary.evaluationCount, 0);
  assert.equal(built.state.hashLo, 17);
});

test("possible response does not collapse multiple projectile tracks", () => {
  const built = possibleWorldFixture();
  built.engine.possibleProjectiles.count = () => 2;
  built.engine.possibleProjectiles.pool.active = Uint8Array.from([1, 1]);
  built.engine.possibleProjectiles.pool.owner = Uint8Array.from([1, 1]);
  assert.equal(built.shadow.evaluateRows(built.engine, 0, 1), 0);
  const summary = built.shadow.summary();
  assert.equal(summary.possibleWorldAttemptCount, 0);
  assert.equal(summary.possibleWorldUnsupportedCount, 1);
  assert.equal(summary.possibleProjectileSkipCount, 1);
});

test("GO/GO RuleVariant envelope recovers only diagnostic evidence with one common own policy", () => {
  const bundle = fast.createFastPhysical(physical({
    map: { width: 7, height: 5, terrainColumnMajor: boxedMap(7, 5) },
    tanks: [tank(0, [2, 2], "right", { stars: 1, runtimeMs: 10 }),
      tank(1, [4, 2], "left", { stars: 0, runtimeMs: 20 })],
    star: { cell: [1, 1] }
  }));
  const signature = bundle.state.rootSignature();
  const shadow = new ResponseConditionedOptionPolicyShadow(null, 4, {
    moveContestVariantEnvelope: true
  });
  const engine = { ourCount: 2, enemyCount: 1,
    ourActions: Uint8Array.from([fast.ACTION.GO, fast.ACTION.FIRE]),
    ourArguments: new Uint16Array(2),
    enemyActions: Uint8Array.from([fast.ACTION.GO]),
    enemyArguments: new Uint16Array(1),
    enemyActionFamilies: new Uint8Array(8),
    actionFamilyForShadow: action => action,
    adapter: { enemyVisible: true, tracker: { complete: true }, bundle },
    possibleProjectiles: { count: () => 0 }, hiddenSupportComplete: true,
    hiddenWorldCount: 1, hiddenWorldMass: Uint16Array.from([10000]),
    policy: { baseRisk: 65, opponent: {
      buildNominalPolicy(_families, count, _context, output) {
        output[0] = 10000; return count;
      } } },
    opponentContext: () => 0,
    riskController: { stateRiskClass: 0, riskProfile: new RiskProfile() } };
  assert.equal(shadow.evaluateRows(engine, 0, 1), 0);
  assert.equal(shadow.lastEvaluationStatus, 8);
  assert.equal(bundle.state.rootSignature(), signature);
  const envelope = shadow.summary().moveContestVariantEnvelope;
  assert.equal(envelope.attemptCount, 1);
  assert.equal(envelope.completeCount, 1);
  assert.equal(envelope.recoveredCount, 1);
  assert.equal(envelope.incompleteCount, 0);
  assert.deepEqual(envelope.completeByVariant, [0, 1, 1, 1]);
  assert.equal(envelope.commonOwnPolicyAcrossVariants, true);
  assert.equal(envelope.commonSequenceReplayCount, 4);
  assert.equal(envelope.rootRestoreFailureCount, 0);
  // Recovery stays auxiliary: the parent does not publish COMPLETE or become
  // an action owner merely because all diagnostic RuleVariants completed.
  assert.equal(shadow.qualifiesCurrentRisk(), 0);
});
