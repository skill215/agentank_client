"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { ACTION, TERRAIN, NONE_FRAME, NONE_CELL } = require(
  "../../engine-v2/src/abi/fast-codes");
const { NativeTacticalDomainPoc, NativeTacticalLeafEvaluatorPoc,
  NativeTacticalLeafAblationPoc, LEAF_COMPONENT, LEAF_COMPONENT_ALL,
  NativeTacticalRaceLeafEvaluatorPoc,
  NativePolicyOutcomeLexicographicPoc,
  NativeProjectileSettlementLexicographicPoc, SETTLEMENT,
  NativeTacticalRepresentativePoc, NativeTacticalIntentPoc,
  NativeAttackPoseOptionPoc, NativeAttackPoseFeedbackSearchPoc,
  NativeTacticalHistoryPoc } = require(
  "../../tools/agentank/diagnostics/native-tactical-domain-evaluator-poc");

function state(own, enemy, ownDirection = 1, enemyDirection = 3) {
  const value = new FastState(10, 10); const a = value.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, 100);
  a[ARRAY.TANK_CELL][0] = value.cell(own[0], own[1]);
  a[ARRAY.TANK_CELL][1] = value.cell(enemy[0], enemy[1]);
  a[ARRAY.TANK_DIR][0] = ownDirection; a[ARRAY.TANK_DIR][1] = enemyDirection;
  a[ARRAY.TANK_FIRE_LOCK][0] = NONE_FRAME; a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  return value;
}

function engine(value, action = ACTION.FIRE) {
  return { adapter: { state: value }, ourActions: new Uint8Array([action]) };
}

test("native tactical domain keeps direct and one-move intercept FIRE only", () => {
  const domain = new NativeTacticalDomainPoc();
  assert.equal(domain.allows(engine(state([1, 1], [7, 1])), 0), 1);
  assert.equal(domain.allows(engine(state([1, 1], [7, 2])), 0), 1);
  assert.equal(domain.allows(engine(state([1, 1], [7, 8])), 0), 0);
  assert.equal(domain.summary().blockedFireCount, 1);
});

test("attack-pose feedback recomputes a direct FIRE continuation", () => {
  const feedback = new NativeAttackPoseFeedbackSearchPoc();
  assert.equal(feedback.routeAction(state([1, 1], [7, 1], 1, 0)), ACTION.FIRE);
  assert.equal(feedback.summary().fireCount, 1);
});

test("fixed attack-pose feedback preserves the bound option identity", () => {
  const feedback = new NativeAttackPoseFeedbackSearchPoc({ fixedOption: true });
  const pose = { selected: 0, cell: new Uint16Array([11]),
    direction: new Uint8Array([1]) };
  assert.equal(feedback.bind(pose), 1);
  assert.equal(feedback.routeAction(state([1, 1], [7, 1], 1, 0)), ACTION.FIRE);
  // A receding policy would find another firing pose for this enemy.  The
  // fixed option must instead become incomplete and yield to normal search.
  assert.equal(feedback.routeAction(state([1, 1], [7, 2], 1, 0)), ACTION.NONE);
  assert.equal(feedback.summary().bindCount, 1);
  assert.equal(feedback.summary().fixedInvalidCount, 1);
});

test("attack-pose feedback promotes its receding route without adding a score", () => {
  const value = state([1, 1], [7, 2], 1, 0);
  const search = {
    frameOurCount: new Uint8Array(2), frameOurGeneratedCount: new Uint8Array(2),
    deepOurActions: new Uint8Array(8), deepOurArguments: new Uint16Array(8),
    iterationExpansionLimit: 2,
    generateDeep(top) {
      this.frameOurCount[top] = 2; this.frameOurGeneratedCount[top] = 2;
      this.deepOurActions[top * 4] = ACTION.GO;
      this.deepOurActions[top * 4 + 1] = ACTION.NONE;
    }
  };
  const feedback = new NativeAttackPoseFeedbackSearchPoc().install(search);
  search.generateDeep(1, value, 0);
  assert.notEqual(search.deepOurActions[4], ACTION.NONE);
  assert.equal(search.frameOurCount[1], 2);
  assert.ok(feedback.summary().completeCount > 0);
  assert.equal(feedback.summary().hotAllocationCount, 0);
});

