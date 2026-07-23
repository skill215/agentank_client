"use strict";

const { CAPACITY } = require("../generated/fast-config");
const { ACTION, TERRAIN, NONE_CELL, NONE_FRAME } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");

const DEADLINE_PROOF = Object.freeze({
  INCOMPLETE: 0,
  ESCAPE_EXISTS: 1,
  TRAPPED: 2
});

// Per-successor committed closure status for Escape membership and quality.
// It is independent of Safety probability mass.
const SUCCESSOR_PROOF = Object.freeze({
  PROVEN_DEAD: 0,
  UNKNOWN: 1,
  PROVEN_VIABLE: 2
});

const MOVE_ACTIONS = [ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT];

// DeadlineKernel solves committed bomb/projectile escape deadlines using the
// same HOLD/turn/GO parity rules as HazardKernel.reverseViable. It never
// upgrades possible/hidden threats to Hard facts.
class DeadlineKernel {
  constructor() {
    const cells = CAPACITY.MAX_CELLS;
    this.viableA = new Uint8Array(cells * 4);
    this.viableB = new Uint8Array(cells * 4);
    this.viableTick1 = new Uint8Array(cells * 4);
    this.viableTick2 = new Uint8Array(cells * 4);
    this.actionEscape = new Uint8Array(ACTION.CAST_BOOST + 1);
    this.deadlineTick = 0;
    this.earliestArrival = 255;
    this.slack = -128;
    this.rootViable = 0;
    this.proofStatus = DEADLINE_PROOF.INCOMPLETE;
    this.firstActionCodeCount = 0;
    this.moveEscapeCount = 0;
    this.holdEscapeCount = 0;
    this.solveCount = 0;
    this.hotAllocationCount = 0;
    this.lastCoverageComplete = 0;
  }

  reset() {
    this.deadlineTick = 0; this.earliestArrival = 255; this.slack = -128;
    this.rootViable = 0; this.proofStatus = DEADLINE_PROOF.INCOMPLETE;
    this.firstActionCodeCount = 0; this.moveEscapeCount = 0; this.holdEscapeCount = 0;
    this.lastCoverageComplete = 0;
    this.actionEscape.fill(0);
  }

  walkable(state, cell) {
    if (cell === NONE_CELL) return 0;
    const terrain = state.arrays[ARRAY.TERRAIN][cell];
    return terrain !== TERRAIN.WALL && terrain !== TERRAIN.DIRT ? 1 : 0;
  }

  target(hazard, cell, direction) {
    return hazard.target(cell, direction);
  }

  successor(hazard, state, cell, direction, action) {
    if (action === ACTION.GO) {
      const forward = this.target(hazard, cell, direction);
      if (!this.walkable(state, forward)) return null;
      return { cell: forward, direction };
    }
    if (action === ACTION.TURN_LEFT)
      return { cell, direction: (direction + 3) & 3 };
    if (action === ACTION.TURN_RIGHT)
      return { cell, direction: (direction + 1) & 3 };
    return { cell, direction };
  }

