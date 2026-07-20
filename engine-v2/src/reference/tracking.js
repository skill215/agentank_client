"use strict";

const { associateEntities, enumerateAssignments, sameExternalKey } = require("./association");
const { FIELD } = require("./codes");
const { signature, createPhysicalState, createInformationState } = require("./state");

function createTrackedState(spec = {}) {
  return { trackedFrame: spec.trackedFrame ?? null, trackEpoch: spec.trackEpoch ?? 1,
    matchIdentity: spec.matchIdentity ?? null, rulesetVersion: spec.rulesetVersion ?? null,
    ownSubmittedQueue: structuredClone(spec.ownSubmittedQueue ?? []),
    projectiles: structuredClone(spec.projectiles ?? []), bombs: structuredClone(spec.bombs ?? []),
    lastVisibleTankPoseBySeat: structuredClone(spec.lastVisibleTankPoseBySeat ?? [null, null]),
    associationRelations: [], hiddenEntityConstraints: structuredClone(spec.hiddenEntityConstraints ?? []),
    lastObservationSignatureBySide: structuredClone(spec.lastObservationSignatureBySide ?? [null, null]) };
}

function reconcileTrackedState(committed, root, options = {}) {
  if (committed.trackedFrame !== null && root.platformFrame < committed.trackedFrame) {
    return { status: "TRACK_REBUILD_REQUIRED", reason: "FRAME_REGRESSION",
      shadow: createTrackedState({ trackedFrame: root.platformFrame,
        trackEpoch: committed.trackEpoch + 1, rulesetVersion: root.rulesetVersion }) };
  }
  if (committed.rulesetVersion !== null && committed.rulesetVersion !== root.rulesetVersion) {
    return { status: "TRACK_REBUILD_REQUIRED", reason: "RULESET_CHANGED",
      shadow: createTrackedState({ trackedFrame: root.platformFrame,
        trackEpoch: committed.trackEpoch + 1, rulesetVersion: root.rulesetVersion }) };
  }
  const gap = committed.trackedFrame === null ? 0 : root.platformFrame - committed.trackedFrame;
  const projectiles = associateEntities(root.projectileRecords, committed.projectiles, "projectile", gap);
  const bombs = associateEntities(root.bombs.records, committed.bombs, "bomb", gap);
  const projectileAssignments = enumerateAssignments(projectiles, options.maxAssociations ?? 256);
  const bombAssignments = enumerateAssignments(bombs, options.maxAssociations ?? 256);
  const complete = projectileAssignments.complete && bombAssignments.complete;
  const shadow = structuredClone(committed);
  shadow.trackedFrame = root.platformFrame;
  shadow.rulesetVersion = root.rulesetVersion;
  shadow.associationRelations = [projectiles, bombs];
  shadow.lastObservationSignatureBySide[root.observerSeat] = root.observationSignature;
  for (const tank of root.tanks) {
    if (tank.tankFieldStatus === "FIELD_PRESENT") {
      shadow.lastVisibleTankPoseBySeat[tank.seat] = { cell: [...tank.cell], direction: tank.direction,
        frame: root.platformFrame };
    }
  }
  shadow.trackingSignature = signature(shadow);
  return { status: complete ? "TRACK_RECONCILED" : "TRACK_INCOMPLETE_CAPACITY", shadow,
    associations: { projectiles, bombs, projectileAssignments, bombAssignments }, complete,
    incompleteReason: complete ? null : "INCOMPLETE_ASSOCIATION_CAPACITY" };
}

function commitTrackedState(committed, reconciliation) {
  if (reconciliation.status !== "TRACK_RECONCILED") return committed;
  return structuredClone(reconciliation.shadow);
}

function observedTankSpec(observed, fallbackPose = null) {
  const pose = observed.tankFieldStatus === FIELD.PRESENT ? observed : fallbackPose;
  if (!pose?.cell || !pose?.direction || observed.starsFieldStatus !== FIELD.PRESENT ||
      observed.skill.fieldStatus !== FIELD.PRESENT) return null;
  const shield = observed.status.shielded;
  if (shield.status !== FIELD.PRESENT || shield.value === true) return null;
  return { seat: observed.seat, cell: [...pose.cell], direction: pose.direction,
    crashed: observed.crashed ?? false, stars: observed.stars, skillId: observed.skill.type,
    skillReadyFrame: observed.skill.readyFrame, shieldHitsRemaining: 0,
    shieldUntilFrame: null, frozenUntilFrame: null, stunUntilFrame: null,
    overloadUntilFrame: null, cloakUntilFrame: null, poisonAppliedFrame: null,
    poisonUntilFrame: null, boostUntilFrame: null, revealUntilFrame: null,
    pickupLockUntilFrame: null, fireLockUntilFrame: null,
    bombCooldownReadyFrame: observed.status.bombCooldownReadyFrame ?? 0,
    canActThisFrame: observed.status.canActThisFrame.value ?? true,
    actionSpeedClass: observed.status.actionSpeed ?? 1, queue: [] };
}

