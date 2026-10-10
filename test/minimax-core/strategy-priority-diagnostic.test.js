"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { STRATEGY, STRATEGY_BAND, STRATEGY_PURPOSE, COMBAT_PURPOSE,
  GLOBAL_MODE } =
  require("../../engine-v2/src/abi/policy-codes");
const { STRATEGY_PRIORITY_MODE, resourcePulseEligible, skillPulseEligible,
  poisonOwnershipEvidence,
  attackArrivalFrames,
  directInitiativeRow,
  installStrategyPriorityDiagnostic } =
  require("../../tools/agentank/diagnostics/strategy-priority-runtime");
const { ROOT_CONTROL_MODE } =
  require("../../engine-v2/src/runtime/root-control-mode");
const { selectScenarios } =
  require("../../tools/agentank/diagnostics/strategy-priority-sample");

function fixture() {
  const originalSelect = function originalSelect(input, mode) {
    this.current = mode === GLOBAL_MODE.HARD_SURVIVAL ?
      STRATEGY.PRESERVE_LEAD : STRATEGY.KILL_PRESSURE;
    return this.current;
  };
  const originalRestrict = function originalRestrict() { return 7; };
  const selector = {
    current: STRATEGY.KILL_PRESSURE, dwellRoots: 0, phase: 0,
    classifyPhase() { return 1; },
    buildDecisions() {},
    select: originalSelect
  };
  const bands = {
    selected: Uint8Array.from([1, 0, 1]),
    band: Uint8Array.from([STRATEGY_BAND.PRIMARY, STRATEGY_BAND.SUPPORT,
      STRATEGY_BAND.FALLBACK]),
    purpose: Uint16Array.from([
      STRATEGY_PURPOSE.DIRECT_KILL | STRATEGY_PURPOSE.ADVANTAGEOUS_FIRE,
      STRATEGY_PURPOSE.STAR_COLLECT,
      STRATEGY_PURPOSE.AIM_SETUP
    ]),
    selectedBand: STRATEGY_BAND.PRIMARY,
    selectedCount: 2,
    fallbackUsed: 0,
    restrictCount: 0,
    restrict: originalRestrict
  };
  const outcome = {
    count: 3,
    acceptable: Uint8Array.from([1, 1, 1]),
    dominated: Uint8Array.from([0, 0, 0]),
    robustLower: Int16Array.from([10, 9, 10])
  };
  return {
    engine: {
      policy: { selector, strategyId: STRATEGY.KILL_PRESSURE,
        strategicArbiter: { select() { return 0; } },
        proposalArbiter: { enabled: 0, goalArbitration: 0,
          configure(goalArbitration) { this.enabled = 1;
            this.goalArbitration = goalArbitration ? 1 : 0; return this; } } },
      strategyBands: bands,
      riskController: { outcome, safeFloor: 10, acceptableCount: 3,
        lastSelected: 0, noAcceptableAction: 0 },
      finalGate: { lastPreferred: 0, lastSelected: 0 },
      combat: { possibleHitEnabled: 1, vector: {
        purposeFlags: Uint8Array.from([1, 0, 0]),
        possibleHit: new Uint8Array(3)
      } },
      projectileAttack: {
        enabled: 1, evaluationCount: 3, reverseBuildCount: 2, cacheHitCount: 1,
        completeCount: 2, incompleteCount: 0, doomedCellCount: 4,
        frontierEnabled: 1, frontierDistanceBuildCount: 3, frontierBuildCount: 7,
        frontierPressureCellCount: 5, frontierSetupDelayTotal: 6,
        frontierMobilityLossTotal: 2, frontierEndpointReductionTotal: 11,
        frontierIncompleteCount: 0
      },
      informationSearch: { completedDepth: 0 },
      adapter: { enemyVisible: 0 },
      lastProofStatus: 0,
      lastSelectedIndex: 0,
      ourCount: 3,
      ourActions: Uint8Array.from([ACTION.FIRE, ACTION.GO, ACTION.TURN_LEFT])
    },
    originalSelect,
    originalRestrict
  };
}

