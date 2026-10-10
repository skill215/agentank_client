"use strict";

// Generated closed BP68 assembly. Do not edit by hand.
const { NativeBasePolicyActionOwner } = require("./action-owner");
const { NativeBasePolicyActionDomain } = require("./action-domain");
const { NativeBasePolicyStrategicIntent } = require("./strategic-intent");
const { NativeBasePolicyOpponentHistory } = require("./opponent-history");
const { NativeBasePolicySearch } = require("./policy-search");
const { NativeBasePolicyLeafEvaluator } = require("./policy-leaf");
const { NativeBasePolicyPathUtility } = require("./path-utility");

class NativeBasePolicyRoot {
  constructor() {
    this.domain = new NativeBasePolicyActionDomain();
    this.intent = new NativeBasePolicyStrategicIntent();
    this.opponentHistory = new NativeBasePolicyOpponentHistory();
    this.leafEvaluator = new NativeBasePolicyLeafEvaluator();
    this.pathUtility = new NativeBasePolicyPathUtility(this.leafEvaluator);
    this.policySearch = new NativeBasePolicySearch({
      deepFireDomain: this.domain,
      leafEvaluator: this.leafEvaluator,
      pathUtility: this.pathUtility
    });
    this.owner = new NativeBasePolicyActionOwner({
      domain: this.domain,
      intent: this.intent,
      policySearch: this.policySearch,
      opponentHistory: this.opponentHistory
    });
  }
  selectOverride(engine, selected, incumbentAction) {
    this.opponentHistory.observe(engine);
    this.policySearch.setOracleOpponentContext(
      this.opponentHistory.contextView());
    return this.owner.selectOverride(engine, selected, incumbentAction);
  }
}

module.exports = { NativeBasePolicyRoot };
