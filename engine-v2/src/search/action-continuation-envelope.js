"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ACTION, HARD_STATUS, NONE_CELL } = require("../abi/fast-codes");
const { RISK_DIMENSION } = require("../abi/search-codes");
const { RUNTIME_MODE } = require("../abi/cache-runtime-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ProductionCacheBank } = require("../cache/production-cache");
const { ProductionDepthSearch } = require("./production-depth-search");
const { OPTION_KIND, OptionPortfolioSlab } = require("../policy/option-portfolio");
const { OPTION_SEARCH_STATUS, OptionAwareDepthSearch } =
  require("./option-aware-depth-search");

const ENVELOPE_STATUS = Object.freeze({ NONE: 0, NOMINAL_COMPLETE: 1,
  INCOMPLETE: 2 });
const MAX_ENVELOPE_ROWS = 3;
const SAMPLE_CAPACITY = 32;

function movementAction(action) {
  return action === ACTION.GO || action === ACTION.TURN_LEFT ||
    action === ACTION.TURN_RIGHT ? 1 : 0;
}

// Diagnostic-only completion of the OptionAwareDepthSearch contract. The
// production class already conditions representatives and cache identity, but
// POSITION/STAR leaves still fall back to one global heuristic. This subclass
// makes the target part of the leaf utility without changing upload semantics.
class ObjectiveConditionedDepthSearch extends OptionAwareDepthSearch {
  constructor(cacheBank, runtimeConfig, rootTransitions = null, options = null) {
    super(cacheBank, runtimeConfig, rootTransitions, options);
    this.dynamicPositionTarget = options && options.dynamicPositionTarget ? 1 : 0;
  }

  objectiveTarget(state, kind) {
    if (this.dynamicPositionTarget && kind === OPTION_KIND.POSITION)
      return state.arrays[ARRAY.TANK_CELL][1];
    return this.currentOptionTarget();
  }

  generateDeep(top, state, seat) {
    if (!seat && this.dynamicPositionTarget &&
        this.currentOptionKind() === OPTION_KIND.POSITION) {
      this.generateAttackContinuation(top, state); return;
    }
    super.generateDeep(top, state, seat);
  }

  heuristic(state) {
    const kind = this.currentOptionKind();
    if (kind !== OPTION_KIND.STAR_CONTROL && kind !== OPTION_KIND.POSITION)
      return super.heuristic(state);
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1]; const target = this.objectiveTarget(state, kind);
    if (target === NONE_CELL) return super.heuristic(state);
    const targetDistance = this.distance(state, own, target);
    const targetDirection = this.desiredDirection(state, own, target);
    let value = (a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1]) * 2200;
    value += (this.mobility(state, 0) - this.mobility(state, 1)) * 250;
    value += Math.max(0, 40 - targetDistance) *
      (kind === OPTION_KIND.STAR_CONTROL ? 650 : 450);
    if (targetDirection === a[ARRAY.TANK_DIR][0]) value += 500;
    if (kind === OPTION_KIND.POSITION && target === enemy &&
        this.clearLine(state, own, enemy)) {
      if (targetDirection === a[ARRAY.TANK_DIR][0]) value += 2200;
      const enemyDirection = this.desiredDirection(state, enemy, own);
      if (enemyDirection === a[ARRAY.TANK_DIR][1]) value -= 2600;
    }
    return Math.max(-25000, Math.min(25000, value));
  }
}

