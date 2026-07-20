#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2]);
if (!root) throw new Error("usage: node summarize-match-corpus.js <corpus-dir>");
const analysis = JSON.parse(fs.readFileSync(path.join(root, "analysis.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const metadata = new Map(manifest.matches.map(match => [match.urlId, match]));

function increment(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function wilson(wins, count) {
  if (!count) return [0, 0];
  const z = 1.96;
  const p = wins / count;
  const denominator = 1 + z * z / count;
  const center = (p + z * z / (2 * count)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * count)) / count) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

const skillVotes = new Map();
for (const match of analysis.matches) {
  if (!match.opponentSkill) continue;
  let votes = skillVotes.get(match.opponentTankId);
  if (!votes) skillVotes.set(match.opponentTankId, votes = new Map());
  votes.set(match.opponentSkill, (votes.get(match.opponentSkill) || 0) + 1);
}

function inferredSkill(tankId) {
  const votes = skillVotes.get(tankId);
  if (!votes) return "unknown";
  return [...votes].sort((a, b) => b[1] - a[1])[0][0];
}

function add(group, match) {
  group.matches++;
  group[match.outcome === "win" ? "wins" : "losses"]++;
  if (match.outcome === "loss") {
    increment(group.lossReasons, match.resultReason);
    if (match.deathDetail) increment(group.deathSubtypes, match.deathDetail.subtype);
  }
}

const opponents = new Map();
const skills = new Map();
const versions = new Map();
for (const match of analysis.matches) {
  let opponent = opponents.get(match.opponentTankId);
  if (!opponent) opponents.set(match.opponentTankId, opponent = {
    opponentTankId: match.opponentTankId, names: {}, skill: inferredSkill(match.opponentTankId),
    matches: 0, wins: 0, losses: 0, lossReasons: {}, deathSubtypes: {}
  });
  increment(opponent.names, match.opponent);
  add(opponent, match);

  const skillName = inferredSkill(match.opponentTankId);
  let skill = skills.get(skillName);
  if (!skill) skills.set(skillName, skill = {
    skill: skillName, opponents: new Set(), matches: 0, wins: 0, losses: 0,
    lossReasons: {}, deathSubtypes: {}
  });
  skill.opponents.add(match.opponentTankId);
  add(skill, match);

  const info = metadata.get(match.urlId) || {};
  const version = info.challengerTankId === 6821 ? info.challengerCodeVersion : info.defenderCodeVersion;
  let versionGroup = versions.get(version);
  if (!versionGroup) versions.set(version, versionGroup = { version, matches: 0, wins: 0, losses: 0, lossReasons: {}, deathSubtypes: {} });
  add(versionGroup, match);
}

function finish(group) {
  const interval = wilson(group.wins, group.matches);
  return {
    ...group,
    winRate: group.wins / group.matches,
    wilsonLow: interval[0],
    wilsonHigh: interval[1]
  };
}

const opponentRows = [...opponents.values()].map(opponent => finish({
  ...opponent,
  name: Object.entries(opponent.names).sort((a, b) => b[1] - a[1])[0][0]
})).sort((a, b) => a.winRate - b.winRate || b.matches - a.matches);
const skillRows = [...skills.values()].map(skill => finish({ ...skill, opponents: skill.opponents.size }))
  .sort((a, b) => a.winRate - b.winRate || b.matches - a.matches);
const versionRows = [...versions.values()].map(finish).sort((a, b) => (a.version || 0) - (b.version || 0));
const lowOpponents = opponentRows.filter(row => row.matches >= 2 && row.winRate < 0.6);
const newestTen = analysis.matches.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10)
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const weakestSkill = skillRows.filter(row => row.skill !== "unknown" && row.matches >= 3)
  .sort((a, b) => a.winRate - b.winRate || b.matches - a.matches)[0];
const bestSupportedLowOpponent = lowOpponents.slice()
  .sort((a, b) => b.matches - a.matches || a.winRate - b.winRate)[0];
const newestVersion = versionRows.filter(row => row.version !== null && row.version !== undefined)
  .sort((a, b) => b.version - a.version)[0];
const timeoutLosses = analysis.groups["loss/timeout"]?.matches || 0;
const runtimeLosses = analysis.groups["loss/runTime"]?.matches || 0;

const output = {
  generatedAt: new Date().toISOString(),
  overall: analysis.results,
  opponents: opponentRows,
  skills: skillRows,
  versions: versionRows,
  lowOpponents,
  newestTen
};
fs.writeFileSync(path.join(root, "opponent-skill-analysis.json"), `${JSON.stringify(output, null, 2)}\n`);

const lines = [
  "# 全部战斗：失败、对手与技能分类",
  "",
  `- 去重后共 ${analysis.results.wins + analysis.results.losses} 场：${analysis.results.wins} 胜 ${analysis.results.losses} 负，胜率 ${percent(analysis.results.winRate)}。`,
  `- 对手 tank id 共 ${opponentRows.length} 个；技能按同一对手历史中已观测到的固定技能回填，仍有 ${skillRows.find(row => row.skill === "unknown")?.matches || 0} 场无法推断。`,
  "- 低胜率只表示当前样本中的关联，不证明技能本身造成失败；重复约战、版本变化和对手代码强度都会造成偏差。",
  `- 当前语料中最高版本为 v${newestVersion?.version ?? "unknown"}，该版本有 ${newestVersion?.matches || 0} 场。`,
  "",
  "## 按技能",
  "",
  "| 对手技能 | 场次 | 对手数 | 胜-负 | 胜率 | 95% Wilson 区间 | 失败原因 |",
  "|---|---:|---:|---:|---:|---:|---|"
];
for (const row of skillRows) {
  lines.push(`| ${row.skill} | ${row.matches} | ${row.opponents} | ${row.wins}-${row.losses} | ${percent(row.winRate)} | ${percent(row.wilsonLow)}–${percent(row.wilsonHigh)} | ${Object.entries(row.lossReasons).map(([key, value]) => `${key} ${value}`).join("；") || "-"} |`);
}
lines.push("", "## 重复对手中的低胜率组", "", "| 对手 | tank id | 技能 | 场次 | 胜-负 | 胜率 | 95% Wilson 区间 | 失败原因 |", "|---|---:|---|---:|---:|---:|---:|---|");
for (const row of lowOpponents) {
  lines.push(`| ${row.name} | ${row.opponentTankId} | ${row.skill} | ${row.matches} | ${row.wins}-${row.losses} | ${percent(row.winRate)} | ${percent(row.wilsonLow)}–${percent(row.wilsonHigh)} | ${Object.entries(row.lossReasons).map(([key, value]) => `${key} ${value}`).join("；")} |`);
}
lines.push("", "## 全部失败原因", "", "| 结算原因 | 场次 |", "|---|---:|");
for (const [key, value] of Object.entries(analysis.groups).filter(([key]) => key.startsWith("loss/"))) lines.push(`| ${key.slice(5)} | ${value.matches} |`);
lines.push("", "### 被击毁的弹道归因", "", "| 子类型 | 场次 |", "|---|---:|");
const subtypes = {};
for (const match of analysis.matches) if (match.outcome === "loss" && match.deathDetail) increment(subtypes, match.deathDetail.subtype);
for (const [key, value] of Object.entries(subtypes).sort((a, b) => b[1] - a[1])) lines.push(`| ${key} | ${value} |`);
lines.push("", "## 最新补齐的 10 场", "", "| 时间（CST） | 对手 | 推断技能 | 结果 | 星 | 帧/我方耗时 | 失败归因 |", "|---|---|---|---|---:|---:|---|");
for (const match of newestTen) {
  lines.push(`| ${match.createdAtLocal.replace("T", " ").slice(0, 19)} | ${match.opponent} | ${inferredSkill(match.opponentTankId)} | ${match.outcome}/${match.resultReason} | ${match.stars}-${match.enemyStars} | ${match.frames}/${match.runtimeMs}ms | ${match.deathDetail?.subtype || (match.outcome === "loss" ? match.resultReason : "-")} |`);
}
lines.push("", "## 结论", "");
if (weakestSkill) {
  lines.push(`- 当前最低已知技能组为 ${weakestSkill.skill}：${weakestSkill.wins}-${weakestSkill.losses}（${percent(weakestSkill.winRate)}），但版本分布和对手强度仍需结合逐场回放判断。`);
}
if (bestSupportedLowOpponent) {
  lines.push(`- 低胜率组中样本最多的是 ${bestSupportedLowOpponent.name}：${bestSupportedLowOpponent.wins}-${bestSupportedLowOpponent.losses}（${percent(bestSupportedLowOpponent.winRate)}），技能 ${bestSupportedLowOpponent.skill}。`);
}
if (newestVersion) {
  lines.push(`- 最新 v${newestVersion.version} 实战为 ${newestVersion.wins}-${newestVersion.losses}（${percent(newestVersion.winRate)}）；失败原因：${Object.entries(newestVersion.lossReasons).map(([key, value]) => `${key} ${value}`).join("；") || "无"}。`);
}
lines.push(`- 全量性能结算失败包括 timeout ${timeoutLosses} 场、runTime ${runtimeLosses} 场；必须结合最新批次的实际 runtime，而不能只看总体胜率。`);
fs.writeFileSync(path.join(root, "OPPONENT_SKILL_ANALYSIS.md"), `${lines.join("\n")}\n`);
console.log(JSON.stringify({ report: path.join(root, "OPPONENT_SKILL_ANALYSIS.md"), lowOpponents: lowOpponents.map(row => ({ name: row.name, matches: row.matches, wins: row.wins, losses: row.losses, winRate: row.winRate, skill: row.skill })), skills: skillRows.map(row => ({ skill: row.skill, matches: row.matches, wins: row.wins, losses: row.losses, winRate: row.winRate })) }, null, 2));
