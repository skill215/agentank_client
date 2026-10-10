"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require(
  "../../tools/agentank/diagnostics/native-base-policy-root-action-counterfactual");
const { prefixMatches } = require(
  "../../tools/agentank/diagnostics/native-base-policy-root-action-counterfactual");
const { searchEntryReason } = require(
  "../../tools/agentank/diagnostics/native-base-policy-standalone-arena");
const { ROOT_CONTROL_MODE } = require("../../engine-v2/src/runtime/root-control-mode");

test("counterfactual requires both prefixes and sparse parameters", () => {
  const side = codes => ({ compactActionStream: Buffer.from(codes).toString("base64"),
    compactArguments: [] });
  const source = { candidate: side([1, 2, 3]), control: side([3, 2, 1]) };
  const branch = { candidate: side([1, 2, 4]), control: side([3, 2, 5]) };
  assert.equal(prefixMatches(source, branch, 2, 4), true);
  branch.control = side([1, 2, 5]);
  assert.equal(prefixMatches(source, branch, 2, 4), false);
  branch.control = side([3, 2, 5]);
  branch.control.compactArguments = [[1, 4, 5]];
  assert.equal(prefixMatches(source, branch, 2, 4), false);
  delete branch.control;
  assert.equal(prefixMatches(source, branch, 2, 4), false);
});

test("search skip labels distinguish visibility, contact and safety ownership", () => {
  const engine = { adapter: { enemyVisible: false } };
  assert.equal(searchEntryReason(engine), "ENEMY_NOT_VISIBLE");
  engine.adapter.enemyVisible = true;
  assert.equal(searchEntryReason(engine), "NON_CONTACT_MODE");
  engine.lastControlMode = ROOT_CONTROL_MODE.TACTICAL_CONTACT;
  engine.lastSelectionWasStrictRescue = true;
  assert.equal(searchEntryReason(engine), "STRICT_RESCUE_OWNER");
  engine.lastSelectionWasStrictRescue = false;
  engine.lastSelectionWasVerifiedDirectKill = true;
  assert.equal(searchEntryReason(engine), "DIRECT_KILL_OWNER");
});

function record(current, candidateValue, selectedValue) {
  return { root: { stage: "NAVIGATION", searchEvidenceCurrent: current },
    recoverable: true, labels: [{ prefixMatched: true, forceApplied: true }],
    selected: { action: 2, basePolicyValue: selectedValue, robust: 10, expected: 10 },
    oracle: { row: { action: 1, acceptable: 1, basePolicyMembership: 3,
      basePolicyValue: candidateValue, robust: 5, expected: 5 } } };
}

test("unsearched roots cannot produce search value or owner rejection evidence", () => {
  const result = summarize([record(false, -500, 500)]);
  assert.equal(result.recoverableRoots, 1);
  assert.equal(result.oracleOwnerRejected, 0);
  assert.equal(result.basePolicyValueInversion, 0);
  assert.equal(result.robustValueInversion, 1);
});

test("unassigned owner values are missing evidence, not zero scores", () => {
  const result = summarize([record(true, null, 500), record(true, -500, null)]);
  assert.equal(result.oracleOwnerRejected, 2);
  assert.equal(result.basePolicyValueInversion, 0);
});

test("current numeric search values still detect value inversion", () => {
  const result = summarize([record(true, -500, 500)]);
  assert.equal(result.basePolicyValueInversion, 1);
  assert.equal(result.comparableSearchValuePairs, 1);
});

test("terminal-quality recovery is distinct from outcome recovery", () => {
  const loss = record(false, null, null);
  loss.baselineOutcome = "V1_WIN";
  loss.oracle.terminal = { outcome: "V2_WIN" };
  const win = record(true, 1, 2);
  win.baselineOutcome = "V2_WIN";
  win.oracle.terminal = { outcome: "V2_WIN" };
  const result = summarize([loss, win]);
  assert.equal(result.recoverableRoots, 2);
  assert.equal(result.outcomeImprovedRoots, 1);
  assert.equal(result.outcomeImprovedSearchedRoots, 0);
  assert.equal(result.searchedRoots, 1);
});
