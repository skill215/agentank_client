"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { HARD_STATUS, NONE_CELL } = require("../abi/fast-codes");

// Every production action source ends here. Upstream search, plans and
// heuristics may order actions, but none of them may authorize an action.
// Hard status is computed before scoring and the selected action is checked
// once more against the unchanged root immediately before emission.
class FinalActionGate {
  constructor() {
    this.status = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.chanceSupportCount = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.chanceFatalSupportCount = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.chanceIncompleteSupportCount = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.chanceCell = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES);
    this.chanceDirection = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES);
    this.allowCount = 0; this.checkedCount = 0; this.finalCheckCount = 0;
    this.overrideCount = 0; this.noSafeActionCount = 0;
    this.lastPreferred = -1; this.lastSelected = -1; this.hotAllocationCount = 0;
  }

  evaluate(bundle, actions, arguments_, count) {
    this.allowCount = 0; this.checkedCount = 0; this.lastSelected = -1;
    if (!bundle || !bundle.hard || count < 1 || count > actions.length ||
        count > arguments_.length || count > this.status.length) return 0;
    this.chanceCell.fill(NONE_CELL); this.chanceDirection.fill(0xff);
    for (let index = 0; index < count; index += 1) {
      const chanceOffset = index * SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES;
      const hard = bundle.hard.evaluateAllOwnChance(actions[index], arguments_[index],
        undefined, undefined, undefined, this.chanceCell, this.chanceDirection, chanceOffset);
      this.status[index] = hard; this.checkedCount += 1;
      this.chanceSupportCount[index] = bundle.hard.lastChanceSupportCount;
      this.chanceFatalSupportCount[index] = bundle.hard.lastChanceFatalSupportCount;
      this.chanceIncompleteSupportCount[index] = bundle.hard.lastChanceIncompleteSupportCount;
      if (hard === HARD_STATUS.ALLOW) this.allowCount += 1;
    }
    return count;
  }

  finalAllows(bundle, actions, arguments_, index, count) {
    if (!bundle || !bundle.hard || index < 0 || index >= count ||
        this.status[index] !== HARD_STATUS.ALLOW) return 0;
    this.finalCheckCount += 1;
    return bundle.hard.evaluateAllOwnChance(actions[index],
      arguments_[index] === undefined ? NONE_CELL : arguments_[index]) === HARD_STATUS.ALLOW;
  }

  // order contains candidate indexes in descending preference. The preferred
  // index is tried first even if it is not order[0], then every remaining row.
  select(bundle, actions, arguments_, count, preferred, order, orderCount = count) {
    this.lastPreferred = preferred; this.lastSelected = -1;
    if (this.finalAllows(bundle, actions, arguments_, preferred, count)) {
      this.lastSelected = preferred; return preferred;
    }
    for (let cursor = 0; cursor < orderCount; cursor += 1) {
      const index = order[cursor]; if (index === preferred) continue;
      if (this.finalAllows(bundle, actions, arguments_, index, count)) {
        this.lastSelected = index; this.overrideCount += 1; return index;
      }
    }
    this.noSafeActionCount += 1; return -1;
  }
}

module.exports = { FinalActionGate };
