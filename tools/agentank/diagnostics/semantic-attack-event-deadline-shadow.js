"use strict";

// BP138: replace the generic ATTACK scalar with two structural event views.
// OUTCOME_FRONTIER observes committed incoming/outgoing projectiles, aim-ready
// setup and counter exposure at the common depth-3 continuation leaf.
// PROJECTILE_SETTLEMENT follows an emitted projectile through the existing
// normative timeline/reverse-viability deadline. Both lanes remove the old
// ATTACK leaf component, run in every finite movement-rule world, fail closed,
// and never own an action.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { HazardKernel } = require("../../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../../engine-v2/src/fast/hard-gate");
const { LEAF_COMPONENT, LEAF_COMPONENT_ALL } = require(
  "./native-tactical-domain-evaluator-poc");
const { PAIR_RELATION, NativeAttackPosePolicySearchPoc } = require(
  "./native-attack-pose-policy-search-poc");
const { MOVE_VARIANTS, MOVE_VARIANT_NAME, VARIANT_COUNT,
  VARIANT_COMMON_STATUS, isJointMovementGap } = require(
  "./semantic-attack-depth3-move-variant-shadow");
const { MoveContestVariantKernel } = require("./move-contest-variant-kernel");
const { ROOT_CAPACITY } = require(
  "./semantic-attack-depth3-leaf-backup-shadow");

const EVENT_LANE = Object.freeze({ OUTCOME_FRONTIER: 0,
  PROJECTILE_SETTLEMENT: 1, COUNT: 2 });
const EVENT_LANE_NAME = Object.freeze(["OUTCOME_FRONTIER",
  "PROJECTILE_SETTLEMENT"]);
const MAX_COLUMNS = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
const LANE_VARIANTS = EVENT_LANE.COUNT * VARIANT_COUNT;
const ROOT_LANE_VARIANTS = ROOT_CAPACITY * LANE_VARIANTS;
const ROOT_CELLS = ROOT_LANE_VARIANTS * MAX_COLUMNS;

function laneOptions(lane) {
  const common = { nodeBudget: 4096, pairedDepth: 3,
    commonContinuation: true, deepExpansionLimit: 4,
    leafMask: LEAF_COMPONENT_ALL & ~LEAF_COMPONENT.ATTACK,
    historyEnabled: false };
  return lane === EVENT_LANE.OUTCOME_FRONTIER ?
    { ...common, outcomeVector: true } :
    { ...common, eventSettlement: true };
}

class SemanticAttackEventDeadlineShadow {
  constructor(runtimeConfig, options = {}) {
    this.policies = options.policies || new Array(LANE_VARIANTS);
    if (!options.policies)
      for (let lane = 0; lane < EVENT_LANE.COUNT; lane += 1)
        for (let variant = 0; variant < VARIANT_COUNT; variant += 1)
          this.policies[lane * VARIANT_COUNT + variant] =
            new NativeAttackPosePolicySearchPoc(runtimeConfig,
              laneOptions(lane));
    this.state = null;
    this.kernels = new Array(VARIANT_COUNT).fill(null);
    this.hazards = new Array(VARIANT_COUNT).fill(null);
    this.hards = new Array(VARIANT_COUNT).fill(null);
    this.lastAttempted = 0;
    this.lastComplete = new Uint8Array(LANE_VARIANTS);
    this.lastRelation = new Uint8Array(LANE_VARIANTS);
    this.lastBaselineValue = new Int32Array(LANE_VARIANTS);
    this.lastCandidateValue = new Int32Array(LANE_VARIANTS);
    this.lastBaselineNodes = new Uint16Array(LANE_VARIANTS);
    this.lastCandidateNodes = new Uint16Array(LANE_VARIANTS);
    this.lastCommonStatus = new Uint8Array(EVENT_LANE.COUNT);
    this.lastCommonRelation = new Uint8Array(EVENT_LANE.COUNT);
    this.lastEnemyCount = new Uint8Array(LANE_VARIANTS);
    this.lastBaselineCell = new Int16Array(LANE_VARIANTS * MAX_COLUMNS);
    this.lastCandidateCell = new Int16Array(LANE_VARIANTS * MAX_COLUMNS);
    this.recordAttempted = new Uint8Array(ROOT_CAPACITY);
    this.recordComplete = new Uint8Array(ROOT_LANE_VARIANTS);
    this.recordRelation = new Uint8Array(ROOT_LANE_VARIANTS);
    this.recordBaselineValue = new Int32Array(ROOT_LANE_VARIANTS);
    this.recordCandidateValue = new Int32Array(ROOT_LANE_VARIANTS);
    this.recordBaselineNodes = new Uint16Array(ROOT_LANE_VARIANTS);
    this.recordCandidateNodes = new Uint16Array(ROOT_LANE_VARIANTS);
    this.recordCommonStatus = new Uint8Array(
      ROOT_CAPACITY * EVENT_LANE.COUNT);
    this.recordCommonRelation = new Uint8Array(
      ROOT_CAPACITY * EVENT_LANE.COUNT);
    this.recordEnemyCount = new Uint8Array(ROOT_LANE_VARIANTS);
    this.recordBaselineCell = new Int16Array(ROOT_CELLS);
    this.recordCandidateCell = new Int16Array(ROOT_CELLS);
    this.attemptCount = 0; this.completeRootCount = 0;
    this.incompleteRootCount = 0; this.rootRestoreFailureCount = 0;
    this.totalNodes = new Uint32Array(LANE_VARIANTS);
    this.hotAllocationCount = 0;
  }

