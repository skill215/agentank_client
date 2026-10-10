"use strict";

// Diagnostic-only attack continuation witness.  A complete first FIRE/setup
// is not a multi-frame Attack Option by itself: the same semantic ATTACK
// generation must also create causal progress in the already-computed bounded
// rollout.  This class consumes StableOptionIntervalShadow and never performs
// another transition, mutates Risk/Hard/Proof, or selects an action.

const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { PAC_STATUS } = require(
  "../../../engine-v2/src/search/projectile-attack-closure");

const ATTACK_PROGRESS = Object.freeze({
  FIRST_ACTION_COMPLETE: 1,
  RESPONSE_COMPRESSED: 2,
  SURVIVAL_COMPLETE: 4,
  POSTURE_PROGRESS: 8,
  DURABLE_PROGRESS: 16,
  IRREVERSIBLE_PROGRESS: 32,
  RISK_OPEN: 64,
  CHALLENGER: 128
});

const PROGRESS_NAME = Object.freeze([
  "FIRST_ACTION_COMPLETE", "RESPONSE_COMPRESSED", "SURVIVAL_COMPLETE",
  "POSTURE_PROGRESS", "DURABLE_PROGRESS", "IRREVERSIBLE_PROGRESS",
  "RISK_OPEN", "CHALLENGER"
]);

function namedBits(values) {
  const output = {};
  for (let index = 0; index < PROGRESS_NAME.length; index += 1)
    output[PROGRESS_NAME[index]] = values[index];
  return output;
}

class AttackContinuationProgressShadow {
  constructor(interval) {
    this.interval = interval;
    this.bitCounts = new Uint32Array(PROGRESS_NAME.length);
    this.maskCounts = new Uint32Array(256);
    this.observationCount = 0; this.evaluationCount = 0;
    this.duplicateSkipCount = 0; this.invalidRowCount = 0;
    this.firstActionIncompleteCount = 0; this.responseUnchangedCount = 0;
    this.survivalIncompleteCount = 0; this.postureOnlyCount = 0;
    this.riskSeparatedBlockedCount = 0; this.starRegressionCount = 0;
    this.challengerBeforeStarTradeoffCount = 0;
    this.nonRegressiveChallengerCount = 0; this.strongWitnessCount = 0;
    this.newGenerationCount = 0; this.sameGenerationRevalidationCount = 0;
    this.progressMaintainedCount = 0; this.progressAdvancedCount = 0;
    this.progressRegressedCount = 0;
    this.lastEvaluationSerial = 0; this.lastGeneration = 0;
    this.lastMask = 0; this.lastDurableRevalidations = 0;
    this.maximumDurableRevalidations = 0; this.hotAllocationCount = 0;
  }

  firstActionComplete(engine, row) {
    const combat = engine.combat && engine.combat.vector;
    const pac = engine.projectileAttackClosure || engine.projectileAttack;
    if (!combat || !pac || row < 0 || row >= combat.count || row >= pac.count)
      return 0;
    if (combat.attackClosureStatus[row] !== PAC_STATUS.COMPLETE ||
        pac.status[row] !== PAC_STATUS.COMPLETE ||
        combat.enemyUnknownFirstActions[row] !== 0 ||
        combat.purposeCompleteness[row] < 4500) return 0;
    if (engine.ourActions[row] === ACTION.FIRE && !combat.postFireEscape[row])
      return 0;
    return 1;
  }

  responseCompressed(engine, row) {
    const combat = engine.combat.vector;
    return combat.enemyDoomedFirstActions[row] > 0 ||
      combat.enemyEndpointReduction[row] > 0 ||
      combat.enemyMobilityLoss[row] > 0 ? 1 : 0;
  }

