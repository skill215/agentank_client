"use strict";

const { NativeBasePolicyEngine } = require("./native-base-policy-engine");

const engine = new NativeBasePolicyEngine();

function onIdle(me, enemy, game) { return engine.decide(me, enemy, game); }

function runProductionFixture(seed = 1) {
  const result = new Int32Array(4);
  result[0] = seed | 0;
  result[1] = engine.basePolicy.policySearch.currentDepth;
  result[2] = engine.basePolicy.policySearch.rootScore.length;
  result[3] = engine.riskController.outcome.acceptable.length;
  return result;
}

module.exports = { onIdle, runProductionFixture };
