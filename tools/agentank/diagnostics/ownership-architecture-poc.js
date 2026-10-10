"use strict";

const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { GLOBAL_MODE, PLAN_PURPOSE, NONE_HANDLE, COMBAT_PURPOSE,
  STRATEGY_BAND } = require("../../../engine-v2/src/abi/policy-codes");
const { ROOT_CONTROL_MODE } = require("../../../engine-v2/src/runtime/root-control-mode");

const NO_DEADLINE = 0xffff;
const OBJECTIVE = Object.freeze({ POSITION: 0, STAR: 1, ATTACK: 2,
  PRESERVE: 3, COMEBACK: 4 });

function hardAllowed(outcome, row) {
  return outcome.hard[row] !== HARD_STATUS.REJECT_PROVEN &&
    outcome.hard[row] !== HARD_STATUS.REJECT_POLICY;
}

function excess(value, limit) { return value > limit ? value - limit : 0; }

function riskViolation(controller, row, dimension) {
  const outcome = controller.outcome;
  if (dimension === 0) return excess(outcome.immediateFatalMass[row], controller.immediateLimit);
  if (dimension === 1) return excess(outcome.horizonFatalMass[row], controller.horizonLimit);
  if (dimension === 2) return excess(outcome.unknownMass[row], controller.unknownLimit);
  return excess(controller.minimumEscapeSlack, outcome.escapeSlack[row]);
}

function violationDominates(controller, left, right) {
  let strict = 0;
  for (let dimension = 0; dimension < 4; dimension += 1) {
    const l = riskViolation(controller, left, dimension);
    const r = riskViolation(controller, right, dimension);
    if (l > r) return 0;
    if (l < r) strict = 1;
  }
  const outcome = controller.outcome;
  if (outcome.earliestFatalFrame[left] < outcome.earliestFatalFrame[right]) return 0;
  if (outcome.earliestFatalFrame[left] > outcome.earliestFatalFrame[right]) strict = 1;
  return strict;
}

// Absolute risk thresholds remain the normal contract. This recovery is used
// only when every Hard-legal action violated at least one soft threshold. It
// preserves the non-dominated minimum-violation frontier instead of allowing
// the legacy single-row emergency comparator to erase all objective evidence.
function recoverRiskFrontier(controller) {
  if (controller.acceptableCount !== 0) return 0;
  const outcome = controller.outcome; let recovered = 0;
  for (let row = 0; row < outcome.count; row += 1) {
    if (!hardAllowed(outcome, row)) { outcome.acceptable[row] = 0; continue; }
    let dominated = 0;
    for (let other = 0; other < outcome.count; other += 1) {
      if (other === row || !hardAllowed(outcome, other)) continue;
      if (violationDominates(controller, other, row)) { dominated = 1; break; }
    }
    outcome.acceptable[row] = dominated ? 0 : 1;
    if (!dominated) recovered += 1;
  }
  controller.acceptableCount = recovered;
  if (recovered > 0) controller.recomputeSelectionFrontier();
  // Keep noAcceptableAction set for diagnostics: this root used degraded
  // recovery even though selection can now consume a frontier.
  return recovered;
}

function installAllActionPortfolio(bands) {
  bands.buildPortfolio = function buildOwnershipPocPortfolio(controller,
      decisions, currentStrategy, actions, count = this.count, combat = null) {
    const outcome = controller.outcome;
    this.selected.fill(0, 0, count); this.proposalMask.fill(0, 0, count);
    this.ownerStrategy.fill(0xff, 0, count);
    this.ownerBand.fill(STRATEGY_BAND.INELIGIBLE, 0, count);
    this.baseAnchor.fill(0, 0, count); this.selectedCount = 0;
    this.fallbackUsed = 0; this.baseAnchorRow = -1;
    this.selectedBand = STRATEGY_BAND.INELIGIBLE;
    this.importCombat(actions, count, combat);
    for (let row = 0; row < count; row += 1) {
      if (!outcome.acceptable[row] || outcome.dominated[row]) continue;
      this.selected[row] = 1; this.selectedCount += 1;
      if (this.baseAnchorRow < 0 || this.baseBetter(outcome, row, this.baseAnchorRow))
        this.baseAnchorRow = row;
    }
    if (this.baseAnchorRow >= 0) this.baseAnchor[this.baseAnchorRow] = 1;
    this.portfolioBuildCount += 1; return this.selectedCount;
  };
}

function candidateEligible(outcome, envelope, row) {
  return outcome.acceptable[row] && !outcome.dominated[row] &&
    (!envelope || !envelope.refuted(row));
}

function planPurpose(handles, sketches, row) {
  const handle = handles[row];
  return handle === NONE_HANDLE ? 0 : sketches.purpose[handle];
}

function planProgress(handles, sketches, row) {
  const handle = handles[row];
  return handle === NONE_HANDLE ? 0 : sketches.rawScore[handle];
}

function planDeadline(handles, sketches, row) {
  const handle = handles[row];
  return handle === NONE_HANDLE ? NO_DEADLINE : sketches.deadline[handle];
}

