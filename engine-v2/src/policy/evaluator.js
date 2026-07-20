"use strict";

const { POLICY_CAPACITY, SCORE, PROFILE_WEIGHTS } = require("../generated/policy-config");
const { FEATURE, FEATURE_INPUT, FEATURE_HANDLER, FEATURE_COST, EVAL_PROFILE,
  ACTION_FAMILY, PLAN_KIND, FEATURE_OWNERSHIP } = require("../abi/policy-codes");
const { FeatureRegistry } = require("./feature-registry");

function clamp(value, minimum, maximum) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}
function divideSigned(value, divisor) {
  return value < 0 ? -Math.floor((-value) / divisor) : Math.floor(value / divisor);
}

class FeatureInputFrame {
  constructor() {
    this.values = new Int16Array(POLICY_CAPACITY.INPUT_COUNT);
    this.generation = 0; this.dirtyMask = 0xffffffff; this.hotAllocationCount = 0;
  }
  reset() { this.values.fill(0); this.generation += 1; this.dirtyMask = 0xffffffff; }
  set(index, value) {
    if (index < 0 || index >= FEATURE_INPUT.COUNT || !Number.isSafeInteger(value)) return 0;
    const normalized = clamp(value, SCORE.RAW_MIN, SCORE.RAW_MAX);
    if (this.values[index] !== normalized) { this.values[index] = normalized;
      this.dirtyMask = (this.dirtyMask | (1 << (index & 31))) >>> 0; }
    return 1;
  }
}

class WeightBank {
  constructor() {
    const features = POLICY_CAPACITY.FEATURE_COUNT; const profiles = POLICY_CAPACITY.PROFILE_COUNT;
    this.profile = new Int16Array(profiles * features); this.profile.set(PROFILE_WEIGHTS);
    this.actionDelta = new Int16Array(profiles * POLICY_CAPACITY.ACTION_FAMILY_COUNT * features);
    this.planDelta = new Int16Array(profiles * PLAN_KIND.COUNT * features);
    this.frozen = 0; this.generation = 1; this.hotAllocationCount = 0;
  }
  index(profile, group, feature, groups) {
    if (profile < 0 || profile >= EVAL_PROFILE.COUNT || group < 0 || group >= groups ||
        feature < 0 || feature >= FEATURE.COUNT) return -1;
    return (profile * groups + group) * FEATURE.COUNT + feature;
  }
  configureAction(profile, family, feature, value) {
    if (this.frozen || !Number.isSafeInteger(value)) return 0;
    const index = this.index(profile, family, feature, ACTION_FAMILY.COUNT); if (index < 0) return 0;
    this.actionDelta[index] = clamp(value, -100, 100); this.generation += 1; return 1;
  }
  configurePlan(profile, kind, feature, value) {
    if (this.frozen || !Number.isSafeInteger(value)) return 0;
    const index = this.index(profile, kind, feature, PLAN_KIND.COUNT); if (index < 0) return 0;
    this.planDelta[index] = clamp(value, -100, 100); this.generation += 1; return 1;
  }
  freeze() { this.frozen = 1; return this.generation; }
  score(raw, profile, actionFamily = ACTION_FAMILY.HOLD, planKind = PLAN_KIND.NONE) {
    if (profile < 0 || profile >= EVAL_PROFILE.COUNT || actionFamily < 0 ||
        actionFamily >= ACTION_FAMILY.COUNT || planKind < 0 || planKind >= PLAN_KIND.COUNT) return 0;
    const base = profile * FEATURE.COUNT; const actionBase =
      (profile * ACTION_FAMILY.COUNT + actionFamily) * FEATURE.COUNT;
    const planBase = (profile * PLAN_KIND.COUNT + planKind) * FEATURE.COUNT;
    let total = 0;
    for (let feature = 0; feature < FEATURE.COUNT; feature += 1) {
      const weight = this.profile[base + feature] + this.actionDelta[actionBase + feature] +
        this.planDelta[planBase + feature]; total += raw[feature] * weight;
    }
    return clamp(divideSigned(total, SCORE.WEIGHT_SCALE), SCORE.POINT_MIN, SCORE.POINT_MAX);
  }
}

class EvaluatorBase {
  constructor(options = {}) {
    this.registry = options.registry || new FeatureRegistry();
    this.weights = options.weights || new WeightBank();
    this.raw = new Int16Array(POLICY_CAPACITY.MAX_FEATURES);
    this.rawGeneration = 0; this.rawComputeCount = 0; this.dotProductCount = 0;
    this.hotAllocationCount = 0;
  }
  score(profile, actionFamily, planKind) {
    this.dotProductCount += 1; return this.weights.score(this.raw, profile, actionFamily, planKind);
  }
}

