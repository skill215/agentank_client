"use strict";

const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ACTION, FAST_STATUS, HARD_STATUS, TERMINAL, TERRAIN, NONE_FRAME, NONE_CELL } =
  require("../../engine-v2/src/abi/fast-codes");
const { CACHE_MISS } = require("../../engine-v2/src/abi/cache-runtime-codes");

const OPTION_CERTIFICATE_STATUS = Object.freeze({ NONE: 0, COMPLETE: 1, INCOMPLETE: 2 });
const OPTION_CERTIFICATE_REASON = Object.freeze({ NONE: 0, ROOT_SUPPORT: 1,
  TRANSITION_SUPPORT: 2, HIDDEN_SUCCESSOR: 3, HARD_REJECT: 4,
  PRINCIPAL_MISSING: 5, OBSERVATION_CONFLICT: 6, CAPACITY: 7, ROOT_RESTORE: 8 });
const MAX_CERTIFICATE_BRANCHES = SEARCH_CAPACITY.MAX_ENEMY_POLICIES *
  SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES;

function mix32(hash, value) {
  let result = (hash ^ (value >>> 0)) >>> 0;
  result = (result + ((result << 1) >>> 0) + ((result << 4) >>> 0) +
    ((result << 7) >>> 0) + ((result << 8) >>> 0) + ((result << 24) >>> 0)) >>> 0;
  return result;
}

// A diagnostic, executable-policy certificate for one exact Physical P2 root.
// It is intentionally narrower than a game-theoretic Proof: COMPLETE means
// every supported first-frame enemy/chance successor is observable and has one
// common second action. It does not claim that a heuristic horizon leaf is a
// terminal win/nonloss certificate and it never writes Hard, Safety, or Proof.
class OptionPolicyCertificate {
  constructor() {
    this.successorHashLo = new Uint32Array(MAX_CERTIFICATE_BRANCHES);
    this.successorHashHi = new Uint32Array(MAX_CERTIFICATE_BRANCHES);
    this.action = new Uint8Array(MAX_CERTIFICATE_BRANCHES);
    this.argument = new Uint16Array(MAX_CERTIFICATE_BRANCHES);
    this.terminal = new Uint8Array(MAX_CERTIFICATE_BRANCHES);
    this.status = OPTION_CERTIFICATE_STATUS.NONE;
    this.reason = OPTION_CERTIFICATE_REASON.NONE;
    this.rootAction = ACTION.NONE; this.rootArgument = NONE_CELL;
    this.buildFrame = -1;
    this.branchCount = 0; this.supportCount = 0; this.terminalCount = 0;
    this.attemptCount = 0; this.completeCount = 0; this.incompleteCount = 0;
    this.hiddenSuccessorCount = 0; this.conflictCount = 0;
    this.rootRestoreFailures = 0; this.hotAllocationCount = 0;
  }

  reset() {
    this.status = OPTION_CERTIFICATE_STATUS.NONE;
    this.reason = OPTION_CERTIFICATE_REASON.NONE;
    this.rootAction = ACTION.NONE; this.rootArgument = NONE_CELL;
    this.buildFrame = -1;
    this.branchCount = 0; this.supportCount = 0; this.terminalCount = 0;
  }

  fail(reason) {
    this.status = OPTION_CERTIFICATE_STATUS.INCOMPLETE;
    this.reason = reason; this.incompleteCount += 1;
    return this.status;
  }

  activeEffect(arrays, id, seat, frame) {
    return arrays[id][seat] !== NONE_FRAME && arrays[id][seat] > frame;
  }

  observableSuccessor(state) {
    const arrays = state.arrays; const frame = arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const enemyCell = arrays[ARRAY.TANK_CELL][1];
    if (enemyCell === NONE_CELL) return 0;
    const revealed = this.activeEffect(arrays, ARRAY.TANK_REVEAL_UNTIL, 1, frame);
    const cloaked = this.activeEffect(arrays, ARRAY.TANK_CLOAK_UNTIL, 1, frame);
    return revealed || (!cloaked && arrays[ARRAY.TERRAIN][enemyCell] !== TERRAIN.GRASS) ? 1 : 0;
  }

