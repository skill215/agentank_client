"use strict";

const { ProductionRootEngine, ROOT_STATUS } =
  require("../../../engine-v2/src/runtime/production-root");
const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");

const ACTION_NAME = Object.freeze(Object.fromEntries(Object.entries(ACTION).map(([name, value]) => [value, name])));
const ROOT_NAME = Object.freeze(Object.fromEntries(Object.entries(ROOT_STATUS).map(([name, value]) => [value, name])));
const HARD_NAME = Object.freeze(Object.fromEntries(Object.entries(HARD_STATUS).map(([name, value]) => [value, name])));
const PROOF_NAME = Object.freeze(Object.fromEntries(Object.entries(PROOF_STATUS).map(([name, value]) => [value, name])));

function actionProxy(snapshot, actions) {
  const proxy = {
    tank: snapshot.tank, stars: snapshot.stars, bullet: snapshot.bullet,
    skill: snapshot.skill, status: snapshot.status, effects: snapshot.effects,
    go() { actions.push({ type: "go" }); },
    turn(side) { actions.push({ type: "turn", side: side === "left" ? "left" : "right" }); },
    fire() { actions.push({ type: "fire" }); },
    throwBomb() { actions.push({ type: "throwBomb" }); }
  };
  const skill = snapshot.skill?.type;
  if (skill) proxy[skill] = (...values) => actions.push(skill === "teleport" ?
    { type: skill, x: Number(values[0]), y: Number(values[1]) } : { type: skill });
  return proxy;
}

function percentile(values, numerator) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * numerator / 100))];
}

