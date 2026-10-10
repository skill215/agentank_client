"use strict";

const codes = require("../abi/policy-codes");
const registry = require("./feature-registry");
const evaluator = require("./evaluator");
const strategy = require("./strategy-selector");
const strategyLayer = require("./strategy-layer");
const opponent = require("./opponent-model");
const skill = require("./skill-policy");
const plan = require("./plan");
const hidden = require("./hidden-risk");
const layer = require("./layer");

module.exports = { ...codes, ...registry, ...evaluator, ...strategy, ...strategyLayer,
  ...opponent, ...skill,
  ...plan, ...hidden, ...layer };
