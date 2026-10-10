"use strict";

const { POLICY_CAPACITY, STRATEGY_CONFIG } = require("../generated/policy-config");
const { STRATEGY, STRATEGY_PHASE, STRATEGY_INPUT, GLOBAL_MODE, EVAL_PROFILE,
  STRATEGY_MODIFIER } = require("../abi/policy-codes");

const NO_OBJECTIVE_DEADLINE = 0xffff;

function clamp(value, minimum, maximum) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

class StrategyInputFrame {
  constructor() {
    this.values = new Int16Array(STRATEGY_INPUT.COUNT); this.modifierMask = 0;
    this.hotAllocationCount = 0;
  }
  reset() { this.values.fill(0); this.modifierMask = 0; }
  set(index, value) {
    if (index < 0 || index >= STRATEGY_INPUT.COUNT ||
        !Number.isSafeInteger(value)) return 0;
    this.values[index] = clamp(value, -10000, 10000); return 1;
  }
}

// Strategy choice is intentionally vector-valued.  The fields are compared
// lexicographically and are never collapsed into the action evaluation score.
class StrategyDecisionSlab {
  constructor(count = POLICY_CAPACITY.STRATEGY_COUNT) {
    this.count = count; this.eligible = new Uint8Array(count);
    this.rootModeFit = new Uint8Array(count);
    this.terminalNecessity = new Uint16Array(count);
    this.verifiedOpportunity = new Uint16Array(count);
    this.objectiveDeadline = new Uint16Array(count);
    this.purposeCompleteness = new Uint16Array(count);
    this.planContinuity = new Uint16Array(count);
    this.reversibility = new Uint16Array(count);
    this.switchCost = new Uint16Array(count);
    this.hotAllocationCount = 0; this.reset();
  }
  reset() {
    this.eligible.fill(0); this.rootModeFit.fill(0); this.terminalNecessity.fill(0);
    this.verifiedOpportunity.fill(0); this.objectiveDeadline.fill(NO_OBJECTIVE_DEADLINE);
    this.purposeCompleteness.fill(0); this.planContinuity.fill(0);
    this.reversibility.fill(0); this.switchCost.fill(0);
  }
}

