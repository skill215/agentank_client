"use strict";

const { CAPACITY, RULE } = require("../generated/fast-config");
const { TERRAIN, NONE_CELL, DX, DY } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { SAFETY_HORIZON, FRONTIER_ACTION_MASS_UPPER } =
  require("../search/information-safety-closure");

const DIRECTION_COUNT = 4;
const STATE_CAPACITY = CAPACITY.MAX_CELLS * DIRECTION_COUNT;
const HORIZON_CAPACITY = (SAFETY_HORIZON + 1) * CAPACITY.MAX_CELLS;

// Risk-only support for bullets which may have been fired while the enemy was
// hidden.  These are alternative InformationState worlds, not physical
// ProjectileTrackPool entities, so they may affect Safety/Risk but never Hard.
class HiddenProjectileRiskField {
  constructor() {
    this.reachA = new Uint16Array(STATE_CAPACITY);
    this.reachB = new Uint16Array(STATE_CAPACITY);
    this.projectileA = new Uint16Array(STATE_CAPACITY);
    this.projectileB = new Uint16Array(STATE_CAPACITY);
    this.reachMask = new Uint8Array(CAPACITY.MAX_CELLS);
    this.horizonMass = new Uint16Array(HORIZON_CAPACITY);
    this.complete = 0; this.activeCount = 0; this.elapsedFrames = 0;
    this.transitionNodes = 0; this.horizonNodes = 0; this.buildCount = 0;
    this.hotAllocationCount = 0; this.prepared = 0;
  }
  reset() {
    this.reachA.fill(0); this.reachB.fill(0); this.projectileA.fill(0);
    this.projectileB.fill(0); this.reachMask.fill(0); this.horizonMass.fill(0);
    this.complete = 0; this.activeCount = 0; this.elapsedFrames = 0;
    this.transitionNodes = 0; this.horizonNodes = 0; this.prepared = 0;
  }
  target(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ? NONE_CELL :
      state.cell(x, y);
  }
  valid(state, cell) {
    if (cell === NONE_CELL) return 0; const tile = state.arrays[ARRAY.TERRAIN][cell];
    return tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT;
  }
  add(array, cell, direction, mass) {
    if (cell === NONE_CELL || mass <= 0) return;
    const at = cell * DIRECTION_COUNT + direction;
    if (mass > array[at]) array[at] = mass;
  }
  advanceProjectiles(state) {
    this.projectileB.fill(0);
    for (let id = 0; id < STATE_CAPACITY; id += 1) {
      const mass = this.projectileA[id]; if (!mass) continue;
      let cell = id >>> 2; const direction = id & 3; let live = 1;
      for (let step = 0; step < RULE.PROJECTILE_STEPS; step += 1) {
        cell = this.target(state, cell, direction);
        if (!this.valid(state, cell)) { live = 0; break; }
      }
      if (live) this.add(this.projectileB, cell, direction, mass);
      this.transitionNodes += 1;
    }
    const swap = this.projectileA; this.projectileA = this.projectileB;
    this.projectileB = swap;
  }
  propagateReach(state, maximumSpeed) {
    this.reachB.fill(0);
    for (let id = 0; id < STATE_CAPACITY; id += 1) {
      const mass = this.reachA[id]; if (!mass) continue;
      const cell = id >>> 2; const direction = id & 3;
      const nextMass = Math.max(1, Math.floor(mass * FRONTIER_ACTION_MASS_UPPER / 10000));
      this.add(this.reachB, cell, direction, nextMass);
      this.add(this.reachB, cell, (direction + 3) & 3, nextMass);
      this.add(this.reachB, cell, (direction + 1) & 3, nextMass);
      let forward = cell; let backward = cell;
      for (let step = 0; step < maximumSpeed; step += 1) {
        const nextForward = this.target(state, forward, direction);
        if (this.valid(state, nextForward)) forward = nextForward;
        const nextBackward = this.target(state, backward, (direction + 2) & 3);
        if (this.valid(state, nextBackward)) backward = nextBackward;
      }
      this.add(this.reachB, forward, direction, nextMass);
      this.add(this.reachB, backward, direction, nextMass);
      this.transitionNodes += 1;
    }
    const swap = this.reachA; this.reachA = this.reachB; this.reachB = swap;
  }
  spawn(enemyFireProbability) {
    for (let id = 0; id < STATE_CAPACITY; id += 1) {
      const reachMass = this.reachA[id]; if (!reachMass) continue;
      const fireMass = Math.max(1, Math.floor(reachMass * enemyFireProbability / 10000));
      if (fireMass > this.projectileA[id]) this.projectileA[id] = fireMass;
    }
  }
  build(state, seedCell, seedDirection, elapsedFrames, maximumSpeed,
      enemyFireProbability, refutedCurrentCell = NONE_CELL) {
    this.reset();
    if (!state || seedCell === NONE_CELL || seedDirection < 0 || seedDirection > 3 ||
        elapsedFrames < 1 || maximumSpeed < 1) return 0;
    this.reachA[seedCell * DIRECTION_COUNT + seedDirection] = 10000;
    const elapsed = Math.min(CAPACITY.MAX_HAZARD_FRAMES, elapsedFrames | 0);
    for (let frame = 0; frame < elapsed; frame += 1) {
      this.spawn(Math.max(1, Math.min(10000, enemyFireProbability | 0)));
      this.advanceProjectiles(state); this.propagateReach(state, maximumSpeed);
    }
    for (let id = 0; id < STATE_CAPACITY; id += 1) {
      const mass = this.reachA[id]; if (mass) this.reachMask[id >>> 2] |= 1 << (id & 3);
      if (!this.projectileA[id]) continue;
      if ((id >>> 2) === refutedCurrentCell) this.projectileA[id] = 0;
      else this.activeCount += 1;
    }
    this.elapsedFrames = elapsed; this.complete = elapsed === elapsedFrames ? 1 : 0;
    this.buildCount += 1; return this.complete;
  }
  count() { return this.activeCount; }
  prepareHorizon(state, maximumFrames = SAFETY_HORIZON) {
    this.horizonMass.fill(0); this.horizonNodes = 0;
    const maximum = Math.max(1, Math.min(SAFETY_HORIZON, maximumFrames | 0));
    for (let id = 0; id < STATE_CAPACITY; id += 1) {
      const mass = this.projectileA[id]; if (!mass) continue;
      let cell = id >>> 2; const direction = id & 3; let live = 1;
      for (let depth = 1; depth <= maximum && live; depth += 1)
        for (let step = 0; step < RULE.PROJECTILE_STEPS; step += 1) {
          cell = this.target(state, cell, direction);
          if (!this.valid(state, cell)) { live = 0; break; }
          const at = depth * CAPACITY.MAX_CELLS + cell;
          if (this.horizonMass[at] === 0) this.horizonNodes += 1;
          if (mass > this.horizonMass[at]) this.horizonMass[at] = mass;
        }
    }
    this.prepared = 1; return 1;
  }
  preparedLethalMassAt(cell, depth) {
    if (!this.prepared || depth < 1 || depth > SAFETY_HORIZON) return 0;
    return this.horizonMass[depth * CAPACITY.MAX_CELLS + cell];
  }
}

module.exports = { DIRECTION_COUNT, STATE_CAPACITY, HiddenProjectileRiskField };
