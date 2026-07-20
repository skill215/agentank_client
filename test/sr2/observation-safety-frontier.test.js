"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { ObservationSafetyFrontier, SafetyPhysicalStateArena, FRONTIER_STATUS } =
  require("../../engine-v2/src/search/observation-safety-frontier");
const { SAFETY_STATUS } = require("../../engine-v2/src/search/information-safety-closure");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");

function built(own, enemy, options = {}) {
  return fast.createFastPhysical(physical({ platformFrame: options.frame || 0,
    recordIndex: options.frame || 0, map: options.map || { width: 7, height: 7,
      terrainColumnMajor: boxedMap(7, 7) }, tanks: [own, enemy],
    projectiles: options.projectiles || [], bombs: options.bombs || [] }));
}

function classify(item, action, horizon = 2, budget = 4096, complete = 1) {
  const frontier = new ObservationSafetyFrontier(); const state = item.state;
  const world = new Uint16Array([state.arrays[fast.ARRAY.TANK_CELL][1]]);
  return { frontier, result: frontier.classify(item, action, fast.NONE_CELL,
    world, 1, complete, 1, state.arrays[fast.ARRAY.TANK_DIR][1], horizon, budget) };
}

function basicActions(state, seat) {
  const a = state.arrays; const frame = a[fast.ARRAY.SCALAR][fast.SCALAR.FRAME];
  if (a[fast.ARRAY.TANK_FROZEN_UNTIL][seat] !== fast.NONE_FRAME &&
      a[fast.ARRAY.TANK_FROZEN_UNTIL][seat] > frame) return [fast.ACTION.NONE];
  const actions = [fast.ACTION.NONE, fast.ACTION.GO, fast.ACTION.TURN_LEFT,
    fast.ACTION.TURN_RIGHT];
  let projectile = false; for (let slot = 0; slot < a[fast.ARRAY.PROJECTILE_ACTIVE].length; slot += 1)
    projectile ||= Boolean(a[fast.ARRAY.PROJECTILE_ACTIVE][slot] &&
      a[fast.ARRAY.PROJECTILE_OWNER][slot] === seat);
  if (!projectile && (a[fast.ARRAY.TANK_FIRE_LOCK][seat] === fast.NONE_FRAME ||
      a[fast.ARRAY.TANK_FIRE_LOCK][seat] <= frame)) actions.push(fast.ACTION.FIRE);
  let bomb = false; for (let slot = 0; slot < a[fast.ARRAY.BOMB_ACTIVE].length; slot += 1)
    bomb ||= Boolean(a[fast.ARRAY.BOMB_ACTIVE][slot] && a[fast.ARRAY.BOMB_OWNER][slot] === seat);
  if (!bomb && a[fast.ARRAY.TANK_BOMB_READY][seat] <= frame) actions.push(fast.ACTION.THROW_BOMB);
  return actions;
}

// Independent allocating oracle for the skill-free differential fixtures. It
// deliberately shares no frontier storage, grouping, or action generator.
function oracleState(item, remaining) {
  if (remaining === 0) return true;
  const own = basicActions(item.state, 0); const enemy = basicActions(item.state, 1);
  for (const ourAction of own) {
    let survives = true;
    for (const enemyAction of enemy) {
      const status = item.kernel.applyFrame(ourAction, fast.NONE_CELL,
        enemyAction, fast.NONE_CELL, fast.CHANCE.NORMAL, fast.CHANCE.NORMAL);
      if (status !== fast.FAST_STATUS.APPLIED && status !== fast.FAST_STATUS.APPLIED_TERMINAL) {
        survives = false; break;
      }
      const mark = item.kernel.lastMark;
      const dead = item.state.arrays[fast.ARRAY.TANK_CRASH][0] !== 0;
      const terminal = item.state.arrays[fast.ARRAY.SCALAR][fast.SCALAR.TERMINAL_CODE] !== 0;
      const child = !dead && (terminal || oracleState(item, remaining - 1));
      item.state.undoTo(mark);
      if (!child) { survives = false; break; }
    }
    if (survives) return true;
  }
  return false;
}

