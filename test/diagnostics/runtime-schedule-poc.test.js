"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PROFILE, profileOptions, installHP10ValueOwnership, compare } =
  require("../../tools/agentank/diagnostics/runtime-schedule-poc");
const { RUNTIME_CONFIG, SEARCH_BUDGET } =
  require("../../engine-v2/src/generated/runtime-config");
const { WORK_KIND } = require("../../engine-v2/src/abi/cache-runtime-codes");

test("persistent shallow runtime keeps one search ply before frame-124 emergency", () => {
  const value = profileOptions(PROFILE.PERSISTENT_SHALLOW).runtime;
  assert.deepEqual(value.searchBudget.DECISION_DEPTH, [3, 2, 1, 0]);
  assert.equal(value.runtimeConfig.EMERGENCY_ENTER_FRAME, 124);
  assert.ok(value.runtimeConfig.EMERGENCY_ENTER_WORK_UNITS > 250000);
});

test("soft escape slack Pareto ablation changes only the controller option", () => {
  assert.deepEqual(profileOptions(
    PROFILE.NO_SOFT_ESCAPE_SLACK_DOMINANCE), {
    softEscapeSlackDominance: false
  });
});

test("committed-only profile reuses the preallocated Soft Stack diagnostic view", () => {
  assert.deepEqual(profileOptions(PROFILE.COMMITTED_ONLY_RISK), {
    diagnosticSoftMode: "COMMITTED_ONLY_RISK"
  });
});

test("persistent navigation profile changes only the diagnostic Plan lifecycle option", () => {
  assert.deepEqual(profileOptions(PROFILE.PERSISTENT_NAVIGATION), {
    diagnosticPersistentNavigationPlans: true
  });
});

test("persistent navigation tiebreak keeps continuity out of Strategy membership", () => {
  assert.deepEqual(profileOptions(PROFILE.PERSISTENT_NAVIGATION_TIEBREAK), {
    diagnosticPersistentNavigationPlans: true,
    diagnosticNavigationContinuityMembership: false
  });
});

test("persistent navigation shadow reuses Plan state without selection ownership", () => {
  assert.deepEqual(profileOptions(PROFILE.PERSISTENT_NAVIGATION_SHADOW), {
    diagnosticPersistentNavigationPlans: true,
    diagnosticNavigationContinuitySelection: false
  });
});

test("information value owner is routed through the diagnostic Strategy wrapper", () => {
  assert.deepEqual(profileOptions(PROFILE.INFORMATION_VALUE_OWNER), {
    diagnosticStrategyMode: "INFORMATION_VALUE_OWNER",
    diagnosticInformationEvidenceSearch: true
  });
});

test("information value one-shot is routed through the diagnostic Strategy wrapper", () => {
  assert.deepEqual(profileOptions(PROFILE.INFORMATION_VALUE_ONCE), {
    diagnosticStrategyMode: "INFORMATION_VALUE_ONCE",
    diagnosticInformationEvidenceSearch: true
  });
});

test("poison contact evidence is routed through the diagnostic Strategy wrapper", () => {
  assert.deepEqual(profileOptions(PROFILE.POISON_CONTACT_EVIDENCE), {
    diagnosticStrategyMode: "POISON_CONTACT_EVIDENCE"
  });
});

test("direct initiative owner is routed through the diagnostic Strategy wrapper", () => {
  assert.deepEqual(profileOptions(PROFILE.DIRECT_INITIATIVE_OWNER), {
    diagnosticStrategyMode: "DIRECT_INITIATIVE_OWNER"
  });
});

