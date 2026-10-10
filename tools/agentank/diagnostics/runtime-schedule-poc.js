#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { loadSimulator, collectCounts } = require("../simulation/paired-arena");
const { ProductionDiagnosticBot } =
  require("../simulation/production-diagnostic-bot");
const { V3DiagnosticBot } = require("../../../engine-v3/src");
const cohortTool = require("./v3-repair-cohort");
const arena = require("./v2-native-initiative-arena");
const { analysisOutcome } = require("./root-counterfactual-labels");
const { RUNTIME_CONFIG, SEARCH_BUDGET } =
  require("../../../engine-v2/src/generated/runtime-config");
const { WORK_KIND } = require("../../../engine-v2/src/abi/cache-runtime-codes");
const { SEARCH_SCHEDULE } = require(
  "../../../engine-v2/src/search/production-depth-search");

const PROFILE = Object.freeze({
  CURRENT: "CURRENT",
  NO_EARLY_EMERGENCY: "NO_EARLY_EMERGENCY",
  PERSISTENT_SHALLOW: "PERSISTENT_SHALLOW",
  NO_SOFT_ESCAPE_SLACK_DOMINANCE: "NO_SOFT_ESCAPE_SLACK_DOMINANCE",
  COMMITTED_ONLY_RISK: "COMMITTED_ONLY_RISK",
  BAND_OFF: "BAND_OFF",
  BAND_OFF_ONCE: "BAND_OFF_ONCE",
  RESOURCE_PULSE: "RESOURCE_PULSE",
  SKILL_PULSE: "SKILL_PULSE",
  PERSISTENT_NAVIGATION: "PERSISTENT_NAVIGATION",
  PERSISTENT_NAVIGATION_TIEBREAK: "PERSISTENT_NAVIGATION_TIEBREAK",
  PERSISTENT_NAVIGATION_SHADOW: "PERSISTENT_NAVIGATION_SHADOW",
  INFORMATION_VALUE_OWNER: "INFORMATION_VALUE_OWNER",
  INFORMATION_VALUE_ONCE: "INFORMATION_VALUE_ONCE",
  POISON_CONTACT_EVIDENCE: "POISON_CONTACT_EVIDENCE",
  DIRECT_INITIATIVE_OWNER: "DIRECT_INITIATIVE_OWNER",
  VISIBLE_PHYSICAL_VALUE: "VISIBLE_PHYSICAL_VALUE",
  LEGACY_INFORMATION_EVIDENCE: "LEGACY_INFORMATION_EVIDENCE",
  NO_INFORMATION_SEARCH: "NO_INFORMATION_SEARCH",
  NO_VALUE_SEARCH: "NO_VALUE_SEARCH",
  INFORMATION_DEPTH_ONE: "INFORMATION_DEPTH_ONE",
  SELECTIVE_GEOMETRY_SHADOW: "SELECTIVE_GEOMETRY_SHADOW",
  SELECTIVE_GEOMETRY_SPARSE: "SELECTIVE_GEOMETRY_SPARSE",
  SELECTIVE_GEOMETRY_SPARSE_C2: "SELECTIVE_GEOMETRY_SPARSE_C2",
  SELECTIVE_GEOMETRY_SPARSE_C4: "SELECTIVE_GEOMETRY_SPARSE_C4",
  SELECTIVE_GEOMETRY_SPARSE_C8: "SELECTIVE_GEOMETRY_SPARSE_C8",
  SELECTIVE_GEOMETRY_ACTIVE_C4: "SELECTIVE_GEOMETRY_ACTIVE_C4",
  DEPTH_TWO_PREFLIGHT_SHADOW: "DEPTH_TWO_PREFLIGHT_SHADOW",
  LOW_BUDGET_FULL_P1_192: "LOW_BUDGET_FULL_P1_192",
  LOW_BUDGET_FULL_P1_192_AUDIT: "LOW_BUDGET_FULL_P1_192_AUDIT",
  STUN_DIRECT_DEPTH_TWO_AUDIT: "STUN_DIRECT_DEPTH_TWO_AUDIT",
  STUN_SELECTIVE_DIRECT_P2_AUDIT: "STUN_SELECTIVE_DIRECT_P2_AUDIT",
  STUN_LEGACY_SCHEDULE_AUDIT: "STUN_LEGACY_SCHEDULE_AUDIT",
  STATIONARY_OCCUPIED_BLOCK_OFF: "STATIONARY_OCCUPIED_BLOCK_OFF",
  THROTTLED_PROOF: "THROTTLED_PROOF",
  COMPACT_DEPTH_TWO: "COMPACT_DEPTH_TWO",
  REVERSE_VIABILITY_CACHE: "REVERSE_VIABILITY_CACHE",
  NO_REVERSE_LATTICE_CACHE: "NO_REVERSE_LATTICE_CACHE",
  REVERSE_LATTICE_CACHE: "REVERSE_LATTICE_CACHE",
  RECALIBRATED_HARD: "RECALIBRATED_HARD",
  FULL_STATE_HAZARD_CACHE: "FULL_STATE_HAZARD_CACHE",
  REVERSE_LATTICE_LAYERS: "REVERSE_LATTICE_LAYERS",
  NO_REVERSE_LATTICE_LAYERS: "NO_REVERSE_LATTICE_LAYERS",
  INFORMATION_ENEMY_THREE: "INFORMATION_ENEMY_THREE",
  MATRIX_HALF: "MATRIX_HALF",
  NODE_BUDGET_576: "NODE_BUDGET_576",
  NODE_BUDGET_620: "NODE_BUDGET_620",
  COMPACT_PHYSICAL_RISK_FRONTIER: "COMPACT_PHYSICAL_RISK_FRONTIER",
  FULL_PHYSICAL_ROOT_DOMAIN: "FULL_PHYSICAL_ROOT_DOMAIN",
  OWNERSHIP_ROUTER_ONLY: "OWNERSHIP_ROUTER_ONLY",
  PVA_CONTROLLER: "PVA_CONTROLLER",
  HP10_VALUE_OWNERSHIP: "HP10_VALUE_OWNERSHIP"
});

function installHP10ValueOwnership(engine) {
  const search = engine && engine.depthSearch;
  if (!search || search.diagnosticHP10ValueOwnershipInstalled) return 0;
  const original = search.search;
  search.diagnosticHP10ValueOwnershipInstalled = 1;
  search.diagnosticHP10SupportSuppressions = 0;
  search.search = function hp10ValueOwnership(...args) {
    const result = original.apply(this, args);
    // HP10's direct path skipped the exact P1 certificate and used width-2 P2,
    // which never owned complete support in these roots.  Suppressing only the
    // new direct-schedule certificate reproduces that value-ownership boundary
    // while keeping physics, Risk, strategy and runtime work identical.
    if (this.lastSchedule === SEARCH_SCHEDULE.DIRECT_DEPTH_TWO) {
      if (this.representativeSupportComplete) this.diagnosticHP10SupportSuppressions += 1;
      this.representativeSupportComplete = 0;
      this.representativeSupportDepth = 0;
      this.representativeSupportExpansionLimit = 0;
    }
    return result;
  };
  return 1;
}

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function booleanOption(name, fallback = false) {
  const raw = option(name, fallback ? "true" : "false").toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  throw new Error(`RUNTIME_POC_BOOLEAN_OPTION:${name}:${raw}`);
}