  buildReverse(hazard) {
    const state = hazard.state; const a = state.arrays; const cells = state.cells;
    let next = this.viableA; let current = this.viableB; next.fill(0); current.fill(0);
    this.viableTick1.fill(0);
    this.viableTick2.fill(0);
    for (let cell = 0; cell < cells; cell += 1) if (this.walkable(state, cell) &&
        !hazard.isLethal(hazard.horizonTick, cell))
      for (let direction = 0; direction < 4; direction += 1) next[cell * 4 + direction] = 1;
    if (hazard.horizonTick === 1) this.viableTick1.set(next.subarray(0, cells * 4));
    if (hazard.horizonTick === 2) this.viableTick2.set(next.subarray(0, cells * 4));
    if (hazard.horizonTick < 1) {
      this.viableTick1.set(next.subarray(0, cells * 4));
      this.viableTick2.set(next.subarray(0, cells * 4));
    }
    for (let tick = hazard.horizonTick - 1; tick >= 0; tick -= 1) {
      current.fill(0);
      for (let cell = 0; cell < cells; cell += 1) if (this.walkable(state, cell) &&
          !hazard.isLethal(tick, cell)) {
        for (let direction = 0; direction < 4; direction += 1) {
          let viable = next[cell * 4 + direction];
          if ((tick & 1) === 0) {
            viable = viable || next[cell * 4 + ((direction + 1) & 3)] ||
              next[cell * 4 + ((direction + 3) & 3)];
            const forward = this.target(hazard, cell, direction);
            if (!viable && forward !== NONE_CELL && this.walkable(state, forward) &&
                !hazard.isLethal(tick + 1, forward) && next[forward * 4 + direction]) viable = 1;
          }
          if (viable) current[cell * 4 + direction] = 1;
        }
      }
      if (tick === 1) this.viableTick1.set(current.subarray(0, cells * 4));
      if (tick === 2) this.viableTick2.set(current.subarray(0, cells * 4));
      const swap = next; next = current; current = swap;
    }
    return next;
  }

  poseViable(layer, cell, direction) {
    if (cell === NONE_CELL) return 0;
    return layer[cell * 4 + direction] ? 1 : 0;
  }

  markAction(action) {
    if (action < 0 || action >= this.actionEscape.length) return;
    if (!this.actionEscape[action]) {
      this.actionEscape[action] = 1;
      this.firstActionCodeCount += 1;
    }
  }

  enemyAdjacent(state, cell, perspectiveSeat) {
    if (cell === NONE_CELL) return 0;
    const a = state.arrays;
    const x = state.x(cell); const y = state.y(cell);
    for (let seat = 0; seat < a[ARRAY.TANK_CELL].length; seat += 1) {
      if (seat === perspectiveSeat) continue;
      const other = a[ARRAY.TANK_CELL][seat];
      if (other === NONE_CELL || a[ARRAY.TANK_CRASH][seat]) continue;
      const dist = Math.abs(x - state.x(other)) + Math.abs(y - state.y(other));
      if (dist <= 1) return 1;
    }
    return 0;
  }

  earliestHitTick(hazard, cell) {
    if (cell === NONE_CELL || hazard.horizonTick < 1) return NONE_FRAME;
    for (let tick = 1; tick <= hazard.horizonTick; tick += 1)
      if (hazard.isLethal(tick, cell)) return tick;
    return NONE_FRAME;
  }

  // True when a committed bomb footprint still covers the cell, or a hostile
  // projectile hit-timeline already marks it lethal. Boolean only — no soft tiers.
  stillExposedAtDeadline(bundle, cell) {
    if (cell === NONE_CELL || !bundle || !bundle.hazard) return 0;
    const hazard = bundle.hazard; const state = bundle.state; const a = state.arrays;
    for (let slot = 0; slot < a[ARRAY.BOMB_ACTIVE].length; slot += 1) {
      if (!a[ARRAY.BOMB_ACTIVE][slot]) continue;
      if (hazard.bombHits(a[ARRAY.BOMB_CELL][slot], cell)) return 1;
    }
    if (this.earliestHitTick(hazard, cell) !== NONE_FRAME) return 1;
    return 0;
  }

  coverageComplete(hazard) {
    return hazard && hazard.complete && hazard.narrowProofComplete ? 1 : 0;
  }

  countViableNextActions(hazard, state, cell, direction) {
    let count = 0;
    const tick2Lethal = hazard.horizonTick >= 2;
    for (let index = 0; index < MOVE_ACTIONS.length; index += 1) {
      const next = this.successor(hazard, state, cell, direction, MOVE_ACTIONS[index]);
      if (!next) continue;
      if (tick2Lethal && hazard.isLethal(2, next.cell)) continue;
      if (!this.poseViable(this.viableTick2, next.cell, next.direction)) continue;
      count += 1;
    }
    return count;
  }

