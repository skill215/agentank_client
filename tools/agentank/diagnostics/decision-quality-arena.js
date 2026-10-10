#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { sha256Bytes, fingerprintObject } = require("../core/hash");

const ROOT_CAUSE = Object.freeze({
  NO_REGRET: "NO_REGRET",
  CANDIDATE_OPTION_COVERAGE_GAP: "CANDIDATE_OPTION_COVERAGE_GAP",
  CONTINUATION_POLICY_GAP: "CONTINUATION_POLICY_GAP",
  RISK_THRESHOLD_REMOVAL: "RISK_THRESHOLD_REMOVAL",
  RISK_PARETO_REMOVAL: "RISK_PARETO_REMOVAL",
  SEARCH_VALUE_INVERSION: "SEARCH_VALUE_INVERSION",
  VALUE_MODEL_INVERSION_NO_SEARCH: "VALUE_MODEL_INVERSION_NO_SEARCH",
  FINAL_ARBITRATION: "FINAL_ARBITRATION"
});

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function terminalUnits(terminal) {
  return terminal?.outcome === "V2_WIN" ? 2 :
    terminal?.outcome === "DRAW" ? 1 : 0;
}

function terminalStarDelta(terminal) {
  return (terminal?.candidateStars || 0) - (terminal?.controlStars || 0);
}

function matrixQuality(label, ownPolicy) {
  const cells = label?.responseMatrix?.cells?.filter(cell =>
    cell.ownPolicy === ownPolicy) || [];
  if (!cells.length) return null;
  let robustUnits = 3; let robustStarDelta = 32767;
  let totalUnits = 0; let totalStarDelta = 0;
  for (const cell of cells) {
    const units = terminalUnits(cell.terminal);
    const stars = terminalStarDelta(cell.terminal);
    totalUnits += units; totalStarDelta += stars;
    if (units < robustUnits ||
        (units === robustUnits && stars < robustStarDelta)) {
      robustUnits = units; robustStarDelta = stars;
    }
  }
  return { ownPolicy, cells: cells.length, robustUnits, robustStarDelta,
    totalUnits, totalStarDelta };
}

function qualityBetter(left, right, leftRow = 0, rightRow = 0) {
  if (!left) return false;
  if (!right) return true;
  for (const field of ["robustUnits", "robustStarDelta", "totalUnits",
    "totalStarDelta"])
    if (left[field] !== right[field]) return left[field] > right[field];
  return leftRow < rightRow;
}

function qualityStrictlyBetter(left, right) {
  if (!left) return false;
  if (!right) return true;
  for (const field of ["robustUnits", "robustStarDelta", "totalUnits",
    "totalStarDelta"])
    if (left[field] !== right[field]) return left[field] > right[field];
  return false;
}

function bestPolicyQuality(label) {
  let best = null;
  for (const policy of label?.responseMatrix?.policies || []) {
    const quality = matrixQuality(label, policy);
    if (qualityBetter(quality, best, label.row, label.row)) best = quality;
  }
  return best;
}

function labelFor(root, row) {
  return (root.labels || []).find(label => label.row === row) || null;
}

function bestLabel(root, qualityFor) {
  let best = null; let quality = null;
  for (const label of root.labels || []) {
    const candidate = qualityFor(label);
    if (qualityBetter(candidate, quality, label.row, best?.row ?? 32767)) {
      best = label; quality = candidate;
    }
  }
  return best ? { label: best, quality } : null;
}

function actionName(label) {
  if (!label?.action) return "NONE";
  return label.action.type === "turn" ?
    `turn:${label.action.side || "right"}` : String(label.action.type);
}

