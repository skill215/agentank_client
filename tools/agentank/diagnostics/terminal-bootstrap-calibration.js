#!/usr/bin/env node
"use strict";

// Offline-only terminal bootstrap calibration.  It never changes production
// actions.  Runtime candidates may consume only the frozen integer weights;
// terminal rollouts and training remain outside the callback path.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { fingerprintObject } = require("../core/hash");
const { matrixQuality } = require(
  "./decision-quality-arena");
const { responseQuality, qualityCompare } = require(
  "./terminal-oracle-intervention-poc");

const FEATURE_NAMES = Object.freeze([
  "robustLower", "expectedValue", "worstValue", "tacticalValue",
  "horizonFatalMass", "unknownMass", "escapeSlack", "earliestFatalFrame",
  "purposeCompleteness", "possibleHit", "enemySafeSuccessors",
  "projectedStarProgress", "projectedStarDistance", "projectedMobility",
  "planContinuity", "rolloutComplete", "rolloutHardFatal",
  "rolloutTerminal", "rolloutEnemyCrashed", "rolloutOwnCrashed",
  "rolloutStarDelta", "rolloutObjectiveProgress", "rolloutEnemyDistance",
  "rolloutMobilityDelta", "rolloutProjectileThreat", "rolloutOwnFireLane",
  "rolloutEnemyFireLane", "rolloutProjectileThreatFrames",
  "rolloutMinimumEnemyMobility", "rolloutEnemyMobilityIntegral",
  "semanticGo", "semanticTurn", "semanticFire", "semanticResource",
  "goFar", "turnFar", "fireFar", "resourceFar",
  "goContact", "turnContact", "fireContact", "resourceContact",
  "goStarBehind", "turnStarBehind", "fireStarBehind", "resourceStarBehind",
  "goTerminal", "turnTerminal", "fireTerminal", "resourceTerminal",
  "starProgressTerminal", "possibleHitContact", "mobilityFar",
  "resourceNoSearch"
]);

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function finite(value) { return Number.isFinite(value) ? value : 0; }
function clamp(value, limit = 64) {
  const rounded = Math.round(finite(value));
  return rounded < -limit ? -limit : rounded > limit ? limit : rounded;
}
function scaled(value, divisor, limit = 64) {
  return clamp(finite(value) / divisor, limit);
}
function bit(value) { return value ? 64 : 0; }

function actionSemantic(label) {
  const type = label?.action?.type;
  if (type === "go") return 1;
  if (type === "turn") return 2;
  if (type === "fire") return 3;
  if (type && type !== "none") return 4;
  return 0;
}

