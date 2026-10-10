"use strict";

const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { SAFETY_STATUS, SAFETY_HORIZON, NONE_FATAL_FRAME, SafetyOutcomeSlab } =
  require("../../../engine-v2/src/search/information-safety-closure");

const SOFT_MODE = Object.freeze({
  CURRENT: "CURRENT",
  NO_OBSERVATION_FRONTIER: "NO_OBSERVATION_FRONTIER",
  INCOMPLETE_OBSERVATION_FRONTIER_BYPASS:
    "INCOMPLETE_OBSERVATION_FRONTIER_BYPASS",
  COMMITTED_ONLY_RISK: "COMMITTED_ONLY_RISK",
  NO_INFORMATION_ENVELOPES: "NO_INFORMATION_ENVELOPES",
  SOFT_ALL_OFF: "SOFT_ALL_OFF"
});

const MODE_FLAGS = Object.freeze({
  [SOFT_MODE.CURRENT]: Object.freeze({ observation: 0, committedOnly: 0, envelopes: 0 }),
  [SOFT_MODE.NO_OBSERVATION_FRONTIER]:
    Object.freeze({ observation: 1, committedOnly: 0, envelopes: 0 }),
  [SOFT_MODE.INCOMPLETE_OBSERVATION_FRONTIER_BYPASS]:
    Object.freeze({ observation: 2, committedOnly: 0, envelopes: 0 }),
  [SOFT_MODE.COMMITTED_ONLY_RISK]:
    Object.freeze({ observation: 0, committedOnly: 1, envelopes: 0 }),
  [SOFT_MODE.NO_INFORMATION_ENVELOPES]:
    Object.freeze({ observation: 0, committedOnly: 0, envelopes: 1 }),
  [SOFT_MODE.SOFT_ALL_OFF]:
    Object.freeze({ observation: 0, committedOnly: 1, envelopes: 1 })
});

function modeFlags(mode) {
  const normalized = mode || SOFT_MODE.CURRENT;
  if (!Object.prototype.hasOwnProperty.call(MODE_FLAGS, normalized))
    throw new Error(`SS_A0_UNKNOWN_MODE:${normalized}`);
  return MODE_FLAGS[normalized];
}

function committedOnlyRiskView(source, target, count) {
  target.reset(count);
  for (let row = 0; row < count; row += 1) {
    const base = row * SAFETY_HORIZON;
    for (let depth = 0; depth < SAFETY_HORIZON; depth += 1)
      target.committedDeathMass[base + depth] = source.committedDeathMass[base + depth];
    target.rebuildDeath(row);
    target.unknownMass[row] = 0;
    target.escapeSlack[row] = 0;
    target.coverage[row] = 10000;
    target.status[row] = target.horizonFatalMass[row] >= 10000 ?
      SAFETY_STATUS.PROVEN_DEAD : target.horizonFatalMass[row] > 0 ?
        SAFETY_STATUS.POSSIBLE_DEATH : SAFETY_STATUS.PROVEN_SAFE;
    target.committedDeadlineFrames[row] = source.committedDeadlineFrames[row];
    target.chanceSupportCount[row] = source.chanceSupportCount[row];
    target.chanceFatalSupportCount[row] = source.chanceFatalSupportCount[row];
    target.futureFireDepth[row] = NONE_FATAL_FRAME;
  }
  return target;
}

function installSoftStackAblation(engine, mode = SOFT_MODE.CURRENT) {
  const flags = modeFlags(mode);
  const installed = { mode, flags, riskView: null };
  if (mode === SOFT_MODE.CURRENT) return installed;

  if (flags.observation === 1) engine.refineObservationSafety = () => 0;
  else if (flags.observation === 2) {
    const refine = engine.refineObservationSafety.bind(engine);
    engine.refineObservationSafety = bundle =>
      engine.observationSafetySupportComplete() ? refine(bundle) : 0;
  }

  if (flags.envelopes) engine.informationSearch.applyRiskEnvelopes = () => 0;

  if (flags.committedOnly) {
    const view = new SafetyOutcomeSlab();
    const controller = engine.riskController;
    const populate = controller.populate.bind(controller);
    controller.populate = (count, hard, safety, tactical, depthSearch, informationSearch,
      enemyCount, combat, searchDivisor) => populate(count, hard,
      committedOnlyRiskView(safety, view, count), tactical, depthSearch,
      informationSearch, enemyCount, combat, searchDivisor);
    engine.multiFrameRisk.recommendedContinuation = () => ACTION.NONE;
    installed.riskView = view;
  }
  return installed;
}

module.exports = { SOFT_MODE, MODE_FLAGS, modeFlags, committedOnlyRiskView,
  installSoftStackAblation };
