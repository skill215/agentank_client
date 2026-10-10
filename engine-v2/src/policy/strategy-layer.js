"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { STRATEGY_CONFIG } = require("../generated/policy-config");
const { ACTION } = require("../abi/fast-codes");
const { STRATEGY, STRATEGY_BAND, STRATEGY_PURPOSE, COMBAT_PURPOSE,
  PLAN_PURPOSE, NONE_HANDLE, GLOBAL_MODE } =
  require("../abi/policy-codes");

const REVERSAL_NONE = 0;
const REVERSAL_KILL = 1;
const REVERSAL_STAR = 2;
const REVERSAL_BOTH = 3;
const COMEBACK_KILL_PURPOSE = STRATEGY_PURPOSE.DIRECT_KILL |
  STRATEGY_PURPOSE.ADVANTAGEOUS_FIRE | STRATEGY_PURPOSE.INTERCEPT |
  STRATEGY_PURPOSE.SHIELD_BREAK;
const COMEBACK_STAR_PURPOSE = STRATEGY_PURPOSE.STAR_COLLECT |
  STRATEGY_PURPOSE.STAR_DENY;
const NO_STRATEGY = 0xff;
const STRATEGIC_PROFILE = Object.freeze({ COMBAT_FIRST: 0,
  DEADLINE_BALANCED: 1, TERMINAL_AWARE: 2 });

class StrategicArbiter {
  constructor() { this.selectCount = 0; this.strategicCount = 0;
    this.tacticalCount = 0; this.escapeCount = 0; this.hotAllocationCount = 0; }

  eligible(outcome, mask, envelope, row) {
    return outcome.acceptable[row] && !outcome.dominated[row] &&
      (!mask || mask[row]) && (!envelope || !envelope.refuted(row));
  }

  purposeRank(purpose, profile, globalMode) {
    if (profile === STRATEGIC_PROFILE.TERMINAL_AWARE &&
        globalMode === GLOBAL_MODE.HARD_SURVIVAL && purpose === PLAN_PURPOSE.PRESERVE) return -1;
    if (profile === STRATEGIC_PROFILE.TERMINAL_AWARE &&
        globalMode === GLOBAL_MODE.FORCED_LOSS_RECOVERY &&
        (purpose === PLAN_PURPOSE.COMEBACK || purpose === PLAN_PURPOSE.STAR_COLLECT)) return -1;
    if (purpose === PLAN_PURPOSE.DIRECT_KILL) return 0;
    if (purpose === PLAN_PURPOSE.INTERCEPT || purpose === PLAN_PURPOSE.ESCAPE_FORCING ||
        purpose === PLAN_PURPOSE.SHIELD_BREAK) return 1;
    if (purpose === PLAN_PURPOSE.ZONE_DENIAL || purpose === PLAN_PURPOSE.CADENCE_DENY) return 2;
    if (purpose === PLAN_PURPOSE.STAR_COLLECT || purpose === PLAN_PURPOSE.STAR_DENIAL)
      return profile === STRATEGIC_PROFILE.COMBAT_FIRST ? 3 : 2;
    if (purpose === PLAN_PURPOSE.REPOSITION) return 4;
    if (purpose === PLAN_PURPOSE.PRESERVE || purpose === PLAN_PURPOSE.COMEBACK) return 5;
    return 6;
  }

