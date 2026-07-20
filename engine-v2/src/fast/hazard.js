"use strict";

const { CAPACITY, RULE } = require("../generated/fast-config");
const { TERRAIN, SKILL, NONE_FRAME, NONE_CELL, DX, DY } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");

class HazardKernel {
  constructor(state) {
    this.state = state; this.stepsPerFrame = RULE.PROJECTILE_STEPS;
    this.maxTicks = CAPACITY.MAX_HAZARD_FRAMES * this.stepsPerFrame;
    this.cellStride = state.cells; const slots = (this.maxTicks + 1) * this.cellStride;
    this.exposure = new Uint8Array(slots); this.lethal = new Uint8Array(slots);
    this.viableA = new Uint8Array(this.cellStride * 4);
    this.viableB = new Uint8Array(this.cellStride * 4);
    this.planSourceId = new Uint32Array(CAPACITY.MAX_PROJECTILES + CAPACITY.MAX_BOMBS);
    this.planGeneration = new Uint16Array(this.planSourceId.length);
    this.planEndTick = new Uint16Array(this.planSourceId.length);
    this.planCount = 0; this.horizonTick = 0; this.complete = 1;
    this.narrowProofComplete = 1;
    this.builtHashLo = 0xffffffff; this.builtHashHi = 0xffffffff;
    this.builtTerrainVersion = 0xffffffff; this.rebuildCount = 0; this.cacheHitCount = 0;
    this.highWaterTick = 0; this.hotAllocationCount = 0;
  }

  clearUsed() {
    const cells = this.state.cells;
    for (let tick = 0; tick <= this.horizonTick; tick += 1) {
      const start = tick * this.cellStride; const end = start + cells;
      this.exposure.fill(0, start, end); this.lethal.fill(0, start, end);
    }
    this.planCount = 0; this.horizonTick = 0; this.complete = 1; this.narrowProofComplete = 1;
  }
  offset(tick, cell) { return tick * this.cellStride + cell; }
  target(cell, direction) {
    const x = this.state.x(cell) + DX[direction]; const y = this.state.y(cell) + DY[direction];
    return x < 0 || x >= this.state.width || y < 0 || y >= this.state.height ? NONE_CELL :
      this.state.cell(x, y);
  }
  add(tick, cell, lethal) {
    if (tick > this.maxTicks || cell === NONE_CELL) { this.complete = 0; return 0; }
    const at = this.offset(tick, cell);
    if (this.exposure[at] !== 0xff) this.exposure[at] += 1;
    if (lethal) this.lethal[at] = 1;
    if (tick > this.horizonTick) this.horizonTick = tick;
    return 1;
  }
  recordPlan(id, generation, endTick) {
    if (this.planCount >= this.planSourceId.length) { this.complete = 0; return 0; }
    const at = this.planCount++; this.planSourceId[at] = id;
    this.planGeneration[at] = generation; this.planEndTick[at] = endTick; return 1;
  }
  bombHits(center, candidate) {
    const cx = this.state.x(center); const cy = this.state.y(center);
    const tx = this.state.x(candidate); const ty = this.state.y(candidate);
    if (cx === tx && cy === ty) return 1;
    if (cx !== tx && cy !== ty) return 0;
    const distance = Math.abs(cx - tx) + Math.abs(cy - ty); if (distance > RULE.BOMB_RANGE) return 0;
    const dx = tx === cx ? 0 : tx > cx ? 1 : -1; const dy = ty === cy ? 0 : ty > cy ? 1 : -1;
    const terrain = this.state.arrays[ARRAY.TERRAIN];
    for (let step = 1; step <= distance; step += 1) {
      const cell = this.state.cell(cx + dx * step, cy + dy * step);
      if (terrain[cell] === TERRAIN.WALL) return 0;
      if (terrain[cell] === TERRAIN.DIRT) return step === distance ? 1 : 0;
    }
    return 1;
  }

