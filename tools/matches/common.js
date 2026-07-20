"use strict";

const fs = require("fs");
const path = require("path");

function walk(directory, basename, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, basename, output);
    else if (entry.isFile() && entry.name === basename) output.push(full);
  }
  return output;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.pending-${process.pid}`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
}

function writeJsonAtomic(file, value) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function completeRecordDirectory(directory) {
  for (const name of ["summary.json", "events.json", "raw.json"]) {
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) return false;
    try { readJson(file); } catch (_) { return false; }
  }
  return true;
}

function manifestEntryFromRaw(raw, directory) {
  const match = raw.match || raw;
  const challenger = raw.participants && raw.participants.challenger || {};
  const defender = raw.participants && raw.participants.defender || {};
  if (!match.urlId) throw new Error(`raw replay has no match urlId: ${directory}`);
  return {
    id: match.id,
    urlId: match.urlId,
    createdAt: match.createdAt,
    settledAt: match.settledAt,
    source: match.source || raw.source || "recorded",
    winnerTankId: match.winnerTankId,
    resultReason: match.resultReason,
    challengerTankId: challenger.tankId,
    defenderTankId: defender.tankId,
    challengerTankName: challenger.tankName,
    defenderTankName: defender.tankName,
    challengerCodeHash: challenger.codeHash,
    defenderCodeHash: defender.codeHash,
    directory: path.basename(directory)
  };
}

function slug(value) {
  const normalized = String(value === null || value === undefined ? "unknown" : value)
    .normalize("NFKC").trim().replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 96);
  return normalized || "unknown";
}

module.exports = {
  walk,
  readJson,
  writeTextAtomic,
  writeJsonAtomic,
  completeRecordDirectory,
  manifestEntryFromRaw,
  slug
};