test("native tactical domain never filters non-FIRE physical actions", () => {
  const domain = new NativeTacticalDomainPoc();
  assert.equal(domain.allows(engine(state([1, 1], [7, 4]), ACTION.TURN_LEFT), 0), 1);
  assert.equal(domain.summary().fireCheckCount, 0);
});

test("resource domain rejects purposeless bomb and keeps constrained contact bomb", () => {
  const open = state([4, 4], [9, 9]);
  const domain = new NativeTacticalDomainPoc(2);
  assert.equal(domain.allows(engine(open, ACTION.THROW_BOMB), 0), 0);
  // The opponent is constrained but not already aiming at us; V1 correctly
  // rejects the same bomb when the committed muzzle risk dominates it.
  const constrained = state([4, 4], [6, 4], 1, 0);
  constrained.arrays[ARRAY.TERRAIN][constrained.cell(7, 4)] = TERRAIN.WALL;
  constrained.arrays[ARRAY.TERRAIN][constrained.cell(6, 3)] = TERRAIN.WALL;
  assert.equal(domain.allows(engine(constrained, ACTION.THROW_BOMB), 0), 1);
});

test("resource domain keeps offensive skill only with contact or contested star", () => {
  const domain = new NativeTacticalDomainPoc(2);
  const far = state([1, 1], [8, 8]);
  assert.equal(domain.allows(engine(far, ACTION.CAST_POISON), 0), 0);
  const contact = state([1, 1], [4, 1]);
  assert.equal(domain.allows(engine(contact, ACTION.CAST_POISON), 0), 1);
});

