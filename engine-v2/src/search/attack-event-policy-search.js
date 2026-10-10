"use strict";

// Compact exact-Physical AND/OR certificate for an irreversible enemy crash.
// It is intentionally not wired into ProductionRoot yet.  The implementation
// exists in the production tree so diagnostics can prove semantic equivalence,
// fixed-memory cost and work scheduling before it is allowed to own an action.

const { ProductionForcedWinSearch } = require("./production-forced-win-search");
const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, EVENT, FAST_STATUS, HARD_STATUS, TERMINAL, TERRAIN,
  NONE_FRAME, NONE_CELL } = require("../abi/fast-codes");
const { PROOF_STATUS } = require("../abi/search-codes");
const { WORK_KIND } = require("../abi/cache-runtime-codes");
const { RUNTIME_CONFIG } = require("../generated/runtime-config");

const ATTACK_EVENT_TT_CAPACITY = 2048;
const ATTACK_EVENT_POLICY_CAPACITY = 64;
const SEMANTIC_SCALARS = Object.freeze([SCALAR.FRAME, SCALAR.TERRAIN_VERSION,
  SCALAR.TOPOLOGY_VERSION, SCALAR.STAR_CELL, SCALAR.TIMEOUT_SEAT,
  SCALAR.SCRIPT_ERROR_SEAT, SCALAR.TERMINAL_CODE, SCALAR.WINNER_SEAT]);

class AttackEventPolicySnapshot {
  constructor(capacity = ATTACK_EVENT_POLICY_CAPACITY) {
    this.capacity = capacity;
    this.semanticLo = new Uint32Array(capacity);
    this.semanticHi = new Uint32Array(capacity);
    this.depth = new Uint8Array(capacity);
    this.action = new Uint8Array(capacity);
    this.argument = new Uint16Array(capacity);
    this.count = 0; this.complete = 0;
    this.selectedAction = ACTION.NONE; this.selectedArgument = NONE_CELL;
    this.captureCount = 0; this.overflowCount = 0;
    this.lookupCount = 0; this.hitCount = 0; this.maximumEntries = 0;
    this.hotAllocationCount = 0;
  }

  capture(search) {
    this.count = 0; this.complete = 0; this.captureCount += 1;
    for (let slot = 0; slot < search.ttDepth.length; slot += 1) {
      if (!search.ttDepth[slot] ||
          search.ttStatus[slot] !== PROOF_STATUS.PROVEN) continue;
      if (this.count >= this.capacity) {
        this.count = 0; this.overflowCount += 1; return 0;
      }
      const at = this.count++;
      this.semanticLo[at] = search.ttSemanticLo[slot];
      this.semanticHi[at] = search.ttSemanticHi[slot];
      this.depth[at] = search.ttDepth[slot];
      this.action[at] = search.ttPolicyAction[slot];
      this.argument[at] = search.ttPolicyArgument[slot];
    }
    if (this.count > this.maximumEntries) this.maximumEntries = this.count;
    this.complete = 1; return 1;
  }

  policyFor(state, depth, keyer) {
    this.lookupCount += 1;
    if (!this.complete || !state || depth < 1 || !keyer) return 0;
    keyer.semanticKey(state);
    for (let at = 0; at < this.count; at += 1)
      if (this.depth[at] === depth &&
          this.semanticLo[at] === keyer.semanticLo &&
          this.semanticHi[at] === keyer.semanticHi) {
        this.selectedAction = this.action[at];
        this.selectedArgument = this.argument[at];
        this.hitCount += 1; return 1;
      }
    return 0;
  }
}

class AttackEventPolicySearch extends ProductionForcedWinSearch {
  constructor(nodeBudget = 2048, ttCapacity = ATTACK_EVENT_TT_CAPACITY) {
    super(null);
    if (!Number.isSafeInteger(ttCapacity) || ttCapacity < 64 ||
        (ttCapacity & (ttCapacity - 1)) !== 0)
      throw new Error("ATTACK_EVENT_TT_CAPACITY_POWER_OF_TWO_REQUIRED");
    this.defaultNodeBudget = nodeBudget;
    this.ttCapacity = ttCapacity;
    this.ttLo = new Uint32Array(ttCapacity);
    this.ttHi = new Uint32Array(ttCapacity);
    this.ttSemanticLo = new Uint32Array(ttCapacity);
    this.ttSemanticHi = new Uint32Array(ttCapacity);
    this.ttDepth = new Uint8Array(ttCapacity);
    this.ttStatus = new Uint8Array(ttCapacity);
    this.ttPolicyAction = new Uint8Array(ttCapacity);
    this.ttPolicyArgument = new Uint16Array(ttCapacity);
    this.goalMask = 0; this.poisonHoldTransitionCount = 0;
    this.provenPolicyEntryCount = 0; this.ttHits = 0; this.ttStores = 0;
    this.ttCapacityStops = 0; this.hiddenStops = 0; this.hardRejects = 0;
    this.hardIncompleteStops = 0; this.unsupportedGenerationStops = 0;
    this.rootDomainGenerationCount = 0;
    this.rootDomainGenerationFailureCount = 0;
    this.semanticLo = 0; this.semanticHi = 0; this.maximumNodes = 0;
    this.workUnitBudget = 0; this.workUnits = 0; this.workBudgetStopCount = 0;
  }

