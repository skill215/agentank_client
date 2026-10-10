"use strict";

const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, NONE_FRAME } = require("../../../engine-v2/src/abi/fast-codes");
const { NativeDualPolicyResponseMassPoc } = require(
  "./native-dual-policy-response-mass-poc");

const FRAME_SLOTS = 10;
const DOMAIN_WIDTH = 6;

function active(deadline, frame) {
  return deadline !== NONE_FRAME && deadline > frame;
}

class NativeStunTurnDomainCompactionPoc extends NativeDualPolicyResponseMassPoc {
  constructor(mode = "off", options = {}) {
    super(mode, options);
    this.compactedWeight = new Uint32Array(FRAME_SLOTS * DOMAIN_WIDTH);
    this.compactedIndex = new Uint8Array(FRAME_SLOTS);
    this.turnIndex = new Uint8Array(FRAME_SLOTS);
    this.turnAction = new Uint8Array(FRAME_SLOTS);
    this.compactedIndex.fill(255);
    this.turnIndex.fill(255);
    this.domainVisitCount = 0;
    this.stunnedDomainCount = 0;
    this.turnPairDomainCount = 0;
    this.compactedActionCount = 0;
    this.compactedWeightTotal = 0;
    this.zeroWeightPairCount = 0;
    this.compactionHotAllocationCount = 0;
  }

  appendDomainAction(engine, search, state, depth, offset, count, action,
      argument, stunned) {
    if (stunned && (action === ACTION.TURN_LEFT ||
        action === ACTION.TURN_RIGHT)) {
      const weight = Math.min(65535,
        search.opponentWeight(engine, state, action));
      const prior = this.turnIndex[depth];
      if (prior !== 255 && action !== this.turnAction[depth]) {
        const combined = this.compactedWeight[offset + prior] + weight;
        this.compactedWeight[offset + prior] = combined;
        this.compactedIndex[depth] = prior;
        this.turnPairDomainCount += 1;
        this.compactedActionCount += 1;
        this.compactedWeightTotal += combined;
        if (!combined) this.zeroWeightPairCount += 1;
        return count;
      }
      this.turnIndex[depth] = count; this.turnAction[depth] = action;
      this.compactedWeight[offset + count] = weight;
    }
    this.enemyActions[offset + count] = action;
    this.enemyArguments[offset + count] = argument;
    return count + 1;
  }

  copyEnemyDomain(engine, search, depth) {
    const offset = depth * DOMAIN_WIDTH;
    const state = engine.adapter.state;
    const arrays = state.arrays;
    this.domainVisitCount += 1;
    this.compactedIndex[depth] = 255;
    this.turnIndex[depth] = 255;
    const frame = arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const stunned = active(arrays[ARRAY.TANK_STUN_UNTIL][1], frame);
    if (stunned) this.stunnedDomainCount += 1;
    let count = 0;
    if (depth === 0) {
      for (let column = 0; column < engine.enemyCount && count < DOMAIN_WIDTH;
        column += 1) {
        if (search.rootEnemyDomainMask && !search.rootEnemyDomainMask[column])
          continue;
        count = this.appendDomainAction(engine, search, state, depth, offset,
          count, engine.enemyActions[column], engine.enemyArguments[column],
          stunned);
      }
    } else {
      const top = Math.min(4, depth);
      search.generate(engine, top, 1);
      const generated = Math.min(DOMAIN_WIDTH,
        search.deepEnemyCount[top] | 0);
      const source = top * DOMAIN_WIDTH;
      for (let index = 0; index < generated && count < DOMAIN_WIDTH;
        index += 1)
        count = this.appendDomainAction(engine, search, state, depth, offset,
          count, search.deepEnemyActions[source + index],
          search.deepEnemyArguments[source + index], stunned);
    }
    this.enemyCount[depth] = count;
    return count;
  }

  responseWeight(engine, search, state, enemyAction, depth, index) {
    return this.compactedIndex[depth] === index ?
      this.compactedWeight[depth * DOMAIN_WIDTH + index] :
      Math.min(65535, search.opponentWeight(engine, state, enemyAction));
  }

  summary() {
    return { ...super.summary(),
      semantics: "DUAL_POLICY_STUN_TURN_DOMAIN_COMPACTION",
      stunTurnDomainCompaction: true,
      domainVisitCount: this.domainVisitCount,
      stunnedDomainCount: this.stunnedDomainCount,
      turnPairDomainCount: this.turnPairDomainCount,
      compactedActionCount: this.compactedActionCount,
      compactedWeightTotal: this.compactedWeightTotal,
      zeroWeightPairCount: this.zeroWeightPairCount,
      compactionHotAllocationCount: this.compactionHotAllocationCount };
  }
}

module.exports = { NativeStunTurnDomainCompactionPoc };
