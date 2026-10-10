#!/usr/bin/env node
"use strict";

// BP147A projects BP145's strict real-root FIRE certificates onto signals that
// already exist at the ProductionRoot decision boundary.  This is a scheduler
// census only: recorded commands still own replay physics, no feature owns an
// action, and no production source or configuration is changed.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes, sha256Text } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { ProductionDiagnosticBot } = require(
  "../simulation/production-diagnostic-bot");
const { field, loadCohort } = require("./v2-native-initiative-arena");
const { scenarioIndex } = require("./semantic-attack-certificate-root-corpus");
const { readRoots } = require("./semantic-attack-chance-qualified-labels");
const { groupRoots, exactPhysicalRoot } = require(
  "./semantic-attack-real-event-proof");
const { RecordedActionBot, RecordedProductionShadowBot,
  installRecordedSkillEmitter, actionArgument } = require(
  "./semantic-attack-real-opportunity-corpus");
const { ACTION, HARD_STATUS, NONE_FRAME } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { PAC_STATUS } = require(
  "../../../engine-v2/src/search/projectile-attack-closure");

const SPLIT_SALT = "BP147A_REAL_ATTACK_SCHEDULER_SPLIT_V1";
const FEATURE_KEYS = Object.freeze([
  "enemyVisible", "informationComplete", "ownCanFire", "enemyCanFire",
  "ownCanAct", "enemyCanAct", "ownFacesEnemy", "enemyFacesOwn",
  "clearLineToEnemy", "counterLine", "selectedIsFire", "fireGenerated",
  "fireHardAllowed", "fireAcceptable", "fireDominated", "firePostEscape",
  "fireDirectKill", "fireAimSetup", "fireIntercept", "fireEscapeDenial",
  "firePossibleHit", "firePacComplete", "firePacDoomedAny",
  "firePacUnknownAny", "physicalSupportComplete", "informationSupportComplete",
  "informationApproximate", "hasCommittedHazard", "hasPossibleProjectile",
  "distance", "ownMobility", "enemyMobility", "ourActionCount",
  "enemyActionCount", "committedProjectileCount", "committedBombCount",
  "possibleProjectileCount", "hiddenWorldCount", "controlMode",
  "physicalDepth", "informationDepth", "fireSafety", "fireCoverage",
  "fireImmediateFatalMass", "fireHorizonFatalMass", "fireUnknownMass",
  "fireCommittedFatalMass", "firePossibleProjectileFatalMass",
  "fireFutureFireFatalMass", "fireEarliestFatalFrame", "fireEscapeSlack",
  "fireRobustLower", "fireExpectedValue", "fireTacticalValue",
  "firePurpose", "firePurposePriority", "fireHitDeadline",
  "fireEnemySafeSuccessors", "fireOwnCounterExposure",
  "firePurposeCompleteness", "firePressureValue", "fireRobustPressure",
  "fireEnemyDoomedFirstActions", "fireEnemySurvivingFirstActions",
  "fireEnemyUnknownFirstActions", "fireAttackDoomedByFrame",
  "fireAttackPressureContribution", "fireEnemyFrontierColumns",
  "fireEnemyCounterfireDelay", "fireEnemyMobilityLoss",
  "fireEnemyEndpointReduction"
]);

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function proofLabel(proof) {
  const goal = name => proof.goals.find(item => item.name === name);
  const safe = goal("SAFE_THREAT_FIRE");
  const doomed = goal("DOOMED_TARGET_FIRE");
  return { safeThreat: safe?.executable ? 1 : 0,
    doomedTarget: doomed?.executable ? 1 : 0,
    incomplete: proof.goals.some(item => item.classification === "INCOMPLETE") ? 1 : 0 };
}

