#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { RUNTIME_CONFIG } = require("../../../engine-v2/src/generated/runtime-config");
const { WORK_KIND } = require("../../../engine-v2/src/abi/cache-runtime-codes");

const REQUIRED_BATCHES = 5;
const ROOT_PHASES = Object.freeze(["OBSERVATION", "NAVIGATION", "HIDDEN_RISK",
  "FINAL_HARD", "SAFETY_CLOSURE", "COMMITTED_EO", "INFORMATION_OVERLAY", "STAGE_MATRIX"]);
const FEATURE_PHASES = Object.freeze(["PLAN_SKETCH", "MULTI_FRAME_RISK", "COMBAT_VECTOR",
  "PROJECTILE_ATTACK", "STRATEGY_EVIDENCE"]);
const VALUE_PHASES = Object.freeze(["PHYSICAL_SEARCH", "INFORMATION_SEARCH",
  "INFO_CONTINUATION", "DEPTH_HEURISTIC"]);

function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function sumKeys(object, keys) { let sum = 0; for (const key of keys) sum += object[key] || 0; return sum; }
function ceilRatio(numerator, denominator) {
  return Math.max(1, Math.ceil(Math.max(0, numerator) / Math.max(1, denominator)));
}
function addObject(target, source) {
  for (const [key, value] of Object.entries(source || {}))
    target[key] = (target[key] || 0) + value;
}
function emptyAggregate() {
  return { batches: 0, matches: 0, callbacks: 0, runtimeMicros: 0,
    exclusiveMicros: {}, inclusiveMicros: {}, calls: {}, ledgerUnits: {}, ledgerCalls: {},
    matrixIterations: 0, searchNodes: 0, observationSafetyAudits: 0, forcedWinNodes: 0,
    rootActions: 0, latticeHits: 0, latticeMisses: 0,
    invariants: { avoidableHardReject: 0, riskDominatedSelection: 0,
      rootRestoreFailure: 0, hotAllocation: 0 } };
}
function aggregateInputs(documents) {
  const output = emptyAggregate();
  for (const document of documents) {
    const summary = document?.summaries?.CURRENT;
    if (!summary?.phaseTiming?.exclusiveMicros || !summary.workLedger)
      throw new Error("HP9_CALIBRATION_INPUT_MISSING_EXCLUSIVE_LEDGER");
    output.batches += 1; output.matches += summary.matches || 0;
    output.runtimeMicros += summary.totalRuntimeMicros || 0;
    addObject(output.exclusiveMicros, summary.phaseTiming.exclusiveMicros);
    addObject(output.inclusiveMicros, summary.phaseTiming.micros);
    addObject(output.calls, summary.phaseTiming.calls);
    addObject(output.ledgerUnits, summary.workLedger.units);
    addObject(output.ledgerCalls, summary.workLedger.calls);
    output.matrixIterations += summary.phaseTiming.matrixIterations || 0;
    output.searchNodes += summary.runtimeSchedule?.searchNodes || 0;
    output.observationSafetyAudits += summary.runtimeSchedule?.observationSafetyAudits || 0;
    output.forcedWinNodes += summary.runtimeSchedule?.forcedWinSearchNodes || 0;
    output.rootActions += summary.runtimeSchedule?.rootActionTotal || 0;
    output.latticeHits += summary.reverseViabilityCache?.latticeHits || 0;
    output.latticeMisses += summary.reverseViabilityCache?.latticeMisses || 0;
    addObject(output.invariants, summary.invariants);
  }
  output.callbacks = output.calls.OBSERVATION || 0;
  return output;
}
function rawCount(aggregate, name, kind) {
  const charge = RUNTIME_CONFIG.WORK_CHARGES[kind]; const units = aggregate.ledgerUnits[name] || 0;
  if (units % charge !== 0) throw new Error(`HP9_CALIBRATION_NON_INTEGRAL_COUNT:${name}`);
  return units / charge;
}
function deriveCalibration(documents) {
  const aggregate = aggregateInputs(documents);
  if (aggregate.batches < REQUIRED_BATCHES)
    throw new Error(`HP9_CALIBRATION_BATCHES:${aggregate.batches}`);
  if (!aggregate.callbacks || !aggregate.matrixIterations || !aggregate.searchNodes ||
      !aggregate.latticeMisses) throw new Error("HP9_CALIBRATION_SUPPORT_INCOMPLETE");
  const exclusiveTotal = Object.values(aggregate.exclusiveMicros).reduce((sum, value) => sum + value, 0);
  const residualMicros = Math.max(0, aggregate.runtimeMicros - exclusiveTotal);
  const featureCount = rawCount(aggregate, "FEATURE_PLAN", WORK_KIND.FEATURE_PLAN);
  const proofCount = rawCount(aggregate, "PROOF_NODE", WORK_KIND.PROOF_NODE);
  const emitterCount = rawCount(aggregate, "EMITTER", WORK_KIND.EMITTER);
  const cacheCharge = ceilRatio(aggregate.exclusiveMicros.HARD_CLASSIFY,
    aggregate.calls.HARD_CLASSIFY);
  const reverseMicros = aggregate.exclusiveMicros.REVERSE_VIABILITY || 0;
  const missMicros = Math.max(0, reverseMicros - aggregate.latticeHits * cacheCharge);
  const charges = new Array(WORK_KIND.COUNT).fill(1);
  charges[WORK_KIND.ROOT] = ceilRatio(sumKeys(aggregate.exclusiveMicros, ROOT_PHASES) +
    residualMicros, aggregate.callbacks);
  charges[WORK_KIND.FAST_TRANSITION] = ceilRatio(aggregate.exclusiveMicros.FAST_APPLY,
    aggregate.calls.FAST_APPLY);
  charges[WORK_KIND.CACHE] = cacheCharge;
  charges[WORK_KIND.HARD] = Math.max(cacheCharge + 1,
    ceilRatio(missMicros, aggregate.latticeMisses) + cacheCharge);
  charges[WORK_KIND.VALUE_NODE] = ceilRatio(sumKeys(aggregate.exclusiveMicros, VALUE_PHASES),
    aggregate.searchNodes);
  charges[WORK_KIND.PROOF_NODE] = ceilRatio(
    (aggregate.inclusiveMicros.OBSERVATION_SAFETY || 0) +
      (aggregate.inclusiveMicros.FORCED_WIN || 0), proofCount);
  charges[WORK_KIND.MATRIX_ITERATION] = ceilRatio(aggregate.exclusiveMicros.MATRIX_SOLVER,
    aggregate.matrixIterations);
  charges[WORK_KIND.FEATURE_PLAN] = ceilRatio(sumKeys(aggregate.exclusiveMicros, FEATURE_PHASES),
    featureCount);
  charges[WORK_KIND.EMITTER] = ceilRatio(aggregate.exclusiveMicros.FINAL_SELECTION, emitterCount);
  charges[WORK_KIND.UNKNOWN] = RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.UNKNOWN];
  const fixedLongGameUnits = 128 * (charges[WORK_KIND.ROOT] + charges[WORK_KIND.EMITTER]);
  const status = Object.values(aggregate.invariants).every(value => value === 0) &&
    fixedLongGameUnits < RUNTIME_CONFIG.DEGRADED_ENTER_WORK_UNITS ? "PASS" : "FAIL";
  return { status, aggregate, timingModel: { unit: "LOCAL_MICROSECOND_EQUIVALENT",
    exclusiveTotalMicros: exclusiveTotal, residualMicros,
    phaseGroups: { root: ROOT_PHASES, feature: FEATURE_PHASES, value: VALUE_PHASES } },
  derived: { workCharges: charges, fixedLongGameUnits,
    thresholds: { degraded: RUNTIME_CONFIG.DEGRADED_ENTER_WORK_UNITS,
      fallback: RUNTIME_CONFIG.FALLBACK_ENTER_WORK_UNITS,
      emergency: RUNTIME_CONFIG.EMERGENCY_ENTER_WORK_UNITS },
    releaseCalibrated: false, blocker: "PLATFORM_RUNTIME_SCALE_PENDING" } };
}
function sourceIdentity(root) {
  const files = ["engine-v2/src/runtime/controller.js", "engine-v2/src/runtime/production-root.js",
    "engine-v2/src/search/production-depth-search.js",
    "engine-v2/src/search/production-information-search.js",
    "engine-v2/src/generated/runtime-config.js",
    "tools/agentank/simulation/production-diagnostic-bot.js",
    "tools/agentank/benchmark/runtime-work-calibration.js"];
  const hashes = {}; for (const file of files) hashes[file] = sha(fs.readFileSync(path.join(root, file)));
  return { files: hashes, fingerprint: sha(JSON.stringify(hashes)) };
}
function option(name, fallback = "") {
  const at = process.argv.indexOf(name); return at < 0 ? fallback : String(process.argv[at + 1]);
}
function main() {
  const root = path.resolve(__dirname, "../../..");
  const inputs = option("--inputs").split(",").filter(Boolean).map(file => path.resolve(file));
  if (inputs.length < REQUIRED_BATCHES) throw new Error(`HP9_CALIBRATION_INPUTS:${inputs.length}`);
  const documents = inputs.map(file => JSON.parse(fs.readFileSync(file, "utf8")));
  const calibration = deriveCalibration(documents);
  const report = { schemaVersion: 1, objectKind: "HP9_RUNTIME_WORK_CALIBRATION_V1",
    status: calibration.status, node: process.version, source: sourceIdentity(root),
    inputs: inputs.map((file, index) => ({ batch: index + 1, file, sha256: sha(fs.readFileSync(file)) })),
    ...calibration };
  report.fingerprint = sha(JSON.stringify(report));
  const output = option("--output");
  if (output) { const target = path.resolve(output); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`); }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "PASS") process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = { ROOT_PHASES, FEATURE_PHASES, VALUE_PHASES, aggregateInputs, deriveCalibration };
