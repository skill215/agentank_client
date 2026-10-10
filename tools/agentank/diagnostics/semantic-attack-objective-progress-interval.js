"use strict";

// Diagnostic-only observable objective interval.  It deliberately keeps the
// attack dimensions separate: no radix encoding, weighting, terminal label or
// future star stream is allowed to manufacture dominance.  One instance owns
// all scratch storage and performs no per-root allocation.

const { NONE_CELL } = require("../../../engine-v2/src/abi/fast-codes");
const { isAhead, rayClear } = require(
  "./native-tactical-domain-evaluator-poc");

const OBJECTIVE_DIMENSION = Object.freeze({
  PROGRESS: 0,
  DEADLINE: 1,
  MUZZLE_COVERAGE: 2,
  RESPONSE_VIABILITY: 3,
  ESCAPE_BRANCHES: 4,
  COUNTER_EXPOSURE: 5,
  COUNT: 6
});

const OBJECTIVE_RELATION = Object.freeze({
  INCOMPLETE: 0,
  CANDIDATE_DOMINATES: 1,
  INCUMBENT_DOMINATES: 2,
  EQUAL: 3,
  INCOMPARABLE: 4
});

function vectorObject(values, offset = 0) {
  return {
    progress: values[offset + OBJECTIVE_DIMENSION.PROGRESS],
    deadline: values[offset + OBJECTIVE_DIMENSION.DEADLINE],
    muzzleCoverage: values[offset + OBJECTIVE_DIMENSION.MUZZLE_COVERAGE],
    responseViability: values[offset + OBJECTIVE_DIMENSION.RESPONSE_VIABILITY],
    escapeBranches: values[offset + OBJECTIVE_DIMENSION.ESCAPE_BRANCHES],
    counterExposure: values[offset + OBJECTIVE_DIMENSION.COUNTER_EXPOSURE]
  };
}

class SemanticAttackObjectiveProgressInterval {
  constructor() {
    this.current = new Uint16Array(OBJECTIVE_DIMENSION.COUNT);
    this.candidate = new Uint16Array(OBJECTIVE_DIMENSION.COUNT);
    this.compareCount = 0; this.completeCount = 0;
    this.incompleteCount = 0; this.candidateDominanceCount = 0;
    this.incumbentDominanceCount = 0; this.equalCount = 0;
    this.incomparableCount = 0; this.hotAllocationCount = 0;
    this.lastRelation = OBJECTIVE_RELATION.INCOMPLETE;
  }

  rowVector(engine, pose, row, output) {
    const state = engine?.adapter?.state;
    const cell = engine?.projectedCell?.[row];
    const direction = engine?.projectedDirection?.[row];
    if (!state || cell === undefined || direction === undefined ||
        cell === NONE_CELL || cell >= state.cells || pose.selected < 0 ||
        pose.count !== engine.enemyCount) return 0;

    let muzzleCoverage = 0; let counterExposure = 0;
    for (let column = 0; column < pose.count; column += 1) {
      const enemy = pose.enemyCell[column];
      const enemyDirection = pose.enemyDirection[column];
      if (enemy === NONE_CELL || enemy >= state.cells) return 0;
      if (isAhead(state, cell, direction, enemy) &&
          rayClear(state, cell, enemy)) muzzleCoverage += 1;
      if (isAhead(state, enemy, enemyDirection, cell) &&
          rayClear(state, enemy, cell)) counterExposure += 1;
    }

    output[OBJECTIVE_DIMENSION.PROGRESS] = pose.rowProgress[row] || 0;
    output[OBJECTIVE_DIMENSION.DEADLINE] = pose.rowDeadline[row] ?? 255;
    output[OBJECTIVE_DIMENSION.MUZZLE_COVERAGE] = muzzleCoverage;
    output[OBJECTIVE_DIMENSION.RESPONSE_VIABILITY] =
      pose.successorResponseCoverage(engine, row);
    output[OBJECTIVE_DIMENSION.ESCAPE_BRANCHES] = pose.escapeCount(state, cell);
    output[OBJECTIVE_DIMENSION.COUNTER_EXPOSURE] = counterExposure;
    return 1;
  }

