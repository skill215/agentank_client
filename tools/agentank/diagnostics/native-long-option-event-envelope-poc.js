"use strict";

// BP26 diagnostic-only event-bounded long Option evaluator.
//
// Primitive Minimax is the wrong shape for a route whose identity is
// "replan one AttackPose step until FIRE".  This evaluator therefore keeps
// exactly one own policy action at every decision state, expands the same
// V1-shaped enemy/chance response frontier, and memoizes equivalent Physical
// states.  Leaves are backed up as facts, not as one heuristic scalar.
//
// The result is evidence for Risk/strategy only.  It never writes Hard,
// Proof, StageMatrix, or the selected root action.

const { CAPACITY } = require("../../../engine-v2/src/generated/fast-config");
const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, FAST_STATUS, HARD_STATUS, TERMINAL, CHANCE, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { NativeAttackPoseOptionPoc, NativeAttackPoseFeedbackSearchPoc } = require(
  "./native-tactical-domain-evaluator-poc");

const LONG_EVENT_OUTCOME = Object.freeze({
  FIRE: 1,
  DEATH: 2,
  ABORT: 4,
  RESCUE: 8,
  OPEN: 16,
  INCOMPLETE: 32,
  WIN: 64,
  POLICY_LOSS: 128
});

const DEEP_WIDTH = 6;
const MAX_FRAMES = 8;
const TT_CAPACITY = 4096;
const TT_MASK = TT_CAPACITY - 1;
const COMPLETE_BLOCK_MASK = LONG_EVENT_OUTCOME.DEATH |
  LONG_EVENT_OUTCOME.ABORT | LONG_EVENT_OUTCOME.RESCUE |
  LONG_EVENT_OUTCOME.OPEN | LONG_EVENT_OUTCOME.INCOMPLETE |
  LONG_EVENT_OUTCOME.POLICY_LOSS;

function mix32(hash, value) {
  hash = Math.imul((hash ^ (value >>> 0)) >>> 0, 0x45d9f3b) >>> 0;
  return (hash ^ hash >>> 16) >>> 0;
}

function eventClosed(mask) {
  return Boolean(mask & LONG_EVENT_OUTCOME.FIRE) &&
    !(mask & COMPLETE_BLOCK_MASK);
}

function terminalClosed(mask) {
  return Boolean(mask & LONG_EVENT_OUTCOME.WIN) &&
    !(mask & COMPLETE_BLOCK_MASK);
}

class NativeLongOptionEventEnvelopePoc {
  constructor(mode = "off", options = {}) {
    this.mode = mode === "shadow" || mode === "active" ? mode : "off";
    this.maximumFrames = Math.max(2, Math.min(MAX_FRAMES,
      Number.isSafeInteger(options.maximumFrames) ? options.maximumFrames : 6));
    this.nodeBudget = Math.max(64, Math.min(16384,
      Number.isSafeInteger(options.nodeBudget) ? options.nodeBudget : 2048));
    this.pose = options.pose || new NativeAttackPoseOptionPoc({ routeProof: true });
    this.feedback = options.feedback || new NativeAttackPoseFeedbackSearchPoc({
      forcePolicy: true, fixedOption: false
    });
    this.enemyActions = new Uint8Array((MAX_FRAMES + 1) * DEEP_WIDTH);
    this.enemyArguments = new Uint16Array((MAX_FRAMES + 1) * DEEP_WIDTH);
    this.enemyCount = new Uint8Array(MAX_FRAMES + 1);
    this.ttStamp = new Uint16Array(TT_CAPACITY);
    this.ttHashLo = new Uint32Array(TT_CAPACITY);
    this.ttHashHi = new Uint32Array(TT_CAPACITY);
    this.ttRemaining = new Uint8Array(TT_CAPACITY);
    this.ttOutcome = new Uint8Array(TT_CAPACITY);
    this.ttEpoch = 0;
    this.checkCount = 0; this.poseMissingCount = 0;
    this.committedBlockedCount = 0; this.candidateRowMissingCount = 0;
    this.rootFireSkipCount = 0; this.rootRouteCount = 0;
    this.evaluationCount = 0; this.completeEvaluationCount = 0;
    this.eventClosedCount = 0; this.terminalClosedCount = 0;
    this.deathCount = 0; this.abortCount = 0;
    this.rescueCount = 0; this.openCount = 0; this.incompleteCount = 0;
    this.winCount = 0; this.policyLossCount = 0;
    this.outcomeMaskCount = new Uint32Array(256);
    this.routeByAction = new Uint32Array(ACTION.BOOST_RIGHT_BOMB + 1);
    this.eventClosedByAction = new Uint32Array(ACTION.BOOST_RIGHT_BOMB + 1);
    this.nodeCount = 0; this.maximumNodes = 0;
    this.transitionCount = 0; this.maximumTransitions = 0;
    this.mergeHitCount = 0; this.ttStoreCount = 0;
    this.ttCapacityFailureCount = 0; this.budgetStopCount = 0;
    this.fastIncompleteCount = 0; this.hardIncompleteCount = 0;
    this.rootRestoreFailureCount = 0; this.wouldProposeCount = 0;
    this.lastAction = ACTION.NONE; this.lastArgument = NONE_CELL;
    this.lastOutcomeMask = 0; this.lastNodes = 0; this.lastTransitions = 0;
    this.lastTargetSignature = 0; this.currentNodes = 0;
    this.currentTransitions = 0; this.hotAllocationCount = 0;
  }

