"use strict";

const { CAPACITY, RULE } = require("../generated/fast-config");
const { TERRAIN, SKILL, NONE_FRAME, NONE_CELL, DX, DY } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");

// FNV-style shift/add mixing works in the restricted production sandbox,
// without relying on platform-specific multiplication intrinsics.
function mix(hash, value) {
  let result = (hash ^ (value >>> 0)) >>> 0;
  result = (result + ((result << 1) >>> 0) + ((result << 4) >>> 0) +
    ((result << 7) >>> 0) + ((result << 8) >>> 0) + ((result << 24) >>> 0)) >>> 0;
  return result;
}

class HazardKernel {
  constructor(state, options = {}) {
    this.state = state; this.stepsPerFrame = RULE.PROJECTILE_STEPS;
    this.hazardSignatureCacheEnabled = options.hazardSignatureCache !== false ? 1 : 0;
    this.reverseLatticeIncludesOwnProjectiles = options.reverseLatticeIncludesOwnProjectiles === true ? 1 : 0;
    // Reversible version counters do not identify sibling-branch terrain.
    // Compare exact bytes before any terrain-dependent cache lookup.
    this.terrainIdentity = new Uint8Array(state.cells);
    this.terrainIdentityValid = 0; this.terrainIdentityInvalidations = 0;
    // Committed hazards cannot remain on the board for 128 frames. A projectile
    // travels in a straight line and therefore leaves a WxH board in at most
    // max(W,H) ticks; a bomb expires after its fixed fuse. Keeping the full
    // match horizon here used more than half of the production memory for rows
    // that can never be addressed. Observations outside this physical bound
    // fail closed in rebuild() instead of extending the arena.
    this.maxTicks = Math.max(state.width, state.height,
      RULE.BOMB_FUSE * this.stepsPerFrame);
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
    const requestedCacheEntries = Number.isSafeInteger(options.reverseViabilityCacheEntries) ?
      Math.max(0, Math.min(128, options.reverseViabilityCacheEntries)) : 0;
    let entries = 0;
    if (requestedCacheEntries > 0) {
      entries = 1;
      while (entries < requestedCacheEntries) entries <<= 1;
    }
    this.reverseCacheEntries = entries;
    this.reverseCacheValid = entries ? new Uint8Array(entries) : null;
    this.reverseCacheHashLo = entries ? new Uint32Array(entries) : null;
    this.reverseCacheHashHi = entries ? new Uint32Array(entries) : null;
    this.reverseCacheTerrain = entries ? new Uint32Array(entries) : null;
    this.reverseCacheSeat = entries ? new Uint8Array(entries) : null;
    this.reverseCacheResult = entries ? new Int8Array(entries) : null;
    this.reverseCacheHitCount = 0; this.reverseCacheMissCount = 0;
    const requestedLatticeEntries = Number.isSafeInteger(options.reverseLatticeCacheEntries) ?
      Math.max(0, Math.min(16, options.reverseLatticeCacheEntries)) : 0;
    let latticeEntries = 0;
    if (requestedLatticeEntries > 0) {
      latticeEntries = 1;
      while (latticeEntries < requestedLatticeEntries) latticeEntries <<= 1;
    }
    this.reverseLatticeEntries = latticeEntries;
    this.reverseLatticeStride = this.cellStride * 4;
    this.reverseLatticeValid = latticeEntries ? new Uint8Array(latticeEntries) : null;
    this.reverseLatticeHashLo = latticeEntries ? new Uint32Array(latticeEntries) : null;
    this.reverseLatticeHashHi = latticeEntries ? new Uint32Array(latticeEntries) : null;
    this.reverseLatticeGrid = latticeEntries ?
      new Uint8Array(latticeEntries * this.reverseLatticeStride) : null;
    this.reverseLatticeLayerCacheEnabled = options.reverseLatticeLayerCache === true ? 1 : 0;
    this.reverseLatticeTick1 = latticeEntries && this.reverseLatticeLayerCacheEnabled ?
      new Uint8Array(latticeEntries * this.reverseLatticeStride) : null;
    this.reverseLatticeTick2 = latticeEntries && this.reverseLatticeLayerCacheEnabled ?
      new Uint8Array(latticeEntries * this.reverseLatticeStride) : null;
    this.reverseLatticeHitCount = 0; this.reverseLatticeMissCount = 0;
    this.reverseLatticeLayerHitCount = 0; this.reverseLatticeLayerMissCount = 0;
    this.reverseLatticeBuildCount = 0; this.reverseLatticeBuildNodeCount = 0;
    this.reverseUncachedBuildCount = 0; this.reverseUncachedBuildNodeCount = 0;
    this.reverseSignatureLo = 0; this.reverseSignatureHi = 0;
    this.hazardSignatureLo = 0; this.hazardSignatureHi = 0;
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
    this.computeReverseSignature(perspectiveSeat);
    const cacheLo = this.hazardSignatureCacheEnabled ? this.hazardSignatureLo : state.hashLo;
    const cacheHi = this.hazardSignatureCacheEnabled ? this.hazardSignatureHi : state.hashHi;
    if (this.builtHashLo === cacheLo && this.builtHashHi === cacheHi &&
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
    this.builtHashLo = cacheLo; this.builtHashHi = cacheHi;
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

  validateTerrainIdentity() {
    const terrain = this.state.arrays[ARRAY.TERRAIN];
    let changed = !this.terrainIdentityValid;
    for (let cell = 0; !changed && cell < this.state.cells; cell += 1)
      if (terrain[cell] !== this.terrainIdentity[cell]) changed = true;
    if (!changed) return;
    for (let cell = 0; cell < this.state.cells; cell += 1)
      this.terrainIdentity[cell] = terrain[cell];
    this.terrainIdentityValid = 1; this.terrainIdentityInvalidations += 1;
    this.builtTerrainVersion = -1;
    if (this.reverseCacheValid) this.reverseCacheValid.fill(0);
    if (this.reverseLatticeValid) this.reverseLatticeValid.fill(0);
  }

  computeReverseSignature(perspectiveSeat) {
    this.validateTerrainIdentity();
    const a = this.state.arrays; const scalar = a[ARRAY.SCALAR];
    let lo = mix(0x811c9dc5 ^ a[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION],
      perspectiveSeat + 1);
    let hi = (0x9e3779b9 ^ this.state.width ^ (this.state.height << 16)) >>> 0;
    let hazardLo = mix(0x27d4eb2d ^ a[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION],
      perspectiveSeat + 1);
    let hazardHi = (0x85ebca6b ^ this.state.width ^ (this.state.height << 16)) >>> 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot]) continue;
      const geometry = (a[ARRAY.PROJECTILE_CELL][slot] |
        (a[ARRAY.PROJECTILE_DIR][slot] << 16) | (slot << 20)) >>> 0;
      const identity = (a[ARRAY.PROJECTILE_ID][slot] ^
        (a[ARRAY.PROJECTILE_GENERATION][slot] << 16) ^
        ((a[ARRAY.PROJECTILE_OWNER][slot] + 1) * 0x9e37)) >>> 0;
      hazardLo = mix(hazardLo, geometry ^ identity);
      hazardHi = mix(hazardHi, ((geometry << 11) | (geometry >>> 21)) ^
        ((identity << 5) | (identity >>> 27)));
      if (a[ARRAY.PROJECTILE_OWNER][slot] === perspectiveSeat) continue;
      lo = mix(lo, geometry);
      hi = mix(hi, (geometry << 11) | (geometry >>> 21));
    }
    const frame = scalar[SCALAR.FRAME];
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1) {
      if (!a[ARRAY.BOMB_ACTIVE][slot]) continue;
      const remaining = Math.max(0, a[ARRAY.BOMB_EXPLODE][slot] - frame);
      const geometry = (a[ARRAY.BOMB_CELL][slot] | (remaining << 16) | (slot << 24)) >>> 0;
      const identity = (a[ARRAY.BOMB_ID][slot] ^
        (a[ARRAY.BOMB_GENERATION][slot] << 16)) >>> 0;
      hazardLo = mix(hazardLo, geometry ^ identity);
      hazardHi = mix(hazardHi, ((geometry << 13) | (geometry >>> 19)) ^
        ((identity << 3) | (identity >>> 29)));
      lo = mix(lo, geometry);
      hi = mix(hi, (geometry << 7) | (geometry >>> 25));
    }
    this.reverseSignatureLo = this.reverseLatticeIncludesOwnProjectiles ? hazardLo : lo;
    this.reverseSignatureHi = this.reverseLatticeIncludesOwnProjectiles ? hazardHi : hi;
    this.hazardSignatureLo = hazardLo; this.hazardSignatureHi = hazardHi;
  }

  finalizeReverseResult(viable, perspectiveSeat) {
    if (viable) return 1;
    const a = this.state.arrays;
    const specialEscape = (a[ARRAY.TANK_SHIELD_HITS][perspectiveSeat] > 0 &&
      a[ARRAY.TANK_SHIELD_UNTIL][perspectiveSeat] !== NONE_FRAME) ||
      a[ARRAY.TANK_BOOST_UNTIL][perspectiveSeat] !== NONE_FRAME ||
      (a[ARRAY.TANK_SKILL][perspectiveSeat] === SKILL.TELEPORT &&
      a[ARRAY.TANK_SKILL_READY][perspectiveSeat] <= a[ARRAY.SCALAR][SCALAR.FRAME]);
    return specialEscape || !this.narrowProofComplete ? -1 : 0;
  }

  loadReverseLatticeLayers(perspectiveSeat, tick0, tick1, tick2) {
    if (!this.reverseLatticeLayerCacheEnabled || !this.reverseLatticeEntries ||
        !tick0 || !tick1 || !tick2) return 0;
    this.computeReverseSignature(perspectiveSeat);
    const index = (this.reverseSignatureLo ^
      ((this.reverseSignatureHi << 9) | (this.reverseSignatureHi >>> 23))) &
      (this.reverseLatticeEntries - 1);
    if (!this.reverseLatticeValid[index] ||
        this.reverseLatticeHashLo[index] !== this.reverseSignatureLo ||
        this.reverseLatticeHashHi[index] !== this.reverseSignatureHi) {
      this.reverseLatticeLayerMissCount += 1; return 0;
    }
    const offset = index * this.reverseLatticeStride;
    // Avoid TypedArray.subarray(): it creates a short-lived view object on a
    // hot EO/Hard path. The fixed loop is allocation-free and copies only the
    // active map stride into DeadlineKernel's maximum-sized buffers.
    for (let pose = 0; pose < this.reverseLatticeStride; pose += 1) {
      tick0[pose] = this.reverseLatticeGrid[offset + pose];
      tick1[pose] = this.reverseLatticeTick1[offset + pose];
      tick2[pose] = this.reverseLatticeTick2[offset + pose];
    }
    this.reverseLatticeLayerHitCount += 1; return 1;
  }

  reverseViable(perspectiveSeat = 0) {
    if (!this.rebuild(perspectiveSeat)) return -1;
    const state = this.state; const a = state.arrays; const cells = state.cells;
    let cacheIndex = -1;
    if (this.reverseCacheEntries) {
      const terrainVersion = a[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION] >>> 0;
      cacheIndex = (state.hashLo ^ ((state.hashHi << 7) | (state.hashHi >>> 25)) ^
        terrainVersion ^ mix(0x9e3779b1, perspectiveSeat + 1)) &
        (this.reverseCacheEntries - 1);
      if (this.reverseCacheValid[cacheIndex] &&
          this.reverseCacheHashLo[cacheIndex] === state.hashLo &&
          this.reverseCacheHashHi[cacheIndex] === state.hashHi &&
          this.reverseCacheTerrain[cacheIndex] === terrainVersion &&
          this.reverseCacheSeat[cacheIndex] === perspectiveSeat) {
        this.reverseCacheHitCount += 1;
        return this.reverseCacheResult[cacheIndex];
      }
      this.reverseCacheMissCount += 1;
    }
    let latticeIndex = -1; let latticeOffset = 0;
    if (this.reverseLatticeEntries) {
      this.computeReverseSignature(perspectiveSeat);
      latticeIndex = (this.reverseSignatureLo ^
        ((this.reverseSignatureHi << 9) | (this.reverseSignatureHi >>> 23))) &
        (this.reverseLatticeEntries - 1);
      latticeOffset = latticeIndex * this.reverseLatticeStride;
      if (this.reverseLatticeValid[latticeIndex] &&
          this.reverseLatticeHashLo[latticeIndex] === this.reverseSignatureLo &&
          this.reverseLatticeHashHi[latticeIndex] === this.reverseSignatureHi) {
        this.reverseLatticeHitCount += 1;
        const root = a[ARRAY.TANK_CELL][perspectiveSeat] * 4 +
          a[ARRAY.TANK_DIR][perspectiveSeat];
        const result = this.finalizeReverseResult(
          this.reverseLatticeGrid[latticeOffset + root], perspectiveSeat);
        if (cacheIndex >= 0) {
          this.reverseCacheValid[cacheIndex] = 1;
          this.reverseCacheHashLo[cacheIndex] = state.hashLo;
          this.reverseCacheHashHi[cacheIndex] = state.hashHi;
          this.reverseCacheTerrain[cacheIndex] =
            a[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION] >>> 0;
          this.reverseCacheSeat[cacheIndex] = perspectiveSeat;
          this.reverseCacheResult[cacheIndex] = result;
        }
        return result;
      }
      this.reverseLatticeMissCount += 1;
    }
    let next = this.viableA; let current = this.viableB; next.fill(0); current.fill(0);
    const buildNodes = (this.horizonTick + 1) * cells * 4;
    if (latticeIndex >= 0) {
      this.reverseLatticeBuildCount += 1;
      this.reverseLatticeBuildNodeCount += buildNodes;
    } else {
      this.reverseUncachedBuildCount += 1;
      this.reverseUncachedBuildNodeCount += buildNodes;
    }
    for (let cell = 0; cell < cells; cell += 1) if (a[ARRAY.TERRAIN][cell] !== TERRAIN.WALL &&
        a[ARRAY.TERRAIN][cell] !== TERRAIN.DIRT && !this.isLethal(this.horizonTick, cell))
      for (let direction = 0; direction < 4; direction += 1) next[cell * 4 + direction] = 1;
    if (latticeIndex >= 0 && this.reverseLatticeLayerCacheEnabled) {
      if (this.horizonTick === 1)
        this.reverseLatticeTick1.set(next, latticeOffset);
      if (this.horizonTick === 2)
        this.reverseLatticeTick2.set(next, latticeOffset);
      if (this.horizonTick < 1) {
        this.reverseLatticeTick1.set(next, latticeOffset);
        this.reverseLatticeTick2.set(next, latticeOffset);
      }
    }
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
      if (latticeIndex >= 0 && this.reverseLatticeLayerCacheEnabled) {
        if (tick === 1) this.reverseLatticeTick1.set(current, latticeOffset);
        if (tick === 2) this.reverseLatticeTick2.set(current, latticeOffset);
      }
      const swap = next; next = current; current = swap;
    }
    const rootCell = a[ARRAY.TANK_CELL][perspectiveSeat];
    const rootDirection = a[ARRAY.TANK_DIR][perspectiveSeat];
    if (latticeIndex >= 0) {
      this.reverseLatticeGrid.set(next, latticeOffset);
      this.reverseLatticeValid[latticeIndex] = 1;
      this.reverseLatticeHashLo[latticeIndex] = this.reverseSignatureLo;
      this.reverseLatticeHashHi[latticeIndex] = this.reverseSignatureHi;
    }
    const result = this.finalizeReverseResult(
      next[rootCell * 4 + rootDirection], perspectiveSeat);
    if (cacheIndex >= 0) {
      this.reverseCacheValid[cacheIndex] = 1;
      this.reverseCacheHashLo[cacheIndex] = state.hashLo;
      this.reverseCacheHashHi[cacheIndex] = state.hashHi;
      this.reverseCacheTerrain[cacheIndex] =
        a[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION] >>> 0;
      this.reverseCacheSeat[cacheIndex] = perspectiveSeat;
      this.reverseCacheResult[cacheIndex] = result;
    }
    return result;
  }
}

module.exports = { HazardKernel };
