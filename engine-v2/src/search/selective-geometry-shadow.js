"use strict";

const { ACTION } = require("../abi/fast-codes");
const { WORK_KIND, RUNTIME_MODE } = require("../abi/cache-runtime-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");

const FEATURE_KEY_COUNT = 4096;

// HP16 diagnostic: evaluate a tiny, Risk-qualified one-ply geometry matrix in
// the real runtime schedule.  It deliberately cannot select an action.  The
// ProductionRoot owns the search arenas; this object adds only twelve bytes of
// fixed candidate storage when the diagnostic is enabled.
class SelectiveGeometryShadow {
  constructor(options = 3) {
    const maximumRows = Number.isSafeInteger(options) ? options : options.maximumRows;
    this.maximumRows = Math.max(2, Math.min(3, maximumRows | 0));
    this.triggerMask = Number.isSafeInteger(options?.triggerMask) ?
      options.triggerMask & (FEATURE_KEY_COUNT - 1) : 0;
    this.triggerValue = Number.isSafeInteger(options?.triggerValue) ?
      options.triggerValue & this.triggerMask : 0;
    this.cooldownFrames = Number.isSafeInteger(options?.cooldownFrames) ?
      Math.max(0, Math.min(16, options.cooldownFrames)) : 0;
    this.active = options?.active ? 1 : 0;
    this.lastSearchFrame = -32;
    this.lastFeatureKey = 0;
    this.actions = new Uint8Array(3);
    this.arguments = new Uint16Array(3);
    this.rowMap = new Uint8Array(3);
    this.attempts = 0; this.completed = 0; this.singleRowSkips = 0;
    this.supportSkips = 0; this.occupiedSearchSkips = 0;
    this.runtimeModeSkips = 0; this.quotaSkips = 0; this.triggerSkips = 0;
    this.cooldownSkips = 0;
    this.noSelectedRow = 0;
    this.nodes = 0; this.workUnits = 0; this.requiredWorkUnits = 0;
    this.strictImprovementOpportunities = 0; this.strictImprovementMargin = 0;
    this.proposalCount = 0; this.proposalSelectedCount = 0;
    this.proposalDisplacedCount = 0;
    this.proposalActionCount = new Uint32Array(16);
    this.selectedProposalActionCount = new Uint32Array(16);
    this.widthCounts = new Uint32Array(4); this.hotAllocationCount = 0;
    this.featureTotal = new Uint32Array(FEATURE_KEY_COUNT);
    this.featurePositive = new Uint32Array(FEATURE_KEY_COUNT);
    this.featureNodes = new Uint32Array(FEATURE_KEY_COUNT);
  }

  attack(engine, row) {
    const action = engine.ourActions[row]; const outcome = engine.riskController.outcome;
    return action === ACTION.FIRE || action === ACTION.THROW_BOMB ||
      action === ACTION.CAST_OVERLOAD || outcome.combatPurpose[row] !== 0;
  }

  better(engine, left, right) {
    if (right < 0) return 1;
    const outcome = engine.riskController.outcome;
    if (outcome.tacticalValue[left] !== outcome.tacticalValue[right])
      return outcome.tacticalValue[left] > outcome.tacticalValue[right];
    if (outcome.expectedValue[left] !== outcome.expectedValue[right])
      return outcome.expectedValue[left] > outcome.expectedValue[right];
    return left < right;
  }

  contains(row, count) {
    for (let index = 0; index < count; index += 1)
      if (this.rowMap[index] === row) return 1;
    return 0;
  }

  add(engine, row, count, total) {
    if (row < 0 || row >= total || count >= this.maximumRows || this.contains(row, count))
      return count;
    this.rowMap[count] = row; this.actions[count] = engine.ourActions[row];
    this.arguments[count] = engine.ourArguments[row]; return count + 1;
  }

  selectCandidates(engine, selected, total) {
    let count = this.add(engine, selected, 0, total);
    const outcome = engine.riskController.outcome; let ordinary = -1; let attack = -1;
    for (let row = 0; row < total; row += 1) {
      if (row === selected || !outcome.acceptable[row] || outcome.dominated[row]) continue;
      if (this.attack(engine, row)) {
        if (this.better(engine, row, attack)) attack = row;
      } else if (this.better(engine, row, ordinary)) ordinary = row;
    }
    count = this.add(engine, ordinary, count, total);
    count = this.add(engine, attack, count, total);
    while (count < this.maximumRows) {
      let best = -1;
      for (let row = 0; row < total; row += 1)
        if (!this.contains(row, count) && outcome.acceptable[row] &&
            !outcome.dominated[row] && this.better(engine, row, best)) best = row;
      if (best < 0) break;
      count = this.add(engine, best, count, total);
    }
    return count;
  }

