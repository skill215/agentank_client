"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RiskAcceptanceController } =
  require("../../engine-v2/src/search/risk-acceptance-controller");
const { SAFETY_STATUS } = require("../../engine-v2/src/search/information-safety-closure");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { StageMatrix, DoubleOracleSolver } = require("../../engine-v2/src/search/matrix");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { productionRootFixture } = require("../../tools/agentank/build/imp6-builder");
const { benchmarkFixture } = require("../../tools/agentank/benchmark/search-frontier-benchmark");
const { ProductionDiagnosticBot } =
  require("../../tools/agentank/simulation/production-diagnostic-bot");
const { FEATURE, FEATURE_OWNERSHIP } = require("../../engine-v2/src/abi/policy-codes");
const { FeatureRegistry } = require("../../engine-v2/src/policy/feature-registry");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { SafetyOutcomeSlab } =
  require("../../engine-v2/src/search/information-safety-closure");

function controllerFixture() {
  const controller = new RiskAcceptanceController(); const o = controller.outcome; o.reset(4);
  for (let row = 0; row < 4; row += 1) {
    o.hard[row] = HARD_STATUS.ALLOW; o.safety[row] = SAFETY_STATUS.PROVEN_SAFE;
    o.coverage[row] = 10000; o.escapeSlack[row] = row; o.robustLower[row] = 100 + row;
    o.expectedValue[row] = 100 + row; o.tacticalValue[row] = 100 + row;
  }
  o.immediateFatalMass[1] = 1; o.horizonFatalMass[2] = 1; o.unknownMass[3] = 1;
  return controller;
}

test("SR3 risk endpoints and integer thresholds preserve one percent worst contamination", () => {
  const controller = controllerFixture(); controller.thresholds(0, 0);
  assert.deepEqual([controller.immediateLimit, controller.unknownLimit,
    controller.horizonLimit, controller.minimumEscapeSlack], [0, 0, 0, 0]);
  controller.thresholds(100, 0);
  assert.deepEqual([controller.immediateLimit, controller.unknownLimit,
    controller.horizonLimit, controller.minimumEscapeSlack], [9900, 9900, 9900, -4]);
  assert.ok(controller.immediateLimit < 10000);
});

test("SR3 acceptable set is monotone from risk zero through one hundred", () => {
  let previous = 0;
  for (let risk = 0; risk <= 100; risk += 1) { const controller = controllerFixture();
    const count = controller.gate(risk, 0); assert.ok(count >= previous, `risk ${risk}`); previous = count; }
});

test("SR3 risk zero admits only complete no-death witnesses when one exists", () => {
  const controller = controllerFixture(); controller.gate(0, 0);
  assert.deepEqual(Array.from(controller.outcome.acceptable.slice(0, 4)), [1, 0, 0, 0]);
});

test("SR3 strictly risk-value dominated actions are never selected", () => {
  const controller = controllerFixture(); const o = controller.outcome;
  o.immediateFatalMass[0] = 0; o.robustLower[0] = 500; o.expectedValue[0] = 500;
  o.tacticalValue[0] = 500; o.escapeSlack[0] = 4;
  o.immediateFatalMass[1] = 100; o.robustLower[1] = 400;
  o.expectedValue[1] = 400; o.tacticalValue[1] = 400; controller.gate(100, 0);
  assert.equal(o.dominated[1], 1);
  for (let seed = 0; seed < 100; seed += 1) assert.notEqual(controller.select(seed), 1);
});

test("SR3 due Risk continuation is committed unless new evidence is strictly safer", () => {
  const make = count => { const controller = new RiskAcceptanceController();
    const outcome = controller.outcome; outcome.reset(count);
    for (let row = 0; row < count; row += 1) {
      outcome.hard[row] = HARD_STATUS.ALLOW; outcome.safety[row] = SAFETY_STATUS.POSSIBLE_DEATH;
      outcome.coverage[row] = 9999; outcome.unknownMass[row] = 1;
      outcome.earliestFatalFrame[row] = 3; outcome.escapeSlack[row] = 0;
      outcome.robustLower[row] = 0; outcome.expectedValue[row] = 0;
      outcome.tacticalValue[row] = 0;
    }
    return controller; };
  const controller = make(3); const o = controller.outcome;
  o.horizonFatalMass[0] = 1000; o.horizonFatalMass[1] = 1000;
  o.horizonFatalMass[2] = 1500; o.robustLower[0] = 900;
  o.robustLower[1] = 100; o.robustLower[2] = 1000;
  controller.gate(100, 0);
  assert.equal(controller.commitContinuation(1), 1);
  assert.equal(controller.select(0), 1,
    "one-step value must not postpone the evasion used by the prior recurrence");
  const invalidated = make(2); const p = invalidated.outcome;
  p.horizonFatalMass[0] = 100; p.horizonFatalMass[1] = 1000;
  invalidated.gate(100, 0);
  assert.equal(invalidated.commitContinuation(1), 0);
  assert.equal(invalidated.select(0), 0,
    "a newly observed strictly safer action supersedes the cached continuation");
});

