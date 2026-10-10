#!/usr/bin/env node
"use strict";

// Compares NativeBasePolicy ownership with frozen V1's staged decision on the
// same observed root.  V1 is an off-policy label here: its action is not
// executed and this report makes no counterfactual outcome claim.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ACTION_NAMES = ["NONE", "GO", "TURN_LEFT", "TURN_RIGHT", "FIRE", "BOMB",
  "SHIELD", "FREEZE", "STUN", "OVERLOAD", "CLOAK", "POISON", "TELEPORT",
  "BOOST", "BOOST_LEFT_GO", "BOOST_LEFT_TURN_LEFT", "BOOST_LEFT_TURN_RIGHT",
  "BOOST_LEFT_FIRE", "BOOST_LEFT_BOMB", "BOOST_RIGHT_GO",
  "BOOST_RIGHT_TURN_LEFT", "BOOST_RIGHT_TURN_RIGHT", "BOOST_RIGHT_FIRE",
  "BOOST_RIGHT_BOMB"];
const CONTROL_NAMES = ["NONE", "COMMITTED_ESCAPE", "TACTICAL_CONTACT",
  "STRATEGIC_NAVIGATION"];

function bump(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function rowFor(root, row) {
  return row >= 0 ? root.candidates.find(item => item.row === row) || null : null;
}

function actionName(action) {
  return ACTION_NAMES[action] || `ACTION_${action}`;
}

function rootsFrom(directory) {
  const file = path.join(directory, "matches.ndjson.gz");
  return zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").trim().split("\n")
    .filter(Boolean).map(line => JSON.parse(line));
}

function freshBucket() {
  return { roots: 0, agreement: 0, disagreement: 0, proposals: 0,
    proposalSelected: 0, completeProposals: 0, incompleteProposals: 0,
    changedAwayFromV1: 0, changedTowardV1: 0, v1MatchesIncumbent: 0,
    v1MatchesProposal: 0, v1MatchesNeither: 0, v1CandidatePresent: 0,
    v1HardAllowed: 0, v1RiskAcceptable: 0, v1OwnerAllowed: 0,
    selectedActions: {}, v1Actions: {}, confusion: {}, exactBlocks: {} };
}

function record(bucket, root) {
  const v1 = root.v1Shadow;
  if (!v1) return;
  const selected = rowFor(root, root.selected);
  const incumbent = rowFor(root, root.incumbent);
  const proposal = rowFor(root, root.proposal);
  const v2Action = selected ? selected.action : 0;
  const incumbentAction = incumbent ? incumbent.action : 0;
  const proposalAction = proposal ? proposal.action : -1;
  const v1Action = v1.resolvedAction;
  const candidates = root.candidates.filter(item => item.action === v1Action);
  bucket.roots += 1;
  bump(bucket.selectedActions, actionName(v2Action));
  bump(bucket.v1Actions, actionName(v1Action));
  bump(bucket.confusion, `${actionName(v1Action)}>${actionName(v2Action)}`);
  if (v1Action === v2Action) bucket.agreement += 1;
  else bucket.disagreement += 1;
  if (candidates.length) bucket.v1CandidatePresent += 1;
  if (candidates.some(item => item.hard === 0)) bucket.v1HardAllowed += 1;
  if (candidates.some(item => item.hard === 0 && item.acceptable))
    bucket.v1RiskAcceptable += 1;
  if (candidates.some(item => item.hard === 0 && item.basePolicyMembership === 5))
    bucket.v1OwnerAllowed += 1;
  if (!proposal) return;
  bucket.proposals += 1;
  if (root.selected === root.proposal) bucket.proposalSelected += 1;
  if (root.basePolicySupportComplete) bucket.completeProposals += 1;
  else bucket.incompleteProposals += 1;
  bump(bucket.exactBlocks, String(proposal.basePolicyExactBlock));
  if (v1Action === incumbentAction) bucket.v1MatchesIncumbent += 1;
  else if (v1Action === proposalAction) bucket.v1MatchesProposal += 1;
  else bucket.v1MatchesNeither += 1;
  if (incumbentAction === v1Action && proposalAction !== v1Action &&
      root.selected === root.proposal) bucket.changedAwayFromV1 += 1;
  if (incumbentAction !== v1Action && proposalAction === v1Action &&
      root.selected === root.proposal) bucket.changedTowardV1 += 1;
}

function analyze(label, directory) {
  const matches = rootsFrom(directory);
  const all = freshBucket();
  const stages = {};
  const controls = {};
  const outcomes = {};
  for (const match of matches) {
    const outcome = match.analysisOutcome || "UNKNOWN";
    if (!outcomes[outcome]) outcomes[outcome] = freshBucket();
    for (const root of match.candidateEngine.rootFrames || []) {
      if (!root.v1Shadow) continue;
      const stage = root.v1Shadow.stageName || `STAGE_${root.v1Shadow.stage}`;
      const control = CONTROL_NAMES[root.controlMode] || `CONTROL_${root.controlMode}`;
      if (!stages[stage]) stages[stage] = freshBucket();
      if (!controls[control]) controls[control] = freshBucket();
      record(all, root); record(stages[stage], root);
      record(controls[control], root); record(outcomes[outcome], root);
    }
  }
  return { label, directory, matches: matches.length, all, stages, controls, outcomes };
}

function run() {
  const outputAt = process.argv.indexOf("--output");
  const groups = [];
  for (let at = 2; at < process.argv.length; at += 1) {
    if (at === outputAt) { at += 1; continue; }
    if (!process.argv[at].startsWith("--")) groups.push(process.argv[at]);
  }
  if (!groups.length) throw new Error("V1_SHADOW_ANALYSIS_INPUT_REQUIRED");
  const reports = groups.map((value, index) => {
    const separator = value.indexOf("=");
    const label = separator > 0 ? value.slice(0, separator) : `group${index + 1}`;
    const directory = path.resolve(separator > 0 ? value.slice(separator + 1) : value);
    return analyze(label, directory);
  });
  const text = `${JSON.stringify({ objectKind:
    "NATIVE_BASE_POLICY_V1_SHADOW_ANALYSIS_V1", reports }, null, 2)}\n`;
  if (outputAt >= 0 && process.argv[outputAt + 1])
    fs.writeFileSync(path.resolve(process.argv[outputAt + 1]), text);
  process.stdout.write(text);
}

if (require.main === module) run();

module.exports = { analyze };