  bind(bundle) {
    if (this.state === bundle.state) return;
    this.state = bundle.state;
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
      const kernel = new MoveContestVariantKernel(this.state,
        MOVE_VARIANTS[variant]);
      const hazard = new HazardKernel(this.state);
      this.kernels[variant] = kernel; this.hazards[variant] = hazard;
      this.hards[variant] = new HardGate(kernel, hazard, 0);
    }
  }

  clearLast() {
    this.lastAttempted = 0; this.lastComplete.fill(0);
    this.lastRelation.fill(PAIR_RELATION.INCOMPLETE);
    this.lastBaselineValue.fill(0); this.lastCandidateValue.fill(0);
    this.lastBaselineNodes.fill(0); this.lastCandidateNodes.fill(0);
    this.lastCommonStatus.fill(VARIANT_COMMON_STATUS.NOT_EVALUATED);
    this.lastCommonRelation.fill(PAIR_RELATION.INCOMPLETE);
    this.lastEnemyCount.fill(0); this.lastBaselineCell.fill(0);
    this.lastCandidateCell.fill(0);
  }

  copyCells(policy, baselineRow, candidateRow, enemyCount, cell) {
    const baseline = policy.baselineSearch?.rootCellScore;
    const candidate = policy.searchEngine?.rootCellScore;
    if (!baseline || !candidate) return 0;
    const offset = cell * MAX_COLUMNS;
    for (let column = 0; column < enemyCount; column += 1) {
      this.lastBaselineCell[offset + column] =
        baseline[baselineRow * MAX_COLUMNS + column];
      this.lastCandidateCell[offset + column] =
        candidate[candidateRow * MAX_COLUMNS + column];
    }
    this.lastEnemyCount[cell] = enemyCount; return 1;
  }

  evaluate(engine, pose, count, current, candidate, allowedRows,
      widthShadow, responseConditioned) {
    this.clearLast();
    if (!isJointMovementGap(widthShadow) ||
        !responseConditioned?.lastAttempted) return;
    const bundle = engine.adapter.bundle; if (!bundle?.state) return;
    this.bind(bundle); this.lastAttempted = 1; this.attemptCount += 1;
    const originalKernel = bundle.kernel; const originalHazard = bundle.hazard;
    const originalHard = bundle.hard; const beforeLo = bundle.state.hashLo;
    const beforeHi = bundle.state.hashHi; const beforeDelta = bundle.state.deltaUsed;
    const beforeEvent = bundle.state.eventUsed; let allComplete = 1;
    try {
      for (let lane = 0; lane < EVENT_LANE.COUNT; lane += 1) {
        for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
          const cell = lane * VARIANT_COUNT + variant;
          bundle.kernel = this.kernels[variant];
          bundle.hazard = this.hazards[variant]; bundle.hard = this.hards[variant];
          const policy = this.policies[cell];
          policy.searchEngine?.cacheBank?.beginMatch?.();
          policy.baselineSearch?.cacheBank?.beginMatch?.();
          const currentRelation = policy.comparePair(engine, pose, count,
            engine.depthSearch, current, candidate, allowedRows);
          this.lastRelation[cell] = currentRelation;
          this.lastBaselineValue[cell] = policy.lastBaselineValue;
          this.lastCandidateValue[cell] = policy.lastBestValue;
          this.lastBaselineNodes[cell] = policy.lastBaselineNodes;
          this.lastCandidateNodes[cell] = policy.lastCandidateNodes;
          this.totalNodes[cell] += policy.lastBaselineNodes +
            policy.lastCandidateNodes;
          if (currentRelation !== PAIR_RELATION.INCOMPLETE &&
              this.copyCells(policy, current, candidate,
                engine.enemyCount, cell)) this.lastComplete[cell] = 1;
          else allComplete = 0;
          if (bundle.state.hashLo !== beforeLo ||
              bundle.state.hashHi !== beforeHi ||
              bundle.state.deltaUsed !== beforeDelta ||
              bundle.state.eventUsed !== beforeEvent) {
            this.rootRestoreFailureCount += 1; allComplete = 0;
          }
        }
        const start = lane * VARIANT_COUNT;
        let status = VARIANT_COMMON_STATUS.AGREEMENT;
        for (let variant = 0; variant < VARIANT_COUNT; variant += 1)
          if (!this.lastComplete[start + variant]) {
            status = VARIANT_COMMON_STATUS.INCOMPLETE; break;
          } else if (variant && this.lastRelation[start + variant] !==
              this.lastRelation[start]) {
            status = VARIANT_COMMON_STATUS.DISAGREEMENT; break;
          }
        this.lastCommonStatus[lane] = status;
        if (status === VARIANT_COMMON_STATUS.AGREEMENT)
          this.lastCommonRelation[lane] = this.lastRelation[start];
      }
    } finally {
      bundle.kernel = originalKernel; bundle.hazard = originalHazard;
      bundle.hard = originalHard;
    }
    if (allComplete) this.completeRootCount += 1;
    else this.incompleteRootCount += 1;
  }

  record(at) {
    if (at < 0 || at >= ROOT_CAPACITY) return;
    this.recordAttempted[at] = this.lastAttempted;
    const laneOffset = at * LANE_VARIANTS;
    this.recordComplete.set(this.lastComplete, laneOffset);
    this.recordRelation.set(this.lastRelation, laneOffset);
    this.recordBaselineValue.set(this.lastBaselineValue, laneOffset);
    this.recordCandidateValue.set(this.lastCandidateValue, laneOffset);
    this.recordBaselineNodes.set(this.lastBaselineNodes, laneOffset);
    this.recordCandidateNodes.set(this.lastCandidateNodes, laneOffset);
    this.recordEnemyCount.set(this.lastEnemyCount, laneOffset);
    const commonOffset = at * EVENT_LANE.COUNT;
    this.recordCommonStatus.set(this.lastCommonStatus, commonOffset);
    this.recordCommonRelation.set(this.lastCommonRelation, commonOffset);
    const cellOffset = at * LANE_VARIANTS * MAX_COLUMNS;
    this.recordBaselineCell.set(this.lastBaselineCell, cellOffset);
    this.recordCandidateCell.set(this.lastCandidateCell, cellOffset);
  }

  cells(source, offset, count) {
    const output = new Array(count);
    for (let column = 0; column < count; column += 1)
      output[column] = source[offset + column];
    return output;
  }

  root(at) {
    if (at < 0 || at >= ROOT_CAPACITY || !this.recordAttempted[at]) return null;
    const lanes = []; const rootLaneOffset = at * LANE_VARIANTS;
    const rootCellOffset = at * LANE_VARIANTS * MAX_COLUMNS;
    const rootCommonOffset = at * EVENT_LANE.COUNT;
    for (let lane = 0; lane < EVENT_LANE.COUNT; lane += 1) {
      const variants = [];
      for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
        const index = rootLaneOffset + lane * VARIANT_COUNT + variant;
        const count = this.recordEnemyCount[index];
        const cell = rootCellOffset +
          (lane * VARIANT_COUNT + variant) * MAX_COLUMNS;
        variants.push({ name: MOVE_VARIANT_NAME[variant],
          complete: Boolean(this.recordComplete[index]),
          relation: this.recordRelation[index],
          baselineValue: this.recordBaselineValue[index],
          candidateValue: this.recordCandidateValue[index],
          baselineNodes: this.recordBaselineNodes[index],
          candidateNodes: this.recordCandidateNodes[index],
          baselineCells: this.cells(this.recordBaselineCell, cell, count),
          candidateCells: this.cells(this.recordCandidateCell, cell, count) });
      }
      lanes.push({ name: EVENT_LANE_NAME[lane],
        commonStatus: this.recordCommonStatus[rootCommonOffset + lane],
        commonRelation: this.recordCommonRelation[rootCommonOffset + lane],
        variants });
    }
    return { diagnosticOnly: true, actionOwnership: false,
      genericAttackScalarRemoved: true, lanes };
  }

  totalHotAllocationCount() {
    let total = this.hotAllocationCount;
    for (let at = 0; at < this.policies.length; at += 1) {
      const policy = this.policies[at];
      total += (policy?.hotAllocationCount || 0) +
        (policy?.searchEngine?.hotAllocationCount || 0) +
        (policy?.baselineSearch?.hotAllocationCount || 0) +
        (policy?.outcomeVector?.hotAllocationCount || 0) +
        (policy?.eventSettlement?.hotAllocationCount || 0) +
        (policy?.baselineOutcomeVector?.hotAllocationCount || 0) +
        (policy?.baselineEventSettlement?.hotAllocationCount || 0);
    }
    return total;
  }

  summary() {
    const nodes = {};
    for (let lane = 0; lane < EVENT_LANE.COUNT; lane += 1)
      for (let variant = 0; variant < VARIANT_COUNT; variant += 1)
        nodes[`${EVENT_LANE_NAME[lane]}:${MOVE_VARIANT_NAME[variant]}`] =
          this.totalNodes[lane * VARIANT_COUNT + variant];
    return { diagnosticOnly: true, actionOwnership: false,
      genericAttackScalarRemoved: true, attemptCount: this.attemptCount,
      completeRootCount: this.completeRootCount,
      incompleteRootCount: this.incompleteRootCount,
      rootRestoreFailureCount: this.rootRestoreFailureCount,
      hotAllocationCount: this.totalHotAllocationCount(), nodes };
  }
}

module.exports = { EVENT_LANE, EVENT_LANE_NAME, laneOptions,
  SemanticAttackEventDeadlineShadow };
