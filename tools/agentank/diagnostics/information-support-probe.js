"use strict";

const INFORMATION_SUPPORT_LOSS = Object.freeze({
  INPUT_SUPPORT: 1,
  WORLD_SELECTION: 2,
  WORLD_MASS: 4,
  DIRECTION_SUPPORT: 8,
  ENEMY_COLUMNS: 16,
  RECURSIVE_POLICY: 32,
  WORK_INTERRUPTED: 64,
  NO_RESULT: 128,
  ROOT_RESTORE: 256
});

const LOSS_NAMES = Object.freeze(Object.entries(INFORMATION_SUPPORT_LOSS));

// Diagnostic-only wrapper. It observes the existing InformationSearch contract
// without changing its values, support certificate, budgets or owner routing.
class InformationSupportProbe {
  constructor(engine) {
    this.engine = engine;
    this.search = engine && engine.informationSearch;
    this.attempts = 0;
    this.exactAfterSearch = 0;
    this.inexactAfterSearch = 0;
    this.otherInexact = 0;
    this.riskEnvelopeApplications = 0;
    this.exactLostToRiskEnvelope = 0;
    this.maskCounts = new Uint32Array(512);
    this.lossCounts = new Uint32Array(LOSS_NAMES.length);
    this.hotAllocationCount = 0;
    this.install();
  }

  install() {
    const search = this.search;
    if (!search || search.diagnosticInformationSupportProbeInstalled) return 0;
    const probe = this;
    const originalSearch = search.search;
    const originalEnvelope = search.applyRiskEnvelopes;
    search.diagnosticInformationSupportProbeInstalled = 1;
    search.search = function informationSupportObserved(...args) {
      const enemyCount = args[7] | 0;
      const worldMass = args[9];
      const worldCount = args[10] | 0;
      const inputSupport = args[11] ? 1 : 0;
      const directionComplete = args[15] ? 1 : 0;
      const interruptedBefore = this.workInterruptedCount;
      const restoreBefore = this.rootRestoreFailures;
      const result = originalSearch.apply(this, args);
      let mass = 0;
      for (let index = 0; index < worldCount; index += 1)
        mass += worldMass && Number.isSafeInteger(worldMass[index]) ? worldMass[index] : 0;
      let mask = 0;
      if (!inputSupport) mask |= INFORMATION_SUPPORT_LOSS.INPUT_SUPPORT;
      if (this.lastSelectedWorldCount !== worldCount)
        mask |= INFORMATION_SUPPORT_LOSS.WORLD_SELECTION;
      if (mass !== 10000) mask |= INFORMATION_SUPPORT_LOSS.WORLD_MASS;
      if (!directionComplete) mask |= INFORMATION_SUPPORT_LOSS.DIRECTION_SUPPORT;
      if (this.lastEffectiveEnemyCount !== enemyCount)
        mask |= INFORMATION_SUPPORT_LOSS.ENEMY_COLUMNS;
      if (this.lastContinuationPool > 0)
        mask |= INFORMATION_SUPPORT_LOSS.RECURSIVE_POLICY;
      if (this.workInterruptedCount !== interruptedBefore)
        mask |= INFORMATION_SUPPORT_LOSS.WORK_INTERRUPTED;
      if (!result) mask |= INFORMATION_SUPPORT_LOSS.NO_RESULT;
      if (this.rootRestoreFailures !== restoreBefore)
        mask |= INFORMATION_SUPPORT_LOSS.ROOT_RESTORE;
      probe.attempts += 1;
      if (this.supportComplete === 1 && this.approximate === 0)
        probe.exactAfterSearch += 1;
      else {
        probe.inexactAfterSearch += 1;
        if (!mask) probe.otherInexact += 1;
      }
      probe.maskCounts[mask] += 1;
      for (let index = 0; index < LOSS_NAMES.length; index += 1)
        if (mask & LOSS_NAMES[index][1]) probe.lossCounts[index] += 1;
      return result;
    };
    search.applyRiskEnvelopes = function informationEnvelopeObserved(...args) {
      const exactBefore = this.supportComplete === 1 && this.approximate === 0;
      const result = originalEnvelope.apply(this, args);
      if (result) {
        probe.riskEnvelopeApplications += 1;
        if (exactBefore && (this.supportComplete !== 1 || this.approximate !== 0))
          probe.exactLostToRiskEnvelope += 1;
      }
      return result;
    };
    return 1;
  }

  summary() {
    const lossCounts = {};
    for (let index = 0; index < LOSS_NAMES.length; index += 1)
      lossCounts[LOSS_NAMES[index][0]] = this.lossCounts[index];
    const maskCounts = {};
    for (let mask = 0; mask < this.maskCounts.length; mask += 1)
      if (this.maskCounts[mask]) maskCounts[mask] = this.maskCounts[mask];
    return {
      attempts: this.attempts,
      exactAfterSearch: this.exactAfterSearch,
      inexactAfterSearch: this.inexactAfterSearch,
      otherInexact: this.otherInexact,
      riskEnvelopeApplications: this.riskEnvelopeApplications,
      exactLostToRiskEnvelope: this.exactLostToRiskEnvelope,
      lossCounts,
      maskCounts,
      hotAllocationCount: this.hotAllocationCount
    };
  }
}

module.exports = { INFORMATION_SUPPORT_LOSS, InformationSupportProbe };