// Diagnostic service for the exact ownership gap exposed by the Observation
// census: an incomplete possible-projectile world, no complete value owner,
// and a movement row removed by Risk-only Pareto. It intentionally evaluates
// only the observed PhysicalState. Therefore its result is nominal evidence,
// never Hard, Proof, Safety, or an Information-complete action owner.
class ActionContinuationEnvelope {
  constructor(runtimeConfig, options = {}) {
    this.maximumRows = Math.max(2, Math.min(MAX_ENVELOPE_ROWS,
      Number.isSafeInteger(options.maximumRows) ? options.maximumRows : 3));
    this.depth = Math.max(2, Math.min(4,
      Number.isSafeInteger(options.depth) ? options.depth : 3));
    this.nodeBudget = Math.max(64, Math.min(4096,
      Number.isSafeInteger(options.nodeBudget) ? options.nodeBudget : 768));
    this.cooldownFrames = Math.max(0, Math.min(16,
      Number.isSafeInteger(options.cooldownFrames) ? options.cooldownFrames : 4));
    this.active = options.active ? 1 : 0;
    this.optionAware = options.optionAware ? 1 : 0;
    this.strictTargetOwnership = options.strictTargetOwnership ? 1 : 0;
    this.dynamicContactTarget = options.dynamicContactTarget ? 1 : 0;
    this.postRiskArbitration = options.postRiskArbitration ? 1 : 0;
    this.cacheBank = options.cacheBank || new ProductionCacheBank();
    this.search = options.search || new ProductionDepthSearch(this.cacheBank,
      runtimeConfig, null, { selectiveContinuationEnabled: true,
        windowedBoundsEnabled: true, crossFramePVEnabled: false,
        crossFrameRootPVEnabled: false,
        diagnosticNodeCapacity: this.nodeBudget });
    this.search.rootTransitions.setEnabled(false);
    this.optionSearch = options.optionSearch || new ObjectiveConditionedDepthSearch(
      new ProductionCacheBank(), runtimeConfig, null, {
        selectiveContinuationEnabled: true, windowedBoundsEnabled: true,
        crossFramePVEnabled: false, crossFrameRootPVEnabled: false,
        diagnosticNodeCapacity: this.nodeBudget,
        dynamicPositionTarget: this.dynamicContactTarget
      });
    this.optionSearch.rootTransitions.setEnabled(false);
    this.localPortfolio = new OptionPortfolioSlab(MAX_ENVELOPE_ROWS * 6);
    this.actions = new Uint8Array(MAX_ENVELOPE_ROWS);
    this.arguments = new Uint16Array(MAX_ENVELOPE_ROWS);
    this.rowMap = new Uint8Array(MAX_ENVELOPE_ROWS);
    this.used = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.sampleFrame = new Uint8Array(SAMPLE_CAPACITY);
    this.sampleSelectedRow = new Uint8Array(SAMPLE_CAPACITY);
    this.sampleWinnerRow = new Uint8Array(SAMPLE_CAPACITY);
    this.sampleSelectedAction = new Uint8Array(SAMPLE_CAPACITY);
    this.sampleWinnerAction = new Uint8Array(SAMPLE_CAPACITY);
    this.sampleSelectedScore = new Int32Array(SAMPLE_CAPACITY);
    this.sampleWinnerScore = new Int32Array(SAMPLE_CAPACITY);
    this.sampleCompletedDepth = new Uint8Array(SAMPLE_CAPACITY);
    this.sampleSelectedKind = new Uint8Array(SAMPLE_CAPACITY);
    this.sampleWinnerKind = new Uint8Array(SAMPLE_CAPACITY);
    this.sampleSelectedTarget = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleWinnerTarget = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleRiskConflict = new Uint8Array(SAMPLE_CAPACITY);
    this.sampleImproved = new Uint8Array(SAMPLE_CAPACITY);
    this.sampleSelectedImmediate = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleWinnerImmediate = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleSelectedHorizon = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleWinnerHorizon = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleSelectedUnknown = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleWinnerUnknown = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleSelectedCommitted = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleWinnerCommitted = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleSelectedPossible = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleWinnerPossible = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleSelectedFuture = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleWinnerFuture = new Uint16Array(SAMPLE_CAPACITY);
    this.sampleSelectedSlack = new Int8Array(SAMPLE_CAPACITY);
    this.sampleWinnerSlack = new Int8Array(SAMPLE_CAPACITY);
    this.sampleSelectedPostRisk = new Int32Array(SAMPLE_CAPACITY);
    this.sampleWinnerPostRisk = new Int32Array(SAMPLE_CAPACITY);
    this.lastFrame = -32; this.lastStatus = ENVELOPE_STATUS.NONE;
    this.lastProposal = -1; this.lastWinner = -1; this.lastSelected = -1;
    this.attempts = 0; this.triggered = 0; this.completed = 0;
    this.incomplete = 0; this.cooldownSkips = 0; this.runtimeModeSkips = 0;
    this.supportSkips = 0; this.valueOwnerSkips = 0; this.noConflictSkips = 0;
    this.singleRowSkips = 0; this.nodes = 0; this.maximumNodes = 0;
    this.nominalImprovementCount = 0; this.riskConflictImprovementCount = 0;
    this.sameWinnerCount = 0; this.rootRestoreFailures = 0;
    this.optionAwareAttempts = 0; this.optionAwareCompleted = 0;
    this.optionAwareDifferentWinnerCount = 0;
    this.activeQualifiedCount = 0; this.activeRejectedCount = 0;
    this.postRiskWinnerCount = 0; this.postRiskRejectedCount = 0;
    this.proposalCount = 0;
    this.sampleCount = 0; this.hotAllocationCount = 0;
  }

