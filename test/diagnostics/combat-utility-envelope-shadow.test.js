"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { RiskProfile } = require("../../engine-v2/src/search/risk");
const { PAC_STATUS, PAC_CELL } = require(
  "../../engine-v2/src/search/projectile-attack-closure");
const { METRIC, RELATION, CombatUtilityEnvelopeShadow } = require(
  "../../tools/agentank/diagnostics/combat-utility-envelope-shadow");

function fixture() {
  const interval = { evaluationSerial: 1, lastSelectedRow: 0, lastAttackRow: 1,
    lastRiskIncumbentLower: 0, lastRiskAttackUpper: 100,
    ledger: { lastSelectedKind: 5 },
    rollout: { starGain: Uint8Array.from([1, 0]) } };
  const maxEnemy = 4;
  const pac = { maxEnemy, count: 2, enemyCount: 2,
    status: Uint8Array.from([PAC_STATUS.NONE, PAC_STATUS.COMPLETE]),
    unknownEnemyColumns: new Uint8Array(2),
    doomedEnemyColumns: Uint8Array.from([0, 1]),
    cellStatus: new Uint8Array(2 * maxEnemy),
    cellPressure: new Int16Array(2 * maxEnemy),
    cellSetupDelay: new Uint8Array(2 * maxEnemy),
    cellMobilityLoss: new Uint8Array(2 * maxEnemy),
    cellEndpointReduction: new Uint16Array(2 * maxEnemy) };
  pac.cellStatus[maxEnemy] = PAC_CELL.PROVEN_DOOMED;
  pac.cellStatus[maxEnemy + 1] = PAC_CELL.SURVIVES;
  const combat = { count: 2,
    attackClosureStatus: Uint8Array.from([PAC_STATUS.NONE, PAC_STATUS.COMPLETE]),
    postFireEscape: Uint8Array.from([1, 2]),
    ownCounterExposure: Uint16Array.from([1000, 500]),
    resourceOccupancy: Uint8Array.from([0, 2]),
    hitDeadline: Uint8Array.from([255, 2]) };
  const risk = { count: 2, acceptable: Uint8Array.from([1, 1]),
    dominated: new Uint8Array(2), immediateFatalMass: new Uint16Array(2),
    horizonFatalMass: new Uint16Array(2), unknownMass: new Uint16Array(2),
    earliestFatalFrame: Uint8Array.from([255, 255]),
    escapeSlack: new Int8Array(2) };
  const engine = { ourCount: 2, enemyCount: 2,
    ourActions: Uint8Array.from([0, 1]),
    enemyActions: Uint8Array.from([1, 2]),
    enemyActionFamilies: new Uint8Array(8),
    actionFamilyForShadow: action => action,
    projectedCell: Uint16Array.from([4, 5]),
    projectedDirection: Uint8Array.from([1, 1]),
    starDistance: cell => cell === 4 ? 2 : 3,
    starDirectionHelpful: () => 0,
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    projectileAttack: pac, combat: { vector: combat },
    riskController: { outcome: risk, stateRiskClass: 0,
      riskProfile: new RiskProfile() },
    policy: { baseRisk: 65, opponent: {
      buildNominalPolicy(_families, count, _context, output) {
        if (count !== 2) return 0;
        output[0] = 8000; output[1] = 2000; return count;
      } }, }, opponentContext: () => 0 };
  return { interval, pac, combat, risk, engine };
}

test("combat utility keeps worst-case pollution at every registered risk", () => {
  const built = fixture();
  const shadow = new CombatUtilityEnvelopeShadow(built.interval);
  shadow.observe(built.engine); shadow.observe(built.engine);
  const summary = shadow.summary();
  assert.equal(summary.evaluationCount, 1);
  assert.equal(summary.duplicateSkipCount, 1);
  assert.equal(summary.lastWorst[METRIC.ELIMINATION], 0);
  assert.equal(summary.lastNominal[METRIC.ELIMINATION], 8000);
  assert.equal(summary.lastRobust[METRIC.ELIMINATION], 0);
  const risk100 = 5 * METRIC.COUNT + METRIC.ELIMINATION;
  assert.equal(summary.lastRobust[risk100], 7920);
  for (let index = 1; index < summary.riskPoints.length; index += 1) {
    const prior = summary.lastRobust[(index - 1) * METRIC.COUNT];
    const current = summary.lastRobust[index * METRIC.COUNT];
    assert.ok(current >= prior);
  }
  assert.deepEqual(summary.offensiveGainByRisk, [0, 1, 1, 1, 1, 1]);
  assert.equal(summary.currentRiskQualifiedCount, 1);
  assert.equal(summary.starOpportunityCostCount, 1);
  assert.equal(summary.resourceCostCount, 1);
  assert.equal(summary.lastRelation, RELATION.TRADEOFF);
  assert.equal(summary.nominalDoomedMassTotal, 8000);
  assert.equal(summary.uniformDoomedMassTotal, 5000);
  assert.equal(summary.opponentModelInfluenceCount, 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("risk, combat and PAC source slabs are not rewritten", () => {
  const built = fixture();
  const riskBefore = Array.from(built.risk.acceptable);
  const statusBefore = Array.from(built.pac.cellStatus);
  const resourceBefore = Array.from(built.combat.resourceOccupancy);
  const shadow = new CombatUtilityEnvelopeShadow(built.interval);
  shadow.observe(built.engine);
  assert.deepEqual(Array.from(built.risk.acceptable), riskBefore);
  assert.deepEqual(Array.from(built.pac.cellStatus), statusBefore);
  assert.deepEqual(Array.from(built.combat.resourceOccupancy), resourceBefore);
});

test("incomplete PAC and invalid probability support fail closed", () => {
  const incomplete = fixture();
  incomplete.pac.unknownEnemyColumns[1] = 1;
  const first = new CombatUtilityEnvelopeShadow(incomplete.interval);
  first.observe(incomplete.engine);
  assert.equal(first.summary().evaluationCount, 0);
  assert.equal(first.summary().pacIncompleteCount, 1);

  const probability = fixture();
  probability.engine.policy.opponent.buildNominalPolicy =
    (_families, count, _context, output) => {
      output[0] = 7000; output[1] = 2000; return count;
    };
  const second = new CombatUtilityEnvelopeShadow(probability.interval);
  second.observe(probability.engine);
  assert.equal(second.summary().evaluationCount, 0);
  assert.equal(second.summary().probabilityIncompleteCount, 1);
});

test("riskier counter-exposure remains a tradeoff, never a qualified attack", () => {
  const built = fixture();
  built.combat.ownCounterExposure[1] = 2000;
  const shadow = new CombatUtilityEnvelopeShadow(built.interval);
  shadow.observe(built.engine);
  const summary = shadow.summary();
  assert.equal(summary.offensiveGainCount, 1);
  assert.equal(summary.safetyNonRegressionCount, 0);
  assert.equal(summary.currentRiskQualifiedCount, 0);
  assert.equal(summary.lastRelation, RELATION.TRADEOFF);
});
