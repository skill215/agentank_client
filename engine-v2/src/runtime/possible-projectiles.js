"use strict";

const { CAPACITY, RULE } = require("../generated/fast-config");
const { TERRAIN, NONE_FRAME, NONE_CELL, DX, DY } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ProjectileTrackPool, PROJECTILE_FACT } = require("./projectile-track-pool");

const POSSIBLE_HORIZON = 4;
const HORIZON_CELL_SLOTS = (POSSIBLE_HORIZON + 1) * CAPACITY.MAX_CELLS;

class PossibleProjectileTracker {
  constructor() {
    this.pool = new ProjectileTrackPool({ defaultFact: PROJECTILE_FACT.POSSIBLE });
    this.active = this.pool.active; this.cell = this.pool.cell; this.direction = this.pool.direction;
    this.firedFrame = this.pool.created; this.mass = this.pool.mass;
    this.lastFrame = NONE_FRAME; this.generation = 1; this.addCount = 0;
    this.trajectoryVersion = 1;
    this.horizonMass = new Uint16Array(HORIZON_CELL_SLOTS * 4);
    this.horizonAnyMass = new Uint16Array(HORIZON_CELL_SLOTS);
    this.horizonStamp = new Uint16Array(HORIZON_CELL_SLOTS);
    this.horizonGeneration = 0; this.horizonState = null;
    this.horizonTrackerVersion = 0; this.horizonTerrainVersion = 0xffffffff;
    this.horizonMaximumFrames = 0; this.horizonBuildCount = 0;
    this.horizonCacheHitCount = 0; this.horizonCacheHit = 0;
    this.expireCount = 0; this.mergeCount = 0; this.capacityFailureCount = 0;
    this.lastHorizonMass = 0; this.lastHorizonFrame = 0xff; this.lastEscapeSlack = 4;
    this.hotAllocationCount = 0;
  }
  touchTrajectory() {
    this.trajectoryVersion = (this.trajectoryVersion + 1) >>> 0;
    if (!this.trajectoryVersion) this.trajectoryVersion = 1;
    return this.trajectoryVersion;
  }
  reset(frame = NONE_FRAME) {
    this.pool.reset(frame); this.lastFrame = frame; this.generation += 1;
    this.touchTrajectory();
  }
  target(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ? NONE_CELL : state.cell(x, y);
  }
  validTarget(state, cell) {
    if (cell === NONE_CELL) return 0; const tile = state.arrays[ARRAY.TERRAIN][cell];
    return tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT;
  }
  advanceSlot(state, slot, steps, refutedCell = NONE_CELL) {
    const original = this.cell[slot]; let cell = original; const direction = this.direction[slot];
    for (let step = 0; step < steps; step += 1) {
      const next = this.target(state, cell, direction);
      if (!this.validTarget(state, next)) { this.active[slot] = 0; this.expireCount += 1;
        this.touchTrajectory(); return 0; }
      cell = next;
      // The tank is observably alive at the current root. A hidden world whose
      // projectile must already have crossed that root cell is refuted.
      if (cell === refutedCell) { this.active[slot] = 0; this.expireCount += 1;
        this.touchTrajectory(); return 0; }
    }
    this.cell[slot] = cell; if (cell !== original) this.touchTrajectory(); return 1;
  }
  advance(state, frame, refutedCell = NONE_CELL) {
    this.pool.advance(frame, state.arrays[ARRAY.TERRAIN], state.width, state.height, refutedCell);
    this.lastFrame = frame; this.expireCount = this.pool.expireCount;
    this.touchTrajectory();
  }
  addFired(state, sourceCell, direction, firedFrame, currentFrame, refutedCell = NONE_CELL,
      probability = 5000) {
    if (sourceCell === NONE_CELL || direction < 0 || direction > 3) return 0;
    let cell = sourceCell;
    const steps = Math.max(0, Math.min(CAPACITY.MAX_HAZARD_FRAMES,
      currentFrame - firedFrame)) * RULE.PROJECTILE_STEPS;
    for (let step = 0; step < steps; step += 1) {
      cell = this.target(state, cell, direction);
      if (!this.validTarget(state, cell) || cell === refutedCell) return 0;
    }
    const slot = this.pool.allocate(1, cell, direction, firedFrame, PROJECTILE_FACT.POSSIBLE,
      probability); this.addCount = this.pool.addCount; this.capacityFailureCount =
    this.pool.capacityFailureCount;
    if (slot >= 0) this.touchTrajectory();
    return slot >= 0 ? 1 : 0;
  }
  count() { return this.pool.count(); }
  nextHorizonGeneration() {
    this.horizonGeneration = (this.horizonGeneration + 1) & 0xffff;
    if (!this.horizonGeneration) { this.horizonStamp.fill(0); this.horizonGeneration = 1; }
    return this.horizonGeneration;
  }
  prepareHorizon(state, maximumFrames = POSSIBLE_HORIZON) {
    const maximum = Math.max(1, Math.min(POSSIBLE_HORIZON, maximumFrames | 0));
    const terrainVersion = state.arrays[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION];
    if (this.horizonState === state && this.horizonTrackerVersion === this.trajectoryVersion &&
        this.horizonTerrainVersion === terrainVersion && this.horizonMaximumFrames >= maximum) {
      this.horizonCacheHit = 1; this.horizonCacheHitCount += 1; return 1;
    }
    this.horizonCacheHit = 0; this.nextHorizonGeneration();
    const terrain = state.arrays[ARRAY.TERRAIN]; const width = state.width;
    const height = state.height;
    for (let slot = 0; slot < this.active.length; slot += 1) if (this.active[slot]) {
      let cell = this.cell[slot]; const direction = this.direction[slot];
      let x = cell % width; let y = (cell / width) | 0; const dx = DX[direction];
      const dy = DY[direction]; let live = 1;
      for (let depth = 1; depth <= maximum && live; depth += 1)
        for (let step = 0; step < RULE.PROJECTILE_STEPS; step += 1) {
          x += dx; y += dy;
          if (x < 0 || x >= width || y < 0 || y >= height) { live = 0; break; }
          cell = y * width + x;
          if (terrain[cell] === TERRAIN.WALL || terrain[cell] === TERRAIN.DIRT) {
            live = 0; break;
          }
          const at = depth * CAPACITY.MAX_CELLS + cell; const base = at * 4;
          if (this.horizonStamp[at] !== this.horizonGeneration) {
            this.horizonStamp[at] = this.horizonGeneration;
            this.horizonMass.fill(0, base, base + 4);
            this.horizonAnyMass[at] = 0;
          }
          if (this.mass[slot] > this.horizonMass[base + direction])
            this.horizonMass[base + direction] = this.mass[slot];
          if (this.mass[slot] > this.horizonAnyMass[at])
            this.horizonAnyMass[at] = this.mass[slot];
        }
    }
    this.horizonState = state; this.horizonTrackerVersion = this.trajectoryVersion;
    this.horizonTerrainVersion = terrainVersion; this.horizonMaximumFrames = maximum;
    this.horizonBuildCount += 1; return 1;
  }
  trajectoryRisk(state, sourceCell, shotDirection, candidateCell, candidateDirection) {
    let projectile = sourceCell;
    for (let step = 0; step < RULE.PROJECTILE_STEPS; step += 1) {
      projectile = this.target(state, projectile, shotDirection);
      if (!this.validTarget(state, projectile)) return 0;
      if (projectile === candidateCell) return 10000;
    }
    const px = state.x(projectile); const py = state.y(projectile);
    const tx = state.x(candidateCell); const ty = state.y(candidateCell);
    const approaching = shotDirection === 0 ? px === tx && py > ty :
      shotDirection === 1 ? py === ty && px < tx : shotDirection === 2 ? px === tx && py < ty :
        py === ty && px > tx;
    if (!approaching) return 0;
    const distance = Math.abs(px - tx) + Math.abs(py - ty);
    const arrivalFrames = Math.max(1, Math.floor((distance + RULE.PROJECTILE_STEPS - 1) /
      RULE.PROJECTILE_STEPS));
    const escape = this.target(state, candidateCell, candidateDirection);
    const perpendicularEscape = (candidateDirection & 1) !== (shotDirection & 1) &&
      this.validTarget(state, escape);
    if (perpendicularEscape) return Math.max(2500, 5000 - arrivalFrames * 500);
    return Math.max(4000, 10000 - arrivalFrames * 600);
  }
  risk(state, candidateCell, candidateDirection) {
    let risk = 0;
    for (let slot = 0; slot < this.active.length; slot += 1) if (this.active[slot])
      risk = Math.max(risk, this.trajectoryRisk(state, this.cell[slot], this.direction[slot],
        candidateCell, candidateDirection));
    return risk;
  }
  lethalMass(state, candidateCell) {
    return this.lethalMassAt(state, candidateCell, 1);
  }
  lethalMassAt(state, candidateCell, frameOffset) {
    if (!Number.isSafeInteger(frameOffset) || frameOffset < 1 ||
        frameOffset > POSSIBLE_HORIZON) return 0;
    this.prepareHorizon(state, frameOffset);
    return this.preparedLethalMassAt(candidateCell, frameOffset);
  }
  preparedLethalMassAt(candidateCell, frameOffset) {
    const at = frameOffset * CAPACITY.MAX_CELLS + candidateCell;
    if (this.horizonStamp[at] !== this.horizonGeneration) return 0;
    return this.horizonAnyMass[at];
  }
  evaluateHorizon(state, candidateCell, candidateDirection, maximumFrames = 4) {
    this.lastHorizonMass = 0; this.lastHorizonFrame = 0xff; this.lastEscapeSlack = 4;
    const maximum = Math.max(1, Math.min(POSSIBLE_HORIZON, maximumFrames | 0));
    this.prepareHorizon(state, maximum);
    for (let arrival = 1; arrival <= maximum; arrival += 1) {
      const at = arrival * CAPACITY.MAX_CELLS + candidateCell;
      if (this.horizonStamp[at] !== this.horizonGeneration) continue;
      const base = at * 4; let fatalMass = 0;
      for (let shotDirection = 0; shotDirection < 4; shotDirection += 1) {
        const mass = this.horizonMass[base + shotDirection]; if (!mass) continue;
        const left = (shotDirection + 3) & 3; const right = (shotDirection + 1) & 3;
        const leftCell = this.target(state, candidateCell, left);
        const rightCell = this.target(state, candidateCell, right);
        const hasEscape = this.validTarget(state, leftCell) || this.validTarget(state, rightCell);
        let escapeFrames = 0xff;
        if (hasEscape) escapeFrames = (candidateDirection & 1) !== (shotDirection & 1) ? 1 : 2;
        const slack = escapeFrames === 0xff ? -4 : arrival - escapeFrames - 1;
        if (slack < this.lastEscapeSlack) this.lastEscapeSlack = Math.max(-4, slack);
        if (escapeFrames >= arrival && mass > fatalMass) fatalMass = mass;
      }
      if (fatalMass > 0 && this.lastHorizonFrame === 0xff) {
        this.lastHorizonFrame = arrival; this.lastHorizonMass = fatalMass;
      }
    }
    return this.lastHorizonMass;
  }
}

module.exports = { POSSIBLE_HORIZON, PossibleProjectileTracker };
