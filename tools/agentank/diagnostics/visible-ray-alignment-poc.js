"use strict";

// Diagnostic-only navigation owner for the empirically dominant V1 entry path:
// visible same-axis enemy, clear terrain ray, wrong facing -> correct turn.

const { ARRAY } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS, TERRAIN, DX, DY } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { HorizonSurvivalSearch } = require("./aim-setup-post-fire-closure-shadow");

class VisibleRayAlignmentPoc {
  constructor(options = {}) {
    this.depth = Number.isSafeInteger(options.depth) ? Math.max(1, Math.min(3, options.depth)) : 2;
    this.nodeBudget = Number.isSafeInteger(options.nodeBudget) ?
      Math.max(32, options.nodeBudget) : 768;
    this.search = new HorizonSurvivalSearch(); this.words = new Int32Array(32 * 8);
    this.recordCount = 0; this.checkCount = 0; this.actionClassSkipCount = 0;
    this.ownerSkipCount = 0; this.supportSkipCount = 0; this.geometrySkipCount = 0;
    this.sameActionCount = 0; this.noTurnRowCount = 0; this.hardBlockedCount = 0;
    this.riskBlockedCount = 0; this.dominatedBlockedCount = 0;
    this.safetyProvenCount = 0; this.safetyDeadCount = 0; this.safetyUnknownCount = 0;
    this.overrideCount = 0; this.totalNodes = 0; this.rootRestoreFailureCount = 0;
    this.recordOverflowCount = 0; this.hotAllocationCount = 0;
  }
  supportComplete(engine) {
    return engine?.adapter?.bundle && engine.adapter.enemyVisible &&
      engine.adapter.tracker?.complete && engine.hiddenSupportComplete === 1 &&
      engine.hiddenWorldCount === 1 && engine.hiddenWorldMass[0] === 10000 &&
      engine.enemyCount > 0 && (!engine.possibleProjectiles ||
        engine.possibleProjectiles.count() === 0);
  }
  targetDirection(engine) {
    const state = engine.adapter.state; const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const x = state.x(own); const y = state.y(own);
    const ex = state.x(enemy); const ey = state.y(enemy);
    let wanted = -1;
    if (x === ex) wanted = ey < y ? 0 : ey > y ? 2 : -1;
    else if (y === ey) wanted = ex > x ? 1 : 3;
    if (wanted < 0 || wanted === a[ARRAY.TANK_DIR][0]) return -1;
    let rx = x + DX[wanted]; let ry = y + DY[wanted];
    while (rx >= 0 && rx < state.width && ry >= 0 && ry < state.height) {
      if (rx === ex && ry === ey) return wanted;
      const terrain = a[ARRAY.TERRAIN][state.cell(rx, ry)];
      if (terrain === TERRAIN.WALL || terrain === TERRAIN.DIRT) return -1;
      rx += DX[wanted]; ry += DY[wanted];
    }
    return -1;
  }
  turnFor(engine, wanted, incumbent) {
    const current = engine.adapter.state.arrays[ARRAY.TANK_DIR][0];
    const delta = (wanted - current) & 3;
    if (delta === 1) return ACTION.TURN_RIGHT;
    if (delta === 3) return ACTION.TURN_LEFT;
    if (delta === 2 && (incumbent === ACTION.TURN_LEFT || incumbent === ACTION.TURN_RIGHT))
      return incumbent;
    return ACTION.TURN_RIGHT;
  }
  rowFor(engine, action) {
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === action) return row;
    return -1;
  }
  capture(engine, frame, incumbent, row) {
    if (this.recordCount >= 32) { this.recordOverflowCount += 1; return; }
    const state = engine.adapter.state; const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const outcome = engine.riskController.outcome; const at = this.recordCount * 8;
    const values = [frame, incumbent, engine.ourActions[row],
      Math.abs(state.x(own) - state.x(enemy)) + Math.abs(state.y(own) - state.y(enemy)),
      outcome.horizonFatalMass[row], outcome.unknownMass[row],
      outcome.robustLower[row], outcome.expectedValue[row]];
    for (let index = 0; index < 8; index += 1) this.words[at + index] = values[index];
    this.recordCount += 1;
  }
  selectOverride(engine, selected, action, argument, frame = -1) {
    this.checkCount += 1;
    if (action !== ACTION.GO && action !== ACTION.TURN_LEFT && action !== ACTION.TURN_RIGHT) {
      this.actionClassSkipCount += 1; return null;
    }
    if (engine.lastProofStatus === PROOF_STATUS.PROVEN ||
        engine.lastSelectionWasStrictRescue || engine.lastSelectionWasVerifiedDirectKill) {
      this.ownerSkipCount += 1; return null;
    }
    if (!this.supportComplete(engine)) { this.supportSkipCount += 1; return null; }
    const wanted = this.targetDirection(engine);
    if (wanted < 0) { this.geometrySkipCount += 1; return null; }
    const turn = this.turnFor(engine, wanted, action);
    if (turn === action) { this.sameActionCount += 1; return null; }
    const row = this.rowFor(engine, turn);
    if (row < 0) { this.noTurnRowCount += 1; return null; }
    if (engine.hardStatus[row] !== HARD_STATUS.ALLOW) {
      this.hardBlockedCount += 1; return null;
    }
    const outcome = engine.riskController?.outcome;
    if (!outcome || row >= outcome.count || !outcome.acceptable[row]) {
      this.riskBlockedCount += 1; return null;
    }
    if (outcome.dominated[row]) { this.dominatedBlockedCount += 1; return null; }
    const proof = this.search.searchExact(engine.adapter.bundle, turn,
      engine.ourArguments[row], engine.enemyActions, engine.enemyArguments,
      engine.enemyCount, this.depth, this.nodeBudget);
    this.totalNodes += this.search.nodes;
    this.rootRestoreFailureCount += this.search.rootRestoreFailures;
    if (proof === PROOF_STATUS.PROVEN) this.safetyProvenCount += 1;
    else if (proof === PROOF_STATUS.DISPROVEN) this.safetyDeadCount += 1;
    else this.safetyUnknownCount += 1;
    if (proof !== PROOF_STATUS.PROVEN) return null;
    this.overrideCount += 1; this.capture(engine, frame, action, row);
    return { action: turn, argument: engine.ourArguments[row] };
  }
  records() {
    const output = [];
    for (let record = 0; record < this.recordCount; record += 1) {
      const at = record * 8;
      output.push({ frame: this.words[at], incumbentAction: this.words[at + 1],
        turnAction: this.words[at + 2], distance: this.words[at + 3],
        horizonFatal: this.words[at + 4], unknownMass: this.words[at + 5],
        robustLower: this.words[at + 6], expectedValue: this.words[at + 7] });
    }
    return output;
  }
  summary() {
    return { enabled: true, depth: this.depth, nodeBudget: this.nodeBudget,
      checkCount: this.checkCount, actionClassSkipCount: this.actionClassSkipCount,
      ownerSkipCount: this.ownerSkipCount, supportSkipCount: this.supportSkipCount,
      geometrySkipCount: this.geometrySkipCount, sameActionCount: this.sameActionCount,
      noTurnRowCount: this.noTurnRowCount, hardBlockedCount: this.hardBlockedCount,
      riskBlockedCount: this.riskBlockedCount, dominatedBlockedCount: this.dominatedBlockedCount,
      safetyProvenCount: this.safetyProvenCount, safetyDeadCount: this.safetyDeadCount,
      safetyUnknownCount: this.safetyUnknownCount, overrideCount: this.overrideCount,
      totalNodes: this.totalNodes, rootRestoreFailureCount: this.rootRestoreFailureCount,
      recordOverflowCount: this.recordOverflowCount, hotAllocationCount: this.hotAllocationCount +
        this.search.hotAllocationCount, records: this.records() };
  }
}

module.exports = { VisibleRayAlignmentPoc };