function featureVector(label, root = null,
    output = new Int16Array(FEATURE_NAMES.length)) {
  const rollout = label?.optionRollout || {};
  output[0] = scaled(label?.robustLower, 256);
  output[1] = scaled(label?.expectedValue, 256);
  output[2] = scaled(label?.worstValue, 256);
  output[3] = scaled(label?.tacticalValue, 256);
  output[4] = scaled(label?.horizonFatalMass, 160);
  output[5] = scaled(label?.unknownMass, 160);
  output[6] = clamp(finite(label?.escapeSlack) * 16);
  output[7] = clamp(Math.min(16, finite(label?.earliestFatalFrame) || 16) * 4);
  output[8] = scaled(label?.purposeCompleteness, 160);
  output[9] = bit(label?.possibleHit);
  output[10] = clamp(finite(label?.enemySafeSuccessors) * 10);
  output[11] = clamp(finite(label?.projectedStarProgress) * 32);
  output[12] = clamp(finite(label?.projectedStarDistance) * 4);
  output[13] = clamp(finite(label?.projectedMobility) * 16);
  output[14] = scaled(label?.planContinuity, 160);
  output[15] = bit(rollout.physicalComplete && rollout.rootRestored);
  output[16] = bit(rollout.hardFatal);
  output[17] = bit(rollout.terminalReached);
  output[18] = bit(rollout.enemyCrashed);
  output[19] = bit(rollout.ownCrashed);
  output[20] = clamp(finite(rollout.starDelta) * 16);
  output[21] = clamp(finite(rollout.objectiveProgress) * 16);
  output[22] = clamp(finite(rollout.enemyDistance) * 3);
  output[23] = clamp((finite(rollout.mobility) -
    finite(rollout.enemyMobility)) * 16);
  output[24] = bit(rollout.projectileThreat);
  output[25] = bit(rollout.ownFireLane);
  output[26] = bit(rollout.enemyFireLane);
  output[27] = clamp(finite(rollout.projectileThreatFrames) * 16);
  output[28] = clamp(finite(rollout.minimumEnemyMobility) * 16);
  output[29] = clamp(finite(rollout.enemyMobilityIntegral) * 4);
  const semantic = actionSemantic(label);
  const evidence = root?.searchEvidence || {};
  const contact = finite(evidence.ownEnemyDistance) <= 9 ||
    Boolean(evidence.clearLineToEnemy);
  const far = !contact;
  const starBehind = finite(evidence.starRaceAdvantage) < 0;
  const terminal = finite(root?.frame) >= 112;
  const noSearch = !evidence.source || evidence.source === "NONE";
  output[30] = bit(semantic === 1);
  output[31] = bit(semantic === 2);
  output[32] = bit(semantic === 3);
  output[33] = bit(semantic === 4);
  output[34] = bit(semantic === 1 && far);
  output[35] = bit(semantic === 2 && far);
  output[36] = bit(semantic === 3 && far);
  output[37] = bit(semantic === 4 && far);
  output[38] = bit(semantic === 1 && contact);
  output[39] = bit(semantic === 2 && contact);
  output[40] = bit(semantic === 3 && contact);
  output[41] = bit(semantic === 4 && contact);
  output[42] = bit(semantic === 1 && starBehind);
  output[43] = bit(semantic === 2 && starBehind);
  output[44] = bit(semantic === 3 && starBehind);
  output[45] = bit(semantic === 4 && starBehind);
  output[46] = bit(semantic === 1 && terminal);
  output[47] = bit(semantic === 2 && terminal);
  output[48] = bit(semantic === 3 && terminal);
  output[49] = bit(semantic === 4 && terminal);
  output[50] = terminal ? clamp(finite(label?.projectedStarProgress) * 32) : 0;
  output[51] = bit(label?.possibleHit && contact);
  output[52] = far ? clamp(finite(label?.projectedMobility) * 16) : 0;
  output[53] = bit(semantic === 4 && noSearch);
  return output;
}

function eligible(root) {
  let rows = (root.labels || []).filter(label =>
    label.acceptable && !label.dominated);
  if (!rows.length) rows = (root.labels || []).filter(label => label.acceptable);
  return rows.length ? rows : (root.labels || []);
}

function rootsFrom(documents) {
  const roots = [];
  for (const document of documents) for (const match of document.matches || [])
    for (const root of match.roots || []) roots.push({
      scenarioFingerprint: match.scenarioFingerprint || match.matchUrlId,
      candidateSeat: match.candidateSeat,
      matchUrlId: match.matchUrlId,
      root
    });
  return roots;
}

function quality(label, mode = "robust-lex") {
  return responseQuality(label, mode);
}

function metricQuality(label, mode = "robust-lex") {
  if (mode !== "v3-only") return matrixQuality(label, "V2");
  const cells = (label?.responseMatrix?.cells || []).filter(item =>
    item.ownPolicy === "V2" && item.enemyPolicy === "V3");
  if (!cells.length) return null;
  let robustUnits = 3; let robustStarDelta = 32767;
  let totalUnits = 0; let totalStarDelta = 0;
  for (const cell of cells) {
    const units = cell.terminal?.outcome === "V2_WIN" ? 2 :
      cell.terminal?.outcome === "DRAW" ? 1 : 0;
    const stars = (cell.terminal?.candidateStars || 0) -
      (cell.terminal?.controlStars || 0);
    totalUnits += units; totalStarDelta += stars;
    if (units < robustUnits || units === robustUnits && stars < robustStarDelta) {
      robustUnits = units; robustStarDelta = stars;
    }
  }
  return { cells: cells.length, robustUnits, robustStarDelta,
    totalUnits, totalStarDelta };
}

