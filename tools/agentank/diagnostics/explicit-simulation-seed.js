'use strict';
const assert = require('node:assert/strict');
const { fingerprintObject } = require('../core/hash');
function uint32(seed) { assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'INVALID_SIMULATION_SEED'); return seed; }
function withExplicitSeed(module, seed, observed) {
  uint32(seed);
  const Original = module.AgenTankSimulator;
  return { ...module, AgenTankSimulator: class extends Original {
    constructor(options) {
      super({ ...options, seed });
      observed({ hostDerivedSeed: options.seed, effectiveSeed: seed });
    }
  } };
}
function controlledScenario(physical, parent, condition, seed) {
  uint32(seed); const s = structuredClone(physical);
  s.matchUrlId = 'bp393-' + condition + '-' + parent.matchUrlId;
  s.scenarioKind = 'CONTROLLED_SEED_PRESSURE';
  s.parentMatchUrlId = parent.matchUrlId; s.parentFingerprint = parent.fingerprint;
  s.physicalSourceFingerprint = physical.fingerprint;
  s.condition = condition; s.simulationSeed = seed;
  delete s.originalResult; delete s.originalFrames;
  s.fingerprint = ''; s.fingerprint = fingerprintObject(s); return s;
}
module.exports = { uint32, withExplicitSeed, controlledScenario };
