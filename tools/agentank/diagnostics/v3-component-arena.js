#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { loadFrozenCandidate } = require("../candidate/imp8-g10a");
const { createHistoricalStarProvider } = require("../simulation/historical-scenarios");
const { DecisionAudit, loadSimulator, collectCounts } = require("../simulation/paired-arena");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");
const { V3DiagnosticBot, V3_COMPONENT_MODE, OWNERSHIP_STAGE_NAMES, actionToLegacy } =
  require("../../../engine-v3/src");
const { COMBAT_PURPOSE, PLAN_PURPOSE } =
  require("../../../engine-v2/src/abi/policy-codes");
const { buildCohortManifest, validateManifest, loadCohort } =
  require("./v3-component-cohort");
const repairCohort = require("./v3-repair-cohort");
const { seedFor } = require("./v1-v3-arena");

const MODES = Object.freeze({
  BASE_V3: Object.freeze({}),
  V1_OWNERSHIP_SHADOW: Object.freeze({ enableOwnershipTrace: true }),
  NATIVE_CONTROL_SHADOW: Object.freeze({ enableV2Bridge: true,
    enableOwnershipTrace: true, enableNativeControlShadow: true }),
  COMMITTED_RESCUE_SHADOW: Object.freeze({ enableV2Bridge: true,
    enableOwnershipTrace: true, enableNativeControlShadow: true,
    finalCommittedRescueShadow: true }),
  COMMITTED_RESCUE_ACTIVE: Object.freeze({ enableV2Bridge: true,
    enableOwnershipTrace: true, enableNativeControlShadow: true,
    finalCommittedRescueActive: true }),
  BEST_COMMITTED_RESCUE: Object.freeze({ enableV2Bridge: true,
    enableOwnershipTrace: true, enableNativeControlShadow: true,
    finalCommittedRescueActive: true }),
  BEST_ACCEPTED_COMPONENTS: Object.freeze({ enableV2Bridge: true,
    enableOwnershipTrace: true, enableNativeControlShadow: true,
    finalCommittedRescueActive: true }),
  VERIFIED_ATTACK_SHADOW: Object.freeze({ enableV2Bridge: true,
    enableOwnershipTrace: true, enableNativeControlShadow: true,
    verifiedAttackMode: V3_COMPONENT_MODE.SHADOW }),
  VERIFIED_ATTACK_ACTIVE: Object.freeze({ enableV2Bridge: true,
    enableOwnershipTrace: true, enableNativeControlShadow: true,
    verifiedAttackMode: V3_COMPONENT_MODE.ACTIVE }),
  VERIFIED_DIRECT_KILL_SHADOW: Object.freeze({ enableV2Bridge: true,
    enableOwnershipTrace: true, enableNativeControlShadow: true,
    verifiedAttackMode: V3_COMPONENT_MODE.SHADOW,
    verifiedAttackOptions: { requireDirectKill: true } }),
  VERIFIED_DIRECT_KILL_ACTIVE: Object.freeze({ enableV2Bridge: true,
    enableOwnershipTrace: true, enableNativeControlShadow: true,
    verifiedAttackMode: V3_COMPONENT_MODE.ACTIVE,
    verifiedAttackOptions: { requireDirectKill: true } }),
  PREEMPTIVE_SAFETY_SHADOW: Object.freeze({ enableV2Bridge: true,
    enableOwnershipTrace: true, enableNativeControlShadow: true,
    finalCommittedRescueActive: true,
    preemptiveSafetyMode: V3_COMPONENT_MODE.SHADOW }),
  STABILITY_SHADOW: Object.freeze({ enableV2Bridge: true,
    enableOwnershipTrace: true, enableNativeControlShadow: true,
    stabilityShadowMode: V3_COMPONENT_MODE.SHADOW }),
  STABILITY_ACTIVE: Object.freeze({ enableV2Bridge: true,
    enableOwnershipTrace: true, enableNativeControlShadow: true,
    stabilityMode: V3_COMPONENT_MODE.ACTIVE }),
  STABILITY_ZERO_RISK_ACTIVE: Object.freeze({ enableV2Bridge: true,
    enableOwnershipTrace: true, enableNativeControlShadow: true,
    stabilityMode: V3_COMPONENT_MODE.ACTIVE,
    stabilityOptions: { requireZeroRisk: true } }),
  VC1_SHADOW: Object.freeze({ enableV2Bridge: true }),
  CONTACT_SHADOW: Object.freeze({ enableV2Bridge: true,
    rootContactMode: V3_COMPONENT_MODE.SHADOW }),
  CONTACT_ACTIVE: Object.freeze({ enableV2Bridge: true,
    rootContactMode: V3_COMPONENT_MODE.ACTIVE }),
  VC2_HARD_SHADOW: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.SHADOW }),
  VC2_HARD_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE }),
  BEST_VC1_VC2: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE }),
  VC3_ESCAPE_SHADOW: Object.freeze({ enableV2Bridge: true,
    committedEscapeMode: V3_COMPONENT_MODE.SHADOW }),
  VC3_ESCAPE_ACTIVE: Object.freeze({ enableV2Bridge: true,
    committedEscapeMode: V3_COMPONENT_MODE.ACTIVE }),
  VC4_FORCED_WIN_SHADOW: Object.freeze({ enableV2Bridge: true,
    forcedWinMode: V3_COMPONENT_MODE.SHADOW }),
  VC4_FORCED_WIN_ACTIVE: Object.freeze({ enableV2Bridge: true,
    forcedWinMode: V3_COMPONENT_MODE.ACTIVE }),
  VC5_COMBAT_SHADOW: Object.freeze({ enableV2Bridge: true,
    combatAttackMode: V3_COMPONENT_MODE.SHADOW }),
  VC5_COMBAT_ACTIVE: Object.freeze({ enableV2Bridge: true,
    combatAttackMode: V3_COMPONENT_MODE.ACTIVE }),
  CTR4_DIRECT_KILL: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    combatAttackMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { combatPurposeMask: COMBAT_PURPOSE.DIRECT_KILL,
      combatPrimaryPurpose: PLAN_PURPOSE.DIRECT_KILL } }),
  CTR4_AIM_SETUP: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    combatAttackMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { combatPurposeMask: COMBAT_PURPOSE.AIM_SETUP,
      combatPrimaryPurpose: PLAN_PURPOSE.INTERCEPT } }),
  CTR4_INTERCEPT: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    combatAttackMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { combatPurposeMask: COMBAT_PURPOSE.INTERCEPT,
      combatPrimaryPurpose: PLAN_PURPOSE.INTERCEPT } }),
  CTR4_ESCAPE_DENIAL: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    combatAttackMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { combatPurposeMask: COMBAT_PURPOSE.ESCAPE_DENIAL,
      combatPrimaryPurpose: PLAN_PURPOSE.ESCAPE_FORCING } }),
  CTR4_SHIELD_BREAK: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    combatAttackMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { combatPurposeMask: COMBAT_PURPOSE.SHIELD_BREAK,
      combatPrimaryPurpose: PLAN_PURPOSE.SHIELD_BREAK } }),
  CTR4_ZONE_DENIAL: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    combatAttackMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { combatPurposeMask: COMBAT_PURPOSE.ZONE_DENIAL,
      combatPrimaryPurpose: PLAN_PURPOSE.ZONE_DENIAL } }),
  CTR4_PAC: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    combatAttackMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { combatPurposeMask: COMBAT_PURPOSE.ESCAPE_DENIAL,
      combatPrimaryPurpose: PLAN_PURPOSE.ESCAPE_FORCING } }),
  CTR4_SURVIVOR_FRONTIER: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    combatAttackMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { combatPurposeMask: COMBAT_PURPOSE.ESCAPE_DENIAL,
      combatPrimaryPurpose: PLAN_PURPOSE.ESCAPE_FORCING,
      combatRequireFrontier: true } }),
  TC_FULL: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { allowCompletionOwnership: true } }),
  NATIVE_BP_TACTICAL_SHADOW: Object.freeze({ enableV2Bridge: true,
    nativeBasePolicyTacticalMode: V3_COMPONENT_MODE.SHADOW }),
  NATIVE_BP_TACTICAL_ACTIVE: Object.freeze({ enableV2Bridge: true,
    nativeBasePolicyTacticalMode: V3_COMPONENT_MODE.ACTIVE }),
  NATIVE_BP_TACTICAL_INITIATIVE_ACTIVE: Object.freeze({ enableV2Bridge: true,
    nativeBasePolicyTacticalMode: V3_COMPONENT_MODE.ACTIVE,
    nativeBasePolicyTacticalOptions: { preserveV1Initiative: true } }),
  NATIVE_BP_TACTICAL_MONOTONIC_ACTIVE: Object.freeze({ enableV2Bridge: true,
    nativeBasePolicyTacticalMode: V3_COMPONENT_MODE.ACTIVE,
    nativeBasePolicyTacticalOptions: { preserveV1Initiative: true,
      preserveV1TurnAgainstGo: true } }),
  TC_MINUS_PHYSICAL: Object.freeze({ enableV2Bridge: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { engineOptions: { diagnosticDisablePhysicalSearch: true } } }),
  TC_MINUS_INFORMATION: Object.freeze({ enableV2Bridge: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { engineOptions: { diagnosticDisableInformationSearch: true } } }),
  TC_MINUS_RISK: Object.freeze({ enableV2Bridge: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { engineOptions: { diagnosticDisableRiskController: true } } }),
  TC_MINUS_STAGE_MATRIX: Object.freeze({ enableV2Bridge: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { engineOptions: { diagnosticDisableStageMatrix: true } } }),
  TC_MINUS_INFORMATION_SAFETY: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { allowCompletionOwnership: true },
    bridgeOptions: { engineOptions: { diagnosticDisableInformationSafety: true } } }),
  TC_MINUS_HIDDEN_PROJECTILE: Object.freeze({ enableV2Bridge: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { engineOptions: { diagnosticDisableHiddenProjectileRisk: true } } }),
  VC7_STRATEGIC_ARBITER: Object.freeze({ enableV2Bridge: true,
    strategicNavigationMode: V3_COMPONENT_MODE.ACTIVE,
    strategicNavigationId: "V2_STRATEGIC_ARBITER" }),
  VC7_PLAN_SKETCH: Object.freeze({ enableV2Bridge: true,
    strategicNavigationMode: V3_COMPONENT_MODE.ACTIVE,
    strategicNavigationId: "V2_PLAN_SKETCH",
    bridgeOptions: { engineOptions: { planArbitrationEnabled: true } } }),
  VC7_PERSISTENT_PLAN: Object.freeze({ enableV2Bridge: true,
    strategicNavigationMode: V3_COMPONENT_MODE.ACTIVE,
    strategicNavigationId: "V2_PERSISTENT_PLAN", commitStrategicPlans: true,
    bridgeOptions: { engineOptions: { planArbitrationEnabled: true } } }),
  VC7_PVA: Object.freeze({ enableV2Bridge: true,
    strategicNavigationMode: V3_COMPONENT_MODE.ACTIVE,
    strategicNavigationId: "V2_PROPOSAL_VERIFICATION", commitStrategicPlans: true,
    enableProposalVerification: true,
    bridgeOptions: { engineOptions: { planArbitrationEnabled: true } } }),
  TC_NO_OPPONENT_MODEL: Object.freeze({ enableV2Bridge: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    bridgeOptions: { disableOpponentModel: true } }),
  V3R2_EXACT_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE }),
  V3R2_PHYSICAL_CELL_DOMINANCE_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-cell-dominance" } }),
  V3R2_PHYSICAL_STRICT_MAXIMIN_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance" } }),
  V3R2_PHYSICAL_STRICT_MAXIMIN_DEPTH2_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2 } }),
  V3R2_PHYSICAL_REFINED_P2_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512 } }),
  V3R2_PHYSICAL_REFINED_P2_CERTIFICATE_SHADOW: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512,
      optionPolicyCertificateShadow: true } }),
  V3R2_PHYSICAL_REFINED_P2_CERTIFICATE_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    executeOptionPolicyCertificate: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512,
      optionPolicyCertificateActive: true } }),
  V3R2_PHYSICAL_REFINED_P2_V1_LEAF_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512,
      leafEvaluator: "v1-policy" } }),
  V3R2_PHYSICAL_REFINED_P2_V1_ROOT_PRIOR_ACTIVE: Object.freeze({
    enableV2Bridge: true, hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512,
      rootPolicyPrior: "v1-action-persistent" } }),
  V3R2_PHYSICAL_REFINED_P2_V1_ROOT_SEED_ACTIVE: Object.freeze({
    enableV2Bridge: true, hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512,
      rootPolicyPrior: "v1-action-seed" } }),
  V3R2_PHYSICAL_REFINED_P2_V1_LEAF_CERTIFICATE_ACTIVE: Object.freeze({
    enableV2Bridge: true, hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    executeOptionPolicyCertificate: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512,
      leafEvaluator: "v1-policy", optionPolicyCertificateActive: true } }),
  V3R2_PHYSICAL_REFINED_P2_PLAN_COMMIT_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    commitSelectedTacticalPlans: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512 } }),
  V3R2_PHYSICAL_REFINED_P2_PLAN_HANDOFF_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    commitSelectedTacticalPlans: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512 },
    bridgeOptions: { engineOptions: { diagnosticPersistentNavigationPlans: true } } }),
  V3R2_PHYSICAL_REFINED_P2_PLAN_CONSUMER_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    commitSelectedTacticalPlans: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512 },
    strategicNavigationMode: V3_COMPONENT_MODE.ACTIVE,
    strategicNavigationId: "V2_TACTICAL_PLAN_CONTINUATION",
    commitStrategicPlans: true,
    requireTacticalHandoff: true,
    bridgeOptions: { engineOptions: { diagnosticPersistentNavigationPlans: true,
      planArbitrationEnabled: true } } }),
  V3R2_PHYSICAL_REFINED_P2_RECOVERY_OPTION_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    commitSelectedTacticalPlans: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512 },
    strategicNavigationMode: V3_COMPONENT_MODE.ACTIVE,
    strategicNavigationId: "V2_STRICT_P2_RECOVERY_OPTION",
    commitStrategicPlans: true,
    requireTacticalRecovery: true,
    bridgeOptions: { engineOptions: { diagnosticPersistentNavigationPlans: true,
      planArbitrationEnabled: true } } }),
  V3R2_PHYSICAL_REFINED_P2_IDENTITY_RECOVERY_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    commitSelectedTacticalPlans: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512 },
    strategicNavigationMode: V3_COMPONENT_MODE.ACTIVE,
    strategicNavigationId: "V2_IDENTITY_BOUND_P2_RECOVERY",
    commitStrategicPlans: true,
    requireTacticalRecovery: true,
    requireRecoveryPlanIdentity: true,
    bridgeOptions: { engineOptions: { diagnosticPersistentNavigationPlans: true,
      planArbitrationEnabled: true } } }),
  V3R2_PHYSICAL_REFINED_P2_P1_VERIFIED_RECOVERY_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE, commitSelectedTacticalPlans: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512 },
    strategicNavigationMode: V3_COMPONENT_MODE.ACTIVE,
    strategicNavigationId: "V2_P1_VERIFIED_P2_RECOVERY", commitStrategicPlans: true,
    requireTacticalRecovery: true, recoveryVerificationDepth: 1,
    recoveryVerificationNodeBudget: 512,
    bridgeOptions: { engineOptions: { diagnosticPersistentNavigationPlans: true,
      planArbitrationEnabled: true } } }),
  V3R2_PHYSICAL_REFINED_P2_P2_VERIFIED_RECOVERY_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE, commitSelectedTacticalPlans: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512 },
    strategicNavigationMode: V3_COMPONENT_MODE.ACTIVE,
    strategicNavigationId: "V2_P2_VERIFIED_P2_RECOVERY", commitStrategicPlans: true,
    requireTacticalRecovery: true, recoveryVerificationDepth: 2,
    recoveryVerificationNodeBudget: 2048,
    bridgeOptions: { engineOptions: { diagnosticPersistentNavigationPlans: true,
      planArbitrationEnabled: true } } }),
  V3R2_PHYSICAL_REFINED_P2_P3_VERIFIED_RECOVERY_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE, commitSelectedTacticalPlans: true,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512 },
    strategicNavigationMode: V3_COMPONENT_MODE.ACTIVE,
    strategicNavigationId: "V2_P3_VERIFIED_P2_RECOVERY", commitStrategicPlans: true,
    requireTacticalRecovery: true, recoveryVerificationDepth: 3,
    recoveryVerificationNodeBudget: 4096,
    bridgeOptions: { engineOptions: { diagnosticPersistentNavigationPlans: true,
      planArbitrationEnabled: true } } }),
  V3R2_PHYSICAL_REFINED_P2_P2_NONINFERIOR_RECOVERY_ACTIVE: Object.freeze({
    enableV2Bridge: true, hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    commitSelectedTacticalPlans: true, tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refinementNodeBudget: 512 },
    strategicNavigationMode: V3_COMPONENT_MODE.ACTIVE,
    strategicNavigationId: "V2_P2_NONINFERIOR_P2_RECOVERY", commitStrategicPlans: true,
    requireTacticalRecovery: true, recoveryVerificationDepth: 2,
    recoveryVerificationNodeBudget: 2048, allowRecoveryValueTie: true,
    bridgeOptions: { engineOptions: { diagnosticPersistentNavigationPlans: true,
      planArbitrationEnabled: true } } }),
  V3R2_PHYSICAL_VARIANT_P2_ACTIVE: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreMode: V3_COMPONENT_MODE.ACTIVE,
    tacticalCoreOptions: { ownershipMode: "physical-strict-maximin-dominance",
      minimumOwnershipDepth: 2, refineDepthTwo: true, refineMoveVariants: true,
      refinementNodeBudget: 512 } }),
  V3R3_EO_FINAL: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    finalCommittedRescueMode: V3_COMPONENT_MODE.ACTIVE }),
  V3R4_VERIFIED_COMBAT: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    combatAttackMode: V3_COMPONENT_MODE.ACTIVE }),
  V3R5_STRATEGY: Object.freeze({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
    strategicNavigationMode: V3_COMPONENT_MODE.ACTIVE,
    strategicNavigationId: "V3R5_STRATEGIC_PROGRESS" }),
  V3R8_NATIVE_BEST: Object.freeze({ native: true })
});

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function has(name) { return process.argv.includes(name); }

