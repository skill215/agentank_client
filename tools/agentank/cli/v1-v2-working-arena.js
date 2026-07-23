#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runWorkingArena, ALL_ROLES } = require("../diagnostics/v1-v2-working-arena");
const { fingerprintObject } = require("../core/hash");
const { invariant } = require("../core/errors");
const { positiveInteger, progressLine } = require("./v1-v2-diagnostic");

function flag(name) {
  const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1];
}
function roles(value) {
  return value ? value.split(",").map(item => item.trim().toUpperCase()).filter(Boolean) :
    ALL_ROLES.slice();
}
function traceMode(value) {
  const mode = String(value || "none").toLowerCase();
  invariant(mode === "none" || mode === "actions" || mode === "full" || mode === "compact",
    "V1_V2_WORKING_TRACE_MODE_INVALID", mode);
  return { captureActions: mode === "actions" || mode === "full",
    captureAllFrames: mode === "full", includeReplay: mode === "full",
    captureCompact: mode === "compact" };
}
function performanceSelection(value) {
  if (!value) return null; const file = path.resolve(value);
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(report.fingerprint === fingerprintObject(report) &&
    report.selection?.status === "SELECTED" && report.selection.parameters,
  "V1_V2_PERFORMANCE_SELECTION_INVALID", file);
  return { parameters: report.selection.parameters,
    profileId: report.selection.profileId,
    binding: { reportRelativePath: path.relative(process.cwd(), file).replaceAll("\\", "/"),
      reportFingerprint: report.fingerprint, profileId: report.selection.profileId,
      parameterFingerprint: fingerprintObject(report.selection.parameters) } };
}
async function main() {
  const progressEvery = positiveInteger(flag("--progress-every"), 32);
  const startedAt = process.hrtime.bigint();
  const selectedRoles = roles(flag("--roles"));
  const selectedPerformance = performanceSelection(flag("--performance-report"));
  const diagnostics = traceMode(flag("--trace"));
  process.stdout.write(`[start] roles=${selectedRoles.join(",")} repetitions=` +
    `${flag("--repetitions") || 1} limit=${flag("--limit") || "all"} ` +
    `output=${flag("--output") || "source-addressed-default"}\n`);
  const result = await runWorkingArena({ roles: selectedRoles, repetitions: flag("--repetitions"),
    limit: flag("--limit"), timeoutMs: flag("--timeout-ms"), outputDirectory: flag("--output"),
    includeRolling: !process.argv.includes("--no-rolling"),
    diagnostics, parametersOverride: selectedPerformance?.parameters,
    parameterProfileId: selectedPerformance?.profileId,
    performanceBinding: selectedPerformance?.binding,
    onProgress(done, total, role, roleDone, roleTotal, matchUrlId, variantId) {
      if (done === 1 || done === total || done % progressEvery === 0 || roleDone === roleTotal)
        process.stdout.write(`${progressLine("working", done, total, startedAt,
          `role=${role} roleProgress=${roleDone}/${roleTotal} match=${matchUrlId} variant=${variantId}`)}\n`);
    } });
  const report = result.overview;
  process.stdout.write(`${JSON.stringify({ status: report.status, sourceSha256: report.source.sha256,
    matches: report.execution.matchCount, summary: report.summary,
    comparisons: report.comparisons, checks: report.checks,
    storageChecks: report.storageChecks, fingerprint: report.fingerprint,
    reportFile: result.file }, null, 2)}\n`);
  if (report.status !== "ACCEPTED") process.exitCode = 2;
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;
});

module.exports = { roles, traceMode, performanceSelection, main };
