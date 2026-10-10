#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes, sha256Text } = require("../core/hash");
const { loadSimulator, DecisionAudit, collectCounts } =
  require("../simulation/paired-arena");
const { ProductionDiagnosticBot } =
  require("../simulation/production-diagnostic-bot");
const { createHistoricalStarProvider } =
  require("../simulation/historical-scenarios");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");
const { V3DiagnosticBot } = require("../../../engine-v3/src");
const { actionFromLegacy } = require("../../../engine-v3/src/contracts");
const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { OWNERSHIP_STAGE_NAMES } = require("../../../engine-v3/src/ownership-trace");
const cohortTool = require("./v3-repair-cohort");
const componentCohort = require("./v3-component-cohort");
const objectiveOptionCohort = require("./objective-option-cohort");
const strategicAttackCohort = require("./strategic-attack-cohort");
const poisonAttackEventCohort = require("./poison-attack-event-cohort");
const { seedFor } = require("./v1-v3-arena");
const { GEOMETRY, ShotQualityDecisionAudit, collectShotOutcomeRecords,
  summarizeShotRecords } = require("./shot-quality-counterexposure-census");
const { AIM_ACTIVE_MODE, AimSetupPostFireClosureShadow } = require(
  "./aim-setup-post-fire-closure-shadow");
const { DirectClearSafeFirePoc } = require("./direct-clear-safe-fire-poc");
const { VisibleRayAlignmentPoc } = require("./visible-ray-alignment-poc");
const { V1DirectInitiativeTransplantPoc } = require(
  "./v1-direct-initiative-transplant-poc");
const { V1_ORACLE_STAGE, V1StageOracleTransplantPoc } = require(
  "./v1-stage-oracle-transplant-poc");
const { NativeTacticalActionOwnerPoc } = require(
  "./native-tactical-action-owner-poc");
const { NativeBasePolicyActionOwner } = require(
  "../../../engine-v2/src/base-policy/action-owner");
const { NativeBasePolicyActionDomain } = require(
  "../../../engine-v2/src/base-policy/action-domain");
const { NativeBasePolicyStrategicIntent } = require(
  "../../../engine-v2/src/base-policy/strategic-intent");
const { NativeBasePolicyOpponentHistory } = require(
  "../../../engine-v2/src/base-policy/opponent-history");
const { NativeBasePolicySearch } = require(
  "../../../engine-v2/src/base-policy/policy-search");
const { NativeBasePolicyRoot } = require(
  "../../../engine-v2/src/base-policy/native-root");
const { NativeBasePolicyRoot: CompactNativeBasePolicyRoot } = require(
  "../../../engine-v2/src/base-policy-compact/native-root");
const { NativeBasePolicyRoot: SpecializedNativeBasePolicyRoot } = require(
  "../../../engine-v2/src/base-policy-specialized/native-root");
const { NativeOwnSkillActionBridgePoc } = require(
  "./native-own-skill-action-bridge-poc");
const { NativeSelectivePoisonPoc } = require(
  "./native-selective-poison-poc");
const { loadDocuments: loadTerminalOracleDocuments,
  TerminalOracleInterventionPoc } = require(
  "./terminal-oracle-intervention-poc");
const { NativeTerminalTradeAudit } = require(
  "./native-terminal-trade-audit");
const { NativeCandidateForcedWinPoc } = require(
  "./native-candidate-forced-win-poc");
const { NativeSyntheticResourceRootPoc } = require(
  "./native-synthetic-resource-root-poc");
const { NativePoisonResourceOptionPoc } = require(
  "./native-poison-resource-option-poc");
const { NativePoisonAttackEventOptionPoc } = require(
  "./native-poison-attack-event-option-poc");
const { NativePolicyResponseEnvelopePoc } = require(
  "./native-policy-response-envelope-poc");
const { NativeLongOptionEventEnvelopePoc } = require(
  "./native-long-option-event-envelope-poc");
const { NativeLongOptionResponseMassPoc } = require(
  "./native-long-option-response-mass-poc");
const { NativeDualPolicyResponseMassPoc } = require(
  "./native-dual-policy-response-mass-poc");
const { NativeBasePolicyContinuationPoc,
  NativeCombatFirstContinuationPoc } = require(
  "./native-dual-policy-continuation-poc");
const { NativeProgressiveHorizonResponseMassPoc } = require(
  "./native-progressive-horizon-response-mass-poc");
const { NativeTransitionReuseCensusPoc } = require(
  "./native-transition-reuse-census-poc");
const { NativeCanonicalBranchMemoPoc } = require(
  "./native-canonical-branch-memo-poc");
const { NativeStunTurnDomainCompactionPoc } = require(
  "./native-stun-turn-domain-compaction-poc");
const { NativeBudgetFrontierCensusPoc } = require(
  "./native-budget-frontier-census-poc");
const { NativeEnemyResponseOptionCensusPoc } = require(
  "./native-enemy-response-option-poc");
const { NativeEnemyResponsePortfolioCensusPoc } = require(
  "./native-enemy-response-portfolio-poc");
const { NativeSelectiveResponseVerifierPoc } = require(
  "./native-selective-response-verifier-poc");
const { VerifiedAttackProposal } = require("./verified-attack-proposal");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { NativeAttackPosePolicySearchPoc } = require(
  "./native-attack-pose-policy-search-poc");
const { NativePolicyPriorOwnerPoc } = require(
  "./native-policy-prior-owner-poc");
const { NATIVE_RESULT, NativeBasePolicyDifferentialPoc } = require(
  "./native-base-policy-differential-poc");
const { NativeBoundedPolicySearchPoc,
  NativeIterativeCompletePolicySearchPoc } = require(
  "./native-bounded-policy-search-poc");
const { installBasePolicySearchMethodCensus } = require(
  "./base-policy-search-method-census");
const { NativeV1PolicyLeafEvaluatorPoc } = require(
  "./native-v1-policy-leaf-evaluator-poc");
const { NativeV1PathUtilityPoc } = require("./native-v1-path-utility-poc");
const { NativeBasePolicyLeafEvaluator, NativeBasePolicyPathUtility } = require(
  "../../../engine-v2/src/base-policy");
const { ObjectiveEpochActivePoc } = require("./objective-epoch-active-poc");
const { SemanticObjectiveEpochOptionActivePoc } = require(
  "./semantic-objective-epoch-option-active-poc");
const { SemanticAttackPolicyIntervalActivePoc } = require(
  "./semantic-attack-policy-interval-active-poc");
const { instrumentV1DeterministicPolicyOracle } = require(
  "./v1-policy-value-instrumentation");
const { NativeTacticalDomainPoc, NativeTacticalLeafEvaluatorPoc,
  NativeTacticalRaceLeafEvaluatorPoc,
  NativeTacticalRepresentativePoc, NativeTacticalIntentPoc,
  NativeAttackPoseOptionPoc, NativeAttackPoseFeedbackSearchPoc,
  NativeTacticalHistoryPoc } = require(
  "./native-tactical-domain-evaluator-poc");

// Keep reporting hooks at the arena boundary; the deployable owner has no
// diagnostic branches or root-capture allocation.
class NativeBasePolicyActionOwnerArenaAdapter extends NativeBasePolicyActionOwner {
  constructor(options = {}) {
    super(options);
    this.policySearchSupportMode = options.policySearchSupportMode === "exact" ?
      "exact" : options.policySearchSupportMode === "strict" ? "strict" : "all";
    this.policySearchStrictSupportBlockedCount = 0;
  }
  source(engine, count) {
    const source = super.source(engine, count);
    if (!source) return null;
    if (this.policySearchSupportMode === "strict" &&
        !source.lastOwnershipSupportComplete) {
      this.policySearchStrictSupportBlockedCount += 1;
      this.lastSource = null;
      return null;
    }
    if (this.policySearchSupportMode === "exact" && !source.lastValueExact) {
      this.policySearchStrictSupportBlockedCount += 1;
      this.lastSource = null;
      return null;
    }
    return source;
  }
  summary() {
    return { ...super.summary(),
      policySearchStrictSupportBlockedCount:
        this.policySearchStrictSupportBlockedCount };
  }
  annotateCapturedRootOracle() {}
  auditDominatedQualifiedFireAgainstOracle() {}
}

// Oracle comparison belongs to the arena, not the deployable intent kernel.
// BP158 validates the native-owner path, so these hooks intentionally do not
// alter the intent epoch or action membership.
class NativeBasePolicyStrategicIntentArenaAdapter extends
    NativeBasePolicyStrategicIntent {
  setOracle() {}
  clearOracle() {}
  syncOracleRuntime() {}
  summary() {
    return { ...super.summary(), oracleMode: "off",
      oraclePrepareCount: 0, oracleMissingRowCount: 0,
      mappingOracleCompareCount: 0, mappingOracleAgreementCount: 0,
      proposedOracleCompareCount: 0, proposedOracleAgreementCount: 0,
      committedOracleCompareCount: 0, committedOracleAgreementCount: 0,
      oracleContextCompareCount: 0, oracleContextAgreementCount: 0,
      contextMismatchSamples: [], proposedOraclePairs: [],
      committedOraclePairs: [], mappingOraclePairs: [],
      mappingIntentOraclePairs: [] };
  }
}

class NativeBasePolicyOpponentHistoryArenaAdapter extends
    NativeBasePolicyOpponentHistory {
  constructor() {
    super();
    this.oracleCompareCount = 0;
    this.oracleAgreementCount = 0;
    this.oracleMismatchCount = 0;
  }
  compareOracle(census) {
    if (!census?.opponentCounts) return;
    this.oracleCompareCount += 1;
    const blend = Number.isSafeInteger(census.expectationBlendBasisPoints) ?
      census.expectationBlendBasisPoints :
      Math.round((census.expectationBlend || 0) * 10000);
    const equal = this.counts[0] === (census.opponentCounts.GO || 1) &&
      this.counts[1] === (census.opponentCounts.LEFT || 1) &&
      this.counts[2] === (census.opponentCounts.RIGHT || 1) &&
      this.counts[3] === (census.opponentCounts.FIRE || 1) &&
      this.observations === (census.opponentObservations || 0) &&
      this.goStreak === (census.opponentGoStreak || 0) &&
      this.stationaryStreak === (census.enemyStationaryStreak || 0) &&
      this.expectationBlendBasisPoints === blend;
    if (equal) this.oracleAgreementCount += 1;
    else this.oracleMismatchCount += 1;
  }
  summary() {
    return { ...super.summary(), oracleCompareCount: this.oracleCompareCount,
      oracleAgreementCount: this.oracleAgreementCount,
      oracleMismatchCount: this.oracleMismatchCount };
  }
}

const CANDIDATE = Object.freeze({
  CURRENT: "V2_WORKING_CURRENT",
  INITIATIVE: "V2_NATIVE_INITIATIVE",
  NAVIGATION_ONLY: "V2_NATIVE_NAVIGATION_ONLY",
  OBJECTIVE_ATTACK: "V2_OBJECTIVE_ATTACK_FIRST",
  OBJECTIVE_STAR: "V2_OBJECTIVE_STAR_FIRST",
  TACTICAL_PREDICTIVE: "V2_TACTICAL_PREDICTIVE_CONTACT",
  TACTICAL_BOMB: "V2_TACTICAL_BOMB_CONTACT",
  TACTICAL_EXPANDED: "V2_TACTICAL_EXPANDED_CONTACT",
  CONTACT_CENSUS: "V2_CONTACT_CENSUS",
  REFUTED_POSSIBLE_PHYSICAL: "V2_REFUTED_POSSIBLE_PHYSICAL_SEARCH",
  REFUTED_POSSIBLE_PHYSICAL_COMBAT:
    "V2_REFUTED_POSSIBLE_PHYSICAL_COMBAT_SEARCH",
  REFUTED_POSSIBLE_FIRE_VERIFIER:
    "V2_REFUTED_POSSIBLE_FIRE_VERIFIER",
  INFORMATION_VALUE: "V2_INFORMATION_VALUE_EVIDENCE",
  NOMINAL_PHYSICAL: "V2_NOMINAL_PHYSICAL_ROBUST",
  NOMINAL_COMBAT: "V2_NOMINAL_PHYSICAL_COMBAT_ONLY",
  NOMINAL_EVIDENCE: "V2_NOMINAL_PHYSICAL_EVIDENCE_OWNER",
  LEGACY_EARLY_ESCAPE: "V2_LEGACY_EARLY_ESCAPE",
  FINAL_ONLY_RESCUE: "V2_FINAL_ONLY_RESCUE",
  STRICT_FINAL_RESCUE: "V2_STRICT_FINAL_RESCUE",
  VERIFIED_DIRECT_KILL: "V2_VERIFIED_DIRECT_KILL",
  SELECTIVE_CONTINUATION_OFF: "V2_SELECTIVE_CONTINUATION_OFF",
  SELECTIVE_CONTINUATION: "V2_SELECTIVE_CONTINUATION",
  RESIDUAL_ATTACK_PROOF_SHADOW: "V2_RESIDUAL_ATTACK_PROOF_SHADOW",
  STRICT_SAFE_THREAT_FIRE_SHADOW: "V2_STRICT_SAFE_THREAT_FIRE_SHADOW",
  STRICT_SAFE_THREAT_FIRE_ACTIVE: "V2_STRICT_SAFE_THREAT_FIRE_ACTIVE",
  STRICT_DOOMED_FIRE_ACTIVE: "V2_STRICT_DOOMED_FIRE_ACTIVE",
  RESPONSE_OPTION: "V2_RESPONSE_OPTION",
  OPTION_PORTFOLIO_SHADOW: "V2_OPTION_PORTFOLIO_SHADOW",
  OPTION_AWARE_SEARCH_SHADOW: "V2_OPTION_AWARE_SEARCH_SHADOW",
  OPTION_AWARE_SEARCH_ACTIVE: "V2_OPTION_AWARE_SEARCH_ACTIVE",
  OPTION_AWARE_SINGLE_SEARCH: "V2_OPTION_AWARE_SINGLE_SEARCH",
  OPTION_AWARE_TYPED_SINGLE: "V2_OPTION_AWARE_TYPED_SINGLE",
  OPEN_PORTFOLIO_NO_PRIMITIVE: "V2_OPEN_PORTFOLIO_NO_PRIMITIVE",
  OPTION_AWARE_TYPED_OPEN: "V2_OPTION_AWARE_TYPED_OPEN",
  QUALIFIED_OPEN_NO_PRIMITIVE: "V2_QUALIFIED_OPEN_NO_PRIMITIVE",
  OPTION_AWARE_TYPED_QUALIFIED_OPEN: "V2_OPTION_AWARE_TYPED_QUALIFIED_OPEN",
  CONTACT_QUALIFIED_NO_PRIMITIVE: "V2_CONTACT_QUALIFIED_NO_PRIMITIVE",
  OPTION_AWARE_TYPED_CONTACT_QUALIFIED: "V2_OPTION_AWARE_TYPED_CONTACT_QUALIFIED",
  PATH_CONTACT_NO_PRIMITIVE: "V2_PATH_CONTACT_NO_PRIMITIVE",
  PATH_CONTACT_OPTION: "V2_PATH_CONTACT_OPTION",
  PATH_VERIFIED_CONTACT_NO_PRIMITIVE: "V2_PATH_VERIFIED_CONTACT_NO_PRIMITIVE",
  PATH_VERIFIED_CONTACT_OPTION: "V2_PATH_VERIFIED_CONTACT_OPTION",
  INFORMATION_OPTION_INTERVAL_SHADOW: "V2_INFORMATION_OPTION_INTERVAL_SHADOW",
  INFORMATION_OPTION_INTERVAL_ACTIVE: "V2_INFORMATION_OPTION_INTERVAL_ACTIVE",
  INFORMATION_OPTION_TWO_STAGE_SHADOW: "V2_INFORMATION_OPTION_TWO_STAGE_SHADOW",
  INFORMATION_OPTION_TWO_STAGE_ACTIVE: "V2_INFORMATION_OPTION_TWO_STAGE_ACTIVE",
  INFORMATION_OPTION_POSSIBLE_PROJECTILE_SHADOW:
    "V2_INFORMATION_OPTION_POSSIBLE_PROJECTILE_SHADOW",
  NO_ACCEPTABLE_LEGACY: "V2_NO_ACCEPTABLE_LEGACY",
  NO_ACCEPTABLE_POSE: "V2_NO_ACCEPTABLE_POSE",
  NO_ACCEPTABLE_CENSUS: "V2_NO_ACCEPTABLE_CENSUS",
  OBSERVATION_SUPPORT_GUARD: "V2_OBSERVATION_SUPPORT_GUARD",
  OBSERVATION_SUPPORT_INFORMATION_EVIDENCE:
    "V2_OBSERVATION_SUPPORT_INFORMATION_EVIDENCE",
  OBSERVATION_SUPPORT_CONTINUATION_SHADOW:
    "V2_OBSERVATION_SUPPORT_CONTINUATION_SHADOW",
  OBSERVATION_SUPPORT_OPTION_CONTINUATION_SHADOW:
    "V2_OBSERVATION_SUPPORT_OPTION_CONTINUATION_SHADOW",
  CURRENT_OPTION_CONTINUATION_SHADOW:
    "V2_CURRENT_OPTION_CONTINUATION_SHADOW",
  CURRENT_OPTION_CONTINUATION_ACTIVE:
    "V2_CURRENT_OPTION_CONTINUATION_ACTIVE",
  STRICT_TARGET_OPTION_CONTINUATION_SHADOW:
    "V2_STRICT_TARGET_OPTION_CONTINUATION_SHADOW",
  STRICT_TARGET_OPTION_CONTINUATION_ACTIVE:
    "V2_STRICT_TARGET_OPTION_CONTINUATION_ACTIVE",
  DYNAMIC_CONTACT_OPTION_CONTINUATION_SHADOW:
    "V2_DYNAMIC_CONTACT_OPTION_CONTINUATION_SHADOW",
  DYNAMIC_CONTACT_OPTION_CONTINUATION_ACTIVE:
    "V2_DYNAMIC_CONTACT_OPTION_CONTINUATION_ACTIVE",
  POST_RISK_OPTION_CONTINUATION_SHADOW:
    "V2_POST_RISK_OPTION_CONTINUATION_SHADOW",
  POST_RISK_OPTION_CONTINUATION_ACTIVE:
    "V2_POST_RISK_OPTION_CONTINUATION_ACTIVE",
  COMMON_POLICY_OPTION_INTERVAL_SHADOW:
    "V2_COMMON_POLICY_OPTION_INTERVAL_SHADOW",
  COMMON_POLICY_OPTION_INTERVAL_ACTIVE:
    "V2_COMMON_POLICY_OPTION_INTERVAL_ACTIVE",
  ATTACK_FUNNEL_CENSUS: "V2_ATTACK_FUNNEL_CENSUS",
  VERIFIED_ATTACK_PROPOSAL_SHADOW: "V2_VERIFIED_ATTACK_PROPOSAL_SHADOW",
  VERIFIED_ATTACK_PROPOSAL_ACTIVE: "V2_VERIFIED_ATTACK_PROPOSAL_ACTIVE",
  ATTACK_OBJECTIVE_FIELD_SHADOW: "V2_ATTACK_OBJECTIVE_FIELD_SHADOW",
  ATTACK_OBJECTIVE_FIELD_ACTIVE: "V2_ATTACK_OBJECTIVE_FIELD_ACTIVE",
  INFORMATION_OPTION_LEGACY_SETUP_ACTIVE: "V2_INFORMATION_OPTION_LEGACY_SETUP_ACTIVE",
  NO_PRIMITIVE_SEARCH: "V2_NO_PRIMITIVE_SEARCH",
  TERMINAL_PURPOSE_SCOPED: "V2_TERMINAL_PURPOSE_SCOPED",
  NO_RESOURCE_ACTIONS: "V2_NO_RESOURCE_ACTIONS",
  POISON_ELIGIBILITY_ABLATION: "V2_POISON_ELIGIBILITY_ABLATION",
  TERMINAL_ORACLE_INTERVENTION: "V2_TERMINAL_ORACLE_INTERVENTION",
  TYPED_OPTION_PORTFOLIO_SHADOW: "V2_TYPED_OPTION_PORTFOLIO_SHADOW",
  EVENT_DRIVEN_OPTION_SHADOW: "V2_EVENT_DRIVEN_OPTION_SHADOW",
  STABLE_OPTION_LEDGER_SHADOW: "V2_STABLE_OPTION_LEDGER_SHADOW",
  STRATEGIC_STATE_LEDGER_SHADOW: "V2_STRATEGIC_STATE_LEDGER_SHADOW",
  OBJECTIVE_EPOCH_H2_ACTIVE: "V2_OBJECTIVE_EPOCH_H2_ACTIVE",
  OBJECTIVE_EPOCH_H4_ACTIVE: "V2_OBJECTIVE_EPOCH_H4_ACTIVE",
  OBJECTIVE_EPOCH_H8_ACTIVE: "V2_OBJECTIVE_EPOCH_H8_ACTIVE",
  OBJECTIVE_EPOCH_OPTION_ARBITER_SHADOW:
    "V2_OBJECTIVE_EPOCH_OPTION_ARBITER_SHADOW",
  OBJECTIVE_EPOCH_OPTION_INTERVAL_SHADOW:
    "V2_OBJECTIVE_EPOCH_OPTION_INTERVAL_SHADOW",
  SEMANTIC_OBJECTIVE_EPOCH_OPTION_INTERVAL_SHADOW:
    "V2_SEMANTIC_OBJECTIVE_EPOCH_OPTION_INTERVAL_SHADOW",
  SEMANTIC_OBJECTIVE_EPOCH_OPTION_INTERVAL_ACTIVE:
    "V2_SEMANTIC_OBJECTIVE_EPOCH_OPTION_INTERVAL_ACTIVE",
  SEMANTIC_ATTACK_OPTION_COVERAGE_SHADOW:
    "V2_SEMANTIC_ATTACK_OPTION_COVERAGE_SHADOW",
  SEMANTIC_ATTACK_EXECUTION_INTERVAL_SHADOW:
    "V2_SEMANTIC_ATTACK_EXECUTION_INTERVAL_SHADOW",
  SEMANTIC_ATTACK_POLICY_INTERVAL_SHADOW:
    "V2_SEMANTIC_ATTACK_POLICY_INTERVAL_SHADOW",
  SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW:
    "V2_SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW",
  SEMANTIC_ATTACK_COMMON_CONTINUATION_ACTIVE:
    "V2_SEMANTIC_ATTACK_COMMON_CONTINUATION_ACTIVE",
  SEMANTIC_ATTACK_POLICY_INTERVAL_ACTIVE:
    "V2_SEMANTIC_ATTACK_POLICY_INTERVAL_ACTIVE",
  STRATEGIC_CONFLICT_ARBITER_SHADOW: "V2_STRATEGIC_CONFLICT_ARBITER_SHADOW",
  STRATEGIC_TARGET_EXECUTION_SHADOW: "V2_STRATEGIC_TARGET_EXECUTION_SHADOW",
  STRATEGIC_ATTACK_OVER_STAR_SHADOW: "V2_STRATEGIC_ATTACK_OVER_STAR_SHADOW",
  STRATEGIC_ATTACK_OVER_STAR_ACTIVE: "V2_STRATEGIC_ATTACK_OVER_STAR_ACTIVE",
  STRATEGIC_ATTACK_POSSIBLE_RESPONSE_SHADOW:
    "V2_STRATEGIC_ATTACK_POSSIBLE_RESPONSE_SHADOW",
  STRATEGIC_ATTACK_POSSIBLE_RESPONSE_ACTIVE:
    "V2_STRATEGIC_ATTACK_POSSIBLE_RESPONSE_ACTIVE",
  STRATEGIC_ATTACK_MOVE_VARIANT_ENVELOPE_SHADOW:
    "V2_STRATEGIC_ATTACK_MOVE_VARIANT_ENVELOPE_SHADOW",
  PERSISTENT_ATTACK_TARGET_SHADOW: "V2_PERSISTENT_ATTACK_TARGET_SHADOW",
  PERSISTENT_ATTACK_TARGET_ACTIVE: "V2_PERSISTENT_ATTACK_TARGET_ACTIVE",
  PERSISTENT_TARGET_OPTION_SEARCH_SHADOW:
    "V2_PERSISTENT_TARGET_OPTION_SEARCH_SHADOW",
  PERSISTENT_TARGET_OPTION_SEARCH_ACTIVE:
    "V2_PERSISTENT_TARGET_OPTION_SEARCH_ACTIVE",
  STABLE_OPTION_INTERVAL_SHADOW: "V2_STABLE_OPTION_INTERVAL_SHADOW",
  ATTACK_CONTINUATION_PROGRESS_SHADOW:
    "V2_ATTACK_CONTINUATION_PROGRESS_SHADOW",
  ATTACK_SEQUENCE_GENERATOR_SHADOW: "V2_ATTACK_SEQUENCE_GENERATOR_SHADOW",
  ATTACK_POLICY_REACHABILITY_SHADOW: "V2_ATTACK_POLICY_REACHABILITY_SHADOW",
  ATTACK_RESPONSE_SET_SHADOW: "V2_ATTACK_RESPONSE_SET_SHADOW",
  COMBAT_UTILITY_ENVELOPE_SHADOW: "V2_COMBAT_UTILITY_ENVELOPE_SHADOW",
  ATTACK_STAR_POLICY_FRONTIER_SHADOW:
    "V2_ATTACK_STAR_POLICY_FRONTIER_SHADOW",
  RESPONSE_CONDITIONED_OPTION_POLICY_SHADOW:
    "V2_RESPONSE_CONDITIONED_OPTION_POLICY_SHADOW",
  RISK_CONDITIONED_COMBAT_SHADOW: "V2_RISK_CONDITIONED_COMBAT_SHADOW",
  RISK_CONDITIONED_COMBAT_ACTIVE: "V2_RISK_CONDITIONED_COMBAT_ACTIVE",
  RISK_CONDITIONED_RESPONSE_POLICY_ACTIVE:
    "V2_RISK_CONDITIONED_RESPONSE_POLICY_ACTIVE",
  QUALIFIED_ATTACK_OVER_STAR_SHADOW: "V2_QUALIFIED_ATTACK_OVER_STAR_SHADOW",
  QUALIFIED_ATTACK_OVER_STAR_ACTIVE: "V2_QUALIFIED_ATTACK_OVER_STAR_ACTIVE",
  SHOT_QUALITY_CENSUS_SHADOW: "V2_SHOT_QUALITY_COUNTEREXPOSURE_CENSUS_SHADOW",
  AIM_POST_FIRE_CLOSURE_SHADOW: "V2_AIM_SETUP_POST_FIRE_CLOSURE_SHADOW",
  AIM_POST_FIRE_RESCUE_ACTIVE: "V2_AIM_SETUP_POST_FIRE_RESCUE_ACTIVE",
  AIM_POST_FIRE_ALL_ACTIVE: "V2_AIM_SETUP_POST_FIRE_ALL_ACTIVE",
  AIM_POST_FIRE_LONG_RANGE_ACTIVE: "V2_AIM_SETUP_POST_FIRE_LONG_RANGE_ACTIVE",
  AIM_POST_FIRE_LONG_RANGE_FAST_ACTIVE:
    "V2_AIM_SETUP_POST_FIRE_LONG_RANGE_FAST_ACTIVE",
  DIRECT_CLEAR_SAFE_FIRE_ACTIVE: "V2_DIRECT_CLEAR_SAFE_FIRE_ACTIVE",
  VISIBLE_RAY_ALIGNMENT_ACTIVE: "V2_VISIBLE_RAY_ALIGNMENT_ACTIVE",
  V1_DIRECT_INITIATIVE_ACTIVE: "V2_V1_DIRECT_INITIATIVE_TRANSPLANT_ACTIVE",
  V1_DIRECT_ENTRY_OWNERSHIP_CENSUS: "V2_V1_DIRECT_ENTRY_OWNERSHIP_CENSUS",
  V1_DIRECT_STAGE_ORACLE_ACTIVE: "V2_V1_DIRECT_STAGE_ORACLE_ACTIVE",
  V1_TACTICAL_STAGE_ORACLE_ACTIVE: "V2_V1_TACTICAL_STAGE_ORACLE_ACTIVE",
  V1_TACTICAL_STAGE_RISK_ACTIVE: "V2_V1_TACTICAL_STAGE_RISK_ACTIVE",
  NATIVE_TACTICAL_MAXIMIN_ACTIVE: "V2_NATIVE_TACTICAL_MAXIMIN_ACTIVE",
  NATIVE_TACTICAL_COMBAT_MAXIMIN_ACTIVE:
    "V2_NATIVE_TACTICAL_COMBAT_MAXIMIN_ACTIVE",
  NATIVE_TACTICAL_COMPACT_MAXIMIN_ACTIVE:
    "V2_NATIVE_TACTICAL_COMPACT_MAXIMIN_ACTIVE",
  NATIVE_TACTICAL_DOMAIN_ACTIVE: "V2_NATIVE_TACTICAL_DOMAIN_ACTIVE",
  NATIVE_TACTICAL_LEAF_ACTIVE: "V2_NATIVE_TACTICAL_LEAF_ACTIVE",
  NATIVE_TACTICAL_DOMAIN_LEAF_ACTIVE: "V2_NATIVE_TACTICAL_DOMAIN_LEAF_ACTIVE",
  NATIVE_TACTICAL_REPRESENTATIVE_ACTIVE: "V2_NATIVE_TACTICAL_REPRESENTATIVE_ACTIVE",
  NATIVE_TACTICAL_LEAF_REPRESENTATIVE_ACTIVE:
    "V2_NATIVE_TACTICAL_LEAF_REPRESENTATIVE_ACTIVE",
  NATIVE_TACTICAL_LEAF_REPRESENTATIVE_HISTORY_ACTIVE:
    "V2_NATIVE_TACTICAL_LEAF_REPRESENTATIVE_HISTORY_ACTIVE",
  NATIVE_TACTICAL_DEEP_LEAF_REPRESENTATIVE_ACTIVE:
    "V2_NATIVE_TACTICAL_DEEP_LEAF_REPRESENTATIVE_ACTIVE",
  NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_ACTIVE:
    "V2_NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_ACTIVE",
  NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE",
  NATIVE_TACTICAL_RESPONSE_DOMAIN_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_TACTICAL_RESPONSE_DOMAIN_RESOURCE_HISTORY_ACTIVE",
  NATIVE_TACTICAL_RESPONSE_DOMINANCE_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_TACTICAL_RESPONSE_DOMINANCE_RESOURCE_HISTORY_ACTIVE",
  NATIVE_TACTICAL_RACE_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_TACTICAL_RACE_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE",
  NATIVE_TACTICAL_ROBUST_BACKUP_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_TACTICAL_ROBUST_BACKUP_RESOURCE_HISTORY_ACTIVE",
  NATIVE_TACTICAL_OWN_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_TACTICAL_OWN_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE",
  NATIVE_TACTICAL_INTENT_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_TACTICAL_INTENT_RESOURCE_HISTORY_ACTIVE",
  NATIVE_ATTACK_POSE_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_ATTACK_POSE_RESOURCE_HISTORY_ACTIVE",
  NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE",
  NATIVE_ATTACK_POSE_FULL_COVERAGE_ROUTE_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_ATTACK_POSE_FULL_COVERAGE_ROUTE_RESOURCE_HISTORY_ACTIVE",
  NATIVE_ATTACK_POSE_RESPONSE_CONDITIONED_ROUTE_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_ATTACK_POSE_RESPONSE_CONDITIONED_ROUTE_RESOURCE_HISTORY_ACTIVE",
  NATIVE_ATTACK_POSE_RESPONSE_DERIVED_ROUTE_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_ATTACK_POSE_RESPONSE_DERIVED_ROUTE_RESOURCE_HISTORY_ACTIVE",
  NATIVE_ATTACK_POSE_OPTION_FIRST_ROUTE_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_ATTACK_POSE_OPTION_FIRST_ROUTE_RESOURCE_HISTORY_ACTIVE",
  NATIVE_ATTACK_POSE_PERSISTENT_ROUTE_RESOURCE_HISTORY_ACTIVE:
    "V2_NATIVE_ATTACK_POSE_PERSISTENT_ROUTE_RESOURCE_HISTORY_ACTIVE",
  NATIVE_POLICY_PRIOR_ACTIVE: "V2_NATIVE_POLICY_PRIOR_ACTIVE",
  NATIVE_BASE_POLICY_DIFFERENTIAL_ORACLE_ACTIVE:
    "V2_NATIVE_BASE_POLICY_DIFFERENTIAL_ORACLE_ACTIVE",
  NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE:
    "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE"
});

const FROZEN_V1_FILE = path.resolve(__dirname, "../../../tiny-tank-minimax.js");
const FROZEN_V1_SOURCE = fs.readFileSync(FROZEN_V1_FILE, "utf8");
const INSTRUMENTED_V1_POLICY_SOURCE =
  instrumentV1DeterministicPolicyOracle(FROZEN_V1_SOURCE);
const FROZEN_V1_SHA256 = sha256Text(FROZEN_V1_SOURCE);

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function positiveIntegerOption(name, fallback) {
  const value = Number(option(name, fallback));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function enumOption(name, fallback, allowed, errorCode) {
  const value = option(name, fallback);
  if (!allowed.includes(value)) throw new Error(`${errorCode}:${value}`);
  return value;
}

function engineOptions(kind) {
  if (kind === CANDIDATE.NATIVE_TACTICAL_MAXIMIN_ACTIVE) return {
    diagnosticVisibleNominalPhysicalSearch: true
  };
  if (kind === CANDIDATE.NATIVE_TACTICAL_DEEP_LEAF_REPRESENTATIVE_ACTIVE) return {
    diagnosticVisibleNominalPhysicalSearch: true
  };
  if (kind === CANDIDATE.NATIVE_TACTICAL_COMBAT_MAXIMIN_ACTIVE) return {
    diagnosticVisibleNominalPhysicalSearch: true,
    diagnosticNominalPhysicalCombatOnly: true
  };
  if (kind === CANDIDATE.NATIVE_TACTICAL_COMPACT_MAXIMIN_ACTIVE ||
      kind === CANDIDATE.NATIVE_BASE_POLICY_DIFFERENTIAL_ORACLE_ACTIVE ||
      kind === CANDIDATE.NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_DOMAIN_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_DOMAIN_LEAF_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_REPRESENTATIVE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMAIN_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMINANCE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RACE_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_ROBUST_BACKUP_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_OWN_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_INTENT_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_FULL_COVERAGE_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_CONDITIONED_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_DERIVED_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_OPTION_FIRST_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_PERSISTENT_ROUTE_RESOURCE_HISTORY_ACTIVE) return {
    diagnosticVisibleNominalPhysicalSearch: true,
    diagnosticDisableStageMatrix: true,
    diagnosticDisableResourceActions:
      option("--bounded-policy-resource-domain", "on") === "off",
    diagnosticExpandedTacticalContactMask:
      Number(option("--bounded-policy-tactical-contact-mask", "0")) | 0,
    diagnosticChanceCompleteEscapeObligation:
      option("--bounded-policy-chance-complete-escape", "off") === "on",
    diagnosticUniformChanceMass:
      option("--bounded-policy-own-chance-mass", "worst") === "support-uniform",
    diagnosticChanceSurvivalMass:
      option("--bounded-policy-chance-survival-mass", "off") === "support-uniform",
    diagnosticChanceSurvivalRisk:
      option("--bounded-policy-chance-survival-risk", "off") === "active",
    diagnosticPersistentEscapePlan:
      option("--bounded-policy-persistent-escape", "off") === "active",
    diagnosticContactSearchWithinEscape:
      option("--bounded-policy-contact-search-within-escape",
        option("--bounded-policy-escape-constraint-only", "off")) === "on",
    runtime: { searchBudget: {
      DECISION_DEPTH: [3, 2, 1, 0], NODE_BUDGET: [128, 96, 48, 0],
      PROOF_BUDGET: [128, 64, 32, 0], MATRIX_ITERATIONS: [0, 0, 0, 0],
      MATRIX_BATCH: [0, 0, 0, 0]
    } },
  };
  if (kind === CANDIDATE.NO_ACCEPTABLE_LEGACY) return {
    diagnosticLegacyNoAcceptablePoseFallback: true
  };
  if (kind === CANDIDATE.NO_ACCEPTABLE_POSE) return {};
  if (kind === CANDIDATE.NO_ACCEPTABLE_CENSUS) return {};
  if (kind === CANDIDATE.OBSERVATION_SUPPORT_GUARD) return {
    diagnosticSoftMode: "INCOMPLETE_OBSERVATION_FRONTIER_BYPASS"
  };
  if (kind === CANDIDATE.OBSERVATION_SUPPORT_INFORMATION_EVIDENCE) return {
    diagnosticSoftMode: "INCOMPLETE_OBSERVATION_FRONTIER_BYPASS",
    diagnosticInformationEvidenceSearch: true,
    diagnosticSoftSearchProposalEvidence: true
  };
  if (kind === CANDIDATE.OBSERVATION_SUPPORT_CONTINUATION_SHADOW) return {
    diagnosticSoftMode: "INCOMPLETE_OBSERVATION_FRONTIER_BYPASS",
    diagnosticActionContinuationEnvelope: true,
    diagnosticActionContinuationDepth: positiveIntegerOption("--continuation-depth", 3),
    diagnosticActionContinuationNodeBudget:
      positiveIntegerOption("--continuation-budget", 768),
    diagnosticActionContinuationCooldownFrames:
      positiveIntegerOption("--continuation-cooldown", 4)
  };
  if (kind === CANDIDATE.OBSERVATION_SUPPORT_OPTION_CONTINUATION_SHADOW) return {
    diagnosticSoftMode: "INCOMPLETE_OBSERVATION_FRONTIER_BYPASS",
    diagnosticTypedOptionPortfolio: true,
    diagnosticActionContinuationEnvelope: true,
    diagnosticActionContinuationOptionAware: true,
    diagnosticActionContinuationDepth: positiveIntegerOption("--continuation-depth", 3),
    diagnosticActionContinuationNodeBudget:
      positiveIntegerOption("--continuation-budget", 768),
    diagnosticActionContinuationCooldownFrames:
      positiveIntegerOption("--continuation-cooldown", 4)
  };
  if (kind === CANDIDATE.CURRENT_OPTION_CONTINUATION_SHADOW) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticActionContinuationEnvelope: true,
    diagnosticActionContinuationOptionAware: true,
    diagnosticActionContinuationDepth: positiveIntegerOption("--continuation-depth", 2),
    diagnosticActionContinuationNodeBudget:
      positiveIntegerOption("--continuation-budget", 768),
    diagnosticActionContinuationCooldownFrames:
      positiveIntegerOption("--continuation-cooldown", 4)
  };
  if (kind === CANDIDATE.CURRENT_OPTION_CONTINUATION_ACTIVE) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticActionContinuationEnvelope: true,
    diagnosticActionContinuationOptionAware: true,
    diagnosticActionContinuationActive: true,
    diagnosticActionContinuationDepth: positiveIntegerOption("--continuation-depth", 2),
    diagnosticActionContinuationNodeBudget:
      positiveIntegerOption("--continuation-budget", 768),
    diagnosticActionContinuationCooldownFrames:
      positiveIntegerOption("--continuation-cooldown", 4)
  };
  if (kind === CANDIDATE.STRICT_TARGET_OPTION_CONTINUATION_SHADOW) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticActionContinuationEnvelope: true,
    diagnosticActionContinuationOptionAware: true,
    diagnosticActionContinuationStrictTargetOwnership: true,
    diagnosticActionContinuationDepth: positiveIntegerOption("--continuation-depth", 2),
    diagnosticActionContinuationNodeBudget:
      positiveIntegerOption("--continuation-budget", 768),
    diagnosticActionContinuationCooldownFrames:
      positiveIntegerOption("--continuation-cooldown", 4)
  };
  if (kind === CANDIDATE.STRICT_TARGET_OPTION_CONTINUATION_ACTIVE) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticActionContinuationEnvelope: true,
    diagnosticActionContinuationOptionAware: true,
    diagnosticActionContinuationStrictTargetOwnership: true,
    diagnosticActionContinuationActive: true,
    diagnosticActionContinuationDepth: positiveIntegerOption("--continuation-depth", 2),
    diagnosticActionContinuationNodeBudget:
      positiveIntegerOption("--continuation-budget", 768),
    diagnosticActionContinuationCooldownFrames:
      positiveIntegerOption("--continuation-cooldown", 4)
  };
  if (kind === CANDIDATE.DYNAMIC_CONTACT_OPTION_CONTINUATION_SHADOW) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticActionContinuationEnvelope: true,
    diagnosticActionContinuationOptionAware: true,
    diagnosticActionContinuationStrictTargetOwnership: true,
    diagnosticActionContinuationDynamicContactTarget: true,
    diagnosticActionContinuationDepth: positiveIntegerOption("--continuation-depth", 2),
    diagnosticActionContinuationNodeBudget:
      positiveIntegerOption("--continuation-budget", 768),
    diagnosticActionContinuationCooldownFrames:
      positiveIntegerOption("--continuation-cooldown", 4)
  };
  if (kind === CANDIDATE.DYNAMIC_CONTACT_OPTION_CONTINUATION_ACTIVE) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticActionContinuationEnvelope: true,
    diagnosticActionContinuationOptionAware: true,
    diagnosticActionContinuationStrictTargetOwnership: true,
    diagnosticActionContinuationDynamicContactTarget: true,
    diagnosticActionContinuationActive: true,
    diagnosticActionContinuationDepth: positiveIntegerOption("--continuation-depth", 2),
    diagnosticActionContinuationNodeBudget:
      positiveIntegerOption("--continuation-budget", 768),
    diagnosticActionContinuationCooldownFrames:
      positiveIntegerOption("--continuation-cooldown", 4)
  };
  if (kind === CANDIDATE.POST_RISK_OPTION_CONTINUATION_SHADOW ||
      kind === CANDIDATE.POST_RISK_OPTION_CONTINUATION_ACTIVE) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticActionContinuationEnvelope: true,
    diagnosticActionContinuationOptionAware: true,
    diagnosticActionContinuationStrictTargetOwnership: true,
    diagnosticActionContinuationDynamicContactTarget: true,
    diagnosticActionContinuationPostRiskArbitration: true,
    diagnosticActionContinuationActive:
      kind === CANDIDATE.POST_RISK_OPTION_CONTINUATION_ACTIVE,
    diagnosticActionContinuationDepth: positiveIntegerOption("--continuation-depth", 2),
    diagnosticActionContinuationNodeBudget:
      positiveIntegerOption("--continuation-budget", 768),
    diagnosticActionContinuationCooldownFrames:
      positiveIntegerOption("--continuation-cooldown", 4)
  };
  if (kind === CANDIDATE.COMMON_POLICY_OPTION_INTERVAL_SHADOW ||
      kind === CANDIDATE.COMMON_POLICY_OPTION_INTERVAL_ACTIVE) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticCommonPolicyOptionInterval: true,
    diagnosticCommonPolicyOptionActive:
      kind === CANDIDATE.COMMON_POLICY_OPTION_INTERVAL_ACTIVE,
    diagnosticCommonPolicyOptionRoots: positiveIntegerOption("--interval-roots", 3),
    diagnosticCommonPolicyOptionNodeBudget:
      positiveIntegerOption("--interval-budget", 2048)
  };
  if (kind === CANDIDATE.SELECTIVE_CONTINUATION_OFF) return {
    diagnosticSelectiveContinuation: false
  };
  if (kind === CANDIDATE.SELECTIVE_CONTINUATION) return {
    diagnosticSelectiveContinuation: true
  };
  if (kind === CANDIDATE.INITIATIVE) return { nativeInitiativeEnabled: true };
  if (kind === CANDIDATE.NAVIGATION_ONLY) return {
    nativeNavigationOnlyEnabled: true
  };
  if (kind === CANDIDATE.OBJECTIVE_ATTACK) return {
    diagnosticObjectiveOptionProfile: 1
  };
  if (kind === CANDIDATE.OBJECTIVE_STAR) return {
    diagnosticObjectiveOptionProfile: 2
  };
  if (kind === CANDIDATE.TACTICAL_PREDICTIVE) return {
    diagnosticExpandedTacticalContactMask: 4
  };
  if (kind === CANDIDATE.TACTICAL_BOMB) return {
    diagnosticExpandedTacticalContactMask: 2
  };
  if (kind === CANDIDATE.TACTICAL_EXPANDED) return {
    diagnosticExpandedTacticalContactMask: 7
  };
  if (kind === CANDIDATE.INFORMATION_VALUE) return {
    diagnosticInformationEvidenceSearch: true
  };
  if (kind === CANDIDATE.REFUTED_POSSIBLE_PHYSICAL) return {
    diagnosticRefutedPossiblePhysicalSearch: true
  };
  if (kind === CANDIDATE.REFUTED_POSSIBLE_PHYSICAL_COMBAT) return {
    diagnosticRefutedPossiblePhysicalSearch: true,
    diagnosticRefutedPossiblePhysicalCombatOnly: true
  };
  if (kind === CANDIDATE.REFUTED_POSSIBLE_FIRE_VERIFIER) return {
    diagnosticRefutedPossiblePhysicalSearch: true,
    diagnosticRefutedPossiblePhysicalCombatOnly: true,
    diagnosticRefutedPossiblePhysicalVerifierOnly: true
  };
  if (kind === CANDIDATE.NOMINAL_PHYSICAL) return {
    diagnosticVisibleNominalPhysicalSearch: true
  };
  if (kind === CANDIDATE.NOMINAL_COMBAT) return {
    diagnosticVisibleNominalPhysicalSearch: true,
    diagnosticNominalPhysicalCombatOnly: true
  };
  if (kind === CANDIDATE.NOMINAL_EVIDENCE) return {
    diagnosticVisibleNominalPhysicalSearch: true,
    diagnosticNominalPhysicalCombatOnly: true,
    diagnosticNominalPhysicalEvidenceOnly: true,
    diagnosticNominalPhysicalEvidenceOwner: true
  };
  if (kind === CANDIDATE.RESPONSE_OPTION) return {
    diagnosticResponseOptionEnabled: true
  };
  if (kind === CANDIDATE.OPTION_PORTFOLIO_SHADOW) return {
    diagnosticOptionPortfolioShadow: true
  };
  if (kind === CANDIDATE.OPTION_AWARE_SEARCH_SHADOW) return {
    diagnosticOptionAwareSearchShadow: true,
    diagnosticOptionAwareSearchDepth: positiveIntegerOption("--option-depth", 2),
    diagnosticOptionAwareSearchNodeBudget: positiveIntegerOption("--option-budget", 768)
  };
  if (kind === CANDIDATE.OPTION_AWARE_SEARCH_ACTIVE) return {
    diagnosticOptionAwareSearchActive: true,
    diagnosticOptionAwareSearchDepth: positiveIntegerOption("--option-depth", 2),
    diagnosticOptionAwareSearchNodeBudget: positiveIntegerOption("--option-budget", 768)
  };
  if (kind === CANDIDATE.OPTION_AWARE_SINGLE_SEARCH) return {
    diagnosticOptionAwareSingleSearch: true,
    diagnosticOptionAwareSearchDepth: positiveIntegerOption("--option-depth", 2),
    diagnosticOptionAwareSearchNodeBudget: positiveIntegerOption("--option-budget", 768)
  };
  if (kind === CANDIDATE.OPTION_AWARE_TYPED_SINGLE) return {
    diagnosticOptionAwareSingleSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticOptionAwareSearchDepth: positiveIntegerOption("--option-depth", 2),
    diagnosticOptionAwareSearchNodeBudget: positiveIntegerOption("--option-budget", 768)
  };
  if (kind === CANDIDATE.OPEN_PORTFOLIO_NO_PRIMITIVE) return {
    diagnosticDisablePhysicalSearch: true,
    diagnosticOpenStrategyPortfolio: true
  };
  if (kind === CANDIDATE.OPTION_AWARE_TYPED_OPEN) return {
    diagnosticOptionAwareSingleSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticOpenStrategyPortfolio: true,
    diagnosticOptionAwareSearchDepth: positiveIntegerOption("--option-depth", 2),
    diagnosticOptionAwareSearchNodeBudget: positiveIntegerOption("--option-budget", 768)
  };
  if (kind === CANDIDATE.QUALIFIED_OPEN_NO_PRIMITIVE) return {
    diagnosticDisablePhysicalSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticOpenQualifiedStrategyPortfolio: true
  };
  if (kind === CANDIDATE.OPTION_AWARE_TYPED_QUALIFIED_OPEN) return {
    diagnosticOptionAwareSingleSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticOpenQualifiedStrategyPortfolio: true,
    diagnosticOptionAwareSearchDepth: positiveIntegerOption("--option-depth", 2),
    diagnosticOptionAwareSearchNodeBudget: positiveIntegerOption("--option-budget", 768)
  };
  if (kind === CANDIDATE.CONTACT_QUALIFIED_NO_PRIMITIVE) return {
    diagnosticDisablePhysicalSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticContactQualifiedStrategyPortfolio: true
  };
  if (kind === CANDIDATE.OPTION_AWARE_TYPED_CONTACT_QUALIFIED) return {
    diagnosticOptionAwareSingleSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticContactQualifiedStrategyPortfolio: true,
    diagnosticOptionAwareSearchDepth: positiveIntegerOption("--option-depth", 2),
    diagnosticOptionAwareSearchNodeBudget: positiveIntegerOption("--option-budget", 768)
  };
  if (kind === CANDIDATE.PATH_CONTACT_NO_PRIMITIVE) return {
    diagnosticDisablePhysicalSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticContactQualifiedStrategyPortfolio: true,
    diagnosticStrategicPathOwner: true
  };
  if (kind === CANDIDATE.PATH_CONTACT_OPTION) return {
    diagnosticOptionAwareSingleSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticContactQualifiedStrategyPortfolio: true,
    diagnosticStrategicPathOwner: true,
    diagnosticOptionAwareSearchDepth: positiveIntegerOption("--option-depth", 2),
    diagnosticOptionAwareSearchNodeBudget: positiveIntegerOption("--option-budget", 768)
  };
  if (kind === CANDIDATE.PATH_VERIFIED_CONTACT_NO_PRIMITIVE) return {
    diagnosticDisablePhysicalSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticContactQualifiedStrategyPortfolio: true,
    diagnosticStrategicPathOwner: true,
    diagnosticStrategicPathVerification: true
  };
  if (kind === CANDIDATE.PATH_VERIFIED_CONTACT_OPTION) return {
    diagnosticOptionAwareSingleSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticContactQualifiedStrategyPortfolio: true,
    diagnosticStrategicPathOwner: true,
    diagnosticStrategicPathVerification: true,
    diagnosticOptionAwareSearchDepth: positiveIntegerOption("--option-depth", 2),
    diagnosticOptionAwareSearchNodeBudget: positiveIntegerOption("--option-budget", 768)
  };
  if (kind === CANDIDATE.INFORMATION_OPTION_INTERVAL_SHADOW) return {
    diagnosticDisablePhysicalSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticContactQualifiedStrategyPortfolio: true,
    diagnosticInformationOptionIntervalShadow: true,
    diagnosticInformationOptionIntervalNodeBudget:
      positiveIntegerOption("--information-option-budget", 384)
  };
  if (kind === CANDIDATE.INFORMATION_OPTION_TWO_STAGE_SHADOW) return {
    diagnosticDisablePhysicalSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticContactQualifiedStrategyPortfolio: true,
    diagnosticInformationOptionIntervalShadow: true,
    diagnosticTwoStageAttackSetupShadow: true,
    diagnosticInformationOptionIntervalNodeBudget:
      positiveIntegerOption("--information-option-budget", 384)
  };
  if (kind === CANDIDATE.INFORMATION_OPTION_TWO_STAGE_ACTIVE) return {
    diagnosticDisablePhysicalSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticContactQualifiedStrategyPortfolio: true,
    diagnosticInformationOptionIntervalActive: true,
    diagnosticTwoStageAttackSetupShadow: true,
    diagnosticTwoStageAttackSetupActive: true,
    diagnosticInformationOptionIntervalNodeBudget:
      positiveIntegerOption("--information-option-budget", 384)
  };
  if (kind === CANDIDATE.INFORMATION_OPTION_POSSIBLE_PROJECTILE_SHADOW) return {
    diagnosticDisablePhysicalSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticContactQualifiedStrategyPortfolio: true,
    diagnosticInformationOptionIntervalShadow: true,
    diagnosticTwoStageAttackSetupShadow: true,
    diagnosticPossibleProjectileAttackSetupShadow: true,
    diagnosticInformationOptionIntervalNodeBudget:
      positiveIntegerOption("--information-option-budget", 384)
  };
  if (kind === CANDIDATE.INFORMATION_OPTION_INTERVAL_ACTIVE) return {
    diagnosticDisablePhysicalSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticContactQualifiedStrategyPortfolio: true,
    diagnosticInformationOptionIntervalActive: true,
    diagnosticInformationOptionIntervalNodeBudget:
      positiveIntegerOption("--information-option-budget", 384)
  };
  if (kind === CANDIDATE.INFORMATION_OPTION_LEGACY_SETUP_ACTIVE) return {
    diagnosticDisablePhysicalSearch: true,
    diagnosticTypedOptionPortfolio: true,
    diagnosticContactQualifiedStrategyPortfolio: true,
    diagnosticInformationOptionIntervalActive: true,
    diagnosticInformationOptionLegacySetupOwnership: true,
    diagnosticInformationOptionIntervalNodeBudget:
      positiveIntegerOption("--information-option-budget", 384)
  };
  if (kind === CANDIDATE.NO_PRIMITIVE_SEARCH) return {
    diagnosticDisablePhysicalSearch: true
  };
  if (kind === CANDIDATE.TERMINAL_PURPOSE_SCOPED) return {
    diagnosticTerminalPurposeScoped: true,
    diagnosticOptionPortfolioShadow: true
  };
  if (kind === CANDIDATE.NO_RESOURCE_ACTIONS) return {
    diagnosticDisableResourceActions: true,
    diagnosticOptionPortfolioShadow: true
  };
  if (kind === CANDIDATE.TYPED_OPTION_PORTFOLIO_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.EVENT_DRIVEN_OPTION_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.STABLE_OPTION_LEDGER_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.STRATEGIC_STATE_LEDGER_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.OBJECTIVE_EPOCH_H2_ACTIVE ||
      kind === CANDIDATE.OBJECTIVE_EPOCH_H4_ACTIVE ||
      kind === CANDIDATE.OBJECTIVE_EPOCH_H8_ACTIVE ||
      kind === CANDIDATE.OBJECTIVE_EPOCH_OPTION_ARBITER_SHADOW ||
      kind === CANDIDATE.OBJECTIVE_EPOCH_OPTION_INTERVAL_SHADOW ||
      kind === CANDIDATE.SEMANTIC_OBJECTIVE_EPOCH_OPTION_INTERVAL_SHADOW ||
      kind === CANDIDATE.SEMANTIC_OBJECTIVE_EPOCH_OPTION_INTERVAL_ACTIVE ||
      kind === CANDIDATE.SEMANTIC_ATTACK_OPTION_COVERAGE_SHADOW ||
      kind === CANDIDATE.SEMANTIC_ATTACK_EXECUTION_INTERVAL_SHADOW ||
      kind === CANDIDATE.SEMANTIC_ATTACK_POLICY_INTERVAL_SHADOW ||
      kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW ||
      kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_ACTIVE ||
      kind === CANDIDATE.SEMANTIC_ATTACK_POLICY_INTERVAL_ACTIVE) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.STRATEGIC_CONFLICT_ARBITER_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.STRATEGIC_TARGET_EXECUTION_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.STRATEGIC_ATTACK_OVER_STAR_SHADOW ||
      kind === CANDIDATE.STRATEGIC_ATTACK_OVER_STAR_ACTIVE ||
      kind === CANDIDATE.STRATEGIC_ATTACK_POSSIBLE_RESPONSE_SHADOW ||
      kind === CANDIDATE.STRATEGIC_ATTACK_POSSIBLE_RESPONSE_ACTIVE ||
      kind === CANDIDATE.STRATEGIC_ATTACK_MOVE_VARIANT_ENVELOPE_SHADOW) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticStrategicAttackOverStarProposal: true,
    diagnosticStrategicAttackOverStarProposalActive:
      kind === CANDIDATE.STRATEGIC_ATTACK_OVER_STAR_ACTIVE ||
      kind === CANDIDATE.STRATEGIC_ATTACK_POSSIBLE_RESPONSE_ACTIVE,
    diagnosticStrategicAttackPossibleProjectileWorlds:
      kind === CANDIDATE.STRATEGIC_ATTACK_POSSIBLE_RESPONSE_SHADOW ||
      kind === CANDIDATE.STRATEGIC_ATTACK_POSSIBLE_RESPONSE_ACTIVE ||
      kind === CANDIDATE.STRATEGIC_ATTACK_MOVE_VARIANT_ENVELOPE_SHADOW,
    diagnosticStrategicAttackMoveContestVariantEnvelope:
      kind === CANDIDATE.STRATEGIC_ATTACK_MOVE_VARIANT_ENVELOPE_SHADOW
  };
  if (kind === CANDIDATE.PERSISTENT_ATTACK_TARGET_SHADOW ||
      kind === CANDIDATE.PERSISTENT_ATTACK_TARGET_ACTIVE) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticPersistentAttackTarget: true,
    diagnosticPersistentAttackTargetActive:
      kind === CANDIDATE.PERSISTENT_ATTACK_TARGET_ACTIVE
  };
  if (kind === CANDIDATE.PERSISTENT_TARGET_OPTION_SEARCH_SHADOW ||
      kind === CANDIDATE.PERSISTENT_TARGET_OPTION_SEARCH_ACTIVE) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticPersistentAttackTarget: true,
    diagnosticPersistentAttackTargetActive: true,
    diagnosticPersistentAttackTargetOptionSearch: true,
    diagnosticPersistentAttackTargetOptionSearchActive:
      kind === CANDIDATE.PERSISTENT_TARGET_OPTION_SEARCH_ACTIVE,
    diagnosticPersistentAttackTargetOptionSearchDepth:
      positiveIntegerOption("--target-search-depth", 2),
    diagnosticPersistentAttackTargetOptionSearchNodeBudget:
      positiveIntegerOption("--target-search-budget", 768)
  };
  if (kind === CANDIDATE.STABLE_OPTION_INTERVAL_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.ATTACK_CONTINUATION_PROGRESS_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.ATTACK_SEQUENCE_GENERATOR_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.ATTACK_POLICY_REACHABILITY_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.ATTACK_RESPONSE_SET_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.COMBAT_UTILITY_ENVELOPE_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.ATTACK_STAR_POLICY_FRONTIER_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.RESPONSE_CONDITIONED_OPTION_POLICY_SHADOW) return {
    diagnosticTypedOptionPortfolio: true
  };
  if (kind === CANDIDATE.RISK_CONDITIONED_COMBAT_SHADOW ||
      kind === CANDIDATE.RISK_CONDITIONED_COMBAT_ACTIVE ||
      kind === CANDIDATE.RISK_CONDITIONED_RESPONSE_POLICY_ACTIVE) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticRiskConditionedCombatProposal: true,
    diagnosticRiskConditionedCombatResponsePolicy: true,
    diagnosticRiskConditionedCombatProposalActive:
      kind === CANDIDATE.RISK_CONDITIONED_COMBAT_ACTIVE ||
      kind === CANDIDATE.RISK_CONDITIONED_RESPONSE_POLICY_ACTIVE,
    diagnosticRiskConditionedCombatResponsePolicyRequired:
      kind === CANDIDATE.RISK_CONDITIONED_RESPONSE_POLICY_ACTIVE
  };
  if (kind === CANDIDATE.QUALIFIED_ATTACK_OVER_STAR_SHADOW) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticQualifiedAttackOverStar: true
  };
  if (kind === CANDIDATE.QUALIFIED_ATTACK_OVER_STAR_ACTIVE) return {
    diagnosticTypedOptionPortfolio: true,
    diagnosticQualifiedAttackOverStar: true,
    diagnosticQualifiedAttackOverStarActive: true
  };
  if (kind === CANDIDATE.VERIFIED_ATTACK_PROPOSAL_SHADOW) return {
    diagnosticVerifiedAttackProposal: true
  };
  if (kind === CANDIDATE.VERIFIED_ATTACK_PROPOSAL_ACTIVE) return {
    diagnosticVerifiedAttackProposal: true,
    diagnosticVerifiedAttackProposalActive: true
  };
  if (kind === CANDIDATE.ATTACK_OBJECTIVE_FIELD_SHADOW) return {
    diagnosticAttackObjectiveField: true
  };
  if (kind === CANDIDATE.ATTACK_OBJECTIVE_FIELD_ACTIVE) return {
    diagnosticAttackObjectiveField: true,
    diagnosticAttackObjectiveFieldActive: true
  };
  if (kind === CANDIDATE.LEGACY_EARLY_ESCAPE) return {
    diagnosticLegacyEarlyEscapeRestriction: true,
    strictCommittedRescueEnabled: false,
    verifiedDirectKillEnabled: false
  };
  if (kind === CANDIDATE.FINAL_ONLY_RESCUE) return {
    diagnosticLegacyEarlyEscapeRestriction: false,
    strictCommittedRescueEnabled: true,
    verifiedDirectKillEnabled: false
  };
  if (kind === CANDIDATE.STRICT_FINAL_RESCUE) return {
    diagnosticLegacyEarlyEscapeRestriction: true,
    strictCommittedRescueEnabled: true,
    verifiedDirectKillEnabled: false
  };
  if (kind === CANDIDATE.VERIFIED_DIRECT_KILL) return {
    diagnosticLegacyEarlyEscapeRestriction: true,
    strictCommittedRescueEnabled: true,
    verifiedDirectKillEnabled: true
  };
  if (kind === CANDIDATE.RESIDUAL_ATTACK_PROOF_SHADOW) return {
    diagnosticLegacyEarlyEscapeRestriction: true,
    strictCommittedRescueEnabled: true,
    verifiedDirectKillEnabled: true,
    diagnosticResidualAttackProof: true,
    diagnosticResidualAttackProofDepth: positiveIntegerOption("--residual-proof-depth", 4),
    diagnosticResidualAttackProofBudget: positiveIntegerOption("--residual-proof-budget", 256)
  };
  if (kind === CANDIDATE.STRICT_SAFE_THREAT_FIRE_SHADOW) return {
    diagnosticStrictSafeThreatFireShadow: true
  };
  if (kind === CANDIDATE.STRICT_SAFE_THREAT_FIRE_ACTIVE) return {
    diagnosticStrictSafeThreatFireActive: true
  };
  if (kind === CANDIDATE.STRICT_DOOMED_FIRE_ACTIVE) return {
    diagnosticStrictDoomedFireActive: true
  };
  return {};
}

function loadCohort(root, cohortFile, role) {
  const manifest = JSON.parse(fs.readFileSync(cohortFile, "utf8"));
  if (manifest.objectKind === objectiveOptionCohort.KIND)
    return objectiveOptionCohort.load(root, cohortFile, role);
  if (manifest.objectKind === strategicAttackCohort.KIND)
    return strategicAttackCohort.load(root, cohortFile, role);
  if (manifest.objectKind === poisonAttackEventCohort.KIND)
    return poisonAttackEventCohort.load(root, cohortFile, role);
  return manifest.objectKind === "V3_COMPONENT_CAUSAL_COHORT_V1" ?
    componentCohort.loadCohort(root, cohortFile, role) :
    cohortTool.load(root, cohortFile, role);
}

function field(module, scenario, candidateSeat, skillModeOrSkills = null) {
  const star = createHistoricalStarProvider(scenario.stars);
  const explicitSkills = Array.isArray(skillModeOrSkills) ?
    skillModeOrSkills : null;
  const skillMode = explicitSkills ? "EXPLICIT" : String(skillModeOrSkills ||
    option("--skill-mode", "ASYMMETRIC")).toUpperCase();
  const skills = explicitSkills ? explicitSkills.slice(0, 2) :
    skillMode === "POISON" ? ["poison", "poison"] :
      skillMode === "STUN" ? ["stun", "stun"] :
        candidateSeat === 0 ? ["poison", "stun"] : ["stun", "poison"];
  if (skills.length !== 2 || !skills[0] || !skills[1])
    throw new Error("V2_NATIVE_EXPLICIT_SKILLS_INVALID");
  return {
    simulator: new module.AgenTankSimulator({
      map: scenario.map,
      tanks: scenario.starts.map((tank, seat) =>
        ({ ...tank, id: `native-initiative-${seat}` })),
      skills,
      star: star.initialStar,
      starProvider: value => star.provider(value),
      seed: seedFor(scenario),
      maxFrames: 128,
      starLimit: false
    }),
    skills
  };
}

function rawResult(replay, candidateSeat) {
  const winner = replay.result?.winner;
  return {
    winnerSeat: winner === 0 || winner === 1 ? winner : null,
    winnerImplementation: winner === candidateSeat ? "v2" :
      winner === (candidateSeat ^ 1) ? "v1" : "draw",
    reason: replay.result?.reason || "UNKNOWN"
  };
}

function classify(match) {
  const value = classifyAnalysisOutcome(match);
  return {
    outcome: value.analysisOutcome,
    terminalCategory: value.terminalCategory
  };
}

function collectProjectileFunnel(replay) {
  const result = { created: [0, 0], tankKills: [0, 0], shieldBreaks: [0, 0],
    terrainHits: [0, 0], noTankImpact: [0, 0], survivedAtTerminal: [0, 0],
    counterCrashWithin4: [0, 0], lifetimeFrames: [0, 0],
    lifetimeHistogram: [new Array(10).fill(0), new Array(10).fill(0)] };
  const ids = replay.replayData.replay.meta.players.map(item => item.tank.id);
  const tracks = new Map(); const crashFrame = [0xffff, 0xffff];
  const records = replay.replayData.replay.records;
  for (let frame = 0; frame < records.length; frame += 1) {
    const events = records[frame];
    for (const event of events) {
      if (event.type === "bullet" && event.action === "created") {
        const owner = ids.indexOf(event.tank?.id);
        if (owner >= 0) {
          tracks.set(event.objectId, { owner, frame, ended: 0 });
          result.created[owner] += 1;
        }
      } else if (event.type === "tank" && event.action === "crashed") {
        const seat = event.index === 0 || event.index === 1 ? event.index :
          ids.indexOf(event.objectId);
        if (seat >= 0 && crashFrame[seat] === 0xffff) crashFrame[seat] = frame;
      }
    }
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.type !== "bullet" || event.action !== "crashed") continue;
      const track = tracks.get(event.objectId); if (!track || track.ended) continue;
      track.ended = 1; const owner = track.owner;
      const lifetime = Math.max(1, frame - track.frame + 1);
      result.lifetimeFrames[owner] += lifetime;
      result.lifetimeHistogram[owner][Math.min(9, lifetime)] += 1;
      let go = -1;
      for (let at = index - 1; at >= 0; at -= 1) {
        const before = events[at];
        if (before.type === "bullet" && before.objectId === event.objectId &&
            before.action === "go") { go = at; break; }
      }
      let tankKill = 0; let shieldBreak = 0; let terrain = 0;
      if (go >= 0) for (let at = go + 1; at < index; at += 1) {
        const between = events[at];
        if (between.type === "tank" && between.action === "crashed")
          tankKill = 1;
        else if (between.type === "skill" && between.action === "expired" &&
            between.skillType === "shield") shieldBreak = 1;
        else if (between.type === "map" && between.action === "destroyed")
          terrain = 1;
      }
      if (tankKill) result.tankKills[owner] += 1;
      else if (shieldBreak) result.shieldBreaks[owner] += 1;
      else if (terrain) result.terrainHits[owner] += 1;
      else result.noTankImpact[owner] += 1;
    }
  }
  for (const track of tracks.values()) {
    if (!track.ended) result.survivedAtTerminal[track.owner] += 1;
    const crashed = crashFrame[track.owner];
    if (crashed !== 0xffff && crashed >= track.frame &&
        crashed <= track.frame + 4)
      result.counterCrashWithin4[track.owner] += 1;
  }
  return result;
}

async function play(module, scenario, candidateSeat, kind, capture = false) {
  const captureOptions = capture && typeof capture === "object" ? capture : null;
  const captureAllFrames = capture === true || captureOptions?.allFrames === true;
  const basePolicyDifferential =
    kind === CANDIDATE.NATIVE_BASE_POLICY_DIFFERENTIAL_ORACLE_ACTIVE ||
    kind === CANDIDATE.NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE;
  const boundedPolicyDifferential =
    kind === CANDIDATE.NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE;
  const poisonEligibilityAblation =
    kind === CANDIDATE.POISON_ELIGIBILITY_ABLATION;
  const terminalOracleIntervention = kind ===
    CANDIDATE.TERMINAL_ORACLE_INTERVENTION ?
    new TerminalOracleInterventionPoc(loadTerminalOracleDocuments(
      option("--terminal-oracle-inputs", "").split(",").filter(Boolean)),
    scenario.fingerprint, candidateSeat,
    option("--terminal-oracle-quality", "robust-lex")) : null;
  const boundedAttackPoseMode = boundedPolicyDifferential ?
    option("--bounded-policy-attack-pose", "off") : "off";
  if (boundedAttackPoseMode !== "off" && boundedAttackPoseMode !== "route")
    throw new Error(`V2_NATIVE_BOUNDED_ATTACK_POSE_INVALID:${boundedAttackPoseMode}`);
  const requestedBoundedPolicyActiveOwner = boundedPolicyDifferential ?
    option("--bounded-policy-active-owner", "oracle") : "oracle";
  if (requestedBoundedPolicyActiveOwner !== "native" &&
      requestedBoundedPolicyActiveOwner !== "oracle" &&
      requestedBoundedPolicyActiveOwner !== "hybrid" &&
      requestedBoundedPolicyActiveOwner !== "v3-base" &&
      requestedBoundedPolicyActiveOwner !== "v3-only")
    throw new Error(`V2_NATIVE_BOUNDED_ACTIVE_OWNER_INVALID:${
      requestedBoundedPolicyActiveOwner}`);
  const boundedPolicyActiveOwner = requestedBoundedPolicyActiveOwner;
  const boundedPolicySupportOwner = boundedPolicyDifferential ?
    option("--bounded-policy-support-owner", "all") : "all";
  if (boundedPolicySupportOwner !== "all" &&
      boundedPolicySupportOwner !== "strict" &&
      boundedPolicySupportOwner !== "exact")
    throw new Error(`V2_NATIVE_BOUNDED_SUPPORT_OWNER_INVALID:${
      boundedPolicySupportOwner}`);
  const selectivePoisonMode = basePolicyDifferential ?
    option("--bounded-policy-selective-poison", "off") : "off";
  const requestedSyntheticPoisonMode = basePolicyDifferential ?
    option("--bounded-policy-synthetic-poison", "off") : "off";
  const poisonResourceOptionMode = basePolicyDifferential ?
    option("--bounded-policy-poison-resource-option", "off") : "off";
  const poisonAttackEventMode = basePolicyDifferential ?
    option("--bounded-policy-poison-attack-event", "off") : "off";
  const poisonAttackTrigger = basePolicyDifferential ?
    option("--bounded-policy-poison-attack-trigger", "all") : "all";
  const poisonAttackSharedSearch = basePolicyDifferential &&
    option("--bounded-policy-poison-attack-shared-search", "false") === "true";
  const poisonAttackSnapshotSearch = basePolicyDifferential &&
    option("--bounded-policy-poison-attack-snapshot-search", "false") === "true";
  const poisonAttackLeanSearch = basePolicyDifferential &&
    option("--bounded-policy-poison-attack-lean-search", "false") === "true";
  const syntheticPoisonMode = poisonResourceOptionMode !== "off" &&
      requestedSyntheticPoisonMode === "off" ? "shadow" :
    requestedSyntheticPoisonMode;
  const ownSkillDomain = basePolicyDifferential ?
    option("--bounded-policy-own-skill-domain", "off") :
    poisonEligibilityAblation ? option("--poison-eligibility-mode",
      "suppress-poison-opening") : "off";
  const terminalTradeMode = basePolicyDifferential ?
    option("--bounded-policy-terminal-trade-audit", "off") : "off";
  const nativeTerminalTradeAudit = terminalTradeMode === "shadow" ||
      terminalTradeMode === "active" || terminalTradeMode === "paired-shadow" ||
      terminalTradeMode === "paired-active" ?
    new NativeTerminalTradeAudit(64, terminalTradeMode, {
      pairedTerminalDepth:
        positiveIntegerOption("--bounded-policy-terminal-trade-depth", 4),
      pairedTerminalNodeBudget:
        positiveIntegerOption("--bounded-policy-terminal-trade-budget", 512)
    }) : null;
  const candidateForcedWinMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-candidate-forced-win", "off", ["off", "shadow", "active"],
    "V2_NATIVE_CANDIDATE_FORCED_WIN_MODE_INVALID") : "off";
  const candidateExactDominanceMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-candidate-exact-dominance", "off",
    ["off", "shadow", "active"],
    "V2_NATIVE_CANDIDATE_EXACT_DOMINANCE_MODE_INVALID") : "off";
  const policyResponseEnvelopeMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-response-envelope", "off", ["off", "shadow", "active"],
    "V2_NATIVE_POLICY_RESPONSE_ENVELOPE_MODE_INVALID") : "off";
  const policyResponseEnvelopeEventClosure = basePolicyDifferential &&
    option("--bounded-policy-response-envelope-event-closure", "false") ===
      "true";
  const policyResponseEnvelopeReusePreparedBase = basePolicyDifferential &&
    option("--bounded-policy-response-envelope-reuse-base", "false") ===
      "true";
  const policyResponseEnvelopeRootEventOnly = basePolicyDifferential &&
    option("--bounded-policy-response-envelope-root-event-only", "false") ===
      "true";
  const longOptionEventEnvelopeMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-long-event-envelope", "off", ["off", "shadow"],
    "V2_NATIVE_LONG_OPTION_EVENT_ENVELOPE_MODE_INVALID") : "off";
  const longOptionResponseMassMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-long-response-mass", "off",
    ["off", "shadow", "guarded-shadow", "active"],
    "V2_NATIVE_LONG_OPTION_RESPONSE_MASS_MODE_INVALID") : "off";
  const dualPolicyResponseMassMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-dual-response-mass", "off", ["off", "shadow"],
    "V2_NATIVE_DUAL_POLICY_RESPONSE_MASS_MODE_INVALID") : "off";
  const progressiveHorizonMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-progressive-horizon", "off", ["off", "shadow"],
    "V2_NATIVE_PROGRESSIVE_HORIZON_MODE_INVALID") : "off";
  const transitionReuseCensusMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-transition-reuse-census", "off", ["off", "shadow"],
    "V2_NATIVE_TRANSITION_REUSE_CENSUS_MODE_INVALID") : "off";
  const canonicalBranchMemoMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-canonical-branch-memo", "off", ["off", "shadow"],
    "V2_NATIVE_CANONICAL_BRANCH_MEMO_MODE_INVALID") : "off";
  const stunTurnDomainCompactionMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-stun-turn-domain-compaction", "off", ["off", "shadow"],
    "V2_NATIVE_STUN_TURN_DOMAIN_COMPACTION_MODE_INVALID") : "off";
  const budgetFrontierCensusMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-budget-frontier-census", "off", ["off", "shadow"],
    "V2_NATIVE_BUDGET_FRONTIER_CENSUS_MODE_INVALID") : "off";
  const enemyResponseOptionCensusMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-enemy-response-option-census", "off", ["off", "shadow"],
    "V2_NATIVE_ENEMY_RESPONSE_OPTION_CENSUS_MODE_INVALID") : "off";
  const enemyResponsePortfolioCensusMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-enemy-response-portfolio-census", "off",
    ["off", "shadow"],
    "V2_NATIVE_ENEMY_RESPONSE_PORTFOLIO_CENSUS_MODE_INVALID") : "off";
  const selectiveResponseVerifierMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-selective-response-verifier", "off",
    ["off", "shadow", "guarded-shadow", "active", "strict-active",
      "value-active"],
    "V2_NATIVE_SELECTIVE_RESPONSE_VERIFIER_MODE_INVALID") : "off";
  const selectiveResponseProposalMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-selective-response-proposal", "attack-pose",
    ["attack-pose", "root-value", "root-value-mobility"],
    "V2_NATIVE_SELECTIVE_RESPONSE_PROPOSAL_INVALID") : "attack-pose";
  const rootVerifiedAttackMode = basePolicyDifferential ? enumOption(
    "--bounded-policy-root-verified-attack", "off",
    ["off", "shadow", "active"],
    "V2_NATIVE_ROOT_VERIFIED_ATTACK_MODE_INVALID") : "off";
  if (longOptionResponseMassMode !== "off" &&
      dualPolicyResponseMassMode !== "off")
    throw new Error("V2_NATIVE_RESPONSE_MASS_MODE_CONFLICT");
  if (progressiveHorizonMode !== "off" &&
      (longOptionResponseMassMode !== "off" ||
       dualPolicyResponseMassMode !== "off"))
    throw new Error("V2_NATIVE_PROGRESSIVE_HORIZON_MODE_CONFLICT");
  if (transitionReuseCensusMode !== "off" &&
      (longOptionResponseMassMode !== "off" ||
       dualPolicyResponseMassMode !== "off" ||
       progressiveHorizonMode !== "off"))
    throw new Error("V2_NATIVE_TRANSITION_REUSE_CENSUS_MODE_CONFLICT");
  if (canonicalBranchMemoMode !== "off" &&
      (longOptionResponseMassMode !== "off" ||
       dualPolicyResponseMassMode !== "off" ||
       progressiveHorizonMode !== "off" ||
       transitionReuseCensusMode !== "off"))
    throw new Error("V2_NATIVE_CANONICAL_BRANCH_MEMO_MODE_CONFLICT");
  if (stunTurnDomainCompactionMode !== "off" &&
      (longOptionResponseMassMode !== "off" ||
       dualPolicyResponseMassMode !== "off" ||
       progressiveHorizonMode !== "off" ||
       transitionReuseCensusMode !== "off" ||
       canonicalBranchMemoMode !== "off"))
    throw new Error("V2_NATIVE_STUN_TURN_DOMAIN_COMPACTION_MODE_CONFLICT");
  if (budgetFrontierCensusMode !== "off" &&
      (longOptionResponseMassMode !== "off" ||
       dualPolicyResponseMassMode !== "off" ||
       progressiveHorizonMode !== "off" ||
       transitionReuseCensusMode !== "off" ||
       canonicalBranchMemoMode !== "off" ||
       stunTurnDomainCompactionMode !== "off"))
    throw new Error("V2_NATIVE_BUDGET_FRONTIER_CENSUS_MODE_CONFLICT");
  if (enemyResponseOptionCensusMode !== "off" &&
      (longOptionResponseMassMode !== "off" ||
       dualPolicyResponseMassMode !== "off" ||
       progressiveHorizonMode !== "off" ||
       transitionReuseCensusMode !== "off" ||
       canonicalBranchMemoMode !== "off" ||
       stunTurnDomainCompactionMode !== "off" ||
       budgetFrontierCensusMode !== "off"))
    throw new Error("V2_NATIVE_ENEMY_RESPONSE_OPTION_CENSUS_MODE_CONFLICT");
  if (enemyResponsePortfolioCensusMode !== "off" &&
      (longOptionResponseMassMode !== "off" ||
       dualPolicyResponseMassMode !== "off" ||
       progressiveHorizonMode !== "off" ||
       transitionReuseCensusMode !== "off" ||
       canonicalBranchMemoMode !== "off" ||
       stunTurnDomainCompactionMode !== "off" ||
       budgetFrontierCensusMode !== "off" ||
       enemyResponseOptionCensusMode !== "off"))
    throw new Error("V2_NATIVE_ENEMY_RESPONSE_PORTFOLIO_CENSUS_MODE_CONFLICT");
  if (selectiveResponseVerifierMode !== "off" &&
      (longOptionResponseMassMode !== "off" ||
       dualPolicyResponseMassMode !== "off" ||
       progressiveHorizonMode !== "off" ||
       transitionReuseCensusMode !== "off" ||
       canonicalBranchMemoMode !== "off" ||
       stunTurnDomainCompactionMode !== "off" ||
       budgetFrontierCensusMode !== "off" ||
       enemyResponseOptionCensusMode !== "off" ||
       enemyResponsePortfolioCensusMode !== "off"))
    throw new Error("V2_NATIVE_SELECTIVE_RESPONSE_VERIFIER_MODE_CONFLICT");
  const nativeCandidateForcedWin = candidateForcedWinMode === "off" &&
      candidateExactDominanceMode === "off" ? null :
    new NativeCandidateForcedWinPoc(candidateForcedWinMode, {
      exactDominanceMode: candidateExactDominanceMode,
      depth: positiveIntegerOption("--bounded-policy-candidate-proof-depth", 4),
      nodeBudget: positiveIntegerOption(
        "--bounded-policy-candidate-proof-budget", 512)
    });
  if (selectivePoisonMode !== "off" && ownSkillDomain !== "suppress-poison")
    throw new Error("V2_NATIVE_SELECTIVE_POISON_REQUIRES_GENERATION_SUPPRESSION");
  if (syntheticPoisonMode !== "off" && ownSkillDomain !== "suppress-poison")
    throw new Error("V2_NATIVE_SYNTHETIC_POISON_REQUIRES_GENERATION_SUPPRESSION");
  if (poisonResourceOptionMode !== "off" &&
      ownSkillDomain !== "suppress-poison")
    throw new Error("V2_NATIVE_POISON_RESOURCE_OPTION_REQUIRES_GENERATION_SUPPRESSION");
  if (poisonAttackEventMode !== "off" && ownSkillDomain !== "suppress-poison")
    throw new Error("V2_NATIVE_POISON_ATTACK_EVENT_REQUIRES_GENERATION_SUPPRESSION");
  if (poisonAttackTrigger !== "all" && poisonAttackTrigger !== "axis")
    throw new Error("V2_NATIVE_POISON_ATTACK_EVENT_TRIGGER_INVALID");
  if (poisonAttackEventMode !== "off" &&
      (poisonResourceOptionMode !== "off" || syntheticPoisonMode === "active" ||
       selectivePoisonMode !== "off"))
    throw new Error("V2_NATIVE_POISON_ATTACK_EVENT_REQUIRES_EXCLUSIVE_OWNER");
  if (poisonResourceOptionMode !== "off" && syntheticPoisonMode === "active")
    throw new Error("V2_NATIVE_POISON_RESOURCE_OPTION_REQUIRES_SHADOW_PREFILTER");
  if (syntheticPoisonMode !== "off" &&
      option("--bounded-policy-poison-proposal", "off") !== "off")
    throw new Error("V2_NATIVE_SYNTHETIC_POISON_CONFLICTS_WITH_ROOT_POISON");
  const built = field(module, scenario, candidateSeat);
  const objectiveEpochFrames = kind === CANDIDATE.OBJECTIVE_EPOCH_H2_ACTIVE ? 2 :
    kind === CANDIDATE.OBJECTIVE_EPOCH_H4_ACTIVE ? 4 :
      kind === CANDIDATE.OBJECTIVE_EPOCH_H8_ACTIVE ? 8 : 0;
  const objectiveEpochActive = objectiveEpochFrames ?
    new ObjectiveEpochActivePoc(objectiveEpochFrames) : null;
  const semanticObjectiveEpochActive =
    kind === CANDIDATE.SEMANTIC_OBJECTIVE_EPOCH_OPTION_INTERVAL_ACTIVE ?
      new SemanticObjectiveEpochOptionActivePoc({}, {
        depth: 2, nodeBudget: 256 }) : null;
  const semanticAttackPolicyActive =
    kind === CANDIDATE.SEMANTIC_ATTACK_POLICY_INTERVAL_ACTIVE ||
    kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_ACTIVE ?
      new SemanticAttackPolicyIntervalActivePoc({}, {
        depth: 2, nodeBudget: 256,
        commonContinuation:
          kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_ACTIVE }) : null;
  const captureShotQuality = kind === CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW ||
    kind === CANDIDATE.NATIVE_BASE_POLICY_DIFFERENTIAL_ORACLE_ACTIVE ||
    kind === CANDIDATE.NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE ||
    kind === CANDIDATE.AIM_POST_FIRE_CLOSURE_SHADOW ||
    kind === CANDIDATE.AIM_POST_FIRE_RESCUE_ACTIVE ||
    kind === CANDIDATE.AIM_POST_FIRE_ALL_ACTIVE ||
    kind === CANDIDATE.AIM_POST_FIRE_LONG_RANGE_ACTIVE ||
    kind === CANDIDATE.AIM_POST_FIRE_LONG_RANGE_FAST_ACTIVE ||
    kind === CANDIDATE.DIRECT_CLEAR_SAFE_FIRE_ACTIVE ||
    kind === CANDIDATE.VISIBLE_RAY_ALIGNMENT_ACTIVE ||
    kind === CANDIDATE.V1_DIRECT_INITIATIVE_ACTIVE ||
    kind === CANDIDATE.V1_DIRECT_ENTRY_OWNERSHIP_CENSUS ||
    kind === CANDIDATE.V1_DIRECT_STAGE_ORACLE_ACTIVE ||
    kind === CANDIDATE.V1_TACTICAL_STAGE_ORACLE_ACTIVE ||
    kind === CANDIDATE.V1_TACTICAL_STAGE_RISK_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_MAXIMIN_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_COMBAT_MAXIMIN_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_COMPACT_MAXIMIN_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_DOMAIN_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_LEAF_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_DOMAIN_LEAF_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_REPRESENTATIVE_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_DEEP_LEAF_REPRESENTATIVE_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMAIN_RESOURCE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMINANCE_RESOURCE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_RACE_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_ROBUST_BACKUP_RESOURCE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_OWN_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_TACTICAL_INTENT_RESOURCE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_ATTACK_POSE_RESOURCE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_ATTACK_POSE_FULL_COVERAGE_ROUTE_RESOURCE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_CONDITIONED_ROUTE_RESOURCE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_DERIVED_ROUTE_RESOURCE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_ATTACK_POSE_OPTION_FIRST_ROUTE_RESOURCE_HISTORY_ACTIVE ||
    kind === CANDIDATE.NATIVE_ATTACK_POSE_PERSISTENT_ROUTE_RESOURCE_HISTORY_ACTIVE;
  const activeAimMode = kind === CANDIDATE.AIM_POST_FIRE_RESCUE_ACTIVE ?
    AIM_ACTIVE_MODE.RESCUE_ONLY : kind === CANDIDATE.AIM_POST_FIRE_ALL_ACTIVE ?
      AIM_ACTIVE_MODE.ALL : kind === CANDIDATE.AIM_POST_FIRE_LONG_RANGE_ACTIVE ?
        AIM_ACTIVE_MODE.LONG_RANGE_QUALITY :
        kind === CANDIDATE.AIM_POST_FIRE_LONG_RANGE_FAST_ACTIVE ?
          AIM_ACTIVE_MODE.LONG_RANGE_QUALITY_FAST : AIM_ACTIVE_MODE.OFF;
  const aimPostFireClosure = kind === CANDIDATE.AIM_POST_FIRE_CLOSURE_SHADOW ||
      activeAimMode !== AIM_ACTIVE_MODE.OFF ?
    new AimSetupPostFireClosureShadow({
      postFireDepth: positiveIntegerOption("--post-fire-depth", 4),
      postFireBudget: positiveIntegerOption("--post-fire-budget", 4096),
      setupSafetyDepth: positiveIntegerOption("--setup-safety-depth", 2),
      setupSafetyBudget: positiveIntegerOption("--setup-safety-budget", 768)
    }) : null;
  const directClearFire = kind === CANDIDATE.DIRECT_CLEAR_SAFE_FIRE_ACTIVE ?
    new DirectClearSafeFirePoc({ depth: 2, nodeBudget: 768 }) : null;
  const visibleRayAlignment = kind === CANDIDATE.VISIBLE_RAY_ALIGNMENT_ACTIVE ?
    new VisibleRayAlignmentPoc({ depth: 2, nodeBudget: 768 }) : null;
  const v1DirectInitiative = kind === CANDIDATE.V1_DIRECT_INITIATIVE_ACTIVE ?
    new V1DirectInitiativeTransplantPoc({ depth: 2, nodeBudget: 768 }) : null;
  const v1StageOracleBot = kind === CANDIDATE.V1_DIRECT_STAGE_ORACLE_ACTIVE ||
      kind === CANDIDATE.V1_TACTICAL_STAGE_ORACLE_ACTIVE ||
      kind === CANDIDATE.V1_TACTICAL_STAGE_RISK_ACTIVE ||
      basePolicyDifferential ?
    new V3DiagnosticBot({ enableOwnershipTrace: true,
      source: INSTRUMENTED_V1_POLICY_SOURCE,
      sourceFile: FROZEN_V1_FILE, sourceSha256: FROZEN_V1_SHA256 }) : null;
  const v1StageOracle = v1StageOracleBot ?
    new V1StageOracleTransplantPoc(v1StageOracleBot,
      kind === CANDIDATE.V1_TACTICAL_STAGE_ORACLE_ACTIVE ||
      kind === CANDIDATE.V1_TACTICAL_STAGE_RISK_ACTIVE ||
      basePolicyDifferential ?
        V1_ORACLE_STAGE.TACTICAL_SEARCH : V1_ORACLE_STAGE.DIRECT_ATTACK,
      { requireRisk: kind === CANDIDATE.V1_TACTICAL_STAGE_RISK_ACTIVE }) : null;
  const nativeDomainImplementation = enumOption(
    "--bounded-policy-domain-implementation", "diagnostic", ["diagnostic", "thin"],
    "V2_NATIVE_BOUNDED_DOMAIN_IMPLEMENTATION_INVALID");
  const nativeStackImplementation = enumOption(
    "--bounded-policy-stack-implementation", "assembled",
    ["assembled", "root", "compact-root", "specialized-root"],
    "V2_NATIVE_BOUNDED_STACK_IMPLEMENTATION_INVALID");
  const nativeBasePolicyRoot = basePolicyDifferential &&
      nativeStackImplementation === "root" ? new NativeBasePolicyRoot() :
    basePolicyDifferential && nativeStackImplementation === "compact-root" ?
      new CompactNativeBasePolicyRoot() :
    basePolicyDifferential && nativeStackImplementation === "specialized-root" ?
      new SpecializedNativeBasePolicyRoot() : null;
  const nativeDomain = nativeBasePolicyRoot ? nativeBasePolicyRoot.domain :
    basePolicyDifferential ?
    nativeDomainImplementation === "thin" ? new NativeBasePolicyActionDomain() :
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_TACTICAL_DOMAIN_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_DOMAIN_LEAF_ACTIVE ?
    new NativeTacticalDomainPoc() :
    kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_ACTIVE ?
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_TACTICAL_RACE_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_TACTICAL_ROBUST_BACKUP_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_TACTICAL_OWN_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_TACTICAL_INTENT_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_ATTACK_POSE_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_ATTACK_POSE_FULL_COVERAGE_ROUTE_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_CONDITIONED_ROUTE_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_DERIVED_ROUTE_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_ATTACK_POSE_OPTION_FIRST_ROUTE_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_ATTACK_POSE_PERSISTENT_ROUTE_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(2) :
    kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMAIN_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(3) :
    kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMINANCE_RESOURCE_HISTORY_ACTIVE ?
      new NativeTacticalDomainPoc(3) : null;
  const boundedPolicyLeaf = option("--bounded-policy-leaf", "base");
  const boundedLeafImplementation = enumOption(
    "--bounded-policy-leaf-implementation", "diagnostic",
    ["diagnostic", "thin"],
    "V2_NATIVE_BOUNDED_LEAF_IMPLEMENTATION_INVALID");
  const LeafEvaluator = boundedLeafImplementation === "thin" ?
    NativeBasePolicyLeafEvaluator : NativeV1PolicyLeafEvaluatorPoc;
  const nativeLeafEvaluator = nativeBasePolicyRoot ?
    nativeBasePolicyRoot.leafEvaluator :
    boundedPolicyDifferential && (boundedPolicyLeaf === "v1" ||
      boundedPolicyLeaf === "v1-fact") ?
    new LeafEvaluator({
      discountSimulatedProjectiles: boundedPolicyLeaf === "v1-fact",
      precomputeGeometry: enumOption(
        "--bounded-policy-leaf-geometry", "table", ["table", "arithmetic"],
        "V2_NATIVE_BOUNDED_LEAF_GEOMETRY_INVALID") === "table",
      starFieldCacheEntries: Math.max(0, Math.min(8,
        Number(option("--bounded-policy-star-field-cache", 0)) | 0)),
      clampLimit: option("--bounded-policy-leaf-clamp", "25000") === "v1" ?
        0 : 25000,
      clampMode: enumOption("--bounded-policy-leaf-clamp", "25000",
        ["25000", "component", "v1"],
        "V2_NATIVE_BOUNDED_LEAF_CLAMP_INVALID") === "component" ?
        "component" : "total",
      omitComponents: option("--bounded-policy-leaf-ablation", "")
    }) :
    boundedPolicyDifferential && boundedPolicyLeaf === "race" ?
    new NativeTacticalRaceLeafEvaluatorPoc() :
    kind === CANDIDATE.NATIVE_TACTICAL_RACE_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ?
    new NativeTacticalRaceLeafEvaluatorPoc() :
    basePolicyDifferential || kind === CANDIDATE.NATIVE_TACTICAL_LEAF_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_DOMAIN_LEAF_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_DEEP_LEAF_REPRESENTATIVE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMAIN_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMINANCE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_ROBUST_BACKUP_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_OWN_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_INTENT_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_FULL_COVERAGE_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_CONDITIONED_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_DERIVED_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_OPTION_FIRST_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_PERSISTENT_ROUTE_RESOURCE_HISTORY_ACTIVE ?
    new NativeTacticalLeafEvaluatorPoc({
      stunStatusMode: option("--bounded-policy-stun-leaf", "flat")
    }) : null;
  const nativeLeafMethodCensus = nativeLeafEvaluator &&
      option("--bounded-policy-leaf-method-census", "off") === "on" ?
    installBasePolicySearchMethodCensus(nativeLeafEvaluator) : null;
  const nativeRepresentative =
      kind === CANDIDATE.NATIVE_TACTICAL_OWN_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ?
    new NativeTacticalRepresentativePoc({ ownOnly: true }) :
    basePolicyDifferential || kind === CANDIDATE.NATIVE_TACTICAL_REPRESENTATIVE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_ACTIVE ||
      basePolicyDifferential ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_DEEP_LEAF_REPRESENTATIVE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMAIN_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMINANCE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RACE_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_ROBUST_BACKUP_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_INTENT_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_FULL_COVERAGE_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_CONDITIONED_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_DERIVED_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_OPTION_FIRST_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_PERSISTENT_ROUTE_RESOURCE_HISTORY_ACTIVE ?
    new NativeTacticalRepresentativePoc() : null;
  const nativeHistory =
      basePolicyDifferential ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMAIN_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMINANCE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RACE_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_ROBUST_BACKUP_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_OWN_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_INTENT_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_FULL_COVERAGE_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_CONDITIONED_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_DERIVED_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_OPTION_FIRST_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_PERSISTENT_ROUTE_RESOURCE_HISTORY_ACTIVE ?
    new NativeTacticalHistoryPoc() : null;
  const nativeIntentImplementation = enumOption(
    "--bounded-policy-intent-implementation", "diagnostic",
    ["diagnostic", "thin"], "V2_NATIVE_BOUNDED_INTENT_IMPLEMENTATION_INVALID");
  const boundedPolicyIntent = option("--bounded-policy-intent", "off");
  const useThinIntent = nativeIntentImplementation === "thin";
  if (useThinIntent && boundedPolicyDifferential &&
      (boundedPolicyIntent !== "v1" ||
       option("--bounded-policy-intent-map", "frontier") !== "v1-action" ||
       option("--bounded-policy-intent-continuity", "context") !== "v1-epoch" ||
       option("--bounded-policy-intent-classification", "simple") !== "v1-exact" ||
       option("--bounded-policy-active-owner", "oracle") !== "native"))
    throw new Error("V2_NATIVE_THIN_INTENT_REQUIRES_BP68_CONTRACT");
  const nativeIntent = nativeBasePolicyRoot ? nativeBasePolicyRoot.intent :
    boundedPolicyDifferential &&
      (option("--bounded-policy-intent", "off") === "v1" ||
       option("--bounded-policy-intent", "off") === "v1-oracle" ||
       option("--bounded-policy-intent", "off") === "v1-oracle-intent") ?
    useThinIntent ? new NativeBasePolicyStrategicIntentArenaAdapter(150) :
    new NativeTacticalIntentPoc(150, { oracleMode:
      option("--bounded-policy-intent", "off") === "v1-oracle" ? "action" :
      option("--bounded-policy-intent", "off") === "v1-oracle-intent" ?
        "intent" : "off",
      mappingMode: option("--bounded-policy-intent-map", "frontier"),
      continuityMode: option("--bounded-policy-intent-continuity", "context"),
      classificationMode:
        option("--bounded-policy-intent-classification", "simple") }) :
    kind === CANDIDATE.NATIVE_TACTICAL_INTENT_RESOURCE_HISTORY_ACTIVE ?
    new NativeTacticalIntentPoc(150) : null;
  const boundedOpponentContextMode = enumOption(
    "--bounded-policy-opponent-context", "oracle",
    ["oracle", "uniform", "native-shadow", "native-gated", "native"],
    "V2_NATIVE_BOUNDED_OPPONENT_CONTEXT_INVALID");
  // The original differential POC executes the complete V1 VM search before
  // every native decision and then compares transitions, domains and values.
  // That is useful validation evidence, but it is not part of the native
  // policy. Keep it on by default for historical commands and allow an
  // explicit cold diagnostic ablation to measure the actual native cost.
  const boundedPolicyOracleAudit = enumOption(
    "--bounded-policy-oracle-audit", "on", ["on", "off"],
    "V2_NATIVE_BOUNDED_ORACLE_AUDIT_INVALID") === "on";
  const nativeBasePolicyOpponentHistory = nativeBasePolicyRoot ?
    nativeBasePolicyRoot.opponentHistory : basePolicyDifferential &&
      boundedOpponentContextMode !== "oracle" ?
    new NativeBasePolicyOpponentHistoryArenaAdapter() : null;
  const nativeAttackPose = kind === CANDIDATE.NATIVE_ATTACK_POSE_RESOURCE_HISTORY_ACTIVE ?
    new NativeAttackPoseOptionPoc() :
    kind === CANDIDATE.NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE ?
      new NativeAttackPoseOptionPoc({ routeProof: true,
        responseDerivedPoses:
          option("--attack-pose-successor-response-viability", "false") === "true",
        requireSuccessorResponseViability:
          option("--attack-pose-successor-response-viability", "false") === "true" }) :
    kind === CANDIDATE.NATIVE_ATTACK_POSE_FULL_COVERAGE_ROUTE_RESOURCE_HISTORY_ACTIVE ?
      new NativeAttackPoseOptionPoc({ routeProof: true, requireFullCoverage: true }) :
    kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_CONDITIONED_ROUTE_RESOURCE_HISTORY_ACTIVE ?
      new NativeAttackPoseOptionPoc({ routeProof: true,
        requireUncoveredNonRegression: true }) :
    kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_DERIVED_ROUTE_RESOURCE_HISTORY_ACTIVE ?
      new NativeAttackPoseOptionPoc({ routeProof: true,
        responseDerivedPoses: true }) :
    kind === CANDIDATE.NATIVE_ATTACK_POSE_OPTION_FIRST_ROUTE_RESOURCE_HISTORY_ACTIVE ?
      new NativeAttackPoseOptionPoc({ routeProof: true }) :
    kind === CANDIDATE.NATIVE_ATTACK_POSE_PERSISTENT_ROUTE_RESOURCE_HISTORY_ACTIVE ?
      new NativeAttackPoseOptionPoc({ routeProof: true, persistent: true }) :
    boundedAttackPoseMode === "route" ?
      new NativeAttackPoseOptionPoc({ routeProof: true,
        requireSuccessorResponseViability:
          option("--attack-pose-successor-response-viability", "false") === "true",
        committedResponseViability:
          option("--attack-pose-successor-response-viability", "false") === "true" }) : null;
  const nativeAttackPoseFeedback = nativeAttackPose &&
      option("--attack-pose-feedback-search", "false") === "true" ?
    new NativeAttackPoseFeedbackSearchPoc() : null;
  const nativeAttackPosePolicySearch = nativeAttackPose &&
      option("--attack-pose-policy-search", "false") === "true" ?
    new NativeAttackPosePolicySearchPoc(undefined, {
      nodeBudget: positiveIntegerOption("--attack-pose-policy-budget", 768),
      pairedDepth: Math.max(0,
        Number(option("--attack-pose-policy-paired-depth", 0)) | 0),
      requireSourceSupport:
        option("--attack-pose-policy-source-domain-only", "false") === "true",
      fixedOption: option("--attack-pose-policy-fixed-option", "false") === "true",
      stationaryRootPolicy:
        option("--attack-pose-policy-stationary-root", "false") === "true",
      outcomeVector:
        option("--attack-pose-policy-outcome-vector", "false") === "true",
      eventSettlement:
        option("--attack-pose-policy-event-settlement", "false") === "true"
    }) : null;
  const boundedPathMode = option("--bounded-policy-path-utility", "off");
  const boundedPathExact = boundedPathMode === "v1-exact";
  const boundedPathImplementation = enumOption(
    "--bounded-policy-path-implementation", "diagnostic",
    ["diagnostic", "thin"],
    "V2_NATIVE_BOUNDED_PATH_IMPLEMENTATION_INVALID");
  const PathUtility = boundedPathImplementation === "thin" ?
    NativeBasePolicyPathUtility : NativeV1PathUtilityPoc;
  const nativePathUtility = nativeBasePolicyRoot ?
    nativeBasePolicyRoot.pathUtility :
    boundedPolicyDifferential && boundedPathMode !== "off" ?
    new PathUtility(nativeLeafEvaluator, {
      fire: boundedPathMode === "v1" || boundedPathMode === "all" || boundedPathExact ||
        boundedPathMode.includes("fire"),
      bomb: boundedPathMode === "v1" || boundedPathMode === "all" || boundedPathExact ||
        boundedPathMode.includes("bomb"),
      turn: boundedPathMode === "v1" || boundedPathMode === "all" || boundedPathExact ||
        boundedPathMode.includes("turn") || boundedPathMode.includes("reversal"),
      stun: boundedPathMode === "v1" || boundedPathMode === "all" || boundedPathExact ||
        boundedPathMode.includes("stun"),
      exactFireTransition: boundedPathExact || boundedPathMode.includes("exact-fire"),
      responseConditionedFire:
        option("--bounded-policy-response-fire", "false") === "true",
      goEdgeTransition: boundedPathExact || boundedPathMode.includes("go-edge"),
      rootTurnOnly: boundedPathMode.includes("root-turn") ||
        boundedPathMode.includes("root-reversal"),
      reversalOnly: boundedPathMode.includes("reversal")
    }) : null;
  const nativePathMethodCensus = nativePathUtility &&
      option("--bounded-policy-path-method-census", "off") === "on" ?
    installBasePolicySearchMethodCensus(nativePathUtility) : null;
  const boundedDepthSchedule = option("--bounded-policy-depth-schedule", "fixed");
  if (boundedDepthSchedule !== "fixed" && boundedDepthSchedule !== "v1-state" &&
      boundedDepthSchedule !== "iterative-complete")
    throw new Error(`V2_NATIVE_BOUNDED_DEPTH_SCHEDULE_INVALID:${
      boundedDepthSchedule}`);
  const boundedEventQuiescence = enumOption(
    "--bounded-policy-event-quiescence", "off", ["off", "projectile-bomb"],
    "V2_NATIVE_BOUNDED_EVENT_QUIESCENCE_INVALID");
  const boundedEventQuiescenceContinuation = enumOption(
    "--bounded-policy-event-quiescence-continuation", "full",
    ["full", "base-policy"],
    "V2_NATIVE_BOUNDED_EVENT_QUIESCENCE_CONTINUATION_INVALID");
  const boundedOwnContinuation = enumOption(
    "--bounded-policy-own-continuation", "full",
    ["full", "base-policy", "combat-first", "portfolio", "root-policy",
      "root-policy-direct"],
    "V2_NATIVE_BOUNDED_OWN_CONTINUATION_INVALID");
  const nativeEventQuiescenceContinuation = boundedPolicyDifferential &&
      (boundedEventQuiescenceContinuation === "base-policy" ||
       boundedOwnContinuation === "base-policy" ||
       boundedOwnContinuation === "combat-first" ||
       boundedOwnContinuation === "portfolio" ||
       boundedOwnContinuation === "root-policy" ||
       boundedOwnContinuation === "root-policy-direct") ?
    new NativeBasePolicyContinuationPoc(null, nativeIntent) : null;
  const nativeOwnContinuation = boundedOwnContinuation === "combat-first" ?
    new NativeCombatFirstContinuationPoc(null, nativeIntent,
      new NativeAttackPoseFeedbackSearchPoc({ forcePolicy: true })) :
    boundedOwnContinuation === "base-policy" ||
      boundedOwnContinuation === "portfolio" ||
      boundedOwnContinuation === "root-policy" ||
      boundedOwnContinuation === "root-policy-direct" ?
      nativeEventQuiescenceContinuation : null;
  const nativeOwnContinuationSecondary = boundedOwnContinuation === "portfolio" ||
      boundedOwnContinuation === "root-policy" ||
      boundedOwnContinuation === "root-policy-direct" ?
    new NativeAttackPoseFeedbackSearchPoc({ forcePolicy: true }) : null;
  const boundedSearchImplementation = enumOption(
    "--bounded-policy-search-implementation", "diagnostic",
    ["diagnostic", "thin"],
    "V2_NATIVE_BOUNDED_SEARCH_IMPLEMENTATION_INVALID");
  if (boundedSearchImplementation === "thin" && boundedPolicyOracleAudit)
    throw new Error("V2_NATIVE_THIN_SEARCH_REQUIRES_ORACLE_AUDIT_OFF");
  const BoundedPolicySearch = boundedSearchImplementation === "thin" ?
    NativeBasePolicySearch : boundedDepthSchedule === "iterative-complete" ?
      NativeIterativeCompletePolicySearchPoc : NativeBoundedPolicySearchPoc;
  const nativeBoundedPolicySearch = nativeBasePolicyRoot ?
    nativeBasePolicyRoot.policySearch : boundedPolicyDifferential ?
    new BoundedPolicySearch({
      targetDepth: positiveIntegerOption("--bounded-policy-depth", 3),
      depthSchedule: boundedDepthSchedule,
      nodeBudget: positiveIntegerOption("--bounded-policy-budget", 128),
      blendBasisPoints: Number(option("--bounded-policy-blend", 2000)) | 0,
      blendSchedule: option("--bounded-policy-blend-schedule", "fixed"),
      leadingBlendBasisPoints:
        Number(option("--bounded-policy-leading-blend", 0)) | 0,
      trailingBlendBasisPoints:
        Number(option("--bounded-policy-trailing-blend", 4000)) | 0,
      fullPrimitiveDomain: option("--bounded-policy-domain", "representative") === "full",
      deepFireMode: option("--bounded-policy-deep-fire", "simple"),
      deepFireDomain: nativeDomain,
      deepSkillMode: option("--bounded-policy-deep-skill", "off"),
      deepDomainMode: option("--bounded-policy-deep-domain", "primitive"),
      deepBombMode: option("--bounded-policy-deep-bomb", "off"),
      eventQuiescenceMode: boundedEventQuiescence,
      eventQuiescenceContinuationMode: boundedEventQuiescenceContinuation,
      eventQuiescenceContinuation: nativeEventQuiescenceContinuation,
      ownContinuationMode: boundedOwnContinuation,
      ownContinuation: nativeOwnContinuation,
      ownContinuationSecondary: nativeOwnContinuationSecondary,
      eventQuiescenceMaximumPly: Math.max(1, Math.min(3,
        positiveIntegerOption("--bounded-policy-event-quiescence-ply", 3))),
      opponentWeighted: option("--bounded-policy-opponent", "uniform") === "weighted",
      opponentMode: option("--bounded-policy-opponent", "uniform"),
      v1StunCountdown:
        option("--bounded-policy-stun-duration", "platform") === "v1-countdown",
      v1EntryProjectileCollision:
        option("--bounded-policy-entry-projectile", "platform") === "v1-entry",
      deepHardMode: option("--bounded-policy-deep-hard", "full"),
      rootDomainMode: option("--bounded-policy-root-domain", "all"),
      rootExtraPoison:
        option("--bounded-policy-poison-proposal", "off") !== "off",
      terminalMode: option("--bounded-policy-terminal", "platform"),
      ownChanceMode: option("--bounded-policy-own-chance", "expected"),
      rootEnemyDomainMode: option("--bounded-policy-root-enemy-domain", "all"),
      rootColumnOrder: enumOption("--bounded-policy-root-column-order", "forward",
        ["forward", "reverse", "v1"],
        "V2_NATIVE_BOUNDED_ROOT_COLUMN_ORDER_INVALID"),
      rootBudgetMode: enumOption("--bounded-policy-root-budget", "row-shared",
        ["row-shared", "cell-equal"], "V2_NATIVE_BOUNDED_ROOT_BUDGET_INVALID"),
      pathEvidenceMode: enumOption("--bounded-policy-path-evidence", "single",
        ["single", "split-nominal"],
        "V2_NATIVE_BOUNDED_PATH_EVIDENCE_INVALID"),
      leafEvaluator: nativeLeafEvaluator,
      pathUtility: nativePathUtility,
      historyEvaluator: option("--bounded-policy-history", "off") === "on" ?
        nativeHistory : null,
      superkoMode: option("--bounded-policy-superko", "off"),
      collectTerminalTrade: terminalTradeMode !== "off"
    }) : null;
  const nativeBoundedPolicySearchMethodCensus = nativeBoundedPolicySearch &&
      option("--bounded-policy-search-method-census", "off") === "on" ?
    installBasePolicySearchMethodCensus(nativeBoundedPolicySearch) : null;
  const nativeOwnerImplementation = enumOption(
    "--bounded-policy-owner-implementation", "diagnostic", ["diagnostic", "thin"],
    "V2_NATIVE_BOUNDED_OWNER_IMPLEMENTATION_INVALID");
  const NativeTacticalOwner = nativeOwnerImplementation === "thin" ?
    NativeBasePolicyActionOwnerArenaAdapter : NativeTacticalActionOwnerPoc;
  const nativeTacticalOwner = nativeBasePolicyRoot ? nativeBasePolicyRoot.owner :
    basePolicyDifferential ||
      kind === CANDIDATE.NATIVE_TACTICAL_MAXIMIN_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_COMBAT_MAXIMIN_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_COMPACT_MAXIMIN_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_DOMAIN_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_DOMAIN_LEAF_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_REPRESENTATIVE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_DEEP_LEAF_REPRESENTATIVE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMAIN_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMINANCE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_RACE_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_ROBUST_BACKUP_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_OWN_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_TACTICAL_INTENT_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_FULL_COVERAGE_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_CONDITIONED_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_DERIVED_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_OPTION_FIRST_ROUTE_RESOURCE_HISTORY_ACTIVE ||
      kind === CANDIDATE.NATIVE_ATTACK_POSE_PERSISTENT_ROUTE_RESOURCE_HISTORY_ACTIVE ?
    new NativeTacticalOwner({ domain: nativeDomain, intent: nativeIntent,
      opponentHistory: nativeBasePolicyOpponentHistory,
      policySearch: nativeBoundedPolicySearch,
      policySearchSupportMode: boundedPolicySupportOwner,
      riskFrontierMode: basePolicyDifferential ? enumOption(
        "--bounded-policy-risk-frontier", "off",
        ["off", "acceptable", "pareto", "joint"],
        "V2_NATIVE_BOUNDED_RISK_FRONTIER_INVALID") : "off",
      riskSoftBandMode: basePolicyDifferential ? enumOption(
        "--bounded-policy-risk-soft-band", "off", ["off", "intent-known"],
        "V2_NATIVE_BOUNDED_RISK_SOFT_BAND_INVALID") : "off",
      intentValueMode: basePolicyDifferential ? enumOption(
        "--bounded-policy-intent-value", "bonus", ["bonus", "tie", "off"],
        "V2_NATIVE_BOUNDED_INTENT_VALUE_INVALID") : "bonus",
      terminalTradeAudit: nativeTerminalTradeAudit,
      candidateForcedWin: nativeCandidateForcedWin,
      attackPoseOption: nativeAttackPose, attackPoseBand: nativeAttackPose ? 150 : 0,
      attackPosePolicySearch: nativeAttackPosePolicySearch,
      attackPoseRequiredAimTurns: nativeAttackPose ?
        Number(option("--attack-pose-required-aim-turns", -1)) : -1,
      captureFrames: captureOptions?.nativePoseFrames,
      captureAllRoots: basePolicyDifferential &&
        option("--bounded-policy-capture-roots", "false") === "true",
      captureRootLimit: positiveIntegerOption(
        "--bounded-policy-capture-root-limit", 128),
      attackPoseActiveFrames: captureOptions?.nativePoseActiveFrames,
      attackPoseOptionFirst:
        kind === CANDIDATE.NATIVE_ATTACK_POSE_OPTION_FIRST_ROUTE_RESOURCE_HISTORY_ACTIVE,
      exactFireDomainBypass:
        kind === CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMINANCE_RESOURCE_HISTORY_ACTIVE,
      opponentBlendBasisPoints:
        kind === CANDIDATE.NATIVE_TACTICAL_ROBUST_BACKUP_RESOURCE_HISTORY_ACTIVE ? 2000 : 0,
      resourceRequiresCellwiseDominance: basePolicyDifferential &&
        option("--bounded-policy-resource-owner", "score") === "dominance",
      resourceCellwiseDominanceScope: basePolicyDifferential &&
        option("--bounded-policy-resource-owner", "score") === "bomb-dominance" ?
        "bomb" : basePolicyDifferential &&
          option("--bounded-policy-resource-owner", "score") === "skill-dominance" ?
          "skill" : undefined,
      intentMembership: basePolicyDifferential &&
        option("--bounded-policy-intent-owner", "bonus") === "membership",
      nonContactBasePolicy: basePolicyDifferential &&
        (option("--bounded-policy-noncontact-base", "off") === "on" ||
          option("--bounded-policy-noncontact-base", "off") === "terminal"),
      nonContactBaseTerminalOnly: basePolicyDifferential &&
        option("--bounded-policy-noncontact-base", "off") === "terminal",
      directAttackBasePolicy: basePolicyDifferential ?
        option("--bounded-policy-direct-attack", "off") : "off",
      preemptiveSafetyBasePolicy: basePolicyDifferential ?
        option("--bounded-policy-preemptive-safety", "off") : "off",
      committedSearchMode: basePolicyDifferential ?
        option("--bounded-policy-committed-search", "off") : "off",
      basePolicyVerifierMode: basePolicyDifferential ?
        option("--bounded-policy-search-owner", "off") : "off",
      basePolicyVerifierMargin: basePolicyDifferential ?
        Number(option("--bounded-policy-verifier-margin", "100")) : 100,
      verifiedInterceptMode: basePolicyDifferential ?
        option("--bounded-policy-verified-intercept", "off") : "off",
      verifiedInterceptBand: basePolicyDifferential ?
        Number(option("--bounded-policy-verified-intercept-band", "400")) : 400,
      fireEvidenceSelection: basePolicyDifferential &&
        option("--bounded-policy-fire-selection", "off") === "evidence",
      qualifiedFireOwnerMode: basePolicyDifferential ?
        option("--bounded-policy-qualified-fire-owner", "off") : "off",
      poisonProposalMode: basePolicyDifferential ?
        option("--bounded-policy-poison-proposal", "off") : "off",
      poisonProposalPolicy: basePolicyDifferential ?
        option("--bounded-policy-poison-policy", "matrix") : "matrix" }) : null;
  const nativePolicyPriorOwner = kind === CANDIDATE.NATIVE_POLICY_PRIOR_ACTIVE ?
    new NativePolicyPriorOwnerPoc() : null;
  const nativeBasePolicyDifferential = basePolicyDifferential ?
    new NativeBasePolicyDifferentialPoc({ activeOwner: boundedPolicyActiveOwner }) : null;
  const nativeOwnSkillActionBridge = basePolicyDifferential ||
      poisonEligibilityAblation ?
    new NativeOwnSkillActionBridgePoc(ownSkillDomain) : null;
  const nativeSelectivePoison = selectivePoisonMode !== "off" ?
    new NativeSelectivePoisonPoc(selectivePoisonMode) : null;
  const nativeSyntheticResourceRoot = syntheticPoisonMode !== "off" ?
    new NativeSyntheticResourceRootPoc(syntheticPoisonMode) : null;
  const nativePoisonResourceOption = poisonResourceOptionMode !== "off" ?
    new NativePoisonResourceOptionPoc(poisonResourceOptionMode, {
      nodeBudget: Number(option("--bounded-policy-poison-option-budget", "2048")),
      feedbackMode: option("--bounded-policy-poison-option-feedback",
        "representative")
    }) : null;
  const nativePoisonAttackEventOption = poisonAttackEventMode !== "off" ?
    new NativePoisonAttackEventOptionPoc(poisonAttackEventMode, {
      maximumDepth: Number(option("--bounded-policy-poison-attack-depth", "4")),
      nodeBudget: Number(option("--bounded-policy-poison-attack-budget", "2048")),
      triggerMode: poisonAttackTrigger,
      requireSimulatorCadenceAgreement: true,
      sharedSearch: poisonAttackSharedSearch,
      snapshotSearch: poisonAttackSnapshotSearch,
      leanSearch: poisonAttackLeanSearch
    }) : null;
  const nativePolicyResponseEnvelope = policyResponseEnvelopeMode !== "off" ?
    new NativePolicyResponseEnvelopePoc(policyResponseEnvelopeMode, {
      depth: positiveIntegerOption("--bounded-policy-response-envelope-depth", 3),
      nodeBudget: positiveIntegerOption(
        "--bounded-policy-response-envelope-budget", 768),
      requireEventClosure: policyResponseEnvelopeEventClosure,
      reusePreparedBase: policyResponseEnvelopeReusePreparedBase,
      rootEventOnly: policyResponseEnvelopeRootEventOnly
    }) : null;
  const nativeLongOptionEventEnvelope = longOptionEventEnvelopeMode !== "off" ?
    new NativeLongOptionEventEnvelopePoc(longOptionEventEnvelopeMode, {
      maximumFrames: positiveIntegerOption(
        "--bounded-policy-long-event-frames", 6),
      nodeBudget: positiveIntegerOption(
        "--bounded-policy-long-event-budget", 2048)
    }) : null;
  const nativeLongOptionResponseMass =
    selectiveResponseVerifierMode !== "off" ?
    new NativeSelectiveResponseVerifierPoc(selectiveResponseVerifierMode, {
      maximumFrames: positiveIntegerOption(
        "--bounded-policy-long-response-frames", 6),
      nodeBudget: positiveIntegerOption(
        "--bounded-policy-long-response-budget", 2048),
      candidateProposalMode: selectiveResponseProposalMode
    }) : enemyResponsePortfolioCensusMode !== "off" ?
    new NativeEnemyResponsePortfolioCensusPoc(
      enemyResponsePortfolioCensusMode, {
        maximumFrames: positiveIntegerOption(
          "--bounded-policy-long-response-frames", 6),
        nodeBudget: positiveIntegerOption(
          "--bounded-policy-long-response-budget", 2048),
        primitivePrefixDepth: positiveIntegerOption(
          "--bounded-policy-enemy-response-prefix-depth", 2)
      }) : enemyResponseOptionCensusMode !== "off" ?
    new NativeEnemyResponseOptionCensusPoc(enemyResponseOptionCensusMode, {
      maximumFrames: positiveIntegerOption(
        "--bounded-policy-long-response-frames", 6),
      nodeBudget: positiveIntegerOption(
        "--bounded-policy-long-response-budget", 2048)
    }) : budgetFrontierCensusMode !== "off" ?
    new NativeBudgetFrontierCensusPoc(budgetFrontierCensusMode, {
      maximumFrames: positiveIntegerOption(
        "--bounded-policy-long-response-frames", 6),
      nodeBudget: positiveIntegerOption(
        "--bounded-policy-long-response-budget", 2048)
    }) : stunTurnDomainCompactionMode !== "off" ?
    new NativeStunTurnDomainCompactionPoc(stunTurnDomainCompactionMode, {
      maximumFrames: positiveIntegerOption(
        "--bounded-policy-long-response-frames", 6),
      nodeBudget: positiveIntegerOption(
        "--bounded-policy-long-response-budget", 2048)
    }) : canonicalBranchMemoMode !== "off" ?
    new NativeCanonicalBranchMemoPoc(canonicalBranchMemoMode, {
      maximumFrames: positiveIntegerOption(
        "--bounded-policy-long-response-frames", 6),
      nodeBudget: positiveIntegerOption(
        "--bounded-policy-long-response-budget", 2048)
    }) : transitionReuseCensusMode !== "off" ?
    new NativeTransitionReuseCensusPoc(transitionReuseCensusMode, {
      maximumFrames: positiveIntegerOption(
        "--bounded-policy-long-response-frames", 6),
      nodeBudget: positiveIntegerOption(
        "--bounded-policy-long-response-budget", 2048)
    }) : progressiveHorizonMode !== "off" ?
    new NativeProgressiveHorizonResponseMassPoc(progressiveHorizonMode, {
      nodeBudget: positiveIntegerOption(
        "--bounded-policy-long-response-budget", 2048)
    }) : dualPolicyResponseMassMode !== "off" ?
    new NativeDualPolicyResponseMassPoc(dualPolicyResponseMassMode, {
      maximumFrames: positiveIntegerOption(
        "--bounded-policy-long-response-frames", 6),
      nodeBudget: positiveIntegerOption(
        "--bounded-policy-long-response-budget", 2048)
    }) : longOptionResponseMassMode !== "off" ?
    new NativeLongOptionResponseMassPoc(longOptionResponseMassMode, {
      maximumFrames: positiveIntegerOption(
        "--bounded-policy-long-response-frames", 6),
      nodeBudget: positiveIntegerOption(
        "--bounded-policy-long-response-budget", 2048)
    }) : null;
  const nativeRootVerifiedAttack = rootVerifiedAttackMode !== "off" ?
    new VerifiedAttackProposal({
      active: rootVerifiedAttackMode === "active",
      requireDirectKill: true
    }) : null;
  const candidateBot = new ProductionDiagnosticBot({
    engine: nativeBasePolicyRoot ?
      { ...engineOptions(kind), nativeBasePolicyRoot } : engineOptions(kind),
    diagnosticFinalActionOverride: semanticAttackPolicyActive ?
      (engine, action, argument) => semanticAttackPolicyActive.selectOverride(
        engine, action, argument) : objectiveEpochActive ?
      (engine, action, argument) => objectiveEpochActive.selectOverride(
        engine, action, argument) : semanticObjectiveEpochActive ?
      (engine, action, argument) => semanticObjectiveEpochActive.selectOverride(
        engine, action, argument) : terminalOracleIntervention ?
      (engine, action, argument) => terminalOracleIntervention.selectOverride(
        engine, action, argument) : nativeBasePolicyRoot ? null :
      nativeBasePolicyDifferential ?
      (engine, action, argument, context) => {
        // Freeze the reference answer before doing any native diagnostic work.
        // The V1 oracle has its own elapsed-time fallback; running a more
        // expensive candidate first would otherwise change the reference.
        const oracleBefore = v1StageOracle.stageCallCount;
        const oracle = boundedPolicyOracleAudit ?
          v1StageOracle.selectOverride(engine,
            engine.lastSelectedIndex, action, argument, context) : null;
        const oracleProposed = boundedPolicyOracleAudit &&
          v1StageOracle.stageCallCount > oracleBefore;
        const oracleRounds = boundedPolicyOracleAudit ?
          v1StageOracle.lastSearchRounds : 0;
        const oracleEvaluated = boundedPolicyOracleAudit ?
          v1StageOracle.lastPolicyEvaluated : null;
        const oracleTransitions = boundedPolicyOracleAudit ?
          v1StageOracle.lastPolicyTransitionCensus : null;
        const oracleRoot = boundedPolicyOracleAudit ?
          v1StageOracle.lastPolicyRootSnapshot : null;
        const oracleRecursion = boundedPolicyOracleAudit ?
          v1StageOracle.lastPolicyRecursionCensus : null;
        const oracleMonteCarlo = boundedPolicyOracleAudit ?
          v1StageOracle.lastMonteCarloUsed : false;
        const oracleStageAction = boundedPolicyOracleAudit ?
          v1StageOracle.lastProposedAction : ACTION.NONE;
        const fullOracleTrace = boundedPolicyOracleAudit ?
          v1StageOracleBot.controller.ownershipTrace : null;
        const fullControllerStage = fullOracleTrace?.selectedStage || 0;
        const fullControllerAction = fullOracleTrace?.resolvedAction ?? action;
        if (nativeIntent && oracleEvaluated &&
            typeof nativeIntent.setOracle === "function")
          nativeIntent.setOracle(oracleEvaluated?._v3CommittedIntent,
            actionFromLegacy(oracleEvaluated?._v3CommittedAction),
            oracleEvaluated?._v3ProposedIntent,
            oracleEvaluated?._v3SelectedIntent,
            v1StageOracle.lastRuntimeContextEpoch,
            v1StageOracle.lastRuntimeContextSignature);
        else if (nativeIntent && typeof nativeIntent.clearOracle === "function")
          nativeIntent.clearOracle();
        const nativeBefore = nativeTacticalOwner.proposalCount;
        const boundedBefore = nativeBoundedPolicySearch.prepareCount;
        nativeBoundedPolicySearch.setOracleRootActions(oracleEvaluated);
        if (nativeBasePolicyOpponentHistory && !nativeBasePolicyRoot) {
          nativeBasePolicyOpponentHistory.observe(engine);
          if (boundedPolicyOracleAudit)
            nativeBasePolicyOpponentHistory.compareOracle(oracleRecursion);
        }
        if (!nativeBasePolicyRoot)
          nativeBoundedPolicySearch.setOracleOpponentContext(
            boundedOpponentContextMode === "native" ?
              nativeBasePolicyOpponentHistory.contextView() :
            boundedOpponentContextMode === "native-gated" ?
              oracleRecursion ? nativeBasePolicyOpponentHistory.contextView() : null :
            boundedOpponentContextMode === "uniform" ? null :
              oracleRecursion);
        const nonContactBefore = nativeTacticalOwner.nonContactSkipCount;
        const strictBefore = nativeTacticalOwner.strictOwnerSkipCount;
        const committedBefore = nativeTacticalOwner.committedSkipCount;
        const incompleteBefore = nativeTacticalOwner.noCompleteValueCount;
        const proofIncumbentAction = boundedPolicyActiveOwner === "v3-base" &&
            (fullOracleTrace.emitted || fullControllerAction !== ACTION.NONE) ?
          fullControllerAction : action;
        const native = nativeBasePolicyRoot ?
          nativeBasePolicyRoot.selectOverride(engine,
            engine.lastSelectedIndex, proofIncumbentAction) :
          nativeTacticalOwner.selectOverride(engine,
            engine.lastSelectedIndex, proofIncumbentAction);
        if (boundedPolicyOracleAudit) {
          nativeTacticalOwner.annotateCapturedRootOracle(oracleEvaluated,
            oracleStageAction, oracleRounds);
          nativeBoundedPolicySearch.compareOneStep(engine, oracleTransitions,
            oracleRoot);
          nativeBoundedPolicySearch.compareDeepTransitions(engine, oracleRecursion);
          if (nativeBoundedPolicySearch.prepareCount > boundedBefore) {
            nativeBoundedPolicySearch.compareRootActionDomains(engine,
              oracleEvaluated, oracleRecursion);
            nativeBoundedPolicySearch.compareRootValueOrdering(engine,
              oracleRecursion);
            nativeBoundedPolicySearch.compareRecursion(oracleRecursion);
            nativeTacticalOwner.auditDominatedQualifiedFireAgainstOracle(
              engine, oracleRecursion);
          }
        }
        const nativeProposed = nativeTacticalOwner.proposalCount > nativeBefore;
        const nativeResult = nativeProposed ? NATIVE_RESULT.PROPOSED :
          nativeTacticalOwner.nonContactSkipCount > nonContactBefore ?
            NATIVE_RESULT.NON_CONTACT :
          nativeTacticalOwner.strictOwnerSkipCount > strictBefore ?
            NATIVE_RESULT.STRICT_OWNER :
          nativeTacticalOwner.committedSkipCount > committedBefore ?
            NATIVE_RESULT.COMMITTED :
          nativeTacticalOwner.noCompleteValueCount > incompleteBefore ?
            NATIVE_RESULT.NO_COMPLETE_VALUE : NATIVE_RESULT.OTHER_FALLBACK;
        if (boundedPolicyOracleAudit)
          nativeBoundedPolicySearch.compareInvocation(
            nativeBoundedPolicySearch.prepareCount > boundedBefore,
            Boolean(oracleRecursion), nativeResult);
        const observed = boundedPolicyOracleAudit ?
          nativeBasePolicyDifferential.observe(action, native,
            nativeProposed, oracle, oracleProposed,
            engine, nativeTacticalOwner, nativeResult,
            oracleRounds, oracleEvaluated, oracleMonteCarlo, oracleStageAction,
            fullControllerStage, fullControllerAction) : null;
        if (boundedPolicyOracleAudit && boundedPolicyActiveOwner === "oracle" &&
            nativeIntent && typeof nativeIntent.syncOracleRuntime === "function")
          nativeIntent.syncOracleRuntime(engine,
            v1StageOracle.lastRuntimeIntent,
            v1StageOracle.lastRuntimeIntentEpoch,
            v1StageOracle.lastRuntimeContextEpoch);
        const v3Base = fullOracleTrace && (fullOracleTrace.emitted ||
            fullControllerAction !== ACTION.NONE) ?
          { action: fullControllerAction, argument: 0xffff } : observed;
        let resolved = boundedPolicyActiveOwner === "native" ? native :
          boundedPolicyActiveOwner === "v3-only" ? v3Base :
          boundedPolicyActiveOwner === "v3-base" ?
            (nativeProposed ? native : v3Base) :
          boundedPolicyActiveOwner === "hybrid" ?
            (nativeProposed ? native : observed) : observed;
        if (nativePolicyResponseEnvelope) {
          const incumbentAction = resolved ? resolved.action : action;
          const policyAction = nativePolicyResponseEnvelope.observe(engine,
            nativeBoundedPolicySearch, nativeTacticalOwner, incumbentAction);
          if (policyAction) resolved = policyAction;
        }
        if (nativeLongOptionEventEnvelope) {
          const incumbentAction = resolved ? resolved.action : action;
          nativeLongOptionEventEnvelope.observe(engine,
            nativeBoundedPolicySearch, incumbentAction);
        }
        if (nativeLongOptionResponseMass) {
          const incumbentAction = resolved ? resolved.action : action;
          const incumbentArgument = resolved ?
            (resolved.argument ?? 0xffff) : argument;
          const responseMassAction = nativeLongOptionResponseMass.observe(engine,
            nativeBoundedPolicySearch, incumbentAction, incumbentArgument);
          if (responseMassAction) resolved = responseMassAction;
        }
        if (nativeRootVerifiedAttack &&
            engine.lastProofStatus !== PROOF_STATUS.PROVEN) {
          const incumbentAction = resolved ? resolved.action : action;
          const incumbentArgument = resolved ?
            (resolved.argument ?? 0xffff) : argument;
          let preferred = -1;
          for (let row = 0; row < engine.ourCount; row += 1) {
            if (engine.ourActions[row] !== incumbentAction ||
                engine.ourArguments[row] !== incumbentArgument) continue;
            if (!engine.finalGate.finalAllows(engine.adapter.bundle,
                engine.ourActions, engine.ourArguments, row,
                engine.ourCount)) continue;
            preferred = row; break;
          }
          const proposal = preferred < 0 ? -1 :
            nativeRootVerifiedAttack.evaluate(engine, preferred,
              engine.ourCount);
          if (nativeRootVerifiedAttack.active && proposal >= 0 &&
              proposal !== preferred) {
            if (!engine.finalGate.finalAllows(engine.adapter.bundle,
                engine.ourActions, engine.ourArguments, proposal,
                engine.ourCount)) nativeRootVerifiedAttack.rejectFinal();
            else {
              nativeRootVerifiedAttack.confirmOverride();
              resolved = { action: engine.ourActions[proposal],
                argument: engine.ourArguments[proposal], row: proposal };
            }
          }
        }
        if (nativeSelectivePoison) {
          const incumbentAction = resolved ? resolved.action : action;
          const incumbentArgument = resolved ? resolved.argument : argument;
          const poison = nativeSelectivePoison.selectOverride(engine,
            incumbentAction, incumbentArgument);
          if (poison) resolved = poison;
        }
        if (nativeSyntheticResourceRoot) {
          const incumbentAction = resolved ? resolved.action : action;
          const incumbentArgument = resolved ? resolved.argument : argument;
          const evidenceBefore = nativeSyntheticResourceRoot.evidenceCount;
          const poison = nativeSyntheticResourceRoot.selectOverride(engine,
            incumbentAction, incumbentArgument, nativeBoundedPolicySearch,
            nativeBoundedPolicySearch.prepareCount > boundedBefore);
          if (poison) resolved = poison;
          if (nativePoisonResourceOption) {
            const optionPoison = nativePoisonResourceOption.selectOverride(engine,
              incumbentAction, incumbentArgument, nativeBoundedPolicySearch,
              nativeSyntheticResourceRoot,
              nativeSyntheticResourceRoot.evidenceCount > evidenceBefore);
            if (optionPoison) resolved = optionPoison;
          }
        }
        if (nativePoisonAttackEventOption) {
          const incumbentAction = resolved ? resolved.action : action;
          const incumbentArgument = resolved ? resolved.argument : argument;
          const poison = nativePoisonAttackEventOption.selectOverride(engine,
            incumbentAction, incumbentArgument);
          if (poison) resolved = poison;
        }
        if (nativeLongOptionResponseMass)
          resolved = nativeLongOptionResponseMass.closeHostOverride(
            engine, action, argument, resolved);
        return resolved;
      } : nativePolicyPriorOwner ?
      (engine, action) => nativePolicyPriorOwner.selectOverride(engine,
        engine.lastSelectedIndex, action) : nativeTacticalOwner ?
      (engine, action) => nativeTacticalOwner.selectOverride(engine,
        engine.lastSelectedIndex, action) : v1StageOracle ?
      (engine, action, argument, context) => v1StageOracle.selectOverride(engine,
        engine.lastSelectedIndex, action, argument, context) : v1DirectInitiative ?
      (engine, action, argument, context) => v1DirectInitiative.selectOverride(engine,
        engine.lastSelectedIndex, action, argument, context,
        engine.adapter?.state?.arrays?.[0]?.[0] ?? -1) : visibleRayAlignment ?
      (engine, action, argument) => visibleRayAlignment.selectOverride(engine,
        engine.lastSelectedIndex, action, argument,
        engine.adapter?.state?.arrays?.[0]?.[0] ?? -1) : directClearFire ?
      (engine, action, argument) => directClearFire.selectOverride(engine,
        engine.lastSelectedIndex, action, argument,
        engine.adapter?.state?.arrays?.[0]?.[0] ?? -1) :
      activeAimMode === AIM_ACTIVE_MODE.OFF ? null :
      (engine, action, argument) => aimPostFireClosure.selectOverride(engine,
        engine.lastSelectedIndex, action, argument, activeAimMode,
        engine.adapter?.state?.arrays?.[0]?.[0] ?? -1),
    captureNoAcceptableCensus: kind === CANDIDATE.NO_ACCEPTABLE_CENSUS,
    noAcceptableSampleLimit: kind === CANDIDATE.NO_ACCEPTABLE_CENSUS ? 2 : 0,
    captureAttackOpportunityCensus:
      kind === CANDIDATE.ATTACK_FUNNEL_CENSUS ||
      kind === CANDIDATE.VERIFIED_ATTACK_PROPOSAL_SHADOW ||
      kind === CANDIDATE.VERIFIED_ATTACK_PROPOSAL_ACTIVE,
    captureEventDrivenOptionShadow:
      kind === CANDIDATE.EVENT_DRIVEN_OPTION_SHADOW ||
      kind === CANDIDATE.QUALIFIED_ATTACK_OVER_STAR_SHADOW ||
      kind === CANDIDATE.QUALIFIED_ATTACK_OVER_STAR_ACTIVE,
    captureStableOptionLedgerShadow:
      kind === CANDIDATE.STABLE_OPTION_LEDGER_SHADOW,
    captureStrategicStateLedgerShadow:
      kind === CANDIDATE.STRATEGIC_STATE_LEDGER_SHADOW,
    captureObjectiveEpochContinuityShadow:
      kind === CANDIDATE.STRATEGIC_STATE_LEDGER_SHADOW,
    captureObjectiveEpochExecutionShadow:
      kind === CANDIDATE.STRATEGIC_STATE_LEDGER_SHADOW,
    captureObjectiveEpochOptionArbiterShadow:
      kind === CANDIDATE.OBJECTIVE_EPOCH_OPTION_ARBITER_SHADOW,
    captureObjectiveEpochOptionIntervalShadow:
      kind === CANDIDATE.OBJECTIVE_EPOCH_OPTION_INTERVAL_SHADOW,
    captureSemanticObjectiveEpochOptionIntervalShadow:
      kind === CANDIDATE.SEMANTIC_OBJECTIVE_EPOCH_OPTION_INTERVAL_SHADOW,
    captureSemanticAttackOptionCoverageShadow:
      kind === CANDIDATE.SEMANTIC_ATTACK_OPTION_COVERAGE_SHADOW,
    captureSemanticAttackExecutionIntervalShadow:
      kind === CANDIDATE.SEMANTIC_ATTACK_EXECUTION_INTERVAL_SHADOW,
    captureSemanticAttackPolicyIntervalShadow:
      kind === CANDIDATE.SEMANTIC_ATTACK_POLICY_INTERVAL_SHADOW ||
      kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW,
    semanticAttackExecutionDepth: 2,
    semanticAttackExecutionNodeBudget: 256,
    semanticAttackPolicyDepth: 2,
    semanticAttackPolicyNodeBudget: 256,
    semanticAttackPolicyDepthStability:
      option("--semantic-attack-depth-stability", "false") === "true" &&
      kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW,
    semanticAttackPolicyDepthWidthStability:
      option("--semantic-attack-depth-width-stability", "false") === "true" &&
      kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW,
    semanticAttackPolicyDepthMoveVariant:
      option("--semantic-attack-depth-move-variant", "false") === "true" &&
      kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW,
    semanticAttackPolicyDepthLeafBackup:
      option("--semantic-attack-depth-leaf-backup", "false") === "true" &&
      kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW,
    semanticAttackPolicyDepthResponseMatrix:
      option("--semantic-attack-depth-response-matrix", "false") === "true" &&
      kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW,
    semanticAttackPolicyResponseConditioned:
      option("--semantic-attack-response-conditioned", "false") === "true" &&
      kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW,
    semanticAttackPolicyEventDeadline:
      option("--semantic-attack-event-deadline", "false") === "true" &&
      kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW,
    semanticAttackPolicyEventHorizon:
      option("--semantic-attack-event-horizon", "false") === "true" &&
      kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW,
    semanticAttackPolicyCommonContinuation:
      kind === CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW,
    objectiveEpochOptionIntervalDepth: 2,
    objectiveEpochOptionIntervalNodeBudget: 256,
    captureStrategicConflictArbiterShadow:
      kind === CANDIDATE.STRATEGIC_CONFLICT_ARBITER_SHADOW,
    captureStrategicTargetExecutionShadow:
      kind === CANDIDATE.STRATEGIC_TARGET_EXECUTION_SHADOW,
    captureStableOptionIntervalShadow:
      kind === CANDIDATE.STABLE_OPTION_INTERVAL_SHADOW,
    captureAttackContinuationProgressShadow:
      kind === CANDIDATE.ATTACK_CONTINUATION_PROGRESS_SHADOW,
    captureAttackSequenceGeneratorShadow:
      kind === CANDIDATE.ATTACK_SEQUENCE_GENERATOR_SHADOW,
    captureAttackPolicyReachabilityShadow:
      kind === CANDIDATE.ATTACK_POLICY_REACHABILITY_SHADOW,
    captureAttackResponseSetShadow:
      kind === CANDIDATE.ATTACK_RESPONSE_SET_SHADOW,
    captureCombatUtilityEnvelopeShadow:
      kind === CANDIDATE.COMBAT_UTILITY_ENVELOPE_SHADOW,
    captureAttackStarPolicyFrontierShadow:
      kind === CANDIDATE.ATTACK_STAR_POLICY_FRONTIER_SHADOW,
    captureResponseConditionedOptionPolicyShadow:
      kind === CANDIDATE.RESPONSE_CONDITIONED_OPTION_POLICY_SHADOW,
    captureAllFrames,
    captureOptionProposalRoots:
      kind === CANDIDATE.INFORMATION_OPTION_LEGACY_SETUP_ACTIVE,
    captureRiskConditionedCombatRoots:
      kind === CANDIDATE.RISK_CONDITIONED_COMBAT_SHADOW ||
      kind === CANDIDATE.RISK_CONDITIONED_COMBAT_ACTIVE ||
      kind === CANDIDATE.RISK_CONDITIONED_RESPONSE_POLICY_ACTIVE,
    captureStrategicTargetExecutionRoots:
      kind === CANDIDATE.STRATEGIC_TARGET_EXECUTION_SHADOW,
    captureTwoStageSetupRoots:
      kind === CANDIDATE.INFORMATION_OPTION_TWO_STAGE_SHADOW ||
      kind === CANDIDATE.INFORMATION_OPTION_TWO_STAGE_ACTIVE ||
      kind === CANDIDATE.INFORMATION_OPTION_POSSIBLE_PROJECTILE_SHADOW,
    captureCompactFrames: true,
    captureExceptionalFrames: false
  });
  candidateBot.objectiveEpochActivePoc = objectiveEpochActive;
  candidateBot.semanticObjectiveEpochOptionActivePoc =
    semanticObjectiveEpochActive;
  candidateBot.semanticAttackPolicyIntervalActivePoc =
    semanticAttackPolicyActive;
  if (nativeOwnSkillActionBridge)
    nativeOwnSkillActionBridge.install(candidateBot.engine);
  if (nativeLeafEvaluator && !nativeBoundedPolicySearch)
    nativeLeafEvaluator.install(candidateBot.engine.depthSearch);
  if (nativeRepresentative) nativeRepresentative.install(candidateBot.engine.depthSearch);
  if (nativeHistory) nativeHistory.install(candidateBot.engine.depthSearch);
  if (nativeAttackPoseFeedback)
    nativeAttackPoseFeedback.install(candidateBot.engine.depthSearch);
  const captureV1Ownership = kind === CANDIDATE.V1_DIRECT_ENTRY_OWNERSHIP_CENSUS;
  const controlBot = basePolicyDifferential ?
    new V3DiagnosticBot({ enableOwnershipTrace: captureV1Ownership,
      source: INSTRUMENTED_V1_POLICY_SOURCE,
      sourceFile: FROZEN_V1_FILE, sourceSha256: FROZEN_V1_SHA256 }) :
    new V3DiagnosticBot({ enableOwnershipTrace: captureV1Ownership });
  const candidateAudit = new DecisionAudit(candidateBot, { captureCompactFrames: true });
  const controlAudit = new DecisionAudit(controlBot, { captureCompactFrames: true });
  const candidate = captureShotQuality ?
    new ShotQualityDecisionAudit(candidateAudit, candidateBot.engine,
      aimPostFireClosure, activeAimMode !== AIM_ACTIVE_MODE.OFF) : candidateAudit;
  const control = captureShotQuality ?
    new ShotQualityDecisionAudit(controlAudit, null, null, false,
      controlBot.controller.ownershipTrace) : controlAudit;
  const bots = candidateSeat === 0 ? [candidate, control] : [control, candidate];
  const replay = built.simulator.run(bots[0], bots[1]);
  const result = rawResult(replay, candidateSeat);
  const candidateSummary = candidate.summary(); const controlSummary = control.summary();
  if (objectiveEpochActive)
    candidateSummary.objectiveEpochActivePoc = objectiveEpochActive.summary();
  if (semanticObjectiveEpochActive)
    candidateSummary.semanticObjectiveEpochOptionActivePoc =
      semanticObjectiveEpochActive.summary();
  if (semanticAttackPolicyActive)
    candidateSummary.semanticAttackPolicyIntervalActivePoc =
      semanticAttackPolicyActive.summary();
  if (directClearFire) candidateSummary.directClearSafeFire = directClearFire.summary();
  if (visibleRayAlignment)
    candidateSummary.visibleRayAlignment = visibleRayAlignment.summary();
  if (v1DirectInitiative)
    candidateSummary.v1DirectInitiativeTransplant = v1DirectInitiative.summary();
  if (v1StageOracle)
    candidateSummary.v1StageOracleTransplant = v1StageOracle.summary();
  if (nativeTacticalOwner && typeof nativeTacticalOwner.summary === "function")
    candidateSummary.nativeTacticalActionOwner = nativeTacticalOwner.summary();
  if (nativeBasePolicyOpponentHistory &&
      typeof nativeBasePolicyOpponentHistory.summary === "function")
    candidateSummary.nativeBasePolicyOpponentHistory =
      nativeBasePolicyOpponentHistory.summary();
  if (nativeBoundedPolicySearchMethodCensus)
    candidateSummary.nativeBoundedPolicySearchMethodCensus =
      nativeBoundedPolicySearchMethodCensus.summary();
  if (nativeLeafMethodCensus)
    candidateSummary.nativeBasePolicyLeafMethodCensus =
      nativeLeafMethodCensus.summary();
  if (nativePathMethodCensus)
    candidateSummary.nativeBasePolicyPathMethodCensus =
      nativePathMethodCensus.summary();
  if (nativeOwnSkillActionBridge)
    candidateSummary.nativeOwnSkillActionBridge = nativeOwnSkillActionBridge.summary();
  if (terminalOracleIntervention)
    candidateSummary.terminalOracleIntervention =
      terminalOracleIntervention.summary();
  if (nativeSelectivePoison)
    candidateSummary.nativeSelectivePoison = nativeSelectivePoison.summary();
  if (nativeTerminalTradeAudit)
    candidateSummary.nativeTerminalTradeAudit = nativeTerminalTradeAudit.summary();
  if (nativeCandidateForcedWin)
    candidateSummary.nativeCandidateForcedWin = nativeCandidateForcedWin.summary();
  if (nativeSyntheticResourceRoot)
    candidateSummary.nativeSyntheticResourceRoot =
      nativeSyntheticResourceRoot.summary();
  if (nativePoisonResourceOption)
    candidateSummary.nativePoisonResourceOption =
      nativePoisonResourceOption.summary();
  if (nativePoisonAttackEventOption)
    candidateSummary.nativePoisonAttackEventOption =
      nativePoisonAttackEventOption.summary();
  if (nativePolicyResponseEnvelope)
    candidateSummary.nativePolicyResponseEnvelope =
      nativePolicyResponseEnvelope.summary();
  if (nativeLongOptionEventEnvelope)
    candidateSummary.nativeLongOptionEventEnvelope =
      nativeLongOptionEventEnvelope.summary();
  if (nativeLongOptionResponseMass)
    candidateSummary.nativeLongOptionResponseMass =
      nativeLongOptionResponseMass.summary();
  if (nativeRootVerifiedAttack)
    candidateSummary.nativeRootVerifiedAttack =
      nativeRootVerifiedAttack.summary();
  if (nativePolicyPriorOwner)
    candidateSummary.nativePolicyPriorOwner = nativePolicyPriorOwner.summary();
  if (nativeBasePolicyDifferential)
    candidateSummary.nativeBasePolicyDifferential =
      nativeBasePolicyDifferential.summary();
  if (nativeDomain && typeof nativeDomain.summary === "function")
    candidateSummary.nativeTacticalDomain = nativeDomain.summary();
  if (nativeLeafEvaluator && typeof nativeLeafEvaluator.summary === "function")
    candidateSummary.nativeTacticalLeafEvaluator = nativeLeafEvaluator.summary();
  else if (nativeLeafEvaluator)
    candidateSummary.nativeBasePolicyThinLeaf = {
      starFieldCacheEntries: nativeLeafEvaluator.starFieldCacheEntries,
      starFieldCount: nativeLeafEvaluator.starFieldCount,
      starFieldCacheHitCount: nativeLeafEvaluator.starFieldCacheHitCount,
      starFieldCacheMissCount: nativeLeafEvaluator.starFieldCacheMissCount,
      starFieldCacheTerrainCompareCount:
        nativeLeafEvaluator.starFieldCacheTerrainCompareCount,
      starFieldCacheTerrainCellCompareCount:
        nativeLeafEvaluator.starFieldCacheTerrainCellCompareCount,
      starFieldCacheRootCompareCount:
        nativeLeafEvaluator.starFieldCacheRootCompareCount,
      starFieldCacheRootRebindCount:
        nativeLeafEvaluator.starFieldCacheRootRebindCount,
      hotAllocationCount: nativeLeafEvaluator.hotAllocationCount
    };
  if (nativeBoundedPolicySearch?.pathUtility &&
      typeof nativeBoundedPolicySearch.pathUtility.summary === "function")
    candidateSummary.nativeV1PathUtility =
      nativeBoundedPolicySearch.pathUtility.summary();
  if (nativeRepresentative)
    candidateSummary.nativeTacticalRepresentative = nativeRepresentative.summary();
  if (nativeIntent && typeof nativeIntent.summary === "function")
    candidateSummary.nativeTacticalIntent = nativeIntent.summary();
  if (nativeAttackPose)
    candidateSummary.nativeAttackPoseOption = nativeAttackPose.summary();
  if (nativeAttackPoseFeedback)
    candidateSummary.nativeAttackPoseFeedbackSearch = nativeAttackPoseFeedback.summary();
  if (nativeHistory) candidateSummary.nativeTacticalHistory = nativeHistory.summary();
  let shotQualityRecords = null;
  if (captureShotQuality) {
    const rootsBySeat = candidateSeat === 0 ?
      [candidateSummary.shotRootCensus.records, controlSummary.shotRootCensus.records] :
      [controlSummary.shotRootCensus.records, candidateSummary.shotRootCensus.records];
    const attributed = collectShotOutcomeRecords(replay, rootsBySeat);
    shotQualityRecords = { candidate: attributed[candidateSeat],
      control: attributed[candidateSeat ^ 1],
      candidateUnpairedProjectiles: attributed.unpairedProjectiles[candidateSeat],
      controlUnpairedProjectiles: attributed.unpairedProjectiles[candidateSeat ^ 1] };
    delete candidateSummary.shotRootCensus.records;
    delete controlSummary.shotRootCensus.records;
  }
  const match = {
    implementation: kind,
    matchUrlId: scenario.matchUrlId,
    scenarioFingerprint: scenario.fingerprint,
    candidateSeat,
    seatImplementations: candidateSeat === 0 ? ["v2", "v1"] : ["v1", "v2"],
    seatSkills: built.skills,
    frames: replay.replayData.replay.records.length,
    result,
    counts: collectCounts(replay, candidateSeat),
    projectileFunnel: collectProjectileFunnel(replay),
    ...(shotQualityRecords ? { shotQualityRecords } : {}),
    candidate: candidateSummary,
    candidateEngine: candidateBot.summary(),
    control: controlSummary
  };
  const analysis = classify(match);
  match.analysisOutcome = analysis.outcome;
  match.terminalCategory = analysis.terminalCategory;
  return match;
}

function add(target, source) {
  for (const [key, value] of Object.entries(source || {}))
    target[key] = (target[key] || 0) + value;
}

function addNested(target, source) {
  for (const [outer, values] of Object.entries(source || {})) {
    if (!target[outer]) target[outer] = {};
    add(target[outer], values);
  }
}

function addArray(target, source) {
  if (!Array.isArray(source)) return target;
  if (!Array.isArray(target) || target.length < source.length) {
    const grown = new Array(source.length).fill(0);
    if (Array.isArray(target)) for (let index = 0; index < target.length; index += 1)
      grown[index] = target[index];
    target = grown;
  }
  for (let index = 0; index < source.length; index += 1)
    target[index] += source[index] || 0;
  return target;
}

function addSparse(target, source) {
  for (const entry of source || []) target[entry[0]] = (target[entry[0]] || 0) + entry[1];
}

function geometryAccumulator() {
  return { decisionCount: 0, visibleCount: 0, geometryCount: new Array(5).fill(0),
    geometryActionCount: new Array(30).fill(0),
    directActionCount: new Array(6).fill(0),
    directEntryActionCount: new Array(6).fill(0),
    directDistanceCount: new Array(4).fill(0),
    geometryTransitionCount: new Array(25).fill(0),
    directEntryPreviousActionCount: new Array(30).fill(0),
    directEntryPreviousOwnershipCount:
      new Array(OWNERSHIP_STAGE_NAMES.length).fill(0),
    directEntryCurrentOwnershipCount:
      new Array(OWNERSHIP_STAGE_NAMES.length).fill(0),
    wrongFacingOwnershipCount: new Array(OWNERSHIP_STAGE_NAMES.length).fill(0),
    directEntryDistanceCount: new Array(4).fill(0), directEntryCount: 0,
    initialDirectCount: 0,
    directEntryConvertedToFireCount: 0,
    directEntryAbandonedWithoutFireCount: 0,
    directEntryHiddenWithoutFireCount: 0,
    wrongFacingCorrectTurnCount: 0, wrongFacingWrongTurnCount: 0,
    wrongFacingNonTurnCount: 0, visibleEpisodeCount: 0,
    visibleEpisodeReachedDirectCount: 0, visibleEpisodeDirectFireCount: 0,
    visibleEpisodeWithoutDirectCount: 0, maximumVisibleEpisodeLength: 0,
    maximumDirectRun: 0, hotAllocationCount: 0 };
}

function addGeometry(target, source) {
  if (!source) return;
  for (const key of ["decisionCount", "visibleCount", "directEntryCount",
    "initialDirectCount", "directEntryConvertedToFireCount",
    "directEntryAbandonedWithoutFireCount", "directEntryHiddenWithoutFireCount",
    "wrongFacingCorrectTurnCount", "wrongFacingWrongTurnCount",
    "wrongFacingNonTurnCount", "visibleEpisodeCount",
    "visibleEpisodeReachedDirectCount", "visibleEpisodeDirectFireCount",
    "visibleEpisodeWithoutDirectCount",
    "hotAllocationCount"]) target[key] += source[key] || 0;
  target.maximumDirectRun = Math.max(target.maximumDirectRun,
    source.maximumDirectRun || 0);
  target.maximumVisibleEpisodeLength = Math.max(target.maximumVisibleEpisodeLength,
    source.maximumVisibleEpisodeLength || 0);
  for (const key of ["geometryCount", "geometryActionCount", "directActionCount",
    "directEntryActionCount", "directDistanceCount",
    "geometryTransitionCount", "directEntryPreviousActionCount",
    "directEntryDistanceCount", "directEntryPreviousOwnershipCount",
    "directEntryCurrentOwnershipCount", "wrongFacingOwnershipCount"])
    for (let index = 0; index < target[key].length; index += 1)
      target[key][index] += source[key]?.[index] || 0;
}

function censusAccumulator() {
  return { decisionCount: 0, rootCount: 0, rootBasisPoints: 0,
    completeSafeWitnessRoots: 0, committedFreeAlternativeRoots: 0,
    incompleteSupportRoots: 0, primary: {}, failedUnionMasks: {},
    failedIntersectionMasks: {}, sourcePresenceMasks: {}, sourceUnavoidableMasks: {},
    unknownOriginMasks: {}, unknownMinimumCounts: {},
    unknownPossibleProjectileCounts: {}, unknownObservationSupportCounts: {},
    unknownRows: { observationNoWitness: 0, observationIncomplete: 0, baseSafety: 0 },
    riskCounts: {}, selectedActionCounts: {} };
}

function addCensus(target, source) {
  if (!source) return;
  target.decisionCount += source.decisionCount || 0;
  target.rootCount += source.rootCount || 0;
  target.completeSafeWitnessRoots += source.completeSafeWitnessRoots || 0;
  target.committedFreeAlternativeRoots += source.committedFreeAlternativeRoots || 0;
  target.incompleteSupportRoots += source.incompleteSupportRoots || 0;
  add(target.primary, source.primary);
  addSparse(target.failedUnionMasks, source.failedUnionMasks);
  addSparse(target.failedIntersectionMasks, source.failedIntersectionMasks);
  addSparse(target.sourcePresenceMasks, source.sourcePresenceMasks);
  addSparse(target.sourceUnavoidableMasks, source.sourceUnavoidableMasks);
  addSparse(target.unknownOriginMasks, source.unknownOriginMasks);
  addSparse(target.unknownMinimumCounts, source.unknownMinimumCounts);
  addSparse(target.unknownPossibleProjectileCounts, source.unknownPossibleProjectileCounts);
  addSparse(target.unknownObservationSupportCounts, source.unknownObservationSupportCounts);
  add(target.unknownRows, source.unknownRows);
  addSparse(target.riskCounts, source.riskCounts);
  addSparse(target.selectedActionCounts, source.selectedActionCounts);
}

function summarize(matches, kind) {
  const selected = matches.filter(match => match.implementation === kind);
  const candidateShotRecords = []; const controlShotRecords = [];
  let candidateUnpairedProjectiles = 0; let controlUnpairedProjectiles = 0;
  const output = {
    implementation: kind,
    matches: selected.length,
    scenarios: selected.length / 2,
    wins: 0,
    losses: 0,
    draws: 0,
    scoreBasisPoints: 0,
    scorePercent: "0.00",
    stars: { candidate: 0, control: 0 },
    crashes: { candidate: 0, control: 0 },
    bullets: { candidate: 0, control: 0 },
    bombs: { candidate: 0, control: 0 },
    skills: { candidate: 0, control: 0 },
    projectileFunnel: {
      candidate: { created: 0, tankKills: 0, shieldBreaks: 0,
        terrainHits: 0, noTankImpact: 0, survivedAtTerminal: 0,
        counterCrashWithin4: 0, lifetimeFrames: 0,
        lifetimeHistogram: new Array(10).fill(0) },
      control: { created: 0, tankKills: 0, shieldBreaks: 0,
        terrainHits: 0, noTankImpact: 0, survivedAtTerminal: 0,
        counterCrashWithin4: 0, lifetimeFrames: 0,
        lifetimeHistogram: new Array(10).fill(0) }
    },
    actions: { candidate: {}, control: {} },
    pairs: { candidateSweep: 0, controlSweep: 0, split: 0, drawAffected: 0 },
    runtime: { candidateTotalMicros: 0, controlTotalMicros: 0,
      candidateP95Max: 0, controlP95Max: 0 },
    invariants: { timeoutError: 0, avoidableHardReject: 0,
      riskDominatedSelection: 0, rootRestoreFailure: 0 },
    initiative: {}
  };
  output.attackGeometryOpportunity = {
    candidate: geometryAccumulator(), control: geometryAccumulator()
  };
  output.responseOption = {};
  output.optionPortfolio = {};
  output.objectiveOption = {};
  output.expandedTacticalContact = {};
  output.contactSearchFunnel = {};
  output.contactSupportCensus = { gapBitCount: new Array(14).fill(0),
    possibleCount: new Array(9).fill(0) };
  output.nominalPhysicalEvidence = {};
  output.optionAwareSearch = {};
  output.actionContinuationEnvelope = {};
  output.commonPolicyOptionInterval = {};
  output.aimSetupPostFireClosure = { behaviorNeutral: true };
  output.directClearSafeFire = {};
  output.visibleRayAlignment = {};
  output.v1DirectInitiativeTransplant = {};
  output.v1StageOracleTransplant = {};
  output.nativeTacticalActionOwner = {};
  output.nativeOwnSkillActionBridge = {};
  output.terminalOracleIntervention = {};
  output.nativeSelectivePoison = {};
  output.nativeTerminalTradeAudit = {};
  output.nativeCandidateForcedWin = {};
  output.nativeSyntheticResourceRoot = {};
  output.nativePoisonResourceOption = {};
  output.nativePoisonAttackEventOption = {};
  output.nativePolicyResponseEnvelope = {};
  output.nativeLongOptionEventEnvelope = {};
  output.nativeLongOptionResponseMass = {};
  output.nativeRootVerifiedAttack = {};
  output.nativeBoundedPolicySearch = { transitionPairs: {},
    transitionStatusFieldMismatch: new Array(14).fill(0),
    transitionRootStatusFieldMismatch: new Array(14).fill(0),
    transitionExactComponentSignedDifference: new Array(8).fill(0),
    transitionExactComponentAbsDifference: new Array(8).fill(0) };
  output.nativePolicyPriorOwner = {};
  output.nativeBasePolicyDifferential = {
    familyPairs: {}, exactPairs: {}, intentPairs: {},
    fallbackByReason: new Array(6).fill(0),
    fallbackDisagreementByReason: new Array(6).fill(0),
    compareByNativeDepth: new Array(5).fill(0),
    agreementByNativeDepth: new Array(5).fill(0),
    disagreementByNativeDepth: new Array(5).fill(0),
    depthRoundPairs: new Array(25).fill(0),
    basePolicyVerifierCompareCount: new Array(7).fill(0),
    basePolicyVerifierAgreementCount: new Array(7).fill(0),
    fullControllerStageCount: new Array(OWNERSHIP_STAGE_NAMES.length).fill(0),
    fullControllerStageAgreementCount:
      new Array(OWNERSHIP_STAGE_NAMES.length).fill(0),
    missedV1FireGapBuckets: new Array(11).fill(0)
  };
  output.nativeTacticalDomain = {};
  output.nativeTacticalLeafEvaluator = {};
  output.nativeV1PathUtility = {};
  output.nativeTacticalRepresentative = {};
  output.nativeTacticalIntent = {};
  output.nativeAttackPoseOption = {};
  output.nativeAttackPoseFeedbackSearch = {};
  output.nativeTacticalHistory = {};
  output.attackOpportunity = { decisionCount: 0, row: {}, root: {}, firstBlock: {},
    hotAllocationCount: 0 };
  output.verifiedAttackProposal = {};
  output.attackObjectiveField = {};
  output.eventDrivenOptionShadow = {
    selectedKind: {}, riskEligibleKind: {}, availableKind: {}, eventFramesByBit: {},
    switchesByEventBit: {}, runLengthBuckets: new Array(5).fill(0),
    switchMatrix: {}, eventSwitchMatrix: {}, unsignaledSwitchMatrix: {},
    foregoneMatrix: {}, riskEligibleMasks: {}, availableMasks: {}
  };
  output.stableOptionLedgerShadow = {
    createdByKind: {}, reusedByKind: {}, revalidatedByKind: {}, expiredByKind: {},
    qualifiedFramesByKind: {}, selectedByKind: {}, selectedExistingByKind: {},
    selectedNewByKind: {}, gapStartsByKind: {}, gapRecoveriesByKind: {},
    expiryReasons: {}
  };
  output.strategicStateLedgerShadow = {
    selectedByScoreKind: {}, selectedByPhaseKind: {}, actionByScore: {},
    targetRunsByScoreKind: {}, targetFramesByScoreKind: {},
    maximumTargetRunByScoreKind: {}, planCommitsByScoreKind: {},
    planActivationsByScoreKind: {}, planCompletionsByScoreKind: {},
    planInvalidationsByScoreKind: {}, deadlineSlackBuckets: {},
    generationSwitchByScore: {}, eventSwitchByScore: {},
    unsignaledSwitchByScore: {}, qualifiedAttackRootByScore: {},
    qualifiedStarRootByScore: {}, selectedAttackWithStarAlternativeByScore: {},
    selectedStarWithAttackAlternativeByScore: {},
    selectedResourceWithStarAlternativeByScore: {},
    attackStarPathRegressionByScore: {}, resourceStarPathRegressionByScore: {},
    eventFramesByScore: {}, noEventFramesByScore: {},
    lifecycleCreationsByScore: {}, lifecycleExpiriesByScore: {},
    lifecycleGapsByScore: {}, lifecycleRecoveriesByScore: {}
  };
  output.objectiveEpochContinuityShadow = {
    statusCount: {}, adoptedByKind: {}, heldFromKind: {}, replannedToKind: {},
    executionRowsByKind: {}, supportedFramesByKind: {}, gapFramesByKind: {},
    selectedInsideByKind: {}, selectedOutsideByKind: {}, searchInsideByKind: {},
    searchOutsideByKind: {}, holdMatrix: {}, gapSelectedMatrix: {}
  };
  output.objectiveEpochExecutionShadow = {
    strictSupportedByKind: {}, expandedSupportedByKind: {}, recoveredGapByKind: {},
    remainingGapByKind: {}, generatedRowsByKind: {},
    selectedInsideExpandedByKind: {}, searchInsideExpandedByKind: {},
    searchOutsideExpandedByKind: {}
  };
  output.objectiveEpochActivePoc = {};
  output.semanticObjectiveEpochOptionActivePoc = {};
  output.semanticAttackOptionCoverageShadow = {
    funnel: {}, rawByAction: {}, completeByAction: {}, strictByAction: {}
  };
  output.semanticAttackExecutionIntervalShadow = {
    candidateByAction: {}, field: {}, interval: {}
  };
  output.semanticAttackPolicyIntervalShadow = {
    candidateByAction: {}, dominanceByAction: {}, pose: {}, objective: {},
    depthStability: { lanes: [] }, depthWidthStability: { lanes: [] },
    eventHorizon: {}, policy: {
      feedback: {}
    }
  };
  output.semanticAttackPolicyIntervalActivePoc = {
    shadow: { candidateByAction: {}, dominanceByAction: {}, pose: {}, policy: {
      feedback: {}
    } }
  };
  output.objectiveEpochOptionArbiterShadow = { proposalByAction: {}, interval: {},
    intervalAttemptByKind: {}, intervalCompleteByKind: {},
    intervalWorseByKind: {}, intervalEqualByKind: {},
    intervalDominanceByKind: {}, intervalIncompleteByKind: {},
    intervalSkippedByKind: {} };
  output.strategicConflictArbiterShadow = {
    decisionByScore: {}, actualSelectionByScore: {}, proposalByScore: {},
    starCostByScore: {}, deadlineAdvantageByScore: {}, durableCombatByScore: {}
  };
  output.strategicTargetExecutionShadow = {
    statusCounts: {}, proposalByAction: {}
  };
  output.stableOptionIntervalShadow = {};
  output.attackContinuationProgressShadow = {
    bitCounts: {}, maskCounts: new Array(256).fill(0)
  };
  output.attackSequenceGeneratorShadow = { candidateByAction: {},
    certifiedByAction: {}, closure: { reasonBitCounts: new Array(13).fill(0) } };
  output.attackPolicyReachabilityShadow = { candidateByAction: {},
    provenByAction: {}, statusByDepth: new Array(15).fill(0),
    goalLeafCounts: new Array(3).fill(0) };
  output.attackResponseSetShadow = { candidateByAction: {},
    strictSupersetByAction: {},
    coverageHistogram: new Array(25).fill(0) };
  output.combatUtilityEnvelopeShadow = {
    offensiveGainByRisk: new Array(6).fill(0),
    qualifiedByRisk: new Array(6).fill(0),
    evaluationBySelectedKind: {},
    qualifiedWithoutStarCostBySelectedKind: {}
  };
  output.attackStarPolicyFrontierShadow = {};
  output.responseConditionedOptionPolicyShadow = {
    relationByRisk: new Array(24).fill(0)
  };
  output.riskConditionedResponsePolicyShadow = {
    relationByRisk: new Array(24).fill(0)
  };
  output.riskConditionedCombatProposal = {};
  output.qualifiedAttackOverStar = {};
  output.strategicAttackOverStarProposal = { proposalByScore: {},
    durableCombatBlockCensus: { relation: new Array(4).fill(0),
      byScore: new Array(3).fill(0),
      positiveDimensionCount: new Array(7).fill(0),
      robustSignCount: new Array(18).fill(0), robustSignPattern: [],
      robustSum: new Array(6).fill(0), physicalSignalMask: [],
      starCostMask: new Array(4).fill(0),
      temporalPositiveDimensionCount: new Array(6).fill(0),
      temporalRobustSignCount: new Array(15).fill(0),
      temporalRobustSignPattern: [], temporalRobustSum: new Array(5).fill(0) },
    response: {
    relationByRisk: new Array(24).fill(0),
    possibleProjectileCount: new Array(9).fill(0),
    rolloutFailureByReason: [], rolloutFailureByPhaseReason: [],
    rolloutFailureByOptionReason: [], rolloutFailureByStepReason: [],
    rolloutFailureByEnemyActionReason: [], rolloutIncompleteRootByReason: [],
    rolloutFailureByUnsupportedSite: [],
    rolloutIncompleteRootByUnsupportedSite: [],
    rolloutFailureByAppliedActionPair: [], moveContestVariantEnvelope: {
      completeByVariant: new Array(4).fill(0),
      incompleteByVariant: new Array(4).fill(0),
      statusByVariant: [], relationByRisk: new Array(24).fill(0)
    }
  } };
  output.persistentAttackTarget = { statusCount: {}, proposalByAction: {} };
  output.optionScopedTargetContinuation = {};
  output.optionInformationInterval = {};
  output.optionInformationInterval.proposalKindCount = new Array(8).fill(0);
  output.optionInformationInterval.actionTransitionCount = new Array(256).fill(0);
  output.attackSetupClosure = {};
  output.twoStageAttackSetup = {};
  output.twoStageAttackSetup.reasonBitCounts = new Array(13).fill(0);
  output.possibleProjectileAttackSetup = {};
  output.noAcceptableCensus = censusAccumulator();
  output.selective = { frames: 0, nodes: 0, depthCounts: new Array(8).fill(0) };
  output.strictRescue = { checks: 0, candidates: 0, overrides: 0,
    finalRejects: 0, proofConflicts: 0, legacyRestrictions: 0 };
  output.verifiedDirectKill = { checks: 0, candidates: 0, overrides: 0,
    finalRejects: 0, observed: 0, hardBlocked: 0, riskBlocked: 0,
    closureBlocked: 0, purposeBlocked: 0, escapeBlocked: 0,
    exposureBlocked: 0, robustBlocked: 0, sourceBlocked: 0, alreadySelected: 0,
    causalCandidates: 0, causalOverrides: 0 };
  output.residualAttackProof = { checks: 0, proven: 0, disproven: 0,
    unknown: 0, incompleteSupportProven: 0, nodes: 0, rootRestoreFailures: 0 };
  output.strictSafeThreatFireShadow = { scheduled: 0, exactBlocked: 0,
    possibleOnlyBlocked: 0, possibleWithOtherBlocked: 0, otherGapBlocked: 0,
    gapBitCount: new Array(15).fill(0), possibleCount: new Array(9).fill(0),
    possiblePoolComplete: 0, possiblePoolIncomplete: 0, budgetBlocked: 0,
    resolvedPossibleGap: 0,
    rootFireBlocked: 0, proven: 0, doomedProven: 0,
    threatOnlyProven: 0, pacComplete: 0, pacIncomplete: 0,
    prunableRoots: 0, prunableColumns: 0, prunableRootNodes: 0,
    unknown: 0, actionable: 0,
    alreadyFire: 0, active: 0, doomedActive: 0, overrides: 0,
    doomedOverrides: 0, missingRows: 0,
    finalRejects: 0, nodes: 0, workUnits: 0, restoreFailures: 0,
    hotAllocations: 0 };
  let scoreUnits = 0;
  for (const match of selected) {
    if (match.analysisOutcome === "V2_WIN") {
      output.wins += 1;
      scoreUnits += 2;
    } else if (match.analysisOutcome === "V1_WIN") output.losses += 1;
    else {
      output.draws += 1;
      scoreUnits += 1;
    }
    const seat = match.candidateSeat;
    const other = seat ^ 1;
    output.stars.candidate += match.counts.stars[seat];
    output.stars.control += match.counts.stars[other];
    output.crashes.candidate += match.counts.crashes[seat];
    output.crashes.control += match.counts.crashes[other];
    output.bullets.candidate += match.counts.bullets[seat];
    output.bullets.control += match.counts.bullets[other];
    output.bombs.candidate += match.counts.bombs[seat];
    output.bombs.control += match.counts.bombs[other];
    output.skills.candidate += match.counts.skills[seat];
    output.skills.control += match.counts.skills[other];
    if (match.shotQualityRecords) {
      candidateShotRecords.push(...match.shotQualityRecords.candidate);
      controlShotRecords.push(...match.shotQualityRecords.control);
      candidateUnpairedProjectiles +=
        match.shotQualityRecords.candidateUnpairedProjectiles || 0;
      controlUnpairedProjectiles +=
        match.shotQualityRecords.controlUnpairedProjectiles || 0;
    }
    const projectileFunnel = match.projectileFunnel;
    if (projectileFunnel) for (const [target, sourceSeat] of [
      [output.projectileFunnel.candidate, seat],
      [output.projectileFunnel.control, other]]) {
      for (const key of ["created", "tankKills", "shieldBreaks", "terrainHits",
        "noTankImpact", "survivedAtTerminal", "counterCrashWithin4",
        "lifetimeFrames"]) target[key] += projectileFunnel[key][sourceSeat] || 0;
      for (let index = 0; index < target.lifetimeHistogram.length; index += 1)
        target.lifetimeHistogram[index] +=
          projectileFunnel.lifetimeHistogram[sourceSeat][index] || 0;
    }
    add(output.actions.candidate, match.candidate.actionCounts);
    add(output.actions.control, match.control.actionCounts);
    addGeometry(output.attackGeometryOpportunity.candidate,
      match.candidate.attackGeometryOpportunity);
    addGeometry(output.attackGeometryOpportunity.control,
      match.control.attackGeometryOpportunity);
    output.runtime.candidateTotalMicros += match.candidate.totalRuntimeMicros;
    output.runtime.controlTotalMicros += match.control.totalRuntimeMicros;
    output.runtime.candidateP95Max = Math.max(output.runtime.candidateP95Max,
      match.candidate.p95RuntimeMicros);
    output.runtime.controlP95Max = Math.max(output.runtime.controlP95Max,
      match.control.p95RuntimeMicros);
    output.invariants.timeoutError += match.candidate.timeoutCount +
      match.candidate.errorCount;
    const layer = match.candidateEngine?.layerTotals || {};
    output.invariants.avoidableHardReject += layer.avoidableHardRejects || 0;
    output.invariants.riskDominatedSelection += layer.riskDominatedSelections || 0;
    output.invariants.rootRestoreFailure += layer.depthRootRestoreFailures || 0;
    const strictFire = match.candidateEngine?.strictSafeThreatFireShadow || {};
    for (const key of Object.keys(output.strictSafeThreatFireShadow)) {
      if (key === "gapBitCount" || key === "possibleCount") continue;
      output.strictSafeThreatFireShadow[key] += strictFire[key] || 0;
    }
    for (let bit = 0; bit < output.strictSafeThreatFireShadow.gapBitCount.length;
      bit += 1)
      output.strictSafeThreatFireShadow.gapBitCount[bit] +=
        strictFire.gapBitCount?.[bit] || 0;
    for (let count = 0;
      count < output.strictSafeThreatFireShadow.possibleCount.length;
      count += 1)
      output.strictSafeThreatFireShadow.possibleCount[count] +=
        strictFire.possibleCount?.[count] || 0;
    const initiative = match.candidateEngine?.nativeInitiative || {};
    for (const key of ["selectCount", "escapeCount", "directFireCount",
      "interceptFireCount", "tacticalCount", "navigationCount",
      "stabilityGoCount", "riskFallbackCount", "bombSuppressedCount"])
      output.initiative[key] = (output.initiative[key] || 0) +
        (initiative[key] || 0);
    const response = match.candidateEngine?.responseOption || {};
    for (const key of ["captureCount", "evaluationCount", "proposalCount",
      "overrideCount", "skillOverrideCount", "turnOverrideCount",
      "goOverrideCount", "attackYieldCount", "committedYieldCount",
      "expireCount", "targetGoneCount", "noResponseCount"])
      output.responseOption[key] = (output.responseOption[key] || 0) +
        (response[key] || 0);
    const portfolio = match.candidateEngine?.optionPortfolio || {};
    for (const key of ["rootCount", "aliasRootCount", "aliasRowCount",
      "capacityFailureCount", "selectionCount", "selectedAliasCount",
      "selectedAttackCount", "selectedStarCount", "selectedTerminalCount",
      "selectedPositionCount", "selectedResourceCount", "verifiedResourceCount",
      "unverifiedResourceCount", "selectedUntypedCount", "typedBuildCount",
      "rowWithoutOptionCount"])
      output.optionPortfolio[key] = (output.optionPortfolio[key] || 0) +
        (portfolio[key] || 0);
    output.optionPortfolio.maximumOptionsInRoot = Math.max(
      output.optionPortfolio.maximumOptionsInRoot || 0,
      portfolio.maximumOptionsInRoot || 0);
    const objective = match.candidateEngine?.objectiveOption || {};
    for (const key of ["selectCount", "attackCount", "starCount",
      "fallbackCount", "noProgressCount"])
      output.objectiveOption[key] = (output.objectiveOption[key] || 0) +
        (objective[key] || 0);
    const expanded = match.candidateEngine?.expandedTacticalContact || {};
    for (const key of ["disabled", "bomb", "predictive"])
      output.expandedTacticalContact[key] =
        (output.expandedTacticalContact[key] || 0) + (expanded[key] || 0);
    const funnel = match.candidateEngine?.contactSearchFunnel || {};
    for (const key of ["exact", "inexact", "emergency", "valueBudget",
      "valueBudgetBlocked", "informationConsumerBlocked", "nominalPhysicalCalls",
      "nominalPhysicalCompleted", "nominalPhysicalScheduleBlocked",
      "refutedPossiblePhysicalEligible", "refutedPossiblePhysicalCalls",
      "refutedPossiblePhysicalCompleted", "refutedPossiblePhysicalCombatBlocked"])
      output.contactSearchFunnel[key] = (output.contactSearchFunnel[key] || 0) +
        (funnel[key] || 0);
    for (const key of ["refutedPossiblePhysicalVerifierChecks",
      "refutedPossiblePhysicalVerifierProposals",
      "refutedPossiblePhysicalVerifierOverrides",
      "refutedPossiblePhysicalVerifierIncomplete",
      "refutedPossiblePhysicalVerifierRiskBlocked"])
      output.contactSearchFunnel[key] = (output.contactSearchFunnel[key] || 0) +
        (funnel[key] || 0);
    const support = match.candidateEngine?.contactSupportCensus || {};
    for (const key of ["roots", "exact", "recoverablePhysical",
      "possibleOnlyTracked", "possibleOnlyIncomplete", "possibleWithOther",
      "otherGap"])
      output.contactSupportCensus[key] = (output.contactSupportCensus[key] || 0) +
        (support[key] || 0);
    for (let bit = 0; bit < 14; bit += 1)
      output.contactSupportCensus.gapBitCount[bit] +=
        support.gapBitCount?.[bit] || 0;
    for (let count = 0; count < 9; count += 1)
      output.contactSupportCensus.possibleCount[count] +=
        support.possibleCount?.[count] || 0;
    const nominalEvidence = match.candidateEngine?.nominalPhysicalEvidence || {};
    for (const key of ["checkCount", "proposalCount", "overrideCount",
      "movementCount", "attackCount", "sameActionCount", "incompleteCount",
      "hardBlockedCount", "riskBlockedCount", "valueBlockedCount",
      "actionClassBlockedCount"])
      output.nominalPhysicalEvidence[key] =
        (output.nominalPhysicalEvidence[key] || 0) + (nominalEvidence[key] || 0);
    const optionSearch = match.candidateEngine?.optionAwareSearch || {};
    for (const key of ["searchCount", "completeCount", "incompleteCount",
      "proposalCount", "differentPrimitiveCount", "totalNodes",
      "selectedProposalCount", "overrideCount", "hardBlockedCount",
      "riskBlockedCount", "committedBlockedCount", "nonTacticalBlockedCount",
      "incompleteSupportCount"])
      output.optionAwareSearch[key] = (output.optionAwareSearch[key] || 0) +
        (optionSearch[key] || 0);
    output.optionAwareSearch.maximumNodes = Math.max(
      output.optionAwareSearch.maximumNodes || 0, optionSearch.maximumNodes || 0);
    const continuation = match.candidateEngine?.actionContinuationEnvelope || {};
    for (const key of ["attempts", "triggered", "completed", "incomplete",
      "cooldownSkips", "runtimeModeSkips", "supportSkips", "valueOwnerSkips",
      "noConflictSkips", "singleRowSkips", "nodes", "nominalImprovementCount",
      "riskConflictImprovementCount", "sameWinnerCount", "rootRestoreFailures",
      "proposalCount", "hotAllocationCount", "optionAwareAttempts",
      "optionAwareCompleted", "optionAwareDifferentWinnerCount",
      "activeQualifiedCount", "activeRejectedCount", "postRiskWinnerCount",
      "postRiskRejectedCount"])
      output.actionContinuationEnvelope[key] =
        (output.actionContinuationEnvelope[key] || 0) + (continuation[key] || 0);
    output.actionContinuationEnvelope.maximumNodes = Math.max(
      output.actionContinuationEnvelope.maximumNodes || 0,
      continuation.maximumNodes || 0);
    const common = match.candidateEngine?.commonPolicyOptionInterval || {};
    for (const key of ["attempts", "supportSkips", "cooldownSkips",
      "valueOwnerSkips", "noConflictSkips", "completed", "incomplete",
      "nodes", "branchCount", "observationGroups", "observationSplitCount",
      "strategyFusionGapCount", "horizonSeparationCount", "terminalOwnershipCount",
      "proposalCount",
      "rootRestoreFailures", "capacityStops", "hotAllocationCount"])
      output.commonPolicyOptionInterval[key] =
        (output.commonPolicyOptionInterval[key] || 0) + (common[key] || 0);
    output.commonPolicyOptionInterval.maximumNodes = Math.max(
      output.commonPolicyOptionInterval.maximumNodes || 0,
      common.maximumNodes || 0);
    const attack = match.candidateEngine?.attackOpportunityCensus;
    if (attack) {
      output.attackOpportunity.decisionCount += attack.decisionCount || 0;
      output.attackOpportunity.hotAllocationCount += attack.hotAllocationCount || 0;
      add(output.attackOpportunity.row, attack.row);
      add(output.attackOpportunity.root, attack.root);
      add(output.attackOpportunity.firstBlock, attack.firstBlock);
    }
    const verifiedAttack = match.candidateEngine?.verifiedAttackProposal || {};
    for (const key of ["checkCount", "fireRowCount", "responseEvidenceRowCount",
      "noRegressionRowCount", "proposalCount", "sameSelectedCount",
      "differentProposalCount", "overrideCount", "finalRejectCount",
      "strictKillProposalCount", "hotAllocationCount"])
      output.verifiedAttackProposal[key] =
        (output.verifiedAttackProposal[key] || 0) + (verifiedAttack[key] || 0);
    const objectiveField = match.candidateEngine?.attackObjectiveField || {};
    for (const key of ["evaluationCount", "fieldBuildCount", "cacheHitCount",
      "goalPoseCount", "rejectedGoalPoseCount", "visitedPoseCount", "progressRootCount",
      "frontierDifferentCount", "noRegressionDifferentCount", "proposalCount",
      "sameSelectedCount", "overrideCount", "finalRejectCount",
      "hotAllocationCount"])
      output.attackObjectiveField[key] =
        (output.attackObjectiveField[key] || 0) + (objectiveField[key] || 0);
    output.attackObjectiveField.maximumVisitedPoses = Math.max(
      output.attackObjectiveField.maximumVisitedPoses || 0,
      objectiveField.maximumVisitedPoses || 0);
    const optionShadow = match.candidateEngine?.eventDrivenOptionShadow;
    if (optionShadow) {
      for (const key of ["decisionCount", "matchCount", "contextEpochs",
        "eventFrameCount", "noEventFrameCount", "continuationCount",
        "optionSwitchCount", "eventOptionSwitchCount", "unsignaledOptionSwitchCount",
        "targetSwitchCount", "eventTargetSwitchCount", "unsignaledTargetSwitchCount",
        "planSignatureSwitchCount", "unsignaledPlanSignatureSwitchCount",
        "selectedPlanCount", "selectedPurposeIncompleteCount", "selectedUnownedCount",
        "riskEligibleAlternativeRootCount", "availableAlternativeRootCount",
        "selectedKindUnavailableCount",
        "attackAvailableRootCount", "attackForegoneRootCount",
        "riskEligibleAttackRootCount", "riskEligibleAttackForegoneRootCount",
        "resourceForegoneRootCount", "starForegoneRootCount", "hotAllocationCount"])
        output.eventDrivenOptionShadow[key] =
          (output.eventDrivenOptionShadow[key] || 0) + (optionShadow[key] || 0);
      output.eventDrivenOptionShadow.maximumRunLength = Math.max(
        output.eventDrivenOptionShadow.maximumRunLength || 0,
        optionShadow.maximumRunLength || 0);
      add(output.eventDrivenOptionShadow.selectedKind, optionShadow.selectedKind);
      add(output.eventDrivenOptionShadow.riskEligibleKind, optionShadow.riskEligibleKind);
      add(output.eventDrivenOptionShadow.availableKind, optionShadow.availableKind);
      add(output.eventDrivenOptionShadow.eventFramesByBit, optionShadow.eventFramesByBit);
      add(output.eventDrivenOptionShadow.switchesByEventBit, optionShadow.switchesByEventBit);
      for (let bucket = 0; bucket < output.eventDrivenOptionShadow.runLengthBuckets.length;
        bucket += 1)
        output.eventDrivenOptionShadow.runLengthBuckets[bucket] +=
          optionShadow.runLengthBuckets?.[bucket] || 0;
      addSparse(output.eventDrivenOptionShadow.switchMatrix, optionShadow.switchMatrix);
      addSparse(output.eventDrivenOptionShadow.eventSwitchMatrix,
        optionShadow.eventSwitchMatrix);
      addSparse(output.eventDrivenOptionShadow.unsignaledSwitchMatrix,
        optionShadow.unsignaledSwitchMatrix);
      addSparse(output.eventDrivenOptionShadow.foregoneMatrix, optionShadow.foregoneMatrix);
      addSparse(output.eventDrivenOptionShadow.riskEligibleMasks,
        optionShadow.riskEligibleMasks);
      addSparse(output.eventDrivenOptionShadow.availableMasks, optionShadow.availableMasks);
    }
    const stableLedger = match.candidateEngine?.stableOptionLedgerShadow;
    if (stableLedger) {
      for (const key of ["decisionCount", "matchCount", "contextEpochs",
        "creationCount", "reuseCount", "revalidationCount", "expiryCount",
        "targetReplacementCount", "availabilityGapCount",
        "availabilityRecoveryCount", "selectedTrackedCount",
        "selectedExistingCount", "selectedNewCount", "selectedUntrackedCount",
        "selectedGenerationContinuationCount", "selectedGenerationSwitchCount",
        "eventGenerationSwitchCount", "unsignaledGenerationSwitchCount",
        "primitiveChangesWithinGeneration", "planSignatureChangesWithinGeneration",
        "selectedTargetAmbiguityCount", "capacityFailureCount", "hotAllocationCount",
        "rawPlanSignatureSwitchCount",
        "rawUnsignaledPlanSignatureSwitchCount"])
        output.stableOptionLedgerShadow[key] =
          (output.stableOptionLedgerShadow[key] || 0) + (stableLedger[key] || 0);
      output.stableOptionLedgerShadow.maximumActiveCount = Math.max(
        output.stableOptionLedgerShadow.maximumActiveCount || 0,
        stableLedger.lastActiveCount || 0);
      output.stableOptionLedgerShadow.maximumAvailableCount = Math.max(
        output.stableOptionLedgerShadow.maximumAvailableCount || 0,
        stableLedger.lastAvailableCount || 0);
      for (const key of ["createdByKind", "reusedByKind", "revalidatedByKind",
        "expiredByKind", "qualifiedFramesByKind", "selectedByKind",
        "selectedExistingByKind", "selectedNewByKind", "gapStartsByKind",
        "gapRecoveriesByKind", "expiryReasons"])
        add(output.stableOptionLedgerShadow[key], stableLedger[key]);
    }
    const strategicLedger = match.candidateEngine?.strategicStateLedgerShadow;
    if (strategicLedger) {
      for (const key of ["decisionCount", "matchCount", "trackedSelectionCount",
        "untrackedSelectionCount", "generationContinuationCount",
        "generationSwitchCount", "eventGenerationSwitchCount",
        "unsignaledGenerationSwitchCount", "targetRunCount",
        "targetRunFrameCount", "sameTargetPlanCommitCount",
        "sameTargetPlanCompletionCount", "sameCallbackCommitCompletionCount",
        "leadingAttackWithStarRegression", "leadingResourceWithStarRegression",
        "trailingStarWithAttackAlternative", "tiedStarWithAttackAlternative",
        "hotAllocationCount"])
        output.strategicStateLedgerShadow[key] =
          (output.strategicStateLedgerShadow[key] || 0) +
          (strategicLedger[key] || 0);
      output.strategicStateLedgerShadow.maximumTargetRun = Math.max(
        output.strategicStateLedgerShadow.maximumTargetRun || 0,
        strategicLedger.maximumTargetRun || 0);
      for (const key of ["selectedByScoreKind", "selectedByPhaseKind",
        "actionByScore", "targetRunsByScoreKind", "targetFramesByScoreKind",
        "planCommitsByScoreKind", "planActivationsByScoreKind",
        "planCompletionsByScoreKind", "planInvalidationsByScoreKind"])
        addNested(output.strategicStateLedgerShadow[key], strategicLedger[key]);
      for (const [band, values] of Object.entries(
        strategicLedger.maximumTargetRunByScoreKind || {})) {
        if (!output.strategicStateLedgerShadow.maximumTargetRunByScoreKind[band])
          output.strategicStateLedgerShadow.maximumTargetRunByScoreKind[band] = {};
        for (const [kindName, value] of Object.entries(values || {}))
          output.strategicStateLedgerShadow.maximumTargetRunByScoreKind[band][kindName] =
            Math.max(output.strategicStateLedgerShadow.maximumTargetRunByScoreKind[band][
              kindName] || 0, value || 0);
      }
      for (const key of ["deadlineSlackBuckets", "generationSwitchByScore",
        "eventSwitchByScore", "unsignaledSwitchByScore",
        "qualifiedAttackRootByScore", "qualifiedStarRootByScore",
        "selectedAttackWithStarAlternativeByScore",
        "selectedStarWithAttackAlternativeByScore",
        "selectedResourceWithStarAlternativeByScore",
        "attackStarPathRegressionByScore", "resourceStarPathRegressionByScore",
        "eventFramesByScore", "noEventFramesByScore",
        "lifecycleCreationsByScore", "lifecycleExpiriesByScore",
        "lifecycleGapsByScore", "lifecycleRecoveriesByScore"])
        add(output.strategicStateLedgerShadow[key], strategicLedger[key]);
    }
    const objectiveEpoch = match.candidateEngine?.objectiveEpochContinuityShadow;
    if (objectiveEpoch) {
      for (const key of ["decisionCount", "matchCount", "epochCount",
        "epochFrameCount", "continuationCount", "interruptYieldCount",
        "crossKindContinuationCount",
        "eventReplanCount", "unsignaledHoldCount", "executionSupportedCount",
        "executionGapCount", "selectedInsideEpochCount",
        "selectedOutsideEpochCount", "invalidatedCount", "searchComparableCount",
        "searchArgmaxInsideCount", "searchArgmaxOutsideCount",
        "capacityFailureCount", "hotAllocationCount"])
        output.objectiveEpochContinuityShadow[key] =
          (output.objectiveEpochContinuityShadow[key] || 0) +
          (objectiveEpoch[key] || 0);
      output.objectiveEpochContinuityShadow.maximumEpochFrames = Math.max(
        output.objectiveEpochContinuityShadow.maximumEpochFrames || 0,
        objectiveEpoch.maximumEpochFrames || 0);
      for (const key of ["statusCount", "adoptedByKind", "heldFromKind",
        "replannedToKind", "executionRowsByKind", "supportedFramesByKind",
        "gapFramesByKind", "selectedInsideByKind", "selectedOutsideByKind",
        "searchInsideByKind", "searchOutsideByKind"])
        add(output.objectiveEpochContinuityShadow[key], objectiveEpoch[key]);
      for (const key of ["holdMatrix", "gapSelectedMatrix"])
        addNested(output.objectiveEpochContinuityShadow[key], objectiveEpoch[key]);
    }
    const objectiveExecution = match.candidateEngine?.objectiveEpochExecutionShadow;
    if (objectiveExecution) {
      for (const key of ["decisionCount", "activeFrameCount",
        "suspendedFrameCount", "noTargetGapCount", "noProgressGapCount",
        "strictSupportedCount", "expandedSupportedCount", "recoveredGapCount",
        "remainingGapCount", "generatedRowCount", "directFireRowCount",
        "approachRowCount", "selectedInsideExpandedCount",
        "selectedOutsideExpandedCount", "searchComparableCount",
        "searchInsideExpandedCount", "searchOutsideExpandedCount",
        "hotAllocationCount"])
        output.objectiveEpochExecutionShadow[key] =
          (output.objectiveEpochExecutionShadow[key] || 0) +
          (objectiveExecution[key] || 0);
      for (const key of ["strictSupportedByKind", "expandedSupportedByKind",
        "recoveredGapByKind", "remainingGapByKind", "generatedRowsByKind",
        "selectedInsideExpandedByKind", "searchInsideExpandedByKind",
        "searchOutsideExpandedByKind"])
        add(output.objectiveEpochExecutionShadow[key], objectiveExecution[key]);
    }
    const objectiveActive = match.candidateEngine?.objectiveEpochActivePoc;
    if (objectiveActive) {
      for (const key of ["decisionCount", "eligibleCount", "alreadyInsideCount",
        "horizonBlockedCount", "suspendedCount", "noExecutionCount",
        "verifiedAttackYieldCount",
        "noCandidateCount", "searchSelectedCount", "objectiveSelectedCount",
        "overrideCount", "fireOverrideCount", "goOverrideCount",
        "turnOverrideCount", "finalRejectCount", "hotAllocationCount"])
        output.objectiveEpochActivePoc[key] =
          (output.objectiveEpochActivePoc[key] || 0) + (objectiveActive[key] || 0);
      output.objectiveEpochActivePoc.maximumFrames = objectiveActive.maximumFrames;
    }
    const semanticActive =
      match.candidateEngine?.semanticObjectiveEpochOptionActivePoc;
    if (semanticActive) for (const key of ["decisionCount", "certificateCount",
      "overrideCount", "sameActionCount", "finalRejectCount",
      "hotAllocationCount"])
      output.semanticObjectiveEpochOptionActivePoc[key] =
        (output.semanticObjectiveEpochOptionActivePoc[key] || 0) +
        (semanticActive[key] || 0);
    const attackCoverage =
      match.candidateEngine?.semanticAttackOptionCoverageShadow;
    if (attackCoverage) {
      for (const key of ["decisionCount", "enemyVisibleCount", "enemyHiddenCount",
        "broadEvidenceRootCount", "generatorEvidenceRootCount",
        "purposeCompleteRootCount", "portfolioAttackRootCount",
        "portfolioCompleteRootCount", "hardAllowedRootCount",
        "riskAcceptableRootCount", "strictAttackRootCount",
        "strictAttackRowCount", "onlyFireStrictRootCount",
        "movementStrictRootCount", "resourceStrictRootCount",
        "strictStarConflictRootCount", "selectedStrictAttackCount",
        "selectedOutsideStrictAttackCount", "attackEpochFrameCount",
        "attackEpochStrictSupportCount", "attackEpochExecutionGapCount",
        "strictAttackWithoutAttackEpochCount", "hotAllocationCount"])
        output.semanticAttackOptionCoverageShadow[key] =
          (output.semanticAttackOptionCoverageShadow[key] || 0) +
          (attackCoverage[key] || 0);
      for (const key of ["funnel", "rawByAction", "completeByAction",
        "strictByAction"])
        add(output.semanticAttackOptionCoverageShadow[key], attackCoverage[key]);
    }
    const attackExecution =
      match.candidateEngine?.semanticAttackExecutionIntervalShadow;
    if (attackExecution) {
      for (const key of ["decisionCount", "inactiveCount", "suspendedCount",
        "strictExecutionAvailableCount", "invalidCurrentCount",
        "noCandidateCount", "sameCandidateCount", "candidateCount",
        "dominanceCount", "completeRefutationCount", "completeEqualCount",
        "incompleteCount", "skippedCount", "hotAllocationCount"])
        output.semanticAttackExecutionIntervalShadow[key] =
          (output.semanticAttackExecutionIntervalShadow[key] || 0) +
          (attackExecution[key] || 0);
      add(output.semanticAttackExecutionIntervalShadow.candidateByAction,
        attackExecution.candidateByAction);
      for (const key of ["evaluationCount", "fieldBuildCount", "cacheHitCount",
        "goalPoseCount", "rejectedGoalPoseCount", "visitedPoseCount",
        "progressRootCount", "frontierDifferentCount",
        "noRegressionDifferentCount", "proposalCount", "sameSelectedCount",
        "overrideCount", "finalRejectCount", "hotAllocationCount"])
        output.semanticAttackExecutionIntervalShadow.field[key] =
          (output.semanticAttackExecutionIntervalShadow.field[key] || 0) +
          (attackExecution.field?.[key] || 0);
      output.semanticAttackExecutionIntervalShadow.field.maximumVisitedPoses = Math.max(
        output.semanticAttackExecutionIntervalShadow.field.maximumVisitedPoses || 0,
        attackExecution.field?.maximumVisitedPoses || 0);
      for (const key of ["attemptCount", "triggerCount", "completeCount",
        "incompleteCount", "supportSkipCount", "runtimeSkipCount",
        "safetySkipCount", "strictDominanceCount", "candidateWorseCount",
        "equalValueCount", "shadowDominanceCount", "proposalCount",
        "totalNodes", "rootRestoreFailureCount", "hotAllocationCount"])
        output.semanticAttackExecutionIntervalShadow.interval[key] =
          (output.semanticAttackExecutionIntervalShadow.interval[key] || 0) +
          (attackExecution.interval?.[key] || 0);
      output.semanticAttackExecutionIntervalShadow.interval.maximumNodes = Math.max(
        output.semanticAttackExecutionIntervalShadow.interval.maximumNodes || 0,
        attackExecution.interval?.maximumNodes || 0);
    }
    const attackPolicy =
      match.candidateEngine?.semanticAttackPolicyIntervalShadow;
    if (attackPolicy) {
      for (const key of ["decisionCount", "inactiveCount", "suspendedCount",
        "strictExecutionAvailableCount", "runtimeSkipCount", "supportSkipCount",
        "committedSkipCount", "invalidCurrentCount", "noPoseCount",
        "policyAttemptCount", "noPolicyDomainCount", "completeCount", "incompleteCount",
        "refutedCount", "equalCount", "strictDominanceCount",
        "samePrimitiveDominanceCount", "comparisonCount",
        "comparisonOverflowCount", "comparisonMissingCandidateCount",
        "hotAllocationCount"])
        output.semanticAttackPolicyIntervalShadow[key] =
          (output.semanticAttackPolicyIntervalShadow[key] || 0) +
          (attackPolicy[key] || 0);
      add(output.semanticAttackPolicyIntervalShadow.candidateByAction,
        attackPolicy.candidateByAction);
      add(output.semanticAttackPolicyIntervalShadow.dominanceByAction,
        attackPolicy.dominanceByAction);
      for (const key of ["rootCount", "optionOverflowCount", "completeRootCount",
        "incompleteRootCount", "supportedRowCount", "directFireRowCount",
        "progressRowCount", "routeTurnCount", "rejectedPrematureTurnCount",
        "generatedOptionCount", "commitKeepCount", "commitSwitchCount",
        "commitInvalidationCount", "fullCoverageRootCount",
        "partialCoverageRootCount", "fullCoverageRejectedCount",
        "uncoveredRegressionRejectedRowCount", "responseDerivedRootCount",
        "responseDerivedPoseCount", "successorViabilityCheckCount",
        "successorViableRowCount", "successorRejectedRowCount",
        "successorDistanceFillCount", "contextChangeCount", "hotAllocationCount"])
        output.semanticAttackPolicyIntervalShadow.pose[key] =
          (output.semanticAttackPolicyIntervalShadow.pose[key] || 0) +
          (attackPolicy.pose?.[key] || 0);
      for (const key of ["attemptCount", "depthOneSkipCount",
        "informationSkipCount", "noDomainCount", "sourceExcludedCount",
        "completeCount", "incompleteCount", "pairedAttemptCount",
        "pairedCompleteCount", "pairedIncompleteCount", "baselineTotalNodes",
        "strictDominanceCount", "nonDominanceCount", "rootRestoreFailureCount",
        "totalNodes", "hotAllocationCount"])
        output.semanticAttackPolicyIntervalShadow.policy[key] =
          (output.semanticAttackPolicyIntervalShadow.policy[key] || 0) +
          (attackPolicy.policy?.[key] || 0);
      for (const key of ["baselineMaximumNodes", "maximumNodes"])
        output.semanticAttackPolicyIntervalShadow.policy[key] = Math.max(
          output.semanticAttackPolicyIntervalShadow.policy[key] || 0,
          attackPolicy.policy?.[key] || 0);
      for (const key of ["prepareCount", "completeCount", "noPoseCount",
        "nonContactSkipCount", "hostileSkipCount", "promotedCount",
        "alreadyFirstCount", "injectedCount", "displacedCount", "fireCount",
        "goCount", "turnCount", "bindCount", "fixedInvalidCount",
        "hotAllocationCount"])
        output.semanticAttackPolicyIntervalShadow.policy.feedback[key] =
          (output.semanticAttackPolicyIntervalShadow.policy.feedback[key] || 0) +
          (attackPolicy.policy?.feedback?.[key] || 0);
      output.semanticAttackPolicyIntervalShadow.policy.nodeBudget =
        attackPolicy.policy?.nodeBudget;
      output.semanticAttackPolicyIntervalShadow.policy.pairedDepth =
        attackPolicy.policy?.pairedDepth;
      for (const key of ["compareCount", "completeCount", "incompleteCount",
        "candidateDominanceCount", "incumbentDominanceCount", "equalCount",
        "incomparableCount", "hotAllocationCount"])
        output.semanticAttackPolicyIntervalShadow.objective[key] =
          (output.semanticAttackPolicyIntervalShadow.objective[key] || 0) +
          (attackPolicy.objective?.[key] || 0);
      if (attackPolicy.depthStability) {
        const target = output.semanticAttackPolicyIntervalShadow.depthStability;
        target.evaluationCount = (target.evaluationCount || 0) +
          (attackPolicy.depthStability.evaluationCount || 0);
        target.rootRestoreFailureCount =
          (target.rootRestoreFailureCount || 0) +
          (attackPolicy.depthStability.rootRestoreFailureCount || 0);
        target.hotAllocationCount = (target.hotAllocationCount || 0) +
          (attackPolicy.depthStability.hotAllocationCount || 0);
        for (let lane = 0;
            lane < (attackPolicy.depthStability.lanes || []).length;
            lane += 1) {
          const sourceLane = attackPolicy.depthStability.lanes[lane];
          const targetLane = target.lanes[lane] ||
            (target.lanes[lane] = { name: sourceLane.name,
              depth: sourceLane.depth, nodeBudget: sourceLane.nodeBudget,
              relationCount: {} });
          for (const key of ["completeCount", "incompleteCount",
            "baselineNodeTotal", "candidateNodeTotal"])
            targetLane[key] = (targetLane[key] || 0) +
              (sourceLane[key] || 0);
          targetLane.maximumNodes = Math.max(targetLane.maximumNodes || 0,
            sourceLane.maximumNodes || 0);
          add(targetLane.relationCount, sourceLane.relationCount);
        }
      }
      if (attackPolicy.depthWidthStability) {
        const target =
          output.semanticAttackPolicyIntervalShadow.depthWidthStability;
        target.evaluationCount = (target.evaluationCount || 0) +
          (attackPolicy.depthWidthStability.evaluationCount || 0);
        target.rootRestoreFailureCount =
          (target.rootRestoreFailureCount || 0) +
          (attackPolicy.depthWidthStability.rootRestoreFailureCount || 0);
        target.hotAllocationCount = (target.hotAllocationCount || 0) +
          (attackPolicy.depthWidthStability.hotAllocationCount || 0);
        for (let lane = 0;
            lane < (attackPolicy.depthWidthStability.lanes || []).length;
            lane += 1) {
          const sourceLane = attackPolicy.depthWidthStability.lanes[lane];
          const targetLane = target.lanes[lane] ||
            (target.lanes[lane] = { name: sourceLane.name,
              depth: sourceLane.depth, width: sourceLane.width,
              nodeBudget: sourceLane.nodeBudget, relationCount: {},
              baselineReasonBits: {}, candidateReasonBits: {} });
          for (const key of ["completeCount", "incompleteCount",
            "baselineNodeTotal", "candidateNodeTotal"])
            targetLane[key] = (targetLane[key] || 0) +
              (sourceLane[key] || 0);
          targetLane.maximumNodes = Math.max(targetLane.maximumNodes || 0,
            sourceLane.maximumNodes || 0);
          add(targetLane.relationCount, sourceLane.relationCount);
          add(targetLane.baselineReasonBits, sourceLane.baselineReasonBits);
          add(targetLane.candidateReasonBits, sourceLane.candidateReasonBits);
        }
      }
      if (attackPolicy.eventHorizon) {
        const source = attackPolicy.eventHorizon;
        const target = output.semanticAttackPolicyIntervalShadow.eventHorizon;
        for (const key of ["attemptCount", "supportCompleteCount",
          "supportIncompleteCount", "rootRestoreFailureCount", "totalNodes",
          "ownDomainRestrictedCount", "restrictedDisproofToUnknownCount",
          "hotAllocationCount"])
          target[key] = (target[key] || 0) + (source[key] || 0);
        target.maximumOwnDomain = Math.max(target.maximumOwnDomain || 0,
          source.maximumOwnDomain || 0);
        target.diagnosticOnly = source.diagnosticOnly;
        target.actionOwnership = source.actionOwnership;
        target.quantifier = source.quantifier;
        target.positiveCertificateSound = source.positiveCertificateSound;
        target.negativeSubsetResult = source.negativeSubsetResult;
        target.nonEventAtCap = source.nonEventAtCap;
        target.maximumDepth = source.maximumDepth;
        target.nodeBudget = source.nodeBudget;
      }
    }
    const attackPolicyActive =
      match.candidate?.semanticAttackPolicyIntervalActivePoc;
    if (attackPolicyActive) {
      for (const key of ["decisionCount", "certificateCount", "overrideCount",
        "sameActionCount", "finalRejectCount", "hotAllocationCount"])
        output.semanticAttackPolicyIntervalActivePoc[key] =
          (output.semanticAttackPolicyIntervalActivePoc[key] || 0) +
          (attackPolicyActive[key] || 0);
      const activeShadow = attackPolicyActive.shadow;
      if (activeShadow) {
        for (const key of ["decisionCount", "inactiveCount", "suspendedCount",
          "strictExecutionAvailableCount", "runtimeSkipCount", "supportSkipCount",
          "committedSkipCount", "invalidCurrentCount", "noPoseCount",
          "policyAttemptCount", "noPolicyDomainCount", "completeCount",
          "incompleteCount", "refutedCount", "equalCount",
          "strictDominanceCount", "samePrimitiveDominanceCount",
          "hotAllocationCount"])
          output.semanticAttackPolicyIntervalActivePoc.shadow[key] =
            (output.semanticAttackPolicyIntervalActivePoc.shadow[key] || 0) +
            (activeShadow[key] || 0);
        add(output.semanticAttackPolicyIntervalActivePoc.shadow.candidateByAction,
          activeShadow.candidateByAction);
        add(output.semanticAttackPolicyIntervalActivePoc.shadow.dominanceByAction,
          activeShadow.dominanceByAction);
        for (const key of ["rootCount", "completeRootCount", "incompleteRootCount",
          "supportedRowCount", "progressRowCount", "routeTurnCount",
          "generatedOptionCount", "fullCoverageRootCount",
          "partialCoverageRootCount", "successorViabilityCheckCount",
          "successorViableRowCount", "successorRejectedRowCount",
          "hotAllocationCount"])
          output.semanticAttackPolicyIntervalActivePoc.shadow.pose[key] =
            (output.semanticAttackPolicyIntervalActivePoc.shadow.pose[key] || 0) +
            (activeShadow.pose?.[key] || 0);
        for (const key of ["attemptCount", "noDomainCount", "completeCount",
          "incompleteCount", "pairedAttemptCount", "pairedCompleteCount",
          "pairedIncompleteCount", "baselineTotalNodes", "totalNodes",
          "strictDominanceCount", "nonDominanceCount",
          "rootRestoreFailureCount", "hotAllocationCount"])
          output.semanticAttackPolicyIntervalActivePoc.shadow.policy[key] =
            (output.semanticAttackPolicyIntervalActivePoc.shadow.policy[key] || 0) +
            (activeShadow.policy?.[key] || 0);
        for (const key of ["baselineMaximumNodes", "maximumNodes"])
          output.semanticAttackPolicyIntervalActivePoc.shadow.policy[key] = Math.max(
            output.semanticAttackPolicyIntervalActivePoc.shadow.policy[key] || 0,
            activeShadow.policy?.[key] || 0);
      }
    }
    const objectiveArbiter =
      match.candidateEngine?.objectiveEpochOptionArbiterShadow;
    if (objectiveArbiter) {
      for (const key of ["decisionCount", "inactiveCount", "suspendedCount",
        "noStrictOptionCount", "currentInsideCount", "currentOutsideCount",
        "invalidCurrentRowCount", "verifiedAttackYieldCount", "proposalCount",
        "currentOptionSupportedCount", "currentOptionMissingCount",
        "searchUnavailableCount", "searchNotComparableCount",
        "searchComparableCount", "searchSupportsCount", "searchRefutesCount",
        "searchStrictlyImprovesCount", "searchSelectedProposalCount",
        "objectiveSelectedProposalCount", "intervalDominanceCount",
        "hotAllocationCount"])
        output.objectiveEpochOptionArbiterShadow[key] =
          (output.objectiveEpochOptionArbiterShadow[key] || 0) +
          (objectiveArbiter[key] || 0);
      add(output.objectiveEpochOptionArbiterShadow.proposalByAction,
        objectiveArbiter.proposalByAction);
      for (const key of ["intervalAttemptByKind", "intervalCompleteByKind",
        "intervalWorseByKind", "intervalEqualByKind",
        "intervalDominanceByKind", "intervalIncompleteByKind",
        "intervalSkippedByKind"])
        add(output.objectiveEpochOptionArbiterShadow[key], objectiveArbiter[key]);
      const interval = objectiveArbiter.interval;
      if (interval) for (const key of ["attemptCount", "triggerCount",
        "completeCount", "incompleteCount", "supportSkipCount",
        "runtimeSkipCount", "safetySkipCount", "strictDominanceCount",
        "candidateWorseCount", "equalValueCount",
        "shadowDominanceCount", "proposalCount", "totalNodes",
        "rootRestoreFailureCount", "hotAllocationCount"])
        output.objectiveEpochOptionArbiterShadow.interval[key] =
          (output.objectiveEpochOptionArbiterShadow.interval[key] || 0) +
          (interval[key] || 0);
      if (interval) output.objectiveEpochOptionArbiterShadow.interval.maximumNodes =
        Math.max(output.objectiveEpochOptionArbiterShadow.interval.maximumNodes || 0,
          interval.maximumNodes || 0);
    }
    const strategicConflict = match.candidateEngine?.strategicConflictArbiterShadow;
    if (strategicConflict) {
      for (const key of ["observationCount", "matchCount", "targetAdoptionCount",
        "targetContinuationCount", "targetSemanticAbortCount",
        "eventReevaluationCount", "unsignaledSwitchCount",
        "unsignaledWouldHoldCount", "conflictEvaluationCount",
        "duplicateConflictSkipCount", "incumbentKindBlockedCount",
        "deadlineIncompleteCount", "incompleteConflictCount",
        "attackParetoCount", "scoreConditionedAttackCount",
        "keepIncumbentCount", "tradeoffCount", "equalCount",
        "attackProposalContinuationCount", "leadingAttackProposalCount",
        "tiedAttackProposalCount", "trailingAttackProposalCount",
        "proposalTargetAdoptionCount",
        "proposalTargetDeadlineExpiryCount", "counterfactualReleaseCount",
        "hotAllocationCount"])
        output.strategicConflictArbiterShadow[key] =
          (output.strategicConflictArbiterShadow[key] || 0) +
          (strategicConflict[key] || 0);
      output.strategicConflictArbiterShadow.maximumShadowTargetAge = Math.max(
        output.strategicConflictArbiterShadow.maximumShadowTargetAge || 0,
        strategicConflict.maximumShadowTargetAge || 0);
      addNested(output.strategicConflictArbiterShadow.decisionByScore,
        strategicConflict.decisionByScore);
      addNested(output.strategicConflictArbiterShadow.actualSelectionByScore,
        strategicConflict.actualSelectionByScore);
      for (const key of ["proposalByScore", "starCostByScore",
        "deadlineAdvantageByScore", "durableCombatByScore"])
        add(output.strategicConflictArbiterShadow[key], strategicConflict[key]);
    }
    const targetExecution = match.candidateEngine?.strategicTargetExecutionShadow;
    if (targetExecution) {
      for (const key of ["observationCount", "attackTargetFrameCount",
        "proposalRootCount", "candidateRowCount", "targetGapCount",
        "incompletePortfolioCount", "samePrimitiveCount",
        "differentPrimitiveCount", "fireProposalCount", "setupProposalCount",
        "directKillProposalCount", "counterfactualBoundaryCount",
        "hotAllocationCount"])
        output.strategicTargetExecutionShadow[key] =
          (output.strategicTargetExecutionShadow[key] || 0) +
          (targetExecution[key] || 0);
      add(output.strategicTargetExecutionShadow.statusCounts,
        targetExecution.statusCounts);
      add(output.strategicTargetExecutionShadow.proposalByAction,
        targetExecution.proposalByAction);
    }
    const stableInterval = match.candidateEngine?.stableOptionIntervalShadow;
    if (stableInterval) for (const key of ["evaluationCount", "eventConflictCount",
      "externalEventTriggerCount", "internalEventTriggerCount",
      "steadyConflictSkipCount", "noAttackConflictCount", "unsupportedSelectedCount",
      "committedSkipCount", "incompleteRolloutCount", "rootRestoreFailureCount",
      "nominalBalancedAttackWinCount", "nominalCombatAttackWinCount",
      "nominalAttackLossCount", "nominalAttackTieCount",
      "riskBandAttackSeparationCount", "riskBandIncumbentSeparationCount",
      "riskBandOverlapCount", "attackSurvivalPreservedCount",
      "attackSurvivalRegressedCount", "attackEnemyCrashGainCount",
      "attackStarRegressionCount", "strictFullRangeCount",
      "strictTerminalResolvedCount", "strictOwnershipCount",
      "rolloutTransitionCount", "hotAllocationCount"])
      output.stableOptionIntervalShadow[key] =
        (output.stableOptionIntervalShadow[key] || 0) + (stableInterval[key] || 0);
    const attackContinuation =
      match.candidateEngine?.attackContinuationProgressShadow;
    if (attackContinuation) {
      for (const key of ["observationCount", "evaluationCount", "duplicateSkipCount",
        "invalidRowCount", "firstActionIncompleteCount", "responseUnchangedCount",
        "survivalIncompleteCount", "postureOnlyCount",
        "riskSeparatedBlockedCount", "starRegressionCount",
        "challengerBeforeStarTradeoffCount", "nonRegressiveChallengerCount",
        "strongWitnessCount", "newGenerationCount",
        "sameGenerationRevalidationCount", "progressMaintainedCount",
        "progressAdvancedCount", "progressRegressedCount", "hotAllocationCount"])
        output.attackContinuationProgressShadow[key] =
          (output.attackContinuationProgressShadow[key] || 0) +
          (attackContinuation[key] || 0);
      output.attackContinuationProgressShadow.maximumDurableRevalidations = Math.max(
        output.attackContinuationProgressShadow.maximumDurableRevalidations || 0,
        attackContinuation.maximumDurableRevalidations || 0);
      add(output.attackContinuationProgressShadow.bitCounts,
        attackContinuation.bitCounts || {});
      for (let index = 0; index < 256; index += 1)
        output.attackContinuationProgressShadow.maskCounts[index] +=
          attackContinuation.maskCounts?.[index] || 0;
    }
    const sequenceGenerator = match.candidateEngine?.attackSequenceGeneratorShadow;
    if (sequenceGenerator) {
      for (const key of ["observationCount", "eventEvaluationCount",
        "duplicateSkipCount", "noSetupCandidateCount", "candidateRowCount",
        "certifiedRowCount", "rejectedRowCount", "incompleteRowCount",
        "rootWithCertificateCount", "multipleCertificateRootCount",
        "hotAllocationCount"])
        output.attackSequenceGeneratorShadow[key] =
          (output.attackSequenceGeneratorShadow[key] || 0) +
          (sequenceGenerator[key] || 0);
      add(output.attackSequenceGeneratorShadow.candidateByAction,
        sequenceGenerator.candidateByAction || {});
      add(output.attackSequenceGeneratorShadow.certifiedByAction,
        sequenceGenerator.certifiedByAction || {});
      const closure = sequenceGenerator.closure || {};
      for (const key of ["evaluationCount", "certifiedCount", "rejectedCount",
        "incompleteCount", "nodeCount", "rootRestoreFailures", "hotAllocationCount"])
        output.attackSequenceGeneratorShadow.closure[key] =
          (output.attackSequenceGeneratorShadow.closure[key] || 0) +
          (closure[key] || 0);
      output.attackSequenceGeneratorShadow.closure.maximumNodes = Math.max(
        output.attackSequenceGeneratorShadow.closure.maximumNodes || 0,
        closure.maximumNodes || 0);
      for (let bit = 0; bit < 13; bit += 1)
        output.attackSequenceGeneratorShadow.closure.reasonBitCounts[bit] +=
          closure.reasonBitCounts?.[bit] || 0;
    }
    const policyReachability = match.candidateEngine?.attackPolicyReachabilityShadow;
    if (policyReachability) {
      for (const key of ["observationCount", "eventEvaluationCount",
        "duplicateSkipCount", "candidateRowCount", "provenRowCount",
        "disprovenRowCount", "unknownRowCount", "rootWithProofCount",
        "rootHiddenSkipCount", "trackingSkipCount", "possibleProjectileSkipCount",
        "supportSkipCount", "nodeCount", "ttHits", "ttStores", "hiddenStops",
        "budgetStops", "incompleteStops", "hardRejects", "rootRestoreFailures",
        "hotAllocationCount"])
        output.attackPolicyReachabilityShadow[key] =
          (output.attackPolicyReachabilityShadow[key] || 0) +
          (policyReachability[key] || 0);
      output.attackPolicyReachabilityShadow.maximumNodes = Math.max(
        output.attackPolicyReachabilityShadow.maximumNodes || 0,
        policyReachability.maximumNodes || 0);
      add(output.attackPolicyReachabilityShadow.candidateByAction,
        policyReachability.candidateByAction || {});
      add(output.attackPolicyReachabilityShadow.provenByAction,
        policyReachability.provenByAction || {});
      for (let index = 0; index < 15; index += 1)
        output.attackPolicyReachabilityShadow.statusByDepth[index] +=
          policyReachability.statusByDepth?.[index] || 0;
      for (let index = 0; index < 3; index += 1)
        output.attackPolicyReachabilityShadow.goalLeafCounts[index] +=
          policyReachability.goalLeafCounts?.[index] || 0;
    }
    const responseSet = match.candidateEngine?.attackResponseSetShadow;
    if (responseSet) {
      for (const key of ["observationCount", "eventEvaluationCount",
        "duplicateSkipCount", "candidateRowCount", "columnEvaluationCount",
        "provenColumnCount", "disprovenColumnCount", "unknownColumnCount",
        "candidateWithCompressionCount", "strictSupersetCount", "tradeoffCount",
        "equalSetCount", "strictSubsetCount", "gainedColumnCount",
        "lostColumnCount", "rootWithStrictSupersetCount",
        "incumbentEvaluationCount", "rootHiddenSkipCount", "trackingSkipCount",
        "possibleProjectileSkipCount", "supportSkipCount", "nodeCount", "ttHits",
        "budgetStops", "incompleteStops", "rootRestoreFailures",
        "hotAllocationCount"])
        output.attackResponseSetShadow[key] =
          (output.attackResponseSetShadow[key] || 0) + (responseSet[key] || 0);
      output.attackResponseSetShadow.maximumNodes = Math.max(
        output.attackResponseSetShadow.maximumNodes || 0,
        responseSet.maximumNodes || 0);
      add(output.attackResponseSetShadow.candidateByAction,
        responseSet.candidateByAction || {});
      add(output.attackResponseSetShadow.strictSupersetByAction,
        responseSet.strictSupersetByAction || {});
      for (let index = 0; index < 25; index += 1)
        output.attackResponseSetShadow.coverageHistogram[index] +=
          responseSet.coverageHistogram?.[index] || 0;
    }
    const combatUtility = match.candidateEngine?.combatUtilityEnvelopeShadow;
    if (combatUtility) {
      for (const key of ["observationCount", "rowEvaluationRequestCount",
        "evaluationCount",
        "duplicateSkipCount", "invalidRowCount", "hardSkipCount",
        "riskSkipCount", "pacIncompleteCount", "probabilityIncompleteCount",
        "attackDominatesCount", "incumbentDominatesCount", "tradeoffCount",
        "equalCount", "offensiveGainCount", "safetyNonRegressionCount",
        "resourceCostCount", "starOpportunityCostCount",
        "starPathProgressCostCount", "attackDeadlineEarlierCount",
        "attackDeadlineEqualCount", "attackDeadlineLaterCount",
        "deadlineBalancedQualifiedCount",
        "currentRiskQualifiedCount",
        "currentRiskQualifiedWithoutStarCostCount",
        "opponentModelInfluenceCount", "nominalDoomedMassTotal",
        "uniformDoomedMassTotal", "hotAllocationCount"])
        output.combatUtilityEnvelopeShadow[key] =
          (output.combatUtilityEnvelopeShadow[key] || 0) +
          (combatUtility[key] || 0);
      output.combatUtilityEnvelopeShadow.riskPoints = combatUtility.riskPoints;
      add(output.combatUtilityEnvelopeShadow.evaluationBySelectedKind,
        combatUtility.evaluationBySelectedKind || {});
      add(output.combatUtilityEnvelopeShadow.qualifiedWithoutStarCostBySelectedKind,
        combatUtility.qualifiedWithoutStarCostBySelectedKind || {});
      for (let index = 0; index < 6; index += 1) {
        output.combatUtilityEnvelopeShadow.offensiveGainByRisk[index] +=
          combatUtility.offensiveGainByRisk?.[index] || 0;
        output.combatUtilityEnvelopeShadow.qualifiedByRisk[index] +=
          combatUtility.qualifiedByRisk?.[index] || 0;
      }
    }
    const riskCombat = match.candidateEngine?.riskConditionedCombatProposal;
    const policyFrontier = match.candidateEngine?.attackStarPolicyFrontierShadow;
    if (policyFrontier) for (const key of ["observationCount", "evaluationCount",
      "duplicateSkipCount", "unalignedUtilityCount", "incompleteCount",
      "staticQualifiedCount", "attackProgressCount", "starProgressCount",
      "bothProgressCount", "noProgressCount", "attackDominatesCount",
      "starDominatesCount", "tradeoffCount", "equalCount",
      "attackSurvivalRegressionCount", "attackStarGainRegressionCount",
      "attackStarPathRegressionCount", "attackMobilityRegressionCount",
      "attackResourceCostCount", "policyQualifiedCount",
      "strictOwnershipCount", "hotAllocationCount"])
      output.attackStarPolicyFrontierShadow[key] =
        (output.attackStarPolicyFrontierShadow[key] || 0) +
        (policyFrontier[key] || 0);
    const responsePolicy =
      match.candidateEngine?.responseConditionedOptionPolicyShadow;
    if (responsePolicy) {
      for (const key of ["observationCount", "evaluationCount",
        "duplicateSkipCount", "hiddenSkipCount", "trackingSkipCount",
        "possibleProjectileSkipCount", "supportSkipCount",
        "probabilityIncompleteCount", "rolloutIncompleteCount", "worldCount",
        "transitionCount", "rootRestoreFailureCount",
        "currentRiskAttackDominatesCount", "currentRiskStarDominatesCount",
        "currentRiskTradeoffCount", "currentRiskEqualCount",
        "currentRiskCombatPositiveCount", "currentRiskStarCostCount",
        "currentRiskSafetyRegressionCount", "hotAllocationCount"])
        output.responseConditionedOptionPolicyShadow[key] =
          (output.responseConditionedOptionPolicyShadow[key] || 0) +
          (responsePolicy[key] || 0);
      output.responseConditionedOptionPolicyShadow.riskPoints =
        responsePolicy.riskPoints;
      output.responseConditionedOptionPolicyShadow.dimensionCount =
        responsePolicy.dimensionCount;
      for (let index = 0; index < 24; index += 1)
        output.responseConditionedOptionPolicyShadow.relationByRisk[index] +=
          responsePolicy.relationByRisk?.[index] || 0;
    }
    const exactResponsePolicy =
      match.candidateEngine?.riskConditionedResponsePolicyShadow;
    if (exactResponsePolicy) {
      for (const key of ["observationCount", "rowEvaluationRequestCount",
        "evaluationCount", "duplicateSkipCount", "hiddenSkipCount",
        "trackingSkipCount", "possibleProjectileSkipCount", "supportSkipCount",
        "probabilityIncompleteCount", "rolloutIncompleteCount", "worldCount",
        "transitionCount", "rootRestoreFailureCount",
        "qualificationCheckCount", "qualificationCompleteCount",
        "qualificationSafetyBlockedCount", "qualificationCombatBlockedCount",
        "qualificationCount",
        "currentRiskAttackDominatesCount", "currentRiskStarDominatesCount",
        "currentRiskTradeoffCount", "currentRiskEqualCount",
        "currentRiskCombatPositiveCount", "currentRiskStarCostCount",
        "currentRiskSafetyRegressionCount", "hotAllocationCount"])
        output.riskConditionedResponsePolicyShadow[key] =
          (output.riskConditionedResponsePolicyShadow[key] || 0) +
          (exactResponsePolicy[key] || 0);
      output.riskConditionedResponsePolicyShadow.riskPoints =
        exactResponsePolicy.riskPoints;
      output.riskConditionedResponsePolicyShadow.dimensionCount =
        exactResponsePolicy.dimensionCount;
      for (let index = 0; index < 24; index += 1)
        output.riskConditionedResponsePolicyShadow.relationByRisk[index] +=
          exactResponsePolicy.relationByRisk?.[index] || 0;
    }
    if (riskCombat) for (const key of ["checkCount", "starOwnerRootCount",
      "staticCandidateCount", "deadlineCandidateCount", "rolloutCount",
      "rolloutTransitionCount", "rolloutIncompleteCount",
      "starLossBlockedCount", "survivalBlockedCount", "proposalCount",
      "overrideCount", "finalRejectCount", "committedBlockedCount",
      "terminalBlockedCount", "hardBlockedCount", "riskBlockedCount",
      "pacBlockedCount", "utilityBlockedCount", "exposureBlockedCount",
      "deadlineBlockedCount", "rootRestoreFailureCount", "hotAllocationCount"])
      output.riskConditionedCombatProposal[key] =
        (output.riskConditionedCombatProposal[key] || 0) +
        (riskCombat[key] || 0);
    const attackOverStar = match.candidateEngine?.qualifiedAttackOverStar || {};
    for (const key of ["checkCount", "starOwnerRootCount", "qualifiedAttackRowCount",
      "qualifiedAttackRootCount", "qualifiedFireRootCount", "proposalCount",
      "samePrimitiveCount", "differentProposalCount", "overrideCount",
      "fireOverrideCount", "finalRejectCount", "committedBlockedCount",
      "terminalBlockedCount", "hotAllocationCount"])
      output.qualifiedAttackOverStar[key] =
        (output.qualifiedAttackOverStar[key] || 0) + (attackOverStar[key] || 0);
    const strategicAttack =
      match.candidateEngine?.strategicAttackOverStarProposal;
    if (strategicAttack) {
      for (const key of ["checkCount", "conflictCount", "triggerCount",
        "steadySkipCount", "responseIncompleteCount", "safetyBlockedCount",
        "deadlineBlockedCount", "combatBlockedCount", "scoreBlockedCount",
        "proposalCount", "overrideCount", "finalRejectCount",
        "rootRestoreFailureCount", "hotAllocationCount"])
        output.strategicAttackOverStarProposal[key] =
          (output.strategicAttackOverStarProposal[key] || 0) +
          (strategicAttack[key] || 0);
      add(output.strategicAttackOverStarProposal.proposalByScore,
        strategicAttack.proposalByScore);
      const combatCensus = strategicAttack.durableCombatBlockCensus;
      if (combatCensus) {
        const target = output.strategicAttackOverStarProposal
          .durableCombatBlockCensus;
        for (const key of ["relation", "byScore", "positiveDimensionCount",
          "robustSignCount", "robustSignPattern", "robustSum",
          "physicalSignalMask", "starCostMask",
          "temporalPositiveDimensionCount", "temporalRobustSignCount",
          "temporalRobustSignPattern", "temporalRobustSum"])
          target[key] = addArray(target[key], combatCensus[key]);
        for (const key of ["noPositiveDimensionCount",
          "physicalSignalWithoutValueCount", "temporalRecoveryCount"])
          target[key] = (target[key] || 0) + (combatCensus[key] || 0);
        target.dimensionOrder = combatCensus.dimensionOrder;
        target.temporalDimensionOrder = combatCensus.temporalDimensionOrder;
        target.signOrder = combatCensus.signOrder;
        target.physicalSignalBits = combatCensus.physicalSignalBits;
      }
      const response = strategicAttack.response;
      if (response) {
        for (const key of ["rowEvaluationRequestCount", "evaluationCount",
          "possibleProjectileSkipCount", "possibleProjectilePoolCompleteCount",
          "possibleProjectilePoolIncompleteCount",
          "possibleProjectileEnemyOnlyCount", "possibleProjectileMixedOwnerCount",
          "possibleWorldAttemptCount", "possibleWorldCompleteCount",
          "possibleWorldIncompleteCount", "possibleWorldUnsupportedCount",
          "possibleWorldInjectionFailureCount",
          "possibleWorldRootRestoreFailureCount",
          "possibleWorldCadenceRephaseCount",
          "possibleWorldCommonSequenceCount",
          "possibleWorldReducedDimensionCount", "physicalIncompleteRootCount",
          "possibleAbsenceIncompleteRootCount",
          "possiblePresenceIncompleteRootCount",
          "diagnosticFailureStackAllocationCount", "supportSkipCount",
          "probabilityIncompleteCount", "rolloutIncompleteCount", "worldCount",
          "transitionCount", "rootRestoreFailureCount",
          "qualificationCheckCount", "qualificationCompleteCount",
          "qualificationSafetyBlockedCount", "qualificationCombatBlockedCount",
          "qualificationCount", "currentRiskAttackDominatesCount",
          "currentRiskStarDominatesCount", "currentRiskTradeoffCount",
          "currentRiskEqualCount", "hotAllocationCount"])
          output.strategicAttackOverStarProposal.response[key] =
            (output.strategicAttackOverStarProposal.response[key] || 0) +
            (response[key] || 0);
        for (let index = 0; index < 24; index += 1)
          output.strategicAttackOverStarProposal.response.relationByRisk[index] +=
            response.relationByRisk?.[index] || 0;
        for (let index = 0; index < 9; index += 1)
          output.strategicAttackOverStarProposal.response.possibleProjectileCount[index] +=
            response.possibleProjectileCount?.[index] || 0;
        for (const key of ["rolloutFailureByReason",
          "rolloutFailureByPhaseReason", "rolloutFailureByOptionReason",
          "rolloutFailureByStepReason", "rolloutFailureByEnemyActionReason",
          "rolloutIncompleteRootByReason", "rolloutFailureByUnsupportedSite",
          "rolloutIncompleteRootByUnsupportedSite",
          "rolloutFailureByAppliedActionPair"])
          output.strategicAttackOverStarProposal.response[key] = addArray(
            output.strategicAttackOverStarProposal.response[key], response[key]);
        const moveEnvelope = response.moveContestVariantEnvelope;
        if (moveEnvelope) {
          const target = output.strategicAttackOverStarProposal.response
            .moveContestVariantEnvelope;
          for (const key of ["attemptCount", "completeCount", "incompleteCount",
            "recoveredCount", "relationAgreementCount",
            "relationDisagreementCount", "reducedDimensionCount",
            "commonSequenceReplayCount", "transitionCount",
            "rootRestoreFailureCount"])
            target[key] = (target[key] || 0) + (moveEnvelope[key] || 0);
          for (const key of ["completeByVariant", "incompleteByVariant",
            "statusByVariant", "relationByRisk"])
            target[key] = addArray(target[key], moveEnvelope[key]);
          target.enabled = Boolean(target.enabled || moveEnvelope.enabled);
          target.diagnosticOnly = true; target.actionOwnership = false;
          target.commonOwnPolicyAcrossVariants = true;
          target.variants = moveEnvelope.variants;
        }
      }
    }
    const persistentAttack = match.candidateEngine?.persistentAttackTarget;
    if (persistentAttack) {
      for (const key of ["checkCount", "adoptionCount", "replanCount",
        "targetFrameCount", "continuationProposalCount", "samePrimitiveCount",
        "executionGapCount", "movementProposalCount", "safetyYieldCount",
        "strategicYieldCount", "deadlineExpiryCount",
        "exactValueCheckCount", "exactValueBlockedCount",
        "exactValueProposalCount",
        "scoreAbortCount", "supportAbortCount", "overrideCount",
        "finalRejectCount", "maximumTargetAge", "hotAllocationCount"])
        output.persistentAttackTarget[key] =
          (output.persistentAttackTarget[key] || 0) + (persistentAttack[key] || 0);
      add(output.persistentAttackTarget.statusCount, persistentAttack.statusCount);
      add(output.persistentAttackTarget.proposalByAction,
        persistentAttack.proposalByAction);
      const continuation = persistentAttack.continuationSearch;
      if (continuation) {
        for (const key of ["attemptCount", "triggerCount", "completeCount",
          "incompleteCount", "supportSkipCount", "runtimeSkipCount",
          "safetySkipCount", "strictDominanceCount", "shadowDominanceCount",
          "proposalCount", "totalNodes", "rootRestoreFailureCount",
          "hotAllocationCount"])
          output.optionScopedTargetContinuation[key] =
            (output.optionScopedTargetContinuation[key] || 0) +
            (continuation[key] || 0);
        output.optionScopedTargetContinuation.maximumNodes = Math.max(
          output.optionScopedTargetContinuation.maximumNodes || 0,
          continuation.maximumNodes || 0);
      }
    }
    const optionInformation = match.candidateEngine?.optionInformationInterval || {};
    for (const key of ["attemptCount", "resultCount", "exactRootCount",
      "orderingOnlyRootCount", "resolvedRowCount", "fullRangeRowCount",
      "strictDominanceCount", "differentPrimitiveCount", "overrideCount",
      "hardBlockedCount", "riskBlockedCount", "optionSupportBlockedCount",
      "truncatedCount", "noChallengerCount", "totalNodes"])
      output.optionInformationInterval[key] =
        (output.optionInformationInterval[key] || 0) + (optionInformation[key] || 0);
    output.optionInformationInterval.maximumNodes = Math.max(
      output.optionInformationInterval.maximumNodes || 0,
      optionInformation.maximumNodes || 0);
    for (let index = 0; index < output.optionInformationInterval.proposalKindCount.length;
      index += 1)
      output.optionInformationInterval.proposalKindCount[index] +=
        optionInformation.proposalKindCount?.[index] || 0;
    for (let index = 0; index < output.optionInformationInterval.actionTransitionCount.length;
      index += 1)
      output.optionInformationInterval.actionTransitionCount[index] +=
        optionInformation.actionTransitionCount?.[index] || 0;
    const attackSetupClosure = optionInformation.attackSetupClosure || {};
    for (const key of ["evaluationCount", "certifiedCount", "rejectedCount",
      "incompleteCount", "hotAllocationCount"])
      output.attackSetupClosure[key] = (output.attackSetupClosure[key] || 0) +
        (attackSetupClosure[key] || 0);
    const twoStage = attackSetupClosure.twoStage || {};
    for (const key of ["evaluationCount", "certifiedCount", "rejectedCount",
      "incompleteCount", "nodeCount", "rootRestoreFailures", "hotAllocationCount"])
      output.twoStageAttackSetup[key] = (output.twoStageAttackSetup[key] || 0) +
        (twoStage[key] || 0);
    output.twoStageAttackSetup.maximumNodes = Math.max(
      output.twoStageAttackSetup.maximumNodes || 0, twoStage.maximumNodes || 0);
    for (let bit = 0; bit < output.twoStageAttackSetup.reasonBitCounts.length; bit += 1)
      output.twoStageAttackSetup.reasonBitCounts[bit] +=
        twoStage.reasonBitCounts?.[bit] || 0;
    const possibleSetup = attackSetupClosure.possibleProjectile || {};
    for (const key of ["evaluationCount", "certifiedCount", "rejectedCount",
      "incompleteCount", "rootRestoreFailures", "presentNodeCount",
      "cadenceRephaseCount", "hotAllocationCount"])
      output.possibleProjectileAttackSetup[key] =
        (output.possibleProjectileAttackSetup[key] || 0) + (possibleSetup[key] || 0);
    output.possibleProjectileAttackSetup.maximumPresentNodes = Math.max(
      output.possibleProjectileAttackSetup.maximumPresentNodes || 0,
      possibleSetup.maximumPresentNodes || 0);
    const search = match.candidateEngine?.runtimeSchedule || {};
    output.selective.frames += search.selectiveFrames || 0;
    output.selective.nodes += search.selectiveNodes || 0;
    for (let depth = 0; depth < output.selective.depthCounts.length; depth += 1)
      output.selective.depthCounts[depth] += search.selectiveCompletedDepthCounts?.[depth] || 0;
    output.strictRescue.checks += layer.strictRescueChecks || 0;
    output.strictRescue.candidates += layer.strictRescueCandidates || 0;
    output.strictRescue.overrides += layer.strictRescueOverrides || 0;
    output.strictRescue.finalRejects += layer.strictRescueFinalRejects || 0;
    output.strictRescue.proofConflicts += layer.strictProofRescueConflicts || 0;
    output.strictRescue.legacyRestrictions += layer.escapeRestrictions || 0;
    output.verifiedDirectKill.checks += layer.verifiedDirectKillChecks || 0;
    output.verifiedDirectKill.candidates += layer.verifiedDirectKillCandidates || 0;
    output.verifiedDirectKill.overrides += layer.verifiedDirectKillOverrides || 0;
    output.verifiedDirectKill.finalRejects += layer.verifiedDirectKillFinalRejects || 0;
    output.verifiedDirectKill.observed += layer.verifiedDirectKillObserved || 0;
    output.verifiedDirectKill.hardBlocked += layer.verifiedDirectKillHardBlocked || 0;
    output.verifiedDirectKill.riskBlocked += layer.verifiedDirectKillRiskBlocked || 0;
    output.verifiedDirectKill.closureBlocked += layer.verifiedDirectKillClosureBlocked || 0;
    output.verifiedDirectKill.purposeBlocked += layer.verifiedDirectKillPurposeBlocked || 0;
    output.verifiedDirectKill.escapeBlocked += layer.verifiedDirectKillEscapeBlocked || 0;
    output.verifiedDirectKill.exposureBlocked += layer.verifiedDirectKillExposureBlocked || 0;
    output.verifiedDirectKill.robustBlocked += layer.verifiedDirectKillRobustBlocked || 0;
    output.verifiedDirectKill.sourceBlocked += layer.verifiedDirectKillSourceBlocked || 0;
    output.verifiedDirectKill.alreadySelected += layer.verifiedDirectKillAlreadySelected || 0;
    output.verifiedDirectKill.causalCandidates +=
      layer.verifiedDirectKillCausalCandidates || 0;
    output.verifiedDirectKill.causalOverrides +=
      layer.verifiedDirectKillCausalOverrides || 0;
    output.residualAttackProof.checks += layer.residualAttackProofChecks || 0;
    output.residualAttackProof.proven += layer.residualAttackProofProven || 0;
    output.residualAttackProof.disproven += layer.residualAttackProofDisproven || 0;
    output.residualAttackProof.unknown += layer.residualAttackProofUnknown || 0;
    output.residualAttackProof.incompleteSupportProven +=
      layer.residualAttackProofIncompleteSupportProven || 0;
    output.residualAttackProof.nodes += layer.residualAttackProofNodes || 0;
    output.residualAttackProof.rootRestoreFailures +=
      layer.residualAttackProofRootRestoreFailures || 0;
    addCensus(output.noAcceptableCensus, match.candidateEngine?.noAcceptableCensus);
    const shotClosure = match.candidate?.aimSetupPostFireClosure;
    if (shotClosure) {
      for (const key of ["observationCount", "fireRootCount", "supportSkipCount",
        "zeroSignalFireCount", "postFireEvaluationCount", "postFireSafeCount",
        "postFireDeadCount", "postFireUnknownCount", "aimCandidateCount",
        "aimMovementRowCount", "aimHardBlockedCount", "aimRiskBlockedCount",
        "aimDominatedSeenCount", "aimRiskWorseCount",
        "aimRawRayImprovementRootCount",
        "aimCompleteCandidateCount", "aimIncompleteCandidateCount",
        "aimRayImprovementRootCount", "aimProposalCount", "aimUnsafeCount",
        "aimUnknownCount", "postFireNodeCount", "setupNodeCount",
        "aimRescueProposalCount", "aimQualityProposalCount",
        "aimProposalDespiteStaticRiskCount", "activeOverrideCount",
        "activeRescueOverrideCount", "activeQualityOverrideCount",
        "activeRecordOverflowCount", "fastQualityTriggerCount",
        "fastQualityDistanceSkipCount",
        "rootRestoreFailures", "hotAllocationCount"])
        output.aimSetupPostFireClosure[key] =
          (output.aimSetupPostFireClosure[key] || 0) + (shotClosure[key] || 0);
      output.aimSetupPostFireClosure.enabled = true;
      if (shotClosure.activeOverrideCount) output.aimSetupPostFireClosure.behaviorNeutral = false;
      output.aimSetupPostFireClosure.physicalOnly = true;
      output.aimSetupPostFireClosure.postFireDepth = shotClosure.postFireDepth;
      output.aimSetupPostFireClosure.postFireBudget = shotClosure.postFireBudget;
      output.aimSetupPostFireClosure.setupSafetyDepth = shotClosure.setupSafetyDepth;
      output.aimSetupPostFireClosure.setupSafetyBudget = shotClosure.setupSafetyBudget;
    }
    const directFire = match.candidate?.directClearSafeFire;
    if (directFire) {
      for (const key of ["checkCount", "actionClassSkipCount", "proofOwnerSkipCount",
        "supportSkipCount", "geometrySkipCount", "noFireRowCount", "hardBlockedCount",
        "riskBlockedCount", "safetyProvenCount", "safetyDeadCount",
        "safetyUnknownCount", "overrideCount", "totalNodes",
        "rootRestoreFailureCount", "recordOverflowCount", "hotAllocationCount"])
        output.directClearSafeFire[key] = (output.directClearSafeFire[key] || 0) +
          (directFire[key] || 0);
      output.directClearSafeFire.enabled = true;
      output.directClearSafeFire.depth = directFire.depth;
      output.directClearSafeFire.nodeBudget = directFire.nodeBudget;
    }
    const alignment = match.candidate?.visibleRayAlignment;
    if (alignment) {
      for (const key of ["checkCount", "actionClassSkipCount", "ownerSkipCount",
        "supportSkipCount", "geometrySkipCount", "sameActionCount", "noTurnRowCount",
        "hardBlockedCount", "riskBlockedCount", "dominatedBlockedCount",
        "safetyProvenCount", "safetyDeadCount", "safetyUnknownCount", "overrideCount",
        "totalNodes", "rootRestoreFailureCount", "recordOverflowCount",
        "hotAllocationCount"])
        output.visibleRayAlignment[key] = (output.visibleRayAlignment[key] || 0) +
          (alignment[key] || 0);
      output.visibleRayAlignment.enabled = true;
      output.visibleRayAlignment.depth = alignment.depth;
      output.visibleRayAlignment.nodeBudget = alignment.nodeBudget;
    }
    const v1Direct = match.candidate?.v1DirectInitiativeTransplant;
    if (v1Direct) {
      for (const key of ["checkCount", "ownerSkipCount", "supportSkipCount",
        "committedSkipCount", "resourceSkipCount", "geometrySkipCount",
        "distanceSkipCount", "initiativeLostCount", "tieLeadCount",
        "noRowCount", "hardBlockedCount", "riskBlockedCount",
        "dominatedBlockedCount", "safetyProvenCount", "safetyDeadCount",
        "safetyUnknownCount", "proposalCount", "sameActionCount",
        "overrideCount", "turnOverrideCount", "fireOverrideCount", "totalNodes",
        "rootRestoreFailureCount", "recordOverflowCount", "hotAllocationCount"])
        output.v1DirectInitiativeTransplant[key] =
          (output.v1DirectInitiativeTransplant[key] || 0) + (v1Direct[key] || 0);
      output.v1DirectInitiativeTransplant.enabled = true;
      output.v1DirectInitiativeTransplant.depth = v1Direct.depth;
      output.v1DirectInitiativeTransplant.nodeBudget = v1Direct.nodeBudget;
    }
    const stageOracle = match.candidate?.v1StageOracleTransplant;
    if (stageOracle) {
      for (const key of ["checkCount", "stageCallCount", "noProposalCount",
        "strictOwnerSkipCount", "committedSkipCount", "noRowCount",
        "hardBlockedCount", "riskBlockedCount", "dominatedBlockedCount",
        "proposalCount", "sameActionCount", "overrideCount",
        "goOverrideCount", "turnOverrideCount", "fireOverrideCount",
        "otherOverrideCount", "hotAllocationCount"])
        output.v1StageOracleTransplant[key] =
          (output.v1StageOracleTransplant[key] || 0) + (stageOracle[key] || 0);
      output.v1StageOracleTransplant.enabled = true;
      output.v1StageOracleTransplant.stage = stageOracle.stage;
      output.v1StageOracleTransplant.requireRisk = stageOracle.requireRisk;
      output.v1StageOracleTransplant.searchRoundsCount = addArray(
        output.v1StageOracleTransplant.searchRoundsCount,
        stageOracle.searchRoundsCount);
      for (const key of ["policyValueRootCount", "monteCarloRootCount"])
        output.v1StageOracleTransplant[key] =
          (output.v1StageOracleTransplant[key] || 0) + (stageOracle[key] || 0);
      if (stageOracle.ownershipAttribution) {
        if (!output.v1StageOracleTransplant.ownershipAttribution)
          output.v1StageOracleTransplant.ownershipAttribution = {};
        const target = output.v1StageOracleTransplant.ownershipAttribution;
        for (const [key, value] of Object.entries(stageOracle.ownershipAttribution)) {
          if (key === "familyDisagreement") continue;
          target[key] = (target[key] || 0) + (value || 0);
        }
        if (!target.familyDisagreement) target.familyDisagreement = {};
        add(target.familyDisagreement,
          stageOracle.ownershipAttribution.familyDisagreement);
      }
    }
    const nativeOwner = match.candidate?.nativeTacticalActionOwner;
    if (nativeOwner) {
      for (const key of ["checkCount", "nonContactSkipCount",
        "nonContactBaseCheckCount", "nonContactBaseProposalCount",
        "nonContactBaseOverrideCount", "nonContactBaseMissingCount",
        "directAttackCheckCount", "directAttackProposalCount",
        "directAttackSameCount", "directAttackOverrideCount",
        "directAttackMissingCount", "directAttackHardBlockedCount",
        "directAttackShadowSearchSameCount",
        "directAttackShadowSearchDifferentCount",
        "preemptiveCheckCount", "preemptiveProposalCount",
        "preemptiveContinuationCheckCount",
        "preemptiveContinuationProposalCount", "preemptiveSameCount",
        "preemptiveOverrideCount", "preemptiveMissingCount",
        "preemptiveHardBlockedCount", "preemptiveShadowSearchSameCount",
        "preemptiveShadowSearchDifferentCount",
        "strictOwnerSkipCount", "committedSkipCount",
        "committedSearchCount", "committedSearchCompleteCount",
        "committedSearchIncompleteCount", "committedSearchNoMemberCount",
        "committedSearchMemberBlockedCount",
        "committedSearchSelectionViolationCount", "noCompleteValueCount",
        "physicalOwnerCount", "informationOwnerCount", "proposalCount",
        "sameActionCount", "overrideCount", "goOverrideCount",
        "turnOverrideCount", "fireOverrideCount", "otherOverrideCount",
        "domainBlockedCount", "riskSupportMissingCount", "riskRejectedCount",
        "riskDominatedCount", "selectedRiskOnlyDominatedCount",
        "selectedJointDominatedCount", "exactFireBypassCount", "nominalBackupCount",
        "nominalBackupSkipCount", "attackPosePrepareCount",
        "attackPoseEvidenceCount", "attackPoseOverrideCount",
        "attackPoseSameCount", "attackPoseTerminalProtectedCount",
        "attackPoseTerminalLossRejectedCount", "attackPoseAimTurnAcceptedCount",
        "attackPoseAimTurnRejectedCount",
        "stunWindowRootCount", "stunWindowStrictSkipCount",
        "stunWindowCommittedSkipCount", "stunWindowCompleteSearchCount",
        "stunWindowIncompleteSearchCount", "stunWindowFireMissingCount",
        "stunWindowFireHardBlockedCount", "stunWindowFireDomainBlockedCount",
        "stunWindowFireSourceDomainBlockedCount",
        "stunWindowFireOwnerDomainBlockedCount",
        "stunWindowFireIntentBlockedCount", "stunWindowOwnProjectileCount",
        "stunWindowFireLockCount",
        "stunWindowFireEligibleCount", "stunWindowFireMinimaxBestCount",
        "stunWindowFireFinalSelectedCount", "stunWindowFireDirectKillCount",
        "stunWindowFirePossibleHitCount", "stunWindowFireInterceptCount",
        "stunWindowFireAimSetupCount", "stunWindowFirePostEscapeCount",
        "stunWindowFirePurposeCompleteCount",
        "stunWindowFireVerifiedOpportunityCount",
        "qualifiedFireRootCount", "qualifiedFirePresentCount",
        "qualifiedFireAllowedCount", "qualifiedFireRiskRejectedCount",
        "qualifiedFireRiskDominatedCount", "qualifiedFirePurposeCount",
        "qualifiedFireDirectKillCount", "qualifiedFirePossibleHitCount",
        "qualifiedFireInterceptCount", "qualifiedFireAimSetupCount",
        "qualifiedFireEnemyDoomedCount", "qualifiedFireUnknownResponseCount",
        "qualifiedFirePostEscapeCount", "qualifiedFireClosureCompleteCount",
        "qualifiedFireVerifiedCount", "qualifiedFireMinimaxSelectedCount",
        "qualifiedFireFinalSelectedCount", "qualifiedFireValueLossCount",
        "qualifiedFireTieLossCount", "qualifiedFireRawWorstLossCount",
        "qualifiedFireRawWorstTieCount", "qualifiedFireRawWorstWinCount",
        "qualifiedFireNominalFlipCount", "qualifiedFireIntentFlipCount",
        "qualifiedFireIntentGapSum", "qualifiedFireTerminalLossCount",
        "qualifiedFireDominatesBestCount",
        "qualifiedFireDominatedByBestCount",
        "qualifiedFireMatrixTradeoffCount", "qualifiedFireValueGapSum",
        "qualifiedFireOwnerCheckCount",
        "qualifiedFireOwnerIntentProposalCount",
        "qualifiedFireOwnerResponseProposalCount",
        "qualifiedFireOwnerClosureBlockedCount",
        "qualifiedFireOwnerWouldOverrideCount",
        "qualifiedFireOwnerOverrideCount", "qualifiedFireOwnerSameCount",
        "qualifiedFireOracleAuditCount", "qualifiedFireOracleMissingCount",
        "qualifiedFireOraclePairComparedCount",
        "qualifiedFireOracleFireLowerCount",
        "qualifiedFireOracleFireTieCount",
        "qualifiedFireOracleFireHigherCount",
        "qualifiedFireOracleBestAgreementCount",
        "qualifiedFireOracleBestFireCount", "qualifiedFireOracleGapSum",
        "qualifiedFireOneStepFireComparedCount",
        "qualifiedFireOneStepFireMismatchCount",
        "qualifiedFireOneStepFireUnsupportedCount",
        "qualifiedFireOneStepBestComparedCount",
        "qualifiedFireOneStepBestMismatchCount",
        "qualifiedFireOneStepBestUnsupportedCount",
        "qualifiedFireDeepFireComparedCount",
        "qualifiedFireDeepFireMismatchCount",
        "qualifiedFireDeepFireUnsupportedCount",
        "qualifiedFireDeepBestComparedCount",
        "qualifiedFireDeepBestMismatchCount",
        "qualifiedFireDeepBestUnsupportedCount",
        "qualifiedFireMismatchOneStepFireComparedCount",
        "qualifiedFireMismatchOneStepFireMismatchCount",
        "qualifiedFireMismatchOneStepFireUnsupportedCount",
        "qualifiedFireMismatchOneStepBestComparedCount",
        "qualifiedFireMismatchOneStepBestMismatchCount",
        "qualifiedFireMismatchOneStepBestUnsupportedCount",
        "qualifiedFireMismatchDeepFireComparedCount",
        "qualifiedFireMismatchDeepFireMismatchCount",
        "qualifiedFireMismatchDeepFireUnsupportedCount",
        "qualifiedFireMismatchDeepBestComparedCount",
        "qualifiedFireMismatchDeepBestMismatchCount",
        "qualifiedFireMismatchDeepBestUnsupportedCount",
        "resourceDominanceCheckCount",
        "resourceDominanceAcceptedCount", "resourceDominanceRejectedCount",
        "intentMembershipRootCount", "intentMembershipBlockedCount",
        "softRiskCandidateCount", "softRiskIntentAllowedCount",
        "softRiskImmediateBlockedCount", "softRiskUnknownBlockedCount",
        "softRiskDominatedBlockedCount", "softRiskIntentBlockedCount",
        "basePolicyVerifierCheckCount", "basePolicyVerifierAvailableCount",
        "basePolicyVerifierKeptCount", "basePolicyVerifierSearchOverrideCount",
        "basePolicyVerifierResourceBlockedCount",
        "policySearchStrictSupportBlockedCount",
        "verifiedInterceptCheckCount", "verifiedInterceptFireRowCount",
        "verifiedInterceptValueBlockedCount", "verifiedInterceptClosureBlockedCount",
        "verifiedInterceptNoDoomedResponseCount",
        "verifiedInterceptUnknownResponseCount",
        "verifiedInterceptEscapeBlockedCount", "verifiedInterceptPurposeBlockedCount",
        "verifiedInterceptExposureBlockedCount", "verifiedInterceptEvidenceCount",
        "verifiedInterceptWouldOverrideCount", "verifiedInterceptOverrideCount",
        "poisonProposalCheckCount", "poisonProposalRowCount",
        "poisonProposalVisibilityBlockedCount",
        "poisonProposalAlreadyActiveBlockedCount",
        "poisonProposalEnemyEffectBlockedCount",
        "poisonProposalCadenceBlockedCount",
        "poisonProposalRelevanceBlockedCount", "poisonProposalRiskBlockedCount",
        "poisonProposalCommittedBlockedCount", "poisonProposalValueBlockedCount",
        "poisonProposalCellwiseBlockedCount",
        "poisonProposalBasePolicyBlockedCount", "poisonProposalEvidenceCount",
        "poisonProposalWouldOverrideCount", "poisonProposalOverrideCount",
        "hotAllocationCount"])
        output.nativeTacticalActionOwner[key] =
          (output.nativeTacticalActionOwner[key] || 0) + (nativeOwner[key] || 0);
      for (const key of ["stunWindowIncumbentActionCount",
        "stunWindowMinimaxActionCount", "stunWindowFinalActionCount",
        "stunWindowFireGapHistogram", "qualifiedFireBestActionCount",
        "qualifiedFireReasonCount", "qualifiedFireGapHistogram",
        "qualifiedFireOneStepFireComponentSignedDifference",
        "qualifiedFireOneStepFireComponentAbsDifference",
        "qualifiedFireOneStepBestComponentSignedDifference",
        "qualifiedFireOneStepBestComponentAbsDifference",
        "qualifiedFireDeepFireComponentSignedDifference",
        "qualifiedFireDeepFireComponentAbsDifference",
        "qualifiedFireDeepBestComponentSignedDifference",
        "qualifiedFireDeepBestComponentAbsDifference",
        "qualifiedFireMismatchOneStepFireComponentSignedDifference",
        "qualifiedFireMismatchOneStepFireComponentAbsDifference",
        "qualifiedFireMismatchOneStepBestComponentSignedDifference",
        "qualifiedFireMismatchOneStepBestComponentAbsDifference",
        "qualifiedFireMismatchDeepFireComponentSignedDifference",
        "qualifiedFireMismatchDeepFireComponentAbsDifference",
        "qualifiedFireMismatchDeepBestComponentSignedDifference",
        "qualifiedFireMismatchDeepBestComponentAbsDifference"])
        if (nativeOwner[key])
          output.nativeTacticalActionOwner[key] = addArray(
            output.nativeTacticalActionOwner[key], nativeOwner[key]);
      output.nativeTacticalActionOwner.qualifiedFireValueGapMax = Math.max(
        output.nativeTacticalActionOwner.qualifiedFireValueGapMax || 0,
        nativeOwner.qualifiedFireValueGapMax || 0);
      output.nativeTacticalActionOwner.qualifiedFireOracleGapMax = Math.max(
        output.nativeTacticalActionOwner.qualifiedFireOracleGapMax || 0,
        nativeOwner.qualifiedFireOracleGapMax || 0);
      output.nativeTacticalActionOwner.qualifiedFireOwnerMode =
        nativeOwner.qualifiedFireOwnerMode;
      output.nativeTacticalActionOwner.enabled = true;
      output.nativeTacticalActionOwner.attackPoseOptionFirst =
        nativeOwner.attackPoseOptionFirst === true;
      output.nativeTacticalActionOwner.attackPoseRequiredAimTurns =
        nativeOwner.attackPoseRequiredAimTurns;
      output.nativeTacticalActionOwner.resourceRequiresCellwiseDominance =
        nativeOwner.resourceRequiresCellwiseDominance === true;
      output.nativeTacticalActionOwner.intentMembership =
        nativeOwner.intentMembership === true;
      output.nativeTacticalActionOwner.riskFrontierMode =
        nativeOwner.riskFrontierMode;
      output.nativeTacticalActionOwner.riskSoftBandMode =
        nativeOwner.riskSoftBandMode;
      output.nativeTacticalActionOwner.intentValueMode =
        nativeOwner.intentValueMode;
      output.nativeTacticalActionOwner.nonContactBasePolicy =
        nativeOwner.nonContactBasePolicy === true;
      output.nativeTacticalActionOwner.directAttackBasePolicy =
        nativeOwner.directAttackBasePolicy;
      output.nativeTacticalActionOwner.preemptiveSafetyBasePolicy =
        nativeOwner.preemptiveSafetyBasePolicy;
      output.nativeTacticalActionOwner.committedSearchMode =
        nativeOwner.committedSearchMode;
      output.nativeTacticalActionOwner.basePolicyVerifierMode =
        nativeOwner.basePolicyVerifierMode;
      output.nativeTacticalActionOwner.basePolicyVerifierMargin =
        nativeOwner.basePolicyVerifierMargin;
      output.nativeTacticalActionOwner.policySearchSupportMode =
        nativeOwner.policySearchSupportMode;
      output.nativeTacticalActionOwner.verifiedInterceptMode =
        nativeOwner.verifiedInterceptMode;
      output.nativeTacticalActionOwner.verifiedInterceptBand =
        nativeOwner.verifiedInterceptBand;
      output.nativeTacticalActionOwner.poisonProposalMode =
        nativeOwner.poisonProposalMode;
      output.nativeTacticalActionOwner.poisonProposalPolicy =
        nativeOwner.poisonProposalPolicy;
    const terminalTrade = match.candidate?.nativeTerminalTradeAudit;
    if (terminalTrade) {
      for (const key of ["rootAuditCount", "worstDominatedSelectionCount",
        "terminalBandDominatedSelectionCount", "selectedFireCount",
        "directCounterTradeCount", "nonWinningTradeCount",
        "enemyFireMissingCount", "enemyFireTerminalLossCount",
        "enemyFireNonterminalCount", "robustBlendAboveWorstCount",
        "strictlySaferWorstAlternativeCount", "initiativeCheckCount",
        "directInitiativeCount", "unfavorableInitiativeCount",
        "favorableInitiativeCount", "baseRowMissingCount",
        "baseRowUnsafeCount", "baseWorstNotBetterCount",
        "ownershipWouldYieldCount", "ownershipYieldCount",
        "successorTradeCheckCount", "successorTradeEvidenceCount",
        "successorTradeWouldYieldCount", "successorTradeYieldCount",
        "successorTradeRegressionBlockedCount",
        "pairedTerminalCheckCount", "pairedTerminalCompleteCount",
        "pairedTerminalRawImprovementCount",
        "pairedTerminalBandImprovementCount",
        "pairedTerminalWouldYieldCount", "pairedTerminalYieldCount",
        "overflowCount", "frontierOverflowCount", "hotAllocationCount"])
        output.nativeTerminalTradeAudit[key] =
          (output.nativeTerminalTradeAudit[key] || 0) +
          (terminalTrade[key] || 0);
      output.nativeTerminalTradeAudit.enabled = true;
      output.nativeTerminalTradeAudit.ownershipMode = terminalTrade.ownershipMode;
    }
    const candidateForcedWin = match.candidate?.nativeCandidateForcedWin;
    if (candidateForcedWin) {
      for (const key of ["checkCount", "informationBlockedCount",
        "resolvedProjectileGapCount", "possibleProjectileWorldBlockedCount",
        "incumbentMissingCount", "sameBestCount", "nonPositiveMarginCount",
        "candidateExactCount", "incumbentExactCount", "exactPairCount",
        "exactDominanceCount", "exactDominanceWouldOverrideCount",
        "exactDominanceOverrideCount",
        "proofCheckCount", "provenCount", "disprovenCount", "unknownCount",
        "wouldOverrideCount", "overrideCount", "nodeCount",
        "restoreFailureCount", "hotAllocationCount"])
        output.nativeCandidateForcedWin[key] =
          (output.nativeCandidateForcedWin[key] || 0) +
          (candidateForcedWin[key] || 0);
      output.nativeCandidateForcedWin.maximumNodes = Math.max(
        output.nativeCandidateForcedWin.maximumNodes || 0,
        candidateForcedWin.maximumNodes || 0);
      output.nativeCandidateForcedWin.candidateByAction = addArray(
        output.nativeCandidateForcedWin.candidateByAction,
        candidateForcedWin.candidateByAction);
      output.nativeCandidateForcedWin.exactDominanceByAction = addArray(
        output.nativeCandidateForcedWin.exactDominanceByAction,
        candidateForcedWin.exactDominanceByAction);
      output.nativeCandidateForcedWin.provenByAction = addArray(
        output.nativeCandidateForcedWin.provenByAction,
        candidateForcedWin.provenByAction);
      output.nativeCandidateForcedWin.enabled = true;
      output.nativeCandidateForcedWin.mode = candidateForcedWin.mode;
      output.nativeCandidateForcedWin.exactDominanceMode =
        candidateForcedWin.exactDominanceMode;
      output.nativeCandidateForcedWin.depth = candidateForcedWin.depth;
      output.nativeCandidateForcedWin.nodeBudget = candidateForcedWin.nodeBudget;
      output.nativeCandidateForcedWin.semantics = candidateForcedWin.semantics;
    }
    const syntheticResource = match.candidate?.nativeSyntheticResourceRoot;
    if (syntheticResource) {
      for (const key of ["checkCount", "prefilterRootCount", "eligibleCount",
        "triggerBlockedCount", "cadenceCompatibilityBlockedCount",
        "strictOwnerBlockedCount", "committedBlockedCount",
        "skillBlockedCount", "visibilityBlockedCount", "effectBlockedCount",
        "cadenceBlockedCount", "relevanceBlockedCount", "baseRowMissingCount",
        "searchIncompleteCount", "baseSupportMissingCount",
        "cellwiseRegressionCount", "cellwiseTieCount",
        "terminalLossBlockedCount", "evidenceCount", "wouldOverrideCount",
        "overrideCount", "hotAllocationCount"])
        output.nativeSyntheticResourceRoot[key] =
          (output.nativeSyntheticResourceRoot[key] || 0) +
          (syntheticResource[key] || 0);
      output.nativeSyntheticResourceRoot.enabled = true;
      output.nativeSyntheticResourceRoot.mode = syntheticResource.mode;
    }
    const poisonOption = match.candidate?.nativePoisonResourceOption;
    if (poisonOption) {
      for (const key of ["checkCount", "prefilterPassCount",
        "searchIncompleteCount", "supportMissingCount",
        "cellIntervalRegressionCount", "cellIntervalTieCount",
        "worstNotImprovedCount", "robustNotImprovedCount",
        "terminalLossBlockedCount", "certificateCount", "wouldOverrideCount",
        "overrideCount", "hotAllocationCount"])
        output.nativePoisonResourceOption[key] =
          (output.nativePoisonResourceOption[key] || 0) +
          (poisonOption[key] || 0);
      output.nativePoisonResourceOption.enabled = true;
      output.nativePoisonResourceOption.mode = poisonOption.mode;
      output.nativePoisonResourceOption.semantics = poisonOption.semantics;
      output.nativePoisonResourceOption.depth = poisonOption.depth;
      output.nativePoisonResourceOption.nodeBudget = poisonOption.nodeBudget;
      output.nativePoisonResourceOption.feedbackMode = poisonOption.feedbackMode;
    }
    const poisonAttack = match.candidate?.nativePoisonAttackEventOption;
    if (poisonAttack) {
      for (const key of ["checkCount", "prefilterRootCount", "eligibleCount",
        "triggerBlockedCount",
        "strictOwnerBlockedCount", "committedBlockedCount",
        "skillBlockedCount", "visibilityBlockedCount", "supportBlockedCount",
        "effectBlockedCount", "distanceBlockedCount", "candidateProvenCount",
        "candidateDisprovenCount", "candidateUnknownCount",
        "noHoldEvidenceCount", "baselineDisprovenCount",
        "baselineProvenCount", "baselineUnknownCount", "certificateCount",
        "wouldOverrideCount", "overrideCount", "candidateNodes",
        "baselineNodes", "rootRestoreFailureCount", "hotAllocationCount",
        "continuationArmCount", "continuationCheckCount",
        "continuationSelectCount", "continuationSameCount",
        "continuationMissCount", "continuationSupportAbortCount",
        "continuationHardAbortCount", "continuationOwnerAbortCount",
        "continuationCompleteCount", "continuationExactHitCount",
        "continuationSemanticHitCount", "candidateRootDomainGenerationCount",
        "continuationCandidateEntryCount",
        "candidateRootDomainGenerationFailureCount",
        "baselineRootDomainGenerationCount",
        "baselineRootDomainGenerationFailureCount",
          "candidatePolicyCapacityStopCount",
          "baselinePolicyCapacityStopCount", "candidateProvenPolicyEntries",
          "searchTransitionCount", "searchHardClassifyCount",
          "searchReverseBuildCount",
          "policySnapshotIncompleteCount", "policySnapshotCaptureCount",
          "policySnapshotOverflowCount", "policySnapshotLookupCount",
          "policySnapshotHitCount"])
        output.nativePoisonAttackEventOption[key] =
          (output.nativePoisonAttackEventOption[key] || 0) +
          (poisonAttack[key] || 0);
      output.nativePoisonAttackEventOption.isolationAllocationCount =
        (output.nativePoisonAttackEventOption.isolationAllocationCount || 0) +
        (poisonAttack.isolationAllocationCount || 0);
      for (const key of ["maximumCandidateNodes", "maximumBaselineNodes",
        "maximumCandidateProvenPolicyEntries", "policySnapshotCapacity",
        "policySnapshotMaximumEntries", "policySnapshotLastEntries"])
        output.nativePoisonAttackEventOption[key] = Math.max(
          output.nativePoisonAttackEventOption[key] || 0,
          poisonAttack[key] || 0);
      for (const key of ["eligibleByDistance", "provenByDistance",
        "certificateByDistance", "candidateNodesByDistance",
        "eligibleByProjectileBucket", "provenByProjectileBucket",
        "certificateByProjectileBucket", "candidateNodesByProjectileBucket",
        "eligibleByAxis", "provenByAxis", "certificateByAxis",
        "candidateNodesByAxis",
        "eligibleByIncumbentAction", "provenByIncumbentAction",
        "certificateByIncumbentAction", "certificateByCompletedDepth",
        "continuationMismatchMaskCount", "continuationStatusFieldMismatchCount"]) {
        const source = poisonAttack[key];
        if (!Array.isArray(source)) continue;
        if (!Array.isArray(output.nativePoisonAttackEventOption[key]))
          output.nativePoisonAttackEventOption[key] = new Array(source.length).fill(0);
        const target = output.nativePoisonAttackEventOption[key];
        for (let index = 0; index < source.length; index += 1)
          target[index] += source[index] || 0;
      }
      output.nativePoisonAttackEventOption.enabled = true;
      output.nativePoisonAttackEventOption.mode = poisonAttack.mode;
      output.nativePoisonAttackEventOption.triggerMode = poisonAttack.triggerMode;
      output.nativePoisonAttackEventOption.requireSimulatorCadenceAgreement =
        poisonAttack.requireSimulatorCadenceAgreement;
      output.nativePoisonAttackEventOption.sharedSearch = poisonAttack.sharedSearch;
      output.nativePoisonAttackEventOption.snapshotSearch = poisonAttack.snapshotSearch;
      output.nativePoisonAttackEventOption.searchImplementation =
        poisonAttack.searchImplementation;
      output.nativePoisonAttackEventOption.semantics = poisonAttack.semantics;
      output.nativePoisonAttackEventOption.maximumDepth =
        poisonAttack.maximumDepth;
      output.nativePoisonAttackEventOption.nodeBudget = poisonAttack.nodeBudget;
    }
    const policyEnvelope = match.candidate?.nativePolicyResponseEnvelope;
    if (policyEnvelope) {
      for (const key of ["checkCount", "poseMissingCount",
        "committedBlockedCount", "baseRowMissingCount",
        "candidateRowMissingCount", "rootPolicyNoActionCount",
        "sameRootActionCount",
        "differentRootActionCount", "bindFailureCount",
        "searchIncompleteCount", "completeCount", "equalCount",
        "candidateDominanceCount", "baseDominanceCount", "tradeoffCount",
        "candidateWorstImprovementCount", "candidateValueImprovementCount",
        "terminalLossAvoidedCount", "terminalLossIntroducedCount",
        "wouldOverrideCount", "overrideCount",
        "eventQualifiedDominanceCount", "eventRejectedDominanceCount",
        "rootEventCheckCount", "rootEventDeferredCount",
        "hotAllocationCount"])
        output.nativePolicyResponseEnvelope[key] =
          (output.nativePolicyResponseEnvelope[key] || 0) +
          (policyEnvelope[key] || 0);
      output.nativePolicyResponseEnvelope.enabled = true;
      output.nativePolicyResponseEnvelope.mode = policyEnvelope.mode;
      output.nativePolicyResponseEnvelope.semantics = policyEnvelope.semantics;
      output.nativePolicyResponseEnvelope.depth = policyEnvelope.depth;
      output.nativePolicyResponseEnvelope.nodeBudget = policyEnvelope.nodeBudget;
      output.nativePolicyResponseEnvelope.policyId = policyEnvelope.policyId;
      output.nativePolicyResponseEnvelope.requireEventClosure =
        policyEnvelope.requireEventClosure === true;
      output.nativePolicyResponseEnvelope.reusePreparedBase =
        policyEnvelope.reusePreparedBase === true;
      output.nativePolicyResponseEnvelope.rootEventOnly =
        policyEnvelope.rootEventOnly === true;
      output.nativePolicyResponseEnvelope.preparedDepthCount = addArray(
        output.nativePolicyResponseEnvelope.preparedDepthCount,
        policyEnvelope.preparedDepthCount);
    }
    const longEvent = match.candidate?.nativeLongOptionEventEnvelope;
    if (longEvent) {
      for (const key of ["checkCount", "poseMissingCount",
        "committedBlockedCount", "candidateRowMissingCount",
        "rootFireSkipCount", "rootRouteCount", "evaluationCount",
        "completeEvaluationCount", "eventClosedCount", "terminalClosedCount",
        "deathCount",
        "abortCount", "rescueCount", "openCount", "incompleteCount",
        "winCount", "policyLossCount", "nodeCount", "transitionCount",
        "mergeHitCount", "ttStoreCount", "ttCapacityFailureCount",
        "budgetStopCount", "fastIncompleteCount", "hardIncompleteCount",
        "rootRestoreFailureCount", "wouldProposeCount",
        "hotAllocationCount"])
        output.nativeLongOptionEventEnvelope[key] =
          (output.nativeLongOptionEventEnvelope[key] || 0) +
          (longEvent[key] || 0);
      for (const key of ["maximumNodes", "maximumTransitions"])
        output.nativeLongOptionEventEnvelope[key] = Math.max(
          output.nativeLongOptionEventEnvelope[key] || 0,
          longEvent[key] || 0);
      output.nativeLongOptionEventEnvelope.enabled = true;
      output.nativeLongOptionEventEnvelope.mode = longEvent.mode;
      output.nativeLongOptionEventEnvelope.semantics = longEvent.semantics;
      output.nativeLongOptionEventEnvelope.maximumFrames =
        longEvent.maximumFrames;
      output.nativeLongOptionEventEnvelope.nodeBudget = longEvent.nodeBudget;
      for (const key of ["outcomeMaskCount", "routeByAction",
        "eventClosedByAction"])
        output.nativeLongOptionEventEnvelope[key] = addArray(
          output.nativeLongOptionEventEnvelope[key], longEvent[key]);
    }
    const responseMass = match.candidate?.nativeLongOptionResponseMass;
    if (responseMass) {
      for (const key of ["checkCount", "poseMissingCount",
        "committedBlockedCount", "candidateRowMissingCount",
        "rootFireSkipCount", "rootRouteCount", "pairCount",
        "pairCompleteCount", "pairIncompleteCount", "sameRootActionCount",
        "differentRootActionCount", "sameActionMismatchCount",
        "sameActionPartialDriftCount", "equalCount",
        "candidateDominanceCount", "baseDominanceCount", "tradeoffCount",
        "wouldOverrideCount", "overrideCount", "finalGateCheckCount",
        "finalGateRejectCount", "hostFinalCheckCount",
        "hostFinalApprovedCount", "hostFinalRejectCount",
        "hostFinalFallbackCount", "hostFinalNoSafeActionCount",
        "hostFinalFallbackFailureCount",
        "baseNodeCount", "candidateNodeCount",
        "baseTransitionCount", "candidateTransitionCount",
        "sharedMergeHitCount", "mergeHitCount", "ttStoreCount",
        "ttCapacityFailureCount", "budgetStopCount", "fastIncompleteCount",
        "hardIncompleteCount", "rootRestoreFailureCount",
        "basePolicyRouteCount", "basePolicyIncompleteCount",
        "attackPolicyRouteCount", "rootValueProposalCount",
        "rootValueProposalMissingCount",
        "verifierRootValueProposalCount",
        "verifierRootValueProposalMissingCount",
        "progressiveRootCount", "progressiveRootMismatchCount",
        "exact2To4Count", "exact4To6Count", "exact2To6Count",
        "closed2Exact6Count", "closed4Exact6Count",
        "closed2DriftCount", "closed4DriftCount",
        "strictStopAt2Count", "strictStopAt4Count", "strictStopAt6Count",
        "strictSavedNodeCount", "strictSavedTransitionCount",
        "progressiveHotAllocationCount",
        "transitionRequestCount", "transitionRequestUniqueCount",
        "transitionRequestRepeatCount",
        "transitionRequestCrossPolicyRepeatCount",
        "transitionRequestSamePolicyRepeatCount",
        "transitionRequestOverflowCount", "transitionRequestProbeCount",
        "successorObservationCount", "successorUniqueCount",
        "successorRepeatCount", "crossCommandSameSuccessorCount",
        "crossRequestSameSuccessorCount",
        "canonicalEquivalentSameSuccessorCount",
        "unexplainedSameSuccessorCount",
        "successorOverflowCount", "successorProbeCount",
        "deltaWriteCount", "repeatDeltaWriteCount",
        "transitionCensusHotAllocationCount",
        "canonicalLookupCount", "canonicalComparisonCount",
        "canonicalHitCount", "canonicalStoreCount",
        "canonicalCapacityFailureCount", "canonicalChargedNodeCount",
        "canonicalChargedMergeCount", "canonicalMemoHotAllocationCount",
        "domainVisitCount", "stunnedDomainCount", "turnPairDomainCount",
        "compactedActionCount", "compactedWeightTotal",
        "zeroWeightPairCount", "compactionHotAllocationCount",
        "frontierCensusHotAllocationCount",
        "enemyOptionStateCount", "enemyOptionHotAllocationCount",
        "enemyPolicyStateCount", "enemyPolicyHotAllocationCount",
        "optionCensusRootCount", "optionCensusRootMismatchCount",
        "optionRelationAgreementCount", "optionRelationDisagreementCount",
        "optionExactMassCount", "fullCompleteOptionCompleteCount",
        "fullCompleteOptionIncompleteCount",
        "fullIncompleteOptionCompleteCount",
        "fullIncompleteOptionIncompleteCount", "fullBaseNodeCount",
        "fullCandidateNodeCount", "fullBaseTransitionCount",
        "fullCandidateTransitionCount", "fullBudgetStopCount",
        "fullPairCompleteCount", "fullPairIncompleteCount",
        "fullRootRestoreFailureCount", "optionCensusHotAllocationCount",
        "policyConsensusCount", "policyConsensusAgreementCount",
        "policyConsensusDisagreementCount", "candidateConsensusCount",
        "candidateConsensusTrueCount", "candidateConsensusFalseCount",
        "selectiveVerifierAttemptCount", "selectiveVerifierCertifiedCount",
        "selectiveVerifierRejectedCount", "selectiveVerifierIncompleteCount",
        "selectiveVerifierMissedCertificateCount",
        "selectiveVerifierPortfolioNodeCount",
        "selectiveVerifierPortfolioTransitionCount",
        "selectiveVerifierPrimitiveNodeCount",
        "selectiveVerifierPrimitiveTransitionCount",
        "verifierAttemptCount", "verifierCertifiedCount",
        "verifierRejectedCount", "verifierIncompleteCount",
        "verifierMissingCount", "ownershipClassRejectCount",
        "ownershipValueRejectCount",
        "hotAllocationCount"])
        output.nativeLongOptionResponseMass[key] =
          (output.nativeLongOptionResponseMass[key] || 0) +
          (responseMass[key] || 0);
      for (const key of ["maximumNodes", "maximumTransitions",
        "maximumDeltaWrites"])
        output.nativeLongOptionResponseMass[key] = Math.max(
          output.nativeLongOptionResponseMass[key] || 0,
          responseMass[key] || 0);
      for (const key of ["baseMassTotal", "candidateMassTotal",
        "massDeltaTotal", "baseOutcomeMaskCount", "candidateOutcomeMaskCount",
        "routeByAction", "overrideByAction", "overrideActionMatrix",
        "certifiedClassCount", "wouldOverrideClassCount",
        "overrideClassCount", "rootValueRelationCount",
        "certificateValueRelationCount"])
        if (responseMass[key])
          output.nativeLongOptionResponseMass[key] = addArray(
            output.nativeLongOptionResponseMass[key], responseMass[key]);
      for (const key of ["stateEntryByDepth", "stateLeafByDepth",
        "branchLeafByDepth", "ttHitByDepth", "domainVisitByDepth",
        "domainActionTotalByDepth", "transitionBudgetStopByDepth",
        "nodeBudgetStopByDepth", "budgetStopByPolicy",
        "budgetStopByOwnAction", "budgetStopByEnemyAction"])
        if (responseMass[key])
          output.nativeLongOptionResponseMass[key] = addArray(
            output.nativeLongOptionResponseMass[key], responseMass[key]);
      for (const key of ["enemyOptionRouteByAction", "optionRelationMatrix",
        "enemyPolicyRouteByPolicyAction", "policyRelationPatternCount"])
        if (responseMass[key])
          output.nativeLongOptionResponseMass[key] = addArray(
            output.nativeLongOptionResponseMass[key], responseMass[key]);
      if (responseMass.enemyPortfolioWeights)
        output.nativeLongOptionResponseMass.enemyPortfolioWeights =
          responseMass.enemyPortfolioWeights;
      if (responseMass.enemyPortfolioPolicyCount)
        output.nativeLongOptionResponseMass.enemyPortfolioPolicyCount =
          responseMass.enemyPortfolioPolicyCount;
      if (responseMass.enemyPortfolioPrimitivePrefixDepth)
        output.nativeLongOptionResponseMass.enemyPortfolioPrimitivePrefixDepth =
          responseMass.enemyPortfolioPrimitivePrefixDepth;
      for (const key of ["horizonPairCount", "horizonClosedCount",
        "horizonNodeCount", "horizonTransitionCount", "relation2To4",
        "relation4To6", "relation2To6"])
        if (responseMass[key])
          output.nativeLongOptionResponseMass[key] = addArray(
          output.nativeLongOptionResponseMass[key], responseMass[key]);
      if (responseMass.canonicalReasonCount)
        output.nativeLongOptionResponseMass.canonicalReasonCount = addArray(
          output.nativeLongOptionResponseMass.canonicalReasonCount,
          responseMass.canonicalReasonCount);
      if (responseMass.canonicalReasonNames)
        output.nativeLongOptionResponseMass.canonicalReasonNames =
          responseMass.canonicalReasonNames;
      output.nativeLongOptionResponseMass.enabled = true;
      output.nativeLongOptionResponseMass.mode = responseMass.mode;
      output.nativeLongOptionResponseMass.semantics = responseMass.semantics;
      output.nativeLongOptionResponseMass.maximumFrames =
        responseMass.maximumFrames;
      output.nativeLongOptionResponseMass.nodeBudget = responseMass.nodeBudget;
      output.nativeLongOptionResponseMass.massScale = responseMass.massScale;
      output.nativeLongOptionResponseMass.massDimensionNames =
        responseMass.massDimensionNames;
      if (responseMass.candidateProposalMode)
        output.nativeLongOptionResponseMass.candidateProposalMode =
          responseMass.candidateProposalMode;
      output.nativeLongOptionResponseMass.responseOwnershipActive =
        responseMass.responseOwnershipActive === true;
      output.nativeLongOptionResponseMass.strictResponseOwnership =
        responseMass.strictResponseOwnership === true;
      output.nativeLongOptionResponseMass.valueResponseOwnership =
        responseMass.valueResponseOwnership === true;
      output.nativeLongOptionResponseMass.hostClosureActive =
        responseMass.hostClosureActive === true;
      output.nativeLongOptionResponseMass.progressiveHorizon =
        responseMass.progressiveHorizon === true;
      output.nativeLongOptionResponseMass.transitionReuseCensus =
        responseMass.transitionReuseCensus === true;
      output.nativeLongOptionResponseMass.canonicalBranchMemo =
        responseMass.canonicalBranchMemo === true;
      output.nativeLongOptionResponseMass.stunTurnDomainCompaction =
        responseMass.stunTurnDomainCompaction === true;
      output.nativeLongOptionResponseMass.budgetFrontierCensus =
        responseMass.budgetFrontierCensus === true;
      output.nativeLongOptionResponseMass.enemyResponseOptionCensus =
        responseMass.enemyResponseOptionCensus === true;
      output.nativeLongOptionResponseMass.enemyResponsePortfolioCensus =
        responseMass.enemyResponsePortfolioCensus === true;
      output.nativeLongOptionResponseMass.selectiveResponseVerifier =
        responseMass.selectiveResponseVerifier === true;
      if (responseMass.certificateClassNames)
        output.nativeLongOptionResponseMass.certificateClassNames =
          responseMass.certificateClassNames;
      if (responseMass.rootValueRelationNames)
        output.nativeLongOptionResponseMass.rootValueRelationNames =
          responseMass.rootValueRelationNames;
      if (responseMass.canonicalBranchBudgetMode)
        output.nativeLongOptionResponseMass.canonicalBranchBudgetMode =
          responseMass.canonicalBranchBudgetMode;
      if (responseMass.canonicalWidth)
        output.nativeLongOptionResponseMass.canonicalWidth =
          responseMass.canonicalWidth;
      if (responseMass.transitionTableCapacity)
        output.nativeLongOptionResponseMass.transitionTableCapacity =
          responseMass.transitionTableCapacity;
      if (responseMass.horizonFrames)
        output.nativeLongOptionResponseMass.horizonFrames =
          responseMass.horizonFrames;
    }
    const rootAttack = match.candidate?.nativeRootVerifiedAttack;
    if (rootAttack) {
      for (const key of ["checkCount", "fireRowCount",
        "responseEvidenceRowCount", "noRegressionRowCount",
        "proposalCount", "sameSelectedCount", "differentProposalCount",
        "overrideCount", "finalRejectCount", "strictKillProposalCount",
        "hotAllocationCount"])
        output.nativeRootVerifiedAttack[key] =
          (output.nativeRootVerifiedAttack[key] || 0) +
          (rootAttack[key] || 0);
      output.nativeRootVerifiedAttack.active = rootAttack.active === true;
      output.nativeRootVerifiedAttack.requireDirectKill =
        rootAttack.requireDirectKill === true;
    }
      const bounded = nativeOwner.policySearch;
      if (bounded) {
        for (const key of ["prepareCount", "completeCount", "rootCount",
          "totalNodes", "maximumNodes", "leafBudgetCount",
          "fastIncompleteCount", "hardIncompleteCount", "hardAllowCount",
          "hardRejectProvenCount", "hardRejectPolicyCount", "terminalCount",
          "recordTerminalCount", "combatTerminalCount",
          "mutualCombatTerminalCount",
          "pairedTerminalAuditCount", "pairedTerminalNodeCount",
          "pairedTerminalRestoreFailures",
          "resourceOptionEvaluationCount", "resourceOptionCompleteCount",
          "resourceOptionIncompleteCount",
          "resourceOptionBudgetIncompleteCount", "resourceOptionNodeCount",
          "resourceOptionRestoreFailureCount",
          "policyEnvelopeEvaluationCount", "policyEnvelopeCompleteCount",
          "policyEnvelopeIncompleteCount",
          "policyEnvelopeBudgetIncompleteCount",
          "policyEnvelopeContinuationIncompleteCount",
          "policyEnvelopeRescueFallbackCount",
          "policyEnvelopeAbortFallbackCount",
          "policyEnvelopeCompletionFallbackCount",
          "policyEnvelopeInjectedActionCount", "policyEnvelopeNodeCount",
          "policyEnvelopeRestoreFailureCount",
          "policyEnvelopePreparedBaseReuseCount",
          "policyEnvelopePreparedBaseBlockedCount",
          "policyEnvelopePreparedBaseDepthMismatchCount",
          "policyEnvelopePreparedBaseDomainMissingCount",
          "policyEnvelopeEventLeafCount", "policyEnvelopeNoEventLeafCount",
          "policyEnvelopeAbortLeafCount", "policyEnvelopeRescueLeafCount",
          "policyEnvelopeEventCompleteColumnCount",
          "policyEnvelopeEventIncompleteColumnCount",
          "depthLeafCount", "topLeafCount", "ownExpansionCount",
          "enemyExpansionCount", "jointTransitionCount", "chanceOutcomeCount",
          "oracleRecursionRootCount", "oracleRecursionNodeCount",
          "oracleRecursionRootActionCount",
          "oracleRecursionRootEnemyActionCount",
          "oracleRecursionDepthLeafCount", "oracleRecursionBudgetLeafCount",
          "oracleRecursionTerminalLeafCount", "oracleRecursionOwnExpansionCount",
          "oracleRecursionEnemyExpansionCount", "oracleRecursionTransitionCount",
          "oracleRecursionOutcomeCount",
          "rootValueAuditCount", "rootValueDomainExactCount",
          "rootValueTransitionExactCount", "rootValueStrictCount",
          "weightedReplyCount",
          "transitionRootSnapshotCount", "transitionRootAnyMismatchCount",
          "transitionRootFrameMismatchCount", "transitionRootPoseMismatchCount",
          "transitionRootDirectionMismatchCount", "transitionRootStarMismatchCount",
          "transitionRootCrashMismatchCount", "transitionRootProjectileMismatchCount",
          "transitionRootBombMismatchCount", "transitionRootTerrainMismatchCount",
          "transitionRootStatusMismatchCount", "transitionSkippedRootMismatchCount",
          "transitionCensusRootCount", "transitionComparedCount",
          "transitionUnsupportedCount", "transitionMissingActionCount",
          "transitionAnyMismatchCount", "transitionFrameMismatchCount",
          "transitionPoseMismatchCount", "transitionDirectionMismatchCount",
          "transitionStarMismatchCount", "transitionCrashMismatchCount",
          "transitionProjectileMismatchCount", "transitionBombMismatchCount",
          "transitionTerrainMismatchCount", "transitionStatusMismatchCount",
          "transitionLeafSignedDifference", "transitionLeafAbsDifference",
          "transitionExactLeafCount",
          "superkoCheckCount", "superkoPenaltyCount", "superkoPenaltyTotal",
          "superkoPathMatchCount", "superkoRootMatchCount", "superkoReliefCount",
          "syntheticRootEvaluationCount", "syntheticRootCompleteCount",
          "syntheticRootIncompleteCount", "syntheticRootNodeCount",
          "syntheticRootRestoreFailureCount",
          "rootRestoreFailureCount", "hotAllocationCount",
          "strictOwnershipRootCount", "exactOwnershipRootCount",
          "heuristicOwnershipRootCount", "exactRowCount", "blockedRowCount",
          "iterativeRootCount", "iterativeAttemptCount",
          "iterativePublishedCount", "iterativeNoCompleteLayerCount",
          "iterativeDeeperIncompleteCount", "iterativeBudgetStopCount",
          "iterativeSpentNodes", "hardBudgetInterruptCount",
          "eventQuiescenceCheckCount", "eventQuiescenceExpansionCount",
          "eventQuiescenceQuietLeafCount", "eventQuiescenceCappedLeafCount",
          "eventQuiescenceProjectileLeafCount",
          "eventQuiescenceBombLeafCount",
          "eventQuiescencePolicyRouteCount",
          "eventQuiescencePolicyRouteIncompleteCount",
          "eventQuiescencePolicyDomainMissCount",
          "ownContinuationRouteCount",
          "ownContinuationRouteIncompleteCount",
          "ownContinuationDomainFallbackCount",
          "ownContinuationSecondaryRouteCount",
          "ownContinuationSecondaryIncompleteCount",
          "ownContinuationPortfolioDedupCount",
          "rootPolicyPrepareCount", "rootPolicyPrimaryIncompleteCount",
          "rootPolicySecondaryIncompleteCount",
          "rootPolicySecondaryFilteredCount", "rootPolicyDistinctCount",
          "rootPolicyPrimaryRowCount", "rootPolicySecondaryRowCount",
          "invocationCompareCount", "invocationBothCount",
          "invocationNativeOnlyCount", "invocationOracleOnlyCount",
          "invocationNeitherCount", "externalRootRestrictionCount",
          "externalRootRestrictedRowCount"])
          output.nativeBoundedPolicySearch[key] = key === "maximumNodes" ?
            Math.max(output.nativeBoundedPolicySearch[key] || 0,
              bounded[key] || 0) :
            (output.nativeBoundedPolicySearch[key] || 0) + (bounded[key] || 0);
        output.nativeBoundedPolicySearch.enabled = true;
        output.nativeBoundedPolicySearch.invocationNativeOnlyByResult = addArray(
          output.nativeBoundedPolicySearch.invocationNativeOnlyByResult,
          bounded.invocationNativeOnlyByResult);
        output.nativeBoundedPolicySearch.invocationOracleOnlyByResult = addArray(
          output.nativeBoundedPolicySearch.invocationOracleOnlyByResult,
          bounded.invocationOracleOnlyByResult);
        output.nativeBoundedPolicySearch.rowExactBlockMaskCount = addArray(
          output.nativeBoundedPolicySearch.rowExactBlockMaskCount,
          bounded.rowExactBlockMaskCount);
        output.nativeBoundedPolicySearch.exactBlockMaskCount = addArray(
          output.nativeBoundedPolicySearch.exactBlockMaskCount,
          bounded.exactBlockMaskCount);
        output.nativeBoundedPolicySearch.policyEnvelopePreparedBaseBlockMaskCount =
          addArray(output.nativeBoundedPolicySearch
            .policyEnvelopePreparedBaseBlockMaskCount,
          bounded.policyEnvelopePreparedBaseBlockMaskCount);
        output.nativeBoundedPolicySearch.pairedTerminalMaximumNodes = Math.max(
          output.nativeBoundedPolicySearch.pairedTerminalMaximumNodes || 0,
          bounded.pairedTerminalMaximumNodes || 0);
        output.nativeBoundedPolicySearch.syntheticRootMaximumNodes = Math.max(
          output.nativeBoundedPolicySearch.syntheticRootMaximumNodes || 0,
          bounded.syntheticRootMaximumNodes || 0);
        output.nativeBoundedPolicySearch.resourceOptionMaximumNodes = Math.max(
          output.nativeBoundedPolicySearch.resourceOptionMaximumNodes || 0,
          bounded.resourceOptionMaximumNodes || 0);
        output.nativeBoundedPolicySearch.policyEnvelopeMaximumNodes = Math.max(
          output.nativeBoundedPolicySearch.policyEnvelopeMaximumNodes || 0,
          bounded.policyEnvelopeMaximumNodes || 0);
        output.nativeBoundedPolicySearch.policyEnvelopeSemantics =
          bounded.policyEnvelopeSemantics;
        output.nativeBoundedPolicySearch.semantics = bounded.semantics;
        output.nativeBoundedPolicySearch.targetDepth = bounded.targetDepth;
        output.nativeBoundedPolicySearch.depthSchedule = bounded.depthSchedule;
        output.nativeBoundedPolicySearch.rootColumnOrder = bounded.rootColumnOrder;
        output.nativeBoundedPolicySearch.rootBudgetMode = bounded.rootBudgetMode;
        output.nativeBoundedPolicySearch.hardBudgetInterrupt =
          bounded.hardBudgetInterrupt === true;
        output.nativeBoundedPolicySearch.scheduledDepthCount = addArray(
          output.nativeBoundedPolicySearch.scheduledDepthCount,
          bounded.scheduledDepthCount);
        if (bounded.iterativePublishedDepthCount)
          output.nativeBoundedPolicySearch.iterativePublishedDepthCount = addArray(
            output.nativeBoundedPolicySearch.iterativePublishedDepthCount,
            bounded.iterativePublishedDepthCount);
        output.nativeBoundedPolicySearch.policyNodeDepthCount = addArray(
          output.nativeBoundedPolicySearch.policyNodeDepthCount,
          bounded.policyNodeDepthCount);
        output.nativeBoundedPolicySearch.deepActionCount = addArray(
          output.nativeBoundedPolicySearch.deepActionCount,
          bounded.deepActionCount);
        output.nativeBoundedPolicySearch.oracleRecursionActionCount = addArray(
          output.nativeBoundedPolicySearch.oracleRecursionActionCount,
          bounded.oracleRecursionActionCount);
        output.nativeBoundedPolicySearch.nativeRootActionCount = addArray(
          output.nativeBoundedPolicySearch.nativeRootActionCount,
          bounded.nativeRootActionCount);
        output.nativeBoundedPolicySearch.oracleRootEnemyActionCount = addArray(
          output.nativeBoundedPolicySearch.oracleRootEnemyActionCount,
          bounded.oracleRootEnemyActionCount);
        output.nativeBoundedPolicySearch.domainBucketNames =
          bounded.domainBucketNames;
        output.nativeBoundedPolicySearch.domainCompareCount = addArray(
          output.nativeBoundedPolicySearch.domainCompareCount,
          bounded.domainCompareCount);
        output.nativeBoundedPolicySearch.domainSetAgreementCount = addArray(
          output.nativeBoundedPolicySearch.domainSetAgreementCount,
          bounded.domainSetAgreementCount);
        output.nativeBoundedPolicySearch.domainOrderAgreementCount = addArray(
          output.nativeBoundedPolicySearch.domainOrderAgreementCount,
          bounded.domainOrderAgreementCount);
        output.nativeBoundedPolicySearch.domainNativeOnlyActionCount = addArray(
          output.nativeBoundedPolicySearch.domainNativeOnlyActionCount,
          bounded.domainNativeOnlyActionCount);
        output.nativeBoundedPolicySearch.domainOracleOnlyActionCount = addArray(
          output.nativeBoundedPolicySearch.domainOracleOnlyActionCount,
          bounded.domainOracleOnlyActionCount);
        output.nativeBoundedPolicySearch.rootValueTierNames =
          bounded.rootValueTierNames;
        output.nativeBoundedPolicySearch.rootValueCommonActionCount = addArray(
          output.nativeBoundedPolicySearch.rootValueCommonActionCount,
          bounded.rootValueCommonActionCount);
        output.nativeBoundedPolicySearch.rootValuePairComparedCount = addArray(
          output.nativeBoundedPolicySearch.rootValuePairComparedCount,
          bounded.rootValuePairComparedCount);
        output.nativeBoundedPolicySearch.rootValuePairOrderAgreementCount = addArray(
          output.nativeBoundedPolicySearch.rootValuePairOrderAgreementCount,
          bounded.rootValuePairOrderAgreementCount);
        output.nativeBoundedPolicySearch.rootValueBestComparedCount = addArray(
          output.nativeBoundedPolicySearch.rootValueBestComparedCount,
          bounded.rootValueBestComparedCount);
        output.nativeBoundedPolicySearch.rootValueBestAgreementCount = addArray(
          output.nativeBoundedPolicySearch.rootValueBestAgreementCount,
          bounded.rootValueBestAgreementCount);
        output.nativeBoundedPolicySearch.nodeBudget = bounded.nodeBudget;
        output.nativeBoundedPolicySearch.blendBasisPoints = bounded.blendBasisPoints;
        output.nativeBoundedPolicySearch.fullPrimitiveDomain =
          bounded.fullPrimitiveDomain === true;
        output.nativeBoundedPolicySearch.deepDomainMode = bounded.deepDomainMode;
        output.nativeBoundedPolicySearch.deepFireMode = bounded.deepFireMode;
        output.nativeBoundedPolicySearch.deepSkillMode = bounded.deepSkillMode;
        output.nativeBoundedPolicySearch.deepBombMode = bounded.deepBombMode;
        output.nativeBoundedPolicySearch.ownContinuationMode =
          bounded.ownContinuationMode;
        output.nativeBoundedPolicySearch.ownContinuationActionCount = addArray(
          output.nativeBoundedPolicySearch.ownContinuationActionCount,
          bounded.ownContinuationActionCount);
        output.nativeBoundedPolicySearch.ownContinuationPortfolioWidthCount =
          addArray(output.nativeBoundedPolicySearch
            .ownContinuationPortfolioWidthCount,
          bounded.ownContinuationPortfolioWidthCount);
        output.nativeBoundedPolicySearch.eventQuiescenceMode =
          bounded.eventQuiescenceMode;
        output.nativeBoundedPolicySearch.eventQuiescenceContinuationMode =
          bounded.eventQuiescenceContinuationMode;
        output.nativeBoundedPolicySearch.eventQuiescenceMaximumPly =
          bounded.eventQuiescenceMaximumPly;
        output.nativeBoundedPolicySearch.eventQuiescenceExpansionByPly = addArray(
          output.nativeBoundedPolicySearch.eventQuiescenceExpansionByPly,
          bounded.eventQuiescenceExpansionByPly);
        output.nativeBoundedPolicySearch.pathUtility = bounded.pathUtility === true;
        output.nativeBoundedPolicySearch.opponentWeighted =
          bounded.opponentWeighted === true;
        output.nativeBoundedPolicySearch.opponentMode = bounded.opponentMode;
        output.nativeBoundedPolicySearch.v1StunCountdown =
          bounded.v1StunCountdown === true;
        output.nativeBoundedPolicySearch.v1EntryProjectileCollision =
          bounded.v1EntryProjectileCollision === true;
        output.nativeBoundedPolicySearch.deepHardMode = bounded.deepHardMode;
        output.nativeBoundedPolicySearch.rootDomainMode = bounded.rootDomainMode;
        output.nativeBoundedPolicySearch.rootEnemyDomainMode =
          bounded.rootEnemyDomainMode;
        output.nativeBoundedPolicySearch.terminalMode = bounded.terminalMode;
        output.nativeBoundedPolicySearch.ownChanceMode = bounded.ownChanceMode;
        output.nativeBoundedPolicySearch.superkoMode = bounded.superkoMode;
        output.nativeBoundedPolicySearch.historyAdjusted =
          bounded.historyAdjusted === true;
        output.nativeBoundedPolicySearch.transitionStatusFieldMismatch = addArray(
          output.nativeBoundedPolicySearch.transitionStatusFieldMismatch,
          bounded.transitionStatusFieldMismatch);
        output.nativeBoundedPolicySearch.transitionRootStatusFieldMismatch = addArray(
          output.nativeBoundedPolicySearch.transitionRootStatusFieldMismatch,
          bounded.transitionRootStatusFieldMismatch);
        output.nativeBoundedPolicySearch.transitionExactComponentNames =
          bounded.transitionExactComponentNames;
        output.nativeBoundedPolicySearch.transitionExactComponentSignedDifference = addArray(
          output.nativeBoundedPolicySearch.transitionExactComponentSignedDifference,
          bounded.transitionExactComponentSignedDifference);
        output.nativeBoundedPolicySearch.transitionExactComponentAbsDifference = addArray(
          output.nativeBoundedPolicySearch.transitionExactComponentAbsDifference,
          bounded.transitionExactComponentAbsDifference);
        output.nativeBoundedPolicySearch.deepTransitionComparedByPly = addArray(
          output.nativeBoundedPolicySearch.deepTransitionComparedByPly,
          bounded.deepTransitionComparedByPly);
        output.nativeBoundedPolicySearch.deepTransitionUnsupportedByPly = addArray(
          output.nativeBoundedPolicySearch.deepTransitionUnsupportedByPly,
          bounded.deepTransitionUnsupportedByPly);
        output.nativeBoundedPolicySearch.deepTransitionAnyMismatchByPly = addArray(
          output.nativeBoundedPolicySearch.deepTransitionAnyMismatchByPly,
          bounded.deepTransitionAnyMismatchByPly);
        output.nativeBoundedPolicySearch.deepTransitionFieldNames =
          bounded.deepTransitionFieldNames;
        output.nativeBoundedPolicySearch.deepTransitionFieldMismatchByPly = addArray(
          output.nativeBoundedPolicySearch.deepTransitionFieldMismatchByPly,
          bounded.deepTransitionFieldMismatchByPly);
        output.nativeBoundedPolicySearch.deepExactLeafCountByPly = addArray(
          output.nativeBoundedPolicySearch.deepExactLeafCountByPly,
          bounded.deepExactLeafCountByPly);
        output.nativeBoundedPolicySearch.deepLeafSignedDifferenceByPly = addArray(
          output.nativeBoundedPolicySearch.deepLeafSignedDifferenceByPly,
          bounded.deepLeafSignedDifferenceByPly);
        output.nativeBoundedPolicySearch.deepLeafAbsDifferenceByPly = addArray(
          output.nativeBoundedPolicySearch.deepLeafAbsDifferenceByPly,
          bounded.deepLeafAbsDifferenceByPly);
        output.nativeBoundedPolicySearch.deepExactComponentNames =
          bounded.deepExactComponentNames;
        output.nativeBoundedPolicySearch.deepExactComponentSignedDifferenceByPly = addArray(
          output.nativeBoundedPolicySearch.deepExactComponentSignedDifferenceByPly,
          bounded.deepExactComponentSignedDifferenceByPly);
        output.nativeBoundedPolicySearch.deepExactComponentAbsDifferenceByPly = addArray(
          output.nativeBoundedPolicySearch.deepExactComponentAbsDifferenceByPly,
          bounded.deepExactComponentAbsDifferenceByPly);
        for (const [pair, counts] of Object.entries(bounded.transitionPairs || {})) {
          const target = output.nativeBoundedPolicySearch.transitionPairs[pair] ||
            { compared: 0, mismatched: 0 };
          target.compared += counts.compared || 0;
          target.mismatched += counts.mismatched || 0;
          output.nativeBoundedPolicySearch.transitionPairs[pair] = target;
        }
      }
    }
    const skillBridge = match.candidate?.nativeOwnSkillActionBridge;
    if (skillBridge) {
      for (const key of ["installed", "generateCount", "eligibleCount",
        "missingCount", "insertedCount", "alreadyGeneratedCount",
        "unsupportedTargetCount", "capacityFailureCount", "suppressedPoisonCount", "emitCount",
        "emitFallbackCount", "hotAllocationCount"])
        output.nativeOwnSkillActionBridge[key] =
          (output.nativeOwnSkillActionBridge[key] || 0) + (skillBridge[key] || 0);
      output.nativeOwnSkillActionBridge.enabled = skillBridge.enabled === true;
      output.nativeOwnSkillActionBridge.mode = skillBridge.mode;
    }
    const terminalOracle = match.candidate?.terminalOracleIntervention;
    if (terminalOracle) for (const key of ["roots", "checkCount",
      "exactMatchCount", "overrideCount", "sameActionCount",
      "rowMissingCount", "finalBlockedCount", "hotAllocationCount"])
      output.terminalOracleIntervention[key] =
        (output.terminalOracleIntervention[key] || 0) +
        (terminalOracle[key] || 0);
    if (terminalOracle)
      output.terminalOracleIntervention.qualityMode = terminalOracle.qualityMode;
    const selectivePoison = match.candidate?.nativeSelectivePoison;
    if (selectivePoison) {
      for (const key of ["checkCount", "evidenceCount", "wouldOverrideCount",
        "overrideCount", "sameActionCount", "skillBlockedCount",
        "supportBlockedCount", "modeBlockedCount", "incumbentBlockedCount",
        "visibilityBlockedCount", "distanceBlockedCount", "effectBlockedCount",
        "cadenceBlockedCount", "committedBlockedCount", "possibleBlockedCount",
        "stationaryHardBlockedCount", "stationaryRiskBlockedCount",
        "deadlineBlockedCount", "hotAllocationCount"])
        output.nativeSelectivePoison[key] =
          (output.nativeSelectivePoison[key] || 0) + (selectivePoison[key] || 0);
      output.nativeSelectivePoison.enabled = selectivePoison.enabled === true;
      output.nativeSelectivePoison.mode = selectivePoison.mode;
    }
    const policyPrior = match.candidate?.nativePolicyPriorOwner;
    if (policyPrior) {
      for (const key of ["checkCount", "nonContactSkipCount",
        "strictOwnerSkipCount", "committedSkipCount", "noPriorCount",
        "hardBlockedCount", "riskRejectedObservedCount",
        "dominatedObservedCount", "completeVerifierCount",
        "incompleteVerifierCount", "terminalWinVetoCount",
        "terminalLossVetoCount", "proposalCount", "sameActionCount",
        "overrideCount", "goOverrideCount", "turnOverrideCount",
        "fireOverrideCount", "otherOverrideCount", "hotAllocationCount"])
        output.nativePolicyPriorOwner[key] =
          (output.nativePolicyPriorOwner[key] || 0) + (policyPrior[key] || 0);
      output.nativePolicyPriorOwner.enabled = true;
      output.nativePolicyPriorOwner.semantics = policyPrior.semantics;
    }
    const basePolicy = match.candidate?.nativeBasePolicyDifferential;
    if (basePolicy) {
      for (const key of ["compareCount", "actionAgreementCount",
        "actionDisagreementCount", "nativeProposalCount",
        "oracleProposalCount", "bothProposalCount", "nativeFallbackCount",
        "nativeProposalAgreementCount", "nativeProposalDisagreementCount",
        "nativeFallbackAgreementCount", "nativeFallbackDisagreementCount",
        "oracleActionMissingCount", "oracleActionHardBlockedCount",
        "oracleActionDomainBlockedCount", "oracleActionAllowedCount",
        "oracleActionRiskRejectedCount", "oracleActionRiskParetoBlockedCount",
        "oracleActionCommittedBlockedCount",
        "oracleActionSourceDomainBlockedCount",
        "oracleActionOwnerDomainBlockedCount", "oracleActionIntentBlockedCount",
        "oracleActionOtherMembershipBlockedCount",
        "oracleActionRankedLowerCount", "oracleActionRankedEqualCount",
        "oracleActionRankedHigherCount",
        "nativeActionV1UnsafeCount", "nativeActionV1OverloadTrapCount",
        "nativeActionV1StunnedContactTrapCount",
        "nativeActionV1TurnThenFireTrapCount",
        "monteCarloCompareCount", "monteCarloAgreementCount",
        "monteCarloDisagreementCount", "v1RawBestCompareCount",
        "v1RawBestAgreementCount", "v1PreMonteCarloBestCompareCount",
        "v1PreMonteCarloBestAgreementCount", "v1RawToFinalDifferenceCount",
        "v1PreMonteCarloToFinalDifferenceCount",
        "v1EvaluatedFinalBestCompareCount", "v1EvaluatedFinalBestAgreementCount",
        "v1InstrumentedChosenCompareCount", "v1InstrumentedChosenAgreementCount",
        "v1StageActionCompareCount", "v1StageActionAgreementCount",
        "nativeRawV1RawCompareCount", "nativeRawV1RawAgreementCount",
        "nativeAdjustedV1PreCompareCount", "nativeAdjustedV1PreAgreementCount",
        "basePolicyStageCompareCount", "basePolicyStageAgreementCount",
        "searchStageCommonCompareCount", "searchStageCommonAgreementCount",
        "cellwiseVerifierCompareCount", "cellwiseVerifierAgreementCount",
        "cellwiseVerifierOverrideCount",
        "fullControllerCompareCount", "fullControllerAgreementCount",
        "missedV1FireCount", "missedV1FireMissingRowCount",
        "missedV1FireAllowedCount", "missedV1FireDirectKillCount",
        "missedV1FireAimSetupCount", "missedV1FireInterceptCount",
        "missedV1FirePossibleHitCount", "missedV1FirePostEscapeCount",
        "missedV1FirePurposeCompleteCount",
        "missedV1FireCounterExposureTotal",
        "missedV1FireEnemySafeSuccessorTotal",
        "nativeFireCount", "nativeFireV1Count", "nativeFireInterceptCount",
        "nativeFireV1InterceptCount", "nativeFirePossibleHitCount",
        "nativeFireV1PossibleHitCount", "nativeFirePostEscapeCount",
        "nativeFireV1PostEscapeCount", "nativeFirePurposeCompleteCount",
        "nativeFireV1PurposeCompleteCount", "nativeFireCounterExposureTotal",
        "nativeFireV1CounterExposureTotal",
        "pairwiseOrderCount",
        "pairwiseConcordantCount", "pairwiseDiscordantCount",
        "pairwiseTieCount",
        "rawPairwiseOrderCount", "rawPairwiseConcordantCount",
        "rawPairwiseDiscordantCount", "rawPairwiseTieCount",
        "hotAllocationCount"])
        output.nativeBasePolicyDifferential[key] =
          (output.nativeBasePolicyDifferential[key] || 0) +
          (basePolicy[key] || 0);
      output.nativeBasePolicyDifferential.enabled = true;
      output.nativeBasePolicyDifferential.semantics = basePolicy.semantics;
      output.nativeBasePolicyDifferential.activeOwner = basePolicy.activeOwner;
      output.nativeBasePolicyDifferential.fullControllerStageNames =
        basePolicy.fullControllerStageNames;
      output.nativeBasePolicyDifferential.verifierMargins =
        basePolicy.verifierMargins;
      output.nativeBasePolicyDifferential.missedV1FireGapLimits =
        basePolicy.missedV1FireGapLimits;
      output.nativeBasePolicyDifferential.missedV1FireGapBuckets = addArray(
        output.nativeBasePolicyDifferential.missedV1FireGapBuckets,
        basePolicy.missedV1FireGapBuckets);
      add(output.nativeBasePolicyDifferential.familyPairs,
        basePolicy.familyPairs);
      add(output.nativeBasePolicyDifferential.exactPairs,
        basePolicy.exactPairs);
      add(output.nativeBasePolicyDifferential.intentPairs,
        basePolicy.intentPairs);
      for (let index = 0; index < 6; index += 1) {
        output.nativeBasePolicyDifferential.fallbackByReason[index] +=
          basePolicy.fallbackByReason?.[index] || 0;
        output.nativeBasePolicyDifferential.fallbackDisagreementByReason[index] +=
          basePolicy.fallbackDisagreementByReason?.[index] || 0;
      }
      for (let index = 0; index < 5; index += 1) {
        output.nativeBasePolicyDifferential.compareByNativeDepth[index] +=
          basePolicy.compareByNativeDepth?.[index] || 0;
        output.nativeBasePolicyDifferential.agreementByNativeDepth[index] +=
          basePolicy.agreementByNativeDepth?.[index] || 0;
        output.nativeBasePolicyDifferential.disagreementByNativeDepth[index] +=
          basePolicy.disagreementByNativeDepth?.[index] || 0;
      }
      for (let index = 0; index < 25; index += 1)
        output.nativeBasePolicyDifferential.depthRoundPairs[index] +=
          basePolicy.depthRoundPairs?.[index] || 0;
      for (let index = 0; index < 7; index += 1) {
        output.nativeBasePolicyDifferential.basePolicyVerifierCompareCount[index] +=
          basePolicy.basePolicyVerifierCompareCount?.[index] || 0;
        output.nativeBasePolicyDifferential.basePolicyVerifierAgreementCount[index] +=
          basePolicy.basePolicyVerifierAgreementCount?.[index] || 0;
      }
      for (let index = 0; index < OWNERSHIP_STAGE_NAMES.length; index += 1) {
        output.nativeBasePolicyDifferential.fullControllerStageCount[index] +=
          basePolicy.fullControllerStageCount?.[index] || 0;
        output.nativeBasePolicyDifferential.fullControllerStageAgreementCount[index] +=
          basePolicy.fullControllerStageAgreementCount?.[index] || 0;
      }
    }
    const nativeDomain = match.candidate?.nativeTacticalDomain;
    if (nativeDomain) {
      for (const key of ["checkCount", "fireCheckCount", "directFireCount",
        "interceptFireCount", "blockedFireCount", "resourceCheckCount",
        "bombAllowedCount", "bombBlockedCount", "skillAllowedCount",
        "skillBlockedCount", "hotAllocationCount"])
        output.nativeTacticalDomain[key] =
          (output.nativeTacticalDomain[key] || 0) + (nativeDomain[key] || 0);
      output.nativeTacticalDomain.enabled = true;
      output.nativeTacticalDomain.mode = nativeDomain.mode;
    }
    const nativeLeaf = match.candidate?.nativeTacticalLeafEvaluator;
    if (nativeLeaf) {
      for (const key of ["callCount", "projectileThreatCount", "projectileWasteCount",
        "directAimCount", "attackSetupCount", "bombPressureCount", "clampCount",
        "componentClampCount",
        "attackRaceWinCount", "attackRaceLossCount", "attackRaceTieCount",
        "openLineCount", "dodgeableLineCount", "hotAllocationCount"])
        output.nativeTacticalLeafEvaluator[key] =
          (output.nativeTacticalLeafEvaluator[key] || 0) + (nativeLeaf[key] || 0);
      output.nativeTacticalLeafEvaluator.enabled = true;
      output.nativeTacticalLeafEvaluator.clampMode = nativeLeaf.clampMode;
      output.nativeTacticalLeafEvaluator.clampLimit = nativeLeaf.clampLimit;
    }
    const pathUtility = match.candidate?.nativeV1PathUtility;
    if (pathUtility) {
      for (const key of ["callCount", "fireCount", "directFireCount",
        "dirtFireCount", "emptyFireCount", "bombCount", "turnCount",
        "reversalCount", "stunCount", "responseFirePrepareCount",
        "responseFireAppliedCount", "responseFirePositiveCount",
        "responseFireDeltaTotal", "hotAllocationCount"])
        output.nativeV1PathUtility[key] =
          (output.nativeV1PathUtility[key] || 0) + (pathUtility[key] || 0);
      output.nativeV1PathUtility.enabled = true;
      output.nativeV1PathUtility.semantics = pathUtility.semantics;
      output.nativeV1PathUtility.responseConditionedFire =
        pathUtility.responseConditionedFire === true;
    }
    const nativeRepresentative = match.candidate?.nativeTacticalRepresentative;
    if (nativeRepresentative) {
      for (const key of ["generateCount", "contactCount",
        "attackTargetOverrideCount", "enemyStrategicPreserveCount",
        "hotAllocationCount"])
        output.nativeTacticalRepresentative[key] =
          (output.nativeTacticalRepresentative[key] || 0) +
          (nativeRepresentative[key] || 0);
      output.nativeTacticalRepresentative.enabled = true;
      output.nativeTacticalRepresentative.ownOnly = nativeRepresentative.ownOnly === true;
    }
    const nativeHistory = match.candidate?.nativeTacticalHistory;
    const nativeIntent = match.candidate?.nativeTacticalIntent;
    const nativeAttackPose = match.candidate?.nativeAttackPoseOption;
    const nativeAttackPoseFeedback =
      match.candidate?.nativeAttackPoseFeedbackSearch;
    if (nativeIntent) {
      for (const key of ["prepareCount", "attackCount", "starCount", "edgeCount",
        "faceCount", "evadeCount", "continuityCount", "switchCount",
        "contextChangeCount", "bonusRowCount", "mappingActionCount",
        "mappingMissingRowCount", "mappingOracleCompareCount",
        "mappingOracleAgreementCount", "proposedOracleCompareCount",
        "proposedOracleAgreementCount", "committedOracleCompareCount",
        "committedOracleAgreementCount", "oracleContextCompareCount",
        "oracleContextAgreementCount", "hotAllocationCount"])
        output.nativeTacticalIntent[key] =
          (output.nativeTacticalIntent[key] || 0) + (nativeIntent[key] || 0);
      output.nativeTacticalIntent.enabled = true;
      output.nativeTacticalIntent.margin = nativeIntent.margin;
      output.nativeTacticalIntent.mappingMode = nativeIntent.mappingMode;
      output.nativeTacticalIntent.continuityMode = nativeIntent.continuityMode;
      output.nativeTacticalIntent.classificationMode = nativeIntent.classificationMode;
      output.nativeTacticalIntent.proposedOraclePairs = addArray(
        output.nativeTacticalIntent.proposedOraclePairs,
        nativeIntent.proposedOraclePairs || []);
      output.nativeTacticalIntent.committedOraclePairs = addArray(
        output.nativeTacticalIntent.committedOraclePairs,
        nativeIntent.committedOraclePairs || []);
      output.nativeTacticalIntent.mappingOraclePairs = addArray(
        output.nativeTacticalIntent.mappingOraclePairs,
        nativeIntent.mappingOraclePairs || []);
      output.nativeTacticalIntent.mappingIntentOraclePairs = addArray(
        output.nativeTacticalIntent.mappingIntentOraclePairs,
        nativeIntent.mappingIntentOraclePairs || []);
    }
    if (nativeAttackPose) {
      for (const key of ["rootCount", "optionCount", "optionOverflowCount",
        "completeRootCount", "incompleteRootCount", "supportedRowCount",
        "directFireRowCount", "progressRowCount", "routeTurnCount",
        "rejectedPrematureTurnCount", "contextChangeCount",
        "generatedOptionCount", "commitKeepCount", "commitSwitchCount",
        "commitInvalidationCount", "fullCoverageRootCount",
        "partialCoverageRootCount", "fullCoverageRejectedCount",
        "uncoveredRegressionRejectedRowCount",
        "responseDerivedRootCount", "responseDerivedPoseCount",
        "successorViabilityCheckCount", "successorViableRowCount",
        "successorRejectedRowCount", "successorDistanceFillCount",
        "hotAllocationCount"])
        output.nativeAttackPoseOption[key] =
          (output.nativeAttackPoseOption[key] || 0) + (nativeAttackPose[key] || 0);
      output.nativeAttackPoseOption.enabled = true;
      output.nativeAttackPoseOption.capacity = nativeAttackPose.capacity;
      output.nativeAttackPoseOption.routeProof = nativeAttackPose.routeProof === true;
      output.nativeAttackPoseOption.persistent = nativeAttackPose.persistent === true;
      output.nativeAttackPoseOption.requireFullCoverage =
        nativeAttackPose.requireFullCoverage === true;
      output.nativeAttackPoseOption.requireUncoveredNonRegression =
        nativeAttackPose.requireUncoveredNonRegression === true;
      output.nativeAttackPoseOption.responseDerivedPoses =
        nativeAttackPose.responseDerivedPoses === true;
      output.nativeAttackPoseOption.requireSuccessorResponseViability =
        nativeAttackPose.requireSuccessorResponseViability === true;
    }
    if (nativeAttackPoseFeedback) {
      for (const key of ["prepareCount", "completeCount", "noPoseCount",
        "nonContactSkipCount", "hostileSkipCount", "promotedCount",
        "alreadyFirstCount", "injectedCount", "displacedCount", "fireCount",
        "goCount", "turnCount", "hotAllocationCount"])
        output.nativeAttackPoseFeedbackSearch[key] =
          (output.nativeAttackPoseFeedbackSearch[key] || 0) +
          (nativeAttackPoseFeedback[key] || 0);
      output.nativeAttackPoseFeedbackSearch.enabled = true;
    }
    if (nativeHistory) {
      for (const key of ["signatureCount", "heuristicCount", "turnStreakCount",
        "turnReversalCount", "hotAllocationCount"])
        output.nativeTacticalHistory[key] =
          (output.nativeTacticalHistory[key] || 0) + (nativeHistory[key] || 0);
      output.nativeTacticalHistory.enabled = true;
    }
  }
  output.noAcceptableCensus.rootBasisPoints = output.noAcceptableCensus.decisionCount ?
    Math.round(output.noAcceptableCensus.rootCount * 10000 /
      output.noAcceptableCensus.decisionCount) : 0;
  output.nativeBasePolicyDifferential.agreementBasisPoints =
    output.nativeBasePolicyDifferential.compareCount ?
      Math.round(output.nativeBasePolicyDifferential.actionAgreementCount * 10000 /
        output.nativeBasePolicyDifferential.compareCount) : 0;
  output.scoreBasisPoints = Math.round(scoreUnits * 5000 /
    Math.max(1, selected.length));
  output.scorePercent = (output.scoreBasisPoints / 100).toFixed(2);
  for (const target of [output.projectileFunnel.candidate,
    output.projectileFunnel.control]) {
    target.killsPer10000Projectiles = target.created ?
      Math.round(target.tankKills * 10000 / target.created) : 0;
    target.counterCrashPer10000Projectiles = target.created ?
      Math.round(target.counterCrashWithin4 * 10000 / target.created) : 0;
    target.averageLifetimeMilliFrames = target.created ?
      Math.round(target.lifetimeFrames * 1000 / target.created) : 0;
  }
  if (candidateShotRecords.length || controlShotRecords.length)
    output.shotQualityCounterExposure = {
      candidate: summarizeShotRecords(candidateShotRecords,
        candidateUnpairedProjectiles),
      control: summarizeShotRecords(controlShotRecords,
        controlUnpairedProjectiles)
    };
  for (const geometry of Object.values(output.attackGeometryOpportunity)) {
    const direct = geometry.geometryCount[GEOMETRY.DIRECT_CLEAR] || 0;
    geometry.directFireBasisPoints = direct ?
      Math.round((geometry.directActionCount[3] || 0) * 10000 / direct) : 0;
    geometry.directOpportunityBasisPoints = geometry.visibleCount ?
      Math.round(direct * 10000 / geometry.visibleCount) : 0;
    geometry.directEntryPreviousOwnership = Object.fromEntries(
      OWNERSHIP_STAGE_NAMES.map((name, index) =>
        [name, geometry.directEntryPreviousOwnershipCount[index] || 0]));
    geometry.directEntryCurrentOwnership = Object.fromEntries(
      OWNERSHIP_STAGE_NAMES.map((name, index) =>
        [name, geometry.directEntryCurrentOwnershipCount[index] || 0]));
    geometry.wrongFacingOwnership = Object.fromEntries(
      OWNERSHIP_STAGE_NAMES.map((name, index) =>
        [name, geometry.wrongFacingOwnershipCount[index] || 0]));
  }
  for (let at = 0; at < selected.length; at += 2) {
    const pair = [selected[at].analysisOutcome, selected[at + 1].analysisOutcome];
    if (pair.every(value => value === "V2_WIN")) output.pairs.candidateSweep += 1;
    else if (pair.every(value => value === "V1_WIN")) output.pairs.controlSweep += 1;
    else if (pair.includes("DRAW")) output.pairs.drawAffected += 1;
    else output.pairs.split += 1;
  }
  output.invariants.riskOnlyDominatedSelection =
    output.invariants.riskDominatedSelection;
  output.invariants.jointDominatedSelection =
    output.nativeTacticalActionOwner.selectedJointDominatedCount || 0;
  return output;
}

function compare(current, initiative) {
  const jointOwner = initiative.nativeTacticalActionOwner?.riskFrontierMode ===
    "joint";
  const dominatedSelection = jointOwner ?
    initiative.invariants.jointDominatedSelection :
    initiative.invariants.riskDominatedSelection;
  return {
    scoreBasisPointDelta: initiative.scoreBasisPoints - current.scoreBasisPoints,
    winDelta: initiative.wins - current.wins,
    lossDelta: initiative.losses - current.losses,
    drawDelta: initiative.draws - current.draws,
    starDelta: (initiative.stars.candidate - initiative.stars.control) -
      (current.stars.candidate - current.stars.control),
    crashDelta: initiative.crashes.candidate - current.crashes.candidate,
    fireDelta: initiative.bullets.candidate - current.bullets.candidate,
    bombDelta: initiative.bombs.candidate - current.bombs.candidate,
    skillDelta: initiative.skills.candidate - current.skills.candidate,
    positive: initiative.scoreBasisPoints >= current.scoreBasisPoints + 300 &&
      initiative.invariants.timeoutError === 0 &&
      initiative.invariants.avoidableHardReject === 0 &&
      dominatedSelection === 0 &&
      initiative.invariants.rootRestoreFailure === 0
  };
}

async function run(root = defaultWorkspaceRoot()) {
  const cohortFile = path.resolve(option("--cohort",
    path.join(root, "config", "engine-v3", "v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const experiment = option("--experiment", "INITIATIVE").toUpperCase();
  const skillMode = option("--skill-mode", "ASYMMETRIC").toUpperCase();
  if (!["ASYMMETRIC", "POISON", "STUN"].includes(skillMode))
    throw new Error(`V2_NATIVE_SKILL_MODE_INVALID:${skillMode}`);
  const kinds = experiment === "FINAL_ONLY_RESCUE" ?
    [CANDIDATE.LEGACY_EARLY_ESCAPE, CANDIDATE.FINAL_ONLY_RESCUE] :
    experiment === "STRICT_RESCUE" ?
    [CANDIDATE.LEGACY_EARLY_ESCAPE, CANDIDATE.STRICT_FINAL_RESCUE] :
    experiment === "DIRECT_KILL" ?
    [CANDIDATE.STRICT_FINAL_RESCUE, CANDIDATE.VERIFIED_DIRECT_KILL] :
    experiment === "RESIDUAL_PROOF" ?
    [CANDIDATE.VERIFIED_DIRECT_KILL, CANDIDATE.RESIDUAL_ATTACK_PROOF_SHADOW] :
    experiment === "STRICT_SAFE_THREAT_FIRE_SHADOW" ?
    [CANDIDATE.CURRENT, CANDIDATE.STRICT_SAFE_THREAT_FIRE_SHADOW] :
    experiment === "STRICT_SAFE_THREAT_FIRE_ACTIVE" ?
    [CANDIDATE.STRICT_SAFE_THREAT_FIRE_SHADOW,
      CANDIDATE.STRICT_SAFE_THREAT_FIRE_ACTIVE] :
    experiment === "STRICT_DOOMED_FIRE_ACTIVE" ?
    [CANDIDATE.STRICT_SAFE_THREAT_FIRE_SHADOW,
      CANDIDATE.STRICT_DOOMED_FIRE_ACTIVE] :
    experiment === "STRICT_SAFE_THREAT_FIRE_SUPPORT_CENSUS" ?
    [CANDIDATE.STRICT_SAFE_THREAT_FIRE_SHADOW] :
    experiment === "NO_ACCEPTABLE_CENSUS" ?
    [CANDIDATE.NO_ACCEPTABLE_CENSUS] :
    experiment === "OBSERVATION_SUPPORT_GUARD" ?
    [CANDIDATE.CURRENT, CANDIDATE.OBSERVATION_SUPPORT_GUARD] :
    experiment === "OBSERVATION_SUPPORT_INFORMATION_EVIDENCE" ?
    [CANDIDATE.OBSERVATION_SUPPORT_GUARD,
      CANDIDATE.OBSERVATION_SUPPORT_INFORMATION_EVIDENCE] :
    experiment === "OBSERVATION_SUPPORT_CONTINUATION_SHADOW" ?
    [CANDIDATE.OBSERVATION_SUPPORT_GUARD,
      CANDIDATE.OBSERVATION_SUPPORT_CONTINUATION_SHADOW] :
    experiment === "OBSERVATION_SUPPORT_OPTION_CONTINUATION_SHADOW" ?
    [CANDIDATE.OBSERVATION_SUPPORT_CONTINUATION_SHADOW,
      CANDIDATE.OBSERVATION_SUPPORT_OPTION_CONTINUATION_SHADOW] :
    experiment === "CURRENT_OPTION_CONTINUATION_SHADOW" ?
    [CANDIDATE.CURRENT, CANDIDATE.CURRENT_OPTION_CONTINUATION_SHADOW] :
    experiment === "CURRENT_OPTION_CONTINUATION_ACTIVE" ?
    [CANDIDATE.CURRENT, CANDIDATE.CURRENT_OPTION_CONTINUATION_ACTIVE] :
    experiment === "STRICT_TARGET_OPTION_CONTINUATION_SHADOW" ?
    [CANDIDATE.CURRENT_OPTION_CONTINUATION_SHADOW,
      CANDIDATE.STRICT_TARGET_OPTION_CONTINUATION_SHADOW] :
    experiment === "STRICT_TARGET_OPTION_CONTINUATION_ACTIVE" ?
    [CANDIDATE.CURRENT, CANDIDATE.STRICT_TARGET_OPTION_CONTINUATION_ACTIVE] :
    experiment === "DYNAMIC_CONTACT_OPTION_CONTINUATION_SHADOW" ?
    [CANDIDATE.STRICT_TARGET_OPTION_CONTINUATION_SHADOW,
      CANDIDATE.DYNAMIC_CONTACT_OPTION_CONTINUATION_SHADOW] :
    experiment === "DYNAMIC_CONTACT_OPTION_CONTINUATION_ACTIVE" ?
    [CANDIDATE.CURRENT, CANDIDATE.DYNAMIC_CONTACT_OPTION_CONTINUATION_ACTIVE] :
    experiment === "POST_RISK_OPTION_CONTINUATION_SHADOW" ?
    [CANDIDATE.CURRENT, CANDIDATE.POST_RISK_OPTION_CONTINUATION_SHADOW] :
    experiment === "POST_RISK_OPTION_CONTINUATION_ACTIVE" ?
    [CANDIDATE.CURRENT, CANDIDATE.POST_RISK_OPTION_CONTINUATION_ACTIVE] :
    experiment === "COMMON_POLICY_OPTION_INTERVAL_SHADOW" ?
    [CANDIDATE.CURRENT, CANDIDATE.COMMON_POLICY_OPTION_INTERVAL_SHADOW] :
    experiment === "COMMON_POLICY_OPTION_INTERVAL_ACTIVE" ?
    [CANDIDATE.CURRENT, CANDIDATE.COMMON_POLICY_OPTION_INTERVAL_ACTIVE] :
    experiment === "ATTACK_FUNNEL_CENSUS" ?
    [CANDIDATE.ATTACK_FUNNEL_CENSUS] :
    experiment === "VERIFIED_ATTACK_PROPOSAL_SHADOW" ?
    [CANDIDATE.CURRENT, CANDIDATE.VERIFIED_ATTACK_PROPOSAL_SHADOW] :
    experiment === "VERIFIED_ATTACK_PROPOSAL_ACTIVE" ?
    [CANDIDATE.CURRENT, CANDIDATE.VERIFIED_ATTACK_PROPOSAL_ACTIVE] :
    experiment === "ATTACK_OBJECTIVE_FIELD_SHADOW" ?
    [CANDIDATE.CURRENT, CANDIDATE.ATTACK_OBJECTIVE_FIELD_SHADOW] :
    experiment === "ATTACK_OBJECTIVE_FIELD_ACTIVE" ?
    [CANDIDATE.CURRENT, CANDIDATE.ATTACK_OBJECTIVE_FIELD_ACTIVE] :
    experiment === "NO_ACCEPTABLE_POSE" ?
    [CANDIDATE.NO_ACCEPTABLE_LEGACY, CANDIDATE.NO_ACCEPTABLE_POSE] :
    experiment === "SELECTIVE_CONTINUATION" ?
    [CANDIDATE.SELECTIVE_CONTINUATION_OFF, CANDIDATE.SELECTIVE_CONTINUATION] :
    experiment === "RESPONSE_OPTION" ?
    [CANDIDATE.CURRENT, CANDIDATE.RESPONSE_OPTION] :
    experiment === "OPTION_PORTFOLIO_SHADOW" ?
    [CANDIDATE.CURRENT, CANDIDATE.OPTION_PORTFOLIO_SHADOW] :
    experiment === "OPTION_AWARE_SEARCH_SHADOW" ?
    [CANDIDATE.CURRENT, CANDIDATE.OPTION_AWARE_SEARCH_SHADOW] :
    experiment === "OPTION_AWARE_SEARCH_ACTIVE" ?
    [CANDIDATE.CURRENT, CANDIDATE.OPTION_AWARE_SEARCH_ACTIVE] :
    experiment === "TERMINAL_PURPOSE_SCOPED" ?
    [CANDIDATE.CURRENT, CANDIDATE.TERMINAL_PURPOSE_SCOPED] :
    experiment === "NO_RESOURCE_ACTIONS" ?
    [CANDIDATE.CURRENT, CANDIDATE.NO_RESOURCE_ACTIONS] :
    experiment === "POISON_ELIGIBILITY_ABLATION" ?
    [CANDIDATE.CURRENT, CANDIDATE.POISON_ELIGIBILITY_ABLATION] :
    experiment === "TERMINAL_ORACLE_INTERVENTION" ?
    [CANDIDATE.CURRENT, CANDIDATE.TERMINAL_ORACLE_INTERVENTION] :
    experiment === "TYPED_OPTION_PORTFOLIO_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.TYPED_OPTION_PORTFOLIO_SHADOW] :
    experiment === "EVENT_DRIVEN_OPTION_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.EVENT_DRIVEN_OPTION_SHADOW] :
    experiment === "STABLE_OPTION_LEDGER_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.STABLE_OPTION_LEDGER_SHADOW] :
    experiment === "STRATEGIC_STATE_LEDGER_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.STRATEGIC_STATE_LEDGER_SHADOW] :
    experiment === "OBJECTIVE_EPOCH_H2_ACTIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.OBJECTIVE_EPOCH_H2_ACTIVE] :
    experiment === "OBJECTIVE_EPOCH_H4_ACTIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.OBJECTIVE_EPOCH_H4_ACTIVE] :
    experiment === "OBJECTIVE_EPOCH_H8_ACTIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.OBJECTIVE_EPOCH_H8_ACTIVE] :
    experiment === "OBJECTIVE_EPOCH_OPTION_ARBITER_SHADOW" ?
      [CANDIDATE.CURRENT,
        CANDIDATE.OBJECTIVE_EPOCH_OPTION_ARBITER_SHADOW] :
    experiment === "OBJECTIVE_EPOCH_OPTION_INTERVAL_SHADOW" ?
      [CANDIDATE.CURRENT,
        CANDIDATE.OBJECTIVE_EPOCH_OPTION_INTERVAL_SHADOW] :
    experiment === "SEMANTIC_OBJECTIVE_EPOCH_OPTION_INTERVAL_SHADOW" ?
      [CANDIDATE.CURRENT,
        CANDIDATE.SEMANTIC_OBJECTIVE_EPOCH_OPTION_INTERVAL_SHADOW] :
    experiment === "SEMANTIC_OBJECTIVE_EPOCH_OPTION_INTERVAL_ACTIVE" ?
      [CANDIDATE.CURRENT,
        CANDIDATE.SEMANTIC_OBJECTIVE_EPOCH_OPTION_INTERVAL_ACTIVE] :
    experiment === "SEMANTIC_ATTACK_OPTION_COVERAGE_SHADOW" ?
      [CANDIDATE.CURRENT,
        CANDIDATE.SEMANTIC_ATTACK_OPTION_COVERAGE_SHADOW] :
    experiment === "SEMANTIC_ATTACK_EXECUTION_INTERVAL_SHADOW" ?
      [CANDIDATE.CURRENT,
        CANDIDATE.SEMANTIC_ATTACK_EXECUTION_INTERVAL_SHADOW] :
    experiment === "SEMANTIC_ATTACK_POLICY_INTERVAL_SHADOW" ?
      [CANDIDATE.CURRENT,
        CANDIDATE.SEMANTIC_ATTACK_POLICY_INTERVAL_SHADOW] :
    experiment === "SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW" ?
      [CANDIDATE.CURRENT,
        CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_SHADOW] :
    experiment === "SEMANTIC_ATTACK_COMMON_CONTINUATION_ACTIVE" ?
      [CANDIDATE.CURRENT,
        CANDIDATE.SEMANTIC_ATTACK_COMMON_CONTINUATION_ACTIVE] :
    experiment === "SEMANTIC_ATTACK_POLICY_INTERVAL_ACTIVE" ?
      [CANDIDATE.CURRENT,
        CANDIDATE.SEMANTIC_ATTACK_POLICY_INTERVAL_ACTIVE] :
    experiment === "STRATEGIC_CONFLICT_ARBITER_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.STRATEGIC_CONFLICT_ARBITER_SHADOW] :
    experiment === "STRATEGIC_TARGET_EXECUTION_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.STRATEGIC_TARGET_EXECUTION_SHADOW] :
    experiment === "STRATEGIC_ATTACK_OVER_STAR_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.STRATEGIC_ATTACK_OVER_STAR_SHADOW] :
    experiment === "STRATEGIC_ATTACK_OVER_STAR_ACTIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.STRATEGIC_ATTACK_OVER_STAR_ACTIVE] :
    experiment === "STRATEGIC_ATTACK_POSSIBLE_RESPONSE_SHADOW" ?
      [CANDIDATE.STRATEGIC_ATTACK_OVER_STAR_SHADOW,
        CANDIDATE.STRATEGIC_ATTACK_POSSIBLE_RESPONSE_SHADOW] :
    experiment === "STRATEGIC_ATTACK_POSSIBLE_RESPONSE_ACTIVE" ?
      [CANDIDATE.STRATEGIC_ATTACK_OVER_STAR_ACTIVE,
        CANDIDATE.STRATEGIC_ATTACK_POSSIBLE_RESPONSE_ACTIVE] :
    experiment === "STRATEGIC_ATTACK_MOVE_VARIANT_ENVELOPE_SHADOW" ?
      [CANDIDATE.STRATEGIC_ATTACK_POSSIBLE_RESPONSE_SHADOW,
        CANDIDATE.STRATEGIC_ATTACK_MOVE_VARIANT_ENVELOPE_SHADOW] :
    experiment === "PROJECTILE_FUNNEL_CENSUS" ? [CANDIDATE.CURRENT] :
    experiment === "SHOT_QUALITY_COUNTEREXPOSURE_CENSUS" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW] :
    experiment === "AIM_SETUP_AND_POST_FIRE_CLOSURE_SHADOW" ?
      [CANDIDATE.AIM_POST_FIRE_CLOSURE_SHADOW] :
    experiment === "AIM_SETUP_POST_FIRE_RESCUE_ACTIVE" ?
      [CANDIDATE.AIM_POST_FIRE_CLOSURE_SHADOW,
        CANDIDATE.AIM_POST_FIRE_RESCUE_ACTIVE] :
    experiment === "AIM_SETUP_POST_FIRE_ALL_ACTIVE" ?
      [CANDIDATE.AIM_POST_FIRE_CLOSURE_SHADOW,
        CANDIDATE.AIM_POST_FIRE_ALL_ACTIVE] :
    experiment === "AIM_SETUP_POST_FIRE_LONG_RANGE_ACTIVE" ?
      [CANDIDATE.AIM_POST_FIRE_CLOSURE_SHADOW,
        CANDIDATE.AIM_POST_FIRE_LONG_RANGE_ACTIVE] :
    experiment === "AIM_SETUP_POST_FIRE_LONG_RANGE_FAST_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.AIM_POST_FIRE_LONG_RANGE_FAST_ACTIVE] :
    experiment === "DIRECT_CLEAR_SAFE_FIRE_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.DIRECT_CLEAR_SAFE_FIRE_ACTIVE] :
    experiment === "VISIBLE_RAY_ALIGNMENT_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.VISIBLE_RAY_ALIGNMENT_ACTIVE] :
    experiment === "V1_DIRECT_INITIATIVE_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.V1_DIRECT_INITIATIVE_ACTIVE] :
    experiment === "V1_DIRECT_ENTRY_OWNERSHIP_CENSUS" ?
      [CANDIDATE.V1_DIRECT_ENTRY_OWNERSHIP_CENSUS] :
    experiment === "V1_DIRECT_STAGE_ORACLE_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.V1_DIRECT_STAGE_ORACLE_ACTIVE] :
    experiment === "V1_TACTICAL_STAGE_ORACLE_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.V1_TACTICAL_STAGE_ORACLE_ACTIVE] :
    experiment === "V1_TACTICAL_STAGE_RISK_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.V1_TACTICAL_STAGE_RISK_ACTIVE] :
    experiment === "NATIVE_TACTICAL_MAXIMIN_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_MAXIMIN_ACTIVE] :
    experiment === "NATIVE_TACTICAL_COMBAT_MAXIMIN_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_COMBAT_MAXIMIN_ACTIVE] :
    experiment === "NATIVE_TACTICAL_COMPACT_MAXIMIN_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_COMPACT_MAXIMIN_ACTIVE] :
    experiment === "NATIVE_TACTICAL_DOMAIN_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_DOMAIN_ACTIVE] :
    experiment === "NATIVE_TACTICAL_LEAF_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_LEAF_ACTIVE] :
    experiment === "NATIVE_TACTICAL_DOMAIN_LEAF_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_DOMAIN_LEAF_ACTIVE] :
    experiment === "NATIVE_TACTICAL_REPRESENTATIVE_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_REPRESENTATIVE_ACTIVE] :
    experiment === "NATIVE_TACTICAL_LEAF_REPRESENTATIVE_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_ACTIVE] :
    experiment === "NATIVE_TACTICAL_LEAF_REPRESENTATIVE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_HISTORY_ACTIVE] :
    experiment === "NATIVE_TACTICAL_DEEP_LEAF_REPRESENTATIVE_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_DEEP_LEAF_REPRESENTATIVE_ACTIVE] :
    experiment === "NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_ACTIVE] :
    experiment === "NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE] :
    experiment === "NATIVE_TACTICAL_RESPONSE_DOMAIN_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMAIN_RESOURCE_HISTORY_ACTIVE] :
    experiment === "NATIVE_TACTICAL_RESPONSE_DOMINANCE_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_RESPONSE_DOMINANCE_RESOURCE_HISTORY_ACTIVE] :
    experiment === "NATIVE_TACTICAL_RACE_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_RACE_LEAF_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE] :
    experiment === "NATIVE_TACTICAL_ROBUST_BACKUP_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_ROBUST_BACKUP_RESOURCE_HISTORY_ACTIVE] :
    experiment === "NATIVE_TACTICAL_OWN_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_OWN_REPRESENTATIVE_RESOURCE_HISTORY_ACTIVE] :
    experiment === "NATIVE_TACTICAL_INTENT_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_TACTICAL_INTENT_RESOURCE_HISTORY_ACTIVE] :
    experiment === "NATIVE_POLICY_PRIOR_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_POLICY_PRIOR_ACTIVE] :
    experiment === "NATIVE_BASE_POLICY_DIFFERENTIAL_ORACLE_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_BASE_POLICY_DIFFERENTIAL_ORACLE_ACTIVE] :
    experiment === "NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE] :
    experiment === "NATIVE_ATTACK_POSE_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_ATTACK_POSE_RESOURCE_HISTORY_ACTIVE] :
    experiment === "NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_ATTACK_POSE_ROUTE_RESOURCE_HISTORY_ACTIVE] :
    experiment === "NATIVE_ATTACK_POSE_FULL_COVERAGE_ROUTE_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_ATTACK_POSE_FULL_COVERAGE_ROUTE_RESOURCE_HISTORY_ACTIVE] :
    experiment === "NATIVE_ATTACK_POSE_RESPONSE_CONDITIONED_ROUTE_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_CONDITIONED_ROUTE_RESOURCE_HISTORY_ACTIVE] :
    experiment === "NATIVE_ATTACK_POSE_RESPONSE_DERIVED_ROUTE_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_ATTACK_POSE_RESPONSE_DERIVED_ROUTE_RESOURCE_HISTORY_ACTIVE] :
    experiment === "NATIVE_ATTACK_POSE_OPTION_FIRST_ROUTE_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_ATTACK_POSE_OPTION_FIRST_ROUTE_RESOURCE_HISTORY_ACTIVE] :
    experiment === "NATIVE_ATTACK_POSE_PERSISTENT_ROUTE_RESOURCE_HISTORY_ACTIVE" ?
      [CANDIDATE.SHOT_QUALITY_CENSUS_SHADOW,
        CANDIDATE.NATIVE_ATTACK_POSE_PERSISTENT_ROUTE_RESOURCE_HISTORY_ACTIVE] :
    experiment === "PERSISTENT_ATTACK_TARGET_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.PERSISTENT_ATTACK_TARGET_SHADOW] :
    experiment === "PERSISTENT_ATTACK_TARGET_ACTIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.PERSISTENT_ATTACK_TARGET_ACTIVE] :
    experiment === "PERSISTENT_TARGET_OPTION_SEARCH_SHADOW" ?
      [CANDIDATE.PERSISTENT_ATTACK_TARGET_ACTIVE,
        CANDIDATE.PERSISTENT_TARGET_OPTION_SEARCH_SHADOW] :
    experiment === "PERSISTENT_TARGET_OPTION_SEARCH_ACTIVE" ?
      [CANDIDATE.PERSISTENT_ATTACK_TARGET_ACTIVE,
        CANDIDATE.PERSISTENT_TARGET_OPTION_SEARCH_ACTIVE] :
    experiment === "STABLE_OPTION_INTERVAL_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.STABLE_OPTION_INTERVAL_SHADOW] :
    experiment === "ATTACK_CONTINUATION_PROGRESS_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.ATTACK_CONTINUATION_PROGRESS_SHADOW] :
    experiment === "ATTACK_SEQUENCE_GENERATOR_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.ATTACK_SEQUENCE_GENERATOR_SHADOW] :
    experiment === "ATTACK_POLICY_REACHABILITY_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.ATTACK_POLICY_REACHABILITY_SHADOW] :
    experiment === "ATTACK_RESPONSE_SET_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.ATTACK_RESPONSE_SET_SHADOW] :
    experiment === "COMBAT_UTILITY_ENVELOPE_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.COMBAT_UTILITY_ENVELOPE_SHADOW] :
    experiment === "ATTACK_STAR_POLICY_FRONTIER_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.ATTACK_STAR_POLICY_FRONTIER_SHADOW] :
    experiment === "RESPONSE_CONDITIONED_OPTION_POLICY_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.RESPONSE_CONDITIONED_OPTION_POLICY_SHADOW] :
    experiment === "RISK_CONDITIONED_COMBAT_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.RISK_CONDITIONED_COMBAT_SHADOW] :
    experiment === "RISK_CONDITIONED_COMBAT_ACTIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.RISK_CONDITIONED_COMBAT_ACTIVE] :
    experiment === "RISK_CONDITIONED_RESPONSE_POLICY_ACTIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.RISK_CONDITIONED_RESPONSE_POLICY_ACTIVE] :
    experiment === "QUALIFIED_ATTACK_OVER_STAR_SHADOW" ?
      [CANDIDATE.CURRENT, CANDIDATE.QUALIFIED_ATTACK_OVER_STAR_SHADOW] :
    experiment === "QUALIFIED_ATTACK_OVER_STAR_ACTIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.QUALIFIED_ATTACK_OVER_STAR_ACTIVE] :
    experiment === "NAVIGATION_ONLY" ?
      [CANDIDATE.CURRENT, CANDIDATE.NAVIGATION_ONLY] :
    experiment === "OBJECTIVE_ATTACK" ?
      [CANDIDATE.CURRENT, CANDIDATE.OBJECTIVE_ATTACK] :
    experiment === "OBJECTIVE_STAR" ?
      [CANDIDATE.CURRENT, CANDIDATE.OBJECTIVE_STAR] :
    experiment === "TACTICAL_PREDICTIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.TACTICAL_PREDICTIVE] :
    experiment === "TACTICAL_BOMB" ?
      [CANDIDATE.CURRENT, CANDIDATE.TACTICAL_BOMB] :
    experiment === "TACTICAL_EXPANDED" ?
      [CANDIDATE.CURRENT, CANDIDATE.TACTICAL_EXPANDED] :
    experiment === "CONTACT_CENSUS" ?
      [CANDIDATE.CURRENT, CANDIDATE.CONTACT_CENSUS] :
    experiment === "CONTACT_SUPPORT_CENSUS" ?
      [CANDIDATE.CONTACT_CENSUS] :
    experiment === "REFUTED_POSSIBLE_PHYSICAL" ?
      [CANDIDATE.CURRENT, CANDIDATE.REFUTED_POSSIBLE_PHYSICAL] :
    experiment === "REFUTED_POSSIBLE_PHYSICAL_COMBAT" ?
      [CANDIDATE.CURRENT, CANDIDATE.REFUTED_POSSIBLE_PHYSICAL_COMBAT] :
    experiment === "REFUTED_POSSIBLE_FIRE_VERIFIER" ?
      [CANDIDATE.CURRENT, CANDIDATE.REFUTED_POSSIBLE_FIRE_VERIFIER] :
    experiment === "INFORMATION_VALUE" ?
      [CANDIDATE.CURRENT, CANDIDATE.INFORMATION_VALUE] :
    experiment === "NOMINAL_PHYSICAL" ?
      [CANDIDATE.CURRENT, CANDIDATE.NOMINAL_PHYSICAL] :
    experiment === "NOMINAL_COMBAT" ?
      [CANDIDATE.CURRENT, CANDIDATE.NOMINAL_COMBAT] :
    experiment === "NOMINAL_EVIDENCE" ?
      [CANDIDATE.CURRENT, CANDIDATE.NOMINAL_EVIDENCE] :
    experiment === "OPTION_AWARE_SINGLE" ?
      [CANDIDATE.CURRENT, CANDIDATE.OPTION_AWARE_SINGLE_SEARCH] :
    experiment === "OPTION_AWARE_TYPED_SINGLE" ?
      [CANDIDATE.CURRENT, CANDIDATE.OPTION_AWARE_TYPED_SINGLE] :
    experiment === "OPEN_PORTFOLIO_NO_PRIMITIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.OPEN_PORTFOLIO_NO_PRIMITIVE] :
    experiment === "OPTION_AWARE_TYPED_OPEN" ?
      [CANDIDATE.CURRENT, CANDIDATE.OPTION_AWARE_TYPED_OPEN] :
    experiment === "QUALIFIED_OPEN_NO_PRIMITIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.QUALIFIED_OPEN_NO_PRIMITIVE] :
    experiment === "OPTION_AWARE_TYPED_QUALIFIED_OPEN" ?
      [CANDIDATE.CURRENT, CANDIDATE.OPTION_AWARE_TYPED_QUALIFIED_OPEN] :
    experiment === "CONTACT_QUALIFIED_NO_PRIMITIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.CONTACT_QUALIFIED_NO_PRIMITIVE] :
    experiment === "OPTION_AWARE_TYPED_CONTACT_QUALIFIED" ?
      [CANDIDATE.CURRENT, CANDIDATE.OPTION_AWARE_TYPED_CONTACT_QUALIFIED] :
    experiment === "PATH_CONTACT_NO_PRIMITIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.PATH_CONTACT_NO_PRIMITIVE] :
    experiment === "PATH_CONTACT_OPTION" ?
      [CANDIDATE.CURRENT, CANDIDATE.PATH_CONTACT_OPTION] :
    experiment === "PATH_VERIFIED_CONTACT_NO_PRIMITIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.PATH_VERIFIED_CONTACT_NO_PRIMITIVE] :
    experiment === "PATH_VERIFIED_CONTACT_OPTION" ?
      [CANDIDATE.CURRENT, CANDIDATE.PATH_VERIFIED_CONTACT_OPTION] :
    experiment === "INFORMATION_OPTION_INTERVAL_SHADOW" ?
      [CANDIDATE.CONTACT_QUALIFIED_NO_PRIMITIVE,
        CANDIDATE.INFORMATION_OPTION_INTERVAL_SHADOW] :
    experiment === "INFORMATION_OPTION_INTERVAL_ACTIVE" ?
      [CANDIDATE.CONTACT_QUALIFIED_NO_PRIMITIVE,
        CANDIDATE.INFORMATION_OPTION_INTERVAL_ACTIVE] :
    experiment === "INFORMATION_OPTION_TWO_STAGE_SHADOW" ?
      [CANDIDATE.INFORMATION_OPTION_INTERVAL_SHADOW,
        CANDIDATE.INFORMATION_OPTION_TWO_STAGE_SHADOW] :
    experiment === "INFORMATION_OPTION_TWO_STAGE_ACTIVE" ?
      [CANDIDATE.INFORMATION_OPTION_INTERVAL_ACTIVE,
        CANDIDATE.INFORMATION_OPTION_TWO_STAGE_ACTIVE] :
    experiment === "INFORMATION_OPTION_POSSIBLE_PROJECTILE_SHADOW" ?
      [CANDIDATE.INFORMATION_OPTION_TWO_STAGE_SHADOW,
        CANDIDATE.INFORMATION_OPTION_POSSIBLE_PROJECTILE_SHADOW] :
    experiment === "INFORMATION_OPTION_LEGACY_SETUP_ACTIVE" ?
      [CANDIDATE.CONTACT_QUALIFIED_NO_PRIMITIVE,
        CANDIDATE.INFORMATION_OPTION_LEGACY_SETUP_ACTIVE] :
    experiment === "NO_PRIMITIVE_SEARCH" ?
      [CANDIDATE.CURRENT, CANDIDATE.NO_PRIMITIVE_SEARCH] :
    experiment === "INITIATIVE" ?
      [CANDIDATE.CURRENT, CANDIDATE.INITIATIVE] :
      (() => { throw new Error(`V2_NATIVE_EXPERIMENT_INVALID:${experiment}`); })();
  const loaded = loadCohort(root, cohortFile, role);
  const offset = Math.max(0, Number(option("--offset", 0)) | 0);
  const limit = positiveIntegerOption("--limit", loaded.scenarios.length);
  if (offset || limit < loaded.scenarios.length)
    loaded.scenarios = loaded.scenarios.slice(offset, offset + limit);
  const requestedIds = option("--scenario-id", "").split(",").filter(Boolean);
  if (requestedIds.length) {
    const wanted = new Set(requestedIds);
    loaded.scenarios = loaded.scenarios.filter(scenario => wanted.has(scenario.matchUrlId));
    if (loaded.scenarios.length !== wanted.size)
      throw new Error(`V2_NATIVE_SCENARIO_FILTER_MISSING:${
        requestedIds.filter(id => !loaded.scenarios.some(item => item.matchUrlId === id)).join(",")}`);
  }
  const captureAllFrames = option("--trace-all", "false") === "true";
  const source = {
    productionRootSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "runtime", "production-root.js"))),
    escapeObligationSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "runtime", "escape-obligation.js"))),
    forcedWinSearchSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "search", "production-forced-win-search.js"))),
    depthSearchSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "search", "production-depth-search.js"))),
    contenderFrontierSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "search", "contender-frontier.js"))),
    responseOptionSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "policy", "response-option-controller.js"))),
    optionAwareDepthSearchSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "search", "option-aware-depth-search.js"))),
    optionInformationIntervalSearchSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "search", "option-information-interval-search.js"))),
    attackSetupClosureSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "search", "attack-setup-closure.js"))),
    twoStageAttackSetupSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "search", "two-stage-attack-setup-shadow.js"))),
    possibleProjectileAttackSetupSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "search", "possible-projectile-attack-setup-closure.js"))),
    nominalPhysicalEvidenceSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "policy", "nominal-physical-evidence-arbiter.js"))),
    actionContinuationEnvelopeSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "search", "action-continuation-envelope.js"))),
    commonPolicyOptionIntervalSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "search", "common-policy-option-interval.js"))),
    verifiedAttackProposalSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "verified-attack-proposal.js"))),
    attackObjectiveFieldSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "attack-objective-field.js"))),
    eventDrivenOptionShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "event-driven-option-shadow.js"))),
    stableOptionLedgerShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "stable-option-ledger-shadow.js"))),
    strategicStateLedgerShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "strategic-state-ledger-shadow.js"))),
    objectiveEpochContinuityShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "objective-epoch-continuity-shadow.js"))),
    objectiveEpochExecutionShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "objective-epoch-execution-shadow.js"))),
    objectiveEpochActivePocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "objective-epoch-active-poc.js"))),
    objectiveEpochOptionArbiterShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "objective-epoch-option-arbiter-shadow.js"))),
    semanticObjectiveEpochShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "semantic-objective-epoch-shadow.js"))),
    semanticObjectiveEpochOptionActivePocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "semantic-objective-epoch-option-active-poc.js"))),
    semanticAttackOptionCoverageShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "semantic-attack-option-coverage-shadow.js"))),
    semanticAttackExecutionIntervalShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "semantic-attack-execution-interval-shadow.js"))),
    semanticAttackPolicyIntervalShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "semantic-attack-policy-interval-shadow.js"))),
    semanticAttackObjectiveProgressIntervalSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "semantic-attack-objective-progress-interval.js"))),
    semanticAttackPolicyIntervalActivePocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "semantic-attack-policy-interval-active-poc.js"))),
    strategicConflictArbiterShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "strategic-conflict-arbiter-shadow.js"))),
    strategicTargetExecutionShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "strategic-target-execution-shadow.js"))),
    strategicAttackOverStarProposalSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "strategic-attack-over-star-proposal.js"))),
    persistentAttackTargetControllerSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "persistent-attack-target-controller.js"))),
    optionScopedTargetContinuationSearchSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "option-scoped-target-continuation-search.js"))),
    stableOptionIntervalShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "stable-option-interval-shadow.js"))),
    attackContinuationProgressShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "attack-continuation-progress-shadow.js"))),
    attackSequenceGeneratorShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "attack-sequence-generator-shadow.js"))),
    attackPolicyReachabilityShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "attack-policy-reachability-shadow.js"))),
    attackResponseSetShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "attack-response-set-shadow.js"))),
    combatUtilityEnvelopeShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "combat-utility-envelope-shadow.js"))),
    attackStarPolicyFrontierShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "attack-star-policy-frontier-shadow.js"))),
    responseConditionedOptionPolicyShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "response-conditioned-option-policy-shadow.js"))),
    statefulOptionRolloutSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "stateful-option-rollout.js"))),
    moveContestVariantKernelSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "move-contest-variant-kernel.js"))),
    semanticAttackDepth3MoveVariantSha256: sha256Bytes(fs.readFileSync(path.join(
      root, "tools", "agentank", "diagnostics",
      "semantic-attack-depth3-move-variant-shadow.js"))),
    semanticAttackDepth3LeafBackupSha256: sha256Bytes(fs.readFileSync(path.join(
      root, "tools", "agentank", "diagnostics",
      "semantic-attack-depth3-leaf-backup-shadow.js"))),
    semanticAttackDepth3ResponseMatrixSha256: sha256Bytes(fs.readFileSync(path.join(
      root, "tools", "agentank", "diagnostics",
      "semantic-attack-depth3-response-matrix-shadow.js"))),
    semanticAttackResponseConditionedSha256: sha256Bytes(fs.readFileSync(path.join(
      root, "tools", "agentank", "diagnostics",
      "semantic-attack-response-conditioned-shadow.js"))),
    semanticAttackEventDeadlineSha256: sha256Bytes(fs.readFileSync(path.join(
      root, "tools", "agentank", "diagnostics",
      "semantic-attack-event-deadline-shadow.js"))),
    semanticAttackEventHorizonSha256: sha256Bytes(fs.readFileSync(path.join(
      root, "tools", "agentank", "diagnostics",
      "semantic-attack-event-horizon-shadow.js"))),
    shotQualityCounterExposureCensusSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "shot-quality-counterexposure-census.js"))),
    aimSetupPostFireClosureShadowSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "aim-setup-post-fire-closure-shadow.js"))),
    directClearSafeFirePocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "direct-clear-safe-fire-poc.js"))),
    visibleRayAlignmentPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "visible-ray-alignment-poc.js"))),
    v1DirectInitiativeTransplantPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "v1-direct-initiative-transplant-poc.js"))),
    v1StageOracleTransplantPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "v1-stage-oracle-transplant-poc.js"))),
    nativeTacticalActionOwnerPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "native-tactical-action-owner-poc.js"))),
    nativeOwnSkillActionBridgePocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "native-own-skill-action-bridge-poc.js"))),
    nativeSelectivePoisonPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "native-selective-poison-poc.js"))),
    nativeTerminalTradeAuditSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "native-terminal-trade-audit.js"))),
    nativeCandidateForcedWinPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "native-candidate-forced-win-poc.js"))),
    nativeSyntheticResourceRootPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-synthetic-resource-root-poc.js"))),
    nativePoisonResourceOptionPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-poison-resource-option-poc.js"))),
    nativePoisonAttackEventOptionPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-poison-attack-event-option-poc.js"))),
    nativePolicyResponseEnvelopePocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-policy-response-envelope-poc.js"))),
    nativeLongOptionEventEnvelopePocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-long-option-event-envelope-poc.js"))),
    nativeLongOptionResponseMassPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-long-option-response-mass-poc.js"))),
    nativeEnemyResponsePortfolioPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-enemy-response-portfolio-poc.js"))),
    nativeSelectiveResponseVerifierPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-selective-response-verifier-poc.js"))),
    nativeHostContinuationStunVerifierPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-host-continuation-stun-verifier-poc.js"))),
    nativeDualPolicyResponseMassPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-dual-policy-response-mass-poc.js"))),
    nativeDualPolicyContinuationPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-dual-policy-continuation-poc.js"))),
    attackEventPolicySearchSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "engine-v2", "src", "search", "attack-event-policy-search.js"))),
    nativePolicyPriorOwnerPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "native-policy-prior-owner-poc.js"))),
    nativeBasePolicyDifferentialPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-base-policy-differential-poc.js"))),
    nativeBoundedPolicySearchPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-bounded-policy-search-poc.js"))),
    nativeV1PolicyLeafEvaluatorPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "native-v1-policy-leaf-evaluator-poc.js"))),
    nativeV1PathUtilityPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "native-v1-path-utility-poc.js"))),
    nativeTacticalDomainEvaluatorPocSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "native-tactical-domain-evaluator-poc.js"))),
    riskConditionedCombatProposalSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics",
      "risk-conditioned-combat-proposal.js"))),
    qualifiedAttackOverStarSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tools", "agentank", "diagnostics", "qualified-attack-over-star.js"))),
    cohortSha256: sha256Bytes(fs.readFileSync(cohortFile))
  };
  const simulator = await loadSimulator(root);
  const matches = [];
  const started = Date.now();
  for (let index = 0; index < loaded.scenarios.length; index += 1) {
    const scenario = loaded.scenarios[index];
    for (const kind of kinds)
      for (let seat = 0; seat < 2; seat += 1)
        matches.push(await play(simulator.module, scenario, seat, kind, captureAllFrames));
    if ((index + 1) % 8 === 0 || index + 1 === loaded.scenarios.length)
      process.stderr.write(`[v2-native-${experiment.toLowerCase()}] ${index + 1}/${
        loaded.scenarios.length}\n`);
  }
  const baseline = summarize(matches, kinds[0]);
  const candidate = kinds.length > 1 ? summarize(matches, kinds[1]) : null;
  const overview = {
    objectKind: "V2_NATIVE_OWNERSHIP_DISCOVERY_V1",
    experiment,
    skillMode,
    role,
    source,
    cohortFingerprint: loaded.manifest.fingerprint,
    scenarios: loaded.scenarios.length,
    physicalMatches: matches.length,
    elapsedMs: Date.now() - started,
    baseline,
    candidate,
    comparison: candidate ? compare(baseline, candidate) : null
  };
  const diagnosticSamples = [];
  const baselineOutcomeByMatch = new Map();
  const priorityRiskSamples = []; const otherRiskSamples = [];
  for (const match of matches) if (match.implementation === kinds[0])
    baselineOutcomeByMatch.set(`${match.matchUrlId}:${match.candidateSeat}`,
      match.analysisOutcome);
  for (const match of matches) {
    const roots = match.candidateEngine?.optionProposalRoots;
    if (Array.isArray(roots)) {
      for (const root of roots) diagnosticSamples.push({
        matchUrlId: match.matchUrlId,
        scenarioFingerprint: match.scenarioFingerprint,
        candidateSeat: match.candidateSeat,
        implementation: match.implementation,
        analysisOutcome: match.analysisOutcome,
        terminalCategory: match.terminalCategory,
        ...root
      });
      delete match.candidateEngine.optionProposalRoots;
    }
    const setupRoots = match.candidateEngine?.twoStageSetupRoots;
    if (Array.isArray(setupRoots)) for (const root of setupRoots) diagnosticSamples.push({
      sampleKind: "TWO_STAGE_ATTACK_SETUP_ROOT",
      matchUrlId: match.matchUrlId,
      scenarioFingerprint: match.scenarioFingerprint,
      candidateSeat: match.candidateSeat,
      implementation: match.implementation,
      analysisOutcome: match.analysisOutcome,
      terminalCategory: match.terminalCategory,
      ...root
    });
    if (match.candidateEngine) delete match.candidateEngine.twoStageSetupRoots;
    const riskCombatRoots = match.candidateEngine?.riskConditionedCombatRoots;
    if (Array.isArray(riskCombatRoots)) for (const root of riskCombatRoots) {
      const sample = {
        matchUrlId: match.matchUrlId,
        scenarioFingerprint: match.scenarioFingerprint,
        candidateSeat: match.candidateSeat,
        implementation: match.implementation,
        analysisOutcome: match.analysisOutcome,
        terminalCategory: match.terminalCategory,
        ...root
      };
      const baselineOutcome = baselineOutcomeByMatch.get(
        `${match.matchUrlId}:${match.candidateSeat}`);
      if (baselineOutcome !== undefined &&
          baselineOutcome !== match.analysisOutcome)
        priorityRiskSamples.push(sample);
      else otherRiskSamples.push(sample);
    }
    if (match.candidateEngine) delete match.candidateEngine.riskConditionedCombatRoots;
    const targetExecutionRoots =
      match.candidateEngine?.strategicTargetExecutionRoots;
    if (Array.isArray(targetExecutionRoots))
      for (const root of targetExecutionRoots)
        if (diagnosticSamples.length < 32) diagnosticSamples.push({
          matchUrlId: match.matchUrlId,
          scenarioFingerprint: match.scenarioFingerprint,
          candidateSeat: match.candidateSeat,
          implementation: match.implementation,
          analysisOutcome: match.analysisOutcome,
          terminalCategory: match.terminalCategory,
          ...root
        });
    if (match.candidateEngine)
      delete match.candidateEngine.strategicTargetExecutionRoots;
    const census = match.candidateEngine?.noAcceptableCensus;
    if (census && Array.isArray(census.samples)) {
      for (const sample of census.samples) if (diagnosticSamples.length < 32)
        diagnosticSamples.push({ sampleKind: "NO_ACCEPTABLE_ROOT",
          matchUrlId: match.matchUrlId,
          scenarioFingerprint: match.scenarioFingerprint,
          candidateSeat: match.candidateSeat,
          implementation: match.implementation,
          analysisOutcome: match.analysisOutcome,
          terminalCategory: match.terminalCategory,
          ...sample });
      delete census.samples;
    }
  }
  for (const samples of [priorityRiskSamples, otherRiskSamples])
    for (const sample of samples)
      if (diagnosticSamples.length < 32) diagnosticSamples.push(sample);
  const output = path.resolve(option("--output", path.join(root, "artifacts",
    "v2-native-initiative", `${experiment.toLowerCase()}-${role.toLowerCase()}-${
      loaded.manifest.fingerprint.slice(0, 12)}-${
      sha256Text(JSON.stringify(overview.comparison || overview.baseline.noAcceptableCensus)).slice(0, 12)}`)));
  fs.mkdirSync(output, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    objectKind: "V2_NATIVE_INITIATIVE_ARENA_MANIFEST_V1",
    cohortFingerprint: loaded.manifest.fingerprint,
    role,
    skillMode,
    scenarioCount: loaded.scenarios.length,
    matchCount: matches.length,
    candidateImplementations: kinds,
    // Preserve the exact diagnostic invocation. Earlier evidence retained the
    // code/cohort hashes but not the option vector, which made an otherwise
    // deterministic POC unnecessarily hard to reproduce.
    arguments: process.argv.slice(2),
    source,
    fingerprint: ""
  };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.writeFileSync(path.join(output, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "overview.json"),
    `${JSON.stringify(overview, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "matches.ndjson.gz"), zlib.gzipSync(Buffer.from(
    `${matches.map(match => JSON.stringify(match)).join("\n")}\n`), { level: 9 }));
  fs.writeFileSync(path.join(output, "diagnostic-samples.ndjson.gz"),
    zlib.gzipSync(Buffer.from(diagnosticSamples.length ?
      `${diagnosticSamples.map(sample => JSON.stringify(sample)).join("\n")}\n` : ""),
    { level: 9 }));
  process.stdout.write(`${JSON.stringify({ output, overview }, null, 2)}\n`);
  return { output, overview };
}

if (require.main === module)
  run().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });

module.exports = { CANDIDATE, engineOptions, loadCohort, field,
  collectProjectileFunnel, play, summarize, compare, run };
