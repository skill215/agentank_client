"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, SKILL, NONE_FRAME, NONE_CELL } = require("../abi/fast-codes");
const { OPTION_KIND } = require("../policy/option-portfolio");
const { DEEP_WIDTH, ProductionDepthSearch } = require("./production-depth-search");

const OPTION_SEARCH_CAPACITY = SEARCH_CAPACITY.MAX_OUR_ACTIONS * 2;
const OPTION_SEARCH_STATUS = Object.freeze({ NONE: 0, COMPLETE: 1, INCOMPLETE: 2 });
const OPTION_PRIORITY = Object.freeze([
  OPTION_KIND.COMMITTED_RESCUE,
  OPTION_KIND.DIRECT_KILL,
  OPTION_KIND.ATTACK_SETUP,
  OPTION_KIND.STAR_CONTROL,
  OPTION_KIND.TERMINAL,
  OPTION_KIND.RESOURCE,
  OPTION_KIND.POSITION
]);

function optionSearchTacticalKind(kind) {
  return kind === OPTION_KIND.DIRECT_KILL || kind === OPTION_KIND.ATTACK_SETUP ? 1 : 0;
}

function optionSearchOwnableKind(kind) {
  // DIRECT_KILL is terminal evidence. ATTACK_SETUP is only a posture until a
  // separate multi-frame closure proves hit deadline, response reduction and
  // own escape. A scalar or one-frame interval must never give setup ownership.
  return kind === OPTION_KIND.DIRECT_KILL ? 1 : 0;
}

function mix(hash, value) {
  let result = (hash ^ (value >>> 0)) >>> 0;
  result = (result + ((result << 1) >>> 0) + ((result << 4) >>> 0) +
    ((result << 7) >>> 0) + ((result << 8) >>> 0) + ((result << 24) >>> 0)) >>> 0;
  return result;
}

