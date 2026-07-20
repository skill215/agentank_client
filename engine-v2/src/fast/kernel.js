"use strict";

const { CAPACITY, RULE } = require("../generated/fast-config");
const { FAST_STATUS, TERRAIN, ACTION, SKILL, EVENT, PHASE, TERMINAL, CHANCE,
  BOOST_COMPOUND_BASE, BOOST_COMPOUND_STRIDE, BOOST_COMPOUND_END,
  NONE_FRAME, NONE_CELL, UNKNOWN_RUNTIME, DX, DY } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");

const EFFECT_ARRAYS = Object.freeze([ARRAY.TANK_SHIELD_UNTIL, ARRAY.TANK_FROZEN_UNTIL,
  ARRAY.TANK_STUN_UNTIL, ARRAY.TANK_OVERLOAD_UNTIL, ARRAY.TANK_CLOAK_UNTIL,
  ARRAY.TANK_POISON_UNTIL, ARRAY.TANK_BOOST_UNTIL, ARRAY.TANK_REVEAL_UNTIL]);

class FastKernel {
  constructor(state) { this.state = state; this.failure = 0; this.lastMark = 0;
    this.appliedActionCount = 0; this.hardCheckedActionCount = 0; }

  fail(status) { if (!this.failure) this.failure = status; return 0; }
  set(arrayId, index, value) {
    return this.state.write(arrayId, index, value) || this.fail(FAST_STATUS.INCOMPLETE_DELTA_CAPACITY);
  }
  event(phase, type, entity = 0, source = 0, beforeCell = NONE_CELL,
      afterCell = NONE_CELL, beforeValue = 0, afterValue = 0, reason = 0) {
    return this.state.emit(phase, type, entity, source, beforeCell, afterCell,
      beforeValue, afterValue, reason) || this.fail(FAST_STATUS.INCOMPLETE_EVENT_CAPACITY);
  }
  frame() { return this.state.arrays[ARRAY.SCALAR][SCALAR.FRAME]; }
  active(frameValue) { return frameValue !== NONE_FRAME && frameValue > this.frame(); }

  expireEffects() {
    const arrays = this.state.arrays; const frame = this.frame();
    for (let seat = 0; seat < 2; seat += 1) for (let index = 0; index < EFFECT_ARRAYS.length; index += 1) {
      const arrayId = EFFECT_ARRAYS[index]; const deadline = arrays[arrayId][seat];
      if (deadline !== NONE_FRAME && deadline <= frame) {
        if (!this.set(arrayId, seat, NONE_FRAME)) return 0;
        if (arrayId === ARRAY.TANK_SHIELD_UNTIL && !this.set(ARRAY.TANK_SHIELD_HITS, seat, 0)) return 0;
        if (arrayId === ARRAY.TANK_POISON_UNTIL &&
            !this.set(ARRAY.TANK_POISON_APPLIED, seat, NONE_FRAME)) return 0;
        if (!this.event(PHASE.EXPIRY, EVENT.EFFECT_EXPIRED, seat + 1, 0,
            NONE_CELL, NONE_CELL, deadline, NONE_FRAME, arrayId)) return 0;
      }
    }
    return 1;
  }

  tankAt(cell, exceptSeat = 2) {
    const a = this.state.arrays;
    for (let seat = 0; seat < 2; seat += 1) if (seat !== exceptSeat &&
        !a[ARRAY.TANK_CRASH][seat] && a[ARRAY.TANK_CELL][seat] === cell) return seat;
    return 2;
  }

