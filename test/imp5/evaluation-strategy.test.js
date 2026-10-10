"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const manifest = require("../../config/engine-v2/imp5-policy-manifest.json");
const { policy, populatedFeatureInput } = require("./helpers");

test("FeatureRegistry declares integer ranges dependencies costs and no semantic float arrays", () => {
  const registry = new policy.FeatureRegistry(); assert.equal(registry.count, manifest.limits.featureCount);
  for (let index = 0; index < registry.count; index += 1) assert.equal(registry.descriptorComplete(index), true);
  const arrays = [registry.family, registry.minimum, registry.maximum, registry.costTier,
    registry.dependencyMask, registry.inputIndex, registry.handlerCode, registry.version];
  assert.ok(arrays.every(value => ArrayBuffer.isView(value) && !(value instanceof Float32Array) &&
    !(value instanceof Float64Array))); assert.ok(registry.costTier.some(value => value === policy.FEATURE_COST.FINALIST));
  assert.ok(registry.dependencyMask.some(value => value & policy.FEATURE_DEPENDENCY.BELIEF));
});

test("Table and Generated evaluators produce identical raw vectors and scores", () => {
  const input = populatedFeatureInput(); const weights = new policy.WeightBank();
  const registry = new policy.FeatureRegistry(); const table = new policy.TableEvaluator({ registry, weights });
  const generated = new policy.GeneratedEvaluator({ registry, weights });
  for (let tier = 0; tier <= policy.FEATURE_COST.FINALIST; tier += 1) {
    table.evaluateRaw(input, tier); generated.evaluateRaw(input, tier);
    assert.deepEqual(Array.from(generated.raw), Array.from(table.raw));
    for (let profile = 0; profile < policy.EVAL_PROFILE.COUNT; profile += 1)
      assert.equal(generated.score(profile, policy.ACTION_FAMILY.FIRE, policy.PLAN_KIND.SHOT),
        table.score(profile, policy.ACTION_FAMILY.FIRE, policy.PLAN_KIND.SHOT));
  }
});

test("changing one action or plan weight only redoes the integer dot product", () => {
  const input = populatedFeatureInput(); const weights = new policy.WeightBank();
  const evaluator = new policy.TableEvaluator({ weights }); evaluator.evaluateRaw(input);
  const rawBefore = Array.from(evaluator.raw); const rawComputes = evaluator.rawComputeCount;
  const holdBefore = evaluator.score(policy.EVAL_PROFILE.KILL_PRESSURE, policy.ACTION_FAMILY.HOLD,
    policy.PLAN_KIND.NONE); const fireBefore = evaluator.score(policy.EVAL_PROFILE.KILL_PRESSURE,
    policy.ACTION_FAMILY.FIRE, policy.PLAN_KIND.SHOT);
  assert.equal(weights.configureAction(policy.EVAL_PROFILE.KILL_PRESSURE, policy.ACTION_FAMILY.FIRE,
    policy.FEATURE.DIRECT_HIT_WINDOW, 7), 1);
  assert.equal(weights.configurePlan(policy.EVAL_PROFILE.KILL_PRESSURE, policy.PLAN_KIND.SHOT,
    policy.FEATURE.PLAN_PROGRESS, 9), 1);
  const holdAfter = evaluator.score(policy.EVAL_PROFILE.KILL_PRESSURE, policy.ACTION_FAMILY.HOLD,
    policy.PLAN_KIND.NONE); const fireAfter = evaluator.score(policy.EVAL_PROFILE.KILL_PRESSURE,
    policy.ACTION_FAMILY.FIRE, policy.PLAN_KIND.SHOT);
  assert.equal(holdAfter, holdBefore); assert.notEqual(fireAfter, fireBefore);
  assert.equal(evaluator.rawComputeCount, rawComputes); assert.deepEqual(Array.from(evaluator.raw), rawBefore);
  weights.freeze(); assert.equal(weights.configureAction(0, 0, 0, 1), 0);
});

test("STRAT2 defaults to kill pressure and uses vector hysteresis without changing risk semantics", () => {
  const selector = new policy.StrategySelector(); const input = new policy.StrategyInputFrame();
  assert.equal(selector.current, policy.STRATEGY.KILL_PRESSURE);
  assert.equal(selector.evalProfileId, policy.EVAL_PROFILE.CANONICAL_OUTCOME);
  const baseRisk = selector.baseRisk;
  input.set(policy.STRATEGY_INPUT.DIRECT_HIT_WINDOW, 9000);
  input.set(policy.STRATEGY_INPUT.OPPONENT_ATTACK, 8000);
  for (let index = 0; index < 3; index += 1)
    assert.equal(selector.select(input), policy.STRATEGY.KILL_PRESSURE);
  input.set(policy.STRATEGY_INPUT.DIRECT_HIT_WINDOW, 0);
  input.set(policy.STRATEGY_INPUT.KILL_OPPORTUNITY, 0);
  input.set(policy.STRATEGY_INPUT.SETUP_OPPORTUNITY, 8900);
  assert.equal(selector.select(input), policy.STRATEGY.ATTACK_SETUP);
  assert.equal(selector.evalProfileId, policy.EVAL_PROFILE.CANONICAL_OUTCOME);
  assert.equal(selector.baseRisk, baseRisk);
  input.set(policy.STRATEGY_INPUT.TERMINAL_URGENCY, 9600); selector.select(input);
  assert.equal(selector.phase, policy.STRATEGY_PHASE.LOCKED);
  assert.equal(selector.select(input, policy.GLOBAL_MODE.HARD_SURVIVAL), policy.STRATEGY.PRESERVE_LEAD);
  assert.equal(selector.baseRisk, baseRisk);
});

test("STRAT2 deadline is a lexicographic switch dimension after equal opportunity", () => {
  const selector = new policy.StrategySelector(); const input = new policy.StrategyInputFrame();
  input.set(policy.STRATEGY_INPUT.KILL_OPPORTUNITY, 5000);
  input.set(policy.STRATEGY_INPUT.SETUP_OPPORTUNITY, 5000);
  input.set(policy.STRATEGY_INPUT.PURPOSE_COMPLETENESS, 8000);
  input.set(policy.STRATEGY_INPUT.KILL_DEADLINE, 4);
  for (let root = 0; root < 3; root += 1) selector.select(input);
  selector.current = policy.STRATEGY.ATTACK_SETUP;
  selector.dwellRoots = 3;
  assert.equal(selector.select(input), policy.STRATEGY.KILL_PRESSURE);
});
