"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { GLOBAL_MODE, PLAN_KIND, PLAN_PURPOSE, STRATEGY_PURPOSE, NONE_HANDLE } =
  require("../../engine-v2/src/abi/policy-codes");
const { PlanSketchArena } = require("../../engine-v2/src/policy/plan");
const { StrategicArbiter, STRATEGIC_PROFILE } =
  require("../../engine-v2/src/policy/strategy-layer");
const { RiskAcceptanceController } =
  require("../../engine-v2/src/search/risk-acceptance-controller");

function fixture(purposes, deadlines, progress) {
  const count = purposes.length; const controller = new RiskAcceptanceController();
  const outcome = controller.outcome; outcome.reset(count); controller.acceptableCount = count;
  const sketches = new PlanSketchArena(); const handles = new Uint32Array(count);
  const bands = { selected: new Uint8Array(count), baseAnchorRow: 0,
    purpose: new Uint16Array(count), planContinuity: new Uint16Array(count) };
  const probability = new Uint16Array(count);
  for (let row = 0; row < count; row += 1) {
    outcome.acceptable[row] = 1; outcome.robustLower[row] = 1000;
    outcome.expectedValue[row] = 1000; outcome.tacticalValue[row] = 1000;
    bands.selected[row] = 1;
    handles[row] = sketches.create(PLAN_KIND.NAVIGATION, purposes[row],
      row === 0 ? ACTION.FIRE : ACTION.GO, 0xffff, deadlines[row], 0, row + 1,
      progress[row]);
  }
  return { controller, outcome, sketches, handles, bands, probability,
    envelope: { refuted() { return 0; } } };
}

test("RST4 COMBAT_FIRST selects a verified kill plan instead of a higher star heuristic", () => {
  const f = fixture([PLAN_PURPOSE.DIRECT_KILL, PLAN_PURPOSE.STAR_COLLECT],
    [8, 3], [8000, 10000]);
  f.outcome.expectedValue[1] = 9000; f.outcome.tacticalValue[1] = 9000;
  const selected = new StrategicArbiter().select(3, f.controller, f.bands,
    f.probability, f.envelope, 1, f.handles, f.sketches,
    STRATEGIC_PROFILE.COMBAT_FIRST, GLOBAL_MODE.NORMAL);
  assert.equal(selected, 0);
});

test("RST5 DEADLINE_BALANCED compares attack and star deadlines before purpose", () => {
  const f = fixture([PLAN_PURPOSE.DIRECT_KILL, PLAN_PURPOSE.STAR_COLLECT],
    [7, 3], [9000, 7000]);
  const selected = new StrategicArbiter().select(3, f.controller, f.bands,
    f.probability, f.envelope, 1, f.handles, f.sketches,
    STRATEGIC_PROFILE.DEADLINE_BALANCED, GLOBAL_MODE.NORMAL);
  assert.equal(selected, 1);
});

test("RST5 TERMINAL_AWARE preserves a lead and COMBAT_FIRST remains attack-first", () => {
  const f = fixture([PLAN_PURPOSE.DIRECT_KILL, PLAN_PURPOSE.PRESERVE],
    [3, 6], [7000, 5000]);
  const arbiter = new StrategicArbiter();
  assert.equal(arbiter.select(3, f.controller, f.bands, f.probability, f.envelope,
    1, f.handles, f.sketches, STRATEGIC_PROFILE.TERMINAL_AWARE,
    GLOBAL_MODE.HARD_SURVIVAL), 1);
  assert.equal(arbiter.select(3, f.controller, f.bands, f.probability, f.envelope,
    1, f.handles, f.sketches, STRATEGIC_PROFILE.COMBAT_FIRST,
    GLOBAL_MODE.HARD_SURVIVAL), 0);
});

test("RST4 StageMatrix probability is evidence and cannot directly own the tactical action", () => {
  const f = fixture([PLAN_PURPOSE.DIRECT_KILL, PLAN_PURPOSE.STAR_COLLECT],
    [3, 3], [9000, 6000]);
  f.probability[1] = 10000; f.outcome.purposeCompleteness[0] = 10000;
  const selected = new StrategicArbiter().select(2, f.controller, f.bands,
    f.probability, f.envelope, 1, f.handles, f.sketches,
    STRATEGIC_PROFILE.COMBAT_FIRST, GLOBAL_MODE.NORMAL);
  assert.equal(selected, 0);
});

