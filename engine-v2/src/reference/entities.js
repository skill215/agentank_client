"use strict";

const { DELTAS } = require("./codes");
const { requireVariant } = require("./errors");

function cellKey(cell) { return `${cell[0]},${cell[1]}`; }
function nextCell(entity) { const delta = DELTAS[entity.direction]; return [entity.cell[0] + delta[0], entity.cell[1] + delta[1]]; }
function tankAt(state, cell) { return state.tanks.find(tank => !tank.crashed && tank.cell[0] === cell[0] && tank.cell[1] === cell[1]); }

function absorbProjectile(tank, projectile, state, sink, phase, substep) {
  if (tank.shieldHitsRemaining > 0 && tank.shieldUntilFrame !== null &&
      tank.shieldUntilFrame > state.platformFrame) {
    const before = tank.shieldHitsRemaining; tank.shieldHitsRemaining -= 1;
    sink.emit(phase, "SHIELD_HIT", { substepOrdinal: substep, actorSeat: projectile.ownerSeat,
      targetSeat: tank.seat, entitySemanticId: tank.entityId,
      sourceEntitySemanticId: projectile.entityId, valueBefore: before,
      valueAfter: tank.shieldHitsRemaining, reasonCode: "PROJECTILE", ruleId: "R1-SHIELD" });
    if (tank.shieldHitsRemaining === 0) {
      tank.shieldUntilFrame = null;
      sink.emit(phase, "SKILL_EXPIRED", { substepOrdinal: substep, actorSeat: tank.seat,
        reasonCode: "SHIELD_CHARGES_CONSUMED", ruleId: "R1-SHIELD" });
    }
  } else {
    tank.crashed = true;
    sink.emit(phase, "TANK_CRASHED", { substepOrdinal: substep, actorSeat: projectile.ownerSeat,
      targetSeat: tank.seat, entitySemanticId: tank.entityId,
      sourceEntitySemanticId: projectile.entityId, reasonCode: "PROJECTILE",
      ruleId: "R0-PROJECTILE-LIFECYCLE" });
  }
}

function stopProjectile(projectile, reason, sink, phase, substep) {
  projectile.active = false;
  sink.emit(phase, "PROJECTILE_DESTROYED", { substepOrdinal: substep,
    actorSeat: projectile.ownerSeat, entitySemanticId: projectile.entityId,
    cellBefore: [...projectile.cell], reasonCode: reason, ruleId: "R0-PROJECTILE-LIFECYCLE" });
}

function advanceProjectiles(state, context, sink) {
  for (let substep = 0; substep < context.constants.projectileStepsPerFrame; substep += 1) {
    const phase = context.phaseOrdinalById[`PROJECTILE_SUBSTEP_${substep}`];
    const active = state.projectiles.filter(projectile => projectile.active).sort((a, b) => a.entityId - b.entityId);
    const targets = new Map();
    for (const projectile of active) {
      const key = cellKey(nextCell(projectile));
      if (!targets.has(key)) targets.set(key, []);
      targets.get(key).push(projectile);
    }
    if ([...targets.values()].some(group => group.length > 1 && (() => {
      const cell = nextCell(group[0]); const tile = state.map.terrainColumnMajor[cell[0]]?.[cell[1]];
      return tile === "m" || Boolean(tankAt(state, cell));
    })())) requireVariant(context, "PROJECTILE_SHARED_RESOURCE_V1", "R0-PROJECTILE-LIFECYCLE");
    for (const projectile of active) {
      const before = [...projectile.cell]; const target = nextCell(projectile);
      if (target[0] < 0 || target[0] >= state.map.width || target[1] < 0 || target[1] >= state.map.height) {
        stopProjectile(projectile, "BOUNDARY", sink, phase, substep); continue;
      }
      projectile.cell = target;
      sink.emit(phase, "PROJECTILE_MOVED", { substepOrdinal: substep, actorSeat: projectile.ownerSeat,
        entitySemanticId: projectile.entityId, cellBefore: before, cellAfter: [...target],
        ruleId: "R0-PROJECTILE-LIFECYCLE" });
      const tile = state.map.terrainColumnMajor[target[0]][target[1]];
      if (tile === "x") { stopProjectile(projectile, "WALL", sink, phase, substep); continue; }
      if (tile === "m") {
        state.map.terrainColumnMajor[target[0]][target[1]] = ".";
        state.map.terrainVersion += 1; state.map.topologyVersion += 1;
        sink.emit(phase, "TERRAIN_DESTROYED", { substepOrdinal: substep,
          actorSeat: projectile.ownerSeat, sourceEntitySemanticId: projectile.entityId,
          cellBefore: [...target], cellAfter: [...target], valueBefore: "m", valueAfter: ".",
          reasonCode: "PROJECTILE", ruleId: "R0-PROJECTILE-LIFECYCLE" });
        stopProjectile(projectile, "DIRT", sink, phase, substep); continue;
      }
      const tank = tankAt(state, target);
      if (tank) { absorbProjectile(tank, projectile, state, sink, phase, substep);
        stopProjectile(projectile, "TANK", sink, phase, substep); }
    }
  }
}

