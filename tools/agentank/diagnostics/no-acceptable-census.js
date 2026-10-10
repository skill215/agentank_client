"use strict";

const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { SAFETY_STATUS } =
  require("../../../engine-v2/src/search/information-safety-closure");
const { FRONTIER_STATUS } =
  require("../../../engine-v2/src/search/observation-safety-frontier");

const BLOCK = Object.freeze({ IMMEDIATE: 1, HORIZON: 2, UNKNOWN: 4, SLACK: 8,
  SAFE_WITNESS_FILTER: 16 });
const SOURCE = Object.freeze({ COMMITTED: 1, POSSIBLE_PROJECTILE: 2, FUTURE_FIRE: 4 });
const UNKNOWN_ORIGIN = Object.freeze({ OBSERVATION_NO_WITNESS: 1,
  OBSERVATION_INCOMPLETE: 2, BASE_SAFETY: 4 });
const PRIMARY = Object.freeze({ ALL_HARD_REJECTED: 0, COMPLETE_SAFE_CONFLICT: 1,
  COMMITTED_FATAL: 2, POSSIBLE_PROJECTILE_FATAL: 3, FUTURE_FIRE_FATAL: 4,
  FATAL_MIXED_OR_UNATTRIBUTED: 5, UNKNOWN_UNAVOIDABLE: 6,
  SLACK_UNAVOIDABLE: 7, MULTI_DIMENSION_UNAVOIDABLE: 8,
  CROSS_ACTION_TRADEOFF: 9, UNCLASSIFIED: 10, COUNT: 11 });

const PRIMARY_NAME = Object.freeze([
  "ALL_HARD_REJECTED", "COMPLETE_SAFE_CONFLICT", "COMMITTED_FATAL",
  "POSSIBLE_PROJECTILE_FATAL", "FUTURE_FIRE_FATAL",
  "FATAL_MIXED_OR_UNATTRIBUTED", "UNKNOWN_UNAVOIDABLE", "SLACK_UNAVOIDABLE",
  "MULTI_DIMENSION_UNAVOIDABLE", "CROSS_ACTION_TRADEOFF", "UNCLASSIFIED"
]);
const BLOCK_NAME = Object.freeze(["IMMEDIATE", "HORIZON", "UNKNOWN", "SLACK",
  "SAFE_WITNESS_FILTER"]);
const SOURCE_NAME = Object.freeze(["COMMITTED", "POSSIBLE_PROJECTILE", "FUTURE_FIRE"]);
const UNKNOWN_ORIGIN_NAME = Object.freeze([
  "OBSERVATION_NO_WITNESS", "OBSERVATION_INCOMPLETE", "BASE_SAFETY"
]);

function bitCount(value) {
  let count = 0;
  for (let bits = value >>> 0; bits; bits &= bits - 1) count += 1;
  return count;
}

function namedCounts(array, names) {
  const output = {};
  for (let index = 0; index < names.length; index += 1) output[names[index]] = array[index];
  return output;
}

function sparseCounts(array) {
  const output = [];
  for (let index = 0; index < array.length; index += 1)
    if (array[index]) output.push([index, array[index]]);
  return output;
}

class NoAcceptableCensus {
  constructor(sampleLimit = 0) {
    this.sampleLimit = Math.max(0, sampleLimit | 0);
    this.decisionCount = 0; this.rootCount = 0;
    this.completeSafeWitnessRoots = 0; this.committedFreeAlternativeRoots = 0;
    this.incompleteSupportRoots = 0;
    this.primaryCounts = new Uint32Array(PRIMARY.COUNT);
    this.failedUnionCounts = new Uint32Array(32);
    this.failedIntersectionCounts = new Uint32Array(32);
    this.sourcePresenceCounts = new Uint32Array(8);
    this.sourceUnavoidableCounts = new Uint32Array(8);
    this.unknownOriginCounts = new Uint32Array(8);
    this.unknownMinimumCounts = new Uint32Array(10001);
    this.unknownPossibleProjectileCounts = new Uint32Array(257);
    this.unknownObservationSupportCounts = new Uint32Array(2);
    this.riskCounts = new Uint32Array(101);
    this.selectedActionCounts = new Uint32Array(256);
    this.observationNoWitnessRows = 0; this.observationIncompleteRows = 0;
    this.baseSafetyUnknownRows = 0;
    this.samples = [];
  }

