"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { OBJECTIVE_DIMENSION, OBJECTIVE_RELATION } = require(
  "../../tools/agentank/diagnostics/semantic-attack-objective-progress-interval");
const { expectedLower, verifiedStructuralProgress } = require(
  "../../tools/agentank/diagnostics/semantic-attack-response-conditioned-shadow");

test("BP137 nominal expected value uses fixed integer lower rounding", () => {
  assert.equal(expectedLower(new Int16Array([-3, 4]),
    new Uint16Array([5000, 5000]), 2), 0);
  assert.equal(expectedLower(new Int16Array([-4, -3]),
    new Uint16Array([5000, 5000]), 2), -4);
});

test("BP137 generic route progress is not verified structural attack progress", () => {
  const current = new Uint16Array(OBJECTIVE_DIMENSION.COUNT);
  const candidate = new Uint16Array(OBJECTIVE_DIMENSION.COUNT);
  current[OBJECTIVE_DIMENSION.DEADLINE] = 4;
  candidate[OBJECTIVE_DIMENSION.DEADLINE] = 4;
  candidate[OBJECTIVE_DIMENSION.PROGRESS] = 1;
  const objective = { lastRelation: OBJECTIVE_RELATION.CANDIDATE_DOMINATES,
    current, candidate };
  assert.equal(verifiedStructuralProgress(objective), 0);
  candidate[OBJECTIVE_DIMENSION.MUZZLE_COVERAGE] = 1;
  assert.equal(verifiedStructuralProgress(objective), 1);
  objective.lastRelation = OBJECTIVE_RELATION.INCOMPARABLE;
  assert.equal(verifiedStructuralProgress(objective), 0);
});