test("SR3 Safety fatal support participates in ordered epsilon-contamination before safe floor", () => {
  const controller = new RiskAcceptanceController(); const safety = new SafetyOutcomeSlab();
  safety.reset(2);
  for (let row = 0; row < 2; row += 1) {
    safety.status[row] = SAFETY_STATUS.POSSIBLE_DEATH; safety.coverage[row] = 9999;
    safety.unknownMass[row] = 1; safety.escapeSlack[row] = -1;
    safety.futureFireStrategyApplied[row] = 1;
  }
  safety.addFutureFire(0, 3, 534); safety.addFutureFire(0, 4, 1068);
  safety.addFutureFire(1, 3, 534); safety.addFutureFire(1, 4, 801);
  controller.populate(2, new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    safety, new Int16Array([5778, 5738]), null, null, 0);
  controller.gate(35, 3);
  assert.ok(controller.outcome.robustLower[1] > controller.outcome.robustLower[0]);
  assert.equal(controller.select(0), 1,
    "a tiny nominal edge must not erase a modeled fatal-mass advantage");
});

test("committed ChanceOutcome fatal mass uses the dynamic risk threshold without becoming Hard", () => {
  const controller = new RiskAcceptanceController(); const o = controller.outcome;
  o.reset(2); o.hard.fill(HARD_STATUS.ALLOW, 0, 2);
  o.safety.fill(SAFETY_STATUS.POSSIBLE_DEATH, 0, 2);
  o.coverage.fill(10000, 0, 2); o.earliestFatalFrame.fill(4, 0, 2);
  o.nominalRobustLower.fill(1000, 0, 2); o.robustLower.fill(1000, 0, 2);
  o.committedChanceFatalMass[0] = 2500;
  o.committedChanceFatalMass[1] = 5000;
  assert.equal(controller.gate(65, 0), 1);
  assert.equal(o.acceptable[0], 1);
  assert.equal(o.acceptable[1], 0);
  assert.equal(o.hard[1], HARD_STATUS.ALLOW);
});

test("RST3 Safety robust backup is monotone while risk dominance remains structural", () => {
  let prior = -10001;
  for (let risk = 0; risk <= 100; risk += 1) {
    const controller = new RiskAcceptanceController(); const safety = new SafetyOutcomeSlab();
    safety.reset(1); safety.status[0] = SAFETY_STATUS.POSSIBLE_DEATH;
    safety.coverage[0] = 10000; safety.escapeSlack[0] = 0;
    safety.futureFireStrategyApplied[0] = 1;
    safety.addFutureFire(0, 2, 100);
    controller.populate(1, new Uint8Array([HARD_STATUS.ALLOW]), safety,
      new Int16Array([10000]), null, null, 0);
    controller.gate(risk, 0);
    assert.ok(controller.outcome.robustLower[0] >= prior, `risk ${risk}`);
    prior = controller.outcome.robustLower[0];
  }
  const controller = new RiskAcceptanceController(); const safety = new SafetyOutcomeSlab();
  safety.reset(2);
  for (let row = 0; row < 2; row += 1) {
    safety.status[row] = SAFETY_STATUS.POSSIBLE_DEATH; safety.coverage[row] = 10000;
    safety.escapeSlack[row] = 0;
  }
  safety.futureFireStrategyApplied[0] = 1;
  safety.addFutureFire(0, 2, 100);
  controller.populate(2, new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]), safety,
    new Int16Array([10000, 0]), null, null, 0);
  controller.gate(100, 0);
  assert.equal(controller.outcome.acceptable[0], 1,
    "risk 100 admits bounded exposure into the candidate set");
  assert.equal(controller.outcome.dominated[0], 1,
    "a zero-risk alternative still strictly risk-dominates it");
  assert.equal(controller.select(0), 1);
});

