"use strict";

const { ACTION, NONE_FRAME } = require("../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { STRATEGY, STRATEGY_BAND, STRATEGY_PURPOSE, COMBAT_PURPOSE,
  GLOBAL_MODE } =
  require("../../../engine-v2/src/abi/policy-codes");
const { MATERIAL_EXPECTED_GAIN } =
  require("../../../engine-v2/src/search/risk-acceptance-controller");
const { RULE } = require("../../../engine-v2/src/generated/fast-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ROOT_CONTROL_MODE } = require("../../../engine-v2/src/runtime/root-control-mode");
const { installOwnershipArchitecturePoc, installOwnershipRiskFrontierPoc,
  installOwnershipRouterPoc, installStrategicRiskFrontierPoc } =
  require("./ownership-architecture-poc");

const STRATEGY_PRIORITY_MODE = Object.freeze({
  CURRENT: "CURRENT",
  FORCE_STAR_CONTROL: "FORCE_STAR_CONTROL",
  BAND_OFF: "BAND_OFF",
  BAND_OFF_ONCE: "BAND_OFF_ONCE",
  RESOURCE_PULSE: "RESOURCE_PULSE",
  SKILL_PULSE: "SKILL_PULSE",
  INFORMATION_VALUE_OWNER: "INFORMATION_VALUE_OWNER",
  INFORMATION_VALUE_ONCE: "INFORMATION_VALUE_ONCE",
  POISON_CONTACT_EVIDENCE: "POISON_CONTACT_EVIDENCE",
  DIRECT_INITIATIVE_OWNER: "DIRECT_INITIATIVE_OWNER",
  POSSIBLE_HIT_OFF: "POSSIBLE_HIT_OFF",
  PROJECTILE_ATTACK_OFF: "PROJECTILE_ATTACK_OFF",
  SURVIVOR_FRONTIER_OFF: "SURVIVOR_FRONTIER_OFF",
  OWNERSHIP_POC: "OWNERSHIP_POC",
  OWNERSHIP_RISK_FRONTIER: "OWNERSHIP_RISK_FRONTIER",
  OWNERSHIP_ROUTER_ONLY: "OWNERSHIP_ROUTER_ONLY",
  STRATEGIC_RISK_FRONTIER: "STRATEGIC_RISK_FRONTIER",
  PVA_VERIFY_ONLY: "PVA_VERIFY_ONLY",
  PVA_CONTROLLER: "PVA_CONTROLLER"
});

const MODES = Object.freeze([
  STRATEGY_PRIORITY_MODE.CURRENT,
  STRATEGY_PRIORITY_MODE.FORCE_STAR_CONTROL,
  STRATEGY_PRIORITY_MODE.BAND_OFF
]);
const VALID_MODES = Object.freeze(Object.values(STRATEGY_PRIORITY_MODE));
const ATTACK_FIRE_MASK = STRATEGY_PURPOSE.DIRECT_KILL |
  STRATEGY_PURPOSE.ADVANTAGEOUS_FIRE | STRATEGY_PURPOSE.INTERCEPT |
  STRATEGY_PURPOSE.SHIELD_BREAK;
const ATTACK_SETUP_MASK = STRATEGY_PURPOSE.AIM_SETUP |
  STRATEGY_PURPOSE.ESCAPE_DENIAL | STRATEGY_PURPOSE.ZONE_DENIAL |
  STRATEGY_PURPOSE.ATTACK_APPROACH;
const PURPOSEFUL_FIRE_MASK = ATTACK_FIRE_MASK | STRATEGY_PURPOSE.ZONE_DENIAL |
  STRATEGY_PURPOSE.BELIEF_SWEEP;
const STRONG_COMBAT = COMBAT_PURPOSE.DIRECT_KILL |
  COMBAT_PURPOSE.INTERCEPT | COMBAT_PURPOSE.SHIELD_BREAK;

function riskNoWorse(outcome, left, right) {
  return outcome.immediateFatalMass[left] <= outcome.immediateFatalMass[right] &&
    outcome.horizonFatalMass[left] <= outcome.horizonFatalMass[right] &&
    outcome.unknownMass[left] <= outcome.unknownMass[right] &&
    outcome.earliestFatalFrame[left] >= outcome.earliestFatalFrame[right] &&
    outcome.escapeSlack[left] >= outcome.escapeSlack[right];
}

function resourcePulseEligible(engine, controller, base, row) {
  if (base < 0 || row < 0 || row === base) return 0;
  const outcome = controller.outcome;
  if (!outcome.acceptable[row] || outcome.dominated[row]) return 0;
  const action = engine.ourActions[row];
  if (action === ACTION.THROW_BOMB) {
    if (!(engine.depthSearch.completedDepth > 0 ||
        engine.informationSearch.completedDepth > 0)) return 0;
    if (outcome.combatPurpose[base] & STRONG_COMBAT) return 0;
    const expectedGain =
      outcome.expectedValue[row] - outcome.expectedValue[base];
    return expectedGain > 0 && expectedGain <= MATERIAL_EXPECTED_GAIN &&
      outcome.robustLower[row] > outcome.robustLower[base] &&
      riskNoWorse(outcome, row, base) ? 1 : 0;
  }
  if (action === ACTION.FIRE)
    return (outcome.combatPurpose[row] & STRONG_COMBAT) &&
      outcome.purposeCompleteness[row] >= 4500 &&
      outcome.postFireEscape[row] &&
      riskNoWorse(outcome, row, base) ? 1 : 0;
  if (action === ACTION.CAST_POISON)
    return outcome.expectedValue[row] > outcome.expectedValue[base] &&
      outcome.robustLower[row] >= outcome.robustLower[base] &&
      riskNoWorse(outcome, row, base) ? 1 : 0;
  return 0;
}

function skillPulseEligible(engine, controller, base, row) {
  if (base < 0 || row < 0 || row === base ||
      engine.ourActions[row] !== ACTION.CAST_POISON) return 0;
  const state = engine.adapter.state;
  if (!state || state.arrays[ARRAY.SCALAR][SCALAR.FRAME] >=
      Math.floor(RULE.FRAME_RECORD_LIMIT / 2)) return 0;
  const outcome = controller.outcome;
  return outcome.acceptable[row] && !outcome.dominated[row] &&
    outcome.expectedValue[row] > outcome.expectedValue[base] &&
    outcome.robustLower[row] >= outcome.robustLower[base] &&
    riskNoWorse(outcome, row, base) ? 1 : 0;
}

function poisonOwnershipEvidence(engine) {
  return engine.lastProofStatus === PROOF_STATUS.PROVEN ||
    engine.lastControlMode === ROOT_CONTROL_MODE.TACTICAL_CONTACT;
}

function attackArrivalFrames(direction, wanted, distance, canFire, boosted,
    targetShielded) {
  if (!canFire || targetShielded || wanted < 0) return 99;
  const clockwise = (wanted - direction + 4) & 3;
  const turns = Math.min(clockwise, 4 - clockwise);
  const turnFrames = boosted ? Math.max(0, turns - 1) : turns;
  return turnFrames + Math.trunc((distance + RULE.PROJECTILE_STEPS - 1) /
    RULE.PROJECTILE_STEPS);
}

function directInitiativeRow(engine, controller) {
  if (!engine.adapter.enemyVisible || !engine.adapter.ownCanFire ||
      engine.lastControlMode === ROOT_CONTROL_MODE.COMMITTED_ESCAPE ||
      engine.lastProofStatus === PROOF_STATUS.PROVEN) return -1;
  const state = engine.adapter.state; const a = state.arrays;
  const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
  const distance = engine.manhattan(own, enemy);
  if (distance > 6 || !engine.clearLine(own, enemy)) return -1;
  const wanted = engine.directionTo(own, enemy);
  if (wanted < 0) return -1;
  const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
  const ownBoosted = a[ARRAY.TANK_BOOST_UNTIL][0] !== NONE_FRAME &&
    a[ARRAY.TANK_BOOST_UNTIL][0] > frame;
  const enemyBoosted = a[ARRAY.TANK_BOOST_UNTIL][1] !== NONE_FRAME &&
    a[ARRAY.TANK_BOOST_UNTIL][1] > frame;
  const mine = attackArrivalFrames(a[ARRAY.TANK_DIR][0], wanted, distance,
    true, ownBoosted, a[ARRAY.TANK_SHIELD_HITS][1] > 0);
  const enemyWanted = engine.directionTo(enemy, own);
  const theirs = attackArrivalFrames(a[ARRAY.TANK_DIR][1], enemyWanted,
    distance, engine.adapter.enemyCanFire, enemyBoosted,
    a[ARRAY.TANK_SHIELD_HITS][0] > 0);
  const favorable = mine < theirs || (mine === theirs &&
    a[ARRAY.TANK_STARS][0] > a[ARRAY.TANK_STARS][1]);
  if (mine >= 99 || !favorable) return -1;
  const desired = wanted === a[ARRAY.TANK_DIR][0] ? ACTION.FIRE :
    wanted === ((a[ARRAY.TANK_DIR][0] + 3) & 3) ? ACTION.TURN_LEFT :
      ACTION.TURN_RIGHT;
  const outcome = controller.outcome;
  for (let row = 0; row < outcome.count; row += 1)
    if (engine.ourActions[row] === desired && outcome.acceptable[row] &&
        !outcome.dominated[row]) return row;
  return -1;
}

function addCount(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function strategyName(value) {
  for (const [name, code] of Object.entries(STRATEGY))
    if (name !== "COUNT" && code === value) return name;
  return `STRATEGY_${value}`;
}

function bandName(value) {
  for (const [name, code] of Object.entries(STRATEGY_BAND))
    if (code === value) return name;
  return `BAND_${value}`;
}

class StrategyPriorityDiagnostic {
  constructor(engine, mode = STRATEGY_PRIORITY_MODE.CURRENT) {
    if (!VALID_MODES.includes(mode)) throw new Error(`STRAT2_SAMPLE_MODE_INVALID:${mode}`);
    this.engine = engine; this.mode = mode;
    this.roots = 0; this.eligibleRoots = 0;
    this.qualifiedFireOpportunityRoots = 0;
    this.qualifiedFirePrimaryRoots = 0;
    this.qualifiedFireInSelectedBandRoots = 0;
    this.qualifiedFireChosenRoots = 0;
    this.qualifiedFireMissedRoots = 0;
    this.possibleHitOpportunityRoots = 0;
    this.possibleHitInSelectedBandRoots = 0;
    this.possibleHitFireChosenRoots = 0;
    this.setupOpportunityRoots = 0;
    this.attackOpportunityRoots = 0;
    this.attackPurposeChosenRoots = 0;
    this.fireChosenRoots = 0;
    this.purposefulFireChosenRoots = 0;
    this.purposelessFireChosenRoots = 0;
    this.anyPurposeFireChosenRoots = 0;
    this.planContinuationFireChosenRoots = 0;
    this.visibleFireChosenRoots = 0;
    this.hiddenFireChosenRoots = 0;
    this.visibleMissFireChosenRoots = 0;
    this.hiddenNoBeliefFireChosenRoots = 0;
    this.fireInsideSelectedBandRoots = 0;
    this.fireOutsideSelectedBandRoots = 0;
    this.forcedProofFireChosenRoots = 0;
    this.finalGateOverrideFireChosenRoots = 0;
    this.noAcceptableFireChosenRoots = 0;
    this.starPurposeChosenRoots = 0;
    this.strategyCounts = {}; this.selectedBandCounts = {};
    this.ownershipPoc = null; this.proposalVerification = null;
    this.bandOffOnceConsumed = 0; this.bandOffOnceOverrideCount = 0;
    this.bandOffOnceShadowRow = -1; this.bandOffOnceOpenRow = -1;
    this.originalBandSelected = new Uint8Array(
      this.engine.strategyBands.maxActions ||
      this.engine.strategyBands.selected.length);
    this.openBandSelected = new Uint8Array(this.originalBandSelected.length);
    this.resourcePulseProposalCount = 0;
    this.resourcePulseOverrideCount = 0;
    this.informationValueRootCount = 0;
    this.informationValueOverrideCount = 0;
    this.informationValueConsumed = 0;
    this.poisonEvidenceRootCount = 0;
    this.poisonEvidenceOverrideCount = 0;
    this.directInitiativeProposalCount = 0;
    this.directInitiativeOverrideCount = 0;
    this.install();
  }
  install() {
    if (this.mode === STRATEGY_PRIORITY_MODE.CURRENT) return;
    if (this.mode === STRATEGY_PRIORITY_MODE.OWNERSHIP_POC) {
      this.ownershipPoc = installOwnershipArchitecturePoc(this.engine); return;
    }
    if (this.mode === STRATEGY_PRIORITY_MODE.OWNERSHIP_RISK_FRONTIER) {
      this.ownershipPoc = installOwnershipRiskFrontierPoc(this.engine); return;
    }
    if (this.mode === STRATEGY_PRIORITY_MODE.OWNERSHIP_ROUTER_ONLY) {
      this.ownershipPoc = installOwnershipRouterPoc(this.engine); return;
    }
    if (this.mode === STRATEGY_PRIORITY_MODE.STRATEGIC_RISK_FRONTIER) {
      this.ownershipPoc = installStrategicRiskFrontierPoc(this.engine); return;
    }
    if (this.mode === STRATEGY_PRIORITY_MODE.PVA_VERIFY_ONLY) {
      this.proposalVerification = this.engine.policy.proposalArbiter.configure(0); return;
    }
    if (this.mode === STRATEGY_PRIORITY_MODE.PVA_CONTROLLER) {
      this.proposalVerification = this.engine.policy.proposalArbiter.configure(1); return;
    }
    if (this.mode === STRATEGY_PRIORITY_MODE.POSSIBLE_HIT_OFF) {
      this.engine.combat.possibleHitEnabled = 0; return;
    }
    if (this.mode === STRATEGY_PRIORITY_MODE.PROJECTILE_ATTACK_OFF) {
      this.engine.projectileAttack.enabled = 0; return;
    }
    if (this.mode === STRATEGY_PRIORITY_MODE.SURVIVOR_FRONTIER_OFF) {
      this.engine.projectileAttack.frontierEnabled = 0; return;
    }
    if (this.mode === STRATEGY_PRIORITY_MODE.FORCE_STAR_CONTROL) {
      const selector = this.engine.policy.selector;
      if (typeof selector.prepare === "function") {
        const originalPrepare = selector.prepare;
        selector.prepare = function prepareStrategyForDiagnostic(input, globalMode) {
          const decisions = originalPrepare.call(this, input, globalMode);
          if (globalMode === GLOBAL_MODE.NORMAL) {
            decisions.eligible.fill(0);
            decisions.eligible[STRATEGY.STAR_CONTROL] = 1;
          }
          return decisions;
        };
      } else {
        const original = selector.select;
        selector.select = function selectStrategyForDiagnostic(input, globalMode) {
          if (globalMode !== GLOBAL_MODE.NORMAL)
            return original.call(this, input, globalMode);
          this.phase = this.classifyPhase(input); this.buildDecisions(input);
          this.current = STRATEGY.STAR_CONTROL; this.dwellRoots += 1; return this.current;
        };
      }
      return;
    }
    const bands = this.engine.strategyBands;
    if (this.mode === STRATEGY_PRIORITY_MODE.INFORMATION_VALUE_OWNER ||
        this.mode === STRATEGY_PRIORITY_MODE.INFORMATION_VALUE_ONCE) {
      const diagnostic = this; const arbiter = this.engine.policy.strategicArbiter;
      const originalSelect = arbiter.select.bind(arbiter);
      arbiter.select = function selectInformationValueOwner(...args) {
        const baseline = originalSelect(...args);
        const controller = args[1];
        if (baseline < 0 || args[0] === 1 ||
            (diagnostic.mode === STRATEGY_PRIORITY_MODE.INFORMATION_VALUE_ONCE &&
             diagnostic.informationValueConsumed) ||
            diagnostic.engine.lastProofStatus === PROOF_STATUS.PROVEN ||
            diagnostic.engine.informationSearch.completedDepth <= 0) return baseline;
        diagnostic.informationValueRootCount += 1;
        const outcome = controller.outcome; let best = -1;
        for (let row = 0; row < outcome.count; row += 1) {
          if (!outcome.acceptable[row] || outcome.dominated[row]) continue;
          if (best < 0 || outcome.expectedValue[row] > outcome.expectedValue[best] ||
              (outcome.expectedValue[row] === outcome.expectedValue[best] &&
               outcome.robustLower[row] > outcome.robustLower[best]) ||
              (outcome.expectedValue[row] === outcome.expectedValue[best] &&
               outcome.robustLower[row] === outcome.robustLower[best] && row < best)) best = row;
        }
        if (best >= 0 && best !== baseline) {
          diagnostic.informationValueOverrideCount += 1;
          if (diagnostic.mode === STRATEGY_PRIORITY_MODE.INFORMATION_VALUE_ONCE)
            diagnostic.informationValueConsumed = 1;
        }
        return best >= 0 ? best : baseline;
      };
      return;
    }
    if (this.mode === STRATEGY_PRIORITY_MODE.POISON_CONTACT_EVIDENCE) {
      const diagnostic = this;
      const arbiter = this.engine.policy.strategicArbiter;
      const originalSelect = arbiter.select.bind(arbiter);
      arbiter.select = function selectPoisonWithContactEvidence(...args) {
        const baseline = originalSelect(...args);
        if (baseline < 0 || diagnostic.engine.ourActions[baseline] !==
            ACTION.CAST_POISON || poisonOwnershipEvidence(diagnostic.engine))
          return baseline;
        diagnostic.poisonEvidenceRootCount += 1;
        const controller = args[1]; const activeBands = args[2];
        const count = controller.outcome.count;
        diagnostic.originalBandSelected.fill(0);
        diagnostic.originalBandSelected.set(
          activeBands.selected.subarray(0, count));
        activeBands.selected.fill(0, 0, count);
        for (let row = 0; row < count; row += 1)
          if (diagnostic.engine.ourActions[row] !== ACTION.CAST_POISON &&
              controller.outcome.acceptable[row] &&
              !controller.outcome.dominated[row])
            activeBands.selected[row] = 1;
        const selected = originalSelect(...args);
        activeBands.selected.set(
          diagnostic.originalBandSelected.subarray(0, count));
        if (selected >= 0 && selected !== baseline) {
          diagnostic.poisonEvidenceOverrideCount += 1;
          return selected;
        }
        return baseline;
      };
      return;
    }
    if (this.mode === STRATEGY_PRIORITY_MODE.DIRECT_INITIATIVE_OWNER) {
      const diagnostic = this;
      const arbiter = this.engine.policy.strategicArbiter;
      const originalSelect = arbiter.select.bind(arbiter);
      arbiter.select = function selectDirectInitiative(...args) {
        const baseline = originalSelect(...args);
        const proposed = directInitiativeRow(diagnostic.engine, args[1]);
        if (proposed < 0) return baseline;
        diagnostic.directInitiativeProposalCount += 1;
        if (proposed !== baseline)
          diagnostic.directInitiativeOverrideCount += 1;
        return proposed;
      };
      return;
    }
    if (this.mode === STRATEGY_PRIORITY_MODE.RESOURCE_PULSE ||
        this.mode === STRATEGY_PRIORITY_MODE.SKILL_PULSE) {
      const diagnostic = this;
      const eligible = this.mode === STRATEGY_PRIORITY_MODE.SKILL_PULSE ?
        skillPulseEligible : resourcePulseEligible;
      const arbiter = this.engine.policy.strategicArbiter;
      const originalSelect = arbiter.select.bind(arbiter);
      arbiter.select = function selectResourcePulse(...args) {
        const controller = args[1]; const activeBands = args[2];
        const baseline = originalSelect(...args);
        if (baseline < 0) return baseline;
        const count = controller.outcome.count;
        diagnostic.originalBandSelected.fill(0);
        diagnostic.originalBandSelected.set(
          activeBands.selected.subarray(0, count));
        let proposals = 0;
        for (let row = 0; row < count; row += 1)
          if (!activeBands.selected[row] &&
              eligible(diagnostic.engine, controller,
                baseline, row)) {
            activeBands.selected[row] = 1; proposals += 1;
          }
        diagnostic.resourcePulseProposalCount += proposals;
        if (!proposals) return baseline;
        const selected = originalSelect(...args);
        if (selected !== baseline)
          diagnostic.resourcePulseOverrideCount += 1;
        return selected;
      };
      return;
    }
    if (this.mode === STRATEGY_PRIORITY_MODE.BAND_OFF_ONCE &&
        typeof bands.buildPortfolio === "function") {
      const diagnostic = this;
      const originalBuild = bands.buildPortfolio.bind(bands);
      bands.buildPortfolio = function buildOneShotOpenPortfolio(controller,
          decisions, currentStrategy, actions, count = this.count, combat = null,
          approvedChallenger = -1) {
        const originalCount = originalBuild(controller, decisions,
          currentStrategy, actions, count, combat, approvedChallenger);
        if (diagnostic.bandOffOnceConsumed) return originalCount;
        diagnostic.originalBandSelected.fill(0);
        diagnostic.originalBandSelected.set(this.selected.subarray(0, count));
        const outcome = controller.outcome;
        this.selected.fill(0, 0, count); this.selectedCount = 0;
        for (let row = 0; row < count; row += 1)
          if (outcome.acceptable[row] && !outcome.dominated[row]) {
            this.selected[row] = 1; this.selectedCount += 1;
          }
        return this.selectedCount;
      };
      const arbiter = this.engine.policy.strategicArbiter;
      const originalSelect = arbiter.select.bind(arbiter);
      arbiter.select = function selectOneShotOpenPortfolio(...args) {
        if (diagnostic.bandOffOnceConsumed)
          return originalSelect(...args);
        const activeBands = args[2];
        const count = activeBands.count || activeBands.selected.length;
        diagnostic.openBandSelected.fill(0);
        diagnostic.openBandSelected.set(
          activeBands.selected.subarray(0, count));
        activeBands.selected.set(
          diagnostic.originalBandSelected.subarray(0, count));
        diagnostic.bandOffOnceShadowRow = originalSelect(...args);
        activeBands.selected.set(
          diagnostic.openBandSelected.subarray(0, count));
        diagnostic.bandOffOnceOpenRow = originalSelect(...args);
        return diagnostic.bandOffOnceOpenRow;
      };
      return;
    }
    if (typeof bands.buildPortfolio === "function") {
      bands.buildPortfolio = function buildPortfolioWithoutStrategy(controller,
          decisions, currentStrategy, actions, count = this.count) {
        const outcome = controller.outcome;
        const expected = outcome.expectedValue || outcome.robustLower;
        this.selected.fill(0, 0, count); this.selectedCount = 0;
        this.selectedBand = STRATEGY_BAND.INELIGIBLE; this.fallbackUsed = 0;
        this.baseAnchorRow = -1;
        for (let row = 0; row < count; row += 1)
          if (outcome.acceptable[row] && !outcome.dominated[row]) {
            this.selected[row] = 1; this.selectedCount += 1;
            if (this.baseAnchorRow < 0 ||
                expected[row] > expected[this.baseAnchorRow] ||
                (expected[row] === expected[this.baseAnchorRow] &&
                 row < this.baseAnchorRow)) this.baseAnchorRow = row;
          }
        if (this.baseAnchorRow >= 0 && this.baseAnchor)
          this.baseAnchor[this.baseAnchorRow] = 1;
        this.portfolioBuildCount += 1; return this.selectedCount;
      };
      return;
    }
    bands.restrict = function restrictWithoutStrategyBand(controller, strategyId,
        count = this.count) {
      const outcome = controller.outcome;
      this.selected.fill(0, 0, count);
      this.selectedBand = STRATEGY_BAND.INELIGIBLE;
      this.selectedCount = 0; this.fallbackUsed = 0;
      if (controller.acceptableCount === 0) {
        this.restrictCount += 1; return 0;
      }
      for (let row = 0; row < count; row += 1)
        if (outcome.acceptable[row] && !outcome.dominated[row]) {
          this.selected[row] = 1;
          this.selectedCount += 1;
        }
      this.restrictCount += 1;
      return this.selectedCount;
    };
  }
  capture(selectedAction) {
    const engine = this.engine; const bands = engine.strategyBands;
    const outcome = engine.riskController.outcome; const count = engine.ourCount;
    let eligible = 0; let qualifiedFire = 0; let qualifiedPrimary = 0;
    let qualifiedInBand = 0; let possibleHit = 0; let possibleHitInBand = 0;
    let setup = 0; let selectedRow = -1;
    for (let row = 0; row < count; row += 1) {
      const action = engine.ourActions[row];
      const globallyEligible = outcome.acceptable[row] && !outcome.dominated[row];
      if (globallyEligible) {
        eligible += 1;
        const purpose = bands.purpose[row];
        if (action === ACTION.FIRE &&
            (purpose & STRATEGY_PURPOSE.ADVANTAGEOUS_FIRE)) {
          qualifiedFire += 1;
          if (typeof bands.bandForStrategy === "function" ?
              bands.bandForStrategy(STRATEGY.KILL_PRESSURE, purpose) ===
                STRATEGY_BAND.PRIMARY :
              bands.band[row] === STRATEGY_BAND.PRIMARY) qualifiedPrimary += 1;
          if (bands.selected[row]) qualifiedInBand += 1;
        }
        if (action === ACTION.FIRE && engine.combat.vector.possibleHit[row]) {
          possibleHit += 1;
          if (bands.selected[row]) possibleHitInBand += 1;
        }
        if (purpose & ATTACK_SETUP_MASK) setup += 1;
      }
      if (row === engine.lastSelectedIndex && action === selectedAction) selectedRow = row;
      else if (selectedRow < 0 && action === selectedAction) selectedRow = row;
    }
    this.roots += 1;
    if (eligible > 0) this.eligibleRoots += 1;
    if (qualifiedFire > 0) {
      this.qualifiedFireOpportunityRoots += 1;
      if (qualifiedPrimary > 0) this.qualifiedFirePrimaryRoots += 1;
      if (qualifiedInBand > 0) this.qualifiedFireInSelectedBandRoots += 1;
    }
    if (possibleHit > 0) {
      this.possibleHitOpportunityRoots += 1;
      if (possibleHitInBand > 0) this.possibleHitInSelectedBandRoots += 1;
    }
    if (setup > 0) this.setupOpportunityRoots += 1;
    if (qualifiedFire > 0 || setup > 0) this.attackOpportunityRoots += 1;
    addCount(this.strategyCounts, strategyName(engine.policy.strategyId));
    addCount(this.selectedBandCounts, bandName(bands.selectedBand));
    if (selectedRow < 0) return;
    if (this.mode === STRATEGY_PRIORITY_MODE.BAND_OFF_ONCE &&
        !this.bandOffOnceConsumed &&
        this.bandOffOnceOpenRow >= 0 &&
        this.bandOffOnceShadowRow >= 0 &&
        (engine.ourActions[this.bandOffOnceOpenRow] !==
          engine.ourActions[this.bandOffOnceShadowRow] ||
         engine.ourArguments?.[this.bandOffOnceOpenRow] !==
          engine.ourArguments?.[this.bandOffOnceShadowRow]) &&
        engine.ourActions[this.bandOffOnceOpenRow] === selectedAction) {
      this.bandOffOnceConsumed = 1;
      this.bandOffOnceOverrideCount += 1;
    }
    const selectedPurpose = bands.purpose[selectedRow];
    if (selectedAction === ACTION.FIRE) {
      const combatPurpose = engine.combat.vector.purposeFlags[selectedRow];
      this.fireChosenRoots += 1;
      if (selectedPurpose) this.anyPurposeFireChosenRoots += 1;
      if (selectedPurpose & STRATEGY_PURPOSE.PLAN_CONTINUATION)
        this.planContinuationFireChosenRoots += 1;
      if (selectedPurpose & PURPOSEFUL_FIRE_MASK) this.purposefulFireChosenRoots += 1;
      else this.purposelessFireChosenRoots += 1;
      if (engine.adapter.enemyVisible) {
        this.visibleFireChosenRoots += 1;
        if (!combatPurpose) this.visibleMissFireChosenRoots += 1;
      } else {
        this.hiddenFireChosenRoots += 1;
        if (!combatPurpose) this.hiddenNoBeliefFireChosenRoots += 1;
      }
      if (bands.selected[selectedRow]) this.fireInsideSelectedBandRoots += 1;
      else this.fireOutsideSelectedBandRoots += 1;
      if (engine.lastProofStatus === PROOF_STATUS.PROVEN)
        this.forcedProofFireChosenRoots += 1;
      if (engine.finalGate && engine.finalGate.lastPreferred >= 0 &&
          engine.finalGate.lastSelected !== engine.finalGate.lastPreferred)
        this.finalGateOverrideFireChosenRoots += 1;
      if (engine.riskController.noAcceptableAction)
        this.noAcceptableFireChosenRoots += 1;
      if (qualifiedFire > 0 && (selectedPurpose & STRATEGY_PURPOSE.ADVANTAGEOUS_FIRE))
        this.qualifiedFireChosenRoots += 1;
      if (engine.combat.vector.possibleHit[selectedRow])
        this.possibleHitFireChosenRoots += 1;
    }
    if (qualifiedFire > 0 && selectedAction !== ACTION.FIRE)
      this.qualifiedFireMissedRoots += 1;
    if (selectedPurpose & (ATTACK_FIRE_MASK | ATTACK_SETUP_MASK))
      this.attackPurposeChosenRoots += 1;
    if (selectedPurpose & (STRATEGY_PURPOSE.STAR_COLLECT | STRATEGY_PURPOSE.STAR_DENY))
      this.starPurposeChosenRoots += 1;
  }
  summary() {
    const attack = this.engine.projectileAttack;
    return {
      mode: this.mode,
      roots: this.roots,
      eligibleRoots: this.eligibleRoots,
      qualifiedFireOpportunityRoots: this.qualifiedFireOpportunityRoots,
      qualifiedFirePrimaryRoots: this.qualifiedFirePrimaryRoots,
      qualifiedFireInSelectedBandRoots: this.qualifiedFireInSelectedBandRoots,
      qualifiedFireChosenRoots: this.qualifiedFireChosenRoots,
      qualifiedFireMissedRoots: this.qualifiedFireMissedRoots,
      possibleHitOpportunityRoots: this.possibleHitOpportunityRoots,
      possibleHitInSelectedBandRoots: this.possibleHitInSelectedBandRoots,
      possibleHitFireChosenRoots: this.possibleHitFireChosenRoots,
      setupOpportunityRoots: this.setupOpportunityRoots,
      attackOpportunityRoots: this.attackOpportunityRoots,
      attackPurposeChosenRoots: this.attackPurposeChosenRoots,
      fireChosenRoots: this.fireChosenRoots,
      purposefulFireChosenRoots: this.purposefulFireChosenRoots,
      purposelessFireChosenRoots: this.purposelessFireChosenRoots,
      anyPurposeFireChosenRoots: this.anyPurposeFireChosenRoots,
      planContinuationFireChosenRoots: this.planContinuationFireChosenRoots,
      visibleFireChosenRoots: this.visibleFireChosenRoots,
      hiddenFireChosenRoots: this.hiddenFireChosenRoots,
      visibleMissFireChosenRoots: this.visibleMissFireChosenRoots,
      hiddenNoBeliefFireChosenRoots: this.hiddenNoBeliefFireChosenRoots,
      fireInsideSelectedBandRoots: this.fireInsideSelectedBandRoots,
      fireOutsideSelectedBandRoots: this.fireOutsideSelectedBandRoots,
      forcedProofFireChosenRoots: this.forcedProofFireChosenRoots,
      finalGateOverrideFireChosenRoots: this.finalGateOverrideFireChosenRoots,
      noAcceptableFireChosenRoots: this.noAcceptableFireChosenRoots,
      starPurposeChosenRoots: this.starPurposeChosenRoots,
      projectileAttackEvaluations: attack ? attack.evaluationCount : 0,
      projectileAttackReverseBuilds: attack ? attack.reverseBuildCount : 0,
      projectileAttackCacheHits: attack ? attack.cacheHitCount : 0,
      projectileAttackCompleteRows: attack ? attack.completeCount : 0,
      projectileAttackIncompleteRows: attack ? attack.incompleteCount : 0,
      projectileAttackDoomedCells: attack ? attack.doomedCellCount : 0,
      projectileFrontierDistanceBuilds: attack ?
        attack.frontierDistanceBuildCount : 0,
      projectileFrontierBuilds: attack ? attack.frontierBuildCount : 0,
      projectileFrontierPressureCells: attack ?
        attack.frontierPressureCellCount : 0,
      projectileFrontierSetupDelay: attack ?
        attack.frontierSetupDelayTotal : 0,
      projectileFrontierMobilityLoss: attack ?
        attack.frontierMobilityLossTotal : 0,
      projectileFrontierEndpointReduction: attack ?
        attack.frontierEndpointReductionTotal : 0,
      projectileFrontierIncomplete: attack ?
        attack.frontierIncompleteCount : 0,
      ownershipPoc: this.ownershipPoc ? this.ownershipPoc.summary() : null,
      proposalVerification: this.proposalVerification ?
        this.proposalVerification.summary() : null,
      bandOffOnceConsumed: Boolean(this.bandOffOnceConsumed),
      bandOffOnceOverrideCount: this.bandOffOnceOverrideCount,
      bandOffOnceShadowRow: this.bandOffOnceShadowRow,
      bandOffOnceOpenRow: this.bandOffOnceOpenRow,
      resourcePulseProposalCount: this.resourcePulseProposalCount,
      resourcePulseOverrideCount: this.resourcePulseOverrideCount,
      informationValueRootCount: this.informationValueRootCount,
      informationValueOverrideCount: this.informationValueOverrideCount,
      informationValueConsumed: Boolean(this.informationValueConsumed),
      poisonEvidenceRootCount: this.poisonEvidenceRootCount,
      poisonEvidenceOverrideCount: this.poisonEvidenceOverrideCount,
      directInitiativeProposalCount: this.directInitiativeProposalCount,
      directInitiativeOverrideCount: this.directInitiativeOverrideCount,
      strategyCounts: { ...this.strategyCounts },
      selectedBandCounts: { ...this.selectedBandCounts }
    };
  }
}

function installStrategyPriorityDiagnostic(engine, mode) {
  return new StrategyPriorityDiagnostic(engine, mode || STRATEGY_PRIORITY_MODE.CURRENT);
}

module.exports = {
  STRATEGY_PRIORITY_MODE,
  MODES,
  VALID_MODES,
  ATTACK_FIRE_MASK,
  ATTACK_SETUP_MASK,
  PURPOSEFUL_FIRE_MASK,
  STRONG_COMBAT,
  riskNoWorse,
  resourcePulseEligible,
  skillPulseEligible,
  poisonOwnershipEvidence,
  attackArrivalFrames,
  directInitiativeRow,
  StrategyPriorityDiagnostic,
  installStrategyPriorityDiagnostic
};