function materializeProjectiles(root, committed, assignment, nextId) {
  const entities = structuredClone(committed.projectiles);
  for (const relation of assignment) {
    const observed = root.projectileRecords[relation.observedIndex];
    if (relation.trackedIndex === null) entities.push({ entityId: nextId.value++,
      ownerSeat: observed.ownerSeat, cell: [...observed.cell], direction: observed.direction,
      active: true, shotGroupId: nextId.value - 1, memberIndex: 0,
      createdFrame: root.platformFrame });
    else Object.assign(entities[relation.trackedIndex], { cell: [...observed.cell],
      direction: observed.direction, active: true });
  }
  return entities;
}

function materializeBombs(root, committed, assignment, nextId, context) {
  const entities = structuredClone(committed.bombs);
  for (const relation of assignment) {
    const observed = root.bombs.records[relation.observedIndex];
    if (relation.trackedIndex === null) {
      if (observed.explodeInterval[0] !== observed.explodeInterval[1]) return null;
      const owner = root.tanks.find(tank => sameExternalKey(tank.externalKey, observed.ownerKey));
      if (!owner) return null;
      entities.push({ entityId: nextId.value++, ownerSeat: owner.seat, cell: [...observed.cell],
        placedFrame: observed.explodeInterval[0] - context.constants.bombFuseFrames,
        explodeFrame: observed.explodeInterval[0],
        active: true, visibility: "VISIBLE_OPEN" });
    } else Object.assign(entities[relation.trackedIndex], { cell: [...observed.cell], active: true });
  }
  return entities;
}

function reconcileToSearchState(root, committed, reconciliation, context) {
  if (root.rootStatus === "ROOT_INVALID_INPUT" || !reconciliation.complete) return {
    status: "SEARCH_STATE_INCOMPLETE", searchState: null,
    incompleteReasons: [...root.incompleteReasons, reconciliation.incompleteReason].filter(Boolean) };
  const tankSpecs = root.tanks.map(observed => observedTankSpec(observed,
    committed.lastVisibleTankPoseBySeat[observed.seat]));
  if (tankSpecs.some(item => item === null)) return { status: "SEARCH_STATE_INCOMPLETE",
    searchState: null, incompleteReasons: ["INCOMPLETE_TANK_PHYSICAL_SUPPORT"] };
  const projectileAssignments = reconciliation.associations.projectileAssignments.assignments;
  const bombAssignments = reconciliation.associations.bombAssignments.assignments;
  const worlds = []; const incompleteReasons = [];
  for (const projectileAssignment of projectileAssignments) {
    for (const bombAssignment of bombAssignments) {
      const existingIds = [...committed.projectiles, ...committed.bombs]
        .map(entity => entity.entityId).filter(Number.isSafeInteger);
      const nextId = { value: Math.max(2, ...existingIds) + 1 };
      const projectiles = materializeProjectiles(root, committed, projectileAssignment, nextId);
      const bombs = materializeBombs(root, committed, bombAssignment, nextId, context);
      if (bombs === null) { incompleteReasons.push("INCOMPLETE_BOMB_EXPLOSION_INTERVAL"); continue; }
      worlds.push(createPhysicalState({ platformFrame: root.platformFrame,
        recordIndex: root.platformFrame, map: { width: root.map.width, height: root.map.height,
          terrainColumnMajor: root.map.terrainColumnMajor }, tanks: tankSpecs,
        projectiles, bombs, star: root.star.fieldStatus === FIELD.PRESENT ? root.star.cell : null,
        assumptionIds: [] }, context));
    }
  }
  if (worlds.length === 0) return { status: "SEARCH_STATE_INCOMPLETE", searchState: null,
    incompleteReasons: incompleteReasons.length ? [...new Set(incompleteReasons)] :
      ["INCOMPLETE_ASSOCIATION_SUPPORT"] };
  const hiddenTank = root.tanks.some(tank => tank.tankFieldStatus === FIELD.NULL);
  const ambiguous = reconciliation.associations.projectiles.ambiguous ||
    reconciliation.associations.bombs.ambiguous;
  if (!hiddenTank && !ambiguous && worlds.length === 1) return {
    status: "SEARCH_STATE_PHYSICAL", searchState: worlds[0], incompleteReasons: [] };
  if (hiddenTank) incompleteReasons.push("HIDDEN_ENEMY_MOTION_SUPPORT_UNEXPANDED");
  const information = createInformationState({ worlds,
    residualSupport: hiddenTank ? [{ kind: "HIDDEN_ENEMY_MOTION_SUPPORT" }] : [],
    associationRelations: reconciliation.shadow.associationRelations,
    observationHistorySignature: root.observationSignature,
    complete: incompleteReasons.length === 0,
    incompleteReasons: [...new Set(incompleteReasons)] });
  return { status: "SEARCH_STATE_INFORMATION", searchState: information,
    incompleteReasons: information.incompleteReasons };
}

module.exports = { createTrackedState, reconcileTrackedState, commitTrackedState,
  observedTankSpec, materializeProjectiles, materializeBombs, reconcileToSearchState };
