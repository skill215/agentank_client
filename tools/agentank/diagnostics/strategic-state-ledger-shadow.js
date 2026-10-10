"use strict";

// Behavior-neutral strategic observer. It turns the per-frame Option ledger
// into a score/phase/target lifecycle audit without taking action ownership.
// observe() is scalar/TypedArray-only; allocations are confined to summary().

const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND } = require("../../../engine-v2/src/policy/option-portfolio");
const { LONG_OPTION, OPTION_NAME } = require("./event-driven-option-shadow");

const SCORE_BAND = Object.freeze({ TIED: 0, LEADING: 1, TRAILING: 2, COUNT: 3 });
const SCORE_BAND_NAME = Object.freeze(["TIED", "LEADING", "TRAILING"]);
const PHASE_BAND = Object.freeze({ OPENING: 0, MIDGAME: 1, ENDGAME: 2, COUNT: 3 });
const PHASE_BAND_NAME = Object.freeze(["OPENING", "MIDGAME", "ENDGAME"]);
const DEADLINE_BUCKET_NAME = Object.freeze([
  "EXPIRED", "NOW", "ONE_TWO", "THREE_FOUR", "FIVE_EIGHT", "NINE_PLUS"
]);
const ACTION_NAME = Object.freeze([
  "NONE", "GO", "TURN_LEFT", "TURN_RIGHT", "FIRE", "THROW_BOMB",
  "CAST_SHIELD", "CAST_FREEZE", "CAST_STUN", "CAST_OVERLOAD", "CAST_CLOAK",
  "CAST_POISON", "CAST_TELEPORT", "CAST_BOOST", "BOOST_LEFT_GO",
  "BOOST_LEFT_TURN_LEFT", "BOOST_LEFT_TURN_RIGHT", "BOOST_LEFT_FIRE",
  "BOOST_LEFT_BOMB", "BOOST_RIGHT_GO", "BOOST_RIGHT_TURN_LEFT",
  "BOOST_RIGHT_TURN_RIGHT", "BOOST_RIGHT_FIRE", "BOOST_RIGHT_BOMB"
]);

function deadlineBucket(deadline, frame) {
  if (deadline < frame) return 0;
  const slack = deadline - frame;
  if (!slack) return 1;
  if (slack <= 2) return 2;
  if (slack <= 4) return 3;
  if (slack <= 8) return 4;
  return 5;
}

function named(values, names) {
  const output = {};
  for (let at = 0; at < names.length; at += 1) output[names[at]] = values[at];
  return output;
}

function bandKindTable(values, bandNames, kindNames) {
  const output = {};
  for (let band = 0; band < bandNames.length; band += 1) {
    const row = {}; const base = band * LONG_OPTION.COUNT;
    for (let kind = 0; kind < kindNames.length; kind += 1)
      row[kindNames[kind]] = values[base + kind];
    output[bandNames[band]] = row;
  }
  return output;
}

function bandActionTable(values) {
  const output = {};
  for (let band = 0; band < SCORE_BAND.COUNT; band += 1) {
    const row = {}; const base = band * ACTION_NAME.length;
    for (let action = 0; action < ACTION_NAME.length; action += 1)
      if (values[base + action]) row[ACTION_NAME[action]] = values[base + action];
    output[SCORE_BAND_NAME[band]] = row;
  }
  return output;
}