class StrategySelector {
  constructor() {
    this.decisions = new StrategyDecisionSlab();
    // Kept as a compatibility/read-only diagnostic alias.  It is no longer an
    // additive strategy score.
    this.scores = this.decisions.verifiedOpportunity;
    this.current = STRATEGY_CONFIG.DEFAULT_STRATEGY;
    this.phase = STRATEGY_PHASE.OPEN; this.dwellRoots = 0; this.generation = 1;
    this.lastMode = GLOBAL_MODE.NORMAL;
    this.evalProfileId = EVAL_PROFILE.CANONICAL_OUTCOME;
    this.riskProfileId = 0; this.baseRisk = STRATEGY_CONFIG.DEFAULT_BASE_RISK;
    this.modifierMask = 0; this.switchCount = 0; this.reasonFlags = 0;
    this.hotAllocationCount = 0;
  }
  reset() {
    this.current = STRATEGY_CONFIG.DEFAULT_STRATEGY; this.phase = STRATEGY_PHASE.OPEN;
    this.dwellRoots = 0; this.generation += 1; this.switchCount = 0;
    this.lastMode = GLOBAL_MODE.NORMAL; this.modifierMask = 0; this.reasonFlags = 0;
    this.evalProfileId = EVAL_PROFILE.CANONICAL_OUTCOME;
    this.riskProfileId = 0; this.baseRisk = STRATEGY_CONFIG.DEFAULT_BASE_RISK;
    this.decisions.reset();
  }
  classifyPhase(input) {
    const urgency = input.values[STRATEGY_INPUT.TERMINAL_URGENCY];
    if (urgency >= STRATEGY_CONFIG.PHASE_LOCKED_URGENCY) return STRATEGY_PHASE.LOCKED;
    if (urgency >= STRATEGY_CONFIG.PHASE_DECISIVE_URGENCY) return STRATEGY_PHASE.DECISIVE;
    if (urgency >= 3000 || input.values[STRATEGY_INPUT.DIRECT_HIT_WINDOW] >= 5000)
      return STRATEGY_PHASE.SHAPING;
    return STRATEGY_PHASE.OPEN;
  }
  deadline(value) {
    return value > 0 && value < NO_OBJECTIVE_DEADLINE ? value : NO_OBJECTIVE_DEADLINE;
  }
  fillDecision(row, eligible, terminal, opportunity, deadline, completeness,
      continuity, reversibility) {
    const d = this.decisions; d.eligible[row] = eligible ? 1 : 0;
    d.rootModeFit[row] = 1;
    d.terminalNecessity[row] = clamp(terminal, 0, 10000);
    d.verifiedOpportunity[row] = clamp(opportunity, 0, 10000);
    d.objectiveDeadline[row] = this.deadline(deadline);
    d.purposeCompleteness[row] = clamp(completeness, 0, 10000);
    d.planContinuity[row] = clamp(continuity, 0, 10000);
    d.reversibility[row] = clamp(reversibility, 0, 10000);
    d.switchCost[row] = row === this.current ? 0 :
      STRATEGY_CONFIG.SWITCH_MARGIN_MATRIX[row * STRATEGY.COUNT + this.current];
  }
  buildDecisions(input) {
    const v = input.values; const d = this.decisions; d.reset();
    const urgency = Math.max(0, v[STRATEGY_INPUT.TERMINAL_URGENCY]);
    const lead = Math.max(0, v[STRATEGY_INPUT.LEAD_SECURITY]);
    const comeback = Math.max(0, v[STRATEGY_INPUT.COMEBACK_PRESSURE]);
    const starRace = Math.max(0, v[STRATEGY_INPUT.STAR_RACE]);
    const killOpportunity = Math.max(0, v[STRATEGY_INPUT.DIRECT_HIT_WINDOW],
      v[STRATEGY_INPUT.KILL_OPPORTUNITY]);
    const setupOpportunity = Math.max(0, v[STRATEGY_INPUT.SETUP_OPPORTUNITY],
      v[STRATEGY_INPUT.POSITION_CONTROL]);
    const completeness = Math.max(0, v[STRATEGY_INPUT.PURPOSE_COMPLETENESS]);
    const continuity = Math.max(0, v[STRATEGY_INPUT.PLAN_CONTINUITY]);
    const reversibility = Math.max(0, v[STRATEGY_INPUT.REVERSIBILITY],
      v[STRATEGY_INPUT.SAFE_SUCCESSORS]);
    const decisive = urgency >= STRATEGY_CONFIG.PHASE_DECISIVE_URGENCY;
    const locked = urgency >= STRATEGY_CONFIG.PHASE_LOCKED_URGENCY;
    const killEligible = killOpportunity >= STRATEGY_CONFIG.VERIFIED_OPPORTUNITY &&
      completeness >= STRATEGY_CONFIG.MINIMUM_PURPOSE_COMPLETENESS;
    const starEligible = this.deadline(v[STRATEGY_INPUT.STAR_DEADLINE]) !==
      NO_OBJECTIVE_DEADLINE;
    const preserveEligible = decisive && lead > 0;
    const comebackEligible = decisive && comeback > 0;
    this.fillDecision(STRATEGY.KILL_PRESSURE, killEligible,
      decisive && killOpportunity >= 8000 ? urgency : 0,
      killOpportunity, v[STRATEGY_INPUT.KILL_DEADLINE], completeness,
      continuity, reversibility);
    this.fillDecision(STRATEGY.ATTACK_SETUP,
      setupOpportunity >= STRATEGY_CONFIG.VERIFIED_OPPORTUNITY, 0,
      setupOpportunity, v[STRATEGY_INPUT.KILL_DEADLINE] > 0 ?
        v[STRATEGY_INPUT.KILL_DEADLINE] + 1 : 0,
      completeness, continuity, reversibility);
    this.fillDecision(STRATEGY.STAR_CONTROL, starEligible,
      decisive && (comeback > 0 || lead > 0) ? urgency : 0,
      starRace, v[STRATEGY_INPUT.STAR_DEADLINE], 10000,
      0, reversibility);
    this.fillDecision(STRATEGY.PRESERVE_LEAD, preserveEligible,
      locked ? urgency : Math.floor(urgency / 2), lead,
      v[STRATEGY_INPUT.STAR_DEADLINE], 10000, continuity, reversibility);
    this.fillDecision(STRATEGY.COMEBACK, comebackEligible, urgency,
      Math.max(killOpportunity, starRace), Math.min(
        this.deadline(v[STRATEGY_INPUT.KILL_DEADLINE]),
        this.deadline(v[STRATEGY_INPUT.STAR_DEADLINE])),
      completeness, continuity, reversibility);
    return d;
  }
  // Production calls prepare() only after Hard, Risk, committed escape,
  // Pareto and the global robust floor have been formed.  It observes the
  // qualified root but deliberately does not mutate the committed strategy.
  prepare(input, globalMode = GLOBAL_MODE.NORMAL) {
    this.phase = this.classifyPhase(input); this.buildDecisions(input);
    this.modifierMask = input.modifierMask; this.lastMode = globalMode;
    if (globalMode === GLOBAL_MODE.HARD_SURVIVAL) {
      this.decisions.eligible.fill(0);
      this.decisions.eligible[STRATEGY.PRESERVE_LEAD] = 1;
    } else if (globalMode === GLOBAL_MODE.FORCED_LOSS_RECOVERY) {
      this.decisions.eligible.fill(0);
      this.decisions.eligible[STRATEGY.COMEBACK] = 1;
    }
    return this.decisions;
  }
  better(left, right) {
    if (right < 0) return 1; const d = this.decisions;
    if (d.eligible[left] !== d.eligible[right]) return d.eligible[left] > d.eligible[right];
    if (!d.eligible[left]) return left < right;
    if (d.rootModeFit[left] !== d.rootModeFit[right])
      return d.rootModeFit[left] > d.rootModeFit[right];
    if (d.terminalNecessity[left] !== d.terminalNecessity[right])
      return d.terminalNecessity[left] > d.terminalNecessity[right];
    if (d.verifiedOpportunity[left] !== d.verifiedOpportunity[right])
      return d.verifiedOpportunity[left] > d.verifiedOpportunity[right];
    if (d.objectiveDeadline[left] !== d.objectiveDeadline[right])
      return d.objectiveDeadline[left] < d.objectiveDeadline[right];
    if (d.purposeCompleteness[left] !== d.purposeCompleteness[right])
      return d.purposeCompleteness[left] > d.purposeCompleteness[right];
    if (d.planContinuity[left] !== d.planContinuity[right])
      return d.planContinuity[left] > d.planContinuity[right];
    if (d.reversibility[left] !== d.reversibility[right])
      return d.reversibility[left] > d.reversibility[right];
    if (d.switchCost[left] !== d.switchCost[right])
      return d.switchCost[left] < d.switchCost[right];
    return left < right;
  }
  materiallyBetter(candidate) {
    const d = this.decisions; const current = this.current;
    if (!d.eligible[current]) return 1;
    if (d.rootModeFit[candidate] !== d.rootModeFit[current])
      return d.rootModeFit[candidate] > d.rootModeFit[current];
    if (d.terminalNecessity[candidate] !== d.terminalNecessity[current])
      return d.terminalNecessity[candidate] > d.terminalNecessity[current];
    const margin = STRATEGY_CONFIG.SWITCH_MARGIN_MATRIX[
      candidate * STRATEGY.COUNT + current];
    if (d.verifiedOpportunity[candidate] !== d.verifiedOpportunity[current])
      return d.verifiedOpportunity[candidate] >=
        d.verifiedOpportunity[current] + margin;
    if (d.objectiveDeadline[candidate] !== d.objectiveDeadline[current])
      return d.objectiveDeadline[candidate] < d.objectiveDeadline[current];
    if (d.purposeCompleteness[candidate] !== d.purposeCompleteness[current])
      return d.purposeCompleteness[candidate] > d.purposeCompleteness[current];
    if (d.planContinuity[candidate] !== d.planContinuity[current])
      return d.planContinuity[candidate] > d.planContinuity[current];
    if (d.reversibility[candidate] !== d.reversibility[current])
      return d.reversibility[candidate] > d.reversibility[current];
    return 0;
  }
  interruptsDwell(candidate, input) {
    const d = this.decisions;
    if (d.terminalNecessity[candidate] !== d.terminalNecessity[this.current]) return 1;
    if (input.modifierMask & (STRATEGY_MODIFIER.EVADE_COMMITTED |
        STRATEGY_MODIFIER.TERMINAL_URGENCY)) return 1;
    if (candidate === STRATEGY.KILL_PRESSURE &&
        d.verifiedOpportunity[candidate] >= STRATEGY_CONFIG.VERIFIED_OPPORTUNITY &&
        d.purposeCompleteness[candidate] >= 4500) return 1;
    return 0;
  }
  commit(candidate) {
    if (candidate === this.current) { this.dwellRoots += 1; return this.current; }
    this.current = candidate; this.dwellRoots = 0; this.generation += 1;
    this.switchCount += 1; return this.current;
  }
  commitSelected(candidate, globalMode = this.lastMode) {
    if (globalMode === GLOBAL_MODE.HARD_SURVIVAL)
      candidate = STRATEGY.PRESERVE_LEAD;
    else if (globalMode === GLOBAL_MODE.FORCED_LOSS_RECOVERY)
      candidate = STRATEGY.COMEBACK;
    if (candidate < 0 || candidate >= STRATEGY.COUNT ||
        !this.decisions.eligible[candidate]) {
      this.dwellRoots += 1; return this.current;
    }
    // Dwell affects future proposal ordering only.  It must never replace the
    // concrete action that the safety/search pipeline has already selected.
    return this.commit(candidate);
  }
  // Read-only proposal decision for the action portfolio. This applies the
  // same hysteresis and switch margins as select(), but cannot mutate current,
  // dwellRoots or generation. Strategy changes remain owned by the finally
  // selected action through commitSelected().
  candidateForPortfolio(input, globalMode = this.lastMode) {
    if (globalMode === GLOBAL_MODE.FORCED_WIN) return -1;
    let candidate = -1;
    for (let row = 0; row < STRATEGY.COUNT; row += 1)
      if (this.better(row, candidate)) candidate = row;
    if (candidate < 0 || candidate === this.current) return -1;
    if (globalMode === GLOBAL_MODE.HARD_SURVIVAL) return STRATEGY.PRESERVE_LEAD;
    if (globalMode === GLOBAL_MODE.FORCED_LOSS_RECOVERY) return STRATEGY.COMEBACK;
    return (this.dwellRoots >= STRATEGY_CONFIG.MINIMUM_DWELL_ROOTS[this.current] ||
      this.interruptsDwell(candidate, input)) && this.materiallyBetter(candidate) ?
      candidate : -1;
  }
  select(input, globalMode = GLOBAL_MODE.NORMAL) {
    this.prepare(input, globalMode);
    if (globalMode === GLOBAL_MODE.HARD_SURVIVAL)
      return this.commit(STRATEGY.PRESERVE_LEAD);
    if (globalMode === GLOBAL_MODE.FORCED_LOSS_RECOVERY)
      return this.commit(STRATEGY.COMEBACK);
    if (globalMode === GLOBAL_MODE.FORCED_WIN) {
      this.dwellRoots += 1; return this.current;
    }
    let candidate = -1;
    for (let row = 0; row < STRATEGY.COUNT; row += 1)
      if (this.better(row, candidate)) candidate = row;
    if (candidate !== this.current &&
        (this.dwellRoots >= STRATEGY_CONFIG.MINIMUM_DWELL_ROOTS[this.current] ||
         this.interruptsDwell(candidate, input)) &&
        this.materiallyBetter(candidate)) return this.commit(candidate);
    this.dwellRoots += 1; return this.current;
  }
  applyModifier(mask) {
    this.modifierMask |= mask & ((STRATEGY_MODIFIER.PLAN_CONTINUITY << 1) - 1);
  }
}

module.exports = { NO_OBJECTIVE_DEADLINE, StrategyInputFrame, StrategyDecisionSlab,
  StrategySelector };
