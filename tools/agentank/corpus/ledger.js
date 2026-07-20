"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { canonicalJson } = require("../core/canonical-json");
const { sha256Bytes, sha256Text, fingerprintObject, fingerprintObjectOmitting } = require("../core/hash");
const { invariant } = require("../core/errors");
const { validateSchemaObject } = require("../core/schema-validator");

const SESSION_GAP_MS = 1800000;
const ALLOWED_LATENESS_MS = 3600000;

function corpusPolicy(createdAt = "2026-07-16T07:06:52.703Z") {
  const value = { schemaVersion: 1, objectKind: "CORPUS_POLICY", policyId: "imp7-rolling-v1",
    algorithmId: "APPEND_STABLE_SESSION_V1", sessionGapMs: SESSION_GAP_MS,
    allowedLatenessMs: ALLOWED_LATENESS_MS, closeRequiresCompleteSync: true,
    saltId: "imp7-public-salt-v1", roleAssignmentId: "append-stable-hash-v1", createdAt,
    fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function artifactRoot(entries) {
  return sha256Text(entries.map(entry => `${entry.ledgerSequence}:${entry.matchUrlId}:` +
    `${entry.replayHash}:${entry.entrySha256}`).join("\n"));
}

function semanticValidateEntries(entries, workspaceRoot, options = {}) {
  const urls = new Set(); const replays = new Set();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]; validateSchemaObject("corpus", entry, workspaceRoot);
    invariant(entry.ledgerSequence === index + 1, "LEDGER_SEQUENCE_INVALID",
      `ledger sequence ${entry.ledgerSequence} is not append-contiguous`);
    invariant(!urls.has(entry.matchUrlId), "LEDGER_URL_DUPLICATE", entry.matchUrlId);
    invariant(!replays.has(entry.replayHash), "LEDGER_REPLAY_DUPLICATE", entry.replayHash);
    urls.add(entry.matchUrlId); replays.add(entry.replayHash);
    invariant(entry.entrySha256 === fingerprintObjectOmitting(entry, ["entrySha256"]),
      "LEDGER_ENTRY_HASH_INVALID", entry.matchUrlId);
    if (options.verifyArtifacts !== false) {
      for (const artifact of Object.values(entry.artifacts)) {
        const file = path.resolve(workspaceRoot, artifact.relativePath);
        invariant(file.startsWith(`${path.resolve(workspaceRoot)}${path.sep}`) && fs.existsSync(file),
          "LEDGER_ARTIFACT_MISSING", artifact.relativePath);
        const bytes = fs.readFileSync(file);
        invariant(bytes.length === artifact.bytes && sha256Bytes(bytes) === artifact.sha256,
          "LEDGER_ARTIFACT_CONFLICT", artifact.relativePath);
        try { JSON.parse(bytes); } catch { invariant(false, "LEDGER_ARTIFACT_SCHEMA_INVALID",
          artifact.relativePath); }
      }
    }
    invariant(entry.ownSkill.skillId !== "UNKNOWN" || entry.ownSkill.provenance === "UNKNOWN",
      "LEDGER_SKILL_PROVENANCE_INVALID", entry.matchUrlId);
    invariant(entry.enemySkill.skillId !== "UNKNOWN" || entry.enemySkill.provenance === "UNKNOWN",
      "LEDGER_SKILL_PROVENANCE_INVALID", entry.matchUrlId);
  }
  return { count: entries.length, artifactRoot: artifactRoot(entries) };
}

function appendEntries(existing, candidates) {
  const output = existing.map(item => ({ ...item }));
  const byUrl = new Map(output.map(item => [item.matchUrlId, item]));
  const byReplay = new Map(output.map(item => [item.replayHash, item]));
  let duplicates = 0;
  const ordered = candidates.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt) ||
    a.matchUrlId.localeCompare(b.matchUrlId));
  for (const raw of ordered) {
    const priorUrl = byUrl.get(raw.matchUrlId); const priorReplay = byReplay.get(raw.replayHash);
    if (priorUrl || priorReplay) {
      invariant(priorUrl && priorReplay && priorUrl.matchUrlId === priorReplay.matchUrlId &&
        priorUrl.subjectTankProfileId === raw.subjectTankProfileId &&
        priorUrl.artifacts.raw.sha256 === raw.artifacts.raw.sha256 &&
        priorUrl.artifacts.events.sha256 === raw.artifacts.events.sha256 &&
        priorUrl.artifacts.summary.sha256 === raw.artifacts.summary.sha256,
      "LEDGER_CONFLICT", `identity conflict for ${raw.matchUrlId}`);
      duplicates += 1; continue;
    }
    const entry = { ...raw, ledgerSequence: output.length + 1, entrySha256: "" };
    entry.entrySha256 = fingerprintObjectOmitting(entry, ["entrySha256"]);
    output.push(entry); byUrl.set(entry.matchUrlId, entry); byReplay.set(entry.replayHash, entry);
  }
  return { entries: output, appended: output.length - existing.length, duplicates };
}

