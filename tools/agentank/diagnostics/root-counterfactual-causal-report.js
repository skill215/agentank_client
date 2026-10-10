#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { fingerprintObject } = require("../core/hash");

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function outcomeUnits(terminal) {
  return terminal?.outcome === "V2_WIN" ? 2 :
    terminal?.outcome === "DRAW" ? 1 : 0;
}

function terminalBetter(left, right) {
  if (!right) return true;
  const leftUnits = outcomeUnits(left.terminal);
  const rightUnits = outcomeUnits(right.terminal);
  if (leftUnits !== rightUnits) return leftUnits > rightUnits;
  const leftStars = (left.terminal?.candidateStars || 0) -
    (left.terminal?.controlStars || 0);
  const rightStars = (right.terminal?.candidateStars || 0) -
    (right.terminal?.controlStars || 0);
  if (leftStars !== rightStars) return leftStars > rightStars;
  const leftCrash = (+Boolean(left.terminal?.controlCrashed)) -
    (+Boolean(left.terminal?.candidateCrashed));
  const rightCrash = (+Boolean(right.terminal?.controlCrashed)) -
    (+Boolean(right.terminal?.candidateCrashed));
  if (leftCrash !== rightCrash) return leftCrash > rightCrash;
  return left.row < right.row;
}

function actionName(label) {
  if (!label?.action) return "UNKNOWN";
  return `${label.action.type || "UNKNOWN"}${label.action.side ?
    `:${label.action.side}` : ""}`;
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function analyze(documents, inputFiles = []) {
  const frames = new Map(); const earliest = [];
  const transitions = {}; const sources = {}; const controlModes = {};
  let matches = 0; let roots = 0; let labels = 0; let recoverableRoots = 0;
  let scoreInversionCount = 0; let selectedReproductionMismatchCount = 0;
  const seenMatches = new Set();
  for (let documentIndex = 0; documentIndex < documents.length;
    documentIndex += 1) {
    const document = documents[documentIndex];
    selectedReproductionMismatchCount +=
      document.selectedReproductionMismatchCount || 0;
    for (const match of document.matches || []) {
      const matchKey = `${match.scenarioFingerprint || match.matchUrlId}:` +
        `${match.candidateSeat}`;
      if (seenMatches.has(matchKey))
        throw new Error(`ROOT_CAUSAL_DUPLICATE_MATCH:${matchKey}`);
      seenMatches.add(matchKey); matches += 1;
      let first = null;
      for (const root of match.roots || []) {
        roots += 1; labels += root.labels?.length || 0;
        const selected = root.labels?.find(label =>
          label.row === root.selectedRow);
        if (!selected) continue;
        let best = selected;
        for (const label of root.labels)
          if (terminalBetter(label, best)) best = label;
        let frame = frames.get(root.frame);
        if (!frame) {
          frame = { frame: root.frame, roots: 0, selectedUnits: 0,
            oracleUnits: 0, recoverableRoots: 0 };
          frames.set(root.frame, frame);
        }
        frame.roots += 1;
        frame.selectedUnits += outcomeUnits(selected.terminal);
        frame.oracleUnits += outcomeUnits(best.terminal);
        const delta = outcomeUnits(best.terminal) -
          outcomeUnits(selected.terminal);
        if (delta <= 0) continue;
        frame.recoverableRoots += 1; recoverableRoots += 1;
        const transition = `${actionName(selected)}>${actionName(best)}`;
        increment(transitions, transition);
        increment(sources, root.searchEvidence?.source || "UNKNOWN");
        increment(controlModes, String(root.controlMode));
        if ((best.expectedValue ?? -32001) <
            (selected.expectedValue ?? -32001)) scoreInversionCount += 1;
        if (!first) first = {
          frame: root.frame,
          transition,
          source: root.searchEvidence?.source || "UNKNOWN",
          controlMode: root.controlMode,
          distance: root.searchEvidence?.ownEnemyDistance,
          selectedExpected: selected.expectedValue,
          bestExpected: best.expectedValue,
          selectedOutcome: selected.terminal.outcome,
          bestOutcome: best.terminal.outcome
        };
      }
      earliest.push({ matchUrlId: match.matchUrlId,
        scenarioFingerprint: match.scenarioFingerprint,
        candidateSeat: match.candidateSeat,
        baselineOutcome: match.baseline?.outcome,
        firstRecoverable: first });
    }
  }
  const frameSummaries = Array.from(frames.values())
    .sort((left, right) => left.frame - right.frame)
    .map(frame => ({ ...frame,
      selectedScoreBasisPoints: Math.round(frame.selectedUnits * 5000 /
        Math.max(1, frame.roots)),
      oracleScoreBasisPoints: Math.round(frame.oracleUnits * 5000 /
        Math.max(1, frame.roots)) }));
  const output = {
    schemaVersion: 1,
    objectKind: "ROOT_COUNTERFACTUAL_CAUSAL_REPORT_V1",
    inputFiles,
    inputFingerprints: documents.map(value => value.fingerprint || ""),
    matches,
    roots,
    labels,
    selectedReproductionMismatchCount,
    recoverableRoots,
    earliestRecoverableMatches: earliest.filter(value =>
      value.firstRecoverable).length,
    scoreInversionCount,
    transitions,
    sources,
    controlModes,
    frameSummaries,
    earliest,
    fingerprint: ""
  };
  output.fingerprint = fingerprintObject({ ...output, fingerprint: "" });
  return output;
}

function run() {
  const inputFiles = option("--inputs", "").split(",")
    .map(value => path.resolve(value.trim())).filter(Boolean);
  if (!inputFiles.length) throw new Error("ROOT_CAUSAL_INPUT_REQUIRED");
  const documents = inputFiles.map(file => JSON.parse(fs.readFileSync(file,
    "utf8")));
  const report = analyze(documents, inputFiles);
  const outputFile = path.resolve(option("--output",
    "/tmp/agentank-root-counterfactual-causal-report.json"));
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputFile,
    matches: report.matches,
    roots: report.roots,
    recoverableRoots: report.recoverableRoots,
    earliestRecoverableMatches: report.earliestRecoverableMatches,
    scoreInversionCount: report.scoreInversionCount,
    fingerprint: report.fingerprint }, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try { run(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { outcomeUnits, terminalBetter, actionName, analyze, run };