function defaultCohort(root) {
  return path.join(root, "config", "engine-v3", "vc0-scenario-manifest.json");
}

function loadAnyCohort(root, cohortFile, role) {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(cohortFile), "utf8"));
  return manifest.objectKind === repairCohort.KIND ?
    repairCohort.load(root, cohortFile, role) : loadCohort(root, cohortFile, role);
}

function outputRoot(root, stage, role, mode) {
  const fingerprint = fingerprintObject({ stage, role, mode }).slice(0, 16);
  return path.join(root, "artifacts", "v3-components", `${stage.toLowerCase()}-${role.toLowerCase()}-${fingerprint}`);
}

function writeImmutable(file, bytes) {
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file);
    if (!existing.equals(bytes)) throw new Error(`V3_COMPONENT_ARTIFACT_IMMUTABLE:${file}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function freeze(root, cohortFile, v1Sha256) {
  if (fs.existsSync(cohortFile)) {
    const existing = validateManifest(JSON.parse(fs.readFileSync(cohortFile, "utf8")));
    process.stdout.write(`${JSON.stringify({ status: "EXISTS", cohortFile,
      fingerprint: existing.fingerprint }, null, 2)}\n`);
    return;
  }
  const manifest = buildCohortManifest(root, v1Sha256);
  fs.mkdirSync(path.dirname(cohortFile), { recursive: true });
  fs.writeFileSync(cohortFile, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: "FROZEN", cohortFile,
    fingerprint: manifest.fingerprint, scenarios: manifest.scenarios.length }, null, 2)}\n`);
}