  // Deliberately excludes internal entity ids, generation counters, cache
  // identity, and the platform's partial projectile set. Omitting observable
  // detail only coalesces more worlds; addSuccessor then requires one common
  // action and fails closed on a conflict.
  observationKey(state, seed) {
    const arrays = state.arrays; const scalar = arrays[ARRAY.SCALAR];
    const frame = scalar[SCALAR.FRAME]; let hash = seed >>> 0;
    hash = mix32(hash, frame); hash = mix32(hash, scalar[SCALAR.STAR_CELL]);
    hash = mix32(hash, arrays[ARRAY.TANK_CELL][0]);
    hash = mix32(hash, arrays[ARRAY.TANK_DIR][0]);
    hash = mix32(hash, arrays[ARRAY.TANK_CRASH][0]);
    hash = mix32(hash, arrays[ARRAY.TANK_STARS][0]);
    hash = mix32(hash, scalar[SCALAR.TERMINAL_CODE]);
    for (let id = ARRAY.TANK_SHIELD_HITS; id <= ARRAY.TANK_FIRE_LOCK; id += 1)
      hash = mix32(hash, (id << 16) ^ arrays[id][0]);
    const enemy = arrays[ARRAY.TANK_CELL][1];
    const revealed = this.activeEffect(arrays, ARRAY.TANK_REVEAL_UNTIL, 1, frame);
    const cloaked = this.activeEffect(arrays, ARRAY.TANK_CLOAK_UNTIL, 1, frame);
    const visible = revealed || (!cloaked && arrays[ARRAY.TERRAIN][enemy] !== TERRAIN.GRASS);
    hash = mix32(hash, visible ? 0x51ed : 0x91dd);
    if (visible) {
      hash = mix32(hash, enemy); hash = mix32(hash, arrays[ARRAY.TANK_DIR][1]);
      hash = mix32(hash, arrays[ARRAY.TANK_CRASH][1]);
      hash = mix32(hash, arrays[ARRAY.TANK_STARS][1]);
      for (let id = ARRAY.TANK_SKILL; id <= ARRAY.TANK_FIRE_LOCK; id += 1)
        hash = mix32(hash, (id << 16) ^ arrays[id][1]);
    }
    return hash >>> 0;
  }

  principalFor(transitions, entry, risk, width) {
    let best = -1; let depth = 0;
    for (let slot = 0; slot < transitions.principalRecordCount; slot += 1) {
      if (transitions.principalRecordGeneration[slot] !== transitions.generation ||
          transitions.principalEntry[slot] !== entry ||
          transitions.principalRisk[slot] !== risk ||
          transitions.principalWidth[slot] !== width ||
          transitions.principalDepth[slot] < 1) continue;
      if (transitions.principalDepth[slot] > depth) {
        best = slot; depth = transitions.principalDepth[slot];
      }
    }
    return best;
  }

  addSuccessor(hashLo, hashHi, action, argument, terminal) {
    for (let index = 0; index < this.branchCount; index += 1) {
      if (this.successorHashLo[index] !== hashLo || this.successorHashHi[index] !== hashHi)
        continue;
      if (this.terminal[index] !== terminal || !terminal &&
          (this.action[index] !== action || this.argument[index] !== argument)) {
        this.conflictCount += 1; return -1;
      }
      return index;
    }
    if (this.branchCount >= MAX_CERTIFICATE_BRANCHES) return -2;
    const index = this.branchCount++;
    this.successorHashLo[index] = hashLo; this.successorHashHi[index] = hashHi;
    this.action[index] = action; this.argument[index] = argument;
    this.terminal[index] = terminal; return index;
  }

