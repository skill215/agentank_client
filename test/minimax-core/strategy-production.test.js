"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { STRATEGY, EVAL_PROFILE, STRATEGY_BAND } =
  require("../../engine-v2/src/abi/policy-codes");
const { STRATEGY_CONFIG } = require("../../engine-v2/src/generated/policy-config");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");

function boxedMap(width = 9, height = 5) {
  return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "x" : "."));
}

function side(id, position, direction, skillType, calls) {
  return { tank: { id, position, direction, crashed: false }, stars: 0, bullet: null,
    skill: { type: skillType, remainingCooldownFrames: 1 },
    effects: { self: null, debuff: null },
    status: { shielded: false, frozen: false, stunned: false, overloaded: false,
      cloaked: false, poisoned: false, boosted: false, fireLocked: false,
      bombActive: false, bombCooldownFrames: 1, canActThisFrame: true, actionSpeed: 1 },
    go() { calls.push("GO"); }, turn(value) { calls.push(`TURN:${value}`); },
    fire() { calls.push("FIRE"); }, throwBomb() { calls.push("BOMB"); },
    poison() { calls.push("POISON"); } };
}

test("production STRAT2 keeps a qualified shot primary when a nearby star also exists", () => {
  const calls = []; const map = boxedMap();
  const me = side("own", [1, 1], "right", "poison", calls);
  const enemy = side("enemy", [6, 1], "left", "stun", []);
  const engine = new ProductionRootEngine();
  const action = engine.decide(me, enemy,
    { frames: 1, map, star: [1, 2], bombs: [] });
  assert.equal(action, ACTION.FIRE); assert.deepEqual(calls, ["FIRE"]);
  assert.equal(engine.policy.strategyId, STRATEGY.KILL_PRESSURE);
  assert.equal(engine.policy.evalProfileId, EVAL_PROFILE.CANONICAL_OUTCOME);
  assert.equal(engine.policy.baseRisk, STRATEGY_CONFIG.DEFAULT_BASE_RISK);
  const fireRow = Array.from(engine.ourActions.slice(0, engine.ourCount)).indexOf(ACTION.FIRE);
  assert.ok(fireRow >= 0); assert.equal(engine.strategyBands.selected[fireRow], 1);
  assert.equal(engine.strategyBands.selectedBand, STRATEGY_BAND.PRIMARY);
  assert.equal(engine.depthSearch.rootRestoreFailures, 0);
});