class TableEvaluator extends EvaluatorBase {
  evaluateFeature(feature, input) {
    if (feature < 0 || feature >= this.registry.count) return 0;
    if (this.registry.ownership[feature] !== FEATURE_OWNERSHIP.TACTICAL) {
      this.raw[feature] = 0; return 0;
    }
    const source = input.values[this.registry.inputIndex[feature]];
    const value = this.registry.handlerCode[feature] === FEATURE_HANDLER.INVERT_10000 ?
      10000 - source : source;
    this.raw[feature] = clamp(value, this.registry.minimum[feature], this.registry.maximum[feature]);
    return this.raw[feature];
  }
  evaluateRaw(input, maximumTier = FEATURE_COST.FINALIST) {
    const values = input.values;
    for (let feature = 0; feature < this.registry.count; feature += 1) {
      if (this.registry.costTier[feature] > maximumTier) { this.raw[feature] = 0; continue; }
      this.evaluateFeature(feature, input);
    }
    this.rawGeneration = input.generation; this.rawComputeCount += 1; input.dirtyMask = 0; return this.raw;
  }
  evaluate(input, profile, actionFamily, planKind, maximumTier) {
    this.evaluateRaw(input, maximumTier); return this.score(profile, actionFamily, planKind);
  }
}

class GeneratedEvaluator extends EvaluatorBase {
  evaluateRaw(input, maximumTier = FEATURE_COST.FINALIST) {
    const v = input.values; const r = this.raw; r.fill(0);
    if (maximumTier >= 0) { r[FEATURE.STAR_DELTA] = v[FEATURE_INPUT.STAR_DELTA];
      r[FEATURE.SHIELD_RESERVE] = v[FEATURE_INPUT.SHIELD_RESERVE];
      r[FEATURE.RESOURCE_READY] = v[FEATURE_INPUT.RESOURCE_READY];
      r[FEATURE.TERMINAL_URGENCY] = v[FEATURE_INPUT.TERMINAL_URGENCY];
      r[FEATURE.LEAD_SECURITY] = v[FEATURE_INPUT.LEAD_SECURITY];
      r[FEATURE.COMEBACK_PRESSURE] = v[FEATURE_INPUT.COMEBACK_PRESSURE]; }
    if (maximumTier >= 1) { r[FEATURE.STAR_RACE] = v[FEATURE_INPUT.STAR_RACE];
      r[FEATURE.SAFE_SUCCESSORS] = v[FEATURE_INPUT.SAFE_SUCCESSORS];
      r[FEATURE.MOBILITY] = v[FEATURE_INPUT.MOBILITY];
      r[FEATURE.COMPUTE_COST] = v[FEATURE_INPUT.COMPUTE_COST]; }
    if (maximumTier >= 2) { r[FEATURE.DANGER_SLACK] = v[FEATURE_INPUT.DANGER_SLACK];
      r[FEATURE.DIRECT_HIT_WINDOW] = v[FEATURE_INPUT.DIRECT_HIT_WINDOW];
      r[FEATURE.ESCAPE_DENIAL] = 10000 - v[FEATURE_INPUT.ENEMY_ESCAPE_OPTIONS];
      r[FEATURE.CHOKE_CONTROL] = v[FEATURE_INPUT.CHOKE_CONTROL];
      r[FEATURE.POSSIBLE_SHOT_EXPOSURE] = v[FEATURE_INPUT.POSSIBLE_SHOT_EXPOSURE];
      r[FEATURE.INFORMATION_CONTROL] = v[FEATURE_INPUT.INFORMATION_CONTROL];
      r[FEATURE.SKILL_WINDOW] = v[FEATURE_INPUT.SKILL_WINDOW];
      r[FEATURE.OPPONENT_ATTACK_FIT] = v[FEATURE_INPUT.OPPONENT_ATTACK];
      r[FEATURE.OPPONENT_CONTEST_FIT] = v[FEATURE_INPUT.OPPONENT_CONTEST]; }
    if (maximumTier >= 3) { r[FEATURE.BELIEF_SWEEP_COVERAGE] = v[FEATURE_INPUT.BELIEF_SWEEP_COVERAGE];
      r[FEATURE.PLAN_PROGRESS] = v[FEATURE_INPUT.PLAN_PROGRESS]; }
    for (let feature = 0; feature < this.registry.count; feature += 1)
      r[feature] = clamp(r[feature], this.registry.minimum[feature], this.registry.maximum[feature]);
    r[FEATURE.DANGER_SLACK] = 0; r[FEATURE.POSSIBLE_SHOT_EXPOSURE] = 0;
    r[FEATURE.OPPONENT_ATTACK_FIT] = 0; r[FEATURE.DIRECT_HIT_WINDOW] = 0;
    r[FEATURE.ESCAPE_DENIAL] = 0;
    this.rawGeneration = input.generation; this.rawComputeCount += 1; input.dirtyMask = 0; return r;
  }
  evaluate(input, profile, actionFamily, planKind, maximumTier) {
    this.evaluateRaw(input, maximumTier); return this.score(profile, actionFamily, planKind);
  }
}

module.exports = { clamp, divideSigned, FeatureInputFrame, WeightBank, TableEvaluator,
  GeneratedEvaluator };
