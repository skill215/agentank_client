"use strict";

// Behavior-neutral, allocation-free combat utility evidence.  This consumes
// the already computed Risk, CombatVector and ProjectileAttackClosure slabs.
// It never applies a transition, changes an action, or compresses the vector
// into a single score.  Enemy-action values are backed up with the same
// epsilon-contamination rule as production Risk: risk=100 still retains one
// percent of the worst case.

const { HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { PROBABILITY_SCALE, RISK_DIMENSION } = require(
  "../../../engine-v2/src/abi/search-codes");
const { contaminatedLower } = require(
  "../../../engine-v2/src/search/fixed-math");
const { PAC_STATUS, PAC_CELL } = require(
  "../../../engine-v2/src/search/projectile-attack-closure");
const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { LONG_OPTION, OPTION_NAME } = require("./event-driven-option-shadow");

const RISK_POINTS = Object.freeze([0, 25, 50, 65, 75, 100]);
const METRIC = Object.freeze({
  ELIMINATION: 0,
  PRESSURE: 1,
  MOBILITY_LOSS: 2,
  ENDPOINT_REDUCTION: 3,
  COUNTERFIRE_DELAY: 4,
  COUNT: 5
});
const RELATION = Object.freeze({
  EQUAL: 0,
  ATTACK_DOMINATES: 1,
  INCUMBENT_DOMINATES: 2,
  TRADEOFF: 3
});

function clamp(value, minimum, maximum) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

class CombatUtilityEnvelopeShadow {
  constructor(interval) {
    this.interval = interval;
    this.enemyProbability = new Uint16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.nominal = new Int32Array(METRIC.COUNT);
    this.worst = new Int16Array(METRIC.COUNT);
    this.robust = new Int16Array(RISK_POINTS.length * METRIC.COUNT);
    this.offensiveGainByRisk = new Uint32Array(RISK_POINTS.length);
    this.qualifiedByRisk = new Uint32Array(RISK_POINTS.length);
    this.evaluationBySelectedKind = new Uint32Array(LONG_OPTION.COUNT);
    this.qualifiedWithoutStarCostBySelectedKind =
      new Uint32Array(LONG_OPTION.COUNT);
    this.observationCount = 0; this.evaluationCount = 0;
    this.duplicateSkipCount = 0; this.invalidRowCount = 0;
    this.hardSkipCount = 0; this.riskSkipCount = 0;
    this.pacIncompleteCount = 0; this.probabilityIncompleteCount = 0;
    this.attackDominatesCount = 0; this.incumbentDominatesCount = 0;
    this.tradeoffCount = 0; this.equalCount = 0;
    this.offensiveGainCount = 0; this.safetyNonRegressionCount = 0;
    this.resourceCostCount = 0; this.starOpportunityCostCount = 0;
    this.starPathProgressCostCount = 0;
    this.attackDeadlineEarlierCount = 0; this.attackDeadlineEqualCount = 0;
    this.attackDeadlineLaterCount = 0;
    this.deadlineBalancedQualifiedCount = 0;
    this.currentRiskQualifiedCount = 0;
    this.currentRiskQualifiedWithoutStarCostCount = 0;
    this.opponentModelInfluenceCount = 0;
    this.nominalDoomedMassTotal = 0; this.uniformDoomedMassTotal = 0;
    this.lastEvaluationSerial = 0; this.lastAttackRow = -1;
    this.lastSelectedRow = -1; this.lastRelation = RELATION.EQUAL;
    this.lastCurrentRiskIndex = -1; this.lastCurrentRiskQualified = 0;
    this.hotAllocationCount = 0;
  }

  metricValue(pac, at, metric) {
    const status = pac.cellStatus[at];
    if (status === PAC_CELL.PROVEN_DOOMED) {
      if (metric === METRIC.ELIMINATION || metric === METRIC.PRESSURE)
        return 10000;
      if (metric === METRIC.COUNTERFIRE_DELAY) return 255;
      return 0;
    }
    if (status !== PAC_CELL.SURVIVES) return 0;
    if (metric === METRIC.PRESSURE) return clamp(pac.cellPressure[at], 0, 10000);
    if (metric === METRIC.MOBILITY_LOSS) return pac.cellMobilityLoss[at];
    if (metric === METRIC.ENDPOINT_REDUCTION)
      return clamp(pac.cellEndpointReduction[at], 0, 10000);
    if (metric === METRIC.COUNTERFIRE_DELAY) return pac.cellSetupDelay[at];
    return 0;
  }

  buildEnemyBackup(engine, row) {
    const pac = engine.projectileAttackClosure || engine.projectileAttack;
    const count = engine.enemyCount;
    for (let column = 0; column < count; column += 1)
      engine.enemyActionFamilies[column] = engine.actionFamilyForShadow(
        engine.enemyActions[column]);
    const nominalCount = engine.policy.opponent.buildNominalPolicy(
      engine.enemyActionFamilies, count, engine.opponentContext(),
      this.enemyProbability);
    if (nominalCount !== count) return 0;
    let probabilitySum = 0; let doomedMass = 0;
    for (let column = 0; column < count; column += 1) {
      probabilitySum += this.enemyProbability[column];
      const at = row * pac.maxEnemy + column;
      if (pac.cellStatus[at] === PAC_CELL.PROVEN_DOOMED)
        doomedMass += this.enemyProbability[column];
    }
    if (probabilitySum !== PROBABILITY_SCALE) return 0;
    this.nominalDoomedMassTotal += doomedMass;
    this.uniformDoomedMassTotal += Math.floor(
      pac.doomedEnemyColumns[row] * PROBABILITY_SCALE / count);
    this.nominal.fill(0); this.worst.fill(10000);
    for (let metric = 0; metric < METRIC.COUNT; metric += 1) {
      let nominal = 0; let worst = 10000;
      for (let column = 0; column < count; column += 1) {
        const at = row * pac.maxEnemy + column;
        const value = this.metricValue(pac, at, metric);
        nominal += this.enemyProbability[column] * value;
        if (value < worst) worst = value;
      }
      this.nominal[metric] = Math.floor(nominal / PROBABILITY_SCALE);
      this.worst[metric] = worst;
    }
    return 1;
  }

  backupAtRisk(engine, row, riskPoint, output, offset = 0) {
    if (!this.buildEnemyBackup(engine, row)) return 0;
    const point = clamp(riskPoint | 0, 0, 100);
    const lambda = engine.riskController.riskProfile.lambda(point,
      engine.riskController.stateRiskClass, RISK_DIMENSION.ENEMY_ACTION);
    if (lambda < 0 || !output || offset < 0 ||
        offset + METRIC.COUNT > output.length) return 0;
    for (let metric = 0; metric < METRIC.COUNT; metric += 1)
      output[offset + metric] = contaminatedLower(lambda,
        this.nominal[metric], this.worst[metric]);
    return 1;
  }

  combatRelation(combat, attack, selected, riskOffset) {
    let attackBetter = 0; let incumbentBetter = 0;
    for (let metric = 0; metric < METRIC.COUNT; metric += 1) {
      const attackValue = this.robust[riskOffset + metric];
      // StableOptionInterval compares ATTACK against STAR/POSITION/TERMINAL.
      // Those actions create no attack-closure response compression.
      const selectedValue = 0;
      if (attackValue > selectedValue) attackBetter = 1;
      else if (attackValue < selectedValue) incumbentBetter = 1;
    }
    if (combat.postFireEscape[attack] > combat.postFireEscape[selected]) attackBetter = 1;
    else if (combat.postFireEscape[attack] < combat.postFireEscape[selected])
      incumbentBetter = 1;
    if (combat.ownCounterExposure[attack] < combat.ownCounterExposure[selected])
      attackBetter = 1;
    else if (combat.ownCounterExposure[attack] > combat.ownCounterExposure[selected])
      incumbentBetter = 1;
    if (combat.resourceOccupancy[attack] < combat.resourceOccupancy[selected])
      attackBetter = 1;
    else if (combat.resourceOccupancy[attack] > combat.resourceOccupancy[selected])
      incumbentBetter = 1;
    if (attackBetter && incumbentBetter) return RELATION.TRADEOFF;
    if (attackBetter) return RELATION.ATTACK_DOMINATES;
    if (incumbentBetter) return RELATION.INCUMBENT_DOMINATES;
    return RELATION.EQUAL;
  }

  safetyNonRegressive(risk, combat, attack, selected) {
    return risk.immediateFatalMass[attack] <= risk.immediateFatalMass[selected] &&
      risk.horizonFatalMass[attack] <= risk.horizonFatalMass[selected] &&
      risk.unknownMass[attack] <= risk.unknownMass[selected] &&
      risk.earliestFatalFrame[attack] >= risk.earliestFatalFrame[selected] &&
      risk.escapeSlack[attack] >= risk.escapeSlack[selected] &&
      combat.postFireEscape[attack] > 0 &&
      combat.ownCounterExposure[attack] <= combat.ownCounterExposure[selected];
  }

  observe(engine) {
    this.observationCount += 1;
    if (!this.interval || this.interval.evaluationSerial === this.lastEvaluationSerial) {
      this.duplicateSkipCount += 1; return;
    }
    this.lastEvaluationSerial = this.interval.evaluationSerial;
    const attack = this.interval.lastAttackRow;
    const selected = this.interval.lastSelectedRow;
    if (!engine || attack < 0 || selected < 0 || attack >= engine.ourCount ||
        selected >= engine.ourCount) { this.invalidRowCount += 1; return; }
    if (engine.hardStatus[attack] !== HARD_STATUS.ALLOW ||
        engine.hardStatus[selected] !== HARD_STATUS.ALLOW) {
      this.hardSkipCount += 1; return;
    }
    const risk = engine.riskController && engine.riskController.outcome;
    if (!risk || attack >= risk.count || selected >= risk.count ||
        !risk.acceptable[attack] || risk.dominated[attack]) {
      this.riskSkipCount += 1; return;
    }
    const pac = engine.projectileAttackClosure || engine.projectileAttack;
    const combat = engine.combat && engine.combat.vector;
    if (!pac || !combat || pac.status[attack] !== PAC_STATUS.COMPLETE ||
        combat.attackClosureStatus[attack] !== PAC_STATUS.COMPLETE ||
        pac.unknownEnemyColumns[attack] !== 0 || engine.enemyCount < 1) {
      this.pacIncompleteCount += 1; return;
    }
    if (!this.buildEnemyBackup(engine, attack)) {
      this.probabilityIncompleteCount += 1; return;
    }
    this.evaluationCount += 1; this.lastAttackRow = attack;
    this.lastSelectedRow = selected;
    const selectedKind = this.interval.ledger ?
      this.interval.ledger.lastSelectedKind : LONG_OPTION.NONE;
    if (selectedKind >= 0 && selectedKind < LONG_OPTION.COUNT)
      this.evaluationBySelectedKind[selectedKind] += 1;
    const stateClass = engine.riskController.stateRiskClass;
    const baseRisk = clamp(engine.policy.baseRisk | 0, 0, 100);
    const safe = this.safetyNonRegressive(risk, combat, attack, selected);
    const riskOpen = this.interval.lastRiskIncumbentLower <=
      this.interval.lastRiskAttackUpper;
    const starCost = this.interval.rollout.starGain[attack] <
      this.interval.rollout.starGain[selected];
    const attackStarDistance = engine.starDistance(engine.projectedCell[attack]);
    const selectedStarDistance = engine.starDistance(engine.projectedCell[selected]);
    const attackHelpful = engine.starDirectionHelpful(engine.projectedCell[attack],
      engine.projectedDirection[attack]);
    const selectedHelpful = engine.starDirectionHelpful(engine.projectedCell[selected],
      engine.projectedDirection[selected]);
    const starPathCost = selectedStarDistance < attackStarDistance ||
      (selectedStarDistance === attackStarDistance && selectedHelpful && !attackHelpful);
    const attackDeadline = combat.hitDeadline[attack];
    const starDeadline = Math.max(1, selectedStarDistance + 1);
    if (safe) this.safetyNonRegressionCount += 1;
    if (combat.resourceOccupancy[attack] > combat.resourceOccupancy[selected])
      this.resourceCostCount += 1;
    if (starCost) this.starOpportunityCostCount += 1;
    if (starPathCost) this.starPathProgressCostCount += 1;
    let currentIndex = -1;
    for (let index = 0; index < RISK_POINTS.length; index += 1) {
      const point = RISK_POINTS[index];
      const lambda = engine.riskController.riskProfile.lambda(point,
        stateClass, RISK_DIMENSION.ENEMY_ACTION);
      const offset = index * METRIC.COUNT;
      let offensiveGain = 0;
      for (let metric = 0; metric < METRIC.COUNT; metric += 1) {
        const value = contaminatedLower(lambda, this.nominal[metric],
          this.worst[metric]);
        this.robust[offset + metric] = value;
        if (value > 0) offensiveGain = 1;
      }
      if (offensiveGain) this.offensiveGainByRisk[index] += 1;
      if (offensiveGain && safe && riskOpen) this.qualifiedByRisk[index] += 1;
      if (point === baseRisk) currentIndex = index;
    }
    // The production default (65) is registered explicitly.  For any future
    // non-registered profile, compute it in the final scratch slot without
    // changing the published calibration points.
    if (currentIndex < 0) {
      currentIndex = RISK_POINTS.indexOf(65);
      const lambda = engine.riskController.riskProfile.lambda(baseRisk,
        stateClass, RISK_DIMENSION.ENEMY_ACTION);
      const offset = currentIndex * METRIC.COUNT;
      for (let metric = 0; metric < METRIC.COUNT; metric += 1)
        this.robust[offset + metric] = contaminatedLower(lambda,
          this.nominal[metric], this.worst[metric]);
    }
    this.lastCurrentRiskIndex = currentIndex;
    const offset = currentIndex * METRIC.COUNT;
    let offensiveGain = 0;
    for (let metric = 0; metric < METRIC.COUNT; metric += 1)
      if (this.robust[offset + metric] > 0) offensiveGain = 1;
    if (offensiveGain) this.offensiveGainCount += 1;
    const qualified = offensiveGain && safe && riskOpen;
    this.lastCurrentRiskQualified = qualified ? 1 : 0;
    if (qualified) {
      this.currentRiskQualifiedCount += 1;
      if (!starCost) {
        this.currentRiskQualifiedWithoutStarCostCount += 1;
        if (selectedKind >= 0 && selectedKind < LONG_OPTION.COUNT)
          this.qualifiedWithoutStarCostBySelectedKind[selectedKind] += 1;
      }
      if (!starCost && attackDeadline <= starDeadline)
        this.deadlineBalancedQualifiedCount += 1;
    }
    if (attackDeadline < starDeadline) this.attackDeadlineEarlierCount += 1;
    else if (attackDeadline === starDeadline) this.attackDeadlineEqualCount += 1;
    else this.attackDeadlineLaterCount += 1;
    const relation = this.combatRelation(combat, attack, selected, offset);
    this.lastRelation = relation;
    if (relation === RELATION.ATTACK_DOMINATES) this.attackDominatesCount += 1;
    else if (relation === RELATION.INCUMBENT_DOMINATES)
      this.incumbentDominatesCount += 1;
    else if (relation === RELATION.TRADEOFF) this.tradeoffCount += 1;
    else this.equalCount += 1;
    const uniformMass = Math.floor(pac.doomedEnemyColumns[attack] *
      PROBABILITY_SCALE / engine.enemyCount);
    if (this.nominal[METRIC.ELIMINATION] !== uniformMass)
      this.opponentModelInfluenceCount += 1;
  }

  summary() {
    return { enabled: true, behaviorNeutral: true, noStateTransitions: true,
      multidimensional: true, epsilonContaminated: true,
      riskPoints: Array.from(RISK_POINTS),
      observationCount: this.observationCount,
      evaluationCount: this.evaluationCount,
      duplicateSkipCount: this.duplicateSkipCount,
      invalidRowCount: this.invalidRowCount,
      hardSkipCount: this.hardSkipCount,
      riskSkipCount: this.riskSkipCount,
      pacIncompleteCount: this.pacIncompleteCount,
      probabilityIncompleteCount: this.probabilityIncompleteCount,
      attackDominatesCount: this.attackDominatesCount,
      incumbentDominatesCount: this.incumbentDominatesCount,
      tradeoffCount: this.tradeoffCount, equalCount: this.equalCount,
      offensiveGainCount: this.offensiveGainCount,
      safetyNonRegressionCount: this.safetyNonRegressionCount,
      resourceCostCount: this.resourceCostCount,
      starOpportunityCostCount: this.starOpportunityCostCount,
      starPathProgressCostCount: this.starPathProgressCostCount,
      attackDeadlineEarlierCount: this.attackDeadlineEarlierCount,
      attackDeadlineEqualCount: this.attackDeadlineEqualCount,
      attackDeadlineLaterCount: this.attackDeadlineLaterCount,
      deadlineBalancedQualifiedCount: this.deadlineBalancedQualifiedCount,
      currentRiskQualifiedCount: this.currentRiskQualifiedCount,
      currentRiskQualifiedWithoutStarCostCount:
        this.currentRiskQualifiedWithoutStarCostCount,
      opponentModelInfluenceCount: this.opponentModelInfluenceCount,
      nominalDoomedMassTotal: this.nominalDoomedMassTotal,
      uniformDoomedMassTotal: this.uniformDoomedMassTotal,
      offensiveGainByRisk: Array.from(this.offensiveGainByRisk),
      qualifiedByRisk: Array.from(this.qualifiedByRisk),
      evaluationBySelectedKind: Object.fromEntries(OPTION_NAME.map(
        (name, index) => [name, this.evaluationBySelectedKind[index]])),
      qualifiedWithoutStarCostBySelectedKind: Object.fromEntries(OPTION_NAME.map(
        (name, index) => [name,
          this.qualifiedWithoutStarCostBySelectedKind[index]])),
      lastEvaluationSerial: this.lastEvaluationSerial,
      lastAttackRow: this.lastAttackRow, lastSelectedRow: this.lastSelectedRow,
      lastRelation: this.lastRelation,
      lastCurrentRiskIndex: this.lastCurrentRiskIndex,
      lastCurrentRiskQualified: this.lastCurrentRiskQualified,
      lastNominal: Array.from(this.nominal),
      lastWorst: Array.from(this.worst),
      lastRobust: Array.from(this.robust),
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { RISK_POINTS, METRIC, RELATION,
  CombatUtilityEnvelopeShadow };
