"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeRuntimeCapabilityProfile } =
  require("../../tools/agentank/platform/capability-store");

test("official runtime probes select counter-budget mode and preserve a separate callback watchdog", () => {
  const current = { schemaVersion: 1, profileId: "v2", branch: "main",
    generatedAt: "2026-07-16T00:00:00.000Z", evidenceSnapshotIds: ["context"],
    evidenceTankProfileIds: ["v2"], facts: [], limits: { callbackP99Ms: { status: "UNKNOWN",
      value: null, source: "unknown", evidenceArtifactIds: [] } }, apiBehaviors: [], fingerprint: "old" };
  const clock = { probeId: "P2-RUNTIME-CLOCK", outcome: "CONCLUSIVE",
    targetEventReached: true, tankProfileId: "v2", responseSha256: "a".repeat(64),
    analysis: { runtimeGlobals: { Date: "object", DateNull: "true", DateNow: "none",
      performance: "undefined", performanceNow: "none" },
    publicRootKeys: { P2GAME: ["frames", "map"], P2STATUS: ["actionSpeed"] } } };
  const timeout = { probeId: "P2-TIMEOUT-BOUNDARY", responseSha256: "b".repeat(64),
    analysis: { playerLogs: [[{ type: "error", data: "script timeout at onIdle",
      runTime: 1500 }], []] } };
  const result = mergeRuntimeCapabilityProfile(current, clock, timeout,
    { now: "2026-07-16T01:00:00.000Z" });
  assert.equal(result.facts.find(item => item.name === "runtime.Date.now").status, "UNSUPPORTED");
  assert.equal(result.facts.find(item => item.name === "runtime.performance.now").status,
    "UNSUPPORTED");
  assert.equal(result.facts.find(item => item.name === "runtime.publicCumulativeMs").status,
    "UNSUPPORTED");
  assert.equal(result.facts.find(item => item.name === "runtime.counterBudgetMode").status,
    "SUPPORTED");
  assert.equal(result.limits.callbackWatchdogMs.value, 1500);
  assert.equal(result.limits.callbackP99Ms.status, "UNKNOWN");
});

test("an unprinted Date.now capability stays unknown while counter budgeting remains available", () => {
  const current = { schemaVersion: 1, profileId: "v2", branch: "main",
    generatedAt: "2026-07-16T00:00:00.000Z", evidenceSnapshotIds: ["context"],
    evidenceTankProfileIds: ["v2"], facts: [], limits: {}, apiBehaviors: [], fingerprint: "old" };
  const clock = { probeId: "P2-RUNTIME-CLOCK", outcome: "CONCLUSIVE",
    targetEventReached: true, tankProfileId: "v2", responseSha256: "c".repeat(64),
    analysis: { runtimeGlobals: { Date: "object", performance: "undefined",
      performanceNow: "none" }, publicRootKeys: { P2GAME: ["frames"] } } };
  const timeout = { probeId: "P2-TIMEOUT-BOUNDARY", responseSha256: "d".repeat(64),
    analysis: { playerLogs: [[{ type: "error", data: "script timeout at onIdle",
      runTime: 1500 }], []] } };
  const result = mergeRuntimeCapabilityProfile(current, clock, timeout);
  assert.equal(result.facts.find(item => item.name === "runtime.Date.now").status, "UNKNOWN");
  assert.equal(result.facts.find(item => item.name === "runtime.counterBudgetMode").status,
    "SUPPORTED");
});
