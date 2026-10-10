"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ACTION } = require("../abi/fast-codes");
const { STRATEGY_BAND, STRATEGY_PURPOSE, COMBAT_PURPOSE, GLOBAL_MODE,
  NONE_HANDLE } = require("../abi/policy-codes");
const { SAFETY_STATUS } = require("../search/information-safety-closure");

const PVA_VERIFY = Object.freeze({ REFUTED: 0, UNKNOWN: 1, VIABLE: 2, CERTIFIED: 3 });
const PVA_GOAL = Object.freeze({ NONE: 0, ATTACK: 1, STAR: 2, TERMINAL: 3, POSITION: 4 });
const ATTACK_PURPOSE = STRATEGY_PURPOSE.DIRECT_KILL |
  STRATEGY_PURPOSE.ADVANTAGEOUS_FIRE | STRATEGY_PURPOSE.AIM_SETUP |
  STRATEGY_PURPOSE.INTERCEPT | STRATEGY_PURPOSE.ESCAPE_DENIAL |
  STRATEGY_PURPOSE.SHIELD_BREAK | STRATEGY_PURPOSE.ZONE_DENIAL |
  STRATEGY_PURPOSE.BELIEF_SWEEP | STRATEGY_PURPOSE.ATTACK_APPROACH;
const STAR_PURPOSE = STRATEGY_PURPOSE.STAR_COLLECT | STRATEGY_PURPOSE.STAR_DENY;
const TERMINAL_PURPOSE = STRATEGY_PURPOSE.PRESERVE_NONLOSS |
  STRATEGY_PURPOSE.TERMINAL_REVERSAL;
const STRONG_ATTACK = COMBAT_PURPOSE.DIRECT_KILL | COMBAT_PURPOSE.INTERCEPT |
  COMBAT_PURPOSE.SHIELD_BREAK;
const EXPECTED_GUARD_WINDOW = 1200;
const ROBUST_GUARD_WINDOW = 800;
const EXPECTED_GOAL_WINDOW = 400;
const ROBUST_GOAL_WINDOW = 400;

class ProposalVerificationArbiter {
  constructor(maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS) {
    this.verification = new Uint8Array(maxActions);
    this.goal = new Uint8Array(maxActions);
    this.enabled = 0; this.goalArbitration = 0;
    this.count = 0; this.baseRow = -1; this.selectedRow = -1;
    this.buildCount = 0; this.verifyCount = 0; this.selectCount = 0;
    this.guardOverrideCount = 0; this.goalOverrideCount = 0;
    this.refutedCount = 0; this.unknownCount = 0;
    this.viableCount = 0; this.certifiedCount = 0;
    this.hotAllocationCount = 0;
  }

  configure(goalArbitration = 0) {
    this.enabled = 1; this.goalArbitration = goalArbitration ? 1 : 0; return this;
  }

  goalFor(purpose) {
    if (purpose & ATTACK_PURPOSE) return PVA_GOAL.ATTACK;
    if (purpose & STAR_PURPOSE) return PVA_GOAL.STAR;
    if (purpose & STRATEGY_PURPOSE.NEUTRAL_POSITION) return PVA_GOAL.POSITION;
    if (purpose & TERMINAL_PURPOSE) return PVA_GOAL.TERMINAL;
    return PVA_GOAL.POSITION;
  }

  buildPortfolio(controller, bands, actions, count, combat = null) {
    const outcome = controller.outcome;
    this.count = count; this.baseRow = -1; this.selectedRow = -1;
    this.verification.fill(PVA_VERIFY.REFUTED, 0, count);
    this.goal.fill(PVA_GOAL.NONE, 0, count);
    bands.selected.fill(0, 0, count); bands.proposalMask.fill(0, 0, count);
    bands.ownerStrategy.fill(0xff, 0, count);
    bands.ownerBand.fill(STRATEGY_BAND.INELIGIBLE, 0, count);
    bands.baseAnchor.fill(0, 0, count); bands.proposalCountByStrategy.fill(0);
    bands.selectedCount = 0; bands.fallbackUsed = 0; bands.baseAnchorRow = -1;
    bands.selectedBand = STRATEGY_BAND.INELIGIBLE;
    bands.challengerStrategy = 0xff; bands.challengerProposalCount = 0;
    bands.importCombat(actions, count, combat);
    for (let row = 0; row < count; row += 1) {
      if (!outcome.acceptable[row] || outcome.dominated[row]) continue;
      bands.selected[row] = 1; bands.selectedCount += 1;
      const goal = this.goalFor(bands.purpose[row]); this.goal[row] = goal;
      bands.proposalMask[row] = 1 << goal;
      if (bands.baseAnchorRow < 0 || bands.baseBetter(outcome, row, bands.baseAnchorRow))
        bands.baseAnchorRow = row;
    }
    if (bands.baseAnchorRow >= 0) bands.baseAnchor[bands.baseAnchorRow] = 1;
    bands.portfolioBuildCount += 1; this.buildCount += 1;
    return bands.selectedCount;
  }