function profileOptions(profile) {
  if (profile === PROFILE.CURRENT) return {};
  if (profile === PROFILE.COMPACT_PHYSICAL_RISK_FRONTIER)
    return { diagnosticCompactPhysicalRiskFrontier: true };
  if (profile === PROFILE.FULL_PHYSICAL_ROOT_DOMAIN)
    return { diagnosticCompactPhysicalRiskFrontier: false };
  if (profile === PROFILE.HP10_VALUE_OWNERSHIP) return {};
  if (profile === PROFILE.NO_SOFT_ESCAPE_SLACK_DOMINANCE)
    return { softEscapeSlackDominance: false };
  if (profile === PROFILE.COMMITTED_ONLY_RISK)
    return { diagnosticSoftMode: PROFILE.COMMITTED_ONLY_RISK };
  if (profile === PROFILE.PERSISTENT_NAVIGATION)
    return { diagnosticPersistentNavigationPlans: true };
  if (profile === PROFILE.PERSISTENT_NAVIGATION_TIEBREAK)
    return { diagnosticPersistentNavigationPlans: true,
      diagnosticNavigationContinuityMembership: false };
  if (profile === PROFILE.PERSISTENT_NAVIGATION_SHADOW)
    return { diagnosticPersistentNavigationPlans: true,
      diagnosticNavigationContinuitySelection: false };
  if (profile === PROFILE.INFORMATION_VALUE_OWNER)
    return { diagnosticStrategyMode: PROFILE.INFORMATION_VALUE_OWNER,
      diagnosticInformationEvidenceSearch: true };
  if (profile === PROFILE.INFORMATION_VALUE_ONCE)
    return { diagnosticStrategyMode: PROFILE.INFORMATION_VALUE_ONCE,
      diagnosticInformationEvidenceSearch: true };
  if (profile === PROFILE.POISON_CONTACT_EVIDENCE)
    return { diagnosticStrategyMode: PROFILE.POISON_CONTACT_EVIDENCE };
  if (profile === PROFILE.DIRECT_INITIATIVE_OWNER)
    return { diagnosticStrategyMode: PROFILE.DIRECT_INITIATIVE_OWNER };
  if (profile === PROFILE.VISIBLE_PHYSICAL_VALUE)
    return { diagnosticLegacyInformationSearch: true,
      diagnosticInformationEvidenceSearch: true };
  if (profile === PROFILE.LEGACY_INFORMATION_EVIDENCE)
    return { diagnosticInformationEvidenceSearch: true };
  if (profile === PROFILE.NO_INFORMATION_SEARCH)
    return { diagnosticDisableInformationSearch: true };
  if (profile === PROFILE.NO_VALUE_SEARCH)
    return { diagnosticDisablePhysicalSearch: true,
      diagnosticDisableInformationSearch: true };
  if (profile === PROFILE.INFORMATION_DEPTH_ONE)
    return { diagnosticInformationDepthOne: true,
      diagnosticInformationEvidenceSearch: true };
  if (profile === PROFILE.SELECTIVE_GEOMETRY_SHADOW)
    return { diagnosticSelectiveGeometryShadow: true,
      diagnosticSelectiveGeometryRows: 3 };
  if (profile === PROFILE.SELECTIVE_GEOMETRY_SPARSE ||
      profile === PROFILE.SELECTIVE_GEOMETRY_SPARSE_C2 ||
      profile === PROFILE.SELECTIVE_GEOMETRY_SPARSE_C4 ||
      profile === PROFILE.SELECTIVE_GEOMETRY_SPARSE_C8 ||
      profile === PROFILE.SELECTIVE_GEOMETRY_ACTIVE_C4)
    return { diagnosticSelectiveGeometryShadow: true,
      diagnosticSelectiveGeometryRows: 3,
      diagnosticSelectiveGeometryTriggerMask:
        nonNegativeInteger(option("--geometry-trigger-mask", "0"), 0),
      diagnosticSelectiveGeometryTriggerValue:
        nonNegativeInteger(option("--geometry-trigger-value", "0"), 0),
      diagnosticSelectiveGeometryCooldownFrames:
        profile === PROFILE.SELECTIVE_GEOMETRY_SPARSE_C2 ? 2 :
          profile === PROFILE.SELECTIVE_GEOMETRY_SPARSE_C4 ||
            profile === PROFILE.SELECTIVE_GEOMETRY_ACTIVE_C4 ? 4 :
            profile === PROFILE.SELECTIVE_GEOMETRY_SPARSE_C8 ? 8 : 0,
      diagnosticSelectiveGeometryActive:
        profile === PROFILE.SELECTIVE_GEOMETRY_ACTIVE_C4 };
  if (profile === PROFILE.DEPTH_TWO_PREFLIGHT_SHADOW)
    return { diagnosticDepthTwoPreflight: true };
  if (profile === PROFILE.LOW_BUDGET_FULL_P1_192 ||
      profile === PROFILE.LOW_BUDGET_FULL_P1_192_AUDIT)
    return { diagnosticDepthTwoPreflight:
      profile === PROFILE.LOW_BUDGET_FULL_P1_192_AUDIT,
      runtime: { runtimeConfig: {
      ...RUNTIME_CONFIG,
      DIRECT_DEPTH_TWO_MIN_NODE_BUDGET: 192
    }, searchBudget: {
      DECISION_DEPTH: Array.from(SEARCH_BUDGET.DECISION_DEPTH),
      NODE_BUDGET: Array.from(SEARCH_BUDGET.NODE_BUDGET),
      PROOF_BUDGET: Array.from(SEARCH_BUDGET.PROOF_BUDGET),
      MATRIX_ITERATIONS: Array.from(SEARCH_BUDGET.MATRIX_ITERATIONS),
      MATRIX_BATCH: Array.from(SEARCH_BUDGET.MATRIX_BATCH)
    } } };
  if (profile === PROFILE.STUN_DIRECT_DEPTH_TWO_AUDIT)
    return { diagnosticDepthTwoPreflight: true,
      diagnosticDirectDepthTwoDuringStun: true,
      diagnosticDirectDepthTwoStunMaxRootNodes: 512 };
  if (profile === PROFILE.STUN_SELECTIVE_DIRECT_P2_AUDIT)
    return { diagnosticDepthTwoPreflight: true,
      diagnosticDirectDepthTwoDuringStun: true,
      diagnosticDirectDepthTwoStunMaxRootNodes: 48 };
  if (profile === PROFILE.STUN_LEGACY_SCHEDULE_AUDIT)
    return { diagnosticDepthTwoPreflight: true,
      diagnosticDirectDepthTwoDuringStun: false };
  if (profile === PROFILE.STATIONARY_OCCUPIED_BLOCK_OFF)
    return { diagnosticDepthTwoPreflight: true,
      diagnosticStationaryOccupiedBlock: false };
  if (profile === PROFILE.THROTTLED_PROOF)
    return { runtime: { runtimeConfig: RUNTIME_CONFIG, searchBudget: {
      DECISION_DEPTH: Array.from(SEARCH_BUDGET.DECISION_DEPTH),
      NODE_BUDGET: Array.from(SEARCH_BUDGET.NODE_BUDGET),
      PROOF_BUDGET: [64, 48, 32, 0],
      MATRIX_ITERATIONS: Array.from(SEARCH_BUDGET.MATRIX_ITERATIONS),
      MATRIX_BATCH: Array.from(SEARCH_BUDGET.MATRIX_BATCH)
    } } };
  if (profile === PROFILE.COMPACT_DEPTH_TWO)
    return { runtime: { runtimeConfig: RUNTIME_CONFIG, searchBudget: {
      DECISION_DEPTH: [2, 2, 2, 0],
      NODE_BUDGET: [128, 96, 64, 0],
      PROOF_BUDGET: [64, 48, 32, 0],
      MATRIX_ITERATIONS: [48, 32, 16, 0],
      MATRIX_BATCH: [16, 8, 8, 0]
    } } };
  if (profile === PROFILE.REVERSE_VIABILITY_CACHE)
    return { diagnosticReverseViabilityCacheEntries: 64 };
  if (profile === PROFILE.NO_REVERSE_LATTICE_CACHE)
    return { diagnosticReverseLatticeCacheEntries: 0 };
  if (profile === PROFILE.REVERSE_LATTICE_CACHE)
    return { diagnosticReverseLatticeCacheEntries:
      positiveInteger(option("--reverse-lattice-entries", "4"), 4) };
  if (profile === PROFILE.RECALIBRATED_HARD) {
    const workCharges = Array.from(RUNTIME_CONFIG.WORK_CHARGES);
    workCharges[WORK_KIND.HARD] = 40;
    return { runtime: { runtimeConfig: { ...RUNTIME_CONFIG, WORK_CHARGES: workCharges },
      searchBudget: {
        DECISION_DEPTH: Array.from(SEARCH_BUDGET.DECISION_DEPTH),
        NODE_BUDGET: Array.from(SEARCH_BUDGET.NODE_BUDGET),
        PROOF_BUDGET: Array.from(SEARCH_BUDGET.PROOF_BUDGET),
        MATRIX_ITERATIONS: Array.from(SEARCH_BUDGET.MATRIX_ITERATIONS),
        MATRIX_BATCH: Array.from(SEARCH_BUDGET.MATRIX_BATCH)
      } } };
  }
  if (profile === PROFILE.FULL_STATE_HAZARD_CACHE)
    return { diagnosticHazardSignatureCache: false };
  if (profile === PROFILE.REVERSE_LATTICE_LAYERS)
    return { diagnosticReverseLatticeLayerCache: true };
  if (profile === PROFILE.NO_REVERSE_LATTICE_LAYERS)
    return { diagnosticReverseLatticeLayerCache: false };
  if (profile === PROFILE.INFORMATION_ENEMY_THREE)
    return { diagnosticInformationEnemyColumns: 3 };
  if (profile === PROFILE.MATRIX_HALF)
    return { runtime: { runtimeConfig: RUNTIME_CONFIG, searchBudget: {
      DECISION_DEPTH: Array.from(SEARCH_BUDGET.DECISION_DEPTH),
      NODE_BUDGET: Array.from(SEARCH_BUDGET.NODE_BUDGET),
      PROOF_BUDGET: Array.from(SEARCH_BUDGET.PROOF_BUDGET),
      MATRIX_ITERATIONS: [64, 32, 16, 0],
      MATRIX_BATCH: [16, 8, 8, 0]
    } } };
  if (profile === PROFILE.NODE_BUDGET_576 || profile === PROFILE.NODE_BUDGET_620) {
    const capacity = profile === PROFILE.NODE_BUDGET_576 ? 576 : 620;
    const nodeBudget = Array.from(SEARCH_BUDGET.NODE_BUDGET);
    nodeBudget[0] = capacity;
    return { diagnosticNodeCapacity: capacity,
      runtime: { runtimeConfig: RUNTIME_CONFIG, searchBudget: {
        DECISION_DEPTH: Array.from(SEARCH_BUDGET.DECISION_DEPTH),
        NODE_BUDGET: nodeBudget,
        PROOF_BUDGET: Array.from(SEARCH_BUDGET.PROOF_BUDGET),
        MATRIX_ITERATIONS: Array.from(SEARCH_BUDGET.MATRIX_ITERATIONS),
        MATRIX_BATCH: Array.from(SEARCH_BUDGET.MATRIX_BATCH)
      } } };
  }
  if (profile === PROFILE.BAND_OFF ||
      profile === PROFILE.BAND_OFF_ONCE ||
      profile === PROFILE.RESOURCE_PULSE ||
      profile === PROFILE.SKILL_PULSE ||
      profile === PROFILE.OWNERSHIP_ROUTER_ONLY ||
      profile === PROFILE.PVA_CONTROLLER)
    return { diagnosticStrategyMode: profile };
  const runtimeConfig = {
    ...RUNTIME_CONFIG,
    EMERGENCY_ENTER_WORK_UNITS: 800000,
    DEGRADED_ENTER_FRAME: 64,
    FALLBACK_ENTER_FRAME: 100,
    EMERGENCY_ENTER_FRAME: 124
  };
  const searchBudget = profile === PROFILE.PERSISTENT_SHALLOW ? {
    DECISION_DEPTH: [3, 2, 1, 0],
    NODE_BUDGET: [128, 96, 48, 0],
    PROOF_BUDGET: [128, 64, 32, 0],
    MATRIX_ITERATIONS: [48, 32, 16, 0],
    MATRIX_BATCH: [16, 8, 8, 0]
  } : {
    DECISION_DEPTH: Array.from(SEARCH_BUDGET.DECISION_DEPTH),
    NODE_BUDGET: Array.from(SEARCH_BUDGET.NODE_BUDGET),
    PROOF_BUDGET: Array.from(SEARCH_BUDGET.PROOF_BUDGET),
    MATRIX_ITERATIONS: Array.from(SEARCH_BUDGET.MATRIX_ITERATIONS),
    MATRIX_BATCH: Array.from(SEARCH_BUDGET.MATRIX_BATCH)
  };
  return { runtime: { runtimeConfig, searchBudget } };
}