  resetPolicy(nodeBudget) {
    this.resetRoot(); this.nodeBudget = nodeBudget;
    this.goalMask = 0; this.poisonHoldTransitionCount = 0;
    this.provenPolicyEntryCount = 0; this.ttHits = 0; this.ttStores = 0;
    this.ttCapacityStops = 0; this.hiddenStops = 0; this.hardRejects = 0;
    this.hardIncompleteStops = 0; this.unsupportedGenerationStops = 0;
    this.workUnits = 0; this.workBudgetStopCount = 0;
    this.ttDepth.fill(0); this.ttStatus.fill(0);
  }

  visiblePhysical(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_CRASH][1]) return 1;
    const enemyCell = a[ARRAY.TANK_CELL][1];
    const revealed = a[ARRAY.TANK_REVEAL_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_REVEAL_UNTIL][1] > frame;
    const cloaked = a[ARRAY.TANK_CLOAK_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_CLOAK_UNTIL][1] > frame;
    return revealed || (!cloaked && enemyCell !== NONE_CELL &&
      a[ARRAY.TERRAIN][enemyCell] !== TERRAIN.GRASS) ? 1 : 0;
  }

  mix(value) {
    let x = value >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
    x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  }

  semanticStatusValue(id, index, value, arrays, frame) {
    if (id === ARRAY.TANK_POISON_APPLIED) {
      const until = arrays[ARRAY.TANK_POISON_UNTIL][index];
      if (until === NONE_FRAME || until <= frame) return 0;
      return value === NONE_FRAME ? 3 : 1 + ((frame - value) & 1);
    }
    if (id === ARRAY.TANK_SKILL_READY || id === ARRAY.TANK_BOMB_READY)
      return value <= frame ? 0 : Math.min(5, value - frame);
    if (id === ARRAY.TANK_PICKUP_LOCK || id === ARRAY.TANK_FIRE_LOCK)
      return value === NONE_FRAME || value <= frame ? 0 : Math.min(5, value - frame);
    if (id === ARRAY.TANK_SHIELD_UNTIL || id === ARRAY.TANK_FROZEN_UNTIL ||
        id === ARRAY.TANK_STUN_UNTIL || id === ARRAY.TANK_OVERLOAD_UNTIL ||
        id === ARRAY.TANK_CLOAK_UNTIL || id === ARRAY.TANK_POISON_UNTIL ||
        id === ARRAY.TANK_BOOST_UNTIL || id === ARRAY.TANK_REVEAL_UNTIL)
      return value === NONE_FRAME || value <= frame ? 0 : Math.min(5, value - frame);
    return value;
  }

  semanticKey(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    let lo = this.mix(state.width | (state.height << 8));
    let hi = this.mix((state.height | (state.width << 8)) ^ 0x9e3779b9);
    for (let id = ARRAY.TANK_CELL; id <= ARRAY.TANK_BOMB_READY; id += 1) {
      if (id === ARRAY.TANK_RUNTIME) continue;
      const array = a[id];
      for (let index = 0; index < array.length; index += 1) {
        const value = this.semanticStatusValue(id, index, array[index], a, frame);
        const token = ((id + 1) * 0x10001 + index * 0x101 + value) >>> 0;
        lo = (lo ^ this.mix(token)) >>> 0;
        hi = (hi + this.mix(token ^ 0xa5a5a5a5)) >>> 0;
      }
    }
    const scalar = a[ARRAY.SCALAR];
    for (let at = 0; at < SEMANTIC_SCALARS.length; at += 1) {
      const index = SEMANTIC_SCALARS[at];
      const token = (0x51ed0000 + index * 0x101 + scalar[index]) >>> 0;
      lo = (lo ^ this.mix(token)) >>> 0;
      hi = (hi + this.mix(token ^ 0x3c6ef372)) >>> 0;
    }
    for (let slot = 0; slot < a[ARRAY.PROJECTILE_ACTIVE].length; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot]) continue;
      const token = (a[ARRAY.PROJECTILE_OWNER][slot] |
        (a[ARRAY.PROJECTILE_CELL][slot] << 2) |
        (a[ARRAY.PROJECTILE_DIR][slot] << 14) |
        (a[ARRAY.PROJECTILE_MEMBER][slot] << 18)) >>> 0;
      lo = (lo + this.mix(token ^ 0x243f6a88)) >>> 0;
      hi = (hi + this.mix(token ^ 0x85a308d3)) >>> 0;
    }
    for (let slot = 0; slot < a[ARRAY.BOMB_ACTIVE].length; slot += 1) {
      if (!a[ARRAY.BOMB_ACTIVE][slot]) continue;
      const token = (a[ARRAY.BOMB_OWNER][slot] |
        (a[ARRAY.BOMB_CELL][slot] << 2) |
        (a[ARRAY.BOMB_EXPLODE][slot] << 14)) >>> 0;
      lo = (lo + this.mix(token ^ 0x13198a2e)) >>> 0;
      hi = (hi + this.mix(token ^ 0x03707344)) >>> 0;
    }
    this.semanticLo = lo; this.semanticHi = hi;
  }

  ttSlot(state, depth) {
    const capacity = this.ttCapacity;
    let slot = (state.hashLo ^ ((state.hashHi << 7) | (state.hashHi >>> 25)) ^
      (depth * 0x9e3779b9)) & (capacity - 1);
    for (let probe = 0; probe < capacity; probe += 1) {
      if (!this.ttDepth[slot] || (this.ttDepth[slot] === depth &&
          this.ttLo[slot] === state.hashLo && this.ttHi[slot] === state.hashHi)) return slot;
      slot = (slot + 1) & (capacity - 1);
    }
    this.ttCapacityStops += 1; return -1;
  }

  lookupState(state, depth) {
    const slot = this.ttSlot(state, depth);
    if (slot < 0 || !this.ttDepth[slot]) return 0;
    this.ttHits += 1; return this.ttStatus[slot];
  }

  storeState(state, depth, status, action = ACTION.NONE, argument = NONE_CELL) {
    if (status === PROOF_STATUS.UNKNOWN) return;
    const slot = this.ttSlot(state, depth); if (slot < 0) return;
    if (status === PROOF_STATUS.PROVEN &&
        this.ttStatus[slot] !== PROOF_STATUS.PROVEN)
      this.provenPolicyEntryCount += 1;
    this.ttLo[slot] = state.hashLo; this.ttHi[slot] = state.hashHi;
    this.ttDepth[slot] = depth; this.ttStatus[slot] = status;
    this.ttPolicyAction[slot] = action; this.ttPolicyArgument[slot] = argument;
    if (status === PROOF_STATUS.PROVEN) {
      this.semanticKey(state);
      this.ttSemanticLo[slot] = this.semanticLo;
      this.ttSemanticHi[slot] = this.semanticHi;
    }
    this.ttStores += 1;
  }

  generate(top, state, seat) {
    const supported = super.generate(top, state, seat);
    if (!supported) this.unsupportedGenerationStops += 1;
    return supported;
  }

  proveOutcome(bundle, depth, top, action0, argument0, action1, argument1,
      chance0, chance1) {
    if (this.nodes >= this.nodeBudget ||
        (this.workUnitBudget && this.workUnits >= this.workUnitBudget)) {
      if (this.workUnitBudget && this.workUnits >= this.workUnitBudget)
        this.workBudgetStopCount += 1;
      this.budgetStopCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const state = bundle.state; const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const poisonUntil = a[ARRAY.TANK_POISON_UNTIL][1];
    const poisonApplied = a[ARRAY.TANK_POISON_APPLIED][1];
    if (poisonUntil !== NONE_FRAME && poisonUntil > frame &&
        poisonApplied !== NONE_FRAME && ((frame - poisonApplied) & 1) !== 0)
      this.poisonHoldTransitionCount += 1;
    const beforeBuild = bundle.hard.reverseBuildCount;
    const status = bundle.kernel.applyFrame(action0, argument0, action1, argument1,
      chance0, chance1);
    this.nodes += 1;
    this.workUnits += RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.PROOF_NODE] +
      RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.FAST_TRANSITION];
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
      this.incompleteCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const mark = bundle.kernel.lastMark;
    const deltaMark = (mark / 1024) | 0;
    const eventStart = mark - deltaMark * 1024;
    let result;
    const terminal = a[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    const hard = bundle.hard.classifyApplied();
    this.workUnits += RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.CACHE];
    if (bundle.hard.reverseBuildCount > beforeBuild)
      this.workUnits += Math.max(0,
        RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.HARD] -
        RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.CACHE]);
    if (hard === HARD_STATUS.INCOMPLETE) {
      this.hardIncompleteStops += 1; result = PROOF_STATUS.UNKNOWN;
    } else if (hard !== HARD_STATUS.ALLOW || a[ARRAY.TANK_CRASH][0]) {
      this.hardRejects += 1; result = PROOF_STATUS.DISPROVEN;
    } else if (terminal === TERMINAL.WIN1 || terminal === TERMINAL.DRAW) {
      result = PROOF_STATUS.DISPROVEN;
    } else {
      let crash = 0;
      for (let at = eventStart; at < state.eventUsed; at += 1)
        if (state.eventEntity[at] === 2 &&
            state.eventType[at] === EVENT.TANK_CRASHED) { crash = 1; break; }
      if (crash) { this.goalMask = 1; result = PROOF_STATUS.PROVEN; }
      else if (terminal) result = PROOF_STATUS.DISPROVEN;
      else if (!this.visiblePhysical(state)) {
        this.hiddenStops += 1; result = PROOF_STATUS.UNKNOWN;
      } else if (depth <= 1) result = PROOF_STATUS.DISPROVEN;
      else result = this.proveState(bundle, depth - 1, top + 1);
    }
    state.undoTo(mark); return result;
  }

  proveState(bundle, depth, top) {
    const state = bundle.state;
    const cached = this.lookupState(state, depth); if (cached) return cached;
    if (top > SEARCH_CAPACITY.MAX_DECISION_DEPTH ||
        !this.generate(top, state, 0) || !this.generate(top, state, 1)) {
      this.incompleteCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    let result = PROOF_STATUS.DISPROVEN; let unknown = 0;
    let policyAction = ACTION.NONE; let policyArgument = NONE_CELL;
    for (let row = 0; row < this.ourCount[top]; row += 1) {
      const rowResult = this.proveRow(bundle, depth, top, row);
      if (rowResult === PROOF_STATUS.PROVEN) {
        result = PROOF_STATUS.PROVEN;
        policyAction = this.actionAt(top, 0, row);
        policyArgument = this.argumentAt(top, 0, row); break;
      }
      if (rowResult === PROOF_STATUS.UNKNOWN) unknown = 1;
    }
    if (result !== PROOF_STATUS.PROVEN && unknown) result = PROOF_STATUS.UNKNOWN;
    this.storeState(state, depth, result, policyAction, policyArgument);
    return result;
  }

  evaluateCandidate(bundle, rootAction, rootArgument, enemyActions,
      enemyArguments, enemyCount, maximumDepth = 4,
      nodeBudget = this.defaultNodeBudget, workUnitBudget = 0) {
    this.resetPolicy(nodeBudget);
    this.workUnitBudget = Number.isSafeInteger(workUnitBudget) && workUnitBudget > 0 ?
      workUnitBudget : 0;
    if (!bundle || !enemyActions || !enemyArguments || enemyCount < 1 ||
        enemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES || maximumDepth < 2 ||
        maximumDepth > 4 || nodeBudget < 1 || !this.visiblePhysical(bundle.state)) {
      this.lastStatus = PROOF_STATUS.UNKNOWN; return this.lastStatus;
    }
    const state = bundle.state;
    this.ourCount[0] = 1; this.ourActions[0] = rootAction;
    this.ourArguments[0] = rootArgument;
    this.rootDomainGenerationCount += 1;
    if (!this.generate(0, state, 1)) {
      this.rootDomainGenerationFailureCount += 1;
      this.lastStatus = PROOF_STATUS.UNKNOWN; return this.lastStatus;
    }
    const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    let sawUnknown = 0;
    for (let horizon = 2; horizon <= maximumDepth && this.nodes < this.nodeBudget;
      horizon += 1) {
      this.ttDepth.fill(0); this.ttStatus.fill(0);
      this.provenPolicyEntryCount = 0;
      const result = this.proveRow(bundle, horizon, 0, 0);
      if (result === PROOF_STATUS.PROVEN) {
        this.lastStatus = result; this.completedDepth = horizon; break;
      }
      if (result === PROOF_STATUS.UNKNOWN) sawUnknown = 1;
      else this.completedDepth = horizon;
      this.lastStatus = sawUnknown ? PROOF_STATUS.UNKNOWN : PROOF_STATUS.DISPROVEN;
    }
    state.undoTo(rootMark);
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== rootMark) {
      this.rootRestoreFailures += 1; this.lastStatus = PROOF_STATUS.UNKNOWN;
      this.completedDepth = 0;
    }
    if (this.nodes > this.maximumNodes) this.maximumNodes = this.nodes;
    return this.lastStatus;
  }
}

module.exports = { ATTACK_EVENT_TT_CAPACITY, ATTACK_EVENT_POLICY_CAPACITY,
  AttackEventPolicySearch, AttackEventPolicySnapshot };