function verifiedSafeKill(engine, outcome, row) {
  if (engine.ourActions[row] !== ACTION.FIRE) return 0;
  const purpose = outcome.combatPurpose[row];
  return Boolean((purpose & COMBAT_PURPOSE.DIRECT_KILL) &&
    outcome.purposeCompleteness[row] >= 4500 && outcome.postFireEscape[row]);
}

function rootObjective(engine, bands, globalMode) {
  if (globalMode === GLOBAL_MODE.HARD_SURVIVAL) return OBJECTIVE.PRESERVE;
  if (globalMode === GLOBAL_MODE.FORCED_LOSS_RECOVERY) return OBJECTIVE.COMEBACK;
  const kill = bands.killDeadline > 0 ? bands.killDeadline : NO_DEADLINE;
  const star = bands.starDeadline > 0 ? bands.starDeadline : NO_DEADLINE;
  if (kill !== NO_DEADLINE && kill <= star) return OBJECTIVE.ATTACK;
  if (star !== NO_DEADLINE) return OBJECTIVE.STAR;
  if (kill !== NO_DEADLINE) return OBJECTIVE.ATTACK;
  return OBJECTIVE.POSITION;
}

function purposeRank(purpose, objective) {
  if (objective === OBJECTIVE.PRESERVE) return purpose === PLAN_PURPOSE.PRESERVE ? 0 : 2;
  if (objective === OBJECTIVE.COMEBACK)
    return purpose === PLAN_PURPOSE.COMEBACK ? 0 :
      purpose === PLAN_PURPOSE.DIRECT_KILL || purpose === PLAN_PURPOSE.STAR_COLLECT ? 1 : 3;
  if (objective === OBJECTIVE.ATTACK)
    return purpose === PLAN_PURPOSE.DIRECT_KILL || purpose === PLAN_PURPOSE.INTERCEPT ||
      purpose === PLAN_PURPOSE.SHIELD_BREAK ? 0 :
      purpose === PLAN_PURPOSE.ESCAPE_FORCING || purpose === PLAN_PURPOSE.ZONE_DENIAL ||
      purpose === PLAN_PURPOSE.CADENCE_DENY ? 1 :
      purpose === PLAN_PURPOSE.STAR_COLLECT ? 2 : 3;
  if (objective === OBJECTIVE.STAR)
    return purpose === PLAN_PURPOSE.STAR_COLLECT || purpose === PLAN_PURPOSE.STAR_DENIAL ? 0 :
      purpose === PLAN_PURPOSE.DIRECT_KILL || purpose === PLAN_PURPOSE.INTERCEPT ? 1 : 2;
  return purpose === PLAN_PURPOSE.REPOSITION ? 0 :
    purpose === PLAN_PURPOSE.DIRECT_KILL || purpose === PLAN_PURPOSE.INTERCEPT ? 1 : 2;
}

function strategicBetter(engine, controller, bands, handles, sketches, envelope,
    globalMode, left, right) {
  if (right < 0) return 1;
  const outcome = controller.outcome;
  const leftTerminal = engine.policy.strategicArbiter.terminalRank(bands, left, globalMode);
  const rightTerminal = engine.policy.strategicArbiter.terminalRank(bands, right, globalMode);
  if (leftTerminal !== rightTerminal) return leftTerminal < rightTerminal;
  const leftKill = verifiedSafeKill(engine, outcome, left);
  const rightKill = verifiedSafeKill(engine, outcome, right);
  if (leftKill !== rightKill) return leftKill > rightKill;
  const objective = rootObjective(engine, bands, globalMode);
  const leftRank = purposeRank(planPurpose(handles, sketches, left), objective);
  const rightRank = purposeRank(planPurpose(handles, sketches, right), objective);
  if (leftRank !== rightRank) return leftRank < rightRank;
  const leftProgress = planProgress(handles, sketches, left);
  const rightProgress = planProgress(handles, sketches, right);
  if (leftProgress !== rightProgress) return leftProgress > rightProgress;
  const leftDeadline = planDeadline(handles, sketches, left);
  const rightDeadline = planDeadline(handles, sketches, right);
  if (leftDeadline !== rightDeadline) return leftDeadline < rightDeadline;
  // Risk already owns membership. It is evidence after goal progress, not a
  // second hidden gate in strategic navigation.
  if (outcome.robustLower[left] !== outcome.robustLower[right])
    return outcome.robustLower[left] > outcome.robustLower[right];
  if (outcome.expectedValue[left] !== outcome.expectedValue[right])
    return outcome.expectedValue[left] > outcome.expectedValue[right];
  if (outcome.tacticalValue[left] !== outcome.tacticalValue[right])
    return outcome.tacticalValue[left] > outcome.tacticalValue[right];
  return left < right;
}

