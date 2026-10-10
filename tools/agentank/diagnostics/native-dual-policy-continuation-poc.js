"use strict";

// BP30-A primitives for comparing complete continuation policies. Policy
// identity is part of state identity: equal PhysicalState hashes cannot share
// a transposition entry when their continuation policies differ.

const POLICY_ID = Object.freeze({ BASE: 1, ATTACK_POSE: 2 });
const POLICY_EVENT = Object.freeze({
  FIRE_EMITTED: 0, OWN_DEATH: 1, ENEMY_DEATH: 2, TERMINAL_WIN: 3,
  TERMINAL_LOSS: 4, TERMINAL_DRAW: 5, OPEN: 6, INCOMPLETE: 7
});
const POLICY_EVENT_DIMENSION = 8;
const TT_CAPACITY = 4096;
const TT_MASK = TT_CAPACITY - 1;

function mix32(hash, value) {
  hash = Math.imul((hash ^ (value >>> 0)) >>> 0, 0x45d9f3b) >>> 0;
  return (hash ^ hash >>> 16) >>> 0;
}
function eventBit(dimension) { return 1 << dimension; }

// Emission is neither a hit/kill/non-loss benefit nor a failure.
const BENEFIT_MASK = eventBit(POLICY_EVENT.ENEMY_DEATH) |
  eventBit(POLICY_EVENT.TERMINAL_WIN);
const FAILURE_MASK = eventBit(POLICY_EVENT.OWN_DEATH) |
  eventBit(POLICY_EVENT.TERMINAL_LOSS);

class PolicyIdentityTranspositionTablePoc {
  constructor() {
    this.stamp = new Uint16Array(TT_CAPACITY);
    this.hashLo = new Uint32Array(TT_CAPACITY);
    this.hashHi = new Uint32Array(TT_CAPACITY);
    this.remaining = new Uint8Array(TT_CAPACITY);
    this.policyId = new Uint8Array(TT_CAPACITY);
    this.outcome = new Uint8Array(TT_CAPACITY);
    this.mass = new Uint16Array(TT_CAPACITY * POLICY_EVENT_DIMENSION);
    this.epoch = 0; this.hitCount = 0; this.crossPolicyMissCount = 0;
    this.storeCount = 0; this.capacityFailureCount = 0;
    this.hotAllocationCount = 0;
  }
  nextEpoch() {
    this.epoch = (this.epoch + 1) & 0xffff;
    if (!this.epoch) { this.stamp.fill(0); this.epoch = 1; }
  }
  index(state, remaining, policyId) {
    let index = mix32(mix32(state.hashLo, state.hashHi ^ remaining), policyId) &
      TT_MASK;
    for (let probe = 0; probe < TT_CAPACITY; probe += 1) {
      if (this.stamp[index] !== this.epoch) return -index - 2;
      if (this.hashLo[index] === state.hashLo &&
          this.hashHi[index] === state.hashHi &&
          this.remaining[index] === remaining) {
        if (this.policyId[index] === policyId) {
          this.hitCount += 1; return index;
        }
        this.crossPolicyMissCount += 1;
      }
      index = (index + 1) & TT_MASK;
    }
    return -1;
  }
  store(state, remaining, policyId, outcome, sourceMass) {
    const found = this.index(state, remaining, policyId);
    if (found >= 0) return found;
    if (found === -1) { this.capacityFailureCount += 1; return -1; }
    const index = -found - 2;
    this.stamp[index] = this.epoch; this.hashLo[index] = state.hashLo;
    this.hashHi[index] = state.hashHi; this.remaining[index] = remaining;
    this.policyId[index] = policyId; this.outcome[index] = outcome;
    const offset = index * POLICY_EVENT_DIMENSION;
    for (let dimension = 0; dimension < POLICY_EVENT_DIMENSION; dimension += 1)
      this.mass[offset + dimension] = sourceMass[dimension];
    this.storeCount += 1; return index;
  }
}

