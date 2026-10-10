#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { fingerprintObject } = require("../core/hash");
const { ACTION_NAME } = require("../simulation/production-diagnostic-bot");
const { matrixQuality, qualityStrictlyBetter, bestPolicyQuality, bestLabel } =
  require("./decision-quality-arena");

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function labelFor(root, row) {
  return (root.labels || []).find(label => label.row === row) || null;
}

function actionName(code) { return ACTION_NAME[code] || `ACTION_${code}`; }

function rootOptionClass(root) {
  if (root.samplingStratum === "COMMITTED_HAZARD") return "COMMITTED_RESPONSE";
  if (root.samplingStratum === "PHYSICAL_SEARCH" ||
      root.samplingStratum === "INFORMATION_SEARCH") return "SEARCH_CONTINUATION";
  if (root.samplingStratum === "TACTICAL_CONTACT_NO_SEARCH")
    return "TACTICAL_CONTACT_RESPONSE";
  return "STRATEGIC_RESPONSE";
}

function firstDivergence(left = [], right = []) {
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1)
    if (left[index] !== right[index]) return index;
  return -1;
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function terminalUnits(terminal) {
  return terminal?.outcome === "V2_WIN" ? 2 :
    terminal?.outcome === "DRAW" ? 1 : 0;
}

function analyze(document, sampleLimit = 32) {
  const output = { schemaVersion: 1,
    objectKind: "RESPONSE_AWARE_OPTION_EVIDENCE_V1",
    inputFingerprint: document.fingerprint || "", roots: 0,
    continuationGapRoots: 0, v3PortfolioGapRoots: 0, comparableCells: 0,
    improvedCells: 0, regressedCells: 0, equalCells: 0,
    netCellUnits: 0, optionClasses: {}, candidateActions: {},
    firstDivergenceFrames: {}, firstDivergenceTransitions: {}, samples: [],
    fingerprint: "" };
  for (const match of document.matches || []) for (const root of match.roots || []) {
    output.roots += 1;
    const selected = labelFor(root, root.selectedRow);
    const selectedV2 = matrixQuality(selected, "V2");
    const portfolio = bestLabel(root, bestPolicyQuality);
    if (!selectedV2 || !portfolio ||
        !qualityStrictlyBetter(portfolio.quality, selectedV2)) continue;
    output.continuationGapRoots += 1;
    if (portfolio.quality.ownPolicy !== "V3") continue;
    output.v3PortfolioGapRoots += 1;
    const optionClass = rootOptionClass(root);
    increment(output.optionClasses, optionClass);
    increment(output.candidateActions, portfolio.label.action?.type || "NONE");
    const cells = portfolio.label.responseMatrix?.cells || [];
    const comparisons = [];
    for (const enemyPolicy of document.responsePolicies || []) {
      const v2 = cells.find(cell => cell.ownPolicy === "V2" &&
        cell.enemyPolicy === enemyPolicy);
      const v3 = cells.find(cell => cell.ownPolicy === "V3" &&
        cell.enemyPolicy === enemyPolicy);
      if (!v2 || !v3) continue;
      output.comparableCells += 1;
      const delta = terminalUnits(v3.terminal) - terminalUnits(v2.terminal);
      output.netCellUnits += delta;
      if (delta > 0) output.improvedCells += 1;
      else if (delta < 0) output.regressedCells += 1;
      else output.equalCells += 1;
      const at = firstDivergence(v2.ownActionPrefix, v3.ownActionPrefix);
      increment(output.firstDivergenceFrames, String(at));
      const transition = at < 0 ? "SAME_PREFIX" :
        `${actionName(v2.ownActionPrefix[at])}>${
          actionName(v3.ownActionPrefix[at])}`;
      increment(output.firstDivergenceTransitions, transition);
      comparisons.push({ enemyPolicy, deltaUnits: delta,
        firstDivergenceFrame: at, transition,
        v2Prefix: v2.ownActionPrefix || [], v3Prefix: v3.ownActionPrefix || [],
        v2Outcome: v2.terminal?.outcome, v3Outcome: v3.terminal?.outcome });
    }
    if (output.samples.length < sampleLimit) output.samples.push({
      matchUrlId: match.matchUrlId || "UNKNOWN", candidateSeat: match.candidateSeat,
      frame: root.frame, optionClass, selectedAction: selected?.action || null,
      optionAction: portfolio.label.action || null,
      optionQuality: portfolio.quality, comparisons
    });
  }
  output.fingerprint = fingerprintObject({ ...output, fingerprint: "" });
  return output;
}

function run() {
  const inputFile = path.resolve(option("--input",
    "/tmp/dqa-traced-labels.json"));
  const outputFile = path.resolve(option("--output",
    "/tmp/dqa-response-aware-option-evidence.json"));
  const report = analyze(JSON.parse(fs.readFileSync(inputFile, "utf8")));
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputFile,
    continuationGapRoots: report.continuationGapRoots,
    v3PortfolioGapRoots: report.v3PortfolioGapRoots,
    optionClasses: report.optionClasses,
    firstDivergenceTransitions: report.firstDivergenceTransitions,
    netCellUnits: report.netCellUnits,
    fingerprint: report.fingerprint }, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try { run(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { rootOptionClass, firstDivergence, analyze, run };
