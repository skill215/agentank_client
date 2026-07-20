"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ref = require("../../engine-v2/src/reference");

const root = path.resolve(__dirname, "../..");
const loaded = ref.loadRuleCorpus(root);
const context = ref.createRuleContext(loaded);
const map = ref.boxedMap();

test("RuleCorpus closes every rule handler fixture variant and provenance edge", () => {
  const report = ref.ruleEvidenceReport(loaded);
  assert.equal(report.ruleCount, 20); assert.equal(report.variantCount, 12);
  assert.equal(report.fixtureCount, 21); assert.equal(report.candidateOnlyCannotOverride, true);
  assert.ok(report.rules.every(rule => rule.handler && rule.sourceClasses.length > 0));
  assert.ok(Object.values(loaded.corpus.handlerBindings).every(binding =>
    typeof ref.resolveReferenceHandler(binding) === "function"));
});

test("RuleCorpus keeps every unresolved variant explicit instead of selecting the first candidate", () => {
  for (const group of loaded.corpus.variantGroups.filter(item => item.status.startsWith("UNRESOLVED"))) {
    assert.equal(context.activeVariantByGroup[group.id], group.active);
    if (group.active === null) assert.notEqual(context.activeVariantByGroup[group.id], group.candidates[0]);
  }
});

test("typed unknown values cannot participate in ordinary Reference arithmetic", () => {
  const value = ref.unknown("R2-FUTURE-STAR", [0, 4]);
  assert.throws(() => ref.readKnown(value, "futureStar"), error =>
    error.code === "REFERENCE_TYPED_UNKNOWN_READ");
  assert.equal(ref.readKnown(ref.known(7)), 7);
});

test("PhysicalState requires integer fields and unique IDs for every dynamic entity", () => {
  const state = ref.createPhysicalState({ platformFrame: 2, map: { width: 7, height: 5,
    terrainColumnMajor: map }, tanks: [ref.tank(0, [1, 1], "right"),
      ref.tank(1, [5, 3], "left")], projectiles: [
      { entityId: 10, ownerSeat: 0, cell: [2, 1], direction: "right" },
      { entityId: 11, ownerSeat: 0, cell: [3, 1], direction: "right" }],
    bombs: [{ entityId: 12, ownerSeat: 1, cell: [5, 3], explodeFrame: 7 }] }, context);
  assert.deepEqual(state.projectiles.map(item => item.entityId), [10, 11]);
  assert.equal(new Set([...state.tanks, ...state.projectiles, ...state.bombs]
    .map(item => item.entityId)).size, 5);
  assert.throws(() => ref.createPhysicalState({ platformFrame: 2.5, map: state.map,
    tanks: state.tanks }, context), /integer/);
});

test("PhysicalState rejects duplicate overload projectile identities rather than truncating entities", () => {
  assert.throws(() => ref.createPhysicalState({ platformFrame: 2, map: { width: 7, height: 5,
    terrainColumnMajor: map }, tanks: [ref.tank(0, [1, 1], "right"),
      ref.tank(1, [5, 3], "left")], projectiles: [
      { entityId: 9, ownerSeat: 0, cell: [2, 1], direction: "right" },
      { entityId: 9, ownerSeat: 0, cell: [3, 1], direction: "right" }] }, context), /duplicate/);
});

test("InformationState preserves joint immutable worlds and residual support", () => {
  const first = ref.createPhysicalState({ platformFrame: 4, map: { width: 7, height: 5,
    terrainColumnMajor: map }, tanks: [ref.tank(0, [1, 1], "right"),
      ref.tank(1, [5, 3], "left")] }, context);
  const second = structuredClone(first); second.tanks[1].cell = [4, 3];
  const information = ref.createInformationState({ worlds: [first, second],
    residualSupport: [{ kind: "UNKNOWN_ENEMY_QUEUE_SUFFIX" }],
    observationHistorySignature: "history-a" });
  assert.equal(information.stateKind, "INFORMATION_STATE");
  assert.equal(information.worlds.length, 2);
  assert.notDeepEqual(information.worlds[0].tanks[1].cell, information.worlds[1].tanks[1].cell);
});

test("Reference implementation remains physically isolated from future FastKernel modules", () => {
  const fs = require("node:fs");
  for (const file of fs.readdirSync(path.join(root, "engine-v2", "src", "reference"))) {
    if (!file.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(root, "engine-v2", "src", "reference", file), "utf8");
    assert.doesNotMatch(source, /require\(["'][^"']*\/fast/);
  }
});
