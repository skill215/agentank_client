"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { STRATEGY_PURPOSE } =
  require("../../engine-v2/src/abi/policy-codes");
const { bitCount, categoryMask, analyze } =
  require("../../tools/agentank/diagnostics/option-row-alias-census");

test("option alias census keeps independent purposes separate", () => {
  const mask = categoryMask({ strategyPurpose: STRATEGY_PURPOSE.AIM_SETUP |
    STRATEGY_PURPOSE.STAR_COLLECT | STRATEGY_PURPOSE.NEUTRAL_POSITION });
  assert.equal(bitCount(mask), 3);
});

test("option alias census links selected aliases to continuation regret", () => {
  const cells = (ownPolicy, outcome) => [{ ownPolicy, terminal: { outcome } }];
  const report = analyze({ fingerprint: "x", responsePolicies: ["V2", "V3"],
    matches: [{ roots: [{ selectedRow: 0, samplingStratum: "PHYSICAL_SEARCH",
      labels: [{ row: 0, action: { type: "turn" }, strategyPurpose:
        STRATEGY_PURPOSE.AIM_SETUP | STRATEGY_PURPOSE.STAR_COLLECT,
      responseMatrix: { cells: cells("V2", "V1_WIN") } },
      { row: 1, action: { type: "go" }, strategyPurpose:
        STRATEGY_PURPOSE.STAR_COLLECT, responseMatrix: { cells:
          cells("V3", "V2_WIN") } }] }] }] });
  assert.equal(report.rootsWithAliases, 1);
  assert.equal(report.selectedAliasRoots, 1);
  assert.equal(report.continuationRegretRoots, 1);
  assert.equal(report.continuationRegretWithSelectedAlias, 1);
});