test("native tactical leaf values a threatening projectile and rejects a wasted one", () => {
  const evaluator = new NativeTacticalLeafEvaluatorPoc();
  const threatening = state([1, 1], [7, 1], 0, 0);
  threatening.arrays[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  threatening.arrays[ARRAY.PROJECTILE_OWNER][0] = 0;
  threatening.arrays[ARRAY.PROJECTILE_CELL][0] = threatening.cell(3, 1);
  threatening.arrays[ARRAY.PROJECTILE_DIR][0] = 1;
  const missed = state([1, 1], [7, 1], 0, 0);
  missed.arrays[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  missed.arrays[ARRAY.PROJECTILE_OWNER][0] = 0;
  missed.arrays[ARRAY.PROJECTILE_CELL][0] = missed.cell(3, 2);
  missed.arrays[ARRAY.PROJECTILE_DIR][0] = 1;
  assert.ok(evaluator.evaluate(threatening) > evaluator.evaluate(missed));
});

test("native tactical leaf keeps direct attack initiative above one star-distance step", () => {
  const evaluator = new NativeTacticalLeafEvaluatorPoc();
  const aimed = state([1, 1], [7, 1], 1, 0);
  const unaligned = state([1, 1], [7, 2], 1, 0);
  unaligned.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = unaligned.cell(2, 1);
  assert.ok(evaluator.evaluate(aimed) > evaluator.evaluate(unaligned));
});

test("BP135 full leaf mask is bit-identical and zero mask is neutral", () => {
  const value = state([1, 1], [7, 1], 1, 3); const a = value.arrays;
  a[ARRAY.SCALAR][SCALAR.FRAME] = 118;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = value.cell(4, 2);
  a[ARRAY.TANK_STARS][0] = 2; a[ARRAY.TANK_STARS][1] = 1;
  a[ARRAY.TANK_STUN_UNTIL][1] = 121;
  a[ARRAY.TANK_SHIELD_HITS][0] = 1;
  a[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  a[ARRAY.PROJECTILE_OWNER][0] = 0;
  a[ARRAY.PROJECTILE_CELL][0] = value.cell(3, 1);
  a[ARRAY.PROJECTILE_DIR][0] = 1;
  const original = new NativeTacticalLeafEvaluatorPoc();
  const full = new NativeTacticalLeafAblationPoc(LEAF_COMPONENT_ALL);
  assert.equal(full.evaluate(value), original.evaluate(value));
  assert.equal(new NativeTacticalLeafAblationPoc(0).evaluate(value), 0);
  assert.equal(full.summary().enabledMask, LEAF_COMPONENT_ALL);
});

test("BP135 leaf families are independently removable", () => {
  const value = state([1, 1], [7, 1], 1, 3); const a = value.arrays;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = value.cell(2, 2);
  a[ARRAY.TANK_STARS][0] = 1; a[ARRAY.TANK_STARS][1] = 0;
  a[ARRAY.TANK_STUN_UNTIL][1] = 3;
  a[ARRAY.TERRAIN][value.cell(7, 2)] = TERRAIN.WALL;
  a[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  a[ARRAY.PROJECTILE_OWNER][0] = 0;
  a[ARRAY.PROJECTILE_CELL][0] = value.cell(3, 1);
  a[ARRAY.PROJECTILE_DIR][0] = 1;
  const full = new NativeTacticalLeafAblationPoc(LEAF_COMPONENT_ALL)
    .evaluate(value);
  for (const bit of Object.values(LEAF_COMPONENT))
    assert.notEqual(new NativeTacticalLeafAblationPoc(
      LEAF_COMPONENT_ALL & ~bit).evaluate(value), full);
});

test("duration-aware stun leaf values every remaining controlled frame", () => {
  const flat = new NativeTacticalLeafEvaluatorPoc();
  const duration = new NativeTacticalLeafEvaluatorPoc({ stunStatusMode: "duration" });
  const ownStunned = state([1, 1], [7, 1], 0, 0);
  ownStunned.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 5;
  ownStunned.arrays[ARRAY.TANK_STUN_UNTIL][0] = 8;
  assert.equal(duration.evaluate(ownStunned), flat.evaluate(ownStunned) - 1800);
  const enemyStunned = state([1, 1], [7, 1], 0, 0);
  enemyStunned.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 5;
  enemyStunned.arrays[ARRAY.TANK_STUN_UNTIL][1] = 8;
  assert.equal(duration.evaluate(enemyStunned), flat.evaluate(enemyStunned) + 1400);
});

test("policy outcome lexicographic view never trades committed safety for attack", () => {
  const evaluator = new NativePolicyOutcomeLexicographicPoc();
  const safe = state([1, 1], [7, 1], 0, 0);
  const unsafe = state([1, 1], [7, 1], 0, 0);
  unsafe.arrays[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  unsafe.arrays[ARRAY.PROJECTILE_OWNER][0] = 0;
  unsafe.arrays[ARRAY.PROJECTILE_CELL][0] = unsafe.cell(3, 1);
  unsafe.arrays[ARRAY.PROJECTILE_DIR][0] = 1;
  unsafe.arrays[ARRAY.PROJECTILE_ACTIVE][1] = 1;
  unsafe.arrays[ARRAY.PROJECTILE_OWNER][1] = 1;
  unsafe.arrays[ARRAY.PROJECTILE_CELL][1] = unsafe.cell(5, 1);
  unsafe.arrays[ARRAY.PROJECTILE_DIR][1] = 3;
  assert.ok(evaluator.evaluate(safe, -25000) > evaluator.evaluate(unsafe, 25000));
});

test("policy outcome lexicographic view ranks an executed attack above soft star value", () => {
  const evaluator = new NativePolicyOutcomeLexicographicPoc();
  const attack = state([1, 1], [7, 1], 0, 0);
  attack.arrays[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  attack.arrays[ARRAY.PROJECTILE_OWNER][0] = 0;
  attack.arrays[ARRAY.PROJECTILE_CELL][0] = attack.cell(3, 1);
  attack.arrays[ARRAY.PROJECTILE_DIR][0] = 1;
  const star = state([1, 1], [7, 1], 0, 0);
  star.arrays[ARRAY.TANK_STARS][0] = 4;
  assert.ok(evaluator.evaluate(attack, -25000) > evaluator.evaluate(star, 25000));
  assert.equal(evaluator.summary().semantics, "LEXICOGRAPHIC_POLICY_OUTCOME");
});

test("projectile event settlement distinguishes proven doom from a viable dodge", () => {
  const evaluator = new NativeProjectileSettlementLexicographicPoc();
  const close = state([1, 1], [4, 1], 0, 1);
  close.arrays[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  close.arrays[ARRAY.PROJECTILE_OWNER][0] = 0;
  close.arrays[ARRAY.PROJECTILE_CELL][0] = close.cell(3, 1);
  close.arrays[ARRAY.PROJECTILE_DIR][0] = 1;
  const far = state([1, 1], [7, 1], 0, 1);
  far.arrays[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  far.arrays[ARRAY.PROJECTILE_OWNER][0] = 0;
  far.arrays[ARRAY.PROJECTILE_CELL][0] = far.cell(3, 1);
  far.arrays[ARRAY.PROJECTILE_DIR][0] = 1;
  assert.equal(evaluator.classifyThreat(close, 0), SETTLEMENT.DOOMED);
  assert.equal(evaluator.classifyThreat(far, 0), SETTLEMENT.SURVIVES);
  assert.equal(evaluator.summary().hotAllocationCount, 0);
});

test("leaf evaluator installs on one search instance only", () => {
  const evaluator = new NativeTacticalLeafEvaluatorPoc();
  const search = { heuristic() { return 7; } };
  evaluator.install(search);
  assert.equal(search.heuristic(state([1, 1], [7, 1])), evaluator.evaluate(
    state([1, 1], [7, 1])));
  assert.ok(evaluator.summary().callCount >= 2);
});

test("race leaf rewards a real open attack race, not off-axis facing", () => {
  const evaluator = new NativeTacticalRaceLeafEvaluatorPoc();
  const open = state([2, 2], [2, 5], 2, 1);
  const offAxis = state([2, 2], [4, 5], 2, 1);
  assert.ok(evaluator.attackValue(open) > evaluator.attackValue(offAxis));
  assert.equal(evaluator.attackValue(offAxis), 0);
  assert.equal(evaluator.summary().semantics, "INTEGER_ATTACK_RACE");
});

test("contact representative hides only the strategic star and always restores it", () => {
  const value = state([1, 1], [5, 1]);
  value.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = value.cell(2, 2);
  let observed = -1;
  const search = { generateDeep(top, current) {
    observed = current.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL]; return top;
  } };
  const diagnostic = new NativeTacticalRepresentativePoc().install(search);
  assert.equal(search.generateDeep(3, value, 0), 3);
  assert.equal(observed, NONE_CELL);
  assert.equal(value.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL], value.cell(2, 2));
  assert.equal(diagnostic.summary().attackTargetOverrideCount, 1);
});

test("non-contact representative preserves the strategic star", () => {
  const value = state([1, 1], [8, 8]);
  value.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = value.cell(2, 2);
  let observed = -1;
  const search = { generateDeep(top, current) {
    observed = current.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL];
  } };
  new NativeTacticalRepresentativePoc().install(search).generateDeep;
  search.generateDeep(0, value, 0);
  assert.equal(observed, value.cell(2, 2));
});

test("own-only representative preserves the enemy strategic target", () => {
  const value = state([1, 1], [5, 1]);
  value.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = value.cell(2, 2);
  let observed = -1;
  const search = { generateDeep(top, current) {
    observed = current.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL]; return top;
  } };
  const diagnostic = new NativeTacticalRepresentativePoc({ ownOnly: true }).install(search);
  search.generateDeep(0, value, 1);
  assert.equal(observed, value.cell(2, 2));
  assert.equal(diagnostic.summary().enemyStrategicPreserveCount, 1);
});

test("tactical intent gives only the best star-progress row a continuity margin", () => {
  const value = state([1, 1], [8, 8]);
  value.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = value.cell(4, 1);
  const root = { adapter: { state: value }, ourCount: 2,
    ourActions: new Uint8Array([ACTION.GO, ACTION.TURN_LEFT]),
    projectedCell: new Uint16Array([value.cell(2, 1), value.cell(1, 1)]),
    projectedDirection: new Uint8Array([1, 0]),
    manhattan(left, right) { return Math.abs(value.x(left) - value.x(right)) +
      Math.abs(value.y(left) - value.y(right)); },
    directionTo() { return -1; }, clearLine() { return 0; },
    directHitWindow() { return 0; },
    starDistance(cell) { return Math.abs(value.x(cell) - 4) + Math.abs(value.y(cell) - 1); },
    starDirectionHelpful() { return 0; } };
  const intent = new NativeTacticalIntentPoc(150); intent.prepare(root, 2);
  assert.equal(intent.bonus(0), 150);
  assert.equal(intent.bonus(1), 0);
  assert.equal(intent.summary().starCount, 1);
  value.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = value.cell(5, 1);
  intent.prepare(root, 2);
  assert.equal(intent.summary().contextChangeCount, 1);
});

test("V1-shaped intent mapping emits one reusable distance-field action", () => {
  const value = state([1, 1], [8, 8]);
  value.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = value.cell(4, 1);
  const root = { adapter: { state: value }, ourCount: 3,
    ourActions: new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT]),
    projectedCell: new Uint16Array([
      value.cell(2, 1), value.cell(1, 1), value.cell(1, 1)]),
    projectedDirection: new Uint8Array([1, 0, 2]),
    manhattan(left, right) { return Math.abs(value.x(left) - value.x(right)) +
      Math.abs(value.y(left) - value.y(right)); },
    directionTo(from, to) {
      if (value.x(from) === value.x(to)) return value.y(to) < value.y(from) ? 0 : 2;
      if (value.y(from) === value.y(to)) return value.x(to) > value.x(from) ? 1 : 3;
      return -1;
    },
    clearLine() { return 1; } };
  const intent = new NativeTacticalIntentPoc(150, { mappingMode: "v1-action" });
  intent.setOracle("CHASE_STAR", ACTION.GO); intent.prepare(root, 3);
  assert.equal(intent.bonus(0), 150);
  assert.equal(intent.bonus(1), 0);
  assert.equal(intent.bonus(2), 0);
  assert.equal(intent.summary().mappingOracleAgreementCount, 1);
  assert.equal(intent.summary().mappingOraclePairs[
    ACTION.GO * (ACTION.BOOST_RIGHT_BOMB + 1) + ACTION.GO], 1);
  assert.equal(intent.summary().mappingMissingRowCount, 0);
  assert.equal(intent.summary().hotAllocationCount, 0);
});

test("oracle-owned shadow roots commit the oracle selected intent", () => {
  const intent = new NativeTacticalIntentPoc(150,
    { continuityMode: "v1-epoch" });
  intent.currentCommitted = 2;
  intent.currentProposed = 4;
  intent.currentCommittedAction = ACTION.GO;
  intent.commitSelection(ACTION.FIRE);
  assert.equal(intent.lastIntent, 4);
  intent.setOracle("CHASE_STAR", ACTION.GO, "FACE_ENEMY", "CHASE_STAR");
  intent.commitOracleSelection();
  assert.equal(intent.lastIntent, 2);
  assert.equal(intent.lastIntentEpoch, intent.contextEpoch);
  intent.syncOracleRuntime(null, "EXIT_EDGE", 7, 8);
  assert.equal(intent.lastIntent, 3);
  assert.equal(intent.lastIntentEpoch, 7);
  assert.equal(intent.contextEpoch, 8);
});

test("context signature treats NONE_FRAME as inactive and rebases every callback", () => {
  const value = state([2, 2], [6, 2]);
  const root = engine(value);
  const intent = new NativeTacticalIntentPoc(150,
    { continuityMode: "v1-epoch" });
  const inactive = intent.contextSignature(root);
  value.arrays[ARRAY.TANK_STUN_UNTIL][1] = 2;
  const active = intent.contextSignature(root);
  assert.notEqual(active, inactive);
  value.arrays[ARRAY.TANK_STUN_UNTIL][1] = NONE_FRAME;
  assert.equal(intent.contextSignature(root), inactive);
  intent.syncOracleRuntime(root, "FACE_ENEMY", 3, 4);
  assert.equal(intent.lastContextSignature, inactive);
});

test("V1-exact intent classification uses the inner playable edge ring", () => {
  const value = state([3, 5], [8, 8]);
  const root = { adapter: { state: value },
    manhattan(left, right) { return Math.abs(value.x(left) - value.x(right)) +
      Math.abs(value.y(left) - value.y(right)); },
    directionTo(from, to) {
      if (value.x(from) === value.x(to)) return value.y(to) < value.y(from) ? 0 : 2;
      if (value.y(from) === value.y(to)) return value.x(to) > value.x(from) ? 1 : 3;
      return -1;
    },
    clearLine() { return 0; } };
  const exact = new NativeTacticalIntentPoc(150,
    { classificationMode: "v1-exact" });
  const simple = new NativeTacticalIntentPoc(150);
  assert.equal(simple.proposed(root), 4);
  assert.equal(exact.proposed(root), 3);
  assert.equal(exact.summary().hotAllocationCount, 0);
});

test("attack pose option binds progress to one firing pose with escape support", () => {
  const value = state([1, 1], [6, 3], 2, 3);
  const root = { adapter: { state: value }, enemyCount: 2,
    enemyActions: new Uint8Array([ACTION.NONE, ACTION.TURN_LEFT]),
    ourActions: new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.NONE]),
    projectedCell: new Uint16Array([
      value.cell(1, 2), value.cell(1, 1), value.cell(1, 1)]),
    projectedDirection: new Uint8Array([2, 1, 2]) };
  const option = new NativeAttackPoseOptionPoc();
  assert.equal(option.prepare(root, 3), 1);
  assert.equal(option.supports(0), 1);
  assert.equal(option.supports(2), 0);
  assert.equal(option.betterRow(root, 0, -1), 1);
  assert.ok(option.summary().completeRootCount > 0);
  assert.equal(option.summary().hotAllocationCount, 0);
});