function oracleFixed(item, action, remaining) {
  for (const enemyAction of basicActions(item.state, 1)) {
    const status = item.kernel.applyFrame(action, fast.NONE_CELL,
      enemyAction, fast.NONE_CELL, fast.CHANCE.NORMAL, fast.CHANCE.NORMAL);
    if (status !== fast.FAST_STATUS.APPLIED && status !== fast.FAST_STATUS.APPLIED_TERMINAL)
      return false;
    const mark = item.kernel.lastMark;
    const dead = item.state.arrays[fast.ARRAY.TANK_CRASH][0] !== 0;
    const terminal = item.state.arrays[fast.ARRAY.SCALAR][fast.SCALAR.TERMINAL_CODE] !== 0;
    const child = !dead && (terminal || remaining === 1 || oracleState(item, remaining - 1));
    item.state.undoTo(mark); if (!child) return false;
  }
  return true;
}

test("SR2 ObservationSafetyFrontier proves an immediate enemy FIRE counterexample without writing Hard", () => {
  const item = built(tank(0, [3, 3], "up"), tank(1, [3, 4], "up"));
  const rootSignature = item.state.rootSignature();
  const { frontier, result } = classify(item, fast.ACTION.NONE, 1);
  assert.equal(result, FRONTIER_STATUS.NO_WITNESS);
  assert.equal(frontier.earliestFatalFrame, 1);
  assert.equal(item.state.rootSignature(), rootSignature);
  assert.equal(frontier.rootRestoreFailures, 0);
});

test("SR2 ObservationSafetyFrontier keeps grass-hidden poses in one observation group", () => {
  const map = boxedMap(7, 7); map[4][3] = "o"; map[3][4] = "o";
  const item = built(tank(0, [2, 2], "right"), tank(1, [4, 3], "left"),
    { map: { width: 7, height: 7, terrainColumnMajor: map } });
  const frontier = new ObservationSafetyFrontier();
  const first = frontier.observationKey(item.state);
  item.state.arrays[fast.ARRAY.TANK_CELL][1] = item.state.cell(3, 4);
  item.state.arrays[fast.ARRAY.TANK_DIR][1] = fast.DIRECTION.UP;
  item.state.initializeHash(); const second = frontier.observationKey(item.state);
  assert.deepEqual(second, first);
  item.state.arrays[fast.ARRAY.TERRAIN][item.state.cell(3, 4)] = fast.TERRAIN.OPEN;
  assert.notDeepEqual(frontier.observationKey(item.state), first);
});

test("SR2 ObservationSafetyFrontier forbids different responses inside one hidden observation", () => {
  const map = boxedMap(7, 7);
  for (let x = 1; x < 6; x += 1) for (let y = 1; y < 6; y += 1) map[x][y] = "o";
  map[1][1] = ".";
  const create = () => built(tank(0, [1, 1], "up"), tank(1, [1, 2], "right"),
    { map: { width: 7, height: 7, terrainColumnMajor: map } });
  const classifyWorlds = cells => {
    const item = create(); const frontier = new ObservationSafetyFrontier();
    const worlds = new Uint16Array(cells.map(cell => item.state.cell(cell[0], cell[1])));
    return frontier.classify(item, fast.ACTION.TURN_RIGHT, fast.NONE_CELL,
      worlds, worlds.length, 1, 1, fast.DIRECTION.RIGHT, 2, 20000);
  };
  assert.equal(classifyWorlds([[1, 2]]), FRONTIER_STATUS.WINDOW_SAFE);
  assert.equal(classifyWorlds([[2, 2]]), FRONTIER_STATUS.WINDOW_SAFE);
  assert.equal(classifyWorlds([[1, 2], [2, 2]]), FRONTIER_STATUS.NO_WITNESS);
});

