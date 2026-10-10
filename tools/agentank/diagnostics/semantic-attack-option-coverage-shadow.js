"use strict";

// Behavior-neutral census for the semantic ATTACK proposal funnel. It does not
// generate an Option, run search, or select an action. observe() is allocation
// free; all named objects are created only by summary().

const { ACTION, HARD_STATUS } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { COMBAT_PURPOSE } = require(
  "../../../engine-v2/src/abi/policy-codes");
const { OPTION_KIND } = require(
  "../../../engine-v2/src/policy/option-portfolio");
const { LONG_OPTION } = require("./event-driven-option-shadow");

const ACTION_BUCKETS = 16;
const GENERATOR_PURPOSE = COMBAT_PURPOSE.DIRECT_KILL |
  COMBAT_PURPOSE.AIM_SETUP | COMBAT_PURPOSE.INTERCEPT |
  COMBAT_PURPOSE.ESCAPE_DENIAL | COMBAT_PURPOSE.SHIELD_BREAK;
const ALL_ATTACK_PURPOSE = GENERATOR_PURPOSE | COMBAT_PURPOSE.ZONE_DENIAL |
  COMBAT_PURPOSE.BELIEF_SWEEP;
const FUNNEL = Object.freeze({ NO_COMBAT_EVIDENCE: 0, SOFT_ONLY_EVIDENCE: 1,
  INCOMPLETE_PURPOSE_OR_ESCAPE: 2, PORTFOLIO_SUPPORT_GAP: 3,
  HARD_FILTERED: 4, RISK_FILTERED: 5, DOMINATED: 6, STRICT: 7, COUNT: 8 });
const FUNNEL_NAME = Object.freeze([
  "NO_COMBAT_EVIDENCE", "SOFT_ONLY_EVIDENCE",
  "INCOMPLETE_PURPOSE_OR_ESCAPE", "PORTFOLIO_SUPPORT_GAP",
  "HARD_FILTERED", "RISK_FILTERED", "DOMINATED", "STRICT"
]);

function isAttackKind(kind) {
  return kind === OPTION_KIND.DIRECT_KILL || kind === OPTION_KIND.ATTACK_SETUP;
}

function isMovement(action) {
  return action === ACTION.GO || action === ACTION.TURN_LEFT ||
    action === ACTION.TURN_RIGHT;
}

function namedActions(values) {
  const output = {};
  for (const [name, action] of Object.entries(ACTION))
    if (action >= 0 && action < ACTION_BUCKETS) output[name] = values[action];
  return output;
}

function namedFunnel(values) {
  const output = {};
  for (let at = 0; at < FUNNEL.COUNT; at += 1)
    output[FUNNEL_NAME[at]] = values[at];
  return output;
}

class SemanticAttackOptionCoverageShadow {
  constructor(epoch) {
    this.epoch = epoch;
    this.rawByAction = new Uint32Array(ACTION_BUCKETS);
    this.completeByAction = new Uint32Array(ACTION_BUCKETS);
    this.strictByAction = new Uint32Array(ACTION_BUCKETS);
    this.funnel = new Uint32Array(FUNNEL.COUNT);
    this.decisionCount = 0; this.enemyVisibleCount = 0;
    this.enemyHiddenCount = 0; this.broadEvidenceRootCount = 0;
    this.generatorEvidenceRootCount = 0; this.purposeCompleteRootCount = 0;
    this.portfolioAttackRootCount = 0; this.portfolioCompleteRootCount = 0;
    this.hardAllowedRootCount = 0; this.riskAcceptableRootCount = 0;
    this.strictAttackRootCount = 0; this.strictAttackRowCount = 0;
    this.onlyFireStrictRootCount = 0; this.movementStrictRootCount = 0;
    this.resourceStrictRootCount = 0; this.strictStarConflictRootCount = 0;
    this.selectedStrictAttackCount = 0; this.selectedOutsideStrictAttackCount = 0;
    this.attackEpochFrameCount = 0; this.attackEpochStrictSupportCount = 0;
    this.attackEpochExecutionGapCount = 0;
    this.strictAttackWithoutAttackEpochCount = 0;
    this.hotAllocationCount = 0; this.lastFunnel = FUNNEL.NO_COMBAT_EVIDENCE;
    this.lastStrictMask = 0; this.lastSelectedRow = -1;
  }

