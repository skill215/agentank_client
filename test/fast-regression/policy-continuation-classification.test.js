"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { noMoreInformationRisk, strictlyLessInformationRisk } =
  require("../../tools/agentank/fast-regression/policy-continuation-analysis");
const { selectionBucket, SELECTION_BUCKET } =
  require("../../tools/agentank/fast-regression/dominated-rescue-analysis");

function risk(immediate, horizon, unknown = 1, earliest = 1, slack = -1) {
  return { immediateFatalMass: immediate, horizonFatalMass: horizon, unknownMass: unknown,
    earliestFatalFrame: earliest, escapeSlack: slack };
}

test("policy counterfactuals distinguish an information-state defect from hindsight", () => {
  const selected = risk(0, 1602, 1, 3);
  const safer = risk(0, 1335, 1, 3);
  assert.equal(noMoreInformationRisk(safer, selected), true);
  assert.equal(strictlyLessInformationRisk(safer, selected), true);

  const selected10c = risk(1603, 3569);
  const actualWorldGo10c = risk(1603, 3969);
  assert.equal(noMoreInformationRisk(actualWorldGo10c, selected10c), false,
    "a hindsight survivor with worse modeled support is epistemic ambiguity, not a Minimax defect");

  const selected7b = risk(1250, 3258);
  const actualWorldGo7b = risk(1805, 5265);
  assert.equal(strictlyLessInformationRisk(actualWorldGo7b, selected7b), false);
});

test("policy continuation targeting reuses the shared no-acceptable classification", () => {
  const frame = { frameClass: "AVOIDABLE_UNDER_FIXED_CONTINUATION", currentSelectedDies: true,
    branches: [{ replayable: true, acceptable: false,
      result: { branch: { v2Crashed: false } } }] };
  assert.equal(selectionBucket(frame), SELECTION_BUCKET.NO_ACCEPTABLE_RESCUE);
});
