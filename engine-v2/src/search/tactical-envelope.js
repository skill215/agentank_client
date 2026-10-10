"use strict";

const { HARD_STATUS } = require("../abi/fast-codes");
const { SAFETY_STATUS } = require("./information-safety-closure");

// A zero-copy view. It deliberately owns no per-action storage: Risk, Safety
// and Value search remain the single source of the arrays.
class TacticalEnvelopeView {
  constructor() {
    this.outcome = null; this.physical = null; this.information = null;
    this.source = null; this.completedDepth = 0; this.contact = 0;
  }
  bind(outcome, physical, information, contact) {
    this.outcome = outcome; this.physical = physical; this.information = information;
    this.source = information && information.completedDepth > 0 ? information :
      physical && physical.completedDepth > 0 ? physical : null;
    this.completedDepth = this.source ? this.source.completedDepth : 0;
    this.contact = contact ? 1 : 0; return this;
  }
  refuted(row) {
    const o = this.outcome;
    if (!o || row < 0 || row >= o.count) return 1;
    if (o.hard[row] === HARD_STATUS.REJECT_PROVEN ||
        o.hard[row] === HARD_STATUS.REJECT_POLICY) return 1;
    return o.safety[row] === SAFETY_STATUS.PROVEN_DEAD && o.coverage[row] === 10000 ? 1 : 0;
  }
}

module.exports = { TacticalEnvelopeView };
