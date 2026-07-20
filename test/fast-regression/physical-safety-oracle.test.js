"use strict";

const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { FastRegressionStore } = require("../../tools/agentank/fast-regression/artifact-store");
const { rehydratePhysical } = require("../../tools/agentank/fast-regression/rehydrate");
const { PHYSICAL_SAFETY_STATUS, commandSupport, chanceMasks, partitionByObservation,
  PhysicalSafetyOracle } =
  require("../../tools/agentank/fast-regression/physical-safety-oracle");
const { VERDICT, commandForActionName, selectCases, classifyVerdict } =
  require("../../tools/agentank/fast-regression/physical-safety-classifier");

const workspaceRoot = path.resolve(__dirname, "../..");

function player(index, position) {
  return { index, objectId: `tank-${index}`, position: position.slice(), direction: "right",
    stars: 0, crashed: false, skillType: null, skillCooldownUntil: 0, bombCooldownUntil: 0,
    effects: { self: null, debuff: null } };
}

class HiddenChoiceWorld {
  constructor(options = {}) {
    this.frame = options.frame || 0; this.reveal = Boolean(options.reveal);
    this.rng = options.rng || (() => 0.25); this.map = [["."]];
    this.players = [player(0, [0, 0]), player(1, [1, 1])];
    this.players[0].effects.debuff = this.frame === 0 ? { type: "stun", expiresAt: 1 } : null;
    this.bullets = []; this.bombs = []; this.star = null; this.nextStarSpawnFrame = 99;
    this.nextObjectId = 1; this.result = null; this.mode = options.mode ?? -1;
  }
  clone(options = {}) {
    const copy = new HiddenChoiceWorld({ frame: this.frame, reveal: this.reveal,
      rng: options.rng || this.rng, mode: this.mode });
    copy.players = this.players.map(value => ({ ...value, position: value.position.slice(),
      effects: { self: value.effects.self ? { ...value.effects.self } : null,
        debuff: value.effects.debuff ? { ...value.effects.debuff } : null } }));
    copy.result = this.result ? { ...this.result } : null; return copy;
  }
  snapshotFor(seat) {
    const hidden = !this.reveal && this.frame > 0;
    return { me: { tank: { id: `tank-${seat}`, position: [0, 0], direction: "right" },
      stars: 0, bullet: null, skill: null, status: {}, effects: {} },
    enemy: { tank: hidden ? null : { id: `tank-${seat ^ 1}`,
      position: this.players[seat ^ 1].position.slice(), direction: "left" },
    stars: 0, bullet: null, skill: null, status: {}, effects: {} },
    game: { frames: this.frame, star: null, map: [["."]], bombs: [] } };
  }
  step(actions) {
    if (this.result) return [];
    if (this.frame === 0) {
      this.mode = this.rng() < 0.5 ? 0 : 1;
      this.players[1].position = this.mode === 0 ? [2, 1] : [1, 2];
      this.players[0].effects.debuff = null;
    } else {
      const own = actions[0];
      const survives = this.mode === 0 ? own?.type === "go" :
        own?.type === "turn" && own.side === "left";
      if (!survives) { this.players[0].crashed = true;
        this.result = { winner: 1, reason: "synthetic" }; }
    }
    this.frame += 1; return [];
  }
}

test("physical Safety support exposes explicit incomplete skill programs", () => {
  const teleport = { frame: 3, players: [player(0, [0, 0]), player(1, [1, 1])] };
  teleport.players[0].skillType = "teleport";
  assert.deepEqual(commandSupport(teleport, 0).complete, false);
  teleport.players[0].skillType = "boost";
  teleport.players[0].effects.self = { type: "boost", expiresAt: 9 };
  assert.equal(commandSupport(teleport, 0).reason, "BOOST_COMPOUND_SUPPORT");
  assert.deepEqual(chanceMasks(2), [0, 1, 2, 3]);
  assert.equal(chanceMasks(5), null);
});