function componentOptions(mode) {
  const found = MODES[mode];
  if (!found) throw new Error(`V3_COMPONENT_MODE_UNKNOWN:${mode}`);
  return found;
}

function implementationId(mode) {
  if (mode === "BASE_V3") return "V3_BASE";
  if (mode === "V3R8_NATIVE_BEST") return "V3_NATIVE_BASELINE";
  return `V3_PLUS_${mode}`;
}

function rawResult(replay, candidateSeat, challengerId, controlId) {
  const winnerSeat = replay.result?.winner;
  return { winnerSeat: winnerSeat === 0 || winnerSeat === 1 ? winnerSeat : null,
    winnerImplementation: winnerSeat === candidateSeat ? challengerId :
      winnerSeat === (candidateSeat ^ 1) ? controlId : "DRAW",
    reason: replay.result?.reason || "UNKNOWN" };
}

function analysisResult(match) {
  const candidateSeat = match.candidateSeat;
  const controlSeat = candidateSeat ^ 1;
  const winnerSeat = match.result.winnerSeat;
  const mapped = { ...match,
    seatImplementations: candidateSeat === 0 ? ["v2", "v1"] : ["v1", "v2"],
    result: { ...match.result, winnerImplementation:
      winnerSeat === candidateSeat ? "v2" :
        winnerSeat === controlSeat ? "v1" : "draw" } };
  const result = classifyAnalysisOutcome(mapped);
  return { outcome: result.analysisOutcome === "V2_WIN" ? "CHALLENGER_WIN" :
    result.analysisOutcome === "V1_WIN" ? "CONTROL_WIN" : "DRAW",
    terminalCategory: result.terminalCategory };
}

