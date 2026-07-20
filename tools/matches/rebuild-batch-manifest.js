#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { readJson, writeJsonAtomic, completeRecordDirectory,
  manifestEntryFromRaw } = require("./common");

const batchRoot = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("usage: rebuild-batch-manifest.js <batch-dir>");
const manifestFile = path.join(batchRoot, "manifest.json");
let previous = {};
try { previous = readJson(manifestFile); } catch (_) {}
const matches = [];
const incomplete = [];
for (const entry of fs.readdirSync(batchRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith("mat_")) continue;
  const directory = path.join(batchRoot, entry.name);
  if (!completeRecordDirectory(directory)) { incomplete.push(entry.name); continue; }
  matches.push(manifestEntryFromRaw(readJson(path.join(directory, "raw.json")), directory));
}
matches.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
const manifest = {
  ...previous,
  generatedAt: new Date().toISOString(),
  reconstructedFromLocalFiles: true,
  missingCount: matches.length,
  downloadedCount: matches.length,
  count: matches.length,
  incompleteCount: incomplete.length,
  incomplete,
  matches
};
writeJsonAtomic(manifestFile, manifest);
process.stdout.write(`${JSON.stringify({ batchRoot, matches: matches.length,
  incomplete: incomplete.length }, null, 2)}\n`);