function splitRoots(items, salt = SPLIT_SALT) {
  const strata = new Map();
  for (const item of items) {
    const label = proofLabel(item.proof);
    const stratum = [item.proof.sourceClass, label.safeThreat,
      label.doomedTarget, label.incomplete].join(":");
    const bucket = strata.get(stratum) || [];
    bucket.push(item); strata.set(stratum, bucket);
  }
  const discovery = new Set(); const holdout = new Set();
  for (const bucket of strata.values()) {
    bucket.sort((left, right) => sha256Text(salt + "\0" + left.proof.key)
      .localeCompare(sha256Text(salt + "\0" + right.proof.key)) ||
      left.proof.key.localeCompare(right.proof.key));
    for (let index = 0; index < bucket.length; index += 1)
      (index & 1 ? holdout : discovery).add(bucket[index].proof.key);
  }
  return { discovery, holdout };
}

function fireRow(engine) {
  for (let row = 0; row < engine.ourCount; row += 1)
    if (engine.ourActions[row] === ACTION.FIRE) return row;
  return -1;
}

function selectedRow(engine, selectedAction, selectedArgument) {
  const internal = engine.diagnosticInternalSelectedIndex;
  if (Number.isSafeInteger(internal) && internal >= 0 &&
      internal < engine.ourCount) return internal;
  for (let row = 0; row < engine.ourCount; row += 1)
    if (engine.ourActions[row] === selectedAction &&
        engine.ourArguments[row] === selectedArgument) return row;
  return -1;
}

function value(array, row, fallback = 0) {
  return row >= 0 && array && row < array.length ? array[row] | 0 : fallback;
}

