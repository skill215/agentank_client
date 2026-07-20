#!/usr/bin/env node
"use strict";

const path = require("path");
const { readJson, writeTextAtomic } = require("./common");

const batchRoot = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("usage: write-batch-report.js <batch-dir>");
const analysis = readJson(path.join(batchRoot, "analysis.json"));

function pct(numerator, denominator) {
  return denominator ? `${(100 * numerator / denominator).toFixed(2)}%` : "—";
}
function md(value) { return String(value === null || value === undefined ? "unknown" : value).replace(/\|/g, "\\|"); }
function group(keyFn) {
  return Object.values(analysis.matches.reduce((result, match) => {
    const key = String(keyFn(match));
    const item = result[key] || (result[key] = { key, matches: 0, wins: 0, losses: 0, reasons: {} });
    item.matches++;
    item[match.outcome === "win" ? "wins" : "losses"]++;
    item.reasons[match.resultReason] = (item.reasons[match.resultReason] || 0) + 1;
    return result;
  }, {})).sort((a, b) => b.matches - a.matches || a.key.localeCompare(b.key));
}
function reasonText(reasons) {
  return Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([key, count]) => `${key} ${count}`).join("、");
}
function table(lines, headers, rows) {
  lines.push(`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) lines.push(`| ${row.map(md).join(" | ")} |`);
  lines.push("");
}

const lines = [
  "# 新增战斗自动分析", "",
  `生成时间：${analysis.generatedAt}`, "",
  `本批次共 ${analysis.matches.length} 场：${analysis.results.wins} 胜、${analysis.results.losses} 负，胜率 ${pct(analysis.results.wins, analysis.matches.length)}。`, ""
];
table(lines, ["结果", "场次", "帧数", "运行时间", "每帧耗时", "命中/开火", "撞墙/开火"],
  Object.entries(analysis.groups).map(([key, value]) => [key, value.matches, value.frames,
    `${value.runtimeMs}ms`, `${value.runtimePerFrame.toFixed(2)}ms`, pct(value.hits, value.shots), pct(value.walls, value.shots)]));

lines.push("## 按代码版本", "");
table(lines, ["代码哈希", "场次", "胜", "负", "胜率", "终局原因"],
  group(match => match.codeHash || "unknown").map(item => [item.key.slice(0, 16), item.matches,
    item.wins, item.losses, pct(item.wins, item.matches), reasonText(item.reasons)]));

lines.push("## 按对手", "");
table(lines, ["对手", "场次", "胜", "负", "胜率", "终局原因"],
  group(match => `${match.opponentTankId}:${match.opponent}`).map(item => [item.key, item.matches,
    item.wins, item.losses, pct(item.wins, item.matches), reasonText(item.reasons)]));

lines.push("## 按敌方技能", "");
table(lines, ["技能", "场次", "胜", "负", "胜率", "终局原因"],
  group(match => match.opponentSkill || "unknown").map(item => [item.key, item.matches,
    item.wins, item.losses, pct(item.wins, item.matches), reasonText(item.reasons)]));

lines.push("## 风险标签", "");
table(lines, ["标签", "场次"], Object.entries(analysis.flagCounts)
  .sort((a, b) => b[1] - a[1]).map(([key, count]) => [key, count]));
const deathGroups = group(match => match.deathDetail && match.deathDetail.subtype || "not-crashed-loss")
  .filter(item => item.key !== "not-crashed-loss");
lines.push("## 击毁失败子类", "");
table(lines, ["子类", "场次"], deathGroups.map(item => [item.key, item.matches]));

const timeouts = analysis.matches.filter(match => match.resultReason === "timeout");
lines.push("## Timeout 明细", "");
table(lines, ["Match", "对手", "技能", "帧数", "运行时间", "每帧", "星数", "回放"],
  timeouts.map(match => [match.urlId, match.opponent, match.opponentSkill, match.frames,
    `${match.runtimeMs}ms`, `${match.runtimePerFrame.toFixed(2)}ms`, `${match.stars}-${match.enemyStars}`,
    `[replay](${match.replayUrl})`]));

lines.push("## 文件", "",
  "- `analysis.json`：完整结构化指标。",
  "- `matches.csv`：全部比赛表。",
  "- `failures.csv`：失败及死亡上下文。",
  "- `classified/`：按结果、对手、技能、版本、风险标签生成的 Match ID 索引。", "");
writeTextAtomic(path.join(batchRoot, "ANALYSIS.md"), `${lines.join("\n")}\n`);
process.stdout.write(`${JSON.stringify({ report: path.join(batchRoot, "ANALYSIS.md"),
  matches: analysis.matches.length, timeouts: timeouts.length }, null, 2)}\n`);
