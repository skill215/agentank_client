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

function chanceSupport(count, cells, directions, fatal = 0, incomplete = 0) {
  const chanceCell = new Uint16Array(count * 4).fill(NONE_CELL);
  const chanceDirection = new Uint8Array(count * 4).fill(0xff);
  for (let index = 0; index < cells.length; index += 1) {
    chanceCell[index] = cells[index]; chanceDirection[index] = directions[index];
  }
  return {
    chanceSupportCount: new Uint8Array([count]),
    chanceFatalSupportCount: new Uint8Array([fatal]),
    chanceIncompleteSupportCount: new Uint8Array([incomplete]),
    chanceCell,
    chanceDirection
  };
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
      escapeSuccessorReady: 0,
      immediateFatalMass: new Uint16Array(count),
      committedChanceFatalMass: new Uint16Array(count),
      horizonFatalMass: new Uint16Array(count),
      unknownMass: new Uint16Array(count),
      earliestFatalFrame: new Uint8Array(count).fill(255),
      escapeSlack: new Int8Array(count),
      unknownFallbackRisk: new Uint16Array(count),
      robustLower: new Int16Array(count)
    },
    recomputeCount: 0,
    recomputeSelectionFrontier() { this.recomputeCount += 1; },
    emergencyRiskLess(left, right) {
      if (right < 0) return true;
      const o = this.outcome;
      if (o.immediateFatalMass[left] !== o.immediateFatalMass[right])
        return o.immediateFatalMass[left] < o.immediateFatalMass[right];
      if (o.committedChanceFatalMass[left] !== o.committedChanceFatalMass[right])
        return o.committedChanceFatalMass[left] < o.committedChanceFatalMass[right];
      if (o.horizonFatalMass[left] !== o.horizonFatalMass[right])
        return o.horizonFatalMass[left] < o.horizonFatalMass[right];
      if (o.unknownMass[left] !== o.unknownMass[right])
        return o.unknownMass[left] < o.unknownMass[right];
      if (o.earliestFatalFrame[left] !== o.earliestFatalFrame[right])
        return o.earliestFatalFrame[left] > o.earliestFatalFrame[right];
      if (o.unknownFallbackRisk[left] !== o.unknownFallbackRisk[right])
        return o.unknownFallbackRisk[left] < o.unknownFallbackRisk[right];
      if (o.escapeSlack[left] !== o.escapeSlack[right])
        return o.escapeSlack[left] > o.escapeSlack[right];
      if (o.robustLower[left] !== o.robustLower[right])
        return o.robustLower[left] > o.robustLower[right];
      return left < right;
    }
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

  it("never restores a nominal EO witness when another stun outcome is fatal", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 2);
    const rowSet = rows(state, [ACTION.TURN_LEFT], [state.cell(7, 3)], [0]);
    const obligation = new EscapeObligation({ chanceComplete: true,
      chanceSurvivalMass: true });
    const support = chanceSupport(2,
      [state.cell(7, 3), state.cell(4, 4)], [0, 2], 1, 0);
    assert.equal(obligation.evaluateCommitted(bundle, rowSet.actions,
      rowSet.arguments_, rowSet.cells, rowSet.directions, rowSet.hard, 1,
      support), SUPPORT_STATUS.INCOMPLETE);
    assert.equal(obligation.successorProof[0], SUCCESSOR_PROOF.UNKNOWN);
    assert.equal(obligation.member[0], 0);
    const controller = controllerFor(1, new Uint8Array([0]));
    assert.equal(obligation.restrictRiskController(controller, state, 1), 0);
    assert.deepEqual(Array.from(controller.outcome.acceptable), [0]);
  });

  it("keeps a chance-complete EO member only when every stun outcome is viable", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 3);
    const rowSet = rows(state, [ACTION.GO], [state.cell(7, 3)], [0]);
    const obligation = new EscapeObligation({ chanceComplete: true,
      chanceSurvivalMass: true });
    const support = chanceSupport(2,
      [state.cell(7, 3), state.cell(7, 4)], [0, 0], 0, 0);
    assert.equal(obligation.evaluateCommitted(bundle, rowSet.actions,
      rowSet.arguments_, rowSet.cells, rowSet.directions, rowSet.hard, 1,
      support), SUPPORT_STATUS.COMPLETE);
    assert.equal(obligation.successorProof[0], SUCCESSOR_PROOF.PROVEN_VIABLE);
    assert.equal(obligation.member[0], 1);
  });

  it("leaves complete mixed stun outcomes to Risk without granting a strict witness", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 3);
    const safeA = state.cell(7, 3); const safeB = state.cell(7, 4);
    const rowSet = rows(state, [ACTION.TURN_LEFT, ACTION.TURN_RIGHT],
      [safeA, safeA], [0, 0]);
    const chanceCell = new Uint16Array(32).fill(NONE_CELL);
    const chanceDirection = new Uint8Array(32).fill(0xff);
    chanceCell[0] = safeA; chanceDirection[0] = 0;
    chanceCell[1] = state.cell(4, 4); chanceDirection[1] = 2;
    chanceCell[16] = safeA; chanceDirection[16] = 0;
    chanceCell[17] = safeB; chanceDirection[17] = 0;
    const support = {
      chanceSupportCount: new Uint8Array([2, 2]),
      chanceFatalSupportCount: new Uint8Array([1, 0]),
      chanceIncompleteSupportCount: new Uint8Array(2),
      chanceCell,
      chanceDirection
    };
    const obligation = new EscapeObligation({ chanceComplete: true,
      chanceSurvivalMass: true });
    assert.equal(obligation.evaluateCommitted(bundle, rowSet.actions,
      rowSet.arguments_, rowSet.cells, rowSet.directions, rowSet.hard, 2,
      support), SUPPORT_STATUS.COMPLETE);
    assert.deepEqual(Array.from(obligation.successorProof.slice(0, 2)),
      [SUCCESSOR_PROOF.UNKNOWN, SUCCESSOR_PROOF.PROVEN_VIABLE]);
    assert.deepEqual(Array.from(obligation.member.slice(0, 2)), [0, 1]);
    assert.ok(obligation.successorSurvivalMass[0] <= 5000,
      "the immediately fatal stun branch contributes zero survival mass");
    assert.equal(obligation.successorSurvivalMass[1], 10000);

    const accepted = controllerFor(2);
    assert.equal(obligation.restrictRiskController(accepted, state, 2), 0);
    assert.deepEqual(Array.from(accepted.outcome.acceptable), [1, 1]);

    const riskRejected = controllerFor(2, new Uint8Array([0, 1]));
    assert.equal(obligation.restrictRiskController(riskRejected, state, 2), 0);
    assert.deepEqual(Array.from(riskRejected.outcome.acceptable), [0, 1]);
    assert.equal(obligation.rescueOverrideCount, 0);
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

  it("restores only the least-risk committed survivor when Risk empties the intersection", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 2);
    const rowSet = rows(state, [ACTION.GO, ACTION.FIRE],
      [state.cell(7, 3), state.cell(4, 4)], [0, 1]);
    const obligation = new EscapeObligation();
    evaluate(obligation, bundle, rowSet);
    const controller = controllerFor(2, new Uint8Array([0, 1]));
    assert.equal(obligation.restrictRiskController(controller, state, 2), 1);
    assert.deepEqual(Array.from(controller.outcome.acceptable), [1, 0]);
    assert.equal(controller.noAcceptableAction, 0);
    assert.equal(obligation.rescueOverrideCount, 1);
  });

  it("never revives known immediate death over an unknown committed survivor", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 2);
    const rowSet = rows(state, [ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT],
      [state.cell(7, 3), state.cell(7, 3), state.cell(4, 4)], [0, 0, 1]);
    const obligation = new EscapeObligation();
    assert.equal(evaluate(obligation, bundle, rowSet), SUPPORT_STATUS.COMPLETE);
    assert.deepEqual(Array.from(obligation.member.slice(0, 3)), [1, 1, 0]);

    const controller = controllerFor(3, new Uint8Array([0, 0, 0]));
    controller.outcome.immediateFatalMass[0] = 10000;
    controller.outcome.horizonFatalMass[0] = 10000;
    controller.outcome.unknownMass[1] = 10000;
    assert.equal(obligation.restrictRiskController(controller, state, 3), 1);
    assert.deepEqual(Array.from(controller.outcome.acceptable), [0, 1, 0],
      "a known-fatal EO member must not be revived beside a less-certain survivor");
    assert.equal(controller.acceptableCount, 1);
    assert.equal(controller.noAcceptableAction, 0);
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

  it("selects a strict final rescue only from complete proven-viable Hard rows", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 2);
    const rowSet = rows(state, [ACTION.GO, ACTION.FIRE, ACTION.CAST_POISON],
      [state.cell(7, 3), state.cell(4, 4), state.cell(7, 3)], [0, 1, 0]);
    const obligation = new EscapeObligation();
    assert.equal(evaluate(obligation, bundle, rowSet), SUPPORT_STATUS.COMPLETE);
    assert.equal(obligation.successorProof[1], SUCCESSOR_PROOF.PROVEN_DEAD);
    obligation.successorExposed[0] = 0; obligation.successorSlack[0] = 3;
    obligation.successorBranches[0] = 3; obligation.successorCoverage[0] = 1;
    obligation.successorExposed[2] = 1; obligation.successorSlack[2] = 1;
    obligation.successorBranches[2] = 1; obligation.successorCoverage[2] = 1;
    assert.equal(obligation.strictRescueCandidate(1, rowSet.hard, 3), 0);
    assert.equal(obligation.strictRescueDeadPreferredCount, 1);
    assert.equal(obligation.strictRescueCandidateCount, 1);

    rowSet.hard[0] = HARD_STATUS.REJECT_PROVEN;
    assert.equal(obligation.strictRescueCandidate(1, rowSet.hard, 3), 2,
      "a Hard-rejected better row cannot be revived");
  });

  it("never turns NONE, incomplete support, or an unknown successor into strict rescue", () => {
    const { state, bundle } = openArena();
    placeProjectile(state, 0);
    const rowSet = rows(state, [ACTION.GO, ACTION.FIRE],
      [state.cell(5, 4), state.cell(4, 4)]);
    const obligation = new EscapeObligation();
    assert.equal(evaluate(obligation, bundle, rowSet), SUPPORT_STATUS.NONE);
    assert.equal(obligation.strictRescueCandidate(1, rowSet.hard, 2), -1);
    obligation.supportStatus = SUPPORT_STATUS.INCOMPLETE;
    obligation.successorProof[1] = SUCCESSOR_PROOF.PROVEN_DEAD;
    obligation.member[0] = 1;
    obligation.successorProof[0] = SUCCESSOR_PROOF.PROVEN_VIABLE;
    assert.equal(obligation.strictRescueCandidate(1, rowSet.hard, 2), -1);
    obligation.supportStatus = SUPPORT_STATUS.COMPLETE;
    obligation.successorProof[1] = SUCCESSOR_PROOF.UNKNOWN;
    assert.equal(obligation.strictRescueCandidate(1, rowSet.hard, 2), -1);
  });

  it("persists only a strictly better committed escape continuation", () => {
    const obligation = new EscapeObligation({ chanceSurvivalMass: true });
    const hard = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
    obligation.supportStatus = SUPPORT_STATUS.COMPLETE;
    obligation.continuationRequired = 1;
    obligation.member[0] = 1; obligation.member[1] = 1;
    obligation.successorProof[0] = SUCCESSOR_PROOF.PROVEN_VIABLE;
    obligation.successorProof[1] = SUCCESSOR_PROOF.PROVEN_VIABLE;
    obligation.successorCoverage[0] = 1; obligation.successorCoverage[1] = 1;
    obligation.successorSurvivalMass[0] = 10000;
    obligation.successorSurvivalMass[1] = 10000;
    obligation.successorExposed[0] = 1; obligation.successorExposed[1] = 0;
    obligation.successorSlack[0] = 3; obligation.successorSlack[1] = 3;
    obligation.successorBranches[0] = 3; obligation.successorBranches[1] = 3;
    assert.equal(obligation.persistentEscapeCandidate(0, hard, 2), 1);
    obligation.confirmPersistentEscape();
    assert.equal(obligation.persistentOverrideCount, 1);

    obligation.continuationRequired = 0;
    assert.equal(obligation.persistentEscapeCandidate(0, hard, 2), -1,
      "a current hazard without a prior selected escape member is not a persistent plan");
    obligation.continuationRequired = 1; hard[1] = HARD_STATUS.REJECT_PROVEN;
    assert.equal(obligation.persistentEscapeCandidate(0, hard, 2), -1,
      "persistent escape never revives a Hard-rejected row");

    obligation.successorExposed[0] = 1;
    assert.equal(obligation.activateAfterSelection(0), 1);
    obligation.successorExposed[1] = 0;
    assert.equal(obligation.activateAfterSelection(1), 0,
      "the plan ends as soon as the selected successor leaves committed exposure");
  });
});