class StrategicStateLedgerShadow {
  constructor(stableLedger) {
    if (!stableLedger) throw new Error("StrategicStateLedgerShadow requires StableOptionLedgerShadow");
    this.ledger = stableLedger;
    this.selectedByScoreKind = new Uint32Array(SCORE_BAND.COUNT * LONG_OPTION.COUNT);
    this.selectedByPhaseKind = new Uint32Array(PHASE_BAND.COUNT * LONG_OPTION.COUNT);
    this.actionByScore = new Uint32Array(SCORE_BAND.COUNT * ACTION_NAME.length);
    this.targetRunsByScoreKind = new Uint32Array(SCORE_BAND.COUNT * LONG_OPTION.COUNT);
    this.targetFramesByScoreKind = new Uint32Array(SCORE_BAND.COUNT * LONG_OPTION.COUNT);
    this.maximumTargetRunByScoreKind = new Uint16Array(
      SCORE_BAND.COUNT * LONG_OPTION.COUNT);
    this.planCommitsByScoreKind = new Uint32Array(SCORE_BAND.COUNT * LONG_OPTION.COUNT);
    this.planActivationsByScoreKind = new Uint32Array(SCORE_BAND.COUNT * LONG_OPTION.COUNT);
    this.planCompletionsByScoreKind = new Uint32Array(SCORE_BAND.COUNT * LONG_OPTION.COUNT);
    this.planInvalidationsByScoreKind = new Uint32Array(SCORE_BAND.COUNT * LONG_OPTION.COUNT);
    this.deadlineSlackBuckets = new Uint32Array(DEADLINE_BUCKET_NAME.length);
    this.generationSwitchByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.eventSwitchByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.unsignaledSwitchByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.qualifiedAttackRootByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.qualifiedStarRootByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.selectedAttackWithStarAlternativeByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.selectedStarWithAttackAlternativeByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.selectedResourceWithStarAlternativeByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.attackStarPathRegressionByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.resourceStarPathRegressionByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.eventFramesByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.noEventFramesByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.lifecycleCreationsByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.lifecycleExpiriesByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.lifecycleGapsByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.lifecycleRecoveriesByScore = new Uint32Array(SCORE_BAND.COUNT);

    this.decisionCount = 0; this.matchCount = 0; this.trackedSelectionCount = 0;
    this.untrackedSelectionCount = 0; this.generationContinuationCount = 0;
    this.generationSwitchCount = 0; this.eventGenerationSwitchCount = 0;
    this.unsignaledGenerationSwitchCount = 0; this.targetRunCount = 0;
    this.targetRunFrameCount = 0; this.maximumTargetRun = 0;
    this.sameTargetPlanCommitCount = 0; this.sameTargetPlanCompletionCount = 0;
    this.sameCallbackCommitCompletionCount = 0;
    this.leadingAttackWithStarRegression = 0;
    this.leadingResourceWithStarRegression = 0;
    this.trailingStarWithAttackAlternative = 0;
    this.tiedStarWithAttackAlternative = 0;
    this.hotAllocationCount = 0;
    this.initialized = 0; this.previousFrame = -1;
    this.previousGeneration = 0; this.previousKind = LONG_OPTION.NONE;
    this.previousScoreBand = SCORE_BAND.TIED; this.currentRunLength = 0;
    this.previousPlanCommits = 0; this.previousPlanActivations = 0;
    this.previousPlanCompletions = 0; this.previousPlanInvalidations = 0;
    this.previousCreationCount = 0; this.previousExpiryCount = 0;
    this.previousGapCount = 0; this.previousRecoveryCount = 0;
    this.lastScoreBand = SCORE_BAND.TIED; this.lastPhaseBand = PHASE_BAND.OPENING;
    this.lastSelectedKind = LONG_OPTION.NONE; this.lastSelectedGeneration = 0;
    this.lastQualifiedAttack = 0; this.lastQualifiedStar = 0;
  }

  scoreBand(own, enemy) {
    return own > enemy ? SCORE_BAND.LEADING : own < enemy ? SCORE_BAND.TRAILING :
      SCORE_BAND.TIED;
  }

  phaseBand(frame) {
    return frame >= 112 ? PHASE_BAND.ENDGAME : frame >= 64 ?
      PHASE_BAND.MIDGAME : PHASE_BAND.OPENING;
  }

  delta(current, previous) { return current >= previous ? current - previous : current; }

  finishRun() {
    if (!this.previousGeneration || !this.currentRunLength) return;
    const index = this.previousScoreBand * LONG_OPTION.COUNT + this.previousKind;
    this.targetRunsByScoreKind[index] += 1;
    this.targetFramesByScoreKind[index] += this.currentRunLength;
    if (this.currentRunLength > this.maximumTargetRunByScoreKind[index])
      this.maximumTargetRunByScoreKind[index] = this.currentRunLength;
    this.targetRunCount += 1; this.targetRunFrameCount += this.currentRunLength;
    if (this.currentRunLength > this.maximumTargetRun)
      this.maximumTargetRun = this.currentRunLength;
  }