test("Information value owner overrides only a completed Information root", () => {
  const value = fixture(); const engine = value.engine;
  engine.informationSearch.completedDepth = 1;
  engine.riskController.outcome.expectedValue = Int16Array.from([10, 30, 20]);
  const diagnostic = installStrategyPriorityDiagnostic(engine,
    STRATEGY_PRIORITY_MODE.INFORMATION_VALUE_OWNER);
  const selected = engine.policy.strategicArbiter.select(2,
    engine.riskController, engine.strategyBands);
  assert.equal(selected, 1);
  assert.equal(diagnostic.summary().informationValueRootCount, 1);
  assert.equal(diagnostic.summary().informationValueOverrideCount, 1);

  engine.informationSearch.completedDepth = 0;
  assert.equal(engine.policy.strategicArbiter.select(2,
    engine.riskController, engine.strategyBands), 0);
});

test("Information value one-shot consumes only a real override", () => {
  const value = fixture(); const engine = value.engine;
  engine.informationSearch.completedDepth = 1;
  engine.riskController.outcome.expectedValue = Int16Array.from([10, 30, 20]);
  const diagnostic = installStrategyPriorityDiagnostic(engine,
    STRATEGY_PRIORITY_MODE.INFORMATION_VALUE_ONCE);
  assert.equal(engine.policy.strategicArbiter.select(2,
    engine.riskController, engine.strategyBands), 1);
  assert.equal(engine.policy.strategicArbiter.select(2,
    engine.riskController, engine.strategyBands), 0);
  assert.equal(diagnostic.summary().informationValueOverrideCount, 1);
  assert.equal(diagnostic.summary().informationValueConsumed, true);
});

test("poison contact evidence falls through to a Risk-eligible non-skill action", () => {
  const value = fixture(); const engine = value.engine;
  engine.ourActions = Uint8Array.from([
    ACTION.CAST_POISON, ACTION.GO, ACTION.TURN_RIGHT
  ]);
  engine.strategyBands.selected.set([1, 0, 0]);
  engine.lastControlMode = ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION;
  engine.policy.strategicArbiter = {
    select(mode, controller, bands) {
      for (let row = 0; row < controller.outcome.count; row += 1)
        if (bands.selected[row]) return row;
      return -1;
    }
  };
  assert.equal(poisonOwnershipEvidence(engine), false);
  const diagnostic = installStrategyPriorityDiagnostic(engine,
    STRATEGY_PRIORITY_MODE.POISON_CONTACT_EVIDENCE);
  assert.equal(engine.policy.strategicArbiter.select(0,
    engine.riskController, engine.strategyBands), 1);
  assert.deepEqual([...engine.strategyBands.selected], [1, 0, 0]);
  assert.equal(diagnostic.summary().poisonEvidenceOverrideCount, 1);

  engine.lastControlMode = ROOT_CONTROL_MODE.TACTICAL_CONTACT;
  assert.equal(poisonOwnershipEvidence(engine), true);
  assert.equal(engine.policy.strategicArbiter.select(0,
    engine.riskController, engine.strategyBands), 0);
});

test("direct initiative uses arrival-frame advantage without bypassing Risk", () => {
  assert.equal(attackArrivalFrames(0, 1, 6, true, false, false), 4);
  assert.equal(attackArrivalFrames(0, 1, 6, true, true, false), 3);
  assert.equal(attackArrivalFrames(0, 1, 6, true, false, true), 99);
  const value = fixture(); const engine = value.engine;
  const arrays = [];
  arrays[ARRAY.TANK_CELL] = Uint16Array.from([0, 6]);
  arrays[ARRAY.TANK_DIR] = Uint8Array.from([1, 0]);
  arrays[ARRAY.TANK_STARS] = new Uint16Array(2);
  arrays[ARRAY.TANK_SHIELD_HITS] = new Uint16Array(2);
  arrays[ARRAY.TANK_BOOST_UNTIL] = Uint16Array.from([0xffff, 0xffff]);
  arrays[ARRAY.SCALAR] = new Uint16Array(32);
  engine.adapter = { enemyVisible: 1, ownCanFire: 1, enemyCanFire: 1,
    state: { arrays } };
  engine.lastControlMode = ROOT_CONTROL_MODE.TACTICAL_CONTACT;
  engine.manhattan = () => 6;
  engine.clearLine = () => 1;
  engine.directionTo = (from, to) => from < to ? 1 : 3;
  engine.ourActions = Uint8Array.from([
    ACTION.FIRE, ACTION.TURN_LEFT, ACTION.TURN_RIGHT
  ]);
  assert.equal(directInitiativeRow(engine, engine.riskController), 0);
  arrays[ARRAY.TANK_DIR][1] = 3;
  assert.equal(directInitiativeRow(engine, engine.riskController), -1);
  arrays[ARRAY.TANK_STARS][0] = 1;
  assert.equal(directInitiativeRow(engine, engine.riskController), 0);
  engine.riskController.outcome.acceptable[0] = 0;
  assert.equal(directInitiativeRow(engine, engine.riskController), -1);
});

