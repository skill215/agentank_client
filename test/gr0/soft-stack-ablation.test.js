"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { RiskAcceptanceController } =
  require("../../engine-v2/src/search/risk-acceptance-controller");
const { SAFETY_STATUS, SafetyOutcomeSlab } =
  require("../../engine-v2/src/search/information-safety-closure");
const {
  SOFT_MODE,
  MODE_FLAGS,
  committedOnlyRiskView,
  installSoftStackAblation
} = require("../../tools/agentank/diagnostics/soft-stack-ablation-runtime");
const {
  MODES,
  DISCOVERY_SCENARIOS,
  HOLDOUT_SCENARIOS,
  splitScenarioIds,
  summaryFor,
  compareModes,
  discoveryGate,
  holdoutGate
} = require("../../tools/agentank/diagnostics/soft-stack-ablation");
const { loadRollingV1ScenariosForIds } =
  require("../../tools/agentank/simulation/historical-scenarios");
const { SUBJECT_TANK_ID } = require("../../tools/agentank/simulation/dd9-assignment");

function boxedMap(width = 7, height = 7) {
  return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "x" : "."));
}

function side(id, position, direction, skillType, calls) {
  return {
    tank: position ? { id, position: position.slice(), direction, crashed: false } : null,
    stars: 0,
    bullet: null,
    skill: { type: skillType, remainingCooldownFrames: 1 },
    effects: { self: null, debuff: null },
    status: {
      shielded: false,
      frozen: false,
      stunned: false,
      overloaded: false,
      cloaked: false,
      poisoned: false,
      boosted: false,
      fireLocked: false,
      bombActive: false,
      bombCooldownFrames: 1,
      canActThisFrame: true,
      actionSpeed: 1
    },
    go() { calls.push("GO"); },
    turn(value) { calls.push(`TURN:${value}`); },
    fire() { calls.push("FIRE"); },
    throwBomb() { calls.push("BOMB"); },
    poison() { calls.push("POISON"); }
  };
}

function engineDecision(engine, frame) {
  const calls = [];
  const me = side("own", [2, 3], "up", "poison", calls);
  const enemy = side("enemy", [5, 3], "left", "stun", []);
  const game = { frames: frame, map: boxedMap(), star: [3, 3], bombs: [] };
  const action = engine.decide(me, enemy, game);
  return { action, calls };
}

function slabSnapshot(slab, count) {
  const names = [
    "status", "earliestFatalFrame", "immediateFatalMass", "horizonFatalMass",
    "unknownMass", "escapeSlack", "coverage", "deathMass", "committedDeathMass",
    "possibleProjectileDeathMass", "futureFireDeathMass", "strategyRiskApplied",
    "possibleProjectileStrategyApplied", "futureFireStrategyApplied",
    "committedDeadlineFrames", "chanceSupportCount", "chanceFatalSupportCount",
    "futureFireDepth"
  ];
  return Object.fromEntries(names.map(name => [name, Array.from(slab[name].slice(
    0, name.endsWith("DeathMass") || name === "deathMass" ? count * 4 : count))]));
}

function compact(id, outcome, stars, overrides = {}) {
  return {
    matchId: id,
    historicalMatchUrlId: id.split(":")[0],
    scenarioFingerprint: `fp-${id.split(":")[0]}`,
    variantId: overrides.variantId || "NATIVE_V1_SEAT0",
    family: "NATIVE",
    repetition: overrides.repetition || 0,
    v2Seat: overrides.v2Seat || 0,
    analysisOutcome: outcome,
    terminalCategory: overrides.terminalCategory || "FRAME_LIMIT_STARS",
    stars,
    v2: {
      actionCounts: overrides.actionCounts || { GO: 1 },
      actionStream: overrides.actionStream || "AA==",
      arguments: [],
      timeoutCount: overrides.timeoutCount || 0,
      errorCount: overrides.errorCount || 0,
      layerTotals: {
        hardRejects: 0,
        selectedHardRejects: 0,
        avoidableHardRejects: overrides.avoidableHardRejects || 0,
        proofWins: 0,
        noAcceptableActions: 0,
        riskDominatedSelections: overrides.riskDominatedSelections || 0,
        stageMatrixSolves: 1,
        escapeRestrictions: 0,
        escapeRescueOverrides: 0,
        rootRestoreFailures: overrides.rootRestoreFailures || 0,
        fallbacks: 0
      }
    }
  };
}