function compactController(summary) {
  return { sourceSha256: summary.sourceSha256, decisions: summary.decisions,
    replacementMask: summary.replacementMask, bridge: summary.bridge,
    ownership: summary.ownership || null,
    nativeControlShadow: summary.nativeControlShadow || null,
    committedRescueShadow: summary.committedRescueShadow || null,
    verifiedAttackShadow: summary.verifiedAttackShadow || null,
    preemptiveSafetyShadow: summary.preemptiveSafetyShadow || null,
    stabilityShadow: summary.stabilityShadow || null,
    tacticalCore: summary.tacticalCore || null,
    ports: summary.ports.filter(item => item.replaced || item.calls > 0).map(item =>
      [item.slot, item.componentId, item.calls, item.details]) };
}

async function play(module, scenario, candidateSeat, candidateMode, baselineMode,
    candidateOptionsOverride = null, baselineOptionsOverride = null) {
  const challengerId = implementationId(candidateMode);
  const controlId = implementationId(baselineMode);
  const star = createHistoricalStarProvider(scenario.stars);
  const simulator = new module.AgenTankSimulator({ map: scenario.map,
    tanks: scenario.starts.map((tank, seat) => ({ ...tank, id: `v3-component-${seat}` })),
    skills: ["stun", "stun"], star: star.initialStar,
    starProvider: value => star.provider(value), seed: seedFor(scenario),
    maxFrames: 128, starLimit: false });
  const bots = [];
  for (let seat = 0; seat < 2; seat += 1) {
    const mode = seat === candidateSeat ? candidateMode : baselineMode;
    const base = componentOptions(mode);
    const override = seat === candidateSeat ? candidateOptionsOverride : baselineOptionsOverride;
    const nativeOptions = override?.nativeBasePolicyTacticalOptions ? {
      ...(base.nativeBasePolicyTacticalOptions || {}),
      ...override.nativeBasePolicyTacticalOptions
    } : base.nativeBasePolicyTacticalOptions;
    bots.push(new V3DiagnosticBot({ ...base, ...(override || {}),
      ...(nativeOptions ? { nativeBasePolicyTacticalOptions: nativeOptions } : {}),
      contextName: `v3-component-${scenario.matchUrlId}-${candidateSeat}-${seat}` }));
  }
  const audited = bots.map(bot => new DecisionAudit(bot, { captureCompactFrames: true }));
  const replay = simulator.run(audited[0], audited[1]);
  const result = rawResult(replay, candidateSeat, challengerId, controlId);
  const counts = collectCounts(replay, candidateSeat);
  const summaries = audited.map(item => item.summary());
  const controllers = bots.map(item => compactController(item.summary().controller));
  const match = { matchId: `${scenario.matchUrlId}:CHALLENGER_SEAT_${candidateSeat}`,
    historicalMatchUrlId: scenario.matchUrlId,
    scenarioFingerprint: scenario.fingerprint, candidateSeat,
    comparison: { kind: "V3_COMPONENT_CAUSAL",
      challengerImplementation: challengerId, controlImplementation: controlId,
      challengerMode: candidateMode, controlMode: baselineMode },
    seatImplementations: candidateSeat === 0 ? [challengerId, controlId] :
      [controlId, challengerId], seatSkills: ["stun", "stun"],
    frames: replay.replayData.replay.records.length, result, counts,
    candidate: summaries[candidateSeat], baseline: summaries[candidateSeat ^ 1],
    candidateController: controllers[candidateSeat], baselineController: controllers[candidateSeat ^ 1] };
  const analysis = analysisResult(match);
  match.analysisOutcome = analysis.outcome;
  match.terminalCategory = analysis.terminalCategory;
  return match;
}

function add(target, source) {
  for (const [key, value] of Object.entries(source || {}))
    target[key] = (target[key] || 0) + value;
}

function pairedRandomization(matches) {
  const differences = [];
  for (let at = 0; at < matches.length; at += 2) {
    let difference = 0;
    for (let offset = 0; offset < 2; offset += 1) {
      const outcome = matches[at + offset].analysisOutcome;
      if (outcome === "CHALLENGER_WIN") difference += 1;
      else if (outcome === "CONTROL_WIN") difference -= 1;
    }
    if (difference) differences.push(difference);
  }
  let distribution = new Map([[0, 1n]]);
  for (const difference of differences) {
    const next = new Map();
    for (const [sum, count] of distribution) {
      next.set(sum + difference, (next.get(sum + difference) || 0n) + count);
      next.set(sum - difference, (next.get(sum - difference) || 0n) + count);
    }
    distribution = next;
  }
  const observed = Math.abs(differences.reduce((sum, value) => sum + value, 0));
  let extreme = 0n; let total = 0n;
  for (const [sum, count] of distribution) {
    total += count; if (Math.abs(sum) >= observed) extreme += count;
  }
  const partsPerMillion = total ? Number(extreme * 1000000n / total) : 1000000;
  return { nonZeroScenarioCount: differences.length, observedNetWins: observed,
    pPartsPerMillion: partsPerMillion,
    pValue: (partsPerMillion / 1000000).toFixed(6) };
}

