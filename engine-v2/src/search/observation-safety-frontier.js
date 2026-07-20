"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { CAPACITY } = require("../generated/fast-config");
const { FastState, ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, SKILL, FAST_STATUS, TERRAIN,
  BOOST_COMPOUND_BASE, BOOST_COMPOUND_STRIDE, NONE_FRAME, NONE_CELL, DX, DY } =
  require("../abi/fast-codes");

const FRONTIER_STATUS = Object.freeze({ UNKNOWN: 0, WINDOW_SAFE: 1, NO_WITNESS: 2 });
const FRONTIER_HORIZON = 4;
// A proof that needs more simultaneous physical witnesses fails closed as
// UNKNOWN. Ninety-six slots keep the complete production root below its
// preregistered 1 MB TypedArray gate; nodeBudget remains an independent bound.
const FRONTIER_STATE_CAPACITY = 96;
const FRONTIER_GROUP_CAPACITY = SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE;

function mix32(hash, value) {
  let result = (hash ^ (value >>> 0)) >>> 0;
  result = (result + ((result << 1) >>> 0) + ((result << 4) >>> 0) +
    ((result << 7) >>> 0) + ((result << 8) >>> 0) + ((result << 24) >>> 0)) >>> 0;
  return result;
}

// Cold-owned snapshots. No FastState, TypedArray view, or JS collection is
// created while a frontier is being searched.
class SafetyPhysicalStateArena {
  constructor(capacity = FRONTIER_STATE_CAPACITY) {
    this.capacity = capacity;
    const template = new FastState(CAPACITY.MAX_MAP_WIDTH, CAPACITY.MAX_MAP_HEIGHT);
    this.buffers = new Array(template.arrays.length);
    this.length = new Uint16Array(template.arrays.length);
    for (let id = 0; id < template.arrays.length; id += 1) {
      const source = template.arrays[id]; this.length[id] = source.length;
      // Terrain is immutable except for the monotonic DIRT -> OPEN transition.
      // Store it once plus one changed-cell bit per state instead of copying a
      // full 32x32 map into every witness.
      this.buffers[id] = id === ARRAY.TERRAIN ? null :
        new source.constructor(source.length * capacity);
    }
    this.rootTerrain = new Uint8Array(CAPACITY.MAX_CELLS);
    this.terrainWords = Math.floor((CAPACITY.MAX_CELLS + 31) / 32);
    this.terrainChanged = new Uint32Array(this.terrainWords * capacity);
    this.hashLo = new Uint32Array(capacity); this.hashHi = new Uint32Array(capacity);
    this.hotAllocationCount = 0; this.highWater = 0;
  }
  beginRoot(state) {
    for (let cell = 0; cell < state.cells; cell += 1)
      this.rootTerrain[cell] = state.arrays[ARRAY.TERRAIN][cell];
    this.terrainChanged.fill(0);
    return this.save(state, 0);
  }
  save(state, slot) {
    if (slot < 0 || slot >= this.capacity) return 0;
    for (let id = 0; id < state.arrays.length; id += 1) {
      const source = state.arrays[id];
      if (id === ARRAY.TERRAIN) {
        const base = slot * this.terrainWords;
        for (let word = 0; word < this.terrainWords; word += 1)
          this.terrainChanged[base + word] = 0;
        for (let cell = 0; cell < state.cells; cell += 1)
          if (source[cell] !== this.rootTerrain[cell])
            this.terrainChanged[base + (cell >>> 5)] |= (1 << (cell & 31)) >>> 0;
        continue;
      }
      const target = this.buffers[id];
      let at = slot * this.length[id];
      for (let index = 0; index < source.length; index += 1) target[at++] = source[index];
    }
    this.hashLo[slot] = state.hashLo; this.hashHi[slot] = state.hashHi;
    if (slot + 1 > this.highWater) this.highWater = slot + 1; return 1;
  }
  load(state, slot) {
    if (slot < 0 || slot >= this.capacity) return 0;
    for (let id = 0; id < state.arrays.length; id += 1) {
      const target = state.arrays[id];
      if (id === ARRAY.TERRAIN) {
        const base = slot * this.terrainWords;
        for (let cell = 0; cell < state.cells; cell += 1)
          target[cell] = this.terrainChanged[base + (cell >>> 5)] &
            ((1 << (cell & 31)) >>> 0) ? TERRAIN.OPEN : this.rootTerrain[cell];
        continue;
      }
      const source = this.buffers[id];
      let at = slot * this.length[id];
      for (let index = 0; index < target.length; index += 1) target[index] = source[at++];
    }
    state.hashLo = this.hashLo[slot]; state.hashHi = this.hashHi[slot];
    state.deltaUsed = 0; state.eventUsed = 0; state.transitionDeltaBase = 0;
    state.transitionEventBase = 0; return 1;
  }
}