function classifyRoot(root, selected, selectedV2, samePolicyOracle,
    portfolioOracle) {
  if (!selected || !selectedV2 || !samePolicyOracle || !portfolioOracle)
    return ROOT_CAUSE.CANDIDATE_OPTION_COVERAGE_GAP;
  const firstActionRegret = qualityStrictlyBetter(samePolicyOracle.quality,
    selectedV2);
  if (!firstActionRegret) {
    if (qualityStrictlyBetter(portfolioOracle.quality, selectedV2))
      return ROOT_CAUSE.CONTINUATION_POLICY_GAP;
    if (selectedV2.robustUnits === 0)
      return ROOT_CAUSE.CANDIDATE_OPTION_COVERAGE_GAP;
    return ROOT_CAUSE.NO_REGRET;
  }
  const oracle = samePolicyOracle.label;
  if (!oracle.acceptable) return ROOT_CAUSE.RISK_THRESHOLD_REMOVAL;
  if (oracle.dominated) return ROOT_CAUSE.RISK_PARETO_REMOVAL;
  const selectedSearch = selected.searchMinimum ?? selected.robustLower;
  const oracleSearch = oracle.searchMinimum ?? oracle.robustLower;
  if (Number.isFinite(selectedSearch) && Number.isFinite(oracleSearch) &&
      selectedSearch > oracleSearch) return root.searchEvidence?.source ===
        "PHYSICAL" || root.searchEvidence?.source === "INFORMATION" ?
          ROOT_CAUSE.SEARCH_VALUE_INVERSION :
          ROOT_CAUSE.VALUE_MODEL_INVERSION_NO_SEARCH;
  return ROOT_CAUSE.FINAL_ARBITRATION;
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function compactQuality(value) {
  if (!value) return null;
  return { ownPolicy: value.ownPolicy, robustUnits: value.robustUnits,
    robustStarDelta: value.robustStarDelta, totalUnits: value.totalUnits,
    totalStarDelta: value.totalStarDelta };
}

function policyPrefixes(label, ownPolicy) {
  return (label?.responseMatrix?.cells || [])
    .filter(cell => cell.ownPolicy === ownPolicy)
    .map(cell => ({ enemyPolicy: cell.enemyPolicy,
      ownActionPrefix: cell.ownActionPrefix || [],
      enemyActionPrefix: cell.enemyActionPrefix || [],
      outcome: cell.terminal?.outcome || "UNKNOWN" }));
}

function analyze(document, sampleLimit = 32) {
  const report = {
    schemaVersion: 1,
    objectKind: "DECISION_QUALITY_ARENA_REPORT_V1",
    inputFingerprint: document.fingerprint || "",
    supportKind: document.supportKind || "UNKNOWN",
    responsePolicies: document.responsePolicies || [],
    matches: 0,
    roots: 0,
    labels: 0,
    completeMatrixRoots: 0,
    incompleteMatrixRoots: 0,
    selectedSamePolicyOracle: 0,
    selectedPortfolioOracle: 0,
    firstActionRegretRoots: 0,
    continuationRegretRoots: 0,
    robustRegretUnits: 0,
    expectedRegretUnits: 0,
    causes: {},
    causesByDepth: {},
    causesByStratum: {},
    actionTransitions: {},
    samples: [],
    fingerprint: ""
  };
  for (const match of document.matches || []) {
    report.matches += 1;
    for (const root of match.roots || []) {
      report.roots += 1; report.labels += root.labels?.length || 0;
      const selected = labelFor(root, root.selectedRow);
      const selectedV2 = matrixQuality(selected, "V2");
      const samePolicyOracle = bestLabel(root, label => matrixQuality(label, "V2"));
      const portfolioOracle = bestLabel(root, bestPolicyQuality);
      const expectedCells = Math.max(1,
        (document.ownResponsePolicies?.length ||
          document.responsePolicies?.length || 0) *
        (document.enemyResponsePolicies?.length ||
          document.responsePolicies?.length || 0) *
        (document.chanceOutcomes?.length || 1));
      const complete = Boolean(selectedV2 && samePolicyOracle && portfolioOracle &&
        (root.labels || []).every(label =>
          label.responseMatrix?.cells?.length === expectedCells));
      if (complete) report.completeMatrixRoots += 1;
      else report.incompleteMatrixRoots += 1;
      const cause = classifyRoot(root, selected, selectedV2, samePolicyOracle,
        portfolioOracle);
      increment(report.causes, cause);
      const depth = root.searchEvidence?.source === "INFORMATION" ?
        `I${root.searchEvidence?.information?.completedDepth || 0}` :
        root.searchEvidence?.source === "PHYSICAL" ?
          `P${root.searchEvidence?.physical?.completedDepth || 0}` : "NONE";
      if (!report.causesByDepth[depth]) report.causesByDepth[depth] = {};
      increment(report.causesByDepth[depth], cause);
      const stratum = root.samplingStratum || "UNCLASSIFIED";
      if (!report.causesByStratum[stratum]) report.causesByStratum[stratum] = {};
      increment(report.causesByStratum[stratum], cause);
      if (samePolicyOracle?.label.row === selected?.row)
        report.selectedSamePolicyOracle += 1;
      if (portfolioOracle?.label.row === selected?.row &&
          portfolioOracle?.quality.ownPolicy === "V2")
        report.selectedPortfolioOracle += 1;
      const firstRegret = selectedV2 && samePolicyOracle &&
        qualityStrictlyBetter(samePolicyOracle.quality, selectedV2);
      const portfolioRegret = selectedV2 && portfolioOracle &&
        qualityStrictlyBetter(portfolioOracle.quality, selectedV2);
      if (firstRegret) {
        report.firstActionRegretRoots += 1;
        report.robustRegretUnits += Math.max(0,
          samePolicyOracle.quality.robustUnits - selectedV2.robustUnits);
        report.expectedRegretUnits += Math.max(0,
          samePolicyOracle.quality.totalUnits - selectedV2.totalUnits);
        increment(report.actionTransitions,
          `${actionName(selected)}>${actionName(samePolicyOracle.label)}`);
      }
      if (portfolioRegret) report.continuationRegretRoots += 1;
      if (cause !== ROOT_CAUSE.NO_REGRET &&
          report.samples.length < sampleLimit) report.samples.push({
        matchUrlId: match.matchUrlId || "UNKNOWN",
        scenarioFingerprint: match.scenarioFingerprint || "UNKNOWN",
        candidateSeat: Number.isSafeInteger(match.candidateSeat) ?
          match.candidateSeat : -1,
        frame: Number.isSafeInteger(root.frame) ? root.frame : -1,
        depth,
        stratum,
        cause,
        selected: { row: selected?.row ?? -1, action: selected?.action || null,
          acceptable: selected?.acceptable ?? null,
          dominated: selected?.dominated ?? null,
          searchMinimum: selected?.searchMinimum ?? null,
          robustLower: selected?.robustLower ?? null,
          quality: compactQuality(selectedV2) },
        samePolicyOracle: samePolicyOracle ? {
          row: samePolicyOracle.label.row,
          action: samePolicyOracle.label.action,
          acceptable: samePolicyOracle.label.acceptable,
          dominated: samePolicyOracle.label.dominated,
          searchMinimum: samePolicyOracle.label.searchMinimum,
          robustLower: samePolicyOracle.label.robustLower,
          quality: compactQuality(samePolicyOracle.quality)
        } : null,
        portfolioOracle: portfolioOracle ? {
          row: portfolioOracle.label.row,
          action: portfolioOracle.label.action,
          quality: compactQuality(portfolioOracle.quality),
          prefixes: policyPrefixes(portfolioOracle.label,
            portfolioOracle.quality.ownPolicy)
        } : null
      });
    }
  }
  report.samePolicyRecallBasisPoints = Math.round(
    report.selectedSamePolicyOracle * 10000 / Math.max(1, report.roots));
  report.portfolioRecallBasisPoints = Math.round(
    report.selectedPortfolioOracle * 10000 / Math.max(1, report.roots));
  report.fingerprint = fingerprintObject({ ...report, fingerprint: "" });
  return report;
}

function filesUnder(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...filesUnder(file));
    else if (entry.isFile()) output.push(file);
  }
  return output;
}