test("value search routing profiles isolate physical and disabled ownership", () => {
  assert.deepEqual(profileOptions(PROFILE.VISIBLE_PHYSICAL_VALUE), {
    diagnosticLegacyInformationSearch: true,
    diagnosticInformationEvidenceSearch: true
  });
  assert.deepEqual(profileOptions(PROFILE.LEGACY_INFORMATION_EVIDENCE), {
    diagnosticInformationEvidenceSearch: true
  });
  assert.deepEqual(profileOptions(PROFILE.NO_INFORMATION_SEARCH), {
    diagnosticDisableInformationSearch: true
  });
  assert.deepEqual(profileOptions(PROFILE.NO_VALUE_SEARCH), {
    diagnosticDisablePhysicalSearch: true,
    diagnosticDisableInformationSearch: true
  });
  assert.deepEqual(profileOptions(PROFILE.INFORMATION_DEPTH_ONE), {
    diagnosticInformationDepthOne: true,
    diagnosticInformationEvidenceSearch: true
  });
  assert.deepEqual(profileOptions(PROFILE.SELECTIVE_GEOMETRY_SHADOW), {
    diagnosticSelectiveGeometryShadow: true,
    diagnosticSelectiveGeometryRows: 3
  });
  assert.deepEqual(profileOptions(PROFILE.SELECTIVE_GEOMETRY_SPARSE), {
    diagnosticSelectiveGeometryShadow: true,
    diagnosticSelectiveGeometryRows: 3,
    diagnosticSelectiveGeometryTriggerMask: 0,
    diagnosticSelectiveGeometryTriggerValue: 0,
    diagnosticSelectiveGeometryCooldownFrames: 0,
    diagnosticSelectiveGeometryActive: false
  });
  assert.equal(profileOptions(PROFILE.SELECTIVE_GEOMETRY_SPARSE_C2)
    .diagnosticSelectiveGeometryCooldownFrames, 2);
  assert.equal(profileOptions(PROFILE.SELECTIVE_GEOMETRY_SPARSE_C4)
    .diagnosticSelectiveGeometryCooldownFrames, 4);
  assert.equal(profileOptions(PROFILE.SELECTIVE_GEOMETRY_SPARSE_C8)
    .diagnosticSelectiveGeometryCooldownFrames, 8);
  assert.deepEqual(profileOptions(PROFILE.SELECTIVE_GEOMETRY_ACTIVE_C4), {
    diagnosticSelectiveGeometryShadow: true,
    diagnosticSelectiveGeometryRows: 3,
    diagnosticSelectiveGeometryTriggerMask: 0,
    diagnosticSelectiveGeometryTriggerValue: 0,
    diagnosticSelectiveGeometryCooldownFrames: 4,
    diagnosticSelectiveGeometryActive: true
  });
  assert.deepEqual(profileOptions(PROFILE.DEPTH_TWO_PREFLIGHT_SHADOW), {
    diagnosticDepthTwoPreflight: true
  });
  const lowBudgetP1 = profileOptions(PROFILE.LOW_BUDGET_FULL_P1_192).runtime;
  assert.equal(lowBudgetP1.runtimeConfig.DIRECT_DEPTH_TWO_MIN_NODE_BUDGET, 192);
  assert.deepEqual(lowBudgetP1.searchBudget.NODE_BUDGET,
    Array.from(SEARCH_BUDGET.NODE_BUDGET));
  const lowBudgetAudit = profileOptions(PROFILE.LOW_BUDGET_FULL_P1_192_AUDIT);
  assert.equal(lowBudgetAudit.diagnosticDepthTwoPreflight, true);
  assert.equal(lowBudgetAudit.runtime.runtimeConfig.DIRECT_DEPTH_TWO_MIN_NODE_BUDGET, 192);
  assert.deepEqual(profileOptions(PROFILE.STUN_DIRECT_DEPTH_TWO_AUDIT), {
    diagnosticDepthTwoPreflight: true,
    diagnosticDirectDepthTwoDuringStun: true,
    diagnosticDirectDepthTwoStunMaxRootNodes: 512
  });
  assert.deepEqual(profileOptions(PROFILE.STUN_SELECTIVE_DIRECT_P2_AUDIT), {
    diagnosticDepthTwoPreflight: true,
    diagnosticDirectDepthTwoDuringStun: true,
    diagnosticDirectDepthTwoStunMaxRootNodes: 48
  });
  assert.deepEqual(profileOptions(PROFILE.STUN_LEGACY_SCHEDULE_AUDIT), {
    diagnosticDepthTwoPreflight: true,
    diagnosticDirectDepthTwoDuringStun: false
  });
  assert.deepEqual(profileOptions(PROFILE.STATIONARY_OCCUPIED_BLOCK_OFF), {
    diagnosticDepthTwoPreflight: true,
    diagnosticStationaryOccupiedBlock: false
  });
});