  qualifiedAlternatives(engine, selectedRow, scoreBand) {
    const portfolio = engine.optionPortfolio;
    const risk = engine.riskController && engine.riskController.outcome;
    if (!portfolio || !risk) {
      this.lastQualifiedAttack = 0; this.lastQualifiedStar = 0; return;
    }
    let attack = 0; let star = 0; let bestStarDistance = 0xffff;
    for (let at = 0; at < portfolio.count; at += 1) {
      const row = portfolio.primitiveRow[at];
      if (!portfolio.supportComplete[at] || row >= engine.ourCount ||
          engine.hardStatus[row] !== HARD_STATUS.ALLOW || row >= risk.count ||
          !risk.acceptable[row] || risk.dominated[row]) continue;
      const kind = portfolio.kind[at];
      if (kind === OPTION_KIND.DIRECT_KILL || kind === OPTION_KIND.ATTACK_SETUP)
        attack = 1;
      else if (kind === OPTION_KIND.STAR_CONTROL) {
        star = 1;
        const distance = engine.starDistance(engine.projectedCell[row]);
        if (distance < bestStarDistance) bestStarDistance = distance;
      }
    }
    this.lastQualifiedAttack = attack; this.lastQualifiedStar = star;
    if (attack) this.qualifiedAttackRootByScore[scoreBand] += 1;
    if (star) this.qualifiedStarRootByScore[scoreBand] += 1;
    const kind = this.ledger.lastSelectedKind;
    if (kind === LONG_OPTION.ATTACK && star) {
      this.selectedAttackWithStarAlternativeByScore[scoreBand] += 1;
      if (selectedRow >= 0 && engine.starDistance(engine.projectedCell[selectedRow]) >
          bestStarDistance) {
        this.attackStarPathRegressionByScore[scoreBand] += 1;
        if (scoreBand === SCORE_BAND.LEADING) this.leadingAttackWithStarRegression += 1;
      }
    } else if (kind === LONG_OPTION.RESOURCE && star) {
      this.selectedResourceWithStarAlternativeByScore[scoreBand] += 1;
      if (selectedRow >= 0 && engine.starDistance(engine.projectedCell[selectedRow]) >
          bestStarDistance) {
        this.resourceStarPathRegressionByScore[scoreBand] += 1;
        if (scoreBand === SCORE_BAND.LEADING) this.leadingResourceWithStarRegression += 1;
      }
    } else if (kind === LONG_OPTION.STAR_CONTROL && attack) {
      this.selectedStarWithAttackAlternativeByScore[scoreBand] += 1;
      if (scoreBand === SCORE_BAND.TRAILING) this.trailingStarWithAttackAlternative += 1;
      else if (scoreBand === SCORE_BAND.TIED) this.tiedStarWithAttackAlternative += 1;
    }
  }

