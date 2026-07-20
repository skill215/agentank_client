"use strict";

const { CAPACITY, RULE } = require("../generated/fast-config");
const { TERRAIN, NONE_FRAME, NONE_CELL, DX, DY } = require("../abi/fast-codes");

const PROJECTILE_FACT = Object.freeze({ NONE: 0, POSSIBLE: 1, COMMITTED: 2 });
const ASSOCIATION_STATUS = Object.freeze({ EXACT: 1, AMBIGUOUS: 2, INCOMPLETE: 3 });
const PROJECTILE_INVALIDATION = Object.freeze({ NONE: 0, BOUNDARY: 1, WALL: 2, DIRT: 3,
  TANK: 4, SHIELD: 5, STRICT_VISIBILITY_REFUTATION: 6 });
const DIRECTION_CODE = Object.freeze({ up: 0, right: 1, down: 2, left: 3 });

class AssociationRelation {
  constructor(capacity = CAPACITY.MAX_PROJECTILES) {
    this.capacity = capacity; this.observationCell = new Uint16Array(capacity);
    this.observationDirection = new Uint8Array(capacity);
    this.observationOwner = new Uint8Array(capacity);
    this.candidateMask = new Uint16Array(capacity); this.assignedTrack = new Int16Array(capacity);
    this.trackClaimed = new Uint8Array(capacity); this.observationCount = 0;
    this.ambiguousCount = 0; this.unmatchedCount = 0; this.status = ASSOCIATION_STATUS.EXACT;
    this.hotAllocationCount = 0;
  }
  reset() {
    this.observationCount = 0; this.ambiguousCount = 0; this.unmatchedCount = 0;
    this.status = ASSOCIATION_STATUS.EXACT; this.trackClaimed.fill(0); this.assignedTrack.fill(-1);
  }
  push(owner, cell, direction) {
    if (this.observationCount >= this.capacity) { this.status = ASSOCIATION_STATUS.INCOMPLETE; return 0; }
    const at = this.observationCount++; this.observationOwner[at] = owner;
    this.observationCell[at] = cell; this.observationDirection[at] = direction;
    this.assignedTrack[at] = -1; return 1;
  }
  build(pool) {
    for (let observation = 0; observation < this.observationCount; observation += 1) {
      let mask = 0;
      for (let track = 0; track < pool.capacity; track += 1)
        if (pool.active[track] && pool.owner[track] === this.observationOwner[observation] &&
            pool.cell[track] === this.observationCell[observation] &&
            pool.direction[track] === this.observationDirection[observation]) mask |= 1 << track;
      this.candidateMask[observation] = mask;
      if (!mask) this.unmatchedCount += 1;
      else if ((mask & (mask - 1)) !== 0) { this.ambiguousCount += 1;
        this.status = ASSOCIATION_STATUS.AMBIGUOUS; }
    }
    // Repeatedly claim only singleton relations. An ambiguous relation is kept
    // as InformationState support and is never greedily collapsed.
    for (let pass = 0; pass < this.observationCount; pass += 1) {
      let changed = 0;
      for (let observation = 0; observation < this.observationCount; observation += 1) {
        if (this.assignedTrack[observation] >= 0) continue;
        let mask = this.candidateMask[observation];
        for (let track = 0; track < pool.capacity; track += 1)
          if (this.trackClaimed[track]) mask &= ~(1 << track);
        if (mask && (mask & (mask - 1)) === 0) {
          let track = 0; while (((mask >>> track) & 1) === 0) track += 1;
          this.assignedTrack[observation] = track; this.trackClaimed[track] = 1; changed = 1;
        }
      }
      if (!changed) break;
    }
    return this.status;
  }
}