test("CURRENT is observer-only and preserves selector/band function identity", () => {
  const value = fixture();
  installStrategyPriorityDiagnostic(value.engine, STRATEGY_PRIORITY_MODE.CURRENT);
  assert.equal(value.engine.policy.selector.select, value.originalSelect);
  assert.equal(value.engine.strategyBands.restrict, value.originalRestrict);
});

test("FORCE_STAR_CONTROL only overrides NORMAL mode", () => {
  const value = fixture();
  installStrategyPriorityDiagnostic(value.engine,
    STRATEGY_PRIORITY_MODE.FORCE_STAR_CONTROL);
  assert.equal(value.engine.policy.selector.select({}, GLOBAL_MODE.NORMAL),
    STRATEGY.STAR_CONTROL);
  assert.equal(value.engine.policy.selector.select({}, GLOBAL_MODE.HARD_SURVIVAL),
    STRATEGY.PRESERVE_LEAD);
});

test("STRAT3 FORCE_STAR_CONTROL constrains post-Risk decisions instead of unused select", () => {
  const value = fixture();
  value.engine.policy.selector.prepare = function prepare(input, mode) {
    this.lastMode = mode; return { eligible: Uint8Array.from([1, 1, 1, 1, 1]) };
  };
  installStrategyPriorityDiagnostic(value.engine,
    STRATEGY_PRIORITY_MODE.FORCE_STAR_CONTROL);
  const normal = value.engine.policy.selector.prepare({}, GLOBAL_MODE.NORMAL);
  assert.deepEqual([...normal.eligible], [1, 0, 0, 0, 0]);
  const forced = value.engine.policy.selector.prepare({}, GLOBAL_MODE.HARD_SURVIVAL);
  assert.deepEqual([...forced.eligible], [1, 1, 1, 1, 1]);
});

test("BAND_OFF keeps every Risk/Pareto eligible row without a robust floor", () => {
  const value = fixture();
  installStrategyPriorityDiagnostic(value.engine, STRATEGY_PRIORITY_MODE.BAND_OFF);
  assert.equal(value.engine.strategyBands.restrict(value.engine.riskController,
    STRATEGY.KILL_PRESSURE, 3), 3);
  assert.deepEqual([...value.engine.strategyBands.selected], [1, 1, 1]);
});

test("STRAT3 BAND_OFF wraps portfolio construction and keeps every global row", () => {
  const value = fixture(); const bands = value.engine.strategyBands;
  bands.baseAnchor = new Uint8Array(3); bands.baseAnchorRow = -1;
  bands.portfolioBuildCount = 0;
  bands.buildPortfolio = function originalPortfolio() { return 0; };
  installStrategyPriorityDiagnostic(value.engine, STRATEGY_PRIORITY_MODE.BAND_OFF);
  assert.equal(bands.buildPortfolio(value.engine.riskController, null,
    STRATEGY.KILL_PRESSURE, value.engine.ourActions, 3), 3);
  assert.deepEqual([...bands.selected], [1, 1, 1]);
  assert.equal(bands.baseAnchorRow, 0);
});

test("BAND_OFF_ONCE opens one portfolio then restores current ownership", () => {
  const value = fixture(); const bands = value.engine.strategyBands;
  value.engine.ourArguments = new Uint16Array(3);
  value.engine.policy.strategicArbiter = {
    select(mode, controller, activeBands) {
      for (let row = 0; row < activeBands.selected.length; row += 1)
        if (activeBands.selected[row]) return row;
      return -1;
    }
  };
  bands.maxActions = 3;
  bands.baseAnchor = new Uint8Array(3); bands.baseAnchorRow = -1;
  bands.portfolioBuildCount = 0;
  bands.buildPortfolio = function originalPortfolio() {
    this.selected.set([1, 0, 0]); this.selectedCount = 1; return 1;
  };
  const diagnostic = installStrategyPriorityDiagnostic(value.engine,
    STRATEGY_PRIORITY_MODE.BAND_OFF_ONCE);
  assert.equal(bands.buildPortfolio(value.engine.riskController, null,
    STRATEGY.KILL_PRESSURE, value.engine.ourActions, 3), 3);
  assert.deepEqual([...bands.selected], [1, 1, 1]);
  value.engine.policy.strategicArbiter.select(0, value.engine.riskController,
    bands);
  // Make the opened portfolio prefer a row outside the original mask.
  diagnostic.bandOffOnceOpenRow = 1;
  diagnostic.bandOffOnceShadowRow = 0;
  diagnostic.capture(ACTION.GO);
  assert.equal(diagnostic.summary().bandOffOnceOverrideCount, 1);
  assert.equal(bands.buildPortfolio(value.engine.riskController, null,
    STRATEGY.KILL_PRESSURE, value.engine.ourActions, 3), 1);
  assert.deepEqual([...bands.selected], [1, 0, 0]);
});

