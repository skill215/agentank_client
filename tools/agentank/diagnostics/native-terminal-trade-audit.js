"use strict";

// Diagnostic-only audit for a selected FIRE at a tactical minimax root.
// It answers a narrow ownership question without changing the action:
// did the adversarial root contain an enemy FIRE reply, and did that matrix
// cell encode the terminal value of a possible mutual destruction?

const { ACTION, TERRAIN, NONE_FRAME, DX, DY } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");

const EMPTY_VALUE = 0x7fffffff;

const FIELD = Object.freeze({
  FRAME: 0,
  ROW: 1,
  ROOT_VALUE: 2,
  BACKED_VALUE: 3,
  DIRECT_KILL: 4,
  COUNTER_EXPOSURE: 5,
  HORIZON_FATAL: 6,
  ESCAPE_SLACK: 7,
  OWN_STARS: 8,
  ENEMY_STARS: 9,
  ENEMY_FIRE_COLUMNS: 10,
  ENEMY_FIRE_WORST: 11,
  ENEMY_FIRE_BEST: 12,
  NON_FIRE_ROW: 13,
  NON_FIRE_ACTION: 14,
  NON_FIRE_BACKED_VALUE: 15,
  NON_FIRE_ENEMY_FIRE_WORST: 16,
  ENEMY_CAN_ACT: 17,
  SELECTED_MATRIX_WORST: 18,
  BEST_MATRIX_WORST_ROW: 19,
  BEST_MATRIX_WORST_ACTION: 20,
  BEST_MATRIX_WORST: 21,
  BEST_MATRIX_WORST_BACKED: 22,
  STRIDE: 23
});

const FRONTIER_FIELD = Object.freeze({
  FRAME: 0,
  SELECTED_ROW: 1,
  SELECTED_ACTION: 2,
  SELECTED_WORST: 3,
  SELECTED_BACKED: 4,
  BEST_ROW: 5,
  BEST_ACTION: 6,
  BEST_WORST: 7,
  BEST_BACKED: 8,
  OWN_STARS: 9,
  ENEMY_STARS: 10,
  STRIDE: 11
});

class NativeTerminalTradeAudit {
  constructor(capacity = 64, ownershipMode = "shadow", options = {}) {
    this.capacity = Math.max(1, capacity | 0);
    this.ownershipMode = ownershipMode === "active" ? "active" :
      ownershipMode === "paired-shadow" ? "paired-shadow" :
      ownershipMode === "paired-active" ? "paired-active" : "shadow";
    this.pairedTerminalDepth = Math.max(2, Math.min(8,
      Number.isInteger(options.pairedTerminalDepth) ?
        options.pairedTerminalDepth : 4));
    this.pairedTerminalNodeBudget = Math.max(32, Math.min(8192,
      Number.isInteger(options.pairedTerminalNodeBudget) ?
        options.pairedTerminalNodeBudget : 512));
    this.words = new Int32Array(this.capacity * FIELD.STRIDE);
    this.frontierWords = new Int32Array(this.capacity * FRONTIER_FIELD.STRIDE);
    this.count = 0;
    this.frontierCount = 0;
    this.frontierOverflowCount = 0;
    this.rootAuditCount = 0;
    this.worstDominatedSelectionCount = 0;
    this.terminalBandDominatedSelectionCount = 0;
    this.overflowCount = 0;
    this.selectedFireCount = 0;
    this.directCounterTradeCount = 0;
    this.nonWinningTradeCount = 0;
    this.enemyFireMissingCount = 0;
    this.enemyFireTerminalLossCount = 0;
    this.enemyFireNonterminalCount = 0;
    this.robustBlendAboveWorstCount = 0;
    this.strictlySaferWorstAlternativeCount = 0;
    this.initiativeCheckCount = 0;
    this.directInitiativeCount = 0;
    this.unfavorableInitiativeCount = 0;
    this.favorableInitiativeCount = 0;
    this.baseRowMissingCount = 0;
    this.baseRowUnsafeCount = 0;
    this.baseWorstNotBetterCount = 0;
    this.ownershipWouldYieldCount = 0;
    this.ownershipYieldCount = 0;
    this.successorTradeCheckCount = 0;
    this.successorTradeEvidenceCount = 0;
    this.successorTradeWouldYieldCount = 0;
    this.successorTradeYieldCount = 0;
    this.successorTradeRegressionBlockedCount = 0;
    this.pairedTerminalCheckCount = 0;
    this.pairedTerminalCompleteCount = 0;
    this.pairedTerminalRawImprovementCount = 0;
    this.pairedTerminalBandImprovementCount = 0;
    this.pairedTerminalWouldYieldCount = 0;
    this.pairedTerminalYieldCount = 0;
    this.hotAllocationCount = 0;
    this.lastSelectedMatrixWorst = EMPTY_VALUE;
    this.lastBestWorstRow = -1;
    this.lastBestMatrixWorst = -EMPTY_VALUE;
    this.lastBestWorstBacked = -EMPTY_VALUE;
  }

