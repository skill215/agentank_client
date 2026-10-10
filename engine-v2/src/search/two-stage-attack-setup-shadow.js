"use strict";

const { CAPACITY } = require("../generated/fast-config");
const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, SKILL, TERRAIN, FAST_STATUS, HARD_STATUS, TERMINAL,
  NONE_FRAME, NONE_CELL, DX, DY, BOOST_COMPOUND_BASE,
  BOOST_COMPOUND_STRIDE } = require("../abi/fast-codes");
const { OPTION_KIND } = require("../policy/option-portfolio");
const { CombatVectorSlab } = require("./combat-pressure");
const { PAC_STATUS, PAC_CELL, ProjectileAttackClosure } =
  require("./projectile-attack-closure");

const TWO_STAGE_SETUP_STATUS = Object.freeze({
  NONE: 0,
  CERTIFIED: 1,
  INCOMPLETE: 2,
  REJECTED: 3
});

const TWO_STAGE_SETUP_REASON = Object.freeze({
  NONE: 0,
  NOT_SETUP_MOVE: 1 << 0,
  ROOT_SUPPORT: 1 << 1,
  ROOT_TRANSITION: 1 << 2,
  ROOT_HARD: 1 << 3,
  ROOT_TERMINAL: 1 << 4,
  NO_SECOND_FIRE: 1 << 5,
  SECOND_SUPPORT: 1 << 6,
  PAC_INCOMPLETE: 1 << 7,
  UNCONSTRAINED_RESPONSE: 1 << 8,
  NO_HIT_PROGRESS: 1 << 9,
  SECOND_HARD: 1 << 10,
  BUDGET: 1 << 11,
  ROOT_RESTORE: 1 << 12
});

