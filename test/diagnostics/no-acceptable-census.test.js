"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { HARD_STATUS, ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { SAFETY_STATUS } =
  require("../../engine-v2/src/search/information-safety-closure");
const { FRONTIER_STATUS } =
  require("../../engine-v2/src/search/observation-safety-frontier");
const { PRIMARY, UNKNOWN_ORIGIN, NoAcceptableCensus } =
  require("../../tools/agentank/diagnostics/no-acceptable-census");

function fixture(count = 2) {
  const outcome = {
    count, hard: new Uint8Array(count), safety: new Uint8Array(count),
    immediateFatalMass: new Uint16Array(count), horizonFatalMass: new Uint16Array(count),
    unknownMass: new Uint16Array(count), escapeSlack: new Int8Array(count),
    coverage: new Uint16Array(count)
  };
  outcome.hard.fill(HARD_STATUS.ALLOW); outcome.safety.fill(SAFETY_STATUS.UNKNOWN);
  outcome.escapeSlack.fill(0); outcome.coverage.fill(10000);
  const safety = { committedDeathMass: new Uint16Array(count * 4),
    possibleProjectileDeathMass: new Uint16Array(count * 4),
    futureFireDeathMass: new Uint16Array(count * 4) };
  const controller = { outcome, noAcceptableAction: 1, risk: 0,
    immediateLimit: 0, horizonLimit: 0, unknownLimit: 0, minimumEscapeSlack: 0 };
  return { controller, outcome, safety };
}

test("NO_ACCEPTABLE census ignores ordinary accepted roots", () => {
  const { controller, safety } = fixture(); controller.noAcceptableAction = 0;
  const census = new NoAcceptableCensus();
  assert.equal(census.observe(controller, safety, ACTION.GO), -1);
  assert.equal(census.summary().rootCount, 0);
});

test("NO_ACCEPTABLE census detects a complete safe witness rejected by slack", () => {
  const { controller, outcome, safety } = fixture(1);
  outcome.safety[0] = SAFETY_STATUS.PROVEN_SAFE; outcome.escapeSlack[0] = -1;
  const census = new NoAcceptableCensus();
  assert.equal(census.observe(controller, safety, ACTION.GO),
    PRIMARY.COMPLETE_SAFE_CONFLICT);
  assert.equal(census.summary().completeSafeWitnessRoots, 1);
});

test("NO_ACCEPTABLE census attributes an unavoidable future FIRE horizon", () => {
  const { controller, outcome, safety } = fixture();
  for (let row = 0; row < 2; row += 1) {
    outcome.horizonFatalMass[row] = 5000;
    safety.futureFireDeathMass[row * 4 + 1] = 5000;
  }
  const census = new NoAcceptableCensus();
  assert.equal(census.observe(controller, safety, ACTION.TURN_LEFT),
    PRIMARY.FUTURE_FIRE_FATAL);
});

test("NO_ACCEPTABLE census distinguishes unknown support and cross-action tradeoff", () => {
  const unknown = fixture(); unknown.outcome.unknownMass.fill(1);
  const census = new NoAcceptableCensus();
  assert.equal(census.observe(unknown.controller, unknown.safety, ACTION.GO),
    PRIMARY.UNKNOWN_UNAVOIDABLE);

  const mixed = fixture(); mixed.outcome.horizonFatalMass[0] = 1;
  mixed.safety.possibleProjectileDeathMass[0] = 1;
  mixed.outcome.unknownMass[1] = 1;
  assert.equal(census.observe(mixed.controller, mixed.safety, ACTION.TURN_RIGHT),
    PRIMARY.CROSS_ACTION_TRADEOFF);
});

test("NO_ACCEPTABLE census attributes saturated unknown to the observation frontier", () => {
  const { controller, outcome, safety } = fixture();
  controller.risk = 48; controller.unknownLimit = 2280; outcome.unknownMass.fill(10000);
  const diagnostic = { observationSafetyAudited: new Uint8Array([1, 1]),
    observationSafetyStatusByAction: new Uint8Array([
      FRONTIER_STATUS.NO_WITNESS, FRONTIER_STATUS.UNKNOWN]),
    observationSupportComplete: 0 };
  const census = new NoAcceptableCensus(1);
  assert.equal(census.observe(controller, safety, ACTION.GO, 4, 1, 2, 0, diagnostic),
    PRIMARY.UNKNOWN_UNAVOIDABLE);
  const summary = census.summary();
  assert.deepEqual(summary.unknownOriginMasks,
    [[UNKNOWN_ORIGIN.OBSERVATION_NO_WITNESS | UNKNOWN_ORIGIN.OBSERVATION_INCOMPLETE, 1]]);
  assert.deepEqual(summary.unknownMinimumCounts, [[10000, 1]]);
  assert.deepEqual(summary.unknownPossibleProjectileCounts, [[2, 1]]);
  assert.deepEqual(summary.unknownObservationSupportCounts, [[0, 1]]);
  assert.deepEqual(summary.unknownRows,
    { observationNoWitness: 1, observationIncomplete: 1, baseSafety: 0 });
  assert.equal(summary.samples[0].unknownLimit, 2280);
});

test("NO_ACCEPTABLE census reports all-hard roots without manufacturing a source", () => {
  const { controller, outcome, safety } = fixture();
  outcome.hard.fill(HARD_STATUS.REJECT_PROVEN);
  const census = new NoAcceptableCensus(1);
  assert.equal(census.observe(controller, safety, ACTION.NONE, 17),
    PRIMARY.ALL_HARD_REJECTED);
  const summary = census.summary();
  assert.equal(summary.primary.ALL_HARD_REJECTED, 1);
  assert.equal(summary.samples[0].frame, 17);
  assert.deepEqual(summary.sourcePresenceMasks, [[0, 1]]);
});
