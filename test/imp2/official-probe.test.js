"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOfficialProbeClient } = require("../../tools/agentank/platform/probe-client");
const { PROBE_CANDIDATES, probeCandidate, analyzeProbeResponse, runOfficialRuleProbe } =
  require("../../tools/agentank/platform/rule-probe");
const { parseProbeOptions } = require("../../tools/agentank/cli/imp2-ops");

test("official probe command requires an explicit simulate authorization flag", async () => {
  const parsed = parseProbeOptions(["--probe-id", "P2-FAILED-CAST", "--profile", "v2"]);
  assert.equal(parsed.authorized, false);
  await assert.rejects(() => runOfficialRuleProbe(parsed),
    { code: "OFFICIAL_SIMULATE_AUTHORIZATION_REQUIRED" });
});

test("official probe client exposes only context GET and candidate simulate POST", async () => {
  const calls = [];
  const client = createOfficialProbeClient({ secret: "a".repeat(32), fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method, body: options.body });
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
  } });
  await client.getContext(); await client.simulate({ mapId: "arena", code: "function onIdle(){}" });
  assert.deepEqual(calls.map(item => item.method), ["GET", "POST"]);
  assert.ok(calls[1].url.endsWith("/agent/tank/simulate"));
  assert.equal(Object.hasOwn(client, "publish"), false); assert.equal(Object.hasOwn(client, "challenge"), false);
});

test("failed cast candidate is pinned to the v2 poison profile and arena probe", () => {
  const candidate = probeCandidate("P2-FAILED-CAST", "v2");
  assert.equal(candidate.mapId, "arena"); assert.equal(candidate.opponentId, "nova-scout");
  assert.match(candidate.code, /P2BASE/); assert.match(candidate.code, /P2EXP/);
  assert.throws(() => probeCandidate("P2-FAILED-CAST", "v1"),
    { code: "PROBE_CANDIDATE_NOT_IMPLEMENTED" });
});

test("every preregistered official probe has one profile-pinned candidate", () => {
  const plan = require("../../config/agentank/imp2-rule-probes.json");
  assert.deepEqual(Object.keys(PROBE_CANDIDATES).sort(),
    plan.probes.map(probe => probe.probeId).sort());
  for (const probe of plan.probes) {
    const expected = PROBE_CANDIDATES[probe.probeId];
    const candidate = probeCandidate(probe.probeId, expected.profileId);
    assert.equal(candidate.mapId, probe.mapId); assert.ok(candidate.code.includes("onIdle"));
    assert.throws(() => probeCandidate(probe.probeId,
      expected.profileId === "v1" ? "v2" : "v1"), { code: "PROBE_CANDIDATE_NOT_IMPLEMENTED" });
  }
});

test("targeted probe analysis records observed events without upgrading absent facts", () => {
  const response = { resultReason: "timeout", replay: { meta: { players: [
    { runTime: 2990, tank: { id: "a", position: [1, 1] } },
    { runTime: 2, tank: { id: "b", position: [3, 1] } }
  ], result: { reason: "timeout", winner: 1 } }, records: [
    [{ type: "skill", action: "applied", skillType: "poison", targetObjectId: "b" }],
    [], [{ type: "tank", action: "go", objectId: "b", position: [2, 1] }]
  ] } };
  const poison = analyzeProbeResponse("P2-POISON-EMPTY", response);
  assert.equal(poison.targetEventReached, true); assert.deepEqual(poison.targetActionFrames, [2]);
  assert.equal(poison.outcome, "INCONCLUSIVE"); assert.equal(poison.inferredVariant, null);
  const timeout = analyzeProbeResponse("P2-TIMEOUT-BOUNDARY", response);
  assert.equal(timeout.targetEventReached, true); assert.equal(timeout.outcome, "INCONCLUSIVE");
  const absent = analyzeProbeResponse("P2-TELEPORT-REVEAL", response);
  assert.equal(absent.targetEventReached, false); assert.equal(absent.outcome, "INCONCLUSIVE");
});

test("single-tank star pickup is not promoted to a star-contest rule", () => {
  const response = { replay: { meta: { players: [
    { tank: { id: "a", position: [1, 1] } }, { tank: { id: "b", position: [3, 1] } }
  ] }, records: [
    [{ type: "star", action: "created", position: [2, 1] }],
    [{ type: "speech", action: "say", by: 0, text: "P2SC:2,1" },
      { type: "tank", action: "go", objectId: "a", position: [2, 1] },
      { type: "star", action: "collected", by: 0 }]
  ] } };
  const analysis = analyzeProbeResponse("P2-STAR-CONTEST", response);
  assert.equal(analysis.targetEventReached, false); assert.equal(analysis.outcome, "INCONCLUSIVE");
});