function compareQuality(left, right, mode = "robust-lex") {
  void mode;
  return qualityCompare(left, right);
}

function buildPairs(roots, mode = "robust-lex") {
  const pairs = [];
  for (const item of roots) {
    const rows = eligible(item.root);
    for (let left = 0; left < rows.length; left += 1) {
      const leftQuality = quality(rows[left], mode);
      if (!leftQuality) continue;
      const leftFeatures = featureVector(rows[left], item.root);
      for (let right = left + 1; right < rows.length; right += 1) {
        const rightQuality = quality(rows[right], mode);
        if (!rightQuality) continue;
        const direction = compareQuality(leftQuality, rightQuality, mode);
        if (!direction) continue;
        const rightFeatures = featureVector(rows[right], item.root);
        const difference = new Int16Array(FEATURE_NAMES.length);
        for (let index = 0; index < difference.length; index += 1)
          difference[index] = leftFeatures[index] - rightFeatures[index];
        pairs.push({ direction, difference });
      }
    }
  }
  return pairs;
}

function dot(weights, features) {
  let value = 0;
  for (let index = 0; index < weights.length; index += 1)
    value += weights[index] * features[index];
  return value;
}

function normalizeWeights(weights, maximum = 1024) {
  let peak = 0;
  for (const value of weights) peak = Math.max(peak, Math.abs(value));
  const output = new Int16Array(weights.length);
  if (!peak) return output;
  for (let index = 0; index < weights.length; index += 1)
    output[index] = Math.round(weights[index] * maximum / peak);
  return output;
}

function train(roots, epochs = 24, mode = "robust-lex") {
  const pairs = buildPairs(roots, mode);
  const weights = new Int32Array(FEATURE_NAMES.length);
  const sums = new Float64Array(FEATURE_NAMES.length);
  let steps = 0; let updates = 0;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const offset = pairs.length ? epoch * 17 % pairs.length : 0;
    for (let at = 0; at < pairs.length; at += 1) {
      const pair = pairs[(at + offset) % pairs.length];
      if (dot(weights, pair.difference) * pair.direction <= 0) {
        for (let index = 0; index < weights.length; index += 1) {
          const next = weights[index] + pair.direction * pair.difference[index];
          weights[index] = next < -32767 ? -32767 :
            next > 32767 ? 32767 : next;
        }
        updates += 1;
      }
      for (let index = 0; index < weights.length; index += 1)
        sums[index] += weights[index];
      steps += 1;
    }
  }
  const averaged = new Int32Array(weights.length);
  if (steps) for (let index = 0; index < weights.length; index += 1)
    averaged[index] = Math.round(sums[index] / steps);
  return { weights: normalizeWeights(averaged), pairs: pairs.length,
    epochs, steps, updates };
}

function select(root, weights) {
  let best = null; let bestValue = -Infinity;
  for (const label of eligible(root)) {
    const value = dot(weights, featureVector(label, root));
    if (!best || value > bestValue || value === bestValue && label.row < best.row) {
      best = label; bestValue = value;
    }
  }
  return best;
}

function emptyAggregate() {
  return { roots: 0, robustUnits: 0, totalUnits: 0, totalCells: 0,
    totalStarDelta: 0 };
}

function addQuality(target, value) {
  if (!value) return;
  target.roots += 1; target.robustUnits += value.robustUnits;
  target.totalUnits += value.totalUnits; target.totalCells += value.cells;
  target.totalStarDelta += value.totalStarDelta;
}

