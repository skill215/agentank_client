"use strict";

// BP135: diagnostic-only causal decomposition of the scalar leaf and root
// enemy-action backup. Every lane is rerun in all BP134 finite movement worlds.
// No lane owns an action and production physical semantics stay fail-closed.

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

const LEAF_LANE = Object.freeze({ FULL: 0, NO_STAR: 1, NO_ORDNANCE: 2,
  NO_ATTACK: 3, NO_MOBILITY: 4, NO_STATUS: 5, NO_HISTORY: 6,
  ZERO_LEAF: 7 });
const LEAF_LANE_NAME = Object.freeze(["FULL", "NO_STAR", "NO_ORDNANCE",
  "NO_ATTACK", "NO_MOBILITY", "NO_STATUS", "NO_HISTORY", "ZERO_LEAF"]);
const LEAF_LANE_COUNT = LEAF_LANE_NAME.length;
const ROOT_CAPACITY = 32;

function laneOptions(lane) {
  const common = { nodeBudget: 4096, pairedDepth: 3,
    commonContinuation: true, deepExpansionLimit: 4 };
  if (lane === LEAF_LANE.FULL) return common;
  if (lane === LEAF_LANE.NO_HISTORY)
    return { ...common, historyEnabled: false };
  if (lane === LEAF_LANE.ZERO_LEAF)
    return { ...common, leafMask: 0, historyEnabled: false };
  const removed = lane === LEAF_LANE.NO_STAR ? LEAF_COMPONENT.STAR :
    lane === LEAF_LANE.NO_ORDNANCE ? LEAF_COMPONENT.ORDNANCE :
    lane === LEAF_LANE.NO_ATTACK ? LEAF_COMPONENT.ATTACK :
    lane === LEAF_LANE.NO_MOBILITY ? LEAF_COMPONENT.MOBILITY :
    LEAF_COMPONENT.STATUS;
  return { ...common, leafMask: LEAF_COMPONENT_ALL & ~removed };
}

function relation(left, right) {
  return left > right ? PAIR_RELATION.CANDIDATE_HIGHER :
    left === right ? PAIR_RELATION.EQUAL : PAIR_RELATION.CANDIDATE_LOWER;
}

class SemanticAttackDepth3LeafBackupShadow {
  constructor(runtimeConfig, options = {}) {
    this.policies = options.policies || new Array(LEAF_LANE_COUNT * VARIANT_COUNT);
    if (!options.policies)
      for (let lane = 0; lane < LEAF_LANE_COUNT; lane += 1)
        for (let variant = 0; variant < VARIANT_COUNT; variant += 1)
          this.policies[lane * VARIANT_COUNT + variant] =
            new NativeAttackPosePolicySearchPoc(runtimeConfig, laneOptions(lane));
    this.state = null;
    this.kernels = new Array(VARIANT_COUNT).fill(null);
    this.hazards = new Array(VARIANT_COUNT).fill(null);
    this.hards = new Array(VARIANT_COUNT).fill(null);
    const cells = LEAF_LANE_COUNT * VARIANT_COUNT;
    this.lastAttempted = 0;
    this.lastComplete = new Uint8Array(cells);
    this.lastRelation = new Uint8Array(cells);
    this.lastBaselineValue = new Int32Array(cells);
    this.lastCandidateValue = new Int32Array(cells);
    this.lastBaselineNodes = new Uint16Array(cells);
    this.lastCandidateNodes = new Uint16Array(cells);
    this.lastCommonStatus = new Uint8Array(LEAF_LANE_COUNT);
    this.lastCommonRelation = new Uint8Array(LEAF_LANE_COUNT);
    this.lastBaselineMean = new Int32Array(VARIANT_COUNT);
    this.lastCandidateMean = new Int32Array(VARIANT_COUNT);
    this.lastMeanRelation = new Uint8Array(VARIANT_COUNT);
    this.lastColumnHigher = new Uint8Array(VARIANT_COUNT);
    this.lastColumnEqual = new Uint8Array(VARIANT_COUNT);
    this.lastColumnLower = new Uint8Array(VARIANT_COUNT);
    this.lastEnemyCount = new Uint8Array(VARIANT_COUNT);
    const recordCells = ROOT_CAPACITY * cells;
    this.recordAttempted = new Uint8Array(ROOT_CAPACITY);
    this.recordComplete = new Uint8Array(recordCells);
    this.recordRelation = new Uint8Array(recordCells);
    this.recordBaselineValue = new Int32Array(recordCells);
    this.recordCandidateValue = new Int32Array(recordCells);
    this.recordBaselineNodes = new Uint16Array(recordCells);
    this.recordCandidateNodes = new Uint16Array(recordCells);
    this.recordCommonStatus = new Uint8Array(ROOT_CAPACITY * LEAF_LANE_COUNT);
    this.recordCommonRelation = new Uint8Array(ROOT_CAPACITY * LEAF_LANE_COUNT);
    this.recordBaselineMean = new Int32Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordCandidateMean = new Int32Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordMeanRelation = new Uint8Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordColumnHigher = new Uint8Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordColumnEqual = new Uint8Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordColumnLower = new Uint8Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.recordEnemyCount = new Uint8Array(ROOT_CAPACITY * VARIANT_COUNT);
    this.attemptCount = 0; this.rootRestoreFailureCount = 0;
    this.laneCompleteCount = new Uint32Array(LEAF_LANE_COUNT);
    this.laneAgreementCount = new Uint32Array(LEAF_LANE_COUNT);
    this.laneDisagreementCount = new Uint32Array(LEAF_LANE_COUNT);
    this.laneRelationCount = new Uint32Array(LEAF_LANE_COUNT * 4);
    this.totalNodes = new Uint32Array(cells); this.hotAllocationCount = 0;
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
    this.lastBaselineMean.fill(0); this.lastCandidateMean.fill(0);
    this.lastMeanRelation.fill(PAIR_RELATION.INCOMPLETE);
    this.lastColumnHigher.fill(0); this.lastColumnEqual.fill(0);
    this.lastColumnLower.fill(0); this.lastEnemyCount.fill(0);
  }