test("HP10 value ownership wrapper suppresses only direct-schedule exact certificates", () => {
  const direct = { lastSchedule: 1, representativeSupportComplete: 1,
    representativeSupportDepth: 2, representativeSupportExpansionLimit: 4,
    search() { return 2; } };
  const engine = { depthSearch: direct };
  assert.equal(installHP10ValueOwnership(engine), 1);
  assert.equal(direct.search(), 2);
  assert.equal(direct.representativeSupportComplete, 0);
  assert.equal(direct.representativeSupportDepth, 0);
  assert.equal(direct.representativeSupportExpansionLimit, 0);
  assert.equal(direct.diagnosticHP10SupportSuppressions, 1);
  direct.lastSchedule = 0; direct.representativeSupportComplete = 1;
  direct.representativeSupportDepth = 1; direct.search();
  assert.equal(direct.representativeSupportComplete, 1);
  assert.equal(direct.representativeSupportDepth, 1);
  assert.equal(installHP10ValueOwnership(engine), 0);
});

test("compact search profiles preserve deterministic runtime accounting", () => {
  assert.deepEqual(profileOptions(PROFILE.THROTTLED_PROOF).runtime.searchBudget.PROOF_BUDGET,
    [64, 48, 32, 0]);
  const compact = profileOptions(PROFILE.COMPACT_DEPTH_TWO).runtime;
  assert.deepEqual(compact.searchBudget.DECISION_DEPTH, [2, 2, 2, 0]);
  assert.deepEqual(compact.searchBudget.NODE_BUDGET, [128, 96, 64, 0]);
  assert.equal(compact.runtimeConfig.EMERGENCY_ENTER_WORK_UNITS,
    RUNTIME_CONFIG.EMERGENCY_ENTER_WORK_UNITS);
});

test("HP30 profiles preserve explicit compact/full Physical-domain A/B", () => {
  assert.deepEqual(profileOptions(PROFILE.COMPACT_PHYSICAL_RISK_FRONTIER), {
    diagnosticCompactPhysicalRiskFrontier: true
  });
  assert.deepEqual(profileOptions(PROFILE.FULL_PHYSICAL_ROOT_DOMAIN), {
    diagnosticCompactPhysicalRiskFrontier: false
  });
});

test("reverse viability cache profile changes only the diagnostic cache capacity", () => {
  assert.deepEqual(profileOptions(PROFILE.REVERSE_VIABILITY_CACHE), {
    diagnosticReverseViabilityCacheEntries: 64
  });
  assert.deepEqual(profileOptions(PROFILE.NO_REVERSE_LATTICE_CACHE), {
    diagnosticReverseLatticeCacheEntries: 0
  });
  assert.deepEqual(profileOptions(PROFILE.REVERSE_LATTICE_CACHE), {
    diagnosticReverseLatticeCacheEntries: 4
  });
  const calibrated = profileOptions(PROFILE.RECALIBRATED_HARD).runtime;
  assert.equal(calibrated.runtimeConfig.WORK_CHARGES[WORK_KIND.HARD], 40);
  assert.equal(calibrated.runtimeConfig.WORK_CHARGES[WORK_KIND.FAST_TRANSITION],
    RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.FAST_TRANSITION]);
  assert.deepEqual(calibrated.searchBudget.NODE_BUDGET, [512, 384, 192, 0]);
  assert.deepEqual(profileOptions(PROFILE.FULL_STATE_HAZARD_CACHE), {
    diagnosticHazardSignatureCache: false
  });
  assert.deepEqual(profileOptions(PROFILE.REVERSE_LATTICE_LAYERS), {
    diagnosticReverseLatticeLayerCache: true
  });
  assert.deepEqual(profileOptions(PROFILE.NO_REVERSE_LATTICE_LAYERS), {
    diagnosticReverseLatticeLayerCache: false
  });
  assert.deepEqual(profileOptions(PROFILE.INFORMATION_ENEMY_THREE), {
    diagnosticInformationEnemyColumns: 3
  });
  assert.deepEqual(profileOptions(PROFILE.MATRIX_HALF).runtime.searchBudget.MATRIX_ITERATIONS,
    [64, 32, 16, 0]);
  const node620 = profileOptions(PROFILE.NODE_BUDGET_620);
  assert.equal(node620.diagnosticNodeCapacity, 620);
  assert.deepEqual(node620.runtime.searchBudget.NODE_BUDGET, [620, 384, 192, 0]);
  assert.deepEqual(node620.runtime.searchBudget.DECISION_DEPTH,
    Array.from(SEARCH_BUDGET.DECISION_DEPTH));
  const node576 = profileOptions(PROFILE.NODE_BUDGET_576);
  assert.equal(node576.diagnosticNodeCapacity, 576);
  assert.deepEqual(node576.runtime.searchBudget.NODE_BUDGET, [576, 384, 192, 0]);
});

