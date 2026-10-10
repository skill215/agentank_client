"use strict";

// Production-shaped assembly of the validated BP68 base-policy stack.  The
// root owns no world state and allocates nothing per decision: every component
// reads the ProductionRootEngine's existing FastState and fixed slabs.

const { NativeBasePolicyActionOwner } = require("./action-owner");
const { NativeBasePolicyActionDomain } = require("./action-domain");
const { NativeBasePolicyStrategicIntent } = require("./strategic-intent");
const { NativeBasePolicyOpponentHistory } = require("./opponent-history");
const { NativeBasePolicySearch } = require("./policy-search");
const { NativeBasePolicyLeafEvaluator } = require("./policy-leaf");
const { NativeBasePolicyPathUtility } = require("./path-utility");

const NATIVE_BASE_POLICY_PROFILE = Object.freeze({
  id: "BP68_EXACT_NATIVE_CACHE2",
  targetDepth: 3,
  nodeBudget: 128,
  starFieldCacheEntries: 2,
  geometry: "table",
  riskFrontier: "joint",
  riskSoftBand: "intent-known",
  intentValue: "bonus"
});

class NativeBasePolicyRoot {
  constructor(options = {}) {
    const cacheEntries = Number.isSafeInteger(options.starFieldCacheEntries) ?
      options.starFieldCacheEntries : NATIVE_BASE_POLICY_PROFILE.starFieldCacheEntries;
    this.domain = options.domain || new NativeBasePolicyActionDomain();
    this.intent = options.intent || new NativeBasePolicyStrategicIntent(150);
    this.opponentHistory = options.opponentHistory ||
      new NativeBasePolicyOpponentHistory();
    this.leafEvaluator = options.leafEvaluator ||
      new NativeBasePolicyLeafEvaluator({
        discountSimulatedProjectiles: false,
        precomputeGeometry: options.precomputeGeometry !== false,
        starFieldCacheEntries: cacheEntries,
        clampLimit: 25000,
        clampMode: "total"
      });
    this.pathUtility = options.pathUtility ||
      new NativeBasePolicyPathUtility(this.leafEvaluator, {
        fire: true,
        bomb: true,
        turn: true,
        stun: true,
        exactFireTransition: true,
        responseConditionedFire: false,
        goEdgeTransition: true,
        rootTurnOnly: false,
        reversalOnly: false
      });
    this.policySearch = options.policySearch || new NativeBasePolicySearch({
      targetDepth: Number.isSafeInteger(options.targetDepth) ?
        options.targetDepth : NATIVE_BASE_POLICY_PROFILE.targetDepth,
      depthSchedule: "v1-state",
      nodeBudget: Number.isSafeInteger(options.nodeBudget) ?
        options.nodeBudget : NATIVE_BASE_POLICY_PROFILE.nodeBudget,
      blendBasisPoints: 2000,
      blendSchedule: "fixed",
      leadingBlendBasisPoints: 0,
      trailingBlendBasisPoints: 4000,
      fullPrimitiveDomain: true,
      deepFireMode: "v1-own",
      deepFireDomain: this.domain,
      deepSkillMode: "both",
      deepDomainMode: "v1-shaped",
      deepBombMode: "off",
      eventQuiescenceMode: "off",
      ownContinuationMode: "full",
      opponentMode: "v1-exact",
      v1StunCountdown: true,
      v1EntryProjectileCollision: true,
      deepHardMode: "full",
      rootDomainMode: "v1-shaped",
      rootExtraPoison: false,
      terminalMode: "v1",
      ownChanceMode: "v1-deterministic",
      rootEnemyDomainMode: "v1-shaped",
      rootColumnOrder: "v1",
      rootBudgetMode: options.rootBudgetMode === "cell-equal" ?
        "cell-equal" : "row-shared",
      pathEvidenceMode: "single",
      leafEvaluator: this.leafEvaluator,
      pathUtility: this.pathUtility,
      historyEvaluator: null,
      superkoMode: "v1",
      collectTerminalTrade: false
    });
    this.owner = options.owner || new NativeBasePolicyActionOwner({
      domain: this.domain,
      intent: this.intent,
      policySearch: this.policySearch,
      opponentHistory: this.opponentHistory,
      riskFrontierMode: NATIVE_BASE_POLICY_PROFILE.riskFrontier,
      riskSoftBandMode: NATIVE_BASE_POLICY_PROFILE.riskSoftBand,
      intentValueMode: NATIVE_BASE_POLICY_PROFILE.intentValue
    });
    this.selectCount = 0;
  }

  selectOverride(engine, selected, incumbentAction) {
    this.selectCount += 1;
    // BP159/BP160 established this exact order: the current observation first
    // updates the integer opponent history, then search consumes its stable
    // view.  Owner.observe() sees the same frame and is a deduplicated no-op.
    this.opponentHistory.observe(engine);
    this.policySearch.setOracleOpponentContext(
      this.opponentHistory.contextView());
    return this.owner.selectOverride(engine, selected, incumbentAction);
  }
}

module.exports = { NATIVE_BASE_POLICY_PROFILE, NativeBasePolicyRoot };
