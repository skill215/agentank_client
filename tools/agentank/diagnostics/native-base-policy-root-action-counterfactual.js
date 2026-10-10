#!/usr/bin/env node
"use strict";

// Empirical one-deviation oracle for the upload-shaped NativeBasePolicy.  It
// forces each distinct Hard-allowed action for one frame at a captured root;
// the current V2 policy owns every later frame.  This isolates root selection
// quality without substituting V1's suffix policy or widening physical Hard.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { loadSimulator } = require("../simulation/paired-arena");
const { loadCohort } = require("./v2-native-initiative-arena");
const { play, sourceClosureSha256, productionTreeSha256 } = require(
  "./native-base-policy-standalone-arena");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1] : fallback;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readSource(directory) {
  const root = path.resolve(directory);
  const overview = JSON.parse(fs.readFileSync(path.join(root, "overview.json"), "utf8"));
  const bytes = fs.readFileSync(path.join(root, "matches.ndjson.gz"));
  const text = zlib.gunzipSync(bytes).toString("utf8").trim();
  return { root, overview, bytesSha256: sha256(bytes), matches:
    text ? text.split("\n").map(JSON.parse) : [] };
}

function rowFor(root, row) {
  return row >= 0 ? root.candidates.find(item => item.row === row) || null : null;
}

function distinctCandidates(root) {
  const seen = new Set(); const output = [];
  for (const row of root.candidates || []) {
    if (row.hard !== 0 || row.action === ACTION.NONE ||
        row.action === ACTION.CAST_TELEPORT || seen.has(row.action)) continue;
    seen.add(row.action); output.push(row);
  }
  return output;
}

function terminal(match) {
  const seat = match.candidateSeat; const other = seat ^ 1;
  return { outcome: match.analysisOutcome,
    category: match.terminalCategory, frames: match.frames,
    candidateStars: match.counts.stars[seat] || 0,
    controlStars: match.counts.stars[other] || 0,
    candidateCrashed: Boolean(match.counts.crashes[seat]),
    controlCrashed: Boolean(match.counts.crashes[other]) };
}

function vector(value) {
  return [value.outcome === "V2_WIN" ? 2 : value.outcome === "DRAW" ? 1 : 0,
    value.candidateCrashed ? 0 : 1, value.controlCrashed ? 1 : 0,
    value.candidateStars - value.controlStars];
}

function compare(left, right) {
  const a = vector(left); const b = vector(right);
  for (let at = 0; at < a.length; at += 1) {
    if (a[at] > b[at]) return 1;
    if (a[at] < b[at]) return -1;
  }
  return 0;
}

function prefixMatches(source, branch, frame, wanted) {
  for (const side of ["candidate", "control"]) {
    if (!source[side]?.compactActionStream || !branch[side]?.compactActionStream)
      return false;
    const before = Buffer.from(source[side].compactActionStream, "base64");
    const after = Buffer.from(branch[side].compactActionStream, "base64");
    if (before.length < frame || after.length < frame) return false;
    if (side === "candidate" && (frame >= after.length || after[frame] !== wanted))
      return false;
    if (!before.subarray(0, frame).equals(after.subarray(0, frame))) return false;
    const args = value => JSON.stringify((value.compactArguments || [])
      .filter(entry => entry[0] < frame));
    if (args(source[side]) !== args(branch[side])) return false;
  }
  return true;
}