  observe(engine, emittedAction) {
    if (!engine || !engine.adapter || !engine.adapter.state) return;
    const a = engine.adapter.state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const newMatch = !this.initialized || frame <= this.previousFrame;
    if (newMatch && this.initialized) this.finishRun();
    if (newMatch) {
      this.matchCount += 1; this.previousGeneration = 0;
      this.previousKind = LONG_OPTION.NONE; this.currentRunLength = 0;
      this.previousPlanCommits = 0; this.previousPlanActivations = 0;
      this.previousPlanCompletions = 0; this.previousPlanInvalidations = 0;
      this.previousCreationCount = 0; this.previousExpiryCount = 0;
      this.previousGapCount = 0; this.previousRecoveryCount = 0;
    }
    this.initialized = 1; this.previousFrame = frame; this.decisionCount += 1;
    const score = this.scoreBand(a[ARRAY.TANK_STARS][0], a[ARRAY.TANK_STARS][1]);
    const phase = this.phaseBand(frame); const kind = this.ledger.lastSelectedKind;
    const generation = this.ledger.lastSelectedGeneration;
    const event = this.ledger.lastEventMask;
    const row = this.ledger.classifier.selectedRow(engine, emittedAction);
    const action = row < 0 ? emittedAction : engine.ourActions[row];
    this.lastScoreBand = score; this.lastPhaseBand = phase;
    this.lastSelectedKind = kind; this.lastSelectedGeneration = generation;
    this.selectedByScoreKind[score * LONG_OPTION.COUNT + kind] += 1;
    this.selectedByPhaseKind[phase * LONG_OPTION.COUNT + kind] += 1;
    if (action >= 0 && action < ACTION_NAME.length)
      this.actionByScore[score * ACTION_NAME.length + action] += 1;
    if (event) this.eventFramesByScore[score] += 1;
    else this.noEventFramesByScore[score] += 1;

    if (generation) {
      this.trackedSelectionCount += 1;
      if (generation === this.previousGeneration) {
        this.generationContinuationCount += 1;
        if (score !== this.previousScoreBand || kind !== this.previousKind) {
          this.finishRun(); this.currentRunLength = 1;
        } else this.currentRunLength += 1;
      } else {
        if (this.previousGeneration) {
          this.finishRun(); this.generationSwitchCount += 1;
          this.generationSwitchByScore[score] += 1;
          if (event) {
            this.eventGenerationSwitchCount += 1; this.eventSwitchByScore[score] += 1;
          } else {
            this.unsignaledGenerationSwitchCount += 1;
            this.unsignaledSwitchByScore[score] += 1;
          }
        }
        this.currentRunLength = 1;
      }
    } else {
      this.untrackedSelectionCount += 1;
      if (this.previousGeneration) this.finishRun();
      this.currentRunLength = 0;
    }

    const key = score * LONG_OPTION.COUNT + kind;
    const commits = this.delta(engine.planCommitCount || 0, this.previousPlanCommits);
    const activations = this.delta(engine.planActivateCount || 0,
      this.previousPlanActivations);
    const completions = this.delta(engine.planCompleteCount || 0,
      this.previousPlanCompletions);
    const invalidations = this.delta(engine.planInvalidateCount || 0,
      this.previousPlanInvalidations);
    this.planCommitsByScoreKind[key] += commits;
    this.planActivationsByScoreKind[key] += activations;
    this.planCompletionsByScoreKind[key] += completions;
    this.planInvalidationsByScoreKind[key] += invalidations;
    if (generation && generation === this.previousGeneration) {
      this.sameTargetPlanCommitCount += commits;
      this.sameTargetPlanCompletionCount += completions;
    }
    this.sameCallbackCommitCompletionCount += Math.min(commits, completions);
    this.previousPlanCommits = engine.planCommitCount || 0;
    this.previousPlanActivations = engine.planActivateCount || 0;
    this.previousPlanCompletions = engine.planCompleteCount || 0;
    this.previousPlanInvalidations = engine.planInvalidateCount || 0;

    const creations = this.delta(this.ledger.creationCount, this.previousCreationCount);
    const expiries = this.delta(this.ledger.expiryCount, this.previousExpiryCount);
    const gaps = this.delta(this.ledger.availabilityGapCount, this.previousGapCount);
    const recoveries = this.delta(this.ledger.availabilityRecoveryCount,
      this.previousRecoveryCount);
    this.lifecycleCreationsByScore[score] += creations;
    this.lifecycleExpiriesByScore[score] += expiries;
    this.lifecycleGapsByScore[score] += gaps;
    this.lifecycleRecoveriesByScore[score] += recoveries;
    this.previousCreationCount = this.ledger.creationCount;
    this.previousExpiryCount = this.ledger.expiryCount;
    this.previousGapCount = this.ledger.availabilityGapCount;
    this.previousRecoveryCount = this.ledger.availabilityRecoveryCount;

    const slot = this.ledger.lastSelectedSlot;
    if (slot >= 0 && this.ledger.available[slot])
      this.deadlineSlackBuckets[deadlineBucket(this.ledger.deadline[slot], frame)] += 1;
    this.qualifiedAlternatives(engine, row, score);
    this.previousGeneration = generation; this.previousKind = kind;
    this.previousScoreBand = score;
  }

