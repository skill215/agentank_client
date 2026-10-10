"use strict";

const { HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { V3_COMPONENT_ABI, V3_COMPONENT_MODE, V3_RESULT_STATUS,
  V3_PROPOSAL_CLASS, V3_EVIDENCE, V3_SLOT } = require("../contracts");
const { ComponentResult } = require("../component-result");

class V2ForcedWinAdapter {
  constructor(bridge, mode = V3_COMPONENT_MODE.SHADOW, options = {}) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.TACTICAL_SEARCH;
    this.id = "V2_STRICT_FORCED_WIN";
    this.bridge = bridge;
    this.mode = mode;
    this.depth = options.depth || 3;
    this.nodeBudget = options.nodeBudget || 128;
    this.result = new ComponentResult(bridge.proposals, V3_SLOT.TACTICAL_SEARCH,
      mode === V3_COMPONENT_MODE.ACTIVE);
    this.callCount = 0;
    this.proofCount = 0;
    this.provenCount = 0;
    this.unknownCount = 0;
    this.disprovenCount = 0;
    this.overrideCount = 0;
    this.hardBlockedCount = 0;
  }

  invoke(call) {
    this.callCount += 1;
    const bridge = this.bridge;
    let selected = -1; let proof = PROOF_STATUS.UNKNOWN;
    if (this.mode !== V3_COMPONENT_MODE.PASS_THROUGH && bridge.prepared && bridge.bundle &&
        bridge.supportComplete && bridge.engine.adapter.enemyVisible) {
      const gate = bridge.engine.finalGate; const count = bridge.actionCount;
      if (gate.evaluate(bridge.bundle, bridge.actions, bridge.arguments, count) === count) {
        this.proofCount += 1;
        const search = bridge.engine.forcedWinSearch;
        proof = search.search(bridge.bundle, bridge.actions, bridge.arguments, count,
          bridge.enemyActions, bridge.enemyArguments, bridge.enemyActionCount,
          this.depth, this.nodeBudget);
        selected = search.winningRootRow;
        if (proof === PROOF_STATUS.PROVEN) this.provenCount += 1;
        else if (proof === PROOF_STATUS.DISPROVEN) this.disprovenCount += 1;
        else this.unknownCount += 1;
        if (selected >= 0 && gate.status[selected] !== HARD_STATUS.ALLOW) {
          this.hardBlockedCount += 1; selected = -1;
        }
        if (selected >= 0 && !gate.finalAllows(bridge.bundle, bridge.actions,
            bridge.arguments, selected, count)) {
          this.hardBlockedCount += 1; selected = -1;
        }
      }
    }
    if (proof === PROOF_STATUS.PROVEN && selected >= 0) {
      const action = bridge.actions[selected]; const argument = bridge.arguments[selected];
      this.result.set(V3_RESULT_STATUS.PROPOSED, action, argument, true,
        V3_EVIDENCE.STRICT_PROOF | V3_EVIDENCE.PHYSICAL_HARD,
        bridge.engine.forcedWinSearch.nodes, V3_PROPOSAL_CLASS.STRICT_FORCED_WIN);
    } else this.result.set(bridge.supportComplete ? V3_RESULT_STATUS.NO_PROPOSAL :
      V3_RESULT_STATUS.INCOMPLETE, 0, -1, bridge.supportComplete,
      bridge.supportComplete ? V3_EVIDENCE.NONE : V3_EVIDENCE.INFORMATION |
        V3_EVIDENCE.FALLBACK, bridge.engine.forcedWinSearch.nodes);
    return call.next();
  }

  summary() {
    return { callCount: this.callCount, proofCount: this.proofCount,
      provenCount: this.provenCount, unknownCount: this.unknownCount,
      disprovenCount: this.disprovenCount, overrideCount: this.overrideCount,
      hardBlockedCount: this.hardBlockedCount,
      rootRestoreFailures: this.bridge.engine.forcedWinSearch.rootRestoreFailures };
  }
}

module.exports = { V2ForcedWinAdapter };
