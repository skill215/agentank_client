"use strict";

// Generated from production-root.js. Do not edit by hand.
const { CAPACITY, RULE } = require("../generated/fast-config");
const { FastState, ARRAY, SCALAR, DIRECTION_BY_NAME, SKILL_BY_NAME } =
  require("../state/fast-state");
const { FastKernel } = require("../fast/kernel");
const { HazardKernel } = require("../fast/hazard");
const { HardGate } = require("../fast/hard-gate");
const { ACTION, SKILL, TERRAIN, NONE_FRAME, NONE_CELL, UNKNOWN_RUNTIME,
  DX, DY } = require("../abi/fast-codes");
const { ProjectileTrackPool } = require("./projectile-track-pool");

const ROOT_STATUS = Object.freeze({ OK: 1, INCOMPLETE: 2, INVALID: 3, CAPACITY: 4 });

const ENEMY_CAPABILITY_REASON = Object.freeze({
  PROJECTILE_SUPPORT: 1,
  CAN_ACT_FIELD: 2,
  ACTION_SPEED: 4,
  EFFECT_SHAPE: 8,
  CADENCE_FIELD: 16,
  CADENCE_MISMATCH: 32,
  FIRE_LOCK_FIELD: 64,
  FIRE_LOCK_ACTIVE: 128
});

const INFORMATION_GAP = Object.freeze({
  EFFECT_DEADLINE: 1,
  TANK_FIELDS: 2,
  STATUS_SHAPE: 4,
  SHIELD_CHARGES: 8,
  POISON_PHASE: 16,
  FIRE_LOCK_DEADLINE: 32,
  BOMB_STATE: 64,
  CADENCE: 128,
  BULLET_FIELD: 256,
  HIDDEN_ENEMY: 512,
  TRACKER_SUPPORT: 1024,
  BOMB_TRACK: 2048,
  STAR_FIELD: 4096,
  POSSIBLE_ENEMY_PROJECTILE: 8192
});

const EFFECT_ARRAY = Object.freeze({ shield: ARRAY.TANK_SHIELD_UNTIL,
  freeze: ARRAY.TANK_FROZEN_UNTIL, stun: ARRAY.TANK_STUN_UNTIL,
  overload: ARRAY.TANK_OVERLOAD_UNTIL, cloak: ARRAY.TANK_CLOAK_UNTIL,
  poison: ARRAY.TANK_POISON_UNTIL, boost: ARRAY.TANK_BOOST_UNTIL });

const STATUS_EFFECT = Object.freeze({ shielded: "shield", frozen: "freeze", stunned: "stun",
  overloaded: "overload", cloaked: "cloak", poisoned: "poison", boosted: "boost" });

const STATUS_FIELDS = Object.freeze(["shielded", "frozen", "stunned", "overloaded",
  "cloaked", "poisoned", "boosted"]);

function integer(value, fallback = 0) { return Number.isSafeInteger(value) && value >= 0 ? value : fallback; }

function hasProjectile(value) { return Array.isArray(value) ? value.length > 0 : !!value; }

function positionCell(position, width, height) {
  return Array.isArray(position) && position.length >= 2 && Number.isSafeInteger(position[0]) &&
    Number.isSafeInteger(position[1]) && position[0] >= 0 && position[0] < width &&
    position[1] >= 0 && position[1] < height ? position[1] * width + position[0] : NONE_CELL;
}

function directionCode(value) { const code = DIRECTION_BY_NAME[value]; return code === undefined ? -1 : code; }

function terrainCode(value) {
  return value === "." ? TERRAIN.OPEN : value === "x" ? TERRAIN.WALL :
    value === "m" ? TERRAIN.DIRT : value === "o" ? TERRAIN.GRASS : -1;
}

function observedActionCode(value) {
  if (Number.isSafeInteger(value) && value >= ACTION.NONE && value <= ACTION.CAST_BOOST)
    return value;
  const type = typeof value === "string" ? value : value && value.type;
  if (type === "go" || type === "GO") return ACTION.GO;
  if (type === "fire" || type === "FIRE") return ACTION.FIRE;
  if (type === "throwBomb" || type === "THROW_BOMB") return ACTION.THROW_BOMB;
  if (type === "turn" || type === "TURN_LEFT" || type === "TURN_RIGHT") {
    const side = typeof value === "object" && value ? value.side : null;
    return type === "TURN_LEFT" || side === "left" ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
  }
  const skillAction = { shield: ACTION.CAST_SHIELD, freeze: ACTION.CAST_FREEZE,
    stun: ACTION.CAST_STUN, overload: ACTION.CAST_OVERLOAD, cloak: ACTION.CAST_CLOAK,
    teleport: ACTION.CAST_TELEPORT, poison: ACTION.CAST_POISON, boost: ACTION.CAST_BOOST,
    CAST_SHIELD: ACTION.CAST_SHIELD, CAST_FREEZE: ACTION.CAST_FREEZE,
    CAST_STUN: ACTION.CAST_STUN, CAST_OVERLOAD: ACTION.CAST_OVERLOAD,
    CAST_CLOAK: ACTION.CAST_CLOAK, CAST_TELEPORT: ACTION.CAST_TELEPORT,
    CAST_POISON: ACTION.CAST_POISON, CAST_BOOST: ACTION.CAST_BOOST };
  return skillAction[type] === undefined ? ACTION.NONE : skillAction[type];
}

