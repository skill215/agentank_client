"use strict";

const { CAPACITY, RULE } = require("../generated/fast-config");
const { TERRAIN, NONE_FRAME, NONE_CELL, DX, DY } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");

const THREAT_CAPABILITY_HORIZON = 4;
const NONE_CAPABILITY_DEPTH = 0xff;

// Root-shared, allocation-free capability schedule. It does not choose an
// enemy policy; it only states on which decision frames acting and firing are
// physically supported after current projectile occupancy/effect cadence.
class ThreatCapabilityTimeline {
  constructor() {
    this.canAct = new Uint8Array(THREAT_CAPABILITY_HORIZON + 1);
    this.canFire = new Uint8Array(THREAT_CAPABILITY_HORIZON + 1);
    this.frame = 0; this.seat = 1; this.complete = 0; this.hasFireSupport = 0;
    this.activeProjectileCount = 0; this.projectileReleaseDepth = 1;
    this.earliestFireDepth = NONE_CAPABILITY_DEPTH; this.maximumStopTick = 0;
    this.hotAllocationCount = 0;
  }
  target(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ? NONE_CELL :
      state.cell(x, y);
  }
  stopTick(state, cell, direction) {
    const terrain = state.arrays[ARRAY.TERRAIN];
    const maximum = THREAT_CAPABILITY_HORIZON * RULE.PROJECTILE_STEPS;
    for (let tick = 1; tick <= maximum; tick += 1) {
      cell = this.target(state, cell, direction); if (cell === NONE_CELL) return tick;
      const tile = terrain[cell]; if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return tick;
    }
    return NONE_CAPABILITY_DEPTH;
  }
  projectileRelease(state, seat) {
    const a = state.arrays; let maximumTick = 0; this.activeProjectileCount = 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] && a[ARRAY.PROJECTILE_OWNER][slot] === seat) {
        this.activeProjectileCount += 1;
        const tick = this.stopTick(state, a[ARRAY.PROJECTILE_CELL][slot],
          a[ARRAY.PROJECTILE_DIR][slot]);
        if (tick === NONE_CAPABILITY_DEPTH) return NONE_CAPABILITY_DEPTH;
        if (tick > maximumTick) maximumTick = tick;
      }
    this.maximumStopTick = maximumTick;
    return this.activeProjectileCount === 0 ? 1 :
      Math.floor((maximumTick + RULE.PROJECTILE_STEPS - 1) / RULE.PROJECTILE_STEPS) + 1;
  }
  actionAvailable(a, seat, actionFrame) {
    const frozenUntil = a[ARRAY.TANK_FROZEN_UNTIL][seat];
    if (frozenUntil !== NONE_FRAME && frozenUntil > actionFrame) return 0;
    const poisonUntil = a[ARRAY.TANK_POISON_UNTIL][seat];
    if (poisonUntil !== NONE_FRAME && poisonUntil > actionFrame) {
      const applied = a[ARRAY.TANK_POISON_APPLIED][seat];
      if (applied === NONE_FRAME) { this.complete = 0; return 1; }
      if (((actionFrame - applied) & 1) !== 0) return 0;
    }
    return 1;
  }
  prepare(bundle, seat = 1, rootCanAct = 1, rootCanFire = 1, supportComplete = 1) {
    this.canAct.fill(0); this.canFire.fill(0); this.hasFireSupport = 0;
    this.earliestFireDepth = NONE_CAPABILITY_DEPTH; this.maximumStopTick = 0;
    this.activeProjectileCount = 0; this.projectileReleaseDepth = NONE_CAPABILITY_DEPTH;
    this.complete = supportComplete ? 1 : 0; this.seat = seat;
    if (!bundle || !bundle.state) { this.complete = 0; return 0; }
    const state = bundle.state; const a = state.arrays; this.frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    this.projectileReleaseDepth = this.projectileRelease(state, seat);
    const fireLock = a[ARRAY.TANK_FIRE_LOCK][seat];
    for (let depth = 1; depth <= THREAT_CAPABILITY_HORIZON; depth += 1) {
      const actionFrame = this.frame + depth - 1;
      let canAct = this.actionAvailable(a, seat, actionFrame);
      if (depth === 1) canAct = rootCanAct ? 1 : 0;
      const projectileFree = this.projectileReleaseDepth !== NONE_CAPABILITY_DEPTH &&
        depth >= this.projectileReleaseDepth;
      const fireUnlocked = fireLock === NONE_FRAME || fireLock <= actionFrame;
      let canFire = canAct && projectileFree && fireUnlocked ? 1 : 0;
      if (depth === 1) canFire = rootCanFire ? 1 : 0;
      this.canAct[depth] = canAct; this.canFire[depth] = canFire;
      if (canFire) { this.hasFireSupport = 1;
        if (this.earliestFireDepth === NONE_CAPABILITY_DEPTH) this.earliestFireDepth = depth; }
    }
    if (rootCanFire && (!rootCanAct || this.activeProjectileCount > 0)) this.complete = 0;
    return this.complete;
  }
  earliestCompletion(requiredActions) {
    if (!Number.isSafeInteger(requiredActions) || requiredActions < 1)
      return NONE_CAPABILITY_DEPTH;
    let prepared = 0;
    for (let depth = 1; depth <= THREAT_CAPABILITY_HORIZON; depth += 1) {
      if (this.canFire[depth] && prepared >= requiredActions - 1) return depth;
      if (this.canAct[depth]) prepared += 1;
    }
    return NONE_CAPABILITY_DEPTH;
  }
}

module.exports = { THREAT_CAPABILITY_HORIZON, NONE_CAPABILITY_DEPTH,
  ThreatCapabilityTimeline };
