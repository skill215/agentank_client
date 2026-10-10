"use strict";

const { CAPACITY, RULE } = require("../generated/fast-config");
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
  constructor(options = {}) {
    const cells = CAPACITY.MAX_CELLS;
    this.viableA = new Uint8Array(cells * 4);
    this.viableB = new Uint8Array(cells * 4);
    this.viableTick1 = new Uint8Array(cells * 4);
    this.viableTick2 = new Uint8Array(cells * 4);
    this.chanceSurvivalMass = options.chanceSurvivalMass ? 1 : 0;
    this.survivalA = this.chanceSurvivalMass ? new Uint16Array(cells * 4) : null;
    this.survivalB = this.chanceSurvivalMass ? new Uint16Array(cells * 4) : null;
    this.survivalTick1 = this.chanceSurvivalMass ? new Uint16Array(cells * 4) : null;
    // -2 means not queried in this solve, -1 means no committed hit.  The
    // timeline is filled lazily because a root normally projects only a few
    // distinct cells; scanning every map cell would defeat the shared-lattice
    // saving on large arenas.
    this.earliestLethalTick = new Int16Array(cells);
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
    this.sharedThreatLattice = options.sharedThreatLattice !== false ? 1 : 0;
    this.chanceCompleteStun = options.chanceCompleteStun ? 1 : 0;
    this.transitionSupportComplete = 1;
    this.chancePrivateBuildCount = 0;
    this.sharedLayerHitCount = 0; this.sharedLayerBuildCount = 0;
    this.privateReverseBuildCount = 0; this.privateReverseBuildNodeCount = 0;
    this.timelineBuildCount = 0; this.timelineNodeCount = 0;
    this.lastSuccessorCell = NONE_CELL; this.lastSuccessorDirection = 0;
  }

  reset() {
    this.deadlineTick = 0; this.earliestArrival = 255; this.slack = -128;
    this.rootViable = 0; this.proofStatus = DEADLINE_PROOF.INCOMPLETE;
    this.firstActionCodeCount = 0; this.moveEscapeCount = 0; this.holdEscapeCount = 0;
    this.lastCoverageComplete = 0;
    this.transitionSupportComplete = 1;
    this.actionEscape.fill(0);
  }

  activeUntil(a, arrayId, frame) {
    const until = a[arrayId][0];
    return until !== NONE_FRAME && until > frame ? 1 : 0;
  }

  stunnedAtTick(state, tick) {
    if (!this.chanceCompleteStun) return 0;
    const a = state.arrays; const rootFrame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const actionFrame = rootFrame + Math.floor(tick /
      Math.max(1, RULE.PROJECTILE_STEPS));
    return this.activeUntil(a, ARRAY.TANK_STUN_UNTIL, actionFrame);
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
      if (!this.walkable(state, forward)) return 0;
      this.lastSuccessorCell = forward; this.lastSuccessorDirection = direction; return 1;
    }
    this.lastSuccessorCell = cell;
    if (action === ACTION.TURN_LEFT) this.lastSuccessorDirection = (direction + 3) & 3;
    else if (action === ACTION.TURN_RIGHT) this.lastSuccessorDirection = (direction + 1) & 3;
    else this.lastSuccessorDirection = direction;
    return 1;
  }

  buildReverse(hazard, perspectiveSeat = 0) {
    const state = hazard.state; const a = state.arrays; const cells = state.cells;
    let next = this.viableA; let current = this.viableB; next.fill(0); current.fill(0);
    let survivalNext = this.survivalA; let survivalCurrent = this.survivalB;
    if (survivalNext) { survivalNext.fill(0); survivalCurrent.fill(0);
      this.survivalTick1.fill(0); }
    this.viableTick1.fill(0);
    this.viableTick2.fill(0);
    const rootFrame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const chanceSensitive = this.chanceCompleteStun &&
      this.activeUntil(a, ARRAY.TANK_STUN_UNTIL, rootFrame);
    if (!chanceSensitive && !this.chanceSurvivalMass &&
        typeof hazard.loadReverseLatticeLayers === "function") {
      if (hazard.loadReverseLatticeLayers(perspectiveSeat,
          next, this.viableTick1, this.viableTick2)) {
        this.sharedLayerHitCount += 1; return next;
      }
      // A cold EO root used to rebuild the same reverse DP privately. Ask the
      // canonical HazardKernel to materialize it once so later Hard/Safety
      // consumers can reuse the exact same committed lattice.
      if (this.sharedThreatLattice && hazard.reverseLatticeEntries &&
          typeof hazard.reverseViable === "function") {
        const before = hazard.reverseLatticeBuildCount || 0;
        hazard.reverseViable(perspectiveSeat);
        if (hazard.loadReverseLatticeLayers(perspectiveSeat,
            next, this.viableTick1, this.viableTick2)) {
          if ((hazard.reverseLatticeBuildCount || 0) > before)
            this.sharedLayerBuildCount += 1;
          else this.sharedLayerHitCount += 1;
          return next;
        }
      }
    }
    if (chanceSensitive) this.chancePrivateBuildCount += 1;
    this.privateReverseBuildCount += 1;
    this.privateReverseBuildNodeCount += (hazard.horizonTick + 1) * cells * 4;
    for (let cell = 0; cell < cells; cell += 1) if (this.walkable(state, cell) &&
        !hazard.isLethal(hazard.horizonTick, cell))
      for (let direction = 0; direction < 4; direction += 1) {
        const pose = cell * 4 + direction; next[pose] = 1;
        if (survivalNext) survivalNext[pose] = 10000;
      }
    const poses = cells * 4;
    if (hazard.horizonTick === 1)
      for (let pose = 0; pose < poses; pose += 1) {
        this.viableTick1[pose] = next[pose];
        if (survivalNext) this.survivalTick1[pose] = survivalNext[pose];
      }
    if (hazard.horizonTick === 2)
      for (let pose = 0; pose < poses; pose += 1) this.viableTick2[pose] = next[pose];
    if (hazard.horizonTick < 1) {
      for (let pose = 0; pose < poses; pose += 1) {
        this.viableTick1[pose] = next[pose]; this.viableTick2[pose] = next[pose];
        if (survivalNext) this.survivalTick1[pose] = survivalNext[pose];
      }
    }
    for (let tick = hazard.horizonTick - 1; tick >= 0; tick -= 1) {
      current.fill(0);
      if (survivalCurrent) survivalCurrent.fill(0);
      for (let cell = 0; cell < cells; cell += 1) if (this.walkable(state, cell) &&
          !hazard.isLethal(tick, cell)) {
        for (let direction = 0; direction < 4; direction += 1) {
          const pose = cell * 4 + direction;
          let viable = next[pose]; let survival = survivalNext ? survivalNext[pose] : 0;
          if ((tick & 1) === 0) {
            const leftPose = cell * 4 + ((direction + 3) & 3);
            const rightPose = cell * 4 + ((direction + 1) & 3);
            const left = next[leftPose]; const right = next[rightPose];
            let forward = this.target(hazard, cell, direction);
            if (forward === NONE_CELL || !this.walkable(state, forward)) forward = cell;
            const forwardPose = forward * 4 + direction;
            const forwardViable = !hazard.isLethal(tick + 1, forward) && next[forwardPose];
            if (this.stunnedAtTick(state, tick)) {
              let backward = this.target(hazard, cell, (direction + 2) & 3);
              if (backward === NONE_CELL || !this.walkable(state, backward)) backward = cell;
              const backwardPose = backward * 4 + direction;
              const backwardViable = !hazard.isLethal(tick + 1, backward) && next[backwardPose];
              // The next callback reveals the actual branch, but the command
              // selected now is a strict witness only if every stun outcome
              // reaches the future viable set.
              viable = viable || (left && right) ||
                (forwardViable && backwardViable);
              if (survivalNext) {
                const turnMass = Math.floor((survivalNext[leftPose] +
                  survivalNext[rightPose]) / 2);
                const goMass = Math.floor((survivalNext[forwardPose] +
                  survivalNext[backwardPose]) / 2);
                if (turnMass > survival) survival = turnMass;
                if (goMass > survival) survival = goMass;
              }
            } else {
              viable = viable || left || right || forwardViable;
              if (survivalNext) {
                if (survivalNext[leftPose] > survival) survival = survivalNext[leftPose];
                if (survivalNext[rightPose] > survival) survival = survivalNext[rightPose];
                if (survivalNext[forwardPose] > survival) survival = survivalNext[forwardPose];
              }
            }
          }
          if (viable) current[cell * 4 + direction] = 1;
          if (survivalCurrent) survivalCurrent[pose] = survival;
        }
      }
      if (tick === 1)
        for (let pose = 0; pose < poses; pose += 1) {
          this.viableTick1[pose] = current[pose];
          if (survivalCurrent) this.survivalTick1[pose] = survivalCurrent[pose];
        }
      if (tick === 2)
        for (let pose = 0; pose < poses; pose += 1) this.viableTick2[pose] = current[pose];
      const swap = next; next = current; current = swap;
      if (survivalNext) {
        const survivalSwap = survivalNext; survivalNext = survivalCurrent;
        survivalCurrent = survivalSwap;
      }
    }
    return next;
  }

  resetEarliestLethal(hazard) {
    this.earliestLethalTick.fill(-2, 0, hazard.state.cells);
    this.timelineBuildCount += 1;
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
    let tick = this.earliestLethalTick[cell];
    if (tick !== -2) return tick < 0 ? NONE_FRAME : tick;
    let nodes = 0; tick = -1;
    for (let candidate = 1; candidate <= hazard.horizonTick; candidate += 1) {
      nodes += 1;
      if (hazard.isLethal(candidate, cell)) { tick = candidate; break; }
    }
    this.timelineNodeCount += nodes;
    this.earliestLethalTick[cell] = tick;
    return tick < 0 ? NONE_FRAME : tick;
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
    return hazard && hazard.complete && hazard.narrowProofComplete &&
      this.transitionSupportComplete ? 1 : 0;
  }

  countViableNextActions(hazard, state, cell, direction) {
    let count = 0;
    const tick2Lethal = hazard.horizonTick >= 2;
    for (let index = 0; index < MOVE_ACTIONS.length; index += 1) {
      if (!this.successor(hazard, state, cell, direction, MOVE_ACTIONS[index])) continue;
      const nextCell = this.lastSuccessorCell; const nextDirection = this.lastSuccessorDirection;
      if (tick2Lethal && hazard.isLethal(2, nextCell)) continue;
      if (!this.poseViable(this.viableTick2, nextCell, nextDirection)) continue;
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
      const quality = next ? this.evaluateSuccessor(bundle,
        this.lastSuccessorCell, this.lastSuccessorDirection) :
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

  // Hot EO path: fill the fixed per-row slab directly. Unlike
  // evaluateSuccessor(), this creates no temporary result object and it uses
  // the once-per-root lazy lethal timeline rather than rescanning the same
  // projected cell for every action row.
  evaluateProjectedSuccessors(bundle, projectedCell, projectedDirection, count, out) {
    if (!bundle || !bundle.hazard || !out || count < 1) return 0;
    const hazard = bundle.hazard; const state = hazard.state;
    const proof = out.proofStatus; const exposed = out.stillExposedAtDeadline;
    const slack = out.slack; const branches = out.viableNextActionCount;
    const coverage = out.coverageComplete; const survivalMass = out.survivalMass;
    const complete = this.coverageComplete(hazard);
    for (let row = 0; row < count; row += 1) {
      const cell = projectedCell[row]; const direction = projectedDirection[row];
      let rowProof = SUCCESSOR_PROOF.PROVEN_DEAD; let rowExposed = 0;
      let rowSlack = -128; let rowBranches = 0;
      if (this.walkable(state, cell)) {
        const lethal = hazard.horizonTick >= 1 && hazard.isLethal(1, cell);
        if (lethal) rowExposed = 1;
        else {
          const viable = this.poseViable(this.viableTick1, cell, direction);
          if (viable) rowProof = complete ? SUCCESSOR_PROOF.PROVEN_VIABLE :
            SUCCESSOR_PROOF.UNKNOWN;
          else if (!complete) rowProof = SUCCESSOR_PROOF.UNKNOWN;
          rowExposed = this.stillExposedAtDeadline(bundle, cell);
          if (viable || rowProof === SUCCESSOR_PROOF.UNKNOWN)
            rowSlack = Math.max(-128, Math.min(127, this.deadlineTick - 1));
          if (rowProof !== SUCCESSOR_PROOF.PROVEN_DEAD)
            rowBranches = this.countViableNextActions(hazard, state, cell, direction);
        }
      }
      proof[row] = rowProof; exposed[row] = rowExposed; slack[row] = rowSlack;
      branches[row] = rowBranches; coverage[row] = complete;
      if (survivalMass) survivalMass[row] = this.survivalTick1 ?
        this.survivalTick1[cell * 4 + direction] : 0;
    }
    this.lastCoverageComplete = complete; return count;
  }

  // FinalActionGate has already enumerated NORMAL/REVERSED outcomes without
  // allocating. Fold those concrete poses into the existing EO row slabs.
  // Mixed dead/live support is UNKNOWN: it cannot restore a Risk-rejected row
  // and it is not a universal death certificate either.
  mergeChanceSuccessors(bundle, count, chanceSupportCount,
      chanceFatalSupportCount, chanceIncompleteSupportCount,
      chanceCell, chanceDirection, chanceStride, out) {
    if (!this.chanceCompleteStun || !bundle || !bundle.hazard || !out ||
        !chanceSupportCount || !chanceCell || !chanceDirection) return 0;
    const hazard = bundle.hazard; const state = hazard.state;
    const complete = this.coverageComplete(hazard);
    for (let row = 0; row < count; row += 1) {
      const support = chanceSupportCount[row] | 0;
      const fatal = chanceFatalSupportCount ? chanceFatalSupportCount[row] | 0 : 0;
      const incomplete = chanceIncompleteSupportCount ?
        chanceIncompleteSupportCount[row] | 0 : 0;
      if (support < 1 || incomplete > 0) {
        out.proofStatus[row] = SUCCESSOR_PROOF.UNKNOWN;
        out.coverageComplete[row] = 0;
        continue;
      }
      let allViable = 1; let allDead = 1; let anyExposed = 0;
      let minimumSlack = 127; let minimumBranches = 255; let survivalTotal = 0;
      for (let chance = 0; chance < support; chance += 1) {
        const at = row * chanceStride + chance;
        const cell = chanceCell[at]; const direction = chanceDirection[at];
        let proof = SUCCESSOR_PROOF.PROVEN_DEAD; let exposed = 0;
        let slack = -128; let branches = 0;
        if (this.walkable(state, cell)) {
          const lethal = hazard.horizonTick >= 1 && hazard.isLethal(1, cell);
          if (lethal) exposed = 1;
          else {
            const viable = this.poseViable(this.viableTick1, cell, direction);
            if (viable) proof = complete ? SUCCESSOR_PROOF.PROVEN_VIABLE :
              SUCCESSOR_PROOF.UNKNOWN;
            else if (!complete) proof = SUCCESSOR_PROOF.UNKNOWN;
            exposed = this.stillExposedAtDeadline(bundle, cell);
            if (viable || proof === SUCCESSOR_PROOF.UNKNOWN)
              slack = Math.max(-128, Math.min(127, this.deadlineTick - 1));
            if (proof !== SUCCESSOR_PROOF.PROVEN_DEAD)
              branches = this.countViableNextActions(hazard, state, cell, direction);
          }
        }
        if (proof !== SUCCESSOR_PROOF.PROVEN_VIABLE) allViable = 0;
        if (proof !== SUCCESSOR_PROOF.PROVEN_DEAD) allDead = 0;
        if (exposed) anyExposed = 1;
        if (slack < minimumSlack) minimumSlack = slack;
        if (branches < minimumBranches) minimumBranches = branches;
        // A branch that is already dead at the projected tick contributes no
        // future survival mass. Counting its terminal lattice value would
        // make total survival exceed (1 - immediate fatal support).
        if (out.survivalMass && this.survivalTick1 && cell !== NONE_CELL &&
            proof !== SUCCESSOR_PROOF.PROVEN_DEAD)
          survivalTotal += this.survivalTick1[cell * 4 + direction];
      }
      out.proofStatus[row] = fatal === support && allDead ?
        SUCCESSOR_PROOF.PROVEN_DEAD : fatal === 0 && allViable ?
          SUCCESSOR_PROOF.PROVEN_VIABLE : SUCCESSOR_PROOF.UNKNOWN;
      out.stillExposedAtDeadline[row] = anyExposed;
      out.slack[row] = minimumSlack;
      out.viableNextActionCount[row] = minimumBranches === 255 ? 0 : minimumBranches;
      out.coverageComplete[row] = complete;
      if (out.survivalMass) out.survivalMass[row] = this.survivalTick1 ?
        Math.floor(survivalTotal / support) : 0;
    }
    return count;
  }

  solve(bundle, perspectiveSeat = 0) {
    this.reset(); this.solveCount += 1;
    if (!bundle || !bundle.hazard) return this;
    const hazard = bundle.hazard; const state = hazard.state;
    if (this.chanceCompleteStun) {
      const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
      // This closure does not yet model future held/compound schedules. Never
      // certify a deterministic path through boost/freeze/poison.
      if (this.activeUntil(a, ARRAY.TANK_BOOST_UNTIL, frame) ||
          this.activeUntil(a, ARRAY.TANK_FROZEN_UNTIL, frame) ||
          this.activeUntil(a, ARRAY.TANK_POISON_UNTIL, frame))
        this.transitionSupportComplete = 0;
    }
    if (!hazard.rebuild(perspectiveSeat)) {
      this.proofStatus = DEADLINE_PROOF.INCOMPLETE; return this;
    }
    this.deadlineTick = hazard.horizonTick;
    this.lastCoverageComplete = this.coverageComplete(hazard);
    const a = state.arrays;
    const rootCell = a[ARRAY.TANK_CELL][perspectiveSeat];
    const rootDirection = a[ARRAY.TANK_DIR][perspectiveSeat];
    const tick0 = this.buildReverse(hazard, perspectiveSeat);
    this.resetEarliestLethal(hazard);
    this.rootViable = this.poseViable(tick0, rootCell, rootDirection);

    const candidates = [
      ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT, ACTION.NONE, ACTION.FIRE,
      ACTION.THROW_BOMB, ACTION.CAST_POISON
    ];
    for (let index = 0; index < candidates.length; index += 1) {
      const action = candidates[index];
      if (!this.successor(hazard, state, rootCell, rootDirection, action)) continue;
      const nextCell = this.lastSuccessorCell; const nextDirection = this.lastSuccessorDirection;
      if (hazard.horizonTick >= 1 && hazard.isLethal(1, nextCell)) continue;
      if (!this.poseViable(this.viableTick1, nextCell, nextDirection)) continue;
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
    if (!hazard.complete || !hazard.narrowProofComplete ||
        !this.transitionSupportComplete)
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
