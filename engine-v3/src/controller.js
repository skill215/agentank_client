"use strict";

const { ComponentRegistry } = require("./component-registry");
const { V3_SLOT, V3_COMPONENT_MODE } = require("./contracts");
const { resolveFrozenV1 } = require("./legacy/default-source");
const { LegacyV1Runtime } = require("./legacy/v1-runtime");
const { V2BridgeKernel } = require("./v2-bridge-kernel");
const { V2FramePrepareAdapter, V2FinalActionObserver, V2ActionEmitAdapter,
  V2TacticalContactAdapter } = require("./adapters/v2-bridge-components");
const { V2HardFinalAdapter } = require("./adapters/v2-hard-final");
const { committedEscapePorts, V2CommittedEscapeOwner,
  V2CommittedRescueShadowAdapter, V2CommittedRescueFinalAdapter } =
  require("./adapters/v2-committed-escape");
const { V2ForcedWinAdapter } = require("./adapters/v2-forced-win");
const { combatAttackPorts, V2VerifiedAttackOwner,
  V2OrderedRescueAttackFinalAdapter } = require("./adapters/v2-combat-attack");
const { V2TacticalCoreAdapter } = require("./adapters/v2-tactical-core");
const { V2NativeBasePolicyTacticalAdapter } = require(
  "./adapters/v2-native-base-policy-tactical");
const { V2StrategicNavigationAdapter } = require("./adapters/v2-strategic-navigation");
const { V2PreemptiveSafetyShadowAdapter } =
  require("./adapters/v2-preemptive-safety");
const { V2StabilityShadowOwner, V2RescueStabilityShadowFinalAdapter,
  V2RescueStabilityFinalAdapter } =
  require("./adapters/v2-stability");
const { V1OwnershipTrace, OwnershipTraceComponent } = require("./ownership-trace");
const { NativeControlModeShadow } = require("./native-control-shadow");