class ObservationSafetyFrontier {
  constructor() {
    this.stateArena = new SafetyPhysicalStateArena();
    const levels = FRONTIER_HORIZON + 2;
    this.ourActions = new Uint8Array(levels * SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.ourArguments = new Uint16Array(levels * SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.enemyActions = new Uint8Array(levels * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.enemyArguments = new Uint16Array(levels * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.actionCount = new Uint8Array(levels * 2);
    this.actionComplete = new Uint8Array(levels * 2);
    this.groupKey = new Uint32Array(levels * FRONTIER_GROUP_CAPACITY);
    this.groupHead = new Uint16Array(levels * FRONTIER_GROUP_CAPACITY);
    this.groupCount = new Uint16Array(levels * FRONTIER_GROUP_CAPACITY);
    this.levelGroupCount = new Uint16Array(levels);
    this.nextState = new Uint16Array(this.stateArena.capacity);
    this.nodeBudget = 0; this.nodes = 0; this.stateUsed = 0; this.rootWorldCount = 0;
    this.lastStatus = FRONTIER_STATUS.UNKNOWN; this.earliestFatalFrame = 0xff;
    this.incompleteCount = 0; this.capacityStops = 0; this.budgetStops = 0;
    this.rootRestoreFailures = 0; this.observationGroups = 0;
    this.maximumGroupWorlds = 0; this.hotAllocationCount = 0;
    this.rootLo = 0; this.rootHi = 0; this.rootMark = 0; this.currentHorizon = 0;
  }
  reset(nodeBudget) {
    this.nodeBudget = nodeBudget; this.nodes = 0; this.stateUsed = 0; this.rootWorldCount = 0;
    this.lastStatus = FRONTIER_STATUS.UNKNOWN; this.earliestFatalFrame = 0xff;
    this.incompleteCount = 0; this.capacityStops = 0; this.budgetStops = 0;
    this.observationGroups = 0; this.maximumGroupWorlds = 0;
  }
  active(a, id, seat, frame) {
    return a[id][seat] !== NONE_FRAME && a[id][seat] > frame;
  }
  canAct(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.active(a, ARRAY.TANK_FROZEN_UNTIL, seat, frame)) return 0;
    if (this.active(a, ARRAY.TANK_POISON_UNTIL, seat, frame)) {
      const applied = a[ARRAY.TANK_POISON_APPLIED][seat];
      if (applied === NONE_FRAME) return -1;
      if (((frame - applied) & 1) !== 0) return 0;
    }
    return 1;
  }
  activeProjectile(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] && a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 1;
    return 0;
  }
  activeBomb(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot] && a[ARRAY.BOMB_OWNER][slot] === seat) return 1;
    return 0;
  }
  actionOffset(level, seat) {
    return level * (seat ? SEARCH_CAPACITY.MAX_ENEMY_POLICIES :
      SEARCH_CAPACITY.MAX_OUR_ACTIONS);
  }
  countOffset(level, seat) { return level * 2 + seat; }
  push(level, seat, action, argument = NONE_CELL) {
    const maximum = seat ? SEARCH_CAPACITY.MAX_ENEMY_POLICIES : SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    const countAt = this.countOffset(level, seat); const count = this.actionCount[countAt];
    if (count >= maximum) { this.actionComplete[countAt] = 0; return 0; }
    const actions = seat ? this.enemyActions : this.ourActions;
    const args = seat ? this.enemyArguments : this.ourArguments;
    const base = this.actionOffset(level, seat);
    for (let index = 0; index < count; index += 1)
      if (actions[base + index] === action && args[base + index] === argument) return 1;
    actions[base + count] = action; args[base + count] = argument;
    this.actionCount[countAt] = count + 1; return 1;
  }
  teleportSupport(level, state, seat) {
    const a = state.arrays; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star === NONE_CELL) return 0;
    let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const x = state.x(star) + DX[direction]; const y = state.y(star) + DY[direction];
      if (x < 0 || x >= state.width || y < 0 || y >= state.height) continue;
      const cell = state.cell(x, y); const terrain = a[ARRAY.TERRAIN][cell];
      if ((terrain === TERRAIN.OPEN || terrain === TERRAIN.GRASS) &&
          cell !== a[ARRAY.TANK_CELL][seat ^ 1] && this.push(level, seat,
            ACTION.CAST_TELEPORT, cell)) count += 1;
    }
    return count;
  }
  generate(level, state, seat) {
    const countAt = this.countOffset(level, seat); this.actionCount[countAt] = 0;
    this.actionComplete[countAt] = 1;
    if (!this.push(level, seat, ACTION.NONE)) return 0;
    const actionState = this.canAct(state, seat);
    if (actionState < 0) { this.actionComplete[countAt] = 0; return 1; }
    if (!actionState) return 1;
    this.push(level, seat, ACTION.GO); this.push(level, seat, ACTION.TURN_LEFT);
    this.push(level, seat, ACTION.TURN_RIGHT);
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (!this.activeProjectile(state, seat) &&
        (a[ARRAY.TANK_FIRE_LOCK][seat] === NONE_FRAME ||
         a[ARRAY.TANK_FIRE_LOCK][seat] <= frame)) this.push(level, seat, ACTION.FIRE);
    if (!this.activeBomb(state, seat) && a[ARRAY.TANK_BOMB_READY][seat] <= frame)
      this.push(level, seat, ACTION.THROW_BOMB);
    if (this.active(a, ARRAY.TANK_BOOST_UNTIL, seat, frame)) {
      for (let pre = 0; pre < 2; pre += 1) {
        const base = BOOST_COMPOUND_BASE + pre * BOOST_COMPOUND_STRIDE;
        this.push(level, seat, base); this.push(level, seat, base + 1);
        this.push(level, seat, base + 2);
        if (!this.activeProjectile(state, seat)) this.push(level, seat, base + 3);
        if (!this.activeBomb(state, seat)) this.push(level, seat, base + 4);
      }
    }
    const skill = a[ARRAY.TANK_SKILL][seat];
    if (skill !== SKILL.NONE && a[ARRAY.TANK_SKILL_READY][seat] <= frame) {
      if (skill === SKILL.TELEPORT) {
        if (!this.teleportSupport(level, state, seat)) this.actionComplete[countAt] = 0;
      } else this.push(level, seat, ACTION.CAST_SHIELD + skill - SKILL.SHIELD);
    }
    return this.actionCount[countAt];
  }
  actionAt(level, seat, index) {
    return (seat ? this.enemyActions : this.ourActions)[this.actionOffset(level, seat) + index];
  }
  argumentAt(level, seat, index) {
    return (seat ? this.enemyArguments : this.ourArguments)[this.actionOffset(level, seat) + index];
  }
  observationKey(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME]; let hash = 0x811c9dc5;
    hash = mix32(hash, frame); hash = mix32(hash, a[ARRAY.TANK_CELL][0]);
    hash = mix32(hash, a[ARRAY.TANK_DIR][0]); hash = mix32(hash, a[ARRAY.TANK_CRASH][0]);
    hash = mix32(hash, a[ARRAY.TANK_STARS][0]);
    for (let id = ARRAY.TANK_SHIELD_HITS; id <= ARRAY.TANK_FIRE_LOCK; id += 1)
      hash = mix32(hash, (id << 16) ^ a[id][0]);
    const enemyCell = a[ARRAY.TANK_CELL][1];
    const revealed = this.active(a, ARRAY.TANK_REVEAL_UNTIL, 1, frame);
    const cloaked = this.active(a, ARRAY.TANK_CLOAK_UNTIL, 1, frame);
    const visible = revealed || (!cloaked && a[ARRAY.TERRAIN][enemyCell] !== TERRAIN.GRASS);
    hash = mix32(hash, visible ? 0x51ed : 0x91dd);
    if (visible) {
      hash = mix32(hash, enemyCell); hash = mix32(hash, a[ARRAY.TANK_DIR][1]);
      hash = mix32(hash, a[ARRAY.TANK_CRASH][1]); hash = mix32(hash, a[ARRAY.TANK_STARS][1]);
      for (let id = ARRAY.TANK_SKILL; id <= ARRAY.TANK_FIRE_LOCK; id += 1)
        hash = mix32(hash, (id << 16) ^ a[id][1]);
    }
    return hash >>> 0;
  }
  threatReachable(state, remaining) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const own = a[ARRAY.TANK_CELL][0];
    const ownSpeed = this.active(a, ARRAY.TANK_BOOST_UNTIL, 0, frame) ? 2 : 1;
    const ownReach = remaining * ownSpeed;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] && a[ARRAY.PROJECTILE_OWNER][slot] === 1) {
        let cell = a[ARRAY.PROJECTILE_CELL][slot]; const direction = a[ARRAY.PROJECTILE_DIR][slot];
        for (let tick = 0; tick < remaining * 2; tick += 1) {
          const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
          if (x < 0 || x >= state.width || y < 0 || y >= state.height) break;
          cell = state.cell(x, y); const terrain = a[ARRAY.TERRAIN][cell];
          if (terrain === TERRAIN.WALL || terrain === TERRAIN.DIRT) break;
          const distance = Math.abs(state.x(cell) - state.x(own)) +
            Math.abs(state.y(cell) - state.y(own));
          if (distance <= ownReach) return 1;
        }
      }
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot] && a[ARRAY.BOMB_EXPLODE][slot] <= frame + remaining) return 1;
    // A ready skill adds a branch; it never removes the ordinary action set.
    // Therefore a teleport threat can prove reachability early, but an
    // unusable-in-time teleport must still fall through to ordinary FIRE.
    if (a[ARRAY.TANK_SKILL][1] === SKILL.TELEPORT &&
        a[ARRAY.TANK_SKILL_READY][1] <= frame && remaining >= 2 &&
        a[ARRAY.SCALAR][SCALAR.STAR_CELL] !== NONE_CELL) return 1;
    const enemy = a[ARRAY.TANK_CELL][1];
    const dx = Math.abs(state.x(own) - state.x(enemy));
    const dy = Math.abs(state.y(own) - state.y(enemy));
    const boostActive = this.active(a, ARRAY.TANK_BOOST_UNTIL, 1, frame);
    if (!boostActive && a[ARRAY.TANK_SKILL][1] === SKILL.BOOST &&
        a[ARRAY.TANK_SKILL_READY][1] <= frame) {
      // CAST_BOOST consumes one joint frame. Later GO actions can cross two
      // cells, then FIRE consumes one more frame. This is only a conservative
      // reachability lower bound; the physical frontier validates the branch.
      const boostedAlignment = Math.floor((Math.min(dx, dy) + 1) / 2);
      if (boostedAlignment + 2 <= remaining) return 1;
    }
    const speed = boostActive ? 2 : 1;
    const alignmentActions = Math.floor((Math.min(dx, dy) + speed - 1) / speed);
    return alignmentActions + 1 <= remaining ? 1 : 0;
  }
  groupThreatReachable(bundle, head, worldCount, remaining) {
    let slot = head;
    for (let world = 0; world < worldCount; world += 1) {
      if (!this.stateArena.load(bundle.state, slot)) return -1;
      if (this.threatReachable(bundle.state, remaining)) return 1;
      slot = this.nextState[slot];
    }
    return 0;
  }
  beginGroups(level) { this.levelGroupCount[level] = 0; }
  addGroupState(level, slot, key) {
    const base = level * FRONTIER_GROUP_CAPACITY; let count = this.levelGroupCount[level];
    let group = 0;
    for (; group < count; group += 1) if (this.groupKey[base + group] === key) break;
    if (group === count) {
      if (count >= FRONTIER_GROUP_CAPACITY) return 0;
      this.groupKey[base + group] = key; this.groupHead[base + group] = slot;
      this.groupCount[base + group] = 0; this.levelGroupCount[level] = ++count;
    }
    this.nextState[slot] = this.groupHead[base + group];
    this.groupHead[base + group] = slot; this.groupCount[base + group] += 1;
    if (this.groupCount[base + group] > this.maximumGroupWorlds)
      this.maximumGroupWorlds = this.groupCount[base + group];
    return 1;
  }
  fatal(depth) {
    if (depth < this.earliestFatalFrame) this.earliestFatalFrame = depth;
    return FRONTIER_STATUS.NO_WITNESS;
  }
  expandAction(bundle, head, worldCount, remaining, level, ownAction, ownArgument) {
    const childBase = this.stateUsed; this.beginGroups(level + 1);
    let incomplete = 0; let slot = head;
    for (let world = 0; world < worldCount; world += 1) {
      if (!this.stateArena.load(bundle.state, slot)) { incomplete = 1; break; }
      const enemyCount = this.generate(level, bundle.state, 1);
      if (!this.actionComplete[this.countOffset(level, 1)]) incomplete = 1;
      for (let column = 0; column < enemyCount; column += 1) {
        const enemyAction = this.actionAt(level, 1, column);
        const enemyArgument = this.argumentAt(level, 1, column);
        const ownChance = bundle.hard.chanceAlternativeCount(0, ownAction);
        const enemyChance = bundle.hard.chanceAlternativeCount(1, enemyAction);
        for (let chance = 0; chance < ownChance * enemyChance; chance += 1) {
          if (this.nodes >= this.nodeBudget) { this.budgetStops += 1; incomplete = 1; break; }
          const status = bundle.kernel.applyFrame(ownAction, ownArgument, enemyAction,
            enemyArgument, chance % ownChance, Math.floor(chance / ownChance));
          this.nodes += 1;
          if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
            this.incompleteCount += 1; incomplete = 1; continue;
          }
          const mark = bundle.kernel.lastMark; const a = bundle.state.arrays;
          if (a[ARRAY.TANK_CRASH][0]) {
            bundle.state.undoTo(mark); this.stateUsed = childBase;
            return this.fatal(this.currentHorizon - remaining + 1);
          }
          if (!a[ARRAY.SCALAR][SCALAR.TERMINAL_CODE] && remaining > 1 &&
              (worldCount > 1 || this.threatReachable(bundle.state, remaining - 1))) {
            if (this.stateUsed >= this.stateArena.capacity ||
                !this.stateArena.save(bundle.state, this.stateUsed) ||
                !this.addGroupState(level + 1, this.stateUsed,
                  this.observationKey(bundle.state))) {
              this.capacityStops += 1; incomplete = 1;
            } else this.stateUsed += 1;
          }
          bundle.state.undoTo(mark);
        }
        if (this.nodes >= this.nodeBudget) break;
      }
      slot = this.nextState[slot];
    }
    const childEnd = this.stateUsed; let unknown = incomplete;
    const base = (level + 1) * FRONTIER_GROUP_CAPACITY;
    const groups = this.levelGroupCount[level + 1]; this.observationGroups += groups;
    for (let group = 0; group < groups; group += 1) {
      this.stateUsed = childEnd;
      const result = this.solveGroup(bundle, this.groupHead[base + group],
        this.groupCount[base + group], remaining - 1, level + 1);
      if (result === FRONTIER_STATUS.NO_WITNESS) {
        this.stateUsed = childBase; return FRONTIER_STATUS.NO_WITNESS;
      }
      if (result === FRONTIER_STATUS.UNKNOWN) unknown = 1;
    }
    this.stateUsed = childBase;
    return unknown ? FRONTIER_STATUS.UNKNOWN : FRONTIER_STATUS.WINDOW_SAFE;
  }
  solveGroup(bundle, head, worldCount, remaining, level) {
    if (remaining <= 0) return FRONTIER_STATUS.WINDOW_SAFE;
    const threat = this.groupThreatReachable(bundle, head, worldCount, remaining);
    if (threat === 0) return FRONTIER_STATUS.WINDOW_SAFE;
    if (threat < 0) return FRONTIER_STATUS.UNKNOWN;
    if (!this.stateArena.load(bundle.state, head)) return FRONTIER_STATUS.UNKNOWN;
    const ownCount = this.generate(level, bundle.state, 0);
    const complete = this.actionComplete[this.countOffset(level, 0)]; let unknown = complete ? 0 : 1;
    for (let row = 0; row < ownCount; row += 1) {
      const result = this.expandAction(bundle, head, worldCount, remaining, level,
        this.actionAt(level, 0, row), this.argumentAt(level, 0, row));
      if (result === FRONTIER_STATUS.WINDOW_SAFE) return result;
      if (result === FRONTIER_STATUS.UNKNOWN) unknown = 1;
    }
    return unknown ? FRONTIER_STATUS.UNKNOWN : FRONTIER_STATUS.NO_WITNESS;
  }
  buildRootWorlds(bundle, worldCells, worldCount, supportComplete,
      directionComplete, lastDirection) {
    const state = bundle.state; const a = state.arrays; let head = 0xffff; let count = 0;
    this.stateUsed = 1;
    if (worldCount === 1 && directionComplete &&
        worldCells[0] === a[ARRAY.TANK_CELL][1] && lastDirection === a[ARRAY.TANK_DIR][1]) {
      this.nextState[0] = 0xffff; this.rootWorldCount = 1;
      if (!supportComplete) this.incompleteCount += 1;
      return 0;
    }
    for (let world = 0; world < worldCount; world += 1) {
      const directions = directionComplete ? 1 : 4;
      for (let direction = 0; direction < directions; direction += 1) {
        if (this.stateUsed >= this.stateArena.capacity) { this.capacityStops += 1; return 0xffff; }
        a[ARRAY.TANK_CELL][1] = worldCells[world];
        a[ARRAY.TANK_DIR][1] = directionComplete ? lastDirection : direction;
        state.initializeHash(); const slot = this.stateUsed++;
        if (!this.stateArena.save(state, slot)) return 0xffff;
        this.nextState[slot] = head; head = slot; count += 1;
      }
    }
    this.rootWorldCount = count; this.stateArena.load(state, 0);
    if (!supportComplete) this.incompleteCount += 1;
    return head;
  }
  restoreRoot(state) {
    this.stateArena.load(state, 0);
    if (state.hashLo !== this.rootLo || state.hashHi !== this.rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== this.rootMark) {
      this.rootRestoreFailures += 1; return 0;
    }
    return 1;
  }
  classify(bundle, rootAction, rootArgument, worldCells, worldCount,
      supportComplete, directionComplete, lastDirection, horizon = FRONTIER_HORIZON,
      nodeBudget = 0xffff) {
    this.reset(nodeBudget);
    if (!bundle || !bundle.state || !bundle.kernel || !bundle.hard ||
        !Number.isSafeInteger(horizon) || horizon < 1 || horizon > FRONTIER_HORIZON ||
        !Number.isSafeInteger(nodeBudget) || nodeBudget < 1 || worldCount < 1 ||
        bundle.state.deltaUsed !== 0 || bundle.state.eventUsed !== 0) return this.lastStatus;
    const state = bundle.state; this.rootLo = state.hashLo; this.rootHi = state.hashHi;
    this.rootMark = state.deltaUsed * 1024 + state.eventUsed; this.currentHorizon = horizon;
    this.stateArena.highWater = 0;
    if (!this.stateArena.beginRoot(state)) return this.lastStatus;
    const head = this.buildRootWorlds(bundle, worldCells, worldCount,
      supportComplete, directionComplete, lastDirection);
    if (head === 0xffff || !this.rootWorldCount) { this.restoreRoot(state); return this.lastStatus; }
    const result = this.expandAction(bundle, head, this.rootWorldCount, horizon, 0,
      rootAction, rootArgument);
    this.lastStatus = result === FRONTIER_STATUS.WINDOW_SAFE && !supportComplete ?
      FRONTIER_STATUS.UNKNOWN : result;
    if (!this.restoreRoot(state)) this.lastStatus = FRONTIER_STATUS.UNKNOWN;
    return this.lastStatus;
  }
}

module.exports = { FRONTIER_STATUS, FRONTIER_HORIZON, FRONTIER_STATE_CAPACITY,
  SafetyPhysicalStateArena, ObservationSafetyFrontier };
