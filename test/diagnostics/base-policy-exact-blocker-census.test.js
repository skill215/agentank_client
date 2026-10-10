"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require(
  "../../tools/agentank/diagnostics/base-policy-exact-blocker-census");

function row(outcome, mask, ownerBlocked) {
  const masks = new Array(128).fill(0); masks[mask] = 1;
  return { analysisOutcome: outcome, candidate: {
    nativeTacticalActionOwner: {
      policySearchExactSupportBlockedCount: ownerBlocked,
      policySearch: {
        completeCount: 1,
        exactOwnershipRootCount: mask === 0 ? 1 : 0,
        exactBlockedRootCount: mask === 0 ? 0 : 1,
        budgetCompleteHeuristicRootCount: mask === 8 ? 1 : 0,
        depthOnlyHeuristicRootCount: mask === 8 ? 1 : 0,
        exactBlockMaskCount: masks,
        terminalCount: 2, depthLeafCount: mask & 8 ? 3 : 0,
        leafBudgetCount: mask & 1 ? 4 : 0
      }
    }
  } };
}

test("exact blocker census reconciles roots, owner blocks and reason overlap", () => {
  const value = summarize([row("V2_WIN", 0, 0),
    row("V1_WIN", 9, 1), row("DRAW", 8, 1)]);
  assert.equal(value.roots, 3);
  assert.equal(value.exactRoots, 1);
  assert.equal(value.blockedRoots, 2);
  assert.equal(value.ownerBlocked, 2);
  assert.equal(value.budgetDepth, 1);
  assert.equal(value.reasonCounts.BUDGET, 1);
  assert.equal(value.reasonCounts.DEPTH_LEAF, 2);
  assert.equal(value.depthOnly, 1);
  assert.equal(value.scoreBasisPoints, 5000);
  assert.equal(value.conclusion.widenFiniteDepthHeuristicOwnership, false);
});
