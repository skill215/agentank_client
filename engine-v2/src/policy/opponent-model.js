"use strict";

const { POLICY_CAPACITY, OPPONENT_CONFIG } = require("../generated/policy-config");
const { OPPORTUNITY, CHOICE, OPPONENT_EVENT, OPPONENT_CONTEXT,
  RISK_DIMENSION_PREFERENCE, ACTION_FAMILY } = require("../abi/policy-codes");

const EVENT_TO_DIMENSION = Object.freeze([
  RISK_DIMENSION_PREFERENCE.ATTACK_COMMITMENT,
  RISK_DIMENSION_PREFERENCE.RESOURCE_SPEND,
  RISK_DIMENSION_PREFERENCE.POSITION_CONTEST,
  RISK_DIMENSION_PREFERENCE.ATTACK_COMMITMENT,
  RISK_DIMENSION_PREFERENCE.RETREAT_PREFERENCE,
  RISK_DIMENSION_PREFERENCE.INFORMATION_GAMBLE,
  RISK_DIMENSION_PREFERENCE.SKILL_AGGRESSION,
  RISK_DIMENSION_PREFERENCE.TERMINAL_TRADE,
  RISK_DIMENSION_PREFERENCE.INFORMATION_GAMBLE,
  RISK_DIMENSION_PREFERENCE.POSITION_CONTEST
]);

function roundSignedProduct(alpha, delta) {
  const magnitude = Math.floor((alpha * Math.abs(delta) + 5000) / 10000);
  return delta < 0 ? -magnitude : magnitude;
}

