"use strict";

const { DELTAS } = require("./codes");

function hiddenTank(state, tank) {
  if (tank.revealUntilFrame !== null && tank.revealUntilFrame > state.platformFrame) return false;
  if (tank.cloakUntilFrame !== null && tank.cloakUntilFrame > state.platformFrame) return true;
  return state.map.terrainColumnMajor[tank.cell[0]][tank.cell[1]] === "o";
}

function inForwardCone(observer, cell) {
  const delta = DELTAS[observer.direction]; const dx = cell[0] - observer.cell[0];
  const dy = cell[1] - observer.cell[1]; const forward = dx * delta[0] + dy * delta[1];
  const lateral = Math.abs(dx * delta[1] - dy * delta[0]);
  return forward > 0 && forward >= lateral;
}

function lineVisible(state, from, to) {
  let x = from[0]; let y = from[1]; const dx = to[0] - x; const dy = to[1] - y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return true;
  for (let index = 1; index < steps; index += 1) {
    const cellX = x + Math.round(dx * index / steps); const cellY = y + Math.round(dy * index / steps);
    const tile = state.map.terrainColumnMajor[cellX]?.[cellY];
    if (tile === "x" || tile === "m") return false;
  }
  return true;
}

function publicTank(tank) {
  return { entityId: tank.entityId, seat: tank.seat, cell: [...tank.cell], direction: tank.direction,
    crashed: tank.crashed, stars: tank.stars, skillId: tank.skillId,
    skillReadyFrame: tank.skillReadyFrame, shielded: tank.shieldHitsRemaining > 0,
    frozen: tank.frozenUntilFrame !== null, stunned: tank.stunUntilFrame !== null,
    poisoned: tank.poisonUntilFrame !== null, cloaked: tank.cloakUntilFrame !== null,
    boosted: tank.boostUntilFrame !== null, overloaded: tank.overloadUntilFrame !== null };
}

function observeForSide(state, seat, context) {
  const observer = state.tanks[seat]; const enemy = state.tanks[seat ^ 1];
  const visibleProjectiles = state.projectiles.filter(projectile => projectile.active &&
    projectile.ownerSeat !== seat && inForwardCone(observer, projectile.cell) &&
    lineVisible(state, observer.cell, projectile.cell)).map(projectile => ({ entityId: projectile.entityId,
      cell: [...projectile.cell], direction: projectile.direction, ownerSeat: projectile.ownerSeat }));
  const visibleBombs = state.bombs.filter(bomb => bomb.active &&
    state.map.terrainColumnMajor[bomb.cell[0]][bomb.cell[1]] !== "o").map(bomb => ({
      entityId: bomb.entityId, ownerSeat: bomb.ownerSeat, cell: [...bomb.cell] }));
  const alternatives = visibleProjectiles.length === 0 ? [null] : visibleProjectiles.map(item => item);
  const revealVariantNeeded = enemy.revealUntilFrame !== null &&
    enemy.revealUntilFrame <= state.platformFrame + 1 &&
    context.activeVariantByGroup.TELEPORT_REVEAL_DEADLINE_V1 === null;
  return { observerSeat: seat, ownTank: publicTank(observer),
    enemyTank: hiddenTank(state, enemy) ? null : publicTank(enemy),
    enemyProjectileAlternatives: alternatives, visibleBombs,
    star: state.star ? [...state.star.cell] : null,
    complete: !revealVariantNeeded,
    incompleteReason: revealVariantNeeded ? "INCOMPLETE_UNKNOWN_RULE" : null,
    relationKind: alternatives.length > 1 ? "OBSERVED_ONE_OF_VISIBLE_PROJECTILES" : "EXACT" };
}

module.exports = { hiddenTank, inForwardCone, lineVisible, publicTank, observeForSide };