  observe(engine) {
    this.observationCount += 1;
    const interval = this.interval;
    if (!interval || interval.evaluationSerial === this.lastEvaluationSerial) {
      this.duplicateSkipCount += 1; return;
    }
    this.lastEvaluationSerial = interval.evaluationSerial;
    const attack = interval.lastAttackRow; const selected = interval.lastSelectedRow;
    const rollout = interval.rollout;
    if (!engine || !rollout || attack < 0 || selected < 0 ||
        attack >= engine.ourCount || selected >= engine.ourCount) {
      this.invalidRowCount += 1; return;
    }
    this.evaluationCount += 1;
    let mask = 0;
    const first = this.firstActionComplete(engine, attack);
    if (first) mask |= ATTACK_PROGRESS.FIRST_ACTION_COMPLETE;
    else this.firstActionIncompleteCount += 1;
    const response = first && this.responseCompressed(engine, attack);
    if (response) mask |= ATTACK_PROGRESS.RESPONSE_COMPRESSED;
    else if (first) this.responseUnchangedCount += 1;
    const survival = rollout.physicalComplete[attack] &&
      rollout.rootRestored[attack] && !rollout.hardFatal[attack] &&
      !rollout.ownCrashed[attack];
    if (survival) mask |= ATTACK_PROGRESS.SURVIVAL_COMPLETE;
    else this.survivalIncompleteCount += 1;

    const posture = rollout.ownFireLane[attack] > rollout.ownFireLane[selected] ||
      rollout.enemyMobility[attack] < rollout.enemyMobility[selected] ||
      rollout.objectiveProgress[attack] > rollout.objectiveProgress[selected];
    if (posture) mask |= ATTACK_PROGRESS.POSTURE_PROGRESS;
    const irreversible =
      rollout.enemyCrashed[attack] > rollout.enemyCrashed[selected] ||
      rollout.enemyDebuffCount[attack] > rollout.enemyDebuffCount[selected];
    const projectileConstraint =
      rollout.projectileThreat[attack] > rollout.projectileThreat[selected] &&
      response;
    const durable = irreversible || projectileConstraint ||
      (rollout.ownProjectileCount[attack] > rollout.ownProjectileCount[selected] &&
       rollout.enemyMobility[attack] < rollout.enemyMobility[selected] && response);
    if (durable) mask |= ATTACK_PROGRESS.DURABLE_PROGRESS;
    if (irreversible) mask |= ATTACK_PROGRESS.IRREVERSIBLE_PROGRESS;
    if (posture && !durable) this.postureOnlyCount += 1;

    const riskOpen = interval.lastRiskIncumbentLower <= interval.lastRiskAttackUpper;
    if (riskOpen) mask |= ATTACK_PROGRESS.RISK_OPEN;
    else this.riskSeparatedBlockedCount += 1;
    const challenger = first && response && survival && durable && riskOpen;
    if (challenger) {
      mask |= ATTACK_PROGRESS.CHALLENGER;
      this.challengerBeforeStarTradeoffCount += 1;
    }
    const starRegression = rollout.starGain[attack] < rollout.starGain[selected];
    if (starRegression) this.starRegressionCount += 1;
    if (challenger && !starRegression) this.nonRegressiveChallengerCount += 1;

    const generation = interval.lastAttackGeneration;
    if (!generation || generation !== this.lastGeneration) {
      this.newGenerationCount += 1; this.lastDurableRevalidations = 0;
    } else {
      this.sameGenerationRevalidationCount += 1;
      const priorProgress = this.lastMask &
        (ATTACK_PROGRESS.POSTURE_PROGRESS | ATTACK_PROGRESS.DURABLE_PROGRESS |
         ATTACK_PROGRESS.IRREVERSIBLE_PROGRESS);
      const nextProgress = mask &
        (ATTACK_PROGRESS.POSTURE_PROGRESS | ATTACK_PROGRESS.DURABLE_PROGRESS |
         ATTACK_PROGRESS.IRREVERSIBLE_PROGRESS);
      if (nextProgress === priorProgress) this.progressMaintainedCount += 1;
      else if ((nextProgress | priorProgress) === nextProgress)
        this.progressAdvancedCount += 1;
      else this.progressRegressedCount += 1;
    }
    if (durable) this.lastDurableRevalidations += 1;
    else this.lastDurableRevalidations = 0;
    if (this.lastDurableRevalidations > this.maximumDurableRevalidations)
      this.maximumDurableRevalidations = this.lastDurableRevalidations;
    if (challenger && (irreversible || this.lastDurableRevalidations >= 2))
      this.strongWitnessCount += 1;
    this.lastGeneration = generation; this.lastMask = mask;
    this.maskCounts[mask] += 1;
    for (let bit = 0; bit < PROGRESS_NAME.length; bit += 1)
      if (mask & (1 << bit)) this.bitCounts[bit] += 1;
  }

  summary() {
    return { enabled: true, behaviorNeutral: true, nominalOnly: true,
      observationCount: this.observationCount, evaluationCount: this.evaluationCount,
      duplicateSkipCount: this.duplicateSkipCount, invalidRowCount: this.invalidRowCount,
      firstActionIncompleteCount: this.firstActionIncompleteCount,
      responseUnchangedCount: this.responseUnchangedCount,
      survivalIncompleteCount: this.survivalIncompleteCount,
      postureOnlyCount: this.postureOnlyCount,
      riskSeparatedBlockedCount: this.riskSeparatedBlockedCount,
      starRegressionCount: this.starRegressionCount,
      challengerBeforeStarTradeoffCount: this.challengerBeforeStarTradeoffCount,
      nonRegressiveChallengerCount: this.nonRegressiveChallengerCount,
      strongWitnessCount: this.strongWitnessCount,
      newGenerationCount: this.newGenerationCount,
      sameGenerationRevalidationCount: this.sameGenerationRevalidationCount,
      progressMaintainedCount: this.progressMaintainedCount,
      progressAdvancedCount: this.progressAdvancedCount,
      progressRegressedCount: this.progressRegressedCount,
      maximumDurableRevalidations: this.maximumDurableRevalidations,
      lastEvaluationSerial: this.lastEvaluationSerial,
      lastGeneration: this.lastGeneration, lastMask: this.lastMask,
      bitCounts: namedBits(this.bitCounts),
      maskCounts: Array.from(this.maskCounts), hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { ATTACK_PROGRESS, PROGRESS_NAME,
  AttackContinuationProgressShadow };