class ProjectileTrackPool {
  constructor(options = {}) {
    this.capacity = options.capacity || CAPACITY.MAX_PROJECTILES;
    this.defaultFact = options.defaultFact || PROJECTILE_FACT.COMMITTED;
    this.active = new Uint8Array(this.capacity); this.generation = new Uint16Array(this.capacity);
    this.id = new Uint32Array(this.capacity); this.owner = new Uint8Array(this.capacity);
    this.cell = new Uint16Array(this.capacity); this.direction = new Uint8Array(this.capacity);
    this.group = new Uint32Array(this.capacity); this.member = new Uint8Array(this.capacity);
    this.created = new Uint16Array(this.capacity); this.lastObserved = new Uint16Array(this.capacity);
    this.fact = new Uint8Array(this.capacity); this.mass = new Uint16Array(this.capacity);
    this.seen = new Uint8Array(this.capacity); this.invalidation = new Uint8Array(this.capacity);
    this.relation = new AssociationRelation(this.capacity);
    this.pendingActive = new Uint8Array(2); this.pendingCell = new Uint16Array(2);
    this.pendingDirection = new Uint8Array(2); this.pendingFrame = new Uint16Array(2);
    this.pendingMembers = new Uint8Array(2);
    this.lastFrame = NONE_FRAME; this.nextEntityId = 3; this.complete = 1;
    this.activeCount = 0; this.highWater = 0; this.addCount = 0; this.expireCount = 0;
    this.ambiguousAssociationCount = 0; this.capacityFailureCount = 0;
    this.generationReuseCount = 0; this.hotAllocationCount = 0;
    this.lastObservationCount = 0; this.lastSetComplete = 0;
    this.lastAssociationStatus = ASSOCIATION_STATUS.EXACT;
  }
  reset(frame = NONE_FRAME) {
    this.active.fill(0); this.pendingActive.fill(0);
    this.lastFrame = frame; this.nextEntityId = 3; this.complete = 1; this.activeCount = 0;
    this.relation.observationCount = 0; this.relation.ambiguousCount = 0;
    this.relation.unmatchedCount = 0; this.relation.status = ASSOCIATION_STATUS.EXACT;
  }
  beginObservation() { this.seen.fill(0); this.relation.reset(); this.complete = 1; }
  target(cell, direction, width, height) {
    const x = cell % width; const y = (cell / width) | 0;
    const nx = x + DX[direction]; const ny = y + DY[direction];
    return nx < 0 || nx >= width || ny < 0 || ny >= height ? NONE_CELL : ny * width + nx;
  }
  freeSlot() {
    for (let slot = 0; slot < this.capacity; slot += 1) if (!this.active[slot]) return slot;
    this.complete = 0; this.capacityFailureCount += 1; return -1;
  }
  allocate(owner, cell, direction, frame, fact = this.defaultFact, mass = 10000,
      group = 0, member = 0) {
    const slot = this.freeSlot(); if (slot < 0) return -1;
    if (this.generation[slot]) this.generationReuseCount += 1;
    this.generation[slot] = (this.generation[slot] + 1) & 0xffff;
    if (!this.generation[slot]) this.generation[slot] = 1;
    const id = this.nextEntityId++; this.active[slot] = 1; this.id[slot] = id;
    this.owner[slot] = owner; this.cell[slot] = cell; this.direction[slot] = direction;
    this.group[slot] = group || id; this.member[slot] = member; this.created[slot] = frame;
    this.lastObserved[slot] = frame; this.fact[slot] = fact;
    this.mass[slot] = Math.max(0, Math.min(10000, mass)); this.seen[slot] = 1;
    this.invalidation[slot] = PROJECTILE_INVALIDATION.NONE; this.activeCount += 1;
    if (this.activeCount > this.highWater) this.highWater = this.activeCount;
    this.addCount += 1; return slot;
  }
  invalidate(slot, reason) {
    if (!this.active[slot]) return 0; this.active[slot] = 0; this.invalidation[slot] = reason;
    this.activeCount -= 1; this.expireCount += 1; return 1;
  }
  advance(frame, terrain, width, height, aliveCell = NONE_CELL) {
    if (this.lastFrame === NONE_FRAME || frame < this.lastFrame) { this.lastFrame = frame; return 1; }
    const gap = frame - this.lastFrame;
    // A callback gap beyond the tracked canonical horizon is residual support,
    // never a fabricated exact position.
    if (gap > CAPACITY.MAX_HAZARD_FRAMES) { this.complete = 0; this.lastFrame = frame; return 0; }
    for (let owner = 0; owner < 2; owner += 1) if (this.pendingActive[owner] &&
        this.pendingFrame[owner] < frame) {
      const members = this.pendingMembers[owner];
      this.recordFire(owner, this.pendingCell[owner], this.pendingDirection[owner],
        this.pendingFrame[owner], members === 2, PROJECTILE_FACT.COMMITTED, 10000);
      this.pendingActive[owner] = 0;
    }
    const steps = gap * RULE.PROJECTILE_STEPS;
    for (let slot = 0; slot < this.capacity; slot += 1) if (this.active[slot]) {
      let cell = this.cell[slot];
      for (let step = 0; step < steps; step += 1) {
        const target = this.target(cell, this.direction[slot], width, height);
        if (target === NONE_CELL) { this.invalidate(slot, PROJECTILE_INVALIDATION.BOUNDARY); break; }
        const tile = terrain[target];
        if (tile === TERRAIN.WALL) { this.invalidate(slot, PROJECTILE_INVALIDATION.WALL); break; }
        if (tile === TERRAIN.DIRT) { this.invalidate(slot, PROJECTILE_INVALIDATION.DIRT); break; }
        cell = target;
        if (this.owner[slot] === 1 && cell === aliveCell) {
          // The callback proves this tank survived. This is a strict physical
          // refutation of a track that would already have hit it.
          this.invalidate(slot, PROJECTILE_INVALIDATION.TANK); break;
        }
      }
      if (this.active[slot]) this.cell[slot] = cell;
    }
    this.lastFrame = frame; return this.complete;
  }
  pushObservation(value, owner, width, height) {
    if (!value || typeof value !== "object") return 0;
    const position = value.position;
    const direction = DIRECTION_CODE[value.direction];
    if (!Array.isArray(position) || position.length < 2 || !Number.isSafeInteger(position[0]) ||
        !Number.isSafeInteger(position[1]) || position[0] < 0 || position[0] >= width ||
        position[1] < 0 || position[1] >= height || direction === undefined) {
      this.complete = 0; return 0;
    }
    return this.relation.push(owner, position[1] * width + position[0], direction);
  }
  observeOneFast(value, owner, frame, width, height, setComplete) {
    const position = value && value.position; const direction = value ? DIRECTION_CODE[value.direction] : undefined;
    if (!Array.isArray(position) || position.length < 2 || !Number.isSafeInteger(position[0]) ||
        !Number.isSafeInteger(position[1]) || position[0] < 0 || position[0] >= width ||
        position[1] < 0 || position[1] >= height || direction === undefined) {
      this.complete = 0; this.lastAssociationStatus = ASSOCIATION_STATUS.INCOMPLETE;
      return this.lastAssociationStatus;
    }
    const cell = position[1] * width + position[0]; let match = -1; let count = 0; let mask = 0;
    for (let slot = 0; slot < this.capacity; slot += 1)
      if (this.active[slot] && this.owner[slot] === owner && this.cell[slot] === cell &&
          this.direction[slot] === direction) { match = slot; count += 1; mask |= 1 << slot; }
    this.relation.observationCount = 1; this.relation.candidateMask[0] = mask;
    if (count === 0) match = this.allocate(owner, cell, direction, frame,
      PROJECTILE_FACT.COMMITTED, 10000);
    else if (count > 1) {
      this.complete = 0; this.ambiguousAssociationCount += 1;
      this.relation.ambiguousCount = 1; this.relation.status = ASSOCIATION_STATUS.AMBIGUOUS;
      this.lastAssociationStatus = ASSOCIATION_STATUS.AMBIGUOUS;
    } else {
      this.lastObserved[match] = frame; this.seen[match] = 1;
      this.fact[match] = PROJECTILE_FACT.COMMITTED; this.mass[match] = 10000;
    }
    this.lastObservationCount = 1; this.lastSetComplete = setComplete ? 1 : 0;
    if (match < 0) this.lastAssociationStatus = ASSOCIATION_STATUS.INCOMPLETE;
    return this.lastAssociationStatus;
  }
  observeSet(value, owner, frame, width, height) {
    this.relation.reset(); this.lastObservationCount = 0; this.lastSetComplete = 0;
    this.lastAssociationStatus = ASSOCIATION_STATUS.EXACT;
    if (value == null) return this.lastAssociationStatus;
    const isSet = Array.isArray(value) && (value.length === 0 ||
      (value[0] && typeof value[0] === "object" && Array.isArray(value[0].position)));
    if ((!isSet && value && typeof value === "object") || (isSet && value.length === 1))
      return this.observeOneFast(isSet ? value[0] : value, owner, frame, width, height, isSet);
    if (isSet) for (let index = 0; index < value.length; index += 1)
      this.pushObservation(value[index], owner, width, height);
    else this.pushObservation(value, owner, width, height);
    this.relation.build(this);
    for (let observation = 0; observation < this.relation.observationCount; observation += 1) {
      const assigned = this.relation.assignedTrack[observation];
      if (assigned >= 0) {
        this.cell[assigned] = this.relation.observationCell[observation];
        this.direction[assigned] = this.relation.observationDirection[observation];
        this.lastObserved[assigned] = frame; this.seen[assigned] = 1;
        this.fact[assigned] = PROJECTILE_FACT.COMMITTED; this.mass[assigned] = 10000;
      } else if (this.relation.candidateMask[observation] === 0) {
        this.allocate(owner, this.relation.observationCell[observation],
          this.relation.observationDirection[observation], frame,
          PROJECTILE_FACT.COMMITTED, 10000);
      }
    }
    if (this.relation.ambiguousCount) {
      this.complete = 0; this.ambiguousAssociationCount += this.relation.ambiguousCount;
    }
    this.lastObservationCount = this.relation.observationCount;
    this.lastSetComplete = isSet ? 1 : 0; this.lastAssociationStatus = this.relation.status;
    return this.lastAssociationStatus;
  }
  recordFire(owner, cell, direction, frame, overloaded = false, fact = PROJECTILE_FACT.COMMITTED,
      mass = 10000) {
    const group = this.nextEntityId; const first = this.allocate(owner, cell, direction, frame,
      fact, mass, group, 0); if (first < 0) return 0;
    if (overloaded) {
      const second = this.allocate(owner, cell, direction, frame, fact, mass, group, 1);
      if (second < 0) { this.complete = 0; return 1; }
    }
    return overloaded ? 2 : 1;
  }
  recordPendingFire(owner, cell, direction, frame, overloaded = false) {
    if (owner < 0 || owner > 1 || this.pendingActive[owner]) {
      if (owner < 0 || owner > 1) this.complete = 0;
      return owner >= 0 && owner <= 1 ? this.pendingMembers[owner] : 0;
    }
    this.pendingActive[owner] = 1; this.pendingCell[owner] = cell;
    this.pendingDirection[owner] = direction; this.pendingFrame[owner] = frame;
    this.pendingMembers[owner] = overloaded ? 2 : 1; return this.pendingMembers[owner];
  }
  refuteMissing(owner, observerCell, observerDirection, terrain, width, observationSetComplete) {
    if (!observationSetComplete) return 0; let removed = 0;
    const ox = observerCell % width; const oy = (observerCell / width) | 0;
    for (let slot = 0; slot < this.capacity; slot += 1) {
      if (!this.active[slot] || this.owner[slot] !== owner || this.seen[slot]) continue;
      const tx = this.cell[slot] % width; const ty = (this.cell[slot] / width) | 0;
      const aligned = observerDirection === 0 ? tx === ox && ty < oy :
        observerDirection === 1 ? ty === oy && tx > ox :
        observerDirection === 2 ? tx === ox && ty > oy : ty === oy && tx < ox;
      if (!aligned) continue;
      const dx = tx === ox ? 0 : tx > ox ? 1 : -1; const dy = ty === oy ? 0 : ty > oy ? 1 : -1;
      let x = ox + dx; let y = oy + dy; let visible = 1;
      while (x !== tx || y !== ty) { const tile = terrain[y * width + x];
        if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) { visible = 0; break; } x += dx; y += dy; }
      if (visible) { this.invalidate(slot, PROJECTILE_INVALIDATION.STRICT_VISIBILITY_REFUTATION);
        removed += 1; }
    }
    return removed;
  }
  count(owner = -1) {
    if (owner < 0) return this.activeCount; let count = 0;
    for (let slot = 0; slot < this.capacity; slot += 1)
      if (this.active[slot] && this.owner[slot] === owner) count += 1;
    return count;
  }
}

module.exports = { PROJECTILE_FACT, ASSOCIATION_STATUS, PROJECTILE_INVALIDATION,
  AssociationRelation, ProjectileTrackPool };
