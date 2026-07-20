"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");

const DEFAULT_SOURCE = "tiny-tank-minimax.js";
const DEFAULT_CAPABILITY = "battle-records/control/capabilities/v2/main/capability-profile.json";
const DEFAULT_EVIDENCE = "battle-records/v27-real-3-20260716-1537-cst";

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function integerConstant(source, name) {
  const match = source.match(new RegExp(`var\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
  invariant(match, "V1_RUNTIME_CONSTANT_MISSING", name); return Number(match[1]);
}

function sourceFacts(source) {
  const hasClockGuard = /typeof Date === "function"\s*&&\s*typeof Date\.now === "function"/.test(source);
  const nodeCap = integerConstant(source, "AT_MAX_NODES");
  const mcDisableMs = integerConstant(source, "AT_MC_DISABLE_AFTER_MS");
  const minimaxReduceMs = integerConstant(source, "AT_MINIMAX_REDUCE_AFTER_MS");
  invariant(/AT_NODE_LIMIT\s*=\s*Math\.max\(12,\s*Math\.floor\(AT_MAX_NODES\s*\/\s*actions\.length\)\)/
    .test(source), "V1_NODE_DISTRIBUTION_NOT_FOUND", DEFAULT_SOURCE);
  invariant(/state\._searchRounds\s*=\s*2/.test(source) && /\?\s*3\s*:\s*2/.test(source),
    "V1_DEPTH_POLICY_NOT_FOUND", DEFAULT_SOURCE);
  return { clockGuardReturnsZeroWhenUnavailable: hasClockGuard,
    conditionalTimeControls: { monteCarloDisableAfterMs: mcDisableMs,
      minimaxReduceAfterMs: minimaxReduceMs },
    unconditionalWorkBounds: { rootNodeCap: nodeCap,
      perRootActionNodeCapFormula: "max(12,floor(rootNodeCap/rootActionCount))",
      normalDecisionRounds: [2, 3], runtimeReducedRounds: 2 } };
}

function capabilityFacts(profile) {
  const fact = name => profile.facts.find(item => item.name === name) || null;
  return { profileId: profile.profileId, branch: profile.branch,
    fingerprint: profile.fingerprint, dateNow: fact("runtime.Date.now"),
    performanceNow: fact("runtime.performance.now"),
    publicCumulativeMs: fact("runtime.publicCumulativeMs"),
    counterBudgetMode: fact("runtime.counterBudgetMode"),
    callbackWatchdogMs: profile.limits?.callbackWatchdogMs || null,
    wholeMatchRuntimeMs: profile.limits?.wholeMatchRuntimeMs || null };
}

function summaryFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(directory, entry.name, "summary.json");
    if (fs.existsSync(file)) files.push(file);
  }
  return files.sort();
}

function platformMatches(directory, tankName = "tiny tank") {
  return summaryFiles(directory).map(file => {
    const value = readJson(file); const tank = value.summary?.tanks?.[tankName];
    invariant(tank && Number.isSafeInteger(tank.runtimeMs), "V1_PLATFORM_RUNTIME_MISSING",
      path.relative(directory, file));
    const participant = Object.values(value.participants || {}).find(item => item.tankName === tankName);
    return { matchUrlId: value.match?.urlId || path.basename(path.dirname(file)),
      codeHash: participant?.codeHash || null, frames: value.summary.framesTotal,
      runtimeMs: tank.runtimeMs, runtimePerFrameMilli: value.summary.framesTotal ?
        Math.round(tank.runtimeMs * 1000 / value.summary.framesTotal) : 0,
      outcome: value.summary.result?.winner === tankName ? "WIN" : "LOSS",
      resultReason: value.match?.resultReason || null };
  });
}

function buildRuntimeEvidence(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const sourceFile = contained(root, options.sourcePath || DEFAULT_SOURCE);
  const capabilityFile = contained(root, options.capabilityPath || DEFAULT_CAPABILITY);
  const evidenceDirectory = contained(root, options.evidencePath || DEFAULT_EVIDENCE);
  const source = fs.readFileSync(sourceFile, "utf8"); const capability = readJson(capabilityFile);
  const matches = platformMatches(evidenceDirectory, options.tankName || "tiny tank");
  invariant(matches.length > 0, "V1_PLATFORM_EVIDENCE_EMPTY", evidenceDirectory);
  const slowest = matches.slice().sort((left, right) => right.runtimeMs - left.runtimeMs)[0];
  const sourceControl = sourceFacts(source); const platformCapability = capabilityFacts(capability);
  const dateConfirmedCallable = platformCapability.dateNow?.status === "SUPPORTED";
  const report = { schemaVersion: 1, reportKind: "IMP8_V1_PLATFORM_RUNTIME_EVIDENCE",
    evidenceScope: "PLATFORM_RUNTIME_AND_STATIC_SOURCE_CONTROL_FLOW",
    source: { relativePath: path.relative(root, sourceFile), sha256: sha256Bytes(source) },
    capability: { relativePath: path.relative(root, capabilityFile), ...platformCapability },
    platformHistory: { relativeDirectory: path.relative(root, evidenceDirectory), matches,
      matchCount: matches.length, slowest }, sourceControl,
    determinations: {
      platformWholeMatchRuntimeIsHardConstraint: true,
      localElapsedMillisecondsMayPredictPlatformTimeout: false,
      localElapsedMillisecondsUse: "SAME_HOST_RELATIVE_ORDER_ONLY",
      v1TimeFallbackActivationFromReplay: "UNOBSERVABLE",
      v1TimeFallbackActivationFromCapability: dateConfirmedCallable ? "POSSIBLE" : "NOT_CONFIRMED",
      v1GuaranteedFallbackMechanism: "FIXED_NODE_AND_DEPTH_BOUNDS",
      attribution: "V1 stability must be attributed to its unconditional node/depth bounds; its Date.now-based thresholds are conditional and cannot be credited without direct callback evidence.",
      v2BudgetRule: "Use deterministic charged work counters calibrated against the v1 fixed-search envelope; never convert local milliseconds into platform milliseconds."
    }, fingerprint: "" };
  report.fingerprint = fingerprintObject(report); return report;
}

function writeRuntimeEvidence(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const report = buildRuntimeEvidence(options); const directory = path.resolve(options.outputDirectory ||
    contained(root, "artifacts", "imp8", "calibration", "runtime-envelope-v1"));
  ensureDirectory(directory); writeJsonAtomic(path.join(directory, "runtime-evidence-report.json"), report,
    { mode: 0o644 });
  writeJsonImmutable(path.join(directory, "history", `runtime-evidence-${report.fingerprint}.json`), report,
    { mode: 0o644 });
  return { report, directory };
}

module.exports = { DEFAULT_SOURCE, DEFAULT_CAPABILITY, DEFAULT_EVIDENCE, integerConstant,
  sourceFacts, capabilityFacts, platformMatches, buildRuntimeEvidence, writeRuntimeEvidence };
