#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { readJson, writeTextAtomic, writeJsonAtomic, slug } = require("./common");

const batchRoot = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("usage: classify-match-batch.js <batch-dir>");
const analysis = readJson(path.join(batchRoot, "analysis.json"));
const classifiedRoot = path.join(batchRoot, "classified");
const dimensions = new Map([
  ["by-result", match => `${match.outcome}-${match.resultReason}`],
  ["by-opponent", match => `${match.opponentTankId}-${match.opponent}`],
  ["by-skill", match => match.opponentSkill || "unknown"],
  ["by-version", match => match.codeHash || "unknown"],
  ["by-risk", match => match.flags.length ? match.flags : ["clean"]]
]);
const catalog = {};

for (const [dimension, classifier] of dimensions) {
  const groups = new Map();
  for (const match of analysis.matches) {
    const rawKeys = classifier(match);
    for (const key of Array.isArray(rawKeys) ? rawKeys : [rawKeys]) {
      const values = groups.get(key) || [];
      values.push(match);
      groups.set(key, values);
    }
  }
  catalog[dimension] = [];
  for (const [key, matches] of [...groups].sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])))) {
    const directory = path.join(classifiedRoot, dimension, slug(key));
    const ids = matches.map(match => match.urlId).sort();
    writeTextAtomic(path.join(directory, "match-ids.txt"), `${ids.join("\n")}${ids.length ? "\n" : ""}`);
    writeJsonAtomic(path.join(directory, "summary.json"), {
      dimension, key, count: matches.length,
      wins: matches.filter(match => match.outcome === "win").length,
      losses: matches.filter(match => match.outcome === "loss").length,
      matchIds: ids
    });
    catalog[dimension].push({ key, directory: path.relative(batchRoot, directory), count: matches.length });
  }
}
writeJsonAtomic(path.join(classifiedRoot, "catalog.json"), {
  generatedAt: new Date().toISOString(), matches: analysis.matches.length, dimensions: catalog
});
const lines = ["# Match classification", "", `Matches: ${analysis.matches.length}`, ""];
for (const [dimension, groups] of Object.entries(catalog)) {
  lines.push(`## ${dimension}`, "");
  for (const group of groups) lines.push(`- ${group.key}: ${group.count}`);
  lines.push("");
}
writeTextAtomic(path.join(classifiedRoot, "README.md"), `${lines.join("\n")}\n`);
process.stdout.write(`${JSON.stringify({ classifiedRoot, matches: analysis.matches.length,
  groups: Object.fromEntries(Object.entries(catalog).map(([key, values]) => [key, values.length])) }, null, 2)}\n`);