function add(target, source) {
  for (const [key, value] of Object.entries(source || {}))
    target[key] = (target[key] || 0) + value;
}

async function play(module, scenario, candidateSeat, profile) {
  const built = arena.field(module, scenario, candidateSeat);
  const diagnosticMatch = option("--diagnostic-match", "");
  const diagnosticSeat = Number(option("--diagnostic-seat", "-1"));
  const diagnosticFrame = Number(option("--diagnostic-frame", "-1"));
  const captureDecisionRoot = diagnosticMatch === scenario.matchUrlId &&
    diagnosticSeat === candidateSeat && Number.isSafeInteger(diagnosticFrame) &&
    diagnosticFrame >= 0;
  const candidate = new ProductionDiagnosticBot({
    engine: profileOptions(profile),
    captureExceptionalFrames: false,
    captureAllFrames: captureDecisionRoot,
    captureCompactFrames: true,
    captureActionFrames: true,
    captureWorkLedger: booleanOption("--capture-work-ledger", false),
    capturePhaseTiming: booleanOption("--capture-phase-timing", false),
    captureSelectiveInformationProbe:
      booleanOption("--capture-selective-information-probe", false),
    captureInformationSupportProbe:
      booleanOption("--capture-information-support-probe", false),
    captureInformationIntervalOwnershipProbe:
      booleanOption("--capture-information-interval-ownership-probe", false),
    captureSelectiveGeometrySearchProbe:
      booleanOption("--capture-selective-geometry-search-probe", false),
    captureRiskFrontierPhysicalSearchProbe:
      booleanOption("--capture-risk-frontier-physical-search-probe", false),
    selectiveGeometryRows: positiveInteger(option("--selective-geometry-rows", "3"), 3),
    selectiveContenderCount: positiveInteger(option("--selective-contenders", "3"), 3)
  });
  if (profile === PROFILE.HP10_VALUE_OWNERSHIP)
    installHP10ValueOwnership(candidate.engine);
  const control = new V3DiagnosticBot();
  const bots = candidateSeat === 0 ? [candidate, control] : [control, candidate];
  const replay = built.simulator.run(bots[0], bots[1]);
  const counts = collectCounts(replay, candidateSeat);
  const summary = candidate.summary();
  const decisionRoot = captureDecisionRoot ? summary.diagnosticFrames.find(
    frame => frame.frame === diagnosticFrame) || null : null;
  const actionCodes = Buffer.from(summary.compactActionStream, "base64");
  const frameActionBytes = Buffer.alloc(actionCodes.length * 2);
  for (let index = 0; index < actionCodes.length; index += 1) {
    frameActionBytes[index * 2] = summary.actionFrames[index].frame & 0xff;
    frameActionBytes[index * 2 + 1] = actionCodes[index];
  }
  return {
    profile,
    matchUrlId: scenario.matchUrlId,
    scenarioFingerprint: scenario.fingerprint,
    candidateSeat,
    outcome: analysisOutcome(built.simulator, candidateSeat),
    frame: built.simulator.frame,
    reason: built.simulator.result?.reason || "UNKNOWN",
    candidateStars: built.simulator.players[candidateSeat].stars,
    controlStars: built.simulator.players[candidateSeat ^ 1].stars,
    candidateCrashed: Boolean(built.simulator.players[candidateSeat].crashed),
    controlCrashed: Boolean(built.simulator.players[candidateSeat ^ 1].crashed),
    bullets: counts.bullets[candidateSeat],
    bombs: counts.bombs[candidateSeat],
    actions: summary.actionCounts,
    strategyPriority: summary.strategyPriority,
    planLifecycle: summary.planLifecycle,
    actionStream: summary.compactActionStream,
    frameActionStream: frameActionBytes.toString("base64"),
    argumentStream: summary.compactArguments,
    runtimeModeCounts: summary.runtimeModeCounts,
    runtimeSchedule: summary.runtimeSchedule,
    compactPhysicalRiskFrontier: summary.compactPhysicalRiskFrontier,
    reverseViabilityCache: summary.reverseViabilityCache,
    totalRuntimeMicros: summary.totalRuntimeMicros,
    p95RuntimeMicros: summary.p95RuntimeMicros,
    workUnits: summary.accumulatedWorkUnits,
    valueOwnership: {
      complete: summary.layerTotals.completeValueOwners,
      incomplete: summary.layerTotals.incompleteValueOwners,
      evidenceOnly: summary.layerTotals.incompleteValueEvidenceOnly,
      hp10Suppressed: candidate.engine.depthSearch.diagnosticHP10SupportSuppressions || 0
    },
    decisionRoot,
    workLedger: summary.workLedger || null,
    phaseTiming: summary.phaseTiming || null,
    selectiveInformationProbe: summary.selectiveInformationProbe || null,
    informationSupportProbe: summary.informationSupportProbe || null,
    informationIntervalOwnershipProbe:
      summary.informationIntervalOwnershipProbe || null,
    selectiveGeometrySearchProbe: summary.selectiveGeometrySearchProbe || null,
    riskFrontierPhysicalSearchProbe: summary.riskFrontierPhysicalSearchProbe || null,
    selectiveGeometryRuntimeShadow: summary.selectiveGeometryRuntimeShadow || null,
    depthTwoPreflight: summary.depthTwoPreflight || null,
    invariants: {
      avoidableHardReject: summary.layerTotals.avoidableHardRejects,
      riskDominatedSelection: summary.layerTotals.riskDominatedSelections,
      rootRestoreFailure: summary.layerTotals.depthRootRestoreFailures,
      hotAllocation: summary.layerTotals.hotAllocations,
      riskFrontierDomainViolation:
        summary.compactPhysicalRiskFrontier.violations || 0
    }
  };
}