  // Evaluate escape quality of an already-reached successor pose. Call after solve().
  evaluateSuccessor(bundle, cell, direction) {
    const empty = {
      proofStatus: SUCCESSOR_PROOF.PROVEN_DEAD,
      stillExposedAtDeadline: 0,
      slack: -128,
      viableNextActionCount: 0,
      coverageComplete: 0
    };
    if (!bundle || !bundle.hazard || cell === NONE_CELL) return empty;
    const hazard = bundle.hazard; const state = hazard.state;
    const coverage = this.coverageComplete(hazard);
    this.lastCoverageComplete = coverage;
    if (!this.walkable(state, cell))
      return { proofStatus: SUCCESSOR_PROOF.PROVEN_DEAD, stillExposedAtDeadline: 0,
        slack: -128, viableNextActionCount: 0, coverageComplete: coverage };
    if (hazard.horizonTick >= 1 && hazard.isLethal(1, cell))
      return { proofStatus: SUCCESSOR_PROOF.PROVEN_DEAD, stillExposedAtDeadline: 1,
        slack: -128, viableNextActionCount: 0, coverageComplete: coverage };
    const tick1Viable = this.poseViable(this.viableTick1, cell, direction);
    let proofStatus = SUCCESSOR_PROOF.PROVEN_DEAD;
    if (tick1Viable) {
      proofStatus = coverage ? SUCCESSOR_PROOF.PROVEN_VIABLE : SUCCESSOR_PROOF.UNKNOWN;
    } else if (!coverage) {
      proofStatus = SUCCESSOR_PROOF.UNKNOWN;
    }
    const exposed = this.stillExposedAtDeadline(bundle, cell);
    const arrival = tick1Viable || proofStatus === SUCCESSOR_PROOF.UNKNOWN ? 1 : 255;
    const slack = arrival === 255 ? -128 :
      Math.max(-128, Math.min(127, this.deadlineTick - arrival));
    const branches = proofStatus === SUCCESSOR_PROOF.PROVEN_DEAD ? 0 :
      this.countViableNextActions(hazard, state, cell, direction);
    return {
      proofStatus,
      stillExposedAtDeadline: exposed,
      slack,
      viableNextActionCount: branches,
      coverageComplete: coverage
    };
  }

  // Fill parallel per-row successor quality arrays for EscapeObligation / Risk.
  evaluateSuccessorActions(bundle, actions, count, out) {
    if (!out || count < 1) return 0;
    const proof = out.proofStatus; const exposed = out.stillExposedAtDeadline;
    const slack = out.slack; const branches = out.viableNextActionCount;
    const coverage = out.coverageComplete;
    if (!bundle || !bundle.hazard || !bundle.state) {
      for (let row = 0; row < count; row += 1) {
        if (proof) proof[row] = SUCCESSOR_PROOF.PROVEN_DEAD;
        if (exposed) exposed[row] = 0;
        if (slack) slack[row] = -128;
        if (branches) branches[row] = 0;
        if (coverage) coverage[row] = 0;
      }
      return 0;
    }
    const hazard = bundle.hazard; const state = bundle.state;
    const a = state.arrays;
    const rootCell = a[ARRAY.TANK_CELL][0];
    const rootDirection = a[ARRAY.TANK_DIR][0];
    let filled = 0;
    for (let row = 0; row < count; row += 1) {
      const next = this.successor(hazard, state, rootCell, rootDirection, actions[row]);
      const quality = next ? this.evaluateSuccessor(bundle, next.cell, next.direction) :
        this.evaluateSuccessor(bundle, NONE_CELL, 0);
      if (proof) proof[row] = quality.proofStatus;
      if (exposed) exposed[row] = quality.stillExposedAtDeadline;
      if (slack) slack[row] = quality.slack;
      if (branches) branches[row] = quality.viableNextActionCount;
      if (coverage) coverage[row] = quality.coverageComplete;
      filled += 1;
    }
    return filled;
  }

