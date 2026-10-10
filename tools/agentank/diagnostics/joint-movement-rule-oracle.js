"use strict";

// BP133 keeps evidence authority separate. A pinned local simulator is useful
// as one finite rule world, but it is never promoted to platform truth.

const { NONE_CELL } = require("../../../engine-v2/src/abi/fast-codes");

const EVIDENCE_AUTHORITY = Object.freeze({
  PLATFORM_PROBE_CONFIRMED: "PLATFORM_PROBE_CONFIRMED",
  PLATFORM_REPLAY_CONFIRMED: "PLATFORM_REPLAY_CONFIRMED",
  PINNED_SIMULATOR_ASSUMPTION: "PINNED_SIMULATOR_ASSUMPTION",
  FINITE_VARIANT_UNRESOLVED: "FINITE_VARIANT_UNRESOLVED"
});

const JOINT_GEOMETRY = Object.freeze({
  SAME_TARGET: "SAME_TARGET",
  DIRECT_SWAP: "DIRECT_SWAP",
  VACATED_FOLLOW: "VACATED_FOLLOW",
  STUN_AFFECTED_PARTIAL_PREPARATION: "STUN_AFFECTED_PARTIAL_PREPARATION",
  OTHER_PARTIAL_PREPARATION: "OTHER_PARTIAL_PREPARATION",
  OTHER: "OTHER"
});

function classifyJointGeometry(detail) {
  const start0 = detail.FIRST_FAST_START_CELL0;
  const start1 = detail.FIRST_FAST_START_CELL1;
  const target0 = detail.FIRST_FAST_PREPARED_TARGET0;
  const target1 = detail.FIRST_FAST_PREPARED_TARGET1;
  const complete0 = target0 !== NONE_CELL;
  const complete1 = target1 !== NONE_CELL;
  if (complete0 && complete1) {
    if (target0 === start1 && target1 === start0)
      return JOINT_GEOMETRY.DIRECT_SWAP;
    if (target0 === target1) return JOINT_GEOMETRY.SAME_TARGET;
    if (target0 === start1 || target1 === start0)
      return JOINT_GEOMETRY.VACATED_FOLLOW;
    return JOINT_GEOMETRY.OTHER;
  }
  const effect0 = detail.FIRST_FAST_EFFECT_MASK0 | 0;
  const effect1 = detail.FIRST_FAST_EFFECT_MASK1 | 0;
  if ((effect0 | effect1) & 2)
    return JOINT_GEOMETRY.STUN_AFFECTED_PARTIAL_PREPARATION;
  return JOINT_GEOMETRY.OTHER_PARTIAL_PREPARATION;
}

function createRuleMatrix(official, staticProbe) {
  return [
    { rule: "STATIC_OCCUPIED", authority:
      EVIDENCE_AUTHORITY.PLATFORM_PROBE_CONFIRMED,
    officialSamples: staticProbe.officialEvidence.observedCount,
    platformVerdict: "BLOCK_NO_EFFECT", productionVerdict: "BLOCK_NO_EFFECT" },
    { rule: "VACATED_FOLLOW", authority:
      EVIDENCE_AUTHORITY.PLATFORM_REPLAY_CONFIRMED,
    officialSamples: official.officialHistoricalEvidence.followsVacatedStart,
    seat0Samples: official.officialHistoricalEvidence.seat0Follows,
    seat1Samples: official.officialHistoricalEvidence.seat1Follows,
    platformVerdict: "ALLOW_FOLLOW", productionVerdict: "ALLOW_FOLLOW" },
    { rule: "SAME_TARGET", authority:
      EVIDENCE_AUTHORITY.FINITE_VARIANT_UNRESOLVED,
    officialSamples: official.officialHistoricalEvidence.successfulSameTarget,
    platformVerdict: "UNRESOLVED",
    pinnedSimulatorVerdict: "SEAT0_MOVES_SEAT1_BLOCKED",
    productionVerdict: "FAIL_CLOSED" },
    { rule: "DIRECT_SWAP", authority:
      EVIDENCE_AUTHORITY.FINITE_VARIANT_UNRESOLVED,
    officialSamples: official.officialHistoricalEvidence.successfulSwap,
    platformVerdict: "UNRESOLVED", pinnedSimulatorVerdict: "BLOCK_BOTH",
    productionVerdict: "FAIL_CLOSED" },
    { rule: "STUN_AFFECTED_CONTEST", authority:
      EVIDENCE_AUTHORITY.FINITE_VARIANT_UNRESOLVED,
    officialSamples: 0, platformVerdict: "UNRESOLVED",
    pinnedSimulatorVerdict: "NORMALIZE_CHANCE_THEN_RESOLVE_SEQUENTIALLY",
    productionVerdict: "FAIL_CLOSED" }
  ];
}

module.exports = { EVIDENCE_AUTHORITY, JOINT_GEOMETRY,
  classifyJointGeometry, createRuleMatrix };