function blastCells(state, bomb, range) {
  const output = [[...bomb.cell]];
  for (const delta of Object.values(DELTAS)) {
    for (let distance = 1; distance <= range; distance += 1) {
      const cell = [bomb.cell[0] + delta[0] * distance, bomb.cell[1] + delta[1] * distance];
      if (cell[0] < 0 || cell[0] >= state.map.width || cell[1] < 0 || cell[1] >= state.map.height) break;
      const tile = state.map.terrainColumnMajor[cell[0]][cell[1]];
      if (tile === "x") break;
      output.push(cell);
      if (tile === "m") break;
    }
  }
  return output;
}

function applyBombDamage(state, bomb, cells, context, sink) {
  const phase = context.phaseOrdinalById.BOMB_RESOLUTION;
  for (const cell of cells) {
    if (state.map.terrainColumnMajor[cell[0]][cell[1]] === "m") {
      state.map.terrainColumnMajor[cell[0]][cell[1]] = ".";
      state.map.terrainVersion += 1; state.map.topologyVersion += 1;
      sink.emit(phase, "TERRAIN_DESTROYED", { actorSeat: bomb.ownerSeat,
        sourceEntitySemanticId: bomb.entityId, cellBefore: [...cell], cellAfter: [...cell],
        valueBefore: "m", valueAfter: ".", reasonCode: "BOMB", ruleId: "R0-BOMB-LIFECYCLE" });
    }
    for (const tank of state.tanks.filter(item => !item.crashed && item.cell[0] === cell[0] && item.cell[1] === cell[1])) {
      if (tank.shieldHitsRemaining > 0 && tank.shieldUntilFrame !== null && tank.shieldUntilFrame > state.platformFrame) {
        const before = tank.shieldHitsRemaining; tank.shieldHitsRemaining = 0; tank.shieldUntilFrame = null;
        sink.emit(phase, "SHIELD_HIT", { actorSeat: bomb.ownerSeat, targetSeat: tank.seat,
          sourceEntitySemanticId: bomb.entityId, valueBefore: before, valueAfter: 0,
          reasonCode: "BOMB_CONSUME", ruleId: "R1-SHIELD" });
      } else {
        tank.crashed = true;
        sink.emit(phase, "TANK_CRASHED", { actorSeat: bomb.ownerSeat, targetSeat: tank.seat,
          entitySemanticId: tank.entityId, sourceEntitySemanticId: bomb.entityId,
          reasonCode: "BOMB", ruleId: "R0-BOMB-LIFECYCLE" });
      }
    }
  }
}

function resolveDueBombs(state, context, sink) {
  const due = state.bombs.filter(bomb => bomb.active && bomb.explodeFrame <= state.platformFrame)
    .sort((a, b) => a.entityId - b.entityId);
  if (due.length > 1) requireVariant(context, "MULTI_BOMB_BATCH_V1", "R0-BOMB-LIFECYCLE");
  const batchTerrain = due.length > 1 && context.activeVariantByGroup.MULTI_BOMB_BATCH_V1 ===
    "BATCH_START_TERRAIN" ? structuredClone(state.map.terrainColumnMajor) : null;
  for (const bomb of due) {
    const terrain = state.map.terrainColumnMajor;
    if (batchTerrain) state.map.terrainColumnMajor = structuredClone(batchTerrain);
    const cells = blastCells(state, bomb, context.constants.bombBlastRange);
    if (batchTerrain) state.map.terrainColumnMajor = terrain;
    bomb.active = false;
    sink.emit(context.phaseOrdinalById.BOMB_RESOLUTION, "BOMB_EXPLODED", { actorSeat: bomb.ownerSeat,
      entitySemanticId: bomb.entityId, cellBefore: [...bomb.cell], ruleId: "R0-BOMB-LIFECYCLE" });
    applyBombDamage(state, bomb, cells, context, sink);
    state.tanks[bomb.ownerSeat].bombCooldownReadyFrame = state.platformFrame +
      context.constants.bombCooldownAfterExplosionFrames;
  }
}

module.exports = { cellKey, nextCell, tankAt, absorbProjectile, stopProjectile,
  advanceProjectiles, blastCells, applyBombDamage, resolveDueBombs };
