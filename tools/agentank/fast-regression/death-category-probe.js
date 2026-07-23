"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { sourceIdentity } = require("../diagnostics/v1-v2-working-arena");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");
const { HARD_STATUS, NONE_CELL } = require("../../../engine-v2/src/abi/fast-codes");
const { FastRegressionStore } = require("./artifact-store");
const { selectionBucket, SELECTION_BUCKET } = require("./dominated-rescue-analysis");
const { inspectRootAtFrame, ACTION_NAME, HARD_NAME, actionCommand, BranchBatchCache } =
  require("./focused-diagnostic");

const DEATH_CATEGORY = Object.freeze({
  HARD_REJECT_SELECTED: "HARD_REJECT_SELECTED",
  HARD_VIABILITY_LEAK: "HARD_VIABILITY_LEAK",
  CONTINUATION_ESCAPE_GAP: "CONTINUATION_ESCAPE_GAP",
  FACT_LAYER_MISMATCH: "FACT_LAYER_MISMATCH",
  INFORMATION_ONLY: "INFORMATION_ONLY",
  UNCLASSIFIED: "UNCLASSIFIED"
});

const DEFAULT_FOCUSED =
  "artifacts/fast-regression/reports/native-poison-death-post-migration-full-r21/latest.json";
const DEFAULT_PRIOR =
  "artifacts/fast-regression/reports/death-category-probe-b0/latest.json";
const DEFAULT_OUTPUT = "death-category-probe-b0";

function readBoundReport(file) {
  invariant(fs.existsSync(file), "DEATH_CATEGORY_REPORT_NOT_FOUND", file);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(value.fingerprint === fingerprintObject(value),
    "DEATH_CATEGORY_REPORT_INVALID", file);
  return value;
}