test("attack pose option recognizes an immediate FIRE as option completion", () => {
  const value = state([1, 1], [6, 1], 1, 3);
  const root = { adapter: { state: value }, enemyCount: 1,
    enemyActions: new Uint8Array([ACTION.NONE]),
    ourActions: new Uint8Array([ACTION.FIRE, ACTION.TURN_LEFT]),
    projectedCell: new Uint16Array([value.cell(1, 1), value.cell(1, 1)]),
    projectedDirection: new Uint8Array([1, 0]) };
  const option = new NativeAttackPoseOptionPoc();
  assert.equal(option.prepare(root, 2), 1);
  assert.equal(option.supports(0), 1);
  assert.equal(option.summary().directFireRowCount, 1);
});

test("route-proven attack pose keeps only a turn that opens a shortest next step", () => {
  const value = state([1, 1], [6, 3], 1, 3);
  const root = { adapter: { state: value }, enemyCount: 1,
    enemyActions: new Uint8Array([ACTION.NONE]),
    ourActions: new Uint8Array([ACTION.GO, ACTION.TURN_RIGHT, ACTION.TURN_LEFT]),
    projectedCell: new Uint16Array([
      value.cell(2, 1), value.cell(1, 1), value.cell(1, 1)]),
    projectedDirection: new Uint8Array([1, 2, 0]) };
  const option = new NativeAttackPoseOptionPoc({ routeProof: true });
  assert.equal(option.prepare(root, 3), 1);
  assert.equal(option.supports(0), 0);
  assert.equal(option.supports(1), 1);
  assert.equal(option.supports(2), 0);
  assert.ok(option.summary().routeTurnCount >= 1);
  assert.ok(option.summary().rejectedPrematureTurnCount >= 1);
});

