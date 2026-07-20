"use strict";

const { POLICY_CAPACITY, STRATEGY_CONFIG } = require("../generated/policy-config");
const { STRATEGY, STRATEGY_PHASE, STRATEGY_INPUT, GLOBAL_MODE, EVAL_PROFILE,
  STRATEGY_MODIFIER } = require("../abi/policy-codes");

class StrategyInputFrame {
  constructor() { this.values = new Int16Array(STRATEGY_INPUT.COUNT); this.modifierMask = 0;
    this.hotAllocationCount = 0; }
  set(index, value) { if (index < 0 || index >= STRATEGY_INPUT.COUNT ||
      !Number.isSafeInteger(value)) return 0; this.values[index] = value < -10000 ? -10000 :
    value > 10000 ? 10000 : value; return 1; }
}

class StrategySelector {
  constructor() {
    this.scores = new Int32Array(POLICY_CAPACITY.STRATEGY_COUNT);
    this.current = STRATEGY.STAR_CONTROL; this.phase = STRATEGY_PHASE.OPEN;
    this.dwellRoots = 0; this.generation = 1; this.lastMode = GLOBAL_MODE.NORMAL;
    this.evalProfileId = EVAL_PROFILE.STAR_CONTROL; this.riskProfileId = STRATEGY.STAR_CONTROL;
    this.baseRisk = STRATEGY_CONFIG.BASE_RISK[STRATEGY.STAR_CONTROL]; this.modifierMask = 0;
    this.switchCount = 0; this.hotAllocationCount = 0;
  }
  reset() { this.current = STRATEGY.STAR_CONTROL; this.phase = STRATEGY_PHASE.OPEN;
    this.dwellRoots = 0; this.generation += 1; this.switchCount = 0; this.lastMode = GLOBAL_MODE.NORMAL; }
  classifyPhase(input) {
    const urgency = input.values[STRATEGY_INPUT.TERMINAL_URGENCY];
    if (urgency >= STRATEGY_CONFIG.PHASE_LOCKED_URGENCY) return STRATEGY_PHASE.LOCKED;
    if (urgency >= STRATEGY_CONFIG.PHASE_DECISIVE_URGENCY) return STRATEGY_PHASE.DECISIVE;
    if (urgency >= 3000 || input.values[STRATEGY_INPUT.DIRECT_HIT_WINDOW] >= 5000)
      return STRATEGY_PHASE.SHAPING;
    return STRATEGY_PHASE.OPEN;
  }
  computeScores(input) {
    const v = input.values; const s = this.scores; const phase = this.phase;
    s[STRATEGY.STAR_CONTROL] = v[STRATEGY_INPUT.STAR_RACE] * 2 - v[STRATEGY_INPUT.STAR_DELTA] +
      v[STRATEGY_INPUT.RESOURCE_READY] + (phase === STRATEGY_PHASE.OPEN ? 2000 : 0);
    s[STRATEGY.KILL_PRESSURE] = v[STRATEGY_INPUT.DIRECT_HIT_WINDOW] * 2 +
      v[STRATEGY_INPUT.OPPONENT_ATTACK] + (phase === STRATEGY_PHASE.DECISIVE ? 2500 : 0);
    s[STRATEGY.POSITION_CONTROL] = v[STRATEGY_INPUT.POSITION_CONTROL] * 2 +
      v[STRATEGY_INPUT.SAFE_SUCCESSORS] + v[STRATEGY_INPUT.OPPONENT_CONTEST];
    s[STRATEGY.PRESERVE_LEAD] = v[STRATEGY_INPUT.LEAD_SECURITY] * 2 +
      v[STRATEGY_INPUT.SAFE_SUCCESSORS] - v[STRATEGY_INPUT.OPPONENT_ATTACK] +
      (phase === STRATEGY_PHASE.LOCKED ? 3000 : 0);
    s[STRATEGY.COMEBACK] = v[STRATEGY_INPUT.COMEBACK_PRESSURE] * 2 +
      v[STRATEGY_INPUT.DIRECT_HIT_WINDOW] + v[STRATEGY_INPUT.OPPONENT_CONTEST];
  }
  select(input, globalMode = GLOBAL_MODE.NORMAL) {
    this.phase = this.classifyPhase(input); this.computeScores(input); this.modifierMask = input.modifierMask;
    this.lastMode = globalMode;
    let candidate = this.current;
    if (globalMode === GLOBAL_MODE.HARD_SURVIVAL) candidate = STRATEGY.PRESERVE_LEAD;
    else if (globalMode === GLOBAL_MODE.FORCED_LOSS_RECOVERY) candidate = STRATEGY.COMEBACK;
    else if (globalMode === GLOBAL_MODE.FORCED_WIN) candidate = this.current;
    else for (let index = 0; index < STRATEGY.COUNT; index += 1)
      if (this.scores[index] > this.scores[candidate]) candidate = index;
    const forced = globalMode !== GLOBAL_MODE.NORMAL && globalMode !== GLOBAL_MODE.FORCED_WIN;
    if (candidate !== this.current && (forced || (this.dwellRoots >= STRATEGY_CONFIG.MIN_DWELL_ROOTS &&
        this.scores[candidate] >= this.scores[this.current] + STRATEGY_CONFIG.SWITCH_MARGIN))) {
      this.current = candidate; this.dwellRoots = 0; this.generation += 1; this.switchCount += 1;
    } else this.dwellRoots += 1;
    this.evalProfileId = this.current; this.riskProfileId = this.current;
    this.baseRisk = STRATEGY_CONFIG.BASE_RISK[this.current];
    return this.current;
  }
  applyModifier(mask) { this.modifierMask |= mask & ((STRATEGY_MODIFIER.PLAN_CONTINUITY << 1) - 1); }
}

module.exports = { StrategyInputFrame, StrategySelector };
