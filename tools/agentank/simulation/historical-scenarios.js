"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { contained, defaultWorkspaceRoot } = require("../core/paths");
const { SUBJECT_TANK_ID, legacyAggregateDirectory } = require("./dd9-assignment");
const { sha256Bytes } = require("../core/hash");

let indexedCache = null;

function starTimeline(replayData) {
  const stars = [];
  const records = replayData.replay?.records || [];
  for (let frame = 0; frame < records.length; frame += 1) {
    for (const event of records[frame] || []) {
      if (event.type === "star" && event.action === "created" && Array.isArray(event.position))
        stars.push({ frame, position: event.position.slice() });
    }
  }
  return stars;
}

function scenarioFromMatch(match) {
  const replayData = match.replayData;
  invariant(replayData?.map?.map && replayData?.replay?.records,
    "HISTORICAL_REPLAY_INCOMPLETE", match.urlId);
  const subjectSeat = match.challengerTankId === SUBJECT_TANK_ID ? 0 :
    match.defenderTankId === SUBJECT_TANK_ID ? 1 : -1;
  invariant(subjectSeat >= 0, "HISTORICAL_SUBJECT_MISSING", match.urlId);
  const starts = replayData.map.players || replayData.replay.meta?.players?.map(item => item.tank);
  invariant(Array.isArray(starts) && starts.length === 2,
    "HISTORICAL_STARTS_MISSING", match.urlId);
  const stars = starTimeline(replayData);
  invariant(stars.length > 0 && stars[0].frame === 0,
    "HISTORICAL_INITIAL_STAR_MISSING", match.urlId);
  const scenario = {
    schemaVersion: 1,
    scenarioKind: "HISTORICAL_MAP_STAR_SEQUENCE",
    matchUrlId: match.urlId,
    mapHash: match.mapHash,
    matchSeed: String(replayData.matchSeed ?? "UNKNOWN"),
    originalSubjectSeat: subjectSeat,
    map: replayData.map.map.map(column => column.slice()),
    starts: starts.map((tank, index) => ({ id: `historical-seat-${index}`,
      position: tank.position.slice(), direction: tank.direction })),
    stars,
    originalFrames: replayData.replay.records.length,
    originalResult: replayData.replay.meta?.result || null,
    fingerprint: ""
  };
  scenario.fingerprint = fingerprintObject(scenario);
  return scenario;
}

function hydrateMatch(root, match) {
  if (match.replayData?.map?.map) return match;
  invariant(typeof match.directory === "string", "HISTORICAL_DIRECTORY_MISSING", match.urlId);
  const records = contained(root, "battle-records");
  const sourceDirectory = path.resolve(legacyAggregateDirectory(root), match.directory);
  invariant(sourceDirectory === records || sourceDirectory.startsWith(`${records}${path.sep}`),
    "HISTORICAL_DIRECTORY_ESCAPE", match.urlId);
  const rawFile = contained(records, path.relative(records, sourceDirectory), "raw.json");
  invariant(fs.existsSync(rawFile), "HISTORICAL_RAW_FILE_MISSING", match.urlId);
  const raw = JSON.parse(fs.readFileSync(rawFile, "utf8"));
  invariant(raw.replayData?.map?.map, "HISTORICAL_RAW_REPLAY_MISSING", match.urlId);
  return { ...match, replayData: raw.replayData };
}

function scenariosForIds(manifest, matchUrlIds, workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const byId = new Map(manifest.matches.map(match => [match.urlId, match]));
  return matchUrlIds.map(matchUrlId => {
    const match = byId.get(matchUrlId);
    invariant(match, "HISTORICAL_MATCH_NOT_FOUND", matchUrlId);
    return scenarioFromMatch(hydrateMatch(root, match));
  });
}

function loadFrozenV1Scenarios(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const snapshotFile = contained(root, "battle-records", "corpus", "imp7", "snapshot-v1.json");
  const ledgerFile = contained(root, "battle-records", "corpus", "imp7",
    "match-ledger-epoch-imp7-v2.jsonl");
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
  const entries = fs.readFileSync(ledgerFile, "utf8").split(/\r?\n/).filter(Boolean)
    .map(line => JSON.parse(line));
  const byId = new Map(entries.map(entry => [entry.matchUrlId, entry]));
  const scenarios = snapshot.matchUrlIds.map(matchUrlId => {
    const entry = byId.get(matchUrlId); invariant(entry && entry.subjectTankProfileId === "v1",
      "ROLLING_V1_LEDGER_ENTRY_MISSING", matchUrlId);
    const rawFile = contained(root, entry.artifacts.raw.relativePath);
    const bytes = fs.readFileSync(rawFile); invariant(sha256Bytes(bytes) === entry.artifacts.raw.sha256,
      "ROLLING_V1_RAW_HASH_MISMATCH", matchUrlId);
    const raw = JSON.parse(bytes); return scenarioFromMatch({ urlId: matchUrlId,
      mapHash: entry.mapHash, replayData: raw.replayData,
      challengerTankId: raw.participants?.challenger?.tankId,
      defenderTankId: raw.participants?.defender?.tankId });
  });
  return { snapshot, scenarios };
}

