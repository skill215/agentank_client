"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { FAST_STATUS, HARD_STATUS, ACTION, TERMINAL, NONE_CELL } =
  require("../abi/fast-codes");

const ROOT_TRANSITION_DELTA_CAPACITY = 8192;
const ROOT_TRANSITION_KEY_STRIDE = 1024;
const ROOT_PRINCIPAL_CAPACITY = 256;
const ROOT_TRANSITION_FLAG = Object.freeze({ HARD_VALID: 1 });

// Root-only transition memo. It stores the final state writes produced by one
// joint action/chance outcome and replays them through FastState.write(), so a
// consumer receives a normal undoable successor state without rerunning the
// physics pipeline. Events are deliberately not replayed: search semantics
// depend on the physical arrays/hash, while later transitions own their own
// event segment. Any identity, capacity, or replay mismatch falls back to the
// ordinary FastKernel path.
class RootTransitionSlab {
  constructor() {
    const entries = SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES * SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES;
    this.entryGeneration = new Uint16Array(entries);
    this.entryFlags = new Uint8Array(entries);
    this.entryFastStatus = new Uint8Array(entries);
    this.entryHardStatus = new Uint8Array(entries);
    this.entryTerminal = new Uint8Array(entries);
    this.entryViable = new Int8Array(entries);
    this.entryDeltaStart = new Uint16Array(entries);
    this.entryDeltaCount = new Uint8Array(entries);
    this.entryHashLo = new Uint32Array(entries); this.entryHashHi = new Uint32Array(entries);
    this.entryOwnCell = new Uint16Array(entries); this.entryOwnDirection = new Uint8Array(entries);
    // One-frame principal continuation metadata.  It is attached to the exact
    // root successor entry, so the next callback can use it only when the
    // observed PhysicalState is byte-for-byte the predicted successor.
    this.principalEntry = new Uint16Array(ROOT_PRINCIPAL_CAPACITY);
    this.principalRecordGeneration = new Uint16Array(ROOT_PRINCIPAL_CAPACITY);
    this.principalDepth = new Uint8Array(ROOT_PRINCIPAL_CAPACITY);
    this.principalAction = new Uint8Array(ROOT_PRINCIPAL_CAPACITY);
    this.principalArgument = new Uint16Array(ROOT_PRINCIPAL_CAPACITY);
    this.principalEnemyAction = new Uint8Array(ROOT_PRINCIPAL_CAPACITY);
    this.principalEnemyArgument = new Uint16Array(ROOT_PRINCIPAL_CAPACITY);
    this.principalRisk = new Uint8Array(ROOT_PRINCIPAL_CAPACITY);
    this.principalWidth = new Uint8Array(ROOT_PRINCIPAL_CAPACITY);
    this.principalTopology = new Uint32Array(ROOT_PRINCIPAL_CAPACITY);
    this.principalNextEntity = new Uint32Array(ROOT_PRINCIPAL_CAPACITY);
    this.deltaKey = new Uint16Array(ROOT_TRANSITION_DELTA_CAPACITY);
    this.deltaValue = new Uint32Array(ROOT_TRANSITION_DELTA_CAPACITY);
    this.ourActions = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.ourArguments = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.enemyActions = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.enemyArguments = new Uint16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.generation = 1; this.rootHashLo = 0; this.rootHashHi = 0; this.rootMark = 0;
    this.ourCount = 0; this.enemyCount = 0; this.enemyNoneColumn = -1;
    this.deltaUsed = 0; this.prepared = 0; this.lastReplay = 0; this.lastHardReplay = 0;
    this.enabled = 1;
    this.prepareCount = 0; this.buildCount = 0; this.replayHitCount = 0;
    this.hardReplayHitCount = 0; this.hardFillCount = 0; this.deltaOverflowCount = 0;
    this.replayFailureCount = 0; this.rootMismatchCount = 0; this.deltaHighWater = 0;
    this.principalRow = -1; this.principalGeneration = 0;
    this.lastPVAction = ACTION.NONE; this.lastPVArgument = NONE_CELL;
    this.lastPVEnemyAction = ACTION.NONE; this.lastPVEnemyArgument = NONE_CELL;
    this.lastPVDepth = 0; this.principalLookupCount = 0; this.principalHitCount = 0;
    this.principalStoreCount = 0; this.principalCommitCount = 0;
    this.principalRecordCount = 0; this.principalOverflowCount = 0;
    this.hotAllocationCount = 0;
  }

