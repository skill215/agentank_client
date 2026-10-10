"use strict";

// Diagnostic-only action owner. It tests the narrow claim that an already
// aligned, visible, clear ray should be fired when the incumbent is only
// GO/TURN and FIRE is physically/risk admissible with an exact depth-2
// survival continuation. It never owns skill, bomb, Proof, or committed rescue.

const { ARRAY } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS, TERRAIN, DX, DY } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { HorizonSurvivalSearch } = require("./aim-setup-post-fire-closure-shadow");

const RECORD_STRIDE = 10;

class DirectClearSafeFirePoc {
  constructor(options = {}) {
    this.depth = Number.isSafeInteger(options.depth) ? Math.max(1, Math.min(3, options.depth)) : 2;
    this.nodeBudget = Number.isSafeInteger(options.nodeBudget) ?
      Math.max(32, options.nodeBudget) : 768;
    this.search = new HorizonSurvivalSearch(); this.words = new Int32Array(32 * RECORD_STRIDE);
    this.recordCount = 0; this.recordOverflowCount = 0;
    this.checkCount = 0; this.actionClassSkipCount = 0; this.proofOwnerSkipCount = 0;
    this.supportSkipCount = 0; this.geometrySkipCount = 0; this.noFireRowCount = 0;
    this.hardBlockedCount = 0; this.riskBlockedCount = 0;
    this.safetyProvenCount = 0; this.safetyDeadCount = 0; this.safetyUnknownCount = 0;
    this.overrideCount = 0; this.totalNodes = 0; this.rootRestoreFailureCount = 0;
    this.hotAllocationCount = 0;
  }

  supportComplete(engine) {
    return engine?.adapter?.bundle && engine.adapter.enemyVisible &&
      engine.adapter.tracker?.complete && engine.hiddenSupportComplete === 1 &&
      engine.hiddenWorldCount === 1 && engine.hiddenWorldMass[0] === 10000 &&
      engine.enemyCount > 0 && (!engine.possibleProjectiles ||
        engine.possibleProjectiles.count() === 0);
  }

  clearAligned(engine) {
    const state = engine.adapter.state; const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    let x = state.x(own); let y = state.y(own); const direction = a[ARRAY.TANK_DIR][0];
    const ex = state.x(enemy); const ey = state.y(enemy);
    if ((direction === 0 || direction === 2) ? x !== ex : y !== ey) return 0;
    if (direction === 0 && ey >= y || direction === 1 && ex <= x ||
        direction === 2 && ey <= y || direction === 3 && ex >= x) return 0;
    x += DX[direction]; y += DY[direction];
    while (x >= 0 && x < state.width && y >= 0 && y < state.height) {
      if (x === ex && y === ey) return 1;
      const terrain = a[ARRAY.TERRAIN][state.cell(x, y)];
      if (terrain === TERRAIN.WALL || terrain === TERRAIN.DIRT) return 0;
      x += DX[direction]; y += DY[direction];
    }
    return 0;
  }

  fireRow(engine) {
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === ACTION.FIRE) return row;
    return -1;
  }

  capture(engine, frame, selected, fireRow) {
    if (this.recordCount >= 32) { this.recordOverflowCount += 1; return; }
    const outcome = engine.riskController.outcome; const state = engine.adapter.state;
    const own = state.arrays[ARRAY.TANK_CELL][0]; const enemy = state.arrays[ARRAY.TANK_CELL][1];
    const at = this.recordCount * RECORD_STRIDE;
    const values = [frame, engine.ourActions[selected], fireRow,
      Math.abs(state.x(own) - state.x(enemy)) + Math.abs(state.y(own) - state.y(enemy)),
      outcome.immediateFatalMass[fireRow], outcome.horizonFatalMass[fireRow],
      outcome.unknownMass[fireRow], outcome.escapeSlack[fireRow],
      outcome.robustLower[fireRow], outcome.expectedValue[fireRow]];
    for (let index = 0; index < RECORD_STRIDE; index += 1) this.words[at + index] = values[index];
    this.recordCount += 1;
  }

  selectOverride(engine, selected, action, argument, frame = -1) {
    this.checkCount += 1;
    if (action !== ACTION.GO && action !== ACTION.TURN_LEFT && action !== ACTION.TURN_RIGHT) {
      this.actionClassSkipCount += 1; return null;
    }
    if (engine.lastProofStatus === PROOF_STATUS.PROVEN ||
        engine.lastSelectionWasStrictRescue || engine.lastSelectionWasVerifiedDirectKill) {
      this.proofOwnerSkipCount += 1; return null;
    }
    if (!this.supportComplete(engine)) { this.supportSkipCount += 1; return null; }
    if (!this.clearAligned(engine)) { this.geometrySkipCount += 1; return null; }
    const row = this.fireRow(engine);
    if (row < 0) { this.noFireRowCount += 1; return null; }
    if (engine.hardStatus[row] !== HARD_STATUS.ALLOW) {
      this.hardBlockedCount += 1; return null;
    }
    const outcome = engine.riskController?.outcome;
    if (!outcome || row >= outcome.count || !outcome.acceptable[row]) {
      this.riskBlockedCount += 1; return null;
    }
    const proof = this.search.searchExact(engine.adapter.bundle, ACTION.FIRE,
      engine.ourArguments[row], engine.enemyActions, engine.enemyArguments,
      engine.enemyCount, this.depth, this.nodeBudget);
    this.totalNodes += this.search.nodes;
    this.rootRestoreFailureCount += this.search.rootRestoreFailures;
    if (proof === PROOF_STATUS.PROVEN) this.safetyProvenCount += 1;
    else if (proof === PROOF_STATUS.DISPROVEN) this.safetyDeadCount += 1;
    else this.safetyUnknownCount += 1;
    if (proof !== PROOF_STATUS.PROVEN) return null;
    this.overrideCount += 1; this.capture(engine, frame, selected, row);
    return { action: ACTION.FIRE, argument: engine.ourArguments[row] };
  }

  records() {
    const output = [];
    for (let record = 0; record < this.recordCount; record += 1) {
      const at = record * RECORD_STRIDE;
      output.push({ frame: this.words[at], incumbentAction: this.words[at + 1],
        fireRow: this.words[at + 2], distance: this.words[at + 3],
        immediateFatal: this.words[at + 4], horizonFatal: this.words[at + 5],
        unknownMass: this.words[at + 6], escapeSlack: this.words[at + 7],
        robustLower: this.words[at + 8], expectedValue: this.words[at + 9] });
    }
    return output;
  }

  summary() {
    return { enabled: true, depth: this.depth, nodeBudget: this.nodeBudget,
      checkCount: this.checkCount, actionClassSkipCount: this.actionClassSkipCount,
      proofOwnerSkipCount: this.proofOwnerSkipCount, supportSkipCount: this.supportSkipCount,
      geometrySkipCount: this.geometrySkipCount, noFireRowCount: this.noFireRowCount,
      hardBlockedCount: this.hardBlockedCount, riskBlockedCount: this.riskBlockedCount,
      safetyProvenCount: this.safetyProvenCount, safetyDeadCount: this.safetyDeadCount,
      safetyUnknownCount: this.safetyUnknownCount, overrideCount: this.overrideCount,
      totalNodes: this.totalNodes, rootRestoreFailureCount: this.rootRestoreFailureCount,
      recordOverflowCount: this.recordOverflowCount, hotAllocationCount: this.hotAllocationCount +
        this.search.hotAllocationCount, records: this.records() };
  }
}

module.exports = { DirectClearSafeFirePoc };