  observe(controller, safety, selectedAction = ACTION.NONE, frame = 0,
      enemyVisible = 0, possibleProjectileCount = 0, committedEntityCount = 0,
      diagnostic = null) {
    this.decisionCount += 1;
    if (!controller || !controller.noAcceptableAction || !controller.outcome) return -1;
    const o = controller.outcome;
    this.rootCount += 1;
    this.riskCounts[Math.max(0, Math.min(100, controller.risk | 0))] += 1;
    this.selectedActionCounts[selectedAction & 0xff] += 1;

    let hardAllowed = 0; let failedUnion = 0; let failedIntersection = 31;
    let completeSafeWitness = 0; let committedFreeAlternative = 0;
    let incompleteSupport = 0; let sourcePresence = 0;
    let unknownOrigin = 0;
    let committedBlockedRows = 0; let possibleBlockedRows = 0; let futureBlockedRows = 0;
    let minimumImmediate = 10001; let minimumHorizon = 10001;
    let minimumUnknown = 10001; let maximumSlack = -129;

    // Gate computes this root-wide witness before filtering any row. Mirror
    // that order so a witness at a later row still constrains earlier rows.
    for (let row = 0; row < o.count; row += 1)
      if (o.hard[row] === HARD_STATUS.ALLOW &&
          o.safety[row] === SAFETY_STATUS.PROVEN_SAFE &&
          o.immediateFatalMass[row] === 0 && o.horizonFatalMass[row] === 0 &&
          o.unknownMass[row] === 0 && o.coverage[row] === 10000) {
        completeSafeWitness = 1; break;
      }

    for (let row = 0; row < o.count; row += 1) {
      if (o.hard[row] === HARD_STATUS.REJECT_PROVEN ||
          o.hard[row] === HARD_STATUS.REJECT_POLICY) continue;
      hardAllowed += 1;
      minimumImmediate = Math.min(minimumImmediate, o.immediateFatalMass[row]);
      minimumHorizon = Math.min(minimumHorizon, o.horizonFatalMass[row]);
      minimumUnknown = Math.min(minimumUnknown, o.unknownMass[row]);
      maximumSlack = Math.max(maximumSlack, o.escapeSlack[row]);

      let failed = 0;
      if (o.immediateFatalMass[row] > controller.immediateLimit) failed |= BLOCK.IMMEDIATE;
      if (o.horizonFatalMass[row] > controller.horizonLimit) failed |= BLOCK.HORIZON;
      if (o.unknownMass[row] > controller.unknownLimit) failed |= BLOCK.UNKNOWN;
      if (o.escapeSlack[row] < controller.minimumEscapeSlack) failed |= BLOCK.SLACK;
      if (controller.risk === 0 && completeSafeWitness &&
          (o.safety[row] !== SAFETY_STATUS.PROVEN_SAFE || o.coverage[row] !== 10000))
        failed |= BLOCK.SAFE_WITNESS_FILTER;
      failedUnion |= failed; failedIntersection &= failed;
      if (failed & BLOCK.UNKNOWN) {
        if (diagnostic?.observationSafetyAudited?.[row]) {
          const status = diagnostic.observationSafetyStatusByAction?.[row];
          if (status === FRONTIER_STATUS.NO_WITNESS) {
            unknownOrigin |= UNKNOWN_ORIGIN.OBSERVATION_NO_WITNESS;
            this.observationNoWitnessRows += 1;
          } else {
            unknownOrigin |= UNKNOWN_ORIGIN.OBSERVATION_INCOMPLETE;
            this.observationIncompleteRows += 1;
          }
        } else {
          unknownOrigin |= UNKNOWN_ORIGIN.BASE_SAFETY;
          this.baseSafetyUnknownRows += 1;
        }
      }

      let committedImmediate = 0; let committedHorizon = 0;
      let possibleImmediate = 0; let possibleHorizon = 0;
      let futureImmediate = 0; let futureHorizon = 0;
      if (safety && safety.committedDeathMass && safety.possibleProjectileDeathMass &&
          safety.futureFireDeathMass) {
        const base = row * 4;
        committedImmediate = safety.committedDeathMass[base] || 0;
        possibleImmediate = safety.possibleProjectileDeathMass[base] || 0;
        futureImmediate = safety.futureFireDeathMass[base] || 0;
        for (let depth = 0; depth < 4; depth += 1) {
          committedHorizon = Math.min(10000, committedHorizon +
            (safety.committedDeathMass[base + depth] || 0));
          possibleHorizon = Math.min(10000, possibleHorizon +
            (safety.possibleProjectileDeathMass[base + depth] || 0));
          futureHorizon = Math.min(10000, futureHorizon +
            (safety.futureFireDeathMass[base + depth] || 0));
        }
      }
      if (committedHorizon) sourcePresence |= SOURCE.COMMITTED;
      if (possibleHorizon) sourcePresence |= SOURCE.POSSIBLE_PROJECTILE;
      if (futureHorizon) sourcePresence |= SOURCE.FUTURE_FIRE;
      if (!committedHorizon) committedFreeAlternative = 1;
      if (committedImmediate > controller.immediateLimit ||
          committedHorizon > controller.horizonLimit) committedBlockedRows += 1;
      if (possibleImmediate > controller.immediateLimit ||
          possibleHorizon > controller.horizonLimit) possibleBlockedRows += 1;
      if (futureImmediate > controller.immediateLimit ||
          futureHorizon > controller.horizonLimit) futureBlockedRows += 1;
      if (o.coverage[row] < 10000 || o.unknownMass[row] > 0) incompleteSupport = 1;
    }

    if (!hardAllowed) failedIntersection = 0;
    let sourceUnavoidable = 0;
    if (hardAllowed && committedBlockedRows === hardAllowed) sourceUnavoidable |= SOURCE.COMMITTED;
    if (hardAllowed && possibleBlockedRows === hardAllowed)
      sourceUnavoidable |= SOURCE.POSSIBLE_PROJECTILE;
    if (hardAllowed && futureBlockedRows === hardAllowed) sourceUnavoidable |= SOURCE.FUTURE_FIRE;

    let primary = PRIMARY.UNCLASSIFIED;
    if (!hardAllowed) primary = PRIMARY.ALL_HARD_REJECTED;
    else if (completeSafeWitness) primary = PRIMARY.COMPLETE_SAFE_CONFLICT;
    else if (bitCount(failedIntersection) > 1) primary = PRIMARY.MULTI_DIMENSION_UNAVOIDABLE;
    else if (failedIntersection === BLOCK.UNKNOWN) primary = PRIMARY.UNKNOWN_UNAVOIDABLE;
    else if (failedIntersection === BLOCK.SLACK) primary = PRIMARY.SLACK_UNAVOIDABLE;
    else if (failedIntersection & (BLOCK.IMMEDIATE | BLOCK.HORIZON)) {
      primary = sourceUnavoidable === SOURCE.COMMITTED ? PRIMARY.COMMITTED_FATAL :
        sourceUnavoidable === SOURCE.POSSIBLE_PROJECTILE ? PRIMARY.POSSIBLE_PROJECTILE_FATAL :
        sourceUnavoidable === SOURCE.FUTURE_FIRE ? PRIMARY.FUTURE_FIRE_FATAL :
        PRIMARY.FATAL_MIXED_OR_UNATTRIBUTED;
    } else if (!failedIntersection && failedUnion) primary = PRIMARY.CROSS_ACTION_TRADEOFF;

    this.primaryCounts[primary] += 1;
    this.failedUnionCounts[failedUnion] += 1;
    this.failedIntersectionCounts[failedIntersection] += 1;
    this.sourcePresenceCounts[sourcePresence] += 1;
    this.sourceUnavoidableCounts[sourceUnavoidable] += 1;
    this.unknownOriginCounts[unknownOrigin] += 1;
    if (failedIntersection === BLOCK.UNKNOWN) {
      this.unknownMinimumCounts[Math.max(0, Math.min(10000, minimumUnknown))] += 1;
      this.unknownPossibleProjectileCounts[Math.max(0,
        Math.min(256, possibleProjectileCount | 0))] += 1;
      this.unknownObservationSupportCounts[diagnostic?.observationSupportComplete ? 1 : 0] += 1;
    }
    if (completeSafeWitness) this.completeSafeWitnessRoots += 1;
    if (committedFreeAlternative) this.committedFreeAlternativeRoots += 1;
    if (incompleteSupport) this.incompleteSupportRoots += 1;
    if (this.samples.length < this.sampleLimit) this.samples.push({ frame, primary,
      primaryName: PRIMARY_NAME[primary], risk: controller.risk, hardAllowed,
      failedUnion, failedIntersection, sourcePresence, sourceUnavoidable,
      completeSafeWitness, committedFreeAlternative, incompleteSupport,
      minimumImmediate, minimumHorizon, minimumUnknown,
      unknownLimit: controller.unknownLimit, unknownOrigin,
      unknownOriginNames: UNKNOWN_ORIGIN_NAME.filter((name, index) =>
        unknownOrigin & (1 << index)),
      observationSupportComplete: diagnostic?.observationSupportComplete ? 1 : 0,
      maximumSlack,
      selectedAction, enemyVisible: enemyVisible ? 1 : 0,
      possibleProjectileCount, committedEntityCount });
    return primary;
  }

