"use strict";

// Diagnostic inverse transplant: preserve V2 state, Hard, Risk and committed
// safety, but give frozen V1's complete winningAttackAction contract one final
// opportunity to select TURN/FIRE.  This tests the component boundary, not a
// new FIRE score or a generic alignment bonus.

const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS, TERRAIN, DX, DY, NONE_FRAME } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { HorizonSurvivalSearch } = require("./aim-setup-post-fire-closure-shadow");

const RECORD_STRIDE = 12;

class V1DirectInitiativeTransplantPoc {
  constructor(options = {}) {
    this.depth = Number.isSafeInteger(options.depth) ?
      Math.max(1, Math.min(3, options.depth)) : 2;
    this.nodeBudget = Number.isSafeInteger(options.nodeBudget) ?
      Math.max(32, options.nodeBudget) : 768;
    this.search = new HorizonSurvivalSearch();
    this.words = new Int32Array(64 * RECORD_STRIDE);
    this.recordCount = 0; this.recordOverflowCount = 0;
    this.checkCount = 0; this.ownerSkipCount = 0; this.supportSkipCount = 0;
    this.committedSkipCount = 0; this.resourceSkipCount = 0;
    this.geometrySkipCount = 0; this.distanceSkipCount = 0;
    this.initiativeLostCount = 0; this.tieLeadCount = 0;
    this.noRowCount = 0; this.hardBlockedCount = 0; this.riskBlockedCount = 0;
    this.dominatedBlockedCount = 0; this.safetyProvenCount = 0;
    this.safetyDeadCount = 0; this.safetyUnknownCount = 0;
    this.proposalCount = 0; this.sameActionCount = 0; this.overrideCount = 0;
    this.turnOverrideCount = 0; this.fireOverrideCount = 0;
    this.totalNodes = 0; this.rootRestoreFailureCount = 0;
    this.hotAllocationCount = 0;
  }

  active(until, frame) {
    return until !== NONE_FRAME && until > frame ? 1 : 0;
  }

  supportComplete(engine) {
    return engine?.adapter?.bundle && engine.adapter.enemyVisible &&
      engine.adapter.tracker?.complete && engine.hiddenSupportComplete === 1 &&
      engine.hiddenWorldCount === 1 && engine.hiddenWorldMass[0] === 10000 &&
      engine.enemyCount > 0 && (!engine.possibleProjectiles ||
        engine.possibleProjectiles.count() === 0);
  }