  classifyRow(row, actions, outcome, envelope) {
    if (!outcome.acceptable[row] || outcome.dominated[row] ||
        (envelope && envelope.refuted(row))) return PVA_VERIFY.REFUTED;
    if (outcome.safety[row] === SAFETY_STATUS.PROVEN_SAFE &&
        outcome.coverage[row] === 10000 && outcome.immediateFatalMass[row] === 0 &&
        outcome.horizonFatalMass[row] === 0 && outcome.unknownMass[row] === 0)
      return PVA_VERIFY.CERTIFIED;
    if (outcome.committedFatalMass[row] !== 0 || outcome.immediateFatalMass[row] !== 0)
      return PVA_VERIFY.UNKNOWN;
    if (actions[row] === ACTION.FIRE) {
      return outcome.postFireEscape[row] && outcome.ownCounterExposure[row] < 10000 ?
        PVA_VERIFY.VIABLE : PVA_VERIFY.UNKNOWN;
    }
    if ((outcome.escapeSuccessorReady && outcome.escapeSuccessorProof[row] > 0 &&
        !outcome.escapeSuccessorExposed[row]) || outcome.escapeSlack[row] >= 0)
      return PVA_VERIFY.VIABLE;
    return PVA_VERIFY.UNKNOWN;
  }

  verify(actions, outcome, envelope) {
    for (let row = 0; row < this.count; row += 1) {
      const status = this.classifyRow(row, actions, outcome, envelope);
      this.verification[row] = status;
      if (status === PVA_VERIFY.REFUTED) this.refutedCount += 1;
      else if (status === PVA_VERIFY.UNKNOWN) this.unknownCount += 1;
      else if (status === PVA_VERIFY.VIABLE) this.viableCount += 1;
      else this.certifiedCount += 1;
    }
    this.verifyCount += 1;
  }

  eligible(outcome, envelope, row) {
    return outcome.acceptable[row] && !outcome.dominated[row] &&
      this.verification[row] !== PVA_VERIFY.REFUTED &&
      (!envelope || !envelope.refuted(row));
  }

  within(value, reference, window) { return value >= reference - window; }

  verifiedUpgrade(base, arbiter, controller, bands, envelope, probability, globalMode) {
    if (base < 0) return base;
    const outcome = controller.outcome; let best = base;
    for (let row = 0; row < this.count; row += 1) {
      if (!this.eligible(outcome, envelope, row) ||
          this.verification[row] <= this.verification[base] ||
          !this.within(outcome.expectedValue[row], outcome.expectedValue[base],
            EXPECTED_GUARD_WINDOW) ||
          !this.within(outcome.robustLower[row], outcome.robustLower[base],
            ROBUST_GUARD_WINDOW)) continue;
      if (best === base || this.verification[row] > this.verification[best] ||
          (this.verification[row] === this.verification[best] &&
           arbiter.neutralBetter(row, best, probability, outcome, bands, globalMode))) best = row;
    }
    if (best !== base) this.guardOverrideCount += 1;
    return best;
  }

  sketchProgress(row, handles, sketches) {
    const handle = handles[row]; return handle === NONE_HANDLE ? 0 : sketches.rawScore[handle];
  }

  sketchDeadline(row, handles, sketches) {
    const handle = handles[row]; return handle === NONE_HANDLE ? 0xffff : sketches.deadline[handle];
  }