function captureFeatures(engine, selectedAction, selectedArgument) {
  const state = engine.adapter.state; const a = state.arrays;
  const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
  const ownDirection = a[ARRAY.TANK_DIR][0];
  const enemyDirection = a[ARRAY.TANK_DIR][1];
  const direction = engine.directionTo(own, enemy);
  const reverseDirection = engine.directionTo(enemy, own);
  const clearLine = engine.clearLine(own, enemy) ? 1 : 0;
  const row = fireRow(engine); const selected = selectedRow(engine,
    selectedAction, selectedArgument);
  const risk = engine.riskController.outcome;
  const combat = engine.combat.vector;
  const pac = engine.projectileAttackClosure || engine.projectileAttack;
  const physical = engine.depthSearch; const information = engine.informationSearch;
  const committedProjectiles = state.activeProjectileCount();
  const committedBombs = state.activeBombCount();
  const possible = engine.possibleProjectiles.count();
  const features = {
    enemyVisible: engine.adapter.enemyVisible ? 1 : 0,
    informationComplete: engine.adapter.informationComplete ? 1 : 0,
    ownCanFire: engine.adapter.ownCanFire ? 1 : 0,
    enemyCanFire: engine.adapter.enemyCanFire ? 1 : 0,
    ownCanAct: engine.adapter.ownCanAct ? 1 : 0,
    enemyCanAct: engine.adapter.enemyCanAct ? 1 : 0,
    ownFacesEnemy: direction === ownDirection ? 1 : 0,
    enemyFacesOwn: reverseDirection === enemyDirection ? 1 : 0,
    clearLineToEnemy: clearLine,
    counterLine: clearLine && reverseDirection === enemyDirection ? 1 : 0,
    selectedIsFire: selected >= 0 && engine.ourActions[selected] === ACTION.FIRE ? 1 : 0,
    fireGenerated: row >= 0 ? 1 : 0,
    fireHardAllowed: row >= 0 && engine.hardStatus[row] === HARD_STATUS.ALLOW ? 1 : 0,
    fireAcceptable: value(risk.acceptable, row),
    fireDominated: value(risk.dominated, row),
    firePostEscape: value(combat.postFireEscape, row),
    fireDirectKill: value(combat.directKill, row),
    fireAimSetup: value(combat.aimSetup, row),
    fireIntercept: value(combat.intercept, row),
    fireEscapeDenial: value(combat.escapeDenial, row),
    firePossibleHit: value(combat.possibleHit, row),
    firePacComplete: value(pac.status, row) === PAC_STATUS.COMPLETE ? 1 : 0,
    firePacDoomedAny: value(pac.doomedEnemyColumns, row) > 0 ? 1 : 0,
    firePacUnknownAny: value(pac.unknownEnemyColumns, row) > 0 ? 1 : 0,
    physicalSupportComplete: physical.completedDepth > 0 &&
      physical.representativeSupportComplete ? 1 : 0,
    informationSupportComplete: information.completedDepth > 0 &&
      information.supportComplete && !information.approximate ? 1 : 0,
    informationApproximate: information.completedDepth > 0 &&
      information.approximate ? 1 : 0,
    hasCommittedHazard: committedProjectiles + committedBombs > 0 ? 1 : 0,
    hasPossibleProjectile: possible > 0 ? 1 : 0,
    distance: engine.manhattan(own, enemy),
    ownMobility: engine.countMobility(own),
    enemyMobility: engine.countMobility(enemy),
    ourActionCount: engine.ourCount,
    enemyActionCount: engine.enemyCount,
    committedProjectileCount: committedProjectiles,
    committedBombCount: committedBombs,
    possibleProjectileCount: possible,
    hiddenWorldCount: engine.hiddenWorldCount | 0,
    controlMode: engine.lastControlMode | 0,
    physicalDepth: physical.completedDepth | 0,
    informationDepth: information.completedDepth | 0,
    fireSafety: value(risk.safety, row),
    fireCoverage: value(risk.coverage, row),
    fireImmediateFatalMass: value(risk.immediateFatalMass, row),
    fireHorizonFatalMass: value(risk.horizonFatalMass, row),
    fireUnknownMass: value(risk.unknownMass, row),
    fireCommittedFatalMass: value(risk.committedFatalMass, row),
    firePossibleProjectileFatalMass: value(risk.possibleProjectileFatalMass, row),
    fireFutureFireFatalMass: value(risk.futureFireFatalMass, row),
    fireEarliestFatalFrame: value(risk.earliestFatalFrame, row, 255),
    fireEscapeSlack: value(risk.escapeSlack, row, -128),
    fireRobustLower: value(risk.robustLower, row, -10000),
    fireExpectedValue: value(risk.expectedValue, row, -10000),
    fireTacticalValue: value(risk.tacticalValue, row, -10000),
    firePurpose: value(combat.purpose, row),
    firePurposePriority: value(combat.purposePriority, row),
    fireHitDeadline: value(combat.hitDeadline, row, 255),
    fireEnemySafeSuccessors: value(combat.enemySafeSuccessors, row),
    fireOwnCounterExposure: value(combat.ownCounterExposure, row),
    firePurposeCompleteness: value(combat.purposeCompleteness, row),
    firePressureValue: value(combat.pressureValue, row),
    fireRobustPressure: value(combat.robustPressure, row),
    fireEnemyDoomedFirstActions: value(combat.enemyDoomedFirstActions, row),
    fireEnemySurvivingFirstActions: value(combat.enemySurvivingFirstActions, row),
    fireEnemyUnknownFirstActions: value(combat.enemyUnknownFirstActions, row),
    fireAttackDoomedByFrame: value(combat.attackDoomedByFrame, row, 255),
    fireAttackPressureContribution: value(combat.attackPressureContribution, row),
    fireEnemyFrontierColumns: value(combat.enemyFrontierColumns, row),
    fireEnemyCounterfireDelay: value(combat.enemyCounterfireDelay, row),
    fireEnemyMobilityLoss: value(combat.enemyMobilityLoss, row),
    fireEnemyEndpointReduction: value(combat.enemyEndpointReduction, row)
  };
  for (const key of FEATURE_KEYS)
    if (!Number.isSafeInteger(features[key]))
      throw new Error("BP147_NON_INTEGER_FEATURE:" + key);
  return { row, selectedRow: selected, selectedAction, selectedArgument,
    frame: a[ARRAY.SCALAR][SCALAR.FRAME], ownDirection, enemyDirection,
    ownCanFireAt: a[ARRAY.TANK_FIRE_LOCK][0] === NONE_FRAME ? -1 :
      a[ARRAY.TANK_FIRE_LOCK][0], features };
}