test("SR2 ObservationSafetyFrontier budget and incomplete world support can never prove safe", () => {
  const item = built(tank(0, [1, 1], "right"), tank(1, [5, 5], "left"));
  assert.equal(classify(item, fast.ACTION.NONE, 2, 0).result, FRONTIER_STATUS.UNKNOWN);
  assert.notEqual(classify(item, fast.ACTION.NONE, 1, 4096, 0).result,
    FRONTIER_STATUS.WINDOW_SAFE);
});

test("SR2 threat pruning preserves ready BOOST and ordinary FIRE beside ready TELEPORT", () => {
  const boost = built(tank(0, [1, 1], "right"), tank(1, [5, 5], "left",
    { skillId: "boost", skillReadyFrame: 0 }));
  const boostFrontier = new ObservationSafetyFrontier();
  assert.equal(boostFrontier.threatReachable(boost.state, 4), 1,
    "CAST_BOOST then boosted alignment then FIRE remains in the frontier");

  const teleport = built(tank(0, [1, 1], "right"), tank(1, [1, 5], "up",
    { skillId: "teleport", skillReadyFrame: 0 }), { frame: 1 });
  teleport.state.arrays[fast.ARRAY.SCALAR][fast.SCALAR.STAR_CELL] =
    teleport.state.cell(3, 3);
  teleport.state.initializeHash();
  const teleportFrontier = new ObservationSafetyFrontier();
  assert.equal(teleportFrontier.threatReachable(teleport.state, 1), 1,
    "a ready teleport does not hide the ordinary one-frame FIRE branch");
});

test("SR2 ObservationSafetyFrontier matches an independent exhaustive oracle on depth 1-2", () => {
  const positions = [[[1, 1], [5, 5]], [[2, 3], [4, 3]], [[3, 2], [3, 5]],
    [[1, 4], [5, 2]], [[4, 4], [2, 2]]];
  const actions = [fast.ACTION.NONE, fast.ACTION.GO,
    fast.ACTION.TURN_LEFT, fast.ACTION.TURN_RIGHT];
  for (let index = 0; index < positions.length; index += 1)
    for (let horizon = 1; horizon <= 2; horizon += 1)
      for (const action of actions) {
        const spec = () => built(tank(0, positions[index][0], index & 1 ? "up" : "right"),
          tank(1, positions[index][1], index & 1 ? "left" : "up"));
        const expected = oracleFixed(spec(), action, horizon);
        const actual = classify(spec(), action, horizon, 20000).result;
        assert.equal(actual === FRONTIER_STATUS.WINDOW_SAFE, expected,
          `case=${index} horizon=${horizon} action=${action}`);
        assert.notEqual(actual, FRONTIER_STATUS.UNKNOWN,
          `complete fixture unexpectedly unknown case=${index}`);
      }
});

test("SR2 ObservationSafetyFrontier owns only fixed integer slabs and reports zero hot allocation", () => {
  const item = built(tank(0, [1, 1], "right"), tank(1, [5, 5], "left"));
  const { frontier } = classify(item, fast.ACTION.NONE, 1);
  assert.equal(frontier.hotAllocationCount, 0);
  assert.equal(frontier.stateArena.hotAllocationCount, 0);
  assert.ok(frontier.stateArena.capacity > 0 && frontier.stateArena.capacity <= 128);
});

test("SR2 compact state arena restores root and monotonic dirt destruction exactly", () => {
  const map = boxedMap(7, 7); map[3][3] = "m";
  const item = built(tank(0, [1, 1], "right"), tank(1, [5, 5], "left"),
    { map: { width: 7, height: 7, terrainColumnMajor: map } });
  const state = item.state; const cell = state.cell(3, 3); const rootHash = state.rootSignature();
  const arena = new SafetyPhysicalStateArena(); assert.equal(arena.beginRoot(state), 1);
  state.arrays[fast.ARRAY.TERRAIN][cell] = fast.TERRAIN.OPEN; state.initializeHash();
  const childHash = state.rootSignature(); assert.equal(arena.save(state, 1), 1);
  assert.equal(arena.load(state, 0), 1); assert.equal(state.rootSignature(), rootHash);
  assert.equal(state.arrays[fast.ARRAY.TERRAIN][cell], fast.TERRAIN.DIRT);
  assert.equal(arena.load(state, 1), 1); assert.equal(state.rootSignature(), childHash);
  assert.equal(state.arrays[fast.ARRAY.TERRAIN][cell], fast.TERRAIN.OPEN);
});