test("SS-A0 CURRENT wrapper is a strict no-op and preserves action fingerprints", () => {
  const plain = new ProductionRootEngine();
  const wrapped = new ProductionRootEngine();
  const refine = wrapped.refineObservationSafety;
  const envelopes = wrapped.informationSearch.applyRiskEnvelopes;
  const populate = wrapped.riskController.populate;
  const continuation = wrapped.multiFrameRisk.recommendedContinuation;
  const installation = installSoftStackAblation(wrapped, SOFT_MODE.CURRENT);
  assert.equal(installation.riskView, null);
  assert.equal(wrapped.refineObservationSafety, refine);
  assert.equal(wrapped.informationSearch.applyRiskEnvelopes, envelopes);
  assert.equal(wrapped.riskController.populate, populate);
  assert.equal(wrapped.multiFrameRisk.recommendedContinuation, continuation);
  assert.deepEqual(engineDecision(wrapped, 1), engineDecision(plain, 1));
});

test("SS-A0 committed-only risk view preserves committed mass and clears only soft dimensions", () => {
  const source = new SafetyOutcomeSlab();
  const target = new SafetyOutcomeSlab();
  source.reset(2);
  source.status[0] = SAFETY_STATUS.UNKNOWN;
  source.unknownMass[0] = 9876;
  source.escapeSlack[0] = -4;
  source.coverage[0] = 1234;
  source.committedDeadlineFrames[0] = 11;
  source.chanceSupportCount[0] = 3;
  source.chanceFatalSupportCount[0] = 2;
  source.addDeath(0, 2, 2500);
  source.addPossibleProjectile(0, 1, 1250);
  source.addFutureFire(0, 4, 3750);
  source.possibleProjectileStrategyApplied[0] = 1;
  source.futureFireStrategyApplied[0] = 1;
  source.status[1] = SAFETY_STATUS.PROVEN_DEAD;
  source.addFutureFire(1, 1, 10000);
  const before = slabSnapshot(source, 2);
  committedOnlyRiskView(source, target, 2);
  assert.deepEqual(slabSnapshot(source, 2), before, "original SafetyOutcome must be immutable");
  assert.deepEqual(Array.from(target.committedDeathMass.slice(0, 8)),
    Array.from(source.committedDeathMass.slice(0, 8)));
  assert.deepEqual(Array.from(target.possibleProjectileDeathMass.slice(0, 8)),
    new Array(8).fill(0));
  assert.deepEqual(Array.from(target.futureFireDeathMass.slice(0, 8)), new Array(8).fill(0));
  assert.equal(target.horizonFatalMass[0], 2500);
  assert.equal(target.unknownMass[0], 0);
  assert.equal(target.escapeSlack[0], 0);
  assert.equal(target.coverage[0], 10000);
  assert.equal(target.status[0], SAFETY_STATUS.POSSIBLE_DEATH);
  assert.equal(target.status[1], SAFETY_STATUS.PROVEN_SAFE,
    "future-FIRE-only PROVEN_DEAD cannot survive a committed-only projection");
  assert.equal(target.committedDeadlineFrames[0], 11);
  assert.equal(target.chanceSupportCount[0], 3);
  assert.equal(target.chanceFatalSupportCount[0], 2);
});

