"use strict";

const { NativeLongOptionResponseMassPoc, MASS_INDEX, bitMass } = require(
  "./native-long-option-response-mass-poc");
const { NativeTacticalIntentPoc, NativeAttackPoseFeedbackSearchPoc } = require(
  "./native-tactical-domain-evaluator-poc");
const { POLICY_ID, NativeDualPolicyContinuationPoc,
  NativeBasePolicyContinuationPoc } = require(
  "./native-dual-policy-continuation-poc");
const { LONG_EVENT_OUTCOME } = require("./native-long-option-event-envelope-poc");

class NativeDualPolicyResponseMassPoc extends NativeLongOptionResponseMassPoc {
  constructor(mode = "shadow", options = {}) {
    super(mode === "off" ? "off" : "shadow", options);
    this.mode = mode === "shadow" ? "shadow" : "off";
    this.basePolicyId = POLICY_ID.BASE;
    this.candidatePolicyId = POLICY_ID.ATTACK_POSE;
    this.baseIntent = options.baseIntent || new NativeTacticalIntentPoc(150, {
      mappingMode: "v1-action", continuityMode: "off",
      classificationMode: "v1-exact"
    });
    this.basePolicy = options.basePolicy || null;
    this.attackPolicy = options.attackPolicy || this.feedback ||
      new NativeAttackPoseFeedbackSearchPoc({ forcePolicy: true });
    this.dualPolicy = null;
  }

  massForMask(mask, dimension) {
    // BP30 benefit is a real terminal win only. FIRE remains its own event
    // dimension and can never make a continuation dominate by itself.
    if (dimension === MASS_INDEX.SUCCESS)
      return mask & LONG_EVENT_OUTCOME.WIN ? 10000 : 0;
    return bitMass(mask, dimension);
  }

  routeOwnAction(state) {
    if (!this.dualPolicy) return 0;
    const action = this.dualPolicy.routeAction(state, this.currentPolicyId);
    return action < 0 ? 0 : action;
  }

  observe(engine, search, incumbentAction, incumbentArgument) {
    if (!this.basePolicy)
      this.basePolicy = new NativeBasePolicyContinuationPoc(engine,
        this.baseIntent);
    else this.basePolicy.engine = engine;
    if (!this.dualPolicy)
      this.dualPolicy = new NativeDualPolicyContinuationPoc(this.basePolicy,
        this.attackPolicy);
    return super.observe(engine, search, incumbentAction, incumbentArgument);
  }

  summary() {
    const summary = super.summary();
    const names = summary.massDimensionNames.slice();
    names[MASS_INDEX.SUCCESS] = "TERMINAL_BENEFIT";
    return { ...summary, semantics: "DUAL_POLICY_RESPONSE_MASS",
      massDimensionNames: names,
      fireIsBenefit: false,
      basePolicyRouteCount: this.basePolicy?.routeCount || 0,
      basePolicyIncompleteCount: this.basePolicy?.incompleteCount || 0,
      attackPolicyRouteCount:
        this.dualPolicy?.routeCount[POLICY_ID.ATTACK_POSE] || 0,
      policyTtIdentity: true };
  }
}

module.exports = { NativeDualPolicyResponseMassPoc };
