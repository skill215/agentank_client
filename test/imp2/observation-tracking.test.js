"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ref = require("../../engine-v2/src/reference");

const root = path.resolve(__dirname, "../..");
const context = ref.createRuleContext(ref.loadRuleCorpus(root));
function side(id, position, direction, skill) {
  return { tank: position === null ? null : { id, position, direction, crashed: false }, stars: 1,
    bullet: null, skill: { type: skill, cooldownFrames: 20,
      remainingCooldownFrames: 0, activeRemainingFrames: 0, activeType: null },
    effects: { self: null, debuff: null }, status: { shielded: false, cloaked: false,
      boosted: false, overloaded: false, frozen: false, stunned: false, poisoned: false,
      fireLocked: false, actionSpeed: 1, canActThisFrame: true } };
}

test("ObservationAdapter integerizes platform input without retaining mutable platform references", () => {
  const me = side("secret-object-me", [1, 1], "right", "poison");
  const enemy = side("secret-object-enemy", [5, 3], "left", "stun");
  enemy.bullet = { id: "bullet-source-id", position: [4, 3], direction: "left" };
  const game = { frames: 9, map: ref.boxedMap(), star: [3, 2], bombs: [] };
  const observed = ref.adaptObservedRoot(me, enemy, game, context);
  me.tank.position[0] = 4; enemy.bullet.position[0] = 1;
  assert.deepEqual(observed.tanks[0].cell, [1, 1]);
  assert.deepEqual(observed.projectileRecords[0].cell, [4, 3]);
  assert.doesNotMatch(JSON.stringify(observed), /secret-object|bullet-source-id/);
  assert.equal(observed.rootStatus, "ROOT_OK");
});

test("enemy tank FIELD_NULL remains an observation fact and never becomes a death assertion", () => {
  const observed = ref.adaptObservedRoot(side(1, [1, 1], "right", "poison"),
    side(2, null, "left", "stun"), { frames: 4, map: ref.boxedMap(), star: null, bombs: [] },
    context);
  assert.equal(observed.tanks[1].tankFieldStatus, "FIELD_NULL");
  assert.equal(observed.tanks[1].crashed, null);
});

test("missing public skill identity produces explicit incomplete root capability", () => {
  const enemy = side(2, [5, 3], "left", "stun"); delete enemy.skill;
  const observed = ref.adaptObservedRoot(side(1, [1, 1], "right", "poison"), enemy,
    { frames: 4, map: ref.boxedMap(), star: null, bombs: [] }, context);
  assert.equal(observed.rootStatus, "ROOT_INCOMPLETE_RULE");
  assert.deepEqual(observed.incompleteReasons, ["INCOMPLETE_SKILL_IDENTITY"]);
});

test("singular bullet observation creates an ambiguous relation instead of greedy identity collapse", () => {
  const observed = [{ ownerSeat: 1, direction: "left", cell: [3, 2],
    externalKey: { status: "FIELD_ABSENT", lo: 0, hi: 0 } }];
  const tracked = [{ ownerSeat: 1, direction: "left", cell: [5, 2], externalKey: null },
    { ownerSeat: 1, direction: "left", cell: [4, 2], externalKey: null }];
  const relation = ref.associateEntities(observed, tracked, "projectile", 1);
  assert.equal(relation.ambiguous, true);
  assert.deepEqual(relation.relations[0].trackedIndices, [0, 1]);
  assert.equal(ref.enumerateAssignments(relation).assignments.length, 2);
});

test("TrackedState uses shadow reconciliation and commits only a complete generation", () => {
  const committed = ref.createTrackedState({ trackedFrame: 8, rulesetVersion: context.rulesetVersion,
    projectiles: [{ ownerSeat: 1, direction: "left", cell: [5, 2], externalKey: null }] });
  const enemy = side(2, [5, 3], "left", "stun");
  enemy.bullet = { position: [3, 2], direction: "left" };
  const observed = ref.adaptObservedRoot(side(1, [1, 1], "right", "poison"), enemy,
    { frames: 9, map: ref.boxedMap(), star: null, bombs: [] }, context);
  const reconciled = ref.reconcileTrackedState(committed, observed);
  const next = ref.commitTrackedState(committed, reconciled);
  assert.equal(reconciled.status, "TRACK_RECONCILED");
  assert.equal(next.trackedFrame, 9); assert.equal(committed.trackedFrame, 8);
});

test("frame regression rebuilds tracking rather than partially mutating the committed state", () => {
  const committed = ref.createTrackedState({ trackedFrame: 8, rulesetVersion: context.rulesetVersion });
  const observed = ref.adaptObservedRoot(side(1, [1, 1], "right", "poison"),
    side(2, [5, 3], "left", "stun"), { frames: 7, map: ref.boxedMap(), star: null, bombs: [] },
    context);
  const result = ref.reconcileTrackedState(committed, observed);
  assert.equal(result.status, "TRACK_REBUILD_REQUIRED");
  assert.equal(result.reason, "FRAME_REGRESSION"); assert.equal(committed.trackedFrame, 8);
});

test("visible exact observation reconciles into one PhysicalState without platform references", () => {
  const observed = ref.adaptObservedRoot(side(1, [1, 1], "right", "poison"),
    side(2, [5, 3], "left", "stun"),
    { frames: 7, map: ref.boxedMap(), star: [3, 2], bombs: [] }, context);
  const committed = ref.createTrackedState({ trackedFrame: 6, rulesetVersion: context.rulesetVersion });
  const reconciliation = ref.reconcileTrackedState(committed, observed);
  const built = ref.reconcileToSearchState(observed, committed, reconciliation, context);
  assert.equal(built.status, "SEARCH_STATE_PHYSICAL");
  assert.equal(built.searchState.stateKind, "PHYSICAL_STATE");
  assert.deepEqual(built.searchState.star.cell, [3, 2]);
});

test("hidden enemy observation yields incomplete InformationState instead of a most-likely pose", () => {
  const observed = ref.adaptObservedRoot(side(1, [1, 1], "right", "poison"),
    side(2, null, "left", "stun"),
    { frames: 7, map: ref.boxedMap(), star: null, bombs: [] }, context);
  const committed = ref.createTrackedState({ trackedFrame: 6, rulesetVersion: context.rulesetVersion,
    lastVisibleTankPoseBySeat: [null, { cell: [5, 3], direction: "left", frame: 6 }] });
  const reconciliation = ref.reconcileTrackedState(committed, observed);
  const built = ref.reconcileToSearchState(observed, committed, reconciliation, context);
  assert.equal(built.status, "SEARCH_STATE_INFORMATION");
  assert.equal(built.searchState.complete, false);
  assert.deepEqual(built.incompleteReasons, ["HIDDEN_ENEMY_MOTION_SUPPORT_UNEXPANDED"]);
});
