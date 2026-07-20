#!/usr/bin/env node
"use strict";

const { runCandidateComparison } = require("../calibration/imp8-candidate-comparison");

function numberFlag(name) {
  const index = process.argv.indexOf(name); return index >= 0 ? Number(process.argv[index + 1]) : undefined;
}
function textFlag(name) {
  const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined;
}

runCandidateComparison({ limit: numberFlag("--limit"), repetitions: numberFlag("--repetitions"),
  planPath: textFlag("--plan"), outputDirectory: textFlag("--output-directory"),
  onProgress(candidate, done, total) {
    if (done === total || done % 32 === 0) process.stdout.write(
      `[${candidate}] ${done}/${total}\n`);
  } }).then(({ report, directory }) => {
  process.stdout.write(`${JSON.stringify({ status: report.status,
    selectedCandidateProfileId: report.selectedCandidateProfileId,
    fingerprint: report.fingerprint, directory }, null, 2)}\n`);
}).catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
