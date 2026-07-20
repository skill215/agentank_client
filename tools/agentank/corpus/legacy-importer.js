"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { sha256Bytes, sha256Text, fingerprintObjectOmitting } = require("../core/hash");

function latestAggregate(root) {
  const records = path.join(root, "battle-records"); const candidates = [];
  for (const name of fs.readdirSync(records)) {
    if (!/^all-\d+-/.test(name)) continue;
    const file = path.join(records, name, "manifest.json"); if (!fs.existsSync(file)) continue;
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    invariant(Array.isArray(manifest.matches), "CORPUS_SOURCE_MANIFEST_INVALID", name);
    const unique = new Set(manifest.matches.map(item => item.urlId));
    invariant(unique.size === manifest.matches.length && manifest.count === manifest.matches.length,
      "CORPUS_SOURCE_DUPLICATE", name);
    candidates.push({ name, directory: path.dirname(file), manifest, count: unique.size });
  }
  invariant(candidates.length > 0, "CORPUS_SOURCE_NOT_FOUND", "no aggregate corpus source");
  candidates.sort((a, b) => b.count - a.count || b.manifest.generatedAt.localeCompare(a.manifest.generatedAt));
  return candidates[0];
}

function artifact(root, file, downloadedAt) {
  invariant(fs.existsSync(file), "LEDGER_ARTIFACT_MISSING", path.relative(root, file));
  const bytes = fs.readFileSync(file); invariant(bytes.length > 0, "LEDGER_ARTIFACT_EMPTY", file);
  try { JSON.parse(bytes); } catch { invariant(false, "LEDGER_ARTIFACT_SCHEMA_INVALID", file); }
  return { relativePath: path.relative(root, file), bytes: bytes.length, sha256: sha256Bytes(bytes),
    schemaStatus: "LEGACY_VALID", downloadedAt };
}

function replay(raw) { return raw.replayData?.replay || raw.replayData?.replayData?.replay ||
  raw.replayData?.replayData || raw.replayData || {}; }
function recordsOf(raw) { const value = replay(raw).records; return Array.isArray(value) ? value : []; }
function skillEvidence(records, seat, fallback) {
  for (const frame of records) for (const event of frame || []) if (event.type === "skill" &&
      event.action === "cast" && event.by === seat && typeof event.skillType === "string")
    return { skillId: event.skillType, provenance: "OBSERVED_CAST", evidenceArtifactIds: ["raw"] };
  return fallback || { skillId: "UNKNOWN", provenance: "UNKNOWN", evidenceArtifactIds: [] };
}
function terminalOf(match, raw, subjectSeat) {
  const replayValue = replay(raw); const records = recordsOf(raw); const meta = replayValue.meta || {};
  const players = Array.isArray(meta.players) ? meta.players : []; const result = meta.result || {};
  const runtime = [0, 1].map(seat => Number.isSafeInteger(players[seat]?.runTime) ? players[seat].runTime : null);
  const stars = [0, 0]; let crashes = 0;
  for (const frame of records) for (const event of frame || []) {
    if (event.type === "star" && event.action === "collected" && (event.by === 0 || event.by === 1)) stars[event.by] += 1;
    if (event.type === "tank" && event.action === "crashed") crashes += 1;
  }
  const rawReason = match.resultReason ?? result.reason ?? null; const lower = String(rawReason || "").toLowerCase();
  const winnerSeat = match.winnerTankId === match.challengerTankId ? 0 :
    match.winnerTankId === match.defenderTankId ? 1 : result.winner === 0 || result.winner === 1 ? result.winner : null;
  let terminalClass = "TERMINAL_INCOMPLETE";
  if (/error/.test(lower)) terminalClass = "SCRIPT_ERROR";
  else if (/timeout/.test(lower)) terminalClass = "RUNTIME_TIMEOUT";
  else if (crashes === 1) terminalClass = "SINGLE_CRASH";
  else if (crashes > 1 && /star/.test(lower)) terminalClass = "MUTUAL_CRASH_STAR";
  else if (crashes > 1 && /runtime|runTime/i.test(String(rawReason))) terminalClass = "MUTUAL_CRASH_RUNTIME";
  else if (/star/.test(lower)) terminalClass = "FRAME_LIMIT_STAR";
  else if (/runtime|runTime/i.test(String(rawReason))) terminalClass = "FRAME_LIMIT_RUNTIME";
  else if (winnerSeat === null && rawReason && /draw/.test(lower)) terminalClass = "EXACT_DRAW";
  return { resultReasonRaw: rawReason, terminalClass, winnerSeat, recordCount: records.length,
    stars, runtimeMs: runtime, recordedMatch: true, scoreEligibility: "UNKNOWN",
    standingDelta: Array.isArray(match.rankChanges) ? match.rankChanges.find(x =>
      x.tankId === (subjectSeat === 0 ? match.challengerTankId : match.defenderTankId))?.delta ?? null : null };
}