function overview(matches, elapsedMs) {
  const output = { matches: matches.length, scenarios: matches.length / 2,
    identities: matches.length ? { challenger: matches[0].comparison.challengerImplementation,
      control: matches[0].comparison.controlImplementation } : null,
    analysis: { challengerWins: 0, controlWins: 0, draws: 0,
      scoreBasisPoints: 0, scorePercent: "0.00" },
    pairs: { challengerSweep: 0, controlSweep: 0, split: 0, oneWinDraw: 0,
      oneLossDraw: 0, doubleDraw: 0 }, actions: { challenger: {}, control: {} },
    crashes: { challenger: 0, control: 0 }, stars: { challenger: 0, control: 0 },
    runtime: { elapsedMs, challengerTotalMicros: 0, controlTotalMicros: 0,
      challengerP95MaximumMicros: 0, controlP95MaximumMicros: 0 },
    pairedRandomization: null,
    bridge: { prepares: 0, incomplete: 0, emissions: 0, capacityFailures: 0,
      ambiguousAssociations: 0, hotAllocations: 0, softSafetyBuilds: 0,
      softSafetyReuses: 0 },
    ownership: { decisions: 0, emissions: 0, finalOverrides: 0,
      inlineStability: 0, unattributed: 0, stages: {} },
    nativeControlShadow: { observations: 0, incomplete: 0, informationIncomplete: 0,
      rootRestoreFailures: 0, hardEvaluations: 0, escapeEvaluations: 0,
      searchNodes: 0, modes: {}, ports: {}, ownershipByMode: {} },
    committedRescueShadow: { calls: 0, complete: 0, incomplete: 0, trapped: 0,
      proposals: 0, preferredProvenDead: 0, preferredViable: 0, selectedViable: 0,
      proposalByOwnership: {}, proposalActions: {} },
    verifiedAttackShadow: { evaluations: 0, proposals: 0, directKills: 0,
      enemyReductions: 0, riskBlocked: 0, escapeBlocked: 0, exposureBlocked: 0,
      purposeBlocked: 0, closureBlocked: 0, noReduction: 0, robustBlocked: 0,
      nonDirectBlocked: 0, rootRestoreFailures: 0,
      proposalByOwnership: {}, preferredActions: {} },
    preemptiveSafetyShadow: { calls: 0, complete: 0, incomplete: 0,
      notApplicable: 0, v1Proposals: 0, v2Evidence: 0, agree: 0,
      v1Only: 0, v2Only: 0, disagree: 0, strictRefinements: 0,
      v1Dominates: 0, incomparable: 0, futureFire: 0,
      possibleProjectile: 0, unknown: 0, recommendedActions: {},
      v1Actions: {}, recommendationByOwnership: {} } };
  output.stabilityShadow = { calls: 0, streakRoots: 0, v1HandledGo: 0,
    turnPreferred: 0, higherPriorityAction: 0, candidates: 0,
    hardBlocked: 0, committedBlocked: 0, geometryBlocked: 0, riskBlocked: 0,
    riskUnder20000: 0, risk20000To34999: 0, risk35000OrMore: 0,
    zeroRiskBlocked: 0,
    candidateByOwnership: {}, preferredActions: {} };
  output.tacticalCore = { callCount: 0, completeCount: 0, incompleteCount: 0,
    physicalSearchCount: 0, informationSearchCount: 0, stageMatrixCount: 0,
    supportExactCount: 0, exactDominanceCount: 0, sameActionCount: 0,
    physicalCellCheckCount: 0, physicalCellSupportCount: 0,
    physicalCellLegacyMissingCount: 0, physicalCellDominanceCount: 0,
    physicalCellNoDominanceCount: 0, physicalWorstTieBlockedCount: 0,
    physicalDepthBlockedCount: 0,
    refinementCheckCount: 0, refinementEligibleCount: 0,
    refinementCompleteCount: 0, refinementIncompleteCount: 0,
    refinementNodeCount: 0, refinementMaximumRows: 0,
    refinementWidthAbortCount: 0, refinementFastAbortCount: 0,
    refinementHardAbortCount: 0, refinementBudgetAbortCount: 0,
    refinementOtherAbortCount: 0,
    refinementFastStatusCount: [],
    refinementUnsupportedReasonCount: [],
    refinementFailureActionPairCount: [],
    refinementJointRelocationDetailCount: [],
    variantRefinementAttemptCount: 0, variantRefinementCompleteCount: 0,
    variantRefinementIncompleteCount: 0, variantRefinementNodeCount: 0,
    variantRefinementSelectionCount: 0,
    depthRootRestoreFailures: 0,
    informationRootRestoreFailures: 0, proofRootRestoreFailures: 0,
    optionPolicyCertificate: { attempts: 0, complete: 0, incomplete: 0,
      support: 0, branches: 0, terminals: 0, hiddenSuccessors: 0,
      conflicts: 0, rootRestoreFailures: 0, reasons: {} },
    rootPolicyPrior: { prepareCount: 0, promoteCount: 0,
      missingCount: 0, ambiguousCount: 0 } };
  let score = 0;
  for (const match of matches) {
    if (match.analysisOutcome === "CHALLENGER_WIN") {
      output.analysis.challengerWins += 1; score += 2;
    } else if (match.analysisOutcome === "CONTROL_WIN") output.analysis.controlWins += 1;
    else { output.analysis.draws += 1; score += 1; }
    const other = match.candidateSeat ^ 1;
    output.crashes.challenger += match.counts.crashes[match.candidateSeat];
    output.crashes.control += match.counts.crashes[other];
    output.stars.challenger += match.counts.stars[match.candidateSeat];
    output.stars.control += match.counts.stars[other];
    add(output.actions.challenger, match.candidate.actionCounts);
    add(output.actions.control, match.baseline.actionCounts);
    output.runtime.challengerTotalMicros += match.candidate.totalRuntimeMicros;
    output.runtime.controlTotalMicros += match.baseline.totalRuntimeMicros;
    output.runtime.challengerP95MaximumMicros = Math.max(
      output.runtime.challengerP95MaximumMicros, match.candidate.p95RuntimeMicros);
    output.runtime.controlP95MaximumMicros = Math.max(
      output.runtime.controlP95MaximumMicros, match.baseline.p95RuntimeMicros);
    const bridge = match.candidateController.bridge;
    if (bridge) {
      output.bridge.prepares += bridge.prepareCount;
      output.bridge.incomplete += bridge.incompleteCount;
      output.bridge.emissions += bridge.emissionCount;
      output.bridge.capacityFailures += bridge.projectileCapacityFailureCount;
      output.bridge.ambiguousAssociations += bridge.projectileAmbiguousAssociationCount;
      output.bridge.hotAllocations += bridge.adapterHotAllocationCount + bridge.engineHotAllocationCount;
      output.bridge.softSafetyBuilds += bridge.softSafetyEvidenceBuildCount || 0;
      output.bridge.softSafetyReuses += bridge.softSafetyEvidenceReuseCount || 0;
    }
    const ownership = match.candidateController.ownership;
    if (ownership) {
      output.ownership.decisions += ownership.decisionCount;
      output.ownership.emissions += ownership.emissionCount;
      output.ownership.finalOverrides += ownership.finalOverrideCount;
      output.ownership.inlineStability += ownership.inlineStabilityCount;
      output.ownership.unattributed += ownership.unattributedCount;
      add(output.ownership.stages, ownership.stages);
    }
    const shadow = match.candidateController.nativeControlShadow;
    if (shadow) {
      output.nativeControlShadow.observations += shadow.observeCount;
      output.nativeControlShadow.incomplete += shadow.incompleteCount;
      output.nativeControlShadow.informationIncomplete += shadow.informationIncompleteCount;
      output.nativeControlShadow.rootRestoreFailures += shadow.rootRestoreFailureCount;
      output.nativeControlShadow.hardEvaluations += shadow.hardEvaluationCount;
      output.nativeControlShadow.escapeEvaluations += shadow.escapeEvaluationCount;
      output.nativeControlShadow.searchNodes += shadow.searchNodeCount;
      add(output.nativeControlShadow.modes, shadow.modes);
      add(output.nativeControlShadow.ports, shadow.ports);
      if (ownership) {
        const stages = Buffer.from(ownership.stageStream, "base64");
        const modes = Buffer.from(shadow.modeStream, "base64");
        if (stages.length !== modes.length)
          throw new Error(`V3_CONTROL_SHADOW_STREAM_MISMATCH:${stages.length}:${modes.length}`);
        const modeNames = ["INCOMPLETE", "COMMITTED_ESCAPE", "TACTICAL_CONTACT",
          "STRATEGIC_NAVIGATION"];
        for (let frame = 0; frame < stages.length; frame += 1) {
          const stage = OWNERSHIP_STAGE_NAMES[stages[frame]] || `STAGE_${stages[frame]}`;
          const mode = modeNames[modes[frame]] || `MODE_${modes[frame]}`;
          const row = output.nativeControlShadow.ownershipByMode[stage] ||
            (output.nativeControlShadow.ownershipByMode[stage] = {});
          row[mode] = (row[mode] || 0) + 1;
        }
      }
    }
    const tactical = match.candidateController.tacticalCore;
    if (tactical) {
      for (const key of ["callCount", "completeCount", "incompleteCount",
        "physicalSearchCount", "informationSearchCount", "stageMatrixCount",
        "supportExactCount", "exactDominanceCount", "sameActionCount",
        "physicalCellCheckCount", "physicalCellSupportCount",
        "physicalCellLegacyMissingCount", "physicalCellDominanceCount",
        "physicalCellNoDominanceCount", "physicalWorstTieBlockedCount",
        "physicalDepthBlockedCount",
        "refinementCheckCount", "refinementEligibleCount",
        "refinementCompleteCount", "refinementIncompleteCount",
        "refinementNodeCount", "refinementWidthAbortCount",
        "refinementFastAbortCount", "refinementHardAbortCount",
        "refinementBudgetAbortCount", "refinementOtherAbortCount",
        "variantRefinementAttemptCount", "variantRefinementCompleteCount",
        "variantRefinementIncompleteCount", "variantRefinementNodeCount",
        "variantRefinementSelectionCount",
        "depthRootRestoreFailures",
        "informationRootRestoreFailures", "proofRootRestoreFailures"])
        output.tacticalCore[key] += tactical[key] || 0;
      output.tacticalCore.ownershipMode = tactical.ownershipMode;
      output.tacticalCore.minimumOwnershipDepth = tactical.minimumOwnershipDepth;
      output.tacticalCore.refineDepthTwo = tactical.refineDepthTwo;
      output.tacticalCore.refineMoveVariants = tactical.refineMoveVariants;
      output.tacticalCore.refinementNodeBudget = tactical.refinementNodeBudget;
      output.tacticalCore.refinementMaximumRows = Math.max(
        output.tacticalCore.refinementMaximumRows,
        tactical.refinementMaximumRows || 0);
      if (Array.isArray(tactical.refinementFastStatusCount))
        for (let index = 0; index < tactical.refinementFastStatusCount.length; index += 1)
          output.tacticalCore.refinementFastStatusCount[index] =
            (output.tacticalCore.refinementFastStatusCount[index] || 0) +
            (tactical.refinementFastStatusCount[index] || 0);
      if (Array.isArray(tactical.refinementUnsupportedReasonCount))
        for (let index = 0; index < tactical.refinementUnsupportedReasonCount.length;
            index += 1)
          output.tacticalCore.refinementUnsupportedReasonCount[index] =
            (output.tacticalCore.refinementUnsupportedReasonCount[index] || 0) +
            (tactical.refinementUnsupportedReasonCount[index] || 0);
      if (Array.isArray(tactical.refinementFailureActionPairCount))
        for (let index = 0; index < tactical.refinementFailureActionPairCount.length;
            index += 1)
          output.tacticalCore.refinementFailureActionPairCount[index] =
            (output.tacticalCore.refinementFailureActionPairCount[index] || 0) +
            (tactical.refinementFailureActionPairCount[index] || 0);
      if (Array.isArray(tactical.refinementJointRelocationDetailCount))
        for (let index = 0; index < tactical.refinementJointRelocationDetailCount.length;
            index += 1)
          output.tacticalCore.refinementJointRelocationDetailCount[index] =
            (output.tacticalCore.refinementJointRelocationDetailCount[index] || 0) +
            (tactical.refinementJointRelocationDetailCount[index] || 0);
      const certificate = tactical.optionPolicyCertificate;
      if (certificate) {
        const aggregate = output.tacticalCore.optionPolicyCertificate;
        aggregate.attempts += certificate.attemptCount || 0;
        aggregate.complete += certificate.completeCount || 0;
        aggregate.incomplete += certificate.incompleteCount || 0;
        aggregate.support += certificate.supportCount || 0;
        aggregate.branches += certificate.branchCount || 0;
        aggregate.terminals += certificate.terminalCount || 0;
        aggregate.hiddenSuccessors += certificate.hiddenSuccessorCount || 0;
        aggregate.conflicts += certificate.conflictCount || 0;
        aggregate.rootRestoreFailures += certificate.rootRestoreFailures || 0;
        aggregate.reasons[certificate.reason] =
          (aggregate.reasons[certificate.reason] || 0) + 1;
      }
      const prior = tactical.rootPolicyPrior;
      if (prior) {
        output.tacticalCore.rootPolicyPrior.prepareCount += prior.prepareCount || 0;
        output.tacticalCore.rootPolicyPrior.promoteCount += prior.promoteCount || 0;
        output.tacticalCore.rootPolicyPrior.missingCount += prior.missingCount || 0;
        output.tacticalCore.rootPolicyPrior.ambiguousCount += prior.ambiguousCount || 0;
      }
    }
    const rescue = match.candidateController.committedRescueShadow;
    if (rescue) {
      output.committedRescueShadow.calls += rescue.callCount;
      output.committedRescueShadow.complete += rescue.completeCount;
      output.committedRescueShadow.incomplete += rescue.incompleteCount;
      output.committedRescueShadow.trapped += rescue.trappedCount;
      output.committedRescueShadow.proposals += rescue.finalProposalCount;
      output.committedRescueShadow.preferredProvenDead += rescue.preferredProvenDeadCount;
      output.committedRescueShadow.preferredViable += rescue.finalPreferredViableCount;
      output.committedRescueShadow.selectedViable += rescue.finalSelectedViableCount;
      if (ownership) {
        const stages = Buffer.from(ownership.stageStream, "base64");
        const proposals = Buffer.from(rescue.finalProposalActionStream, "base64");
        if (stages.length !== proposals.length)
          throw new Error(`V3_COMMITTED_RESCUE_STREAM_MISMATCH:${stages.length}:${proposals.length}`);
        for (let frame = 0; frame < proposals.length; frame += 1) if (proposals[frame] !== 0xff) {
          const stage = OWNERSHIP_STAGE_NAMES[stages[frame]] || `STAGE_${stages[frame]}`;
          output.committedRescueShadow.proposalByOwnership[stage] =
            (output.committedRescueShadow.proposalByOwnership[stage] || 0) + 1;
          const action = actionToLegacy(proposals[frame]);
          output.committedRescueShadow.proposalActions[action] =
            (output.committedRescueShadow.proposalActions[action] || 0) + 1;
        }
      }
    }
    const attack = match.candidateController.verifiedAttackShadow;
    if (attack) {
      output.verifiedAttackShadow.evaluations += attack.evaluationCount;
      output.verifiedAttackShadow.proposals += attack.proposalCount;
      output.verifiedAttackShadow.directKills += attack.directKillCount;
      output.verifiedAttackShadow.enemyReductions += attack.enemyReductionCount;
      output.verifiedAttackShadow.riskBlocked += attack.riskBlockedCount;
      output.verifiedAttackShadow.escapeBlocked += attack.escapeBlockedCount;
      output.verifiedAttackShadow.exposureBlocked += attack.exposureBlockedCount;
      output.verifiedAttackShadow.purposeBlocked += attack.purposeBlockedCount;
      output.verifiedAttackShadow.closureBlocked += attack.closureBlockedCount;
      output.verifiedAttackShadow.noReduction += attack.noReductionCount;
      output.verifiedAttackShadow.robustBlocked += attack.robustBlockedCount;
      output.verifiedAttackShadow.nonDirectBlocked += attack.nonDirectBlockedCount;
      output.verifiedAttackShadow.rootRestoreFailures += attack.projectileRootRestoreFailures;
      if (ownership) {
        const stages = Buffer.from(ownership.stageStream, "base64");
        const proposals = Buffer.from(attack.proposalActionStream, "base64");
        const preferred = Buffer.from(attack.preferredActionStream, "base64");
        if (stages.length !== proposals.length)
          throw new Error(`V3_VERIFIED_ATTACK_STREAM_MISMATCH:${stages.length}:${proposals.length}`);
        for (let frame = 0; frame < proposals.length; frame += 1) if (proposals[frame] !== 0xff) {
          const stage = OWNERSHIP_STAGE_NAMES[stages[frame]] || `STAGE_${stages[frame]}`;
          output.verifiedAttackShadow.proposalByOwnership[stage] =
            (output.verifiedAttackShadow.proposalByOwnership[stage] || 0) + 1;
          const action = actionToLegacy(preferred[frame]);
          output.verifiedAttackShadow.preferredActions[action] =
            (output.verifiedAttackShadow.preferredActions[action] || 0) + 1;
        }
      }
    }
    const preemptive = match.candidateController.preemptiveSafetyShadow;
    if (preemptive) {
      output.preemptiveSafetyShadow.calls += preemptive.callCount;
      output.preemptiveSafetyShadow.complete += preemptive.completeCount;
      output.preemptiveSafetyShadow.incomplete += preemptive.incompleteCount;
      output.preemptiveSafetyShadow.notApplicable += preemptive.notApplicableCount;
      output.preemptiveSafetyShadow.v1Proposals += preemptive.v1ProposalCount;
      output.preemptiveSafetyShadow.v2Evidence += preemptive.v2EvidenceCount;
      output.preemptiveSafetyShadow.agree += preemptive.agreeCount;
      output.preemptiveSafetyShadow.v1Only += preemptive.v1OnlyCount;
      output.preemptiveSafetyShadow.v2Only += preemptive.v2OnlyCount;
      output.preemptiveSafetyShadow.disagree += preemptive.disagreeCount;
      output.preemptiveSafetyShadow.strictRefinements += preemptive.strictRefinementCount;
      output.preemptiveSafetyShadow.v1Dominates += preemptive.v1DominatesCount;
      output.preemptiveSafetyShadow.incomparable += preemptive.incomparableCount;
      output.preemptiveSafetyShadow.futureFire += preemptive.futureFireCount;
      output.preemptiveSafetyShadow.possibleProjectile += preemptive.possibleProjectileCount;
      output.preemptiveSafetyShadow.unknown += preemptive.unknownCount;
      const recommendations = Buffer.from(preemptive.recommendedActionStream, "base64");
      const v1Actions = Buffer.from(preemptive.v1ActionStream, "base64");
      const stages = ownership ? Buffer.from(ownership.stageStream, "base64") : null;
      for (let frame = 0; frame < recommendations.length; frame += 1) {
        if (recommendations[frame] !== 0xff) {
          const action = actionToLegacy(recommendations[frame]);
          output.preemptiveSafetyShadow.recommendedActions[action] =
            (output.preemptiveSafetyShadow.recommendedActions[action] || 0) + 1;
          if (stages && frame < stages.length) {
            const stage = OWNERSHIP_STAGE_NAMES[stages[frame]] || `STAGE_${stages[frame]}`;
            output.preemptiveSafetyShadow.recommendationByOwnership[stage] =
              (output.preemptiveSafetyShadow.recommendationByOwnership[stage] || 0) + 1;
          }
        }
        if (v1Actions[frame] !== 0xff) {
          const action = actionToLegacy(v1Actions[frame]);
          output.preemptiveSafetyShadow.v1Actions[action] =
            (output.preemptiveSafetyShadow.v1Actions[action] || 0) + 1;
        }
      }
    }
    const stability = match.candidateController.stabilityShadow;
    if (stability) {
      output.stabilityShadow.calls += stability.callCount;
      output.stabilityShadow.streakRoots += stability.streakRootCount;
      output.stabilityShadow.v1HandledGo += stability.v1HandledGoCount;
      output.stabilityShadow.turnPreferred += stability.turnPreferredCount;
      output.stabilityShadow.higherPriorityAction += stability.higherPriorityActionCount;
      output.stabilityShadow.candidates += stability.candidateCount;
      output.stabilityShadow.hardBlocked += stability.hardBlockedCount;
      output.stabilityShadow.committedBlocked += stability.committedBlockedCount;
      output.stabilityShadow.geometryBlocked += stability.geometryBlockedCount;
      output.stabilityShadow.riskBlocked += stability.riskBlockedCount;
      output.stabilityShadow.riskUnder20000 += stability.riskUnder20000Count;
      output.stabilityShadow.risk20000To34999 += stability.risk20000To34999Count;
      output.stabilityShadow.risk35000OrMore += stability.risk35000OrMoreCount;
      output.stabilityShadow.zeroRiskBlocked += stability.zeroRiskBlockedCount || 0;
      const candidates = Buffer.from(stability.candidateActionStream, "base64");
      const preferred = Buffer.from(stability.preferredActionStream, "base64");
      const stages = ownership ? Buffer.from(ownership.stageStream, "base64") : null;
      for (let frame = 0; frame < preferred.length; frame += 1) {
        if (preferred[frame] !== 0xff) {
          const action = actionToLegacy(preferred[frame]);
          output.stabilityShadow.preferredActions[action] =
            (output.stabilityShadow.preferredActions[action] || 0) + 1;
        }
        if (candidates[frame] !== 0xff && stages && frame < stages.length) {
          const stage = OWNERSHIP_STAGE_NAMES[stages[frame]] || `STAGE_${stages[frame]}`;
          output.stabilityShadow.candidateByOwnership[stage] =
            (output.stabilityShadow.candidateByOwnership[stage] || 0) + 1;
        }
      }
    }
  }
  output.analysis.scoreBasisPoints = Math.round(score * 5000 / Math.max(1, matches.length));
  output.analysis.scorePercent = (output.analysis.scoreBasisPoints / 100).toFixed(2);
  for (let at = 0; at < matches.length; at += 2) {
    const values = [matches[at].analysisOutcome, matches[at + 1].analysisOutcome];
    if (values.every(value => value === "CHALLENGER_WIN")) output.pairs.challengerSweep += 1;
    else if (values.every(value => value === "CONTROL_WIN")) output.pairs.controlSweep += 1;
    else if (values.includes("CHALLENGER_WIN") && values.includes("CONTROL_WIN")) output.pairs.split += 1;
    else if (values.includes("CHALLENGER_WIN")) output.pairs.oneWinDraw += 1;
    else if (values.includes("CONTROL_WIN")) output.pairs.oneLossDraw += 1;
    else output.pairs.doubleDraw += 1;
  }
  output.pairedRandomization = pairedRandomization(matches);
  return output;
}

