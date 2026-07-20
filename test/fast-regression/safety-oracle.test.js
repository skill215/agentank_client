"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SAFETY_ORACLE_STATUS: STATUS, SAFETY_ORACLE_KIND: KIND,
  evaluateFixedPolicy, solveSafetyStrategy } =
  require("../../tools/agentank/fast-regression/safety-oracle");

const safe = frame => ({ kind: KIND.TERMINAL, frame, dead: false });
const dead = frame => ({ kind: KIND.TERMINAL, frame, dead: true });
const ours = (informationSet, frame, children) => ({ kind: KIND.OUR_DECISION,
  informationSet, frame, children: Object.entries(children).map(([action, node]) => ({ action, node })) });
const support = (kind, frame, children, supportComplete = true) =>
  ({ kind, frame, children, supportComplete });

test("independent Safety oracle treats a fatal stun ChanceOutcome as possible death", () => {
  const root = ours("root", 0, { GO: support(KIND.CHANCE_OUTCOME, 0, [safe(1), dead(1)]) });
  const result = solveSafetyStrategy(root);
  assert.equal(result.status, STATUS.POSSIBLE_DEATH);
  assert.equal(result.policy, null);
});

test("strategy-existential safety emits the later response as an explicit obligation", () => {
  const future = ours("visible-projectile-at-frame-1", 1, { ESCAPE: safe(2), GO: dead(2) });
  const root = ours("root", 0, { GO: support(KIND.AUTOMATIC, 0, [future]) });
  const result = solveSafetyStrategy(root);
  assert.equal(result.status, STATUS.PROVEN_SAFE);
  assert.deepEqual(result.policy,
    { root: "GO", "visible-projectile-at-frame-1": "ESCAPE" });
  assert.deepEqual(result.obligations.map(item => [item.frame, item.action]),
    [[0, "GO"], [1, "ESCAPE"]]);
  assert.equal(evaluateFixedPolicy(root,
    { root: "GO", "visible-projectile-at-frame-1": "GO" }), STATUS.PROVEN_DEAD);
});

test("one observation group requires one common action across hidden worlds", () => {
  const leftWorld = ours("same-observation", 1, { LEFT: safe(2), RIGHT: dead(2) });
  const rightWorld = ours("same-observation", 1, { LEFT: dead(2), RIGHT: safe(2) });
  const hidden = support(KIND.HIDDEN_WORLD, 0, [leftWorld, rightWorld]);
  assert.equal(solveSafetyStrategy(hidden).status, STATUS.POSSIBLE_DEATH);
  const split = support(KIND.OBSERVATION_SPLIT, 0, [
    ours("observed-left", 1, { LEFT: safe(2), RIGHT: dead(2) }),
    ours("observed-right", 1, { LEFT: dead(2), RIGHT: safe(2) })]);
  assert.equal(solveSafetyStrategy(split).status, STATUS.PROVEN_SAFE);
});

test("incomplete support is UNKNOWN and cannot become PROVEN_SAFE", () => {
  const root = ours("root", 0, { WAIT: support(KIND.CHANCE_OUTCOME, 0, [safe(1)], false) });
  assert.equal(solveSafetyStrategy(root).status, STATUS.UNKNOWN);
});

test("exhaustive terminal assignments preserve 1-4 frame robust safety quantifiers", () => {
  for (let horizon = 1; horizon <= 4; horizon += 1) for (let bits = 0; bits < 16; bits += 1) {
    const terminal = index => bits & (1 << index) ? dead(horizon) : safe(horizon);
    let root = ours("root", 0, {
      A: support(KIND.CHANCE_OUTCOME, 0, [terminal(0), terminal(1)]),
      B: support(KIND.CHANCE_OUTCOME, 0, [terminal(2), terminal(3)]) });
    for (let frame = 1; frame < horizon; frame += 1)
      root = support(KIND.AUTOMATIC, frame, [root]);
    const expectedSafe = (!(bits & 1) && !(bits & 2)) || (!(bits & 4) && !(bits & 8));
    assert.equal(solveSafetyStrategy(root).status === STATUS.PROVEN_SAFE, expectedSafe,
      `horizon=${horizon} bits=${bits}`);
  }
});
