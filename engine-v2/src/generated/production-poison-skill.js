"use strict";

const { ACTION, SKILL, NONE_CELL } = require("../abi/fast-codes");
const { RULE } = require("./fast-config");

class OwnPoisonEmitter {
  constructor() { this.skillId = SKILL.POISON; this.actionCode = ACTION.CAST_POISON;
    this.cooldown = RULE.SKILL_COOLDOWN[SKILL.POISON]; this.duration = RULE.SKILL_DURATION[SKILL.POISON];
    this.hotAllocationCount = 0; }
  emit(outActions, outArguments) { if (outActions.length < 1 || outArguments.length < 1) return 0;
    outActions[0] = this.actionCode; outArguments[0] = NONE_CELL; return 1; }
}

class ProductionEnemySkillDescriptors {
  constructor() {
    this.actionCode = new Uint8Array(SKILL.BOOST + 1); this.cooldown = new Uint8Array(SKILL.BOOST + 1);
    this.duration = new Uint8Array(SKILL.BOOST + 1); this.version = new Uint8Array(SKILL.BOOST + 1);
    for (let skill = SKILL.SHIELD; skill <= SKILL.BOOST; skill += 1) {
      this.actionCode[skill] = ACTION.CAST_SHIELD + skill - 1; this.cooldown[skill] = RULE.SKILL_COOLDOWN[skill];
      this.duration[skill] = RULE.SKILL_DURATION[skill]; this.version[skill] = 1; }
    this.hotAllocationCount = 0;
  }
  lookup(skillId) { return skillId >= SKILL.SHIELD && skillId <= SKILL.BOOST &&
    this.version[skillId] ? skillId : 0; }
}

module.exports = { OwnPoisonEmitter, ProductionEnemySkillDescriptors };