  entryIndex(row, column, chance0, chance1) {
    return (row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column) *
      SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES + chance0 + (chance1 << 2);
  }
  currentRoot(state) {
    return this.enabled && this.prepared && state.hashLo === this.rootHashLo &&
      state.hashHi === this.rootHashHi &&
      state.deltaUsed * 1024 + state.eventUsed === this.rootMark ? 1 : 0;
  }
  setEnabled(enabled) { this.enabled = enabled ? 1 : 0; return this.enabled; }
  resetPrincipal() {
    this.principalRow = -1; this.principalGeneration = 0;
    this.lastPVAction = ACTION.NONE; this.lastPVArgument = NONE_CELL;
    this.lastPVEnemyAction = ACTION.NONE; this.lastPVEnemyArgument = NONE_CELL;
    this.lastPVDepth = 0;
  }
  programMatches(ourActions, ourArguments, ourCount,
      enemyActions, enemyArguments, enemyCount) {
    if (!this.prepared || ourCount < 1 || ourCount > this.ourCount ||
        enemyCount !== this.enemyCount) return 0;
    for (let row = 0; row < ourCount; row += 1)
      if (this.ourActions[row] !== ourActions[row] ||
          this.ourArguments[row] !== (ourArguments ? ourArguments[row] : NONE_CELL)) return 0;
    for (let column = 0; column < enemyCount; column += 1)
      if (this.enemyActions[column] !== enemyActions[column] ||
          this.enemyArguments[column] !== (enemyArguments ? enemyArguments[column] : NONE_CELL)) return 0;
    return 1;
  }
  matches(bundle, ourActions, ourArguments, ourCount,
      enemyActions, enemyArguments, enemyCount) {
    return bundle && bundle.state && this.currentRoot(bundle.state) &&
      this.programMatches(ourActions, ourArguments, ourCount,
        enemyActions, enemyArguments, enemyCount) ? 1 : 0;
  }
  prepare(bundle, ourActions, ourArguments, ourCount,
      enemyActions, enemyArguments, enemyCount) {
    if (!bundle || !bundle.state || !ourActions || !enemyActions || ourCount < 1 || enemyCount < 1 ||
        ourCount > SEARCH_CAPACITY.MAX_OUR_ACTIONS ||
        enemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES) return 0;
    if (this.matches(bundle, ourActions, ourArguments, ourCount,
        enemyActions, enemyArguments, enemyCount)) return 1;
    const state = bundle.state;
    this.generation = (this.generation + 1) & 0xffff;
    if (!this.generation) { this.entryGeneration.fill(0); this.generation = 1; }
    this.rootHashLo = state.hashLo; this.rootHashHi = state.hashHi;
    this.rootMark = state.deltaUsed * 1024 + state.eventUsed;
    this.ourCount = ourCount; this.enemyCount = enemyCount; this.enemyNoneColumn = -1;
    for (let row = 0; row < ourCount; row += 1) {
      this.ourActions[row] = ourActions[row];
      this.ourArguments[row] = ourArguments ? ourArguments[row] : NONE_CELL;
    }
    for (let column = 0; column < enemyCount; column += 1) {
      this.enemyActions[column] = enemyActions[column];
      this.enemyArguments[column] = enemyArguments ? enemyArguments[column] : NONE_CELL;
      if (this.enemyNoneColumn < 0 && this.enemyActions[column] === ACTION.NONE &&
          this.enemyArguments[column] === NONE_CELL) this.enemyNoneColumn = column;
    }
    this.deltaUsed = 0; this.prepared = 1; this.prepareCount += 1;
    this.principalRecordCount = 0;
    return 1;
  }