class TwoStageAttackSetupShadow {
  constructor(maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS, nodeBudget = 1024) {
    this.maxActions = maxActions;
    this.nodeBudget = nodeBudget;
    this.status = new Uint8Array(maxActions);
    this.reason = new Uint16Array(maxActions);
    this.rootBranches = new Uint16Array(maxActions);
    this.secondBranches = new Uint16Array(maxActions);
    this.doomedColumns = new Uint16Array(maxActions);
    this.constrainedColumns = new Uint16Array(maxActions);
    this.uncoveredColumns = new Uint16Array(maxActions);
    this.reasonBitCounts = new Uint32Array(13);
    this.enemyActions = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.enemyArguments = new Uint16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.fireActions = new Uint8Array([ACTION.FIRE]);
    this.fireArguments = new Uint16Array([NONE_CELL]);
    this.combat = new CombatVectorSlab(1);
    this.pac = new ProjectileAttackClosure(1, SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.count = 0;
    this.evaluationCount = 0;
    this.certifiedCount = 0;
    this.rejectedCount = 0;
    this.incompleteCount = 0;
    this.nodeCount = 0;
    this.maximumNodes = 0;
    this.rootRestoreFailures = 0;
    this.hotAllocationCount = 0;
    this.currentNodes = 0;
  }

  observeReason(reason) {
    for (let bit = 0; bit < this.reasonBitCounts.length; bit += 1)
      if (reason & (1 << bit)) this.reasonBitCounts[bit] += 1;
  }

  reset(count) {
    this.count = count;
    this.status.fill(TWO_STAGE_SETUP_STATUS.NONE, 0, count);
    this.reason.fill(TWO_STAGE_SETUP_REASON.NONE, 0, count);
    this.rootBranches.fill(0, 0, count);
    this.secondBranches.fill(0, 0, count);
    this.doomedColumns.fill(0, 0, count);
    this.constrainedColumns.fill(0, 0, count);
    this.uncoveredColumns.fill(0, 0, count);
  }

  active(a, id, seat, frame) {
    return a[id][seat] !== NONE_FRAME && a[id][seat] > frame;
  }

  activeProjectile(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 1;
    return 0;
  }

  activeBomb(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot] && a[ARRAY.BOMB_OWNER][slot] === seat) return 1;
    return 0;
  }

  canAct(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.active(a, ARRAY.TANK_FROZEN_UNTIL, seat, frame)) return 0;
    if (this.active(a, ARRAY.TANK_POISON_UNTIL, seat, frame)) {
      const applied = a[ARRAY.TANK_POISON_APPLIED][seat];
      if (applied === NONE_FRAME) return -1;
      if (((frame - applied) & 1) !== 0) return 0;
    }
    return 1;
  }

  canFire(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    return this.canAct(state, seat) > 0 && !this.activeProjectile(state, seat) &&
      (a[ARRAY.TANK_FIRE_LOCK][seat] === NONE_FRAME ||
       a[ARRAY.TANK_FIRE_LOCK][seat] <= frame) ? 1 : 0;
  }

  pushEnemy(action, argument = NONE_CELL) {
    const count = this.enemyCount;
    for (let index = 0; index < count; index += 1)
      if (this.enemyActions[index] === action && this.enemyArguments[index] === argument) return 1;
    if (count >= this.enemyActions.length) return 0;
    this.enemyActions[count] = action; this.enemyArguments[count] = argument;
    this.enemyCount = count + 1; return 1;
  }

  pushTeleportSupport(state) {
    const a = state.arrays; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star === NONE_CELL) return 0;
    let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const x = state.x(star) + DX[direction]; const y = state.y(star) + DY[direction];
      if (x < 0 || x >= state.width || y < 0 || y >= state.height) continue;
      const cell = state.cell(x, y); const terrain = a[ARRAY.TERRAIN][cell];
      if ((terrain === TERRAIN.OPEN || terrain === TERRAIN.GRASS) &&
          cell !== a[ARRAY.TANK_CELL][0] && this.pushEnemy(ACTION.CAST_TELEPORT, cell))
        count += 1;
    }
    return count;
  }

  generateEnemySupport(state) {
    this.enemyCount = 0; this.enemyArguments.fill(NONE_CELL);
    if (!this.pushEnemy(ACTION.NONE)) return 0;
    const actionState = this.canAct(state, 1);
    if (actionState < 0) return 0;
    if (!actionState) return 1;
    if (!this.pushEnemy(ACTION.GO) || !this.pushEnemy(ACTION.TURN_LEFT) ||
        !this.pushEnemy(ACTION.TURN_RIGHT)) return 0;
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.canFire(state, 1) && !this.pushEnemy(ACTION.FIRE)) return 0;
    if (!this.activeBomb(state, 1) && a[ARRAY.TANK_BOMB_READY][1] <= frame &&
        !this.pushEnemy(ACTION.THROW_BOMB)) return 0;
    if (this.active(a, ARRAY.TANK_BOOST_UNTIL, 1, frame))
      for (let pre = 0; pre < 2; pre += 1) {
        const base = BOOST_COMPOUND_BASE + pre * BOOST_COMPOUND_STRIDE;
        if (!this.pushEnemy(base) || !this.pushEnemy(base + 1) ||
            !this.pushEnemy(base + 2) ||
            (!this.activeProjectile(state, 1) && !this.pushEnemy(base + 3)) ||
            (!this.activeBomb(state, 1) && !this.pushEnemy(base + 4))) return 0;
      }
    const skill = a[ARRAY.TANK_SKILL][1];
    if (skill !== SKILL.NONE && a[ARRAY.TANK_SKILL_READY][1] <= frame) {
      if (skill === SKILL.TELEPORT) {
        if (!this.pushTeleportSupport(state)) return 0;
      } else if (!this.pushEnemy(ACTION.CAST_SHIELD + skill - SKILL.SHIELD)) return 0;
    }
    return this.enemyCount;
  }

  classifyPac() {
    if (this.pac.status[0] !== PAC_STATUS.COMPLETE ||
        this.pac.unknownEnemyColumns[0]) return TWO_STAGE_SETUP_REASON.PAC_INCOMPLETE;
    let reason = 0; let doomed = 0; let constrained = 0; let uncovered = 0;
    for (let column = 0; column < this.enemyCount; column += 1) {
      const status = this.pac.cellStatus[column];
      if (status === PAC_CELL.PROVEN_DOOMED) { doomed += 1; continue; }
      if (status === PAC_CELL.SURVIVES &&
          (this.pac.cellSetupDelay[column] || this.pac.cellMobilityLoss[column] ||
           this.pac.cellEndpointReduction[column])) { constrained += 1; continue; }
      uncovered += 1;
    }
    this.lastDoomed = doomed; this.lastConstrained = constrained;
    this.lastUncovered = uncovered;
    if (uncovered) reason |= TWO_STAGE_SETUP_REASON.UNCONSTRAINED_RESPONSE;
    if (!doomed) reason |= TWO_STAGE_SETUP_REASON.NO_HIT_PROGRESS;
    return reason;
  }

  classifySecondHard(bundle) {
    for (let column = 0; column < this.enemyCount; column += 1) {
      const action = this.enemyActions[column]; const argument = this.enemyArguments[column];
      const ownChance = bundle.hard.chanceAlternativeCount(0, ACTION.FIRE);
      const enemyChance = bundle.hard.chanceAlternativeCount(1, action);
      for (let chance1 = 0; chance1 < enemyChance; chance1 += 1)
        for (let chance0 = 0; chance0 < ownChance; chance0 += 1) {
          if (this.currentNodes >= this.nodeBudget) return TWO_STAGE_SETUP_REASON.BUDGET;
          const status = bundle.kernel.applyFrame(ACTION.FIRE, NONE_CELL,
            action, argument, chance0, chance1);
          this.currentNodes += 1; this.lastSecondBranches += 1;
          if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL)
            return TWO_STAGE_SETUP_REASON.SECOND_SUPPORT;
          const mark = bundle.kernel.lastMark;
          const hard = bundle.hard.classifyApplied();
          const terminal = bundle.hard.lastTerminal;
          bundle.state.undoTo(mark);
          if (hard === HARD_STATUS.INCOMPLETE) return TWO_STAGE_SETUP_REASON.SECOND_SUPPORT;
          if (hard !== HARD_STATUS.ALLOW || terminal === TERMINAL.WIN1 ||
              terminal === TERMINAL.DRAW) return TWO_STAGE_SETUP_REASON.SECOND_HARD;
        }
    }
    return 0;
  }

  evaluateCandidate(bundle, row, kind, ourActions, ourArguments,
      rootEnemyActions, rootEnemyArguments, rootEnemyCount) {
    this.evaluationCount += 1;
    const rootAction = ourActions[row];
    if (kind !== OPTION_KIND.ATTACK_SETUP ||
        (rootAction !== ACTION.GO && rootAction !== ACTION.TURN_LEFT &&
         rootAction !== ACTION.TURN_RIGHT)) {
      this.reason[row] = TWO_STAGE_SETUP_REASON.NOT_SETUP_MOVE;
      return 0;
    }
    if (!bundle || !bundle.state || rootEnemyCount < 1 ||
        rootEnemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES) {
      this.reason[row] = TWO_STAGE_SETUP_REASON.ROOT_SUPPORT;
      this.status[row] = TWO_STAGE_SETUP_STATUS.INCOMPLETE;
      this.incompleteCount += 1; return 0;
    }
    const state = bundle.state; const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    this.currentNodes = 0;
    let reason = 0; let incomplete = 0;
    this.lastDoomed = 0; this.lastConstrained = 0; this.lastUncovered = 0;
    this.lastSecondBranches = 0;
    for (let column = 0; column < rootEnemyCount && !reason; column += 1) {
      const enemyAction = rootEnemyActions[column];
      const enemyArgument = rootEnemyArguments ? rootEnemyArguments[column] : NONE_CELL;
      const ownChance = bundle.hard.chanceAlternativeCount(0, rootAction);
      const enemyChance = bundle.hard.chanceAlternativeCount(1, enemyAction);
      for (let chance1 = 0; chance1 < enemyChance && !reason; chance1 += 1)
        for (let chance0 = 0; chance0 < ownChance && !reason; chance0 += 1) {
          if (this.currentNodes >= this.nodeBudget) { reason = TWO_STAGE_SETUP_REASON.BUDGET;
            incomplete = 1; break; }
          const status = bundle.kernel.applyFrame(rootAction,
            ourArguments ? ourArguments[row] : NONE_CELL,
            enemyAction, enemyArgument, chance0, chance1);
          this.currentNodes += 1; this.rootBranches[row] += 1;
          if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
            reason = TWO_STAGE_SETUP_REASON.ROOT_TRANSITION; incomplete = 1; break;
          }
          const branchMark = bundle.kernel.lastMark;
          const hard = bundle.hard.classifyApplied(); const terminal = bundle.hard.lastTerminal;
          if (hard === HARD_STATUS.INCOMPLETE) {
            reason = TWO_STAGE_SETUP_REASON.ROOT_SUPPORT; incomplete = 1;
          } else if (hard !== HARD_STATUS.ALLOW) reason = TWO_STAGE_SETUP_REASON.ROOT_HARD;
          else if (terminal !== TERMINAL.NONE && terminal !== TERMINAL.INCOMPLETE)
            reason = TWO_STAGE_SETUP_REASON.ROOT_TERMINAL;
          else if (!this.canFire(state, 0)) reason = TWO_STAGE_SETUP_REASON.NO_SECOND_FIRE;
          else if (!this.generateEnemySupport(state)) {
            reason = TWO_STAGE_SETUP_REASON.SECOND_SUPPORT; incomplete = 1;
          } else {
            this.combat.reset(1); this.combat.possibleHit[0] = 1;
            this.pac.evaluate(bundle, this.fireActions, this.fireArguments, 1,
              this.enemyActions, this.enemyArguments, this.enemyCount, this.combat);
            const pacReason = this.classifyPac();
            this.doomedColumns[row] += this.lastDoomed;
            this.constrainedColumns[row] += this.lastConstrained;
            this.uncoveredColumns[row] += this.lastUncovered;
            if (pacReason) {
              reason = pacReason;
              if (pacReason & TWO_STAGE_SETUP_REASON.PAC_INCOMPLETE) incomplete = 1;
            } else {
              const hardReason = this.classifySecondHard(bundle);
              if (hardReason) { reason = hardReason;
                if (hardReason === TWO_STAGE_SETUP_REASON.SECOND_SUPPORT ||
                    hardReason === TWO_STAGE_SETUP_REASON.BUDGET) incomplete = 1; }
            }
          }
          state.undoTo(branchMark);
        }
    }
    this.secondBranches[row] = Math.min(0xffff, this.lastSecondBranches);
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== rootMark) {
      state.undoTo(rootMark); reason |= TWO_STAGE_SETUP_REASON.ROOT_RESTORE;
      incomplete = 1; this.rootRestoreFailures += 1;
    }
    this.nodeCount += this.currentNodes;
    if (this.currentNodes > this.maximumNodes) this.maximumNodes = this.currentNodes;
    this.reason[row] = reason;
    this.observeReason(reason);
    if (incomplete) {
      this.status[row] = TWO_STAGE_SETUP_STATUS.INCOMPLETE;
      this.incompleteCount += 1; return 0;
    }
    if (reason) {
      this.status[row] = TWO_STAGE_SETUP_STATUS.REJECTED;
      this.rejectedCount += 1; return 0;
    }
    this.status[row] = TWO_STAGE_SETUP_STATUS.CERTIFIED;
    this.certifiedCount += 1; return 1;
  }

  summary() {
    return { evaluationCount: this.evaluationCount, certifiedCount: this.certifiedCount,
      rejectedCount: this.rejectedCount, incompleteCount: this.incompleteCount,
      nodeCount: this.nodeCount, maximumNodes: this.maximumNodes,
      rootRestoreFailures: this.rootRestoreFailures,
      hotAllocationCount: this.hotAllocationCount + this.pac.hotAllocationCount,
      reasonBitCounts: Array.from(this.reasonBitCounts) };
  }
}

module.exports = { TWO_STAGE_SETUP_STATUS, TWO_STAGE_SETUP_REASON,
  TwoStageAttackSetupShadow };