  projectileActive(arrays, owner) {
    for (let slot = 0; slot < arrays[ARRAY.PROJECTILE_ACTIVE].length; slot += 1)
      if (arrays[ARRAY.PROJECTILE_ACTIVE][slot] &&
          arrays[ARRAY.PROJECTILE_OWNER][slot] === owner) return 1;
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
    const a = state.arrays;
    const from = a[ARRAY.TANK_CELL][seat];
    const to = a[ARRAY.TANK_CELL][targetSeat];
    const wanted = this.directionTo(state, from, to);
    if (wanted < 0 || !this.clearLine(state, from, to, wanted)) return 99;
    const delta = (wanted - a[ARRAY.TANK_DIR][seat]) & 3;
    let turns = delta === 3 ? 1 : delta;
    if (delta === 2) turns = 2;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.active(a[ARRAY.TANK_BOOST_UNTIL][seat], frame))
      turns = Math.max(0, turns - 1);
    const distance = Math.abs(state.x(from) - state.x(to)) +
      Math.abs(state.y(from) - state.y(to));
    return turns + ((distance + 1) >> 1);
  }

  rowFor(engine, action) {
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === action) return row;
    return -1;
  }

  capture(engine, frame, incumbent, row, ownFrames, enemyFrames, distance) {
    if (this.recordCount >= 64) { this.recordOverflowCount += 1; return; }
    const outcome = engine.riskController.outcome;
    const at = this.recordCount * RECORD_STRIDE;
    const values = [frame, incumbent, engine.ourActions[row], distance,
      ownFrames, enemyFrames, outcome.immediateFatalMass[row],
      outcome.horizonFatalMass[row], outcome.unknownMass[row],
      outcome.escapeSlack[row], outcome.robustLower[row], outcome.expectedValue[row]];
    for (let index = 0; index < RECORD_STRIDE; index += 1)
      this.words[at + index] = values[index];
    this.recordCount += 1;
  }

  selectOverride(engine, selected, action, argument, context = null, frame = -1) {
    this.checkCount += 1;
    if (engine.lastProofStatus === PROOF_STATUS.PROVEN ||
        engine.lastSelectionWasStrictRescue || engine.lastSelectionWasVerifiedDirectKill) {
      this.ownerSkipCount += 1; return null;
    }
    if (!this.supportComplete(engine)) { this.supportSkipCount += 1; return null; }
    const escape = engine.escapeObligation;
    if (escape && escape.committedEntityCount > 0) {
      this.committedSkipCount += 1; return null;
    }
    const state = engine.adapter.state; const a = state.arrays;
    const now = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.projectileActive(a, 0) || this.active(a[ARRAY.TANK_FIRE_LOCK][0], now) ||
        (this.active(a[ARRAY.TANK_SHIELD_UNTIL][1], now) &&
          a[ARRAY.TANK_SHIELD_HITS][1] > 0)) {
      this.resourceSkipCount += 1; return null;
    }
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const distance = Math.abs(state.x(own) - state.x(enemy)) +
      Math.abs(state.y(own) - state.y(enemy));
    if (distance > 6) { this.distanceSkipCount += 1; return null; }
    const wanted = this.directionTo(state, own, enemy);
    if (wanted < 0 || !this.clearLine(state, own, enemy, wanted)) {
      this.geometrySkipCount += 1; return null;
    }
    const enemyCanFire = !this.active(a[ARRAY.TANK_FIRE_LOCK][1], now) &&
      !this.projectileActive(a, 1);
    const ownShield = this.active(a[ARRAY.TANK_SHIELD_UNTIL][0], now) &&
      a[ARRAY.TANK_SHIELD_HITS][0] > 0;
    const ownFrames = this.arrivalFrames(state, 0, 1, 1, 0);
    const enemyFrames = this.arrivalFrames(state, 1, 0, enemyCanFire, ownShield);
    const ownStars = a[ARRAY.TANK_STARS][0]; const enemyStars = a[ARRAY.TANK_STARS][1];
    const favorableTie = ownFrames === enemyFrames && ownStars > enemyStars;
    if (favorableTie) this.tieLeadCount += 1;
    if (ownFrames >= 99 || ownFrames > enemyFrames ||
        (ownFrames === enemyFrames && !favorableTie)) {
      this.initiativeLostCount += 1; return null;
    }
    let proposed = ACTION.FIRE;
    const currentDirection = a[ARRAY.TANK_DIR][0];
    if (wanted !== currentDirection) {
      const delta = (wanted - currentDirection) & 3;
      proposed = delta === 3 ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
    }
    const row = this.rowFor(engine, proposed);
    if (row < 0) { this.noRowCount += 1; return null; }
    if (engine.hardStatus[row] !== HARD_STATUS.ALLOW) {
      this.hardBlockedCount += 1; return null;
    }
    const outcome = engine.riskController?.outcome;
    if (!outcome || row >= outcome.count || !outcome.acceptable[row]) {
      this.riskBlockedCount += 1; return null;
    }
    if (outcome.dominated[row]) { this.dominatedBlockedCount += 1; return null; }
    const proof = this.search.searchExact(engine.adapter.bundle, proposed,
      engine.ourArguments[row], engine.enemyActions, engine.enemyArguments,
      engine.enemyCount, this.depth, this.nodeBudget);
    this.totalNodes += this.search.nodes;
    this.rootRestoreFailureCount += this.search.rootRestoreFailures;
    if (proof === PROOF_STATUS.PROVEN) this.safetyProvenCount += 1;
    else if (proof === PROOF_STATUS.DISPROVEN) this.safetyDeadCount += 1;
    else this.safetyUnknownCount += 1;
    if (proof !== PROOF_STATUS.PROVEN) return null;
    this.proposalCount += 1;
    if (proposed === action) { this.sameActionCount += 1; return null; }
    this.overrideCount += 1;
    if (proposed === ACTION.FIRE) this.fireOverrideCount += 1;
    else this.turnOverrideCount += 1;
    this.capture(engine, frame, action, row, ownFrames, enemyFrames, distance);
    return { action: proposed, argument: engine.ourArguments[row] };
  }

  records() {
    const output = [];
    for (let record = 0; record < this.recordCount; record += 1) {
      const at = record * RECORD_STRIDE;
      output.push({ frame: this.words[at], incumbentAction: this.words[at + 1],
        proposalAction: this.words[at + 2], distance: this.words[at + 3],
        ownArrival: this.words[at + 4], enemyArrival: this.words[at + 5],
        immediateFatal: this.words[at + 6], horizonFatal: this.words[at + 7],
        unknownMass: this.words[at + 8], escapeSlack: this.words[at + 9],
        robustLower: this.words[at + 10], expectedValue: this.words[at + 11] });
    }
    return output;
  }

  summary() {
    return { enabled: true, depth: this.depth, nodeBudget: this.nodeBudget,
      checkCount: this.checkCount, ownerSkipCount: this.ownerSkipCount,
      supportSkipCount: this.supportSkipCount,
      committedSkipCount: this.committedSkipCount,
      resourceSkipCount: this.resourceSkipCount,
      geometrySkipCount: this.geometrySkipCount,
      distanceSkipCount: this.distanceSkipCount,
      initiativeLostCount: this.initiativeLostCount, tieLeadCount: this.tieLeadCount,
      noRowCount: this.noRowCount, hardBlockedCount: this.hardBlockedCount,
      riskBlockedCount: this.riskBlockedCount,
      dominatedBlockedCount: this.dominatedBlockedCount,
      safetyProvenCount: this.safetyProvenCount,
      safetyDeadCount: this.safetyDeadCount,
      safetyUnknownCount: this.safetyUnknownCount,
      proposalCount: this.proposalCount, sameActionCount: this.sameActionCount,
      overrideCount: this.overrideCount, turnOverrideCount: this.turnOverrideCount,
      fireOverrideCount: this.fireOverrideCount, totalNodes: this.totalNodes,
      rootRestoreFailureCount: this.rootRestoreFailureCount,
      recordOverflowCount: this.recordOverflowCount,
      hotAllocationCount: this.hotAllocationCount + this.search.hotAllocationCount,
      records: this.records() };
  }
}

module.exports = { V1DirectInitiativeTransplantPoc };