function treeIdentity(root, relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  const files = filesUnder(directory).sort();
  const entries = files.map(file => ({
    path: path.relative(root, file).split(path.sep).join("/"),
    sha256: sha256Bytes(fs.readFileSync(file))
  }));
  return { relativeDirectory, fileCount: entries.length,
    fingerprint: fingerprintObject({ entries }) };
}

function freeze(root = defaultWorkspaceRoot()) {
  const manifest = {
    schemaVersion: 1,
    objectKind: "DECISION_QUALITY_BASELINE_V1",
    productionBehaviorChanged: false,
    engine: treeIdentity(root, "engine-v2/src"),
    v1Sha256: sha256Bytes(fs.readFileSync(path.join(root,
      "tiny-tank-minimax.js"))),
    cohortSha256: sha256Bytes(fs.readFileSync(path.join(root,
      "config/engine-v3/v3-repair-cohort.json"))),
    criticalFiles: ["engine-v2/src/runtime/production-root.js",
      "engine-v2/src/search/production-depth-search.js"].map(relative => ({
        path: relative,
        sha256: sha256Bytes(fs.readFileSync(path.join(root, relative)))
      })),
    fingerprint: ""
  };
  manifest.fingerprint = fingerprintObject({ ...manifest, fingerprint: "" });
  return manifest;
}

function run() {
  const command = (process.argv[2] || "report").toLowerCase();
  const root = path.resolve(option("--root", defaultWorkspaceRoot()));
  const outputFile = path.resolve(option("--output", command === "freeze" ?
    "/tmp/agentank-decision-quality-baseline.json" :
    "/tmp/agentank-decision-quality-report.json"));
  let output;
  if (command === "freeze") output = freeze(root);
  else if (command === "verify") {
    const input = JSON.parse(fs.readFileSync(path.resolve(option("--input",
      outputFile)), "utf8"));
    const current = freeze(root);
    if (input.fingerprint !== current.fingerprint)
      throw new Error(`DECISION_QUALITY_BASELINE_DRIFT:${input.fingerprint}:` +
        current.fingerprint);
    output = { verified: true, fingerprint: current.fingerprint };
  } else {
    const inputFile = path.resolve(option("--input",
      "/tmp/agentank-decision-quality-labels.json"));
    output = analyze(JSON.parse(fs.readFileSync(inputFile, "utf8")),
      Number(option("--sample-limit", "32")) || 32);
  }
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputFile,
    fingerprint: output.fingerprint || "", roots: output.roots,
    causes: output.causes }, null, 2)}\n`);
  return output;
}

if (require.main === module) {
  try { run(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { ROOT_CAUSE, terminalUnits, terminalStarDelta,
  matrixQuality, qualityBetter, qualityStrictlyBetter, bestPolicyQuality,
  bestLabel, classifyRoot, policyPrefixes,
  analyze, treeIdentity, freeze, run };