function bump(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function chooseRoots(source, maximumPerStage) {
  const pool = [];
  for (const match of source.matches)
    for (const root of match.candidateEngine?.rootFrames || []) {
      const selected = rowFor(root, root.selected);
      const candidates = distinctCandidates(root);
      if (!selected || candidates.length < 2) continue;
      const stage = root.v1Shadow?.stageName || "UNKNOWN";
      const key = `${match.scenarioFingerprint}:${match.candidateSeat}:${root.frame}:${stage}`;
      pool.push({ match, root, selected, candidates, stage,
        rank: sha256(`native-root-oracle-v1\0${key}`) });
    }
  pool.sort((left, right) => left.rank.localeCompare(right.rank));
  const counts = Object.create(null); const selected = [];
  for (const item of pool) {
    if ((counts[item.stage] || 0) >= maximumPerStage) continue;
    counts[item.stage] = (counts[item.stage] || 0) + 1;
    selected.push(item);
  }
  return { selected, counts };
}

function compactRoot(item) {
  const root = item.root;
  return { frame: root.frame, stage: item.stage, controlMode: root.controlMode,
    ownCell: root.ownCell, ownDirection: root.ownDirection,
    enemyCell: root.enemyCell, enemyDirection: root.enemyDirection,
    ownStars: root.ownStars, enemyStars: root.enemyStars, starCell: root.starCell,
    ownEnemyDistance: root.ownEnemyDistance,
    clearLineToEnemy: root.clearLineToEnemy,
    lastAction: root.lastAction, turnStreak: root.turnStreak,
    goStallStreak: root.goStallStreak, intent: root.intent,
    informationComplete: root.informationComplete,
    hiddenWorlds: root.hiddenWorlds,
    possibleProjectiles: root.possibleProjectiles,
    escapeSupport: root.escapeSupport, escapeEntities: root.escapeEntities,
    incumbent: root.incumbent, proposal: root.proposal, selected: root.selected,
    searchDepth: root.basePolicyDepth, searchNodes: root.basePolicyNodes,
    searchEvidenceCurrent: root.searchEvidenceCurrent === true,
    searchEntryReason: root.searchEntryReason || "LEGACY_UNRECORDED",
    searchSupportComplete: root.basePolicySupportComplete,
    searchBudgetLeaves: root.basePolicyBudgetLeaves };
}

function summarize(records) {
  const output = { roots: records.length, branches: 0, recoverableRoots: 0,
    searchedRoots: 0, outcomeImprovedRoots: 0,
    outcomeImprovedSearchedRoots: 0, comparableSearchValuePairs: 0,
    prefixMismatch: 0, forceMiss: 0, byStage: {}, selectedToOracle: {},
    oracleRiskRejected: 0, oracleOwnerRejected: 0,
    basePolicyValueInversion: 0, robustValueInversion: 0,
    expectedValueInversion: 0 };
  for (const record of records) {
    if (record.root.searchEvidenceCurrent) output.searchedRoots += 1;
    output.branches += record.labels.length;
    output.prefixMismatch += record.labels.filter(label =>
      !label.prefixMatched).length;
    output.forceMiss += record.labels.filter(label => !label.forceApplied).length;
    const stage = record.root.stage;
    if (!output.byStage[stage]) output.byStage[stage] =
      { roots: 0, recoverable: 0, branches: 0 };
    output.byStage[stage].roots += 1;
    output.byStage[stage].branches += record.labels.length;
    if (!record.recoverable) continue;
    output.recoverableRoots += 1; output.byStage[stage].recoverable += 1;
    const outcomeRank = { V1_WIN: 0, DRAW: 1, V2_WIN: 2 };
    if (outcomeRank[record.oracle.terminal?.outcome] >
        outcomeRank[record.baselineOutcome]) {
      output.outcomeImprovedRoots += 1;
      if (record.root.searchEvidenceCurrent)
        output.outcomeImprovedSearchedRoots += 1;
    }
    if (record.root.searchEvidenceCurrent &&
        Number.isFinite(record.oracle.row.basePolicyValue) &&
        Number.isFinite(record.selected.basePolicyValue))
      output.comparableSearchValuePairs += 1;
    bump(output.selectedToOracle,
      `${record.selected.action}>${record.oracle.row.action}`);
    if (!record.oracle.row.acceptable) output.oracleRiskRejected += 1;
    if (record.root.searchEvidenceCurrent &&
        record.oracle.row.basePolicyMembership !== 5)
      output.oracleOwnerRejected += 1;
    if (record.root.searchEvidenceCurrent &&
        Number.isFinite(record.oracle.row.basePolicyValue) &&
        Number.isFinite(record.selected.basePolicyValue) &&
        record.oracle.row.basePolicyValue < record.selected.basePolicyValue)
      output.basePolicyValueInversion += 1;
    if (record.oracle.row.robust < record.selected.robust)
      output.robustValueInversion += 1;
    if (record.oracle.row.expected < record.selected.expected)
      output.expectedValueInversion += 1;
  }
  return output;
}

async function run(workspaceRoot = process.cwd()) {
  const root = path.resolve(workspaceRoot);
  const source = readSource(option("--input"));
  const closure = sourceClosureSha256(root);
  if (source.overview.source?.runtimeClosure !== closure)
    throw new Error("NATIVE_ROOT_ORACLE_SOURCE_MISMATCH");
  const productionTree = productionTreeSha256(root);
  if (source.overview.source?.productionTree !== productionTree)
    throw new Error("NATIVE_ROOT_ORACLE_PRODUCTION_TREE_MISMATCH");
  const maximumPerStage = Math.max(1,
    Number(option("--max-per-stage", "12")) | 0);
  const chosen = chooseRoots(source, maximumPerStage);
  const cohortFile = path.resolve(option("--cohort",
    path.join(root, "config/engine-v3/v3-repair-cohort.json")));
  const scenarios = new Map(loadCohort(root, cohortFile,
    source.overview.role).scenarios.map(value => [value.matchUrlId, value]));
  const { module } = await loadSimulator(root);
  const records = [];
  for (let index = 0; index < chosen.selected.length; index += 1) {
    const item = chosen.selected[index]; const baseline = terminal(item.match);
    const scenario = scenarios.get(item.match.matchUrlId);
    if (!scenario) throw new Error(`NATIVE_ROOT_ORACLE_SCENARIO_MISSING:${
      item.match.matchUrlId}`);
    const labels = [];
    for (const row of item.candidates) {
      if (row.action === item.selected.action) {
        labels.push({ row, terminal: baseline, prefixMatched: true,
          forceApplied: true, selected: true });
        continue;
      }
      const branch = await play(module, scenario, item.match.candidateSeat, false,
        null, true, true, "current", false, false, 1, "off",
        item.root.frame, row.action, 0, 0, 3, "row-shared", false, "off");
      labels.push({ row, terminal: terminal(branch),
        prefixMatched: prefixMatches(item.match, branch, item.root.frame, row.action),
        forceApplied: Boolean(branch.candidateEngine.forceApplied), selected: false });
    }
    let oracle = labels[0];
    for (const label of labels)
      if (compare(label.terminal, oracle.terminal) > 0) oracle = label;
    const selectedLabel = labels.find(label => label.selected);
    const recoverable = compare(oracle.terminal, selectedLabel.terminal) > 0;
    records.push({ matchUrlId: item.match.matchUrlId,
      scenarioFingerprint: item.match.scenarioFingerprint,
      candidateSeat: item.match.candidateSeat,
      baselineOutcome: item.match.analysisOutcome,
      root: compactRoot(item), selected: item.selected,
      recoverable, oracle, labels });
    if ((index + 1) % 4 === 0 || index + 1 === chosen.selected.length)
      process.stderr.write(`[native-root-oracle] ${index + 1}/${chosen.selected.length}\n`);
  }
  const report = { objectKind: "NATIVE_BASE_POLICY_ROOT_ACTION_COUNTERFACTUAL_V1",
    warning: "Each label changes one Hard-allowed root action; current V2 owns the suffix.",
    input: { directory: source.root, matchesSha256: source.bytesSha256,
      role: source.overview.role }, sourceClosureSha256: closure,
    productionTreeSha256: productionTree,
    maximumPerStage, selectedByStage: chosen.counts,
    summary: summarize(records), records };
  const output = path.resolve(option("--output",
    "/tmp/agentank-native-root-action-counterfactual.json"));
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, selectedByStage: chosen.counts,
    summary: report.summary }, null, 2)}\n`);
  return report;
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { distinctCandidates, chooseRoots, summarize, prefixMatches, run };