  completeValueOwner(engine) {
    const information = engine.informationSearch;
    if (information && information.completedDepth > 0 &&
        information.supportComplete === 1 && information.approximate === 0) return 1;
    const physical = engine.depthSearch;
    return physical && physical.completedDepth > 0 &&
      physical.representativeSupportComplete === 1 ? 1 : 0;
  }

  add(engine, row, count, total) {
    if (row < 0 || row >= total || count >= this.maximumRows || this.used[row]) return count;
    const outcome = engine.riskController.outcome;
    if (engine.hardStatus[row] !== HARD_STATUS.ALLOW || !outcome.acceptable[row] ||
        !movementAction(engine.ourActions[row])) return count;
    this.used[row] = 1; this.rowMap[count] = row;
    this.actions[count] = engine.ourActions[row];
    this.arguments[count] = engine.ourArguments[row];
    return count + 1;
  }

  betterCandidate(engine, left, right) {
    if (right < 0) return 1;
    const outcome = engine.riskController.outcome;
    if (outcome.expectedValue[left] !== outcome.expectedValue[right])
      return outcome.expectedValue[left] > outcome.expectedValue[right] ? 1 : 0;
    if (outcome.tacticalValue[left] !== outcome.tacticalValue[right])
      return outcome.tacticalValue[left] > outcome.tacticalValue[right] ? 1 : 0;
    return left < right ? 1 : 0;
  }

  selectCandidates(engine, selected, total) {
    this.used.fill(0, 0, total); let count = this.add(engine, selected, 0, total);
    // Deliberately include acceptable rows removed by Risk-only Pareto. The
    // Shadow answers whether that early deletion loses multi-frame value.
    while (count < this.maximumRows) {
      let best = -1;
      for (let row = 0; row < total; row += 1)
        if (!this.used[row] && engine.riskController.outcome.acceptable[row] &&
            movementAction(engine.ourActions[row]) &&
            this.betterCandidate(engine, row, best)) best = row;
      if (best < 0) break;
      count = this.add(engine, best, count, total);
    }
    return count;
  }

  hasParetoConflict(engine, count) {
    for (let local = 0; local < count; local += 1)
      if (engine.riskController.outcome.dominated[this.rowMap[local]]) return 1;
    return 0;
  }

  bestLocal(count) {
    let best = 0;
    for (let local = 1; local < count; local += 1)
      if (this.search.rootScore[local] > this.search.rootScore[best]) best = local;
    return best;
  }

  buildLocalPortfolio(engine, count) {
    this.localPortfolio.reset(); const source = engine.optionPortfolio;
    if (!source) return 0;
    for (let local = 0; local < count; local += 1) {
      const rootRow = this.rowMap[local]; let copied = 0;
      for (let at = 0; at < source.count; at += 1) {
        if (source.primitiveRow[at] !== rootRow) continue;
        const kind = source.kind[at]; let target = source.targetCell[at];
        // Diagnostic correction for the typed portfolio fallback: a movement
        // row without starPurpose must not silently inherit the visible star
        // as its objective. Keep explicit STAR_CONTROL intact; reinterpret an
        // otherwise generic POSITION as contact progress when the enemy is
        // visible, which is already required by this envelope's trigger.
        if (this.strictTargetOwnership && kind === OPTION_KIND.POSITION &&
            !engine.strategyBands.starPurpose[rootRow])
          target = engine.adapter.enemyVisible ?
            engine.adapter.state.arrays[ARRAY.TANK_CELL][1] : NONE_CELL;
        if (target === NONE_CELL) continue;
        this.localPortfolio.add(local, kind, target,
          source.targetSignature[at], source.deadline[at], source.evidence[at],
          source.supportComplete[at]);
        copied += 1;
      }
      // Typed portfolios normally provide this. Keep the diagnostic total if
      // a row has no strategic band: visible contact becomes POSITION toward
      // the enemy, never an untyped global-score alias.
      if (!copied && engine.adapter.enemyVisible)
        this.localPortfolio.add(local, OPTION_KIND.POSITION,
          engine.adapter.state.arrays[ARRAY.TANK_CELL][1], 0, 0xffff, 0, 1);
    }
    return this.localPortfolio.count;
  }

