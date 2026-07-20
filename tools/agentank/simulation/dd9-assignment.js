"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { sha256Text, fingerprintObject } = require("../core/hash");
const { invariant } = require("../core/errors");
const { contained, defaultWorkspaceRoot } = require("../core/paths");

const SUBJECT_TANK_ID = 6821;
const SALT = "agentank-dd9-split-v1";
const SESSION_GAP_MS = 1_800_000;
const EXPECTED_ASSIGNMENT_FINGERPRINT =
  "46bd2d93615c77d4b87206670d7fb39621cbf8420a0c22fb839d664085ae29c8";
const LEGACY_CORPUS_MANIFEST = "docs/design/dd9-legacy-corpus-manifest.json";

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function legacyAggregateDirectory(root) {
  const locked = readJson(contained(root, LEGACY_CORPUS_MANIFEST));
  invariant(locked.status === "IMMUTABLE_NONBLIND_LEGACY_BASELINE" &&
    typeof locked.corpus?.aggregateDirectory === "string",
  "DD9_LEGACY_CORPUS_NOT_LOCKED", LEGACY_CORPUS_MANIFEST);
  return contained(root, locked.corpus.aggregateDirectory);
}

class Dsu {
  constructor(size) { this.parent = Array.from({ length: size }, (_, index) => index); }
  find(index) {
    let value = index;
    while (this.parent[value] !== value) {
      this.parent[value] = this.parent[this.parent[value]];
      value = this.parent[value];
    }
    return value;
  }
  union(left, right) {
    const a = this.find(left); const b = this.find(right);
    if (a !== b) this.parent[b] = a;
  }
}

function legacyRows(manifest, analysis) {
  const byId = new Map(analysis.matches.map(match => [match.urlId, match]));
  return manifest.matches.map((match, index) => {
    const legacy = byId.get(match.urlId);
    invariant(legacy, "DD9_ANALYSIS_MATCH_MISSING", match.urlId);
    const subjectSeat = match.challengerTankId === SUBJECT_TANK_ID ? 0 :
      match.defenderTankId === SUBJECT_TANK_ID ? 1 : -1;
    invariant(subjectSeat >= 0, "DD9_SUBJECT_TANK_MISSING", match.urlId);
    return {
      index,
      urlId: match.urlId,
      replayHash: match.replayHash,
      opponentTankId: subjectSeat === 0 ? match.defenderTankId : match.challengerTankId,
      mapHash: match.mapHash,
      ownSkillId: "stun",
      // This deliberately reproduces legacy schema v1. Null meant "not observed" there,
      // even though newer rolling-corpus code must preserve that fact as UNKNOWN.
      enemySkillId: legacy.opponentSkill || "none",
      ourCodeHash: subjectSeat === 0 ? match.challengerCodeHash : match.defenderCodeHash,
      createdAt: match.createdAt
    };
  });
}

function connectGroups(rows, dsu, fields, sessionBounded = false) {
  const groups = new Map();
  for (const row of rows) {
    const key = fields.map(field => String(row[field] ?? "")).join("\0");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => left.createdAt.localeCompare(right.createdAt) ||
      left.urlId.localeCompare(right.urlId));
    for (let index = 1; index < group.length; index += 1) {
      const gap = Date.parse(group[index].createdAt) - Date.parse(group[index - 1].createdAt);
      if (!sessionBounded || gap <= SESSION_GAP_MS) dsu.union(group[index - 1].index, group[index].index);
    }
  }
}

function roleForGroup(groupId) {
  const bucket = Number.parseInt(groupId.slice(0, 8), 16) % 10000;
  if (bucket < 5000) return { role: "DISCOVERY", bucket };
  if (bucket < 7500) return { role: "CALIBRATION", bucket };
  return { role: "FROZEN_REGRESSION", bucket };
}

function deriveAssignment(manifest, analysis) {
  const rows = legacyRows(manifest, analysis); const dsu = new Dsu(rows.length);
  connectGroups(rows, dsu, ["urlId"]);
  connectGroups(rows, dsu, ["replayHash"]);
  connectGroups(rows, dsu,
    ["opponentTankId", "mapHash", "ownSkillId", "enemySkillId", "ourCodeHash"]);
  connectGroups(rows, dsu,
    ["opponentTankId", "ownSkillId", "enemySkillId", "ourCodeHash"], true);

  const components = new Map();
  for (const row of rows) {
    const root = dsu.find(row.index);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(row.urlId);
  }
  const assignments = []; const groups = [];
  for (const values of components.values()) {
    const matchUrlIds = values.slice().sort();
    const groupId = sha256Text(`${SALT}\0${matchUrlIds.join("\n")}`);
    const { role, bucket } = roleForGroup(groupId);
    groups.push({ groupId, bucket, role, matchUrlIds });
    for (const matchUrlId of matchUrlIds) assignments.push({ matchUrlId, role, groupId });
  }
  assignments.sort((left, right) => left.matchUrlId.localeCompare(right.matchUrlId));
  groups.sort((left, right) => left.groupId.localeCompare(right.groupId));
  const encoding = assignments.map(item =>
    `${item.matchUrlId}\0${item.role}\0${item.groupId}\n`).join("");
  const assignmentFingerprint = sha256Text(encoding);
  const counts = {};
  for (const item of assignments) counts[item.role] = (counts[item.role] || 0) + 1;
  return {
    schemaVersion: 1,
    objectKind: "DD9_LEGACY_ASSIGNMENT",
    algorithmId: "DD9_CORRELATION_DSU_HASH_V1",
    salt: SALT,
    subjectTankId: SUBJECT_TANK_ID,
    sessionGapMs: SESSION_GAP_MS,
    matchCount: rows.length,
    groupCount: groups.length,
    counts,
    assignmentFingerprint,
    assignments,
    groups,
    fingerprint: ""
  };
}

function loadDd9Assignment(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const aggregate = legacyAggregateDirectory(root);
  const manifest = readJson(path.join(aggregate, "manifest.json"));
  const analysis = readJson(path.join(aggregate, "analysis.json"));
  const assignment = deriveAssignment(manifest, analysis);
  invariant(assignment.assignmentFingerprint === EXPECTED_ASSIGNMENT_FINGERPRINT,
    "DD9_ASSIGNMENT_FINGERPRINT_MISMATCH", assignment.assignmentFingerprint);
  invariant(assignment.groupCount === 162 && assignment.counts.DISCOVERY === 125 &&
    assignment.counts.CALIBRATION === 56 && assignment.counts.FROZEN_REGRESSION === 63,
  "DD9_ASSIGNMENT_CARDINALITY_MISMATCH", JSON.stringify(assignment.counts));
  assignment.fingerprint = fingerprintObject(assignment);
  return { assignment, manifest, analysis };
}

function idsForRole(assignment, role) {
  return assignment.assignments.filter(item => item.role === role).map(item => item.matchUrlId);
}

module.exports = { SUBJECT_TANK_ID, SALT, SESSION_GAP_MS, EXPECTED_ASSIGNMENT_FINGERPRINT,
  LEGACY_CORPUS_MANIFEST, legacyAggregateDirectory, legacyRows, deriveAssignment,
  loadDd9Assignment, idsForRole };