test("SR3 incomplete path masses gate actions but cannot rewrite the robust value", () => {
  const controller = new RiskAcceptanceController(); const safety = new SafetyOutcomeSlab();
  safety.reset(1); safety.status[0] = SAFETY_STATUS.POSSIBLE_DEATH;
  safety.coverage[0] = 5000; safety.escapeSlack[0] = 0;
  safety.addFutureFire(0, 2, 1000);
  controller.populate(1, new Uint8Array([HARD_STATUS.ALLOW]), safety,
    new Int16Array([700]), null, null, 0);
  controller.gate(100, 0);
  assert.equal(controller.outcome.robustLower[0], 700);
  assert.equal(controller.outcome.horizonFatalMass[0], 1000);
});

test("SR3 no acceptable action uses lexicographic risk without relaxing Hard", () => {
  const controller = controllerFixture(); const o = controller.outcome;
  for (let row = 0; row < o.count; row += 1) o.unknownMass[row] = 10000;
  o.hard[0] = HARD_STATUS.REJECT_PROVEN; controller.gate(100, 0);
  assert.equal(controller.noAcceptableAction, 1); assert.notEqual(controller.select(7), 0);
});

test("SR3 future-FIRE-only fallback keeps the conservative risk tuple", () => {
  const controller = new RiskAcceptanceController(); const safety = new SafetyOutcomeSlab();
  safety.reset(2);
  for (let row = 0; row < 2; row += 1) {
    safety.status[row] = SAFETY_STATUS.POSSIBLE_DEATH; safety.coverage[row] = 10000;
    safety.escapeSlack[row] = -1; safety.futureFireStrategyApplied[row] = 1;
  }
  safety.addFutureFire(0, 3, 1999); safety.addFutureFire(0, 4, 1999);
  safety.addFutureFire(1, 3, 1999); safety.addFutureFire(1, 4, 999);
  controller.populate(2, new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    safety, new Int16Array([972, 862]), null, null, 0);
  controller.gate(26, 3);
  assert.equal(controller.acceptableCount, 0);
  assert.deepEqual(Array.from(controller.outcome.futureFireFatalMass.slice(0, 2)),
    [3998, 2998]);
  assert.equal(controller.select(0), 1);
});

test("SR3 no-acceptable fallback is value-independent after the risk tuple differs", () => {
  const controller = controllerFixture(); const o = controller.outcome; o.reset(2);
  for (let row = 0; row < 2; row += 1) {
    o.hard[row] = HARD_STATUS.ALLOW; o.safety[row] = SAFETY_STATUS.POSSIBLE_DEATH;
    o.coverage[row] = 9999; o.unknownMass[row] = 1; o.earliestFatalFrame[row] = 1;
    o.escapeSlack[row] = -1; o.possibleProjectileFatalMass[row] = 1250;
  }
  o.immediateFatalMass[0] = 1916; o.horizonFatalMass[0] = 4904;
  o.robustLower[0] = -9438; o.expectedValue[0] = 5012; o.tacticalValue[0] = 774;
  o.immediateFatalMass[1] = 1583; o.horizonFatalMass[1] = 4197;
  o.robustLower[1] = -9821; o.expectedValue[1] = -5690; o.tacticalValue[1] = 1704;
  controller.gate(26, 3);
  assert.equal(controller.acceptableCount, 0);
  assert.equal(controller.select(0), 1);
  o.robustLower[0] = -9800; o.expectedValue[0] = -4000;
  assert.equal(controller.select(0), 1,
    "value changes cannot override the conservative risk tuple in emergency fallback");
});