test("move contest recognizes a marked GO blocked by a stationary occupied tank", () => {
  const response = { replay: { meta: { players: [
    { tank: { id: "a", position: [2, 1] } },
    { tank: { id: "b", position: [1, 1] } }
  ] }, records: [[
    { type: "speech", action: "say", by: 0, objectId: "a", text: "P2MC:1,1" },
    { type: "bullet", action: "created", objectId: "p", tank: {
      id: "b", position: [1, 1], direction: "down" } }
  ]] } };
  const analysis = analyzeProbeResponse("P2-MOVE-CONTEST", response);
  assert.equal(analysis.targetEventReached, true);
  assert.equal(analysis.outcome, "CONCLUSIVE");
  assert.equal(analysis.inferredVariant, "STATIC_OCCUPIED_BLOCK");
  assert.deepEqual(analysis.staticOccupiedBlockFrames, [0]);
  assert.equal(analysis.staticOccupiedBlockCount, 1);
});

test("move contest does not infer a block when the marked target was empty", () => {
  const response = { replay: { meta: { players: [
    { tank: { id: "a", position: [2, 1] } },
    { tank: { id: "b", position: [4, 1] } }
  ] }, records: [[
    { type: "speech", action: "say", by: 0, objectId: "a", text: "P2MC:1,1" }
  ]] } };
  const analysis = analyzeProbeResponse("P2-MOVE-CONTEST", response);
  assert.equal(analysis.targetEventReached, false);
  assert.equal(analysis.outcome, "INCONCLUSIVE");
});

test("exact runtime tie is conclusive only when both stars and integer runtime are equal", () => {
  const tied = analyzeProbeResponse("P2-EXACT-RUNTIME-TIE", { replay: { meta: { players: [
    { runTime: 4, tank: { id: "a", position: [1, 1] } },
    { runTime: 4, tank: { id: "b", position: [2, 1] } }
  ], result: { reason: "timeout", winner: null } }, records: [] } });
  assert.equal(tied.targetEventReached, true); assert.equal(tied.outcome, "CONCLUSIVE");
  const untied = analyzeProbeResponse("P2-EXACT-RUNTIME-TIE", { replay: { meta: { players: [
    { runTime: 4 }, { runTime: 5 }
  ] }, records: [] } });
  assert.equal(untied.targetEventReached, false); assert.equal(untied.outcome, "INCONCLUSIVE");
});

test("runtime clock probe distinguishes an absent wall clock from an unobserved environment", () => {
  const observed = analyzeProbeResponse("P2-RUNTIME-CLOCK", { replay: { meta: { players: [
    { tank: { id: "a" }, logs: [
      { type: "log", data: "P2ENV|Date=undefined|DateNull=false|DateNow=none|performance=undefined|performanceNow=none" },
      { type: "log", data: "P2GAME|frames,map,star" }
    ] }, { tank: { id: "b" } }
  ] }, records: [] } });
  assert.equal(observed.outcome, "CONCLUSIVE");
  assert.equal(observed.inferredVariant, "NO_WALL_CLOCK");
  assert.deepEqual(observed.publicRootKeys.P2GAME, ["frames", "map", "star"]);
  const partial = analyzeProbeResponse("P2-RUNTIME-CLOCK", { replay: { meta: { players: [
    { tank: { id: "a" }, logs: [
      { type: "log", data: "P2ENV|Date=object|performance=undefined|performanceNow=none" }
    ] }, { tank: { id: "b" } }
  ] }, records: [] } });
  assert.equal(partial.outcome, "CONCLUSIVE"); assert.equal(partial.inferredVariant, null);
  const absent = analyzeProbeResponse("P2-RUNTIME-CLOCK", { replay: { records: [] } });
  assert.equal(absent.outcome, "INCONCLUSIVE"); assert.equal(absent.inferredVariant, null);
});

test("official replay analysis requires cooldown speech evidence before resolving failed-cast semantics", () => {
  const conclusive = analyzeProbeResponse("P2-FAILED-CAST", { replay: { records: [
    { events: [{ type: "skill.failed", reason: "cooldown" }] }] } });
  assert.equal(conclusive.outcome, "INCONCLUSIVE"); assert.equal(conclusive.recordCount, 1);
  assert.equal(conclusive.targetEventReached, true);
  assert.equal(analyzeProbeResponse("P2-FAILED-CAST", { replay: { records: [] } }).outcome,
    "INCONCLUSIVE");
});
