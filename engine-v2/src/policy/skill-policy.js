"use strict";

const { RULE } = require("../generated/fast-config");
const { ACTION, SKILL, NONE_CELL } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION_FAMILY, PLAN_KIND } = require("../abi/policy-codes");

const SKILL_PURPOSE = Object.freeze({ SURVIVE: 1 << 0, TRADE: 1 << 1,
  INTERRUPT: 1 << 2, ESCAPE: 1 << 3, KILL: 1 << 4, ZONE: 1 << 5,
  AMBUSH: 1 << 6, INFORMATION_DENIAL: 1 << 7, CADENCE_DENY: 1 << 8,
  STAR: 1 << 9, FLANK: 1 << 10, MOBILITY: 1 << 11, CHASE: 1 << 12 });
const TARGET_GENERATOR = Object.freeze({ SCALAR: 1, TELEPORT_MASK: 2 });
const DESCRIPTOR_FIELD = Object.freeze({ SKILL_ID: 0, ACTION_CODE: 1, ACTION_FAMILY: 2,
  COOLDOWN: 3, DURATION: 4, PURPOSE_MASK: 5, PLAN_KIND: 6, TARGET_GENERATOR: 7,
  CHANCE_SUPPORT: 8, CAPABILITY_MASK: 9, VERSION: 10, COUNT: 11 });

class EnemySkillDescriptorTable {
  constructor() {
    const count = SKILL.BOOST + 1; this.actionCode = new Uint8Array(count);
    this.actionFamily = new Uint8Array(count); this.cooldown = new Uint8Array(count);
    this.duration = new Uint8Array(count); this.purposeMask = new Uint16Array(count);
    this.planKind = new Uint8Array(count); this.targetGenerator = new Uint8Array(count);
    this.chanceSupport = new Uint8Array(count); this.capabilityMask = new Uint16Array(count);
    this.version = new Uint8Array(count); this.featureDependencyMask = new Uint16Array(count);
    const purposes = [0, SKILL_PURPOSE.SURVIVE | SKILL_PURPOSE.TRADE,
      SKILL_PURPOSE.INTERRUPT | SKILL_PURPOSE.ESCAPE,
      SKILL_PURPOSE.INTERRUPT | SKILL_PURPOSE.KILL,
      SKILL_PURPOSE.KILL | SKILL_PURPOSE.ZONE,
      SKILL_PURPOSE.AMBUSH | SKILL_PURPOSE.INFORMATION_DENIAL,
      SKILL_PURPOSE.CADENCE_DENY | SKILL_PURPOSE.INTERRUPT,
      SKILL_PURPOSE.ESCAPE | SKILL_PURPOSE.STAR | SKILL_PURPOSE.FLANK,
      SKILL_PURPOSE.MOBILITY | SKILL_PURPOSE.ESCAPE | SKILL_PURPOSE.CHASE];
    for (let skill = SKILL.SHIELD; skill <= SKILL.BOOST; skill += 1) {
      this.actionCode[skill] = ACTION.CAST_SHIELD + skill - 1;
      this.actionFamily[skill] = ACTION_FAMILY.SKILL; this.cooldown[skill] = RULE.SKILL_COOLDOWN[skill];
      this.duration[skill] = RULE.SKILL_DURATION[skill]; this.purposeMask[skill] = purposes[skill];
      this.planKind[skill] = PLAN_KIND.SKILL; this.targetGenerator[skill] =
        skill === SKILL.TELEPORT ? TARGET_GENERATOR.TELEPORT_MASK : TARGET_GENERATOR.SCALAR;
      this.chanceSupport[skill] = skill === SKILL.STUN || skill === SKILL.TELEPORT ? 1 : 0;
      this.capabilityMask[skill] = 1 << (skill - 1); this.featureDependencyMask[skill] = 0x0113;
      this.version[skill] = 1;
    }
    this.hotAllocationCount = 0;
  }
  lookup(skillId) { return skillId >= SKILL.SHIELD && skillId <= SKILL.BOOST &&
    this.version[skillId] ? skillId : 0; }
  read(skillId, out) {
    const id = this.lookup(skillId); if (!id || out.length < DESCRIPTOR_FIELD.COUNT) return 0;
    out[DESCRIPTOR_FIELD.SKILL_ID] = id; out[DESCRIPTOR_FIELD.ACTION_CODE] = this.actionCode[id];
    out[DESCRIPTOR_FIELD.ACTION_FAMILY] = this.actionFamily[id]; out[DESCRIPTOR_FIELD.COOLDOWN] = this.cooldown[id];
    out[DESCRIPTOR_FIELD.DURATION] = this.duration[id]; out[DESCRIPTOR_FIELD.PURPOSE_MASK] = this.purposeMask[id];
    out[DESCRIPTOR_FIELD.PLAN_KIND] = this.planKind[id]; out[DESCRIPTOR_FIELD.TARGET_GENERATOR] = this.targetGenerator[id];
    out[DESCRIPTOR_FIELD.CHANCE_SUPPORT] = this.chanceSupport[id]; out[DESCRIPTOR_FIELD.CAPABILITY_MASK] = this.capabilityMask[id];
    out[DESCRIPTOR_FIELD.VERSION] = this.version[id]; return DESCRIPTOR_FIELD.COUNT;
  }
}

class OwnSkillEmitter {
  constructor(skillId, table = new EnemySkillDescriptorTable()) {
    const id = table.lookup(skillId); if (!id) throw Object.assign(new RangeError("invalid own skill"),
      { code: "INVALID_OWN_SKILL" });
    this.skillId = id; this.actionCode = table.actionCode[id]; this.targetGenerator = table.targetGenerator[id];
    this.cooldown = table.cooldown[id]; this.duration = table.duration[id]; this.emitCount = 0;
    this.hotAllocationCount = 0;
  }
  emit(state, actor, outActions, outArguments, target = NONE_CELL) {
    if (!state || actor < 0 || actor > 1 || outActions.length < 1 || outArguments.length < 1) return 0;
    const arrays = state.arrays; const frame = arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (arrays[ARRAY.TANK_SKILL][actor] !== this.skillId ||
        frame < arrays[ARRAY.TANK_SKILL_READY][actor]) return 0;
    if (this.skillId === SKILL.TELEPORT && target === NONE_CELL) return 0;
    outActions[0] = this.actionCode; outArguments[0] = this.skillId === SKILL.TELEPORT ? target : NONE_CELL;
    this.emitCount += 1; return 1;
  }
}

function createOwnSkillEmitter(skillId, table) { return new OwnSkillEmitter(skillId, table); }

module.exports = { SKILL_PURPOSE, TARGET_GENERATOR, DESCRIPTOR_FIELD,
  EnemySkillDescriptorTable, OwnSkillEmitter, createOwnSkillEmitter };
