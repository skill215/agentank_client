"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND } = require("../../engine-v2/src/policy/option-portfolio");
const { movementAction, ObjectiveConditionedDepthSearch, ActionContinuationEnvelope } = require(
  "../../engine-v2/src/search/action-continuation-envelope");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");

function outcome() {
  return { acceptable: Uint8Array.from([1, 1, 1]),
    dominated: Uint8Array.from([0, 1, 0]),
    expectedValue: Int16Array.from([100, 300, 200]),
    tacticalValue: Int16Array.from([100, 200, 300]) };
}

function envelope() {
  const fakeSearch = { rootTransitions: { setEnabled() {} } };
  return new ActionContinuationEnvelope({}, { search: fakeSearch,
    cacheBank: {}, maximumRows: 3 });
}

test("continuation envelope recognizes only primitive movement", () => {
  assert.equal(movementAction(ACTION.GO), 1);
  assert.equal(movementAction(ACTION.TURN_LEFT), 1);
  assert.equal(movementAction(ACTION.TURN_RIGHT), 1);
  assert.equal(movementAction(ACTION.FIRE), 0);
});

test("continuation candidate set retains an acceptable Pareto-deleted move", () => {
  const value = envelope();
  const engine = { ourActions: Uint8Array.from([
    ACTION.TURN_LEFT, ACTION.GO, ACTION.TURN_RIGHT]),
  ourArguments: new Uint16Array(3),
  hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW,
    HARD_STATUS.ALLOW]), riskController: { outcome: outcome() } };
  const count = value.selectCandidates(engine, 0, 3);
  assert.equal(count, 3);
  assert.deepEqual(Array.from(value.rowMap), [0, 1, 2]);
  assert.equal(value.hasParetoConflict(engine, count), 1);
});

test("continuation envelope cannot publish an active proposal", () => {
  const value = envelope();
  assert.equal(value.active, 0);
  assert.equal(value.summary().supportComplete, false);
  assert.equal(value.summary().proposalCount, 0);
  assert.equal(value.hotAllocationCount, 0);
});

test("option continuation copies aliases without changing primitive rows", () => {
  const value = envelope();
  value.optionAware = 1;
  value.rowMap.set([2, 0]);
  const source = { count: 3,
    primitiveRow: Uint8Array.from([0, 2, 2]),
    kind: Uint8Array.from([OPTION_KIND.STAR_CONTROL, OPTION_KIND.POSITION,
      OPTION_KIND.ATTACK_SETUP]),
    targetCell: Uint16Array.from([4, 6, 7]),
    targetSignature: Uint32Array.from([1, 2, 3]),
    deadline: Uint16Array.from([8, 9, 10]),
    evidence: Uint8Array.from([1, 2, 3]), supportComplete: Uint8Array.from([1, 1, 1]) };
  const engine = { optionPortfolio: source, adapter: { enemyVisible: 1,
    state: { arrays: { 0: Uint16Array.from([0, 7]) } } } };
  assert.equal(value.buildLocalPortfolio(engine, 2), 3);
  assert.deepEqual(Array.from(value.localPortfolio.primitiveRow.slice(0, 3)), [0, 0, 1]);
});

test("strict target ownership does not turn an unowned move into star pursuit", () => {
  const value = envelope(); value.optionAware = 1; value.strictTargetOwnership = 1;
  value.rowMap.set([0]);
  const arrays = [];
  arrays[ARRAY.TANK_CELL] = Uint16Array.from([2, 9]);
  arrays[ARRAY.SCALAR] = new Uint32Array(SCALAR.COUNT || 32);
  arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 5;
  const engine = { optionPortfolio: { count: 1,
    primitiveRow: Uint8Array.from([0]), kind: Uint8Array.from([OPTION_KIND.POSITION]),
    targetCell: Uint16Array.from([5]), targetSignature: Uint32Array.from([0]),
    deadline: Uint16Array.from([9]), evidence: Uint8Array.from([1]),
    supportComplete: Uint8Array.from([1]) },
  strategyBands: { starPurpose: Uint16Array.from([0]) },
  adapter: { enemyVisible: 1, state: { arrays } } };
  assert.equal(value.buildLocalPortfolio(engine, 1), 1);
  assert.equal(value.localPortfolio.kind[0], OPTION_KIND.POSITION);
  assert.equal(value.localPortfolio.targetCell[0], 9);
});

test("diagnostic position and star leaves are conditioned on explicit target", () => {
  const search = new ObjectiveConditionedDepthSearch(new ProductionCacheBank());
  const built = fast.createFastPhysical(physical({
    map: { width: 9, height: 5, terrainColumnMajor: boxedMap(9, 5) },
    tanks: [tank(0, [1, 2], "right"), tank(1, [7, 2], "left")],
    star: [1, 1]
  }));
  search.optionCount = 2; search.rootOurCount = 2; search.frameRow[0] = 0;
  search.optionKind[0] = OPTION_KIND.POSITION;
  search.optionTargetCell[0] = built.state.cell(7, 2);
  const attackValue = search.heuristic(built.state);
  search.optionKind[0] = OPTION_KIND.STAR_CONTROL;
  search.optionTargetCell[0] = built.state.cell(1, 1);
  const starValue = search.heuristic(built.state);
  assert.notEqual(attackValue, starValue);
  assert.ok(starValue > attackValue);
});

