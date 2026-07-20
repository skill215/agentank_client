"use strict";

const codes = require("../abi/fast-codes");
const state = require("../state/fast-state");
const { FastKernel } = require("./kernel");
const { HazardKernel } = require("./hazard");
const { HardGate } = require("./hard-gate");
const search = require("../search");

function createFastPhysical(spec, options) {
  const imported = state.importPhysicalState(spec, options);
  if (!imported.state) return { ...imported, kernel: null, hazard: null, hard: null };
  const kernel = new FastKernel(imported.state); const hazard = new HazardKernel(imported.state);
  const hard = new HardGate(kernel, hazard, options?.perspectiveSeat || 0);
  return { ...imported, kernel, hazard, hard };
}

module.exports = { ...codes, ...state, ...search, FastKernel, HazardKernel, HardGate, createFastPhysical };
