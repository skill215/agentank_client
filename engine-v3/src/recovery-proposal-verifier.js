"use strict";

const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { ProductionDepthSearch } =
  require("../../engine-v2/src/search/production-depth-search");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");

const RECOVERY_VERIFY_STATUS = Object.freeze({ NOT_APPLICABLE: 0,
  INCOMPLETE: 1, REFUTED: 2, NONINFERIOR: 3, DOMINATES: 4 });

// Diagnostic-only comparison of a V2 recovery proposal against the action V1
// would execute at the same root.  A result owns no Hard/Proof semantics: even
// a complete finite-depth matrix is an exact interval only for that bounded
// value model.  ACTIVE experiments may use strict interval separation as an
// action-owner hypothesis and must still be judged by paired arena outcomes.
class RecoveryProposalVerifier {
  constructor(engine, options = {}) {
    this.depth = Math.max(1, Math.min(4,
      Number.isSafeInteger(options.depth) ? options.depth : 2));
    this.nodeBudget = Math.max(64, Math.min(8192,
      Number.isSafeInteger(options.nodeBudget) ? options.nodeBudget : 2048));
    this.cacheBank = new ProductionCacheBank();
    this.search = new ProductionDepthSearch(this.cacheBank,
      engine.runtime.runtimeConfig, null, { selectiveContinuationEnabled: true,
        windowedBoundsEnabled: true, crossFramePVEnabled: false,
        crossFrameRootPVEnabled: false, diagnosticNodeCapacity: this.nodeBudget });
    this.search.rootTransitions.setEnabled(false);
    this.rootRows = new Uint8Array(2);
    this.lastFrame = -1;
    this.lastStatus = RECOVERY_VERIFY_STATUS.NOT_APPLICABLE;
    this.lastLegacyRow = -1; this.lastCandidateRow = -1;
    this.lastLegacyLower = 0; this.lastLegacyUpper = 0;
    this.lastCandidateLower = 0; this.lastCandidateUpper = 0;
    this.attemptCount = 0; this.completeCount = 0; this.incompleteCount = 0;
    this.refutedCount = 0; this.dominanceCount = 0; this.sameActionCount = 0;
    this.noninferiorCount = 0;
    this.missingLegacyCount = 0; this.nodes = 0; this.maximumNodes = 0;
    this.rootRestoreFailures = 0; this.hotAllocationCount = 0;
  }

  legacyRow(engine, legacyAction) {
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === legacyAction) return row;
    return -1;
  }

  verify(bundle, engine, candidateRow, legacyAction) {
    this.lastStatus = RECOVERY_VERIFY_STATUS.NOT_APPLICABLE;
    this.lastCandidateRow = candidateRow;
    const legacyRow = this.legacyRow(engine, legacyAction);
    this.lastLegacyRow = legacyRow;
    if (!bundle || candidateRow < 0 || candidateRow >= engine.ourCount || legacyRow < 0) {
      if (legacyRow < 0) this.missingLegacyCount += 1;
      return this.lastStatus;
    }
    if (candidateRow === legacyRow || engine.ourActions[candidateRow] === legacyAction) {
      this.sameActionCount += 1; return this.lastStatus;
    }
    this.attemptCount += 1;
    const frame = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (frame < this.lastFrame) this.cacheBank.beginMatch();
    this.lastFrame = frame;
    if (legacyRow < candidateRow) {
      this.rootRows[0] = legacyRow; this.rootRows[1] = candidateRow;
    } else {
      this.rootRows[0] = candidateRow; this.rootRows[1] = legacyRow;
    }
    const state = bundle.state; const lo = state.hashLo; const hi = state.hashHi;
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    const completed = this.search.search(bundle, engine.ourActions, engine.ourArguments,
      engine.ourCount, engine.enemyActions, engine.enemyArguments, engine.enemyCount,
      this.depth, this.nodeBudget, engine.policy.baseRisk, 0, this.rootRows, 2);
    this.nodes += this.search.nodes;
    if (this.search.nodes > this.maximumNodes) this.maximumNodes = this.search.nodes;
    if (state.hashLo !== lo || state.hashHi !== hi ||
        state.deltaUsed * 1024 + state.eventUsed !== mark) this.rootRestoreFailures += 1;
    const complete = completed >= this.depth &&
      this.search.representativeSupportComplete === 1 &&
      this.search.representativeSupportDepth >= this.depth;
    if (!complete) {
      this.lastStatus = RECOVERY_VERIFY_STATUS.INCOMPLETE;
      this.incompleteCount += 1; return this.lastStatus;
    }
    this.completeCount += 1;
    // A complete matrix collapses each row interval to its exact bounded
    // maximin value.  Keep the interval names so a later non-exact verifier can
    // replace this implementation without changing the ownership contract.
    this.lastLegacyLower = this.search.rootScore[legacyRow];
    this.lastLegacyUpper = this.search.rootScore[legacyRow];
    this.lastCandidateLower = this.search.rootScore[candidateRow];
    this.lastCandidateUpper = this.search.rootScore[candidateRow];
    if (this.lastCandidateLower > this.lastLegacyUpper) {
      this.lastStatus = RECOVERY_VERIFY_STATUS.DOMINATES;
      this.dominanceCount += 1;
    } else if (this.lastCandidateLower === this.lastLegacyUpper) {
      this.lastStatus = RECOVERY_VERIFY_STATUS.NONINFERIOR;
      this.noninferiorCount += 1;
    } else {
      this.lastStatus = RECOVERY_VERIFY_STATUS.REFUTED;
      this.refutedCount += 1;
    }
    return this.lastStatus;
  }

  summary() {
    return { enabled: true, depth: this.depth, nodeBudget: this.nodeBudget,
      lastStatus: this.lastStatus, attemptCount: this.attemptCount,
      completeCount: this.completeCount, incompleteCount: this.incompleteCount,
      refutedCount: this.refutedCount, dominanceCount: this.dominanceCount,
      noninferiorCount: this.noninferiorCount,
      sameActionCount: this.sameActionCount, missingLegacyCount: this.missingLegacyCount,
      nodes: this.nodes, maximumNodes: this.maximumNodes,
      rootRestoreFailures: this.rootRestoreFailures,
      lastLegacyRow: this.lastLegacyRow, lastCandidateRow: this.lastCandidateRow,
      lastLegacyLower: this.lastLegacyLower, lastLegacyUpper: this.lastLegacyUpper,
      lastCandidateLower: this.lastCandidateLower,
      lastCandidateUpper: this.lastCandidateUpper,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { RECOVERY_VERIFY_STATUS, RecoveryProposalVerifier };
