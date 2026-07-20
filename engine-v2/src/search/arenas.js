"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { PROBABILITY_SCALE, NONE_NODE, POLICY_FLAG, PROOF_COVERAGE_REQUIRED,
  PROOF_STATUS } = require("../abi/search-codes");

class PolicyArena {
  constructor(options = {}) {
    this.maxPolicies = options.maxPolicies || SEARCH_CAPACITY.MAX_POLICIES;
    this.maxEntries = options.maxEntries || SEARCH_CAPACITY.MAX_POLICY_ENTRIES;
    this.generation = new Uint16Array(this.maxPolicies);
    this.entryStart = new Uint16Array(this.maxPolicies); this.entryCount = new Uint8Array(this.maxPolicies);
    this.flags = new Uint8Array(this.maxPolicies); this.cumulativeEnd = new Uint16Array(this.maxPolicies);
    this.keyLo = new Uint32Array(this.maxPolicies); this.keyHi = new Uint32Array(this.maxPolicies);
    this.action = new Uint16Array(this.maxEntries); this.probability = new Uint16Array(this.maxEntries);
    this.cumulative = new Uint16Array(this.maxEntries);
    this.policyUsed = 0; this.entryUsed = 0; this.highWaterPolicy = 0; this.highWaterEntry = 0;
    this.hotAllocationCount = 0;
  }

  mark() { return this.policyUsed * 1024 + this.entryUsed; }
  rewind(mark) {
    this.policyUsed = Math.floor(mark / 1024); this.entryUsed = mark - this.policyUsed * 1024;
  }
  write(actions, probabilities, count, flags = 0) {
    if (count < 1 || this.policyUsed >= this.maxPolicies || this.entryUsed + count > this.maxEntries)
      return NONE_NODE;
    let total = 0; for (let index = 0; index < count; index += 1) total += probabilities[index];
    if (total !== PROBABILITY_SCALE) return NONE_NODE;
    const slot = this.policyUsed++; const start = this.entryUsed; this.entryStart[slot] = start;
    this.entryCount[slot] = count; this.flags[slot] = flags ||
      (count === 1 ? POLICY_FLAG.DETERMINISTIC : POLICY_FLAG.MIXED);
    let cumulative = 0; let lo = 0x811c9dc5; let hi = 0x9e3779b9;
    for (let index = 0; index < count; index += 1) {
      const at = this.entryUsed++; const action = actions[index]; const probability = probabilities[index];
      cumulative += probability; this.action[at] = action; this.probability[at] = probability;
      this.cumulative[at] = cumulative; lo = ((lo ^ action) * 16777619) >>> 0;
      hi = ((hi ^ probability ^ (action << 16)) * 2246822519) >>> 0;
    }
    this.cumulativeEnd[slot] = cumulative; this.keyLo[slot] = lo; this.keyHi[slot] = hi;
    this.generation[slot] = (this.generation[slot] + 1) & 0xffff;
    if (this.policyUsed > this.highWaterPolicy) this.highWaterPolicy = this.policyUsed;
    if (this.entryUsed > this.highWaterEntry) this.highWaterEntry = this.entryUsed;
    return slot;
  }
}

class CoverageArena {
  constructor(options = {}) {
    this.capacity = options.capacity || SEARCH_CAPACITY.MAX_COVERAGE_RECORDS;
    this.generation = new Uint16Array(this.capacity); this.proofGoal = new Uint8Array(this.capacity);
    this.proofStatus = new Uint8Array(this.capacity); this.mask = new Uint16Array(this.capacity);
    this.assumptionMask = new Uint16Array(this.capacity); this.nodeCount = new Uint16Array(this.capacity);
    this.actionCount = new Uint16Array(this.capacity); this.worldCount = new Uint16Array(this.capacity);
    this.chanceCount = new Uint16Array(this.capacity); this.enemyPolicyCount = new Uint16Array(this.capacity);
    this.observationCount = new Uint16Array(this.capacity); this.traceLo = new Uint32Array(this.capacity);
    this.traceHi = new Uint32Array(this.capacity); this.used = 0; this.hotAllocationCount = 0;
  }
  write(goal, status, mask, assumptionMask, counts, traceLo, traceHi) {
    if (this.used >= this.capacity) return NONE_NODE; const slot = this.used++;
    this.generation[slot] = (this.generation[slot] + 1) & 0xffff;
    this.proofGoal[slot] = goal; this.proofStatus[slot] = status; this.mask[slot] = mask;
    this.assumptionMask[slot] = assumptionMask; this.nodeCount[slot] = counts[0];
    this.actionCount[slot] = counts[1]; this.worldCount[slot] = counts[2];
    this.chanceCount[slot] = counts[3]; this.enemyPolicyCount[slot] = counts[4];
    this.observationCount[slot] = counts[5]; this.traceLo[slot] = traceLo; this.traceHi[slot] = traceHi;
    return slot;
  }
  isStrict(slot) {
    return slot !== NONE_NODE &&
      (this.mask[slot] & PROOF_COVERAGE_REQUIRED) === PROOF_COVERAGE_REQUIRED &&
      this.assumptionMask[slot] === 0 && this.proofStatus[slot] === PROOF_STATUS.PROVEN;
  }
}

module.exports = { PolicyArena, CoverageArena };