function mix(hash, value) {
  let result = (hash ^ (value >>> 0)) >>> 0;
  result = (result + ((result << 1) >>> 0) + ((result << 4) >>> 0) +
    ((result << 7) >>> 0) + ((result << 8) >>> 0) + ((result << 24) >>> 0)) >>> 0;
  return result;
}

function productionValueSupportComplete(source, information) {
  if (!source) return 0;
  if (information) return source.approximate === 0 && source.supportComplete === 1 ? 1 : 0;
  return source.representativeSupportComplete === 1 ? 1 : 0;
}

class ProductionEntityTracker {
  constructor() {
    this.projectiles = new ProjectileTrackPool();
    this.projectileActive = this.projectiles.active;
    this.projectileGeneration = this.projectiles.generation;
    this.projectileId = this.projectiles.id; this.projectileOwner = this.projectiles.owner;
    this.projectileCell = this.projectiles.cell; this.projectileDirection = this.projectiles.direction;
    this.projectileGroup = this.projectiles.group; this.projectileMember = this.projectiles.member;
    this.projectileCreated = this.projectiles.created; this.projectileSeen = this.projectiles.seen;
    this.projectileFact = this.projectiles.fact; this.projectileMass = this.projectiles.mass;
    this.bombActive = new Uint8Array(CAPACITY.MAX_BOMBS);
    this.bombGeneration = new Uint16Array(CAPACITY.MAX_BOMBS);
    this.bombId = new Uint32Array(CAPACITY.MAX_BOMBS);
    this.bombOwner = new Uint8Array(CAPACITY.MAX_BOMBS);
    this.bombCell = new Uint16Array(CAPACITY.MAX_BOMBS);
    this.bombPlaced = new Uint16Array(CAPACITY.MAX_BOMBS);
    this.bombEarliest = new Uint16Array(CAPACITY.MAX_BOMBS);
    this.bombExplode = new Uint16Array(CAPACITY.MAX_BOMBS);
    this.bombExact = new Uint8Array(CAPACITY.MAX_BOMBS);
    this.bombOwnerExact = new Uint8Array(CAPACITY.MAX_BOMBS);
    this.bombSeen = new Uint8Array(CAPACITY.MAX_BOMBS);
    Object.defineProperty(this, "nextEntityId", { enumerable: true,
      get: () => this.projectiles.nextEntityId, set: value => { this.projectiles.nextEntityId = value; } });
    Object.defineProperty(this, "projectileHighWater", { enumerable: true,
      get: () => this.projectiles.highWater });
    this.lastFrame = NONE_FRAME; this.complete = 1; this.ownObservationSetComplete = 0;
    this.enemyObservationSetComplete = 0; this.bombHighWater = 0; this.hotAllocationCount = 0;
  }
  reset(frame = NONE_FRAME) {
    this.projectiles.reset(frame); this.bombActive.fill(0); this.bombSeen.fill(0);
    this.lastFrame = frame; this.complete = 1; this.ownObservationSetComplete = 0;
    this.enemyObservationSetComplete = 0;
  }
  target(cell, direction, width, height) {
    const x = cell % width; const y = (cell / width) | 0;
    const nextX = x + DX[direction]; const nextY = y + DY[direction];
    return nextX < 0 || nextX >= width || nextY < 0 || nextY >= height ? NONE_CELL :
      nextY * width + nextX;
  }
  advance(frame, terrain, width, height, refutedCell = NONE_CELL) {
    this.projectiles.advance(frame, terrain, width, height, refutedCell);
    for (let slot = 0; slot < this.bombActive.length; slot += 1)
      if (this.bombActive[slot] && this.bombExplode[slot] < frame) this.bombActive[slot] = 0;
    this.lastFrame = frame;
  }
  projectileSlot(owner, cell, direction) {
    for (let slot = 0; slot < this.projectileActive.length; slot += 1)
      if (this.projectileActive[slot] && this.projectileOwner[slot] === owner &&
          this.projectileCell[slot] === cell && this.projectileDirection[slot] === direction) return slot;
    return this.projectiles.freeSlot();
  }
  observeProjectileOne(value, owner, frame, width, height) {
    const status = this.projectiles.observeSet(value, owner, frame, width, height);
    if (!this.projectiles.complete || status !== 1) this.complete = 0;
    return status;
  }
  observeProjectiles(value, owner, frame, width, height) {
    const status = this.projectiles.observeSet(value, owner, frame, width, height);
    if (owner === 0) this.ownObservationSetComplete = this.projectiles.lastSetComplete;
    else this.enemyObservationSetComplete = this.projectiles.lastSetComplete;
    if (!this.projectiles.complete || status !== 1) this.complete = 0; return status;
  }
  forwardAxisVisible(observerCell, observerDirection, targetCell, terrain, width) {
    const ox = observerCell % width; const oy = (observerCell / width) | 0;
    const tx = targetCell % width; const ty = (targetCell / width) | 0;
    const aligned = observerDirection === 0 ? tx === ox && ty < oy :
      observerDirection === 1 ? ty === oy && tx > ox :
      observerDirection === 2 ? tx === ox && ty > oy : ty === oy && tx < ox;
    if (!aligned) return 0;
    const dx = tx === ox ? 0 : tx > ox ? 1 : -1; const dy = ty === oy ? 0 : ty > oy ? 1 : -1;
    let x = ox + dx; let y = oy + dy;
    while (x !== tx || y !== ty) {
      const tile = terrain[y * width + x];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
      x += dx; y += dy;
    }
    return 1;
  }
  reconcileMissingEnemyProjectiles(observerCell, observerDirection, terrain, width,
      strictVisibleEmpty = false) {
    return this.projectiles.refuteMissing(1, observerCell, observerDirection, terrain, width,
      this.enemyObservationSetComplete || strictVisibleEmpty);
  }
  hasActiveProjectile(owner) {
    return this.projectiles.count(owner) > 0 ? 1 : 0;
  }
  bombSlot(cell) {
    for (let slot = 0; slot < this.bombActive.length; slot += 1)
      if (this.bombActive[slot] && this.bombCell[slot] === cell) return slot;
    for (let slot = 0; slot < this.bombActive.length; slot += 1) if (!this.bombActive[slot]) return slot;
    this.complete = 0; return -1;
  }
  bombTimer(value, frame) {
    if (Number.isSafeInteger(value.explodeFrame)) return value.explodeFrame;
    if (Number.isSafeInteger(value.explodesAtFrame)) return value.explodesAtFrame;
    if (Number.isSafeInteger(value.placedFrame)) return value.placedFrame + RULE.BOMB_FUSE;
    if (Number.isSafeInteger(value.remainingFrames)) return frame + value.remainingFrames;
    if (Number.isSafeInteger(value.framesRemaining)) return frame + value.framesRemaining;
    return -1;
  }
  observeBomb(value, frame, width, height, ownTankId, enemyTankId) {
    if (!value || typeof value !== "object") { this.complete = 0; return; }
    const position = value.position || value.pos; const cell = positionCell(position, width, height);
    if (cell === NONE_CELL) { this.complete = 0; return; }
    const slot = this.bombSlot(cell); if (slot < 0) return; const observedTimer = this.bombTimer(value, frame);
    const wasActive = this.bombActive[slot]; let exact = observedTimer >= frame ? 1 : 0;
    let earliest = exact ? observedTimer : frame; let explode = exact ? observedTimer : frame + RULE.BOMB_FUSE;
    if (!exact && wasActive && this.bombExact[slot]) {
      exact = 1; earliest = this.bombEarliest[slot]; explode = this.bombExplode[slot];
    } else if (!exact && wasActive) explode = Math.min(explode, this.bombExplode[slot]);
    const ownerKey = value.ownerId ?? value.tankId ?? value.owner ?? value.by;
    const own = ownerKey !== undefined && ownTankId !== undefined && ownerKey === ownTankId;
    const opposing = ownerKey !== undefined && enemyTankId !== undefined && ownerKey === enemyTankId;
    const owner = own ? 0 : opposing ? 1 : wasActive ? this.bombOwner[slot] : 1;
    const ownerExact = own || opposing ? 1 : wasActive ? this.bombOwnerExact[slot] : 0;
    if (!this.bombActive[slot]) { this.bombActive[slot] = 1; this.bombId[slot] = this.nextEntityId++;
      this.bombGeneration[slot] = (this.bombGeneration[slot] + 1) & 0xffff;
      if (!this.bombGeneration[slot]) this.bombGeneration[slot] = 1;
      this.bombPlaced[slot] = Number.isSafeInteger(value.placedFrame) ? value.placedFrame :
        Math.max(0, explode - RULE.BOMB_FUSE); }
    this.bombOwner[slot] = owner; this.bombOwnerExact[slot] = ownerExact;
    this.bombCell[slot] = cell; this.bombEarliest[slot] = earliest;
    this.bombExplode[slot] = explode; this.bombExact[slot] = exact; this.bombSeen[slot] = 1;
    let count = 0; for (let index = 0; index < this.bombActive.length; index += 1) count += this.bombActive[index];
    if (count > this.bombHighWater) this.bombHighWater = count;
  }
  observeBombs(values, frame, width, height, ownTankId, enemyTankId) {
    if (values === undefined) { this.complete = 0; return; }
    if (!Array.isArray(values)) { this.complete = 0; return; }
    for (let index = 0; index < values.length; index += 1)
      this.observeBomb(values[index], frame, width, height, ownTankId, enemyTankId);
  }
  recordOwnBomb(cell, frame) {
    const slot = this.bombSlot(cell); if (slot < 0) return 0;
    if (!this.bombActive[slot]) {
      this.bombGeneration[slot] = (this.bombGeneration[slot] + 1) & 0xffff;
      if (!this.bombGeneration[slot]) this.bombGeneration[slot] = 1;
    }
    this.bombActive[slot] = 1;
    if (!this.bombId[slot]) this.bombId[slot] = this.nextEntityId++;
    this.bombOwner[slot] = 0; this.bombCell[slot] = cell;
    this.bombPlaced[slot] = frame + 1; this.bombEarliest[slot] = frame + 1 + RULE.BOMB_FUSE;
    this.bombExplode[slot] = frame + 1 + RULE.BOMB_FUSE;
    this.bombExact[slot] = 1; this.bombOwnerExact[slot] = 1; return 1;
  }
  recordOwnFire(cell, direction, frame, overloaded) {
    const count = this.projectiles.recordPendingFire(0, cell, direction, frame, overloaded);
    if (!this.projectiles.complete) this.complete = 0; return count;
  }
}

