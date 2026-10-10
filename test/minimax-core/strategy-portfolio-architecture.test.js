"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { EVAL_PROFILE, GLOBAL_MODE, STRATEGY, STRATEGY_INPUT,
  STRATEGY_PURPOSE } = require("../../engine-v2/src/abi/policy-codes");
const { STRATEGY_CONFIG } = require("../../engine-v2/src/generated/policy-config");
const { PolicyLayer } = require("../../engine-v2/src/policy/layer");
const { StrategyInputFrame, StrategySelector } =
  require("../../engine-v2/src/policy/strategy-selector");
const { StrategyBandSlab } = require("../../engine-v2/src/policy/strategy-layer");
const { RiskAcceptanceController } =
  require("../../engine-v2/src/search/risk-acceptance-controller");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");

function controller(values, acceptable) {
  const result = new RiskAcceptanceController(); const o = result.outcome;
  o.reset(values.length); result.acceptableCount = 0; result.safeFloor = -10000;
  for (let row = 0; row < values.length; row += 1) {
    o.acceptable[row] = acceptable ? acceptable[row] : 1;
    o.dominated[row] = 0; o.robustLower[row] = values[row];
    o.expectedValue[row] = values[row]; o.tacticalValue[row] = values[row];
    o.purposeCompleteness[row] = 10000;
    if (o.acceptable[row]) {
      result.acceptableCount += 1;
      if (values[row] > result.safeFloor) result.safeFloor = values[row];
    }
  }
  return result;
}

function combat(count) {
  return { count, purposeFlags: new Uint8Array(count),
    purposeCompleteness: new Uint16Array(count), postFireEscape: new Uint8Array(count),
    ownCounterExposure: new Uint16Array(count) };
}

function boxedMap(width = 8, height = 5) {
  return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "x" : "."));
}

function side(seat, position, direction, skillType, calls) {
  return { name: seat, tank: { position, direction }, stars: 0,
    bullet: null, skill: { type: skillType, remainingCooldownFrames: 1 },
    effects: { self: null, debuff: null }, status: { shielded: false,
      frozen: false, stunned: false, overloaded: false, cloaked: false,
      poisoned: false, boosted: false, fireLocked: false, bombActive: false,
      bombCooldownFrames: 1, canActThisFrame: true, actionSpeed: 1 },
    go() { calls.push("GO"); }, turn(value) { calls.push(`TURN:${value}`); },
    fire() { calls.push("FIRE"); }, throwBomb() { calls.push("BOMB"); },
    poison() { calls.push("POISON"); } };
}

test("STRAT3 uses the stable long-horizon evaluator as a strategy-neutral baseline", () => {
  assert.equal(EVAL_PROFILE.CANONICAL_OUTCOME, EVAL_PROFILE.STAR_CONTROL);
  assert.equal(STRATEGY_CONFIG.CANONICAL_EVAL_PROFILE, EVAL_PROFILE.STAR_CONTROL);
  const policy = new PolicyLayer(); const input = policy.featureInput;
  input.reset(); input.set(0, 2000); input.set(1, 5000); input.set(5, 7000);
  policy.prepareNeutralSearch(input);
  const first = policy.scoreAction(input, ACTION.GO);
  for (let strategy = 0; strategy < STRATEGY.COUNT; strategy += 1) {
    policy.strategyId = strategy;
    assert.equal(policy.scoreAction(input, ACTION.GO), first);
    assert.equal(policy.evalProfileId, EVAL_PROFILE.STAR_CONTROL);
    assert.equal(policy.baseRisk, STRATEGY_CONFIG.DEFAULT_BASE_RISK);
  }
});

test("selector observes qualified evidence without committing strategy state", () => {
  const selector = new StrategySelector(); const input = new StrategyInputFrame();
  input.set(STRATEGY_INPUT.STAR_RACE, 3000);
  input.set(STRATEGY_INPUT.STAR_DEADLINE, 5);
  const generation = selector.generation; const current = selector.current;
  const decisions = selector.prepare(input, GLOBAL_MODE.NORMAL);
  assert.equal(selector.current, current); assert.equal(selector.generation, generation);
  assert.equal(decisions.eligible[STRATEGY.KILL_PRESSURE], 0);
  assert.equal(decisions.eligible[STRATEGY.STAR_CONTROL], 1);
  selector.commitSelected(STRATEGY.STAR_CONTROL);
  assert.equal(selector.current, STRATEGY.STAR_CONTROL);
  assert.equal(selector.generation, generation + 1);
});