  summary() {
    const hasActiveRun = this.previousGeneration && this.currentRunLength ? 1 : 0;
    const activeBand = this.previousScoreBand;
    const activeKind = this.previousKind;
    const targetRuns = bandKindTable(this.targetRunsByScoreKind,
      SCORE_BAND_NAME, OPTION_NAME);
    const targetFrames = bandKindTable(this.targetFramesByScoreKind,
      SCORE_BAND_NAME, OPTION_NAME);
    const maximumRuns = bandKindTable(this.maximumTargetRunByScoreKind,
      SCORE_BAND_NAME, OPTION_NAME);
    if (hasActiveRun) {
      const bandName = SCORE_BAND_NAME[activeBand]; const kindName = OPTION_NAME[activeKind];
      targetRuns[bandName][kindName] += 1;
      targetFrames[bandName][kindName] += this.currentRunLength;
      maximumRuns[bandName][kindName] = Math.max(maximumRuns[bandName][kindName],
        this.currentRunLength);
    }
    return {
      decisionCount: this.decisionCount, matchCount: this.matchCount,
      trackedSelectionCount: this.trackedSelectionCount,
      untrackedSelectionCount: this.untrackedSelectionCount,
      generationContinuationCount: this.generationContinuationCount,
      generationSwitchCount: this.generationSwitchCount,
      eventGenerationSwitchCount: this.eventGenerationSwitchCount,
      unsignaledGenerationSwitchCount: this.unsignaledGenerationSwitchCount,
      targetRunCount: this.targetRunCount + hasActiveRun,
      targetRunFrameCount: this.targetRunFrameCount +
        (hasActiveRun ? this.currentRunLength : 0),
      maximumTargetRun: Math.max(this.maximumTargetRun,
        hasActiveRun ? this.currentRunLength : 0),
      sameTargetPlanCommitCount: this.sameTargetPlanCommitCount,
      sameTargetPlanCompletionCount: this.sameTargetPlanCompletionCount,
      sameCallbackCommitCompletionCount: this.sameCallbackCommitCompletionCount,
      leadingAttackWithStarRegression: this.leadingAttackWithStarRegression,
      leadingResourceWithStarRegression: this.leadingResourceWithStarRegression,
      trailingStarWithAttackAlternative: this.trailingStarWithAttackAlternative,
      tiedStarWithAttackAlternative: this.tiedStarWithAttackAlternative,
      hotAllocationCount: this.hotAllocationCount,
      lastScoreBand: SCORE_BAND_NAME[this.lastScoreBand],
      lastPhaseBand: PHASE_BAND_NAME[this.lastPhaseBand],
      lastSelectedKind: OPTION_NAME[this.lastSelectedKind],
      lastSelectedGeneration: this.lastSelectedGeneration,
      lastQualifiedAttack: this.lastQualifiedAttack,
      lastQualifiedStar: this.lastQualifiedStar,
      selectedByScoreKind: bandKindTable(this.selectedByScoreKind,
        SCORE_BAND_NAME, OPTION_NAME),
      selectedByPhaseKind: bandKindTable(this.selectedByPhaseKind,
        PHASE_BAND_NAME, OPTION_NAME),
      actionByScore: bandActionTable(this.actionByScore),
      targetRunsByScoreKind: targetRuns,
      targetFramesByScoreKind: targetFrames,
      maximumTargetRunByScoreKind: maximumRuns,
      planCommitsByScoreKind: bandKindTable(this.planCommitsByScoreKind,
        SCORE_BAND_NAME, OPTION_NAME),
      planActivationsByScoreKind: bandKindTable(this.planActivationsByScoreKind,
        SCORE_BAND_NAME, OPTION_NAME),
      planCompletionsByScoreKind: bandKindTable(this.planCompletionsByScoreKind,
        SCORE_BAND_NAME, OPTION_NAME),
      planInvalidationsByScoreKind: bandKindTable(this.planInvalidationsByScoreKind,
        SCORE_BAND_NAME, OPTION_NAME),
      deadlineSlackBuckets: named(this.deadlineSlackBuckets, DEADLINE_BUCKET_NAME),
      generationSwitchByScore: named(this.generationSwitchByScore, SCORE_BAND_NAME),
      eventSwitchByScore: named(this.eventSwitchByScore, SCORE_BAND_NAME),
      unsignaledSwitchByScore: named(this.unsignaledSwitchByScore, SCORE_BAND_NAME),
      qualifiedAttackRootByScore: named(this.qualifiedAttackRootByScore, SCORE_BAND_NAME),
      qualifiedStarRootByScore: named(this.qualifiedStarRootByScore, SCORE_BAND_NAME),
      selectedAttackWithStarAlternativeByScore: named(
        this.selectedAttackWithStarAlternativeByScore, SCORE_BAND_NAME),
      selectedStarWithAttackAlternativeByScore: named(
        this.selectedStarWithAttackAlternativeByScore, SCORE_BAND_NAME),
      selectedResourceWithStarAlternativeByScore: named(
        this.selectedResourceWithStarAlternativeByScore, SCORE_BAND_NAME),
      attackStarPathRegressionByScore: named(this.attackStarPathRegressionByScore,
        SCORE_BAND_NAME),
      resourceStarPathRegressionByScore: named(this.resourceStarPathRegressionByScore,
        SCORE_BAND_NAME),
      eventFramesByScore: named(this.eventFramesByScore, SCORE_BAND_NAME),
      noEventFramesByScore: named(this.noEventFramesByScore, SCORE_BAND_NAME),
      lifecycleCreationsByScore: named(this.lifecycleCreationsByScore, SCORE_BAND_NAME),
      lifecycleExpiriesByScore: named(this.lifecycleExpiriesByScore, SCORE_BAND_NAME),
      lifecycleGapsByScore: named(this.lifecycleGapsByScore, SCORE_BAND_NAME),
      lifecycleRecoveriesByScore: named(this.lifecycleRecoveriesByScore,
        SCORE_BAND_NAME)
    };
  }
}

module.exports = { SCORE_BAND, SCORE_BAND_NAME, PHASE_BAND, PHASE_BAND_NAME,
  DEADLINE_BUCKET_NAME, StrategicStateLedgerShadow };