  planBetter(left, right, handles, sketches, profile, globalMode, outcome) {
    if (right < 0) return 1;
    const lh = handles[left]; const rh = handles[right];
    const lp = lh === NONE_HANDLE ? 0 : sketches.purpose[lh];
    const rp = rh === NONE_HANDLE ? 0 : sketches.purpose[rh];
    const lr = this.purposeRank(lp, profile, globalMode);
    const rr = this.purposeRank(rp, profile, globalMode);
    if (profile === STRATEGIC_PROFILE.DEADLINE_BALANCED && lh !== NONE_HANDLE &&
        rh !== NONE_HANDLE && sketches.deadline[lh] !== sketches.deadline[rh])
      return sketches.deadline[lh] < sketches.deadline[rh];
    if (lr !== rr) return lr < rr;
    const lProgress = lh === NONE_HANDLE ? 0 : sketches.rawScore[lh];
    const rProgress = rh === NONE_HANDLE ? 0 : sketches.rawScore[rh];
    if (lProgress !== rProgress) return lProgress > rProgress;
    if (lh !== NONE_HANDLE && rh !== NONE_HANDLE && sketches.deadline[lh] !== sketches.deadline[rh])
      return sketches.deadline[lh] < sketches.deadline[rh];
    if (outcome.purposeCompleteness[left] !== outcome.purposeCompleteness[right])
      return outcome.purposeCompleteness[left] > outcome.purposeCompleteness[right];
    if (outcome.searchEstimateEnabled &&
        outcome.searchEstimate[left] !== outcome.searchEstimate[right])
      return outcome.searchEstimate[left] > outcome.searchEstimate[right];
    if (outcome.expectedValue[left] !== outcome.expectedValue[right])
      return outcome.expectedValue[left] > outcome.expectedValue[right];
    if (outcome.tacticalValue[left] !== outcome.tacticalValue[right])
      return outcome.tacticalValue[left] > outcome.tacticalValue[right];
    return left < right;
  }

  tacticalDominates(left, right, probability, handles, sketches, outcome) {
    const lh = handles[left]; const rh = handles[right];
    const lp = lh === NONE_HANDLE ? 0 : sketches.rawScore[lh];
    const rp = rh === NONE_HANDLE ? 0 : sketches.rawScore[rh];
    const noWorse = outcome.robustLower[left] >= outcome.robustLower[right] &&
      outcome.expectedValue[left] >= outcome.expectedValue[right] &&
      outcome.tacticalValue[left] >= outcome.tacticalValue[right] &&
      outcome.purposeCompleteness[left] >= outcome.purposeCompleteness[right] &&
      probability[left] >= probability[right] && lp >= rp;
    if (!noWorse) return 0;
    return outcome.robustLower[left] > outcome.robustLower[right] ||
      outcome.expectedValue[left] > outcome.expectedValue[right] ||
      outcome.tacticalValue[left] > outcome.tacticalValue[right] ||
      outcome.purposeCompleteness[left] > outcome.purposeCompleteness[right] ||
      probability[left] > probability[right] || lp > rp;
  }

  tacticalBetter(left, right, probability, handles, sketches, profile, globalMode, outcome) {
    if (right < 0) return 1;
    const lh = handles[left]; const rh = handles[right];
    const lp = lh === NONE_HANDLE ? 0 : sketches.purpose[lh];
    const rp = rh === NONE_HANDLE ? 0 : sketches.purpose[rh];
    const lr = this.purposeRank(lp, profile, globalMode);
    const rr = this.purposeRank(rp, profile, globalMode);
    if (lr !== rr) return lr < rr;
    if (probability[left] !== probability[right]) return probability[left] > probability[right];
    if (outcome.purposeCompleteness[left] !== outcome.purposeCompleteness[right])
      return outcome.purposeCompleteness[left] > outcome.purposeCompleteness[right];
    if (outcome.robustLower[left] !== outcome.robustLower[right])
      return outcome.robustLower[left] > outcome.robustLower[right];
    return this.planBetter(left, right, handles, sketches, profile, globalMode, outcome);
  }

  selectStrategic(controller, bands, envelope, handles, sketches, profile, globalMode) {
    const o = controller.outcome;
    let best = -1;
    for (let row = 0; row < o.count; row += 1)
      if (this.eligible(o, null, envelope, row) &&
          this.planBetter(row, best, handles, sketches, profile, globalMode, o)) best = row;
    if (best < 0) {
      const anchor = bands.baseAnchorRow;
      if (anchor >= 0 && this.eligible(o, null, envelope, anchor)) return anchor;
    }
    return best;
  }

  terminalRank(bands, row, globalMode) {
    if (!bands) return 0;
    const purpose = bands.purpose[row];
    if (globalMode === GLOBAL_MODE.HARD_SURVIVAL)
      return purpose & STRATEGY_PURPOSE.PRESERVE_NONLOSS ? 0 : 1;
    if (globalMode === GLOBAL_MODE.FORCED_LOSS_RECOVERY)
      return purpose & STRATEGY_PURPOSE.TERMINAL_REVERSAL ? 0 : 1;
    return 0;
  }