  relation(left, right) { return left < right ? 0 : left === right ? 1 : 2; }

  featureKey(engine, count) {
    const selected = this.rowMap[0]; let challenger = count > 1 ? this.rowMap[1] : selected;
    for (let index = 2; index < count; index += 1)
      if (this.better(engine, this.rowMap[index], challenger)) challenger = this.rowMap[index];
    const outcome = engine.riskController.outcome;
    const state = engine.adapter.state; const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const distance = engine.combat.distance(state, own, enemy);
    const distanceBucket = distance <= 3 ? 0 : distance <= 5 ? 1 : distance <= 7 ? 2 : 3;
    const tacticalRelation = this.relation(outcome.tacticalValue[challenger],
      outcome.tacticalValue[selected]);
    const expectedRelation = this.relation(outcome.expectedValue[challenger],
      outcome.expectedValue[selected]);
    let attackChallenger = 0;
    for (let index = 1; index < count; index += 1)
      if (this.attack(engine, this.rowMap[index])) { attackChallenger = 1; break; }
    const selectedAction = engine.ourActions[selected];
    return (count === 3 ? 1 : 0) |
      (this.attack(engine, selected) << 1) |
      (attackChallenger << 2) |
      (tacticalRelation << 3) |
      (expectedRelation << 5) |
      (distanceBucket << 7) |
      (engine.combat.clearLine(state, own, enemy) << 9) |
      ((selectedAction === ACTION.FIRE ? 1 : 0) << 10) |
      ((a[ARRAY.SCALAR][SCALAR.FRAME] < 64 ? 1 : 0) << 11);
  }

  optionalQuota(engine) {
    const runtime = engine.runtime; const config = runtime.runtimeConfig;
    // Retain one complete optional callback window before the cumulative
    // fallback threshold.  Geometry may use slack, but cannot consume the next
    // frame's full Physical/Proof opportunity by itself.
    const nextCallbackReserve = Math.max(0,
      config.PER_CALLBACK_WORK_UNIT_LIMIT - config.MINIMUM_EMERGENCY_BATCH_RESERVE);
    const used = runtime.accumulatedWorkUnits + runtime.currentCallbackWorkUnits;
    const fallbackHeadroom = config.FALLBACK_ENTER_WORK_UNITS -
      nextCallbackReserve - used;
    return Math.max(0, Math.min(engine.availableOptionalWorkUnits(), fallbackHeadroom));
  }

