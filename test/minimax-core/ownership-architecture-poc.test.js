"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { PLAN_PURPOSE, GLOBAL_MODE } = require("../../engine-v2/src/abi/policy-codes");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { recoverRiskFrontier, violationDominates, rootObjective, purposeRank,
  OBJECTIVE, installOwnershipArchitecturePoc } =
  require("../../tools/agentank/diagnostics/ownership-architecture-poc");

function controllerFixture() {
  const count = 4;
  const outcome = {
    count,
    hard: new Uint8Array(count), acceptable: new Uint8Array(count),
    dominated: new Uint8Array(count), immediateFatalMass: new Uint16Array(count),
    horizonFatalMass: new Uint16Array(count), unknownMass: new Uint16Array(count),
    earliestFatalFrame: new Uint8Array(count), escapeSlack: new Int8Array(count)
  };
  outcome.hard.fill(HARD_STATUS.ALLOW); outcome.earliestFatalFrame.fill(4);
  return { outcome, acceptableCount: 0, immediateLimit: 1000,
    horizonLimit: 2000, unknownLimit: 1000, minimumEscapeSlack: -1,
    recomputeSelectionFrontier() {
      this.outcome.dominated.fill(0); return 0;
    } };
}

test("ownership PoC recovers a risk Pareto frontier without restoring Hard rejects", () => {
  const controller = controllerFixture(); const o = controller.outcome;
  o.immediateFatalMass.set([1500, 1000, 1800, 1000]);
  o.horizonFatalMass.set([2000, 2600, 2800, 2000]);
  o.unknownMass.set([1000, 1000, 1800, 1000]);
  o.escapeSlack.set([-1, -1, -2, -1]);
  o.hard[3] = HARD_STATUS.REJECT_PROVEN;
  assert.equal(violationDominates(controller, 0, 2), 1);
  assert.equal(recoverRiskFrontier(controller), 2);
  assert.deepEqual(Array.from(o.acceptable), [1, 1, 0, 0]);
});

test("ownership PoC chooses the root objective by terminal mode and comparable deadlines", () => {
  const engine = {}; const bands = { killDeadline: 4, starDeadline: 7 };
  assert.equal(rootObjective(engine, bands, GLOBAL_MODE.NORMAL), OBJECTIVE.ATTACK);
  bands.killDeadline = 9;
  assert.equal(rootObjective(engine, bands, GLOBAL_MODE.NORMAL), OBJECTIVE.STAR);
  assert.equal(rootObjective(engine, bands, GLOBAL_MODE.HARD_SURVIVAL), OBJECTIVE.PRESERVE);
  assert.equal(rootObjective(engine, bands, GLOBAL_MODE.FORCED_LOSS_RECOVERY), OBJECTIVE.COMEBACK);
});

test("strategic purpose preference changes with the selected objective", () => {
  assert.ok(purposeRank(PLAN_PURPOSE.DIRECT_KILL, OBJECTIVE.ATTACK) <
    purposeRank(PLAN_PURPOSE.STAR_COLLECT, OBJECTIVE.ATTACK));
  assert.ok(purposeRank(PLAN_PURPOSE.STAR_COLLECT, OBJECTIVE.STAR) <
    purposeRank(PLAN_PURPOSE.REPOSITION, OBJECTIVE.STAR));
});

test("ownership PoC portfolio preserves every Risk/Pareto action", () => {
  const engine = new ProductionRootEngine();
  installOwnershipArchitecturePoc(engine);
  const controller = engine.riskController; const outcome = controller.outcome;
  outcome.reset(4); controller.acceptableCount = 3;
  outcome.acceptable.set([1, 1, 1, 0]); outcome.dominated[1] = 1;
  outcome.expectedValue.set([10, 40, 20, 100]);
  outcome.tacticalValue.set([10, 40, 20, 100]);
  const actions = new Uint8Array([1, 2, 3, 4]);
  engine.strategyBands.reset(4);
  engine.strategyBands.buildPortfolio(controller, engine.policy.selector.decisions,
    engine.policy.strategyId, actions, 4, null);
  assert.deepEqual(Array.from(engine.strategyBands.selected.slice(0, 4)), [1, 0, 1, 0]);
});
