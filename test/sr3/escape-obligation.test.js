"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  EscapeObligation,
  SUPPORT_STATUS,
  ENTITY_BOMB,
  ENTITY_PROJECTILE,
  SUCCESSOR_PROOF
} = require("../../engine-v2/src/runtime/escape-obligation");
const { HARD_STATUS, ACTION, NONE_CELL, TERRAIN } =
  require("../../engine-v2/src/abi/fast-codes");
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

function placeBomb(state, cell, fuse = 4, owner = 1, id = 42, generation = 7) {
  state.arrays[ARRAY.BOMB_ACTIVE][0] = 1;
  state.arrays[ARRAY.BOMB_CELL][0] = cell;
  state.arrays[ARRAY.BOMB_OWNER][0] = owner;
  state.arrays[ARRAY.BOMB_GENERATION][0] = generation;
  state.arrays[ARRAY.BOMB_EXPLODE][0] =
    state.arrays[ARRAY.SCALAR][SCALAR.FRAME] + fuse;
  state.arrays[ARRAY.BOMB_ID][0] = id;
}

function placeProjectile(state, owner, id = 9, generation = 3) {
  state.arrays[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  state.arrays[ARRAY.PROJECTILE_CELL][0] = state.cell(2, 4);
  state.arrays[ARRAY.PROJECTILE_DIR][0] = 1;
  state.arrays[ARRAY.PROJECTILE_OWNER][0] = owner;
  state.arrays[ARRAY.PROJECTILE_GENERATION][0] = generation;
  state.arrays[ARRAY.PROJECTILE_ID][0] = id;
}

function rows(state, actions, cells, directions = null) {
  return {
    actions: new Uint8Array(actions),
    arguments_: new Uint16Array(actions.length).fill(NONE_CELL),
    hard: new Uint8Array(actions.length).fill(HARD_STATUS.ALLOW),
    cells: new Uint16Array(cells),
    directions: directions ? new Uint8Array(directions) :
      new Uint8Array(actions.length).fill(state.arrays[ARRAY.TANK_DIR][0])
  };
}

function evaluate(obligation, bundle, rowSet) {
  return obligation.evaluateCommitted(bundle, rowSet.actions, rowSet.arguments_,
    rowSet.cells, rowSet.directions, rowSet.hard, rowSet.actions.length);
}

function controllerFor(count, acceptable = null) {
  const values = acceptable || new Uint8Array(count).fill(1);
  return {
    acceptableCount: values.reduce((sum, value) => sum + value, 0),
    noAcceptableAction: values.some(Boolean) ? 0 : 1,
    outcome: {
      acceptable: values,
      hard: new Uint8Array(count).fill(HARD_STATUS.ALLOW),
      escapeSuccessorProof: new Uint8Array(count),
      escapeSuccessorExposed: new Uint8Array(count),
      escapeSuccessorSlack: new Int8Array(count),
      escapeSuccessorBranches: new Uint8Array(count),
      escapeSuccessorCoverage: new Uint8Array(count),
      escapeSuccessorReady: 0
    },
    recomputeCount: 0,
    recomputeSelectionFrontier() { this.recomputeCount += 1; }
  };
}

describe("EscapeObligation committed-only contract", () => {
  it("binds real bombs and hostile projectiles by kind, owner, id, and generation", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4));
    placeProjectile(state, 1);
    const obligation = new EscapeObligation();
    const rowSet = rows(state, [ACTION.GO], [state.cell(5, 4)]);
    evaluate(obligation, bundle, rowSet);
    assert.equal(obligation.committedEntityCount, 2);
    assert.deepEqual(Array.from(obligation.entityKind.slice(0, 2)),
      [ENTITY_BOMB, ENTITY_PROJECTILE]);
    assert.equal(obligation.entityOwner[0], 1);
    assert.equal(obligation.entityId[0], 42);
    assert.equal(obligation.entityGeneration[0], 7);
    assert.equal(obligation.entitiesMatch(state), 1);
    state.arrays[ARRAY.PROJECTILE_OWNER][0] = 2;
    assert.equal(obligation.entitiesMatch(state), 0,
      "same id/generation under a different owner is a different entity");
  });

  it("ignores own projectiles and does not invent obligations for possible or future fire", () => {
    const { state, bundle } = openArena();
    placeProjectile(state, 0);
    const obligation = new EscapeObligation();
    const rowSet = rows(state, [ACTION.GO, ACTION.FIRE],
      [state.cell(5, 4), state.cell(4, 4)]);
    assert.equal(evaluate(obligation, bundle, rowSet), SUPPORT_STATUS.NONE);
    assert.equal(obligation.committedEntityCount, 0);
    assert.equal(obligation.firstActionCount, 0);
    assert.equal(obligation.active, 0);
  });

  it("retains every ReverseViability-proven projected action, including hold-like actions", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 6);
    const actions = [
      ACTION.GO, ACTION.TURN_LEFT, ACTION.FIRE, ACTION.NONE,
      ACTION.CAST_POISON, ACTION.CAST_SHIELD
    ];
    // This test isolates membership from the action family. Every row reaches
    // the same proven-viable successor pose, so no GO/TURN heuristic may delete
    // FIRE, NONE, or a skill.
    const safe = state.cell(7, 3);
    const rowSet = rows(state, actions, actions.map(() => safe),
      actions.map(() => 0));
    const obligation = new EscapeObligation();
    assert.equal(evaluate(obligation, bundle, rowSet), SUPPORT_STATUS.COMPLETE);
    assert.deepEqual(Array.from(obligation.member.slice(0, actions.length)),
      new Array(actions.length).fill(1));
    assert.equal(obligation.firstActionCount, actions.length);
  });

  it("excludes only successors the committed closure proves nonviable", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 2);
    const rowSet = rows(state, [ACTION.GO, ACTION.FIRE],
      [state.cell(7, 3), state.cell(4, 4)], [0, 1]);
    const obligation = new EscapeObligation();
    assert.equal(evaluate(obligation, bundle, rowSet), SUPPORT_STATUS.COMPLETE);
    assert.equal(obligation.successorProof[0], SUCCESSOR_PROOF.PROVEN_VIABLE);
    assert.equal(obligation.successorProof[1], SUCCESSOR_PROOF.PROVEN_DEAD);
    assert.deepEqual(Array.from(obligation.member.slice(0, 2)), [1, 0]);
  });

  it("intersects Risk with the committed viable set without choosing among viable members", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 2);
    const rowSet = rows(state, [ACTION.GO, ACTION.FIRE, ACTION.CAST_POISON],
      [state.cell(7, 3), state.cell(4, 4), state.cell(7, 3)], [0, 1, 0]);
    const obligation = new EscapeObligation();
    evaluate(obligation, bundle, rowSet);
    const controller = controllerFor(3);
    assert.equal(obligation.restrictRiskController(controller, state, 3), 1);
    assert.deepEqual(Array.from(controller.outcome.acceptable), [1, 0, 1]);
    assert.equal(controller.acceptableCount, 2);
  });

  it("restores Hard-allowed committed survivors when Risk empties their intersection", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 2);
    const rowSet = rows(state, [ACTION.GO, ACTION.FIRE],
      [state.cell(7, 3), state.cell(4, 4)], [0, 1]);
    const obligation = new EscapeObligation();
    evaluate(obligation, bundle, rowSet);
    const controller = controllerFor(2, new Uint8Array([0, 1]));
    assert.equal(obligation.restrictRiskController(controller, state, 2), 1);
    assert.deepEqual(Array.from(controller.outcome.acceptable), [1, 1]);
    assert.equal(controller.noAcceptableAction, 0);
    assert.equal(obligation.rescueOverrideCount, 1);
  });

  it("never restores a Hard-rejected committed member", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 4);
    const rowSet = rows(state, [ACTION.GO, ACTION.CAST_POISON],
      [state.cell(7, 3), state.cell(7, 3)], [0, 0]);
    const obligation = new EscapeObligation();
    evaluate(obligation, bundle, rowSet);
    const controller = controllerFor(2, new Uint8Array([0, 0]));
    controller.outcome.hard[0] = HARD_STATUS.REJECT_PROVEN;
    controller.outcome.hard[1] = HARD_STATUS.REJECT_POLICY;
    assert.equal(obligation.restrictRiskController(controller, state, 2), 0);
    assert.deepEqual(Array.from(controller.outcome.acceptable), [0, 0]);
  });

  it("does not restrict on incomplete committed support", () => {
    const { state } = openArena();
    placeBomb(state, state.cell(4, 4), 4);
    const obligation = new EscapeObligation();
    const rowSet = rows(state, [ACTION.GO, ACTION.FIRE],
      [state.cell(7, 3), state.cell(4, 4)]);
    assert.equal(evaluate(obligation, { state, hazard: null }, rowSet),
      SUPPORT_STATUS.INCOMPLETE);
    const controller = controllerFor(2);
    assert.equal(obligation.restrictRiskController(controller, state, 2), 0);
    assert.deepEqual(Array.from(controller.outcome.acceptable), [1, 1]);
  });

  it("resets Deadline state every frame and ends after normative entity invalidation", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 4);
    const obligation = new EscapeObligation();
    const rowSet = rows(state, [ACTION.GO], [state.cell(7, 3)], [0]);
    evaluate(obligation, bundle, rowSet);
    assert.notEqual(obligation.rootSlack, 0);
    state.arrays[ARRAY.BOMB_ACTIVE][0] = 0;
    assert.equal(evaluate(obligation, bundle, rowSet), SUPPORT_STATUS.NONE);
    assert.equal(obligation.rootSlack, 0);
    assert.equal(obligation.deadline.slack, -128);
    assert.equal(obligation.committedEntityCount, 0);
  });

  it("publishes fixed successor dimensions but never writes Safety death mass", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 4);
    const obligation = new EscapeObligation();
    const rowSet = rows(state, [ACTION.GO, ACTION.FIRE],
      [state.cell(7, 3), state.cell(4, 4)], [0, 1]);
    evaluate(obligation, bundle, rowSet);
    const controller = controllerFor(2);
    assert.equal(obligation.publishSuccessorQuality(controller, 2), 1);
    assert.equal(controller.outcome.escapeSuccessorReady, 1);
    const sentinel = { horizonFatalMass: new Uint16Array([321, 654]) };
    assert.equal(obligation.applyToSafety(sentinel, 2), 0);
    assert.deepEqual(Array.from(sentinel.horizonFatalMass), [321, 654]);
  });
});
