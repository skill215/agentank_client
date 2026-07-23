"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { DeadlineKernel, DEADLINE_PROOF, SUCCESSOR_PROOF } =
  require("../../engine-v2/src/fast/deadline-kernel");
const { ACTION, TERRAIN } = require("../../engine-v2/src/abi/fast-codes");
const { FastState, ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { FastKernel } = require("../../engine-v2/src/fast/kernel");
const { HazardKernel } = require("../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../engine-v2/src/fast/hard-gate");

function openArena(width = 9, height = 9) {
  const state = new FastState(width, height);
  const terrain = state.arrays[ARRAY.TERRAIN];
  terrain.fill(TERRAIN.OPEN, 0, state.cells);
  for (let x = 0; x < width; x += 1) {
    terrain[state.cell(x, 0)] = TERRAIN.WALL;
    terrain[state.cell(x, height - 1)] = TERRAIN.WALL;
  }
  for (let y = 0; y < height; y += 1) {
    terrain[state.cell(0, y)] = TERRAIN.WALL;
    terrain[state.cell(width - 1, y)] = TERRAIN.WALL;
  }
  state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 10;
  state.arrays[ARRAY.TANK_CELL][0] = state.cell(4, 4);
  state.arrays[ARRAY.TANK_DIR][0] = 1;
  state.arrays[ARRAY.TANK_CELL][1] = state.cell(6, 4);
  state.arrays[ARRAY.TANK_DIR][1] = 3;
  state.initializeHash();
  const kernel = new FastKernel(state);
  const hazard = new HazardKernel(state);
  const hard = new HardGate(kernel, hazard, 0);
  return { state, kernel, hazard, hard, bundle: { state, kernel, hazard, hard } };
}

function placeBomb(state, cell, fuse = 4) {
  state.arrays[ARRAY.BOMB_ACTIVE][0] = 1;
  state.arrays[ARRAY.BOMB_CELL][0] = cell;
  state.arrays[ARRAY.BOMB_OWNER][0] = 1;
  state.arrays[ARRAY.BOMB_GENERATION][0] = 7;
  state.arrays[ARRAY.BOMB_EXPLODE][0] =
    state.arrays[ARRAY.SCALAR][SCALAR.FRAME] + fuse;
  state.arrays[ARRAY.BOMB_ID][0] = 42;
}

function placeEnemyProjectile(state, cell, direction) {
  state.arrays[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  state.arrays[ARRAY.PROJECTILE_CELL][0] = cell;
  state.arrays[ARRAY.PROJECTILE_DIR][0] = direction;
  state.arrays[ARRAY.PROJECTILE_OWNER][0] = 1;
  state.arrays[ARRAY.PROJECTILE_GENERATION][0] = 3;
  state.arrays[ARRAY.PROJECTILE_ID][0] = 9;
}

function stateFingerprint(state) {
  return {
    hashLo: state.hashLo,
    hashHi: state.hashHi,
    tankCell: Array.from(state.arrays[ARRAY.TANK_CELL]),
    tankDir: Array.from(state.arrays[ARRAY.TANK_DIR]),
    bombActive: Array.from(state.arrays[ARRAY.BOMB_ACTIVE]),
    projectileActive: Array.from(state.arrays[ARRAY.PROJECTILE_ACTIVE])
  };
}

describe("DeadlineKernel committed closure", () => {
  it("rebuilds ReverseViability without mutating or failing to restore the root", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 5);
    const before = stateFingerprint(state);
    const deadline = new DeadlineKernel();
    deadline.solve(bundle, 0);
    assert.notEqual(deadline.proofStatus, DEADLINE_PROOF.INCOMPLETE);
    assert.deepEqual(stateFingerprint(state), before);
  });

  it("keeps viable hold-like actions instead of dropping them when movement also survives", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 6);
    const deadline = new DeadlineKernel();
    deadline.solve(bundle, 0);
    assert.equal(deadline.proofStatus, DEADLINE_PROOF.ESCAPE_EXISTS);
    assert.ok(deadline.moveEscapeCount > 0);
    assert.ok(deadline.holdEscapeCount > 0);
    assert.equal(deadline.isFirstAction(ACTION.FIRE), 1);
    assert.equal(deadline.isFirstAction(ACTION.NONE), 1);
    assert.equal(deadline.isFirstAction(ACTION.CAST_POISON), 1);
  });

  it("marks a successor dead only when committed hazard coverage proves it", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 2);
    const deadline = new DeadlineKernel();
    deadline.solve(bundle, 0);
    const dead = deadline.evaluateSuccessor(bundle, state.cell(4, 4), 1);
    const live = deadline.evaluateSuccessor(bundle, state.cell(7, 3), 0);
    assert.equal(dead.coverageComplete, 1);
    assert.equal(dead.proofStatus, SUCCESSOR_PROOF.PROVEN_DEAD);
    assert.equal(live.proofStatus, SUCCESSOR_PROOF.PROVEN_VIABLE);
  });

  it("returns UNKNOWN, never proven viable, when narrow coverage is incomplete", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 5);
    const deadline = new DeadlineKernel();
    deadline.solve(bundle, 0);
    bundle.hazard.narrowProofComplete = 0;
    const quality = deadline.evaluateSuccessor(bundle, state.cell(7, 3), 0);
    assert.equal(quality.coverageComplete, 0);
    assert.notEqual(quality.proofStatus, SUCCESSOR_PROOF.PROVEN_VIABLE);
  });

  it("uses hostile projectile arrival in the committed deadline", () => {
    const { state, bundle } = openArena();
    state.arrays[ARRAY.TANK_DIR][0] = 0;
    placeEnemyProjectile(state, state.cell(2, 4), 1);
    state.initializeHash();
    const deadline = new DeadlineKernel();
    deadline.solve(bundle, 0);
    assert.equal(deadline.proofStatus, DEADLINE_PROOF.ESCAPE_EXISTS);
    assert.ok(deadline.deadlineTick >= 0);
    const stay = deadline.evaluateSuccessor(bundle, state.cell(4, 4), 1);
    assert.ok(stay.proofStatus === SUCCESSOR_PROOF.PROVEN_DEAD ||
      stay.stillExposedAtDeadline === 1);
  });

  it("fills independent per-row successor arrays for all action families", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 6);
    const deadline = new DeadlineKernel();
    deadline.solve(bundle, 0);
    const actions = new Uint8Array([
      ACTION.GO, ACTION.TURN_LEFT, ACTION.FIRE, ACTION.NONE, ACTION.CAST_POISON
    ]);
    const out = {
      proofStatus: new Uint8Array(actions.length),
      stillExposedAtDeadline: new Uint8Array(actions.length),
      slack: new Int8Array(actions.length),
      viableNextActionCount: new Uint8Array(actions.length),
      coverageComplete: new Uint8Array(actions.length)
    };
    assert.equal(deadline.evaluateSuccessorActions(bundle, actions, actions.length, out),
      actions.length);
    assert.equal(out.coverageComplete.every(value => value === 1), true);
    assert.equal(out.proofStatus[2], out.proofStatus[3]);
    assert.equal(out.proofStatus[3], out.proofStatus[4]);
  });

  it("recomputes deadline, slack, and action membership from the current state", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 5);
    const deadline = new DeadlineKernel();
    deadline.solve(bundle, 0);
    const priorSlack = deadline.slack;
    assert.notEqual(priorSlack, -128);
    state.arrays[ARRAY.BOMB_ACTIVE][0] = 0;
    state.initializeHash();
    deadline.solve(bundle, 0);
    assert.equal(deadline.deadlineTick, 0);
    assert.equal(deadline.slack, 0);
    assert.notEqual(deadline.slack, priorSlack);
    assert.equal(deadline.proofStatus, DEADLINE_PROOF.ESCAPE_EXISTS);
  });

  it("reports incomplete support when no hazard kernel is available", () => {
    const deadline = new DeadlineKernel();
    deadline.solve({ state: openArena().state, hazard: null }, 0);
    assert.equal(deadline.proofStatus, DEADLINE_PROOF.INCOMPLETE);
    assert.equal(deadline.rootViable, 0);
  });
});
