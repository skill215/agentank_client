"use strict";

const { V3_COMPONENT_ABI, V3_SLOT } = require("../contracts");
const { ROOT_CONTROL_MODE, ControlModeRouter } =
  require("../../../engine-v2/src/runtime/root-control-mode");
const { SUPPORT_STATUS } = require("../../../engine-v2/src/runtime/escape-obligation");

// A deliberately narrow first bridge: V2 owns contact classification while
// frozen V1 still owns the direct-attack calculation. No V1 object is passed
// off as a V2 FastState bundle.
class V2ContactAttackAdapter {
  constructor() {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.DIRECT_ATTACK;
    this.id = "V2_CONTROL_MODE_ROUTER_DIRECT_ATTACK";
    this.router = new ControlModeRouter();
    this.escape = { committedEntityCount: 0, supportStatus: SUPPORT_STATUS.NONE,
      firstActionCount: 0 };
    this.tacticalCount = 0;
    this.strategicCount = 0;
  }

  invoke(call) {
    const me = call.me;
    const enemy = call.enemy;
    const game = call.game;
    const visible = Boolean(enemy && enemy.tank);
    let distance = 0xffff;
    let clear = false;
    if (visible) {
      const a = me.tank.position;
      const b = enemy.tank.position;
      distance = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      clear = Boolean(call.runtime.callLegacy("clearLine", a, b, game.map));
    }
    const mode = this.router.classify(this.escape, 1, visible, distance, clear, 0);
    if (mode !== ROOT_CONTROL_MODE.TACTICAL_CONTACT) {
      this.strategicCount += 1;
      return null;
    }
    this.tacticalCount += 1;
    return call.next();
  }
}

module.exports = { V2ContactAttackAdapter };