function finishAggregate(value) {
  return { ...value,
    scoreBasisPoints: Math.round(value.totalUnits * 5000 /
      Math.max(1, value.totalCells)),
    robustScoreBasisPoints: Math.round(value.robustUnits * 5000 /
      Math.max(1, value.roots)) };
}

function evaluate(roots, weights, mode = "robust-lex") {
  const current = emptyAggregate(); const model = emptyAggregate();
  let changedRoots = 0; let improvedRoots = 0; let regressedRoots = 0;
  let equalRoots = 0; let bestRecall = 0; let supportedRoots = 0;
  for (const item of roots) {
    const selected = (item.root.labels || []).find(label =>
      label.row === item.root.selectedRow) || null;
    const proposed = select(item.root, weights);
    const currentTarget = quality(selected, mode);
    const modelTarget = quality(proposed, mode);
    const currentQuality = metricQuality(selected, mode);
    const modelQuality = metricQuality(proposed, mode);
    if (!currentTarget || !modelTarget || !currentQuality || !modelQuality) continue;
    addQuality(current, currentQuality); addQuality(model, modelQuality);
    supportedRoots += 1;
    if (selected?.row !== proposed?.row) changedRoots += 1;
    const comparison = compareQuality(modelTarget, currentTarget, mode);
    if (comparison > 0) improvedRoots += 1;
    else if (comparison < 0) regressedRoots += 1;
    else equalRoots += 1;
    let oracle = null;
    for (const label of eligible(item.root)) {
      const candidate = quality(label, mode);
      if (!candidate) continue;
      if (!oracle || compareQuality(candidate, oracle.quality, mode) > 0)
        oracle = { label, quality: candidate };
    }
    if (oracle && proposed?.row === oracle.label.row) bestRecall += 1;
  }
  const currentDone = finishAggregate(current);
  const modelDone = finishAggregate(model);
  return { roots: supportedRoots, changedRoots, improvedRoots, regressedRoots,
    equalRoots, bestRecall, bestRecallBasisPoints: Math.round(bestRecall * 10000 /
      Math.max(1, supportedRoots)), current: currentDone, model: modelDone,
    scoreDeltaBasisPoints: modelDone.scoreBasisPoints -
      currentDone.scoreBasisPoints,
    robustDeltaBasisPoints: modelDone.robustScoreBasisPoints -
      currentDone.robustScoreBasisPoints };
}

function foldFor(value, folds) {
  const hash = crypto.createHash("sha256").update(String(value)).digest();
  return hash[0] % folds;
}

function crossValidate(roots, folds = 4, epochs = 24,
    mode = "robust-lex") {
  const totals = { folds, testedRoots: 0, changedRoots: 0, improvedRoots: 0,
    regressedRoots: 0, equalRoots: 0, currentUnits: 0, modelUnits: 0,
    currentCells: 0, modelCells: 0, currentRobust: 0, modelRobust: 0,
    foldReports: [] };
  for (let fold = 0; fold < folds; fold += 1) {
    const training = roots.filter(item =>
      foldFor(item.scenarioFingerprint, folds) !== fold);
    const validation = roots.filter(item =>
      foldFor(item.scenarioFingerprint, folds) === fold);
    if (!training.length || !validation.length) continue;
    const model = train(training, epochs, mode); const report = evaluate(validation,
      model.weights, mode);
    totals.foldReports.push({ fold, trainingRoots: training.length,
      validationRoots: validation.length, pairs: model.pairs, ...report });
    totals.testedRoots += report.roots; totals.changedRoots += report.changedRoots;
    totals.improvedRoots += report.improvedRoots;
    totals.regressedRoots += report.regressedRoots;
    totals.equalRoots += report.equalRoots;
    totals.currentUnits += report.current.totalUnits;
    totals.modelUnits += report.model.totalUnits;
    totals.currentCells += report.current.totalCells;
    totals.modelCells += report.model.totalCells;
    totals.currentRobust += report.current.robustUnits;
    totals.modelRobust += report.model.robustUnits;
  }
  totals.currentScoreBasisPoints = Math.round(totals.currentUnits * 5000 /
    Math.max(1, totals.currentCells));
  totals.modelScoreBasisPoints = Math.round(totals.modelUnits * 5000 /
    Math.max(1, totals.modelCells));
  totals.scoreDeltaBasisPoints = totals.modelScoreBasisPoints -
    totals.currentScoreBasisPoints;
  totals.currentRobustBasisPoints = Math.round(totals.currentRobust * 5000 /
    Math.max(1, totals.testedRoots));
  totals.modelRobustBasisPoints = Math.round(totals.modelRobust * 5000 /
    Math.max(1, totals.testedRoots));
  totals.robustDeltaBasisPoints = totals.modelRobustBasisPoints -
    totals.currentRobustBasisPoints;
  totals.advance = totals.scoreDeltaBasisPoints >= 300 &&
    totals.robustDeltaBasisPoints >= 0 &&
    totals.improvedRoots > totals.regressedRoots;
  return totals;
}