test("persistent attack pose keeps a still-valid option until Pareto domination", () => {
  const value = state([1, 1], [6, 3], 2, 3);
  const root = { adapter: { state: value }, enemyCount: 1,
    enemyActions: new Uint8Array([ACTION.NONE]),
    ourActions: new Uint8Array([ACTION.GO, ACTION.TURN_LEFT]),
    projectedCell: new Uint16Array([value.cell(1, 2), value.cell(1, 1)]),
    projectedDirection: new Uint8Array([2, 1]) };
  const option = new NativeAttackPoseOptionPoc({ routeProof: true, persistent: true });
  assert.equal(option.prepare(root, 2), 1);
  const generation = option.summary().generation;
  value.arrays[ARRAY.TANK_CELL][1] = value.cell(7, 3);
  assert.equal(option.prepare(root, 2), 1);
  assert.equal(option.summary().generation, generation);
  assert.equal(option.summary().commitKeepCount, 1);
});

test("full-coverage attack pose keeps partial response support as non-owning evidence", () => {
  const value = state([1, 1], [6, 1], 1, 2);
  const root = { adapter: { state: value }, enemyCount: 2,
    enemyActions: new Uint8Array([ACTION.NONE, ACTION.GO]),
    ourActions: new Uint8Array([ACTION.FIRE]),
    projectedCell: new Uint16Array([value.cell(1, 1)]),
    projectedDirection: new Uint8Array([1]) };
  const option = new NativeAttackPoseOptionPoc({
    routeProof: true, requireFullCoverage: true
  });
  assert.equal(option.prepare(root, 1), 0);
  assert.equal(option.summary().partialCoverageRootCount, 1);
  assert.equal(option.summary().fullCoverageRejectedCount, 1);
});

