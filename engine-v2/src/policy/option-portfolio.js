"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { STRATEGY_PURPOSE, COMBAT_PURPOSE, GLOBAL_MODE, NONE_HANDLE } =
  require("../abi/policy-codes");
const { ACTION, NONE_FRAME, NONE_CELL } = require("../abi/fast-codes");

const OPTION_KIND = Object.freeze({ NONE: 0, COMMITTED_RESCUE: 1,
  DIRECT_KILL: 2, ATTACK_SETUP: 3, STAR_CONTROL: 4, TERMINAL: 5,
  POSITION: 6, RESOURCE: 7, COUNT: 8 });
const OPTION_EVIDENCE = Object.freeze({ NONE: 0, COMMITTED: 1 << 0,
  COMBAT: 1 << 1, STRATEGY: 1 << 2, PLAN: 1 << 3,
  TARGET: 1 << 4, COMPLETE: 1 << 5 });
const MAX_OPTIONS_PER_ACTION = 6;
const MAX_OPTIONS = SEARCH_CAPACITY.MAX_OUR_ACTIONS * MAX_OPTIONS_PER_ACTION;
const COMPLETE_COMMITTED_SUPPORT = 1;
const ATTACK = STRATEGY_PURPOSE.DIRECT_KILL |
  STRATEGY_PURPOSE.ADVANTAGEOUS_FIRE | STRATEGY_PURPOSE.AIM_SETUP |
  STRATEGY_PURPOSE.INTERCEPT | STRATEGY_PURPOSE.ESCAPE_DENIAL |
  STRATEGY_PURPOSE.SHIELD_BREAK | STRATEGY_PURPOSE.ZONE_DENIAL |
  STRATEGY_PURPOSE.BELIEF_SWEEP | STRATEGY_PURPOSE.ATTACK_APPROACH;
const STAR = STRATEGY_PURPOSE.STAR_COLLECT | STRATEGY_PURPOSE.STAR_DENY;
const TERMINAL = STRATEGY_PURPOSE.PRESERVE_NONLOSS |
  STRATEGY_PURPOSE.TERMINAL_REVERSAL;