  selectedOptionScore(localRow) {
    const option = this.bestOptionForPrimitive(localRow);
    return option < 0 ? -32001 : this.optionSearch.rootScore[option];
  }

  bestOptionForPrimitive(localRow) {
    let best = -1;
    let score = -32001;
    for (let option = 0; option < this.optionSearch.optionCount; option += 1)
      if (this.optionSearch.optionPrimitiveRow[option] === localRow &&
          this.optionSearch.rootScore[option] > score) {
        score = this.optionSearch.rootScore[option]; best = option;
      }
    return best;
  }

  postRiskScore(engine, rootRow, value) {
    if (!this.postRiskArbitration) return value;
    const risk = engine.policy && Number.isSafeInteger(engine.policy.baseRisk) ?
      engine.policy.baseRisk : 0;
    const stateClass = engine.riskController.stateRiskClass;
    const lambda = engine.riskController.riskProfile.lambda(risk, stateClass,
      RISK_DIMENSION.ENEMY_ACTION);
    return engine.riskController.binaryFatalBackup(value,
      engine.riskController.outcome.futureFireFatalMass[rootRow], lambda);
  }

  bestPostRiskLocal(engine, count) {
    let best = 0;
    let bestScore = this.postRiskScore(engine, this.rowMap[0], this.selectedOptionScore(0));
    for (let local = 1; local < count; local += 1) {
      const score = this.postRiskScore(engine, this.rowMap[local],
        this.selectedOptionScore(local));
      if (score > bestScore || score === bestScore && local < best) {
        best = local; bestScore = score;
      }
    }
    if (best) this.postRiskWinnerCount += 1;
    return best;
  }

  qualifiesFutureFireTradeoff(engine, selected, winner, winnerLocal,
      selectedScore = 0, winnerScore = 0) {
    if (!this.active || !this.optionAware || winner === selected || winnerLocal < 0)
      return 0;
    const selectedOption = this.bestOptionForPrimitive(0);
    const winnerOption = this.bestOptionForPrimitive(winnerLocal);
    if (selectedOption < 0 || winnerOption < 0 ||
        this.optionSearch.optionKind[selectedOption] !== OPTION_KIND.POSITION ||
        this.optionSearch.optionKind[winnerOption] !== OPTION_KIND.POSITION ||
        this.optionSearch.optionTargetCell[selectedOption] === NONE_CELL ||
        this.optionSearch.optionTargetCell[selectedOption] !==
          this.optionSearch.optionTargetCell[winnerOption]) return 0;
    const o = engine.riskController.outcome;
    if (!o.acceptable[winner] || engine.hardStatus[winner] !== HARD_STATUS.ALLOW ||
        o.committedFatalMass[winner] > o.committedFatalMass[selected] ||
        o.immediateFatalMass[winner] > o.immediateFatalMass[selected] ||
        o.unknownMass[winner] > o.unknownMass[selected] ||
        o.possibleProjectileFatalMass[winner] > o.possibleProjectileFatalMass[selected] ||
        o.escapeSlack[winner] < o.escapeSlack[selected]) return 0;
    const horizonIncrease = Math.max(0,
      o.horizonFatalMass[winner] - o.horizonFatalMass[selected]);
    const futureIncrease = Math.max(0,
      o.futureFireFatalMass[winner] - o.futureFireFatalMass[selected]);
    if (!(horizonIncrease > 0 && horizonIncrease <= futureIncrease)) return 0;
    if (this.postRiskArbitration &&
        this.postRiskScore(engine, winner, winnerScore) <=
          this.postRiskScore(engine, selected, selectedScore)) {
      this.postRiskRejectedCount += 1; return 0;
    }
    return 1;
  }

