#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("./tools/matches/common");

const API_ROOT = "https://agentank.ai/api";
const RECORDS_ROOT = path.resolve(process.argv[2] || "battle-records");
const OUTPUT_ROOT = path.resolve(process.argv[3] || path.join(RECORDS_ROOT, `all-missing-${Date.now()}`));
const KEY = process.env.AGENTANK_KEY;

if (!KEY) throw new Error("AGENTANK_KEY is required");

function walk(directory, basename, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, basename, output);
    else if (entry.isFile() && entry.name === basename) output.push(full);
  }
  return output;
}

function localMatchIds() {
  const ids = new Set();
  for (const file of walk(RECORDS_ROOT, "raw.json")) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const match = raw.match || raw;
      const directory = path.dirname(file);
      const eventsFile = path.join(directory, "events.json");
      const summaryFile = path.join(directory, "summary.json");
      const events = fs.existsSync(eventsFile) ? JSON.parse(fs.readFileSync(eventsFile, "utf8")) : null;
      if (match.urlId && fs.existsSync(summaryFile) && raw.replayData && events && Array.isArray(events.events)) {
        ids.add(match.urlId);
      }
    } catch (_) {}
  }
  return ids;
}

async function requestJson(url, authenticated = false) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        headers: authenticated ? { Authorization: `Bearer ${KEY}` } : undefined,
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, attempt * 400));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function listAllMatches() {
  const matches = [];
  const seen = new Set();
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const page = await requestJson(`${API_ROOT}/agent/tank/matches?limit=${limit}&offset=${offset}`, true);
    const pageMatches = Array.isArray(page) ? page : (page.matches || []);
    for (const match of pageMatches) {
      if (!match.urlId || seen.has(match.urlId)) continue;
      seen.add(match.urlId);
      matches.push(match);
    }
    if (!page.hasMore || pageMatches.length === 0) break;
  }
  return matches;
}

async function downloadMatch(match) {
  const directory = path.join(OUTPUT_ROOT, match.urlId);
  fs.mkdirSync(directory, { recursive: true });
  const urls = {
    summary: `${API_ROOT}/matches/${match.urlId}`,
    events: `${API_ROOT}/matches/${match.urlId}/agent.json?view=events`,
    raw: `${API_ROOT}/matches/${match.urlId}/agent.json?view=raw`
  };
  const values = await Promise.all(Object.entries(urls).map(async ([name, url]) => {
    const value = await requestJson(url);
    writeJsonAtomic(path.join(directory, `${name}.json`), value);
    return [name, url];
  }));
  return { ...match, directory: match.urlId, urls: Object.fromEntries(values) };
}

async function mapLimited(values, limit, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= values.length) return;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

async function main() {
  const localBefore = localMatchIds();
  const serverMatches = await listAllMatches();
  const missing = serverMatches.filter(match => !localBefore.has(match.urlId));
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const attempts = await mapLimited(missing, 6, async match => {
    try { return { ok: true, match: await downloadMatch(match) }; }
    catch (error) { return { ok: false, match, error: error.message }; }
  });
  const downloaded = attempts.filter(item => item.ok).map(item => item.match);
  const failed = attempts.filter(item => !item.ok).map(item => ({
    urlId: item.match.urlId, createdAt: item.match.createdAt, error: item.error
  }));
  const manifest = {
    generatedAt: new Date().toISOString(),
    serverCount: serverMatches.length,
    localUniqueBefore: localBefore.size,
    missingCount: missing.length,
    downloadedCount: downloaded.length,
    count: downloaded.length,
    failedCount: failed.length,
    failed,
    matches: downloaded
  };
  writeJsonAtomic(path.join(OUTPUT_ROOT, "manifest.json"), manifest);
  console.log(JSON.stringify({
    output: OUTPUT_ROOT,
    serverCount: manifest.serverCount,
    localUniqueBefore: manifest.localUniqueBefore,
    downloadedCount: manifest.downloadedCount,
    failedCount: manifest.failedCount,
    newest: serverMatches[0] ? { urlId: serverMatches[0].urlId, createdAt: serverMatches[0].createdAt } : null
  }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
