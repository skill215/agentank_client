"use strict";

const { runImp8Preflight } = require("../../tools/agentank/candidate/imp8-preflight");
const { runImp8Calibration } = require("../../tools/agentank/calibration/imp8-runner");

let memo;
let calibrationMemo;
function imp8Evidence() {
  if (!memo) memo = runImp8Preflight();
  return memo;
}
function imp8CalibrationEvidence() {
  if (!calibrationMemo) calibrationMemo = runImp8Calibration();
  return calibrationMemo;
}

module.exports = { imp8Evidence, imp8CalibrationEvidence };
