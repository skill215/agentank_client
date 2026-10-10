"use strict";

// Behavior-neutral, exact-physical attack-policy reachability.
//
// This is deliberately narrower than InformationSearch.  It proves an
// observation-contingent policy only while every successor remains a fully
// visible PhysicalState.  Hidden/cloaked/grass states and unsupported action
// families return UNKNOWN.  A leaf is successful only after an irreversible
// attack event (enemy crash or enemy shield hit).  A newly extended debuff is
// a goal only when the root itself is the debuff skill: global stun/poison
// after an arbitrary setup move does not make that move causally useful.
// Posture, a possible hit, and a live projectile are not goals.

const { ProductionForcedWinSearch } = require(
  "../../../engine-v2/src/search/production-forced-win-search");
const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, EVENT, FAST_STATUS, HARD_STATUS, TERMINAL, TERRAIN,
  NONE_FRAME, NONE_CELL } = require("../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");

const ATTACK_POLICY_GOAL = Object.freeze({
  NONE: 0,
  ENEMY_CRASH: 1,
  SHIELD_HIT: 2,
  DEBUFF: 4
});

const ATTACK_POLICY_SKIP = Object.freeze({
  NONE: 0,
  NOT_SETUP_MOVE: 1 << 0,
  ROOT_HIDDEN: 1 << 1,
  TRACKING_INCOMPLETE: 1 << 2,
  POSSIBLE_PROJECTILE: 1 << 3,
  ROOT_SUPPORT: 1 << 4
});

// The policy table must be able to retain the winning action after recursive
// proof returns. A smaller table can prove a root while silently losing its
// executable continuation because descendants filled every slot first.
const POLICY_TT_CAPACITY = 2048;
const STATUS_FIELD_FIRST = ARRAY.TANK_SKILL;
const STATUS_FIELD_COUNT = ARRAY.TANK_BOMB_READY - STATUS_FIELD_FIRST + 1;
const SEMANTIC_SCALARS = Object.freeze([SCALAR.FRAME, SCALAR.TERRAIN_VERSION,
  SCALAR.TOPOLOGY_VERSION, SCALAR.STAR_CELL, SCALAR.TIMEOUT_SEAT,
  SCALAR.SCRIPT_ERROR_SEAT, SCALAR.TERMINAL_CODE, SCALAR.WINNER_SEAT]);

class AttackPolicyContinuationTable {
  constructor(capacity = 64) {
    this.capacity = capacity;
    this.semanticLo = new Uint32Array(capacity);
    this.semanticHi = new Uint32Array(capacity);
    this.depth = new Uint8Array(capacity);
    this.action = new Uint8Array(capacity);
    this.argument = new Uint16Array(capacity);
    this.count = 0; this.complete = 0; this.actionResult = ACTION.NONE;
    this.argumentResult = NONE_CELL; this.captureCount = 0;
    this.overflowCount = 0; this.lookupCount = 0; this.hitCount = 0;
    this.maximumEntries = 0;
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
        this.actionResult = this.action[at];
        this.argumentResult = this.argument[at];
        this.hitCount += 1; return 1;
      }
    return 0;
  }
}