  selectedRow(engine, emittedAction) {
    const count = engine.ourCount > 1 &&
      engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
        engine.ourCount - 1 : engine.ourCount;
    const selected = engine.diagnosticInternalSelectedIndex;
    if (Number.isSafeInteger(selected) && selected >= 0 && selected < count)
      return selected;
    for (let row = 0; row < count; row += 1)
      if (engine.ourActions[row] === emittedAction) return row;
    return -1;
  }

  observe(engine, emittedAction) {
    this.decisionCount += 1;
    if (engine.adapter.enemyVisible) this.enemyVisibleCount += 1;
    else this.enemyHiddenCount += 1;
    const combat = engine.combat && engine.combat.vector;
    const portfolio = engine.optionPortfolio;
    const risk = engine.riskController && engine.riskController.outcome;
    let broad = 0; let generator = 0; let purposeComplete = 0;
    let portfolioRaw = 0; let portfolioComplete = 0; let hardAllowed = 0;
    let riskAllowed = 0; let strictMask = 0; let strictRows = 0;
    let strictOnlyFire = 1; let strictMovement = 0; let strictResource = 0;
    let strictStar = 0;
    const count = engine.ourCount > 1 &&
      engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
        engine.ourCount - 1 : engine.ourCount;
    for (let row = 0; row < count; row += 1) {
      const action = engine.ourActions[row]; const flags = combat ?
        combat.purposeFlags[row] : 0;
      if (flags & ALL_ATTACK_PURPOSE) broad = 1;
      if (flags & GENERATOR_PURPOSE) {
        generator = 1;
        if (action >= 0 && action < ACTION_BUCKETS) this.rawByAction[action] += 1;
        if (combat.purposeCompleteness[row] >= 4500 &&
            (action !== ACTION.FIRE || combat.postFireEscape[row] > 0))
          purposeComplete = 1;
      }
      let rowRaw = 0; let rowComplete = 0; let rowStar = 0;
      if (portfolio) for (let at = 0; at < portfolio.count; at += 1) {
        if (portfolio.primitiveRow[at] !== row) continue;
        if (portfolio.kind[at] === OPTION_KIND.STAR_CONTROL &&
            portfolio.supportComplete[at]) rowStar = 1;
        if (!isAttackKind(portfolio.kind[at])) continue;
        rowRaw = 1;
        if (portfolio.supportComplete[at]) rowComplete = 1;
      }
      if (rowRaw) portfolioRaw = 1;
      if (!rowComplete) continue;
      portfolioComplete = 1;
      if (action >= 0 && action < ACTION_BUCKETS) this.completeByAction[action] += 1;
      if (engine.hardStatus[row] !== HARD_STATUS.ALLOW) continue;
      hardAllowed = 1;
      if (!risk || row >= risk.count || !risk.acceptable[row]) continue;
      riskAllowed = 1;
      if (risk.dominated[row]) continue;
      strictMask |= 1 << row; strictRows += 1;
      strictStar |= rowStar;
      if (action >= 0 && action < ACTION_BUCKETS) this.strictByAction[action] += 1;
      if (action !== ACTION.FIRE) strictOnlyFire = 0;
      if (isMovement(action)) strictMovement = 1;
      if (action === ACTION.THROW_BOMB || action >= ACTION.CAST_SHIELD)
        strictResource = 1;
    }
    if (broad) this.broadEvidenceRootCount += 1;
    if (generator) this.generatorEvidenceRootCount += 1;
    if (purposeComplete) this.purposeCompleteRootCount += 1;
    if (portfolioRaw) this.portfolioAttackRootCount += 1;
    if (portfolioComplete) this.portfolioCompleteRootCount += 1;
    if (hardAllowed) this.hardAllowedRootCount += 1;
    if (riskAllowed) this.riskAcceptableRootCount += 1;
    if (strictRows) {
      this.strictAttackRootCount += 1; this.strictAttackRowCount += strictRows;
      if (strictOnlyFire) this.onlyFireStrictRootCount += 1;
      if (strictMovement) this.movementStrictRootCount += 1;
      if (strictResource) this.resourceStrictRootCount += 1;
      if (strictStar) this.strictStarConflictRootCount += 1;
    }
    let stage = !broad ? FUNNEL.NO_COMBAT_EVIDENCE :
      !generator ? FUNNEL.SOFT_ONLY_EVIDENCE :
      !purposeComplete ? FUNNEL.INCOMPLETE_PURPOSE_OR_ESCAPE :
      !portfolioComplete ? FUNNEL.PORTFOLIO_SUPPORT_GAP :
      !hardAllowed ? FUNNEL.HARD_FILTERED :
      !riskAllowed ? FUNNEL.RISK_FILTERED :
      !strictRows ? FUNNEL.DOMINATED : FUNNEL.STRICT;
    this.funnel[stage] += 1; this.lastFunnel = stage; this.lastStrictMask = strictMask;
    const selected = this.selectedRow(engine, emittedAction); this.lastSelectedRow = selected;
    if (strictRows) {
      if (selected >= 0 && strictMask & (1 << selected))
        this.selectedStrictAttackCount += 1;
      else this.selectedOutsideStrictAttackCount += 1;
    }
    const attackEpoch = this.epoch && this.epoch.activeGeneration &&
      this.epoch.activeKind === LONG_OPTION.ATTACK;
    if (attackEpoch) {
      this.attackEpochFrameCount += 1;
      if (strictRows) this.attackEpochStrictSupportCount += 1;
      else this.attackEpochExecutionGapCount += 1;
    } else if (strictRows) this.strictAttackWithoutAttackEpochCount += 1;
  }

