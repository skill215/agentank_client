"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { ROOT_CONTROL_MODE, ROOT_CONTROL_REASON } = require(
  "../../engine-v2/src/runtime/root-control-mode");
const { SUPPORT_STATUS } = require("../../engine-v2/src/runtime/escape-obligation");
const { SUCCESSOR_PROOF } = require("../../engine-v2/src/fast/deadline-kernel");
const { PAC_STATUS } = require(
  "../../engine-v2/src/search/projectile-attack-closure");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { FastState, ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { NativeTacticalActionOwnerPoc } = require(
  "../../tools/agentank/diagnostics/native-tactical-action-owner-poc");

function engine() {
  const state = new FastState(3, 3);
  return { lastControlMode: ROOT_CONTROL_MODE.TACTICAL_CONTACT,
    adapter: { enemyVisible: true, state }, lastProofStatus: 0,
    lastSelectionWasStrictRescue: false, lastSelectionWasVerifiedDirectKill: false,
    escapeObligation: { committedEntityCount: 0 }, ourCount: 4,
    ourActions: new Uint8Array([ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT, ACTION.NONE]),
    ourArguments: new Uint16Array(4), hardStatus: new Uint8Array([
      HARD_STATUS.ALLOW, HARD_STATUS.ALLOW, HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    projectedCell: new Uint16Array([1, 1, 1, 1]),
    projectedDirection: new Uint8Array([0, 0, 3, 0]),
    riskController: { outcome: { count: 4,
      acceptable: new Uint8Array([1, 1, 1, 1]),
      dominated: new Uint8Array(4) } },
    informationSearch: { completedDepth: 0 }, depthSearch: { completedDepth: 2,
      representativeSupportComplete: 1, rootScore: new Int32Array([5, 9, 7, 0]) } };
}

function attachQualifiedFire(value) {
  value.riskController = { outcome: { count: 4,
    acceptable: new Uint8Array([1, 1, 1, 1]),
    dominated: new Uint8Array(4) } };
  value.combat = { vector: { count: 4,
    purposeCompleteness: new Uint16Array([0, 5000, 0, 0]),
    directKill: new Uint8Array(4),
    possibleHit: new Uint8Array([0, 1, 0, 0]),
    intercept: new Uint8Array(4), aimSetup: new Uint8Array(4),
    postFireEscape: new Uint8Array([0, 1, 0, 0]),
    attackClosureStatus: new Uint8Array(
      [PAC_STATUS.NONE, PAC_STATUS.COMPLETE, PAC_STATUS.NONE, PAC_STATUS.NONE]),
    enemyDoomedFirstActions: new Uint8Array([0, 1, 0, 0]),
    unknownResponseCount: new Uint8Array(4) } };
  value.controlMode = { context: { reason: ROOT_CONTROL_REASON.VISIBLE_NEAR } };
  return value;
}

test("native tactical owner selects maximum complete worst-reply value", () => {
  const poc = new NativeTacticalActionOwnerPoc({ riskFrontierMode: "pareto" });
  assert.deepEqual(poc.selectOverride(engine(), 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(poc.summary().physicalOwnerCount, 1);
});

test("native tactical owner uses stable V1 action priority only for equal values", () => {
  const value = engine(); value.depthSearch.rootScore[0] = 9;
  const poc = new NativeTacticalActionOwnerPoc({ riskFrontierMode: "pareto" });
  assert.deepEqual(poc.selectOverride(value, 1, ACTION.FIRE),
    { action: ACTION.GO, argument: 0 });
  assert.equal(poc.summary().goOverrideCount, 1);
});

test("finite-depth BasePolicy selects only inside the Risk Pareto frontier", () => {
  const value = engine();
  value.depthSearch.rootScore = new Int32Array([5, 90, 7, 0]);
  value.riskController.outcome.dominated[1] = 1;
  const poc = new NativeTacticalActionOwnerPoc({ riskFrontierMode: "pareto" });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.TURN_LEFT, argument: 0 });
  assert.equal(poc.allowedRow[1], 0);
  assert.equal(poc.summary().riskDominatedCount, 1);

  value.riskController.outcome.dominated[1] = 0;
  value.riskController.outcome.acceptable[1] = 0;
  const rejected = new NativeTacticalActionOwnerPoc({
    riskFrontierMode: "acceptable"
  });
  assert.deepEqual(rejected.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.TURN_LEFT, argument: 0 });
  assert.equal(rejected.allowedRow[1], 0);
  assert.equal(rejected.summary().riskRejectedCount, 1);
});

test("finite-depth BasePolicy fails closed when the Risk frontier is unavailable", () => {
  const value = engine(); delete value.riskController;
  const poc = new NativeTacticalActionOwnerPoc({ riskFrontierMode: "pareto" });
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  assert.equal(poc.summary().riskSupportMissingCount, 1);
});

test("intent-known soft Risk band admits only known non-immediate intent members", () => {
  const value = engine();
  value.depthSearch.rootScore = new Int32Array([5, 90, 7, 0]);
  value.riskController.outcome.acceptable[1] = 0;
  value.riskController.outcome.immediateFatalMass = new Uint16Array(4);
  value.riskController.outcome.unknownMass = new Uint16Array(4);
  const intent = { prepare() {}, bonus: row => row === 1 ? 150 : 0,
    member: row => row === 1 ? 1 : 0 };
  const allowed = new NativeTacticalActionOwnerPoc({ intent,
    riskFrontierMode: "joint", riskSoftBandMode: "intent-known" });
  assert.deepEqual(allowed.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(allowed.summary().softRiskIntentAllowedCount, 1);
  assert.equal(allowed.summary().riskRejectedCount, 0);

  value.riskController.outcome.unknownMass[1] = 10000;
  const unknown = new NativeTacticalActionOwnerPoc({ intent,
    riskFrontierMode: "joint", riskSoftBandMode: "intent-known" });
  assert.deepEqual(unknown.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.TURN_LEFT, argument: 0 });
  assert.equal(unknown.summary().softRiskUnknownBlockedCount, 1);
  assert.equal(unknown.summary().riskRejectedCount, 1);
});

test("joint frontier trades accepted risk against value and breaks value ties by risk", () => {
  const value = engine();
  value.riskController.strictlyDominates = (left, right) => left === 0 && right === 1;
  value.riskController.outcome.dominated[1] = 1;
  value.depthSearch.rootScore = new Int32Array([5, 9, 7, 0]);
  const valueLead = new NativeTacticalActionOwnerPoc({ riskFrontierMode: "joint" });
  assert.deepEqual(valueLead.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(valueLead.summary().selectedRiskOnlyDominatedCount, 1);
  assert.equal(valueLead.summary().selectedJointDominatedCount, 0);

  value.depthSearch.rootScore[0] = 9;
  const tied = new NativeTacticalActionOwnerPoc({ riskFrontierMode: "joint" });
  assert.deepEqual(tied.selectOverride(value, 1, ACTION.FIRE),
    { action: ACTION.GO, argument: 0 });
  assert.equal(tied.summary().selectedRiskOnlyDominatedCount, 0);
  assert.equal(tied.summary().selectedJointDominatedCount, 0);
});

test("intent value can be isolated to an exact-value tie", () => {
  const intent = { bonus: row => row ? 100 : 0 };
  const additive = new NativeTacticalActionOwnerPoc({ intent });
  const tied = new NativeTacticalActionOwnerPoc({ intent,
    intentValueMode: "tie" });
  const off = new NativeTacticalActionOwnerPoc({ intent,
    intentValueMode: "off" });
  assert.equal(additive.intentAdjustment(1), 100);
  assert.equal(additive.intentTiePrefers(1, 0), 0);
  assert.equal(tied.intentAdjustment(1), 0);
  assert.equal(tied.intentTiePrefers(1, 0), 1);
  assert.equal(off.intentAdjustment(1), 0);
  assert.equal(off.intentTiePrefers(1, 0), 0);
});

test("split path evidence can break only an exact robust tie", () => {
  const tied = engine();
  tied.depthSearch.rootScore = new Int32Array([100, 100, 90, 0]);
  tied.depthSearch.rootNominalScore = new Int32Array([100, 140, 90, 0]);
  tied.depthSearch.rootNominalCellScore = new Int32Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  const tieOwner = new NativeTacticalActionOwnerPoc();
  assert.deepEqual(tieOwner.selectOverride(tied, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(tieOwner.summary().pathNominalTieBreakCount, 1);

  const robustLead = engine();
  robustLead.depthSearch.rootScore = new Int32Array([101, 100, 90, 0]);
  robustLead.depthSearch.rootNominalScore = new Int32Array([101, 1000, 90, 0]);
  robustLead.depthSearch.rootNominalCellScore = new Int32Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  const leadOwner = new NativeTacticalActionOwnerPoc();
  assert.equal(leadOwner.selectOverride(robustLead, 0, ACTION.GO), null);
  assert.equal(leadOwner.summary().pathNominalTieBreakCount, 0);
});

test("BP6 enemy-disabled FIRE funnel observes selection without changing it", () => {
  const value = engine();
  value.controlMode = { context: { reason: ROOT_CONTROL_REASON.ENEMY_DISABLED } };
  const poc = new NativeTacticalActionOwnerPoc();
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  const summary = poc.summary();
  assert.equal(summary.stunWindowRootCount, 1);
  assert.equal(summary.stunWindowCompleteSearchCount, 1);
  assert.equal(summary.stunWindowFireEligibleCount, 1);
  assert.equal(summary.stunWindowFireMinimaxBestCount, 1);
  assert.equal(summary.stunWindowFireFinalSelectedCount, 1);
  assert.equal(summary.stunWindowIncumbentActionCount[ACTION.GO], 1);
  assert.equal(summary.stunWindowFinalActionCount[ACTION.FIRE], 1);
  assert.equal(summary.stunWindowFireGapHistogram[0], 1);
});

test("BP6 enemy-disabled FIRE funnel distinguishes domain rejection from value loss", () => {
  const value = engine();
  value.controlMode = { context: { reason: ROOT_CONTROL_REASON.ENEMY_DISABLED } };
  const poc = new NativeTacticalActionOwnerPoc({
    domain: { allows(current, row) { return current.ourActions[row] !== ACTION.FIRE; } }
  });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.TURN_LEFT, argument: 0 });
  const summary = poc.summary();
  assert.equal(summary.stunWindowFireEligibleCount, 0);
  assert.equal(summary.stunWindowFireDomainBlockedCount, 1);
  assert.equal(summary.stunWindowFireOwnerDomainBlockedCount, 1);
  assert.equal(summary.stunWindowFireSourceDomainBlockedCount, 0);
  assert.equal(summary.stunWindowFireMinimaxBestCount, 0);
  assert.equal(summary.stunWindowFinalActionCount[ACTION.TURN_LEFT], 1);
});

test("BP7 qualified FIRE audit observes a selected verified attack", () => {
  const value = attachQualifiedFire(engine());
  const poc = new NativeTacticalActionOwnerPoc();
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  const summary = poc.summary();
  assert.equal(summary.qualifiedFireVerifiedCount, 1);
  assert.equal(summary.qualifiedFireMinimaxSelectedCount, 1);
  assert.equal(summary.qualifiedFireFinalSelectedCount, 1);
  assert.equal(summary.qualifiedFireClosureCompleteCount, 1);
  assert.equal(summary.qualifiedFirePossibleHitCount, 1);
  assert.equal(summary.qualifiedFireEnemyDoomedCount, 1);
  assert.equal(summary.qualifiedFireReasonCount[ROOT_CONTROL_REASON.VISIBLE_NEAR], 1);
});

test("BP7 qualified FIRE audit records value loss without changing selection", () => {
  const value = attachQualifiedFire(engine());
  value.depthSearch.rootScore[0] = 12;
  const poc = new NativeTacticalActionOwnerPoc();
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  const summary = poc.summary();
  assert.equal(summary.qualifiedFireVerifiedCount, 1);
  assert.equal(summary.qualifiedFireMinimaxSelectedCount, 0);
  assert.equal(summary.qualifiedFireFinalSelectedCount, 0);
  assert.equal(summary.qualifiedFireValueLossCount, 1);
  assert.equal(summary.qualifiedFireBestActionCount[ACTION.GO], 1);
  assert.equal(summary.qualifiedFireGapHistogram[1], 1);
  assert.equal(summary.qualifiedFireValueGapSum, 3);
  assert.equal(summary.qualifiedFireValueGapMax, 3);
  assert.equal(summary.qualifiedFireRawWorstLossCount, 1);
  assert.equal(summary.qualifiedFireIntentFlipCount, 0);
});

test("BP7 qualified FIRE audit separates an intent arbitration inversion", () => {
  const value = attachQualifiedFire(engine());
  const intent = { prepare() {}, bonus(row) { return row === 0 ? 10 : 0; } };
  const poc = new NativeTacticalActionOwnerPoc({ intent });
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  const summary = poc.summary();
  assert.equal(summary.qualifiedFireValueLossCount, 1);
  assert.equal(summary.qualifiedFireRawWorstWinCount, 1);
  assert.equal(summary.qualifiedFireIntentFlipCount, 1);
  assert.equal(summary.qualifiedFireIntentGapSum, 10);
});

test("BP8 intent owner can shadow or activate only an intent-flipped FIRE", () => {
  const value = attachQualifiedFire(engine());
  const intent = { prepare() {}, bonus(row) { return row === 0 ? 10 : 0; } };
  const shadow = new NativeTacticalActionOwnerPoc({ intent,
    qualifiedFireOwnerMode: "intent-shadow" });
  assert.equal(shadow.selectOverride(value, 0, ACTION.GO), null);
  assert.equal(shadow.summary().qualifiedFireOwnerWouldOverrideCount, 1);
  assert.equal(shadow.summary().qualifiedFireOwnerOverrideCount, 0);
  const active = new NativeTacticalActionOwnerPoc({ intent,
    qualifiedFireOwnerMode: "intent-active" });
  assert.deepEqual(active.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(active.summary().qualifiedFireOwnerIntentProposalCount, 1);
  assert.equal(active.summary().qualifiedFireOwnerOverrideCount, 1);
});

test("BP8 response owner targets a matrix tradeoff, not dominated FIRE", () => {
  const value = attachQualifiedFire(engine());
  value.enemyCount = 2;
  value.depthSearch.rootScore[0] = 5;
  value.depthSearch.rootScore[1] = 0;
  value.depthSearch.rootScore[2] = -1;
  value.depthSearch.rootCellScore = new Int32Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
  value.depthSearch.rootCellScore[0] = 5;
  value.depthSearch.rootCellScore[1] = 5;
  value.depthSearch.rootCellScore[stride] = 10;
  value.depthSearch.rootCellScore[stride + 1] = 0;
  const active = new NativeTacticalActionOwnerPoc({
    qualifiedFireOwnerMode: "response-active" });
  assert.deepEqual(active.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(active.summary().qualifiedFireOwnerResponseProposalCount, 1);
  assert.equal(active.summary().qualifiedFireOwnerOverrideCount, 1);
  value.depthSearch.rootCellScore[stride] = 4;
  value.depthSearch.rootCellScore[stride + 1] = 4;
  const dominated = new NativeTacticalActionOwnerPoc({
    qualifiedFireOwnerMode: "response-active" });
  assert.equal(dominated.selectOverride(value, 0, ACTION.GO), null);
  assert.equal(dominated.summary().qualifiedFireOwnerResponseProposalCount, 0);
});

test("BP9 attributes a dominated FIRE to oracle ordering and action-local fidelity", () => {
  const value = attachQualifiedFire(engine()); value.enemyCount = 2;
  const search = value.depthSearch;
  search.rootScore[0] = 9; search.rootScore[1] = 4;
  search.rootCellScore = new Int32Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
  search.rootCellScore[0] = 9; search.rootCellScore[1] = 8;
  search.rootCellScore[stride] = 4; search.rootCellScore[stride + 1] = 3;
  search.legacyAction = action => action === "GO" ? ACTION.GO :
    action === "FIRE" ? ACTION.FIRE :
    action === "LEFT" ? ACTION.TURN_LEFT : -1;
  search.lastTransitionOwnCompared = new Uint16Array(24);
  search.lastTransitionOwnMismatch = new Uint16Array(24);
  search.lastTransitionOwnUnsupported = new Uint16Array(24);
  search.lastTransitionOwnComponentSignedDifference = new Int32Array(24 * 8);
  search.lastTransitionOwnComponentAbsDifference = new Uint32Array(24 * 8);
  search.lastDeepRootCompared = new Uint16Array(24);
  search.lastDeepRootMismatch = new Uint16Array(24);
  search.lastDeepRootUnsupported = new Uint16Array(24);
  search.lastDeepRootComponentSignedDifference = new Int32Array(24 * 8);
  search.lastDeepRootComponentAbsDifference = new Uint32Array(24 * 8);
  search.lastTransitionOwnCompared[ACTION.FIRE] = 2;
  search.lastTransitionOwnMismatch[ACTION.FIRE] = 1;
  search.lastTransitionOwnCompared[ACTION.GO] = 2;
  search.lastDeepRootCompared[ACTION.FIRE] = 3;
  search.lastDeepRootCompared[ACTION.GO] = 3;
  search.lastTransitionOwnComponentSignedDifference[ACTION.FIRE * 8 + 2] = 7;
  search.lastDeepRootComponentAbsDifference[ACTION.GO * 8 + 4] = 11;
  const poc = new NativeTacticalActionOwnerPoc();
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  poc.auditDominatedQualifiedFireAgainstOracle(value, { roots: [
    { action: "GO", value: 5 }, { action: "FIRE", value: 10 },
    { action: "LEFT", value: 1 }
  ] });
  const summary = poc.summary();
  assert.equal(summary.qualifiedFireDominatedByBestCount, 1);
  assert.equal(summary.qualifiedFireOracleAuditCount, 1);
  assert.equal(summary.qualifiedFireOraclePairComparedCount, 1);
  assert.equal(summary.qualifiedFireOracleFireHigherCount, 1);
  assert.equal(summary.qualifiedFireOracleBestFireCount, 1);
  assert.equal(summary.qualifiedFireOracleGapSum, -5);
  assert.equal(summary.qualifiedFireOneStepFireComparedCount, 2);
  assert.equal(summary.qualifiedFireOneStepFireMismatchCount, 1);
  assert.equal(summary.qualifiedFireDeepBestComparedCount, 3);
  assert.equal(summary.qualifiedFireOneStepFireComponentSignedDifference[2], 7);
  assert.equal(summary.qualifiedFireDeepBestComponentAbsDifference[4], 11);
  assert.equal(
    summary.qualifiedFireMismatchOneStepFireComponentSignedDifference[2], 7);
  assert.equal(summary.qualifiedFireMismatchDeepBestComponentAbsDifference[4], 11);
  assert.equal(summary.qualifiedFireMismatchOneStepFireComparedCount, 2);
  assert.equal(summary.qualifiedFireMismatchOneStepFireMismatchCount, 1);
  assert.equal(summary.qualifiedFireMismatchDeepBestComparedCount, 3);
});

test("native tactical owner cannot cross Hard or incomplete value support", () => {
  const value = engine(); value.hardStatus[1] = HARD_STATUS.REJECT_PROVEN;
  const poc = new NativeTacticalActionOwnerPoc();
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.TURN_LEFT, argument: 0 });
  value.depthSearch.representativeSupportComplete = 0;
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  assert.equal(poc.summary().noCompleteValueCount, 1);
});

test("strict bounded evidence cannot own an action after an incomplete branch", () => {
  const value = engine();
  const search = { rootScore: new Int32Array([5, 9, 7, 0]),
    rootDomainRestricted: 0, lastOwnershipSupportComplete: 0,
    observeRoot() {}, prepare() { return 1; }, summary() { return {}; } };
  const strict = new NativeTacticalActionOwnerPoc({ policySearch: search,
    policySearchSupportMode: "strict" });
  assert.equal(strict.selectOverride(value, 0, ACTION.GO), null);
  assert.equal(strict.summary().policySearchStrictSupportBlockedCount, 1);
  search.lastOwnershipSupportComplete = 1;
  assert.deepEqual(strict.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
});

test("budget-complete heuristic leaves cannot masquerade as exact value", () => {
  const value = engine();
  const search = { rootScore: new Int32Array([5, 9, 7, 0]),
    rootDomainRestricted: 0, lastOwnershipSupportComplete: 1,
    lastValueExact: 0, observeRoot() {}, prepare() { return 1; },
    summary() { return {}; } };
  const exact = new NativeTacticalActionOwnerPoc({ policySearch: search,
    policySearchSupportMode: "exact" });
  assert.equal(exact.selectOverride(value, 0, ACTION.GO), null);
  assert.equal(exact.summary().policySearchExactSupportBlockedCount, 1);
  search.lastValueExact = 1;
  assert.deepEqual(exact.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
});

test("candidate proof compares against the actual host action", () => {
  const value = engine();
  const search = { rootScore: new Int32Array([5, 9, 7, 0]),
    rootDomainRestricted: 0, lastOwnershipSupportComplete: 1,
    lastValueExact: 0, observeRoot() {}, prepare() { return 1; },
    summary() { return {}; } };
  const proof = { mode: "active", lastCertifiedRow: -1, seen: ACTION.NONE,
    beginRoot() { this.lastCertifiedRow = -1; },
    audit(_engine, _source, _count, incumbent) {
      this.seen = incumbent;
      if (incumbent === ACTION.TURN_LEFT) this.lastCertifiedRow = 1;
    },
    summary() { return {}; } };
  const owner = new NativeTacticalActionOwnerPoc({ policySearch: search,
    policySearchSupportMode: "exact", candidateForcedWin: proof });
  assert.deepEqual(owner.selectOverride(value, 0, ACTION.GO, ACTION.TURN_LEFT),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(proof.seen, ACTION.TURN_LEFT);
});

test("policy-exact candidate owns only through its explicit mode", () => {
  const value = engine();
  const search = { rootScore: new Int32Array([5, 9, 7, 0]),
    rootDomainRestricted: 0, lastOwnershipSupportComplete: 1,
    lastValueExact: 0, observeRoot() {}, prepare() { return 1; },
    summary() { return {}; } };
  const exact = { mode: "off", exactDominanceMode: "active",
    lastCertifiedRow: -1, lastExactDominanceRow: -1,
    beginRoot() { this.lastExactDominanceRow = -1; },
    audit() { this.lastExactDominanceRow = 1; }, summary() { return {}; } };
  const owner = new NativeTacticalActionOwnerPoc({ policySearch: search,
    policySearchSupportMode: "exact", candidateForcedWin: exact });
  assert.deepEqual(owner.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
});

test("committed search only compares complete ReverseViability members", () => {
  const value = engine();
  value.escapeObligation = { committedEntityCount: 1,
    supportStatus: SUPPORT_STATUS.COMPLETE,
    firstActionCount: 2, member: new Uint8Array([1, 0, 1, 0]),
    successorProof: new Uint8Array([SUCCESSOR_PROOF.PROVEN_VIABLE, 0,
      SUCCESSOR_PROOF.PROVEN_VIABLE, 0]) };
  let eligibility = null;
  const search = { rootScore: new Int32Array([5, 99, 7, 0]),
    rootDomainRestricted: 1, rootDomainMask: new Uint8Array([1, 0, 1, 0]),
    lastOwnershipSupportComplete: 1, observeRoot() {},
    prepare(_engine, _count, mask) { eligibility = mask; return 1; },
    summary() { return {}; } };
  const poc = new NativeTacticalActionOwnerPoc({ policySearch: search,
    committedSearchMode: "viable" });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.TURN_LEFT, argument: 0 });
  assert.equal(eligibility, value.escapeObligation.member);
  const summary = poc.summary();
  assert.equal(summary.committedSearchCompleteCount, 1);
  assert.equal(summary.committedSearchSelectionViolationCount, 0);
});

test("committed search preserves fallback when EO support is incomplete", () => {
  const value = engine();
  value.escapeObligation = { committedEntityCount: 1,
    supportStatus: SUPPORT_STATUS.INCOMPLETE,
    firstActionCount: 1, member: new Uint8Array([1, 0, 0, 0]),
    successorProof: new Uint8Array([SUCCESSOR_PROOF.PROVEN_VIABLE, 0, 0, 0]) };
  let searchCalls = 0;
  const poc = new NativeTacticalActionOwnerPoc({ committedSearchMode: "viable",
    policySearch: { observeRoot() {}, prepare() { searchCalls += 1; return 1; },
      summary() { return {}; } } });
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  assert.equal(searchCalls, 0);
  assert.equal(poc.summary().committedSearchIncompleteCount, 1);
});

test("non-contact base policy can own a Hard-allowed mapped action without search", () => {
  const value = engine(); value.lastControlMode = ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION;
  const intent = { currentCommittedAction: ACTION.NONE, contextEpoch: 0,
    observeContext() {}, prepare() { this.currentCommittedAction = ACTION.FIRE; },
    commitSelection(action) { assert.equal(action, ACTION.FIRE); } };
  const poc = new NativeTacticalActionOwnerPoc({ intent,
    nonContactBasePolicy: true });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(poc.summary().nonContactBaseOverrideCount, 1);
  assert.equal(poc.summary().physicalOwnerCount, 0);
});

test("non-contact strategic progress cannot bypass the Risk acceptance threshold", () => {
  const value = engine(); value.lastControlMode = ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION;
  value.depthSearch.completedDepth = 0;
  value.riskController.outcome.acceptable[2] = 0;
  const intent = { currentCommittedAction: ACTION.TURN_LEFT,
    observeContext() {}, prepare() {}, bonus() { return 0; } };
  const poc = new NativeTacticalActionOwnerPoc({ intent,
    nonContactBasePolicy: true, riskFrontierMode: "joint" });
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  assert.equal(poc.summary().nonContactBaseMissingCount, 1);
});

test("terminal-only non-contact ownership is inert before the final 16 frames", () => {
  const value = engine(); value.lastControlMode = ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION;
  value.adapter.state = new FastState(7, 7);
  value.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 111;
  const intent = { currentCommittedAction: ACTION.FIRE, contextEpoch: 0,
    observeContext() {}, prepare() {}, commitSelection() {} };
  const poc = new NativeTacticalActionOwnerPoc({ intent,
    nonContactBasePolicy: true, nonContactBaseTerminalOnly: true });
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  value.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 112;
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(poc.summary().nonContactBaseCheckCount, 1);
});

test("direct attack policy owns an exact winning race before minimax", () => {
  const value = engine(); const state = new FastState(7, 7);
  value.adapter.state = state; value.adapter.enemyVisible = true;
  state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 3;
  state.arrays[ARRAY.TANK_CELL][0] = state.cell(1, 3);
  state.arrays[ARRAY.TANK_CELL][1] = state.cell(5, 3);
  state.arrays[ARRAY.TANK_DIR][0] = 1;
  state.arrays[ARRAY.TANK_DIR][1] = 0;
  value.manhattan = (left, right) => Math.abs(state.x(left) - state.x(right)) +
    Math.abs(state.y(left) - state.y(right));
  value.directionTo = (left, right) => state.y(left) === state.y(right) ?
    state.x(right) > state.x(left) ? 1 : 3 : -1;
  value.clearLine = () => 1;
  const intent = { contextEpoch: 0, observeContext() {},
    directAttackAction() { return ACTION.FIRE; },
    commitDirectAttack(action) { assert.equal(action, ACTION.FIRE); } };
  let searchCalls = 0;
  const poc = new NativeTacticalActionOwnerPoc({ intent,
    directAttackBasePolicy: "active",
    policySearch: { observeRoot() {}, prepare() { searchCalls += 1; return 0; },
      summary() { return {}; } } });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(searchCalls, 0);
  assert.equal(poc.summary().directAttackOverrideCount, 1);
});

test("direct attack shadow records evidence but preserves minimax ownership", () => {
  const value = engine(); const intent = { contextEpoch: 0,
    observeContext() {}, directAttackAction() { return ACTION.FIRE; },
    prepare() {}, bonus() { return 0; } };
  const poc = new NativeTacticalActionOwnerPoc({ intent,
    directAttackBasePolicy: "shadow" });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(poc.summary().directAttackShadowSearchSameCount, 1);
  assert.equal(poc.summary().directAttackOverrideCount, 0);
});

test("preemptive safety owns a complete geometric escape before minimax", () => {
  const value = engine(); value.adapter.state = new FastState(7, 7);
  value.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 6;
  const intent = { contextEpoch: 0, preemptiveEscapeDirection: 3,
    observeContext() {}, preemptiveSafetyAction() { return ACTION.TURN_LEFT; },
    activeEffect() { return 0; }, advance() { return 0; } };
  let searchCalls = 0;
  const poc = new NativeTacticalActionOwnerPoc({ intent,
    preemptiveSafetyBasePolicy: "active",
    policySearch: { observeRoot() {}, prepare() { searchCalls += 1; return 0; },
      summary() { return {}; } } });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.TURN_LEFT, argument: 0 });
  assert.equal(searchCalls, 0);
  assert.equal(poc.summary().preemptiveOverrideCount, 1);
});

test("exact maximin dominance can bypass only a rejected FIRE domain row", () => {
  const domain = { allows(value, row) { return value.ourActions[row] !== ACTION.FIRE; } };
  const value = engine(); const poc = new NativeTacticalActionOwnerPoc({
    domain, exactFireDomainBypass: true
  });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(poc.summary().exactFireBypassCount, 1);
  value.depthSearch.rootScore[1] = 4;
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.TURN_LEFT, argument: 0 });
});

test("robust opponent backup blends nominal replies without discarding worst case", () => {
  const value = engine(); value.ourCount = 3;
  value.depthSearch.rootScore = new Int32Array([5, 4, 0]);
  value.depthSearch.rootCellScore = new Int32Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  value.depthSearch.rootCellScore[0] = 5;
  value.depthSearch.rootCellScore[1] = 5;
  value.depthSearch.rootCellScore[SEARCH_CAPACITY.MAX_ENEMY_POLICIES] = 4;
  value.depthSearch.rootCellScore[SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1] = 200;
  value.enemyCount = 2; value.enemyActions = new Uint8Array([ACTION.GO, ACTION.FIRE]);
  value.enemyActionFamilies = new Uint8Array(2);
  value.actionFamilyForShadow = action => action;
  value.opponentContext = () => 0;
  value.policy = { opponent: { buildNominalPolicy(families, count, context, out) {
    out[0] = 9000; out[1] = 1000; return count;
  } } };
  const poc = new NativeTacticalActionOwnerPoc({ opponentBlendBasisPoints: 2000 });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(poc.summary().nominalBackupCount, 1);
  assert.equal(poc.backedUpValue(value.depthSearch, 1, 2, 0), 4);
});

test("resource ownership requires cellwise dominance when enabled", () => {
  const value = engine(); value.ourCount = 5; value.enemyCount = 2;
  value.ourActions = new Uint8Array([
    ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT, ACTION.CAST_POISON, ACTION.NONE]);
  value.ourArguments = new Uint16Array(5);
  value.hardStatus = new Uint8Array(5).fill(HARD_STATUS.ALLOW);
  value.depthSearch.rootScore = new Int32Array([9, 7, 6, 10, 0]);
  value.depthSearch.rootCellScore = new Int32Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  value.depthSearch.rootCellScore[0] = 9;
  value.depthSearch.rootCellScore[1] = 9;
  value.depthSearch.rootCellScore[3 * SEARCH_CAPACITY.MAX_ENEMY_POLICIES] = 10;
  value.depthSearch.rootCellScore[3 * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1] = 4;
  const poc = new NativeTacticalActionOwnerPoc({
    resourceRequiresCellwiseDominance: true
  });
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  value.depthSearch.rootCellScore[3 * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1] = 10;
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.CAST_POISON, argument: 0 });
  assert.equal(poc.summary().resourceDominanceAcceptedCount, 1);
  assert.equal(poc.summary().resourceDominanceRejectedCount, 1);
});

