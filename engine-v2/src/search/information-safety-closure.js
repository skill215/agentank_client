"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { CAPACITY, RULE } = require("../generated/fast-config");
const { HARD_STATUS, TERRAIN, NONE_CELL, DX, DY } = require("../abi/fast-codes");
const { ARRAY } = require("../state/fast-state");

const SAFETY_STATUS = Object.freeze({ UNKNOWN: 0, PROVEN_SAFE: 1, PROVEN_DEAD: 2,
  POSSIBLE_DEATH: 3 });
const SAFETY_HORIZON = 4;
const NONE_FATAL_FRAME = 0xff;
// Until the opponent model supplies a complete action-family distribution,
// each required pre-FIRE frontier action keeps a conservative one-half upper
// mass.  This is joint path mass, not the conditional probability of FIRE.
const FRONTIER_ACTION_MASS_UPPER = 5000;

class SafetyOutcomeSlab {
  constructor(maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS) {
    this.maxActions = maxActions; this.status = new Uint8Array(maxActions);
    this.earliestFatalFrame = new Uint8Array(maxActions);
    this.immediateFatalMass = new Uint16Array(maxActions);
    this.horizonFatalMass = new Uint16Array(maxActions);
    this.unknownMass = new Uint16Array(maxActions);
    this.escapeSlack = new Int8Array(maxActions); this.coverage = new Uint16Array(maxActions);
    this.deathMass = new Uint16Array(maxActions * SAFETY_HORIZON);
    // Keep physical/committed evidence separate from a future EnemyAction
    // estimate.  A later path-aware strategy closure may replace only the
    // latter without weakening an observed projectile, bomb, or fatal chance
    // outcome.  The public deathMass remains the saturated combined view.
    this.committedDeathMass = new Uint16Array(maxActions * SAFETY_HORIZON);
    this.possibleProjectileDeathMass = new Uint16Array(maxActions * SAFETY_HORIZON);
    this.futureFireDeathMass = new Uint16Array(maxActions * SAFETY_HORIZON);
    this.strategyRiskApplied = new Uint8Array(maxActions);
    this.possibleProjectileStrategyApplied = new Uint8Array(maxActions);
    this.futureFireStrategyApplied = new Uint8Array(maxActions);
    this.committedDeadlineFrames = new Uint16Array(maxActions);
    this.chanceSupportCount = new Uint8Array(maxActions);
    this.chanceFatalSupportCount = new Uint8Array(maxActions);
    this.futureFireDepth = new Uint8Array(maxActions);
    this.count = 0; this.hotAllocationCount = 0;
  }
  reset(count) {
    this.count = count; this.status.fill(SAFETY_STATUS.UNKNOWN, 0, count);
    this.earliestFatalFrame.fill(NONE_FATAL_FRAME, 0, count);
    this.immediateFatalMass.fill(0, 0, count); this.horizonFatalMass.fill(0, 0, count);
    this.unknownMass.fill(0, 0, count); this.escapeSlack.fill(0, 0, count);
    this.coverage.fill(0, 0, count); this.committedDeadlineFrames.fill(0, 0, count);
    this.chanceSupportCount.fill(0, 0, count); this.chanceFatalSupportCount.fill(0, 0, count);
    this.futureFireDepth.fill(NONE_FATAL_FRAME, 0, count);
    this.deathMass.fill(0, 0, count * SAFETY_HORIZON);
    this.committedDeathMass.fill(0, 0, count * SAFETY_HORIZON);
    this.possibleProjectileDeathMass.fill(0, 0, count * SAFETY_HORIZON);
    this.futureFireDeathMass.fill(0, 0, count * SAFETY_HORIZON);
    this.strategyRiskApplied.fill(0, 0, count);
    this.possibleProjectileStrategyApplied.fill(0, 0, count);
    this.futureFireStrategyApplied.fill(0, 0, count);
  }
  addContribution(row, depth, mass, futureFire) {
    if (depth < 1 || depth > SAFETY_HORIZON || mass <= 0) return;
    const bounded = Math.min(10000, mass); const at = row * SAFETY_HORIZON + depth - 1;
    const source = futureFire ? this.futureFireDeathMass : this.committedDeathMass;
    source[at] = Math.min(10000, source[at] + bounded);
    this.deathMass[at] = Math.min(10000, this.deathMass[at] + bounded);
    this.horizonFatalMass[row] = Math.min(10000, this.horizonFatalMass[row] + bounded);
    if (depth === 1) this.immediateFatalMass[row] = Math.min(10000,
      this.immediateFatalMass[row] + bounded);
    if (depth < this.earliestFatalFrame[row]) this.earliestFatalFrame[row] = depth;
  }
  addDeath(row, depth, mass) { this.addContribution(row, depth, mass, 0); }
  addFutureFire(row, depth, mass) { this.addContribution(row, depth, mass, 1); }
  addPossibleProjectile(row, depth, mass) {
    if (depth < 1 || depth > SAFETY_HORIZON || mass <= 0) return;
    const bounded = Math.min(10000, mass); const at = row * SAFETY_HORIZON + depth - 1;
    this.possibleProjectileDeathMass[at] = Math.min(10000,
      this.possibleProjectileDeathMass[at] + bounded);
    this.deathMass[at] = Math.min(10000, this.deathMass[at] + bounded);
    this.horizonFatalMass[row] = Math.min(10000, this.horizonFatalMass[row] + bounded);
    if (depth === 1) this.immediateFatalMass[row] = Math.min(10000,
      this.immediateFatalMass[row] + bounded);
    if (depth < this.earliestFatalFrame[row]) this.earliestFatalFrame[row] = depth;
  }
  rebuildDeath(row) {
    const base = row * SAFETY_HORIZON; let total = 0; let earliest = NONE_FATAL_FRAME;
    for (let depth = 0; depth < SAFETY_HORIZON; depth += 1) {
      const at = base + depth; const mass = Math.min(10000,
        this.committedDeathMass[at] + this.possibleProjectileDeathMass[at] +
        this.futureFireDeathMass[at]);
      this.deathMass[at] = mass; total = Math.min(10000, total + mass);
      if (mass > 0 && earliest === NONE_FATAL_FRAME) earliest = depth + 1;
    }
    this.immediateFatalMass[row] = this.deathMass[base];
    this.horizonFatalMass[row] = total; this.earliestFatalFrame[row] = earliest;
  }
  replaceFutureFire(row, source, offset = 0) {
    const base = row * SAFETY_HORIZON;
    for (let depth = 0; depth < SAFETY_HORIZON; depth += 1)
      this.futureFireDeathMass[base + depth] = source[offset + depth];
    this.strategyRiskApplied[row] = 1; this.futureFireStrategyApplied[row] = 1;
    this.rebuildDeath(row);
  }
  replacePossibleProjectile(row, source, offset = 0) {
    const base = row * SAFETY_HORIZON;
    for (let depth = 0; depth < SAFETY_HORIZON; depth += 1)
      this.possibleProjectileDeathMass[base + depth] = source[offset + depth];
    this.strategyRiskApplied[row] = 1; this.possibleProjectileStrategyApplied[row] = 1;
    this.rebuildDeath(row);
  }
  clearDeath(row) {
    const base = row * SAFETY_HORIZON;
    this.deathMass.fill(0, base, base + SAFETY_HORIZON);
    this.committedDeathMass.fill(0, base, base + SAFETY_HORIZON);
    this.possibleProjectileDeathMass.fill(0, base, base + SAFETY_HORIZON);
    this.futureFireDeathMass.fill(0, base, base + SAFETY_HORIZON);
    this.immediateFatalMass[row] = 0; this.horizonFatalMass[row] = 0;
    this.earliestFatalFrame[row] = NONE_FATAL_FRAME;
  }
}