test("RST3 heuristic robustLower is diagnostic and no longer a membership floor", () => {
  const controller = new RiskAcceptanceController(); const o = controller.outcome;
  o.reset(2);
  for (let row = 0; row < 2; row += 1) {
    o.hard[row] = HARD_STATUS.ALLOW;
    o.safety[row] = SAFETY_STATUS.POSSIBLE_DEATH;
    o.coverage[row] = 10000;
    o.earliestFatalFrame[row] = 4;
    o.escapeSlack[row] = 0;
  }
  // Both rows pass risk=100. Row 0 has greater modeled risk and therefore
  // cannot dominate row 1, while row 1 cannot dominate row 0's robust value.
  o.immediateFatalMass[0] = 100;
  o.horizonFatalMass[0] = 100;
  o.robustLower[0] = 500;
  o.expectedValue[0] = 0;
  o.tacticalValue[0] = 0;
  o.robustLower[1] = 400;
  o.expectedValue[1] = 10000;
  o.tacticalValue[1] = 10000;
  controller.gate(100, 0);
  assert.equal(controller.acceptableCount, 2);
  let diagnosticFloor = -10000;
  for (let row = 0; row < controller.outcome.count; row += 1)
    if (controller.outcome.acceptable[row] && !controller.outcome.dominated[row])
      diagnosticFloor = Math.max(diagnosticFloor, controller.outcome.robustLower[row]);
  assert.equal(controller.safeFloor, diagnosticFloor);
  assert.equal(controller.select(0), 1,
    "risk-qualified strategic actions may cross the heuristic robustLower floor");
});

test("GR0 Information search preserves full tactical and search cells", () => {
  const controller = new RiskAcceptanceController();
  const safety = new SafetyOutcomeSlab();
  safety.reset(2);
  for (let row = 0; row < 2; row += 1) {
    safety.status[row] = SAFETY_STATUS.POSSIBLE_DEATH;
    safety.coverage[row] = 10000;
    safety.unknownMass[row] = 100;
  }
  const information = {
    completedDepth: 1, supportComplete: 1, approximate: 0,
    rootScore: new Int32Array([200, -200]),
    rootCellScore: new Int32Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES * 2)
  };
  information.rootCellScore[0] = 400;
  information.rootCellScore[1] = -400;
  information.rootCellScore[SEARCH_CAPACITY.MAX_ENEMY_POLICIES] = 100;
  information.rootCellScore[SEARCH_CAPACITY.MAX_ENEMY_POLICIES + 1] = -100;
  controller.populate(2, new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    safety, new Int16Array([700, -300]), null, information, 2);
  assert.deepEqual(Array.from(controller.outcome.tacticalValue.slice(0, 2)),
    [700, -300]);
  assert.deepEqual(Array.from(controller.outcome.robustLower.slice(0, 2)),
    [800, -400]);
  assert.deepEqual(Array.from(controller.outcome.expectedValue.slice(0, 2)),
    [800, -400]);
  assert.deepEqual(Array.from(controller.outcome.worstValue.slice(0, 2)),
    [500, -350]);
});

test("SR3 no-acceptable fallback preserves possible projectile priority", () => {
  const controller = controllerFixture(); const o = controller.outcome; o.reset(2);
  for (let row = 0; row < 2; row += 1) {
    o.hard[row] = HARD_STATUS.ALLOW; o.safety[row] = SAFETY_STATUS.POSSIBLE_DEATH;
    o.coverage[row] = 9999; o.unknownMass[row] = 10000; o.earliestFatalFrame[row] = 1;
    o.escapeSlack[row] = -1; o.robustLower[row] = row ? 10000 : -10000;
    o.expectedValue[row] = o.robustLower[row]; o.tacticalValue[row] = o.robustLower[row];
  }
  o.possibleProjectileFatalMass[1] = 1;
  o.immediateFatalMass[1] = 1; o.horizonFatalMass[1] = 1;
  controller.gate(0, 0);
  assert.equal(controller.noAcceptableAction, 1);
  assert.equal(controller.select(0), 0,
    "known possible-projectile support outranks a higher soft value");
});

test("SR3 no-acceptable fallback uses projected unknown risk only after stronger safety dimensions", () => {
  const tied = controllerFixture(); const o = tied.outcome; o.reset(2);
  for (let row = 0; row < 2; row += 1) {
    o.hard[row] = HARD_STATUS.ALLOW; o.safety[row] = SAFETY_STATUS.UNKNOWN;
    o.coverage[row] = 0; o.unknownMass[row] = 10000;
    o.earliestFatalFrame[row] = 1; o.escapeSlack[row] = -1;
    o.robustLower[row] = row ? 10000 : -10000;
    o.expectedValue[row] = o.robustLower[row];
    o.tacticalValue[row] = o.robustLower[row];
  }
  o.unknownFallbackRisk[0] = 100; o.unknownFallbackRisk[1] = 9000;
  tied.gate(0, 0);
  assert.equal(tied.noAcceptableAction, 1);
  assert.equal(tied.select(0), 0,
    "pose risk breaks a coarse UNKNOWN tie before tactical value");

  const stronger = controllerFixture(); const p = stronger.outcome; p.reset(2);
  for (let row = 0; row < 2; row += 1) {
    p.hard[row] = HARD_STATUS.ALLOW; p.safety[row] = SAFETY_STATUS.POSSIBLE_DEATH;
    p.coverage[row] = 0; p.unknownMass[row] = 10000;
    p.earliestFatalFrame[row] = 1; p.escapeSlack[row] = -1;
    p.robustLower[row] = 0; p.expectedValue[row] = 0; p.tacticalValue[row] = 0;
  }
  p.immediateFatalMass[0] = 1;
  p.unknownFallbackRisk[0] = 0; p.unknownFallbackRisk[1] = 10000;
  stronger.gate(0, 0);
  assert.equal(stronger.select(0), 1,
    "projected risk may not override a stronger immediate-fatal dimension");
});

