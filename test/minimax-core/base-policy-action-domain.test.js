"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { ACTION, SKILL, TERRAIN, NONE_FRAME, NONE_CELL } = require(
  "../../engine-v2/src/abi/fast-codes");
const { NativeBasePolicyActionDomain } = require(
  "../../engine-v2/src/base-policy/action-domain");
const { NativeTacticalDomainPoc } = require(
  "../../tools/agentank/diagnostics/native-tactical-domain-evaluator-poc");

function random(seed) {
  seed.value ^= seed.value << 13;
  seed.value ^= seed.value >>> 17;
  seed.value ^= seed.value << 5;
  return seed.value >>> 0;
}

function randomState(seed) {
  const state = new FastState(10, 10); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  for (let cell = 0; cell < state.cells; cell += 1) {
    const value = random(seed) % 24;
    if (value === 0) a[ARRAY.TERRAIN][cell] = TERRAIN.WALL;
    else if (value === 1) a[ARRAY.TERRAIN][cell] = TERRAIN.DIRT;
    else if (value === 2) a[ARRAY.TERRAIN][cell] = TERRAIN.GRASS;
  }
  let own = random(seed) % state.cells;
  let enemy = random(seed) % state.cells;
  if (enemy === own) enemy = (enemy + 1) % state.cells;
  a[ARRAY.TANK_CELL][0] = own; a[ARRAY.TANK_CELL][1] = enemy;
  a[ARRAY.TERRAIN][own] = TERRAIN.OPEN; a[ARRAY.TERRAIN][enemy] = TERRAIN.OPEN;
  a[ARRAY.TANK_DIR][0] = random(seed) & 3;
  a[ARRAY.TANK_DIR][1] = random(seed) & 3;
  const frame = random(seed) % 128;
  a[ARRAY.SCALAR][SCALAR.FRAME] = frame;
  a[ARRAY.TANK_STARS][0] = random(seed) % 5;
  a[ARRAY.TANK_STARS][1] = random(seed) % 5;
  a[ARRAY.TANK_FIRE_LOCK][0] = NONE_FRAME;
  a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.TANK_FROZEN_UNTIL][0] = random(seed) % 9 === 0 ? frame + 2 : NONE_FRAME;
  a[ARRAY.TANK_POISON_UNTIL][0] = random(seed) % 11 === 0 ? frame + 2 : NONE_FRAME;
  a[ARRAY.TANK_STUN_UNTIL][1] = random(seed) % 7 === 0 ? frame + 3 : NONE_FRAME;
  a[ARRAY.TANK_BOOST_UNTIL][0] = random(seed) % 6 === 0 ? frame + 3 : NONE_FRAME;
  a[ARRAY.TANK_BOMB_READY][0] = random(seed) % 5 === 0 ? frame + 3 : frame;
  a[ARRAY.TANK_SKILL][1] = 1 + random(seed) % SKILL.BOOST;
  a[ARRAY.TANK_SKILL_READY][1] = random(seed) % 3 === 0 ? frame + 2 : frame;
  if (random(seed) % 4 === 0) {
    let star = random(seed) % state.cells;
    a[ARRAY.TERRAIN][star] = TERRAIN.OPEN;
    a[ARRAY.SCALAR][SCALAR.STAR_CELL] = star;
  } else a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  if (random(seed) % 5 === 0) {
    a[ARRAY.PROJECTILE_ACTIVE][0] = 1;
    a[ARRAY.PROJECTILE_OWNER][0] = random(seed) & 1;
    a[ARRAY.PROJECTILE_CELL][0] = random(seed) % state.cells;
    a[ARRAY.PROJECTILE_DIR][0] = random(seed) & 3;
  }
  if (random(seed) % 7 === 0) {
    a[ARRAY.BOMB_ACTIVE][0] = 1;
    a[ARRAY.BOMB_CELL][0] = random(seed) % state.cells;
  }
  return state;
}

test("thin resource domain is state-equivalent to BP68 mode 2", () => {
  const actions = [ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT, ACTION.TURN_RIGHT,
    ACTION.THROW_BOMB, ACTION.CAST_SHIELD, ACTION.CAST_FREEZE,
    ACTION.CAST_STUN, ACTION.CAST_OVERLOAD, ACTION.CAST_CLOAK,
    ACTION.CAST_POISON, ACTION.CAST_TELEPORT, ACTION.CAST_BOOST, ACTION.NONE];
  const seed = { value: 0x15768b01 };
  for (let index = 0; index < 2048; index += 1) {
    const state = randomState(seed);
    const legacy = new NativeTacticalDomainPoc(2);
    const thin = new NativeBasePolicyActionDomain();
    assert.equal(thin.qualifiedFireForSeat(state, 0),
      legacy.qualifiedFireForSeat(state, 0), `own FIRE mismatch at state ${index}`);
    assert.equal(thin.qualifiedFireForSeat(state, 1),
      legacy.qualifiedFireForSeat(state, 1), `enemy FIRE mismatch at state ${index}`);
    for (const action of actions) {
      const engine = { adapter: { state }, ourActions: Uint8Array.of(action) };
      assert.equal(thin.allows(engine, 0), legacy.allows(engine, 0),
        `domain mismatch at state ${index}, action ${action}`);
    }
  }
});

test("thin resource domain owns fixed scratch and reports no hot allocation", () => {
  const domain = new NativeBasePolicyActionDomain();
  assert.ok(domain.bombDistance instanceof Uint8Array);
  assert.ok(domain.bombQueue instanceof Uint16Array);
  assert.ok(domain.bombPoseStamp instanceof Uint16Array);
  assert.equal(domain.summary().hotAllocationCount, 0);
});