class AttackPolicyReachabilitySearch extends ProductionForcedWinSearch {
  constructor(nodeBudget = 4096, options = {}) {
    super(null);
    this.defaultNodeBudget = nodeBudget;
    this.allowDebuffGoal = options.allowDebuffGoal !== false;
    this.completeRootEnemyDomain = options.completeRootEnemyDomain === true;
    this.allowedGoalMask = Number.isSafeInteger(options.allowedGoalMask) ?
      options.allowedGoalMask : (ATTACK_POLICY_GOAL.ENEMY_CRASH |
        ATTACK_POLICY_GOAL.SHIELD_HIT | ATTACK_POLICY_GOAL.DEBUFF);
    this.ttLo = new Uint32Array(POLICY_TT_CAPACITY);
    this.ttHi = new Uint32Array(POLICY_TT_CAPACITY);
    this.ttDepth = new Uint8Array(POLICY_TT_CAPACITY);
    this.ttStatus = new Uint8Array(POLICY_TT_CAPACITY);
    this.ttPolicyAction = new Uint8Array(POLICY_TT_CAPACITY);
    this.ttPolicyArgument = new Uint16Array(POLICY_TT_CAPACITY);
    this.ttSemanticLo = new Uint32Array(POLICY_TT_CAPACITY);
    this.ttSemanticHi = new Uint32Array(POLICY_TT_CAPACITY);
    this.ttPoseKey = new Uint32Array(POLICY_TT_CAPACITY);
    this.ttStatusKey = new Uint32Array(POLICY_TT_CAPACITY);
    this.ttProjectileKey = new Uint32Array(POLICY_TT_CAPACITY);
    this.ttBombKey = new Uint32Array(POLICY_TT_CAPACITY);
    this.ttScalarKey = new Uint32Array(POLICY_TT_CAPACITY);
    this.ttStatusFieldKey = new Uint32Array(POLICY_TT_CAPACITY * STATUS_FIELD_COUNT);
    this.semanticStatusFieldKey = new Uint32Array(STATUS_FIELD_COUNT);
    this.ttStunUntil0 = new Uint16Array(POLICY_TT_CAPACITY);
    this.ttStunUntil1 = new Uint16Array(POLICY_TT_CAPACITY);
    this.ttBombReady0 = new Uint16Array(POLICY_TT_CAPACITY);
    this.ttBombReady1 = new Uint16Array(POLICY_TT_CAPACITY);
    this.goalLeafCounts = new Uint32Array(3);
    this.horizonStatus = new Uint8Array(5);
    this.horizonNodes = new Uint32Array(5);
    this.goalMask = 0; this.ttHits = 0; this.ttStores = 0;
    this.ttCapacityStops = 0; this.hiddenStops = 0;
    this.unsupportedGenerationStops = 0; this.hardRejects = 0;
    this.hardIncompleteStops = 0; this.maximumNodes = 0;
    this.poisonHoldTransitionCount = 0;
    this.rootDomainGenerationCount = 0;
    this.rootDomainGenerationFailureCount = 0;
    this.policyAction = ACTION.NONE; this.policyArgument = NONE_CELL;
    this.policyLookupKind = 0;
    this.provenPolicyEntryCount = 0;
  }

