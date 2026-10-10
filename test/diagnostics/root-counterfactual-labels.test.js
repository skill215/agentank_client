"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const {
  actionObject,
  starProviderAfter,
  deterministicRandom,
  chanceBranchOptions,
  analysisOutcome,
  actionKey,
  sameTerminal,
  horizonSnapshot,
  observedAction,
  temporalEvidence,
  rootStratum,
  ResponseTraceBot,
  installContinuationAudit,
  candidateGeometry
} = require("../../tools/agentank/diagnostics/root-counterfactual-labels");

test("response policy traces are bounded integer action prefixes", () => {
  const trace = new ResponseTraceBot({ decide() {
    return { action: { type: "fire" }, logs: [], runtimeMs: 0 };
  } }, 2);
  trace.record({ type: "go" });
  trace.decide({});
  trace.decide({});
  assert.deepEqual(trace.actions, [ACTION.GO, ACTION.FIRE]);
});

test("root sampling strata prefer search and committed physical evidence", () => {
  assert.equal(rootStratum({ source: "INFORMATION" }), "INFORMATION_SEARCH");
  assert.equal(rootStratum({ source: "PHYSICAL" }), "PHYSICAL_SEARCH");
  assert.equal(rootStratum({ source: "NONE", committedBombCount: 1 }),
    "COMMITTED_HAZARD");
  assert.equal(rootStratum({ source: "NONE", enemyVisible: true,
    ownEnemyDistance: 8 }), "TACTICAL_CONTACT_NO_SEARCH");
  assert.equal(rootStratum({ source: "NONE", enemyVisible: true,
    ownEnemyDistance: 12 }), "STRATEGIC_NAVIGATION");
});

test("root counterfactual action conversion is deterministic and teleport-aware", () => {
  const state = { x: cell => cell % 20, y: cell => (cell / 20) | 0 };
  assert.deepEqual(actionObject(ACTION.GO, 0xffff, state), { type: "go" });
  assert.deepEqual(actionObject(ACTION.TURN_LEFT, 0xffff, state),
    { type: "turn", side: "left" });
  assert.deepEqual(actionObject(ACTION.CAST_POISON, 0xffff, state),
    { type: "poison" });
  assert.deepEqual(actionObject(ACTION.CAST_TELEPORT, 43, state),
    { type: "teleport", x: 3, y: 2 });
  assert.equal(actionObject(ACTION.CAST_TELEPORT, 0xffff, state), null);
});

test("branch star providers start strictly after the cloned physical frame", () => {
  const provider = starProviderAfter([
    { frame: 0, position: [1, 1] },
    { frame: 8, position: [2, 2] },
    { frame: 15, position: [3, 3] }
  ], 8);
  assert.equal(provider({ frame: 10 }), null);
  assert.deepEqual(provider({ frame: 15 }), [3, 3]);
  assert.equal(provider({ frame: 16 }), null);
});

test("chance outcomes preserve history or use repeatable independent RNG", () => {
  const root = { frame: 8, hashLo: 123, hashHi: 456 };
  const scenario = { fingerprint: "scenario-a", stars: [
    { frame: 15, position: [3, 3] }
  ] };
  const historical = chanceBranchOptions(root, scenario, 0, "HISTORICAL");
  assert.equal(historical.chanceSeed, null);
  assert.deepEqual(historical.cloneOptions.starProvider({ frame: 15 }), [3, 3]);
  const first = chanceBranchOptions(root, scenario, 0, "RANDOM0");
  const second = chanceBranchOptions(root, scenario, 0, "RANDOM0");
  const other = chanceBranchOptions(root, scenario, 0, "RANDOM1");
  assert.equal(first.cloneOptions.starProvider, null);
  assert.equal(first.chanceSeed, second.chanceSeed);
  assert.notEqual(first.chanceSeed, other.chanceSeed);
  assert.deepEqual([first.cloneOptions.rng(), first.cloneOptions.rng()],
    [second.cloneOptions.rng(), second.cloneOptions.rng()]);
  assert.notDeepEqual([deterministicRandom(1)(), deterministicRandom(1)()],
    [deterministicRandom(2)(), deterministicRandom(2)()]);
});

test("runtime-independent terminal classification treats tied frame limit as draw", () => {
  const simulator = {
    players: [
      { crashed: false, stars: 2 },
      { crashed: false, stars: 2 }
    ],
    frame: 128,
    maxFrames: 128,
    result: { winner: 0, reason: "runtime" }
  };
  assert.equal(analysisOutcome(simulator, 0), "DRAW");
  simulator.players[0].stars = 3;
  assert.equal(analysisOutcome(simulator, 0), "V2_WIN");
});

test("root counterfactual action keys distinguish turn side and teleport target", () => {
  assert.notEqual(actionKey({ type: "turn", side: "left" }),
    actionKey({ type: "turn", side: "right" }));
  assert.notEqual(actionKey({ type: "teleport", x: 1, y: 2 }),
    actionKey({ type: "teleport", x: 2, y: 1 }));
  assert.equal(actionKey({ type: "fire" }), "fire:::");
});