function atomicPredicates(records) {
  const output = [];
  for (const key of FEATURE_KEYS) {
    const values = [...new Set(records.map(record => record.features[key]))]
      .sort((a, b) => a - b);
    if (values.length <= 2 && values.every(item => item === 0 || item === 1)) {
      for (const threshold of values)
        output.push({ key, operator: "==", threshold });
      continue;
    }
    for (const threshold of values) {
      output.push({ key, operator: "<=", threshold });
      output.push({ key, operator: ">=", threshold });
    }
  }
  return output;
}

function predicateMatches(record, predicate) {
  const current = record.features[predicate.key];
  return predicate.operator === "==" ? current === predicate.threshold :
    predicate.operator === "<=" ? current <= predicate.threshold :
      current >= predicate.threshold;
}

function ruleMatches(record, rule) {
  return rule.predicates.every(predicate => predicateMatches(record, predicate));
}

function evaluateRule(records, rule) {
  let truePositive = 0; let falsePositive = 0; let falseNegative = 0;
  let trueNegative = 0;
  for (const record of records) {
    const selected = ruleMatches(record, rule); const positive = record.label.safeThreat;
    if (selected && positive) truePositive += 1;
    else if (selected) falsePositive += 1;
    else if (positive) falseNegative += 1;
    else trueNegative += 1;
  }
  const positiveCount = truePositive + falseNegative;
  const triggered = truePositive + falsePositive;
  return { truePositive, falsePositive, falseNegative, trueNegative, triggered,
    recallPermille: positiveCount ? Math.floor(truePositive * 1000 / positiveCount) : 0,
    precisionPermille: triggered ? Math.floor(truePositive * 1000 / triggered) : 0,
    reductionPermille: records.length ? Math.floor((records.length - triggered) *
      1000 / records.length) : 0 };
}

function ruleKey(rule) {
  return rule.predicates.map(item => item.key + item.operator + item.threshold)
    .join("&&");
}

function compareRules(left, right) {
  if (left.metrics.recallPermille !== right.metrics.recallPermille)
    return right.metrics.recallPermille - left.metrics.recallPermille;
  if (left.metrics.triggered !== right.metrics.triggered)
    return left.metrics.triggered - right.metrics.triggered;
  if (left.predicates.length !== right.predicates.length)
    return left.predicates.length - right.predicates.length;
  if (left.metrics.precisionPermille !== right.metrics.precisionPermille)
    return right.metrics.precisionPermille - left.metrics.precisionPermille;
  return ruleKey(left).localeCompare(ruleKey(right));
}

function discoverRules(records, pairLimit = 80) {
  const atoms = atomicPredicates(records).map(predicate => {
    const rule = { predicates: [predicate] };
    return { ...rule, metrics: evaluateRule(records, rule) };
  }).filter(rule => rule.metrics.truePositive > 0).sort(compareRules);
  const pairAtoms = atoms.filter(rule => rule.metrics.recallPermille >= 500)
    .slice(0, pairLimit);
  const pairs = [];
  for (let left = 0; left < pairAtoms.length; left += 1)
    for (let right = left + 1; right < pairAtoms.length; right += 1) {
      const predicates = [pairAtoms[left].predicates[0],
        pairAtoms[right].predicates[0]];
      if (predicates[0].key === predicates[1].key) continue;
      const rule = { predicates }; const metrics = evaluateRule(records, rule);
      if (metrics.truePositive) pairs.push({ ...rule, metrics });
    }
  pairs.sort(compareRules);
  const fullRecall = [...atoms, ...pairs]
    .filter(rule => rule.metrics.recallPermille === 1000)
    .sort(compareRules);
  return { atomicCount: atoms.length, pairCount: pairs.length,
    topAtomic: atoms.slice(0, 24), topPair: pairs.slice(0, 24),
    selected: fullRecall[0] || atoms[0] || null };
}

function compactRule(rule) {
  if (!rule) return null;
  return { predicates: rule.predicates, metrics: rule.metrics,
    expression: ruleKey(rule) };
}

