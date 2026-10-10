"use strict";

const { CAPACITY, RULE } = require("../generated/fast-config");
const { FastState, ARRAY, SCALAR, DIRECTION_BY_NAME, SKILL_BY_NAME } =
  require("../state/fast-state");
const { FastKernel } = require("../fast/kernel");
const { HazardKernel } = require("../fast/hazard");
const { HardGate } = require("../fast/hard-gate");
const { ACTION, SKILL, TERRAIN, HARD_STATUS, NONE_FRAME, NONE_CELL,
  BOOST_COMPOUND_BASE, BOOST_COMPOUND_STRIDE,
  UNKNOWN_RUNTIME, DX, DY } = require("../abi/fast-codes");
const { CACHE_ID, WORK_KIND, RUNTIME_MODE } = require("../abi/cache-runtime-codes");
const { PROOF_STATUS, NONE_NODE } = require("../abi/search-codes");
const { SEARCH_CAPACITY } = require("../generated/search-config");
const { FEATURE_INPUT, STRATEGY_INPUT, GLOBAL_MODE, OPPONENT_EVENT, OPPONENT_CONTEXT,
  OPPORTUNITY, CHOICE, FEATURE_DEPENDENCY, PLAN_KIND, PLAN_STATUS, PLAN_REASON,
  PLAN_PURPOSE, STRATEGY, STRATEGY_PURPOSE, STRATEGY_MODIFIER, NONE_HANDLE } =
  require("../abi/policy-codes");
const { TACTICAL_CONFIG } = require("../generated/tactical-config");
const { STRATEGY_CONFIG } = require("../generated/policy-config");
const { TankRootAdapter } = require("../search/tank-root-adapter");
const { SearchEngine } = require("../search/engine");
const { DEEP_WIDTH, DIRECT_STUN_ROOT_NODE_LIMIT, ProductionDepthSearch } =
  require("../search/production-depth-search");
const { OPTION_SEARCH_STATUS, optionSearchOwnableKind, OptionAwareDepthSearch } =
  require("../search/option-aware-depth-search");
const { ProductionInformationSearch } = require("../search/production-information-search");
const { OptionInformationIntervalSearch } =
  require("../search/option-information-interval-search");
const { AttackSetupClosure } = require("../search/attack-setup-closure");
const { SelectiveGeometryShadow } = require("../search/selective-geometry-shadow");
const { RootTransitionSlab } = require("../search/root-transition-slab");
const { InformationSafetyClosure, SAFETY_STATUS, SAFETY_HORIZON, NONE_FATAL_FRAME } =
  require("../search/information-safety-closure");
const { ThreatCapabilityTimeline } = require("../search/threat-capability-timeline");
const { ObservationSafetyFrontier, FRONTIER_STATUS } =
  require("../search/observation-safety-frontier");
const { MultiFrameRiskBounds } = require("../search/multi-frame-risk-bounds");
const { ProductionForcedWinSearch } = require("../search/production-forced-win-search");
const { StrictSafeThreatFireProofArena, STRICT_SAFE_THREAT_NODE_BUDGET } =
  require("../search/strict-safe-threat-fire-proof");
const { RiskAcceptanceController } = require("../search/risk-acceptance-controller");
const { RiskProfile } = require("../search/risk");
const { TacticalEnvelopeView } = require("../search/tactical-envelope");
const { HiddenProjectileRiskField } = require("./hidden-projectile-risk-field");
const { CombatPressure } = require("../search/combat-pressure");
const { ProjectileAttackClosure, PAC_STATUS, PAC_CELL } =
  require("../search/projectile-attack-closure");
const { PolicyLayer, actionFamily } = require("../policy/layer");
const { STRATEGIC_PROFILE } = require("../policy/strategy-layer");
const { NativeInitiativeArbiter } = require("../policy/native-initiative-arbiter");
const { ResponseOptionController } =
  require("../policy/response-option-controller");
const { OptionPortfolioSlab } = require("../policy/option-portfolio");
const { OBJECTIVE_PROFILE, ObjectiveOptionRouter } =
  require("../policy/objective-option-router");
const { NominalPhysicalEvidenceArbiter } =
  require("../policy/nominal-physical-evidence-arbiter");
const { StrategicPathArbiter } = require("../policy/strategic-path-arbiter");
const { ProductionCacheBank } = require("../cache/production-cache");
const { PATH_UNREACHABLE } = require("../cache/path-distance-field");
const { RuntimeController, RuntimeSearchCoordinator, EmergencyEmitter } = require("./controller");
const { PossibleProjectileTracker } = require("./possible-projectiles");
const DEFAULT_REVERSE_LATTICE_CACHE_ENTRIES = 16;
const { ProjectileTrackPool, PROJECTILE_FACT } = require("./projectile-track-pool");
const { FinalActionGate } = require("./final-action-gate");
const { EscapeObligation, SUPPORT_STATUS, SUCCESSOR_PROOF } =
  require("./escape-obligation");
const { ROOT_CONTROL_MODE, TACTICAL_TRIGGER, ControlModeRouter } =
  require("./root-control-mode");
const { POSSIBLE_HAZARD } = require("../policy/hidden-risk");

const ROOT_STATUS = Object.freeze({ OK: 1, INCOMPLETE: 2, INVALID: 3, CAPACITY: 4 });
// Diagnostic-only dependency mask for enemy action support.  These bits never
// change the PhysicalState or action selection; they explain why a proof that
// quantifies over enemy actions must fail closed.
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
const SCORE_REJECTED = -1000000000;
const SCORE_EMERGENCY_HOLD = SCORE_REJECTED + 1;
const SCORE_INCOMPLETE_PENALTY = 200000;
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

