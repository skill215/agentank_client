"use strict";

const { InformationGraph } = require("../search/graph");
const { SearchEngine } = require("../search/engine");
const { VALUE_MIN, VALUE_MAX } = require("../abi/search-codes");
const { ACTION } = require("../abi/fast-codes");
const { CACHE_ID, CACHE_FLAG, CACHE_DEPENDENCY, WORK_KIND } = require("../abi/cache-runtime-codes");
const { FEATURE_INPUT, STRATEGY_INPUT, OPPORTUNITY, CHOICE, OPPONENT_EVENT,
  OPPONENT_CONTEXT, PLAN_KIND, PLAN_PURPOSE } = require("../abi/policy-codes");
const { ProductionGeneratedEvaluator } = require("../generated/production-evaluator");
const { OwnPoisonEmitter, ProductionEnemySkillDescriptors } = require("../generated/production-poison-skill");
const { StrategyInputFrame, StrategySelector } = require("../policy/strategy-selector");
const { OpponentModel } = require("../policy/opponent-model");
const { PlanSketchArena, PersistentPlanArena } = require("../policy/plan");
const { ProductionCacheBank } = require("../cache/production-cache");
const { RuntimeController, RuntimeSearchCoordinator } = require("./controller");
const { ProductionRootEngine } = require("./production-root");

const persistentRoot = new ProductionRootEngine();
const ownEmitter = new OwnPoisonEmitter();
const enemyDescriptors = new ProductionEnemySkillDescriptors();

function runProductionFixture(seed = 1) {
  const evaluator = new ProductionGeneratedEvaluator();
  for (let index = 0; index < FEATURE_INPUT.COUNT; index += 1)
    evaluator.set(index, index < 2 ? index * 500 - 1000 : (seed + index * 431) % 10001);
  const score = evaluator.score(1); const strategyInput = new StrategyInputFrame();
  strategyInput.set(STRATEGY_INPUT.DIRECT_HIT_WINDOW, 9000);
  strategyInput.set(STRATEGY_INPUT.OPPONENT_ATTACK, 8000); const selector = new StrategySelector();
  for (let index = 0; index < 4; index += 1) selector.select(strategyInput);
  const opponent = new OpponentModel(); opponent.reset(seed);
  for (let index = 0; index < 4; index += 1) opponent.update(OPPONENT_EVENT.FIRE,
    OPPONENT_CONTEXT.OPEN, OPPORTUNITY.CONFIRMED, CHOICE.CHOSEN, index);
  const families = new Uint8Array([0, 1, 2, 3, 4, 5]); const probabilities = new Uint16Array(6);
  opponent.buildNominalPolicy(families, 6, OPPONENT_CONTEXT.OPEN, probabilities);
  let probabilityMass = 0; for (let index = 0; index < probabilities.length; index += 1)
    probabilityMass += probabilities[index];
  const sketches = new PlanSketchArena(); const plans = new PersistentPlanArena();
  const sketch = sketches.create(PLAN_KIND.SHOT, PLAN_PURPOSE.DIRECT_KILL, ACTION.FIRE);
  const planHandle = plans.materialize(sketches, sketch, true);
  const cacheBank = new ProductionCacheBank(); const cache = cacheBank.get(CACHE_ID.PHYSICAL_VALUE_TT);
  const cacheSlot = cache.write(seed, seed ^ 0x55aa, seed + 1, seed + 2, 1,
    cache.currentGeneration, CACHE_DEPENDENCY.PHYSICAL, seed, CACHE_FLAG.COMPLETE, 2,
    -100, 100, 7, 9); const cacheHit = cache.probe(seed, seed ^ 0x55aa, seed + 1, seed + 2, 1);
  const graph = new InformationGraph(); const a = graph.addTerminal(VALUE_MAX);
  const b = graph.addTerminal(VALUE_MIN); const c = graph.addTerminal(VALUE_MIN);
  const d = graph.addTerminal(VALUE_MAX); const root = graph.addSimultaneous(2, 2, new Uint16Array([a, b, c, d]));
  const engine = new SearchEngine(graph); const runtime = new RuntimeController();
  runtime.beginCallback(0, seed, seed ^ 1, true); runtime.charge(WORK_KIND.ROOT, 1);
  const coordinator = new RuntimeSearchCoordinator(); const searchStatus = coordinator.solve(engine, root, runtime);
  runtime.finishCallback(); const emittedActions = new Uint8Array(1); const emittedArguments = new Uint16Array(1);
  ownEmitter.emit(emittedActions, emittedArguments); const result = new Int32Array(24);
  result[0] = 1; result[1] = ownEmitter.skillId; result[2] = enemyDescriptors.lookup(8);
  result[3] = score; result[4] = selector.current; result[5] = opponent.riskPreference;
  result[6] = probabilityMass; result[7] = planHandle; result[8] = cacheSlot;
  result[9] = cacheHit; result[10] = runtime.runtimeMode; result[11] = searchStatus;
  result[12] = engine.strictFingerprintLo | 0; result[13] = engine.strictFingerprintHi | 0;
  result[14] = engine.value.lower[root]; result[15] = engine.value.upper[root];
  result[16] = engine.lastPolicyHandle; result[17] = coordinator.minimaxInvocationCount;
  result[18] = runtime.accumulatedWorkUnits; result[19] = engine.lastProofStatus;
  result[20] = emittedActions[0]; result[21] = emittedArguments[0];
  result[22] = cacheBank.totalBytes(); result[23] = persistentRoot.cacheBank.generation; return result;
}

function onIdle(me, enemy, game) {
  return persistentRoot.decide(me, enemy, game);
}

module.exports = { onIdle, runProductionFixture };