  summary() {
    return { decisionCount: this.decisionCount,
      enemyVisibleCount: this.enemyVisibleCount, enemyHiddenCount: this.enemyHiddenCount,
      broadEvidenceRootCount: this.broadEvidenceRootCount,
      generatorEvidenceRootCount: this.generatorEvidenceRootCount,
      purposeCompleteRootCount: this.purposeCompleteRootCount,
      portfolioAttackRootCount: this.portfolioAttackRootCount,
      portfolioCompleteRootCount: this.portfolioCompleteRootCount,
      hardAllowedRootCount: this.hardAllowedRootCount,
      riskAcceptableRootCount: this.riskAcceptableRootCount,
      strictAttackRootCount: this.strictAttackRootCount,
      strictAttackRowCount: this.strictAttackRowCount,
      onlyFireStrictRootCount: this.onlyFireStrictRootCount,
      movementStrictRootCount: this.movementStrictRootCount,
      resourceStrictRootCount: this.resourceStrictRootCount,
      strictStarConflictRootCount: this.strictStarConflictRootCount,
      selectedStrictAttackCount: this.selectedStrictAttackCount,
      selectedOutsideStrictAttackCount: this.selectedOutsideStrictAttackCount,
      attackEpochFrameCount: this.attackEpochFrameCount,
      attackEpochStrictSupportCount: this.attackEpochStrictSupportCount,
      attackEpochExecutionGapCount: this.attackEpochExecutionGapCount,
      strictAttackWithoutAttackEpochCount: this.strictAttackWithoutAttackEpochCount,
      funnel: namedFunnel(this.funnel), rawByAction: namedActions(this.rawByAction),
      completeByAction: namedActions(this.completeByAction),
      strictByAction: namedActions(this.strictByAction),
      hotAllocationCount: this.hotAllocationCount, lastFunnel: FUNNEL_NAME[this.lastFunnel],
      lastStrictMask: this.lastStrictMask, lastSelectedRow: this.lastSelectedRow };
  }
}

module.exports = { FUNNEL, FUNNEL_NAME, SemanticAttackOptionCoverageShadow };