function diagnosticCopy(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

class ProductionDiagnosticBot {
  constructor(options = {}) {
    this.engine = new ProductionRootEngine(options.engine || options);
    this.captureAllFrames = Boolean(options.captureAllFrames);
    this.captureActionFrames = Boolean(options.captureActionFrames || options.captureAllFrames);
    this.runtimeMicros = []; this.frames = []; this.actionCounts = {};
    this.diagnosticFrames = []; this.actionFrames = [];
    this.rootCounts = {}; this.runtimeModeCounts = {};
    this.exceptionalFrameCount = 0;
    this.hardSelectedRejectCount = 0; this.avoidableHardRejectCount = 0;
    this.unavoidableAllRejectedCount = 0; this.rootRestoreFailures = 0;
    this.riskDominatedSelectionCount = 0;
  }
  decide(context) {
    const actions = []; const me = actionProxy(context.me, actions);
    const beforeHard = this.engine.hardRejectAvoided;
    const beforeRestore = this.engine.depthSearch.rootRestoreFailures;
    const beforeInformationRestore = this.engine.informationSearch.rootRestoreFailures;
    const beforeProofRestore = this.engine.forcedWinSearch.rootRestoreFailures;
    const beforeSafetyRestore = this.engine.observationSafety.rootRestoreFailures;
    const beforeFallback = this.engine.fallbackCount;
    const beforeInvalid = this.engine.invalidRootCount;
    const beforeDominated = this.engine.riskDominatedSelectionCount;
    const beforeWorkUnits = this.engine.runtime.accumulatedWorkUnits;
    const started = process.hrtime.bigint();
    const returned = this.engine.decide(me, context.enemy, context.game);
    const runtimeMicros = Number((process.hrtime.bigint() - started) / 1000n);
    const action = actions[0] || null; const actionName = ACTION_NAME[returned] || `ACTION_${returned}`;
    const rootName = ROOT_NAME[this.engine.lastRootStatus] || String(this.engine.lastRootStatus);
    this.runtimeMicros.push(runtimeMicros);
    this.actionCounts[actionName] = (this.actionCounts[actionName] || 0) + 1;
    this.rootCounts[rootName] = (this.rootCounts[rootName] || 0) + 1;
    const runtimeMode = this.engine.runtime.runtimeMode;
    this.runtimeModeCounts[runtimeMode] = (this.runtimeModeCounts[runtimeMode] || 0) + 1;
    let selectedHard = "NOT_INDEXED"; let allowCount = 0;
    for (let index = 0; index < this.engine.ourCount; index += 1) {
      if (this.engine.hardStatus[index] === HARD_STATUS.ALLOW) allowCount += 1;
      if (this.engine.ourActions[index] === returned) {
        selectedHard = HARD_NAME[this.engine.hardStatus[index]] || String(this.engine.hardStatus[index]);
      }
    }
    if (selectedHard === "REJECT_PROVEN") {
      this.hardSelectedRejectCount += 1;
      if (allowCount > 0) this.avoidableHardRejectCount += 1;
      else this.unavoidableAllRejectedCount += 1;
    }
    this.rootRestoreFailures += this.engine.depthSearch.rootRestoreFailures - beforeRestore;
    this.rootRestoreFailures += this.engine.informationSearch.rootRestoreFailures -
      beforeInformationRestore;
    this.rootRestoreFailures += this.engine.forcedWinSearch.rootRestoreFailures - beforeProofRestore;
    this.rootRestoreFailures += this.engine.observationSafety.rootRestoreFailures - beforeSafetyRestore;
    this.riskDominatedSelectionCount += this.engine.riskDominatedSelectionCount - beforeDominated;
    const frame = {
      frame: context.game.frames,
      action: actionName,
      root: rootName,
      informationComplete: Boolean(this.engine.adapter.informationComplete),
      selectedHard, allowCount,
      hardRejects: this.engine.hardRejectAvoided - beforeHard,
      proof: PROOF_NAME[this.engine.lastProofStatus] || String(this.engine.lastProofStatus),
      proofCompletedDepth: this.engine.forcedWinSearch.completedDepth,
      proofNodes: this.engine.forcedWinSearch.nodes,
      completedDepth: Math.max(this.engine.depthSearch.completedDepth,
        this.engine.informationSearch.completedDepth),
      physicalCompletedDepth: this.engine.depthSearch.completedDepth,
      informationCompletedDepth: this.engine.informationSearch.completedDepth,
      informationWorlds: this.engine.informationSearch.worldsEvaluated,
      informationSupportComplete: Boolean(this.engine.informationSearch.supportComplete),
      possibleProjectileCount: this.engine.possibleProjectiles.count(),
      possibleProjectileRisk: this.engine.possibleShotRisk(
        this.engine.adapter.state.arrays[
          require("../../../engine-v2/src/state/fast-state").ARRAY.TANK_CELL][0]),
      depthNodes: this.engine.depthSearch.nodes + this.engine.informationSearch.nodes,
      depthCacheHits: this.engine.depthSearch.cacheHits,
      score: this.engine.lastScore,
      runtimeMode: this.engine.runtime.runtimeMode,
      fallback: this.engine.fallbackCount > beforeFallback,
      invalidFallback: this.engine.invalidRootCount > beforeInvalid,
      runtimeMicros,
      workUnits: this.engine.runtime.accumulatedWorkUnits - beforeWorkUnits
    };
    if (this.captureActionFrames) this.actionFrames.push({ frame: frame.frame,
      action: frame.action, command: action ? diagnosticCopy(action) : null,
      workUnits: frame.workUnits, root: frame.root, informationComplete: frame.informationComplete,
      selectedHard: frame.selectedHard, allowCount: frame.allowCount, proof: frame.proof,
      proofCompletedDepth: frame.proofCompletedDepth, proofNodes: frame.proofNodes,
      completedDepth: frame.completedDepth, depthNodes: frame.depthNodes,
      score: frame.score, runtimeMode: frame.runtimeMode, fallback: frame.fallback,
      invalidFallback: frame.invalidFallback, runtimeMicros: frame.runtimeMicros });
    if (this.captureAllFrames) {
      const candidates = [];
      for (let index = 0; index < this.engine.ourCount; index += 1) {
        const depthSource = this.engine.informationSearch.completedDepth > 0 ?
          this.engine.informationSearch : this.engine.depthSearch;
        const enemyScores = []; let worstEnemyIndex = -1; let worstEnemyScore = 32001;
        for (let enemyIndex = 0; enemyIndex < this.engine.enemyCount; enemyIndex += 1) {
          const value = depthSource.rootCellScore[index * 24 + enemyIndex];
          enemyScores.push([ACTION_NAME[this.engine.enemyActions[enemyIndex]] ||
            `ACTION_${this.engine.enemyActions[enemyIndex]}`, value]);
          if (value < worstEnemyScore) { worstEnemyScore = value; worstEnemyIndex = enemyIndex; }
        }
        candidates.push({
          action: ACTION_NAME[this.engine.ourActions[index]] || `ACTION_${this.engine.ourActions[index]}`,
          hard: HARD_NAME[this.engine.hardStatus[index]] || String(this.engine.hardStatus[index]),
          score: this.engine.score[index], depthScore: this.engine.depthSearch.rootScore[index],
          informationScore: this.engine.informationSearch.rootScore[index],
          safety: this.engine.safetyClosure.outcome.status[index],
          immediateFatalMass: this.engine.riskController.outcome.immediateFatalMass[index],
          horizonFatalMass: this.engine.riskController.outcome.horizonFatalMass[index],
          unknownMass: this.engine.riskController.outcome.unknownMass[index],
          escapeSlack: this.engine.riskController.outcome.escapeSlack[index],
          acceptable: Boolean(this.engine.riskController.outcome.acceptable[index]),
          dominated: Boolean(this.engine.riskController.outcome.dominated[index]),
          robustLower: this.engine.riskController.outcome.robustLower[index],
          combatPurpose: this.engine.riskController.outcome.combatPurpose[index],
          hitDeadline: this.engine.riskController.outcome.hitDeadline[index],
          enemySafeSuccessors: this.engine.riskController.outcome.enemySafeSuccessors[index],
          ownCounterExposure: this.engine.riskController.outcome.ownCounterExposure[index],
          blockadeValue: this.engine.riskController.outcome.blockadeValue[index],
          purposeCompleteness: this.engine.riskController.outcome.purposeCompleteness[index],
          postFireEscape: this.engine.riskController.outcome.postFireEscape[index],
          combatPressure: this.engine.riskController.outcome.combatPressure[index],
          policyProbability: this.engine.policyProbability[index],
          worstEnemyAction: worstEnemyIndex < 0 ? null :
            ACTION_NAME[this.engine.enemyActions[worstEnemyIndex]], enemyScores
        });
      }
      const ownPosition = context.me?.tank?.position; const enemyPosition = context.enemy?.tank?.position;
      const star = context.game?.star;
      frame.state = { ownPosition: Array.isArray(ownPosition) ? ownPosition.slice() : null,
        ownDirection: context.me?.tank?.direction || null, ownStars: context.me?.stars || 0,
        enemyPosition: Array.isArray(enemyPosition) ? enemyPosition.slice() : null,
        enemyDirection: context.enemy?.tank?.direction || null, enemyStars: context.enemy?.stars || 0,
        star: Array.isArray(star) ? star.slice() : null,
        ownBullet: diagnosticCopy(context.me?.bullet),
        enemyBullet: diagnosticCopy(context.enemy?.bullet),
        bombs: diagnosticCopy(context.game?.bombs) };
      frame.candidates = candidates; this.diagnosticFrames.push(frame);
    }
    if (frame.root !== "OK" || frame.selectedHard !== "ALLOW" || frame.fallback ||
        frame.proof === "PROVEN" || frame.completedDepth === 0) {
      this.exceptionalFrameCount += 1;
      if (this.frames.length < 32) this.frames.push(frame);
    }
    return { action, logs: [], runtimeMs: runtimeMicros / 1000 };
  }
  summary() {
    const engine = this.engine; const total = this.runtimeMicros.reduce((sum, value) => sum + value, 0);
    const summary = {
      decisionCount: engine.decisionCount,
      totalRuntimeMicros: total,
      p50RuntimeMicros: percentile(this.runtimeMicros, 50),
      p95RuntimeMicros: percentile(this.runtimeMicros, 95),
      maxRuntimeMicros: this.runtimeMicros.length ? Math.max(...this.runtimeMicros) : 0,
      actionCounts: this.actionCounts,
      runtimeModeCounts: this.runtimeModeCounts,
      accumulatedWorkUnits: engine.runtime.accumulatedWorkUnits,
      opponent: { updateCount: engine.policy.opponent.updateCount,
        riskPreference: engine.policy.opponent.riskPreference,
        riskConfidence: engine.policy.opponent.riskConfidence },
      exceptionalFrameCount: this.exceptionalFrameCount,
      layerTotals: {
        rootCounts: this.rootCounts,
        hardRejects: engine.hardRejectAvoided,
        selectedHardRejects: this.hardSelectedRejectCount,
        avoidableHardRejects: this.avoidableHardRejectCount,
        unavoidableAllRejected: this.unavoidableAllRejectedCount,
        proofWins: engine.forcedWinCount,
        noAcceptableActions: engine.noAcceptableActionCount,
        riskDominatedSelections: this.riskDominatedSelectionCount,
        stageMatrixSolves: engine.stageMatrixSolveCount,
        fallbacks: engine.fallbackCount,
        depthRootRestoreFailures: this.rootRestoreFailures,
        hotAllocations: engine.hotAllocationCount + engine.depthSearch.hotAllocationCount +
          engine.informationSearch.hotAllocationCount + engine.forcedWinSearch.hotAllocationCount +
          engine.path.hotAllocationCount + engine.combat.hotAllocationCount +
          engine.combat.vector.hotAllocationCount + engine.safetyClosure.hotAllocationCount +
          engine.safetyClosure.outcome.hotAllocationCount +
          engine.threatCapability.hotAllocationCount +
          engine.observationSafety.hotAllocationCount +
          engine.observationSafety.stateArena.hotAllocationCount
      },
      exceptionalFrames: this.frames
    };
    if (this.captureActionFrames) summary.actionFrames = this.actionFrames;
    if (this.captureAllFrames) summary.diagnosticFrames = this.diagnosticFrames;
    return summary;
  }
}

module.exports = { ACTION_NAME, ROOT_NAME, HARD_NAME, PROOF_NAME, actionProxy, diagnosticCopy,
  ProductionDiagnosticBot };
