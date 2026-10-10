"use strict";

// BP136: reuse BP135's completed depth-3 root cells and put the incumbent and
// candidate into one simultaneous 2xN zero-sum matrix. This is diagnostic-only:
// neither the raw equilibrium nor the risk-contaminated policy owns an action.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { RULE } = require("../../../engine-v2/src/generated/fast-config");
const { SEARCH_STATUS, PROBABILITY_SCALE } = require(
  "../../../engine-v2/src/abi/search-codes");
const { ACTION_FAMILY, OPPONENT_EVENT } = require(
  "../../../engine-v2/src/abi/policy-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { actionFamily } = require("../../../engine-v2/src/policy/layer");
const { StageMatrix, DoubleOracleSolver } = require(
  "../../../engine-v2/src/search/matrix");
const { PolicyArena } = require("../../../engine-v2/src/search/arenas");
const { RiskKernel } = require("../../../engine-v2/src/search/risk");
const { SUPPORT_STATUS } = require(
  "../../../engine-v2/src/runtime/escape-obligation");
const { LEAF_LANE, ROOT_CAPACITY } = require(
  "./semantic-attack-depth3-leaf-backup-shadow");
const { MOVE_VARIANT_NAME, VARIANT_COUNT, VARIANT_COMMON_STATUS } = require(
  "./semantic-attack-depth3-move-variant-shadow");

const POINTWISE_RELATION = Object.freeze({ INCOMPLETE: 0,
  CANDIDATE_DOMINATES: 1, EQUAL: 2, INCUMBENT_DOMINATES: 3, TRADEOFF: 4 });
const MATRIX_LANE = Object.freeze({ RAW: 0, ROBUST: 1, COUNT: 2 });
const MATRIX_LANE_NAME = Object.freeze(["RAW", "ROBUST"]);
const SUPPORT_CLASS = Object.freeze({ NONE: 0, MIXED: 1, FULL: 2,
  INCOMPLETE: 3 });
const NORMALIZATION_MODE = Object.freeze({ IDENTITY: 0, SHIFT: 1, SCALE: 2 });
const SOLVER_ITERATIONS = 8192;

function pointwiseRelation(baseline, candidate, count) {
  if (!baseline || !candidate || count < 1) return POINTWISE_RELATION.INCOMPLETE;
  let higher = 0; let lower = 0;
  for (let column = 0; column < count; column += 1) {
    if (candidate[column] > baseline[column]) higher = 1;
    else if (candidate[column] < baseline[column]) lower = 1;
  }
  if (!higher && !lower) return POINTWISE_RELATION.EQUAL;
  if (higher && !lower) return POINTWISE_RELATION.CANDIDATE_DOMINATES;
  if (!higher && lower) return POINTWISE_RELATION.INCUMBENT_DOMINATES;
  return POINTWISE_RELATION.TRADEOFF;
}

function supportClass(status, probability) {
  if (status !== SEARCH_STATUS.COMPLETE && status !== SEARCH_STATUS.APPROXIMATE)
    return SUPPORT_CLASS.INCOMPLETE;
  if (probability <= 0) return SUPPORT_CLASS.NONE;
  if (probability >= PROBABILITY_SCALE) return SUPPORT_CLASS.FULL;
  return SUPPORT_CLASS.MIXED;
}

function buildReadOnlyNominal(opponent, actionFamilies, count, contextClass,
    outProbability, rawProbability, remainder) {
  if (!opponent || count < 1 || count > actionFamilies.length ||
      count > outProbability.length) return 0;
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    const family = actionFamilies[index]; let raw = 1000;
    if (family === ACTION_FAMILY.FIRE)
      raw += opponent.propensity(OPPONENT_EVENT.FIRE, contextClass) * 2;
    else if (family === ACTION_FAMILY.BOMB)
      raw += opponent.propensity(OPPONENT_EVENT.BOMB, contextClass);
    else if (family === ACTION_FAMILY.SKILL)
      raw += opponent.propensity(OPPONENT_EVENT.SKILL, contextClass);
    else if (family === ACTION_FAMILY.MOVE)
      raw += opponent.propensity(OPPONENT_EVENT.ADVANCE, contextClass);
    else if (family === ACTION_FAMILY.TURN)
      raw += opponent.propensity(OPPONENT_EVENT.TURN_EXTRA, contextClass);
    else raw += 5000 - Math.floor(opponent.riskPreference * 50);
    rawProbability[index] = raw; sum += raw;
  }
  let assigned = 0;
  for (let index = 0; index < count; index += 1) {
    const scaled = rawProbability[index] * PROBABILITY_SCALE;
    outProbability[index] = Math.floor(scaled / sum);
    remainder[index] = scaled % sum; assigned += outProbability[index];
  }
  while (assigned < PROBABILITY_SCALE) {
    let best = 0;
    for (let index = 1; index < count; index += 1)
      if (remainder[index] > remainder[best]) best = index;
    outProbability[best] += 1; remainder[best] = 0; assigned += 1;
  }
  return count;
}

