#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : String(process.argv[index + 1]);
}

function median(values) {
  if (!values.length) return -1;
  const ordered = values.slice().sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function readInput(file) {
  const bytes = fs.readFileSync(file);
  return { file: path.resolve(file), sha256: sha256(bytes), document: JSON.parse(bytes) };
}

function sourceIdentity(root) {
  const relativeFiles = [
    "engine-v2/src/runtime/controller.js",
    "engine-v2/src/runtime/production-root.js",
    "engine-v2/src/search/production-depth-search.js",
    "engine-v2/src/search/production-information-search.js",
    "engine-v2/src/generated/runtime-config.js",
    "config/engine-v2/imp6-runtime-build-profile.json",
    "tools/agentank/benchmark/runtime-work-qualification.js"
  ];
  const files = {};
  for (const file of relativeFiles) files[file] = sha256(fs.readFileSync(path.join(root, file)));
  return { files, fingerprint: sha256(JSON.stringify(files)) };
}

function compactSchedule(input) {
  const summary = input.document?.summaries?.CURRENT;
  if (!summary?.runtimeSchedule || !summary?.phaseTiming)
    throw new Error(`HP9_QUALIFICATION_INPUT_INVALID:${input.file}`);
  const schedule = summary.runtimeSchedule;
  const completeIterations = (schedule.completedDepthCounts || [])
    .reduce((sum, count, depth) => sum + (depth > 0 ? count || 0 : 0), 0);
  const invariants = summary.invariants || {};
  return {
    file: input.file,
    sha256: input.sha256,
    matches: summary.matches,
    callbacks: summary.phaseTiming.calls.OBSERVATION || 0,
    modeFrames: summary.runtimeModeCounts,
    firstDegradedMedian: median(schedule.firstModeFrames?.[1] || []),
    firstFallbackMedian: median(schedule.firstModeFrames?.[2] || []),
    firstEmergencyMedian: median(schedule.firstModeFrames?.[3] || []),
    searchFrames: schedule.searchFrames || 0,
    searchNodes: schedule.searchNodes || 0,
    completeIterations,
    completeIterationBasisPoints: Math.floor(completeIterations * 10000 /
      Math.max(1, schedule.searchFrames || 0)),
    completedDepthCounts: schedule.completedDepthCounts || [],
    totalRuntimeMicros: summary.totalRuntimeMicros || 0,
    p95RuntimeMicrosMax: summary.p95RuntimeMicrosMax || 0,
    invariants: {
      avoidableHardReject: invariants.avoidableHardReject || 0,
      riskDominatedSelection: invariants.riskDominatedSelection || 0,
      rootRestoreFailure: invariants.rootRestoreFailure || 0,
      hotAllocation: invariants.hotAllocation || 0
    }
  };
}

function ratioBasisPoints(after, before) {
  return Math.floor(after * 10000 / Math.max(1, before));
}

function invariantTotal(summary) {
  return Object.values(summary.invariants).reduce((sum, value) => sum + value, 0);
}

function qualify({ calibration, baseline, development, support, validation }) {
  const calibrationDocument = calibration.document;
  if (calibrationDocument.status !== "PASS")
    throw new Error("HP9_QUALIFICATION_CALIBRATION_NOT_PASS");
  const before = compactSchedule(baseline);
  const after = compactSchedule(development);
  const dev16 = compactSchedule(support);
  const holdout32 = compactSchedule(validation);
  const deltas = {
    searchFramesBasisPoints: ratioBasisPoints(after.searchFrames, before.searchFrames),
    searchNodesBasisPoints: ratioBasisPoints(after.searchNodes, before.searchNodes),
    totalRuntimeBasisPoints: ratioBasisPoints(after.totalRuntimeMicros, before.totalRuntimeMicros),
    p95RuntimeBasisPoints: ratioBasisPoints(after.p95RuntimeMicrosMax,
      before.p95RuntimeMicrosMax),
    firstFallbackFrames: after.firstFallbackMedian - before.firstFallbackMedian,
    firstEmergencyFrames: after.firstEmergencyMedian - before.firstEmergencyMedian
  };
  const checks = {
    calibrationPass: calibrationDocument.status === "PASS",
    fixedLongGameBelowDegraded: calibrationDocument.derived.fixedLongGameUnits <
      calibrationDocument.derived.thresholds.degraded,
    developmentInvariants: invariantTotal(after) === 0,
    supportInvariants: invariantTotal(dev16) === 0,
    validationInvariants: invariantTotal(holdout32) === 0,
    searchFramesImproved: after.searchFrames > before.searchFrames,
    searchNodesImproved: after.searchNodes > before.searchNodes,
    fallbackLater: after.firstFallbackMedian > before.firstFallbackMedian,
    emergencyLater: after.firstEmergencyMedian > before.firstEmergencyMedian,
    developmentIterationsComplete: after.completeIterationBasisPoints === 10000,
    supportIterationsComplete: dev16.completeIterationBasisPoints === 10000,
    validationIterationsComplete: holdout32.completeIterationBasisPoints === 10000,
    developmentTotalRuntimeGuard: deltas.totalRuntimeBasisPoints <= 11000,
    developmentP95Guard: deltas.p95RuntimeBasisPoints <= 11000
  };
  return {
    status: Object.values(checks).every(Boolean) ? "PASS_LOCAL" : "FAIL",
    releaseCalibrated: false,
    blocker: "PLATFORM_RUNTIME_SCALE_PENDING",
    checks,
    deltas,
    calibration: { file: calibration.file, sha256: calibration.sha256,
      fingerprint: calibrationDocument.fingerprint,
      workCharges: calibrationDocument.derived.workCharges,
      fixedLongGameUnits: calibrationDocument.derived.fixedLongGameUnits },
    cohorts: { causalDevelopment8: { baseline: before, candidate: after },
      development16: dev16, independentValidation32: holdout32 }
  };
}

function main() {
  const required = ["--calibration", "--baseline", "--development", "--support", "--validation"];
  for (const name of required) if (!option(name)) throw new Error(`HP9_QUALIFICATION_OPTION:${name}`);
  const root = path.resolve(__dirname, "../../..");
  const report = { schemaVersion: 1, objectKind: "HP9_RUNTIME_WORK_QUALIFICATION_V1",
    node: process.version, source: sourceIdentity(root),
    ...qualify({ calibration: readInput(option("--calibration")),
      baseline: readInput(option("--baseline")),
      development: readInput(option("--development")),
      support: readInput(option("--support")),
      validation: readInput(option("--validation")) }) };
  report.fingerprint = sha256(JSON.stringify(report));
  const output = option("--output");
  if (output) {
    const target = path.resolve(output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "PASS_LOCAL") process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { median, compactSchedule, sourceIdentity, qualify };
