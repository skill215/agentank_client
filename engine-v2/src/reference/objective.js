"use strict";

const { requireVariant, unknownRule } = require("./errors");

function spawnDueKnownStar(state, sink) {
  if (state.star !== null || state.nextStarSpawnFrame === null ||
      state.nextStarSpawnFrame > state.platformFrame) return;
  unknownRule("R2-FUTURE-STAR", "future star spawn location model is not confirmed",
    { spawnFrame: state.nextStarSpawnFrame });
}

function resolveStar(state, context, sink) {
  if (!state.star) return;
  const collectors = state.tanks.filter(tank => !tank.crashed && tank.cell[0] === state.star.cell[0] &&
    tank.cell[1] === state.star.cell[1] &&
    !(tank.pickupLockUntilFrame !== null && tank.pickupLockUntilFrame > state.platformFrame));
  if (collectors.length === 0) return;
  let winner = collectors[0];
  if (collectors.length > 1) {
    const variant = requireVariant(context, "STAR_CONTEST_V1", "R0-STAR-LIFECYCLE");
    if (variant === "NO_COLLECTION") return;
    if (variant === "COLLISION_RESULT") { collectors.forEach(tank => { tank.crashed = true; }); return; }
    winner = collectors.sort((a, b) => a.seat - b.seat)[0];
  }
  const collectedCell = [...state.star.cell]; winner.stars += 1; state.star = null;
  state.nextStarSpawnFrame = state.platformFrame + context.constants.starRespawnDelayFrames;
  sink.emit(context.phaseOrdinalById.STAR_COLLECTION, "STAR_COLLECTED",
    { actorSeat: winner.seat, cellBefore: collectedCell,
    valueAfter: winner.stars, ruleId: "R0-STAR-LIFECYCLE" });
}

module.exports = { spawnDueKnownStar, resolveStar };