test("resource dominance can protect bombs without suppressing a skill", () => {
  const value = engine(); value.ourCount = 5; value.enemyCount = 2;
  value.ourActions = new Uint8Array([
    ACTION.GO, ACTION.THROW_BOMB, ACTION.CAST_STUN, ACTION.TURN_LEFT, ACTION.NONE]);
  value.ourArguments = new Uint16Array(5);
  value.hardStatus = new Uint8Array(5).fill(HARD_STATUS.ALLOW);
  value.depthSearch.rootScore = new Int32Array([9, 20, 15, 6, 0]);
  value.depthSearch.rootCellScore = new Int32Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  value.depthSearch.rootCellScore[0] = 9;
  value.depthSearch.rootCellScore[1] = 9;
  value.depthSearch.rootCellScore[SEARCH_CAPACITY.MAX_ENEMY_POLICIES] = 20;
  value.depthSearch.rootCellScore[SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1] = 2;
  value.depthSearch.rootCellScore[2 * SEARCH_CAPACITY.MAX_ENEMY_POLICIES] = 15;
  value.depthSearch.rootCellScore[2 * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1] = 15;
  const poc = new NativeTacticalActionOwnerPoc({
    resourceCellwiseDominanceScope: "bomb"
  });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.CAST_STUN, argument: 0 });
  assert.equal(poc.summary().resourceCellwiseDominanceScope, "bomb");
  assert.equal(poc.summary().resourceDominanceRejectedCount, 1);
});