  solve(bundle, perspectiveSeat = 0) {
    this.reset(); this.solveCount += 1;
    if (!bundle || !bundle.hazard) return this;
    const hazard = bundle.hazard; const state = hazard.state;
    if (!hazard.rebuild(perspectiveSeat)) {
      this.proofStatus = DEADLINE_PROOF.INCOMPLETE; return this;
    }
    this.deadlineTick = hazard.horizonTick;
    this.lastCoverageComplete = this.coverageComplete(hazard);
    const a = state.arrays;
    const rootCell = a[ARRAY.TANK_CELL][perspectiveSeat];
    const rootDirection = a[ARRAY.TANK_DIR][perspectiveSeat];
    const tick0 = this.buildReverse(hazard);
    this.rootViable = this.poseViable(tick0, rootCell, rootDirection);

    const candidates = [
      ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT, ACTION.NONE, ACTION.FIRE,
      ACTION.THROW_BOMB, ACTION.CAST_POISON
    ];
    for (let index = 0; index < candidates.length; index += 1) {
      const action = candidates[index];
      const next = this.successor(hazard, state, rootCell, rootDirection, action);
      if (!next) continue;
      if (hazard.horizonTick >= 1 && hazard.isLethal(1, next.cell)) continue;
      if (!this.poseViable(this.viableTick1, next.cell, next.direction)) continue;
      this.markAction(action);
      if (action === ACTION.GO || action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT)
        this.moveEscapeCount += 1;
      else this.holdEscapeCount += 1;
    }

    this.earliestArrival = this.rootViable ? 0 : this.moveEscapeCount || this.holdEscapeCount ?
      1 : 255;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    let bombDeadline = NONE_FRAME;
    for (let slot = 0; slot < a[ARRAY.BOMB_ACTIVE].length; slot += 1) {
      if (!a[ARRAY.BOMB_ACTIVE][slot]) continue;
      const explode = a[ARRAY.BOMB_EXPLODE][slot];
      if (explode === NONE_FRAME) continue;
      const tick = Math.max(0, explode - frame);
      if (bombDeadline === NONE_FRAME || tick < bombDeadline) bombDeadline = tick;
    }
    // Hostile projectile hit on the stay cell, converted to frames for slack.
    const hitTick = this.earliestHitTick(hazard, rootCell);
    const projectileDeadline = hitTick === NONE_FRAME ? NONE_FRAME :
      Math.max(0, Math.ceil(hitTick / Math.max(1, hazard.stepsPerFrame)));
    let deadline = bombDeadline === NONE_FRAME ? this.deadlineTick : bombDeadline;
    if (projectileDeadline !== NONE_FRAME) {
      if (bombDeadline === NONE_FRAME) deadline = projectileDeadline;
      else if (projectileDeadline < deadline) deadline = projectileDeadline;
    }
    this.deadlineTick = deadline;
    this.slack = this.earliestArrival === 255 ? -128 :
      Math.max(-128, Math.min(127, deadline - this.earliestArrival));
    if (!hazard.complete || !hazard.narrowProofComplete)
      this.proofStatus = DEADLINE_PROOF.INCOMPLETE;
    else if (this.rootViable || this.firstActionCodeCount > 0)
      this.proofStatus = DEADLINE_PROOF.ESCAPE_EXISTS;
    else this.proofStatus = DEADLINE_PROOF.TRAPPED;
    return this;
  }

  isFirstAction(action) {
    return action >= 0 && action < this.actionEscape.length && this.actionEscape[action] ? 1 : 0;
  }

  urgent() {
    return this.proofStatus === DEADLINE_PROOF.ESCAPE_EXISTS && this.slack <= 2 ? 1 : 0;
  }
}

module.exports = { DeadlineKernel, DEADLINE_PROOF, SUCCESSOR_PROOF };