  active(until, frame) {
    return until !== undefined && until !== NONE_FRAME && until > frame ? 1 : 0;
  }

  projectileActive(arrays, owner) {
    const active = arrays[ARRAY.PROJECTILE_ACTIVE];
    const owners = arrays[ARRAY.PROJECTILE_OWNER];
    if (!active || !owners) return 0;
    for (let slot = 0; slot < active.length; slot += 1)
      if (active[slot] && owners[slot] === owner) return 1;
    return 0;
  }

  directionTo(state, from, to) {
    const x = state.x(from); const y = state.y(from);
    const ex = state.x(to); const ey = state.y(to);
    if (x === ex) return ey < y ? 0 : ey > y ? 2 : -1;
    if (y === ey) return ex > x ? 1 : 3;
    return -1;
  }

  clearLine(state, from, to, direction) {
    const terrain = state.arrays[ARRAY.TERRAIN];
    if (!terrain) return 0;
    let x = state.x(from) + DX[direction];
    let y = state.y(from) + DY[direction];
    while (x >= 0 && x < state.width && y >= 0 && y < state.height) {
      const cell = state.cell(x, y);
      if (cell === to) return 1;
      const tile = terrain[cell];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
      x += DX[direction]; y += DY[direction];
    }
    return 0;
  }

  arrivalFrames(state, seat, targetSeat, canFire, targetShielded) {
    if (!canFire || targetShielded) return 99;
    const arrays = state.arrays;
    const from = arrays[ARRAY.TANK_CELL][seat];
    const to = arrays[ARRAY.TANK_CELL][targetSeat];
    const wanted = this.directionTo(state, from, to);
    if (wanted < 0 || !this.clearLine(state, from, to, wanted)) return 99;
    const delta = (wanted - arrays[ARRAY.TANK_DIR][seat]) & 3;
    let turns = delta === 3 ? 1 : delta;
    if (delta === 2) turns = 2;
    const frame = arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const boostUntil = arrays[ARRAY.TANK_BOOST_UNTIL];
    if (boostUntil && this.active(boostUntil[seat], frame))
      turns = Math.max(0, turns - 1);
    const distance = Math.abs(state.x(from) - state.x(to)) +
      Math.abs(state.y(from) - state.y(to));
    return turns + ((distance + 1) >> 1);
  }

  directInitiative(engine, selected) {
    const state = engine?.adapter?.state; const arrays = state?.arrays;
    if (!state || !arrays || selected < 0) return 0;
    const own = arrays[ARRAY.TANK_CELL]?.[0];
    const enemy = arrays[ARRAY.TANK_CELL]?.[1];
    if (own === undefined || enemy === undefined) return 0;
    const wanted = this.directionTo(state, own, enemy);
    if (wanted < 0 || !this.clearLine(state, own, enemy, wanted)) return 0;
    const distance = Math.abs(state.x(own) - state.x(enemy)) +
      Math.abs(state.y(own) - state.y(enemy));
    if (distance > 6) return 0;
    const current = arrays[ARRAY.TANK_DIR][0];
    const delta = (wanted - current) & 3;
    const directAction = wanted === current ? ACTION.FIRE :
      delta === 3 ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
    if (engine.ourActions[selected] !== directAction) return 0;
    const frame = arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const fireLock = arrays[ARRAY.TANK_FIRE_LOCK];
    if (this.projectileActive(arrays, 0) || fireLock &&
        this.active(fireLock[0], frame)) return 0;
    const shieldUntil = arrays[ARRAY.TANK_SHIELD_UNTIL];
    const shieldHits = arrays[ARRAY.TANK_SHIELD_HITS];
    const enemyShield = shieldUntil && shieldHits &&
      this.active(shieldUntil[1], frame) && shieldHits[1] > 0;
    if (enemyShield) return 0;
    return 1;
  }