  recordSample(engine, selected, winner, selectedScore, winnerScore) {
    if (this.sampleCount >= SAMPLE_CAPACITY) return;
    const at = this.sampleCount++; const state = engine.adapter.state;
    this.sampleFrame[at] = state.arrays[ARRAY.SCALAR][SCALAR.FRAME] & 0xff;
    this.sampleSelectedRow[at] = selected;
    this.sampleWinnerRow[at] = winner;
    this.sampleSelectedAction[at] = engine.ourActions[selected];
    this.sampleWinnerAction[at] = engine.ourActions[winner];
    this.sampleSelectedScore[at] = selectedScore;
    this.sampleWinnerScore[at] = winnerScore;
    this.sampleCompletedDepth[at] = this.optionAware ?
      this.optionSearch.completedDepth : this.search.completedDepth;
    if (this.optionAware) {
      const selectedOption = this.bestOptionForPrimitive(0);
      let localWinner = -1;
      for (let local = 0; local < this.maximumRows; local += 1)
        if (this.rowMap[local] === winner) { localWinner = local; break; }
      const winnerOption = this.bestOptionForPrimitive(localWinner);
      if (selectedOption >= 0) {
        this.sampleSelectedKind[at] = this.optionSearch.optionKind[selectedOption];
        this.sampleSelectedTarget[at] = this.optionSearch.optionTargetCell[selectedOption];
      }
      if (winnerOption >= 0) {
        this.sampleWinnerKind[at] = this.optionSearch.optionKind[winnerOption];
        this.sampleWinnerTarget[at] = this.optionSearch.optionTargetCell[winnerOption];
      }
    }
    this.sampleRiskConflict[at] = engine.riskController.outcome.dominated[winner] ? 1 : 0;
    this.sampleImproved[at] = winnerScore > selectedScore && winner !== selected ? 1 : 0;
    const outcome = engine.riskController.outcome;
    this.sampleSelectedImmediate[at] = outcome.immediateFatalMass[selected];
    this.sampleWinnerImmediate[at] = outcome.immediateFatalMass[winner];
    this.sampleSelectedHorizon[at] = outcome.horizonFatalMass[selected];
    this.sampleWinnerHorizon[at] = outcome.horizonFatalMass[winner];
    this.sampleSelectedUnknown[at] = outcome.unknownMass[selected];
    this.sampleWinnerUnknown[at] = outcome.unknownMass[winner];
    this.sampleSelectedCommitted[at] = outcome.committedFatalMass[selected];
    this.sampleWinnerCommitted[at] = outcome.committedFatalMass[winner];
    this.sampleSelectedPossible[at] = outcome.possibleProjectileFatalMass[selected];
    this.sampleWinnerPossible[at] = outcome.possibleProjectileFatalMass[winner];
    this.sampleSelectedFuture[at] = outcome.futureFireFatalMass[selected];
    this.sampleWinnerFuture[at] = outcome.futureFireFatalMass[winner];
    this.sampleSelectedSlack[at] = outcome.escapeSlack[selected];
    this.sampleWinnerSlack[at] = outcome.escapeSlack[winner];
    this.sampleSelectedPostRisk[at] = this.postRiskScore(engine, selected, selectedScore);
    this.sampleWinnerPostRisk[at] = this.postRiskScore(engine, winner, winnerScore);
  }