class InformationSafetyClosure {
  constructor() {
    this.outcome = new SafetyOutcomeSlab(); this.nodes = 0; this.completedActions = 0;
    this.supportComplete = 0; this.interrupted = 0; this.rootRestoreFailures = 0;
    this.capabilityComplete = 0; this.capabilityFireSupport = 0; this.hotAllocationCount = 0;
  }
  target(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ? NONE_CELL : state.cell(x, y);
  }
  clearLine(state, from, to) {
    const fx = state.x(from); const fy = state.y(from); const tx = state.x(to); const ty = state.y(to);
    if (fx !== tx && fy !== ty) return 0;
    const dx = tx === fx ? 0 : tx > fx ? 1 : -1; const dy = ty === fy ? 0 : ty > fy ? 1 : -1;
    const terrain = state.arrays[ARRAY.TERRAIN]; let x = fx + dx; let y = fy + dy;
    while (x !== tx || y !== ty) { const tile = terrain[state.cell(x, y)];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0; x += dx; y += dy; }
    return 1;
  }
  escapeCount(state, cell, shotDirection) {
    const terrain = state.arrays[ARRAY.TERRAIN]; let count = 0;
    const left = (shotDirection + 3) & 3; const right = (shotDirection + 1) & 3;
    let next = this.target(state, cell, left);
    if (next !== NONE_CELL && terrain[next] !== TERRAIN.WALL && terrain[next] !== TERRAIN.DIRT) count += 1;
    next = this.target(state, cell, right);
    if (next !== NONE_CELL && terrain[next] !== TERRAIN.WALL && terrain[next] !== TERRAIN.DIRT) count += 1;
    return count;
  }
  threatDepth(state, worldCell, worldDirection, targetCell) {
    const wx = state.x(worldCell); const wy = state.y(worldCell);
    const tx = state.x(targetCell); const ty = state.y(targetCell);
    const dx = Math.abs(wx - tx); const dy = Math.abs(wy - ty);
    if ((dx === 0 || dy === 0) && this.clearLine(state, worldCell, targetCell)) {
      const wanted = dx === 0 ? ty < wy ? 0 : 2 : tx > wx ? 1 : 3;
      return 1 + (wanted === worldDirection ? 0 : 1);
    }
    // Selective threat frontier: the enemy needs only the shorter-axis moves
    // to become aligned, then at most one turn and FIRE. Obstacles do not make
    // this optimistic support safe; unresolved geometry stays UNKNOWN.
    return Math.min(dx, dy) + 2;
  }
  jointThreatMass(worldMass, fireMass, depth) {
    let mass = Math.max(1, Math.min(10000,
      Math.floor(worldMass * fireMass / 10000)));
    for (let step = 1; step < depth; step += 1)
      mass = Math.max(1, Math.floor(mass * FRONTIER_ACTION_MASS_UPPER / 10000));
    return mass;
  }
  evaluate(bundle, actions, actionCount, hardStatus, projectedCell, projectedDirection,
      worldCells, worldMass, worldCount, supportComplete, possibleProjectiles,
      enemyCanFire, lastEnemyDirection, nodeBudget = 0xffff, strategyConsistent = 1,
      enemyFireProbability = 10000, chanceSupportCount = null,
      chanceFatalSupportCount = null, chanceIncompleteSupportCount = null,
      capabilityTimeline = null, chanceProjectedCell = null, chanceProjectedDirection = null) {
    const output = this.outcome; output.reset(actionCount); this.nodes = 0;
    const capabilityComplete = capabilityTimeline ? capabilityTimeline.complete : 1;
    const fireSupport = capabilityTimeline ? capabilityTimeline.hasFireSupport : enemyCanFire;
    this.completedActions = 0; this.supportComplete = supportComplete && capabilityComplete ? 1 : 0;
    this.capabilityComplete = capabilityComplete ? 1 : 0;
    this.capabilityFireSupport = fireSupport ? 1 : 0; this.interrupted = 0;
    if (!bundle || !bundle.state) return output;
    const state = bundle.state; const committedDeadline = Math.floor(
      bundle.hazard.horizonTick / Math.max(1, RULE.PROJECTILE_STEPS));
    for (let row = 0; row < actionCount; row += 1) {
      if (this.nodes >= nodeBudget) { output.status[row] = SAFETY_STATUS.UNKNOWN;
        output.unknownMass[row] = 10000; this.interrupted = 1; continue; }
      output.committedDeadlineFrames[row] = committedDeadline;
      if (hardStatus[row] === HARD_STATUS.REJECT_PROVEN ||
          hardStatus[row] === HARD_STATUS.REJECT_POLICY) {
        output.status[row] = SAFETY_STATUS.PROVEN_DEAD; output.addDeath(row, 1, 10000);
        output.coverage[row] = 10000; this.completedActions += 1; continue;
      }
      if (hardStatus[row] === HARD_STATUS.INCOMPLETE) {
        output.status[row] = SAFETY_STATUS.UNKNOWN; output.unknownMass[row] = 10000;
      }
      const target = projectedCell[row]; const direction = projectedDirection[row];
      let minimumSlack = 4; let threatened = 0;
      const ownChanceSupport = chanceSupportCount ? chanceSupportCount[row] : 1;
      const ownFatalSupport = chanceFatalSupportCount ? chanceFatalSupportCount[row] : 0;
      output.chanceSupportCount[row] = ownChanceSupport;
      output.chanceFatalSupportCount[row] = ownFatalSupport;
      if (ownFatalSupport > 0) {
        // Stun probabilities are not platform-confirmed. Safety therefore consumes
        // the fatal support upper bound, while Hard remains existentially ALLOW when
        // another supported outcome survives.
        output.addDeath(row, 1, 10000); threatened = 1; minimumSlack = -1;
      }
      if (chanceIncompleteSupportCount && chanceIncompleteSupportCount[row] > 0)
        output.unknownMass[row] = 10000;
      let committedPossible = 0; let possibleFrame = 1;
      if (possibleProjectiles && typeof possibleProjectiles.evaluateHorizon === "function") {
        committedPossible = possibleProjectiles.evaluateHorizon(state, target, direction, SAFETY_HORIZON);
        possibleFrame = possibleProjectiles.lastHorizonFrame;
        minimumSlack = Math.min(minimumSlack, possibleProjectiles.lastEscapeSlack);
      } else if (possibleProjectiles) committedPossible = possibleProjectiles.lethalMass(state, target);
      if (committedPossible > 0) {
        output.addPossibleProjectile(row, possibleFrame, committedPossible); threatened = 1;
      }
      if (fireSupport) {
        // ChanceOutcome changes geometry before the simultaneous enemy action
        // (stun reversal is one example). The old nominal-only projection could
        // therefore evaluate a safe target cell while another supported result
        // moved into a lethal ray. Chance probabilities are not assumed uniform:
        // aggregate hidden-world mass inside each support, then keep the maximum
        // support mass per deadline as its conservative integer upper bound.
        let maximum1 = 0; let maximum2 = 0; let maximum3 = 0; let maximum4 = 0;
        const chanceBase = row * SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES;
        for (let chance = 0; chance < ownChanceSupport; chance += 1) {
          const supportedCell = chanceProjectedCell ? chanceProjectedCell[chanceBase + chance] : NONE_CELL;
          const chanceTarget = supportedCell === NONE_CELL ? target : supportedCell;
          let mass1 = 0; let mass2 = 0; let mass3 = 0; let mass4 = 0;
          for (let world = 0; world < worldCount; world += 1) {
            if (this.nodes++ >= nodeBudget) { this.interrupted = 1; break; }
            const requiredActions = this.threatDepth(state, worldCells[world],
              lastEnemyDirection, chanceTarget);
            const depth = capabilityTimeline ? capabilityTimeline.earliestCompletion(requiredActions) :
              requiredActions;
            if (depth > SAFETY_HORIZON) continue; threatened = 1;
            if (depth < output.futureFireDepth[row]) output.futureFireDepth[row] = depth;
            const mass = this.jointThreatMass(worldMass[world], enemyFireProbability, depth);
            const aligned = this.clearLine(state, worldCells[world], chanceTarget);
            const distance = Math.abs(state.x(worldCells[world]) - state.x(chanceTarget)) +
              Math.abs(state.y(worldCells[world]) - state.y(chanceTarget));
            const escapes = aligned ? this.escapeCount(state, chanceTarget,
              state.x(worldCells[world]) === state.x(chanceTarget) ?
                state.y(chanceTarget) < state.y(worldCells[world]) ? 0 : 2 :
                state.x(chanceTarget) > state.x(worldCells[world]) ? 1 : 3) : 0;
            const unavoidableAtFire = aligned &&
              (distance <= RULE.PROJECTILE_STEPS || escapes === 0);
            if (unavoidableAtFire || !aligned) {
              if (depth === 1) mass1 = Math.min(10000, mass1 + mass);
              else if (depth === 2) mass2 = Math.min(10000, mass2 + mass);
              else if (depth === 3) mass3 = Math.min(10000, mass3 + mass);
              else mass4 = Math.min(10000, mass4 + mass);
            }
            minimumSlack = Math.min(minimumSlack, escapes - 1);
          }
          if (mass1 > maximum1) maximum1 = mass1;
          if (mass2 > maximum2) maximum2 = mass2;
          if (mass3 > maximum3) maximum3 = mass3;
          if (mass4 > maximum4) maximum4 = mass4;
          if (this.interrupted) break;
        }
        output.addFutureFire(row, 1, maximum1); output.addFutureFire(row, 2, maximum2);
        output.addFutureFire(row, 3, maximum3); output.addFutureFire(row, 4, maximum4);
      }
      if (fireSupport && worldCount === 0) {
        threatened = 1; output.unknownMass[row] = 10000;
      }
      if (!supportComplete || !capabilityComplete || !strategyConsistent || this.interrupted)
        output.unknownMass[row] = Math.max(output.unknownMass[row], 1);
      output.escapeSlack[row] = Math.max(-4, Math.min(4, minimumSlack));
      output.coverage[row] = supportComplete && capabilityComplete && strategyConsistent &&
        !this.interrupted ? 10000 :
        Math.max(0, 10000 - output.unknownMass[row]);
      if (output.status[row] !== SAFETY_STATUS.PROVEN_DEAD) {
        if (output.horizonFatalMass[row] > 0) output.status[row] = SAFETY_STATUS.POSSIBLE_DEATH;
        else if (output.unknownMass[row] > 0 || threatened)
          output.status[row] = threatened ? SAFETY_STATUS.POSSIBLE_DEATH : SAFETY_STATUS.UNKNOWN;
        else if (supportComplete && capabilityComplete && strategyConsistent && !this.interrupted)
          output.status[row] = SAFETY_STATUS.PROVEN_SAFE;
        else output.status[row] = SAFETY_STATUS.UNKNOWN;
      }
      this.completedActions += 1;
    }
    return output;
  }
}

module.exports = { SAFETY_STATUS, SAFETY_HORIZON, NONE_FATAL_FRAME,
  FRONTIER_ACTION_MASS_UPPER, SafetyOutcomeSlab, InformationSafetyClosure };