  resetPolicy(nodeBudget) {
    this.resetRoot(); this.nodeBudget = nodeBudget;
    this.goalMask = 0; this.ttHits = 0; this.ttStores = 0;
    this.ttCapacityStops = 0; this.hiddenStops = 0;
    this.unsupportedGenerationStops = 0; this.hardRejects = 0;
    this.hardIncompleteStops = 0;
    this.poisonHoldTransitionCount = 0;
    this.goalLeafCounts.fill(0); this.horizonStatus.fill(PROOF_STATUS.UNKNOWN);
    this.horizonNodes.fill(0); this.ttDepth.fill(0); this.ttStatus.fill(0);
    this.provenPolicyEntryCount = 0;
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

  transitionGoal(state, eventStart) {
    let goal = ATTACK_POLICY_GOAL.NONE;
    for (let at = eventStart; at < state.eventUsed; at += 1) {
      if (state.eventEntity[at] !== 2) continue;
      if (state.eventType[at] === EVENT.TANK_CRASHED)
        goal |= ATTACK_POLICY_GOAL.ENEMY_CRASH;
      else if (state.eventType[at] === EVENT.SHIELD_HIT)
        goal |= ATTACK_POLICY_GOAL.SHIELD_HIT;
    }
    const frozen = state.arrays[ARRAY.TANK_FROZEN_UNTIL][1];
    const stunned = state.arrays[ARRAY.TANK_STUN_UNTIL][1];
    const poisoned = state.arrays[ARRAY.TANK_POISON_UNTIL][1];
    const rootDebuff = this.rootAction === ACTION.CAST_FREEZE ||
      this.rootAction === ACTION.CAST_STUN || this.rootAction === ACTION.CAST_POISON;
    if (this.allowDebuffGoal && rootDebuff &&
        ((frozen !== NONE_FRAME && (this.rootFrozenUntil === NONE_FRAME ||
          frozen > this.rootFrozenUntil)) ||
        (stunned !== NONE_FRAME && (this.rootStunUntil === NONE_FRAME ||
          stunned > this.rootStunUntil)) ||
        (poisoned !== NONE_FRAME && (this.rootPoisonUntil === NONE_FRAME ||
          poisoned > this.rootPoisonUntil))))
      goal |= ATTACK_POLICY_GOAL.DEBUFF;
    return goal;
  }

  observeGoal(goal) {
    this.goalMask |= goal;
    if (goal & ATTACK_POLICY_GOAL.ENEMY_CRASH) this.goalLeafCounts[0] += 1;
    if (goal & ATTACK_POLICY_GOAL.SHIELD_HIT) this.goalLeafCounts[1] += 1;
    if (goal & ATTACK_POLICY_GOAL.DEBUFF) this.goalLeafCounts[2] += 1;
  }

  ttSlot(state, depth) {
    let slot = (state.hashLo ^ ((state.hashHi << 7) | (state.hashHi >>> 25)) ^
      (depth * 0x9e3779b9)) & (POLICY_TT_CAPACITY - 1);
    for (let probe = 0; probe < POLICY_TT_CAPACITY; probe += 1) {
      if (!this.ttDepth[slot] || (this.ttDepth[slot] === depth &&
          this.ttLo[slot] === state.hashLo && this.ttHi[slot] === state.hashHi)) return slot;
      slot = (slot + 1) & (POLICY_TT_CAPACITY - 1);
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
    this.ttPolicyAction[slot] = action;
    this.ttPolicyArgument[slot] = argument;
    this.semanticKey(state);
    this.ttSemanticLo[slot] = this.semanticLo;
    this.ttSemanticHi[slot] = this.semanticHi;
    this.ttPoseKey[slot] = this.semanticPose;
    this.ttStatusKey[slot] = this.semanticStatus;
    this.ttProjectileKey[slot] = this.semanticProjectile;
    this.ttBombKey[slot] = this.semanticBomb;
    this.ttScalarKey[slot] = this.semanticScalar;
    const statusBase = slot * STATUS_FIELD_COUNT;
    for (let field = 0; field < STATUS_FIELD_COUNT; field += 1)
      this.ttStatusFieldKey[statusBase + field] = this.semanticStatusFieldKey[field];
    this.ttStunUntil0[slot] = state.arrays[ARRAY.TANK_STUN_UNTIL][0];
    this.ttStunUntil1[slot] = state.arrays[ARRAY.TANK_STUN_UNTIL][1];
    this.ttBombReady0[slot] = state.arrays[ARRAY.TANK_BOMB_READY][0];
    this.ttBombReady1[slot] = state.arrays[ARRAY.TANK_BOMB_READY][1];
    this.ttStores += 1;
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
    const a = state.arrays;
    let lo = this.mix(state.width | (state.height << 8));
    let hi = this.mix((state.height | (state.width << 8)) ^ 0x9e3779b9);
    let pose = 0; let status = 0; let projectile = 0; let bomb = 0; let scalarKey = 0;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    this.semanticStatusFieldKey.fill(0);
    for (let id = ARRAY.TANK_CELL; id <= ARRAY.TANK_BOMB_READY; id += 1) {
      if (id === ARRAY.TANK_RUNTIME) continue;
      const array = a[id];
      for (let index = 0; index < array.length; index += 1) {
        let value = array[index];
        // Absolute cooldown endpoints can differ between the local simulator
        // and platform evidence while still being behaviorally identical over
        // this <=4-frame proof. Preserve every readiness distinction inside
        // the proof window and collapse only values beyond it.
        value = this.semanticStatusValue(id, index, value, a, frame);
        const token = ((id + 1) * 0x10001 + index * 0x101 + value) >>> 0;
        lo = (lo ^ this.mix(token)) >>> 0;
        hi = (hi + this.mix(token ^ 0xa5a5a5a5)) >>> 0;
        if (id <= ARRAY.TANK_STARS) pose = (pose ^ this.mix(token)) >>> 0;
        else {
          const mixed = this.mix(token);
          status = (status ^ mixed) >>> 0;
          this.semanticStatusFieldKey[id - STATUS_FIELD_FIRST] =
            (this.semanticStatusFieldKey[id - STATUS_FIELD_FIRST] ^ mixed) >>> 0;
        }
      }
    }
    const scalar = a[ARRAY.SCALAR];
    for (let at = 0; at < SEMANTIC_SCALARS.length; at += 1) {
      const index = SEMANTIC_SCALARS[at];
      const token = (0x51ed0000 + index * 0x101 + scalar[index]) >>> 0;
      lo = (lo ^ this.mix(token)) >>> 0;
      hi = (hi + this.mix(token ^ 0x3c6ef372)) >>> 0;
      scalarKey = (scalarKey ^ this.mix(token)) >>> 0;
    }
    for (let slot = 0; slot < a[ARRAY.PROJECTILE_ACTIVE].length; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot]) continue;
      const token = (a[ARRAY.PROJECTILE_OWNER][slot] |
        (a[ARRAY.PROJECTILE_CELL][slot] << 2) |
        (a[ARRAY.PROJECTILE_DIR][slot] << 14) |
        (a[ARRAY.PROJECTILE_MEMBER][slot] << 18)) >>> 0;
      lo = (lo + this.mix(token ^ 0x243f6a88)) >>> 0;
      hi = (hi + this.mix(token ^ 0x85a308d3)) >>> 0;
      projectile = (projectile + this.mix(token ^ 0x243f6a88)) >>> 0;
    }
    for (let slot = 0; slot < a[ARRAY.BOMB_ACTIVE].length; slot += 1) {
      if (!a[ARRAY.BOMB_ACTIVE][slot]) continue;
      const token = (a[ARRAY.BOMB_OWNER][slot] |
        (a[ARRAY.BOMB_CELL][slot] << 2) |
        (a[ARRAY.BOMB_EXPLODE][slot] << 14)) >>> 0;
      lo = (lo + this.mix(token ^ 0x13198a2e)) >>> 0;
      hi = (hi + this.mix(token ^ 0x03707344)) >>> 0;
      bomb = (bomb + this.mix(token ^ 0x13198a2e)) >>> 0;
    }
    this.semanticLo = lo; this.semanticHi = hi;
    this.semanticPose = pose; this.semanticStatus = status;
    this.semanticProjectile = projectile; this.semanticBomb = bomb;
    this.semanticScalar = scalarKey;
  }