  evaluate(engine, bundle, selected, total) {
    this.lastStatus = ENVELOPE_STATUS.NONE; this.lastProposal = -1;
    this.lastWinner = -1; this.lastSelected = selected; this.attempts += 1;
    if (!bundle || selected < 0 || selected >= total ||
        !movementAction(engine.ourActions[selected])) return -1;
    if (engine.runtime.runtimeMode !== RUNTIME_MODE.NORMAL) {
      this.runtimeModeSkips += 1; return -1;
    }
    if (engine.observationSafetySupportComplete() ||
        engine.possibleProjectiles.count() < 1 || !engine.adapter.enemyVisible ||
        engine.hiddenWorldCount !== 1 || engine.hiddenWorldMass[0] !== 10000) {
      this.supportSkips += 1; return -1;
    }
    if (this.completeValueOwner(engine)) { this.valueOwnerSkips += 1; return -1; }
    const count = this.selectCandidates(engine, selected, total);
    if (count < 2) { this.singleRowSkips += 1; return -1; }
    if (!this.hasParetoConflict(engine, count)) {
      this.noConflictSkips += 1; return -1;
    }
    const frame = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (frame < this.lastFrame) this.lastFrame = -32;
    if (frame - this.lastFrame < this.cooldownFrames) {
      this.cooldownSkips += 1; return -1;
    }
    this.lastFrame = frame; this.triggered += 1;
    const state = engine.adapter.state; const lo = state.hashLo; const hi = state.hashHi;
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    let completed; let winnerLocal; let selectedScore; let winnerScore;
    if (this.optionAware && this.buildLocalPortfolio(engine, count)) {
      this.optionAwareAttempts += 1;
      completed = this.optionSearch.searchPortfolio(bundle, this.localPortfolio,
        this.actions, this.arguments, count, engine.enemyActions, engine.enemyArguments,
        engine.enemyCount, this.depth, this.nodeBudget, engine.policy.baseRisk, 0);
      this.nodes += this.optionSearch.nodes;
      if (this.optionSearch.nodes > this.maximumNodes)
        this.maximumNodes = this.optionSearch.nodes;
      if (completed && this.optionSearch.lastStatus === OPTION_SEARCH_STATUS.COMPLETE) {
        this.optionAwareCompleted += 1;
        winnerLocal = this.postRiskArbitration ?
          this.bestPostRiskLocal(engine, count) : this.optionSearch.lastBestPrimitiveRow;
        selectedScore = this.selectedOptionScore(0);
        winnerScore = this.selectedOptionScore(winnerLocal);
      }
    } else {
      completed = this.search.search(bundle, this.actions, this.arguments, count,
        engine.enemyActions, engine.enemyArguments, engine.enemyCount,
        this.depth, this.nodeBudget, engine.policy.baseRisk, 0);
      this.nodes += this.search.nodes;
      if (this.search.nodes > this.maximumNodes) this.maximumNodes = this.search.nodes;
      if (completed >= 1 && this.search.representativeSupportComplete) {
        winnerLocal = this.bestLocal(count); selectedScore = this.search.rootScore[0];
        winnerScore = this.search.rootScore[winnerLocal];
      }
    }
    if (state.hashLo !== lo || state.hashHi !== hi ||
        state.deltaUsed * 1024 + state.eventUsed !== mark) this.rootRestoreFailures += 1;
    const supportComplete = this.optionAware ?
      completed && this.optionSearch.lastStatus === OPTION_SEARCH_STATUS.COMPLETE :
      completed >= 1 && this.search.representativeSupportComplete;
    if (!supportComplete) {
      this.lastStatus = ENVELOPE_STATUS.INCOMPLETE; this.incomplete += 1; return -1;
    }
    this.lastStatus = ENVELOPE_STATUS.NOMINAL_COMPLETE; this.completed += 1;
    const winner = this.rowMap[winnerLocal];
    if (this.optionAware && winner !== selected)
      this.optionAwareDifferentWinnerCount += 1;
    this.lastWinner = winner;
    this.recordSample(engine, selected, winner, selectedScore, winnerScore);
    if (winner === selected) { this.sameWinnerCount += 1; return -1; }
    if (winnerScore > selectedScore) {
      this.nominalImprovementCount += 1;
      if (engine.riskController.outcome.dominated[winner])
        this.riskConflictImprovementCount += 1;
    }
    if (winnerScore > selectedScore &&
        this.qualifiesFutureFireTradeoff(engine, selected, winner, winnerLocal,
          selectedScore, winnerScore)) {
      this.activeQualifiedCount += 1; this.proposalCount += 1;
      this.lastProposal = winner; return winner;
    }
    if (this.active) this.activeRejectedCount += 1;
    // Observation support is incomplete by construction. Returning -1 is the
    // ownership contract, not merely Shadow configuration.
    return -1;
  }