  nextEpoch() {
    this.ttEpoch = (this.ttEpoch + 1) & 0xffff;
    if (!this.ttEpoch) { this.ttStamp.fill(0); this.ttEpoch = 1; }
  }

  targetSignature(pose) {
    const option = pose.selected;
    let hash = mix32(0x9e3779b9, pose.cell[option] + 1);
    hash = mix32(hash, pose.direction[option] + 1);
    hash = mix32(hash, (pose.fireDeadline?.[option] ?? 255) + 1);
    hash = mix32(hash, (pose.responseMask?.[option] ?? 0) + 1);
    return hash || 1;
  }

  hasCommittedDanger(state) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === 1) return 1;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot]) return 1;
    return 0;
  }

  bestAttackRow(engine, pose, action) {
    let best = -1;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (engine.ourActions[row] !== action ||
          engine.hardStatus[row] !== HARD_STATUS.ALLOW ||
          (engine.riskController?.outcome?.acceptable &&
            !engine.riskController.outcome.acceptable[row]) ||
          !pose.supports(row)) continue;
      if (best < 0 || pose.betterRow(engine, row, best)) best = row;
    }
    return best;
  }

  ttIndex(state, remaining) {
    let index = mix32(state.hashLo, state.hashHi ^ remaining) & TT_MASK;
    for (let probe = 0; probe < TT_CAPACITY; probe += 1) {
      // -1 is reserved for a genuinely full table. Encode an empty slot as
      // -(index + 2), otherwise index 0 aliases the full-table sentinel.
      if (this.ttStamp[index] !== this.ttEpoch) return -index - 2;
      if (this.ttHashLo[index] === state.hashLo &&
          this.ttHashHi[index] === state.hashHi &&
          this.ttRemaining[index] === remaining) return index;
      index = (index + 1) & TT_MASK;
    }
    return -1;
  }

  store(state, remaining, outcome) {
    const found = this.ttIndex(state, remaining);
    if (found >= 0) return found;
    if (found === -1) {
      this.ttCapacityFailureCount += 1; return -1;
    }
    const index = -found - 2;
    this.ttStamp[index] = this.ttEpoch;
    this.ttHashLo[index] = state.hashLo; this.ttHashHi[index] = state.hashHi;
    this.ttRemaining[index] = remaining; this.ttOutcome[index] = outcome;
    this.ttStoreCount += 1; return index;
  }

  copyEnemyDomain(engine, search, depth) {
    const offset = depth * DEEP_WIDTH; let count = 0;
    if (depth === 0) {
      for (let column = 0; column < engine.enemyCount && count < DEEP_WIDTH;
        column += 1) {
        if (search.rootEnemyDomainMask && !search.rootEnemyDomainMask[column])
          continue;
        this.enemyActions[offset + count] = engine.enemyActions[column];
        this.enemyArguments[offset + count] = engine.enemyArguments[column];
        count += 1;
      }
    } else {
      const top = Math.min(4, depth);
      search.generate(engine, top, 1);
      const generated = search.deepEnemyCount[top] | 0;
      const source = top * DEEP_WIDTH;
      count = Math.min(DEEP_WIDTH, generated);
      for (let index = 0; index < count; index += 1) {
        this.enemyActions[offset + index] = search.deepEnemyActions[source + index];
        this.enemyArguments[offset + index] =
          search.deepEnemyArguments[source + index];
      }
    }
    this.enemyCount[depth] = count;
    return count;
  }

  appliedOutcome(engine, search, ownAction, depth) {
    const state = engine.adapter.state; const a = state.arrays;
    const terminal = a[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    const event = ownAction === ACTION.FIRE ? LONG_EVENT_OUTCOME.FIRE : 0;
    if (a[ARRAY.TANK_CRASH][0]) return event | LONG_EVENT_OUTCOME.DEATH;
    if (a[ARRAY.TANK_CRASH][1] || terminal === TERMINAL.WIN0)
      return event | LONG_EVENT_OUTCOME.WIN;
    if (terminal === TERMINAL.WIN1 || terminal === TERMINAL.DRAW)
      return event | LONG_EVENT_OUTCOME.POLICY_LOSS;
    const hard = search.diagnosticHard.classifyApplied();
    if (hard === HARD_STATUS.REJECT_PROVEN)
      return event | LONG_EVENT_OUTCOME.DEATH;
    if (hard === HARD_STATUS.REJECT_POLICY)
      return event | LONG_EVENT_OUTCOME.POLICY_LOSS;
    if (hard === HARD_STATUS.INCOMPLETE) {
      this.hardIncompleteCount += 1;
      return event | LONG_EVENT_OUTCOME.INCOMPLETE;
    }
    if (event) return event;
    return this.expandState(engine, search, depth + 1);
  }

  applyResponse(engine, search, ownAction, ownArgument, enemyAction,
      enemyArgument, depth) {
    const state = engine.adapter.state; const kernel = search.diagnosticKernel;
    let ownChance = engine.depthSearch.chanceAlternatives(state, 0, ownAction);
    let deterministicOwn = CHANCE.NORMAL;
    if (search.ownChanceMode === "v1-deterministic" && ownChance > 1) {
      deterministicOwn = search.v1OwnChance(state, ownAction); ownChance = 1;
    }
    const enemyChance = engine.depthSearch.chanceAlternatives(state, 1,
      enemyAction);
    let outcome = 0;
    for (let own = 0; own < ownChance; own += 1) {
      for (let enemy = 0; enemy < enemyChance; enemy += 1) {
        if (this.currentTransitions >= this.nodeBudget) {
          this.budgetStopCount += 1;
          return outcome | LONG_EVENT_OUTCOME.INCOMPLETE;
        }
        this.currentTransitions += 1;
        const mark = state.deltaUsed * 1024 + state.eventUsed;
        const beforeFrame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
        const status = kernel.applyFrame(ownAction, ownArgument,
          enemyAction, enemyArgument,
          ownChance === 1 ? deterministicOwn : own,
          enemyChance === 1 ? CHANCE.NORMAL : enemy);
        if (status !== FAST_STATUS.APPLIED &&
            status !== FAST_STATUS.APPLIED_TERMINAL) {
          this.fastIncompleteCount += 1;
          outcome |= LONG_EVENT_OUTCOME.INCOMPLETE;
        } else {
          search.extendV1StunCountdown(state, ownAction, enemyAction,
            beforeFrame);
          outcome |= this.appliedOutcome(engine, search, ownAction, depth);
        }
        state.undoTo(mark);
      }
    }
    return outcome || LONG_EVENT_OUTCOME.INCOMPLETE;
  }

  expandState(engine, search, depth) {
    if (this.currentNodes >= this.nodeBudget) {
      this.budgetStopCount += 1; return LONG_EVENT_OUTCOME.INCOMPLETE;
    }
    this.currentNodes += 1;
    const state = engine.adapter.state; const remaining = this.maximumFrames - depth;
    if (remaining <= 0) return LONG_EVENT_OUTCOME.OPEN;
    if (this.hasCommittedDanger(state)) return LONG_EVENT_OUTCOME.RESCUE;
    const cached = this.ttIndex(state, remaining);
    if (cached >= 0) {
      this.mergeHitCount += 1; return this.ttOutcome[cached];
    }
    if (cached === -1) {
      this.ttCapacityFailureCount += 1; return LONG_EVENT_OUTCOME.INCOMPLETE;
    }
    const ownAction = this.feedback.routeAction(state);
    if (ownAction === ACTION.NONE) return LONG_EVENT_OUTCOME.ABORT;
    const enemyCount = this.copyEnemyDomain(engine, search, depth);
    if (!enemyCount) return LONG_EVENT_OUTCOME.INCOMPLETE;
    const offset = depth * DEEP_WIDTH; let outcome = 0;
    for (let index = 0; index < enemyCount; index += 1) {
      outcome |= this.applyResponse(engine, search, ownAction, NONE_CELL,
        this.enemyActions[offset + index], this.enemyArguments[offset + index],
        depth);
      if (outcome & LONG_EVENT_OUTCOME.INCOMPLETE) break;
    }
    if (this.store(state, remaining, outcome) < 0)
      outcome |= LONG_EVENT_OUTCOME.INCOMPLETE;
    return outcome || LONG_EVENT_OUTCOME.INCOMPLETE;
  }

  evaluateRoot(engine, search, action, argument) {
    this.evaluationCount += 1; this.currentNodes = 0; this.currentTransitions = 0;
    this.nextEpoch();
    const state = engine.adapter.state; const kernel = search.diagnosticKernel;
    if (!state || !kernel || !search.diagnosticHard ||
        !search.representativeSupportComplete)
      return LONG_EVENT_OUTCOME.INCOMPLETE;
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    const hashLo = state.hashLo; const hashHi = state.hashHi;
    const kernelFailure = kernel.failure; const kernelLastMark = kernel.lastMark;
    const transitionDeltaBase = state.transitionDeltaBase;
    const transitionEventBase = state.transitionEventBase;
    const highWaterDelta = state.highWaterDelta;
    const highWaterEvent = state.highWaterEvent;
    let outcome = 0; const enemyCount = this.copyEnemyDomain(engine, search, 0);
    if (!enemyCount) outcome = LONG_EVENT_OUTCOME.INCOMPLETE;
    for (let index = 0; index < enemyCount; index += 1) {
      outcome |= this.applyResponse(engine, search, action, argument,
        this.enemyActions[index], this.enemyArguments[index], 0);
      if (outcome & LONG_EVENT_OUTCOME.INCOMPLETE) break;
    }
    state.undoTo(mark); kernel.failure = kernelFailure; kernel.lastMark = kernelLastMark;
    state.transitionDeltaBase = transitionDeltaBase;
    state.transitionEventBase = transitionEventBase;
    state.highWaterDelta = highWaterDelta; state.highWaterEvent = highWaterEvent;
    if (state.hashLo !== hashLo || state.hashHi !== hashHi ||
        state.deltaUsed * 1024 + state.eventUsed !== mark) {
      this.rootRestoreFailureCount += 1;
      outcome |= LONG_EVENT_OUTCOME.INCOMPLETE;
    }
    this.nodeCount += this.currentNodes;
    this.transitionCount += this.currentTransitions;
    if (this.currentNodes > this.maximumNodes) this.maximumNodes = this.currentNodes;
    if (this.currentTransitions > this.maximumTransitions)
      this.maximumTransitions = this.currentTransitions;
    this.lastNodes = this.currentNodes; this.lastTransitions = this.currentTransitions;
    return outcome || LONG_EVENT_OUTCOME.INCOMPLETE;
  }

  recordOutcome(mask, incumbentAction) {
    this.lastOutcomeMask = mask;
    this.outcomeMaskCount[mask & 0xff] += 1;
    if (mask & LONG_EVENT_OUTCOME.DEATH) this.deathCount += 1;
    if (mask & LONG_EVENT_OUTCOME.ABORT) this.abortCount += 1;
    if (mask & LONG_EVENT_OUTCOME.RESCUE) this.rescueCount += 1;
    if (mask & LONG_EVENT_OUTCOME.OPEN) this.openCount += 1;
    if (mask & LONG_EVENT_OUTCOME.INCOMPLETE) this.incompleteCount += 1;
    if (mask & LONG_EVENT_OUTCOME.WIN) this.winCount += 1;
    if (mask & LONG_EVENT_OUTCOME.POLICY_LOSS) this.policyLossCount += 1;
    if (!(mask & (LONG_EVENT_OUTCOME.OPEN | LONG_EVENT_OUTCOME.INCOMPLETE)))
      this.completeEvaluationCount += 1;
    if (eventClosed(mask)) {
      this.eventClosedCount += 1;
      this.eventClosedByAction[this.lastAction] += 1;
      if (this.lastAction !== incumbentAction) this.wouldProposeCount += 1;
    }
    if (terminalClosed(mask)) this.terminalClosedCount += 1;
  }

  observe(engine, search, incumbentAction) {
    if (this.mode === "off") return null;
    this.checkCount += 1; this.lastOutcomeMask = 0;
    if (!this.pose.prepare(engine, engine.ourCount) || this.pose.selected < 0) {
      this.poseMissingCount += 1; return null;
    }
    if ((engine.escapeObligation?.committedEntityCount | 0) > 0 ||
        this.hasCommittedDanger(engine.adapter.state)) {
      this.committedBlockedCount += 1; return null;
    }
    const action = this.feedback.routeAction(engine.adapter.state);
    if (action === ACTION.NONE) { this.poseMissingCount += 1; return null; }
    if (action === ACTION.FIRE) { this.rootFireSkipCount += 1; return null; }
    const row = this.bestAttackRow(engine, this.pose, action);
    if (row < 0) { this.candidateRowMissingCount += 1; return null; }
    this.rootRouteCount += 1; this.lastAction = action;
    this.routeByAction[action] += 1;
    this.lastArgument = engine.ourArguments[row];
    this.lastTargetSignature = this.targetSignature(this.pose);
    const outcome = this.evaluateRoot(engine, search, action, this.lastArgument);
    this.recordOutcome(outcome, incumbentAction);
    return null;
  }

  summary() {
    return { enabled: this.mode !== "off", mode: this.mode,
      semantics: "EVENT_BOUNDED_LONG_OPTION_ENVELOPE",
      maximumFrames: this.maximumFrames, nodeBudget: this.nodeBudget,
      checkCount: this.checkCount, poseMissingCount: this.poseMissingCount,
      committedBlockedCount: this.committedBlockedCount,
      candidateRowMissingCount: this.candidateRowMissingCount,
      rootFireSkipCount: this.rootFireSkipCount, rootRouteCount: this.rootRouteCount,
      evaluationCount: this.evaluationCount,
      completeEvaluationCount: this.completeEvaluationCount,
      eventClosedCount: this.eventClosedCount,
      terminalClosedCount: this.terminalClosedCount,
      deathCount: this.deathCount,
      abortCount: this.abortCount, rescueCount: this.rescueCount,
      openCount: this.openCount, incompleteCount: this.incompleteCount,
      winCount: this.winCount, policyLossCount: this.policyLossCount,
      outcomeMaskCount: Array.from(this.outcomeMaskCount),
      routeByAction: Array.from(this.routeByAction),
      eventClosedByAction: Array.from(this.eventClosedByAction),
      nodeCount: this.nodeCount, maximumNodes: this.maximumNodes,
      transitionCount: this.transitionCount,
      maximumTransitions: this.maximumTransitions,
      mergeHitCount: this.mergeHitCount, ttStoreCount: this.ttStoreCount,
      ttCapacityFailureCount: this.ttCapacityFailureCount,
      budgetStopCount: this.budgetStopCount,
      fastIncompleteCount: this.fastIncompleteCount,
      hardIncompleteCount: this.hardIncompleteCount,
      rootRestoreFailureCount: this.rootRestoreFailureCount,
      wouldProposeCount: this.wouldProposeCount,
      lastAction: this.lastAction, lastArgument: this.lastArgument,
      lastOutcomeMask: this.lastOutcomeMask, lastNodes: this.lastNodes,
      lastTransitions: this.lastTransitions,
      lastTargetSignature: this.lastTargetSignature,
      hotAllocationCount: this.hotAllocationCount,
      pose: this.pose.summary ? this.pose.summary() : null,
      feedback: this.feedback.summary ? this.feedback.summary() : null };
  }
}

module.exports = { NativeLongOptionEventEnvelopePoc, LONG_EVENT_OUTCOME,
  eventClosed, terminalClosed };