test("response-conditioned pose preserves every uncovered minimax cell", () => {
  const value = state([1, 1], [6, 1], 1, 2);
  const root = { adapter: { state: value }, enemyCount: 2,
    enemyActions: new Uint8Array([ACTION.NONE, ACTION.GO]),
    ourActions: new Uint8Array([ACTION.GO, ACTION.FIRE]),
    projectedCell: new Uint16Array([value.cell(2, 1), value.cell(1, 1)]),
    projectedDirection: new Uint8Array([1, 1]) };
  const option = new NativeAttackPoseOptionPoc({
    routeProof: true, requireUncoveredNonRegression: true
  });
  assert.equal(option.prepare(root, 2), 1);
  const source = { rootCellScore: new Int32Array(
    SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES) };
  const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
  source.rootCellScore[1] = 100;
  source.rootCellScore[stride + 1] = 99;
  assert.equal(option.uncoveredNonRegressing(source, 1, 0, 2), 0);
  source.rootCellScore[stride + 1] = 100;
  assert.equal(option.uncoveredNonRegressing(source, 1, 0, 2), 1);
  assert.equal(option.summary().uncoveredRegressionRejectedRowCount, 1);
});

test("response-derived pose can target an enemy move cell off the current axis", () => {
  const value = state([1, 1], [5, 3], 1, 0);
  const root = { adapter: { state: value }, enemyCount: 1,
    enemyActions: new Uint8Array([ACTION.GO]),
    ourActions: new Uint8Array([ACTION.GO, ACTION.TURN_RIGHT]),
    projectedCell: new Uint16Array([value.cell(2, 1), value.cell(1, 1)]),
    projectedDirection: new Uint8Array([1, 2]) };
  const legacy = new NativeAttackPoseOptionPoc({ routeProof: true });
  const derived = new NativeAttackPoseOptionPoc({
    routeProof: true, responseDerivedPoses: true
  });
  assert.equal(legacy.prepare(root, 2), 1);
  assert.equal(derived.prepare(root, 2), 1);
  assert.ok(derived.summary().generatedOptionCount >
    legacy.summary().generatedOptionCount);
  assert.ok(derived.summary().responseDerivedPoseCount > 0);
});

