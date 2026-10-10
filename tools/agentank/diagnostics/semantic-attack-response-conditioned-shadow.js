"use strict";

// BP137: retain the exact BP135 response cells, but separate the ATTACK leaf
// contribution from the rest of the leaf and record the observable opponent
// nominal policy. Historical opponent actions are joined offline only; they
// never enter this Shadow evaluator or production decisions.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { PROBABILITY_SCALE } = require(
  "../../../engine-v2/src/abi/search-codes");
const { OBJECTIVE_DIMENSION, OBJECTIVE_RELATION } = require(
  "./semantic-attack-objective-progress-interval");
const { LEAF_LANE, ROOT_CAPACITY } = require(
  "./semantic-attack-depth3-leaf-backup-shadow");
const { MOVE_VARIANT_NAME, VARIANT_COUNT } = require(
  "./semantic-attack-depth3-move-variant-shadow");

const MAX_COLUMNS = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
const ROOT_VARIANT_CELLS = ROOT_CAPACITY * VARIANT_COUNT * MAX_COLUMNS;
const ROOT_COLUMN_CELLS = ROOT_CAPACITY * MAX_COLUMNS;

function expectedLower(values, probabilities, count, offset = 0) {
  let sum = 0;
  for (let column = 0; column < count; column += 1)
    sum += values[offset + column] * probabilities[column];
  return Math.floor(sum / PROBABILITY_SCALE);
}

function verifiedStructuralProgress(objective) {
  if (!objective || objective.lastRelation !==
      OBJECTIVE_RELATION.CANDIDATE_DOMINATES) return 0;
  const left = objective.current; const right = objective.candidate;
  return right[OBJECTIVE_DIMENSION.DEADLINE] <
      left[OBJECTIVE_DIMENSION.DEADLINE] ||
    right[OBJECTIVE_DIMENSION.MUZZLE_COVERAGE] >
      left[OBJECTIVE_DIMENSION.MUZZLE_COVERAGE] ||
    right[OBJECTIVE_DIMENSION.RESPONSE_VIABILITY] >
      left[OBJECTIVE_DIMENSION.RESPONSE_VIABILITY] ||
    right[OBJECTIVE_DIMENSION.ESCAPE_BRANCHES] >
      left[OBJECTIVE_DIMENSION.ESCAPE_BRANCHES] ||
    right[OBJECTIVE_DIMENSION.COUNTER_EXPOSURE] <
      left[OBJECTIVE_DIMENSION.COUNTER_EXPOSURE] ? 1 : 0;
}

class SemanticAttackResponseConditionedShadow {
  constructor() {
    this.lastAttempted = 0; this.lastComplete = new Uint8Array(VARIANT_COUNT);
    this.lastEnemyCount = 0;
    this.lastEnemyAction = new Uint8Array(MAX_COLUMNS);
    this.lastEnemyArgument = new Uint16Array(MAX_COLUMNS);
    this.lastNominalProbability = new Uint16Array(MAX_COLUMNS);
    this.lastFullBaseline = new Int16Array(VARIANT_COUNT * MAX_COLUMNS);
    this.lastFullCandidate = new Int16Array(VARIANT_COUNT * MAX_COLUMNS);
    this.lastNoAttackBaseline = new Int16Array(VARIANT_COUNT * MAX_COLUMNS);
    this.lastNoAttackCandidate = new Int16Array(VARIANT_COUNT * MAX_COLUMNS);
    this.lastFullExpectedDelta = new Int32Array(VARIANT_COUNT);
    this.lastNoAttackExpectedDelta = new Int32Array(VARIANT_COUNT);
    this.lastAttackExpectedContribution = new Int32Array(VARIANT_COUNT);
    this.lastVerifiedStructuralProgress = 0;
    this.recordAttempted = new Uint8Array(ROOT_CAPACITY);
    this.recordComplete = new Uint8Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordEnemyCount = new Uint8Array(ROOT_CAPACITY);
    this.recordEnemyAction = new Uint8Array(ROOT_COLUMN_CELLS);
    this.recordEnemyArgument = new Uint16Array(ROOT_COLUMN_CELLS);
    this.recordNominalProbability = new Uint16Array(ROOT_COLUMN_CELLS);
    this.recordFullBaseline = new Int16Array(ROOT_VARIANT_CELLS);
    this.recordFullCandidate = new Int16Array(ROOT_VARIANT_CELLS);
    this.recordNoAttackBaseline = new Int16Array(ROOT_VARIANT_CELLS);
    this.recordNoAttackCandidate = new Int16Array(ROOT_VARIANT_CELLS);
    this.recordFullExpectedDelta = new Int32Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordNoAttackExpectedDelta = new Int32Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordAttackExpectedContribution = new Int32Array(
      ROOT_CAPACITY * VARIANT_COUNT);
    this.recordVerifiedStructuralProgress = new Uint8Array(ROOT_CAPACITY);
    this.attemptCount = 0; this.completeCount = 0; this.incompleteCount = 0;
    this.verifiedStructuralProgressCount = 0; this.hotAllocationCount = 0;
  }