function summarize(matches, profile) {
  const rows = matches.filter(item => item.profile === profile);
  const output = {
    profile,
    matches: rows.length,
    wins: 0,
    losses: 0,
    draws: 0,
    scoreBasisPoints: 0,
    starDelta: 0,
    candidateCrashes: 0,
    controlCrashes: 0,
    bullets: 0,
    bombs: 0,
    actions: {},
    planLifecycle: {},
    runtimeModeCounts: {},
    runtimeSchedule: { firstModeFrames: [[], [], [], []], searchFrames: 0,
      searchNodes: 0, searchAttemptFrames: 0, searchAttemptNodes: 0,
      physicalSearchFrames: 0, physicalSearchNodes: 0,
      selectiveSearchFrames: 0, selectiveSearchNodes: 0,
      informationSearchFrames: 0, informationSearchNodes: 0,
      forcedWinSearchFrames: 0, forcedWinSearchNodes: 0, forcedWinProofs: 0,
      observationSafetyAudits: 0, rootActionTotal: 0, enemyActionTotal: 0,
      hardAllowedActionTotal: 0, searchRootActionTotal: 0,
      searchHardAllowedActionTotal: 0, searchEnemyActionTotal: 0,
      riskAcceptableActionTotal: 0, riskFrontierActionTotal: 0,
      strategySelectedActionTotal: 0,
      searchRiskAcceptableActionTotal: 0, searchRiskFrontierActionTotal: 0,
      searchStrategySelectedActionTotal: 0,
      informationWorldTotal: 0,
      completedDepthCounts: [], physicalValueSupportDepthCounts: [],
      selectiveCompletedDepthCounts: [] },
    compactPhysicalRiskFrontier: { enabled: false, attempts: 0,
      fullRows: 0, compactRows: 0, singleRows: 0, violations: 0 },
    depthTwoPreflight: { enabled: false, roots: 0, impossibleRoots: 0,
      states: 0, projectedNodes: 0, availableNodes: 0,
      p2Attempts: 0, p2Completed: 0, p2ExactCompleted: 0,
      p2CompletedNonExact: 0, p2BudgetInterrupted: 0,
      p2WithExactP1: 0, p2WithoutExactP1: 0,
      p2NonExactWithoutExactP1: 0,
      p2SupportAborted: 0, p2WidthAborted: 0, p2FastAborted: 0,
      p2HardAborted: 0, p2UnclassifiedAborted: 0,
      p2PrincipalBlockedWidth: 0, p2PrincipalBlockedFast: 0,
      p2PrincipalBlockedHard: 0,
      p2FastStatusCounts: [], p2FastActionPairs: [],
      p2TransitionIncomplete: 0, p2OtherFailure: 0,
      scheduleEligible: 0, scheduleBudgetBlocked: 0,
      scheduleStunBlocked: 0, scheduleFireContactBlocked: 0,
      directStunRoots: 0, directStunSizeBlocked: 0, directStunP1Completed: 0,
      directStunP2Completed: 0, directStunP2Failed: 0,
      directStunRootMatrixBuckets: [], directStunP2CompletedBuckets: [],
      directStunExactP2Buckets: [], directStunFailedBuckets: [],
      hotAllocationCount: 0 },
    reverseViabilityCache: { entries: 0, hits: 0, misses: 0,
      latticeEntries: 0, latticeHits: 0, latticeMisses: 0,
      planeRebuilds: 0, planeHits: 0, layerHits: 0, layerMisses: 0 },
    totalRuntimeMicros: 0,
    p95RuntimeMicrosMax: 0,
    workUnits: 0,
    valueOwnership: { complete: 0, incomplete: 0, evidenceOnly: 0, hp10Suppressed: 0 },
    workLedger: { units: {}, calls: {}, totalUnits: 0 },
    phaseTiming: { micros: {}, exclusiveMicros: {}, calls: {}, matrixIterations: 0 },
    selectiveInformationProbe: { contenderCount: 0, attempts: 0,
      shallowComplete: 0, compactComplete: 0, fullWinnerInTop1: 0,
      fullWinnerInTop2: 0, fullWinnerInTop3: 0, selectedInTop3: 0,
      fullWinnerInContenders: 0, selectedInContenders: 0,
      compactWinnerAgreement: 0, rootRestoreFailures: 0, fullNodes: 0,
      shallowNodes: 0, compactNodes: 0, estimatedSharedNodes: 0,
      nodeRatioBasisPoints: 0, hotAllocationCount: 0,
      fullWinnerRankCounts: [], selectedRankCounts: [] },
    informationSupportProbe: { attempts: 0, exactAfterSearch: 0,
      inexactAfterSearch: 0, otherInexact: 0, riskEnvelopeApplications: 0,
      exactLostToRiskEnvelope: 0, lossCounts: {}, maskCounts: {},
      hotAllocationCount: 0 },
    informationIntervalOwnershipProbe: { attempts: 0, exactAttempts: 0,
      inexactAttempts: 0, fullRangeRows: 0, resolvedRows: 0,
      pointEstimateDisagreements: 0, strictDominanceProposals: 0,
      strictDominanceSelected: 0, lossCounts: {}, maskCounts: {},
      policyOnlyRepairableAttempts: 0, policyOnlyRepairableDisagreements: 0,
      policyOnlyRepairableRows: 0,
      hiddenSupportIncompleteAttempts: 0, observationFactIncompleteAttempts: 0,
      geometryCompleteAttempts: 0, geometryCompleteDisagreements: 0,
      geometryCompleteRows: 0,
      hotAllocationCount: 0 },
    selectiveGeometrySearchProbe: { maximumRows: 0, attempts: 0,
      geometrySupportSkips: 0, fullComplete: 0, compactComplete: 0,
      fullRows: 0, compactRows: 0, fullNodes: 0, compactNodes: 0,
      nodeRatioBasisPoints: 0, fullWinnerIncluded: 0,
      compactWinnerAgreement: 0, strictImprovementOpportunities: 0,
      qualifiedFullWinners: 0, qualifiedFullWinnerIncluded: 0,
      qualifiedCompactWinnerAgreement: 0, globalWinnerOutsideRisk: 0,
      strictImprovementAgreements: 0, noSelectedRow: 0,
      singleRowSkips: 0,
      strictImprovementFalsePositives: 0, rowValueComparisons: 0,
      rowValueMismatches: 0, cellValueComparisons: 0,
      cellValueMismatches: 0,
      rootRestoreFailures: 0, widthCounts: [], hotAllocationCount: 0 },
    riskFrontierPhysicalSearchProbe: { attempts: 0, singleRowSkips: 0,
      fullComplete: 0, compactComplete: 0, fullRows: 0, compactRows: 0,
      fullNodes: 0, compactNodes: 0, nodeRatioBasisPoints: 0,
      rowValueComparisons: 0, rowValueMismatches: 0,
      cellValueComparisons: 0, cellValueMismatches: 0,
      winnerComparisons: 0, winnerMismatches: 0,
      rootRestoreFailures: 0, widthCounts: [], hotAllocationCount: 0 },
    selectiveGeometryRuntimeShadow: { enabled: false, active: false, maximumRows: 0,
      triggerMask: 0, triggerValue: 0, cooldownFrames: 0,
      attempts: 0, completed: 0, supportSkips: 0, occupiedSearchSkips: 0,
      runtimeModeSkips: 0, quotaSkips: 0, triggerSkips: 0, cooldownSkips: 0,
      noSelectedRow: 0,
      singleRowSkips: 0, nodes: 0, workUnits: 0, requiredWorkUnits: 0,
      strictImprovementOpportunities: 0, strictImprovementMargin: 0,
      proposalCount: 0, proposalSelectedCount: 0, proposalDisplacedCount: 0,
      proposalActionCount: [], selectedProposalActionCount: [],
      widthCounts: [], featureBuckets: [], hotAllocationCount: 0 },
    invariants: {
      avoidableHardReject: 0,
      riskDominatedSelection: 0,
      rootRestoreFailure: 0,
      hotAllocation: 0,
      riskFrontierDomainViolation: 0
    }
  };
  let scoreUnits = 0;
  for (const row of rows) {
    if (row.outcome === "V2_WIN") {
      output.wins += 1;
      scoreUnits += 2;
    } else if (row.outcome === "V1_WIN") output.losses += 1;
    else {
      output.draws += 1;
      scoreUnits += 1;
    }
    output.starDelta += row.candidateStars - row.controlStars;
    output.candidateCrashes += row.candidateCrashed ? 1 : 0;
    output.controlCrashes += row.controlCrashed ? 1 : 0;
    output.bullets += row.bullets;
    output.bombs += row.bombs;
    add(output.actions, row.actions);
    add(output.planLifecycle, row.planLifecycle);
    add(output.runtimeModeCounts, row.runtimeModeCounts);
    if (row.compactPhysicalRiskFrontier) {
      output.compactPhysicalRiskFrontier.enabled =
        output.compactPhysicalRiskFrontier.enabled || row.compactPhysicalRiskFrontier.enabled;
      output.compactPhysicalRiskFrontier.attempts +=
        row.compactPhysicalRiskFrontier.attempts || 0;
      output.compactPhysicalRiskFrontier.fullRows +=
        row.compactPhysicalRiskFrontier.fullRows || 0;
      output.compactPhysicalRiskFrontier.compactRows +=
        row.compactPhysicalRiskFrontier.compactRows || 0;
      output.compactPhysicalRiskFrontier.singleRows +=
        row.compactPhysicalRiskFrontier.singleRows || 0;
      output.compactPhysicalRiskFrontier.violations +=
        row.compactPhysicalRiskFrontier.violations || 0;
    }
    output.reverseViabilityCache.entries = Math.max(output.reverseViabilityCache.entries,
      row.reverseViabilityCache.entries || 0);
    output.reverseViabilityCache.hits += row.reverseViabilityCache.hits || 0;
    output.reverseViabilityCache.misses += row.reverseViabilityCache.misses || 0;
    output.reverseViabilityCache.latticeEntries = Math.max(
      output.reverseViabilityCache.latticeEntries,
      row.reverseViabilityCache.latticeEntries || 0);
    output.reverseViabilityCache.latticeHits +=
      row.reverseViabilityCache.latticeHits || 0;
    output.reverseViabilityCache.latticeMisses +=
      row.reverseViabilityCache.latticeMisses || 0;
    output.reverseViabilityCache.planeRebuilds +=
      row.reverseViabilityCache.planeRebuilds || 0;
    output.reverseViabilityCache.planeHits +=
      row.reverseViabilityCache.planeHits || 0;
    output.reverseViabilityCache.layerHits +=
      row.reverseViabilityCache.layerHits || 0;
    output.reverseViabilityCache.layerMisses +=
      row.reverseViabilityCache.layerMisses || 0;
    output.runtimeSchedule.searchFrames += row.runtimeSchedule.searchFrames;
    output.runtimeSchedule.searchNodes += row.runtimeSchedule.searchNodes;
    output.runtimeSchedule.searchAttemptFrames += row.runtimeSchedule.searchAttemptFrames;
    output.runtimeSchedule.searchAttemptNodes += row.runtimeSchedule.searchAttemptNodes;
    output.runtimeSchedule.physicalSearchFrames += row.runtimeSchedule.physicalSearchFrames;
    output.runtimeSchedule.physicalSearchNodes += row.runtimeSchedule.physicalSearchNodes;
    output.runtimeSchedule.selectiveSearchFrames += row.runtimeSchedule.selectiveFrames || 0;
    output.runtimeSchedule.selectiveSearchNodes += row.runtimeSchedule.selectiveNodes || 0;
    output.runtimeSchedule.informationSearchFrames +=
      row.runtimeSchedule.informationSearchFrames;
    output.runtimeSchedule.informationSearchNodes +=
      row.runtimeSchedule.informationSearchNodes;
    output.runtimeSchedule.forcedWinSearchFrames +=
      row.runtimeSchedule.forcedWinSearchFrames;
    output.runtimeSchedule.forcedWinSearchNodes +=
      row.runtimeSchedule.forcedWinSearchNodes;
    output.runtimeSchedule.forcedWinProofs += row.runtimeSchedule.forcedWinProofs;
    output.runtimeSchedule.observationSafetyAudits +=
      row.runtimeSchedule.observationSafetyAudits;
    output.runtimeSchedule.rootActionTotal += row.runtimeSchedule.rootActionTotal;
    output.runtimeSchedule.enemyActionTotal += row.runtimeSchedule.enemyActionTotal;
    output.runtimeSchedule.hardAllowedActionTotal +=
      row.runtimeSchedule.hardAllowedActionTotal;
    output.runtimeSchedule.searchRootActionTotal +=
      row.runtimeSchedule.searchRootActionTotal;
    output.runtimeSchedule.searchEnemyActionTotal +=
      row.runtimeSchedule.searchEnemyActionTotal;
    output.runtimeSchedule.searchHardAllowedActionTotal +=
      row.runtimeSchedule.searchHardAllowedActionTotal;
    output.runtimeSchedule.riskAcceptableActionTotal +=
      row.runtimeSchedule.riskAcceptableActionTotal || 0;
    output.runtimeSchedule.riskFrontierActionTotal +=
      row.runtimeSchedule.riskFrontierActionTotal || 0;
    output.runtimeSchedule.strategySelectedActionTotal +=
      row.runtimeSchedule.strategySelectedActionTotal || 0;
    output.runtimeSchedule.searchRiskAcceptableActionTotal +=
      row.runtimeSchedule.searchRiskAcceptableActionTotal || 0;
    output.runtimeSchedule.searchRiskFrontierActionTotal +=
      row.runtimeSchedule.searchRiskFrontierActionTotal || 0;
    output.runtimeSchedule.searchStrategySelectedActionTotal +=
      row.runtimeSchedule.searchStrategySelectedActionTotal || 0;
    output.runtimeSchedule.informationWorldTotal +=
      row.runtimeSchedule.informationWorldTotal;
    for (let mode = 0; mode < row.runtimeSchedule.firstModeFrame.length; mode += 1) {
      const frame = row.runtimeSchedule.firstModeFrame[mode];
      if (frame >= 0) output.runtimeSchedule.firstModeFrames[mode].push(frame);
    }
    for (let depth = 0; depth < row.runtimeSchedule.completedDepthCounts.length; depth += 1)
      output.runtimeSchedule.completedDepthCounts[depth] =
        (output.runtimeSchedule.completedDepthCounts[depth] || 0) +
        row.runtimeSchedule.completedDepthCounts[depth];
    for (let depth = 0;
      depth < (row.runtimeSchedule.physicalValueSupportDepthCounts || []).length;
      depth += 1)
      output.runtimeSchedule.physicalValueSupportDepthCounts[depth] =
        (output.runtimeSchedule.physicalValueSupportDepthCounts[depth] || 0) +
        row.runtimeSchedule.physicalValueSupportDepthCounts[depth];
    for (let depth = 0;
      depth < (row.runtimeSchedule.selectiveCompletedDepthCounts || []).length;
      depth += 1)
      output.runtimeSchedule.selectiveCompletedDepthCounts[depth] =
        (output.runtimeSchedule.selectiveCompletedDepthCounts[depth] || 0) +
        row.runtimeSchedule.selectiveCompletedDepthCounts[depth];
    if (row.depthTwoPreflight) {
      output.depthTwoPreflight.enabled = output.depthTwoPreflight.enabled ||
        row.depthTwoPreflight.enabled;
      output.depthTwoPreflight.roots += row.depthTwoPreflight.roots || 0;
      output.depthTwoPreflight.impossibleRoots +=
        row.depthTwoPreflight.impossibleRoots || 0;
      output.depthTwoPreflight.states += row.depthTwoPreflight.states || 0;
      output.depthTwoPreflight.projectedNodes += row.depthTwoPreflight.projectedNodes || 0;
      output.depthTwoPreflight.availableNodes += row.depthTwoPreflight.availableNodes || 0;
      output.depthTwoPreflight.p2Attempts += row.depthTwoPreflight.p2Attempts || 0;
      output.depthTwoPreflight.p2Completed += row.depthTwoPreflight.p2Completed || 0;
      output.depthTwoPreflight.p2ExactCompleted +=
        row.depthTwoPreflight.p2ExactCompleted || 0;
      output.depthTwoPreflight.p2CompletedNonExact +=
        row.depthTwoPreflight.p2CompletedNonExact || 0;
      output.depthTwoPreflight.p2WithExactP1 +=
        row.depthTwoPreflight.p2WithExactP1 || 0;
      output.depthTwoPreflight.p2WithoutExactP1 +=
        row.depthTwoPreflight.p2WithoutExactP1 || 0;
      output.depthTwoPreflight.p2NonExactWithoutExactP1 +=
        row.depthTwoPreflight.p2NonExactWithoutExactP1 || 0;
      output.depthTwoPreflight.p2BudgetInterrupted +=
        row.depthTwoPreflight.p2BudgetInterrupted || 0;
      output.depthTwoPreflight.p2SupportAborted +=
        row.depthTwoPreflight.p2SupportAborted || 0;
      for (const key of ["p2WidthAborted", "p2FastAborted", "p2HardAborted",
        "p2UnclassifiedAborted", "p2PrincipalBlockedWidth",
        "p2PrincipalBlockedFast", "p2PrincipalBlockedHard"])
        output.depthTwoPreflight[key] += row.depthTwoPreflight[key] || 0;
      for (let status = 0; status < (row.depthTwoPreflight.p2FastStatusCounts || []).length;
        status += 1)
        output.depthTwoPreflight.p2FastStatusCounts[status] =
          (output.depthTwoPreflight.p2FastStatusCounts[status] || 0) +
          row.depthTwoPreflight.p2FastStatusCounts[status];
      for (const pair of row.depthTwoPreflight.p2FastActionPairs || []) {
        let target = output.depthTwoPreflight.p2FastActionPairs.find(item =>
          item[0] === pair[0] && item[1] === pair[1]);
        if (!target) {
          target = [pair[0], pair[1], 0];
          output.depthTwoPreflight.p2FastActionPairs.push(target);
        }
        target[2] += pair[2];
      }
      output.depthTwoPreflight.p2TransitionIncomplete +=
        row.depthTwoPreflight.p2TransitionIncomplete || 0;
      output.depthTwoPreflight.p2OtherFailure +=
        row.depthTwoPreflight.p2OtherFailure || 0;
      output.depthTwoPreflight.scheduleEligible +=
        row.depthTwoPreflight.scheduleEligible || 0;
      output.depthTwoPreflight.scheduleBudgetBlocked +=
        row.depthTwoPreflight.scheduleBudgetBlocked || 0;
      output.depthTwoPreflight.scheduleStunBlocked +=
        row.depthTwoPreflight.scheduleStunBlocked || 0;
      output.depthTwoPreflight.scheduleFireContactBlocked +=
        row.depthTwoPreflight.scheduleFireContactBlocked || 0;
      output.depthTwoPreflight.directStunRoots +=
        row.depthTwoPreflight.directStunRoots || 0;
      output.depthTwoPreflight.directStunSizeBlocked +=
        row.depthTwoPreflight.directStunSizeBlocked || 0;
      output.depthTwoPreflight.directStunP1Completed +=
        row.depthTwoPreflight.directStunP1Completed || 0;
      output.depthTwoPreflight.directStunP2Completed +=
        row.depthTwoPreflight.directStunP2Completed || 0;
      output.depthTwoPreflight.directStunP2Failed +=
        row.depthTwoPreflight.directStunP2Failed || 0;
      for (const key of ["directStunRootMatrixBuckets", "directStunP2CompletedBuckets",
        "directStunExactP2Buckets", "directStunFailedBuckets"])
        for (let bucket = 0; bucket < (row.depthTwoPreflight[key] || []).length; bucket += 1)
          output.depthTwoPreflight[key][bucket] =
            (output.depthTwoPreflight[key][bucket] || 0) + row.depthTwoPreflight[key][bucket];
      output.depthTwoPreflight.hotAllocationCount +=
        row.depthTwoPreflight.hotAllocationCount || 0;
    }
    output.totalRuntimeMicros += row.totalRuntimeMicros;
    output.p95RuntimeMicrosMax = Math.max(output.p95RuntimeMicrosMax,
      row.p95RuntimeMicros);
    output.workUnits += row.workUnits;
    add(output.valueOwnership, row.valueOwnership || {});
    if (row.workLedger) {
      add(output.workLedger.units, row.workLedger.units);
      add(output.workLedger.calls, row.workLedger.calls);
      output.workLedger.totalUnits += row.workLedger.totalUnits;
    }
    if (row.phaseTiming) {
      add(output.phaseTiming.micros, row.phaseTiming.micros);
      add(output.phaseTiming.exclusiveMicros, row.phaseTiming.exclusiveMicros);
      add(output.phaseTiming.calls, row.phaseTiming.calls);
      output.phaseTiming.matrixIterations += row.phaseTiming.matrixIterations || 0;
    }
    if (row.selectiveInformationProbe) {
      const probe = row.selectiveInformationProbe;
      output.selectiveInformationProbe.contenderCount = probe.contenderCount;
      for (const key of ["attempts", "shallowComplete", "compactComplete",
        "fullWinnerInTop1", "fullWinnerInTop2", "fullWinnerInTop3", "selectedInTop3",
        "fullWinnerInContenders", "selectedInContenders",
        "compactWinnerAgreement", "rootRestoreFailures", "fullNodes", "shallowNodes",
        "compactNodes", "estimatedSharedNodes", "hotAllocationCount"])
        output.selectiveInformationProbe[key] += probe[key] || 0;
      for (const key of ["fullWinnerRankCounts", "selectedRankCounts"])
        for (let rank = 0; rank < (probe[key] || []).length; rank += 1)
          output.selectiveInformationProbe[key][rank] =
            (output.selectiveInformationProbe[key][rank] || 0) + probe[key][rank];
      for (const key of ["marginContenderTotal", "marginFullWinnerIncluded",
        "marginSelectedIncluded"]) {
        output.selectiveInformationProbe[key] = output.selectiveInformationProbe[key] || [];
        for (let index = 0; index < (probe[key] || []).length; index += 1)
          output.selectiveInformationProbe[key][index] =
            (output.selectiveInformationProbe[key][index] || 0) + probe[key][index];
      }
      output.selectiveInformationProbe.marginThresholds = probe.marginThresholds || [];
      output.selectiveInformationProbe.depthDeltaAbsoluteTotal =
        (output.selectiveInformationProbe.depthDeltaAbsoluteTotal || 0) +
        (probe.depthDeltaAbsoluteTotal || 0);
      output.selectiveInformationProbe.depthDeltaAbsoluteMaximum = Math.max(
        output.selectiveInformationProbe.depthDeltaAbsoluteMaximum || 0,
        probe.depthDeltaAbsoluteMaximum || 0);
    }
    if (row.informationSupportProbe) {
      const probe = row.informationSupportProbe;
      for (const key of ["attempts", "exactAfterSearch", "inexactAfterSearch",
        "otherInexact", "riskEnvelopeApplications", "exactLostToRiskEnvelope",
        "hotAllocationCount"])
        output.informationSupportProbe[key] += probe[key] || 0;
      add(output.informationSupportProbe.lossCounts, probe.lossCounts);
      add(output.informationSupportProbe.maskCounts, probe.maskCounts);
    }
    if (row.informationIntervalOwnershipProbe) {
      const probe = row.informationIntervalOwnershipProbe;
      for (const key of ["attempts", "exactAttempts", "inexactAttempts",
        "fullRangeRows", "resolvedRows", "pointEstimateDisagreements",
        "policyOnlyRepairableAttempts", "policyOnlyRepairableDisagreements",
        "policyOnlyRepairableRows",
        "hiddenSupportIncompleteAttempts", "observationFactIncompleteAttempts",
        "geometryCompleteAttempts", "geometryCompleteDisagreements",
        "geometryCompleteRows",
        "strictDominanceProposals", "strictDominanceSelected",
        "hotAllocationCount"])
        output.informationIntervalOwnershipProbe[key] += probe[key] || 0;
      add(output.informationIntervalOwnershipProbe.lossCounts, probe.lossCounts);
      add(output.informationIntervalOwnershipProbe.maskCounts, probe.maskCounts);
    }
    if (row.selectiveGeometrySearchProbe) {
      const probe = row.selectiveGeometrySearchProbe;
      output.selectiveGeometrySearchProbe.maximumRows = probe.maximumRows;
      for (const key of ["attempts", "geometrySupportSkips", "fullComplete",
        "compactComplete", "fullRows", "compactRows", "fullNodes", "compactNodes",
        "fullWinnerIncluded", "compactWinnerAgreement",
        "qualifiedFullWinners", "qualifiedFullWinnerIncluded",
        "qualifiedCompactWinnerAgreement", "globalWinnerOutsideRisk",
        "strictImprovementOpportunities", "strictImprovementAgreements",
        "strictImprovementFalsePositives", "rowValueComparisons",
        "rowValueMismatches", "cellValueComparisons", "cellValueMismatches",
        "noSelectedRow", "singleRowSkips", "rootRestoreFailures", "hotAllocationCount"])
        output.selectiveGeometrySearchProbe[key] += probe[key] || 0;
      for (let width = 0; width < (probe.widthCounts || []).length; width += 1)
        output.selectiveGeometrySearchProbe.widthCounts[width] =
          (output.selectiveGeometrySearchProbe.widthCounts[width] || 0) +
          probe.widthCounts[width];
    }
    if (row.riskFrontierPhysicalSearchProbe) {
      const probe = row.riskFrontierPhysicalSearchProbe;
      for (const key of ["attempts", "singleRowSkips", "fullComplete", "compactComplete",
        "fullRows", "compactRows", "fullNodes", "compactNodes",
        "rowValueComparisons", "rowValueMismatches", "cellValueComparisons",
        "cellValueMismatches", "winnerComparisons", "winnerMismatches",
        "rootRestoreFailures", "hotAllocationCount"])
        output.riskFrontierPhysicalSearchProbe[key] += probe[key] || 0;
      for (let width = 0; width < (probe.widthCounts || []).length; width += 1)
        output.riskFrontierPhysicalSearchProbe.widthCounts[width] =
          (output.riskFrontierPhysicalSearchProbe.widthCounts[width] || 0) +
          probe.widthCounts[width];
    }
    if (row.selectiveGeometryRuntimeShadow) {
      const shadow = row.selectiveGeometryRuntimeShadow;
      output.selectiveGeometryRuntimeShadow.enabled =
        output.selectiveGeometryRuntimeShadow.enabled || Boolean(shadow.enabled);
      output.selectiveGeometryRuntimeShadow.active =
        output.selectiveGeometryRuntimeShadow.active || Boolean(shadow.active);
      output.selectiveGeometryRuntimeShadow.maximumRows = Math.max(
        output.selectiveGeometryRuntimeShadow.maximumRows, shadow.maximumRows || 0);
      output.selectiveGeometryRuntimeShadow.triggerMask = shadow.triggerMask || 0;
      output.selectiveGeometryRuntimeShadow.triggerValue = shadow.triggerValue || 0;
      output.selectiveGeometryRuntimeShadow.cooldownFrames = shadow.cooldownFrames || 0;
      for (const key of ["attempts", "completed", "supportSkips",
        "occupiedSearchSkips", "runtimeModeSkips", "quotaSkips", "triggerSkips",
        "cooldownSkips",
        "noSelectedRow",
        "singleRowSkips", "nodes", "workUnits", "requiredWorkUnits",
        "strictImprovementOpportunities", "strictImprovementMargin", "hotAllocationCount"])
        output.selectiveGeometryRuntimeShadow[key] += shadow[key] || 0;
      for (const key of ["proposalCount", "proposalSelectedCount", "proposalDisplacedCount"])
        output.selectiveGeometryRuntimeShadow[key] += shadow[key] || 0;
      for (const key of ["proposalActionCount", "selectedProposalActionCount"])
        for (let action = 0; action < (shadow[key] || []).length; action += 1)
          output.selectiveGeometryRuntimeShadow[key][action] =
            (output.selectiveGeometryRuntimeShadow[key][action] || 0) + shadow[key][action];
      for (let width = 0; width < (shadow.widthCounts || []).length; width += 1)
        output.selectiveGeometryRuntimeShadow.widthCounts[width] =
          (output.selectiveGeometryRuntimeShadow.widthCounts[width] || 0) +
          shadow.widthCounts[width];
      const buckets = output.selectiveGeometryRuntimeShadow.featureBuckets;
      for (const bucket of shadow.featureBuckets || []) {
        let target = buckets.find(item => item.key === bucket.key);
        if (!target) { target = { key: bucket.key, total: 0, positive: 0, nodes: 0 };
          buckets.push(target); }
        target.total += bucket.total || 0; target.positive += bucket.positive || 0;
        target.nodes += bucket.nodes || 0;
      }
    }
    add(output.invariants, row.invariants);
  }
  output.scoreBasisPoints = Math.round(scoreUnits * 5000 /
    Math.max(1, rows.length));
  const probe = output.selectiveInformationProbe;
  probe.nodeRatioBasisPoints = probe.fullNodes > 0 ?
    Math.floor(probe.estimatedSharedNodes * 10000 / probe.fullNodes) : 0;
  const geometry = output.selectiveGeometrySearchProbe;
  geometry.nodeRatioBasisPoints = geometry.fullNodes > 0 ?
    Math.floor(geometry.compactNodes * 10000 / geometry.fullNodes) : 0;
  const physical = output.riskFrontierPhysicalSearchProbe;
  physical.nodeRatioBasisPoints = physical.fullNodes > 0 ?
    Math.floor(physical.compactNodes * 10000 / physical.fullNodes) : 0;
  return output;
}

