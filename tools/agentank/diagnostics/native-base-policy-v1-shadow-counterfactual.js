#!/usr/bin/env node
"use strict";

// For every input match, find the first root where frozen V1 and thin V2
// disagree.  Replay the current thin V2 from frame zero, replace only that one
// action with V1's action (after FinalActionGate), then return ownership to V2.
// This is a one-deviation causal label, not a V1 suffix comparison.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { loadSimulator } = require("../simulation/paired-arena");
const { loadCohort } = require("./v2-native-initiative-arena");
const { play, sourceClosureSha256 } = require(
  "./native-base-policy-standalone-arena");
const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1] : fallback;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readDirectory(directory) {
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

function divergences(match) {
  const output = [];
  for (const root of match.candidateEngine?.rootFrames || []) {
    const selected = rowFor(root, root.selected);
    const wanted = root.v1Shadow?.resolvedAction ?? ACTION.NONE;
    if (!selected || wanted === ACTION.NONE || wanted === ACTION.CAST_TELEPORT ||
        selected.action === wanted) continue;
    const candidate = root.candidates.find(item => item.action === wanted && item.hard === 0);
    if (!candidate) continue;
    output.push({ root, selected, candidate });
  }
  return output;
}

function firstDivergence(match) {
  return divergences(match)[0] || null;
}

function keyFor(match) {
  return `${match.scenarioFingerprint}:${match.candidateSeat}`;
}

function terminalVector(match) {
  const outcome = match.analysisOutcome === "V2_WIN" ? 2 :
    match.analysisOutcome === "DRAW" ? 1 : 0;
  const seat = match.candidateSeat; const other = seat ^ 1;
  const crashes = match.counts.crashes || [0, 0];
  const stars = match.counts.stars || [0, 0];
  return [outcome, crashes[seat] ? 0 : 1, crashes[other] ? 1 : 0,
    (stars[seat] || 0) - (stars[other] || 0)];
}

function compareVector(left, right) {
  for (let at = 0; at < left.length; at += 1) {
    if (left[at] > right[at]) return 1;
    if (left[at] < right[at]) return -1;
  }
  return 0;
}

function prefixMatches(source, branch, frame, wanted) {
  const before = Buffer.from(source.candidate.compactActionStream || "", "base64");
  const after = Buffer.from(branch.candidate.compactActionStream || "", "base64");
  if (frame >= after.length || after[frame] !== wanted) return false;
  for (let at = 0; at < frame; at += 1)
    if (at >= before.length || before[at] !== after[at]) return false;
  return true;
}

function bump(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function summarize(records) {
  const output = { records: records.length, improved: 0, equal: 0, regressed: 0,
    prefixMismatch: 0, forceMiss: 0, transitions: {}, stages: {}, actionPairs: {},
    support: { complete: { improved: 0, equal: 0, regressed: 0 },
      incomplete: { improved: 0, equal: 0, regressed: 0 } } };
  for (const record of records) {
    const quality = record.quality;
    output[quality] += 1;
    if (!record.prefixMatched) output.prefixMismatch += 1;
    if (!record.forceApplied) output.forceMiss += 1;
    bump(output.transitions, record.transition);
    const stage = record.root.v1Stage;
    if (!output.stages[stage]) output.stages[stage] =
      { records: 0, improved: 0, equal: 0, regressed: 0 };
    output.stages[stage].records += 1;
    output.stages[stage][quality] += 1;
    bump(output.actionPairs, `${record.root.selectedAction}>${record.root.v1Action}`);
    output.support[record.root.searchSupportComplete ? "complete" : "incomplete"][quality] += 1;
  }
  return output;
}

async function run(workspaceRoot = process.cwd()) {
  const root = path.resolve(workspaceRoot);
  const inputs = option("--inputs").split(",").map(value => value.trim()).filter(Boolean);
  if (!inputs.length) throw new Error("V1_SHADOW_COUNTERFACTUAL_INPUT_REQUIRED");
  const sources = inputs.map(readDirectory);
  const closure = sourceClosureSha256(root);
  for (const source of sources)
    if (!source.overview.diagnostics?.v3ShadowLabels ||
        source.overview.source?.runtimeClosure !== closure)
      throw new Error(`V1_SHADOW_COUNTERFACTUAL_SOURCE_MISMATCH:${source.root}`);
  const cohortFile = path.resolve(option("--cohort",
    path.join(root, "config/engine-v3/v3-repair-cohort.json")));
  const roleCache = new Map();
  for (const source of sources) {
    const role = source.overview.role;
    if (!roleCache.has(role)) roleCache.set(role,
      loadCohort(root, cohortFile, role).scenarios);
  }
  const scenarios = new Map();
  for (const values of roleCache.values())
    for (const scenario of values) scenarios.set(scenario.matchUrlId, scenario);
  const maximum = Math.max(1, Number(option("--max-matches", "64")) | 0);
  const maximumPerStage = Math.max(0,
    Number(option("--max-per-stage", "0")) | 0);
  const selected = [];
  const seen = new Set();
  const selectedByStage = Object.create(null);
  for (const source of sources) for (const match of source.matches) {
    if (selected.length >= maximum) break;
    for (const divergence of divergences(match)) {
      if (selected.length >= maximum) break;
      const stage = divergence.root.v1Shadow?.stageName || "UNKNOWN";
      if (maximumPerStage && (selectedByStage[stage] || 0) >= maximumPerStage)
        continue;
      const key = `${keyFor(match)}:${divergence.root.frame}`;
      if (seen.has(key))
        throw new Error(`V1_SHADOW_COUNTERFACTUAL_DUPLICATE:${key}`);
      seen.add(key);
      selected.push({ source, match, divergence });
      selectedByStage[stage] = (selectedByStage[stage] || 0) + 1;
    }
  }
  const { module } = await loadSimulator(root);
  const records = [];
  for (let at = 0; at < selected.length; at += 1) {
    const item = selected[at]; const frame = item.divergence.root.frame;
    const wanted = item.divergence.candidate.action;
    const scenario = scenarios.get(item.match.matchUrlId);
    if (!scenario) throw new Error(`V1_SHADOW_COUNTERFACTUAL_SCENARIO_MISSING:${
      item.match.matchUrlId}`);
    const branch = await play(module, scenario, item.match.candidateSeat, false,
      null, true, true, "current", false, false, 1, "off", frame, wanted,
      0, 0, 3, "row-shared", false, "off");
    const comparison = compareVector(terminalVector(branch), terminalVector(item.match));
    records.push({ matchUrlId: item.match.matchUrlId,
      scenarioFingerprint: item.match.scenarioFingerprint,
      candidateSeat: item.match.candidateSeat,
      sourceDirectory: item.source.root,
      transition: `${item.match.analysisOutcome}->${branch.analysisOutcome}`,
      quality: comparison > 0 ? "improved" : comparison < 0 ? "regressed" : "equal",
      prefixMatched: prefixMatches(item.match, branch, frame, wanted),
      forceSeen: Boolean(branch.candidateEngine.forceFrameSeen),
      forceApplied: Boolean(branch.candidateEngine.forceApplied),
      baseline: { outcome: item.match.analysisOutcome,
        terminalCategory: item.match.terminalCategory, frames: item.match.frames,
        stars: item.match.counts.stars, crashes: item.match.counts.crashes },
      branch: { outcome: branch.analysisOutcome,
        terminalCategory: branch.terminalCategory, frames: branch.frames,
        stars: branch.counts.stars, crashes: branch.counts.crashes },
      root: { frame, controlMode: item.divergence.root.controlMode,
        v1Stage: item.divergence.root.v1Shadow.stageName,
        selectedAction: item.divergence.selected.action,
        v1Action: wanted,
        incumbentAction: rowFor(item.divergence.root,
          item.divergence.root.incumbent)?.action ?? ACTION.NONE,
        proposalAction: rowFor(item.divergence.root,
          item.divergence.root.proposal)?.action ?? ACTION.NONE,
        searchDepth: item.divergence.root.basePolicyDepth,
        searchNodes: item.divergence.root.basePolicyNodes,
        searchSupportComplete: Boolean(
          item.divergence.root.basePolicySupportComplete),
        searchBudgetLeaves: item.divergence.root.basePolicyBudgetLeaves,
        informationComplete: Boolean(item.divergence.root.informationComplete),
        hiddenWorlds: item.divergence.root.hiddenWorlds,
        possibleProjectiles: item.divergence.root.possibleProjectiles,
        escapeSupport: item.divergence.root.escapeSupport,
        escapeEntities: item.divergence.root.escapeEntities,
        selected: item.divergence.selected,
        v1: item.divergence.candidate } });
    if ((at + 1) % 8 === 0 || at + 1 === selected.length)
      process.stderr.write(`[v1-shadow-counterfactual] ${at + 1}/${selected.length}\n`);
  }
  const report = { objectKind: "NATIVE_BASE_POLICY_V1_SHADOW_COUNTERFACTUAL_V1",
    warning: "One V1 action is forced at the first same-observation disagreement; current V2 owns the complete suffix.",
    sourceClosureSha256: closure,
    inputs: sources.map(source => ({ directory: source.root,
      matchesSha256: source.bytesSha256, role: source.overview.role })),
    selectedMatches: selected.length,
    selectedByStage,
    summary: summarize(records), records };
  const output = path.resolve(option("--output",
    "/tmp/agentank-native-v1-shadow-counterfactual.json"));
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, summary: report.summary }, null, 2)}\n`);
  return report;
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { divergences, firstDivergence, prefixMatches, summarize, run };
