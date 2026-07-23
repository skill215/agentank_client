"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { HARD_STATUS, ACTION, NONE_CELL, NONE_FRAME } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { SAFETY_STATUS, SAFETY_HORIZON } = require("../search/information-safety-closure");
const { DeadlineKernel, DEADLINE_PROOF, SUCCESSOR_PROOF } = require("../fast/deadline-kernel");

const CAPACITY_ENTITIES = 16;
const ENTITY_BOMB = 1;
const ENTITY_PROJECTILE = 2;

// EscapeObligation turns committed bomb/projectile geometry into Safety pressure
// and an optional first-action set. DeadlineKernel supplies multi-frame escape
// first-actions. Hard remains the only REJECT_PROVEN authority.
class EscapeObligation {
  constructor(options = {}) {
    const maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    this.deadline = new DeadlineKernel();
    // Discovery-only probes: never enabled in production Candidate paths.
    this.diagnosticDisableGoDemote = options.diagnosticDisableGoDemote ? 1 : 0;
    this.diagnosticDisableSoftEscape = options.diagnosticDisableSoftEscape ? 1 : 0;
    this.firstAction = new Uint8Array(maxActions);
    this.postViable = new Int8Array(maxActions);
    this.stillExposed = new Uint8Array(maxActions);
    this.committedPressure = new Uint16Array(maxActions);
    this.escapeSlackDelta = new Int8Array(maxActions);
    // Escape Quality (Deadline per-successor). Independent of committedPressure.
    this.successorProof = new Uint8Array(maxActions);
    this.successorExposed = new Uint8Array(maxActions);
    this.successorSlack = new Int8Array(maxActions);
    this.successorBranches = new Uint8Array(maxActions);
    this.successorCoverage = new Uint8Array(maxActions);
    this.successorQualityReady = 0;
    this.entityGeneration = new Uint16Array(CAPACITY_ENTITIES);
    this.entityKind = new Uint8Array(CAPACITY_ENTITIES);
    this.entityCount = 0;
    this.active = 0;
    this.deadlineFrame = NONE_FRAME;
    this.evaluatedCount = 0;
    this.firstActionCount = 0;
    this.clearingActionCount = 0;
    this.deadlineFirstCount = 0;
    this.stayExposed = 0;
    this.appliedSafetyCount = 0;
    this.restrictedSelectionCount = 0;
    this.activateCount = 0;
    this.hotAllocationCount = 0;
  }

  resetMatch() {
    this.active = 0; this.entityCount = 0; this.deadlineFrame = NONE_FRAME;
    this.firstActionCount = 0; this.clearingActionCount = 0;     this.deadlineFirstCount = 0;
    this.stayExposed = 0; this.successorQualityReady = 0;
    this.deadline.reset();
  }

  clearSuccessorQuality(count) {
    this.successorQualityReady = 0;
    this.successorProof.fill(SUCCESSOR_PROOF.PROVEN_DEAD, 0, count);
    this.successorExposed.fill(0, 0, count);
    this.successorSlack.fill(-128, 0, count);
    this.successorBranches.fill(0, 0, count);
    this.successorCoverage.fill(0, 0, count);
  }

  fillSuccessorQuality(bundle, actions, count) {
    this.clearSuccessorQuality(count);
    if (!bundle || !this.deadline || count < 1) return 0;
    const filled = this.deadline.evaluateSuccessorActions(bundle, actions, count, {
      proofStatus: this.successorProof,
      stillExposedAtDeadline: this.successorExposed,
      slack: this.successorSlack,
      viableNextActionCount: this.successorBranches,
      coverageComplete: this.successorCoverage
    });
    this.successorQualityReady = filled > 0 ? 1 : 0;
    return filled;
  }