test("dynamic contact position follows the enemy entity and uses contact continuation", () => {
  const search = new ObjectiveConditionedDepthSearch(new ProductionCacheBank(),
    undefined, null, { dynamicPositionTarget: true });
  const built = fast.createFastPhysical(physical({
    map: { width: 9, height: 5, terrainColumnMajor: boxedMap(9, 5) },
    tanks: [tank(0, [1, 2], "right"), tank(1, [7, 2], "left")], star: [1, 1]
  }));
  search.optionCount = 1; search.rootOurCount = 1; search.frameRow[0] = 0;
  search.optionKind[0] = OPTION_KIND.POSITION;
  search.optionTargetCell[0] = built.state.cell(1, 1);
  assert.equal(search.objectiveTarget(built.state, OPTION_KIND.POSITION),
    built.state.cell(7, 2));
  search.iterationExpansionLimit = 3;
  search.generateDeep(1, built.state, 0);
  assert.ok(Array.from(search.deepOurActions.subarray(4,
    4 + search.frameOurCount[1])).includes(ACTION.FIRE));
});

test("active tradeoff admits only same-position future-fire risk", () => {
  const value = envelope(); value.active = 1; value.optionAware = 1;
  value.optionSearch = { optionCount: 2,
    optionPrimitiveRow: Uint8Array.from([0, 1]),
    optionKind: Uint8Array.from([OPTION_KIND.POSITION, OPTION_KIND.POSITION]),
    optionTargetCell: Uint16Array.from([7, 7]), rootScore: Int32Array.from([10, 20]) };
  const o = { acceptable: Uint8Array.from([1, 1]),
    committedFatalMass: Uint16Array.from([0, 0]),
    immediateFatalMass: Uint16Array.from([0, 0]),
    horizonFatalMass: Uint16Array.from([100, 300]),
    unknownMass: Uint16Array.from([0, 0]),
    possibleProjectileFatalMass: Uint16Array.from([0, 0]),
    futureFireFatalMass: Uint16Array.from([100, 300]),
    escapeSlack: Int8Array.from([0, 0]) };
  const engine = { hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    riskController: { outcome: o } };
  assert.equal(value.qualifiesFutureFireTradeoff(engine, 0, 1, 1), 1);
  o.possibleProjectileFatalMass[1] = 1;
  assert.equal(value.qualifiesFutureFireTradeoff(engine, 0, 1, 1), 0);
  o.possibleProjectileFatalMass[1] = 0; o.escapeSlack[1] = -1;
  assert.equal(value.qualifiesFutureFireTradeoff(engine, 0, 1, 1), 0);
  o.escapeSlack[1] = 0; o.futureFireFatalMass[1] = 150;
  assert.equal(value.qualifiesFutureFireTradeoff(engine, 0, 1, 1), 0);
  value.optionSearch.optionTargetCell[1] = 8;
  o.futureFireFatalMass[1] = 300;
  assert.equal(value.qualifiesFutureFireTradeoff(engine, 0, 1, 1), 0);
});

test("post-search epsilon contamination can reject a nominal objective winner", () => {
  const value = envelope(); value.active = 1; value.optionAware = 1;
  value.postRiskArbitration = 1;
  value.optionSearch = { optionCount: 2,
    optionPrimitiveRow: Uint8Array.from([0, 1]),
    optionKind: Uint8Array.from([OPTION_KIND.POSITION, OPTION_KIND.POSITION]),
    optionTargetCell: Uint16Array.from([7, 7]), rootScore: Int32Array.from([1000, 2000]) };
  const o = { acceptable: Uint8Array.from([1, 1]),
    committedFatalMass: Uint16Array.from([0, 0]),
    immediateFatalMass: Uint16Array.from([0, 0]),
    horizonFatalMass: Uint16Array.from([0, 3000]),
    unknownMass: Uint16Array.from([0, 0]),
    possibleProjectileFatalMass: Uint16Array.from([0, 0]),
    futureFireFatalMass: Uint16Array.from([0, 3000]),
    escapeSlack: Int8Array.from([0, 0]) };
  const engine = { policy: { baseRisk: 20 },
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    riskController: { outcome: o, stateRiskClass: 0,
      riskProfile: { lambda() { return 1980; } },
      binaryFatalBackup(value_, mass, lambda) {
        if (!mass) return value_;
        const expected = Math.floor(((10000 - mass) * value_ + mass * -32000) / 10000);
        return Math.floor((lambda * expected + (10000 - lambda) * -32000) / 10000);
      } } };
  value.rowMap.set([0, 1]);
  assert.ok(value.postRiskScore(engine, 1, 2000) <
    value.postRiskScore(engine, 0, 1000));
  assert.equal(value.bestPostRiskLocal(engine, 2), 0);
  assert.equal(value.qualifiesFutureFireTradeoff(engine, 0, 1, 1, 1000, 2000), 0);
  assert.equal(value.postRiskRejectedCount, 1);
});
