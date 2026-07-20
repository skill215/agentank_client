#!/usr/bin/env node
"use strict";

const { runV1V2FailureDiagnostic } = require("../diagnostics/v1-v2-paired-diagnostic");
function flag(name) {
  const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1];
}

function positiveInteger(value, fallback) {
  const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function secondsSince(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1e9;
}
function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "?";
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60); const remainder = Math.floor(seconds % 60);
  if (minutes < 60) return `${minutes}m${String(remainder).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}
function progressLine(phase, done, total, startedAt, details = "") {
  const elapsed = Math.max(0.001, secondsSince(startedAt));
  const rate = done / elapsed; const remaining = Math.max(0, total - done);
  const eta = rate > 0 ? remaining / rate : Number.POSITIVE_INFINITY;
  const percent = total > 0 ? done * 100 / total : 100;
  return `[${phase}] ${done}/${total} (${percent.toFixed(1)}%) elapsed=${duration(elapsed)} ` +
    `rate=${rate.toFixed(rate < 10 ? 2 : 1)}/s eta=${duration(eta)}` +
    (details ? ` ${details}` : "");
}

async function main() {
  const progressEvery = positiveInteger(flag("--progress-every"), 32);
  const exactStartedAt = process.hrtime.bigint(); let traceStartedAt = null;
  process.stdout.write(`[start] repetitions=${flag("--repetitions") || "plan"} ` +
    `limit=${flag("--limit") || "all"} progressEvery=${progressEvery} ` +
    `output=${flag("--output") || "plan-default"}\n`);
  const { report, reportFile } = await runV1V2FailureDiagnostic({
    planPath: flag("--plan"), outputDirectory: flag("--output"),
    repetitions: flag("--repetitions"), limit: flag("--limit"),
    maxTraceCases: flag("--max-traces"),
    onProgress(done, total, matchUrlId, variantId, created) {
      if (done === 1 || done === total || done % progressEvery === 0) {
        const resumed = done - created;
        process.stdout.write(`${progressLine("exact", done, total, exactStartedAt,
          `new=${created} resumed=${resumed} match=${matchUrlId} variant=${variantId}`)}\n`);
      }
      if (done === total && !traceStartedAt) traceStartedAt = process.hrtime.bigint();
    },
    onTraceProgress(done, total, matchId) {
      if (!traceStartedAt) traceStartedAt = process.hrtime.bigint();
      process.stdout.write(`${progressLine("trace", done, total, traceStartedAt,
        `match=${matchId}`)}\n`);
    }
  });
  process.stdout.write(`${JSON.stringify({
    status: report.status, candidateId: report.candidate.candidateId,
    scenarios: report.corpus.executedScenarioCount,
    exactMatches: report.execution.executedExactMatches,
    resumedExactMatches: report.execution.resumedExactMatches,
    newExactMatches: report.execution.newExactMatches,
    traceCases: report.execution.traceCaseCount,
    native: report.exact.summary.native, pairedNative: report.exact.summary.paired.native,
    classificationCounts: report.failureAnalysis.classificationCounts,
    fingerprint: report.fingerprint, reportFile
  }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;
});

module.exports = { positiveInteger, duration, progressLine, main };
