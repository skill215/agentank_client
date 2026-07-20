"use strict";

const { invariant } = require("../core/errors");

function nanosecondsToMicroseconds(value) {
  invariant(typeof value === "bigint" && value >= 0n, "INVALID_CLOCK_DURATION",
    "clock duration must be a non-negative bigint");
  const result = Number(value / 1000n);
  invariant(Number.isSafeInteger(result), "CLOCK_DURATION_OVERFLOW", "clock duration exceeds safe range");
  return result;
}

class SystemClock {
  nowNanoseconds() {
    return process.hrtime.bigint();
  }

  elapsedMicroseconds(start, end = this.nowNanoseconds()) {
    invariant(end >= start, "CLOCK_MOVED_BACKWARDS", "clock moved backwards");
    return nanosecondsToMicroseconds(end - start);
  }
}

class SyntheticClock {
  constructor(initialMicroseconds = 0) {
    invariant(Number.isSafeInteger(initialMicroseconds) && initialMicroseconds >= 0,
      "INVALID_SYNTHETIC_CLOCK", "initial synthetic time must be a non-negative integer");
    this.microseconds = initialMicroseconds;
  }

  nowNanoseconds() {
    return BigInt(this.microseconds) * 1000n;
  }

  advanceMicroseconds(amount) {
    invariant(Number.isSafeInteger(amount) && amount >= 0, "INVALID_SYNTHETIC_CLOCK_ADVANCE",
      "synthetic clock advance must be a non-negative integer");
    this.microseconds += amount;
  }

  elapsedMicroseconds(start, end = this.nowNanoseconds()) {
    invariant(end >= start, "CLOCK_MOVED_BACKWARDS", "clock moved backwards");
    return nanosecondsToMicroseconds(end - start);
  }
}

module.exports = { nanosecondsToMicroseconds, SystemClock, SyntheticClock };