  hostileProjectileAt(seat, cell) {
    const a = this.state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] !== seat &&
          a[ARRAY.PROJECTILE_CELL][slot] === cell) return 1;
    return 0;
  }

  targetCell(cell, direction) {
    const x = this.state.x(cell) + DX[direction]; const y = this.state.y(cell) + DY[direction];
    return x < 0 || x >= this.state.width || y < 0 || y >= this.state.height ? NONE_CELL :
      this.state.cell(x, y);
  }

  preflightSharedResources() {
    const a = this.state.arrays; const frame = this.frame(); let dueBombs = 0;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot] && a[ARRAY.BOMB_EXPLODE][slot] <= frame) dueBombs += 1;
    if (dueBombs > 1) return this.fail(FAST_STATUS.UNSUPPORTED_RULE);
    for (let left = 0; left < CAPACITY.MAX_PROJECTILES; left += 1) if (a[ARRAY.PROJECTILE_ACTIVE][left]) {
      const leftTarget = this.targetCell(a[ARRAY.PROJECTILE_CELL][left], a[ARRAY.PROJECTILE_DIR][left]);
      for (let right = left + 1; right < CAPACITY.MAX_PROJECTILES; right += 1)
        if (a[ARRAY.PROJECTILE_ACTIVE][right] && leftTarget !== NONE_CELL && leftTarget ===
            this.targetCell(a[ARRAY.PROJECTILE_CELL][right], a[ARRAY.PROJECTILE_DIR][right]) &&
            (a[ARRAY.TERRAIN][leftTarget] === TERRAIN.DIRT || this.tankAt(leftTarget) !== 2))
          return this.fail(FAST_STATUS.UNSUPPORTED_RULE);
    }
    return 1;
  }

  actionPhase(seat) { return seat === 0 ? PHASE.SEAT0 : PHASE.SEAT1; }
  allocateProjectile(owner, cell, direction, group, member) {
    const a = this.state.arrays; let slot = -1;
    for (let index = 0; index < CAPACITY.MAX_PROJECTILES; index += 1)
      if (!a[ARRAY.PROJECTILE_ACTIVE][index]) { slot = index; break; }
    if (slot < 0) return this.fail(FAST_STATUS.INCOMPLETE_ENTITY_CAPACITY);
    const id = a[ARRAY.SCALAR][SCALAR.NEXT_ENTITY];
    if (!this.set(ARRAY.SCALAR, SCALAR.NEXT_ENTITY, id + 1) ||
        !this.set(ARRAY.PROJECTILE_GENERATION, slot,
          (a[ARRAY.PROJECTILE_GENERATION][slot] + 1) & 0xffff) ||
        !this.set(ARRAY.PROJECTILE_ID, slot, id) || !this.set(ARRAY.PROJECTILE_OWNER, slot, owner) ||
        !this.set(ARRAY.PROJECTILE_CELL, slot, cell) || !this.set(ARRAY.PROJECTILE_DIR, slot, direction) ||
        !this.set(ARRAY.PROJECTILE_GROUP, slot, group) || !this.set(ARRAY.PROJECTILE_MEMBER, slot, member) ||
        !this.set(ARRAY.PROJECTILE_CREATED, slot, this.frame()) ||
        !this.set(ARRAY.PROJECTILE_ACTIVE, slot, 1)) return 0;
    return this.event(this.actionPhase(owner), EVENT.PROJECTILE_CREATED, id, 0,
      NONE_CELL, cell, 0, member, member ? 2 : 1);
  }

  fire(seat) {
    const a = this.state.arrays; const frame = this.frame();
    if (this.active(a[ARRAY.TANK_FIRE_LOCK][seat])) return 1;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] && a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 1;
    const group = a[ARRAY.SCALAR][SCALAR.NEXT_ENTITY]; const direction = a[ARRAY.TANK_DIR][seat];
    const cell = a[ARRAY.TANK_CELL][seat];
    if (!this.allocateProjectile(seat, cell, direction, group, 0)) return 0;
    if (this.active(a[ARRAY.TANK_OVERLOAD_UNTIL][seat])) {
      const x = this.state.x(cell) + ((direction === 0 || direction === 2) ? 1 : 0);
      const y = this.state.y(cell) + ((direction === 1 || direction === 3) ? 1 : 0);
      if (x >= 0 && x < this.state.width && y >= 0 && y < this.state.height) {
        const second = this.state.cell(x, y);
        if (a[ARRAY.TERRAIN][second] !== TERRAIN.WALL &&
            !this.allocateProjectile(seat, second, direction, group, 1)) return 0;
      }
      if (!this.set(ARRAY.TANK_OVERLOAD_UNTIL, seat, NONE_FRAME) ||
          !this.event(this.actionPhase(seat), EVENT.EFFECT_EXPIRED, seat + 1, 0,
            NONE_CELL, NONE_CELL, 0, 0, 4)) return 0;
    }
    return 1;
  }

  move(seat, reversed) {
    const a = this.state.arrays; const before = a[ARRAY.TANK_CELL][seat];
    const original = a[ARRAY.TANK_DIR][seat]; const direction = reversed ? (original + 2) & 3 : original;
    const steps = this.active(a[ARRAY.TANK_BOOST_UNTIL][seat]) ? 2 : 1; let cell = before; let moved = 0;
    for (let step = 0; step < steps; step += 1) {
      const target = this.targetCell(cell, direction); if (target === NONE_CELL) break;
      const tile = a[ARRAY.TERRAIN][target]; if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) break;
      if (this.tankAt(target, seat) !== 2) return this.fail(FAST_STATUS.UNSUPPORTED_RULE);
      cell = target; moved += 1;
    }
    if (moved && (!this.set(ARRAY.TANK_CELL, seat, cell) ||
        !this.event(this.actionPhase(seat), EVENT.TANK_MOVED, seat + 1, 0,
          before, cell, 0, moved, reversed ? 2 : 1))) return 0;
    return 1;
  }

  placeBomb(seat) {
    const a = this.state.arrays; const frame = this.frame();
    if (a[ARRAY.TANK_BOMB_READY][seat] > frame) return 1;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot] && a[ARRAY.BOMB_OWNER][slot] === seat) return 1;
    let slot = -1; for (let index = 0; index < CAPACITY.MAX_BOMBS; index += 1)
      if (!a[ARRAY.BOMB_ACTIVE][index]) { slot = index; break; }
    if (slot < 0) return this.fail(FAST_STATUS.INCOMPLETE_ENTITY_CAPACITY);
    const id = a[ARRAY.SCALAR][SCALAR.NEXT_ENTITY]; const cell = a[ARRAY.TANK_CELL][seat];
    if (!this.set(ARRAY.SCALAR, SCALAR.NEXT_ENTITY, id + 1) ||
        !this.set(ARRAY.BOMB_GENERATION, slot, (a[ARRAY.BOMB_GENERATION][slot] + 1) & 0xffff) ||
        !this.set(ARRAY.BOMB_ID, slot, id) || !this.set(ARRAY.BOMB_OWNER, slot, seat) ||
        !this.set(ARRAY.BOMB_CELL, slot, cell) || !this.set(ARRAY.BOMB_PLACED, slot, frame) ||
        !this.set(ARRAY.BOMB_EXPLODE, slot, frame + RULE.BOMB_FUSE) ||
        !this.set(ARRAY.BOMB_ACTIVE, slot, 1)) return 0;
    return this.event(this.actionPhase(seat), EVENT.BOMB_PLACED, id, 0,
      NONE_CELL, cell, 0, frame + RULE.BOMB_FUSE, 0);
  }

  cast(seat, action, targetCell) {
    const a = this.state.arrays; const skill = action - ACTION.CAST_SHIELD + SKILL.SHIELD;
    if (a[ARRAY.TANK_SKILL][seat] !== skill) return 1;
    const frame = this.frame();
    if (a[ARRAY.TANK_SKILL_READY][seat] > frame) {
      if (skill !== SKILL.POISON) return this.fail(FAST_STATUS.UNSUPPORTED_RULE);
      return this.event(this.actionPhase(seat), EVENT.COMMAND_FAILED, seat + 1,
        0, NONE_CELL, NONE_CELL, 0, 0, 1);
    }
    const other = seat ^ 1;
    if (skill === SKILL.TELEPORT) {
      if (a[ARRAY.SCALAR][SCALAR.STAR_CELL] !== NONE_CELL &&
          targetCell === a[ARRAY.SCALAR][SCALAR.STAR_CELL])
        return this.fail(FAST_STATUS.UNSUPPORTED_RULE);
      if (targetCell === NONE_CELL || targetCell >= this.state.cells ||
          (a[ARRAY.TERRAIN][targetCell] !== TERRAIN.OPEN &&
           a[ARRAY.TERRAIN][targetCell] !== TERRAIN.GRASS) || this.tankAt(targetCell, seat) !== 2) {
        if (!this.set(ARRAY.TANK_SKILL_READY, seat, frame + RULE.SKILL_COOLDOWN[skill])) return 0;
        return this.event(this.actionPhase(seat), EVENT.COMMAND_FAILED, seat + 1,
          0, NONE_CELL, NONE_CELL, 0, 0, 2);
      }
      if (this.hostileProjectileAt(seat, targetCell)) {
        if (!this.set(ARRAY.TANK_SKILL_READY, seat, frame + RULE.SKILL_COOLDOWN[skill])) return 0;
        return this.event(this.actionPhase(seat), EVENT.COMMAND_FAILED, seat + 1,
          0, NONE_CELL, NONE_CELL, 0, 0, 2);
      }
    }
    if (!this.set(ARRAY.TANK_SKILL_READY, seat, frame + RULE.SKILL_COOLDOWN[skill]) ||
        !this.event(this.actionPhase(seat), EVENT.SKILL_CAST, seat + 1, other + 1,
          NONE_CELL, NONE_CELL, 0, skill, skill)) return 0;
    const duration = RULE.SKILL_DURATION[skill];
    if (skill === SKILL.SHIELD) {
      if (!this.set(ARRAY.TANK_SHIELD_HITS, seat, RULE.SHIELD_HITS) ||
          !this.set(ARRAY.TANK_SHIELD_UNTIL, seat, frame + duration)) return 0;
    } else if (skill === SKILL.FREEZE) {
      if (!this.set(ARRAY.TANK_FROZEN_UNTIL, other, frame + duration)) return 0;
    } else if (skill === SKILL.STUN) {
      if (!this.set(ARRAY.TANK_STUN_UNTIL, other, frame + duration)) return 0;
    } else if (skill === SKILL.OVERLOAD) {
      if (!this.set(ARRAY.TANK_OVERLOAD_UNTIL, seat, frame + duration)) return 0;
    } else if (skill === SKILL.CLOAK) {
      if (!this.set(ARRAY.TANK_CLOAK_UNTIL, seat, frame + duration)) return 0;
    } else if (skill === SKILL.POISON) {
      if (!this.set(ARRAY.TANK_POISON_APPLIED, other, frame) ||
          !this.set(ARRAY.TANK_POISON_UNTIL, other, frame + duration)) return 0;
    } else if (skill === SKILL.BOOST) {
      if (!this.set(ARRAY.TANK_BOOST_UNTIL, seat, frame + duration)) return 0;
    } else if (skill === SKILL.TELEPORT) {
      const before = a[ARRAY.TANK_CELL][seat];
      if (!this.set(ARRAY.TANK_CELL, seat, targetCell) ||
          !this.set(ARRAY.TANK_PICKUP_LOCK, seat, frame + RULE.TELEPORT_PICKUP_LOCK) ||
          !this.set(ARRAY.TANK_REVEAL_UNTIL, seat, frame + 1)) return 0;
      const distance = Math.abs(this.state.x(targetCell) - this.state.x(a[ARRAY.TANK_CELL][other])) +
        Math.abs(this.state.y(targetCell) - this.state.y(a[ARRAY.TANK_CELL][other]));
      if (distance <= RULE.TELEPORT_NEAR_DISTANCE &&
          !this.set(ARRAY.TANK_FIRE_LOCK, seat, frame + RULE.TELEPORT_FIRE_LOCK)) return 0;
      if (!this.event(this.actionPhase(seat), EVENT.TANK_MOVED, seat + 1, 0,
          before, targetCell, 0, 0, 3)) return 0;
    }
    return this.event(this.actionPhase(seat), EVENT.SKILL_APPLIED, seat + 1, 0,
      NONE_CELL, NONE_CELL, 0, duration, skill);
  }

  executePrimitive(seat, action, argument, reversed) {
    let actual = action; let reversedMove = 0;
    if (reversed) {
      if (action === ACTION.GO) reversedMove = 1;
      else if (action === ACTION.TURN_LEFT) actual = ACTION.TURN_RIGHT;
      else if (action === ACTION.TURN_RIGHT) actual = ACTION.TURN_LEFT;
    }
    if (actual === ACTION.GO) { if (!this.move(seat, reversedMove)) return 0; }
    else if (actual === ACTION.TURN_LEFT || actual === ACTION.TURN_RIGHT) {
      const a = this.state.arrays; const before = a[ARRAY.TANK_DIR][seat]; const after = (before +
        (actual === ACTION.TURN_LEFT ? 3 : 1)) & 3;
      if (!this.set(ARRAY.TANK_DIR, seat, after) ||
          !this.event(this.actionPhase(seat), EVENT.TANK_TURNED, seat + 1,
            0, NONE_CELL, NONE_CELL, before, after, 0)) return 0;
    } else if (actual === ACTION.FIRE) { if (!this.fire(seat)) return 0; }
    else if (actual === ACTION.THROW_BOMB) { if (!this.placeBomb(seat)) return 0; }
    else if (actual >= ACTION.CAST_SHIELD && actual <= ACTION.CAST_BOOST) {
      if (!this.cast(seat, actual, argument)) return 0;
    } else return this.fail(FAST_STATUS.INCOMPLETE_STATE);
    this.appliedActionCount += 1;
    return this.event(this.actionPhase(seat), EVENT.COMMAND_EXECUTED, seat + 1,
      0, NONE_CELL, NONE_CELL, action, actual, 0);
  }

  executeSeat(seat, action, argument, chance) {
    const a = this.state.arrays; const frame = this.frame();
    if (a[ARRAY.TANK_CRASH][seat]) return 1;
    // A held command is not executed or dequeued. ACTION.NONE is also a valid
    // production representation when the platform says this seat cannot act.
    if (this.active(a[ARRAY.TANK_FROZEN_UNTIL][seat])) return 1;
    if (this.active(a[ARRAY.TANK_POISON_UNTIL][seat])) {
      const applied = a[ARRAY.TANK_POISON_APPLIED][seat];
      if (applied === NONE_FRAME) return this.fail(FAST_STATUS.INCOMPLETE_STATE);
      if (((frame - applied) & 1) !== 0) return 1;
    }
    if (action === ACTION.NONE) return 1;
    const stunned = this.active(a[ARRAY.TANK_STUN_UNTIL][seat]);
    if (stunned && chance === CHANCE.MISSING) return this.fail(FAST_STATUS.INCOMPLETE_STATE);
    if (action >= BOOST_COMPOUND_BASE && action <= BOOST_COMPOUND_END) {
      if (!this.active(a[ARRAY.TANK_BOOST_UNTIL][seat]))
        return this.fail(FAST_STATUS.UNSUPPORTED_RULE);
      const offset = action - BOOST_COMPOUND_BASE;
      const preTurn = offset < BOOST_COMPOUND_STRIDE ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
      const mainIndex = offset % BOOST_COMPOUND_STRIDE;
      const main = mainIndex === 0 ? ACTION.GO : mainIndex === 1 ? ACTION.TURN_LEFT :
        mainIndex === 2 ? ACTION.TURN_RIGHT : mainIndex === 3 ? ACTION.FIRE : ACTION.THROW_BOMB;
      if (!this.executePrimitive(seat, preTurn, NONE_CELL, stunned && (chance & 1))) return 0;
      return this.executePrimitive(seat, main, argument, stunned && (chance & 2));
    }
    const reversed = stunned && chance === CHANCE.REVERSED;
    return this.executePrimitive(seat, action, argument, reversed);
  }

  collectStar() {
    const a = this.state.arrays; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star === NONE_CELL) return 1; let collector = 2;
    for (let seat = 0; seat < 2; seat += 1) if (!a[ARRAY.TANK_CRASH][seat] &&
        a[ARRAY.TANK_CELL][seat] === star && !this.active(a[ARRAY.TANK_PICKUP_LOCK][seat])) {
      if (collector !== 2) return this.fail(FAST_STATUS.UNSUPPORTED_RULE); collector = seat;
    }
    if (collector === 2) return 1;
    const stars = a[ARRAY.TANK_STARS][collector];
    return this.set(ARRAY.TANK_STARS, collector, stars + 1) &&
      this.set(ARRAY.SCALAR, SCALAR.STAR_CELL, NONE_CELL) &&
      this.event(PHASE.STAR, EVENT.STAR_COLLECTED, collector + 1,
        0, star, NONE_CELL, stars, stars + 1, 0);
  }

  destroyProjectile(slot, reason) {
    const a = this.state.arrays;
    return this.set(ARRAY.PROJECTILE_ACTIVE, slot, 0) &&
      this.event(reason >= 10 ? PHASE.PROJECTILE1 : PHASE.PROJECTILE0,
        EVENT.PROJECTILE_DESTROYED, a[ARRAY.PROJECTILE_ID][slot], 0,
        a[ARRAY.PROJECTILE_CELL][slot], NONE_CELL, 1, 0, reason);
  }

  projectileHitTank(slot, seat, phase, substep) {
    const a = this.state.arrays; const id = a[ARRAY.PROJECTILE_ID][slot];
    if (this.active(a[ARRAY.TANK_SHIELD_UNTIL][seat]) && a[ARRAY.TANK_SHIELD_HITS][seat] > 0) {
      const before = a[ARRAY.TANK_SHIELD_HITS][seat];
      if (!this.set(ARRAY.TANK_SHIELD_HITS, seat, before - 1) ||
          !this.event(phase, EVENT.SHIELD_HIT, seat + 1, id,
            NONE_CELL, NONE_CELL, before, before - 1, 1)) return 0;
      if (before === 1 && !this.set(ARRAY.TANK_SHIELD_UNTIL, seat, NONE_FRAME)) return 0;
    } else if (!this.set(ARRAY.TANK_CRASH, seat, 1) ||
        !this.event(phase, EVENT.TANK_CRASHED, seat + 1, id,
          NONE_CELL, NONE_CELL, 0, 1, substep)) return 0;
    return 1;
  }

  advanceProjectiles() {
    const a = this.state.arrays;
    for (let substep = 0; substep < RULE.PROJECTILE_STEPS; substep += 1) {
      const phase = substep ? PHASE.PROJECTILE1 : PHASE.PROJECTILE0;
      for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1) if (a[ARRAY.PROJECTILE_ACTIVE][slot]) {
        const before = a[ARRAY.PROJECTILE_CELL][slot];
        const target = this.targetCell(before, a[ARRAY.PROJECTILE_DIR][slot]);
        if (target === NONE_CELL) { if (!this.destroyProjectile(slot, substep ? 10 : 0)) return 0; continue; }
        if (!this.set(ARRAY.PROJECTILE_CELL, slot, target) ||
            !this.event(phase, EVENT.PROJECTILE_MOVED, a[ARRAY.PROJECTILE_ID][slot],
              0, before, target, 0, 0, substep)) return 0;
        const tile = a[ARRAY.TERRAIN][target];
        if (tile === TERRAIN.WALL) { if (!this.destroyProjectile(slot, substep ? 11 : 1)) return 0; continue; }
        if (tile === TERRAIN.DIRT) {
          if (!this.set(ARRAY.TERRAIN, target, TERRAIN.OPEN) ||
              !this.set(ARRAY.SCALAR, SCALAR.TERRAIN_VERSION,
                a[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION] + 1) ||
              !this.set(ARRAY.SCALAR, SCALAR.TOPOLOGY_VERSION,
                a[ARRAY.SCALAR][SCALAR.TOPOLOGY_VERSION] + 1) ||
              !this.event(phase, EVENT.TERRAIN_DESTROYED, 0,
                a[ARRAY.PROJECTILE_ID][slot], target, target, TERRAIN.DIRT, TERRAIN.OPEN, 1) ||
              !this.destroyProjectile(slot, substep ? 12 : 2)) return 0;
          continue;
        }
        const tank = this.tankAt(target);
        if (tank !== 2 && (!this.projectileHitTank(slot, tank, phase, substep) ||
            !this.destroyProjectile(slot, substep ? 13 : 3))) return 0;
      }
    }
    return 1;
  }

  bombHitsCell(center, candidate) {
    const cx = this.state.x(center); const cy = this.state.y(center);
    const tx = this.state.x(candidate); const ty = this.state.y(candidate);
    if (cx === tx && cy === ty) return 1;
    if (cx !== tx && cy !== ty) return 0;
    const distance = Math.abs(cx - tx) + Math.abs(cy - ty); if (distance > RULE.BOMB_RANGE) return 0;
    const dx = tx === cx ? 0 : tx > cx ? 1 : -1; const dy = ty === cy ? 0 : ty > cy ? 1 : -1;
    for (let step = 1; step <= distance; step += 1) {
      const cell = this.state.cell(cx + dx * step, cy + dy * step);
      if (this.state.arrays[ARRAY.TERRAIN][cell] === TERRAIN.WALL) return 0;
      if (this.state.arrays[ARRAY.TERRAIN][cell] === TERRAIN.DIRT) return step === distance ? 1 : 0;
    }
    return 1;
  }

  resolveBombs() {
    const a = this.state.arrays; const frame = this.frame();
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1) if (a[ARRAY.BOMB_ACTIVE][slot] &&
        a[ARRAY.BOMB_EXPLODE][slot] <= frame) {
      const center = a[ARRAY.BOMB_CELL][slot]; const id = a[ARRAY.BOMB_ID][slot];
      if (!this.set(ARRAY.BOMB_ACTIVE, slot, 0) ||
          !this.event(PHASE.BOMB, EVENT.BOMB_EXPLODED, id, 0,
            center, NONE_CELL, 1, 0, 0)) return 0;
      for (let cell = 0; cell < this.state.cells; cell += 1) if (this.bombHitsCell(center, cell)) {
        if (a[ARRAY.TERRAIN][cell] === TERRAIN.DIRT &&
            (!this.set(ARRAY.TERRAIN, cell, TERRAIN.OPEN) ||
             !this.set(ARRAY.SCALAR, SCALAR.TERRAIN_VERSION,
               a[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION] + 1) ||
             !this.set(ARRAY.SCALAR, SCALAR.TOPOLOGY_VERSION,
               a[ARRAY.SCALAR][SCALAR.TOPOLOGY_VERSION] + 1) ||
             !this.event(PHASE.BOMB, EVENT.TERRAIN_DESTROYED, 0, id,
               cell, cell, TERRAIN.DIRT, TERRAIN.OPEN, 2))) return 0;
        const tank = this.tankAt(cell);
        if (tank !== 2) {
          const shielded = this.active(a[ARRAY.TANK_SHIELD_UNTIL][tank]) &&
            a[ARRAY.TANK_SHIELD_HITS][tank] > 0;
          if (shielded) {
            const before = a[ARRAY.TANK_SHIELD_HITS][tank];
            if (!this.set(ARRAY.TANK_SHIELD_HITS, tank, 0) ||
                !this.set(ARRAY.TANK_SHIELD_UNTIL, tank, NONE_FRAME) ||
                !this.event(PHASE.BOMB, EVENT.SHIELD_HIT, tank + 1, id,
                  NONE_CELL, NONE_CELL, before, 0, 2)) return 0;
          } else if (!this.set(ARRAY.TANK_CRASH, tank, 1) ||
              !this.event(PHASE.BOMB, EVENT.TANK_CRASHED, tank + 1, id,
                NONE_CELL, NONE_CELL, 0, 1, 2)) return 0;
        }
      }
      if (!this.set(ARRAY.TANK_BOMB_READY, a[ARRAY.BOMB_OWNER][slot], frame + RULE.BOMB_COOLDOWN)) return 0;
    }
    return 1;
  }

  resolveTerminal() {
    const a = this.state.arrays; const scalar = a[ARRAY.SCALAR]; let trigger = 0;
    let winner = 2;
    if (scalar[SCALAR.SCRIPT_ERROR_SEAT] < 2) { trigger = 1; winner = scalar[SCALAR.SCRIPT_ERROR_SEAT] ^ 1; }
    else if (scalar[SCALAR.TIMEOUT_SEAT] < 2) { trigger = 2; winner = scalar[SCALAR.TIMEOUT_SEAT] ^ 1; }
    else {
      const crash0 = a[ARRAY.TANK_CRASH][0]; const crash1 = a[ARRAY.TANK_CRASH][1];
      if (crash0 !== crash1) { trigger = 3; winner = crash0 ? 1 : 0; }
      else if ((crash0 && crash1) || scalar[SCALAR.RECORD] >= RULE.FRAME_RECORD_LIMIT - 1) {
        trigger = crash0 ? 4 : 5;
        if (a[ARRAY.TANK_STARS][0] !== a[ARRAY.TANK_STARS][1])
          winner = a[ARRAY.TANK_STARS][0] > a[ARRAY.TANK_STARS][1] ? 0 : 1;
        else if (a[ARRAY.TANK_RUNTIME][0] === UNKNOWN_RUNTIME ||
            a[ARRAY.TANK_RUNTIME][1] === UNKNOWN_RUNTIME) return this.fail(FAST_STATUS.INCOMPLETE_STATE);
        else if (a[ARRAY.TANK_RUNTIME][0] !== a[ARRAY.TANK_RUNTIME][1])
          winner = a[ARRAY.TANK_RUNTIME][0] < a[ARRAY.TANK_RUNTIME][1] ? 0 : 1;
        else return this.fail(FAST_STATUS.UNSUPPORTED_RULE);
      }
    }
    if (!trigger) return 1;
    const code = winner === 0 ? TERMINAL.WIN0 : winner === 1 ? TERMINAL.WIN1 : TERMINAL.DRAW;
    return this.set(ARRAY.SCALAR, SCALAR.TERMINAL_CODE, code) &&
      this.set(ARRAY.SCALAR, SCALAR.WINNER_SEAT, winner) &&
      this.event(PHASE.TERMINAL, EVENT.TERMINAL_RESOLVED, 0,
        0, NONE_CELL, NONE_CELL, 0, winner, trigger);
  }

  applyFrame(action0 = ACTION.NONE, arg0 = NONE_CELL, action1 = ACTION.NONE,
      arg1 = NONE_CELL, chance0 = CHANCE.NORMAL, chance1 = CHANCE.NORMAL) {
    const state = this.state; const mark = state.beginTransition(); this.lastMark = mark; this.failure = 0;
    if (state.deltaArray.length - state.deltaUsed < CAPACITY.MAX_DELTAS_PER_TRANSITION) this.failure =
      FAST_STATUS.INCOMPLETE_DELTA_CAPACITY;
    else if (state.eventPhase.length - state.eventUsed < CAPACITY.MAX_EVENTS_PER_TRANSITION) this.failure =
      FAST_STATUS.INCOMPLETE_EVENT_CAPACITY;
    else if (!this.preflightSharedResources() || !this.expireEffects() ||
        !this.executeSeat(0, action0, arg0, chance0) || !this.executeSeat(1, action1, arg1, chance1) ||
        !this.collectStar() || !this.advanceProjectiles() || !this.resolveBombs() ||
        !this.resolveTerminal()) { /* failure already classified */ }
    if (this.failure) { state.undoTo(mark); return this.failure; }
    const terminal = state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    if (!terminal && (!this.set(ARRAY.SCALAR, SCALAR.FRAME, this.frame() + 1) ||
        !this.set(ARRAY.SCALAR, SCALAR.RECORD,
          state.arrays[ARRAY.SCALAR][SCALAR.RECORD] + 1) ||
        !this.set(ARRAY.SCALAR, SCALAR.STATE_VERSION,
          state.arrays[ARRAY.SCALAR][SCALAR.STATE_VERSION] + 1))) {
      const status = this.failure || FAST_STATUS.INCOMPLETE_DELTA_CAPACITY;
      state.undoTo(mark); return status;
    }
    return terminal ? FAST_STATUS.APPLIED_TERMINAL : FAST_STATUS.APPLIED;
  }

  undoLast() { return this.state.undoTo(this.lastMark); }
}

module.exports = { FastKernel };