class StructuredV1Controller {
  constructor(options = {}) {
    const frozen = options.source ? { source: options.source,
      sourceFile: options.sourceFile || "provided-v1.js",
      sha256: options.sourceSha256 || "UNBOUND" } :
      resolveFrozenV1(options.workspaceRoot);
    this.registry = options.registry || new ComponentRegistry();
    this.bridge = options.bridge || (options.enableV2Bridge || options.enableNativeControlShadow ?
      new V2BridgeKernel(options.bridgeOptions || {}) : null);
    this.nativeControlShadow = options.enableNativeControlShadow ?
      (options.nativeControlShadow || new NativeControlModeShadow()) : null;
    if (this.bridge && options.enableProposalVerification)
      this.bridge.engine.policy.proposalArbiter.configure(
        options.enableProposalGoalArbitration ? 1 : 0);
    if (this.bridge && options.installBridgeObservers !== false) {
      this.registry.replace(V3_SLOT.FRAME_PREPARE, new V2FramePrepareAdapter(this.bridge,
        V3_COMPONENT_MODE.SHADOW, this.nativeControlShadow));
      this.registry.replace(V3_SLOT.FINAL_ACTION_GATE, new V2FinalActionObserver(this.bridge));
      this.registry.replace(V3_SLOT.ACTION_EMIT, new V2ActionEmitAdapter(this.bridge));
    }
    if (this.bridge && options.rootContactMode !== undefined)
      this.registry.replace(V3_SLOT.TACTICAL_CONTACT, new V2TacticalContactAdapter(this.bridge,
        options.rootContactMode));
    const finalRescue = this.bridge && options.finalCommittedRescueMode !== undefined ?
      new V2CommittedEscapeOwner(this.bridge, options.finalCommittedRescueMode) : null;
    this.committedRescueShadow = this.bridge && options.finalCommittedRescueShadow ?
      new V2CommittedEscapeOwner(this.bridge, V3_COMPONENT_MODE.SHADOW) : null;
    if (this.committedRescueShadow)
      this.registry.replace(V3_SLOT.FINAL_ACTION_GATE,
        new V2CommittedRescueShadowAdapter(this.bridge, this.committedRescueShadow));
    this.committedRescueActive = this.bridge && options.finalCommittedRescueActive ?
      new V2CommittedEscapeOwner(this.bridge, V3_COMPONENT_MODE.ACTIVE) : null;
    if (this.committedRescueActive)
      this.registry.replace(V3_SLOT.FINAL_ACTION_GATE,
        new V2CommittedRescueFinalAdapter(this.bridge, this.committedRescueActive));
    if (this.bridge && options.hardFinalMode !== undefined)
      this.registry.replace(V3_SLOT.FINAL_ACTION_GATE, new V2HardFinalAdapter(this.bridge,
        options.hardFinalMode, { rescueOwner: finalRescue,
          commitSelectedTacticalPlans: options.commitSelectedTacticalPlans,
          executeOptionPolicyCertificate: options.executeOptionPolicyCertificate }));
    if (this.bridge && options.committedEscapeMode !== undefined)
      for (const component of committedEscapePorts(this.bridge, options.committedEscapeMode))
        this.registry.replace(component.slot, component);
    if (this.bridge && options.forcedWinMode !== undefined)
      this.registry.replace(V3_SLOT.TACTICAL_SEARCH, new V2ForcedWinAdapter(this.bridge,
        options.forcedWinMode, options.forcedWinOptions));
    if (this.bridge && options.combatAttackMode !== undefined)
      for (const component of combatAttackPorts(this.bridge, options.combatAttackMode))
        this.registry.replace(component.slot, component);
    this.preemptiveSafetyShadow = this.bridge && options.preemptiveSafetyMode !== undefined ?
      new V2PreemptiveSafetyShadowAdapter(this.bridge, options.preemptiveSafetyMode) : null;
    if (this.preemptiveSafetyShadow)
      this.registry.replace(V3_SLOT.PREEMPTIVE_SAFETY, this.preemptiveSafetyShadow);
    this.verifiedAttackOwner = this.bridge && options.verifiedAttackMode !== undefined ?
      new V2VerifiedAttackOwner(this.bridge, options.verifiedAttackOptions || {}) : null;
    this.orderedRescueAttack = null;
    if (this.verifiedAttackOwner) {
      const rescue = new V2CommittedEscapeOwner(this.bridge, V3_COMPONENT_MODE.ACTIVE);
      this.orderedRescueAttack = new V2OrderedRescueAttackFinalAdapter(this.bridge,
        rescue, this.verifiedAttackOwner, options.verifiedAttackMode);
      this.registry.replace(V3_SLOT.FINAL_ACTION_GATE, this.orderedRescueAttack);
    }
    this.stabilityShadow = null;
    this.orderedRescueStability = null;
    const stabilityMode = options.stabilityMode !== undefined ? options.stabilityMode :
      options.stabilityShadowMode;
    if (this.bridge && stabilityMode !== undefined) {
      const rescue = this.committedRescueActive ||
        new V2CommittedEscapeOwner(this.bridge, V3_COMPONENT_MODE.ACTIVE);
      this.committedRescueActive = rescue;
      this.stabilityShadow = new V2StabilityShadowOwner(this.bridge,
        options.stabilityOptions || {});
      this.orderedRescueStability = stabilityMode === V3_COMPONENT_MODE.ACTIVE ?
        new V2RescueStabilityFinalAdapter(this.bridge, this.stabilityShadow, rescue) :
        new V2RescueStabilityShadowFinalAdapter(this.bridge, this.stabilityShadow, rescue);
      this.registry.replace(V3_SLOT.FINAL_ACTION_GATE, this.orderedRescueStability);
    }
    this.tacticalCore = this.bridge && options.tacticalCoreMode !== undefined ?
      new V2TacticalCoreAdapter(this.bridge, options.tacticalCoreMode,
        options.tacticalCoreOptions) : null;
    if (this.bridge && options.nativeBasePolicyTacticalMode !== undefined) {
      if (this.tacticalCore) throw new Error("V3_TACTICAL_OWNER_CONFLICT");
      this.tacticalCore = new V2NativeBasePolicyTacticalAdapter(this.bridge,
        options.nativeBasePolicyTacticalMode,
        options.nativeBasePolicyTacticalOptions || {});
    }
    if (this.tacticalCore)
      this.registry.replace(V3_SLOT.TACTICAL_SEARCH, this.tacticalCore);
    if (this.bridge && options.strategicNavigationMode !== undefined)
      this.registry.replace(V3_SLOT.NAVIGATION, new V2StrategicNavigationAdapter(this.bridge,
        options.strategicNavigationMode, { commitPlans: options.commitStrategicPlans,
          id: options.strategicNavigationId,
          requireTacticalHandoff: options.requireTacticalHandoff,
          requireTacticalRecovery: options.requireTacticalRecovery,
          requireRecoveryPlanIdentity: options.requireRecoveryPlanIdentity,
          recoveryVerificationDepth: options.recoveryVerificationDepth,
          recoveryVerificationNodeBudget: options.recoveryVerificationNodeBudget,
          allowRecoveryValueTie: options.allowRecoveryValueTie }));
    for (const replacement of options.replacements || [])
      this.registry.replace(replacement.slot, replacement);
    this.ownershipTrace = options.enableOwnershipTrace ?
      (options.ownershipTrace || new V1OwnershipTrace()) : null;
    if (this.ownershipTrace) for (let slot = 0; slot < this.registry.components.length; slot += 1)
      this.registry.decorate(slot, inner => new OwnershipTraceComponent(slot, inner,
        this.ownershipTrace));
    this.runtime = new LegacyV1Runtime({ source: frozen.source,
      sourceIdentity: frozen.sha256, filename: frozen.sourceFile,
      contextName: options.contextName, registry: this.registry,
      console: options.console });
    this.source = frozen;
  }

  replace(slot, component) {
    this.registry.replace(slot, component);
    return this;
  }

  decide(me, enemy, game) {
    if (this.ownershipTrace) this.ownershipTrace.beginDecision(game?.frames ?? -1);
    try {
      return this.runtime.decide(me, enemy, game);
    } finally {
      if (this.ownershipTrace) this.ownershipTrace.finishDecision();
    }
  }

  summary() {
    return { sourceSha256: this.source.sha256, decisions: this.runtime.decisions,
      replacementMask: this.registry.replacementMask,
      ports: this.registry.describe(),
      bridge: this.bridge ? this.bridge.summary() : null,
      ownership: this.ownershipTrace ? this.ownershipTrace.summary() : null,
      nativeControlShadow: this.nativeControlShadow ? this.nativeControlShadow.summary() : null,
      committedRescueShadow: this.committedRescueShadow ?
        this.committedRescueShadow.summary() : this.committedRescueActive ?
          this.committedRescueActive.summary() : this.orderedRescueAttack ?
            this.orderedRescueAttack.rescueOwner.summary() : null,
      verifiedAttackShadow: this.verifiedAttackOwner ?
        this.verifiedAttackOwner.summary() : null,
      preemptiveSafetyShadow: this.preemptiveSafetyShadow ?
        this.preemptiveSafetyShadow.summary() : null,
      stabilityShadow: this.stabilityShadow ? this.stabilityShadow.summary() : null,
      tacticalCore: this.tacticalCore ? this.tacticalCore.summary() : null,
      orderedFinal: this.orderedRescueAttack ? this.orderedRescueAttack.summary() : null };
  }
}

module.exports = { StructuredV1Controller };