test("SR3 no-acceptable fallback prefers a safer projected pose before soft escape slack", () => {
  const controller = controllerFixture(); const o = controller.outcome; o.reset(2);
  for (let row = 0; row < 2; row += 1) {
    o.hard[row] = HARD_STATUS.ALLOW; o.safety[row] = SAFETY_STATUS.POSSIBLE_DEATH;
    o.immediateFatalMass[row] = 5000; o.horizonFatalMass[row] = 5000;
    o.unknownMass[row] = 10000; o.earliestFatalFrame[row] = 1;
    o.robustLower[row] = 0; o.expectedValue[row] = 0; o.tacticalValue[row] = 0;
  }
  // Row 0 appears to have more escape slack but steps closer along the same
  // saturated enemy firing line.  Row 1 preserves the safer successor pose.
  o.escapeSlack[0] = 1; o.unknownFallbackRisk[0] = 50003;
  o.escapeSlack[1] = -1; o.unknownFallbackRisk[1] = 50002;
  controller.gate(0, 0);
  assert.equal(controller.noAcceptableAction, 1);
  assert.equal(controller.select(0), 1);
});

test("SR3 diagnostic legacy switch reproduces slack-first emergency ownership", () => {
  const controller = new RiskAcceptanceController({ legacyEmergencySlackFirst: true });
  const o = controller.outcome; o.reset(2);
  for (let row = 0; row < 2; row += 1) {
    o.hard[row] = HARD_STATUS.ALLOW; o.safety[row] = SAFETY_STATUS.POSSIBLE_DEATH;
    o.immediateFatalMass[row] = 5000; o.horizonFatalMass[row] = 5000;
    o.unknownMass[row] = 10000; o.earliestFatalFrame[row] = 1;
    o.robustLower[row] = 0; o.expectedValue[row] = 0; o.tacticalValue[row] = 0;
  }
  o.escapeSlack[0] = 1; o.unknownFallbackRisk[0] = 10000;
  o.escapeSlack[1] = -1; o.unknownFallbackRisk[1] = 0;
  controller.gate(0, 0);
  assert.equal(controller.select(0), 0);
});

test("SR3 projected unknown fallback risk does not affect a non-empty acceptable set", () => {
  const controller = new RiskAcceptanceController(); const o = controller.outcome; o.reset(2);
  for (let row = 0; row < 2; row += 1) {
    o.hard[row] = HARD_STATUS.ALLOW; o.safety[row] = SAFETY_STATUS.PROVEN_SAFE;
    o.coverage[row] = 10000; o.escapeSlack[row] = 1;
    o.robustLower[row] = row ? 100 : 1000;
    o.expectedValue[row] = o.robustLower[row];
    o.tacticalValue[row] = o.robustLower[row];
  }
  o.unknownFallbackRisk[0] = 10000; o.unknownFallbackRisk[1] = 0;
  controller.gate(0, 0);
  assert.equal(controller.acceptableCount, 2);
  assert.equal(controller.select(0), 0);
});

test("SR3 preserves and compares earliest fatal frame as a risk dimension", () => {
  const controller = controllerFixture(); const o = controller.outcome;
  o.reset(2); for (let row = 0; row < 2; row += 1) {
    o.hard[row] = HARD_STATUS.ALLOW; o.safety[row] = SAFETY_STATUS.POSSIBLE_DEATH;
    o.immediateFatalMass[row] = 10000; o.horizonFatalMass[row] = 10000;
    o.unknownMass[row] = 10000; o.robustLower[row] = 0;
    o.expectedValue[row] = 0; o.tacticalValue[row] = 0;
  }
  o.earliestFatalFrame[0] = 1; o.earliestFatalFrame[1] = 3;
  controller.gate(100, 0);
  assert.equal(controller.noAcceptableAction, 1);
  assert.equal(controller.lexicographicRiskLess(1, 0), true);
  assert.equal(controller.select(1), 1);
  assert.equal(controller.strictlyDominates(1, 0), true);
});