  generate(top, state, seat) {
    const supported = super.generate(top, state, seat);
    if (!supported) this.unsupportedGenerationStops += 1;
    return supported;
  }

  proveOutcome(bundle, depth, top, action0, argument0, action1, argument1,
      chance0, chance1) {
    if (this.nodes >= this.nodeBudget) {
      this.budgetStopCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const state = bundle.state;
    const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const poisonUntil = state.arrays[ARRAY.TANK_POISON_UNTIL][1];
    const poisonApplied = state.arrays[ARRAY.TANK_POISON_APPLIED][1];
    if (poisonUntil !== NONE_FRAME && poisonUntil > frame &&
        poisonApplied !== NONE_FRAME && ((frame - poisonApplied) & 1) !== 0)
      this.poisonHoldTransitionCount += 1;
    const status = bundle.kernel.applyFrame(action0, argument0, action1, argument1,
      chance0, chance1);
    this.nodes += 1;
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
      this.incompleteCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const mark = bundle.kernel.lastMark;
    const deltaMark = (mark / 1024) | 0;
    const eventStart = mark - deltaMark * 1024;
    let result;
    const terminal = state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    const hard = bundle.hard.classifyApplied();
    if (hard === HARD_STATUS.INCOMPLETE) {
      this.hardIncompleteStops += 1; result = PROOF_STATUS.UNKNOWN;
    } else if (hard !== HARD_STATUS.ALLOW || state.arrays[ARRAY.TANK_CRASH][0]) {
      this.hardRejects += 1; result = PROOF_STATUS.DISPROVEN;
    } else if (terminal === TERMINAL.WIN1 || terminal === TERMINAL.DRAW) {
      result = PROOF_STATUS.DISPROVEN;
    } else {
      const goal = this.transitionGoal(state, eventStart);
      if (goal & this.allowedGoalMask) {
        this.observeGoal(goal); result = PROOF_STATUS.PROVEN;
      }
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
        policyArgument = this.argumentAt(top, 0, row);
        break;
      }
      if (rowResult === PROOF_STATUS.UNKNOWN) unknown = 1;
    }
    if (result !== PROOF_STATUS.PROVEN && unknown)
      result = PROOF_STATUS.UNKNOWN;
    this.storeState(state, depth, result, policyAction, policyArgument);
    return result;
  }