  observeEngine(engine, selectedAction, frame) {
    return this.observe(engine.riskController, engine.safetyClosure.outcome,
      selectedAction, frame, engine.adapter.enemyVisible,
      engine.possibleProjectiles.count(), engine.escapeObligation.committedEntityCount, {
        observationSafetyAudited: engine.observationSafetyAudited,
        observationSafetyStatusByAction: engine.observationSafetyStatusByAction,
        observationSupportComplete: engine.observationSafetySupportComplete()
      });
  }

  summary() {
    return { decisionCount: this.decisionCount, rootCount: this.rootCount,
      rootBasisPoints: this.decisionCount ?
        Math.round(this.rootCount * 10000 / this.decisionCount) : 0,
      completeSafeWitnessRoots: this.completeSafeWitnessRoots,
      committedFreeAlternativeRoots: this.committedFreeAlternativeRoots,
      incompleteSupportRoots: this.incompleteSupportRoots,
      primary: namedCounts(this.primaryCounts, PRIMARY_NAME),
      failedUnionMasks: sparseCounts(this.failedUnionCounts),
      failedIntersectionMasks: sparseCounts(this.failedIntersectionCounts),
      sourcePresenceMasks: sparseCounts(this.sourcePresenceCounts),
      sourceUnavoidableMasks: sparseCounts(this.sourceUnavoidableCounts),
      unknownOriginMasks: sparseCounts(this.unknownOriginCounts),
      unknownMinimumCounts: sparseCounts(this.unknownMinimumCounts),
      unknownPossibleProjectileCounts: sparseCounts(this.unknownPossibleProjectileCounts),
      unknownObservationSupportCounts: sparseCounts(this.unknownObservationSupportCounts),
      unknownRows: { observationNoWitness: this.observationNoWitnessRows,
        observationIncomplete: this.observationIncompleteRows,
        baseSafety: this.baseSafetyUnknownRows },
      riskCounts: sparseCounts(this.riskCounts),
      selectedActionCounts: sparseCounts(this.selectedActionCounts),
      samples: this.samples.slice() };
  }
}

module.exports = { BLOCK, SOURCE, UNKNOWN_ORIGIN, PRIMARY, PRIMARY_NAME, BLOCK_NAME,
  SOURCE_NAME, UNKNOWN_ORIGIN_NAME, NoAcceptableCensus };
