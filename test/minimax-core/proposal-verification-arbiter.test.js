"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { GLOBAL_MODE, PLAN_KIND, PLAN_PURPOSE, STRATEGY_PURPOSE,
  COMBAT_PURPOSE } = require("../../engine-v2/src/abi/policy-codes");
const { SAFETY_STATUS } =
  require("../../engine-v2/src/search/information-safety-closure");
const { RiskAcceptanceController } =
  require("../../engine-v2/src/search/risk-acceptance-controller");
const { StrategyBandSlab, StrategicArbiter } =
  require("../../engine-v2/src/policy/strategy-layer");
const { PlanSketchArena } = require("../../engine-v2/src/policy/plan");
const { ProposalVerificationArbiter, PVA_VERIFY, PVA_GOAL } =
  require("../../engine-v2/src/policy/proposal-verification-arbiter");

function fixture() {
  const actions = Uint8Array.from([ACTION.FIRE, ACTION.GO, ACTION.TURN_LEFT]);
  const count = actions.length; const controller = new RiskAcceptanceController();
  const outcome = controller.outcome; outcome.reset(count); controller.acceptableCount = count;
  for (let row = 0; row < count; row += 1) {
    outcome.acceptable[row] = 1; outcome.expectedValue[row] = 5000 - row * 100;
    outcome.robustLower[row] = 5000 - row * 100;
    outcome.tacticalValue[row] = 5000 - row * 100;
    outcome.safety[row] = SAFETY_STATUS.UNKNOWN; outcome.coverage[row] = 0;
    outcome.escapeSlack[row] = 0;
  }
  const bands = new StrategyBandSlab(); bands.reset(count);
  bands.starPurpose[1] = STRATEGY_PURPOSE.STAR_COLLECT;
  const combat = { count, purposeFlags: new Uint8Array(count),
    purposeCompleteness: new Uint16Array(count), postFireEscape: new Uint8Array(count),
    ownCounterExposure: new Uint16Array(count) };
  const sketches = new PlanSketchArena(); const handles = new Uint32Array(count);
  handles[0] = sketches.create(PLAN_KIND.SHOT, PLAN_PURPOSE.DIRECT_KILL,
    ACTION.FIRE, 0xffff, 3, 0, 1, 7000);
  handles[1] = sketches.create(PLAN_KIND.NAVIGATION, PLAN_PURPOSE.STAR_COLLECT,
    ACTION.GO, 0xffff, 4, 0, 2, 5000);
  handles[2] = sketches.create(PLAN_KIND.NAVIGATION, PLAN_PURPOSE.REPOSITION,
    ACTION.TURN_LEFT, 0xffff, 5, 0, 3, 2000);
  return { actions, count, controller, outcome, bands, combat, sketches, handles,
    probability: new Uint16Array(count), strategic: new StrategicArbiter(),
    envelope: { refuted() { return 0; } } };
}

function certify(outcome, row) {
  outcome.safety[row] = SAFETY_STATUS.PROVEN_SAFE; outcome.coverage[row] = 10000;
  outcome.immediateFatalMass[row] = 0; outcome.horizonFatalMass[row] = 0;
  outcome.unknownMass[row] = 0;
}

test("PVA proposals retain every Risk/Pareto action but never restore rejection", () => {
  const f = fixture(); f.outcome.acceptable[0] = 0; f.controller.acceptableCount = 2;
  const pva = new ProposalVerificationArbiter().configure(1);
  assert.equal(pva.buildPortfolio(f.controller, f.bands, f.actions, f.count, f.combat), 2);
  assert.deepEqual([...f.bands.selected.slice(0, f.count)], [0, 1, 1]);
  assert.equal(pva.goal[1], PVA_GOAL.STAR);
  assert.equal(f.bands.proposalMask[0], 0);
});

test("verify-only upgrades an unknown neutral winner to a nearby certified plan", () => {
  const f = fixture(); certify(f.outcome, 1);
  const pva = new ProposalVerificationArbiter().configure(0);
  pva.buildPortfolio(f.controller, f.bands, f.actions, f.count, f.combat);
  const selected = pva.select(3, f.strategic, f.controller, f.bands,
    f.probability, f.envelope, 1, f.actions, f.handles, f.sketches,
    GLOBAL_MODE.NORMAL);
  assert.equal(pva.baseRow, 0); assert.equal(selected, 1);
  assert.equal(pva.verification[0], PVA_VERIFY.UNKNOWN);
  assert.equal(pva.verification[1], PVA_VERIFY.CERTIFIED);
  assert.equal(pva.guardOverrideCount, 1);
});

test("verification cannot erase a materially stronger neutral interval", () => {
  const f = fixture(); certify(f.outcome, 1);
  f.outcome.expectedValue[1] = 3000; f.outcome.robustLower[1] = 3000;
  f.outcome.expectedValue[2] = 3000; f.outcome.robustLower[2] = 3000;
  f.outcome.tacticalValue[2] = 3000;
  const pva = new ProposalVerificationArbiter().configure(0);
  pva.buildPortfolio(f.controller, f.bands, f.actions, f.count, f.combat);
  const selected = pva.select(3, f.strategic, f.controller, f.bands,
    f.probability, f.envelope, 1, f.actions, f.handles, f.sketches,
    GLOBAL_MODE.NORMAL);
  assert.equal(selected, 0); assert.equal(pva.guardOverrideCount, 0);
});

test("full PVA may choose a verified self-escaping attack inside value windows", () => {
  const f = fixture(); certify(f.outcome, 0); certify(f.outcome, 1);
  f.outcome.expectedValue.set([4900, 5000, 1000]);
  f.outcome.robustLower.set([4900, 5000, 1000]);
  f.outcome.tacticalValue.set([4900, 5000, 1000]);
  f.outcome.combatPurpose[0] = COMBAT_PURPOSE.DIRECT_KILL;
  f.outcome.purposeCompleteness[0] = 9000; f.outcome.postFireEscape[0] = 1;
  f.combat.purposeFlags[0] = COMBAT_PURPOSE.DIRECT_KILL;
  f.combat.purposeCompleteness[0] = 9000; f.combat.postFireEscape[0] = 1;
  const pva = new ProposalVerificationArbiter().configure(1);
  pva.buildPortfolio(f.controller, f.bands, f.actions, f.count, f.combat);
  const selected = pva.select(2, f.strategic, f.controller, f.bands,
    f.probability, f.envelope, 1, f.actions, f.handles, f.sketches,
    GLOBAL_MODE.NORMAL);
  assert.equal(selected, 0); assert.equal(pva.goalOverrideCount, 1);
});

test("Search refutation remains exclusion-only and committed escape bypasses goals", () => {
  const f = fixture(); certify(f.outcome, 0); certify(f.outcome, 1);
  f.envelope = { refuted(row) { return row === 0; } };
  f.outcome.escapeSuccessorProof.set([0, 2, 1]);
  f.outcome.escapeSuccessorSlack.set([0, 3, 1]);
  const pva = new ProposalVerificationArbiter().configure(1);
  pva.buildPortfolio(f.controller, f.bands, f.actions, f.count, f.combat);
  const selected = pva.select(1, f.strategic, f.controller, f.bands,
    f.probability, f.envelope, 1, f.actions, f.handles, f.sketches,
    GLOBAL_MODE.NORMAL);
  assert.equal(selected, 1); assert.equal(pva.verification[0], PVA_VERIFY.REFUTED);
  assert.equal(pva.goalOverrideCount, 0); assert.equal(pva.hotAllocationCount, 0);
});