class OpponentModel {
  constructor() {
    const count = POLICY_CAPACITY.OPPONENT_EVENT_COUNT * POLICY_CAPACITY.OPPONENT_CONTEXT_COUNT;
    this.fast = new Uint16Array(count); this.slow = new Uint16Array(count);
    this.opportunityMass = new Uint32Array(count); this.ambiguityMass = new Uint32Array(count);
    this.confidence = new Uint16Array(count); this.lastUpdateFrame = new Uint16Array(count);
    this.dimensionValue = new Uint16Array(POLICY_CAPACITY.RISK_DIMENSION_COUNT);
    this.dimensionConfidence = new Uint16Array(POLICY_CAPACITY.RISK_DIMENSION_COUNT);
    this.dimensionMass = new Uint32Array(POLICY_CAPACITY.RISK_DIMENSION_COUNT);
    this.rawProbability = new Uint32Array(ACTION_FAMILY.COUNT);
    this.remainder = new Uint32Array(ACTION_FAMILY.COUNT);
    this.fast.fill(OPPONENT_CONFIG.PRIOR); this.slow.fill(OPPONENT_CONFIG.PRIOR);
    this.dimensionValue.fill(OPPONENT_CONFIG.PRIOR);
    this.matchGeneration = 0; this.epoch = 1; this.frozenEpoch = 1; this.riskPreference = 50;
    this.riskConfidence = 0; this.ownParameterFingerprint = 0x5a17; this.updateCount = 0;
    this.queryCount = 0; this.hotAllocationCount = 0;
  }
  reset(matchGeneration) {
    this.fast.fill(OPPONENT_CONFIG.PRIOR); this.slow.fill(OPPONENT_CONFIG.PRIOR);
    this.opportunityMass.fill(0); this.ambiguityMass.fill(0); this.confidence.fill(0);
    this.lastUpdateFrame.fill(0); this.dimensionValue.fill(OPPONENT_CONFIG.PRIOR);
    this.dimensionConfidence.fill(0); this.dimensionMass.fill(0); this.matchGeneration = matchGeneration >>> 0;
    this.riskPreference = 50; this.riskConfidence = 0; this.epoch += 1; this.frozenEpoch = this.epoch;
  }
  slot(eventClass, contextClass) {
    if (eventClass < 0 || eventClass >= OPPONENT_EVENT.COUNT || contextClass < 0 ||
        contextClass >= OPPONENT_CONTEXT.COUNT) return -1;
    return eventClass * OPPONENT_CONTEXT.COUNT + contextClass;
  }
  refreshDimension(eventClass, value, confidence) {
    const dimension = EVENT_TO_DIMENSION[eventClass]; const mass = ++this.dimensionMass[dimension];
    this.dimensionValue[dimension] = Math.floor(((mass - 1) * this.dimensionValue[dimension] + value) / mass);
    this.dimensionConfidence[dimension] = Math.floor(((mass - 1) * this.dimensionConfidence[dimension] +
      confidence) / mass); let numerator = 0; let confidenceTotal = 0;
    for (let index = 0; index < RISK_DIMENSION_PREFERENCE.COUNT; index += 1) {
      const sign = index === RISK_DIMENSION_PREFERENCE.RETREAT_PREFERENCE ? -1 : 1;
      numerator += sign * (this.dimensionValue[index] - 5000); confidenceTotal += this.dimensionConfidence[index];
    }
    const centered = Math.floor(numerator / RISK_DIMENSION_PREFERENCE.COUNT);
    this.riskPreference = Math.max(0, Math.min(100, Math.floor((centered + 5000) / 100)));
    this.riskConfidence = Math.floor(confidenceTotal / RISK_DIMENSION_PREFERENCE.COUNT);
  }
  update(eventClass, contextClass, eligibility, choice, frame) {
    const slot = this.slot(eventClass, contextClass); if (slot < 0 || eligibility === OPPORTUNITY.BLOCKED) return 0;
    if (eligibility === OPPORTUNITY.POSSIBLE || choice === CHOICE.AMBIGUOUS) {
      this.ambiguityMass[slot] += 1; this.confidence[slot] = Math.max(0, this.confidence[slot] - 250);
      this.lastUpdateFrame[slot] = frame; this.epoch += 1; this.updateCount += 1; return 1;
    }
    if (eligibility !== OPPORTUNITY.CONFIRMED || (choice !== CHOICE.CHOSEN &&
        choice !== CHOICE.NOT_CHOSEN)) return 0;
    const target = choice === CHOICE.CHOSEN ? 10000 : 0;
    this.fast[slot] = Math.max(0, Math.min(10000, this.fast[slot] +
      roundSignedProduct(OPPONENT_CONFIG.ALPHA_FAST, target - this.fast[slot])));
    this.slow[slot] = Math.max(0, Math.min(10000, this.slow[slot] +
      roundSignedProduct(OPPONENT_CONFIG.ALPHA_SLOW, target - this.slow[slot])));
    this.opportunityMass[slot] += 1; const massConfidence = Math.min(10000,
      this.opportunityMass[slot] * OPPONENT_CONFIG.OPPORTUNITY_CONFIDENCE_STEP);
    const divergence = Math.abs(this.fast[slot] - this.slow[slot]);
    this.confidence[slot] = Math.max(0, massConfidence - Math.floor(divergence / 2) -
      Math.min(5000, this.ambiguityMass[slot] * 250)); this.lastUpdateFrame[slot] = frame;
    this.refreshDimension(eventClass, Math.floor((3 * this.fast[slot] + this.slow[slot]) / 4),
      this.confidence[slot]); this.epoch += 1; this.updateCount += 1; return 1;
  }
  freezeForSearch() { this.frozenEpoch = this.epoch; return this.frozenEpoch; }
  propensity(eventClass, contextClass) {
    const slot = this.slot(eventClass, contextClass); if (slot < 0) return OPPONENT_CONFIG.PRIOR;
    return Math.floor((3 * this.fast[slot] + this.slow[slot]) / 4);
  }
  buildNominalPolicy(actionFamilies, count, contextClass, outProbability) {
    if (count < 1 || count > actionFamilies.length || count > outProbability.length) return 0;
    let sum = 0;
    for (let index = 0; index < count; index += 1) {
      const family = actionFamilies[index]; let raw = 1000;
      if (family === ACTION_FAMILY.FIRE) raw += this.propensity(OPPONENT_EVENT.FIRE, contextClass) * 2;
      else if (family === ACTION_FAMILY.BOMB) raw += this.propensity(OPPONENT_EVENT.BOMB, contextClass);
      else if (family === ACTION_FAMILY.SKILL) raw += this.propensity(OPPONENT_EVENT.SKILL, contextClass);
      else if (family === ACTION_FAMILY.MOVE) raw += this.propensity(OPPONENT_EVENT.ADVANCE, contextClass);
      else if (family === ACTION_FAMILY.TURN) raw += this.propensity(OPPONENT_EVENT.TURN_EXTRA, contextClass);
      else raw += 5000 - Math.floor(this.riskPreference * 50);
      this.rawProbability[index] = raw; sum += raw;
    }
    let assigned = 0;
    for (let index = 0; index < count; index += 1) {
      const scaled = this.rawProbability[index] * OPPONENT_CONFIG.PROBABILITY_SCALE;
      outProbability[index] = Math.floor(scaled / sum); this.remainder[index] = scaled % sum;
      assigned += outProbability[index];
    }
    while (assigned < OPPONENT_CONFIG.PROBABILITY_SCALE) {
      let best = 0; for (let index = 1; index < count; index += 1)
        if (this.remainder[index] > this.remainder[best]) best = index;
      outProbability[best] += 1; this.remainder[best] = 0; assigned += 1;
    }
    this.queryCount += 1; return count;
  }
}

module.exports = { EVENT_TO_DIMENSION, roundSignedProduct, OpponentModel };
