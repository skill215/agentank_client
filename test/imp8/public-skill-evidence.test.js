"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { analyzeBoost, analyzeShield, analyzeCloak, analyzeTeleport, collectPublicSkillEvidence } =
  require("../../tools/agentank/discovery/public-skill-evidence");
const { runDiscoverySkillRegression } =
  require("../../tools/agentank/discovery/skill-regression-corpus");

function summary(urlId = "mat_A") {
  return { view: "summary", match: { urlId }, participants: {
    challenger: { tankId: 7, tankName: "无米粿", codeHash: "hash-1" },
    defender: { tankId: 8, tankName: "other", codeHash: "hash-2" } } };
}

function raw(urlId = "mat_A") {
  return { ...summary(urlId), view: "raw", replayData: { replay: { records: [[], [
    { type: "skill", action: "cast", skillType: "boost", by: 0, sourceObjectId: "tank-7" },
    { type: "skill", action: "applied", skillType: "boost", by: 0,
      sourceObjectId: "tank-7", durationFrames: 6 }
  ], [
    { type: "tank", action: "turn", objectId: "tank-7" },
    { type: "tank", action: "go", objectId: "tank-7", position: [1, 2] },
    { type: "tank", action: "go", objectId: "tank-7", position: [1, 3], boosted: true }
  ], [], [], [], [], [
    { type: "skill", action: "expired", skillType: "boost", by: 0,
      sourceObjectId: "tank-7" }
  ]] } } };
}

function response(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  return new Response(bytes, { status: 200, headers: { "content-type": "application/json" } });
}

test("Boost discovery confirms raw duration double-step and free-turn evidence", () => {
  const report = analyzeBoost({ id: 7, urlId: "tnk_7", name: "无米粿" },
    [{ urlId: "mat_A", summary: summary(), raw: raw() }]);
  assert.equal(report.claims.durationSixFrames.status, "CONFIRMED");
  assert.equal(report.claims.goMovesUpToTwoTiles.status, "CONFIRMED");
  assert.equal(report.claims.firstTurnCanBeFree.status, "CONFIRMED");
  assert.equal(report.claims.cooldownTwentySixFrames.status, "INCONCLUSIVE");
});

test("public evidence collector resolves an exact name and stores all three views", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-skill-evidence-"));
  const tank = { id: 7, urlId: "tnk_7", name: "无米粿", skillType: "boost" };
  const index = { matches: [{ urlId: "mat_A", challengerTankId: 7,
    challengerCodeHash: "hash-1", defenderCodeHash: "hash-2" }], hasMore: false };
  const fetchImpl = async url => {
    if (url.includes("/api/tanks?q=")) return response([tank]);
    if (url.includes("/api/tanks/tnk_7/matches")) return response(index);
    if (url.endsWith("?view=events")) return response({ ...summary(), view: "events", events: [] });
    if (url.endsWith("?view=raw")) return response(raw());
    return response(summary());
  };
  const result = await collectPublicSkillEvidence({ workspaceRoot: root, skill: "boost",
    tankName: "无米粿", limit: 1, knownMatchIds: ["mat_A"], runId: "fixture-run", fetchImpl,
    origin: "https://fixture.invalid" });
  for (const name of ["summary.json", "events.json", "raw.json", "artifact-manifest.json"])
    assert.ok(fs.existsSync(path.join(result.runDirectory, "matches", "mat_A", name)));
  assert.equal(result.analysis.collection.newlyDiscoveredMatchIds.length, 0);
  assert.equal(result.analysis.claims.goMovesUpToTwoTiles.status, "CONFIRMED");
});

test("Shield raw geometry requires two absorbed bullets before the shield expires", () => {
  const shieldSummary = summary(); const records = [[], [
    { type: "skill", action: "cast", skillType: "shield", by: 0, sourceObjectId: "tank-7" },
    { type: "skill", action: "applied", skillType: "shield", by: 0,
      sourceObjectId: "tank-7", durationFrames: 4 }
  ], [
    { type: "bullet", action: "go", objectId: "b1", position: [2, 2],
      tank: { id: "enemy" } },
    { type: "bullet", action: "crashed", objectId: "b1", tank: { id: "enemy" } }
  ], [
    { type: "bullet", action: "go", objectId: "b2", position: [2, 2],
      tank: { id: "enemy" } },
    { type: "skill", action: "expired", skillType: "shield", by: 0,
      sourceObjectId: "tank-7" },
    { type: "bullet", action: "crashed", objectId: "b2", tank: { id: "enemy" } }
  ]];
  const shieldRaw = { ...shieldSummary, view: "raw", replayData: { replay: { records,
    meta: { players: [{ tank: { id: "tank-7", position: [2, 2] } },
      { tank: { id: "enemy", position: [4, 2] } }] } } } };
  const report = analyzeShield({ id: 7, urlId: "tnk_7", name: "无米粿" },
    [{ urlId: "mat_A", summary: shieldSummary, raw: shieldRaw }]);
  assert.equal(report.claims.absorbsBulletWithoutDestroyingTank.status, "CONFIRMED");
  assert.equal(report.claims.firstBulletLeavesOneCharge.status, "CONFIRMED");
  assert.equal(report.claims.secondBulletConsumesShield.status, "CONFIRMED");
});