class ProductionRootEngine {
  constructor(options = {}) {
    const reverseLatticeCacheEntries = Number.isSafeInteger(
      options.diagnosticReverseLatticeCacheEntries) ?
      options.diagnosticReverseLatticeCacheEntries :
      Number.isSafeInteger(options.reverseLatticeCacheEntries) ?
        options.reverseLatticeCacheEntries : DEFAULT_REVERSE_LATTICE_CACHE_ENTRIES;
    const reverseLatticeLayerCache = typeof options.diagnosticReverseLatticeLayerCache ===
      "boolean" ? options.diagnosticReverseLatticeLayerCache :
      options.reverseLatticeLayerCache !== false;
    this.adapter = new ProductionObservationAdapter({
      reverseViabilityCacheEntries: options.diagnosticReverseViabilityCacheEntries,
      reverseLatticeCacheEntries,
      reverseLatticeLayerCache,
      hazardSignatureCache: options.diagnosticHazardSignatureCache !== false,
      stationaryOccupiedBlock: options.diagnosticStationaryOccupiedBlock !== false
    });
    this.runtime = new RuntimeController(options.runtime || {});
    this.policy = new PolicyLayer({ ownSkillId: SKILL.POISON });
    this.diagnosticDisableResourceActions =
      options.diagnosticDisableResourceActions ? 1 : 0;
    this.nativeInitiativeArbiter = new NativeInitiativeArbiter();
    this.nativeInitiativeEnabled = options.nativeInitiativeEnabled ? 1 : 0;
    // Default-off production candidate port. The root is injected so the
    // current upload entry does not statically pull the experimental policy
    // stack into its bundle. It shares this engine's FastState and slabs.
    this.nativeBasePolicyRoot = options.nativeBasePolicyRoot || null;
    this.nativeBasePolicyRootCheckCount = 0;
    this.nativeBasePolicyRootOverrideCount = 0;
    this.nativeBasePolicyRootResourceSkipCount = 0;
    // Architecture diagnostic: replace only the non-contact owner.  This
    // separates navigation quality from the tactical/escape paths so a broad
    // staged controller cannot hide which band caused an outcome change.
    this.nativeNavigationOnlyEnabled = options.nativeNavigationOnlyEnabled ? 1 : 0;
    const objectiveProfile = options.diagnosticObjectiveOptionProfile | 0;
    this.objectiveOptionRouter = objectiveProfile === OBJECTIVE_PROFILE.ATTACK_FIRST ||
      objectiveProfile === OBJECTIVE_PROFILE.STAR_FIRST ?
      new ObjectiveOptionRouter(objectiveProfile) : null;
    this.diagnosticNominalPhysicalEvidenceOnly =
      options.diagnosticNominalPhysicalEvidenceOnly ? 1 : 0;
    this.nominalPhysicalEvidenceArbiter = new NominalPhysicalEvidenceArbiter(
      options.diagnosticNominalPhysicalEvidenceOwner);
    this.strategicPathArbiter = options.diagnosticStrategicPathOwner ?
      new StrategicPathArbiter(options.diagnosticStrategicPathVerification) : null;
    this.nominalPhysicalRootActive = 0;
    this.expandedTacticalContactMask = options.diagnosticExpandedTacticalContactMask | 0;
    this.expandedContactDisabledCount = 0; this.expandedContactBombCount = 0;
    this.expandedContactPredictiveCount = 0;
    this.contactExactCount = 0; this.contactInexactCount = 0;
    this.contactEmergencyCount = 0; this.contactValueBudgetCount = 0;
    this.contactValueBudgetBlockedCount = 0;
    this.contactInformationConsumerBlockedCount = 0;
    this.responseOption = new ResponseOptionController().configure(
      options.diagnosticResponseOptionEnabled);
    const informationOptionIntervalEnabled =
      options.diagnosticInformationOptionIntervalShadow ||
      options.diagnosticInformationOptionIntervalActive;
    const optionAwareSearchEnabled = options.diagnosticOptionAwareSearchShadow ||
      options.diagnosticOptionAwareSearchActive ||
      options.diagnosticOptionAwareSingleSearch;
    this.diagnosticTypedOptionPortfolio = options.diagnosticTypedOptionPortfolio ? 1 : 0;
    // Diagnostic ownership boundary: Strategy may describe an action's
    // purpose, but it must not delete a Hard/Risk-surviving primitive before
    // the tactical Option search has compared it.  Production remains closed
    // by default until paired arena evidence accepts the new boundary.
    this.diagnosticOpenStrategyPortfolio =
      options.diagnosticOpenStrategyPortfolio ? 1 : 0;
    this.diagnosticOpenQualifiedStrategyPortfolio =
      options.diagnosticOpenQualifiedStrategyPortfolio ? 1 : 0;
    this.diagnosticContactQualifiedStrategyPortfolio =
      options.diagnosticContactQualifiedStrategyPortfolio ? 1 : 0;
    this.openStrategyPortfolioRootCount = 0;
    this.qualifiedStrategyResourceBlockedCount = 0;
    this.optionPortfolio = options.diagnosticOptionPortfolioShadow ||
      this.diagnosticTypedOptionPortfolio || optionAwareSearchEnabled ||
      informationOptionIntervalEnabled ?
      new OptionPortfolioSlab() : null;
    this.strategyBands = this.policy.strategyBands; this.rootAdapter = new TankRootAdapter();
    if (options.diagnosticNavigationContinuityMembership === false)
      this.strategyBands.planContinuityPurposeEnabled = 0;
    this.strategyBands.terminalPurposeScoped =
      options.diagnosticTerminalPurposeScoped ? 1 : 0;
    this.riskProfile = new RiskProfile();
    this.search = new SearchEngine(this.rootAdapter.graph, { riskProfile: this.riskProfile });
    this.coordinator = new RuntimeSearchCoordinator();
    this.cacheBank = new ProductionCacheBank({ physicalValueEntries:
      Number.isSafeInteger(options.diagnosticPhysicalTTEntries) ?
        options.diagnosticPhysicalTTEntries : 0 });
    this.path = this.cacheBank.pathField;
    this.rootTransitions = new RootTransitionSlab();
    if (options.diagnosticRootTransitionSlab === false) this.rootTransitions.setEnabled(false);
    this.depthSearch = new ProductionDepthSearch(this.cacheBank, this.runtime.runtimeConfig,
      this.rootTransitions, { selectiveContinuationEnabled:
        options.diagnosticSelectiveContinuation !== false,
        depthTwoPreflightEnabled: options.diagnosticDepthTwoPreflight === true,
        directDepthTwoDuringStunEnabled:
          options.diagnosticDirectDepthTwoDuringStun !== false,
        directDepthTwoStunMaxRootNodes:
          Number.isSafeInteger(options.diagnosticDirectDepthTwoStunMaxRootNodes) ?
            options.diagnosticDirectDepthTwoStunMaxRootNodes : DIRECT_STUN_ROOT_NODE_LIMIT,
        diagnosticNodeCapacity:
          Number.isSafeInteger(options.diagnosticNodeCapacity) ?
            options.diagnosticNodeCapacity : undefined,
        windowedBoundsEnabled: options.diagnosticWindowedBounds !== false,
        crossFramePVEnabled: options.diagnosticCrossFramePV !== false,
        crossFrameRootPVEnabled: options.diagnosticCrossFrameRootPV === true });
    this.optionAwareDepthSearch = optionAwareSearchEnabled ?
      new OptionAwareDepthSearch(this.cacheBank, this.runtime.runtimeConfig, null, {
        selectiveContinuationEnabled: false,
        windowedBoundsEnabled: false,
        crossFramePVEnabled: false,
        crossFrameRootPVEnabled: false
      }) : null;
    if (this.optionAwareDepthSearch) this.optionAwareDepthSearch.rootTransitions.setEnabled(false);
    this.optionAwareSingleSearch = options.diagnosticOptionAwareSingleSearch ? 1 : 0;
    this.optionAwareSearchActive = options.diagnosticOptionAwareSearchActive ||
      this.optionAwareSingleSearch ? 1 : 0;
    this.optionAwareSearchDepth = Number.isSafeInteger(options.diagnosticOptionAwareSearchDepth) ?
      Math.max(1, Math.min(SEARCH_CAPACITY.MAX_DECISION_DEPTH,
        options.diagnosticOptionAwareSearchDepth)) : 2;
    this.optionAwareSearchNodeBudget = Number.isSafeInteger(
      options.diagnosticOptionAwareSearchNodeBudget) ?
      Math.max(1, options.diagnosticOptionAwareSearchNodeBudget) : 768;
    this.optionAwareSearchProposalCount = 0; this.optionAwareSearchOverrideCount = 0;
    this.optionAwareSearchHardBlockedCount = 0; this.optionAwareSearchRiskBlockedCount = 0;
    this.optionAwareSearchIncompleteSupportCount = 0; this.optionAwareSearchLastProposal = -1;
    this.optionAwareSearchCommittedBlockedCount = 0;
    this.optionAwareSearchNonTacticalBlockedCount = 0;
    this.informationSearch = new ProductionInformationSearch({ riskProfile: this.riskProfile,
      runtimeConfig: this.runtime.runtimeConfig,
      maximumEnemyColumns: options.diagnosticInformationEnemyColumns });
    this.attackSetupClosure = informationOptionIntervalEnabled ? new AttackSetupClosure(
      SEARCH_CAPACITY.MAX_OUR_ACTIONS, {
        twoStageShadow: options.diagnosticTwoStageAttackSetupShadow === true,
        twoStageOwnership: options.diagnosticTwoStageAttackSetupActive === true,
        possibleProjectileShadow:
          options.diagnosticPossibleProjectileAttackSetupShadow === true
      }) : null;
    this.optionInformationInterval = informationOptionIntervalEnabled ?
      new OptionInformationIntervalSearch(this.cacheBank, this.runtime.runtimeConfig,
        this.riskProfile, { active: options.diagnosticInformationOptionIntervalActive,
          allowSetupOwnership: options.diagnosticInformationOptionLegacySetupOwnership,
          attackSetupClosure: this.attackSetupClosure,
          maximumEnemyColumns: options.diagnosticInformationEnemyColumns }) : null;
    this.optionInformationIntervalNodeBudget = Number.isSafeInteger(
      options.diagnosticInformationOptionIntervalNodeBudget) ?
      Math.max(1, options.diagnosticInformationOptionIntervalNodeBudget) : 384;
    this.selectiveGeometryShadow = options.diagnosticSelectiveGeometryShadow ?
      new SelectiveGeometryShadow({ maximumRows: options.diagnosticSelectiveGeometryRows,
        triggerMask: options.diagnosticSelectiveGeometryTriggerMask,
        triggerValue: options.diagnosticSelectiveGeometryTriggerValue,
        cooldownFrames: options.diagnosticSelectiveGeometryCooldownFrames,
        active: options.diagnosticSelectiveGeometryActive }) : null;
    this.safetyClosure = new InformationSafetyClosure({
      uniformChanceMass: options.diagnosticUniformChanceMass === true
    });
    this.threatCapability = new ThreatCapabilityTimeline();
    this.observationSafety = new ObservationSafetyFrontier();
    this.multiFrameRisk = new MultiFrameRiskBounds();
    this.hiddenProjectileRisk = new HiddenProjectileRiskField();
    this.riskController = new RiskAcceptanceController({
      riskProfile: this.riskProfile,
      softEscapeSlackDominance: options.softEscapeSlackDominance,
      legacyEmergencySlackFirst: options.diagnosticLegacyNoAcceptablePoseFallback,
      incompleteSearchOwnership: options.diagnosticIncompleteSearchOwnership,
      softSearchProposalEvidence: options.diagnosticSoftSearchProposalEvidence
    });
    this.diagnosticLegacyNoAcceptablePoseFallback =
      options.diagnosticLegacyNoAcceptablePoseFallback ? 1 : 0;
    // HP30: Physical Minimax only needs to evaluate rows that can still reach
    // the final Risk Pareto frontier.  Keep an explicit false switch for
    // differential diagnostics; production uses the compact domain.
    this.compactPhysicalRiskFrontierEnabled =
      options.diagnosticCompactPhysicalRiskFrontier === false ? 0 : 1;
    this.compactPhysicalRiskFrontierAttempts = 0;
    this.compactPhysicalRiskFrontierFullRows = 0;
    this.compactPhysicalRiskFrontierRows = 0;
    this.compactPhysicalRiskFrontierSingleRows = 0;
    this.compactPhysicalRiskFrontierViolations = 0;
    this.diagnosticIncompleteSearchOwnership =
      options.diagnosticIncompleteSearchOwnership ? 1 : 0;
    this.tacticalEnvelope = new TacticalEnvelopeView();
    this.combat = new CombatPressure();
    this.projectileAttack = new ProjectileAttackClosure();
    this.projectileAttackClosure = this.projectileAttack;
    this.forcedWinSearch = new ProductionForcedWinSearch(this.rootTransitions);
    // BP150 Shadow/causal POC. The arena is constructed only for an explicitly
    // enabled diagnostic. Its work is kept in a separate ledger so observing
    // the proof cannot move the production fallback point. Default production
    // never constructs it or grants it action ownership.
    this.diagnosticStrictSafeThreatFireActive =
      options.diagnosticStrictSafeThreatFireActive ? 1 : 0;
    this.diagnosticStrictDoomedFireActive =
      options.diagnosticStrictDoomedFireActive ? 1 : 0;
    this.diagnosticStrictSafeThreatFireShadow =
      options.diagnosticStrictSafeThreatFireShadow ||
      this.diagnosticStrictSafeThreatFireActive ||
      this.diagnosticStrictDoomedFireActive ? 1 : 0;
    this.strictSafeThreatFireProofArena = null;
    this.strictSafeThreatFireProofState = null;
    this.strictSafeThreatFireShadowScheduledCount = 0;
    this.strictSafeThreatFireShadowExactBlockedCount = 0;
    this.strictSafeThreatFireShadowPossibleOnlyBlockedCount = 0;
    this.strictSafeThreatFireShadowPossibleWithOtherBlockedCount = 0;
    this.strictSafeThreatFireShadowOtherGapBlockedCount = 0;
    this.strictSafeThreatFireShadowGapBitCount =
      this.diagnosticStrictSafeThreatFireShadow ? new Uint32Array(15) : null;
    this.strictSafeThreatFireShadowPossibleCount =
      this.diagnosticStrictSafeThreatFireShadow ?
        new Uint32Array(CAPACITY.MAX_PROJECTILES + 1) : null;
    this.strictSafeThreatFireShadowPossiblePoolCompleteCount = 0;
    this.strictSafeThreatFireShadowPossiblePoolIncompleteCount = 0;
    this.strictSafeThreatFireShadowResolvedPossibleGapCount = 0;
    this.strictSafeThreatFireShadowBudgetBlockedCount = 0;
    this.strictSafeThreatFireShadowRootFireBlockedCount = 0;
    this.strictSafeThreatFireShadowProvenCount = 0;
    this.strictSafeThreatFireShadowDoomedProvenCount = 0;
    this.strictSafeThreatFireShadowThreatOnlyProvenCount = 0;
    this.strictSafeThreatFireShadowPacCompleteCount = 0;
    this.strictSafeThreatFireShadowPacIncompleteCount = 0;
    this.strictSafeThreatFireShadowPrunableRootCount = 0;
    this.strictSafeThreatFireShadowPrunableColumnCount = 0;
    this.strictSafeThreatFireShadowPrunableRootNodeCount = 0;
    this.strictSafeThreatFireShadowUnknownCount = 0;
    this.strictSafeThreatFireShadowActionableCount = 0;
    this.strictSafeThreatFireShadowAlreadyFireCount = 0;
    this.strictSafeThreatFireActiveOverrideCount = 0;
    this.strictSafeThreatFireActiveMissingRowCount = 0;
    this.strictSafeThreatFireActiveFinalRejectCount = 0;
    this.strictDoomedFireActiveOverrideCount = 0;
    this.strictSafeThreatFireShadowNodes = 0;
    this.strictSafeThreatFireShadowWorkUnits = 0;
    this.strictSafeThreatFireShadowRestoreFailures = 0;
    this.strictSafeThreatFireShadowHotAllocationCount = 0;
    this.strictSafeThreatFireShadowLastStatus = PROOF_STATUS.UNKNOWN;
    this.strictSafeThreatFireShadowLastAllDoomed = 0;
    this.strictSafeThreatFireShadowLastFireRow = -1;
    // Diagnostic-only continuation theorem for PAC survivor columns. Keeping
    // the second proof arena absent by default preserves production memory and
    // prevents Shadow work from changing normal proof state or runtime budget.
    this.residualAttackProof = options.diagnosticResidualAttackProof ?
      new ProductionForcedWinSearch() : null;
    this.residualAttackProofStatus = this.residualAttackProof ?
      new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS) : null;
    this.residualAttackProofDepth = Number.isSafeInteger(
      options.diagnosticResidualAttackProofDepth) ?
      Math.max(1, Math.min(SEARCH_CAPACITY.MAX_DECISION_DEPTH,
        options.diagnosticResidualAttackProofDepth)) : 4;
    this.residualAttackProofBudget = Number.isSafeInteger(
      options.diagnosticResidualAttackProofBudget) ?
      Math.max(1, options.diagnosticResidualAttackProofBudget) : 256;
    this.emergency = new EmergencyEmitter(this.runtime.emergency);
    this.finalGate = new FinalActionGate(this.rootTransitions);
    this.escapeObligation = new EscapeObligation({
      chanceComplete: options.diagnosticChanceCompleteEscapeObligation === true,
      chanceSurvivalMass: options.diagnosticChanceSurvivalMass === true
    });
    this.diagnosticChanceSurvivalRisk =
      options.diagnosticChanceSurvivalRisk === true ? 1 : 0;
    this.diagnosticPersistentEscapePlan =
      options.diagnosticPersistentEscapePlan === true ? 1 : 0;
    // Diagnostic ownership repair: a non-empty committed viable subset is an
    // action-domain constraint, not a reason to suppress tactical value
    // search. A fully trapped root remains COMMITTED_ESCAPE.
    this.diagnosticContactSearchWithinEscape =
      options.diagnosticContactSearchWithinEscape ? 1 : 0;
    this.contactSearchWithinEscapeRootCount = 0;
    // V3 causality made final-only rescue promising, but native V2 Discovery
    // showed that removing its existing early membership loses whole games.
    // Keep early membership by default and expose the removal only for A/B.
    this.diagnosticLegacyEarlyEscapeRestriction =
      options.diagnosticLegacyEarlyEscapeRestriction === false ? 0 : 1;
    this.strictCommittedRescueEnabled =
      options.strictCommittedRescueEnabled === false ? 0 : 1;
    // A narrow EO×PAC causal certificate. Native paired evidence found one
    // LOSS-to-WIN and no negative transition; diagnostics may still disable it.
    this.verifiedDirectKillEnabled =
      options.verifiedDirectKillEnabled === false ? 0 : 1;
    this.diagnosticDisableEscapeQuality = options.diagnosticDisableEscapeQuality ? 1 : 0;
    this.diagnosticDisableEscapeObligation = options.diagnosticDisableEscapeObligation ? 1 : 0;
    this.diagnosticDisableProjectileAttackClosure =
      options.diagnosticDisableProjectileAttackClosure ? 1 : 0;
    if (this.diagnosticDisableProjectileAttackClosure)
      this.projectileAttack.enabled = 0;
    // V3 component-arena ablations. All default to off and are never selected
    // by the production bundle.
    this.diagnosticDisablePhysicalSearch = options.diagnosticDisablePhysicalSearch ? 1 : 0;
    this.diagnosticDisableInformationSearch = options.diagnosticDisableInformationSearch ? 1 : 0;
    this.diagnosticDisableRiskController = options.diagnosticDisableRiskController ? 1 : 0;
    this.diagnosticDisableStageMatrix = options.diagnosticDisableStageMatrix ? 1 : 0;
    this.diagnosticDisableInformationSafety = options.diagnosticDisableInformationSafety ? 1 : 0;
    this.diagnosticDisableHiddenProjectileRisk =
      options.diagnosticDisableHiddenProjectileRisk ? 1 : 0;
    // Diagnostic-only POC. Production keeps the historical pending-only
    // navigation Plan behavior until whole-game paired evidence accepts this.
    this.diagnosticPersistentNavigationPlans =
      options.diagnosticPersistentNavigationPlans ? 1 : 0;
    this.diagnosticNavigationContinuitySelection =
      options.diagnosticNavigationContinuitySelection === false ? 0 : 1;
    // A/B-only switches. They default off and never alter production behavior.
    // Together they reproduce the pre-Step-5 Information routing without
    // replacing the current Hard/Risk/EO implementation.
    this.diagnosticLegacyInformationSearch = options.diagnosticLegacyInformationSearch ? 1 : 0;
    this.diagnosticInformationDepthOne = options.diagnosticInformationDepthOne ? 1 : 0;
    // Incomplete Information values have no production action owner. Avoid
    // spending match budget on them unless a diagnostic installs a consumer.
    this.diagnosticInformationEvidenceSearch =
      options.diagnosticInformationEvidenceSearch ? 1 : 0;
    // Diagnostic-only support restoration.  The observation adapter must
    // conservatively report an absent singular enemy bullet as incomplete,
    // but a complete PossibleProjectileTracker can subsequently refute that
    // sole gap.  In that one case the current physical state is complete for
    // value search; future enemy FIRE remains an ordinary searched action.
    this.diagnosticRefutedPossiblePhysicalSearch =
      options.diagnosticRefutedPossiblePhysicalSearch ? 1 : 0;
    this.diagnosticRefutedPossiblePhysicalCombatOnly =
      options.diagnosticRefutedPossiblePhysicalCombatOnly ? 1 : 0;
    this.diagnosticRefutedPossiblePhysicalVerifierOnly =
      options.diagnosticRefutedPossiblePhysicalVerifierOnly ? 1 : 0;
    this.refutedPossiblePhysicalEligibleCount = 0;
    this.refutedPossiblePhysicalSearchCount = 0;
    this.refutedPossiblePhysicalCompletedCount = 0;
    this.refutedPossiblePhysicalCombatBlockedCount = 0;
    this.refutedPossiblePhysicalVerifierCheckCount = 0;
    this.refutedPossiblePhysicalVerifierProposalCount = 0;
    this.refutedPossiblePhysicalVerifierOverrideCount = 0;
    this.refutedPossiblePhysicalVerifierIncompleteCount = 0;
    this.refutedPossiblePhysicalVerifierRiskBlockedCount = 0;
    // Nominal PhysicalState value under an InformationState root. Possible
    // projectiles/future FIRE remain in Safety and epsilon-contamination; this
    // value search cannot publish Hard or Proof.
    this.diagnosticVisibleNominalPhysicalSearch =
      options.diagnosticVisibleNominalPhysicalSearch ? 1 : 0;
    this.diagnosticNominalPhysicalCombatOnly =
      options.diagnosticNominalPhysicalCombatOnly ? 1 : 0;
    this.nominalPhysicalSearchCount = 0; this.nominalPhysicalCompletedCount = 0;
    this.nominalPhysicalScheduleBlockedCount = 0;
    this.diagnosticDisableShallowInfoAdjustment =
      options.diagnosticDisableShallowInfoAdjustment ? 1 : 0;
    this.diagnosticDisableShallowClearLineReversal =
      options.diagnosticDisableShallowClearLineReversal ? 1 : 0;
    this.diagnosticDisableShallowEscapeBonus =
      options.diagnosticDisableShallowEscapeBonus ? 1 : 0;
    this.diagnosticEnableLegacyShallowFacingPenalty =
      options.diagnosticEnableLegacyShallowFacingPenalty ? 1 : 0;
    this.informationSearch.diagnosticDisableShallowAdjustment =
      this.diagnosticDisableShallowInfoAdjustment;
    this.informationSearch.diagnosticDisableShallowClearLineReversal =
      this.diagnosticDisableShallowClearLineReversal;
    this.informationSearch.diagnosticDisableShallowEscapeBonus =
      this.diagnosticDisableShallowEscapeBonus;
    this.informationSearch.diagnosticEnableLegacyShallowFacingPenalty =
      this.diagnosticEnableLegacyShallowFacingPenalty;
    this.possibleProjectiles = new PossibleProjectileTracker();
    this.tactical = options.tactical || TACTICAL_CONFIG;
    this.strategicProfile = Number.isSafeInteger(options.strategicProfile) &&
      options.strategicProfile >= STRATEGIC_PROFILE.COMBAT_FIRST &&
      options.strategicProfile <= STRATEGIC_PROFILE.TERMINAL_AWARE ?
      options.strategicProfile : STRATEGIC_PROFILE.COMBAT_FIRST;
    this.planArbitrationEnabled = options.planArbitrationEnabled ? 1 : 0;
    this.ourActions = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.ourArguments = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.enemyActions = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.enemyArguments = new Uint16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.enemyActionFamilies = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.hardStatus = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.score = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.policyProbability = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.stageRowMap = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.orderedActions = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.orderedArguments = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.orderUsed = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.orderedIndexes = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.planSketchHandle = new Uint32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.hiddenReachMaskA = new Uint8Array(CAPACITY.MAX_CELLS);
    this.hiddenReachMaskB = new Uint8Array(CAPACITY.MAX_CELLS);
    this.hiddenWorldCell = new Uint16Array(SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE);
    this.hiddenWorldMass = new Uint16Array(SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE);
    this.hiddenWorldDirectionMask = new Uint8Array(SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE);
    this.projectedCell = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.projectedDirection = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.beliefCoverage = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.searchOptions = { nodeBudget: 0,
      proofBudget: 0, matrixIterations: 0, matrixBatch: 0, decisionDepth: 0, baseRisk: 0 };
    this.ourCount = 0; this.enemyCount = 0; this.lastAction = ACTION.NONE;
    this.lastSelectedIndex = -1;
    this.lastArgument = NONE_CELL; this.lastScore = SCORE_REJECTED; this.lastRootStatus = ROOT_STATUS.INVALID;
    this.lastSearchRoot = NONE_NODE; this.lastSearchStatus = 0; this.lastProofStatus = PROOF_STATUS.UNKNOWN;
    this.decisionCount = 0; this.fallbackCount = 0; this.invalidRootCount = 0;
    this.forcedWinCount = 0; this.hardRejectAvoided = 0; this.hotAllocationCount = 0;
    this.stageMatrixSolveCount = 0; this.noAcceptableActionCount = 0;
    this.strategyBandUseCount = 0; this.strategyBandFallbackCount = 0;
    this.riskDominatedSelectionCount = 0;
    this.strictCommittedRescueCount = 0;
    this.strictCommittedRescueFinalRejectCount = 0;
    this.strictProofRescueConflictCount = 0;
    this.lastSelectionWasStrictRescue = 0;
    this.lastSelectionWasPersistentEscape = 0;
    this.verifiedDirectKillCheckCount = 0;
    this.verifiedDirectKillCandidateCount = 0;
    this.verifiedDirectKillOverrideCount = 0;
    this.verifiedDirectKillFinalRejectCount = 0;
    this.verifiedDirectKillObservedCount = 0;
    this.verifiedDirectKillHardBlockedCount = 0;
    this.verifiedDirectKillRiskBlockedCount = 0;
    this.verifiedDirectKillClosureBlockedCount = 0;
    this.verifiedDirectKillPurposeBlockedCount = 0;
    this.verifiedDirectKillEscapeBlockedCount = 0;
    this.verifiedDirectKillExposureBlockedCount = 0;
    this.verifiedDirectKillRobustBlockedCount = 0;
    this.verifiedDirectKillSourceBlockedCount = 0;
    this.verifiedDirectKillAlreadySelectedCount = 0;
    this.verifiedDirectKillCausalCandidateCount = 0;
    this.verifiedDirectKillCausalOverrideCount = 0;
    this.residualAttackProofCheckCount = 0;
    this.residualAttackProofProvenCount = 0;
    this.residualAttackProofDisprovenCount = 0;
    this.residualAttackProofUnknownCount = 0;
    this.residualAttackProofIncompleteSupportProvenCount = 0;
    this.residualAttackProofNodeCount = 0;
    this.lastSelectionWasVerifiedDirectKill = 0;
    this.planCommitCount = 0; this.planActivateCount = 0; this.planCompleteCount = 0;
    this.planInvalidateCount = 0;
    this.navigationPlanCommitCount = 0; this.navigationPlanActivateCount = 0;
    this.navigationPlanReuseCount = 0; this.navigationPlanExpireCount = 0;
    this.hiddenWorldCount = 0; this.hiddenSupportComplete = 0;
    this.hiddenRiskSupportComplete = 0; this.hiddenPreparedCount = 0;
    this.lastObservedCell = NONE_CELL; this.lastObservedDirection = 0;
    this.turnStreak = 0; this.goStallStreak = 0;
    this.opponentObservationReady = 0; this.previousEnemyCell = NONE_CELL;
    this.previousOwnCell = NONE_CELL; this.previousEnemyDirection = 0;
    this.previousEnemyStars = 0; this.previousEnemyProjectileCount = 0;
    this.previousEnemyBombCount = 0; this.previousEnemySkillReady = 0;
    this.previousEnemyCanFire = 0; this.previousFrame = NONE_FRAME;
    this.observationSafetyAuditCount = 0; this.observationSafetyUnknownCount = 0;
    this.observationSafetyDeadCount = 0; this.observationSafetySafeCount = 0;
    this.observationSafetyPossibleAuditCount = 0;
    this.observationSafetyAudited = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.observationSafetyStatusByAction = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.observationSafetyNodesByAction = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.observationSafetyFatalFrameByAction = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.controlMode = new ControlModeRouter();
    this.lastControlMode = ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION;
    this.tacticalRootCount = 0; this.strategicRootCount = 0; this.escapeRootCount = 0;
  }
  pushOur(action, argument = NONE_CELL) {
    this.ourActions[this.ourCount] = action; this.ourArguments[this.ourCount] = argument;
    this.ourCount += 1;
  }
  pushEnemy(action, argument = NONE_CELL) {
    this.enemyActions[this.enemyCount] = action; this.enemyArguments[this.enemyCount] = argument;
    this.enemyCount += 1;
  }
  generateActions() {
    const adapter = this.adapter; const a = adapter.state.arrays; this.ourCount = 0; this.enemyCount = 0;
    this.ourArguments.fill(NONE_CELL); this.enemyArguments.fill(NONE_CELL);
    if (!adapter.ownCanAct) this.pushOur(ACTION.NONE);
    else {
      this.pushOur(ACTION.GO); this.pushOur(ACTION.TURN_LEFT); this.pushOur(ACTION.TURN_RIGHT);
      if (adapter.ownCanFire) this.pushOur(ACTION.FIRE);
      if (adapter.ownBombReady && !this.diagnosticDisableResourceActions)
        this.pushOur(ACTION.THROW_BOMB);
      if (adapter.ownSkillReady && a[ARRAY.TANK_SKILL][0] === SKILL.POISON &&
          !this.diagnosticDisableResourceActions)
        this.pushOur(ACTION.CAST_POISON);
      // No command is a legal root action. Keep it last and score it only as
      // an emergency hold so a valid root never falls through to an unchecked
      // geometric action when every active command is Hard-rejected.
      this.pushOur(ACTION.NONE);
    }
    this.pushEnemy(ACTION.NONE);
    if (adapter.enemyCanAct) {
      this.pushEnemy(ACTION.GO); this.pushEnemy(ACTION.TURN_LEFT); this.pushEnemy(ACTION.TURN_RIGHT);
      if (adapter.enemyCanFire) this.pushEnemy(ACTION.FIRE);
      if (adapter.enemyBombReady) this.pushEnemy(ACTION.THROW_BOMB);
      const boosted = a[ARRAY.TANK_BOOST_UNTIL][1] !== NONE_FRAME &&
        a[ARRAY.TANK_BOOST_UNTIL][1] > a[ARRAY.SCALAR][SCALAR.FRAME];
      if (boosted) for (let pre = 0; pre < 2; pre += 1) {
        const base = BOOST_COMPOUND_BASE + pre * BOOST_COMPOUND_STRIDE;
        this.pushEnemy(base); this.pushEnemy(base + 1); this.pushEnemy(base + 2);
        if (adapter.enemyCanFire) this.pushEnemy(base + 3);
        if (adapter.enemyBombReady) this.pushEnemy(base + 4);
      }
      const skill = a[ARRAY.TANK_SKILL][1];
      if (adapter.enemySkillReady && skill >= SKILL.SHIELD && skill <= SKILL.BOOST) {
        if (skill === SKILL.TELEPORT) this.pushEnemy(ACTION.CAST_TELEPORT, NONE_CELL);
        else this.pushEnemy(ACTION.CAST_SHIELD + skill - SKILL.SHIELD);
      }
    }
    // Action ownership is established at generation time. The selection
    // pipeline rebuilds these sketches after PathField preparation so
    // navigation progress can become more precise, but FIRE/BOMB must never
    // exist even briefly without their intent and dependency record.
    this.createPlanSketches();
  }
  createPlanSketches() {
    const sketches = this.policy.sketches; sketches.reset(); this.planSketchHandle.fill(NONE_HANDLE);
    const a = this.adapter.state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const enemy = a[ARRAY.TANK_CELL][1]; const globalMode = this.rootGlobalMode(); let output = 0;
    for (let index = 0; index < this.ourCount; index += 1) {
      const action = this.ourActions[index]; const argument = this.ourArguments[index];
      let handle = NONE_HANDLE;
      if (action === ACTION.FIRE || action === ACTION.THROW_BOMB) {
        const bomb = action === ACTION.THROW_BOMB; const visibleHit = this.adapter.enemyVisible &&
          (bomb ? this.adapter.hazard.bombHits(a[ARRAY.TANK_CELL][0], enemy) :
            this.clearLine(a[ARRAY.TANK_CELL][0], enemy));
        const purpose = visibleHit ? PLAN_PURPOSE.DIRECT_KILL :
          bomb ? PLAN_PURPOSE.ZONE_DENIAL : PLAN_PURPOSE.BELIEF_SWEEP;
        const deadline = frame + (bomb ? RULE.BOMB_FUSE : 16);
        const dependency = FEATURE_DEPENDENCY.STATE | FEATURE_DEPENDENCY.TERRAIN |
          FEATURE_DEPENDENCY.HAZARD | FEATURE_DEPENDENCY.BELIEF;
        const signature = mix(mix(frame, enemy), action * 257 + a[ARRAY.TANK_DIR][1]);
        handle = this.policy.createActionSketch(action, argument, purpose, deadline,
          dependency, signature, 0);
        // A resource action without its intent/dependency record does not enter
        // the production action set. Capacity failure is therefore fail-closed.
        if (handle === NONE_HANDLE) continue;
      } else if (action === ACTION.GO || action === ACTION.TURN_LEFT ||
          action === ACTION.TURN_RIGHT) {
        const packed = this.projected(action); const cell = (packed / 4) | 0;
        const direction = packed & 3; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
        const starProgress = star === NONE_CELL ? 0 :
          this.starDistance(a[ARRAY.TANK_CELL][0]) - this.starDistance(cell);
        const helpfulTurn = star !== NONE_CELL &&
          (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) &&
          this.starDirectionHelpful(cell, direction);
        const objectiveProgress = star !== NONE_CELL && (starProgress > 0 || helpfulTurn);
        const purpose = globalMode === GLOBAL_MODE.HARD_SURVIVAL ? PLAN_PURPOSE.PRESERVE :
          globalMode === GLOBAL_MODE.FORCED_LOSS_RECOVERY && objectiveProgress ?
            PLAN_PURPOSE.COMEBACK : objectiveProgress ?
              PLAN_PURPOSE.STAR_COLLECT : PLAN_PURPOSE.REPOSITION;
        const progress = Math.max(this.planProgress(action, cell, direction),
          starProgress > 0 ? Math.min(10000, starProgress * 2500) : helpfulTurn ? 3500 : 0);
        const deadline = frame + Math.min(16, star === NONE_CELL ? 6 :
          Math.max(2, this.starDistance(a[ARRAY.TANK_CELL][0]) + 1));
        const dependency = FEATURE_DEPENDENCY.STATE | FEATURE_DEPENDENCY.ACTION |
          FEATURE_DEPENDENCY.TERRAIN | FEATURE_DEPENDENCY.OBJECTIVE |
          FEATURE_DEPENDENCY.HAZARD | FEATURE_DEPENDENCY.PLAN;
        // Historical behavior encoded the first action and successor pose,
        // making the signature impossible to match on the next frame.  The
        // diagnostic POC instead identifies the objective itself; every legal
        // first action toward that objective shares one stable signature.
        const signature = this.diagnosticPersistentNavigationPlans ?
          mix(mix(purpose, star === NONE_CELL ? enemy : star),
            star === NONE_CELL ? 0x4e4156 : 0x53544152) :
          mix(mix(star === NONE_CELL ? enemy : star, action), cell * 4 + direction);
        handle = this.policy.createActionSketch(action, argument, purpose, deadline,
          dependency, signature, progress);
        if (handle === NONE_HANDLE) continue;
      } else if (action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST) {
        const purpose = action === ACTION.CAST_POISON ? PLAN_PURPOSE.CADENCE_DENY :
          PLAN_PURPOSE.REPOSITION;
        const dependency = FEATURE_DEPENDENCY.STATE | FEATURE_DEPENDENCY.ACTION |
          FEATURE_DEPENDENCY.SKILL | FEATURE_DEPENDENCY.HAZARD;
        handle = this.policy.createActionSketch(action, argument, purpose, frame + 4,
          dependency, mix(frame, action), action === ACTION.CAST_POISON ? 4000 : 2000);
        if (handle === NONE_HANDLE) continue;
      }
      if (output !== index) { this.ourActions[output] = action; this.ourArguments[output] = argument; }
      this.planSketchHandle[output] = handle; output += 1;
    }
    this.ourCount = output;
  }
  planKindAt(index) {
    const handle = this.planSketchHandle[index]; return handle === NONE_HANDLE ? PLAN_KIND.NONE :
      this.policy.sketches.kind[handle];
  }
  persistentNavigationContinuity(sketch) {
    if (!this.diagnosticPersistentNavigationPlans ||
        !this.diagnosticNavigationContinuitySelection || sketch === NONE_HANDLE) return 0;
    const sketches = this.policy.sketches;
    if (sketch >= sketches.used || sketches.kind[sketch] !== PLAN_KIND.NAVIGATION) return 0;
    const plans = this.policy.plans;
    for (let slot = 0; slot < plans.status.length; slot += 1)
      if (plans.status[slot] === PLAN_STATUS.ACTIVE &&
          plans.kind[slot] === PLAN_KIND.NAVIGATION &&
          plans.purpose[slot] === sketches.purpose[sketch] &&
          plans.targetSignature[slot] === sketches.targetSignature[sketch])
        return 9000;
    return 0;
  }
  reuseOrReplaceNavigationPlan(sketch, index, frame) {
    const plans = this.policy.plans; const sketches = this.policy.sketches;
    let reusable = -1;
    for (let slot = 0; slot < plans.status.length; slot += 1) {
      if ((plans.status[slot] !== PLAN_STATUS.ACTIVE &&
          plans.status[slot] !== PLAN_STATUS.PENDING_EXECUTION) ||
          plans.kind[slot] !== PLAN_KIND.NAVIGATION) continue;
      if (plans.purpose[slot] === sketches.purpose[sketch] &&
          plans.targetSignature[slot] === sketches.targetSignature[sketch]) {
        reusable = slot; continue;
      }
      plans.invalidate(plans.encode(slot), PLAN_REASON.TARGET_GONE);
      this.planInvalidateCount += 1;
    }
    if (reusable < 0) return NONE_HANDLE;
    const handle = plans.encode(reusable);
    plans.status[reusable] = PLAN_STATUS.ACTIVE;
    plans.action[reusable] = sketches.action[sketch];
    plans.argument[reusable] = sketches.argument[sketch];
    plans.deadline[reusable] = sketches.deadline[sketch];
    plans.cachedScore[reusable] = Math.max(-9000, Math.min(9000, this.score[index]));
    plans.lastValidatedFrame[reusable] = frame;
    this.navigationPlanReuseCount += 1;
    return handle;
  }
  commitSelectedPlan(index) {
    if (index < 0 || index >= this.ourCount) return NONE_HANDLE;
    const sketch = this.planSketchHandle[index]; if (sketch === NONE_HANDLE) return NONE_HANDLE;
    const frame = this.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const navigation = this.policy.sketches.kind[sketch] === PLAN_KIND.NAVIGATION;
    if (navigation && this.diagnosticPersistentNavigationPlans) {
      const reused = this.reuseOrReplaceNavigationPlan(sketch, index, frame);
      if (reused !== NONE_HANDLE) return reused;
    }
    const handle = this.policy.plans.materialize(this.policy.sketches, sketch, true,
      this.policy.evalProfileId, frame, frame + 2);
    if (handle !== NONE_HANDLE) {
      const slot = this.policy.plans.decode(handle);
      this.policy.plans.cachedScore[slot] = Math.max(-9000, Math.min(9000, this.score[index]));
      if (navigation && this.diagnosticPersistentNavigationPlans) {
        if (this.policy.plans.activate(handle, frame)) {
          this.planActivateCount += 1; this.navigationPlanActivateCount += 1;
        }
        this.navigationPlanCommitCount += 1;
      } else if (this.policy.plans.aimSetup[slot] && this.policy.plans.activate(handle, frame))
        this.planActivateCount += 1;
      this.planCommitCount += 1;
    }
    return handle;
  }
  bindPendingPlan(handle, slot, frame) {
    const plans = this.policy.plans; const tracker = this.adapter.tracker;
    let bound = 0;
    if (plans.kind[slot] === PLAN_KIND.SHOT) {
      for (let entity = 0; entity < tracker.projectileActive.length; entity += 1)
        if (tracker.projectileActive[entity] && tracker.projectileOwner[entity] === 0 &&
            tracker.projectileCreated[entity] >= plans.selectedFrame[slot]) {
          if (!plans.bindEntity(handle, entity, tracker.projectileGeneration[entity])) break;
          bound += 1;
        }
    } else if (plans.kind[slot] === PLAN_KIND.BOMB) {
      for (let entity = 0; entity < tracker.bombActive.length; entity += 1)
        if (tracker.bombActive[entity] && tracker.bombOwner[entity] === 0 &&
            tracker.bombPlaced[entity] >= plans.selectedFrame[slot]) {
          if (plans.bindEntity(handle, entity, tracker.bombGeneration[entity])) bound = 1;
          break;
        }
    }
    if (bound && plans.activate(handle, frame)) { this.planActivateCount += 1; return 1; }
    return 0;
  }
  reconcilePlans() {
    const plans = this.policy.plans; const tracker = this.adapter.tracker;
    const frame = this.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    for (let slot = 0; slot < plans.status.length; slot += 1) {
      const handle = plans.encode(slot);
      if (plans.status[slot] === PLAN_STATUS.PENDING_EXECUTION) {
        if (frame > plans.selectedFrame[slot] && this.bindPendingPlan(handle, slot, frame)) continue;
        if (frame > plans.executionDeadline[slot]) {
          plans.complete(handle, PLAN_REASON.EXECUTION_FAILED, true); this.planCompleteCount += 1;
        }
        continue;
      }
      if (plans.status[slot] !== PLAN_STATUS.ACTIVE) continue;
      if (plans.kind[slot] === PLAN_KIND.NAVIGATION &&
          this.diagnosticPersistentNavigationPlans) {
        if (frame > plans.deadline[slot]) {
          plans.complete(handle, PLAN_REASON.DEADLINE_EXPIRED);
          this.planCompleteCount += 1; this.navigationPlanExpireCount += 1;
        }
        continue;
      }
      if (plans.kind[slot] === PLAN_KIND.SHOT && plans.aimSetup[slot] &&
          plans.entityCount[slot] === 0) {
        if (frame > plans.deadline[slot]) { plans.complete(handle, PLAN_REASON.DEADLINE_EXPIRED);
          this.planCompleteCount += 1; }
        continue;
      }
      const base = slot * plans.entityStride;
      let active = 0; let mismatch = 0;
      for (let member = 0; member < plans.entityCount[slot]; member += 1) {
        const at = base + member; const entity = plans.entitySlot[at];
        if (plans.kind[slot] === PLAN_KIND.SHOT) {
          if (tracker.projectileGeneration[entity] !== plans.entityGeneration[at]) mismatch = 1;
          else if (tracker.projectileActive[entity]) active += 1;
        } else if (plans.kind[slot] === PLAN_KIND.BOMB) {
          if (tracker.bombGeneration[entity] !== plans.entityGeneration[at]) mismatch = 1;
          else if (tracker.bombActive[entity]) active += 1;
        }
      }
      if (mismatch) { plans.invalidate(handle, PLAN_REASON.ENTITY_MISMATCH);
        this.planInvalidateCount += 1; }
      else if (!active) { plans.complete(handle, PLAN_REASON.ENTITY_COMPLETE);
        this.planCompleteCount += 1; }
    }
  }
  validatePlanContinuations(bundle, index) {
    if (index < 0) return;
    const plans = this.policy.plans; const action = this.ourActions[index];
    const argument = this.ourArguments[index];
    for (let slot = 0; slot < plans.status.length; slot += 1)
      if (plans.status[slot] === PLAN_STATUS.ACTIVE)
        plans.validateContinuation(plans.encode(slot), bundle, action, argument);
  }
  manhattan(left, right) {
    const state = this.adapter.state; return Math.abs(state.x(left) - state.x(right)) +
      Math.abs(state.y(left) - state.y(right));
  }
  prepareNavigation() {
    if (!this.tactical.PATH_CONTROL) return 0;
    const a = this.adapter.state.arrays; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star === NONE_CELL) { this.path.invalidate(); return 0; }
    const enabled = this.cacheBank.get(CACHE_ID.PATH_CACHE).enabled;
    const prepared = this.path.prepare(this.adapter.state, star, enabled);
    if (prepared > 1) this.runtime.charge(WORK_KIND.FEATURE_PLAN, prepared - 1);
    return prepared ? 1 : 0;
  }
  starDistance(cell) {
    const a = this.adapter.state.arrays; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star === NONE_CELL) return 0;
    if (this.tactical.PATH_CONTROL && this.path.complete && this.path.goal === star) {
      const value = this.path.read(cell); return value === PATH_UNREACHABLE ?
        this.adapter.state.cells : value;
    }
    return this.manhattan(cell, star);
  }
  starDirectionHelpful(cell, direction) {
    if (!this.tactical.PATH_CONTROL || !this.path.complete) return 0;
    return this.path.helpfulDirection(this.adapter.state, cell, direction,
      this.adapter.state.arrays[ARRAY.TANK_CELL][1]);
  }
  target(cell, direction) {
    const state = this.adapter.state; const x = state.x(cell) + DX[direction];
    const y = state.y(cell) + DY[direction]; return x < 0 || x >= state.width ||
      y < 0 || y >= state.height ? NONE_CELL : state.cell(x, y);
  }
  walk(cell, direction, speed, blocked) {
    const terrain = this.adapter.state.arrays[ARRAY.TERRAIN]; let current = cell;
    for (let step = 0; step < speed; step += 1) { const next = this.target(current, direction);
      if (next === NONE_CELL || next === blocked || terrain[next] === TERRAIN.WALL ||
          terrain[next] === TERRAIN.DIRT) break; current = next; }
    return current;
  }
  clearLine(from, to) {
    const state = this.adapter.state; const fromX = state.x(from); const fromY = state.y(from);
    const toX = state.x(to); const toY = state.y(to); if (fromX !== toX && fromY !== toY) return 0;
    const dx = toX === fromX ? 0 : toX > fromX ? 1 : -1;
    const dy = toY === fromY ? 0 : toY > fromY ? 1 : -1; const terrain = state.arrays[ARRAY.TERRAIN];
    let x = fromX + dx; let y = fromY + dy;
    while (x !== toX || y !== toY) { const tile = terrain[state.cell(x, y)];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0; x += dx; y += dy; }
    return 1;
  }
  directionTo(from, to) {
    const state = this.adapter.state; const fromX = state.x(from); const fromY = state.y(from);
    const toX = state.x(to); const toY = state.y(to);
    if (fromX === toX) return toY < fromY ? 0 : toY > fromY ? 2 : -1;
    if (fromY === toY) return toX > fromX ? 1 : toX < fromX ? 3 : -1; return -1;
  }
  projected(action) {
    const a = this.adapter.state.arrays; let cell = a[ARRAY.TANK_CELL][0];
    let direction = a[ARRAY.TANK_DIR][0];
    if (action === ACTION.TURN_LEFT) direction = (direction + 3) & 3;
    else if (action === ACTION.TURN_RIGHT) direction = (direction + 1) & 3;
    else if (action === ACTION.GO) { const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
      const boosted = a[ARRAY.TANK_BOOST_UNTIL][0] !== NONE_FRAME &&
        a[ARRAY.TANK_BOOST_UNTIL][0] > frame; cell = this.walk(cell, direction, boosted ? 2 : 1,
        a[ARRAY.TANK_CELL][1]); }
    return cell * 4 + direction;
  }
  possibleShotRisk(cell, direction = this.adapter.state.arrays[ARRAY.TANK_DIR][0]) {
    const adapter = this.adapter; const state = adapter.state;
    let risk = this.possibleProjectiles.risk(state, cell, direction);
    if (!adapter.enemyVisible || !adapter.enemyCanFire) return risk;
    const a = adapter.state.arrays; const enemyCell = a[ARRAY.TANK_CELL][1];
    const wanted = this.directionTo(enemyCell, cell);
    if (wanted < 0 || !this.clearLine(enemyCell, cell)) return risk;
    const enemyDirection = a[ARRAY.TANK_DIR][1]; const distance = this.manhattan(enemyCell, cell);
    if (wanted === enemyDirection) risk = Math.max(risk,
      this.possibleProjectiles.trajectoryRisk(state, enemyCell, enemyDirection, cell, direction));
    if (((wanted - enemyDirection) & 3) === 1 || ((enemyDirection - wanted) & 3) === 1)
      risk = Math.max(risk, Math.max(1000, 5000 - distance * 250));
    if (!this.tactical.MODEL_VERSION || !risk) return risk;
    const context = this.opponentContext();
    const probability = this.policy.opponent.propensity(OPPONENT_EVENT.FIRE, context);
    const confidence = this.policy.opponent.riskConfidence;
    const adjustment = Math.floor((probability - 5000) * confidence / 50000);
    return Math.max(0, Math.min(10000, Math.floor(risk * (10000 + adjustment) / 10000)));
  }
  possibleBombRisk(cell) {
    const tracker = this.adapter.tracker; const frame = this.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    let risk = 0;
    for (let slot = 0; slot < tracker.bombActive.length; slot += 1)
      if (tracker.bombActive[slot] && !tracker.bombExact[slot] &&
          this.adapter.hazard.bombHits(tracker.bombCell[slot], cell))
        risk = tracker.bombEarliest[slot] <= frame + 1 ? 9000 : Math.max(risk, 5000);
    return risk;
  }
  markHiddenMuzzle(source, belief) {
    const field = this.policy.hidden; const terrain = this.adapter.state.arrays[ARRAY.TERRAIN];
    for (let direction = 0; direction < 4; direction += 1) {
      let cell = source;
      for (let distance = 1; distance < Math.max(this.adapter.state.width,
          this.adapter.state.height); distance += 1) {
        cell = this.target(cell, direction); if (cell === NONE_CELL) break;
        const tile = terrain[cell]; if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) break;
        const exposure = Math.max(1500, 10000 - distance * 650);
        field.mark(cell, POSSIBLE_HAZARD.SHOT, Math.max(exposure, Math.floor(belief / 2)));
      }
    }
  }
  markPossibleBombCross(center, value) {
    const field = this.policy.hidden; const terrain = this.adapter.state.arrays[ARRAY.TERRAIN];
    field.mark(center, POSSIBLE_HAZARD.BOMB, value);
    for (let direction = 0; direction < 4; direction += 1) {
      let cell = center;
      for (let distance = 1; distance <= RULE.BOMB_RANGE; distance += 1) {
        cell = this.target(cell, direction); if (cell === NONE_CELL) break;
        const tile = terrain[cell]; if (tile === TERRAIN.WALL) break;
        field.mark(cell, POSSIBLE_HAZARD.BOMB, value);
        if (tile === TERRAIN.DIRT) break;
      }
    }
  }
  markPossibleProjectileFields() {
    const tracker = this.possibleProjectiles; const field = this.policy.hidden;
    const state = this.adapter.state; const terrain = state.arrays[ARRAY.TERRAIN];
    for (let slot = 0; slot < tracker.active.length; slot += 1) if (tracker.active[slot]) {
      let cell = tracker.cell[slot]; const direction = tracker.direction[slot];
      for (let distance = 1; distance <= state.cells; distance += 1) {
        cell = this.target(cell, direction); if (cell === NONE_CELL) break;
        const tile = terrain[cell]; if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) break;
        const arrival = Math.max(1, Math.floor((distance + RULE.PROJECTILE_STEPS - 1) /
          RULE.PROJECTILE_STEPS));
        field.mark(cell, POSSIBLE_HAZARD.SHOT, Math.max(2500, 10000 - arrival * 600));
      }
    }
  }
  addHiddenWorld(cell, distance, maxSteps, cloaked, directionMask = 0x0f) {
    const state = this.adapter.state; const field = this.policy.hidden;
    const tile = state.arrays[ARRAY.TERRAIN][cell];
    const belief = Math.max(1200, 10000 - Math.floor(distance * 7000 / Math.max(1, maxSteps + 1)));
    let flags = POSSIBLE_HAZARD.BELIEF_ROUTE;
    if (tile === TERRAIN.GRASS) flags |= POSSIBLE_HAZARD.GRASS;
    if (cloaked) flags |= POSSIBLE_HAZARD.CLOAK_PROXIMITY;
    field.mark(cell, flags, belief); field.markInformationGain(cell, belief);
    this.markHiddenMuzzle(cell, belief);
    if (this.adapter.enemyBombReady) this.markPossibleBombCross(cell, 2500);
    if (this.hiddenWorldCount < this.hiddenWorldCell.length) {
      this.hiddenWorldCell[this.hiddenWorldCount] = cell;
      this.hiddenWorldDirectionMask[this.hiddenWorldCount] = directionMask;
      this.hiddenWorldCount += 1;
    } else {
      this.hiddenSupportComplete = 0; this.hiddenRiskSupportComplete = 0;
    }
  }
  buildHiddenReachability(frame, maximumSpeed) {
    const state = this.adapter.state;
    let current = this.hiddenReachMaskA; let next = this.hiddenReachMaskB;
    current.fill(0, 0, state.cells); next.fill(0, 0, state.cells);
    const seed = this.adapter.lastEnemyCell; const seedDirection = this.adapter.lastEnemyDirection;
    if (seed === NONE_CELL || seedDirection < 0 || seedDirection > 3) return null;
    current[seed] = 1 << seedDirection;
    const frames = Math.max(1, frame - this.adapter.lastEnemySeenFrame);
    for (let elapsed = 0; elapsed < frames; elapsed += 1) {
      next.fill(0, 0, state.cells);
      for (let cell = 0; cell < state.cells; cell += 1) {
        const mask = current[cell]; if (!mask) continue;
        for (let direction = 0; direction < 4; direction += 1) {
          const bit = 1 << direction; if (!(mask & bit)) continue;
          next[cell] |= bit | (1 << ((direction + 3) & 3)) |
            (1 << ((direction + 1) & 3));
          const forwardOne = this.walk(cell, direction, 1, NONE_CELL);
          const backwardOne = this.walk(cell, (direction + 2) & 3, 1, NONE_CELL);
          next[forwardOne] |= bit; next[backwardOne] |= bit;
          if (maximumSpeed > 1) {
            next[this.walk(cell, direction, maximumSpeed, NONE_CELL)] |= bit;
            next[this.walk(cell, (direction + 2) & 3, maximumSpeed, NONE_CELL)] |= bit;
          }
        }
      }
      const swap = current; current = next; next = swap;
    }
    return current;
  }
  prepareHiddenRisk() {
    const state = this.adapter.state; const a = state.arrays; const field = this.policy.hidden;
    field.cellCount = state.cells; field.clear(); this.hiddenWorldCount = 0;
    this.hiddenProjectileRisk.reset();
    this.hiddenSupportComplete = this.adapter.enemyVisible ? 1 : 0;
    this.hiddenRiskSupportComplete = 1;
    this.markPossibleProjectileFields();
    const tracker = this.adapter.tracker; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    for (let slot = 0; slot < tracker.bombActive.length; slot += 1)
      if (tracker.bombActive[slot] && !tracker.bombExact[slot])
        this.markPossibleBombCross(tracker.bombCell[slot],
          tracker.bombEarliest[slot] <= frame + 1 ? 9000 : 5000);
    if (this.adapter.enemyVisible) {
      this.hiddenWorldCell[0] = a[ARRAY.TANK_CELL][1]; this.hiddenWorldMass[0] = 10000;
      this.hiddenWorldDirectionMask[0] = 1 << a[ARRAY.TANK_DIR][1];
      this.hiddenWorldCount = 1; this.hiddenPreparedCount += 1; return 1;
    }
    const lastSeen = this.adapter.lastEnemySeenFrame;
    const boosted = a[ARRAY.TANK_BOOST_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_BOOST_UNTIL][1] > frame;
    const movementSkill = a[ARRAY.TANK_SKILL][1];
    const maximumSpeed = boosted || movementSkill === SKILL.BOOST ? 2 : 1;
    const maxSteps = lastSeen === NONE_FRAME ? state.cells : Math.min(state.cells,
      Math.max(1, frame - lastSeen) * maximumSpeed);
    const cloaked = a[ARRAY.TANK_CLOAK_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_CLOAK_UNTIL][1] > frame;
    if (lastSeen === NONE_FRAME || movementSkill === SKILL.TELEPORT) {
      for (let cell = 0; cell < state.cells; cell += 1)
        if (a[ARRAY.TERRAIN][cell] !== TERRAIN.WALL && a[ARRAY.TERRAIN][cell] !== TERRAIN.DIRT &&
            cell !== a[ARRAY.TANK_CELL][0]) this.addHiddenWorld(cell, maxSteps, maxSteps, cloaked);
    } else {
      const elapsed = Math.max(1, frame - this.adapter.lastEnemySeenFrame);
      const fireProbability = this.policy.opponent.propensity(OPPONENT_EVENT.FIRE,
        this.opponentContext());
      const riskComplete = this.hiddenProjectileRisk.build(state, this.adapter.lastEnemyCell,
        this.adapter.lastEnemyDirection, elapsed, maximumSpeed, fireProbability,
        a[ARRAY.TANK_CELL][0]);
      const reach = riskComplete ? this.hiddenProjectileRisk.reachMask :
        this.buildHiddenReachability(frame, maximumSpeed);
      if (!riskComplete) this.hiddenRiskSupportComplete = 0;
      if (!reach) this.hiddenRiskSupportComplete = 0;
      else for (let cell = 0; cell < state.cells; cell += 1) if (reach[cell] &&
          cell !== a[ARRAY.TANK_CELL][0])
        this.addHiddenWorld(cell, this.manhattan(this.adapter.lastEnemyCell, cell),
          maxSteps, cloaked, reach[cell]);
    }
    if (this.hiddenWorldCount === 0) this.hiddenRiskSupportComplete = 0;
    const probability = this.hiddenWorldCount ? Math.floor(10000 / this.hiddenWorldCount) : 0;
    let remainder = 10000 - probability * this.hiddenWorldCount;
    for (let index = 0; index < this.hiddenWorldCount; index += 1) {
      this.hiddenWorldMass[index] = probability + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
    }
    this.hiddenPreparedCount += 1; return this.hiddenWorldCount;
  }
  possibleRisk(cell, direction = this.adapter.state.arrays[ARRAY.TANK_DIR][0]) {
    return Math.max(this.possibleShotRisk(cell, direction), this.possibleBombRisk(cell),
      this.policy.hidden.exposure(cell));
  }
  fallbackPoseRisk(cell, direction = this.adapter.state.arrays[ARRAY.TANK_DIR][0]) {
    const base = this.possibleRisk(cell, direction);
    let contact = 0;
    // possibleShotRisk deliberately saturates direct firing lines.  Preserve
    // that risk as the primary key, then retain a tiny distance class so the
    // no-acceptable fallback can distinguish stepping toward the muzzle from
    // holding/turning at the same saturated risk.  Five classes keep the
    // packed value within Uint16: 10000 * 5 + 4 = 50004.
    if (this.adapter.enemyVisible && this.adapter.enemyCanFire) {
      const enemy = this.adapter.state.arrays[ARRAY.TANK_CELL][1];
      if (this.clearLine(enemy, cell)) {
        const distance = this.manhattan(enemy, cell);
        contact = distance <= 1 ? 4 : distance === 2 ? 3 : distance === 3 ? 2 :
          distance <= 5 ? 1 : 0;
      }
    }
    return base * 5 + contact;
  }
  tacticalContact() {
    const a = this.adapter.state.arrays; const own = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1];
    if (!this.adapter.enemyVisible) return 0;
    return this.manhattan(own, enemy) <= 9 || this.clearLine(own, enemy) ? 1 : 0;
  }

  classifyControlMode(selectionCount) {
    const a = this.adapter.state.arrays; const own = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1];
    const visible = this.adapter.enemyVisible ? 1 : 0;
    const distance = visible ? this.manhattan(own, enemy) : 0xffff;
    const ray = visible ? this.clearLine(own, enemy) : 0;
    let trigger = 0;
    if (visible && this.expandedTacticalContactMask) {
      const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
      if (a[ARRAY.TANK_STUN_UNTIL][1] !== NONE_FRAME &&
          a[ARRAY.TANK_STUN_UNTIL][1] > frame) trigger |= TACTICAL_TRIGGER.ENEMY_DISABLED;
      const tracker = this.adapter.tracker;
      for (let slot = 0; slot < tracker.bombActive.length; slot += 1)
        if (tracker.bombActive[slot] && tracker.bombExact[slot]) {
          trigger |= TACTICAL_TRIGGER.COMMITTED_BOMB; break;
        }
      const vector = this.combat.vector;
      for (let row = 0; row < selectionCount; row += 1)
        if (vector.possibleHit[row] && vector.purposeCompleteness[row] >= 4500 &&
            vector.postFireEscape[row]) {
          trigger |= TACTICAL_TRIGGER.PREDICTIVE_ATTACK; break;
        }
      trigger &= this.expandedTacticalContactMask;
    }
    const mode = this.controlMode.classify(this.escapeObligation, selectionCount,
      visible, distance, ray, this.runtime.runtimeMode, trigger,
      this.diagnosticContactSearchWithinEscape);
    if (this.diagnosticContactSearchWithinEscape &&
        this.escapeObligation.committedEntityCount > 0 &&
        this.escapeObligation.supportStatus === SUPPORT_STATUS.COMPLETE &&
        this.escapeObligation.firstActionCount > 0 &&
        this.escapeObligation.firstActionCount < selectionCount &&
        mode === ROOT_CONTROL_MODE.TACTICAL_CONTACT)
      this.contactSearchWithinEscapeRootCount += 1;
    if (mode === ROOT_CONTROL_MODE.TACTICAL_CONTACT && !ray && distance > 9) {
      if (trigger & TACTICAL_TRIGGER.ENEMY_DISABLED) this.expandedContactDisabledCount += 1;
      if (trigger & TACTICAL_TRIGGER.COMMITTED_BOMB) this.expandedContactBombCount += 1;
      if (trigger & TACTICAL_TRIGGER.PREDICTIVE_ATTACK) this.expandedContactPredictiveCount += 1;
    }
    this.lastControlMode = mode;
    if (mode === ROOT_CONTROL_MODE.COMMITTED_ESCAPE) this.escapeRootCount += 1;
    else if (mode === ROOT_CONTROL_MODE.TACTICAL_CONTACT) this.tacticalRootCount += 1;
    else this.strategicRootCount += 1;
    return mode;
  }
  beliefSweepCoverage(action, cell, direction) {
    if (this.adapter.enemyVisible) return 0;
    const field = this.policy.hidden; let coverage = 0;
    if (action === ACTION.FIRE) {
      let ray = cell;
      for (let step = 0; step < this.adapter.state.cells; step += 1) {
        ray = this.target(ray, direction); if (ray === NONE_CELL) break;
        const tile = this.adapter.state.arrays[ARRAY.TERRAIN][ray];
        if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) break;
        coverage += field.beliefMass[ray];
      }
    } else if (action === ACTION.THROW_BOMB) {
      for (let target = 0; target < this.adapter.state.cells; target += 1)
        if (this.adapter.hazard.bombHits(cell, target)) coverage += field.beliefMass[target];
    } else coverage = field.informationGain[cell];
    return Math.min(10000, coverage);
  }
  countMobility(cell) {
    const a = this.adapter.state.arrays; let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const next = this.target(cell, direction); if (next !== NONE_CELL && next !== a[ARRAY.TANK_CELL][1] &&
          a[ARRAY.TERRAIN][next] !== TERRAIN.WALL && a[ARRAY.TERRAIN][next] !== TERRAIN.DIRT) count += 1;
    }
    return count;
  }
  opponentContext() {
    if (!this.adapter.enemyVisible) return OPPONENT_CONTEXT.HIDDEN;
    const frame = this.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (RULE.FRAME_RECORD_LIMIT - 1 - frame <= 16) return OPPONENT_CONTEXT.TERMINAL;
    return this.countMobility(this.adapter.state.arrays[ARRAY.TANK_CELL][1]) <= 1 ?
      OPPONENT_CONTEXT.PRESSURED : OPPONENT_CONTEXT.OPEN;
  }
  enemyProjectileCount() {
    const tracker = this.adapter.tracker; let count = 0;
    for (let slot = 0; slot < tracker.projectileActive.length; slot += 1)
      if (tracker.projectileActive[slot] && tracker.projectileOwner[slot] === 1) count += 1;
    return count;
  }
  enemyBombCount() {
    const tracker = this.adapter.tracker; let count = 0;
    for (let slot = 0; slot < tracker.bombActive.length; slot += 1)
      if (tracker.bombActive[slot] && tracker.bombOwner[slot] === 1) count += 1;
    return count;
  }
  snapshotOpponentObservation() {
    const a = this.adapter.state.arrays; this.previousOwnCell = a[ARRAY.TANK_CELL][0];
    this.previousEnemyCell = a[ARRAY.TANK_CELL][1];
    this.previousEnemyDirection = a[ARRAY.TANK_DIR][1];
    this.previousEnemyStars = a[ARRAY.TANK_STARS][1];
    this.previousEnemyProjectileCount = this.enemyProjectileCount();
    this.previousEnemyBombCount = this.enemyBombCount();
    this.previousEnemySkillReady = a[ARRAY.TANK_SKILL_READY][1] <= a[ARRAY.SCALAR][SCALAR.FRAME] ? 1 : 0;
    this.previousEnemyCanFire = this.adapter.enemyCanFire ? 1 : 0;
    this.previousFrame = a[ARRAY.SCALAR][SCALAR.FRAME];
    this.opponentObservationReady = 1;
  }
  updateOpponentModel(reset) {
    const a = this.adapter.state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (reset || !this.opponentObservationReady) {
      this.possibleProjectiles.reset(frame); this.snapshotOpponentObservation(); return;
    }
    this.possibleProjectiles.advance(this.adapter.state, frame, a[ARRAY.TANK_CELL][0]);
    const context = this.opponentContext(); const projectileCount = this.enemyProjectileCount();
    const bombCount = this.enemyBombCount();
    const skillReady = a[ARRAY.TANK_SKILL_READY][1] <= frame ? 1 : 0;
    if (projectileCount > this.previousEnemyProjectileCount)
      this.policy.opponent.update(OPPONENT_EVENT.FIRE, context, OPPORTUNITY.CONFIRMED,
        CHOICE.CHOSEN, frame);
    const poseChanged = this.adapter.enemyVisible && (a[ARRAY.TANK_CELL][1] !== this.previousEnemyCell ||
      a[ARRAY.TANK_DIR][1] !== this.previousEnemyDirection);
    const exclusiveActionObserved = bombCount > this.previousEnemyBombCount ||
      (this.previousEnemySkillReady && !skillReady) || a[ARRAY.TANK_STARS][1] > this.previousEnemyStars;
    if (projectileCount === 0 && this.previousEnemyCanFire && !poseChanged && !exclusiveActionObserved &&
        this.previousEnemyCell !== NONE_CELL && this.previousFrame !== NONE_FRAME &&
        frame > this.previousFrame)
      // A shot that was off-axis when fired can become lethal after we enter
      // its ray.  Visibility and current aim may lower its fact grade/mass,
      // but may never erase the candidate physical lifecycle.
      this.possibleProjectiles.addFired(this.adapter.state, this.previousEnemyCell,
        this.previousEnemyDirection, this.previousFrame, frame, a[ARRAY.TANK_CELL][0],
        this.policy.opponent.propensity(OPPONENT_EVENT.FIRE, context));
    if (bombCount > this.previousEnemyBombCount)
      this.policy.opponent.update(OPPONENT_EVENT.BOMB, context, OPPORTUNITY.CONFIRMED,
        CHOICE.CHOSEN, frame);
    if (this.previousEnemySkillReady && !skillReady)
      this.policy.opponent.update(OPPONENT_EVENT.SKILL, context, OPPORTUNITY.CONFIRMED,
        CHOICE.CHOSEN, frame);
    if (a[ARRAY.TANK_STARS][1] > this.previousEnemyStars)
      this.policy.opponent.update(OPPONENT_EVENT.STAR, context, OPPORTUNITY.CONFIRMED,
        CHOICE.CHOSEN, frame);
    if (this.adapter.enemyVisible && this.previousEnemyCell !== NONE_CELL) {
      const previousDistance = this.manhattan(this.previousEnemyCell, this.previousOwnCell);
      const distance = this.manhattan(a[ARRAY.TANK_CELL][1], a[ARRAY.TANK_CELL][0]);
      if (distance < previousDistance)
        this.policy.opponent.update(OPPONENT_EVENT.ADVANCE, context, OPPORTUNITY.CONFIRMED,
          CHOICE.CHOSEN, frame);
      else if (distance > previousDistance)
        this.policy.opponent.update(OPPONENT_EVENT.RETREAT, context, OPPORTUNITY.CONFIRMED,
          CHOICE.CHOSEN, frame);
      if (a[ARRAY.TANK_DIR][1] !== this.previousEnemyDirection)
        this.policy.opponent.update(OPPONENT_EVENT.TURN_EXTRA, context, OPPORTUNITY.CONFIRMED,
          CHOICE.CHOSEN, frame);
    }
    this.snapshotOpponentObservation();
  }
  resetActionHistory() {
    const a = this.adapter.state.arrays; this.turnStreak = 0; this.goStallStreak = 0;
    this.lastObservedCell = a[ARRAY.TANK_CELL][0];
    this.lastObservedDirection = a[ARRAY.TANK_DIR][0]; this.lastAction = ACTION.NONE;
  }
  updateActionHistory() {
    const a = this.adapter.state.arrays; const cell = a[ARRAY.TANK_CELL][0];
    const direction = a[ARRAY.TANK_DIR][0];
    if ((this.lastAction === ACTION.TURN_LEFT || this.lastAction === ACTION.TURN_RIGHT) &&
        cell === this.lastObservedCell && direction !== this.lastObservedDirection)
      this.turnStreak += 1;
    else if (this.lastAction !== ACTION.NONE) this.turnStreak = 0;
    if (this.lastAction === ACTION.GO && cell === this.lastObservedCell) this.goStallStreak += 1;
    else if (this.lastAction !== ACTION.NONE) this.goStallStreak = 0;
    this.lastObservedCell = cell; this.lastObservedDirection = direction;
  }
  perpendicularEscapeCount(cell, direction) {
    const a = this.adapter.state.arrays; let count = 0;
    const left = (direction + 3) & 3; const right = (direction + 1) & 3;
    let next = this.target(cell, left);
    if (next !== NONE_CELL && next !== a[ARRAY.TANK_CELL][0] &&
        a[ARRAY.TERRAIN][next] !== TERRAIN.WALL && a[ARRAY.TERRAIN][next] !== TERRAIN.DIRT) count += 1;
    next = this.target(cell, right);
    if (next !== NONE_CELL && next !== a[ARRAY.TANK_CELL][0] &&
        a[ARRAY.TERRAIN][next] !== TERRAIN.WALL && a[ARRAY.TERRAIN][next] !== TERRAIN.DIRT) count += 1;
    return count;
  }
  directHitWindow(action, projectedCell, projectedDirection) {
    if (action !== ACTION.FIRE || !this.adapter.enemyVisible) return 0;
    const enemyCell = this.adapter.state.arrays[ARRAY.TANK_CELL][1];
    const wanted = this.directionTo(projectedCell, enemyCell);
    if (wanted !== projectedDirection || !this.clearLine(projectedCell, enemyCell)) return 0;
    const distance = this.manhattan(projectedCell, enemyCell);
    if (!this.tactical.MODEL_VERSION) return Math.max(1000, 10000 - distance * 500);
    const arrivalFrames = Math.floor((distance + RULE.PROJECTILE_STEPS - 1) / RULE.PROJECTILE_STEPS);
    const escapes = this.perpendicularEscapeCount(enemyCell, projectedDirection);
    if (arrivalFrames <= 1) return 10000;
    if (escapes === 0) return Math.max(2500, 9500 - distance * 550);
    return Math.max(500, 7500 - distance * 650 - escapes * 1100);
  }
  planProgress(action, cell, direction) {
    let progress = this.activePlanProgress(action, cell, direction);
    if (this.tactical.PATH_CONTROL) {
      const star = this.adapter.state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL];
      if (star !== NONE_CELL) {
        if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT)
          return Math.max(progress, this.starDirectionHelpful(cell, direction) ? 4000 : 0);
        if (action === ACTION.GO) return this.starDistance(cell) <
          this.starDistance(this.adapter.state.arrays[ARRAY.TANK_CELL][0]) ? Math.max(progress, 4000) : progress;
      }
    }
    if (!this.tactical.MODEL_VERSION) return Math.max(progress, action === this.lastAction ? 4000 : 1000);
    if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) {
      const a = this.adapter.state.arrays;
      const target = this.adapter.enemyVisible ? a[ARRAY.TANK_CELL][1] : NONE_CELL;
      return Math.max(progress, target !== NONE_CELL && this.directionTo(cell, target) === direction ? 3500 : 0);
    }
    if (action === ACTION.GO && this.turnStreak > 0) return Math.max(progress, 3500);
    return Math.max(progress, action === this.lastAction ? 3000 : 1000);
  }
  activePlanProgress(action, cell, direction) {
    const plans = this.policy.plans; const tracker = this.adapter.tracker; let progress = 0;
    for (let slot = 0; slot < plans.status.length; slot += 1) {
      if (plans.status[slot] !== PLAN_STATUS.ACTIVE) continue;
      const base = slot * plans.entityStride;
      if (plans.kind[slot] === PLAN_KIND.BOMB && plans.entityCount[slot] > 0) {
        const entity = plans.entitySlot[base];
        if (tracker.bombActive[entity] &&
            tracker.bombGeneration[entity] === plans.entityGeneration[base]) {
          const center = tracker.bombCell[entity];
          progress = Math.max(progress, this.adapter.hazard.bombHits(center, cell) ?
            Math.min(6000, this.manhattan(center, cell) * 2000) : 9000);
        }
      } else if (plans.kind[slot] === PLAN_KIND.SHOT) {
        const enemy = this.adapter.state.arrays[ARRAY.TANK_CELL][1];
        const wanted = this.adapter.enemyVisible ? this.directionTo(cell, enemy) : -1;
        const aligned = wanted === direction && this.clearLine(cell, enemy);
        if (plans.aimSetup[slot] && plans.entityCount[slot] === 0) {
          progress = Math.max(progress, aligned ? (action === ACTION.FIRE ? 10000 : 8000) : 1000);
          continue;
        }
        const enemyDirection = this.adapter.state.arrays[ARRAY.TANK_DIR][1];
        const counterLine = this.adapter.enemyVisible &&
          this.directionTo(enemy, cell) === enemyDirection && this.clearLine(enemy, cell);
        if (plans.ownCounterExposure[slot] > 0)
          progress = Math.max(progress, counterLine ? 1000 : 9000);
        else progress = Math.max(progress, aligned ? 6500 : 3000);
      }
    }
    return progress;
  }
  bombUtility(cell) {
    const t = this.tactical; const a = this.adapter.state.arrays;
    if (!t.MODEL_VERSION) {
      let score = this.manhattan(cell, a[ARRAY.TANK_CELL][1]) <= 4 ? t.BOMB_NEAR_SCORE : t.BOMB_FAR_SCORE;
      if (a[ARRAY.TERRAIN][cell] === TERRAIN.GRASS) score += t.BOMB_GRASS_SCORE; return score;
    }
    const enemy = a[ARRAY.TANK_CELL][1]; const enemyMobility = this.countMobility(enemy);
    const ownMobility = this.countMobility(cell); let score = -2800;
    if (this.adapter.enemyVisible && this.adapter.hazard.bombHits(cell, enemy))
      score += enemyMobility <= 1 ? 6500 : enemyMobility === 2 ? 2500 : 500;
    else if (!this.adapter.enemyVisible && this.adapter.hazard.bombHits(cell, enemy)) score += 1800;
    for (let direction = 0; direction < 4; direction += 1) {
      let ray = cell;
      for (let distance = 1; distance <= RULE.BOMB_RANGE; distance += 1) {
        ray = this.target(ray, direction); if (ray === NONE_CELL || a[ARRAY.TERRAIN][ray] === TERRAIN.WALL) break;
        if (a[ARRAY.TERRAIN][ray] === TERRAIN.DIRT) { score += 700; break; }
      }
    }
    if (ownMobility <= 1) score -= 4500;
    if (a[ARRAY.TERRAIN][cell] === TERRAIN.GRASS) score -= 1200;
    return score;
  }
  poisonUtility() {
    const t = this.tactical; const a = this.adapter.state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const active = a[ARRAY.TANK_POISON_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_POISON_UNTIL][1] > frame;
    if (!t.MODEL_VERSION) return this.adapter.enemyVisible && !active ?
      t.POISON_VISIBLE_SCORE : t.POISON_REJECT_SCORE;
    if (!this.adapter.enemyVisible || active) return -5000;
    const distance = this.manhattan(a[ARRAY.TANK_CELL][0], a[ARRAY.TANK_CELL][1]);
    const pressure = Math.max(0, 6500 - distance * 650 - this.countMobility(a[ARRAY.TANK_CELL][1]) * 350);
    return pressure >= 2500 ? pressure : -2200;
  }
  fillStrategyInputs(outcome = null, safeFloor = -10000) {
    const a = this.adapter.state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const starDelta = (a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1]) * 1000;
    const remaining = Math.max(0, RULE.FRAME_RECORD_LIMIT - 1 - frame);
    const urgency = 10000 - Math.min(10000, remaining * 80);
    const input = this.policy.strategyInput; input.reset();
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL]; let starRace = 0;
    if (this.tactical.PATH_CONTROL && star !== NONE_CELL) starRace = Math.max(0, Math.min(10000,
      5000 + (this.starDistance(a[ARRAY.TANK_CELL][1]) -
        this.starDistance(a[ARRAY.TANK_CELL][0])) * (this.tactical.PATH_RACE_SCALE || 700)));
    const combat = this.combat.vector; let killOpportunity = 0; let setupOpportunity = 0;
    let purposeCompleteness = 0; let planContinuity = 0; let killDeadline = 0xffff;
    let directWindow = 0; let hasStarAction = 0;
    for (let row = 0; row < combat.count; row += 1) {
      const qualified = !outcome || (row < outcome.count && outcome.acceptable[row] &&
        !outcome.dominated[row] && outcome.robustLower[row] >= safeFloor);
      if (!qualified) continue;
      if (combat.directKill[row] || combat.intercept[row] || combat.shieldBreak[row]) {
        killOpportunity = Math.max(killOpportunity, combat.purposeCompleteness[row],
          Math.max(0, combat.pressureValue[row]));
        purposeCompleteness = Math.max(purposeCompleteness,
          combat.purposeCompleteness[row]);
        if (combat.hitDeadline[row] < killDeadline) killDeadline = combat.hitDeadline[row];
      }
      if (combat.aimSetup[row] || combat.escapeDenial[row] || combat.zoneDenial[row])
        setupOpportunity = Math.max(setupOpportunity, combat.purposeCompleteness[row],
          Math.max(0, combat.pressureValue[row]));
      planContinuity = Math.max(planContinuity, this.strategyBands.planContinuity[row]);
      if (this.ourActions[row] === ACTION.FIRE)
        directWindow = Math.max(directWindow, this.directHitWindow(ACTION.FIRE,
          this.projectedCell[row], this.projectedDirection[row]));
      if (this.strategyBands.starPurpose[row]) hasStarAction = 1;
    }
    if (killDeadline === 0xffff) killDeadline = 0;
    const starDeadline = star === NONE_CELL || !hasStarAction ? 0 : Math.min(0x7fff,
      this.starDistance(a[ARRAY.TANK_CELL][0]) + 1);
    input.set(STRATEGY_INPUT.STAR_DELTA, starDelta); input.set(STRATEGY_INPUT.STAR_RACE, starRace);
    input.set(STRATEGY_INPUT.SAFE_SUCCESSORS,
      Math.min(10000, this.countMobility(a[ARRAY.TANK_CELL][0]) * 2500));
    input.set(STRATEGY_INPUT.DIRECT_HIT_WINDOW, directWindow);
    input.set(STRATEGY_INPUT.POSITION_CONTROL, setupOpportunity);
    input.set(STRATEGY_INPUT.TERMINAL_URGENCY, urgency);
    input.set(STRATEGY_INPUT.LEAD_SECURITY, starDelta > 0 ? Math.min(10000, starDelta) : 0);
    input.set(STRATEGY_INPUT.COMEBACK_PRESSURE, starDelta < 0 ? Math.min(10000, -starDelta + urgency) : 0);
    input.set(STRATEGY_INPUT.OPPONENT_ATTACK, this.possibleRisk(a[ARRAY.TANK_CELL][0]));
    input.set(STRATEGY_INPUT.OPPONENT_CONTEST, 5000);
    input.set(STRATEGY_INPUT.RESOURCE_READY, (this.adapter.ownCanFire +
      this.adapter.ownBombReady + this.adapter.ownSkillReady) * 3000);
    input.set(STRATEGY_INPUT.KILL_DEADLINE, killDeadline);
    input.set(STRATEGY_INPUT.STAR_DEADLINE, starDeadline);
    input.set(STRATEGY_INPUT.KILL_OPPORTUNITY, killOpportunity);
    input.set(STRATEGY_INPUT.SETUP_OPPORTUNITY, setupOpportunity);
    input.set(STRATEGY_INPUT.PURPOSE_COMPLETENESS, purposeCompleteness);
    input.set(STRATEGY_INPUT.PLAN_CONTINUITY, planContinuity);
    input.set(STRATEGY_INPUT.REVERSIBILITY,
      Math.min(10000, this.countMobility(a[ARRAY.TANK_CELL][0]) * 2500));
    input.set(STRATEGY_INPUT.INFORMATION_COMPLETENESS,
      this.adapter.informationComplete ? 10000 : 0);
    if (this.escapeObligation.supportStatus === SUPPORT_STATUS.COMPLETE)
      input.modifierMask |= STRATEGY_MODIFIER.EVADE_COMMITTED;
    if (!this.adapter.informationComplete)
      input.modifierMask |= STRATEGY_MODIFIER.INFORMATION;
    if (this.adapter.ownSkillReady)
      input.modifierMask |= STRATEGY_MODIFIER.SKILL_WINDOW;
    if (urgency >= STRATEGY_CONFIG.PHASE_DECISIVE_URGENCY)
      input.modifierMask |= STRATEGY_MODIFIER.TERMINAL_URGENCY;
    if (planContinuity > 0)
      input.modifierMask |= STRATEGY_MODIFIER.PLAN_CONTINUITY;
  }
  prepareStrategyEvidence(count) {
    const bands = this.strategyBands; const a = this.adapter.state.arrays;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL]; const original = a[ARRAY.TANK_CELL][0];
    const reversal = this.rootGlobalMode() === GLOBAL_MODE.FORCED_LOSS_RECOVERY;
    bands.reset(count);
    for (let row = 0; row < count; row += 1) {
      const action = this.ourActions[row]; const cell = this.projectedCell[row];
      const direction = this.projectedDirection[row];
      if (star !== NONE_CELL && (cell === star || (action === ACTION.GO &&
          this.starDistance(cell) < this.starDistance(original)) ||
          ((action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) &&
           this.starDirectionHelpful(cell, direction))))
        bands.starPurpose[row] = STRATEGY_PURPOSE.STAR_COLLECT |
          STRATEGY_PURPOSE.STAR_DENY;
      bands.planContinuity[row] = Math.max(0,
        Math.min(10000, Math.max(this.activePlanProgress(action, cell, direction),
          this.persistentNavigationContinuity(this.planSketchHandle[row]))));
      if (reversal && (bands.starPurpose[row] || this.combat.vector.directKill[row] ||
          this.combat.vector.aimSetup[row] || this.combat.vector.intercept[row]))
        bands.terminalReversal[row] = 1;
    }
    return bands;
  }
  rootGlobalMode() {
    const a = this.adapter.state.arrays;
    const remaining = Math.max(0, RULE.FRAME_RECORD_LIMIT - 1 -
      a[ARRAY.SCALAR][SCALAR.FRAME]);
    if (remaining > 16) return GLOBAL_MODE.NORMAL;
    // The production runtime relation assumes our platform total is worse
    // when stars are equal. Therefore equal/behind is a terminal forced-loss
    // recovery state, while a strict lead is a preserve state. This changes
    // only strategy/risk ownership; FinalActionGate remains authoritative.
    return a[ARRAY.TANK_STARS][0] <= a[ARRAY.TANK_STARS][1] ?
      GLOBAL_MODE.FORCED_LOSS_RECOVERY : GLOBAL_MODE.HARD_SURVIVAL;
  }
  fillFeatureInputs(action, cell, direction, direct, risk, mobility) {
    const a = this.adapter.state.arrays; const input = this.policy.featureInput; input.reset();
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL]; const original = a[ARRAY.TANK_CELL][0];
    const starGain = star === NONE_CELL ? 0 :
      (this.starDistance(original) - this.starDistance(cell)) * 2500;
    const starDelta = (a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1]) * 1000;
    const remaining = Math.max(0, RULE.FRAME_RECORD_LIMIT - 1 - a[ARRAY.SCALAR][SCALAR.FRAME]);
    input.set(FEATURE_INPUT.STAR_DELTA, starDelta); input.set(FEATURE_INPUT.STAR_RACE, starGain);
    input.set(FEATURE_INPUT.SAFE_SUCCESSORS, mobility * 2500);
    input.set(FEATURE_INPUT.DANGER_SLACK, 10000 - risk);
    input.set(FEATURE_INPUT.SHIELD_RESERVE, a[ARRAY.TANK_SHIELD_HITS][0] * 5000);
    input.set(FEATURE_INPUT.DIRECT_HIT_WINDOW, direct);
    input.set(FEATURE_INPUT.ENEMY_ESCAPE_OPTIONS, this.countMobility(a[ARRAY.TANK_CELL][1]) * 2500);
    input.set(FEATURE_INPUT.MOBILITY, mobility * 2500); input.set(FEATURE_INPUT.CHOKE_CONTROL, 0);
    input.set(FEATURE_INPUT.POSSIBLE_SHOT_EXPOSURE, risk);
    input.set(FEATURE_INPUT.BELIEF_SWEEP_COVERAGE,
      this.beliefSweepCoverage(action, cell, direction));
    input.set(FEATURE_INPUT.INFORMATION_CONTROL, this.adapter.enemyVisible ? 5000 :
      Math.max(0, this.policy.hidden.informationGain[cell] -
        Math.floor(this.policy.hidden.beliefMass[cell] / 2)));
    input.set(FEATURE_INPUT.RESOURCE_READY, (this.adapter.ownCanFire + this.adapter.ownBombReady +
      this.adapter.ownSkillReady) * 3000);
    input.set(FEATURE_INPUT.SKILL_WINDOW, action === ACTION.CAST_POISON ? 9000 : 0);
    input.set(FEATURE_INPUT.PLAN_PROGRESS, this.planProgress(action, cell, direction));
    input.set(FEATURE_INPUT.OPPONENT_ATTACK, risk); input.set(FEATURE_INPUT.OPPONENT_CONTEST, 5000);
    input.set(FEATURE_INPUT.COMPUTE_COST, this.runtime.runtimeMode * 2500);
    input.set(FEATURE_INPUT.TERMINAL_URGENCY, 10000 - Math.min(10000, remaining * 80));
    input.set(FEATURE_INPUT.LEAD_SECURITY, starDelta > 0 ? starDelta : 0);
    input.set(FEATURE_INPUT.COMEBACK_PRESSURE, starDelta < 0 ? -starDelta : 0);
  }
  actionScore(index) {
    const action = this.ourActions[index]; const hard = this.hardStatus[index];
    if (hard === HARD_STATUS.REJECT_PROVEN || hard === HARD_STATUS.REJECT_POLICY)
      return SCORE_REJECTED;
    if (action === ACTION.NONE) return SCORE_EMERGENCY_HOLD;
    const packed = this.projected(action); const cell = (packed / 4) | 0; const direction = packed & 3;
    const risk = this.possibleRisk(cell, direction); const direct = this.directHitWindow(action, cell, direction);
    const mobility = this.countMobility(cell); const a = this.adapter.state.arrays;
    this.fillFeatureInputs(action, cell, direction, direct, risk, mobility);
    let score = this.policy.scoreAction(this.policy.featureInput, action, this.planKindAt(index));
    const tactical = this.tactical;
    if (hard === HARD_STATUS.INCOMPLETE) score -= SCORE_INCOMPLETE_PENALTY;
    if (action === ACTION.CAST_POISON) score += this.poisonUtility();
    else if (action === ACTION.THROW_BOMB) score += this.bombUtility(cell);
    else if (action === ACTION.GO) {
      if (cell === a[ARRAY.TANK_CELL][0]) score -= 2500 + this.goStallStreak * 900;
      if (this.turnStreak > 0) score += tactical.GO_AFTER_TURN_SCORE;
      const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
      if (star !== NONE_CELL)
        score += (this.starDistance(a[ARRAY.TANK_CELL][0]) -
          this.starDistance(cell)) * (tactical.PATH_MOVE_SCORE || 1200);
    } else if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) {
      const target = this.adapter.enemyVisible ? a[ARRAY.TANK_CELL][1] : NONE_CELL;
      const aligned = tactical.PATH_CONTROL &&
        a[ARRAY.SCALAR][SCALAR.STAR_CELL] !== NONE_CELL ?
        this.starDirectionHelpful(cell, direction) :
        target !== NONE_CELL && this.directionTo(cell, target) === direction;
      if (aligned) score += tactical.TURN_ALIGN_SCORE;
      if (this.lastAction === ACTION.TURN_LEFT || this.lastAction === ACTION.TURN_RIGHT)
        score += tactical.TURN_REPEAT_SCORE;
      score -= this.turnStreak * tactical.TURN_STREAK_PENALTY;
      if ((action === ACTION.TURN_LEFT && this.lastAction === ACTION.TURN_RIGHT) ||
          (action === ACTION.TURN_RIGHT && this.lastAction === ACTION.TURN_LEFT))
        score -= tactical.TURN_REVERSAL_PENALTY;
    }
    return score;
  }
  prepareCombatVectors(count) {
    this.beliefCoverage.fill(0, 0, count);
    for (let row = 0; row < count; row += 1) {
      const action = this.ourActions[row];
      if (action === ACTION.FIRE || action === ACTION.THROW_BOMB)
        this.beliefCoverage[row] = this.beliefSweepCoverage(action,
          this.projectedCell[row], this.projectedDirection[row]);
    }
    const vector = this.combat.evaluate(this.adapter.bundle, this.ourActions, count,
      this.projectedCell, this.projectedDirection, this.adapter.enemyVisible, this.beliefCoverage,
      this.tactical, this.adapter.enemyCanAct);
    const sketches = this.policy.sketches;
    for (let row = 0; row < count; row += 1) {
      let handle = this.planSketchHandle[row];
      if (handle === NONE_HANDLE && vector.aimSetup[row]) {
        const a = this.adapter.state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
        const dependency = FEATURE_DEPENDENCY.STATE | FEATURE_DEPENDENCY.ACTION |
          FEATURE_DEPENDENCY.TERRAIN | FEATURE_DEPENDENCY.HAZARD;
        const signature = mix(mix(frame, a[ARRAY.TANK_CELL][1]),
          this.ourActions[row] * 257 + this.projectedDirection[row]);
        handle = sketches.create(PLAN_KIND.SHOT, PLAN_PURPOSE.INTERCEPT,
          this.ourActions[row], this.ourArguments[row], frame + 2, dependency, signature, 0);
        if (handle !== NONE_HANDLE) this.planSketchHandle[row] = handle;
      }
      if (handle === NONE_HANDLE) continue;
      sketches.annotateCombat(handle, vector, row);
      // Terminal preservation remains an explicit owner. In normal/recovery
      // modes a verified combat purpose may replace navigation intent.
      if (vector.purpose[row] && !(this.rootGlobalMode() === GLOBAL_MODE.HARD_SURVIVAL &&
          sketches.purpose[handle] === PLAN_PURPOSE.PRESERVE))
        sketches.purpose[handle] = vector.purpose[row];
      const combatProgress = Math.max(vector.purposeCompleteness[row],
        Math.max(0, vector.pressureValue[row]),
        Math.min(10000, vector.blockadeValue[row]));
      if (combatProgress > sketches.rawScore[handle]) sketches.rawScore[handle] = combatProgress;
    }
    return vector;
  }
  preparePhysicalSearchDomain(selectionCount) {
    if (!this.compactPhysicalRiskFrontierEnabled || selectionCount < 2)
      return selectionCount;
    const state = this.adapter.state; const a = state.arrays;
    const controller = this.riskController;
    const starDelta = a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1];
    const remaining = Math.max(0,
      RULE.FRAME_RECORD_LIMIT - 1 - a[ARRAY.SCALAR][SCALAR.FRAME]);
    const committedSlack = this.escapeObligation.supportStatus === SUPPORT_STATUS.COMPLETE ?
      this.escapeObligation.rootSlack : 0;
    const stateClass = this.informationSearch.risk.classify(starDelta, remaining,
      committedSlack, 1, this.adapter.informationComplete ? 0 : 2, 0);
    const gateCount = controller.gateCount;
    const backupCount = controller.safetyBackupCount;
    controller.populate(selectionCount, this.hardStatus, this.safetyClosure.outcome,
      this.score, null, null, this.enemyCount, this.combat.vector,
      Math.max(1, this.tactical.ROBUST_SEARCH_DIVISOR || 2));
    if (this.diagnosticDisableRiskController) {
      controller.acceptableCount = 0; controller.noAcceptableAction = 0;
      controller.outcome.dominated.fill(0, 0, selectionCount);
      for (let row = 0; row < selectionCount; row += 1) {
        const allowed = controller.outcome.hard[row] !== HARD_STATUS.REJECT_PROVEN &&
          controller.outcome.hard[row] !== HARD_STATUS.REJECT_POLICY;
        controller.outcome.acceptable[row] = allowed ? 1 : 0;
        if (allowed) controller.acceptableCount += 1;
      }
      if (!controller.acceptableCount) controller.noAcceptableAction = 1;
    } else controller.gate(this.policy.baseRisk, stateClass);
    // Escape successor quality is committed-only and already available before
    // value search.  Publish it into the pre-search Pareto pass so that the
    // compact domain remains a superset of the final Risk frontier.
    if (!this.diagnosticDisableEscapeQuality && !this.diagnosticDisableEscapeObligation &&
        this.escapeObligation.publishSuccessorQuality(controller, selectionCount))
      controller.recomputeSelectionFrontier();
    // Reuse the exact committed membership operation rather than reserving
    // every EO member.  Its counters belong to the final logical decision, so
    // this pre-search projection restores them after computing the same set.
    if (this.diagnosticLegacyEarlyEscapeRestriction) {
      const restrictedCount = this.escapeObligation.restrictedSelectionCount;
      const rescueCount = this.escapeObligation.rescueOverrideCount;
      this.escapeObligation.restrictRiskController(controller, state, selectionCount);
      this.escapeObligation.restrictedSelectionCount = restrictedCount;
      this.escapeObligation.rescueOverrideCount = rescueCount;
    }
    // This is a pre-search projection, not a second logical Risk decision.
    controller.gateCount = gateCount; controller.safetyBackupCount = backupCount;
    let rows = 0;
    for (let row = 0; row < selectionCount; row += 1)
      if (controller.outcome.acceptable[row] && !controller.outcome.dominated[row])
        this.stageRowMap[rows++] = row;
    this.compactPhysicalRiskFrontierAttempts += 1;
    this.compactPhysicalRiskFrontierFullRows += selectionCount;
    this.compactPhysicalRiskFrontierRows += rows || selectionCount;
    if (rows === 1) this.compactPhysicalRiskFrontierSingleRows += 1;
    // No acceptable witness uses the existing full-domain emergency ranking.
    return rows > 0 ? rows : selectionCount;
  }
  wireProductionStageMatrix(continuationAction = ACTION.NONE) {
    const state = this.adapter.state; const a = state.arrays; const controller = this.riskController;
    const starDelta = a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1];
    const remaining = Math.max(0, RULE.FRAME_RECORD_LIMIT - 1 - a[ARRAY.SCALAR][SCALAR.FRAME]);
    const committedSlack = this.escapeObligation.supportStatus === SUPPORT_STATUS.COMPLETE ?
      this.escapeObligation.rootSlack : 0;
    const stateClass = this.informationSearch.risk.classify(starDelta, remaining,
      committedSlack, 1,
      this.adapter.informationComplete ? 0 : 2, 0);
    // NONE is an emitter-level emergency hold, not a searched tactical row.
    // Feeding it to the controller would compare an unsearched zero root value
    // with completed search rows and could incorrectly raise the safe floor.
    const selectionCount = this.ourCount > 1 &&
      this.ourActions[this.ourCount - 1] === ACTION.NONE ? this.ourCount - 1 : this.ourCount;
    const nominalEvidenceOnly = this.nominalPhysicalRootActive &&
      this.diagnosticNominalPhysicalEvidenceOnly;
    controller.populate(selectionCount, this.hardStatus, this.safetyClosure.outcome,
      this.score, nominalEvidenceOnly ? null : this.depthSearch,
      this.informationSearch, this.enemyCount, this.combat.vector,
      Math.max(1, this.tactical.ROBUST_SEARCH_DIVISOR || 2));
    if (this.diagnosticChanceSurvivalRisk)
      this.escapeObligation.publishChanceRisk(controller, selectionCount);
    if (this.diagnosticDisableRiskController) {
      controller.acceptableCount = 0; controller.noAcceptableAction = 0;
      controller.outcome.dominated.fill(0, 0, selectionCount);
      for (let row = 0; row < selectionCount; row += 1) {
        const allowed = controller.outcome.hard[row] !== HARD_STATUS.REJECT_PROVEN &&
          controller.outcome.hard[row] !== HARD_STATUS.REJECT_POLICY;
        controller.outcome.acceptable[row] = allowed ? 1 : 0;
        if (allowed) controller.acceptableCount += 1;
      }
      if (!controller.acceptableCount) controller.noAcceptableAction = 1;
    } else controller.gate(this.policy.baseRisk, stateClass);
    if (!this.diagnosticDisableEscapeQuality && !this.diagnosticDisableEscapeObligation) {
      this.escapeObligation.publishSuccessorQuality(controller, selectionCount);
    }
    // Native V2 keeps its established early committed membership. Strict
    // final rescue is an additional proof backstop, not its replacement.
    if (this.diagnosticLegacyEarlyEscapeRestriction)
      this.escapeObligation.restrictRiskController(controller, state, selectionCount);
    if (continuationAction !== ACTION.NONE) {
      let continuationRow = -1;
      for (let row = 0; row < selectionCount; row += 1)
        if (this.ourActions[row] === continuationAction) { continuationRow = row; break; }
      controller.commitContinuation(continuationRow);
    }
    controller.applyCombatPressure(this.combat.vector);
    // A risk-zero root can legitimately have no acceptable action when every
    // InformationState row carries the same coarse UNKNOWN mass.  Compute the
    // projected pose discriminator only on that cold emergency branch: normal
    // acceptable roots pay no additional line or distance geometry work.
    if (controller.noAcceptableAction)
      for (let row = 0; row < selectionCount; row += 1)
        controller.outcome.unknownFallbackRisk[row] =
          this.diagnosticLegacyNoAcceptablePoseFallback ?
            this.possibleRisk(this.projectedCell[row], this.projectedDirection[row]) :
            this.fallbackPoseRisk(this.projectedCell[row], this.projectedDirection[row]);
    // Search/tactical values do not participate in Risk dominance.  Therefore
    // every final Risk-frontier row must have been present in the compact
    // pre-search domain.  Retain a production-visible counter so future Risk
    // changes cannot silently violate that ownership contract.
    if (this.compactPhysicalRiskFrontierEnabled && this.depthSearch.rootDomainRestricted)
      for (let row = 0; row < selectionCount; row += 1)
        if (controller.outcome.acceptable[row] && !controller.outcome.dominated[row] &&
            !this.depthSearch.rootDomainMask[row])
          this.compactPhysicalRiskFrontierViolations += 1;
    // Strategy sees rows that survived Hard, Risk and Pareto. Committed escape
    // is a quality dimension here; final-only rescue owns proven-dead output.
    this.fillStrategyInputs(controller.outcome, -10000);
    const globalMode = this.rootGlobalMode();
    const decisions = this.policy.prepareStrategyPortfolio(
      this.policy.strategyInput, globalMode);
    const approvedChallenger = this.policy.selector.candidateForPortfolio(
      this.policy.strategyInput, globalMode);
    this.strategyBands.configureRoot(
      this.policy.strategyInput.values[STRATEGY_INPUT.KILL_DEADLINE],
      this.policy.strategyInput.values[STRATEGY_INPUT.STAR_DEADLINE],
      this.policy.strategyInput.values[STRATEGY_INPUT.PURPOSE_COMPLETENESS],
      globalMode);
    if (this.policy.proposalArbiter.enabled)
      this.policy.proposalArbiter.buildPortfolio(controller, this.strategyBands,
        this.ourActions, selectionCount, this.combat.vector);
    else this.strategyBands.buildPortfolio(controller, decisions,
      this.policy.strategyId, this.ourActions, selectionCount, this.combat.vector,
      approvedChallenger);
    const contactQualifiedOpen = this.diagnosticContactQualifiedStrategyPortfolio &&
      this.lastControlMode === ROOT_CONTROL_MODE.TACTICAL_CONTACT;
    if (this.diagnosticOpenStrategyPortfolio ||
        this.diagnosticOpenQualifiedStrategyPortfolio || contactQualifiedOpen) {
      this.openStrategyPortfolioRootCount += 1;
      for (let row = 0; row < selectionCount; row += 1) {
        let qualified = 1; const action = this.ourActions[row];
        const resource = action === ACTION.THROW_BOMB ||
          (action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST);
        if ((this.diagnosticOpenQualifiedStrategyPortfolio || contactQualifiedOpen) && resource) {
          qualified = this.optionPortfolio && this.optionPortfolio.typedResourceVerified(
            action, row, this.combat.vector, this.adapter.state,
            this.adapter.enemyVisible) ? 1 : 0;
          if (!qualified) this.qualifiedStrategyResourceBlockedCount += 1;
        }
        this.strategyBands.selected[row] = controller.outcome.acceptable[row] &&
          !controller.outcome.dominated[row] && qualified ? 1 : 0;
      }
    }
    if (this.optionPortfolio) {
      if (this.diagnosticTypedOptionPortfolio)
        this.optionPortfolio.buildTyped(this.ourActions, selectionCount,
          this.strategyBands, this.combat.vector, this.escapeObligation,
          this.planSketchHandle, this.policy.sketches, this.adapter.state,
          globalMode, this.adapter.enemyVisible);
      else this.optionPortfolio.build(this.ourActions, selectionCount,
        this.strategyBands, this.combat.vector, this.escapeObligation,
        this.planSketchHandle, this.policy.sketches, this.adapter.state);
    }
    this.strategyBandUseCount += 1;
    if (this.strategyBands.fallbackUsed) this.strategyBandFallbackCount += 1;
    this.policyProbability.fill(0);
    let rows = 0;
    for (let row = 0; row < selectionCount; row += 1)
      if (controller.outcome.acceptable[row] && !controller.outcome.dominated[row] &&
          this.strategyBands.selected[row])
        this.stageRowMap[rows++] = row;
    const information = this.informationSearch.completedDepth > 0;
    const physical = this.depthSearch.completedDepth > 0 && !nominalEvidenceOnly;
    const source = information ? this.informationSearch : physical ? this.depthSearch : null;
    const desiredMatrixIterations = Math.max(0, this.searchOptions.matrixIterations | 0);
    const matrixIterationBudget = this.availableNodeBudget(desiredMatrixIterations,
      this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.MATRIX_ITERATION]);
    // A matrix with no evaluated interaction cells is just a duplicated
    // tactical vector.  Solving it manufactures a mixed policy from no game
    // evidence, so non-contact roots remain deterministic expected/tactical
    // selection after the same risk gate.
    const valueSupportComplete = productionValueSupportComplete(source, information);
    if (!this.diagnosticDisableStageMatrix && source &&
        (valueSupportComplete || this.diagnosticIncompleteSearchOwnership) && rows > 0 &&
        this.enemyCount > 0 &&
        matrixIterationBudget > 0 && this.search.matrix.initialize(rows, this.enemyCount) === 1) {
      for (let matrixRow = 0; matrixRow < rows; matrixRow += 1) {
        const rootRow = this.stageRowMap[matrixRow];
        for (let column = 0; column < this.enemyCount; column += 1) {
          const raw = source ? source.rootCellScore[rootRow *
            SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column] : controller.outcome.robustLower[rootRow];
          const tacticalPart = controller.outcome.tacticalValue[rootRow];
          const attackPressure = this.projectileAttack.cellPressure[rootRow *
            SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column];
          const value = source ? Math.max(-10000, Math.min(10000,
            tacticalPart + Math.trunc(raw / controller.searchDivisor) +
            attackPressure)) :
            Math.max(-10000, Math.min(10000, raw));
          this.search.matrix.setCell(matrixRow, column, value, value,
            controller.outcome.coverage[rootRow] === 10000 && valueSupportComplete ? 1 : 0);
        }
      }
      this.search.matrixSolver.solve(matrixIterationBudget,
        this.searchOptions.matrixBatch); this.search.lastPolicyHandle = this.search.matrixSolver.policyHandle;
      if (this.search.matrixSolver.iterations > 0)
        this.runtime.chargeOptional(WORK_KIND.MATRIX_ITERATION,
          this.search.matrixSolver.iterations);
      const arena = this.search.policyArena; const handle = this.search.lastPolicyHandle;
      if (handle !== NONE_NODE && handle < arena.policyUsed) {
        const start = arena.entryStart[handle]; const count = arena.entryCount[handle];
        for (let index = 0; index < count; index += 1) {
          const matrixRow = arena.action[start + index];
          if (matrixRow < rows) this.policyProbability[this.stageRowMap[matrixRow]] =
            arena.probability[start + index];
        }
      }
      controller.stageMatrixUseCount += 1; this.stageMatrixSolveCount += 1;
    }
    if (controller.noAcceptableAction) this.noAcceptableActionCount += 1;
    const seed = mix(mix(state.hashLo, state.hashHi), a[ARRAY.SCALAR][SCALAR.FRAME]);
    this.tacticalEnvelope.bind(controller.outcome, this.depthSearch,
      this.informationSearch, this.lastControlMode === ROOT_CONTROL_MODE.TACTICAL_CONTACT);
    if (this.nativeInitiativeEnabled ||
        (this.nativeNavigationOnlyEnabled &&
         this.lastControlMode === ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION))
      return this.nativeInitiativeArbiter.select(this.lastControlMode,
        this.policy.strategicArbiter, controller, this.ourActions,
        this.tacticalEnvelope, this.projectileAttack, this.planSketchHandle,
        this.policy.sketches, seed, this.turnStreak, this.projectedCell,
        this.adapter.state.arrays[ARRAY.TANK_CELL][0]);
    if (this.policy.proposalArbiter.enabled)
      return this.policy.proposalArbiter.select(this.lastControlMode,
        this.policy.strategicArbiter, controller, this.strategyBands,
        this.policyProbability, this.tacticalEnvelope, seed, this.ourActions,
        this.planSketchHandle, this.policy.sketches, this.rootGlobalMode());
    return this.policy.strategicArbiter.select(this.lastControlMode, controller,
      this.strategyBands, this.policyProbability, this.tacticalEnvelope, seed,
      this.planSketchHandle, this.policy.sketches, this.strategicProfile,
      this.rootGlobalMode(), this.planArbitrationEnabled);
  }
  resetSearchArenas() {
    this.search.policyArena.policyUsed = 0; this.search.policyArena.entryUsed = 0;
    this.search.coverageArena.used = 0; this.search.proof.coverageArena.used = 0;
    this.policyProbability.fill(0);
  }
  readSearchPolicy() {
    const arena = this.search.policyArena; const handle = this.search.lastPolicyHandle;
    if (handle === NONE_NODE || handle >= arena.policyUsed) return;
    const start = arena.entryStart[handle]; const count = arena.entryCount[handle];
    for (let index = 0; index < count; index += 1) {
      const row = arena.action[start + index]; if (row < this.ourCount)
        this.policyProbability[row] = arena.probability[start + index];
    }
  }
  forcedWinRow() {
    if (this.search.lastProofStatus !== PROOF_STATUS.PROVEN) return -1;
    const arena = this.search.policyArena; const handle = this.search.lastPolicyHandle;
    if (handle === NONE_NODE || handle >= arena.policyUsed || arena.entryCount[handle] !== 1) return -1;
    const row = arena.action[arena.entryStart[handle]]; return row < this.ourCount ? row : -1;
  }
  orderForEmergency() {
    const used = this.orderUsed; used.fill(0);
    for (let out = 0; out < this.ourCount; out += 1) {
      let best = -1;
      for (let index = 0; index < this.ourCount; index += 1)
        if (!used[index] && (best < 0 || this.score[index] > this.score[best])) best = index;
      used[best] = 1; this.orderedActions[out] = this.ourActions[best];
      this.orderedArguments[out] = this.ourArguments[best];
      this.orderedIndexes[out] = best;
    }
  }
  availableNodeBudget(desired, workPerNode) {
    if (desired <= 0 || workPerNode <= 0) return 0;
    const runtime = this.runtime; const config = runtime.runtimeConfig;
    const callbackUnits = config.PER_CALLBACK_WORK_UNIT_LIMIT -
      config.MINIMUM_EMERGENCY_BATCH_RESERVE - runtime.currentCallbackWorkUnits;
    const matchUnits = config.EMERGENCY_ENTER_WORK_UNITS -
      config.MINIMUM_EMERGENCY_BATCH_RESERVE - runtime.accumulatedWorkUnits -
      runtime.currentCallbackWorkUnits;
    const available = Math.min(callbackUnits, matchUnits);
    return available <= 0 ? 0 : Math.min(desired, Math.floor(available / workPerNode));
  }
  availableOptionalWorkUnits() {
    const runtime = this.runtime; const config = runtime.runtimeConfig;
    const callbackUnits = config.PER_CALLBACK_WORK_UNIT_LIMIT -
      config.MINIMUM_EMERGENCY_BATCH_RESERVE - runtime.currentCallbackWorkUnits;
    const matchUnits = config.EMERGENCY_ENTER_WORK_UNITS -
      config.MINIMUM_EMERGENCY_BATCH_RESERVE - runtime.accumulatedWorkUnits -
      runtime.currentCallbackWorkUnits;
    return Math.max(0, Math.min(callbackUnits, matchUnits));
  }
  actionFamilyForShadow(action) { return actionFamily(action); }
  chargeValueSearchWork(search) {
    if (!search) return 0;
    const charges = this.runtime.runtimeConfig.WORK_CHARGES;
    const transitions = Math.max(0, search.nodes | 0);
    const replayed = Math.min(transitions, Math.max(0, search.rootTransitionHits | 0));
    const classified = Math.max(0, search.classifiedNodes | 0);
    const reverseBuilds = Math.max(0, search.reverseBuilds | 0);
    if (transitions) this.runtime.chargeOptional(WORK_KIND.VALUE_NODE, transitions);
    if (transitions > replayed)
      this.runtime.chargeOptional(WORK_KIND.FAST_TRANSITION, transitions - replayed);
    if (replayed) this.runtime.chargeOptional(WORK_KIND.CACHE, replayed);
    if (classified) this.runtime.chargeOptional(WORK_KIND.CACHE, classified);
    const premium = Math.max(0, charges[WORK_KIND.HARD] - charges[WORK_KIND.CACHE]);
    if (reverseBuilds && premium)
      this.runtime.chargeOptionalUnits(reverseBuilds * premium, WORK_KIND.HARD);
    return transitions * charges[WORK_KIND.VALUE_NODE] +
      (transitions - replayed) * charges[WORK_KIND.FAST_TRANSITION] +
      replayed * charges[WORK_KIND.CACHE] +
      classified * charges[WORK_KIND.CACHE] + reverseBuilds * premium;
  }
  chargeRootHardWork(bundle, appliedStart, classifyStart, buildStart, replayStart) {
    const kernel = bundle.kernel; const hard = bundle.hard; const slab = this.rootTransitions;
    const applied = Math.max(0, kernel.appliedActionCount - appliedStart);
    const classified = Math.max(0, hard.classifyCount - classifyStart);
    const builds = Math.max(0, hard.reverseBuildCount - buildStart);
    const replayed = Math.max(0, slab.replayHitCount - replayStart);
    const charges = this.runtime.runtimeConfig.WORK_CHARGES;
    if (applied) this.runtime.chargeMandatory(WORK_KIND.FAST_TRANSITION, applied);
    if (classified + replayed)
      this.runtime.chargeMandatory(WORK_KIND.CACHE, classified + replayed);
    const premium = Math.max(0, charges[WORK_KIND.HARD] - charges[WORK_KIND.CACHE]);
    if (builds && premium) this.runtime.chargeUnits(builds * premium, WORK_KIND.HARD);
    return applied * charges[WORK_KIND.FAST_TRANSITION] +
      (classified + replayed) * charges[WORK_KIND.CACHE] + builds * premium;
  }
  observationSafetySupportComplete() {
    if (!this.hiddenSupportComplete || !this.threatCapability.complete ||
        this.possibleProjectiles.count() > 0 || !this.adapter.tracker.complete) return 0;
    const tracker = this.adapter.tracker;
    for (let slot = 0; slot < tracker.bombActive.length; slot += 1)
      if (tracker.bombActive[slot] && (!tracker.bombExact[slot] || !tracker.bombOwnerExact[slot])) return 0;
    return 1;
  }
  refineObservationSafety(bundle) {
    const output = this.safetyClosure.outcome;
    const desired = Math.min(SEARCH_CAPACITY.MAX_NODES, this.searchOptions.proofBudget);
    let remaining = this.availableNodeBudget(desired,
      this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.PROOF_NODE]);
    const supportComplete = this.observationSafetySupportComplete(); let spent = 0;
    const selectionCount = this.ourCount > 1 &&
      this.ourActions[this.ourCount - 1] === ACTION.NONE ? this.ourCount - 1 : this.ourCount;
    this.observationSafetyAudited.fill(0, 0, this.ourCount);
    this.observationSafetyStatusByAction.fill(FRONTIER_STATUS.UNKNOWN, 0, this.ourCount);
    this.observationSafetyNodesByAction.fill(0, 0, this.ourCount);
    this.observationSafetyFatalFrameByAction.fill(NONE_FATAL_FRAME, 0, this.ourCount);
    // ObservationSafetyFrontier is a universal AND/OR certificate. A
    // NO_WITNESS branch may rely on a future EnemyAction (for example FIRE),
    // so it may invalidate PROVEN_SAFE but must never be converted into a
    // probability-1 physical death. POSSIBLE_DEATH values are handled by the
    // quantitative SafetyClosure/robust backup and are not partially replaced
    // by boolean frontier results.
    for (let row = 0; row < selectionCount; row += 1) {
      if (this.hardStatus[row] !== HARD_STATUS.ALLOW ||
          output.status[row] !== SAFETY_STATUS.PROVEN_SAFE) continue;
      if (remaining <= 0) continue;
      this.observationSafetyAudited[row] = 1; this.observationSafetyAuditCount += 1;
      const result = this.observationSafety.classify(bundle, this.ourActions[row],
        this.ourArguments[row], this.hiddenWorldCell, this.hiddenWorldCount,
        supportComplete, this.adapter.enemyVisible, this.adapter.lastEnemyDirection,
        SAFETY_HORIZON, remaining);
      this.observationSafetyStatusByAction[row] = result;
      this.observationSafetyNodesByAction[row] = this.observationSafety.nodes;
      this.observationSafetyFatalFrameByAction[row] = this.observationSafety.earliestFatalFrame;
      spent += this.observationSafety.nodes;
      remaining = Math.max(0, remaining - this.observationSafety.nodes);
      if (result === FRONTIER_STATUS.WINDOW_SAFE) {
        output.status[row] = SAFETY_STATUS.PROVEN_SAFE;
        output.immediateFatalMass[row] = 0; output.horizonFatalMass[row] = 0;
        output.unknownMass[row] = 0; output.earliestFatalFrame[row] = NONE_FATAL_FRAME;
        output.clearDeath(row);
        output.coverage[row] = 10000;
        this.observationSafetySafeCount += 1; continue;
      }
      output.status[row] = SAFETY_STATUS.UNKNOWN;
      output.unknownMass[row] = 10000; output.coverage[row] = 0;
      this.observationSafetyUnknownCount += 1;
    }
    if (spent > 0) this.runtime.charge(WORK_KIND.PROOF_NODE, spent);
    return spent;
  }
  strictSafeThreatFirePhysicalSupport(exact) {
    if (exact) return 1;
    const gap = this.adapter.informationGapMask >>> 0;
    return gap === INFORMATION_GAP.POSSIBLE_ENEMY_PROJECTILE &&
      this.possibleProjectiles && this.possibleProjectiles.pool.complete &&
      this.possibleProjectiles.count() === 0 ? 1 : 0;
  }
  refutedPossiblePhysicalValueSupport(exact) {
    return this.diagnosticRefutedPossiblePhysicalSearch && !exact &&
      this.adapter.enemyVisible && this.strictSafeThreatFirePhysicalSupport(exact) ? 1 : 0;
  }
  refutedPossiblePhysicalChallenger(selectionCount) {
    const combat = this.combat.vector;
    for (let row = 0; row < selectionCount; row += 1) {
      if (this.ourActions[row] !== ACTION.FIRE ||
          this.hardStatus[row] !== HARD_STATUS.ALLOW ||
          !combat.postFireEscape[row]) continue;
      if (this.controlMode.context.clearLine || combat.directKill[row] ||
          combat.possibleHit[row]) return 1;
    }
    return 0;
  }
  selectRefutedPossiblePhysicalFire(preferred, selectionCount) {
    this.refutedPossiblePhysicalVerifierCheckCount += 1;
    const search = this.depthSearch;
    if (preferred < 0 || preferred >= selectionCount ||
        !search.representativeSupportComplete || search.completedDepth < 1) {
      this.refutedPossiblePhysicalVerifierIncompleteCount += 1; return preferred;
    }
    let fire = -1;
    for (let row = 0; row < selectionCount; row += 1)
      if (this.ourActions[row] === ACTION.FIRE &&
          this.hardStatus[row] === HARD_STATUS.ALLOW &&
          this.combat.vector.postFireEscape[row]) { fire = row; break; }
    if (fire < 0 || fire === preferred) return preferred;
    const outcome = this.riskController.outcome;
    if (!outcome.acceptable[fire] || outcome.dominated[fire]) {
      this.refutedPossiblePhysicalVerifierRiskBlockedCount += 1; return preferred;
    }
    if (search.rootDomainRestricted &&
        (!search.rootDomainMask[fire] || !search.rootDomainMask[preferred])) {
      this.refutedPossiblePhysicalVerifierIncompleteCount += 1; return preferred;
    }
    const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES; let strict = 0;
    for (let column = 0; column < this.enemyCount; column += 1) {
      const fireCell = fire * stride + column;
      const preferredCell = preferred * stride + column;
      if (search.iterationCellComplete[fireCell] !== 1 ||
          search.iterationCellComplete[preferredCell] !== 1) {
        this.refutedPossiblePhysicalVerifierIncompleteCount += 1; return preferred;
      }
      const fireValue = search.rootCellScore[fireCell];
      const preferredValue = search.rootCellScore[preferredCell];
      if (fireValue < preferredValue) return preferred;
      if (fireValue > preferredValue) strict = 1;
    }
    if (!strict) return preferred;
    this.refutedPossiblePhysicalVerifierProposalCount += 1;
    this.refutedPossiblePhysicalVerifierOverrideCount += 1;
    return fire;
  }
  runStrictSafeThreatFireShadow(bundle, exact) {
    this.strictSafeThreatFireShadowLastStatus = PROOF_STATUS.UNKNOWN;
    this.strictSafeThreatFireShadowLastAllDoomed = 0;
    this.strictSafeThreatFireShadowLastFireRow = -1;
    if (!this.diagnosticStrictSafeThreatFireShadow ||
        !this.controlMode.context.clearLine) return;
    this.strictSafeThreatFireShadowScheduledCount += 1;
    for (let row = 0; row < this.ourCount; row += 1)
      if (this.ourActions[row] === ACTION.FIRE &&
          this.hardStatus[row] === HARD_STATUS.ALLOW) {
        this.strictSafeThreatFireShadowLastFireRow = row; break;
      }
    if (this.strictSafeThreatFireShadowLastFireRow < 0) {
      this.strictSafeThreatFireShadowRootFireBlockedCount += 1; return;
    }
    // The certificate is Physical-only. An approximate observation may still
    // be useful to Risk, but it can never be upgraded into strict ownership.
    const physicalSupport = this.strictSafeThreatFirePhysicalSupport(exact);
    if (!physicalSupport || !this.adapter.enemyVisible) {
      const gap = this.adapter.informationGapMask >>> 0;
      const possibleCount = this.possibleProjectiles ?
        Math.min(CAPACITY.MAX_PROJECTILES,
          this.possibleProjectiles.count()) : 0;
      if (this.strictSafeThreatFireShadowPossibleCount)
        this.strictSafeThreatFireShadowPossibleCount[possibleCount] += 1;
      if (this.possibleProjectiles && this.possibleProjectiles.pool.complete)
        this.strictSafeThreatFireShadowPossiblePoolCompleteCount += 1;
      else this.strictSafeThreatFireShadowPossiblePoolIncompleteCount += 1;
      if (this.strictSafeThreatFireShadowGapBitCount)
        for (let bit = 0; bit < this.strictSafeThreatFireShadowGapBitCount.length;
          bit += 1)
          if (gap & (1 << bit))
            this.strictSafeThreatFireShadowGapBitCount[bit] += 1;
      if (gap === INFORMATION_GAP.POSSIBLE_ENEMY_PROJECTILE)
        this.strictSafeThreatFireShadowPossibleOnlyBlockedCount += 1;
      else if (gap & INFORMATION_GAP.POSSIBLE_ENEMY_PROJECTILE)
        this.strictSafeThreatFireShadowPossibleWithOtherBlockedCount += 1;
      else this.strictSafeThreatFireShadowOtherGapBlockedCount += 1;
      this.strictSafeThreatFireShadowExactBlockedCount += 1; return;
    }
    if (!exact) this.strictSafeThreatFireShadowResolvedPossibleGapCount += 1;
    const available = this.availableNodeBudget(STRICT_SAFE_THREAT_NODE_BUDGET,
      this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.PROOF_NODE]);
    if (available < STRICT_SAFE_THREAT_NODE_BUDGET) {
      this.strictSafeThreatFireShadowBudgetBlockedCount += 1; return;
    }
    if (!this.strictSafeThreatFireProofArena ||
        this.strictSafeThreatFireProofState !== bundle.state) {
      this.strictSafeThreatFireProofArena =
        new StrictSafeThreatFireProofArena(bundle.state);
      this.strictSafeThreatFireProofState = bundle.state;
    }
    const arena = this.strictSafeThreatFireProofArena;
    const status = arena.evaluate(bundle, this.enemyActions,
      this.enemyArguments, this.enemyCount);
    this.strictSafeThreatFireShadowLastStatus = status;
    this.strictSafeThreatFireShadowLastAllDoomed =
      arena.lastAllDoomed ? 1 : 0;
    this.strictSafeThreatFireShadowNodes += arena.lastTotalNodes;
    this.strictSafeThreatFireShadowWorkUnits += arena.lastTotalNodes *
      this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.PROOF_NODE];
    this.strictSafeThreatFireShadowRestoreFailures +=
      arena.lastRestoreFailures;
    this.strictSafeThreatFireShadowHotAllocationCount +=
      arena.hotAllocationCount + arena.search.hotAllocationCount +
      arena.search.settlement.hotAllocationCount +
      arena.search.settlement.timeline.hotAllocationCount +
      arena.search.settlement.reverse.hotAllocationCount +
      arena.kernel.hotAllocationCount;
    if (status === PROOF_STATUS.PROVEN) {
      this.strictSafeThreatFireShadowProvenCount += 1;
      if (arena.lastAllDoomed)
        this.strictSafeThreatFireShadowDoomedProvenCount += 1;
      else this.strictSafeThreatFireShadowThreatOnlyProvenCount += 1;
      const fire = this.strictSafeThreatFireShadowLastFireRow;
      if (fire >= 0 && this.projectileAttack.status[fire] ===
          PAC_STATUS.COMPLETE) {
        this.strictSafeThreatFireShadowPacCompleteCount += 1;
        let doomed = 0; let survives = 0; let unknown = 0; let nodes = 0;
        const base = fire * this.projectileAttack.maxEnemy;
        const ownChance = bundle.hard.chanceAlternativeCount(0, ACTION.FIRE);
        for (let column = 0; column < this.enemyCount; column += 1) {
          const cell = this.projectileAttack.cellStatus[base + column];
          if (cell === PAC_CELL.PROVEN_DOOMED) {
            doomed += 1;
            nodes += ownChance * bundle.hard.chanceAlternativeCount(1,
              this.enemyActions[column]);
          } else if (cell === PAC_CELL.SURVIVES) survives += 1;
          else unknown += 1;
        }
        if (doomed > 0 && survives > 0 && unknown === 0) {
          this.strictSafeThreatFireShadowPrunableRootCount += 1;
          this.strictSafeThreatFireShadowPrunableColumnCount += doomed;
          this.strictSafeThreatFireShadowPrunableRootNodeCount += nodes;
        }
      } else this.strictSafeThreatFireShadowPacIncompleteCount += 1;
    } else this.strictSafeThreatFireShadowUnknownCount += 1;
  }
  auditStrictSafeThreatFireShadowSelection(selected) {
    if (!this.diagnosticStrictSafeThreatFireShadow || selected < 0 ||
        this.strictSafeThreatFireShadowLastStatus !== PROOF_STATUS.PROVEN)
      return;
    if (this.ourActions[selected] === ACTION.FIRE)
      this.strictSafeThreatFireShadowAlreadyFireCount += 1;
    else this.strictSafeThreatFireShadowActionableCount += 1;
  }
  applyStrictSafeThreatFireActive(bundle, selected) {
    if ((!this.diagnosticStrictSafeThreatFireActive &&
         !this.diagnosticStrictDoomedFireActive) || selected < 0 ||
        this.strictSafeThreatFireShadowLastStatus !== PROOF_STATUS.PROVEN ||
        this.ourActions[selected] === ACTION.FIRE) return selected;
    if (this.diagnosticStrictDoomedFireActive &&
        !this.strictSafeThreatFireShadowLastAllDoomed) return selected;
    const fire = this.strictSafeThreatFireShadowLastFireRow;
    if (fire < 0 || fire >= this.ourCount ||
        this.hardStatus[fire] !== HARD_STATUS.ALLOW) {
      this.strictSafeThreatFireActiveMissingRowCount += 1; return selected;
    }
    if (!this.finalGate.finalAllows(bundle, this.ourActions,
        this.ourArguments, fire, this.ourCount)) {
      this.strictSafeThreatFireActiveFinalRejectCount += 1; return selected;
    }
    this.finalGate.lastSelected = fire;
    this.strictSafeThreatFireActiveOverrideCount += 1;
    if (this.diagnosticStrictDoomedFireActive)
      this.strictDoomedFireActiveOverrideCount += 1;
    return fire;
  }
  selectAction(bundle, exact) {
    const a = this.adapter.state.arrays;
    const priorRiskContinuation = this.multiFrameRisk.recommendedContinuation(this.adapter.state);
    this.lastSearchRoot = NONE_NODE; this.lastSearchStatus = 0;
    this.lastProofStatus = PROOF_STATUS.UNKNOWN;
    this.depthSearch.resetRoot(); this.informationSearch.resetRoot();
    if (this.optionInformationInterval) this.optionInformationInterval.resetRoot();
    this.nominalPhysicalRootActive = 0;
    this.forcedWinSearch.resetRoot();
    this.prepareNavigation();
    this.createPlanSketches();
    this.prepareHiddenRisk();
    if (this.diagnosticDisableHiddenProjectileRisk) {
      this.hiddenProjectileRisk.reset();
      this.hiddenProjectileRisk.complete = 1;
      this.hiddenProjectileRisk.prepared = 1;
    }
    for (let index = 0; index < this.ourCount; index += 1) {
      const packed = this.projected(this.ourActions[index]);
      this.projectedCell[index] = (packed / 4) | 0; this.projectedDirection[index] = packed & 3;
    }
    this.runtime.writeSearchOptions(this.searchOptions);
    this.resetSearchArenas();
    // RootTransitionSlab still describes the previous callback here.  Capture
    // an exact successor PV before prepare() advances it to this root.
    this.depthSearch.prepareCrossFramePV(bundle.state, this.policy.baseRisk, DEEP_WIDTH);
    this.rootTransitions.prepare(bundle, this.ourActions, this.ourArguments, this.ourCount,
      this.enemyActions, this.enemyArguments, this.enemyCount);
    const rootAppliedStart = bundle.kernel.appliedActionCount;
    const rootClassifyStart = bundle.hard.classifyCount;
    const rootBuildStart = bundle.hard.reverseBuildCount;
    const rootReplayStart = this.rootTransitions.replayHitCount;
    this.finalGate.evaluate(bundle, this.ourActions, this.ourArguments, this.ourCount);
    for (let index = 0; index < this.ourCount; index += 1) {
      this.hardStatus[index] = this.finalGate.status[index];
      if (this.hardStatus[index] === HARD_STATUS.REJECT_PROVEN ||
          this.hardStatus[index] === HARD_STATUS.REJECT_POLICY) this.hardRejectAvoided += 1;
    }
    this.chargeRootHardWork(bundle, rootAppliedStart, rootClassifyStart,
      rootBuildStart, rootReplayStart);
    this.threatCapability.prepare(bundle, 1, this.adapter.enemyCanAct,
      this.adapter.enemyCanFire, this.adapter.enemyCapabilitySupportComplete);
    const selectionCount = this.ourCount > 1 &&
      this.ourActions[this.ourCount - 1] === ACTION.NONE ? this.ourCount - 1 : this.ourCount;
    if (this.diagnosticDisableInformationSafety) {
      const output = this.safetyClosure.outcome; output.reset(this.ourCount);
      for (let row = 0; row < this.ourCount; row += 1)
        if (this.hardStatus[row] === HARD_STATUS.ALLOW) {
          output.status[row] = SAFETY_STATUS.PROVEN_SAFE;
          output.coverage[row] = 10000;
        }
      this.multiFrameRisk.reset?.();
    } else {
      let safetyNodeBudget = this.availableNodeBudget(
        SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE, 1);
      // Runtime degradation may remove Minimax and the expandable hidden
      // frontier, but it must not remove the bounded visible-muzzle check.
      // One visible world costs at most one node per ChanceOutcome support.
      if (this.adapter.enemyVisible && this.adapter.enemyCanFire && this.hiddenWorldCount === 1) {
        let visibleSafetyFloor = 0;
        for (let row = 0; row < this.ourCount; row += 1)
          visibleSafetyFloor += Math.max(1, this.finalGate.chanceSupportCount[row]);
        if (visibleSafetyFloor > safetyNodeBudget) safetyNodeBudget = visibleSafetyFloor;
      }
      this.safetyClosure.evaluate(bundle, this.ourActions, this.ourCount, this.hardStatus,
        this.projectedCell, this.projectedDirection, this.hiddenWorldCell, this.hiddenWorldMass,
        this.hiddenWorldCount, this.hiddenSupportComplete, this.possibleProjectiles,
        this.adapter.enemyCanFire, this.adapter.lastEnemyDirection,
        safetyNodeBudget, 1,
        this.policy.opponent.propensity(OPPONENT_EVENT.FIRE, this.opponentContext()),
        this.finalGate.chanceSupportCount, this.finalGate.chanceFatalSupportCount,
        this.finalGate.chanceIncompleteSupportCount, this.threatCapability,
        this.finalGate.chanceCell, this.finalGate.chanceDirection,
        this.runtime.runtimeMode === RUNTIME_MODE.EMERGENCY ? 1 : 0);
      const multiFrameBudget = this.availableNodeBudget(4096,
        this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.FEATURE_PLAN]);
      this.multiFrameRisk.evaluate(bundle, selectionCount, this.hardStatus,
        this.finalGate.chanceSupportCount, this.finalGate.chanceIncompleteSupportCount,
        this.finalGate.chanceCell, this.finalGate.chanceDirection, this.hiddenWorldCell,
        this.hiddenWorldMass, this.hiddenWorldCount,
        this.hiddenSupportComplete,
        this.threatCapability, this.adapter.lastEnemyDirection,
        this.policy.opponent.propensity(OPPONENT_EVENT.FIRE, this.opponentContext()),
        multiFrameBudget, this.safetyClosure.outcome, this.possibleProjectiles,
        this.hiddenWorldDirectionMask, this.hiddenRiskSupportComplete,
        this.hiddenProjectileRisk);
      if (this.multiFrameRisk.nodes > 0)
        this.runtime.charge(WORK_KIND.FEATURE_PLAN, this.multiFrameRisk.nodes);
      this.refineObservationSafety(bundle);
    }
    if (!this.diagnosticDisableEscapeObligation) {
      this.escapeObligation.evaluateCommitted(bundle, this.ourActions, this.ourArguments,
        this.projectedCell, this.projectedDirection, this.hardStatus, selectionCount,
        this.finalGate);
    }
    this.prepareCombatVectors(selectionCount);
    this.projectileAttack.evaluate(bundle, this.ourActions, this.ourArguments,
      selectionCount, this.enemyActions, this.enemyArguments, this.enemyCount,
      this.combat.vector);
    this.prepareStrategyEvidence(selectionCount);
    this.fillFeatureInputs(ACTION.NONE, a[ARRAY.TANK_CELL][0], a[ARRAY.TANK_DIR][0], 0,
      this.possibleRisk(a[ARRAY.TANK_CELL][0]), this.countMobility(a[ARRAY.TANK_CELL][0]));
    this.policy.prepareNeutralSearch(this.policy.featureInput);
    const mode = this.classifyControlMode(selectionCount);
    const contact = mode === ROOT_CONTROL_MODE.TACTICAL_CONTACT;
    this.runStrictSafeThreatFireShadow(bundle, exact);
    if (contact) {
      if (exact) this.contactExactCount += 1; else this.contactInexactCount += 1;
      if (this.runtime.runtimeMode === RUNTIME_MODE.EMERGENCY)
        this.contactEmergencyCount += 1;
    }
    const valueOurCount = selectionCount;
    const hiddenProofEligible = !this.adapter.enemyVisible && this.hiddenRiskSupportComplete &&
      this.hiddenWorldCount >= 2 && this.hiddenWorldCount <= 4 &&
      this.hiddenWorldCount < this.hiddenWorldCell.length;
    if ((contact || hiddenProofEligible) && this.runtime.runtimeMode !== RUNTIME_MODE.EMERGENCY &&
        this.searchOptions.decisionDepth > 0 && this.searchOptions.proofBudget > 0) {
      // Exact visible poses keep Physical ForcedWin. Information ForcedWin is
      // a true AND over a small complete HiddenWorld set — never a singleton
      // under inexact observation (that would skip Value/Risk unsoundly).
      const proofBudget = this.availableNodeBudget(Math.min(128,
        this.searchOptions.proofBudget), this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.PROOF_NODE]);
      if (proofBudget > 0) {
        let ranProof = 0; let infoProof = 0;
        if (exact && this.adapter.enemyVisible) {
          this.lastSearchStatus = this.forcedWinSearch.search(bundle, this.ourActions,
            this.ourArguments, valueOurCount, this.enemyActions, this.enemyArguments,
            this.enemyCount, this.searchOptions.decisionDepth, proofBudget);
          ranProof = 1;
        } else if (hiddenProofEligible) {
          // Proof-eligible small complete belief without flipping
          // hiddenSupportComplete (Safety/Risk still treat the set as approximate).
          this.lastSearchStatus = this.forcedWinSearch.searchInformation(bundle,
            this.ourActions, this.ourArguments, valueOurCount, this.enemyActions,
            this.enemyArguments, this.enemyCount, this.hiddenWorldCell,
            this.hiddenWorldCount, 1, this.adapter.lastEnemyDirection,
            0, this.searchOptions.decisionDepth, proofBudget);
          ranProof = 1; infoProof = 1;
        }
        if (ranProof) {
          this.lastProofStatus = this.forcedWinSearch.lastStatus;
          this.runtime.charge(WORK_KIND.PROOF_NODE, this.forcedWinSearch.nodes);
          const forced = this.forcedWinSearch.winningRootRow;
          if (forced >= 0 && this.forcedWinSearch.lastStatus === PROOF_STATUS.PROVEN &&
              this.hardStatus[forced] === HARD_STATUS.ALLOW) {
            // Information ForcedWin AND-proves a small belief while observation
            // may remain incomplete. Keep the forced selection, but do not
            // publish Hard PROVEN (capsule strictProofOnIncomplete).
            if (infoProof) this.lastProofStatus = PROOF_STATUS.UNKNOWN;
            this.forcedWinCount += 1; this.lastScore = 100000000;
            this.score.fill(SCORE_REJECTED, 0, this.ourCount); this.score[forced] = this.lastScore;
            this.orderForEmergency();
            const selected = this.selectFinalAction(bundle, forced, selectionCount, 1);
            this.escapeObligation.activateAfterSelection(selected);
            return selected;
          }
        }
      }
    }
    // Proof work and value work share one callback reserve. Re-read the mode
    // after proof accounting and give the value stage only the nodes that fit
    // without consuming the final HardGate/emitter reserve.
    this.runtime.writeSearchOptions(this.searchOptions);
    const minimumValueWork = this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.VALUE_NODE] +
      this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.FAST_TRANSITION] +
      this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.HARD];
    const valueWorkBudget = this.availableOptionalWorkUnits();
    const valueNodeBudget = valueWorkBudget >= minimumValueWork ?
      Math.min(this.searchOptions.nodeBudget, this.depthSearch.diagnosticNodeCapacity) : 0;
    if (contact) {
      if (valueNodeBudget > 0) this.contactValueBudgetCount += 1;
      else this.contactValueBudgetBlockedCount += 1;
    }
    let nominalCombatEvidence = this.diagnosticNominalPhysicalCombatOnly ? 0 : 1;
    if (!exact && this.diagnosticVisibleNominalPhysicalSearch &&
        this.adapter.enemyVisible && this.diagnosticNominalPhysicalCombatOnly) {
      const combat = this.combat.vector;
      for (let row = 0; row < selectionCount; row += 1)
        if (combat.purposeCompleteness[row] >= 4500 &&
            (combat.directKill[row] || combat.aimSetup[row] || combat.intercept[row] ||
             combat.escapeDenial[row] || combat.shieldBreak[row] ||
             combat.possibleHit[row]) &&
            (this.ourActions[row] !== ACTION.FIRE || combat.postFireEscape[row])) {
          nominalCombatEvidence = 1; break;
        }
      if (!nominalCombatEvidence) this.nominalPhysicalScheduleBlockedCount += 1;
    }
    const nominalPhysical = !exact && this.diagnosticVisibleNominalPhysicalSearch &&
      this.adapter.enemyVisible && nominalCombatEvidence;
    const refutedPossiblePhysicalSupport = contact &&
      this.refutedPossiblePhysicalValueSupport(exact);
    if (refutedPossiblePhysicalSupport)
      this.refutedPossiblePhysicalEligibleCount += 1;
    const refutedPossiblePhysical = refutedPossiblePhysicalSupport &&
      (!this.diagnosticRefutedPossiblePhysicalCombatOnly ||
       this.refutedPossiblePhysicalChallenger(selectionCount));
    if (refutedPossiblePhysicalSupport && !refutedPossiblePhysical)
      this.refutedPossiblePhysicalCombatBlockedCount += 1;
    if (!this.diagnosticDisablePhysicalSearch && !this.optionAwareSingleSearch && contact &&
        (exact || refutedPossiblePhysical || nominalPhysical) && this.adapter.enemyVisible &&
        this.runtime.runtimeMode !== RUNTIME_MODE.EMERGENCY &&
        this.searchOptions.decisionDepth > 0 && valueNodeBudget > 0) {
      if (nominalPhysical) this.nominalPhysicalSearchCount += 1;
      if (refutedPossiblePhysical) this.refutedPossiblePhysicalSearchCount += 1;
      let physicalDomainCount = valueOurCount;
      if (this.compactPhysicalRiskFrontierEnabled) {
        for (let row = 0; row < valueOurCount; row += 1)
          this.score[row] = this.actionScore(row);
        physicalDomainCount = this.preparePhysicalSearchDomain(valueOurCount);
      }
      this.depthSearch.search(bundle, this.ourActions, this.ourArguments, valueOurCount,
        this.enemyActions, this.enemyArguments, this.enemyCount, this.searchOptions.decisionDepth,
        valueNodeBudget, this.policy.baseRisk, valueWorkBudget,
        physicalDomainCount < valueOurCount ? this.stageRowMap : null,
        physicalDomainCount);
      this.depthSearch.expandRootDomain();
      this.chargeValueSearchWork(this.depthSearch);
      if (refutedPossiblePhysical && this.depthSearch.completedDepth > 0)
        this.refutedPossiblePhysicalCompletedCount += 1;
      if (nominalPhysical && this.depthSearch.completedDepth > 0) {
        this.nominalPhysicalRootActive = 1;
        this.nominalPhysicalCompletedCount += 1;
      }
    } else {
      this.depthSearch.resetRoot();
      const informationValueHasConsumer = this.diagnosticInformationEvidenceSearch ||
        this.riskController.incompleteSearchOwnership ||
        this.riskController.softSearchProposalEvidence;
      if (contact && !exact && !informationValueHasConsumer)
        this.contactInformationConsumerBlockedCount += 1;
      if (!this.diagnosticDisableInformationSearch && informationValueHasConsumer &&
          contact && !exact &&
          this.runtime.runtimeMode !== RUNTIME_MODE.EMERGENCY &&
          this.searchOptions.decisionDepth > 0 && valueNodeBudget > 0) {
        for (let index = 0; index < this.enemyCount; index += 1)
          this.enemyActionFamilies[index] = actionFamily(this.enemyActions[index]);
        const nominalCount = this.policy.opponent.buildNominalPolicy(this.enemyActionFamilies,
          this.enemyCount, this.opponentContext(), this.informationSearch.enemyProbability);
        if (nominalCount === this.enemyCount) {
          if (this.adapter.enemyVisible && this.diagnosticLegacyInformationSearch) {
            // Diagnostic reproduction of the pre-Step-5 route: a visible pose
            // with another incomplete observation dimension uses Physical
            // bounds as approximate Information values.
            this.depthSearch.search(bundle, this.ourActions, this.ourArguments,
              valueOurCount, this.enemyActions, this.enemyArguments, this.enemyCount,
              this.searchOptions.decisionDepth, valueNodeBudget, this.policy.baseRisk,
              valueWorkBudget);
            this.chargeValueSearchWork(this.depthSearch);
            this.informationSearch.adoptPhysicalBounds(this.depthSearch);
            this.depthSearch.resetRoot();
          } else {
            // Prefer Information search for every inexact contact — including a
            // visible singleton world. A/B can independently cap it at depth 1.
            const informationDepth = this.diagnosticInformationDepthOne ||
              this.diagnosticLegacyInformationSearch ? 1 : this.searchOptions.decisionDepth;
            const infoOk = this.informationSearch.search(bundle, this.depthSearch,
              this.ourActions, this.ourArguments, valueOurCount, this.enemyActions,
              this.enemyArguments, this.enemyCount, this.hiddenWorldCell,
              this.hiddenWorldMass, this.hiddenWorldCount,
              this.hiddenSupportComplete && exact, valueNodeBudget, this.policy.baseRisk,
              this.adapter.lastEnemyDirection, this.adapter.enemyVisible,
              this.informationSearch.enemyProbability, informationDepth, valueWorkBudget);
            this.chargeValueSearchWork(this.informationSearch);
            if (!infoOk && this.adapter.enemyVisible && !this.diagnosticDisablePhysicalSearch) {
              // Fallback only: Physical approximate bound when the Information
              // matrix cannot fit. Still cannot authorize Hard or strict Proof.
              const fallbackWorkBudget = this.availableOptionalWorkUnits();
              if (fallbackWorkBudget >= minimumValueWork) {
                this.depthSearch.search(bundle, this.ourActions, this.ourArguments,
                  valueOurCount, this.enemyActions, this.enemyArguments, this.enemyCount,
                  this.searchOptions.decisionDepth, valueNodeBudget, this.policy.baseRisk,
                  fallbackWorkBudget);
                this.chargeValueSearchWork(this.depthSearch);
                this.informationSearch.adoptPhysicalBounds(this.depthSearch);
                this.depthSearch.resetRoot();
              }
            }
          }
          this.informationSearch.applyRiskEnvelopes(bundle, this.ourActions, valueOurCount,
            this.enemyActions, this.enemyCount, this.hiddenWorldCell, this.hiddenWorldMass,
            this.hiddenWorldCount, this.possibleProjectiles, this.projectedCell,
            this.policy.baseRisk, this.adapter.lastEnemyDirection,
            this.adapter.enemyVisible, this.informationSearch.enemyProbability);
        }
      }
    }
    for (let index = 0; index < this.ourCount; index += 1)
      this.score[index] = this.actionScore(index);
    const verifierPhysicalDepth = this.diagnosticRefutedPossiblePhysicalVerifierOnly &&
      refutedPossiblePhysical ? this.depthSearch.completedDepth : 0;
    if (verifierPhysicalDepth) this.depthSearch.completedDepth = 0;
    let best = this.wireProductionStageMatrix(priorRiskContinuation);
    if (verifierPhysicalDepth) this.depthSearch.completedDepth = verifierPhysicalDepth;
    this.lastScore = best >= 0 ?
      this.riskController.outcome.expectedValue[best] : SCORE_REJECTED;
    best = this.nominalPhysicalEvidenceArbiter.select(this, best, selectionCount);
    if (this.optionInformationInterval && this.optionPortfolio && contact && !exact &&
        this.adapter.enemyVisible && best >= 0 &&
        this.runtime.runtimeMode !== RUNTIME_MODE.EMERGENCY) {
      const perNode = this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.VALUE_NODE] +
        this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.FAST_TRANSITION] +
        this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.HARD];
      const intervalBudget = this.availableNodeBudget(
        this.optionInformationIntervalNodeBudget, perNode);
      if (intervalBudget > 0) {
        const probabilities = this.optionInformationInterval.information.enemyProbability;
        for (let index = 0; index < this.enemyCount; index += 1)
          this.enemyActionFamilies[index] = actionFamily(this.enemyActions[index]);
        const nominalCount = this.policy.opponent.buildNominalPolicy(this.enemyActionFamilies,
          this.enemyCount, this.opponentContext(), probabilities);
        if (nominalCount === this.enemyCount) {
          // This is dependency-projected finite-horizon support, not a claim
          // that every platform observation field is exact. The service stays
          // Shadow by default; only a complete one-ply Option interval can even
          // produce a strict-dominance proposal.
          const tacticalSupport = this.observationSafetySupportComplete() &&
            this.hiddenWorldCount === 1 && this.hiddenWorldMass[0] === 10000;
          best = this.optionInformationInterval.search(bundle, this.optionPortfolio,
            this.ourActions, this.ourArguments, selectionCount,
            this.enemyActions, this.enemyArguments, this.enemyCount,
            this.hiddenWorldCell, this.hiddenWorldMass, this.hiddenWorldCount,
            tacticalSupport, intervalBudget, this.policy.baseRisk,
            this.adapter.lastEnemyDirection, this.adapter.enemyVisible,
            probabilities, best, this.hardStatus, this.riskController.outcome,
            this.combat.vector, this.projectileAttack, this.enemyCount,
            this.escapeObligation, this.possibleProjectiles,
            this.hiddenSupportComplete && this.hiddenWorldCount === 1 &&
              this.hiddenWorldMass[0] === 10000 && this.adapter.tracker.complete &&
              (this.adapter.enemyCapabilitySupportComplete ||
               this.adapter.enemyCapabilityReason ===
                 ENEMY_CAPABILITY_REASON.CADENCE_MISMATCH),
            this.adapter.enemyCapabilityReason ===
              ENEMY_CAPABILITY_REASON.CADENCE_MISMATCH,
            this.adapter.enemyCanAct);
          this.chargeValueSearchWork(this.optionInformationInterval.information);
        }
      }
    }
    this.optionAwareSearchLastProposal = -1;
    const optionAwareRoot = this.optionAwareDepthSearch && this.optionPortfolio &&
      contact && exact && this.adapter.enemyVisible && best >= 0;
    if (optionAwareRoot) {
      const singleWorkPerNode = this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.VALUE_NODE] +
        this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.FAST_TRANSITION] +
        this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.HARD];
      const optionNodeBudget = this.optionAwareSingleSearch ?
        this.availableNodeBudget(this.optionAwareSearchNodeBudget, singleWorkPerNode) :
        this.optionAwareSearchNodeBudget;
      if (optionNodeBudget > 0) {
      const complete = this.optionAwareDepthSearch.searchPortfolio(bundle,
        this.optionPortfolio, this.ourActions, this.ourArguments, selectionCount,
        this.enemyActions, this.enemyArguments, this.enemyCount,
        this.optionAwareSearchDepth, optionNodeBudget,
        this.policy.baseRisk, best);
      if (this.optionAwareSingleSearch)
        this.chargeValueSearchWork(this.optionAwareDepthSearch);
      if (complete && this.optionAwareDepthSearch.lastStatus === OPTION_SEARCH_STATUS.COMPLETE) {
        const proposal = this.optionAwareDepthSearch.lastBestPrimitiveRow;
        const source = this.optionAwareDepthSearch.optionSourceIndex[
          this.optionAwareDepthSearch.lastBestOption];
        this.optionAwareSearchLastProposal = proposal;
        this.optionAwareSearchProposalCount += 1;
        if (this.optionAwareSearchActive && proposal >= 0 && proposal < selectionCount &&
            proposal !== best) {
          if (!optionSearchOwnableKind(this.optionAwareDepthSearch.lastBestKind)) {
            this.optionAwareSearchNonTacticalBlockedCount += 1;
            if (this.optionAwareDepthSearch.lastBestKind === 1)
              this.optionAwareSearchCommittedBlockedCount += 1;
          } else if (this.hardStatus[proposal] !== HARD_STATUS.ALLOW)
            this.optionAwareSearchHardBlockedCount += 1;
          else if (!this.riskController.outcome.acceptable[proposal] ||
              this.riskController.outcome.dominated[proposal])
            this.optionAwareSearchRiskBlockedCount += 1;
          else if (!this.optionPortfolio.supportComplete[source])
            this.optionAwareSearchIncompleteSupportCount += 1;
          else { best = proposal; this.optionAwareSearchOverrideCount += 1; }
        }
      }
      }
    }
    if (this.objectiveOptionRouter)
      best = this.objectiveOptionRouter.select(this, best, selectionCount);
    if (this.strategicPathArbiter)
      best = this.strategicPathArbiter.select(this, best, selectionCount);
    const geometryProposal = this.selectiveGeometryShadow ?
      this.selectiveGeometryShadow.evaluate(this, bundle, best, selectionCount,
        contact, exact) : -1;
    if (geometryProposal >= 0) best = geometryProposal;
    best = this.responseOption.select(best,
      this.lastControlMode === ROOT_CONTROL_MODE.COMMITTED_ESCAPE,
      this.riskController, this.ourActions, this.projectedCell,
      this.projectedDirection, this.planSketchHandle, this.policy.sketches,
      this.tacticalEnvelope, this.adapter.state);
    if (verifierPhysicalDepth)
      best = this.selectRefutedPossiblePhysicalFire(best, selectionCount);
    for (let index = 0; index < this.ourCount; index += 1) {
      if (this.hardStatus[index] === HARD_STATUS.REJECT_PROVEN ||
          this.hardStatus[index] === HARD_STATUS.REJECT_POLICY) this.score[index] = SCORE_REJECTED;
      else this.score[index] = this.riskController.outcome.expectedValue[index];
    }
    this.orderForEmergency();
    let selected = this.selectFinalAction(bundle, best, selectionCount, 0,
      geometryProposal >= 0 ? 1 : 0);
    if (this.selectiveGeometryShadow)
      this.selectiveGeometryShadow.confirmSelection(this, geometryProposal, selected);
    if (this.optionPortfolio && selected >= 0 && selected < selectionCount) {
      const action = this.ourActions[selected]; let resourceVerified = 0;
      if (action === ACTION.CAST_POISON)
        resourceVerified = this.adapter.enemyVisible && this.poisonUtility() > 0 ? 1 : 0;
      else if (action === ACTION.THROW_BOMB)
        resourceVerified = this.combat.vector.purposeCompleteness[selected] >= 4500 &&
          this.bombUtility(this.projectedCell[selected]) > 0 ? 1 : 0;
      if (this.diagnosticTypedOptionPortfolio &&
          (action === ACTION.CAST_POISON || action === ACTION.THROW_BOMB))
        resourceVerified = this.optionPortfolio.typedResourceVerified(action, selected,
          this.combat.vector, this.adapter.state, this.adapter.enemyVisible);
      this.optionPortfolio.observeSelection(selected, action, resourceVerified);
    }
    if (selected !== best) this.fallbackCount += 1;
    if (!this.lastSelectionWasStrictRescue && !this.lastSelectionWasPersistentEscape &&
        selected >= 0 && selected < selectionCount) {
      const owner = this.strategyBands.ownerForRow(selected, this.policy.strategyId);
      this.policy.commitSelectedStrategy(owner, this.rootGlobalMode());
    }
    this.responseOption.observeSelection(selected,
      this.lastSelectionWasStrictRescue || this.lastSelectionWasPersistentEscape ||
        this.lastControlMode === ROOT_CONTROL_MODE.COMMITTED_ESCAPE,
      this.ourActions, this.planSketchHandle, this.policy.sketches,
      this.adapter.state);
    this.escapeObligation.activateAfterSelection(selected);
    return selected;
  }
  selectFinalAction(bundle, preferred, selectionCount, strictProof = 0,
      exactValueProposal = 0) {
    this.lastSelectionWasStrictRescue = 0;
    this.lastSelectionWasPersistentEscape = 0;
    this.lastSelectionWasVerifiedDirectKill = 0;
    let selected = this.finalGate.select(bundle, this.ourActions, this.ourArguments,
      this.ourCount, preferred, this.orderedIndexes, this.ourCount);
    if (this.diagnosticPersistentEscapePlan && !strictProof && selected >= 0) {
      const continuation = this.escapeObligation.persistentEscapeCandidate(selected,
        this.hardStatus, selectionCount);
      if (continuation >= 0) {
        if (!this.finalGate.finalAllows(bundle, this.ourActions, this.ourArguments,
            continuation, this.ourCount)) {
          this.escapeObligation.rejectPersistentEscapeFinalHard();
        } else {
          this.finalGate.lastSelected = continuation;
          this.escapeObligation.confirmPersistentEscape();
          this.lastSelectionWasPersistentEscape = 1;
          return continuation;
        }
      }
    }
    if (this.strictCommittedRescueEnabled && selected >= 0 &&
        this.escapeObligation.supportStatus === SUPPORT_STATUS.COMPLETE) {
      const rescue = this.escapeObligation.strictRescueCandidate(selected,
        this.hardStatus, selectionCount);
      if (rescue >= 0) {
        // FinalActionGate rechecks the alternative against the unchanged root.
        // If that check cannot remain ALLOW, preserve the already validated
        // action rather than weakening Hard or trying an unproved fallback.
        if (!this.finalGate.finalAllows(bundle, this.ourActions, this.ourArguments,
            rescue, this.ourCount)) {
          this.escapeObligation.rejectStrictRescueFinalHard();
          this.strictCommittedRescueFinalRejectCount += 1;
        } else {
          this.finalGate.lastSelected = rescue;
          this.escapeObligation.confirmStrictRescue();
          this.strictCommittedRescueCount += 1;
          this.lastSelectionWasStrictRescue = 1;
          if (strictProof) this.strictProofRescueConflictCount += 1;
          return rescue;
        }
      }
    }
    if (!this.verifiedDirectKillEnabled || strictProof ||
        (exactValueProposal && selected === preferred) || selected < 0)
      return selected;
    const attack = this.verifiedDirectKillCandidate(selected, selectionCount);
    if (attack < 0 || attack === selected) return selected;
    if (!this.finalGate.finalAllows(bundle, this.ourActions, this.ourArguments,
        attack, this.ourCount)) {
      this.verifiedDirectKillFinalRejectCount += 1;
      return selected;
    }
    this.finalGate.lastSelected = attack;
    this.verifiedDirectKillOverrideCount += 1;
    if (!this.riskController.outcome.acceptable[attack])
      this.verifiedDirectKillCausalOverrideCount += 1;
    this.lastSelectionWasVerifiedDirectKill = 1;
    return attack;
  }
  betterVerifiedDirectKill(left, right) {
    if (right < 0) return 1;
    const combat = this.combat.vector;
    if (combat.enemyDoomedFirstActions[left] !== combat.enemyDoomedFirstActions[right])
      return combat.enemyDoomedFirstActions[left] >
        combat.enemyDoomedFirstActions[right] ? 1 : 0;
    if (combat.hitDeadline[left] !== combat.hitDeadline[right])
      return combat.hitDeadline[left] < combat.hitDeadline[right] ? 1 : 0;
    if (combat.ownCounterExposure[left] !== combat.ownCounterExposure[right])
      return combat.ownCounterExposure[left] <
        combat.ownCounterExposure[right] ? 1 : 0;
    if (combat.robustPressure[left] !== combat.robustPressure[right])
      return combat.robustPressure[left] > combat.robustPressure[right] ? 1 : 0;
    return left < right ? 1 : 0;
  }
  auditResidualAttackProof(row) {
    if (!this.residualAttackProof ||
        this.combat.vector.attackClosureStatus[row] !== PAC_STATUS.COMPLETE ||
        this.combat.vector.enemySurvivingFirstActions[row] < 1 ||
        this.combat.vector.enemyUnknownFirstActions[row] !== 0)
      return PROOF_STATUS.UNKNOWN;
    this.residualAttackProofCheckCount += 1;
    const status = this.residualAttackProof.searchResidual(this.adapter.bundle,
      this.ourActions[row], this.ourArguments[row],
      this.enemyActions, this.enemyArguments, this.enemyCount,
      this.projectileAttack.cellStatus, row * this.projectileAttack.maxEnemy,
      this.projectileAttack.maxEnemy, PAC_CELL.PROVEN_DOOMED, PAC_CELL.SURVIVES,
      this.residualAttackProofDepth, this.residualAttackProofBudget);
    this.residualAttackProofStatus[row] = status;
    this.residualAttackProofNodeCount += this.residualAttackProof.nodes;
    if (status === PROOF_STATUS.PROVEN) {
      this.residualAttackProofProvenCount += 1;
      if (!this.adapter.informationComplete)
        this.residualAttackProofIncompleteSupportProvenCount += 1;
    } else if (status === PROOF_STATUS.DISPROVEN)
      this.residualAttackProofDisprovenCount += 1;
    else this.residualAttackProofUnknownCount += 1;
    return status;
  }
  verifiedDirectKillCandidate(preferred, selectionCount) {
    this.verifiedDirectKillCheckCount += 1;
    const combat = this.combat.vector; const outcome = this.riskController.outcome;
    const preferredExposure = combat.ownCounterExposure[preferred];
    const preferredRobust = combat.robustPressure[preferred];
    const preferredRisk = this.possibleRisk(this.projectedCell[preferred],
      this.projectedDirection[preferred]);
    const riskLimit = 99 * Math.max(0, Math.min(100, this.policy.baseRisk | 0));
    let selected = -1;
    for (let row = 0; row < selectionCount; row += 1) {
      if (this.ourActions[row] !== ACTION.FIRE || !combat.directKill[row]) continue;
      this.verifiedDirectKillObservedCount += 1;
      if (this.hardStatus[row] !== HARD_STATUS.ALLOW) {
        this.verifiedDirectKillHardBlockedCount += 1; continue;
      }
      if (combat.attackClosureStatus[row] !== PAC_STATUS.COMPLETE) {
        this.verifiedDirectKillClosureBlockedCount += 1; continue;
      }
      if (combat.purposeCompleteness[row] < 4500) {
        this.verifiedDirectKillPurposeBlockedCount += 1; continue;
      }
      if (!combat.postFireEscape[row]) {
        this.verifiedDirectKillEscapeBlockedCount += 1; continue;
      }
      if (combat.ownCounterExposure[row] >= 10000 ||
          combat.ownCounterExposure[row] > preferredExposure) {
        this.verifiedDirectKillExposureBlockedCount += 1; continue;
      }
      if (combat.robustPressure[row] < preferredRobust) {
        this.verifiedDirectKillRobustBlockedCount += 1; continue;
      }
      // Shadow only. A residual theorem is recorded beside the row but never
      // changes Risk membership, StageMatrix input, or the selected action.
      this.auditResidualAttackProof(row);
      const risk = this.possibleRisk(this.projectedCell[row], this.projectedDirection[row]);
      const riskEligible = outcome.acceptable[row] && !outcome.dominated[row] &&
        (risk <= riskLimit || risk <= preferredRisk);
      if (!riskEligible) {
        // Cross-layer causal certificate: committed hazards prove the FIRE
        // successor viable, while complete PAC proves every enemy root
        // response doomed. It may cancel only Safety mass whose raw source is
        // future enemy FIRE; committed, possible-projectile and unattributed
        // mass stay owned by Risk.
        const committedSafe = this.escapeObligation.supportStatus === SUPPORT_STATUS.NONE ||
          (this.escapeObligation.supportStatus === SUPPORT_STATUS.COMPLETE &&
           this.escapeObligation.member[row] &&
           this.escapeObligation.successorProof[row] === SUCCESSOR_PROOF.PROVEN_VIABLE);
        const safety = this.safetyClosure.outcome;
        const base = row * SAFETY_HORIZON;
        let rawCommitted = 0; let rawPossible = 0; let rawFutureFire = 0;
        for (let depth = 0; depth < SAFETY_HORIZON; depth += 1) {
          rawCommitted = Math.min(10000,
            rawCommitted + safety.committedDeathMass[base + depth]);
          rawPossible = Math.min(10000,
            rawPossible + safety.possibleProjectileDeathMass[base + depth]);
          rawFutureFire = Math.min(10000,
            rawFutureFire + safety.futureFireDeathMass[base + depth]);
        }
        const futureFireOnly = rawFutureFire > 0 && rawCommitted === 0 &&
          rawPossible === 0 && outcome.horizonFatalMass[row] === rawFutureFire;
        const causal = committedSafe &&
          combat.enemySurvivingFirstActions[row] === 0 &&
          combat.enemyUnknownFirstActions[row] === 0 &&
          this.adapter.state.arrays[ARRAY.TANK_SHIELD_HITS][1] === 0 &&
          outcome.immediateFatalMass[row] === 0 &&
          outcome.unknownMass[row] === 0 &&
          this.possibleProjectiles.count() === 0 &&
          risk === 0 && futureFireOnly;
        if (!causal) {
          if (!futureFireOnly) this.verifiedDirectKillSourceBlockedCount += 1;
          this.verifiedDirectKillRiskBlockedCount += 1; continue;
        }
        this.verifiedDirectKillCausalCandidateCount += 1;
      }
      if (this.betterVerifiedDirectKill(row, selected)) selected = row;
    }
    if (selected >= 0) {
      this.verifiedDirectKillCandidateCount += 1;
      if (selected === preferred) this.verifiedDirectKillAlreadySelectedCount += 1;
    }
    return selected;
  }
  geometricFallback(me, enemy, game) {
    this.invalidRootCount += 1;
    if (!me || !me.tank || !game || !Array.isArray(game.map)) return ACTION.NONE;
    const position = me.tank.position; const direction = directionCode(me.tank.direction);
    if (!Array.isArray(position) || direction < 0) return ACTION.NONE;
    const x = position[0] + DX[direction]; const y = position[1] + DY[direction];
    const tile = game.map[x] && game.map[x][y];
    return tile === "." || tile === "o" ? ACTION.GO : ACTION.TURN_RIGHT;
  }
  emit(me, action, argument = NONE_CELL) {
    if (!me) return ACTION.NONE; let emitted = action;
    if (action === ACTION.GO && typeof me.go === "function") me.go();
    else if (action === ACTION.TURN_LEFT && typeof me.turn === "function") me.turn("left");
    else if (action === ACTION.TURN_RIGHT && typeof me.turn === "function") me.turn("right");
    else if (action === ACTION.FIRE && typeof me.fire === "function") me.fire();
    else if (action === ACTION.THROW_BOMB && typeof me.throwBomb === "function") me.throwBomb();
    else if (action === ACTION.CAST_POISON && typeof me.poison === "function") me.poison();
    else if (action !== ACTION.NONE && typeof me.turn === "function") { me.turn("right"); emitted = ACTION.TURN_RIGHT; }
    else emitted = ACTION.NONE;
    if (emitted !== ACTION.NONE) this.adapter.recordEmission(emitted, argument);
    return emitted;
  }
  selectNativeBasePolicy(action, argument) {
    if (!this.nativeBasePolicyRoot) return null;
    // A selected non-poison own skill already belongs to the resource
    // controller. BP68's accepted host emitted it before the external policy
    // callback, so neither value history nor intent advanced.
    const resourceOwned = action >= ACTION.CAST_SHIELD &&
      action <= ACTION.CAST_BOOST && action !== ACTION.CAST_POISON;
    if (resourceOwned) {
      this.nativeBasePolicyRootResourceSkipCount += 1;
      return null;
    }
    this.nativeBasePolicyRootCheckCount += 1;
    return this.nativeBasePolicyRoot.selectOverride(this,
      this.lastSelectedIndex, action, argument);
  }
  observeOnly(me, enemy, game, actualOwnAction = ACTION.NONE, options = {}) {
    const adapted = this.adapter.adapt(me, enemy, game); this.lastRootStatus = adapted.status;
    const action = observedActionCode(actualOwnAction);
    if (!adapted.bundle) {
      this.lastAction = action; this.lastArgument = NONE_CELL; this.decisionCount += 1;
      return this.lastRootStatus;
    }
    const newMatch = adapted.matchReset || this.runtime.matchRuntimeGeneration === 0;
    if (newMatch) {
      this.resetActionHistory(); this.opponentObservationReady = 0;
      this.policy.beginMatch(this.runtime.matchRuntimeGeneration + 1);
      this.escapeObligation.resetMatch(); this.responseOption.resetMatch();
      this.depthSearch.resetPrincipalMatch();
    } else this.updateActionHistory();
    this.updateOpponentModel(newMatch);
    this.runtime.beginCallback(adapted.frame, adapted.mapHashLo, adapted.mapHashHi,
      adapted.matchReset);
    if (newMatch) this.cacheBank.beginMatch();
    // Hidden risk is derived fact memory. It is rebuilt from observations, but
    // no strategy, plan, cache, proof, or Minimax state is restored here.
    this.prepareHiddenRisk();
    const requestedWork = options.historicalWorkUnits;
    const workUnits = Number.isSafeInteger(requestedWork) && requestedWork >= 0 ?
      requestedWork : this.runtime.runtimeConfig.WORK_CHARGES[WORK_KIND.ROOT];
    this.runtime.chargeUnits(workUnits, WORK_KIND.ROOT); this.runtime.finishCallback();
    if (action !== ACTION.NONE) this.adapter.recordEmission(action, NONE_CELL);
    this.lastAction = action; this.lastArgument = NONE_CELL; this.lastSelectedIndex = -1;
    this.decisionCount += 1; return this.lastRootStatus;
  }
  decide(me, enemy, game) {
    this.lastSelectionWasStrictRescue = 0;
    this.lastSelectionWasPersistentEscape = 0;
    this.lastSelectionWasVerifiedDirectKill = 0;
    if (this.residualAttackProofStatus)
      this.residualAttackProofStatus.fill(PROOF_STATUS.UNKNOWN);
    const adapted = this.adapter.adapt(me, enemy, game); this.lastRootStatus = adapted.status;
    let action = ACTION.NONE; let argument = NONE_CELL;
    let nativeBasePolicyOverrode = 0;
    if (!adapted.bundle) action = this.geometricFallback(me, enemy, game);
    else {
      const newMatch = adapted.matchReset || this.runtime.matchRuntimeGeneration === 0;
      if (newMatch) { this.resetActionHistory(); this.opponentObservationReady = 0;
        this.policy.beginMatch(this.runtime.matchRuntimeGeneration + 1);
        this.escapeObligation.resetMatch(); this.responseOption.resetMatch();
        this.depthSearch.resetPrincipalMatch(); }
      else this.updateActionHistory();
      this.updateOpponentModel(newMatch);
      this.runtime.beginCallback(adapted.frame, adapted.mapHashLo, adapted.mapHashHi,
        adapted.matchReset); this.runtime.charge(WORK_KIND.ROOT, 1);
      if (newMatch) this.cacheBank.beginMatch();
      try {
        if (!newMatch) this.reconcilePlans();
        this.generateActions(); const beforeRiskGate = this.riskController.gateCount;
        let selected = this.selectAction(adapted.bundle,
          adapted.informationComplete); if (selected >= 0) {
          this.auditStrictSafeThreatFireShadowSelection(selected);
          selected = this.applyStrictSafeThreatFireActive(adapted.bundle,
            selected);
          if (this.riskController.gateCount > beforeRiskGate &&
              selected < this.riskController.outcome.count &&
              this.riskController.outcome.dominated[selected]) this.riskDominatedSelectionCount += 1;
          this.validatePlanContinuations(adapted.bundle, selected);
          this.lastSelectedIndex = selected;
          action = this.ourActions[selected]; argument = this.ourArguments[selected];
        } else action = ACTION.NONE;
        this.runtime.charge(WORK_KIND.EMITTER, 1);
      } finally { this.runtime.finishCallback(); }
      const replacement = this.selectNativeBasePolicy(action, argument);
      if (replacement && Number.isSafeInteger(replacement.action) &&
          (replacement.action !== action || replacement.argument !== argument)) {
        action = replacement.action;
        argument = Number.isSafeInteger(replacement.argument) ?
          replacement.argument : argument;
        nativeBasePolicyOverrode = 1;
        this.nativeBasePolicyRootOverrideCount += 1;
      }
    }
    this.lastAction = this.emit(me, action, argument); this.lastArgument = argument;
    // BP172's accepted behavior was an external final override. Preserve that
    // state contract first: a changed action invalidates the incumbent search
    // principal and Plan instead of pretending they selected the new row.
    if (adapted.bundle && this.lastAction === action && !nativeBasePolicyOverrode)
      this.depthSearch.commitActualAction(action, argument);
    else this.depthSearch.resetPrincipalMatch();
    if (!nativeBasePolicyOverrode && !this.lastSelectionWasStrictRescue &&
        !this.lastSelectionWasPersistentEscape &&
        this.lastSelectedIndex >= 0 &&
        this.lastAction === action)
      this.commitSelectedPlan(this.lastSelectedIndex);
    this.lastSelectedIndex = -1;
    this.decisionCount += 1; return this.lastAction;
  }
}

module.exports = { ROOT_STATUS, ENEMY_CAPABILITY_REASON, INFORMATION_GAP,
  ProductionEntityTracker, ProductionObservationAdapter,
  ProductionRootEngine, productionValueSupportComplete, observedActionCode };