  policyFor(state, depth) {
    this.policyLookupKind = 0;
    this.policyMismatchMask = 0; this.policyStatusMismatchMask = 0;
    this.policyCandidateEntryCount = 0;
    if (!state || depth < 1) return 0;
    const slot = this.ttSlot(state, depth);
    if (slot >= 0 && this.ttDepth[slot] === depth &&
        this.ttLo[slot] === state.hashLo && this.ttHi[slot] === state.hashHi &&
        this.ttStatus[slot] === PROOF_STATUS.PROVEN) {
      this.policyAction = this.ttPolicyAction[slot];
      this.policyArgument = this.ttPolicyArgument[slot];
      this.policyLookupKind = 1; return 1;
    }
    this.semanticKey(state);
    for (let index = 0; index < POLICY_TT_CAPACITY; index += 1)
      if (this.ttDepth[index] === depth &&
          this.ttStatus[index] === PROOF_STATUS.PROVEN &&
          this.ttSemanticLo[index] === this.semanticLo &&
          this.ttSemanticHi[index] === this.semanticHi) {
        this.policyAction = this.ttPolicyAction[index];
        this.policyArgument = this.ttPolicyArgument[index];
        this.policyLookupKind = 2; return 1;
      }
    let bestBits = 6; let bestMask = 0; let bestIndex = -1;
    for (let index = 0; index < POLICY_TT_CAPACITY; index += 1) {
      if (this.ttDepth[index] !== depth ||
          this.ttStatus[index] !== PROOF_STATUS.PROVEN) continue;
      this.policyCandidateEntryCount += 1;
      let mask = 0;
      if (this.ttPoseKey[index] !== this.semanticPose) mask |= 1;
      if (this.ttStatusKey[index] !== this.semanticStatus) mask |= 2;
      if (this.ttProjectileKey[index] !== this.semanticProjectile) mask |= 4;
      if (this.ttBombKey[index] !== this.semanticBomb) mask |= 8;
      if (this.ttScalarKey[index] !== this.semanticScalar) mask |= 16;
      let bits = 0; for (let value = mask; value; value >>>= 1) bits += value & 1;
      if (bits < bestBits) { bestBits = bits; bestMask = mask; bestIndex = index; }
    }
    this.policyMismatchMask = bestMask;
    if (bestIndex >= 0 && (bestMask & 2)) {
      const base = bestIndex * STATUS_FIELD_COUNT;
      for (let field = 0; field < STATUS_FIELD_COUNT; field += 1)
        if (this.ttStatusFieldKey[base + field] !==
            this.semanticStatusFieldKey[field])
          this.policyStatusMismatchMask |= 1 << field;
      this.policyExpectedStunUntil0 = this.ttStunUntil0[bestIndex];
      this.policyExpectedStunUntil1 = this.ttStunUntil1[bestIndex];
      this.policyExpectedBombReady0 = this.ttBombReady0[bestIndex];
      this.policyExpectedBombReady1 = this.ttBombReady1[bestIndex];
      this.policyActualStunUntil0 = state.arrays[ARRAY.TANK_STUN_UNTIL][0];
      this.policyActualStunUntil1 = state.arrays[ARRAY.TANK_STUN_UNTIL][1];
      this.policyActualBombReady0 = state.arrays[ARRAY.TANK_BOMB_READY][0];
      this.policyActualBombReady1 = state.arrays[ARRAY.TANK_BOMB_READY][1];
    }
    return 0;
  }