class ProductionObservationAdapter {
  constructor(options = {}) {
    this.state = null; this.kernel = null; this.hazard = null; this.hard = null; this.bundle = null;
    this.tracker = new ProductionEntityTracker(); this.width = 0; this.height = 0;
    this.terrainVersion = 0; this.mapHashLo = 0; this.mapHashHi = 0;
    this.lastEnemyCell = NONE_CELL; this.lastEnemyDirection = 0; this.lastFrame = NONE_FRAME;
    this.lastEnemySeenFrame = NONE_FRAME;
    this.enemyVisible = 0; this.informationComplete = 0; this.ownCanFire = 0;
    this.informationGapMask = 0;
    this.enemyCanFire = 0; this.ownBombReady = 0; this.enemyBombReady = 0;
    this.ownSkillReady = 0; this.enemySkillReady = 0; this.ownCanAct = 0;
    this.enemyCanAct = 0; this.matchReset = 0; this.rootCount = 0; this.invalidCount = 0;
    this.enemyCapabilitySupportComplete = 0;
    this.enemyCapabilityReason = 0;
    this.reverseViabilityCacheEntries = Number.isSafeInteger(
      options.reverseViabilityCacheEntries) ? options.reverseViabilityCacheEntries : 0;
    this.reverseLatticeCacheEntries = Number.isSafeInteger(
      options.reverseLatticeCacheEntries) ? options.reverseLatticeCacheEntries : 0;
    this.hazardSignatureCache = options.hazardSignatureCache !== false ? 1 : 0;
    this.reverseLatticeLayerCache = options.reverseLatticeLayerCache === true ? 1 : 0;
    this.stationaryOccupiedBlock = options.stationaryOccupiedBlock !== false ? 1 : 0;
    this.reusedStateCount = 0; this.hotAllocationCount = 0;
    this.result = { status: ROOT_STATUS.INVALID, bundle: null, informationComplete: false,
      frame: 0, mapHashLo: 0, mapHashHi: 0, matchReset: false };
  }
  ensureState(map) {
    if (!Array.isArray(map) || map.length < 1 || !Array.isArray(map[0]) || map[0].length < 1)
      return 0;
    const width = map.length; const height = map[0].length;
    if (width > CAPACITY.MAX_MAP_WIDTH || height > CAPACITY.MAX_MAP_HEIGHT) return 0;
    for (let x = 0; x < width; x += 1) if (!Array.isArray(map[x]) || map[x].length !== height) return 0;
    if (!this.state || width !== this.width || height !== this.height) {
      this.width = width; this.height = height; this.state = new FastState(width, height);
      this.kernel = new FastKernel(this.state, {
        stationaryOccupiedBlock: Boolean(this.stationaryOccupiedBlock)
      }); this.hazard = new HazardKernel(this.state, {
        reverseViabilityCacheEntries: this.reverseViabilityCacheEntries,
        reverseLatticeCacheEntries: this.reverseLatticeCacheEntries,
        reverseLatticeLayerCache: Boolean(this.reverseLatticeLayerCache),
        hazardSignatureCache: Boolean(this.hazardSignatureCache)
      });
      this.hard = new HardGate(this.kernel, this.hazard, 0);
      this.bundle = { status: 1, state: this.state, kernel: this.kernel,
        hazard: this.hazard, hard: this.hard, errorCode: null };
      this.tracker.reset(); this.terrainVersion = 0; this.lastEnemyCell = NONE_CELL;
      this.lastEnemySeenFrame = NONE_FRAME;
    } else this.reusedStateCount += 1;
    return 1;
  }
  copyTerrain(map) {
    const terrain = this.state.arrays[ARRAY.TERRAIN]; let changed = 0;
    let lo = 0x811c9dc5; let hi = 0x9e3779b9;
    for (let x = 0; x < this.width; x += 1) for (let y = 0; y < this.height; y += 1) {
      const code = terrainCode(map[x][y]); if (code < 0) return 0; const cell = y * this.width + x;
      if (terrain[cell] !== code) { terrain[cell] = code; changed = 1; }
      lo = mix(lo, code + cell * 17); hi = mix(hi, code + x * 31 + y * 131);
    }
    if (changed) this.terrainVersion += 1; this.mapHashLo = lo; this.mapHashHi = hi; return 1;
  }
  clearDynamic() {
    const a = this.state.arrays;
    for (let id = ARRAY.TANK_CELL; id <= ARRAY.BOMB_EXPLODE; id += 1) a[id].fill(0);
    a[ARRAY.SCALAR].fill(0);
    for (let id = ARRAY.TANK_SHIELD_UNTIL; id <= ARRAY.TANK_FIRE_LOCK; id += 1)
      if (id !== ARRAY.TANK_SHIELD_HITS) a[id].fill(NONE_FRAME);
    a[ARRAY.TANK_POISON_APPLIED].fill(NONE_FRAME);
    a[ARRAY.TANK_RUNTIME].fill(UNKNOWN_RUNTIME);
    this.state.deltaUsed = 0; this.state.eventUsed = 0; this.state.transitionDeltaBase = 0;
    this.state.transitionEventBase = 0;
  }
  markIncomplete(reason) {
    this.informationComplete = 0; this.informationGapMask |= reason; return 0;
  }
  effectDeadline(side, type, frame) {
    const effect = this.activeEffect(side, type);
    if (effect && Number.isSafeInteger(effect.remainingFrames) && effect.remainingFrames >= 0)
      return frame + effect.remainingFrames;
    this.markIncomplete(INFORMATION_GAP.EFFECT_DEADLINE); return frame + 1;
  }
  activeEffect(side, type) {
    const effects = side && side.effects; const self = effects && effects.self;
    const debuff = effects && effects.debuff;
    return self && self.type === type ? self : debuff && debuff.type === type ? debuff : null;
  }
  setTank(side, seat, frame, fallbackCell, fallbackDirection) {
    const a = this.state.arrays; const tank = side && side.tank;
    let cell = tank ? positionCell(tank.position, this.width, this.height) : fallbackCell;
    let direction = tank ? directionCode(tank.direction) : fallbackDirection;
    if (cell === NONE_CELL || direction < 0) return 0;
    a[ARRAY.TANK_CELL][seat] = cell; a[ARRAY.TANK_DIR][seat] = direction;
    a[ARRAY.TANK_CRASH][seat] = tank && tank.crashed ? 1 : 0;
    if (!side || !Number.isSafeInteger(side.stars) || side.stars < 0)
      this.markIncomplete(INFORMATION_GAP.TANK_FIELDS);
    a[ARRAY.TANK_STARS][seat] = integer(side && side.stars);
    const skill = side && side.skill; const skillId = skill ? SKILL_BY_NAME[skill.type] : undefined;
    if (skillId === undefined || !Number.isSafeInteger(skill.remainingCooldownFrames) ||
        skill.remainingCooldownFrames < 0)
      this.markIncomplete(INFORMATION_GAP.TANK_FIELDS);
    a[ARRAY.TANK_SKILL][seat] = skillId || SKILL.NONE;
    a[ARRAY.TANK_SKILL_READY][seat] = frame + integer(skill && skill.remainingCooldownFrames);
    const status = side && side.status || {};
    for (let index = 0; index < STATUS_FIELDS.length; index += 1) {
      const field = STATUS_FIELDS[index];
      if (typeof status[field] !== "boolean") {
        this.markIncomplete(INFORMATION_GAP.STATUS_SHAPE); continue; }
      if (!status[field]) continue;
      const type = STATUS_EFFECT[field]; const arrayId = EFFECT_ARRAY[type];
      a[arrayId][seat] = this.effectDeadline(side, type, frame);
      if (type === "shield") {
        // The boundary exposes active/inactive but not residual charges. Use
        // the conservative endpoint for each side until a tracked world set
        // owns the exact charge count: never trust an unknown own charge for
        // survival, and never assume an enemy shield is already weakened.
        a[ARRAY.TANK_SHIELD_HITS][seat] = seat === 0 ? 0 : RULE.SHIELD_HITS;
        this.markIncomplete(INFORMATION_GAP.SHIELD_CHARGES); }
      if (type === "poison") {
        const effect = this.activeEffect(side, type);
        if (effect && Number.isSafeInteger(effect.remainingFrames) && effect.remainingFrames >= 0) {
          const applied = frame + effect.remainingFrames - RULE.SKILL_DURATION[SKILL.POISON];
          if (applied >= 0 && applied <= frame) a[ARRAY.TANK_POISON_APPLIED][seat] = applied;
          else this.markIncomplete(INFORMATION_GAP.POISON_PHASE);
        } else this.markIncomplete(INFORMATION_GAP.POISON_PHASE);
      }
    }
    const actionSpeedValid = status.actionSpeed === 1 ||
      (status.poisoned === true && status.actionSpeed === 0.5);
    if (typeof status.fireLocked !== "boolean" || typeof status.canActThisFrame !== "boolean" ||
        !actionSpeedValid) this.markIncomplete(INFORMATION_GAP.STATUS_SHAPE);
    if (status.fireLocked) { a[ARRAY.TANK_FIRE_LOCK][seat] = frame + 1;
      this.markIncomplete(INFORMATION_GAP.FIRE_LOCK_DEADLINE); }
    if (!side.effects || side.effects.self === undefined || side.effects.debuff === undefined)
      this.markIncomplete(INFORMATION_GAP.STATUS_SHAPE);
    if (!Number.isSafeInteger(status.bombCooldownFrames) || status.bombCooldownFrames < 0 ||
        typeof status.bombActive !== "boolean")
      this.markIncomplete(INFORMATION_GAP.BOMB_STATE);
    a[ARRAY.TANK_BOMB_READY][seat] = frame + integer(status.bombCooldownFrames);
    return 1;
  }
  validateCadence(side, seat, frame) {
    const status = side && side.status || {}; const a = this.state.arrays;
    const frozen = a[ARRAY.TANK_FROZEN_UNTIL][seat] !== NONE_FRAME &&
      a[ARRAY.TANK_FROZEN_UNTIL][seat] > frame;
    const poison = a[ARRAY.TANK_POISON_UNTIL][seat] !== NONE_FRAME &&
      a[ARRAY.TANK_POISON_UNTIL][seat] > frame;
    const applied = a[ARRAY.TANK_POISON_APPLIED][seat];
    const poisonHold = poison && applied !== NONE_FRAME && ((frame - applied) & 1) !== 0;
    const derivedCanAct = !frozen && !poisonHold;
    if (typeof status.canActThisFrame !== "boolean" || status.canActThisFrame !== derivedCanAct) {
      this.markIncomplete(INFORMATION_GAP.CADENCE);
      if (seat === 1) {
        this.enemyCapabilitySupportComplete = 0;
        this.enemyCapabilityReason |= typeof status.canActThisFrame !== "boolean" ?
          ENEMY_CAPABILITY_REASON.CADENCE_FIELD : ENEMY_CAPABILITY_REASON.CADENCE_MISMATCH;
      }
    }
  }
  copyTrackedEntities() {
    const a = this.state.arrays; const t = this.tracker;
    for (let slot = 0; slot < t.projectileActive.length; slot += 1) if (t.projectileActive[slot]) {
      a[ARRAY.PROJECTILE_ACTIVE][slot] = 1;
      a[ARRAY.PROJECTILE_GENERATION][slot] = t.projectileGeneration[slot];
      a[ARRAY.PROJECTILE_ID][slot] = t.projectileId[slot]; a[ARRAY.PROJECTILE_OWNER][slot] = t.projectileOwner[slot];
      a[ARRAY.PROJECTILE_CELL][slot] = t.projectileCell[slot];
      a[ARRAY.PROJECTILE_DIR][slot] = t.projectileDirection[slot];
      a[ARRAY.PROJECTILE_GROUP][slot] = t.projectileGroup[slot];
      a[ARRAY.PROJECTILE_MEMBER][slot] = t.projectileMember[slot];
      a[ARRAY.PROJECTILE_CREATED][slot] = t.projectileCreated[slot];
    }
    for (let slot = 0; slot < t.bombActive.length; slot += 1) if (t.bombActive[slot]) {
      if (!t.bombExact[slot]) {
        this.markIncomplete(INFORMATION_GAP.BOMB_TRACK); continue; }
      if (!t.bombOwnerExact[slot]) this.markIncomplete(INFORMATION_GAP.BOMB_TRACK);
      a[ARRAY.BOMB_ACTIVE][slot] = 1; a[ARRAY.BOMB_GENERATION][slot] = t.bombGeneration[slot];
      a[ARRAY.BOMB_ID][slot] = t.bombId[slot]; a[ARRAY.BOMB_OWNER][slot] = t.bombOwner[slot];
      a[ARRAY.BOMB_CELL][slot] = t.bombCell[slot]; a[ARRAY.BOMB_PLACED][slot] = t.bombPlaced[slot];
      a[ARRAY.BOMB_EXPLODE][slot] = t.bombExplode[slot];
    }
  }
  hiddenEnemyFallback(ownCell) {
    const terrain = this.state.arrays[ARRAY.TERRAIN]; let best = NONE_CELL; let bestDistance = -1;
    for (let cell = 0; cell < this.state.cells; cell += 1) {
      if (cell === ownCell || terrain[cell] === TERRAIN.WALL || terrain[cell] === TERRAIN.DIRT) continue;
      const distance = Math.abs(this.state.x(cell) - this.state.x(ownCell)) +
        Math.abs(this.state.y(cell) - this.state.y(ownCell));
      if (distance > bestDistance) { best = cell; bestDistance = distance; }
    }
    return best;
  }
  adapt(me, enemy, game) {
    const result = this.result; result.bundle = null; result.status = ROOT_STATUS.INVALID;
    this.matchReset = 0; this.informationComplete = 1; this.informationGapMask = 0;
    this.enemyCapabilitySupportComplete = 1; this.enemyCapabilityReason = 0;
    this.rootCount += 1;
    if (!me || !me.tank || !enemy || !game || !this.ensureState(game.map)) {
      this.invalidCount += 1; return result;
    }
    const frame = Number.isSafeInteger(game.frames) ? game.frames :
      Number.isSafeInteger(game.frame) ? game.frame : -1;
    if (frame < 0) { this.invalidCount += 1; return result; }
    const ownCell = positionCell(me.tank.position, this.width, this.height);
    const ownDirection = directionCode(me.tank.direction); const hadPriorRoot = this.lastFrame !== NONE_FRAME;
    if (ownCell === NONE_CELL || ownDirection < 0) { this.invalidCount += 1; return result; }
    if (hadPriorRoot && frame < this.lastFrame) {
      this.tracker.reset(frame); this.lastEnemyCell = NONE_CELL;
      this.lastEnemySeenFrame = NONE_FRAME; this.matchReset = 1;
    }
    this.tracker.projectiles.beginObservation(); this.tracker.bombSeen.fill(0);
    this.tracker.complete = 1;
    // Advance last root's entities against last root's terrain. The current
    // map already reflects dirt destroyed by that transition; copying it first
    // would let a projectile travel through the dirt that actually stopped it.
    this.tracker.advance(frame, this.state.arrays[ARRAY.TERRAIN],
      this.width, this.height, ownCell);
    if (!this.copyTerrain(game.map)) { this.invalidCount += 1; return result; }
    if (me.bullet === undefined || enemy.bullet === undefined)
      this.markIncomplete(INFORMATION_GAP.BULLET_FIELD);
    this.tracker.observeProjectiles(me.bullet, 0, frame, this.width, this.height);
    this.tracker.observeProjectiles(enemy.bullet, 1, frame, this.width, this.height);
    // A scalar bullet observation is never a complete projectile set. A null
    // observation is nevertheless complete evidence for the observer's strict
    // forward-visible ray, so predicted tracks on that ray may be refuted.
    this.tracker.reconcileMissingEnemyProjectiles(ownCell, ownDirection,
      this.state.arrays[ARRAY.TERRAIN], this.width, enemy.bullet === null);
    this.tracker.observeBombs(game.bombs, frame, this.width, this.height,
      me.tank.id, enemy.tank && enemy.tank.id);
    if (!this.tracker.complete || enemy.bullet === undefined) {
      this.enemyCapabilitySupportComplete = 0;
      this.enemyCapabilityReason |= ENEMY_CAPABILITY_REASON.PROJECTILE_SUPPORT;
    }
    this.clearDynamic();
    if (enemy.tank) {
      this.lastEnemyCell = positionCell(enemy.tank.position, this.width, this.height);
      this.lastEnemyDirection = directionCode(enemy.tank.direction);
      this.lastEnemySeenFrame = frame; this.enemyVisible = 1;
    } else { this.enemyVisible = 0; this.markIncomplete(INFORMATION_GAP.HIDDEN_ENEMY);
      if (this.lastEnemyCell === NONE_CELL) this.lastEnemyCell = this.hiddenEnemyFallback(ownCell); }
    if (!this.setTank(me, 0, frame, ownCell, ownDirection) ||
        !this.setTank(enemy, 1, frame, this.lastEnemyCell, this.lastEnemyDirection)) {
      this.invalidCount += 1; result.status = ROOT_STATUS.INCOMPLETE; return result;
    }
    this.validateCadence(me, 0, frame); this.validateCadence(enemy, 1, frame);
    if (!this.tracker.complete) this.markIncomplete(INFORMATION_GAP.TRACKER_SUPPORT);
    this.copyTrackedEntities();
    const a = this.state.arrays; const scalar = a[ARRAY.SCALAR]; scalar[SCALAR.FRAME] = frame;
    scalar[SCALAR.RECORD] = frame; scalar[SCALAR.NEXT_ENTITY] = this.tracker.nextEntityId;
    scalar[SCALAR.TERRAIN_VERSION] = this.terrainVersion;
    scalar[SCALAR.TOPOLOGY_VERSION] = this.terrainVersion;
    if (game.star === undefined) this.markIncomplete(INFORMATION_GAP.STAR_FIELD);
    scalar[SCALAR.STAR_CELL] = game.star === null || game.star === undefined ? NONE_CELL :
      positionCell(game.star, this.width, this.height);
    scalar[SCALAR.TIMEOUT_SEAT] = 2; scalar[SCALAR.SCRIPT_ERROR_SEAT] = 2;
    scalar[SCALAR.WINNER_SEAT] = 2;
    // onIdle exposes neither side's cumulative platform runtime. This is the
    // accepted terminal policy relation, not a local elapsed-time estimate.
    a[ARRAY.TANK_RUNTIME][0] = 1; a[ARRAY.TANK_RUNTIME][1] = 0;
    scalar[SCALAR.RUNTIME_POLICY] = 1;
    const ownStatus = me.status || {}; const enemyStatus = enemy.status || {};
    if (typeof enemyStatus.fireLocked !== "boolean") {
      this.enemyCapabilitySupportComplete = 0;
      this.enemyCapabilityReason |= ENEMY_CAPABILITY_REASON.FIRE_LOCK_FIELD;
    }
    if (typeof enemyStatus.canActThisFrame !== "boolean") {
      this.enemyCapabilitySupportComplete = 0;
      this.enemyCapabilityReason |= ENEMY_CAPABILITY_REASON.CAN_ACT_FIELD;
    }
    if (enemyStatus.actionSpeed !== 1 &&
        !(enemyStatus.poisoned === true && enemyStatus.actionSpeed === 0.5)) {
      this.enemyCapabilitySupportComplete = 0;
      this.enemyCapabilityReason |= ENEMY_CAPABILITY_REASON.ACTION_SPEED;
    }
    if (!enemy.effects || enemy.effects.self === undefined || enemy.effects.debuff === undefined) {
      this.enemyCapabilitySupportComplete = 0;
      this.enemyCapabilityReason |= ENEMY_CAPABILITY_REASON.EFFECT_SHAPE;
    }
    // The boundary exposes only a boolean fire lock. Its future deadline is
    // unknown, so the timeline may over-approximate risk but cannot prove safe.
    if (enemyStatus.fireLocked) {
      this.enemyCapabilitySupportComplete = 0;
      this.enemyCapabilityReason |= ENEMY_CAPABILITY_REASON.FIRE_LOCK_ACTIVE;
    }
    // enemy.bullet is a visibility-filtered observation. After the initial
    // root, null with no exact tracked projectile means two hidden worlds:
    // no projectile, or an unobserved active projectile. Never promote that
    // relation to an exact PhysicalState/strict Proof.
    // Re-evaluating the identical platform frame is idempotent. Only a later
    // callback introduces the hidden-world alternative "no bullet vs unseen
    // bullet"; treating a same-frame diagnostic/cache probe as new evidence
    // would change PhysicalState and suppress valid TT reuse.
    if (hadPriorRoot && frame > this.lastFrame && !hasProjectile(enemy.bullet) &&
        !this.tracker.hasActiveProjectile(1))
      this.markIncomplete(INFORMATION_GAP.POSSIBLE_ENEMY_PROJECTILE);
    this.ownCanFire = !hasProjectile(me.bullet) && !this.tracker.hasActiveProjectile(0) &&
      !ownStatus.fireLocked;
    this.enemyCanFire = !hasProjectile(enemy.bullet) && !this.tracker.hasActiveProjectile(1) &&
      !enemyStatus.fireLocked;
    this.ownBombReady = !ownStatus.bombActive && integer(ownStatus.bombCooldownFrames) === 0;
    this.enemyBombReady = !enemyStatus.bombActive && integer(enemyStatus.bombCooldownFrames) === 0;
    this.ownSkillReady = !!me.skill && integer(me.skill.remainingCooldownFrames, 1) === 0;
    this.enemySkillReady = !!enemy.skill && integer(enemy.skill.remainingCooldownFrames, 1) === 0;
    this.ownCanAct = ownStatus.canActThisFrame !== false; this.enemyCanAct = enemyStatus.canActThisFrame !== false;
    this.state.initializeHash(); this.hazard.builtHashLo = 0xffffffff;
    this.hazard.builtHashHi = 0xffffffff; this.lastFrame = frame;
    result.status = this.informationComplete ? ROOT_STATUS.OK : ROOT_STATUS.INCOMPLETE;
    result.bundle = this.bundle; result.informationComplete = !!this.informationComplete;
    result.frame = frame; result.mapHashLo = this.mapHashLo; result.mapHashHi = this.mapHashHi;
    result.matchReset = !!this.matchReset; return result;
  }
  recordEmission(action) {
    if (action === ACTION.FIRE && this.state) {
      const a = this.state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
      const overloaded = a[ARRAY.TANK_OVERLOAD_UNTIL][0] !== NONE_FRAME &&
        a[ARRAY.TANK_OVERLOAD_UNTIL][0] > frame;
      this.tracker.recordOwnFire(a[ARRAY.TANK_CELL][0], a[ARRAY.TANK_DIR][0], frame, overloaded);
    } else if (action === ACTION.THROW_BOMB && this.state)
      this.tracker.recordOwnBomb(this.state.arrays[ARRAY.TANK_CELL][0],
        this.state.arrays[ARRAY.SCALAR][SCALAR.FRAME]);
  }
}
module.exports = { ROOT_STATUS, ENEMY_CAPABILITY_REASON,
  INFORMATION_GAP, integer, hasProjectile, positionCell, directionCode,
  terrainCode, observedActionCode, mix, productionValueSupportComplete,
  ProductionEntityTracker, ProductionObservationAdapter };
