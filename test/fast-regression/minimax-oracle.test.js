"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const search = require("../../engine-v2/src/search");
const { KIND, DeterministicGenerator, differentialCase, solveValue, solveProof,
  runMutationCampaign } = require("../../tools/agentank/fast-regression/minimax-oracle");

test("independent Minimax oracle differentially validates randomized depth 1-4 quantified trees", () => {
  const generator = new DeterministicGenerator(0x51a7); let cases = 0;
  for (let depth = 1; depth <= 4; depth += 1) for (let index = 0; index < 64; index += 1) {
    const result = differentialCase(generator.tree(depth, 2), (depth * 19 + index) % 101);
    assert.deepEqual([result.actual.lower, result.actual.upper, result.actual.complete],
      [result.expected.lower, result.expected.upper, result.expected.complete]);
    for (const proof of Object.values(result.proofs)) assert.equal(proof.actual, proof.expected);
    cases += 1;
  }
  assert.equal(cases, 256);
});

test("quantifier order is intentionally non-commutative", () => {
  const values = [-10000, 10000, 10000, -10000].map(value => ({ kind: KIND.TERMINAL, value }));
  const oursThenEnemy = { kind: KIND.OUR_DECISION, children: [
    { kind: KIND.ENEMY_DECISION, children: values.slice(0, 2) },
    { kind: KIND.ENEMY_DECISION, children: values.slice(2, 4) }
  ] };
  const enemyThenOurs = { kind: KIND.ENEMY_DECISION, children: [
    { kind: KIND.OUR_DECISION, children: [values[0], values[2]] },
    { kind: KIND.OUR_DECISION, children: [values[1], values[3]] }
  ] };
  assert.equal(solveValue(oursThenEnemy).lower, -10000);
  assert.equal(solveValue(enemyThenOurs).lower, 10000);
});

test("hidden worlds and observations are strict AND support for proof", () => {
  const spec = { kind: KIND.OBSERVATION_SPLIT, children: [
    { kind: KIND.TERMINAL, value: 10000 },
    { kind: KIND.HIDDEN_WORLD, probabilities: [5000, 5000], children: [
      { kind: KIND.TERMINAL, value: 10000 }, { kind: KIND.TERMINAL, value: -10000 }
    ] }
  ] };
  assert.equal(solveProof(spec, search.PROOF_GOAL.FORCED_WIN), false);
});

test("the permanent defect corpus kills every registered Minimax mutant", () => {
  const campaign = runMutationCampaign();
  assert.equal(campaign.catalogSize, 8); assert.equal(campaign.killed, 8);
  assert.equal(campaign.scorePer10000, 10000);
});

test("child permutation, dominated actions, and risk monotonicity preserve oracle semantics", () => {
  const loss = { kind: KIND.TERMINAL, value: -10000 };
  const draw = { kind: KIND.TERMINAL, value: 0 };
  const win = { kind: KIND.TERMINAL, value: 10000 };
  const ours = { kind: KIND.OUR_DECISION, children: [loss, draw, win] };
  const permuted = { kind: KIND.OUR_DECISION, children: [win, loss, draw] };
  assert.deepEqual(solveValue(permuted), solveValue(ours));
  const withoutDominated = { kind: KIND.OUR_DECISION, children: [draw, win] };
  assert.deepEqual(solveValue(withoutDominated), solveValue(ours));
  const hidden = { kind: KIND.HIDDEN_WORLD, riskClass: 0,
    probabilities: [2500, 7500], children: [loss, win] };
  let previous = -10001;
  for (let risk = 0; risk <= 100; risk += 1) {
    const value = solveValue(hidden, risk).lower;
    assert.ok(value >= previous, `risk=${risk}`); previous = value;
  }
});
