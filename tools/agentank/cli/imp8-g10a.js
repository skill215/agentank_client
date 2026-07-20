#!/usr/bin/env node
"use strict";

const { runImp8G10a } = require("../candidate/imp8-g10a");
function flag(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
runImp8G10a({ manifestPath: flag("--manifest"), onProgress(done, total) {
  if (done === total || done % 32 === 0) process.stdout.write(`[G10A] ${done}/${total}\n`);
} }).then(({ report, current }) => process.stdout.write(`${JSON.stringify({ status: report.status,
  candidateId: report.candidate.candidateId, frozenMatches: report.frozenArena.matchCount,
  discoveryMatches: report.discoverySkillRegression.membershipCount,
  fingerprint: report.fingerprint, reportFile: current }, null, 2)}\n`))
  .catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