function compare(matches, baselineProfile, candidateProfile) {
  const baseline = new Map(matches.filter(item =>
    item.profile === baselineProfile).map(item =>
    [`${item.matchUrlId}:${item.candidateSeat}`, item]));
  const transitions = {};
  let positive = 0;
  let negative = 0;
  let same = 0;
  const semanticDifferences = { actionStream: 0, frameActionStream: 0,
    argumentStream: 0, frame: 0, reason: 0, stars: 0 };
  for (const row of matches) {
    if (row.profile !== candidateProfile) continue;
    const before = baseline.get(`${row.matchUrlId}:${row.candidateSeat}`);
    const key = `${before.outcome}->${row.outcome}`;
    transitions[key] = (transitions[key] || 0) + 1;
    const rank = value => value === "V2_WIN" ? 2 : value === "DRAW" ? 1 : 0;
    if (rank(row.outcome) > rank(before.outcome)) positive += 1;
    else if (rank(row.outcome) < rank(before.outcome)) negative += 1;
    else same += 1;
    if (row.actionStream !== before.actionStream) semanticDifferences.actionStream += 1;
    if (row.frameActionStream !== before.frameActionStream)
      semanticDifferences.frameActionStream += 1;
    if (JSON.stringify(row.argumentStream) !== JSON.stringify(before.argumentStream))
      semanticDifferences.argumentStream += 1;
    if (row.frame !== before.frame) semanticDifferences.frame += 1;
    if (row.reason !== before.reason) semanticDifferences.reason += 1;
    if (row.candidateStars !== before.candidateStars ||
        row.controlStars !== before.controlStars) semanticDifferences.stars += 1;
  }
  return { baselineProfile, candidateProfile, positive, negative, same,
    transitions, semanticDifferences };
}

