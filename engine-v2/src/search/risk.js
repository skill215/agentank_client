"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { VALUE_MIN, VALUE_MAX, PROBABILITY_SCALE, SEARCH_STATUS,
  RISK_DIMENSION } = require("../abi/search-codes");
const { weightedLower, weightedUpper, contaminatedLower,
  contaminatedUpper } = require("./fixed-math");

class RiskProfile {
  constructor() {
    const classes = SEARCH_CAPACITY.MAX_RISK_CLASSES;
    this.weights = new Uint16Array(101 * classes * 3);
    this.version = 1; this.profileId = 1;
    const classFactor = new Uint16Array([10000, 5000, 10000, 7500]);
    for (let risk = 0; risk <= 100; risk += 1) {
      const base = 99 * risk;
      for (let stateClass = 0; stateClass < classes; stateClass += 1) {
        const weight = Math.floor(base * classFactor[stateClass] / PROBABILITY_SCALE);
        for (let dimension = 0; dimension < 3; dimension += 1)
          this.weights[(risk * classes + stateClass) * 3 + dimension] = weight;
      }
    }
  }

  lambda(risk, stateClass, dimension) {
    if (!Number.isInteger(risk) || !Number.isInteger(stateClass) ||
        !Number.isInteger(dimension) || risk < 0 || risk > 100 || stateClass < 0 ||
        stateClass >= SEARCH_CAPACITY.MAX_RISK_CLASSES || dimension < 0 || dimension > 2) return -1;
    return this.weights[(risk * SEARCH_CAPACITY.MAX_RISK_CLASSES + stateClass) * 3 + dimension];
  }

  classify(starDelta, framesToTerminal, committedSlack, reversible,
      uncertaintyClass, commitmentClass) {
    if (starDelta > 0 && framesToTerminal <= 8 && committedSlack >= 0) return 1;
    if (starDelta < 0 && framesToTerminal <= 12 && reversible) return 2;
    if (uncertaintyClass > 1 || commitmentClass > 1) return 3;
    return 0;
  }
}

class RiskKernel {
  constructor(profile = new RiskProfile()) {
    this.profile = profile;
    this.lower = VALUE_MIN; this.upper = VALUE_MAX;
    this.expectedLower = VALUE_MIN; this.expectedUpper = VALUE_MAX;
    this.worstLower = VALUE_MIN; this.worstUpper = VALUE_MAX;
    this.lastLambda = 0; this.lastProbabilitySum = 0;
    this.hotAllocationCount = 0; this.backupCount = 0;
  }

  invalidate() {
    this.lower = VALUE_MIN; this.upper = VALUE_MAX;
    this.expectedLower = VALUE_MIN; this.expectedUpper = VALUE_MAX;
    this.worstLower = VALUE_MIN; this.worstUpper = VALUE_MAX;
  }

  backupIndexed(count, edgeStart, edgeChild, edgeProbability, childLower, childUpper,
      risk, stateClass, dimension, probabilityComplete = 1) {
    const lambda = this.profile.lambda(risk, stateClass, dimension);
    this.backupCount += 1; this.lastLambda = lambda; this.lastProbabilitySum = 0;
    if (!Number.isInteger(count) || !Number.isInteger(edgeStart) || edgeStart < 0 ||
        lambda < 0 || count < 1 || count > SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE ||
        !probabilityComplete) {
      this.invalidate(); return SEARCH_STATUS.INCOMPLETE;
    }
    let sumLower = 0; let sumUpper = 0; let worstLower = VALUE_MAX; let worstUpper = VALUE_MAX;
    for (let index = 0; index < count; index += 1) {
      const edge = edgeStart + index; const child = edgeChild[edge]; const probability = edgeProbability[edge];
      const lower = childLower[child]; const upper = childUpper[child];
      if (!Number.isInteger(child) || !Number.isInteger(probability) || probability < 0 ||
          probability > PROBABILITY_SCALE || !Number.isInteger(lower) || !Number.isInteger(upper) ||
          lower < VALUE_MIN || upper > VALUE_MAX || lower > upper) {
        this.invalidate(); return SEARCH_STATUS.INCOMPLETE;
      }
      this.lastProbabilitySum += probability; sumLower += probability * lower;
      sumUpper += probability * upper; if (lower < worstLower) worstLower = lower;
      if (upper < worstUpper) worstUpper = upper;
    }
    if (this.lastProbabilitySum !== PROBABILITY_SCALE) {
      this.invalidate(); return SEARCH_STATUS.INCOMPLETE;
    }
    this.expectedLower = weightedLower(sumLower); this.expectedUpper = weightedUpper(sumUpper);
    this.worstLower = worstLower; this.worstUpper = worstUpper;
    this.lower = contaminatedLower(lambda, this.expectedLower, worstLower);
    this.upper = contaminatedUpper(lambda, this.expectedUpper, worstUpper);
    return SEARCH_STATUS.COMPLETE;
  }

  transformEnemyMatrix(matrix, nominalProbability, risk, stateClass) {
    matrix.riskTransformed = 0;
    const lambda = this.profile.lambda(risk, stateClass, RISK_DIMENSION.ENEMY_ACTION);
    if (lambda < 0 || matrix.columns < 1) return SEARCH_STATUS.INCOMPLETE;
    let probabilitySum = 0;
    for (let column = 0; column < matrix.columns; column += 1)
      probabilitySum += nominalProbability[column];
    if (probabilitySum !== PROBABILITY_SCALE) return SEARCH_STATUS.INCOMPLETE;
    for (let row = 0; row < matrix.rows; row += 1) {
      let nominalLowerSum = 0; let nominalUpperSum = 0;
      for (let column = 0; column < matrix.columns; column += 1) {
        const at = row * matrix.maxColumns + column; const probability = nominalProbability[column];
        nominalLowerSum += probability * matrix.lower[at]; nominalUpperSum += probability * matrix.upper[at];
      }
      const nominalLower = weightedLower(nominalLowerSum);
      const nominalUpper = weightedUpper(nominalUpperSum);
      for (let column = 0; column < matrix.columns; column += 1) {
        const at = row * matrix.maxColumns + column;
        matrix.riskLower[at] = contaminatedLower(lambda, nominalLower, matrix.lower[at]);
        matrix.riskUpper[at] = contaminatedUpper(lambda, nominalUpper, matrix.upper[at]);
      }
    }
    matrix.riskTransformed = 1; return SEARCH_STATUS.COMPLETE;
  }
}

module.exports = { RiskProfile, RiskKernel };