class OptionPortfolioSlab {
  constructor(maxOptions = MAX_OPTIONS) {
    this.capacity = maxOptions;
    this.primitiveRow = new Uint8Array(maxOptions);
    this.kind = new Uint8Array(maxOptions);
    this.targetCell = new Uint16Array(maxOptions);
    this.targetSignature = new Uint32Array(maxOptions);
    this.deadline = new Uint16Array(maxOptions);
    this.evidence = new Uint8Array(maxOptions);
    this.supportComplete = new Uint8Array(maxOptions);
    this.optionCountByRow = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.count = 0; this.rootCount = 0; this.aliasRootCount = 0;
    this.aliasRowCount = 0; this.capacityFailureCount = 0;
    this.maximumOptionsInRoot = 0; this.hotAllocationCount = 0;
    this.selectionCount = 0; this.selectedAliasCount = 0;
    this.selectedAttackCount = 0; this.selectedStarCount = 0;
    this.selectedTerminalCount = 0; this.selectedPositionCount = 0;
    this.selectedResourceCount = 0; this.verifiedResourceCount = 0;
    this.unverifiedResourceCount = 0; this.selectedUntypedCount = 0;
    this.typedBuildCount = 0; this.rowWithoutOptionCount = 0;
  }
  reset() {
    this.count = 0; this.optionCountByRow.fill(0);
  }
  add(row, kind, targetCell = NONE_CELL, signature = 0, deadline = 0xffff,
      evidence = OPTION_EVIDENCE.NONE, complete = 0) {
    for (let at = 0; at < this.count; at += 1)
      if (this.primitiveRow[at] === row && this.kind[at] === kind &&
          this.targetCell[at] === targetCell && this.targetSignature[at] === signature)
        return at;
    if (this.count >= this.capacity) {
      this.capacityFailureCount += 1; return -1;
    }
    const at = this.count++;
    this.primitiveRow[at] = row; this.kind[at] = kind;
    this.targetCell[at] = targetCell; this.targetSignature[at] = signature >>> 0;
    this.deadline[at] = deadline; this.evidence[at] = evidence;
    this.supportComplete[at] = complete ? 1 : 0;
    this.optionCountByRow[row] += 1;
    return at;
  }
  build(actions, count, bands, combat, escape, handles, sketches, state) {
    this.reset(); this.rootCount += 1;
    const a = state.arrays;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const enemy = a[ARRAY.TANK_CELL][1];
    let rootAliases = 0;
    for (let row = 0; row < count; row += 1) {
      const purpose = bands.purpose[row];
      const handle = handles[row];
      const hasPlan = handle !== NONE_HANDLE && handle < sketches.used;
      const signature = hasPlan ? sketches.targetSignature[handle] : 0;
      const deadline = hasPlan ? sketches.deadline[handle] : 0xffff;
      let added = 0;
      if (escape.member[row]) {
        this.add(row, OPTION_KIND.COMMITTED_RESCUE, NONE_CELL, signature,
          deadline, OPTION_EVIDENCE.COMMITTED |
            (escape.supportStatus === COMPLETE_COMMITTED_SUPPORT ?
              OPTION_EVIDENCE.COMPLETE : 0),
          escape.supportStatus === COMPLETE_COMMITTED_SUPPORT);
        added += 1;
      }
      if (purpose & ATTACK) {
        const direct = combat.directKill[row] ? OPTION_KIND.DIRECT_KILL :
          OPTION_KIND.ATTACK_SETUP;
        this.add(row, direct, enemy, signature, deadline,
          OPTION_EVIDENCE.STRATEGY | OPTION_EVIDENCE.COMBAT |
            (hasPlan ? OPTION_EVIDENCE.PLAN : 0) | OPTION_EVIDENCE.TARGET,
          combat.purposeCompleteness[row] >= 4500);
        added += 1;
      }
      if (purpose & STAR) {
        this.add(row, OPTION_KIND.STAR_CONTROL, star, signature, deadline,
          OPTION_EVIDENCE.STRATEGY | (hasPlan ? OPTION_EVIDENCE.PLAN : 0) |
            (star !== NONE_CELL ? OPTION_EVIDENCE.TARGET : 0),
          star !== NONE_CELL);
        added += 1;
      }
      if (purpose & TERMINAL) {
        this.add(row, OPTION_KIND.TERMINAL, star, signature, deadline,
          OPTION_EVIDENCE.STRATEGY | (hasPlan ? OPTION_EVIDENCE.PLAN : 0),
          hasPlan);
        added += 1;
      }
      if (purpose & STRATEGY_PURPOSE.NEUTRAL_POSITION) {
        this.add(row, OPTION_KIND.POSITION, NONE_CELL, signature, deadline,
          OPTION_EVIDENCE.STRATEGY | (hasPlan ? OPTION_EVIDENCE.PLAN : 0),
          hasPlan);
        added += 1;
      }
      if (purpose & STRATEGY_PURPOSE.SKILL_SETUP) {
        this.add(row, OPTION_KIND.RESOURCE, enemy, signature, deadline,
          OPTION_EVIDENCE.STRATEGY | (hasPlan ? OPTION_EVIDENCE.PLAN : 0),
          hasPlan);
        added += 1;
      }
      if (!added) this.add(row, OPTION_KIND.POSITION, NONE_CELL, signature,
        deadline, hasPlan ? OPTION_EVIDENCE.PLAN : OPTION_EVIDENCE.NONE, hasPlan);
      if (this.optionCountByRow[row] > 1) {
        this.aliasRowCount += 1; rootAliases += 1;
      }
    }
    if (rootAliases) this.aliasRootCount += 1;
    if (this.count > this.maximumOptionsInRoot) this.maximumOptionsInRoot = this.count;
    return this.count;
  }
  typedResourceVerified(action, row, combat, state, enemyVisible) {
    if (action === ACTION.CAST_POISON) {
      const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
      const active = a[ARRAY.TANK_POISON_UNTIL][1] !== NONE_FRAME &&
        a[ARRAY.TANK_POISON_UNTIL][1] > frame;
      return enemyVisible && !active ? 1 : 0;
    }
    if (action !== ACTION.THROW_BOMB) return 0;
    const flags = combat.purposeFlags[row];
    return combat.purposeCompleteness[row] >= 4500 &&
      Boolean(flags & (COMBAT_PURPOSE.DIRECT_KILL | COMBAT_PURPOSE.ESCAPE_DENIAL |
        COMBAT_PURPOSE.ZONE_DENIAL));
  }
  buildTyped(actions, count, bands, combat, escape, handles, sketches, state,
      globalMode = GLOBAL_MODE.NORMAL, enemyVisible = 0) {
    this.reset(); this.rootCount += 1; this.typedBuildCount += 1;
    const a = state.arrays; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const enemy = a[ARRAY.TANK_CELL][1]; let rootAliases = 0;
    for (let row = 0; row < count; row += 1) {
      const action = actions[row]; const handle = handles[row];
      const hasPlan = handle !== NONE_HANDLE && handle < sketches.used;
      const signature = hasPlan ? sketches.targetSignature[handle] : 0;
      const deadline = hasPlan ? sketches.deadline[handle] : 0xffff; let added = 0;
      if (escape.member[row]) {
        this.add(row, OPTION_KIND.COMMITTED_RESCUE, NONE_CELL, signature, deadline,
          OPTION_EVIDENCE.COMMITTED | (escape.supportStatus === COMPLETE_COMMITTED_SUPPORT ?
            OPTION_EVIDENCE.COMPLETE : 0),
          escape.supportStatus === COMPLETE_COMMITTED_SUPPORT);
        added += 1;
      }
      const flags = combat.purposeFlags[row];
      if (flags & (COMBAT_PURPOSE.DIRECT_KILL | COMBAT_PURPOSE.AIM_SETUP |
          COMBAT_PURPOSE.INTERCEPT | COMBAT_PURPOSE.ESCAPE_DENIAL |
          COMBAT_PURPOSE.SHIELD_BREAK)) {
        const direct = combat.directKill[row] ? OPTION_KIND.DIRECT_KILL :
          OPTION_KIND.ATTACK_SETUP;
        const complete = combat.purposeCompleteness[row] >= 4500 &&
          (action !== ACTION.FIRE || combat.postFireEscape[row] > 0);
        this.add(row, direct, enemy, signature, deadline,
          OPTION_EVIDENCE.COMBAT | OPTION_EVIDENCE.TARGET |
            (hasPlan ? OPTION_EVIDENCE.PLAN : 0) |
            (complete ? OPTION_EVIDENCE.COMPLETE : 0), complete);
        added += 1;
      }
      if (bands.starPurpose[row] && star !== NONE_CELL) {
        this.add(row, OPTION_KIND.STAR_CONTROL, star, signature, deadline,
          OPTION_EVIDENCE.STRATEGY | OPTION_EVIDENCE.TARGET |
            (hasPlan ? OPTION_EVIDENCE.PLAN : 0) | OPTION_EVIDENCE.COMPLETE, 1);
        added += 1;
      }
      const movement = action === ACTION.GO || action === ACTION.TURN_LEFT ||
        action === ACTION.TURN_RIGHT || action === ACTION.NONE;
      if (movement && globalMode !== GLOBAL_MODE.NORMAL) {
        this.add(row, OPTION_KIND.TERMINAL, star, signature, deadline,
          OPTION_EVIDENCE.STRATEGY | (hasPlan ? OPTION_EVIDENCE.PLAN : 0) |
            OPTION_EVIDENCE.COMPLETE, 1);
        added += 1;
      }
      if (this.typedResourceVerified(action, row, combat, state, enemyVisible)) {
        this.add(row, OPTION_KIND.RESOURCE, enemy, signature, deadline,
          OPTION_EVIDENCE.COMBAT | OPTION_EVIDENCE.TARGET |
            (hasPlan ? OPTION_EVIDENCE.PLAN : 0) | OPTION_EVIDENCE.COMPLETE, 1);
        added += 1;
      }
      // Position is a real Option only with a target. Untargeted movement stays
      // a legal primitive fallback but cannot claim strategic ownership.
      if (!added && movement) {
        const target = star !== NONE_CELL ? star : enemyVisible ? enemy : NONE_CELL;
        if (target !== NONE_CELL) {
          this.add(row, OPTION_KIND.POSITION, target, signature, deadline,
            OPTION_EVIDENCE.TARGET | (hasPlan ? OPTION_EVIDENCE.PLAN : 0) |
              OPTION_EVIDENCE.COMPLETE, 1);
          added += 1;
        }
      }
      if (!added) this.rowWithoutOptionCount += 1;
      if (this.optionCountByRow[row] > 1) { this.aliasRowCount += 1; rootAliases += 1; }
    }
    if (rootAliases) this.aliasRootCount += 1;
    if (this.count > this.maximumOptionsInRoot) this.maximumOptionsInRoot = this.count;
    return this.count;
  }
  observeSelection(row, action, resourceVerified = 0) {
    if (row < 0) return;
    this.selectionCount += 1;
    if (this.optionCountByRow[row] > 1) this.selectedAliasCount += 1;
    let mask = 0;
    for (let at = 0; at < this.count; at += 1)
      if (this.primitiveRow[at] === row) mask |= 1 << this.kind[at];
    if (action === ACTION.THROW_BOMB ||
        action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST) {
      this.selectedResourceCount += 1;
      if (resourceVerified && mask & (1 << OPTION_KIND.RESOURCE))
        this.verifiedResourceCount += 1;
      else this.unverifiedResourceCount += 1;
      if (!mask) this.selectedUntypedCount += 1;
      return;
    }
    if (mask & ((1 << OPTION_KIND.DIRECT_KILL) | (1 << OPTION_KIND.ATTACK_SETUP)))
      this.selectedAttackCount += 1;
    else if (mask & (1 << OPTION_KIND.STAR_CONTROL)) this.selectedStarCount += 1;
    else if (mask & (1 << OPTION_KIND.TERMINAL)) this.selectedTerminalCount += 1;
    else if (mask & (1 << OPTION_KIND.POSITION)) this.selectedPositionCount += 1;
    else this.selectedUntypedCount += 1;
  }
  summary() {
    return { capacity: this.capacity, rootCount: this.rootCount,
      aliasRootCount: this.aliasRootCount, aliasRowCount: this.aliasRowCount,
      maximumOptionsInRoot: this.maximumOptionsInRoot,
      capacityFailureCount: this.capacityFailureCount,
      selectionCount: this.selectionCount, selectedAliasCount: this.selectedAliasCount,
      selectedAttackCount: this.selectedAttackCount,
      selectedStarCount: this.selectedStarCount,
      selectedTerminalCount: this.selectedTerminalCount,
      selectedPositionCount: this.selectedPositionCount,
      selectedResourceCount: this.selectedResourceCount,
      verifiedResourceCount: this.verifiedResourceCount,
      unverifiedResourceCount: this.unverifiedResourceCount,
      selectedUntypedCount: this.selectedUntypedCount,
      typedBuildCount: this.typedBuildCount,
      rowWithoutOptionCount: this.rowWithoutOptionCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { OPTION_KIND, OPTION_EVIDENCE, MAX_OPTIONS_PER_ACTION,
  MAX_OPTIONS, OptionPortfolioSlab };