async function run(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const cohortFile = path.resolve(option("--cohort",
    path.join(root, "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const scenarioCount = positiveInteger(option("--scenarios", "8"), 8);
  const offset = Math.max(0, Number(option("--offset", "0")) | 0);
  const outputFile = path.resolve(option("--output",
    "/tmp/agentank-runtime-schedule-poc.json"));
  const requestedProfiles = option("--profiles", [
    PROFILE.CURRENT,
    PROFILE.NO_EARLY_EMERGENCY,
    PROFILE.PERSISTENT_SHALLOW
  ].join(",")).split(",").map(value => value.trim()).filter(Boolean);
  const profiles = Array.from(new Set(requestedProfiles));
  for (const profile of profiles)
    if (!Object.values(PROFILE).includes(profile))
      throw new Error(`RUNTIME_POC_PROFILE_UNKNOWN:${profile}`);
  if (!profiles.includes(PROFILE.CURRENT))
    throw new Error("RUNTIME_POC_CURRENT_PROFILE_REQUIRED");
  const loaded = cohortTool.load(root, cohortFile, role);
  const scenarios = loaded.scenarios.slice(offset, offset + scenarioCount);
  if (scenarios.length !== scenarioCount)
    throw new Error(`RUNTIME_POC_SCENARIO_DENOMINATOR:${scenarios.length}`);
  const simulator = await loadSimulator(root);
  const matches = [];
  for (let index = 0; index < scenarios.length; index += 1) {
    for (const profile of profiles)
      for (let seat = 0; seat < 2; seat += 1)
        matches.push(await play(simulator.module, scenarios[index], seat, profile));
    process.stderr.write(`[runtime-poc] ${index + 1}/${scenarios.length}\n`);
  }
  const summaries = Object.fromEntries(profiles.map(profile =>
    [profile, summarize(matches, profile)]));
  const document = {
    schemaVersion: 1,
    objectKind: "V2_RUNTIME_SCHEDULE_POC_V1",
    role,
    cohortFingerprint: loaded.manifest.fingerprint,
    scenarioOffset: offset,
    scenarioCount,
    physicalMatches: matches.length,
    profiles: Object.fromEntries(profiles.map(profile =>
      [profile, profileOptions(profile)])),
    summaries,
    comparisons: profiles.filter(profile => profile !== PROFILE.CURRENT).map(profile =>
      compare(matches, PROFILE.CURRENT, profile)),
    matches,
    fingerprint: ""
  };
  document.fingerprint = fingerprintObject({ ...document, fingerprint: "" });
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(document, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    outputFile,
    scenarioCount,
    physicalMatches: matches.length,
    summaries,
    comparisons: document.comparisons,
    fingerprint: document.fingerprint
  }, null, 2)}\n`);
  return document;
}

if (require.main === module)
  run().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });

module.exports = {
  PROFILE,
  profileOptions,
  installHP10ValueOwnership,
  summarize,
  compare,
  run
};
