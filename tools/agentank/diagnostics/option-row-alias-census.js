#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { fingerprintObject } = require("../core/hash");
const { STRATEGY_PURPOSE } = require("../../../engine-v2/src/abi/policy-codes");

const OPTION_CATEGORY = Object.freeze({ ATTACK: 1 << 0, STAR: 1 << 1,
  TERMINAL: 1 << 2, CONTINUATION: 1 << 3, POSITION: 1 << 4,
  RESOURCE: 1 << 5, COMMITTED: 1 << 6 });

const ATTACK = STRATEGY_PURPOSE.DIRECT_KILL |
  STRATEGY_PURPOSE.ADVANTAGEOUS_FIRE | STRATEGY_PURPOSE.AIM_SETUP |
  STRATEGY_PURPOSE.INTERCEPT | STRATEGY_PURPOSE.ESCAPE_DENIAL |
  STRATEGY_PURPOSE.SHIELD_BREAK | STRATEGY_PURPOSE.ZONE_DENIAL |
  STRATEGY_PURPOSE.BELIEF_SWEEP | STRATEGY_PURPOSE.ATTACK_APPROACH;
const STAR = STRATEGY_PURPOSE.STAR_COLLECT | STRATEGY_PURPOSE.STAR_DENY;
const TERMINAL = STRATEGY_PURPOSE.PRESERVE_NONLOSS |
  STRATEGY_PURPOSE.TERMINAL_REVERSAL;

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}
function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}
function bitCount(value) {
  let count = 0;
  for (let bits = value >>> 0; bits; bits >>>= 1) count += bits & 1;
  return count;
}
function categoryMask(label) {
  const purpose = label?.strategyPurpose || 0;
  let mask = 0;
  if (purpose & ATTACK) mask |= OPTION_CATEGORY.ATTACK;
  if (purpose & STAR) mask |= OPTION_CATEGORY.STAR;
  if (purpose & TERMINAL) mask |= OPTION_CATEGORY.TERMINAL;
  if (purpose & STRATEGY_PURPOSE.PLAN_CONTINUATION)
    mask |= OPTION_CATEGORY.CONTINUATION;
  if (purpose & STRATEGY_PURPOSE.NEUTRAL_POSITION)
    mask |= OPTION_CATEGORY.POSITION;
  if (purpose & STRATEGY_PURPOSE.SKILL_SETUP)
    mask |= OPTION_CATEGORY.RESOURCE;
  if (label?.escapeMember) mask |= OPTION_CATEGORY.COMMITTED;
  return mask;
}
function terminalUnits(terminal) {
  return terminal?.outcome === "V2_WIN" ? 2 : terminal?.outcome === "DRAW" ? 1 : 0;
}
function robustPolicyUnits(label, policy) {
  let value = 3, count = 0;
  for (const cell of label?.responseMatrix?.cells || [])
    if (cell.ownPolicy === policy) {
      value = Math.min(value, terminalUnits(cell.terminal)); count += 1;
    }
  return count ? value : -1;
}
function analyze(document) {
  const report = { schemaVersion: 1, objectKind: "OPTION_ROW_ALIAS_CENSUS_V1",
    inputFingerprint: document.fingerprint || "", roots: 0, rows: 0,
    multiOptionRows: 0, rootsWithAliases: 0, selectedAliasRoots: 0,
    continuationRegretRoots: 0, continuationRegretWithSelectedAlias: 0,
    rowsByCategoryCount: {}, aliasesByAction: {}, categoryMasks: {},
    rootsByStratum: {}, selectedAliasesByStratum: {}, fingerprint: "" };
  for (const match of document.matches || []) for (const root of match.roots || []) {
    report.roots += 1; let rootAlias = 0;
    const selected = (root.labels || []).find(label => label.row === root.selectedRow);
    for (const label of root.labels || []) {
      report.rows += 1;
      const mask = categoryMask(label), categories = bitCount(mask);
      increment(report.rowsByCategoryCount, String(categories));
      increment(report.categoryMasks, `0x${mask.toString(16)}`);
      if (categories > 1) {
        report.multiOptionRows += 1; rootAlias = 1;
        increment(report.aliasesByAction, label.action?.type || "NONE");
      }
    }
    const stratum = root.samplingStratum || "UNCLASSIFIED";
    increment(report.rootsByStratum, stratum);
    if (rootAlias) report.rootsWithAliases += 1;
    const selectedAlias = selected && bitCount(categoryMask(selected)) > 1;
    if (selectedAlias) {
      report.selectedAliasRoots += 1;
      increment(report.selectedAliasesByStratum, stratum);
    }
    const selectedRobust = robustPolicyUnits(selected, "V2");
    let portfolioRobust = selectedRobust;
    for (const label of root.labels || [])
      for (const policy of root.responsePolicies || document.responsePolicies || ["V2", "V3"])
        portfolioRobust = Math.max(portfolioRobust, robustPolicyUnits(label, policy));
    if (portfolioRobust > selectedRobust) {
      report.continuationRegretRoots += 1;
      if (selectedAlias) report.continuationRegretWithSelectedAlias += 1;
    }
  }
  report.aliasRowBasisPoints = Math.round(report.multiOptionRows * 10000 /
    Math.max(1, report.rows));
  report.aliasRootBasisPoints = Math.round(report.rootsWithAliases * 10000 /
    Math.max(1, report.roots));
  report.fingerprint = fingerprintObject({ ...report, fingerprint: "" });
  return report;
}
function run() {
  const inputFile = path.resolve(option("--input", "/tmp/dqa-stratified-frame-labels.json"));
  const outputFile = path.resolve(option("--output", "/tmp/option-row-alias-census.json"));
  const report = analyze(JSON.parse(fs.readFileSync(inputFile, "utf8")));
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputFile, roots: report.roots,
    rows: report.rows, multiOptionRows: report.multiOptionRows,
    rootsWithAliases: report.rootsWithAliases,
    selectedAliasRoots: report.selectedAliasRoots,
    continuationRegretRoots: report.continuationRegretRoots,
    continuationRegretWithSelectedAlias: report.continuationRegretWithSelectedAlias,
    fingerprint: report.fingerprint }, null, 2)}\n`);
  return report;
}
if (require.main === module) {
  try { run(); } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1;
  }
}
module.exports = { OPTION_CATEGORY, bitCount, categoryMask, robustPolicyUnits,
  analyze, run };