test("strategy portfolio uses a genuine neutral anchor and cannot restore rejected FIRE", () => {
  const actions = Uint8Array.from([ACTION.FIRE, ACTION.GO, ACTION.TURN_LEFT]);
  const c = controller([9000, 5000, 5000], Uint8Array.from([0, 1, 1]));
  const bands = new StrategyBandSlab(); bands.reset(actions.length);
  bands.starPurpose[1] = STRATEGY_PURPOSE.STAR_COLLECT;
  const selector = new StrategySelector(); const input = new StrategyInputFrame();
  input.set(STRATEGY_INPUT.STAR_DEADLINE, 2);
  const decisions = selector.prepare(input);
  bands.buildPortfolio(c, decisions, selector.current, actions, actions.length,
    combat(actions.length));
  assert.equal(bands.baseAnchorRow, 1);
  assert.equal(bands.baseAnchor[1], 1); assert.equal(bands.selected[1], 1);
  assert.equal(bands.selected[0], 0);
  assert.equal(bands.proposalMask[0], 0);
  assert.equal(decisions.eligible[STRATEGY.KILL_PRESSURE], 0);
});

test("RST3c only the current strategy proposes and the heuristic floor stays diagnostic", () => {
  const actions = Uint8Array.from([ACTION.FIRE, ACTION.GO, ACTION.TURN_LEFT]);
  const c = controller([6000, 6000, 6000]); const floor = c.safeFloor;
  const evidence = combat(actions.length);
  evidence.purposeFlags[0] = 1; evidence.purposeCompleteness[0] = 10000;
  evidence.postFireEscape[0] = 1;
  const bands = new StrategyBandSlab(); bands.reset(actions.length);
  bands.starPurpose[1] = STRATEGY_PURPOSE.STAR_COLLECT;
  bands.purpose[2] = STRATEGY_PURPOSE.AIM_SETUP;
  const selector = new StrategySelector(); const input = new StrategyInputFrame();
  input.set(STRATEGY_INPUT.KILL_OPPORTUNITY, 9000);
  input.set(STRATEGY_INPUT.PURPOSE_COMPLETENESS, 10000);
  input.set(STRATEGY_INPUT.KILL_DEADLINE, 2);
  input.set(STRATEGY_INPUT.STAR_DEADLINE, 3);
  const decisions = selector.prepare(input);
  bands.buildPortfolio(c, decisions, selector.current, actions, actions.length, evidence);
  assert.equal(c.safeFloor, floor);
  assert.equal(bands.selected[bands.baseAnchorRow], 1);
  assert.equal(actions[bands.baseAnchorRow], ACTION.GO);
  assert.ok(bands.proposalMask[0] & (1 << STRATEGY.KILL_PRESSURE));
  assert.equal(bands.proposalMask[1] & (1 << STRATEGY.STAR_CONTROL), 0);
});

test("RST3d Portfolio admits one explicitly approved challenger", () => {
  const actions = Uint8Array.from([ACTION.FIRE, ACTION.GO, ACTION.TURN_LEFT]);
  const c = controller([9000, 5000, 4000]);
  const bands = new StrategyBandSlab(); bands.reset(actions.length);
  bands.starPurpose[1] = STRATEGY_PURPOSE.STAR_COLLECT;
  const selector = new StrategySelector(); selector.current = STRATEGY.KILL_PRESSURE;
  const input = new StrategyInputFrame(); input.set(STRATEGY_INPUT.STAR_RACE, 7000);
  input.set(STRATEGY_INPUT.STAR_DEADLINE, 2);
  const decisions = selector.prepare(input);
  bands.buildPortfolio(c, decisions, selector.current, actions, actions.length,
    combat(actions.length), STRATEGY.STAR_CONTROL);
  assert.equal(decisions.eligible[STRATEGY.KILL_PRESSURE], 0);
  assert.equal(bands.baseAnchorRow, 1);
  assert.ok(bands.proposalMask[1] & (1 << STRATEGY.STAR_CONTROL));
  assert.equal(bands.proposalCountByStrategy[STRATEGY.STAR_CONTROL], 1);
  assert.equal(bands.proposalMask[0], 0);
});

test("RST3c neutral anchor can never be FIRE even when FIRE has the best expected value", () => {
  const actions = Uint8Array.from([ACTION.FIRE, ACTION.GO]);
  const c = controller([10000, 1000]); const bands = new StrategyBandSlab();
  bands.reset(actions.length);
  const selector = new StrategySelector(); const input = new StrategyInputFrame();
  const decisions = selector.prepare(input);
  bands.buildPortfolio(c, decisions, selector.current, actions, actions.length,
    combat(actions.length));
  assert.equal(bands.baseAnchorRow, 1);
  assert.equal(bands.baseAnchor[0], 0); assert.equal(bands.baseAnchor[1], 1);
});

