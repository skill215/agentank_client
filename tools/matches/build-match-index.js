#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { walk, readJson, writeTextAtomic, writeJsonAtomic,
  completeRecordDirectory } = require("./common");

const recordsRoot = path.resolve(process.argv[2] || "battle-records");
const indexRoot = path.resolve(process.argv[3] || path.join(recordsRoot, "index"));
const byId = new Map();
let invalid = 0;

for (const file of walk(recordsRoot, "raw.json")) {
  const directory = path.dirname(file);
  try {
    const raw = readJson(file);
    const id = raw.match && raw.match.urlId;
    if (!id) { invalid++; continue; }
    const relativeDirectory = path.relative(recordsRoot, directory);
    const item = byId.get(id) || { matchId: id, paths: [], completePaths: [] };
    item.paths.push(relativeDirectory);
    if (completeRecordDirectory(directory)) item.completePaths.push(relativeDirectory);
    byId.set(id, item);
  } catch (_) { invalid++; }
}

const entries = [...byId.values()].sort((a, b) => a.matchId.localeCompare(b.matchId));
for (const entry of entries) {
  entry.paths.sort((a, b) => a.length - b.length || a.localeCompare(b));
  entry.completePaths.sort((a, b) => a.length - b.length || a.localeCompare(b));
  entry.preferredPath = entry.completePaths[0] || entry.paths[0];
  entry.copyCount = entry.paths.length;
  entry.complete = entry.completePaths.length > 0;
}
const completeIds = entries.filter(entry => entry.complete).map(entry => entry.matchId);
writeTextAtomic(path.join(indexRoot, "match-ids.txt"), `${completeIds.join("\n")}${completeIds.length ? "\n" : ""}`);
writeJsonAtomic(path.join(indexRoot, "match-index.json"), {
  generatedAt: new Date().toISOString(), recordsRoot,
  uniqueMatches: entries.length, completeMatches: completeIds.length,
  incompleteMatches: entries.length - completeIds.length, invalidRawFiles: invalid,
  entries
});
process.stdout.write(`${JSON.stringify({ indexRoot, uniqueMatches: entries.length,
  completeMatches: completeIds.length, incompleteMatches: entries.length - completeIds.length,
  duplicateCopies: entries.reduce((sum, entry) => sum + entry.copyCount - 1, 0), invalid }, null, 2)}\n`);
