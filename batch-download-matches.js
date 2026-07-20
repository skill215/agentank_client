#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const [pageFile, outputDir, cutoffText] = process.argv.slice(2);
if (!pageFile || !outputDir || !cutoffText) {
  throw new Error("usage: node batch-download-matches.js <page.json> <output-dir> <cutoff-iso>");
}

const cutoff = Date.parse(cutoffText);
const page = JSON.parse(fs.readFileSync(pageFile, "utf8"));
const matches = page.matches.filter(match => Date.parse(match.createdAt) >= cutoff);
fs.mkdirSync(outputDir, { recursive: true });

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Codex-AgenTank-batch-analysis/1.0" }
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, attempt * 250));
    }
  }
  throw lastError;
}

async function writeJson(file, value) {
  await fs.promises.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function downloadMatch(match) {
  const dir = path.join(outputDir, match.urlId);
  await fs.promises.mkdir(dir, { recursive: true });
  const base = `https://agentank.ai/api/matches/${match.urlId}/agent.json`;
  const views = [
    ["summary.json", base],
    ["events.json", `${base}?view=events`],
    ["raw.json", `${base}?view=raw`]
  ];
  for (const [name, url] of views) {
    const file = path.join(dir, name);
    let valid = false;
    if (fs.existsSync(file)) {
      try {
        JSON.parse(fs.readFileSync(file, "utf8"));
        valid = true;
      } catch {}
    }
    if (!valid) await writeJson(file, await fetchJson(url));
  }
  return match.urlId;
}

async function runPool(items, limit, task) {
  let cursor = 0;
  const completed = [];
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      completed.push(await task(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return completed;
}

(async () => {
  const completed = await runPool(matches, 8, downloadMatch);
  const manifest = {
    generatedAt: new Date().toISOString(),
    cutoffLocal: "2026-07-14T13:05:00+08:00",
    cutoffUtc: cutoffText,
    count: matches.length,
    matches: matches.map(match => ({
      id: match.id,
      urlId: match.urlId,
      createdAt: match.createdAt,
      settledAt: match.settledAt,
      source: match.source,
      winnerTankId: match.winnerTankId,
      resultReason: match.resultReason,
      challengerTankId: match.challengerTankId,
      defenderTankId: match.defenderTankId,
      challengerTankName: match.challengerTankName,
      defenderTankName: match.defenderTankName,
      challengerCodeHash: match.challengerCodeHash,
      defenderCodeHash: match.defenderCodeHash
    }))
  };
  await writeJson(path.join(outputDir, "manifest.json"), manifest);
  process.stdout.write(JSON.stringify({ requested: matches.length, completed: completed.length }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