test("SS-A0 committed-only populate uses a preallocated view without touching Hard or Proof", () => {
  const controller = new RiskAcceptanceController();
  const originalPopulate = controller.populate;
  const source = new SafetyOutcomeSlab();
  source.reset(1);
  source.status[0] = SAFETY_STATUS.UNKNOWN;
  source.unknownMass[0] = 10000;
  source.addDeath(0, 2, 500);
  source.addFutureFire(0, 1, 9000);
  source.futureFireStrategyApplied[0] = 1;
  const hard = new Uint8Array([HARD_STATUS.ALLOW]);
  const proof = new Uint8Array([77]);
  const engine = {
    refineObservationSafety() { return 9; },
    informationSearch: { applyRiskEnvelopes() { return 8; } },
    riskController: controller,
    multiFrameRisk: { recommendedContinuation() { return ACTION.GO; } }
  };
  const installed = installSoftStackAblation(engine, SOFT_MODE.COMMITTED_ONLY_RISK);
  const before = slabSnapshot(source, 1);
  controller.populate(1, hard, source, new Int16Array([100]), null, null, 0);
  assert.deepEqual(slabSnapshot(source, 1), before);
  assert.deepEqual(Array.from(hard), [HARD_STATUS.ALLOW]);
  assert.deepEqual(Array.from(proof), [77]);
  assert.equal(controller.outcome.committedFatalMass[0], 500);
  assert.equal(controller.outcome.futureFireFatalMass[0], 0);
  assert.equal(controller.outcome.possibleProjectileFatalMass[0], 0);
  assert.equal(controller.outcome.unknownMass[0], 0);
  assert.equal(engine.multiFrameRisk.recommendedContinuation(), ACTION.NONE);
  assert.equal(installed.riskView, installed.riskView);
  assert.notEqual(controller.populate, originalPopulate);
});

test("SS-A0 individual and combined modes install exactly the registered effects", () => {
  function fake() {
    return {
      refineObservationSafety() { return 7; },
      informationSearch: { applyRiskEnvelopes() { return 6; } },
      riskController: new RiskAcceptanceController(),
      multiFrameRisk: { recommendedContinuation() { return ACTION.GO; } }
    };
  }
  const observation = fake();
  installSoftStackAblation(observation, SOFT_MODE.NO_OBSERVATION_FRONTIER);
  assert.equal(observation.refineObservationSafety(), 0);
  assert.equal(observation.informationSearch.applyRiskEnvelopes(), 6);

  let supportComplete = 0; let guardedCalls = 0;
  const guarded = fake();
  guarded.observationSafetySupportComplete = () => supportComplete;
  guarded.refineObservationSafety = () => { guardedCalls += 1; return 7; };
  installSoftStackAblation(guarded,
    SOFT_MODE.INCOMPLETE_OBSERVATION_FRONTIER_BYPASS);
  assert.equal(guarded.refineObservationSafety(), 0);
  assert.equal(guardedCalls, 0);
  supportComplete = 1;
  assert.equal(guarded.refineObservationSafety(), 7);
  assert.equal(guardedCalls, 1);

  const envelopes = fake();
  installSoftStackAblation(envelopes, SOFT_MODE.NO_INFORMATION_ENVELOPES);
  assert.equal(envelopes.refineObservationSafety(), 7);
  assert.equal(envelopes.informationSearch.applyRiskEnvelopes(), 0);

  const combined = fake();
  const installation = installSoftStackAblation(combined, SOFT_MODE.SOFT_ALL_OFF);
  assert.deepEqual(installation.flags, {
    observation: 0, committedOnly: 1, envelopes: 1
  });
  assert.equal(combined.refineObservationSafety(), 7);
  assert.equal(combined.informationSearch.applyRiskEnvelopes(), 0);
  assert.equal(combined.multiFrameRisk.recommendedContinuation(), ACTION.NONE);
  assert.deepEqual(MODE_FLAGS[SOFT_MODE.SOFT_ALL_OFF], {
    observation: 0, committedOnly: 1, envelopes: 1
  });
});

test("SS-A0 split is deterministic, disjoint, complete, and fingerprint-based", () => {
  const entries = Array.from({ length: 266 }, (_, index) => ({
    id: `match-${index}`,
    fingerprint: `fingerprint-${265 - index}`
  }));
  const split = splitScenarioIds(entries);
  assert.equal(split.discovery.length, DISCOVERY_SCENARIOS);
  assert.equal(split.holdout.length, HOLDOUT_SCENARIOS);
  assert.equal(new Set([...split.discovery, ...split.holdout]).size, 266);
  assert.deepEqual(split, splitScenarioIds(entries.slice().reverse()));
  const changed = entries.map(entry => ({ ...entry }));
  changed[0].fingerprint = "changed-fingerprint";
  assert.notEqual(split.completeFingerprint, splitScenarioIds(changed).completeFingerprint);
});

