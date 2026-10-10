#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { fingerprintObject } = require("../core/hash");

const LOSS_STAGE = Object.freeze({
  RISK_THRESHOLD: "RISK_THRESHOLD",
  RISK_PARETO: "RISK_PARETO",
  POST_FRONTIER_OWNER: "POST_FRONTIER_OWNER"
});

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function terminalRank(terminal) {
  return terminal?.outcome === "V2_WIN" ? 2 :
    terminal?.outcome === "DRAW" ? 1 : 0;
}

function starDelta(terminal) {
  return (terminal?.candidateStars || 0) - (terminal?.controlStars || 0);
}

function terminalBetter(left, right) {
  const leftRank = terminalRank(left);
  const rightRank = terminalRank(right);
  if (leftRank !== rightRank) return leftRank > rightRank;
  return starDelta(left) > starDelta(right);
}

function bestLabel(labels) {
  let best = null;
  for (const label of labels || []) {
    if (!best || terminalBetter(label.terminal, best.terminal) ||
        (!terminalBetter(best.terminal, label.terminal) &&
         !terminalBetter(label.terminal, best.terminal) &&
         label.row < best.row))
      best = label;
  }
  return best;
}

function lossStage(label) {
  if (!label.acceptable) return LOSS_STAGE.RISK_THRESHOLD;
  if (label.dominated) return LOSS_STAGE.RISK_PARETO;
  return LOSS_STAGE.POST_FRONTIER_OWNER;
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function actionName(label) {
  if (!label?.action) return "NONE";
  if (label.action.type !== "turn") return String(label.action.type);
  return `${label.action.type}:${label.action.side}`;
}

function candidateEvidence(label) {
  return {
    row: label.row,
    action: label.action,
    terminal: label.terminal,
    acceptable: label.acceptable,
    dominated: label.dominated,
    projectedCell: label.projectedCell,
    projectedDirection: label.projectedDirection,
    projectedStarDistance: label.projectedStarDistance,
    horizonFatalMass: label.horizonFatalMass,
    earliestFatalFrame: label.earliestFatalFrame,
    escapeSlack: label.escapeSlack,
    robustLower: label.robustLower,
    expectedValue: label.expectedValue,
    tacticalValue: label.tacticalValue,
    searchMinimum: label.searchMinimum,
    searchMaximum: label.searchMaximum,
    policyProbability: label.policyProbability,
    strategyPurpose: label.strategyPurpose,
    strategySelected: label.strategySelected,
    strategyBand: label.strategyBand,
    strategyOwner: label.strategyOwner,
    combatPurpose: label.combatPurpose,
    combatPressure: label.combatPressure,
    purposeCompleteness: label.purposeCompleteness,
    ownCounterExposure: label.ownCounterExposure,
    postFireEscape: label.postFireEscape,
    possibleHit: label.possibleHit,
    plan: label.plan
  };
}

function summarize(document, sampleLimit = 32) {
  const summary = {
    physicalMatches: document.physicalMatches || 0,
    roots: 0,
    labels: 0,
    rootsWithOutcomeBetterAction: 0,
    rootsWithStarOnlyBetterAction: 0,
    selectedOutcomeCounts: {},
    bestOutcomeCounts: {},
    lossStageCounts: {},
    outcomeLossStageCounts: {},
    starOnlyLossStageCounts: {},
    selectedActionCounts: {},
    betterActionCounts: {},
    modelInversionCounts: {
      robustLower: 0,
      expectedValue: 0,
      tacticalValue: 0,
      horizonFatalMass: 0,
      escapeSlack: 0
    },
    samples: []
  };
  for (const match of document.matches || []) {
    for (const root of match.roots || []) {
      summary.roots += 1;
      summary.labels += root.labels?.length || 0;
      const selected = (root.labels || []).find(label =>
        label.row === root.selectedRow);
      if (!selected) continue;
      const best = bestLabel(root.labels);
      increment(summary.selectedOutcomeCounts, selected.terminal.outcome);
      increment(summary.bestOutcomeCounts, best.terminal.outcome);
      increment(summary.selectedActionCounts, actionName(selected));
      const rankImproved =
        terminalRank(best.terminal) > terminalRank(selected.terminal);
      const starOnlyImproved = !rankImproved &&
        starDelta(best.terminal) > starDelta(selected.terminal);
      if (!rankImproved && !starOnlyImproved) continue;
      if (rankImproved) summary.rootsWithOutcomeBetterAction += 1;
      else summary.rootsWithStarOnlyBetterAction += 1;
      const stage = lossStage(best);
      increment(summary.lossStageCounts, stage);
      increment(rankImproved ? summary.outcomeLossStageCounts :
        summary.starOnlyLossStageCounts, stage);
      increment(summary.betterActionCounts, actionName(best));
      if (selected.robustLower > best.robustLower)
        summary.modelInversionCounts.robustLower += 1;
      if (selected.expectedValue > best.expectedValue)
        summary.modelInversionCounts.expectedValue += 1;
      if (selected.tacticalValue > best.tacticalValue)
        summary.modelInversionCounts.tacticalValue += 1;
      if (selected.horizonFatalMass < best.horizonFatalMass)
        summary.modelInversionCounts.horizonFatalMass += 1;
      if (selected.escapeSlack > best.escapeSlack)
        summary.modelInversionCounts.escapeSlack += 1;
      if (summary.samples.length < sampleLimit) summary.samples.push({
        matchUrlId: match.matchUrlId,
        candidateSeat: match.candidateSeat,
        frame: root.frame,
        stage,
        rootEvidence: {
          controlMode: root.controlMode,
          runtimeMode: root.searchEvidence?.runtimeMode,
          searchSource: root.searchEvidence?.source,
          physicalDepth: root.searchEvidence?.physical?.completedDepth,
          informationDepth: root.searchEvidence?.information?.completedDepth,
          strategyId: root.searchEvidence?.strategyId,
          selectedStrategyBand: root.searchEvidence?.selectedStrategyBand,
          strategyBaseAnchorRow: root.searchEvidence?.strategyBaseAnchorRow
        },
        selected: candidateEvidence(selected),
        better: candidateEvidence(best)
      });
    }
  }
  return summary;
}

function run() {
  const inputFile = path.resolve(option("--input",
    "/tmp/agentank-root-counterfactual-labels.json"));
  const outputFile = path.resolve(option("--output",
    "/tmp/agentank-root-counterfactual-report.json"));
  const document = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  const report = {
    schemaVersion: 1,
    objectKind: "ROOT_COUNTERFACTUAL_CAUSAL_REPORT_V1",
    inputFile,
    inputFingerprint: document.fingerprint || "",
    summary: summarize(document),
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject({ ...report, fingerprint: "" });
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  LOSS_STAGE,
  terminalRank,
  starDelta,
  terminalBetter,
  bestLabel,
  lossStage,
  summarize,
  run
};