  neutralDominates(left, right, probability, outcome, bands, globalMode) {
    const leftTerminal = this.terminalRank(bands, left, globalMode);
    const rightTerminal = this.terminalRank(bands, right, globalMode);
    if (leftTerminal > rightTerminal) return 0;
    const noWorse = outcome.expectedValue[left] >= outcome.expectedValue[right] &&
      outcome.robustLower[left] >= outcome.robustLower[right] &&
      outcome.tacticalValue[left] >= outcome.tacticalValue[right] &&
      bands.planContinuity[left] >= bands.planContinuity[right];
    if (!noWorse) return 0;
    return leftTerminal < rightTerminal ||
      outcome.robustLower[left] > outcome.robustLower[right] ||
      outcome.expectedValue[left] > outcome.expectedValue[right] ||
      outcome.tacticalValue[left] > outcome.tacticalValue[right] ||
      bands.planContinuity[left] > bands.planContinuity[right];
  }

  neutralBetter(left, right, probability, outcome, bands, globalMode) {
    if (right < 0) return 1;
    const leftTerminal = this.terminalRank(bands, left, globalMode);
    const rightTerminal = this.terminalRank(bands, right, globalMode);
    if (leftTerminal !== rightTerminal) return leftTerminal < rightTerminal;
    if (outcome.expectedValue[left] !== outcome.expectedValue[right])
      return outcome.expectedValue[left] > outcome.expectedValue[right];
    if (outcome.robustLower[left] !== outcome.robustLower[right])
      return outcome.robustLower[left] > outcome.robustLower[right];
    if (outcome.tacticalValue[left] !== outcome.tacticalValue[right])
      return outcome.tacticalValue[left] > outcome.tacticalValue[right];
    if (bands.planContinuity[left] !== bands.planContinuity[right])
      return bands.planContinuity[left] > bands.planContinuity[right];
    if (outcome.searchEstimateEnabled &&
        outcome.searchEstimate[left] !== outcome.searchEstimate[right])
      return outcome.searchEstimate[left] > outcome.searchEstimate[right];
    // Matrix probability is a late tactical hint. It cannot by itself make a
    // weaker action own the root or turn a mixed policy into direct sampling.
    if (probability[left] !== probability[right]) return probability[left] > probability[right];
    return left < right;
  }

  selectNeutral(controller, bands, envelope, probability, mask, globalMode) {
    const o = controller.outcome; let best = -1;
    for (let row = 0; row < o.count; row += 1) {
      if (!this.eligible(o, mask, envelope, row)) continue;
      let dominated = 0;
      for (let other = 0; other < o.count; other += 1) {
        if (other === row || !this.eligible(o, mask, envelope, other)) continue;
        if (this.neutralDominates(other, row, probability, o, bands, globalMode)) {
          dominated = 1; break;
        }
      }
      if (!dominated && this.neutralBetter(row, best, probability, o, bands, globalMode)) best = row;
    }
    return best;
  }

  selectEscape(controller, mask, envelope) {
    const o = controller.outcome; let best = -1;
    for (let row = 0; row < o.count; row += 1) {
      if (!this.eligible(o, mask, envelope, row)) continue;
      if (best < 0) { best = row; continue; }
      if (o.escapeSuccessorProof[row] !== o.escapeSuccessorProof[best]) {
        if (o.escapeSuccessorProof[row] > o.escapeSuccessorProof[best]) best = row;
        continue;
      }
      if (o.escapeSuccessorExposed[row] !== o.escapeSuccessorExposed[best]) {
        if (o.escapeSuccessorExposed[row] < o.escapeSuccessorExposed[best]) best = row;
        continue;
      }
      if (o.escapeSuccessorSlack[row] !== o.escapeSuccessorSlack[best]) {
        if (o.escapeSuccessorSlack[row] > o.escapeSuccessorSlack[best]) best = row;
        continue;
      }
      if (o.escapeSuccessorBranches[row] !== o.escapeSuccessorBranches[best]) {
        if (o.escapeSuccessorBranches[row] > o.escapeSuccessorBranches[best]) best = row;
        continue;
      }
      if (controller.lexicographicRiskLess(row, best)) best = row;
    }
    return best;
  }