test("selected action reproduction compares every runtime-independent terminal field", () => {
  const terminal = {
    outcome: "DRAW", frame: 128, reason: "frameLimit",
    candidateStars: 2, controlStars: 2,
    candidateCrashed: false, controlCrashed: false
  };
  assert.equal(sameTerminal(terminal, { ...terminal }), true);
  assert.equal(sameTerminal(terminal, { ...terminal, candidateStars: 3 }), false);
  assert.equal(sameTerminal(terminal, { ...terminal, frame: 127 }), false);
});

test("horizon snapshots use candidate-relative positions and outcomes", () => {
  const value = horizonSnapshot({
    frame: 12,
    result: null,
    players: [
      { position: [1, 2], stars: 3, crashed: false },
      { position: [4, 4], stars: 1, crashed: true }
    ]
  }, 0, 8);
  assert.equal(value.delta, 4);
  assert.equal(value.tankDistance, 5);
  assert.equal(value.candidateStars, 3);
  assert.equal(value.controlCrashed, true);
});

test("continuation audit records requested row and whether ownership committed", () => {
  const engine = {
    diagnosticPriorContinuation: 0,
    multiFrameRisk: { recommendedContinuation() { return ACTION.FIRE; } },
    riskController: { commitContinuation(row) { return row === 3 ? 1 : 0; } }
  };
  installContinuationAudit(engine);
  assert.equal(engine.multiFrameRisk.recommendedContinuation({}), ACTION.FIRE);
  assert.equal(engine.riskController.commitContinuation(3), 1);
  assert.equal(engine.diagnosticPriorContinuation, ACTION.FIRE);
  assert.equal(engine.diagnosticContinuationRow, 3);
  assert.equal(engine.diagnosticContinuationCommitted, 1);
});

test("temporal evidence uses only the bounded action prefix", () => {
  assert.equal(observedAction({ type: "turn", side: "left" }),
    ACTION.TURN_LEFT);
  assert.equal(observedAction({ type: "poison" }), ACTION.CAST_POISON);
  assert.deepEqual(temporalEvidence(
    [ACTION.GO, ACTION.FIRE, ACTION.FIRE, ACTION.FIRE, ACTION.FIRE],
    [ACTION.TURN_LEFT, ACTION.GO, ACTION.FIRE, ACTION.CAST_STUN]), {
    recentOwnActions: [ACTION.FIRE, ACTION.FIRE, ACTION.FIRE, ACTION.FIRE],
    recentEnemyActions: [ACTION.TURN_LEFT, ACTION.GO, ACTION.FIRE,
      ACTION.CAST_STUN],
    ownLastAction: ACTION.FIRE,
    enemyLastAction: ACTION.CAST_STUN,
    ownRepeatLength: 4,
    enemyRepeatLength: 1,
    ownRecentFireCount: 4,
    enemyRecentFireCount: 1,
    ownRecentAggressionCount: 4,
    enemyRecentAggressionCount: 2
  });
});

test("candidate geometry records relative combat, mobility and star progress", () => {
  const arrays = [];
  arrays[require("../../engine-v2/src/state/fast-state").ARRAY.TANK_CELL] =
    Uint16Array.from([11, 14]);
  arrays[require("../../engine-v2/src/state/fast-state").ARRAY.TANK_DIR] =
    Uint8Array.from([1, 3]);
  arrays[require("../../engine-v2/src/state/fast-state").ARRAY.SCALAR] =
    new Uint16Array(32);
  arrays[require("../../engine-v2/src/state/fast-state").ARRAY.SCALAR][
    require("../../engine-v2/src/state/fast-state").SCALAR.STAR_CELL] = 18;
  arrays[require("../../engine-v2/src/state/fast-state").ARRAY.TERRAIN] =
    new Uint8Array(25);
  const x = cell => cell % 5; const y = cell => (cell / 5) | 0;
  const engine = {
    adapter: { state: { arrays, width: 5, height: 5, cells: 25 } },
    manhattan(left, right) { return Math.abs(x(left) - x(right)) +
      Math.abs(y(left) - y(right)); },
    directionTo(left, right) {
      if (y(left) === y(right)) return x(right) > x(left) ? 1 : 3;
      if (x(left) === x(right)) return y(right) > y(left) ? 2 : 0;
      return -1;
    },
    target(cell, direction) {
      const nx = x(cell) + [0, 1, 0, -1][direction];
      const ny = y(cell) + [-1, 0, 1, 0][direction];
      return nx < 0 || nx >= 5 || ny < 0 || ny >= 5 ? 0xffff : ny * 5 + nx;
    },
    clearLine() { return 1; },
    countMobility(cell) { return cell === 12 ? 4 : 2; },
    starDistance(cell) { return Math.abs(x(18) - x(cell)) +
      Math.abs(y(18) - y(cell)); }
  };
  assert.deepEqual(candidateGeometry(engine, 12, 1), {
    projectedEnemyDistance: 2,
    projectedOwnFacesEnemy: true,
    projectedEnemyFacesOwn: true,
    projectedClearLineToEnemy: true,
    projectedMobility: 4,
    projectedOpenDegree: 4,
    projectedForwardClearance: 2,
    projectedJunctionDistance: 0,
    projectedEnemyPathDistance: 2,
    projectedStarDistance: 2,
    projectedStarProgress: 1
  });
});
