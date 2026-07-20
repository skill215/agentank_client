#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const RECORDS_ROOT = path.resolve(process.argv[2] || "battle-records");
const OUTPUT_ROOT = path.resolve(process.argv[3] || path.join(RECORDS_ROOT, `all-${Date.now()}`));

function walk(directory, basename, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, basename, output);
    else if (entry.isFile() && entry.name === basename) output.push(full);
  }
  return output;
}

const metadataById = new Map();
for (const file of walk(RECORDS_ROOT, "manifest.json")) {
  try {
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const match of manifest.matches || []) {
      if (!match.urlId) continue;
      const current = metadataById.get(match.urlId);
      const score = (match.challengerTankId ? 2 : 0) + (match.challengerCodeVersion ? 1 : 0);
      if (!current || score > current.score) metadataById.set(match.urlId, { score, match });
    }
  } catch (_) {}
}

const byId = new Map();
for (const file of walk(RECORDS_ROOT, "raw.json")) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const directory = path.dirname(file);
    const summaryFile = path.join(directory, "summary.json");
    if (!fs.existsSync(summaryFile) || !fs.existsSync(path.join(directory, "events.json"))) continue;
    const summary = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
    const compactMatch = summary.match || raw.match || {};
    const participants = summary.participants || raw.participants || {};
    const normalized = summary.urlId ? summary : {
      ...compactMatch,
      challengerTankId: participants.challenger && participants.challenger.tankId,
      defenderTankId: participants.defender && participants.defender.tankId,
      challengerTankName: participants.challenger && participants.challenger.tankName,
      defenderTankName: participants.defender && participants.defender.tankName,
      challengerCodeHash: participants.challenger && participants.challenger.codeHash,
      defenderCodeHash: participants.defender && participants.defender.codeHash
    };
    const enriched = metadataById.get(normalized.urlId);
    const match = { ...(enriched ? enriched.match : {}), ...normalized };
    if (!match.urlId || byId.has(match.urlId)) continue;
    byId.set(match.urlId, { ...match, directory: path.relative(OUTPUT_ROOT, directory) });
  } catch (_) {}
}

const matches = [...byId.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
const manifest = {
  generatedAt: new Date().toISOString(),
  cutoffLocal: "all locally recorded matches",
  cutoffUtc: "1970-01-01T00:00:00Z",
  count: matches.length,
  matches
};
fs.writeFileSync(path.join(OUTPUT_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT_ROOT, count: matches.length }, null, 2));