  clearLast() {
    this.lastAttempted = 0; this.lastComplete.fill(0); this.lastEnemyCount = 0;
    this.lastEnemyAction.fill(0); this.lastEnemyArgument.fill(0);
    this.lastNominalProbability.fill(0); this.lastFullBaseline.fill(0);
    this.lastFullCandidate.fill(0); this.lastNoAttackBaseline.fill(0);
    this.lastNoAttackCandidate.fill(0); this.lastFullExpectedDelta.fill(0);
    this.lastNoAttackExpectedDelta.fill(0);
    this.lastAttackExpectedContribution.fill(0);
    this.lastVerifiedStructuralProgress = 0;
  }

  copyLane(policy, baselineRow, candidateRow, count, variant,
      baselineOutput, candidateOutput) {
    const stride = MAX_COLUMNS; const offset = variant * MAX_COLUMNS;
    const baseline = policy.baselineSearch?.rootCellScore;
    const candidate = policy.searchEngine?.rootCellScore;
    if (!baseline || !candidate) return 0;
    for (let column = 0; column < count; column += 1) {
      baselineOutput[offset + column] = baseline[baselineRow * stride + column];
      candidateOutput[offset + column] = candidate[candidateRow * stride + column];
    }
    return 1;
  }

  evaluate(engine, leafShadow, responseMatrix, objective,
      baselineRow, candidateRow) {
    this.clearLast();
    if (!leafShadow?.lastAttempted || !responseMatrix?.lastAttempted ||
        engine.enemyCount < 1 || engine.enemyCount > MAX_COLUMNS ||
        baselineRow < 0 || candidateRow < 0) return;
    this.lastAttempted = 1; this.attemptCount += 1;
    this.lastEnemyCount = engine.enemyCount;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      this.lastEnemyAction[column] = engine.enemyActions[column];
      this.lastEnemyArgument[column] = engine.enemyArguments[column];
      this.lastNominalProbability[column] = responseMatrix.nominal[column];
    }
    this.lastVerifiedStructuralProgress = verifiedStructuralProgress(objective);
    if (this.lastVerifiedStructuralProgress)
      this.verifiedStructuralProgressCount += 1;
    let allComplete = 1;
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
      const full = LEAF_LANE.FULL * VARIANT_COUNT + variant;
      const noAttack = LEAF_LANE.NO_ATTACK * VARIANT_COUNT + variant;
      if (!leafShadow.lastComplete[full] || !leafShadow.lastComplete[noAttack] ||
          !responseMatrix.lastComplete[variant] ||
          !this.copyLane(leafShadow.policies[full], baselineRow, candidateRow,
            engine.enemyCount, variant, this.lastFullBaseline,
            this.lastFullCandidate) ||
          !this.copyLane(leafShadow.policies[noAttack], baselineRow,
            candidateRow, engine.enemyCount, variant,
            this.lastNoAttackBaseline, this.lastNoAttackCandidate)) {
        allComplete = 0; continue;
      }
      const offset = variant * MAX_COLUMNS;
      const fullBaseline = expectedLower(this.lastFullBaseline,
        this.lastNominalProbability, engine.enemyCount, offset);
      const fullCandidate = expectedLower(this.lastFullCandidate,
        this.lastNominalProbability, engine.enemyCount, offset);
      const noAttackBaseline = expectedLower(this.lastNoAttackBaseline,
        this.lastNominalProbability, engine.enemyCount, offset);
      const noAttackCandidate = expectedLower(this.lastNoAttackCandidate,
        this.lastNominalProbability, engine.enemyCount, offset);
      this.lastFullExpectedDelta[variant] = fullCandidate - fullBaseline;
      this.lastNoAttackExpectedDelta[variant] =
        noAttackCandidate - noAttackBaseline;
      this.lastAttackExpectedContribution[variant] =
        this.lastFullExpectedDelta[variant] -
        this.lastNoAttackExpectedDelta[variant];
      this.lastComplete[variant] = 1;
    }
    if (allComplete) this.completeCount += 1;
    else this.incompleteCount += 1;
  }

  record(at) {
    if (at < 0 || at >= ROOT_CAPACITY) return;
    this.recordAttempted[at] = this.lastAttempted;
    this.recordEnemyCount[at] = this.lastEnemyCount;
    this.recordVerifiedStructuralProgress[at] =
      this.lastVerifiedStructuralProgress;
    const columnOffset = at * MAX_COLUMNS;
    this.recordEnemyAction.set(this.lastEnemyAction, columnOffset);
    this.recordEnemyArgument.set(this.lastEnemyArgument, columnOffset);
    this.recordNominalProbability.set(this.lastNominalProbability, columnOffset);
    const variantOffset = at * VARIANT_COUNT;
    this.recordComplete.set(this.lastComplete, variantOffset);
    this.recordFullExpectedDelta.set(this.lastFullExpectedDelta, variantOffset);
    this.recordNoAttackExpectedDelta.set(this.lastNoAttackExpectedDelta,
      variantOffset);
    this.recordAttackExpectedContribution.set(
      this.lastAttackExpectedContribution, variantOffset);
    const cellOffset = at * VARIANT_COUNT * MAX_COLUMNS;
    this.recordFullBaseline.set(this.lastFullBaseline, cellOffset);
    this.recordFullCandidate.set(this.lastFullCandidate, cellOffset);
    this.recordNoAttackBaseline.set(this.lastNoAttackBaseline, cellOffset);
    this.recordNoAttackCandidate.set(this.lastNoAttackCandidate, cellOffset);
  }

  cells(source, offset, count) {
    const output = new Array(count);
    for (let column = 0; column < count; column += 1)
      output[column] = source[offset + column];
    return output;
  }

  root(at) {
    if (at < 0 || at >= ROOT_CAPACITY || !this.recordAttempted[at]) return null;
    const count = this.recordEnemyCount[at]; const columnOffset = at * MAX_COLUMNS;
    const enemyActions = this.cells(this.recordEnemyAction, columnOffset, count);
    const enemyArguments = this.cells(this.recordEnemyArgument, columnOffset, count);
    const nominalProbability = this.cells(this.recordNominalProbability,
      columnOffset, count);
    const variants = []; const rootCellOffset = at * VARIANT_COUNT * MAX_COLUMNS;
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
      const offset = rootCellOffset + variant * MAX_COLUMNS;
      const metric = at * VARIANT_COUNT + variant;
      variants.push({ name: MOVE_VARIANT_NAME[variant],
        complete: Boolean(this.recordComplete[metric]),
        fullBaseline: this.cells(this.recordFullBaseline, offset, count),
        fullCandidate: this.cells(this.recordFullCandidate, offset, count),
        noAttackBaseline: this.cells(this.recordNoAttackBaseline, offset, count),
        noAttackCandidate: this.cells(this.recordNoAttackCandidate, offset, count),
        fullExpectedDelta: this.recordFullExpectedDelta[metric],
        noAttackExpectedDelta: this.recordNoAttackExpectedDelta[metric],
        attackExpectedContribution:
          this.recordAttackExpectedContribution[metric] });
    }
    return { diagnosticOnly: true, actionOwnership: false,
      historicalActionConsumed: false,
      verifiedStructuralProgress: Boolean(
        this.recordVerifiedStructuralProgress[at]),
      enemyActions, enemyArguments, nominalProbability, variants };
  }

  summary() {
    return { diagnosticOnly: true, actionOwnership: false,
      historicalActionConsumed: false, attemptCount: this.attemptCount,
      completeCount: this.completeCount, incompleteCount: this.incompleteCount,
      verifiedStructuralProgressCount: this.verifiedStructuralProgressCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { MAX_COLUMNS, expectedLower, verifiedStructuralProgress,
  SemanticAttackResponseConditionedShadow };