async function run(root, cohortFile) {
  const role = option("--role", "ALL").toUpperCase();
  const stage = option("--stage", "VC0").toUpperCase();
  const candidateMode = option("--candidate", "BASE_V3").toUpperCase();
  const baselineMode = option("--baseline", "BASE_V3").toUpperCase();
  componentOptions(candidateMode); componentOptions(baselineMode);
  const cohort = loadAnyCohort(root, cohortFile, role);
  const requestedScenario = option("--scenario-fingerprint", "");
  const scenarios = requestedScenario ? cohort.scenarios.filter(scenario =>
    scenario.fingerprint === requestedScenario ||
    scenario.scenarioFingerprint === requestedScenario) : cohort.scenarios;
  if (requestedScenario && scenarios.length !== 1)
    throw new Error(`V3_COMPONENT_SCENARIO_NOT_UNIQUE:${requestedScenario}:${scenarios.length}`);
  const output = path.resolve(option("--output",
    outputRoot(root, stage, role, `${baselineMode}-vs-${candidateMode}`)));
  const simulator = await loadSimulator(root); const matches = []; const started = Date.now();
  for (let index = 0; index < scenarios.length; index += 1) {
    const scenario = scenarios[index];
    matches.push(await play(simulator.module, scenario, 0, candidateMode, baselineMode));
    matches.push(await play(simulator.module, scenario, 1, candidateMode, baselineMode));
    if (has("--progress") && ((index + 1) % 4 === 0 || index + 1 === scenarios.length))
      process.stderr.write(`[v3-component] ${index + 1}/${scenarios.length} scenarios\n`);
  }
  const summary = overview(matches, Date.now() - started);
  const manifest = { schemaVersion: 1, objectKind: "V3_COMPONENT_ARENA_V1", stage, role,
    baselineMode, candidateMode, cohortFingerprint: cohort.manifest.fingerprint,
    comparison: { kind: "V3_COMPONENT_CAUSAL",
      controlImplementation: implementationId(baselineMode),
      challengerImplementation: implementationId(candidateMode),
      explicitlyNotV2: true },
    sourceIndexSha256: cohort.sourceIndex.sha256, generatedAt: new Date().toISOString(),
    scenarioCount: scenarios.length, requestedScenario: requestedScenario || null,
    matchCount: matches.length, fingerprint: "" };
  const payload = { ...manifest }; delete payload.generatedAt; delete payload.fingerprint;
  manifest.fingerprint = fingerprintObject({ ...payload, overview: summary });
  const lines = Buffer.from(matches.map(match => JSON.stringify(match)).join("\n") + "\n");
  const compressed = zlib.gzipSync(lines, { level: 9 });
  const samples = zlib.gzipSync(Buffer.from(""), { level: 9 });
  writeImmutable(path.join(output, "manifest.json"),
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  writeImmutable(path.join(output, "overview.json"),
    Buffer.from(`${JSON.stringify(summary, null, 2)}\n`));
  writeImmutable(path.join(output, "matches.ndjson.gz"), compressed);
  writeImmutable(path.join(output, "diagnostic-samples.ndjson.gz"), samples);
  const totalBytes = fs.readdirSync(output).reduce((sum, name) =>
    sum + fs.statSync(path.join(output, name)).size, 0);
  if (totalBytes > 2 * 1024 * 1024) throw new Error(`V3_COMPONENT_ARTIFACT_BUDGET:${totalBytes}`);
  process.stdout.write(`${JSON.stringify({ output, totalBytes,
    manifestSha256: sha256Bytes(fs.readFileSync(path.join(output, "manifest.json"))),
    overview: summary }, null, 2)}\n`);
}

async function main() {
  const root = defaultWorkspaceRoot(); const frozen = loadFrozenCandidate(root);
  const cohortFile = path.resolve(option("--cohort", defaultCohort(root)));
  const command = process.argv[2] || "run";
  if (command === "freeze") freeze(root, cohortFile, frozen.manifest.selection.v1Sha256);
  else if (command === "verify-cohort") {
    const cohort = loadAnyCohort(root, cohortFile, "ALL");
    process.stdout.write(`${JSON.stringify({ status: "VALID", cohortFile,
      fingerprint: cohort.manifest.fingerprint, scenarios: cohort.scenarios.length }, null, 2)}\n`);
  } else if (command === "run") await run(root, cohortFile);
  else throw new Error(`V3_COMPONENT_COMMAND_UNKNOWN:${command}`);
}

if (require.main === module)
  main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { MODES, componentOptions, implementationId, analysisResult, play, overview,
  pairedRandomization };