test("SR3 soft escape slack can be excluded from Pareto ownership without changing acceptance", () => {
  const historical = new RiskAcceptanceController();
  const evidenceOnly = new RiskAcceptanceController({
    softEscapeSlackDominance: false
  });
  for (const controller of [historical, evidenceOnly]) {
    const o = controller.outcome; o.reset(2);
    for (let row = 0; row < 2; row += 1) {
      o.hard[row] = HARD_STATUS.ALLOW;
      o.safety[row] = SAFETY_STATUS.POSSIBLE_DEATH;
      o.coverage[row] = 10000;
      o.earliestFatalFrame[row] = 4;
      o.robustLower[row] = row === 0 ? -1000 : 2000;
      o.expectedValue[row] = o.robustLower[row];
      o.tacticalValue[row] = o.robustLower[row];
    }
    o.escapeSlack[0] = 1;
    o.escapeSlack[1] = 0;
    controller.gate(20, 0);
    assert.equal(controller.acceptableCount, 2);
  }
  assert.equal(historical.strictlyDominates(0, 1), true);
  assert.equal(Boolean(evidenceOnly.strictlyDominates(0, 1)), false);
  assert.equal(Boolean(evidenceOnly.riskStrictlyDominates(0, 1)), false);
  assert.equal(evidenceOnly.select(0), 1);
});

test("SR3 committed successor proof still owns Pareto dominance when soft slack does not", () => {
  const controller = new RiskAcceptanceController({
    softEscapeSlackDominance: false
  });
  const o = controller.outcome; o.reset(2);
  for (let row = 0; row < 2; row += 1) {
    o.hard[row] = HARD_STATUS.ALLOW;
    o.safety[row] = SAFETY_STATUS.PROVEN_SAFE;
    o.coverage[row] = 10000;
    o.earliestFatalFrame[row] = 4;
    o.escapeSlack[row] = 0;
    o.escapeSuccessorProof[row] = row === 0 ? 1 : 0;
    o.escapeSuccessorExposed[row] = 0;
    o.escapeSuccessorSlack[row] = 2;
  }
  o.escapeSuccessorReady = 1;
  controller.gate(20, 0);
  assert.equal(controller.strictlyDominates(0, 1), true);
});

test("SR3 Matching Pennies and RPS use the real StageMatrix solver", () => {
  const pennies = new StageMatrix({ maxRows: 3, maxColumns: 3 }); pennies.initialize(2, 2);
  pennies.setCell(0, 0, 1000, 1000); pennies.setCell(0, 1, -1000, -1000);
  pennies.setCell(1, 0, -1000, -1000); pennies.setCell(1, 1, 1000, 1000);
  const solver = new DoubleOracleSolver(pennies); solver.solve(64, 8);
  assert.ok(solver.policyHandle !== 0xffff); assert.ok(solver.rowCount >= 2);
  const rps = new StageMatrix({ maxRows: 3, maxColumns: 3 }); rps.initialize(3, 3);
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
    const value = row === column ? 0 : (row + 1) % 3 === column ? -1000 : 1000;
    rps.setCell(row, column, value, value);
  }
  const rpsSolver = new DoubleOracleSolver(rps); rpsSolver.solve(128, 8);
  assert.ok(rpsSolver.policyHandle !== 0xffff); assert.ok(rpsSolver.rowCount >= 2);
});

test("SR3 production root calls StageMatrix after the multidimensional gate", () => {
  // This fixture has a fully supported Physical root matrix. The old generic
  // productionRootFixture contains intentionally unsupported joint actions and
  // therefore must not authorize StageMatrix after HP10 support hardening.
  const fixture = benchmarkFixture(0);
  const searchBudget = { DECISION_DEPTH: [1, 1, 1, 0],
    NODE_BUDGET: [512, 384, 192, 0], PROOF_BUDGET: [0, 0, 0, 0],
    MATRIX_ITERATIONS: [128, 64, 32, 0], MATRIX_BATCH: [16, 8, 8, 1] };
  const engine = new ProductionRootEngine({ diagnosticDisableInformationSafety: true,
    runtime: { searchBudget } });
  engine.decide(fixture.me, fixture.enemy, fixture.game);
  assert.equal(engine.depthSearch.completedDepth, 1);
  assert.equal(engine.depthSearch.representativeSupportComplete, 1);
  assert.ok(engine.riskController.acceptableCount > 0);
  assert.ok(engine.stageMatrixSolveCount > 0); assert.ok(engine.riskController.stageMatrixUseCount > 0);
});

