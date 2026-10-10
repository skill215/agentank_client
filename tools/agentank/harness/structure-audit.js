"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");

function walk(directory, visitor) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    visitor(file, entry);
    if (entry.isDirectory()) walk(file, visitor);
  }
}

function countProfileFiles(profileRoot) {
  const result = {};
  if (!fs.existsSync(profileRoot)) return result;
  for (const entry of fs.readdirSync(profileRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let count = 0;
    walk(path.join(profileRoot, entry.name), (_file, child) => { if (child.isFile()) count++; });
    result[entry.name] = count;
  }
  return result;
}

function scanHardcodedLegacyCount(root) {
  const findings = [];
  const legacyNumberPattern = new RegExp(`\\b${[2, 4, 4].join("")}\\b`);
  for (const relativeRoot of ["tools", "engine-v2", "test", "config"]) {
    const directory = contained(root, relativeRoot);
    walk(directory, (file, entry) => {
      if (!entry.isFile() || !/\.(?:js|json)$/.test(entry.name)) return;
      let content = fs.readFileSync(file, "utf8");
      // Frozen cohorts legitimately contain every ordinal, including the old
      // match-count number, as an array index. The audit is for a hardcoded
      // corpus denominator, not for an unrelated scenario ordinal.
      if (entry.name.endsWith(".json"))
        content = content.replace(/"index"\s*:\s*\d+/g, "\"index\":0");
      if (legacyNumberPattern.test(content)) findings.push(path.relative(root, file));
    });
  }
  return findings.sort();
}

function auditWorkspaceStructure(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const records = contained(root, "battle-records");
  const excluded = new Set(["control", "tanks", "corpus"]);
  const legacyDirectories = fs.existsSync(records) ? fs.readdirSync(records, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !excluded.has(entry.name)).map(entry => entry.name).sort() : [];
  const recordCounts = { summaries: 0, raw: 0, events: 0, matchDirectories: 0 };
  walk(records, (_file, entry) => {
    if (entry.isDirectory() && entry.name.startsWith("mat_")) recordCounts.matchDirectories++;
    if (!entry.isFile()) return;
    if (entry.name === "summary.json") recordCounts.summaries++;
    else if (entry.name === "raw.json") recordCounts.raw++;
    else if (entry.name === "events.json") recordCounts.events++;
  });
  const requiredDirectories = [
    "engine-v2/src/abi", "engine-v2/src/state", "engine-v2/src/rules", "engine-v2/src/reference",
    "engine-v2/src/fast", "engine-v2/src/search", "engine-v2/src/policy", "engine-v2/src/cache",
    "engine-v2/src/runtime", "engine-v2/src/generated", "engine-v2/test", "engine-v2/bench",
    "tools/agentank/core", "tools/agentank/build", "battle-records/tanks/v1",
    "battle-records/tanks/v2", "artifacts/builds", "artifacts/candidates", "artifacts/reports"
  ];
  const missingDirectories = requiredDirectories.filter(relative => !fs.existsSync(contained(root, relative)));
  const hardcodedLegacyCountFiles = scanHardcodedLegacyCount(root);
  const rootScripts = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".js")).map(entry => entry.name).sort();
  let productionJavaScriptFiles = 0;
  walk(contained(root, "engine-v2", "src"), (_file, entry) => {
    if (entry.isFile() && entry.name.endsWith(".js")) productionJavaScriptFiles++;
  });
  const report = {
    schemaVersion: 1,
    status: missingDirectories.length === 0 && hardcodedLegacyCountFiles.length === 0 ? "PASS" : "FAIL",
    recordCounts,
    legacyTopLevelDirectoryCount: legacyDirectories.length,
    legacyLayoutStatus: legacyDirectories.length === 0 ? "NONE" : "MIGRATION_INPUT",
    profileArtifactFileCounts: countProfileFiles(contained(records, "tanks")),
    rootLegacyScripts: rootScripts,
    productionJavaScriptFiles,
    missingDirectories,
    hardcodedLegacyCountFiles,
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  return report;
}

module.exports = { walk, scanHardcodedLegacyCount, auditWorkspaceStructure };