class SemanticAttackDepth3ResponseMatrixShadow {
  constructor(options = {}) {
    this.matrix = options.matrix || new StageMatrix({ maxRows: 2,
      maxColumns: SEARCH_CAPACITY.MAX_ENEMY_POLICIES });
    this.policyArena = options.policyArena || new PolicyArena({ maxPolicies: 2,
      maxEntries: 4 });
    this.solver = options.solver || new DoubleOracleSolver(this.matrix,
      this.policyArena);
    this.risk = options.risk || new RiskKernel();
    this.enemyFamilies = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.nominal = new Uint16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.rawProbability = new Uint32Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.remainder = new Uint32Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.baselineCells = new Int16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.candidateCells = new Int16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.lastAttempted = 0; this.lastComplete = new Uint8Array(VARIANT_COUNT);
    this.lastEnemyCount = new Uint8Array(VARIANT_COUNT);
    this.lastPointwise = new Uint8Array(VARIANT_COUNT);
    this.lastNormalizationMode = new Uint8Array(VARIANT_COUNT);
    this.lastNormalizationCollisionCount = new Uint8Array(VARIANT_COUNT);
    const laneCells = VARIANT_COUNT * MATRIX_LANE.COUNT;
    this.lastStatus = new Uint8Array(laneCells);
    this.lastCandidateProbability = new Uint16Array(laneCells);
    this.lastStageLower = new Int16Array(laneCells);
    this.lastStageUpper = new Int16Array(laneCells);
    this.lastGap = new Uint16Array(laneCells);
    this.lastBoundKind = new Uint8Array(laneCells);
    this.lastSupportClass = new Uint8Array(laneCells);
    this.lastCommonStatus = new Uint8Array(MATRIX_LANE.COUNT);
    this.lastCommonSupportClass = new Uint8Array(MATRIX_LANE.COUNT);
    this.lastRisk = 0; this.lastStateClass = 0; this.lastContextClass = 0;
    this.recordAttempted = new Uint8Array(ROOT_CAPACITY);
    this.recordComplete = new Uint8Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordEnemyCount = new Uint8Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordPointwise = new Uint8Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordNormalizationMode = new Uint8Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordNormalizationCollisionCount = new Uint8Array(
      ROOT_CAPACITY * VARIANT_COUNT);
    this.recordStatus = new Uint8Array(ROOT_CAPACITY * laneCells);
    this.recordCandidateProbability = new Uint16Array(ROOT_CAPACITY * laneCells);
    this.recordStageLower = new Int16Array(ROOT_CAPACITY * laneCells);
    this.recordStageUpper = new Int16Array(ROOT_CAPACITY * laneCells);
    this.recordGap = new Uint16Array(ROOT_CAPACITY * laneCells);
    this.recordBoundKind = new Uint8Array(ROOT_CAPACITY * laneCells);
    this.recordSupportClass = new Uint8Array(ROOT_CAPACITY * laneCells);
    this.recordCommonStatus = new Uint8Array(ROOT_CAPACITY * MATRIX_LANE.COUNT);
    this.recordCommonSupportClass = new Uint8Array(ROOT_CAPACITY * MATRIX_LANE.COUNT);
    this.recordRisk = new Uint8Array(ROOT_CAPACITY);
    this.recordStateClass = new Uint8Array(ROOT_CAPACITY);
    this.recordContextClass = new Uint8Array(ROOT_CAPACITY);
    this.attemptCount = 0; this.completeCount = 0;
    this.incompleteCount = 0; this.variantDisagreementCount = 0;
    this.pointwiseCount = new Uint32Array(5);
    this.supportClassCount = new Uint32Array(MATRIX_LANE.COUNT * 4);
    this.hotAllocationCount = 0;
  }