test("physical Safety classifier admits only frozen continuation obligations", () => {
  const frame = { frame: 7, distanceToTerminal: 2,
    modelClass: "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES" };
  const report = { results: [{ role: "PRIMARY_LOSS", fingerprint: "capsule",
    frames: [frame] }] };
  const corpus = { continuationCandidates: [{ capsuleFingerprint: "capsule", frame: 7 }] };
  assert.equal(selectCases(report, corpus).length, 1);
  assert.throws(() => selectCases(report, { continuationCandidates: [] }), error =>
    error.code === "PHYSICAL_SAFETY_CASE_NOT_IN_FROZEN_CORPUS");
  assert.deepEqual(commandForActionName("CAST_POISON"), { type: "poison" });
  assert.equal(classifyVerdict({ status: PHYSICAL_SAFETY_STATUS.UNKNOWN, complete: false }),
    VERDICT.UNKNOWN);
});

test("physical Safety partitions worlds only after observation", () => {
  const hidden = [new HiddenChoiceWorld({ frame: 1, mode: 0 }),
    new HiddenChoiceWorld({ frame: 1, mode: 1 })];
  hidden[0].players[1].position = [2, 1]; hidden[1].players[1].position = [1, 2];
  assert.equal(partitionByObservation(hidden, 0).size, 1);
  hidden.forEach(world => { world.reveal = true; });
  assert.equal(partitionByObservation(hidden, 0).size, 2);
});

test("physical Safety forbids different actions for hidden worlds in one information set", () => {
  const hidden = new PhysicalSafetyOracle({ transitionBudget: 10000, nodeBudget: 1000 });
  const hiddenResult = hidden.classifyRoot(new HiddenChoiceWorld(), 0, { type: "go" }, 2);
  assert.equal(hiddenResult.status, PHYSICAL_SAFETY_STATUS.NO_WITNESS);
  assert.equal(hiddenResult.complete, true);
  assert.equal(hiddenResult.counterexample.continuation.reason, "ALL_ACTIONS_REFUTED");

  const visible = new PhysicalSafetyOracle({ transitionBudget: 10000, nodeBudget: 1000 });
  const visibleResult = visible.classifyRoot(new HiddenChoiceWorld({ reveal: true }),
    0, { type: "go" }, 2);
  assert.equal(visibleResult.status, PHYSICAL_SAFETY_STATUS.WINDOW_SAFE);
  assert.equal(visibleResult.complete, true);
  assert.equal(visibleResult.witnesses.length, 2);
});

test("physical Safety turns budget exhaustion into UNKNOWN, never WINDOW_SAFE", () => {
  const oracle = new PhysicalSafetyOracle({ transitionBudget: 0, nodeBudget: 0 });
  const result = oracle.classifyRoot(new HiddenChoiceWorld(), 0, { type: "go" }, 2);
  assert.equal(result.status, PHYSICAL_SAFETY_STATUS.UNKNOWN);
  assert.equal(result.complete, false);
  assert.ok(result.counters.incompleteReasons.includes("TRANSITION_BUDGET"));
});

test("real strict stun fixture has a concrete fatal ChanceOutcome", async () => {
  const store = new FastRegressionStore(workspaceRoot);
  const { capsule } = store.readCapsule(
    "ce7702f0d55f6c9444dcc0eb3e2358381fd43e2c2ae5643dfdc9dcbb6bb36b18");
  const { simulator } = await rehydratePhysical(workspaceRoot, capsule, 63);
  const oracle = new PhysicalSafetyOracle({ transitionBudget: 10000, nodeBudget: 1000 });
  const result = oracle.classifyRoot(simulator, capsule.assignment.v2Seat, { type: "go" }, 1);
  assert.equal(result.status, PHYSICAL_SAFETY_STATUS.NO_WITNESS);
  assert.equal(result.complete, true);
  assert.deepEqual({ ownAction: result.counterexample.ownAction,
    enemyAction: result.counterexample.enemyAction, chanceDraws: result.counterexample.chanceDraws,
    chanceMask: result.counterexample.chanceMask },
  { ownAction: "GO", enemyAction: "NONE", chanceDraws: 1, chanceMask: 1 });
});
