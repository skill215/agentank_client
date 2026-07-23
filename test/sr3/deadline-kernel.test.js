"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { DeadlineKernel, DEADLINE_PROOF, SUCCESSOR_PROOF } =
  require("../../engine-v2/src/fast/deadline-kernel");
const { EscapeObligation } = require("../../engine-v2/src/runtime/escape-obligation");
const { HARD_STATUS, ACTION, NONE_CELL, TERRAIN } = require("../../engine-v2/src/abi/fast-codes");
const { FastState, ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { FastKernel } = require("../../engine-v2/src/fast/kernel");
const { HazardKernel } = require("../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../engine-v2/src/fast/hard-gate");
const { RULE } = require("../../engine-v2/src/generated/fast-config");

function openArena(width = 9, height = 9) {
  const state = new FastState(width, height);
  const terrain = state.arrays[ARRAY.TERRAIN];
  for (let cell = 0; cell < state.cells; cell += 1) terrain[cell] = TERRAIN.OPEN;
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

function placeBomb(state, cell, fuse) {
  state.arrays[ARRAY.BOMB_ACTIVE][0] = 1;
  state.arrays[ARRAY.BOMB_CELL][0] = cell;
  state.arrays[ARRAY.BOMB_OWNER][0] = 1;
  state.arrays[ARRAY.BOMB_GENERATION][0] = 7;
  state.arrays[ARRAY.BOMB_EXPLODE][0] = state.arrays[ARRAY.SCALAR][SCALAR.FRAME] + fuse;
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

describe("DeadlineKernel", () => {
  it("marks move/turn first-actions on a committed bomb escape chain and drops FIRE", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 6);
    assert.ok(RULE.BOMB_RANGE >= 2);
    const deadline = new DeadlineKernel();
    deadline.solve(bundle, 0);
    assert.equal(deadline.proofStatus, DEADLINE_PROOF.ESCAPE_EXISTS);
    assert.ok(deadline.moveEscapeCount >= 1);
    assert.equal(deadline.isFirstAction(ACTION.FIRE), 0);
    assert.ok(deadline.isFirstAction(ACTION.GO) || deadline.isFirstAction(ACTION.TURN_LEFT) ||
      deadline.isFirstAction(ACTION.TURN_RIGHT));
    assert.ok(deadline.slack > -128);
  });

  it("feeds EscapeObligation same-frame restrict away from FIRE when deadline escape exists", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 5);
    const obligation = new EscapeObligation();
    const actions = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.FIRE]);
    const args = new Uint16Array([NONE_CELL, NONE_CELL, NONE_CELL]);
    const hardStatus = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
    const projected = new Uint16Array([
      state.cell(5, 4), state.cell(4, 4), state.cell(4, 4)
    ]);
    obligation.evaluate(bundle, actions, args, 3, hardStatus, projected);
    assert.ok(obligation.deadlineFirstCount >= 1 || obligation.clearingActionCount >= 1);
    assert.equal(obligation.firstAction[2], 0);
    const controller = {
      acceptableCount: 3,
      outcome: { acceptable: new Uint8Array([1, 1, 1]) },
      recomputeSelectionFrontier() {}
    };
    const removed = obligation.restrictRiskController(controller, state, 3);
    assert.ok(removed >= 1);
    assert.equal(controller.outcome.acceptable[2], 0);
  });

  it("demotes GO that steps adjacent to the enemy when a turn escape exists", () => {
    const { state, bundle } = openArena();
    state.arrays[ARRAY.TANK_CELL][0] = state.cell(5, 4);
    state.arrays[ARRAY.TANK_DIR][0] = 3; // left
    state.arrays[ARRAY.TANK_CELL][1] = state.cell(3, 4);
    placeBomb(state, state.cell(5, 4), 4);
    state.initializeHash();
    const obligation = new EscapeObligation();
    const actions = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT]);
    const args = new Uint16Array([NONE_CELL, NONE_CELL, NONE_CELL]);
    const hardStatus = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
    const projected = new Uint16Array([
      state.cell(4, 4), state.cell(5, 4), state.cell(5, 4)
    ]);
    obligation.evaluate(bundle, actions, args, 3, hardStatus, projected);
    assert.ok(obligation.deadlineFirstCount >= 1);
    assert.equal(obligation.firstAction[0], 0);
    assert.ok(obligation.firstAction[1] || obligation.firstAction[2]);
  });

  it("forces turn dodge when GO walks into an enemy projectile cell", () => {
    const { state, bundle } = openArena();
    // Projectile on row y=3 moving right; stay at (4,4) is clear, GO to (4,3) is hit.
    state.arrays[ARRAY.TANK_CELL][0] = state.cell(4, 4);
    state.arrays[ARRAY.TANK_DIR][0] = 0; // up
    state.arrays[ARRAY.TANK_CELL][1] = state.cell(1, 3);
    placeEnemyProjectile(state, state.cell(3, 3), 1);
    state.initializeHash();
    const obligation = new EscapeObligation();
    const actions = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.CAST_POISON]);
    const args = new Uint16Array([NONE_CELL, NONE_CELL, NONE_CELL]);
    const hardStatus = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
    const projected = new Uint16Array([
      state.cell(4, 3), state.cell(4, 4), state.cell(4, 4)
    ]);
    obligation.evaluate(bundle, actions, args, 3, hardStatus, projected);
    assert.ok(obligation.deadline.moveEscapeCount >= 1);
    assert.ok(obligation.deadlineFirstCount >= 1);
    assert.equal(obligation.firstAction[2], 0);
    const controller = {
      acceptableCount: 3, noAcceptableAction: 0,
      outcome: {
        acceptable: new Uint8Array([1, 1, 1]),
        hard: new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW, HARD_STATUS.ALLOW])
      },
      recomputeSelectionFrontier() {}
    };
    obligation.restrictRiskController(controller, state, 3);
    assert.equal(controller.outcome.acceptable[2], 0);
  });

  it("successor quality separates clearing GO from blast-exposed TURN", () => {
    const { state, bundle } = openArena();
    // Bomb cross at (4,4); stay on the arm at (5,4) facing up — GO to (5,3)
    // leaves the cross, TURN stays on the arm.
    state.arrays[ARRAY.TANK_CELL][0] = state.cell(5, 4);
    state.arrays[ARRAY.TANK_DIR][0] = 0;
    placeBomb(state, state.cell(4, 4), 4);
    state.initializeHash();
    const deadline = new DeadlineKernel();
    deadline.solve(bundle, 0);
    const stay = state.cell(5, 4);
    const go = deadline.successor(bundle.hazard, state, stay, 0, ACTION.GO);
    const turn = deadline.successor(bundle.hazard, state, stay, 0, ACTION.TURN_LEFT);
    assert.ok(go);
    assert.ok(turn);
    const goQ = deadline.evaluateSuccessor(bundle, go.cell, go.direction);
    const turnQ = deadline.evaluateSuccessor(bundle, turn.cell, turn.direction);
    assert.equal(goQ.stillExposedAtDeadline, 0);
    assert.equal(turnQ.stillExposedAtDeadline, 1);
    assert.ok(goQ.proofStatus >= SUCCESSOR_PROOF.UNKNOWN);
    assert.ok(turnQ.proofStatus >= SUCCESSOR_PROOF.UNKNOWN);
    assert.ok(goQ.viableNextActionCount >= turnQ.viableNextActionCount ||
      goQ.slack >= turnQ.slack);
  });

  it("successor quality marks UNKNOWN when narrow proof coverage is incomplete", () => {
    const { state, bundle } = openArena();
    state.arrays[ARRAY.TANK_CELL][0] = state.cell(5, 4);
    state.arrays[ARRAY.TANK_DIR][0] = 0;
    placeBomb(state, state.cell(4, 4), 5);
    state.initializeHash();
    const deadline = new DeadlineKernel();
    deadline.solve(bundle, 0);
    // Force incomplete coverage after solve built reverse layers.
    bundle.hazard.narrowProofComplete = 0;
    const go = deadline.successor(bundle.hazard, state, state.cell(5, 4), 0, ACTION.GO);
    assert.ok(go);
    const quality = deadline.evaluateSuccessor(bundle, go.cell, go.direction);
    assert.equal(quality.coverageComplete, 0);
    assert.notEqual(quality.proofStatus, SUCCESSOR_PROOF.PROVEN_VIABLE);
  });

  it("membership keeps UNKNOWN postViable rows and never empties the escape set", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 4);
    state.initializeHash();
    const obligation = new EscapeObligation();
    const actions = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT]);
    const args = new Uint16Array([NONE_CELL, NONE_CELL, NONE_CELL]);
    const hardStatus = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
    const projected = new Uint16Array([
      state.cell(5, 4), state.cell(4, 4), state.cell(4, 4)
    ]);
    // Force UNKNOWN membership on all rows after evaluate's hard path would run —
    // inject via direct postViable rewrite after a normal evaluate.
    obligation.evaluate(bundle, actions, args, 3, hardStatus, projected);
    assert.ok(obligation.firstActionCount >= 1);
    for (let row = 0; row < 3; row += 1) obligation.postViable[row] = -1;
    assert.equal(obligation.membershipEligible(hardStatus, 0), 1);
    assert.equal(obligation.membershipEligible(hardStatus, 1), 1);
    obligation.postViable[0] = 0;
    assert.equal(obligation.membershipEligible(hardStatus, 0), 0);
    hardStatus[1] = HARD_STATUS.REJECT_PROVEN;
    assert.equal(obligation.membershipEligible(hardStatus, 1), 0);
  });

  it("evaluateSuccessorActions fills per-row parallel quality arrays", () => {
    const { state, bundle } = openArena();
    state.arrays[ARRAY.TANK_CELL][0] = state.cell(5, 4);
    state.arrays[ARRAY.TANK_DIR][0] = 0;
    placeBomb(state, state.cell(4, 4), 5);
    state.initializeHash();
    const deadline = new DeadlineKernel();
    deadline.solve(bundle, 0);
    const actions = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT]);
    const out = {
      proofStatus: new Uint8Array(3),
      stillExposedAtDeadline: new Uint8Array(3),
      slack: new Int8Array(3),
      viableNextActionCount: new Uint8Array(3),
      coverageComplete: new Uint8Array(3)
    };
    assert.equal(deadline.evaluateSuccessorActions(bundle, actions, 3, out), 3);
    assert.equal(out.stillExposedAtDeadline[0], 0);
    assert.equal(out.stillExposedAtDeadline[1], 1);
    assert.equal(out.stillExposedAtDeadline[2], 1);
    assert.ok(out.proofStatus[0] >= SUCCESSOR_PROOF.UNKNOWN);
  });
});