  clearLast() {
    this.lastAttempted = 0; this.lastComplete.fill(0);
    this.lastEnemyCount.fill(0); this.lastPointwise.fill(0);
    this.lastNormalizationMode.fill(NORMALIZATION_MODE.IDENTITY);
    this.lastNormalizationCollisionCount.fill(0);
    this.lastStatus.fill(0); this.lastCandidateProbability.fill(0);
    this.lastStageLower.fill(0); this.lastStageUpper.fill(0);
    this.lastGap.fill(0); this.lastBoundKind.fill(0);
    this.lastSupportClass.fill(SUPPORT_CLASS.INCOMPLETE);
    this.lastCommonStatus.fill(VARIANT_COMMON_STATUS.NOT_EVALUATED);
    this.lastCommonSupportClass.fill(SUPPORT_CLASS.INCOMPLETE);
    this.lastRisk = 0; this.lastStateClass = 0; this.lastContextClass = 0;
  }

  copyRootCells(policy, baselineRow, candidateRow, count) {
    const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
    const baseline = policy.baselineSearch?.rootCellScore;
    const candidate = policy.searchEngine?.rootCellScore;
    if (!baseline || !candidate) return 0;
    for (let column = 0; column < count; column += 1) {
      this.baselineCells[column] = baseline[baselineRow * stride + column];
      this.candidateCells[column] = candidate[candidateRow * stride + column];
    }
    return 1;
  }

  normalizeValue(value, mode, offset, minimum, range) {
    if (mode !== NORMALIZATION_MODE.SCALE) return value + offset;
    return Math.round((value - minimum) * 20000 / range) - 10000;
  }

  fillMatrix(count, variant) {
    let minimum = 32767; let maximum = -32768;
    for (let column = 0; column < count; column += 1) {
      const left = this.baselineCells[column];
      const right = this.candidateCells[column];
      if (left < minimum) minimum = left; if (right < minimum) minimum = right;
      if (left > maximum) maximum = left; if (right > maximum) maximum = right;
    }
    const range = maximum - minimum; let mode = NORMALIZATION_MODE.IDENTITY;
    let offset = 0;
    if (minimum < -10000 || maximum > 10000) {
      if (range <= 20000) {
        mode = NORMALIZATION_MODE.SHIFT;
        offset = minimum < -10000 ? -10000 - minimum : 10000 - maximum;
      } else mode = NORMALIZATION_MODE.SCALE;
    }
    this.lastNormalizationMode[variant] = mode;
    if (this.matrix.initialize(2, count) !== SEARCH_STATUS.COMPLETE) return 0;
    for (let column = 0; column < count; column += 1) {
      const originalLeft = this.baselineCells[column];
      const originalRight = this.candidateCells[column];
      const left = this.normalizeValue(originalLeft, mode, offset, minimum, range);
      const right = this.normalizeValue(originalRight, mode, offset, minimum, range);
      if (originalLeft !== originalRight && left === right)
        this.lastNormalizationCollisionCount[variant] += 1;
      if (this.matrix.setCell(0, column, left, left, 1) !== SEARCH_STATUS.COMPLETE ||
          this.matrix.setCell(1, column, right, right, 1) !== SEARCH_STATUS.COMPLETE)
        return 0;
    }
    return 1;
  }

  solveLane(variant, lane) {
    const at = variant * MATRIX_LANE.COUNT + lane;
    const mark = this.policyArena.mark();
    const status = this.solver.solve(SOLVER_ITERATIONS, 16,
      this.matrix.columns + 2);
    let candidateProbability = 0;
    for (let slot = 0; slot < this.solver.rowCount; slot += 1)
      if (this.solver.rowIds[slot] === 1)
        candidateProbability = this.solver.averageRow[slot];
    this.lastStatus[at] = status;
    this.lastCandidateProbability[at] = candidateProbability;
    this.lastStageLower[at] = this.solver.stageLower;
    this.lastStageUpper[at] = this.solver.stageUpper;
    this.lastGap[at] = Math.min(65535, Math.max(0, this.solver.gap));
    this.lastBoundKind[at] = this.solver.boundKind;
    this.lastSupportClass[at] = supportClass(status, candidateProbability);
    this.policyArena.rewind(mark);
    return status === SEARCH_STATUS.COMPLETE || status === SEARCH_STATUS.APPROXIMATE;
  }

  prepareNominal(engine, count) {
    for (let column = 0; column < count; column += 1)
      this.enemyFamilies[column] = engine.enemyActionFamilies ?
        engine.enemyActionFamilies[column] : actionFamily(engine.enemyActions[column]);
    const opponent = engine.policy?.opponent;
    const context = typeof engine.opponentContext === "function" ?
      engine.opponentContext() : 0;
    this.lastContextClass = context;
    return buildReadOnlyNominal(opponent, this.enemyFamilies, count, context,
      this.nominal, this.rawProbability, this.remainder);
  }