  // Copy Deadline successor quality into Risk outcome for lexicographic ranking.
  publishSuccessorQuality(controller, count) {
    if (!controller || !controller.outcome || !this.successorQualityReady || count < 1) return 0;
    const o = controller.outcome;
    if (!o.escapeSuccessorProof) return 0;
    for (let row = 0; row < count; row += 1) {
      o.escapeSuccessorProof[row] = this.successorProof[row];
      o.escapeSuccessorExposed[row] = this.successorExposed[row];
      o.escapeSuccessorSlack[row] = this.successorSlack[row];
      o.escapeSuccessorBranches[row] = this.successorBranches[row];
      o.escapeSuccessorCoverage[row] = this.successorCoverage[row];
    }
    o.escapeSuccessorReady = 1;
    return 1;
  }

  bindEntities(state) {
    const a = state.arrays; this.entityCount = 0; let deadline = NONE_FRAME;
    for (let slot = 0; slot < a[ARRAY.BOMB_ACTIVE].length && this.entityCount < CAPACITY_ENTITIES;
        slot += 1) {
      if (!a[ARRAY.BOMB_ACTIVE][slot]) continue;
      const at = this.entityCount++; this.entityKind[at] = ENTITY_BOMB;
      this.entityGeneration[at] = a[ARRAY.BOMB_GENERATION][slot];
      const explode = a[ARRAY.BOMB_EXPLODE][slot];
      if (explode !== NONE_FRAME && (deadline === NONE_FRAME || explode < deadline))
        deadline = explode;
    }
    for (let slot = 0; slot < a[ARRAY.PROJECTILE_ACTIVE].length &&
        this.entityCount < CAPACITY_ENTITIES; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot] || a[ARRAY.PROJECTILE_OWNER][slot] === 0) continue;
      const at = this.entityCount++; this.entityKind[at] = ENTITY_PROJECTILE;
      this.entityGeneration[at] = a[ARRAY.PROJECTILE_GENERATION][slot];
    }
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    this.deadlineFrame = deadline === NONE_FRAME ? frame + SAFETY_HORIZON : deadline;
    return this.entityCount;
  }

  entitiesMatch(state) {
    if (!this.active || !this.entityCount) return 0;
    const a = state.arrays; let matched = 0;
    for (let index = 0; index < this.entityCount; index += 1) {
      const generation = this.entityGeneration[index]; let found = 0;
      if (this.entityKind[index] === ENTITY_BOMB) {
        for (let slot = 0; slot < a[ARRAY.BOMB_ACTIVE].length; slot += 1)
          if (a[ARRAY.BOMB_ACTIVE][slot] && a[ARRAY.BOMB_GENERATION][slot] === generation) {
            found = 1; break;
          }
      } else {
        for (let slot = 0; slot < a[ARRAY.PROJECTILE_ACTIVE].length; slot += 1)
          if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
              a[ARRAY.PROJECTILE_GENERATION][slot] === generation) {
            found = 1; break;
          }
      }
      if (found) matched += 1;
    }
    return matched > 0 ? 1 : 0;
  }

  bombExposure(bundle, cell) {
    if (cell === NONE_CELL) return { exposed: 0, remaining: 255, nearest: 255 };
    const a = bundle.state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const hazard = bundle.hazard; let exposed = 0; let nearest = 255; let nearestDist = 255;
    for (let slot = 0; slot < a[ARRAY.BOMB_ACTIVE].length; slot += 1) {
      if (!a[ARRAY.BOMB_ACTIVE][slot]) continue;
      const center = a[ARRAY.BOMB_CELL][slot];
      if (!hazard.bombHits(center, cell)) continue;
      exposed = 1;
      const remaining = Math.max(0, a[ARRAY.BOMB_EXPLODE][slot] - frame);
      if (remaining < nearest) nearest = remaining;
      const dist = Math.abs(bundle.state.x(center) - bundle.state.x(cell)) +
        Math.abs(bundle.state.y(center) - bundle.state.y(cell));
      if (dist < nearestDist) nearestDist = dist;
    }
    return { exposed, remaining: nearest, nearest: nearestDist };
  }

  projectileAligned(bundle, cell) {
    if (cell === NONE_CELL) return 0;
    const a = bundle.state.arrays; const state = bundle.state;
    for (let slot = 0; slot < a[ARRAY.PROJECTILE_ACTIVE].length; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot] || a[ARRAY.PROJECTILE_OWNER][slot] === 0) continue;
      const from = a[ARRAY.PROJECTILE_CELL][slot]; const dir = a[ARRAY.PROJECTILE_DIR][slot];
      const fx = state.x(from); const fy = state.y(from);
      const tx = state.x(cell); const ty = state.y(cell);
      if (dir === 0 && fx === tx && ty < fy) return 1;
      if (dir === 2 && fx === tx && ty > fy) return 1;
      if (dir === 1 && fy === ty && tx > fx) return 1;
      if (dir === 3 && fy === ty && tx < fx) return 1;
    }
    return 0;
  }

  // True when a hostile projectile's hazard timeline already marks the cell lethal.
  projectileHit(bundle, cell) {
    if (cell === NONE_CELL || !bundle.hazard) return 0;
    const hazard = bundle.hazard;
    for (let tick = 1; tick <= hazard.horizonTick; tick += 1)
      if (hazard.isLethal(tick, cell)) return 1;
    return 0;
  }

  pressureFor(bomb, projectile) {
    if (bomb.exposed) {
      const remaining = bomb.remaining;
      return remaining <= 1 ? 8000 : remaining <= 2 ? 5500 : remaining <= 4 ? 3000 : 1500;
    }
    if (projectile) return 5000;
    return 0;
  }

  manhattan(state, left, right) {
    if (left === NONE_CELL || right === NONE_CELL) return 255;
    return Math.abs(state.x(left) - state.x(right)) + Math.abs(state.y(left) - state.y(right));
  }

  facesToward(state, cell, direction, target) {
    if (target === NONE_CELL) return 0;
    const dx = state.x(target) - state.x(cell);
    const dy = state.y(target) - state.y(cell);
    if (direction === 0) return dy < 0 ? 1 : 0;
    if (direction === 2) return dy > 0 ? 1 : 0;
    if (direction === 1) return dx > 0 ? 1 : 0;
    if (direction === 3) return dx < 0 ? 1 : 0;
    return 0;
  }

  forwardGoOpen(bundle, cell, direction) {
    const next = this.deadline.successor(bundle.hazard, bundle.state, cell, direction, ACTION.GO);
    return next && this.deadline.walkable(bundle.state, next.cell) ? 1 : 0;
  }

  demoteFirst(row) {
    if (!this.firstAction[row]) return;
    this.firstAction[row] = 0;
    this.firstActionCount -= 1;
    if (this.deadlineFirstCount > 0) this.deadlineFirstCount -= 1;
    if (this.committedPressure[row] === 0 && this.clearingActionCount > 0)
      this.clearingActionCount -= 1;
  }

  // Escape Membership (ternary postViable): Hard REJECT / postViable===0 excluded;
  // postViable===1 (PROVEN_VIABLE) and postViable===-1 (UNKNOWN) are members.
  // UNKNOWN must never be Hard-deleted; Quality ranks it below PROVEN_VIABLE.
  membershipEligible(hardStatus, row) {
    if (hardStatus[row] === HARD_STATUS.REJECT_PROVEN ||
        hardStatus[row] === HARD_STATUS.REJECT_POLICY) return 0;
    if (this.postViable[row] === 0) return 0;
    return 1;
  }

  admitFirst(row, asDeadline = 0) {
    if (this.firstAction[row]) return;
    this.firstAction[row] = 1;
    this.firstActionCount += 1;
    if (asDeadline) this.deadlineFirstCount += 1;
    if (this.committedPressure[row] === 0) this.clearingActionCount += 1;
  }

  hasBombEntity() {
    for (let index = 0; index < this.entityCount; index += 1)
      if (this.entityKind[index] === ENTITY_BOMB) return 1;
    return 0;
  }

  hasActiveProjectile(state) {
    const a = state.arrays;
    for (let slot = 0; slot < a[ARRAY.PROJECTILE_ACTIVE].length; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot]) return 1;
    return 0;
  }

  evaluate(bundle, actions, arguments_, count, hardStatus, projectedCell,
      enemyFireDepth = 255) {
    this.evaluatedCount = 0; this.firstActionCount = 0; this.clearingActionCount = 0;
    this.deadlineFirstCount = 0;
    this.stayExposed = 0;
    this.firstAction.fill(0, 0, count); this.postViable.fill(0, 0, count);
    this.stillExposed.fill(0, 0, count); this.committedPressure.fill(0, 0, count);
    this.escapeSlackDelta.fill(0, 0, count);
    this.clearSuccessorQuality(count);
    if (!bundle || !bundle.hard || !bundle.hazard || count < 1) return 0;
    const committed = this.bindEntities(bundle.state);
    const softFire = enemyFireDepth <= 1 ? 1 : 0;
    // Soft fire without committed entities only when a projectile is already on
    // the board (e.g. own bullet scene). Bare fireDepth must not override skills.
    const softScene = softFire && (committed || this.hasActiveProjectile(bundle.state)) ? 1 : 0;
    if (!committed && !softScene) return 0;
    this.deadline.solve(bundle, 0);
    const frame = bundle.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const stayCell = bundle.state.arrays[ARRAY.TANK_CELL][0];
    const stayDir = bundle.state.arrays[ARRAY.TANK_DIR][0];
    const enemyCell = bundle.state.arrays[ARRAY.TANK_CELL][1];
    const stayBomb = this.bombExposure(bundle, stayCell);
    const stayProjectile = this.projectileAligned(bundle, stayCell) ||
      this.projectileHit(bundle, stayCell);
    const stayPressure = this.pressureFor(stayBomb, stayProjectile);
    const stayExposed = stayPressure > 0 ? 1 : 0;
    this.stayExposed = stayExposed;
    let minPressure = 100000; let maxPressure = 0;
    let walkIntoLethal = 0;
    for (let row = 0; row < count; row += 1) {
      this.evaluatedCount += 1;
      const cell = projectedCell[row];
      if (!stayExposed && cell !== undefined && cell !== NONE_CELL && cell !== stayCell &&
          bundle.hazard.horizonTick >= 1 && bundle.hazard.isLethal(1, cell))
        walkIntoLethal = 1;
      if (hardStatus[row] === HARD_STATUS.REJECT_PROVEN ||
          hardStatus[row] === HARD_STATUS.REJECT_POLICY) {
        this.postViable[row] = 0; this.stillExposed[row] = 1;
        this.committedPressure[row] = 10000; continue;
      }
      const status = bundle.hard.evaluate(actions[row],
        arguments_[row] === undefined ? NONE_CELL : arguments_[row]);
      const viable = bundle.hard.lastViable;
      this.postViable[row] = viable === undefined || viable === null ? -1 : viable;
      const bomb = this.bombExposure(bundle, cell);
      const projectile = this.projectileAligned(bundle, cell) || this.projectileHit(bundle, cell);
      const exposed = bomb.exposed || projectile ? 1 : 0;
      this.stillExposed[row] = exposed;
      const pressure = this.pressureFor(bomb, projectile);
      this.committedPressure[row] = pressure;
      if (bomb.exposed) this.escapeSlackDelta[row] = bomb.remaining <= 2 ? -2 : -1;
      else if (projectile) this.escapeSlackDelta[row] = -1;
      if (this.deadline.isFirstAction(actions[row])) {
        const slack = this.deadline.slack;
        this.escapeSlackDelta[row] = Math.max(this.escapeSlackDelta[row],
          slack >= 2 ? 1 : slack >= 0 ? 0 : -1);
      } else if (stayExposed && this.deadline.moveEscapeCount > 0)
        this.escapeSlackDelta[row] = Math.min(this.escapeSlackDelta[row], -2);
      if (status === HARD_STATUS.ALLOW && this.postViable[row] !== 0) {
        if (pressure < minPressure) minPressure = pressure;
        if (pressure > maxPressure) maxPressure = pressure;
      }
    }
    const lateralOnly = this.deadline.moveEscapeCount > 0 &&
      !this.deadline.isFirstAction(ACTION.GO) &&
      (this.deadline.isFirstAction(ACTION.TURN_LEFT) ||
        this.deadline.isFirstAction(ACTION.TURN_RIGHT));
    // Adjacent only — manhattan≤2 was a sample heuristic that forced TURN over
    // surviving GO/NONE on the focused cohort.
    const enemyAdjacentStay = this.deadline.enemyAdjacent(bundle.state, stayCell, 0);
    const shareAxisEnemy = enemyCell !== NONE_CELL &&
      (bundle.state.x(stayCell) === bundle.state.x(enemyCell) ||
        bundle.state.y(stayCell) === bundle.state.y(enemyCell));
    const bombPrep = !stayExposed && this.hasBombEntity() &&
      this.deadline.moveEscapeCount > 0 && this.deadline.slack <= 6;
    // Own-projectile soft scenes must not force escape when already adjacent to
    // the enemy (that path kept killing NONE/GO survivors).
    const softEscape = !this.diagnosticDisableSoftEscape && softScene &&
      this.deadline.moveEscapeCount > 0 && !enemyAdjacentStay;
    // Contact prep only with a bound enemy bomb/projectile, not own-bullet scenes.
    const contactPrep = enemyAdjacentStay && committed > 0 &&
      this.deadline.moveEscapeCount > 0;
    const escapeNeeded = stayExposed || walkIntoLethal || lateralOnly || bombPrep ||
      softEscape || contactPrep || !this.deadline.rootViable || this.deadline.urgent();
    if (this.deadline.moveEscapeCount > 0 && escapeNeeded) {
      for (let row = 0; row < count; row += 1) {
        if (!this.membershipEligible(hardStatus, row)) continue;
        if (!this.deadline.isFirstAction(actions[row])) continue;
        this.admitFirst(row, 1);
      }
      let goRow = -1; let turnLeft = -1; let turnRight = -1; let turnFirst = 0;
      for (let row = 0; row < count; row += 1) {
        if (!this.firstAction[row]) continue;
        if (actions[row] === ACTION.GO) goRow = row;
        if (actions[row] === ACTION.TURN_LEFT) { turnLeft = row; turnFirst += 1; }
        if (actions[row] === ACTION.TURN_RIGHT) { turnRight = row; turnFirst += 1; }
      }
      // Outside the blast with fuse slack: start moving now, don't spin in place.
      if (bombPrep && goRow >= 0 && turnFirst > 0) {
        if (turnLeft >= 0) this.demoteFirst(turnLeft);
        if (turnRight >= 0) this.demoteFirst(turnRight);
      } else if (goRow >= 0 && turnFirst > 0) {
        // TemporaryMembershipPatch (R23b): remaining geometric demotes.
        const leftOpen = turnLeft >= 0 ?
          this.forwardGoOpen(bundle, stayCell, (stayDir + 3) & 3) : 0;
        const rightOpen = turnRight >= 0 ?
          this.forwardGoOpen(bundle, stayCell, (stayDir + 1) & 3) : 0;
        // TemporaryMembershipPatch: axisClearing (kept — share-axis fire)
        const axisClearing = this.committedPressure[goRow] === 0 && stayExposed &&
          this.hasBombEntity() && enemyFireDepth <= 2 && shareAxisEnemy;
        // TemporaryMembershipPatch: corridorClearing (kept — 64c3; Quality
        // clearing preference wrongly ranks dying GO over live TURN)
        const corridorClearing = this.committedPressure[goRow] === 0 && stayExposed &&
          this.hasBombEntity() && enemyFireDepth <= 2 && turnLeft >= 0 && turnRight >= 0 &&
          this.firstAction[turnLeft] && this.firstAction[turnRight] &&
          ((leftOpen && !rightOpen) || (rightOpen && !leftOpen));
        const goCell = projectedCell[goRow];
        const goAdjacent = goCell !== undefined &&
          this.deadline.enemyAdjacent(bundle.state, goCell, 0);
        const enemyDir = enemyCell !== NONE_CELL ?
          bundle.state.arrays[ARRAY.TANK_DIR][1] : 0;
        const enemyFacesGo = goAdjacent && enemyCell !== NONE_CELL &&
          this.facesToward(bundle.state, enemyCell, enemyDir, goCell);
        // TemporaryMembershipPatch (kept): clearing GO into unfaced contact
        // (826c). Committed Quality cannot separate this from faced clearing
        // (574bb); facing is Information, not Deadline proof.
        const contactStep = goAdjacent && turnFirst > 0 &&
          (this.committedPressure[goRow] > 0 || !enemyFacesGo);
        // Phase3.1 retired: clear-GO + enemyFacesGo demote of blast turns
        // (Quality stillExposed ranks clearing GO over blast TURN).
        if (!this.diagnosticDisableGoDemote &&
            (contactPrep || axisClearing || corridorClearing || contactStep))
          this.demoteFirst(goRow);
      }
      // TemporaryMembershipPatch: demote turn whose forward GO is walled off.
      if (turnLeft >= 0 && turnRight >= 0 &&
          this.firstAction[turnLeft] && this.firstAction[turnRight]) {
        const leftOpen = this.forwardGoOpen(bundle, stayCell, (stayDir + 3) & 3);
        const rightOpen = this.forwardGoOpen(bundle, stayCell, (stayDir + 1) & 3);
        if (leftOpen && !rightOpen) this.demoteFirst(turnRight);
        else if (rightOpen && !leftOpen) this.demoteFirst(turnLeft);
      }
      // Soft projectile scene: prefer the unique away-facing turn (Quality tie-break
      // candidate; not Hard Membership).
      if (softScene && turnLeft >= 0 && turnRight >= 0 &&
          this.firstAction[turnLeft] && this.firstAction[turnRight]) {
        const leftToward = this.facesToward(bundle.state, stayCell, (stayDir + 3) & 3, enemyCell);
        const rightToward = this.facesToward(bundle.state, stayCell, (stayDir + 1) & 3, enemyCell);
        if (leftToward && !rightToward) this.demoteFirst(turnLeft);
        else if (rightToward && !leftToward) this.demoteFirst(turnRight);
      }
      // Membership anti-empty: Temporary demotes must not erase every member
      // (UNKNOWN and PROVEN_VIABLE alike). Re-admit deadline first-actions.
      if (this.firstActionCount === 0) {
        for (let row = 0; row < count; row += 1) {
          if (!this.membershipEligible(hardStatus, row)) continue;
          if (!this.deadline.isFirstAction(actions[row])) continue;
          this.admitFirst(row, 1);
        }
      }
    }
    if (this.firstActionCount === 0) {
      for (let row = 0; row < count; row += 1) {
        if (!this.membershipEligible(hardStatus, row)) continue;
        const pressure = this.committedPressure[row];
        const progress = pressure < stayPressure || (pressure === 0 && stayPressure > 0);
        if (pressure === 0 && stayPressure > 0) this.clearingActionCount += 1;
        if (progress || (minPressure < maxPressure && pressure === minPressure))
          this.admitFirst(row, 0);
      }
    }
    if (this.firstActionCount === 0 && minPressure < maxPressure) {
      for (let row = 0; row < count; row += 1)
        if (this.membershipEligible(hardStatus, row) &&
            this.committedPressure[row] === minPressure)
          this.admitFirst(row, 0);
    }
    // Last resort: keep UNKNOWN/PROVEN members so the escape set is never empty
    // when escape is needed and Hard has not proven every row dead.
    if (this.firstActionCount === 0 && escapeNeeded) {
      for (let row = 0; row < count; row += 1)
        if (this.membershipEligible(hardStatus, row)) this.admitFirst(row, 0);
    }
    if (this.deadlineFrame !== NONE_FRAME && frame > this.deadlineFrame) this.active = 0;
    // Escape Quality: Deadline per-successor fields for Risk ranking (not demote).
    this.fillSuccessorQuality(bundle, actions, count);
    return this.firstActionCount;
  }

  applyToSafety(safety, count) {
    if (!safety || count < 1) return 0;
    let applied = 0;
    for (let row = 0; row < count; row += 1) {
      const mass = this.committedPressure[row];
      if (mass > 0) {
        const depth = Math.max(1, Math.min(SAFETY_HORIZON, 2));
        safety.addDeath(row, depth, mass);
        if (safety.horizonFatalMass[row] > 0 &&
            safety.status[row] !== SAFETY_STATUS.PROVEN_DEAD)
          safety.status[row] = SAFETY_STATUS.POSSIBLE_DEATH;
        applied += 1;
      }
      if (this.escapeSlackDelta[row])
        safety.escapeSlack[row] = Math.max(-4, Math.min(4,
          safety.escapeSlack[row] + this.escapeSlackDelta[row]));
    }
    this.appliedSafetyCount += applied; return applied;
  }

  hasDiscriminatingFirstActions(count) {
    if (!this.firstActionCount || this.firstActionCount >= count) return 0;
    let other = 0;
    for (let row = 0; row < count; row += 1)
      if (!this.firstAction[row] && this.postViable[row] !== 0 &&
          this.committedPressure[row] < 10000) other += 1;
    return other > 0 ? 1 : 0;
  }

  restrictRiskController(controller, state, count) {
    if (!this.firstActionCount || !controller || !state) return 0;
    const crossFrame = this.active && this.entitiesMatch(state);
    // Same-frame: DeadlineKernel first-actions are only marked when escape is needed.
    const deadlineForce = this.deadlineFirstCount > 0 && this.hasDiscriminatingFirstActions(count);
    const sameFrame = (this.clearingActionCount > 0 && this.hasDiscriminatingFirstActions(count)) ||
      deadlineForce;
    if (!crossFrame && !sameFrame) return 0;
    const o = controller.outcome; let kept = 0;
    for (let row = 0; row < count; row += 1) {
      const allow = this.firstAction[row];
      if (o.acceptable[row] && allow) kept += 1;
    }
    if (!kept) {
      // Gate emptied the set; still force deadline escapes into the emergency pool
      // so GO-into-contact cannot beat TURN on raw robust.
      if (this.deadlineFirstCount > 0 && controller.noAcceptableAction)
        return this.promoteDeadlineEmergency(controller, count);
      return 0;
    }
    let removed = 0;
    for (let row = 0; row < count; row += 1)
      if (o.acceptable[row] && !this.firstAction[row]) {
        o.acceptable[row] = 0; controller.acceptableCount -= 1; removed += 1;
      }
    if (removed) {
      controller.recomputeSelectionFrontier();
      this.restrictedSelectionCount += 1;
    }
    return removed;
  }

  promoteDeadlineEmergency(controller, count) {
    if (!controller || !this.deadlineFirstCount) return 0;
    const o = controller.outcome; let promoted = 0;
    for (let row = 0; row < count; row += 1) {
      if (!this.firstAction[row]) continue;
      if (o.hard[row] === HARD_STATUS.REJECT_PROVEN ||
          o.hard[row] === HARD_STATUS.REJECT_POLICY) continue;
      if (!o.acceptable[row]) {
        o.acceptable[row] = 1; controller.acceptableCount += 1; promoted += 1;
      }
    }
    if (!promoted) return 0;
    controller.noAcceptableAction = 0;
    controller.recomputeSelectionFrontier();
    this.restrictedSelectionCount += 1;
    return promoted;
  }

  activateAfterSelection(selectedIndex) {
    if (!this.entityCount) { this.active = 0; return 0; }
    if (selectedIndex >= 0 && this.stillExposed[selectedIndex] && this.firstActionCount > 0) {
      this.active = 1; this.activateCount += 1; return 1;
    }
    if (selectedIndex >= 0 && this.firstAction[selectedIndex] && this.entityCount > 0) {
      this.active = 1; this.activateCount += 1; return 1;
    }
    if (this.committedPressure[selectedIndex] > 0 && this.firstActionCount > 0) {
      this.active = 1; this.activateCount += 1; return 1;
    }
    if (this.deadline.proofStatus === DEADLINE_PROOF.ESCAPE_EXISTS &&
        this.deadline.slack <= 4 && this.firstActionCount > 0) {
      this.active = 1; this.activateCount += 1; return 1;
    }
    return this.active;
  }
}

module.exports = { EscapeObligation, ENTITY_BOMB, ENTITY_PROJECTILE, SUCCESSOR_PROOF };
