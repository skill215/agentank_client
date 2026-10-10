#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { fingerprintObject } = require("../core/hash");
const { outcomeUnits, terminalBetter, actionName } =
  require("./root-counterfactual-causal-report");

const POLICY_ROWS = Object.freeze({
  CURRENT: root => root.selectedRow,
  VERIFIED_OPTION: root => {
    const current = labelFor(root, root.selectedRow);
    const candidate = labelFor(root, root.optionRollout?.combatRow ?? -1);
    if (!current || !candidate || candidate.row === current.row ||
        !candidate.acceptable || candidate.dominated ||
        !candidate.optionRollout?.physicalComplete ||
        !candidate.optionRollout?.rootRestored ||
        candidate.optionRollout?.hardFatal ||
        !(candidate.expectedValue > current.expectedValue) ||
        !(candidate.robustLower > current.robustLower)) return root.selectedRow;
    return candidate.row;
  },
  TRAJECTORY_VALUE_OPTION: root => {
    const current = labelFor(root, root.selectedRow);
    const candidate = labelFor(root, root.optionRollout?.combatRow ?? -1);
    if (!current || !candidate || candidate.row === current.row ||
        !candidate.optionRollout?.physicalComplete ||
        !candidate.optionRollout?.rootRestored ||
        candidate.optionRollout?.hardFatal ||
        !(candidate.expectedValue > current.expectedValue) ||
        !(candidate.robustLower > current.robustLower)) return root.selectedRow;
    return candidate.row;
  },
  BALANCED_OPTION: root => root.optionRollout?.balancedRow ?? -1,
  COMBAT_OPTION: root => root.optionRollout?.combatRow ?? -1,
  POSITION_OPTION: root => root.optionRollout?.positionRow ?? -1,
  RESOURCE_OPTION: root => root.optionRollout?.resourceRow ?? -1
});

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function increment(target, key) { target[key] = (target[key] || 0) + 1; }

function labelFor(root, row) {
  return row < 0 ? null : (root.labels || []).find(label => label.row === row) || null;
}

function newPolicySummary() {
  return { rootsAvailable: 0, rowDifferences: 0, outcomeImproved: 0,
    outcomeRegressed: 0, outcomeEqual: 0, exactUnits: 0, currentUnits: 0,
    netUnits: 0, starDeltaSum: 0, oracleAgreement: 0,
    physicalIncomplete: 0, rootRestoreFailures: 0, transitions: {} };
}

function terminalView(label, useOptionTerminal) {
  if (!label || !useOptionTerminal || !label.optionTerminal) return label;
  return { ...label, terminal: label.optionTerminal };
}

function exactStarDelta(label) {
  return (label?.terminal?.candidateStars || 0) -
    (label?.terminal?.controlStars || 0);
}

function terminalEquivalent(left, right) {
  return outcomeUnits(left?.terminal) === outcomeUnits(right?.terminal) &&
    exactStarDelta(left) === exactStarDelta(right) &&
    Boolean(left?.terminal?.candidateCrashed) ===
      Boolean(right?.terminal?.candidateCrashed) &&
    Boolean(left?.terminal?.controlCrashed) ===
      Boolean(right?.terminal?.controlCrashed);
}

