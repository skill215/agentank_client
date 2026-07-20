#!/usr/bin/env node
"use strict";

const { runV2LocalQualification } = require("../qualification/v2-local-release");
function flag(name) { const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1]; }
function main() {
  const result = runV2LocalQualification({ preTuningArena: flag("--pre"),
    performanceReport: flag("--performance"), postTuningArena: flag("--post"),
    outputDirectory: flag("--output") });
  process.stdout.write(`${JSON.stringify({ status: result.report.status,
    candidateBindingStatus: result.report.candidateBindingStatus,
    structuralGate: result.report.structuralGate, performanceGate: result.report.performanceGate,
    gameplayComparison: result.report.gameplayComparison,
    gameplayReview: result.report.gameplayReview, traceCoverage: result.report.traceCoverage,
    fingerprint: result.report.fingerprint, reportFile: result.reportFile }, null, 2)}\n`);
}
if (require.main === module) try { main(); } catch (error) {
  process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;
}
module.exports = { main };
