"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyChanceSupport,
  replayCertificate,
  replayPrefixIndex,
  selectReplayRoots,
  summarize
} = require(
  "../../tools/agentank/diagnostics/semantic-attack-chance-qualified-labels");

function qualification(qualified) {
  return { qualified, paired: {}, interval: {} };
}

test("BP128 comparison roots normalize to the replay certificate contract", () => {
  const comparison = { frame: 4, hashLo: 5, hashHi: 6,
    currentAction: 1, currentArgument: 65535,
    candidateAction: 3, candidateArgument: 65535 };
  assert.equal(replayCertificate({ key: "x", comparison }), comparison);
  assert.throws(() => replayCertificate({ key: "x", comparison: {
    ...comparison, hashLo: undefined
  }}), /BP140Q0_REPLAY_CERTIFICATE_FIELD:hashLo/);
});

test("chance labels require independent Discovery and Holdout support", () => {
  assert.equal(classifyChanceSupport(qualification(true), qualification(true),
    qualification(false), qualification(false), true), "ROBUST_CANDIDATE");
  assert.equal(classifyChanceSupport(qualification(false), qualification(false),
    qualification(true), qualification(true), true), "ROBUST_INCUMBENT");
  assert.equal(classifyChanceSupport(qualification(true), qualification(false),
    qualification(false), qualification(false), true), "MIXED");
  assert.equal(classifyChanceSupport(qualification(true), qualification(true),
    qualification(false), qualification(false), false), "INCOMPLETE");
});

test("replay root selection preserves label order independence", () => {
  const selected = selectReplayRoots([{ key: "a" }, { key: "b" }],
    [{ key: "b", outcomeRelation: "EQUAL" }]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].root.key, "b");
  assert.equal(selected[0].label.outcomeRelation, "EQUAL");
  assert.throws(() => selectReplayRoots([{ key: "a" }], [{ key: "b" }]),
    /BP140Q0_REPLAY_ROOT_MISSING/);
});

test("replay prefix index rejects incomplete comparison sources", () => {
  assert.throws(() => replayPrefixIndex([]),
    /BP140Q0_PREFIX_SOURCE_INCOMPLETE/);
});

test("summary cross-tabulates historical labels without promoting them", () => {
  const cell = { exact: true };
  const record = {
    cells: { incumbent: [cell], candidate: [cell] },
    classification: "MIXED",
    historicalLabel: "CANDIDATE_BETTER",
    candidate: { discovery: qualification(true),
      holdout: qualification(false) },
    incumbent: { discovery: qualification(false),
      holdout: qualification(false) }
  };
  const output = summarize([record]);
  assert.equal(output.classifications.MIXED, 1);
  assert.equal(output.historicalLabels.CANDIDATE_BETTER, 1);
  assert.equal(output.historicalLabelByClassification[
    "CANDIDATE_BETTER/MIXED"], 1);
  assert.equal(output.candidate.discoveryQualified, 1);
  assert.equal(output.candidate.bothQualified, 0);
});
