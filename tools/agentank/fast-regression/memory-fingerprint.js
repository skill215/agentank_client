"use strict";

const { fingerprintObject } = require("../core/hash");

function activeProjectileRows(tracker) {
  const rows = [];
  for (let slot = 0; slot < tracker.projectileActive.length; slot += 1)
    if (tracker.projectileActive[slot]) rows.push([slot, tracker.projectileGeneration[slot],
      tracker.projectileId[slot], tracker.projectileOwner[slot], tracker.projectileCell[slot],
      tracker.projectileDirection[slot], tracker.projectileGroup[slot],
      tracker.projectileMember[slot], tracker.projectileCreated[slot],
      tracker.projectileFact[slot], tracker.projectileMass[slot]]);
  return rows;
}

function activeBombRows(tracker) {
  const rows = [];
  for (let slot = 0; slot < tracker.bombActive.length; slot += 1)
    if (tracker.bombActive[slot]) rows.push([slot, tracker.bombGeneration[slot],
      tracker.bombId[slot], tracker.bombOwner[slot], tracker.bombCell[slot],
      tracker.bombPlaced[slot], tracker.bombEarliest[slot], tracker.bombExplode[slot],
      tracker.bombExact[slot], tracker.bombOwnerExact[slot]]);
  return rows;
}

function possibleProjectileRows(tracker) {
  const rows = [];
  for (let slot = 0; slot < tracker.active.length; slot += 1)
    if (tracker.active[slot]) rows.push([slot, tracker.pool.generation[slot],
      tracker.pool.id[slot], tracker.cell[slot], tracker.direction[slot],
      tracker.firedFrame[slot], tracker.pool.lastObserved[slot], tracker.mass[slot]]);
  return rows;
}

function decisionMemorySnapshot(engine, options = {}) {
  const adapter = engine.adapter; const tracker = adapter.tracker; const opponent = engine.policy.opponent;
  const hidden = engine.policy.hidden;
  const snapshot = {
    schemaVersion: 1,
    memoryKind: "V2_DECISION_FACT_MEMORY",
    adapter: {
      frame: adapter.lastFrame,
      width: adapter.width,
      height: adapter.height,
      terrainVersion: adapter.terrainVersion,
      mapHashLo: adapter.mapHashLo,
      mapHashHi: adapter.mapHashHi,
      lastEnemyCell: adapter.lastEnemyCell,
      lastEnemyDirection: adapter.lastEnemyDirection,
      lastEnemySeenFrame: adapter.lastEnemySeenFrame,
      enemyVisible: adapter.enemyVisible,
      informationComplete: adapter.informationComplete,
      trackerComplete: tracker.complete,
      nextEntityId: tracker.nextEntityId,
      projectiles: activeProjectileRows(tracker),
      bombs: activeBombRows(tracker)
    },
    possibleProjectiles: possibleProjectileRows(engine.possibleProjectiles),
    opponent: {
      fast: Array.from(opponent.fast), slow: Array.from(opponent.slow),
      opportunityMass: Array.from(opponent.opportunityMass),
      ambiguityMass: Array.from(opponent.ambiguityMass),
      confidence: Array.from(opponent.confidence),
      dimensionValue: Array.from(opponent.dimensionValue),
      dimensionConfidence: Array.from(opponent.dimensionConfidence),
      dimensionMass: Array.from(opponent.dimensionMass),
      matchGeneration: opponent.matchGeneration,
      epoch: opponent.epoch,
      riskPreference: opponent.riskPreference,
      riskConfidence: opponent.riskConfidence,
      updateCount: opponent.updateCount
    },
    actionHistory: {
      lastAction: engine.lastAction,
      lastArgument: engine.lastArgument,
      lastObservedCell: engine.lastObservedCell,
      lastObservedDirection: engine.lastObservedDirection,
      turnStreak: engine.turnStreak,
      goStallStreak: engine.goStallStreak,
      opponentObservationReady: engine.opponentObservationReady,
      previousEnemyCell: engine.previousEnemyCell,
      previousOwnCell: engine.previousOwnCell,
      previousEnemyDirection: engine.previousEnemyDirection,
      previousEnemyStars: engine.previousEnemyStars,
      previousEnemyProjectileCount: engine.previousEnemyProjectileCount,
      previousEnemyBombCount: engine.previousEnemyBombCount,
      previousEnemySkillReady: engine.previousEnemySkillReady,
      previousEnemyCanFire: engine.previousEnemyCanFire,
      previousFrame: engine.previousFrame
    },
    hidden: {
      cellCount: hidden.cellCount,
      generation: hidden.generation,
      flags: Array.from(hidden.flags.slice(0, hidden.cellCount)),
      shotExposure: Array.from(hidden.shotExposure.slice(0, hidden.cellCount)),
      bombExposure: Array.from(hidden.bombExposure.slice(0, hidden.cellCount)),
      beliefMass: Array.from(hidden.beliefMass.slice(0, hidden.cellCount)),
      informationGain: Array.from(hidden.informationGain.slice(0, hidden.cellCount))
    }
  };
  if (options.includeRuntime) snapshot.runtime = {
    mode: engine.runtime.runtimeMode,
    accumulatedWorkUnits: engine.runtime.accumulatedWorkUnits,
    fallbackLatched: engine.runtime.fallbackLatched,
    matchRuntimeGeneration: engine.runtime.matchRuntimeGeneration,
    callbackCount: engine.runtime.callbackCount
  };
  return snapshot;
}

function decisionMemoryFingerprint(engine, options = {}) {
  return fingerprintObject(decisionMemorySnapshot(engine, options));
}

module.exports = { activeProjectileRows, activeBombRows, possibleProjectileRows,
  decisionMemorySnapshot, decisionMemoryFingerprint };