  storeEntry(bundle, entry, status, hardValid) {
    const state = bundle.state; const mark = bundle.kernel.lastMark;
    const deltaMark = (mark / 1024) | 0; const count = state.deltaUsed - deltaMark;
    if (count < 0 || count > 0xff || this.deltaUsed + count > this.deltaKey.length) {
      this.deltaOverflowCount += 1; return 0;
    }
    const start = this.deltaUsed;
    for (let cursor = deltaMark; cursor < state.deltaUsed; cursor += 1) {
      const id = state.deltaArray[cursor]; const index = state.deltaIndex[cursor];
      this.deltaKey[this.deltaUsed] = id * ROOT_TRANSITION_KEY_STRIDE + index;
      this.deltaValue[this.deltaUsed] = state.arrays[id][index]; this.deltaUsed += 1;
    }
    this.entryGeneration[entry] = this.generation;
    this.entryFlags[entry] = hardValid ? ROOT_TRANSITION_FLAG.HARD_VALID : 0;
    this.entryFastStatus[entry] = status; this.entryDeltaStart[entry] = start;
    this.entryDeltaCount[entry] = count; this.entryHashLo[entry] = state.hashLo;
    this.entryHashHi[entry] = state.hashHi;
    this.entryTerminal[entry] = state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    if (hardValid) this.storeHard(bundle, entry);
    if (this.deltaUsed > this.deltaHighWater) this.deltaHighWater = this.deltaUsed;
    return 1;
  }
  storeFailure(entry, status) {
    this.entryGeneration[entry] = this.generation; this.entryFlags[entry] = 0;
    this.entryFastStatus[entry] = status; this.entryHardStatus[entry] = HARD_STATUS.INCOMPLETE;
    this.entryTerminal[entry] = TERMINAL.INCOMPLETE; this.entryDeltaStart[entry] = this.deltaUsed;
    this.entryDeltaCount[entry] = 0; this.entryOwnCell[entry] = NONE_CELL;
    this.entryOwnDirection[entry] = 0xff;
  }
  storeHard(bundle, entry) {
    const hard = bundle.hard;
    this.entryFlags[entry] |= ROOT_TRANSITION_FLAG.HARD_VALID;
    this.entryHardStatus[entry] = hard.lastStatus;
    this.entryTerminal[entry] = hard.lastTerminal;
    this.entryViable[entry] = hard.lastViable;
    this.entryOwnCell[entry] = bundle.state.arrays[ARRAY.TANK_CELL][hard.perspectiveSeat];
    this.entryOwnDirection[entry] = bundle.state.arrays[ARRAY.TANK_DIR][hard.perspectiveSeat];
    hard.lastAppliedOwnCell = this.entryOwnCell[entry];
    hard.lastAppliedOwnDirection = this.entryOwnDirection[entry];
  }
  publishHard(bundle, entry) {
    const hard = bundle.hard;
    hard.lastFastStatus = this.entryFastStatus[entry];
    hard.lastStatus = this.entryHardStatus[entry]; hard.lastTerminal = this.entryTerminal[entry];
    hard.lastViable = this.entryViable[entry]; hard.lastAppliedOwnCell = this.entryOwnCell[entry];
    hard.lastAppliedOwnDirection = this.entryOwnDirection[entry];
  }
  storePrincipal(entry, state, depth, action, argument, enemyAction, enemyArgument,
      baseRisk, width) {
    if (entry < 0 || entry >= this.entryGeneration.length || !state || depth < 1 ||
        this.entryGeneration[entry] !== this.generation) return 0;
    const scalar = state.arrays[ARRAY.SCALAR];
    let slot = 0;
    while (slot < this.principalRecordCount &&
        (this.principalRecordGeneration[slot] !== this.generation ||
        this.principalEntry[slot] !== entry || this.principalWidth[slot] !== width)) slot += 1;
    if (slot >= this.principalRecordCount) {
      if (this.principalRecordCount >= this.principalEntry.length) {
        this.principalOverflowCount += 1; return 0;
      }
      slot = this.principalRecordCount; this.principalRecordCount += 1;
    }
    this.principalRecordGeneration[slot] = this.generation;
    this.principalEntry[slot] = entry; this.principalDepth[slot] = depth;
    this.principalAction[slot] = action; this.principalArgument[slot] = argument;
    this.principalEnemyAction[slot] = enemyAction;
    this.principalEnemyArgument[slot] = enemyArgument;
    this.principalRisk[slot] = baseRisk; this.principalWidth[slot] = width;
    this.principalTopology[slot] = scalar[SCALAR.TOPOLOGY_VERSION];
    this.principalNextEntity[slot] = scalar[SCALAR.NEXT_ENTITY];
    this.principalStoreCount += 1; return 1;
  }
  hasPrincipalEntry(entry) {
    for (let slot = 0; slot < this.principalRecordCount; slot += 1)
      if (this.principalRecordGeneration[slot] === this.generation &&
          this.principalEntry[slot] === entry) return 1;
    return 0;
  }
  hasPrincipalRow(row) {
    if (row < 0 || row >= this.ourCount) return 0;
    for (let slot = 0; slot < this.principalRecordCount; slot += 1) {
      if (this.principalRecordGeneration[slot] !== this.generation) continue;
      const joint = (this.principalEntry[slot] /
        SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES) | 0;
      if (((joint / SEARCH_CAPACITY.MAX_ENEMY_POLICIES) | 0) === row) return 1;
    }
    return 0;
  }
  commitPrincipalAction(action, argument = NONE_CELL) {
    this.principalRow = -1; this.principalGeneration = 0;
    for (let row = 0; row < this.ourCount; row += 1)
      if (this.ourActions[row] === action && this.ourArguments[row] === argument) {
        this.principalRow = row; this.principalGeneration = this.generation;
        this.principalCommitCount += 1; return 1;
      }
    return 0;
  }
  lookupPrincipal(state, baseRisk, width) {
    this.principalLookupCount += 1; this.lastPVDepth = 0;
    this.lastPVAction = ACTION.NONE; this.lastPVArgument = NONE_CELL;
    this.lastPVEnemyAction = ACTION.NONE; this.lastPVEnemyArgument = NONE_CELL;
    if (!state || this.principalRow < 0 || this.principalRow >= this.ourCount ||
        this.principalGeneration !== this.generation) return 0;
    const scalar = state.arrays[ARRAY.SCALAR]; let bestSlot = -1; let bestDepth = 0;
    for (let slot = 0; slot < this.principalRecordCount; slot += 1) {
      const entry = this.principalEntry[slot];
      const joint = (entry / SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES) | 0;
      const row = (joint / SEARCH_CAPACITY.MAX_ENEMY_POLICIES) | 0;
      if (row !== this.principalRow ||
          this.principalRecordGeneration[slot] !== this.generation ||
          this.entryGeneration[entry] !== this.generation ||
          this.principalRisk[slot] !== baseRisk || this.principalWidth[slot] !== width ||
          this.entryHashLo[entry] !== state.hashLo || this.entryHashHi[entry] !== state.hashHi ||
          this.principalTopology[slot] !== scalar[SCALAR.TOPOLOGY_VERSION] ||
          this.principalNextEntity[slot] !== scalar[SCALAR.NEXT_ENTITY]) continue;
      if (this.principalDepth[slot] > bestDepth) {
        bestDepth = this.principalDepth[slot]; bestSlot = slot;
      }
    }
    if (bestSlot < 0) return 0;
    this.lastPVAction = this.principalAction[bestSlot];
    this.lastPVArgument = this.principalArgument[bestSlot];
    this.lastPVEnemyAction = this.principalEnemyAction[bestSlot];
    this.lastPVEnemyArgument = this.principalEnemyArgument[bestSlot];
    this.lastPVDepth = this.principalDepth[bestSlot]; this.principalHitCount += 1; return 1;
  }
  replay(bundle, entry) {
    const state = bundle.state; const mark = state.beginTransition(); bundle.kernel.lastMark = mark;
    const start = this.entryDeltaStart[entry]; const end = start + this.entryDeltaCount[entry];
    for (let cursor = start; cursor < end; cursor += 1) {
      const key = this.deltaKey[cursor]; const id = (key / ROOT_TRANSITION_KEY_STRIDE) | 0;
      const index = key - id * ROOT_TRANSITION_KEY_STRIDE;
      if (!state.write(id, index, this.deltaValue[cursor])) {
        state.undoTo(mark); this.replayFailureCount += 1; return 0;
      }
    }
    if (state.hashLo !== this.entryHashLo[entry] || state.hashHi !== this.entryHashHi[entry]) {
      state.undoTo(mark); this.replayFailureCount += 1; return 0;
    }
    return 1;
  }
  build(bundle, entry, row, column, chance0, chance1, requireHard) {
    const status = bundle.kernel.applyFrame(this.ourActions[row], this.ourArguments[row],
      this.enemyActions[column], this.enemyArguments[column], chance0, chance1);
    this.buildCount += 1; this.lastReplay = 0; this.lastHardReplay = 0;
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
      this.storeFailure(entry, status); bundle.hard.lastFastStatus = status;
      bundle.hard.lastStatus = HARD_STATUS.INCOMPLETE;
      bundle.hard.lastTerminal = TERMINAL.INCOMPLETE; return status;
    }
    if (requireHard) {
      bundle.hard.lastStatus = bundle.hard.classifyApplied();
      this.hardFillCount += 1;
    }
    this.storeEntry(bundle, entry, status, requireHard);
    return status;
  }
  apply(bundle, row, column, chance0, chance1, requireHard = 1) {
    this.lastReplay = 0; this.lastHardReplay = 0;
    if (!bundle || !bundle.state || !bundle.kernel || !bundle.hard ||
        !this.currentRoot(bundle.state) || row < 0 || row >= this.ourCount ||
        column < 0 || column >= this.enemyCount || chance0 < 0 || chance0 > 3 ||
        chance1 < 0 || chance1 > 3) return 0;
    const entry = this.entryIndex(row, column, chance0, chance1);
    if (this.entryGeneration[entry] !== this.generation)
      return this.build(bundle, entry, row, column, chance0, chance1, requireHard);
    const status = this.entryFastStatus[entry]; this.lastReplay = 1; this.replayHitCount += 1;
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
      bundle.hard.lastFastStatus = status; bundle.hard.lastStatus = HARD_STATUS.INCOMPLETE;
      bundle.hard.lastTerminal = TERMINAL.INCOMPLETE; return status;
    }
    if (!this.replay(bundle, entry)) {
      this.entryGeneration[entry] = 0;
      return this.build(bundle, entry, row, column, chance0, chance1, requireHard);
    }
    bundle.hard.lastFastStatus = status;
    if (requireHard) {
      if (this.entryFlags[entry] & ROOT_TRANSITION_FLAG.HARD_VALID) {
        this.publishHard(bundle, entry); this.lastHardReplay = 1;
        this.hardReplayHitCount += 1;
      } else {
        bundle.hard.lastStatus = bundle.hard.classifyApplied();
        this.storeHard(bundle, entry); this.hardFillCount += 1;
      }
    }
    return status;
  }

  evaluateAllOwnChance(bundle, row, chanceCells = null, chanceDirections = null,
      chanceOffset = 0) {
    if (this.enemyNoneColumn < 0 || row < 0 || row >= this.ourCount) return -1;
    const count = bundle.hard.chanceAlternativeCount(0, this.ourActions[row]);
    let anyAllow = 0; let allProven = 1; let allRejected = 1;
    let fatalSupport = 0; let incompleteSupport = 0;
    for (let variant = 0; variant < count; variant += 1) {
      const status = this.apply(bundle, row, this.enemyNoneColumn, variant, 0, 1);
      let hard = HARD_STATUS.INCOMPLETE;
      if (status === FAST_STATUS.APPLIED || status === FAST_STATUS.APPLIED_TERMINAL) {
        hard = bundle.hard.lastStatus;
        if (chanceCells && chanceDirections) {
          chanceCells[chanceOffset + variant] = bundle.hard.lastAppliedOwnCell;
          chanceDirections[chanceOffset + variant] = bundle.hard.lastAppliedOwnDirection;
        }
        bundle.state.undoTo(bundle.kernel.lastMark);
      }
      if (hard === HARD_STATUS.ALLOW) anyAllow = 1;
      if (hard === HARD_STATUS.REJECT_PROVEN || hard === HARD_STATUS.REJECT_POLICY)
        fatalSupport += 1;
      if (hard === HARD_STATUS.INCOMPLETE) incompleteSupport += 1;
      if (hard !== HARD_STATUS.REJECT_PROVEN) allProven = 0;
      if (hard !== HARD_STATUS.REJECT_PROVEN && hard !== HARD_STATUS.REJECT_POLICY) allRejected = 0;
    }
    bundle.hard.lastChanceSupportCount = count;
    bundle.hard.lastChanceFatalSupportCount = fatalSupport;
    bundle.hard.lastChanceIncompleteSupportCount = incompleteSupport;
    if (!this.currentRoot(bundle.state)) this.rootMismatchCount += 1;
    if (allProven) return HARD_STATUS.REJECT_PROVEN;
    if (anyAllow) return HARD_STATUS.ALLOW;
    return allRejected ? HARD_STATUS.REJECT_POLICY : HARD_STATUS.INCOMPLETE;
  }
  bytes() {
    return this.entryGeneration.byteLength + this.entryFlags.byteLength +
      this.entryFastStatus.byteLength + this.entryHardStatus.byteLength +
      this.entryTerminal.byteLength + this.entryViable.byteLength +
      this.entryDeltaStart.byteLength + this.entryDeltaCount.byteLength +
      this.entryHashLo.byteLength + this.entryHashHi.byteLength +
      this.entryOwnCell.byteLength + this.entryOwnDirection.byteLength +
      this.deltaKey.byteLength + this.deltaValue.byteLength + this.ourActions.byteLength +
      this.ourArguments.byteLength + this.enemyActions.byteLength + this.enemyArguments.byteLength;
  }
}

module.exports = { ROOT_TRANSITION_DELTA_CAPACITY, ROOT_TRANSITION_FLAG, RootTransitionSlab };