test("base policy verifier lets minimax override only with a sufficient lead", () => {
  const intent = { currentCommittedAction: ACTION.FIRE,
    observeContext() {}, prepare() {}, bonus() { return 0; } };
  const value = engine(); value.depthSearch.rootScore =
    new Int32Array([100, 90, 70, 0]);
  const guarded = new NativeTacticalActionOwnerPoc({ intent,
    basePolicyVerifierMode: "margin", basePolicyVerifierMargin: 100 });
  assert.equal(guarded.selectOverride(value, 1, ACTION.FIRE), null);
  assert.equal(guarded.summary().basePolicyVerifierKeptCount, 1);
  const permissive = new NativeTacticalActionOwnerPoc({ intent,
    basePolicyVerifierMode: "margin", basePolicyVerifierMargin: 5 });
  assert.deepEqual(permissive.selectOverride(value, 1, ACTION.FIRE),
    { action: ACTION.GO, argument: 0 });
  assert.equal(permissive.summary().basePolicyVerifierSearchOverrideCount, 1);
});

test("terminal trade audit receives the V1-style base row without enabling verifier ownership", () => {
  const intent = { currentCommittedAction: ACTION.FIRE,
    observeContext() {}, prepare() {}, bonus() { return 0; } };
  const value = engine(); value.depthSearch.rootScore =
    new Int32Array([10, 8, 7, 0]);
  let observedBase = -1;
  const audit = { select(current, source, allowed, backed, selected, count, base) {
    observedBase = base; return selected;
  } };
  const poc = new NativeTacticalActionOwnerPoc({ intent,
    terminalTradeAudit: audit });
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  assert.equal(observedBase, 1);
  assert.equal(poc.summary().basePolicyVerifierCheckCount, 0);
  assert.equal(poc.summary().basePolicyVerifierKeptCount, 0);
});