  rebuild(perspectiveSeat = 0) {
    const state = this.state; const a = state.arrays;
    const terrainVersion = a[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION];
    if (this.builtHashLo === state.hashLo && this.builtHashHi === state.hashHi &&
        this.builtTerrainVersion === terrainVersion) { this.cacheHitCount += 1; return this.complete; }
    this.clearUsed(); const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot]) {
        let cell = a[ARRAY.PROJECTILE_CELL][slot]; const direction = a[ARRAY.PROJECTILE_DIR][slot];
        let tick = 0; const hostile = a[ARRAY.PROJECTILE_OWNER][slot] !== perspectiveSeat;
        while (tick < this.maxTicks) {
          tick += 1; cell = this.target(cell, direction); if (cell === NONE_CELL) break;
          const tile = a[ARRAY.TERRAIN][cell];
          if (!this.add(tick, cell, hostile)) break;
          if (tile === TERRAIN.WALL) break;
          if (tile === TERRAIN.DIRT) { if (hostile) this.narrowProofComplete = 0; break; }
        }
        if (!this.recordPlan(a[ARRAY.PROJECTILE_ID][slot],
          a[ARRAY.PROJECTILE_GENERATION][slot], tick)) break;
      }
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS && this.complete; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot]) {
        const remainingFrames = Math.max(0, a[ARRAY.BOMB_EXPLODE][slot] - frame);
        const tick = remainingFrames * this.stepsPerFrame;
        if (tick > this.maxTicks) { this.complete = 0; break; }
        const center = a[ARRAY.BOMB_CELL][slot];
        for (let cell = 0; cell < state.cells; cell += 1)
          if (this.bombHits(center, cell) && !this.add(tick, cell, 1)) break;
        if (!this.recordPlan(a[ARRAY.BOMB_ID][slot], a[ARRAY.BOMB_GENERATION][slot], tick)) break;
      }
    this.builtHashLo = state.hashLo; this.builtHashHi = state.hashHi;
    this.builtTerrainVersion = terrainVersion; this.rebuildCount += 1;
    if (this.horizonTick > this.highWaterTick) this.highWaterTick = this.horizonTick;
    return this.complete;
  }

  isLethal(tick, cell) {
    return tick <= this.horizonTick && this.lethal[this.offset(tick, cell)] !== 0;
  }
  isExposed(tick, cell) {
    return tick <= this.horizonTick && this.exposure[this.offset(tick, cell)] !== 0;
  }

  reverseViable(perspectiveSeat = 0) {
    if (!this.rebuild(perspectiveSeat)) return -1;
    const a = this.state.arrays; const cells = this.state.cells;
    let next = this.viableA; let current = this.viableB; next.fill(0); current.fill(0);
    for (let cell = 0; cell < cells; cell += 1) if (a[ARRAY.TERRAIN][cell] !== TERRAIN.WALL &&
        a[ARRAY.TERRAIN][cell] !== TERRAIN.DIRT && !this.isLethal(this.horizonTick, cell))
      for (let direction = 0; direction < 4; direction += 1) next[cell * 4 + direction] = 1;
    for (let tick = this.horizonTick - 1; tick >= 0; tick -= 1) {
      current.fill(0);
      for (let cell = 0; cell < cells; cell += 1) if (a[ARRAY.TERRAIN][cell] !== TERRAIN.WALL &&
          a[ARRAY.TERRAIN][cell] !== TERRAIN.DIRT && !this.isLethal(tick, cell)) {
        for (let direction = 0; direction < 4; direction += 1) {
          let viable = next[cell * 4 + direction];
          if ((tick & 1) === 0) {
            viable = viable || next[cell * 4 + ((direction + 1) & 3)] ||
              next[cell * 4 + ((direction + 3) & 3)];
            const forward = this.target(cell, direction);
            if (!viable && forward !== NONE_CELL && a[ARRAY.TERRAIN][forward] !== TERRAIN.WALL &&
                a[ARRAY.TERRAIN][forward] !== TERRAIN.DIRT && !this.isLethal(tick + 1, forward) &&
                next[forward * 4 + direction]) viable = 1;
          }
          if (viable) current[cell * 4 + direction] = 1;
        }
      }
      const swap = next; next = current; current = swap;
    }
    const rootCell = a[ARRAY.TANK_CELL][perspectiveSeat];
    const rootDirection = a[ARRAY.TANK_DIR][perspectiveSeat];
    if (next[rootCell * 4 + rootDirection]) return 1;
    const specialEscape = (a[ARRAY.TANK_SHIELD_HITS][perspectiveSeat] > 0 &&
      a[ARRAY.TANK_SHIELD_UNTIL][perspectiveSeat] !== NONE_FRAME) ||
      a[ARRAY.TANK_BOOST_UNTIL][perspectiveSeat] !== NONE_FRAME ||
      (a[ARRAY.TANK_SKILL][perspectiveSeat] === SKILL.TELEPORT &&
      a[ARRAY.TANK_SKILL_READY][perspectiveSeat] <= a[ARRAY.SCALAR][SCALAR.FRAME]);
    return specialEscape || !this.narrowProofComplete ? -1 : 0;
  }
}

module.exports = { HazardKernel };
