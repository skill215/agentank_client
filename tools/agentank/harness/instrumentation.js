"use strict";

const { invariant } = require("../core/errors");

class AllocationCounter {
  constructor(defaultBudget = 0) {
    invariant(Number.isSafeInteger(defaultBudget) && defaultBudget >= 0,
      "INVALID_ALLOCATION_BUDGET", "allocation budget must be a non-negative integer");
    this.defaultBudget = defaultBudget;
    this.count = 0;
  }

  mark() {
    return this.count;
  }

  record(count = 1) {
    invariant(Number.isSafeInteger(count) && count >= 0, "INVALID_ALLOCATION_COUNT",
      "allocation count must be a non-negative integer");
    this.count += count;
  }

  since(mark) {
    invariant(Number.isSafeInteger(mark) && mark >= 0 && mark <= this.count,
      "INVALID_ALLOCATION_MARK", "allocation mark is invalid");
    return this.count - mark;
  }

  assertWithin(mark, budget = this.defaultBudget) {
    const used = this.since(mark);
    invariant(used <= budget, "ALLOCATION_BUDGET_EXCEEDED",
      `instrumented allocations ${used} exceed budget ${budget}`);
    return used;
  }
}

class HighWaterTracker {
  constructor(capacity) {
    invariant(Number.isSafeInteger(capacity) && capacity >= 0, "INVALID_ARENA_CAPACITY",
      "arena capacity must be a non-negative integer");
    this.capacity = capacity;
    this.current = 0;
    this.peak = 0;
  }

  reserve(count = 1) {
    invariant(Number.isSafeInteger(count) && count >= 0, "INVALID_ARENA_RESERVATION",
      "arena reservation must be a non-negative integer");
    const next = this.current + count;
    invariant(next <= this.capacity, "ARENA_CAPACITY_EXCEEDED",
      `arena usage ${next} exceeds capacity ${this.capacity}`);
    this.current = next;
    if (next > this.peak) this.peak = next;
    return this.current;
  }

  release(count = 1) {
    invariant(Number.isSafeInteger(count) && count >= 0 && count <= this.current,
      "ARENA_RELEASE_UNDERFLOW", "arena release exceeds current usage");
    this.current -= count;
    return this.current;
  }

  snapshot() {
    return { capacity: this.capacity, current: this.current, peak: this.peak };
  }
}

module.exports = { AllocationCounter, HighWaterTracker };