class NativeDualPolicyContinuationPoc {
  constructor(basePolicy, attackPolicy) {
    this.basePolicy = basePolicy; this.attackPolicy = attackPolicy;
    this.tt = new PolicyIdentityTranspositionTablePoc();
    this.routeCount = new Uint32Array(3);
    this.routeIncompleteCount = new Uint32Array(3);
    this.hotAllocationCount = 0;
  }
  router(policyId) {
    if (policyId === POLICY_ID.BASE) return this.basePolicy;
    if (policyId === POLICY_ID.ATTACK_POSE) return this.attackPolicy;
    return null;
  }
  routeAction(state, policyId) {
    const router = this.router(policyId);
    if (!router || typeof router.routeAction !== "function") {
      if (policyId < this.routeIncompleteCount.length)
        this.routeIncompleteCount[policyId] += 1;
      return -1;
    }
    this.routeCount[policyId] += 1;
    return router.routeAction(state);
  }
}

// Integer, stateless-per-node V1-shaped continuation. Committed hazards are
// handled by the enclosing search before this router is called. The router
// then preserves V1's high-level order: direct initiative, preemptive dodge,
// and finally its attack/star/edge/facing intent mapping.
class NativeBasePolicyContinuationPoc {
  constructor(engine, intent) {
    this.engine = engine; this.intent = intent;
    this.routeCount = 0; this.directCount = 0; this.preemptiveCount = 0;
    this.intentCount = 0; this.incompleteCount = 0; this.hotAllocationCount = 0;
  }
  routeAction(state) {
    const engine = this.engine; const intent = this.intent;
    if (!engine || !intent || engine.adapter?.state !== state) {
      this.incompleteCount += 1; return -1;
    }
    this.routeCount += 1;
    let action = intent.directAttackAction(engine);
    if (action >= 0 && action !== 0) { this.directCount += 1; return action; }
    action = intent.preemptiveSafetyAction(engine);
    if (action >= 0 && action !== 0) {
      this.preemptiveCount += 1; return action;
    }
    const policyIntent = intent.proposedV1Exact(engine);
    action = intent.v1ActionForIntent(engine, policyIntent);
    if (action >= 0 && action !== 0) { this.intentCount += 1; return action; }
    this.incompleteCount += 1; return -1;
  }
}

// A fixed-memory continuation with an explicit combat-first strategic order.
// It supplies policy evidence only; it does not own a root action or add a
// combat constant to the leaf value.
class NativeCombatFirstContinuationPoc {
  constructor(engine, intent, attackPolicy) {
    this.engine = engine; this.intent = intent; this.attackPolicy = attackPolicy;
    this.routeCount = 0; this.directCount = 0; this.preemptiveCount = 0;
    this.attackCount = 0; this.strategicCount = 0; this.incompleteCount = 0;
    this.hotAllocationCount = 0;
  }
  routeAction(state) {
    const engine = this.engine; const intent = this.intent;
    if (!engine || !intent || engine.adapter?.state !== state) {
      this.incompleteCount += 1; return -1;
    }
    this.routeCount += 1;
    let action = intent.directAttackAction(engine);
    if (action > 0) { this.directCount += 1; return action; }
    action = intent.preemptiveSafetyAction(engine);
    if (action > 0) { this.preemptiveCount += 1; return action; }
    action = this.attackPolicy &&
        typeof this.attackPolicy.routeAction === "function" ?
      this.attackPolicy.routeAction(state) : -1;
    if (action > 0) { this.attackCount += 1; return action; }
    const policyIntent = intent.proposedV1Exact(engine);
    action = intent.v1ActionForIntent(engine, policyIntent);
    if (action > 0) { this.strategicCount += 1; return action; }
    this.incompleteCount += 1; return -1;
  }
}

module.exports = { POLICY_ID, POLICY_EVENT, POLICY_EVENT_DIMENSION,
  BENEFIT_MASK, FAILURE_MASK, eventBit,
  PolicyIdentityTranspositionTablePoc, NativeDualPolicyContinuationPoc,
  NativeBasePolicyContinuationPoc, NativeCombatFirstContinuationPoc };
