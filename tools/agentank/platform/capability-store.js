"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { workspacePaths, assertBranch, assertProfileId, defaultWorkspaceRoot } =
  require("../core/paths");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { invariant } = require("../core/errors");
const { writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { validateSchemaObject } = require("../core/schema-validator");

function unknownMeasurement(name) {
  return { status: "UNKNOWN", value: null, source: `${name}:UNKNOWN`, evidenceArtifactIds: [] };
}

function initialCapabilityProfile(options) {
  assertProfileId(options.profile.tankProfileId);
  const branch = assertBranch(options.identity.branch);
  const localGuide = path.join(options.workspaceRoot, "docs", "agent-guide.md");
  const guideFile = options.guideFile || (fs.existsSync(localGuide) ? localGuide :
    path.join(defaultWorkspaceRoot(), "docs", "agent-guide.md"));
  invariant(fs.existsSync(guideFile), "GUIDE_SNAPSHOT_NOT_FOUND",
    "downloaded AgentTank guide snapshot is required");
  const guideSnapshotSha256 = sha256Bytes(fs.readFileSync(guideFile));
  const contextEvidence = [options.contextArtifact.artifactId];
  const value = {
    schemaVersion: 1,
    profileId: options.profile.tankProfileId,
    branch,
    engineId: null,
    guideSnapshotSha256,
    generatedAt: options.now,
    evidenceSnapshotIds: contextEvidence,
    evidenceTankProfileIds: [options.profile.tankProfileId],
    facts: [
      { name: "api.getTankContext", status: "SUPPORTED",
        evidenceLevel: "PLATFORM_REPLAY_CONFIRMED", evidenceArtifactIds: contextEvidence,
        notes: "Authenticated GET context completed for this TankProfile and branch." },
      { name: `tank.skill.${options.identity.skillId}`, status: "PRESENT",
        evidenceLevel: "PLATFORM_REPLAY_CONFIRMED", evidenceArtifactIds: contextEvidence,
        notes: "Own skill is profile-specific and is not promoted to a global platform fact." },
      { name: "runtime.Math.imul", status: "UNKNOWN", evidenceLevel: "UNKNOWN",
        evidenceArtifactIds: [], notes: null },
      { name: "runtime.TypedArray", status: "UNKNOWN", evidenceLevel: "UNKNOWN",
        evidenceArtifactIds: [], notes: null }
    ],
    limits: {
      sourceBytesMax: unknownMeasurement("sourceBytesMax"),
      publishBytesMax: unknownMeasurement("publishBytesMax"),
      coldInitP99Ms: unknownMeasurement("coldInitP99Ms"),
      callbackP99Ms: unknownMeasurement("callbackP99Ms"),
      callbackWatchdogMs: unknownMeasurement("callbackWatchdogMs"),
      wholeMatchRuntimeMs: unknownMeasurement("wholeMatchRuntimeMs"),
      mutationRateLimitMs: { status: "CONFIRMED", value: 2000,
        source: "AgentTank guide snapshot", evidenceArtifactIds: [] }
    },
    apiBehaviors: [
      { name: "api.simulate", status: "UNKNOWN", evidenceLevel: "UNKNOWN",
        evidenceArtifactIds: [], notes: null },
      { name: "api.publish", status: "UNKNOWN", evidenceLevel: "UNKNOWN",
        evidenceArtifactIds: [], notes: null },
      { name: "api.challenge", status: "UNKNOWN", evidenceLevel: "UNKNOWN",
        evidenceArtifactIds: [], notes: null }
    ],
    publishedCodeHashNormalizationId: null,
    fingerprint: ""
  };
  value.fingerprint = fingerprintObject(value);
  validateSchemaObject("platform-capability", value, options.schemaWorkspaceRoot || defaultWorkspaceRoot());
  return value;
}

function storeCapabilityProfile(options) {
  const value = initialCapabilityProfile(options);
  const root = workspacePaths(options.workspaceRoot).control;
  const directory = path.join(root, "capabilities", value.profileId, value.branch);
  const immutable = path.join(directory, "history", `capability-${value.fingerprint}.json`);
  writeJsonImmutable(immutable, value, { mode: 0o600 });
  writeJsonAtomic(path.join(directory, "capability-profile.json"), value, { mode: 0o600 });
  return { profile: value, relativePath: path.relative(options.workspaceRoot, immutable) };
}

function loadCurrentCapability(workspaceRoot, profileId, branch = "main") {
  assertProfileId(profileId);
  const file = path.join(workspacePaths(workspaceRoot).control, "capabilities", profileId,
    assertBranch(branch), "capability-profile.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function replaceFact(facts, fact) {
  return facts.filter(item => item.name !== fact.name).concat(fact).sort((left, right) =>
    left.name.localeCompare(right.name));
}

function mergeRuntimeCapabilityProfile(current, clockEvidence, timeoutEvidence, options = {}) {
  invariant(clockEvidence?.probeId === "P2-RUNTIME-CLOCK" &&
    clockEvidence.outcome === "CONCLUSIVE" && clockEvidence.targetEventReached === true,
  "RUNTIME_CLOCK_EVIDENCE_INCOMPLETE", "runtime clock evidence is not conclusive");
  invariant(clockEvidence.tankProfileId === current.profileId,
    "RUNTIME_CLOCK_PROFILE_MISMATCH", "runtime clock evidence belongs to another TankProfile");
  const globals = clockEvidence.analysis?.runtimeGlobals || {};
  const publicKeys = Object.values(clockEvidence.analysis?.publicRootKeys || {}).flat();
  const timeoutLogs = (timeoutEvidence?.analysis?.playerLogs || []).flat();
  const watchdogLog = timeoutLogs.find(log => typeof log?.data === "string" &&
    /script timeout/.test(log.data) && Number.isSafeInteger(log.runTime));
  invariant(watchdogLog, "CALLBACK_WATCHDOG_EVIDENCE_INCOMPLETE",
    "callback watchdog evidence has no timed script-timeout log");
  const clockArtifactId = `probe:${clockEvidence.probeId}:${clockEvidence.responseSha256}`;
  const timeoutArtifactId = `probe:${timeoutEvidence.probeId}:${timeoutEvidence.responseSha256}`;
  const clockFact = (name, status, notes) => ({ name, status,
    evidenceLevel: "PLATFORM_SIMULATION_CONFIRMED", evidenceArtifactIds: [clockArtifactId], notes });
  let facts = current.facts.slice();
  const dateNowStatus = globals.DateNow === "function" ? "SUPPORTED" :
    globals.DateNow === "none" ? "UNSUPPORTED" : "UNKNOWN";
  facts = replaceFact(facts, clockFact("runtime.Date.now",
    dateNowStatus,
    `typeof Date=${globals.Date}; Date===null is ${globals.DateNull}; typeof Date.now=${globals.DateNow}. ` +
      "A wall-clock mode requires an explicit function result; absence of that observation stays UNKNOWN."));
  facts = replaceFact(facts, clockFact("runtime.performance.now",
    globals.performanceNow === "function" ? "SUPPORTED" : "UNSUPPORTED",
    `typeof performance=${globals.performance}; typeof performance.now=${globals.performanceNow}.`));
  facts = replaceFact(facts, clockFact("runtime.publicCumulativeMs",
    publicKeys.some(key => /runtime|elapsed|duration/i.test(key)) ? "SUPPORTED" : "UNSUPPORTED",
    "No public me/status/game key exposes cumulative runtime in the inspected callback root."));
  const noConfirmedClock = globals.DateNow !== "function" && globals.performanceNow !== "function";
  facts = replaceFact(facts, clockFact("runtime.counterBudgetMode",
    noConfirmedClock ? "SUPPORTED" : "PRESENT",
    noConfirmedClock ? "Production must use calibrated deterministic work counters; no safe wall-clock mode is confirmed." :
      "Counter budget remains the portable fallback."));
  const apiBehaviors = replaceFact(current.apiBehaviors,
    { name: "api.simulate", status: "SUPPORTED", evidenceLevel: "PLATFORM_SIMULATION_CONFIRMED",
      evidenceArtifactIds: [clockArtifactId, timeoutArtifactId],
      notes: "Candidate-code official simulations returned replay evidence." });
  const value = { ...current, generatedAt: options.now || new Date().toISOString(),
    evidenceSnapshotIds: [...new Set(current.evidenceSnapshotIds.concat(clockArtifactId,
      timeoutArtifactId))].sort(),
    evidenceTankProfileIds: [...new Set(current.evidenceTankProfileIds.concat(current.profileId))].sort(),
    facts, limits: { ...current.limits,
      callbackWatchdogMs: { status: "CONFIRMED", value: watchdogLog.runTime,
        source: "P2-TIMEOUT-BOUNDARY official simulate script-timeout log",
        evidenceArtifactIds: [timeoutArtifactId] } }, apiBehaviors, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function reconcileRuntimeCapability(options) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const profileId = assertProfileId(options.profileId); const branch = assertBranch(options.branch || "main");
  const current = loadCurrentCapability(root, profileId, branch);
  invariant(current, "CAPABILITY_PROFILE_NOT_FOUND", "current CapabilityProfile is missing");
  const probeDirectory = path.join(root, "artifacts", "platform", "probes", "imp2");
  const clockFile = path.join(probeDirectory, "P2-RUNTIME-CLOCK.json");
  const timeoutFile = path.join(probeDirectory, "P2-TIMEOUT-BOUNDARY.json");
  invariant(fs.existsSync(clockFile) && fs.existsSync(timeoutFile), "RUNTIME_PROBE_EVIDENCE_NOT_FOUND",
    "runtime clock and timeout probe evidence are required");
  const clock = JSON.parse(fs.readFileSync(clockFile, "utf8"));
  const timeout = JSON.parse(fs.readFileSync(timeoutFile, "utf8"));
  for (const evidence of [clock, timeout]) {
    const raw = path.join(root, evidence.rawRelativePath);
    invariant(fs.existsSync(raw), "RUNTIME_PROBE_RAW_NOT_FOUND", "runtime probe raw response is missing");
    const rawValue = JSON.parse(fs.readFileSync(raw, "utf8"));
    invariant(sha256Text(JSON.stringify(rawValue)) === evidence.responseSha256,
      "RUNTIME_PROBE_RAW_HASH_MISMATCH", "runtime probe raw response hash differs from evidence");
  }
  const value = mergeRuntimeCapabilityProfile(current, clock, timeout, options);
  validateSchemaObject("platform-capability", value, root);
  const directory = path.join(workspacePaths(root).control, "capabilities", profileId, branch);
  const immutable = path.join(directory, "history", `capability-${value.fingerprint}.json`);
  writeJsonImmutable(immutable, value, { mode: 0o600 });
  writeJsonAtomic(path.join(directory, "capability-profile.json"), value, { mode: 0o600 });
  return { profile: value, immutable, relativePath: path.relative(root, immutable) };
}

module.exports = { unknownMeasurement, initialCapabilityProfile, storeCapabilityProfile,
  loadCurrentCapability, mergeRuntimeCapabilityProfile, reconcileRuntimeCapability };