function makeHead(entries, policy, generatedAt, previousHeadSha256 = null) {
  const root = artifactRoot(entries); const value = { schemaVersion: 1, objectKind: "CORPUS_HEAD",
    headId: `head_${root.slice(0, 24)}`, ledgerWatermark: entries.length,
    uniqueMatchCount: entries.length, artifactRoot: root,
    latestCreatedAt: entries.length ? entries.reduce((a, b) => a.createdAt > b.createdAt ? a : b).createdAt : null,
    generatedAt, policyFingerprint: policy.fingerprint, previousHeadSha256, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function makeSnapshot(entries, head, policy, profileId, purpose = "DISCOVERY") {
  const selected = entries.filter(entry => entry.subjectTankProfileId === profileId);
  const ids = selected.map(entry => entry.matchUrlId);
  const matchSetRoot = sha256Text(ids.slice().sort().join("\n"));
  const value = { schemaVersion: 1, objectKind: "CORPUS_SNAPSHOT",
    snapshotId: `snap_${profileId}_${matchSetRoot.slice(0, 20)}`, headId: head.headId,
    ledgerWatermark: head.ledgerWatermark, subjectTankProfileIds: [profileId], matchUrlIds: ids,
    matchSetRoot, artifactRoot: artifactRoot(selected), schemaVersions: { ledger: "1", replay: "legacy-agent-v1" },
    purpose, createdAt: head.generatedAt, policyFingerprint: policy.fingerprint, fingerprint: "" };
  value.fingerprint = fingerprintObject(value); return value;
}

function sessionKey(entry) { return `${entry.subject.codeHash || "UNKNOWN"}\0${entry.opponent.tankId}\0${entry.opponent.codeHash || "UNKNOWN"}`; }
function assignClosedCohorts(entries, policy, watermarkAt, closed = []) {
  const byId = new Map(entries.map(entry => [entry.matchUrlId, entry])); const assigned = new Set();
  const closedByKey = new Map();
  for (const cohort of closed) {
    for (const id of cohort.matchUrlIds) assigned.add(id);
    const exemplar = byId.get(cohort.matchUrlIds[0]); if (!exemplar) continue;
    const key = sessionKey(exemplar); const list = closedByKey.get(key) || [];
    list.push(cohort.cohortId); closedByKey.set(key, list);
  }
  const groups = []; const open = new Map(); const sorted = entries.filter(entry => !assigned.has(entry.matchUrlId)).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt) || a.matchUrlId.localeCompare(b.matchUrlId));
  for (const entry of sorted) {
    const key = sessionKey(entry);
    const prior = open.get(key); const time = Date.parse(entry.createdAt);
    if (!prior || time - prior.lastAt > policy.sessionGapMs) {
      const group = { key, firstAt: time, lastAt: time, entries: [entry] };
      groups.push(group); open.set(key, group);
    } else { prior.entries.push(entry); prior.lastAt = time; }
  }
  const additions = groups.filter(group => watermarkAt - group.lastAt >= policy.allowedLatenessMs).map(group => {
    const ids = group.entries.map(entry => entry.matchUrlId); const seed = sha256Text(
      `${policy.saltId}\0${group.key}\0${new Date(group.firstAt).toISOString()}`);
    const value = { schemaVersion: 1, objectKind: "COHORT_ASSIGNMENT",
      cohortId: `cohort_${seed.slice(0, 20)}`, sessionId: `session_${seed.slice(20, 40)}`,
      policyFingerprint: policy.fingerprint, matchUrlIds: ids, role: "DISCOVERY_APPEND",
      closedAt: new Date(group.lastAt + policy.allowedLatenessMs).toISOString(),
      relatedClosedCohortIds: (closedByKey.get(group.key) || []).slice().sort(), fingerprint: "" };
    value.fingerprint = fingerprintObject(value); return value;
  });
  return closed.concat(additions);
}

function encodeLedger(entries) { return entries.map(canonicalJson).join("\n") + (entries.length ? "\n" : ""); }
function decodeLedger(text) { return text.trim() ? text.trim().split(/\n/).map(line => JSON.parse(line)) : []; }

module.exports = { SESSION_GAP_MS, ALLOWED_LATENESS_MS, corpusPolicy, artifactRoot,
  semanticValidateEntries, appendEntries, makeHead, makeSnapshot, sessionKey, assignClosedCohorts,
  encodeLedger, decodeLedger };