  evaluateCandidate(bundle, rootAction, rootArgument, enemyActions,
      enemyArguments, enemyCount, maximumDepth = 4, nodeBudget = this.defaultNodeBudget) {
    this.resetPolicy(nodeBudget);
    if (!bundle || !enemyActions || !enemyArguments || enemyCount < 1 ||
        enemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES || maximumDepth < 2 ||
        maximumDepth > 4 || nodeBudget < 1 || !this.visiblePhysical(bundle.state)) {
      this.lastStatus = PROOF_STATUS.UNKNOWN; return this.lastStatus;
    }
    const state = bundle.state; const a = state.arrays;
    this.rootFrozenUntil = a[ARRAY.TANK_FROZEN_UNTIL][1];
    this.rootStunUntil = a[ARRAY.TANK_STUN_UNTIL][1];
    this.rootPoisonUntil = a[ARRAY.TANK_POISON_UNTIL][1];
    this.rootAction = rootAction;
    this.ourCount[0] = 1; this.ourActions[0] = rootAction;
    this.ourArguments[0] = rootArgument;
    if (this.completeRootEnemyDomain) {
      this.rootDomainGenerationCount += 1;
      if (!this.generate(0, bundle.state, 1)) {
        this.rootDomainGenerationFailureCount += 1;
        this.lastStatus = PROOF_STATUS.UNKNOWN; return this.lastStatus;
      }
    } else {
      this.enemyCount[0] = enemyCount;
      for (let column = 0; column < enemyCount; column += 1) {
        this.enemyActions[column] = enemyActions[column];
        this.enemyArguments[column] = enemyArguments[column];
      }
    }
    const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    let sawUnknown = 0;
    for (let horizon = 2; horizon <= maximumDepth && this.nodes < this.nodeBudget;
      horizon += 1) {
      this.ttDepth.fill(0); this.ttStatus.fill(0);
      this.provenPolicyEntryCount = 0;
      const before = this.nodes; const result = this.proveRow(bundle, horizon, 0, 0);
      this.horizonStatus[horizon] = result;
      this.horizonNodes[horizon] = this.nodes - before;
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

class AttackPolicyReachabilityShadow {
  constructor(interval, search = null, maximumDepth = 4, nodeBudget = 4096) {
    this.interval = interval;
    this.search = search || new AttackPolicyReachabilitySearch(nodeBudget);
    this.maximumDepth = maximumDepth; this.nodeBudget = nodeBudget;
    this.statusByDepth = new Uint32Array(5 * 3);
    this.goalLeafCounts = new Uint32Array(3);
    this.candidateByAction = new Uint32Array(256);
    this.provenByAction = new Uint32Array(256);
    this.observationCount = 0; this.eventEvaluationCount = 0;
    this.duplicateSkipCount = 0; this.candidateRowCount = 0;
    this.provenRowCount = 0; this.disprovenRowCount = 0;
    this.unknownRowCount = 0; this.rootWithProofCount = 0;
    this.rootHiddenSkipCount = 0; this.trackingSkipCount = 0;
    this.possibleProjectileSkipCount = 0; this.supportSkipCount = 0;
    this.nodeCount = 0; this.maximumNodes = 0; this.ttHits = 0;
    this.ttStores = 0; this.hiddenStops = 0; this.budgetStops = 0;
    this.incompleteStops = 0; this.hardRejects = 0;
    this.rootRestoreFailures = 0; this.lastEvaluationSerial = 0;
    this.hotAllocationCount = 0;
  }

  setupPrimitive(action) {
    return action === ACTION.GO || action === ACTION.TURN_LEFT ||
      action === ACTION.TURN_RIGHT ? 1 : 0;
  }

  observe(engine) {
    this.observationCount += 1;
    if (!this.interval || this.interval.evaluationSerial === this.lastEvaluationSerial) {
      this.duplicateSkipCount += 1; return;
    }
    this.lastEvaluationSerial = this.interval.evaluationSerial;
    if (!engine || !engine.adapter || !engine.adapter.bundle) return;
    this.eventEvaluationCount += 1;
    if (!engine.adapter.enemyVisible) { this.rootHiddenSkipCount += 1; return; }
    if (!engine.adapter.tracker || !engine.adapter.tracker.complete) {
      this.trackingSkipCount += 1; return;
    }
    if (engine.possibleProjectiles && engine.possibleProjectiles.count() > 0) {
      this.possibleProjectileSkipCount += 1; return;
    }
    if (!engine.hiddenSupportComplete || engine.hiddenWorldCount !== 1 ||
        engine.hiddenWorldMass[0] !== 10000 || engine.enemyCount < 1) {
      this.supportSkipCount += 1; return;
    }
    const risk = engine.riskController && engine.riskController.outcome;
    let rootProven = 0;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (engine.hardStatus[row] !== HARD_STATUS.ALLOW || !risk ||
          row >= risk.count || !risk.acceptable[row] || risk.dominated[row] ||
          !this.setupPrimitive(engine.ourActions[row])) continue;
      this.candidateRowCount += 1; this.candidateByAction[engine.ourActions[row]] += 1;
      const result = this.search.evaluateCandidate(engine.adapter.bundle,
        engine.ourActions[row], engine.ourArguments[row], engine.enemyActions,
        engine.enemyArguments, engine.enemyCount, this.maximumDepth, this.nodeBudget);
      this.nodeCount += this.search.nodes;
      if (this.search.nodes > this.maximumNodes) this.maximumNodes = this.search.nodes;
      this.ttHits += this.search.ttHits; this.ttStores += this.search.ttStores;
      this.hiddenStops += this.search.hiddenStops;
      this.budgetStops += this.search.budgetStopCount;
      this.incompleteStops += this.search.incompleteCount +
        this.search.hardIncompleteStops + this.search.unsupportedGenerationStops;
      this.hardRejects += this.search.hardRejects;
      this.rootRestoreFailures += this.search.rootRestoreFailures;
      for (let goal = 0; goal < 3; goal += 1)
        this.goalLeafCounts[goal] += this.search.goalLeafCounts[goal];
      for (let depth = 2; depth <= 4; depth += 1) {
        if (!this.search.horizonNodes[depth]) continue;
        const status = this.search.horizonStatus[depth];
        this.statusByDepth[depth * 3 + (status === PROOF_STATUS.PROVEN ? 0 :
          status === PROOF_STATUS.DISPROVEN ? 1 : 2)] += 1;
      }
      if (result === PROOF_STATUS.PROVEN) {
        this.provenRowCount += 1; this.provenByAction[engine.ourActions[row]] += 1;
        rootProven = 1;
      } else if (result === PROOF_STATUS.DISPROVEN) this.disprovenRowCount += 1;
      else this.unknownRowCount += 1;
    }
    if (rootProven) this.rootWithProofCount += 1;
  }

  sparseActions(values) {
    const output = {};
    for (let action = 0; action < values.length; action += 1)
      if (values[action]) output[action] = values[action];
    return output;
  }

  summary() {
    return { enabled: true, behaviorNeutral: true, physicalOnly: true,
      observationContingent: true, maximumDepth: this.maximumDepth,
      nodeBudget: this.nodeBudget, observationCount: this.observationCount,
      eventEvaluationCount: this.eventEvaluationCount,
      duplicateSkipCount: this.duplicateSkipCount,
      candidateRowCount: this.candidateRowCount, provenRowCount: this.provenRowCount,
      disprovenRowCount: this.disprovenRowCount, unknownRowCount: this.unknownRowCount,
      rootWithProofCount: this.rootWithProofCount,
      rootHiddenSkipCount: this.rootHiddenSkipCount,
      trackingSkipCount: this.trackingSkipCount,
      possibleProjectileSkipCount: this.possibleProjectileSkipCount,
      supportSkipCount: this.supportSkipCount,
      nodeCount: this.nodeCount, maximumNodes: this.maximumNodes,
      ttHits: this.ttHits, ttStores: this.ttStores,
      hiddenStops: this.hiddenStops, budgetStops: this.budgetStops,
      incompleteStops: this.incompleteStops, hardRejects: this.hardRejects,
      rootRestoreFailures: this.rootRestoreFailures,
      lastEvaluationSerial: this.lastEvaluationSerial,
      statusByDepth: Array.from(this.statusByDepth),
      goalLeafCounts: Array.from(this.goalLeafCounts),
      candidateByAction: this.sparseActions(this.candidateByAction),
      provenByAction: this.sparseActions(this.provenByAction),
      hotAllocationCount: this.hotAllocationCount + this.search.hotAllocationCount };
  }
}

module.exports = { ATTACK_POLICY_GOAL, ATTACK_POLICY_SKIP,
  AttackPolicyContinuationTable, AttackPolicyReachabilitySearch,
  AttackPolicyReachabilityShadow };
