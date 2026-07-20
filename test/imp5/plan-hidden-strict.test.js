"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { policy, fast, search, physical, tank, populatedFeatureInput,
  terminalMatrixGraph } = require("./helpers");

test("only finalist plan sketches persist and every continuation rechecks Hard", () => {
  const sketches = new policy.PlanSketchArena(); const plans = new policy.PersistentPlanArena();
  const shot = sketches.create(policy.PLAN_KIND.SHOT, policy.PLAN_PURPOSE.DIRECT_KILL,
    fast.ACTION.FIRE, fast.NONE_CELL, 20); const bomb = sketches.create(policy.PLAN_KIND.BOMB,
    policy.PLAN_PURPOSE.ZONE_DENIAL, fast.ACTION.THROW_BOMB, fast.NONE_CELL, 20);
  assert.equal(plans.materialize(sketches, shot, false), policy.NONE_HANDLE);
  const handle = plans.materialize(sketches, bomb, true); assert.notEqual(handle, policy.NONE_HANDLE);
  assert.equal(plans.activate(handle), 1); const built = fast.createFastPhysical(physical());
  assert.equal(plans.validateContinuation(handle, built, fast.ACTION.NONE), policy.POLICY_STATUS.COMPLETE);
  assert.equal(plans.validateContinuation(handle, built, fast.ACTION.NONE), policy.POLICY_STATUS.COMPLETE);
  assert.equal(plans.hardValidationCount, 2); assert.equal(built.hard.checkedActions, 2);
  assert.equal(plans.materializedCount, 1);
});

test("overload shot members and bomb safety remain physical rather than plan facts", () => {
  const built = fast.createFastPhysical(physical({ tanks: [tank(0, [1, 1], "right",
    { skillId: "overload", overloadUntilFrame: 10 }), tank(1, [5, 3], "left")],
    bombs: [{ entityId: 7, ownerSeat: 0, cell: [2, 2], explodeFrame: 5 }] }));
  assert.equal(built.kernel.applyFrame(fast.ACTION.FIRE, fast.NONE_CELL, fast.ACTION.NONE),
    fast.FAST_STATUS.APPLIED); assert.equal(built.state.activeProjectileCount(), 2);
  built.kernel.undoLast(); const before = built.state.activeBombCount();
  const sketches = new policy.PlanSketchArena(); const plans = new policy.PersistentPlanArena();
  const sketch = sketches.create(policy.PLAN_KIND.BOMB, policy.PLAN_PURPOSE.ZONE_DENIAL,
    fast.ACTION.THROW_BOMB); const handle = plans.materialize(sketches, sketch, true);
  plans.invalidate(handle, policy.PLAN_REASON.FORCED_OVERRIDE);
  assert.equal(built.state.activeBombCount(), before); assert.equal(built.state.rootSignature().includes(":"), true);
});

test("grass cloak and belief routes remain PossibleHazard soft inputs only", () => {
  const built = fast.createFastPhysical(physical()); const root = built.state.rootSignature();
  const field = new policy.HiddenRiskField(built.state.cells); field.mark(8,
    policy.POSSIBLE_HAZARD.GRASS | policy.POSSIBLE_HAZARD.BELIEF_ROUTE, 7000);
  field.mark(8, policy.POSSIBLE_HAZARD.SHOT, 8000); field.mark(8, policy.POSSIBLE_HAZARD.BOMB, 4000);
  field.markInformationGain(8, 6000); const input = new policy.FeatureInputFrame();
  field.writeFeatures(8, input); assert.ok(input.values[policy.FEATURE_INPUT.POSSIBLE_SHOT_EXPOSURE] > 0);
  assert.equal(field.hardWriteCount, 0); assert.equal(field.proofWriteCount, 0);
  assert.equal(built.state.rootSignature(), root); assert.equal(built.hard.checkedActions, 0);
});

test("weights strategy opponent and risk never change Terminal Hard or strict Proof fingerprints", () => {
  const fixture = terminalMatrixGraph([[10000, -10000], [-10000, 10000]]);
  const baseline = new search.SearchEngine(fixture.graph); baseline.solveRoot(fixture.root,
    { baseRisk: 0, matrixIterations: 64 }); const lo = baseline.strictFingerprintLo;
  const hi = baseline.strictFingerprintHi; const layer = new policy.PolicyLayer({ ownSkillId: fast.SKILL.POISON });
  layer.weights.configureAction(policy.EVAL_PROFILE.KILL_PRESSURE, policy.ACTION_FAMILY.FIRE,
    policy.FEATURE.DIRECT_HIT_WINDOW, 100); for (let index = 0; index < 8; index += 1)
    layer.opponent.update(policy.OPPONENT_EVENT.FIRE, policy.OPPONENT_CONTEXT.OPEN,
      policy.OPPORTUNITY.CONFIRMED, policy.CHOICE.CHOSEN, index);
  const strategy = new policy.StrategyInputFrame(); strategy.set(policy.STRATEGY_INPUT.DIRECT_HIT_WINDOW, 10000);
  const changed = new search.SearchEngine(fixture.graph); changed.solveRoot(fixture.root,
    { policyLayer: layer, policyFeatureInput: populatedFeatureInput(), policyStrategyInput: strategy,
      policyAction: fast.ACTION.FIRE, policyPlanKind: policy.PLAN_KIND.SHOT, matrixIterations: 64 });
  assert.equal(changed.strictFingerprintLo, lo); assert.equal(changed.strictFingerprintHi, hi);
  const built = fast.createFastPhysical(physical()); const signature = built.state.rootSignature();
  layer.hidden.mark(3, policy.POSSIBLE_HAZARD.SHOT, 10000);
  assert.equal(built.state.rootSignature(), signature); assert.equal(built.hard.rootMismatchCount, 0);
});

test("IMP5 policy structures use bounded integer TypedArrays and report zero tracked allocation", () => {
  const layer = new policy.PolicyLayer({ ownSkillId: fast.SKILL.POISON }); const seen = new Set();
  let arrays = 0; let bytes = 0; let floatArrays = 0; let allocations = 0;
  function visit(value) { if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value); if (ArrayBuffer.isView(value)) { arrays += 1; bytes += value.byteLength;
      if (value instanceof Float32Array || value instanceof Float64Array) floatArrays += 1; return; }
    if (Number.isSafeInteger(value.hotAllocationCount)) allocations += value.hotAllocationCount;
    for (const key of Object.keys(value)) visit(value[key]); }
  visit(layer); assert.ok(arrays > 20); assert.ok(bytes > 0); assert.equal(floatArrays, 0); assert.equal(allocations, 0);
  const source = fs.readdirSync(path.join(__dirname, "../../engine-v2/src/policy"))
    .filter(name => name.endsWith(".js")).map(name => fs.readFileSync(path.join(__dirname,
      "../../engine-v2/src/policy", name), "utf8")).join("\n");
  assert.doesNotMatch(source, /Float32Array|Float64Array|Math\.random|Date\.now|console\./);
});