function loadIndexedV1Scenarios(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const indexFile = contained(root, "battle-records",
    "index", "match-index.json"); const stat = fs.statSync(indexFile);
  if (indexedCache && indexedCache.root === root && indexedCache.size === stat.size &&
      indexedCache.mtimeMs === stat.mtimeMs) return indexedCache.value;
  const frozen = loadFrozenV1Scenarios(root);
  const indexBytes = fs.readFileSync(indexFile); const index = JSON.parse(indexBytes);
  invariant(Array.isArray(index.entries), "ROLLING_V1_INDEX_ENTRIES_MISSING", indexFile);
  const scenarios = []; const matchUrlIds = []; const scenarioFingerprints = [];
  for (const entry of index.entries) {
    if (!entry.complete || typeof entry.preferredPath !== "string") continue;
    const rawFile = contained(root, "battle-records", entry.preferredPath, "raw.json");
    const raw = JSON.parse(fs.readFileSync(rawFile, "utf8"));
    const challenger = raw.participants?.challenger; const defender = raw.participants?.defender;
    if (challenger?.tankId !== SUBJECT_TANK_ID && defender?.tankId !== SUBJECT_TANK_ID) continue;
    const matchUrlId = raw.match?.urlId || entry.matchId;
    invariant(matchUrlId === entry.matchId, "ROLLING_V1_INDEX_ID_MISMATCH", entry.matchId);
    const scenario = scenarioFromMatch({ urlId: matchUrlId, mapHash: raw.match?.mapHash,
      replayData: raw.replayData, challengerTankId: challenger?.tankId,
      defenderTankId: defender?.tankId });
    scenarios.push(scenario); matchUrlIds.push(matchUrlId);
    scenarioFingerprints.push(scenario.fingerprint);
  }
  const frozenIds = new Set(frozen.snapshot.matchUrlIds); const indexSha256 = sha256Bytes(indexBytes);
  const snapshot = { schemaVersion: 1, objectKind: "DYNAMIC_V1_DISCOVERY_SNAPSHOT",
    snapshotId: `rolling-v1-${indexSha256.slice(0, 16)}`,
    headId: `match-index-${indexSha256.slice(0, 16)}`, ledgerWatermark: scenarios.length,
    subjectTankProfileIds: ["v1"], subjectTankId: SUBJECT_TANK_ID,
    matchUrlIds, matchSetRoot: fingerprintObject({ matchUrlIds }),
    scenarioRoot: fingerprintObject({ scenarioFingerprints }),
    sourceIndex: { relativePath: path.relative(root, indexFile).replaceAll("\\", "/"),
      sha256: indexSha256, uniqueMatches: index.uniqueMatches,
      completeMatches: index.completeMatches },
    frozenBaseline: { snapshotId: frozen.snapshot.snapshotId,
      matchCount: frozen.snapshot.matchUrlIds.length },
    discoveredBeyondFrozen: matchUrlIds.filter(id => !frozenIds.has(id)).length,
    purpose: "ROLLING_DISCOVERY_ONLY_DOES_NOT_MUTATE_FIXED_SR0", fingerprint: "" };
  snapshot.fingerprint = fingerprintObject(snapshot); const value = { snapshot, scenarios,
    frozenSnapshot: frozen.snapshot };
  indexedCache = { root, size: stat.size, mtimeMs: stat.mtimeMs, value }; return value;
}

function loadRollingV1Scenarios(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const indexFile = contained(root, "battle-records",
    "index", "match-index.json");
  return fs.existsSync(indexFile) ? loadIndexedV1Scenarios(root) : loadFrozenV1Scenarios(root);
}

function loadRollingV1ScenariosForIds(matchUrlIds, workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot); const indexFile = contained(root, "battle-records",
    "index", "match-index.json");
  invariant(fs.existsSync(indexFile), "ROLLING_V1_SELECTIVE_INDEX_MISSING", indexFile);
  const indexBytes = fs.readFileSync(indexFile); const index = JSON.parse(indexBytes);
  invariant(Array.isArray(index.entries), "ROLLING_V1_INDEX_ENTRIES_MISSING", indexFile);
  const byId = new Map(index.entries.map(entry => [entry.matchId, entry]));
  const scenarios = matchUrlIds.map(matchUrlId => {
    const entry = byId.get(matchUrlId);
    invariant(entry?.complete && typeof entry.preferredPath === "string",
      "ROLLING_V1_SELECTIVE_ENTRY_MISSING", matchUrlId);
    const rawFile = contained(root, "battle-records", entry.preferredPath, "raw.json");
    const raw = JSON.parse(fs.readFileSync(rawFile, "utf8"));
    const challenger = raw.participants?.challenger; const defender = raw.participants?.defender;
    invariant(challenger?.tankId === SUBJECT_TANK_ID || defender?.tankId === SUBJECT_TANK_ID,
      "ROLLING_V1_SELECTIVE_SUBJECT_MISSING", matchUrlId);
    invariant((raw.match?.urlId || entry.matchId) === matchUrlId,
      "ROLLING_V1_SELECTIVE_ID_MISMATCH", matchUrlId);
    return scenarioFromMatch({ urlId: matchUrlId, mapHash: raw.match?.mapHash,
      replayData: raw.replayData, challengerTankId: challenger?.tankId,
      defenderTankId: defender?.tankId });
  });
  return { scenarios, sourceIndex: {
    relativePath: path.relative(root, indexFile).replaceAll("\\", "/"),
    sha256: sha256Bytes(indexBytes), requestedMatches: matchUrlIds.length
  } };
}

function createHistoricalStarProvider(stars) {
  let index = 1; let calls = 0; let provided = 0; let earlyWaits = 0;
  return {
    initialStar: stars[0]?.position.slice() || null,
    provider({ frame }) {
      calls += 1; const next = stars[index];
      if (!next) return null;
      if (frame < next.frame) { earlyWaits += 1; return null; }
      index += 1; provided += 1; return next.position.slice();
    },
    stats() { return { calls, provided, earlyWaits, consumed: index,
      expected: stars.length, exhausted: index >= stars.length }; }
  };
}

module.exports = { starTimeline, scenarioFromMatch, hydrateMatch, scenariosForIds,
  loadFrozenV1Scenarios, loadIndexedV1Scenarios, loadRollingV1Scenarios,
  loadRollingV1ScenariosForIds, createHistoricalStarProvider };
