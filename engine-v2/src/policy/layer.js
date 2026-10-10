"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { SKILL, ACTION } = require("../abi/fast-codes");
const { ACTION_FAMILY, PLAN_KIND, PLAN_PURPOSE, GLOBAL_MODE } = require("../abi/policy-codes");
const { FeatureRegistry } = require("./feature-registry");
const { FeatureInputFrame, WeightBank, TableEvaluator, GeneratedEvaluator } = require("./evaluator");
const { StrategyInputFrame, StrategySelector } = require("./strategy-selector");
const { StrategyBandSlab, StrategicArbiter } = require("./strategy-layer");
const { STRATEGY_CONFIG } = require("../generated/policy-config");
const { OpponentModel } = require("./opponent-model");
const { EnemySkillDescriptorTable, createOwnSkillEmitter } = require("./skill-policy");
const { PlanSketchArena, PersistentPlanArena } = require("./plan");
const { HiddenRiskField } = require("./hidden-risk");
const { ProposalVerificationArbiter } = require("./proposal-verification-arbiter");

function actionFamily(action) {
  if (action === ACTION.GO) return ACTION_FAMILY.MOVE;
  if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) return ACTION_FAMILY.TURN;
  if (action === ACTION.FIRE) return ACTION_FAMILY.FIRE;
  if (action === ACTION.THROW_BOMB) return ACTION_FAMILY.BOMB;
  if (action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST) return ACTION_FAMILY.SKILL;
  return ACTION_FAMILY.HOLD;
}

class PolicyLayer {
  constructor(options = {}) {
    this.registry = options.registry || new FeatureRegistry(); this.weights = options.weights || new WeightBank();
    this.featureInput = options.featureInput || new FeatureInputFrame();
    this.strategyInput = options.strategyInput || new StrategyInputFrame();
    this.tableEvaluator = new TableEvaluator({ registry: this.registry, weights: this.weights });
    this.generatedEvaluator = new GeneratedEvaluator({ registry: this.registry, weights: this.weights });
    this.evaluator = options.generated === false ? this.tableEvaluator : this.generatedEvaluator;
    this.selector = new StrategySelector(); this.strategyBands = new StrategyBandSlab();
    this.strategicArbiter = new StrategicArbiter();
    this.proposalArbiter = new ProposalVerificationArbiter();
    this.opponent = new OpponentModel();
    this.skillDescriptors = new EnemySkillDescriptorTable();
    this.ownSkill = createOwnSkillEmitter(options.ownSkillId || SKILL.POISON, this.skillDescriptors);
    this.sketches = new PlanSketchArena(); this.plans = new PersistentPlanArena();
    this.hidden = new HiddenRiskField(options.cellCount || 1024);
    this.enemyProbability = new Uint16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.lastScore = 0; this.baseRisk = STRATEGY_CONFIG.DEFAULT_BASE_RISK;
    this.evalProfileId = STRATEGY_CONFIG.CANONICAL_EVAL_PROFILE;
    this.strategyId = STRATEGY_CONFIG.DEFAULT_STRATEGY;
    this.opponentEpoch = 0; this.prepareCount = 0; this.hotAllocationCount = 0;
  }
  beginMatch(matchGeneration) { this.opponent.reset(matchGeneration); this.selector.reset();
    this.sketches.reset(); this.plans.reset(); this.hidden.clear(); }
  prepareNeutralSearch(featureInput = this.featureInput, action = ACTION.NONE,
      planKind = PLAN_KIND.NONE) {
    this.evalProfileId = STRATEGY_CONFIG.CANONICAL_EVAL_PROFILE;
    this.baseRisk = STRATEGY_CONFIG.DEFAULT_BASE_RISK;
    this.lastScore = this.evaluator.evaluate(featureInput, this.evalProfileId,
      actionFamily(action), planKind); this.opponentEpoch = this.opponent.freezeForSearch();
    this.prepareCount += 1; return this;
  }
  prepareStrategyPortfolio(strategyInput = this.strategyInput,
      globalMode = GLOBAL_MODE.NORMAL) {
    return this.selector.prepare(strategyInput, globalMode);
  }
  commitSelectedStrategy(strategyId, globalMode = GLOBAL_MODE.NORMAL) {
    this.strategyId = this.selector.commitSelected(strategyId, globalMode);
    return this.strategyId;
  }
  prepareSearch(featureInput = this.featureInput, strategyInput = this.strategyInput,
      globalMode = GLOBAL_MODE.NORMAL, action = ACTION.NONE, planKind = PLAN_KIND.NONE) {
    this.prepareNeutralSearch(featureInput, action, planKind);
    this.strategyId = this.selector.select(strategyInput, globalMode); return this;
  }
  scoreAction(featureInput, action, planKind = PLAN_KIND.NONE) {
    this.evaluator.evaluateRaw(featureInput); return this.evaluator.score(this.evalProfileId,
      actionFamily(action), planKind);
  }
  createActionSketch(action, argument, purpose, deadline, dependencyMask, targetSignature, rawScore) {
    let kind = PLAN_KIND.NONE;
    if (action === ACTION.FIRE) kind = PLAN_KIND.SHOT;
    else if (action === ACTION.THROW_BOMB) kind = PLAN_KIND.BOMB;
    else if (action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST) kind = PLAN_KIND.SKILL;
    else if (action === ACTION.GO || action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT)
      kind = PLAN_KIND.NAVIGATION;
    if (kind === PLAN_KIND.NONE) return 0xffffffff;
    return this.sketches.create(kind, purpose || PLAN_PURPOSE.DIRECT_KILL, action, argument,
      deadline, dependencyMask, targetSignature, rawScore);
  }
}

module.exports = { actionFamily, PolicyLayer };
