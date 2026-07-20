"use strict";

const policy = require("../../engine-v2/src/policy");
const imp4 = require("../imp4/helpers");

function populatedFeatureInput() {
  const input = new policy.FeatureInputFrame();
  for (let index = 0; index < policy.FEATURE_INPUT.COUNT; index += 1)
    input.set(index, index === policy.FEATURE_INPUT.STAR_DELTA ||
      index === policy.FEATURE_INPUT.STAR_RACE ? index * 400 - 2000 : (index * 431) % 10001);
  return input;
}

module.exports = { policy, ...imp4, populatedFeatureInput };