test("verified intercept promotes only a near-equal safer attack frontier", () => {
  const value = engine(); value.depthSearch.rootScore =
    new Int32Array([500, 250, 100, 0]);
  value.combat = { vector: { count: 4,
    intercept: new Uint8Array([0, 1, 0, 0]),
    possibleHit: new Uint8Array([0, 1, 0, 0]),
    postFireEscape: new Uint8Array([0, 1, 0, 0]),
    purposeCompleteness: new Uint16Array([0, 5000, 0, 0]),
    ownCounterExposure: new Uint16Array([300, 100, 0, 0]),
    enemySafeSuccessors: new Uint8Array([4, 2, 0, 0]),
    attackClosureStatus: new Uint8Array([0, 1, 0, 0]),
    enemyDoomedFirstActions: new Uint8Array([0, 1, 0, 0]),
    enemySurvivingFirstActions: new Uint8Array([0, 2, 0, 0]),
    enemyUnknownFirstActions: new Uint8Array(4),
    hitDeadline: new Uint8Array([255, 3, 255, 255]) } };
  const poc = new NativeTacticalActionOwnerPoc({
    verifiedInterceptMode: "active", verifiedInterceptBand: 400 });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(poc.summary().verifiedInterceptOverrideCount, 1);
  value.combat.vector.ownCounterExposure[1] = 10000;
  const blocked = new NativeTacticalActionOwnerPoc({
    verifiedInterceptMode: "active", verifiedInterceptBand: 400 });
  assert.equal(blocked.selectOverride(value, 0, ACTION.GO), null);
  assert.equal(blocked.summary().verifiedInterceptOverrideCount, 0);
});

