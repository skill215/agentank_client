"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ref = require("../../engine-v2/src/reference");

const root = path.resolve(__dirname, "../..");
const loaded = ref.loadRuleCorpus(root);
const variants = { ...ref.TRACE_VARIANTS };
const context = ref.createRuleContext(loaded, variants);
const kernel = new ref.ReferenceKernel(context);
function state(skill, command, extra0 = {}, extra1 = {}) {
  return ref.createPhysicalState({ platformFrame: 5, recordIndex: 5,
    map: { width: 7, height: 5, terrainColumnMajor: ref.boxedMap() },
    tanks: [ref.tank(0, [1, 2], "right", { skillId: skill,
      queue: [{ command, eligibleAtFrame: 5, ...(extra0.commandFields || {}) }], ...extra0 }),
      ref.tank(1, [5, 2], "left", extra1)] }, context);
}

test("scheduler applies seat zero freeze before seat one action without dequeuing the frozen queue", () => {
  const value = state("freeze", "CAST_FREEZE", {}, { queue: [{ command: "GO", eligibleAtFrame: 5 }] });
  const transition = kernel.advanceFrame(value);
  assert.equal(transition.slots[0].slotStatus, "SLOT_EXECUTED");
  assert.equal(transition.slots[1].slotStatus, "SLOT_DEFERRED_CONTROL");
  assert.equal(transition.childState.tanks[1].queue.length, 1);
});

test("shield skill starts with two projectile charges from RuleCorpus constants", () => {
  const transition = kernel.advanceFrame(state("shield", "CAST_SHIELD"));
  assert.equal(transition.childState.tanks[0].shieldHitsRemaining, 2);
  assert.ok(transition.orderedEvents.some(event => event.eventCode === "SKILL_APPLIED"));
});

test("stun enumerates support without inventing a probability and transforms only with ChanceCode", () => {
  assert.deepEqual(ref.stunSupport("GO"), ["NORMAL_FORWARD", "REVERSED_BACK"]);
  assert.deepEqual(ref.stunSupport("FIRE"), ["NORMAL"]);
  const value = state("stun", "CAST_STUN", {}, { queue: [{ command: "GO", eligibleAtFrame: 5 }] });
  const missing = kernel.advanceFrame(value);
  assert.equal(missing.status, "REFERENCE_INCOMPLETE_INPUT");
  const complete = kernel.advanceFrame(value, { chanceCodes: { stunBySeat: { 1: "REVERSED_BACK" } } });
  assert.equal(complete.status, "REFERENCE_OK");
  assert.deepEqual(complete.childState.tanks[1].cell, [6 - 1, 2]);
});

test("overload consumes on successful fire and creates two independent projectile IDs", () => {
  const cast = kernel.advanceFrame(state("overload", "CAST_OVERLOAD"));
  cast.childState.tanks[0].queue.push({ command: "FIRE", eligibleAtFrame: 6 });
  const fired = kernel.advanceFrame(cast.childState);
  const created = fired.orderedEvents.filter(event => event.eventCode === "PROJECTILE_CREATED");
  assert.equal(created.length, 2);
  assert.notEqual(created[0].entitySemanticId, created[1].entitySemanticId);
  assert.equal(fired.childState.tanks[0].overloadUntilFrame, null);
});

test("cloak changes observation visibility while preserving enemy physical state", () => {
  const transition = kernel.advanceFrame(state("cloak", "CAST_CLOAK"));
  assert.equal(transition.observationsBySide[1].enemyTank, null);
  assert.equal(transition.childState.tanks[0].crashed, false);
});

test("poison cadence is relative ACT HOLD ACT HOLD and HOLD preserves queue", () => {
  const cast = kernel.advanceFrame(state("poison", "CAST_POISON", {},
    { queue: [{ command: "TURN_LEFT", eligibleAtFrame: 5 },
      { command: "GO", eligibleAtFrame: 5 }] }));
  assert.equal(cast.slots[1].slotStatus, "SLOT_EXECUTED");
  const next = kernel.advanceFrame(cast.childState);
  assert.equal(next.slots[1].slotStatus, "SLOT_DEFERRED_CONTROL");
  assert.equal(next.childState.tanks[1].queue.length, 1);
  assert.deepEqual([0, 1, 2, 3].map(offset => ref.poisonAllowsAction({ poisonAppliedFrame: 8,
    poisonUntilFrame: 12 }, 8 + offset)), [true, false, true, false]);
});

test("teleport to star enumerates legal neighboring support and requires explicit landing outcome", () => {
  const value = state("teleport", "CAST_TELEPORT", { commandFields: { targetCell: [3, 2] } });
  value.star = { cell: [3, 2], spawnAtFrame: null };
  const support = ref.teleportLandingSupport(value, [3, 2]);
  assert.deepEqual(support, [[3, 1], [4, 2], [3, 3], [2, 2]]);
  assert.equal(kernel.advanceFrame(value).status, "REFERENCE_INCOMPLETE_INPUT");
  const landed = kernel.advanceFrame(value, { chanceCodes: { teleportCellBySeat: { 0: [3, 1] } } });
  assert.deepEqual(landed.childState.tanks[0].cell, [3, 1]);
  assert.equal(landed.childState.tanks[0].pickupLockUntilFrame, 7);
});

test("boost executes one free turn and a two-cell GO in the same seat slot", () => {
  const value = ref.createPhysicalState({ platformFrame: 5, recordIndex: 5,
    map: { width: 7, height: 5, terrainColumnMajor: ref.boxedMap() },
    tanks: [ref.tank(0, [1, 2], "up", { skillId: "boost", boostUntilFrame: 9,
      queue: [{ command: "TURN_RIGHT", eligibleAtFrame: 5 },
        { command: "GO", eligibleAtFrame: 5 }] }), ref.tank(1, [5, 3], "left")] }, context);
  const transition = kernel.advanceFrame(value);
  assert.equal(transition.slots[0].commands.length, 2);
  assert.equal(transition.childState.tanks[0].direction, "right");
  assert.deepEqual(transition.childState.tanks[0].cell, [3, 2]);
});

test("all eight skill cooldown and duration values are read from the frozen RuleCorpus", () => {
  assert.deepEqual(Object.keys(context.constants.skillCooldownFrames).sort(), [...ref.SKILLS].sort());
  assert.deepEqual(Object.keys(context.constants.skillDurationFrames).sort(),
    ref.SKILLS.filter(skill => skill !== "teleport").sort());
  assert.equal(Object.hasOwn(context.constants.skillDurationFrames, "teleport"), false);
  assert.equal(context.constants.skillCooldownFrames.poison, 20);
  assert.equal(context.constants.skillCooldownFrames.boost, 26);
});

test("official poison failed-cast evidence preserves ready frame while unconfirmed families stay unknown", () => {
  const poison = state("poison", "CAST_POISON"); poison.tanks[0].skillReadyFrame = 10;
  const poisonResult = kernel.advanceFrame(poison);
  assert.equal(poisonResult.status, "REFERENCE_OK");
  assert.equal(poisonResult.slots[0].results[0].executionStatus, "FAILED_COOLDOWN_PRESERVED");
  assert.equal(poisonResult.childState.tanks[0].skillReadyFrame, 10);
  const shield = state("shield", "CAST_SHIELD"); shield.tanks[0].skillReadyFrame = 10;
  const shieldResult = kernel.advanceFrame(shield);
  assert.equal(shieldResult.status, "REFERENCE_UNKNOWN_RULE");
  assert.equal(shieldResult.firstUnknownRuleId, "R1-FAILED-CAST");
});