test("attack pose successor viability requires a reachable reply for every enemy response", () => {
  const value = state([1, 1], [7, 7], 1, 3);
  const root = { adapter: { state: value },
    projectedCell: new Uint16Array([value.cell(1, 1)]),
    projectedDirection: new Uint8Array([1]) };
  const option = new NativeAttackPoseOptionPoc({
    routeProof: true, requireSuccessorResponseViability: true
  });
  option.count = 2; option.optionCount = 2;
  option.enemyCell[0] = value.cell(7, 7);
  option.enemyCell[1] = value.cell(7, 6);
  option.cell[0] = value.cell(2, 1); option.direction[0] = 1;
  option.cell[1] = value.cell(3, 1); option.direction[1] = 1;
  option.responseMask[0] = 1; option.responseMask[1] = 2;
  assert.equal(option.successorResponseCoverage(root, 0), 2);
  value.arrays[ARRAY.TERRAIN][value.cell(3, 1)] = TERRAIN.WALL;
  assert.equal(option.successorResponseCoverage(root, 0), 1);
  assert.equal(option.summary().successorViabilityCheckCount, 2);
  assert.equal(option.summary().successorDistanceFillCount, 4);
});

test("tactical history separates physically identical wait and turn-reversal paths", () => {
  const { fast, physical } = require("../imp3/helpers");
  function run(actions) {
    const built = fast.createFastPhysical(physical());
    for (const action of actions) assert.equal(built.kernel.applyFrame(action,
      fast.NONE_CELL, fast.ACTION.NONE, fast.NONE_CELL), fast.FAST_STATUS.APPLIED);
    return built.state;
  }
  const waiting = run([fast.ACTION.NONE, fast.ACTION.NONE]);
  const reversal = run([fast.ACTION.TURN_LEFT, fast.ACTION.TURN_RIGHT]);
  assert.equal(waiting.hashLo, reversal.hashLo);
  assert.equal(waiting.hashHi, reversal.hashHi);
  const history = new NativeTacticalHistoryPoc();
  assert.notEqual(history.signature(waiting), history.signature(reversal));
  const search = { baseRisk: 0, iterationExpansionLimit: 2,
    cacheKey(current) { return current.hashLo; },
    cacheKeyHi(current) { return current.hashHi; },
    cacheSignature(current) { return current.hashLo ^ current.hashHi; },
    heuristic() { return 0; } };
  history.install(search);
  assert.ok(search.heuristic(reversal) < search.heuristic(waiting));
  assert.notEqual(search.cacheKey(waiting, 1), search.cacheKey(reversal, 1));
});