  samples() {
    const output = [];
    for (let at = 0; at < this.sampleCount; at += 1) output.push({
      frame: this.sampleFrame[at], selectedRow: this.sampleSelectedRow[at],
      winnerRow: this.sampleWinnerRow[at], selectedAction: this.sampleSelectedAction[at],
      winnerAction: this.sampleWinnerAction[at],
      selectedScore: this.sampleSelectedScore[at], winnerScore: this.sampleWinnerScore[at],
      completedDepth: this.sampleCompletedDepth[at],
      selectedKind: this.sampleSelectedKind[at],
      winnerKind: this.sampleWinnerKind[at],
      selectedTarget: this.sampleSelectedTarget[at],
      winnerTarget: this.sampleWinnerTarget[at],
      selectedImmediate: this.sampleSelectedImmediate[at],
      winnerImmediate: this.sampleWinnerImmediate[at],
      selectedHorizon: this.sampleSelectedHorizon[at],
      winnerHorizon: this.sampleWinnerHorizon[at],
      selectedUnknown: this.sampleSelectedUnknown[at],
      winnerUnknown: this.sampleWinnerUnknown[at],
      selectedCommitted: this.sampleSelectedCommitted[at],
      winnerCommitted: this.sampleWinnerCommitted[at],
      selectedPossible: this.sampleSelectedPossible[at],
      winnerPossible: this.sampleWinnerPossible[at],
      selectedFuture: this.sampleSelectedFuture[at],
      winnerFuture: this.sampleWinnerFuture[at],
      selectedSlack: this.sampleSelectedSlack[at],
      winnerSlack: this.sampleWinnerSlack[at],
      selectedPostRisk: this.sampleSelectedPostRisk[at],
      winnerPostRisk: this.sampleWinnerPostRisk[at],
      riskConflict: Boolean(this.sampleRiskConflict[at]),
      improved: Boolean(this.sampleImproved[at])
    });
    return output;
  }

  summary() {
    return { enabled: true, active: Boolean(this.active), maximumRows: this.maximumRows,
      depth: this.depth, nodeBudget: this.nodeBudget, cooldownFrames: this.cooldownFrames,
      optionAware: Boolean(this.optionAware),
      strictTargetOwnership: Boolean(this.strictTargetOwnership),
      dynamicContactTarget: Boolean(this.dynamicContactTarget),
      postRiskArbitration: Boolean(this.postRiskArbitration),
      attempts: this.attempts, triggered: this.triggered, completed: this.completed,
      incomplete: this.incomplete, cooldownSkips: this.cooldownSkips,
      runtimeModeSkips: this.runtimeModeSkips, supportSkips: this.supportSkips,
      valueOwnerSkips: this.valueOwnerSkips, noConflictSkips: this.noConflictSkips,
      singleRowSkips: this.singleRowSkips, nodes: this.nodes,
      maximumNodes: this.maximumNodes,
      nominalImprovementCount: this.nominalImprovementCount,
      riskConflictImprovementCount: this.riskConflictImprovementCount,
      sameWinnerCount: this.sameWinnerCount,
      optionAwareAttempts: this.optionAwareAttempts,
      optionAwareCompleted: this.optionAwareCompleted,
      optionAwareDifferentWinnerCount: this.optionAwareDifferentWinnerCount,
      activeQualifiedCount: this.activeQualifiedCount,
      activeRejectedCount: this.activeRejectedCount,
      postRiskWinnerCount: this.postRiskWinnerCount,
      postRiskRejectedCount: this.postRiskRejectedCount,
      rootRestoreFailures: this.rootRestoreFailures,
      supportComplete: false, proposalCount: this.proposalCount,
      hotAllocationCount: this.hotAllocationCount,
      samples: this.samples() };
  }
}

module.exports = { ENVELOPE_STATUS, MAX_ENVELOPE_ROWS, SAMPLE_CAPACITY,
  movementAction, ObjectiveConditionedDepthSearch, ActionContinuationEnvelope };
