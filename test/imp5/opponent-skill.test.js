"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RULE } = require("../../engine-v2/src/generated/fast-config");
const { policy, fast, physical, tank } = require("./helpers");

test("opponent model updates only current match opportunity normalized event families", () => {
  const model = new policy.OpponentModel(); model.reset(17); const own = model.ownParameterFingerprint;
  const slot = model.slot(policy.OPPONENT_EVENT.FIRE, policy.OPPONENT_CONTEXT.OPEN);
  model.update(policy.OPPONENT_EVENT.FIRE, policy.OPPONENT_CONTEXT.OPEN,
    policy.OPPORTUNITY.POSSIBLE, policy.CHOICE.NOT_CHOSEN, 1);
  assert.equal(model.opportunityMass[slot], 0); assert.equal(model.ambiguityMass[slot], 1);
  model.update(policy.OPPONENT_EVENT.FIRE, policy.OPPONENT_CONTEXT.OPEN,
    policy.OPPORTUNITY.CONFIRMED, policy.CHOICE.CHOSEN, 2);
  model.update(policy.OPPONENT_EVENT.ADVANCE, policy.OPPONENT_CONTEXT.OPEN,
    policy.OPPORTUNITY.CONFIRMED, policy.CHOICE.CHOSEN, 3);
  model.update(policy.OPPONENT_EVENT.TURN_EXTRA, policy.OPPONENT_CONTEXT.OPEN,
    policy.OPPORTUNITY.CONFIRMED, policy.CHOICE.NOT_CHOSEN, 4);
  model.update(policy.OPPONENT_EVENT.STAR, policy.OPPONENT_CONTEXT.OPEN,
    policy.OPPORTUNITY.CONFIRMED, policy.CHOICE.CHOSEN, 5);
  model.update(policy.OPPONENT_EVENT.SKILL, policy.OPPONENT_CONTEXT.OPEN,
    policy.OPPORTUNITY.CONFIRMED, policy.CHOICE.CHOSEN, 6);
  assert.ok(model.fast[slot] > model.slow[slot]); assert.equal(model.ownParameterFingerprint, own);
  assert.ok(model.riskPreference >= 0 && model.riskPreference <= 100);
  model.reset(18); assert.equal(model.opportunityMass[slot], 0); assert.equal(model.matchGeneration, 18);
  assert.equal(model.ownParameterFingerprint, own);
});

test("enemy nominal probabilities sum to 10000 without changing own parameters", () => {
  const model = new policy.OpponentModel(); const own = model.ownParameterFingerprint;
  for (let index = 0; index < 8; index += 1) model.update(policy.OPPONENT_EVENT.FIRE,
    policy.OPPONENT_CONTEXT.PRESSURED, policy.OPPORTUNITY.CONFIRMED,
    policy.CHOICE.CHOSEN, index);
  const families = new Uint8Array([policy.ACTION_FAMILY.HOLD, policy.ACTION_FAMILY.MOVE,
    policy.ACTION_FAMILY.TURN, policy.ACTION_FAMILY.FIRE, policy.ACTION_FAMILY.BOMB,
    policy.ACTION_FAMILY.SKILL]); const output = new Uint16Array(families.length);
  assert.equal(model.buildNominalPolicy(families, families.length,
    policy.OPPONENT_CONTEXT.PRESSURED, output), families.length);
  assert.equal(output.reduce((sum, value) => sum + value, 0), 10000);
  assert.ok(output[3] > output[0]); assert.equal(model.ownParameterFingerprint, own);
});

test("own poison emitter is specialized while every enemy skill descriptor is direct lookup", () => {
  const table = new policy.EnemySkillDescriptorTable(); const out = new Uint16Array(policy.DESCRIPTOR_FIELD.COUNT);
  for (let skill = fast.SKILL.SHIELD; skill <= fast.SKILL.BOOST; skill += 1) {
    assert.equal(table.lookup(skill), skill); assert.equal(table.read(skill, out), policy.DESCRIPTOR_FIELD.COUNT);
    assert.equal(out[policy.DESCRIPTOR_FIELD.SKILL_ID], skill);
  }
  const built = fast.createFastPhysical(physical({ tanks: [tank(0, [1, 1], "right",
    { skillId: "poison" }), tank(1, [5, 3], "left", { skillId: "stun" })] }));
  const emitter = policy.createOwnSkillEmitter(fast.SKILL.POISON, table);
  const actions = new Uint8Array(1); const args = new Uint16Array(1);
  assert.equal(emitter.emit(built.state, 0, actions, args), 1);
  assert.equal(actions[0], fast.ACTION.CAST_POISON); assert.equal(emitter.skillId, fast.SKILL.POISON);
});

test("skill descriptors match Fast rule constants and paired mechanics", () => {
  const table = new policy.EnemySkillDescriptorTable();
  for (let skill = fast.SKILL.SHIELD; skill <= fast.SKILL.BOOST; skill += 1) {
    assert.equal(table.cooldown[skill], RULE.SKILL_COOLDOWN[skill]);
    assert.equal(table.duration[skill], RULE.SKILL_DURATION[skill]);
    assert.equal(table.actionCode[skill], fast.ACTION.CAST_SHIELD + skill - 1);
  }
  assert.equal(RULE.SHIELD_HITS, 2); assert.equal(table.chanceSupport[fast.SKILL.STUN], 1);
  assert.equal(table.targetGenerator[fast.SKILL.TELEPORT], policy.TARGET_GENERATOR.TELEPORT_MASK);
  assert.equal(table.chanceSupport[fast.SKILL.OVERLOAD], 0);
});
