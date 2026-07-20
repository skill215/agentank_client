"use strict";

const { invariant } = require("../core/errors");

class DeterministicPrng {
  constructor(seed) {
    invariant(Number.isSafeInteger(seed) && seed >= 1 && seed <= 0xffffffff,
      "INVALID_PRNG_SEED", "seed must be an integer in [1, 2^32-1]");
    this.state = seed >>> 0;
  }

  nextUint32() {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  nextInt(exclusiveUpperBound) {
    invariant(Number.isSafeInteger(exclusiveUpperBound) && exclusiveUpperBound > 0 &&
      exclusiveUpperBound <= 0x100000000, "INVALID_PRNG_BOUND",
    "exclusive upper bound must be an integer in [1, 2^32]");
    const limit = 0x100000000 - (0x100000000 % exclusiveUpperBound);
    let value;
    do value = this.nextUint32(); while (value >= limit);
    return value % exclusiveUpperBound;
  }

  snapshot() {
    return this.state;
  }
}

module.exports = { DeterministicPrng };