  selectTactical(controller, envelope, probability, handles, sketches, profile, globalMode) {
    const o = controller.outcome; let best = -1;
    for (let row = 0; row < o.count; row += 1) {
      if (!this.eligible(o, null, envelope, row)) continue;
      let dominated = 0;
      for (let other = 0; other < o.count; other += 1) {
        if (other === row || !this.eligible(o, null, envelope, other)) continue;
        if (this.tacticalDominates(other, row, probability, handles, sketches, o)) {
          dominated = 1; break;
        }
      }
      if (!dominated && this.tacticalBetter(row, best, probability, handles, sketches,
          profile, globalMode, o)) best = row;
    }
    return best;
  }

  select(mode, controller, bands, policyProbability, envelope, seed,
      handles, sketches, profile, globalMode, planArbitrationEnabled = 1) {
    this.selectCount += 1;
    // Numeric values avoid a runtime dependency from policy back to runtime.
    if (mode === 1) {
      this.escapeCount += 1;
      const selected = this.selectEscape(controller, null, envelope);
      return selected >= 0 ? selected : controller.select(seed, null, null);
    }
    if (mode === 3) {
      this.strategicCount += 1;
      const selected = planArbitrationEnabled ?
        this.selectStrategic(controller, bands, envelope, handles, sketches, profile, globalMode) :
        this.selectNeutral(controller, bands, envelope, policyProbability,
          bands.selected, globalMode);
      if (selected >= 0) return selected;
      const fallback = this.selectNeutral(controller, bands, envelope, policyProbability,
        null, globalMode);
      return fallback >= 0 ? fallback : controller.select(seed, null, null);
    }
    this.tacticalCount += 1;
    const selected = planArbitrationEnabled ?
      this.selectTactical(controller, envelope, policyProbability, handles, sketches,
        profile, globalMode) : this.selectNeutral(controller, bands, envelope,
        policyProbability, bands.selected, globalMode);
    if (selected >= 0) return selected;
    const fallback = this.selectNeutral(controller, bands, envelope, policyProbability,
      null, globalMode);
    return fallback >= 0 ? fallback : controller.select(seed, null, null);
  }
}

