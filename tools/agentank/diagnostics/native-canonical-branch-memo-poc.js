"use strict";

const { NativeDualPolicyResponseMassPoc } = require(
  "./native-dual-policy-response-mass-poc");
const { PhysicalActionCanonicalizer } = require(
  "./physical-action-canonicalizer");
const { MASS_DIMENSION } = require("./native-long-option-response-mass-poc");

const FRAME_SLOTS = 10;
const CANONICAL_WIDTH = 96;
const CANONICAL_CAPACITY = FRAME_SLOTS * CANONICAL_WIDTH;

class NativeCanonicalBranchMemoPoc extends NativeDualPolicyResponseMassPoc {
  constructor(mode = "off", options = {}) {
    super(mode, options);
    this.transitionObserver = this;
    this.canonicalizer = new PhysicalActionCanonicalizer();
    this.canonicalCount = new Uint8Array(FRAME_SLOTS);
    this.canonicalCommand = new Uint16Array(CANONICAL_CAPACITY);
    this.canonicalArgument = new Uint32Array(CANONICAL_CAPACITY);
    this.canonicalMask = new Uint8Array(CANONICAL_CAPACITY);
    this.canonicalKind = new Uint8Array(CANONICAL_CAPACITY);
    this.canonicalMergeCharge = new Uint8Array(CANONICAL_CAPACITY);
    this.canonicalMass = new Uint16Array(CANONICAL_CAPACITY * MASS_DIMENSION);
    this.lastCanonicalCommand = new Uint16Array(FRAME_SLOTS);
    this.lastCanonicalArgument = new Uint32Array(FRAME_SLOTS);
    this.lastCanonicalIndex = new Int16Array(FRAME_SLOTS);
    this.canonicalLookupCount = 0;
    this.canonicalComparisonCount = 0;
    this.canonicalHitCount = 0;
    this.canonicalStoreCount = 0;
    this.canonicalCapacityFailureCount = 0;
    this.canonicalChargedNodeCount = 0;
    this.canonicalChargedMergeCount = 0;
  }

  beginCanonicalState(depth) {
    this.canonicalCount[depth] = 0;
    this.lastCanonicalIndex[depth] = -1;
  }

  lookupCanonicalBranch(state, depth, ownAction, ownArgument,
      enemyAction, enemyArgument, ownChance, enemyChance) {
    this.canonicalLookupCount += 1;
    this.canonicalizer.canonicalize(state, ownAction, ownArgument,
      enemyAction, enemyArgument, ownChance, enemyChance);
    const command = this.canonicalizer.command;
    const argument = this.canonicalizer.arguments;
    this.lastCanonicalCommand[depth] = command;
    this.lastCanonicalArgument[depth] = argument;
    const start = depth * CANONICAL_WIDTH;
    const count = this.canonicalCount[depth];
    for (let offset = 0; offset < count; offset += 1) {
      const index = start + offset; this.canonicalComparisonCount += 1;
      if (this.canonicalCommand[index] !== command ||
          this.canonicalArgument[index] !== argument) continue;
      this.canonicalHitCount += 1;
      if (this.canonicalKind[index] === 3) this.canonicalChargedNodeCount += 1;
      if (this.canonicalMergeCharge[index])
        this.canonicalChargedMergeCount += 1;
      return index;
    }
    this.lastCanonicalIndex[depth] = start + count;
    return -1;
  }

  storeCanonicalBranch(state, depth, childMask, recursive, kind, evaluator) {
    const count = this.canonicalCount[depth];
    if (count >= CANONICAL_WIDTH) {
      this.canonicalCapacityFailureCount += 1; return 0;
    }
    const index = this.lastCanonicalIndex[depth];
    if (index < depth * CANONICAL_WIDTH ||
        index >= (depth + 1) * CANONICAL_WIDTH) return 0;
    this.canonicalCommand[index] = this.lastCanonicalCommand[depth];
    this.canonicalArgument[index] = this.lastCanonicalArgument[depth];
    this.canonicalMask[index] = childMask;
    this.canonicalKind[index] = kind;
    let mergeCharge = 0;
    if (recursive) {
      const remaining = evaluator.maximumFrames - depth - 1;
      mergeCharge = evaluator.ttIndex(state, remaining) >= 0 ? 1 : 0;
    }
    this.canonicalMergeCharge[index] = mergeCharge;
    const targetOffset = index * MASS_DIMENSION;
    if (recursive) evaluator.copyMass(evaluator.stateMass,
      (depth + 1) * MASS_DIMENSION, this.canonicalMass, targetOffset);
    else evaluator.setMass(this.canonicalMass, targetOffset, childMask);
    this.canonicalCount[depth] = count + 1;
    this.canonicalStoreCount += 1;
    return 1;
  }

  summary() {
    return { ...super.summary(),
      semantics: "DUAL_POLICY_CANONICAL_BRANCH_MEMO",
      canonicalBranchMemo: true,
      canonicalBranchBudgetMode: "CHARGED",
      canonicalWidth: CANONICAL_WIDTH,
      canonicalLookupCount: this.canonicalLookupCount,
      canonicalComparisonCount: this.canonicalComparisonCount,
      canonicalHitCount: this.canonicalHitCount,
      canonicalStoreCount: this.canonicalStoreCount,
      canonicalCapacityFailureCount: this.canonicalCapacityFailureCount,
      canonicalChargedNodeCount: this.canonicalChargedNodeCount,
      canonicalChargedMergeCount: this.canonicalChargedMergeCount,
      canonicalMemoHotAllocationCount: 0 };
  }
}

module.exports = { NativeCanonicalBranchMemoPoc, CANONICAL_WIDTH };
