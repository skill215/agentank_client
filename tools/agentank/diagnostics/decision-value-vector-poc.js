#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { fingerprintObject } = require("../core/hash");
const { matrixQuality, qualityStrictlyBetter } =
  require("./decision-quality-arena");

const PROFILE = Object.freeze({
  CURRENT: "CURRENT",
  FRONTIER_ROBUST: "FRONTIER_ROBUST",
  OPTION_BALANCED: "OPTION_BALANCED",
  RISK_COMBAT_LEX: "RISK_COMBAT_LEX"
});

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function number(value) { return Number.isFinite(value) ? value : 0; }

function vector(label, profile) {
  const o = label.optionRollout || {};
  if (profile === PROFILE.FRONTIER_ROBUST) return [
    number(label.robustLower), number(label.expectedValue),
    number(label.tacticalValue), -label.row
  ];
  if (profile === PROFILE.OPTION_BALANCED) return [
    +Boolean(o.physicalComplete), +Boolean(o.rootRestored),
    -Number(Boolean(o.hardFatal)), -Number(Boolean(o.ownCrashed)),
    +Boolean(o.enemyCrashed), number(o.terminalUtility), number(o.starGain),
    number(o.starDelta), +Boolean(o.projectileThreat),
    +Boolean(o.ownFireLane), -Number(Boolean(o.enemyFireLane)),
    number(o.objectiveProgress), number(o.mobility), -number(o.enemyMobility),
    number(o.enemyDebuffCount), -label.row
  ];
  if (profile === PROFILE.RISK_COMBAT_LEX) return [
    -number(label.immediateFatalMass), -number(label.horizonFatalMass),
    -number(label.unknownMass), -number(label.ownCounterExposure),
    number(label.postFireEscape), number(label.purposeCompleteness),
    +Boolean(label.possibleHit), +Boolean(label.projectedClearLineToEnemy),
    +Boolean(label.projectedOwnFacesEnemy), -number(label.enemySafeSuccessors),
    number(label.projectedMobility), number(label.projectedStarProgress),
    number(label.robustLower), -label.row
  ];
  return [-label.row];
}

function vectorBetter(left, right) {
  if (!right) return true;
  for (let index = 0; index < left.length; index += 1)
    if (left[index] !== right[index]) return left[index] > right[index];
  return false;
}

function eligible(root) {
  let rows = (root.labels || []).filter(label =>
    label.acceptable && !label.dominated);
  if (!rows.length) rows = (root.labels || []).filter(label => label.acceptable);
  return rows.length ? rows : (root.labels || []);
}

function select(root, profile) {
  if (profile === PROFILE.CURRENT)
    return (root.labels || []).find(label => label.row === root.selectedRow) || null;
  let best = null; let bestVector = null;
  for (const label of eligible(root)) {
    const candidate = vector(label, profile);
    if (vectorBetter(candidate, bestVector)) {
      best = label; bestVector = candidate;
    }
  }
  return best;
}

function actionName(label) {
  if (!label?.action) return "NONE";
  return label.action.type === "turn" ?
    `turn:${label.action.side || "right"}` : label.action.type;
}

function newSummary(profile) {
  return { profile, roots: 0, changedRoots: 0, improvedRoots: 0,
    regressedRoots: 0, equalRoots: 0, robustUnits: 0, totalUnits: 0,
    totalStarDelta: 0, scoreBasisPoints: 0, robustScoreBasisPoints: 0,
    actionCounts: {}, transitions: {} };
}

function increment(target, key) { target[key] = (target[key] || 0) + 1; }

function analyze(document) {
  const profiles = {};
  for (const profile of Object.values(PROFILE)) profiles[profile] = newSummary(profile);
  for (const match of document.matches || []) for (const root of match.roots || []) {
    const current = select(root, PROFILE.CURRENT);
    const currentQuality = matrixQuality(current, "V2");
    if (!current || !currentQuality) continue;
    for (const profile of Object.values(PROFILE)) {
      const candidate = select(root, profile);
      const quality = matrixQuality(candidate, "V2");
      if (!candidate || !quality) continue;
      const summary = profiles[profile]; summary.roots += 1;
      summary.robustUnits += quality.robustUnits;
      summary.totalUnits += quality.totalUnits;
      summary.totalStarDelta += quality.totalStarDelta;
      increment(summary.actionCounts, actionName(candidate));
      if (candidate.row !== current.row) {
        summary.changedRoots += 1;
        increment(summary.transitions,
          `${actionName(current)}>${actionName(candidate)}`);
      }
      if (qualityStrictlyBetter(quality, currentQuality))
        summary.improvedRoots += 1;
      else if (qualityStrictlyBetter(currentQuality, quality))
        summary.regressedRoots += 1;
      else summary.equalRoots += 1;
    }
  }
  const current = profiles[PROFILE.CURRENT];
  for (const summary of Object.values(profiles)) {
    summary.scoreBasisPoints = Math.round(summary.totalUnits * 5000 /
      Math.max(1, summary.roots * 2));
    summary.robustScoreBasisPoints = Math.round(summary.robustUnits * 5000 /
      Math.max(1, summary.roots));
    summary.scoreDeltaBasisPoints = summary.scoreBasisPoints -
      current.scoreBasisPoints;
    summary.robustDeltaBasisPoints = summary.robustScoreBasisPoints -
      current.robustScoreBasisPoints;
    summary.advance = profileAdvances(summary);
  }
  const output = { schemaVersion: 1,
    objectKind: "DECISION_VALUE_VECTOR_POC_REPORT_V1",
    inputFingerprint: document.fingerprint || "", profiles,
    recommendedDiscoveryProfile: Object.values(profiles)
      .filter(item => item.profile !== PROFILE.CURRENT && item.advance)
      .sort((left, right) => right.scoreDeltaBasisPoints -
        left.scoreDeltaBasisPoints || left.changedRoots - right.changedRoots)[0]?.profile || null,
    fingerprint: "" };
  output.fingerprint = fingerprintObject({ ...output, fingerprint: "" });
  return output;
}

function profileAdvances(summary) {
  return summary.profile !== PROFILE.CURRENT &&
    summary.scoreDeltaBasisPoints >= 300 &&
    summary.robustDeltaBasisPoints >= 0 &&
    summary.improvedRoots > 0;
}

function run() {
  const inputFile = path.resolve(option("--input",
    "/tmp/dqa-stratified-frame-labels.json"));
  const outputFile = path.resolve(option("--output",
    "/tmp/dqa-value-vector-poc.json"));
  const report = analyze(JSON.parse(fs.readFileSync(inputFile, "utf8")));
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputFile,
    recommendedDiscoveryProfile: report.recommendedDiscoveryProfile,
    profiles: report.profiles, fingerprint: report.fingerprint }, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try { run(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { PROFILE, vector, vectorBetter, eligible, select,
  profileAdvances, analyze, run };
