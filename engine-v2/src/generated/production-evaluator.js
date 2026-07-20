"use strict";

const { PROFILE_WEIGHTS, SCORE, POLICY_CAPACITY } = require("./policy-config");
const { FEATURE, FEATURE_INPUT } = require("../abi/policy-codes");

function clampProduction(value, minimum, maximum) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}
function divideProduction(value, divisor) {
  return value < 0 ? -Math.floor((-value) / divisor) : Math.floor(value / divisor);
}

class ProductionGeneratedEvaluator {
  constructor() {
    this.input = new Int16Array(POLICY_CAPACITY.INPUT_COUNT);
    this.raw = new Int16Array(POLICY_CAPACITY.MAX_FEATURES);
    this.weights = new Int16Array(PROFILE_WEIGHTS); this.hotAllocationCount = 0;
  }
  set(index, value) { if (index < 0 || index >= FEATURE_INPUT.COUNT) return 0;
    this.input[index] = clampProduction(value, -10000, 10000); return 1; }
  evaluateRaw() {
    const v = this.input; const r = this.raw;
    r[FEATURE.STAR_DELTA] = v[FEATURE_INPUT.STAR_DELTA];
    r[FEATURE.STAR_RACE] = v[FEATURE_INPUT.STAR_RACE];
    r[FEATURE.SAFE_SUCCESSORS] = Math.max(0, v[FEATURE_INPUT.SAFE_SUCCESSORS]);
    r[FEATURE.DANGER_SLACK] = Math.max(0, v[FEATURE_INPUT.DANGER_SLACK]);
    r[FEATURE.SHIELD_RESERVE] = Math.max(0, v[FEATURE_INPUT.SHIELD_RESERVE]);
    r[FEATURE.DIRECT_HIT_WINDOW] = Math.max(0, v[FEATURE_INPUT.DIRECT_HIT_WINDOW]);
    r[FEATURE.ESCAPE_DENIAL] = clampProduction(10000 - v[FEATURE_INPUT.ENEMY_ESCAPE_OPTIONS], 0, 10000);
    for (let feature = FEATURE.MOBILITY; feature < FEATURE.COUNT; feature += 1)
      r[feature] = Math.max(0, v[feature]);
    r[FEATURE.DANGER_SLACK] = 0; r[FEATURE.POSSIBLE_SHOT_EXPOSURE] = 0;
    r[FEATURE.OPPONENT_ATTACK_FIT] = 0;
    return r;
  }
  score(profile) {
    this.evaluateRaw(); let total = 0; const base = profile * FEATURE.COUNT;
    for (let feature = 0; feature < FEATURE.COUNT; feature += 1)
      total += this.raw[feature] * this.weights[base + feature];
    return clampProduction(divideProduction(total, SCORE.WEIGHT_SCALE), SCORE.POINT_MIN, SCORE.POINT_MAX);
  }
}

module.exports = { ProductionGeneratedEvaluator };