// Diagnostic search over option identities rather than bare primitive actions.
// The physical root transition is still the primitive action.  Only our later
// representatives and leaf utility are conditioned on the root option.
class OptionAwareDepthSearch extends ProductionDepthSearch {
  constructor(cacheBank, runtimeConfig, rootTransitions = null, options = null) {
    super(cacheBank, runtimeConfig, rootTransitions, options);
    // ProductionDepthSearch sizes root rows for primitive actions. This
    // diagnostic subclass needs a few more rows for semantic aliases while
    // retaining the same enemy-column stride and the same frame stack.
    this.iterationScore = new Int32Array(OPTION_SEARCH_CAPACITY);
    this.rootScore = new Int32Array(OPTION_SEARCH_CAPACITY);
    this.rootRowOrder = new Uint8Array(OPTION_SEARCH_CAPACITY);
    this.iterationCellScore = new Int32Array(OPTION_SEARCH_CAPACITY *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.rootCellScore = new Int32Array(OPTION_SEARCH_CAPACITY *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.iterationCellComplete = new Uint8Array(OPTION_SEARCH_CAPACITY *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.attemptCellLower = new Int32Array(OPTION_SEARCH_CAPACITY *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.attemptCellUpper = new Int32Array(OPTION_SEARCH_CAPACITY *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.attemptRowLower = new Int32Array(OPTION_SEARCH_CAPACITY);
    this.attemptRowUpper = new Int32Array(OPTION_SEARCH_CAPACITY);
    this.rootDomainMask = new Uint8Array(OPTION_SEARCH_CAPACITY);
    this.optionActions = new Uint8Array(OPTION_SEARCH_CAPACITY);
    this.optionArguments = new Uint16Array(OPTION_SEARCH_CAPACITY);
    this.optionPrimitiveRow = new Uint8Array(OPTION_SEARCH_CAPACITY);
    this.optionKind = new Uint8Array(OPTION_SEARCH_CAPACITY);
    this.optionTargetCell = new Uint16Array(OPTION_SEARCH_CAPACITY);
    this.optionDeadline = new Uint16Array(OPTION_SEARCH_CAPACITY);
    this.optionSourceIndex = new Uint8Array(OPTION_SEARCH_CAPACITY);
    this.optionCount = 0; this.optionTruncated = 0; this.preferredPrimitiveRow = 255;
    this.lastStatus = OPTION_SEARCH_STATUS.NONE; this.lastBestOption = 255;
    this.lastBestPrimitiveRow = 255; this.lastBestKind = OPTION_KIND.NONE;
    this.searchCount = 0; this.completeCount = 0; this.incompleteCount = 0;
    this.proposalCount = 0; this.differentPrimitiveCount = 0;
    this.totalNodes = 0; this.maximumNodes = 0; this.hotAllocationCount = 0;
  }

  resetOptionRoot() {
    this.optionCount = 0; this.optionTruncated = 0;
    this.lastStatus = OPTION_SEARCH_STATUS.NONE; this.lastBestOption = 255;
    this.lastBestPrimitiveRow = 255; this.lastBestKind = OPTION_KIND.NONE;
    this.informationOptionIndex = -1;
  }

  bindInformationOption(index) {
    this.informationOptionIndex = index >= 0 && index < this.optionCount ? index : -1;
  }

  hasSource(sourceIndex) {
    for (let index = 0; index < this.optionCount; index += 1)
      if (this.optionSourceIndex[index] === sourceIndex) return 1;
    return 0;
  }

  appendSource(portfolio, sourceIndex, ourActions, ourArguments, ourCount) {
    if (sourceIndex < 0 || sourceIndex >= portfolio.count || this.hasSource(sourceIndex)) return 0;
    const primitive = portfolio.primitiveRow[sourceIndex];
    if (primitive >= ourCount) return 0;
    if (this.optionCount >= OPTION_SEARCH_CAPACITY) {
      return 0;
    }
    const at = this.optionCount++;
    this.optionActions[at] = ourActions[primitive];
    this.optionArguments[at] = ourArguments[primitive];
    this.optionPrimitiveRow[at] = primitive;
    this.optionKind[at] = portfolio.kind[sourceIndex];
    this.optionTargetCell[at] = portfolio.targetCell[sourceIndex];
    this.optionDeadline[at] = portfolio.deadline[sourceIndex];
    this.optionSourceIndex[at] = sourceIndex;
    return 1;
  }

  preparePortfolio(portfolio, ourActions, ourArguments, ourCount, preferredPrimitiveRow = -1) {
    this.resetOptionRoot();
    this.preferredPrimitiveRow = preferredPrimitiveRow >= 0 && preferredPrimitiveRow < ourCount ?
      preferredPrimitiveRow : 255;
    // The current owner must be represented, otherwise a diagnostic proposal
    // could not be compared against what the production controller selected.
    if (this.preferredPrimitiveRow !== 255)
      for (const kind of OPTION_PRIORITY)
        for (let source = 0; source < portfolio.count; source += 1)
          if (portfolio.primitiveRow[source] === this.preferredPrimitiveRow &&
              portfolio.kind[source] === kind)
            this.appendSource(portfolio, source, ourActions, ourArguments, ourCount);
    // Then preserve option semantics globally. Generic POSITION is last, so a
    // capacity boundary drops weak aliases before rescue/attack/star identity.
    for (const kind of OPTION_PRIORITY)
      for (let source = 0; source < portfolio.count; source += 1)
        if (portfolio.kind[source] === kind)
          this.appendSource(portfolio, source, ourActions, ourArguments, ourCount);
    if (portfolio.count > this.optionCount)
      this.optionTruncated += portfolio.count - this.optionCount;
    return this.optionCount;
  }

  currentOptionIndex() {
    if (this.informationOptionIndex >= 0) return this.informationOptionIndex;
    if (!this.rootOurCount) return -1;
    const ordered = this.frameRow[0];
    const actual = this.actualRootRow(ordered);
    return actual >= 0 && actual < this.optionCount ? actual : -1;
  }

  prepareInformationPortfolio(portfolio, ourActions, ourArguments, ourCount,
      preferredPrimitiveRow = -1) {
    this.resetOptionRoot();
    this.preferredPrimitiveRow = preferredPrimitiveRow >= 0 && preferredPrimitiveRow < ourCount ?
      preferredPrimitiveRow : 255;
    const limit = SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    let preferredSource = -1;
    if (this.preferredPrimitiveRow !== 255)
      for (const kind of OPTION_PRIORITY) {
        for (let source = 0; source < portfolio.count; source += 1)
          if (portfolio.primitiveRow[source] === this.preferredPrimitiveRow &&
              portfolio.kind[source] === kind) { preferredSource = source; break; }
        if (preferredSource >= 0) break;
      }
    if (preferredSource >= 0)
      this.appendSource(portfolio, preferredSource, ourActions, ourArguments, ourCount);
    else if (this.preferredPrimitiveRow !== 255) {
      const at = this.optionCount++;
      this.optionActions[at] = ourActions[this.preferredPrimitiveRow];
      this.optionArguments[at] = ourArguments[this.preferredPrimitiveRow];
      this.optionPrimitiveRow[at] = this.preferredPrimitiveRow;
      this.optionKind[at] = OPTION_KIND.NONE;
      this.optionTargetCell[at] = NONE_CELL;
      this.optionDeadline[at] = 0xffff;
      this.optionSourceIndex[at] = 255;
    }
    let eligible = this.optionCount;
    for (let source = 0; source < portfolio.count; source += 1) {
      if (!portfolio.supportComplete[source] ||
          !optionSearchTacticalKind(portfolio.kind[source]) ||
          source === preferredSource ||
          portfolio.primitiveRow[source] === this.preferredPrimitiveRow) continue;
      eligible += 1;
      if (this.optionCount < limit)
        this.appendSource(portfolio, source, ourActions, ourArguments, ourCount);
    }
    if (eligible > this.optionCount) this.optionTruncated = eligible - this.optionCount;
    return this.optionCount;
  }

  currentOptionKind() {
    const index = this.currentOptionIndex();
    return index < 0 ? OPTION_KIND.NONE : this.optionKind[index];
  }

  currentOptionTarget() {
    const index = this.currentOptionIndex();
    return index < 0 ? NONE_CELL : this.optionTargetCell[index];
  }

  optionSalt() {
    const index = this.currentOptionIndex();
    if (index < 0) return 0;
    return (this.optionKind[index] * 65537 + this.optionTargetCell[index] * 257 +
      this.optionDeadline[index]) >>> 0;
  }

  cacheKey(state, depth) { return mix(super.cacheKey(state, depth), this.optionSalt()); }
  cacheKeyHi(state, depth) {
    return mix(super.cacheKeyHi(state, depth), this.optionSalt() ^ 0x6f707469);
  }
  cacheSignature(state, depth) {
    return mix(super.cacheSignature(state, depth), this.optionSalt() ^ 0x6f707473);
  }

  canFire(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    return !this.activeProjectile(state, seat) &&
      (a[ARRAY.TANK_FIRE_LOCK][seat] === NONE_FRAME ||
       a[ARRAY.TANK_FIRE_LOCK][seat] <= frame);
  }

  pushOptionSkill(top, state, seat, skill) {
    const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (skill === SKILL.NONE || state.arrays[ARRAY.TANK_SKILL_READY][seat] > frame) return;
    this.pushDeepSkill(top, state, seat, skill);
  }

  generateAttackContinuation(top, state) {
    this.frameOurCount[top] = 0;
    const hostileSlot = this.hostileProjectileSlot(state, 0);
    if (hostileSlot >= 0) { super.generateDeep(top, state, 0); return; }
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1]; const current = a[ARRAY.TANK_DIR][0];
    const wanted = this.desiredDirection(state, cell, enemy); const left = (current + 3) & 3;
    if (this.canFire(state, 0) && wanted === current && this.clearLine(state, cell, enemy))
      this.pushDeep(top, 0, ACTION.FIRE);
    if (wanted !== current)
      this.pushDeep(top, 0, wanted === left ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT);
    else if (this.walkable(state, this.target(state, cell, current)))
      this.pushDeep(top, 0, ACTION.GO);
    this.pushOptionSkill(top, state, 0, a[ARRAY.TANK_SKILL][0]);
    if (this.frameOurCount[top] < 2 && this.walkable(state, this.target(state, cell, current)))
      this.pushDeep(top, 0, ACTION.GO);
    if (!this.frameOurCount[top]) this.pushDeep(top, 0, ACTION.NONE);
    this.finishDeepRepresentatives(top, 0, this.iterationExpansionLimit);
  }

  generateStarContinuation(top, state) {
    this.frameOurCount[top] = 0;
    const hostileSlot = this.hostileProjectileSlot(state, 0);
    if (hostileSlot >= 0) { super.generateDeep(top, state, 0); return; }
    const a = state.arrays; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star === NONE_CELL) { super.generateDeep(top, state, 0); return; }
    const cell = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const current = a[ARRAY.TANK_DIR][0]; const wanted = this.desiredDirection(state, cell, star);
    const left = (current + 3) & 3;
    this.pushDeep(top, 0, wanted === current ? ACTION.GO :
      wanted === left ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT);
    const attack = this.desiredDirection(state, cell, enemy);
    if (this.canFire(state, 0) && attack === current && this.clearLine(state, cell, enemy))
      this.pushDeep(top, 0, ACTION.FIRE);
    if (this.frameOurCount[top] < 2 && wanted !== current &&
        this.walkable(state, this.target(state, cell, current)))
      this.pushDeep(top, 0, ACTION.GO);
    this.finishDeepRepresentatives(top, 0, this.iterationExpansionLimit);
  }

  generateDeep(top, state, seat) {
    if (seat) { super.generateDeep(top, state, seat); return; }
    const kind = this.currentOptionKind();
    if (kind === OPTION_KIND.DIRECT_KILL || kind === OPTION_KIND.ATTACK_SETUP ||
        kind === OPTION_KIND.RESOURCE) {
      this.generateAttackContinuation(top, state); return;
    }
    if (kind === OPTION_KIND.STAR_CONTROL) {
      this.generateStarContinuation(top, state); return;
    }
    super.generateDeep(top, state, seat);
  }

  heuristic(state) {
    const kind = this.currentOptionKind();
    if (kind !== OPTION_KIND.DIRECT_KILL && kind !== OPTION_KIND.ATTACK_SETUP &&
        kind !== OPTION_KIND.RESOURCE) return super.heuristic(state);
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1]; const distance = this.distance(state, own, enemy);
    let value = (a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1]) * 2200;
    value += (this.mobility(state, 0) - this.mobility(state, 1)) * 250;
    value += Math.max(0, 20 - distance) * 400;
    const ownWanted = this.desiredDirection(state, own, enemy);
    const enemyWanted = this.desiredDirection(state, enemy, own);
    if (this.clearLine(state, own, enemy)) {
      if (ownWanted === a[ARRAY.TANK_DIR][0]) value += 3200;
      if (enemyWanted === a[ARRAY.TANK_DIR][1]) value -= 3200;
    }
    return Math.max(-25000, Math.min(25000, value));
  }

  searchPortfolio(bundle, portfolio, ourActions, ourArguments, ourCount,
      enemyActions, enemyArguments, enemyCount, targetDepth, nodeBudget,
      baseRisk = 0, preferredPrimitiveRow = -1) {
    this.searchCount += 1;
    const count = this.preparePortfolio(portfolio, ourActions, ourArguments,
      ourCount, preferredPrimitiveRow);
    if (!count) { this.lastStatus = OPTION_SEARCH_STATUS.INCOMPLETE;
      this.incompleteCount += 1; return 0; }
    const completed = super.search(bundle, this.optionActions, this.optionArguments, count,
      enemyActions, enemyArguments, enemyCount, targetDepth, nodeBudget, baseRisk);
    this.totalNodes += this.nodes; if (this.nodes > this.maximumNodes) this.maximumNodes = this.nodes;
    if (completed < targetDepth || this.rootRestoreFailures || this.optionTruncated) {
      this.lastStatus = OPTION_SEARCH_STATUS.INCOMPLETE; this.incompleteCount += 1; return 0;
    }
    this.lastStatus = OPTION_SEARCH_STATUS.COMPLETE; this.completeCount += 1;
    this.lastBestOption = this.bestRow;
    this.lastBestPrimitiveRow = this.optionPrimitiveRow[this.bestRow];
    this.lastBestKind = this.optionKind[this.bestRow]; this.proposalCount += 1;
    if (this.lastBestPrimitiveRow !== preferredPrimitiveRow) this.differentPrimitiveCount += 1;
    return 1;
  }

  summary() {
    return { status: this.lastStatus, searchCount: this.searchCount,
      completeCount: this.completeCount, incompleteCount: this.incompleteCount,
      proposalCount: this.proposalCount,
      differentPrimitiveCount: this.differentPrimitiveCount,
      totalNodes: this.totalNodes, maximumNodes: this.maximumNodes,
      lastBestOption: this.lastBestOption,
      lastBestPrimitiveRow: this.lastBestPrimitiveRow,
      lastBestKind: this.lastBestKind, optionCount: this.optionCount,
      optionTruncated: this.optionTruncated, hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { OPTION_SEARCH_CAPACITY, OPTION_SEARCH_STATUS,
  optionSearchTacticalKind, optionSearchOwnableKind, OptionAwareDepthSearch };