test("RST4 tactical Pareto removes a strictly dominated plan but never restores Risk rejection", () => {
  const f = fixture([PLAN_PURPOSE.INTERCEPT, PLAN_PURPOSE.INTERCEPT],
    [4, 4], [3000, 5000]);
  f.outcome.robustLower[1] = 2000; f.outcome.expectedValue[1] = 2000;
  f.outcome.tacticalValue[1] = 2000; f.outcome.purposeCompleteness[1] = 5000;
  f.probability[1] = 10000;
  const arbiter = new StrategicArbiter();
  assert.equal(arbiter.select(2, f.controller, f.bands, f.probability, f.envelope,
    1, f.handles, f.sketches, STRATEGIC_PROFILE.COMBAT_FIRST, GLOBAL_MODE.NORMAL), 1);
  f.outcome.acceptable[1] = 0; f.controller.acceptableCount = 1;
  assert.equal(arbiter.select(2, f.controller, f.bands, f.probability, f.envelope,
    1, f.handles, f.sketches, STRATEGIC_PROFILE.COMBAT_FIRST, GLOBAL_MODE.NORMAL), 0);
  assert.notEqual(f.handles[0], NONE_HANDLE);
});

test("RST3b neutral arbitration stays inside StrategyBand without restoring the heuristic floor", () => {
  const f = fixture([PLAN_PURPOSE.DIRECT_KILL, PLAN_PURPOSE.STAR_COLLECT,
    PLAN_PURPOSE.REPOSITION], [3, 3, 3], [9000, 4000, 3000]);
  f.bands.selected.set([0, 1, 1]);
  f.outcome.expectedValue.set([9000, 3000, 2000]);
  f.outcome.robustLower.set([9000, 3000, 2000]);
  assert.equal(new StrategicArbiter().select(3, f.controller, f.bands,
    f.probability, f.envelope, 1, f.handles, f.sketches,
    STRATEGIC_PROFILE.COMBAT_FIRST, GLOBAL_MODE.NORMAL, 0), 1);
  assert.equal(f.outcome.acceptable[0], 1);
});

test("RST3b empty StrategyBand falls back to the full Risk Pareto set", () => {
  const f = fixture([PLAN_PURPOSE.DIRECT_KILL, PLAN_PURPOSE.REPOSITION],
    [3, 3], [8000, 3000]);
  f.bands.selected.fill(0); f.outcome.expectedValue.set([7000, 2000]);
  f.outcome.robustLower.set([7000, 2000]);
  assert.equal(new StrategicArbiter().select(3, f.controller, f.bands,
    f.probability, f.envelope, 1, f.handles, f.sketches,
    STRATEGIC_PROFILE.COMBAT_FIRST, GLOBAL_MODE.NORMAL, 0), 0);
});

test("RST3b committed escape ignores StrategyBand and keeps the best viable successor", () => {
  const f = fixture([PLAN_PURPOSE.REPOSITION, PLAN_PURPOSE.REPOSITION],
    [3, 3], [1000, 1000]);
  f.bands.selected.set([1, 0]);
  f.outcome.escapeSuccessorProof.set([1, 2]);
  f.outcome.escapeSuccessorSlack.set([0, 3]);
  assert.equal(new StrategicArbiter().select(1, f.controller, f.bands,
    f.probability, f.envelope, 1, f.handles, f.sketches,
    STRATEGIC_PROFILE.COMBAT_FIRST, GLOBAL_MODE.NORMAL, 0), 1);
});

test("RST3b terminal nonloss precedes ordinary attack value", () => {
  const f = fixture([PLAN_PURPOSE.DIRECT_KILL, PLAN_PURPOSE.PRESERVE],
    [3, 3], [9000, 2000]);
  f.bands.purpose.set([STRATEGY_PURPOSE.DIRECT_KILL,
    STRATEGY_PURPOSE.PRESERVE_NONLOSS]);
  f.outcome.expectedValue.set([9000, 1000]); f.outcome.robustLower.set([9000, 1000]);
  assert.equal(new StrategicArbiter().select(3, f.controller, f.bands,
    f.probability, f.envelope, 1, f.handles, f.sketches,
    STRATEGIC_PROFILE.COMBAT_FIRST, GLOBAL_MODE.HARD_SURVIVAL, 0), 1);
});

test("RST3b matrix probability is a late tie-break and cannot beat a stronger interval", () => {
  const f = fixture([PLAN_PURPOSE.REPOSITION, PLAN_PURPOSE.REPOSITION],
    [3, 3], [2000, 2000]);
  f.outcome.expectedValue.set([3000, 2000]); f.outcome.robustLower.set([3000, 2000]);
  f.probability.set([0, 10000]);
  assert.equal(new StrategicArbiter().select(2, f.controller, f.bands,
    f.probability, f.envelope, 1, f.handles, f.sketches,
    STRATEGIC_PROFILE.COMBAT_FIRST, GLOBAL_MODE.NORMAL, 0), 0);
});
