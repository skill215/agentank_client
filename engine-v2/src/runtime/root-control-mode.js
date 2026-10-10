"use strict";

const { SUPPORT_STATUS } = require("./escape-obligation");

const ROOT_CONTROL_MODE = Object.freeze({
  COMMITTED_ESCAPE: 1,
  TACTICAL_CONTACT: 2,
  STRATEGIC_NAVIGATION: 3
});

const ROOT_CONTROL_REASON = Object.freeze({
  COMMITTED_TRAPPED: 1,
  COMMITTED_RESTRICTION: 2,
  VISIBLE_NEAR: 3,
  VISIBLE_RAY: 4,
  NO_CONTACT: 5,
  ENEMY_DISABLED: 6,
  COMMITTED_BOMB: 7,
  PREDICTIVE_ATTACK: 8
});
const TACTICAL_TRIGGER = Object.freeze({ ENEMY_DISABLED: 1 << 0,
  COMMITTED_BOMB: 1 << 1, PREDICTIVE_ATTACK: 1 << 2 });

// Constructed once with ProductionRoot.  The context is scalar-only so mode
// classification adds no per-root allocation and no second state slab.
class RootControlContext {
  constructor() {
    this.mode = ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION;
    this.reason = ROOT_CONTROL_REASON.NO_CONTACT;
    this.committedEntityCount = 0;
    this.escapeSupport = SUPPORT_STATUS.NONE;
    this.escapeMemberCount = 0;
    this.actionCount = 0;
    this.enemyVisible = 0;
    this.enemyDistance = 0xffff;
    this.clearLine = 0;
    this.runtimeMode = 0;
    this.tacticalTrigger = 0;
    this.contactSearchWithinEscape = 0;
  }
}

class ControlModeRouter {
  constructor() { this.context = new RootControlContext(); this.classifyCount = 0; }

  classify(escape, actionCount, enemyVisible, enemyDistance, clearLine, runtimeMode,
      tacticalTrigger = 0, contactSearchWithinEscape = 0) {
    const c = this.context;
    c.committedEntityCount = escape.committedEntityCount | 0;
    c.escapeSupport = escape.supportStatus | 0;
    c.escapeMemberCount = escape.firstActionCount | 0;
    c.actionCount = actionCount | 0;
    c.enemyVisible = enemyVisible ? 1 : 0;
    c.enemyDistance = enemyVisible ? enemyDistance | 0 : 0xffff;
    c.clearLine = clearLine ? 1 : 0;
    c.runtimeMode = runtimeMode | 0;
    c.tacticalTrigger = tacticalTrigger | 0;
    c.contactSearchWithinEscape = contactSearchWithinEscape ? 1 : 0;
    const tacticalContact = c.enemyVisible && (c.clearLine || c.enemyDistance <= 9 ||
      c.tacticalTrigger !== 0);

    if (c.committedEntityCount > 0 && c.escapeSupport === SUPPORT_STATUS.TRAPPED) {
      c.mode = ROOT_CONTROL_MODE.COMMITTED_ESCAPE;
      c.reason = ROOT_CONTROL_REASON.COMMITTED_TRAPPED;
    } else if ((!c.contactSearchWithinEscape || !tacticalContact) &&
        c.committedEntityCount > 0 &&
        c.escapeSupport === SUPPORT_STATUS.COMPLETE &&
        c.escapeMemberCount > 0 && c.escapeMemberCount < c.actionCount) {
      c.mode = ROOT_CONTROL_MODE.COMMITTED_ESCAPE;
      c.reason = ROOT_CONTROL_REASON.COMMITTED_RESTRICTION;
    } else if (c.enemyVisible && c.clearLine) {
      c.mode = ROOT_CONTROL_MODE.TACTICAL_CONTACT;
      c.reason = ROOT_CONTROL_REASON.VISIBLE_RAY;
    } else if (c.enemyVisible && c.enemyDistance <= 9) {
      c.mode = ROOT_CONTROL_MODE.TACTICAL_CONTACT;
      c.reason = ROOT_CONTROL_REASON.VISIBLE_NEAR;
    } else if (c.enemyVisible &&
        (c.tacticalTrigger & TACTICAL_TRIGGER.ENEMY_DISABLED)) {
      c.mode = ROOT_CONTROL_MODE.TACTICAL_CONTACT;
      c.reason = ROOT_CONTROL_REASON.ENEMY_DISABLED;
    } else if (c.enemyVisible &&
        (c.tacticalTrigger & TACTICAL_TRIGGER.COMMITTED_BOMB)) {
      c.mode = ROOT_CONTROL_MODE.TACTICAL_CONTACT;
      c.reason = ROOT_CONTROL_REASON.COMMITTED_BOMB;
    } else if (c.enemyVisible &&
        (c.tacticalTrigger & TACTICAL_TRIGGER.PREDICTIVE_ATTACK)) {
      c.mode = ROOT_CONTROL_MODE.TACTICAL_CONTACT;
      c.reason = ROOT_CONTROL_REASON.PREDICTIVE_ATTACK;
    } else {
      c.mode = ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION;
      c.reason = ROOT_CONTROL_REASON.NO_CONTACT;
    }
    this.classifyCount += 1;
    return c.mode;
  }
}

module.exports = { ROOT_CONTROL_MODE, ROOT_CONTROL_REASON, TACTICAL_TRIGGER,
  RootControlContext, ControlModeRouter };