function loadDocuments(files) {
  return files.map(file => JSON.parse(fs.readFileSync(path.resolve(file), "utf8")));
}

function run() {
  const inputFiles = option("--inputs", "").split(",")
    .map(value => value.trim()).filter(Boolean);
  if (!inputFiles.length) throw new Error("TERMINAL_BOOTSTRAP_INPUT_REQUIRED");
  const documents = loadDocuments(inputFiles); const roots = rootsFrom(documents);
  const epochs = Math.max(1, Math.min(128, Number(option("--epochs", "24")) | 0));
  const folds = Math.max(2, Math.min(8, Number(option("--folds", "4")) | 0));
  const qualityMode = option("--quality-mode", "robust-lex");
  const trained = train(roots, epochs, qualityMode); const training = evaluate(roots,
    trained.weights, qualityMode); const crossValidation = crossValidate(roots,
      folds, epochs, qualityMode);
  const output = { schemaVersion: 1,
    objectKind: "TERMINAL_BOOTSTRAP_CALIBRATION_V1",
    semantics: "OFFLINE_TERMINAL_MATRIX_PAIRWISE_INTEGER_RANKER_NOT_PROOF",
    inputFiles: inputFiles.map(value => path.resolve(value)),
    inputFingerprints: documents.map(value => value.fingerprint || ""),
    roots: roots.length, featureNames: FEATURE_NAMES, qualityMode,
    model: { weights: Array.from(trained.weights), epochs, pairs: trained.pairs,
      updates: trained.updates, maximumAbsoluteWeight: Math.max(...trained.weights
        .map(value => Math.abs(value))) },
    training, crossValidation,
    runtimeContract: { integerFeatures: FEATURE_NAMES.length,
      integerMultiplyAddsPerRow: FEATURE_NAMES.length,
      actionIdentityFeature: "COARSE_SEMANTIC_CLASS_ONLY",
      terminalRolloutInRuntime: false,
      hotAllocationAllowed: false },
    fingerprint: "" };
  output.fingerprint = fingerprintObject({ ...output, fingerprint: "" });
  const outputFile = path.resolve(option("--output",
    "/tmp/agentank-terminal-bootstrap-calibration.json"));
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputFile, roots: output.roots,
    training: output.training, crossValidation: output.crossValidation,
    fingerprint: output.fingerprint }, null, 2)}\n`);
  return output;
}

if (require.main === module) {
  try { run(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { FEATURE_NAMES, featureVector, eligible, rootsFrom,
  quality, metricQuality, compareQuality, buildPairs, dot, normalizeWeights,
  train, select, evaluate,
  foldFor, crossValidate, run };