test("SS-A0 selective loader never opens unrequested Holdout payloads", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ss-a0-selective-"));
  try {
    const records = path.join(root, "battle-records");
    fs.mkdirSync(path.join(records, "index"), { recursive: true });
    fs.mkdirSync(path.join(records, "requested"), { recursive: true });
    const map = boxedMap(5, 5);
    const raw = {
      participants: {
        challenger: { tankId: SUBJECT_TANK_ID },
        defender: { tankId: 999999 }
      },
      match: { urlId: "requested-match", mapHash: "map-hash" },
      replayData: {
        matchSeed: "1",
        map: {
          map,
          players: [
            { position: [1, 1], direction: "right" },
            { position: [3, 3], direction: "left" }
          ]
        },
        replay: {
          records: [[{ type: "star", action: "created", position: [2, 2] }]],
          meta: { result: null }
        }
      }
    };
    fs.writeFileSync(path.join(records, "requested", "raw.json"), JSON.stringify(raw));
    fs.writeFileSync(path.join(records, "index", "match-index.json"), JSON.stringify({
      entries: [
        { matchId: "requested-match", complete: true, preferredPath: "requested" },
        { matchId: "sealed-holdout", complete: true, preferredPath: "does-not-exist" }
      ]
    }));
    const loaded = loadRollingV1ScenariosForIds(["requested-match"], root);
    assert.equal(loaded.scenarios.length, 1);
    assert.equal(loaded.scenarios[0].matchUrlId, "requested-match");
    assert.equal(loaded.sourceIndex.requestedMatches, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("SS-A0 W/L/D, star delta, action and invariant summaries reconcile exactly", () => {
  const records = [
    compact("a:NATIVE_V1_SEAT0:r0", "V2_WIN", [3, 1]),
    compact("b:NATIVE_V1_SEAT0:r0", "DRAW", [2, 2], { actionCounts: { FIRE: 2 } }),
    compact("c:NATIVE_V1_SEAT0:r0", "V1_WIN", [0, 4], {
      terminalCategory: "SINGLE_CRASH", avoidableHardRejects: 1
    })
  ];
  const summary = summaryFor(records);
  assert.deepEqual([summary.v2Wins, summary.v1Wins, summary.draws, summary.scoreUnits,
    summary.scoreRatePer10000], [1, 1, 1, 3, 5000]);
  assert.equal(summary.starDelta, -2);
  assert.deepEqual(summary.v2ActionCounts, { GO: 2, FIRE: 2 });
  assert.equal(summary.v2SingleCrashLosses, 1);
  assert.equal(summary.counters.avoidableHardRejects, 1);
});

test("SS-A0 transition matrix and discovery/holdout gates use preregistered thresholds", () => {
  const variants = MODES.slice(0, 4);
  const current = [];
  const candidate = [];
  for (let index = 0; index < 100; index += 1) {
    const variantId = variants[index % variants.length];
    current.push(compact(`m${index}:${variantId}:r0`,
      index < 40 ? "V2_WIN" : index < 50 ? "DRAW" : "V1_WIN", [1, 1],
      { variantId, actionStream: "AA==" }));
    candidate.push(compact(`m${index}:${variantId}:r0`,
      index < 44 ? "V2_WIN" : index < 52 ? "DRAW" : "V1_WIN", [2, 1],
      { variantId, actionStream: index < 8 ? "AQ==" : "AA==" }));
  }
  // compareModes requires all four production variant IDs.
  for (let index = 0; index < current.length; index += 1) {
    current[index].variantId = require("../../tools/agentank/simulation/paired-arena")
      .VARIANTS[index % 4].variantId;
    candidate[index].variantId = current[index].variantId;
  }
  const comparison = compareModes(current, candidate);
  assert.equal(comparison.transitions.V1_WIN_TO_V2_WIN || 0, 0);
  assert.equal(comparison.transitions.DRAW_TO_V2_WIN, 4);
  assert.equal(comparison.transitions.V1_WIN_TO_DRAW, 2);
  assert.equal(comparison.behaviorChanges, 8);
  assert.equal(comparison.starDeltaGain, 100);
  assert.equal(discoveryGate(comparison).checks.scoreGainAtLeast3Points, true);
  assert.equal(holdoutGate(comparison).checks.starDeltaImprovesAtLeast136, false);
});