  dominates(left, right) {
    const noWorse =
      left[OBJECTIVE_DIMENSION.PROGRESS] >=
        right[OBJECTIVE_DIMENSION.PROGRESS] &&
      left[OBJECTIVE_DIMENSION.DEADLINE] <=
        right[OBJECTIVE_DIMENSION.DEADLINE] &&
      left[OBJECTIVE_DIMENSION.MUZZLE_COVERAGE] >=
        right[OBJECTIVE_DIMENSION.MUZZLE_COVERAGE] &&
      left[OBJECTIVE_DIMENSION.RESPONSE_VIABILITY] >=
        right[OBJECTIVE_DIMENSION.RESPONSE_VIABILITY] &&
      left[OBJECTIVE_DIMENSION.ESCAPE_BRANCHES] >=
        right[OBJECTIVE_DIMENSION.ESCAPE_BRANCHES] &&
      left[OBJECTIVE_DIMENSION.COUNTER_EXPOSURE] <=
        right[OBJECTIVE_DIMENSION.COUNTER_EXPOSURE];
    const strict =
      left[OBJECTIVE_DIMENSION.PROGRESS] >
        right[OBJECTIVE_DIMENSION.PROGRESS] ||
      left[OBJECTIVE_DIMENSION.DEADLINE] <
        right[OBJECTIVE_DIMENSION.DEADLINE] ||
      left[OBJECTIVE_DIMENSION.MUZZLE_COVERAGE] >
        right[OBJECTIVE_DIMENSION.MUZZLE_COVERAGE] ||
      left[OBJECTIVE_DIMENSION.RESPONSE_VIABILITY] >
        right[OBJECTIVE_DIMENSION.RESPONSE_VIABILITY] ||
      left[OBJECTIVE_DIMENSION.ESCAPE_BRANCHES] >
        right[OBJECTIVE_DIMENSION.ESCAPE_BRANCHES] ||
      left[OBJECTIVE_DIMENSION.COUNTER_EXPOSURE] <
        right[OBJECTIVE_DIMENSION.COUNTER_EXPOSURE];
    return noWorse && strict ? 1 : 0;
  }

  equal(left, right) {
    for (let dimension = 0; dimension < OBJECTIVE_DIMENSION.COUNT; dimension += 1)
      if (left[dimension] !== right[dimension]) return 0;
    return 1;
  }

  compare(engine, pose, incumbentRow, candidateRow) {
    this.compareCount += 1; this.lastRelation = OBJECTIVE_RELATION.INCOMPLETE;
    this.current.fill(0); this.candidate.fill(0);
    if (!this.rowVector(engine, pose, incumbentRow, this.current) ||
        !this.rowVector(engine, pose, candidateRow, this.candidate)) {
      this.incompleteCount += 1; return this.lastRelation;
    }
    this.completeCount += 1;
    if (this.dominates(this.candidate, this.current)) {
      this.candidateDominanceCount += 1;
      this.lastRelation = OBJECTIVE_RELATION.CANDIDATE_DOMINATES;
    } else if (this.dominates(this.current, this.candidate)) {
      this.incumbentDominanceCount += 1;
      this.lastRelation = OBJECTIVE_RELATION.INCUMBENT_DOMINATES;
    } else if (this.equal(this.current, this.candidate)) {
      this.equalCount += 1; this.lastRelation = OBJECTIVE_RELATION.EQUAL;
    } else {
      this.incomparableCount += 1;
      this.lastRelation = OBJECTIVE_RELATION.INCOMPARABLE;
    }
    return this.lastRelation;
  }

  summary() {
    return { semantics: "OBSERVABLE_ATTACK_OBJECTIVE_PARETO_V1",
      compareCount: this.compareCount, completeCount: this.completeCount,
      incompleteCount: this.incompleteCount,
      candidateDominanceCount: this.candidateDominanceCount,
      incumbentDominanceCount: this.incumbentDominanceCount,
      equalCount: this.equalCount, incomparableCount: this.incomparableCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { OBJECTIVE_DIMENSION, OBJECTIVE_RELATION, vectorObject,
  SemanticAttackObjectiveProgressInterval };