test("SR3 emergency NONE never enters the searched risk or matrix action domain", () => {
  const fixture = productionRootFixture(); fixture.enemy.status.fireLocked = true;
  const engine = new ProductionRootEngine(); const selected = engine.decide(
    fixture.me, fixture.enemy, fixture.game);
  assert.notEqual(selected, ACTION.NONE);
  assert.equal(engine.ourActions[engine.ourCount - 1], ACTION.NONE);
  assert.equal(engine.riskController.outcome.count, engine.ourCount - 1);
});

test("SR3 diagnostics mark NONE outside the Risk domain instead of reading a stale slab slot", () => {
  const fixture = productionRootFixture(); fixture.enemy.status.fireLocked = true;
  const bot = new ProductionDiagnosticBot({ captureAllFrames: true });
  bot.decide(fixture);
  const frame = bot.summary().diagnosticFrames[0];
  assert.equal(typeof frame.ownCanAct, "boolean");
  assert.equal(typeof frame.enemyVisible, "boolean");
  assert.equal(frame.acceptableCount, bot.engine.riskController.acceptableCount);
  const candidates = frame.candidates;
  const none = candidates.find(candidate => candidate.action === "NONE");
  assert.ok(none); assert.equal(none.riskDomain, false);
  assert.equal(none.unknownMass, null); assert.equal(none.unknownFallbackRisk, null);
  assert.equal(none.earliestFatalFrame, null);
  assert.equal(none.robustLower, null); assert.equal(none.acceptable, false);
  for (const candidate of candidates.filter(item => item.action !== "NONE"))
    assert.equal(candidate.riskDomain, true);
});

test("SR3 production root keeps projected fallback geometry on the cold emergency branch", () => {
  const fixture = productionRootFixture(); fixture.enemy.status.fireLocked = true;
  const engine = new ProductionRootEngine();
  engine.decide(fixture.me, fixture.enemy, fixture.game);
  const outcome = engine.riskController.outcome;
  assert.ok(engine.riskController.acceptableCount > 0);
  for (let row = 0; row < outcome.count; row += 1)
    assert.equal(outcome.unknownFallbackRisk[row], 0,
      "ordinary acceptable roots do not pay fallback pose geometry work");
});

test("SR3 completed production root matrix contains no alpha-beta sentinel cells", () => {
  const fixture = productionRootFixture(); fixture.enemy.status.fireLocked = true;
  const engine = new ProductionRootEngine({ diagnosticInformationEvidenceSearch: true });
  engine.decide(fixture.me, fixture.enemy, fixture.game);
  const source = engine.informationSearch.completedDepth > 0 ? engine.informationSearch :
    engine.depthSearch;
  assert.ok(source.completedDepth > 0);
  for (let row = 0; row < engine.riskController.outcome.count; row += 1)
    for (let column = 0; column < engine.enemyCount; column += 1)
      assert.notEqual(source.rootCellScore[row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column], -32000);
});

test("SR3 risk-owned features are excluded from tactical additive scoring", () => {
  const registry = new FeatureRegistry();
  assert.equal(registry.ownership[FEATURE.DANGER_SLACK], FEATURE_OWNERSHIP.RISK_OWNED);
  assert.equal(registry.ownership[FEATURE.POSSIBLE_SHOT_EXPOSURE], FEATURE_OWNERSHIP.RISK_OWNED);
  assert.equal(registry.ownership[FEATURE.OPPONENT_ATTACK_FIT], FEATURE_OWNERSHIP.RISK_OWNED);
});

test("SR3 stable integer policy sampling is deterministic and never calls Math.random", () => {
  const controller = controllerFixture(); controller.gate(100, 0);
  const probability = new Uint16Array([5000, 5000, 0, 0]);
  const first = controller.select(0x12345678, probability);
  for (let index = 0; index < 20; index += 1)
    assert.equal(controller.select(0x12345678, probability), first);
});
