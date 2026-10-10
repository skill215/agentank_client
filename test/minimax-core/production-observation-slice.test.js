"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { ProductionObservationAdapter: LegacyAdapter } = require(
  "../../engine-v2/src/runtime/production-root");
const { ProductionObservationAdapter: GeneratedAdapter } = require(
  "../../engine-v2/src/runtime/production-observation");

function tank(id, position, direction, skill) {
  return { tank: { id, position, direction, crashed: false }, stars: 0,
    bullet: null, skill: { type: skill, remainingCooldownFrames: 0 },
    effects: { self: null, debuff: null }, status: { shielded: false,
      cloaked: false, boosted: false, overloaded: false, frozen: false,
      stunned: false, poisoned: false, fireLocked: false,
      bombCooldownFrames: 0, bombActive: false, canActThisFrame: true,
      actionSpeed: 1 } };
}

function game(frame) {
  const size = 7;
  const map = Array.from({ length: size }, (_, x) => Array.from(
    { length: size }, (_, y) => x === 0 || y === 0 || x === size - 1 ||
      y === size - 1 ? "x" : x === 3 && y === 2 ? "#" : "."));
  return { frame, frames: frame, map, star: [3, 3], bombs: [] };
}

function snapshot(adapter) {
  const state = adapter.state;
  return { status: adapter.lastStatus, hashLo: state.hashLo,
    hashHi: state.hashHi, informationComplete: adapter.informationComplete,
    enemyVisible: adapter.enemyVisible,
    ownCanAct: adapter.ownCanAct, enemyCanAct: adapter.enemyCanAct,
    arrays: state.arrays.map(value => Array.from(value)) };
}

test("generated production observation slice matches the accepted adapter", () => {
  const legacy = new LegacyAdapter(); const generated = new GeneratedAdapter();
  for (let frame = 1; frame <= 12; frame += 1) {
    const me = tank("own", [1 + (frame & 1), 1],
      ["up", "right", "down", "left"][frame & 3], "poison");
    const enemy = tank("enemy", [5 - (frame & 1), 5],
      ["up", "right", "down", "left"][(frame + 2) & 3], "stun");
    const a = legacy.adapt(me, enemy, game(frame));
    const b = generated.adapt(me, enemy, game(frame));
    assert.equal(a.status, b.status);
    assert.deepEqual(snapshot(legacy), snapshot(generated));
  }
});

test("generated observation slice is self-contained in a fresh process", () => {
  const modulePath = path.resolve(__dirname,
    "../../engine-v2/src/runtime/production-observation.js");
  const script = `
    const { ProductionObservationAdapter } = require(${JSON.stringify(modulePath)});
    const adapter = new ProductionObservationAdapter();
    const side = (id, x, skill) => ({
      tank: { id, position: [x, 1], direction: "right", crashed: false },
      stars: 0, bullet: null,
      skill: { type: skill, remainingCooldownFrames: 0 },
      effects: { self: null, debuff: null },
      status: { shielded: false, frozen: false, stunned: false,
        overloaded: false, cloaked: false, poisoned: false, boosted: false,
        fireLocked: false, bombCooldownFrames: 0, bombActive: false,
        canActThisFrame: true, actionSpeed: 1 }
    });
    const map = Array.from({ length: 5 }, (_, x) => Array.from(
      { length: 5 }, (_, y) => x === 0 || y === 0 || x === 4 || y === 4 ? "x" : "."));
    const result = adapter.adapt(side("own", 1, "poison"),
      side("enemy", 3, "stun"), { frame: 1, frames: 1, map, star: [2, 2], bombs: [] });
    if (!result || !result.bundle) process.exit(2);
  `;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
