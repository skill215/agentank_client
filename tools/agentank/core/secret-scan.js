"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { SECRET_PATTERN } = require("./sanitize");

const DEFAULT_ROOTS = ["package.json", "tools", "config", "test", "engine-v2", "artifacts",
  path.join("battle-records", "control"), path.join("battle-records", "tanks")];
const SKIP_DIRECTORIES = new Set([".git", "node_modules"]);

function collectFiles(root, output) {
  if (!fs.existsSync(root)) return;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    output.push(root);
    return;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) collectFiles(full, output);
    else if (entry.isFile()) output.push(full);
  }
}

function scanForSecrets(workspaceRoot, roots = DEFAULT_ROOTS, exactSecrets = []) {
  const files = [];
  for (const root of roots) collectFiles(path.resolve(workspaceRoot, root), files);
  const findings = [];
  for (const file of files.sort()) {
    const bytes = fs.statSync(file).size;
    if (bytes > 16 * 1024 * 1024) continue;
    const content = fs.readFileSync(file, "utf8");
    SECRET_PATTERN.lastIndex = 0;
    const patterned = SECRET_PATTERN.test(content);
    const exact = exactSecrets.some(secret => secret && content.includes(secret));
    if (patterned || exact) findings.push({ relativePath: path.relative(workspaceRoot, file), bytes });
  }
  return { scannedFiles: files.length, findings };
}

module.exports = { DEFAULT_ROOTS, scanForSecrets };
