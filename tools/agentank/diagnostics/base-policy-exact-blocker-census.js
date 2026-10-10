"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { EXACT_BLOCK } = require("./native-bounded-policy-search-poc");

const IMPLEMENTATION = "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE";
const REASONS = Object.freeze([
  ["BUDGET", EXACT_BLOCK.BUDGET],
  ["FAST_INCOMPLETE", EXACT_BLOCK.FAST_INCOMPLETE],
  ["HARD_INCOMPLETE", EXACT_BLOCK.HARD_INCOMPLETE],
  ["DEPTH_LEAF", EXACT_BLOCK.DEPTH_LEAF],
  ["TOP_LEAF", EXACT_BLOCK.TOP_LEAF],
  ["POLICY_REJECT_LEAF", EXACT_BLOCK.POLICY_REJECT_LEAF],
  ["NO_ACTION_LEAF", EXACT_BLOCK.NO_ACTION_LEAF]
]);

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function basisPoints(count, total) {
  return total ? Math.round(count * 10000 / total) : 0;
}

function summarize(rows) {
  const masks = new Array(128).fill(0);
  let wins = 0; let losses = 0; let draws = 0;
  let roots = 0; let exactRoots = 0; let blockedRoots = 0;
  let ownerBlocked = 0; let budgetCompleteHeuristic = 0; let depthOnly = 0;
  const leaves = { terminal: 0, depth: 0, budget: 0,
    fastIncomplete: 0, hardIncomplete: 0, policyReject: 0, noAction: 0 };
  for (const row of rows) {
    if (row.analysisOutcome === "V2_WIN") wins += 1;
    else if (row.analysisOutcome === "V1_WIN") losses += 1;
    else draws += 1;
    const owner = row.candidate?.nativeTacticalActionOwner || {};
    const search = owner.policySearch || {};
    const current = search.exactBlockMaskCount || [];
    for (let mask = 0; mask < 128; mask += 1)
      masks[mask] += current[mask] || 0;
    roots += search.completeCount || 0;
    exactRoots += search.exactOwnershipRootCount || 0;
    blockedRoots += search.exactBlockedRootCount || 0;
    ownerBlocked += owner.policySearchExactSupportBlockedCount || 0;
    budgetCompleteHeuristic += search.budgetCompleteHeuristicRootCount || 0;
    depthOnly += search.depthOnlyHeuristicRootCount || 0;
    leaves.terminal += search.terminalCount || 0;
    leaves.depth += search.depthLeafCount || 0;
    leaves.budget += search.leafBudgetCount || 0;
    leaves.fastIncomplete += search.fastIncompleteCount || 0;
    leaves.hardIncomplete += search.hardIncompleteCount || 0;
    leaves.policyReject += search.hardRejectPolicyCount || 0;
    leaves.noAction += search.noActionLeafCount || 0;
  }
  const maskTotal = masks.reduce((sum, count) => sum + count, 0);
  if (maskTotal !== roots)
    throw new Error(`EXACT_BLOCK_MASK_DENOMINATOR_MISMATCH:${maskTotal}:${roots}`);
  if (masks[0] !== exactRoots)
    throw new Error(`EXACT_ROOT_MISMATCH:${masks[0]}:${exactRoots}`);
  if (blockedRoots !== roots - exactRoots || ownerBlocked !== blockedRoots)
    throw new Error(`EXACT_BLOCKED_MISMATCH:${roots}:${exactRoots}:` +
      `${blockedRoots}:${ownerBlocked}`);
  const reasonCounts = {};
  for (const [name, bit] of REASONS)
    reasonCounts[name] = masks.reduce((sum, count, mask) =>
      sum + (mask & bit ? count : 0), 0);
  const combinations = masks.map((count, mask) => ({ mask, count,
    reasons: REASONS.filter(([, bit]) => mask & bit).map(([name]) => name) }))
    .filter(value => value.count).sort((left, right) =>
      right.count - left.count || left.mask - right.mask);
  const budgetDepth = masks.reduce((sum, count, mask) => sum +
    ((mask & EXACT_BLOCK.BUDGET) && (mask & EXACT_BLOCK.DEPTH_LEAF) ?
      count : 0), 0);
  return {
    matches: rows.length, wins, losses, draws,
    scoreBasisPoints: rows.length ? Math.round(
      (wins * 10000 + draws * 5000) / rows.length) : 0,
    roots, exactRoots, blockedRoots, ownerBlocked,
    budgetCompleteHeuristic, depthOnly, budgetDepth,
    rootBasisPoints: {
      exact: basisPoints(exactRoots, roots),
      blocked: basisPoints(blockedRoots, roots),
      budget: basisPoints(reasonCounts.BUDGET, roots),
      depth: basisPoints(reasonCounts.DEPTH_LEAF, roots),
      budgetAndDepth: basisPoints(budgetDepth, roots),
      budgetCompleteHeuristic: basisPoints(budgetCompleteHeuristic, roots),
      depthOnly: basisPoints(depthOnly, roots)
    },
    reasonCounts, combinations, leaves,
    conclusion: {
      wholeTreeExactnessIsSparse: true,
      widenFiniteDepthHeuristicOwnership: false,
      recommendedBoundary:
        "INDEPENDENT_ACTION_LEVEL_TERMINAL_OR_FORCED_WIN_CERTIFICATE",
      rationale: "Most blocked roots contain both budget and depth leaves; " +
        "a candidate-level proof can close one action without pretending every " +
        "finite-depth leaf is an exact game value."
    }
  };
}

function run() {
  const input = path.resolve(option("--input"));
  const output = path.resolve(option("--output", "/tmp/agentank-bp14-census"));
  const sourceBytes = fs.readFileSync(path.join(input, "matches.ndjson.gz"));
  const text = zlib.gunzipSync(sourceBytes).toString("utf8").trim();
  const rows = (text ? text.split("\n").map(JSON.parse) : []).filter(row =>
    row.implementation === IMPLEMENTATION);
  const overview = { objectKind: "BASE_POLICY_EXACT_BLOCKER_CENSUS_V1",
    ...summarize(rows) };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "overview.json"),
    `${JSON.stringify(overview, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify({
    objectKind: "BASE_POLICY_EXACT_BLOCKER_CENSUS_MANIFEST_V1",
    input, inputSha256: sha256(sourceBytes),
    sourceSha256: sha256(fs.readFileSync(__filename))
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, overview }, null, 2)}\n`);
  return overview;
}

if (require.main === module) run();

module.exports = { basisPoints, summarize };