  captureRootBackup(policy, baselineRow, candidateRow, enemyCount, variant) {
    const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
    const baseline = policy.baselineSearch.rootCellScore;
    const candidate = policy.searchEngine.rootCellScore;
    let baselineSum = 0; let candidateSum = 0;
    for (let column = 0; column < enemyCount; column += 1) {
      const left = candidate[candidateRow * stride + column];
      const right = baseline[baselineRow * stride + column];
      baselineSum += right; candidateSum += left;
      const current = relation(left, right);
      if (current === PAIR_RELATION.CANDIDATE_HIGHER)
        this.lastColumnHigher[variant] += 1;
      else if (current === PAIR_RELATION.EQUAL)
        this.lastColumnEqual[variant] += 1;
      else this.lastColumnLower[variant] += 1;
    }
    this.lastEnemyCount[variant] = enemyCount;
    this.lastBaselineMean[variant] = Math.trunc(baselineSum / enemyCount);
    this.lastCandidateMean[variant] = Math.trunc(candidateSum / enemyCount);
    this.lastMeanRelation[variant] = relation(this.lastCandidateMean[variant],
      this.lastBaselineMean[variant]);
  }

  evaluate(engine, pose, count, current, candidate, allowedRows, widthShadow) {
    this.clearLast();
    if (!isJointMovementGap(widthShadow)) return;
    const bundle = engine.adapter.bundle; if (!bundle?.state) return;
    this.bind(bundle); this.lastAttempted = 1; this.attemptCount += 1;
    const originalKernel = bundle.kernel; const originalHazard = bundle.hazard;
    const originalHard = bundle.hard; const beforeLo = bundle.state.hashLo;
    const beforeHi = bundle.state.hashHi; const beforeDelta = bundle.state.deltaUsed;
    const beforeEvent = bundle.state.eventUsed;
    try {
      for (let lane = 0; lane < LEAF_LANE_COUNT; lane += 1) {
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
          this.totalNodes[cell] += policy.lastBaselineNodes + policy.lastCandidateNodes;
          if (currentRelation !== PAIR_RELATION.INCOMPLETE) {
            this.lastComplete[cell] = 1;
            if (lane === LEAF_LANE.FULL)
              this.captureRootBackup(policy, current, candidate,
                engine.enemyCount, variant);
          }
          if (bundle.state.hashLo !== beforeLo || bundle.state.hashHi !== beforeHi ||
              bundle.state.deltaUsed !== beforeDelta ||
              bundle.state.eventUsed !== beforeEvent)
            this.rootRestoreFailureCount += 1;
        }
        const start = lane * VARIANT_COUNT; let status =
          VARIANT_COMMON_STATUS.AGREEMENT;
        for (let variant = 0; variant < VARIANT_COUNT; variant += 1)
          if (!this.lastComplete[start + variant]) {
            status = VARIANT_COMMON_STATUS.INCOMPLETE; break;
          } else if (variant && this.lastRelation[start + variant] !==
              this.lastRelation[start]) status = VARIANT_COMMON_STATUS.DISAGREEMENT;
        this.lastCommonStatus[lane] = status;
        if (status === VARIANT_COMMON_STATUS.AGREEMENT) {
          this.lastCommonRelation[lane] = this.lastRelation[start];
          this.laneCompleteCount[lane] += 1; this.laneAgreementCount[lane] += 1;
          this.laneRelationCount[lane * 4 + this.lastRelation[start]] += 1;
        } else if (status === VARIANT_COMMON_STATUS.DISAGREEMENT) {
          this.laneCompleteCount[lane] += 1; this.laneDisagreementCount[lane] += 1;
        }
      }
    } finally {
      bundle.kernel = originalKernel; bundle.hazard = originalHazard;
      bundle.hard = originalHard;
    }
  }

  record(at) {
    if (at < 0 || at >= ROOT_CAPACITY) return;
    this.recordAttempted[at] = this.lastAttempted;
    const cellOffset = at * LEAF_LANE_COUNT * VARIANT_COUNT;
    this.recordComplete.set(this.lastComplete, cellOffset);
    this.recordRelation.set(this.lastRelation, cellOffset);
    this.recordBaselineValue.set(this.lastBaselineValue, cellOffset);
    this.recordCandidateValue.set(this.lastCandidateValue, cellOffset);
    this.recordBaselineNodes.set(this.lastBaselineNodes, cellOffset);
    this.recordCandidateNodes.set(this.lastCandidateNodes, cellOffset);
    const laneOffset = at * LEAF_LANE_COUNT;
    this.recordCommonStatus.set(this.lastCommonStatus, laneOffset);
    this.recordCommonRelation.set(this.lastCommonRelation, laneOffset);
    const variantOffset = at * VARIANT_COUNT;
    this.recordBaselineMean.set(this.lastBaselineMean, variantOffset);
    this.recordCandidateMean.set(this.lastCandidateMean, variantOffset);
    this.recordMeanRelation.set(this.lastMeanRelation, variantOffset);
    this.recordColumnHigher.set(this.lastColumnHigher, variantOffset);
    this.recordColumnEqual.set(this.lastColumnEqual, variantOffset);
    this.recordColumnLower.set(this.lastColumnLower, variantOffset);
    this.recordEnemyCount.set(this.lastEnemyCount, variantOffset);
  }

  root(at) {
    if (at < 0 || at >= ROOT_CAPACITY || !this.recordAttempted[at]) return null;
    const lanes = []; const rootCellOffset = at * LEAF_LANE_COUNT * VARIANT_COUNT;
    const rootLaneOffset = at * LEAF_LANE_COUNT;
    for (let lane = 0; lane < LEAF_LANE_COUNT; lane += 1) {
      const variants = [];
      for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
        const cell = rootCellOffset + lane * VARIANT_COUNT + variant;
        variants.push({ name: MOVE_VARIANT_NAME[variant],
          complete: Boolean(this.recordComplete[cell]),
          relation: this.recordRelation[cell],
          baselineValue: this.recordBaselineValue[cell],
          candidateValue: this.recordCandidateValue[cell],
          baselineNodes: this.recordBaselineNodes[cell],
          candidateNodes: this.recordCandidateNodes[cell] });
      }
      lanes.push({ name: LEAF_LANE_NAME[lane],
        commonStatus: this.recordCommonStatus[rootLaneOffset + lane],
        commonRelation: this.recordCommonRelation[rootLaneOffset + lane], variants });
    }
    const rootVariantOffset = at * VARIANT_COUNT; const backup = [];
    for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
      const index = rootVariantOffset + variant;
      backup.push({ name: MOVE_VARIANT_NAME[variant],
        enemyCount: this.recordEnemyCount[index],
        baselineMean: this.recordBaselineMean[index],
        candidateMean: this.recordCandidateMean[index],
        meanRelation: this.recordMeanRelation[index],
        columnHigher: this.recordColumnHigher[index],
        columnEqual: this.recordColumnEqual[index],
        columnLower: this.recordColumnLower[index] });
    }
    return { diagnosticOnly: true, actionOwnership: false, lanes, backup };
  }

  totalHotAllocationCount() {
    let count = this.hotAllocationCount;
    for (const policy of this.policies) {
      count += policy.hotAllocationCount || 0;
      count += policy.leaf?.hotAllocationCount || 0;
      count += policy.baselineLeaf?.hotAllocationCount || 0;
      count += policy.history?.hotAllocationCount || 0;
      count += policy.baselineHistory?.hotAllocationCount || 0;
    }
    return count;
  }

  summary() {
    const lanes = [];
    for (let lane = 0; lane < LEAF_LANE_COUNT; lane += 1) {
      const variants = [];
      for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
        const cell = lane * VARIANT_COUNT + variant;
        variants.push({ name: MOVE_VARIANT_NAME[variant],
          totalNodes: this.totalNodes[cell] });
      }
      lanes.push({ name: LEAF_LANE_NAME[lane],
        completeCount: this.laneCompleteCount[lane],
        agreementCount: this.laneAgreementCount[lane],
        disagreementCount: this.laneDisagreementCount[lane],
        relationCount: {
          incomplete: this.laneRelationCount[lane * 4 + PAIR_RELATION.INCOMPLETE],
          candidateHigher:
            this.laneRelationCount[lane * 4 + PAIR_RELATION.CANDIDATE_HIGHER],
          equal: this.laneRelationCount[lane * 4 + PAIR_RELATION.EQUAL],
          candidateLower:
            this.laneRelationCount[lane * 4 + PAIR_RELATION.CANDIDATE_LOWER] },
        variants });
    }
    return { diagnosticOnly: true, actionOwnership: false,
      attemptCount: this.attemptCount,
      rootRestoreFailureCount: this.rootRestoreFailureCount, lanes,
      hotAllocationCount: this.totalHotAllocationCount() };
  }
}

module.exports = { LEAF_LANE, LEAF_LANE_NAME, LEAF_LANE_COUNT,
  ROOT_CAPACITY, laneOptions, relation,
  SemanticAttackDepth3LeafBackupShadow };