function tacticalBetter(controller, probability, handles, sketches, left, right) {
  if (right < 0) return 1;
  const outcome = controller.outcome;
  // Search owns contact: robust response quality first, then nominal and
  // tactical value. Plan evidence is only a late tie-break.
  if (outcome.robustLower[left] !== outcome.robustLower[right])
    return outcome.robustLower[left] > outcome.robustLower[right];
  if (outcome.expectedValue[left] !== outcome.expectedValue[right])
    return outcome.expectedValue[left] > outcome.expectedValue[right];
  if (outcome.tacticalValue[left] !== outcome.tacticalValue[right])
    return outcome.tacticalValue[left] > outcome.tacticalValue[right];
  if (outcome.purposeCompleteness[left] !== outcome.purposeCompleteness[right])
    return outcome.purposeCompleteness[left] > outcome.purposeCompleteness[right];
  const leftProgress = planProgress(handles, sketches, left);
  const rightProgress = planProgress(handles, sketches, right);
  if (leftProgress !== rightProgress) return leftProgress > rightProgress;
  if (probability[left] !== probability[right]) return probability[left] > probability[right];
  return left < right;
}

class OwnershipArchitecturePoc {
  constructor(engine, options = {}) {
    this.engine = engine; this.recoveredRiskRoots = 0;
    this.recoveredRiskRows = 0; this.strategicSelections = 0;
    this.tacticalSelections = 0; this.escapeSelections = 0;
    this.recoverRisk = options.recoverRisk !== false ? 1 : 0;
    this.routeOwnership = options.routeOwnership !== false ? 1 : 0;
    this.strategicRecoveryOnly = options.strategicRecoveryOnly ? 1 : 0;
    this.install();
  }

  install() {
    const engine = this.engine; const controller = engine.riskController;
    if (this.recoverRisk) {
      const originalGate = controller.gate.bind(controller);
      controller.gate = (baseRisk, stateRiskClass) => {
        const accepted = originalGate(baseRisk, stateRiskClass);
        if (accepted) return accepted;
        if (this.strategicRecoveryOnly &&
            (engine.lastControlMode !== ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION ||
             engine.escapeObligation.committedEntityCount > 0)) return accepted;
        const recovered = recoverRiskFrontier(controller);
        if (recovered > 0) {
          this.recoveredRiskRoots += 1; this.recoveredRiskRows += recovered;
        }
        return recovered;
      };
    }
    installAllActionPortfolio(engine.strategyBands);
    if (!this.routeOwnership) { engine.ownershipArchitecturePoc = this; return; }
    const arbiter = engine.policy.strategicArbiter;
    arbiter.select = (mode, activeController, bands, probability, envelope, seed,
        handles, sketches, profile, globalMode) => {
      arbiter.selectCount += 1;
      if (mode === ROOT_CONTROL_MODE.COMMITTED_ESCAPE) {
        arbiter.escapeCount += 1; this.escapeSelections += 1;
        const selected = arbiter.selectEscape(activeController, null, envelope);
        return selected >= 0 ? selected : activeController.select(seed, null, null);
      }
      const outcome = activeController.outcome; let best = -1;
      if (mode === ROOT_CONTROL_MODE.TACTICAL_CONTACT) {
        arbiter.tacticalCount += 1; this.tacticalSelections += 1;
        for (let row = 0; row < outcome.count; row += 1)
          if (candidateEligible(outcome, envelope, row) &&
              tacticalBetter(activeController, probability, handles, sketches, row, best)) best = row;
      } else {
        arbiter.strategicCount += 1; this.strategicSelections += 1;
        for (let row = 0; row < outcome.count; row += 1)
          if (candidateEligible(outcome, envelope, row) && strategicBetter(engine,
              activeController, bands, handles, sketches, envelope, globalMode, row, best)) best = row;
      }
      return best >= 0 ? best : activeController.select(seed, null, null);
    };
    engine.ownershipArchitecturePoc = this;
  }

  summary() {
    return { recoveredRiskRoots: this.recoveredRiskRoots,
      recoveredRiskRows: this.recoveredRiskRows,
      strategicSelections: this.strategicSelections,
      tacticalSelections: this.tacticalSelections,
      escapeSelections: this.escapeSelections,
      recoverRisk: this.recoverRisk, routeOwnership: this.routeOwnership,
      strategicRecoveryOnly: this.strategicRecoveryOnly };
  }
}

function installOwnershipArchitecturePoc(engine) {
  return new OwnershipArchitecturePoc(engine);
}

function installOwnershipRiskFrontierPoc(engine) {
  return new OwnershipArchitecturePoc(engine, { recoverRisk: true,
    routeOwnership: false });
}

function installOwnershipRouterPoc(engine) {
  return new OwnershipArchitecturePoc(engine, { recoverRisk: false,
    routeOwnership: true });
}

function installStrategicRiskFrontierPoc(engine) {
  return new OwnershipArchitecturePoc(engine, { recoverRisk: true,
    routeOwnership: false, strategicRecoveryOnly: true });
}

module.exports = { NO_DEADLINE, OBJECTIVE, hardAllowed, riskViolation,
  violationDominates, recoverRiskFrontier, rootObjective, purposeRank,
  strategicBetter, tacticalBetter, OwnershipArchitecturePoc,
  installOwnershipArchitecturePoc, installOwnershipRiskFrontierPoc,
  installOwnershipRouterPoc, installStrategicRiskFrontierPoc };