test("SR2 production root certifies static PROVEN_SAFE through the observation frontier", () => {
  const map = boxedMap(20, 20); const calls = [];
  const side = (id, position, direction, skill) => ({
    tank: { id, position, direction, crashed: false }, stars: 0, bullet: null,
    skill: { type: skill, remainingCooldownFrames: 5 }, effects: { self: null, debuff: null },
    status: { shielded: false, cloaked: false, boosted: false, overloaded: false,
      frozen: false, stunned: false, poisoned: false, fireLocked: false,
      bombCooldownFrames: 5, bombActive: false, canActThisFrame: true, actionSpeed: 1 },
    go() { calls.push("GO"); }, turn(value) { calls.push(`TURN:${value}`); },
    fire() { calls.push("FIRE"); }, throwBomb() { calls.push("BOMB"); },
    poison() { calls.push("POISON"); }
  });
  const engine = new ProductionRootEngine(); engine.decide(
    side("own", [1, 1], "right", "poison"), side("enemy", [18, 18], "left", "stun"),
    { frames: 1, map, star: null, bombs: [] });
  assert.ok(engine.observationSafetyAuditCount > 0);
  assert.equal(engine.observationSafetyAuditCount, engine.observationSafetySafeCount);
  assert.equal(engine.observationSafetyUnknownCount, 0);
  assert.equal(engine.observationSafety.rootRestoreFailures, 0);
  assert.ok(engine.observationSafety.nodes <= 8);
  assert.ok(calls.length <= 1);
});

test("SR2 production root prices all ChanceOutcome geometry without upgrading possible FIRE", () => {
  const map = boxedMap(20, 20); const calls = [];
  const side = (id, position, direction, skill, stunned = false) => ({
    tank: { id, position, direction, crashed: false }, stars: id === "own" ? 3 : 1,
    bullet: null, skill: { type: skill, remainingCooldownFrames: 5 },
    effects: { self: null, debuff: stunned ? { type: "stun", remainingFrames: 3 } : null },
    status: { shielded: false, cloaked: false, boosted: false, overloaded: false,
      frozen: false, stunned, poisoned: false, fireLocked: false,
      bombCooldownFrames: 0, bombActive: false, canActThisFrame: true, actionSpeed: 1 },
    go() { calls.push("GO"); }, turn(value) { calls.push(`TURN:${value}`); },
    fire() { calls.push("FIRE"); }, throwBomb() { calls.push("BOMB"); },
    poison() { calls.push("POISON"); }
  });
  const engine = new ProductionRootEngine(); engine.decide(
    side("own", [11, 9], "right", "poison", true),
    side("enemy", [8, 9], "right", "stun"),
    { frames: 120, map, star: [16, 7], bombs: [] });
  const go = Array.from(engine.ourActions.slice(0, engine.ourCount)).indexOf(fast.ACTION.GO);
  assert.ok(go >= 0); assert.equal(engine.observationSafetyPossibleAuditCount, 0);
  const base = go * SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES;
  assert.notEqual(engine.finalGate.chanceCell[base], engine.finalGate.chanceCell[base + 1]);
  assert.equal(engine.safetyClosure.outcome.status[go], SAFETY_STATUS.POSSIBLE_DEATH);
  assert.ok(engine.safetyClosure.outcome.immediateFatalMass[go] > 0);
  assert.ok(engine.safetyClosure.outcome.immediateFatalMass[go] < 10000);
  assert.equal(engine.safetyClosure.outcome.earliestFatalFrame[go], 1);
  assert.equal(engine.hardStatus[go], fast.HARD_STATUS.ALLOW);
  assert.equal(engine.observationSafety.rootRestoreFailures, 0);
  assert.ok(calls.length <= 1);
});