test("RESOURCE_PULSE admits bounded bomb evidence but protects a strong combat base", () => {
  const value = fixture();
  value.engine.depthSearch = { completedDepth: 0 };
  value.engine.informationSearch = { completedDepth: 2 };
  value.engine.ourActions = Uint8Array.from([
    ACTION.TURN_LEFT, ACTION.THROW_BOMB, ACTION.FIRE
  ]);
  const outcome = value.engine.riskController.outcome;
  outcome.immediateFatalMass = new Uint16Array(3);
  outcome.horizonFatalMass = new Uint16Array(3);
  outcome.unknownMass = new Uint16Array(3);
  outcome.earliestFatalFrame = Uint8Array.from([4, 4, 4]);
  outcome.escapeSlack = Int8Array.from([0, 0, 0]);
  outcome.expectedValue = Int16Array.from([1000, 2500, 0]);
  outcome.robustLower = Int16Array.from([500, 900, 0]);
  outcome.combatPurpose = new Uint8Array(3);
  outcome.purposeCompleteness = new Uint16Array(3);
  outcome.postFireEscape = new Uint8Array(3);
  assert.equal(resourcePulseEligible(value.engine,
    value.engine.riskController, 0, 1), 1);
  outcome.expectedValue[1] = 3001;
  assert.equal(resourcePulseEligible(value.engine,
    value.engine.riskController, 0, 1), 0);
  outcome.expectedValue[1] = 2500;
  outcome.combatPurpose[0] = COMBAT_PURPOSE.INTERCEPT;
  assert.equal(resourcePulseEligible(value.engine,
    value.engine.riskController, 0, 1), 0);
});

test("SKILL_PULSE admits poison only before the existing frame-64 phase boundary", () => {
  const value = fixture();
  value.engine.adapter.state = { arrays: [] };
  value.engine.adapter.state.arrays[ARRAY.SCALAR] = new Int32Array(32);
  value.engine.ourActions = Uint8Array.from([
    ACTION.TURN_LEFT, ACTION.CAST_POISON, ACTION.THROW_BOMB
  ]);
  const outcome = value.engine.riskController.outcome;
  outcome.immediateFatalMass = new Uint16Array(3);
  outcome.horizonFatalMass = new Uint16Array(3);
  outcome.unknownMass = new Uint16Array(3);
  outcome.earliestFatalFrame = Uint8Array.from([4, 4, 4]);
  outcome.escapeSlack = Int8Array.from([0, 0, 0]);
  outcome.expectedValue = Int16Array.from([1000, 5000, 6000]);
  outcome.robustLower = Int16Array.from([500, 600, 700]);
  assert.equal(skillPulseEligible(value.engine,
    value.engine.riskController, 0, 1), 1);
  assert.equal(skillPulseEligible(value.engine,
    value.engine.riskController, 0, 2), 0);
  value.engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 64;
  assert.equal(skillPulseEligible(value.engine,
    value.engine.riskController, 0, 1), 0);
});

test("POSSIBLE_HIT_OFF changes only the combat diagnostic switch", () => {
  const value = fixture(); value.engine.combat.possibleHitEnabled = 1;
  installStrategyPriorityDiagnostic(value.engine,
    STRATEGY_PRIORITY_MODE.POSSIBLE_HIT_OFF);
  assert.equal(value.engine.combat.possibleHitEnabled, 0);
  assert.equal(value.engine.policy.selector.select, value.originalSelect);
  assert.equal(value.engine.strategyBands.restrict, value.originalRestrict);
});