function analyze(documents, inputFiles = []) {
  const policies = {};
  for (const name of Object.keys(POLICY_ROWS)) policies[name] = newPolicySummary();
  const seen = new Set(); const headToHead = { comparableRoots: 0,
    resourceBetter: 0, positionBetter: 0, equal: 0 };
  let matches = 0; let roots = 0; let labels = 0;
  let selectedReproductionMismatchCount = 0;
  for (const document of documents) {
    selectedReproductionMismatchCount +=
      document.selectedReproductionMismatchCount || 0;
    for (const match of document.matches || []) {
      const key = `${match.scenarioFingerprint || match.matchUrlId}:` +
        `${match.candidateSeat}`;
      if (seen.has(key)) throw new Error(`OPTION_CAUSAL_DUPLICATE_MATCH:${key}`);
      seen.add(key); matches += 1;
      for (const root of match.roots || []) {
        roots += 1; labels += root.labels?.length || 0;
        const current = labelFor(root, root.selectedRow);
        if (!current) continue;
        let oracle = current;
        for (const label of root.labels || [])
          if (terminalBetter(label, oracle)) oracle = label;
        for (const [name, rowFor] of Object.entries(POLICY_ROWS)) {
          const rawCandidate = labelFor(root, rowFor(root));
          if (!rawCandidate) continue;
          const gatedOption = name === "VERIFIED_OPTION" ||
            name === "TRAJECTORY_VALUE_OPTION";
          const candidate = terminalView(rawCandidate, name !== "CURRENT" &&
            (!gatedOption || rawCandidate.row !== current.row));
          const summary = policies[name]; summary.rootsAvailable += 1;
          const candidateUnits = outcomeUnits(candidate.terminal);
          const currentUnits = outcomeUnits(current.terminal);
          summary.exactUnits += candidateUnits; summary.currentUnits += currentUnits;
          summary.netUnits += candidateUnits - currentUnits;
          summary.starDeltaSum += exactStarDelta(candidate);
          if (candidate.row !== current.row) {
            summary.rowDifferences += 1;
            increment(summary.transitions,
              `${actionName(current)}>${actionName(candidate)}`);
          }
          if (candidateUnits > currentUnits) summary.outcomeImproved += 1;
          else if (candidateUnits < currentUnits) summary.outcomeRegressed += 1;
          else summary.outcomeEqual += 1;
          if (terminalEquivalent(candidate, oracle)) summary.oracleAgreement += 1;
          if (rawCandidate.optionRollout &&
              !rawCandidate.optionRollout.physicalComplete)
            summary.physicalIncomplete += 1;
          if (rawCandidate.optionRollout && !rawCandidate.optionRollout.rootRestored)
            summary.rootRestoreFailures += 1;
        }
        const position = terminalView(labelFor(root,
          root.optionRollout?.positionRow ?? -1), true);
        const resource = terminalView(labelFor(root,
          root.optionRollout?.resourceRow ?? -1), true);
        if (position && resource) {
          headToHead.comparableRoots += 1;
          if (terminalEquivalent(resource, position)) headToHead.equal += 1;
          else if (terminalBetter(resource, position)) headToHead.resourceBetter += 1;
          else if (terminalBetter(position, resource)) headToHead.positionBetter += 1;
        }
      }
    }
  }
  for (const summary of Object.values(policies)) {
    summary.scoreBasisPoints = Math.round(summary.exactUnits * 5000 /
      Math.max(1, summary.rootsAvailable));
    summary.currentScoreBasisPoints = Math.round(summary.currentUnits * 5000 /
      Math.max(1, summary.rootsAvailable));
    summary.oracleAgreementBasisPoints = Math.round(summary.oracleAgreement * 10000 /
      Math.max(1, summary.rootsAvailable));
  }
  const output = { schemaVersion: 1,
    objectKind: "STATEFUL_OPTION_CAUSAL_REPORT_V1", inputFiles,
    inputFingerprints: documents.map(value => value.fingerprint || ""),
    matches, roots, labels, selectedReproductionMismatchCount,
    policies, headToHead, fingerprint: "" };
  output.fingerprint = fingerprintObject({ ...output, fingerprint: "" });
  return output;
}

function run() {
  const inputFiles = option("--inputs", "").split(",")
    .map(value => path.resolve(value.trim())).filter(Boolean);
  if (!inputFiles.length) throw new Error("OPTION_CAUSAL_INPUT_REQUIRED");
  const documents = inputFiles.map(file => JSON.parse(fs.readFileSync(file,
    "utf8")));
  const report = analyze(documents, inputFiles);
  const outputFile = path.resolve(option("--output",
    "/tmp/agentank-stateful-option-causal-report.json"));
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputFile, matches: report.matches,
    roots: report.roots, policies: report.policies,
    headToHead: report.headToHead, fingerprint: report.fingerprint }, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try { run(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { POLICY_ROWS, labelFor, terminalView, terminalEquivalent,
  analyze, run };