  build(bundle, search, row, engine) {
    this.reset(); this.attemptCount += 1;
    const transitions = search && search.rootTransitions;
    if (!bundle || !bundle.state || !transitions || !transitions.enabled ||
        !transitions.prepared || search.representativeSupportComplete !== 1 ||
        search.representativeSupportDepth < 2 || row < 0 ||
        row >= search.rootActionCount || !engine.adapter.informationComplete)
      return this.fail(OPTION_CERTIFICATE_REASON.ROOT_SUPPORT);
    const state = bundle.state; const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    this.rootAction = engine.ourActions[row]; this.rootArgument = engine.ourArguments[row];
    this.buildFrame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const risk = search.baseRisk; const width = search.representativeSupportExpansionLimit;
    for (let column = 0; column < search.rootEnemyCount; column += 1) {
      const ownChance = bundle.hard.chanceAlternativeCount(0, this.rootAction);
      const enemyAction = search.rootEnemyActions[column];
      const enemyChance = bundle.hard.chanceAlternativeCount(1, enemyAction);
      for (let chance = 0; chance < ownChance * enemyChance; chance += 1) {
        this.supportCount += 1;
        const chance0 = chance % ownChance; const chance1 = Math.floor(chance / ownChance);
        const entry = transitions.entryIndex(row, column, chance0, chance1);
        if (transitions.entryGeneration[entry] !== transitions.generation ||
            !(transitions.entryFlags[entry] & 1))
          return this.fail(OPTION_CERTIFICATE_REASON.TRANSITION_SUPPORT);
        const fast = transitions.apply(bundle, row, column, chance0, chance1, 1);
        if (fast !== FAST_STATUS.APPLIED && fast !== FAST_STATUS.APPLIED_TERMINAL)
          return this.fail(OPTION_CERTIFICATE_REASON.TRANSITION_SUPPORT);
        const mark = bundle.kernel.lastMark; const hard = bundle.hard.lastStatus;
        const terminal = bundle.hard.lastTerminal;
        if (hard === HARD_STATUS.REJECT_PROVEN || hard === HARD_STATUS.REJECT_POLICY ||
            terminal === TERMINAL.WIN1) {
          state.undoTo(mark); return this.fail(OPTION_CERTIFICATE_REASON.HARD_REJECT);
        }
        let principal = CACHE_MISS; let action = ACTION.NONE; let argument = NONE_CELL;
        const ends = terminal === TERMINAL.WIN0 || terminal === TERMINAL.DRAW;
        if (ends) this.terminalCount += 1;
        else {
          if (!this.observableSuccessor(state)) {
            this.hiddenSuccessorCount += 1; state.undoTo(mark);
            return this.fail(OPTION_CERTIFICATE_REASON.HIDDEN_SUCCESSOR);
          }
          principal = this.principalFor(transitions, entry, risk, width);
          if (principal === CACHE_MISS) {
            state.undoTo(mark); return this.fail(OPTION_CERTIFICATE_REASON.PRINCIPAL_MISSING);
          }
          action = transitions.principalAction[principal];
          argument = transitions.principalArgument[principal];
        }
        const keyLo = this.observationKey(state, 0x811c9dc5);
        const keyHi = this.observationKey(state, 0x9e3779b9);
        const added = this.addSuccessor(keyLo, keyHi, action, argument, ends ? 1 : 0);
        state.undoTo(mark);
        if (added === -1) return this.fail(OPTION_CERTIFICATE_REASON.OBSERVATION_CONFLICT);
        if (added === -2) return this.fail(OPTION_CERTIFICATE_REASON.CAPACITY);
      }
    }
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== rootMark) {
      this.rootRestoreFailures += 1; state.undoTo(rootMark);
      return this.fail(OPTION_CERTIFICATE_REASON.ROOT_RESTORE);
    }
    this.status = OPTION_CERTIFICATE_STATUS.COMPLETE;
    this.completeCount += 1; return this.status;
  }

  lookup(state) {
    if (this.status !== OPTION_CERTIFICATE_STATUS.COMPLETE || !state) return -1;
    return this.lookupKey(this.observationKey(state, 0x811c9dc5),
      this.observationKey(state, 0x9e3779b9));
  }

  lookupKey(keyLo, keyHi) {
    for (let index = 0; index < this.branchCount; index += 1)
      if (this.successorHashLo[index] === keyLo &&
          this.successorHashHi[index] === keyHi) return index;
    return -1;
  }

  copyPolicy(source) {
    this.reset();
    if (!source || source.status !== OPTION_CERTIFICATE_STATUS.COMPLETE) return 0;
    this.status = source.status; this.reason = source.reason;
    this.rootAction = source.rootAction; this.rootArgument = source.rootArgument;
    this.buildFrame = source.buildFrame; this.branchCount = source.branchCount;
    this.supportCount = source.supportCount; this.terminalCount = source.terminalCount;
    for (let index = 0; index < source.branchCount; index += 1) {
      this.successorHashLo[index] = source.successorHashLo[index];
      this.successorHashHi[index] = source.successorHashHi[index];
      this.action[index] = source.action[index]; this.argument[index] = source.argument[index];
      this.terminal[index] = source.terminal[index];
    }
    return 1;
  }

  summary() {
    return { enabled: true, status: this.status, reason: this.reason,
      rootAction: this.rootAction, rootArgument: this.rootArgument,
      buildFrame: this.buildFrame,
      branchCount: this.branchCount, supportCount: this.supportCount,
      terminalCount: this.terminalCount, attemptCount: this.attemptCount,
      completeCount: this.completeCount, incompleteCount: this.incompleteCount,
      hiddenSuccessorCount: this.hiddenSuccessorCount, conflictCount: this.conflictCount,
      rootRestoreFailures: this.rootRestoreFailures,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { OPTION_CERTIFICATE_STATUS, OPTION_CERTIFICATE_REASON,
  MAX_CERTIFICATE_BRANCHES, OptionPolicyCertificate };