test("PROJECTILE_ATTACK_OFF changes only the PAC diagnostic switch", () => {
  const value = fixture();
  installStrategyPriorityDiagnostic(value.engine,
    STRATEGY_PRIORITY_MODE.PROJECTILE_ATTACK_OFF);
  assert.equal(value.engine.projectileAttack.enabled, 0);
  assert.equal(value.engine.combat.possibleHitEnabled, 1);
  assert.equal(value.engine.policy.selector.select, value.originalSelect);
  assert.equal(value.engine.strategyBands.restrict, value.originalRestrict);
});

test("SURVIVOR_FRONTIER_OFF disables only PAC2 while preserving PAC1", () => {
  const value = fixture();
  installStrategyPriorityDiagnostic(value.engine,
    STRATEGY_PRIORITY_MODE.SURVIVOR_FRONTIER_OFF);
  assert.equal(value.engine.projectileAttack.enabled, 1);
  assert.equal(value.engine.projectileAttack.frontierEnabled, 0);
  assert.equal(value.engine.combat.possibleHitEnabled, 1);
  assert.equal(value.engine.policy.selector.select, value.originalSelect);
  assert.equal(value.engine.strategyBands.restrict, value.originalRestrict);
});

test("PVA diagnostic modes configure the preallocated production candidate", () => {
  const verify = fixture();
  installStrategyPriorityDiagnostic(verify.engine,
    STRATEGY_PRIORITY_MODE.PVA_VERIFY_ONLY);
  assert.equal(verify.engine.policy.proposalArbiter.enabled, 1);
  assert.equal(verify.engine.policy.proposalArbiter.goalArbitration, 0);
  const full = fixture();
  installStrategyPriorityDiagnostic(full.engine,
    STRATEGY_PRIORITY_MODE.PVA_CONTROLLER);
  assert.equal(full.engine.policy.proposalArbiter.enabled, 1);
  assert.equal(full.engine.policy.proposalArbiter.goalArbitration, 1);
});

test("diagnostic separates qualified opportunity, band admission and selection", () => {
  const value = fixture();
  const diagnostic = installStrategyPriorityDiagnostic(value.engine,
    STRATEGY_PRIORITY_MODE.CURRENT);
  diagnostic.capture(ACTION.FIRE);
  const summary = diagnostic.summary();
  assert.equal(summary.qualifiedFireOpportunityRoots, 1);
  assert.equal(summary.qualifiedFirePrimaryRoots, 1);
  assert.equal(summary.qualifiedFireInSelectedBandRoots, 1);
  assert.equal(summary.qualifiedFireChosenRoots, 1);
  assert.equal(summary.purposefulFireChosenRoots, 1);
  assert.equal(summary.purposelessFireChosenRoots, 0);
  assert.equal(summary.visibleFireChosenRoots, 0);
  assert.equal(summary.fireInsideSelectedBandRoots, 1);
  assert.equal(summary.fireOutsideSelectedBandRoots, 0);
  assert.equal(summary.projectileAttackReverseBuilds, 2);
  assert.equal(summary.projectileAttackDoomedCells, 4);
  assert.equal(summary.projectileFrontierBuilds, 7);
  assert.equal(summary.projectileFrontierPressureCells, 5);
  assert.equal(summary.projectileFrontierEndpointReduction, 11);
  assert.equal(summary.finalGateOverrideFireChosenRoots, 0);
});

test("diagnostic counts only a real FinalActionGate override", () => {
  const value = fixture(); value.engine.finalGate.lastPreferred = 1;
  value.engine.finalGate.lastSelected = 0;
  const diagnostic = installStrategyPriorityDiagnostic(value.engine,
    STRATEGY_PRIORITY_MODE.CURRENT);
  diagnostic.capture(ACTION.FIRE);
  assert.equal(diagnostic.summary().finalGateOverrideFireChosenRoots, 1);
});

test("structure arena can select disjoint 32 and 64 scenario windows", () => {
  const fixed = { scenarios: Array.from({ length: 266 }, (_, index) => ({
    id: `scenario-${String(index).padStart(3, "0")}`,
    fingerprint: `fingerprint-${String(index).padStart(3, "0")}`
  })) };
  const first = selectScenarios(fixed, { scenarioCount: 32, scenarioOffset: 0 });
  const second = selectScenarios(fixed, { scenarioCount: 64, scenarioOffset: 32 });
  assert.equal(first.ids.length, 32);
  assert.equal(second.ids.length, 64);
  assert.equal(new Set([...first.ids, ...second.ids]).size, 96);
  assert.deepEqual(first.split.discovery.slice().sort(),
    [...first.ids, ...second.ids].sort());
});
