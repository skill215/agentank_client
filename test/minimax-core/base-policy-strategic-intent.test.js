"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { ACTION, SKILL, TERRAIN, NONE_FRAME, NONE_CELL } = require(
  "../../engine-v2/src/abi/fast-codes");
const { NativeBasePolicyStrategicIntent } = require(
  "../../engine-v2/src/base-policy/strategic-intent");
const { NativeTacticalIntentPoc } = require(
  "../../tools/agentank/diagnostics/native-tactical-domain-evaluator-poc");

const ACTIONS = Uint8Array.of(ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT,
  ACTION.TURN_RIGHT, ACTION.THROW_BOMB, ACTION.CAST_SHIELD,
  ACTION.CAST_FREEZE, ACTION.CAST_STUN, ACTION.CAST_OVERLOAD,
  ACTION.CAST_CLOAK, ACTION.CAST_POISON, ACTION.CAST_TELEPORT,
  ACTION.CAST_BOOST);

function random(seed) {
  seed.value ^= seed.value << 13;
  seed.value ^= seed.value >>> 17;
  seed.value ^= seed.value << 5;
  return seed.value >>> 0;
}

function directionTo(state, from, target) {
  const fx = state.x(from); const fy = state.y(from);
  const tx = state.x(target); const ty = state.y(target);
  if (fx === tx) return ty < fy ? 0 : ty > fy ? 2 : -1;
  if (fy === ty) return tx > fx ? 1 : 3;
  return -1;
}

function clearLine(state, from, target) {
  const direction = directionTo(state, from, target);
  if (direction < 0) return 0;
  const dx = direction === 1 ? 1 : direction === 3 ? -1 : 0;
  const dy = direction === 2 ? 1 : direction === 0 ? -1 : 0;
  let x = state.x(from) + dx; let y = state.y(from) + dy;
  const tx = state.x(target); const ty = state.y(target);
  while (x !== tx || y !== ty) {
    const tile = state.arrays[ARRAY.TERRAIN][state.cell(x, y)];
    if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
    x += dx; y += dy;
  }
  return 1;
}

function makeEngine(seed, index) {
  const width = 8 + random(seed) % 5;
  const height = 8 + random(seed) % 5;
  const state = new FastState(width, height); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  for (let cell = 0; cell < state.cells; cell += 1) {
    const value = random(seed) % 30;
    if (value === 0) a[ARRAY.TERRAIN][cell] = TERRAIN.WALL;
    else if (value === 1) a[ARRAY.TERRAIN][cell] = TERRAIN.DIRT;
    else if (value === 2) a[ARRAY.TERRAIN][cell] = TERRAIN.GRASS;
  }
  let own = random(seed) % state.cells;
  let enemy = random(seed) % state.cells;
  if (enemy === own) enemy = (enemy + 1) % state.cells;
  a[ARRAY.TERRAIN][own] = TERRAIN.OPEN;
  a[ARRAY.TERRAIN][enemy] = TERRAIN.OPEN;
  a[ARRAY.TANK_CELL][0] = own; a[ARRAY.TANK_CELL][1] = enemy;
  a[ARRAY.TANK_DIR][0] = random(seed) & 3;
  a[ARRAY.TANK_DIR][1] = random(seed) & 3;
  const frame = index & 127;
  a[ARRAY.SCALAR][SCALAR.FRAME] = frame;
  a[ARRAY.TANK_FIRE_LOCK][0] = random(seed) % 9 === 0 ? frame + 2 : NONE_FRAME;
  a[ARRAY.TANK_FIRE_LOCK][1] = random(seed) % 7 === 0 ? frame + 2 : NONE_FRAME;
  a[ARRAY.TANK_SHIELD_UNTIL][0] = NONE_FRAME;
  a[ARRAY.TANK_SHIELD_UNTIL][1] = random(seed) % 11 === 0 ? frame + 3 : NONE_FRAME;
  a[ARRAY.TANK_SHIELD_HITS][1] = random(seed) & 1;
  a[ARRAY.TANK_BOOST_UNTIL][0] = random(seed) % 8 === 0 ? frame + 3 : NONE_FRAME;
  a[ARRAY.TANK_BOOST_UNTIL][1] = random(seed) % 6 === 0 ? frame + 3 : NONE_FRAME;
  a[ARRAY.TANK_OVERLOAD_UNTIL][1] = random(seed) % 10 === 0 ? frame + 3 : NONE_FRAME;
  a[ARRAY.TANK_STUN_UNTIL][1] = random(seed) % 12 === 0 ? frame + 3 : NONE_FRAME;
  a[ARRAY.TANK_SKILL][1] = 1 + random(seed) % SKILL.BOOST;
  a[ARRAY.TANK_STARS][0] = random(seed) % 6;
  a[ARRAY.TANK_STARS][1] = random(seed) % 6;
  if (random(seed) % 3 === 0) {
    const star = random(seed) % state.cells;
    a[ARRAY.TERRAIN][star] = TERRAIN.OPEN;
    a[ARRAY.SCALAR][SCALAR.STAR_CELL] = star;
  } else a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  const projectileCount = random(seed) % 4;
  for (let slot = 0; slot < projectileCount; slot += 1) {
    a[ARRAY.PROJECTILE_ACTIVE][slot] = 1;
    a[ARRAY.PROJECTILE_OWNER][slot] = random(seed) & 1;
    a[ARRAY.PROJECTILE_CELL][slot] = random(seed) % state.cells;
    a[ARRAY.PROJECTILE_DIR][slot] = random(seed) & 3;
  }
  if (random(seed) % 5 === 0) {
    a[ARRAY.BOMB_ACTIVE][0] = 1;
    a[ARRAY.BOMB_CELL][0] = random(seed) % state.cells;
  }
  return {
    adapter: { state, enemyVisible: random(seed) % 5 !== 0 },
    ourActions: ACTIONS,
    directionTo: (from, target) => directionTo(state, from, target),
    clearLine: (from, target) => clearLine(state, from, target),
    manhattan: (from, target) => Math.abs(state.x(from) - state.x(target)) +
      Math.abs(state.y(from) - state.y(target))
  };
}