test("Cloak evidence separates observable duration and actions from hidden enemy observations", () => {
  const cloakSummary = summary(); const map = Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => ".")); map[2][2] = "o";
  const records = [[], [
    { type: "skill", action: "cast", skillType: "cloak", by: 0, sourceObjectId: "tank-7" },
    { type: "skill", action: "applied", skillType: "cloak", by: 0,
      sourceObjectId: "tank-7", durationFrames: 6 }
  ], [
    { type: "tank", action: "go", objectId: "tank-7", position: [2, 2] }
  ], [], [], [], [], [
    { type: "skill", action: "expired", skillType: "cloak", by: 0,
      sourceObjectId: "tank-7" }
  ], [], [], [], [], [], [], []];
  const cloakRaw = { ...cloakSummary, view: "raw", replayData: { map: { map }, replay: { records,
    meta: { players: [{ tank: { id: "tank-7", position: [1, 2] } },
      { tank: { id: "enemy", position: [4, 2] } }] } } } };
  const report = analyzeCloak({ id: 7, urlId: "tnk_7", name: "Nightjar" },
    [{ urlId: "mat_A", summary: cloakSummary, raw: cloakRaw }]);
  assert.equal(report.claims.durationSixFrames.status, "CONFIRMED");
  assert.equal(report.claims.doesNotPreventNormalActions.status, "CONFIRMED");
  assert.equal(report.claims.hidesTankFromEnemyObservation.status, "INCONCLUSIVE");
  assert.equal(report.implementationBehavior.manualCampPattern.status, "CONFIRMED");
});

test("Teleport evidence validates physical landing but keeps hidden request semantics unknown", () => {
  const teleportSummary = summary(); const map = Array.from({ length: 7 }, () =>
    Array.from({ length: 5 }, () => "."));
  const records = [[{ type: "star", action: "created", position: [3, 3] }], [
    { type: "skill", action: "cast", skillType: "teleport", by: 0,
      sourceObjectId: "tank-7" },
    { type: "skill", action: "applied", skillType: "teleport", by: 0,
      sourceObjectId: "tank-7", from: [1, 1], to: [4, 1] }
  ], [
    { type: "tank", action: "go", objectId: "tank-7", position: [5, 1] }
  ]];
  const teleportRaw = { ...teleportSummary, view: "raw", replayData: { map: { map }, replay: {
    records, meta: { players: [{ tank: { id: "tank-7", position: [1, 1], direction: "right" } },
      { tank: { id: "enemy", position: [6, 3], direction: "left" } }] } } } };
  const report = analyzeTeleport({ id: 7, urlId: "tnk_7", name: "哈基米OvO" },
    [{ urlId: "mat_A", summary: teleportSummary, raw: teleportRaw }]);
  assert.equal(report.claims.movesInstantlyToLegalTarget.status, "CONFIRMED");
  assert.equal(report.claims.supportsTargetsBeyondStarAdjacency.status, "CONFIRMED");
  assert.equal(report.claims.preservesDirection.status, "CONFIRMED");
  assert.equal(report.claims.starRequestReroutesAdjacent.status, "INCONCLUSIVE");
});

test("forty public skill matches form a hash-verified Discovery-only regression corpus", () => {
  const { report } = runDiscoverySkillRegression();
  assert.equal(report.status, "PASS");
  assert.equal(report.coverage.runCount, 4);
  assert.equal(report.coverage.matchMemberships, 40);
  assert.equal(report.coverage.uniqueMatches, 40);
  assert.equal(report.coverage.verifiedArtifacts, 120);
  assert.equal(report.laneIsolation.tuningAllowed, false);
  assert.equal(report.laneIsolation.calibrationMembership, 0);
  assert.equal(report.laneIsolation.frozenMembership, 0);
  assert.ok(report.runs.every(run => run.status === "PASS"));
});