function hazardKind(diagnostics) {
  if ((diagnostics.committedBombCount || 0) > 0) return "bomb";
  if ((diagnostics.committedProjectileCount || 0) > 0 ||
      diagnostics.observedOwnBullet || diagnostics.observedEnemyBullet) return "projectile";
  if ((diagnostics.possibleProjectileCount || 0) > 0) return "possible";
  return "none";
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function collectAvoidableDeathFrames(focused) {
  const frames = [];
  for (const result of focused.results || []) {
    if (result.role !== "PRIMARY_LOSS") continue;
    for (const frame of result.frames || []) {
      if (frame.frameClass !== "AVOIDABLE_UNDER_FIXED_CONTINUATION" ||
          frame.currentSelectedDies !== true) continue;
      const bucket = selectionBucket(frame);
      if (!bucket || bucket === SELECTION_BUCKET.CURRENT_SURVIVOR) continue;
      const diagnostics = frame.rootDiagnostics || {};
      frames.push({
        capsuleFingerprint: result.fingerprint,
        matchId: result.matchId,
        historicalMatchUrlId: result.historicalMatchUrlId || null,
        frame: frame.frame,
        distanceToTerminal: frame.distanceToTerminal,
        selectionBucket: bucket,
        hazardKind: hazardKind(diagnostics),
        rescuingActions: frame.rescuingActions || [],
        selected: frame.currentSelectedCandidate || frame.selectedCandidate || null,
        diagnostics,
        frameRecord: frame
      });
    }
  }
  return frames;
}

function sampleStratified(frames, limit, seed = 1) {
  const byStratum = new Map();
  for (const item of frames) {
    const key = `${item.selectionBucket}|${item.hazardKind}|d${item.distanceToTerminal}`;
    if (!byStratum.has(key)) byStratum.set(key, []);
    byStratum.get(key).push(item);
  }
  const keys = [...byStratum.keys()].sort();
  // Deterministic round-robin pick across strata, then fill.
  const picked = [];
  const cursors = Object.fromEntries(keys.map(key => [key, 0]));
  let guard = 0;
  while (picked.length < limit && guard < limit * keys.length + 8) {
    for (const key of keys) {
      if (picked.length >= limit) break;
      const list = byStratum.get(key);
      const index = (cursors[key] + seed) % list.length;
      const candidate = list[index % list.length];
      cursors[key] += 1;
      if (picked.some(item => item.capsuleFingerprint === candidate.capsuleFingerprint &&
          item.frame === candidate.frame)) continue;
      picked.push({ ...candidate, stratum: key });
    }
    guard += 1;
  }
  return { picked, stratumCount: keys.length, poolSize: frames.length };
}

function observationPhysicalMismatch(diagnostics) {
  const reasons = [];
  if ((diagnostics.observedBombCount || 0) > 0 &&
      (diagnostics.committedBombCount || 0) === 0)
    reasons.push("OBSERVED_BOMB_WITHOUT_COMMITTED");
  if ((diagnostics.observedOwnBullet || diagnostics.observedEnemyBullet) &&
      (diagnostics.committedProjectileCount || 0) === 0 &&
      (diagnostics.possibleProjectileCount || 0) === 0)
    reasons.push("OBSERVED_BULLET_WITHOUT_TRACK");
  if ((diagnostics.committedBombCount || 0) > (diagnostics.observedBombCount || 0) + 1)
    reasons.push("COMMITTED_BOMB_EXCEEDS_OBSERVATION");
  return reasons;
}

function classifyCase(sample, live) {
  const selected = live.selected;
  const hardName = selected ? selected.hard : "MISSING";
  const hardCode = selected ? selected.hardCode : -1;
  const diagnostics = live.diagnostics;
  const committed = (diagnostics.committedBombCount || 0) +
    (diagnostics.committedProjectileCount || 0);
  const mismatch = observationPhysicalMismatch(diagnostics);
  const evidence = {
    hard: hardName,
    safety: selected ? selected.safety : null,
    lastViable: live.lastViable,
    hardReevaluate: live.hardReevaluate,
    committedBombCount: diagnostics.committedBombCount || 0,
    committedProjectileCount: diagnostics.committedProjectileCount || 0,
    possibleProjectileCount: diagnostics.possibleProjectileCount || 0,
    observedBombCount: diagnostics.observedBombCount || 0,
    observedOwnBullet: diagnostics.observedOwnBullet || 0,
    observedEnemyBullet: diagnostics.observedEnemyBullet || 0,
    informationComplete: diagnostics.informationComplete,
    rescuingActionCount: sample.rescuingActions.length,
    rescuingActions: sample.rescuingActions.slice(0, 8),
    physicalDepth: diagnostics.physicalDepth,
    informationDepth: diagnostics.informationDepth,
    escapeSlack: selected ? selected.escapeSlack : null,
    committedFatalMass: selected ? selected.committedFatalMass : null,
    possibleProjectileFatalMass: selected ? selected.possibleProjectileFatalMass : null,
    futureFireFatalMass: selected ? selected.futureFireFatalMass : null,
    mismatchReasons: mismatch
  };

  // Avoidable fixed-continuation deaths almost always have some rescuing action.
  // Do not use rescue presence alone to decide CONTINUATION vs INFORMATION.
  if (hardCode === HARD_STATUS.REJECT_PROVEN || hardCode === HARD_STATUS.REJECT_POLICY)
    return { category: DEATH_CATEGORY.HARD_REJECT_SELECTED, subtype: "SELECTED_HARD_REJECT",
      evidence };

  if (mismatch.length)
    return { category: DEATH_CATEGORY.FACT_LAYER_MISMATCH, subtype: mismatch[0], evidence };

  if (hardCode === HARD_STATUS.ALLOW && committed > 0 && live.lastViable === 0)
    return { category: DEATH_CATEGORY.HARD_VIABILITY_LEAK, subtype: "ALLOW_BUT_NO_ESCAPE",
      evidence };

  if (hardCode === HARD_STATUS.ALLOW && committed > 0 && live.lastViable === 1)
    return { category: DEATH_CATEGORY.CONTINUATION_ESCAPE_GAP,
      subtype: "COMMITTED_ESCAPE_EXISTS_AFTER_SELECTED", evidence };

  if (hardCode === HARD_STATUS.ALLOW && committed > 0 && live.lastViable === -1)
    return { category: DEATH_CATEGORY.CONTINUATION_ESCAPE_GAP,
      subtype: "COMMITTED_VIABLE_INCOMPLETE", evidence };

  if (hardCode === HARD_STATUS.ALLOW && committed === 0) {
    const subtype = (diagnostics.possibleProjectileCount || 0) > 0 ?
      "POSSIBLE_OR_HIDDEN_ONLY" : "NO_COMMITTED_HAZARD";
    return { category: DEATH_CATEGORY.INFORMATION_ONLY, subtype, evidence };
  }

  return { category: DEATH_CATEGORY.UNCLASSIFIED, subtype: "FALLTHROUGH", evidence };
}

function reevaluateSelectedViable(engine, selectedIndex) {
  if (selectedIndex < 0 || selectedIndex >= engine.ourCount)
    return { hardReevaluate: null, lastViable: null };
  const liveHard = engine.adapter && engine.adapter.hard ? engine.adapter.hard : null;
  if (!liveHard) return { hardReevaluate: null, lastViable: null };
  const action = engine.ourActions[selectedIndex];
  const argument = engine.ourArguments[selectedIndex];
  const status = liveHard.evaluate(action, argument === undefined ? NONE_CELL : argument);
  return {
    hardReevaluate: HARD_NAME[status] || `HARD_${status}`,
    lastViable: liveHard.lastViable
  };
}

function escapeObligationSnapshot(engine, selectedIndex) {
  const obligation = engine.escapeObligation;
  if (!obligation) return null;
  const count = Math.max(0, engine.ourCount || 0);
  let firstActions = [];
  for (let row = 0; row < count; row += 1)
    if (obligation.firstAction[row])
      firstActions.push(ACTION_NAME[engine.ourActions[row]] || `ACTION_${engine.ourActions[row]}`);
  return {
    active: obligation.active,
    entityCount: obligation.entityCount,
    firstActionCount: obligation.firstActionCount,
    firstActions: firstActions.slice(0, 8),
    selectedStillExposed: selectedIndex >= 0 ? obligation.stillExposed[selectedIndex] : null,
    selectedSuccessorProof: selectedIndex >= 0 ?
      obligation.successorProof[selectedIndex] : null,
    selectedSuccessorSlack: selectedIndex >= 0 ?
      obligation.successorSlack[selectedIndex] : null,
    selectedIsFirstAction: selectedIndex >= 0 ? obligation.firstAction[selectedIndex] : null
  };
}

async function probeOne(workspaceRoot, store, settings, sample, branchCache = null) {
  const { capsule } = store.readCapsule(sample.capsuleFingerprint);
  const prepared = await inspectRootAtFrame(workspaceRoot, capsule, sample.frame, settings);
  const selected = prepared.candidates.find(item => item.actionCode === prepared.returned) ||
    prepared.candidates.find(item => item.action === sample.selected?.action) || null;
  const selectedIndex = selected ? selected.index : -1;
  const viability = reevaluateSelectedViable(prepared.engine, selectedIndex);
  // If HardGate evaluate was unavailable, fall back to hazard on current post-decide state.
  let lastViable = viability.lastViable;
  if (lastViable == null && prepared.engine.adapter?.hazard) {
    const committed = (prepared.diagnostics.committedBombCount || 0) +
      (prepared.diagnostics.committedProjectileCount || 0);
    lastViable = committed > 0 ? prepared.engine.adapter.hazard.reverseViable(0) : null;
  }
  const returnedName = ACTION_NAME[prepared.returned] || prepared.selectedAction;
  const priorSelected = sample.priorSelectedAction || sample.selected?.action || null;
  const actionChanged = Boolean(priorSelected && returnedName && priorSelected !== returnedName);
  let currentSelectedDies = null;
  if (branchCache && selected) {
    const mapped = actionCommand(selected.actionCode, selected.argument,
      prepared.engine.adapter.state);
    if (mapped.supported) {
      const replay = await branchCache.replay(workspaceRoot, capsule, sample.frame, mapped.command);
      currentSelectedDies = Boolean(replay.result?.branch?.v2Crashed);
    }
  }
  const live = {
    selected,
    diagnostics: prepared.diagnostics,
    hardReevaluate: viability.hardReevaluate,
    lastViable,
    returned: returnedName
  };
  const classified = classifyCase(sample, live);
  const evidence = {
    ...classified.evidence,
    priorSelectedAction: priorSelected,
    actionChanged: actionChanged ? 1 : 0,
    currentSelectedDies,
    escapeObligation: escapeObligationSnapshot(prepared.engine, selectedIndex)
  };
  return {
    capsuleFingerprint: sample.capsuleFingerprint,
    matchId: sample.matchId,
    historicalMatchUrlId: sample.historicalMatchUrlId,
    frame: sample.frame,
    distanceToTerminal: sample.distanceToTerminal,
    selectionBucket: sample.selectionBucket,
    hazardKind: sample.hazardKind,
    stratum: sample.stratum,
    priorCategory: sample.priorCategory || null,
    selectedAction: live.returned,
    reportedHard: sample.selected?.hard || null,
    reportedSafety: sample.selected?.safety || null,
    category: classified.category,
    subtype: classified.subtype,
    evidence
  };
}

function loadPriorCases(priorPath, categoryFilter) {
  const prior = readBoundReport(priorPath);
  let cases = prior.cases || [];
  if (categoryFilter)
    cases = cases.filter(item => item.category === categoryFilter);
  return {
    prior,
    samples: cases.map(item => ({
      capsuleFingerprint: item.capsuleFingerprint,
      matchId: item.matchId,
      historicalMatchUrlId: item.historicalMatchUrlId || null,
      frame: item.frame,
      distanceToTerminal: item.distanceToTerminal,
      selectionBucket: item.selectionBucket,
      hazardKind: item.hazardKind,
      stratum: item.stratum || `${item.selectionBucket}|${item.hazardKind}`,
      rescuingActions: item.evidence?.rescuingActions || [],
      selected: {
        action: item.selectedAction,
        hard: item.reportedHard,
        safety: item.reportedSafety
      },
      priorSelectedAction: item.selectedAction,
      priorCategory: item.category,
      diagnostics: {
        committedBombCount: item.evidence?.committedBombCount || 0,
        committedProjectileCount: item.evidence?.committedProjectileCount || 0,
        possibleProjectileCount: item.evidence?.possibleProjectileCount || 0,
        observedBombCount: item.evidence?.observedBombCount || 0,
        observedOwnBullet: item.evidence?.observedOwnBullet || 0,
        observedEnemyBullet: item.evidence?.observedEnemyBullet || 0
      }
    }))
  };
}

async function probeDeathCategories(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const focusedPath = path.resolve(options.focusedReportPath ||
    path.join(workspaceRoot, DEFAULT_FOCUSED));
  const focused = readBoundReport(focusedPath);
  const source = sourceIdentity(workspaceRoot);
  const reportSourceSha = focused.execution.workingSourceSha256;
  const sourceDrift = source.sha256 !== reportSourceSha;
  if (sourceDrift && !options.allowSourceDrift)
    invariant(false, "DEATH_CATEGORY_SOURCE_DRIFT",
      `${source.sha256}/${reportSourceSha}`);
  const categoryFilter = options.categoryFilter || null;
  const priorPath = options.priorReportPath ?
    path.resolve(options.priorReportPath) :
    (options.replayPrior ? path.resolve(workspaceRoot, DEFAULT_PRIOR) : null);
  let picked;
  let samplingMeta;
  if (priorPath) {
    const loaded = loadPriorCases(priorPath, categoryFilter);
    picked = loaded.samples;
    samplingMeta = {
      mode: "PRIOR_CASES",
      priorReportPath: path.relative(workspaceRoot, priorPath).replaceAll("\\", "/"),
      priorFingerprint: loaded.prior.fingerprint,
      categoryFilter,
      poolSize: (loaded.prior.cases || []).length,
      stratumCount: null,
      sampledCount: picked.length,
      limit: picked.length,
      seed: null
    };
  } else {
    const pool = collectAvoidableDeathFrames(focused);
    const limit = Math.max(1, Math.min(Number(options.limit) || 25, pool.length));
    const seed = Number.isSafeInteger(Number(options.seed)) ? Number(options.seed) : 1;
    const sampled = sampleStratified(pool, limit, seed);
    picked = sampled.picked;
    samplingMeta = {
      mode: "STRATIFIED_SAMPLE",
      limit,
      seed,
      poolSize: sampled.poolSize,
      stratumCount: sampled.stratumCount,
      sampledCount: picked.length,
      categoryFilter: null,
      priorReportPath: null,
      priorFingerprint: null
    };
  }
  const settings = v2Options(loadFrozenCandidate(workspaceRoot).manifest.parameters).engine;
  const branchCache = options.checkSurvival === false ? null :
    new BranchBatchCache(store, focused.cohort?.fingerprint || focused.fingerprint);
  const cases = [];
  const histogram = {};
  const subtypeHistogram = {};
  const byHazard = {};
  const byBucket = {};
  let actionChanged = 0;
  let survivalAvoided = 0;
  let survivalStillDies = 0;
  let obligationActive = 0;
  let committedMassPositive = 0;
  for (let index = 0; index < picked.length; index += 1) {
    const sample = picked[index];
    if (options.onProgress)
      options.onProgress(index, picked.length, sample.capsuleFingerprint, sample.frame);
    const item = await probeOne(workspaceRoot, store, settings, sample, branchCache);
    cases.push(item);
    increment(histogram, item.category);
    increment(subtypeHistogram, item.subtype);
    increment(byHazard, item.hazardKind);
    increment(byBucket, item.selectionBucket);
    if (item.evidence.actionChanged) actionChanged += 1;
    if (item.evidence.currentSelectedDies === false) survivalAvoided += 1;
    if (item.evidence.currentSelectedDies === true) survivalStillDies += 1;
    if (item.evidence.escapeObligation?.active) obligationActive += 1;
    if ((item.evidence.committedFatalMass || 0) > 0) committedMassPositive += 1;
    if (options.onProgress)
      options.onProgress(index + 1, picked.length, sample.capsuleFingerprint,
        sample.frame, item.category);
  }
  const report = {
    artifactKind: "FAST_REGRESSION_DEATH_CATEGORY_PROBE",
    status: "COMPLETED",
    properties: [
      "DIAGNOSTIC_NOT_PROOF",
      sourceDrift ? "SOURCE_DRIFT_ALLOWED" : "SOURCE_BOUND",
      samplingMeta.mode,
      "POST_ESCAPE_OBLIGATION"
    ],
    semantics: {
      categories: DEATH_CATEGORY,
      hardMeaning: "Tank death alone is not a Hard defect; categories separate wiring, viability leak, continuation, fact-layer, and information-only deaths.",
      priority: "HARD_REJECT_SELECTED > FACT_LAYER_MISMATCH > HARD_VIABILITY_LEAK > CONTINUATION_ESCAPE_GAP > INFORMATION_ONLY",
      note: "AVOIDABLE frames almost always have rescuingActions; rescue presence alone does not imply CONTINUATION_ESCAPE_GAP. Committed PhysicalState presence + reverseViable outcome decides CONTINUATION vs INFORMATION. currentSelectedDies uses fixed historical continuation replay of the live selected action."
    },
    source: {
      focusedReportPath: path.relative(workspaceRoot, focusedPath).replaceAll("\\", "/"),
      focusedFingerprint: focused.fingerprint,
      reportWorkingSourceSha256: reportSourceSha,
      workingSourceSha256: source.sha256,
      sourceDrift: sourceDrift ? 1 : 0,
      baselineId: "structural-repair-baseline-b0"
    },
    sampling: samplingMeta,
    denominator: {
      sampledCases: cases.length,
      categoryHistogram: histogram,
      subtypeHistogram,
      hazardKindHistogram: byHazard,
      selectionBucketHistogram: byBucket,
      actionChanged,
      survivalAvoided,
      survivalStillDies,
      obligationActive,
      committedMassPositive
    },
    cases,
    schemaVersion: 2,
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  const outputName = options.outputName || DEFAULT_OUTPUT;
  const written = store.writeReport(report, outputName);
  return { report, file: written.file, immutable: written.immutable };
}

module.exports = {
  DEATH_CATEGORY, collectAvoidableDeathFrames, sampleStratified, classifyCase,
  probeDeathCategories, loadPriorCases, escapeObligationSnapshot
};
