#!/usr/bin/env node
"use strict";

const { runFailureAnalysis } = require("../diagnostics/v1-v2-failure-analysis");
const { positiveInteger, progressLine } = require("./v1-v2-diagnostic");

const DEFAULT_BEFORE = "artifacts/diagnostics/v1-v2-working/" +
  "44e084e917ddd32d-r2-discovery-calibration-frozen-rolling-3c663bc6/working-arena-overview.json";
const DEFAULT_AFTER = "artifacts/diagnostics/v1-v2-working/" +
  "812587a97242b9cd-r2-discovery-calibration-frozen-pa3d927a3c14c-rolling-3c663bc6/" +
  "working-arena-overview.json";

function flag(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }

async function main() {
  const progressEvery = positiveInteger(flag("--progress-every"), 16);
  const started = process.hrtime.bigint();
  process.stdout.write(`[start] before=${flag("--before") || DEFAULT_BEFORE} ` +
    `after=${flag("--after") || DEFAULT_AFTER} replayLimit=${flag("--replay-limit") || "all"}\n`);
  const result = await runFailureAnalysis({ beforeOverview: flag("--before") || DEFAULT_BEFORE,
    afterOverview: flag("--after") || DEFAULT_AFTER, outputDirectory: flag("--output"),
    replayLimit: flag("--replay-limit"), deathWindow: flag("--death-window"),
    onProgress(done, total, matchId, failureClass, reproducible) {
      if (done === 1 || done === total || done % progressEvery === 0)
        process.stdout.write(`${progressLine("failure-replay", done, total, started,
          `match=${matchId} class=${failureClass} reproducible=${reproducible}`)}\n`);
    } });
  process.stdout.write(`${JSON.stringify({ status: result.report.status,
    execution: result.report.execution, summary: result.report.summary,
    fingerprint: result.report.fingerprint, reportFile: result.file }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;
});

module.exports = { DEFAULT_BEFORE, DEFAULT_AFTER, main };
