#!/usr/bin/env node
"use strict";

const { traceMatch } = require("../simulation/trace-match");

function flag(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }

traceMatch({ matchUrlId: flag("--match"), candidateProfileId: flag("--candidate"),
  variantId: flag("--variant"), planPath: flag("--plan") }).then(({ report, directory }) => {
  process.stdout.write(`${JSON.stringify({ fingerprint: report.fingerprint,
    result: report.match.result, frames: report.match.frames,
    v2RuntimeModes: report.match.v2.runtimeModeCounts, directory }, null, 2)}\n`);
}).catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
