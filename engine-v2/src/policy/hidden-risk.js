"use strict";

const { POLICY_CAPACITY } = require("../generated/policy-config");
const { FEATURE_INPUT } = require("../abi/policy-codes");

const POSSIBLE_HAZARD = Object.freeze({ SHOT: 1 << 0, BOMB: 1 << 1, BELIEF_ROUTE: 1 << 2,
  CLOAK_PROXIMITY: 1 << 3, GRASS: 1 << 4 });

class HiddenRiskField {
  constructor(cellCount = POLICY_CAPACITY.MAX_HIDDEN_CELLS) {
    if (cellCount < 1 || cellCount > POLICY_CAPACITY.MAX_HIDDEN_CELLS) throw new RangeError("hidden field capacity");
    this.cellCount = cellCount; this.flags = new Uint8Array(POLICY_CAPACITY.MAX_HIDDEN_CELLS);
    this.shotExposure = new Uint16Array(POLICY_CAPACITY.MAX_HIDDEN_CELLS);
    this.bombExposure = new Uint16Array(POLICY_CAPACITY.MAX_HIDDEN_CELLS);
    this.beliefMass = new Uint16Array(POLICY_CAPACITY.MAX_HIDDEN_CELLS);
    this.informationGain = new Uint16Array(POLICY_CAPACITY.MAX_HIDDEN_CELLS);
    this.generation = 1; this.hardWriteCount = 0; this.proofWriteCount = 0; this.hotAllocationCount = 0;
  }
  clear() { this.flags.fill(0, 0, this.cellCount); this.shotExposure.fill(0, 0, this.cellCount);
    this.bombExposure.fill(0, 0, this.cellCount); this.beliefMass.fill(0, 0, this.cellCount);
    this.informationGain.fill(0, 0, this.cellCount); this.generation += 1; }
  mark(cell, flag, value) {
    if (cell < 0 || cell >= this.cellCount) return 0; const normalized = Math.max(0, Math.min(10000, value));
    this.flags[cell] |= flag;
    if (flag & POSSIBLE_HAZARD.SHOT) this.shotExposure[cell] = Math.max(this.shotExposure[cell], normalized);
    if (flag & POSSIBLE_HAZARD.BOMB) this.bombExposure[cell] = Math.max(this.bombExposure[cell], normalized);
    if (flag & (POSSIBLE_HAZARD.BELIEF_ROUTE | POSSIBLE_HAZARD.CLOAK_PROXIMITY | POSSIBLE_HAZARD.GRASS))
      this.beliefMass[cell] = Math.max(this.beliefMass[cell], normalized);
    return 1;
  }
  markInformationGain(cell, value) { if (cell < 0 || cell >= this.cellCount) return 0;
    this.informationGain[cell] = Math.max(0, Math.min(10000, value)); return 1; }
  exposure(cell) { if (cell < 0 || cell >= this.cellCount) return 10000;
    return Math.min(10000, this.shotExposure[cell] + Math.floor(this.bombExposure[cell] / 2) +
      Math.floor(this.beliefMass[cell] / 2)); }
  writeFeatures(cell, featureInput) {
    if (cell < 0 || cell >= this.cellCount) return 0;
    featureInput.set(FEATURE_INPUT.POSSIBLE_SHOT_EXPOSURE, this.exposure(cell));
    featureInput.set(FEATURE_INPUT.BELIEF_SWEEP_COVERAGE, this.informationGain[cell]);
    featureInput.set(FEATURE_INPUT.INFORMATION_CONTROL,
      Math.max(0, this.informationGain[cell] - Math.floor(this.beliefMass[cell] / 2))); return 1;
  }
}

module.exports = { POSSIBLE_HAZARD, HiddenRiskField };
