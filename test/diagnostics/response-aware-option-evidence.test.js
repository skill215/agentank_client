"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { firstDivergence, rootOptionClass } =
  require("../../tools/agentank/diagnostics/response-aware-option-evidence");

test("response-aware option evidence finds the first policy divergence", () => {
  assert.equal(firstDivergence([1, 2, 3], [1, 4, 3]), 1);
  assert.equal(firstDivergence([1, 2], [1, 2]), -1);
  assert.equal(firstDivergence([1], [1, 2]), 1);
});

test("response-aware option classes preserve root ownership strata", () => {
  assert.equal(rootOptionClass({ samplingStratum: "COMMITTED_HAZARD" }),
    "COMMITTED_RESPONSE");
  assert.equal(rootOptionClass({ samplingStratum: "PHYSICAL_SEARCH" }),
    "SEARCH_CONTINUATION");
  assert.equal(rootOptionClass({ samplingStratum: "TACTICAL_CONTACT_NO_SEARCH" }),
    "TACTICAL_CONTACT_RESPONSE");
  assert.equal(rootOptionClass({ samplingStratum: "STRATEGIC_NAVIGATION" }),
    "STRATEGIC_RESPONSE");
});
