#!/usr/bin/env node
"use strict";

const path = require("path");
const { readJson, writeJsonAtomic } = require("./common");

const recordsRoot = path.resolve(process.argv[2] || "battle-records");
const indexRoot = path.resolve(process.argv[3] || path.join(recordsRoot, "index"));
const matchIndex = readJson(path.join(indexRoot, "match-index.json"));
const votes = new Map();

function vote(tankId, skill) {
  if (!tankId || !skill) return;
  const counts = votes.get(tankId) || new Map();
  counts.set(skill, (counts.get(skill) || 0) + 1);
  votes.set(tankId, counts);
}

for (const item of matchIndex.entries) {
  if (!item.complete || !item.preferredPath) continue;
  try {
    const raw = readJson(path.join(recordsRoot, item.preferredPath, "raw.json"));
    const participants = raw.participants || {};
    const tankIds = [participants.challenger && participants.challenger.tankId,
      participants.defender && participants.defender.tankId];
    for (const frame of raw.replayData.replay.records) {
      for (const event of frame) {
        if (event.type === "skill" && event.action === "cast" &&
            (event.by === 0 || event.by === 1)) vote(tankIds[event.by], event.skillType);
      }
    }
  } catch (_) {}
}

const tanks = {};
for (const [tankId, counts] of votes) {
  const candidates = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  tanks[tankId] = {
    skill: candidates[0][0], observations: candidates.reduce((sum, item) => sum + item[1], 0),
    candidates: Object.fromEntries(candidates), conflicting: candidates.length > 1
  };
}
writeJsonAtomic(path.join(indexRoot, "tank-skills.json"), {
  generatedAt: new Date().toISOString(), sourceMatches: matchIndex.completeMatches,
  tankCount: Object.keys(tanks).length, tanks
});
process.stdout.write(`${JSON.stringify({ indexRoot, sourceMatches: matchIndex.completeMatches,
  tankCount: Object.keys(tanks).length,
  conflicts: Object.values(tanks).filter(item => item.conflicting).length }, null, 2)}\n`);
