"use strict";

const { NativeDualPolicyResponseMassPoc } = require(
  "./native-dual-policy-response-mass-poc");
const { CANONICAL_REASON, CANONICAL_REASON_NAMES,
  PhysicalActionCanonicalizer } = require("./physical-action-canonicalizer");

const TABLE_CAPACITY = 1 << 19;
const TABLE_MASK = TABLE_CAPACITY - 1;
const MAX_PROBE = 64;

function mix32(left, right) {
  let value = Math.imul((left ^ right) >>> 0, 0x45d9f3b) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x119de1f3) >>> 0;
  return (value ^ value >>> 16) >>> 0;
}

function commandCode(ownAction, enemyAction, ownChance, enemyChance) {
  return (ownAction | enemyAction << 5 | ownChance << 10 |
    enemyChance << 12) >>> 0;
}

function argumentCode(ownArgument, enemyArgument) {
  return ((ownArgument & 0xffff) | (enemyArgument & 0xffff) << 16) >>> 0;
}

class NativeTransitionReuseCensusPoc extends NativeDualPolicyResponseMassPoc {
  constructor(mode = "off", options = {}) {
    super(mode, options);
    this.transitionObserver = this;
    this.requestUsed = new Uint8Array(TABLE_CAPACITY);
    this.requestParentLo = new Uint32Array(TABLE_CAPACITY);
    this.requestParentHi = new Uint32Array(TABLE_CAPACITY);
    this.requestCommand = new Uint16Array(TABLE_CAPACITY);
    this.requestArgument = new Uint32Array(TABLE_CAPACITY);
    this.requestPolicy = new Uint8Array(TABLE_CAPACITY);
    this.successorUsed = new Uint8Array(TABLE_CAPACITY);
    this.successorParentLo = new Uint32Array(TABLE_CAPACITY);
    this.successorParentHi = new Uint32Array(TABLE_CAPACITY);
    this.successorHashLo = new Uint32Array(TABLE_CAPACITY);
    this.successorHashHi = new Uint32Array(TABLE_CAPACITY);
    this.successorCommand = new Uint16Array(TABLE_CAPACITY);
    this.successorArgument = new Uint32Array(TABLE_CAPACITY);
    this.successorCanonicalCommand = new Uint16Array(TABLE_CAPACITY);
    this.successorCanonicalArgument = new Uint32Array(TABLE_CAPACITY);
    this.successorCanonicalReason = new Uint16Array(TABLE_CAPACITY);
    this.canonicalizer = new PhysicalActionCanonicalizer();
    this.canonicalReasonCount = new Uint32Array(CANONICAL_REASON_NAMES.length);
    this.transitionRequestCount = 0;
    this.transitionRequestUniqueCount = 0;
    this.transitionRequestRepeatCount = 0;
    this.transitionRequestCrossPolicyRepeatCount = 0;
    this.transitionRequestSamePolicyRepeatCount = 0;
    this.transitionRequestOverflowCount = 0;
    this.transitionRequestProbeCount = 0;
    this.successorObservationCount = 0;
    this.successorUniqueCount = 0;
    this.successorRepeatCount = 0;
    this.crossCommandSameSuccessorCount = 0;
    this.crossRequestSameSuccessorCount = 0;
    this.canonicalEquivalentSameSuccessorCount = 0;
    this.unexplainedSameSuccessorCount = 0;
    this.lastCanonicalCommand = 0;
    this.lastCanonicalArgument = 0;
    this.lastCanonicalReason = 0;
    this.lastRawArgument = 0;
    this.successorOverflowCount = 0;
    this.successorProbeCount = 0;
    this.deltaWriteCount = 0;
    this.repeatDeltaWriteCount = 0;
    this.maximumDeltaWrites = 0;
    this.lastRequestWasRepeat = 0;
  }

  requestIndex(parentLo, parentHi, command, argument) {
    let index = mix32(parentLo ^ command, parentHi ^ argument) & TABLE_MASK;
    for (let probe = 0; probe < MAX_PROBE; probe += 1) {
      this.transitionRequestProbeCount += 1;
      if (!this.requestUsed[index]) return -index - 1;
      if (this.requestParentLo[index] === parentLo &&
          this.requestParentHi[index] === parentHi &&
          this.requestCommand[index] === command &&
          this.requestArgument[index] === argument) return index;
      index = (index + 1) & TABLE_MASK;
    }
    return -TABLE_CAPACITY - 1;
  }

  observeTransitionRequest(parentLo, parentHi, ownAction, ownArgument,
      enemyAction, enemyArgument, ownChance, enemyChance, policyId, state) {
    this.transitionRequestCount += 1;
    const command = commandCode(ownAction, enemyAction, ownChance, enemyChance);
    const argument = argumentCode(ownArgument, enemyArgument);
    this.lastRawArgument = argument;
    if (state) {
      this.canonicalizer.canonicalize(state, ownAction, ownArgument,
        enemyAction, enemyArgument, ownChance, enemyChance);
      this.lastCanonicalCommand = this.canonicalizer.command;
      this.lastCanonicalArgument = this.canonicalizer.arguments;
      this.lastCanonicalReason = this.canonicalizer.reasonMask;
    } else {
      this.lastCanonicalCommand = command;
      this.lastCanonicalArgument = argument;
      this.lastCanonicalReason = 0;
    }
    const found = this.requestIndex(parentLo, parentHi, command, argument);
    if (found >= 0) {
      this.transitionRequestRepeatCount += 1;
      this.lastRequestWasRepeat = 1;
      if (this.requestPolicy[found] === policyId)
        this.transitionRequestSamePolicyRepeatCount += 1;
      else this.transitionRequestCrossPolicyRepeatCount += 1;
      return;
    }
    this.lastRequestWasRepeat = 0;
    if (found === -TABLE_CAPACITY - 1) {
      this.transitionRequestOverflowCount += 1; return;
    }
    const index = -found - 1;
    this.requestUsed[index] = 1;
    this.requestParentLo[index] = parentLo;
    this.requestParentHi[index] = parentHi;
    this.requestCommand[index] = command;
    this.requestArgument[index] = argument;
    this.requestPolicy[index] = policyId;
    this.transitionRequestUniqueCount += 1;
  }