class StrategyBandSlab {
  constructor(maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS) {
    this.maxActions = maxActions; this.count = 0;
    this.purpose = new Uint16Array(maxActions);
    this.band = new Uint8Array(maxActions);
    this.selected = new Uint8Array(maxActions);
    this.proposalMask = new Uint8Array(maxActions);
    this.ownerStrategy = new Uint8Array(maxActions);
    this.ownerBand = new Uint8Array(maxActions);
    this.baseAnchor = new Uint8Array(maxActions);
    this.proposalCountByStrategy = new Uint8Array(STRATEGY.COUNT);
    this.starPurpose = new Uint16Array(maxActions);
    this.planContinuity = new Uint16Array(maxActions);
    this.terminalReversal = new Uint8Array(maxActions);
    this.selectedBand = STRATEGY_BAND.INELIGIBLE;
    this.effectiveStrategy = STRATEGY_CONFIG.DEFAULT_STRATEGY;
    this.killDeadline = 0; this.starDeadline = 0;
    this.killCompleteness = 0; this.reversalPreference = REVERSAL_NONE;
    this.selectedCount = 0; this.fallbackUsed = 0;
    this.baseAnchorRow = -1; this.portfolioBuildCount = 0;
    this.challengerStrategy = NO_STRATEGY; this.challengerProposalCount = 0;
    this.classifyCount = 0; this.restrictCount = 0; this.hotAllocationCount = 0;
    this.planContinuityPurposeEnabled = 1;
    this.terminalPurposeScoped = 0; this.globalMode = GLOBAL_MODE.NORMAL;
  }
  reset(count) {
    this.count = count; this.purpose.fill(0, 0, count);
    this.band.fill(STRATEGY_BAND.INELIGIBLE, 0, count);
    this.selected.fill(0, 0, count); this.proposalMask.fill(0, 0, count);
    this.ownerStrategy.fill(NO_STRATEGY, 0, count);
    this.ownerBand.fill(STRATEGY_BAND.INELIGIBLE, 0, count);
    this.baseAnchor.fill(0, 0, count); this.proposalCountByStrategy.fill(0);
    this.starPurpose.fill(0, 0, count);
    this.planContinuity.fill(0, 0, count); this.terminalReversal.fill(0, 0, count);
    this.selectedBand = STRATEGY_BAND.INELIGIBLE;
    this.effectiveStrategy = STRATEGY_CONFIG.DEFAULT_STRATEGY;
    this.killDeadline = 0; this.starDeadline = 0;
    this.killCompleteness = 0; this.reversalPreference = REVERSAL_NONE;
    this.selectedCount = 0; this.fallbackUsed = 0; this.baseAnchorRow = -1;
    this.challengerStrategy = NO_STRATEGY; this.challengerProposalCount = 0;
  }
  configureRoot(killDeadline, starDeadline, killCompleteness,
      globalMode = GLOBAL_MODE.NORMAL) {
    this.killDeadline = killDeadline > 0 ? killDeadline : 0;
    this.starDeadline = starDeadline > 0 ? starDeadline : 0;
    this.killCompleteness = killCompleteness > 0 ? killCompleteness : 0;
    this.globalMode = globalMode;
    const killReady = this.killDeadline > 0 && this.killCompleteness >= 4500;
    const starReady = this.starDeadline > 0;
    this.reversalPreference = !killReady ? (starReady ? REVERSAL_STAR : REVERSAL_NONE) :
      !starReady ? REVERSAL_KILL :
      this.killDeadline < this.starDeadline ? REVERSAL_KILL :
      this.starDeadline < this.killDeadline ? REVERSAL_STAR : REVERSAL_BOTH;
    return this.reversalPreference;
  }
  importCombat(actions, count, combat) {
    for (let row = 0; row < count; row += 1) {
      let purpose = this.starPurpose[row]; const action = actions[row];
      if (combat) {
        const flags = combat.purposeFlags[row];
        if (flags & COMBAT_PURPOSE.DIRECT_KILL) purpose |= STRATEGY_PURPOSE.DIRECT_KILL;
        if (flags & COMBAT_PURPOSE.AIM_SETUP) purpose |= STRATEGY_PURPOSE.AIM_SETUP;
        if (flags & COMBAT_PURPOSE.INTERCEPT) purpose |= STRATEGY_PURPOSE.INTERCEPT;
        if (flags & COMBAT_PURPOSE.ESCAPE_DENIAL) purpose |= STRATEGY_PURPOSE.ESCAPE_DENIAL;
        if (flags & COMBAT_PURPOSE.SHIELD_BREAK) purpose |= STRATEGY_PURPOSE.SHIELD_BREAK;
        if (flags & COMBAT_PURPOSE.ZONE_DENIAL) purpose |= STRATEGY_PURPOSE.ZONE_DENIAL;
        if (flags & COMBAT_PURPOSE.BELIEF_SWEEP) purpose |= STRATEGY_PURPOSE.BELIEF_SWEEP;
        const committedShotPurpose = flags & (COMBAT_PURPOSE.DIRECT_KILL |
          COMBAT_PURPOSE.INTERCEPT | COMBAT_PURPOSE.SHIELD_BREAK);
        if (action === ACTION.FIRE && committedShotPurpose &&
            combat.purposeCompleteness[row] >= 4500 &&
            combat.postFireEscape[row] > 0 && combat.ownCounterExposure[row] < 10000)
          purpose |= STRATEGY_PURPOSE.ADVANTAGEOUS_FIRE;
      }
      // Continuity is always available as a late quality dimension.  The
      // diagnostic ownership POC can prevent it from also upgrading Strategy
      // membership, which would otherwise crowd out new resource windows.
      if (this.planContinuityPurposeEnabled && this.planContinuity[row] >= 6500)
        purpose |= STRATEGY_PURPOSE.PLAN_CONTINUATION;
      if (this.terminalReversal[row]) purpose |= STRATEGY_PURPOSE.TERMINAL_REVERSAL;
      if (action === ACTION.GO || action === ACTION.TURN_LEFT ||
          action === ACTION.TURN_RIGHT || action === ACTION.NONE) {
        purpose |= STRATEGY_PURPOSE.NEUTRAL_POSITION;
        if (!this.terminalPurposeScoped || this.globalMode !== GLOBAL_MODE.NORMAL)
          purpose |= STRATEGY_PURPOSE.PRESERVE_NONLOSS;
      }
      else if (action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST)
        purpose |= STRATEGY_PURPOSE.SKILL_SETUP;
      this.purpose[row] = purpose;
    }
  }
  bandForStrategy(strategy, purpose) {
    const primary = STRATEGY_CONFIG.PRIMARY_PURPOSE_MASK[strategy];
    const support = STRATEGY_CONFIG.SUPPORT_PURPOSE_MASK[strategy];
    const fallback = STRATEGY_CONFIG.FALLBACK_PURPOSE_MASK[strategy];
    const reversal = purpose & (COMEBACK_KILL_PURPOSE | COMEBACK_STAR_PURPOSE);
    if (strategy === STRATEGY.COMEBACK && reversal) {
      const kill = purpose & COMEBACK_KILL_PURPOSE;
      const star = purpose & COMEBACK_STAR_PURPOSE;
      return this.reversalPreference === REVERSAL_BOTH ? STRATEGY_BAND.PRIMARY :
        this.reversalPreference === REVERSAL_KILL && kill ? STRATEGY_BAND.PRIMARY :
        this.reversalPreference === REVERSAL_STAR && star ? STRATEGY_BAND.PRIMARY :
        STRATEGY_BAND.SUPPORT;
    }
    return purpose & primary ? STRATEGY_BAND.PRIMARY :
      purpose & support ? STRATEGY_BAND.SUPPORT :
      purpose & fallback ? STRATEGY_BAND.FALLBACK : STRATEGY_BAND.INELIGIBLE;
  }
  classifyStrategy(strategyId, count) {
    const strategy = strategyId >= 0 && strategyId < STRATEGY.COUNT ?
      strategyId : STRATEGY_CONFIG.DEFAULT_STRATEGY;
    for (let row = 0; row < count; row += 1) {
      this.band[row] = this.bandForStrategy(strategy, this.purpose[row]);
    }
    this.effectiveStrategy = strategy; this.classifyCount += 1; return strategy;
  }
  classify(strategyId, actions, count, combat) {
    this.importCombat(actions, count, combat);
    return this.classifyStrategy(strategyId, count);
  }
  eligibleAt(outcome, row, safeFloor) {
    return outcome.acceptable[row] && !outcome.dominated[row];
  }
  baseBetter(outcome, left, right) {
    if (right < 0) return 1;
    if (outcome.expectedValue[left] !== outcome.expectedValue[right])
      return outcome.expectedValue[left] > outcome.expectedValue[right];
    if (outcome.tacticalValue[left] !== outcome.tacticalValue[right])
      return outcome.tacticalValue[left] > outcome.tacticalValue[right];
    if (outcome.searchEstimateEnabled &&
        outcome.searchEstimate[left] !== outcome.searchEstimate[right])
      return outcome.searchEstimate[left] > outcome.searchEstimate[right];
    return left < right;
  }
  proposalBetter(outcome, left, right, strategy) {
    if (right < 0) return 1;
    const leftBand = this.bandForStrategy(strategy, this.purpose[left]);
    const rightBand = this.bandForStrategy(strategy, this.purpose[right]);
    if (leftBand !== rightBand) return leftBand < rightBand;
    if (this.planContinuity[left] !== this.planContinuity[right])
      return this.planContinuity[left] > this.planContinuity[right];
    if (outcome.purposeCompleteness[left] !== outcome.purposeCompleteness[right])
      return outcome.purposeCompleteness[left] > outcome.purposeCompleteness[right];
    // Approximate Minimax is a late ranking signal only after Risk membership,
    // Strategy band, Plan continuity and purpose completeness agree.  It may
    // choose among qualified proposals, but cannot create a proposal or cross
    // an ownership band.
    if (outcome.searchEstimateEnabled &&
        outcome.searchEstimate[left] !== outcome.searchEstimate[right])
      return outcome.searchEstimate[left] > outcome.searchEstimate[right];
    if (outcome.expectedValue[left] !== outcome.expectedValue[right])
      return outcome.expectedValue[left] > outcome.expectedValue[right];
    if (outcome.tacticalValue[left] !== outcome.tacticalValue[right])
      return outcome.tacticalValue[left] > outcome.tacticalValue[right];
    return left < right;
  }
  addProposal(row, strategy, band) {
    if (row < 0) return 0;
    if (!this.selected[row]) { this.selected[row] = 1; this.selectedCount += 1; }
    this.proposalMask[row] |= 1 << strategy;
    this.proposalCountByStrategy[strategy] += 1;
    if (this.ownerStrategy[row] === NO_STRATEGY ||
        band < this.ownerBand[row] ||
        (band === this.ownerBand[row] && strategy < this.ownerStrategy[row])) {
      this.ownerStrategy[row] = strategy; this.ownerBand[row] = band;
    }
    return 1;
  }
  resolveOwners(decisions, currentStrategy, count) {
    for (let row = 0; row < count; row += 1) {
      const mask = this.proposalMask[row]; if (!mask) continue;
      let owner = NO_STRATEGY; let ownerBand = STRATEGY_BAND.INELIGIBLE;
      for (let strategy = 0; strategy < STRATEGY.COUNT; strategy += 1) {
        if (!(mask & (1 << strategy))) continue;
        const band = this.bandForStrategy(strategy, this.purpose[row]);
        if (owner === NO_STRATEGY || band < ownerBand ||
            (band === ownerBand && strategy === currentStrategy) ||
            (band === ownerBand && owner !== currentStrategy &&
             decisions.verifiedOpportunity[strategy] > decisions.verifiedOpportunity[owner])) {
          owner = strategy; ownerBand = band;
        }
      }
      this.ownerStrategy[row] = owner; this.ownerBand[row] = ownerBand;
    }
  }
  proposeStrategy(strategy, outcome, count, maximum, allowFallback = 1) {
    let first = -1; let second = -1;
    for (let row = 0; row < count; row += 1) {
      if (!this.eligibleAt(outcome, row, 0)) continue;
      const band = this.bandForStrategy(strategy, this.purpose[row]);
      if (band === STRATEGY_BAND.INELIGIBLE || band === STRATEGY_BAND.FALLBACK) continue;
      if (this.proposalBetter(outcome, row, first, strategy)) {
        second = first; first = row;
      } else if (maximum > 1 && row !== first &&
          this.proposalBetter(outcome, row, second, strategy)) second = row;
    }
    if (first < 0 && allowFallback) {
      for (let row = 0; row < count; row += 1)
        if (this.eligibleAt(outcome, row, 0) &&
            this.bandForStrategy(strategy, this.purpose[row]) === STRATEGY_BAND.FALLBACK &&
            this.proposalBetter(outcome, row, first, strategy)) first = row;
    }
    let added = 0;
    if (first >= 0) added += this.addProposal(first, strategy,
      this.bandForStrategy(strategy, this.purpose[first]));
    if (maximum > 1 && second >= 0) added += this.addProposal(second, strategy,
      this.bandForStrategy(strategy, this.purpose[second]));
    return added;
  }

