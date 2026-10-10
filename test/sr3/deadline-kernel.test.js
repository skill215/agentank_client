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

function openArena(width = 9, height = 9, hazardOptions = {}) {
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
  const hazard = new HazardKernel(state, hazardOptions);
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

  it("uses AND transitions for every supported stun outcome in the reverse lattice", () => {
    const deterministic = openArena(); const robust = openArena();
    for (const fixture of [deterministic, robust]) {
      const { state } = fixture; const terrain = state.arrays[ARRAY.TERRAIN];
      // One-way corridor: three normal GO commands leave a range-two bomb,
      // while a reversed first GO is blocked and loses the only spare frame.
      for (let x = 1; x < 8; x += 1) {
        terrain[state.cell(x, 3)] = TERRAIN.WALL;
        terrain[state.cell(x, 5)] = TERRAIN.WALL;
      }
      terrain[state.cell(3, 4)] = TERRAIN.WALL;
      state.arrays[ARRAY.TANK_DIR][0] = 1;
      state.arrays[ARRAY.TANK_STUN_UNTIL][0] =
        state.arrays[ARRAY.SCALAR][SCALAR.FRAME] + 1;
      placeBomb(state, state.cell(4, 4), 3);
      state.initializeHash();
    }
    const legacy = new DeadlineKernel(); legacy.solve(deterministic.bundle, 0);
    const chance = new DeadlineKernel({ chanceCompleteStun: true,
      chanceSurvivalMass: true });
    chance.solve(robust.bundle, 0);
    assert.equal(legacy.rootViable, 1);
    assert.equal(chance.rootViable, 0,
      "an existential normal branch cannot certify a random reversed command");
    assert.equal(chance.chancePrivateBuildCount, 1,
      "the deterministic shared lattice must not serve a chance-AND proof");
    assert.ok(chance.survivalA && chance.survivalTick1,
      "the diagnostic mass DP must use fixed constructor-time slabs");
    assert.equal(chance.hotAllocationCount, 0);
  });

  it("initializes chance survival mass for a one-tick committed horizon", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 1);
    state.initializeHash();
    const deadline = new DeadlineKernel({ chanceCompleteStun: true,
      chanceSurvivalMass: true });
    assert.equal(bundle.hazard.rebuild(0), 1);
    bundle.hazard.horizonTick = 1;
    deadline.buildReverse(bundle.hazard, 0);
    const safeCell = state.cell(7, 3);
    assert.equal(deadline.survivalTick1[safeCell * 4], 10000,
      "the terminal tick-one layer must not retain its reset zero mass");
    const quality = new Uint16Array(1);
    deadline.evaluateProjectedSuccessors(bundle, new Uint16Array([safeCell]),
      new Uint8Array([0]), 1, {
        proofStatus: new Uint8Array(1),
        stillExposedAtDeadline: new Uint8Array(1),
        slack: new Int8Array(1),
        viableNextActionCount: new Uint8Array(1),
        coverageComplete: new Uint8Array(1),
        survivalMass: quality
      });
    assert.equal(quality[0], 10000);
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

  it("reuses cached tick layers without changing deadline or successor evidence", () => {
    const cached = openArena(9, 9,
      { reverseLatticeCacheEntries: 4, reverseLatticeLayerCache: true });
    const control = openArena();
    placeBomb(cached.state, cached.state.cell(4, 4), 5);
    placeBomb(control.state, control.state.cell(4, 4), 5);
    placeEnemyProjectile(cached.state, cached.state.cell(2, 4), 1);
    placeEnemyProjectile(control.state, control.state.cell(2, 4), 1);
    cached.state.initializeHash(); control.state.initializeHash();
    assert.equal(cached.hazard.reverseViable(0), control.hazard.reverseViable(0));
    const cachedDeadline = new DeadlineKernel(); const controlDeadline = new DeadlineKernel();
    cachedDeadline.solve(cached.bundle, 0); controlDeadline.solve(control.bundle, 0);
    assert.equal(cached.hazard.reverseLatticeLayerHitCount, 1);
    assert.equal(cachedDeadline.proofStatus, controlDeadline.proofStatus);
    assert.equal(cachedDeadline.rootViable, controlDeadline.rootViable);
    assert.equal(cachedDeadline.deadlineTick, controlDeadline.deadlineTick);
    assert.equal(cachedDeadline.slack, controlDeadline.slack);
    assert.deepEqual(Array.from(cachedDeadline.actionEscape),
      Array.from(controlDeadline.actionEscape));
    const poses = cached.state.cells * 4;
    assert.deepEqual(Array.from(cachedDeadline.viableTick1.slice(0, poses)),
      Array.from(controlDeadline.viableTick1.slice(0, poses)));
    assert.deepEqual(Array.from(cachedDeadline.viableTick2.slice(0, poses)),
      Array.from(controlDeadline.viableTick2.slice(0, poses)));
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