function importAggregate(root, source = latestAggregate(root)) {
  const registry = JSON.parse(fs.readFileSync(path.join(root, "battle-records/control/tank-registry.json")));
  const legacyContract = JSON.parse(fs.readFileSync(path.join(root, "docs/design/dd9-legacy-corpus-manifest.json")));
  const legacyAggregate = JSON.parse(fs.readFileSync(path.join(root, legacyContract.corpus.aggregateDirectory, "manifest.json")));
  const legacyIds = new Set(legacyAggregate.matches.map(item => item.urlId));
  const profiles = new Map(registry.profiles.map(item => [item.tankId, item])); const entries = [];
  for (const match of source.manifest.matches) {
    const profile = profiles.get(match.challengerTankId) || profiles.get(match.defenderTankId);
    invariant(profile, "SUBJECT_PROFILE_UNKNOWN", match.urlId);
    const subjectSeat = match.challengerTankId === profile.tankId ? 0 : 1; const opponentSeat = 1 - subjectSeat;
    const directory = path.resolve(source.directory, match.directory);
    invariant(directory.startsWith(`${path.resolve(root)}${path.sep}`), "CORPUS_PATH_ESCAPE", match.directory);
    const rawFile = path.join(directory, "raw.json"); const raw = JSON.parse(fs.readFileSync(rawFile));
    const records = recordsOf(raw); const subjectPrefix = subjectSeat === 0 ? "challenger" : "defender";
    const enemyPrefix = opponentSeat === 0 ? "challenger" : "defender";
    const ownHash = match[`${subjectPrefix}CodeHash`] || null;
    const known = profile.branches.some(branch => branch.publishedCodeHash === ownHash);
    const ownFallback = known ? { skillId: profile.skillId, provenance: "BUILD_MANIFEST",
      evidenceArtifactIds: [`baseline:${profile.tankProfileId}:main`] } : null;
    const entry = { schemaVersion: 1, objectKind: "MATCH_LEDGER_ENTRY", ledgerSequence: entries.length + 1,
      matchUrlId: match.urlId, platformNumericId: Number.isSafeInteger(match.id) ? match.id : null,
      replayHash: match.replayHash || sha256Text(JSON.stringify(replay(raw))), createdAt: match.createdAt,
      settledAt: match.settledAt || null, ingestionAt: source.manifest.generatedAt,
      subjectTankProfileId: profile.tankProfileId,
      subject: { tankId: profile.tankId, codeHash: ownHash,
        codeVersion: Number.isSafeInteger(match[`${subjectPrefix}CodeVersion`]) ? match[`${subjectPrefix}CodeVersion`] : null,
        seat: subjectSeat },
      opponent: { tankId: match[`${enemyPrefix}TankId`], codeHash: match[`${enemyPrefix}CodeHash`] || null,
        codeVersion: Number.isSafeInteger(match[`${enemyPrefix}CodeVersion`]) ? match[`${enemyPrefix}CodeVersion`] : null,
        seat: opponentSeat }, mapId: String(match.mapId || "UNKNOWN"), mapHash: match.mapHash || null,
      terminal: terminalOf(match, raw, subjectSeat),
      ownSkill: skillEvidence(records, subjectSeat, ownFallback),
      enemySkill: skillEvidence(records, opponentSeat, null),
      artifacts: { summary: artifact(root, path.join(directory, "summary.json"), source.manifest.generatedAt),
        events: artifact(root, path.join(directory, "events.json"), source.manifest.generatedAt),
        raw: artifact(root, rawFile, source.manifest.generatedAt) },
      sourceBatchId: source.name, firstSeenRunId: source.name, legacySourcePaths: [match.directory],
      cohortRole: legacyIds.has(match.urlId) ? "DISCOVERY" : null,
      cohortId: legacyIds.has(match.urlId) ? "legacy-dd9" : null, forwardBatchId: null,
      entrySha256: "" };
    entry.entrySha256 = fingerprintObjectOmitting(entry, ["entrySha256"]); entries.push(entry);
  }
  return { source, entries };
}

module.exports = { latestAggregate, recordsOf, replay, terminalOf, importAggregate };