function crossTab(records) {
  const output = { rootCount: records.length, positiveCount: 0,
    doomedCount: 0, incompleteCount: 0, sourceClasses: {}, selectedActions: {},
    positiveBySource: {} };
  for (const record of records) {
    output.positiveCount += record.label.safeThreat;
    output.doomedCount += record.label.doomedTarget;
    output.incompleteCount += record.label.incomplete;
    output.sourceClasses[record.sourceClass] =
      (output.sourceClasses[record.sourceClass] || 0) + 1;
    output.selectedActions[record.selectedAction] =
      (output.selectedActions[record.selectedAction] || 0) + 1;
    if (record.label.safeThreat) output.positiveBySource[record.sourceClass] =
      (output.positiveBySource[record.sourceClass] || 0) + 1;
  }
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp144-semantic-attack-real-opportunity-corpus-v4")));
  const proofDirectory = path.resolve(option("--proof-source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp145-semantic-attack-real-event-proof-v2")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp147-semantic-attack-certificate-feature-census")));
  const cohortFile = path.resolve(option("--cohort", path.join(root,
    "config", "engine-v2", "strategic-attack-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const expectedRoots = Number(option("--expected-roots", 476));
  const source = readRoots(sourceDirectory); const proof = readRoots(proofDirectory);
  const sourceByKey = new Map(source.roots.map(item => [item.key, item]));
  const joined = [];
  for (const item of proof.roots) {
    const sourceRoot = sourceByKey.get(item.key);
    if (!sourceRoot) throw new Error("BP147_SOURCE_ROOT_MISSING:" + item.key);
    joined.push({ proof: item, source: sourceRoot });
  }
  if (joined.length !== expectedRoots)
    throw new Error("BP147_ROOT_DENOMINATOR:" + joined.length + "/" + expectedRoots);
  const split = splitRoots(joined); const splitByKey = new Map();
  for (const key of split.discovery) splitByKey.set(key, "DISCOVERY");
  for (const key of split.holdout) splitByKey.set(key, "HOLDOUT");
  if (splitByKey.size !== joined.length)
    throw new Error("BP147_SPLIT_DENOMINATOR:" + splitByKey.size);
  const groups = groupRoots(joined.map(item => item.source));
  const loaded = loadCohort(root, cohortFile, role);
  const scenarios = scenarioIndex(loaded.scenarios);
  const simulator = await loadSimulator(root); const records = [];
  let replayMismatchCount = 0; let groupIndex = 0;
  const proofByKey = new Map(proof.roots.map(item => [item.key, item]));
  for (const roots of groups.values()) {
    const exemplar = roots[0]; const prefix = exemplar.replayPrefix;
    const scenario = scenarios.get(exemplar.scenarioFingerprint) ||
      scenarios.get(exemplar.matchUrlId);
    if (!scenario) throw new Error("BP147_SCENARIO_MISSING:" + exemplar.key);
    const actions = Buffer.from(prefix.candidateActionStream, "base64");
    const byIndex = new Map();
    for (const sourceRoot of roots) {
      const bucket = byIndex.get(sourceRoot.decisionIndex) || [];
      bucket.push(sourceRoot); byIndex.set(sourceRoot.decisionIndex, bucket);
    }
    let decisionIndex = 0;
    const shadow = new ProductionDiagnosticBot({ captureExceptionalFrames: false,
      diagnosticFinalActionOverride(engine, selectedAction, selectedArgument) {
        const index = decisionIndex++; const code = actions[index] ?? ACTION.NONE;
        for (const sourceRoot of byIndex.get(index) || []) {
          const proofRoot = proofByKey.get(sourceRoot.key);
          const captured = captureFeatures(engine, selectedAction, selectedArgument);
          records.push({ schemaVersion: 1,
            objectKind: "SEMANTIC_ATTACK_CERTIFICATE_FEATURE_ROOT_V1",
            key: sourceRoot.key, sourceClass: proofRoot.sourceClass,
            sourceFamily: sourceRoot.sourceFamily,
            scenarioFingerprint: sourceRoot.scenarioFingerprint,
            matchUrlId: sourceRoot.matchUrlId, attackSeat: sourceRoot.attackSeat,
            seatSkills: sourceRoot.seatSkills, frame: sourceRoot.frame,
            decisionIndex: sourceRoot.decisionIndex,
            split: splitByKey.get(sourceRoot.key),
            exact: exactPhysicalRoot(engine, sourceRoot),
            label: proofLabel(proofRoot), ...captured });
        }
        return { action: code, argument: actionArgument(engine, code,
          prefix.candidateArguments, index) };
      } });
    installRecordedSkillEmitter(shadow.engine);
    const candidate = new RecordedProductionShadowBot(shadow,
      prefix.candidateActionStream, prefix.candidateArguments);
    const opponent = new RecordedActionBot(prefix.controlActionStream,
      prefix.controlArguments);
    const built = field(simulator.module, scenario, exemplar.attackSeat,
      exemplar.seatSkills);
    const bots = exemplar.attackSeat === 0 ? [candidate, opponent] :
      [opponent, candidate];
    built.simulator.run(bots[0], bots[1]);
    if (candidate.index !== candidate.actions.length ||
        decisionIndex !== candidate.actions.length ||
        candidate.shadowOutputMismatchCount !== 0 ||
        opponent.index !== opponent.actions.length) replayMismatchCount += 1;
    groupIndex += 1;
    if (groupIndex % 16 === 0 || groupIndex === groups.size)
      process.stderr.write("[bp147-feature-census] " + groupIndex + "/" +
        groups.size + " roots=" + records.length + "\n");
  }
  records.sort((left, right) => left.key.localeCompare(right.key));
  const discovery = records.filter(record => record.split === "DISCOVERY");
  const holdout = records.filter(record => record.split === "HOLDOUT");
  const discovered = discoverRules(discovery);
  const selectedRule = discovered.selected;
  const holdoutMetrics = selectedRule ? evaluateRule(holdout, selectedRule) : null;
  const allMetrics = selectedRule ? evaluateRule(records, selectedRule) : null;
  const exactCount = records.filter(record => record.exact).length;
  const accepted = records.length === expectedRoots && exactCount === records.length &&
    replayMismatchCount === 0 && split.discovery.size === discovery.length &&
    split.holdout.size === holdout.length && selectedRule;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_CERTIFICATE_FEATURE_CENSUS_OVERVIEW_V1",
    status: accepted ? "ACCEPT_FEATURE_CENSUS" : "REJECTED", role,
    cohortFingerprint: loaded.manifest.fingerprint,
    rootCount: records.length, replayGroupCount: groups.size,
    replayMismatchCount, exactRootCount: exactCount,
    split: { salt: SPLIT_SALT, discovery: crossTab(discovery),
      holdout: crossTab(holdout) }, all: crossTab(records),
    predicateSearch: { atomicCount: discovered.atomicCount,
      pairCount: discovered.pairCount,
      selectedDiscoveryRule: compactRule(selectedRule), holdoutMetrics,
      allMetrics, topAtomic: discovered.topAtomic.map(compactRule),
      topPair: discovered.topPair.map(compactRule) },
    decisionBoundary: "Exploratory scheduler evidence only. Features are existing integer/boolean ProductionRoot signals. The selected rule cannot own FIRE and is not production-approved; strict BP145 proof remains the only candidate action certificate." };
  const lines = records.map(record => JSON.stringify(record)).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_CERTIFICATE_FEATURE_CENSUS_MANIFEST_V1",
    status: overview.status, sourceDirectory, proofDirectory,
    sourceRootsSha256: sha256Bytes(source.bytes),
    proofRootsSha256: sha256Bytes(proof.bytes), cohortFile,
    cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    productionRootSha256: sha256Bytes(fs.readFileSync(productionFile)),
    recordsSha256: sha256Bytes(bytes), rootCount: records.length,
    featureKeys: FEATURE_KEYS, arguments: process.argv.slice(2), fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"), bytes);
  process.stdout.write(JSON.stringify({ output: outputDirectory, overview,
    fingerprint: manifest.fingerprint }, null, 2) + "\n");
  if (!accepted) throw new Error("BP147_FEATURE_CENSUS_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(error => {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { SPLIT_SALT, FEATURE_KEYS, proofLabel, splitRoots, fireRow,
  selectedRow, captureFeatures, atomicPredicates, predicateMatches, ruleMatches,
  evaluateRule, discoverRules, crossTab, build };
