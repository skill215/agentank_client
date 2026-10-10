"use strict";

// Behavior-neutral response-set evidence.  Strict attack progress remains an
// AND/OR proof after one concrete enemy first action, but ordinary ATTACK no
// longer requires progress against every first action.  The resulting bitset
// says which enemy choices the attack makes strategically dominated.  Only a
// complete strict superset of the incumbent bitset is a non-tradeoff signal.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { AttackPolicyReachabilitySearch } = require(
  "./attack-policy-reachability-shadow");

class AttackResponseSetShadow {
  constructor(interval, search = null, maximumDepth = 4, nodeBudget = 2048) {
    this.interval = interval;
    this.search = search || new AttackPolicyReachabilitySearch(nodeBudget);
    this.maximumDepth = maximumDepth; this.nodeBudget = nodeBudget;
    this.singleEnemyAction = new Uint8Array(1);
    this.singleEnemyArgument = new Uint16Array(1);
    this.rowDone = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowProvenMask = new Uint32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowUnknownMask = new Uint32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.coverageHistogram = new Uint32Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1);
    this.candidateByAction = new Uint32Array(256);
    this.strictSupersetByAction = new Uint32Array(256);
    this.observationCount = 0; this.eventEvaluationCount = 0;
    this.duplicateSkipCount = 0; this.candidateRowCount = 0;
    this.columnEvaluationCount = 0; this.provenColumnCount = 0;
    this.disprovenColumnCount = 0; this.unknownColumnCount = 0;
    this.candidateWithCompressionCount = 0; this.strictSupersetCount = 0;
    this.tradeoffCount = 0; this.equalSetCount = 0; this.strictSubsetCount = 0;
    this.gainedColumnCount = 0; this.lostColumnCount = 0;
    this.rootWithStrictSupersetCount = 0; this.incumbentEvaluationCount = 0;
    this.rootHiddenSkipCount = 0; this.trackingSkipCount = 0;
    this.possibleProjectileSkipCount = 0; this.supportSkipCount = 0;
    this.nodeCount = 0; this.maximumNodes = 0; this.ttHits = 0;
    this.budgetStops = 0; this.incompleteStops = 0;
    this.rootRestoreFailures = 0; this.lastEvaluationSerial = 0;
    this.hotAllocationCount = 0;
  }

  setupPrimitive(action) {
    return action === ACTION.GO || action === ACTION.TURN_LEFT ||
      action === ACTION.TURN_RIGHT ? 1 : 0;
  }

  popcount(value) {
    let x = value >>> 0; x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  evaluateRow(engine, row) {
    if (this.rowDone[row]) return;
    this.rowDone[row] = 1; let proven = 0; let unknown = 0;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      this.singleEnemyAction[0] = engine.enemyActions[column];
      this.singleEnemyArgument[0] = engine.enemyArguments[column];
      const result = this.search.evaluateCandidate(engine.adapter.bundle,
        engine.ourActions[row], engine.ourArguments[row], this.singleEnemyAction,
        this.singleEnemyArgument, 1, this.maximumDepth, this.nodeBudget);
      this.columnEvaluationCount += 1; this.nodeCount += this.search.nodes;
      this.ttHits += this.search.ttHits; this.budgetStops += this.search.budgetStopCount;
      this.incompleteStops += this.search.incompleteCount +
        this.search.hardIncompleteStops + this.search.unsupportedGenerationStops;
      this.rootRestoreFailures += this.search.rootRestoreFailures;
      if (this.search.nodes > this.maximumNodes) this.maximumNodes = this.search.nodes;
      if (result === PROOF_STATUS.PROVEN) {
        proven |= (1 << column) >>> 0; this.provenColumnCount += 1;
      } else if (result === PROOF_STATUS.UNKNOWN) {
        unknown |= (1 << column) >>> 0; this.unknownColumnCount += 1;
      } else this.disprovenColumnCount += 1;
    }
    this.rowProvenMask[row] = proven; this.rowUnknownMask[row] = unknown;
  }

  observe(engine) {
    this.observationCount += 1;
    if (!this.interval || this.interval.evaluationSerial === this.lastEvaluationSerial) {
      this.duplicateSkipCount += 1; return;
    }
    this.lastEvaluationSerial = this.interval.evaluationSerial;
    if (!engine || !engine.adapter || !engine.adapter.bundle) return;
    this.eventEvaluationCount += 1;
    if (!engine.adapter.enemyVisible) { this.rootHiddenSkipCount += 1; return; }
    if (!engine.adapter.tracker || !engine.adapter.tracker.complete) {
      this.trackingSkipCount += 1; return;
    }
    if (engine.possibleProjectiles && engine.possibleProjectiles.count() > 0) {
      this.possibleProjectileSkipCount += 1; return;
    }
    if (!engine.hiddenSupportComplete || engine.hiddenWorldCount !== 1 ||
        engine.hiddenWorldMass[0] !== 10000 || engine.enemyCount < 1 ||
        engine.enemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES) {
      this.supportSkipCount += 1; return;
    }
    this.rowDone.fill(0, 0, engine.ourCount);
    this.rowProvenMask.fill(0, 0, engine.ourCount);
    this.rowUnknownMask.fill(0, 0, engine.ourCount);
    const selected = this.interval.lastSelectedRow;
    if (selected < 0 || selected >= engine.ourCount ||
        engine.hardStatus[selected] !== HARD_STATUS.ALLOW) {
      this.supportSkipCount += 1; return;
    }
    this.evaluateRow(engine, selected); this.incumbentEvaluationCount += 1;
    const incumbent = this.rowProvenMask[selected];
    const incumbentUnknown = this.rowUnknownMask[selected];
    const risk = engine.riskController && engine.riskController.outcome;
    let rootStrict = 0;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (row === selected || engine.hardStatus[row] !== HARD_STATUS.ALLOW || !risk ||
          row >= risk.count || !risk.acceptable[row] || risk.dominated[row] ||
          !this.setupPrimitive(engine.ourActions[row])) continue;
      this.evaluateRow(engine, row); this.candidateRowCount += 1;
      this.candidateByAction[engine.ourActions[row]] += 1;
      const candidate = this.rowProvenMask[row];
      const unknown = this.rowUnknownMask[row];
      const coverage = this.popcount(candidate);
      this.coverageHistogram[coverage] += 1;
      if (coverage) this.candidateWithCompressionCount += 1;
      if (unknown || incumbentUnknown) continue;
      const gained = candidate & ~incumbent;
      const lost = incumbent & ~candidate;
      const gainedCount = this.popcount(gained); const lostCount = this.popcount(lost);
      this.gainedColumnCount += gainedCount; this.lostColumnCount += lostCount;
      if (gained && !lost) {
        this.strictSupersetCount += 1;
        this.strictSupersetByAction[engine.ourActions[row]] += 1; rootStrict = 1;
      } else if (gained && lost) this.tradeoffCount += 1;
      else if (!gained && lost) this.strictSubsetCount += 1;
      else this.equalSetCount += 1;
    }
    if (rootStrict) this.rootWithStrictSupersetCount += 1;
  }

  sparseActions(values) {
    const output = {};
    for (let action = 0; action < values.length; action += 1)
      if (values[action]) output[action] = values[action];
    return output;
  }

  summary() {
    return { enabled: true, behaviorNeutral: true, physicalOnly: true,
      completeSetComparison: true, maximumDepth: this.maximumDepth,
      nodeBudgetPerColumn: this.nodeBudget,
      observationCount: this.observationCount,
      eventEvaluationCount: this.eventEvaluationCount,
      duplicateSkipCount: this.duplicateSkipCount,
      candidateRowCount: this.candidateRowCount,
      columnEvaluationCount: this.columnEvaluationCount,
      provenColumnCount: this.provenColumnCount,
      disprovenColumnCount: this.disprovenColumnCount,
      unknownColumnCount: this.unknownColumnCount,
      candidateWithCompressionCount: this.candidateWithCompressionCount,
      strictSupersetCount: this.strictSupersetCount,
      tradeoffCount: this.tradeoffCount, equalSetCount: this.equalSetCount,
      strictSubsetCount: this.strictSubsetCount,
      gainedColumnCount: this.gainedColumnCount, lostColumnCount: this.lostColumnCount,
      rootWithStrictSupersetCount: this.rootWithStrictSupersetCount,
      incumbentEvaluationCount: this.incumbentEvaluationCount,
      rootHiddenSkipCount: this.rootHiddenSkipCount,
      trackingSkipCount: this.trackingSkipCount,
      possibleProjectileSkipCount: this.possibleProjectileSkipCount,
      supportSkipCount: this.supportSkipCount,
      nodeCount: this.nodeCount, maximumNodes: this.maximumNodes,
      ttHits: this.ttHits, budgetStops: this.budgetStops,
      incompleteStops: this.incompleteStops,
      rootRestoreFailures: this.rootRestoreFailures,
      lastEvaluationSerial: this.lastEvaluationSerial,
      coverageHistogram: Array.from(this.coverageHistogram),
      candidateByAction: this.sparseActions(this.candidateByAction),
      strictSupersetByAction: this.sparseActions(this.strictSupersetByAction),
      hotAllocationCount: this.hotAllocationCount + this.search.hotAllocationCount };
  }
}

module.exports = { AttackResponseSetShadow };