  // A diagnostic ownership boundary, not a proof or a Hard rule.  It mirrors
  // the exact direct-arrival interval that makes V1 decline an initiative:
  // a slower shot loses, and an equal-arrival mutual trade is acceptable only
  // with a star lead.  ACTIVE may only restore an already allowed base row
  // whose raw minimax worst is strictly better than the proposed initiative.
  select(engine, source, allowedRow, backedValue, selected, count, baseRow) {
    this.observe(engine, source, allowedRow, backedValue, selected, count);
    this.successorTradeCheckCount += 1;
    if (source.rootTradeClass && baseRow >= 0 && baseRow < count &&
        baseRow !== selected && allowedRow[baseRow]) {
      const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
      let improvement = 0; let regression = 0;
      for (let column = 0; column < engine.enemyCount; column += 1) {
        if (source.rootEnemyDomainMask && !source.rootEnemyDomainMask[column]) continue;
        const selectedBad = source.rootTradeClass[selected * stride + column] >= 2;
        const baseBad = source.rootTradeClass[baseRow * stride + column] >= 2;
        if (selectedBad && !baseBad) improvement = 1;
        else if (baseBad && !selectedBad) regression = 1;
      }
      if (improvement) this.successorTradeEvidenceCount += 1;
      if (improvement && regression)
        this.successorTradeRegressionBlockedCount += 1;
      else if (improvement) {
        this.successorTradeWouldYieldCount += 1;
        if (this.ownershipMode === "paired-shadow" ||
            this.ownershipMode === "paired-active") {
          this.pairedTerminalCheckCount += 1;
          const complete = typeof source.compareTerminalRows === "function" &&
            source.compareTerminalRows(engine, selected, baseRow,
              this.pairedTerminalDepth, this.pairedTerminalNodeBudget);
          if (complete) {
            this.pairedTerminalCompleteCount += 1;
            const selectedWorst = source.pairedTerminalSelectedWorst;
            const baseWorst = source.pairedTerminalBaseWorst;
            if (baseWorst > selectedWorst)
              this.pairedTerminalRawImprovementCount += 1;
            if (selectedWorst <= -30000 && baseWorst > -30000) {
              this.pairedTerminalBandImprovementCount += 1;
              this.pairedTerminalWouldYieldCount += 1;
              if (this.ownershipMode === "paired-active") {
                this.pairedTerminalYieldCount += 1;
                return baseRow;
              }
            }
          }
          return selected;
        }
        if (this.ownershipMode === "active") {
          this.successorTradeYieldCount += 1;
          return baseRow;
        }
      }
    }
    this.initiativeCheckCount += 1;
    if (!this.directInitiative(engine, selected)) return selected;
    this.directInitiativeCount += 1;
    const state = engine.adapter.state; const arrays = state.arrays;
    const frame = arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const enemyFireLock = arrays[ARRAY.TANK_FIRE_LOCK];
    const enemyCanFire = !(enemyFireLock &&
      this.active(enemyFireLock[1], frame)) && !this.projectileActive(arrays, 1);
    const ownShieldUntil = arrays[ARRAY.TANK_SHIELD_UNTIL];
    const shieldHits = arrays[ARRAY.TANK_SHIELD_HITS];
    const ownShield = ownShieldUntil && shieldHits &&
      this.active(ownShieldUntil[0], frame) && shieldHits[0] > 0;
    const ownFrames = this.arrivalFrames(state, 0, 1, 1, 0);
    const enemyFrames = this.arrivalFrames(state, 1, 0, enemyCanFire, ownShield);
    const stars = arrays[ARRAY.TANK_STARS];
    const favorableTie = ownFrames === enemyFrames && stars[0] > stars[1];
    if (ownFrames < enemyFrames || favorableTie) {
      this.favorableInitiativeCount += 1; return selected;
    }
    this.unfavorableInitiativeCount += 1;
    if (baseRow < 0 || baseRow >= count || baseRow === selected) {
      this.baseRowMissingCount += 1; return selected;
    }
    if (!allowedRow[baseRow]) {
      this.baseRowUnsafeCount += 1; return selected;
    }
    const selectedWorst = this.matrixWorst(source, selected, engine);
    const baseWorst = this.matrixWorst(source, baseRow, engine);
    if (selectedWorst === EMPTY_VALUE || baseWorst === EMPTY_VALUE ||
        baseWorst <= selectedWorst) {
      this.baseWorstNotBetterCount += 1; return selected;
    }
    this.ownershipWouldYieldCount += 1;
    if (this.ownershipMode !== "active") return selected;
    this.ownershipYieldCount += 1;
    return baseRow;
  }