  // RST3d portfolio is deliberately narrow: one genuine neutral anchor plus
  // the current strategy's bounded representatives. One challenger may enter
  // only after StrategySelector's read-only dwell/margin decision approves it.
  // This is action-set ownership, never a rewrite of Risk or matrix values.
  buildPortfolio(controller, decisions, currentStrategy, actions, count, combat = null,
      approvedChallenger = -1) {
    const outcome = controller.outcome; this.selected.fill(0, 0, count);
    this.proposalMask.fill(0, 0, count); this.ownerStrategy.fill(NO_STRATEGY, 0, count);
    this.ownerBand.fill(STRATEGY_BAND.INELIGIBLE, 0, count);
    this.baseAnchor.fill(0, 0, count); this.proposalCountByStrategy.fill(0);
    this.selectedCount = 0; this.fallbackUsed = 0; this.baseAnchorRow = -1;
    this.challengerStrategy = NO_STRATEGY; this.challengerProposalCount = 0;
    this.importCombat(actions, count, combat);
    for (let row = 0; row < count; row += 1)
      if (this.eligibleAt(outcome, row, controller.safeFloor) &&
          (this.purpose[row] & (STRATEGY_PURPOSE.NEUTRAL_POSITION |
            STRATEGY_PURPOSE.PRESERVE_NONLOSS)) &&
          this.baseBetter(outcome, row, this.baseAnchorRow)) this.baseAnchorRow = row;
    if (this.baseAnchorRow >= 0) {
      this.selected[this.baseAnchorRow] = 1; this.baseAnchor[this.baseAnchorRow] = 1;
      this.selectedCount = 1;
    }
    const currentValid = currentStrategy >= 0 && currentStrategy < STRATEGY.COUNT;
    // The current strategy persists until the selector explicitly commits a
    // switch. Its primary/support rows remain legal even if the opportunity
    // that originally selected it is not rediscovered on this exact frame.
    // Generic fallback rows do not block a verified challenger.
    let proposed = currentValid ?
      this.proposeStrategy(currentStrategy, outcome, count,
        STRATEGY_CONFIG.MAX_PROPOSALS_PER_STRATEGY, 0) : 0;
    if (approvedChallenger >= 0 && approvedChallenger < STRATEGY.COUNT &&
        approvedChallenger !== currentStrategy && decisions.eligible[approvedChallenger]) {
      const challengerProposed = this.proposeStrategy(approvedChallenger,
        outcome, count, 1, 0);
      if (challengerProposed > 0) {
        this.challengerStrategy = approvedChallenger;
        this.challengerProposalCount = challengerProposed;
        proposed += challengerProposed;
      }
    }
    this.resolveOwners(decisions, currentStrategy, count);
    if (proposed > 0) {
      // selectedBand describes the strongest proposal in the complete
      // portfolio, not merely the neutral anchor when that anchor also owns a
      // weaker proposal.  Otherwise a SUPPORT anchor hides a PRIMARY attack
      // that remains selected and may own the final action.
      this.selectedBand = STRATEGY_BAND.FALLBACK;
      for (let row = 0; row < count; row += 1)
        if (this.proposalMask[row] && (this.selectedBand === STRATEGY_BAND.FALLBACK ||
            this.ownerBand[row] < this.selectedBand)) this.selectedBand = this.ownerBand[row];
    } else if (this.baseAnchorRow >= 0) {
      this.selectedBand = STRATEGY_BAND.FALLBACK; this.fallbackUsed = 1;
    }
    this.portfolioBuildCount += 1; return this.selectedCount;
  }
  ownerForRow(row, fallbackStrategy) {
    if (row >= 0 && row < this.count && this.ownerStrategy[row] !== NO_STRATEGY)
      return this.ownerStrategy[row];
    return fallbackStrategy;
  }
  chooseBand(outcome, count, safeFloor) {
    for (let wanted = STRATEGY_BAND.PRIMARY; wanted <= STRATEGY_BAND.FALLBACK;
        wanted += 1) {
      let found = 0;
      for (let row = 0; row < count; row += 1)
        if (this.band[row] === wanted && this.eligibleAt(outcome, row, safeFloor)) {
          this.selected[row] = 1; found += 1;
        }
      if (found > 0) {
        this.selectedBand = wanted; this.selectedCount = found; return found;
      }
    }
    return 0;
  }
  restrict(controller, strategyId, count = this.count) {
    const outcome = controller.outcome; const safeFloor = controller.safeFloor;
    this.selected.fill(0, 0, count); this.selectedBand = STRATEGY_BAND.INELIGIBLE;
    this.selectedCount = 0; this.fallbackUsed = 0;
    if (controller.acceptableCount === 0) { this.restrictCount += 1; return 0; }
    this.classifyStrategy(strategyId, count);
    if (this.chooseBand(outcome, count, safeFloor) > 0) {
      this.restrictCount += 1; return this.selectedCount;
    }
    const fallback = STRATEGY_CONFIG.FALLBACK_STRATEGY[this.effectiveStrategy];
    this.classifyStrategy(fallback, count); this.fallbackUsed = 1;
    if (this.chooseBand(outcome, count, safeFloor) > 0) {
      this.restrictCount += 1; return this.selectedCount;
    }
    // A descriptor gap must not lower the robust floor.  Keep every row that
    // already passed Hard, Risk, EO, Pareto and the global safe floor.
    for (let row = 0; row < count; row += 1)
      if (this.eligibleAt(outcome, row, safeFloor)) {
        this.selected[row] = 1; this.selectedCount += 1;
      }
    this.restrictCount += 1; return this.selectedCount;
  }
}

module.exports = { REVERSAL_NONE, REVERSAL_KILL, REVERSAL_STAR, REVERSAL_BOTH,
  COMEBACK_KILL_PURPOSE, COMEBACK_STAR_PURPOSE, NO_STRATEGY,
  STRATEGIC_PROFILE, StrategicArbiter, StrategyBandSlab };