  prepareRiskClass(engine) {
    const arrays = engine.adapter.state.arrays;
    const starDelta = arrays[ARRAY.TANK_STARS][0] -
      arrays[ARRAY.TANK_STARS][1];
    const remaining = Math.max(0, RULE.FRAME_RECORD_LIMIT - 1 -
      arrays[ARRAY.SCALAR][SCALAR.FRAME]);
    const obligation = engine.escapeObligation;
    const committedSlack = obligation?.supportStatus === SUPPORT_STATUS.COMPLETE ?
      obligation.rootSlack : 0;
    this.lastRisk = Number.isSafeInteger(engine.policy?.baseRisk) ?
      engine.policy.baseRisk : 0;
    this.lastStateClass = this.risk.profile.classify(starDelta, remaining,
      committedSlack, 1, engine.adapter.informationComplete ? 0 : 2, 0);
  }

  evaluate(engine, leafShadow, baselineRow, candidateRow) {
    this.clearLast();
    if (!leafShadow?.lastAttempted || engine.enemyCount < 1 ||
        baselineRow < 0 || candidateRow < 0 ||
        !this.prepareNominal(engine, engine.enemyCount)) return;
    this.prepareRiskClass(engine); this.lastAttempted = 1; this.attemptCount += 1;
    let allComplete = 1;
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
      const fullCell = LEAF_LANE.FULL * VARIANT_COUNT + variant;
      const policy = leafShadow.policies[fullCell];
      if (!leafShadow.lastComplete[fullCell] ||
          !this.copyRootCells(policy, baselineRow, candidateRow,
            engine.enemyCount) || !this.fillMatrix(engine.enemyCount, variant)) {
        allComplete = 0; continue;
      }
      this.lastEnemyCount[variant] = engine.enemyCount;
      this.lastPointwise[variant] = pointwiseRelation(this.baselineCells,
        this.candidateCells, engine.enemyCount);
      if (!this.solveLane(variant, MATRIX_LANE.RAW)) {
        allComplete = 0; continue;
      }
      if (this.risk.transformEnemyMatrix(this.matrix, this.nominal,
          this.lastRisk, this.lastStateClass) !== SEARCH_STATUS.COMPLETE ||
          !this.solveLane(variant, MATRIX_LANE.ROBUST)) {
        allComplete = 0; continue;
      }
      this.lastComplete[variant] = 1;
      this.pointwiseCount[this.lastPointwise[variant]] += 1;
      for (let lane = 0; lane < MATRIX_LANE.COUNT; lane += 1)
        this.supportClassCount[lane * 4 +
          this.lastSupportClass[variant * MATRIX_LANE.COUNT + lane]] += 1;
    }
    for (let lane = 0; lane < MATRIX_LANE.COUNT; lane += 1) {
      let status = allComplete ? VARIANT_COMMON_STATUS.AGREEMENT :
        VARIANT_COMMON_STATUS.INCOMPLETE;
      const first = this.lastSupportClass[lane];
      if (status === VARIANT_COMMON_STATUS.AGREEMENT)
        for (let variant = 1; variant < VARIANT_COUNT; variant += 1)
          if (this.lastSupportClass[variant * MATRIX_LANE.COUNT + lane] !== first)
            status = VARIANT_COMMON_STATUS.DISAGREEMENT;
      this.lastCommonStatus[lane] = status;
      this.lastCommonSupportClass[lane] = status ===
        VARIANT_COMMON_STATUS.AGREEMENT ? first : SUPPORT_CLASS.INCOMPLETE;
      if (status === VARIANT_COMMON_STATUS.DISAGREEMENT)
        this.variantDisagreementCount += 1;
    }
    if (allComplete) this.completeCount += 1;
    else this.incompleteCount += 1;
  }

  record(at) {
    if (at < 0 || at >= ROOT_CAPACITY) return;
    this.recordAttempted[at] = this.lastAttempted;
    const variantOffset = at * VARIANT_COUNT;
    const laneOffset = at * VARIANT_COUNT * MATRIX_LANE.COUNT;
    this.recordComplete.set(this.lastComplete, variantOffset);
    this.recordEnemyCount.set(this.lastEnemyCount, variantOffset);
    this.recordPointwise.set(this.lastPointwise, variantOffset);
    this.recordNormalizationMode.set(this.lastNormalizationMode, variantOffset);
    this.recordNormalizationCollisionCount.set(
      this.lastNormalizationCollisionCount, variantOffset);
    this.recordStatus.set(this.lastStatus, laneOffset);
    this.recordCandidateProbability.set(this.lastCandidateProbability, laneOffset);
    this.recordStageLower.set(this.lastStageLower, laneOffset);
    this.recordStageUpper.set(this.lastStageUpper, laneOffset);
    this.recordGap.set(this.lastGap, laneOffset);
    this.recordBoundKind.set(this.lastBoundKind, laneOffset);
    this.recordSupportClass.set(this.lastSupportClass, laneOffset);
    const commonOffset = at * MATRIX_LANE.COUNT;
    this.recordCommonStatus.set(this.lastCommonStatus, commonOffset);
    this.recordCommonSupportClass.set(this.lastCommonSupportClass, commonOffset);
    this.recordRisk[at] = this.lastRisk; this.recordStateClass[at] = this.lastStateClass;
    this.recordContextClass[at] = this.lastContextClass;
  }

  root(at) {
    if (at < 0 || at >= ROOT_CAPACITY || !this.recordAttempted[at]) return null;
    const variants = []; const variantOffset = at * VARIANT_COUNT;
    const laneOffset = at * VARIANT_COUNT * MATRIX_LANE.COUNT;
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
      const lanes = [];
      for (let lane = 0; lane < MATRIX_LANE.COUNT; lane += 1) {
        const cell = laneOffset + variant * MATRIX_LANE.COUNT + lane;
        lanes.push({ name: MATRIX_LANE_NAME[lane], status: this.recordStatus[cell],
          candidateProbability: this.recordCandidateProbability[cell],
          supportClass: this.recordSupportClass[cell],
          stageLower: this.recordStageLower[cell],
          stageUpper: this.recordStageUpper[cell], gap: this.recordGap[cell],
          boundKind: this.recordBoundKind[cell] });
      }
      variants.push({ name: MOVE_VARIANT_NAME[variant],
        complete: Boolean(this.recordComplete[variantOffset + variant]),
        enemyCount: this.recordEnemyCount[variantOffset + variant],
        pointwiseRelation: this.recordPointwise[variantOffset + variant], lanes });
      variants[variants.length - 1].normalizationMode =
        this.recordNormalizationMode[variantOffset + variant];
      variants[variants.length - 1].normalizationCollisionCount =
        this.recordNormalizationCollisionCount[variantOffset + variant];
    }
    const common = []; const commonOffset = at * MATRIX_LANE.COUNT;
    for (let lane = 0; lane < MATRIX_LANE.COUNT; lane += 1)
      common.push({ name: MATRIX_LANE_NAME[lane],
        status: this.recordCommonStatus[commonOffset + lane],
        supportClass: this.recordCommonSupportClass[commonOffset + lane] });
    return { diagnosticOnly: true, actionOwnership: false,
      risk: this.recordRisk[at], stateClass: this.recordStateClass[at],
      contextClass: this.recordContextClass[at], variants, common };
  }

  totalHotAllocationCount() {
    return this.hotAllocationCount + (this.matrix.hotAllocationCount || 0) +
      (this.solver.hotAllocationCount || 0) +
      (this.policyArena.hotAllocationCount || 0) +
      (this.risk.hotAllocationCount || 0);
  }

  summary() {
    const pointwise = {};
    for (const [name, value] of Object.entries(POINTWISE_RELATION))
      pointwise[name] = this.pointwiseCount[value];
    const lanes = [];
    for (let lane = 0; lane < MATRIX_LANE.COUNT; lane += 1)
      lanes.push({ name: MATRIX_LANE_NAME[lane], supportClassCount: {
        none: this.supportClassCount[lane * 4 + SUPPORT_CLASS.NONE],
        mixed: this.supportClassCount[lane * 4 + SUPPORT_CLASS.MIXED],
        full: this.supportClassCount[lane * 4 + SUPPORT_CLASS.FULL],
        incomplete: this.supportClassCount[lane * 4 + SUPPORT_CLASS.INCOMPLETE] } });
    return { diagnosticOnly: true, actionOwnership: false,
      attemptCount: this.attemptCount, completeCount: this.completeCount,
      incompleteCount: this.incompleteCount,
      variantDisagreementCount: this.variantDisagreementCount,
      pointwise, lanes, hotAllocationCount: this.totalHotAllocationCount() };
  }
}

module.exports = { POINTWISE_RELATION, MATRIX_LANE, MATRIX_LANE_NAME,
  SUPPORT_CLASS, NORMALIZATION_MODE, SOLVER_ITERATIONS, pointwiseRelation, supportClass,
  buildReadOnlyNominal, SemanticAttackDepth3ResponseMatrixShadow };