function assertStateEqual(thin, legacy, index) {
  for (const key of ["contextEpoch", "lastContextSignature", "lastIntent",
    "lastIntentEpoch", "currentProposed", "currentCommitted",
    "currentCommittedAction", "committed", "target", "prepareCount",
    "attackCount", "starCount", "edgeCount", "faceCount", "evadeCount",
    "continuityCount", "switchCount", "contextChangeCount", "bonusRowCount",
    "mappingActionCount", "mappingMissingRowCount"])
    assert.equal(thin[key], legacy[key], `${key} mismatch at root ${index}`);
  assert.deepEqual(Array.from(thin.rowBonus.slice(0, ACTIONS.length)),
    Array.from(legacy.rowBonus.slice(0, ACTIONS.length)),
    `bonus mismatch at root ${index}`);
  assert.deepEqual(Array.from(thin.rowMember.slice(0, ACTIONS.length)),
    Array.from(legacy.rowMember.slice(0, ACTIONS.length)),
    `membership mismatch at root ${index}`);
}

test("thin intent is sequentially equivalent to the reachable BP68 contract", () => {
  const seed = { value: 0x15868b01 };
  const legacy = new NativeTacticalIntentPoc(150, {
    oracleMode: "off",
    mappingMode: "v1-action",
    continuityMode: "v1-epoch",
    classificationMode: "v1-exact"
  });
  const thin = new NativeBasePolicyStrategicIntent(150);
  for (let index = 0; index < 4096; index += 1) {
    const engine = makeEngine(seed, index);
    legacy.observeContext(engine); thin.observeContext(engine);
    assert.equal(thin.contextSignature(engine), legacy.contextSignature(engine),
      `context signature mismatch at root ${index}`);
    assert.equal(thin.proposed(engine), legacy.proposed(engine),
      `classification mismatch at root ${index}`);
    legacy.prepare(engine, ACTIONS.length); thin.prepare(engine, ACTIONS.length);
    assertStateEqual(thin, legacy, index);
    const selected = ACTIONS[random(seed) % ACTIONS.length];
    legacy.commitSelection(selected); thin.commitSelection(selected);
    assert.equal(thin.lastIntent, legacy.lastIntent,
      `committed intent mismatch at root ${index}`);
    assert.equal(thin.lastIntentEpoch, legacy.lastIntentEpoch,
      `committed epoch mismatch at root ${index}`);
  }
});

test("thin intent owns fixed scratch and no diagnostic matrices", () => {
  const intent = new NativeBasePolicyStrategicIntent();
  assert.ok(intent.rowBonus instanceof Int16Array);
  assert.ok(intent.rowMember instanceof Uint8Array);
  assert.ok(intent.pathDistance instanceof Uint16Array);
  assert.ok(intent.pathQueue instanceof Uint16Array);
  assert.ok(intent.pathFirst instanceof Uint16Array);
  assert.equal(intent.oracleMode, undefined);
  assert.equal(intent.proposedOraclePairs, undefined);
  assert.equal(intent.summary().hotAllocationCount, 0);
});