  attackQualified(row, actions, outcome) {
    if (this.goal[row] !== PVA_GOAL.ATTACK || outcome.purposeCompleteness[row] < 4500) return 0;
    if (actions[row] !== ACTION.FIRE) return 1;
    return Boolean((outcome.combatPurpose[row] & STRONG_ATTACK) &&
      outcome.postFireEscape[row] && outcome.ownCounterExposure[row] < 10000);
  }

  goalBetter(mode, left, right, actions, outcome, bands, handles, sketches,
      probability, arbiter, globalMode) {
    if (right < 0) return 1;
    const leftTerminal = arbiter.terminalRank(bands, left, globalMode);
    const rightTerminal = arbiter.terminalRank(bands, right, globalMode);
    if (leftTerminal !== rightTerminal) return leftTerminal < rightTerminal;
    if (mode === 2) {
      const leftAttack = this.attackQualified(left, actions, outcome);
      const rightAttack = this.attackQualified(right, actions, outcome);
      if (leftAttack !== rightAttack) return leftAttack > rightAttack;
      if (leftAttack && outcome.purposeCompleteness[left] !== outcome.purposeCompleteness[right])
        return outcome.purposeCompleteness[left] > outcome.purposeCompleteness[right];
    }
    const leftProgress = this.sketchProgress(left, handles, sketches);
    const rightProgress = this.sketchProgress(right, handles, sketches);
    if (leftProgress !== rightProgress) return leftProgress > rightProgress;
    const leftDeadline = this.sketchDeadline(left, handles, sketches);
    const rightDeadline = this.sketchDeadline(right, handles, sketches);
    if (leftDeadline !== rightDeadline) return leftDeadline < rightDeadline;
    return arbiter.neutralBetter(left, right, probability, outcome, bands, globalMode);
  }

  goalOverride(mode, selected, arbiter, controller, bands, actions, envelope,
      probability, handles, sketches, globalMode) {
    if (!this.goalArbitration || selected < 0) return selected;
    const outcome = controller.outcome; let best = selected;
    for (let row = 0; row < this.count; row += 1) {
      if (row === selected || !this.eligible(outcome, envelope, row) ||
          this.verification[row] < this.verification[selected] ||
          !this.within(outcome.expectedValue[row], outcome.expectedValue[selected],
            EXPECTED_GOAL_WINDOW) ||
          !this.within(outcome.robustLower[row], outcome.robustLower[selected],
            ROBUST_GOAL_WINDOW)) continue;
      if (this.goalBetter(mode, row, best, actions, outcome, bands, handles, sketches,
          probability, arbiter, globalMode)) best = row;
    }
    if (best !== selected) this.goalOverrideCount += 1;
    return best;
  }

  select(mode, arbiter, controller, bands, probability, envelope, seed, actions,
      handles, sketches, globalMode) {
    this.selectCount += 1; this.verify(actions, controller.outcome, envelope);
    if (mode === 1) {
      const escape = arbiter.selectEscape(controller, null, envelope);
      this.baseRow = escape; this.selectedRow = escape;
      return escape >= 0 ? escape : controller.select(seed, null, null);
    }
    const base = arbiter.selectNeutral(controller, bands, envelope, probability,
      bands.selected, globalMode);
    this.baseRow = base;
    let selected = this.verifiedUpgrade(base, arbiter, controller, bands,
      envelope, probability, globalMode);
    selected = this.goalOverride(mode, selected, arbiter, controller, bands, actions,
      envelope, probability, handles, sketches, globalMode);
    if (selected < 0) selected = arbiter.selectNeutral(controller, bands, envelope,
      probability, null, globalMode);
    if (selected < 0) selected = controller.select(seed, null, null);
    this.selectedRow = selected; return selected;
  }

  summary() {
    return { enabled: this.enabled, goalArbitration: this.goalArbitration,
      buildCount: this.buildCount, verifyCount: this.verifyCount,
      selectCount: this.selectCount, guardOverrideCount: this.guardOverrideCount,
      goalOverrideCount: this.goalOverrideCount, refutedCount: this.refutedCount,
      unknownCount: this.unknownCount, viableCount: this.viableCount,
      certifiedCount: this.certifiedCount, hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { PVA_VERIFY, PVA_GOAL, EXPECTED_GUARD_WINDOW,
  ROBUST_GUARD_WINDOW, EXPECTED_GOAL_WINDOW, ROBUST_GOAL_WINDOW,
  ProposalVerificationArbiter };