  matrixWorst(source, row, engine) {
    const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
    let worst = EMPTY_VALUE; let supported = 0;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      if (source.rootEnemyDomainMask && !source.rootEnemyDomainMask[column]) continue;
      const value = source.rootCellScore[row * stride + column];
      if (value === EMPTY_VALUE) continue;
      supported = 1;
      if (value < worst) worst = value;
    }
    return supported ? worst : EMPTY_VALUE;
  }

  auditFrontier(engine, source, allowedRow, backedValue, selected, count) {
    this.rootAuditCount += 1;
    const selectedWorst = this.matrixWorst(source, selected, engine);
    let bestWorstRow = -1; let bestMatrixWorst = -EMPTY_VALUE;
    let bestWorstBacked = -EMPTY_VALUE;
    for (let row = 0; row < count; row += 1) {
      if (!allowedRow[row]) continue;
      const matrixWorst = this.matrixWorst(source, row, engine);
      if (matrixWorst === EMPTY_VALUE) continue;
      if (bestWorstRow < 0 || matrixWorst > bestMatrixWorst ||
          matrixWorst === bestMatrixWorst && backedValue[row] > bestWorstBacked ||
          matrixWorst === bestMatrixWorst && backedValue[row] === bestWorstBacked &&
            row < bestWorstRow) {
        bestWorstRow = row; bestMatrixWorst = matrixWorst;
        bestWorstBacked = backedValue[row];
      }
    }
    this.lastSelectedMatrixWorst = selectedWorst;
    this.lastBestWorstRow = bestWorstRow;
    this.lastBestMatrixWorst = bestMatrixWorst;
    this.lastBestWorstBacked = bestWorstBacked;
    if (selectedWorst === EMPTY_VALUE || bestWorstRow < 0 ||
        bestMatrixWorst <= selectedWorst) return;
    this.worstDominatedSelectionCount += 1;
    if (selectedWorst <= -30000 && bestMatrixWorst > -30000)
      this.terminalBandDominatedSelectionCount += 1;
    if (this.frontierCount >= this.capacity) {
      this.frontierOverflowCount += 1; return;
    }
    const arrays = engine.adapter.state.arrays;
    const at = this.frontierCount * FRONTIER_FIELD.STRIDE;
    const words = this.frontierWords;
    words[at + FRONTIER_FIELD.FRAME] = arrays[ARRAY.SCALAR][SCALAR.FRAME] | 0;
    words[at + FRONTIER_FIELD.SELECTED_ROW] = selected;
    words[at + FRONTIER_FIELD.SELECTED_ACTION] = engine.ourActions[selected];
    words[at + FRONTIER_FIELD.SELECTED_WORST] = selectedWorst;
    words[at + FRONTIER_FIELD.SELECTED_BACKED] = backedValue[selected];
    words[at + FRONTIER_FIELD.BEST_ROW] = bestWorstRow;
    words[at + FRONTIER_FIELD.BEST_ACTION] = engine.ourActions[bestWorstRow];
    words[at + FRONTIER_FIELD.BEST_WORST] = bestMatrixWorst;
    words[at + FRONTIER_FIELD.BEST_BACKED] = bestWorstBacked;
    words[at + FRONTIER_FIELD.OWN_STARS] = arrays[ARRAY.TANK_STARS][0] | 0;
    words[at + FRONTIER_FIELD.ENEMY_STARS] = arrays[ARRAY.TANK_STARS][1] | 0;
    this.frontierCount += 1;
  }

  observe(engine, source, allowedRow, backedValue, selected, count) {
    if (!engine || !source || selected < 0 || selected >= count) return 0;
    this.auditFrontier(engine, source, allowedRow, backedValue, selected, count);
    if (engine.ourActions[selected] !== ACTION.FIRE) return 0;
    this.selectedFireCount += 1;
    const combat = engine.combat?.vector;
    const risk = engine.riskController?.outcome;
    if (!combat || selected >= combat.count || !combat.directKill[selected] ||
        !combat.ownCounterExposure[selected]) return 0;
    this.directCounterTradeCount += 1;
    const state = engine.adapter.state; const arrays = state.arrays;
    const ownStars = arrays[ARRAY.TANK_STARS][0] | 0;
    const enemyStars = arrays[ARRAY.TANK_STARS][1] | 0;
    if (ownStars > enemyStars) return 0;
    this.nonWinningTradeCount += 1;

    const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
    let fireColumns = 0;
    let fireWorst = EMPTY_VALUE;
    let fireBest = -EMPTY_VALUE;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      if (engine.enemyActions[column] !== ACTION.FIRE) continue;
      fireColumns += 1;
      const value = source.rootCellScore[selected * stride + column];
      if (value < fireWorst) fireWorst = value;
      if (value > fireBest) fireBest = value;
    }
    if (!fireColumns) this.enemyFireMissingCount += 1;
    else if (fireWorst <= -30000) this.enemyFireTerminalLossCount += 1;
    else this.enemyFireNonterminalCount += 1;
    const rootValue = source.rootScore[selected];
    const selectedMatrixWorst = this.lastSelectedMatrixWorst;
    const bestWorstRow = this.lastBestWorstRow;
    const bestMatrixWorst = this.lastBestMatrixWorst;
    const bestWorstBacked = this.lastBestWorstBacked;
    if (selectedMatrixWorst !== EMPTY_VALUE && rootValue > selectedMatrixWorst)
      this.robustBlendAboveWorstCount += 1;
    if (selectedMatrixWorst !== EMPTY_VALUE && bestWorstRow >= 0 &&
        bestMatrixWorst > selectedMatrixWorst)
      this.strictlySaferWorstAlternativeCount += 1;

    let nonFire = -1; let nonFireValue = -EMPTY_VALUE;
    for (let row = 0; row < count; row += 1) {
      if (!allowedRow[row] || engine.ourActions[row] === ACTION.FIRE) continue;
      const value = backedValue[row];
      if (nonFire < 0 || value > nonFireValue ||
          value === nonFireValue && row < nonFire) {
        nonFire = row; nonFireValue = value;
      }
    }
    let nonFireWorst = EMPTY_VALUE;
    if (nonFire >= 0 && fireColumns)
      for (let column = 0; column < engine.enemyCount; column += 1) {
        if (engine.enemyActions[column] !== ACTION.FIRE) continue;
        const value = source.rootCellScore[nonFire * stride + column];
        if (value < nonFireWorst) nonFireWorst = value;
      }

    if (this.count >= this.capacity) {
      this.overflowCount += 1;
      return 1;
    }
    const at = this.count * FIELD.STRIDE; const words = this.words;
    words[at + FIELD.FRAME] = arrays[ARRAY.SCALAR][SCALAR.FRAME] | 0;
    words[at + FIELD.ROW] = selected;
    words[at + FIELD.ROOT_VALUE] = rootValue;
    words[at + FIELD.BACKED_VALUE] = backedValue[selected];
    words[at + FIELD.DIRECT_KILL] = combat.directKill[selected];
    words[at + FIELD.COUNTER_EXPOSURE] = combat.ownCounterExposure[selected];
    words[at + FIELD.HORIZON_FATAL] = risk && selected < risk.count ?
      risk.horizonFatalMass[selected] : -1;
    words[at + FIELD.ESCAPE_SLACK] = risk && selected < risk.count ?
      risk.escapeSlack[selected] : -128;
    words[at + FIELD.OWN_STARS] = ownStars;
    words[at + FIELD.ENEMY_STARS] = enemyStars;
    words[at + FIELD.ENEMY_FIRE_COLUMNS] = fireColumns;
    words[at + FIELD.ENEMY_FIRE_WORST] = fireWorst;
    words[at + FIELD.ENEMY_FIRE_BEST] = fireColumns ? fireBest : EMPTY_VALUE;
    words[at + FIELD.NON_FIRE_ROW] = nonFire;
    words[at + FIELD.NON_FIRE_ACTION] = nonFire >= 0 ?
      engine.ourActions[nonFire] : ACTION.NONE;
    words[at + FIELD.NON_FIRE_BACKED_VALUE] = nonFire >= 0 ?
      nonFireValue : -EMPTY_VALUE;
    words[at + FIELD.NON_FIRE_ENEMY_FIRE_WORST] = nonFireWorst;
    words[at + FIELD.ENEMY_CAN_ACT] = engine.adapter.enemyCanAct ? 1 : 0;
    words[at + FIELD.SELECTED_MATRIX_WORST] = selectedMatrixWorst;
    words[at + FIELD.BEST_MATRIX_WORST_ROW] = bestWorstRow;
    words[at + FIELD.BEST_MATRIX_WORST_ACTION] = bestWorstRow >= 0 ?
      engine.ourActions[bestWorstRow] : ACTION.NONE;
    words[at + FIELD.BEST_MATRIX_WORST] = bestMatrixWorst;
    words[at + FIELD.BEST_MATRIX_WORST_BACKED] = bestWorstBacked;
    this.count += 1;
    return 1;
  }

  samples() {
    const output = [];
    for (let index = 0; index < this.count; index += 1) {
      const at = index * FIELD.STRIDE; const get = field => this.words[at + field];
      output.push({
        frame: get(FIELD.FRAME), row: get(FIELD.ROW),
        rootValue: get(FIELD.ROOT_VALUE), backedValue: get(FIELD.BACKED_VALUE),
        directKill: get(FIELD.DIRECT_KILL),
        counterExposure: get(FIELD.COUNTER_EXPOSURE),
        horizonFatal: get(FIELD.HORIZON_FATAL),
        escapeSlack: get(FIELD.ESCAPE_SLACK),
        ownStars: get(FIELD.OWN_STARS), enemyStars: get(FIELD.ENEMY_STARS),
        enemyFireColumns: get(FIELD.ENEMY_FIRE_COLUMNS),
        enemyFireWorst: get(FIELD.ENEMY_FIRE_WORST),
        enemyFireBest: get(FIELD.ENEMY_FIRE_BEST),
        nonFireRow: get(FIELD.NON_FIRE_ROW),
        nonFireAction: get(FIELD.NON_FIRE_ACTION),
        nonFireBackedValue: get(FIELD.NON_FIRE_BACKED_VALUE),
        nonFireEnemyFireWorst: get(FIELD.NON_FIRE_ENEMY_FIRE_WORST),
        enemyCanAct: get(FIELD.ENEMY_CAN_ACT),
        selectedMatrixWorst: get(FIELD.SELECTED_MATRIX_WORST),
        bestMatrixWorstRow: get(FIELD.BEST_MATRIX_WORST_ROW),
        bestMatrixWorstAction: get(FIELD.BEST_MATRIX_WORST_ACTION),
        bestMatrixWorst: get(FIELD.BEST_MATRIX_WORST),
        bestMatrixWorstBacked: get(FIELD.BEST_MATRIX_WORST_BACKED)
      });
    }
    return output;
  }

  frontierSamples() {
    const output = [];
    for (let index = 0; index < this.frontierCount; index += 1) {
      const at = index * FRONTIER_FIELD.STRIDE;
      const get = field => this.frontierWords[at + field];
      output.push({
        frame: get(FRONTIER_FIELD.FRAME),
        selectedRow: get(FRONTIER_FIELD.SELECTED_ROW),
        selectedAction: get(FRONTIER_FIELD.SELECTED_ACTION),
        selectedWorst: get(FRONTIER_FIELD.SELECTED_WORST),
        selectedBacked: get(FRONTIER_FIELD.SELECTED_BACKED),
        bestRow: get(FRONTIER_FIELD.BEST_ROW),
        bestAction: get(FRONTIER_FIELD.BEST_ACTION),
        bestWorst: get(FRONTIER_FIELD.BEST_WORST),
        bestBacked: get(FRONTIER_FIELD.BEST_BACKED),
        ownStars: get(FRONTIER_FIELD.OWN_STARS),
        enemyStars: get(FRONTIER_FIELD.ENEMY_STARS)
      });
    }
    return output;
  }

  summary() {
    return {
      enabled: true,
      ownershipMode: this.ownershipMode,
      rootAuditCount: this.rootAuditCount,
      worstDominatedSelectionCount: this.worstDominatedSelectionCount,
      terminalBandDominatedSelectionCount:
        this.terminalBandDominatedSelectionCount,
      frontierSampleCount: this.frontierCount,
      frontierOverflowCount: this.frontierOverflowCount,
      selectedFireCount: this.selectedFireCount,
      directCounterTradeCount: this.directCounterTradeCount,
      nonWinningTradeCount: this.nonWinningTradeCount,
      enemyFireMissingCount: this.enemyFireMissingCount,
      enemyFireTerminalLossCount: this.enemyFireTerminalLossCount,
      enemyFireNonterminalCount: this.enemyFireNonterminalCount,
      robustBlendAboveWorstCount: this.robustBlendAboveWorstCount,
      strictlySaferWorstAlternativeCount:
        this.strictlySaferWorstAlternativeCount,
      initiativeCheckCount: this.initiativeCheckCount,
      directInitiativeCount: this.directInitiativeCount,
      unfavorableInitiativeCount: this.unfavorableInitiativeCount,
      favorableInitiativeCount: this.favorableInitiativeCount,
      baseRowMissingCount: this.baseRowMissingCount,
      baseRowUnsafeCount: this.baseRowUnsafeCount,
      baseWorstNotBetterCount: this.baseWorstNotBetterCount,
      ownershipWouldYieldCount: this.ownershipWouldYieldCount,
      ownershipYieldCount: this.ownershipYieldCount,
      successorTradeCheckCount: this.successorTradeCheckCount,
      successorTradeEvidenceCount: this.successorTradeEvidenceCount,
      successorTradeWouldYieldCount: this.successorTradeWouldYieldCount,
      successorTradeYieldCount: this.successorTradeYieldCount,
      successorTradeRegressionBlockedCount:
        this.successorTradeRegressionBlockedCount,
      pairedTerminalCheckCount: this.pairedTerminalCheckCount,
      pairedTerminalDepth: this.pairedTerminalDepth,
      pairedTerminalNodeBudget: this.pairedTerminalNodeBudget,
      pairedTerminalCompleteCount: this.pairedTerminalCompleteCount,
      pairedTerminalRawImprovementCount: this.pairedTerminalRawImprovementCount,
      pairedTerminalBandImprovementCount:
        this.pairedTerminalBandImprovementCount,
      pairedTerminalWouldYieldCount: this.pairedTerminalWouldYieldCount,
      pairedTerminalYieldCount: this.pairedTerminalYieldCount,
      sampleCount: this.count,
      overflowCount: this.overflowCount,
      hotAllocationCount: this.hotAllocationCount,
      samples: this.samples(),
      frontierSamples: this.frontierSamples()
    };
  }
}

module.exports = { EMPTY_VALUE, FIELD, FRONTIER_FIELD, NativeTerminalTradeAudit };