test("RST3d challenger decision reuses hysteresis without mutating committed strategy", () => {
  const selector = new StrategySelector(); selector.current = STRATEGY.STAR_CONTROL;
  selector.dwellRoots = 0; const input = new StrategyInputFrame();
  input.set(STRATEGY_INPUT.DIRECT_HIT_WINDOW, 9000);
  input.set(STRATEGY_INPUT.KILL_OPPORTUNITY, 9000);
  input.set(STRATEGY_INPUT.PURPOSE_COMPLETENESS, 10000);
  input.set(STRATEGY_INPUT.KILL_DEADLINE, 2);
  input.set(STRATEGY_INPUT.STAR_RACE, 1000);
  input.set(STRATEGY_INPUT.STAR_DEADLINE, 6);
  const generation = selector.generation; const dwell = selector.dwellRoots;
  selector.prepare(input, GLOBAL_MODE.NORMAL);
  assert.equal(selector.candidateForPortfolio(input, GLOBAL_MODE.NORMAL),
    STRATEGY.KILL_PRESSURE);
  assert.equal(selector.current, STRATEGY.STAR_CONTROL);
  assert.equal(selector.generation, generation); assert.equal(selector.dwellRoots, dwell);
});

test("RST3d portfolio contains current and exactly one approved challenger", () => {
  const actions = Uint8Array.from([ACTION.FIRE, ACTION.GO, ACTION.TURN_LEFT]);
  const c = controller([7000, 5000, 3000]); const bands = new StrategyBandSlab();
  bands.reset(actions.length); bands.starPurpose[1] = STRATEGY_PURPOSE.STAR_COLLECT;
  const evidence = combat(actions.length); evidence.purposeFlags[0] = 1;
  evidence.purposeCompleteness[0] = 10000; evidence.postFireEscape[0] = 1;
  const selector = new StrategySelector(); selector.current = STRATEGY.STAR_CONTROL;
  const input = new StrategyInputFrame(); input.set(STRATEGY_INPUT.DIRECT_HIT_WINDOW, 9000);
  input.set(STRATEGY_INPUT.KILL_OPPORTUNITY, 9000);
  input.set(STRATEGY_INPUT.PURPOSE_COMPLETENESS, 10000);
  input.set(STRATEGY_INPUT.KILL_DEADLINE, 2);
  input.set(STRATEGY_INPUT.STAR_RACE, 2000); input.set(STRATEGY_INPUT.STAR_DEADLINE, 5);
  const decisions = selector.prepare(input); const challenger =
    selector.candidateForPortfolio(input);
  bands.buildPortfolio(c, decisions, selector.current, actions, actions.length,
    evidence, challenger);
  assert.ok(bands.proposalMask[1] & (1 << STRATEGY.STAR_CONTROL));
  assert.ok(bands.proposalMask[0] & (1 << STRATEGY.KILL_PRESSURE));
  assert.equal(bands.challengerStrategy, STRATEGY.KILL_PRESSURE);
  assert.equal(bands.challengerProposalCount, 1);
  assert.equal(selector.current, STRATEGY.STAR_CONTROL);
  selector.commitSelected(bands.ownerForRow(0, selector.current));
  assert.equal(selector.current, STRATEGY.KILL_PRESSURE);
});

test("production prepares strategy only after the Risk gate", () => {
  const calls = []; const engine = new ProductionRootEngine(); const order = [];
  const originalGate = engine.riskController.gate.bind(engine.riskController);
  engine.riskController.gate = function wrappedGate(...args) {
    order.push("risk"); return originalGate(...args);
  };
  const originalPrepare = engine.policy.prepareStrategyPortfolio.bind(engine.policy);
  engine.policy.prepareStrategyPortfolio = function wrappedPrepare(...args) {
    order.push("strategy"); return originalPrepare(...args);
  };
  const me = side("own", [1, 1], "right", "poison", calls);
  const enemy = side("enemy", [6, 1], "left", "stun", []);
  engine.decide(me, enemy, { frames: 1, map: boxedMap(), star: [1, 2], bombs: [] });
  assert.ok(order.indexOf("risk") >= 0); assert.ok(order.indexOf("strategy") >= 0);
  assert.ok(order.indexOf("risk") < order.indexOf("strategy"));
  assert.equal(engine.depthSearch.rootRestoreFailures, 0);
});