test("FIRE evidence selection demotes only an unsupported selected FIRE", () => {
  const value = engine();
  value.combat = { vector: { count: 4,
    directKill: new Uint8Array(4),
    enemyDoomedFirstActions: new Uint8Array(4),
    possibleHit: new Uint8Array(4),
    intercept: new Uint8Array(4),
    aimSetup: new Uint8Array(4) } };
  const poc = new NativeTacticalActionOwnerPoc({ fireEvidenceSelection: true });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.TURN_LEFT, argument: 0 });
  assert.equal(poc.summary().fireEvidenceDemotionCount, 1);

  const supported = engine();
  supported.combat = { vector: { count: 4,
    directKill: new Uint8Array(4),
    enemyDoomedFirstActions: new Uint8Array(4),
    possibleHit: new Uint8Array([0, 1, 0, 0]),
    intercept: new Uint8Array(4),
    aimSetup: new Uint8Array(4) } };
  const supportedPoc = new NativeTacticalActionOwnerPoc({
    fireEvidenceSelection: true
  });
  assert.deepEqual(supportedPoc.selectOverride(supported, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(supportedPoc.summary().fireEvidenceSupportedCount, 1);
});

test("FIRE evidence selection preserves FIRE when combat support is incomplete", () => {
  const poc = new NativeTacticalActionOwnerPoc({ fireEvidenceSelection: true });
  assert.deepEqual(poc.selectOverride(engine(), 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(poc.summary().fireEvidenceIncompleteCount, 1);
  assert.equal(poc.summary().fireEvidenceDemotionCount, 0);
});

test("verified poison proposal requires complete cellwise non-regression", () => {
  const value = engine(); const state = new FastState(8, 8);
  value.ourCount = 2; value.enemyCount = 2;
  value.ourActions = new Uint8Array([ACTION.GO, ACTION.CAST_POISON]);
  value.ourArguments = new Uint16Array(2);
  value.hardStatus = new Uint8Array(2).fill(HARD_STATUS.ALLOW);
  value.adapter = { state, enemyVisible: true, enemyCanAct: true, enemyCanFire: true };
  state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 4;
  state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 0xffff;
  state.arrays[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  state.arrays[ARRAY.TANK_CELL][1] = state.cell(5, 2);
  state.arrays[ARRAY.TANK_POISON_UNTIL][1] = 0xffff;
  state.arrays[ARRAY.TANK_FROZEN_UNTIL][1] = 0xffff;
  state.arrays[ARRAY.TANK_STUN_UNTIL][1] = 0xffff;
  value.riskController = { outcome: { count: 2,
    acceptable: new Uint8Array([1, 1]), dominated: new Uint8Array(2) } };
  value.escapeObligation = { supportStatus: 0, committedEntityCount: 0,
    member: new Uint8Array(2), successorProof: new Uint8Array(2) };
  const source = { representativeSupportComplete: 1,
    rootCellScore: new Int32Array(
      SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES) };
  source.rootCellScore[0] = 10; source.rootCellScore[1] = 10;
  source.rootCellScore[SEARCH_CAPACITY.MAX_ENEMY_POLICIES] = 11;
  source.rootCellScore[SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1] = 12;
  const poc = new NativeTacticalActionOwnerPoc({ poisonProposalMode: "shadow" });
  poc.allowedRow[0] = 1; poc.allowedRow[1] = 1;
  poc.backedValue[0] = 10; poc.backedValue[1] = 11;
  assert.equal(poc.verifiedPoisonProposal(value, source, 0, 2), 1);
  assert.equal(poc.summary().poisonProposalEvidenceCount, 1);
  source.rootCellScore[SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1] = 9;
  assert.equal(poc.verifiedPoisonProposal(value, source, 0, 2), -1);
  assert.equal(poc.summary().poisonProposalCellwiseBlockedCount, 1);

  source.rootCellScore[SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1] = 12;
  const contact = new NativeTacticalActionOwnerPoc({ poisonProposalMode: "shadow",
    poisonProposalPolicy: "deferred-left-contact" });
  contact.allowedRow[0] = 1; contact.allowedRow[1] = 1;
  contact.backedValue[0] = 10; contact.backedValue[1] = 11;
  assert.equal(contact.verifiedPoisonProposal(value, source, 0, 2), -1);
  value.ourActions[0] = ACTION.TURN_LEFT;
  assert.equal(contact.verifiedPoisonProposal(value, source, 0, 2), 1);
  assert.equal(contact.summary().poisonProposalPolicyBlockedCount, 1);
});

test("strategic intent can define membership before minimax ranks rows", () => {
  const value = engine(); const intent = { committed: 2,
    prepare() {}, bonus() { return 0; }, member(row) { return row === 2 ? 1 : 0; } };
  value.depthSearch.rootScore = new Int32Array([100, 200, 50, 0]);
  const poc = new NativeTacticalActionOwnerPoc({ intent, intentMembership: true });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.TURN_LEFT, argument: 0 });
  assert.equal(poc.summary().intentMembershipRootCount, 1);
  assert.equal(poc.summary().intentMembershipBlockedCount, 2);
});

test("attack pose option can decide only inside the configured minimax band", () => {
  const pose = { prepare() { return 1; }, supports(row) { return row === 1; },
    betterRow() { return 1; } };
  const value = engine(); value.ourCount = 3;
  value.depthSearch.rootScore = new Int32Array([1000, 900, 0]);
  const poc = new NativeTacticalActionOwnerPoc({
    attackPoseOption: pose, attackPoseBand: 150
  });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(poc.summary().attackPoseOverrideCount, 1);
  value.depthSearch.rootScore[1] = 800;
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
});

test("attack pose ownership can require an exact one-turn aim setup", () => {
  const pose = { selected: 0, direction: new Uint8Array([1]),
    prepare() { return 1; }, supports(row) { return row === 1; },
    betterRow() { return 1; },
    turns(from, to) { const delta = Math.abs(from - to); return Math.min(delta, 4 - delta); } };
  const value = engine(); value.ourCount = 3;
  value.depthSearch.rootScore = new Int32Array([1000, 900, 0]);
  value.adapter.state = new FastState(4, 4);
  value.adapter.state.arrays[ARRAY.TANK_DIR][0] = 0;
  const accepted = new NativeTacticalActionOwnerPoc({ attackPoseOption: pose,
    attackPoseBand: 150, attackPoseRequiredAimTurns: 1 });
  assert.deepEqual(accepted.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(accepted.summary().attackPoseAimTurnAcceptedCount, 1);
  value.adapter.state.arrays[ARRAY.TANK_DIR][0] = 1;
  const rejected = new NativeTacticalActionOwnerPoc({ attackPoseOption: pose,
    attackPoseBand: 150, attackPoseRequiredAimTurns: 1 });
  assert.equal(rejected.selectOverride(value, 0, ACTION.GO), null);
  assert.equal(rejected.summary().attackPoseAimTurnRejectedCount, 1);
});

test("attack pose ownership can be isolated to one decision root", () => {
  const pose = { prepare() { return 1; }, supports(row) { return row === 1; },
    betterRow() { return 1; } };
  const value = engine(); value.ourCount = 3;
  value.depthSearch.rootScore = new Int32Array([1000, 900, 0]);
  const poc = new NativeTacticalActionOwnerPoc({ attackPoseOption: pose,
    attackPoseBand: 150, attackPoseActiveFrames: [1] });
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  assert.equal(poc.summary().attackPosePrepareCount, 1);
  assert.equal(poc.summary().attackPoseOverrideCount, 1);
});

test("attack pose cannot trade away an uncovered enemy response", () => {
  const pose = { prepare() { return 1; }, supports(row) { return row === 1; },
    uncoveredNonRegressing(source, row, baseline) {
      return source.rootCellScore[row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1] >=
        source.rootCellScore[baseline * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1];
    }, betterRow() { return 1; } };
  const value = engine(); value.ourCount = 3; value.enemyCount = 2;
  value.depthSearch.rootScore = new Int32Array([1000, 900, 0]);
  value.depthSearch.rootCellScore = new Int32Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  value.depthSearch.rootCellScore[1] = 1000;
  value.depthSearch.rootCellScore[SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1] = 899;
  const poc = new NativeTacticalActionOwnerPoc({
    attackPoseOption: pose, attackPoseBand: 150
  });
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  value.depthSearch.rootCellScore[SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1] = 1000;
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
});

test("option-first attack ignores heuristic gaps but preserves terminal wins and losses", () => {
  const pose = { prepare() { return 1; }, supports(row) { return row === 1; },
    betterRow() { return 1; } };
  const value = engine(); value.ourCount = 3;
  value.depthSearch.rootScore = new Int32Array([25000, -25000, 0]);
  const poc = new NativeTacticalActionOwnerPoc({ attackPoseOption: pose,
    attackPoseOptionFirst: true });
  assert.deepEqual(poc.selectOverride(value, 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  value.depthSearch.rootScore[0] = 30000;
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  value.depthSearch.rootScore[0] = 0; value.depthSearch.rootScore[1] = -30000;
  assert.equal(poc.selectOverride(value, 0, ACTION.GO), null);
  assert.equal(poc.summary().attackPoseTerminalProtectedCount, 1);
  assert.equal(poc.summary().attackPoseTerminalLossRejectedCount, 1);
});

test("targeted root capture records one compact attack-pose matrix", () => {
  const pose = { selected: 0, cell: new Uint16Array([7]),
    direction: new Uint8Array([1]), fireDeadline: new Uint8Array([2]),
    responseCoverage: new Uint8Array([1]), responseMask: new Uint32Array([1]),
    postFireEscape: new Uint8Array([2]), counterExposure: new Uint8Array([0]),
    enemyCell: new Uint16Array([9]), rowProgress: new Int8Array([0, 1, 0]),
    rowDeadline: new Uint8Array([3, 2, 4]), prepare() { return 1; },
    supports(row) { return row === 1; }, betterRow() { return 1; } };
  const value = engine(); value.ourCount = 3; value.enemyCount = 1;
  value.enemyActions = new Uint8Array([ACTION.GO]);
  value.depthSearch.rootCellScore = new Int32Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  const state = new FastState(4, 4); value.adapter.state = state;
  state.arrays[ARRAY.TANK_CELL][0] = 1; state.arrays[ARRAY.TANK_CELL][1] = 9;
  const poc = new NativeTacticalActionOwnerPoc({ attackPoseOption: pose,
    attackPoseBand: 150, captureFrames: [0] });
  poc.selectOverride(value, 0, ACTION.GO);
  const samples = poc.summary().rootSamples;
  assert.equal(samples.length, 1);
  assert.equal(samples[0].decisionIndex, 0);
  assert.equal(samples[0].engineDecisionIndex, 0);
  assert.equal(samples[0].option.responseMask, 1);
  assert.equal(samples[0].width, 4);
  assert.equal(samples[0].rows[1].projectedCell, 1);
  assert.equal(samples[0].rows.length, 3);
});

test("BP11 all-root capture is bounded and can attach the matching V1 oracle", () => {
  const value = engine(); value.ourCount = 3; value.enemyCount = 1;
  value.enemyActions = new Uint8Array([ACTION.GO]);
  value.depthSearch.rootCellScore = new Int32Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
  const poc = new NativeTacticalActionOwnerPoc({ captureAllRoots: true,
    captureRootLimit: 1 });
  poc.selectOverride(value, 0, ACTION.GO);
  poc.policySearch = { legacyAction(action) {
    return action === "FIRE" ? ACTION.FIRE : ACTION.GO;
  } };
  poc.annotateCapturedRootOracle([
    { action: "GO", rawValue: 11.9, value: 9.2, unsafe: false },
    { action: "FIRE", rawValue: 7.1, value: 5.8, unsafe: true }
  ], ACTION.GO, 3);
  poc.policySearch = null;
  poc.selectOverride(value, 0, ACTION.GO);
  const samples = poc.summary().rootSamples;
  assert.equal(samples.length, 1);
  assert.equal(samples[0].proposedAction, ACTION.FIRE);
  assert.equal(samples[0].oracleStageAction, ACTION.GO);
  assert.equal(samples[0].oracleRounds, 3);
  assert.equal(samples[0].rows[0].intentBonus, 0);
  assert.equal(samples[0].rows[0].intentMember, 0);
  assert.deepEqual(samples[0].oracleRows, [
    { action: ACTION.GO, rawValue: 11, value: 9, unsafe: 0 },
    { action: ACTION.FIRE, rawValue: 7, value: 5, unsafe: 1 }
  ]);
  assert.equal(samples[0].stateHashLo, value.adapter.state.hashLo >>> 0);
});