  successorIndex(parentLo, parentHi, successorLo, successorHi) {
    let index = mix32(parentLo ^ successorHi, parentHi ^ successorLo) &
      TABLE_MASK;
    for (let probe = 0; probe < MAX_PROBE; probe += 1) {
      this.successorProbeCount += 1;
      if (!this.successorUsed[index]) return -index - 1;
      if (this.successorParentLo[index] === parentLo &&
          this.successorParentHi[index] === parentHi &&
          this.successorHashLo[index] === successorLo &&
          this.successorHashHi[index] === successorHi) return index;
      index = (index + 1) & TABLE_MASK;
    }
    return -TABLE_CAPACITY - 1;
  }

  observeTransitionSuccessor(parentLo, parentHi, ownAction, ownArgument,
      enemyAction, enemyArgument, ownChance, enemyChance, _policyId,
      state, mark) {
    this.successorObservationCount += 1;
    const command = commandCode(ownAction, enemyAction, ownChance, enemyChance);
    const deltaMark = (mark / 1024) | 0;
    const deltaWrites = state.deltaUsed - deltaMark;
    this.deltaWriteCount += deltaWrites;
    if (this.lastRequestWasRepeat) this.repeatDeltaWriteCount += deltaWrites;
    if (deltaWrites > this.maximumDeltaWrites)
      this.maximumDeltaWrites = deltaWrites;
    const found = this.successorIndex(parentLo, parentHi,
      state.hashLo, state.hashHi);
    if (found >= 0) {
      this.successorRepeatCount += 1;
      const crossRequest = this.successorCommand[found] !== command ||
        this.successorArgument[found] !== this.lastRawArgument;
      if (this.successorCommand[found] !== command)
        this.crossCommandSameSuccessorCount += 1;
      if (crossRequest) {
        this.crossRequestSameSuccessorCount += 1;
        if (this.successorCanonicalCommand[found] ===
              this.lastCanonicalCommand &&
            this.successorCanonicalArgument[found] ===
              this.lastCanonicalArgument) {
          this.canonicalEquivalentSameSuccessorCount += 1;
          const reasons = this.successorCanonicalReason[found] |
            this.lastCanonicalReason;
          for (let index = 0; index < CANONICAL_REASON_NAMES.length;
            index += 1)
            if (reasons & CANONICAL_REASON[CANONICAL_REASON_NAMES[index]])
              this.canonicalReasonCount[index] += 1;
        } else this.unexplainedSameSuccessorCount += 1;
      }
      return;
    }
    if (found === -TABLE_CAPACITY - 1) {
      this.successorOverflowCount += 1; return;
    }
    const index = -found - 1;
    this.successorUsed[index] = 1;
    this.successorParentLo[index] = parentLo;
    this.successorParentHi[index] = parentHi;
    this.successorHashLo[index] = state.hashLo;
    this.successorHashHi[index] = state.hashHi;
    this.successorCommand[index] = command;
    this.successorArgument[index] = this.lastRawArgument;
    this.successorCanonicalCommand[index] = this.lastCanonicalCommand;
    this.successorCanonicalArgument[index] = this.lastCanonicalArgument;
    this.successorCanonicalReason[index] = this.lastCanonicalReason;
    this.successorUniqueCount += 1;
  }

  summary() {
    return { ...super.summary(),
      semantics: "DUAL_POLICY_TRANSITION_REUSE_CENSUS",
      transitionReuseCensus: true,
      transitionTableCapacity: TABLE_CAPACITY,
      transitionRequestCount: this.transitionRequestCount,
      transitionRequestUniqueCount: this.transitionRequestUniqueCount,
      transitionRequestRepeatCount: this.transitionRequestRepeatCount,
      transitionRequestCrossPolicyRepeatCount:
        this.transitionRequestCrossPolicyRepeatCount,
      transitionRequestSamePolicyRepeatCount:
        this.transitionRequestSamePolicyRepeatCount,
      transitionRequestOverflowCount: this.transitionRequestOverflowCount,
      transitionRequestProbeCount: this.transitionRequestProbeCount,
      successorObservationCount: this.successorObservationCount,
      successorUniqueCount: this.successorUniqueCount,
      successorRepeatCount: this.successorRepeatCount,
      crossCommandSameSuccessorCount: this.crossCommandSameSuccessorCount,
      crossRequestSameSuccessorCount: this.crossRequestSameSuccessorCount,
      canonicalEquivalentSameSuccessorCount:
        this.canonicalEquivalentSameSuccessorCount,
      unexplainedSameSuccessorCount: this.unexplainedSameSuccessorCount,
      canonicalReasonNames: CANONICAL_REASON_NAMES,
      canonicalReasonCount: Array.from(this.canonicalReasonCount),
      successorOverflowCount: this.successorOverflowCount,
      successorProbeCount: this.successorProbeCount,
      deltaWriteCount: this.deltaWriteCount,
      repeatDeltaWriteCount: this.repeatDeltaWriteCount,
      maximumDeltaWrites: this.maximumDeltaWrites,
      transitionCensusHotAllocationCount: 0 };
  }
}

module.exports = { NativeTransitionReuseCensusPoc, TABLE_CAPACITY,
  commandCode, argumentCode };
