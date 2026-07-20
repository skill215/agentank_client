#!/usr/bin/env node
"use strict";

const { runRuntimeMatrix } = require("../benchmark/v1-v2-runtime-matrix");
const { positiveInteger, progressLine } = require("./v1-v2-diagnostic");

function flag(name) { const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1]; }
async function main() {
  const progressEvery = positiveInteger(flag("--progress-every"), 16);
  const startedAt = process.hrtime.bigint(); let lastPhase = "";
  const result = await runRuntimeMatrix({ planPath: flag("--plan"),
    outputDirectory: flag("--output"), onProgress(value) {
      if (value.phase !== lastPhase || value.done === 1 || value.done === value.total ||
          value.done % progressEvery === 0) {
        lastPhase = value.phase; process.stdout.write(`${progressLine(
          `runtime-${value.phase.toLowerCase()}`, value.done, value.total, startedAt,
          `profile=${value.profileId || "-"} ${value.detail || ""}`)}\n`);
      }
    } });
  process.stdout.write(`${JSON.stringify({ status: result.report.status,
    sourceSha256: result.report.source.sha256, referenceV1: result.report.referenceV1,
    profiles: result.report.profiles.map(item => ({ profileId: item.profileId,
      nativeWins: item.gameplay.summary.native.wins,
      matchedInput: item.matchedInput, qualification: item.qualification })),
    selection: result.report.selection, fingerprint: result.report.fingerprint,
    reportFile: result.reportFile }, null, 2)}\n`);
}
if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;
});
module.exports = { main };