test("strategy ownership profiles reuse the existing runtime wrappers", () => {
  assert.deepEqual(profileOptions(PROFILE.BAND_OFF), {
    diagnosticStrategyMode: "BAND_OFF"
  });
  assert.deepEqual(profileOptions(PROFILE.BAND_OFF_ONCE), {
    diagnosticStrategyMode: "BAND_OFF_ONCE"
  });
  assert.deepEqual(profileOptions(PROFILE.RESOURCE_PULSE), {
    diagnosticStrategyMode: "RESOURCE_PULSE"
  });
  assert.deepEqual(profileOptions(PROFILE.SKILL_PULSE), {
    diagnosticStrategyMode: "SKILL_PULSE"
  });
  assert.deepEqual(profileOptions(PROFILE.OWNERSHIP_ROUTER_ONLY), {
    diagnosticStrategyMode: "OWNERSHIP_ROUTER_ONLY"
  });
  assert.deepEqual(profileOptions(PROFILE.PVA_CONTROLLER), {
    diagnosticStrategyMode: "PVA_CONTROLLER"
  });
});

test("runtime schedule comparison accounts paired outcome direction", () => {
  const matches = [
    { profile: PROFILE.CURRENT, matchUrlId: "a", candidateSeat: 0,
      outcome: "V1_WIN", actionStream: "a", frameActionStream: "a",
      argumentStream: [], frame: 10, reason: "crash", candidateStars: 0,
      controlStars: 0 },
    { profile: PROFILE.CURRENT, matchUrlId: "b", candidateSeat: 1,
      outcome: "V2_WIN", actionStream: "b", frameActionStream: "b",
      argumentStream: [], frame: 11, reason: "stars", candidateStars: 1,
      controlStars: 0 },
    { profile: PROFILE.PERSISTENT_SHALLOW, matchUrlId: "a", candidateSeat: 0,
      outcome: "DRAW", actionStream: "a", frameActionStream: "a",
      argumentStream: [], frame: 10, reason: "crash", candidateStars: 0,
      controlStars: 0 },
    { profile: PROFILE.PERSISTENT_SHALLOW, matchUrlId: "b", candidateSeat: 1,
      outcome: "V1_WIN", actionStream: "changed", frameActionStream: "changed",
      argumentStream: [[1, 2, 3]], frame: 12, reason: "crash", candidateStars: 0,
      controlStars: 1 }
  ];
  const value = compare(matches, PROFILE.CURRENT,
    PROFILE.PERSISTENT_SHALLOW);
  assert.equal(value.positive, 1);
  assert.equal(value.negative, 1);
  assert.equal(value.same, 0);
  assert.deepEqual(value.semanticDifferences, { actionStream: 1,
    frameActionStream: 1, argumentStream: 1, frame: 1, reason: 1, stars: 1 });
});