  prepareEnemyOrder(engine) {
    const information = engine.informationSearch;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      engine.enemyActionFamilies[column] = engine.actionFamilyForShadow(
        engine.enemyActions[column]);
      information.enemyOrder[column] = column;
    }
    const nominal = engine.policy.opponent.buildNominalPolicy(engine.enemyActionFamilies,
      engine.enemyCount, engine.opponentContext(), information.enemyProbability);
    if (nominal !== engine.enemyCount) return 0;
    for (let left = 0; left < engine.enemyCount; left += 1)
      for (let right = left + 1; right < engine.enemyCount; right += 1)
        if (information.enemyProbability[information.enemyOrder[right]] >
            information.enemyProbability[information.enemyOrder[left]]) {
          const swap = information.enemyOrder[left];
          information.enemyOrder[left] = information.enemyOrder[right];
          information.enemyOrder[right] = swap;
        }
    return 1;
  }

  strictProposal(engine, winner) {
    const information = engine.informationSearch;
    if (winner <= 0 || information.rootScore[winner] <= information.rootScore[0]) return -1;
    const rootRow = this.rowMap[winner];
    this.strictImprovementOpportunities += 1;
    this.proposalCount += 1;
    this.featurePositive[this.lastFeatureKey] += 1;
    this.strictImprovementMargin += information.rootScore[winner] - information.rootScore[0];
    const action = engine.ourActions[rootRow];
    if (action >= 0 && action < this.proposalActionCount.length)
      this.proposalActionCount[action] += 1;
    return this.active ? rootRow : -1;
  }

  confirmSelection(engine, proposed, selected) {
    if (proposed < 0) return;
    if (selected === proposed) {
      this.proposalSelectedCount += 1;
      const action = engine.ourActions[selected];
      if (action >= 0 && action < this.selectedProposalActionCount.length)
        this.selectedProposalActionCount[action] += 1;
    } else this.proposalDisplacedCount += 1;
  }

  evaluate(engine, bundle, selected, total, contact, exact) {
    if (!contact || exact || !engine.adapter.enemyVisible || engine.enemyCount < 1 ||
        total < 2) return -1;
    this.attempts += 1;
    if (selected < 0 || selected >= total) { this.noSelectedRow += 1; return -1; }
    let mass = 0;
    for (let world = 0; world < engine.hiddenWorldCount; world += 1)
      mass += engine.hiddenWorldMass[world];
    if (!engine.hiddenSupportComplete || !engine.hiddenWorldCount || mass !== 10000) {
      this.supportSkips += 1; return -1;
    }
    if (engine.runtime.runtimeMode !== RUNTIME_MODE.NORMAL) {
      this.runtimeModeSkips += 1; return -1;
    }
    // Do not stack this diagnostic on top of another Information owner.
    if (engine.informationSearch.nodes || engine.informationSearch.completedDepth) {
      this.occupiedSearchSkips += 1; return -1;
    }
    const count = this.selectCandidates(engine, selected, total);
    this.widthCounts[count] += 1;
    if (count < 2) { this.singleRowSkips += 1; return -1; }
    const featureKey = this.featureKey(engine, count);
    this.lastFeatureKey = featureKey;
    if ((featureKey & this.triggerMask) !== this.triggerValue) {
      this.triggerSkips += 1; return -1;
    }
    const frame = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (frame < this.lastSearchFrame) this.lastSearchFrame = -32;
    if (frame - this.lastSearchFrame < this.cooldownFrames) {
      this.cooldownSkips += 1; return -1;
    }
    if (!this.prepareEnemyOrder(engine)) { this.supportSkips += 1; return -1; }
    const information = engine.informationSearch;
    const matrixNodes = information.matrixNodeCount(bundle, this.actions, count,
      engine.enemyActions, information.enemyOrder, engine.enemyCount) *
      engine.hiddenWorldCount;
    const charges = engine.runtime.runtimeConfig.WORK_CHARGES;
    const worstPerNode = charges[WORK_KIND.VALUE_NODE] +
      charges[WORK_KIND.FAST_TRANSITION] + charges[WORK_KIND.HARD];
    const required = matrixNodes * worstPerNode;
    this.requiredWorkUnits += required;
    const quota = this.optionalQuota(engine);
    if (!matrixNodes || required > quota) { this.quotaSkips += 1; return -1; }
    this.lastSearchFrame = frame;
    const ok = information.search(bundle, engine.depthSearch, this.actions, this.arguments,
      count, engine.enemyActions, engine.enemyArguments, engine.enemyCount,
      engine.hiddenWorldCell, engine.hiddenWorldMass, engine.hiddenWorldCount,
      1, matrixNodes, engine.policy.baseRisk, engine.adapter.lastEnemyDirection,
      1, information.enemyProbability, 1, required);
    const charged = engine.chargeValueSearchWork(information);
    this.nodes += information.nodes; this.workUnits += charged;
    if (!ok || !information.supportComplete || information.approximate) return -1;
    this.completed += 1;
    this.featureTotal[featureKey] += 1;
    this.featureNodes[featureKey] += information.nodes;
    let winner = 0;
    for (let row = 1; row < count; row += 1)
      if (information.rootScore[row] > information.rootScore[winner]) winner = row;
    return this.strictProposal(engine, winner);
  }

  summary() {
    const featureBuckets = [];
    for (let key = 0; key < FEATURE_KEY_COUNT; key += 1)
      if (this.featureTotal[key]) featureBuckets.push({ key,
        total: this.featureTotal[key], positive: this.featurePositive[key],
        nodes: this.featureNodes[key] });
    return { enabled: true, active: Boolean(this.active),
      maximumRows: this.maximumRows, attempts: this.attempts,
      triggerMask: this.triggerMask, triggerValue: this.triggerValue,
      cooldownFrames: this.cooldownFrames,
      completed: this.completed, supportSkips: this.supportSkips,
      occupiedSearchSkips: this.occupiedSearchSkips,
      runtimeModeSkips: this.runtimeModeSkips, quotaSkips: this.quotaSkips,
      triggerSkips: this.triggerSkips, cooldownSkips: this.cooldownSkips,
      noSelectedRow: this.noSelectedRow, singleRowSkips: this.singleRowSkips,
      nodes: this.nodes, workUnits: this.workUnits,
      requiredWorkUnits: this.requiredWorkUnits,
      strictImprovementOpportunities: this.strictImprovementOpportunities,
      strictImprovementMargin: this.strictImprovementMargin,
      proposalCount: this.proposalCount,
      proposalSelectedCount: this.proposalSelectedCount,
      proposalDisplacedCount: this.proposalDisplacedCount,
      proposalActionCount: Array.from(this.proposalActionCount),
      selectedProposalActionCount: Array.from(this.selectedProposalActionCount),
      widthCounts: Array.from(this.widthCounts), featureBuckets,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { FEATURE_KEY_COUNT, SelectiveGeometryShadow };
